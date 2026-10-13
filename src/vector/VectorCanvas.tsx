import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { BlendMode, Canvas, CanvasRef, ClipOp, Fill, FilterMode, Group, Image as SkiaImage, Line, MipmapMode, Picture, Skia, SkImage, SkPicture, TileMode, VertexMode, useImage } from '@shopify/react-native-skia';
import type { SkCanvas, SkPaint, SkParagraph } from '@shopify/react-native-skia';
import { PixelRatio } from 'react-native';
import type { Stroke } from '../state/PaintingContext';
import { getVectorStamp, releaseVectorStamp, retainVectorStamp } from './vectorStampCache';
import { appendSmudgeToSurface } from '../lib/smudge/appendSmudge';
import { visibleWorldRect } from './vectorCamera';
import {
  cameraNeedsScreenSpaceProjection,
  intersectStampWithViewport,
  projectWorldPoint,
  SCREEN_SPACE_REBASE_ZOOM,
  shouldUseScreenSpaceProjection,
  strokeIntersectsWorldRect,
  type StampViewportIntersection,
} from './vectorProjection';
import { IncrementalVectorSpatialIndex, spatialRectForCamera } from './vectorSpatialIndex';
import { VectorCameraState, VectorStroke, VectorTraceImage } from './vectorTypes';
import { latticeSide, projectPlanePoint, sampleLattice, type LatticeLevel } from '../lib/planeLattice';

// Vector renderer (V1, Skia):
// - each stroke is recorded ONCE per zoom-bucket as a world-space SkPicture
//   (stamp images re-rasterized per bucket → crisp at any zoom, LOD-with-
//   hysteresis in miniature; density never changes with camera movement);
// - the camera is a single Group matrix → pan/zoom never re-record pictures;
// - strokes are culled against the visible world rect; native picture/image
//   lifetimes are deferred so a frame can finish before resources are retired.

const DPR = PixelRatio.get();

/** Keep float-backed Skia matrices pixel-accurate by rebasing before this. */
const SCREEN_EMOJI_BASE_PX = 256;
/** Never ask native Skia to apply a transform larger than this. */
const MAX_SAFE_TRANSFORM_PX = 8_192;
/** Prevent a subpixel source rect from collapsing to zero in Skia's float coordinates. */
const MIN_RASTER_SOURCE_SPAN_PX = 1 / 1024;
/** Throttle camera-aware smudge replay during pinch, pan, and viewpoint flights. */
const SCENE_REPLAY_DELAY_MS = 48;
/** At most one CPU dirty-region smudge preview per display frame. */
const LIVE_SMUDGE_FRAME_MS = 16;
/** Bound retained per-stroke pictures; the vector document remains the source of truth. */
const MAX_CACHED_STROKE_PICTURES = 192;

// Crash diagnostics only — no behaviour change. A native Skia crash kills the
// process with no JS error, so the last line to reach Metro is the only
// evidence of what the renderer was doing. Throttled to real zoom changes.
let lastLoggedZoom = 0;
function logZoomFrame(camera: VectorCameraState, info: () => string): void {
  if (!__DEV__) return;
  const ratio = lastLoggedZoom > 0 ? camera.zoom / lastLoggedZoom : Infinity;
  if (ratio > 0.85 && ratio < 1.18) return;
  lastLoggedZoom = camera.zoom;
  console.log(`[VectorDBG] zoom=${camera.zoom.toExponential(3)} ${info()}`);
}

function stampImage(emoji: string, bucketPx: number): SkImage | null {
  return getVectorStamp(emoji, Math.max(4, bucketPx / DPR))?.image ?? null;
}

function canRenderEmojiAsVector(emoji: string): boolean {
  return !emoji.startsWith('custom_brush_') && !emoji.startsWith('data:image/');
}

function normalizedRotationDegrees(rotationDegrees: number): number {
  if (!Number.isFinite(rotationDegrees)) return 0;
  return ((rotationDegrees % 360) + 360) % 360;
}

/** Power-of-two raster bucket for the projected stamp size (hysteresis-free crispness). */
function zoomBucketPx(worldSize: number, zoom: number): number {
  const px = Math.max(1, worldSize * zoom * DPR);
  const bucket = Math.pow(2, Math.ceil(Math.log2(px)));
  return Math.min(2048, Math.max(8, bucket));
}

/** Record one stroke's stamps as a world-space picture (skip factor = LOD coarsening). */
interface RecordedPicture {
  picture: SkPicture;
  /** Images retained by the picture until its native object is disposed. */
  images: SkImage[];
  /** True when the picture is already in screen coordinates and must not receive the camera matrix. */
  screenSpace?: boolean;
  disposalScheduled?: boolean;
}

type PlanePoint = { x: number; y: number };

function boundedPlaneScreenPoint(point: PlanePoint, width: number, height: number, margin = MAX_SAFE_TRANSFORM_PX): PlanePoint {
  return {
    x: Math.max(-margin, Math.min(width + margin, point.x)),
    y: Math.max(-margin, Math.min(height + margin, point.y)),
  };
}

function planeMesh(
  stroke: VectorStroke,
  imageWidth: number,
  imageHeight: number,
  inkBounds: { u0: number; v0: number; u1: number; v1: number },
  mapPoint: (point: PlanePoint) => PlanePoint,
) {
  if (!stroke.planeCorners) return null;
  const level = (stroke.planeLatticeLevel ?? 1) as LatticeLevel;
  const lattice = stroke.planeLattice;
  const steps = lattice && level > 1 ? Math.max(9, latticeSide(level) * 3) : 9;
  const vertices: PlanePoint[] = [];
  const textures: PlanePoint[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= steps; row += 1) {
    const v = row / steps;
    for (let col = 0; col <= steps; col += 1) {
      const u = col / steps;
      const point = lattice && level > 1
        ? sampleLattice(lattice, level, u, v)
        : projectPlanePoint(stroke.planeCorners, u, v);
      vertices.push(mapPoint(point));
      textures.push({
        x: imageWidth * (inkBounds.u0 + (inkBounds.u1 - inkBounds.u0) * u),
        y: imageHeight * (inkBounds.v0 + (inkBounds.v1 - inkBounds.v0) * v),
      });
    }
  }
  for (let row = 0; row < steps; row += 1) {
    for (let col = 0; col < steps; col += 1) {
      const topLeft = row * (steps + 1) + col;
      indices.push(topLeft, topLeft + 1, topLeft + steps + 1, topLeft + 1, topLeft + steps + 2, topLeft + steps + 1);
    }
  }
  return { vertices, textures, indices };
}

/** The one plane draw path used by editing, committed playback, snapshots and export. */
function drawPlaneMesh(
  canvas: SkCanvas,
  stroke: VectorStroke,
  requestedStampSize: number,
  mapPoint: (point: PlanePoint) => PlanePoint,
  paint: SkPaint,
): SkImage | null {
  if (!stroke.isPlane || !stroke.planeCorners) return null;
  // Plane texture resolution is authored state, not a camera LOD. Keeping it fixed (128 for the
  // normal 📐 tool) makes ink bounds and UVs identical before/after Apply and while zooming.
  const stamp = getVectorStamp(stroke.emoji, Math.max(4, stroke.planeStampSize ?? requestedStampSize));
  if (!stamp?.image) return null;
  const mesh = planeMesh(stroke, stamp.image.width(), stamp.image.height(), stamp.inkBounds, mapPoint);
  if (!mesh) return null;
  const shader = stamp.image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
  const vertices = Skia.MakeVertices(VertexMode.Triangles, mesh.vertices, mesh.textures, undefined, mesh.indices);
  paint.setBlendMode(BlendMode.SrcOver);
  paint.setAlphaf(Math.max(0, Math.min(1, stroke.opacity)));
  paint.setShader(shader);
  canvas.drawVertices(vertices, BlendMode.SrcOver, paint);
  paint.setShader(null);
  vertices.dispose?.();
  shader.dispose?.();
  return stamp.image;
}

