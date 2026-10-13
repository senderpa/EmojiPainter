/**
 * Gallery Video Cache Manager
 *
 * Handles caching of gallery videos on device to reduce bandwidth and improve
 * offline performance. Supports connection-aware quality selection and progressive loading.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { NetInfo } from '@react-native-firebase/app';
import * as Network from 'expo-network';

const GALLERY_VIDEO_CACHE_DIR = `${FileSystem.documentDirectory}gallery-cache/`;
const GALLERY_CACHE_METADATA_KEY = '@gallery_video_cache_metadata';
const GALLERY_CACHE_SETTINGS_KEY = '@gallery_video_cache_settings';
const CACHE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

export type ConnectionType = 'wifi' | '4g' | '3g' | 'lte' | 'edge' | 'unknown' | 'offline';
export type VideoQuality = 'high' | 'medium' | 'low' | 'preview';

export interface GalleryVideoCacheEntry {
  videoId: number;
  imageUrl: string;
  cachedPath: string; // Full file path to cached video
  cachedAt: number;
  lastAccessedAt: number;
  quality: VideoQuality;
  fileSize: number;
  duration?: number;
  width?: number;
  height?: number;
}

export interface GalleryCacheSettings {
  maxCacheSizeMB: number;
  maxAge: number; // milliseconds
  enableAutoCleanup: boolean;
  lastCleanupAt: number;
}

export interface ConnectionAwareConfig {
  wifi: VideoQuality;
  '4g': VideoQuality;
  lte: VideoQuality;
  '3g': VideoQuality;
  edge: VideoQuality;
  offline: VideoQuality;
}

// LRU eviction constants
const LRU_EVICTION_TRIGGER_MB = 350; // Start evicting when cache exceeds this
const LRU_EVICTION_TARGET_MB = 300;  // Evict until cache is under this

// Default cache settings
const DEFAULT_SETTINGS: GalleryCacheSettings = {
  maxCacheSizeMB: 400, // 400MB max cache
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days TTL based on lastAccessedAt
  enableAutoCleanup: true,
  lastCleanupAt: 0
};

// Default quality per connection type
const DEFAULT_CONNECTION_CONFIG: ConnectionAwareConfig = {
  wifi: 'high',
  '4g': 'medium',
  lte: 'medium',
  '3g': 'low',
  edge: 'low',
  offline: 'preview'
};

let cacheMetadata: Map<number, GalleryVideoCacheEntry> | null = null;
let cacheSettings: GalleryCacheSettings | null = null;
let lastNetworkType: ConnectionType | null = null;
let connectionConfig: ConnectionAwareConfig = DEFAULT_CONNECTION_CONFIG;

/**
 * Initialize cache directory and load metadata
 */
export async function initializeCacheManager(): Promise<void> {
  try {
    console.log('[GalleryVideoCache] Initializing cache manager...');

    // Create cache directory
    const dirInfo = await FileSystem.getInfoAsync(GALLERY_VIDEO_CACHE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(GALLERY_VIDEO_CACHE_DIR, { intermediates: true });
      console.log('[GalleryVideoCache] Created cache directory');
    }

    // Load settings
    await loadCacheSettings();

    // Load metadata
    await loadCacheMetadata();

    // Run cleanup if needed
    if (DEFAULT_SETTINGS.enableAutoCleanup) {
      const now = Date.now();
      const timeSinceLastCleanup = cacheSettings ? now - cacheSettings.lastCleanupAt : Infinity;
      if (timeSinceLastCleanup > CACHE_CLEANUP_INTERVAL) {
        console.log('[GalleryVideoCache] Running scheduled cleanup...');
        await cleanupCache();
      }
    }

    console.log('[GalleryVideoCache] ✅ Cache manager initialized');
  } catch (error) {
    console.error('[GalleryVideoCache] ❌ Failed to initialize cache manager:', error);
  }
}

/**
 * Load cache settings from AsyncStorage
 */
async function loadCacheSettings(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(GALLERY_CACHE_SETTINGS_KEY);
    cacheSettings = stored ? JSON.parse(stored) : DEFAULT_SETTINGS;
  } catch (error) {
    console.warn('[GalleryVideoCache] Failed to load settings, using defaults:', error);
    cacheSettings = DEFAULT_SETTINGS;
  }
}

/**
 * Save cache settings to AsyncStorage
 */
