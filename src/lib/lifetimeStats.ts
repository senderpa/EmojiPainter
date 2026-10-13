import AsyncStorage from '@react-native-async-storage/async-storage';

import { COIN_STORAGE_KEY, GLOBAL_STATS_STORAGE_KEY } from './paintConstants';

export type LifetimeWorkspace =
  | 'normal'
  | 'animator'
  | 'framer'
  | 'vector'
  | 'profile-studio'
  | 'ar-scene'
  | 'front-camera'
  | 'multipaint'
  | 'emoji-front-camera'
  | 'other';

export type LifetimeWorkspaceStats = {
  totalTimeMs: number;
  totalStrokes: number;
};

export type LifetimeStatsSnapshot = {
  totalTimeMs: number;
  totalStrokes: number;
  coins: number;
  updatedAt: string;
  byWorkspace: Partial<Record<LifetimeWorkspace, LifetimeWorkspaceStats>>;
};

type StoredLifetimeStats = LifetimeStatsSnapshot & {
  /**
   * A bounded replay guard. Keeping this in the same AsyncStorage value as the
   * totals makes recording an event atomic from the app's point of view.
   */
  recentEventIds: string[];
  [key: string]: unknown;
};

type LifetimeEvent = {
  eventId: string;
  workspace?: LifetimeWorkspace;
};

const MAX_RECENT_EVENT_IDS = 2048;
const listeners = new Set<(snapshot: LifetimeStatsSnapshot) => void>();
let operationQueue: Promise<void> = Promise.resolve();

const finiteWhole = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const finiteSignedWhole = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;

const normalizeWorkspaceStats = (value: unknown): LifetimeWorkspaceStats => {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    totalTimeMs: finiteWhole(candidate.totalTimeMs),
    totalStrokes: finiteWhole(candidate.totalStrokes),
  };
};

const normalizeStoredStats = (value: unknown): StoredLifetimeStats => {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawByWorkspace =
    candidate.byWorkspace && typeof candidate.byWorkspace === 'object'
      ? (candidate.byWorkspace as Record<string, unknown>)
      : {};
  const byWorkspace: LifetimeStatsSnapshot['byWorkspace'] = {};

  Object.entries(rawByWorkspace).forEach(([workspace, stats]) => {
    byWorkspace[workspace as LifetimeWorkspace] = normalizeWorkspaceStats(stats);
  });

  return {
    ...candidate,
    totalTimeMs: finiteWhole(candidate.totalTimeMs),
    totalStrokes: finiteWhole(candidate.totalStrokes),
    coins: finiteSignedWhole(candidate.coins),
    updatedAt:
      typeof candidate.updatedAt === 'string' && candidate.updatedAt.length > 0
        ? candidate.updatedAt
        : new Date(0).toISOString(),
    byWorkspace,
    recentEventIds: Array.isArray(candidate.recentEventIds)
      ? candidate.recentEventIds.filter((id): id is string => typeof id === 'string').slice(-MAX_RECENT_EVENT_IDS)
      : [],
  };
};

const publicSnapshot = (stats: StoredLifetimeStats): LifetimeStatsSnapshot => ({
  totalTimeMs: stats.totalTimeMs,
  totalStrokes: stats.totalStrokes,
  coins: stats.coins,
  updatedAt: stats.updatedAt,
  byWorkspace: stats.byWorkspace,
});

const readStoredStats = async (): Promise<StoredLifetimeStats> => {
  try {
    const raw = await AsyncStorage.getItem(GLOBAL_STATS_STORAGE_KEY);
    return normalizeStoredStats(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeStoredStats(null);
  }
};

const notify = (stats: StoredLifetimeStats) => {
  const snapshot = publicSnapshot(stats);
  listeners.forEach(listener => listener(snapshot));
};

const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
};

const writeStoredStats = async (stats: StoredLifetimeStats): Promise<LifetimeStatsSnapshot> => {
  await AsyncStorage.setItem(GLOBAL_STATS_STORAGE_KEY, JSON.stringify(stats));
  notify(stats);
  return publicSnapshot(stats);
};

const appendEventId = (stats: StoredLifetimeStats, eventId: string) => {
  stats.recentEventIds = [...stats.recentEventIds, eventId].slice(-MAX_RECENT_EVENT_IDS);
};

const normalizeEventId = (kind: 'stroke' | 'duration', eventId: string): string =>
  `${kind}:${eventId.trim()}`;

