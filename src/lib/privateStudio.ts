import AsyncStorage from '@react-native-async-storage/async-storage';

import { ensureDeviceId } from './dailyPaintUpload';
import { appendPassportSnapshot, type PassportSnapshot } from './privateStudioSnapshots';
import { hasAcceptedProfileTerms } from './profileTermsConsent';

export { appendPassportSnapshot } from './privateStudioSnapshots';
export type { PassportSnapshot } from './privateStudioSnapshots';

const PRIVATE_STUDIO_UPLOAD_URLS = [
  'https://emojipainter.com/leaderboard/passport_upload.php',
  'https://emojipaint.com/leaderboard/passport_upload.php'
];
const PRIVATE_STUDIO_LEADERBOARD_URLS = [
  'https://emojipainter.com/leaderboard/leaderboard_feed.php',
  'https://emojipaint.com/leaderboard_feed.php'
];
const REQUEST_TIMEOUT_MS = 15000;

// Passport snapshot storage constants
const PASSPORT_SNAPSHOTS_STORAGE_KEY = 'emojipaint:passport-snapshots';
const PASSPORT_UPLOAD_COUNT_STORAGE_KEY = 'emojipaint:passport-upload-count';
const MAX_DAILY_UPLOADS = 10;

interface UploadResponse {
  ok?: boolean;
  success?: boolean;
  image_url?: string;
  imageUrl?: string;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export interface PrivateStudioUploadParams {
  name: string;
  totalSeconds: number;
  totalStrokes: number;
  portraitDataUrl: string;
  appVersion?: string;
  coinCount?: number;
}

export interface PrivateStudioUploadResult {
  ok: boolean;
  imageUrl?: string;
  message?: string;
  machineId: string;
  raw: UploadResponse;
}

export interface PrivateStudioLeaderboardEntry {
  id: string;
  name: string;
  strokeCount: number;
  elapsedMs: number;
  imageUrl: string | null;
  coinCount?: number;
  uploadedAt?: string;
  rank?: number;
  extra?: Record<string, unknown>;
}

const parseElapsedMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.floor(numeric));
    }
  }
  return 0;
};

const parseStrokeCount = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.floor(numeric));
    }
  }
  return 0;
};

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

const normalizeLeaderboardEntry = (entry: Record<string, unknown>, index: number): PrivateStudioLeaderboardEntry => {
  const idValue = entry.id ?? entry.entry_id ?? entry.machineId ?? entry.image_url ?? entry.name ?? `row-${index}`;
  const nameValue = typeof entry.name === 'string' && entry.name.trim().length > 0
    ? entry.name.trim()
    : 'Unnamed Passport';
  const elapsedMsCandidates = [
    entry.elapsed_ms,
    entry.elapsedMs,
    typeof entry.totalSeconds === 'number' ? entry.totalSeconds * 1000 : undefined,
    typeof entry.total_seconds === 'number' ? entry.total_seconds * 1000 : undefined,
    typeof entry.duration_ms === 'number' ? entry.duration_ms : undefined,
    typeof entry.duration_sec === 'number' ? entry.duration_sec * 1000 : undefined,
    typeof entry.duration === 'number' ? entry.duration : undefined,
    typeof entry.time_sec === 'number' ? entry.time_sec * 1000 : undefined,
    typeof entry.time_seconds === 'number' ? entry.time_seconds * 1000 : undefined,
    typeof entry.time_ms === 'number' ? entry.time_ms : undefined,
    typeof entry.time === 'number' ? entry.time : undefined,
    typeof entry.elapsed === 'number' ? entry.elapsed : undefined
  ];
  const elapsedMs = parseElapsedMs(elapsedMsCandidates.find((value) => value !== undefined));

  const strokeCountCandidates = [
    entry.stroke_count,
    entry.strokes,
    entry.strokeCount,
    entry.totalStrokes,
    entry.total_strokes,
    entry.stamp_count,
    entry.count
  ];
  const strokeCount = parseStrokeCount(strokeCountCandidates.find((value) => value !== undefined));

  const extra = typeof entry.extra === 'object' && entry.extra !== null ? (entry.extra as Record<string, unknown>) : {};
  const coinCandidates: unknown[] = [
    entry.coinCount ?? null,
    entry.coins ?? null,
    entry.totalCoins ?? null,
    entry.coin_count ?? null,
    extra['coinCount'] ?? null,
    extra['coins'] ?? null,
    extra['totalCoins'] ?? null,
  ];
  const coinValue = coinCandidates.find((value) => typeof value === 'number' || (typeof value === 'string' && value.trim().length > 0));
  const coinCount = parseStrokeCount(coinValue);

  const imageUrl = typeof entry.image_url === 'string' && entry.image_url.length > 0
    ? entry.image_url
    : typeof entry.imageUrl === 'string' && entry.imageUrl.length > 0
      ? entry.imageUrl
      : typeof entry.portrait === 'string' && entry.portrait.length > 0
        ? entry.portrait
      : null;

  const uploadedAt = typeof entry.created_at === 'string'
    ? entry.created_at
    : typeof entry.uploaded_at === 'string'
      ? entry.uploaded_at
      : typeof entry.timestamp === 'string'
        ? entry.timestamp
        : undefined;

  const rank = typeof entry.rank === 'number' && Number.isFinite(entry.rank)
    ? Math.max(1, Math.floor(entry.rank))
    : typeof entry.position === 'number' && Number.isFinite(entry.position)
      ? Math.max(1, Math.floor(entry.position))
      : undefined;

  return {
    id: String(idValue ?? `row-${index}`),
    name: nameValue,
    strokeCount,
    elapsedMs,
    imageUrl,
    coinCount: coinCount > 0 ? coinCount : undefined,
    uploadedAt,
    rank,
    extra: entry
  };
};

