import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { getSessionId } from './session';
import type { LayerVisibility, PaintLayer, Stroke, TraceState } from '../state/PaintingContext';
import type { GifQualityPresetId } from './gif';
import type { LoadedVectorDocument } from '../vector/vectorDocument';

type ProjectPayload = {
  createdAt: string;
  updatedAt: string;
  strokes: Stroke[];
  trace: TraceState;
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  brushRotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  recentEmojis?: string[];
  preview?: string | null;
  // 3-layer system: per-stroke assignment rides on each Stroke; only the editor-level
  // visibility/active-layer bits are stored here. Optional → old projects load unchanged.
  activeLayer?: PaintLayer;
  layerVisibility?: LayerVisibility;
  // Frame-by-frame animation data (optional)
  frames?: AnimationFrame[];
  fps?: number;
  isAnimation?: boolean;
  // Framer workspace frames data (optional)
  framerFrames?: any;
  // Save metadata — kind: 'painting' | 'ar_scene' | 'facemask', plus refs
  metadata?: {
    savedFrom?: string;
    savedAt?: string;
    kind?: 'painting' | 'ar_scene' | 'facemask' | 'vector';
    arSceneDir?: string;
    vectorDocument?: LoadedVectorDocument;
    [key: string]: any;
  };
};

export type { ProjectPayload };

export type AnimationFrame = {
  id: string;
  strokes: Stroke[];
  timestamp: number;
  thumbnail?: string;
  renderedImageUri?: string; // Full-res rendered image for playback
};

export type AnimationProjectPayload = {
  projectId: string; // Unique project identifier
  createdAt: string;
  updatedAt: string;
  frames: AnimationFrame[];
  selectedFrameIndex: number; // Which frame is currently selected
  fps: number;
  preview?: string | null; // Animated preview (looping GIF/MOV thumbnail)
};

export interface GifExportEntry {
  id: string;
  path: string;
  width: number;
  frameCount: number;
  durationMs: number;
  preset: GifQualityPresetId;
  createdAt: string;
}

const PROJECT_PREFIX = 'emojipaint/project/';
const ANIMATION_PROJECT_PREFIX = 'emojipaint/animation/';
const GIF_EXPORTS_KEY = 'emojipaint/timelapse/gifs';
const MAX_GIF_HISTORY = 100;

const PROJECT_MEDIA_DIR = `${FileSystem.documentDirectory ?? ''}project-media/`;
const safeMediaSlug = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'project';

/**
 * `preview` is typically a `captureRef(..., {result: 'tmpfile'})` output — a path under React
 * Native's OWN /tmp directory, which iOS purges aggressively and does NOT survive even a single
 * app restart reliably, let alone a reinstall. `trace.imageUri` is usually under Library/Caches,
 * which iOS is also free to purge at any time. Neither is a safe place to persist a path that a
 * saved PROJECT will try to re-load days later. Copy any local file into a STABLE, permanent
 * location under documentDirectory instead, and store that path — this is the actual fix;
 * resolveStaleContainerPath() below is only a fallback for whatever was already saved before it.
 */