async function saveCacheSettings(): Promise<void> {
  try {
    if (cacheSettings) {
      await AsyncStorage.setItem(GALLERY_CACHE_SETTINGS_KEY, JSON.stringify(cacheSettings));
    }
  } catch (error) {
    console.warn('[GalleryVideoCache] Failed to save settings:', error);
  }
}

/**
 * Load cache metadata from AsyncStorage
 */
async function loadCacheMetadata(): Promise<void> {
  try {
    cacheMetadata = new Map();
    const stored = await AsyncStorage.getItem(GALLERY_CACHE_METADATA_KEY);
    if (stored) {
      const entries: GalleryVideoCacheEntry[] = JSON.parse(stored);

      // Validate cached files still exist
      for (const entry of entries) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(entry.cachedPath);
          if (fileInfo.exists) {
            cacheMetadata.set(entry.videoId, entry);
          } else {
            console.log('[GalleryVideoCache] Removing stale cache entry:', entry.videoId);
          }
        } catch (error) {
          console.warn('[GalleryVideoCache] Failed to validate cache entry:', entry.videoId);
        }
      }
    }
  } catch (error) {
    console.warn('[GalleryVideoCache] Failed to load metadata:', error);
    cacheMetadata = new Map();
  }
}

/**
 * Save cache metadata to AsyncStorage
 */
async function saveCacheMetadata(): Promise<void> {
  try {
    if (cacheMetadata) {
      const entries = Array.from(cacheMetadata.values());
      await AsyncStorage.setItem(GALLERY_CACHE_METADATA_KEY, JSON.stringify(entries));
    }
  } catch (error) {
    console.warn('[GalleryVideoCache] Failed to save metadata:', error);
  }
}

/**
 * Detect current network connection type
 */
export async function detectConnectionType(): Promise<ConnectionType> {
  try {
    const state = await Network.getNetworkStateAsync();

    if (!state.isConnected) {
      return 'offline';
    }

    // Check for specific connection types
    const connectionType = state.type?.toLowerCase() || 'unknown';

    if (connectionType.includes('wifi')) {
      lastNetworkType = 'wifi';
      return 'wifi';
    }
    if (connectionType.includes('cellular')) {
      // Try to get more specific cellular type
      const cellularGeneration = state.type || 'unknown';
      if (cellularGeneration.includes('4g')) lastNetworkType = '4g';
      else if (cellularGeneration.includes('lte')) lastNetworkType = 'lte';
      else if (cellularGeneration.includes('3g')) lastNetworkType = '3g';
      else if (cellularGeneration.includes('edge')) lastNetworkType = 'edge';
      else lastNetworkType = 'unknown';

      return lastNetworkType;
    }

    lastNetworkType = 'unknown';
    return 'unknown';
  } catch (error) {
    console.warn('[GalleryVideoCache] Failed to detect connection type:', error);
    return lastNetworkType || 'unknown';
  }
}

/**
 * Get recommended quality based on connection type
 */
export async function getRecommendedQuality(): Promise<VideoQuality> {
  const connectionType = await detectConnectionType();
  return connectionConfig[connectionType] || 'medium';
}

/**
 * Generate cache filename for video
 */
function generateCacheFilename(videoId: number, quality: VideoQuality): string {
  return `video_${videoId}_${quality}.mp4`;
}

/**
 * Get cached video path if available
 */
export async function getCachedVideoPath(videoId: number): Promise<string | null> {
  if (!cacheMetadata) {
    await loadCacheMetadata();
  }

  const entry = cacheMetadata?.get(videoId);
  if (!entry) {
    return null;
  }

  // Update last accessed time
  entry.lastAccessedAt = Date.now();
  await saveCacheMetadata();

  return entry.cachedPath;
}

/**
 * Check if video is cached
 */
export async function isVideoCached(videoId: number): Promise<boolean> {
  const cached = await getCachedVideoPath(videoId);
  return cached !== null;
}

/**
 * Add video to cache
 */
