import AsyncStorage from '@react-native-async-storage/async-storage';

import { getOrCreateDailyDeviceId, regenerateDeviceId } from './dailyDeviceId';
import { fetchDailyPaintGallery, type DailyPaintGalleryEntry } from './dailyPaintGallery';
import {
  clearPassportSnapshots,
  fetchExistingPassport,
  replacePassportSnapshots,
  type PrivateStudioLeaderboardEntry,
} from './privateStudio';
import { hasAcceptedProfileTerms } from './profileTermsConsent';
import {
  GLOBAL_STATS_STORAGE_KEY,
  PASSPORT_PORTRAIT_STORAGE_KEY,
  PRIVATE_STUDIO_NAME_MAX,
  PRIVATE_STUDIO_STORAGE_KEY,
} from './paintConstants';
import {
  fetchDurableProfileState,
  syncDurableProfileState,
  type DurableProfileState,
} from './profileState';
import { mergeLifetimeStats } from './lifetimeStats';
import { collectLevelSyncPayload, restoreProfileLevelAchievements } from './profileLevelAchievements';
import { loadLocalLevelStreak, restoreLocalLevelStreak } from './localLevelStreak';

export {
  PROFILE_TERMS_VERSION,
  PROFILE_TERMS_ACCEPTED_KEY,
  PROFILE_TERMS_ACCEPTED_AT_KEY,
  CURRENT_AGB_VERSION,
  hasAcceptedProfileTerms,
  acceptProfileTerms,
  hasAcceptedAgb,
  acceptAgb,
  readAgbAcceptanceState,
  type AgbAcceptanceState,
} from './profileTermsConsent';
export const PROFILE_DISPLAY_NAME_STORAGE_KEY = 'emojipaint/profile/display-name';
export const PROFILE_SERVER_SYNC_MARKER_KEY = 'emojipaint/profile/server-sync-marker';
export const PROFILE_FIRST_LAUNCH_SETUP_KEY = 'emojipaint/profile/first-launch-setup:v1';

const PROFILE_DELETE_URLS = [
  'https://emojipainter.com/leaderboard/passport_delete_api.php',
  'https://emojipaint.com/leaderboard/passport_delete_api.php',
  'https://emojipainter.com/leaderboard/passport_delete.php?format=json',
  'https://emojipaint.com/leaderboard/passport_delete.php?format=json',
];

export interface ServerProfileSnapshot {
  deviceId: string;
  name: string;
  elapsedMs: number;
  strokeCount: number;
  coinCount: number;
  latestPortrait: string | null;
  portraitHistory: string[];
  profile: PrivateStudioLeaderboardEntry | null;
  galleryEntries: DailyPaintGalleryEntry[];
  /** Level inputs from the durable record. Null when the server predates them. */
  level: {
    streakDays: number;
    streakLastDate: string | null;
    correctGuesses: number;
    multipaintStrokes: number;
    arScenes: number;
    achievements: string[];
  } | null;
}

const normalizeName = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeImage = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const coerceNumber = (value: unknown): number => {
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

const dedupeImages = (values: (string | null | undefined)[]): string[] => {
  const next: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeImage(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    next.push(normalized);
  });
  return next;
};

export async function fetchServerProfileSnapshot(deviceId: string): Promise<ServerProfileSnapshot | null> {
  const normalizedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!normalizedDeviceId) {
    return null;
  }

  const [profile, galleryEntries, durable] = await Promise.all([
    fetchExistingPassport(normalizedDeviceId).catch(() => null),
    fetchDailyPaintGallery({
      sort: 'new',
      owner: normalizedDeviceId,
      limit: 100,
      force: true,
    }).catch(() => [] as DailyPaintGalleryEntry[]),
    fetchDurableProfileState(normalizedDeviceId),
  ]);

  const sortedEntries = [...galleryEntries].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const latestGalleryNameCandidates = sortedEntries
    .map((entry) => normalizeName(entry.passportName))
    .filter((value): value is string => Boolean(value));
  const galleryName =
    latestGalleryNameCandidates.length > 0
      ? latestGalleryNameCandidates[latestGalleryNameCandidates.length - 1]
      : null;
  const name = normalizeName(durable?.name) ?? normalizeName(profile?.name) ?? galleryName;

  const portraitHistory = dedupeImages([
    ...sortedEntries.map((entry) => entry.passportPortrait),
    profile?.imageUrl ?? null,
    durable?.portraitUrl ?? null,
  ]);
  const latestPortrait =
    normalizeImage(durable?.portraitUrl) ??
    (portraitHistory.length > 0 ? portraitHistory[portraitHistory.length - 1] : null) ??
    normalizeImage(profile?.imageUrl) ??
    null;

  if (!profile && sortedEntries.length === 0 && !durable?.found && !name && !latestPortrait) {
    return null;
  }

  return {
    deviceId: normalizedDeviceId,
    name: name ?? '',
    elapsedMs: Math.max(coerceNumber(profile?.elapsedMs), coerceNumber(durable?.elapsedMs)),
    strokeCount: Math.max(coerceNumber(profile?.strokeCount), coerceNumber(durable?.strokeCount)),
    coinCount: Math.max(coerceNumber(profile?.coinCount), coerceNumber(durable?.coinCount)),
    latestPortrait,
    portraitHistory,
    profile,
    galleryEntries: sortedEntries,
    level: durable
      ? {
          streakDays: durable.streakDays,
          streakLastDate: durable.streakLastDate,
          correctGuesses: durable.correctGuesses,
          multipaintStrokes: durable.multipaintStrokes,
          arScenes: durable.arScenes,
          achievements: durable.achievements,
        }
      : null,
  };
}

