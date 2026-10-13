import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetLifetimeStatsForTests,
  getLifetimeStats,
  mergeLifetimeStats,
  recordLifetimeDuration,
  recordLifetimeStrokeCommit,
  setLifetimeCoins,
} from '../lifetimeStats';
import { GLOBAL_STATS_STORAGE_KEY } from '../paintConstants';

const storage = new Map<string, string>();

describe('lifetimeStats', () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
    __resetLifetimeStatsForTests();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => storage.get(key) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  });

  test('serializes concurrent commits without dropping increments', async () => {
    await Promise.all(
      Array.from({ length: 40 }, (_, index) => recordLifetimeStrokeCommit({
        eventId: `normal-${index}`,
        workspace: index % 2 === 0 ? 'normal' : 'vector',
      }))
    );

    const stats = await getLifetimeStats();
    expect(stats.totalStrokes).toBe(40);
    expect(stats.byWorkspace.normal?.totalStrokes).toBe(20);
    expect(stats.byWorkspace.vector?.totalStrokes).toBe(20);
  });

  test('applies a stable event id once, including after an in-memory reset', async () => {
    const first = await recordLifetimeStrokeCommit({
      eventId: 'painting:stroke-123',
      workspace: 'normal',
    });
    const duplicate = await recordLifetimeStrokeCommit({
      eventId: 'painting:stroke-123',
      workspace: 'normal',
    });
    __resetLifetimeStatsForTests();
    const duplicateAfterRestart = await recordLifetimeStrokeCommit({
      eventId: 'painting:stroke-123',
      workspace: 'normal',
    });

    expect(first.applied).toBe(true);
    expect(duplicate.applied).toBe(false);
    expect(duplicateAfterRestart.applied).toBe(false);
    expect((await getLifetimeStats()).totalStrokes).toBe(1);
  });

  test('keeps duration and stroke totals separated by workspace', async () => {
    await recordLifetimeDuration({ eventId: 'front-interval-1', workspace: 'front-camera', durationMs: 1250.9 });
    await recordLifetimeDuration({ eventId: 'ar-interval-1', workspace: 'ar-scene', durationMs: 750 });
    await recordLifetimeStrokeCommit({ eventId: 'front-stroke-1', workspace: 'front-camera' });

    const stats = await getLifetimeStats();
    expect(stats.totalTimeMs).toBe(2000);
    expect(stats.totalStrokes).toBe(1);
    expect(stats.byWorkspace['front-camera']).toEqual({ totalTimeMs: 1250, totalStrokes: 1 });
    expect(stats.byWorkspace['ar-scene']).toEqual({ totalTimeMs: 750, totalStrokes: 0 });
  });

  test('migrates the old blob shape and merges recovered server totals monotonically', async () => {
    storage.set(GLOBAL_STATS_STORAGE_KEY, JSON.stringify({
      totalTimeMs: 500,
      totalStrokes: 7,
      coins: -2,
      updatedAt: '2025-01-01T00:00:00.000Z',
    }));

    await mergeLifetimeStats({ totalTimeMs: 200, totalStrokes: 12 });
    await setLifetimeCoins(-4);

    expect(await getLifetimeStats()).toEqual(expect.objectContaining({
      totalTimeMs: 500,
      totalStrokes: 12,
      coins: -4,
      byWorkspace: {},
    }));
  });
});