export async function cacheVideo(
  videoId: number,
  sourceUrl: string,
  quality: VideoQuality,
  metadata?: { duration?: number; width?: number; height?: number }
): Promise<string | null> {
  try {
    console.log(`[GalleryVideoCache] 📥 Caching video ${videoId} at quality: ${quality}`);

    if (!cacheMetadata) {
      await loadCacheMetadata();
    }

    // Check if already cached
    const existing = cacheMetadata?.get(videoId);
    if (existing) {
      console.log(`[GalleryVideoCache] Video already cached: ${videoId}`);
      existing.lastAccessedAt = Date.now();
      await saveCacheMetadata();
      return existing.cachedPath;
    }

    // Download video
    const cacheFilename = generateCacheFilename(videoId, quality);
    const cachedPath = `${GALLERY_VIDEO_CACHE_DIR}${cacheFilename}`;

    console.log(`[GalleryVideoCache] Downloading from: ${sourceUrl}`);

    try {
      await FileSystem.downloadAsync(sourceUrl, cachedPath);
    } catch (downloadError) {
      console.error('[GalleryVideoCache] Download failed:', downloadError);
      throw new Error('Failed to download video');
    }

    // Verify download
    const fileInfo = await FileSystem.getInfoAsync(cachedPath);
    if (!fileInfo.exists || !('size' in fileInfo)) {
      throw new Error('Download verification failed');
    }

    const fileSize = (fileInfo as any).size || 0;
    console.log(`[GalleryVideoCache] Downloaded ${(fileSize / 1024 / 1024).toFixed(2)}MB`);

    // Create cache entry
    const entry: GalleryVideoCacheEntry = {
      videoId,
      imageUrl: sourceUrl,
      cachedPath,
      cachedAt: Date.now(),
      lastAccessedAt: Date.now(),
      quality,
      fileSize,
      ...metadata
    };

    cacheMetadata?.set(videoId, entry);
    await saveCacheMetadata();

    // Check cache size and cleanup if needed
    await ensureCacheSize();

    console.log(`[GalleryVideoCache] ✅ Cached video ${videoId}`);
    return cachedPath;
  } catch (error) {
    console.error('[GalleryVideoCache] ❌ Failed to cache video:', error);
    return null;
  }
}

/**
 * Ensure cache doesn't exceed LRU eviction threshold.
 * Triggers at 350MB and evicts least-recently-accessed entries until under 300MB.
 */
export async function ensureCacheSize(): Promise<void> {
  try {
    if (!cacheMetadata) {
      return;
    }

    const entries = Array.from(cacheMetadata.values());
    let totalSize = entries.reduce((sum, entry) => sum + entry.fileSize, 0);
    const totalSizeMB = totalSize / 1024 / 1024;

    if (totalSizeMB <= LRU_EVICTION_TRIGGER_MB) {
      return;
    }

    console.log(`[GalleryVideoCache] LRU eviction triggered (${totalSizeMB.toFixed(0)}MB > ${LRU_EVICTION_TRIGGER_MB}MB), evicting to ${LRU_EVICTION_TARGET_MB}MB...`);

    // Sort by lastAccessedAt ascending — least recently accessed first
    const sortedEntries = [...entries].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const targetBytes = LRU_EVICTION_TARGET_MB * 1024 * 1024;

    for (const entry of sortedEntries) {
      if (totalSize <= targetBytes) {
        break;
      }

      try {
        await FileSystem.deleteAsync(entry.cachedPath, { idempotent: true });
        cacheMetadata?.delete(entry.videoId);
        totalSize -= entry.fileSize;
        console.log(`[GalleryVideoCache] LRU evicted: video ${entry.videoId} (last accessed ${Math.round((Date.now() - entry.lastAccessedAt) / 1000 / 60 / 60 / 24)}d ago)`);
      } catch (error) {
        console.warn(`[GalleryVideoCache] Failed to delete cache entry:`, error);
      }
    }

    await saveCacheMetadata();
    console.log(`[GalleryVideoCache] LRU eviction done, cache now ${(totalSize / 1024 / 1024).toFixed(0)}MB`);
  } catch (error) {
    console.error('[GalleryVideoCache] ❌ Failed to ensure cache size:', error);
  }
}

/**
 * Clean up stale cache entries
 */
