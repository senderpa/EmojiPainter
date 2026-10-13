/**
 * maskCollection — persists the face masks the user has generated/downloaded so
 * they can be reused later from the horizontal slider. The 3D head USDZ is
 * already cached on disk (by job id); here we store a small index pointing at
 * it plus a preview thumbnail + the ARKit rig mapping.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const KEY = '@face_masks_v1';
const MAX_MASKS = 40;

export interface SavedMask {
  id: string;
  usdzPath: string; // absolute local file path (file://…) — valid for THIS install
  /**
   * Path relative to documentDirectory (e.g. "face-emoji/<jobId>/head.usdz").
   * iOS rewrites the app-container UUID inside the absolute path on every
   * reinstall, so we re-resolve from this stable relative path on load.
   */
  relPath?: string;
  previewUri?: string; // remote/local thumbnail
  arkitMapping: Record<string, string>;
  label?: string;
  createdAt: number;
}

/**
 * Resolve a saved mask to a CURRENT absolute file path. Prefers the stable
 * relative path (rebuilt against today's documentDirectory) and falls back to
 * the stored absolute path for older entries.
 */
export function resolveMaskPath(mask: SavedMask): string {
  const docDir = FileSystem.documentDirectory ?? '';
  if (!docDir) return mask.usdzPath;
  if (mask.relPath) return `${docDir}${mask.relPath}`;
  // Older masks (no relPath): the id IS the job id, and downloadAsset stores at
  // a stable per-job dir, so we can still rebuild the path.
  if (mask.id) return `${docDir}face-emoji/${mask.id}/head.usdz`;
  return mask.usdzPath;
}

export async function loadMasks(): Promise<SavedMask[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveMasks(masks: SavedMask[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(masks.slice(0, MAX_MASKS)));
  } catch {
    /* ignore */
  }
}

/** Add (or move-to-front) a mask, returning the updated list. */
export async function addMask(mask: SavedMask): Promise<SavedMask[]> {
  const existing = await loadMasks();
  const deduped = existing.filter((m) => m.id !== mask.id);
  const next = [mask, ...deduped].slice(0, MAX_MASKS);
  await saveMasks(next);
  return next;
}

export async function removeMask(id: string): Promise<SavedMask[]> {
  const existing = await loadMasks();
  const next = existing.filter((m) => m.id !== id);
  await saveMasks(next);
  return next;
}
