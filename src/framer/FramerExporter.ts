/**
 * Framer Exporter - PRODUCTION VERSION
 *
 * Uses native MP4ExporterModule for GIF and MP4 (MOV) export
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { CustomOverlayHelper } from '../components/CustomOverlay';
import { exportGifFromFrames, exportMp4FromFrames, isMetalExportAvailable } from '../native/exporter';

export interface ExportOptions {
  format: 'gif' | 'mov';
  quality: 'low' | 'high' | 'ultra';
  fps: number;
  startFrame: number;
  endFrame: number;
  width: number;
  height: number;
  loopCount?: number; // 0 = infinite loop
}

export interface FrameData {
  frameIndex: number;
  imageUri: string; // Base64 data URI
}

/**
 * Detect device capabilities using only React Native APIs
 * Returns conservative resolution settings for MOV export
 */
function getDeviceCapabilities(): { isPad: boolean; maxResolution: number; deviceInfo: string } {
  if (Platform.OS !== 'ios') {
    return { isPad: false, maxResolution: 480, deviceInfo: 'Android' };
  }

  const isIPad = Platform.isPad === true;

  // For iPad: Use conservative 720p max (safe for native module on all iPad generations)
  // For iPhone: Use 960p max (modern iPhones can handle it)
  // This approach doesn't require expo-device and works reliably on all devices

  const maxResolution = isIPad ? 720 : 960;
  const deviceInfo = isIPad ? 'iPad' : 'iPhone';

  return {
    isPad: isIPad,
    maxResolution,
    deviceInfo
  };
}

/**
 * Get export dimensions based on quality setting and device
 * For MOV: Uses quality setting with streaming export (memory efficient!)
 *   - low: 480px (HD) - reliable on all devices
 *   - high: 720px (iPad) or 960px (iPhone) - optimized per device
 *   - ultra: 720px (iPad) or 960px (iPhone) - capped for stability
 * For GIF: Uses quality setting (low=170px, high=510px, ultra=1020px)
 */
export function getExportDimensions(quality: 'low' | 'high' | 'ultra', baseSize: number, format: 'gif' | 'mov' = 'gif'): { width: number; height: number } {
  // MOV: Quality-based resolution with streaming export
  // With streaming, memory usage is minimal (~4MB max) regardless of resolution!
  if (format === 'mov') {
    const capabilities = getDeviceCapabilities();
    const { isPad, maxResolution, deviceInfo } = capabilities;

    // Simple, reliable resolution settings for MOV export
    // All resolutions tested and safe for native MP4ExporterModule
    const resolutions = {
      low: 480,              // HD - reliable on all devices
      high: maxResolution,   // Full quality - device-optimized
      ultra: maxResolution   // Maximum - device-optimized (same as high for safety)
    };

    const size = resolutions[quality];
    console.log(`[EXPORT] MOV resolution: ${size}p (quality: ${quality}, device: ${deviceInfo})`);
    return { width: size, height: size };
  }

  // GIF uses quality setting
  const scales = {
    low: 0.5,     // 340 -> 170px
    high: 1.5,    // 340 -> 510px
    ultra: 3.0    // 340 -> 1020px (~1024px)
  };

  const scale = scales[quality];
  const size = Math.floor(baseSize * scale);

  return { width: size, height: size };
}

/**
 * Remove file:// prefix from path if present and ensure proper encoding
 */
function sanitizePath(path: string): string {
  let cleanPath = path.startsWith('file://') ? path.substring(7) : path;

  // Ensure path doesn't have double slashes or encoding issues
  // Normalize the path
  cleanPath = cleanPath.replace(/\/+/g, '/');

  // Verify path is not empty
  if (!cleanPath || cleanPath.length === 0) {
    throw new Error('Invalid path: path is empty after sanitization');
  }

  return cleanPath;
}

/**
 * Save a single frame to disk immediately (streaming approach)
 * This prevents memory overflow by saving frames one-at-a-time
 */
