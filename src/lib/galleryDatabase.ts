import * as SQLite from 'expo-sqlite';

export interface CachedGalleryImage {
  id: number;
  imageUrl: string;
  rawUrl: string;
  topic: string;
  createdAt: number;
  challengeAt?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  deviceId?: string | null;
  passportName?: string | null;
  passportPortrait?: string | null;
  frameUrls?: string | null; // JSON string
  frameCount?: number;
  coinCount?: number;
  coins?: number;
  rank?: number;
  uploadedAt?: string | null;
  updatedAt?: string | null;
  upvotes?: number;
  downvotes?: number;
  isMysteryPaint?: number | null; // 1 = true, 0/null = false
  mysteryPaintingId?: number | null;
  mysteryTopicId?: number | null; // masking seed — matches PHP gesser-utils.php mask_topic seed
  mysteryTopicText?: string | null; // actual mystery answer (differs from topic = daily challenge topic)
  isSolved?: number | null;
  solverName?: string | null;
  solveCount?: number | null;
  totalAttempts?: number | null;
  cachedAt: number;
  sort: string;
}

let db: SQLite.SQLiteDatabase | null = null;

// Mutex lock to prevent concurrent database writes
let writeLock: Promise<void> = Promise.resolve();
let isWriting = false;

/**
 * Initialize the gallery database
 */
export async function initGalleryDatabase(): Promise<void> {
  if (db) return;

  try {
    db = await SQLite.openDatabaseAsync('gallery.db');

    // Create table if it doesn't exist
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS gallery_cache (
        id INTEGER PRIMARY KEY,
        imageUrl TEXT NOT NULL,
        rawUrl TEXT NOT NULL,
        topic TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        challengeAt INTEGER,
        durationSec INTEGER,
        width INTEGER,
        height INTEGER,
        deviceId TEXT,
        passportName TEXT,
        passportPortrait TEXT,
        frameUrls TEXT,
        frameCount INTEGER,
        coinCount INTEGER,
        coins INTEGER,
        rank INTEGER,
        uploadedAt TEXT,
        updatedAt TEXT,
        upvotes INTEGER,
        downvotes INTEGER,
        isMysteryPaint INTEGER,
        mysteryPaintingId INTEGER,
        mysteryTopicId INTEGER,
        mysteryTopicText TEXT,
        isSolved INTEGER,
        solverName TEXT,
        solveCount INTEGER,
        totalAttempts INTEGER,
        cachedAt INTEGER NOT NULL,
        sort TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_gallery_sort_cached ON gallery_cache(sort, cachedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_gallery_created ON gallery_cache(createdAt DESC);
    `);

    // Migrate existing databases: add mystery columns if missing
    const migrations = [
      'ALTER TABLE gallery_cache ADD COLUMN isMysteryPaint INTEGER',
      'ALTER TABLE gallery_cache ADD COLUMN mysteryPaintingId INTEGER',
      'ALTER TABLE gallery_cache ADD COLUMN mysteryTopicId INTEGER',
      'ALTER TABLE gallery_cache ADD COLUMN mysteryTopicText TEXT',
      'ALTER TABLE gallery_cache ADD COLUMN isSolved INTEGER',
      'ALTER TABLE gallery_cache ADD COLUMN solverName TEXT',
      'ALTER TABLE gallery_cache ADD COLUMN solveCount INTEGER',
      'ALTER TABLE gallery_cache ADD COLUMN totalAttempts INTEGER',
    ];
    for (const sql of migrations) {
      try { await db.execAsync(sql); } catch (_) { /* column already exists */ }
    }

    console.log('[GalleryDB] ✓ Database initialized');
  } catch (error) {
    console.error('[GalleryDB] ✗ Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Get cached images from database
 */
export async function getCachedImages(
  sort: string,
  limit: number = 100
): Promise<CachedGalleryImage[]> {
  if (!db) {
    await initGalleryDatabase();
  }

  try {
    const result = await db!.getAllAsync<CachedGalleryImage>(
      'SELECT * FROM gallery_cache WHERE sort = ? ORDER BY cachedAt DESC LIMIT ?',
      [sort, limit]
    );

    console.log(`[GalleryDB] ✓ Loaded ${result.length} cached images for sort="${sort}"`);
    return result;
  } catch (error) {
    console.error('[GalleryDB] ✗ Failed to get cached images:', error);
    return [];
  }
}

/**
 * Cache images to database
 * Uses a mutex lock to prevent concurrent writes
 */
export async function cacheImages(
  images: Omit<CachedGalleryImage, 'cachedAt'>[],
  sort: string
): Promise<void> {
  // Wait for any pending write to complete
  const currentLock = writeLock;

  // Create a new promise for this write operation
  let releaseLock: () => void;
  writeLock = new Promise(resolve => {
    releaseLock = resolve;
  });

  try {
    // Wait for previous write to finish
    await currentLock;

    if (isWriting) {
      console.log('[GalleryDB] ⚠️ Skipping concurrent write attempt');
      return;
    }

    isWriting = true;

    if (!db) {
      await initGalleryDatabase();
    }

    const cachedAt = Date.now();

    const writeAll = async (): Promise<void> => {
      for (const image of images) {
        try {
          await db!.runAsync(
            `INSERT OR REPLACE INTO gallery_cache (
              id, imageUrl, rawUrl, topic, createdAt, challengeAt, durationSec,
              width, height, deviceId, passportName, passportPortrait, frameUrls,
              frameCount, coinCount, coins, rank, uploadedAt, updatedAt,
              upvotes, downvotes, isMysteryPaint, mysteryPaintingId, mysteryTopicId, mysteryTopicText, isSolved,
              solverName, solveCount, totalAttempts, cachedAt, sort
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              image.id,
              image.imageUrl,
              image.rawUrl,
              image.topic,
              image.createdAt,
              image.challengeAt ?? null,
              image.durationSec ?? null,
              image.width ?? null,
              image.height ?? null,
              image.deviceId ?? null,
              image.passportName ?? null,
              image.passportPortrait ?? null,
              image.frameUrls ?? null,
              image.frameCount ?? null,
              image.coinCount ?? null,
              image.coins ?? null,
              image.rank ?? null,
              image.uploadedAt ?? null,
              image.updatedAt ?? null,
              image.upvotes ?? null,
              image.downvotes ?? null,
              image.isMysteryPaint ?? null,
              image.mysteryPaintingId ?? null,
              (image as any).mysteryTopicId ?? null,
              image.mysteryTopicText ?? null,
              image.isSolved ?? null,
              image.solverName ?? null,
              image.solveCount ?? null,
              image.totalAttempts ?? null,
              cachedAt,
              sort
            ]
          );
        } catch (error) {
          console.error(`[GalleryDB] ✗ Failed to cache image ${image.id}:`, error);
        }
      }

      // Remove entries no longer returned by the API (deleted from server)
      const freshIds = images.map(i => Math.floor(Number(i.id))).filter(Number.isFinite);
      if (freshIds.length > 0) {
        const placeholders = freshIds.map(() => '?').join(',');
        await db!.runAsync(
          `DELETE FROM gallery_cache WHERE sort = ? AND id NOT IN (${placeholders})`,
          [sort, ...freshIds]
        );
      }

      // Keep only the latest 100 entries per sort
      await db!.runAsync(
        `DELETE FROM gallery_cache WHERE id IN (
          SELECT id FROM gallery_cache WHERE sort = ?
          ORDER BY cachedAt DESC LIMIT -1 OFFSET 100
        )`,
        [sort]
      );
    };

    const transactionDb = db! as SQLite.SQLiteDatabase & {
      withTransactionAsync?: (task: () => Promise<void>) => Promise<void>;
    };
    if (typeof transactionDb.withTransactionAsync === 'function') {
      await transactionDb.withTransactionAsync(writeAll);
    } else {
      await writeAll();
    }

    console.log(`[GalleryDB] ✓ Cached ${images.length} images for sort="${sort}"`);
  } catch (error) {
    console.error('[GalleryDB] ✗ Failed to cache images:', error);
  } finally {
    isWriting = false;
    releaseLock!();
  }
}

