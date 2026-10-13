/**
 * Offline Gallery Support
 *
 * Caches gallery metadata locally so posts can be viewed offline
 * with cached videos. Shows "Last seen X time ago" for offline content.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DailyPaintGalleryEntry, DailyPaintGallerySort } from './dailyPaintGallery';

const OFFLINE_GALLERY_KEY_PREFIX = '@offline_gallery_';
const OFFLINE_METADATA_KEY = '@offline_gallery_metadata';
const MAX_OFFLINE_ENTRIES_PER_SORT = 100;
const MAX_OFFLINE_MYSTERY_ENTRIES = 100;
const OFFLINE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// All supported sorts including mystery
const ALL_SORTS = ['new', 'hot', 'top', 'mystery'] as const;
type AllSort = typeof ALL_SORTS[number];

export interface OfflineGalleryEntry extends DailyPaintGalleryEntry {
  offlineCachedAt: number;
  lastViewedAt?: number;
}

export interface OfflineGalleryMetadata {
  lastUpdated: number;
  sortTypes: DailyPaintGallerySort[];
  entryCounts: Record<DailyPaintGallerySort, number>;
}

/**
 * Cache gallery entries for offline use
 */
export async function cacheGalleryForOffline(
  entries: DailyPaintGalleryEntry[],
  sort: DailyPaintGallerySort | 'mystery'
): Promise<void> {
  try {
    console.log(`[OfflineGallery] Caching ${entries.length} entries for sort="${sort}"`);

    // Add offline metadata
    const offlineEntries: OfflineGalleryEntry[] = entries.map((entry) => ({
      ...entry,
      offlineCachedAt: Date.now()
    }));

    // Limit — mystery gets 100, others 100 too (was 50)
    const limit = sort === 'mystery' ? MAX_OFFLINE_MYSTERY_ENTRIES : MAX_OFFLINE_ENTRIES_PER_SORT;
    const limited = offlineEntries.slice(0, limit);

    // Save to storage
    const key = `${OFFLINE_GALLERY_KEY_PREFIX}${sort}`;
    await AsyncStorage.setItem(key, JSON.stringify(limited));

    // Update metadata
    await updateOfflineMetadata(sort, limited.length);

    console.log(`[OfflineGallery] ✅ Cached ${limited.length} entries for sort="${sort}"`);
  } catch (error) {
    console.error('[OfflineGallery] ❌ Failed to cache gallery:', error);
  }
}

/**
 * Get cached gallery for offline viewing
 */
export async function getCachedGalleryForOffline(
  sort: DailyPaintGallerySort | 'mystery'
): Promise<OfflineGalleryEntry[]> {
  try {
    const key = `${OFFLINE_GALLERY_KEY_PREFIX}${sort}`;
    const stored = await AsyncStorage.getItem(key);

    if (!stored) {
      return [];
    }

    const entries: OfflineGalleryEntry[] = JSON.parse(stored);

    // Filter out expired entries
    const now = Date.now();
    const valid = entries.filter((entry) => now - entry.offlineCachedAt <= OFFLINE_CACHE_MAX_AGE);

    if (valid.length < entries.length) {
      // Update storage with valid entries only
      if (valid.length > 0) {
        await AsyncStorage.setItem(key, JSON.stringify(valid));
      } else {
        await AsyncStorage.removeItem(key);
      }
    }

    return valid;
  } catch (error) {
    console.error('[OfflineGallery] ❌ Failed to get cached gallery:', error);
    return [];
  }
}

/**
 * Check if entries are from offline cache
 */
export function isOfflineEntry(entry: DailyPaintGalleryEntry): boolean {
  return 'offlineCachedAt' in entry;
}

/**
 * Get offline cache age in milliseconds
 */
export function getOfflineCacheAge(entry: OfflineGalleryEntry): number {
  return Date.now() - entry.offlineCachedAt;
}

/**
 * Format offline cache age as human readable string
 */
export function formatOfflineCacheAge(entry: OfflineGalleryEntry): string {
  const age = getOfflineCacheAge(entry);

  if (age < 60 * 1000) {
    return 'Just now';
  }
  if (age < 60 * 60 * 1000) {
    const minutes = Math.floor(age / 60 / 1000);
    return `${minutes}m ago`;
  }
  if (age < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(age / 60 / 60 / 1000);
    return `${hours}h ago`;
  }

  const days = Math.floor(age / 24 / 60 / 60 / 1000);
  return `${days}d ago`;
}