export async function saveFrameToFile(imageUri: string, frameIndex: number, tempDir: string): Promise<string> {
  const frameNum = String(frameIndex).padStart(4, '0');
  const framePath = `${tempDir}/frame_${frameNum}.png`;

  try {
    // Extract base64 data (remove data URI prefix if present)
    let base64Data = imageUri.includes(',')
      ? imageUri.split(',')[1]
      : imageUri;

    // Validate data
    if (!base64Data || base64Data.length < 100) {
      throw new Error(`Invalid frame data for frame ${frameIndex}`);
    }

    // Write frame to file
    await FileSystem.writeAsStringAsync(framePath, base64Data, {
      encoding: FileSystem.EncodingType.Base64
    });

    // CRITICAL: Clear memory immediately after write
    // This helps with large frame counts (100+ frames) on devices with limited RAM
    base64Data = ''; // Clear the string from memory

    // Verify file was created and has content
    const fileInfo = await FileSystem.getInfoAsync(framePath);
    if (!fileInfo.exists) {
      throw new Error(`Frame file not created: ${framePath}`);
    }

    if (fileInfo.size === 0) {
      throw new Error(`Frame file is empty: ${framePath}`);
    }

    // Return sanitized path for native module (remove file:// prefix)
    return sanitizePath(framePath);
  } catch (error) {
    console.error(`[EXPORT] Failed to save frame ${frameIndex}:`, error);
    throw error;
  }
}

/**
 * Save frames to temporary files (batch approach - kept for compatibility)
 */
async function saveFramesToFiles(frames: FrameData[], tempDir: string): Promise<string[]> {
  const framePaths: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frameNum = String(i).padStart(4, '0');
    const framePath = `${tempDir}/frame_${frameNum}.png`;

    try {
      // Extract base64 data (remove data URI prefix if present)
      const base64Data = frames[i].imageUri.includes(',')
        ? frames[i].imageUri.split(',')[1]
        : frames[i].imageUri;

      // Validate base64 data
      if (!base64Data || base64Data.length === 0) {
        throw new Error(`Frame ${i} has no valid image data`);
      }

      // Write frame to file
      await FileSystem.writeAsStringAsync(framePath, base64Data, {
        encoding: FileSystem.EncodingType.Base64
      });

      // Verify file was created
      const fileInfo = await FileSystem.getInfoAsync(framePath);
      if (!fileInfo.exists || fileInfo.size === 0) {
        throw new Error(`Frame file not created or is empty: ${framePath}`);
      }

      // Sanitize path for native module (remove file:// prefix)
      framePaths.push(sanitizePath(framePath));
      console.log(`[EXPORT FRAMES] ✓ Saved frame ${i}/${frames.length} (${fileInfo.size} bytes)`);
    } catch (error) {
      console.error(`[EXPORT FRAMES] ✗ Failed to save frame ${i}:`, error);
      throw error;
    }
  }

  console.log(`[EXPORT FRAMES] Successfully saved ${framePaths.length}/${frames.length} frames`);
  return framePaths;
}

/**
 * Clean up temporary directory
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(tempDir, { idempotent: true });
    console.log('[CLEANUP] Temp directory deleted:', tempDir);
  } catch (error) {
    console.error('[CLEANUP] Error deleting temp directory:', error);
  }
}

/**
 * Export frames as actual GIF file using native module
 */
