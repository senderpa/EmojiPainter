import { sha256 } from 'js-sha256';
import { getOrCreateDailyDeviceId, ensureDeviceId as ensureDailyDeviceId } from './dailyDeviceId';
import { DAILY_PAINT_SECRET } from './dailyPaintSecrets';
import { hasAcceptedProfileTerms, PROFILE_TERMS_VERSION } from './profileTermsConsent';
import { validateCustomMysteryTopic } from '../gesser/utils/masking';

const UPLOAD_URL = 'https://emojipainter.com/api/storage-sql.php';

const UPLOAD_TIMEOUT_MS = 30_000;
const UPLOAD_MAX_RETRIES = 2;
const UPLOAD_RETRY_DELAY_MS = 3_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(id);
    return r;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

interface UploadResponse {
  success?: boolean;
  image_url?: string;
  raw_url?: string;
  image_id?: number | string;
  topic?: string;
  created_at?: number | string;
  device_id?: string;
  passport_name?: string | null;
  passport_portrait?: string | null;
  error?: string;
  [key: string]: unknown;
}

export interface DailyPaintUploadParams {
  imageUri: string;
  topic: string;
  startedAtMs: number;
  endedAtMs: number;
  challengeAtMs?: number;
  deviceId?: string;
  actualDurationMs?: number; // Actual drawing time in milliseconds
  frameUris?: string[]; // Optional: array of frame image URIs for animation
  frameCount?: number; // Total number of frames
  videoUri?: string; // Optional: MOV/MP4 video URI (for Framer challenge exports)
  videoDuration?: number; // Optional: video duration in seconds
  passportName?: string; // Optional: user's passport name
  passportPortrait?: string; // Optional: user's passport portrait data URL
  isMysteryPaint?: boolean; // Optional: mark this as a mystery paint (Gesser feature)
  mysteryTopicId?: number; // Optional: the topic ID for mystery paint
  mysteryTopicText?: string; // Optional: the topic text for mystery paint (avoids server DB lookup)
  topicI18n?: string; // Optional: JSON-encoded translations map for the topic
}

export interface DailyPaintUploadResult {
  imageId?: number;
  imageUrl?: string;
  rawUrl?: string;
  topic?: string;
  createdAt?: number;
  deviceId: string;
  passportName?: string;
  passportPortrait?: string;
  dailyTime?: number; // Actual drawing time in seconds (from daily_time field)
  isMysteryPaint?: boolean; // True if this is a mystery paint (Gesser feature)
  mysteryPaintingId?: number; // Mystery painting ID if applicable
  isSolved?: boolean; // True if mystery has been solved
  solverName?: string; // Name of user who solved the mystery
  totalAttempts?: number; // Total guess attempts for this mystery
  raw: UploadResponse;
}

const createToken = (deviceId: string, startedSec: number, endedSec: number, durationSec: number): string => {
  const payload = `${deviceId}|${startedSec}|${endedSec}|${durationSec}`;
  return sha256.hmac(DAILY_PAINT_SECRET, payload);
};

