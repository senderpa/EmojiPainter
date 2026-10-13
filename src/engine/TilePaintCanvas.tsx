/**
 * TilePaintCanvas — PaintCanvas-compatible renderer backed by TilePaintEngine.
 *
 * Committed strokes are mirrored into a tile grid by the engine (incremental: only touched tiles
 * re-render per commit; undo restores tile snapshots). The on-screen <Canvas> draws one <Image> per
 * tile (so an unchanged tile's image is reused frame-to-frame) plus the live/hover preview on top —
 * no full-canvas snapshot per stroke. Smudge paintings are routed to legacy EmojiCanvas upstream, so
 * this engine only sees non-smudge strokes.
 */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Image as SkImageNode, type SkImage } from '@shopify/react-native-skia';

import type { Stroke } from '../state/PaintingContext';
import { createPreview } from '../components/EmojiCanvas';
import { EmojiPreviewLayer } from './EmojiPreviewLayer';
import { TilePaintEngine } from './tiles/TilePaintEngine';

interface TilePaintCanvasProps {
  width: number;
  height: number;
  strokes: Stroke[];
  liveStroke?: Stroke | null;
  liveVersion?: number;
  backgroundColor?: string;
  previewStroke?: Stroke | null;
  devicePixelRatio?: number;
}

const previewSignature = (stroke: Stroke | null | undefined): string => {
  if (!stroke || stroke.points.length === 0) {
    return stroke ? `${stroke.id}-0` : 'none';
  }
  const last = stroke.points[stroke.points.length - 1];
  return `${stroke.id}-${stroke.points.length}-${Math.round(last.x * 10)}-${Math.round(last.y * 10)}`;
};

const TilePaintCanvas: React.FC<TilePaintCanvasProps> = ({
  width,
  height,
  strokes,
  liveStroke,
  liveVersion,
  backgroundColor,
  previewStroke
}) => {
  const engineRef = useRef<TilePaintEngine | null>(null);
  const strokesRef = useRef<Stroke[]>(strokes);
  strokesRef.current = strokes;
  const [displayImage, setDisplayImage] = useState<SkImage | null>(null);

  // (Re)create the engine when the canvas size changes; dispose on unmount/resize.
  useEffect(() => {
    const engine = new TilePaintEngine(width, height);
    engineRef.current = engine;
    engine.sync(strokesRef.current);
    setDisplayImage(engine.getDisplayImage());
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [width, height]);

  // Reconcile committed strokes into the backing surface whenever they change.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    if (engine.sync(strokes)) {
      setDisplayImage(engine.getDisplayImage());
    }
  }, [strokes]);

  const liveKey = previewSignature(liveStroke);
  const livePreview = useMemo(
    () => createPreview(liveStroke ?? null, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveStroke, liveVersion, width, height, liveKey]
  );

  const hoverKey = previewSignature(previewStroke);
  const hoverPreview = useMemo(
    () => createPreview(previewStroke ?? null, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewStroke, width, height, hoverKey]
  );

  const resolvedBackground = backgroundColor ?? '#050505';

  return (
    <View style={[styles.container, { width, height, backgroundColor: resolvedBackground }]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {displayImage && (
          <SkImageNode image={displayImage} x={0} y={0} width={width} height={height} fit="fill" />
        )}
        <EmojiPreviewLayer preview={livePreview} keyPrefix="live" />
        <EmojiPreviewLayer preview={hoverPreview} keyPrefix="hover" />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    overflow: 'hidden'
  }
});

export default memo(TilePaintCanvas);
