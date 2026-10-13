import type { VectorEmojiPlane, VectorStroke } from './vectorTypes';
import { isCustomBrushReference } from '../lib/customBrushRegistry';

export function vectorPlanePoints(plane: VectorEmojiPlane): { x: number; y: number }[] {
  return plane.lattice && plane.lattice.length > 0
    ? plane.lattice
    : [plane.corners.topLeft, plane.corners.topRight, plane.corners.bottomRight, plane.corners.bottomLeft];
}

export function vectorPlaneCenter(plane: VectorEmojiPlane): { x: number; y: number } {
  const points = vectorPlanePoints(plane);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length),
    y: points.reduce((sum, point) => sum + point.y, 0) / Math.max(1, points.length),
  };
}

export function vectorPlaneWorldBounds(plane: VectorEmojiPlane) {
  const points = vectorPlanePoints(plane);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** Commit without resampling: the renderer receives the exact preview coordinates. */
export function vectorPlaneToStroke(plane: VectorEmojiPlane, committedAt = Date.now()): VectorStroke {
  const bounds = vectorPlaneWorldBounds(plane);
  const center = vectorPlaneCenter(plane);
  const worldSize = Math.max(1e-12, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return {
    strokeID: plane.id.replace(/^plane-/, 'plane-stroke-'),
    emoji: plane.emoji,
    worldSize,
    screenSizeAtCreation: worldSize,
    widthMode: 'worldConstant',
    opacity: plane.visible === false ? 0 : plane.opacity,
    spacingRatio: 1,
    rotationDegrees: 0,
    startedAtMilliseconds: plane.timestamp,
    endedAtMilliseconds: Math.max(0, committedAt - plane.timestamp),
    samples: [{ x: center.x, y: center.y, timeMilliseconds: 0 }],
    worldBounds: bounds,
    stampPositions: [{ x: center.x, y: center.y }],
    isPlane: true,
    planeCorners: {
      topLeft: { ...plane.corners.topLeft },
      topRight: { ...plane.corners.topRight },
      bottomRight: { ...plane.corners.bottomRight },
      bottomLeft: { ...plane.corners.bottomLeft },
    },
    ...(plane.lattice && (plane.latticeLevel ?? 1) > 1
      ? {
          planeLattice: plane.lattice.map((point) => ({ ...point })),
          planeLatticeLevel: plane.latticeLevel,
        }
      : {}),
    planeStampSize: isCustomBrushReference(plane.emoji) || plane.emoji.startsWith('data:image/png;base64,') ? 90 : 128,
  };
}