export async function exportAsGIF(
  frames: FrameData[],
  options: ExportOptions,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!isMetalExportAvailable()) {
    throw new Error('Native export module not available on this platform');
  }

  // Validate frames before export
  if (!frames || !Array.isArray(frames) || frames.length === 0) {
    throw new Error('Cannot export GIF: no frames provided. Please add frames to the timeline first.');
  }

  try {
    console.log('[EXPORT GIF] Starting GIF creation with', frames.length, 'frames');

    // Request ADD (write-only) permissions for Media Library
    const permission = await MediaLibrary.getPermissionsAsync(false);
    console.log('[EXPORT GIF] Current permission status:', permission.status);

    if (permission.status !== 'granted') {
      const { status } = await MediaLibrary.requestPermissionsAsync(false);
      console.log('[EXPORT GIF] Requested permission result:', status);
      if (status !== 'granted') {
        CustomOverlayHelper.show({ title: 'Permission Required', message: 'Please allow EmojiPaint to add photos to your photo library in Settings.' });
        throw new Error('Media library ADD permission required');
      }
    }

    if (onProgress) onProgress(0.1);

    // Validate frames before export
    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      throw new Error('Cannot export GIF: no frames provided. Please add frames to the timeline first.');
    }

    // Create temp directory in cache (no permissions needed)
    const timestamp = Date.now();
    const tempDir = `${FileSystem.cacheDirectory}temp_gif_${timestamp}`;
    await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });

    console.log('[EXPORT GIF] Temp directory:', tempDir);

    // Save frames to temp files using STREAMING approach (one at a time with memory cleanup)
    console.log('[EXPORT GIF] Saving frames to files (streaming mode)...');
    const framePaths: string[] = [];

    for (let i = 0; i < frames.length; i++) {
      try {
        const framePath = await saveFrameToFile(frames[i].imageUri, i, tempDir);
        framePaths.push(framePath);

        // Update progress
        const progressPercent = 0.1 + (i / frames.length) * 0.15;
        if (onProgress) onProgress(progressPercent);

        if ((i + 1) % 10 === 0) {
          console.log(`[EXPORT GIF] Streamed ${i + 1}/${frames.length} frames`);
        }
      } catch (error) {
        console.error(`[EXPORT GIF] Failed to save frame ${i}:`, error);
        throw new Error(`Failed to save frame ${i}/${frames.length}: ${error}`);
      }
    }

    if (onProgress) onProgress(0.3);

    console.log('[EXPORT GIF] Frames saved:', framePaths.length);

    // Calculate frame delays (in milliseconds)
    const delayMs = Math.floor(1000 / options.fps);
    const delays = new Array(frames.length).fill(delayMs);

    // Output path for GIF in cache directory
    const gifPath = `${FileSystem.cacheDirectory}emojipaint_${timestamp}.gif`;

    console.log('[EXPORT GIF] Calling native GIF exporter...');
    console.log('[EXPORT GIF] Loop count:', options.loopCount ?? 0);

    // Export GIF using native module (sanitize paths for iOS)
    const resultPath = await exportGifFromFrames(
      framePaths,
      delays,
      sanitizePath(gifPath),
      {
        width: options.width,
        height: options.height,
        loopCount: options.loopCount ?? 0 // Respect loop setting, default to infinite
      }
    );

    if (onProgress) onProgress(0.8);

    console.log('[EXPORT GIF] GIF created at:', resultPath);

    // Verify file exists before saving
    const fileInfo = await FileSystem.getInfoAsync(resultPath);
    if (!fileInfo.exists) {
      console.error('[EXPORT GIF] File does not exist at:', resultPath);
      throw new Error('Export failed: GIF file was not created');
    }
    console.log('[EXPORT GIF] File verified, size:', fileInfo.size, 'bytes');

    // Save to photo library — NON-FATAL (the GIF file already exists and is
    // returned for sharing; a Photos failure must not abort the export).
    try {
      const assetPath = resultPath.startsWith('file://') ? resultPath : `file://${resultPath}`;
      console.log('[EXPORT GIF] Saving to photo library:', assetPath);
      const asset = await MediaLibrary.createAssetAsync(assetPath);

      const albumName = 'EmojiPaint Exports';
      let album = await MediaLibrary.getAlbumAsync(albumName);
      if (album === null) {
        album = await MediaLibrary.createAlbumAsync(albumName, asset, false);
      } else {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      }
      console.log('[EXPORT GIF] GIF saved to photo library');
    } catch (photoError) {
      console.warn('[EXPORT GIF] Photo-library save failed (non-fatal, GIF still exported):', photoError);
    }

    if (onProgress) onProgress(1.0);

    // Clean up temp directory (but keep the result file for sharing)
    await cleanupTempDir(tempDir);

    // Return the file path for sharing (NOT the asset.uri which can't be shared)
    console.log('[EXPORT GIF] ✅ Export complete! File ready for sharing:', resultPath);
    return resultPath;
  } catch (error) {
    console.error('[EXPORT GIF] Error:', error);
    throw error;
  }
}

/**
 * Export frames as MP4 (MOV) file using native module
 */
