import * as FileSystem from 'expo-file-system/legacy';
// TEMPORARILY DISABLED - Using native screen recording instead
/* import {
  FFmpegKit,
  FFmpegKitConfig,
  FFprobeKit,
  ReturnCode,
  type MediaInformation,
  type StreamInformation
} from 'ffmpeg-kit-react-native'; */

// Stub types and objects so code doesn't crash
type ReturnCode = any;
type MediaInformation = any;
type StreamInformation = any;

const FFmpegKitConfig = {
  init: async () => {
    console.warn('[FFmpeg] Disabled - using native screen recording instead');
  }
};

const FFmpegKit = {
  execute: async (command: string) => {
    console.warn('[FFmpeg] Disabled - command ignored:', command);
    return {
      getReturnCode: async () => ({ isSuccess: () => false }),
      getAllLogsAsString: async () => 'FFmpeg is disabled'
    };
  },
  executeWithArguments: async (args: string[]) => {
    console.warn('[FFmpeg] Disabled - executeWithArguments ignored:', args.join(' '));
    return {
      getReturnCode: async () => ({ isSuccess: () => false }),
      getAllLogsAsString: async () => 'FFmpeg is disabled',
      getLastReceivedStatistics: async () => null
    };
  }
};

const FFprobeKit = {
  getMediaInformation: async (path: string) => {
    console.warn('[FFmpeg] Disabled - returning default metadata');
    return {
      getMediaInformation: () => ({
        getWidth: () => 1920,
        getHeight: () => 1080,
        getDuration: () => 0,
        getNumberProperty: (key: string) => key === 'width' ? 1920 : 1080
      })
    };
  }
};

const ReturnCode = {
  isSuccess: (code: any) => false
};

let ffmpegInitialized = false;

const ensureFFmpegInitialized = async (): Promise<void> => {
  if (ffmpegInitialized) {
    return;
  }

  try {
    await FFmpegKitConfig.init();
  } catch (error) {
    console.warn('[FFmpeg] Failed to initialize (continuing anyway):', error);
  }
  ffmpegInitialized = true;
};

const stripFileScheme = (uri: string): string => (uri.startsWith('file://') ? uri.replace('file://', '') : uri);

const ensureDirectory = async (uri: string): Promise<void> => {
  const dir = uri.split('/').slice(0, -1).join('/') + '/';
  if (!dir) {
    return;
  }
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  } catch (error) {
    console.warn('[FFmpeg] Failed to ensure directory', dir, error);
  }
};

export type VideoProbeResult = {
  width: number;
  height: number;
  durationMs: number;
};

const extractVideoStream = (info: MediaInformation | null): StreamInformation | null => {
  if (!info) {
    return null;
  }
  const streams = info.getStreams?.() ?? [];
  for (const stream of streams) {
    if (stream?.getType?.() === 'video') {
      return stream;
    }
  }
  return null;
};

export const probeVideoMetadata = async (uri: string): Promise<VideoProbeResult> => {
  await ensureFFmpegInitialized();
  const session = await FFprobeKit.getMediaInformation(stripFileScheme(uri));
  const info = session.getMediaInformation();
  const videoStream = extractVideoStream(info);

  const width = videoStream?.getWidth?.() ?? info?.getNumberProperty?.('width') ?? 0;
  const height = videoStream?.getHeight?.() ?? info?.getNumberProperty?.('height') ?? 0;
  const durationSeconds = Number(info?.getDuration?.() ?? 0);

  return {
    width: width > 0 ? width : 1920,
    height: height > 0 ? height : 1080,
    durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : 0
  };
};

type PreviewOptions = {
  sourceUri: string;
  destUri: string;
  maxDimension?: number;
  dimensionsHint?: { width: number; height: number };
  targetWidth?: number;
  targetHeight?: number;
  fillColor?: string;
};

