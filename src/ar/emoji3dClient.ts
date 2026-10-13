import * as FileSystem from 'expo-file-system/legacy';

// 3D-emoji fetch client — implements the /api/emoji3d/resolve contract:
// app sends the emojis used in the scene, backend returns per-emoji USDZ URLs
// (unit-normalized meshes). Models are cached under Documents/emoji3d/ so the
// second conversion is instant. No auth cookie (same open-path convention as
// the face-emoji API).
// LAN_BASE hits the emoji3d Flask app directly (its own routes, no prefix). It is currently
// UNREACHABLE from any device but the server itself — the service is bound to 127.0.0.1, not
// 0.0.0.0 (deliberately, per the server owner: opening it on 0.0.0.0 would expose admin/write
// routes on the LAN with no auth) — so this always fails. Kept as a harmless fallback in case
// that ever changes; WAN is tried FIRST so a real device never eats this timeout before the base
// that actually works.
// WAN_BASE reaches the SAME app through a reverse proxy on the shared server that strips a
// leading "/emoji3d/" and forwards the rest verbatim — every WAN path needs that prefix, which
// this client previously omitted entirely (every resolve/download call was hitting the WRONG
// Flask app on :4848 — the unrelated Stable Diffusion server — or 404ing outright).
const LAN_BASE = 'http://192.168.178.49:4858';
const WAN_BASE = 'https://some-sender.gotdns.ch:4848/emoji3d';
const RESOLVE_PATH = '/api/emoji3d/resolve';
const LOD = 'low';
const MODELS_DIR = `${FileSystem.documentDirectory}emoji3d/`;
const RESOLVE_TIMEOUT_MS = 8_000;

export interface Emoji3dResult {
  /** emoji char → local file:// path of the downloaded USDZ */
  mapping: Record<string, string>;
  /** emojis the backend is still generating (retry later) */
  generating: string[];
  /** emojis with no model available */
  unavailable: string[];
}

/** Dash-joined uppercase hex codepoints — the stable model key. */
export function emojiToUnicodeKey(emoji: string): string {
  return Array.from(emoji)
    .map((c) => (c.codePointAt(0) ?? 0).toString(16).toUpperCase())
    .join('-');
}

export function normalizeEmoji3dUnicodeKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/_/g, '-');
}

function localPathFor(unicode: string): string {
  return `${MODELS_DIR}${unicode}_${LOD}.usdz`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    return info.exists && (info.size ?? 0) > 0;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

interface ResolveItem {
  unicode?: string;
  status?: string;
  url?: string | null;
  retryAfterSec?: number;
}

/** Resolve results plus the base URL that actually answered — model download URLs from the
 * response are relative (`/api/3d/download/<id>/usdz`) and must be re-rooted on THIS base,
 * since LAN and WAN reach the same app through different prefixes. */
async function callResolve(emojis: { unicode: string; char: string }[]): Promise<{ results: ResolveItem[]; base: string }> {
  const body = JSON.stringify({ emojis, format: 'usdz', lod: LOD, clientVersion: '9.1.0' });
  let lastError: unknown;
  // WAN first: LAN_BASE is currently unreachable from any external device (see comment above),
  // so trying it first just burns the 8s timeout before ever reaching the base that works.
  for (const base of [WAN_BASE, LAN_BASE]) {
    try {
      const res = await fetchWithTimeout(`${base}${RESOLVE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      });
      if (!res.ok) { lastError = new Error(`resolve ${res.status}`); continue; }
      const json = JSON.parse(await res.text());
      // Accept both the plain contract shape and the {data:{...}} face-API wrapper.
      const payload = json?.results ? json : json?.data;
      if (Array.isArray(payload?.results)) return { results: payload.results as ResolveItem[], base };
      lastError = new Error('resolve: malformed response');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('3D backend unreachable');
}

/**
 * Resolve + download the 3D models for the given emoji chars — FAST:
 * cache-first (no network when everything is local), then one resolve call and
 * all missing downloads in parallel. Throws only when the backend is
 * unreachable AND something was actually needed.
 */
export async function ensureEmoji3dModels(chars: string[]): Promise<Emoji3dResult> {
  const unique = [...new Set(chars)].filter((c) => c && c.length > 0);
  const mapping: Record<string, string> = {};
  const need: { unicode: string; char: string }[] = [];

  await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true }).catch(() => {});
  for (const char of unique) {
    const unicode = emojiToUnicodeKey(char);
    const local = localPathFor(unicode);
    if (await fileExists(local)) mapping[char] = local;
    else need.push({ unicode, char });
  }
  if (need.length === 0) return { mapping, generating: [], unavailable: [] };

  const { results, base } = await callResolve(need);
  const byUnicode = new Map(results.map((r) => [normalizeEmoji3dUnicodeKey(r.unicode), r]));
  const generating: string[] = [];
  const unavailable: string[] = [];

  await Promise.all(
    need.map(async ({ unicode, char }) => {
      const item = byUnicode.get(normalizeEmoji3dUnicodeKey(unicode));
      if (item?.status === 'ready' && item.url) {
        try {
          const local = localPathFor(unicode);
          // item.url is relative ("/api/3d/download/<id>/usdz") — re-root it on whichever base
          // actually answered the resolve call (LAN vs WAN reach the same app via different
          // path prefixes, so this can't be a fixed constant).
          const downloadUrl = item.url.startsWith('http') ? item.url : `${base}${item.url}`;
          await FileSystem.downloadAsync(downloadUrl, local);
          if (await fileExists(local)) { mapping[char] = local; return; }
        } catch (error) {
          console.warn(`[Emoji3D] download failed for ${unicode}:`, error);
        }
        unavailable.push(char);
      } else if (item?.status === 'generating') {
        generating.push(char);
      } else {
        unavailable.push(char);
      }
    })
  );

  return { mapping, generating, unavailable };
}
