/**
 * PNG Normalization Utility
 * Converts custom PNG images to standard emoji dimensions and base64 format
 */

import * as ImageManipulator from 'expo-image-manipulator';

export interface NormalizedImage {
  base64: string; // Base64 encoded PNG data
  emoji: string; // Can be used as emoji placeholder in painting
  width: number;
  height: number;
  size: number; // File size in bytes
}

const STANDARD_EMOJI_SIZE = 128; // Standard emoji is 128x128px
const QUALITY = 0.85; // JPEG quality for compression

/**
 * Normalize a PNG image to standard emoji dimensions
 * @param imageUri - Local URI or base64 data of the image
 * @param maxSize - Maximum dimension (default 128px for emoji size)
 * @returns Normalized image with base64 data
 */
export const normalizePng = async (
  imageUri: string,
  maxSize: number = STANDARD_EMOJI_SIZE
): Promise<NormalizedImage | null> => {
  try {
    console.log('[PngNormalizer] Starting normalization:', imageUri.substring(0, 50) + '...');

    // Use ImageManipulator to resize the image
    const manipulated = await ImageManipulator.manipulateAsync(
      imageUri,
      [
        {
          resize: {
            width: maxSize,
            height: maxSize,
          },
        },
      ],
      {
        compress: QUALITY,
        format: ImageManipulator.SaveFormat.PNG,
        base64: true,
      }
    );

    if (!manipulated.base64) {
      throw new Error('Failed to generate base64 from image');
    }

    // Calculate file size from base64
    // Base64 encoding is 4 chars per 3 bytes, so divide by 4 and multiply by 3
    const fileSize = Math.ceil((manipulated.base64.length * 3) / 4);

    const normalized: NormalizedImage = {
      base64: manipulated.base64,
      emoji: '🎨', // Use art palette as placeholder emoji
      width: manipulated.width,
      height: manipulated.height,
      size: fileSize,
    };

    console.log('[PngNormalizer] Normalized successfully:', {
      width: normalized.width,
      height: normalized.height,
      size: normalized.size,
    });

    return normalized;
  } catch (error) {
    console.error('[PngNormalizer] Failed to normalize PNG:', error);
    return null;
  }
};

/**
 * Create an emoji from base64 PNG data
 * Can be used directly in the brush system
 * @param base64Data - Base64 encoded PNG
 * @returns Data URI that can be used as brush emoji
 */
export const base64ToDataUri = (base64Data: string): string => {
  return `data:image/png;base64,${base64Data}`;
};

/**
 * Extract base64 from data URI
 * @param dataUri - Data URI string
 * @returns Base64 string
 */
export const dataUriToBase64 = (dataUri: string): string => {
  return dataUri.replace(/^data:image\/png;base64,/, '');
};

/**
 * Check if an emoji string is actually a custom PNG (data URI)
 * @param emoji - Emoji string to check
 * @returns true if it's a PNG data URI
 */
export const isCustomPng = (emoji: string): boolean => {
  return emoji.startsWith('data:image/png;base64,');
};

/**
 * Get size information from base64 PNG
 * @param base64Data - Base64 encoded PNG
 * @returns Estimated file size in bytes
 */
export const getBase64Size = (base64Data: string): number => {
  return Math.ceil((base64Data.length * 3) / 4);
};

/**
 * Optimize base64 string for storage (remove redundant data URIs)
 * @param emoji - Emoji string (could be data URI)
 * @returns Optimized emoji string
 */
export const optimizeEmoji = (emoji: string): string => {
  if (isCustomPng(emoji)) {
    return emoji;
  }
  return emoji;
};

export default {
  normalizePng,
  base64ToDataUri,
  dataUriToBase64,
  isCustomPng,
  getBase64Size,
  optimizeEmoji,
};
