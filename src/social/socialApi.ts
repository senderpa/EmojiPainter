/**
 * socialApi — the single import surface for the new Profile + World screens.
 * Thin wrappers over existing libs (no new network code beyond the social
 * endpoint) + camelCase view-model assembly + follow/unfollow aliases.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import GesserApi from '../gesser/api/gesserClient';
import type { GesserUser } from '../gesser/types';
import {
  fetchServerProfileSnapshot,
  persistProfileDisplayNameLocally,
  scheduleStoredProfileStateSync,
  type ServerProfileSnapshot,
} from '../lib/profileSync';
import { hasAcceptedProfileTerms } from '../lib/profileTermsConsent';
import { getOrCreateDailyDeviceId } from '../lib/dailyDeviceId';
import { COIN_STORAGE_KEY, GLOBAL_STATS_STORAGE_KEY } from '../lib/paintConstants';
import { computeKarma } from './karma';
import type { ProfileViewModel, WorldUser, TimelineEvent } from './types';

export { getOrCreateDailyDeviceId };

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const logProfileSync = (label: string, details: Record<string, unknown>): void => {
  if (!__DEV__) return;
  console.log(`[ProfileSync debug] ${label}`, details);
};

type LocalProfileStats = {
  elapsedMs: number;
  strokeCount: number;
  coinCount: number;
};

async function loadLocalProfileStats(): Promise<LocalProfileStats> {
  try {
    const [rawStats, rawCoins] = await Promise.all([
      AsyncStorage.getItem(GLOBAL_STATS_STORAGE_KEY),
      AsyncStorage.getItem(COIN_STORAGE_KEY),
    ]);
    let elapsedMs = 0;
    let strokeCount = 0;
    let coinCount = 0;
    if (rawStats) {
      const parsed = JSON.parse(rawStats) as { totalTimeMs?: unknown; totalStrokes?: unknown; coins?: unknown };
      elapsedMs = Math.max(0, Math.floor(Number(parsed.totalTimeMs) || 0));
      strokeCount = Math.max(0, Math.floor(Number(parsed.totalStrokes) || 0));
      coinCount = Math.max(0, Math.floor(Number(parsed.coins) || 0));
    }
    if (rawCoins != null) {
      coinCount = Math.max(coinCount, Math.floor(Number(rawCoins) || 0));
    }
    return { elapsedMs, strokeCount, coinCount };
  } catch {
    return { elapsedMs: 0, strokeCount: 0, coinCount: 0 };
  }
}

/** Follow = directed add (MySpace "add"). */
export async function follow(myDeviceId: string, targetDeviceId: string): Promise<void> {
  await GesserApi.addFriend(myDeviceId, targetDeviceId);
}

export async function unfollow(myDeviceId: string, targetDeviceId: string): Promise<void> {
  await GesserApi.removeFriend(myDeviceId, targetDeviceId);
}

/** Whether `myDeviceId` already follows `targetDeviceId` (derived from my list). */
export async function getFollowState(myDeviceId: string, targetDeviceId: string): Promise<boolean> {
  try {
    const res = await GesserApi.listFriends(myDeviceId);
    return res.friends.some((f) => f.deviceId === targetDeviceId);
  } catch {
    return false;
  }
}

