/**
 * DEPRECATED - Snapshot System Removed
 *
 * This file now only exports minimal stubs for backwards compatibility
 * during refactoring. The snapshot system has been replaced with
 * stroke-replay using Metal rendering.
 *
 * See: src/native/timelapse.ts for the new system
 */

// Constants for backwards compatibility
export const DEFAULT_SNAPSHOT_PROJECT_ID = 'active-session';

// Deprecated types - kept for compilation only
export type SnapshotEventType =
  | 'strokeCommit'
  | 'undo'
  | 'redo'
  | 'clearCanvas'
  | 'traceToggle'
  | 'mirrorToggle'
  | 'brushChange'
  | 'colorChange'
  | 'importReference'
  | 'timedAuto';

// Stub object for backwards compatibility
export const snapshots = {
  query: async (...args: any[]) => {
    console.warn('snapshots.query() called but snapshot system is deprecated');
    return [];
  },

  recordEvent: async (...args: any[]) => {
    // No-op - snapshots disabled
    return undefined;
  },

  ensurePng: async (...args: any[]) => {
    console.warn('snapshots.ensurePng() called but snapshot system is deprecated');
    return null;
  },

  clearProject: async (...args: any[]) => {
    // No-op
  },
};
