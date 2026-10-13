/**
 * emojiSets — registry of selectable emoji sets:
 *   • apple    : system emoji (no resolver; <Text> renders natively)
 *   • material : bundled custom set (require()'d assets)
 *   • imported : sets the user imports from an EmojiKit .zip, stored as files in Documents and
 *                rendered via file:// URIs.
 *
 * Each set exposes a resolver (emoji grapheme -> image source) used by AppText/AppEmoji.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import JSZip from 'jszip';
import { customEmojiSource, makeFileResolver, MAX_KEY_LEN, type EmojiResolver } from './customEmoji';

export type EmojiSetKind = 'system' | 'bundled' | 'imported';
export interface EmojiSetMeta {
  id: string;
  name: string;
  kind: EmojiSetKind;
  preview: string[];
  count?: number;
  resolve: EmojiResolver;
  maxKeyLen: number;
}

const PREVIEW = ['🎨', '👍', '🔥', '⭐️', '🌈', '😀', '🚀'];

export const APPLE_SET: EmojiSetMeta = {
  id: 'apple', name: 'Apple', kind: 'system', preview: PREVIEW, resolve: () => null, maxKeyLen: 1
};
export const MATERIAL_SET: EmojiSetMeta = {
  id: 'material', name: 'Material', kind: 'bundled', preview: PREVIEW, resolve: customEmojiSource, maxKeyLen: MAX_KEY_LEN
};

export const BUILTIN_SETS: EmojiSetMeta[] = [APPLE_SET, MATERIAL_SET];

const SETS_DIR = (FileSystem.documentDirectory || '') + 'emojiSets/';
const REGISTRY = SETS_DIR + 'registry.json';

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(SETS_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(SETS_DIR, { intermediates: true });
}

interface RegistryEntry { id: string; name: string }

async function readRegistry(): Promise<RegistryEntry[]> {
  try {
    const txt = await FileSystem.readAsStringAsync(REGISTRY);
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function writeRegistry(entries: RegistryEntry[]) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(REGISTRY, JSON.stringify(entries));
}

/** Build an EmojiSetMeta for one imported set folder (loads its index, builds a file resolver). */
async function loadImportedSet(entry: RegistryEntry): Promise<EmojiSetMeta | null> {
  try {
    const dir = SETS_DIR + entry.id + '/';
    const idxTxt = await FileSystem.readAsStringAsync(dir + 'emoji-index.json');
    const index = JSON.parse(idxTxt) as Record<string, string>;
    const { resolve, maxKeyLen } = makeFileResolver(index, dir);
    const preview = PREVIEW.filter((e) => resolve(e) != null);
    return {
      id: entry.id, name: entry.name, kind: 'imported',
      preview: preview.length ? preview : Object.keys(index).slice(0, 7),
      count: Object.keys(index).length, resolve, maxKeyLen
    };
  } catch { return null; }
}

/** All available sets = built-ins + every successfully-loaded imported set. */
export async function loadAllSets(): Promise<EmojiSetMeta[]> {
  const entries = await readRegistry();
  const imported = (await Promise.all(entries.map(loadImportedSet))).filter(Boolean) as EmojiSetMeta[];
  return [...BUILTIN_SETS, ...imported];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 24) || 'set';

/**
 * Import an EmojiKit .zip the user picks. Extracts the emoji-index.json + webp tier (prefers 320, then
 * 160, then flat) into Documents/emojiSets/<id>/ and registers it. Returns the new set's id, or null.
 * onProgress(done,total) reports extraction progress.
 */
export async function importSetFromZip(onProgress?: (done: number, total: number) => void): Promise<string | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'public.zip-archive', '*/*'], copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];
  const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const zip = await JSZip.loadAsync(b64, { base64: true });

  // locate the index json + decide which tier folder holds the webp
  const indexEntry = Object.keys(zip.files).find((p) => p.endsWith('emoji-index.json'));
  if (!indexEntry) throw new Error('No emoji-index.json in the zip — run EmojiKit "prepare/convert" first.');
  const webpPaths = Object.keys(zip.files).filter((p) => p.toLowerCase().endsWith('.webp') && !zip.files[p].dir);
  if (!webpPaths.length) throw new Error('No .webp images in the zip.');
  const pickTier = (dir: string) => webpPaths.filter((p) => p.includes('/' + dir + '/') || p.startsWith(dir + '/'));
  let chosen = pickTier('webp_320');
  if (!chosen.length) chosen = pickTier('webp_160');
  if (!chosen.length) chosen = webpPaths; // flat pack

  const name = (asset.name || 'Imported').replace(/\.zip$/i, '').replace(/_custom-emoji-set$/i, '');
  const id = slug(name) + '-' + String(Date.now()).slice(-6);
  const dir = SETS_DIR + id + '/';
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  // write the index
  const idxStr = await zip.files[indexEntry].async('string');
  await FileSystem.writeAsStringAsync(dir + 'emoji-index.json', idxStr);

  // write each chosen webp FLAT (basename) so it matches the index filenames
  let done = 0;
  for (const p of chosen) {
    const base = p.split('/').pop()!;
    const data = await zip.files[p].async('base64');
    await FileSystem.writeAsStringAsync(dir + base, data, { encoding: FileSystem.EncodingType.Base64 });
    done += 1;
    if (onProgress && done % 25 === 0) onProgress(done, chosen.length);
  }
  if (onProgress) onProgress(chosen.length, chosen.length);

  const entries = await readRegistry();
  entries.push({ id, name });
  await writeRegistry(entries);
  return id;
}

export async function deleteImportedSet(id: string): Promise<void> {
  const entries = (await readRegistry()).filter((e) => e.id !== id);
  await writeRegistry(entries);
  try { await FileSystem.deleteAsync(SETS_DIR + id, { idempotent: true }); } catch { /* ignore */ }
}