export const transcodePreviewVideo = async ({
  sourceUri,
  destUri,
  maxDimension = 1024,
  dimensionsHint,
  targetWidth,
  targetHeight,
  fillColor
}: PreviewOptions): Promise<{ previewUri: string; width: number; height: number }> => {
  await ensureFFmpegInitialized();
  await ensureDirectory(destUri);

  const { width: sourceWidth, height: sourceHeight } =
    dimensionsHint ?? (await probeVideoMetadata(sourceUri));

  let previewWidth: number;
  let previewHeight: number;
  let filterGraph: string;

  if (targetWidth && targetHeight) {
    previewWidth = targetWidth;
    previewHeight = targetHeight;
    const padColor = fillColor ?? 'black';
    filterGraph = [
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`,
      `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`
    ].join(',');
  } else {
    const dominantSide = Math.max(sourceWidth, sourceHeight);
    const scaleFactor = dominantSide > maxDimension && dominantSide > 0 ? maxDimension / dominantSide : 1;
    previewWidth = Math.max(1, Math.round(sourceWidth * scaleFactor));
    previewHeight = Math.max(1, Math.round(sourceHeight * scaleFactor));
    filterGraph = `scale=${previewWidth}:${previewHeight}`;
  }

  // Remove any previous preview file before re-encoding
  try {
    await FileSystem.deleteAsync(destUri, { idempotent: true });
  } catch {
    // ignore
  }

  const ffmpegArgs = [
    '-y',
    '-i',
    stripFileScheme(sourceUri),
    '-vf',
    filterGraph,
    '-an',
    '-c:v',
    'mpeg4',
    '-b:v',
    '2M',
    '-q:v',
    '2',
    '-movflags',
    '+faststart',
    stripFileScheme(destUri)
  ];

  const session = await FFmpegKit.executeWithArguments(ffmpegArgs);
  const returnCode = await session.getReturnCode();
  if (!ReturnCode.isSuccess(returnCode)) {
    const logs = await session.getAllLogsAsString();
    throw new Error(logs || 'Preview transcoding failed');
  }

  return { previewUri: destUri, width: previewWidth, height: previewHeight };
};

export type CompositionLayer = {
  sourceUri: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  zIndex: number;
};

type CompositionOptions = {
  layers: CompositionLayer[];
  canvasWidth: number;
  canvasHeight: number;
  durationMs: number;
  outputUri: string;
  format: 'mov' | 'mp4';
  onProgress?: (progress: number) => void; // 0-100 percentage
};

export const renderComposition = async ({
  layers,
  canvasWidth,
  canvasHeight,
  durationMs,
  outputUri,
  format,
  onProgress
}: CompositionOptions): Promise<void> => {
  if (layers.length === 0) {
    throw new Error('No layers to render');
  }

  await ensureFFmpegInitialized();
  await ensureDirectory(outputUri);

  const durationSeconds = Math.max(0.1, durationMs / 1000);
  const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  console.log('[FFmpeg] Starting composition render:');
  console.log(`[FFmpeg] Canvas: ${canvasWidth}x${canvasHeight}`);
  console.log(`[FFmpeg] Duration: ${durationSeconds.toFixed(2)}s`);
  console.log(`[FFmpeg] Layers: ${sortedLayers.length}`);
  console.log(`[FFmpeg] Format: ${format}`);

  const args: string[] = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black@0.0:s=${canvasWidth}x${canvasHeight}:d=${durationSeconds.toFixed(3)}` // Transparent background
  ];

  // Add -stream_loop for each input to loop shorter videos
  sortedLayers.forEach((layer) => {
    args.push('-stream_loop', '-1'); // Loop indefinitely
    args.push('-i', stripFileScheme(layer.sourceUri));
  });

  const filterParts: string[] = ['[0:v]format=rgba[base0]'];
  let currentBase = '[base0]';

  sortedLayers.forEach((layer, index) => {
    const inputLabel = `[${index + 1}:v]`;
    const formatLabel = `[layer${index}_fmt]`;
    const scaledLabel = `[layer${index}]`;
    const scaledWidth = Math.max(1, Math.round(layer.width * layer.scale));
    const scaledHeight = Math.max(1, Math.round(layer.height * layer.scale));
    const overlayOutput = index === sortedLayers.length - 1 ? '[final]' : `[base${index + 1}]`;
    const x = Math.round(layer.x);
    const y = Math.round(layer.y);

    console.log(`[FFmpeg] Layer ${index + 1}: scale=${scaledWidth}x${scaledHeight}, overlay at (${x}, ${y})`);

    // Format to rgba, scale, and overlay (preserves alpha channel)
    filterParts.push(`${inputLabel}format=rgba${formatLabel}`);
    filterParts.push(`${formatLabel}scale=${scaledWidth}:${scaledHeight}${scaledLabel}`);
    filterParts.push(`${currentBase}${scaledLabel}overlay=${x}:${y}:format=auto:shortest=0${overlayOutput}`);
    currentBase = overlayOutput;
  });

  const filterComplex = filterParts.join(';');
  args.push('-filter_complex', filterComplex);

  console.log('[FFmpeg] Filter complex:', filterComplex);

  // Map the final output from filter graph
  args.push('-map', '[final]');

  // Memory-efficient encoding settings
  // Calculate total pixel count to determine if this is a large export
  const totalPixels = canvasWidth * canvasHeight * durationSeconds;
  const isLargeExport = totalPixels > (3840 * 2160 * 10); // More than 10 seconds of 4K

  // Adjust bitrate and quality based on file size
  const bitrate = isLargeExport ? '6M' : '8M'; // Lower bitrate for large files
  const quality = isLargeExport ? '3' : '2'; // Slightly lower quality for large files

  console.log(`[FFmpeg] Export size: ${isLargeExport ? 'LARGE' : 'normal'} (${(totalPixels / 1e6).toFixed(0)}M pixels)`);
  console.log(`[FFmpeg] Using bitrate: ${bitrate}, quality: ${quality}`);

  // Use ProRes 4444 for MOV with alpha, mpeg4 for MP4
  if (format === 'mov') {
    // MOV format with alpha channel support - use ProRes 4444
    // ProRes 4444 properly preserves alpha channel unlike mpeg4
    args.push('-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le');
  } else {
    // MP4 format (no alpha support)
    args.push('-c:v', 'mpeg4', '-b:v', bitrate, '-pix_fmt', 'yuv420p', '-q:v', quality);
  }

  // Add thread count for better performance with large files
  args.push('-threads', '0'); // Auto-detect optimal thread count

  args.push('-movflags', '+faststart', '-t', durationSeconds.toFixed(3), stripFileScheme(outputUri));

  console.log('[FFmpeg] Full command:', args.join(' '));

  // Execute FFmpeg with progress monitoring
  const session = await FFmpegKit.executeWithArguments(args);

  // Monitor progress if callback provided
  if (onProgress) {
    const startTime = Date.now();
    const progressInterval = setInterval(async () => {
      const statistics = await session.getLastReceivedStatistics();
      if (statistics) {
        const currentTime = statistics.getTime();
        if (currentTime > 0 && durationSeconds > 0) {
          // Convert time from milliseconds to seconds and calculate percentage
          const currentSeconds = currentTime / 1000;
          const progress = Math.min(100, Math.max(0, (currentSeconds / durationSeconds) * 100));
          onProgress(Math.round(progress));
        }
      }
    }, 100);

    // Wait for session to complete
    await session.getReturnCode();
    clearInterval(progressInterval);
    onProgress(100); // Ensure we report 100% at the end
  }

  const returnCode = await session.getReturnCode();
  if (!ReturnCode.isSuccess(returnCode)) {
    const logs = await session.getAllLogsAsString();
    throw new Error(logs || 'FFmpeg export failed');
  }
};

/**
 * Stitch frames into a video
 * Used for screen recording export method
 */
export const stitchFramesToVideo = async (
  framePaths: string[],
  outputUri: string,
  fps: number = 30,
  options?: { width?: number; height?: number; rotate?: 'clockwise' | 'counterclockwise' }
): Promise<void> => {
  if (!framePaths.length) {
    throw new Error('No frames provided for stitching.');
  }

  await ensureFFmpegInitialized();
  await ensureDirectory(outputUri);

  console.log(`[FFmpeg] Stitching ${framePaths.length} frames at ${fps}fps`);
  console.log(`[FFmpeg] Output: ${outputUri}`);

  const tempDir = `${FileSystem.cacheDirectory}frame_sequence_${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });

  // Copy frames to temp directory with sequential naming
  // Use 5-digit padding for frame numbers (supports up to 99,999 frames)
  const padValue = 5;

  // Detect file extension from first frame (default to jpg for FFmpeg compatibility)
  const firstFrame = framePaths[0].startsWith('file://') ? framePaths[0].replace('file://', '') : framePaths[0];
  const extMatch = firstFrame.match(/\.(jpg|jpeg|png)$/i);
  let ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';

  // Normalize jpeg to jpg for consistency
  if (ext === 'jpeg') {
    ext = 'jpg';
  }

  console.log(`[FFmpeg] Detected frame format: ${ext}`);

  for (let i = 0; i < framePaths.length; i++) {
    const src = framePaths[i].startsWith('file://') ? framePaths[i].replace('file://', '') : framePaths[i];
    const dst = `${tempDir}frame_${String(i).padStart(padValue, '0')}.${ext}`;
    try {
      await FileSystem.copyAsync({ from: src.startsWith('/') ? `file://${src}` : src, to: dst });
    } catch (error) {
      console.warn('[FFmpeg] Failed to copy frame for stitching:', src, error);
      throw error;
    }
  }

  // Use image2 demuxer with pattern instead of concat demuxer
  const inputPattern = `${stripFileScheme(tempDir)}frame_%05d.${ext}`;

  console.log(`[FFmpeg] Input pattern: ${inputPattern}`);

  const filters: string[] = [];
  if (options?.width && options?.height) {
    filters.push(`scale=${options.width}:${options.height}:flags=lanczos`);
  }
  if (options?.rotate === 'clockwise') {
    filters.push('transpose=1');
  } else if (options?.rotate === 'counterclockwise') {
    filters.push('transpose=2');
  }

  const args: string[] = [
    '-y',
    '-framerate',
    String(fps),
    '-f',
    'image2',
    '-i',
    inputPattern,
  ];

  if (filters.length) {
    args.push('-vf', filters.join(','));
  }

  args.push(
    '-c:v',
    'prores_ks',
    '-profile:v',
    '4',
    '-pix_fmt',
    'yuva444p10le',
    '-movflags',
    '+faststart',
    stripFileScheme(outputUri)
  );

  console.log('[FFmpeg] Executing frame stitching:', args.join(' '));

  const session = await FFmpegKit.executeWithArguments(args);
  const returnCode = await session.getReturnCode();

  try {
    await FileSystem.deleteAsync(tempDir, { idempotent: true });
  } catch {}

  if (!ReturnCode.isSuccess(returnCode)) {
    const logs = await session.getAllLogsAsString();
    throw new Error(logs || 'FFmpeg frame stitching failed');
  }

  console.log('[FFmpeg] Frame stitching completed successfully');
};
