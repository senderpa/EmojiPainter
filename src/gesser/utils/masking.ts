/**
 * GESSER FEATURE - Topic Masking Logic
 *
 * Implements deterministic topic masking. Short topics reveal two letters,
 * medium topics reveal three, and longer topics reveal three or four. The
 * same positions are revealed for every viewer of a topic.
 */

import type { GesserMaskResult } from '../types';

/**
 * Generate deterministic masked topic string
 *
 * Reveals exactly 2 letters consistently for all users based on topic ID.
 * Spaces are always visible. Punctuation is visible.
 *
 * @param topic The topic text to mask
 * @param topicId Topic ID (used as seed for deterministic randomness)
 * @returns Masked topic and revealed positions
 *
 * @example
 * maskTopic("Space Whale", 123)
 * // => { masked: "__ __ a c e   w __ __ l e", revealedPositions: [2, 10] }
 */
export function maskTopic(topic: string, topicId?: number | null): GesserMaskResult {
  // Split into characters (handle Unicode properly)
  const chars = Array.from(topic);

  // Find all letter positions
  const letterPositions: number[] = [];

  chars.forEach((char, index) => {
    // Check if character is a letter (Unicode-aware)
    if (/\p{L}/u.test(char)) {
      letterPositions.push(index);
    }
  });

  const letterCount = letterPositions.length;

  // If no letters, return original
  if (letterCount === 0) {
    return {
      masked: topic,
      revealedPositions: []
    };
  }

  // Keep the reveal curve useful for guessing while making the longer
  // user-created topics a little less opaque. A topic ID of 0 (or no ID) is
  // deliberately treated as "no seed": local/fallback topics then still
  // produce a stable mask based on their text.
  const revealCount = revealCountForLetterCount(letterCount, topic, topicId);
  const seed = maskSeed(topic, topicId);
  const revealedPositions = chooseDistinctPositions(letterPositions, revealCount, seed);

  // Build masked string
  const masked = chars
    .map((char, index) => {
      if (char === ' ') {
        // Always show spaces
        return ' ';
      } else if (revealedPositions.includes(index)) {
        // Show revealed letters (lowercase)
        return char.toLowerCase();
      } else if (/\p{L}/u.test(char)) {
        // Mask letters with underscores
        return '_';
      } else {
        // Show other characters (punctuation, etc.)
        return char;
      }
    })
    .join('');

  return {
    masked,
    revealedPositions
  };
}

/**
 * Return the number of letters to reveal for a topic. Exported so the app,
 * gallery and upload code can display the same policy without duplicating it.
 */
export function mysteryRevealCount(letterCount: number, seed = 0): number {
  if (!Number.isFinite(letterCount) || letterCount <= 0) return 0;
  const count = Math.floor(letterCount);
  if (count <= 8) return Math.min(2, count);
  if (count <= 16) return Math.min(3, count);
  // The seeded choice makes the occasional fourth letter deterministic for
  // all viewers, rather than changing every time the card is rendered.
  return Math.min(count, 3 + (Math.abs(Math.trunc(seed)) % 2));
}

