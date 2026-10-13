// videoExport.ts
// Unverified but designed to be directly usable with ffmpeg-kit-react-native,
// react-native-fs, and react-native-view-shot.

import { RefObject } from "react";
import { View } from "react-native";
import RNFS from "react-native-fs";
import { captureRef } from "react-native-view-shot";

// Lazy import ffmpeg-kit to avoid NativeEventEmitter error on module load
// Import only when actually executing ffmpeg commands
// TEMPORARILY DISABLED - Using native screen recording instead
const FFmpegKit = {
  execute: async (command: string) => {
    console.warn('[FFmpeg] Disabled - command ignored:', command);
    return {
      getReturnCode: async () => ({ isSuccess: () => false }),
      getAllLogsAsString: async () => 'FFmpeg is disabled'
    };
  }
};

const ReturnCode = {
  isSuccess: (code: any) => false
};

function loadFFmpegKit() {
  // No-op - stubs are already loaded
  console.warn('[FFmpeg] Disabled - using native screen recording instead');
}

export type VideoLayer = {
  /** Absolute file path to the .mov asset on device (HEVC + alpha). */
  path: string;
  /** Optional: start time (sec) of this layer in the final composition. */
  startTime?: number;
  /** Optional: end time (sec); if undefined, use full duration. */
  endTime?: number;
};

export type VideoExportOptions = {
  /** Logical width of your editor / composition (e.g. 3840 for 4K). */
  width: number;
  /** Logical height of your editor / composition (e.g. 2160 for 4K). */
  height: number;
  /** Frame rate for the export (e.g. 30). */
  fps: number;
  /** List of transparent MOV layers to stack (bottom to top). */
  layers: VideoLayer[];
  /** Absolute path to the final output .mov (ProRes 4444). */
  outputPath: string;
  /**
   * Max duration (sec) of the composition. In a real editor you compute this
   * from your timeline.
   */
  duration: number;
};

export type CaptureFallbackOptions = VideoExportOptions & {
  /**
   * Optional: Reference to the editor view in React Native (no longer used with FFmpeg extraction).
   */
  editorRef?: RefObject<View>;
  /**
   * Optional: Callback called before each captured frame (no longer used with FFmpeg extraction).
   */
  renderAtTime?: (timeSec: number) => Promise<void> | void;
  /**
   * Optional: Progress callback to track frame extraction progress.
   */
  onProgress?: (currentFrame: number, totalFrames: number, timeSec: number) => void;
  /**
   * Optional: temp folder for PNG frames. If not set, a subfolder in
   * RNFS.CachesDirectoryPath will be used.
   */
  tempFramesDir?: string;
};

// ----------------------------------------------------------
// Primary path: stack transparent MOVs with ffmpeg-kit
// ----------------------------------------------------------

