import { ensureProfileAuth, profileApiRequest } from './profileAuth';

export interface DurableProfileState {
  found: boolean;
  deviceId: string;
  name: string;
  elapsedMs: number;
  strokeCount: number;
  coinCount: number;
  portraitUrl: string | null;
  updatedAt: string | null;
  // ── Level inputs ──────────────────────────────────────────────────────────
  // The profile level is derived from more than time+strokes; without these a
  // restored profile came back at level 1 with every achievement lost.
  /** Live streak. Can legitimately RESET, so it is last-write-wins by date, never max-merged. */
  streakDays: number;
  streakLastDate: string | null;
  /** Monotonic — only ever grows. */
  correctGuesses: number;
  multipaintStrokes: number;
  arScenes: number;
  /** Earned achievement ids. SERVER WINS: the restored set replaces local flags exactly. */
  achievements: string[];
}

type ProfileStateResponse = {
  ok?: boolean;
  profile?: {
    found?: unknown;
    device_id?: unknown;
    name?: unknown;
    total_time_ms?: unknown;
    total_strokes?: unknown;
    coin_count?: unknown;
    portrait_url?: unknown;
    updated_at?: unknown;
    streak_days?: unknown;
    streak_last_date?: unknown;
    correct_guesses?: unknown;
    multipaint_strokes?: unknown;
    ar_scenes?: unknown;
    achievements?: unknown;
  };
};

const nonNegativeInteger = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const optionalText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Server may send a JSON string, an array, or nothing at all (older deployments). */
const parseAchievements = (value: unknown): string[] => {
  let list: unknown = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

const normalize = (fallbackDeviceId: string, response: ProfileStateResponse): DurableProfileState => {
  const profile = response.profile ?? {};
  return {
    found: profile.found === true,
    deviceId: optionalText(profile.device_id) ?? fallbackDeviceId,
    name: optionalText(profile.name) ?? '',
    elapsedMs: nonNegativeInteger(profile.total_time_ms),
    strokeCount: nonNegativeInteger(profile.total_strokes),
    coinCount: nonNegativeInteger(profile.coin_count),
    portraitUrl: optionalText(profile.portrait_url),
    updatedAt: optionalText(profile.updated_at),
    streakDays: nonNegativeInteger(profile.streak_days),
    streakLastDate: optionalText(profile.streak_last_date),
    correctGuesses: nonNegativeInteger(profile.correct_guesses),
    multipaintStrokes: nonNegativeInteger(profile.multipaint_strokes),
    arScenes: nonNegativeInteger(profile.ar_scenes),
    // Tolerates a JSON string or a real array — older deployments send neither.
    achievements: parseAchievements(profile.achievements),
  };
};

export async function fetchDurableProfileState(deviceId: string): Promise<DurableProfileState | null> {
  const normalizedDeviceId = deviceId.trim();
  if (!normalizedDeviceId) return null;
  try {
    const token = await ensureProfileAuth(normalizedDeviceId);
    const response = await profileApiRequest<ProfileStateResponse>('profile-state.php', {
      action: 'read',
      device_id: normalizedDeviceId,
    }, token);
    return normalize(normalizedDeviceId, response);
  } catch (error) {
    // Older production deployments do not have profile-state.php yet. The
    // caller deliberately falls back to leaderboard + gallery recovery.
    console.warn('[ProfileState] Durable read unavailable:', error);
    return null;
  }
}

export async function syncDurableProfileState(params: {
  deviceId: string;
  name: string;
  elapsedMs: number;
  strokeCount: number;
  portraitUrl?: string | null;
  // Level inputs — omitted fields are simply not sent, so an older client or a
  // partially-populated device never wipes a value already on the server.
  coinCount?: number;
  streakDays?: number;
  streakLastDate?: string | null;
  correctGuesses?: number;
  multipaintStrokes?: number;
  arScenes?: number;
  achievements?: string[];
}): Promise<DurableProfileState> {
  const deviceId = params.deviceId.trim();
  const name = params.name.trim().slice(0, 40);
  if (!deviceId) throw new Error('Missing profile device ID.');
  if (!name) throw new Error('Name required.');
  const token = await ensureProfileAuth(deviceId);
  const response = await profileApiRequest<ProfileStateResponse>('profile-state.php', {
    action: 'sync',
    device_id: deviceId,
    name,
    total_time_ms: Math.max(0, Math.floor(params.elapsedMs || 0)),
    total_strokes: Math.max(0, Math.floor(params.strokeCount || 0)),
    ...(params.portraitUrl?.startsWith('https://') ? { portrait_url: params.portraitUrl } : {}),
    ...(params.coinCount !== undefined ? { coin_count: Math.max(0, Math.floor(params.coinCount)) } : {}),
    ...(params.streakDays !== undefined ? { streak_days: Math.max(0, Math.floor(params.streakDays)) } : {}),
    ...(params.streakLastDate ? { streak_last_date: params.streakLastDate } : {}),
    ...(params.correctGuesses !== undefined ? { correct_guesses: Math.max(0, Math.floor(params.correctGuesses)) } : {}),
    ...(params.multipaintStrokes !== undefined ? { multipaint_strokes: Math.max(0, Math.floor(params.multipaintStrokes)) } : {}),
    ...(params.arScenes !== undefined ? { ar_scenes: Math.max(0, Math.floor(params.arScenes)) } : {}),
    ...(params.achievements ? { achievements: JSON.stringify(params.achievements) } : {}),
  }, token);
  return normalize(deviceId, response);
}