/**
 * Update offline gallery metadata
 */
async function updateOfflineMetadata(sort: string, count: number): Promise<void> {
  try {
    let metadata: any = {
      lastUpdated: Date.now(),
      sortTypes: [],
      entryCounts: { new: 0, hot: 0, top: 0, mystery: 0 }
    };

    const stored = await AsyncStorage.getItem(OFFLINE_METADATA_KEY);
    if (stored) {
      metadata = { ...metadata, ...JSON.parse(stored) };
      metadata.entryCounts = { ...metadata.entryCounts, ...JSON.parse(stored).entryCounts };
    }

    metadata.lastUpdated = Date.now();
    metadata.entryCounts[sort] = count;

    if (!metadata.sortTypes.includes(sort)) {
      metadata.sortTypes.push(sort);
    }

    await AsyncStorage.setItem(OFFLINE_METADATA_KEY, JSON.stringify(metadata));
  } catch (error) {
    console.warn('[OfflineGallery] Failed to update metadata:', error);
  }
}

/**
 * Get offline gallery metadata
 */
export async function getOfflineGalleryMetadata(): Promise<OfflineGalleryMetadata> {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_METADATA_KEY);
    if (!stored) {
      return {
        lastUpdated: 0,
        sortTypes: [],
        entryCounts: {
          new: 0,
          hot: 0,
          top: 0
        }
      };
    }

    return JSON.parse(stored);
  } catch (error) {
    console.warn('[OfflineGallery] Failed to get metadata:', error);
    return {
      lastUpdated: 0,
      sortTypes: [],
      entryCounts: {
        new: 0,
        hot: 0,
        top: 0
      }
    };
  }
}

/**
 * Clear offline gallery cache
 */
export async function clearOfflineGallery(): Promise<void> {
  try {
    console.log('[OfflineGallery] Clearing offline cache...');

    for (const sort of ALL_SORTS) {
      const key = `${OFFLINE_GALLERY_KEY_PREFIX}${sort}`;
      await AsyncStorage.removeItem(key);
    }

    await AsyncStorage.removeItem(OFFLINE_METADATA_KEY);

    console.log('[OfflineGallery] ✅ Offline cache cleared');
  } catch (error) {
    console.error('[OfflineGallery] ❌ Failed to clear offline cache:', error);
  }
}

/**
 * Get total offline entries across all sorts
 */
export async function getTotalOfflineEntries(): Promise<number> {
  try {
    const metadata = await getOfflineGalleryMetadata();
    return ALL_SORTS.reduce((sum, sort) => sum + ((metadata.entryCounts as any)[sort] || 0), 0);
  } catch (error) {
    console.warn('[OfflineGallery] Failed to get total entries:', error);
    return 0;
  }
}

/**
 * Cleanup expired offline entries
 */
export async function cleanupExpiredOfflineEntries(): Promise<{ cleaned: number; removed: number }> {
  try {
    console.log('[OfflineGallery] 🧹 Cleaning up expired entries...');

    let totalCleaned = 0;
    let totalRemoved = 0;

    for (const sort of ALL_SORTS) {
      const entries = await getCachedGalleryForOffline(sort as DailyPaintGallerySort);
      totalCleaned += entries.length;

      const now = Date.now();
      const valid = entries.filter((entry) => now - entry.offlineCachedAt <= OFFLINE_CACHE_MAX_AGE);

      if (valid.length < entries.length) {
        totalRemoved += entries.length - valid.length;

        if (valid.length > 0) {
          const key = `${OFFLINE_GALLERY_KEY_PREFIX}${sort}`;
          await AsyncStorage.setItem(key, JSON.stringify(valid));
        } else {
          const key = `${OFFLINE_GALLERY_KEY_PREFIX}${sort}`;
          await AsyncStorage.removeItem(key);
        }
      }
    }

    console.log(`[OfflineGallery] ✅ Cleanup complete: ${totalCleaned} entries checked, ${totalRemoved} removed`);

    return { cleaned: totalCleaned, removed: totalRemoved };
  } catch (error) {
    console.error('[OfflineGallery] ❌ Cleanup failed:', error);
    return { cleaned: 0, removed: 0 };
  }
}
