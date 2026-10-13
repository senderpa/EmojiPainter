/**
 * FaceMeshOverlay — "Emoji Me": selfie → stylized, ARKit-rigged 3D head.
 *
 * Phases:
 *   intro    → live front camera; take a selfie or pick a photo
 *   building → live build timeline (11 real backend stages) with the per-stage
 *              preview image and progress — never a bare spinner
 *   result   → likeness score, final preview, interactive 3D / AR Quick Look,
 *              export GLB/USDZ, fix texture orientation, "Use This Head"
 *   live     → the rigged head tracks the user's face via ARKit blendshapes
 *   error    → face/quality/orientation/export errors with Retry · Choose Photo
 *
 * Backend: /api/face-emoji (LAN-first → WAN), polled ~1s (RN has no SSE).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import {
  FaceFilterNativeView,
  openARQuickLook,
  type FaceFilterViewRef,
} from '../../modules/emoji-ar';
import { startScreenRecording, stopScreenRecording } from '../native/screenRecorder';
import EmojiPickerModal from '../workspace/EmojiPickerModal';
import emojiPickerStyles from '../workspace/emojiPickerStyles';
import { renderableEmojiEntries, searchRenderableEmojis } from '../lib/emojiCatalog';
import { isCustomBrushReference } from '../lib/customBrushRegistry';
import * as FileSystem from 'expo-file-system/legacy';
import FactoryFeed from './FactoryFeed';
import { addMask, loadMasks, removeMask, resolveMaskPath, saveMasks, type SavedMask } from './maskCollection';
import { addPendingJob, loadPendingJobs, removePendingJob, type PendingJob } from './pendingJobs';
import { randomFacePrompt } from './facePrompts';
import { generateStandardImage, uriToBase64 } from '../services/aiContentService';
import {
  ARKIT_RIG_MAPPING,
  BUILD_STAGES,
  createJob,
  downloadAsset,
  fetchAssets,
  fetchMethods,
  fixTextureOrientation,
  pollStatus,
  retryJob,
  stageIndex,
  type CreateJobResult,
  type FaceAssets,
  type FaceJobStatus,
  type FaceMethod,
} from './faceEmojiClient';

type Phase = 'intro' | 'method' | 'building' | 'result' | 'live' | 'error';

interface FaceMeshOverlayProps {
  visible: boolean;
  onClose: () => void;
  onSwitchToAr?: () => void;
}

const POLL_INTERVAL_MS = 1000;
const MAX_POLLS = 240; // ~4 min ceiling

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ERROR_COPY: Record<string, string> = {
  NO_FACE: 'No face detected — make sure your face is clearly visible and well lit.',
  FACE_TOO_SMALL: 'Your face is too small — move closer and try again.',
  BLURRY: 'The photo looks blurry — hold still and retake it.',
  MULTIPLE_FACES: 'Multiple faces detected — only you should be in the frame.',
  GENERIC: 'The result came out too generic — let’s try a different photo or style.',
  TEXTURE_ORIENTATION: 'The texture orientation could not be corrected.',
  EXPORT_FAILED: 'The 3D export failed. Please try again.',
};

function errorMessageFor(code: string | null | undefined, fallback?: string | null): string {
  const key = (code ?? '').toUpperCase().replace(/[^A-Z_]/g, '');
  for (const k of Object.keys(ERROR_COPY)) {
    if (key.includes(k)) return ERROR_COPY[k];
  }
  return fallback || 'Something went wrong while building your emoji.';
}

// Which factory camera station to show as each 3D stage runs.
const FACTORY_CAM_BY_STAGE: Record<string, string> = {
  MESH_CREATED: 'printer',
  UV_VALIDATED: 'machine',
  TEXTURE_APPLIED: 'scanner',
  PREVIEWS_RENDERED: 'overview',
  EXPORT_COMPLETE: 'overview',
};
const STYLIZE_IDX = BUILD_STAGES.findIndex((s) => s.key === 'STYLIZED_RENDER_CREATED');
const MESH_IDX = BUILD_STAGES.findIndex((s) => s.key === 'MESH_CREATED');

/** Detect a backend-reported wrong/mirrored texture orientation. */
function orientationFlagged(s: FaceJobStatus): boolean {
  const r = s.raw ?? {};
  const o = String(r.texture_orientation ?? r.textureOrientation ?? '').toLowerCase();
  if (['flipped', 'mirrored', 'wrong', 'rotated'].some((k) => o.includes(k))) return true;
  if (r.orientation_ok === false || r.uv_ok === false || r.uv_valid === false) return true;
  const warns = r.warnings ?? r.warning ?? [];
  const txt = Array.isArray(warns) ? warns.join(' ') : String(warns);
  return /mirror|flip|orient/i.test(txt);
}

