import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  SD_A1111_LAN, SD_STREAM, SD_STREAM_LAN, CONTROLNET_MODELS,
  SD_STREAM_PW_KEY, SD_STREAM_COOKIE_KEY, SD_STREAM_DEFAULT_PW,
  API3D_LAN, API3D_WAN,
  type ControlNetModule, type SlowCinemaPreset,
} from '../config/aiEndpoints';
import type { AILibraryItem, AIItemType } from '../types/coinShop';

const LIBRARY_KEY = 'emojipaint/ai-library';
const API3D_COOKIE_KEY = 'ai/3d_api_cookie';
const API3D_WAN_BASE = 'https://some-sender.gotdns.ch:4848';

async function getSecret(key: string): Promise<string | null> {
  try {
    const secureValue = await SecureStore.getItemAsync(key);
    if (secureValue) return secureValue;
  } catch (error) {
    console.warn('[AI/SecureStore] read failed:', key, error);
  }
  try {
    const legacyValue = await AsyncStorage.getItem(key);
    if (legacyValue) {
      await setSecret(key, legacyValue);
      await AsyncStorage.removeItem(key).catch(() => {});
      return legacyValue;
    }
  } catch {}
  return null;
}

async function setSecret(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    await AsyncStorage.removeItem(key).catch(() => {});
  } catch (error) {
    console.warn('[AI/SecureStore] write failed, falling back to AsyncStorage:', key, error);
    await AsyncStorage.setItem(key, value);
  }
}

async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key).catch(() => {});
  await AsyncStorage.removeItem(key).catch(() => {});
}

// AbortSignal.timeout is not available in Hermes (RN) — use AbortController instead
function abortAfter(ms: number): AbortSignal {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  ctrl.signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  return ctrl.signal;
}

// Module-level LAN reachability flag — set false after network failure, reset on success.
// Lets download3DModel skip the 60s LAN timeout when LAN is already known down from polling.
let _lanReachable = true;

// ─── Per-session image prompt cache (CLIP interrogation) ──────────────────────
// Key: first 512 chars of base64 (enough to uniquely identify same painting).
// Cleared on app boot (module reload); never persisted.
const _sessionPromptCache = new Map<string, string>();

export function clearSessionPromptCache(): void {
  _sessionPromptCache.clear();
}

function _promptCacheKey(b64: string): string {
  return b64.slice(0, 512);
}

// ─── Persistent CLIP prompt cache (survives app restarts, keyed by image URI) ─
const CLIP_PERSIST_KEY = 'emojipaint/clip-cache-v1';

export async function getCachedClipPrompt(uri: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CLIP_PERSIST_KEY);
    if (!raw) return null;
    const cache: Record<string, string> = JSON.parse(raw);
    return cache[uri] ?? null;
  } catch { return null; }
}

export async function setCachedClipPrompt(uri: string, prompt: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CLIP_PERSIST_KEY);
    const cache: Record<string, string> = raw ? JSON.parse(raw) : {};
    cache[uri] = prompt;
    const keys = Object.keys(cache);
    if (keys.length > 60) delete cache[keys[0]];
    await AsyncStorage.setItem(CLIP_PERSIST_KEY, JSON.stringify(cache));
  } catch {}
}

// ─── Library persistence ──────────────────────────────────────────────────────

export async function loadLibrary(): Promise<AILibraryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_KEY);
    return raw ? (JSON.parse(raw) as AILibraryItem[]) : [];
  } catch { return []; }
}

export async function saveLibrary(items: AILibraryItem[]): Promise<void> {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
}

export async function addLibraryItem(item: AILibraryItem): Promise<void> {
  const current = await loadLibrary();
  await saveLibrary([item, ...current]);
}

export async function updateLibraryItem(id: string, patch: Partial<AILibraryItem>): Promise<void> {
  const current = await loadLibrary();
  await saveLibrary(current.map(it => (it.id === id ? { ...it, ...patch } : it)));
}

export async function deleteLibraryItem(id: string): Promise<void> {
  await saveLibrary((await loadLibrary()).filter(it => it.id !== id));
}

// ─── SD-Stream password config ────────────────────────────────────────────────

export async function getSdStreamPassword(): Promise<string> {
  const stored = await getSecret(SD_STREAM_PW_KEY);
  return stored || SD_STREAM_DEFAULT_PW;
}

export async function setSdStreamPassword(pw: string): Promise<void> {
  await setSecret(SD_STREAM_PW_KEY, pw);
  await deleteSecret(SD_STREAM_COOKIE_KEY); // force re-login
}

// ─── SD-Stream auth ───────────────────────────────────────────────────────────

