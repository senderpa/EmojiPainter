/**
 * GPU smudge engine (SkSL RuntimeEffect) — directional color-carry model.
 *
 * This is NOT a blur. Within the emoji's alpha mask, each dab pulls color from BEHIND the cursor
 * along the stroke direction and blends it forward — it TRANSPORTS color (Krita "smearing" / a
 * dirty-finger carry). The amount it reaches back ("smudge length") is the user's slider: longer
 * reach = color is carried further = stronger, creamier smudge. We sample a few points ALONG the
 * stroke direction and average them (directional, not isotropic) for a smooth oil-paint feel
 * without the muddy low-pass blur of neighbourhood averaging.
 *
 * Read-after-write is handled by ping-ponging through one snapshot per frame (never per dab — that
 * caused GPU OOM); cost per dab is the dab's bounding box, independent of brush size.
 */

import {
  BlendMode,
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  type SkRuntimeEffect,
  type SkSurface
} from '@shopify/react-native-skia';

import type { SmudgeRegion } from './smudgeTypes';

const SMUDGE_SKSL = `
uniform shader src;       // current canvas snapshot
uniform shader mask;      // emoji stamp (alpha = brush silhouette), sampled in its pixel space
uniform float2 center;    // dab center in canvas device px
uniform float2 maskHalf;  // half the mask image size in px
uniform float2 dir;       // normalized stroke direction
uniform float  reach;     // how far back to carry color, in px (= smudge length)
uniform float  strength;  // 0..1 deposit amount

half4 main(float2 xy) {
  float2 mcoord = xy - (center - maskHalf);
  float m = smoothstep(0.1, 0.55, mask.eval(mcoord).a);
  if (m <= 0.0) {
    return src.eval(xy);
  }
  half4 dst = src.eval(xy);
  float r = reach * m;
  // Directional carry: average several taps BEHIND the cursor along the stroke direction (color
  // TRANSPORT, not isotropic blur). More taps = smooth, creamy gradient with no banding.
  half4 carried = dst
    + src.eval(xy - dir * (r * 0.2))
    + src.eval(xy - dir * (r * 0.4))
    + src.eval(xy - dir * (r * 0.6))
    + src.eval(xy - dir * (r * 0.8))
    + src.eval(xy - dir * r);
  carried = carried * (1.0 / 6.0);
  return mix(dst, carried, m * strength);
}
`;

let cachedEffect: SkRuntimeEffect | null | undefined;

const getEffect = (): SkRuntimeEffect | null => {
  if (cachedEffect === undefined) {
    cachedEffect = Skia.RuntimeEffect.Make(SMUDGE_SKSL);
    if (!cachedEffect) {
      console.warn('[gpuSmudge] failed to compile smudge SkSL');
    }
  }
  return cachedEffect ?? null;
};

export const isGpuSmudgeAvailable = (): boolean => getEffect() !== null;

export interface SmudgeDab {
  cx: number; // device px
  cy: number;
  dirX: number; // normalized stroke direction
  dirY: number;
}

const applyDabToSurface = (
  surface: SkSurface,
  source: SkImage,
  maskImage: SkImage,
  paint: SkPaint,
  dab: SmudgeDab,
  reach: number,
  strength: number,
  surfaceW: number,
  surfaceH: number
): SmudgeRegion | null => {
  const effect = getEffect();
  if (!effect) {
    return null;
  }
  const maskW = maskImage.width();
  const maskH = maskImage.height();
  const srcShader = source.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
  const maskShader = maskImage.makeShaderOptions(TileMode.Decal, TileMode.Decal, FilterMode.Linear, MipmapMode.None);
  const shader = effect.makeShaderWithChildren(
    [dab.cx, dab.cy, maskW / 2, maskH / 2, dab.dirX, dab.dirY, reach, strength],
    [srcShader, maskShader]
  );
  paint.setShader(shader);
  paint.setBlendMode(BlendMode.Src);

  const x = Math.max(0, Math.floor(dab.cx - maskW / 2));
  const y = Math.max(0, Math.floor(dab.cy - maskH / 2));
  const right = Math.min(surfaceW, Math.ceil(dab.cx + maskW / 2));
  const bottom = Math.min(surfaceH, Math.ceil(dab.cy + maskH / 2));
  const w = right - x;
  const h = bottom - y;
  if (w <= 0 || h <= 0) {
    shader.dispose?.();
    srcShader.dispose?.();
    maskShader.dispose?.();
    return null;
  }
  surface.getCanvas().drawRect(Skia.XYWHRect(x, y, w, h), paint);
  paint.setShader(null);
  shader.dispose?.();
  srcShader.dispose?.();
  maskShader.dispose?.();
  return { x, y, w, h };
};

