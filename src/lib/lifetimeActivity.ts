import { AppState, type AppStateStatus } from 'react-native';

import { recordLifetimeDuration, type LifetimeWorkspace } from './lifetimeStats';

type ActivityClaim = {
  id: number;
  sequence: number;
  workspace: LifetimeWorkspace;
};

type ActivitySegment = {
  claimId: number;
  eventId: string;
  startedAt: number;
  workspace: LifetimeWorkspace;
};

const claims = new Map<number, ActivityClaim>();
let nextClaimId = 1;
let nextSequence = 1;
let activeSegment: ActivitySegment | null = null;
let appState: AppStateStatus = AppState.currentState;
let subscription: { remove(): void } | null = null;
let checkpointTimer: ReturnType<typeof setInterval> | null = null;
const CHECKPOINT_INTERVAL_MS = 30_000;

const settle = (pending: Promise<void> | null) => {
  pending?.catch(error => console.warn('[LifetimeStats] Could not persist active duration', error));
};

const topClaim = (): ActivityClaim | null => {
  let result: ActivityClaim | null = null;
  claims.forEach(claim => {
    if (!result || claim.sequence > result.sequence) result = claim;
  });
  return result;
};

const finishActiveSegment = (now: number): Promise<void> | null => {
  const segment = activeSegment;
  activeSegment = null;
  if (!segment || now <= segment.startedAt) return null;
  return recordLifetimeDuration({
    eventId: segment.eventId,
    workspace: segment.workspace,
    durationMs: now - segment.startedAt,
  }).then(() => undefined);
};

const updateCheckpointTimer = () => {
  if (activeSegment && !checkpointTimer) {
    checkpointTimer = setInterval(() => settle(checkpointActiveSegment()), CHECKPOINT_INTERVAL_MS);
  } else if (!activeSegment && checkpointTimer) {
    clearInterval(checkpointTimer);
    checkpointTimer = null;
  }
};

const checkpointActiveSegment = (now = Date.now()): Promise<void> | null => {
  const pending = finishActiveSegment(now);
  const claim = topClaim();
  if (appState === 'active' && claim) {
    activeSegment = {
      claimId: claim.id,
      workspace: claim.workspace,
      startedAt: now,
      eventId: `activity:${claim.workspace}:${now}:${nextSequence++}`,
    };
  }
  updateCheckpointTimer();
  return pending;
};

const reconcile = (now = Date.now()): Promise<void> | null => {
  const claim = topClaim();
  const shouldRun = appState === 'active' && claim != null;
  const currentMatches =
    shouldRun && activeSegment != null && activeSegment.claimId === claim?.id;
  if (currentMatches) return null;

  const pending = finishActiveSegment(now);
  if (shouldRun && claim) {
    activeSegment = {
      claimId: claim.id,
      workspace: claim.workspace,
      startedAt: now,
      eventId: `activity:${claim.workspace}:${now}:${nextSequence++}`,
    };
  }
  updateCheckpointTimer();
  return pending;
};

const ensureAppStateSubscription = () => {
  if (subscription) return;
  subscription = AppState.addEventListener('change', nextState => {
    appState = nextState;
    settle(reconcile());
  });
};

export const getActiveLifetimeWorkspace = (): LifetimeWorkspace | null =>
  activeSegment?.workspace ?? topClaim()?.workspace ?? null;

/**
 * Claims lifetime-time ownership for a visible workspace. The newest visible
 * workspace wins, so an AR/vector/framer overlay pauses the still-mounted main
 * painter instead of both timers running at once.
 */
export const startLifetimeActivity = (workspace: LifetimeWorkspace): (() => void) => {
  ensureAppStateSubscription();
  const id = nextClaimId++;
  claims.set(id, { id, sequence: nextSequence++, workspace });
  settle(reconcile());

  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims.delete(id);
    settle(reconcile());
  };
};

/** Flush the current interval before uploads or explicit persistence. */
export const flushLifetimeActivity = async (): Promise<void> => {
  const pending = checkpointActiveSegment();
  await pending;
};

export const __resetLifetimeActivityForTests = () => {
  claims.clear();
  activeSegment = null;
  appState = AppState.currentState;
  nextClaimId = 1;
  nextSequence = 1;
  if (checkpointTimer) clearInterval(checkpointTimer);
  checkpointTimer = null;
  subscription?.remove();
  subscription = null;
};