export async function markServerProfileSynced(deviceId: string): Promise<void> {
  await AsyncStorage.setItem(PROFILE_SERVER_SYNC_MARKER_KEY, deviceId.trim());
}

export async function persistProfileDisplayNameLocally(rawName: string): Promise<string> {
  const name = rawName.trim().slice(0, PRIVATE_STUDIO_NAME_MAX);
  if (!name) throw new Error('Name required.');
  await AsyncStorage.setItem(PROFILE_DISPLAY_NAME_STORAGE_KEY, name);
  const storedStudio = await AsyncStorage.getItem(PRIVATE_STUDIO_STORAGE_KEY).catch(() => null);
  if (storedStudio) {
    try {
      const parsed = JSON.parse(storedStudio) as Record<string, unknown>;
      parsed.name = name;
      await AsyncStorage.setItem(PRIVATE_STUDIO_STORAGE_KEY, JSON.stringify(parsed));
    } catch (error) {
      console.warn('[ProfileSync] Could not mirror the name into Profile Painter:', error);
    }
  }
  return name;
}

export async function getServerProfileSyncMarker(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(PROFILE_SERVER_SYNC_MARKER_KEY);
    return typeof stored === 'string' && stored.trim().length > 0 ? stored.trim() : null;
  } catch (error) {
    console.warn('[ProfileSync] Failed to read sync marker:', error);
    return null;
  }
}

export async function restoreServerProfileLocally(
  snapshot: ServerProfileSnapshot,
  options: {
    passportPortraitStorageKey: string;
  }
): Promise<void> {
  // Serialize recovery through the same queue as live workspace commits. A raw
  // multiSet here used to race new strokes and replace byWorkspace/event IDs.
  await mergeLifetimeStats({
    totalTimeMs: snapshot.elapsedMs,
    totalStrokes: snapshot.strokeCount,
    coins: snapshot.coinCount,
  });
  // Level inputs. Best-effort: a failure here must not abort the profile restore itself,
  // which already wrote the name/portrait/stats the user actually asked for.
  if (snapshot.level) {
    await restoreProfileLevelAchievements(snapshot.level.achievements).catch((error) => {
      console.warn('[ProfileSync] Could not restore achievements:', error);
    });
    await restoreLocalLevelStreak(snapshot.level.streakDays, snapshot.level.streakLastDate).catch((error) => {
      console.warn('[ProfileSync] Could not restore streak:', error);
    });
  }
  const writes: [string, string][] = [
    [PROFILE_DISPLAY_NAME_STORAGE_KEY, snapshot.name],
    [PROFILE_SERVER_SYNC_MARKER_KEY, snapshot.deviceId],
  ];

  if (snapshot.latestPortrait) {
    writes.push([options.passportPortraitStorageKey, snapshot.latestPortrait]);
  }

  await AsyncStorage.multiSet(writes);

  if (snapshot.portraitHistory.length > 0) {
    await replacePassportSnapshots(snapshot.portraitHistory);
  }
}

