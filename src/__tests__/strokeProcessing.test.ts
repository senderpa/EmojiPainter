import { adaptiveDecimatePoints } from '../lib/strokeProcessing';
import type { StrokePoint } from '../state/PaintingContext';

const pt = (x: number, y: number): StrokePoint => ({ x, y });

const line = (n: number, step = 1): StrokePoint[] =>
  Array.from({ length: n }, (_, i) => pt(i * step, 0));

describe('adaptiveDecimatePoints', () => {
  describe('passthrough cases', () => {
    test('returns copy of single point', () => {
      const pts = [pt(0, 0)];
      const result = adaptiveDecimatePoints(pts, 20);
      expect(result).toEqual(pts);
      expect(result).not.toBe(pts);
    });

    test('returns copy of two points', () => {
      const pts = [pt(0, 0), pt(100, 100)];
      const result = adaptiveDecimatePoints(pts, 20);
      expect(result).toEqual(pts);
      expect(result).not.toBe(pts);
    });

    test('returns immutable copies — no shared references', () => {
      const pts = [pt(0, 0), pt(50, 0), pt(100, 0)];
      const result = adaptiveDecimatePoints(pts, 20);
      expect(result[0]).not.toBe(pts[0]);
      expect(result[result.length - 1]).not.toBe(pts[pts.length - 1]);
    });
  });

  describe('output structural guarantees', () => {
    test('always keeps first point', () => {
      const pts = line(20, 0.1);
      const result = adaptiveDecimatePoints(pts, 20);
      expect(result[0]).toEqual(pts[0]);
    });

    test('always keeps last point', () => {
      const pts = line(20, 0.1);
      const result = adaptiveDecimatePoints(pts, 20);
      expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
    });

    test('all output points come from the input', () => {
      const pts = line(30, 0.5);
      const result = adaptiveDecimatePoints(pts, 20);
      const inputSet = new Set(pts.map((p) => `${p.x},${p.y}`));
      result.forEach((p) => {
        expect(inputSet.has(`${p.x},${p.y}`)).toBe(true);
      });
    });

    test('output has at least 2 points for any 3+ point input', () => {
      const pts = line(10, 0.1);
      const result = adaptiveDecimatePoints(pts, 20);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    test('output length never exceeds input length', () => {
      const pts = line(50, 2);
      const result = adaptiveDecimatePoints(pts, 20);
      expect(result.length).toBeLessThanOrEqual(pts.length);
    });

    test('returns array of StrokePoint objects', () => {
      const pts = line(10, 5);
      const result = adaptiveDecimatePoints(pts, 20);
      result.forEach((p) => {
        expect(typeof p.x).toBe('number');
        expect(typeof p.y).toBe('number');
      });
    });
  });

  describe('spacing parameter effect', () => {
    test('very large spacing returns at most input length', () => {
      const pts = line(50, 5);
      const result = adaptiveDecimatePoints(pts, 20, 300);
      expect(result.length).toBeLessThanOrEqual(pts.length);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    test('explicit spacing=0 minimum still produces valid output', () => {
      const pts = line(20, 1);
      const result = adaptiveDecimatePoints(pts, 20, 0.0000001);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.length).toBeLessThanOrEqual(pts.length);
    });

    test('stampSpan parameter is accepted without error', () => {
      const pts = line(20, 5);
      expect(() => adaptiveDecimatePoints(pts, 20, 1.0, 25)).not.toThrow();
    });
  });

  describe('widely spaced points', () => {
    test('preserves all points when they are far apart', () => {
      // Points 100 units apart — always above any minSpacing
      const pts = Array.from({ length: 10 }, (_, i) => pt(i * 100, 0));
      const result = adaptiveDecimatePoints(pts, 20);
      expect(result.length).toBe(pts.length);
    });
  });
});
