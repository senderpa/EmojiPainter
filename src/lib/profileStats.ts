/**
 * profileStats — shared profile/leaderboard stat helpers.
 *
 * Extracted verbatim from PaintScreen so the new social screens (ProfilePage,
 * WorldPage) and PaintScreen share ONE source of truth for coin levels + time
 * formatting. Keep behavior identical — guarded by profileStats.test.ts.
 */
import { PROFILE_LEVEL_CATALOG } from './profileLevelCatalog';

export type CoinLevel = {
  id: number;
  name: string;
  emoji: string;
  minCoins: number;
};

export type ProfileProgressStats = {
  coins: number;
  strokeCount: number;
  elapsedMs: number;
  streakDays?: number | null;
  achievementBonusLevels?: number | null;
};

export type ProfileLevel = {
  id: number;
  name: string;
  emoji: string;
  minXp: number;
  requiredStreakDays?: number;
};

export type ProfileLevelProgress = {
  level: ProfileLevel;
  baseLevel: ProfileLevel;
  nextLevel: ProfileLevel | null;
  xp: number;
  progress: number;
  xpToNext: number;
  achievementBonusLevels: number;
  streakDays: number;
  requiredStreakDays: number;
  streakDaysToNext: number;
  gateLocked: boolean;
};

export const COIN_LEVELS: CoinLevel[] = [
  { id: 1, name: 'Emoji Seedling', emoji: '🌱', minCoins: 0 },
  { id: 2, name: 'Pixel Pathfinder', emoji: '🧭', minCoins: 5 },
  { id: 3, name: 'Brush Adventurer', emoji: '🖌️', minCoins: 10 },
  { id: 4, name: 'Color Virtuoso', emoji: '🎨', minCoins: 15 },
  { id: 5, name: 'Spark Shaper', emoji: '⚡️', minCoins: 20 },
  { id: 6, name: 'Canvas Voyager', emoji: '🚀', minCoins: 30 },
  { id: 7, name: 'Palette Champion', emoji: '🏆', minCoins: 40 },
  { id: 8, name: 'Glyph Guardian', emoji: '🛡️', minCoins: 55 },
  { id: 9, name: 'Pixel Legend', emoji: '🐉', minCoins: 70 },
  { id: 10, name: 'Cosmic Creator', emoji: '🪐', minCoins: 90 },
];

export const resolveCoinLevel = (coins: number): CoinLevel => {
  const safeCoins = Math.max(0, Math.floor(coins));
  for (let index = COIN_LEVELS.length - 1; index >= 0; index -= 1) {
    if (safeCoins >= COIN_LEVELS[index].minCoins) {
      return COIN_LEVELS[index];
    }
  }
  return COIN_LEVELS[0];
};

export const resolveNextCoinLevel = (coins: number): CoinLevel | null => {
  const safeCoins = Math.max(0, Math.floor(coins));
  for (let index = 0; index < COIN_LEVELS.length; index += 1) {
    const level = COIN_LEVELS[index];
    if (safeCoins < level.minCoins) {
      return level;
    }
  }
  return null;
};

export const PROFILE_LEVEL_XP_WEIGHTS = {
  coin: 140,
  paintingMinute: 90,
  stroke: 1,
} as const;

const PROFILE_LEVEL_STREAK_GATES: Record<number, number> = {
  33: 3,
  66: 30,
  99: 99,
};

const PROFILE_LEVEL_EARLY_THRESHOLDS = [
  0,
  120,
  300,
  600,
  1000,
  1600,
  2500,
  3800,
  5600,
  7800,
];

const profileLevelThreshold = (level: number): number => {
  if (level <= 1) return 0;
  if (level <= PROFILE_LEVEL_EARLY_THRESHOLDS.length) {
    return PROFILE_LEVEL_EARLY_THRESHOLDS[level - 1];
  }
  return Math.round(
    450 * Math.pow(level - 1, 2.05)
    + 70 * Math.pow(Math.max(0, level - 25), 2.35)
    + 120 * Math.pow(Math.max(0, level - 60), 2.6)
  );
};

export const PROFILE_LEVELS: ProfileLevel[] = Array.from({ length: 99 }, (_, index) => {
  const id = index + 1;
  const catalog = PROFILE_LEVEL_CATALOG[index];
  return {
    id,
    name: catalog?.name ?? `Level ${id}`,
    emoji: catalog?.emoji ?? '✨',
    minXp: profileLevelThreshold(id),
    requiredStreakDays: PROFILE_LEVEL_STREAK_GATES[id],
  };
});