async function loginSdStream(): Promise<string> {
  const pw = await getSdStreamPassword();
  console.log('[AI] loginSdStream — password set:', !!pw, 'endpoint:', SD_STREAM);
  if (!pw) throw new Error('SD-Stream password not set. Tap ⚙️ in the Coin Workshop to configure it.');
  const res = await fetch(`${SD_STREAM}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `password=${encodeURIComponent(pw)}`,
    redirect: 'manual',
  });
  console.log('[AI] loginSdStream — response status:', res.status, 'headers:', JSON.stringify(Object.fromEntries(res.headers.entries())));
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/sd_auth=([^;]+)/);
  if (!match) {
    console.error('[AI] loginSdStream — no sd_auth cookie in response. Status:', res.status);
    throw new Error(`SD-Stream login failed (HTTP ${res.status}) — check your password in ⚙️ settings.`);
  }
  const cookie = `sd_auth=${match[1]}`;
  await setSecret(SD_STREAM_COOKIE_KEY, cookie);
  console.log('[AI] loginSdStream — success, cookie stored');
  return cookie;
}

async function sdStreamCookie(): Promise<string> {
  const stored = await getSecret(SD_STREAM_COOKIE_KEY);
  if (stored) return stored;
  return loginSdStream();
}

async function sdStreamFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const cookie = await sdStreamCookie();
  const res = await fetch(`${SD_STREAM}${path}`, {
    ...opts,
    headers: { ...(opts.headers ?? {}), Cookie: cookie },
  });
  if (res.status === 401 || res.status === 403) {
    await deleteSecret(SD_STREAM_COOKIE_KEY);
    const freshCookie = await loginSdStream();
    return fetch(`${SD_STREAM}${path}`, {
      ...opts,
      headers: { ...(opts.headers ?? {}), Cookie: freshCookie },
    });
  }
  return res;
}

// ─── Base64 helpers ───────────────────────────────────────────────────────────

export async function uriToBase64(uri: string): Promise<string> {
  try {
    // ImageManipulator handles ph:// URIs, HEIC, and large files reliably
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1024 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    if (result.base64) return result.base64;
  } catch { /* fall through */ }
  // Fallback: direct FileSystem read
  const raw = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
  return raw.replace(/^data:[^;]+;base64,/, '');
}

// Like uriToBase64 but also returns final pixel dimensions (after 1024-side resize)
export async function uriToBase64WithInfo(uri: string): Promise<{ b64: string; w: number; h: number }> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1024 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    if (result.base64) return { b64: result.base64, w: result.width, h: result.height };
  } catch {}
  const raw = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
  return { b64: raw.replace(/^data:[^;]+;base64,/, ''), w: 512, h: 512 };
}

async function scaleB64ToMax(b64: string, maxSide: number): Promise<string> {
  const tmpPath = `${FileSystem.cacheDirectory}scale_in_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(tmpPath, b64, { encoding: 'base64' as any });
  try {
    const info = await ImageManipulator.manipulateAsync(tmpPath, [], { base64: false });
    const { width, height } = info;
    const longer = Math.max(width, height);
    if (longer <= maxSide) {
      const result = await ImageManipulator.manipulateAsync(tmpPath, [], {
        compress: 0.88, format: ImageManipulator.SaveFormat.JPEG, base64: true,
      });
      return result.base64 ?? b64;
    }
    const scale = maxSide / longer;
    const result = await ImageManipulator.manipulateAsync(
      tmpPath,
      [{ resize: { width: Math.round(width * scale), height: Math.round(height * scale) } }],
      { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return result.base64 ?? b64;
  } catch { return b64; }
  finally { void FileSystem.deleteAsync(tmpPath, { idempotent: true }); }
}

async function saveResult(b64: string, type: AIItemType, id: string): Promise<string> {
  const isMesh = type.startsWith('mesh3d');
  const ext = type.startsWith('video') ? 'mp4' : isMesh ? 'usdz' : 'png';
  const path = `${FileSystem.documentDirectory}ai_${id}.${ext}`;
  await FileSystem.writeAsStringAsync(path, b64, { encoding: 'base64' as any });
  return path;
}

// ─── Server health checks ─────────────────────────────────────────────────────

export async function checkA1111(): Promise<boolean> {
  try {
    const res = await fetch(`${SD_A1111_LAN}/sdapi/v1/progress`, { signal: abortAfter(4000) });
    return res.ok;
  } catch { return false; }
}

export async function pollA1111Progress(): Promise<{
  progress: number;
  step: number;
  totalSteps: number;
  currentImage: string | null;
}> {
  try {
    const res = await fetch(`${SD_A1111_LAN}/sdapi/v1/progress?skip_current_image=false`, {
      signal: abortAfter(4000),
    });
    if (!res.ok) return { progress: 0, step: 0, totalSteps: 0, currentImage: null };
    const data = await res.json();
    return {
      progress: (data.progress as number) ?? 0,
      step: (data.state?.sampling_step as number) ?? 0,
      totalSteps: (data.state?.sampling_steps as number) ?? 0,
      currentImage: (data.current_image as string | null) ?? null,
    };
  } catch {
    return { progress: 0, step: 0, totalSteps: 0, currentImage: null };
  }
}

export async function checkSdStream(): Promise<boolean> {
  try {
    // Try LAN first (fast, direct), fall back to WAN
    const lan = await fetch(`${SD_STREAM_LAN}/health`, { signal: abortAfter(3000) }).catch(() => null);
    if (lan?.ok) return true;
    const wan = await fetch(`${SD_STREAM}/health`, { signal: abortAfter(4000) }).catch(() => null);
    return wan?.ok ?? false;
  } catch { return false; }
}

export async function check4MA(): Promise<boolean> {
  try {
    const res = await fetch(`https://some-sender.gotdns.ch:4849/api/status`, { signal: abortAfter(4000) });
    return res.ok;
  } catch { return false; }
}

// ─── ControlNet model discovery ───────────────────────────────────────────────

let _controlnetModelList: string[] | null = null;

async function resolveControlNetModel(baseModelName: string): Promise<string> {
  if (!_controlnetModelList) {
    try {
      const res = await fetch(`${SD_A1111_LAN}/controlnet/model_list`, { signal: abortAfter(5000) });
      if (res.ok) {
        const data = await res.json();
        _controlnetModelList = Array.isArray(data.model_list) ? data.model_list : [];
        console.log('[AI/CN] available models:', _controlnetModelList);
      }
    } catch (e) { console.warn('[AI/CN] model_list fetch failed:', String(e)); }
    if (!_controlnetModelList) _controlnetModelList = [];
  }
  if (_controlnetModelList.length === 0) {
    console.warn('[AI/CN] No ControlNet models found — using base name:', baseModelName);
    return baseModelName;
  }
  // Exact match
  const exact = _controlnetModelList.find(m => m === baseModelName);
  if (exact) return exact;
  // Prefix match (handles " [hash]" suffix A1111 appends)
  const prefix = _controlnetModelList.find(m => m.startsWith(baseModelName));
  if (prefix) { console.log('[AI/CN] prefix match:', prefix); return prefix; }
  // Substring match (partial name)
  const lower = baseModelName.toLowerCase();
  const sub = _controlnetModelList.find(m => m.toLowerCase().includes(lower));
  if (sub) { console.log('[AI/CN] substring match:', sub); return sub; }
  // Fall back to first available model — better than a bare unresolvable name
  const fallback = _controlnetModelList[0];
  console.warn('[AI/CN] no match for', baseModelName, '— falling back to first model:', fallback);
  return fallback;
}

// ─── A1111 helpers ────────────────────────────────────────────────────────────

function computeAISize(w: number, h: number): { width: number; height: number } {
  const maxSide = 1024;
  const ratio = w / h;
  let tw: number, th: number;
  if (ratio >= 1) { tw = maxSide; th = Math.round(maxSide / ratio); }
  else             { th = maxSide; tw = Math.round(maxSide * ratio); }
  // Round to nearest 64 (A1111 requirement), minimum 64
  return {
    width:  Math.max(64, Math.round(tw / 64) * 64),
    height: Math.max(64, Math.round(th / 64) * 64),
  };
}

async function a1111Post(path: string, body: object): Promise<any> {
  const url = `${SD_A1111_LAN}${path}`;
  console.log('[AI/A1111] POST', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log('[AI/A1111] Response:', res.status, res.headers.get('content-type')?.slice(0, 40));
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[AI/A1111] Error body:', errBody.slice(0, 300));
    throw new Error(`A1111 ${path} → HTTP ${res.status}${errBody ? ': ' + errBody.slice(0, 120) : ''}`);
  }
  return res.json();
}

// ─── Image generation ─────────────────────────────────────────────────────────

export async function generateStandardImage(
  b64: string,
  prompt = 'artistic emoji painting, vivid colors, masterpiece',
  sourceDims?: { w: number; h: number },
  denoise = 0.45,
  cfgScale = 7.5,
): Promise<string> {
  const scaled = await scaleB64ToMax(b64, 1024);
  const { width, height } = sourceDims ? computeAISize(sourceDims.w, sourceDims.h) : { width: 512, height: 512 };
  const data = await a1111Post('/sdapi/v1/img2img', {
    init_images: [scaled],
    prompt,
    negative_prompt: 'blurry, low quality, watermark, distorted, ugly',
    denoising_strength: denoise,
    steps: 28,
    cfg_scale: cfgScale,
    width,
    height,
    sampler_name: 'DPM++ 2M Karras',
  });
  const img = data.images?.[0];
  if (!img) throw new Error('No image returned from A1111');
  const id = `img_${Date.now()}`;
  return saveResult(img, 'image_standard', id);
}

export async function generateControlNetImage(
  b64: string,
  module: ControlNetModule,
  prompt = 'artistic emoji painting, vivid colors, masterpiece',
  sourceDims?: { w: number; h: number },
  denoise = 0.55,
  cfgScale = 7.5,
  cnWeight = 0.25,
): Promise<string> {
  const scaled = await scaleB64ToMax(b64, 1024);
  const baseModel = CONTROLNET_MODELS[module] ?? CONTROLNET_MODELS.lineart;
  const model = await resolveControlNetModel(baseModel);
  // A1111 preprocessor name can differ from our module key (tile → tile_resample)
  const preprocessor: string = module === 'tile' ? 'tile_resample' : module;
  console.log('[AI/CN] model:', model, 'preprocessor:', preprocessor);
  const { width, height } = sourceDims ? computeAISize(sourceDims.w, sourceDims.h) : { width: 512, height: 512 };
  const data = await a1111Post('/sdapi/v1/img2img', {
    init_images: [scaled],
    prompt,
    negative_prompt: 'blurry, low quality, watermark, distorted, ugly',
    denoising_strength: denoise,
    steps: 28,
    cfg_scale: cfgScale,
    width,
    height,
    sampler_name: 'DPM++ 2M Karras',
    alwayson_scripts: {
      controlnet: {
        args: [{
          module: preprocessor,
          model,
          weight: cnWeight,
          guidance_start: 0.0,
          guidance_end: 1.0,
          control_mode: 'Balanced',
          resize_mode: 'Crop and Resize',
          input_image: scaled,
          enabled: true,
          pixel_perfect: true,
        }],
      },
    },
  });
  // images[0] is the generated image; images[1] if present is the preprocessor debug output
  const img = data.images?.[0];
  if (!img) throw new Error('No image returned from A1111 ControlNet');
  const id = `cnet_${Date.now()}`;
  return saveResult(img, 'image_controlnet', id);
}

export async function generateTxt2Img(prompt: string): Promise<string> {
  const data = await a1111Post('/sdapi/v1/txt2img', {
    prompt,
    negative_prompt: 'blurry, low quality, watermark, ugly',
    steps: 30,
    cfg_scale: 7.5,
    width: 512,
    height: 512,
    sampler_name: 'DPM++ 2M Karras',
  });
  const img = data.images?.[0];
  if (!img) throw new Error('No image returned from txt2img');
  const id = `t2i_${Date.now()}`;
  return saveResult(img, 'image_txt2img', id);
}

// ─── Shared: run slow cinema and collect result (blocking, for inline use) ─────

async function runSlowCinemaInline(
  b64: string,
  targetFrames: number,
  preset: SlowCinemaPreset,
  prompt?: string,
  itemId?: string,
): Promise<string> {
  const sid = await startSlowCinema(b64, preset, targetFrames, prompt);
  const id = itemId ?? `sc_${Date.now()}`;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const { done } = await pollSlowCinema(sid, targetFrames);
    if (done) break;
  }
  return exportSlowCinema(sid, id);
}

// ─── AnimateDiff video ────────────────────────────────────────────────────────
// Tries A1111 AnimateDiff extension first; falls back to Slow Cinema if unavailable.

export async function generateAnimateDiff(
  b64: string,
  frameCount: number,
  prompt = 'smooth animation, vivid colors',
  sourceDims?: { w: number; h: number },
  denoise = 0.5,
  cfgScale = 7,
): Promise<string> {
  const scaled = await scaleB64ToMax(b64, 512);
  const { width, height } = sourceDims ? computeAISize(sourceDims.w, sourceDims.h) : { width: 512, height: 512 };
  let data: any;
  try {
    data = await a1111Post('/sdapi/v1/img2img', {
      init_images: [scaled],
      prompt,
      negative_prompt: 'blurry, low quality, distorted, ugly',
      denoising_strength: denoise,
      steps: 20,
      cfg_scale: cfgScale,
      width,
      height,
      alwayson_scripts: {
        animatediff: {
          args: [{
            enable: true,
            video_length: frameCount,
            fps: 8,
            loop_number: 0,
            closed_loop: 'N',
            batch_size: frameCount,
            stride: 1,
            overlap: -1,
            format: ['GIF', 'MP4'],
            interp: 'Off',
            interp_x: 10,
            video_source: null,
            video_path: '',
            latent_power: 1,
            latent_scale: 32,
            last_frame: null,
            latent_power_last: 1,
            latent_scale_last: 32,
            request_id: '',
          }],
        },
      },
    });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('animatediff') || msg.includes('not found') || msg.includes('Script')) {
      // AnimateDiff not installed — fall back to Slow Cinema
      console.log('[AI/AnimateDiff] Extension unavailable, using Slow Cinema fallback');
      return runSlowCinemaInline(b64, frameCount, 'DREAM', prompt || undefined);
    }
    throw e;
  }

  const images: string[] = data.images ?? [];
  console.log('[AI/AnimateDiff] images count:', images.length, 'data keys:', Object.keys(data).join(','));

  // GIF is appended as the LAST element in images[] by AnimateDiff (starts with R0lGOD)
  const gifB64 = images.find(img => img.startsWith('R0lGOD'));
  if (gifB64) {
    console.log('[AI/AnimateDiff] found GIF inline');
    const id = `anim_${Date.now()}`;
    const path = `${FileSystem.documentDirectory}ai_${id}.gif`;
    await FileSystem.writeAsStringAsync(path, gifB64, { encoding: 'base64' as any });
    return path;
  }

  // Try to find MP4 path in info JSON (some AnimateDiff versions store it there)
  try {
    const infoObj = typeof data.info === 'string' ? JSON.parse(data.info) : (data.info ?? {});
    const paths: string[] = (
      infoObj?.animatediff_output ??
      infoObj?.output_files ??
      (infoObj?.AnimateDiff?.output ?? [])
    );
    const mp4Path = Array.isArray(paths) ? paths.find(p => p.endsWith('.mp4') || p.endsWith('.gif')) : paths;
    if (mp4Path && typeof mp4Path === 'string') {
      console.log('[AI/AnimateDiff] downloading video from:', mp4Path);
      const id = `anim_${Date.now()}`;
      const ext = mp4Path.endsWith('.gif') ? 'gif' : 'mp4';
      const localPath = `${FileSystem.documentDirectory}ai_${id}.${ext}`;
      const dlResult = await FileSystem.downloadAsync(`${SD_A1111_LAN}/file=${encodeURIComponent(mp4Path)}`, localPath);
      if (dlResult.status === 200) return localPath;
    }
  } catch (e) { console.warn('[AI/AnimateDiff] info parse failed:', String(e).slice(0, 100)); }

  // Fallback: use last image — or use Slow Cinema if AnimateDiff returned nothing useful
  const fallback = images[images.length - 1] ?? data.video;
  if (!fallback) {
    console.log('[AI/AnimateDiff] No output — falling back to Slow Cinema');
    return runSlowCinemaInline(b64, frameCount, 'DREAM', prompt || undefined);
  }
  console.warn('[AI/AnimateDiff] no GIF/MP4 found — saving last frame as PNG');
  const id = `anim_${Date.now()}`;
  return saveResult(fallback, 'video_animatediff', id);
}

// ─── Slow Cinema (SD-Stream) ──────────────────────────────────────────────────
// Server API (verified 2026-06-07):
//   POST /api/slowmotion/session/new  → {session_id}
//   POST /api/slowmotion/upload-image (multipart: session_id, image file) → {ok, url, width, height}
//   POST /api/slowmotion/start        (JSON: session_id, preset, frames)  → {ok, session_id, opts}
//   GET  /api/slowmotion/status?session_id=<id>  → {running: bool, frame_count, export_url, ...}
//   POST /api/slowmotion/abort        (JSON: session_id)  → {ok: true}
//   GET  /api/slowmotion/asset/<sid>/exports/<file>.mp4  → raw video

async function sdStreamLanFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${SD_STREAM_LAN}${path}`, { signal: abortAfter(15000), ...opts });
}

export async function startSlowCinema(
  b64: string,
  preset: SlowCinemaPreset,
  frames = 40,
  prompt?: string,
): Promise<string> {
  // Step 1: new session
  const sessRes = await sdStreamLanFetch('/api/slowmotion/session/new', { method: 'POST' });
  if (!sessRes.ok) throw new Error('Slow cinema session failed — is the SD-Stream server running?');
  const { session_id } = await sessRes.json();

  // Step 2: upload image as multipart form-data (server does NOT accept JSON base64)
  const tmpPath = `${FileSystem.cacheDirectory}slowmo_src_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(tmpPath, b64, { encoding: FileSystem.EncodingType.Base64 });
  const formData = new FormData();
  formData.append('session_id', session_id);
  formData.append('image', { uri: tmpPath, type: 'image/jpeg', name: 'source.jpg' } as any);
  const upRes = await sdStreamLanFetch('/api/slowmotion/upload-image', { method: 'POST', body: formData });
  FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => {});
  if (!upRes.ok) throw new Error('Slow cinema image upload failed');

  // Step 3: start (server runs indefinitely — poll will abort when targetFrames reached)
  const body: Record<string, any> = { session_id, preset, frames };
  if (prompt) body.prompt = prompt;
  const startRes = await sdStreamLanFetch('/api/slowmotion/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!startRes.ok) throw new Error('Slow cinema start failed');
  return session_id as string;
}

