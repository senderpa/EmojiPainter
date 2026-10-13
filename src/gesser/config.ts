/**
 * GESSER FEATURE - Configuration & Feature Flags
 */

import type { GesserFeatureFlags } from './types';

/**
 * Gesser feature flags
 *
 * Enable/disable specific Gesser features without modifying code.
 */
export const GESSER_FEATURE_FLAGS: GesserFeatureFlags = {
  // Master switch for entire Gesser feature
  enabled: true,

  // Topic suggestion & approval system
  topicSuggestions: true,

  // Mystery topic paint (4th daily option)
  mysteryPaint: true,

  // Guess a topic game
  guessGame: true,

  // Friends & user discovery
  socialFeatures: true
};

/**
 * Gesser configuration constants
 */
export const GESSER_CONFIG = {
  // API base URL
  apiBase: 'https://emojipainter.com/api/gesser',

  // UI limits
  maxTopicLength: 50,
  minTopicLength: 2,
  maxTopicWords: 2,

  // Caching
  cacheStaleMs: 5 * 60 * 1000, // 5 minutes

  // Rate limits (client-side hints)
  topicSubmitCooldownMs: 60 * 60 * 1000, // 1 hour
  guessCooldownMs: 1000, // 1 second between guesses

  // Mystery images per page
  mysteryImagesPerPage: 20,

  // User discovery per page
  usersPerPage: 50,

  // Coin reward amounts (for display only, server is authoritative)
  coins: {
    topicSubmit: 10,
    topicApproved: 20,
    topicReview: 5,
    guessCorrect: 10,
    mysteryPaint: 15
  }
} as const;

/**
 * Check if Gesser feature is enabled
 */
export function isGesserEnabled(): boolean {
  return GESSER_FEATURE_FLAGS.enabled;
}

/**
 * Check if specific Gesser sub-feature is enabled
 */
export function isGesserFeatureEnabled(
  feature: keyof Omit<GesserFeatureFlags, 'enabled'>
): boolean {
  return GESSER_FEATURE_FLAGS.enabled && GESSER_FEATURE_FLAGS[feature];
}
