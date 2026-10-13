import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { InteractionManager, PixelRatio } from 'react-native';

import { getSmudgeTile } from '../lib/smudge/smudgeTileCache';
import { encodeTileBase64 } from '../lib/smudge/gpuSmudge';

const SMUDGE_DPR = PixelRatio.get();

import * as FileSystem from 'expo-file-system/legacy';

import { adaptiveDecimatePoints } from '../lib/strokeProcessing';
import { loadAutosave, saveAutosave, clearAutosave, type AutosavePayload } from '../lib/autosave';
import { getActiveLifetimeWorkspace } from '../lib/lifetimeActivity';
import { recordLifetimeStrokeCommit } from '../lib/lifetimeStats';
import AutosaveOverlay from '../components/AutosaveOverlay';

// Snapshot system removed - using stroke replay instead

export interface StrokePoint {
  x: number;
  y: number;
  t: number;
  w?: number; // Width at this point (optional for backward compatibility)
}

/**
 * ── 3-LAYER SYSTEM (main workspace) ────────────────────────────────────────────
 * Every stroke / emoji plane belongs to exactly one of three layers. The field is
 * OPTIONAL on purpose: anything saved before layers existed simply has no `layer`
 * key and MUST behave exactly as it always did, so a missing value resolves to
 * 'middle' (the default painting layer). Never write a migration that stamps the
 * key onto old artwork — `strokeLayer()` is the single place that resolves it.
 */
export type PaintLayer = 'foreground' | 'middle' | 'background';

/** Bottom → top paint order. Rendering ALWAYS follows this, never creation order. */
export const PAINT_LAYER_ORDER: readonly PaintLayer[] = ['background', 'middle', 'foreground'];

export const DEFAULT_PAINT_LAYER: PaintLayer = 'middle';

export type LayerVisibility = Record<PaintLayer, boolean>;

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = Object.freeze({
  background: true,
  middle: true,
  foreground: true
}) as LayerVisibility;

/** The ONE place `?? 'middle'` lives. Use it everywhere instead of repeating the fallback. */
export const strokeLayer = (item: { layer?: PaintLayer } | null | undefined): PaintLayer =>
  item?.layer ?? DEFAULT_PAINT_LAYER;

/** Normalize anything loaded from disk into a complete visibility record. */
export const normalizeLayerVisibility = (value: unknown): LayerVisibility => {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<Record<PaintLayer, unknown>>;
  return {
    background: source.background !== false,
    middle: source.middle !== false,
    foreground: source.foreground !== false
  };
};

export const isPaintLayer = (value: unknown): value is PaintLayer =>
  value === 'foreground' || value === 'middle' || value === 'background';

/**
 * Split into per-layer buckets, preserving relative order inside each bucket.
 * The native Metal engine keeps ONE COMMITTED TEXTURE PER LAYER and reconciles each
 * against its own processedIds; because a stable filter of an append-only array is
 * itself append-only, painting stays on the cheap incremental append path on every
 * layer. (Sorting one flat array would insert before existing ids → full rebuild per
 * stroke — never do that.)
 */
export const splitStrokesByLayer = <T extends { layer?: PaintLayer }>(items: readonly T[]): Record<PaintLayer, T[]> => {
  const buckets: Record<PaintLayer, T[]> = { background: [], middle: [], foreground: [] };
  for (let i = 0; i < items.length; i += 1) {
    buckets[strokeLayer(items[i])].push(items[i]);
  }
  return buckets;
};

/**
 * Flatten into paint order (background → middle → foreground), optionally dropping
 * hidden layers. Returns the SAME array reference when nothing would move and every
 * layer is visible — so paintings that never used layers keep byte-identical render
 * input, identical memo identities, and zero added cost.
 */
export const orderStrokesByLayer = <T extends { layer?: PaintLayer }>(
  items: readonly T[],
  visibility?: LayerVisibility
): T[] => {
  const vis = visibility ?? DEFAULT_LAYER_VISIBILITY;
  const allVisible = vis.background && vis.middle && vis.foreground;
  let needsWork = !allVisible;
  if (!needsWork) {
    let seen = 0; // highest layer index encountered so far
    for (let i = 0; i < items.length; i += 1) {
      const index = PAINT_LAYER_ORDER.indexOf(strokeLayer(items[i]));
      if (index < seen) {
        needsWork = true;
        break;
      }
      seen = index;
    }
  }
  if (!needsWork) {
    return items as T[];
  }
  const buckets = splitStrokesByLayer(items);
  const out: T[] = [];
  for (const layer of PAINT_LAYER_ORDER) {
    if (!vis[layer]) {
      continue;
    }
    for (let i = 0; i < buckets[layer].length; i += 1) {
      out.push(buckets[layer][i]);
    }
  }
  return out;
};

/** Per-layer stroke counts — exposed for the (later) Layers panel UI. */
export const countStrokesByLayer = (items: readonly { layer?: PaintLayer }[]): Record<PaintLayer, number> => {
  const counts: Record<PaintLayer, number> = { background: 0, middle: 0, foreground: 0 };
  for (let i = 0; i < items.length; i += 1) {
    counts[strokeLayer(items[i])] += 1;
  }
  return counts;
};

export interface Stroke {
  id: string;
  emoji: string;
  size: number;
  opacity: number;
  spacing?: number;
  stampSpan?: number;
  points: StrokePoint[];
  emojiSequence?: string[];
  mirrorX?: boolean;
  mirrorY?: boolean;
  rotation?: number;
  isEraser?: boolean;
  // Smudge brush mode: emoji alpha becomes a brush mask that drags existing canvas pixels.
  // When isSmudge is true the emoji is NOT stamped; opacity is ignored. All fields optional so
  // old saved paintings (without these keys) load unchanged as normal strokes.
  isSmudge?: boolean;
  smudgeStrength?: number; // how strongly carried pixels replace canvas pixels (0..1)
  edgeBlendStrength?: number; // smudge "length"/smoothness slider (0..1)
  reloadRate?: number; // how quickly the finger picks up new canvas color (0..1)
  dirtyUpdateRate?: number; // how slowly the finger gets contaminated by the destination (0..1)
  // Baked result of a committed smudge stroke (Procreate/Krita model): the smudged pixels are
  // flattened to a PNG tile so replay/undo/export/timelapse just blit it (no re-mix, deterministic,
  // no GPU re-bake). bakedBounds is in DIP (logical canvas) coords for cross-DPR portability.
  bakedTile?: string; // base64 PNG (no data: prefix) — legacy / lazily derived from the file at export
  // Relative path ("smudge_tiles/<id>.png") of the baked tile FILE written by the native engine. The
  // live/save path carries only this tiny string (not megabytes of base64), which removed the
  // size-scaled post-smudge stall. base64 is read from this file on demand only at export/timelapse.
  bakedTilePath?: string;
  bakedBounds?: { x: number; y: number; w: number; h: number };
  // Frame-by-frame animation metadata (Mac app animator-style)
  startFrame?: number; // Frame index where this stroke starts appearing
  frameDuration?: number; // How many consecutive frames this stroke appears in (like Mac app's stroke length)
  // Plane-specific data for distorted emoji rendering
  isPlane?: boolean;
  /** Baked distortion lattice (see EmojiPlane.lattice). Absent = plain 4-corner homography. */
  planeLattice?: { x: number; y: number }[];
  planeLatticeLevel?: 1 | 2 | 3 | 5;
  planeCorners?: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
  planeCornerHistory?: PlaneCornerSnapshot[]; // Timeline of corner positions for animated timelapse
  planeStampSize?: number; // Size of stamp used during placer (to ensure consistent rendering after commit)
  isCustomEmoji?: boolean; // Whether this plane uses custom emoji (affects texture padding)
  // 3-layer system. Optional for backward compatibility — a stroke without it is 'middle'.
  // Always read through strokeLayer(), never `stroke.layer` directly.
  layer?: PaintLayer;
}

