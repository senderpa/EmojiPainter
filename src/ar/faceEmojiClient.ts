/**
 * faceEmojiClient — talks to the 3D Factory "face-emoji" backend that turns a
 * selfie into a personalized, stylized, ARKit-rigged 3D head.
 *
 * Contract ({BASE}/api/face-emoji):
 *   POST /jobs                       (multipart: image, style?, quality?, debug?)
 *        → { jobId, status, eventsUrl, statusUrl, assetsUrl }
 *   GET  /jobs/{id}                  → live status (stage, progress, preview, identity)
 *   GET  /jobs/{id}/events           → SSE (RN fetch has no EventSource → we poll)
 *   GET  /jobs/{id}/assets           → { files:[{name,url,...}], usdz_available }
 *   GET  /jobs/{id}/assets/{name}    → the binary asset
 *   POST /jobs/{id}/retry            → re-roll (new random style / bad result)
 *   POST /jobs/{id}/fix-texture-orientation
 *
 * Reaches the server LAN-first (fast, on the home network) then the public WAN
 * proxy — matching the app's existing 3D-API behavior. SSE is not available in
 * React Native's fetch, so progress is polled (~1s), which the contract allows.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { API3D_WAN } from '../config/aiEndpoints';
const FACE_PATH = '/api/face-emoji';
// WAN-ONLY (verified end-to-end). The face pipeline lives on the main server
// behind the /emoji3d proxy; the LAN box (4858) does NOT run it, so a job
// created there sits queued forever → "model never comes back". The /api path
// is OPEN — we send NO cookie (a stale sd_auth cookie bounces the proxy to a
// login wall that fails on iOS). No login, no password, fully automatic.
interface Endpoint {
  base: string;
}
const ENDPOINTS: Endpoint[] = [
  { base: API3D_WAN },
];
const REQUEST_TIMEOUT = 20000;

/** The ordered, canonical build stages (name → headline progress %). */
export interface BuildStage {
  key: string;
  pct: number;
  label: string;
  icon: string;
}

export const BUILD_STAGES: BuildStage[] = [
  { key: 'UPLOAD_RECEIVED', pct: 5, label: 'Photo uploaded', icon: '📤' },
  { key: 'FACE_DETECTED', pct: 20, label: 'Face detected', icon: '🙂' },
  { key: 'FACE_CROPPED', pct: 32, label: 'Face cropped', icon: '✂️' },
  { key: 'BACKGROUND_REMOVED', pct: 45, label: 'Background removed', icon: '🪄' },
  { key: 'STYLIZED_RENDER_CREATED', pct: 56, label: 'Stylized face', icon: '🎨' },
  { key: 'IDENTITY_VALIDATED', pct: 64, label: 'Likeness checked', icon: '🧬' },
  { key: 'MESH_CREATED', pct: 76, label: '3D mesh created', icon: '🧱' },
  { key: 'UV_VALIDATED', pct: 82, label: 'UV checked', icon: '🗺️' },
  { key: 'TEXTURE_APPLIED', pct: 90, label: 'Texture applied', icon: '🖼️' },
  { key: 'PREVIEWS_RENDERED', pct: 94, label: 'Preview rendered', icon: '📸' },
  { key: 'EXPORT_COMPLETE', pct: 100, label: 'Export complete', icon: '✅' },
];

export function stageIndex(key: string): number {
  const k = (key || '').toUpperCase().trim();
  return BUILD_STAGES.findIndex((s) => s.key === k);
}

export function stagePct(key: string): number {
  const i = stageIndex(key);
  return i >= 0 ? BUILD_STAGES[i].pct : 0;
}

export interface CreateJobResult {
  jobId: string;
  status: string;
  statusUrl: string;
  assetsUrl: string;
  eventsUrl: string;
}

export interface FaceMethod {
  id: string;
  label: string;
  available: boolean;
  isDefault: boolean;
}

/** GET /methods → the generation backends to offer (procedural / hunyuan / …) */
export async function fetchMethods(): Promise<FaceMethod[]> {
  for (const ep of await orderedEndpoints()) {
    try {
      const res = await epFetch(ep, `${ep.base}${FACE_PATH}/methods`, {});
      if (!res.ok) throw new Error(`methods ${res.status}`);
      const d = unwrap(await res.json());
      const arr: any[] = Array.isArray(d.methods) ? d.methods : Array.isArray(d) ? d : [];
      activeEndpoint = ep;
      return arr
        .map((m) => ({
          id: String(m.id ?? ''),
          label: String(m.label ?? m.id ?? ''),
          available: m.available !== false,
          isDefault: !!m.default,
        }))
        .filter((m) => m.id);
    } catch {
      /* try next endpoint */
    }
  }
  return []; // graceful: no picker if unreachable
}

