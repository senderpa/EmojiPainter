import type { VectorCameraState, VectorStroke } from './vectorTypes';

/**
 * Skia uses float-backed coordinates. Rebase into viewport coordinates before
 * either the camera matrix or a projected stamp grows large enough to lose
 * visible-pixel precision.
 */
// Keep world camera matrices deliberately conservative. Skia can represent
// larger values, but intermediate pinch frames can combine them with a very
// distant camera center and overflow native float-backed transforms.
export const SCREEN_SPACE_REBASE_ZOOM = 256;
export const SCREEN_SPACE_REBASE_STAMP_PX = 4096;
/** Rebase when the world origin would be a large float-backed screen offset. */
export const SCREEN_SPACE_REBASE_TRANSLATION_PX = 65_536;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface StampViewportIntersection {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  /** Unrotated source-space fractions for exact image cropping. */
  sourceLeft: number;
  sourceTop: number;
  sourceRight: number;
  sourceBottom: number;
}

export function projectWorldPoint(
  x: number,
  y: number,
  camera: VectorCameraState,
  viewportWidth: number,
  viewportHeight: number,
): ScreenPoint {
  return {
    x: viewportWidth / 2 + (x - camera.cx) * camera.zoom,
    y: viewportHeight / 2 + (y - camera.cy) * camera.zoom,
  };
}

export function projectedStampSize(worldSize: number, zoom: number): number {
  const projected = worldSize * zoom;
  return Number.isFinite(projected) && projected > 0 ? projected : 0;
}

/** True when the camera itself must bypass a world-space Skia matrix. */
export function cameraNeedsScreenSpaceProjection(
  camera: VectorCameraState,
): boolean {
  const zoom = camera.zoom;
  if (!Number.isFinite(zoom) || zoom <= 0) return true;
  const originOffsetX = Math.abs(camera.cx) * zoom;
  const originOffsetY = Math.abs(camera.cy) * zoom;
  return (
    zoom > SCREEN_SPACE_REBASE_ZOOM ||
    zoom < 1 / SCREEN_SPACE_REBASE_ZOOM ||
    !Number.isFinite(originOffsetX) ||
    !Number.isFinite(originOffsetY) ||
    originOffsetX > SCREEN_SPACE_REBASE_TRANSLATION_PX ||
    originOffsetY > SCREEN_SPACE_REBASE_TRANSLATION_PX
  );
}

export function shouldUseScreenSpaceProjection(
  worldSize: number,
  camera: VectorCameraState,
): boolean {
  const zoom = camera.zoom;
  return (
    cameraNeedsScreenSpaceProjection(camera) ||
    projectedStampSize(worldSize, zoom) > SCREEN_SPACE_REBASE_STAMP_PX
  );
}

function rotationExtentFactor(rotationDegrees: number): number {
  const radians = ((Number.isFinite(rotationDegrees) ? rotationDegrees : 0) * Math.PI) / 180;
  return Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians));
}

/**
 * Conservative world culling. Most documents store stamp-padded worldBounds,
 * but early/single-tap strokes stored centre-only bounds. Padding by the full
 * rotated half-size here keeps both formats visible; the screen-space pass
 * performs the exact per-stamp rejection.
 */
export function strokeIntersectsWorldRect(
  stroke: VectorStroke,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  const half = Math.max(0, stroke.worldSize) / 2;
  const pad = half * rotationExtentFactor(stroke.rotationDegrees);
  return !(
    stroke.worldBounds.maxX + pad < rect.minX ||
    stroke.worldBounds.minX - pad > rect.maxX ||
    stroke.worldBounds.maxY + pad < rect.minY ||
    stroke.worldBounds.minY - pad > rect.maxY
  );
}

/**
 * Intersect the actual projected stamp with the viewport. The old renderer
 * capped `projectedSize` before this test, which made a still-visible giant
 * stamp disappear as soon as its centre moved beyond the artificial cap.
 */
export function intersectStampWithViewport(
  centerX: number,
  centerY: number,
  projectedSize: number,
  viewportWidth: number,
  viewportHeight: number,
  rotationDegrees = 0,
): StampViewportIntersection | null {
  if (
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY) ||
    !Number.isFinite(projectedSize) ||
    projectedSize <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return null;
  }

  const half = projectedSize / 2;
  const rotatedHalf = half * rotationExtentFactor(rotationDegrees);
  if (
    centerX + rotatedHalf < 0 ||
    centerX - rotatedHalf > viewportWidth ||
    centerY + rotatedHalf < 0 ||
    centerY - rotatedHalf > viewportHeight
  ) {
    return null;
  }

  const stampLeft = centerX - half;
  const stampTop = centerY - half;
  const stampRight = centerX + half;
  const stampBottom = centerY + half;
  const left = Math.max(0, stampLeft);
  const top = Math.max(0, stampTop);
  const right = Math.min(viewportWidth, stampRight);
  const bottom = Math.min(viewportHeight, stampBottom);

  // A rotated corner can intersect while the unrotated square does not. It
  // still needs rendering, but exact axis-aligned source cropping is not valid.
  if (right <= left || bottom <= top) {
    return {
      left: 0,
      top: 0,
      right: viewportWidth,
      bottom: viewportHeight,
      width: viewportWidth,
      height: viewportHeight,
      sourceLeft: 0,
      sourceTop: 0,
      sourceRight: 1,
      sourceBottom: 1,
    };
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    sourceLeft: Math.max(0, Math.min(1, (left - stampLeft) / projectedSize)),
    sourceTop: Math.max(0, Math.min(1, (top - stampTop) / projectedSize)),
    sourceRight: Math.max(0, Math.min(1, (right - stampLeft) / projectedSize)),
    sourceBottom: Math.max(0, Math.min(1, (bottom - stampTop) / projectedSize)),
  };
}
