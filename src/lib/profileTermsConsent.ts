import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Single source of truth for AGB / terms acceptance.
 *
 * There used to be no single source: the consent sheet was raised ad hoc from
 * Profile, Profil Studio, Settings, topic selection, mystery topics and the
 * challenge flow. A fresh user who had never opened Profile could tap a topic
 * and get nothing useful back. Acceptance is now collected once, by the
 * first-launch intro (`features/onboarding/CinematicIntro`), before the app
 * proper is reachable — every other feature simply trusts this flag.
 *
 * The storage key and the version string are deliberately UNCHANGED so that
 * everyone who already accepted these terms keeps their acceptance and never
 * sees the intro again. See `migrateAgbAcceptance` for the upgrade path.
 */

/** Bump this when the terms change materially — that forces re-acceptance. */
export const CURRENT_AGB_VERSION = '2026-07-30-content-licence-v2';

/** @deprecated Kept as the historic name; identical to {@link CURRENT_AGB_VERSION}. */
export const PROFILE_TERMS_VERSION = CURRENT_AGB_VERSION;

export const PROFILE_TERMS_ACCEPTED_KEY = 'emojipaint/profile/terms-accepted:v1';
export const PROFILE_TERMS_ACCEPTED_AT_KEY = 'emojipaint/profile/terms-accepted-at:v1';

/**
 * Result of reading acceptance, keeping "this device never accepted" distinct
 * from "storage could not answer".
 *
 * The two must not be conflated. The first-launch gate treats both as "show the
 * intro" (fail closed — never wave an unknown device through). The in-app safety
 * net treats only `missing` as a reason to re-gate, so a transient storage error
 * cannot yank a user who already accepted back into the intro mid-session.
 */
export type AgbAcceptanceState = 'accepted' | 'missing' | 'unavailable';

/**
 * Read acceptance, migrating any earlier recorded version onto
 * {@link CURRENT_AGB_VERSION} on the way.
 *
 * The accepted key is only ever written by {@link acceptAgb}, so ANY non-empty
 * value means this user genuinely accepted at some point. Rather than dragging
 * those users back through the intro, their acceptance is carried forward and
 * the original acceptance timestamp is preserved.
 */
export async function readAgbAcceptanceState(): Promise<AgbAcceptanceState> {
  try {
    const stored = await AsyncStorage.getItem(PROFILE_TERMS_ACCEPTED_KEY);
    if (!stored) return 'missing';          // fresh install / never accepted
    if (stored === CURRENT_AGB_VERSION) return 'accepted';

    // Legacy acceptance of an older version string — carry it forward.
    const acceptedAt =
      (await AsyncStorage.getItem(PROFILE_TERMS_ACCEPTED_AT_KEY)) ?? new Date().toISOString();
    await AsyncStorage.multiSet([
      [PROFILE_TERMS_ACCEPTED_KEY, CURRENT_AGB_VERSION],
      [PROFILE_TERMS_ACCEPTED_AT_KEY, acceptedAt],
    ]);
    return 'accepted';
  } catch (error) {
    console.warn('[AGB] Failed to read terms acceptance:', error);
    return 'unavailable';
  }
}

/** @deprecated Prefer {@link readAgbAcceptanceState}; kept for the historic name. */
export async function migrateAgbAcceptance(): Promise<boolean> {
  return (await readAgbAcceptanceState()) === 'accepted';
}

/**
 * Has this device accepted the current AGB version?
 *
 * Runs the legacy migration first, so a user upgrading from an older build is
 * never asked twice. Fails CLOSED (returns false) on a storage error, which
 * shows the intro again rather than silently treating an unknown device as
 * having consented.
 */
export async function hasAcceptedAgb(): Promise<boolean> {
  return (await readAgbAcceptanceState()) === 'accepted';
}

/** Record acceptance of the current AGB version. */
export async function acceptAgb(): Promise<void> {
  const acceptedAt = new Date().toISOString();
  await AsyncStorage.multiSet([
    [PROFILE_TERMS_ACCEPTED_KEY, CURRENT_AGB_VERSION],
    [PROFILE_TERMS_ACCEPTED_AT_KEY, acceptedAt],
  ]);
}

// ── Historic names ───────────────────────────────────────────────────────────
// Still used by profileSync / notificationService, which legitimately want to
// know whether consent exists (they do not gate the UI on it any more).

export const hasAcceptedProfileTerms = hasAcceptedAgb;
export const acceptProfileTerms = acceptAgb;
