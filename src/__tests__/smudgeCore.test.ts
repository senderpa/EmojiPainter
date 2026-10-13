import { applyDab, applyPoints, initCarry, type SmudgeStrokeState } from '../lib/smudge/smudgeCore';
import { DEFAULT_SMUDGE_PARAMS, type SmudgeMask, type SmudgeRegion } from '../lib/smudge/smudgeTypes';

// --- Test helpers (no Skia / React Native) ---

const REGION_W = 40;
const REGION_H = 40;
const region: SmudgeRegion = { x: 0, y: 0, w: REGION_W, h: REGION_H };

/** A solid circular mask of size n*n (hard interior, soft full coverage, edge ring). */
const makeDiscMask = (n: number): SmudgeMask => {
  const hard = new Float32Array(n * n);
  const soft = new Float32Array(n * n);
  const edge = new Float32Array(n * n);
  const c = (n - 1) / 2;
  const r = n / 2;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const d = Math.hypot(x - c, y - c) / r;
      const i = y * n + x;
      const cover = d >= 1 ? 0 : 1;
      soft[i] = cover;
      hard[i] = d < 0.6 ? 1 : 0;
      edge[i] = Math.max(0, cover - hard[i]);
    }
  }
  return { hard, soft, edge, w: n, h: n };
};

const makeState = (maskW: number, maskH: number, brushSizePx: number): SmudgeStrokeState => ({
  carry: new Float32Array(maskW * maskH * 4),
  maskW,
  maskH,
  brushSizePx,
  lastPoint: null,
  dirty: null
});

const newWork = (): Uint8Array => new Uint8Array(REGION_W * REGION_H * 4); // all transparent

/** Paint a solid rectangle of straight RGBA into a work buffer. */
const fillRect = (
  work: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: [number, number, number, number]
): void => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const o = (y * REGION_W + x) << 2;
      work[o] = rgba[0];
      work[o + 1] = rgba[1];
      work[o + 2] = rgba[2];
      work[o + 3] = rgba[3];
    }
  }
};

const px = (work: Uint8Array, x: number, y: number): [number, number, number, number] => {
  const o = (y * REGION_W + x) << 2;
  return [work[o], work[o + 1], work[o + 2], work[o + 3]];
};

describe('smudge core', () => {
  test('initCarry picks up the canvas color under the start point', () => {
    const work = newWork();
    fillRect(work, 0, 0, REGION_W, REGION_H, [200, 50, 50, 255]);
    const mask = makeDiscMask(9);
    const state = makeState(9, 9, 9);

    initCarry(state, work, region, { x: 20, y: 20 });

    // Center carry pixel should hold the red, premultiplied (alpha 1 → equals straight/255).
    const ci = ((4 * 9 + 4) << 2); // center of 9x9 mask
    expect(state.carry[ci]).toBeCloseTo(200 / 255, 2);
    expect(state.carry[ci + 1]).toBeCloseTo(50 / 255, 2);
    expect(state.carry[ci + 3]).toBeCloseTo(1, 2);
    expect(state.lastPoint).toEqual({ x: 20, y: 20 });
  });

  test('drags color from a colored blob into a previously transparent area', () => {
    const work = newWork();
    // Solid red blob on the left half; right half transparent.
    fillRect(work, 4, 12, 14, 28, [255, 0, 0, 255]);
    const mask = makeDiscMask(11);
    const state = makeState(11, 11, 11);

    const start = { x: 9, y: 20 };
    initCarry(state, work, region, start);
    applyPoints(state, work, region, mask, [
      { x: 14, y: 20 },
      { x: 20, y: 20 },
      { x: 26, y: 20 }
    ], DEFAULT_SMUDGE_PARAMS);

    // A point that started transparent, to the right of the blob, should now carry red.
    const [r, g, b, a] = px(work, 24, 20);
    expect(a).toBeGreaterThan(20);
    expect(r).toBeGreaterThan(g + 20);
    expect(r).toBeGreaterThan(b + 20);
  });

  test('never invents a black halo: colored output is never near-black where alpha is significant', () => {
    const work = newWork();
    fillRect(work, 4, 12, 14, 28, [0, 180, 255, 255]); // cyan-ish
    const mask = makeDiscMask(11);
    const state = makeState(11, 11, 11);

    initCarry(state, work, region, { x: 9, y: 20 });
    applyPoints(state, work, region, mask, [
      { x: 16, y: 20 },
      { x: 24, y: 20 },
      { x: 30, y: 20 }
    ], DEFAULT_SMUDGE_PARAMS);

    for (let y = 0; y < REGION_H; y += 1) {
      for (let x = 0; x < REGION_W; x += 1) {
        const [r, g, b, a] = px(work, x, y);
        if (a > 40) {
          // Significant coverage must carry real color, not a grey/black contamination halo.
          expect(Math.max(r, g, b)).toBeGreaterThan(20);
        }
      }
    }
  });

  test('smudging an entirely transparent canvas produces no color (no paint invented)', () => {
    const work = newWork();
    const mask = makeDiscMask(11);
    const state = makeState(11, 11, 11);

    initCarry(state, work, region, { x: 10, y: 20 });
    applyPoints(state, work, region, mask, [
      { x: 20, y: 20 },
      { x: 30, y: 20 }
    ], DEFAULT_SMUDGE_PARAMS);

    let maxAlpha = 0;
    for (let i = 0; i < work.length; i += 4) {
      maxAlpha = Math.max(maxAlpha, work[i + 3]);
    }
    expect(maxAlpha).toBe(0);
  });

  test('a single dab tracks a dirty rect covering the affected area', () => {
    const work = newWork();
    fillRect(work, 0, 0, REGION_W, REGION_H, [120, 120, 120, 255]);
    const mask = makeDiscMask(11);
    const state = makeState(11, 11, 11);

    initCarry(state, work, region, { x: 20, y: 20 });
    applyDab(state, work, region, mask, { x: 20, y: 20 }, { x: 25, y: 20 }, DEFAULT_SMUDGE_PARAMS);

    expect(state.dirty).not.toBeNull();
    const d = state.dirty!;
    expect(d.w).toBeGreaterThan(0);
    expect(d.h).toBeGreaterThan(0);
    // Dirty rect should overlap the dab center.
    expect(d.x).toBeLessThanOrEqual(25);
    expect(d.x + d.w).toBeGreaterThanOrEqual(20);
  });
});
