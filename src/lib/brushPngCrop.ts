/**
 * Brush PNG cropping
 *
 * A captured canvas is mostly empty space — the artwork typically fills only a small part of the
 * full canvas rect. Saved as-is, a custom brush stamp is mostly transparent margin, which makes the
 * effective brush tiny and any canvas edge treatment visible as a frame around every stamp.
 *
 * This trims the fully-transparent margin down to the artwork's bounding box, then pads back out to
 * a SQUARE. The square matters: `makeEmojiStamp` draws the whole PNG into a square destination rect,
 * so a non-square crop would come out stretched.
 */
import { Skia } from '@shopify/react-native-skia';

/** Alpha at or below this counts as empty. Above the 33 the edge vignette used to leave behind. */
const ALPHA_FLOOR = 40;

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Bounding box of pixels with meaningful alpha, or null when the image is effectively empty. */
const findContentBounds = (
  pixels: Uint8Array,
  width: number,
  height: number
): Bounds | null => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (pixels[rowStart + x * 4 + 3] <= ALPHA_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  return right < 0 || bottom < 0 ? null : { left, top, right, bottom };
};

/**
 * Trim transparent margins from a base64 PNG and re-emit it as a square.
 * Returns the ORIGINAL base64 unchanged if anything is off (undecodable, empty, already tight) —
 * a slightly loose brush is always better than a lost one.
 */
export const cropBrushPngMargins = (base64: string): string => {
  try {
    const data = Skia.Data.fromBase64(base64);
    const image = data ? Skia.Image.MakeImageFromEncoded(data) : null;
    if (!image) {
      console.warn('[brushPngCrop] could not decode PNG — keeping original');
      return base64;
    }

    const width = image.width();
    const height = image.height();
    const pixels = image.readPixels() as Uint8Array | null;
    if (!pixels || width <= 0 || height <= 0) {
      console.warn('[brushPngCrop] could not read pixels — keeping original');
      image.dispose?.();
      return base64;
    }

    const bounds = findContentBounds(pixels, width, height);
    if (!bounds) {
      console.warn('[brushPngCrop] image is fully transparent — keeping original');
      image.dispose?.();
      return base64;
    }

    const contentWidth = bounds.right - bounds.left + 1;
    const contentHeight = bounds.bottom - bounds.top + 1;

    // Already tight enough that cropping would not buy anything.
    if (contentWidth >= width * 0.98 && contentHeight >= height * 0.98) {
      image.dispose?.();
      return base64;
    }

    const side = Math.max(contentWidth, contentHeight);
    const surface = Skia.Surface.Make(side, side);
    if (!surface) {
      console.warn('[brushPngCrop] could not create surface — keeping original');
      image.dispose?.();
      return base64;
    }

    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    // Centre the content inside the square so the stamp stays visually balanced.
    const dstX = (side - contentWidth) / 2;
    const dstY = (side - contentHeight) / 2;
    canvas.drawImageRect(
      image,
      Skia.XYWHRect(bounds.left, bounds.top, contentWidth, contentHeight),
      Skia.XYWHRect(dstX, dstY, contentWidth, contentHeight),
      Skia.Paint()
    );

    const snapshot = surface.makeImageSnapshot();
    const cropped = snapshot?.encodeToBase64();
    surface.dispose?.();
    snapshot?.dispose?.();
    image.dispose?.();

    if (!cropped) {
      console.warn('[brushPngCrop] encode failed — keeping original');
      return base64;
    }

    console.log(
      `[brushPngCrop] ✂️ ${width}x${height} → ${side}x${side} (content ${contentWidth}x${contentHeight})`
    );
    return cropped;
  } catch (error) {
    console.warn('[brushPngCrop] crop failed, keeping original:', error);
    return base64;
  }
};

export default { cropBrushPngMargins };
