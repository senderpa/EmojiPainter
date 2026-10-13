import { clampZoom, interpolateZoomLog } from './vectorCamera';
import { VECTOR_EASING_OPTIONS, VectorCameraState, VectorLoopMode, VectorViewpoint } from './vectorTypes';

// Deterministic timeline evaluator (handoff IOS_VECTOR_ARCHITECTURE.md §Viewpoints):
// given an EXACT time it returns a camera state — preview and export share it, so
// the same timestamp always yields the same frame (no wall-clock drift).
// A segment is either a HOLD at a viewpoint or a MOVE between two viewpoints;
// position interpolates linearly, zoom in log space, with per-segment easing.

interface Segment {
  startMs: number;
  endMs: number;
  from: VectorViewpoint;
  to: VectorViewpoint;
  kind: 'hold' | 'move';
}

// A JS number can represent this duration exactly enough for any realistic
// phone recording (many years), while preventing corrupt imported documents
// from turning the timeline into Infinity/NaN and trapping the exporter.
const MAX_TIMELINE_MS = Number.MAX_SAFE_INTEGER;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, MAX_TIMELINE_MS) : 0;
}

function safeAdd(start: number, duration: number): number {
  return Math.min(MAX_TIMELINE_MS, start + finiteNonNegative(duration));
}

function normaliseViewpoint(view: VectorViewpoint): VectorViewpoint {
  return {
    ...view,
    cx: Number.isFinite(view.cx) ? view.cx : 0,
    cy: Number.isFinite(view.cy) ? view.cy : 0,
    zoom: clampZoom(view.zoom),
    holdMs: finiteNonNegative(view.holdMs),
    durationToNextMs: finiteNonNegative(view.durationToNextMs),
    // Unknown values from an older or hand-edited document remain safe and
    // predictable instead of making the timeline evaluator throw.
    easing: VECTOR_EASING_OPTIONS.some((option) => option.value === view.easing) ? view.easing : 'linear',
  };
}

function easeInQuad(t: number): number {
  return t * t;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function applyEasing(t: number, easing: VectorViewpoint['easing']): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const backOut = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  const backInOut = t < 0.5
    ? (Math.pow(2 * t, 2) * ((c1 * 1.525 + 1) * 2 * t - c1 * 1.525)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c1 * 1.525 + 1) * (t * 2 - 2) + c1 * 1.525) + 2) / 2;
  const bounceOut = (value: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (value < 1 / d1) return n1 * value * value;
    if (value < 2 / d1) {
      const adjusted = value - 1.5 / d1;
      return n1 * adjusted * adjusted + 0.75;
    }
    if (value < 2.5 / d1) {
      const adjusted = value - 2.25 / d1;
      return n1 * adjusted * adjusted + 0.9375;
    }
    const adjusted = value - 2.625 / d1;
    return n1 * adjusted * adjusted + 0.984375;
  };
  const bounceInOut = t < 0.5
    ? (1 - bounceOut(1 - 2 * t)) / 2
    : (1 + bounceOut(2 * t - 1)) / 2;
  const elasticOut = t === 0 || t === 1
    ? t
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

  switch (easing) {
    case 'easeIn':
    case 'easeInQuad': return easeInQuad(t);
    case 'easeOut':
    case 'easeOutQuad': return easeOutQuad(t);
    // `easeInOut` was the original Vector easing and used a cubic curve.
    // Keep that behavior for existing saved projects; the explicit quadratic
    // variant is available as `easeInOutQuad`.
    case 'easeInOut': return easeInOutCubic(t);
    case 'easeInOutQuad': return easeInOutQuad(t);
    case 'easeInCubic': return easeInCubic(t);
    case 'easeOutCubic': return easeOutCubic(t);
    case 'easeInOutCubic': return easeInOutCubic(t);
    case 'backOut': return backOut;
    case 'backInOut': return backInOut;
    case 'bounceOut': return bounceOut(t);
    case 'bounceInOut': return bounceInOut;
    case 'elasticOut': return elasticOut;
    case 'linear':
    default: return t;
  }
}

/** The ordered sequence of viewpoints for a loop mode. Ping-pong returns to the first view. */
export function sequenceFor(views: VectorViewpoint[], loop: VectorLoopMode): VectorViewpoint[] {
  if (views.length <= 1) return views;
  if (loop === 'pingPong') {
    // Keep the end points out of the *turnaround* duplicate, but include the
    // first view at the end so a two-view flight actually flies back instead
    // of silently behaving like `once`.
    const back = views.slice(0, -1).reverse();
    return [...views, ...back];
  }
  if (loop === 'loop') return [...views, views[0]];
  return views;
}

export function buildSegments(views: VectorViewpoint[], loop: VectorLoopMode): Segment[] {
  const seq = sequenceFor(views, loop).map(normaliseViewpoint);
  const segments: Segment[] = [];
  let t = 0;
  for (let i = 0; i < seq.length; i += 1) {
    const v = seq[i];
    const hold = finiteNonNegative(v.holdMs);
    if (hold > 0) {
      const end = safeAdd(t, hold);
      segments.push({ startMs: t, endMs: end, from: v, to: v, kind: 'hold' });
      t = end;
    }
    const next = seq[i + 1];
    const duration = finiteNonNegative(v.durationToNextMs);
    if (next && duration > 0) {
      const end = safeAdd(t, duration);
      segments.push({ startMs: t, endMs: end, from: v, to: next, kind: 'move' });
      t = end;
    }
  }
  return segments;
}

export function timelineDurationMs(views: VectorViewpoint[], loop: VectorLoopMode): number {
  const segs = buildSegments(views, loop);
  return segs.length > 0 ? segs[segs.length - 1].endMs : 0;
}

export function evalTimeline(
  views: VectorViewpoint[],
  loop: VectorLoopMode,
  timeMs: number
): VectorCameraState | null {
  if (views.length === 0) return null;
  if (views.length === 1) {
    const view = normaliseViewpoint(views[0]);
    return { cx: view.cx, cy: view.cy, zoom: view.zoom };
  }
  const segs = buildSegments(views, loop);
  if (segs.length === 0) {
    const view = normaliseViewpoint(views[0]);
    return { cx: view.cx, cy: view.cy, zoom: view.zoom };
  }
  const total = segs[segs.length - 1].endMs;
  const safeTime = Number.isFinite(timeMs) ? timeMs : 0;
  const clamped = Math.max(0, Math.min(safeTime, total));
  const seg = segs.find((s) => clamped >= s.startMs && clamped <= s.endMs) ?? segs[segs.length - 1];
  if (seg.kind === 'hold' || seg.endMs <= seg.startMs) {
    return { cx: seg.from.cx, cy: seg.from.cy, zoom: seg.from.zoom };
  }
  const raw = (clamped - seg.startMs) / (seg.endMs - seg.startMs);
  const t = applyEasing(raw, seg.from.easing);
  return {
    // Position relative to the segment's own origin, per the handoff.
    cx: seg.from.cx + (seg.to.cx - seg.from.cx) * t,
    cy: seg.from.cy + (seg.to.cy - seg.from.cy) * t,
    zoom: interpolateZoomLog(seg.from.zoom, seg.to.zoom, t),
  };
}
