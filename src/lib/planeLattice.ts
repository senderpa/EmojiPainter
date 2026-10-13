import type { EmojiPlane } from '../state/PaintingContext';

/**
 * Control-point lattice for the 📐 emoji-plane tool.
 *
 * The plane has always stored 4 corners (plus 4 unused edge midpoints) and rendered them through
 * a homography — a projection defined by exactly 4 points, so no amount of extra handles could
 * bend it. To actually distort the interior we need a GRID of control points and a surface that
 * interpolates them.
 *
 * The lattice is (n+1)x(n+1) points over the unit square, stored row-major. Level 1 is the plain
 * 4 corners, which reproduces the old homography exactly — so an existing plane opened with the
 * lattice looks identical until a handle is actually moved.
 */

export type LatticeLevel = 1 | 2 | 3 | 5;

/** Handle counts offered in the UI. (n+1)^2 points for an n x n cell grid.
 *  36 (level 5) is intentionally hidden — too dense to grab reliably by finger — but the
 *  LatticeLevel type keeps it so any plane already saved at that density still renders/loads. */
export const LATTICE_LEVELS: { level: LatticeLevel; points: number; label: string }[] = [
  { level: 1, points: 4, label: '4' },
  { level: 2, points: 9, label: '9' },
  { level: 3, points: 16, label: '16' },
];

export type LatticePoint = { x: number; y: number };

type PlaneQuad = Pick<
  EmojiPlane['corners'],
  'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft'
>;

/** Points across one row/col edge = level + 1. */
export const latticeSide = (level: LatticeLevel): number => level + 1;
export const latticeCount = (level: LatticeLevel): number => latticeSide(level) ** 2;

export const latticeIndex = (level: LatticeLevel, row: number, col: number): number =>
  row * latticeSide(level) + col;

/**
 * Project one unit-square coordinate through the plane's four-corner homography.
 *
 * This is intentionally the same projective mapping used by both plane renderers. A bilinear
 * interpolation only agrees for parallelograms; on a trapezoid it bows the interior and makes the
 * artwork jump as soon as the user changes from 4 to 9+ handles.
 */
export const projectPlanePoint = (
  corners: PlaneQuad,
  u: number,
  v: number,
): LatticePoint => {
  const x0 = corners.topLeft.x;
  const y0 = corners.topLeft.y;
  const x1 = corners.topRight.x;
  const y1 = corners.topRight.y;
  const x2 = corners.bottomRight.x;
  const y2 = corners.bottomRight.y;
  const x3 = corners.bottomLeft.x;
  const y3 = corners.bottomLeft.y;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  let g = 0;
  let h = 0;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    // A degenerate quad cannot define a stable projective transform. Falling back to the affine
    // form keeps all coordinates finite while the user drags through that transient shape.
    if (Math.abs(determinant) > 1e-9) {
      g = (dx3 * dy2 - dx2 * dy3) / determinant;
      h = (dx1 * dy3 - dx3 * dy1) / determinant;
    }
  }

  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;
  const denominator = g * u + h * v + 1;
  const safeDenominator = Math.abs(denominator) < 1e-9
    ? (denominator < 0 ? -1e-9 : 1e-9)
    : denominator;

  return {
    x: (a * u + b * v + c) / safeDenominator,
    y: (d * u + e * v + f) / safeDenominator,
  };
};

/** Seed a handle grid without changing the current four-corner projection. */
export const latticeFromPlaneCorners = (
  level: LatticeLevel,
  corners: PlaneQuad,
): LatticePoint[] => latticeFromCorners(level, (u, v) => projectPlanePoint(corners, u, v));

/**
 * Build a lattice from the plane's four corners by evaluating the SAME homography the renderer
 * already uses. Starting from the projected positions (rather than a flat bilinear grid) means
 * switching level never changes what is on screen — only what you can grab.
 */
export const latticeFromCorners = (
  level: LatticeLevel,
  project: (u: number, v: number) => LatticePoint,
): LatticePoint[] => {
  const side = latticeSide(level);
  const points: LatticePoint[] = [];
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      points.push(project(col / level, row / level));
    }
  }
  return points;
};

