import { VectorSpatialIndex } from '../vectorSpatialIndex';
import type { VectorStroke } from '../vectorTypes';

function stroke(strokeID: string, minX: number, minY: number, maxX = minX + 10, maxY = minY + 10): VectorStroke {
  return {
    strokeID,
    emoji: '😀',
    worldSize: 10,
    screenSizeAtCreation: 10,
    widthMode: 'worldConstant',
    opacity: 1,
    spacingRatio: 0.12,
    rotationDegrees: 0,
    startedAtMilliseconds: 0,
    endedAtMilliseconds: 1,
    samples: [{ x: minX, y: minY, timeMilliseconds: 0 }],
    worldBounds: { minX, minY, maxX, maxY },
    stampPositions: [{ x: minX, y: minY }],
  };
}

describe('VectorSpatialIndex', () => {
  it('returns only intersecting strokes in document order', () => {
    const index = new VectorSpatialIndex([
      stroke('second', 100, 100),
      stroke('first', 0, 0),
      stroke('far', 1000, 1000),
    ]);

    expect(index.query({ minX: -5, minY: -5, maxX: 20, maxY: 20 }).map((item) => item.strokeID))
      .toEqual(['first']);
    expect(index.query({ minX: -10, minY: -10, maxX: 120, maxY: 120 }).map((item) => item.strokeID))
      .toEqual(['second', 'first']);
  });

  it('keeps giant strokes queryable without expanding every cell', () => {
    const giant = stroke('giant', -1_000_000, -1_000_000, 1_000_000, 1_000_000);
    const index = new VectorSpatialIndex([giant]);
    expect(index.query({ minX: 0, minY: 0, maxX: 1, maxY: 1 }).map((item) => item.strokeID)).toEqual(['giant']);
  });
});
