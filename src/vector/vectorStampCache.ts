import { PixelRatio } from 'react-native';
import { Skia } from '@shopify/react-native-skia';
import { makeEmojiStamp, StampEntry } from '../components/EmojiCanvas';
import { measureStampInkBounds } from '../lib/stampInkBounds';

const DPR = PixelRatio.get();

// Vector Mode's camera zooms continuously (1e-9…1e9), so a raw requested
// stamp size is near-unique on every frame. Bucketing every request to a
// small set of power-of-two device-px sizes keeps this cache's cardinality
// bounded (~8 buckets per emoji). Vector Mode used to share EmojiCanvas's
// stamp cache (capped at 20 entries, sized for the flat paint canvas's
// discrete slider sizes) — under continuous zoom that cache evicted and
// disposed native SkImages still referenced by cached per-stroke SkPictures,
// which is what produced the "rendering glitches after ~20 zooms" regression.
const MIN_BUCKET_PX = 8;
// 1024px was a visible quality cliff when a user zoomed back into a stroke:
// every larger projected stamp was merely an enlarged 1024px bitmap. Keep a
// higher ceiling while the LRU below still bounds the native image footprint.
const MAX_BUCKET_PX = 2048;
const MAX_VECTOR_STAMP_CACHE_SIZE = 160;
const MAX_VECTOR_STAMP_CACHE_BYTES = 64 * 1024 * 1024;

function bucketPxFor(sizeDip: number): number {
  const px = Math.max(1, sizeDip * DPR);
  const bucket = Math.pow(2, Math.ceil(Math.log2(px)));
  return Math.min(MAX_BUCKET_PX, Math.max(MIN_BUCKET_PX, bucket));
}

const cache = new Map<string, StampEntry>();
const order: string[] = [];
let cacheBytes = 0;
// A SkPicture can retain an image after its cache entry is evicted. Disposing
// the image at eviction time leaves that picture with a dangling native
// reference and can terminate the app during a fly-through. Retired images
// are kept until the Vector canvas has had time to release its pictures.
const retiredImages = new Set<StampEntry['image']>();
const imageReferences = new Map<StampEntry['image'], number>();

function scheduleRetiredImageDisposal(image: StampEntry['image']): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!retiredImages.has(image) || (imageReferences.get(image) ?? 0) > 0) return;
    retiredImages.delete(image);
    imageReferences.delete(image);
    image.dispose?.();
  }));
}

function disposeRetiredImagesLater(images: Iterable<StampEntry['image']>): void {
  for (const image of images) {
    retiredImages.add(image);
    scheduleRetiredImageDisposal(image);
  }
}

/** A recorded SkPicture owns a reference until it has been disposed. */
export function retainVectorStamp(image: StampEntry['image']): void {
  imageReferences.set(image, (imageReferences.get(image) ?? 0) + 1);
}

/** Release the reference held by one recorded SkPicture. */
export function releaseVectorStamp(image: StampEntry['image']): void {
  const next = Math.max(0, (imageReferences.get(image) ?? 0) - 1);
  if (next === 0) {
    imageReferences.delete(image);
    if (retiredImages.has(image)) scheduleRetiredImageDisposal(image);
  } else {
    imageReferences.set(image, next);
  }
}

function touch(key: string): void {
  const idx = order.indexOf(key);
  if (idx >= 0 && idx !== order.length - 1) {
    order.splice(idx, 1);
    order.push(key);
  }
}

/** Bucketed, Vector-Mode-owned stamp cache — see file header for why this exists. */
export function getVectorStamp(emoji: string, sizeDip: number): StampEntry | null {
  const bucketPx = bucketPxFor(sizeDip);
  const key = `${emoji}::${bucketPx}`;
  const cached = cache.get(key);
  if (cached) {
    touch(key);
    return cached;
  }

  const image = makeEmojiStamp(emoji, bucketPx);
  if (!image) return null;

  const widthPx = image.width();
  const heightPx = image.height();
  const entry: StampEntry = {
    image,
    srcRect: Skia.XYWHRect(0, 0, widthPx, heightPx),
    widthPx,
    heightPx,
    widthDip: widthPx / DPR,
    heightDip: heightPx / DPR,
    inkBounds: measureStampInkBounds(key, image),
  };
  cache.set(key, entry);
  order.push(key);
  cacheBytes += widthPx * heightPx * 4;
  while (order.length > MAX_VECTOR_STAMP_CACHE_SIZE || cacheBytes > MAX_VECTOR_STAMP_CACHE_BYTES) {
    const stale = order.shift();
    if (!stale) break;
    const staleEntry = cache.get(stale);
    if (staleEntry) {
      cacheBytes = Math.max(0, cacheBytes - staleEntry.widthPx * staleEntry.heightPx * 4);
      disposeRetiredImagesLater([staleEntry.image]);
      cache.delete(stale);
    }
  }
  return entry;
}

export function clearVectorStampCache(): void {
  const images = [...retiredImages, ...[...cache.values()].map((entry) => entry.image)];
  cache.clear();
  order.length = 0;
  cacheBytes = 0;
  disposeRetiredImagesLater(images);
}