export async function pollSlowCinema(
  sessionId: string,
  targetFrames?: number,
): Promise<{ done: boolean; progress?: number; error?: string }> {
  try {
    const res = await sdStreamLanFetch(`/api/slowmotion/status?session_id=${sessionId}`);
    if (!res.ok) return { done: false };
    const data = await res.json();
    const frameCount: number = data.frame_count ?? 0;
    const isRunning: boolean = data.running ?? false;
    if (data.error && String(data.error).length > 0) return { done: true, error: String(data.error) };
    if (!isRunning) return { done: true }; // aborted or naturally stopped
    // Auto-abort when target frame count reached
    if (targetFrames && frameCount >= targetFrames) {
      void sdStreamLanFetch('/api/slowmotion/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      return { done: false, progress: 0.98 }; // wait for next poll to see running: false
    }
    const progress = targetFrames ? Math.min(frameCount / targetFrames, 0.95) : undefined;
    return { done: false, progress };
  } catch { return { done: false }; }
}

export async function exportSlowCinema(sessionId: string, itemId: string): Promise<string> {
  // Trigger abort (idempotent — safe if already aborted)
  await sdStreamLanFetch('/api/slowmotion/abort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  }).catch(() => {});

  // Poll status for export_url (appears after running → false)
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const res = await fetch(`${SD_STREAM_LAN}/api/slowmotion/status?session_id=${sessionId}`, {
        signal: abortAfter(6000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.export_url) {
        const localPath = `${FileSystem.documentDirectory}ai_slowmo_${itemId}.mp4`;
        const dlResult = await FileSystem.downloadAsync(`${SD_STREAM_LAN}${data.export_url}`, localPath);
        if (dlResult.status === 200) return localPath;
        throw new Error(`Slow cinema download failed (HTTP ${dlResult.status})`);
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes('download failed')) throw e;
    }
  }
  throw new Error('Slow cinema export not ready — try again in a moment');
}

// ─── Transition video ─────────────────────────────────────────────────────────
// Tries AnimateDiff last_frame morph (A1111 extension) for a true A→B transition.
// Falls back to Slow Cinema animation from image A if AnimateDiff is not installed.
// Note: SD-Stream /api/transition/ upload endpoint has a server-side bug (HTTP 500).

export async function generateTransition(
  b64A: string,
  b64B: string,
  interpolateFrames = 24,
): Promise<string> {
  const scaledA = await scaleB64ToMax(b64A, 512);
  const scaledB = await scaleB64ToMax(b64B, 512);
  let data: any;
  try {
    data = await a1111Post('/sdapi/v1/img2img', {
      init_images: [scaledA],
      prompt: 'smooth morphing transition, cinematic blend, fluid motion, seamless',
      negative_prompt: 'blurry, low quality, distorted, abrupt cut, static, frozen',
      denoising_strength: 0.65,
      steps: 20,
      cfg_scale: 7,
      width: 512,
      height: 512,
      alwayson_scripts: {
        animatediff: {
          args: [{
            enable: true,
            video_length: interpolateFrames,
            fps: 8,
            loop_number: 0,
            closed_loop: 'N',
            batch_size: interpolateFrames,
            stride: 1,
            overlap: -1,
            format: ['GIF', 'MP4'],
            interp: 'Off',
            interp_x: 10,
            video_source: null,
            video_path: '',
            latent_power: 1,
            latent_scale: 32,
            last_frame: scaledB,   // AnimateDiff morphs from init_image → last_frame
            latent_power_last: 1,
            latent_scale_last: 32,
            request_id: '',
          }],
        },
      },
    });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('animatediff') || msg.includes('not found') || msg.includes('Script')) {
      // AnimateDiff not installed — fall back to Slow Cinema with image A
      console.log('[AI/Transition] AnimateDiff unavailable, using Slow Cinema fallback');
      return runSlowCinemaInline(b64A, interpolateFrames, 'DREAM', 'cinematic transition, smooth motion, fluid blend');
    }
    throw e;
  }

  const images: string[] = data.images ?? [];
  const gifB64 = images.find(img => img.startsWith('R0lGOD'));
  if (gifB64) {
    const id = `trans_${Date.now()}`;
    const path = `${FileSystem.documentDirectory}ai_${id}.gif`;
    await FileSystem.writeAsStringAsync(path, gifB64, { encoding: 'base64' as any });
    return path;
  }

  try {
    const infoObj = typeof data.info === 'string' ? JSON.parse(data.info) : (data.info ?? {});
    const paths: string[] = (
      infoObj?.animatediff_output ??
      infoObj?.output_files ??
      (infoObj?.AnimateDiff?.output ?? [])
    );
    const mp4Path = Array.isArray(paths) ? paths.find((p: string) => p.endsWith('.mp4') || p.endsWith('.gif')) : paths;
    if (mp4Path && typeof mp4Path === 'string') {
      const id = `trans_${Date.now()}`;
      const ext = mp4Path.endsWith('.gif') ? 'gif' : 'mp4';
      const localPath = `${FileSystem.documentDirectory}ai_${id}.${ext}`;
      const dlResult = await FileSystem.downloadAsync(`${SD_A1111_LAN}/file=${encodeURIComponent(mp4Path)}`, localPath);
      if (dlResult.status === 200) return localPath;
    }
  } catch { /* ignore info parse errors */ }

  const fallback = images[images.length - 1] ?? data.video;
  if (!fallback) {
    console.log('[AI/Transition] No output from AnimateDiff — using Slow Cinema fallback');
    return runSlowCinemaInline(b64A, interpolateFrames, 'DREAM', 'cinematic transition, smooth motion, fluid blend');
  }
  const id = `trans_${Date.now()}`;
  return saveResult(fallback, 'video_transition', id);
}

// ─── One-shot video APIs: /api/transition/auto, /api/slowmotion/auto, /api/painter/v2v/auto
// LAN: http://192.168.178.49:4847  |  WAN: https://some-sender.gotdns.ch:4848
// All endpoints are unauthenticated (/api/* is public). TLS cert valid on WAN.

async function ma4Fetch(path: string, opts: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  // Try LAN first (fast, no auth, no TLS overhead)
  try {
    const res = await fetch(`${SD_STREAM_LAN}${path}`, {
      signal: abortAfter(Math.min(timeoutMs, 15000)),
      ...opts,
    });
    if (res.ok || (res.status >= 400 && res.status < 500)) return res;
  } catch { /* LAN unreachable, fall through to WAN */ }
  return fetch(`${API3D_WAN_BASE}${path}`, { signal: abortAfter(timeoutMs), ...opts });
}

// 1. Two images → morph video  (RIFE frame interpolation, optional SD style pass)
export async function generateTransitionAuto(
  b64A: string,
  b64B: string,
  options: {
    prompt?: string;
    count?: number;       // interpolated frames, default 30
    fps?: number;         // default 24
    doSd?: boolean;       // SD style pass (default true)
    denoise?: number;     // SD denoise 0–1
    pingpong?: boolean;   // A→B→A loop
    upscaleTarget?: 'og' | '2x' | '4x' | 'none';
    cnEnabled?: boolean;
  } = {},
  onProgress?: (pct: number) => void,
): Promise<string> {
  // Scale both frames so the longer side is 512px (preserving aspect ratio)
  const scaledA = await scaleB64ToMax(b64A, 512);
  const scaledB = await scaleB64ToMax(b64B, 512);
  // Write to temp files for multipart upload
  const tmpA = `${FileSystem.cacheDirectory}trnsA_${Date.now()}.jpg`;
  const tmpB = `${FileSystem.cacheDirectory}trnsB_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(tmpA, scaledA, { encoding: FileSystem.EncodingType.Base64 });
  await FileSystem.writeAsStringAsync(tmpB, scaledB, { encoding: FileSystem.EncodingType.Base64 });

  const fd = new FormData();
  fd.append('image_a', { uri: tmpA, type: 'image/jpeg', name: 'frame_a.jpg' } as any);
  fd.append('image_b', { uri: tmpB, type: 'image/jpeg', name: 'frame_b.jpg' } as any);
  if (options.prompt)        fd.append('prompt', options.prompt);
  if (options.count != null) fd.append('count', String(options.count));
  if (options.fps   != null) fd.append('fps', String(options.fps));
  fd.append('do_sd',        options.doSd       !== false ? 'true' : 'false');
  fd.append('cn_enabled',   options.cnEnabled   !== false ? 'true' : 'false');
  if (options.denoise       != null) fd.append('denoise', String(options.denoise));
  if (options.pingpong)              fd.append('pingpong', 'true');
  if (options.upscaleTarget)         fd.append('upscale_target', options.upscaleTarget);

  const res = await ma4Fetch('/api/transition/auto', { method: 'POST', body: fd });
  FileSystem.deleteAsync(tmpA, { idempotent: true }).catch(() => {});
  FileSystem.deleteAsync(tmpB, { idempotent: true }).catch(() => {});
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Transition auto failed (${res.status}): ${err.slice(0, 120)}`);
  }
  const startData = await res.json();
  const { qid, poll_url } = startData as { qid: string; poll_url?: string; session_id?: string };
  if (!qid) throw new Error('Transition auto: no qid in response');

  // Poll queue until done
  const queuePath = poll_url ?? '/api/transition/queue';
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const pollRes = await ma4Fetch(queuePath);
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const queue: any[] = pollData.queue ?? [];
      const entry = queue.find(e => e.qid === qid || e.session_id === qid);
      if (!entry) { onProgress?.(i); continue; }
      if (entry.status === 'error') throw new Error(entry.error ?? 'Transition failed on server');
      if (typeof entry.progress === 'number' && entry.total > 0) {
        onProgress?.(Math.round((entry.progress / entry.total) * 100));
      }
      if (entry.status === 'done' && entry.final_url) {
        const finalUrl: string = entry.final_url.startsWith('http')
          ? entry.final_url
          : `${SD_STREAM_LAN}${entry.final_url}`;
        const id = `trans_${Date.now()}`;
        const localPath = `${FileSystem.documentDirectory}ai_${id}.mp4`;
        const dl = await FileSystem.downloadAsync(finalUrl, localPath);
        if (dl.status === 200) return localPath;
        throw new Error(`Transition download failed (${dl.status})`);
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes('Transition') || msg.includes('download')) throw e;
    }
  }
  throw new Error('Transition auto timed out — server may be busy');
}

