import React, { memo, useEffect, useMemo, useRef } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import {
  BlendMode,
  Canvas,
  Circle,
  FilterMode,
  Group,
  Image as SkImageNode,
  listFontFamilies,
  MipmapMode,
  Skia,
  TileMode,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  type SkRect,
  type Transforms3d,
  VertexMode
} from '@shopify/react-native-skia';

import type { Stroke, StrokePoint } from '../state/PaintingContext';
import { orderStrokesByLayer } from '../state/PaintingContext';
import { isMetalPaintEngineEnabled } from '../config/features';
import { isCustomBrushReference, getCachedCustomBrushPNG } from '../lib/customBrushRegistry';
import { sampleLattice, latticeSide, type LatticeLevel } from '../lib/planeLattice';
import { appendSmudgeToSurface } from '../lib/smudge/appendSmudge';
import { GpuLiveSmudgeSession, clearSmudgeSurfacePool } from '../lib/smudge/gpuLiveSmudge';
import { blitTile, cropToTile, decodeTileBase64 } from '../lib/smudge/gpuSmudge';
import { getSmudgeTile, putSmudgeTile } from '../lib/smudge/smudgeTileCache';
import type { SmudgeRegion } from '../lib/smudge/smudgeTypes';
import { measureStampInkBounds, type InkBounds } from '../lib/stampInkBounds';

interface EmojiCanvasProps {
  width: number;
  height: number;
  strokes: Stroke[];
  liveStroke?: Stroke | null;
  liveVersion?: number;
  backgroundColor?: string;
  /**
   * Decorative inset vignette on the canvas edges. MUST be off for offscreen canvases that get
   * captured (custom brush stamps, exports) — otherwise the 18px rgba(0,0,0,0.13) edge is baked
   * into the captured PNG and every stamp of that brush carries a faint black frame.
   */
  showVignette?: boolean;
  previewStroke?: Stroke | null;
}

type SkSurfaceInstance = ReturnType<typeof Skia.Surface.MakeOffscreen>;

const DPR = PixelRatio.get();
const TRANSPARENT = Skia.Color('rgba(0,0,0,0)');
const INITIAL_DIGEST = 2166136261;
const FNV_PRIME = 16777619;

// CRITICAL MEMORY FIX: DISABLE CHECKPOINTS COMPLETELY
// iPad has 3x DPR × 1024px = 3072px canvas, each snapshot is ~40MB!
// User still reports 50MB/stroke - main culprit was SkSurface leaks in makeEmojiStamp
// Checkpoints add overhead without benefit - DISABLE for maximum memory efficiency
const CHECKPOINT_INTERVAL = 999999; // Effectively disabled
const CHECKPOINT_INTERVAL_LARGE = 999999; // Disabled
const CHECKPOINT_INTERVAL_HUGE = 999999; // Disabled
const MAX_CHECKPOINTS_NORMAL = 0; // NO checkpoints ever
const MAX_CHECKPOINTS_LARGE = 0; // NO checkpoints ever
const MAX_CHECKPOINTS_HUGE = 0; // NO checkpoints ever
const RESAMPLE_CURVATURE_THRESHOLD = 0.985;
const MIN_RESAMPLE_SPACING = 0.03; // Reduced from 0.08 for better fast stroke capture
const PLANE_STAMP_SIZE = 128;
const PLANE_MESH_DIVISIONS = 9;

type PlanePoint = { x: number; y: number };
type PlaneCorners = {
  topLeft: PlanePoint;
  topRight: PlanePoint;
  bottomRight: PlanePoint;
  bottomLeft: PlanePoint;
};

const gaussianElimination = (A: number[][], b: number[]): number[] => {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }

    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

    for (let k = i + 1; k < n; k += 1) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j <= n; j += 1) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }

  const x: number[] = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    x[i] = augmented[i][n];
    for (let j = i + 1; j < n; j += 1) {
      x[i] -= augmented[i][j] * x[j];
    }
    x[i] /= augmented[i][i];
  }

  return x;
};

const solveHomography = (corners: PlaneCorners): number[][] => {
  const { topLeft, topRight, bottomRight, bottomLeft } = corners;
  const src = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ];
  const dst = [topLeft, topRight, bottomRight, bottomLeft];
  const A: number[][] = [];

  for (let i = 0; i < 4; i += 1) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
  }

  const b = [
    dst[0].x, dst[0].y,
    dst[1].x, dst[1].y,
    dst[2].x, dst[2].y,
    dst[3].x, dst[3].y
  ];

  const h = gaussianElimination(A, b);
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1.0]
  ];
};

const applyHomography = (H: number[][], u: number, v: number): PlanePoint => {
  const w = H[2][0] * u + H[2][1] * v + H[2][2];
  return {
    x: (H[0][0] * u + H[0][1] * v + H[0][2]) / w,
    y: (H[1][0] * u + H[1][1] * v + H[1][2]) / w
  };
};

const generatePerspectiveMesh = (
  corners: PlaneCorners,
  divisions: number,
  textureSize: { width: number; height: number },
  inkBounds: InkBounds
): { vertices: PlanePoint[]; textures: PlanePoint[]; indices: number[] } => {
  const vertices: PlanePoint[] = [];
  const textures: PlanePoint[] = [];
  const indices: number[] = [];

  const H = solveHomography(corners);

  // Crop to the glyph's MEASURED ink bounds (measureStampInkBounds), not a hand-tuned flat
  // constant — must match generateLatticeMesh/generatePerspectiveMesh in CanvasViewport.tsx AND
  // the native Metal renderer's own per-glyph measurement, or a committed plane bakes a visibly
  // different crop than the live preview showed.
  const textureStart = textureSize.width * inkBounds.u0;
  const textureEnd = textureSize.width * inkBounds.u1;
  const textureStartY = textureSize.height * inkBounds.v0;
  const textureEndY = textureSize.height * inkBounds.v1;

  for (let row = 0; row <= divisions; row += 1) {
    const v = row / divisions;
    for (let col = 0; col <= divisions; col += 1) {
      const u = col / divisions;
      vertices.push(applyHomography(H, u, v));
      textures.push({
        x: textureStart + (textureEnd - textureStart) * u,
        y: textureStartY + (textureEndY - textureStartY) * v
      });
    }
  }

  for (let row = 0; row < divisions; row += 1) {
    for (let col = 0; col < divisions; col += 1) {
      const topLeft = row * (divisions + 1) + col;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + (divisions + 1);
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight);
      indices.push(topRight, bottomLeft, bottomRight);
    }
  }

  return { vertices, textures, indices };
};

interface BackingStore {
  getCanvas: () => SkCanvas | null;
  commit: () => SkImage | null;
  clear: () => void;
  getSnapshot: () => SkImage | null;
  makeSnapshot: () => SkImage | null;
  widthPx: number;
  heightPx: number;
  surfaceVersion: number;
  snapshotVersion: number;
}

interface ProcessedState {
  surfaceVersion: number;
  ids: string[];
  signatures: string[];
  digests: number[];
}

interface Checkpoint {
  count: number;
  digest: number;
  snapshot: SkImage;
}

export interface StampEntry {
  image: SkImage;
  srcRect: SkRect;
  widthPx: number;
  heightPx: number;
  widthDip: number;
  heightDip: number;
  /** Tight alpha crop of this bitmap (0..1) — see measureStampInkBounds. */
  inkBounds: InkBounds;
}

export interface PreparedCommand {
  stamp?: StampEntry;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  flipX: boolean;
  flipY: boolean;
  rotation: number;
  radius?: number; // For eraser circles
}

