import { MAX_ZOOM, MIN_ZOOM, VectorCameraState } from './vectorTypes';

/** Shift the document origin before double precision becomes screen-visible. */
export const WORLD_ORIGIN_REBASE_SCREEN_PX = 1_000_000_000_000;

// Focal-point camera math from the handoff (IOS_VECTOR_ARCHITECTURE.md §Camera):
//   world(s) = w + (s - c) / z
// Zoom around a screen focal point keeps the world anchor pinned under the finger
// across many orders of magnitude. Zoom interpolation is done in log space.

export function clampZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Preserve a selected screen-space brush size exactly in world coordinates. */
export function worldSizeForScreenBrush(screenSize: number, zoom: number): number {
  const safeScreenSize = Number.isFinite(screenSize) && screenSize > 0 ? screenSize : 1;
  return safeScreenSize / clampZoom(zoom);
}

/**
 * A local floating origin keeps distant painting coordinates small. This is
 * translation-only: subtracting the returned offset from the camera, strokes,
 * viewpoints, and trace image leaves every projected screen point unchanged.
 */
export function worldOriginRebaseOffset(
  camera: VectorCameraState,
): { x: number; y: number } | null {
  if (!Number.isFinite(camera.cx) || !Number.isFinite(camera.cy)) return null;
  const zoom = clampZoom(camera.zoom);
  const offsetXpx = Math.abs(camera.cx) * zoom;
  const offsetYpx = Math.abs(camera.cy) * zoom;
  if (
    offsetXpx < WORLD_ORIGIN_REBASE_SCREEN_PX &&
    offsetYpx < WORLD_ORIGIN_REBASE_SCREEN_PX
  ) {
    return null;
  }
  return { x: camera.cx, y: camera.cy };
}

/** Any camera that reaches state must be finite — NaN/Infinity blanks the canvas. */
export function sanitizeCamera(camera: VectorCameraState, fallback: VectorCameraState): VectorCameraState {
  const zoom = clampZoom(camera.zoom);
  const cx = Number.isFinite(camera.cx) ? camera.cx : fallback.cx;
  const cy = Number.isFinite(camera.cy) ? camera.cy : fallback.cy;
  return { cx, cy, zoom };
}


export function screenToWorld(
  camera: VectorCameraState,
  sx: number,
  sy: number,
  viewportW: number,
  viewportH: number
): { x: number; y: number } {
  return {
    x: camera.cx + (sx - viewportW / 2) / camera.zoom,
    y: camera.cy + (sy - viewportH / 2) / camera.zoom,
  };
}

export function worldToScreen(
  camera: VectorCameraState,
  wx: number,
  wy: number,
  viewportW: number,
  viewportH: number
): { x: number; y: number } {
  return {
    x: (wx - camera.cx) * camera.zoom + viewportW / 2,
    y: (wy - camera.cy) * camera.zoom + viewportH / 2,
  };
}

/** Pinch around screen focal point `f`: anchor stays under the finger. */
export function zoomAroundFocal(
  camera: VectorCameraState,
  pinchScale: number,
  fx: number,
  fy: number,
  viewportW: number,
  viewportH: number
): VectorCameraState {
  const scale = Number.isFinite(pinchScale) && pinchScale > 0 ? pinchScale : 1;
  const anchor = screenToWorld(camera, fx, fy, viewportW, viewportH);
  const z1 = clampZoom(camera.zoom * scale);
  return sanitizeCamera(
    {
      cx: anchor.x - (fx - viewportW / 2) / z1,
      cy: anchor.y - (fy - viewportH / 2) / z1,
      zoom: z1,
    },
    camera
  );
}

export function panCamera(camera: VectorCameraState, dxScreen: number, dyScreen: number): VectorCameraState {
  const zoom = clampZoom(camera.zoom);
  return sanitizeCamera(
    {
      cx: camera.cx - dxScreen / zoom,
      cy: camera.cy - dyScreen / zoom,
      zoom,
    },
    camera
  );
}

/** Log-space zoom interpolation (for viewpoint flythroughs later). */
export function interpolateZoomLog(z0: number, z1: number, t: number): number {
  return clampZoom(Math.exp(Math.log(clampZoom(z0)) * (1 - t) + Math.log(clampZoom(z1)) * t));
}

export function visibleWorldRect(
  camera: VectorCameraState,
  viewportW: number,
  viewportH: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  const halfW = viewportW / 2 / camera.zoom;
  const halfH = viewportH / 2 / camera.zoom;
  return {
    minX: camera.cx - halfW,
    minY: camera.cy - halfH,
    maxX: camera.cx + halfW,
    maxY: camera.cy + halfH,
  };
}
