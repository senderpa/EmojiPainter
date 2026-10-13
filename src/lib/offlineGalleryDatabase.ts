import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';

export interface OfflineGalleryEntry {
  id: number;
  imageUri: string;
  topic: string;
  emoji: string;
  createdAt: number;
  durationSec: number | null;
  isMysteryPaint: number; // 1 = true
  mysteryTopicText: string | null;
}

let db: SQLite.SQLiteDatabase | null = null;

export async function initOfflineGalleryDb(): Promise<void> {
  if (db) return;
  db = await SQLite.openDatabaseAsync('gallery.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS offline_gallery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imageUri TEXT NOT NULL,
      topic TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🎨',
      createdAt INTEGER NOT NULL,
      durationSec INTEGER,
      isMysteryPaint INTEGER DEFAULT 0,
      mysteryTopicText TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_offline_created ON offline_gallery(createdAt DESC);
  `);
}

const OFFLINE_DIR = (): string => {
  const fs = FileSystem as typeof FileSystem & { documentDirectory?: string };
  return (fs.documentDirectory ?? '') + 'offline_gallery/';
};

export async function saveOfflinePainting(entry: {
  imageUri: string;
  topic: string;
  emoji: string;
  createdAt: number;
  durationSec: number | null;
  isMysteryPaint: boolean;
  mysteryTopicText: string | null;
}): Promise<number> {
  if (!db) await initOfflineGalleryDb();

  const dir = OFFLINE_DIR();
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const filename = `paint_${entry.createdAt}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const permanentUri = dir + filename;

  await FileSystem.copyAsync({ from: entry.imageUri, to: permanentUri });

  const result = await db!.runAsync(
    `INSERT INTO offline_gallery (imageUri, topic, emoji, createdAt, durationSec, isMysteryPaint, mysteryTopicText)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      permanentUri,
      entry.topic,
      entry.emoji,
      entry.createdAt,
      entry.durationSec ?? null,
      entry.isMysteryPaint ? 1 : 0,
      entry.mysteryTopicText ?? null,
    ]
  );
  return result.lastInsertRowId;
}

export async function getOfflineEntries(): Promise<OfflineGalleryEntry[]> {
  if (!db) await initOfflineGalleryDb();
  return db!.getAllAsync<OfflineGalleryEntry>(
    'SELECT * FROM offline_gallery ORDER BY createdAt DESC'
  );
}

export async function deleteOfflineEntry(id: number): Promise<void> {
  if (!db) await initOfflineGalleryDb();
  const entry = await db!.getFirstAsync<{ imageUri: string }>(
    'SELECT imageUri FROM offline_gallery WHERE id = ?',
    [id]
  );
  if (entry?.imageUri) {
    await FileSystem.deleteAsync(entry.imageUri, { idempotent: true }).catch(() => {});
  }
  await db!.runAsync('DELETE FROM offline_gallery WHERE id = ?', [id]);
}

export async function getOfflineEntryCount(): Promise<number> {
  if (!db) await initOfflineGalleryDb();
  const result = await db!.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM offline_gallery'
  );
  return result?.count ?? 0;
}

export async function clearAllOfflineEntries(): Promise<void> {
  if (!db) await initOfflineGalleryDb();
  const entries = await getOfflineEntries();
  for (const e of entries) {
    await FileSystem.deleteAsync(e.imageUri, { idempotent: true }).catch(() => {});
  }
  await db!.runAsync('DELETE FROM offline_gallery');
}