/**
 * ── LAYER OPERATIONS (pure) ───────────────────────────────────────────────────
 * Every one of these takes a stroke list and returns a NEW list; none of them mutate,
 * none of them flatten to pixels, and none of them touch the renderer. The reducer's
 * layer actions are thin wrappers around them so the behaviour is unit-testable and the
 * undo history only ever has to remember two array references (before / after).
 */

/**
 * The four invisible `border_*` strokes define the export bounds (see createBorderStrokes).
 * They carry no `layer` key, so they resolve to 'middle' — but they are canvas plumbing, not
 * artwork, and must survive "Clear Middle Ground" and never be copied.
 */
export const isBorderStroke = (stroke: { id: string }): boolean => stroke.id.startsWith('border_');

/**
 * Flatten per-layer buckets back into one array in canonical paint order
 * (background → middle → foreground). `orderStrokesByLayer()` already DRAWS in this order, so
 * normalising the stored array is a visual no-op — it just makes the raw array agree with what
 * is on screen, which is what lets merge/paste splice content in at exactly the right depth.
 */
const rebuildInPaintOrder = (buckets: Record<PaintLayer, Stroke[]>): Stroke[] => {
  const out: Stroke[] = [];
  for (const layer of PAINT_LAYER_ORDER) {
    const bucket = buckets[layer];
    for (let i = 0; i < bucket.length; i += 1) {
      out.push(bucket[i]);
    }
  }
  return out;
};

/**
 * Re-tag a stroke onto the DEFAULT layer by REMOVING the key (never by writing `layer:'middle'`),
 * matching how commitStroke serializes default-layer strokes — a merged painting stays
 * byte-identical to one that never used layers.
 */
const retargetToMiddle = (stroke: Stroke): Stroke => {
  if (stroke.layer === undefined) {
    return stroke;
  }
  const next: Stroke = { ...stroke };
  delete next.layer;
  return next;
};

/** Strokes actually belonging to a layer — border plumbing excluded. */
export const strokesForLayer = (items: readonly Stroke[], layer: PaintLayer): Stroke[] =>
  items.filter((stroke) => strokeLayer(stroke) === layer && !isBorderStroke(stroke));

/** Real (non-border) stroke count per layer — what the Layers panel shows on each row. */
export const countArtworkStrokesByLayer = (items: readonly Stroke[]): Record<PaintLayer, number> => {
  const counts: Record<PaintLayer, number> = { background: 0, middle: 0, foreground: 0 };
  for (let i = 0; i < items.length; i += 1) {
    if (!isBorderStroke(items[i])) {
      counts[strokeLayer(items[i])] += 1;
    }
  }
  return counts;
};

/**
 * FIXED merge: Foreground merges DOWN into Middle, Background merges UP into Middle. Middle never
 * moves and nothing is ever reordered arbitrarily.
 *
 * Appearance is preserved exactly because the merge only re-tags the `layer` key and re-splices the
 * SAME stroke objects so their draw order is unchanged: foreground content stays after every middle
 * stroke, background content stays before every middle stroke. Nothing is rasterised, so alpha
 * compositing is whatever the renderer already did for that identical sequence.
 */
export const mergeLayerIntoMiddle = (
  items: readonly Stroke[],
  from: 'foreground' | 'background'
): Stroke[] => {
  const buckets = splitStrokesByLayer(items as Stroke[]);
  if (buckets[from].length === 0) {
    return items as Stroke[];
  }
  const moved = buckets[from].map(retargetToMiddle);
  return rebuildInPaintOrder({
    background: from === 'background' ? [] : buckets.background,
    middle: from === 'foreground' ? [...buckets.middle, ...moved] : [...moved, ...buckets.middle],
    foreground: from === 'foreground' ? [] : buckets.foreground
  });
};

/** Drop every artwork stroke on one layer. Border plumbing is deliberately kept. */
export const clearLayerStrokes = (items: readonly Stroke[], layer: PaintLayer): Stroke[] => {
  const next = items.filter((stroke) => strokeLayer(stroke) !== layer || isBorderStroke(stroke));
  return next.length === items.length ? (items as Stroke[]) : next;
};

let layerCloneCounter = 0;

/**
 * Copy/paste clones the real stroke DATA — points, emoji, size, opacity, mirror, rotation, smudge
 * bake references — and only swaps the id and the target layer. It is never a flattened screenshot,
 * so pasted content is still fully editable/undoable/exportable like anything else on the canvas.
 */
export const cloneStrokesForLayer = (items: readonly Stroke[], layer: PaintLayer): Stroke[] => {
  const stamp = Date.now();
  return items
    .filter((stroke) => !isBorderStroke(stroke))
    .map((stroke) => {
      layerCloneCounter += 1;
      const clone: Stroke = {
        ...stroke,
        id: `layercopy_${stamp}_${layerCloneCounter}`,
        points: stroke.points.map((point) => ({ ...point })),
        emojiSequence: stroke.emojiSequence ? stroke.emojiSequence.slice() : undefined,
        layer
      };
      if (layer === DEFAULT_PAINT_LAYER) {
        delete clone.layer;
      }
      return clone;
    });
};

/** Append already-cloned strokes on top of the content their own layer already holds. */
export const insertStrokesOnLayer = (items: readonly Stroke[], pasted: readonly Stroke[]): Stroke[] => {
  if (pasted.length === 0) {
    return items as Stroke[];
  }
  const buckets = splitStrokesByLayer(items as Stroke[]);
  const addition = splitStrokesByLayer(pasted as Stroke[]);
  return rebuildInPaintOrder({
    background: [...buckets.background, ...addition.background],
    middle: [...buckets.middle, ...addition.middle],
    foreground: [...buckets.foreground, ...addition.foreground]
  });
};

export interface TraceState {
  imageUri: string | null;
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  rotation: number;
  isBackground: boolean;
}

export interface PlaneCornerSnapshot {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  timestamp: number; // When this corner state occurred
}

export interface EmojiPlane {
  id: string;
  emoji: string;
  corners: {
    topLeft: { x: number; y: number };
    topMid: { x: number; y: number };
    topRight: { x: number; y: number };
    rightMid: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomMid: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    leftMid: { x: number; y: number };
  };
  /**
   * Optional distortion lattice. When present it SUPERSEDES `corners` for rendering, letting the
   * interior of the emoji be bent rather than only its outline.
   *
   * Optional on purpose: a plane without it renders through the original 4-corner homography, so
   * every existing painting and every saved project is unchanged. `corners` is always kept in
   * sync with the lattice edge points so code that only understands corners keeps working.
   */
  lattice?: { x: number; y: number }[];
  latticeLevel?: 1 | 2 | 3 | 5;
  timestamp: number; // Initial creation timestamp
  cornerHistory: PlaneCornerSnapshot[]; // Timeline of corner positions for timelapse
  opacity: number;
  /** Absolute values shown by the compact plane transform controls. Geometry is already transformed. */
  rotation?: number;
  scale?: number;
  visible?: boolean; // Defaults to true when omitted
  zIndex: number;
  // 3-layer system — same optional/back-compat contract as Stroke.layer. Carried onto the
  // baked stroke when the plane is committed.
  layer?: PaintLayer;
}