export interface FaceJobStatus {
  jobId: string;
  status: string; // queued | running | done | error | failed
  stage: string; // one of BUILD_STAGES keys
  progress: number; // 0..100
  previewUrl?: string | null; // absolute, ready to render
  message?: string;
  style?: string;
  identityScore?: number | null; // 0..1 resemblance
  identityMethod?: string;
  errorCode?: string | null; // NO_FACE | FACE_TOO_SMALL | BLURRY | MULTIPLE_FACES | GENERIC | …
  errorMessage?: string | null;
  raw: any;
}

export interface FaceAssets {
  jobId: string;
  usdzAvailable: boolean;
  usdzUrl?: string | null; // absolute
  glbUrl?: string | null; // absolute
  files: { name: string; url: string }[];
}

let activeEndpoint: Endpoint | null = null;

async function orderedEndpoints(): Promise<Endpoint[]> {
  return activeEndpoint
    ? [activeEndpoint, ...ENDPOINTS.filter((e) => e.base !== activeEndpoint!.base)]
    : [...ENDPOINTS];
}

/** Plain fetch for the open face-emoji endpoint — NO cookie, NO login, ever. */
async function epFetch(_ep: Endpoint, url: string, opts: RequestInit, timeoutMs = REQUEST_TIMEOUT): Promise<Response> {
  return withTimeout(fetch(url, opts), timeoutMs);
}

/** Resolve a possibly-relative URL ("/api/…") from the server against the base. */
function abs(base: string, url: string | undefined | null, fallbackPath?: string): string {
  const u = url ?? fallbackPath ?? '';
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) {
    // The server may hand back a LAN/WAN host we can't reach; keep only the path
    // and re-root it on the base that actually answered us.
    try {
      const parsed = new URL(u);
      return `${base}${parsed.pathname}${parsed.search}`;
    } catch {
      return u;
    }
  }
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
}

async function withTimeout<T>(p: Promise<T>, ms = REQUEST_TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timed out')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function unwrap(json: any): any {
  return json?.data && typeof json.data === 'object' ? json.data : json;
}

