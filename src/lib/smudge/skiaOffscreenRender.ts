/**
 * Offscreen Skia replay for still-image export of paintings that contain smudge strokes.
 *
 * The native Metal exporter cannot sample canvas pixels, so it can't reproduce smudge. For a
 * pixel-correct final PNG we replay every stroke through the SAME `appendStrokeToSurface` used
 * by the live canvas (which now handles smudge) onto an offscreen surface at device resolution,
 * then encode to PNG. Non-smudge paintings keep using the faster native path.
 */

import { PixelRatio } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';

import type { Stroke } from '../../state/PaintingContext';
import { appendStrokeToSurface } from '../../components/EmojiCanvas';

const DPR = PixelRatio.get();
const TILE_BG_RGB_MAX = 18;
const TILE_BG_CHROMA_MAX = 12;
const TILE_LOW_ALPHA_MAX = 4;

const isEdgeBackgroundPixel = (pixels: Uint8Array, offset: number): boolean => {
  const r = pixels[offset];
  const g = pixels[offset + 1];
  const b = pixels[offset + 2];
  const a = pixels[offset + 3];
  if (a <= TILE_LOW_ALPHA_MAX) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max <= TILE_BG_RGB_MAX && max - min <= TILE_BG_CHROMA_MAX;
};

const cleanupSmudgeTilePixels = (pixels: Uint8Array, width: number, height: number): boolean => {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return false;
  const total = width * height;
  const seen = new Uint8Array(total);
  const stack: number[] = [];

  const enqueue = (idx: number) => {
    if (seen[idx]) return;
    const offset = idx * 4;
    if (!isEdgeBackgroundPixel(pixels, offset)) return;
    seen[idx] = 1;
    stack.push(idx);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  let changed = false;
  while (stack.length > 0) {
    const idx = stack.pop()!;
    const offset = idx * 4;
    if (pixels[offset] !== 0 || pixels[offset + 1] !== 0 || pixels[offset + 2] !== 0 || pixels[offset + 3] !== 0) {
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 0;
      changed = true;
    }
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x > 0) enqueue(idx - 1);
    if (x + 1 < width) enqueue(idx + 1);
    if (y > 0) enqueue(idx - width);
    if (y + 1 < height) enqueue(idx + width);
  }

  return changed;
};