/**
 * One reversible LAYER operation (clear / paste / merge / duplicate).
 *
 * Normal painting undo is a tail-pop: UNDO slices the last stroke off the end. Layer operations
 * splice in the middle of the array, so a tail-pop cannot express them. Instead of bolting on a
 * second undo system with its own button, a layer op records the two array references it moved
 * BETWEEN and rides the SAME 'UNDO' / 'REDO' actions the toolbar already dispatches.
 *
 * Ordering stays correct because `after.strokes.length` pins the op to a stroke count: a layer op is
 * only replayed once the tail-pop path has walked the stroke count back to that number, so painting
 * and layer ops undo in strict reverse-chronological order.
 */
export interface LayerHistoryEntry {
  before: { strokes: Stroke[]; undoStack: Stroke[] };
  after: { strokes: Stroke[]; undoStack: Stroke[] };
}

export interface PaintingState {
  strokes: Stroke[];
  undoStack: Stroke[];
  /** Layer ops waiting to be undone (newest first). Part of the ONE painter history. */
  layerUndoStack: LayerHistoryEntry[];
  /** Layer ops that were undone and can be redone (newest first). */
  layerRedoStack: LayerHistoryEntry[];
  emojiPlanes: EmojiPlane[];
  planeUndoStack: EmojiPlane[][];
  /** Plane snapshots undone via UNDO_PLANE, replayable via REDO_PLANE (newest first). */
  planeRedoStack: EmojiPlane[][];
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  brushRotation: number;
  brushMode: BrushMode;
  smudgeSmoothness: number; // 0 = pure smear (not smooth), ~0.5 default, up to 1 = very creamy
  recentEmojis: string[];
  trace: TraceState;
  mirrorX: boolean;
  mirrorY: boolean;
  /** Layer new strokes / committed planes are placed on. Part of the painter data model. */
  activeLayer: PaintLayer;
  /** Per-layer visibility. A hidden layer renders nothing but KEEPS all its content. */
  layerVisibility: LayerVisibility;
}

// Brush paint mode cycled by the opacity/mode toggle button:
//   opaque (full)  →  transparent (dim)  →  smudge (drag pixels)  →  opaque ...
export type BrushMode = 'opaque' | 'transparent' | 'smudge';

// Max brush size while smudging (keeps it fast and avoids broad whole-canvas smearing/pixelation).
export const SMUDGE_MAX_BRUSH_SIZE = 300;

type PaintingAction =
  | { type: 'SET_BRUSH_EMOJI'; emoji: string }
  | { type: 'SET_RECENT_EMOJIS'; emojis: string[] }
  | { type: 'SET_BRUSH_SIZE'; size: number }
  | { type: 'SET_BRUSH_OPACITY'; opacity: number }
  | { type: 'SET_BRUSH_MODE'; mode: BrushMode }
  | { type: 'SET_SMUDGE_SMOOTHNESS'; value: number }
  | { type: 'SET_BRUSH_SPACING'; spacing: number }
  | { type: 'SET_BRUSH_ROTATION'; rotation: number }
  | { type: 'SET_MIRROR_X'; value: boolean }
  | { type: 'SET_MIRROR_Y'; value: boolean }
  | { type: 'UNDO'; count?: number }
  | { type: 'REDO'; count?: number }
  | { type: 'CLEAR_STROKES' }
  | { type: 'SET_SMUDGE_BAKE'; strokeId: string; bakedTilePath: string; bakedBounds: { x: number; y: number; w: number; h: number } }
  | { type: 'SET_TRACE'; trace: Partial<TraceState> }
  | { type: 'SET_ACTIVE_LAYER'; layer: PaintLayer }
  | { type: 'SET_LAYER_VISIBILITY'; layer: PaintLayer; visible: boolean }
  | { type: 'TOGGLE_LAYER_VISIBILITY'; layer: PaintLayer }
  | { type: 'CLEAR_LAYER'; layer: PaintLayer }
  | { type: 'MERGE_LAYER_INTO_MIDDLE'; from: 'foreground' | 'background' }
  /** `strokes` must already be cloned + re-targeted by cloneStrokesForLayer(). */
  | { type: 'PASTE_LAYER_STROKES'; strokes: Stroke[] }
  | { type: 'RESET' }
  | { type: 'COMMIT_STROKE'; stroke: Stroke }
  | { type: 'ADD_EMOJI_PLANE'; plane: EmojiPlane }
  | { type: 'UPDATE_EMOJI_PLANE'; planeId: string; updates: Partial<EmojiPlane> }
  | { type: 'DELETE_EMOJI_PLANE'; planeId: string }
  | { type: 'SET_EMOJI_PLANES'; planes: EmojiPlane[] }
  | { type: 'UNDO_PLANE' }
  | { type: 'REDO_PLANE' }
  | { type: 'LOAD_STATE';
      payload: {
        strokes: Stroke[];
        brushEmoji: string;
        brushSize: number;
        brushOpacity: number;
        brushSpacing: number;
        brushRotation?: number;
        brushMode?: BrushMode;
        mirrorX?: boolean;
        mirrorY?: boolean;
        recentEmojis?: string[];
        trace: TraceState;
        emojiPlanes?: EmojiPlane[];
        activeLayer?: PaintLayer;
        layerVisibility?: Partial<LayerVisibility>;
      }
    };

// Create visible border strokes to define export bounds
// These are drawn in viewport coordinates and will be animated on start
function createBorderStrokes(): Stroke[] {
  const { width: screenWidth, height: screenHeight } = require('react-native').Dimensions.get('window');
  const isIpad = screenWidth >= 768;
  const canvasSize = Math.min(screenWidth, screenHeight * 0.85) * (isIpad ? 0.8 : 1);

  const padding = 10; // Small padding from edges
  const timestamp = Date.now();
  const duration = 2000; // 2 second animation

  // Create strokes along all four edges of the canvas
  // Fully transparent border strokes to define export bounds without being visible
  return [
    // Top edge (animate from left to right)
    {
      id: `border_top_${timestamp}`,
      emoji: '⬜',
      size: 2,
      opacity: 0,
      spacing: 0.01,
      points: [
        { x: padding, y: padding, t: 0 },
        { x: canvasSize - padding, y: padding, t: duration * 0.25 }
      ]
    },
    // Right edge (animate from top to bottom)
    {
      id: `border_right_${timestamp}`,
      emoji: '⬜',
      size: 2,
      opacity: 0,
      spacing: 0.01,
      points: [
        { x: canvasSize - padding, y: padding, t: duration * 0.25 },
        { x: canvasSize - padding, y: canvasSize - padding, t: duration * 0.5 }
      ]
    },
    // Bottom edge (animate from right to left)
    {
      id: `border_bottom_${timestamp}`,
      emoji: '⬜',
      size: 2,
      opacity: 0,
      spacing: 0.01,
      points: [
        { x: canvasSize - padding, y: canvasSize - padding, t: duration * 0.5 },
        { x: padding, y: canvasSize - padding, t: duration * 0.75 }
      ]
    },
    // Left edge (animate from bottom to top)
    {
      id: `border_left_${timestamp}`,
      emoji: '⬜',
      size: 2,
      opacity: 0,
      spacing: 0.01,
      points: [
        { x: padding, y: canvasSize - padding, t: duration * 0.75 },
        { x: padding, y: padding, t: duration }
      ]
    }
  ];
}

