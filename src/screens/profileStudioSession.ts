/**
 * Pure session logic for the Profil Studio.
 *
 * Extracted from ProfileStudioScreen so the whole open → paint → upload →
 * reopen cycle can be tested without a device. Every bug this file guards
 * against was a real, shipped one:
 *  - opening as a blank NEW profile on a second device / after reinstall
 *  - the just-uploaded passport not being what you paint over next time
 *  - the picked name being forgotten outside the studio
 */
import type { Stroke } from '../state/PaintingContext';

export interface StudioBrushTransform {
  mirrorX: boolean;
  mirrorY: boolean;
  rotation: number;
}

/** Keep persisted/interactive brush rotation stable across negative and >360 values. */
export function normalizeStudioBrushRotation(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const wrapped = ((numeric % 360) + 360) % 360;
  return Math.abs(wrapped) < 0.0001 ? 0 : wrapped;
}

/**
 * Resolve the transform copied onto every new profile stroke. Keeping this
 * pure prevents the picker/mini-toolbar state from drifting from saved strokes.
 */
export function resolveStudioBrushTransform(value?: Partial<StudioBrushTransform> | null): StudioBrushTransform {
  return {
    mirrorX: value?.mirrorX === true,
    mirrorY: value?.mirrorY === true,
    rotation: normalizeStudioBrushRotation(value?.rotation),
  };
}

/**
 * Prepare the short old-to-new portrait animation shown after upload. The
 * newest local data URL is forced to the end so stale server/cache entries can
 * never become the final frame.
 */
export function buildPortraitTransitionFrames(
  history: (string | null | undefined)[],
  newestPortrait: string | null | undefined,
  maxFrames = 12,
): string[] {
  const newest = typeof newestPortrait === 'string' && newestPortrait.trim().length > 0
    ? newestPortrait.trim()
    : null;
  const normalized = history
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0 && value !== newest);
  const deduped = normalized.filter((value, index, values) => values.indexOf(value) === index);
  if (newest) deduped.push(newest);
  return deduped.slice(-Math.max(1, Math.floor(maxFrames)));
}

export type StudioSeedSource = 'local' | 'route' | 'server' | 'none';

export interface StudioSeedInputs {
  /** Background baked into the locally persisted studio state (trace image). */
  localTraceUri?: string | null;
  /** Last rendered passport saved locally. */
  localPortrait?: string | null;
  /** Name inside the persisted studio payload. */
  localStudioName?: string | null;
  /** Shared display-name key. */
  localDisplayName?: string | null;
  /** Handed over by ProfilePage from the profile it already fetched. */
  routePortrait?: string | null;
  routeName?: string | null;
  /** Last resort: the server snapshot for this device id. */
  serverPortrait?: string | null;
  serverName?: string | null;
}

export interface StudioSeed {
  background: string | null;
  name: string;
  source: StudioSeedSource;
  /**
   * Every usable background in priority order, de-duplicated. A single "best"
   * choice is not enough: a stored `file://` path dies when iOS changes the
   * app container UUID (reinstall), and a server URL can 404 — either way the
   * canvas would come up empty with no way to recover. The screen walks this
   * list on image-load failure so a dead entry falls through to the next.
   */
  candidates: string[];
}

const clean = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** 'Anonymous' is the server's placeholder — it must never beat a real name. */
const cleanName = (value: string | null | undefined): string | null => {
  const name = clean(value);
  return name && name !== 'Anonymous' ? name : null;
};

/**
 * Decide what the studio opens with. Local artwork wins for the background,
 * while the current Profile page name wins over stale painter-session data.
 */
export function resolveStudioSeed(inputs: StudioSeedInputs, nameMax = 19): StudioSeed {
  const candidates = [
    clean(inputs.localTraceUri),
    clean(inputs.localPortrait),
    clean(inputs.routePortrait),
    clean(inputs.serverPortrait),
  ].filter((value, index, all): value is string => value !== null && all.indexOf(value) === index);

  const background = candidates[0] ?? null;

  let source: StudioSeedSource = 'none';
  if (clean(inputs.localTraceUri) || clean(inputs.localPortrait)) source = 'local';
  else if (clean(inputs.routePortrait)) source = 'route';
  else if (clean(inputs.serverPortrait)) source = 'server';

  const name =
    cleanName(inputs.routeName) ??
    cleanName(inputs.localDisplayName) ??
    cleanName(inputs.serverName) ??
    cleanName(inputs.localStudioName) ??
    '';

  return { background, name: name.slice(0, nameMax), source, candidates };
}

/**
 * The background to persist. A studio session that came up without one (offline,
 * slow server, a dead URL) must NEVER write that emptiness over a background we
 * already had — that is how a good portrait gets permanently lost and every
 * later visit opens blank.
 */
export function backgroundToPersist(current: string | null, lastKnownGood: string | null): string | null {
  return current ?? lastKnownGood ?? null;
}

export interface StudioCanvasState {
  strokes: Stroke[];
  backgroundUri: string | null;
  name: string;
}

/**
 * State after a successful upload.
 *
 * The uploaded image already contains background + strokes flattened together,
 * so the strokes MUST NOT survive as a separate layer — keeping them would
 * replay them on top of the image they are already baked into, and the old
 * background would still be the trace. This is what makes the next visit show
 * the new passport, ready to paint over, every time.
 */
export function flattenAfterUpload(state: StudioCanvasState, portraitDataUrl: string): StudioCanvasState {
  return { strokes: [], backgroundUri: portraitDataUrl, name: state.name };
}

/** A render that produced (near) nothing must never replace a good portrait. */
export const MIN_PASSPORT_BASE64_CHARS = 1000;

export function isUsablePassport(base64: string | null | undefined): boolean {
  return typeof base64 === 'string' && base64.length >= MIN_PASSPORT_BASE64_CHARS;
}