const sanitizeSmudgeTileBase64 = (base64: string): string => {
  try {
    const data = Skia.Data.fromBase64(base64);
    const image = data ? Skia.Image.MakeImageFromEncoded(data) : null;
    data?.dispose?.();
    if (!image) return base64;
    const width = image.width();
    const height = image.height();
    const info = { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
    const raw = image.readPixels(0, 0, info) as Uint8Array | Float32Array | null;
    image.dispose?.();
    if (!raw) return base64;
    const needed = width * height * 4;
    let pixels: Uint8Array;
    if (raw instanceof Uint8Array && raw.length === needed) {
      pixels = raw;
    } else {
      pixels = new Uint8Array(needed);
      const src = raw as ArrayLike<number>;
      const scale = src.length > 0 && src[0] <= 1 ? 255 : 1;
      for (let i = 0; i < Math.min(needed, src.length); i += 1) {
        pixels[i] = Math.max(0, Math.min(255, Math.round(src[i] * scale)));
      }
    }
    if (!cleanupSmudgeTilePixels(pixels, width, height)) return base64;
    const outData = Skia.Data.fromBytes(pixels);
    const cleaned = Skia.Image.MakeImage(info, outData, width * 4);
    const cleanedBase64 = cleaned?.encodeToBase64() ?? null;
    cleaned?.dispose?.();
    outData.dispose?.();
    return cleanedBase64 ?? base64;
  } catch (error) {
    console.warn('[smudge] tile alpha cleanup failed', error);
    return base64;
  }
};

/** True if any stroke uses smudge mode (so the native exporter would render it incorrectly). */
export const hasSmudgeStroke = (strokes: Stroke[] | undefined | null): boolean =>
  Array.isArray(strokes) && strokes.some((s) => s?.isSmudge === true);

/**
 * Smudge tiles are stored as FILES (Documents/smudge_tiles/<id>.png) and the live/save path carries
 * only the relative `bakedTilePath`. Export/timelapse need base64; read it from the file ON DEMAND
 * (one-time, off the live path) and return a NEW strokes array with `bakedTile` populated. Strokes that
 * already have base64 (old projects) or have no tile are passed through untouched.
 */
export const resolveSmudgeTilesFromFiles = async (strokes: Stroke[]): Promise<Stroke[]> => {
  if (!Array.isArray(strokes) || strokes.length === 0) return strokes;
  const docs = FileSystem.documentDirectory ?? '';
  return Promise.all(strokes.map(async (s) => {
    if (!s.isSmudge) return s;
    if (s.bakedTile) return { ...s, bakedTile: sanitizeSmudgeTileBase64(s.bakedTile) };
    if (!s.bakedTilePath) return s;
    try {
      const uri = `${docs}${s.bakedTilePath}`;
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      return b64 ? { ...s, bakedTile: sanitizeSmudgeTileBase64(b64) } : s;
    } catch (e) {
      console.warn('[smudge] tile file read failed for export:', s.bakedTilePath, e);
      return s;
    }
  }));
};

/**
 * Render all strokes to a base64 PNG (no data-URI prefix) at the canvas's device resolution.
 * `canvasDipWidth/Height` are the logical canvas dimensions used while drawing. Returns null on
 * failure. `backgroundColor` defaults to transparent.
 */
export const renderStrokesToBase64 = (
  strokes: Stroke[],
  canvasDipWidth: number,
  canvasDipHeight: number,
  backgroundColor?: string | null
): string | null => {
  const wPx = Math.max(1, Math.round(canvasDipWidth * DPR));
  const hPx = Math.max(1, Math.round(canvasDipHeight * DPR));
  // Raster surface: smudge replays on the CPU (readPixels is a fast memcpy here, no GPU context).
  const surface = Skia.Surface.Make(wPx, hPx);
  if (!surface) {
    return null;
  }
  try {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color(backgroundColor ?? 'rgba(0,0,0,0)'));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    for (let i = 0; i < strokes.length; i += 1) {
      appendStrokeToSurface(canvas, strokes[i], canvasDipWidth, canvasDipHeight, paint, wPx, hPx);
    }
    const snapshot = surface.makeImageSnapshot();
    const base64 = snapshot.encodeToBase64();
    snapshot.dispose?.();
    return base64 ?? null;
  } catch (error) {
    console.warn('[smudge] offscreen render failed', error);
    return null;
  } finally {
    surface.dispose?.();
  }
};

/**
 * Render all strokes to a temp PNG file and return its file:// URI (null on failure).
 *
 * This is the engine-agnostic still-image export: it replays strokes through the same
 * Skia path the canvas uses, so it produces a correct PNG whether the live engine is
 * the native Metal canvas or Skia — and, unlike capturing the live view, it works even
 * though the capture canvas is rendered off-screen / hidden (which can yield a blank
 * PNG for a Metal MTKView). Use for gallery upload + share.
 */
export const renderStrokesToPngFile = async (
  strokes: Stroke[],
  canvasDipWidth: number,
  canvasDipHeight: number,
  backgroundColor?: string | null
): Promise<string | null> => {
  // Pull each smudge tile's base64 from its file first (file-based tile store), then replay.
  const resolved = await resolveSmudgeTilesFromFiles(strokes);
  const base64 = renderStrokesToBase64(resolved, canvasDipWidth, canvasDipHeight, backgroundColor);
  if (!base64) {
    return null;
  }
  try {
    const path = `${FileSystem.cacheDirectory}painting-${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
    return path;
  } catch (error) {
    console.warn('[export] write png file failed', error);
    return null;
  }
};
