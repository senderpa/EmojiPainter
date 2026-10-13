import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { sha256 } from 'js-sha256';

import { DAILY_PAINT_SECRET } from './dailyPaintSecrets';
import {
  initGalleryDatabase,
  getCachedImages,
  cacheImages,
  clearGalleryCache,
  updateSolvedStateInDB,
  type CachedGalleryImage
} from './galleryDatabase';
import {
  cacheGalleryForOffline,
  getCachedGalleryForOffline,
  isOfflineEntry,
  formatOfflineCacheAge
} from './offlineGallerySupport';

const GALLERY_LIST_URL = 'https://emojipainter.com/api/list.php';
const GALLERY_VOTE_URL = 'https://emojipainter.com/api/vote.php';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes instead of 60 seconds

/**
 * What a gallery load should do with its cache.
 *
 * - `fetch` — go to the network and wait for it. Only a forced refresh does
 *   this, and it must ALWAYS do it: after uploading, the caller forces a
 *   refresh precisely because it knows the cache is out of date, no matter how
 *   recently it was filled.
 * - `serve-cache-and-refresh` — instant list now, quietly updated after.
 * - `serve-cache` — fresh enough, no network needed.
 */
export type GalleryCachePlan = 'fetch' | 'serve-cache-and-refresh' | 'serve-cache';

export function galleryCachePlan(force: boolean, isStale: boolean): GalleryCachePlan {
  if (force) return 'fetch';
  return isStale ? 'serve-cache-and-refresh' : 'serve-cache';
}
const DEFAULT_FETCH_LIMIT = 120;
const MAX_CACHE_ENTRIES = 100; // Reduced from 240 to 100 as requested
const GALLERY_VOTE_STORAGE_KEY = 'emojipaint/gallery/votes';

// Initialize database on module load
initGalleryDatabase().catch(err =>
  console.error('[DailyPaintGallery] Failed to init database:', err)
);

export type DailyPaintGallerySort = 'new' | 'hot' | 'top';
export type DailyPaintGalleryVoteDirection = 'up' | 'down';

export interface DailyPaintGalleryEntry {
  id: number;
  imageUrl: string;
  rawUrl: string;
  topic: string;
  createdAt: number;
  challengeAt?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  deviceId?: string | null;
  passportName?: string | null;
  passportPortrait?: string | null;
  frameUrls?: string[] | null; // Array of frame URLs for animation
  frameCount?: number; // Number of frames
  coinCount?: number;
  coins?: number;
  rank?: number;
  uploadedAt?: string | null;
  updatedAt?: string | null;
  upvotes?: number;
  downvotes?: number;
  userVote: DailyPaintGalleryVoteDirection | null;
  // Offline/cache metadata
  isOffline?: boolean;
  offlineCachedAt?: number; // Timestamp when entry was cached offline
  cachedVideoPath?: string; // Local path to cached video if available
  // Gesser mystery paint metadata
  isMysteryPaint?: boolean;
  mysteryPaintingId?: number | null;
  mysteryTopicId?: number; // Masking seed — matches PHP gesser-utils.php mask_topic seed (topic_id, 0 for default pool)
  mysteryTopicText?: string | null; // The actual mystery answer (different from topic which is the daily challenge topic)
  isSolved?: boolean;
  solverName?: string | null;
  solveCount?: number;
  totalAttempts?: number;
  machineId?: string | null; // Machine ID for passport linking
}

interface DailyPaintGalleryEntryBase extends Omit<DailyPaintGalleryEntry, 'userVote'> {}

export interface DailyPaintGalleryFetchOptions {
  topic?: string;
  topicLabel?: string;
  limit?: number;
  sort?: DailyPaintGallerySort;
  deviceId?: string;
  owner?: string;
  force?: boolean;
}

export interface DailyPaintGalleryVotePayload {
  imageId: number;
  direction: DailyPaintGalleryVoteDirection;
  deviceId: string;
}

