/**
 * Timelapse Export - Command-Based Replay System
 * Exports timelapse by replaying strokes frame-by-frame
 * No intermediate PNGs - direct Metal rendering to MP4
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import type { Stroke } from '../state/PaintingContext';
import { hasSmudgeStroke, renderStrokesToBase64, resolveSmudgeTilesFromFiles } from '../lib/smudge/skiaOffscreenRender';
import type { VectorCameraState, VectorLoopMode, VectorStroke, VectorViewpoint } from '../vector/vectorTypes';
import { evalTimeline, timelineDurationMs } from '../vector/vectorTimeline';

interface PreviewFrame {
  index: number;
  time: number;
  base64: string;
}

interface TimelapseExporterInterface {
  generatePreviewFrames(
    strokes: any[],
    width: number,
    height: number,
    frameCount: number
  ): Promise<PreviewFrame[]>;

  exportTimelapse(
    strokes: any[],
    width: number,
    height: number,
    fps: number,
    durationSeconds: number,
    animationSeconds: number | undefined,
    outputPath: string
  ): Promise<{
    success: boolean;
    outputPath: string;
    frameCount: number;
    durationMs: number;
    fps: number;
    width: number;
    height: number;
  }>;

  exportGif(
    strokes: any[],
    width: number,
    height: number,
    fps: number,
    durationSeconds: number,
    animationSeconds: number | undefined,
    outputPath: string,
    quality: number
  ): Promise<{
    success: boolean;
    outputPath: string;
    frameCount: number;
    durationMs: number;
    fps: number;
    width: number;
    height: number;
  }>;

  exportWebM(
    strokes: any[],
    width: number,
    height: number,
    fps: number,
    durationSeconds: number,
    animationSeconds: number | undefined,
    outputPath: string
  ): Promise<{
    success: boolean;
    outputPath: string;
    frameCount: number;
    durationMs: number;
    fps: number;
    width: number;
    height: number;
  }>;

  cancelExport(): void;

  exportAnimationFrames(
    frames: any[][],
    width: number,
    height: number,
    fps: number,
    format: string,
    outputPath: string
  ): Promise<{
    success: boolean;
    outputPath: string;
    frameCount: number;
    durationMs: number;
    fps: number;
    width: number;
    height: number;
  }>;

  exportVectorFlythrough(
    strokes: any[],
    cameras: any[],
    width: number,
    height: number,
    fps: number,
    outputPath: string
  ): Promise<{
    success: boolean;
    outputPath: string;
    frameCount: number;
    durationMs: number;
    fps: number;
    width: number;
    height: number;
  }>;
}

const TimelapseExporterModule: TimelapseExporterInterface | null =
  Platform.OS === 'ios' ? NativeModules.TimelapseExporterModule : null;

const timelapseEventEmitter = TimelapseExporterModule
  ? new NativeEventEmitter(NativeModules.TimelapseExporterModule)
  : null;

export type ProgressCallback = (current: number, total: number) => void;

/**
 * Add a progress listener for export operations
 * @param callback Function called with (current, total) frame counts
 * @returns Subscription object with remove() method
 */
export const addExportProgressListener = (callback: ProgressCallback) => {
  if (!timelapseEventEmitter) {
    return { remove: () => {} };
  }
  return timelapseEventEmitter.addListener('onExportProgress', (event: { current: number; total: number }) => {
    callback(event.current, event.total);
  });
};

/**
 * Check if timelapse export is available
 */
export const isTimelapseExportAvailable = (): boolean => {
  return Platform.OS === 'ios' && TimelapseExporterModule !== null;
};

/**
 * Generate preview frames from strokes for timelapse preview
 * Low-resolution, small number of frames for quick preview
 *
 * @param strokes - Array of strokes to replay
 * @param width - Preview width in pixels (e.g., 256)
 * @param height - Preview height in pixels (e.g., 256)
 * @param frameCount - Number of preview frames (e.g., 30)
 */