export const profileLevelXp = (stats: ProfileProgressStats): number => {
  const coins = Math.max(0, Math.floor(stats.coins || 0));
  const strokes = Math.max(0, Math.floor(stats.strokeCount || 0));
  const minutes = Math.max(0, Math.floor((stats.elapsedMs || 0) / 60_000));

  return coins * PROFILE_LEVEL_XP_WEIGHTS.coin
    + minutes * PROFILE_LEVEL_XP_WEIGHTS.paintingMinute
    + strokes * PROFILE_LEVEL_XP_WEIGHTS.stroke;
};

export const resolveProfileLevelProgress = (stats: ProfileProgressStats): ProfileLevelProgress => {
  const xp = profileLevelXp(stats);
  const streakDays = Math.max(0, Math.floor(stats.streakDays || 0));
  const achievementBonusLevels = Math.max(0, Math.floor(stats.achievementBonusLevels || 0));
  let xpLevel = PROFILE_LEVELS[0];
  for (let index = PROFILE_LEVELS.length - 1; index >= 0; index -= 1) {
    if (xp >= PROFILE_LEVELS[index].minXp) {
      xpLevel = PROFILE_LEVELS[index];
      break;
    }
  }

  let level = xpLevel;
  let blockedGateLevel: ProfileLevel | null = null;
  for (const [gateLevelRaw, requiredRaw] of Object.entries(PROFILE_LEVEL_STREAK_GATES)) {
    const gateLevel = Number(gateLevelRaw);
    const required = Number(requiredRaw);
    if (level.id >= gateLevel && streakDays < required) {
      blockedGateLevel = PROFILE_LEVELS[gateLevel - 1] ?? null;
      level = PROFILE_LEVELS[gateLevel - 2] ?? PROFILE_LEVELS[0];
      break;
    }
  }

  const baseLevel = level;
  if (achievementBonusLevels > 0) {
    const boostedId = Math.min(PROFILE_LEVELS.length, level.id + achievementBonusLevels);
    level = PROFILE_LEVELS[boostedId - 1] ?? level;
  }

  const nextBaseLevel = blockedGateLevel ?? PROFILE_LEVELS.find((candidate) => (
    candidate.id > baseLevel.id && candidate.minXp > xp
  )) ?? null;
  const nextLevel = blockedGateLevel
    ? blockedGateLevel
    : nextBaseLevel
    ? PROFILE_LEVELS[Math.min(PROFILE_LEVELS.length, nextBaseLevel.id + achievementBonusLevels) - 1] ?? null
    : null;
  const levelRange = Math.max(1, (nextBaseLevel?.minXp ?? xp + 1) - baseLevel.minXp);
  const progress = nextBaseLevel ? Math.max(0, Math.min(1, (xp - baseLevel.minXp) / levelRange)) : 1;
  const xpToNext = blockedGateLevel ? 0 : (nextBaseLevel ? Math.max(0, nextBaseLevel.minXp - xp) : 0);
  const requiredStreakDays = nextLevel?.requiredStreakDays ?? 0;
  const streakDaysToNext = Math.max(0, requiredStreakDays - streakDays);
  const gateLocked = streakDaysToNext > 0 && xpToNext === 0;
  return {
    level,
    baseLevel,
    nextLevel,
    xp,
    progress: gateLocked ? 1 : progress,
    xpToNext,
    achievementBonusLevels,
    streakDays,
    requiredStreakDays,
    streakDaysToNext,
    gateLocked,
  };
};

export const formatLevelNextSteps = (progress: ProfileLevelProgress): string => {
  if (!progress.nextLevel) return 'Hint for Level 100: egg.';
  if (progress.streakDaysToNext > 0 && progress.xpToNext <= 0) {
    return `${progress.streakDaysToNext} daily streak day${progress.streakDaysToNext === 1 ? '' : 's'} to unlock Level ${progress.nextLevel.id}.`;
  }
  const coins = Math.max(1, Math.ceil(progress.xpToNext / PROFILE_LEVEL_XP_WEIGHTS.coin));
  const strokes = Math.max(1, Math.ceil(progress.xpToNext / PROFILE_LEVEL_XP_WEIGHTS.stroke));
  const minutes = Math.max(1, Math.ceil(progress.xpToNext / PROFILE_LEVEL_XP_WEIGHTS.paintingMinute));
  const gate = progress.streakDaysToNext > 0
    ? ` Also keep ${progress.streakDaysToNext} more daily streak day${progress.streakDaysToNext === 1 ? '' : 's'}.`
    : '';
  return `${coins.toLocaleString()} coins, ${minutes.toLocaleString()} painting minutes, or ${strokes.toLocaleString()} strokes can reach Level ${progress.nextLevel.id}.${gate}`;
};

/** "2h 5m" / "5m" / "42s" — identical to the old PaintScreen formatter. */
export const formatElapsedTime = (elapsedMs: number): string => {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${totalSeconds}s`;
};
