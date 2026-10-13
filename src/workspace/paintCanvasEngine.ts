export interface NativeMetalPaintEligibility {
  shouldUseMetalCanvas: boolean;
  forceMetal: boolean;
  forceSkia: boolean;
  hasPlaneStrokes: boolean;
  hasCustomEmoji: boolean;
  nativeViewAvailable: boolean;
  featureEnabled: boolean;
}

/**
 * Whether the native live Metal renderer may own this canvas.
 *
 * Keep this decision pure and tested: an emoji plane's editable preview is rendered by Skia, so a
 * plane-containing canvas must stay on Skia after Apply as well. UIKit/Metal fabricates a different
 * emoji bitmap and cannot provide a pixel-identical hand-off even when its mesh math is identical.
 */
export const shouldUseNativeMetalPaint = ({
  shouldUseMetalCanvas,
  forceMetal,
  forceSkia,
  hasPlaneStrokes,
  hasCustomEmoji,
  nativeViewAvailable,
  featureEnabled,
}: NativeMetalPaintEligibility): boolean =>
  !shouldUseMetalCanvas &&
  !forceMetal &&
  !forceSkia &&
  !hasPlaneStrokes &&
  !hasCustomEmoji &&
  nativeViewAvailable &&
  featureEnabled;
