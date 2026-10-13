/**
 * Pure CPU smudge math — no Skia, no React Native. Unit-testable in isolation.
 *
 * Operates on a single RGBA work buffer (straight/unpremultiplied alpha, 0..255) that mirrors a
 * rectangular region of the canvas in device pixels. The same buffer is both read (to pick up
 * pixels) and written (to deposit them), which is what produces real directional smearing —
 * previous pixels are pulled forward into the next position.
 *
 * Color mixing is done in PREMULTIPLIED-alpha float space so dragging color into transparent
 * areas fades cleanly through alpha and never invents black/grey/white halos. A fully
 * transparent pixel is (0,0,0,0) in premultiplied space; mixing toward it lowers alpha and color
 * together, and un-premultiplying preserves the remaining hue.
 */

import type { SmudgeMask, SmudgeParams, SmudgePoint, SmudgeRegion } from './smudgeTypes';
import { MIN_DAB_SPACING_PX } from './smudgeTypes';

/** Premultiplied RGBA in 0..1, reused to avoid per-pixel allocation. */
interface Premul {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// Module-level reusable scratch (single-threaded JS, no reentrancy) — avoids per-dab allocation.
const sBehind: Premul = { r: 0, g: 0, b: 0, a: 0 };
const sDst: Premul = { r: 0, g: 0, b: 0, a: 0 };
const sAvg: Premul = { r: 0, g: 0, b: 0, a: 0 };
const sScratch: Premul = { r: 0, g: 0, b: 0, a: 0 };
const sCarried: Premul = { r: 0, g: 0, b: 0, a: 0 };
const sOut: Premul = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Persistent state for one smudge stroke: the carry buffer (paint on the finger, premultiplied,
 * indexed per mask pixel) plus a cursor of how many source points have been consumed.
 */
export interface SmudgeStrokeState {
  carry: Float32Array; // length maskW*maskH*4, premultiplied RGBA in 0..1
  maskW: number;
  maskH: number;
  brushSizePx: number;
  /** Index into the (interpolated) point list that has already been applied. */
  lastPoint: SmudgePoint | null;
  /** Inclusive dirty rect in device px touched so far; null until first dab. */
  dirty: SmudgeRegion | null;
}

/** Sample a premultiplied pixel from the work buffer at absolute device coords. Out-of-region = empty. */
const sampleWork = (work: Uint8Array, region: SmudgeRegion, ax: number, ay: number, out: Premul): void => {
  const lx = ax - region.x;
  const ly = ay - region.y;
  if (lx < 0 || ly < 0 || lx >= region.w || ly >= region.h) {
    out.r = 0;
    out.g = 0;
    out.b = 0;
    out.a = 0;
    return;
  }
  const o = ((ly * region.w + lx) << 2);
  const a = work[o + 3] / 255;
  out.r = (work[o] / 255) * a;
  out.g = (work[o + 1] / 255) * a;
  out.b = (work[o + 2] / 255) * a;
  out.a = a;
};

/** Write a premultiplied pixel back to the work buffer (un-premultiplying first). */
const writeWork = (work: Uint8Array, region: SmudgeRegion, ax: number, ay: number, p: Premul): void => {
  const lx = ax - region.x;
  const ly = ay - region.y;
  if (lx < 0 || ly < 0 || lx >= region.w || ly >= region.h) {
    return;
  }
  const o = ((ly * region.w + lx) << 2);
  const a = clamp01(p.a);
  if (a <= 0) {
    work[o] = 0;
    work[o + 1] = 0;
    work[o + 2] = 0;
    work[o + 3] = 0;
    return;
  }
  work[o] = clamp01(p.r / a) * 255;
  work[o + 1] = clamp01(p.g / a) * 255;
  work[o + 2] = clamp01(p.b / a) * 255;
  work[o + 3] = a * 255;
};

/** Cheap 5-tap box average around an absolute point, in premultiplied space. */
const sampleBlur = (
  work: Uint8Array,
  region: SmudgeRegion,
  ax: number,
  ay: number,
  radiusPx: number,
  scratch: Premul,
  out: Premul
): void => {
  const r = Math.max(1, Math.round(radiusPx));
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sa = 0;
  const offsets = [
    [0, 0],
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r]
  ];
  for (let i = 0; i < offsets.length; i += 1) {
    sampleWork(work, region, ax + offsets[i][0], ay + offsets[i][1], scratch);
    sr += scratch.r;
    sg += scratch.g;
    sb += scratch.b;
    sa += scratch.a;
  }
  const n = offsets.length;
  out.r = sr / n;
  out.g = sg / n;
  out.b = sb / n;
  out.a = sa / n;
};