export interface PreparedPreview {
  opacity: number;
  commands: PreparedCommand[];
  isEraser?: boolean;
}

const stampCache = new Map<string, StampEntry>();
const stampCacheOrder: string[] = [];
// CRITICAL MEMORY FIX: Ultra-aggressive stamp cache limits
// Each stamp is a high-res SkImage (1-5MB on iPad 3x DPR!)
// PLUS we were leaking the SkSurface used to create each stamp (360KB each!)
const MAX_STAMP_CACHE_SIZE = 20; // Reduced from 30 - ULTRA AGGRESSIVE
const MAX_STAMP_CACHE_SIZE_LARGE = 10; // Reduced from 15 - for 150+ strokes
const MAX_STAMP_CACHE_SIZE_HUGE = 5; // Reduced from 8 - for 500+ strokes
const failedStampKeys = new Set<string>();
const FONT_MANAGER = Skia.FontMgr.System();
const AVAILABLE_FONT_FAMILIES = FONT_MANAGER
  ? new Set(listFontFamilies(FONT_MANAGER))
  : new Set<string>();

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

// Clear stamp cache to free memory (called when needed for large stroke counts)
const clearStampCacheToSize = (maxSize: number) => {
  while (stampCacheOrder.length > maxSize) {
    const stale = stampCacheOrder.shift();
    if (stale) {
      // CRITICAL MEMORY FIX: Dispose SkImage before removing from cache!
      const entry = stampCache.get(stale);
      if (entry?.image) {
        entry.image.dispose?.();
      }
      stampCache.delete(stale);
    }
  }
};

const useBackingStore = (width: number, height: number): BackingStore => {
  const surfaceRef = useRef<SkSurfaceInstance | null>(null);
  const snapshotRef = useRef<SkImage | null>(null);
  const [surfaceVersion, setSurfaceVersion] = React.useState(0);
  const [snapshotVersion, setSnapshotVersion] = React.useState(0);
  const [size, setSize] = React.useState({ widthPx: Math.max(1, Math.floor(width * DPR)), heightPx: Math.max(1, Math.floor(height * DPR)) });

  useEffect(() => {
    const widthPx = Math.max(1, Math.floor(width * DPR));
    const heightPx = Math.max(1, Math.floor(height * DPR));
    const surface = Skia.Surface.Make(widthPx, heightPx);
    if (!surface && typeof console !== 'undefined') {
      console.warn(`useBackingStore: failed to create surface ${widthPx}x${heightPx}`);
    }

    // CRITICAL MEMORY FIX: Dispose old snapshot before replacing
    if (snapshotRef.current) {
      snapshotRef.current.dispose?.();
    }

    surfaceRef.current = surface;
    setSize({ widthPx, heightPx });
    if (surface) {
      const canvas = surface.getCanvas();
      canvas.clear(TRANSPARENT);
      snapshotRef.current = surface.makeImageSnapshot();
    } else {
      snapshotRef.current = null;
    }
    setSurfaceVersion((value) => value + 1);
    setSnapshotVersion((value) => value + 1);
    return () => {
      // CRITICAL MEMORY FIX: Dispose on cleanup
      if (snapshotRef.current) {
        snapshotRef.current.dispose?.();
      }
      surfaceRef.current = null;
      snapshotRef.current = null;
    };
  }, [width, height]);

  const getCanvas = React.useCallback(() => surfaceRef.current?.getCanvas() ?? null, []);

  const getSnapshot = React.useCallback(() => snapshotRef.current, []);

  const commit = React.useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      // CRITICAL MEMORY FIX: Dispose old snapshot before clearing
      if (snapshotRef.current) {
        snapshotRef.current.dispose?.();
      }
      snapshotRef.current = null;
      return null;
    }
    // CRITICAL MEMORY FIX: Dispose old snapshot before creating new one
    if (snapshotRef.current) {
      snapshotRef.current.dispose?.();
    }
    snapshotRef.current = surface.makeImageSnapshot();
    setSnapshotVersion((value) => value + 1);
    return snapshotRef.current;
  }, []);

  const clear = React.useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    surface.getCanvas().clear(TRANSPARENT);
  }, []);

  const makeSnapshot = React.useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return null;
    }
    return surface.makeImageSnapshot();
  }, []);

  return {
    getCanvas,
    commit,
    clear,
    getSnapshot,
    makeSnapshot,
    widthPx: size.widthPx,
    heightPx: size.heightPx,
    surfaceVersion,
    snapshotVersion
  };
};

const PREFERRED_FONT_FAMILIES = [
  'Apple Color Emoji',
  'AppleColorEmoji',
  'Noto Color Emoji',
  'NotoColorEmoji',
  'Segoe UI Emoji',
  'SegoeUIEmoji',
  'SamsungColorEmoji',
  'TwemojiMozilla',
  'EmojiOne Color',
  'EmojiOneColor',
  'System Emoji',
  'SystemEmoji',
  'System',
  'sans-serif'
] as const;