// ── 1. Create job ───────────────────────────────────────────────────────────
export async function createJob(
  localImagePath: string,
  opts: { style?: string; quality?: 'draft' | 'normal' | 'high'; method?: string } = {}
): Promise<CreateJobResult> {
  const uri = localImagePath.startsWith('file://') ? localImagePath : `file://${localImagePath}`;
  let lastError: unknown;
  for (const ep of await orderedEndpoints()) {
    try {
      const form = new FormData();
      form.append('image', { uri, name: 'selfie.jpg', type: 'image/jpeg' } as unknown as Blob);
      // Individual fields (NOT a nested JSON blob), per the contract.
      if (opts.style) form.append('style', opts.style);
      if (opts.method) form.append('method', opts.method);
      form.append('quality', opts.quality ?? 'draft');
      form.append('debug', 'true');

      const res = await epFetch(ep, `${ep.base}${FACE_PATH}/jobs`, { method: 'POST', body: form }, 45000);
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const d = unwrap(await res.json());
      const jobId: string | undefined = d.jobId ?? d.job_id ?? d.id;
      if (!jobId) throw new Error('Server did not return a job id');
      activeEndpoint = ep;
      return {
        jobId,
        status: String(d.status ?? 'queued'),
        statusUrl: abs(ep.base, d.statusUrl ?? d.status_url, `${FACE_PATH}/jobs/${jobId}`),
        assetsUrl: abs(ep.base, d.assetsUrl ?? d.assets_url, `${FACE_PATH}/jobs/${jobId}/assets`),
        eventsUrl: abs(ep.base, d.eventsUrl ?? d.events_url, `${FACE_PATH}/jobs/${jobId}/events`),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not reach the face server. ${lastError instanceof Error ? lastError.message : ''}`.trim()
  );
}

// ── 2. Poll status ──────────────────────────────────────────────────────────
/** Map a backend free-text error into a canonical code the UI knows. */
function inferErrorCode(message: string | null | undefined): string | null {
  const m = (message ?? '').toLowerCase();
  if (!m) return null;
  if (/no face|face not|couldn'?t find a face|missing face/.test(m)) return 'NO_FACE';
  if (/too small|small face|move closer/.test(m)) return 'FACE_TOO_SMALL';
  if (/blur/.test(m)) return 'BLURRY';
  if (/multiple|more than one face|two faces/.test(m)) return 'MULTIPLE_FACES';
  if (/generic|not like|low resemblance|identity/.test(m)) return 'GENERIC';
  if (/orient|mirror|flip/.test(m)) return 'TEXTURE_ORIENTATION';
  if (/export|glb|usdz|mesh/.test(m)) return 'EXPORT_FAILED';
  return null;
}

function normalizeProgress(d: any, stage: string): number {
  let p = typeof d.progress === 'number' ? d.progress : NaN;
  if (Number.isNaN(p)) p = stagePct(stage);
  if (p <= 1) p *= 100; // some backends report 0..1
  return Math.max(0, Math.min(100, p));
}

export async function pollStatus(statusUrlOrJobId: string): Promise<FaceJobStatus> {
  let lastError: unknown;
  for (const ep of await orderedEndpoints()) {
    // statusUrl from createJob is already a correct absolute URL on this base —
    // use it AS-IS. Re-rooting it would double the /emoji3d prefix → 404.
    const url = /^https?:\/\//i.test(statusUrlOrJobId)
      ? statusUrlOrJobId
      : `${ep.base}${FACE_PATH}/jobs/${statusUrlOrJobId}`;
    try {
      const res = await epFetch(ep, url, {});
      if (!res.ok) throw new Error(`Status failed (${res.status})`);
      const d = unwrap(await res.json());
      activeEndpoint = ep;
      // The live API reports the stage in `currentStep` (e.g. FACE_DETECTED,
      // EXPORT_COMPLETE, FAILED). Keep older field names as fallbacks.
      const stage = String(d.currentStep ?? d.stage ?? d.current_stage ?? '').toUpperCase();
      const identity = d.identity ?? {};
      const preview = d.current_preview_url ?? d.preview_url ?? d.previewUrl ?? null;
      const errMsg =
        typeof d.error === 'string' ? d.error : (d.error?.message ?? d.reason ?? d.message ?? null);
      // Derive status: FAILED step (or an error string) → error; EXPORT_COMPLETE → complete.
      let status = String(d.status ?? '').toLowerCase();
      if (stage === 'FAILED' || (typeof d.error === 'string' && d.error)) status = 'error';
      else if (stage === 'EXPORT_COMPLETE') status = 'complete';
      else if (!status) status = 'running';
      const errorCode =
        d.error_code ?? d.errorCode ?? (typeof d.error === 'object' ? d.error?.code : null) ?? inferErrorCode(errMsg);
      return {
        jobId: String(d.jobId ?? d.job_id ?? d.id ?? ''),
        status,
        stage,
        progress: normalizeProgress(d, stage),
        previewUrl: preview ? abs(ep.base, preview) : null,
        message: d.message ?? d.detail ?? '',
        style: d.style ?? d.style_name ?? d.styleName,
        identityScore: typeof identity.score === 'number' ? identity.score : (typeof d.identity_score === 'number' ? d.identity_score : null),
        identityMethod: identity.method ?? d.identity_method,
        errorCode: status === 'error' ? errorCode : null,
        errorMessage: status === 'error' ? errMsg : null,
        raw: d,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Lost connection to the face server. ${lastError instanceof Error ? lastError.message : ''}`.trim()
  );
}

// ── 3. Assets ───────────────────────────────────────────────────────────────
export async function fetchAssets(assetsUrlOrJobId: string): Promise<FaceAssets> {
  let lastError: unknown;
  for (const ep of await orderedEndpoints()) {
    // assetsUrl from createJob is already absolute on this base — use as-is.
    const url = /^https?:\/\//i.test(assetsUrlOrJobId)
      ? assetsUrlOrJobId
      : `${ep.base}${FACE_PATH}/jobs/${assetsUrlOrJobId}/assets`;
    try {
      const res = await epFetch(ep, url, {});
      if (!res.ok) throw new Error(`Assets failed (${res.status})`);
      const d = unwrap(await res.json());
      activeEndpoint = ep;

      // Turn a server value (filename "head.glb", "/path/x.png", or full URL)
      // into a fetchable absolute URL rooted on the assets endpoint.
      const toUrl = (v: any): string => {
        const s = String(v ?? '');
        if (!s) return '';
        if (/^https?:\/\//i.test(s) || s.startsWith('/')) return abs(ep.base, s);
        return `${url}/${s}`; // bare filename → {assetsUrl}/{name}
      };

      const files: { name: string; url: string }[] = [];
      const pushFile = (name: string, val: any) => {
        const u = toUrl(val);
        if (u) files.push({ name: String(name), url: u });
      };

      // Assets live under data.assets ({glb, usdz, meshPreviewFront, faceCrop,
      // original, …}) — sometimes as a flat list or directly on data.
      const src = (d.assets && typeof d.assets === 'object') ? d.assets : d;
      if (Array.isArray(d.files)) {
        for (const f of d.files) pushFile(f.name ?? f.filename ?? '', f.url ?? f.path ?? f.name ?? f.filename);
      } else if (Array.isArray(src)) {
        for (const f of src) pushFile(f.name ?? f.filename ?? '', f.url ?? f.path ?? f.name ?? f.filename);
      } else {
        for (const [k, v] of Object.entries(src)) {
          if (typeof v === 'string' && v) pushFile(k, v);
        }
      }

      const byExt = (suffix: string) =>
        files.find((f) => f.url.toLowerCase().split('?')[0].endsWith(suffix))?.url ?? null;
      // Prefer explicit named fields (under data.assets), then extension match.
      const usdzUrl = (src.usdz ? toUrl(src.usdz) : null) ?? byExt('.usdz');
      const glbUrl = (src.glb ? toUrl(src.glb) : null) ?? byExt('.glb');
      return {
        jobId: String(d.jobId ?? d.job_id ?? ''),
        usdzAvailable: (d.usdz_available ?? d.usdzAvailable ?? !!usdzUrl) && !!usdzUrl,
        usdzUrl,
        glbUrl,
        files,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not list the 3D assets. ${lastError instanceof Error ? lastError.message : ''}`.trim()
  );
}

// ── 4. Download a model asset, cached by job id ─────────────────────────────
export async function downloadAsset(
  jobId: string,
  remoteUrl: string,
  ext: 'usdz' | 'glb'
): Promise<string> {
  // documentDirectory (not cache) so saved masks survive across sessions.
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  const dir = `${base}face-emoji/${jobId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}head.${ext}`;
  const existing = await FileSystem.getInfoAsync(dest);
  if (existing.exists && (existing.size ?? 0) > 0) return dest;
  // Open endpoint — no cookie/auth needed.
  const result = await FileSystem.downloadAsync(remoteUrl, dest);
  if (result.status !== 200) throw new Error(`Model download failed (${result.status})`);
  return dest;
}

// ── 5. Actions ──────────────────────────────────────────────────────────────
async function postAction(jobId: string, action: string): Promise<void> {
  let lastError: unknown;
  for (const ep of await orderedEndpoints()) {
    try {
      const res = await epFetch(ep, `${ep.base}${FACE_PATH}/jobs/${jobId}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(`${action} failed (${res.status})`);
      activeEndpoint = ep;
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not ${action.replace('-', ' ')}. ${lastError instanceof Error ? lastError.message : ''}`.trim()
  );
}

export const retryJob = (jobId: string) => postAction(jobId, 'retry');
export const fixTextureOrientation = (jobId: string) => postAction(jobId, 'fix-texture-orientation');

/** ARKit blendShape key → EmojiFaceRig morph-target name (fixed contract). */
export const ARKIT_RIG_MAPPING: Record<string, string> = {
  jawOpen: 'Mouth_Open',
  mouthSmileLeft: 'Mouth_Smile',
  mouthSmileRight: 'Mouth_Smile',
  mouthFrownLeft: 'Mouth_Frown',
  mouthFrownRight: 'Mouth_Frown',
  mouthStretchLeft: 'Mouth_Wide',
  mouthStretchRight: 'Mouth_Wide',
  eyeBlinkLeft: 'Eye_Blink_Left',
  eyeBlinkRight: 'Eye_Blink_Right',
  eyeWideLeft: 'Eye_Wide_Left',
  eyeWideRight: 'Eye_Wide_Right',
  browInnerUp: 'Brow_Up',
  cheekPuff: 'Cheek_Puff',
};
