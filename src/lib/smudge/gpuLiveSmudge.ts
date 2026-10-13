/**
 * Live (in-progress) GPU smudge — "Fast Smudge": adaptive-resolution texture-distortion.
 *
 * Why: the smudge cost scales with brush area (the deposit shader) AND with canvas area (each
 * full-canvas snapshot is a ~37MB copy-on-write on iPad, regardless of brush size). To make it
 * roughly size-independent and responsive:
 *   - Process the whole smudge on a SMALL work surface at ADAPTIVE RESOLUTION (full for small
 *     brushes, ½ for medium, ⅓ for large). A 300px brush at ⅓ res costs like a 100px brush.
 *   - One snapshot per frame (not per dab) → minimal copy-on-write churn.
 *   - Pool work surfaces by size so we don't allocate per stroke.
 *   - Only read back the dirty sub-rect (small) for display; it doubles as the bake tile.
 *
 * The shader (gpuSmudge) is a directional color-carry (texture distortion), not per-pixel sim.
 */

import { PixelRatio } from 'react-native';
import { BlendMode, Skia, type SkImage, type SkPaint, type SkSurface } from '@shopify/react-native-skia';

import type { Stroke, StrokePoint } from '../../state/PaintingContext';
import { applyDabsToSurface, interpolateDabs, isGpuSmudgeAvailable, type SmudgeDab } from './gpuSmudge';
import { smudgeMaxBrushPixels, smudgeQualityForLargeBrushes, smudgeSpacing, type SmudgeRegion } from './smudgeTypes';

const DPR = PixelRatio.get();
const MAX_DABS_PER_FRAME = 24;
const SNAP_RING = 2;
const DEPOSIT_STRENGTH = 0.88;
const TRANSPARENT = Skia.Color('rgba(0,0,0,0)');

/** Adaptive quality: small brushes stay sharp; large brushes drop resolution to stay real-time. */
const qualityScale = (brushDevicePx: number): number => {
  if (brushDevicePx <= smudgeMaxBrushPixels) {
    return 1;
  }
  return Math.max(smudgeQualityForLargeBrushes, Math.min(1, smudgeMaxBrushPixels / brushDevicePx));
};

const reachForStroke = (stroke: Stroke, brushSizeProcPx: number): number => {
  const length = typeof stroke.edgeBlendStrength === 'number' ? stroke.edgeBlendStrength : 0.5;
  return Math.max(2, brushSizeProcPx * (0.08 + Math.max(0, Math.min(1, length)) * 0.42));
};

// Pool work surfaces by "WxH" so strokes of the same brush band reuse one (no per-stroke alloc).
const surfacePool: { key: string; surface: SkSurface }[] = [];
const acquireSurface = (w: number, h: number): SkSurface | null => {
  const key = `${w}x${h}`;
  const idx = surfacePool.findIndex((e) => e.key === key);
  if (idx >= 0) {
    return surfacePool.splice(idx, 1)[0].surface;
  }
  return Skia.Surface.MakeOffscreen(w, h);
};
const releaseSurface = (w: number, h: number, surface: SkSurface): void => {
  surfacePool.push({ key: `${w}x${h}`, surface });
  while (surfacePool.length > 3) {
    surfacePool.shift()?.surface.dispose?.();
  }
};
export const clearSmudgeSurfacePool = (): void => {
  surfacePool.forEach((e) => e.surface.dispose?.());
  surfacePool.length = 0;
};

export interface SmudgeOverlay {
  image: SkImage;
  bounds: SmudgeRegion; // DEVICE px on the canvas (proc rect upscaled by 1/qs)
}