/** Load + assemble everything a ProfilePage needs for a given user. */
export async function loadProfile(
  targetDeviceId: string,
  seed?: { name?: string; portrait?: string | null; rank?: number },
): Promise<ProfileViewModel> {
  const totalStart = nowMs();
  logProfileSync('loadProfile:start', { targetDeviceId });
  const myDeviceId = await getOrCreateDailyDeviceId();
  const isSelf = myDeviceId === targetDeviceId;
  logProfileSync('loadProfile:deviceId', {
    targetDeviceId,
    isSelf,
    elapsedMs: Math.round(nowMs() - totalStart),
  });

  const [snapshot, social, localStats] = await Promise.all([
    (async () => {
      const start = nowMs();
      const value = await fetchServerProfileSnapshot(targetDeviceId).catch((error) => {
        logProfileSync('loadProfile:snapshot:error', {
          targetDeviceId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      logProfileSync('loadProfile:snapshot:done', {
        targetDeviceId,
        elapsedMs: Math.round(nowMs() - start),
        galleryCount: value?.galleryEntries.length ?? 0,
        portraitCount: value?.portraitHistory.length ?? 0,
      });
      return value;
    })(),
    (async () => {
      const start = nowMs();
      const value = await GesserApi.getProfileSocial(myDeviceId, targetDeviceId).catch((error) => {
        logProfileSync('loadProfile:social:error', {
          targetDeviceId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      logProfileSync('loadProfile:social:done', {
        targetDeviceId,
        elapsedMs: Math.round(nowMs() - start),
        ok: value?.ok ?? false,
      });
      return value;
    })(),
    isSelf ? loadLocalProfileStats() : Promise.resolve(null),
  ]);

  const correctGuesses = social?.ok ? social.correctGuesses : null;
  const karma = computeKarma(snapshot, correctGuesses ?? 0);
  const serverAvailable = snapshot !== null || (social !== null && social.ok);

  const profile = buildProfileViewModel({
    targetDeviceId,
    isSelf,
    snapshot,
    seed,
    bio: social?.ok ? social.bio : null,
    nameOverride: social?.ok ? social.displayName : null,
    portraitOverride: social?.ok ? social.portraitUrl : null,
    followerCount: social?.ok ? social.followerCount : null,
    followingCount: social?.ok ? social.followingCount : null,
    isFollowing: social?.ok ? social.isFollowing : false,
    correctGuesses,
    karma,
    localStats,
    serverAvailable,
  });
  logProfileSync('loadProfile:complete', {
    targetDeviceId,
    totalMs: Math.round(nowMs() - totalStart),
    galleryCount: profile.galleryCount,
    serverAvailable,
    timelineLoadedSeparately: true,
  });
  return profile;
}

function buildProfileViewModel(args: {
  targetDeviceId: string;
  isSelf: boolean;
  snapshot: ServerProfileSnapshot | null;
  seed?: { name?: string; portrait?: string | null; rank?: number };
  bio: string | null;
  nameOverride: string | null;
  portraitOverride: string | null;
  followerCount: number | null;
  followingCount: number | null;
  isFollowing: boolean;
  correctGuesses: number | null;
  karma: number;
  localStats: LocalProfileStats | null;
  serverAvailable: boolean;
}): ProfileViewModel {
  const { snapshot, seed } = args;
  const localStats = args.localStats;
  return {
    deviceId: args.targetDeviceId,
    name: args.nameOverride || snapshot?.name || seed?.name || 'Anonymous',
    bio: args.bio,
    isSelf: args.isSelf,
    portrait: args.portraitOverride ?? snapshot?.latestPortrait ?? seed?.portrait ?? null,
    portraitHistory: snapshot?.portraitHistory ?? [],
    elapsedMs: Math.max(snapshot?.elapsedMs ?? 0, localStats?.elapsedMs ?? 0),
    strokeCount: Math.max(snapshot?.strokeCount ?? 0, localStats?.strokeCount ?? 0),
    coinCount: Math.max(snapshot?.coinCount ?? 0, localStats?.coinCount ?? 0),
    rank: snapshot?.profile?.rank ?? seed?.rank ?? null,
    followerCount: args.followerCount,
    followingCount: args.followingCount,
    isFollowing: args.isFollowing,
    correctGuesses: args.correctGuesses,
    karma: args.karma,
    galleryEntries: snapshot?.galleryEntries ?? [],
    galleryCount: snapshot?.galleryEntries.length ?? 0,
    serverAvailable: args.serverAvailable,
  };
}

/** Normalize a discover row (snake OR camel) into a WorldUser. */
export function toWorldUser(u: GesserUser & Record<string, any>): WorldUser {
  const num = (v: any): number | null => (v == null ? null : Number(v) || 0);
  return {
    deviceId: u.deviceId ?? u.device_id ?? '',
    name: u.name ?? '',
    portrait: u.portrait ?? u.passport_url ?? u.passport_portrait ?? null,
    coins: u.coins ?? 0,
    rank: u.rank ?? 0,
    isSelf: false, // set in loadWorldUsers (needs the viewer's id)
    isFollowing: !!(u.isFriend ?? u.is_friend),
    followerCount: num(u.followerCount ?? u.follower_count),
    followingCount: num(u.followingCount ?? u.following_count),
    uploadCount: num(u.uploadCount ?? u.upload_count),
    lastActivityAt: num(u.lastActivityAt ?? u.last_activity ?? u.last_activity_at),
  };
}

export async function loadWorldUsers(
  search: string,
  limit: number,
  offset: number,
): Promise<{ users: WorldUser[]; hasMore: boolean; total: number }> {
  const start = nowMs();
  const myDeviceId = await getOrCreateDailyDeviceId();
  const res = await GesserApi.discoverUsers(myDeviceId, search || undefined, limit, offset);
  const rows = (res.users ?? []) as (GesserUser & Record<string, any>)[];
  // Include EVERY user — including myself (so I can discover/open my own profile). Only drop rows with
  // no device id. (The old code filtered out self, hiding the current user from World.)
  const result = {
    users: rows
      .map(toWorldUser)
      .filter((u) => !!u.deviceId)
      .map((u) => ({ ...u, isSelf: u.deviceId === myDeviceId })),
    hasMore: !!res.hasMore,
    total: res.total ?? rows.length,
  };
  logProfileSync('loadWorldUsers:complete', {
    search: search ? 'yes' : 'no',
    limit,
    offset,
    count: result.users.length,
    hasMore: result.hasMore,
    totalMs: Math.round(nowMs() - start),
  });
  return result;
}

/** Who follows `targetDeviceId` (reverse follow graph), shaped as WorldUser rows. */
export async function loadFollowers(targetDeviceId: string): Promise<WorldUser[]> {
  const myDeviceId = await getOrCreateDailyDeviceId();
  const res = await GesserApi.getFollowers(targetDeviceId, myDeviceId);
  return res.followers.map((f) => ({
    deviceId: f.deviceId,
    name: f.name,
    portrait: f.portrait,
    coins: f.coins,
    rank: 0,
    isSelf: f.deviceId === myDeviceId,
    isFollowing: f.isFriend,
    followerCount: null,
    followingCount: null,
    uploadCount: null,
    lastActivityAt: null,
  }));
}

/** Who `targetDeviceId` follows (their friend edges), shaped as WorldUser rows. */
export async function loadFollowing(targetDeviceId: string): Promise<WorldUser[]> {
  const myDeviceId = await getOrCreateDailyDeviceId();
  const res = await GesserApi.listFriends(targetDeviceId);
  return res.friends.map((f) => ({
    deviceId: f.deviceId,
    name: f.name,
    portrait: f.portrait ?? null,
    coins: f.coins,
    rank: f.rank,
    isSelf: f.deviceId === myDeviceId,
    isFollowing: true,
    followerCount: null,
    followingCount: null,
    uploadCount: null,
    lastActivityAt: null,
  }));
}

/** Load a user's diary/timeline (private events only when the viewer is the owner). */
export async function loadTimeline(
  targetDeviceId: string,
  limit = 50,
  offset = 0,
): Promise<{ events: TimelineEvent[]; isOwner: boolean; hasMore: boolean }> {
  const start = nowMs();
  const myDeviceId = await getOrCreateDailyDeviceId();
  const res = await GesserApi.listTimeline(targetDeviceId, myDeviceId, limit, offset);
  const result = { events: res.events, isOwner: res.isOwner, hasMore: res.hasMore };
  logProfileSync('loadTimeline:complete', {
    targetDeviceId,
    limit,
    offset,
    count: result.events.length,
    isOwner: result.isOwner,
    hasMore: result.hasMore,
    totalMs: Math.round(nowMs() - start),
  });
  return result;
}

/** Save the owner's profile (name / bio / portrait). Returns the list of changed fields. */
export async function saveProfile(patch: {
  name?: string;
  bio?: string;
  portraitUrl?: string;
}): Promise<string[]> {
  if (!(await hasAcceptedProfileTerms())) {
    throw new Error('Please accept the current Profil Studio terms before saving an online profile.');
  }
  const myDeviceId = await getOrCreateDailyDeviceId();
  const res = await GesserApi.updateProfile(myDeviceId, patch);
  if (patch.name != null) {
    await persistProfileDisplayNameLocally(patch.name);
    scheduleStoredProfileStateSync(0);
  }
  return res.updated;
}

/** Append a manual diary entry for the owner; returns the created event if the server echoed it. */
export async function addDiary(text: string): Promise<TimelineEvent | null> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Diary entry cannot be empty');
  if (!(await hasAcceptedProfileTerms())) {
    throw new Error('Please accept the current Profil Studio terms before publishing a diary entry.');
  }
  const myDeviceId = await getOrCreateDailyDeviceId();
  const res = await GesserApi.addDiaryEntry(myDeviceId, trimmed);
  return res.entry ?? null;
}