export const makeEmojiStamp = (emoji: string, px: number): SkImage | null => {
  // Check if this is a custom brush ID reference (from CustomBrushRegistry)
  if (isCustomBrushReference(emoji)) {
    const cachedBase64 = getCachedCustomBrushPNG(emoji);
    if (cachedBase64) {
      // Found in cache! Convert to data URI and process like normal custom PNG
      const dataUri = `data:image/png;base64,${cachedBase64}`;
      return makeEmojiStamp(dataUri, px);
    } else {
      console.warn(`[EmojiCanvas] Custom brush ${emoji} not yet loaded. Returning null.`);
      return null;
    }
  }

  // Check if this is a custom PNG brush (base64 data URI)
  if (emoji.startsWith('data:image/png;base64,')) {
    try {
      // Extract base64 data
      const base64Data = emoji.replace('data:image/png;base64,', '');

      const dataFromBase64 = (Skia.Data as any)?.fromBase64?.(base64Data);
      let image = dataFromBase64
        ? Skia.Image.MakeImageFromEncoded(dataFromBase64)
        : null;

      if (!image) {
        // Fallback to manual decode for environments without Skia.Data.fromBase64
        const binaryString = typeof atob === 'function' ? atob(base64Data) : '';
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        image = Skia.Image.MakeImageFromEncoded((Skia.Data as any).fromBytes(bytes));
      }

      if (!image) {
        console.warn(`[EmojiCanvas] Failed to load custom PNG image from data URI`);
        return null;
      }

      const imageWidth = image.width();
      const imageHeight = image.height();

      if (imageWidth <= 0 || imageHeight <= 0) {
        console.warn(`[EmojiCanvas] Custom PNG has invalid dimensions: ${imageWidth}x${imageHeight}px`);
        image.dispose?.();
        return null;
      }

      console.log(`[EmojiCanvas] Loaded custom PNG: ${imageWidth}x${imageHeight}px, scaling to ${px}px`);

      // Create surface at requested size
      const surface = Skia.Surface.Make(Math.max(1, px), Math.max(1, px));
      if (!surface) {
        console.warn(`[EmojiCanvas] Failed to create surface for custom PNG stamp`);
        image.dispose?.();
        return null;
      }

      const canvas = surface.getCanvas();
      canvas.clear(TRANSPARENT);

      try {
        // Draw the image scaled to fit the destination size
        const srcRect = Skia.XYWHRect(0, 0, imageWidth, imageHeight);
        const dstRect = Skia.XYWHRect(0, 0, px, px);
        canvas.drawImageRect(image, srcRect, dstRect, Skia.Paint());

        const snapshot = surface.makeImageSnapshot();
        surface.dispose?.();
        image.dispose?.();

        if (stampCache.size < 5) {
          console.log(`[EmojiCanvas] ✅ Created custom PNG stamp ${px}px`);
        }

        return snapshot;
      } catch (error) {
        console.error(`[EmojiCanvas] Error drawing custom PNG stamp:`, error);
        surface.dispose?.();
        image.dispose?.();
        return null;
      }
    } catch (error) {
      console.warn(`[EmojiCanvas] Failed to process custom PNG:`, error);
      return null;
    }
  }

  // Regular emoji rendering
  const sizeDip = Math.max(1, px / DPR);
  const padDip = Math.ceil(sizeDip * 0.4);
  const families = PREFERRED_FONT_FAMILIES.filter((family) => AVAILABLE_FONT_FAMILIES.has(family));
  const builder = Skia.ParagraphBuilder.Make(
    {
      textStyle: {
        fontFamilies: families.length > 0 ? families : ['System', 'sans-serif'],
        fontSize: sizeDip,
      },
    },
    (FONT_MANAGER ?? undefined) as unknown as any
  );
  builder.addText(emoji);
  const paragraph = builder.build();
  const layoutWidth = Math.max(sizeDip * 2, 16);
  paragraph.layout(layoutWidth);
  const paragraphWidthDip = paragraph.getMaxIntrinsicWidth?.() ?? paragraph.getLongestLine?.() ?? sizeDip;
  const paragraphHeightDip = paragraph.getHeight?.() ?? sizeDip;
  const widthDip = Math.max(sizeDip, paragraphWidthDip) + padDip * 2;
  const heightDip = Math.max(sizeDip, paragraphHeightDip) + padDip * 2;
  const widthPx = Math.max(1, Math.ceil(widthDip * DPR));
  const heightPx = Math.max(1, Math.ceil(heightDip * DPR));
  const surface = Skia.Surface.Make(widthPx, heightPx);
  if (!surface) {
    if (!failedStampKeys.has(`${emoji}-${px}-surface`)) {
      failedStampKeys.add(`${emoji}-${px}-surface`);
      console.warn(`makeEmojiStamp: failed to create surface ${widthPx}x${heightPx}`);
    }
    return null;
  }
  const canvas = surface.getCanvas();
  canvas.clear(TRANSPARENT);
  canvas.save();
  canvas.scale(DPR, DPR);
  paragraph.paint(canvas, padDip, padDip);
  canvas.restore();
  const snapshot = surface.makeImageSnapshot();

  // CRITICAL MEMORY FIX: Dispose the surface immediately after creating snapshot!
  // This was the 50MB/stroke leak - surfaces were NEVER disposed!
  // Each surface on iPad (3x DPR) for 100px emoji = 300x300px = ~360KB
  // Fast drawing creates 50-100+ surfaces/second = MASSIVE LEAK
  surface.dispose?.();

  // Debug: Log first few stamp creations to verify disposal is working
  if (stampCache.size < 5) {
    console.log(`[EmojiCanvas] Created stamp ${emoji} size ${px}px, disposed surface`);
  }

  if (!snapshot && !failedStampKeys.has(`${emoji}-${px}`)) {
    failedStampKeys.add(`${emoji}-${px}`);
    console.warn(`makeEmojiStamp: snapshot failed for ${emoji} size ${sizeDip}`);
  }
  return snapshot;
};

// Export function to force clear stamp cache when needed
export const clearStampCache = () => {
  const clearedCount = stampCache.size;
  // Dispose all stamps
  stampCache.forEach((entry) => {
    if (entry?.image) {
      entry.image.dispose?.();
    }
  });
  stampCache.clear();
  stampCacheOrder.length = 0;
  console.log(`[EmojiCanvas] Forcefully cleared ${clearedCount} stamps from cache`);
};

export const getStamp = (emoji: string, size: number): StampEntry | null => {
  const px = Math.max(2, Math.round(size * DPR));
  const key = `${emoji}::${px}`;
  const cached = stampCache.get(key);
  if (cached) {
    const index = stampCacheOrder.indexOf(key);
    if (index >= 0 && index !== stampCacheOrder.length - 1) {
      stampCacheOrder.splice(index, 1);
      stampCacheOrder.push(key);
    }
    return cached;
  }
  const image = makeEmojiStamp(emoji, px);
  if (!image) {
    if (!failedStampKeys.has(key)) {
      failedStampKeys.add(key);
      console.warn(`getStamp: unable to create image snapshot for ${emoji} size ${size}`);
    }
    return null;
  }
  const widthPx = image.width();
  const heightPx = image.height();
  const entry: StampEntry = {
    image,
    srcRect: Skia.XYWHRect(0, 0, widthPx, heightPx),
    widthPx,
    heightPx,
    widthDip: widthPx / DPR,
    heightDip: heightPx / DPR,
    inkBounds: measureStampInkBounds(key, image)
  };
  stampCache.set(key, entry);
  stampCacheOrder.push(key);
  if (stampCacheOrder.length > MAX_STAMP_CACHE_SIZE) {
    const stale = stampCacheOrder.shift();
    if (stale) {
      // CRITICAL MEMORY FIX: Dispose SkImage before removing from cache!
      const oldEntry = stampCache.get(stale);
      if (oldEntry?.image) {
        oldEntry.image.dispose?.();
      }
      stampCache.delete(stale);
    }
  }
  return entry;
};

const computeStrokeSignature = (stroke: Stroke): string => {
  const { points } = stroke;
  const length = points.length;
  const last = length > 0 ? points[length - 1] : { x: 0, y: 0 };
  let hash = 1469598103;
  if (length > 0) {
    const step = Math.max(1, Math.floor(length / 12));
    for (let i = 0; i < length; i += step) {
      const point = points[i];
      const hx = Math.round(point.x * 10) & 0xffff;
      const hy = Math.round(point.y * 10) & 0xffff;
      hash = ((hash * 16777619) ^ (hx << 16) ^ hy) >>> 0;
    }
  }
  const sequenceLength = stroke.emojiSequence?.length ?? 0;
  const plane = stroke.planeCorners;
  const planeSignature = stroke.isPlane && plane
    ? [
      Math.round(plane.topLeft.x * 10),
      Math.round(plane.topLeft.y * 10),
      Math.round(plane.topRight.x * 10),
      Math.round(plane.topRight.y * 10),
      Math.round(plane.bottomRight.x * 10),
      Math.round(plane.bottomRight.y * 10),
      Math.round(plane.bottomLeft.x * 10),
      Math.round(plane.bottomLeft.y * 10)
    ].join(',')
    : '';
  const smudgeSignature = stroke.isSmudge
    ? `s${stroke.smudgeStrength ?? ''},${stroke.edgeBlendStrength ?? ''},${stroke.reloadRate ?? ''},${stroke.dirtyUpdateRate ?? ''}`
    : '';
  return [
    stroke.id,
    stroke.emoji,
    stroke.size.toFixed(2),
    stroke.opacity.toFixed(3),
    stroke.mirrorX ? '1' : '0',
    stroke.mirrorY ? '1' : '0',
    length,
    Math.round((last?.x ?? 0) * 10),
    Math.round((last?.y ?? 0) * 10),
    stroke.spacing ?? 0,
    sequenceLength,
    planeSignature,
    smudgeSignature,
    hash.toString(36)
  ].join('|');
};