/**
 * Check if a passport already exists for this device
 * Returns the existing passport data if found, null otherwise
 */
export async function fetchExistingPassport(deviceId: string): Promise<PrivateStudioLeaderboardEntry | null> {
  try {
    const leaderboard = await fetchPrivateStudioLeaderboard();
    // Find entry matching this device ID
    const existing = leaderboard.find(entry => entry.id === deviceId);
    if (existing) {
      console.log('[PrivateStudio] Found existing passport:', existing.name);
      return existing;
    }
    return null;
  } catch (error) {
    console.warn('[PrivateStudio] Failed to check for existing passport:', error);
    return null;
  }
}

export async function uploadPrivateStudioPassport(params: PrivateStudioUploadParams): Promise<PrivateStudioUploadResult> {
  if (!(await hasAcceptedProfileTerms())) {
    throw new Error('Please review and accept the current Profil Studio terms before uploading.');
  }
  const deviceId = await ensureDeviceId();
  console.log('[PrivateStudio] Uploading passport with deviceId:', deviceId);

  // Check upload limit
  const { allowed, remainingUploads } = await canUploadToday();
  if (!allowed) {
    throw new Error(`Daily upload limit reached. You can upload ${MAX_DAILY_UPLOADS} times per day. Try again tomorrow.`);
  }
  console.log('[PrivateStudio] Remaining uploads today:', remainingUploads);

  const normalizedCoinCount =
    params.coinCount != null && Number.isFinite(params.coinCount)
      ? Math.max(0, Math.floor(params.coinCount))
      : undefined;

  // Compress portrait if it's too large
  const portraitData = params.portraitDataUrl;
  const portraitSizeKB = Math.round((portraitData.length * 0.75) / 1024); // Approximate size
  console.log('[PrivateStudio] Portrait size:', portraitSizeKB, 'KB');

  if (portraitSizeKB > 500) {
    console.warn('[PrivateStudio] Portrait is very large:', portraitSizeKB, 'KB - this may cause upload issues');
  }

  const payload = {
    machineId: deviceId,
    name: params.name?.trim().length ? params.name.trim() : 'Anonymous Traveler',
    totalStrokes: Math.max(0, Math.floor(params.totalStrokes)),
    totalSeconds: Math.max(0, Math.floor(params.totalSeconds)),
    portrait: portraitData,
    appVersion: params.appVersion ?? undefined,
    coinCount: normalizedCoinCount,
    coins: normalizedCoinCount,
    totalCoins: normalizedCoinCount,
    allowUpdate: true // Tell server we want to update if passport exists
  };
  console.log('[PrivateStudio] Upload payload:', {
    machineId: deviceId,
    name: payload.name,
    totalStrokes: payload.totalStrokes,
    totalSeconds: payload.totalSeconds,
    portraitLength: payload.portrait?.length ?? 0,
    portraitSizeKB,
    coinCount: payload.coinCount,
    allowUpdate: payload.allowUpdate
  });

  const attemptUpload = async (url: string): Promise<PrivateStudioUploadResult> => {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'EmojiPaintMobile/1.0',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });

    const text = await response.text();
    console.log('[PrivateStudio] Upload response:', { status: response.status, text: text.substring(0, 500) });

    let parsed: UploadResponse = {};
    if (text && text.trim().length > 0) {
      try {
        parsed = JSON.parse(text) as UploadResponse;
      } catch {
        parsed = { ok: response.ok, message: text };
      }
    }

    const success = (parsed.ok ?? parsed.success ?? response.ok) === true;
    if (!success) {
      const message = typeof parsed.error === 'string' && parsed.error.length > 0
        ? parsed.error
        : typeof parsed.message === 'string' && parsed.message.length > 0
          ? parsed.message
          : `Upload failed (${response.status})`;
      console.error('[PrivateStudio] Upload failed:', { status: response.status, message, parsed });
      throw new Error(message);
    }

    await savePassportSnapshot(portraitData);
    await incrementUploadCount();
    console.log('[PrivateStudio] Snapshot saved and upload count incremented');
    return {
      ok: true,
      imageUrl: parsed.image_url ?? parsed.imageUrl,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      machineId: deviceId,
      raw: parsed
    };
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  let lastError: Error | null = null;
  for (const url of PRIVATE_STUDIO_UPLOAD_URLS) {
    // Retry up to 3 times on the same URL before moving to fallback
    const maxRetries = url === PRIVATE_STUDIO_UPLOAD_URLS[0] ? 3 : 1;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(1000 * attempt); // 1s, 2s backoff
        }
        return await attemptUpload(url);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Upload failed.');
        console.warn('Private Studio upload failed', { url, attempt }, error);
      }
    }
  }

  throw lastError ?? new Error('Upload failed.');
}