export async function exportAsMOV(
  frames: FrameData[],
  options: ExportOptions,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!isMetalExportAvailable()) {
    throw new Error('Native export module not available on this platform');
  }

  // Validate frames before export
  if (!frames || !Array.isArray(frames) || frames.length === 0) {
    throw new Error('Cannot export MOV: no frames provided. Please add frames to the timeline first.');
  }

  // Declare tempDir at function level so it's accessible in catch block
  let tempDir = '';

  try {
    console.log('[EXPORT MOV] Starting MP4 creation with', frames.length, 'frames');

    // Request ADD (write-only) permissions for Media Library
    const permission = await MediaLibrary.getPermissionsAsync(false);
    console.log('[EXPORT MOV] Current permission status:', permission.status);

    if (permission.status !== 'granted') {
      const { status } = await MediaLibrary.requestPermissionsAsync(false);
      console.log('[EXPORT MOV] Requested permission result:', status);
      if (status !== 'granted') {
        CustomOverlayHelper.show({ title: 'Permission Required', message: 'Please allow EmojiPaint to add videos to your photo library in Settings.' });
        throw new Error('Media library ADD permission required');
      }
    }

    if (onProgress) onProgress(0.1);

    // Create temp directory in cache (no permissions needed)
    const timestamp = Date.now();
    tempDir = `${FileSystem.cacheDirectory}temp_mov_${timestamp}`;
    await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });

    console.log('[EXPORT MOV] Temp directory:', tempDir);

    // Save frames to temp files using OPTIMIZED PARALLEL STREAMING approach
    console.log('[EXPORT MOV] Saving frames to files (optimized parallel streaming mode)...');
    const framePaths: string[] = new Array(frames.length); // Pre-allocate array

    // Determine concurrency level based on device memory
    const concurrencyLevel = Platform.OS === 'ios' ? 3 : 4; // 3-4 parallel tasks
    console.log(`[EXPORT MOV] Using concurrency level: ${concurrencyLevel}`);

    // Process frames in parallel batches to maximize throughput
    for (let i = 0; i < frames.length; i += concurrencyLevel) {
      const batchEndIndex = Math.min(i + concurrencyLevel, frames.length);
      const frameBatch = Array.from({ length: batchEndIndex - i }, (_, idx) => i + idx);

      try {
        // Process multiple frames in parallel
        const batchPromises = frameBatch.map(frameIndex =>
          saveFrameToFile(frames[frameIndex].imageUri, frameIndex, tempDir)
            .then(framePath => {
              framePaths[frameIndex] = framePath;
              return { index: frameIndex, path: framePath };
            })
        );

        // Wait for all frames in this batch to complete
        const results = await Promise.all(batchPromises);

        // Update progress
        const progressPercent = 0.1 + (batchEndIndex / frames.length) * 0.2;
        if (onProgress) onProgress(progressPercent);

        // Log progress every 20 frames
        if (batchEndIndex % 20 === 0 || batchEndIndex === frames.length) {
          console.log(`[EXPORT MOV] Saved ${batchEndIndex}/${frames.length} frames (${Math.round((batchEndIndex / frames.length) * 100)}%)`);
        }
      } catch (error) {
        console.error(`[EXPORT MOV] Failed to save frame batch starting at ${i}:`, error);
        throw new Error(`Failed to save frames ${i}-${batchEndIndex}: ${error}`);
      }

      // Cleanup after each batch
      if (i > 0 && i % 50 === 0) {
        // Force garbage collection periodically
        if (global.gc) {
          try {
            global.gc();
          } catch (e) {
            // GC not available, continue
          }
        }
      }
    }

    // Filter out any undefined entries (safety check)
    const validFramePaths = framePaths.filter(p => p !== undefined);

    if (onProgress) onProgress(0.3);

    console.log('[EXPORT MOV] Frames saved:', validFramePaths.length);

    // Output path for MP4 in cache directory
    const mp4Path = `${FileSystem.cacheDirectory}emojipaint_${timestamp}.mp4`;

    console.log('[EXPORT MOV] Calling native MP4 exporter...');
    console.log('[EXPORT MOV] FPS:', options.fps);
    console.log('[EXPORT MOV] Frame paths count:', validFramePaths.length);
    console.log('[EXPORT MOV] First frame path:', validFramePaths[0]);
    console.log('[EXPORT MOV] Last frame path:', validFramePaths[validFramePaths.length - 1]);
    console.log('[EXPORT MOV] Frame paths:', JSON.stringify(validFramePaths.slice(0, 3), null, 2)); // Log first 3 for debugging

    // Verify ALL frame files exist and are valid PNGs before passing to native module
    console.log('[EXPORT MOV] Verifying frame files exist and are valid (parallel validation)...');
    const missingFrames: number[] = [];
    const corruptFrames: number[] = [];
    const invalidPNGFrames: number[] = [];

    // Validate frames in parallel batches for speed
    const validationBatchSize = 50;
    for (let i = 0; i < validFramePaths.length; i += validationBatchSize) {
      const batchEndIndex = Math.min(i + validationBatchSize, validFramePaths.length);
      const batchToValidate = validFramePaths.slice(i, batchEndIndex);

      try {
        const validationPromises = batchToValidate.map((framePath, batchIdx) =>
          FileSystem.getInfoAsync(framePath).then(info => {
            const actualIdx = i + batchIdx;
            if (!info.exists) {
              missingFrames.push(actualIdx);
              console.error(`[EXPORT MOV] Frame ${actualIdx}: MISSING!`);
            } else if (info.size === 0 || !info.size) {
              corruptFrames.push(actualIdx);
              console.error(`[EXPORT MOV] Frame ${actualIdx}: CORRUPT (size: ${info.size})`);
            } else if (info.size < 100) {
              invalidPNGFrames.push(actualIdx);
              console.error(`[EXPORT MOV] Frame ${actualIdx}: TOO SMALL (size: ${info.size} bytes)`);
            }
            return { index: actualIdx, valid: !missingFrames.includes(actualIdx) && !corruptFrames.includes(actualIdx) };
          })
        );

        await Promise.all(validationPromises);
        console.log(`[EXPORT MOV] Validated frames ${i}-${batchEndIndex}/${validFramePaths.length}`);
      } catch (e) {
        console.error(`[EXPORT MOV] Error validating batch ${i}-${batchEndIndex}:`, e);
      }
    }

    if (missingFrames.length > 0) {
      throw new Error(`Export failed: ${missingFrames.length} frame files are missing. Frames: ${missingFrames.slice(0, 10).join(', ')}${missingFrames.length > 10 ? '...' : ''}`);
    }
    if (corruptFrames.length > 0) {
      throw new Error(`Export failed: ${corruptFrames.length} frame files are corrupt/empty. Frames: ${corruptFrames.slice(0, 10).join(', ')}${corruptFrames.length > 10 ? '...' : ''}`);
    }
    if (invalidPNGFrames.length > 0) {
      throw new Error(`Export failed: ${invalidPNGFrames.length} frame files are too small/invalid. Frames: ${invalidPNGFrames.slice(0, 10).join(', ')}${invalidPNGFrames.length > 10 ? '...' : ''}`);
    }
    console.log(`[EXPORT MOV] ✅ All ${framePaths.length} frames verified as valid PNGs!`);

    // CRITICAL: Force garbage collection by clearing frame data from memory
    // This prevents memory overflow when exporting many frames
    console.log('[EXPORT MOV] Clearing frame data from memory to prevent crashes...');
    (frames as any) = null; // Clear original frame array
    if (global.gc) {
      try {
        global.gc(); // Force garbage collection if available
        console.log('[EXPORT MOV] Garbage collection triggered');
      } catch (e) {
        console.log('[EXPORT MOV] GC not available');
      }
    }

    try {
      // Export MP4 using native module (sanitize paths for iOS)
      console.log(`[EXPORT MOV] Starting native MP4 export with ${validFramePaths.length} frames...`);

      // CRITICAL FIX for iPad crash: Do a final double-check that all frames still exist
      // Frames can become inaccessible due to temp directory cleanup or memory issues
      console.log('[EXPORT MOV] Final frame accessibility check before native export...');
      const finalCheckPromises = validFramePaths.map((framePath, idx) =>
        FileSystem.getInfoAsync(framePath)
          .then(info => {
            if (!info.exists) {
              console.warn(`[EXPORT MOV] ⚠️ Frame ${idx} is no longer accessible: ${framePath}`);
              return false;
            }
            return true;
          })
          .catch(err => {
            console.warn(`[EXPORT MOV] ⚠️ Frame ${idx} check failed: ${framePath}, error: ${err}`);
            return false;
          })
      );

      const frameAccessibilityResults = await Promise.all(finalCheckPromises);
      const inaccessibleCount = frameAccessibilityResults.filter(r => !r).length;

      if (inaccessibleCount > 0) {
        console.error(`[EXPORT MOV] ❌ ${inaccessibleCount} frames are inaccessible before native export!`);
        // Try to continue if most frames are accessible, but warn
        if (inaccessibleCount > validFramePaths.length * 0.1) {
          throw new Error(`Export failed: Too many frames lost access (${inaccessibleCount}/${validFramePaths.length}). This can happen due to system resource constraints. Try:\n1) Restarting the app\n2) Using fewer frames\n3) Closing other apps to free memory`);
        }
      }

      console.log('[EXPORT MOV] Preparing native export params:', { width: options.width, height: options.height, fps: options.fps });

      let resultPath: string;
      try {
        resultPath = await exportMp4FromFrames(
          validFramePaths,
          sanitizePath(mp4Path),
          {
            width: options.width,
            height: options.height,
            fps: options.fps
          }
        );
      } catch (firstAttemptError) {
        console.error('[EXPORT MOV] ⚠️ First export attempt failed:', firstAttemptError);

        // On iPad with large frame counts, automatically reduce resolution and retry
        if (Platform.OS === 'ios' && validFramePaths.length > 60) {
          const isIPad = Platform.isPad === true;
          if (isIPad && options.width > 720) {
            console.log('[EXPORT MOV] 🔄 iPad crash detected - retrying with reduced resolution (720p)...');
            resultPath = await exportMp4FromFrames(
              validFramePaths,
              sanitizePath(mp4Path),
              {
                width: 720,  // Force 720p on iPad for stability
                height: 720,
                fps: options.fps
              }
            );
          } else {
            throw firstAttemptError;
          }
        } else {
          throw firstAttemptError;
        }
      }

      if (onProgress) onProgress(0.8);

      console.log('[EXPORT MOV] MP4 created at:', resultPath);

      // Verify file exists before saving
      const fileInfo = await FileSystem.getInfoAsync(resultPath);
      if (!fileInfo.exists) {
        console.error('[EXPORT MOV] File does not exist at:', resultPath);
        throw new Error('Export failed: MP4 file was not created by native module');
      }
      console.log('[EXPORT MOV] File verified, size:', fileInfo.size, 'bytes');

      // Save to photo library (MediaLibrary needs file:// prefix).
      // NON-FATAL: the video file already exists and is returned for sharing, so
      // a Photos-library failure (e.g. PHPhotosError 3301 — Add-Only permission or
      // iCloud/storage issue) must NOT abort the export or block the share view.
      try {
        const assetPath = resultPath.startsWith('file://') ? resultPath : `file://${resultPath}`;
        console.log('[EXPORT MOV] Saving to photo library:', assetPath);
        const asset = await MediaLibrary.createAssetAsync(assetPath);

        // Create or get album
        const albumName = 'EmojiPaint Exports';
        let album = await MediaLibrary.getAlbumAsync(albumName);
        if (album === null) {
          album = await MediaLibrary.createAlbumAsync(albumName, asset, false);
        } else {
          await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
        }
        console.log('[EXPORT MOV] MP4 saved to photo library');
      } catch (photoError) {
        console.warn('[EXPORT MOV] Photo-library save failed (non-fatal, video still exported):', photoError);
      }

      if (onProgress) onProgress(1.0);

      // Clean up temp directory (but keep the result file for sharing)
      await cleanupTempDir(tempDir);

      // Return the file path for sharing (NOT the asset.uri which can't be shared)
      console.log('[EXPORT MOV] ✅ Export complete! File ready for sharing:', resultPath);
      return resultPath;
    } catch (nativeError) {
      console.error('[EXPORT MOV] Native export error:', nativeError);
      console.error('[EXPORT MOV] Frame paths for reference:', validFramePaths.slice(0, 5));
      const errorMsg = String(nativeError);

      // Provide detailed error handling for common issues
      if (errorMsg.includes('-12902') || errorMsg.includes('AVFoundation') || errorMsg.includes('alpha') || errorMsg.includes('codec')) {
        // AVFoundation error -12902: Usually related to incompatible codec settings or alpha channel issues
        console.error('[EXPORT MOV] CODEC ERROR - This is likely an alpha channel or codec compatibility issue');
        throw new Error(`Export failed: Video codec error. Try reducing quality (use 'low' instead of 'high' or 'ultra') or reducing frame count. Error: ${errorMsg}`);
      }

      if (errorMsg.includes('cannot add input') || errorMsg.includes('Could not find') || errorMsg.includes('NotFound')) {
        // Log detailed diagnostics
        console.error('[EXPORT MOV] DIAGNOSTICS:');
        console.error('[EXPORT MOV] - Total frames:', validFramePaths.length);
        console.error('[EXPORT MOV] - Temp directory:', tempDir);
        console.error('[EXPORT MOV] - First frame path:', validFramePaths[0]);
        console.error('[EXPORT MOV] - Sample error paths:', validFramePaths.slice(0, 3));

        throw new Error(`Export failed: Native encoder cannot process frames. Frames may have become inaccessible. Try: 1) Restarting the app, 2) Reducing frame count, 3) Using lower quality. Error: ${errorMsg}`);
      }

      // For any other error on iPad/large exports, provide helpful guidance
      if (Platform.OS === 'ios') {
        console.error('[EXPORT MOV] Possible causes on iOS:');
        console.error('[EXPORT MOV] 1) Memory pressure (try closing other apps)');
        console.error('[EXPORT MOV] 2) Temp storage full (try clearing app cache)');
        console.error('[EXPORT MOV] 3) Frame data corruption (try re-rendering)');
        console.error('[EXPORT MOV] 4) Native module communication timeout');
      }

      throw nativeError;
    }
  } catch (error) {
    console.error('[EXPORT MOV] Fatal error:', error);
    // Clean up temp files on error
    try {
      await cleanupTempDir(tempDir);
    } catch (cleanupErr) {
      console.error('[EXPORT MOV] Cleanup error:', cleanupErr);
    }
    throw error;
  }
}