/**
 * Check if a stroke uses a custom brush reference (not base64 PNG, but custom_brush_X ID)
 */
const isCustomBrushReference = (emoji: string): boolean => {
  return emoji.startsWith('custom_brush_');
};

/**
 * Check if a stroke uses a base64 PNG
 */
const isBase64PNG = (emoji: string): boolean => {
  return emoji.startsWith('data:image/png;base64,');
};

/**
 * Check if a stroke is any kind of custom (brush reference or base64)
 */
const isCustomStroke = (emoji: string): boolean => {
  return isCustomBrushReference(emoji) || isBase64PNG(emoji);
};

/**
 * Resolve custom brush reference to base64 PNG data
 * This allows custom strokes to work in native export
 */
export const resolveCustomBrushToBase64 = async (emoji: string): Promise<string> => {
  // If already base64, return as-is
  if (isBase64PNG(emoji)) {
    return emoji;
  }

  // If custom brush reference, try to get from cache or AsyncStorage
  if (isCustomBrushReference(emoji)) {
    try {
      const { getCustomBrushPNGData } = require('../lib/customBrushRegistry');
      const base64Data = await getCustomBrushPNGData(emoji);
      if (base64Data) {
        console.log(`[Export] Resolved custom brush ${emoji} to base64`);
        return `data:image/png;base64,${base64Data}`;
      } else {
        console.warn(`[Export] Custom brush ${emoji} not found in cache or storage`);
      }
    } catch (error) {
      console.warn(`[Export] Failed to resolve custom brush ${emoji}:`, error);
    }
  }

  // Fallback: return original (will be handled by filter if needed)
  return emoji;
};

/**
 * Prepare strokes for export by resolving custom brushes
 * This converts custom_brush_X references to actual base64 PNG data
 */
export const prepareStrokesForExport = async (inputStrokes: Stroke[]): Promise<Stroke[]> => {
  // Smudge strokes carry a baked PNG tile (bakedTile); the native exporter composites it (see
  // StrokeReplayEngine). A smudge stroke without a tile renders as nothing (native skips it).
  const strokes = inputStrokes;
  const customCount = strokes.filter(s => isCustomBrushReference(s.emoji)).length;

  if (customCount === 0) {
    // No custom brushes, return as-is. No logging: this runs once PER exported
    // frame (90+ times) — bridge console.logs measurably slow debug exports.
    return strokes;
  }

  console.log(`[Export] Processing ${customCount} custom brush strokes...`);

  // Resolve all custom brush references to base64
  const resolvedStrokes = await Promise.all(
    strokes.map(async (stroke, index) => {
      if (isCustomBrushReference(stroke.emoji)) {
        console.log(`[Export] Resolving stroke ${index}: ${stroke.emoji}`);
        const resolvedEmoji = await resolveCustomBrushToBase64(stroke.emoji);
        const isResolved = resolvedEmoji.startsWith('data:image/png;base64,');
        console.log(`[Export] Stroke ${index}: resolved=${isResolved}, length=${resolvedEmoji.length}B`);
        return { ...stroke, emoji: resolvedEmoji };
      }
      return stroke;
    })
  );

  console.log(`[Export] Finished resolving all strokes`);
  return resolvedStrokes;
};

/** True if the native frame-by-frame Animator exporter is available. */
export const isAnimationExportNativeAvailable = (): boolean =>
  Platform.OS === 'ios' &&
  TimelapseExporterModule !== null &&
  typeof (TimelapseExporterModule as any).exportAnimationFrames === 'function';

