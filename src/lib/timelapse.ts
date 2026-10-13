import type { Stroke } from '../state/PaintingContext';

export type PlaybackMode = 'historical' | 'sequential' | 'simultaneous';

export interface BuildTimelineOptions {
  skipIdle?: boolean;
  idleThresholdMs?: number;
  minPointDeltaMs?: number;
}

interface ModeTimeline {
  duration: number;
  pointTimes: number[][];
}

export interface TimelineData {
  strokes: Stroke[];
  modes: Record<PlaybackMode, ModeTimeline>;
  totalPoints: number;
}

interface StrokeTimelineInfo {
  stroke: Stroke;
  normalizedPointTimes: number[];
  baseDuration: number;
  rawStart: number;
}

const DEFAULT_IDLE_THRESHOLD_MS = 320;
const DEFAULT_MIN_POINT_DELTA_MS = 16;

function cloneStroke(stroke: Stroke): Stroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
    emojiSequence: stroke.emojiSequence ? stroke.emojiSequence.slice() : undefined
  };
}

function buildStrokeTimelineInfo(
  stroke: Stroke,
  globalStart: number,
  minPointDelta: number
): StrokeTimelineInfo {
  if (stroke.points.length === 0) {
    return {
      stroke: cloneStroke(stroke),
      normalizedPointTimes: [],
      baseDuration: 0,
      rawStart: 0
    };
  }

  const clonedPoints = stroke.points.map((point) => ({ ...point }));
  const firstTimestamp = clonedPoints[0]?.t ?? 0;
  const normalizedPointTimes: number[] = [];
  let previousTime = 0;

  clonedPoints.forEach((point, index) => {
    const relative = Math.max(0, Math.round((point.t ?? firstTimestamp) - firstTimestamp));
    if (index === 0) {
      normalizedPointTimes.push(0);
      previousTime = 0;
      return;
    }
    const nextTime = Math.max(relative, previousTime + minPointDelta);
    normalizedPointTimes.push(nextTime);
    previousTime = nextTime;
  });

  const baseDuration = normalizedPointTimes[normalizedPointTimes.length - 1] ?? 0;
  const rawStart = Math.max(0, Math.round((firstTimestamp ?? globalStart) - globalStart));

  return {
    stroke: {
      ...cloneStroke(stroke),
      points: clonedPoints
    },
    normalizedPointTimes,
    baseDuration,
    rawStart
  };
}

function createEmptyModeTimeline(): ModeTimeline {
  return {
    duration: 0,
    pointTimes: []
  };
}

function ensurePointTimesLength(container: number[][], targetIndex: number): number[] {
  while (container.length <= targetIndex) {
    container.push([]);
  }
  return container[targetIndex];
}