export class GpuLiveSmudgeSession {
  readonly strokeId: string;
  private readonly surface: SkSurface;
  private readonly procW: number;
  private readonly procH: number;
  private readonly qs: number; // quality scale (proc px per device px)
  private readonly ps: number; // proc px per DIP (= DPR * qs)
  private readonly maskImage: SkImage;
  private readonly paint: SkPaint;
  private readonly reach: number;
  private readonly spacingPx: number; // proc px
  private readonly baselineSnapshot: SkImage;
  private readonly overlays: SmudgeOverlay[] = [];
  private dirtyRect: SmudgeRegion | null = null; // proc px
  private lastPx = 0; // proc px
  private lastPy = 0;
  private processedSourceCount = 0;
  private lastPointsRef: StrokePoint[] | null = null;
  private changed = true;
  private active = true;

  private constructor(args: {
    strokeId: string;
    surface: SkSurface;
    procW: number;
    procH: number;
    qs: number;
    maskImage: SkImage;
    paint: SkPaint;
    reach: number;
    spacingPx: number;
    baselineSnapshot: SkImage;
  }) {
    this.strokeId = args.strokeId;
    this.surface = args.surface;
    this.procW = args.procW;
    this.procH = args.procH;
    this.qs = args.qs;
    this.ps = DPR * args.qs;
    this.maskImage = args.maskImage;
    this.paint = args.paint;
    this.reach = args.reach;
    this.spacingPx = args.spacingPx;
    this.baselineSnapshot = args.baselineSnapshot;
  }

  static begin(
    committedSnapshot: SkImage | null,
    stroke: Stroke,
    surfaceWpx: number,
    surfaceHpx: number,
    resolveStamp: (emoji: string, size: number) => { image: SkImage } | null
  ): GpuLiveSmudgeSession | null {
    if (!stroke.isSmudge || stroke.points.length === 0 || !isGpuSmudgeAvailable()) {
      return null;
    }
    const brushDevicePx = Math.max(2, stroke.size * DPR);
    const qs = qualityScale(brushDevicePx);
    // Emoji mask at the proc-resolution footprint (size*qs → px = size*qs*DPR = proc footprint).
    const stamp = resolveStamp(stroke.emoji, Math.max(1, stroke.size * qs));
    if (!stamp?.image) {
      return null;
    }
    const procW = Math.max(1, Math.round(surfaceWpx * qs));
    const procH = Math.max(1, Math.round(surfaceHpx * qs));
    const surface = acquireSurface(procW, procH);
    if (!surface) {
      return null;
    }
    const paint = Skia.Paint();
    const canvas = surface.getCanvas();
    canvas.clear(TRANSPARENT);
    if (committedSnapshot) {
      paint.setBlendMode(BlendMode.SrcOver);
      paint.setAlphaf(1);
      const src = Skia.XYWHRect(0, 0, committedSnapshot.width(), committedSnapshot.height());
      const dst = Skia.XYWHRect(0, 0, procW, procH); // scales committed (device) → proc res
      canvas.drawImageRect(committedSnapshot, src, dst, paint);
    }
    surface.flush();
    const baselineSnapshot = surface.makeImageSnapshot();

    const brushSizeProc = Math.max(2, brushDevicePx * qs);
    const spacingPx = Math.max(3, brushSizeProc * smudgeSpacing);
    const session = new GpuLiveSmudgeSession({
      strokeId: stroke.id,
      surface,
      procW,
      procH,
      qs,
      maskImage: stamp.image,
      paint,
      reach: reachForStroke(stroke, brushSizeProc),
      spacingPx,
      baselineSnapshot
    });
    session.lastPx = stroke.points[0].x * session.ps;
    session.lastPy = stroke.points[0].y * session.ps;
    session.lastPointsRef = stroke.points;
    session.processedSourceCount = stroke.points.length;
    if (stroke.points.length > 1) {
      session.applyRange(stroke.points, 1, stroke.points.length);
    }
    session.refreshOverlay();
    return session;
  }

  private growDirty(rect: SmudgeRegion | null): void {
    if (!rect) {
      return;
    }
    if (!this.dirtyRect) {
      this.dirtyRect = { ...rect };
      return;
    }
    const d = this.dirtyRect;
    const minX = Math.min(d.x, rect.x);
    const minY = Math.min(d.y, rect.y);
    const maxX = Math.max(d.x + d.w, rect.x + rect.w);
    const maxY = Math.max(d.y + d.h, rect.y + rect.h);
    d.x = minX;
    d.y = minY;
    d.w = maxX - minX;
    d.h = maxY - minY;
  }

