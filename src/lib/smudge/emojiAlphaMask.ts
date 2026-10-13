/**
 * Build hard/soft/edge smudge masks from a rendered emoji stamp's alpha channel.
 *
 * The selected emoji is NOT painted in smudge mode — only its silhouette (alpha) is used as a
 * pressure map: the solid interior (hard) drags pixels, the feathered ring (edge) melts colors,
 * and the full coverage (soft) gates the affected area. Masks are cached per stamp key with the
 * same LRU discipline as the emoji stamp cache.
 *
 * Takes an SkImage so this module does not import EmojiCanvas (avoids a require cycle).
 */

import { AlphaType, ColorType, type SkImage } from '@shopify/react-native-skia';

import type { SmudgeMask } from './smudgeTypes';

const maskCache = new Map<string, SmudgeMask>();
const maskCacheOrder: string[] = [];
const MAX_MASK_CACHE = 16;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Smoothstep contrast curve for the hard (center) mask. */
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / Math.max(1e-4, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Separable box blur of a single-channel field. Returns a new Float32Array. */
const boxBlur = (src: Float32Array, w: number, h: number, radius: number): Float32Array => {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) {
    return src.slice();
  }
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const norm = 1 / (2 * r + 1);
  // Horizontal pass.
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let k = -r; k <= r; k += 1) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        sum += src[row + xx];
      }
      tmp[row + x] = sum * norm;
    }
  }
  // Vertical pass.
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      let sum = 0;
      for (let k = -r; k <= r; k += 1) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        sum += tmp[yy * w + x];
      }
      out[y * w + x] = sum * norm;
    }
  }
  return out;
};

const touchCache = (key: string): void => {
  const idx = maskCacheOrder.indexOf(key);
  if (idx >= 0 && idx !== maskCacheOrder.length - 1) {
    maskCacheOrder.splice(idx, 1);
    maskCacheOrder.push(key);
  }
};

/**
 * Build (or fetch cached) smudge masks for a stamp image. `key` should uniquely identify the
 * emoji + pixel size (e.g. `${emoji}::${px}`). `maskBlurRadiusFactor` is a fraction of the
 * mask's smaller dimension. Returns null if the image alpha cannot be read.
 */
export const getSmudgeMask = (
  key: string,
  image: SkImage,
  maskBlurRadiusFactor: number
): SmudgeMask | null => {
  const cached = maskCache.get(key);
  if (cached) {
    touchCache(key);
    return cached;
  }

  const w = image.width();
  const h = image.height();
  if (w <= 0 || h <= 0) {
    return null;
  }

  const info = { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  const pixels = image.readPixels(0, 0, info) as Uint8Array | Float32Array | null;
  if (!pixels) {
    return null;
  }

  const count = w * h;
  const alpha = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    // readPixels with RGBA_8888 returns bytes 0..255; alpha is the 4th channel.
    alpha[i] = (pixels[(i << 2) + 3] as number) / 255;
  }

  const hard = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    // Contrast-enhanced alpha: sharp solid interior, quick edge falloff.
    hard[i] = clamp01(smoothstep(0.2, 0.8, alpha[i]));
  }

  const blurRadius = Math.max(1, Math.round(Math.min(w, h) * maskBlurRadiusFactor));
  const soft = boxBlur(alpha, w, h, blurRadius);

  const edge = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const v = soft[i] - hard[i];
    edge[i] = v > 0 ? v : 0;
  }

  const mask: SmudgeMask = { hard, soft, edge, w, h };
  maskCache.set(key, mask);
  maskCacheOrder.push(key);
  if (maskCacheOrder.length > MAX_MASK_CACHE) {
    const stale = maskCacheOrder.shift();
    if (stale) {
      maskCache.delete(stale);
    }
  }
  return mask;
};

/** Drop all cached masks (call alongside stamp-cache clears to release memory). */
export const clearSmudgeMaskCache = (): void => {
  maskCache.clear();
  maskCacheOrder.length = 0;
};
