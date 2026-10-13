import { buildVectorProjectPayload } from '../../lib/storage';
import { VECTOR_SCHEMA, VECTOR_SCHEMA_VERSION } from '../vectorTypes';

describe('Vector project packaging', () => {
  it('preserves vector metadata and drops derived stamp caches', () => {
    const payload = buildVectorProjectPayload({
      meta: {
        schema: VECTOR_SCHEMA,
        schemaVersion: VECTOR_SCHEMA_VERSION,
        documentID: 'vector-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        mode: 'vector',
        defaultWidthMode: 'worldConstant',
        camera: { cx: 12, cy: -3, zoom: 4 },
        strokeOrder: ['stroke-1'],
        viewpoints: [{ id: 'v1', label: 'View 1', cx: 1, cy: 2, zoom: 3, holdMs: 700, durationToNextMs: 1800, easing: 'easeInOut' }],
        loopMode: 'once',
      },
      strokes: [{
        strokeID: 'stroke-1',
        emoji: '🙂',
        worldSize: 10,
        screenSizeAtCreation: 40,
        widthMode: 'worldConstant',
        opacity: 1,
        spacingRatio: 0.12,
        rotationDegrees: 0,
        startedAtMilliseconds: 0,
        endedAtMilliseconds: 100,
        samples: [{ x: 1, y: 2, timeMilliseconds: 0 }],
        worldBounds: { minX: 0, minY: 1, maxX: 2, maxY: 3 },
        stampPositions: [{ x: 1, y: 2 }],
        stampCarry: 0,
        stampStep: 1,
        stampPathLength: 0,
      }],
    }, 'file:///preview.png');

    expect(payload.metadata?.kind).toBe('vector');
    expect(payload.metadata?.vectorStrokeCount).toBe(1);
    expect(payload.metadata?.vectorViewpointCount).toBe(1);
    expect(payload.metadata?.vectorDocument?.meta.camera.zoom).toBe(4);
    expect(payload.metadata?.vectorDocument?.strokes[0].stampPositions).toBeUndefined();
    expect(payload.preview).toBe('file:///preview.png');
  });
});