function recordPlanePicture(stroke: VectorStroke, bucketPx: number): RecordedPicture | null {
  if (!stroke.planeCorners) return null;
  const recorder = Skia.PictureRecorder();
  const pad = Math.max(1e-12, stroke.worldSize * 0.05);
  const canvas = recorder.beginRecording(Skia.XYWHRect(
    stroke.worldBounds.minX - pad,
    stroke.worldBounds.minY - pad,
    stroke.worldBounds.maxX - stroke.worldBounds.minX + pad * 2,
    stroke.worldBounds.maxY - stroke.worldBounds.minY + pad * 2,
  ));
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const image = drawPlaneMesh(canvas, stroke, Math.max(4, bucketPx / DPR), (point) => point, paint);
  const picture = recorder.finishRecordingAsPicture();
  if (!image) { picture.dispose?.(); return null; }
  retainVectorStamp(image);
  return { picture, images: [image] };
}

interface ScalableEmojiParagraph {
  paragraph: SkParagraph;
  width: number;
  height: number;
}

function makeScalableEmojiParagraph(emoji: string, fontSize: number): ScalableEmojiParagraph | null {
  if (!canRenderEmojiAsVector(emoji)) return null;
  try {
    const safeSize = Math.max(0.0001, fontSize);
    const paragraph = Skia.ParagraphBuilder.Make(
      {
        textStyle: {
          fontFamilies: ['Apple Color Emoji', 'Noto Color Emoji', 'System', 'sans-serif'],
          fontSize: safeSize,
        },
      },
    );
    paragraph.addText(emoji);
    const built = paragraph.build();
    built.layout(Math.max(1, safeSize * 3));
    return {
      paragraph: built,
      width: Math.max(safeSize, built.getMaxIntrinsicWidth()),
      height: Math.max(safeSize, built.getHeight()),
    };
  } catch (error) {
    console.warn('[Vector] scalable emoji paragraph failed:', error);
    return null;
  }
}

function recordScalableEmojiPicture(stroke: VectorStroke, skip = 1): RecordedPicture | null {
  const positions = stroke.stampPositions ?? [];
  if (positions.length === 0) return null;
  const emoji = makeScalableEmojiParagraph(stroke.emoji, SCREEN_EMOJI_BASE_PX);
  if (!emoji) return null;
  const localSize = Math.max(emoji.width, emoji.height);
  const scale = stroke.worldSize / localSize;
  const recorder = Skia.PictureRecorder();
  const pad = stroke.worldSize;
  const canvas = recorder.beginRecording(
    Skia.XYWHRect(
      stroke.worldBounds.minX - pad,
      stroke.worldBounds.minY - pad,
      stroke.worldBounds.maxX - stroke.worldBounds.minX + pad * 2,
      stroke.worldBounds.maxY - stroke.worldBounds.minY + pad * 2,
    ),
  );
  const layerPaint = Skia.Paint();
  layerPaint.setAlphaf(Math.max(0, Math.min(1, stroke.opacity)));
  canvas.saveLayer(layerPaint);
  const rotation = normalizedRotationDegrees(stroke.rotationDegrees);
  const flipX = Boolean(stroke.mirrorX);
  const flipY = Boolean(stroke.mirrorY);
  for (let i = 0; i < positions.length; i += skip) {
    const point = positions[i];
    canvas.save();
    canvas.translate(point.x, point.y);
    if (rotation !== 0) canvas.rotate(rotation, 0, 0);
    canvas.scale((flipX ? -1 : 1) * scale, (flipY ? -1 : 1) * scale);
    canvas.translate(-emoji.width / 2, -emoji.height / 2);
    emoji.paragraph.paint(canvas, 0, 0);
    canvas.restore();
  }
  canvas.restore();
  const picture = recorder.finishRecordingAsPicture();
  emoji.paragraph.dispose?.();
  return { picture, images: [] };
}

function recordStrokePicture(stroke: VectorStroke, bucketPx: number, skip: number): RecordedPicture | null {
  if (stroke.isPlane) return recordPlanePicture(stroke, bucketPx);
  const positions = stroke.stampPositions ?? [];
  if (positions.length === 0) return null;
  if (canRenderEmojiAsVector(stroke.emoji)) return recordScalableEmojiPicture(stroke, skip);
  const img = stampImage(stroke.emoji, bucketPx);
  if (!img) return null;
  const recorder = Skia.PictureRecorder();
  const pad = stroke.worldSize;
  const canvas = recorder.beginRecording(
    Skia.XYWHRect(
      stroke.worldBounds.minX - pad,
      stroke.worldBounds.minY - pad,
      stroke.worldBounds.maxX - stroke.worldBounds.minX + pad * 2,
      stroke.worldBounds.maxY - stroke.worldBounds.minY + pad * 2
    )
  );
  const paint = Skia.Paint();
  paint.setAlphaf(Math.max(0, Math.min(1, stroke.opacity)));
  const src = Skia.XYWHRect(0, 0, img.width(), img.height());
  const half = stroke.worldSize / 2;
  const rotation = normalizedRotationDegrees(stroke.rotationDegrees);
  const flipX = Boolean(stroke.mirrorX);
  const flipY = Boolean(stroke.mirrorY);
  const needsTransform = flipX || flipY || rotation !== 0;
  for (let i = 0; i < positions.length; i += skip) {
    const p = positions[i];
    const dst = Skia.XYWHRect(p.x - half, p.y - half, stroke.worldSize, stroke.worldSize);
    if (needsTransform) {
      canvas.save();
      canvas.translate(p.x, p.y);
      if (rotation !== 0) canvas.rotate(rotation, 0, 0);
      if (flipX || flipY) canvas.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      canvas.translate(-p.x, -p.y);
      canvas.drawImageRect(img, src, dst, paint);
      canvas.restore();
    } else {
      canvas.drawImageRect(img, src, dst, paint);
    }
  }
  const picture = recorder.finishRecordingAsPicture();
  retainVectorStamp(img);
  return { picture, images: [img] };
}

function recordTilePicture(tileRect: { minX: number; minY: number; maxX: number; maxY: number }, pictures: CachedPicture[]): RecordedPicture | null {
  if (pictures.length === 0) return null;
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(
    Skia.XYWHRect(tileRect.minX, tileRect.minY, tileRect.maxX - tileRect.minX, tileRect.maxY - tileRect.minY),
  );
  canvas.clipRect(
    Skia.XYWHRect(tileRect.minX, tileRect.minY, tileRect.maxX - tileRect.minX, tileRect.maxY - tileRect.minY),
    ClipOp.Intersect,
    true,
  );
  for (const picture of pictures) canvas.drawPicture(picture.picture);
  const picture = recorder.finishRecordingAsPicture();
  const images = [...new Set(pictures.flatMap((entry) => entry.images))];
  for (const image of images) retainVectorStamp(image);
  return { picture, images };
}

function lodSkipForZoom(zoom: number): number {
  // Stamp centers are authored geometry, not a display-resolution LOD. Every
  // camera must show the same spacing and density; culling and tile caching
  // handle performance without silently dropping centers.
  return 1;
}

function tileLodForZoom(zoom: number): number {
  return Math.max(-30, Math.min(30, Math.floor(Math.log2(Math.max(zoom, 1e-9)))));
}

function tileWorldSizeForLod(lod: number): number {
  return 256 / Math.pow(2, lod);
}

function tileCoordinatesForPoint(x: number, y: number, tileWorldSize: number): { x: number; y: number } {
  return { x: Math.floor(x / tileWorldSize), y: Math.floor(y / tileWorldSize) };
}

