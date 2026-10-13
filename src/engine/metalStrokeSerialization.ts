import type { PaintLayer, Stroke } from '../state/PaintingContext';

const serializePoints = (stroke: Stroke) =>
  stroke.points.map((point) => (
    point.w !== undefined
      ? { x: point.x, y: point.y, w: point.w }
      : { x: point.x, y: point.y }
  ));

/** Absent layer means middle to the native parser and keeps old JSON payloads compact. */
const serializeLayer = (stroke: Stroke): { layer?: PaintLayer } => {
  const layer = stroke.layer ?? 'middle';
  return layer === 'middle' ? {} : { layer };
};

/**
 * Trim a JS Stroke to exactly what MetalPaintView parses.
 *
 * A bent plane needs both its legacy corners and its complete lattice. Corners alone can only
 * reconstruct a homography and would silently discard every extra-handle edit on Apply.
 */
export const serializeMetalPaintStroke = (stroke: Stroke) => {
  if (stroke.isSmudge) {
    return {
      id: stroke.id,
      ...serializeLayer(stroke),
      isSmudge: true,
      emoji: stroke.emoji,
      size: stroke.size,
      opacity: stroke.opacity,
      edgeBlendStrength: stroke.edgeBlendStrength ?? 0.5,
      smudgeStrength: stroke.smudgeStrength ?? 0.85,
      points: serializePoints(stroke),
      bakedTilePath: stroke.bakedTilePath,
      bakedTile: stroke.bakedTilePath ? undefined : stroke.bakedTile,
      bakedBounds: stroke.bakedBounds,
    };
  }

  return {
    id: stroke.id,
    ...serializeLayer(stroke),
    emoji: stroke.emoji,
    size: stroke.size,
    opacity: stroke.opacity,
    spacing: stroke.spacing ?? 0,
    stampSpan: stroke.stampSpan ?? 0,
    isEraser: !!stroke.isEraser,
    isPlane: !!stroke.isPlane,
    planeCorners: stroke.planeCorners,
    planeLattice: stroke.planeLattice,
    planeLatticeLevel: stroke.planeLatticeLevel,
    emojiSequence: stroke.emojiSequence,
    rotation: stroke.rotation ?? 0,
    mirrorX: !!stroke.mirrorX,
    mirrorY: !!stroke.mirrorY,
    points: serializePoints(stroke),
  };
};