export function buildTimelineData(
  strokes: Stroke[],
  options: BuildTimelineOptions = {}
): TimelineData {
  if (strokes.length === 0) {
    return {
      strokes: [],
      modes: {
        historical: createEmptyModeTimeline(),
        sequential: createEmptyModeTimeline(),
        simultaneous: createEmptyModeTimeline()
      },
      totalPoints: 0
    };
  }

  const minPointDelta = Math.max(1, options.minPointDeltaMs ?? DEFAULT_MIN_POINT_DELTA_MS);
  const idleThreshold = Math.max(minPointDelta, options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS);
  const skipIdle = options.skipIdle ?? false;

  const firstPointTimestamps = strokes
    .map((stroke) => stroke.points[0]?.t)
    .filter((value): value is number => typeof value === 'number');
  const globalStart = firstPointTimestamps.length > 0 ? Math.min(...firstPointTimestamps) : 0;

  const strokeInfos = strokes.map((stroke) => buildStrokeTimelineInfo(stroke, globalStart, minPointDelta));
  const clonedStrokes = strokeInfos.map((info) => info.stroke);
  const totalPoints = strokeInfos.reduce((acc, info) => acc + info.normalizedPointTimes.length, 0);

  const historicalTimeline: ModeTimeline = {
    duration: 0,
    pointTimes: clonedStrokes.map(() => [])
  };
  const sequentialTimeline: ModeTimeline = {
    duration: 0,
    pointTimes: clonedStrokes.map(() => [])
  };
  const simultaneousTimeline: ModeTimeline = {
    duration: 0,
    pointTimes: clonedStrokes.map(() => [])
  };

  type TimelineEvent = {
    strokeIndex: number;
    pointIndex: number;
    rawTime: number;
    time?: number;
  };

  const events: TimelineEvent[] = [];
  strokeInfos.forEach((info, strokeIndex) => {
    info.normalizedPointTimes.forEach((relativeTime, pointIndex) => {
      events.push({
        strokeIndex,
        pointIndex,
        rawTime: info.rawStart + relativeTime
      });
    });
  });

  events.sort((a, b) => {
    if (a.rawTime !== b.rawTime) {
      return a.rawTime - b.rawTime;
    }
    if (a.strokeIndex !== b.strokeIndex) {
      return a.strokeIndex - b.strokeIndex;
    }
    return a.pointIndex - b.pointIndex;
  });

  if (events.length > 0) {
    let previousRaw = events[0].rawTime;
    let accumulated = 0;
    events[0].time = 0;
    for (let i = 1; i < events.length; i += 1) {
      const event = events[i];
      const raw = event.rawTime;
      const gap = Math.max(0, raw - previousRaw);
      let effectiveGap = gap;
      if (skipIdle && gap > idleThreshold) {
        effectiveGap = idleThreshold;
      }
      if (effectiveGap < minPointDelta) {
        effectiveGap = minPointDelta;
      }
      accumulated += effectiveGap;
      event.time = accumulated;
      previousRaw = raw;
    }
    const lastEvent = events[events.length - 1];
    historicalTimeline.duration = lastEvent.time ?? 0;
  }

  events.forEach((event) => {
    const eventTime = event.time ?? 0;
    const times = historicalTimeline.pointTimes[event.strokeIndex];
    times[event.pointIndex] = eventTime;
  });

  let sequentialCursor = 0;
  strokeInfos.forEach((info, strokeIndex) => {
    const strokeTimes = ensurePointTimesLength(sequentialTimeline.pointTimes, strokeIndex);
    if (info.normalizedPointTimes.length === 0) {
      return;
    }
    strokeTimes[0] = sequentialCursor;
    for (let pointIndex = 1; pointIndex < info.normalizedPointTimes.length; pointIndex += 1) {
      const previousTime = strokeTimes[pointIndex - 1];
      const targetTime = sequentialCursor + info.normalizedPointTimes[pointIndex];
      const normalizedTime = Math.max(previousTime + minPointDelta, targetTime);
      strokeTimes[pointIndex] = normalizedTime;
    }
    sequentialCursor = (strokeTimes[strokeTimes.length - 1] ?? sequentialCursor) + minPointDelta;
  });
  sequentialTimeline.duration = Math.max(0, sequentialCursor - minPointDelta);

  const maxBaseDuration = strokeInfos.reduce((acc, info) => Math.max(acc, info.baseDuration), 0);
  let simultaneousDuration = Math.max(minPointDelta, maxBaseDuration);
  strokeInfos.forEach((info, strokeIndex) => {
    const strokeTimes = ensurePointTimesLength(simultaneousTimeline.pointTimes, strokeIndex);
    if (info.normalizedPointTimes.length === 0) {
      return;
    }
    const baseDuration = info.baseDuration || minPointDelta;
    const scale = baseDuration > 0 ? simultaneousDuration / baseDuration : 1;
    strokeTimes[0] = 0;
    for (let pointIndex = 1; pointIndex < info.normalizedPointTimes.length; pointIndex += 1) {
      const targetTime = Math.round(info.normalizedPointTimes[pointIndex] * scale);
      const previousTime = strokeTimes[pointIndex - 1];
      strokeTimes[pointIndex] = Math.max(previousTime + minPointDelta, targetTime);
    }
    const strokeEnd = strokeTimes[strokeTimes.length - 1] ?? 0;
    simultaneousDuration = Math.max(simultaneousDuration, strokeEnd);
  });
  simultaneousTimeline.duration = simultaneousDuration;

  return {
    strokes: clonedStrokes,
    modes: {
      historical: historicalTimeline,
      sequential: sequentialTimeline,
      simultaneous: simultaneousTimeline
    },
    totalPoints
  };
}

export function getModeDuration(data: TimelineData, mode: PlaybackMode): number {
  return data.modes[mode]?.duration ?? 0;
}

export function getModePointTimes(data: TimelineData, mode: PlaybackMode): number[][] {
  return data.modes[mode]?.pointTimes ?? [];
}

export function createSnapshot(
  data: TimelineData,
  mode: PlaybackMode,
  timeMs: number
): Stroke[] {
  const pointTimes = getModePointTimes(data, mode);
  return data.strokes.map((stroke, strokeIndex) => {
    const times = pointTimes[strokeIndex] ?? [];
    if (times.length === 0) {
      return {
        ...stroke,
        points: [],
        emojiSequence: stroke.emojiSequence ? [] : undefined
      };
    }
    let visibleCount = times.length;
    for (let i = 0; i < times.length; i += 1) {
      if (times[i] > timeMs) {
        visibleCount = i;
        break;
      }
    }
    if (visibleCount <= 0) {
      return {
        ...stroke,
        points: [],
        emojiSequence: stroke.emojiSequence ? [] : undefined
      };
    }
    if (visibleCount >= stroke.points.length) {
      return stroke;
    }
    return {
      ...stroke,
      points: stroke.points.slice(0, visibleCount).map((point) => ({ ...point })),
      emojiSequence: stroke.emojiSequence ? stroke.emojiSequence.slice(0, visibleCount) : undefined
    };
  });
}