function hashTopic(topic: string): number {
  // FNV-1a, kept in uint32 arithmetic for identical results on iOS/Android.
  let hash = 2166136261;
  for (const char of topic) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function maskSeed(topic: string, topicId?: number | null): number {
  if (typeof topicId === 'number' && Number.isFinite(topicId) && topicId !== 0) {
    return Math.abs(Math.trunc(topicId)) >>> 0;
  }
  return hashTopic(topic);
}

function revealCountForLetterCount(letterCount: number, topic: string, topicId?: number | null): number {
  const seed = maskSeed(topic, topicId);
  return mysteryRevealCount(letterCount, seed);
}

function chooseDistinctPositions(positions: number[], count: number, seed: number): number[] {
  const remaining = [...positions];
  const chosen: number[] = [];
  let state = seed >>> 0;

  while (chosen.length < count && remaining.length > 0) {
    // LCG gives a small, deterministic PRNG without relying on platform
    // Math.random implementations. Removing each chosen item guarantees
    // there are never duplicate reveal positions.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const index = state % remaining.length;
    chosen.push(remaining.splice(index, 1)[0]);
  }

  return chosen.sort((a, b) => a - b);
}

export interface ManualMysteryTopicValidation {
  valid: boolean;
  normalizedTopic: string;
  error: string | null;
}

/** Normalize a user-entered mystery topic without silently removing invalid characters. */
export function normalizeManualMysteryTopic(topic: string): string {
  return topic.trim().replace(/ +/g, ' ');
}

/**
 * Validate and normalize a manually supplied Mystery Challenge topic.
 *
 * Only ASCII English letters and ordinary spaces are accepted. The length is
 * measured after trimming/collapsing spaces, so the value sent to the server
 * is exactly the value users saw accepted in the picker.
 */
export function validateManualMysteryTopic(topic: string): ManualMysteryTopicValidation {
  const normalizedTopic = normalizeManualMysteryTopic(topic);
  if (normalizedTopic.length < 1) {
    return { valid: false, normalizedTopic, error: 'Enter a topic (1–20 characters).' };
  }
  if (normalizedTopic.length > 20) {
    return { valid: false, normalizedTopic, error: 'Topic must be 20 characters or fewer.' };
  }
  if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(normalizedTopic)) {
    return { valid: false, normalizedTopic, error: 'Use English letters and spaces only.' };
  }
  return { valid: true, normalizedTopic, error: null };
}

/** Convenience predicate for submit buttons and API guards. */
export function isValidManualMysteryTopic(topic: string): boolean {
  return validateManualMysteryTopic(topic).valid;
}

// Names used by the Mystery picker. Keep the more descriptive manual-topic
// APIs above as the canonical implementation, while exposing these aliases so
// UI code does not need to know where the shared validation lives.
export function normalizeCustomMysteryTopicInput(raw: string): string {
  return normalizeManualMysteryTopic(raw);
}

/**
 * Prepare text while it is being typed. Unlike submit normalization this
 * deliberately preserves one trailing space, so a user can start the next
 * word in a native TextInput without the caret jumping backwards.
 */
export function cleanCustomMysteryTopicInput(raw: string): string {
  return raw
    .replace(/[^A-Za-z ]/g, '')
    .replace(/ {2,}/g, ' ')
    .slice(0, 20);
}

export function validateCustomMysteryTopic(raw: string): {
  valid: boolean;
  normalized: string;
  error: string | null;
} {
  const result = validateManualMysteryTopic(raw);
  return {
    valid: result.valid,
    normalized: result.normalizedTopic,
    error: result.error,
  };
}

/**
 * Format masked topic for display with spacing
 *
 * Adds spaces between underscores for better readability.
 *
 * @example
 * formatMaskedTopic("__ __ a c e   w __ __ l e")
 * // => "_ _ a c e   w _ _ l e"
 */
export function formatMaskedTopic(masked: string): string {
  return masked
    .replace(/_+/g, run => Array.from(run).join(' '))
    .replace(/\s+/g, ' ');
}

/**
 * Check if two topics match (case-insensitive, normalized)
 */
export function topicsMatch(guess: string, actual: string): boolean {
  const normalize = (str: string) =>
    str
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  return normalize(guess) === normalize(actual);
}

/**
 * Validate topic format
 *
 * Rules:
 * - 1-3 words only
 * - 2-50 characters
 * - Must contain at least one letter
 */
export function validateTopicFormat(topic: string): {
  valid: boolean;
  error: string | null;
} {
  const trimmed = topic.trim();

  if (trimmed.length < 2) {
    return { valid: false, error: 'Topic too short (min 2 characters)' };
  }

  if (trimmed.length > 50) {
    return { valid: false, error: 'Topic too long (max 50 characters)' };
  }

  // Count words
  const words = trimmed.split(/\s+/);
  const wordCount = words.length;

  if (wordCount < 1) {
    return { valid: false, error: 'Topic must contain at least 1 word' };
  }

  if (wordCount > 3) {
    return { valid: false, error: 'Topic must be maximum 3 words' };
  }

  // Must contain at least one letter
  if (!/\p{L}/u.test(trimmed)) {
    return { valid: false, error: 'Topic must contain at least one letter' };
  }

  return { valid: true, error: null };
}

/**
 * Normalize topic for duplicate detection
 */
export function normalizeTopic(topic: string): string {
  return topic
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '');
}
