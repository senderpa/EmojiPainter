// proResExport.ts
// Clean, robust ProRes 4444 video export module for React Native/Expo
// Handles transparent MOV layers with alpha channel preservation

import { RefObject } from "react";
import { View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

// TEMPORARILY DISABLED - Using native screen recording instead
const FFmpegKit = {
  execute: async (command: string) => {
    console.warn('[ProResExport] FFmpeg disabled - command ignored:', command);
    return {
      getReturnCode: async () => ({ isSuccess: () => false }),
      getAllLogsAsString: async () => 'FFmpeg is disabled'
    };
  }
};

const ReturnCode = {
  isSuccess: (code: any) => false
};

let captureRefFn: any;

/**
 * Lazy load ffmpeg-kit to prevent module initialization errors.
 * Only loads when actually needed for export.
 */
function loadFFmpegKit() {
  // No-op - stubs are already loaded
  console.warn('[ProResExport] FFmpeg disabled - use native screen recording');
}

/**
 * Lazy load react-native-view-shot for frame capture.
 */
function loadViewShot() {
  if (!captureRefFn) {
    try {
      const viewShot = require("react-native-view-shot");
      captureRefFn = viewShot.captureRef;
      console.log("[ProResExport] View shot loaded successfully");
    } catch (error) {
      console.error("[ProResExport] Failed to load view-shot:", error);
      throw new Error("react-native-view-shot is not available.");
    }
  }
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
  /**
   * Optional: callback for progress updates (0-100).
   */
  onProgress?: (progress: number) => void;
};

export type CaptureFallbackOptions = VideoExportOptions & {
  /**
   * Reference to the editor view in React Native. This view should render
   * exactly what you want to export.
   */
  editorRef: RefObject<View>;
  /**
   * Callback called before each captured frame; you should update your
   * editor state to the given time (sec) so that the captured frame matches
   * the timeline.
   */
  renderAtTime: (timeSec: number) => Promise<void> | void;
  /**
   * Optional: temp folder for PNG frames. If not set, a subfolder in
   * FileSystem.cacheDirectory will be used.
   */
  tempFramesDir?: string;
};

/**
 * Ensure the output directory exists.
 * Uses Expo FileSystem API for cross-platform compatibility.
 */
async function ensureDirectoryExists(filePath: string): Promise<void> {
  try {
    // Extract directory from file path
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash === -1) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    const directory = filePath.substring(0, lastSlash);

    // Check if directory exists
    const dirInfo = await FileSystem.getInfoAsync(directory);

    if (!dirInfo.exists) {
      console.log(`[ProResExport] Creating directory: ${directory}`);
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    }
  } catch (error) {
    console.error("[ProResExport] Failed to ensure directory exists:", error);
    throw error;
  }
}

/**
 * Remove file:// prefix if present, as ffmpeg needs raw paths.
 */
