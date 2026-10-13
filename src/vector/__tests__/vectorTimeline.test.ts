import { evalTimeline, sequenceFor, timelineDurationMs } from '../vectorTimeline';
import { MAX_ZOOM, VECTOR_EASING_OPTIONS } from '../vectorTypes';
import type { VectorViewpoint } from '../vectorTypes';

const views: VectorViewpoint[] = [
  { id: 'a', label: 'A', cx: 0, cy: 0, zoom: 1, holdMs: 0, durationToNextMs: 100, easing: 'linear' },
  { id: 'b', label: 'B', cx: 100, cy: 0, zoom: 1, holdMs: 0, durationToNextMs: 250, easing: 'linear' },
];

describe('vector fly timeline', () => {
  it('returns to the first view for a two-view ping-pong flight', () => {
    expect(sequenceFor(views, 'pingPong').map((view) => view.id)).toEqual(['a', 'b', 'a']);
    expect(timelineDurationMs(views, 'pingPong')).toBe(350);
  });

  it('keeps imported long/corrupt durations finite for recording', () => {
    const longViews: VectorViewpoint[] = views.map((view) => ({
      ...view,
      holdMs: Number.MAX_VALUE,
      durationToNextMs: Number.MAX_VALUE,
      zoom: Number.MAX_VALUE,
    }));
    const duration = timelineDurationMs(longViews, 'once');
    expect(Number.isFinite(duration)).toBe(true);
    const camera = evalTimeline(longViews, 'once', duration);
    expect(camera).not.toBeNull();
    expect(Number.isFinite(camera!.cx)).toBe(true);
    expect(camera!.zoom).toBe(MAX_ZOOM);
  });

  it('supports every picker curve with finite endpoint values', () => {
    for (const option of VECTOR_EASING_OPTIONS) {
      const easedViews = views.map((view) => ({ ...view, easing: option.value }));
      const atStart = evalTimeline(easedViews, 'once', 0);
      const atEnd = evalTimeline(easedViews, 'once', 100);
      expect(atStart?.cx).toBeCloseTo(0, 10);
      expect(atStart?.cy).toBeCloseTo(0, 10);
      expect(atStart?.zoom).toBeCloseTo(1, 10);
      expect(atEnd?.cx).toBeCloseTo(100, 10);
      expect(atEnd?.cy).toBeCloseTo(0, 10);
      expect(atEnd?.zoom).toBeCloseTo(1, 10);
    }
  });

  it('allows overshoot curves to move past a target before settling', () => {
    const overshootViews = views.map((view) => ({ ...view, easing: 'backOut' as const }));
    expect(evalTimeline(overshootViews, 'once', 80)!.cx).toBeGreaterThan(100);
    expect(evalTimeline(overshootViews, 'once', 100)!.cx).toBe(100);
  });
});