// 2. One image → evolving dreamscape video  (one-shot Slow Cinema)
export async function generateSlowmotionAuto(
  b64: string,
  options: {
    presets?: string;     // e.g. "DREAM" or "DREAM,AGING"
    theme?: string;
    maxFrames?: number;   // default 60
    fps?: number;
    slowness?: number;    // 0=fast morph, 1=imperceptible drift
  } = {},
  onProgress?: (frameCount: number) => void,
): Promise<string> {
  // Scale so longer side is 512px (preserving aspect ratio)
  const scaled = await scaleB64ToMax(b64, 512);
  const tmpPath = `${FileSystem.cacheDirectory}slomo_auto_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(tmpPath, scaled, { encoding: FileSystem.EncodingType.Base64 });

  const fd = new FormData();
  fd.append('image', { uri: tmpPath, type: 'image/jpeg', name: 'image.jpg' } as any);
  fd.append('presets',    options.presets   ?? 'DREAM');
  fd.append('max_frames', String(options.maxFrames ?? 60));
  if (options.theme    != null) fd.append('theme', options.theme);
  if (options.fps      != null) fd.append('fps', String(options.fps));
  if (options.slowness != null) fd.append('slowness', String(options.slowness));

  const res = await ma4Fetch('/api/slowmotion/auto', { method: 'POST', body: fd });
  FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => {});
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Slowmotion auto failed (${res.status}): ${err.slice(0, 120)}`);
  }
  const { session_id, status_url } = await res.json() as { session_id: string; status_url?: string };

  // Poll until running===false (server stops automatically at max_frames)
  const pollPath = status_url ?? `/api/slowmotion/status?session_id=${session_id}`;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const pollRes = await ma4Fetch(pollPath);
      if (!pollRes.ok) continue;
      const data = await pollRes.json();
      onProgress?.(data.frame_count ?? 0);
      if (data.error && String(data.error).length > 0) throw new Error(String(data.error));
      if (!data.running) {
        // The status endpoint reports completion; the final MP4 is returned by session/meta.
        const metaRes = await ma4Fetch(`/api/slowmotion/session/meta?session_id=${session_id}`);
        if (!metaRes.ok) {
          const err = await metaRes.text().catch(() => '');
          throw new Error(`Slowmotion meta fetch failed (${metaRes.status}): ${err.slice(0, 120)}`);
        }
        const metaData = await metaRes.json() as { meta?: { export_url?: string } };
        const exportUrl: string = metaData.meta?.export_url ?? data.export_url ?? '';
        if (exportUrl) {
          const id = `slomo_${Date.now()}`;
          const localPath = `${FileSystem.documentDirectory}ai_${id}.mp4`;
          const dlUrl = exportUrl.startsWith('http') ? exportUrl : `${SD_STREAM_LAN}${exportUrl}`;
          const dl = await FileSystem.downloadAsync(dlUrl, localPath);
          if (dl.status === 200) return localPath;
          throw new Error(`Slowmotion download failed (${dl.status})`);
        }
        throw new Error('Slowmotion auto: no export URL in status response');
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes('export URL') || msg.includes('auto:')) throw e;
    }
  }
  throw new Error('Slowmotion auto timed out');
}

