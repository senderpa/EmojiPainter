/**
 * Framer Mini Preview Generator
 * Generates 128x128 animated MOV video previews for quick project visualization
 * Optimized for speed with minimal file size
 */

import * as FileSystem from 'expo-file-system/legacy';
import { exportMp4FromFrames } from '../native/exporter';

export interface MiniPreviewOptions {
  frameCount: number;
  maxFrames?: number; // Limit preview to N frames (default: 8 for speed)
  fps?: number; // Frames per second (default: 10 for low bitrate)
  quality?: 'low'; // Only low quality for speed
  sizePixels?: number; // Default: 128
  format?: 'mov'; // Only MOV format for autoplay video
}

export interface MiniPreviewResult {
  uri: string; // File path to MOV video
  size: number; // File size in bytes
  generatedAt: string;
  duration: number; // Video duration in seconds
}

/**
 * Generate a mini 128x128 MOV video preview from frames
 * Fast generation using frame sampling, low quality, and minimal FPS
 *
 * Optimization strategy:
 * - Sample only 8 key frames from full animation
 * - Use 10 FPS (minimal bitrate)
 * - 128x128 resolution (tiny file)
 * - Low quality setting
 * - Result: Fast generation, <500KB file, instant playback
 */
export async function generateMiniMOVPreview(
  frames: any[],
  renderFrameToImage: (frameIndex: number) => Promise<string>, // Function to render frame to data URI
  options: MiniPreviewOptions = {}
): Promise<MiniPreviewResult | null> {
  const {
    maxFrames = 8,
    fps = 10,
    quality = 'low',
    sizePixels = 128,
    format = 'mov',
  } = options;

  try {

    if (!frames || frames.length === 0) {
      console.warn('[MINI PREVIEW] ⚠️ No frames provided');
      return null;
    }

    // Sample frames evenly from the full set
    const sampleIndices = sampleFrameIndices(frames.length, Math.min(maxFrames, frames.length));

    // Render sampled frames to images
    const frameDataUris: string[] = [];
    for (let i = 0; i < sampleIndices.length; i++) {
      try {
        const frameIndex = sampleIndices[i];
        const imageUri = await renderFrameToImage(frameIndex);
        frameDataUris.push(imageUri);
      } catch (renderError) {
        console.warn(`[MINI PREVIEW] ⚠️ Failed to render frame ${i}:`, renderError);
        // Continue with next frame
      }
    }

    if (frameDataUris.length === 0) {
      console.warn('[MINI PREVIEW] ⚠️ No frames could be rendered');
      return null;
    }


    // Generate temporary file path for MOV
    const tempDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    const fileName = `mini_preview_${Date.now()}.mov`;
    const outputPath = `${tempDir}${fileName}`;


    // Export MOV using native exporter
    const result = await exportMp4FromFrames(
      frameDataUris,
      {
        format: 'mov',
        quality: quality as any,
        fps: fps,
        startFrame: 0,
        endFrame: frameDataUris.length - 1,
        width: sizePixels,
        height: sizePixels,
        loopCount: 0, // Infinite loop for preview
      },
      outputPath
    );

    // Check file size
    try {
      const fileInfo = await FileSystem.getInfoAsync(outputPath);
      const fileSizeKB = (fileInfo.size || 0) / 1024;
      const durationSeconds = frameDataUris.length / fps;


      return {
        uri: outputPath,
        size: fileInfo.size || 0,
        generatedAt: new Date().toISOString(),
        duration: durationSeconds,
      };
    } catch (sizeError) {
      console.warn('[MINI PREVIEW] ⚠️ Could not determine file size:', sizeError);
      return {
        uri: outputPath,
        size: 0,
        generatedAt: new Date().toISOString(),
        duration: frameDataUris.length / fps,
      };
    }
  } catch (error) {
    console.error('[MINI PREVIEW] ❌ Failed to generate MOV preview:', error);
    return null;
  }
}

/**
 * Sample frame indices evenly from the total
 */
function sampleFrameIndices(total: number, sampleCount: number): number[] {
  if (total <= sampleCount) {
    return Array.from({ length: total }, (_, i) => i);
  }

  const indices: number[] = [];
  const step = total / sampleCount;

  for (let i = 0; i < sampleCount; i++) {
    indices.push(Math.floor(i * step));
  }

  return indices;
}

/**
 * Get optimized export dimensions for mini preview
 */
export function getMiniPreviewDimensions(baseSize: number = 128): { width: number; height: number } {
  return {
    width: baseSize,
    height: baseSize,
  };
}

/**
 * Create loader configuration for preview generation
 */
export function createPreviewLoaderConfig() {
  return {
    title: '🎬 Generating Preview...',
    message: 'Creating animated video (128x128)...',
    duration: 2000, // Typical generation time
    showSpinner: true,
  };
}

/**
 * Validate if preview generation is supported
 */
export function isPreviewGenerationSupported(): boolean {
  try {
    require('../native/exporter');
    return true;
  } catch {
    return false;
  }
}
