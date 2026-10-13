import type { Stroke } from '../../state/PaintingContext';
import { serializeMetalPaintStroke } from '../metalStrokeSerialization';

describe('serializeMetalPaintStroke', () => {
  test('carries the complete distortion lattice through Apply to the native renderer', () => {
    const lattice = [
      { x: 10, y: 20 }, { x: 50, y: 8 }, { x: 90, y: 22 },
      { x: 4, y: 55 }, { x: 76, y: 31 }, { x: 96, y: 60 },
      { x: 12, y: 100 }, { x: 52, y: 112 }, { x: 92, y: 98 },
    ];
    const stroke: Stroke = {
      id: 'bent-plane',
      emoji: '🖼️',
      size: 90,
      opacity: 0.8,
      points: [{ x: 51, y: 57, t: 1 }],
      isPlane: true,
      planeCorners: {
        topLeft: lattice[0],
        topRight: lattice[2],
        bottomRight: lattice[8],
        bottomLeft: lattice[6],
      },
      planeLattice: lattice,
      planeLatticeLevel: 2,
    };

    const serialized = serializeMetalPaintStroke(stroke) as {
      planeLatticeLevel?: number;
      planeLattice?: { x: number; y: number }[];
      layer?: string;
    };
    expect(serialized.planeLatticeLevel).toBe(2);
    expect(serialized.planeLattice).toEqual(lattice);
    expect(serialized.planeLattice?.[4]).toEqual({ x: 76, y: 31 });
    expect(serialized).not.toHaveProperty('layer');
  });

  test('retains a non-default plane layer in the same payload', () => {
    const stroke: Stroke = {
      id: 'background-plane',
      emoji: '📐',
      size: 40,
      opacity: 1,
      points: [{ x: 20, y: 20, t: 1 }],
      layer: 'background',
    };
    expect(serializeMetalPaintStroke(stroke)).toMatchObject({ layer: 'background' });
  });
});