// 3. Video → restyled video  (SD img2img on every frame, temporal consistency)
export async function generateV2V(
  videoUri: string,
  options: {
    prompt: string;
    negativePrompt?: string;
    denoise?: number;       // 0.15–0.35 recommended
    steps?: number;
    cfgScale?: number;
    consistencyMode?: 'standard' | 'enhanced';
    frameSkip?: number;     // render every Nth frame
    slowMotion?: number;    // RIFE ×N slowmo output
    controlnetEnabled?: boolean;
  },
  onProgress?: (pct: number, phase: string) => void,
): Promise<string> {
  const fd = new FormData();
  fd.append('video', { uri: videoUri, type: 'video/mp4', name: 'video.mp4' } as any);
  fd.append('prompt', options.prompt);
  if (options.negativePrompt)    fd.append('negative_prompt', options.negativePrompt);
  if (options.denoise   != null) fd.append('denoising_strength', String(options.denoise));
  if (options.steps     != null) fd.append('steps', String(options.steps));
  if (options.cfgScale  != null) fd.append('cfg_scale', String(options.cfgScale));
  fd.append('consistency_mode', options.consistencyMode ?? 'standard');
  if (options.frameSkip != null) fd.append('frame_skip', String(options.frameSkip));
  if (options.slowMotion!= null) fd.append('slow_motion', String(options.slowMotion));
  if (options.controlnetEnabled != null) fd.append('controlnet_enabled', options.controlnetEnabled ? 'true' : 'false');

  const res = await ma4Fetch('/api/painter/v2v/auto', { method: 'POST', body: fd }, 60000);
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`V2V failed (${res.status}): ${err.slice(0, 120)}`);
  }
  const startData = await res.json() as {
    job_id: string; download_url?: string; progress_url?: string; stream_url?: string; frame_count?: number;
  };
  const { job_id, download_url, progress_url } = startData;
  if (!job_id) throw new Error('V2V: no job_id in response');

  // Poll SSE progress endpoint (read as text, parse last lines)
  const pollUrl = progress_url ?? `/api/painter/v2v/progress/${job_id}`;
  for (let i = 0; i < 180; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const pollRes = await ma4Fetch(pollUrl);
      if (!pollRes.ok) continue;
      const text = await pollRes.text();
      // Parse SSE events (event: X / data: {...})
      let lastPct = 0; let lastPhase = 'processing';
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const d = JSON.parse(line.slice(5).trim());
            if (d.pct != null) { lastPct = Math.round(d.pct * 100); lastPhase = d.phase ?? lastPhase; }
            if (d.result || d.download_url) {
              // Done event with result
              const dlUrl: string = d.download_url ?? download_url ?? '';
              if (dlUrl) {
                const resolvedUrl = dlUrl.startsWith('http') ? dlUrl : `${SD_STREAM_LAN}${dlUrl}`;
                const id = `v2v_${Date.now()}`;
                const localPath = `${FileSystem.documentDirectory}ai_${id}.mp4`;
                const dl = await FileSystem.downloadAsync(resolvedUrl, localPath);
                if (dl.status === 200) return localPath;
              }
            }
          } catch { /* ignore parse errors */ }
        }
        if (line.startsWith('event: done') || line.includes('"status":"done"') || line.includes('"done":true')) {
          // Download from known URL
          const dlPath = download_url ?? `/api/painter/v2v/${job_id}/download`;
          const resolvedDl = dlPath.startsWith('http') ? dlPath : `${SD_STREAM_LAN}${dlPath}`;
          const id = `v2v_${Date.now()}`;
          const localPath = `${FileSystem.documentDirectory}ai_${id}.mp4`;
          const dl = await FileSystem.downloadAsync(resolvedDl, localPath);
          if (dl.status === 200) return localPath;
        }
        if (line.startsWith('event: error')) throw new Error('V2V failed on server — check logs');
      }
      onProgress?.(lastPct, lastPhase);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('V2V') || msg.includes('download')) throw e;
    }
  }
  throw new Error('V2V timed out — video may be too long or server busy');
}