const advanceDigest = (prev: number, signature: string): number => {
  let hash = prev;
  for (const char of signature) {
    const code = char.codePointAt(0) ?? 0;
    hash ^= code;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
};

const previewSignature = (stroke: Stroke): string => {
  const { points } = stroke;
  if (points.length === 0) {
    return `${stroke.id}-0`;
  }
  const last = points[points.length - 1];
  return `${stroke.id}-${points.length}-${Math.round(last.x * 10)}-${Math.round(last.y * 10)}`;
};

const resolveResampleSpacing = (stroke: Stroke): number => {
  const span = Math.max(1, stroke.stampSpan ?? stroke.size * 1.1);
  const normalized = typeof stroke.spacing === 'number' ? clamp01(stroke.spacing) : 0.12;
  const base = span * 0.06;
  const extra = span * (0.18 * normalized + 0.02);
  return Math.max(MIN_RESAMPLE_SPACING, base + extra);
};

const distanceSq = (a: StrokePoint, b: StrokePoint): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const curvatureCosine = (a: StrokePoint, b: StrokePoint, c: StrokePoint): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const abLen = Math.hypot(abx, aby);
  const bcLen = Math.hypot(bcx, bcy);
  if (abLen === 0 || bcLen === 0) {
    return 1;
  }
  return (abx * bcx + aby * bcy) / (abLen * bcLen);
};

const adaptiveResamplePoints = (points: StrokePoint[], minSpacing: number): StrokePoint[] => {
  if (points.length <= 2) {
    return points;
  }
  const spacing = Math.max(MIN_RESAMPLE_SPACING, minSpacing);
  const spacingSq = spacing * spacing;
  const result: StrokePoint[] = [points[0]];
  let lastKept = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    if (distanceSq(current, lastKept) >= spacingSq) {
      result.push(current);
      lastKept = current;
      continue;
    }
    const next = points[i + 1];
    if (curvatureCosine(lastKept, current, next) < RESAMPLE_CURVATURE_THRESHOLD) {
      result.push(current);
      lastKept = current;
    }
  }
  result.push(points[points.length - 1]);
  return result;
};

// Interpolate stamps ALONG each segment at `spacing` so fast strokes (sparse points) stay continuous —
// the same approach the native Metal engine uses. Replaces the filter-only resample that left gaps.
const interpolateStrokePoints = (points: StrokePoint[], spacing: number): StrokePoint[] => {
  if (points.length === 0) {
    return points;
  }
  const step = Math.max(0.5, spacing);
  const out: StrokePoint[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.min(2048, Math.ceil(dist / step)));
    const aw = a.w;
    const bw = b.w;
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const w = aw !== undefined && bw !== undefined ? aw + (bw - aw) * t : bw ?? aw;
      out.push({ x: a.x + dx * t, y: a.y + dy * t, t: b.t, ...(w !== undefined ? { w } : {}) });
    }
  }
  return out;
};

export const appendStrokeToSurface = (
  canvas: SkCanvas,
  stroke: Stroke,
  width: number,
  height: number,
  paint: SkPaint,
  surfaceWpx?: number,
  surfaceHpx?: number,
  liveResult?: { id: string; image: SkImage; bounds: SmudgeRegion } | null
): boolean => {
  if (stroke.points.length === 0) {
    return false;
  }

  if (stroke.isSmudge) {
    const wPx = surfaceWpx ?? Math.max(1, Math.floor(width * DPR));
    const hPx = surfaceHpx ?? Math.max(1, Math.floor(height * DPR));

    // 1) In-memory baked tile (this session): blit it. Cheap, deterministic, full-res.
    const cached = getSmudgeTile(stroke.id);
    if (cached) {
      blitTile(canvas, cached.image, cached.bounds, paint);
      return true;
    }

    // 2) COMMIT: the live overlay sub-rect IS the bake tile. Copy it into the cache, persist it on
    //    the stroke (PNG), and blit. No re-bake, identical to the live preview.
    if (liveResult && liveResult.id === stroke.id && liveResult.image) {
      const full: SmudgeRegion = { x: 0, y: 0, w: liveResult.image.width(), h: liveResult.image.height() };
      const tile = cropToTile(liveResult.image, full); // independent copy (cache owns it)
      if (tile) {
        // Cache the tile in memory only (cheap). PNG encoding for persistence happens later, when
        // autosave runs on idle (see PaintingContext) — encoding here, even deferred, blocked the
        // next stroke because it runs in the gap between strokes.
        putSmudgeTile(stroke.id, tile, liveResult.bounds);
        blitTile(canvas, tile, liveResult.bounds, paint);
        return true;
      }
      blitTile(canvas, liveResult.image, liveResult.bounds, paint);
      return true;
    }

    // 3) PERSISTED tile (loaded painting): decode the PNG once, cache it, blit.
    if (stroke.bakedTile && stroke.bakedBounds) {
      const img = decodeTileBase64(stroke.bakedTile);
      if (img) {
        const bounds: SmudgeRegion = {
          x: Math.round(stroke.bakedBounds.x * DPR),
          y: Math.round(stroke.bakedBounds.y * DPR),
          w: Math.round(stroke.bakedBounds.w * DPR),
          h: Math.round(stroke.bakedBounds.h * DPR)
        };
        putSmudgeTile(stroke.id, img, bounds);
        blitTile(canvas, img, bounds, paint);
        return true;
      }
    }

    // 4) Metal-baked smudge (file-based tile): the native Metal canvas already renders this smudge.
    //    The Skia path here is only the HIDDEN capture canvas / fallback, and it re-runs on every stroke
    //    — doing the expensive per-pixel CPU smudge here (step 5) was the real, size×length-scaling
    //    post-stroke FREEZE, independent of the Metal engine. Skip it; export resolves the tile file →
    //    base64 into `bakedTile` separately (so step 3 handles export correctly).
    if (stroke.bakedTilePath) {
      return true;
    }

    // 4b) Metal engine active → ALL smudges are native Metal. A just-committed smudge has NO bakedTilePath
    //     yet (the native bake is deferred ~1.5s), so without this guard it fell to the CPU smudge below on
    //     EVERY hidden-capture re-render during that window → the 2–4s post-smudge JS-thread FREEZE.
    //     Metal renders the smudge; export resolves the tile file separately. So skip the CPU path entirely.
    if (isMetalPaintEngineEnabled()) {
      return true;
    }

    // 5) FALLBACK (legacy Skia smudge, no tile at all): CPU smudge — robust, no GPU surfaces.
    return appendSmudgeToSurface(canvas, stroke, paint, wPx, hPx, getStamp);
  }

  if (stroke.isPlane && stroke.planeCorners) {
    // Use stored stamp size from when plane was committed (default to 128 for backward compatibility)
    const stampSize = stroke.planeStampSize ?? PLANE_STAMP_SIZE;
    const stamp = getStamp(stroke.emoji, stampSize);
    if (!stamp?.image) {
      return false;
    }

    const corners = stroke.planeCorners;
    const scaledCorners: PlaneCorners = {
      topLeft: { x: corners.topLeft.x * DPR, y: corners.topLeft.y * DPR },
      topRight: { x: corners.topRight.x * DPR, y: corners.topRight.y * DPR },
      bottomRight: { x: corners.bottomRight.x * DPR, y: corners.bottomRight.y * DPR },
      bottomLeft: { x: corners.bottomLeft.x * DPR, y: corners.bottomLeft.y * DPR }
    };

    // A committed plane with a lattice must replay the SAME bent surface it was applied with.
    const bakedLattice = stroke.planeLattice;
    const bakedLevel = (stroke.planeLatticeLevel ?? 1) as LatticeLevel;
    const mesh = bakedLattice && bakedLevel > 1
      ? (() => {
          const scaled = bakedLattice.map(pt => ({ x: pt.x * DPR, y: pt.y * DPR }));
          const steps = Math.max(PLANE_MESH_DIVISIONS, latticeSide(bakedLevel) * 3);
          const texW = stamp.image.width();
          const texH = stamp.image.height();
          const { u0, v0, u1, v1 } = stamp.inkBounds;
          const vertices: any[] = [];
          const textures: any[] = [];
          const indices: number[] = [];
          for (let row = 0; row <= steps; row += 1) {
            const v = row / steps;
            for (let col = 0; col <= steps; col += 1) {
              const u = col / steps;
              const pt = sampleLattice(scaled, bakedLevel, u, v);
              // Plain points, matching generatePerspectiveMesh in this file (no vec() helper here).
              vertices.push({ x: pt.x, y: pt.y });
              textures.push({
                x: texW * (u0 + (u1 - u0) * u),
                y: texH * (v0 + (v1 - v0) * v),
              });
            }
          }
          for (let row = 0; row < steps; row += 1) {
            for (let col = 0; col < steps; col += 1) {
              const tl = row * (steps + 1) + col;
              indices.push(tl, tl + 1, tl + steps + 1, tl + 1, tl + steps + 2, tl + steps + 1);
            }
          }
          return { vertices, textures, indices };
        })()
      : generatePerspectiveMesh(
          scaledCorners,
          PLANE_MESH_DIVISIONS,
          { width: stamp.image.width(), height: stamp.image.height() },
          stamp.inkBounds
        );

    paint.setBlendMode(3); // SrcOver (default)
    paint.setAlphaf(clamp01(stroke.opacity));
    const shader = stamp.image.makeShaderOptions(
      TileMode.Clamp,
      TileMode.Clamp,
      FilterMode.Linear,
      MipmapMode.None
    );
    paint.setShader(shader);

    const vertices = Skia.MakeVertices(
      VertexMode.Triangles,
      mesh.vertices,
      mesh.textures,
      undefined,
      mesh.indices
    );
    canvas.drawVertices(vertices, BlendMode.SrcOver, paint);

    paint.setShader(null);
    shader.dispose?.();
    vertices.dispose?.();
    return true;
  }

  // Interpolate (not just filter) so fast strokes don't gap — matches the live Metal engine.
  const points = interpolateStrokePoints(stroke.points, resolveResampleSpacing(stroke));
  if (points.length === 0) {
    return false;
  }
  let touched = false;

  // ERASER: Clear pixels by drawing with Clear blend mode
  if (stroke.isEraser) {
    // Use Clear blend mode (0) which sets pixels to transparent
    paint.setBlendMode(0); // Clear = completely transparent
    paint.setColor(Skia.Color('white')); // Color doesn't matter with Clear mode
    paint.setAlphaf(1.0); // Full alpha

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const centerX = point.x * DPR;
      const centerY = point.y * DPR;
      // Use per-point width if available, otherwise fallback to stroke.size
      const pointSize = point.w ?? stroke.size;
      const radius = (pointSize / 2) * DPR;

      canvas.drawCircle(centerX, centerY, radius, paint);
      touched = true;
    }
    return touched;
  }

  // NORMAL BRUSH: Draw emoji stamps
  const opacity = clamp01(stroke.opacity);
  paint.setAlphaf(opacity);

  // NORMAL BRUSH: Draw emoji stamps
  paint.setBlendMode(3); // SrcOver (default)
  const sequence = stroke.emojiSequence;
  const sequenceLength = sequence?.length ?? 0;
  const resolvedSequence = sequenceLength > 0 ? sequence! : null;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const emoji = resolvedSequence ? resolvedSequence[i % sequenceLength] : stroke.emoji;
    // Use per-point width if available, otherwise fallback to stroke.size
    const pointSize = point.w ?? stroke.size;
    const stamp = getStamp(emoji, pointSize);
    if (!stamp) {
      continue;
    }
    const centerX = point.x * DPR;
    const centerY = point.y * DPR;
    const destRect = Skia.XYWHRect(
      Math.round(centerX - stamp.widthPx / 2),
      Math.round(centerY - stamp.heightPx / 2),
      stamp.widthPx,
      stamp.heightPx
    );
    touched = true;
    const rotationDegRaw = typeof stroke.rotation === 'number' ? stroke.rotation : 0;
    const normalizedRotation = ((rotationDegRaw % 360) + 360) % 360;
    const rotationDeg = Math.abs(normalizedRotation) < 0.0001 ? 0 : normalizedRotation;
    const flipX = Boolean(stroke.mirrorX);
    const flipY = Boolean(stroke.mirrorY);
    const needsTransform = flipX || flipY || rotationDeg !== 0;
    if (needsTransform) {
      canvas.save();
      canvas.translate(centerX, centerY);
      if (rotationDeg !== 0) {
        canvas.rotate(rotationDeg, 0, 0);
      }
      if (flipX || flipY) {
        canvas.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      }
      canvas.translate(-centerX, -centerY);
      canvas.drawImageRect(stamp.image, stamp.srcRect, destRect, paint);
      canvas.restore();
    } else {
      canvas.drawImageRect(stamp.image, stamp.srcRect, destRect, paint);
    }
  }
  return touched;
};

