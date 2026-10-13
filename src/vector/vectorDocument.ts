import * as FileSystem from 'expo-file-system/legacy';
import {
  VECTOR_SCHEMA,
  VECTOR_SCHEMA_VERSION,
  VectorCameraState,
  VectorDocumentMeta,
  VectorLoopMode,
  VectorStroke,
  VectorViewpoint,
} from './vectorTypes';

// Package persistence following the handoff layout (one authoritative record per
// stroke in its own file — commits never rewrite the whole document):
//   Documents/vector/current/manifest.json
//   Documents/vector/current/strokes/<strokeID>.json
// V1 keeps a single "current" document that auto-resumes.

const ROOT = `${FileSystem.documentDirectory}vector/current/`;
const MANIFEST = `${ROOT}manifest.json`;
const STROKES_DIR = `${ROOT}strokes/`;

async function ensureDirs(): Promise<void> {
  for (const d of [ROOT, STROKES_DIR]) {
    const info = await FileSystem.getInfoAsync(d);
    if (!info.exists) await FileSystem.makeDirectoryAsync(d, { intermediates: true });
  }
}

function newDocumentID(): string {
  return `vecdoc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface LoadedVectorDocument {
  meta: VectorDocumentMeta;
  strokes: VectorStroke[];
}

/**
 * Read ONLY the manifest — cheap, one file. Opening the workspace uses this to
 * offer resume/new instantly; reading every stroke first meant the prompt
 * appeared half a minute after the (empty-looking) canvas.
 */
export async function loadVectorManifest(): Promise<VectorDocumentMeta | null> {
  try {
    const info = await FileSystem.getInfoAsync(MANIFEST);
    if (!info.exists) return null;
    const meta = JSON.parse(await FileSystem.readAsStringAsync(MANIFEST)) as VectorDocumentMeta;
    if (meta.schema !== VECTOR_SCHEMA || !Array.isArray(meta.strokeOrder)) return null;
    return meta;
  } catch (error) {
    console.warn('[Vector] manifest read failed:', error);
    return null;
  }
}

export async function loadVectorDocument(): Promise<LoadedVectorDocument | null> {
  try {
    const meta = await loadVectorManifest();
    if (!meta) return null;
    // Read every stroke IN PARALLEL. Sequential awaits made opening a document
    // with a few dozen strokes take tens of seconds.
    const settled = await Promise.all(
      meta.strokeOrder.map(async (id) => {
        try {
          const raw = await FileSystem.readAsStringAsync(`${STROKES_DIR}${id}.json`);
          const s = JSON.parse(raw) as VectorStroke;
          return s && Array.isArray(s.samples) ? s : null;
        } catch {
          // missing stroke file → skip (recovery: keep the rest of the document)
          return null;
        }
      })
    );
    return { meta, strokes: settled.filter((s): s is VectorStroke => s !== null) };
  } catch (error) {
    console.warn('[Vector] document load failed:', error);
    return null;
  }
}

/** Where the session preview thumbnail lives (shown in the resume prompt). */
export const VECTOR_SESSION_PREVIEW = `${ROOT}preview.png`;

export async function saveSessionPreview(base64: string): Promise<void> {
  try {
    await ensureDirs();
    await FileSystem.writeAsStringAsync(VECTOR_SESSION_PREVIEW, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (error) {
    console.warn('[Vector] preview save failed:', error);
  }
}

export async function loadSessionPreviewUri(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(VECTOR_SESSION_PREVIEW);
    return info.exists ? `${VECTOR_SESSION_PREVIEW}?t=${info.modificationTime ?? 0}` : null;
  } catch {
    return null;
  }
}

export async function saveStroke(stroke: VectorStroke): Promise<void> {
  await ensureDirs();
  // Derived caches are rebuildable — keep the file authoritative-only.
  const { stampPositions: _drop, stampCarry: _dropCarry, stampStep: _dropStep, stampPathLength: _dropPathLength, ...persisted } = stroke;
  await FileSystem.writeAsStringAsync(`${STROKES_DIR}${stroke.strokeID}.json`, JSON.stringify(persisted));
}

export async function deleteStroke(strokeID: string): Promise<void> {
  await FileSystem.deleteAsync(`${STROKES_DIR}${strokeID}.json`, { idempotent: true }).catch(() => {});
}

export async function saveManifest(
  documentID: string | null,
  camera: VectorCameraState,
  strokeOrder: string[],
  viewpoints?: VectorViewpoint[],
  loopMode?: VectorLoopMode
): Promise<string> {
  await ensureDirs();
  const now = new Date().toISOString();
  const id = documentID ?? newDocumentID();
  const meta: VectorDocumentMeta = {
    schema: VECTOR_SCHEMA,
    schemaVersion: VECTOR_SCHEMA_VERSION,
    documentID: id,
    createdAt: now, // preserved below when the manifest already exists
    updatedAt: now,
    mode: 'vector',
    defaultWidthMode: 'worldConstant',
    camera,
    strokeOrder,
    viewpoints: viewpoints ?? [],
    loopMode: loopMode ?? 'pingPong',
  };
  try {
    const existing = await FileSystem.getInfoAsync(MANIFEST);
    if (existing.exists) {
      const prev = JSON.parse(await FileSystem.readAsStringAsync(MANIFEST)) as VectorDocumentMeta;
      if (prev.createdAt) meta.createdAt = prev.createdAt;
      if (!documentID && prev.documentID) meta.documentID = prev.documentID;
    }
  } catch {
    // fresh manifest
  }
  await FileSystem.writeAsStringAsync(MANIFEST, JSON.stringify(meta));
  return meta.documentID;
}

export async function clearVectorDocument(): Promise<void> {
  await FileSystem.deleteAsync(ROOT, { idempotent: true }).catch(() => {});
}

/** Atomically replace the resumable Vector workspace with a library project. */
export async function replaceVectorDocument(document: LoadedVectorDocument): Promise<void> {
  await clearVectorDocument();
  await ensureDirs();
  // Each file is independent; serial bridge writes made opening a saved Vector
  // project look like a blank canvas for tens of seconds.
  await Promise.all(document.strokes.map((stroke) => saveStroke(stroke)));
  await saveManifest(
    document.meta.documentID,
    document.meta.camera,
    document.strokes.map((stroke) => stroke.strokeID),
    document.meta.viewpoints ?? [],
    document.meta.loopMode ?? 'pingPong',
  );
}
