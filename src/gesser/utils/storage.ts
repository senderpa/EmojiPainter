/**
 * GESSER FEATURE - Local Storage Utilities
 *
 * AsyncStorage helpers for persisting Gesser state locally.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GesserLocalState, GesserMysteryPainting } from '../types';

const STORAGE_KEY = 'emojipaint/gesser/state';

// ============================================================================
// DEFAULT STATE
// ============================================================================

const DEFAULT_STATE: GesserLocalState = {
  lastMysteryPaintDate: undefined,
  pendingTopicReviews: [],
  lastTopicSuggestTime: undefined,
  guessedMysteryIds: [],
  cachedMysteryImages: [],
  lastCacheUpdate: undefined
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Load Gesser state from storage
 */
export async function loadGesserState(): Promise<GesserLocalState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_STATE;
    }

    const parsed = JSON.parse(raw) as GesserLocalState;

    // Merge with defaults to handle new fields
    return {
      ...DEFAULT_STATE,
      ...parsed
    };
  } catch (error) {
    console.error('[Gesser Storage] Failed to load state:', error);
    return DEFAULT_STATE;
  }
}

/**
 * Save Gesser state to storage
 */
export async function saveGesserState(state: Partial<GesserLocalState>): Promise<void> {
  try {
    const current = await loadGesserState();

    const updated: GesserLocalState = {
      ...current,
      ...state
    };

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('[Gesser Storage] Failed to save state:', error);
  }
}

/**
 * Clear all Gesser storage (for testing/reset)
 */
export async function clearGesserState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[Gesser Storage] Failed to clear state:', error);
  }
}

// ============================================================================
// SPECIFIC GETTERS/SETTERS
// ============================================================================

/**
 * Check if user has done mystery paint today
 */
export async function hasCompletedMysteryToday(): Promise<boolean> {
  const state = await loadGesserState();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  return state.lastMysteryPaintDate === today;
}

/**
 * Mark mystery paint as completed for today
 */
export async function markMysteryPaintCompleted(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await saveGesserState({ lastMysteryPaintDate: today });
}

/**
 * Check if user has already guessed a mystery image
 */
export async function hasGuessedMystery(mysteryId: number): Promise<boolean> {
  const state = await loadGesserState();
  return state.guessedMysteryIds?.includes(mysteryId) ?? false;
}

/**
 * Mark mystery image as guessed
 */
export async function markMysteryGuessed(mysteryId: number): Promise<void> {
  const state = await loadGesserState();
  const guessedIds = state.guessedMysteryIds ?? [];

  if (!guessedIds.includes(mysteryId)) {
    await saveGesserState({
      guessedMysteryIds: [...guessedIds, mysteryId]
    });
  }
}

/**
 * Check if topic suggestion is rate-limited
 */
export async function isTopicSuggestionRateLimited(): Promise<boolean> {
  const state = await loadGesserState();

  if (!state.lastTopicSuggestTime) {
    return false;
  }

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000; // 1 hour

  return state.lastTopicSuggestTime > oneHourAgo;
}

/**
 * Mark topic suggestion timestamp
 */
export async function markTopicSuggestionTime(): Promise<void> {
  await saveGesserState({ lastTopicSuggestTime: Date.now() });
}

/**
 * Cache mystery images for offline viewing
 */
export async function cacheMysteryImages(images: GesserMysteryPainting[]): Promise<void> {
  await saveGesserState({
    cachedMysteryImages: images,
    lastCacheUpdate: Date.now()
  });
}

/**
 * Get cached mystery images
 */
export async function getCachedMysteryImages(): Promise<GesserMysteryPainting[]> {
  const state = await loadGesserState();
  return state.cachedMysteryImages ?? [];
}

/**
 * Check if cache is stale (older than 5 minutes)
 */
export async function isCacheStale(): Promise<boolean> {
  const state = await loadGesserState();

  if (!state.lastCacheUpdate) {
    return true;
  }

  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;

  return state.lastCacheUpdate < fiveMinutesAgo;
}

/**
 * Add topic to pending reviews list
 */
export async function addPendingTopicReview(topicId: number): Promise<void> {
  const state = await loadGesserState();
  const pending = state.pendingTopicReviews ?? [];

  if (!pending.includes(topicId)) {
    await saveGesserState({
      pendingTopicReviews: [...pending, topicId]
    });
  }
}

/**
 * Remove topic from pending reviews list
 */
export async function removePendingTopicReview(topicId: number): Promise<void> {
  const state = await loadGesserState();
  const pending = state.pendingTopicReviews ?? [];

  await saveGesserState({
    pendingTopicReviews: pending.filter((id) => id !== topicId)
  });
}

/**
 * Get pending topic reviews
 */
export async function getPendingTopicReviews(): Promise<number[]> {
  const state = await loadGesserState();
  return state.pendingTopicReviews ?? [];
}