export const createPreview = (stroke: Stroke | null | undefined, width: number, height: number): PreparedPreview | null => {
  if (!stroke || stroke.points.length === 0) {
    return null;
  }
  // Smudge has no emoji-stamp preview — it is rendered live via a dedicated preview surface.
  if (stroke.isSmudge) {
    return null;
  }
  const points = adaptiveResamplePoints(stroke.points, resolveResampleSpacing(stroke));
  if (points.length === 0) {
    return null;
  }

  const commands: PreparedCommand[] = [];

  // ERASER: Create circle commands
  if (stroke.isEraser) {
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      // CRITICAL: Use point.w (variable width) if available, otherwise fall back to stroke.size
      const pointSize = point.w !== undefined ? point.w : stroke.size;
      const radius = pointSize / 2;
      commands.push({
        x: point.x,
        y: point.y,
        width: pointSize,
        height: pointSize,
        centerX: point.x,
        centerY: point.y,
        flipX: false,
        flipY: false,
        rotation: 0,
        radius
      });
    }
    return {
      opacity: clamp01(stroke.opacity),
      commands,
      isEraser: true
    };
  }

  // NORMAL BRUSH: Create emoji stamp commands
  const sequence = stroke.emojiSequence;
  const sequenceLength = sequence?.length ?? 0;
  const resolvedSequence = sequenceLength > 0 ? sequence! : null;
  const rotationDegRaw = typeof stroke.rotation === 'number' ? stroke.rotation : 0;
  const normalizedRotation = ((rotationDegRaw % 360) + 360) % 360;
  const rotationDeg = Math.abs(normalizedRotation) < 0.0001 ? 0 : normalizedRotation;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const emoji = resolvedSequence ? resolvedSequence[i % sequenceLength] : stroke.emoji;
    // CRITICAL: Use point.w (variable width) if available, otherwise fall back to stroke.size
    // This enables real-time size changes during drawing
    const pointSize = point.w !== undefined ? point.w : stroke.size;
    const stamp = getStamp(emoji, pointSize);
    if (!stamp) {
      continue;
    }
    const centerX = point.x;
    const centerY = point.y;
    commands.push({
      stamp,
      x: centerX - stamp.widthDip / 2,
      y: centerY - stamp.heightDip / 2,
      width: stamp.widthDip,
      height: stamp.heightDip,
      centerX,
      centerY,
      flipX: Boolean(stroke.mirrorX),
      flipY: Boolean(stroke.mirrorY),
      rotation: rotationDeg
    });
  }
  if (commands.length === 0) {
    return null;
  }
  return {
    opacity: clamp01(stroke.opacity),
    commands,
    isEraser: false
  };
};