async function persistLocalMedia(uri: string | null | undefined, destFilename: string): Promise<string | null | undefined> {
  if (!uri || typeof uri !== 'string') return uri;
  if (!uri.startsWith('file://') && !uri.startsWith('/')) return uri; // http(s), data URI, etc. — as-is
  try {
    await FileSystem.makeDirectoryAsync(PROJECT_MEDIA_DIR, { intermediates: true }).catch(() => {});
    const dest = PROJECT_MEDIA_DIR + destFilename;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch (error) {
    console.warn('[storage] Failed to persist local media, falling back to original path:', error);
    return uri;
  }
}

export async function saveProject(name: string, payload: ProjectPayload): Promise<void> {
  // Scope saves to the current app-run session to avoid overwriting across launches
  const sessionId = await getSessionId();
  const key = `${PROJECT_PREFIX}${sessionId}/${name}`;
  const timestamp = new Date().toISOString();
  const slug = safeMediaSlug(name);
  const [stablePreview, stableTraceUri] = await Promise.all([
    persistLocalMedia(payload.preview, `${slug}-preview.png`),
    persistLocalMedia(payload.trace?.imageUri, `${slug}-trace.jpg`)
  ]);
  const stamped: ProjectPayload = {
    ...payload,
    preview: stablePreview ?? payload.preview,
    trace: payload.trace ? { ...payload.trace, imageUri: stableTraceUri ?? payload.trace.imageUri } : payload.trace,
    createdAt: payload.createdAt ?? timestamp,
    updatedAt: timestamp
  };
  const data = JSON.stringify(stamped);
  await AsyncStorage.setItem(key, data);
}

/**
 * A saved project's `preview`/`trace.imageUri` were written as absolute file:// paths, e.g.
 * `/var/mobile/Containers/Data/Application/<UUID>/Documents/...`. iOS reassigns <UUID> on every
 * reinstall/rebuild, so any project saved before the CURRENT install has a dead image path — the
 * project list then shows no preview, and (unconfirmed but plausible) loading it may destabilize
 * whatever renders that dead path as a full-screen background. Re-anchor to the CURRENT
 * documentDirectory/cacheDirectory at LOAD time, keyed off the stable "/Documents/" or "/Caches/"
 * subpath — this fixes every already-broken saved project retroactively, not just future saves.
 */
function resolveStaleContainerPath(uri: string | null | undefined): string | null | undefined {
  if (!uri || typeof uri !== 'string') return uri;
  if (!uri.startsWith('file://') && !uri.startsWith('/')) return uri; // http(s), data URI, etc.
  const docsMarker = '/Documents/';
  const cachesMarker = '/Caches/';
  const docsIdx = uri.indexOf(docsMarker);
  if (docsIdx >= 0 && FileSystem.documentDirectory) {
    return FileSystem.documentDirectory + uri.slice(docsIdx + docsMarker.length);
  }
  const cachesIdx = uri.indexOf(cachesMarker);
  if (cachesIdx >= 0 && FileSystem.cacheDirectory) {
    return FileSystem.cacheDirectory + uri.slice(cachesIdx + cachesMarker.length);
  }
  return uri;
}

function reanchorProjectPayload(payload: ProjectPayload): ProjectPayload {
  return {
    ...payload,
    preview: resolveStaleContainerPath(payload.preview) ?? null,
    trace: payload.trace
      ? { ...payload.trace, imageUri: resolveStaleContainerPath(payload.trace.imageUri) ?? null }
      : payload.trace
  };
}

export async function loadProject(name: string): Promise<ProjectPayload | null> {
  // Try session-scoped first, then fall back to legacy key
  const sessionId = await getSessionId();
  let key = `${PROJECT_PREFIX}${sessionId}/${name}`;
  const data = await AsyncStorage.getItem(key);
  if (!data) {
    // legacy support
    const legacy = await AsyncStorage.getItem(`${PROJECT_PREFIX}${name}`);
    if (!legacy) return null;
    try { return reanchorProjectPayload(JSON.parse(legacy) as ProjectPayload); } catch (e) { return null; }
  }
  try {
    return reanchorProjectPayload(JSON.parse(data) as ProjectPayload);
  } catch (error) {
    console.error('Failed to parse project payload', error);
    return null;
  }
}

export async function listProjects(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  // Keys may be legacy (no session) or session-scoped: emojipaint/project/<session>/<name>
  // We want to display only the user-chosen name, not the session part.
  const names = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(PROJECT_PREFIX)) continue;
    const remainder = key.slice(PROJECT_PREFIX.length);
    const parts = remainder.split('/');
    const name = parts.length >= 2 ? parts.slice(1).join('/') : parts[0];
    if (name && name.trim().length > 0) names.add(name);
  }
  return Array.from(names);
}

