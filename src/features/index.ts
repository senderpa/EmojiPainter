/**
 * EmojiPaint feature modules.
 *
 * Each feature = one custom hook (state + handlers) + one pure overlay component.
 * PaintScreen imports and mounts these; it no longer owns their logic.
 *
 * EXTRACTION STATUS (as of initial modularization):
 *   ✅ Structure created — skeleton hooks and components exist
 *   🔄 Code extraction in progress — see each feature's README.md
 *
 * @see ARCHITECTURE.md for the full modularization guide
 */

// Features (export from their own index once extracted)
export * from './animator';
export * from './leaderboard';
export * from './gallery';
export * from './private-studio';
export * from './info-panel';
export * from './onboarding';
export * from './challenge';