const getMaxCheckpoints = (strokeCount: number): number => {
  if (strokeCount > 500) return MAX_CHECKPOINTS_HUGE;
  if (strokeCount > 150) return MAX_CHECKPOINTS_LARGE;
  return MAX_CHECKPOINTS_NORMAL;
};

const trimCheckpoints = (count: number, digests: number[], checkpoints: Checkpoint[], strokeCount: number) => {
  const maxCheckpoints = getMaxCheckpoints(strokeCount);

  // CRITICAL MEMORY FIX: Dispose old snapshots before removing!
  for (let i = checkpoints.length - 1; i >= 0; i -= 1) {
    const checkpoint = checkpoints[i];
    if (checkpoint.count > count) {
      // DISPOSE the snapshot to free memory!
      if (checkpoint.snapshot) {
        checkpoint.snapshot.dispose?.();
      }
      checkpoints.splice(i, 1);
      continue;
    }
    const digest = digests[checkpoint.count - 1];
    if (digest === undefined || digest !== checkpoint.digest) {
      // DISPOSE the snapshot to free memory!
      if (checkpoint.snapshot) {
        checkpoint.snapshot.dispose?.();
      }
      checkpoints.splice(i, 1);
    }
  }

  // CRITICAL: When trimming old checkpoints, dispose them first!
  if (checkpoints.length > maxCheckpoints) {
    const removed = checkpoints.splice(0, checkpoints.length - maxCheckpoints);
    removed.forEach(cp => {
      if (cp.snapshot) {
        cp.snapshot.dispose?.();
      }
    });
  }
};

const storeCheckpoint = (checkpoints: Checkpoint[], entry: Checkpoint, strokeCount: number) => {
  const maxCheckpoints = getMaxCheckpoints(strokeCount);

  // CRITICAL MEMORY FIX: Dispose old snapshot if replacing
  const existingIndex = checkpoints.findIndex((checkpoint) => checkpoint.count === entry.count);
  if (existingIndex !== -1) {
    const old = checkpoints[existingIndex];
    if (old.snapshot) {
      old.snapshot.dispose?.();
    }
    checkpoints.splice(existingIndex, 1);
  }

  checkpoints.push(entry);
  checkpoints.sort((a, b) => a.count - b.count);

  // CRITICAL: Dispose oldest checkpoints when trimming
  if (checkpoints.length > maxCheckpoints) {
    const removed = checkpoints.splice(0, checkpoints.length - maxCheckpoints);
    removed.forEach(cp => {
      if (cp.snapshot) {
        cp.snapshot.dispose?.();
      }
    });
  }
};

const rebuildSurface = (
  strokes: Stroke[],
  width: number,
  height: number,
  canvas: SkCanvas,
  paint: SkPaint,
  processed: ProcessedState,
  checkpoints: Checkpoint[],
  backing: BackingStore
) => {
  const targetCount = strokes.length;
  if (targetCount === 0) {
    canvas.clear(TRANSPARENT);
    processed.ids = [];
    processed.signatures = [];
    processed.digests = [];
    // CRITICAL MEMORY FIX: Dispose all checkpoints when clearing!
    checkpoints.forEach(cp => {
      if (cp.snapshot) {
        cp.snapshot.dispose?.();
      }
    });
    checkpoints.length = 0;
    return;
  }
  const signatures = new Array<string>(targetCount);
  const digests = new Array<number>(targetCount);
  let digest = INITIAL_DIGEST;
  for (let i = 0; i < targetCount; i += 1) {
    const signature = computeStrokeSignature(strokes[i]);
    signatures[i] = signature;
    digest = advanceDigest(digest, signature);
    digests[i] = digest;
  }

  let baseIndex = 0;
  let baseSnapshot: SkImage | null = null;
  for (let i = checkpoints.length - 1; i >= 0; i -= 1) {
    const checkpoint = checkpoints[i];
    if (checkpoint.count > targetCount) {
      // CRITICAL MEMORY FIX: Dispose before removing!
      if (checkpoint.snapshot) {
        checkpoint.snapshot.dispose?.();
      }
      checkpoints.splice(i, 1);
      continue;
    }
    const expectedDigest = digests[checkpoint.count - 1];
    if (expectedDigest === checkpoint.digest) {
      baseIndex = checkpoint.count;
      baseSnapshot = checkpoint.snapshot;
      break;
    }
    // CRITICAL MEMORY FIX: Dispose before removing!
    if (checkpoint.snapshot) {
      checkpoint.snapshot.dispose?.();
    }
    checkpoints.splice(i, 1);
  }

  canvas.clear(TRANSPARENT);
  if (baseSnapshot) {
    const srcRect = Skia.XYWHRect(0, 0, baseSnapshot.width(), baseSnapshot.height());
    const destRect = Skia.XYWHRect(0, 0, backing.widthPx, backing.heightPx);
    paint.setAlphaf(1);
    canvas.drawImageRect(baseSnapshot, srcRect, destRect, paint);
  }

  const ids = new Array<string>(targetCount);
  for (let i = 0; i < baseIndex; i += 1) {
    const stroke = strokes[i];
    ids[i] = stroke.id;
  }

  // AGGRESSIVE memory optimization: adaptive checkpoint interval based on stroke count
  let checkpointInterval = CHECKPOINT_INTERVAL;
  if (targetCount > 500) {
    checkpointInterval = CHECKPOINT_INTERVAL_HUGE;
  } else if (targetCount > 150) {
    checkpointInterval = CHECKPOINT_INTERVAL_LARGE;
  }

  for (let i = baseIndex; i < targetCount; i += 1) {
    const stroke = strokes[i];
    appendStrokeToSurface(canvas, stroke, width, height, paint, backing.widthPx, backing.heightPx);
    ids[i] = stroke.id;
    if ((i + 1) % checkpointInterval === 0) {
      const snapshot = backing.makeSnapshot();
      if (snapshot) {
        storeCheckpoint(checkpoints, { count: i + 1, digest: digests[i], snapshot }, targetCount);
      }
    }
  }

  trimCheckpoints(targetCount, digests, checkpoints, targetCount);
  processed.ids = ids;
  processed.signatures = signatures;
  processed.digests = digests;
};