/** Serialize one stroke into the plain dict the native parser expects. */
const serializeStrokeForNative = (stroke: Stroke) => ({
  id: stroke.id || '',
  emoji: stroke.emoji || '🎨',
  size: stroke.size ?? 20,
  opacity: stroke.opacity ?? 1,
  spacing: (stroke as any).spacing ?? 0,
  stampSpan: (stroke as any).stampSpan ?? 0,
  points: (stroke.points || []).map((p) => ({ x: p?.x ?? 0, y: p?.y ?? 0, t: p?.t ?? 0 })),
  emojiSequence: stroke.emojiSequence ?? null,
  mirrorX: stroke.mirrorX ?? false,
  mirrorY: stroke.mirrorY ?? false,
  rotation: stroke.rotation ?? 0,
  isEraser: stroke.isEraser ?? false,
  isSmudge: stroke.isSmudge ?? false,
  bakedTile: stroke.bakedTile ?? null,
  bakedBounds: stroke.bakedBounds ?? null,
});

const serializeVectorStrokeForNative = async (stroke: VectorStroke) => ({
  id: stroke.strokeID,
  emoji: isCustomBrushReference(stroke.emoji) ? await resolveCustomBrushToBase64(stroke.emoji) : stroke.emoji,
  size: Number.isFinite(stroke.worldSize) ? stroke.worldSize : 1,
  opacity: Number.isFinite(stroke.opacity) ? stroke.opacity : 1,
  spacing: 1,
  stampSpan: 0,
  // Vector stamp centers are authoritative for rendering. A zero timestamp
  // makes the native replay parser accept them without adding timeline logic.
  points: (stroke.stampPositions ?? stroke.samples).map((point) => ({ x: point.x, y: point.y, t: 0 })),
  mirrorX: Boolean(stroke.mirrorX),
  mirrorY: Boolean(stroke.mirrorY),
  rotation: Number.isFinite(stroke.rotationDegrees) ? stroke.rotationDegrees : 0,
  isEraser: false,
  isSmudge: stroke.brushMode === 'smudge',
});

export const isVectorNativeExportAvailable = (): boolean =>
  Platform.OS === 'ios' &&
  TimelapseExporterModule !== null &&
  typeof (TimelapseExporterModule as any).exportVectorFlythrough === 'function';

/**
 * Deterministic Vector Mode export. Only the compact vector document and one
 * camera triplet per output frame cross the bridge; all rasterization and video
 * encoding happen in the existing native Metal exporter.
 */
export const exportVectorFlythroughNative = async (
  strokes: VectorStroke[],
  viewpoints: VectorViewpoint[],
  loopMode: VectorLoopMode,
  width: number,
  height: number,
  fps: number,
  outputPath: string,
): Promise<{ success: boolean; outputPath: string; frameCount: number }> => {
  if (!TimelapseExporterModule || typeof (TimelapseExporterModule as any).exportVectorFlythrough !== 'function') {
    throw new Error('Native Vector export not available');
  }
  const safeFps = Math.max(1, Math.min(60, Math.round(fps)));
  const durationMs = timelineDurationMs(viewpoints, loopMode);
  const frameCount = Math.max(2, Math.ceil((Math.max(1, durationMs) / 1000) * safeFps) + 1);
  const cameras: VectorCameraState[] = Array.from({ length: frameCount }, (_, index) =>
    evalTimeline(viewpoints, loopMode, Math.min(durationMs, (index * 1000) / safeFps)) ?? {
      cx: viewpoints[0]?.cx ?? 0,
      cy: viewpoints[0]?.cy ?? 0,
      zoom: viewpoints[0]?.zoom ?? 1,
    }
  );
  const serializedStrokes = await Promise.all(strokes.filter(Boolean).map(serializeVectorStrokeForNative));
  const result = await (TimelapseExporterModule as any).exportVectorFlythrough(
    serializedStrokes,
    cameras,
    Math.max(2, Math.round(width)),
    Math.max(2, Math.round(height)),
    safeFps,
    outputPath,
  );
  return { success: Boolean(result?.success), outputPath: result?.outputPath ?? outputPath, frameCount: result?.frameCount ?? frameCount };
};