// ─── 3D API (port 4858 LAN / port 4848 WAN via emoji3d proxy) ────────────────
// Upload: POST /api/3d/upload  (multipart: image file, name, method)
// Poll:   GET  /api/3d/jobs    (returns list; find by job_id)
// Get:    GET  /api/3d/download/<model_id>/usdz  (or /glb /fbx /obj)

type Method3D = 'triposr' | 'procedural' | 'sf3d' | 'hunyuan' | 'trellis2';

async function login3DApi(): Promise<string> {
  const pw = await getSdStreamPassword();
  console.log('[AI/3D] login3DApi — pw set:', !!pw, '| LAN:', API3D_LAN, '| WAN base:', API3D_WAN_BASE);
  if (!pw) throw new Error('3D API password not set. Tap ⚙️ next to the server status bar in Coin Workshop.');

  // Try direct 3D API login first
  try {
    console.log('[AI/3D] Trying direct login at', `${API3D_WAN_BASE}/login`);
    const res = await fetch(`${API3D_WAN_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `password=${encodeURIComponent(pw)}`,
      redirect: 'manual',
    });
    console.log('[AI/3D] Direct login status:', res.status);
    const setCookie = res.headers.get('set-cookie') ?? '';
    const match = setCookie.match(/([a-zA-Z_][a-zA-Z0-9_]*)=([^;]+)/);
    if (match) {
      const cookie = `${match[1]}=${match[2]}`;
      await setSecret(API3D_COOKIE_KEY, cookie);
      console.log('[AI/3D] Direct login success, cookie key:', match[1]);
      return cookie;
    }
    console.warn('[AI/3D] Direct login — no auth cookie in response');
  } catch (e) { console.warn('[AI/3D] Direct login error:', String(e)); }

  // Fallback: SD-Stream login reuses same password on the same server
  try {
    console.log('[AI/3D] Fallback to SD-Stream login at', SD_STREAM);
    const sdCookie = await loginSdStream();
    await setSecret(API3D_COOKIE_KEY, sdCookie);
    console.log('[AI/3D] SD-Stream fallback success');
    return sdCookie;
  } catch (e) { console.error('[AI/3D] SD-Stream fallback failed:', String(e)); }

  throw new Error('3D API login failed — check your server password in ⚙️ settings.');
}

async function get3DCookie(): Promise<string | null> {
  const stored = await getSecret(API3D_COOKIE_KEY).catch(() => null);
  if (stored) return stored;
  return getSecret(SD_STREAM_COOKIE_KEY).catch(() => null);
}

/**
 * Returns a cached 3D-API cookie if one exists, else null — NEVER triggers a
 * login (so callers on open /api/* endpoints don't fail when no password set).
 */
export async function getCachedApi3dCookie(): Promise<string | null> {
  return get3DCookie();
}

/**
 * Returns a valid 3D-API auth cookie ("name=value"), logging in if needed.
 * Pass force=true to discard any cached cookie and re-authenticate.
 * Exposed for other modules (e.g. the face-emoji client) that hit login-gated
 * /emoji3d endpoints on WAN.
 */
export async function ensureApi3dCookie(force = false): Promise<string> {
  if (!force) {
    const existing = await get3DCookie();
    if (existing) return existing;
  } else {
    await deleteSecret(API3D_COOKIE_KEY).catch(() => {});
  }
  return login3DApi();
}

// /api/* paths need NO auth — only non-API paths (static assets, login) need cookies
async function api3dFetch(path: string, opts: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const lanUrl = `${API3D_LAN}${path}`;
  const wanUrl = `${API3D_WAN}${path}`;
  const isApiPath = path.startsWith('/api/');
  console.log('[AI/3D] api3dFetch', opts.method ?? 'GET', path, isApiPath ? '(no-auth)' : '(auth)', _lanReachable ? '(LAN ok)' : '(LAN down)');

  // Try LAN first (never needs auth) — skip if known unreachable
  if (_lanReachable) {
    try {
      const res = await fetch(lanUrl, { ...opts, signal: abortAfter(timeoutMs) });
      const ct = res.headers.get('content-type') ?? '';
      console.log('[AI/3D] LAN response:', res.status, ct.slice(0, 40));
      if ((res.ok || res.status < 500) && !ct.includes('text/html')) {
        _lanReachable = true;
        return res;
      }
      console.warn('[AI/3D] LAN returned HTML or error status', res.status, '— falling to WAN');
    } catch (e) {
      const msg = String(e);
      console.warn('[AI/3D] LAN unreachable:', msg.slice(0, 100));
      if (msg.includes('Network request failed') || msg.includes('Failed to fetch') || msg.includes('timed out') || msg.includes('abort')) {
        _lanReachable = false;
      }
    }
  } else {
    console.log('[AI/3D] Skipping LAN (known down) → WAN direct');
  }

  // /api/* paths: no cookie needed on WAN either
  if (isApiPath) {
    console.log('[AI/3D] WAN api fetch (no auth)', wanUrl);
    const wanTimeout = Math.max(timeoutMs, 15000); // WAN gets at least 15s
    const res = await fetch(wanUrl, { ...opts, signal: abortAfter(wanTimeout) });
    console.log('[AI/3D] WAN api response:', res.status);
    return res;
  }

  // Non-API paths (static, etc): need auth cookie
  const sendWan = async (cookie: string | null): Promise<Response> => {
    const headers: Record<string, string> = { ...(opts.headers as Record<string, string> ?? {}) };
    if (cookie) headers['Cookie'] = cookie;
    return fetch(wanUrl, { ...opts, headers });
  };

  const cookie = await get3DCookie();
  const res = await sendWan(cookie);
  const ct = res.headers.get('content-type') ?? '';
  console.log('[AI/3D] WAN response:', res.status, ct.slice(0, 40));
  if (ct.includes('text/html')) {
    console.warn('[AI/3D] WAN returned HTML — re-authenticating');
    await deleteSecret(API3D_COOKIE_KEY);
    const freshCookie = await login3DApi();
    return sendWan(freshCookie);
  }
  return res;
}

// Returns LAN base if reachable, otherwise WAN base (for WebView factory cam URL)
export async function getApi3DBase(): Promise<string> {
  try {
    const r = await fetch(`${API3D_LAN}/api/3d/jobs`, { signal: abortAfter(2000) });
    if (r.status < 500) return API3D_LAN;
  } catch { /* LAN down */ }
  return API3D_WAN_BASE;
}

// Full factory cam URL — no auth required, loads directly in WKWebView
// LAN: http://192.168.178.49:4858/static/assets/factory3d.html?director=1&ui=0
// WAN: https://some-sender.gotdns.ch:4848/emoji3d/assets/factory3d.html?director=1&ui=0
export async function getApi3DFactoryUrl(): Promise<string> {
  try {
    const r = await fetch(`${API3D_LAN}/api/3d/jobs`, { signal: abortAfter(2000) });
    if (r.status < 500) return `${API3D_LAN}/static/assets/factory3d.html?director=1&ui=0`;
  } catch { /* LAN down */ }
  return `${API3D_WAN_BASE}/emoji3d/assets/factory3d.html?director=1&ui=0`;
}

// Confirmed API contract (tested live 2026-06-06):
//   POST /api/3d/make/triposr  or  /api/3d/make/procedural
//   Params: image (file), name, remove_bg, prompt
//   Returns: { data: { job_id: "..." } }
//
//   GET /api/3d/job/<job_id>  — per-job poll, no login, open proxy
//   Running: { data: { status, progress, label } }
//   Done:    { data: { status:"done", urls: { usdz, glb, fbx, obj } } }
//   URLs are relative paths like /api/3d/download/1873/usdz
//   Client timeout should be ≥ 6 min (triposr jobs queue behind running jobs)
export async function submit3DJob(
  b64: string,
  method: Method3D,
  name = 'emoji3d',
  removeBg = false,
  prompt = '',
): Promise<{ jobId: string; emojiId: string; urls: Record<string, string> }> {
  const scaled = await scaleB64ToMax(b64, 1024);
  const tmpPath = `${FileSystem.cacheDirectory}3d_input_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(tmpPath, scaled, { encoding: 'base64' as any });

  const endpoint = `/api/3d/make/${method}`;

  const makeForm = () => {
    const fd = new FormData();
    fd.append('image', { uri: tmpPath, type: 'image/jpeg', name: 'input.jpg' } as any);
    fd.append('name', name);
    fd.append('prompt', prompt);
    if (removeBg) fd.append('remove_bg', '1');
    return fd;
  };

  let res: Response | null = null;

  // Try LAN first (no auth for /api/*)
  try {
    const r = await fetch(`${API3D_LAN}${endpoint}`, {
      method: 'POST',
      body: makeForm(),
      signal: abortAfter(30_000),
    });
    console.log('[AI/3D] upload LAN status:', r.status);
    if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) res = r;
  } catch (e) { console.warn('[AI/3D] upload LAN failed:', String(e).slice(0, 80)); }

  if (!res) {
    const r = await fetch(`${API3D_WAN}${endpoint}`, {
      method: 'POST',
      body: makeForm(),
      signal: abortAfter(30_000),
    });
    console.log('[AI/3D] upload WAN status:', r.status);
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) {
      const html = await r.text().catch(() => '');
      throw new Error(`3D upload: proxy returned HTML — check /emoji3d path. ${html.slice(0, 80)}`);
    }
    res = r;
  }

  void FileSystem.deleteAsync(tmpPath, { idempotent: true });

  if (!res) throw new Error('3D upload: unreachable (LAN + WAN both failed)');
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[AI/3D] upload error:', errText.slice(0, 300));
    throw new Error(`3D upload HTTP ${res.status}${errText ? ': ' + errText.slice(0, 120) : ''}`);
  }

  const data = await res.json();
  console.log('[AI/3D] upload response:', JSON.stringify(data).slice(0, 400));
  const inner: any = data.data ?? data;
  const jobId = String(inner.job_id ?? inner.jobId ?? inner.id ?? '');
  const emojiId = String(inner.emoji_id ?? inner.emojiId ?? jobId);
  const urls: Record<string, string> = inner.urls ?? {};
  console.log('[AI/3D] job_id:', jobId, 'emoji_id:', emojiId);
  if (!jobId) throw new Error(`No job_id in 3D API response. Body: ${JSON.stringify(data).slice(0, 200)}`);
  return { jobId, emojiId, urls };
}