export interface DailyPaintGalleryVoteResult {
  ok: boolean;
  upvotes?: number;
  downvotes?: number;
  direction?: DailyPaintGalleryVoteDirection | null;
  raw: unknown;
}

interface GalleryApiItem {
  id?: number | string;
  image_url?: string;
  raw_url?: string;
  topic?: string;
  created_at?: number | string;
  challenge_at?: number | string;
  duration_sec?: number | string;
  width?: number | string;
  height?: number | string;
  upvotes?: number | string;
  downvotes?: number | string;
  device_id?: string | null;
  passport_name?: string | null;
  passport_portrait?: string | null;
  frame_urls?: string[] | null;
  frame_count?: number | string;
  coin_count?: number | string;
  coinCount?: number | string;
  coins?: number | string;
  totalCoins?: number | string;
  rank?: number | string;
  uploaded_at?: string;
  updated_at?: string;
  // Gesser mystery paint fields
  is_mystery_paint?: boolean | number | string;
  mystery_painting_id?: number | string | null;
  mystery_topic_id?: number | string | null; // Masking seed from API (gmp.topic_id, 0 for default pool)
  mystery_topic_text?: string | null;
  is_solved?: boolean | number | string;
  solver_name?: string | null;
  solve_count?: number | string;
  total_attempts?: number | string;
}

interface GalleryApiResponse {
  ok?: boolean;
  items?: GalleryApiItem[];
}

type CacheItem = {
  timestamp: number;
  entries: DailyPaintGalleryEntryBase[];
  pending?: Promise<DailyPaintGalleryEntryBase[]>;
};

const cache = new Map<DailyPaintGallerySort, CacheItem>();

type StoredVoteRecord = Record<string, StoredVote>;

interface StoredVote {
  direction: DailyPaintGalleryVoteDirection;
  deviceId: string;
  timestamp: number;
}

let storedVotesCache: StoredVoteRecord | null = null;
let storedVotesLoaded = false;

const normaliseTopic = (topic: string) => topic.trim().toLowerCase();

const parseNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
};

const parseOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeDeviceId = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeDeviceId = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const fetchFromApi = async (sort: DailyPaintGallerySort): Promise<GalleryApiItem[]> => {
  const queryParams = new URLSearchParams({
    sort,
    per_page: String(DEFAULT_FETCH_LIMIT)
  });
  const response = await fetch(`${GALLERY_LIST_URL}?${queryParams.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': Platform.OS === 'ios' ? 'EmojiPaint-iOS' : 'EmojiPaint-Mobile',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    },
    cache: 'no-store' // Prevent fetch API caching - respect backend cache control headers
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gallery request failed (${response.status})`);
  }
  let parsed: GalleryApiResponse = {};
  if (text && text.trim().length > 0) {
    try {
      parsed = JSON.parse(text) as GalleryApiResponse;
    } catch (error) {
      throw new Error('Gallery response malformed');
    }
  }
  if (parsed.ok === false) {
    throw new Error('Gallery request rejected');
  }
  return Array.isArray(parsed.items) ? parsed.items : [];
};

