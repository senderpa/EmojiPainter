import { Platform, Dimensions } from 'react-native';
import { MIN_CHALLENGE_STROKES } from './challengeUploadEligibility';

export { MIN_CHALLENGE_STROKES } from './challengeUploadEligibility';

export const DEFAULT_SNAPSHOT_PROJECT_ID = 'active-session';

export const FIRST_TIME_USER_KEY = '@emojipaint_first_time_done';
export const SESSION_COUNT_KEY = '@emojipaint_session_count';
export const RANDOM_GALLERY_ROUND_KEY = '@emojipaint_random_gallery_round';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
export { screenWidth, screenHeight };

export const CANVAS_RATIO = 1;
export const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;
export const BRUSH_SIZE_MAX = 150;
export const BRUSH_ROTATION_STEP = 90;
export const MIN_TRACE_SCALE = 0.01;
export const MAX_TRACE_SCALE = 3;
export const TRACE_DEFAULT_OPACITY = 0.5;
export const BRUSH_DIM_OPACITY = 0.01;
export const MAX_CANVAS_SCALE = 50;
export const MIN_CANVAS_SCALE_MAIN = 0.8;
export const LARGE_HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 } as const;
export const STROKE_WARNING_THRESHOLD = 3000;
export const STROKE_CRITICAL_THRESHOLD = 5000;
export const EMOJI_ITEM_HEIGHT = 48;
export const MAX_INTERPOLATED_POINTS = 48;
export const isLargeTablet = Platform.OS === 'ios' && Math.max(screenWidth, screenHeight) >= 1024;
export const MINIMUM_POINT_SPACING = 0.0001;
export const MIN_LINE_SPACING = 0.0005;
export const MAX_LINE_POINTS = 600;
/**
 * Continuous control scale, driven by the device's SHORTER edge (the width that actually
 * constrains a portrait toolbar), clamped to 1..2.
 *
 * This was `isLargeTablet ? 2 : 1` — a binary jump keyed on the LONGEST edge, so every iPad
 * over 1024pt long got the same 2x controls regardless of how wide it actually is. A 12.9"
 * Pro has 1024pt of portrait width and copes; an iPad mini has 744pt and does not, so the
 * size/spacing rows overflowed and the emoji + value wrapped under the slider.
 *
 * Both endpoints are preserved EXACTLY so the two devices we can actually test are unchanged:
 * 1024/512 = 2.0 (iPad Pro 12.9"), and every phone clamps to 1.0. Everything between now
 * interpolates instead of being rounded up to a size it has no room for.
 *
 * Uses the smaller of the two window dimensions rather than `width`, so the value is identical
 * in portrait and landscape — these are style constants evaluated once at module load and must
 * not depend on the orientation the app happened to launch in.
 */
const shorterEdge = Math.min(screenWidth, screenHeight);
export const TOOL_SCALE = Math.max(1, Math.min(2, shorterEdge / 512));
export const TOOL_BUTTON_PADDING_H = Math.round(18 * TOOL_SCALE);
export const TOOL_BUTTON_PADDING_V = Math.round(12 * TOOL_SCALE);
export const TOOL_MIN_WIDTH = Math.round(64 * TOOL_SCALE);
export const TOOL_FONT_SIZE = Math.round(26 * TOOL_SCALE);
export const QUICK_BUTTON_SIZE = Math.round(44 * TOOL_SCALE);
export const QUICK_BUTTON_RADIUS = Math.round(18 * TOOL_SCALE);
export const QUICK_EMOJI_SIZE = Math.round(20 * TOOL_SCALE);
export const SLIDER_LABEL_MIN_WIDTH = Math.round(90 * TOOL_SCALE);
export const SLIDER_VALUE_WIDTH = Math.round(56 * TOOL_SCALE);
export const SPACING_VALUE_WIDTH = Math.round(56 * TOOL_SCALE);
export const OVERLAY_SCALE = Math.max(0.5, TOOL_SCALE * 0.5);
export const OVERLAY_BUTTON_WIDTH = Math.round(48 * OVERLAY_SCALE);
export const OVERLAY_BUTTON_PADDING_H = Math.round(10 * OVERLAY_SCALE);
export const OVERLAY_BUTTON_PADDING_V = Math.round(8 * OVERLAY_SCALE);
export const OVERLAY_BUTTON_RADIUS = Math.round(16 * OVERLAY_SCALE);
export const OVERLAY_FONT_SIZE = Math.round(18 * OVERLAY_SCALE);
export const EMOJI_COLUMN_COUNT = Math.min(12, Math.max(6, Math.floor(screenWidth / 48)));
export const PICKER_COLUMN_COUNT = Math.min(18, Math.max(8, Math.floor(screenWidth / 40)));
export const COIN_STORAGE_KEY = 'emojipaint-challenge-coins';
export const PRIVATE_STUDIO_STORAGE_KEY = 'emojipaint/private-studio/state';
export const PASSPORT_PORTRAIT_STORAGE_KEY = 'emojipaint/passport/portrait';
export const PASSPORT_PORTRAIT_SENT_STORAGE_KEY = 'emojipaint/passport/portrait:last-sent';
export const PRIVATE_STUDIO_NAME_MAX = 19;
export const PRIVATE_STUDIO_DEFAULT_NAME = '';
export const PRIVATE_STUDIO_DEFAULT_NAME_SHORT = '';
export const PRIVATE_STUDIO_AUTOSAVE_DEBOUNCE_MS = 6000;
export const PRIVATE_STUDIO_RANDOM_LOCK_KEY = 'emojipaint/private-studio/random-lock';
export const GLOBAL_STATS_STORAGE_KEY = 'emojipaint/stats/global';
export const DEVICE_CREATED_AT_KEY = 'emojipaint/device/created-at';
export const PASSPORT_PORTRAIT_SIZE = 256;

