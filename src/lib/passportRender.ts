/**
 * Passport (profile portrait) rendering — background image + strokes → PNG.
 *
 * The studio used to produce the passport with `captureRef` on the live view.
 * That is the same technique this codebase already abandoned for gallery upload
 * and share, because capturing a view whose canvas is GPU-backed can hand back a
 * BLANK image (see the Skia offscreen exporter's header). When it returns blank
 * the failure is silent and total: the uploaded portrait is empty, the profile
 * circle is empty, and — because the studio then paints over that same empty
 * image — the passport never comes back.
 *
 * So the passport is composited off-screen instead, replaying strokes through
 * the SAME `appendStrokeToSurface` the live canvas uses. `renderStrokesToBase64`
 * cannot be reused directly because it only supports a background *colour*, and
 * a passport is painted on top of the previous portrait *image*.
 */
import { PixelRatio } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Skia, type SkImage } from '@shopify/react-native-skia';

import type { Stroke } from '../state/PaintingContext';
import { appendStrokeToSurface } from '../components/EmojiCanvas';
import { resolveSmudgeTilesFromFiles } from './smudge/skiaOffscreenRender';

/** Matches the studio canvas backdrop so a transparent portrait never reads as black. */
export const PASSPORT_BACKDROP = '#f5efe6';
export const PASSPORT_SIZE_PX = 512;

const BASE64_PREFIX = /^data:image\/[a-zA-Z+]+;base64,/;

/** Decode any URI shape the portrait can arrive as into raw base64. */
async function readImageBase64(uri: string): Promise<string | null> {
  try {
    if (BASE64_PREFIX.test(uri)) return uri.replace(BASE64_PREFIX, '');
    if (uri.startsWith('file://') || uri.startsWith('/')) {
      return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    }
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      // Server portraits are remote URLs on a second device / after reinstall.
      const target = `${FileSystem.cacheDirectory}passport-src-${Date.now()}.png`;
      const result = await FileSystem.downloadAsync(uri, target);
      if (!result?.uri) return null;
      const data = await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 });
      void FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
      return data;
    }
  } catch (error) {
    console.warn('[Passport] background read failed:', error);
  }
  return null;
}

async function decodeImage(uri: string | null): Promise<SkImage | null> {
  if (!uri) return null;
  const base64 = await readImageBase64(uri);
  if (!base64) return null;
  try {
    const data = Skia.Data.fromBase64(base64);
    return Skia.Image.MakeImageFromEncoded(data) ?? null;
  } catch (error) {
    console.warn('[Passport] background decode failed:', error);
    return null;
  }
}

/**
 * Composite the passport: previous portrait as the backdrop, then this session's
 * strokes on top, at `outputPx` square. Returns raw base64 (no data-URI prefix),
 * or null if the surface could not be created.
 */
export async function renderPassportBase64(options: {
  backgroundUri: string | null;
  strokes: Stroke[];
  /** Logical canvas size the strokes were drawn against. */
  canvasDipSize: number;
  outputPx?: number;
}): Promise<string | null> {
  const { backgroundUri, strokes, canvasDipSize } = options;
  const outputPx = Math.max(1, Math.round(options.outputPx ?? PASSPORT_SIZE_PX));

  // CRITICAL: `appendStrokeToSurface` converts stroke points with the global
  // device pixel ratio (`point.x * DPR`) — it does NOT scale to the surface it
  // is handed. So the composite MUST happen at exactly canvasDip × DPR, or the
  // strokes land at the wrong position and size over a correctly-scaled
  // background (which is what "misaligned, all wrong" looked like). The result
  // is scaled down to the upload size afterwards, as a separate pass.
  const nativePx = Math.max(1, Math.round(canvasDipSize * PixelRatio.get()));

  const surface = Skia.Surface.Make(nativePx, nativePx);
  if (!surface) {
    console.warn('[Passport] could not create offscreen surface');
    return null;
  }

  let background: SkImage | null = null;
  let composited: SkImage | null = null;
  try {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color(PASSPORT_BACKDROP));

    background = await decodeImage(backgroundUri);
    if (background) {
      // resizeMode="cover": fill the square, cropping the overflow, centred —
      // must match how the studio displays it or the upload would not match
      // what the user saw.
      const iw = background.width();
      const ih = background.height();
      const scale = Math.max(nativePx / iw, nativePx / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      canvas.drawImageRect(
        background,
        Skia.XYWHRect(0, 0, iw, ih),
        Skia.XYWHRect((nativePx - dw) / 2, (nativePx - dh) / 2, dw, dh),
        Skia.Paint()
      );
    }

    // Smudge tiles live as files; pull their base64 before replaying.
    const resolved = await resolveSmudgeTilesFromFiles(strokes);
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    for (const stroke of resolved) {
      appendStrokeToSurface(canvas, stroke, canvasDipSize, canvasDipSize, paint, nativePx, nativePx);
    }

    composited = surface.makeImageSnapshot();
    if (nativePx === outputPx) {
      return composited.encodeToBase64() ?? null;
    }

    // Downscale pass to keep the uploaded passport a sensible size.
    const outSurface = Skia.Surface.Make(outputPx, outputPx);
    if (!outSurface) return composited.encodeToBase64() ?? null;
    try {
      const outCanvas = outSurface.getCanvas();
      outCanvas.clear(Skia.Color(PASSPORT_BACKDROP));
      const scalePaint = Skia.Paint();
      scalePaint.setAntiAlias(true);
      outCanvas.drawImageRect(
        composited,
        Skia.XYWHRect(0, 0, nativePx, nativePx),
        Skia.XYWHRect(0, 0, outputPx, outputPx),
        scalePaint
      );
      const scaled = outSurface.makeImageSnapshot();
      const base64 = scaled.encodeToBase64();
      scaled.dispose?.();
      return base64 ?? null;
    } finally {
      outSurface.dispose?.();
    }
  } catch (error) {
    console.warn('[Passport] offscreen render failed:', error);
    return null;
  } finally {
    composited?.dispose?.();
    background?.dispose?.();
    surface.dispose?.();
  }
}