function clampSourceSpan(start: number, end: number, maximum: number): [number, number] {
  if (end - start >= MIN_RASTER_SOURCE_SPAN_PX) return [start, end];
  const center = (start + end) / 2;
  const half = MIN_RASTER_SOURCE_SPAN_PX / 2;
  const nextStart = Math.max(0, Math.min(maximum - MIN_RASTER_SOURCE_SPAN_PX, center - half));
  return [nextStart, Math.min(maximum, nextStart + MIN_RASTER_SOURCE_SPAN_PX)];
}

/** Draw only the visible source subset into a bounded viewport rectangle. */
function drawCroppedImageStamp(
  canvas: SkCanvas,
  image: SkImage,
  intersection: StampViewportIntersection,
  paint: SkPaint,
): void {
  const imageWidth = image.width();
  const imageHeight = image.height();
  let sourceLeft = intersection.sourceLeft * imageWidth;
  let sourceRight = intersection.sourceRight * imageWidth;
  let sourceTop = intersection.sourceTop * imageHeight;
  let sourceBottom = intersection.sourceBottom * imageHeight;
  [sourceLeft, sourceRight] = clampSourceSpan(sourceLeft, sourceRight, imageWidth);
  [sourceTop, sourceBottom] = clampSourceSpan(sourceTop, sourceBottom, imageHeight);
  canvas.drawImageRectCubic(
    image,
    Skia.XYWHRect(sourceLeft, sourceTop, sourceRight - sourceLeft, sourceBottom - sourceTop),
    Skia.XYWHRect(intersection.left, intersection.top, intersection.width, intersection.height),
    0,
    0.5,
    paint,
  );
}

function inverseTransformAnchor(
  anchorX: number,
  anchorY: number,
  centerX: number,
  centerY: number,
  scale: number,
  localCenterX: number,
  localCenterY: number,
  rotationDegrees: number,
  flipX: boolean,
  flipY: boolean,
): { x: number; y: number } {
  const dx = (anchorX - centerX) / scale;
  const dy = (anchorY - centerY) / scale;
  const radians = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const unrotatedX = cos * dx + sin * dy;
  const unrotatedY = -sin * dx + cos * dy;
  return {
    x: localCenterX + (flipX ? -unrotatedX : unrotatedX),
    y: localCenterY + (flipY ? -unrotatedY : unrotatedY),
  };
}

/**
 * Apply a large scale around a source-space anchor that maps to a bounded
 * viewport point. This avoids the old huge translation followed by clipping.
 */
function withViewportAnchoredTransform(
  canvas: SkCanvas,
  centerX: number,
  centerY: number,
  projectedSize: number,
  localSize: number,
  localCenterX: number,
  localCenterY: number,
  rotationDegrees: number,
  flipX: boolean,
  flipY: boolean,
  viewportWidth: number,
  viewportHeight: number,
  draw: () => void,
): void {
  // A stamp can be mathematically much larger than the viewport at MAX_ZOOM.
  // Keep the recorded transform bounded; the viewport is already fully
  // covered at this size and an enormous Skia matrix can overflow native
  // float coordinates and terminate the process during pinch zoom.
  const safeProjectedSize = Math.min(MAX_SAFE_TRANSFORM_PX, Math.max(1, projectedSize));
  const scale = safeProjectedSize / Math.max(0.0001, localSize);
  if (!Number.isFinite(scale) || scale <= 0) return;
  const anchorX = Math.max(0, Math.min(viewportWidth, centerX));
  const anchorY = Math.max(0, Math.min(viewportHeight, centerY));
  // A giant stamp can still intersect the viewport while its centre is many
  // millions of pixels away. Preserve the visible-edge approximation, but
  // never encode that distance in the local canvas translation. The previous
  // clamp only bounded the scale; Skia still received a huge translation at
  // deep zoom and could be terminated by native float/memory pressure.
  const boundedCenterX = Math.max(
    anchorX - MAX_SAFE_TRANSFORM_PX,
    Math.min(anchorX + MAX_SAFE_TRANSFORM_PX, centerX),
  );
  const boundedCenterY = Math.max(
    anchorY - MAX_SAFE_TRANSFORM_PX,
    Math.min(anchorY + MAX_SAFE_TRANSFORM_PX, centerY),
  );
  const sourceAnchor = inverseTransformAnchor(
    anchorX,
    anchorY,
    boundedCenterX,
    boundedCenterY,
    scale,
    localCenterX,
    localCenterY,
    rotationDegrees,
    flipX,
    flipY,
  );
  canvas.save();
  canvas.translate(anchorX, anchorY);
  canvas.scale(scale, scale);
  if (rotationDegrees !== 0) canvas.rotate(rotationDegrees, 0, 0);
  if (flipX || flipY) canvas.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  canvas.translate(-sourceAnchor.x, -sourceAnchor.y);
  draw();
  canvas.restore();
}

/**
 * Extreme zoom renderer. Every visibility test uses the real projected size.
 * Drawing is rebased into viewport coordinates, so neither giant destination
 * rectangles nor a world camera matrix are passed to float-backed Skia.
 */
function recordScreenSpacePicture(
  strokes: VectorStroke[],
  camera: VectorCameraState,
  width: number,
  height: number,
  skip = 1,
): RecordedPicture | null {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, height));
  canvas.clipRect(Skia.XYWHRect(0, 0, width, height), ClipOp.Intersect, true);
  const paint = Skia.Paint();
  const retainedImages = new Set<SkImage>();
  let drawCount = 0;

  for (const stroke of strokes) {
    const projectedSize = stroke.worldSize * camera.zoom;
    if (!Number.isFinite(projectedSize) || projectedSize <= 0) continue;
    if (stroke.isPlane) {
      const image = drawPlaneMesh(
        canvas,
        stroke,
        Math.min(projectedSize, 2048 / DPR),
        (point) => boundedPlaneScreenPoint(projectWorldPoint(point.x, point.y, camera, width, height), width, height),
        paint,
      );
      if (image) {
        retainedImages.add(image);
        drawCount += 1;
      }
      continue;
    }
    const rotation = normalizedRotationDegrees(stroke.rotationDegrees);
    const flipX = Boolean(stroke.mirrorX);
    const flipY = Boolean(stroke.mirrorY);
    const needsTransform = flipX || flipY || rotation !== 0;
    // Unicode emoji stay scalable at every zoom. The previous cutoff switched
    // them to repeated 2048 px raster allocations during deep pinch zoom.
    const useParagraph = canRenderEmojiAsVector(stroke.emoji);
    const scalableEmoji = useParagraph
      ? makeScalableEmojiParagraph(stroke.emoji, SCREEN_EMOJI_BASE_PX)
      : null;
    const stamp = scalableEmoji
      ? null
      : getVectorStamp(stroke.emoji, Math.min(projectedSize, 2048 / DPR));
    if (!scalableEmoji && !stamp?.image) continue;
    const image = stamp?.image;
    if (image) retainedImages.add(image);
    const src = image ? Skia.XYWHRect(0, 0, image.width(), image.height()) : null;
    paint.setAlphaf(Math.max(0, Math.min(1, stroke.opacity)));
    if (scalableEmoji && stroke.opacity < 1) {
      canvas.saveLayer(paint, Skia.XYWHRect(0, 0, width, height));
    }
    const positions = stroke.stampPositions ?? [];
    for (let pointIndex = 0; pointIndex < positions.length; pointIndex += skip) {
      const point = positions[pointIndex];
      const screen = projectWorldPoint(point.x, point.y, camera, width, height);
      const intersection = intersectStampWithViewport(
        screen.x,
        screen.y,
        projectedSize,
        width,
        height,
        rotation,
      );
      if (!intersection) continue;
      if (scalableEmoji) {
        withViewportAnchoredTransform(
          canvas,
          screen.x,
          screen.y,
          projectedSize,
          Math.max(scalableEmoji.width, scalableEmoji.height),
          scalableEmoji.width / 2,
          scalableEmoji.height / 2,
          rotation,
          flipX,
          flipY,
          width,
          height,
          () => scalableEmoji.paragraph.paint(canvas, 0, 0),
        );
        drawCount += 1;
      } else if (!needsTransform) {
        drawCroppedImageStamp(canvas, image!, intersection, paint);
        drawCount += 1;
      } else {
        withViewportAnchoredTransform(
          canvas,
          screen.x,
          screen.y,
          projectedSize,
          SCREEN_EMOJI_BASE_PX,
          SCREEN_EMOJI_BASE_PX / 2,
          SCREEN_EMOJI_BASE_PX / 2,
          rotation,
          flipX,
          flipY,
          width,
          height,
          () => canvas.drawImageRect(
            image!,
            src!,
            Skia.XYWHRect(0, 0, SCREEN_EMOJI_BASE_PX, SCREEN_EMOJI_BASE_PX),
            paint,
          ),
        );
        drawCount += 1;
      }
    }
    if (scalableEmoji && stroke.opacity < 1) canvas.restore();
    scalableEmoji?.paragraph.dispose?.();
  }

  const picture = recorder.finishRecordingAsPicture();
  if (drawCount === 0) {
    picture.dispose?.();
    return null;
  }
  for (const image of retainedImages) retainVectorStamp(image);
  return { picture, images: [...retainedImages], screenSpace: true };
}