const initialState: PaintingState = {
  strokes: createBorderStrokes(),
  undoStack: [],
  layerUndoStack: [],
  layerRedoStack: [],
  emojiPlanes: [],
  planeUndoStack: [],
  planeRedoStack: [],
  brushEmoji: '😀',
  brushSize: 24,
  brushOpacity: 1,
  brushSpacing: 0.001, // Minimum spacing for tight emoji placement
  brushRotation: 0,
  brushMode: 'opaque',
  smudgeSmoothness: 0.5,
  recentEmojis: ['😀'],
  trace: {
    imageUri: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    opacity: 0.3,
    rotation: 0,
    isBackground: false
  },
  mirrorX: false,
  mirrorY: false,
  activeLayer: DEFAULT_PAINT_LAYER,
  layerVisibility: { ...DEFAULT_LAYER_VISIBILITY }
};

// The native Metal engine bakes committed strokes into a persistent texture, so per-frame render cost
// is O(1) regardless of stroke count — the cap is now a MEMORY guardrail, not a perf wall. Normal
// strokes are light (just point data); smudge strokes each hold a heavy baked PNG tile, so they get a
// tighter sub-cap. Both are enforced in PaintScreen before commit; MAX_HISTORY is the reducer-level
// FIFO safety net kept just above the user-facing cap so it never silently trims a painting.
export const MAX_STROKES = 8000;        // total strokes a user can paint on one canvas
export const MAX_SMUDGE_STROKES = 600;  // smudges specifically (each carries a base64 baked tile)
const MAX_HISTORY = MAX_STROKES + 200;
const MAX_UNDO_STACK = 10; // Remember last 10 strokes for undo/redo
const SMOOTH_SEGMENTS = 4;
const MAX_RECENT_EMOJIS = 50;
const DEFAULT_PROJECT_ID = 'active-session';
const AUTOSAVE_IDLE_THRESHOLD_MS = 3000;
const AUTOSAVE_ACTIVATION_DURATION_MS = 60_000;
const AUTOSAVE_ACTIVATION_MIN_STROKES = 5;

function updateRecentEmojis(current: string[], next: string): string[] {
  const existing = current.filter((emoji) => emoji !== next);
  return [next, ...existing].slice(0, MAX_RECENT_EMOJIS);
}

