/**
 * Native Exporter Bridge
 * Enhanced MP4/GIF export with Metal texture support
 */

import { NativeModules, Platform } from 'react-native';

interface MP4ExporterModuleInterface {
  /**
   * Export MP4 from Metal texture (zero-copy, most efficient)
   */
  exportMp4FromTexture(
    textureHandle: number,
    destinationPath: string,
    width: number,
    height: number,
    fps: number,
    duration: number
  ): Promise<string>;

  /**
   * Export MP4 from frame paths (existing implementation)
   */
  exportMp4FromFrames(
    framePaths: string[],
    destinationPath: string,
    width: number,
    height: number,
    fps: number
  ): Promise<string>;

  /**
   * Export GIF from Metal texture
   */
  exportGifFromTexture(
    textureHandle: number,
    destinationPath: string,
    width: number,
    height: number,
    frameCount: number,
    delayMs: number
  ): Promise<string>;

  /**
   * Export GIF from frame paths (existing implementation)
   */
  exportGifFromFrames(
    framePaths: string[],
    delays: number[],
    destinationPath: string,
    width: number,
    height: number,
    loopCount: number
  ): Promise<string>;

  /**
   * Cancel ongoing export
   */
  cancelExport(): Promise<void>;
}

const MP4ExporterModule: MP4ExporterModuleInterface | null =
  Platform.OS === 'ios' ? NativeModules.MP4ExporterModule : null;

// Note: Progress callbacks are not currently supported by the native module
// The module uses the old RCTBridgeModule system which doesn't support event emission

export interface ExportProgress {
  progress: number; // 0.0 to 1.0
  currentFrame: number;
  totalFrames: number;
  estimatedTimeRemainingMs: number;
}

export interface ExportOptions {
  width: number;
  height: number;
  fps?: number;
  quality?: 'low' | 'medium' | 'high';
  loopCount?: number; // For GIF
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

/**
 * Check if native Metal-accelerated export is available
 */
export const isMetalExportAvailable = (): boolean => {
  return Platform.OS === 'ios' && MP4ExporterModule !== null;
};

/**
 * Export MP4 directly from Metal texture (most efficient)
 */
export const exportMp4FromTexture = async (
  textureHandle: number,
  destinationPath: string,
  options: ExportOptions
): Promise<string> => {
  if (!MP4ExporterModule) {
    throw new Error('MP4ExporterModule not available on this platform');
  }

  const fps = options.fps ?? 30;
  const duration = options.fps ? 1 / options.fps : 1 / 30;

  // Note: Progress callbacks are not currently supported
  // Set up abort signal
  if (options.signal) {
    const abortHandler = () => {
      MP4ExporterModule.cancelExport();
    };
    options.signal.addEventListener('abort', abortHandler);
  }

  const result = await MP4ExporterModule.exportMp4FromTexture(
    textureHandle,
    destinationPath,
    options.width,
    options.height,
    fps,
    duration
  );
  return result;
};

/**
 * Export MP4 from frame image paths
 */
export const exportMp4FromFrames = async (
  framePaths: string[],
  destinationPath: string,
  options: ExportOptions
): Promise<string> => {
  if (!MP4ExporterModule) {
    throw new Error('MP4ExporterModule not available on this platform');
  }

  // Validate framePaths
  if (!framePaths || !Array.isArray(framePaths)) {
    throw new Error('framePaths must be a valid array');
  }

  if (framePaths.length === 0) {
    throw new Error('Cannot export MOV: no frames provided. Please add frames to the timeline first.');
  }

  // CRITICAL: Validate all frame paths exist and are accessible before exporting
  // This prevents the native module from crashing when trying to access deleted frames
  const invalidFrames: string[] = [];
  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i];
    if (!framePath || typeof framePath !== 'string' || framePath.trim().length === 0) {
      invalidFrames.push(`Frame ${i}: Invalid path`);
    }
  }

  if (invalidFrames.length > 0) {
    console.error('[exportMp4FromFrames] ❌ Invalid frame paths detected:', invalidFrames.slice(0, 5));
    throw new Error(`Export failed: ${invalidFrames.length} invalid frame paths. This can happen if frames were deleted during export. Try exporting again with fewer frames.`);
  }

  // DEFENSIVE: Validate export options to prevent native crashes
  if (!options || typeof options !== 'object') {
    throw new Error('Export options must be a valid object');
  }

  if (!Number.isFinite(options.width) || options.width < 1 || options.width > 4096) {
    throw new Error(`Invalid width: ${options.width}. Must be between 1 and 4096`);
  }

  if (!Number.isFinite(options.height) || options.height < 1 || options.height > 4096) {
    throw new Error(`Invalid height: ${options.height}. Must be between 1 and 4096`);
  }

  if (!destinationPath || typeof destinationPath !== 'string') {
    throw new Error('destinationPath must be a valid string');
  }

  const fps = Math.max(1, Math.min(60, options.fps ?? 30)); // Clamp FPS 1-60

  // Note: Progress callbacks are not currently supported
  // Set up abort signal
  if (options.signal) {
    const abortHandler = () => {
      MP4ExporterModule.cancelExport();
    };
    options.signal.addEventListener('abort', abortHandler);
  }

  console.log('[exportMp4FromFrames] Calling native module with:', {
    framePaths: framePaths.length + ' frames',
    destinationPath,
    width: options.width,
    height: options.height,
    fps
  });

  try {
    // SAFETY: Set timeout to prevent indefinite hangs on native module
    const exportPromise = MP4ExporterModule.exportMp4FromFrames(
      framePaths,
      destinationPath,
      options.width,
      options.height,
      fps
    );

    // Add 10 minute timeout for export (generous for large exports)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Export timeout: MOV export took longer than 10 minutes')), 600000)
    );

    const result = await Promise.race([exportPromise, timeoutPromise]);

    console.log('[exportMp4FromFrames] Native module returned:', result);
    return result;
  } catch (nativeError) {
    console.error('[exportMp4FromFrames] ❌ Native export failed:', nativeError);

    // Check if it's a race condition / finishWriting error
    const errorMsg = nativeError instanceof Error ? nativeError.message : String(nativeError);

    if (errorMsg.includes('breakpoint') || errorMsg.includes('EXC_') || errorMsg.includes('crash')) {
      console.error('[exportMp4FromFrames] ⚠️ Native module crash detected');
      throw new Error(`Export failed: Native module crash occurred. This can happen with corrupted frames or memory issues. Try:\n- Using fewer frames (split into multiple exports)\n- Restarting the app\n- Using lower resolution (reduce width/height)`);
    }

    if (errorMsg.includes('markAsFinished') || errorMsg.includes('finishWriting') || errorMsg.includes('frameIndex')) {
      console.error('[exportMp4FromFrames] ⚠️ Likely race condition - frames were accessed out of order');
      throw new Error(`Export failed: Race condition detected (frame index out of bounds). This can happen with very large exports. Try:\n- Using fewer frames (split into multiple exports)\n- Using lower quality setting\n- Closing other apps to free memory`);
    }

    throw nativeError;
  }
};