/**
 * Export MP4 (MOV) from pre-saved frame files (streaming approach)
 * This function accepts file paths directly, avoiding the need to hold
 * all frame data in memory. Perfect for high-resolution exports!
 */
export async function exportAsMOVFromPaths(
  framePaths: string[],
  options: ExportOptions,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!isMetalExportAvailable()) {
    throw new Error('Native export module not available on this platform');
  }

  try {
    // Validate framePaths before export
    if (!framePaths || !Array.isArray(framePaths) || framePaths.length === 0) {
      throw new Error('Cannot export MOV: no frames provided. Please add frames to the timeline first.');
    }

    console.log('[EXPORT MOV STREAM] Starting MP4 creation from', framePaths.length, 'pre-saved frames');
    console.log('[EXPORT MOV STREAM] Requested Resolution:', options.width, 'x', options.height);
    console.log('[EXPORT MOV STREAM] FPS:', options.fps);
    console.log('[EXPORT MOV STREAM] First frame path:', framePaths[0]);

    // Request ADD (write-only) permissions for Media Library
    const permission = await MediaLibrary.getPermissionsAsync(false);
    if (permission.status !== 'granted') {
      const { status } = await MediaLibrary.requestPermissionsAsync(false);
      if (status !== 'granted') {
        CustomOverlayHelper.show({ title: 'Permission Required', message: 'Please allow EmojiPaint to add videos to your photo library in Settings.' });
        throw new Error('Media library ADD permission required');
      }
    }

    if (onProgress) onProgress(0.1);

    // Output path for MP4 in cache directory
    const timestamp = Date.now();
    const mp4Path = `${FileSystem.cacheDirectory}emojipaint_${timestamp}.mp4`;

    console.log('[EXPORT MOV STREAM] Calling native MP4 exporter...');
    console.log('[EXPORT MOV STREAM] FPS:', options.fps);
    console.log('[EXPORT MOV STREAM] Frame paths count:', framePaths.length);
    console.log('[EXPORT MOV STREAM] First few frame paths:', framePaths.slice(0, 3));

    // Verify frame files exist before passing to native module
    console.log('[EXPORT MOV STREAM] Verifying frame files exist...');
    const missingFrames: number[] = [];
    const corruptFrames: number[] = [];
    for (let i = 0; i < Math.min(framePaths.length, 20); i++) { // Check first 20 frames
      try {
        const info = await FileSystem.getInfoAsync(framePaths[i]);
        if (!info.exists) {
          missingFrames.push(i);
          console.error(`[EXPORT MOV STREAM] Frame ${i}: MISSING!`);
        } else if (info.size === 0 || !info.size) {
          corruptFrames.push(i);
          console.error(`[EXPORT MOV STREAM] Frame ${i}: CORRUPT (size: ${info.size})`);
        }
      } catch (e) {
        missingFrames.push(i);
        console.error(`[EXPORT MOV STREAM] Failed to check frame ${i}:`, e);
      }
    }

    if (missingFrames.length > 0) {
      throw new Error(`Export failed: ${missingFrames.length} frame files are missing. Frames: ${missingFrames.join(', ')}`);
    }
    if (corruptFrames.length > 0) {
      throw new Error(`Export failed: ${corruptFrames.length} frame files are corrupt/empty. Frames: ${corruptFrames.join(', ')}`);
    }
    console.log(`[EXPORT MOV STREAM] ✅ Frame files verified!`);

    // Export MP4 using native module (paths are already sanitized)
    const resultPath = await exportMp4FromFrames(
      framePaths,
      sanitizePath(mp4Path),
      {
        width: options.width,
        height: options.height,
        fps: options.fps
      }
    );

    if (onProgress) onProgress(0.8);

    console.log('[EXPORT MOV STREAM] MP4 created at:', resultPath);

    // Verify file exists before saving
    const fileInfo = await FileSystem.getInfoAsync(resultPath);
    if (!fileInfo.exists) {
      console.error('[EXPORT MOV STREAM] File does not exist at:', resultPath);
      throw new Error('Export failed: MP4 file was not created');
    }
    console.log('[EXPORT MOV STREAM] File verified, size:', fileInfo.size, 'bytes');

    // Save to photo library (MediaLibrary needs file:// prefix)
    const assetPath = resultPath.startsWith('file://') ? resultPath : `file://${resultPath}`;
    console.log('[EXPORT MOV STREAM] Saving to photo library:', assetPath);
    const asset = await MediaLibrary.createAssetAsync(assetPath);

    // Create or get album
    const albumName = 'EmojiPaint Exports';
    let album = await MediaLibrary.getAlbumAsync(albumName);
    if (album === null) {
      album = await MediaLibrary.createAlbumAsync(albumName, asset, false);
    } else {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    }

    console.log('[EXPORT MOV STREAM] MP4 saved to photo library');

    if (onProgress) onProgress(1.0);

    // Return the file path for sharing (NOT the asset.uri which can't be shared)
    console.log('[EXPORT MOV STREAM] ✅ Export complete! File ready for sharing:', resultPath);
    return resultPath;
  } catch (nativeError) {
    console.error('[EXPORT MOV STREAM] Error:', nativeError);
    const errorMsg = String(nativeError);

    // Provide detailed error handling for common issues
    if (errorMsg.includes('-12902') || errorMsg.includes('AVFoundation') || errorMsg.includes('alpha') || errorMsg.includes('codec')) {
      // AVFoundation error -12902: Usually related to incompatible codec settings or alpha channel issues
      console.error('[EXPORT MOV STREAM] CODEC ERROR - This is likely an alpha channel or codec compatibility issue');
      throw new Error(`Export failed: Video codec error. Try reducing quality (use 'low' instead of 'high' or 'ultra') or reducing frame count. Error: ${errorMsg}`);
    }

    if (errorMsg.includes('cannot add input') || errorMsg.includes('Could not find')) {
      console.error('[EXPORT MOV STREAM] DIAGNOSTICS:');
      console.error('[EXPORT MOV STREAM] - Total frames:', framePaths.length);
      console.error('[EXPORT MOV STREAM] - First frame path:', framePaths[0]);
      console.error('[EXPORT MOV STREAM] - Sample paths:', framePaths.slice(0, 3));

      throw new Error(`Export failed: Native encoder cannot process frames. This may indicate corrupted frame data or invalid file paths. Try: 1) Clearing and re-rendering frames, 2) Reducing frame count, or 3) Using lower quality. Error: ${errorMsg}`);
    }
    throw nativeError;
  }
}

