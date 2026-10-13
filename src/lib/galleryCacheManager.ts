/**
 * Gallery Cache Manager
 *
 * Centralized management of all gallery caching systems:
 * - Video file caching
 * - Offline gallery metadata caching
 * - Cache statistics and monitoring
 * - Settings configuration
 */

import {
  initializeCacheManager,
  getCacheStats,
  clearCache as clearVideoCache,
  cleanupCache as cleanupVideoCache,
  getRecommendedQuality,
  detectConnectionType,
  setConnectionAwareConfig,
  updateCacheSettings,
  ConnectionType,
  VideoQuality,
  ConnectionAwareConfig,
  GalleryCacheSettings
} from '../video/galleryVideoCache';

import {
  clearOfflineGallery,
  getTotalOfflineEntries,
  cleanupExpiredOfflineEntries,
  getOfflineGalleryMetadata
} from './offlineGallerySupport';

export interface CacheManagerStats {
  videoCacheMB: number;
  videosCached: number;
  offlineEntriesCached: number;
  totalCacheMB: number;
  utilizationPercent: number;
  currentConnection: ConnectionType;
  recommendedQuality: VideoQuality;
  offlineMetadata: {
    lastUpdated: number;
    sorts: string[];
  };
}

/**
 * Initialize cache manager
 */
export async function initGalleryCacheManager(): Promise<void> {
  try {
    console.log('[GalleryCacheManager] Initializing...');
    await initializeCacheManager();
    console.log('[GalleryCacheManager] ✅ Initialized');
  } catch (error) {
    console.error('[GalleryCacheManager] ❌ Failed to initialize:', error);
  }
}

/**
 * Get comprehensive cache statistics
 */
export async function getGalleryCacheStats(): Promise<CacheManagerStats> {
  try {
    const videoStats = await getCacheStats();
    const offlineEntries = await getTotalOfflineEntries();
    const offlineMetadata = await getOfflineGalleryMetadata();
    const connectionType = await detectConnectionType();
    const recommendedQuality = await getRecommendedQuality();

    return {
      videoCacheMB: videoStats.totalSizeMB,
      videosCached: videoStats.totalVideos,
      offlineEntriesCached: offlineEntries,
      totalCacheMB: videoStats.totalSizeMB,
      utilizationPercent: videoStats.utilizationPercent,
      currentConnection: connectionType,
      recommendedQuality,
      offlineMetadata: {
        lastUpdated: offlineMetadata.lastUpdated,
        sorts: offlineMetadata.sortTypes
      }
    };
  } catch (error) {
    console.error('[GalleryCacheManager] Failed to get stats:', error);
    return {
      videoCacheMB: 0,
      videosCached: 0,
      offlineEntriesCached: 0,
      totalCacheMB: 0,
      utilizationPercent: 0,
      currentConnection: 'unknown',
      recommendedQuality: 'medium',
      offlineMetadata: {
        lastUpdated: 0,
        sorts: []
      }
    };
  }
}

/**
 * Perform full cache cleanup
 */
export async function performFullCleanup(): Promise<{
  videosCleaned: number;
  videosMB: number;
  offlineEntriesRemoved: number;
}> {
  try {
    console.log('[GalleryCacheManager] 🧹 Performing full cleanup...');

    const videoCleanup = await cleanupVideoCache();
    const offlineCleanup = await cleanupExpiredOfflineEntries();

    console.log('[GalleryCacheManager] ✅ Cleanup complete');

    return {
      videosCleaned: videoCleanup.deleted,
      videosMB: videoCleanup.freedMB,
      offlineEntriesRemoved: offlineCleanup.removed
    };
  } catch (error) {
    console.error('[GalleryCacheManager] ❌ Cleanup failed:', error);
    return {
      videosCleaned: 0,
      videosMB: 0,
      offlineEntriesRemoved: 0
    };
  }
}

/**
 * Clear all gallery caches
 */
export async function clearAllGalleryCache(): Promise<void> {
  try {
    console.log('[GalleryCacheManager] 🗑️ Clearing all caches...');

    await clearVideoCache();
    await clearOfflineGallery();

    console.log('[GalleryCacheManager] ✅ All caches cleared');
  } catch (error) {
    console.error('[GalleryCacheManager] ❌ Failed to clear caches:', error);
  }
}

/**
 * Configure connection-aware quality settings
 */
export function configureConnectionAwareQuality(config: Partial<ConnectionAwareConfig>): void {
  console.log('[GalleryCacheManager] Updating connection-aware config:', config);
  setConnectionAwareConfig(config);
}

/**
 * Update cache manager settings
 */
export async function updateGalleryCacheSettings(
  settings: Partial<GalleryCacheSettings>
): Promise<void> {
  try {
    console.log('[GalleryCacheManager] Updating settings:', settings);
    await updateCacheSettings(settings);
  } catch (error) {
    console.error('[GalleryCacheManager] Failed to update settings:', error);
  }
}

/**
 * Preload common videos to cache
 */
export async function preloadGalleryVideos(
  videos: Array<{ videoId: number; videoUrl: string }>,
  connectionQuality?: VideoQuality
): Promise<void> {
  try {
    console.log(`[GalleryCacheManager] 📥 Preloading ${videos.length} videos...`);

    // Import here to avoid circular dependency
    const { prefetchVideos } = await import('../video/progressiveVideoLoader');

    const videosWithMetadata = videos.map((v) => ({
      videoId: v.videoId,
      videoUrl: v.videoUrl
    }));

    await prefetchVideos(videosWithMetadata);

    console.log('[GalleryCacheManager] ✅ Preload complete');
  } catch (error) {
    console.error('[GalleryCacheManager] ❌ Preload failed:', error);
  }
}

/**
 * Get formatted cache status for UI
 */
export async function getFormattedCacheStatus(): Promise<string> {
  try {
    const stats = await getGalleryCacheStats();

    const lines = [
      `Videos: ${stats.videosCached} (${stats.videoCacheMB.toFixed(1)}MB / ${stats.utilizationPercent}%)`,
      `Offline posts: ${stats.offlineEntriesCached}`,
      `Connection: ${stats.currentConnection}`,
      `Recommended quality: ${stats.recommendedQuality}`
    ];

    return lines.join('\n');
  } catch (error) {
    console.error('[GalleryCacheManager] Failed to format status:', error);
    return 'Cache status unavailable';
  }
}

/**
 * Export cache debug info
 */
export async function exportCacheDebugInfo(): Promise<string> {
  try {
    const stats = await getGalleryCacheStats();
    const connectionType = await detectConnectionType();

    const debugInfo = {
      timestamp: new Date().toISOString(),
      stats,
      connection: connectionType,
      debug: {
        videoStats: await getCacheStats(),
        offlineMetadata: await getOfflineGalleryMetadata()
      }
    };

    return JSON.stringify(debugInfo, null, 2);
  } catch (error) {
    console.error('[GalleryCacheManager] Failed to export debug info:', error);
    return '{}';
  }
}