const parseItem = (item: GalleryApiItem): DailyPaintGalleryEntryBase | null => {
  if (typeof item.image_url !== 'string' || item.image_url.length === 0) {
    return null;
  }

  // Filter out broken/deleted images - check for common error patterns
  const imageUrl = item.image_url.toLowerCase();
  const suspiciousPatterns = ['deleted', 'removed', 'error', 'not_found', 'notfound', '404', 'missing', 'placeholder'];
  const hasSuspiciousPattern = suspiciousPatterns.some(pattern => imageUrl.includes(pattern));

  // Also check if URL is suspiciously short (likely broken)
  const isTooShort = item.image_url.length < 20; // Valid URLs should be longer

  // Check if URL has proper extension or is a valid image path
  const hasValidExtension = /\.(jpg|jpeg|png|gif|webp|mp4|mov)(\?|$)/i.test(item.image_url);
  const looksLikeValidPath = item.image_url.includes('/uploads/') || item.image_url.includes('/images/') || item.image_url.includes('.php?');

  if (hasSuspiciousPattern || isTooShort || (!hasValidExtension && !looksLikeValidPath)) {
    console.log('[DailyPaintGallery] Filtering out broken image:', item.image_url);
    return null;
  }

  const idValue = parseNumber(item.id);
  if (idValue == null) {
    return null;
  }
  const rawUrl =
    typeof item.raw_url === 'string' && item.raw_url.length > 0 ? item.raw_url : item.image_url;
  const createdAt = parseNumber(item.created_at) ?? Date.now();
  const coinsRaw = parseNumber((item as any).coin_count ?? (item as any).coinCount ?? (item as any).coins);
  const coinCount = typeof coinsRaw === 'number' ? Math.max(0, Math.floor(coinsRaw)) : undefined;
  const rankRaw = parseNumber((item as any).rank ?? (item as any).position);
  const uploadedAt = parseOptionalString((item as any).uploaded_at ?? (item as any).updated_at ?? null);
  const updatedAt = parseOptionalString((item as any).updated_at ?? null);

  // Parse frame data for animation - filter out broken URLs
  let frameUrls = Array.isArray(item.frame_urls) && item.frame_urls.length > 0 ? item.frame_urls : null;

  // Filter out broken frame URLs
  if (frameUrls) {
    frameUrls = frameUrls.filter(url => {
      if (typeof url !== 'string' || url.length < 20) return false;
      const urlLower = url.toLowerCase();
      const hasBadPattern = suspiciousPatterns.some(pattern => urlLower.includes(pattern));
      return !hasBadPattern;
    });
    // If all frames were filtered out, set to null
    if (frameUrls.length === 0) frameUrls = null;
  }

  const frameCount = parseNumber(item.frame_count) ?? (frameUrls ? frameUrls.length : 0);

  // Parse mystery paint fields
  const isMysteryPaint = item.is_mystery_paint === true || item.is_mystery_paint === 1 || item.is_mystery_paint === '1' || item.is_mystery_paint === 'true' ? true : undefined;
  const mysteryPaintingIdRaw = parseNumber(item.mystery_painting_id ?? undefined);
  const mysteryPaintingId = typeof mysteryPaintingIdRaw === 'number' && Number.isFinite(mysteryPaintingIdRaw) ? mysteryPaintingIdRaw : null;
  const mysteryTopicIdRaw = parseNumber(item.mystery_topic_id ?? undefined);
  const mysteryTopicId = typeof mysteryTopicIdRaw === 'number' && Number.isFinite(mysteryTopicIdRaw) ? Math.max(0, mysteryTopicIdRaw) : 0;
  // mystery_topic_text is the actual answer to guess (different from topic = daily challenge topic)
  const mysteryTopicText = typeof item.mystery_topic_text === 'string' && item.mystery_topic_text.trim().length > 0
    ? item.mystery_topic_text.trim()
    : null;
  const isSolved = item.is_solved === true || item.is_solved === 1 || item.is_solved === '1' || item.is_solved === 'true' ? true : undefined;
  const solverName = typeof item.solver_name === 'string' && item.solver_name.trim().length > 0 ? item.solver_name.trim() : null;
  const solveCount = parseNumber(item.solve_count);
  const totalAttempts = parseNumber(item.total_attempts);

  return {
    id: Math.floor(idValue),
    imageUrl: item.image_url,
    rawUrl,
    topic: typeof item.topic === 'string' ? item.topic : '',
    createdAt: Math.floor(createdAt),
    challengeAt: parseNumber(item.challenge_at),
    durationSec: parseNumber(item.duration_sec),
    width: parseNumber(item.width),
    height: parseNumber(item.height),
    upvotes: parseNumber(item.upvotes),
    downvotes: parseNumber(item.downvotes),
    deviceId: parseOptionalString(item.device_id),
    passportName: parseOptionalString(item.passport_name),
    passportPortrait: parseOptionalString(item.passport_portrait),
    frameUrls,
    frameCount,
    coinCount,
    coins: coinCount,
    rank: typeof rankRaw === 'number' ? Math.max(1, Math.floor(rankRaw)) : undefined,
    uploadedAt: uploadedAt ?? null,
    updatedAt: updatedAt ?? uploadedAt ?? null,
    isMysteryPaint,
    mysteryPaintingId,
    mysteryTopicId,
    mysteryTopicText,
    isSolved,
    solverName,
    solveCount,
    totalAttempts
  };
};

