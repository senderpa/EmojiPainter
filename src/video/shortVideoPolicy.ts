export const SHORT_VIDEO_THRESHOLD_MS = 1000;
export const SHORT_VIDEO_REPLAY_PAUSE_MS = 1000;

export function getCompletionReplayDelay(durationMillis: number | null | undefined): number {
  return Number.isFinite(durationMillis) && (durationMillis as number) <= SHORT_VIDEO_THRESHOLD_MS
    ? SHORT_VIDEO_REPLAY_PAUSE_MS
    : 0;
}
