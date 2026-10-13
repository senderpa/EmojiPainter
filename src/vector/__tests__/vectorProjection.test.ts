import {
  cameraNeedsScreenSpaceProjection,
  intersectStampWithViewport,
  projectWorldPoint,
  shouldUseScreenSpaceProjection,
  strokeIntersectsWorldRect,
} from '../vectorProjection';
import type { VectorStroke } from '../vectorTypes';

const stroke: VectorStroke = {
  strokeID: 'projection-test',
  emoji: '🎨',
  worldSize: 64,
  screenSizeAtCreation: 64,
  widthMode: 'worldConstant',
  opacity: 1,
  spacingRatio: 0.12,
  rotationDegrees: 0,
  startedAtMilliseconds: 0,
  endedAtMilliseconds: 1,
  samples: [{ x: 0, y: 0, timeMilliseconds: 0 }],
  worldBounds: { minX: -32, minY: -32, maxX: 32, maxY: 32 },
  stampPositions: [{ x: 0, y: 0 }],
};

describe('vector extreme projection', () => {
  it('rebases before the old eight-doubling failure boundary', () => {
    expect(shouldUseScreenSpaceProjection(64, { cx: 0, cy: 0, zoom: 64 })).toBe(false);
    expect(shouldUseScreenSpaceProjection(64, { cx: 0, cy: 0, zoom: 128 })).toBe(true);
  });

  it('does not cull a huge stamp whose centre is far outside the viewport', () => {
    const hit = intersectStampWithViewport(-100_000, 200, 250_000, 400, 800);
    expect(hit).not.toBeNull();
    expect(hit!.left).toBe(0);
    expect(hit!.right).toBe(400);
    expect(hit!.sourceRight).toBeGreaterThan(hit!.sourceLeft);
  });

  it('stays finite and visible after twenty zoom doublings at a stamp edge', () => {
    const zoom = 2 ** 20;
    const camera = { cx: 31, cy: 0, zoom };
    const center = projectWorldPoint(0, 0, camera, 400, 800);
    const hit = intersectStampWithViewport(center.x, center.y, stroke.worldSize * zoom, 400, 800);
    expect(Number.isFinite(center.x)).toBe(true);
    expect(hit).not.toBeNull();
    expect(hit!.width).toBeGreaterThan(0);
    expect(hit!.height).toBeGreaterThan(0);
  });

  it('stays visible at the maximum supported zoom with finite source fractions', () => {
    const zoom = 1e9;
    const camera = { cx: 31.9999999, cy: 0, zoom };
    const center = projectWorldPoint(0, 0, camera, 400, 800);
    const hit = intersectStampWithViewport(center.x, center.y, stroke.worldSize * zoom, 400, 800);
    expect(hit).not.toBeNull();
    expect(hit!.sourceLeft).toBeGreaterThanOrEqual(0);
    expect(hit!.sourceRight).toBeGreaterThan(hit!.sourceLeft);
    expect(Number.isFinite(hit!.sourceRight)).toBe(true);
  });

  it('uses screen projection for a normal-sized stroke created at huge zoom', () => {
    expect(shouldUseScreenSpaceProjection(64 / 1e9, { cx: 0, cy: 0, zoom: 1e9 })).toBe(true);
    expect(shouldUseScreenSpaceProjection(64 / 1e-9, { cx: 0, cy: 0, zoom: 1e-9 })).toBe(true);
  });

  it('bypasses the world matrix at the reported 3333x crash boundary', () => {
    expect(cameraNeedsScreenSpaceProjection({ cx: 0, cy: 0, zoom: 3333.3 })).toBe(true);
    expect(shouldUseScreenSpaceProjection(0.001, { cx: 0, cy: 0, zoom: 3333.3 })).toBe(true);
  });

  it('rebases distant world coordinates even at ordinary zoom', () => {
    expect(shouldUseScreenSpaceProjection(64, { cx: 1_000_000, cy: 0, zoom: 1 })).toBe(true);
  });

  it('keeps rotated stamp corners in conservative world culling', () => {
    const rotated = { ...stroke, rotationDegrees: 45 };
    expect(strokeIntersectsWorldRect(rotated, {
      minX: 40,
      minY: -1,
      maxX: 41,
      maxY: 1,
    })).toBe(true);
  });

  it('keeps legacy centre-only single-tap bounds visible at the viewport edge', () => {
    const centreOnly = {
      ...stroke,
      worldBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
    expect(strokeIntersectsWorldRect(centreOnly, {
      minX: 31,
      minY: -1,
      maxX: 33,
      maxY: 1,
    })).toBe(true);
  });
});
