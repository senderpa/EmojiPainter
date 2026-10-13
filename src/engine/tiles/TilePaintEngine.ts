/**
 * TilePaintEngine — live painting core for the main workspace.
 *
 * Rendering uses ONE backing raster surface (seamless display — no inter-tile cracks), drawn
 * INCREMENTALLY: a new committed stroke is stamped straight onto the surface (cost ∝ the stroke, not
 * the painting history). The tile grid is used for UNDO and (later) tile-local smudge: before a stroke
 * draws, we snapshot the pixels of the tiles it touches; undo blits those region images back
 * (O(affected tiles), never a full replay).
 *
 * `strokes[]` (PaintingContext) stays the source of truth / command log — this engine mirrors it.
 * Handles non-smudge strokes (normal / eraser / plane / sequence / custom PNG); smudge paintings are
 * routed to the legacy EmojiCanvas by PaintCanvas (tile-local smudge is a later phase).
 */
import { PixelRatio } from 'react-native';
import { Skia, type SkImage, type SkPaint, type SkSurface } from '@shopify/react-native-skia';

import type { Stroke } from '../../state/PaintingContext';
import { appendStrokeToSurface } from '../../components/EmojiCanvas';
import { blitTile, cropToTile } from '../../lib/smudge/gpuSmudge';
import {
  DEFAULT_TILE_SIZE_PX,
  pointsBounds,
  rectToTiles,
  tileKey,
  tileRect,
  type PixelRect,
  type TileGridConfig
} from './tileMath';

const DPR = PixelRatio.get();
const TRANSPARENT = Skia.Color('rgba(0,0,0,0)');

/** How many committed strokes' undo snapshots to retain (app allows up to 10 undo + redo headroom). */
const MAX_UNDO_ENTRIES = 30;

interface UndoEntry {
  strokeId: string;
  /** Affected tile rects (device px) + the surface pixels there BEFORE this stroke (owned until evicted). */
  regions: Array<{ rect: PixelRect; image: SkImage }>;
}

const disposeImage = (img: SkImage | null | undefined) => img?.dispose?.();

export class TilePaintEngine {
  private cfg: TileGridConfig;
  private widthDip: number;
  private heightDip: number;
  private surface: SkSurface | null;
  /** Current backing snapshot shown on screen (one seamless image). */
  private displayImage: SkImage | null = null;
  private processedIds: string[] = [];
  private undoStack: UndoEntry[] = [];
  private paint: SkPaint;
  private blitPaint: SkPaint;
  /** Bumped whenever the display image changes, so React re-reads getDisplayImage(). */
  version = 0;

  constructor(widthDip: number, heightDip: number, tileSizePx = DEFAULT_TILE_SIZE_PX) {
    this.widthDip = widthDip;
    this.heightDip = heightDip;
    this.cfg = {
      widthPx: Math.max(1, Math.floor(widthDip * DPR)),
      heightPx: Math.max(1, Math.floor(heightDip * DPR)),
      tileSizePx
    };
    this.paint = Skia.Paint();
    this.paint.setAntiAlias(true);
    this.blitPaint = Skia.Paint();
    this.surface = Skia.Surface.Make(this.cfg.widthPx, this.cfg.heightPx);
    if (this.surface) {
      this.surface.getCanvas().clear(TRANSPARENT);
      this.displayImage = this.surface.makeImageSnapshot();
    }
  }

  /** Device-pixel dirty rect for a stroke (whole canvas for planes, point-bounds + stamp pad otherwise). */
  private strokeDirtyRect(stroke: Stroke): PixelRect | null {
    if (stroke.isPlane) {
      return { x: 0, y: 0, w: this.cfg.widthPx, h: this.cfg.heightPx };
    }
    if (stroke.points.length === 0) {
      return null;
    }
    let maxSize = stroke.size;
    const ptsPx = new Array<{ x: number; y: number }>(stroke.points.length);
    for (let i = 0; i < stroke.points.length; i += 1) {
      const p = stroke.points[i];
      ptsPx[i] = { x: p.x * DPR, y: p.y * DPR };
      if (typeof p.w === 'number' && p.w > maxSize) {
        maxSize = p.w;
      }
    }
    // An emoji stamp can reach ~0.9*size beyond its center; pad generously so the undo region fully
    // covers every pixel the stroke changes (otherwise undo could leave residue at stamp edges).
    const pad = maxSize * DPR * 1.0 + 8;
    return pointsBounds(ptsPx, pad);
  }

  /** Tile rects (device px, clamped) the stroke touches — the regions we snapshot for undo. */
  private affectedTileRects(stroke: Stroke): PixelRect[] {
    const rect = this.strokeDirtyRect(stroke);
    if (!rect) {
      return [];
    }
    const seen = new Set<string>();
    const rects: PixelRect[] = [];
    for (const t of rectToTiles(rect, this.cfg)) {
      const key = tileKey(t.col, t.row);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const r = tileRect(t.col, t.row, this.cfg);
      if (r.w > 0 && r.h > 0) {
        rects.push(r);
      }
    }
    return rects;
  }