const ensureStoredVotes = async (): Promise<StoredVoteRecord> => {
  if (storedVotesLoaded && storedVotesCache) {
    return storedVotesCache;
  }
  try {
    const raw = await AsyncStorage.getItem(GALLERY_VOTE_STORAGE_KEY);
    if (raw && raw.trim().length > 0) {
      const parsed = JSON.parse(raw) as StoredVoteRecord;
      storedVotesCache = parsed && typeof parsed === 'object' ? parsed : {};
    } else {
      storedVotesCache = {};
    }
  } catch (error) {
    console.warn('Failed to load gallery votes cache', error);
    storedVotesCache = {};
  }
  storedVotesLoaded = true;
  return storedVotesCache;
};

const persistStoredVotes = async (): Promise<void> => {
  if (!storedVotesCache) {
    return;
  }
  try {
    await AsyncStorage.setItem(GALLERY_VOTE_STORAGE_KEY, JSON.stringify(storedVotesCache));
  } catch (error) {
    console.warn('Failed to persist gallery votes cache', error);
  }
};

const getStoredVoteSync = (imageId: number, deviceId?: string): DailyPaintGalleryVoteDirection | null => {
  if (!storedVotesLoaded || !storedVotesCache) {
    return null;
  }
  const entry = storedVotesCache[String(imageId)];
  if (!entry) {
    return null;
  }
  const normalizedInput = normalizeDeviceId(deviceId);
  if (normalizedInput) {
    const normalizedStored = normalizeDeviceId(entry.deviceId);
    if (normalizedStored && normalizedStored !== normalizedInput) {
      return null;
    }
    if (normalizedStored && normalizedStored !== entry.deviceId) {
      entry.deviceId = normalizedStored;
      void persistStoredVotes();
    }
  }
  return entry.direction;
};

