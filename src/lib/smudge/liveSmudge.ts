/**
 * Live (in-progress) smudge session — optimized for real-time drawing at any brush size.
 *
 * Cost control:
 *  - ADAPTIVE RESOLUTION: large brushes are processed on a downscaled buffer (computeSmudgeScale)
 *    so the per-dab pixel loop stays bounded regardless of size; the result is upscaled for display.
 *  - INCREMENTAL: freehand applies only the NEW dabs each frame (O(new points)); the running
 *    bounding box is updated per new point so we never re-map the whole point list.
 *  - CHUNKED GROWTH: the region grows in big steps (rare canvas re-reads) and growth preserves
 *    accumulated work — it never recomputes the whole stroke.
 *  - The straight-line tool replaces its point array each move (detected by reference identity) and
 *    is recomputed from baseline; lines are short so this stays cheap.
 *
 * The work buffer is shown as a small overlay image (blendMode Src) on top of the committed
 * snapshot — no full-canvas snapshot per frame, and the backing surface is never mutated.
 */

import { PixelRatio } from 'react-native';
import type { SkCanvas, SkImage } from '@shopify/react-native-skia';

import type { Stroke, StrokePoint } from '../../state/PaintingContext';

import { clampRegion, readRegionDownsampled } from './pixelRegion';
import { applyPoints, initCarry, type SmudgeStrokeState } from './smudgeCore';
import { computeStrokeRegion, createStrokeState, procToDeviceRect, resolveSmudgeSetup } from './appendSmudge';
import type { SmudgeMask, SmudgePoint, SmudgeParams, SmudgeRegion } from './smudgeTypes';

const DPR = PixelRatio.get();
const REGION_CHUNK = 80; // extra processing-px margin per grow

export class LiveSmudgeSession {
  readonly strokeId: string;
  private procRegion: SmudgeRegion;
  private deviceRect: SmudgeRegion;
  private baseline: Uint8Array; // pristine committed pixels, processing resolution
  private work: Uint8Array; // accumulated smudge, processing resolution
  private readonly mask: SmudgeMask;
  private readonly params: SmudgeParams;
  private readonly state: SmudgeStrokeState;
  private readonly scale: number;
  private readonly ps: number; // processing px per DIP
  private readonly pad: number;
  private readonly procSurfaceW: number;
  private readonly procSurfaceH: number;
  private readonly surfaceWpx: number;
  private readonly surfaceHpx: number;
  // Running bbox of the stroke in processing px.
  private bMinX = Infinity;
  private bMinY = Infinity;
  private bMaxX = -Infinity;
  private bMaxY = -Infinity;
  private processedSourceCount = 0;
  private lastPointsRef: StrokePoint[] | null = null;
  private dirty = true;
  private active = true;

  private constructor(args: {
    strokeId: string;
    procRegion: SmudgeRegion;
    deviceRect: SmudgeRegion;
    baseline: Uint8Array;
    mask: SmudgeMask;
    params: SmudgeParams;
    state: SmudgeStrokeState;
    scale: number;
    ps: number;
    pad: number;
    procSurfaceW: number;
    procSurfaceH: number;
    surfaceWpx: number;
    surfaceHpx: number;
  }) {
    this.strokeId = args.strokeId;
    this.procRegion = args.procRegion;
    this.deviceRect = args.deviceRect;
    this.baseline = args.baseline;
    this.work = args.baseline.slice();
    this.mask = args.mask;
    this.params = args.params;
    this.state = args.state;
    this.scale = args.scale;
    this.ps = args.ps;
    this.pad = args.pad;
    this.procSurfaceW = args.procSurfaceW;
    this.procSurfaceH = args.procSurfaceH;
    this.surfaceWpx = args.surfaceWpx;
    this.surfaceHpx = args.surfaceHpx;
  }

  private growBbox(p: SmudgePoint): void {
    if (p.x < this.bMinX) this.bMinX = p.x;
    if (p.y < this.bMinY) this.bMinY = p.y;
    if (p.x > this.bMaxX) this.bMaxX = p.x;
    if (p.y > this.bMaxY) this.bMaxY = p.y;
  }

  static begin(
    canvas: SkCanvas,
    stroke: Stroke,
    surfaceWpx: number,
    surfaceHpx: number,
    resolveStamp: (emoji: string, size: number) => { image: SkImage } | null
  ): LiveSmudgeSession | null {
    if (!stroke.isSmudge || stroke.points.length === 0) {
      return null;
    }
    const setup = resolveSmudgeSetup(stroke, resolveStamp);
    if (!setup || !setup.mask) {
      return null;
    }
    const { scale, ps, mask, params, pad, brushSizeProc } = setup;
    const procSurfaceW = Math.ceil(surfaceWpx * scale);
    const procSurfaceH = Math.ceil(surfaceHpx * scale);

    const points: SmudgePoint[] = stroke.points.map((p) => ({ x: p.x * ps, y: p.y * ps }));
    const procRegion = clampRegion(computeStrokeRegion(points, mask.w, mask.h, pad), procSurfaceW, procSurfaceH);
    if (!procRegion) {
      return null;
    }
    const deviceRect = procToDeviceRect(procRegion, scale, surfaceWpx, surfaceHpx);
    if (!deviceRect) {
      return null;
    }
    const baseline = readRegionDownsampled(canvas, deviceRect, procRegion.w, procRegion.h);
    if (!baseline) {
      return null;
    }
    const state = createStrokeState(mask.w, mask.h, brushSizeProc);
    const session = new LiveSmudgeSession({
      strokeId: stroke.id,
      procRegion,
      deviceRect,
      baseline,
      mask,
      params,
      state,
      scale,
      ps,
      pad,
      procSurfaceW,
      procSurfaceH,
      surfaceWpx,
      surfaceHpx
    });
    for (let i = 0; i < points.length; i += 1) {
      session.growBbox(points[i]);
    }
    initCarry(state, session.work, procRegion, points[0]);
    applyPoints(state, session.work, procRegion, mask, points, params);
    session.processedSourceCount = points.length;
    session.lastPointsRef = stroke.points;
    return session;
  }