/**
 * Frame-by-frame Animator export on the native GPU engine (same fast path as
 * timelapse). Each element of `frames` is that animation frame's COMPLETE stroke
 * set, already scaled to width×height. Smudge is rendered via bakedTile, so we
 * resolve tile files → base64 first (exactly like the timelapse video path).
 * Progress arrives via addExportProgressListener. Returns the native result.
 */
export const exportAnimationFramesNative = async (
  frames: Stroke[][],
  width: number,
  height: number,
  fps: number,
  format: 'mov' | 'gif',
  outputPath: string
): Promise<{ success: boolean; outputPath: string; frameCount: number }> => {
  if (!TimelapseExporterModule || typeof TimelapseExporterModule.exportAnimationFrames !== 'function') {
    throw new Error('Native animation export not available');
  }
  const serializedFrames = await Promise.all(
    frames.map(async (frameStrokes) => {
      const valid = (frameStrokes || []).filter(
        (s) => s && Array.isArray(s.points) && s.points.length > 0
      );
      // Resolve smudge tiles (bakedTilePath → base64 bakedTile) then custom brushes.
      const withTiles = await resolveSmudgeTilesFromFiles(valid);
      const prepared = await prepareStrokesForExport(withTiles);
      return prepared.map(serializeStrokeForNative);
    })
  );
  return TimelapseExporterModule.exportAnimationFrames(
    serializedFrames,
    width,
    height,
    fps,
    format,
    outputPath
  );
};

export const generatePreviewFrames = async (
  strokes: Stroke[],
  width: number,
  height: number,
  frameCount: number
): Promise<PreviewFrame[]> => {
  if (!TimelapseExporterModule) {
    throw new Error('Timelapse preview not available on this platform');
  }

  // Resolve custom brush references to base64 PNG data
  const preparedStrokes = await prepareStrokesForExport(strokes);

  // Serialize strokes for native module - with defensive null checks
  const serializedStrokes = preparedStrokes
    .filter((stroke) => {
      // Filter out invalid strokes that don't have points
      if (!stroke || !stroke.points || !Array.isArray(stroke.points) || stroke.points.length === 0) {
        console.warn('[Preview] Skipping invalid stroke (no points):', stroke?.id);
        return false;
      }
      return true;
    })
    .map((stroke) => ({
      id: stroke.id || '',
      emoji: stroke.emoji || '🎨',
      size: stroke.size ?? 20,
      opacity: stroke.opacity ?? 1,
      spacing: stroke.spacing ?? 0,
      stampSpan: stroke.stampSpan ?? 0,
      points: stroke.points.map((point) => ({
        x: point?.x ?? 0,
        y: point?.y ?? 0,
        t: point?.t ?? 0,
      })),
      emojiSequence: stroke.emojiSequence ?? null,
      mirrorX: stroke.mirrorX ?? false,
      mirrorY: stroke.mirrorY ?? false,
      rotation: stroke.rotation ?? 0,
      isEraser: stroke.isEraser ?? false,
      isSmudge: stroke.isSmudge ?? false,
      bakedTile: stroke.bakedTile ?? null,
      bakedBounds: stroke.bakedBounds ?? null,
    }));

  if (serializedStrokes.length === 0) {
    console.warn('[Preview] ⚠️ No valid strokes after filtering');
    throw new Error('No valid strokes to preview');
  }

  return TimelapseExporterModule.generatePreviewFrames(
    serializedStrokes,
    width,
    height,
    frameCount
  );
};

/**
 * Export timelapse from stroke data
 * Replays strokes frame-by-frame without storing intermediate PNGs
 *
 * @param strokes - Array of strokes to replay
 * @param width - Video width in pixels
 * @param height - Video height in pixels
 * @param fps - Frames per second (default: 30)
 * @param durationSeconds - Output video duration in seconds (default: 10)
 * @param outputPath - Output file path for MP4
 */
