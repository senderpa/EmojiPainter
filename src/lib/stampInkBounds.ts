import { AlphaType, ColorType, type SkImage } from '@shopify/react-native-skia';

/** Tight alpha crop rectangle within a stamp bitmap, normalized to 0..1. */
export interface InkBounds {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const FULL_BOUNDS: InkBounds = { u0: 0, v0: 0, u1: 1, v1: 1 };

const inkBoundsCache = new Map<string, InkBounds>();

/**
 * Tight alpha bounding box of a stamp image, expanded by a margin proportional to the ink box's
 * OWN size — mirrors `measureInkBounds()` in MetalPaintAtlas.swift EXACTLY (same 8/255 alpha
 * threshold, same 9% margin fraction) so the baked Metal stroke crops its emoji texture by the
 * same amount the live Skia preview does.
 *
 * The two renderers build their stamp bitmaps completely differently (Skia paragraph layout here
 * vs. UIFont glyph drawing in Swift), so a flat guessed padding constant tuned for one bitmap
 * fabrication method never matches the other. Measuring the ACTUAL ink on each side and cropping
 * to that is self-correcting regardless of how the source bitmap was built — it exposes "the
 * pictograph, edge to edge" either way, which is what makes a lattice-warped plane bake into
 * exactly the shape the preview showed instead of visibly re-bending the instant Apply runs.
 */
export const measureStampInkBounds = (key: string, image: SkImage): InkBounds => {
  const cached = inkBoundsCache.get(key);
  if (cached) return cached;

  const w = image.width();
  const h = image.height();
  if (w <= 0 || h <= 0) return FULL_BOUNDS;

  const info = { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  const pixels = image.readPixels(0, 0, info) as Uint8Array | Float32Array | null;
  if (!pixels) return FULL_BOUNDS;

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  const alphaThreshold = 8; // ignores faint anti-aliasing fringe, not real ink — matches Swift.
  for (let y = 0; y < h; y += 1) {
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      const a = pixels[rowBase + x * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    inkBoundsCache.set(key, FULL_BOUNDS);
    return FULL_BOUNDS;
  }

  // Small breathing room around the tight ink box, sized relative to the ink itself (not the full
  // bitmap) — matches Swift's marginFrac exactly.
  const marginFrac = 0.09;
  const inkW = maxX - minX + 1;
  const inkH = maxY - minY + 1;
  const mx = inkW * marginFrac;
  const my = inkH * marginFrac;
  const bounds: InkBounds = {
    u0: Math.max(0, minX - mx) / w,
    v0: Math.max(0, minY - my) / h,
    u1: Math.min(w, maxX + 1 + mx) / w,
    v1: Math.min(h, maxY + 1 + my) / h,
  };
  inkBoundsCache.set(key, bounds);
  return bounds;
};

/** Test-only / memory-pressure hook: drop every cached measurement. */
export const clearStampInkBoundsCache = (): void => {
  inkBoundsCache.clear();
};