export async function deleteProject(name: string): Promise<void> {
  const sessionId = await getSessionId();
  const scoped = `${PROJECT_PREFIX}${sessionId}/${name}`;
  await AsyncStorage.removeItem(scoped);
  // Also clean legacy key if present
  await AsyncStorage.removeItem(`${PROJECT_PREFIX}${name}`);
}

// Animation project storage functions
export async function saveAnimationProject(name: string, payload: Partial<AnimationProjectPayload> & { frames: AnimationFrame[], fps: number }): Promise<void> {
  const sessionId = await getSessionId();
  const key = `${ANIMATION_PROJECT_PREFIX}${sessionId}/${name}`;
  const timestamp = new Date().toISOString();
  const stamped: AnimationProjectPayload = {
    projectId: payload.projectId ?? `${sessionId}/${name}`,
    createdAt: payload.createdAt ?? timestamp,
    updatedAt: timestamp,
    frames: payload.frames,
    selectedFrameIndex: payload.selectedFrameIndex ?? 0,
    fps: payload.fps,
    preview: payload.preview ?? null
  };
  const data = JSON.stringify(stamped);
  await AsyncStorage.setItem(key, data);
}

export async function loadAnimationProject(name: string): Promise<AnimationProjectPayload | null> {
  const sessionId = await getSessionId();
  const key = `${ANIMATION_PROJECT_PREFIX}${sessionId}/${name}`;
  const data = await AsyncStorage.getItem(key);
  if (!data) {
    // Try legacy key
    const legacy = await AsyncStorage.getItem(`${ANIMATION_PROJECT_PREFIX}${name}`);
    if (!legacy) return null;
    try {
      const parsed = JSON.parse(legacy) as Partial<AnimationProjectPayload>;
      // Migrate old format to new format
      return {
        projectId: parsed.projectId ?? `legacy/${name}`,
        createdAt: parsed.createdAt ?? new Date().toISOString(),
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        frames: parsed.frames ?? [],
        selectedFrameIndex: parsed.selectedFrameIndex ?? 0,
        fps: parsed.fps ?? 12,
        preview: parsed.preview ?? null
      };
    } catch (e) {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(data) as Partial<AnimationProjectPayload>;
    // Ensure all required fields exist (backward compatibility)
    return {
      projectId: parsed.projectId ?? `${sessionId}/${name}`,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      frames: parsed.frames ?? [],
      selectedFrameIndex: parsed.selectedFrameIndex ?? 0,
      fps: parsed.fps ?? 12,
      preview: parsed.preview ?? null
    };
  } catch (error) {
    console.error('Failed to parse animation project payload', error);
    return null;
  }
}

export async function listAnimationProjects(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  const names = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(ANIMATION_PROJECT_PREFIX)) continue;
    const remainder = key.slice(ANIMATION_PROJECT_PREFIX.length);
    const parts = remainder.split('/');
    const name = parts.length >= 2 ? parts.slice(1).join('/') : parts[0];
    if (name && name.trim().length > 0) names.add(name);
  }
  return Array.from(names);
}

export async function deleteAnimationProject(name: string): Promise<void> {
  const sessionId = await getSessionId();
  const scoped = `${ANIMATION_PROJECT_PREFIX}${sessionId}/${name}`;
  await AsyncStorage.removeItem(scoped);
  // Also clean legacy key if present
  await AsyncStorage.removeItem(`${ANIMATION_PROJECT_PREFIX}${name}`);
}

