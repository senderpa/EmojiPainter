import {
  DEFAULT_TILE_SIZE_PX,
  gridDims,
  parseTileKey,
  pointsBounds,
  rectToTiles,
  tileCount,
  tileKey,
  tileRect,
  unionRect,
  type TileGridConfig
} from '../tileMath';

const CFG: TileGridConfig = { widthPx: 3072, heightPx: 3072, tileSizePx: 512 };

describe('tileMath: grid dimensions', () => {
  it('computes cols/rows for an exact multiple', () => {
    expect(gridDims(CFG)).toEqual({ cols: 6, rows: 6 });
    expect(tileCount(CFG)).toBe(36);
  });

  it('rounds up for a partial last tile', () => {
    expect(gridDims({ widthPx: 1000, heightPx: 700, tileSizePx: 512 })).toEqual({ cols: 2, rows: 2 });
  });

  it('never returns fewer than 1 col/row', () => {
    expect(gridDims({ widthPx: 0, heightPx: 0, tileSizePx: 512 })).toEqual({ cols: 1, rows: 1 });
  });

  it('exposes a sane default tile size', () => {
    expect(DEFAULT_TILE_SIZE_PX).toBe(512);
  });
});

describe('tileMath: tile keys', () => {
  it('round-trips a key', () => {
    expect(parseTileKey(tileKey(3, 5))).toEqual({ col: 3, row: 5 });
  });
});

describe('tileMath: tileRect clamps edge tiles', () => {
  it('returns full size for an interior tile', () => {
    expect(tileRect(0, 0, CFG)).toEqual({ x: 0, y: 0, w: 512, h: 512 });
  });

  it('clamps a partial edge tile to the canvas', () => {
    const cfg = { widthPx: 1000, heightPx: 1000, tileSizePx: 512 };
    expect(tileRect(1, 1, cfg)).toEqual({ x: 512, y: 512, w: 488, h: 488 });
  });
});

describe('tileMath: rectToTiles', () => {
  it('maps a small rect to a single tile', () => {
    expect(rectToTiles({ x: 10, y: 10, w: 20, h: 20 }, CFG)).toEqual([{ col: 0, row: 0 }]);
  });

  it('returns empty for zero-area rects', () => {
    expect(rectToTiles({ x: 0, y: 0, w: 0, h: 10 }, CFG)).toEqual([]);
    expect(rectToTiles({ x: 0, y: 0, w: 10, h: -5 }, CFG)).toEqual([]);
  });

  it('returns empty for a rect fully outside the canvas', () => {
    expect(rectToTiles({ x: 5000, y: 5000, w: 100, h: 100 }, CFG)).toEqual([]);
    expect(rectToTiles({ x: -200, y: -200, w: 100, h: 100 }, CFG)).toEqual([]);
  });

  it('does NOT pull in the next tile when the rect ends exactly on a boundary', () => {
    // rect [0,512) stays in column 0 only
    expect(rectToTiles({ x: 0, y: 0, w: 512, h: 1 }, CFG)).toEqual([{ col: 0, row: 0 }]);
  });

  it('includes the next tile when the rect crosses a boundary by 1px', () => {
    const tiles = rectToTiles({ x: 0, y: 0, w: 513, h: 1 }, CFG);
    expect(tiles).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 }
    ]);
  });

  it('spans a 2x2 block in row-major order', () => {
    const tiles = rectToTiles({ x: 400, y: 400, w: 300, h: 300 }, CFG);
    expect(tiles).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 }
    ]);
  });

  it('clamps a rect that overhangs the canvas edge', () => {
    const cfg = { widthPx: 1024, heightPx: 1024, tileSizePx: 512 };
    // overhangs right/bottom but should clamp to the 2x2 grid, last touched tile (1,1)
    const tiles = rectToTiles({ x: 900, y: 900, w: 500, h: 500 }, cfg);
    expect(tiles).toEqual([{ col: 1, row: 1 }]);
  });
});

describe('tileMath: pointsBounds + unionRect', () => {
  it('returns null for no points', () => {
    expect(pointsBounds([], 5)).toBeNull();
  });

  it('bounds points with padding', () => {
    expect(pointsBounds([{ x: 10, y: 20 }, { x: 30, y: 40 }], 5)).toEqual({ x: 5, y: 15, w: 30, h: 30 });
  });

  it('unions two rects', () => {
    expect(unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 20, h: 20 })).toEqual({
      x: 0,
      y: 0,
      w: 25,
      h: 25
    });
  });
});