export const exportTimelapse = async (
  strokes: Stroke[],
  width: number,
  height: number,
  fps: number = 30,
  durationSeconds: number = 10,
  animationSeconds: number | undefined,
  outputPath: string
): Promise<{
  success: boolean;
  outputPath: string;
  frameCount: number;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
}> => {
  if (!TimelapseExporterModule) {
    throw new Error('Timelapse export not available on this platform');
  }

  // Resolve custom brush references to base64 PNG data
  const preparedStrokes = await prepareStrokesForExport(strokes);

  // Serialize strokes for native module
  const serializedStrokes = preparedStrokes.map((stroke) => ({
    id: stroke.id,
    emoji: stroke.emoji,
    size: stroke.size,
    opacity: stroke.opacity,
    spacing: stroke.spacing ?? 0,
    stampSpan: stroke.stampSpan ?? 0,
    points: stroke.points.map((point) => ({
      x: point.x,
      y: point.y,
      t: point.t,
    })),
    emojiSequence: stroke.emojiSequence ?? null,
    mirrorX: stroke.mirrorX ?? false,
    mirrorY: stroke.mirrorY ?? false,
    rotation: stroke.rotation ?? 0,
    isEraser: stroke.isEraser ?? false,
    isSmudge: stroke.isSmudge ?? false,
    bakedTile: stroke.bakedTile ?? null,
    bakedBounds: stroke.bakedBounds ?? null,
  }));

  return TimelapseExporterModule.exportTimelapse(
    serializedStrokes,
    width,
    height,
    fps,
    durationSeconds,
    animationSeconds,
    outputPath
  );
};

/**
 * Export GIF from stroke data using GPU rendering
 *
 * @param strokes - Array of strokes to replay
 * @param width - GIF width in pixels
 * @param height - GIF height in pixels
 * @param fps - Frames per second (default: 12)
 * @param durationSeconds - Output GIF duration in seconds (default: 5)
 * @param outputPath - Output file path for GIF
 * @param quality - GIF quality 0-1 (default: 0.8)
 */
export const exportGif = async (
  strokes: Stroke[],
  width: number,
  height: number,
  fps: number = 12,
  durationSeconds: number = 5,
  animationSeconds: number | undefined,
  outputPath: string,
  quality: number = 0.8
): Promise<{
  success: boolean;
  outputPath: string;
  frameCount: number;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
}> => {
  if (!TimelapseExporterModule) {
    throw new Error('GIF export not available on this platform');
  }

  // Resolve custom brush references to base64 PNG data
  const preparedStrokes = await prepareStrokesForExport(strokes);

  // Serialize strokes for native module
  const serializedStrokes = preparedStrokes.map((stroke) => ({
    id: stroke.id,
    emoji: stroke.emoji,
    size: stroke.size,
    opacity: stroke.opacity,
    spacing: stroke.spacing ?? 0,
    stampSpan: stroke.stampSpan ?? 0,
    points: stroke.points.map((point) => ({
      x: point.x,
      y: point.y,
      t: point.t,
    })),
    emojiSequence: stroke.emojiSequence ?? null,
    mirrorX: stroke.mirrorX ?? false,
    mirrorY: stroke.mirrorY ?? false,
    rotation: stroke.rotation ?? 0,
    isEraser: stroke.isEraser ?? false,
    isSmudge: stroke.isSmudge ?? false,
    bakedTile: stroke.bakedTile ?? null,
    bakedBounds: stroke.bakedBounds ?? null,
  }));

  return TimelapseExporterModule.exportGif(
    serializedStrokes,
    width,
    height,
    fps,
    durationSeconds,
    animationSeconds,
    outputPath,
    quality
  );
};

/**
 * Generate a single preview image for project thumbnails
 * Renders all strokes to a small image for use in project lists
 *
 * @param strokes - Array of strokes to render
 * @param size - Square size for preview (default: 256)
 * @returns Base64-encoded PNG data URI (data:image/png;base64,...)
 */