interface CachedPicture extends RecordedPicture {
  bucketPx: number;
  skip: number;
  sampleCount: number;
  /** Exact immutable stroke object used to record this world-space picture. */
  sourceStroke?: VectorStroke;
}

interface CachedTile extends RecordedPicture {
  tileKey: string;
  lod: number;
  bucketPx: number;
  skip: number;
  sources: VectorStroke[];
  pictureSources: CachedPicture[];
}

/**
 * React can swap a picture while the previous native frame is still drawing.
 * Dispose it a couple of frames later, and release its stamp only after the
 * picture is gone. This is important during repeated zooming: immediate
 * SkPicture/SkImage disposal was the native lifetime race behind the old crash.
 */
function disposePictureLater(recorded: RecordedPicture | null | undefined): void {
  if (!recorded || recorded.disposalScheduled) return;
  recorded.disposalScheduled = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    recorded.picture.dispose?.();
    for (const image of recorded.images) releaseVectorStamp(image);
  }));
}

function touchCachedPicture(cache: Map<string, CachedPicture>, key: string, entry: CachedPicture): void {
  // Map insertion order is used as a tiny native-picture LRU. This avoids a
  // second bookkeeping structure and keeps recently visible strokes warm.
  cache.delete(key);
  cache.set(key, entry);
}

interface SceneSnapshot {
  image: SkImage;
  camera: VectorCameraState;
  strokeIDs: string[];
}

/** Map a raster made at one camera into another camera without replaying it. */
function sceneCameraMapping(
  from: VectorCameraState,
  to: VectorCameraState,
  width: number,
  height: number
): ReturnType<typeof Skia.Matrix> | null {
  const ratio = to.zoom / from.zoom;
  const tx = width / 2 + (from.cx - to.cx) * to.zoom;
  const ty = height / 2 + (from.cy - to.cy) * to.zoom;
  // A stale smudge snapshot is disposable while its bounded replay is being
  // rebuilt. Do not feed a giant/invalid mapping into a native Group matrix.
  if (
    !Number.isFinite(ratio) ||
    !Number.isFinite(tx) ||
    !Number.isFinite(ty) ||
    ratio <= 0 ||
    ratio > SCREEN_SPACE_REBASE_ZOOM ||
    ratio < 1 / SCREEN_SPACE_REBASE_ZOOM ||
    Math.abs(tx) > MAX_SAFE_TRANSFORM_PX ||
    Math.abs(ty) > MAX_SAFE_TRANSFORM_PX
  ) return null;
  const m = Skia.Matrix();
  // screenToScreen = T(center + zoomTo*(centerFromWorld - centerTo)) *
  //                 S(zoomTo/zoomFrom) * T(-center)
  m.translate(
    tx,
    ty,
  );
  m.scale(ratio, ratio);
  m.translate(-width / 2, -height / 2);
  return m;
}

function camerasMatch(a: VectorCameraState, b: VectorCameraState): boolean {
  return a.cx === b.cx && a.cy === b.cy && a.zoom === b.zoom;
}

function drawNormalVectorStroke(
  canvas: SkCanvas,
  stroke: VectorStroke,
  camera: VectorCameraState,
  width: number,
  height: number,
  surfaceW: number,
  surfaceH: number,
  paint: SkPaint,
): void {
  const projectedSize = stroke.worldSize * camera.zoom;
  if (!Number.isFinite(projectedSize) || projectedSize <= 0) return;
  if (stroke.isPlane) {
    drawPlaneMesh(
      canvas,
      stroke,
      Math.min(projectedSize, 2048 / DPR),
      (point) => {
        const projected = projectWorldPoint(point.x, point.y, camera, width, height);
        return boundedPlaneScreenPoint(
          { x: projected.x * DPR, y: projected.y * DPR },
          surfaceW,
          surfaceH,
          MAX_SAFE_TRANSFORM_PX * DPR,
        );
      },
      paint,
    );
    return;
  }
  const sidePx = projectedSize * DPR;
  paint.setBlendMode(BlendMode.SrcOver);
  paint.setAlphaf(Math.max(0, Math.min(1, stroke.opacity)));
  const rotation = normalizedRotationDegrees(stroke.rotationDegrees);
  const flipX = Boolean(stroke.mirrorX);
  const flipY = Boolean(stroke.mirrorY);
  const needsTransform = flipX || flipY || rotation !== 0;
  // Never rasterize regular emoji at their mathematical stamp size. The
  // paragraph is painted through the bounded viewport transform instead.
  const useParagraph = canRenderEmojiAsVector(stroke.emoji);
  const scalableEmoji = useParagraph
    ? makeScalableEmojiParagraph(stroke.emoji, SCREEN_EMOJI_BASE_PX)
    : null;
  const stamp = scalableEmoji
    ? null
    : getVectorStamp(stroke.emoji, Math.min(projectedSize, 2048 / DPR));
  if (!scalableEmoji && !stamp?.image) return;
  const image = stamp?.image;
  const src = image ? Skia.XYWHRect(0, 0, image.width(), image.height()) : null;
  if (scalableEmoji && stroke.opacity < 1) {
    canvas.saveLayer(paint, Skia.XYWHRect(0, 0, surfaceW, surfaceH));
  }
  for (const point of stroke.stampPositions ?? []) {
    const projected = projectWorldPoint(point.x, point.y, camera, width, height);
    const centerX = projected.x * DPR;
    const centerY = projected.y * DPR;
    const intersection = intersectStampWithViewport(
      centerX,
      centerY,
      sidePx,
      surfaceW,
      surfaceH,
      rotation,
    );
    if (!intersection) continue;
    if (scalableEmoji) {
      withViewportAnchoredTransform(
        canvas,
        centerX,
        centerY,
        sidePx,
        Math.max(scalableEmoji.width, scalableEmoji.height),
        scalableEmoji.width / 2,
        scalableEmoji.height / 2,
        rotation,
        flipX,
        flipY,
        surfaceW,
        surfaceH,
        () => scalableEmoji.paragraph.paint(canvas, 0, 0),
      );
    } else if (!needsTransform) {
      drawCroppedImageStamp(canvas, image!, intersection, paint);
    } else {
      withViewportAnchoredTransform(
        canvas,
        centerX,
        centerY,
        sidePx,
        SCREEN_EMOJI_BASE_PX,
        SCREEN_EMOJI_BASE_PX / 2,
        SCREEN_EMOJI_BASE_PX / 2,
        rotation,
        flipX,
        flipY,
        surfaceW,
        surfaceH,
        () => canvas.drawImageRect(
          image!,
          src!,
          Skia.XYWHRect(0, 0, SCREEN_EMOJI_BASE_PX, SCREEN_EMOJI_BASE_PX),
          paint,
        ),
      );
    }
  }
  if (scalableEmoji && stroke.opacity < 1) canvas.restore();
  scalableEmoji?.paragraph.dispose?.();
}