export async function uploadDailyPaintSprint(params: DailyPaintUploadParams): Promise<DailyPaintUploadResult> {
  if (!(await hasAcceptedProfileTerms())) {
    throw new Error('Please review and accept the current public gallery content licence before uploading.');
  }
  const deviceIdCandidate = typeof params.deviceId === 'string' ? params.deviceId.trim() : '';
  const deviceId = deviceIdCandidate.length > 0 ? deviceIdCandidate : await getOrCreateDailyDeviceId();
  let mysteryTopicText = params.mysteryTopicText;
  if (params.isMysteryPaint && params.mysteryTopicId === 0) {
    const customTopic = validateCustomMysteryTopic(mysteryTopicText ?? '');
    if (!customTopic.valid) {
      throw new Error(customTopic.error ?? 'Invalid custom mystery topic.');
    }
    mysteryTopicText = customTopic.normalized;
  }
// compute session timing
const startedSec = Math.floor(params.startedAtMs / 1000);
// Always use 30 minutes for token/security (unchanged)
const durationSec = 1800;
// end time is the real one
const endedSec = Math.floor(params.endedAtMs / 1000);
// challenge timestamp stays tied to the real end
const challengeSec = endedSec;
// token uses the fixed 30min duration for security validation
const token = createToken(deviceId, startedSec, endedSec, durationSec);

// Calculate actual daily drawing time (NEW FIELD)
const actualDurationMs = params.actualDurationMs ?? (params.endedAtMs - params.startedAtMs);
const dailyTimeSec = Math.floor(actualDurationMs / 1000);

  const formData = new FormData();

  // If videoUri is provided, upload video instead of image
  if (params.videoUri) {
    // Extract file extension from video URI
    const videoExt = params.videoUri.toLowerCase().endsWith('.mp4') ? 'mp4' : 'mov';
    const videoType = videoExt === 'mp4' ? 'video/mp4' : 'video/quicktime';

    formData.append('image', {
      uri: params.videoUri,
      name: `challenge-video.${videoExt}`,
      type: videoType
    } as any);
  } else {
    formData.append('image', {
      uri: params.imageUri,
      name: 'daily-paint.png',
      type: 'image/png'
    } as any);
  }

  formData.append('device_id', deviceId);
  formData.append('started_at', String(startedSec));
  formData.append('ended_at', String(endedSec));
  formData.append('duration_sec', String(durationSec)); // Keep 1800 for token validation
  formData.append('daily_time', String(dailyTimeSec)); // NEW: Actual drawing time
  formData.append('token', token);
  formData.append('topic', params.topic);
  formData.append('content_license_version', PROFILE_TERMS_VERSION);
  formData.append('challenge_at', String(challengeSec));

  // Gesser mystery paint support
  if (params.isMysteryPaint) {
    formData.append('is_mystery_paint', '1');
    if (params.mysteryTopicId) {
      formData.append('mystery_topic_id', String(params.mysteryTopicId));
    }
    // topic_id=0 is the established server contract for a text-backed Mystery
    // answer. Mark manual entries explicitly so the upload boundary can apply
    // the stricter 20-character English-only validation without affecting
    // legacy/default-pool records.
    if (params.mysteryTopicId === 0) {
      formData.append('mystery_topic_source', 'custom');
    }
    // Also send topic text so server can create mystery record without DB lookup
    if (mysteryTopicText) {
      formData.append('mystery_topic_text', mysteryTopicText);
    }
  }

  if (params.topicI18n) {
    formData.append('topic_i18n', params.topicI18n);
  }

  // Add frame data if provided (for animated entries)
  if (params.frameUris && params.frameUris.length > 0) {
    formData.append('frame_count', String(params.frameUris.length));
    params.frameUris.forEach((frameUri, index) => {
      formData.append(`frame_${index}`, {
        uri: frameUri,
        name: `frame-${index}.png`,
        type: 'image/png'
      } as any);
    });
  }

  const trimmedPassportName = params.passportName?.trim() ?? '';
  const passportPortrait = params.passportPortrait?.trim() ?? '';

  if (trimmedPassportName.length > 0) {
    formData.append('passport_name', trimmedPassportName);
  }
  if (passportPortrait.length > 0) {
    // Only send URL/path, never raw base64 (too large for multipart)
    if (!passportPortrait.startsWith('data:')) {
      formData.append('passport_portrait', passportPortrait);
    }
  }

  let response: Response | undefined;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, UPLOAD_RETRY_DELAY_MS * attempt));
    }
    try {
      response = await fetchWithTimeout(UPLOAD_URL, { method: 'POST', body: formData });
      if (response.ok) break;
      // Server-side errors (4xx except 429) are not retryable
      if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === UPLOAD_MAX_RETRIES) throw lastError;
    }
  }

  if (!response) throw lastError ?? new Error('Upload failed after retries');

  const text = await response.text();

  let parsed: UploadResponse;
  try {
    parsed = text ? (JSON.parse(text) as UploadResponse) : {};
  } catch {
    throw new Error(`Upload failed (${response.status}): unexpected response - ${text.substring(0, 100)}`);
  }

  if (!response.ok || parsed.success === false) {
    const errorMessage = typeof parsed.error === 'string' && parsed.error.length > 0
      ? parsed.error
      : `Upload failed (${response.status})`;
    throw new Error(errorMessage);
  }

  if (parsed.image_url) {
    try {
      const headResponse = await fetchWithTimeout(parsed.image_url, { method: 'HEAD' });
      if (!headResponse.ok) {
        throw new Error('Image unreachable after upload');
      }
    } catch (error) {
      throw new Error('Upload succeeded but image is unavailable');
    }
  }

  const numericId = typeof parsed.image_id === 'number'
    ? parsed.image_id
    : typeof parsed.image_id === 'string' && parsed.image_id.trim().length > 0
      ? Number(parsed.image_id)
      : undefined;
  const createdAt = typeof parsed.created_at === 'number'
    ? parsed.created_at
    : typeof parsed.created_at === 'string' && parsed.created_at.trim().length > 0
      ? Number(parsed.created_at)
      : undefined;
  const responseDeviceId = typeof parsed.device_id === 'string' && parsed.device_id.trim().length > 0
    ? parsed.device_id.trim()
    : deviceId;
  const responsePassportName =
    typeof parsed.passport_name === 'string' && parsed.passport_name.trim().length > 0
      ? parsed.passport_name.trim()
      : trimmedPassportName.length > 0
        ? trimmedPassportName
        : undefined;
  const responsePassportPortrait =
    typeof parsed.passport_portrait === 'string' && parsed.passport_portrait.trim().length > 0
      ? parsed.passport_portrait.trim()
      : passportPortrait.length > 0
        ? passportPortrait
        : undefined;

  // Extract mystery paint properties from server response
  const isMysteryPaint = parsed.is_mystery_paint === true || parsed.is_mystery_paint === 1 || parsed.is_mystery_paint === '1';
  const mysteryPaintingId = typeof parsed.mystery_painting_id === 'number'
    ? parsed.mystery_painting_id
    : typeof parsed.mystery_painting_id === 'string'
      ? Number(parsed.mystery_painting_id)
      : undefined;
  const isSolved = parsed.is_solved === true || parsed.is_solved === 1 || parsed.is_solved === '1';
  const solverName = typeof parsed.solver_name === 'string' && parsed.solver_name.trim().length > 0
    ? parsed.solver_name.trim()
    : undefined;
  const totalAttempts = typeof parsed.total_attempts === 'number'
    ? parsed.total_attempts
    : typeof parsed.total_attempts === 'string'
      ? Number(parsed.total_attempts)
      : undefined;

  const result = {
    imageId: Number.isFinite(numericId) ? Number(numericId) : undefined,
    imageUrl: parsed.image_url,
    rawUrl: typeof parsed.raw_url === 'string' && parsed.raw_url.length > 0 ? parsed.raw_url : undefined,
    topic: typeof parsed.topic === 'string' && parsed.topic.length > 0 ? parsed.topic : params.topic,
    createdAt: Number.isFinite(createdAt) ? Number(createdAt) : undefined,
    deviceId: responseDeviceId,
    passportName: responsePassportName,
    passportPortrait: responsePassportPortrait,
    dailyTime: dailyTimeSec, // Include actual drawing time
    isMysteryPaint: isMysteryPaint || undefined, // Only include if true
    mysteryPaintingId: Number.isFinite(mysteryPaintingId) ? mysteryPaintingId : undefined,
    isSolved: isSolved || undefined, // Only include if true
    solverName,
    totalAttempts: Number.isFinite(totalAttempts) ? totalAttempts : undefined,
    raw: parsed
  };

  // Mirror this upload into Documents/LiveGallery (fire-and-forget; never blocks
  // or fails the upload). Lazy require avoids any import cycle.
  try {
    const now = Date.now();
    const { mirrorLocalUpload } = require('./liveGallery/liveGalleryMirror');
    void mirrorLocalUpload(params, result, now);
  } catch (mirrorErr) {
    console.warn('[LiveGallery] upload mirror hook failed:', mirrorErr);
  }

  return result;
}

export const DAILY_PAINT_UPLOAD_URL = UPLOAD_URL;
export const ensureDeviceId = ensureDailyDeviceId;