const loadEntries = async (
  sort: DailyPaintGallerySort,
  force: boolean
): Promise<DailyPaintGalleryEntryBase[]> => {
  const now = Date.now();
  let cacheItem = cache.get(sort);
  if (!cacheItem) {
    cacheItem = { timestamp: 0, entries: [] };
    cache.set(sort, cacheItem);
  }

  // Check memory cache first (fastest)
  if (!force && cacheItem.entries.length > 0 && now - cacheItem.timestamp <= CACHE_TTL_MS && !cacheItem.pending) {
    console.log(`[DailyPaintGallery] ✓ Using memory cache for sort="${sort}"`);
    return cacheItem.entries;
  }

  if (!force && cacheItem.pending) {
    return cacheItem.pending;
  }

  const pendingPromise = (async () => {
    try {
      // Assume online - cache will handle offline scenario
      const isOnline = true;

      // Try SQL cache first (fast, persistent)
      const sqlCached = await getCachedImages(sort, MAX_CACHE_ENTRIES);
      if (sqlCached.length > 0) {
        // Convert SQL cache to gallery entries
        const sqlEntries: DailyPaintGalleryEntryBase[] = sqlCached.map(cached => ({
          id: cached.id,
          imageUrl: cached.imageUrl,
          rawUrl: cached.rawUrl,
          topic: cached.topic,
          createdAt: cached.createdAt,
          challengeAt: cached.challengeAt,
          durationSec: cached.durationSec,
          width: cached.width,
          height: cached.height,
          deviceId: cached.deviceId ?? null,
          passportName: cached.passportName ?? null,
          passportPortrait: cached.passportPortrait ?? null,
          frameUrls: cached.frameUrls ? JSON.parse(cached.frameUrls) : null,
          frameCount: cached.frameCount,
          coinCount: cached.coinCount,
          coins: cached.coins,
          rank: cached.rank,
          uploadedAt: cached.uploadedAt ?? null,
          updatedAt: cached.updatedAt ?? null,
          upvotes: cached.upvotes,
          downvotes: cached.downvotes,
          isMysteryPaint: cached.isMysteryPaint === 1 ? true : undefined,
          mysteryPaintingId: cached.mysteryPaintingId ?? null,
          mysteryTopicId: cached.mysteryTopicId ?? 0,
          mysteryTopicText: cached.mysteryTopicText ?? null,
          isSolved: cached.isSolved === 1 ? true : undefined,
          solverName: cached.solverName ?? null,
          solveCount: cached.solveCount ?? undefined,
          totalAttempts: cached.totalAttempts ?? undefined,
        }));

        // Update memory cache
        cacheItem.entries = sqlEntries;
        cacheItem.timestamp = sqlCached[0]?.cachedAt ?? now;

        // Check if SQL cache is stale
        const cacheAge = now - (sqlCached[0]?.cachedAt ?? 0);
        const isStale = cacheAge > CACHE_TTL_MS;

        console.log(`[DailyPaintGallery] ✓ Loaded ${sqlEntries.length} images from SQL cache (age: ${Math.round(cacheAge / 1000)}s, stale: ${isStale})`);

        // A forced refresh MUST hit the network. This used to read
        // `!isStale || !force`, which returned the cached list whenever it was
        // fresh — even when the caller explicitly forced a refresh. Since the
        // cache is fresh for 5 minutes, a gallery upload was invisible for up
        // to 5 minutes afterwards: the post was on the server, but the app kept
        // serving the list it had captured before the upload.
        if (galleryCachePlan(force, isStale) !== 'fetch') {
          // Cache for offline use
          const baseEntries: DailyPaintGalleryEntryBase[] = sqlEntries.map(e => ({
            ...e,
            isOffline: false
          }));
          await cacheGalleryForOffline(baseEntries as any, sort).catch(e => {
            console.warn('[DailyPaintGallery] Failed to cache for offline:', e);
          });

          // Fetch updates in background if stale but still usable
          if (isStale && isOnline) {
            console.log(`[DailyPaintGallery] 🔄 Fetching fresh data in background...`);
            fetchFromApi(sort).then(async items => {
              const nextEntries: DailyPaintGalleryEntryBase[] = [];
              for (const item of items) {
                const parsed = parseItem(item);
                if (parsed) {
                  nextEntries.push(parsed);
                }
              }
              const limited = nextEntries.slice(0, MAX_CACHE_ENTRIES);

              // Update both caches
              cacheItem.entries = limited;
              cacheItem.timestamp = Date.now();

              // Save to SQL with frameUrls as JSON string
              const sqlData = limited.map(entry => ({
                ...entry,
                frameUrls: entry.frameUrls ? JSON.stringify(entry.frameUrls) : null,
                isMysteryPaint: entry.isMysteryPaint ? 1 : null,
                isSolved: entry.isSolved ? 1 : null,
                solveCount: entry.solveCount ?? null,
              }));
              await cacheImages(sqlData as any, sort);

              // Cache for offline
              const baseData = limited.map(e => ({ ...e, isOffline: false }));
              await cacheGalleryForOffline(baseData as any, sort).catch(e => {
                console.warn('[DailyPaintGallery] Failed to cache for offline:', e);
              });

              console.log(`[DailyPaintGallery] ✓ Background update complete: ${limited.length} images`);
            }).catch(err => {
              console.error(`[DailyPaintGallery] ✗ Background update failed:`, err);
            });
          }

          return sqlEntries;
        }
      }

      // No cache or force refresh
      if (isOnline) {
        // Fetch from API
        console.log(`[DailyPaintGallery] 🌐 Fetching from API for sort="${sort}"...`);
        const items = await fetchFromApi(sort);
        const nextEntries: DailyPaintGalleryEntryBase[] = [];
        for (const item of items) {
          const parsed = parseItem(item);
          if (parsed) {
            nextEntries.push(parsed);
          }
        }
        const limited = nextEntries.slice(0, MAX_CACHE_ENTRIES);

        // Update memory cache
        cacheItem.entries = limited;
        cacheItem.timestamp = Date.now();

        // Update SQL cache with frameUrls as JSON string
        const sqlData = limited.map(entry => ({
          ...entry,
          frameUrls: entry.frameUrls ? JSON.stringify(entry.frameUrls) : null
        }));
        await cacheImages(sqlData as any, sort);

        // Cache for offline
        const baseData = limited.map(e => ({ ...e, isOffline: false }));
        await cacheGalleryForOffline(baseData as any, sort).catch(e => {
          console.warn('[DailyPaintGallery] Failed to cache for offline:', e);
        });

        console.log(`[DailyPaintGallery] ✓ Fetched and cached ${limited.length} images`);
        return cacheItem.entries;
      } else {
        // Offline - try to load from offline cache
        console.log(`[DailyPaintGallery] 📡 Offline mode, loading from offline cache for sort="${sort}"...`);
        const offlineEntries = await getCachedGalleryForOffline(sort);

        if (offlineEntries.length > 0) {
          // Convert to base entries
          const baseEntries: DailyPaintGalleryEntryBase[] = offlineEntries.map(e => ({
            ...e,
            isOffline: true
          }));

          cacheItem.entries = baseEntries;
          cacheItem.timestamp = Date.now();

          console.log(`[DailyPaintGallery] ✓ Loaded ${baseEntries.length} offline entries for sort="${sort}"`);
          return baseEntries;
        }

        console.log(`[DailyPaintGallery] ✗ No offline cache available and no internet connection`);
        return [];
      }
    } finally {
      cacheItem.pending = undefined;
    }
  })();
  cacheItem.pending = pendingPromise;
  return pendingPromise;
};

