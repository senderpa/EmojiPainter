/**
 * Shared types and tuned default constants for the smudge brush.
 *
 * The smudge brush turns the selected emoji's alpha into a "dirty finger" mask that drags
 * existing canvas pixels along the stroke instead of stamping the emoji. Research basis:
 * Krita splits smudge into smearing + dulling/pickup; MyPaint uses a smudge length/radius
 * where the picked-up color slowly changes toward the canvas color. We model both with a
 * per-stroke carry buffer (the paint currently on the finger) plus directional behind-sampling.
 *
 * This module is intentionally free of any Skia / React Native imports so the math in
 * `smudgeCore.ts` stays pure and unit-testable.
 */

/** A rectangular region of the canvas in DEVICE pixels (already multiplied by DPR). */
export interface SmudgeRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Hard / soft / edge masks derived from the emoji alpha, all in 0..1, sized w*h. */
export interface SmudgeMask {
  hard: Float32Array; // center pull / carry / smear (contrast-boosted alpha)
  soft: Float32Array; // total affected coverage (blurred alpha)
  edge: Float32Array; // soft melt / local blend ring (max(soft - hard, 0))
  w: number;
  h: number;
}

/** A 2D point in DEVICE pixels. */
export interface SmudgePoint {
  x: number;
  y: number;
}

/** Tunable behavior. All rates are 0..1; distances/radii are factors of the brush size. */
export interface SmudgeParams {
  smudgeStrength: number; // how strongly carried pixels replace canvas pixels
  reloadRate: number; // how quickly the finger picks up new canvas color (from behind)
  dirtyUpdateRate: number; // how slowly the finger gets contaminated by the destination
  edgeBlendStrength: number; // how much soft edges melt colors
  spacingFactor: number; // dab spacing as a fraction of brush size
  behindSampleDistance: number; // directional smear pickup distance (fraction of brush size)
  localAverageRadius: number; // blur radius for edge melt (fraction of brush size)
  maskBlurRadius: number; // soft-mask blur radius (fraction of mask size)
  maxVelocityDragBoost: number; // extra drag at high velocity
}

// Live smudge performance knobs. Keep these small and explicit: mobile Safari/iPhone needs a
// predictable upper bound more than perfect brush fidelity.
export const smudgeStrength = 0.82;
export const smudgeSpacing = 0.28;
export const smudgeMaxBrushPixels = 64;
export const smudgeEventThrottleMs = 12;
export const smudgeQualityForLargeBrushes = 0.26;

/** First preset — tuned defaults from the design spec. */
export const DEFAULT_SMUDGE_PARAMS: SmudgeParams = {
  smudgeStrength,
  reloadRate: 0.18,
  dirtyUpdateRate: 0.08,
  edgeBlendStrength: 0.5, // creamy color-mixing amount for the GPU smudge shader
  spacingFactor: smudgeSpacing,
  behindSampleDistance: 0.35,
  localAverageRadius: 0.18,
  maskBlurRadius: 0.16,
  maxVelocityDragBoost: 1.45
};

/**
 * Resolve per-stroke overrides (stored on the Stroke) onto the default preset.
 * Any undefined override falls back to the default so old strokes stay valid.
 */
export const resolveSmudgeParams = (overrides?: Partial<SmudgeParams>): SmudgeParams => {
  if (!overrides) {
    return DEFAULT_SMUDGE_PARAMS;
  }
  return {
    ...DEFAULT_SMUDGE_PARAMS,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    )
  } as SmudgeParams;
};

/** Minimum dab spacing in processing pixels, regardless of brush size. */
export const MIN_DAB_SPACING_PX = 1.5;

// The smudge is processed on a buffer whose brush footprint is capped to this many pixels. Small
// brushes process at full device resolution (scale 1); large brushes are downscaled so the per-dab
// pixel loop — the dominant cost — stays roughly constant across ALL brush sizes. The result is
// upscaled for display, trading a little sharpness on big brushes for real-time responsiveness.
export const TARGET_PROC_BRUSH_PX = smudgeMaxBrushPixels;
export const MIN_SMUDGE_SCALE = smudgeQualityForLargeBrushes;

/** Processing scale (≤1) for a given device-pixel brush size. */
export const computeSmudgeScale = (brushDevicePx: number): number => {
  if (brushDevicePx <= TARGET_PROC_BRUSH_PX) {
    return 1;
  }
  return Math.max(MIN_SMUDGE_SCALE, TARGET_PROC_BRUSH_PX / brushDevicePx);
};