/**
 * Update solved state for a specific entry across all sort buckets.
 * Called immediately after a correct guess so the DB reflects reality.
 */
export async function updateSolvedStateInDB(
  imageId: number,
  isSolved: boolean,
  solveCount: number,
  totalAttempts: number
): Promise<void> {
  if (!db) await initGalleryDatabase();
  try {
    await db!.runAsync(
      `UPDATE gallery_cache SET isSolved = ?, solveCount = ?, totalAttempts = ? WHERE id = ?`,
      [isSolved ? 1 : 0, solveCount, totalAttempts, imageId]
    );
  } catch (error) {
    console.error('[GalleryDB] ✗ Failed to update solved state:', error);
  }
}

/**
 * Get the most recent image ID from cache for a given sort
 */
export async function getLatestCachedImageId(sort: string): Promise<number | null> {
  if (!db) {
    await initGalleryDatabase();
  }

  try {
    const result = await db!.getFirstAsync<{ id: number }>(
      'SELECT id FROM gallery_cache WHERE sort = ? ORDER BY createdAt DESC LIMIT 1',
      [sort]
    );

    return result?.id ?? null;
  } catch (error) {
    console.error('[GalleryDB] ✗ Failed to get latest cached image ID:', error);
    return null;
  }
}

/**
 * Clear all cached images
 */
export async function clearGalleryCache(): Promise<void> {
  if (!db) {
    await initGalleryDatabase();
  }

  try {
    await db!.runAsync('DELETE FROM gallery_cache');
    console.log('[GalleryDB] ✓ Cache cleared');
  } catch (error) {
    console.error('[GalleryDB] ✗ Failed to clear cache:', error);
  }
}

/**
 * Get database statistics
 */
export async function getGalleryCacheStats(): Promise<{
  totalImages: number;
  bySort: Record<string, number>;
  oldestCachedAt: number | null;
  newestCachedAt: number | null;
}> {
  if (!db) {
    await initGalleryDatabase();
  }

  try {
    const total = await db!.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM gallery_cache'
    );

    const bySortResult = await db!.getAllAsync<{ sort: string; count: number }>(
      'SELECT sort, COUNT(*) as count FROM gallery_cache GROUP BY sort'
    );

    const oldest = await db!.getFirstAsync<{ cachedAt: number }>(
      'SELECT MIN(cachedAt) as cachedAt FROM gallery_cache'
    );

    const newest = await db!.getFirstAsync<{ cachedAt: number }>(
      'SELECT MAX(cachedAt) as cachedAt FROM gallery_cache'
    );

    const bySort: Record<string, number> = {};
    bySortResult.forEach(row => {
      bySort[row.sort] = row.count;
    });

    return {
      totalImages: total?.count ?? 0,
      bySort,
      oldestCachedAt: oldest?.cachedAt ?? null,
      newestCachedAt: newest?.cachedAt ?? null
    };
  } catch (error) {
    console.error('[GalleryDB] ✗ Failed to get cache stats:', error);
    return {
      totalImages: 0,
      bySort: {},
      oldestCachedAt: null,
      newestCachedAt: null
    };
  }
}
