/**
 * tileMath — pure geometry for the tile-based paint engine.
 *
 * The canvas (in DEVICE pixels) is divided into a fixed grid of square tiles. A stroke only touches
 * the tiles its bounding rect overlaps, so live painting and undo cost depends on brush footprint,
 * not on total stroke count. This module is intentionally pure (no Skia / RN) so it is fully
 * unit-testable; the rendering layer consumes these coordinates.
 */

export interface TileCoord {
  col: number;
  row: number;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileGridConfig {
  /** Canvas width in device pixels. */
  widthPx: number;
  /** Canvas height in device pixels. */
  heightPx: number;
  /** Tile edge length in device pixels (e.g. 512). */
  tileSizePx: number;
}

/** Default tile edge in device pixels. 512 → 36 tiles on a 3× 1024² canvas (3072²). */
export const DEFAULT_TILE_SIZE_PX = 512;

/** Stable string key for a tile coordinate (for Maps/Sets). */
export const tileKey = (col: number, row: number): string => `${col},${row}`;

/** Parse a tileKey back into a coordinate. */
export const parseTileKey = (key: string): TileCoord => {
  const comma = key.indexOf(',');
  return { col: Number(key.slice(0, comma)), row: Number(key.slice(comma + 1)) };
};

const sanitizeConfig = (cfg: TileGridConfig): TileGridConfig => ({
  widthPx: Math.max(1, Math.floor(cfg.widthPx)),
  heightPx: Math.max(1, Math.floor(cfg.heightPx)),
  tileSizePx: Math.max(1, Math.floor(cfg.tileSizePx))
});

/** Number of tile columns/rows covering the canvas (last tiles may be partial). */
export const gridDims = (cfg: TileGridConfig): { cols: number; rows: number } => {
  const { widthPx, heightPx, tileSizePx } = sanitizeConfig(cfg);
  return {
    cols: Math.max(1, Math.ceil(widthPx / tileSizePx)),
    rows: Math.max(1, Math.ceil(heightPx / tileSizePx))
  };
};

/** Total tile count for the grid. */
export const tileCount = (cfg: TileGridConfig): number => {
  const { cols, rows } = gridDims(cfg);
  return cols * rows;
};

/** The device-pixel rect a tile occupies, clamped to the canvas (so edge tiles are partial). */
export const tileRect = (col: number, row: number, cfg: TileGridConfig): PixelRect => {
  const { widthPx, heightPx, tileSizePx } = sanitizeConfig(cfg);
  const x = col * tileSizePx;
  const y = row * tileSizePx;
  const w = Math.min(tileSizePx, widthPx - x);
  const h = Math.min(tileSizePx, heightPx - y);
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
};

/** Clamp a value to [min, max]. */
const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

/**
 * Tiles overlapped by a pixel rect, clamped to the grid. Returns an empty array if the rect has no
 * area or lies fully outside the canvas. Order is row-major (stable, for deterministic tests).
 */
export const rectToTiles = (rect: PixelRect, cfg: TileGridConfig): TileCoord[] => {
  const { widthPx, heightPx, tileSizePx } = sanitizeConfig(cfg);
  if (rect.w <= 0 || rect.h <= 0) {
    return [];
  }
  // Intersect the rect with the canvas bounds first.
  const left = clamp(rect.x, 0, widthPx);
  const top = clamp(rect.y, 0, heightPx);
  const right = clamp(rect.x + rect.w, 0, widthPx);
  const bottom = clamp(rect.y + rect.h, 0, heightPx);
  if (right <= left || bottom <= top) {
    return [];
  }
  const { cols, rows } = gridDims(cfg);
  const colStart = clamp(Math.floor(left / tileSizePx), 0, cols - 1);
  // right/bottom are exclusive edges → use (edge - 1) so a rect ending exactly on a tile boundary
  // does not pull in the next (untouched) tile.
  const colEnd = clamp(Math.floor((right - 1) / tileSizePx), 0, cols - 1);
  const rowStart = clamp(Math.floor(top / tileSizePx), 0, rows - 1);
  const rowEnd = clamp(Math.floor((bottom - 1) / tileSizePx), 0, rows - 1);

  const result: TileCoord[] = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      result.push({ col, row });
    }
  }
  return result;
};

/** Axis-aligned bounding rect (device px) of a set of points, expanded by `pad` on every side. */
export const pointsBounds = (
  points: ReadonlyArray<{ x: number; y: number }>,
  pad: number
): PixelRect | null => {
  if (points.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
};

/** Union of two rects. */
export const unionRect = (a: PixelRect, b: PixelRect): PixelRect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
};