export const getLifetimeStats = (): Promise<LifetimeStatsSnapshot> =>
  enqueue(async () => publicSnapshot(await readStoredStats()));

export const subscribeToLifetimeStats = (listener: (snapshot: LifetimeStatsSnapshot) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const recordLifetimeStrokeCommit = ({
  eventId,
  workspace = 'other',
  count = 1,
}: LifetimeEvent & { count?: number }): Promise<{ applied: boolean; snapshot: LifetimeStatsSnapshot }> =>
  enqueue(async () => {
    const stats = await readStoredStats();
    const normalizedId = normalizeEventId('stroke', eventId);
    const amount = finiteWhole(count);
    if (!eventId.trim() || amount === 0 || stats.recentEventIds.includes(normalizedId)) {
      return { applied: false, snapshot: publicSnapshot(stats) };
    }

    const workspaceStats = normalizeWorkspaceStats(stats.byWorkspace[workspace]);
    stats.totalStrokes += amount;
    stats.byWorkspace = {
      ...stats.byWorkspace,
      [workspace]: { ...workspaceStats, totalStrokes: workspaceStats.totalStrokes + amount },
    };
    stats.updatedAt = new Date().toISOString();
    appendEventId(stats, normalizedId);
    return { applied: true, snapshot: await writeStoredStats(stats) };
  });

export const recordLifetimeDuration = ({
  eventId,
  workspace = 'other',
  durationMs,
}: LifetimeEvent & { durationMs: number }): Promise<{ applied: boolean; snapshot: LifetimeStatsSnapshot }> =>
  enqueue(async () => {
    const stats = await readStoredStats();
    const normalizedId = normalizeEventId('duration', eventId);
    const amount = finiteWhole(durationMs);
    if (!eventId.trim() || amount === 0 || stats.recentEventIds.includes(normalizedId)) {
      return { applied: false, snapshot: publicSnapshot(stats) };
    }

    const workspaceStats = normalizeWorkspaceStats(stats.byWorkspace[workspace]);
    stats.totalTimeMs += amount;
    stats.byWorkspace = {
      ...stats.byWorkspace,
      [workspace]: { ...workspaceStats, totalTimeMs: workspaceStats.totalTimeMs + amount },
    };
    stats.updatedAt = new Date().toISOString();
    appendEventId(stats, normalizedId);
    return { applied: true, snapshot: await writeStoredStats(stats) };
  });

/** Merge server/legacy totals without ever decreasing lifetime progress. */
export const mergeLifetimeStats = (patch: {
  totalTimeMs?: number;
  totalStrokes?: number;
  coins?: number;
}): Promise<LifetimeStatsSnapshot> =>
  enqueue(async () => {
    const stats = await readStoredStats();
    stats.totalTimeMs = Math.max(stats.totalTimeMs, finiteWhole(patch.totalTimeMs));
    stats.totalStrokes = Math.max(stats.totalStrokes, finiteWhole(patch.totalStrokes));
    if (patch.coins != null) stats.coins = Math.max(stats.coins, finiteWhole(patch.coins));
    stats.updatedAt = new Date().toISOString();
    const snapshot = await writeStoredStats(stats);
    if (patch.coins != null) await AsyncStorage.setItem(COIN_STORAGE_KEY, String(stats.coins));
    return snapshot;
  });

/** Coins are spendable/current state, unlike monotonic lifetime time/strokes. */
export const setLifetimeCoins = (coins: number): Promise<LifetimeStatsSnapshot> =>
  enqueue(async () => {
    const stats = await readStoredStats();
    stats.coins = finiteSignedWhole(coins);
    stats.updatedAt = new Date().toISOString();
    const snapshot = await writeStoredStats(stats);
    await AsyncStorage.setItem(COIN_STORAGE_KEY, String(stats.coins));
    return snapshot;
  });

/** Used only for the explicit local-profile reset flow. */
export const resetLifetimeStats = (): Promise<LifetimeStatsSnapshot> =>
  enqueue(async () => {
    const stats = normalizeStoredStats(null);
    stats.updatedAt = new Date().toISOString();
    const snapshot = await writeStoredStats(stats);
    await AsyncStorage.setItem(COIN_STORAGE_KEY, '0');
    return snapshot;
  });

/** Test-only reset of in-memory serialization/listener state. */
export const __resetLifetimeStatsForTests = () => {
  operationQueue = Promise.resolve();
  listeners.clear();
};
