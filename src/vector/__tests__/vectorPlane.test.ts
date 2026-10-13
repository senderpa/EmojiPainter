import { latticeFromPlaneCorners } from '../../lib/planeLattice';
import { vectorPlaneToStroke, vectorPlaneWorldBounds } from '../vectorPlane';
import type { VectorEmojiPlane } from '../vectorTypes';

const corners = {
  topLeft: { x: -14.25, y: 8.5 }, topMid: { x: 9.875, y: 5.375 },
  topRight: { x: 34, y: 2.25 }, rightMid: { x: 39.5, y: 31.625 },
  bottomRight: { x: 45, y: 61 }, bottomMid: { x: 12.75, y: 66.5 },
  bottomLeft: { x: -19.5, y: 72 }, leftMid: { x: -16.875, y: 40.25 },
};

function makePlane(): VectorEmojiPlane {
  const lattice = latticeFromPlaneCorners(3, corners);
  lattice[5] = { x: lattice[5].x + 3.125, y: lattice[5].y - 7.75 };
  lattice[10] = { x: lattice[10].x - 1.5, y: lattice[10].y + 6.25 };
  return {
    id: 'plane-proof', emoji: '🏄', corners, lattice, latticeLevel: 3,
    timestamp: 100, cornerHistory: [], opacity: 0.65, rotation: 127, scale: 1.45,
    visible: true, zIndex: 4,
  };
}

describe('Vector 📐 Apply', () => {
  it('copies every preview vertex bit-for-bit without resampling', () => {
    const plane = makePlane();
    const stroke = vectorPlaneToStroke(plane, 250);
    expect(stroke.planeCorners).toEqual({
      topLeft: plane.corners.topLeft, topRight: plane.corners.topRight,
      bottomRight: plane.corners.bottomRight, bottomLeft: plane.corners.bottomLeft,
    });
    expect(stroke.planeLattice).toEqual(plane.lattice);
    expect(stroke.planeLatticeLevel).toBe(3);
    expect(stroke.opacity).toBe(plane.opacity);
  });

  it('uses every distorted lattice point for culling bounds', () => {
    const plane = makePlane();
    expect(vectorPlaneToStroke(plane, 250).worldBounds).toEqual(vectorPlaneWorldBounds(plane));
  });
});
