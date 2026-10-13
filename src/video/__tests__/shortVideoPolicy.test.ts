import {
  SHORT_VIDEO_REPLAY_PAUSE_MS,
  getCompletionReplayDelay,
} from '../shortVideoPolicy';

describe('short-video replay policy', () => {
  it.each([250, 999, 1000])('pauses before replaying a %d ms clip', (duration) => {
    expect(getCompletionReplayDelay(duration)).toBe(SHORT_VIDEO_REPLAY_PAUSE_MS);
  });

  it.each([1001, 30_000, null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'replays a non-short or unknown clip without the short pause (%s)',
    (duration) => {
      expect(getCompletionReplayDelay(duration)).toBe(0);
    },
  );
});
