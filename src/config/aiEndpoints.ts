// ─── Server addresses ────────────────────────────────────────────────────────
// LAN (fastest, no auth required)
export const SD_A1111_LAN      = 'http://192.168.178.49:7860';
// SD-Stream HTTP (WAN + LAN, needs sd_auth cookie from login)
export const SD_STREAM         = 'http://some-sender.gotdns.ch:4847';
export const SD_STREAM_LAN     = 'http://192.168.178.49:4847';
// 4MA public API (no auth for open endpoints)
export const MA4_PUBLIC        = 'https://some-sender.gotdns.ch:4849';
// 3D API — new unified endpoint (LAN port 4858, WAN via emoji3d proxy on 4848 + cookie)
export const API3D_LAN         = 'http://192.168.178.49:4858';
export const API3D_WAN         = 'https://some-sender.gotdns.ch:4848/emoji3d';

// ─── SD-Stream password ───────────────────────────────────────────────────────
// Pre-fill SD_STREAM_DEFAULT_PW so the app works out of the box.
// The value is embedded in the app bundle — don't share your .ipa publicly.
// User can override at any time via ⚙️ in Coin Workshop.
export const SD_STREAM_PW_KEY      = 'ai/sdstream_password';
export const SD_STREAM_COOKIE_KEY  = 'ai/sdstream_cookie';
// SD-STREAM password — prefer the build-time env var (EXPO_PUBLIC_SD_STREAM_PW).
// Release builds must not ship the development fallback password.
export const SD_STREAM_DEFAULT_PW  = process.env.EXPO_PUBLIC_SD_STREAM_PW || (__DEV__ ? 'ppppp' : '');

// ─── Coin costs ───────────────────────────────────────────────────────────────
export function calcVideoCost(frames: number): number {
  return frames <= 30 ? frames : Math.ceil(frames / 10) * 5;
}

// Slow cinema: 1 coin for ≤10 frames, 5 coins per 10 frames above 10
export function calcSlowCinemaCost(frames: number): number {
  return frames <= 10 ? 1 : Math.ceil(frames / 10) * 5;
}

export const COSTS = {
  image_standard:        1,
  image_controlnet:      1,
  image_txt2img:         1,
  video_animatediff:     calcVideoCost,      // function: takes frameCount
  video_slowcinema:      calcSlowCinemaCost, // function: takes frameCount
  video_transition:      3,
  video_transition_auto: 5,    // RIFE + SD morph pipeline
  video_slowmotion_auto: 8,    // one-shot evolving video
  video_v2v:             10,   // per video restyle
  mesh3d_tripo:          5,
  mesh3d_procedural:     5,
  mesh3d_text2tripo:     5,
  mesh3d_sf3d:           5,
  mesh3d_hunyuan:        5,
  mesh3d_trellis2:       5,
} as const;

// ─── ControlNet module/model pairs (only installed models) ───────────────────
// Preprocessor modules verified live 2026-06-06 against installed model list.
// model names without hash — resolveControlNetModel() appends the hash at runtime.
export type ControlNetModule = 'lineart' | 'depth' | 'tile';
export const CONTROLNET_MODELS: Record<ControlNetModule, string> = {
  lineart: 'control_v11p_sd15_lineart',   // preprocessor: lineart
  depth:   'control_v11f1p_sd15_depth',   // preprocessor: depth
  tile:    'control_v11f1e_sd15_tile',    // preprocessor: tile_resample
};

// ─── Slow-cinema presets ─────────────────────────────────────────────────────
export const SLOW_CINEMA_PRESETS = [
  'DREAM', 'NEON', 'GLITCH', 'RETRO', 'GHOST', 'FRACTAL',
  'ICE', 'FIRE', 'AGING', 'ORGANIC', 'MEMORY', 'MELTING', 'FUNGAL', 'ANALOG',
] as const;
export type SlowCinemaPreset = typeof SLOW_CINEMA_PRESETS[number];