const FaceMeshOverlay: React.FC<FaceMeshOverlayProps> = ({ visible, onClose, onSwitchToAr }) => {
  const faceViewRef = useRef<FaceFilterViewRef | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [faceCount, setFaceCount] = useState(0);

  const [selfieUri, setSelfieUri] = useState<string>(''); // the user's taken/picked photo
  const [methods, setMethods] = useState<FaceMethod[]>([]);
  const [methodId, setMethodId] = useState<string>('');
  const methodIdRef = useRef<string>('');
  const [job, setJob] = useState<CreateJobResult | null>(null);
  const [status, setStatus] = useState<FaceJobStatus | null>(null);
  const [assets, setAssets] = useState<FaceAssets | null>(null);
  const [modelUsdz, setModelUsdz] = useState<string>(''); // local file path
  const [modelGlb, setModelGlb] = useState<string>('');
  const [livePath, setLivePath] = useState<string>(''); // path bound to the puppet
  // Default face-mesh mask shown live ('grey' on open) + the saved-mask library.
  const [maskMode, setMaskMode] = useState<'none' | 'grey' | 'camera' | 'model'>('grey');
  const [savedMasks, setSavedMasks] = useState<SavedMask[]>([]);
  const [activeMaskId, setActiveMaskId] = useState<string>('grey');
  // Paint-on-grey-mask tools (emoji stamps), persisted between sessions.
  const [paintMode, setPaintMode] = useState(false);
  const [brushEmoji, setBrushEmoji] = useState('🎨');
  const [paintSizePx, setPaintSizePx] = useState(90);
  const [brushSmudge, setBrushSmudge] = useState(false); // false = stamp emoji · true = smudge webcam/canvas pixels
  const [pickerVisible, setPickerVisible] = useState(false);
  // Full Brush Library picker state (same layout as the 2D workspace).
  const [emojiSearch, setEmojiSearch] = useState('');
  const [recentBrushes, setRecentBrushes] = useState<string[]>([]);
  const [brushMirrorX, setBrushMirrorX] = useState(false);
  const [brushMirrorY, setBrushMirrorY] = useState(false);
  const [brushRotation, setBrushRotation] = useState(0);
  const [greyPaintPath, setGreyPaintPath] = useState('');
  // Pending (handed-in) jobs shown as loading tiles in the mask list.
  const [pendingJobs, setPendingJobs] = useState<PendingJob[]>([]);
  const [jobProgress, setJobProgress] = useState<Record<string, { pct: number; label: string }>>({});
  // SD restyle of the webcam (textured) mask.
  const [cameraOverlayPath, setCameraOverlayPath] = useState('');
  const [sdFrames, setSdFrames] = useState<string[]>([]);
  const [sdBusy, setSdBusy] = useState(false);
  const [sdPlaying, setSdPlaying] = useState(false);
  const [sdFps, setSdFps] = useState(6); // native playback speed, 1–30 fps
  const [sdIndex, setSdIndex] = useState(0); // current frame when stepping with ◀ ▶ (0 = original photo)
  const [facePlane, setFacePlane] = useState(true); // big face-tracked paint plane behind the mask (default on)
  // SD prompt + advanced params (hidden panel).
  const [sdPrompt, setSdPrompt] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sdDenoise, setSdDenoise] = useState(0.44);
  const [sdCfg, setSdCfg] = useState(7.5);
  const [sdPresetKey, setSdPresetKey] = useState('auto');
  const faceEmojiResults = useMemo(
    () => (emojiSearch.trim().length > 0 ? searchRenderableEmojis(emojiSearch) : renderableEmojiEntries),
    [emojiSearch]
  );
  const handleFacePickEmoji = useCallback((emoji: string) => {
    // Native face paint stamps a real emoji glyph — custom PNG brushes can't
    // render onto the mesh UV, so skip them here.
    if (!emoji || isCustomBrushReference(emoji)) return;
    setBrushEmoji(emoji);
    setRecentBrushes((prev) => [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 12));
  }, []);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [maskThumbs, setMaskThumbs] = useState<Record<string, string>>({}); // saved snapshots per default mask
  const GREY_PAINT_KEY = '@grey_mask_paint_v1';
  const MASK_THUMBS_KEY = '@face_mask_thumbs_v1';

  // Grab a snapshot of the current mask on the face, COPY it to a stable
  // Documents path, and persist the key→relpath map so the grey + camera tiles
  // keep showing the user's actual painted/textured mask on the next visit.
  const captureMaskThumb = useCallback((key: string) => {
    setTimeout(() => {
      void (async () => {
        try {
          const tmp = await faceViewRef.current?.snapshot();
          if (!tmp) return;
          const docDir = FileSystem.documentDirectory ?? '';
          const dir = `${docDir}maskthumbs/`;
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
          const rel = `maskthumbs/${key}.png`;
          const dest = `${docDir}${rel}`;
          await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
          await FileSystem.copyAsync({ from: tmp.startsWith('file://') ? tmp : `file://${tmp}`, to: dest });
          setMaskThumbs((t) => ({ ...t, [key]: `${dest}?v=${Date.now()}` }));
          const raw = await AsyncStorage.getItem(MASK_THUMBS_KEY);
          const map = raw ? JSON.parse(raw) : {};
          map[key] = rel;
          await AsyncStorage.setItem(MASK_THUMBS_KEY, JSON.stringify(map));
        } catch { /* ignore */ }
      })();
    }, 1400);
  }, []);

  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorText, setErrorText] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  // Cancellation: bump to abort any in-flight pipeline/poll loop.
  const runIdRef = useRef(0);
  const autoFixedRef = useRef(false);
  const prevMaskModeRef = useRef<'none' | 'grey' | 'camera' | 'model'>('grey');
  // The original baked camera texture — kept so frame-0 (◀/▶ back to original) never
  // passes '' to the native view (which would blank the mask).
  const originalTextureRef = useRef('');

  const [everOpened, setEverOpened] = useState(false);
  if (visible && !everOpened) setEverOpened(true);

  useEffect(() => {
    if (visible) {
      // Every time the face scene opens: go back to the camera so you can ALWAYS
      // take a new photo / make another mask (saved ones stay in the slider).
      runIdRef.current += 1;
      setPhase('intro');
      setStatus(null);
      setJob(null);
    } else {
      runIdRef.current += 1; // leaving cancels work
    }
  }, [visible]);

  // Load the available generation methods once the user opens the mode.
  useEffect(() => {
    if (!everOpened || methods.length > 0) return;
    let cancelled = false;
    fetchMethods()
      .then((list) => {
        if (cancelled || list.length === 0) return;
        const avail = list.filter((m) => m.available);
        setMethods(avail);
        // Default to Auto (sphere-vs-complex-mesh) when present, else the
        // server default, else the first available method.
        const def =
          avail.find((m) => m.id === 'auto') ?? avail.find((m) => m.isDefault) ?? avail[0];
        if (def && !methodIdRef.current) {
          methodIdRef.current = def.id;
          setMethodId(def.id);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [everOpened, methods.length]);

  const selectMethod = useCallback((id: string) => {
    void Haptics.selectionAsync();
    methodIdRef.current = id;
    setMethodId(id);
  }, []);

  // Load the saved-mask library + the persisted grey-mask paint on open.
  useEffect(() => {
    if (!everOpened) return;
    loadMasks().then(setSavedMasks).catch(() => {});
    AsyncStorage.getItem(GREY_PAINT_KEY).then((p) => { if (p) setGreyPaintPath(p); }).catch(() => {});
    // Restore persisted tile thumbnails (grey + camera) so they show the user's
    // actual mask, not the default glyph, on a return visit.
    AsyncStorage.getItem(MASK_THUMBS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const map = JSON.parse(raw) as Record<string, string>;
        const docDir = FileSystem.documentDirectory ?? '';
        const resolved: Record<string, string> = {};
        for (const [k, rel] of Object.entries(map)) {
          if (rel) resolved[k] = `${docDir}${rel}?v=${Date.now()}`;
        }
        if (Object.keys(resolved).length) setMaskThumbs((t) => ({ ...resolved, ...t }));
      } catch { /* ignore */ }
    }).catch(() => {});
  }, [everOpened]);

  // Re-check pending jobs while the face scene is open. A Tripo job may finish
  // on the server after we left (or after a reported failure). Pending jobs show
  // as live "loading" tiles in the mask list; when assets land we download them
  // and they flip into a ready saved-head tile. Polls every ~7s.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const sweep = async () => {
      const pending = await loadPendingJobs();
      if (cancelled) return;
      setPendingJobs(pending);
      for (const j of pending) {
        if (cancelled) return;
        try {
          const a = await fetchAssets(j.assetsUrl || j.jobId);
          if (a.usdzAvailable && a.usdzUrl) {
            const p = await downloadAsset(j.jobId, a.usdzUrl, 'usdz');
            const usdzLocal = p.startsWith('file://') ? p : `file://${p}`;
            if (a.glbUrl) downloadAsset(j.jobId, a.glbUrl, 'glb').catch(() => {});
            const mask: SavedMask = {
              id: j.jobId,
              usdzPath: usdzLocal,
              relPath: `face-emoji/${j.jobId}/head.usdz`,
              arkitMapping: ARKIT_RIG_MAPPING,
              createdAt: Date.now(),
            };
            const list = await addMask(mask);
            await removePendingJob(j.jobId);
            if (!cancelled) {
              setSavedMasks(list);
              setPendingJobs((prev) => prev.filter((x) => x.jobId !== j.jobId));
              setJobProgress((prev) => { const n = { ...prev }; delete n[j.jobId]; return n; });
            }
            continue;
          }
          // Not ready — fetch a status so the tile can show where it is.
          try {
            const s = await pollStatus(j.statusUrl || j.jobId);
            if (!cancelled) {
              setJobProgress((prev) => ({
                ...prev,
                [j.jobId]: { pct: Math.max(0, Math.min(100, Math.round(s.progress ?? 0))), label: s.stage || s.status || 'working' },
              }));
            }
          } catch { /* leave as-is */ }
        } catch {
          // still building / unreachable — keep it pending for the next sweep
        }
      }
    };

    void sweep();
    const id = setInterval(() => { void sweep(); }, 7000);
    return () => { cancelled = true; clearInterval(id); };
  }, [visible]);

  // Persist the painted grey mask so it's still there next time.
  const saveGreyPaint = useCallback(async () => {
    try {
      const p = await faceViewRef.current?.exportFacePaint();
      if (p) {
        await AsyncStorage.setItem(GREY_PAINT_KEY, p);
        setGreyPaintPath(p);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Auto-save the grey-mask painting whenever we LEAVE the grey mask, so the
  // strokes are persistent even when paint mode is left on (no manual toggle).
  useEffect(() => {
    const prev = prevMaskModeRef.current;
    if (prev === 'grey' && maskMode !== 'grey') void saveGreyPaint();
    prevMaskModeRef.current = maskMode;
  }, [maskMode, saveGreyPaint]);

  // Also save when the whole face scene is closed while on the grey mask.
  useEffect(() => {
    if (visible) return;
    if (prevMaskModeRef.current === 'grey') void saveGreyPaint();
  }, [visible, saveGreyPaint]);

  const togglePaint = useCallback(() => {
    void Haptics.selectionAsync();
    setPaintMode((prev) => {
      if (prev) void saveGreyPaint(); // save when turning painting OFF
      return !prev;
    });
  }, [saveGreyPaint]);

  const clearGreyPaint = useCallback(() => {
    void Haptics.selectionAsync();
    void faceViewRef.current?.clearFacePaint();
  }, []);

  // ── SD restyle of the webcam (textured) mask ───────────────────────────────
  // Export the current face texture → SD img2img with a random cool prompt →
  // stamp the result back onto the mask. Each result is kept as a frame so they
  // can be played back as a stop-motion animation.
  // Progressive denoise per auto-step — gentle ramp so even frames 4-5 KEEP the original face structure /
  // ControlNet line control (the old 0.68-0.8 top end blew the likeness away). Each step still iterates on
  // the previous so it morphs, just without going full-abstract.
  // Style presets — each fills the prompt + denoise + cfg. 'auto' = random cool prompt.
  const SD_PRESETS = [
    { key: 'auto', label: '✨ Auto', prompt: '', denoise: 0.44, cfg: 7.5 },
    { key: 'real', label: '📷 Real', prompt: 'realistic portrait photo, natural skin, detailed, sharp', denoise: 0.35, cfg: 7 },
    { key: 'anime', label: '🅰️ Anime', prompt: 'anime portrait, cel shaded, clean lines, vibrant', denoise: 0.5, cfg: 8 },
    { key: 'pixar', label: '🧸 3D', prompt: '3D pixar-style character portrait, soft studio lighting', denoise: 0.5, cfg: 8 },
    { key: 'oil', label: '🎨 Oil', prompt: 'oil painting portrait, thick impasto brush strokes', denoise: 0.55, cfg: 7.5 },
    { key: 'cyber', label: '🌆 Cyber', prompt: 'cyberpunk neon portrait, glowing rim light, futuristic', denoise: 0.55, cfg: 8 },
  ] as const;
  const pickPreset = useCallback((p: typeof SD_PRESETS[number]) => {
    void Haptics.selectionAsync();
    setSdPresetKey(p.key);
    setSdPrompt(p.prompt);
    setSdDenoise(p.denoise);
    setSdCfg(p.cfg);
  }, []);

  // Background-plane SD frames (kept in sync with the mask, index 0 = original).
  const originalPlaneRef = useRef('');
  const planeFramesRef = useRef<string[]>([]);

  // Push the current [original, ...frames] set into native memory for instant playback.
  const pushNativeFrames = useCallback((frames: string[]) => {
    const orig = originalTextureRef.current;
    const all = (orig ? [orig, ...frames] : frames).map((f) => (f.startsWith('file://') ? f : `file://${f}`));
    if (all.length > 0) void faceViewRef.current?.sdSetFrames(all);
  }, []);
  const pushNativePlaneFrames = useCallback((frames: string[]) => {
    const orig = originalPlaneRef.current;
    const all = (orig ? [orig, ...frames] : frames).map((f) => (f.startsWith('file://') ? f : `file://${f}`));
    void faceViewRef.current?.sdSetPlaneFrames(all);
  }, []);

  // Generate a batch of SD frames (append). Tap again to keep adding (30+ ok).
  const SD_BATCH = 5;
  const generateBatch = useCallback(async (fromCurrent: boolean) => {
    if (sdBusy) return;
    setSdBusy(true);
    setSdPlaying(false);
    void faceViewRef.current?.sdStop();
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const existing = sdFrames;
      let src: string | undefined;
      if (fromCurrent && existing.length > 0) {
        // Stylize: iterate on whichever frame is currently shown.
        const idx = Math.min(Math.max(sdIndex - 1, 0), existing.length - 1);
        src = existing[idx];
      } else {
        src = existing.length > 0 ? existing[existing.length - 1] : (await faceViewRef.current?.exportCameraTexture());
      }
      if (!src) throw new Error('No face texture yet — wear the textured mask first.');
      if (existing.length === 0 && !originalTextureRef.current) {
        originalTextureRef.current = typeof src === 'string' ? src : '';
      }
      // Stylize the BACKGROUND PLANE in the same way (if it has content).
      let planeSrc: string | undefined;
      if (facePlane) {
        if (fromCurrent && planeFramesRef.current.length > 0) {
          planeSrc = planeFramesRef.current[Math.min(Math.max(sdIndex - 1, 0), planeFramesRef.current.length - 1)];
        } else {
          planeSrc = planeFramesRef.current.length > 0
            ? planeFramesRef.current[planeFramesRef.current.length - 1]
            : (await faceViewRef.current?.exportPlaneTexture().catch(() => undefined));
        }
        if (planeFramesRef.current.length === 0 && !originalPlaneRef.current && planeSrc) {
          originalPlaneRef.current = planeSrc;
        }
      }
      const basePrompt = sdPrompt.trim().length > 0 ? sdPrompt.trim() : randomFacePrompt();
      let acc = [...existing];
      for (let i = 0; i < SD_BATCH; i += 1) {
        const dn = Math.max(0.15, Math.min(0.85, sdDenoise + (i - 2) * 0.03));
        // Face + plane generate IN PARALLEL (independent chains, same prompt/denoise
        // so they animate in sync) — halves the wait vs sequential calls.
        const facePromise = (async () => {
          const b64 = await uriToBase64(src as string);
          return generateStandardImage(b64, basePrompt, { w: 1024, h: 1024 }, dn, sdCfg);
        })();
        const planePromise = planeSrc
          ? (async () => {
              const pb64 = await uriToBase64(planeSrc as string);
              return generateStandardImage(pb64, basePrompt, { w: 1024, h: 1024 }, dn, sdCfg);
            })().catch(() => null)
          : Promise.resolve(null);
        const [out, pout] = await Promise.all([facePromise, planePromise]);
        const path = out.startsWith('file://') ? out : `file://${out}`;
        acc = [...acc, path];
        setSdFrames(acc);
        pushNativeFrames(acc);
        src = path;
        if (pout) {
          const ppath = pout.startsWith('file://') ? pout : `file://${pout}`;
          planeFramesRef.current = [...planeFramesRef.current, ppath];
          pushNativePlaneFrames(planeFramesRef.current);
          planeSrc = ppath;
        }
        void faceViewRef.current?.sdShowFrame(acc.length); // show the newest (index 0 = original)
        setSdIndex(acc.length);
        void Haptics.selectionAsync();
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSdPlaying(true); // AUTO-PLAY as soon as the frames are back
    } catch (error) {
      Alert.alert('Restyle failed', error instanceof Error ? error.message : 'Could not reach Stable Diffusion.');
    } finally {
      setSdBusy(false);
    }
  }, [sdBusy, sdFrames, sdIndex, sdPrompt, sdDenoise, sdCfg, facePlane, pushNativeFrames, pushNativePlaneFrames]);

  const handleSdUpdate = useCallback(() => { void generateBatch(false); }, [generateBatch]);
  const handleStylize = useCallback(() => { void generateBatch(true); }, [generateBatch]);

  // Reshoot frame-0: fresh in-place webcam bake (no flash), drop SD frames.
  const handleRebakeFirst = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSdPlaying(false);
    setSdFrames([]);
    setSdIndex(0);
    originalTextureRef.current = '';
    originalPlaneRef.current = '';
    planeFramesRef.current = [];
    void faceViewRef.current?.sdSetPlaneFrames([]);
    void (async () => {
      await faceViewRef.current?.sdStop();
      await faceViewRef.current?.rebakeCamera();
      const fresh = await faceViewRef.current?.exportCameraTexture();
      if (fresh) {
        originalTextureRef.current = fresh;
        pushNativeFrames([]);
      }
    })();
  }, [pushNativeFrames]);

  // Reset → drop SD frames, back to the original bake (native, no flash).
  const handleSdReset = useCallback(() => {
    void Haptics.selectionAsync();
    setSdPlaying(false);
    setSdFrames([]);
    setSdIndex(0);
    originalPlaneRef.current = '';
    planeFramesRef.current = [];
    void faceViewRef.current?.sdStop();
    pushNativeFrames([]);
    void faceViewRef.current?.sdSetPlaneFrames([]);
    void faceViewRef.current?.sdShowFrame(0);
  }, [pushNativeFrames]);

  const toggleSdPlay = useCallback(() => {
    void Haptics.selectionAsync();
    setSdPlaying((p) => !p);
  }, []);

  // Manual frame stepping ◀ ▶ — native instant flip (index 0 = original).
  const stepSd = useCallback((dir: number) => {
    void Haptics.selectionAsync();
    setSdPlaying(false);
    const total = sdFrames.length + 1; // +1 for original
    setSdIndex((cur) => {
      const ni = ((cur + dir) % total + total) % total;
      void faceViewRef.current?.sdShowFrame(ni);
      return ni;
    });
  }, [sdFrames]);

  // Native "video" playback — preloaded frames flipped at sdFps, never hides.
  useEffect(() => {
    if (!sdPlaying || sdFrames.length < 1) return;
    void faceViewRef.current?.sdPlay(sdFps);
    return () => { void faceViewRef.current?.sdStop(); };
  }, [sdPlaying, sdFps, sdFrames.length]);

  // Leaving the camera mask clears the restyle so other masks aren't affected.
  useEffect(() => {
    if (maskMode !== 'camera') {
      setSdPlaying(false);
      setCameraOverlayPath('');
      setSdFrames([]);
      setSdIndex(0);
      originalTextureRef.current = '';
    }
  }, [maskMode]);

  // Apply a default face-mesh mask (none / grey / webcam) — clears the head.
  const applyDefaultMask = useCallback((mode: 'none' | 'grey' | 'camera') => {
    void Haptics.selectionAsync();
    setLivePath('');
    setActiveMaskId(mode);
    if (mode === 'camera') {
      setMaskMode('none');
      setTimeout(() => setMaskMode('camera'), 70); // fresh webcam bake each time
    } else {
      setMaskMode(mode);
    }
    // Grey mask is for painting → drop the user straight into paint mode (no
    // extra "Paint" tap). Any other mask leaves paint off.
    setPaintMode(mode === 'grey');
    if (mode !== 'none') captureMaskThumb(mode); // refresh the tile preview
  }, [captureMaskThumb]);

  // Apply a saved 3D-head mask from the library (live puppet). The mesh is
  // ALREADY downloaded — load it DIRECTLY into the live puppet (no result/redo
  // detour). We verify the file still exists first; if it was lost (e.g. an old
  // cache-dir mask), we tell the user instead of silently showing nothing.
  const applySavedMask = useCallback(async (mask: SavedMask) => {
    void Haptics.selectionAsync();
    // Re-resolve against the CURRENT app container (the absolute path's UUID
    // changes on every reinstall; the relative path is stable).
    const path = resolveMaskPath(mask);
    try {
      const info = path ? await FileSystem.getInfoAsync(path) : { exists: false };
      if (!info.exists) {
        Alert.alert(
          'Mesh file missing',
          'This saved head’s 3D file is no longer on the device (it was made before persistence was fixed). Make a new one from a photo.',
          [
            { text: 'Remove from list', style: 'destructive', onPress: () => void removeMask(mask.id).then(setSavedMasks) },
            { text: 'OK', style: 'cancel' },
          ]
        );
        return;
      }
    } catch {
      // If the check itself fails, fall through and still try to load it.
    }
    setActiveMaskId(mask.id);
    setLivePath(path);
    setMaskMode('none');
    // none → model forces the native view to (re)load even when switching
    // between two saved heads.
    setTimeout(() => { setMaskMode('model'); setPhase('live'); }, 60);
  }, []);

  // Long-press a mask tile → context options (Copy / Delete / New-Grey / Paint).
  const handleMaskLongPress = useCallback((kind: string, mask?: SavedMask) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (kind === 'saved' && mask) {
      Alert.alert('Mask options', undefined, [
        {
          text: '📋 Copy',
          onPress: () => {
            void addMask({ ...mask, id: `${mask.id}-copy-${Date.now()}`, createdAt: Date.now() }).then(setSavedMasks);
          },
        },
        {
          text: '🎨 Paint on it',
          onPress: () => { void applySavedMask(mask); setPaintMode(true); },
        },
        {
          text: '🗑 Delete',
          style: 'destructive',
          onPress: () => {
            void removeMask(mask.id).then(setSavedMasks);
            if (activeMaskId === mask.id) applyDefaultMask('grey');
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else if (kind === 'grey') {
      Alert.alert('Grey mask', undefined, [
        { text: '🎨 Paint on it', onPress: () => { applyDefaultMask('grey'); setPaintMode(true); } },
        { text: '🗑 Clear paint', onPress: clearGreyPaint },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      applyDefaultMask(kind as 'none' | 'camera');
    }
  }, [activeMaskId, applyDefaultMask, applySavedMask, clearGreyPaint]);

  const resetToIntro = useCallback(() => {
    runIdRef.current += 1;
    autoFixedRef.current = false;
    setSelfieUri('');
    setJob(null);
    setStatus(null);
    setAssets(null);
    setModelUsdz('');
    setModelGlb('');
    setLivePath('');
    setErrorCode(null);
    setErrorText('');
    setBusyAction(null);
    setPhase('intro');
  }, []);

  const failWith = useCallback((code: string | null | undefined, msg?: string | null) => {
    setErrorCode(code ?? null);
    setErrorText(errorMessageFor(code, msg));
    setPhase('error');
  }, []);

  // ── Poll loop: drives the live timeline until done / error ────────────────
  const runPolling = useCallback(
    async (statusUrl: string, jobId: string, myRun: number) => {
      const alive = () => runIdRef.current === myRun && visible;
      let polls = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (!alive()) return;
        await delay(POLL_INTERVAL_MS);
        if (!alive()) return;
        let s: FaceJobStatus;
        try {
          s = await pollStatus(statusUrl || jobId);
        } catch (e) {
          // transient network blip — keep trying, but surface persistent failures
          // fast (don't spin for minutes on a dead URL).
          console.warn('[FaceEmoji] poll failed', statusUrl, e);
          if (++polls > 8) return failWith(null, 'Lost connection to the face server.');
          continue;
        }
        if (!alive()) return;
        setStatus(s);

        if (s.status === 'error' || s.status === 'failed') {
          return failWith(s.errorCode, s.errorMessage);
        }

        const done =
          s.status === 'done' ||
          s.status === 'complete' ||
          s.status === 'completed' ||
          s.stage === 'EXPORT_COMPLETE' ||
          s.progress >= 100;
        if (done) {
          // Auto-correct a flagged texture orientation once, transparently.
          if (orientationFlagged(s) && !autoFixedRef.current) {
            autoFixedRef.current = true;
            setStatus({ ...s, message: 'Texture orientation is being corrected…' });
            try {
              await fixTextureOrientation(jobId);
            } catch {
              /* fall through — manual fix button still available */
            }
            continue; // keep polling until it re-completes
          }
          return void (await onComplete(jobId, s, myRun));
        }
        if (++polls > MAX_POLLS) return failWith(null, 'This is taking too long. Please try again.');
      }
    },
    // onComplete defined below; included via ref-safe closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, failWith]
  );

  const onComplete = useCallback(
    async (jobId: string, finalStatus: FaceJobStatus, myRun: number) => {
      const alive = () => runIdRef.current === myRun;
      try {
        const a = await fetchAssets(job?.assetsUrl || jobId);
        if (!alive()) return;
        setAssets(a);
        // Pre-download the model so AR / Use-This-Head are instant.
        let usdzLocal = '';
        if (a.usdzAvailable && a.usdzUrl) {
          const p = await downloadAsset(jobId, a.usdzUrl, 'usdz');
          usdzLocal = p.startsWith('file://') ? p : `file://${p}`;
          if (alive()) setModelUsdz(usdzLocal);
        }
        if (a.glbUrl) {
          downloadAsset(jobId, a.glbUrl, 'glb')
            .then((p) => alive() && setModelGlb(p.startsWith('file://') ? p : `file://${p}`))
            .catch(() => {});
        }
        // Add the new head to the saved-mask library right away (reusable later).
        if (usdzLocal) {
          const mask: SavedMask = {
            id: jobId,
            usdzPath: usdzLocal,
            // Stable across reinstalls (matches downloadAsset's dir layout).
            relPath: `face-emoji/${jobId}/head.usdz`,
            previewUri: finalStatus.previewUrl || undefined,
            arkitMapping: ARKIT_RIG_MAPPING,
            createdAt: Date.now(),
          };
          addMask(mask).then((list) => { if (alive()) setSavedMasks(list); }).catch(() => {});
          void removePendingJob(jobId); // got it — no need to re-check later
        }
        if (alive()) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // On done, drop the freshly-textured head straight onto the face
          // (the USDZ carries the baked texture). The 'live' phase still has a
          // "redo" button back to the result options.
          if (usdzLocal) {
            setLivePath(usdzLocal);
            setActiveMaskId(jobId);
            setMaskMode('none');
            setTimeout(() => { if (alive()) { setMaskMode('model'); setPhase('live'); } }, 60);
          } else {
            setPhase('result');
          }
        }
      } catch (error) {
        if (alive()) failWith(null, error instanceof Error ? error.message : null);
      }
    },
    [job, failWith]
  );

  // ── Start a job from a local image path ───────────────────────────────────
  const startJob = useCallback(
    async (imagePath: string, methodId?: string) => {
      if (!imagePath) return;
      const myRun = ++runIdRef.current;
      autoFixedRef.current = false;
      setSelfieUri(imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`);
      setStatus(null);
      setAssets(null);
      setModelUsdz('');
      setModelGlb('');
      setPhase('building');
      const useMethod = methodId ?? methodIdRef.current;
      try {
        const created = await createJob(imagePath, {
          quality: 'draft',
          method: useMethod || undefined,
        });
        console.log('[FaceEmoji] job created', created.jobId, 'method', useMethod, '→', created.statusUrl);
        if (runIdRef.current !== myRun) return;
        setJob(created);
        // Remember the job so we can re-check it on a later visit if the server
        // finishes it after we've moved on (or after a reported failure).
        const pj: PendingJob = {
          jobId: created.jobId,
          statusUrl: created.statusUrl,
          assetsUrl: created.assetsUrl,
          createdAt: Date.now(),
        };
        void addPendingJob(pj);
        setPendingJobs((prev) => [pj, ...prev.filter((x) => x.jobId !== pj.jobId)]);
        await runPolling(created.statusUrl, created.jobId, myRun);
      } catch (error) {
        if (runIdRef.current === myRun) failWith(null, error instanceof Error ? error.message : null);
      }
    },
    [runPolling, failWith]
  );

  // The photo is captured/picked first, THEN the user picks a 3D method.
  const pendingPhotoRef = useRef('');

  const handleTakeSelfie = useCallback(async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const selfie = await faceViewRef.current?.captureSelfie();
      if (!selfie) throw new Error('Could not capture the photo. Try again.');
      pendingPhotoRef.current = selfie;
      setSelfieUri(selfie.startsWith('file://') ? selfie : `file://${selfie}`);
      setPhase('method');
    } catch (error) {
      failWith(null, error instanceof Error ? error.message : null);
    }
  }, [failWith]);

  const handlePickPhoto = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.95,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const uri = result.assets[0].uri;
      pendingPhotoRef.current = uri;
      setSelfieUri(uri.startsWith('file://') ? uri : `file://${uri}`);
      setPhase('method');
    } catch (error) {
      failWith(null, error instanceof Error ? error.message : null);
    }
  }, [failWith]);

  // Pick a 3D method → kick off the job with the captured photo.
  const startWithMethod = useCallback((id: string) => {
    void Haptics.selectionAsync();
    methodIdRef.current = id;
    setMethodId(id);
    void startJob(pendingPhotoRef.current, id);
  }, [startJob]);

  // ── Result-screen actions ─────────────────────────────────────────────────
  const handleRetry = useCallback(async () => {
    // No job to retry (upload failed) → just go back to the face camera.
    if (!job) { resetToIntro(); return; }
    setBusyAction('retry');
    const myRun = ++runIdRef.current;
    autoFixedRef.current = false;
    try {
      await retryJob(job.jobId);
      if (runIdRef.current !== myRun) return;
      setStatus(null);
      setAssets(null);
      setPhase('building');
      void Haptics.selectionAsync();
      await runPolling(job.statusUrl, job.jobId, myRun);
    } catch {
      // Retry didn't take → fall back to the start face camera so the user can
      // simply take a fresh selfie (which always works).
      if (runIdRef.current === myRun) resetToIntro();
    } finally {
      setBusyAction(null);
    }
  }, [job, runPolling, resetToIntro]);

  const handleFixOrientation = useCallback(async () => {
    if (!job) return;
    setBusyAction('fix');
    const myRun = ++runIdRef.current;
    try {
      await fixTextureOrientation(job.jobId);
      if (runIdRef.current !== myRun) return;
      setStatus((s) => (s ? { ...s, message: 'Texture orientation is being corrected…' } : s));
      setPhase('building');
      await runPolling(job.statusUrl, job.jobId, myRun);
    } catch (error) {
      if (runIdRef.current === myRun) failWith('TEXTURE_ORIENTATION', error instanceof Error ? error.message : null);
    } finally {
      setBusyAction(null);
    }
  }, [job, runPolling, failWith]);

  const handleUseThisHead = useCallback(() => {
    const path = modelUsdz || modelGlb;
    if (!path) {
      Alert.alert('Still preparing', 'The 3D head is still downloading — one moment.');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLivePath(path);
    setMaskMode('model');
    setActiveMaskId(job?.jobId ?? 'model');
    setPhase('live');
  }, [modelUsdz, modelGlb, job]);

  const handleOpenAR = useCallback(async () => {
    const path = modelUsdz || modelGlb;
    if (!path) return Alert.alert('Not ready', 'The 3D head is still downloading.');
    try {
      await openARQuickLook(path);
    } catch (error) {
      Alert.alert('AR preview unavailable', error instanceof Error ? error.message : 'Try again.');
    }
  }, [modelUsdz, modelGlb]);

  const handleExport = useCallback(
    async (ext: 'usdz' | 'glb') => {
      const path = ext === 'usdz' ? modelUsdz : modelGlb;
      if (!path) return Alert.alert('Not ready', `The ${ext.toUpperCase()} is still downloading.`);
      try {
        if (!(await Sharing.isAvailableAsync())) {
          return Alert.alert('Saved', `Your ${ext.toUpperCase()} is cached on this device.`);
        }
        await Sharing.shareAsync(path, {
          mimeType: ext === 'usdz' ? 'model/vnd.usdz+zip' : 'model/gltf-binary',
          UTI: ext === 'usdz' ? 'com.pixar.universal-scene-description-mobile' : 'public.3d-content',
          dialogTitle: `Export ${ext.toUpperCase()} head`,
        });
      } catch (error) {
        Alert.alert('Export failed', error instanceof Error ? error.message : 'Try again.');
      }
    },
    [modelUsdz, modelGlb]
  );

  // ── Live puppet capture ───────────────────────────────────────────────────
  const handlePhoto = useCallback(async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const path = await faceViewRef.current?.snapshot();
      if (!path) throw new Error('No snapshot');
      await MediaLibrary.saveToLibraryAsync(path);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Photo failed', 'Could not save the snapshot.');
    }
  }, []);

  const handleRecordStart = useCallback(async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const started = await startScreenRecording(false);
      if (started.ok) setRecording(true);
    } catch { /* ignore */ }
  }, []);

  const handleRecordStop = useCallback(async () => {
    if (!recording) return;
    setRecording(false);
    try {
      const { ok, url } = await stopScreenRecording();
      if (ok && url) {
        await MediaLibrary.saveToLibraryAsync(url);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('🎬 Saved', 'Your emoji-face video was saved to Photos.');
      }
    } catch { /* ignore */ }
  }, [recording]);

  if (!everOpened) return null;

  if (!FaceFilterNativeView) {
    return (
      <View style={styles.overlay}>
        <View style={styles.centerPanel}>
          <Text style={styles.unsupportedText}>Face tracking is not available on this device.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const activeStageIdx = status ? stageIndex(status.stage) : -1;
  const progressPct = status ? Math.round(status.progress) : 0;
  const previewUri = status?.previewUrl || undefined;
  const likeness = status?.identityScore;

  // Building media: the backend's LIVE preview (current_preview_url advances
  // original → cutout → face-crop → stylized render) until the 3D stages, then
  // the live factory cam. Always prefer the server preview so the user actually
  // sees each step; fall back to their own photo only before the first frame.
  const buildMediaMode: 'image' | 'factory' = activeStageIdx >= MESH_IDX ? 'factory' : 'image';
  const factoryCam = (status && FACTORY_CAM_BY_STAGE[status.stage]) || 'printer';
  const buildMediaUri = previewUri || selfieUri || undefined;
  // Single CURRENT stage (icon + label) shown under the image — not the full list.
  const currentStage = activeStageIdx >= 0 ? BUILD_STAGES[activeStageIdx] : undefined;
  const currentStageText = currentStage
    ? `${currentStage.icon} ${currentStage.label}`
    : buildMediaMode === 'factory'
      ? '🏭 Building the 3D head…'
      : '📤 Uploading your photo…';

  return (
    <View
      style={[styles.overlay, !visible && { display: 'none' }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <FaceFilterNativeView
        // @ts-expect-error — expo-modules view ref exposes native AsyncFunctions
        ref={faceViewRef}
        style={StyleSheet.absoluteFill}
        paused={!visible}
        modelPath={maskMode === 'model' ? livePath : ''}
        maskMode={maskMode}
        paintEnabled={maskMode === 'grey' || maskMode === 'camera'}
        brushEmoji={brushEmoji}
        paintSizePx={paintSizePx}
        paintMode={brushSmudge ? 'smudge' : 'stamp'}
        smudgeStrength={0.8}
        paintTexturePath={greyPaintPath}
        cameraOverlayTexturePath={cameraOverlayPath}
        facePlaneEnabled={facePlane && (maskMode === 'grey' || maskMode === 'camera')}
        arkitMapping={ARKIT_RIG_MAPPING}
        onFacesChanged={(e) => setFaceCount(e.nativeEvent.count)}
        onArError={(e) => Alert.alert('Face tracking error', e.nativeEvent.message)}
      />

      {/* Top bar — AR Painting · Choose photo · close */}
      <View style={styles.topPanel}>
        {onSwitchToAr && phase !== 'building' && (
          <TouchableOpacity
            style={styles.pillButton}
            onPress={() => { void Haptics.selectionAsync(); onSwitchToAr(); }}
          >
            <Text style={styles.pillText}>🧱 AR Painting</Text>
          </TouchableOpacity>
        )}
        {(phase === 'intro' || phase === 'live') && maskMode !== 'model' && (
          <TouchableOpacity style={styles.pillButton} onPress={() => void handlePickPhoto()}>
            <Text style={styles.pillText}>📷 Photo</Text>
          </TouchableOpacity>
        )}
        {(phase === 'intro' || phase === 'live') && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => { void Haptics.selectionAsync(); setSettingsVisible(true); }}
            accessibilityLabel="Face settings"
          >
            <Text style={styles.iconButtonText}>⚙️</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }} />
        {recording && <Text style={styles.recDot}>🔴</Text>}
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => {
            // On the method-pick screen, ❎ returns to the face camera, not the
            // main 2D workspace.
            if (phase === 'method') { void Haptics.selectionAsync(); resetToIntro(); }
            else onClose();
          }}
          accessibilityLabel={phase === 'method' ? 'Back to camera' : 'Close'}
        >
          <Text style={styles.iconButtonText}>❎</Text>
        </TouchableOpacity>
      </View>

      {/* MAKE-A-NEW-HEAD circle — only on the "no filter" mask (🚫). Tap it to
          shoot a selfie and build the next 3D head. Hidden once any mask/mesh
          is worn so it never overlaps a filter. */}
      {(phase === 'intro' || phase === 'live') && maskMode === 'none' && (
        <View style={styles.captureCenter} pointerEvents="box-none">
          <TouchableOpacity style={styles.captureButton} onPress={() => void handleTakeSelfie()}>
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
        </View>
      )}

      {/* MASK PICKER — big swipeable panel of mask thumbnails (no text). Tap to
          wear. Defaults (none/grey/my-face) + every saved 3D head. */}
      {(phase === 'intro' || phase === 'live') && (
        <View style={styles.maskPanel} pointerEvents="box-none">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.maskPanelRow}
          >
            {/* default masks */}
            {([
              { id: 'none', kind: 'none' as const },
              { id: 'grey', kind: 'grey' as const },
              { id: 'camera', kind: 'camera' as const },
            ]).map((d) => (
              <TouchableOpacity
                key={d.id}
                style={[styles.maskTile, activeMaskId === d.id && styles.maskTileActive]}
                onPress={() => applyDefaultMask(d.kind)}
                onLongPress={() => handleMaskLongPress(d.kind)}
                activeOpacity={0.85}
              >
                {maskThumbs[d.id] ? (
                  <Image source={{ uri: maskThumbs[d.id] }} style={styles.maskTileImg} resizeMode="cover" />
                ) : (
                  <View style={[styles.maskTileInner, d.kind === 'grey' && { backgroundColor: '#b8b8b8' }]}>
                    <Text style={styles.maskTileGlyph}>
                      {d.kind === 'none' ? '🚫' : d.kind === 'grey' ? '🗿' : '🙂'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
            {/* saved 3D-head masks (snapshots) */}
            {savedMasks.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={[styles.maskTile, activeMaskId === m.id && styles.maskTileActive]}
                onPress={() => void applySavedMask(m)}
                onLongPress={() => handleMaskLongPress('saved', m)}
                activeOpacity={0.85}
              >
                {m.previewUri ? (
                  <Image source={{ uri: m.previewUri }} style={styles.maskTileImg} resizeMode="cover" />
                ) : (
                  <View style={styles.maskTileInner}>
                    <Text style={styles.maskTileGlyph}>🙂</Text>
                  </View>
                )}
                {/* "ready to load" badge so downloaded 3D heads read as distinct
                    from the live default masks. */}
                <View style={styles.maskReadyBadge}>
                  <Text style={styles.maskReadyBadgeText}>3D ✓</Text>
                </View>
              </TouchableOpacity>
            ))}
            {/* pending (handed-in) jobs — still building/downloading on the
                server. Shown as live loading tiles so you can leave and come
                back and still see where the job is. */}
            {pendingJobs.map((j) => {
              const prog = jobProgress[j.jobId];
              return (
                <View key={`pending-${j.jobId}`} style={[styles.maskTile, styles.maskTilePending]}>
                  <ActivityIndicator color="#ff9f6b" size="small" />
                  <Text style={styles.maskPendingText} numberOfLines={1}>
                    {prog ? `${prog.pct}%` : '…'}
                  </Text>
                  <Text style={styles.maskPendingSub} numberOfLines={1}>
                    {prog?.label ?? 'building'}
                  </Text>
                  <View style={[styles.maskReadyBadge, styles.maskPendingBadge]}>
                    <Text style={styles.maskReadyBadgeText}>⏳</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* PAINT TOOLS (top bar) — same for BOTH paintable masks (grey + camera): picked emoji + size
          slider + trash, anchored at the top so the layout matches across masks. */}
      {(phase === 'intro' || phase === 'live') && (maskMode === 'grey' || maskMode === 'camera') && (
        <View style={styles.paintBar} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.paintEmojiBubble}
            onPress={() => { void Haptics.selectionAsync(); setPickerVisible(true); }}
          >
            <Text style={{ fontSize: 24 }}>{brushEmoji}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.paintIconBtn, brushSmudge && { backgroundColor: '#ff9f6b' }]}
            onPress={() => { void Haptics.selectionAsync(); setBrushSmudge((v) => !v); }}
            accessibilityLabel="Toggle smudge brush"
          >
            <Text style={{ fontSize: 18 }}>🫳</Text>
          </TouchableOpacity>
          {/* Big face-tracked paint plane behind the mask (paint around your face). */}
          <TouchableOpacity
            style={[styles.paintIconBtn, facePlane && { backgroundColor: '#8b6dff' }]}
            onPress={() => { void Haptics.selectionAsync(); setFacePlane((v) => !v); }}
            accessibilityLabel="Toggle background paint plane"
          >
            <Text style={{ fontSize: 18 }}>🖼️</Text>
          </TouchableOpacity>
          <Slider
            style={styles.paintSlider}
            minimumValue={16}
            maximumValue={240}
            value={paintSizePx}
            onValueChange={setPaintSizePx}
            minimumTrackTintColor="#ff9f6b"
            maximumTrackTintColor="#444"
            thumbTintColor="#ff9f6b"
          />
          <TouchableOpacity style={styles.paintIconBtn} onPress={maskMode === 'camera' ? handleSdReset : clearGreyPaint}>
            <Text style={{ fontSize: 18 }}>🗑️</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SD RESTYLE — only on the textured (webcam) mask. The big ✨ Update
          button sits where the photo circle would be; Redo/Play/speed live in a
          compact row above it. Send the mapped face texture to Stable Diffusion,
          stamp the result back, and play the frames as a stop-motion loop. */}
      {(phase === 'intro' || phase === 'live') && maskMode === 'camera' && (
        <View style={styles.bottomCenter} pointerEvents="box-none">
          {/* Big ✨ Update button + a small fps slider tucked to its right. */}
          <View style={styles.sdGenRow}>
            <TouchableOpacity
              style={[styles.cameraButton, sdBusy && { opacity: 0.6 }]}
              disabled={sdBusy}
              onPress={() => void handleSdUpdate()}
            >
              {sdBusy ? (
                <ActivityIndicator color="#ff9f6b" size="large" />
              ) : (
                <Text style={{ fontSize: 30 }}>✨</Text>
              )}
            </TouchableOpacity>
            {sdFrames.length >= 1 && (
              <View style={styles.sdFpsMini}>
                <Text style={styles.sdFpsMiniLabel}>⏱ {sdFps}</Text>
                <Slider
                  style={{ width: 92, height: 26 }}
                  minimumValue={1}
                  maximumValue={30}
                  step={1}
                  value={sdFps}
                  onValueChange={setSdFps}
                  minimumTrackTintColor="#ff9f6b"
                  maximumTrackTintColor="#3a3a3a"
                  thumbTintColor="#ff9f6b"
                />
              </View>
            )}
          </View>
          <View style={styles.sdControlRow}>
            {/* Reshoot frame-0 as often as you like — fresh photo, no flash. */}
            <TouchableOpacity style={styles.paintIconBtn} onPress={handleRebakeFirst} accessibilityLabel="Reshoot first image">
              <Text style={{ fontSize: 18 }}>📸</Text>
            </TouchableOpacity>
            {/* Reset → drop restyle back to the original. */}
            <TouchableOpacity style={styles.paintIconBtn} onPress={handleSdReset} accessibilityLabel="Reset restyle">
              <Text style={{ fontSize: 18 }}>🔄</Text>
            </TouchableOpacity>
            {sdFrames.length >= 1 && (
              <>
                <TouchableOpacity style={styles.paintIconBtn} onPress={() => stepSd(-1)}>
                  <Text style={{ fontSize: 18 }}>◀️</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.paintIconBtn} onPress={toggleSdPlay}>
                  <Text style={{ fontSize: 18 }}>{sdPlaying ? '⏸' : '▶️'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.paintIconBtn} onPress={() => stepSd(1)}>
                  <Text style={{ fontSize: 18 }}>▶️</Text>
                </TouchableOpacity>
                {/* Stylize the frame currently on the mask. */}
                <TouchableOpacity style={[styles.paintIconBtn, sdBusy && { opacity: 0.5 }]} disabled={sdBusy} onPress={handleStylize} accessibilityLabel="Stylize this image">
                  <Text style={{ fontSize: 18 }}>🎭</Text>
                </TouchableOpacity>
              </>
            )}
            {sdFrames.length > 0 && (
              <View style={styles.sdCountBadge}>
                <Text style={styles.sdCountText}>{sdFrames.length}</Text>
              </View>
            )}
          </View>

          {/* Playback speed (native video) — only when there are frames. */}
          {/* Prompt field + Advanced toggle. */}
          <View style={styles.sdPromptRow}>
            <TextInput
              style={styles.sdPromptInput}
              value={sdPrompt}
              onChangeText={setSdPrompt}
              placeholder="Describe a style… (blank = auto)"
              placeholderTextColor="#888"
              returnKeyType="done"
            />
            <TouchableOpacity style={[styles.paintIconBtn, advancedOpen && { backgroundColor: '#ff9f6b' }]} onPress={() => { void Haptics.selectionAsync(); setAdvancedOpen((o) => !o); }} accessibilityLabel="Advanced SD options">
              <Text style={{ fontSize: 18 }}>⚙️</Text>
            </TouchableOpacity>
          </View>

          {/* Advanced panel — presets + denoise + cfg. Hidden by default. */}
          {advancedOpen && (
            <View style={styles.sdAdvancedPanel}>
              <View style={styles.sdPresetRow}>
                {SD_PRESETS.map((p) => (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.sdPresetChip, sdPresetKey === p.key && styles.sdPresetChipActive]}
                    onPress={() => pickPreset(p)}
                  >
                    <Text style={styles.sdPresetText}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.sdSpeedRow}>
                <Text style={styles.sdSpeedLabel}>🌀 Denoise {sdDenoise.toFixed(2)}</Text>
                <Slider
                  style={{ flex: 1, height: 30 }}
                  minimumValue={0.15}
                  maximumValue={0.85}
                  value={sdDenoise}
                  onValueChange={setSdDenoise}
                  minimumTrackTintColor="#8b6dff"
                  maximumTrackTintColor="#3a3a3a"
                  thumbTintColor="#8b6dff"
                />
              </View>
              <View style={styles.sdSpeedRow}>
                <Text style={styles.sdSpeedLabel}>🎚 CFG {sdCfg.toFixed(1)}</Text>
                <Slider
                  style={{ flex: 1, height: 30 }}
                  minimumValue={1}
                  maximumValue={15}
                  step={0.5}
                  value={sdCfg}
                  onValueChange={setSdCfg}
                  minimumTrackTintColor="#35d6c8"
                  maximumTrackTintColor="#3a3a3a"
                  thumbTintColor="#35d6c8"
                />
              </View>
            </View>
          )}
          {sdBusy && <Text style={styles.cameraHint}>restyling your face…</Text>}
        </View>
      )}

      {/* Full Brush Library picker — identical layout to the 2D workspace
          (last-picked, recents, mirror/rotate, spacing, search) + 🎨 ring. */}
      <EmojiPickerModal
        visible={pickerVisible}
        styles={emojiPickerStyles}
        emojiSearch={emojiSearch}
        onEmojiSearchChange={setEmojiSearch}
        recentEmojis={recentBrushes}
        brushEmoji={brushEmoji || '🙂'}
        emojiResults={faceEmojiResults}
        onSelectEmoji={handleFacePickEmoji}
        onClose={() => setPickerVisible(false)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        mirrorX={brushMirrorX}
        mirrorY={brushMirrorY}
        rotation={brushRotation}
        onToggleMirrorX={() => setBrushMirrorX((v) => !v)}
        onToggleMirrorY={() => setBrushMirrorY((v) => !v)}
        onTurnLeft={() => setBrushRotation((r) => (((r - 15) % 360) + 360) % 360)}
        onTurnRight={() => setBrushRotation((r) => (r + 15) % 360)}
      />

      {/* Settings sheet */}
      {settingsVisible && (
        <View style={styles.settingsOverlay} pointerEvents="auto">
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>⚙️ Face Settings</Text>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => { clearGreyPaint(); }}
            >
              <Text style={styles.settingsButtonText}>🗑 Clear painted grey mask</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => {
                Alert.alert('Delete all masks?', 'Removes every saved mask.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete all',
                    style: 'destructive',
                    onPress: () => { void saveMasks([]).then(() => setSavedMasks([])); },
                  },
                ]);
              }}
            >
              <Text style={styles.settingsButtonText}>🗑 Delete all saved masks</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.settingsButton, styles.settingsClose]} onPress={() => setSettingsVisible(false)}>
              <Text style={[styles.settingsButtonText, { color: '#000' }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* METHOD PICK — after the photo: choose how to build the 3D head */}
      {phase === 'method' && (
        <View style={styles.methodOverlay} pointerEvents="auto">
          {selfieUri ? (
            <Image source={{ uri: selfieUri }} style={styles.methodPhoto} resizeMode="cover" />
          ) : null}
          <Text style={styles.methodTitle}>How should we build your 3D head?</Text>
          <View style={styles.methodList}>
            {(methods.length > 0 ? methods : [{ id: '', label: 'Default', available: true, isDefault: true }]).map((m) => (
              <TouchableOpacity
                key={m.id || 'default'}
                style={styles.methodButton}
                onPress={() => startWithMethod(m.id)}
              >
                <Text style={styles.methodButtonText}>{m.label}</Text>
                <Text style={styles.methodButtonChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.linkPill} onPress={resetToIntro}>
            <Text style={styles.linkPillText}>‹ Retake photo</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* BUILDING — your photo → SD render → live factory cam, with timeline */}
      {phase === 'building' && (
        <View style={styles.buildOverlay} pointerEvents="auto">
          {/* Exit to the 2D paint scene, or back to the face camera, anytime */}
          <View style={styles.buildTopRow}>
            <TouchableOpacity
              style={styles.pillButton}
              onPress={() => { void Haptics.selectionAsync(); resetToIntro(); }}
            >
              <Text style={styles.pillText}>‹ Camera</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.pillButton}
              onPress={() => { void Haptics.selectionAsync(); runIdRef.current += 1; onClose(); }}
            >
              <Text style={styles.pillText}>✕ Exit to canvas</Text>
            </TouchableOpacity>
          </View>
          {/* BIG media stage — factory feed preloaded from the start; the live
              backend preview image sits on top until the 3D stages arrive. */}
          <View style={styles.buildMediaAreaBig}>
            <FactoryFeed cam={factoryCam} height={340} borderRadius={20} />
            {buildMediaMode !== 'factory' && (
              <View style={styles.mediaImageOverlay}>
                {buildMediaUri ? (
                  <Image source={{ uri: buildMediaUri }} style={styles.mediaImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.mediaImage, styles.previewPlaceholder]}>
                    <ActivityIndicator color="#ff9f6b" size="large" />
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Loader UNDER the image — only the CURRENT stage, not the whole list */}
          <View style={styles.stageLoader}>
            <ActivityIndicator color="#ff9f6b" size="small" />
            <Text style={styles.stageLabel}>{currentStageText}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(3, progressPct)}%` }]} />
          </View>
          <Text style={styles.loaderNote}>{progressPct}%</Text>
        </View>
      )}

      {/* LIVE puppet — capture only (no result / retake; make a new head from
          the 🚫 "no filter" circle instead). Hidden on "no filter" (make-new
          circle) and "camera" (SD ✨ Update button takes the spot). */}
      {phase === 'live' && maskMode !== 'none' && maskMode !== 'camera' && (
        <View style={styles.bottomCenter} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.cameraButton, recording && styles.cameraButtonRecording]}
            onPress={() => void handlePhoto()}
            onLongPress={() => void handleRecordStart()}
            onPressOut={() => void handleRecordStop()}
            delayLongPress={350}
          >
            <View style={[styles.cameraButtonInner, recording && styles.cameraButtonInnerRecording]} />
          </TouchableOpacity>
          <Text style={styles.cameraHint}>
            {faceCount > 0 ? 'tap photo · hold film' : 'look at the camera to bring your emoji to life'}
          </Text>
        </View>
      )}

      {/* ERROR */}
      {phase === 'error' && (
        <View style={styles.resultOverlay} pointerEvents="auto">
          <View style={styles.errorCenter}>
            <Text style={styles.errorEmoji}>😵</Text>
            <Text style={styles.resultTitle}>Couldn’t build your emoji</Text>
            <Text style={styles.buildMessage}>{errorText}</Text>
            {/* Reliable primary: back to the live face camera to take a fresh shot */}
            <TouchableOpacity style={[styles.resultButton, styles.primaryResult]} onPress={resetToIntro}>
              <Text style={[styles.resultButtonText, { color: '#000' }]}>📷 Back to Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resultButton} onPress={() => void handlePickPhoto()}>
              <Text style={styles.resultButtonText}>🖼️ Choose a Different Photo</Text>
            </TouchableOpacity>
            {job && (
              <TouchableOpacity
                style={[styles.resultButton, busyAction === 'retry' && { opacity: 0.5 }]}
                disabled={busyAction === 'retry'}
                onPress={() => void handleRetry()}
              >
                <Text style={styles.resultButtonText}>🔄 Try Again (same photo)</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.linkPill} onPress={() => { runIdRef.current += 1; onClose(); }}>
              <Text style={styles.linkPillText}>✕ Exit to canvas</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 12000 },
  topPanel: {
    position: 'absolute',
    top: 54,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 30,
  },
  recDot: { fontSize: 14, marginRight: 4 },
  pillButton: {
    backgroundColor: 'rgba(10,10,10,0.72)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  pillText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  iconButton: {
    backgroundColor: 'rgba(10,10,10,0.72)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  iconButtonText: { fontSize: 18 },

  bottomCenter: {
    position: 'absolute',
    bottom: 150,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 10,
  },
  introHint: { color: '#fff', fontSize: 16, fontWeight: '700' },
  introSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5 },
  captureButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 5,
    borderColor: '#ff9f6b',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,159,107,0.18)',
  },
  captureButtonInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#ff9f6b' },
  linkPill: { paddingVertical: 8, paddingHorizontal: 14 },
  linkPillText: { color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: '600' },
  // Capture button sits above the mask panel
  captureCenter: { position: 'absolute', bottom: 150, left: 0, right: 0, alignItems: 'center' },
  // Paint-on-grey-mask tool bar (top, under the top bar)
  paintBar: {
    position: 'absolute',
    top: 100,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(10,10,10,0.72)',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  paintToggle: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  paintToggleOn: { backgroundColor: '#ff9f6b' },
  paintToggleText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  paintEmojiBubble: {
    backgroundColor: '#2d2d2d',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  paintSlider: { flex: 1, height: 30 },
  // Settings sheet
  settingsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  settingsCard: {
    width: '84%',
    maxWidth: 420,
    backgroundColor: 'rgba(20,20,22,0.98)',
    borderRadius: 22,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  settingsTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  settingsButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  settingsClose: { backgroundColor: '#ff9f6b', borderColor: '#ff9f6b' },
  settingsButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  paintIconBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  // Big swipeable mask-picker panel (thumbnails only, no text)
  maskPanel: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    height: 116,
    backgroundColor: 'rgba(8,8,10,0.78)',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  maskPanelRow: { gap: 10, paddingHorizontal: 14, alignItems: 'center' },
  maskTile: {
    width: 88,
    height: 88,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: '#111',
  },
  maskTileActive: { borderColor: '#ff9f6b', borderWidth: 3 },
  maskTileInner: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a' },
  maskTileImg: { width: '100%', height: '100%' },
  maskTileGlyph: { fontSize: 40 },
  maskReadyBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(74,222,128,0.92)',
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  maskReadyBadgeText: { color: '#06210f', fontSize: 10, fontWeight: '800' },
  maskTilePending: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    gap: 3,
  },
  maskPendingText: { color: '#ff9f6b', fontSize: 14, fontWeight: '800' },
  maskPendingSub: { color: '#888', fontSize: 9, paddingHorizontal: 4 },
  maskPendingBadge: { backgroundColor: 'rgba(255,159,107,0.92)' },
  sdControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sdCountBadge: {
    backgroundColor: '#ff9f6b',
    borderRadius: 11,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  sdCountText: { color: '#06210f', fontSize: 12, fontWeight: '800' },
  sdSpeedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    paddingHorizontal: 14,
    width: 320,
    maxWidth: '92%',
  },
  sdSpeedLabel: { color: '#fff', fontSize: 12, fontWeight: '700', width: 96 },
  sdGenRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sdFpsMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sdFpsMiniLabel: { color: '#fff', fontSize: 11, fontWeight: '700' },
  sdPromptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    width: 320,
    maxWidth: '92%',
  },
  sdPromptInput: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  sdAdvancedPanel: {
    width: 320,
    maxWidth: '92%',
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(10,10,10,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(139,109,255,0.4)',
    marginBottom: 10,
    gap: 4,
  },
  sdPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  sdPresetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  sdPresetChipActive: { backgroundColor: '#8b6dff', borderColor: '#8b6dff' },
  sdPresetText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  // Default-mask chips (under the photo button)
  maskChipRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  maskChip: {
    backgroundColor: 'rgba(10,10,10,0.7)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  maskChipActive: { backgroundColor: '#ff9f6b', borderColor: '#ff9f6b' },
  maskChipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  maskChipTextActive: { color: '#000' },
  // Saved-mask horizontal slider (bottom)
  maskSlider: {
    position: 'absolute',
    bottom: 168,
    left: 0,
    right: 0,
  },
  maskSliderRow: { gap: 8, paddingHorizontal: 14 },
  maskThumb: {
    width: 58,
    height: 58,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: '#111',
  },
  maskThumbActive: { borderColor: '#ff9f6b' },
  maskThumbImg: { width: '100%', height: '100%' },
  maskThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  methodRow: { gap: 8, paddingHorizontal: 16, paddingTop: 2 },
  methodPill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  methodPillActive: { backgroundColor: '#ff9f6b', borderColor: '#ff9f6b' },
  methodPillText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  methodPillTextActive: { color: '#000' },

  liveRow: { flexDirection: 'row', gap: 10 },
  cameraButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  cameraButtonRecording: { borderColor: '#ff3b30' },
  cameraButtonInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  cameraButtonInnerRecording: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#ff3b30' },
  cameraHint: { color: 'rgba(255,255,255,0.7)', fontSize: 11 },

  // Building
  buildOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,6,8,0.94)',
    alignItems: 'center',
    paddingTop: 110,
    paddingHorizontal: 24,
    gap: 12,
  },
  buildTopRow: {
    position: 'absolute',
    top: 54,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 40,
  },
  buildTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  buildMediaArea: {
    width: '100%',
    height: 224,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  buildMediaAreaBig: {
    width: '100%',
    height: 340,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  stageLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  stageLabel: { color: '#fff', fontSize: 16, fontWeight: '800' },
  // Method-pick screen (after the photo)
  methodOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,6,8,0.96)',
    alignItems: 'center',
    paddingTop: 96,
    paddingHorizontal: 24,
    gap: 14,
    zIndex: 22,
  },
  methodPhoto: {
    width: 130,
    height: 130,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,159,107,0.6)',
  },
  methodTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  methodList: { alignSelf: 'stretch', gap: 10, marginTop: 2 },
  methodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  methodButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  methodButtonChevron: { color: 'rgba(255,255,255,0.5)', fontSize: 22, fontWeight: '700' },
  mediaImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  mediaImage: { width: '100%', height: '100%' },
  mediaBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingVertical: 6,
  },
  mediaBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  factoryWrap: { alignSelf: 'stretch', gap: 6 },
  factoryCaption: { color: 'rgba(206,147,216,0.9)', fontSize: 11, textAlign: 'center', fontWeight: '600' },
  previewPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  buildMessage: { color: 'rgba(255,255,255,0.8)', fontSize: 13.5, textAlign: 'center' },
  styleChip: { color: '#ff9f6b', fontSize: 12, fontWeight: '700' },
  timeline: { alignSelf: 'stretch', maxHeight: 200, marginTop: 2 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
  timelineIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  timelineLabel: { color: '#eee', fontSize: 14, flex: 1 },
  progressTrack: {
    width: '88%',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: '#ff9f6b' },
  loaderNote: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },

  // Result
  resultOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,6,8,0.96)', zIndex: 25 },
  resultContent: { paddingTop: 100, paddingHorizontal: 22, paddingBottom: 40, alignItems: 'center', gap: 12 },
  resultTitle: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  resultPreview: {
    width: 220,
    height: 220,
    borderRadius: 24,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  likenessRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  likenessLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  likenessValue: { color: '#7CFC8A', fontSize: 26, fontWeight: '900' },
  resultButton: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  primaryResult: { backgroundColor: '#ff9f6b', borderColor: '#ff9f6b' },
  resultButtonRow: { flexDirection: 'row', alignSelf: 'stretch', gap: 10 },
  halfButton: { flex: 1 },
  resultButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  errorCenter: { flex: 1, justifyContent: 'center', paddingHorizontal: 26, gap: 12 },
  errorEmoji: { fontSize: 52, textAlign: 'center' },

  centerPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 16 },
  unsupportedText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  primaryButton: { backgroundColor: '#ff9f6b', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 30, marginTop: 8 },
  primaryButtonText: { color: '#000', fontSize: 15, fontWeight: '800' },
});

export default FaceMeshOverlay;
