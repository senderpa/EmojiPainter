// Picks one random tint once per JS bundle load (= once per app open).
// Used to give the area outside the canvas a subtle colored atmosphere.
const TINT_COLORS = ['255,51,0', '0,85,255', '0,204,68', '255,204,0'];
const _picked = TINT_COLORS[Math.floor(Math.random() * TINT_COLORS.length)];

/** rgba string at 6% opacity — overlay this on a #0f0f0f base for the out-of-canvas area */
export const CANVAS_TINT_COLOR = `rgba(${_picked},0.06)`;