export async function fetchDailyPaintGallery(
  topicOrOptions?: string | DailyPaintGalleryFetchOptions,
  limitArg?: number
): Promise<DailyPaintGalleryEntry[]> {
  let options: DailyPaintGalleryFetchOptions;
  if (typeof topicOrOptions === 'string') {
    options = { topic: topicOrOptions, limit: limitArg };
  } else {
    options = topicOrOptions ?? {};
  }
  const {
    topic,
    topicLabel,
    limit,
    sort = 'new',
    deviceId,
    owner,
    force = false
  } = options;
  const entries = await loadEntries(sort, force);
  await ensureStoredVotes();
  const normalizedTopic =
    typeof topic === 'string' && topic.trim().length > 0 ? normaliseTopic(topic) : null;
  const normalizedTopicLabel =
    typeof topicLabel === 'string' && topicLabel.trim().length > 0 ? normaliseTopic(topicLabel) : null;
  const normalizedOwner = normalizeDeviceId(owner);
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const sanitizedDeviceId = sanitizeDeviceId(deviceId);
  const result: DailyPaintGalleryEntry[] = [];
  for (const entry of entries) {
    if (normalizedTopic || normalizedTopicLabel) {
      const entryTopicNormalized = normaliseTopic(entry.topic);
      const matchesCanonical = normalizedTopic && entryTopicNormalized === normalizedTopic;
      const matchesLabel = normalizedTopicLabel && entryTopicNormalized === normalizedTopicLabel;
      if (!matchesCanonical && !matchesLabel) {
        continue;
      }
    }
    if (normalizedOwner) {
      const entryOwner = normalizeDeviceId(entry.deviceId);
      if (entryOwner !== normalizedOwner) {
        continue;
      }
    }
    const userVote = getStoredVoteSync(entry.id, normalizedDeviceId ?? deviceId);
    const sanitizedEntryDeviceId = sanitizeDeviceId(entry.deviceId);
    result.push({
      ...entry,
      deviceId: sanitizedEntryDeviceId ?? entry.deviceId ?? null,
      userVote
    });
    if (typeof limit === 'number' && result.length >= limit) {
      break;
    }
  }
  if (typeof limit === 'number') {
    return result.slice(0, limit);
  }
  return result;
}

