import AsyncStorage from '@react-native-async-storage/async-storage';

const LEVEL_STREAK_KEY = 'emojipaint/profile-level/daily-streak:v1';

export type LocalLevelStreak = {
  days: number;
  lastDate: string | null;
  notifiedThreeDay: boolean;
};

const todayKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const previousDayKey = (date = new Date()): string => {
  const previous = new Date(date);
  previous.setDate(previous.getDate() - 1);
  return todayKey(previous);
};

const parseStoredStreak = (raw: string | null): LocalLevelStreak => {
  if (!raw) return { days: 0, lastDate: null, notifiedThreeDay: false };
  try {
    const parsed = JSON.parse(raw) as Partial<LocalLevelStreak>;
    return {
      days: Math.max(0, Math.floor(Number(parsed.days) || 0)),
      lastDate: typeof parsed.lastDate === 'string' ? parsed.lastDate : null,
      notifiedThreeDay: parsed.notifiedThreeDay === true,
    };
  } catch {
    return { days: 0, lastDate: null, notifiedThreeDay: false };
  }
};

export async function loadLocalLevelStreak(): Promise<LocalLevelStreak> {
  try {
    return parseStoredStreak(await AsyncStorage.getItem(LEVEL_STREAK_KEY));
  } catch {
    return { days: 0, lastDate: null, notifiedThreeDay: false };
  }
}

export async function updateLocalLevelStreak(date = new Date()): Promise<LocalLevelStreak> {
  const current = await loadLocalLevelStreak();
  const today = todayKey(date);
  if (current.lastDate === today) {
    return current;
  }

  const days = current.lastDate === previousDayKey(date) ? current.days + 1 : 1;
  const next = {
    days,
    lastDate: today,
    notifiedThreeDay: days >= 3 ? current.notifiedThreeDay : false,
  };
  await AsyncStorage.setItem(LEVEL_STREAK_KEY, JSON.stringify(next));
  return next;
}

export async function markLocalLevelStreakThreeDayNotified(): Promise<void> {
  const current = await loadLocalLevelStreak();
  await AsyncStorage.setItem(LEVEL_STREAK_KEY, JSON.stringify({ ...current, notifiedThreeDay: true }));
}


/**
 * Restore a streak from the server, LAST-WRITE-WINS BY DATE.
 *
 * A streak legitimately resets to 0 when a day is missed, so it must NOT be max-merged the way
 * strokes and coins are — that would freeze a broken streak at its old high forever. The record
 * with the newer lastDate wins; ties keep the local value, since the device is the one still
 * counting today.
 */
export async function restoreLocalLevelStreak(
  serverDays: number,
  serverLastDate: string | null,
): Promise<void> {
  if (!serverLastDate) {
    return;
  }
  const local = await loadLocalLevelStreak();
  if (local.lastDate && local.lastDate >= serverLastDate) {
    return;
  }
  await AsyncStorage.setItem(
    LEVEL_STREAK_KEY,
    JSON.stringify({
      days: Math.max(0, Math.floor(serverDays)),
      lastDate: serverLastDate,
      notifiedThreeDay: local.notifiedThreeDay,
    }),
  );
}