export async function fetchPrivateStudioLeaderboard(): Promise<PrivateStudioLeaderboardEntry[]> {
  let lastError: Error | null = null;
  for (const url of PRIVATE_STUDIO_LEADERBOARD_URLS) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'EmojiPaintMobile/1.0',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache'
        },
        cache: 'no-store'
      });
      const text = await response.text();
      if (!text || text.trim().length === 0) {
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Leaderboard response could not be parsed');
      }

      const extractRows = (payload: unknown): Record<string, unknown>[] => {
        if (Array.isArray(payload)) {
          return payload as Record<string, unknown>[];
        }
        if (payload && typeof payload === 'object') {
          const obj = payload as Record<string, unknown>;
          if (Array.isArray(obj.items)) {
            return obj.items as Record<string, unknown>[];
          }
          if (Array.isArray(obj.entries)) {
            return obj.entries as Record<string, unknown>[];
          }
          return Object.values(obj).filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null);
        }
        return [];
      };

      const rows = extractRows(parsed);
      if (!Array.isArray(rows) || rows.length === 0) {
        return [];
      }

      const normalized = rows
        .map((entry, index) => normalizeLeaderboardEntry(entry, index))
        .filter((entry) => Boolean(entry));

      normalized.sort((a, b) => {
        if (a.rank && b.rank) {
          return a.rank - b.rank;
        }
        const strokeDiff = (b.strokeCount ?? 0) - (a.strokeCount ?? 0);
        if (strokeDiff !== 0) {
          return strokeDiff;
        }
        const timeDiff = (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0);
        if (timeDiff !== 0) {
          return timeDiff;
        }
        return a.name.localeCompare(b.name);
      });

      normalized.forEach((entry, index) => {
        if (!entry.rank) {
          entry.rank = index + 1;
        }
      });

      return normalized;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Leaderboard request failed.');
      console.warn('Private Studio leaderboard fetch failed', { url }, error);
    }
  }

  throw lastError ?? new Error('Leaderboard request failed.');
}
export const PRIVATE_STUDIO_UPLOAD_URL = PRIVATE_STUDIO_UPLOAD_URLS[0];
export const PRIVATE_STUDIO_LEADERBOARD_URL = PRIVATE_STUDIO_LEADERBOARD_URLS[0];