export const generateProjectPreview = async (
  strokes: Stroke[] | undefined,
  size: number = 256,
  canvasWidth?: number,
  canvasHeight?: number
): Promise<string | null> => {
  // CRITICAL: Validate inputs
  if (!TimelapseExporterModule) {
    console.warn('[Preview] ⚠️ TimelapseExporterModule not available');
    return null;
  }

  // Defensive check: ensure strokes is a valid array
  if (!strokes) {
    console.warn('[Preview] ⚠️ No strokes provided');
    return null;
  }

  if (!Array.isArray(strokes)) {
    console.warn('[Preview] ⚠️ Strokes is not an array:', typeof strokes);
    return null;
  }

  if (strokes.length === 0) {
    console.warn('[Preview] ⚠️ Strokes array is empty');
    return null;
  }

  try {
    // Filter out invalid strokes before processing
    const validStrokes = strokes.filter((stroke): stroke is Stroke => {
      if (!stroke || typeof stroke !== 'object') {
        console.warn('[Preview] Filtering out invalid stroke (not an object)');
        return false;
      }
      if (!stroke.points || !Array.isArray(stroke.points)) {
        console.warn('[Preview] Filtering out stroke with invalid points:', stroke?.id);
        return false;
      }
      return true;
    });

    if (validStrokes.length === 0) {
      console.warn('[Preview] ⚠️ No valid strokes after filtering');
      return null;
    }

    // SMUDGE: the native Metal exporter cannot sample pixels, so render smudge paintings via Skia
    // offscreen (same algorithm as the live canvas) for a pixel-correct still image.
    if (hasSmudgeStroke(validStrokes)) {
      let cw = canvasWidth;
      let ch = canvasHeight;
      if (!cw || !ch) {
        let maxX = 1;
        let maxY = 1;
        for (const s of validStrokes) {
          for (const p of s.points) {
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
        }
        cw = maxX;
        ch = maxY;
      }
      const smudgeBase64 = renderStrokesToBase64(validStrokes, cw, ch, null);
      if (smudgeBase64) {
        return `data:image/png;base64,${smudgeBase64}`;
      }
      console.warn('[Preview] ⚠️ Smudge offscreen render failed; falling back to native (smudge will be missing)');
    }

    // Resolve custom brush references to base64 PNG data
    const preparedStrokes = await prepareStrokesForExport(validStrokes);

    // CRITICAL FIX: Use provided canvas size for correct scaling
    // If not provided, infer from stroke bounds (fallback)
    let canvasW = canvasWidth || 4096; // Default to high-resolution canvas
    let canvasH = canvasHeight || 4096;

    if (!canvasWidth || !canvasHeight) {
      // Fallback: infer from stroke bounds
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      for (const s of preparedStrokes) {
        for (const p of s.points) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }

      if (isFinite(minX) && isFinite(maxX)) {
        canvasW = Math.max(1, maxX);
        canvasH = Math.max(1, maxY);
      }
    }

    // NOTE: no logging here — generateProjectPreview runs once per exported
    // animation frame; per-frame bridge logs measurably slow debug exports.

    // CRITICAL: Scale strokes to fit thumbnail size
    // Native code expects coordinates in the range [0, outputSize]
    // We need to scale from [0, canvasSize] to [0, thumbnailSize]
    const scale = size / Math.max(canvasW, canvasH);

    const scaledStrokes = preparedStrokes
      .filter(stroke => stroke && stroke.points && Array.isArray(stroke.points) && stroke.points.length > 0)
      .map(stroke => ({
        id: stroke.id || '',
        emoji: stroke.emoji || '🎨',
        size: (stroke.size ?? 20) * scale, // Scale emoji size too!
        opacity: stroke.opacity ?? 1,
        spacing: stroke.spacing ?? 0,
        stampSpan: stroke.stampSpan ?? 0,
        emojiSequence: stroke.emojiSequence ?? undefined,
        mirrorX: stroke.mirrorX ?? false,
        mirrorY: stroke.mirrorY ?? false,
        rotation: stroke.rotation ?? 0,
        isEraser: stroke.isEraser ?? false,
        points: stroke.points.map(p => ({
          x: (p?.x ?? 0) * scale,
          y: (p?.y ?? 0) * scale,
          t: p?.t ?? 0
        }))
      }));

    try {
      const frames = await generatePreviewFrames(scaledStrokes, size, size, 1);
      if (frames && frames.length > 0 && frames[0] && frames[0].base64) {
        return `data:image/png;base64,${frames[0].base64}`;
      }
      console.warn('[Preview] ⚠️ No frames generated or no base64 data');
      return null;
    } catch (nativeError) {
      console.error('[Preview] ❌ Native generatePreviewFrames failed:', nativeError);
      console.error('[Preview] Strokes count:', scaledStrokes.length);
      console.error('[Preview] First stroke:', scaledStrokes[0]);
      // Return null gracefully - don't crash the whole app
      return null;
    }
  } catch (error) {
    console.error('[Preview] ❌ Failed to generate project preview:', error);
    console.error('[Preview] Error type:', error instanceof Error ? error.name : typeof error);
    return null;
  }
};

/**
 * Export WebM video from stroke data using GPU rendering with transparent background
 *
 * @param strokes - Array of strokes to replay
 * @param width - Video width in pixels
 * @param height - Video height in pixels
 * @param fps - Frames per second (default: 30)
 * @param durationSeconds - Output video duration in seconds (default: 10)
 * @param outputPath - Output file path for WebM (actually .mov with HEVC+alpha)
 */
export const exportWebM = async (
  strokes: Stroke[],
  width: number,
  height: number,
  fps: number = 30,
  durationSeconds: number = 10,
  animationSeconds: number | undefined,
  outputPath: string
): Promise<{
  success: boolean;
  outputPath: string;
  frameCount: number;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
}> => {
  if (!TimelapseExporterModule) {
    throw new Error('WebM export not available on this platform');
  }

  // Resolve custom brush references to base64 PNG data
  const preparedStrokes = await prepareStrokesForExport(strokes);

  // Serialize strokes for native module
  const serializedStrokes = preparedStrokes.map((stroke) => ({
    id: stroke.id,
    emoji: stroke.emoji,
    size: stroke.size,
    opacity: stroke.opacity,
    spacing: stroke.spacing ?? 0,
    stampSpan: stroke.stampSpan ?? 0,
    points: stroke.points.map((point) => ({
      x: point.x,
      y: point.y,
      t: point.t,
    })),
  emojiSequence: stroke.emojiSequence ?? undefined,
    mirrorX: stroke.mirrorX ?? false,
    mirrorY: stroke.mirrorY ?? false,
    rotation: stroke.rotation ?? 0,
    isEraser: stroke.isEraser ?? false,
    isSmudge: stroke.isSmudge ?? false,
    bakedTile: stroke.bakedTile ?? null,
    bakedBounds: stroke.bakedBounds ?? null,
  }));

  return TimelapseExporterModule.exportWebM(
    serializedStrokes,
    width,
    height,
    fps,
    durationSeconds,
    animationSeconds,
    outputPath
  );
};

/**
 * Cancel ongoing export operation
 */
export const cancelExport = (): void => {
  if (!TimelapseExporterModule) {
    return;
  }
  // Check if cancelExport function exists (may not be available on web or old native modules)
  if (typeof TimelapseExporterModule.cancelExport === 'function') {
    TimelapseExporterModule.cancelExport();
  } else {
    console.warn('[Timelapse] cancelExport not available in native module');
  }
};

export default {
  isTimelapseExportAvailable,
  generatePreviewFrames,
  exportTimelapse,
  exportGif,
  exportWebM,
  generateProjectPreview,
  addExportProgressListener,
  cancelExport,
  exportAnimationFramesNative,
  isAnimationExportNativeAvailable,
  exportVectorFlythroughNative,
  isVectorNativeExportAvailable,
};

export type { PreviewFrame };
