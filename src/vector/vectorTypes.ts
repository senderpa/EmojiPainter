// Vector Mode — schema types matching the handoff's `emoji-painter.vector-document` v1
// (VectorModeIOSImplementationHandoff/DOCUMENT_SCHEMA.md). All numbers are IEEE-754
// doubles (plain JS numbers) — never stringified floats.

export const VECTOR_SCHEMA = 'emoji-painter.vector-document';
export const VECTOR_SCHEMA_VERSION = 1;
/** Mac parity: minimum normalized spacing ratio. */
export const MIN_SPACING_RATIO = 0.00001;
/** Mac-like dense default spacing (ratio of world size between stamps). */
export const DEFAULT_SPACING_RATIO = 0.12;
/**
 * Logarithmic camera range. Geometry is bucketed and bounded by the renderer,
 * so zooming repeatedly does not create a new raster for every gesture frame.
 * These are practical IEEE-754 limits for the document/camera, not a claim
 * that a physical display can show infinite pixels.
 */
export const MIN_ZOOM = 1e-9;
export const MAX_ZOOM = 1e9;
/** Per-stroke stamp budget so tiny spacing can't explode per-frame work. */
export const MAX_STAMPS_PER_STROKE = 3000;

export interface VectorCameraState {
  /** World-space camera center (doubles). */
  cx: number;
  cy: number;
  /** Logical zoom: screen px per world unit. Positive, finite. */
  zoom: number;
}

export interface VectorSample {
  x: number; // world (double)
  y: number;
  timeMilliseconds: number;
}

export type VectorBrushMode = 'opaque' | 'transparent' | 'smudge';

export interface VectorStroke {
  strokeID: string;
  emoji: string;
  /** World-constant size (Mac semantics: screenBrushSize / zoom at creation). */
  worldSize: number;
  screenSizeAtCreation: number;
  widthMode: 'worldConstant' | 'screenConstant';
  opacity: number;
  /** Paint behavior at creation. Missing means opaque for schema-v1 compatibility. */
  brushMode?: VectorBrushMode;
  smudgeStrength?: number;
  edgeBlendStrength?: number;
  spacingRatio: number;
  rotationDegrees: number;
  mirrorX?: boolean;
  mirrorY?: boolean;
  startedAtMilliseconds: number;
  endedAtMilliseconds: number;
  samples: VectorSample[];
  worldBounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Precomputed world-space stamp centers (derived, cached, not authoritative). */
  stampPositions?: { x: number; y: number }[];
  /**
   * Distance carried into the next spacing segment (derived, never persisted).
   * Keeping this with the live stroke makes stamp generation incremental instead
   * of rescanning the complete touch path on every move.
   */
  stampCarry?: number;
  /** Effective spacing step for the derived live stamp cache. */
  stampStep?: number;
  /** Total sampled path length for bounded incremental stamp generation. */
  stampPathLength?: number;
  /** A committed 📐 surface. Geometry remains in world coordinates and is never flattened. */
  isPlane?: boolean;
  planeCorners?: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
  planeLattice?: { x: number; y: number }[];
  planeLatticeLevel?: 1 | 2 | 3 | 5;
  planeStampSize?: number;
}

/** Live, editable 📐 surface. It uses the same world coordinates as VectorStroke. */
export interface VectorEmojiPlane {
  id: string;
  emoji: string;
  corners: {
    topLeft: { x: number; y: number };
    topMid: { x: number; y: number };
    topRight: { x: number; y: number };
    rightMid: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomMid: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    leftMid: { x: number; y: number };
  };
  lattice?: { x: number; y: number }[];
  latticeLevel?: 1 | 2 | 3 | 5;
  timestamp: number;
  cornerHistory: Array<{
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    timestamp: number;
  }>;
  opacity: number;
  rotation?: number;
  scale?: number;
  visible?: boolean;
  zIndex: number;
}

/** A reference photo pinned in world space so it stays put across pan/zoom, for tracing over. */
export interface VectorTraceImage {
  uri: string;
  worldX: number;
  worldY: number;
  worldWidth: number;
  worldHeight: number;
  opacity: number;
  /** Placement-only values; omitted by older in-memory documents. */
  scale?: number;
  rotationDegrees?: number;
}

/** Common timing curves for viewpoint flight segments. */
export type VectorEasing =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'backOut'
  | 'backInOut'
  | 'bounceOut'
  | 'bounceInOut'
  | 'elasticOut';

export interface VectorEasingOption {
  value: VectorEasing;
  label: string;
  description: string;
}

/** Kept in one place so the picker and imported-document defaults stay aligned. */
export const VECTOR_EASING_OPTIONS: VectorEasingOption[] = [
  { value: 'linear', label: 'Linear', description: 'Constant speed' },
  { value: 'easeIn', label: 'Ease in', description: 'Starts gently' },
  { value: 'easeOut', label: 'Ease out', description: 'Finishes gently' },
  { value: 'easeInOut', label: 'Ease in-out', description: 'Gentle start and finish' },
  { value: 'easeInQuad', label: 'Ease in · quadratic', description: 'Smooth acceleration' },
  { value: 'easeOutQuad', label: 'Ease out · quadratic', description: 'Smooth deceleration' },
  { value: 'easeInOutQuad', label: 'Ease in-out · quadratic', description: 'Soft and balanced' },
  { value: 'easeInCubic', label: 'Ease in · cubic', description: 'Strong acceleration' },
  { value: 'easeOutCubic', label: 'Ease out · cubic', description: 'Strong deceleration' },
  { value: 'easeInOutCubic', label: 'Ease in-out · cubic', description: 'Strong, cinematic smoothness' },
  { value: 'backOut', label: 'Overshoot', description: 'Pushes past the target, then settles' },
  { value: 'backInOut', label: 'Overshoot · in-out', description: 'Overshoots at both ends' },
  { value: 'bounceOut', label: 'Bounce', description: 'Bounces into the target' },
  { value: 'bounceInOut', label: 'Bounce · in-out', description: 'Bounces at both ends' },
  { value: 'elasticOut', label: 'Elastic', description: 'Springy settle at the target' },
];
export type VectorLoopMode = 'once' | 'loop' | 'pingPong';

export interface VectorViewpoint {
  id: string;
  label: string;
  cx: number;
  cy: number;
  zoom: number;
  /** Pause here before travelling to the next viewpoint. */
  holdMs: number;
  /** Travel time from this viewpoint to the next. */
  durationToNextMs: number;
  easing: VectorEasing;
}

export interface VectorDocumentMeta {
  schema: typeof VECTOR_SCHEMA;
  schemaVersion: number;
  documentID: string;
  createdAt: string;
  updatedAt: string;
  mode: 'vector';
  defaultWidthMode: 'worldConstant';
  camera: VectorCameraState;
  strokeOrder: string[];
  viewpoints?: VectorViewpoint[];
  loopMode?: VectorLoopMode;
}
