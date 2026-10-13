import AsyncStorage from '@react-native-async-storage/async-storage';

export type ProfileLevelAchievementId =
  | 'profile_visit_3'
  | 'first_gallery_upload'
  | 'first_mystery_guess'
  | 'first_profile_painter'
  | 'first_multipaint_stroke'
  | 'first_ar_scene_13'
  | 'first_animator_upload'
  | 'coin_stack_10'
  | 'stroke_milestone_1000'
  | 'time_milestone_60';

export type ProfileLevelAchievement = {
  id: ProfileLevelAchievementId;
  title: string;
  emoji: string;
  iconLevel: number;
  requirement: string;
  tip: string;
};

export type ProfileLevelAchievementStats = {
  coins: number;
  strokeCount: number;
  elapsedMs: number;
  streakDays: number;
  galleryCount: number;
  correctGuesses: number | null;
  karma: number;
  hasPortrait: boolean;
  portraitCount: number;
};

export type ProfileLevelAchievementStatus = ProfileLevelAchievement & {
  completed: boolean;
};

export type ProfileLevelAchievementState = {
  completed: ProfileLevelAchievementStatus[];
  pending: ProfileLevelAchievementStatus[];
  all: ProfileLevelAchievementStatus[];
  bonusLevels: number;
};

const PROFILE_LEVEL_ACHIEVEMENT_KEY_PREFIX = 'emojipaint/profile-level-achievement';
const MULTIPAINT_STROKES_KEY = '@multiplayer_strokes';
const AR_SCENES_KEY = 'emojipaint/ar-scenes';
const GUESSED_MYSTERY_KEY = '@guessed_mystery_paintings';

export const PROFILE_LEVEL_ACHIEVEMENTS: ProfileLevelAchievement[] = [
  {
    id: 'profile_visit_3',
    title: 'Three Day Visitor',
    emoji: '✅',
    iconLevel: 33,
    requirement: 'Open your profile on 3 different days.',
    tip: 'Visit your profile for 3 days to earn a one-level bonus.',
  },
  {
    id: 'first_gallery_upload',
    title: 'Gallery Upload Artist',
    emoji: '🖼️',
    iconLevel: 3,
    requirement: 'Upload your first artwork to the gallery.',
    tip: 'Upload one finished painting to jump one level.',
  },
  {
    id: 'first_mystery_guess',
    title: 'Mystery Guess Designer',
    emoji: '🎯',
    iconLevel: 57,
    requirement: 'Solve your first mystery painting guess.',
    tip: 'Guess one mystery topic correctly for a one-level bonus.',
  },
  {
    id: 'first_profile_painter',
    title: 'Profile Portrait Painter',
    emoji: '🎨',
    iconLevel: 4,
    requirement: 'Create your first painted profile portrait.',
    tip: 'Paint or upload a profile portrait to earn a bonus level.',
  },
  {
    id: 'first_multipaint_stroke',
    title: 'MultiPaint Stroke Creator',
    emoji: '🎮',
    iconLevel: 17,
    requirement: 'Commit your first MultiPaint stroke.',
    tip: 'Draw one stroke in MultiPaint to push your profile level up by one.',
  },
  {
    id: 'first_ar_scene_13',
    title: 'AR Scene Painter',
    emoji: '📷',
    iconLevel: 24,
    requirement: 'Save your first AR painting scene with at least 13 strokes.',
    tip: 'Paint 13 strokes in AR and save the scene for a one-level bonus.',
  },
  {
    id: 'first_animator_upload',
    title: 'Animator Upload Artist',
    emoji: '🎬',
    iconLevel: 40,
    requirement: 'Upload your first Animator topic challenge.',
    tip: 'Finish and upload one Animator challenge to earn one bonus level.',
  },
  {
    id: 'coin_stack_10',
    title: 'Coin Stack Designer',
    emoji: '🪙',
    iconLevel: 5,
    requirement: 'Collect 10 coins.',
    tip: 'Collect 10 coins for an early one-level boost.',
  },
  {
    id: 'stroke_milestone_1000',
    title: 'Thousand Stroke Painter',
    emoji: '🖌️',
    iconLevel: 7,
    requirement: 'Paint 1,000 total strokes.',
    tip: 'Reach 1,000 total strokes to add one level.',
  },
  {
    id: 'time_milestone_60',
    title: 'Hour Focus Artist',
    emoji: '⏱️',
    iconLevel: 6,
    requirement: 'Paint for 60 total minutes.',
    tip: 'Reach 60 total painting minutes to add one level.',
  },
];

const keyForAchievement = (id: ProfileLevelAchievementId): string =>
  `${PROFILE_LEVEL_ACHIEVEMENT_KEY_PREFIX}/${id}`;

const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const hasStoredMultiPaintStroke = (raw: string | null): boolean => {
  const parsed = parseJson<Record<string, unknown[]>>(raw, {});
  return Object.values(parsed).some((value) => Array.isArray(value) && value.length > 0);
};

const hasStoredArSceneWith13Strokes = (raw: string | null): boolean => {
  const parsed = parseJson<Array<{ strokeCount?: unknown }>>(raw, []);
  return parsed.some((scene) => Math.floor(Number(scene.strokeCount) || 0) >= 13);
};