export async function resetDailyPaintGalleryCache(): Promise<void> {
  // Clear memory cache
  cache.clear();
  // Clear SQL database cache to ensure deleted posts don't persist
  await clearGalleryCache();
  console.log('[DailyPaintGallery] Cache cleared (memory + SQL database)');
}

export async function getStoredGalleryVote(
  imageId: number,
  deviceId?: string
): Promise<DailyPaintGalleryVoteDirection | null> {
  const votes = await ensureStoredVotes();
  const entry = votes[String(imageId)];
  if (!entry) {
    return null;
  }
  const normalizedInput = normalizeDeviceId(deviceId);
  if (normalizedInput) {
    const normalizedStored = normalizeDeviceId(entry.deviceId);
    if (normalizedStored && normalizedStored !== normalizedInput) {
      return null;
    }
    if (normalizedStored && normalizedStored !== entry.deviceId) {
      entry.deviceId = normalizedStored;
      void persistStoredVotes();
    }
  }
  return entry.direction;
}

export async function setStoredGalleryVote(
  imageId: number,
  deviceId: string,
  direction: DailyPaintGalleryVoteDirection
): Promise<void> {
  const votes = await ensureStoredVotes();
  votes[String(imageId)] = {
    direction,
    deviceId: normalizeDeviceId(deviceId) ?? deviceId,
    timestamp: Date.now()
  };
  await persistStoredVotes();
}

export async function clearStoredGalleryVote(imageId: number): Promise<void> {
  const votes = await ensureStoredVotes();
  if (votes[String(imageId)]) {
    delete votes[String(imageId)];
    await persistStoredVotes();
  }
}

const createVoteToken = (
  deviceId: string,
  imageId: number,
  direction: DailyPaintGalleryVoteDirection
): string => {
  const sanitized = sanitizeDeviceId(deviceId) ?? deviceId;
  return sha256.hmac(DAILY_PAINT_SECRET, `${sanitized}|${imageId}|${direction}`);
};

export async function submitDailyPaintGalleryVote(
  payload: DailyPaintGalleryVotePayload
): Promise<DailyPaintGalleryVoteResult> {
  const sanitizedDeviceId = sanitizeDeviceId(payload.deviceId) ?? payload.deviceId;
  const form = new URLSearchParams({
    image_id: String(payload.imageId),
    device_id: sanitizedDeviceId,
    direction: payload.direction,
    token: createVoteToken(sanitizedDeviceId, payload.imageId, payload.direction)
  });
  const response = await fetch(GALLERY_VOTE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': Platform.OS === 'ios' ? 'EmojiPaint-iOS' : 'EmojiPaint-Mobile'
    },
    body: form.toString()
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  if (text && text.trim().length > 0) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch (error) {
      parsed = { ok: response.ok, raw: text };
    }
  }
  const ok = (parsed.ok ?? response.ok) === true;
  if (!ok) {
    const message =
      typeof parsed.error === 'string' && parsed.error.length > 0
        ? parsed.error
        : `Vote failed (${response.status})`;
    throw new Error(message);
  }
  const upvotes = parseNumber(parsed.upvotes);
  const downvotes = parseNumber(parsed.downvotes);
  const directionValue = typeof parsed.direction === 'string' ? parsed.direction.trim().toLowerCase() : null;
  const appliedDirection =
    directionValue === 'up' || directionValue === 'down'
      ? (directionValue as DailyPaintGalleryVoteDirection)
      : null;
  return {
    ok: true,
    upvotes: typeof upvotes === 'number' && Number.isFinite(upvotes) ? upvotes : undefined,
    downvotes: typeof downvotes === 'number' && Number.isFinite(downvotes) ? downvotes : undefined,
    direction: appliedDirection,
    raw: parsed
  };
}