export async function exportCompositionWithFFmpeg(
  opts: VideoExportOptions
): Promise<string> {
  // Load ffmpeg-kit lazily to avoid NativeEventEmitter error on app startup
  loadFFmpegKit();

  if (!opts.layers.length) {
    throw new Error("No layers provided for export.");
  }

  // Build ffmpeg input list and overlay filter
  const inputArgs: string[] = [];
  const filterParts: string[] = [];

  // Each layer becomes an input: -i "path"
  opts.layers.forEach((layer, index) => {
    inputArgs.push("-i");
    inputArgs.push(layer.path);

    const inputLabel = `[${index}:v]`;
    const formattedLabel = `[v${index}]`;

    // Enforce RGBA to preserve alpha through the chain.
    filterParts.push(`${inputLabel}format=rgba${formattedLabel}`);
  });

  // Now stack all formatted inputs with overlay, preserving alpha.
  // v0 is the bottom layer; we overlay v1 on v0, then v2 on that, etc.
  let currentLabel = "[v0]";
  for (let i = 1; i < opts.layers.length; i++) {
    const nextLabel = `[v${i}]`;
    const outLabel = i === opts.layers.length - 1 ? "[outv]" : `[tmp${i}]`;

    // overlay=... with format=auto keeps alpha where possible.
    filterParts.push(
      `${currentLabel}${nextLabel}overlay=shortest=1:format=auto${outLabel}`
    );
    currentLabel = outLabel;
  }

  const filterComplex = filterParts.join(";");

  // Use ProRes 4444 (alpha-safe) as output codec.
  // yuva444p10le is the canonical alpha pixel format for ProRes 4444.
  const { fps, outputPath, duration } = opts;
  const safeOutput = outputPath.replace(/'/g, "\\'");

  const cmdParts: string[] = [
    "-y", // overwrite
    // Inputs
    ...inputArgs,
    // Filter
    "-filter_complex",
    `"${filterComplex}"`,
    // Map filtered video
    "-map",
    "[outv]",
    // Force frame rate
    "-r",
    String(fps),
    // Set duration safety (not strictly necessary, but helpful)
    "-t",
    String(duration),
    // ProRes 4444 export
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4", // 4 = 4444
    "-pix_fmt",
    "yuva444p10le",
    "-movflags",
    "+faststart",
    `"${safeOutput}"`,
  ];

  const cmd = cmdParts.join(" ");

  const session = await FFmpegKit.execute(cmd);
  const returnCode = await session.getReturnCode();

  if (ReturnCode.isSuccess(returnCode)) {
    return outputPath;
  }

  const failStackTrace = await session.getAllLogsAsString();
  throw new Error(
    `ffmpeg export failed (primary path). ReturnCode=${
      returnCode?.getValue() ?? "unknown"
    }\n${failStackTrace}`
  );
}

// ----------------------------------------------------------
// Fallback path: extract frames from video files using FFmpeg and composite them
// ----------------------------------------------------------

export async function exportCompositionWithFallbackCapture(
  opts: CaptureFallbackOptions
): Promise<string> {
  // Load ffmpeg-kit lazily to avoid NativeEventEmitter error on app startup
  loadFFmpegKit();

  const {
    width,
    height,
    fps,
    duration,
    outputPath,
    layers,
    onProgress,
  } = opts;

  console.log('[VideoExport] Starting FFmpeg frame extraction fallback...');

  const framesDir =
    opts.tempFramesDir ||
    `${RNFS.CachesDirectoryPath}/video_editor_frames_${Date.now()}`;

  // 1) Prepare temp folder for composited frames
  await RNFS.mkdir(framesDir);

  const totalFrames = Math.max(1, Math.round(duration * fps));
  const framePaths: string[] = [];

  // 2) For each frame, extract frames from all video layers and composite them
  for (let i = 0; i < totalFrames; i++) {
    const timeSec = i / fps;
    const frameName = `frame_${String(i).padStart(5, "0")}.png`;
    const framePath = `${framesDir}/${frameName}`;

    console.log(`[VideoExport] Extracting frame ${i + 1}/${totalFrames} at ${timeSec.toFixed(2)}s`);

    // Report progress
    if (onProgress) {
      onProgress(i + 1, totalFrames, timeSec);
    }

    // Build FFmpeg command to extract and composite all layers at this timestamp
    const inputArgs: string[] = [];
    const filterParts: string[] = [];

    // Create a black background first
    filterParts.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${1/fps}[bg]`);

    // Add each video layer as input and create overlay filters
    layers.forEach((layer, index) => {
      inputArgs.push("-ss");
      inputArgs.push(String(timeSec));
      inputArgs.push("-i");
      inputArgs.push(layer.path);

      // Extract a single frame, scale to target resolution, and set to RGBA for alpha
      const inputLabel = `[${index}:v]`;
      const scaledLabel = `[v${index}]`;
      filterParts.push(`${inputLabel}scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgba${scaledLabel}`);
    });

    // Now overlay all layers on top of the background
    let currentLabel = "[bg]";
    layers.forEach((layer, index) => {
      const nextLabel = `[v${index}]`;
      const outLabel = index === layers.length - 1 ? "[outv]" : `[tmp${index}]`;
      filterParts.push(`${currentLabel}${nextLabel}overlay=format=auto${outLabel}`);
      currentLabel = outLabel;
    });

    const filterComplex = filterParts.join(";");
    const safeFramePath = framePath.replace(/'/g, "\\'");

    const cmdParts: string[] = [
      "-y",
      ...inputArgs,
      "-filter_complex",
      `"${filterComplex}"`,
      "-map",
      "[outv]",
      "-frames:v",
      "1",
      `"${safeFramePath}"`,
    ];

    const cmd = cmdParts.join(" ");
    const session = await FFmpegKit.execute(cmd);
    const returnCode = await session.getReturnCode();

    if (!ReturnCode.isSuccess(returnCode)) {
      const logs = await session.getAllLogsAsString();
      throw new Error(
        `Failed to extract frame ${i} at ${timeSec}s. ReturnCode=${
          returnCode?.getValue() ?? "unknown"
        }\n${logs}`
      );
    }

    framePaths.push(framePath);
  }

  console.log('[VideoExport] All frames extracted, stitching into video...');

  // 3) Generate a list file for ffmpeg
  const listFilePath = `${framesDir}/frames.txt`;
  const listFileContent = framePaths
    .map((p) => `file '${p.replace(/'/g, "\\'")}'`)
    .join("\n");
  await RNFS.writeFile(listFilePath, listFileContent, "utf8");

  // 4) Use ffmpeg-kit to create a ProRes 4444 MOV from the PNG sequence
  const safeOutput = outputPath.replace(/'/g, "\\'");
  const safeList = listFilePath.replace(/'/g, "\\'");

  const cmdParts: string[] = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    `"${safeList}"`,
    "-framerate",
    String(fps),
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4",
    "-pix_fmt",
    "yuva444p10le",
    "-movflags",
    "+faststart",
    `"${safeOutput}"`,
  ];

  const cmd = cmdParts.join(" ");

  const session = await FFmpegKit.execute(cmd);
  const returnCode = await session.getReturnCode();

  // Clean up temp frames
  try {
    await RNFS.unlink(framesDir);
  } catch {
    // ignore
  }

  if (ReturnCode.isSuccess(returnCode)) {
    console.log('[VideoExport] FFmpeg fallback complete!');
    return outputPath;
  }

  const failStackTrace = await session.getAllLogsAsString();
  throw new Error(
    `ffmpeg export failed (fallback capture). ReturnCode=${
      returnCode?.getValue() ?? "unknown"
    }\n${failStackTrace}`
  );
}

// ----------------------------------------------------------
// High-level helper combining both paths
// ----------------------------------------------------------

export async function exportVideoComposition(
  ffmpegOpts: VideoExportOptions,
  fallbackOpts?: CaptureFallbackOptions
): Promise<string> {
  // 1) Try primary ffmpeg overlay path directly on the MOV layers
  try {
    return await exportCompositionWithFFmpeg(ffmpegOpts);
  } catch (err) {
    console.warn("[VideoExport] Primary ffmpeg overlay failed:", err);
  }

  // 2) Fallback: capture from the editor view
  if (!fallbackOpts) {
    throw new Error(
      "Primary ffmpeg export failed, and no fallback capture options were provided."
    );
  }

  return exportCompositionWithFallbackCapture({
    ...ffmpegOpts,
    ...fallbackOpts,
  });
}
