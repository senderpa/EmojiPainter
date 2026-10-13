/**
 * Deterministic committed smudge replay: apply a finished smudge Stroke onto a Skia surface by
 * reading the pixels beneath it, running the CPU smudge, and writing the result back.
 *
 * Processing happens at an adaptive resolution (see computeSmudgeScale): small brushes run at full
 * device resolution, large brushes on a downscaled buffer so cost stays bounded, with the result
 * upscaled back onto the device-resolution surface. Because EmojiCanvas replays strokes in order
 * onto the accumulated surface, the canvas already contains all prior strokes when this runs.
 */

import { PixelRatio } from 'react-native';
import type { SkCanvas, SkImage, SkPaint } from '@shopify/react-native-skia';

import type { Stroke } from '../../state/PaintingContext';

import { getSmudgeMask } from './emojiAlphaMask';
import { clampRegion, readRegionDownsampled, writeRegionUpscaled } from './pixelRegion';
import { applyPoints, initCarry, type SmudgeStrokeState } from './smudgeCore';
import { computeSmudgeScale, resolveSmudgeParams, type SmudgePoint, type SmudgeRegion } from './smudgeTypes';

type StampLike = { image: SkImage };

const DPR = PixelRatio.get();

/** Build a fresh per-stroke state sized to the mask. */
export const createStrokeState = (maskW: number, maskH: number, brushSizePx: number): SmudgeStrokeState => ({
  carry: new Float32Array(maskW * maskH * 4),
  maskW,
  maskH,
  brushSizePx,
  lastPoint: null,
  dirty: null
});

/** Compute the bounding region (in whatever px the points are) of a smudge stroke, padded. */
export const computeStrokeRegion = (
  points: SmudgePoint[],
  maskW: number,
  maskH: number,
  pad: number
): SmudgeRegion => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].x < minX) minX = points[i].x;
    if (points[i].y < minY) minY = points[i].y;
    if (points[i].x > maxX) maxX = points[i].x;
    if (points[i].y > maxY) maxY = points[i].y;
  }
  const halfW = maskW / 2 + pad;
  const halfH = maskH / 2 + pad;
  return {
    x: minX - halfW,
    y: minY - halfH,
    w: maxX - minX + halfW * 2,
    h: maxY - minY + halfH * 2
  };
};

/** Resolved scale + mask + params for a smudge stroke (shared by committed and live paths). */
export interface SmudgeSetup {
  scale: number;
  ps: number; // processing px per DIP (= DPR * scale)
  brushSizeProc: number;
  pad: number;
  mask: ReturnType<typeof getSmudgeMask>;
  params: ReturnType<typeof resolveSmudgeParams>;
}

/** Resolve the scale, emoji mask (cached) and params for a stroke, or null if unavailable. */
export const resolveSmudgeSetup = (
  stroke: Stroke,
  resolveStamp: (emoji: string, size: number) => StampLike | null
): SmudgeSetup | null => {
  const params = resolveSmudgeParams({
    smudgeStrength: stroke.smudgeStrength,
    edgeBlendStrength: stroke.edgeBlendStrength,
    reloadRate: stroke.reloadRate,
    dirtyUpdateRate: stroke.dirtyUpdateRate
  });
  const brushDevicePx = Math.max(2, stroke.size * DPR);
  const scale = computeSmudgeScale(brushDevicePx);
  const ps = DPR * scale;
  const procStampSize = stroke.size * scale; // getStamp px = procStampSize*DPR = stroke.size*ps
  const stamp = resolveStamp(stroke.emoji, procStampSize);
  if (!stamp?.image) {
    return null;
  }
  const px = Math.max(2, Math.round(procStampSize * DPR));
  const mask = getSmudgeMask(`smudge::${stroke.emoji}::${px}`, stamp.image, params.maskBlurRadius);
  if (!mask) {
    return null;
  }
  const brushSizeProc = Math.max(2, stroke.size * ps);
  const pad = Math.ceil(brushSizeProc * params.behindSampleDistance + 2);
  return { scale, ps, brushSizeProc, pad, mask, params };
};

/** Device-pixel rect to read/write for a processing-space region. */
export const procToDeviceRect = (
  procRegion: SmudgeRegion,
  scale: number,
  surfaceWpx: number,
  surfaceHpx: number
): SmudgeRegion | null =>
  clampRegion(
    { x: procRegion.x / scale, y: procRegion.y / scale, w: procRegion.w / scale, h: procRegion.h / scale },
    surfaceWpx,
    surfaceHpx
  );

export const appendSmudgeToSurface = (
  canvas: SkCanvas,
  stroke: Stroke,
  paint: SkPaint,
  surfaceWpx: number,
  surfaceHpx: number,
  resolveStamp: (emoji: string, size: number) => StampLike | null
): boolean => {
  if (!stroke.isSmudge || stroke.points.length === 0) {
    return false;
  }
  const setup = resolveSmudgeSetup(stroke, resolveStamp);
  if (!setup || !setup.mask) {
    return false;
  }
  const { scale, ps, mask, params, pad, brushSizeProc } = setup;

  const points: SmudgePoint[] = stroke.points.map((p) => ({ x: p.x * ps, y: p.y * ps }));
  const procSurfaceW = Math.ceil(surfaceWpx * scale);
  const procSurfaceH = Math.ceil(surfaceHpx * scale);
  const procRegion = clampRegion(computeStrokeRegion(points, mask.w, mask.h, pad), procSurfaceW, procSurfaceH);
  if (!procRegion) {
    return false;
  }
  const deviceRect = procToDeviceRect(procRegion, scale, surfaceWpx, surfaceHpx);
  if (!deviceRect) {
    return false;
  }
  const buffer = readRegionDownsampled(canvas, deviceRect, procRegion.w, procRegion.h);
  if (!buffer) {
    return false;
  }

  const state = createStrokeState(mask.w, mask.h, brushSizeProc);
  initCarry(state, buffer, procRegion, points[0]);
  applyPoints(state, buffer, procRegion, mask, points, params);

  writeRegionUpscaled(canvas, buffer, procRegion.w, procRegion.h, deviceRect, paint);
  return true;
};
