// LiveGallery — a local mirror (in Documents) of the live gallery uploads, with
// a rich manifest so downstream apps (Render Mixy, Social Studio) can turn the
// works + topics + timing into reels/posts without touching the server.

export type LiveGalleryCategory = 'topics' | 'mystery';

/** One mirrored work: the local file plus every piece of metadata we know. */
export interface LiveGalleryEntry {
  /** Server post id (stable key). Locally-mirrored-before-sync uploads may be negative/temporary. */
  id: number;
  /** Folder bucket: normal daily topics vs mystery/guess paints. */
  category: LiveGalleryCategory;
  /** Convenience flag mirroring `category`: 'normal' | 'guess'. */
  kind: 'normal' | 'guess';
  /** Path of the media file RELATIVE to the LiveGallery root, e.g. "topics/000075.png". */
  file: string;
  mediaType: 'image' | 'video';
  fileFormat: string; // png | jpg | mp4 | mov | webp | gif

  /** The daily challenge topic shown publicly. For guess posts this is the shown (masked) topic. */
  topic: string | null;
  /** The hidden answer for a guess post (kept locally so tooling can label reels). null for normal. */
  mysteryTopicText: string | null;
  isMysteryPaint: boolean;

  /** TIME USED — real drawing seconds (`duration_sec`). */
  durationSec: number | null;
  createdAt: number | null;   // unix seconds
  challengeAt: number | null; // unix seconds
  uploadedAt: number | null;  // unix seconds
  updatedAt: number | null;   // unix seconds

  width: number | null;
  height: number | null;
  videoDurationMs: number | null;
  videoFps: number | null;
  videoFrameCount: number | null;

  upvotes: number;
  downvotes: number;
  solveCount: number;
  mysteryTopicId: number | null;
  mysteryPaintingId: number | null;
  passportName: string | null;

  /** Owning device (server `device_id`). */
  deviceId: string | null;
  /** True when this work was uploaded from THIS device. */
  isOwn: boolean;

  remoteImageUrl: string | null;
  remoteRawUrl: string | null;

  /** When this file was written into the mirror (ms since epoch). */
  mirroredAt: number;
  /** How it entered the mirror. */
  source: 'server' | 'local-upload';
}

export interface LiveGalleryCounts {
  total: number;
  topics: number;
  mystery: number;
  images: number;
  videos: number;
  own: number;
}

export interface LiveGalleryManifest {
  schemaVersion: number;
  app: 'EmojiPaint';
  purpose: string;
  /** ms since epoch of the last write. */
  generatedAt: number;
  /** This device's id (so consumers can tell which entries are "mine"). */
  deviceId: string;
  counts: LiveGalleryCounts;
  entries: LiveGalleryEntry[];
}

export const LIVE_GALLERY_SCHEMA_VERSION = 1;
