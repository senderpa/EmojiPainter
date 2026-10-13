/**
 * Storage Cleanup Utility
 *
 * Removes stale AsyncStorage keys that accumulate over time:
 * - Framer workspace session data older than 7 days
 * - Completed-topics entries from previous days (only useful same-day)
 * - Gallery cache entries older than 3 days
 *
 * Designed to run at app startup — fire-and-forget, never throws.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// Key prefixes / exact keys to consider for each cleanup category
const FRAMER_SESSION_PREFIXES = [
  '@framer/session_',
  '@emojipaint/framer_',
  'emojipaint/project/',
  'emojipaint/animation/',
];

const GALLERY_CACHE_PREFIXES = [
  '@gallery_video_cache',
  '@offline_gallery_',
  '@emojipaint/gallery_cache',
  '@emojipaint_gallery_cache',
];

const COMPLETED_TOPICS_KEY = '@emojipaint/completed_topics';

/**
 * Returns true when a key string starts with any of the given prefixes.
 */
function matchesAnyPrefix(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => key.startsWith(prefix));
}

/**
 * Attempts to parse the stored value as JSON and return a numeric timestamp.
 * Checks common field names: `updatedAt`, `createdAt`, `savedAt`, `timestamp`,
 * `cachedAt`, `offlineCachedAt`, `lastUpdated`.
 * Returns null when the value cannot be parsed or no timestamp field is found.
 */
function extractTimestamp(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidates = [
      parsed.updatedAt,
      parsed.createdAt,
      parsed.savedAt,
      parsed.timestamp,
      parsed.cachedAt,
      parsed.offlineCachedAt,
      parsed.lastUpdated,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'number' && candidate > 0) {
        return candidate;
      }
      if (typeof candidate === 'string' && candidate.length > 0) {
        const ms = Date.parse(candidate);
        if (!isNaN(ms)) return ms;
      }
    }
  } catch {
    // Unparseable — skip
  }
  return null;
}

/**
 * Cleans stale AsyncStorage entries accumulated over time.
 *
 * Removes:
 * 1. Framer / project session keys older than 7 days
 * 2. @emojipaint/completed_topics if stored date is not today
 * 3. Gallery cache keys older than 3 days
 *
 * Always resolves — never throws.
 */
export async function cleanStaleStorage(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const now = Date.now();
    const keysToRemove: string[] = [];

    // --- 1. Framer workspace / project session keys (7-day TTL) ---
    const framerKeys = allKeys.filter((k) => matchesAnyPrefix(k, FRAMER_SESSION_PREFIXES));
    for (const key of framerKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw === null) continue;

        const ts = extractTimestamp(raw);
        if (ts !== null && now - ts > SEVEN_DAYS_MS) {
          keysToRemove.push(key);
        }
        // If no timestamp found, leave the key alone — don't delete blindly
      } catch {
        // Skip this key on any read error
      }
    }

    // --- 2. Completed-topics (date-scoped, delete if not today) ---
    try {
      const raw = await AsyncStorage.getItem(COMPLETED_TOPICS_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as { date?: string; topics?: string[] };
        const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
        if (parsed.date && parsed.date !== today) {
          keysToRemove.push(COMPLETED_TOPICS_KEY);
        }
      }
    } catch {
      // Skip on parse error
    }

    // --- 3. Gallery cache keys (3-day TTL) ---
    const galleryCacheKeys = allKeys.filter((k) => matchesAnyPrefix(k, GALLERY_CACHE_PREFIXES));
    for (const key of galleryCacheKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw === null) continue;

        const ts = extractTimestamp(raw);
        if (ts !== null && now - ts > THREE_DAYS_MS) {
          keysToRemove.push(key);
        }
      } catch {
        // Skip this key on any read error
      }
    }

    // Deduplicate (completed_topics could theoretically appear twice)
    const unique = Array.from(new Set(keysToRemove));

    if (unique.length > 0) {
      await AsyncStorage.multiRemove(unique);
    }

    console.log(`[StorageCleanup] Removed ${unique.length} stale keys`);
  } catch {
    // Top-level safety net — never crash the app
  }
}
