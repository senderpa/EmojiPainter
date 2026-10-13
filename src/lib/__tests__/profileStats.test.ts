import {
  COIN_LEVELS,
  PROFILE_LEVELS,
  formatElapsedTime,
  formatLevelNextSteps,
  profileLevelXp,
  resolveCoinLevel,
  resolveNextCoinLevel,
  resolveProfileLevelProgress,
} from '../profileStats';

describe('formatElapsedTime (parity with old PaintScreen formatter)', () => {
  test('seconds only', () => {
    expect(formatElapsedTime(0)).toBe('0s');
    expect(formatElapsedTime(42_000)).toBe('42s');
    expect(formatElapsedTime(59_999)).toBe('59s');
  });
  test('minutes', () => {
    expect(formatElapsedTime(60_000)).toBe('1m');
    expect(formatElapsedTime(125_000)).toBe('2m');
  });
  test('hours + minutes', () => {
    expect(formatElapsedTime(3_600_000)).toBe('1h 0m');
    expect(formatElapsedTime(3_900_000)).toBe('1h 5m');
  });
});

describe('resolveCoinLevel', () => {
  test('floors negatives to level 1', () => {
    expect(resolveCoinLevel(-5).id).toBe(1);
    expect(resolveCoinLevel(0).id).toBe(1);
  });
  test('thresholds match table', () => {
    expect(resolveCoinLevel(4).id).toBe(1);
    expect(resolveCoinLevel(5).id).toBe(2);
    expect(resolveCoinLevel(90).id).toBe(10);
    expect(resolveCoinLevel(1000).id).toBe(10);
  });
  test('next level', () => {
    expect(resolveNextCoinLevel(0)?.minCoins).toBe(5);
    expect(resolveNextCoinLevel(90)).toBeNull();
  });
  test('table has 10 levels', () => {
    expect(COIN_LEVELS).toHaveLength(10);
  });
});

describe('resolveProfileLevelProgress', () => {
  test('builds a 1-99 profile level ladder', () => {
    expect(PROFILE_LEVELS).toHaveLength(99);
    expect(PROFILE_LEVELS[0].id).toBe(1);
    expect(PROFILE_LEVELS[0].minXp).toBe(0);
    expect(PROFILE_LEVELS[98].id).toBe(99);
    expect(PROFILE_LEVELS[98].name).toBe('Egg Seeking Artist');
  });

  test('combines only coins, strokes, and time into XP', () => {
    expect(profileLevelXp({
      coins: 10,
      strokeCount: 1000,
      elapsedMs: 60 * 60_000,
    })).toBe(7_800);
  });

  test('keeps the first ten profile levels easy to read', () => {
    expect(PROFILE_LEVELS[4].minXp).toBe(1000);
    expect(resolveProfileLevelProgress({
      coins: 0,
      strokeCount: 1000,
      elapsedMs: 0,
    }).level.id).toBe(5);
  });

  test('completed special tasks add one displayed level each', () => {
    const base = resolveProfileLevelProgress({
      coins: 0,
      strokeCount: 1000,
      elapsedMs: 0,
    });
    const boosted = resolveProfileLevelProgress({
      coins: 0,
      strokeCount: 1000,
      elapsedMs: 0,
      achievementBonusLevels: 2,
    });
    expect(base.level.id).toBe(5);
    expect(boosted.baseLevel.id).toBe(5);
    expect(boosted.level.id).toBe(7);
  });

  test('reports next level progress, streak gates, and level 99 egg hint', () => {
    const early = resolveProfileLevelProgress({
      coins: 0,
      strokeCount: 0,
      elapsedMs: 0,
    });
    expect(early.level.id).toBe(1);
    expect(early.nextLevel?.id).toBe(2);
    expect(early.xpToNext).toBeGreaterThan(0);

    const maxed = resolveProfileLevelProgress({
      coins: 1_000_000,
      strokeCount: 1_000_000,
      elapsedMs: 1_000_000 * 60_000,
      streakDays: 99,
    });
    expect(maxed.level.id).toBe(99);
    expect(maxed.nextLevel).toBeNull();
    expect(formatLevelNextSteps(maxed)).toContain('egg');

    const gated = resolveProfileLevelProgress({
      coins: 1_000_000,
      strokeCount: 1_000_000,
      elapsedMs: 1_000_000 * 60_000,
      streakDays: 2,
    });
    expect(gated.level.id).toBe(32);
    expect(gated.nextLevel?.id).toBe(33);
    expect(gated.gateLocked).toBe(true);
    expect(formatLevelNextSteps(gated)).toContain('daily streak');
  });
});
