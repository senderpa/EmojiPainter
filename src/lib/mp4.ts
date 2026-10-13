import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { featureFlags } from '../config/features';
import { isMetalExportAvailable, exportMp4FromFrames } from '../native/exporter';

export type Mp4Frame = {
  base64?: string;
  path?: string;
  ptsMs?: number;
  dispose?: () => void | Promise<void>;
};

export type Mp4FrameSource = Iterable<Mp4Frame> | AsyncIterable<Mp4Frame>;

export type GenerateMp4Options = {
  frames: Mp4FrameSource;
  width: number;
  height: number;
  fps: number;
  bitrateMbps?: number;
  keyframeInterval?: number;
  onProgress?: (progress: number, frameIndex: number) => void;
  signal?: AbortSignal | null;
  outPath?: string;
  frameCount?: number;
  useMetal?: boolean; // Optional: force Metal export
};

type NativeVideoExporter = {
  start(options: {
    path: string;
    width: number;
    height: number;
    fps: number;
    bitrateMbps?: number;
    keyframeInterval?: number;
  }): Promise<{ sessionId: string; outputPath: string }>
  appendFrame(base64Png: string, ptsMs: number): Promise<void>
  appendFrameAtPath?: (path: string, ptsMs: number) => Promise<void>
  finish(): Promise<{ path?: string; durationMs?: number; frames?: number }>
  cancel(): Promise<void>
  getCapabilities?: () => Promise<Record<string, unknown>>
};

const VideoExporter: NativeVideoExporter | undefined = (NativeModules as any)?.VideoExporter;

function ensureModule(): NativeVideoExporter {
  if (!VideoExporter) {
    throw new Error(
      'VideoExporter native module is unavailable. Please rebuild the app.'
    );
  }
  return VideoExporter;
}