/**
 * Resample an existing lattice to a different level, preserving the current shape.
 *
 * Bilinear sample of the old lattice at the new level's parameter positions: going up in detail
 * adds handles that sit exactly on the current surface, and going down keeps the coarse shape.
 * Without this, changing the handle count would snap the artwork back to a flat quad.
 */
export const resampleLattice = (
  points: LatticePoint[],
  from: LatticeLevel,
  to: LatticeLevel,
): LatticePoint[] => {
  if (from === to) return points.slice();
  const fromSide = latticeSide(from);
  const sample = (u: number, v: number): LatticePoint => {
    const fx = u * from;
    const fy = v * from;
    const c0 = Math.min(fromSide - 1, Math.floor(fx));
    const r0 = Math.min(fromSide - 1, Math.floor(fy));
    const c1 = Math.min(fromSide - 1, c0 + 1);
    const r1 = Math.min(fromSide - 1, r0 + 1);
    const tx = fx - c0;
    const ty = fy - r0;
    const p = (r: number, c: number) => points[r * fromSide + c] ?? points[points.length - 1];
    const top = { x: p(r0, c0).x + (p(r0, c1).x - p(r0, c0).x) * tx, y: p(r0, c0).y + (p(r0, c1).y - p(r0, c0).y) * tx };
    const bot = { x: p(r1, c0).x + (p(r1, c1).x - p(r1, c0).x) * tx, y: p(r1, c0).y + (p(r1, c1).y - p(r1, c0).y) * tx };
    return { x: top.x + (bot.x - top.x) * ty, y: top.y + (bot.y - top.y) * ty };
  };
  const toSide = latticeSide(to);
  const out: LatticePoint[] = [];
  for (let row = 0; row < toSide; row += 1) {
    for (let col = 0; col < toSide; col += 1) {
      out.push(sample(col / to, row / to));
    }
  }
  return out;
};

/**
 * Surface point at (u,v) from a lattice — bilinear within the containing cell.
 *
 * Deliberately NOT a smooth spline: a dragged handle should land exactly under the finger, and
 * a spline would pull the surface toward the handle without reaching it, which reads as the
 * control point being "loose".
 */
export const sampleLattice = (
  points: LatticePoint[],
  level: LatticeLevel,
  u: number,
  v: number,
): LatticePoint => {
  const side = latticeSide(level);
  const fx = Math.min(level, Math.max(0, u * level));
  const fy = Math.min(level, Math.max(0, v * level));
  const c0 = Math.min(side - 1, Math.floor(fx));
  const r0 = Math.min(side - 1, Math.floor(fy));
  const c1 = Math.min(side - 1, c0 + 1);
  const r1 = Math.min(side - 1, r0 + 1);
  const tx = fx - c0;
  const ty = fy - r0;
  const p = (r: number, c: number) => points[r * side + c];
  const tl = p(r0, c0), tr = p(r0, c1), bl = p(r1, c0), br = p(r1, c1);
  const top = { x: tl.x + (tr.x - tl.x) * tx, y: tl.y + (tr.y - tl.y) * tx };
  const bot = { x: bl.x + (br.x - bl.x) * tx, y: bl.y + (br.y - bl.y) * tx };
  return { x: top.x + (bot.x - top.x) * ty, y: top.y + (bot.y - top.y) * ty };
};