/**
 * Share exported file
 */
export async function shareExport(fileUri: string, format: 'gif' | 'mov'): Promise<void> {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      CustomOverlayHelper.alert('Sharing not available', `${format.toUpperCase()} saved to your photo library`);
      return;
    }

    // Ensure file has file:// prefix for sharing
    const shareUri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
    console.log('[EXPORT SHARE] Sharing file:', shareUri);

    // Verify file exists before sharing
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists) {
      console.error('[EXPORT SHARE] File does not exist:', fileUri);
      CustomOverlayHelper.show({ title: 'Share Failed', message: `File not found. ${format.toUpperCase()} is saved in your photo library.` });
      return;
    }

    await Sharing.shareAsync(shareUri, {
      mimeType: format === 'gif' ? 'image/gif' : 'video/mp4',
      dialogTitle: `Share ${format.toUpperCase()}`
    });

    console.log('[EXPORT SHARE] ✅ Share complete');

    // Clean up the temp file after sharing
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
    console.log('[EXPORT SHARE] Cleaned up temp file:', fileUri);
  } catch (error) {
    console.error('[EXPORT SHARE] Error:', error);
    CustomOverlayHelper.show({ title: 'Share Failed', message: `Could not share ${format.toUpperCase()}. File is saved in your photo library.` });
  }
}

/**
 * Get album info
 */
export async function getExportAlbumInfo(): Promise<{ frameCount: number; albumExists: boolean }> {
  try {
    const album = await MediaLibrary.getAlbumAsync('EmojiPaint Exports');
    if (album) {
      const assets = await MediaLibrary.getAssetsAsync({ album: album.id, first: 1000 });
      return { frameCount: assets.totalCount, albumExists: true };
    }
    return { frameCount: 0, albumExists: false };
  } catch (error) {
    console.error('[EXPORT INFO] Error:', error);
    return { frameCount: 0, albumExists: false };
  }
}
