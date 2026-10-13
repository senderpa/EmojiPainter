import type { AnimationFrame } from '../lib/storage';
import type { BrushMode, LayerVisibility, PaintLayer, Stroke, TraceState } from '../state/PaintingContext';
import { DEFAULT_LAYER_VISIBILITY } from '../state/PaintingContext';

export interface StoredPaintingState {
  strokes: Stroke[];
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  brushRotation: number;
  mirrorX?: boolean;
  mirrorY?: boolean;
  brushMode?: BrushMode;
  smudgeSmoothness?: number;
  recentEmojis?: string[];
  trace: TraceState;
  // 3-layer system. Per-stroke assignment rides on each Stroke (`stroke.layer`) and is preserved by
  // cloneStroke's spread; only the editor-level bits live here. Both optional — a painting saved
  // before layers existed restores as "default layer, all layers visible".
  activeLayer?: PaintLayer;
  layerVisibility?: LayerVisibility;
  // Frame-by-frame animation data (optional)
  frameMode?: boolean;
  frames?: AnimationFrame[];
  currentFrameIndex?: number;
  exportFps?: number;
}

export const cloneStroke = (stroke: Stroke): Stroke => ({
  ...stroke,
  points: stroke.points.map((point) => ({ ...point })),
  emojiSequence: stroke.emojiSequence ? stroke.emojiSequence.slice() : undefined
});

export const cloneStrokes = (strokes: Stroke[]): Stroke[] => strokes.map((stroke) => cloneStroke(stroke));

export const cloneTraceState = (trace: TraceState): TraceState => ({ ...trace });

export const snapshotPaintingState = (state: {
  strokes: Stroke[];
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  brushRotation: number;
  mirrorX?: boolean;
  mirrorY?: boolean;
  recentEmojis?: string[];
  trace: TraceState;
  activeLayer?: PaintLayer;
  layerVisibility?: LayerVisibility;
}): StoredPaintingState => ({
  strokes: cloneStrokes(state.strokes),
  brushEmoji: state.brushEmoji,
  brushSize: state.brushSize,
  brushOpacity: state.brushOpacity,
  brushSpacing: state.brushSpacing,
  brushRotation: state.brushRotation,
  mirrorX: state.mirrorX,
  mirrorY: state.mirrorY,
  recentEmojis: state.recentEmojis && Array.isArray(state.recentEmojis) ? state.recentEmojis.slice() : undefined,
  trace: cloneTraceState(state.trace),
  activeLayer: state.activeLayer,
  layerVisibility: { ...(state.layerVisibility ?? DEFAULT_LAYER_VISIBILITY) }
});
