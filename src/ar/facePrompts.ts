/**
 * facePrompts — a big pool of "cool" restyle prompts for the SD img2img pass on
 * the textured face mask. Combinatorial so there are far more than 333 distinct
 * prompts; each Update picks a fresh random one.
 */
const STYLES = [
  'cyberpunk neon portrait', 'oil painting masterpiece', 'watercolor portrait',
  'pop art comic style', 'vaporwave aesthetic', 'baroque oil painting',
  'anime character portrait', 'pixar 3d render', 'street graffiti mural',
  'low poly 3d art', 'stained glass portrait', 'ukiyo-e woodblock print',
  'art nouveau illustration', 'gothic dark fantasy', 'retro 80s synthwave',
  'impressionist brush strokes', 'chrome liquid metal', 'holographic iridescent',
  'charcoal sketch portrait', 'mosaic tile art', 'psychedelic surreal',
  'bronze statue sculpture', 'galaxy cosmic portrait', 'origami paper art',
  'glitch art datamosh', 'renaissance fresco', 'tribal warpaint',
  'crystal gemstone facets', 'steampunk mechanical', 'ink wash painting',
];

const MOODS = [
  'vivid saturated colors', 'dramatic cinematic lighting', 'soft dreamy glow',
  'high contrast bold', 'pastel soft tones', 'golden hour warmth',
  'cool moody blue tones', 'rainbow prismatic', 'monochrome elegant',
  'electric neon highlights', 'misty atmospheric', 'sunset gradient',
];

const EXTRAS = [
  'intricate detail', 'masterpiece, trending', 'ultra sharp focus',
  '8k highly detailed', 'studio quality', 'award winning art',
];

/** A random restyle prompt (keeps the face recognizable). */
export function randomFacePrompt(): string {
  const s = STYLES[Math.floor(Math.random() * STYLES.length)];
  const m = MOODS[Math.floor(Math.random() * MOODS.length)];
  const e = EXTRAS[Math.floor(Math.random() * EXTRAS.length)];
  return `${s}, portrait of a face, ${m}, ${e}`;
}

/** Total distinct combinations available (well over 333). */
export const FACE_PROMPT_COMBOS = STYLES.length * MOODS.length * EXTRAS.length;
