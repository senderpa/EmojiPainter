/**
 * Gallery Optimization Utilities
 * Handles thumbnail generation, image sizing, and layout preferences
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Image, Platform } from 'react-native';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

// ===== THUMBNAIL OPTIMIZATION =====

/**
 * Calculate optimal thumbnail size based on device screen
 */
export const getThumbnailDimensions = (): { width: number; height: number } => {
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  if (IS_IPAD) {
    // iPad: larger thumbnails
    return { width: 400, height: 300 };
  }

  // Phone: optimize for list/grid
  if (screenWidth < 400) {
    // Small phone
    return { width: 200, height: 150 };
  } else if (screenWidth < 600) {
    // Regular phone
    return { width: 300, height: 225 };
  } else {
    // Large phone/tablet
    return { width: 400, height: 300 };
  }
};

/**
 * Generate optimized thumbnail URL with query parameters
 * Adds ?w=width&h=height to reduce bandwidth and memory usage
 *
 * @param imageUrl - Original image URL
 * @param width - Optional width override (default: calculated)
 * @param height - Optional height override (default: calculated)
 * @returns Optimized URL with size parameters
 */
export const getThumbnailUrl = (
  imageUrl: string | undefined | null,
  width?: number,
  height?: number
): string | null => {
  if (!imageUrl) return null;

  const dims = { width: width || getThumbnailDimensions().width, height: height || getThumbnailDimensions().height };

  // Check if URL already has query params
  const separator = imageUrl.includes('?') ? '&' : '?';

  return `${imageUrl}${separator}w=${Math.round(dims.width)}&h=${Math.round(dims.height)}`;
};

/**
 * Get thumbnail URL for list item (smaller)
 */
export const getListThumbnailUrl = (imageUrl: string | undefined | null): string | null => {
  return getThumbnailUrl(imageUrl, 150, 100);
};

/**
 * Get thumbnail URL for grid item (medium)
 */
export const getGridThumbnailUrl = (imageUrl: string | undefined | null): string | null => {
  return getThumbnailUrl(imageUrl, 250, 250);
};

// ===== LAYOUT PREFERENCE STORAGE =====

const GALLERY_LAYOUT_STORAGE_KEY = 'emojipaint/gallery/layout-preference';
const GALLERY_SORT_STORAGE_KEY = 'emojipaint/gallery/sort-preference';

export type GalleryLayoutMode = 'default' | 'list' | 'grid' | 'random';
export type GallerySortMode = 'new' | 'hot' | 'personal';

/**
 * Save gallery layout preference to persistent storage
 */
export const saveGalleryLayoutPreference = async (layout: GalleryLayoutMode): Promise<void> => {
  try {
    await AsyncStorage.setItem(GALLERY_LAYOUT_STORAGE_KEY, layout);
    console.log('[GalleryOptimization] Saved layout preference:', layout);
  } catch (error) {
    console.warn('[GalleryOptimization] Failed to save layout preference:', error);
  }
};

/**
 * Load gallery layout preference from storage
 */
export const loadGalleryLayoutPreference = async (): Promise<GalleryLayoutMode | null> => {
  try {
    const saved = await AsyncStorage.getItem(GALLERY_LAYOUT_STORAGE_KEY);
    if (saved && ['default', 'list', 'grid', 'random'].includes(saved)) {
      console.log('[GalleryOptimization] Loaded layout preference:', saved);
      return saved as GalleryLayoutMode;
    }
  } catch (error) {
    console.warn('[GalleryOptimization] Failed to load layout preference:', error);
  }
  return null;
};

/**
 * Save gallery sort preference to persistent storage
 */
export const saveGallerySortPreference = async (sort: GallerySortMode): Promise<void> => {
  try {
    await AsyncStorage.setItem(GALLERY_SORT_STORAGE_KEY, sort);
    console.log('[GalleryOptimization] Saved sort preference:', sort);
  } catch (error) {
    console.warn('[GalleryOptimization] Failed to save sort preference:', error);
  }
};

/**
 * Load gallery sort preference from storage
 */
export const loadGallerySortPreference = async (): Promise<GallerySortMode | null> => {
  try {
    const saved = await AsyncStorage.getItem(GALLERY_SORT_STORAGE_KEY);
    if (saved && ['new', 'hot', 'personal'].includes(saved)) {
      console.log('[GalleryOptimization] Loaded sort preference:', saved);
      return saved as GallerySortMode;
    }
  } catch (error) {
    console.warn('[GalleryOptimization] Failed to load sort preference:', error);
  }
  return null;
};

// ===== IMAGE CACHING STRATEGIES =====

const PREFETCH_BATCH_SIZE = 3;
const PREFETCH_TIMEOUT_MS = 5000;

/**
 * Preload thumbnails for faster display.
 * Fetches up to 3 at a time, skips videos, silently ignores per-URL errors,
 * and stops after 5 seconds total.
 */
export const prefetchThumbnails = async (imageUrls: (string | null | undefined)[]): Promise<void> => {
  const deadline = Date.now() + PREFETCH_TIMEOUT_MS;

  const validUrls = imageUrls.filter((url): url is string => {
    if (!url) return false;
    const lower = url.toLowerCase();
    return !lower.endsWith('.mov') && !lower.endsWith('.mp4');
  });

  const optimizedUrls = validUrls
    .map((url) => getThumbnailUrl(url))
    .filter((url): url is string => Boolean(url));

  for (let i = 0; i < optimizedUrls.length; i += PREFETCH_BATCH_SIZE) {
    if (Date.now() >= deadline) break;

    const batch = optimizedUrls.slice(i, i + PREFETCH_BATCH_SIZE);
    await Promise.allSettled(
      batch.map((url) => Image.prefetch(url).catch(() => undefined))
    );
  }
};

/**
 * Calculate memory savings from thumbnail optimization
 */
export const calculateMemorySavings = (
  originalCount: number,
  originalSize: number // in MB
): { thumbnailSize: number; savings: number; savingsPercent: number } => {
  // Rough estimate: thumbnails are ~10-15% of original size
  const thumbnailSize = (originalSize * 0.15);
  const savings = originalSize - thumbnailSize;
  const savingsPercent = (savings / originalSize) * 100;

  return {
    thumbnailSize: Math.round(thumbnailSize * 100) / 100,
    savings: Math.round(savings * 100) / 100,
    savingsPercent: Math.round(savingsPercent)
  };
};

// ===== LAYOUT MODE HELPERS =====

/**
 * Get icon for layout mode
 */
export const getLayoutModeIcon = (mode: GalleryLayoutMode): string => {
  switch (mode) {
    case 'default':
      return '📱';
    case 'list':
      return '📋';
    case 'grid':
      return '🔲';
    case 'random':
      return '🎲';
    default:
      return '📱';
  }
};

/**
 * Get label for layout mode
 */
export const getLayoutModeLabel = (mode: GalleryLayoutMode): string => {
  switch (mode) {
    case 'default':
      return 'Default';
    case 'list':
      return 'List';
    case 'grid':
      return 'Grid';
    case 'random':
      return 'Random';
    default:
      return 'Default';
  }
};

/**
 * Get next layout mode in cycle
 */
export const getNextLayoutMode = (current: GalleryLayoutMode): GalleryLayoutMode => {
  const modes: GalleryLayoutMode[] = ['default', 'list', 'grid', 'random'];
  const currentIndex = modes.indexOf(current);
  const nextIndex = (currentIndex + 1) % modes.length;
  return modes[nextIndex];
};

/**
 * Shuffle array for random layout
 */
export const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};