// For triposr: after job completes, lookup model URLs by emoji_id
// Uses CUSTOM_<first8chars> unicode convention from 3D API
async function _doLookup(path: string): Promise<Record<string, string>> {
  // Try LAN first
  try {
    const r = await fetch(`${API3D_LAN}${path}`, { signal: abortAfter(10_000) });
    const ct = r.headers.get('content-type') ?? '';
    if (r.ok && !ct.includes('text/html')) {
      const data = await r.json();
      console.log('[AI/3D] lookup LAN ok:', JSON.stringify(data).slice(0, 300));
      if (!data.success && data.error) throw new Error(data.error);
      const inner: any = data.data ?? data;
      const u = inner.urls ?? data.urls ?? {};
      if (u.usdz || u.glb || Object.keys(u).length > 0) return u;
    }
  } catch (e) { console.warn('[AI/3D] lookup LAN:', path, String(e).slice(0, 80)); }

  // WAN
  const r = await fetch(`${API3D_WAN}${path}`, { signal: abortAfter(15_000) });
  const rawText = await r.text().catch(() => '');
  console.log('[AI/3D] lookup WAN:', path, r.status, rawText.slice(0, 300));
  if (!r.ok) throw new Error(`3D lookup HTTP ${r.status}: ${rawText.slice(0, 100)}`);
  let data: any;
  try { data = JSON.parse(rawText); } catch { throw new Error(`3D lookup: not JSON: ${rawText.slice(0, 80)}`); }
  if (!data.success && data.error) throw new Error(data.error);
  const inner: any = data.data ?? data;
  return inner.urls ?? data.urls ?? {};
}

export async function lookupTripo3D(emojiId: string): Promise<Record<string, string>> {
  // Try three key formats the server might use
  const candidates = [
    `/api/3d/lookup?unicode=${encodeURIComponent(`CUSTOM_${emojiId.slice(0, 8)}`)}`,
    `/api/3d/lookup?unicode=${encodeURIComponent(emojiId)}`,
    `/api/3d/lookup?emoji_id=${encodeURIComponent(emojiId)}`,
  ];
  console.log('[AI/3D] lookupTripo3D emojiId:', emojiId.slice(0, 16));
  let lastErr: any;
  for (const path of candidates) {
    try {
      const urls = await _doLookup(path);
      if (urls.usdz || urls.glb || Object.keys(urls).length > 0) {
        console.log('[AI/3D] lookup hit on', path, 'urls:', JSON.stringify(urls).slice(0, 200));
        return urls;
      }
    } catch (e) { lastErr = e; console.warn('[AI/3D] lookup attempt failed:', path, String(e).slice(0, 80)); }
  }
  throw lastErr ?? new Error('3D lookup: no model found for emojiId ' + emojiId.slice(0, 16));
}

// Polls per-job endpoint — stable, never disappears, URLs embedded when done.
// Returns urls map (relative /api/ paths) on completion; caller downloads from those.
export async function poll3DJob(jobId: string): Promise<{
  done: boolean;
  urls?: Record<string, string>;
  progress?: number;
  label?: string;
  error?: string;
  jobNotFound?: boolean;
}> {
  try {
    const res = await api3dFetch(`/api/3d/job/${encodeURIComponent(jobId)}`, {}, 8000);
    if (res.status === 404) {
      console.warn('[AI/3D] poll3DJob 404 — job not found on server:', jobId.slice(0, 8));
      return { done: false, jobNotFound: true };
    }
    if (res.status >= 400 && res.status < 500) {
      // 4xx (other than 404): job is expired/invalid — treat as terminal failure
      console.warn('[AI/3D] poll3DJob HTTP', res.status, '— treating as terminal failure for', jobId.slice(0, 8));
      return { done: true, error: `Job expired or invalid on server (HTTP ${res.status})` };
    }
    if (!res.ok) {
      console.warn('[AI/3D] poll3DJob HTTP', res.status, 'for', jobId);
      return { done: false };
    }
    const rawText = await res.text();
    let data: any;
    try { data = JSON.parse(rawText); } catch {
      console.warn('[AI/3D] poll3DJob non-JSON:', rawText.slice(0, 200));
      return { done: false };
    }
    const job: any = data.data ?? data;
    const status = String(job.status ?? job.state ?? '').toLowerCase();
    const progress = Number(job.progress ?? 0);
    const label = String(job.label ?? job.stage ?? '');
    console.log('[AI/3D] poll', jobId.slice(0, 8), 'status:', status, 'progress:', progress, 'label:', label);

    if (['done', 'completed', 'complete', 'finished', 'success'].includes(status)) {
      const urls: Record<string, string> = job.urls ?? {};
      console.log('[AI/3D] job done, urls:', JSON.stringify(urls).slice(0, 200));
      return { done: true, urls, progress: 100, label };
    }
    if (['failed', 'error'].includes(status)) {
      return { done: true, error: job.error ?? job.message ?? 'Job failed on server' };
    }
    return { done: false, progress, label };
  } catch (e) {
    console.warn('[AI/3D] poll3DJob error:', String(e).slice(0, 100));
    return { done: false };
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
  }
  return btoa(binary);
}

