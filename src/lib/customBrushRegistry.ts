/**
 * Custom Brush PNG Registry and Cache
 * Provides fast in-memory access to custom brush PNG data
 * Lazily loads from AsyncStorage on demand
 */

import { getCustomBrushPNG } from './customBrushes';

/**
 * In-memory cache of custom brush PNGs
 * Maps custom brush ID (e.g., "custom_brush_1") to base64 PNG data
 */
const customBrushPNGCache = new Map<string, string>();

/**
 * Get custom brush PNG data (from cache or AsyncStorage)
 */
export const getCustomBrushPNGData = async (brushPngId: string): Promise<string | null> => {
  // Check cache first
  if (customBrushPNGCache.has(brushPngId)) {
    const cached = customBrushPNGCache.get(brushPngId);
    console.log(`[customBrushRegistry] 📦 Cache hit for ${brushPngId}`);
    return cached || null;
  }

  // Load from AsyncStorage if not in cache
  console.log(`[customBrushRegistry] 📥 Loading ${brushPngId} from storage...`);
  const data = await getCustomBrushPNG(brushPngId);

  if (data) {
    // Cache it for future use
    customBrushPNGCache.set(brushPngId, data);
    console.log(`[customBrushRegistry] ✅ Cached ${brushPngId}`);
  }

  return data;
};

/**
 * Invalidate cache entry (when brush is deleted)
 */
export const invalidateCustomBrushPNG = (brushPngId: string): void => {
  customBrushPNGCache.delete(brushPngId);
  console.log(`[customBrushRegistry] 🗑️  Invalidated cache for ${brushPngId}`);
};

/**
 * Clear entire cache
 */
export const clearCustomBrushCache = (): void => {
  customBrushPNGCache.clear();
  console.log(`[customBrushRegistry] 🗑️  Cleared all cached PNGs`);
};

/**
 * Check if an emoji string is a custom brush reference
 */
export const isCustomBrushReference = (emoji: string): boolean => {
  return emoji.startsWith('custom_brush_');
};

/**
 * Synchronously check if PNG data is cached (for use in rendering pipeline)
 * Use this in components that need fast, synchronous access
 */
export const getCachedCustomBrushPNG = (brushPngId: string): string | null => {
  return customBrushPNGCache.get(brushPngId) || null;
};

export default {
  getCustomBrushPNGData,
  invalidateCustomBrushPNG,
  clearCustomBrushCache,
  isCustomBrushReference,
  getCachedCustomBrushPNG,
};