export async function syncServerProfileState(params: {
  deviceId: string;
  name: string;
  elapsedMs: number;
  strokeCount: number;
  portraitUrl?: string | null;
  // Level inputs — optional so existing call sites (e.g. ProfileStudioScreen) keep working
  // and simply omit them; the server leaves any field it is not sent untouched.
  coinCount?: number;
  streakDays?: number;
  streakLastDate?: string | null;
  correctGuesses?: number;
  multipaintStrokes?: number;
  arScenes?: number;
  achievements?: string[];
}): Promise<DurableProfileState> {
  if (!(await hasAcceptedProfileTerms())) {
    throw new Error('Profile terms have not been accepted.');
  }
  const synced = await syncDurableProfileState(params);
  await markServerProfileSynced(params.deviceId);
  return synced;
}

let scheduledProfileSync: ReturnType<typeof setTimeout> | null = null;
let activeProfileSync: Promise<DurableProfileState | null> | null = null;

export async function flushStoredProfileState(): Promise<DurableProfileState | null> {
  if (activeProfileSync) return activeProfileSync;
  activeProfileSync = (async () => {
    try {
      const [deviceId, nameRaw, statsRaw, portraitRaw] = await Promise.all([
        getOrCreateDailyDeviceId(),
        AsyncStorage.getItem(PROFILE_DISPLAY_NAME_STORAGE_KEY),
        AsyncStorage.getItem(GLOBAL_STATS_STORAGE_KEY),
        AsyncStorage.getItem(PASSPORT_PORTRAIT_STORAGE_KEY),
      ]);
      const name = normalizeName(nameRaw);
      if (!name) return null;
      let stats: { totalTimeMs?: unknown; totalStrokes?: unknown; coins?: unknown } = {};
      try { stats = statsRaw ? JSON.parse(statsRaw) : {}; } catch { stats = {}; }
      // The LEVEL needs more than time+strokes. Without these a recovered profile came back at
      // level 1 with every achievement gone, which is what made sync feel broken.
      const [levelPayload, streak] = await Promise.all([
        collectLevelSyncPayload().catch(() => null),
        loadLocalLevelStreak().catch(() => null),
      ]);
      return await syncServerProfileState({
        deviceId,
        name,
        elapsedMs: coerceNumber(stats.totalTimeMs),
        strokeCount: coerceNumber(stats.totalStrokes),
        coinCount: coerceNumber(stats.coins),
        portraitUrl: portraitRaw?.startsWith('https://') ? portraitRaw : null,
        ...(streak ? { streakDays: streak.days, streakLastDate: streak.lastDate } : {}),
        ...(levelPayload ? {
          correctGuesses: levelPayload.correctGuesses,
          multipaintStrokes: levelPayload.multipaintStrokes,
          arScenes: levelPayload.arScenes,
          achievements: levelPayload.achievements,
        } : {}),
      });
    } catch (error) {
      console.warn('[ProfileSync] Background sync deferred:', error);
      return null;
    } finally {
      activeProfileSync = null;
    }
  })();
  return activeProfileSync;
}

export function scheduleStoredProfileStateSync(delayMs = 2500): void {
  if (scheduledProfileSync) clearTimeout(scheduledProfileSync);
  scheduledProfileSync = setTimeout(() => {
    scheduledProfileSync = null;
    void flushStoredProfileState();
  }, Math.max(0, delayMs));
}

export async function clearSyncedProfileIdentity(): Promise<void> {
  await AsyncStorage.multiRemove([
    PROFILE_DISPLAY_NAME_STORAGE_KEY,
    PROFILE_SERVER_SYNC_MARKER_KEY,
  ]);
  await clearPassportSnapshots();
}

export async function createFreshProfileIdentity(): Promise<string> {
  await clearSyncedProfileIdentity();
  return regenerateDeviceId();
}

export async function deleteProfileFromServer(deviceId: string): Promise<void> {
  const normalizedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!normalizedDeviceId) {
    throw new Error('Missing device ID.');
  }

  let lastError: Error | null = null;

  for (const url of PROFILE_DELETE_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        body: JSON.stringify({
          machineId: normalizedDeviceId,
          deviceId: normalizedDeviceId,
          deleteGalleryEntries: true,
        }),
      });

      const text = await response.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('Endpoint did not return JSON.');
      }

      if (!response.ok || parsed?.ok === false || parsed?.success === false) {
        const message =
          typeof parsed?.error === 'string' && parsed.error.trim().length > 0
            ? parsed.error.trim()
            : `Delete failed (${response.status})`;
        throw new Error(message);
      }

      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Delete request failed.');
    }
  }

  throw lastError ?? new Error('Server delete endpoint is not available yet.');
}