/** mix(a, b, t) in place on `a` (premultiplied lerp). */
const mixInto = (a: Premul, b: Premul, t: number): void => {
  a.r += (b.r - a.r) * t;
  a.g += (b.g - a.g) * t;
  a.b += (b.b - a.b) * t;
  a.a += (b.a - a.a) * t;
};

const growDirty = (state: SmudgeStrokeState, x: number, y: number, w: number, h: number): void => {
  if (!state.dirty) {
    state.dirty = { x, y, w, h };
    return;
  }
  const d = state.dirty;
  const minX = Math.min(d.x, x);
  const minY = Math.min(d.y, y);
  const maxX = Math.max(d.x + d.w, x + w);
  const maxY = Math.max(d.y + d.h, y + h);
  d.x = minX;
  d.y = minY;
  d.w = maxX - minX;
  d.h = maxY - minY;
};

/**
 * Pick up the canvas color under the first touch into the carry buffer, so the very first dab
 * already has paint on the finger (otherwise the start of a stroke looks like a cheap blur).
 */
export const initCarry = (
  state: SmudgeStrokeState,
  work: Uint8Array,
  region: SmudgeRegion,
  at: SmudgePoint
): void => {
  const { maskW, maskH, carry } = state;
  const tlx = Math.round(at.x) - (maskW >> 1);
  const tly = Math.round(at.y) - (maskH >> 1);
  const px: Premul = { r: 0, g: 0, b: 0, a: 0 };
  for (let my = 0; my < maskH; my += 1) {
    for (let mx = 0; mx < maskW; mx += 1) {
      sampleWork(work, region, tlx + mx, tly + my, px);
      const i = ((my * maskW + mx) << 2);
      carry[i] = px.r;
      carry[i + 1] = px.g;
      carry[i + 2] = px.b;
      carry[i + 3] = px.a;
    }
  }
  state.lastPoint = { x: at.x, y: at.y };
};

const velocityDragFactor = (velocity: number, brushSizePx: number, params: SmudgeParams): number => {
  const n = clamp01(velocity / Math.max(1, brushSizePx));
  return 1 + n * (params.maxVelocityDragBoost - 1);
};

const velocityBlendFactor = (velocity: number, brushSizePx: number): number => {
  const n = clamp01(velocity / Math.max(1, brushSizePx));
  return 1 - n * 0.35;
};

/**
 * Apply a single smudge dab moving from `from` to `to`. Mutates `work` and the carry buffer.
 * Center (hard mask) drags carried paint forward; edge (edge mask) melts with the local average.
 */
