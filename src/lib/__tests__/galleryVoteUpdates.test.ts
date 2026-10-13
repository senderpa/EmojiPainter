import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DailyPaintGalleryEntry } from '../dailyPaintGallery';
import {
  createGalleryVoteSnapshot,
  diffGalleryVoteSnapshots,
  formatGalleryVoteUpdate,
  recordGalleryVoteCheck,
} from '../galleryVoteUpdates';

const storage = new Map<string, string>();

const entry = (
  id: number,
  deviceId: string,
  upvotes: number,
  downvotes: number
): DailyPaintGalleryEntry => ({
  id,
  imageUrl: `https://example.test/${id}.png`,
  rawUrl: `https://example.test/${id}.png`,
  topic: 'test',
  createdAt: 1,
  deviceId,
  upvotes,
  downvotes,
  userVote: null,
});

describe('gallery vote updates', () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => storage.get(key) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  });

  test('counts only artwork owned by the current device', () => {
    const snapshot = createGalleryVoteSnapshot([
      entry(1, 'MY-DEVICE', 8, 2),
      entry(2, 'my-device', 5, 1),
      entry(3, 'someone-else', 99, 99),
    ], 'my-device', '2026-08-13T12:00:00.000Z');

    expect(snapshot.totalUpvotes).toBe(13);
    expect(snapshot.totalDownvotes).toBe(3);
    expect(Object.keys(snapshot.entries)).toEqual(['1', '2']);
  });

  test('reports per-artwork vote deltas and the latest totals', () => {
    const previous = createGalleryVoteSnapshot([
      entry(1, 'mine', 3, 0),
      entry(2, 'mine', 5, 1),
    ], 'mine');
    const current = createGalleryVoteSnapshot([
      entry(1, 'mine', 7, 1),
      entry(2, 'mine', 6, 2),
    ], 'mine');

    expect(diffGalleryVoteSnapshots(previous, current)).toEqual({
      newUpvotes: 5,
      newDownvotes: 2,
      removedUpvotes: 0,
      removedDownvotes: 0,
      totalUpvotes: 13,
      totalDownvotes: 3,
      topEntryId: '1', // entry 1 gained 4 upvotes (3→7) vs. entry 2's 1 (5→6)
    });
  });

  test('first online check stores a baseline silently and unchanged totals stay silent', async () => {
    const entries = [entry(1, 'mine', 4, 1)];

    await expect(recordGalleryVoteCheck('mine', entries)).resolves.toBeNull();
    await expect(recordGalleryVoteCheck('mine', entries)).resolves.toBeNull();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
  });

  test('formats the requested delta and total summary', () => {
    expect(formatGalleryVoteUpdate({
      newUpvotes: 5,
      newDownvotes: 2,
      removedUpvotes: 0,
      removedDownvotes: 0,
      totalUpvotes: 13,
      totalDownvotes: 3,
    })).toEqual({
      changeText: 'You received 5 upvotes and 2 downvotes.',
      totalText: 'Total: 13 up · 3 down.',
    });
  });
});
