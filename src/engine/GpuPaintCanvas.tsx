/**
 * GpuPaintCanvas — experimental UI-thread, GPU-resident paint engine (Phase 0/1).
 *
 * WHY: the legacy EmojiCanvas keeps the committed painting on a CPU raster surface and shows a CPU
 * snapshot. That is fast for normal strokes, but smudge has to (a) upload the whole canvas to the GPU
 * at every stroke-begin (~37MB on iPad) and (b) read back the result each frame — those two transfers
 * are the lag. They are unavoidable on the JS thread because react-native-skia's Metal context is
 * thread-local, so a JS-thread GPU snapshot renders black on the UI-thread <Canvas> and must be
 * read back to CPU.
 *
 * FIX (this engine): record the committed strokes into an SkPicture (reusing the EXACT same draw ops
 * as EmojiCanvas via appendStrokeToSurface) and rasterize it to a GPU texture ON THE UI THREAD using
 * react-native-skia's official `usePictureAsTexture`. On the UI thread `makeImageSnapshot()` returns a
 * GPU image in the SAME context as the on-screen <Canvas>, so it displays directly with NO readback
 * and NO upload (verified in node_modules/.../external/reanimated/Offscreen.tsx: drawAsImageFromPicture
 * is a "worklet" that returns the raw GPU image when isOnMainThread()).
 *
 * Phase 0/1 scope: committed normal / eraser / plane / sequence / custom-PNG strokes + live & hover
 * preview, at visual parity with EmojiCanvas. Smudge is NOT handled here yet — PaintCanvas routes any
 * painting that contains smudge to the legacy EmojiCanvas (Phase 2 will move smudge onto this engine).
 */
import React, { memo, useMemo } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  Image as SkImageNode,
  Skia,
  usePictureAsTexture,
  type SkPicture,
  type Transforms3d
} from '@shopify/react-native-skia';

import type { Stroke } from '../state/PaintingContext';
import {
  appendStrokeToSurface,
  createPreview,
  type PreparedPreview
} from '../components/EmojiCanvas';

interface GpuPaintCanvasProps {
  width: number;
  height: number;
  strokes: Stroke[];
  liveStroke?: Stroke | null;
  liveVersion?: number;
  backgroundColor?: string;
  previewStroke?: Stroke | null;
  devicePixelRatio?: number;
}

const DPR = PixelRatio.get();
const TRANSPARENT = Skia.Color('rgba(0,0,0,0)');

const previewSignature = (stroke: Stroke | null | undefined): string => {
  if (!stroke || stroke.points.length === 0) {
    return stroke ? `${stroke.id}-0` : 'none';
  }
  const last = stroke.points[stroke.points.length - 1];
  return `${stroke.id}-${stroke.points.length}-${Math.round(last.x * 10)}-${Math.round(last.y * 10)}`;
};

/** Skia transform list for a stamp command (mirror + rotation about its center). Mirrors EmojiCanvas. */
const commandTransforms = (
  centerX: number,
  centerY: number,
  rotationDeg: number,
  flipX: boolean,
  flipY: boolean
): Transforms3d | undefined => {
  const hasFlip = flipX || flipY;
  const hasRotation = Math.abs(rotationDeg) > 0.0001;
  if (!hasFlip && !hasRotation) {
    return undefined;
  }
  const result: Transforms3d = [{ translateX: centerX }, { translateY: centerY }];
  if (hasRotation) {
    result.push({ rotate: (rotationDeg * Math.PI) / 180 });
  }
  if (hasFlip) {
    result.push({ scaleX: flipX ? -1 : 1 });
    result.push({ scaleY: flipY ? -1 : 1 });
  }
  result.push({ translateX: -centerX }, { translateY: -centerY });
  return result;
};

/** Render a prepared preview (live in-progress stroke or hover stroke) as direct Skia nodes. */
const PreviewLayer: React.FC<{ preview: PreparedPreview | null; keyPrefix: string }> = ({ preview, keyPrefix }) => {
  if (!preview) {
    return null;
  }
  if (preview.isEraser) {
    return (
      <Group>
        {preview.commands.map((command, index) =>
          command.radius !== undefined ? (
            <Circle
              key={`${keyPrefix}-eraser-${index}`}
              cx={command.centerX}
              cy={command.centerY}
              r={command.radius}
              style="stroke"
              strokeWidth={2}
              color="rgba(255,255,255,0.5)"
            />
          ) : null
        )}
      </Group>
    );
  }
  return (
    <Group opacity={preview.opacity}>
      {preview.commands.map((command, index) => {
        if (!command.stamp) {
          return null;
        }
        return (
          <SkImageNode
            key={`${keyPrefix}-${index}`}
            image={command.stamp.image}
            x={command.x}
            y={command.y}
            width={command.width}
            height={command.height}
            fit="fill"
            transform={commandTransforms(
              command.centerX,
              command.centerY,
              command.rotation,
              command.flipX,
              command.flipY
            )}
          />
        );
      })}
    </Group>
  );
};

const GpuPaintCanvas: React.FC<GpuPaintCanvasProps> = ({
  width,
  height,
  strokes,
  liveStroke,
  liveVersion,
  backgroundColor,
  previewStroke
}) => {
  const sizePx = useMemo(
    () => ({
      width: Math.max(1, Math.floor(width * DPR)),
      height: Math.max(1, Math.floor(height * DPR))
    }),
    [width, height]
  );

  // Record committed strokes into an SkPicture. This re-uses the exact EmojiCanvas draw ops, so the
  // pixels are identical — only the surface/thread the picture is rasterized on differs. The picture
  // is cheap (records commands, no rasterization); rasterization to a GPU texture happens on the UI
  // thread inside usePictureAsTexture.
  const picture = useMemo<SkPicture | null>(() => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, sizePx.width, sizePx.height));
    canvas.clear(TRANSPARENT);
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    for (let i = 0; i < strokes.length; i += 1) {
      const stroke = strokes[i];
      // Defensive: smudge needs pixel readback (no pixels in a recording canvas) — never reaches this
      // engine because PaintCanvas routes smudge paintings to EmojiCanvas, but skip just in case.
      if (stroke.isSmudge) {
        continue;
      }
      appendStrokeToSurface(canvas, stroke, width, height, paint, sizePx.width, sizePx.height);
    }
    return recorder.finishRecordingAsPicture();
  }, [strokes, width, height, sizePx]);

  // UI-thread GPU texture of the committed document — displayed with NO readback / NO upload.
  const documentTexture = usePictureAsTexture(picture, sizePx);

  // Live in-progress stroke + hover preview rendered as direct Skia nodes over the document texture
  // (identical to EmojiCanvas). Smudge has no stamp preview, so createPreview returns null for it.
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
        <SkImageNode image={documentTexture} x={0} y={0} width={width} height={height} fit="fill" />
        <PreviewLayer preview={livePreview} keyPrefix="live" />
        <PreviewLayer preview={hoverPreview} keyPrefix="hover" />
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

export default memo(GpuPaintCanvas);