export const applyDab = (
  state: SmudgeStrokeState,
  work: Uint8Array,
  region: SmudgeRegion,
  mask: SmudgeMask,
  from: SmudgePoint,
  to: SmudgePoint,
  params: SmudgeParams
): void => {
  const { maskW, maskH, carry, brushSizePx } = state;
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  const velocity = Math.hypot(dx, dy);
  const len = Math.max(0.0001, velocity);
  dx /= len;
  dy /= len;

  const vDrag = velocityDragFactor(velocity, brushSizePx, params);
  const vBlend = velocityBlendFactor(velocity, brushSizePx);
  const localRadiusPx = brushSizePx * params.localAverageRadius;
  const behindDist = brushSizePx * params.behindSampleDistance;

  const curTLx = Math.round(to.x) - (maskW >> 1);
  const curTLy = Math.round(to.y) - (maskH >> 1);
  const behindCx = to.x - dx * behindDist;
  const behindCy = to.y - dy * behindDist;
  const behindTLx = Math.round(behindCx) - (maskW >> 1);
  const behindTLy = Math.round(behindCy) - (maskH >> 1);

  const behind = sBehind;
  const dst = sDst;
  const avg = sAvg;
  const scratch = sScratch;
  const carried = sCarried;
  const out = sOut;

  // PERF: compute the local average ONCE per dab (at the cursor) instead of per pixel — the edge
  // melt barely changes across a single brush footprint and this removes the dominant cost.
  sampleBlur(work, region, Math.round(to.x), Math.round(to.y), localRadiusPx, scratch, avg);

  for (let my = 0; my < maskH; my += 1) {
    for (let mx = 0; mx < maskW; mx += 1) {
      const mi = my * maskW + mx;
      const s = mask.soft[mi];
      if (s <= 0.001) {
        continue;
      }
      const h = mask.hard[mi];
      const e = mask.edge[mi];
      const ci = mi << 2;

      // Reload the finger from behind the cursor (directional pickup).
      sampleWork(work, region, behindTLx + mx, behindTLy + my, behind);
      carried.r = carry[ci];
      carried.g = carry[ci + 1];
      carried.b = carry[ci + 2];
      carried.a = carry[ci + 3];
      mixInto(carried, behind, params.reloadRate);

      // Destination at the current position (local average precomputed above).
      const ax = curTLx + mx;
      const ay = curTLy + my;
      sampleWork(work, region, ax, ay, dst);

      const drag = clamp01(h * params.smudgeStrength * vDrag);
      const blend = clamp01(e * params.edgeBlendStrength * vBlend);

      out.r = dst.r;
      out.g = dst.g;
      out.b = dst.b;
      out.a = dst.a;
      mixInto(out, carried, drag); // center: pull carried paint forward
      mixInto(out, avg, blend); // edge: melt toward local average
      // Gate the whole effect by coverage so nothing outside the glyph changes.
      out.r = dst.r + (out.r - dst.r) * s;
      out.g = dst.g + (out.g - dst.g) * s;
      out.b = dst.b + (out.b - dst.b) * s;
      out.a = dst.a + (out.a - dst.a) * s;
      writeWork(work, region, ax, ay, out);

      // Slowly contaminate the finger with the destination it just passed over.
      carry[ci] = carried.r + (dst.r - carried.r) * params.dirtyUpdateRate;
      carry[ci + 1] = carried.g + (dst.g - carried.g) * params.dirtyUpdateRate;
      carry[ci + 2] = carried.b + (dst.b - carried.b) * params.dirtyUpdateRate;
      carry[ci + 3] = carried.a + (dst.a - carried.a) * params.dirtyUpdateRate;
    }
  }

  growDirty(state, Math.min(curTLx, behindTLx), Math.min(curTLy, behindTLy), maskW + Math.abs(behindTLx - curTLx), maskH + Math.abs(behindTLy - curTLy));
  state.lastPoint = { x: to.x, y: to.y };
};

/**
 * Apply a run of source points (device px) to the work buffer, interpolating at tight spacing.
 * Returns the dirty rect grown this call (or null if nothing was drawn). `from` is the last point
 * already applied (state.lastPoint); pass the new tail points only for incremental/live use.
 */
export const applyPoints = (
  state: SmudgeStrokeState,
  work: Uint8Array,
  region: SmudgeRegion,
  mask: SmudgeMask,
  points: SmudgePoint[],
  params: SmudgeParams
): void => {
  if (points.length === 0) {
    return;
  }
  const spacing = Math.max(MIN_DAB_SPACING_PX, state.brushSizePx * params.spacingFactor);
  let prev = state.lastPoint ?? points[0];
  for (let i = 0; i < points.length; i += 1) {
    const target = points[i];
    const dist = Math.hypot(target.x - prev.x, target.y - prev.y);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const p: SmudgePoint = {
        x: prev.x + (target.x - prev.x) * t,
        y: prev.y + (target.y - prev.y) * t
      };
      applyDab(state, work, region, mask, prev, p, params);
      prev = p;
    }
  }
};