/**
 * Export GIF directly from Metal texture
 */
export const exportGifFromTexture = async (
  textureHandle: number,
  destinationPath: string,
  frameCount: number,
  delayMs: number,
  options: ExportOptions
): Promise<string> => {
  if (!MP4ExporterModule) {
    throw new Error('MP4ExporterModule not available on this platform');
  }

  // Note: Progress callbacks are not currently supported
  // Set up abort signal
  if (options.signal) {
    const abortHandler = () => {
      MP4ExporterModule.cancelExport();
    };
    options.signal.addEventListener('abort', abortHandler);
  }

  const result = await MP4ExporterModule.exportGifFromTexture(
    textureHandle,
    destinationPath,
    options.width,
    options.height,
    frameCount,
    delayMs
  );
  return result;
};

/**
 * Export GIF from frame image paths
 */
export const exportGifFromFrames = async (
  framePaths: string[],
  delays: number[],
  destinationPath: string,
  options: ExportOptions
): Promise<string> => {
  if (!MP4ExporterModule) {
    throw new Error('MP4ExporterModule not available on this platform');
  }

  const loopCount = options.loopCount ?? 0; // 0 = infinite loop

  // Note: Progress callbacks are not currently supported
  // Set up abort signal
  if (options.signal) {
    const abortHandler = () => {
      MP4ExporterModule.cancelExport();
    };
    options.signal.addEventListener('abort', abortHandler);
  }

  console.log('[exportGifFromFrames] Calling native module with:', {
    framePaths: framePaths.length + ' frames',
    delays: delays.length + ' delays',
    destinationPath,
    width: options.width,
    height: options.height,
    loopCount
  });

  const result = await MP4ExporterModule.exportGifFromFrames(
    framePaths,
    delays,
    destinationPath,
    options.width,
    options.height,
    loopCount
  );

  console.log('[exportGifFromFrames] Native module returned:', result);
  return result;
};

/**
 * Cancel the current export operation
 */
export const cancelExport = async (): Promise<void> => {
  if (!MP4ExporterModule) {
    throw new Error('MP4ExporterModule not available on this platform');
  }
  return MP4ExporterModule.cancelExport();
};

export default {
  isMetalExportAvailable,
  exportMp4FromTexture,
  exportMp4FromFrames,
  exportGifFromTexture,
  exportGifFromFrames,
  cancelExport,
};