// Passport snapshot storage types
interface UploadCountData {
  date: string; // YYYY-MM-DD format
  count: number;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Check if user can upload today (under 10 uploads limit)
 */
export async function canUploadToday(): Promise<{ allowed: boolean; remainingUploads: number }> {
  try {
    const today = getTodayDateString();
    const stored = await AsyncStorage.getItem(PASSPORT_UPLOAD_COUNT_STORAGE_KEY);

    if (!stored) {
      return { allowed: true, remainingUploads: MAX_DAILY_UPLOADS };
    }

    const data: UploadCountData = JSON.parse(stored);

    // If date is different, reset counter
    if (data.date !== today) {
      return { allowed: true, remainingUploads: MAX_DAILY_UPLOADS };
    }

    const remaining = MAX_DAILY_UPLOADS - data.count;
    return { allowed: data.count < MAX_DAILY_UPLOADS, remainingUploads: Math.max(0, remaining) };
  } catch (error) {
    console.warn('[PassportSnapshots] Failed to check upload count:', error);
    return { allowed: true, remainingUploads: MAX_DAILY_UPLOADS };
  }
}

/**
 * Increment today's upload count
 */
async function incrementUploadCount(): Promise<void> {
  try {
    const today = getTodayDateString();
    const stored = await AsyncStorage.getItem(PASSPORT_UPLOAD_COUNT_STORAGE_KEY);

    let data: UploadCountData;
    if (!stored) {
      data = { date: today, count: 1 };
    } else {
      const existing: UploadCountData = JSON.parse(stored);
      // Reset if date changed
      if (existing.date !== today) {
        data = { date: today, count: 1 };
      } else {
        data = { date: today, count: existing.count + 1 };
      }
    }

    await AsyncStorage.setItem(PASSPORT_UPLOAD_COUNT_STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('[PassportSnapshots] Failed to increment upload count:', error);
  }
}

/**
 * Save a passport snapshot locally after successful upload
 */
export async function savePassportSnapshot(imageDataUrl: string): Promise<void> {
  try {
    const today = getTodayDateString();

    // Load existing snapshots
    const stored = await AsyncStorage.getItem(PASSPORT_SNAPSHOTS_STORAGE_KEY);
    let snapshots: PassportSnapshot[] = [];

    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      snapshots = Array.isArray(parsed) ? parsed as PassportSnapshot[] : [];
    }

    snapshots = appendPassportSnapshot(snapshots, imageDataUrl, Date.now(), today);

    await AsyncStorage.setItem(PASSPORT_SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
    console.log('[PassportSnapshots] Saved snapshot. Total:', snapshots.length);
  } catch (error) {
    console.warn('[PassportSnapshots] Failed to save snapshot:', error);
  }
}

/**
 * Load all passport snapshots
 */
export async function loadPassportSnapshots(): Promise<PassportSnapshot[]> {
  try {
    const stored = await AsyncStorage.getItem(PASSPORT_SNAPSHOTS_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    return JSON.parse(stored);
  } catch (error) {
    console.warn('[PassportSnapshots] Failed to load snapshots:', error);
    return [];
  }
}

/**
 * Replace local passport snapshots with a server-synced history.
 */
export async function replacePassportSnapshots(imageSources: string[]): Promise<PassportSnapshot[]> {
  try {
    const normalized = imageSources
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0);

    const deduped: string[] = [];
    const seen = new Set<string>();
    normalized.forEach((value) => {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      deduped.push(value);
    });

    const baseTimestamp = Date.now() - deduped.length * 1000;
    const snapshots = deduped.map((imageDataUrl, index) => {
      const timestamp = baseTimestamp + index * 1000;
      return {
        imageDataUrl,
        timestamp,
        uploadDate: new Date(timestamp).toISOString().split('T')[0],
      };
    });

    await AsyncStorage.setItem(PASSPORT_SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
    console.log('[PassportSnapshots] Replaced snapshots from sync. Total:', snapshots.length);
    return snapshots;
  } catch (error) {
    console.warn('[PassportSnapshots] Failed to replace snapshots:', error);
    return [];
  }
}

/**
 * Clear all passport snapshots (for testing/debugging)
 */
export async function clearPassportSnapshots(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PASSPORT_SNAPSHOTS_STORAGE_KEY);
    console.log('[PassportSnapshots] Cleared all snapshots');
  } catch (error) {
    console.warn('[PassportSnapshots] Failed to clear snapshots:', error);
  }
}