// modelIdOrPath: /api/... relative path from lookup response (e.g. /api/3d/download/1801/usdz)
// Uses api3dFetch (same fetch() stack as polling, proven WAN-stable) instead of
// FileSystem.downloadAsync which hangs indefinitely when LAN IP is unreachable.
// Retry policy: up to 3 attempts on 5xx, with USDZ→GLB fallback (USDZ conversion
// can fail server-side even when the GLB is ready — 502 is the most common case).
export async function download3DModel(modelIdOrPath: string, itemId: string, type: AIItemType): Promise<string> {
  console.log('[AI/3D] download3DModel:', modelIdOrPath.slice(0, 120));

  const saveBuffer = async (destPath: string, res: Response): Promise<string> => {
    const buffer = await res.arrayBuffer();
    const b64 = uint8ToBase64(new Uint8Array(buffer));
    await FileSystem.writeAsStringAsync(destPath, b64, { encoding: 'base64' as any });
    console.log('[AI/3D] saved', destPath, 'bytes:', buffer.byteLength);
    return destPath;
  };

  // Fetch with up to 3 retries on 5xx (2 s delay between attempts)
  const fetchRetry = async (path: string): Promise<Response | null> => {
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise<void>(r => setTimeout(r, 2000));
      try {
        const r = await api3dFetch(path, {}, 120_000);
        if (r.ok || r.status < 500) return r; // 4xx → client error, no retry
        console.log(`[AI/3D] attempt ${i + 1} got ${r.status} for ${path.slice(0, 60)}`);
      } catch (e) {
        console.log(`[AI/3D] attempt ${i + 1} threw:`, String(e).slice(0, 80));
        if (i === 2) throw e;
      }
    }
    return null;
  };

  // ── Relative /api/ path ──────────────────────────────────────────────────────
  if (modelIdOrPath.startsWith('/api/')) {
    const isUsdz = modelIdOrPath.includes('/usdz');
    const ext    = modelIdOrPath.includes('/glb') ? 'glb' : isUsdz ? 'usdz' : 'glb';
    const destPath = `${FileSystem.documentDirectory}ai_${itemId}.${ext}`;

    let res = await fetchRetry(modelIdOrPath);

    // USDZ failed with 5xx → try GLB (server-side USDZ conversion sometimes fails
    // even when the GLB export succeeded — e.g. 502 from the USDZ worker)
    if ((!res || !res.ok) && isUsdz) {
      console.log('[AI/3D] USDZ failed, falling back to GLB…');
      const glbPath = modelIdOrPath.replace('/usdz', '/glb');
      const glbDest = `${FileSystem.documentDirectory}ai_${itemId}.glb`;
      const glbRes = await fetchRetry(glbPath);
      if (glbRes?.ok) {
        console.log('[AI/3D] GLB fallback succeeded');
        return saveBuffer(glbDest, glbRes);
      }
    }

    if (!res?.ok) throw new Error(`3D download HTTP ${res?.status ?? 'null'} for ${modelIdOrPath}`);
    return saveBuffer(destPath, res);
  }

  // ── Absolute URL (legacy / future change) ───────────────────────────────────
  if (modelIdOrPath.startsWith('http://') || modelIdOrPath.startsWith('https://')) {
    const ext = modelIdOrPath.includes('/glb') || modelIdOrPath.endsWith('.glb') ? 'glb' : 'usdz';
    const destPath = `${FileSystem.documentDirectory}ai_${itemId}.${ext}`;
    const res = await fetch(modelIdOrPath, { signal: abortAfter(120_000) });
    if (!res.ok) throw new Error(`3D download HTTP ${res.status} (absolute URL)`);
    return saveBuffer(destPath, res);
  }

  // ── Bare numeric ID fallback ─────────────────────────────────────────────────
  const glbPath = `/api/3d/download/${modelIdOrPath}/glb`;
  const destPath = `${FileSystem.documentDirectory}ai_${itemId}.glb`;
  const res = await api3dFetch(glbPath, {}, 120_000);
  if (!res.ok) throw new Error(`3D download: server returned ${res.status} for bare ID ${modelIdOrPath.slice(0, 16)}`);
  return saveBuffer(destPath, res);
}

export async function submitTripoSR(b64: string): Promise<string> {
  const { jobId } = await submit3DJob(b64, 'triposr', 'emoji3d', false, '');
  return jobId;
}
export async function pollTripoSR(jobId: string): Promise<{ done: boolean; downloadPath?: string; error?: string }> {
  const { done, urls, error } = await poll3DJob(jobId);
  const downloadPath = urls ? (urls.usdz ?? urls.glb ?? '') : undefined;
  return { done, downloadPath, error };
}
export async function downloadTripoSR(modelId: string, itemId: string): Promise<string> {
  return download3DModel(modelId, itemId, 'mesh3d_tripo');
}

// ─── Text → 3D (txt2img → TripoSR chained) ───────────────────────────────────

export async function generateText2Tripo(prompt: string): Promise<string> {
  // Step 1: generate a clean white-background render via txt2img
  const cleanPrompt = `${prompt}, isolated object, pure white background, studio lighting, photorealistic, 3D render, product photography, high detail`;
  const data = await a1111Post('/sdapi/v1/txt2img', {
    prompt: cleanPrompt,
    negative_prompt: 'blurry, low quality, watermark, background scene, environment, shadow',
    steps: 28,
    cfg_scale: 7.5,
    width: 512,
    height: 512,
    sampler_name: 'DPM++ 2M Karras',
  });
  const b64 = data.images?.[0];
  if (!b64) throw new Error('txt2img step failed for text→3D');

  // Step 2: submit to TripoSR via new unified 3D API
  const { jobId } = await submit3DJob(b64, 'triposr', prompt.slice(0, 32), false, prompt);
  return jobId;
}

// ─── Procedural 3D (image → procedural method) ────────────────────────────────

export async function generateProcedural3D(b64: string, name = 'procedural3d'): Promise<string> {
  const { jobId } = await submit3DJob(b64, 'procedural', name, false, '');
  return jobId;
}

// ─── Easter egg generation ────────────────────────────────────────────────────

export async function generateEasterEgg(prompt: string): Promise<string> {
  const data = await a1111Post('/sdapi/v1/txt2img', {
    prompt: `${prompt}, highly detailed, masterpiece, best quality`,
    negative_prompt: 'blurry, low quality, watermark, ugly, deformed, text, nsfw',
    steps: 40,
    cfg_scale: 8.5,
    width: 768,
    height: 768,
    sampler_name: 'DPM++ 2M Karras',
  });
  const img = data.images?.[0];
  if (!img) throw new Error('No image from easter egg generation');
  const id = `egg_${Date.now()}`;
  return saveResult(img, 'image_standard', id);
}

// ─── CLIP interrogation (auto-prompt) with session cache ─────────────────────
// Same painting in same session → returns cached prompt, skips network call.
// Cache lives only in-memory; cleared on module reload (app restart).

export async function interrogateImage(b64: string): Promise<string> {
  const key = _promptCacheKey(b64);
  const cached = _sessionPromptCache.get(key);
  if (cached) {
    console.log('[AI/CLIP] session cache hit — skipping interrogation');
    return cached;
  }
  const data = await a1111Post('/sdapi/v1/interrogate', { image: b64, model: 'clip' });
  const caption = (data.caption as string) ?? '';
  if (caption) _sessionPromptCache.set(key, caption);
  return caption;
}

// ─── Background removal (A1111 rembg extension) ───────────────────────────────

export async function removeBackground(b64: string): Promise<string> {
  const data = await a1111Post('/rembg', {
    input_image: b64,
    model: 'u2net',
    return_mask: false,
    alpha_matting: false,
  });
  const result = (data.image as string) ?? '';
  if (!result) throw new Error('Background removal failed — is the rembg extension installed in A1111?');
  return result;
}

// ─── App artwork listing ──────────────────────────────────────────────────────

export async function listAppArtwork(): Promise<string[]> {
  try {
    const dir = FileSystem.documentDirectory;
    if (!dir) return [];
    const files = await FileSystem.readDirectoryAsync(dir);
    return files
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f) && !f.startsWith('ai_'))
      .map(f => `${dir}${f}`)
      .slice(0, 30);
  } catch { return []; }
}
