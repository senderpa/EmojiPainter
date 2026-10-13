/**
 * Read/write rectangular RGBA regions of a Skia canvas in device pixels.
 *
 * Reads use straight (unpremultiplied) RGBA_8888 so the smudge math in `smudgeCore` works with
 * plain 0..255 channels. Writes rebuild an SkImage from the buffer and draw it back with
 * BlendMode.Src so the smudged region replaces the underlying pixels exactly once (the region
 * was already read in, smudged, and is being put back — SrcOver would double-composite).
 */

import { BlendMode, ColorType, AlphaType, Skia, type SkCanvas, type SkImage, type SkPaint } from '@shopify/react-native-skia';

import type { SmudgeRegion } from './smudgeTypes';

/** Build an SkImage from a region's RGBA buffer (straight alpha) for display as an overlay. */
export const regionToImage = (buffer: Uint8Array, region: SmudgeRegion): SkImage | null => {
  const info = { width: region.w, height: region.h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  const data = Skia.Data.fromBytes(buffer);
  const image = Skia.Image.MakeImage(info, data, region.w * 4);
  data.dispose?.();
  return image ?? null;
};

/** Clamp a region to [0,w]x[0,h]; returns null if it collapses to nothing. */
export const clampRegion = (region: SmudgeRegion, surfaceW: number, surfaceH: number): SmudgeRegion | null => {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const right = Math.min(surfaceW, Math.ceil(region.x + region.w));
  const bottom = Math.min(surfaceH, Math.ceil(region.y + region.h));
  const w = right - x;
  const h = bottom - y;
  if (w <= 0 || h <= 0) {
    return null;
  }
  return { x, y, w, h };
};

/**
 * Read a region into a Uint8Array (RGBA, straight alpha). Returns null on failure. The returned
 * buffer is exactly w*h*4 bytes; if Skia hands back a larger/typed buffer it is normalized.
 */
export const readRegion = (canvas: SkCanvas, region: SmudgeRegion): Uint8Array | null => {
  const info = { width: region.w, height: region.h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  const raw = canvas.readPixels(region.x, region.y, info);
  if (!raw) {
    return null;
  }
  const needed = region.w * region.h * 4;
  if (raw instanceof Uint8Array && raw.length === needed) {
    return raw;
  }
  // Normalize any other typed-array/length into a tight Uint8Array.
  const out = new Uint8Array(needed);
  const src = raw as ArrayLike<number>;
  const copy = Math.min(needed, src.length);
  for (let i = 0; i < copy; i += 1) {
    out[i] = src[i];
  }
  return out;
};

/**
 * Read a device-pixel region and downsample (nearest) into a processing-resolution buffer of
 * procW*procH. Returns null on failure. When proc dims match the device region it's a 1:1 read.
 */
export const readRegionDownsampled = (
  canvas: SkCanvas,
  deviceRegion: SmudgeRegion,
  procW: number,
  procH: number
): Uint8Array | null => {
  const dev = readRegion(canvas, deviceRegion);
  if (!dev) {
    return null;
  }
  if (procW === deviceRegion.w && procH === deviceRegion.h) {
    return dev;
  }
  const out = new Uint8Array(procW * procH * 4);
  const rx = deviceRegion.w / procW;
  const ry = deviceRegion.h / procH;
  for (let py = 0; py < procH; py += 1) {
    const sy = Math.min(deviceRegion.h - 1, (py * ry) | 0);
    const srcRow = sy * deviceRegion.w;
    const dstRow = py * procW;
    for (let px = 0; px < procW; px += 1) {
      const sx = Math.min(deviceRegion.w - 1, (px * rx) | 0);
      const s = (srcRow + sx) << 2;
      const d = (dstRow + px) << 2;
      out[d] = dev[s];
      out[d + 1] = dev[s + 1];
      out[d + 2] = dev[s + 2];
      out[d + 3] = dev[s + 3];
    }
  }
  return out;
};

/**
 * Draw a processing-resolution buffer (procW*procH) upscaled to cover a device-pixel region.
 * Uses BlendMode.Src to replace. Used by the committed smudge replay for downscaled big brushes.
 */
export const writeRegionUpscaled = (
  canvas: SkCanvas,
  buffer: Uint8Array,
  procW: number,
  procH: number,
  deviceRegion: SmudgeRegion,
  paint: SkPaint
): void => {
  const info = { width: procW, height: procH, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  const data = Skia.Data.fromBytes(buffer);
  const image = Skia.Image.MakeImage(info, data, procW * 4);
  if (!image) {
    data.dispose?.();
    return;
  }
  paint.setBlendMode(BlendMode.Src);
  paint.setAlphaf(1);
  const src = Skia.XYWHRect(0, 0, procW, procH);
  const dst = Skia.XYWHRect(deviceRegion.x, deviceRegion.y, deviceRegion.w, deviceRegion.h);
  canvas.drawImageRect(image, src, dst, paint);
  image.dispose?.();
  data.dispose?.();
};

/**
 * Write a Uint8Array (RGBA straight, sized region.w*region.h*4) back onto the canvas at region.
 * Uses BlendMode.Src to replace. The temporary SkImage/SkData copy is disposed immediately.
 */
export const writeRegion = (canvas: SkCanvas, buffer: Uint8Array, region: SmudgeRegion, paint: SkPaint): void => {
  const info = { width: region.w, height: region.h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  const data = Skia.Data.fromBytes(buffer);
  const image = Skia.Image.MakeImage(info, data, region.w * 4);
  if (!image) {
    data.dispose?.();
    return;
  }
  const prevBlend = BlendMode.Src;
  paint.setBlendMode(prevBlend);
  paint.setAlphaf(1);
  const src = Skia.XYWHRect(0, 0, region.w, region.h);
  const dst = Skia.XYWHRect(region.x, region.y, region.w, region.h);
  canvas.drawImageRect(image, src, dst, paint);
  image.dispose?.();
  data.dispose?.();
};

/**
 * Write just a sub-rectangle of a region's buffer back onto the canvas. `buffer` is the full
 * region (region.w*region.h*4); `rect` is in absolute device px and is clamped to the region.
 * Used by the live path to upload only the pixels a frame actually changed.
 */
export const writeSubRegion = (
  canvas: SkCanvas,
  buffer: Uint8Array,
  region: SmudgeRegion,
  rect: SmudgeRegion,
  paint: SkPaint
): void => {
  // Clamp rect to the region bounds.
  const rx = Math.max(region.x, Math.floor(rect.x));
  const ry = Math.max(region.y, Math.floor(rect.y));
  const rright = Math.min(region.x + region.w, Math.ceil(rect.x + rect.w));
  const rbottom = Math.min(region.y + region.h, Math.ceil(rect.y + rect.h));
  const w = rright - rx;
  const h = rbottom - ry;
  if (w <= 0 || h <= 0) {
    return;
  }
  // Extract the sub-rect rows into a tight buffer.
  const sub = new Uint8Array(w * h * 4);
  const offX = rx - region.x;
  const offY = ry - region.y;
  for (let row = 0; row < h; row += 1) {
    const srcStart = (((offY + row) * region.w + offX) << 2);
    sub.set(buffer.subarray(srcStart, srcStart + (w << 2)), (row * w) << 2);
  }
  writeRegion(canvas, sub, { x: rx, y: ry, w, h }, paint);
};