const unionRect = (a: SmudgeRegion, b: SmudgeRegion): SmudgeRegion => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
};

/**
 * Apply a sequence of dabs. Re-snapshots the surface every `resnapshotEvery` dabs so smearing builds
 * up progressively while keeping snapshot churn bounded. Returns the union dirty rect.
 */
export const applyDabsToSurface = (
  surface: SkSurface,
  maskImage: SkImage,
  paint: SkPaint,
  dabs: SmudgeDab[],
  reach: number,
  strength: number,
  surfaceW: number,
  surfaceH: number,
  resnapshotEvery = 2
): SmudgeRegion | null => {
  let dirty: SmudgeRegion | null = null;
  let source: SkImage | null = null;
  const every = Math.max(1, resnapshotEvery);
  for (let i = 0; i < dabs.length; i += 1) {
    if (i % every === 0) {
      source?.dispose?.();
      source = surface.makeImageSnapshot();
    }
    if (!source) {
      break;
    }
    const rect = applyDabToSurface(surface, source, maskImage, paint, dabs[i], reach, strength, surfaceW, surfaceH);
    if (rect) {
      dirty = dirty ? unionRect(dirty, rect) : rect;
    }
  }
  source?.dispose?.();
  surface.flush();
  return dirty;
};

/**
 * Interpolate dabs between two device-px points at the given spacing; each dab carries the unit
 * direction of travel. Caps the count so a fast segment can't explode into thousands of passes.
 */
export const interpolateDabs = (
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  spacing: number,
  maxDabs: number
): SmudgeDab[] => {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  const dirX = dist > 0.0001 ? dx / dist : 0;
  const dirY = dist > 0.0001 ? dy / dist : 0;
  const steps = Math.max(1, Math.min(maxDabs, Math.ceil(dist / Math.max(1, spacing))));
  const dabs: SmudgeDab[] = new Array(steps);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    dabs[i - 1] = { cx: fromX + dx * t, cy: fromY + dy * t, dirX, dirY };
  }
  return dabs;
};

/** Crop a region out of an image into a small raster tile (portable, drawable on any canvas). */
export const cropToTile = (srcImage: SkImage, bounds: SmudgeRegion): SkImage | null => {
  if (bounds.w <= 0 || bounds.h <= 0) {
    return null;
  }
  const surface = Skia.Surface.Make(bounds.w, bounds.h);
  if (!surface) {
    return null;
  }
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setBlendMode(BlendMode.Src);
  canvas.drawImageRect(
    srcImage,
    Skia.XYWHRect(bounds.x, bounds.y, bounds.w, bounds.h),
    Skia.XYWHRect(0, 0, bounds.w, bounds.h),
    paint
  );
  const snapshot = surface.makeImageSnapshot();
  surface.dispose?.();
  return snapshot;
};

/** Encode a tile to a base64 PNG (no data: prefix) for project persistence. */
export const encodeTileBase64 = (tile: SkImage): string | null => {
  try {
    return tile.encodeToBase64();
  } catch {
    return null;
  }
};

/** Decode a base64 PNG tile back into an SkImage (for loaded paintings). */
export const decodeTileBase64 = (base64: string): SkImage | null => {
  try {
    const data = (Skia.Data as any)?.fromBase64?.(base64);
    if (!data) {
      return null;
    }
    return Skia.Image.MakeImageFromEncoded(data);
  } catch {
    return null;
  }
};

/** Draw a baked tile back onto the canvas at its bounds (replaces — Src). */
export const blitTile = (canvas: SkCanvas, tile: SkImage, bounds: SmudgeRegion, paint: SkPaint): void => {
  paint.setShader(null);
  paint.setBlendMode(BlendMode.Src);
  paint.setAlphaf(1);
  canvas.drawImageRect(
    tile,
    Skia.XYWHRect(0, 0, tile.width(), tile.height()),
    Skia.XYWHRect(bounds.x, bounds.y, bounds.w, bounds.h),
    paint
  );
};
