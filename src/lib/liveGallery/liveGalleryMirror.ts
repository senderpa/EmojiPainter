import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateDailyDeviceId } from '../dailyDeviceId';
import type { DailyPaintUploadParams, DailyPaintUploadResult } from '../dailyPaintUpload';
import {
  LiveGalleryCategory,
  LiveGalleryEntry,
  LiveGalleryManifest,
} from './liveGalleryTypes';
import {
  dirForCategory,
  ensureLiveGalleryDirs,
  LIVE_GALLERY_DIR,
  readManifest,
  writeManifest,
} from './liveGalleryStore';

const GALLERY_LIST_URL = 'https://emojipainter.com/api/list.php';
const SYNC_FETCH_LIMIT = 500;
const LAST_SYNC_KEY = '@livegallery/last_sync_ms';
const MIN_SYNC_INTERVAL_MS = 30 * 60 * 1000; // auto-sync at most every 30 min

let syncInFlight: Promise<LiveGalleryManifest | null> | null = null;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;
const truthy = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || v === 'true';

function extFromUrl(url: string | null, fallback: string): string {
  if (!url) return fallback;
  const m = /\.(png|jpe?g|gif|webp|mp4|mov)(?:\?|$)/i.exec(url);
  return m ? m[1].toLowerCase() : fallback;
}

function categoryOf(isMystery: boolean): LiveGalleryCategory {
  return isMystery ? 'mystery' : 'topics';
}

function fileNameFor(id: number, ext: string): string {
  const base = id >= 0 ? String(id).padStart(6, '0') : `local_${Math.abs(id)}`;
  return `${base}.${ext}`;
}

