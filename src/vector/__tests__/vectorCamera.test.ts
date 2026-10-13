import {
  clampZoom,
  panCamera,
  sanitizeCamera,
  screenToWorld,
  worldOriginRebaseOffset,
  worldSizeForScreenBrush,
  worldToScreen,
  zoomAroundFocal,
} from '../vectorCamera';
import { MAX_ZOOM, MIN_ZOOM } from '../vectorTypes';

const VIEW_W = 1024;
const VIEW_H = 768;

describe('vector camera at extreme zoom', () => {
  it('clamps zoom to the supported range and rejects garbage', () => {
    expect(clampZoom(0)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1e30)).toBe(MAX_ZOOM);
    expect(clampZoom(1e-30)).toBe(MIN_ZOOM);
  });

  it('keeps the pinch anchor under the finger across many octaves', () => {
    let camera = { cx: 12345.678, cy: -98765.432, zoom: 1 };
    const fx = 300;
    const fy = 500;
    const anchor = screenToWorld(camera, fx, fy, VIEW_W, VIEW_H);
    for (let i = 0; i < 60; i += 1) {
      camera = zoomAroundFocal(camera, 1.5, fx, fy, VIEW_W, VIEW_H);
      const stillThere = screenToWorld(camera, fx, fy, VIEW_W, VIEW_H);
      // Error must stay far below one screen pixel at the current zoom.
      expect(Math.abs(stillThere.x - anchor.x) * camera.zoom).toBeLessThan(0.5);
      expect(Math.abs(stillThere.y - anchor.y) * camera.zoom).toBeLessThan(0.5);
    }
    expect(camera.zoom).toBe(MAX_ZOOM);
  });

  it('never shrinks the selected brush when creating a stroke at an extreme zoom', () => {
    for (const zoom of [MIN_ZOOM, 1, MAX_ZOOM]) {
      const worldSize = worldSizeForScreenBrush(64, zoom);
      expect(worldSize * zoom).toBeCloseTo(64, 10);
    }
  });

  it('rebases a distant origin before precision loss becomes visible', () => {
    expect(worldOriginRebaseOffset({ cx: 1e12, cy: 0, zoom: MIN_ZOOM })).toBeNull();
    const camera = { cx: 1e12, cy: -2e12, zoom: 1 };
    const offset = worldOriginRebaseOffset(camera);
    expect(offset).toEqual({ x: camera.cx, y: camera.cy });

    const point = { x: camera.cx + 12_345, y: camera.cy - 54_321 };
    const before = worldToScreen(camera, point.x, point.y, VIEW_W, VIEW_H);
    const after = worldToScreen(
      { cx: camera.cx - offset!.x, cy: camera.cy - offset!.y, zoom: camera.zoom },
      point.x - offset!.x,
      point.y - offset!.y,
      VIEW_W,
      VIEW_H,
    );
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it('never produces a non-finite camera', () => {
    expect(panCamera({ cx: 0, cy: 0, zoom: 0 }, 10, 10).zoom).toBe(1);
    expect(sanitizeCamera({ cx: Number.NaN, cy: 5, zoom: Number.NaN }, { cx: 1, cy: 2, zoom: 3 })).toEqual({
      cx: 1,
      cy: 5,
      zoom: 1,
    });
    const zoomed = zoomAroundFocal({ cx: 0, cy: 0, zoom: 1 }, Number.NaN, 10, 10, VIEW_W, VIEW_H);
    expect(Number.isFinite(zoomed.cx)).toBe(true);
    expect(Number.isFinite(zoomed.cy)).toBe(true);
    expect(zoomed.zoom).toBe(1);
  });
});