export const MAX_SNAPSHOT_SIDE = 4096;
export const TARGET_SNAPSHOT_SIDE = 4096;
export const LONG_STROKE_SNAPSHOT_SIDE = 2048;
export const CHALLENGE_CAPTURE_MAX_SIDE = 1600;
/** A GPU capture interrupted by backgrounding may never settle — bound the wait. */
export const CHALLENGE_CAPTURE_TIMEOUT_MS = 8000;
export const TIMER_OVERLAY_MARGIN = 36;
export const TIMER_MIN_SCALE = 0.65;
export const TIMER_MAX_SCALE = 1.4;
export const PROMPT_CARD_WIDTH = Math.min(320, screenWidth * 0.78);
export const PROMPT_CARD_HEIGHT = 60;
export const PROMPT_CARD_GAP = 8;

export const GALLERY_STALE_THRESHOLD_MS = 60 * 1000;
export const GALLERY_PAGE_SIZE = 100;
export const GALLERY_FETCH_LIMIT = 100;

export const LANGUAGE_FLAG_MAP: Record<string, { flag: string; label: string }> = {
  en: { flag: '🇺🇸', label: 'English' },
  de: { flag: '🇩🇪', label: 'Deutsch' },
  fr: { flag: '🇫🇷', label: 'Français' },
  it: { flag: '🇮🇹', label: 'Italiano' },
  ru: { flag: '🇷🇺', label: 'Русский' },
  ja: { flag: '🇯🇵', label: '日本語' },
  ko: { flag: '🇰🇷', label: '한국어' },
  zh: { flag: '🇨🇳', label: '中文' }
};
export const GALLERY_LANGUAGE_DEFAULT = 'en';
export const PRIVATE_STUDIO_NAME_SUGGESTIONS = [
  'emojilover',
  'digitalartist',
  'pixelpirate',
  'canvascomedian',
  'brushbandit',
  'emojiwizard',
  'palettepal',
  'glyphguardian',
  'stickerstorm',
  'doodledynamo',
  'colorcomedian',
  'emojiaddict',
  'paletteprankster',
  'pixelpaladin',
  'canvascaptain',
  'emojiinventor',
  'brushadmiral',
  'digitaldreamer',
  'emojioutlaw',
  'canvascosmonaut',
  'pixelpunster',
  'emojiinsider',
  'brushbard',
  'palettepunk',
  'vectorvandal',
  'emojiemissary',
  'canvasconjuror',
  'pixelprophet',
  'emojiantics',
  'brushbuff',
  'palettepirate',
  'digitaldoodler',
  'emojiastro'
];

export const PRESSURE_MIN_SPACING = 0.000001;
export const PRESSURE_APPLY_SMOOTH = 0.32;
export const PRESSURE_RELEASE_SMOOTH = 0.45;

export const SPACING_SLIDER_MIN = 0.0000001;
export const SPACING_SLIDER_MAX = 300;

export const LINE_SPACING_THRESHOLD = 0.02;
export const LINE_SPACING_MULTIPLIER = 0.16;
export const MAX_NORMALIZED_SPACING = Math.pow(2, 1 / 1.6);
export const LONG_STROKE_SNAPSHOT_INTERVAL_MS = 1000;

export const COIN_LEVELS = [
  { id: 1, name: 'Emoji Seedling', emoji: '🌱', minCoins: 0 },
  { id: 2, name: 'Pixel Pathfinder', emoji: '🧭', minCoins: 5 },
  { id: 3, name: 'Brush Adventurer', emoji: '🖌️', minCoins: 10 },
  { id: 4, name: 'Color Virtuoso', emoji: '🎨', minCoins: 15 },
  { id: 5, name: 'Spark Shaper', emoji: '⚡️', minCoins: 20 },
  { id: 6, name: 'Canvas Voyager', emoji: '🚀', minCoins: 30 },
  { id: 7, name: 'Palette Champion', emoji: '🏆', minCoins: 40 },
  { id: 8, name: 'Glyph Guardian', emoji: '🛡️', minCoins: 55 },
  { id: 9, name: 'Pixel Legend', emoji: '🐉', minCoins: 70 },
  { id: 10, name: 'Cosmic Creator', emoji: '🪐', minCoins: 90 }
];