// Check if native module supports new batch export API
function supportsBatchExport(): boolean {
  return !!VideoExporter && typeof (VideoExporter as any).exportMp4 === 'function';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function* toAsyncIterable(source: Mp4FrameSource): AsyncIterable<Mp4Frame> {
  if (Symbol.asyncIterator in Object(source)) {
    for await (const frame of source as AsyncIterable<Mp4Frame>) {
      yield frame;
    }
    return;
  }
  if (Symbol.iterator in Object(source)) {
    for (const frame of source as Iterable<Mp4Frame>) {
      yield frame;
    }
    return;
  }
  throw new Error('Unsupported frame source.');
}

async function ensureDirectory(path: string) {
  const normalized = path.startsWith('file://') ? path : `file://${path}`;
  const parts = normalized.split('/');
  parts.pop();
  const dir = parts.join('/');
  if (!dir) {
    return;
  }
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

export async function generateMp4(options: GenerateMp4Options) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('MP4 export is only supported on iOS and Android.');
  }

  // Try Metal-accelerated export if enabled and available
  const shouldUseMetal = options.useMetal ?? featureFlags.isEnabled('useMetalExport');
  if (shouldUseMetal && Platform.OS === 'ios' && isMetalExportAvailable()) {
    try {
      return await generateMp4WithMetal(options);
    } catch (error) {
      console.warn('Metal export failed, falling back to standard export:', error);
      // Continue to standard export
    }
  }

  const module = ensureModule();

  // Try new batch export API if available (memory-efficient)
  if (supportsBatchExport() && options.frameCount) {
    return generateMp4Batch(options, module);
  }

  // Fall back to streaming API

  const fps = clamp(Math.round(options.fps), 12, 30);
  const bitrateMbps = options.bitrateMbps ?? Math.max(2, (options.width * options.height * fps * 0.07) / 1_000_000);
  const keyframeInterval = options.keyframeInterval ?? fps * 2;

  const fsDirs = FileSystem as unknown as {
    cacheDirectory?: string;
    documentDirectory?: string;
    bundleDirectory?: string;
  };
  const cacheDir = fsDirs.cacheDirectory ?? fsDirs.documentDirectory ?? `${fsDirs.bundleDirectory ?? ''}/`;
  const targetDir = `${cacheDir}exports/`;
  await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  const targetPath = options.outPath ?? `${targetDir}timelapse-${Date.now()}.mp4`;
  await ensureDirectory(targetPath);

  const startResult = await module.start({
    path: targetPath,
    width: options.width,
    height: options.height,
    fps,
    bitrateMbps,
    keyframeInterval,
  });

  const signal = options.signal ?? null;
  let aborted = false;
  const abortHandler = async () => {
    if (aborted) return;
    aborted = true;
    try {
      await module.cancel();
    } catch (error) {
      console.warn('VideoExporter.cancel failed after abort', error);
    }
  };

  if (signal) {
    if (signal.aborted) {
      await abortHandler();
      throw new Error('Export cancelled');
    }
    signal.addEventListener('abort', abortHandler);
  }

  let appended = 0;
  const totalFrames = options.frameCount ?? 0;
  try {
    for await (const frame of toAsyncIterable(options.frames)) {
      if (aborted || signal?.aborted) {
        await abortHandler();
        throw new Error('Export cancelled');
      }
      const ptsMs = typeof frame.ptsMs === 'number' ? Math.max(0, Math.round(frame.ptsMs)) : Math.round((1000 / fps) * appended);

      if (frame.path && typeof module.appendFrameAtPath === 'function') {
        const sanitizedPath = frame.path.startsWith('file://') ? frame.path : `file://${frame.path}`;
        await module.appendFrameAtPath(sanitizedPath, ptsMs);
        appended += 1;
        if (frame.dispose) {
          await frame.dispose();
        }
        if (options.onProgress) {
          options.onProgress(totalFrames > 0 ? appended / totalFrames : appended, appended);
        }
        continue;
      }

      let base64 = frame.base64;
      if (!base64 && frame.path) {
        const normalized = frame.path.startsWith('file://') ? frame.path : `file://${frame.path}`;
        base64 = await FileSystem.readAsStringAsync(normalized, { encoding: FileSystem.EncodingType.Base64 });
      }
      if (!base64) {
        throw new Error('Frame missing data');
      }
      const sanitized = base64.startsWith('data:') ? base64.split(',').slice(-1)[0] : base64;
      await module.appendFrame(sanitized, ptsMs);
      appended += 1;
      if (frame.dispose) {
        await frame.dispose();
      }
      if (options.onProgress) {
        options.onProgress(totalFrames > 0 ? appended / totalFrames : appended, appended);
      }
    }

    const result = await module.finish();
    return {
      path: result.path ?? startResult.outputPath ?? targetPath,
      format: 'mp4' as const,
      width: options.width,
      height: options.height,
      fps,
      durationMs: result.durationMs ?? (appended * (1000 / fps)),
      frames: result.frames ?? appended,
    };
  } catch (error) {
    if (!aborted && !signal?.aborted) {
      await abortHandler();
    }
    throw error;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

// New batch export function using memory-efficient native implementation
async function generateMp4Batch(options: GenerateMp4Options, module: any) {
  const fps = clamp(Math.round(options.fps), 12, 30);
  const fsDirs = FileSystem as unknown as {
    cacheDirectory?: string;
    documentDirectory?: string;
    bundleDirectory?: string;
  };
  const cacheDir = fsDirs.cacheDirectory ?? fsDirs.documentDirectory ?? `${fsDirs.bundleDirectory ?? ''}/`;
  const targetDir = `${cacheDir}exports/`;
  await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  const targetPath = options.outPath ?? `${targetDir}timelapse-${Date.now()}.mp4`;

  // Collect all frame paths from iterator
  const framePaths: string[] = [];
  for await (const frame of toAsyncIterable(options.frames)) {
    if (frame.path) {
      const sanitizedPath = frame.path.startsWith('file://') ? frame.path.substring(7) : frame.path;
      framePaths.push(sanitizedPath);
    }
    if (frame.dispose) {
      await frame.dispose();
    }
  }

  // Call native batch export
  const result = await module.exportMp4({
    framePaths,
    outputPath: targetPath,
    fps,
    width: options.width,
    height: options.height,
    progressCallback: (progress: number) => {
      if (options.onProgress) {
        const frameIndex = Math.floor(progress * framePaths.length);
        options.onProgress(progress, frameIndex);
      }
    }
  });

  return {
    path: result.path ?? targetPath,
    format: 'mp4' as const,
    width: options.width,
    height: options.height,
    fps,
    durationMs: result.durationMs ?? (framePaths.length * (1000 / fps)),
    frames: result.frames ?? framePaths.length,
  };
}

/**
 * Generate MP4 using Metal-accelerated export
 * This is 4× faster than standard export on iOS
 */
async function generateMp4WithMetal(options: GenerateMp4Options) {
  console.log('🚀 Using Metal-accelerated MP4 export');

  const fps = clamp(Math.round(options.fps), 12, 30);

  // Prepare output path
  const fsDirs = FileSystem as unknown as {
    cacheDirectory?: string;
    documentDirectory?: string;
    bundleDirectory?: string;
  };
  const cacheDir = fsDirs.cacheDirectory ?? fsDirs.documentDirectory ?? `${fsDirs.bundleDirectory ?? ''}/`;
  const targetDir = `${cacheDir}exports/`;
  await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  const targetPath = options.outPath ?? `${targetDir}timelapse-${Date.now()}.mp4`;
  await ensureDirectory(targetPath);

  // Collect frame paths
  const framePaths: string[] = [];
  for await (const frame of toAsyncIterable(options.frames)) {
    if (options.signal?.aborted) {
      throw new Error('Export cancelled');
    }

    if (frame.path) {
      framePaths.push(frame.path);
    } else if (frame.base64) {
      // Write base64 to temp file
      const tempPath = `${cacheDir}temp_frame_${framePaths.length}.png`;
      await FileSystem.writeAsStringAsync(tempPath, frame.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      framePaths.push(tempPath);
    }

    // Call frame disposal if provided
    if (frame.dispose) {
      await frame.dispose();
    }
  }

  console.log(`✅ Collected ${framePaths.length} frames for Metal export`);

  // Export using Metal module
  const startTime = Date.now();
  const resultPath = await exportMp4FromFrames(framePaths, targetPath, {
    width: options.width,
    height: options.height,
    fps,
    onProgress: (progress) => {
      if (options.onProgress) {
        options.onProgress(progress.progress, progress.currentFrame);
      }
    },
    signal: options.signal ?? undefined,
  });

  const duration = Date.now() - startTime;
  console.log(`✅ Metal export completed in ${(duration / 1000).toFixed(1)}s`);

  return {
    path: resultPath,
    format: 'mp4' as const,
    width: options.width,
    height: options.height,
    fps,
    durationMs: framePaths.length * (1000 / fps),
    frames: framePaths.length,
  };
}