  private applyRange(points: StrokePoint[], start: number, end: number): void {
    const dabs: SmudgeDab[] = [];
    for (let i = start; i < end && dabs.length < MAX_DABS_PER_FRAME; i += 1) {
      const tx = points[i].x * this.ps;
      const ty = points[i].y * this.ps;
      const seg = interpolateDabs(this.lastPx, this.lastPy, tx, ty, this.spacingPx, 8);
      for (let d = 0; d < seg.length && dabs.length < MAX_DABS_PER_FRAME; d += 1) {
        dabs.push(seg[d]);
      }
      this.lastPx = tx;
      this.lastPy = ty;
    }
    if (dabs.length > 0) {
      // One snapshot per frame (resnapshotEvery huge): minimal copy-on-write churn.
      const rect = applyDabsToSurface(
        this.surface,
        this.maskImage,
        this.paint,
        dabs,
        this.reach,
        DEPOSIT_STRENGTH,
        this.procW,
        this.procH,
        9999
      );
      this.growDirty(rect);
    }
  }

  private refreshOverlay(): void {
    if (!this.dirtyRect) {
      return;
    }
    this.surface.flush();
    const r = this.dirtyRect;
    const tex = this.surface.makeImageSnapshot(Skia.XYWHRect(r.x, r.y, r.w, r.h));
    const portable = tex.makeNonTextureImage();
    tex.dispose?.();
    // Report bounds in DEVICE px (proc rect upscaled by 1/qs); the proc image is drawn upscaled.
    const bounds: SmudgeRegion = {
      x: Math.round(r.x / this.qs),
      y: Math.round(r.y / this.qs),
      w: Math.round(r.w / this.qs),
      h: Math.round(r.h / this.qs)
    };
    this.overlays.push({ image: portable, bounds });
    while (this.overlays.length > SNAP_RING) {
      this.overlays.shift()?.image.dispose?.();
    }
  }

  update(stroke: Stroke): void {
    if (!this.active || stroke.id !== this.strokeId || stroke.points.length === 0) {
      this.changed = false;
      return;
    }
    const isReplace = stroke.points !== this.lastPointsRef;
    this.lastPointsRef = stroke.points;

    if (isReplace) {
      this.paint.setShader(null);
      this.paint.setBlendMode(BlendMode.Src);
      this.paint.setAlphaf(1);
      const c = this.surface.getCanvas();
      const full = Skia.XYWHRect(0, 0, this.procW, this.procH);
      c.drawImageRect(this.baselineSnapshot, full, full, this.paint);
      this.surface.flush();
      this.lastPx = stroke.points[0].x * this.ps;
      this.lastPy = stroke.points[0].y * this.ps;
      this.dirtyRect = null;
      this.applyRange(stroke.points, 1, stroke.points.length);
      this.processedSourceCount = stroke.points.length;
      this.refreshOverlay();
      this.changed = true;
      return;
    }

    const total = stroke.points.length;
    if (total <= this.processedSourceCount) {
      this.changed = false;
      return;
    }
    this.applyRange(stroke.points, this.processedSourceCount, total);
    this.processedSourceCount = total;
    this.refreshOverlay();
    this.changed = true;
  }

  consumeDirty(): boolean {
    const c = this.changed;
    this.changed = false;
    return c;
  }

  getOverlay(): SmudgeOverlay | null {
    return this.overlays.length > 0 ? this.overlays[this.overlays.length - 1] : null;
  }

  end(): void {
    this.active = false;
    this.baselineSnapshot.dispose?.();
    for (let i = 0; i < this.overlays.length - 1; i += 1) {
      this.overlays[i].image.dispose?.();
    }
    this.overlays.length = 0;
    releaseSurface(this.procW, this.procH, this.surface);
  }
}