const hasStoredMysteryGuess = (raw: string | null): boolean => {
  const parsed = parseJson<unknown[]>(raw, []);
  return Array.isArray(parsed) && parsed.length > 0;
};

/**
 * Everything the profile LEVEL is derived from that lives only on this device.
 *
 * Collected in one place so profile sync can push it: without these a restored profile came
 * back at level 1 with every achievement lost, because time+strokes alone do not determine
 * the level. Counts are read from the same keys the level calculation itself uses, so the two
 * can never disagree.
 */
export const collectLevelSyncPayload = async (): Promise<{
  correctGuesses: number;
  multipaintStrokes: number;
  arScenes: number;
  achievements: string[];
}> => {
  const flagKeys = PROFILE_LEVEL_ACHIEVEMENTS.map((achievement) => keyForAchievement(achievement.id));
  const [flagPairs, multipaintRaw, arScenesRaw, guessedRaw] = await Promise.all([
    AsyncStorage.multiGet(flagKeys),
    AsyncStorage.getItem(MULTIPAINT_STROKES_KEY),
    AsyncStorage.getItem(AR_SCENES_KEY),
    AsyncStorage.getItem(GUESSED_MYSTERY_KEY),
  ]);
  const countJsonArray = (raw: string | null): number => {
    if (!raw) return 0;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  };
  const achievements = flagPairs
    .filter(([, value]) => value === '1')
    .map(([key]) => key.slice(PROFILE_LEVEL_ACHIEVEMENT_KEY_PREFIX.length + 1))
    .filter((id) => id.length > 0);
  return {
    correctGuesses: countJsonArray(guessedRaw),
    multipaintStrokes: countJsonArray(multipaintRaw),
    arScenes: countJsonArray(arScenesRaw),
    achievements,
  };
};

/**
 * SERVER WINS: replace the local achievement flags with exactly the restored set.
 * Anything not in `ids` is cleared, so a device cannot keep a flag the server does not have.
 */
export const restoreProfileLevelAchievements = async (ids: readonly string[]): Promise<void> => {
  const wanted = new Set(ids);
  const setPairs: [string, string][] = [];
  const clearKeys: string[] = [];
  for (const achievement of PROFILE_LEVEL_ACHIEVEMENTS) {
    const key = keyForAchievement(achievement.id);
    if (wanted.has(achievement.id)) setPairs.push([key, '1']);
    else clearKeys.push(key);
  }
  if (setPairs.length > 0) await AsyncStorage.multiSet(setPairs);
  if (clearKeys.length > 0) await AsyncStorage.multiRemove(clearKeys);
};

export const markProfileLevelAchievement = async (id: ProfileLevelAchievementId): Promise<void> => {
  await AsyncStorage.setItem(keyForAchievement(id), '1');
};

export const loadProfileLevelAchievementState = async (
  stats: ProfileLevelAchievementStats,
): Promise<ProfileLevelAchievementState> => {
  const flagKeys = PROFILE_LEVEL_ACHIEVEMENTS.map((achievement) => keyForAchievement(achievement.id));
  const [flagPairs, multipaintRaw, arScenesRaw, guessedMysteryRaw] = await Promise.all([
    AsyncStorage.multiGet(flagKeys),
    AsyncStorage.getItem(MULTIPAINT_STROKES_KEY),
    AsyncStorage.getItem(AR_SCENES_KEY),
    AsyncStorage.getItem(GUESSED_MYSTERY_KEY),
  ]);
  const localFlags = new Set(
    flagPairs
      .filter(([, value]) => value === '1')
      .map(([key]) => key.replace(`${PROFILE_LEVEL_ACHIEVEMENT_KEY_PREFIX}/`, '') as ProfileLevelAchievementId),
  );

  const completedIds = new Set<ProfileLevelAchievementId>();
  if (stats.streakDays >= 3) completedIds.add('profile_visit_3');
  if (stats.galleryCount >= 1) completedIds.add('first_gallery_upload');
  if ((stats.correctGuesses ?? 0) > 0 || hasStoredMysteryGuess(guessedMysteryRaw)) completedIds.add('first_mystery_guess');
  if (stats.hasPortrait || stats.portraitCount > 0) completedIds.add('first_profile_painter');
  if (stats.coins >= 10) completedIds.add('coin_stack_10');
  if (stats.strokeCount >= 1000) completedIds.add('stroke_milestone_1000');
  if (stats.elapsedMs >= 60 * 60_000) completedIds.add('time_milestone_60');
  if (localFlags.has('first_multipaint_stroke') || hasStoredMultiPaintStroke(multipaintRaw)) completedIds.add('first_multipaint_stroke');
  if (localFlags.has('first_ar_scene_13') || hasStoredArSceneWith13Strokes(arScenesRaw)) completedIds.add('first_ar_scene_13');
  if (localFlags.has('first_animator_upload')) completedIds.add('first_animator_upload');

  const all = PROFILE_LEVEL_ACHIEVEMENTS.map((achievement) => ({
    ...achievement,
    completed: completedIds.has(achievement.id),
  }));
  const completed = all.filter((achievement) => achievement.completed);
  const pending = all.filter((achievement) => !achievement.completed);
  return {
    completed,
    pending,
    all,
    bonusLevels: completed.length,
  };
};
