import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DailyPaintGalleryEntry } from './dailyPaintGallery';

const GALLERY_VOTE_BASELINE_PREFIX = 'emojipaint/profile/gallery-vote-baseline:v1:';

type EntryVoteTotals = { upvotes: number; downvotes: number };

export interface GalleryVoteSnapshot {
  checkedAt: string;
  entries: Record<string, EntryVoteTotals>;
  totalUpvotes: number;
  totalDownvotes: number;
}

export interface GalleryVoteUpdate {
  newUpvotes: number;
  newDownvotes: number;
  removedUpvotes: number;
  removedDownvotes: number;
  totalUpvotes: number;
  totalDownvotes: number;
  /** Gallery entry id whose upvotes grew the most this check, if any did. */
  topEntryId?: string;
}

const count = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const normalizeDeviceId = (value: string): string => value.trim().toLowerCase();

export const galleryVoteBaselineKey = (deviceId: string): string =>
  `${GALLERY_VOTE_BASELINE_PREFIX}${normalizeDeviceId(deviceId)}`;

export function createGalleryVoteSnapshot(
  entries: DailyPaintGalleryEntry[],
  deviceId: string,
  checkedAt = new Date().toISOString()
): GalleryVoteSnapshot {
  const ownerId = normalizeDeviceId(deviceId);
  const ownEntries = entries.filter((entry) =>
    typeof entry.deviceId === 'string' && normalizeDeviceId(entry.deviceId) === ownerId
  );
  const perEntry: Record<string, EntryVoteTotals> = {};
  let totalUpvotes = 0;
  let totalDownvotes = 0;

  ownEntries.forEach((entry) => {
    const totals = {
      upvotes: count(entry.upvotes),
      downvotes: count(entry.downvotes),
    };
    perEntry[String(entry.id)] = totals;
    totalUpvotes += totals.upvotes;
    totalDownvotes += totals.downvotes;
  });

  return { checkedAt, entries: perEntry, totalUpvotes, totalDownvotes };
}

export function diffGalleryVoteSnapshots(
  previous: GalleryVoteSnapshot,
  current: GalleryVoteSnapshot
): GalleryVoteUpdate | null {
  let newUpvotes = 0;
  let newDownvotes = 0;
  let removedUpvotes = 0;
  let removedDownvotes = 0;
  // The entry whose upvotes grew the most — what the "Show" button jumps to.
  let topEntryId: string | undefined;
  let topEntryDelta = 0;

  Object.entries(current.entries).forEach(([entryId, totals]) => {
    const before = previous.entries[entryId] ?? { upvotes: 0, downvotes: 0 };
    const upDelta = totals.upvotes - before.upvotes;
    const downDelta = totals.downvotes - before.downvotes;
    if (upDelta > 0) newUpvotes += upDelta;
    if (upDelta < 0) removedUpvotes += Math.abs(upDelta);
    if (downDelta > 0) newDownvotes += downDelta;
    if (downDelta < 0) removedDownvotes += Math.abs(downDelta);
    if (upDelta > topEntryDelta) {
      topEntryDelta = upDelta;
      topEntryId = entryId;
    }
  });

  if (newUpvotes + newDownvotes + removedUpvotes + removedDownvotes === 0) {
    return null;
  }

  return {
    newUpvotes,
    newDownvotes,
    removedUpvotes,
    removedDownvotes,
    totalUpvotes: current.totalUpvotes,
    totalDownvotes: current.totalDownvotes,
    topEntryId,
  };
}

export async function recordGalleryVoteCheck(
  deviceId: string,
  entries: DailyPaintGalleryEntry[]
): Promise<GalleryVoteUpdate | null> {
  const key = galleryVoteBaselineKey(deviceId);
  const current = createGalleryVoteSnapshot(entries, deviceId);
  const stored = await AsyncStorage.getItem(key);
  let previous: GalleryVoteSnapshot | null = null;

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as GalleryVoteSnapshot;
      if (parsed?.entries && typeof parsed.entries === 'object') previous = parsed;
    } catch {
      previous = null;
    }
  }

  // Persist before presenting anything: this successful online check defines
  // the new baseline, so the same vote change is never announced twice.
  await AsyncStorage.setItem(key, JSON.stringify(current));
  return previous ? diffGalleryVoteSnapshots(previous, current) : null;
}

const plural = (value: number, singular: string): string =>
  `${value} ${singular}${value === 1 ? '' : 's'}`;

export function formatGalleryVoteUpdate(update: GalleryVoteUpdate): {
  changeText: string;
  totalText: string;
} {
  const received: string[] = [];
  const removed: string[] = [];
  if (update.newUpvotes > 0) received.push(plural(update.newUpvotes, 'upvote'));
  if (update.newDownvotes > 0) received.push(plural(update.newDownvotes, 'downvote'));
  if (update.removedUpvotes > 0) removed.push(plural(update.removedUpvotes, 'upvote'));
  if (update.removedDownvotes > 0) removed.push(plural(update.removedDownvotes, 'downvote'));

  const clauses: string[] = [];
  if (received.length > 0) clauses.push(`You received ${received.join(' and ')}.`);
  if (removed.length > 0) clauses.push(`${removed.join(' and ')} removed.`);

  return {
    changeText: clauses.join(' '),
    totalText: `Total: ${update.totalUpvotes} up · ${update.totalDownvotes} down.`,
  };
}