/** Nearest lattice handle within `radius`, or null. */
export const findLatticeHandle = (
  points: LatticePoint[],
  x: number,
  y: number,
  radius: number,
): number | null => {
  let best: number | null = null;
  let bestDist = radius;
  for (let i = 0; i < points.length; i += 1) {
    const d = Math.hypot(x - points[i].x, y - points[i].y);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
};

/** Corner points of a lattice, for code that still needs the legacy 4-corner shape. */
export const latticeCorners = (points: LatticePoint[], level: LatticeLevel): EmojiPlane['corners'] => {
  const side = latticeSide(level);
  const at = (r: number, c: number) => points[r * side + c];
  const tl = at(0, 0), tr = at(0, side - 1), br = at(side - 1, side - 1), bl = at(side - 1, 0);
  const mid = (a: LatticePoint, b: LatticePoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return {
    topLeft: { ...tl },
    topMid: mid(tl, tr),
    topRight: { ...tr },
    rightMid: mid(tr, br),
    bottomRight: { ...br },
    bottomMid: mid(br, bl),
    bottomLeft: { ...bl },
    leftMid: mid(bl, tl),
  };
};

const mapPlaneCorners = (
  corners: EmojiPlane['corners'],
  map: (point: LatticePoint) => LatticePoint,
): EmojiPlane['corners'] => ({
  topLeft: map(corners.topLeft),
  topMid: map(corners.topMid),
  topRight: map(corners.topRight),
  rightMid: map(corners.rightMid),
  bottomRight: map(corners.bottomRight),
  bottomMid: map(corners.bottomMid),
  bottomLeft: map(corners.bottomLeft),
  leftMid: map(corners.leftMid),
});

/** Move a whole plane while keeping its legacy corners and optional lattice in lockstep. */
export const translatePlaneGeometry = (
  plane: EmojiPlane,
  dx: number,
  dy: number,
): EmojiPlane => {
  const move = (point: LatticePoint) => ({ x: point.x + dx, y: point.y + dy });
  return {
    ...plane,
    corners: mapPlaneCorners(plane.corners, move),
    ...(plane.lattice ? { lattice: plane.lattice.map(move) } : {}),
  };
};

/** Scale a whole plane around a fixed canvas point, including every extra distortion handle. */
export const scalePlaneGeometry = (
  plane: EmojiPlane,
  center: LatticePoint,
  factor: number,
): EmojiPlane => {
  const scale = (point: LatticePoint) => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  });
  return {
    ...plane,
    corners: mapPlaneCorners(plane.corners, scale),
    ...(plane.lattice ? { lattice: plane.lattice.map(scale) } : {}),
  };
};

/** Rotate the complete plane around one fixed canvas point, including every lattice handle. */
export const rotatePlaneGeometry = (
  plane: EmojiPlane,
  center: LatticePoint,
  degrees: number,
): EmojiPlane => {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotate = (point: LatticePoint) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    };
  };
  return {
    ...plane,
    corners: mapPlaneCorners(plane.corners, rotate),
    ...(plane.lattice ? { lattice: plane.lattice.map(rotate) } : {}),
  };
};

/**
 * Return a new plane with one visible handle under the finger.
 *
 * Lattice handles are the authoritative geometry at 9+ points; legacy corners are then derived
 * from its four edge endpoints for older save/export code. Classic four-corner planes retain the
 * original midpoint behaviour.
 */
export const movePlaneHandle = (
  plane: EmojiPlane,
  handle: string,
  x: number,
  y: number,
): EmojiPlane => {
  if (handle.startsWith('lattice:') && plane.lattice) {
    const index = Number(handle.slice('lattice:'.length));
    if (!Number.isInteger(index) || index < 0 || index >= plane.lattice.length) return plane;
    const level = (plane.latticeLevel ?? 1) as LatticeLevel;
    const nextLattice = plane.lattice.slice();
    nextLattice[index] = { x, y };
    return {
      ...plane,
      lattice: nextLattice,
      corners: latticeCorners(nextLattice, level),
    };
  }

  if (!['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].includes(handle)) return plane;
  const quad = {
    topLeft: { ...plane.corners.topLeft },
    topRight: { ...plane.corners.topRight },
    bottomRight: { ...plane.corners.bottomRight },
    bottomLeft: { ...plane.corners.bottomLeft },
    [handle]: { x, y },
  } as PlaneQuad;
  const mid = (a: LatticePoint, b: LatticePoint) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const corners: EmojiPlane['corners'] = {
    topLeft: quad.topLeft,
    topMid: mid(quad.topLeft, quad.topRight),
    topRight: quad.topRight,
    rightMid: mid(quad.topRight, quad.bottomRight),
    bottomRight: quad.bottomRight,
    bottomMid: mid(quad.bottomRight, quad.bottomLeft),
    bottomLeft: quad.bottomLeft,
    leftMid: mid(quad.bottomLeft, quad.topLeft),
  };
  // Level 1 is rendered through the four-corner homography, so discard its now-stale seed. If the
  // user later chooses more handles it will be rebuilt from these exact corners.
  return { ...plane, corners, lattice: undefined, latticeLevel: 1 };
};
