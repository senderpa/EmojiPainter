import * as FileSystem from 'expo-file-system/legacy';
import {
  LIVE_GALLERY_SCHEMA_VERSION,
  LiveGalleryCategory,
  LiveGalleryEntry,
  LiveGalleryManifest,
} from './liveGalleryTypes';

// Everything lives under Documents/LiveGallery so it is browsable in the Files
// app (and via Finder file-sharing) and portable to the other apps.
export const LIVE_GALLERY_DIR = `${FileSystem.documentDirectory}LiveGallery/`;
export const TOPICS_DIR = `${LIVE_GALLERY_DIR}topics/`;
export const MYSTERY_DIR = `${LIVE_GALLERY_DIR}mystery/`;
export const MANIFEST_PATH = `${LIVE_GALLERY_DIR}manifest.json`;
export const README_PATH = `${LIVE_GALLERY_DIR}README.txt`;

export function dirForCategory(category: LiveGalleryCategory): string {
  return category === 'mystery' ? MYSTERY_DIR : TOPICS_DIR;
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

export async function ensureLiveGalleryDirs(): Promise<void> {
  await ensureDir(LIVE_GALLERY_DIR);
  await ensureDir(TOPICS_DIR);
  await ensureDir(MYSTERY_DIR);
}

function emptyManifest(deviceId: string): LiveGalleryManifest {
  return {
    schemaVersion: LIVE_GALLERY_SCHEMA_VERSION,
    app: 'EmojiPaint',
    purpose:
      'Local mirror of EmojiPaint gallery uploads. Media in topics/ (normal) and mystery/ (guess). ' +
      'Each manifest entry joins the local file to its topic, time used, guess-or-not and stats so ' +
      'downstream tools can build reels/posts. For guess entries, mysteryTopicText is the hidden answer.',
    generatedAt: 0,
    deviceId,
    counts: { total: 0, topics: 0, mystery: 0, images: 0, videos: 0, own: 0 },
    entries: [],
  };
}

export async function readManifest(deviceId: string): Promise<LiveGalleryManifest> {
  try {
    const info = await FileSystem.getInfoAsync(MANIFEST_PATH);
    if (!info.exists) return emptyManifest(deviceId);
    const raw = await FileSystem.readAsStringAsync(MANIFEST_PATH);
    const parsed = JSON.parse(raw) as LiveGalleryManifest;
    if (!parsed || !Array.isArray(parsed.entries)) return emptyManifest(deviceId);
    return parsed;
  } catch (error) {
    console.warn('[LiveGallery] manifest read failed, starting fresh:', error);
    return emptyManifest(deviceId);
  }
}

function computeCounts(entries: LiveGalleryEntry[]): LiveGalleryManifest['counts'] {
  return {
    total: entries.length,
    topics: entries.filter((e) => e.category === 'topics').length,
    mystery: entries.filter((e) => e.category === 'mystery').length,
    images: entries.filter((e) => e.mediaType === 'image').length,
    videos: entries.filter((e) => e.mediaType === 'video').length,
    own: entries.filter((e) => e.isOwn).length,
  };
}

export async function writeManifest(
  manifest: LiveGalleryManifest,
  generatedAtMs: number
): Promise<void> {
  const sorted = [...manifest.entries].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
  );
  const next: LiveGalleryManifest = {
    ...manifest,
    entries: sorted,
    counts: computeCounts(sorted),
    generatedAt: generatedAtMs,
    schemaVersion: LIVE_GALLERY_SCHEMA_VERSION,
  };
  await ensureLiveGalleryDirs();
  await FileSystem.writeAsStringAsync(MANIFEST_PATH, JSON.stringify(next, null, 2));
  await writeReadme(next);
}

const README_BODY = [
  'EmojiPaint — LiveGallery',
  '========================',
  '',
  'A local, Files-app-visible mirror of gallery uploads for building reels & social posts.',
  '',
  'Structure:',
  '  topics/     normal daily-topic paints (image or video)',
  '  mystery/    guess paints (topic hidden publicly; the answer is manifest.mysteryTopicText)',
  '  manifest.json  one entry per work — see fields below',
  '',
  'Each manifest entry (see schemaVersion):',
  '  id, category, kind(normal|guess), file (relative path), mediaType, fileFormat,',
  '  topic, mysteryTopicText (hidden answer for guess), isMysteryPaint,',
  '  durationSec (TIME USED), createdAt, challengeAt, uploadedAt, updatedAt,',
  '  width, height, videoDurationMs, videoFps, videoFrameCount,',
  '  upvotes, downvotes, solveCount, passportName, deviceId, isOwn,',
  '  remoteImageUrl, remoteRawUrl, mirroredAt, source(server|local-upload).',
  '',
  'Consumers: read manifest.json, join each entry.file to the media, group by',
  'category/topic, and use durationSec + stats to compose reels/posts.',
  '',
].join('\n');

export async function writeReadme(manifest: LiveGalleryManifest): Promise<void> {
  const stamp =
    `\nLast sync (ms): ${manifest.generatedAt}\n` +
    `Works: ${manifest.counts.total} ` +
    `(topics ${manifest.counts.topics}, mystery ${manifest.counts.mystery}, ` +
    `images ${manifest.counts.images}, videos ${manifest.counts.videos}, mine ${manifest.counts.own})\n`;
  try {
    await FileSystem.writeAsStringAsync(README_PATH, README_BODY + stamp);
  } catch {
    // README is a nicety — never fail the mirror over it.
  }
}
