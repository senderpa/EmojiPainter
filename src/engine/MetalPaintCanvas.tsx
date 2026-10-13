/**
 * MetalPaintCanvas — PaintCanvas-compatible renderer backed by the native Metal view (metal-paint).
 *
 * Committed non-smudge strokes + baked smudge → strokesJson (rebuilt only when strokes change). The
 * in-progress stroke (incl. live smudge, with its params) → liveStrokeJson, updated per move. The
 * native view smudges on the GPU and, on release, emits onSmudgeBaked with the baked tile; we persist
 * it on the stroke via SET_SMUDGE_BAKE so save/export and the committed rebuild use it.
 */
import React, { memo, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { serializeMetalPaintStroke } from './metalStrokeSerialization';
import { getMetalPaintNativeView } from '../../modules/metal-paint';
import { usePainting, type Stroke } from '../state/PaintingContext';

interface MetalPaintCanvasProps {
  width: number;
  height: number;
  strokes: Stroke[];
  liveStroke?: Stroke | null;
  liveVersion?: number;
  backgroundColor?: string;
  previewStroke?: Stroke | null;
  devicePixelRatio?: number;
}

const MetalPaintCanvas: React.FC<MetalPaintCanvasProps> = ({
  width,
  height,
  strokes,
  liveStroke,
  liveVersion,
  backgroundColor
}) => {
  const { dispatch } = usePainting();
  const resolvedBackground = backgroundColor ?? '#050505';

  // Per-stroke serialized-fragment cache. A committed smudge carries a big base64 baked tile; without
  // this, adding ANY new stroke re-serialized every tile again (the smudge "cliff"). Strokes keep their
  // object identity across renders (the reducer only appends / replaces the changed one), so each
  // stroke's JSON — especially a heavy baked tile — is built ONCE and reused until that stroke changes.
  // Output is byte-identical to the old JSON.stringify(strokes.map(serializeStroke)), so it stays
  // compatible with the native binary.
  const fragmentCacheRef = useRef<Map<string, { stroke: Stroke; json: string }>>(new Map());
  const strokesJson = useMemo(() => {
    const _t0 = Date.now();
    const cache = fragmentCacheRef.current;
    const liveIds = new Set<string>();
    const parts: string[] = new Array(strokes.length);
    for (let i = 0; i < strokes.length; i += 1) {
      const s = strokes[i];
      liveIds.add(s.id);
      const cached = cache.get(s.id);
      if (cached && cached.stroke === s) {
        parts[i] = cached.json;
      } else {
        const json = JSON.stringify(serializeMetalPaintStroke(s));
        cache.set(s.id, { stroke: s, json });
        parts[i] = json;
      }
    }
    // Drop fragments for strokes that no longer exist (undo / clear / reload) to bound memory.
    if (cache.size > liveIds.size) {
      for (const id of Array.from(cache.keys())) {
        if (!liveIds.has(id)) cache.delete(id);
      }
    }
    const out = `[${parts.join(',')}]`;
    const dt = Date.now() - _t0;
    if (dt > 8) console.log(`[SMUDGE-PERF/js] strokesJson recompute ${dt}ms strokes=${strokes.length} len=${out.length}`);
    return out;
  }, [strokes]);

  // (Tiles are FILES now: the path rides in strokesJson per-stroke, native loads the file. No separate
  // base64 channel, no native→JS→native round-trip.)

  const liveStrokeJson = useMemo(() => {
    if (!liveStroke) {
      return '[]';
    }
    return JSON.stringify([serializeMetalPaintStroke(liveStroke)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStroke, liveVersion]);

  const onSmudgeBaked = React.useCallback(
    (e: { nativeEvent: { id: string; path: string; x: number; y: number; w: number; h: number } }) => {
      const { id, path, x, y, w, h } = e.nativeEvent;
      console.log(`[SMUDGE-JS] onSmudgeBaked fired id=${id} path=${path}`);
      if (id && path) {
        // Store only the tiny relative file PATH (+ bounds) on the stroke — never base64 in state.
        dispatch({ type: 'SET_SMUDGE_BAKE', strokeId: id, bakedTilePath: path, bakedBounds: { x, y, w, h } });
      }
    },
    [dispatch]
  );

  // Prints the NATIVE binary's build tag on launch → confirms which native build is actually running
  // (ends the "is it the old build?" uncertainty after a rebuild).
  const onReady = React.useCallback((e: { nativeEvent: { buildTag?: string } }) => {
    console.log(`[metal-paint] 🏷️ NATIVE BUILD = ${e.nativeEvent?.buildTag ?? 'unknown'}`);
  }, []);

  // Native smudge timings surfaced to the JS console (→ Metro stdout). This is how native ms become
  // readable off-device — NSLog from the pod reaches neither the JS console nor idevicesyslog here.
  const onPerf = React.useCallback((e: { nativeEvent: { msg: string } }) => {
    console.log(`[SMUDGE-PERF/native] ${e.nativeEvent?.msg ?? ''}`);
  }, []);

  const NativeView = getMetalPaintNativeView();
  if (!NativeView) {
    return <View style={[styles.container, { width, height, backgroundColor: resolvedBackground }]} />;
  }
  return (
    <View style={[styles.container, { width, height, backgroundColor: resolvedBackground }]} pointerEvents="none">
      <NativeView
        style={StyleSheet.absoluteFill}
        canvasWidth={width}
        canvasHeight={height}
        backgroundColor={resolvedBackground}
        strokesJson={strokesJson}
        liveStrokeJson={liveStrokeJson}
        onSmudgeBaked={onSmudgeBaked}
        onReady={onReady}
        onPerf={onPerf}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    overflow: 'hidden'
  }
});

export default memo(MetalPaintCanvas);
