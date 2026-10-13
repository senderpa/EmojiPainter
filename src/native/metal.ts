/**
 * MetalCanvasModule Bridge
 * Native Metal-based emoji rendering for high-performance drawing
 */

import { NativeModules, Platform } from 'react-native';

interface MetalCanvasModuleInterface {
  /**
   * Initialize Metal canvas with specified dimensions
   */
  initCanvas(width: number, height: number, pixelRatio: number): Promise<void>;

  /**
   * Draw an emoji stamp at the specified position
   */
  drawEmoji(
    emoji: string,
    x: number,
    y: number,
    size: number,
    opacity: number,
    mirrorX: boolean,
    mirrorY: boolean,
    rotation: number
  ): Promise<void>;

  /**
   * Draw multiple emoji stamps in a batch (more efficient)
   */
  drawEmojiStamps(
    stamps: Array<{
      emoji: string;
      x: number;
      y: number;
      size: number;
      opacity: number;
      mirrorX: boolean;
      mirrorY: boolean;
      rotation: number;
    }>
  ): Promise<void>;

  /**
   * Clear the entire canvas
   */
  clearCanvas(): Promise<void>;

  /**
   * Get the current canvas as a PNG image (base64 or file path)
   */
  captureImage(format: 'base64' | 'file', destinationPath?: string): Promise<string>;

  /**
   * Get the Metal texture handle for export modules
   */
  getTextureHandle(): Promise<number>;

  /**
   * Create a checkpoint (save current state for undo/redo)
   */
  createCheckpoint(checkpointId: string): Promise<void>;

  /**
   * Restore from a checkpoint
   */
  restoreCheckpoint(checkpointId: string): Promise<void>;

  /**
   * Delete a checkpoint to free memory
   */
  deleteCheckpoint(checkpointId: string): Promise<void>;

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): Promise<{
    textureMemoryBytes: number;
    checkpointCount: number;
    atlasMemoryBytes: number;
  }>;
}

const MetalCanvasModule: MetalCanvasModuleInterface | null =
  Platform.OS === 'ios' ? NativeModules.MetalCanvasModule : null;

/**
 * Check if Metal rendering is available on this device
 */
export const isMetalAvailable = (): boolean => {
  return Platform.OS === 'ios' && MetalCanvasModule !== null;
};

/**
 * Initialize Metal canvas with specified dimensions
 */
export const initCanvas = async (
  width: number,
  height: number,
  pixelRatio: number = 1
): Promise<void> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }
  return MetalCanvasModule.initCanvas(width, height, pixelRatio);
};

/**
 * Draw an emoji stamp at the specified position
 */
export const drawEmoji = async (
  emoji: string,
  x: number,
  y: number,
  size: number,
  opacity: number = 1.0,
  mirrorX: boolean = false,
  mirrorY: boolean = false,
  rotation: number = 0
): Promise<void> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }
  return MetalCanvasModule.drawEmoji(emoji, x, y, size, opacity, mirrorX, mirrorY, rotation);
};

/**
 * Draw multiple emoji stamps in a batch (more efficient for strokes)
 */
export const drawEmojiStamps = async (
  stamps: Array<{
    emoji: string;
    x: number;
    y: number;
    size: number;
    opacity?: number;
    mirrorX?: boolean;
    mirrorY?: boolean;
    rotation?: number;
  }>
): Promise<void> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }

  // Normalize stamps with default values
  const normalizedStamps = stamps.map((stamp) => ({
    emoji: stamp.emoji,
    x: stamp.x,
    y: stamp.y,
    size: stamp.size,
    opacity: stamp.opacity ?? 1.0,
    mirrorX: stamp.mirrorX ?? false,
    mirrorY: stamp.mirrorY ?? false,
    rotation: stamp.rotation ?? 0,
  }));

  return MetalCanvasModule.drawEmojiStamps(normalizedStamps);
};

/**
 * Clear the entire canvas
 */
export const clearCanvas = async (): Promise<void> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }
  return MetalCanvasModule.clearCanvas();
};

/**
 * Capture the current canvas as an image
 */
export const captureImage = async (
  format: 'base64' | 'file' = 'file',
  destinationPath?: string
): Promise<string> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }
  return MetalCanvasModule.captureImage(format, destinationPath);
};

/**
 * Get the Metal texture handle for use in export modules
 */
export const getTextureHandle = async (): Promise<number> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }
  return MetalCanvasModule.getTextureHandle();
};

/**
 * Create a checkpoint for undo/redo functionality
 */
export const createCheckpoint = async (checkpointId: string): Promise<void> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }
  return MetalCanvasModule.createCheckpoint(checkpointId);
};

/**
 * Restore canvas state from a checkpoint
 */
export const restoreCheckpoint = async (checkpointId: string): Promise<void> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }
  return MetalCanvasModule.restoreCheckpoint(checkpointId);
};

/**
 * Delete a checkpoint to free memory
 */
export const deleteCheckpoint = async (checkpointId: string): Promise<void> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }
  return MetalCanvasModule.deleteCheckpoint(checkpointId);
};

/**
 * Get memory usage statistics
 */
export const getMemoryStats = async (): Promise<{
  textureMemoryBytes: number;
  checkpointCount: number;
  atlasMemoryBytes: number;
}> => {
  if (!MetalCanvasModule) {
    throw new Error('MetalCanvasModule not available on this platform');
  }
  return MetalCanvasModule.getMemoryStats();
};

export default {
  isMetalAvailable,
  initCanvas,
  drawEmoji,
  drawEmojiStamps,
  clearCanvas,
  captureImage,
  getTextureHandle,
  createCheckpoint,
  restoreCheckpoint,
  deleteCheckpoint,
  getMemoryStats,
};
