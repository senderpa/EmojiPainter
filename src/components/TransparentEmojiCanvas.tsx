import React, { memo } from 'react';

import EmojiCanvas from './EmojiCanvas';
import type { Stroke } from '../state/PaintingContext';

interface TransparentEmojiCanvasProps {
  width: number;
  height: number;
  strokes: Stroke[];
  liveStroke?: Stroke | null;
  liveVersion?: number;
  previewStroke?: Stroke | null;
}

const TransparentEmojiCanvas: React.FC<TransparentEmojiCanvasProps> = memo(({
  width,
  height,
  strokes,
  liveStroke,
  liveVersion,
  previewStroke
}) => {
  return (
    <EmojiCanvas
      width={width}
      height={height}
      strokes={strokes}
      liveStroke={liveStroke}
      liveVersion={liveVersion}
      previewStroke={previewStroke}
      backgroundColor="transparent"
      showVignette={false}
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  if (
    prevProps.width !== nextProps.width ||
    prevProps.height !== nextProps.height ||
    prevProps.strokes.length !== nextProps.strokes.length ||
    prevProps.liveVersion !== nextProps.liveVersion
  ) {
    return false; // Props changed, need to re-render
  }

  // Check if points within strokes changed (important for timelapse animation)
  for (let i = 0; i < prevProps.strokes.length; i++) {
    if (prevProps.strokes[i].points.length !== nextProps.strokes[i].points.length) {
      return false; // Points changed, need to re-render
    }
  }

  return true; // Props are the same, skip re-render
});

TransparentEmojiCanvas.displayName = 'TransparentEmojiCanvas';

export default TransparentEmojiCanvas;