  /** Apply one new committed stroke: snapshot affected tiles for undo, then stamp it onto the surface. */
  private applyStroke(stroke: Stroke) {
    if (!this.surface || !this.displayImage) {
      return;
    }
    const rects = this.affectedTileRects(stroke);
    // Prior pixels for undo come from the CURRENT display image (= surface state before this stroke).
    const regions: Array<{ rect: PixelRect; image: SkImage }> = [];
    for (let i = 0; i < rects.length; i += 1) {
      const img = cropToTile(this.displayImage, {
        x: rects[i].x,
        y: rects[i].y,
        w: rects[i].w,
        h: rects[i].h
      });
      if (img) {
        regions.push({ rect: rects[i], image: img });
      }
    }
    const canvas = this.surface.getCanvas();
    appendStrokeToSurface(canvas, stroke, this.widthDip, this.heightDip, this.paint, this.cfg.widthPx, this.cfg.heightPx);
    this.refreshDisplay();
    this.undoStack.push({ strokeId: stroke.id, regions });
    this.trimUndo();
  }

  private refreshDisplay() {
    if (!this.surface) {
      return;
    }
    disposeImage(this.displayImage);
    this.displayImage = this.surface.makeImageSnapshot();
    this.version += 1;
  }

  private trimUndo() {
    while (this.undoStack.length > MAX_UNDO_ENTRIES) {
      const evicted = this.undoStack.shift();
      if (evicted) {
        for (const r of evicted.regions) {
          disposeImage(r.image);
        }
      }
    }
  }

  /** Undo the last applied stroke by blitting its prior tile regions back. False if not possible. */
  private undoLast(expectedId: string): boolean {
    if (!this.surface) {
      return false;
    }
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry || entry.strokeId !== expectedId) {
      return false; // prior evicted / out of order → caller will full-rebuild
    }
    this.undoStack.pop();
    const canvas = this.surface.getCanvas();
    for (const r of entry.regions) {
      // blitTile draws with BlendMode.Src, which REPLACES the destination pixels in the tile rect with
      // the prior image — an exact restore, no clear/clip needed.
      blitTile(canvas, r.image, { x: r.rect.x, y: r.rect.y, w: r.rect.w, h: r.rect.h }, this.blitPaint);
      disposeImage(r.image);
    }
    this.refreshDisplay();
    return true;
  }

  private fullRebuild(strokes: Stroke[]) {
    if (!this.surface) {
      return;
    }
    for (const entry of this.undoStack) {
      for (const r of entry.regions) {
        disposeImage(r.image);
      }
    }
    this.undoStack = [];
    this.processedIds = [];
    this.surface.getCanvas().clear(TRANSPARENT);
    this.refreshDisplay();
    for (let i = 0; i < strokes.length; i += 1) {
      if (strokes[i].isSmudge) {
        this.processedIds.push(strokes[i].id);
        continue;
      }
      this.applyStroke(strokes[i]);
      this.processedIds.push(strokes[i].id);
    }
  }

  /**
   * Reconcile the backing surface with the committed strokes array. Fast paths: append (new strokes at
   * the end) and undo (strokes removed from the end). Any other divergence triggers a full rebuild.
   * Returns true if the display changed.
   */
  sync(strokes: Stroke[]): boolean {
    if (!this.surface) {
      return false;
    }
    const target = strokes.length;
    const processed = this.processedIds.length;

    let prefix = 0;
    const limit = Math.min(processed, target);
    while (prefix < limit && this.processedIds[prefix] === strokes[prefix].id) {
      prefix += 1;
    }

    if (prefix < Math.min(processed, target)) {
      this.fullRebuild(strokes);
      return true;
    }

    if (target === processed) {
      return false;
    }

    if (target < processed) {
      for (let i = processed - 1; i >= target; i -= 1) {
        const id = this.processedIds[i];
        const top = this.undoStack[this.undoStack.length - 1];
        if (top && top.strokeId === id) {
          if (!this.undoLast(id)) {
            this.fullRebuild(strokes);
            return true;
          }
        }
        // else: stroke had no undo entry (smudge/defensive) → nothing to restore.
      }
      this.processedIds = this.processedIds.slice(0, target);
      return true;
    }

    for (let i = processed; i < target; i += 1) {
      const stroke = strokes[i];
      if (stroke.isSmudge) {
        this.processedIds.push(stroke.id);
        continue;
      }
      this.applyStroke(stroke);
      this.processedIds.push(stroke.id);
    }
    return true;
  }

  /** The current seamless backing snapshot (display this with one <Image fit="fill">). */
  getDisplayImage(): SkImage | null {
    return this.displayImage;
  }

  dispose() {
    for (const entry of this.undoStack) {
      for (const r of entry.regions) {
        disposeImage(r.image);
      }
    }
    this.undoStack = [];
    disposeImage(this.displayImage);
    this.displayImage = null;
    this.surface?.dispose?.();
    this.surface = null;
    this.processedIds = [];
  }
}