const syncSurfaceWithStrokes = (
  strokes: Stroke[],
  width: number,
  height: number,
  canvas: SkCanvas,
  paint: SkPaint,
  processedRef: React.MutableRefObject<ProcessedState>,
  checkpointsRef: React.MutableRefObject<Checkpoint[]>,
  backing: BackingStore,
  liveResult?: { id: string; image: SkImage; bounds: SmudgeRegion } | null
): boolean => {
  const processed = processedRef.current;
  if (processed.surfaceVersion !== backing.surfaceVersion) {
    processed.surfaceVersion = backing.surfaceVersion;
    processed.ids = [];
    processed.signatures = [];
    processed.digests = [];
    // CRITICAL MEMORY FIX: Dispose old checkpoints before clearing!
    checkpointsRef.current.forEach(cp => {
      if (cp.snapshot) {
        cp.snapshot.dispose?.();
      }
    });
    checkpointsRef.current = [];
    rebuildSurface(strokes, width, height, canvas, paint, processed, checkpointsRef.current, backing);
    return true;
  }

  const processedIds = processed.ids;
  const processedSignatures = processed.signatures;
  const targetCount = strokes.length;
  const processedCount = processedIds.length;

  if (processedCount > targetCount) {
    rebuildSurface(strokes, width, height, canvas, paint, processed, checkpointsRef.current, backing);
    processed.surfaceVersion = backing.surfaceVersion;
    return true;
  }

  let prefix = 0;
  const limit = Math.min(processedCount, targetCount);
  for (; prefix < limit; prefix += 1) {
    const stroke = strokes[prefix];
    if (processedIds[prefix] !== stroke.id) {
      break;
    }
    const signature = computeStrokeSignature(stroke);
    if (processedSignatures[prefix] !== signature) {
      break;
    }
  }

  if (prefix < processedCount || processedCount > targetCount) {
    rebuildSurface(strokes, width, height, canvas, paint, processed, checkpointsRef.current, backing);
    processed.surfaceVersion = backing.surfaceVersion;
    return true;
  }

  if (targetCount === processedCount) {
    return false;
  }

  // AGGRESSIVE memory optimization: adaptive checkpoint interval based on stroke count
  let checkpointInterval = CHECKPOINT_INTERVAL;
  if (targetCount > 500) {
    checkpointInterval = CHECKPOINT_INTERVAL_HUGE;
  } else if (targetCount > 150) {
    checkpointInterval = CHECKPOINT_INTERVAL_LARGE;
  }

  let digest = processedCount > 0 ? processed.digests[processedCount - 1] : INITIAL_DIGEST;
  for (let i = processedCount; i < targetCount; i += 1) {
    const stroke = strokes[i];
    appendStrokeToSurface(canvas, stroke, width, height, paint, backing.widthPx, backing.heightPx, liveResult);
    const signature = computeStrokeSignature(stroke);
    processedIds.push(stroke.id);
    processedSignatures.push(signature);
    digest = advanceDigest(digest, signature);
    processed.digests.push(digest);
    if ((i + 1) % checkpointInterval === 0) {
      const snapshot = backing.makeSnapshot();
      if (snapshot) {
        storeCheckpoint(checkpointsRef.current, { count: i + 1, digest, snapshot }, targetCount);
      }
    }
  }

  trimCheckpoints(targetCount, processed.digests, checkpointsRef.current, targetCount);
  processed.surfaceVersion = backing.surfaceVersion;
  return true;
};

