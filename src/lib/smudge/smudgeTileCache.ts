/**
 * In-memory cache of baked smudge tiles, keyed by stroke id.
 *
 * At commit, a smudge stroke's final pixels (its dirty rect, cropped from the live GPU result) are
 * stored here. Replay / undo / timelapse / export then just BLIT the tile instead of re-running the
 * smudge — deterministic, full-resolution (no pixelation), consistent with the live preview, and
 * cheap (no GPU re-bake → no crashes). LRU-bounded so memory can't grow without limit.
 *
 * Tiles are not persisted: a reloaded saved painting falls back to the CPU smudge once per stroke.
 */

import type { SkImage } from '@shopify/react-native-skia';
import type { SmudgeRegion } from './smudgeTypes';

export interface SmudgeTile {
  image: SkImage;
  bounds: SmudgeRegion; // device px on the canvas
}

const tiles = new Map<string, SmudgeTile>();
const order: string[] = [];
const MAX_TILES = 48;

export const putSmudgeTile = (id: string, image: SkImage, bounds: SmudgeRegion): void => {
  const existing = tiles.get(id);
  if (existing) {
    existing.image.dispose?.();
    const i = order.indexOf(id);
    if (i >= 0) {
      order.splice(i, 1);
    }
  }
  tiles.set(id, { image, bounds });
  order.push(id);
  while (order.length > MAX_TILES) {
    const stale = order.shift();
    if (stale) {
      tiles.get(stale)?.image.dispose?.();
      tiles.delete(stale);
    }
  }
};

export const getSmudgeTile = (id: string): SmudgeTile | null => {
  const tile = tiles.get(id);
  if (tile) {
    // Touch for LRU.
    const i = order.indexOf(id);
    if (i >= 0 && i !== order.length - 1) {
      order.splice(i, 1);
      order.push(id);
    }
  }
  return tile ?? null;
};

export const clearSmudgeTiles = (): void => {
  tiles.forEach((t) => t.image.dispose?.());
  tiles.clear();
  order.length = 0;
};
