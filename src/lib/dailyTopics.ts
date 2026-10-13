import type { DailyPrompt } from '../types/dailyPrompt';
import defaultTopicsJson from '../../assets/daily_paint_topics_2025time.json';
import { getCurrentTopics } from './topicsUpdater';

interface DailyTopicsEntry {
  date: string;
  time_minutes?: number;
  topics: Array<{
    topic: string;
    emoji: string;
    translations?: Record<string, string>;
  }>;
}

let rawEntries = defaultTopicsJson as DailyTopicsEntry[];
let topicsByDate = new Map<string, DailyPrompt[]>();
let topicMetadata = new Map<string, {
  emoji: string;
  topic: string;
  timeMinutes: number;
  translations: Record<string, string>;
}>();
let topicLanguages = new Set<string>();

const normalizeTopic = (value: string): string => value.trim().toLowerCase();

// Function to process topics data
function processTopics(entries: DailyTopicsEntry[]) {
  topicsByDate.clear();
  topicMetadata.clear();
  topicLanguages.clear();

  entries.forEach((entry) => {
    const timeMinutes = entry.time_minutes ?? 30;
    const formattedTopics = entry.topics.map((topicEntry) => ({
      emoji: topicEntry.emoji,
      topic: topicEntry.topic,
      timeMinutes,
      translations: topicEntry.translations
    }));
    topicsByDate.set(entry.date, formattedTopics);

    entry.topics.forEach((topicEntry) => {
      const key = normalizeTopic(topicEntry.topic);
      if (!topicMetadata.has(key)) {
        const translations = topicEntry.translations ?? { en: topicEntry.topic };
        Object.keys(translations).forEach((language) => {
          if (language.trim().length > 0) {
            topicLanguages.add(language.trim());
          }
        });
        topicMetadata.set(key, {
          emoji: topicEntry.emoji,
          topic: topicEntry.topic,
          timeMinutes,
          translations
        });
      }
    });
  });
}

// Initialize with default topics
processTopics(rawEntries);

// Update topics from storage
let topicsInitialized = false;
async function ensureTopicsLoaded() {
  if (topicsInitialized) return;
  topicsInitialized = true;

  try {
    const updatedTopics = await getCurrentTopics();
    rawEntries = updatedTopics;
    processTopics(updatedTopics);
    console.log('[DailyTopics] Loaded updated topics');
  } catch (error) {
    console.log('[DailyTopics] Using default topics');
  }
}

/**
 * Force-reload topics from storage. Call after checkAndUpdateTopics() completes
 * so the newest server data is reflected without requiring an app restart.
 */
export async function refreshTopics(): Promise<void> {
  try {
    const updatedTopics = await getCurrentTopics();
    rawEntries = updatedTopics;
    processTopics(updatedTopics);
    console.log('[DailyTopics] Topics refreshed from storage');
  } catch (error) {
    console.log('[DailyTopics] Refresh failed, keeping current topics');
  }
}

// Start loading topics immediately
ensureTopicsLoaded();

export const FALLBACK_PROMPTS: DailyPrompt[] = [
  { emoji: '🌌', topic: 'Galactic Garden', timeMinutes: 30 },
  { emoji: '🤖', topic: 'Retro Robot Parade', timeMinutes: 30 },
  { emoji: '🐙', topic: 'Underwater Myth Creatures', timeMinutes: 30 }
];

export function getDailyPrompts(date: Date = new Date()): DailyPrompt[] {
  // Use local date instead of UTC to match phone's timezone at midnight
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const key = `${year}-${month}-${day}`;
  return topicsByDate.get(key) ?? FALLBACK_PROMPTS;
}

export const TOPIC_LANGUAGES: string[] = Array.from(topicLanguages.values()).sort((a, b) => a.localeCompare(b));

export const getTopicMetadata = (topic: string): {
  emoji: string;
  topic: string;
  timeMinutes: number;
  translations: Record<string, string>;
} | null => {
  if (!topic) {
    return null;
  }
  const entry = topicMetadata.get(normalizeTopic(topic));
  if (entry) {
    return entry;
  }
  return null;
};