  /** Grow the region in chunks (re-reading pristine baseline), preserving accumulated work. */
  private ensureRegion(canvas: SkCanvas): void {
    const corners: SmudgePoint[] = [
      { x: this.bMinX, y: this.bMinY },
      { x: this.bMaxX, y: this.bMaxY }
    ];
    const needed = clampRegion(
      computeStrokeRegion(corners, this.mask.w, this.mask.h, this.pad),
      this.procSurfaceW,
      this.procSurfaceH
    );
    if (!needed) {
      return;
    }
    const cur = this.procRegion;
    if (
      needed.x >= cur.x &&
      needed.y >= cur.y &&
      needed.x + needed.w <= cur.x + cur.w &&
      needed.y + needed.h <= cur.y + cur.h
    ) {
      return; // still inside
    }
    const grown = clampRegion(
      { x: needed.x - REGION_CHUNK, y: needed.y - REGION_CHUNK, w: needed.w + REGION_CHUNK * 2, h: needed.h + REGION_CHUNK * 2 },
      this.procSurfaceW,
      this.procSurfaceH
    );
    if (!grown) {
      return;
    }
    const minX = Math.min(cur.x, grown.x);
    const minY = Math.min(cur.y, grown.y);
    const maxX = Math.max(cur.x + cur.w, grown.x + grown.w);
    const maxY = Math.max(cur.y + cur.h, grown.y + grown.h);
    const union: SmudgeRegion = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    const deviceRect = procToDeviceRect(union, this.scale, this.surfaceWpx, this.surfaceHpx);
    if (!deviceRect) {
      return;
    }
    const baseline = readRegionDownsampled(canvas, deviceRect, union.w, union.h);
    if (!baseline) {
      return;
    }
    const work = baseline.slice();
    const offX = cur.x - union.x;
    const offY = cur.y - union.y;
    for (let y = 0; y < cur.h; y += 1) {
      const srcRow = (y * cur.w) << 2;
      const dstRow = (((y + offY) * union.w) + offX) << 2;
      work.set(this.work.subarray(srcRow, srcRow + (cur.w << 2)), dstRow);
    }
    this.procRegion = union;
    this.deviceRect = deviceRect;
    this.baseline = baseline;
    this.work = work;
  }

  private recomputeAll(points: SmudgePoint[]): void {
    this.work.set(this.baseline);
    this.state.carry.fill(0);
    this.state.lastPoint = null;
    this.state.dirty = null;
    initCarry(this.state, this.work, this.procRegion, points[0]);
    applyPoints(this.state, this.work, this.procRegion, this.mask, points, this.params);
  }

  update(canvas: SkCanvas, stroke: Stroke): void {
    if (!this.active || stroke.id !== this.strokeId || stroke.points.length === 0) {
      return;
    }
    const isReplace = stroke.points !== this.lastPointsRef;
    this.lastPointsRef = stroke.points;

    if (isReplace) {
      // Line tool: whole path changed — recompute from baseline (lines are short).
      const points: SmudgePoint[] = stroke.points.map((p) => ({ x: p.x * this.ps, y: p.y * this.ps }));
      this.bMinX = Infinity;
      this.bMinY = Infinity;
      this.bMaxX = -Infinity;
      this.bMaxY = -Infinity;
      for (let i = 0; i < points.length; i += 1) {
        this.growBbox(points[i]);
      }
      this.ensureRegion(canvas);
      this.recomputeAll(points);
      this.processedSourceCount = stroke.points.length;
      this.dirty = true;
      return;
    }

    // Freehand append: only the new tail dabs.
    const total = stroke.points.length;
    if (total <= this.processedSourceCount) {
      this.dirty = false;
      return;
    }
    const fresh: SmudgePoint[] = new Array(total - this.processedSourceCount);
    for (let i = this.processedSourceCount; i < total; i += 1) {
      const pp = { x: stroke.points[i].x * this.ps, y: stroke.points[i].y * this.ps };
      fresh[i - this.processedSourceCount] = pp;
      this.growBbox(pp);
    }
    this.processedSourceCount = total;
    this.ensureRegion(canvas);
    applyPoints(this.state, this.work, this.procRegion, this.mask, fresh, this.params);
    this.dirty = true;
  }

  consumeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** Processing-resolution region (buffer dimensions) for building the overlay image. */
  getRegion(): SmudgeRegion {
    return this.procRegion;
  }

  getWork(): Uint8Array {
    return this.work;
  }

  /** Diagnostics for profiling. */
  getDebugInfo(): { scale: number; maskW: number; maskH: number; procW: number; procH: number; deviceW: number; deviceH: number } {
    return {
      scale: this.scale,
      maskW: this.mask.w,
      maskH: this.mask.h,
      procW: this.procRegion.w,
      procH: this.procRegion.h,
      deviceW: this.deviceRect.w,
      deviceH: this.deviceRect.h
    };
  }

  /** Where to draw the overlay image, in DIP (logical canvas) coordinates. */
  getDisplayRect(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.deviceRect.x / DPR,
      y: this.deviceRect.y / DPR,
      width: this.deviceRect.w / DPR,
      height: this.deviceRect.h / DPR
    };
  }

  end(): void {
    this.active = false;
  }
}