/** Map one list.php item to an entry (no file yet — caller downloads it). */
function mapApiItem(item: Record<string, unknown>, myDeviceId: string): LiveGalleryEntry | null {
  const id = num(item.id);
  const remoteImageUrl = str(item.image_url);
  const remoteRawUrl = str(item.raw_url) ?? remoteImageUrl;
  if (id == null || !remoteImageUrl) return null;

  const isMystery = truthy(item.is_mystery_paint);
  const category = categoryOf(isMystery);
  const mediaType: 'image' | 'video' =
    str(item.media_type) === 'video' || /\.(mp4|mov)(\?|$)/i.test(remoteImageUrl)
      ? 'video'
      : 'image';
  const fileFormat = str(item.file_format) ?? extFromUrl(remoteRawUrl, mediaType === 'video' ? 'mp4' : 'png');
  const deviceId = str(item.device_id);

  return {
    id,
    category,
    kind: isMystery ? 'guess' : 'normal',
    file: `${category}/${fileNameFor(id, fileFormat)}`,
    mediaType,
    fileFormat,
    topic: str(item.topic),
    mysteryTopicText: str(item.mystery_topic_text),
    isMysteryPaint: isMystery,
    durationSec: num(item.duration_sec),
    createdAt: num(item.created_at),
    challengeAt: num(item.challenge_at),
    uploadedAt: num(item.uploaded_at),
    updatedAt: num(item.updated_at),
    width: num(item.width),
    height: num(item.height),
    videoDurationMs: num(item.video_duration_ms),
    videoFps: num(item.video_fps),
    videoFrameCount: num(item.video_frame_count),
    upvotes: num(item.upvotes) ?? 0,
    downvotes: num(item.downvotes) ?? 0,
    solveCount: num(item.solve_count) ?? 0,
    mysteryTopicId: num(item.mystery_topic_id),
    mysteryPaintingId: num(item.mystery_painting_id),
    passportName: str(item.passport_name),
    deviceId,
    isOwn: deviceId != null && deviceId === myDeviceId,
    remoteImageUrl,
    remoteRawUrl,
    mirroredAt: 0,
    source: 'server',
  };
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(absPath);
    return info.exists && (info.size ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Sync the whole live gallery into Documents/LiveGallery. Downloads any media
 * not already present and rewrites the manifest. Idempotent and throttled;
 * pass { force:true } to bypass the interval. Never throws.
 */
export async function syncLiveGalleryFromServer(
  opts: { force?: boolean; nowMs: number }
): Promise<LiveGalleryManifest | null> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    try {
      if (!opts.force) {
        const lastRaw = await AsyncStorage.getItem(LAST_SYNC_KEY);
        const last = lastRaw ? Number(lastRaw) : 0;
        if (Number.isFinite(last) && opts.nowMs - last < MIN_SYNC_INTERVAL_MS) {
          return await readManifest(await getOrCreateDailyDeviceId());
        }
      }

      const myDeviceId = await getOrCreateDailyDeviceId();
      await ensureLiveGalleryDirs();

      const res = await fetch(`${GALLERY_LIST_URL}?sort=new&limit=${SYNC_FETCH_LIMIT}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`list.php ${res.status}`);
      const json = JSON.parse(await res.text());
      const items: Record<string, unknown>[] = Array.isArray(json?.items)
        ? json.items
        : Array.isArray(json)
        ? json
        : [];

      const manifest = await readManifest(myDeviceId);
      const byId = new Map<number, LiveGalleryEntry>();
      // Keep locally-mirrored uploads that the server list may not include yet.
      for (const e of manifest.entries) byId.set(e.id, e);

      let downloaded = 0;
      for (const item of items) {
        const entry = mapApiItem(item, myDeviceId);
        if (!entry) continue;
        const existing = byId.get(entry.id);
        const absPath = `${LIVE_GALLERY_DIR}${entry.file}`;
        const haveFile = existing ? await fileExists(`${LIVE_GALLERY_DIR}${existing.file}`) : false;

        if (!haveFile) {
          try {
            await FileSystem.downloadAsync(entry.remoteRawUrl ?? entry.remoteImageUrl!, absPath);
            entry.mirroredAt = opts.nowMs;
            downloaded += 1;
          } catch (err) {
            console.warn(`[LiveGallery] download failed for #${entry.id}:`, err);
            continue; // skip this one; try again next sync
          }
        } else {
          // Preserve the local file + when we first mirrored it; refresh stats/meta.
          entry.file = existing!.file;
          entry.mirroredAt = existing!.mirroredAt || opts.nowMs;
          entry.source = existing!.source;
        }
        byId.set(entry.id, entry);
      }

      const next: LiveGalleryManifest = { ...manifest, deviceId: myDeviceId, entries: [...byId.values()] };
      await writeManifest(next, opts.nowMs);
      await AsyncStorage.setItem(LAST_SYNC_KEY, String(opts.nowMs));
      console.log(`[LiveGallery] sync done — ${next.entries.length} works (${downloaded} new files).`);
      return next;
    } catch (error) {
      console.warn('[LiveGallery] sync failed:', error);
      return null;
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

/**
 * Mirror a work THIS device just uploaded — copies the local file immediately so
 * it appears in LiveGallery before the next server sync. Never throws.
 */
export async function mirrorLocalUpload(
  params: DailyPaintUploadParams,
  result: DailyPaintUploadResult,
  nowMs: number
): Promise<void> {
  try {
    const sourceUri = params.videoUri ?? params.imageUri;
    if (!sourceUri) return;
    const myDeviceId = result.deviceId || (await getOrCreateDailyDeviceId());
    await ensureLiveGalleryDirs();

    const isMystery = !!(result.isMysteryPaint ?? params.isMysteryPaint);
    const category = categoryOf(isMystery);
    const id = typeof result.imageId === 'number' ? result.imageId : -nowMs;
    const isVideo = !!params.videoUri;
    const ext = extFromUrl(sourceUri, isVideo ? 'mov' : 'png');
    const file = `${category}/${fileNameFor(id, ext)}`;
    const absPath = `${LIVE_GALLERY_DIR}${file}`;

    await FileSystem.copyAsync({ from: sourceUri, to: absPath });

    const durationSec =
      result.dailyTime ??
      (params.actualDurationMs != null ? Math.floor(params.actualDurationMs / 1000) : null);

    const entry: LiveGalleryEntry = {
      id,
      category,
      kind: isMystery ? 'guess' : 'normal',
      file,
      mediaType: isVideo ? 'video' : 'image',
      fileFormat: ext,
      topic: params.topic ?? result.topic ?? null,
      mysteryTopicText: params.mysteryTopicText ?? null,
      isMysteryPaint: isMystery,
      durationSec,
      createdAt: result.createdAt ?? Math.floor(nowMs / 1000),
      challengeAt: params.challengeAtMs != null ? Math.floor(params.challengeAtMs / 1000) : null,
      uploadedAt: Math.floor(nowMs / 1000),
      updatedAt: Math.floor(nowMs / 1000),
      width: null,
      height: null,
      videoDurationMs: params.videoDuration != null ? Math.round(params.videoDuration * 1000) : null,
      videoFps: null,
      videoFrameCount: params.frameCount ?? null,
      upvotes: 0,
      downvotes: 0,
      solveCount: 0,
      mysteryTopicId: params.mysteryTopicId ?? null,
      mysteryPaintingId: result.mysteryPaintingId ?? null,
      passportName: params.passportName ?? result.passportName ?? null,
      deviceId: myDeviceId,
      isOwn: true,
      remoteImageUrl: result.imageUrl ?? null,
      remoteRawUrl: result.rawUrl ?? result.imageUrl ?? null,
      mirroredAt: nowMs,
      source: 'local-upload',
    };

    const manifest = await readManifest(myDeviceId);
    const entries = manifest.entries.filter((e) => e.id !== id);
    entries.push(entry);
    await writeManifest({ ...manifest, deviceId: myDeviceId, entries }, nowMs);
    console.log(`[LiveGallery] mirrored own upload #${id} → ${file}`);
  } catch (error) {
    console.warn('[LiveGallery] mirrorLocalUpload failed:', error);
  }
}

export { LIVE_GALLERY_DIR } from './liveGalleryStore';