export function createProjectPayload(args: {
  strokes: Stroke[];
  trace: TraceState;
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  brushRotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  recentEmojis?: string[];
  preview?: string | null;
  createdAt?: string;
  frames?: AnimationFrame[];
  fps?: number;
  isAnimation?: boolean;
  framerFrames?: any;
  activeLayer?: PaintLayer;
  layerVisibility?: LayerVisibility;
}): ProjectPayload {
  const timestamp = new Date().toISOString();
  return {
    createdAt: args.createdAt ?? timestamp,
    updatedAt: timestamp,
    strokes: args.strokes,
    trace: args.trace,
    brushEmoji: args.brushEmoji,
    brushSize: args.brushSize,
    brushOpacity: args.brushOpacity,
    brushSpacing: args.brushSpacing,
    brushRotation: args.brushRotation,
    mirrorX: args.mirrorX,
    mirrorY: args.mirrorY,
    recentEmojis: args.recentEmojis,
    preview: args.preview ?? null,
    frames: args.frames,
    fps: args.fps,
    isAnimation: args.isAnimation,
    framerFrames: args.framerFrames,
    activeLayer: args.activeLayer,
    layerVisibility: args.layerVisibility
  };
}

export function duplicatePayload(payload: ProjectPayload): ProjectPayload {
  return {
    ...payload,
    strokes: payload.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
      emojiSequence: stroke.emojiSequence ? stroke.emojiSequence.slice() : undefined
    })),
    trace: { ...payload.trace },
    brushSpacing: payload.brushSpacing,
    brushRotation: payload.brushRotation,
    mirrorX: payload.mirrorX,
    mirrorY: payload.mirrorY,
    recentEmojis: payload.recentEmojis?.slice(),
    // Deep clone frames array if present
    frames: payload.frames ? payload.frames.map(f => ({
      id: f.id,
      strokes: f.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
        emojiSequence: stroke.emojiSequence ? stroke.emojiSequence.slice() : undefined
      })),
      timestamp: f.timestamp,
      thumbnail: f.thumbnail
    })) : undefined,
    fps: payload.fps,
    isAnimation: payload.isAnimation,
    updatedAt: new Date().toISOString()
  };
}

export async function listGifExports(): Promise<GifExportEntry[]> {
  const raw = await AsyncStorage.getItem(GIF_EXPORTS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as GifExportEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry) => typeof entry.path === 'string');
  } catch (error) {
    console.warn('Failed to parse GIF export registry', error);
    return [];
  }
}

export async function recordGifExport(entry: {
  path: string;
  width: number;
  frameCount: number;
  durationMs: number;
  preset: GifQualityPresetId;
  id?: string;
  createdAt?: string;
}): Promise<GifExportEntry> {
  const existing = await listGifExports();
  const id = entry.id ?? `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const createdAt = entry.createdAt ?? new Date().toISOString();
  const record: GifExportEntry = {
    id,
    createdAt,
    path: entry.path,
    width: entry.width,
    frameCount: entry.frameCount,
    durationMs: entry.durationMs,
    preset: entry.preset
  };

  const filtered = existing.filter((item) => item.id !== id && item.path !== record.path);
  filtered.unshift(record);
  const trimmed = filtered.slice(0, MAX_GIF_HISTORY);
  await AsyncStorage.setItem(GIF_EXPORTS_KEY, JSON.stringify(trimmed));
  return record;
}

// ============================================================================
// UNIFIED SAVE/LOAD SYSTEM
// ============================================================================
// Wrapper functions that provide unified save/load with metadata tracking
// Both Portfolio and Framer use these functions for consistent behavior

// ── AR / Face project library helpers ──────────────────────────────────────
// Register AR scenes and face masks in the SAME project library as paintings,
// distinguished by metadata.kind. Loading them routes back into the AR modes.

const emptyTrace: TraceState = {
  imageUri: null,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  opacity: 1,
  isBackground: true,
};

export async function saveArSceneProject(
  name: string,
  arSceneDir: string,
  snapshotPath: string,
  strokeCount: number
): Promise<void> {
  const now = new Date().toISOString();
  const payload: ProjectPayload = {
    createdAt: now,
    updatedAt: now,
    strokes: [],
    trace: emptyTrace,
    brushEmoji: '🧱',
    brushSize: 0,
    brushOpacity: 1,
    brushSpacing: 0,
    brushRotation: 0,
    mirrorX: false,
    mirrorY: false,
    preview: snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`,
    metadata: {
      kind: 'ar_scene',
      arSceneDir,
      savedAt: now,
      strokeCount,
    },
  };
  await saveProject(name, payload);
}