function distance(a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function smoothStrokePoints(points: StrokePoint[]): StrokePoint[] {
  if (points.length < 3) {
    return points.slice();
  }
  const result: StrokePoint[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = i === 0 ? points[i] : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < points.length ? points[i + 2] : p2;

    result.push(p1);

    for (let step = 1; step < SMOOTH_SEGMENTS; step += 1) {
      const t = step / SMOOTH_SEGMENTS;
      const t2 = t * t;
      const t3 = t2 * t;
      const a0 = -0.5 * t3 + t2 - 0.5 * t;
      const a1 = 1.5 * t3 - 2.5 * t2 + 1;
      const a2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
      const a3 = 0.5 * t3 - 0.5 * t2;

      const x = a0 * p0.x + a1 * p1.x + a2 * p2.x + a3 * p3.x;
      const y = a0 * p0.y + a1 * p1.y + a2 * p2.y + a3 * p3.y;
      const tStamp = p1.t + (p2.t - p1.t) * t;
      result.push({ x, y, t: tStamp });
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function smoothStroke(stroke: Stroke): Stroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
    emojiSequence: stroke.emojiSequence ? stroke.emojiSequence.slice() : undefined
  };
}

const cloneStrokeDeep = (stroke: Stroke): Stroke => ({
  ...stroke,
  points: stroke.points.map((point) => ({ ...point })),
  emojiSequence: stroke.emojiSequence ? stroke.emojiSequence.slice() : undefined
});

// Encode any committed smudge tiles to PNG for persistence — done here (autosave, on idle) rather
// than at stroke commit, where a synchronous encode blocked the next stroke. Mutates the stroke's
// bakedTile/bakedBounds (metadata only) so storage saves carry it too. Skips already-encoded ones.
const ensureSmudgeTilesEncoded = (strokes: Stroke[]): void => {
  for (let i = 0; i < strokes.length; i += 1) {
    const s = strokes[i];
    if (!s.isSmudge || s.bakedTile) {
      continue;
    }
    const tile = getSmudgeTile(s.id);
    if (!tile) {
      continue;
    }
    const b64 = encodeTileBase64(tile.image);
    if (b64) {
      s.bakedTile = b64;
      s.bakedBounds = {
        x: tile.bounds.x / SMUDGE_DPR,
        y: tile.bounds.y / SMUDGE_DPR,
        w: tile.bounds.w / SMUDGE_DPR,
        h: tile.bounds.h / SMUDGE_DPR
      };
    }
  }
};

const clonePaintingForAutosave = (state: PaintingState): AutosavePayload['painting'] => {
  ensureSmudgeTilesEncoded(state.strokes);
  return ({
  // Shallow slice is safe: JSON.stringify runs synchronously before any state mutation,
  // and reducer strokes are never mutated in-place after being committed.
  strokes: state.strokes.slice(),
  // Don't persist brushEmoji - always pick a fresh random emoji on app start
  brushEmoji: '😀', // Will be overridden by randomEmojiOnStart
  brushSize: state.brushSize,
  brushOpacity: state.brushOpacity,
  brushSpacing: state.brushSpacing,
  brushRotation: state.brushRotation,
  brushMode: state.brushMode,
  recentEmojis: state.recentEmojis.slice(),
  trace: { ...state.trace },
  mirrorX: state.mirrorX,
  mirrorY: state.mirrorY,
  activeLayer: state.activeLayer,
  layerVisibility: { ...state.layerVisibility }
  });
};

/**
 * Apply a layer operation and record it on the shared painter history.
 * Painting a new stroke (COMMIT_STROKE) clears the redo side, exactly like it already does for the
 * stroke redo buffer, so the two halves of the history can never drift apart.
 */
function applyLayerOperation(state: PaintingState, nextStrokes: Stroke[]): PaintingState {
  if (nextStrokes === state.strokes) {
    return state;
  }
  const entry: LayerHistoryEntry = {
    before: { strokes: state.strokes, undoStack: state.undoStack },
    after: { strokes: nextStrokes, undoStack: [] }
  };
  return {
    ...state,
    strokes: nextStrokes,
    undoStack: [],
    layerUndoStack: [entry, ...state.layerUndoStack].slice(0, MAX_UNDO_STACK),
    layerRedoStack: []
  };
}

function paintingReducer(state: PaintingState, action: PaintingAction): PaintingState {
  switch (action.type) {
    case 'SET_BRUSH_EMOJI': {
      // When setting transparent emoji (''), also set opacity to near-zero
      // When setting a visible emoji, restore opacity if it was near-zero
      const isTransparent = action.emoji === '';
      const wasTransparent = state.brushEmoji === '';
      let newOpacity = state.brushOpacity;

      if (isTransparent && !wasTransparent) {
        // Switching to transparent: set opacity to near-zero
        newOpacity = 0.01;
      } else if (!isTransparent && wasTransparent) {
        // Switching from transparent to visible: restore full opacity
        newOpacity = 1.0;
      }

      return {
        ...state,
        brushEmoji: action.emoji,
        brushOpacity: newOpacity,
        // Only update recent emojis if emoji is not empty (not transparent)
        recentEmojis: isTransparent ? state.recentEmojis : updateRecentEmojis(state.recentEmojis, action.emoji)
      };
    }
    case 'SET_RECENT_EMOJIS': {
      // Sync recent emojis from FramerWorkspace back to PaintingContext
      // Allows both workspaces to share the same recent emoji list
      return {
        ...state,
        recentEmojis: action.emojis
      };
    }
    case 'SET_BRUSH_SIZE':
      return { ...state, brushSize: action.size };
    case 'SET_BRUSH_OPACITY':
      return { ...state, brushOpacity: action.opacity };
    case 'SET_BRUSH_MODE': {
      // opaque/transparent also drive brushOpacity (existing two-state behavior); smudge keeps it.
      if (action.mode === 'opaque') {
        return { ...state, brushMode: 'opaque', brushOpacity: 1 };
      }
      if (action.mode === 'transparent') {
        return { ...state, brushMode: 'transparent', brushOpacity: 0.01 };
      }
      return { ...state, brushMode: 'smudge' };
    }
    case 'SET_SMUDGE_SMOOTHNESS':
      return { ...state, smudgeSmoothness: Math.max(0, Math.min(1, action.value)) };
    case 'SET_BRUSH_SPACING':
      return { ...state, brushSpacing: action.spacing };
    case 'SET_BRUSH_ROTATION':
      return { ...state, brushRotation: action.rotation };
    case 'COMMIT_STROKE': {
      // action.stroke is already decimated + cloned by commitStroke() — no re-clone needed.
      // Build the new array in one pass to avoid creating an oversized array just to slice it.
      const prevStrokes = state.strokes;
      const newStrokes = prevStrokes.length >= MAX_HISTORY
        ? [...prevStrokes.slice(-(MAX_HISTORY - 1)), action.stroke]
        : [...prevStrokes, action.stroke];
      // Painting invalidates the redo side of BOTH halves of the one history.
      return {
        ...state,
        strokes: newStrokes,
        undoStack: [],
        layerRedoStack: state.layerRedoStack.length === 0 ? state.layerRedoStack : []
      };
    }
    case 'SET_SMUDGE_BAKE': {
      // The native Metal smudge wrote its result tile to a FILE; store only the tiny relative PATH (+
      // bounds) on the stroke — never megabytes of base64 in state (that was the size-scaled post-smudge
      // stall). base64 is read from the file lazily at export/timelapse. Immutable update.
      let changed = false;
      const newStrokes = state.strokes.map((s) => {
        if (s.id !== action.strokeId || !s.isSmudge) return s;
        changed = true;
        return { ...s, bakedTilePath: action.bakedTilePath, bakedBounds: action.bakedBounds };
      });
      return changed ? { ...state, strokes: newStrokes } : state;
    }
    case 'SET_MIRROR_X':
      return {
        ...state,
        mirrorX: action.value
      };
    case 'SET_MIRROR_Y':
      return {
        ...state,
        mirrorY: action.value
      };
    case 'LOAD_STATE': {
      let strokes = action.payload.strokes ?? [];
      if (!Array.isArray(strokes)) {
        console.warn('[LOAD_STATE] Invalid strokes data, expected array, got:', typeof strokes);
        strokes = [];
      }

      // ✅ CRITICAL: Filter out invisible border strokes if they somehow made it in
      // But then ADD NEW border strokes back - they define the canvas bounds!
      const realStrokes = strokes.filter(stroke => !stroke.id.startsWith('border_'));

      if (realStrokes.length < strokes.length) {
        console.log('[LOAD_STATE] 🎨 Filtered out', strokes.length - realStrokes.length, 'old border strokes');
      }

      // ✅ ADD fresh border strokes to define canvas bounds
      const loadedStrokes = [...createBorderStrokes(), ...realStrokes.map(smoothStroke)];
      console.log('[LOAD_STATE] ✅ Loaded', realStrokes.length, 'real strokes + 4 new border strokes = ', loadedStrokes.length, 'total');

      const recentEmojis = action.payload.recentEmojis && Array.isArray(action.payload.recentEmojis)
        ? action.payload.recentEmojis
        : state.recentEmojis;
      return {
        ...state,
        strokes: loadedStrokes,
        undoStack: [],
        layerUndoStack: [],
        layerRedoStack: [],
        emojiPlanes: action.payload.emojiPlanes ?? [],
        planeUndoStack: [],
        planeRedoStack: [],
        brushEmoji: action.payload.brushEmoji,
        brushSize: action.payload.brushSize,
        brushOpacity: action.payload.brushOpacity,
        brushSpacing: action.payload.brushSpacing,
        brushRotation: typeof action.payload.brushRotation === 'number'
          ? action.payload.brushRotation
          : state.brushRotation,
        // Restore the brush mode so the toolbar toggle matches the brush after resume. Fall back to
        // deriving it from opacity for older saves that predate brushMode.
        brushMode: action.payload.brushMode
          ?? (action.payload.brushOpacity <= 0.05 ? 'transparent' : 'opaque'),
        mirrorX: action.payload.mirrorX ?? state.mirrorX,
        mirrorY: action.payload.mirrorY ?? state.mirrorY,
        // Layers restore additively. When the payload OMITS them the current editor state is kept —
        // LOAD_STATE is also how frame-mode switches frames, and switching frames must not silently
        // reset which layer you are painting on or un-hide a layer you hid. Callers that really are
        // opening a different artwork (restorePaintingState) pass explicit values, so a painting
        // saved before layers existed still reopens on the default layer with everything visible.
        activeLayer: isPaintLayer(action.payload.activeLayer) ? action.payload.activeLayer : state.activeLayer,
        layerVisibility: action.payload.layerVisibility
          ? normalizeLayerVisibility(action.payload.layerVisibility)
          : state.layerVisibility,
        recentEmojis: updateRecentEmojis(
          recentEmojis,
          action.payload.brushEmoji
        ),
        trace: { ...action.payload.trace, isBackground: action.payload.trace.isBackground ?? false }
      };
    }
    case 'CLEAR_STROKES':
      return {
        ...state,
        strokes: createBorderStrokes(),
        undoStack: [],
        layerUndoStack: [],
        layerRedoStack: []
      };
    case 'UNDO': {
      // A layer op is only "on top" of the history once the stroke count is back to what it was
      // right after that op ran — that is what interleaves layer ops with plain stroke undo.
      const pendingLayerOp = state.layerUndoStack[0];
      if (pendingLayerOp && pendingLayerOp.after.strokes.length === state.strokes.length) {
        return {
          ...state,
          strokes: pendingLayerOp.before.strokes,
          undoStack: pendingLayerOp.before.undoStack,
          layerUndoStack: state.layerUndoStack.slice(1),
          layerRedoStack: [pendingLayerOp, ...state.layerRedoStack].slice(0, MAX_UNDO_STACK)
        };
      }
      const steps = Math.min(action.count ?? 1, state.strokes.length);
      if (steps === 0) {
        return state;
      }
      const strokes = state.strokes.slice(0, state.strokes.length - steps);
      const undone = state.strokes.slice(-steps);
      const undoStack = [...undone, ...state.undoStack].slice(0, MAX_UNDO_STACK);
      return {
        ...state,
        strokes,
        undoStack
      };
    }
    case 'REDO': {
      const pendingLayerOp = state.layerRedoStack[0];
      if (pendingLayerOp && pendingLayerOp.before.strokes.length === state.strokes.length) {
        return {
          ...state,
          strokes: pendingLayerOp.after.strokes,
          undoStack: pendingLayerOp.after.undoStack,
          layerRedoStack: state.layerRedoStack.slice(1),
          layerUndoStack: [pendingLayerOp, ...state.layerUndoStack].slice(0, MAX_UNDO_STACK)
        };
      }
      const steps = Math.min(action.count ?? 1, state.undoStack.length);
      if (steps === 0) {
        return state;
      }
      const redoItems = state.undoStack.slice(0, steps);
      return {
        ...state,
        strokes: [...state.strokes, ...redoItems],
        undoStack: state.undoStack.slice(steps)
      };
    }
    case 'SET_TRACE':
      return {
        ...state,
        trace: { ...state.trace, ...action.trace }
      };
    case 'SET_ACTIVE_LAYER':
      return state.activeLayer === action.layer ? state : { ...state, activeLayer: action.layer };
    case 'SET_LAYER_VISIBILITY': {
      if (state.layerVisibility[action.layer] === action.visible) {
        return state;
      }
      return {
        ...state,
        layerVisibility: { ...state.layerVisibility, [action.layer]: action.visible }
      };
    }
    case 'TOGGLE_LAYER_VISIBILITY':
      return {
        ...state,
        layerVisibility: { ...state.layerVisibility, [action.layer]: !state.layerVisibility[action.layer] }
      };
    // ── Layer operations. All three go through applyLayerOperation() → the shared undo history. ──
    case 'CLEAR_LAYER':
      return applyLayerOperation(state, clearLayerStrokes(state.strokes, action.layer));
    case 'MERGE_LAYER_INTO_MIDDLE':
      return applyLayerOperation(state, mergeLayerIntoMiddle(state.strokes, action.from));
    case 'PASTE_LAYER_STROKES': {
      if (!Array.isArray(action.strokes) || action.strokes.length === 0) {
        return state;
      }
      // Reducer-level guardrail only; the panel already trims to the user-facing MAX_STROKES cap.
      const headroom = MAX_HISTORY - state.strokes.length;
      if (headroom <= 0) {
        return state;
      }
      const accepted = action.strokes.length > headroom ? action.strokes.slice(0, headroom) : action.strokes;
      return applyLayerOperation(state, insertStrokesOnLayer(state.strokes, accepted));
    }
    case 'ADD_EMOJI_PLANE':
      return {
        ...state,
        emojiPlanes: [...state.emojiPlanes, action.plane],
        planeUndoStack: [state.emojiPlanes, ...state.planeUndoStack].slice(0, MAX_UNDO_STACK),
        // A new plane action invalidates the redo side, exactly like COMMIT_STROKE does for undoStack.
        planeRedoStack: []
      };
    case 'UPDATE_EMOJI_PLANE':
      return {
        ...state,
        emojiPlanes: state.emojiPlanes.map(plane =>
          plane.id === action.planeId ? { ...plane, ...action.updates } : plane
        ),
        planeUndoStack: [state.emojiPlanes, ...state.planeUndoStack].slice(0, MAX_UNDO_STACK),
        planeRedoStack: []
      };
    case 'DELETE_EMOJI_PLANE':
      return {
        ...state,
        emojiPlanes: state.emojiPlanes.filter(plane => plane.id !== action.planeId),
        planeUndoStack: [state.emojiPlanes, ...state.planeUndoStack].slice(0, MAX_UNDO_STACK),
        planeRedoStack: []
      };
    case 'SET_EMOJI_PLANES':
      return {
        ...state,
        emojiPlanes: action.planes,
        planeUndoStack: [state.emojiPlanes, ...state.planeUndoStack].slice(0, MAX_UNDO_STACK),
        planeRedoStack: []
      };
    case 'UNDO_PLANE': {
      if (state.planeUndoStack.length === 0) {
        return state;
      }
      const previousPlanes = state.planeUndoStack[0];
      return {
        ...state,
        emojiPlanes: previousPlanes,
        planeUndoStack: state.planeUndoStack.slice(1),
        // The undone snapshot goes onto the redo side, exactly like the main UNDO case moves a
        // stroke onto undoStack — this is what REDO_PLANE was missing to actually work.
        planeRedoStack: [state.emojiPlanes, ...state.planeRedoStack].slice(0, MAX_UNDO_STACK)
      };
    }
    case 'REDO_PLANE': {
      if (state.planeRedoStack.length === 0) {
        return state;
      }
      const nextPlanes = state.planeRedoStack[0];
      return {
        ...state,
        emojiPlanes: nextPlanes,
        planeRedoStack: state.planeRedoStack.slice(1),
        planeUndoStack: [state.emojiPlanes, ...state.planeUndoStack].slice(0, MAX_UNDO_STACK)
      };
    }
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

export interface PaintingContextValue extends PaintingState {
  dispatch: React.Dispatch<PaintingAction>;
  commitStroke: (stroke: Stroke) => void;
  // ── 3-layer API (consumed by the Layers panel added in the UI phase) ──
  /** Layer that new strokes / committed planes land on. */
  setActiveLayer: (layer: PaintLayer) => void;
  /** Explicitly show/hide a layer (content is never discarded). */
  setLayerVisibility: (layer: PaintLayer, visible: boolean) => void;
  toggleLayerVisibility: (layer: PaintLayer) => void;
  /** Stroke count per layer, for the panel's row labels. */
  layerStrokeCounts: Record<PaintLayer, number>;
  /** Same, minus the invisible border-bounds plumbing — what a human would call "content". */
  layerArtworkStrokeCounts: Record<PaintLayer, number>;
  /** True when either half of the shared history (strokes or layer ops) has something to redo. */
  canRedo: boolean;
  /** Delete every artwork stroke on a layer. Undoable. Border-bounds strokes are kept. */
  clearLayer: (layer: PaintLayer) => void;
  /** Foreground merges DOWN, Background merges UP; Middle Ground never moves. Undoable. */
  mergeLayer: (from: 'foreground' | 'background') => void;
  /** Clone real stroke data onto a layer (paste / duplicate). Undoable. */
  pasteStrokesOnLayer: (source: readonly Stroke[], target: PaintLayer) => void;
  autosaveOverlayPending: boolean;
  showAutosaveOverlay: () => void;
  rememberStartupBrush: (emoji: string) => void;
  subscribeAutosaveDiscard: (listener: () => void) => () => void;
}

const PaintingContext = createContext<PaintingContextValue | undefined>(undefined);

interface PaintingProviderProps {
  children: React.ReactNode;
  initialStateOverride?: PaintingState;
  onStateChange?: (state: PaintingState) => void;
}

export const PaintingProvider: React.FC<PaintingProviderProps> = ({ children, initialStateOverride, onStateChange }) => {
  const [state, baseDispatch] = useReducer(paintingReducer, initialStateOverride ?? initialState);
  const lastActionRef = useRef<PaintingAction | null>(null);
  const prevStateRef = useRef<PaintingState>(state);
  const stateRef = useRef<PaintingState>(state);
  const autosaveDiscardListenersRef = useRef(new Set<() => void>());
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autosavePrompt, setAutosavePrompt] = useState<AutosavePayload | null>(null);
  const [autosaveOverlayVisible, setAutosaveOverlayVisible] = useState(false);
  const [autosaveOverlayPending, setAutosaveOverlayPending] = useState(false);
  const startupBrushRef = useRef<string | null>(null);
  const firstStrokeTimestampRef = useRef<number | null>(null);
  const lastStrokeTimestampRef = useRef<number | null>(null);
  const autosaveActivatedRef = useRef(false);

  const dispatch = useCallback((action: PaintingAction) => {
    lastActionRef.current = action;
    if (action.type === 'COMMIT_STROKE') {
      // Count only a newly committed gesture. LOAD_STATE and REDO deliberately
      // bypass this path so restored/history strokes never inflate lifetime stats.
      void recordLifetimeStrokeCommit({
        eventId: `painting:${action.stroke.id}`,
        workspace: getActiveLifetimeWorkspace() ?? 'normal',
      });
    }
    baseDispatch(action);
  }, [baseDispatch]);

  const resetAutosaveActivation = useCallback(() => {
    autosaveActivatedRef.current = false;
    firstStrokeTimestampRef.current = null;
    lastStrokeTimestampRef.current = null;
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  }, []);

  const scheduleAutosave = useCallback(() => {
    if (autosaveOverlayVisible || !autosaveActivatedRef.current) {
      return;
    }
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }
    autosaveTimeoutRef.current = setTimeout(() => {
      if (autosaveOverlayVisible || !autosaveActivatedRef.current) {
        return;
      }
      const lastStrokeTime = lastStrokeTimestampRef.current;
      if (!lastStrokeTime || Date.now() - lastStrokeTime < AUTOSAVE_IDLE_THRESHOLD_MS) {
        scheduleAutosave();
        return;
      }
      const current = stateRef.current;
      if (!current) {
        return;
      }
      if (current.strokes.length === 0) {
        void clearAutosave();
        return;
      }
      const payload: AutosavePayload = {
        projectId: DEFAULT_PROJECT_ID,
        rasterSize: { w: 1024, h: 1024 },
        painting: clonePaintingForAutosave(current),
        savedAt: new Date().toISOString()
      };
      void saveAutosave(payload);
    }, AUTOSAVE_IDLE_THRESHOLD_MS);
  }, [autosaveOverlayVisible]);

  // Snapshot system removed - using stroke replay instead

  const handleAction = useCallback((action: PaintingAction, prev: PaintingState, next: PaintingState) => {
    let shouldScheduleAutosave = false;
    switch (action.type) {
      case 'COMMIT_STROKE':
        shouldScheduleAutosave = true;
        break;
      case 'UNDO':
        shouldScheduleAutosave = true;
        break;
      case 'REDO':
        shouldScheduleAutosave = true;
        break;
      case 'CLEAR_STROKES':
        shouldScheduleAutosave = true;
        break;
      case 'LOAD_STATE':
        shouldScheduleAutosave = true;
        break;
      default:
        break;
    }
    if (action.type === 'COMMIT_STROKE') {
      const now = Date.now();
      lastStrokeTimestampRef.current = now;
      if (!firstStrokeTimestampRef.current) {
        firstStrokeTimestampRef.current = now;
      }
      if (
        !autosaveActivatedRef.current &&
        firstStrokeTimestampRef.current != null &&
        now - firstStrokeTimestampRef.current >= AUTOSAVE_ACTIVATION_DURATION_MS &&
        next.strokes.length > AUTOSAVE_ACTIVATION_MIN_STROKES
      ) {
        autosaveActivatedRef.current = true;
      }
    } else if (action.type === 'RESET' || action.type === 'LOAD_STATE') {
      resetAutosaveActivation();
    }
    if (autosaveActivatedRef.current && shouldScheduleAutosave) {
      scheduleAutosave();
    }
  }, [resetAutosaveActivation, scheduleAutosave]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const autosaveRaw = await loadAutosave();
        if (cancelled) {
          return;
        }
        let autosave = autosaveRaw;
        const autosaveStrokeCount = autosave?.painting?.strokes?.length ?? 0;
        if (autosave && autosaveStrokeCount < 3) {
          try {
            await clearAutosave();
          } catch (error) {
            console.warn('painting: failed to clear minimal autosave', error);
          }
          autosave = null;
        }
        if (cancelled) {
          return;
        }
        if (autosave) {
          setAutosavePrompt(autosave);
          setAutosaveOverlayVisible(false);
          setAutosaveOverlayPending(true);
        } else {
          setAutosaveOverlayPending(false);
        }
      } catch (error) {
        console.warn('painting: init failed', error);
        if (!cancelled) {
          setAutosaveOverlayPending(false);
        }
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
      setAutosaveOverlayPending(false);
    };
  }, []);

  const handleAutosaveRestore = useCallback(async () => {
    const payload = autosavePrompt;
    if (!payload) {
      return;
    }
    try {
      dispatch({ type: 'RESET' });
      dispatch({
        type: 'LOAD_STATE',
        payload: {
          strokes: payload.painting.strokes,
          brushEmoji: payload.painting.brushEmoji,
          brushSize: payload.painting.brushSize,
          brushOpacity: payload.painting.brushOpacity,
          brushSpacing: payload.painting.brushSpacing,
          brushRotation: payload.painting.brushRotation ?? state.brushRotation,
          brushMode: payload.painting.brushMode,
          recentEmojis: payload.painting.recentEmojis,
          trace: payload.painting.trace,
          mirrorX: payload.painting.mirrorX,
          mirrorY: payload.painting.mirrorY,
          activeLayer: payload.painting.activeLayer,
          layerVisibility: payload.painting.layerVisibility
        }
      });
      await clearAutosave();
      setAutosavePrompt(null);
      setAutosaveOverlayVisible(false);
      setAutosaveOverlayPending(false);
      scheduleAutosave();
    } catch (error) {
      console.warn('autosave: failed to restore session', error);
      setAutosavePrompt(null);
      setAutosaveOverlayVisible(false);
      setAutosaveOverlayPending(false);
    }
  }, [autosavePrompt, dispatch, scheduleAutosave, state.brushRotation]);

  const handleAutosaveDiscard = useCallback(async () => {
    try {
      await clearAutosave();
      dispatch({ type: 'RESET' });
      if (startupBrushRef.current) {
        dispatch({ type: 'SET_BRUSH_EMOJI', emoji: startupBrushRef.current });
      }
    } catch (error) {
      console.warn('autosave: failed to discard session', error);
    } finally {
      setAutosavePrompt(null);
      setAutosaveOverlayVisible(false);
      setAutosaveOverlayPending(false);
      autosaveDiscardListenersRef.current.forEach((listener) => {
        try {
          listener();
        } catch (listenerError) {
          console.warn('autosave discard listener failed', listenerError);
        }
      });
    }
  }, [dispatch]);

  const showAutosaveOverlay = useCallback(() => {
    if (!autosavePrompt || autosaveOverlayVisible) {
      return;
    }
    setAutosaveOverlayVisible(true);
    setAutosaveOverlayPending(false);
  }, [autosaveOverlayVisible, autosavePrompt]);

  const subscribeAutosaveDiscard = useCallback((listener: () => void) => {
    autosaveDiscardListenersRef.current.add(listener);
    return () => {
      autosaveDiscardListenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    const pendingAction = lastActionRef.current;
    if (pendingAction) {
      try {
        handleAction(pendingAction, prevStateRef.current, state);
      } finally {
        lastActionRef.current = null;
      }
    }
    prevStateRef.current = state;
  }, [handleAction, state]);

  // Timed snapshot removed - using stroke autosave instead

  useEffect(() => {
    if (onStateChange) {
      onStateChange(state);
    }
  }, [state, onStateChange]);

  useEffect(() => {
    if (autosaveOverlayVisible && autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  }, [autosaveOverlayVisible]);

  // Recomputed only when the stroke list changes — the panel reads it, painting never does.
  const layerStrokeCounts = useMemo(() => countStrokesByLayer(state.strokes), [state.strokes]);
  const layerArtworkStrokeCounts = useMemo(() => countArtworkStrokesByLayer(state.strokes), [state.strokes]);

  const value = useMemo<PaintingContextValue>(() => ({
    ...state,
    dispatch,
    setActiveLayer: (layer: PaintLayer) => dispatch({ type: 'SET_ACTIVE_LAYER', layer }),
    setLayerVisibility: (layer: PaintLayer, visible: boolean) =>
      dispatch({ type: 'SET_LAYER_VISIBILITY', layer, visible }),
    toggleLayerVisibility: (layer: PaintLayer) => dispatch({ type: 'TOGGLE_LAYER_VISIBILITY', layer }),
    layerStrokeCounts,
    layerArtworkStrokeCounts,
    canRedo: state.undoStack.length > 0 || state.layerRedoStack.length > 0,
    clearLayer: (layer: PaintLayer) => dispatch({ type: 'CLEAR_LAYER', layer }),
    mergeLayer: (from: 'foreground' | 'background') => dispatch({ type: 'MERGE_LAYER_INTO_MIDDLE', from }),
    pasteStrokesOnLayer: (source: readonly Stroke[], target: PaintLayer) => {
      if (!source || source.length === 0) {
        return;
      }
      // Trim to the user-facing stroke cap before cloning so a paste can never blow past it.
      const headroom = MAX_STROKES - stateRef.current.strokes.filter((s) => !isBorderStroke(s)).length;
      if (headroom <= 0) {
        return;
      }
      const trimmed = source.length > headroom ? source.slice(0, headroom) : source;
      dispatch({ type: 'PASTE_LAYER_STROKES', strokes: cloneStrokesForLayer(trimmed, target) });
    },
    commitStroke: (stroke: Stroke) => {
      const decimatedPoints = adaptiveDecimatePoints(
        stroke.points,
        stroke.size,
        stroke.spacing,
        stroke.stampSpan
      );
      const normalized: Stroke = {
        ...stroke,
        // Stamp the active layer when the caller didn't pick one. Explicit wins (replayed /
        // restored strokes carry their own), so this never rewrites existing artwork. Painting on
        // the DEFAULT layer deliberately writes no key at all, so a normal painting serializes
        // byte-identically to before layers existed.
        layer: stroke.layer ?? (state.activeLayer === DEFAULT_PAINT_LAYER ? undefined : state.activeLayer),
        mirrorX: stroke.mirrorX ?? state.mirrorX,
        mirrorY: stroke.mirrorY ?? state.mirrorY,
        rotation: typeof stroke.rotation === 'number' ? stroke.rotation : state.brushRotation,
        points: decimatedPoints.map((point) => ({ ...point })),
        emojiSequence: stroke.emojiSequence ? stroke.emojiSequence.slice() : undefined
      };

      dispatch({ type: 'COMMIT_STROKE', stroke: normalized });
    },
    autosaveOverlayPending,
    showAutosaveOverlay,
    rememberStartupBrush: (emoji: string) => {
      startupBrushRef.current = emoji;
      dispatch({ type: 'SET_BRUSH_EMOJI', emoji });
    },
    subscribeAutosaveDiscard
  }), [autosaveOverlayPending, dispatch, layerStrokeCounts, showAutosaveOverlay, state, subscribeAutosaveDiscard]);

  return (
    <PaintingContext.Provider value={value}>
      {children}
      <AutosaveOverlay
        visible={autosaveOverlayVisible}
        savedAt={autosavePrompt?.savedAt}
        onRestore={handleAutosaveRestore}
        onDiscard={handleAutosaveDiscard}
      />
    </PaintingContext.Provider>
  );
};

/**
 * Non-throwing variant. Renderer components (CanvasViewport) need the layer visibility flags but
 * are also mounted in trees that don't provide the painting context, so they must degrade instead
 * of crashing.
 */
export function usePaintingOptional(): PaintingContextValue | undefined {
  return useContext(PaintingContext);
}

/**
 * Everything a Layers panel needs, in one object: the active layer + its setter, per-layer
 * visibility + toggle/set, per-layer stroke counts, and the canonical bottom→top layer order.
 * Kept here (not in PaintScreen) so the panel can be dropped in anywhere under the provider.
 */
export interface LayerControls {
  layers: readonly PaintLayer[];
  activeLayer: PaintLayer;
  setActiveLayer: (layer: PaintLayer) => void;
  layerVisibility: LayerVisibility;
  setLayerVisibility: (layer: PaintLayer, visible: boolean) => void;
  toggleLayerVisibility: (layer: PaintLayer) => void;
  layerStrokeCounts: Record<PaintLayer, number>;
}

export function useLayerControls(): LayerControls {
  const ctx = usePainting();
  return useMemo(
    () => ({
      layers: PAINT_LAYER_ORDER,
      activeLayer: ctx.activeLayer,
      setActiveLayer: ctx.setActiveLayer,
      layerVisibility: ctx.layerVisibility,
      setLayerVisibility: ctx.setLayerVisibility,
      toggleLayerVisibility: ctx.toggleLayerVisibility,
      layerStrokeCounts: ctx.layerStrokeCounts
    }),
    [
      ctx.activeLayer,
      ctx.layerStrokeCounts,
      ctx.layerVisibility,
      ctx.setActiveLayer,
      ctx.setLayerVisibility,
      ctx.toggleLayerVisibility
    ]
  );
}

export function usePainting(): PaintingContextValue {
  const ctx = useContext(PaintingContext);
  if (!ctx) {
    throw new Error('usePainting must be used within PaintingProvider');
  }
  return ctx;
}