function drawSmudgeStroke(
  canvas: SkCanvas,
  stroke: VectorStroke,
  camera: VectorCameraState,
  width: number,
  height: number,
  surfaceW: number,
  surfaceH: number,
  paint: SkPaint,
): void {
  const projectedSize = stroke.worldSize * camera.zoom;
  if (!Number.isFinite(projectedSize) || projectedSize <= 0) return;
  // The CPU smudge mask must stay bounded. At extreme zoom the viewport sees a
  // local portion of the brush, so a few viewport widths contain every pixel
  // that can affect this replay while avoiding a giant allocation.
  const safeSize = Math.min(projectedSize, Math.max(width, height) * 4);
  const safeHalf = safeSize / 2;
  const screenStroke: Stroke = {
    id: stroke.strokeID,
    emoji: stroke.emoji,
    size: safeSize,
    opacity: 1,
    spacing: stroke.spacingRatio,
    points: stroke.samples.map((sample) => {
      const point = projectWorldPoint(sample.x, sample.y, camera, width, height);
      return {
        x: Math.max(-safeHalf, Math.min(width + safeHalf, point.x)),
        y: Math.max(-safeHalf, Math.min(height + safeHalf, point.y)),
        t: sample.timeMilliseconds,
      };
    }),
    isSmudge: true,
    smudgeStrength: stroke.smudgeStrength,
    edgeBlendStrength: stroke.edgeBlendStrength,
  };
  appendSmudgeToSurface(canvas, screenStroke, paint, surfaceW, surfaceH, getVectorStamp);
}

function drawSceneStrokes(
  canvas: SkCanvas,
  strokes: VectorStroke[],
  camera: VectorCameraState,
  width: number,
  height: number,
  surfaceW: number,
  surfaceH: number,
  paint: SkPaint,
): void {
  for (const stroke of strokes) {
    if (stroke.brushMode === 'smudge') {
      drawSmudgeStroke(canvas, stroke, camera, width, height, surfaceW, surfaceH, paint);
    } else {
      drawNormalVectorStroke(canvas, stroke, camera, width, height, surfaceW, surfaceH, paint);
    }
  }
}

function renderScene(
  strokes: VectorStroke[],
  camera: VectorCameraState,
  width: number,
  height: number,
  base: SceneSnapshot | null = null,
  suffix: VectorStroke[] = strokes,
): SkImage | null {
  const surfaceW = Math.max(1, Math.round(width * DPR));
  const surfaceH = Math.max(1, Math.round(height * DPR));
  const surface = Skia.Surface.Make(surfaceW, surfaceH);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    // Smudge must sample transparency around the artwork. The visible dark
    // backdrop is supplied by <Fill>, not baked into the smudge surface.
    canvas.clear(Skia.Color('#00000000'));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    const baseMapping = base
      ? sceneCameraMapping(base.camera, camera, width * DPR, height * DPR)
      : null;
    if (base && baseMapping) {
      canvas.save();
      canvas.concat(baseMapping);
      canvas.drawImageRect(
        base.image,
        Skia.XYWHRect(0, 0, surfaceW, surfaceH),
        Skia.XYWHRect(0, 0, surfaceW, surfaceH),
        paint,
      );
      canvas.restore();
    }
    drawSceneStrokes(canvas, base ? suffix : strokes, camera, width, height, surfaceW, surfaceH, paint);
    return surface.makeImageSnapshot();
  } catch (error) {
    console.warn('[Vector] smudge scene replay failed:', error);
    return null;
  } finally {
    surface.dispose?.();
  }
}

export interface VectorCanvasProps {
  strokes: VectorStroke[];
  liveStroke: VectorStroke | null;
  camera: VectorCameraState;
  width: number;
  height: number;
  canvasRef?: React.RefObject<CanvasRef | null>;
  /** Reference photo pinned in world space (see vectorTypes.VectorTraceImage). */
  traceImage?: VectorTraceImage | null;
  traceVisible?: boolean;
  onTraceImageAspect?: (aspect: number) => void;
  editingPlaneStroke?: VectorStroke | null;
  showPlaneControls?: boolean;
}