function stripFilePrefix(path: string): string {
  return path.replace(/^file:\/\//, '');
}

/**
 * Add file:// prefix if not present, as Expo FileSystem needs it.
 */
function ensureFilePrefix(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

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

  console.log(`[ProResExport] Starting FFmpeg export with ${opts.layers.length} layers`);
  console.log(`[ProResExport] Output: ${opts.outputPath}`);
  console.log(`[ProResExport] Duration: ${opts.duration}s @ ${opts.fps} fps`);

  // Ensure output directory exists
  await ensureDirectoryExists(opts.outputPath);

  // Build ffmpeg input list and overlay filter
  const inputArgs: string[] = [];
  const filterParts: string[] = [];

  // Each layer becomes an input: -i "path"
  opts.layers.forEach((layer, index) => {
    const cleanPath = stripFilePrefix(layer.path);
    inputArgs.push("-i");
    inputArgs.push(`"${cleanPath}"`);

    const inputLabel = `[${index}:v]`;
    const formattedLabel = `[v${index}]`;

    // Enforce RGBA to preserve alpha through the chain.
    filterParts.push(`${inputLabel}format=rgba${formattedLabel}`);

    console.log(`[ProResExport] Layer ${index}: ${cleanPath}`);
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
  console.log(`[ProResExport] Filter complex: ${filterComplex}`);

  // Use ProRes 4444 (alpha-safe) as output codec.
  // yuva444p10le is the canonical alpha pixel format for ProRes 4444.
  const { fps, duration } = opts;
  const cleanOutputPath = stripFilePrefix(opts.outputPath);
  const safeOutput = cleanOutputPath.replace(/'/g, "\\'");

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
  console.log(`[ProResExport] Executing FFmpeg command: ${cmd}`);

  try {
    const session = await FFmpegKit.execute(cmd);
    const returnCode = await session.getReturnCode();

    if (ReturnCode.isSuccess(returnCode)) {
      console.log(`[ProResExport] FFmpeg export successful: ${cleanOutputPath}`);
      if (opts.onProgress) {
        opts.onProgress(100);
      }
      return ensureFilePrefix(cleanOutputPath);
    }

    const failStackTrace = await session.getAllLogsAsString();
    console.error(`[ProResExport] FFmpeg export failed. Return code: ${String(returnCode ?? "unknown")}`);
    console.error(`[ProResExport] FFmpeg logs:\n${failStackTrace}`);

    throw new Error(
      `ffmpeg export failed (primary path). ReturnCode=${
        String(returnCode ?? "unknown")
      }\n${failStackTrace}`
    );
  } catch (error) {
    console.error("[ProResExport] FFmpeg execution error:", error);
    throw error;
  }
}

// ----------------------------------------------------------
// Fallback path: capture the editor as PNG frames and stitch
// ----------------------------------------------------------

export async function exportCompositionWithFallbackCapture(
  opts: CaptureFallbackOptions
): Promise<string> {
  // Load required modules lazily
  loadFFmpegKit();
  loadViewShot();

  const {
    editorRef,
    renderAtTime,
    width,
    height,
    fps,
    duration,
    outputPath,
    onProgress,
  } = opts;

  console.log(`[ProResExport] Starting fallback capture export`);
  console.log(`[ProResExport] Capturing ${Math.round(duration * fps)} frames at ${fps} fps`);

  if (!editorRef.current) {
    throw new Error("editorRef.current is null; cannot capture.");
  }

  const framesDir =
    opts.tempFramesDir ||
    `${stripFilePrefix(FileSystem.cacheDirectory || '')}video_editor_frames_${Date.now()}`;

  // Ensure output directory exists
  await ensureDirectoryExists(outputPath);

  try {
    // 1) Prepare temp folder and capture PNG sequence
    const framesDirInfo = await FileSystem.getInfoAsync(framesDir);
    if (!framesDirInfo.exists) {
      await FileSystem.makeDirectoryAsync(framesDir, { intermediates: true });
      console.log(`[ProResExport] Created frames directory: ${framesDir}`);
    }

    const totalFrames = Math.max(1, Math.round(duration * fps));
    const framePaths: string[] = [];

    for (let i = 0; i < totalFrames; i++) {
      const timeSec = i / fps;

      // Let your editor jump to the correct time.
      await renderAtTime(timeSec);

      // Small delay to ensure React has rendered, if needed.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const uri = await captureRefFn(editorRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        width,
        height,
      });

      const frameName = `frame_${String(i).padStart(5, "0")}.png`;
      const framePath = `${framesDir}/${frameName}`;

      // Move the tmp URI into our frames dir
      const cleanUri = stripFilePrefix(uri);
      await FileSystem.moveAsync({
        from: ensureFilePrefix(cleanUri),
        to: ensureFilePrefix(framePath)
      });

      framePaths.push(framePath);

      // Update progress
      if (onProgress) {
        const progress = ((i + 1) / totalFrames) * 50; // First 50% is capture
        onProgress(progress);
      }

      if ((i + 1) % 30 === 0) {
        console.log(`[ProResExport] Captured ${i + 1}/${totalFrames} frames`);
      }
    }

    console.log(`[ProResExport] All ${totalFrames} frames captured successfully`);

    // 2) Generate a list file for ffmpeg (safer than image2pipe)
    const listFilePath = `${framesDir}/frames.txt`;
    const listFileContent = framePaths
      .map((p) => `file '${p.replace(/'/g, "\\'")}'`)
      .join("\n");

    await FileSystem.writeAsStringAsync(
      ensureFilePrefix(listFilePath),
      listFileContent,
      { encoding: FileSystem.EncodingType.UTF8 }
    );

    console.log(`[ProResExport] Created frames list file: ${listFilePath}`);

    // 3) Use ffmpeg-kit to create a ProRes 4444 MOV from the PNG sequence
    const cleanOutputPath = stripFilePrefix(outputPath);
    const safeOutput = cleanOutputPath.replace(/'/g, "\\'");
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
    console.log(`[ProResExport] Stitching frames with FFmpeg: ${cmd}`);

    const session = await FFmpegKit.execute(cmd);
    const returnCode = await session.getReturnCode();

    // Clean up temp frames
    try {
      console.log(`[ProResExport] Cleaning up frames directory: ${framesDir}`);
      await FileSystem.deleteAsync(ensureFilePrefix(framesDir), { idempotent: true });
    } catch (cleanupError) {
      console.warn("[ProResExport] Failed to cleanup frames:", cleanupError);
    }

    if (ReturnCode.isSuccess(returnCode)) {
      console.log(`[ProResExport] Fallback capture export successful: ${cleanOutputPath}`);
      if (onProgress) {
        onProgress(100);
      }
      return ensureFilePrefix(cleanOutputPath);
    }

    const failStackTrace = await session.getAllLogsAsString();
    console.error(`[ProResExport] FFmpeg stitching failed. Return code: ${String(returnCode ?? "unknown")}`);
    console.error(`[ProResExport] FFmpeg logs:\n${failStackTrace}`);

    throw new Error(
      `ffmpeg export failed (fallback capture). ReturnCode=${
        String(returnCode ?? "unknown")
      }\n${failStackTrace}`
    );
  } catch (error) {
    // Try to cleanup on error
    try {
      await FileSystem.deleteAsync(ensureFilePrefix(framesDir), { idempotent: true });
    } catch {
      // ignore cleanup errors
    }
    throw error;
  }
}

// ----------------------------------------------------------
// High-level helper combining both paths
// ----------------------------------------------------------

export async function exportVideoComposition(
  ffmpegOpts: VideoExportOptions,
  fallbackOpts?: CaptureFallbackOptions
): Promise<string> {
  console.log("[ProResExport] Starting video composition export");

  // 1) Try primary ffmpeg overlay path directly on the MOV layers
  try {
    console.log("[ProResExport] Attempting primary FFmpeg overlay method");
    return await exportCompositionWithFFmpeg(ffmpegOpts);
  } catch (err) {
    console.warn("[ProResExport] Primary ffmpeg overlay failed:", err);
  }

  // 2) Fallback: capture from the editor view
  if (!fallbackOpts) {
    throw new Error(
      "Primary ffmpeg export failed, and no fallback capture options were provided."
    );
  }

  console.log("[ProResExport] Falling back to frame capture method");
  return exportCompositionWithFallbackCapture({
    ...ffmpegOpts,
    ...fallbackOpts,
  });
}
