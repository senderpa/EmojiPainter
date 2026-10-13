/**
 * GESSER FEATURE - Mystery Topic Picker
 *
 * Central logic for picking the two mystery-topic choices shown in the
 * picker overlay. Guarantees:
 * - Topics already shown to this user are never re-shown (persisted in
 *   AsyncStorage, oldest entries expire once the history grows large so
 *   the pool never runs dry).
 * - The two slots never show the same topic.
 * - Falls back to the curated PREPARED_TOPICS pool when the API is
 *   unavailable or keeps returning already-used topics.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import GesserApi from './api/gesserClient';
import { PREPARED_TOPICS } from './preparedTopics';

export interface MysteryTopicChoice {
  topicId: number;
  topic: string;
  timeMinutes: number;
}

const USED_TOPICS_KEY = '@mystery_used_topics';

// Keep history below the prepared-pool size so fallback picking always
// has fresh topics available; oldest entries are dropped first.
const MAX_USED_HISTORY = Math.max(100, PREPARED_TOPICS.length - 100);

// How many times we re-ask the API when it returns a used/duplicate topic.
const MAX_API_ATTEMPTS = 4;

const normalizeTopic = (topic: string): string => topic.trim().toLowerCase();

const randomTimeMinutes = (): number => Math.floor(Math.random() * 8) + 2;

/**
 * Load the set of already-shown topic keys from storage.
 * Returns an empty set on any storage/parse error.
 */
export async function loadUsedTopics(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(USED_TOPICS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

/**
 * Persist newly shown topics, trimming the oldest entries when the
 * history exceeds MAX_USED_HISTORY.
 */
export async function markTopicsUsed(previous: string[], shown: string[]): Promise<void> {
  try {
    const merged = [...previous, ...shown.map(normalizeTopic)];
    const deduped = Array.from(new Set(merged));
    const trimmed = deduped.slice(Math.max(0, deduped.length - MAX_USED_HISTORY));
    await AsyncStorage.setItem(USED_TOPICS_KEY, JSON.stringify(trimmed));
  } catch {
    // Non-fatal: worst case a topic re-appears later.
  }
}

/**
 * Clear the shown-topic history (e.g. for debugging or user reset).
 */
export async function resetUsedTopics(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USED_TOPICS_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Pick `count` prepared topics that are not in `exclude`.
 * If the exclusion list exhausts the pool, it is ignored (except for
 * topics picked this round) so the picker never comes up empty.
 */
function pickPreparedTopics(count: number, exclude: Set<string>): string[] {
  let available = PREPARED_TOPICS.filter(t => !exclude.has(normalizeTopic(t)));
  if (available.length < count) {
    available = [...PREPARED_TOPICS];
  }
  const picked: string[] = [];
  const pickedKeys = new Set<string>();
  // Fisher-Yates shuffle, then take the first `count` distinct topics.
  const pool = [...available];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const candidate of pool) {
    if (picked.length >= count) break;
    const key = normalizeTopic(candidate);
    if (!pickedKeys.has(key)) {
      pickedKeys.add(key);
      picked.push(candidate);
    }
  }
  return picked;
}

/**
 * Fetch two distinct, never-before-shown mystery topics.
 * Tries the API first (re-asking when it returns used/duplicate topics),
 * then fills remaining slots from the prepared pool. The returned topics
 * are recorded as used so they will not be shown again.
 */
export async function getMysteryTopicPair(deviceId: string): Promise<MysteryTopicChoice[]> {
  const usedList = await loadUsedTopics();
  const used = new Set(usedList);
  const pickedKeys = new Set<string>();
  const picked: MysteryTopicChoice[] = [];

  try {
    for (let attempt = 0; attempt < MAX_API_ATTEMPTS && picked.length < 2; attempt++) {
      const response = await GesserApi.getRandomMysteryTopic(deviceId);
      const topic = typeof response?.topic === 'string' ? response.topic.trim() : '';
      if (!topic || !response.topicId) continue;
      const key = normalizeTopic(topic);
      if (used.has(key) || pickedKeys.has(key)) continue;
      pickedKeys.add(key);
      picked.push({ topicId: response.topicId, topic, timeMinutes: randomTimeMinutes() });
    }
  } catch {
    // API unreachable — fall through to prepared topics.
  }

  if (picked.length < 2) {
    const exclude = new Set([...used, ...pickedKeys]);
    const fill = pickPreparedTopics(2 - picked.length, exclude);
    fill.forEach((topic, index) => {
      pickedKeys.add(normalizeTopic(topic));
      // Negative IDs mark prepared (non-API) topics.
      picked.push({ topicId: -(index + 1), topic, timeMinutes: randomTimeMinutes() });
    });
  }

  await markTopicsUsed(usedList, picked.map(p => p.topic));
  return picked;
}