const toBaseEntry = (
  entry: DailyPaintGalleryEntry | DailyPaintGalleryEntryBase
): DailyPaintGalleryEntryBase => ({
  id: entry.id,
  imageUrl: entry.imageUrl,
  rawUrl: entry.rawUrl,
  topic: entry.topic,
  createdAt: entry.createdAt,
  challengeAt: entry.challengeAt,
  durationSec: entry.durationSec,
  width: entry.width,
  height: entry.height,
  deviceId: entry.deviceId ?? null,
  passportName: entry.passportName ?? null,
  passportPortrait: entry.passportPortrait ?? null,
  upvotes: entry.upvotes,
  downvotes: entry.downvotes,
  isMysteryPaint: entry.isMysteryPaint,
  mysteryPaintingId: entry.mysteryPaintingId ?? null,
  mysteryTopicId: entry.mysteryTopicId ?? 0,
  mysteryTopicText: entry.mysteryTopicText ?? null,
  isSolved: entry.isSolved,
  solverName: entry.solverName ?? null,
  totalAttempts: entry.totalAttempts,
});

export function primeDailyPaintGalleryCache(
  entry: DailyPaintGalleryEntry | DailyPaintGalleryEntryBase,
  sort: DailyPaintGallerySort = 'new'
): void {
  let cacheItem = cache.get(sort);
  if (!cacheItem) {
    cacheItem = { timestamp: Date.now(), entries: [] };
    cache.set(sort, cacheItem);
  }
  const baseEntry = toBaseEntry(entry);
  const existingIndex = cacheItem.entries.findIndex((candidate) => candidate.id === baseEntry.id);
  if (existingIndex >= 0) {
    cacheItem.entries.splice(existingIndex, 1);
  }
  cacheItem.entries.unshift(baseEntry);
  if (cacheItem.entries.length > MAX_CACHE_ENTRIES) {
    cacheItem.entries.length = MAX_CACHE_ENTRIES;
  }
  cacheItem.timestamp = Date.now();
}

export function mutateCachedGalleryEntry(
  imageId: number,
  updater: (entry: DailyPaintGalleryEntryBase) => void
): void {
  for (const cacheItem of cache.values()) {
    const target = cacheItem.entries.find((entry) => entry.id === imageId);
    if (target) {
      updater(target);
    }
  }
}

/**
 * Mark a mystery post as solved — updates memory cache + SQLite so
 * solve counts survive navigation and app restarts.
 */
export async function persistSolvedState(
  imageId: number,
  solveCount: number,
  totalAttempts: number
): Promise<void> {
  // Update in-memory cache for every sort bucket
  mutateCachedGalleryEntry(imageId, (entry) => {
    entry.isSolved = true;
    entry.solveCount = solveCount;
    entry.totalAttempts = totalAttempts;
  });
  // Persist to SQLite so it survives navigation
  await updateSolvedStateInDB(imageId, true, solveCount, totalAttempts).catch(() => {});
}

/**
 * Invalidate the in-memory TTL for all sort buckets so the next
 * fetchDailyPaintGallery call hits the network (gets fresh solve counts).
 */
export function invalidateGalleryCache(): void {
  for (const cacheItem of cache.values()) {
    cacheItem.timestamp = 0;
  }
}