const VectorCanvas: React.FC<VectorCanvasProps> = ({
  strokes,
  liveStroke,
  camera,
  width,
  height,
  canvasRef,
  traceImage,
  traceVisible = true,
  onTraceImageAspect,
  editingPlaneStroke = null,
  showPlaneControls = false,
}) => {
  const cacheRef = useRef<Map<string, CachedPicture>>(new Map());
  const tileCacheRef = useRef<Map<string, CachedTile>>(new Map());
  const livePictureRef = useRef<RecordedPicture | null>(null);
  const extremeZoomPictureRef = useRef<RecordedPicture | null>(null);
  const traceSkImage = useImage(traceImage?.uri ?? null);
  /**
   * Kept in a ref and SYNCED, never rebuilt per render.
   *
   * This was `useMemo(() => new VectorSpatialIndex(strokes), [strokes])`, which threw the whole
   * tree away and rebuilt it on every committed stroke — so each new stroke cost more than the
   * last and the canvas degraded the longer a session ran. sync() appends into a small buffer and
   * only rebuilds occasionally, so per-stroke cost stays flat however large the project gets.
   */
  const spatialIndexRef = useRef<IncrementalVectorSpatialIndex | null>(null);
  if (spatialIndexRef.current === null) {
    spatialIndexRef.current = new IncrementalVectorSpatialIndex();
  }
  const spatialIndex = spatialIndexRef.current;
  spatialIndex.sync(strokes);
  // React may defer the expensive content query/re-record while the camera
  // state continues to update immediately. The world picture is then drawn
  // through the current matrix, giving smooth motion while the new region is
  // prepared; extreme-zoom/smudge paths opt out because they already use
  // viewport-space safeguards.
  const deferredCamera = useDeferredValue(camera);

  // Photo-library metadata can describe an EXIF-rotated portrait as landscape
  // on some iOS versions. Skia knows the decoded orientation, so use its real
  // dimensions to correct the world-space frame before drawing it.
  useEffect(() => {
    if (!traceSkImage || !onTraceImageAspect) return;
    const imageWidth = traceSkImage.width();
    const imageHeight = traceSkImage.height();
    if (imageWidth > 0 && imageHeight > 0) onTraceImageAspect(imageHeight / imageWidth);
  }, [onTraceImageAspect, traceSkImage]);
  // A committed smudge scene is a cached transparent raster. During camera
  // motion it is mapped immediately for responsiveness and rebuilt at a
  // bounded cadence, so continuous flights never enlarge one stale viewport.
  const [committedScene, setCommittedScene] = useState<SceneSnapshot | null>(null);
  const committedSceneRef = useRef<SceneSnapshot | null>(null);
  const committedSceneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedSceneArgsRef = useRef<{
    strokes: VectorStroke[];
    camera: VectorCameraState;
    width: number;
    height: number;
  } | null>(null);
  const [liveSmudgeScene, setLiveSmudgeScene] = useState<SceneSnapshot | null>(null);
  const liveSmudgeSceneRef = useRef<SceneSnapshot | null>(null);
  const liveSmudgeBaseRef = useRef<SceneSnapshot | null>(null);
  const liveSmudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSmudgeArgsRef = useRef<{
    stroke: VectorStroke;
    camera: VectorCameraState;
    width: number;
    height: number;
    base: SceneSnapshot | null;
  } | null>(null);

  const disposeSnapshotLater = (snapshot: SceneSnapshot | null) => {
    if (!snapshot) return;
    requestAnimationFrame(() => requestAnimationFrame(() => snapshot.image.dispose?.()));
  };

  useEffect(() => {
    const hasCommittedSmudge = strokes.some((stroke) => stroke.brushMode === 'smudge');
    if (!hasCommittedSmudge) {
      committedSceneArgsRef.current = null;
      if (committedSceneTimerRef.current) clearTimeout(committedSceneTimerRef.current);
      committedSceneTimerRef.current = null;
      const stale = committedSceneRef.current;
      committedSceneRef.current = null;
      setCommittedScene(null);
      disposeSnapshotLater(stale);
      return undefined;
    }

    // Keep the latest camera/stroke state and replay at a bounded cadence.
    // A dependency-cleanup debounce never fired during a continuous viewpoint
    // flight, leaving one old viewport raster to be enlarged until it vanished.
    committedSceneArgsRef.current = { strokes, camera, width, height };
    if (!committedSceneTimerRef.current) {
      committedSceneTimerRef.current = setTimeout(() => {
        committedSceneTimerRef.current = null;
        const args = committedSceneArgsRef.current;
        if (!args) return;
        const previous = committedSceneRef.current;
        const canAppend = Boolean(
          previous &&
          camerasMatch(previous.camera, args.camera) &&
          previous.strokeIDs.length <= args.strokes.length &&
          previous.strokeIDs.every((id, index) => args.strokes[index]?.strokeID === id)
        );
        const suffix = canAppend && previous
          ? args.strokes.slice(previous.strokeIDs.length)
          : args.strokes;
        const image = canAppend && previous
          ? renderScene([], args.camera, args.width, args.height, previous, suffix)
          : renderScene(args.strokes, args.camera, args.width, args.height);
        if (!image) return;
        const next: SceneSnapshot = {
          image,
          camera: args.camera,
          strokeIDs: args.strokes.map((stroke) => stroke.strokeID),
        };
        committedSceneRef.current = next;
        setCommittedScene(next);
        disposeSnapshotLater(previous && previous !== next ? previous : null);
      }, SCENE_REPLAY_DELAY_MS);
    }
    return undefined;
  }, [camera, strokes, width, height]);

  // Live smudge uses the already-rendered committed scene as its baseline and
  // processes only the active dirty region. The timer is a throttle rather
  // than a debounce, so the brush remains visible during a continuous drag.
  useEffect(() => {
    if (liveStroke?.brushMode !== 'smudge') {
      liveSmudgeArgsRef.current = null;
      if (liveSmudgeTimerRef.current) clearTimeout(liveSmudgeTimerRef.current);
      liveSmudgeTimerRef.current = null;
      const stale = liveSmudgeSceneRef.current;
      liveSmudgeSceneRef.current = null;
      setLiveSmudgeScene(null);
      disposeSnapshotLater(stale);
      const staleBase = liveSmudgeBaseRef.current;
      liveSmudgeBaseRef.current = null;
      disposeSnapshotLater(staleBase);
      return undefined;
    }
    let base = committedSceneRef.current;
    if (base && !camerasMatch(base.camera, camera)) base = null;
    if (!base && strokes.length > 0) {
      const previousBase = liveSmudgeBaseRef.current;
      const reusableBase = previousBase && camerasMatch(previousBase.camera, camera) ? previousBase : null;
      const image = reusableBase
        ? reusableBase.image
        : renderScene(strokes, camera, width, height);
      if (image && !reusableBase) {
        if (previousBase) disposeSnapshotLater(previousBase);
        base = {
          image,
          camera,
          strokeIDs: strokes.map((stroke) => stroke.strokeID),
        };
        liveSmudgeBaseRef.current = base;
      } else {
        base = reusableBase;
      }
    }
    liveSmudgeArgsRef.current = {
      stroke: liveStroke,
      camera,
      width,
      height,
      base,
    };
    if (!liveSmudgeTimerRef.current) {
      liveSmudgeTimerRef.current = setTimeout(() => {
        liveSmudgeTimerRef.current = null;
        const args = liveSmudgeArgsRef.current;
        if (!args) return;
        const image = renderScene([args.stroke], args.camera, args.width, args.height, args.base, [args.stroke]);
        if (!image) return;
        const next: SceneSnapshot = { image, camera: args.camera, strokeIDs: [args.stroke.strokeID] };
        const previous = liveSmudgeSceneRef.current;
        liveSmudgeSceneRef.current = next;
        setLiveSmudgeScene(next);
        disposeSnapshotLater(previous);
      }, LIVE_SMUDGE_FRAME_MS);
    }
    return undefined;
  }, [committedScene, liveStroke, camera, width, height]);

  useEffect(() => () => {
    if (committedSceneTimerRef.current) clearTimeout(committedSceneTimerRef.current);
    if (liveSmudgeTimerRef.current) clearTimeout(liveSmudgeTimerRef.current);
    committedSceneTimerRef.current = null;
    committedSceneArgsRef.current = null;
    committedSceneRef.current?.image.dispose?.();
    liveSmudgeSceneRef.current?.image.dispose?.();
    liveSmudgeBaseRef.current?.image.dispose?.();
    committedSceneRef.current = null;
    liveSmudgeSceneRef.current = null;
    liveSmudgeBaseRef.current = null;
    disposePictureLater(livePictureRef.current);
    livePictureRef.current = null;
    disposePictureLater(extremeZoomPictureRef.current);
    extremeZoomPictureRef.current = null;
    for (const cached of cacheRef.current.values()) disposePictureLater(cached);
    cacheRef.current.clear();
    for (const tile of tileCacheRef.current.values()) disposePictureLater(tile);
    tileCacheRef.current.clear();
  }, []);

  // Stroke arrays are immutable between commits. Clean up deleted/replaced
  // entries here instead of rebuilding a Set on every camera frame.
  useEffect(() => {
    const cache = cacheRef.current;
    const current = new Map(strokes.map((stroke) => [stroke.strokeID, stroke]));
    for (const [key, cached] of [...cache.entries()]) {
      const source = current.get(key);
      if (!source || source !== cached.sourceStroke) {
        disposePictureLater(cached);
        cache.delete(key);
      }
    }
    // Tile entries validate their source object identities lazily during the
    // next render. This bounded sweep only removes tiles whose source stroke
    // was deleted, leaving unrelated tiles warm after an append.
    for (const [key, tile] of [...tileCacheRef.current.entries()]) {
      if (tile.sources.some((source) => !current.has(source.strokeID))) {
        disposePictureLater(tile);
        tileCacheRef.current.delete(key);
      }
    }
  }, [strokes]);

  const { visiblePictures, livePicture, matrix } = useMemo(() => {
    const hasSmudge = strokes.some((stroke) => stroke.brushMode === 'smudge');
    const currentCandidates = spatialIndex.query(spatialRectForCamera(camera, width, height));
    const currentNeedsScreenSpace = cameraNeedsScreenSpaceProjection(camera) || currentCandidates.some((stroke) =>
      shouldUseScreenSpaceProjection(stroke.worldSize, camera)
    );
    const contentCamera = hasSmudge || currentNeedsScreenSpace ? camera : deferredCamera;
    const rect = visibleWorldRect(contentCamera, width, height);
    const cache = cacheRef.current;
    const visible: CachedPicture[] = [];

    // Cull + budget.
    // Invalid geometry is ignored before it reaches Skia. Oversized but valid
    // stamps go through the bounded screen-space fallback below; they are not
    // silently dropped at extreme zoom.
    const candidates = spatialIndex.query(spatialRectForCamera(contentCamera, width, height)).filter((s) => {
      // Smudge strokes are represented by the cached transparent scene. If a
      // replay is still pending, drawing them as ordinary emoji stamps would
      // corrupt the result and was the source of the mode-switch artefact.
      if (s.brushMode === 'smudge') return false;
      if (!strokeIntersectsWorldRect(s, rect)) return false;
      const projected = s.worldSize * contentCamera.zoom;
      if (!Number.isFinite(projected) || projected <= 0) {
        if (__DEV__) {
          console.warn(
            `[Vector] ignoring invalid stroke ${s.strokeID}: projected stamp ${projected.toExponential(2)}px is not finite/positive`
          );
        }
        return false;
      }
      return true;
    });
    const totalStamps = candidates.reduce((n, s) => n + (s.stampPositions?.length ?? 0), 0);
    // Coarsen only when the entire scene is smaller than a screen pixel. The
    // power-of-two hysteresis keeps far-away scenes cheap without making the
    // artwork shimmer as the camera crosses tiny zoom changes.
    const globalSkip = lodSkipForZoom(contentCamera.zoom);

    logZoomFrame(contentCamera, () => {
      let maxProjected = 0;
      let maxBucket = 0;
      for (const s of candidates) {
        maxProjected = Math.max(maxProjected, s.worldSize * contentCamera.zoom);
        maxBucket = Math.max(maxBucket, zoomBucketPx(s.worldSize, contentCamera.zoom));
      }
      return `strokes=${candidates.length}/${strokes.length} stamps=${totalStamps} skip=${globalSkip} maxStampPx=${maxProjected.toExponential(2)} maxBucket=${maxBucket}`;
    });

    const needsScreenSpaceProjection = cameraNeedsScreenSpaceProjection(contentCamera) || candidates.some((stroke) =>
      shouldUseScreenSpaceProjection(stroke.worldSize, contentCamera)
    );
    if (needsScreenSpaceProjection) {
      const picture = recordScreenSpacePicture(candidates, contentCamera, width, height, globalSkip);
      if (extremeZoomPictureRef.current !== picture) {
        disposePictureLater(extremeZoomPictureRef.current);
        extremeZoomPictureRef.current = picture;
      }
      if (picture) {
        visible.push({ ...picture, bucketPx: -1, skip: globalSkip, sampleCount: totalStamps });
      }
    } else {
      disposePictureLater(extremeZoomPictureRef.current);
      extremeZoomPictureRef.current = null;
      for (const s of candidates) {
        const bucketPx = canRenderEmojiAsVector(s.emoji) && !s.isPlane ? 0 : zoomBucketPx(s.worldSize, contentCamera.zoom);
        const count = s.stampPositions?.length ?? 0;
        const cached = cache.get(s.strokeID);
        if (
          !cached ||
          cached.sourceStroke !== s ||
          cached.bucketPx !== bucketPx ||
          cached.skip !== globalSkip ||
          cached.sampleCount !== count
        ) {
          disposePictureLater(cached);
          const pic = recordStrokePicture(s, bucketPx, globalSkip);
          if (pic) {
            cache.set(s.strokeID, {
              ...pic,
              bucketPx,
              skip: globalSkip,
              sampleCount: count,
              sourceStroke: s,
            });
          }
          else cache.delete(s.strokeID);
        }
        const entry = cache.get(s.strokeID);
        if (entry) {
          touchCachedPicture(cache, s.strokeID, entry);
          visible.push(entry);
        }
      }
    }
    // Drop old native pictures even though their source strokes remain in the
    // document. They will be rebuilt on demand when the user returns there.
    const visibleIDs = new Set(candidates.map((stroke) => stroke.strokeID));
    while (cache.size > MAX_CACHED_STROKE_PICTURES) {
      const oldest = [...cache.keys()].find((key) => !visibleIDs.has(key));
      if (!oldest) break; // A very dense viewport may itself exceed the cap.
      disposePictureLater(cache.get(oldest));
      cache.delete(oldest);
    }

    // Group compact, tile-contained strokes into cached world pictures. Large
    // strokes stay individual so no part can be clipped or reordered. This
    // reduces the number of SkPicture nodes React submits while preserving
    // exact document order and avoids retaining every off-screen picture.
    let renderPictures: RecordedPicture[] = visible;
    if (!needsScreenSpaceProjection && visible.length > 1) {
      const lod = tileLodForZoom(contentCamera.zoom);
      const tileWorldSize = tileWorldSizeForLod(lod);
      type TileRun = {
        key: string;
        baseKey: string;
        rect: { minX: number; minY: number; maxX: number; maxY: number };
        sources: CachedPicture[];
      };
      const runs: Array<TileRun | CachedPicture> = [];
      let activeRun: TileRun | null = null;
      const flushRun = () => {
        if (activeRun) runs.push(activeRun);
        activeRun = null;
      };
      for (const entry of visible) {
        const stroke = entry.sourceStroke;
        if (!stroke) { flushRun(); runs.push(entry); continue; }
        const b = stroke.worldBounds;
        const coords = tileCoordinatesForPoint((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, tileWorldSize);
        const minX = coords.x * tileWorldSize;
        const minY = coords.y * tileWorldSize;
        const maxX = minX + tileWorldSize;
        const maxY = minY + tileWorldSize;
        const fits = b.minX >= minX && b.maxX <= maxX && b.minY >= minY && b.maxY <= maxY;
        if (!fits) { flushRun(); runs.push(entry); continue; }
        const tileBaseKey = `${lod}:${coords.x}:${coords.y}`;
        const currentRun = activeRun;
        if (currentRun && currentRun.baseKey === tileBaseKey) currentRun.sources.push(entry);
        else {
          flushRun();
          // Include the first stroke ID so two separated runs in the same
          // tile cannot alias the same cached SkPicture.
          activeRun = {
            key: `${tileBaseKey}:${stroke.strokeID}`,
            baseKey: tileBaseKey,
            rect: { minX, minY, maxX, maxY },
            sources: [entry],
          };
        }
      }
      flushRun();
      const renderRuns: RecordedPicture[] = [];
      const liveTileKeys = new Set<string>();
      for (const run of runs) {
        if (!('sources' in run)) {
          renderRuns.push(run);
          continue;
        }
        const group = run;
        const tileKey = group.key;
        liveTileKeys.add(tileKey);
        const [lodText] = tileKey.split(':');
        const lodValue = Number(lodText);
        const first = group.sources[0];
        const cachedTile = tileCacheRef.current.get(tileKey);
        const sameSources = Boolean(
          cachedTile &&
          cachedTile.lod === lodValue &&
          cachedTile.bucketPx === first.bucketPx &&
          cachedTile.skip === first.skip &&
          cachedTile.pictureSources.length === group.sources.length &&
          cachedTile.pictureSources.every((source, index) => source === group.sources[index]),
        );
        let tile = sameSources ? cachedTile : null;
        if (!tile) {
          if (cachedTile) disposePictureLater(cachedTile);
          const picture = recordTilePicture(group.rect, group.sources);
          if (!picture) continue;
          tile = {
            ...picture,
            tileKey,
            lod: lodValue,
            bucketPx: first.bucketPx,
            skip: first.skip,
            sources: group.sources.map((source) => source.sourceStroke as VectorStroke),
            pictureSources: [...group.sources],
          };
          tileCacheRef.current.set(tileKey, tile);
        }
        renderRuns.push(tile);
      }
      renderPictures = renderRuns;
      while (tileCacheRef.current.size > 96) {
        const staleKey = [...tileCacheRef.current.keys()].find((key) => !liveTileKeys.has(key));
        if (!staleKey) break;
        const stale = tileCacheRef.current.get(staleKey);
        if (stale) disposePictureLater(stale);
        tileCacheRef.current.delete(staleKey);
      }
    }

    // Live stroke: recorded fresh each render (only the active stroke).
    let live: RecordedPicture | null = null;
    if (liveStroke && liveStroke.brushMode !== 'smudge' && (liveStroke.stampPositions?.length ?? 0) > 0) {
      live = shouldUseScreenSpaceProjection(liveStroke.worldSize, contentCamera)
        ? recordScreenSpacePicture([liveStroke], contentCamera, width, height, 1)
        : recordStrokePicture(
          liveStroke,
          canRenderEmojiAsVector(liveStroke.emoji) && !liveStroke.isPlane ? 0 : zoomBucketPx(liveStroke.worldSize, contentCamera.zoom),
          1,
        );
    }
    if (livePictureRef.current !== live) {
      disposePictureLater(livePictureRef.current);
      livePictureRef.current = live;
    }

    // Camera matrix: screen = (world - center) * zoom + viewport/2
    const m = Skia.Matrix();
    // Screen-space pictures bypass this matrix. Keep the fallback matrix
    // identity while in that path so an extreme camera can never reach Skia
    // through an unused world group (the trace group uses the same matrix).
    if (!needsScreenSpaceProjection) {
      m.translate(width / 2, height / 2);
      m.scale(camera.zoom, camera.zoom);
      m.translate(-camera.cx, -camera.cy);
    }

    return { visiblePictures: renderPictures, livePicture: live, matrix: m };
  }, [strokes, liveStroke, camera, deferredCamera, width, height, spatialIndex]);

  const editingPlanePicture = useMemo(() => {
    if (!editingPlaneStroke || editingPlaneStroke.opacity <= 0) return null;
    if (shouldUseScreenSpaceProjection(editingPlaneStroke.worldSize, camera) || cameraNeedsScreenSpaceProjection(camera)) {
      return recordScreenSpacePicture([editingPlaneStroke], camera, width, height, 1);
    }
    return recordPlanePicture(editingPlaneStroke, zoomBucketPx(editingPlaneStroke.worldSize, camera.zoom));
  }, [camera, editingPlaneStroke, height, width]);

  useEffect(() => () => disposePictureLater(editingPlanePicture), [editingPlanePicture]);

  const screenSpacePictures = visiblePictures.filter((picture) => picture.screenSpace);
  const worldSpacePictures = visiblePictures.filter((picture) => !picture.screenSpace);
  const traceScaleValue = traceImage?.scale;
  const traceRotationValue = traceImage?.rotationDegrees;
  const traceScale = Number.isFinite(traceScaleValue) && (traceScaleValue ?? 0) > 0 ? traceScaleValue as number : 1;
  const traceRotation = Number.isFinite(traceRotationValue) ? traceRotationValue as number : 0;
  const traceWidth = (traceImage?.worldWidth ?? 0) * traceScale;
  const traceHeight = (traceImage?.worldHeight ?? 0) * traceScale;
  const traceCenterX = (traceImage?.worldX ?? 0) + (traceImage?.worldWidth ?? 0) / 2;
  const traceCenterY = (traceImage?.worldY ?? 0) + (traceImage?.worldHeight ?? 0) / 2;

  return (
      <Canvas style={{ width, height }} ref={canvasRef}>
      <Fill color="#101014" />
      {traceImage && traceVisible && traceSkImage && (
        <Group matrix={matrix}>
          <SkiaImage
            image={traceSkImage}
            x={traceCenterX - traceWidth / 2}
            y={traceCenterY - traceHeight / 2}
            width={traceWidth}
            height={traceHeight}
            opacity={traceImage.opacity}
            fit="contain"
            transform={traceRotation === 0 ? undefined : [{ rotate: (traceRotation * Math.PI) / 180 }]}
            origin={{ x: traceCenterX, y: traceCenterY }}
          />
        </Group>
      )}
      {(liveSmudgeScene ?? committedScene) ? (
        <>
          {(() => {
            const scene = liveSmudgeScene ?? committedScene;
            const sceneMatrix = sceneCameraMapping(
              scene!.camera,
              camera,
              width,
              height,
            );
            return sceneMatrix ? (
              <Group matrix={sceneMatrix}>
                <SkiaImage image={scene!.image} x={0} y={0} width={width} height={height} fit="fill" />
              </Group>
            ) : null;
          })()}
          {livePicture && (livePicture.screenSpace ? <Picture picture={livePicture.picture} /> : (
            <Group matrix={matrix}><Picture picture={livePicture.picture} /></Group>
          ))}
        </>
      ) : (
        <>
          <Group matrix={matrix}>
            {worldSpacePictures.map((p, i) => (
            // Never stringify a SkPicture here. It is a native JSI host object
            // and Hermes throws "Cannot determine default value of object" when
            // React tries to coerce it for a key.
            <Picture key={`vector-picture-${i}`} picture={p.picture} />
            ))}
            {livePicture && !livePicture.screenSpace && <Picture picture={livePicture.picture} />}
          </Group>
          {screenSpacePictures.map((picture, i) => <Picture key={`vector-screen-picture-${i}`} picture={picture.picture} />)}
          {livePicture?.screenSpace && <Picture picture={livePicture.picture} />}
        </>
      )}
      {editingPlanePicture && (editingPlanePicture.screenSpace
        ? <Picture picture={editingPlanePicture.picture} />
        : <Group matrix={matrix}><Picture picture={editingPlanePicture.picture} /></Group>)}
      {showPlaneControls && editingPlaneStroke?.planeCorners && (() => {
        const level = (editingPlaneStroke.planeLatticeLevel ?? 1) as LatticeLevel;
        const lattice = editingPlaneStroke.planeLattice;
        const toScreen = (point: PlanePoint) => boundedPlaneScreenPoint(
          projectWorldPoint(point.x, point.y, camera, width, height), width, height, Math.max(width, height) * 2,
        );
        if (lattice && level > 1) {
          const side = latticeSide(level);
          const at = (row: number, col: number) => toScreen(lattice[row * side + col]);
          const lines: React.ReactNode[] = [];
          for (let row = 0; row < side; row += 1) {
            for (let col = 0; col < side; col += 1) {
              const point = at(row, col);
              if (col + 1 < side) lines.push(<Line key={`ph-${row}-${col}`} p1={point} p2={at(row, col + 1)} color="rgba(255,215,0,0.58)" strokeWidth={2} />);
              if (row + 1 < side) lines.push(<Line key={`pv-${row}-${col}`} p1={point} p2={at(row + 1, col)} color="rgba(255,215,0,0.58)" strokeWidth={2} />);
              lines.push(<Line key={`pd-${row}-${col}`} p1={point} p2={{ x: point.x + 0.01, y: point.y }} color="#ff6b6b" strokeWidth={16} strokeCap="round" />);
            }
          }
          return <>{lines}</>;
        }
        const corners = [
          editingPlaneStroke.planeCorners.topLeft,
          editingPlaneStroke.planeCorners.topRight,
          editingPlaneStroke.planeCorners.bottomRight,
          editingPlaneStroke.planeCorners.bottomLeft,
        ].map(toScreen);
        return <>{corners.map((point, index) => (
          <React.Fragment key={`plane-corner-${index}`}>
            <Line p1={point} p2={corners[(index + 1) % corners.length]} color="#ffd700" strokeWidth={3} />
            <Line p1={point} p2={{ x: point.x + 0.01, y: point.y }} color="#ff6b6b" strokeWidth={16} strokeCap="round" />
          </React.Fragment>
        ))}</>;
      })()}
    </Canvas>
  );
};

export default React.memo(VectorCanvas);