export async function cleanupCache(): Promise<{ deleted: number; freedMB: number }> {
  try {
    console.log('[GalleryVideoCache] 🧹 Starting cache cleanup...');

    if (!cacheMetadata || !cacheSettings) {
      return { deleted: 0, freedMB: 0 };
    }

    const now = Date.now();
    const maxAge = cacheSettings.maxAge;
    const entries = Array.from(cacheMetadata.values());

    let deletedCount = 0;
    let freedBytes = 0;

    for (const entry of entries) {
      // TTL is based on lastAccessedAt — entries not accessed for 30 days are evicted
      const idleTime = now - entry.lastAccessedAt;

      if (idleTime > maxAge) {
        try {
          await FileSystem.deleteAsync(entry.cachedPath, { idempotent: true });
          cacheMetadata?.delete(entry.videoId);
          deletedCount++;
          freedBytes += entry.fileSize;
          console.log(`[GalleryVideoCache] Removed idle entry: ${entry.videoId} (not accessed for ${Math.round(idleTime / 1000 / 60 / 60 / 24)} days)`);
        } catch (error) {
          console.warn('[GalleryVideoCache] Failed to delete idle entry:', error);
        }
      }
    }

    if (cacheSettings) {
      cacheSettings.lastCleanupAt = now;
      await saveCacheSettings();
    }

    await saveCacheMetadata();

    const freedMB = Math.round(freedBytes / 1024 / 1024 * 100) / 100;
    console.log(`[GalleryVideoCache] ✅ Cleanup complete: ${deletedCount} deleted, ${freedMB}MB freed`);

    return { deleted: deletedCount, freedMB };
  } catch (error) {
    console.error('[GalleryVideoCache] ❌ Failed to cleanup cache:', error);
    return { deleted: 0, freedMB: 0 };
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalVideos: number;
  totalSizeMB: number;
  oldestCacheTime: number;
  newestCacheTime: number;
  maxCacheMB: number;
  utilizationPercent: number;
}> {
  try {
    if (!cacheMetadata || !cacheSettings) {
      return {
        totalVideos: 0,
        totalSizeMB: 0,
        oldestCacheTime: 0,
        newestCacheTime: 0,
        maxCacheMB: cacheSettings?.maxCacheSizeMB || DEFAULT_SETTINGS.maxCacheSizeMB,
        utilizationPercent: 0
      };
    }

    const entries = Array.from(cacheMetadata.values());
    const totalSize = entries.reduce((sum, entry) => sum + entry.fileSize, 0);
    const maxSize = cacheSettings.maxCacheSizeMB * 1024 * 1024;

    return {
      totalVideos: entries.length,
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
      oldestCacheTime: entries.length > 0 ? Math.min(...entries.map(e => e.cachedAt)) : 0,
      newestCacheTime: entries.length > 0 ? Math.max(...entries.map(e => e.cachedAt)) : 0,
      maxCacheMB: cacheSettings.maxCacheSizeMB,
      utilizationPercent: Math.round((totalSize / maxSize) * 100)
    };
  } catch (error) {
    console.error('[GalleryVideoCache] ❌ Failed to get cache stats:', error);
    return {
      totalVideos: 0,
      totalSizeMB: 0,
      oldestCacheTime: 0,
      newestCacheTime: 0,
      maxCacheMB: DEFAULT_SETTINGS.maxCacheSizeMB,
      utilizationPercent: 0
    };
  }
}

/**
 * Clear entire cache
 */
export async function clearCache(): Promise<void> {
  try {
    console.log('[GalleryVideoCache] 🗑️ Clearing entire cache...');

    if (!cacheMetadata) {
      await loadCacheMetadata();
    }

    const entries = Array.from(cacheMetadata?.values() || []);

    for (const entry of entries) {
      try {
        await FileSystem.deleteAsync(entry.cachedPath, { idempotent: true });
      } catch (error) {
        console.warn('[GalleryVideoCache] Failed to delete file:', error);
      }
    }

    cacheMetadata?.clear();
    await saveCacheMetadata();

    console.log('[GalleryVideoCache] ✅ Cache cleared');
  } catch (error) {
    console.error('[GalleryVideoCache] ❌ Failed to clear cache:', error);
  }
}

/**
 * Update connection aware config
 */
export function setConnectionAwareConfig(config: Partial<ConnectionAwareConfig>): void {
  connectionConfig = { ...connectionConfig, ...config };
  console.log('[GalleryVideoCache] Connection config updated:', connectionConfig);
}

/**
 * Update cache settings
 */
export async function updateCacheSettings(settings: Partial<GalleryCacheSettings>): Promise<void> {
  try {
    if (cacheSettings) {
      cacheSettings = { ...cacheSettings, ...settings };
      await saveCacheSettings();
      console.log('[GalleryVideoCache] Settings updated:', cacheSettings);
    }
  } catch (error) {
    console.error('[GalleryVideoCache] Failed to update settings:', error);
  }
}