/** Save the current face-mask painting (2D strokes) as a face-mask project. */
export async function saveFaceMaskProject(
  name: string,
  payload: ProjectPayload,
  snapshotPath?: string | null
): Promise<void> {
  const enriched: ProjectPayload = {
    ...payload,
    preview: snapshotPath
      ? (snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`)
      : payload.preview,
    metadata: {
      ...(payload.metadata || {}),
      kind: 'facemask',
      savedAt: new Date().toISOString(),
    },
  };
  await saveProject(name, enriched);
}

/** Register a complete Vector document in the normal Projects library. */
export async function saveVectorProject(
  name: string,
  document: LoadedVectorDocument,
  preview?: string | null
): Promise<void> {
  await saveProject(name, buildVectorProjectPayload(document, preview));
}

export function buildVectorProjectPayload(
  document: LoadedVectorDocument,
  preview?: string | null
): ProjectPayload {
  const now = new Date().toISOString();
  const authoritativeDocument: LoadedVectorDocument = {
    meta: { ...document.meta },
    strokes: document.strokes.map(({ stampPositions: _derived, stampCarry: _carry, stampStep: _step, stampPathLength: _pathLength, ...stroke }) => stroke),
  };
  const payload: ProjectPayload = {
    createdAt: document.meta.createdAt || now,
    updatedAt: now,
    strokes: [],
    trace: emptyTrace,
    brushEmoji: '🔷',
    brushSize: 0,
    brushOpacity: 1,
    brushSpacing: 0,
    brushRotation: 0,
    mirrorX: false,
    mirrorY: false,
    preview: preview ?? null,
    metadata: {
      kind: 'vector',
      savedFrom: 'vector',
      savedAt: now,
      vectorDocument: authoritativeDocument,
      vectorStrokeCount: authoritativeDocument.strokes.length,
      vectorViewpointCount: authoritativeDocument.meta.viewpoints?.length ?? 0,
    },
  };
  return payload;
}

export async function saveProjectUnified(
  projectName: string,
  payload: ProjectPayload,
  source: 'workspace' | 'framer'
): Promise<void> {
  // Add metadata about save source
  const enrichedPayload = {
    ...payload,
    metadata: {
      ...((payload as any).metadata || {}),
      savedFrom: source,
      savedAt: new Date().toISOString()
    }
  };

  // Use standard save function
  await saveProject(projectName, enrichedPayload as ProjectPayload);

  // Log unified save
  console.log(`[UNIFIED SAVE] From ${source}:`, {
    projectName,
    hasFrames: !!enrichedPayload.framerFrames?.frames?.length,
    frameCount: enrichedPayload.framerFrames?.frames?.length ?? 0,
    hasStrokes: enrichedPayload.strokes.length > 0,
    strokeCount: enrichedPayload.strokes.length
  });
}

export async function loadProjectUnified(
  projectName: string,
  target: 'workspace' | 'framer' | 'both'
): Promise<ProjectPayload | null> {
  const payload = await loadProject(projectName);

  if (!payload) return null;

  // Log unified load
  console.log(`[UNIFIED LOAD] To ${target}:`, {
    projectName,
    hasFrames: !!payload.framerFrames?.frames?.length,
    frameCount: payload.framerFrames?.frames?.length ?? 0,
    hasStrokes: payload.strokes.length > 0,
    strokeCount: payload.strokes.length,
    source: (payload as any).metadata?.savedFrom
  });

  return payload;
}
