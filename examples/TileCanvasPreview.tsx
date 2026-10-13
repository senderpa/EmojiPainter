import React from 'react';
import { View } from 'react-native';

import TilePaintCanvas from '../src/engine/TilePaintCanvas';
import type { Stroke } from '../src/state/PaintingContext';

const strokes: Stroke[] = [
  {
    id: 'sun', emoji: '🌞', size: 56, opacity: 1,
    points: [{ x: 105, y: 100, t: 0 }, { x: 160, y: 100, t: 120 }, { x: 210, y: 100, t: 240 }]
  },
  {
    id: 'flowers', emoji: '🌼', size: 38, opacity: 0.9,
    points: [{ x: 90, y: 190, t: 0 }, { x: 145, y: 220, t: 150 }, { x: 205, y: 185, t: 300 }]
  }
];

export default function TileCanvasPreview() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#171923' }}>
      <TilePaintCanvas width={300} height={300} strokes={strokes} backgroundColor="#fff8e8" />
    </View>
  );
}
