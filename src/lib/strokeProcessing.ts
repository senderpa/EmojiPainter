import type { StrokePoint } from '../state/PaintingContext';

const CURVATURE_THRESHOLD = 0.985;
const SAMPLE_POINT_COUNT = 12;

const distanceSq = (a: StrokePoint, b: StrokePoint): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const curvatureCosine = (a: StrokePoint, b: StrokePoint, c: StrokePoint): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const abLen = Math.hypot(abx, aby);
  const bcLen = Math.hypot(bcx, bcy);
  if (abLen === 0 || bcLen === 0) {
    return 1;
  }
  return (abx * bcx + aby * bcy) / (abLen * bcLen);
};

const computeDecimationSpacing = (size: number, spacing?: number, stampSpan?: number): number => {
  // Use actual spacing value directly - supports full range from 0.0000001 to 300
  if (spacing === undefined) {
    return size * 0.12; // Default spacing for legacy strokes
  }

  // Direct multiplication: smaller spacing = tighter emojis, larger spacing = wider gaps
  const span = Math.max(1, stampSpan ?? size * 1.1);
  return Math.max(0.01, spacing * span); // Allow ultra-tight spacing (0.01 minimum)
};

const sampleHash = (points: StrokePoint[]): number => {
  if (points.length === 0) {
    return 0;
  }
  if (points.length <= SAMPLE_POINT_COUNT) {
    return points.reduce((acc, point) => {
      const hx = Math.round(point.x * 10) & 0xffff;
      const hy = Math.round(point.y * 10) & 0xffff;
      return ((acc * 1315423911) ^ (hx << 16) ^ hy) >>> 0;
    }, 2166136261);
  }
  const step = Math.max(1, Math.floor(points.length / SAMPLE_POINT_COUNT));
  let acc = 2166136261;
  for (let i = 0; i < points.length; i += step) {
    const point = points[i];
    const hx = Math.round(point.x * 10) & 0xffff;
    const hy = Math.round(point.y * 10) & 0xffff;
    acc = ((acc * 1315423911) ^ (hx << 16) ^ hy) >>> 0;
  }
  return acc >>> 0;
};

export const adaptiveDecimatePoints = (
  points: StrokePoint[],
  size: number,
  spacing?: number,
  stampSpan?: number
): StrokePoint[] => {
  if (points.length <= 2) {
    return points.map((point) => ({ ...point }));
  }

  const minSpacing = computeDecimationSpacing(size, spacing, stampSpan);
  const minSpacingSq = minSpacing * minSpacing;
  const result: StrokePoint[] = [{ ...points[0] }];
  let lastKept = points[0];

  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const distSq = distanceSq(current, lastKept);
    if (distSq >= minSpacingSq) {
      result.push({ ...current });
      lastKept = current;
      continue;
    }
    const next = points[i + 1];
    if (curvatureCosine(lastKept, current, next) < CURVATURE_THRESHOLD) {
      result.push({ ...current });
      lastKept = current;
    }
  }

  result.push({ ...points[points.length - 1] });

  if (result.length < points.length / 3 && sampleHash(result) !== sampleHash(points)) {
    return points.map((point) => ({ ...point }));
  }

  return result;
};