const EmojiCanvas: React.FC<EmojiCanvasProps> = ({
  width,
  height,
  strokes,
  liveStroke,
  liveVersion,
  backgroundColor,
  previewStroke,
  showVignette = true
}) => {
  const backing = useBackingStore(width, height);
  /**
   * 3-LAYER ORDER. The Skia path bakes strokes into ONE surface, so layering is expressed as paint
   * order: background → middle → foreground, regardless of creation order. `orderStrokesByLayer`
   * returns the SAME array reference when nothing has to move (i.e. every painting that never used
   * layers), so this is a no-op for existing artwork — identical render input, identical memo
   * identity, no extra rebuild.
   *
   * Visibility is applied upstream (CanvasViewport) so every renderer behind PaintCanvas agrees;
   * here we only guarantee the ORDER, which keeps this component correct even when a caller hands
   * it raw, unordered strokes (offscreen captures, other screens).
   *
   * COST NOTE: reordering breaks `syncSurfaceWithStrokes`'s common-prefix fast path when a stroke is
   * added to a layer that is not the topmost non-empty one, which costs a full surface rebuild for
   * that stroke. That is why the DEFAULT engine (native Metal) uses one committed texture per layer
   * instead; this Skia path is the fallback (custom brushes / no Metal view).
   */
  const layeredStrokes = useMemo(() => orderStrokesByLayer(strokes), [strokes]);
  const processedRef = useRef<ProcessedState>({ surfaceVersion: -1, ids: [], signatures: [], digests: [] });
  const checkpointsRef = useRef<Checkpoint[]>([]);
  const surfacePaintRef = useRef<SkPaint>(Skia.Paint());
  // Live smudge runs entirely on the GPU (SkSL shader) on a separate work surface; its full-canvas
  // snapshot is shown instead of the committed one while drawing. The committed surface is never
  // mutated until commit (then appendStrokeToSurface re-bakes deterministically).
  const liveSmudgeSessionRef = useRef<GpuLiveSmudgeSession | null>(null);
  // The latest live dirty-rect image + device-px bounds keyed by stroke id; the commit reuses it as
  // the bake tile instead of re-baking.
  const liveSmudgeResultRef = useRef<{ id: string; image: SkImage; bounds: SmudgeRegion } | null>(null);
  // The previous stroke's final overlay image, disposed at the next stroke begin (deferred so React
  // is no longer referencing it — avoids a per-stroke leak).
  const staleSmudgeSnapRef = useRef<SkImage | null>(null);
  const smudgeProfRef = useRef({ frames: 0, updateMs: 0 });
  const [liveSmudgeOverlay, setLiveSmudgeOverlay] = React.useState<
    { image: SkImage; x: number; y: number; width: number; height: number } | null
  >(null);

  useEffect(() => {
    surfacePaintRef.current.setAntiAlias(true);
  }, []);

  // CRITICAL MEMORY FIX: Cleanup checkpoints and stamps on unmount
  useEffect(() => {
    return () => {
      const checkpointCount = checkpointsRef.current.length;
      const stampCount = stampCache.size;
      console.log(`[EmojiCanvas] 🧹 CLEANUP: Disposing ${checkpointCount} checkpoints and ${stampCount} stamps`);

      // Dispose all checkpoints
      checkpointsRef.current.forEach(cp => {
        if (cp.snapshot) {
          cp.snapshot.dispose?.();
        }
      });
      checkpointsRef.current = [];

      // CRITICAL: Dispose all stamps on unmount
      stampCache.forEach((entry) => {
        if (entry?.image) {
          entry.image.dispose?.();
        }
      });
      stampCache.clear();
      stampCacheOrder.length = 0;

      // Dispose live-smudge GPU resources.
      liveSmudgeSessionRef.current?.end();
      liveSmudgeSessionRef.current = null;
      staleSmudgeSnapRef.current?.dispose?.();
      staleSmudgeSnapRef.current = null;
      clearSmudgeSurfacePool();

      console.log('[EmojiCanvas] ✅ Cleanup complete');
    };
  }, []);

  useEffect(() => {
    // AGGRESSIVE MEMORY MANAGEMENT: Clear stamp cache for large stroke counts
    const strokeCount = strokes.length;
    const oldCacheSize = stampCacheOrder.length;
    if (strokeCount > 500) {
      clearStampCacheToSize(MAX_STAMP_CACHE_SIZE_HUGE);
      if (oldCacheSize > MAX_STAMP_CACHE_SIZE_HUGE) {
        console.log(`[EmojiCanvas] 💾 Cleared stamp cache: ${oldCacheSize} → ${MAX_STAMP_CACHE_SIZE_HUGE} (${strokeCount} strokes)`);
      }
    } else if (strokeCount > 150) {
      clearStampCacheToSize(MAX_STAMP_CACHE_SIZE_LARGE);
      if (oldCacheSize > MAX_STAMP_CACHE_SIZE_LARGE) {
        console.log(`[EmojiCanvas] 💾 Cleared stamp cache: ${oldCacheSize} → ${MAX_STAMP_CACHE_SIZE_LARGE} (${strokeCount} strokes)`);
      }
    }

    const canvas = backing.getCanvas();
    if (!canvas) {
      processedRef.current.ids = [];
      processedRef.current.signatures = [];
      processedRef.current.digests = [];
      // CRITICAL MEMORY FIX: Dispose old checkpoints before clearing!
      checkpointsRef.current.forEach(cp => {
        if (cp.snapshot) {
          cp.snapshot.dispose?.();
        }
      });
      checkpointsRef.current = [];
      return;
    }
    const didChange = syncSurfaceWithStrokes(
      layeredStrokes,
      width,
      height,
      canvas,
      surfacePaintRef.current,
      processedRef,
      checkpointsRef,
      backing,
      liveSmudgeResultRef.current
    );
    if (didChange) {
      backing.commit();
    }
  }, [
    layeredStrokes,
    strokes,
    width,
    height,
    backing.surfaceVersion,
    backing.getCanvas,
    backing.commit
  ]);

  // LIVE SMUDGE: GPU SkSL shader on a reused work surface; display only the dirty sub-rect overlay.
  useEffect(() => {
    const stroke = liveStroke ?? null;

    // End a session, keeping its final overlay image alive one extra stroke (React may still
    // reference it this frame); the previous stale one is now safe to dispose.
    const endSession = (sess: GpuLiveSmudgeSession | null) => {
      if (!sess) {
        return;
      }
      const last = sess.getOverlay()?.image ?? null;
      sess.end();
      staleSmudgeSnapRef.current?.dispose?.();
      staleSmudgeSnapRef.current = last;
    };

    const teardown = () => {
      if (liveSmudgeSessionRef.current) {
        endSession(liveSmudgeSessionRef.current);
        liveSmudgeSessionRef.current = null;
      }
      liveSmudgeResultRef.current = null;
      if (liveSmudgeOverlay) {
        setLiveSmudgeOverlay(null);
      }
    };

    if (!stroke || !stroke.isSmudge) {
      teardown();
      return;
    }

    const tStart = Date.now();
    let session = liveSmudgeSessionRef.current;
    if (!session || session.strokeId !== stroke.id) {
      endSession(session);
      // The session acquires an adaptive-resolution work surface from a pool (no per-stroke alloc).
      session = GpuLiveSmudgeSession.begin(backing.getSnapshot(), stroke, backing.widthPx, backing.heightPx, getStamp);
      liveSmudgeSessionRef.current = session;
      console.log(`[smudge] BEGIN size=${stroke.size} gpu=${session ? 'yes' : 'NO(fallback)'} beginMs=${Date.now() - tStart}`);
      if (session) {
        session.consumeDirty();
      }
    } else {
      session.update(stroke);
      if (!session.consumeDirty()) {
        return; // nothing changed this frame
      }
    }
    if (!session) {
      return;
    }
    const overlay = session.getOverlay();
    if (overlay) {
      // The dirty sub-rect image is both the live overlay AND the bake tile reused at commit.
      liveSmudgeResultRef.current = { id: stroke.id, image: overlay.image, bounds: overlay.bounds };
      setLiveSmudgeOverlay({
        image: overlay.image,
        x: overlay.bounds.x / DPR,
        y: overlay.bounds.y / DPR,
        width: overlay.bounds.w / DPR,
        height: overlay.bounds.h / DPR
      });
    }

    const prof = smudgeProfRef.current;
    prof.frames += 1;
    prof.updateMs += Date.now() - tStart;
    if (prof.frames >= 15) {
      console.log(`[smudge] ${prof.frames}f avg frame=${(prof.updateMs / prof.frames).toFixed(1)}ms`);
      prof.frames = 0;
      prof.updateMs = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStroke, liveVersion, backing.getSnapshot, backing.widthPx, backing.heightPx, backing.surfaceVersion]);

  const livePreviewKey = liveStroke ? previewSignature(liveStroke) : null;
  const livePreview = useMemo(
    () => createPreview(liveStroke ?? null, width, height),
    [liveStroke, liveVersion, width, height, livePreviewKey]
  );

  const hoverPreviewKey = previewStroke ? previewSignature(previewStroke) : null;
  const hoverPreview = useMemo(
    () => createPreview(previewStroke ?? null, width, height),
    [previewStroke, width, height, hoverPreviewKey]
  );

  const resolvedBackground = backgroundColor ?? '#030303';
  const snapshot = backing.getSnapshot();

  return (
    <View style={[styles.container, { width, height, backgroundColor: resolvedBackground }]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {snapshot && (
          <SkImageNode image={snapshot} x={0} y={0} width={width} height={height} fit="fill" />
        )}
        {liveSmudgeOverlay && (
          <SkImageNode
            image={liveSmudgeOverlay.image}
            x={liveSmudgeOverlay.x}
            y={liveSmudgeOverlay.y}
            width={liveSmudgeOverlay.width}
            height={liveSmudgeOverlay.height}
            fit="fill"
            blendMode="src"
          />
        )}
        {livePreview && livePreview.isEraser && (
          <Group>
            {livePreview.commands.map((command, index) => {
              // ERASER: Show cursor outline only (actual erasing happens when stroke commits)
              if (command.radius !== undefined) {
                return (
                  <Circle
                    key={`eraser-cursor-${index}`}
                    cx={command.centerX}
                    cy={command.centerY}
                    r={command.radius}
                    style="stroke"
                    strokeWidth={2}
                    color="rgba(255,255,255,0.5)"
                  />
                );
              }
              return null;
            })}
          </Group>
        )}
        {livePreview && !livePreview.isEraser && (
          <Group opacity={livePreview.opacity}>
            {livePreview.commands.map((command, index) => {

              // NORMAL BRUSH: Render emoji stamp
              const hasFlip = command.flipX || command.flipY;
              const hasRotation = Math.abs(command.rotation) > 0.0001;
              const transforms: Transforms3d | undefined = (() => {
                if (!hasFlip && !hasRotation) {
                  return undefined;
                }
                const result: Transforms3d = [
                  { translateX: command.centerX },
                  { translateY: command.centerY }
                ];
                if (hasRotation) {
                  result.push({ rotate: (command.rotation * Math.PI) / 180 });
                }
                if (hasFlip) {
                  result.push({ scaleX: command.flipX ? -1 : 1 });
                  result.push({ scaleY: command.flipY ? -1 : 1 });
                }
                result.push({ translateX: -command.centerX }, { translateY: -command.centerY });
                return result;
              })();
              return (
                <SkImageNode
                  key={`live-${index}`}
                  image={command.stamp!.image}
                  x={command.x}
                  y={command.y}
                  width={command.width}
                  height={command.height}
                  fit="fill"
                  transform={transforms}
                />
              );
            })}
          </Group>
        )}
        {hoverPreview && !hoverPreview.isEraser && (
          <Group opacity={hoverPreview.opacity}>
            {hoverPreview.commands.map((command, index) => {

              // NORMAL BRUSH: Render emoji stamp
              const hasFlip = command.flipX || command.flipY;
              const hasRotation = Math.abs(command.rotation) > 0.0001;
              const transforms: Transforms3d | undefined = (() => {
                if (!hasFlip && !hasRotation) {
                  return undefined;
                }
                const result: Transforms3d = [
                  { translateX: command.centerX },
                  { translateY: command.centerY }
                ];
                if (hasRotation) {
                  result.push({ rotate: (command.rotation * Math.PI) / 180 });
                }
                if (hasFlip) {
                  result.push({ scaleX: command.flipX ? -1 : 1 });
                  result.push({ scaleY: command.flipY ? -1 : 1 });
                }
                result.push({ translateX: -command.centerX }, { translateY: -command.centerY });
                return result;
              })();
              return (
                <SkImageNode
                  key={`hover-${index}`}
                  image={command.stamp!.image}
                  x={command.x}
                  y={command.y}
                  width={command.width}
                  height={command.height}
                  fit="fill"
                  transform={transforms}
                />
              );
            })}
          </Group>
        )}
      </Canvas>
      {/* Subtle inset vignette — darkens canvas edges slightly */}
      {showVignette && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderWidth: 18,
            borderColor: 'rgba(0,0,0,0.13)',
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    overflow: 'hidden'
  }
});

export default memo(EmojiCanvas);
