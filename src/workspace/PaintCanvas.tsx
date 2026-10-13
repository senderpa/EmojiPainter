import React from 'react';
import { Platform, PixelRatio } from 'react-native';

import EmojiCanvas from '../components/EmojiCanvas';
import MetalEmojiCanvas from '../components/MetalEmojiCanvas';
import TilePaintCanvas from '../engine/TilePaintCanvas';
import MetalPaintCanvas from '../engine/MetalPaintCanvas';
import { isMetalAvailable } from '../native';
import { isMetalPaintViewAvailable } from '../../modules/metal-paint';
import { featureFlags } from '../config/features';
import type { Stroke } from '../state/PaintingContext';
import { isCustomBrushReference } from '../lib/customBrushRegistry';
import { isCustomPng } from '../lib/pngNormalizer';
import { shouldUseNativeMetalPaint } from './paintCanvasEngine';

interface PaintCanvasProps {
  width: number;
  height: number;
  strokes: Stroke[];
  liveStroke?: Stroke | null;
  liveVersion?: number;
  backgroundColor?: string;
  previewStroke?: Stroke | null;
  forceMetal?: boolean; // Optional override for testing
  forceSkia?: boolean; // Optional override for testing
}

const PaintCanvas: React.FC<PaintCanvasProps> = ({
  width,
  height,
  strokes,
  liveStroke = null,
  liveVersion,
  backgroundColor,
  previewStroke,
  forceMetal = false,
  forceSkia = false
}) => {
  const hasPlaneStrokes = React.useMemo(
    () => strokes.some((stroke) => stroke.isPlane && stroke.planeCorners),
    [strokes]
  );

  const hasCustomEmoji = React.useMemo(() => {
    const isCustom = (value?: string) => !!value && (isCustomBrushReference(value) || isCustomPng(value));
    if (liveStroke) {
      if (isCustom(liveStroke.emoji)) return true;
      if (liveStroke.emojiSequence?.some(isCustom)) return true;
    }
    return strokes.some((stroke) => {
      if (isCustom(stroke.emoji)) return true;
      return stroke.emojiSequence?.some(isCustom);
    });
  }, [strokes, liveStroke]);

  // Smudge needs CPU pixel readback (Skia path only); the native Metal canvas can't sample pixels.
  const hasSmudge = React.useMemo(() => {
    if (liveStroke?.isSmudge) return true;
    return strokes.some((stroke) => stroke.isSmudge);
  }, [strokes, liveStroke]);


  // Determine which renderer to use
  const shouldUseMetal = React.useMemo(() => {
    if (forceSkia) return false;
    if (forceMetal) return Platform.OS === 'ios' && isMetalAvailable();

    // Check feature flag
    return (
      Platform.OS === 'ios' &&
      isMetalAvailable() &&
      featureFlags.isEnabled('useMetalCanvas') &&
      !hasPlaneStrokes &&
      !hasCustomEmoji &&
      !hasSmudge
    );
  }, [forceMetal, forceSkia, hasPlaneStrokes, hasCustomEmoji, hasSmudge]);

  // Native Metal live paint engine: highest-priority Skia-path renderer when its native view is built
  // into the binary. Non-smudge only (smudge → legacy until M4).
  // The native Metal engine now handles normal painting AND live smudge (no engine switch), so it is
  // not excluded for smudge.
  // Custom-brush strokes carry a `custom_brush_<n>` id that only the Skia path can resolve (the native
  // atlas understands raw emoji + base64 data URIs, not registry ids), so they force the Skia engine.
  // Planes deliberately stay on Skia too. Their editable preview is made from the Skia stamp bitmap;
  // Metal independently redraws the glyph with UIKit, which changes its vertical ink crop by several
  // percent for some emoji. Keeping a committed plane on the SAME renderer/texture is the only way for
  // Apply to be a visual no-op instead of an approximate cross-renderer hand-off.
  const shouldUseMetalPaintEngine = React.useMemo(
    () => shouldUseNativeMetalPaint({
      shouldUseMetalCanvas: shouldUseMetal,
      forceMetal,
      forceSkia,
      hasPlaneStrokes,
      hasCustomEmoji,
      nativeViewAvailable: isMetalPaintViewAvailable(),
      featureEnabled: featureFlags.isEnabled('useMetalPaintEngine'),
    }),
    [shouldUseMetal, forceMetal, forceSkia, hasPlaneStrokes, hasCustomEmoji]
  );

  // Tile paint engine: Skia fallback when the native Metal view isn't available, for non-smudge.
  const shouldUseTileEngine = React.useMemo(
    () =>
      !shouldUseMetal &&
      !shouldUseMetalPaintEngine &&
      !hasSmudge &&
      !forceMetal &&
      !forceSkia &&
      featureFlags.isEnabled('useTilePaintEngine'),
    [shouldUseMetal, shouldUseMetalPaintEngine, hasSmudge, forceMetal, forceSkia]
  );

  // Use appropriate canvas component
  const CanvasComponent = shouldUseMetal
    ? MetalEmojiCanvas
    : shouldUseMetalPaintEngine
      ? MetalPaintCanvas
      : shouldUseTileEngine
        ? TilePaintCanvas
        : EmojiCanvas;

  React.useEffect(() => {
    const engine = shouldUseMetal
      ? 'metal-export'
      : shouldUseMetalPaintEngine
        ? 'METAL-PAINT'
        : shouldUseTileEngine
          ? 'tile'
          : 'legacy-EmojiCanvas';
    console.log(`[PaintCanvas] engine=${engine} metalViewAvailable=${isMetalPaintViewAvailable()} flag=${featureFlags.isEnabled('useMetalPaintEngine')}`);
  }, [shouldUseMetal, shouldUseMetalPaintEngine, shouldUseTileEngine]);

  // Pass ALL strokes including plane strokes - EmojiCanvas will render them in order
  return (
    <CanvasComponent
      width={width}
      height={height}
      strokes={strokes} // Include plane strokes for proper z-order
      liveStroke={liveStroke}
      liveVersion={liveVersion}
      backgroundColor={backgroundColor}
      previewStroke={previewStroke}
      devicePixelRatio={PixelRatio.get()}
    />
  );
};

export default PaintCanvas;
