import type { EmojiPlane } from '../../state/PaintingContext';
import {
  latticeFromCorners, resampleLattice, sampleLattice, findLatticeHandle,
  latticeSide, latticeCount, latticeCorners, latticeFromPlaneCorners, projectPlanePoint,
  movePlaneHandle, rotatePlaneGeometry, scalePlaneGeometry, translatePlaneGeometry,
  LATTICE_LEVELS, type LatticeLevel,
} from '../planeLattice';

/** Unit square projector — stands in for the renderer's homography. */
const unit = (u: number, v: number) => ({ x: u * 100, y: v * 100 });

const makePlane = (): EmojiPlane => ({
  id: 'plane-test',
  emoji: '📐',
  corners: {
    topLeft: { x: 0, y: 0 },
    topMid: { x: 50, y: 0 },
    topRight: { x: 100, y: 0 },
    rightMid: { x: 100, y: 50 },
    bottomRight: { x: 100, y: 100 },
    bottomMid: { x: 50, y: 100 },
    bottomLeft: { x: 0, y: 100 },
    leftMid: { x: 0, y: 50 },
  },
  lattice: latticeFromCorners(2, unit),
  latticeLevel: 2,
  timestamp: 1,
  cornerHistory: [],
  opacity: 1,
  zIndex: 0,
});

describe('planeLattice', () => {
  test('offered levels expose the expected handle counts', () => {
    expect(LATTICE_LEVELS.map((l) => l.points)).toEqual([4, 9, 16]);
    for (const { level, points } of LATTICE_LEVELS) {
      expect(latticeCount(level)).toBe(points);
    }
  });

  test('level 1 is exactly the four corners', () => {
    const pts = latticeFromCorners(1, unit);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[3]).toEqual({ x: 100, y: 100 });
  });

  test('sampling an undistorted lattice reproduces the projector', () => {
    for (const { level } of LATTICE_LEVELS) {
      const pts = latticeFromCorners(level, unit);
      for (const [u, v] of [[0, 0], [0.5, 0.5], [1, 1], [0.25, 0.75]]) {
        const got = sampleLattice(pts, level, u, v);
        expect(got.x).toBeCloseTo(u * 100, 4);
        expect(got.y).toBeCloseTo(v * 100, 4);
      }
    }
  });

  test('switching a trapezoid to extra handles preserves its projective shape', () => {
    const corners = {
      topLeft: { x: 20, y: 0 },
      topRight: { x: 80, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    };
    const points = latticeFromPlaneCorners(2, corners);
    const projectedCentre = projectPlanePoint(corners, 0.5, 0.5);
    expect(projectedCentre.x).toBeCloseTo(50, 6);
    expect(projectedCentre.y).toBeCloseTo(37.5, 6);
    expect(points[4].x).toBeCloseTo(projectedCentre.x, 6);
    expect(points[4].y).toBeCloseTo(projectedCentre.y, 6);
    // A trapezoid's projective centre is not its bilinear midpoint (y=50 here).
    expect(projectedCentre.y).not.toBeCloseTo(50, 3);
  });

  test('a dragged handle lands exactly under the finger', () => {
    const level: LatticeLevel = 2;
    const pts = latticeFromCorners(level, unit);
    const centre = latticeSide(level) * 1 + 1; // row 1, col 1
    pts[centre] = { x: 80, y: 20 };
    // The centre of the surface is that handle's own parameter position.
    expect(sampleLattice(pts, level, 0.5, 0.5)).toEqual({ x: 80, y: 20 });
  });

  test('resampling to a finer level preserves the current shape', () => {
    const pts = latticeFromCorners(2, unit);
    pts[4] = { x: 90, y: 10 }; // pull the middle far out
    const finer = resampleLattice(pts, 2, 3);
    expect(finer).toHaveLength(16);
    // A point that exists in both lattices must not move.
    const coarse = sampleLattice(pts, 2, 1 / 3, 1 / 3);
    const fine = sampleLattice(finer, 3, 1 / 3, 1 / 3);
    expect(fine.x).toBeCloseTo(coarse.x, 4);
    expect(fine.y).toBeCloseTo(coarse.y, 4);
  });

  test('resampling round-trips back to the same corners', () => {
    const pts = latticeFromCorners(1, unit);
    const back = resampleLattice(resampleLattice(pts, 1, 5), 5, 1);
    expect(back[0].x).toBeCloseTo(0, 4);
    expect(back[3].x).toBeCloseTo(100, 4);
  });

  test('handle hit-testing respects the radius', () => {
    const pts = latticeFromCorners(1, unit);
    expect(findLatticeHandle(pts, 2, 2, 10)).toBe(0);
    expect(findLatticeHandle(pts, 50, 50, 10)).toBeNull();
  });

  test('legacy 4-corner shape can still be derived from any level', () => {
    const corners = latticeCorners(latticeFromCorners(3, unit), 3);
    expect(corners.topLeft).toEqual({ x: 0, y: 0 });
    expect(corners.bottomRight).toEqual({ x: 100, y: 100 });
    expect(corners.topMid).toEqual({ x: 50, y: 0 });
  });

  test('dragging an extra handle updates the lattice and keeps legacy corners synchronized', () => {
    const original = makePlane();
    const moved = movePlaneHandle(original, 'lattice:4', 82, 19);
    expect(moved.lattice?.[4]).toEqual({ x: 82, y: 19 });
    expect(sampleLattice(moved.lattice!, 2, 0.5, 0.5)).toEqual({ x: 82, y: 19 });
    expect(moved.corners.topLeft).toEqual({ x: 0, y: 0 });
    expect(moved.corners.bottomRight).toEqual({ x: 100, y: 100 });
    expect(original.lattice?.[4]).toEqual({ x: 50, y: 50 });
  });

  test('translation and pinch scaling transform every extra handle with the plane', () => {
    const bent = movePlaneHandle(makePlane(), 'lattice:4', 82, 19);
    const translated = translatePlaneGeometry(bent, 12, -7);
    expect(translated.lattice?.[4]).toEqual({ x: 94, y: 12 });
    expect(translated.corners.topLeft).toEqual({ x: 12, y: -7 });
    expect(bent.lattice?.[4]).toEqual({ x: 82, y: 19 });

    const scaled = scalePlaneGeometry(translated, { x: 62, y: 43 }, 2);
    expect(scaled.lattice?.[4]).toEqual({ x: 126, y: -19 });
    expect(scaled.corners.topLeft).toEqual({ x: -38, y: -57 });
    expect(translated.lattice?.[4]).toEqual({ x: 94, y: 12 });
  });

  test('rotation transforms corners and every lattice handle around the same centre', () => {
    const rotated = rotatePlaneGeometry(makePlane(), { x: 50, y: 50 }, 90);
    expect(rotated.corners.topLeft.x).toBeCloseTo(100);
    expect(rotated.corners.topLeft.y).toBeCloseTo(0);
    expect(rotated.corners.bottomRight.x).toBeCloseTo(0);
    expect(rotated.corners.bottomRight.y).toBeCloseTo(100);
    expect(rotated.lattice?.[1].x).toBeCloseTo(100);
    expect(rotated.lattice?.[1].y).toBeCloseTo(50);
  });
});
