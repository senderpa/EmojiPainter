/**
 * ProfileStudioScreen — the Profil Studio as its OWN navigation screen.
 *
 * Pushed directly on top of ProfilePage ("🎨 Paint Profile"); completely
 * independent from PaintScreen: no route params into the monolith, no modal,
 * no shared painting context, no interference from PaintScreen's startup /
 * autosave / challenge effects. Close or Upload always returns straight to
 * the ProfilePage below.
 *
 * - Loads the last portrait from local storage (PRIVATE_STUDIO_STORAGE_KEY
 *   strokes; falls back to the rendered passport image as background).
 * - Top tools only: emoji brush, undo, redo, clear, size slider.
 * - Bottom: brush size/mode controls + 📤 Upload (renders → saves locally →
 *   uploads to server → back to ProfilePage with the new portrait).
 * - Autosaves silently to the SAME storage payload the old studio used.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  PanResponder,
  Platform,
  SafeAreaView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import { StackActions } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';

import { AppText as Text } from '../emoji/AppText';
import PaintCanvas from '../workspace/PaintCanvas';
import BrushControls from '../workspace/BrushControls';
import WorkspaceToolbar from '../workspace/WorkspaceToolbar';
import EmojiPickerModal from '../workspace/EmojiPickerModal';
import emojiPickerStyles from '../workspace/emojiPickerStyles';
import sharedWorkspaceStyles from '../workspace/sharedWorkspaceStyles';
import { renderableEmojiEntries, searchRenderableEmojis } from '../lib/emojiCatalog';
import { BRUSH_ROTATION_STEP, LARGE_HIT_SLOP } from '../lib/paintConstants';
import { getCustomBrushPNGData, isCustomBrushReference } from '../lib/customBrushRegistry';
import type { BrushMode, Stroke, TraceState } from '../state/PaintingContext';
import type { StoredPaintingState } from '../types/storedPainting';
import {
  PASSPORT_PORTRAIT_STORAGE_KEY,
  PRIVATE_STUDIO_STORAGE_KEY,
} from '../lib/paintConstants';
import {
  PROFILE_DISPLAY_NAME_STORAGE_KEY,
  fetchServerProfileSnapshot,
  markServerProfileSynced,
  persistProfileDisplayNameLocally,
  syncServerProfileState,
} from '../lib/profileSync';
import { uploadPrivateStudioPassport } from '../lib/privateStudio';
import { ensureDeviceId } from '../lib/dailyPaintUpload';
import { renderPassportBase64 } from '../lib/passportRender';
import { flushLifetimeActivity } from '../lib/lifetimeActivity';
import { getLifetimeStats, recordLifetimeStrokeCommit } from '../lib/lifetimeStats';
import { useLifetimeActivity } from '../lib/useLifetimeActivity';
import {
  backgroundToPersist,
  flattenAfterUpload,
  isUsablePassport,
  normalizeStudioBrushRotation,
  resolveStudioBrushTransform,
  resolveStudioSeed,
} from './profileStudioSession';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;
// SAME formula as PaintScreen so stored stroke coordinates stay compatible
// between this screen and the legacy in-PaintScreen studio modal.
const CANVAS_SIZE = Math.min(screenWidth, screenHeight * 0.85) * (IS_IPAD ? 0.8 : 1);
const NAME_MAX = 19;
// Matches resolveResampleSpacing()'s effective step (~0.11 x size) so the live
// preview and the committed render place stamps at the same density.
const LIVE_POINT_SPACING_RATIO = 0.1;
const MAX_LIVE_INTERPOLATED_POINTS = 24;
const DEFAULT_STROKE_SPACING = 0.12;
const DEFAULT_SMUDGE_STRENGTH = 0.82;
const DEFAULT_SMUDGE_SMOOTHNESS = 0.5;
const AUTOSAVE_DELAY_MS = 1200;
const BRUSH_OPTIONS_HIDE_MS = 3000;
const UPLOAD_SUCCESS_HOLD_MS = 850;

const EMPTY_TRACE: TraceState = {
  imageUri: null, scale: 1, offsetX: 0, offsetY: 0, opacity: 0.3, rotation: 0, isBackground: false,
};

interface PersistedStudioState {
  name: string;
  elapsedMs: number;
  strokeCount: number;
  painting: StoredPaintingState;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
const ProfileStudioScreen: React.FC<any> = ({ route, navigation }) => {
  useLifetimeActivity('profile-studio');
  const deviceIdParam: string | undefined = route.params?.deviceId;
  // Seeded by ProfilePage from the profile it already fetched, so a second
  // device opens the real profile instead of a blank new one.
  const seedPortraitParam: string | null = route.params?.seedPortrait ?? null;
  const seedNameParam: string | null = route.params?.seedName ?? null;

  const [loading, setLoading] = useState(true);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [brushEmoji, setBrushEmoji] = useState('🎨');
  const [brushSize, setBrushSize] = useState(48);
  const [sizeInput, setSizeInput] = useState('48');
  const [brushMode, setBrushMode] = useState<BrushMode>('opaque');
  const [smudgeSmoothness, setSmudgeSmoothness] = useState(DEFAULT_SMUDGE_SMOOTHNESS);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [brushRotation, setBrushRotation] = useState(0);
  const [brushOptionsVisible, setBrushOptionsVisible] = useState(false);
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  const [autoRotateDirection, setAutoRotateDirection] = useState<'left' | 'right' | null>(null);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [backgroundUri, setBackgroundUri] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadSucceeded, setUploadSucceeded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const liveStrokeRef = useRef<Stroke | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const drawingRef = useRef(false);
  const shotRef = useRef<View>(null);
  const elapsedBaseRef = useRef(0);
  const mountedAtRef = useRef(Date.now());
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brushOptionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  // Live copies for save-on-unmount without effect churn
  const stateRef = useRef({ strokes, name, brushEmoji, brushSize, brushMode, smudgeSmoothness, mirrorX, mirrorY, brushRotation, recentEmojis, backgroundUri });
  stateRef.current = { strokes, name, brushEmoji, brushSize, brushMode, smudgeSmoothness, mirrorX, mirrorY, brushRotation, recentEmojis, backgroundUri };
  const brushRef = useRef({ emoji: brushEmoji, size: brushSize, mode: brushMode, smudgeSmoothness, mirrorX, mirrorY, rotation: brushRotation });
  brushRef.current = { emoji: brushEmoji, size: brushSize, mode: brushMode, smudgeSmoothness, mirrorX, mirrorY, rotation: brushRotation };
  // Authoritative state after an upload flattens the canvas. `stateRef` is only
  // refreshed on render, and upload navigates away immediately — so the
  // save-on-unmount could otherwise write the PRE-flatten strokes back over the
  // flattened state and the next visit would show the old portrait again.
  const persistOverrideRef = useRef<Partial<{ strokes: Stroke[]; backgroundUri: string | null; name: string }> | null>(null);
  // Ordered fallbacks for the paint-over image, and the last one known to work.
  // A dead file:// path (container UUID changed on reinstall) or a 404 server
  // URL must fall through instead of leaving an empty canvas.
  const backgroundCandidatesRef = useRef<string[]>([]);
  const lastGoodBackgroundRef = useRef<string | null>(null);

  // ── Load the last local portrait state ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [storedRaw, storedName, portrait] = await Promise.all([
          AsyncStorage.getItem(PRIVATE_STUDIO_STORAGE_KEY),
          AsyncStorage.getItem(PROFILE_DISPLAY_NAME_STORAGE_KEY),
          AsyncStorage.getItem(PASSPORT_PORTRAIT_STORAGE_KEY),
        ]);
        if (cancelled) return;
        let loadedStrokes: Stroke[] = [];
        let loadedTraceUri: string | null = null;
        let studioName: string | null = null;
        if (storedRaw) {
          try {
            const parsed = JSON.parse(storedRaw) as PersistedStudioState;
            loadedStrokes = Array.isArray(parsed.painting?.strokes) ? parsed.painting.strokes : [];
            loadedTraceUri = parsed.painting?.trace?.imageUri ?? null;
            elapsedBaseRef.current = typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : 0;
            if (parsed.painting?.brushEmoji) setBrushEmoji(parsed.painting.brushEmoji);
            if (typeof parsed.painting?.brushSize === 'number') {
              const loadedSize = Math.max(8, Math.min(160, parsed.painting.brushSize));
              setBrushSize(loadedSize);
              setSizeInput(String(loadedSize));
            }
            if (parsed.painting?.brushMode === 'opaque' || parsed.painting?.brushMode === 'transparent' || parsed.painting?.brushMode === 'smudge') {
              setBrushMode(parsed.painting.brushMode);
            }
            if (typeof parsed.painting?.smudgeSmoothness === 'number') {
              setSmudgeSmoothness(Math.max(0, Math.min(1, parsed.painting.smudgeSmoothness)));
            }
            const loadedTransform = resolveStudioBrushTransform({
              mirrorX: parsed.painting?.mirrorX,
              mirrorY: parsed.painting?.mirrorY,
              rotation: parsed.painting?.brushRotation,
            });
            setMirrorX(loadedTransform.mirrorX);
            setMirrorY(loadedTransform.mirrorY);
            setBrushRotation(loadedTransform.rotation);
            if (Array.isArray(parsed.painting?.recentEmojis)) setRecentEmojis(parsed.painting.recentEmojis);
            studioName = parsed.name ?? null;
          } catch (error) {
            console.warn('[ProfileStudio] Corrupt stored state — starting fresh:', error);
          }
        }
        setStrokes(loadedStrokes);

        // The server snapshot is only worth fetching when nothing local or
        // handed-over can seed us (second device, or a fresh reinstall).
        const needsServer = !loadedTraceUri && !portrait && !seedPortraitParam && Boolean(deviceIdParam);
        const snapshot = needsServer
          ? await fetchServerProfileSnapshot(deviceIdParam as string).catch(() => null)
          : null;
        if (cancelled) return;

        // Single source of truth for the precedence — see profileStudioSession,
        // which is unit-tested across the whole open → upload → reopen cycle.
        const seed = resolveStudioSeed({
          localTraceUri: loadedTraceUri,
          localPortrait: portrait,
          localStudioName: studioName,
          localDisplayName: storedName,
          routePortrait: seedPortraitParam,
          routeName: seedNameParam,
          serverPortrait: snapshot?.latestPortrait ?? null,
          serverName: snapshot?.name ?? null,
        }, NAME_MAX);

        backgroundCandidatesRef.current = seed.candidates;
        if (seed.background) lastGoodBackgroundRef.current = seed.background;
        setBackgroundUri(seed.background);
        if (seed.name) setName(seed.name);
        console.log(
          '[ProfileStudio] Loaded:', loadedStrokes.length, 'strokes, background:',
          Boolean(seed.background), `(${seed.source})`, '| candidates:', seed.candidates.length,
          '| name:', seed.name || '(none)'
        );
      } catch (error) {
        console.warn('[ProfileStudio] Load failed — starting fresh:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Persistence (same payload shape as the legacy studio) ─────────────────
  const buildPersistPayload = useCallback((
    // setState is async, so callers that must persist values they just set
    // (the post-upload flatten) pass them explicitly rather than racing stateRef.
    overrides?: Partial<{ strokes: Stroke[]; backgroundUri: string | null; name: string }>
  ): PersistedStudioState => {
    const s = { ...stateRef.current, ...(persistOverrideRef.current ?? {}), ...overrides };
    const painting: StoredPaintingState = {
      strokes: s.strokes,
      brushEmoji: s.brushEmoji,
      brushSize: s.brushSize,
      brushMode: s.brushMode,
      smudgeSmoothness: s.smudgeSmoothness,
      brushOpacity: 1,
      brushSpacing: 0.3,
      brushRotation: normalizeStudioBrushRotation(s.brushRotation),
      mirrorX: s.mirrorX,
      mirrorY: s.mirrorY,
      recentEmojis: s.recentEmojis,
      trace: (() => {
        const background = backgroundToPersist(s.backgroundUri, lastGoodBackgroundRef.current);
        return background
          ? { ...EMPTY_TRACE, imageUri: background, opacity: 1, isBackground: true }
          : { ...EMPTY_TRACE };
      })(),
    };
    return {
      name: s.name.trim().length > 0 ? s.name.trim().slice(0, NAME_MAX) : 'Anonymous',
      elapsedMs: elapsedBaseRef.current + (Date.now() - mountedAtRef.current),
      strokeCount: s.strokes.length,
      painting,
      updatedAt: new Date().toISOString(),
    };
  }, []);

  const persistNow = useCallback(async (
    overrides?: Partial<{ strokes: Stroke[]; backgroundUri: string | null; name: string }>
  ) => {
    try {
      const payload = buildPersistPayload(overrides);
      await AsyncStorage.setItem(PRIVATE_STUDIO_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('[ProfileStudio] Autosave failed:', error);
    }
  }, [buildPersistPayload]);

  useEffect(() => {
    if (loading) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistNow();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [backgroundUri, brushEmoji, brushMode, brushRotation, brushSize, loading, mirrorX, mirrorY, name, persistNow, recentEmojis, smudgeSmoothness, strokes]);

  // Save on unmount (covers swipe-back too)
  useEffect(() => () => {
    void persistNow();
  }, [persistNow]);

  useEffect(() => () => {
    if (brushOptionsTimerRef.current) clearTimeout(brushOptionsTimerRef.current);
  }, []);

  // Match the main workspace: long-press rotate turns slowly between strokes,
  // and pauses while the finger is painting so one stroke never twists midway.
  useEffect(() => {
    if (!autoRotateEnabled || !autoRotateDirection) return;
    const step = autoRotateDirection === 'left' ? -15 : 15;
    const timer = setInterval(() => {
      if (!drawingRef.current) {
        setBrushRotation((current) => normalizeStudioBrushRotation(current + step));
      }
    }, 250);
    return () => clearInterval(timer);
  }, [autoRotateDirection, autoRotateEnabled]);

  // ── Drawing ───────────────────────────────────────────────────────────────
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      const transform = resolveStudioBrushTransform(brushRef.current);
      const stroke: Stroke = {
        id: `ps_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        emoji: brushRef.current.emoji,
        size: brushRef.current.size,
        opacity: brushRef.current.mode === 'transparent' ? 0.01 : 1,
        spacing: DEFAULT_STROKE_SPACING,
        rotation: transform.rotation,
        mirrorX: transform.mirrorX,
        mirrorY: transform.mirrorY,
        ...(brushRef.current.mode === 'smudge' ? {
          isSmudge: true,
          smudgeStrength: DEFAULT_SMUDGE_STRENGTH,
          edgeBlendStrength: brushRef.current.smudgeSmoothness,
        } : {}),
        points: [{ x: locationX, y: locationY, t: Date.now() }],
      } as Stroke;
      liveStrokeRef.current = stroke;
      drawingRef.current = true;
      lastPointRef.current = { x: locationX, y: locationY };
      setLiveStroke(stroke);
    },
    onPanResponderMove: (event) => {
      if (!drawingRef.current || !liveStrokeRef.current) return;
      const { locationX, locationY } = event.nativeEvent;
      const last = lastPointRef.current;
      // The live preview resampler only DOWN-samples (adaptiveResamplePoints),
      // while the committed render fills gaps in (interpolateStrokePoints). So
      // a coarse gate here — the old `size * 0.3` — produced a jagged preview
      // that snapped smooth on release. Feed dense points, matching the normal
      // workspace, so what you see while drawing is what you get.
      const step = Math.max(1, brushRef.current.size * LIVE_POINT_SPACING_RATIO);
      const added: { x: number; y: number; t: number }[] = [];
      if (last) {
        const dx = locationX - last.x;
        const dy = locationY - last.y;
        const distance = Math.hypot(dx, dy);
        if (distance < step) return;
        // Interpolate along the segment so fast drags stay smooth too.
        const count = Math.min(MAX_LIVE_INTERPOLATED_POINTS, Math.floor(distance / step));
        const now = Date.now();
        for (let i = 1; i <= count; i += 1) {
          const ratio = (i * step) / distance;
          if (ratio >= 1) break;
          added.push({ x: last.x + dx * ratio, y: last.y + dy * ratio, t: now });
        }
      }
      added.push({ x: locationX, y: locationY, t: Date.now() });
      liveStrokeRef.current = {
        ...liveStrokeRef.current,
        points: [...liveStrokeRef.current.points, ...added],
      };
      lastPointRef.current = { x: locationX, y: locationY };
      setLiveStroke(liveStrokeRef.current);
    },
    onPanResponderRelease: () => {
      const stroke = liveStrokeRef.current;
      drawingRef.current = false;
      liveStrokeRef.current = null;
      lastPointRef.current = null;
      setLiveStroke(null);
      if (stroke && stroke.points.length > 0) {
        void recordLifetimeStrokeCommit({
          eventId: `profile-studio:${stroke.id}`,
          workspace: 'profile-studio',
        });
        setStrokes((current) => [...current, stroke]);
        setRedoStack([]);
      }
    },
    onPanResponderTerminate: () => {
      drawingRef.current = false;
      liveStrokeRef.current = null;
      lastPointRef.current = null;
      setLiveStroke(null);
    },
  }), []);

  const undo = useCallback(() => {
    setStrokes((current) => {
      if (current.length === 0) return current;
      const last = current[current.length - 1];
      setRedoStack((redo) => [...redo, last]);
      return current.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((redoValues) => {
      if (redoValues.length === 0) return redoValues;
      const last = redoValues[redoValues.length - 1];
      setStrokes((current) => [...current, last]);
      return redoValues.slice(0, -1);
    });
  }, []);

  /**
   * The paint-over image failed to load. Rather than leave an empty canvas —
   * which is never acceptable when we know a portrait exists — drop to the next
   * candidate (local file → saved passport → the profile page's → the server's).
   */
  const handleBackgroundLoadError = useCallback((failedUri: string | null) => {
    const remaining = backgroundCandidatesRef.current.filter((candidate) => candidate !== failedUri);
    backgroundCandidatesRef.current = remaining;
    const next = remaining[0] ?? null;
    console.warn(
      '[ProfileStudio] background failed to load:', failedUri?.slice(0, 60),
      '→ falling back to', next ? next.slice(0, 60) : 'NOTHING LEFT'
    );
    if (lastGoodBackgroundRef.current === failedUri) lastGoodBackgroundRef.current = null;
    setBackgroundUri(next);
  }, []);

  const clearAll = useCallback(() => {
    setStrokes((current) => {
      if (current.length > 0) setRedoStack((redoValues) => [...redoValues, ...current]);
      return [];
    });
  }, []);

  const selectEmoji = useCallback((emoji: string) => {
    if (typeof emoji !== 'string') return;
    setBrushEmoji(emoji);
    if (emoji.length === 0) {
      setBrushMode('transparent');
    } else {
      setRecentEmojis((current) => [emoji, ...current.filter((e) => e !== emoji)].slice(0, 12));
    }
    setPickerVisible(false);
  }, []);

  const resetBrushOptionsTimer = useCallback(() => {
    if (brushOptionsTimerRef.current) clearTimeout(brushOptionsTimerRef.current);
    brushOptionsTimerRef.current = setTimeout(() => {
      brushOptionsTimerRef.current = null;
      setBrushOptionsVisible(false);
    }, BRUSH_OPTIONS_HIDE_MS);
  }, []);

  const toggleBrushOptions = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    const next = !brushOptionsVisible;
    setBrushOptionsVisible(next);
    if (next) resetBrushOptionsTimer();
    else if (brushOptionsTimerRef.current) {
      clearTimeout(brushOptionsTimerRef.current);
      brushOptionsTimerRef.current = null;
    }
  }, [brushOptionsVisible, resetBrushOptionsTimer]);

  const toggleMirrorX = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    setMirrorX((value) => !value);
    resetBrushOptionsTimer();
  }, [resetBrushOptionsTimer]);

  const toggleMirrorY = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    setMirrorY((value) => !value);
    resetBrushOptionsTimer();
  }, [resetBrushOptionsTimer]);

  const rotateBrush = useCallback((direction: 'left' | 'right') => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (autoRotateEnabled && autoRotateDirection === direction) {
      setAutoRotateEnabled(false);
      setAutoRotateDirection(null);
    } else {
      const delta = direction === 'left' ? -BRUSH_ROTATION_STEP : BRUSH_ROTATION_STEP;
      setBrushRotation((value) => normalizeStudioBrushRotation(value + delta));
    }
    resetBrushOptionsTimer();
  }, [autoRotateDirection, autoRotateEnabled, resetBrushOptionsTimer]);

  const toggleAutoRotate = useCallback((direction: 'left' | 'right') => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    const turningOff = autoRotateEnabled && autoRotateDirection === direction;
    setAutoRotateEnabled(!turningOff);
    setAutoRotateDirection(turningOff ? null : direction);
    resetBrushOptionsTimer();
  }, [autoRotateDirection, autoRotateEnabled, resetBrushOptionsTimer]);

  const selectRecentEmoji = useCallback(async (emoji: string) => {
    if (isCustomBrushReference(emoji)) {
      try {
        await getCustomBrushPNGData(emoji);
      } catch (error) {
        console.warn('[ProfileStudio] Could not preload recent custom brush:', error);
      }
    }
    setBrushEmoji(emoji);
    setRecentEmojis((current) => [emoji, ...current.filter((entry) => entry !== emoji)].slice(0, 12));
    resetBrushOptionsTimer();
  }, [resetBrushOptionsTimer]);

  const handleBrushSizeChange = useCallback((value: number) => {
    const next = Math.max(8, Math.min(160, Math.round(value)));
    setBrushSize(next);
    setSizeInput(String(next));
  }, []);

  const handleSizeInputChange = useCallback((value: string) => {
    setSizeInput(value.replace(/[^0-9]/g, '').slice(0, 3));
  }, []);

  const commitSizeInput = useCallback(() => {
    const parsed = Number(sizeInput);
    const next = Number.isFinite(parsed) && parsed > 0
      ? Math.max(8, Math.min(160, Math.round(parsed)))
      : brushSize;
    setBrushSize(next);
    setSizeInput(String(next));
  }, [brushSize, sizeInput]);

  const toggleBrushMode = useCallback(() => {
    setBrushMode((current) => current === 'opaque' ? 'transparent' : current === 'transparent' ? 'smudge' : 'opaque');
  }, []);

  const emojiResults = useMemo(
    () => (emojiSearch.trim().length > 0 ? searchRenderableEmojis(emojiSearch) : renderableEmojiEntries),
    [emojiSearch]
  );

  const randomizeBrush = useCallback(() => {
    const pool = emojiResults.length > 0 ? emojiResults : renderableEmojiEntries;
    if (pool.length === 0) return;
    selectEmoji(pool[Math.floor(Math.random() * pool.length)].emoji);
  }, [emojiResults, selectEmoji]);

  // ── Close / Upload — ALWAYS straight back to ProfilePage ─────────────────
  const goBackToProfile = useCallback((portrait?: string, profileUploadToken?: string) => {
    if (portrait && deviceIdParam) {
      navigation.dispatch(StackActions.popTo('ProfilePage', {
        deviceId: deviceIdParam,
        portrait,
        playPortraitAnim: true,
        profileUploadToken,
      }, { merge: true }));
    } else {
      navigation.goBack();
    }
  }, [deviceIdParam, navigation]);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    void persistNow().finally(() => goBackToProfile());
  }, [goBackToProfile, persistNow]);

  const handleUpload = useCallback(async () => {
    if (uploading || closingRef.current) return;
    setUploading(true);
    setStatus(null);
    try {
      await persistNow();
      // 1) Render the portrait: previous passport + this session's strokes.
      //    Composited off-screen through Skia rather than captureRef — capturing
      //    the live view can silently yield a BLANK png (the same reason gallery
      //    upload/share stopped using it), which is what made the passport come
      //    back empty every time. captureRef stays as a fallback only.
      const s = stateRef.current;
      let base64 = await renderPassportBase64({
        backgroundUri: s.backgroundUri,
        strokes: s.strokes,
        canvasDipSize: CANVAS_SIZE,
      });
      console.log(
        '[ProfileStudio] passport render:', base64 ? `${base64.length} b64 chars` : 'FAILED',
        '| strokes:', s.strokes.length,
        '| background:', s.backgroundUri ? s.backgroundUri.slice(0, 32) : 'none'
      );
      if (!base64) {
        console.warn('[ProfileStudio] offscreen render failed — falling back to captureRef');
        base64 = await captureRef(shotRef, {
          format: 'png', quality: 0.9, result: 'base64', width: 512, height: 512,
        });
      }
      if (!isUsablePassport(base64)) {
        // A near-empty PNG must never be published over a good portrait — that
        // is what wiped the profile and then perpetuated itself.
        throw new Error('The portrait came out empty — nothing was uploaded.');
      }
      const portraitDataUrl = `data:image/png;base64,${base64}`;
      // 2) Save locally first — the passport survives even if the upload fails.
      await AsyncStorage.setItem(PASSPORT_PORTRAIT_STORAGE_KEY, portraitDataUrl);
      // 2b) FLATTEN. The captured image already contains background + strokes,
      // so the strokes must not survive as a separate layer — reopening would
      // replay them on top of the image they are already baked into, and the
      // stale trace would win over the new passport. Persisting background =
      // new passport with an empty stroke layer is what makes "upload → back →
      // reopen" show the updated portrait, ready to paint over.
      const flattenedName = stateRef.current.name.trim().length > 0
        ? stateRef.current.name.trim().slice(0, NAME_MAX)
        : 'Anonymous';
      const flattened = flattenAfterUpload(
        { strokes: stateRef.current.strokes, backgroundUri: stateRef.current.backgroundUri, name: flattenedName },
        portraitDataUrl
      );
      persistOverrideRef.current = flattened;
      setStrokes(flattened.strokes);
      setRedoStack([]);
      setBackgroundUri(flattened.backgroundUri);
      elapsedBaseRef.current += Date.now() - mountedAtRef.current;
      mountedAtRef.current = Date.now();
      await persistNow(flattened);
      // 3) Lifetime stats for the leaderboard entry.
      let totalSeconds = 0;
      let totalStrokesCount = stateRef.current.strokes.length;
      let coins = 0;
      try {
        await flushLifetimeActivity();
        const stats = await getLifetimeStats();
        totalSeconds = Math.max(0, Math.floor(stats.totalTimeMs / 1000));
        totalStrokesCount = Math.max(totalStrokesCount, stats.totalStrokes);
        coins = stats.coins;
      } catch { /* stats are best-effort */ }
      // 4) Upload to the server.
      const uploadName = stateRef.current.name.trim().length > 0
        ? stateRef.current.name.trim().slice(0, NAME_MAX)
        : 'Anonymous';
      await persistProfileDisplayNameLocally(uploadName);
      const result = await uploadPrivateStudioPassport({
        name: uploadName,
        totalSeconds,
        totalStrokes: totalStrokesCount,
        portraitDataUrl,
        coinCount: coins,
      });
      const uploadDeviceId = deviceIdParam ?? await ensureDeviceId().catch(() => null);
      if (uploadDeviceId) {
        void markServerProfileSynced(uploadDeviceId).catch(() => undefined);
        void syncServerProfileState({
          deviceId: uploadDeviceId,
          name: uploadName,
          elapsedMs: totalSeconds * 1000,
          strokeCount: totalStrokesCount,
          portraitUrl: result.imageUrl ?? null,
        }).catch((error) => console.warn('[ProfileStudio] Durable profile sync deferred:', error));
      }
      console.log('[ProfileStudio] ✅ Uploaded passport:', result.ok, result.message ?? '');
      // 5) Show an unambiguous success state before returning. The unique token
      // makes every upload a new navigation event even when the profile screen
      // stays mounted between repeated repaint sessions.
      setStatus(result.message?.trim() || 'Profile image updated');
      setUploadSucceeded(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      await new Promise<void>((resolve) => setTimeout(resolve, UPLOAD_SUCCESS_HOLD_MS));
      closingRef.current = true;
      const profileUploadToken = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      goBackToProfile(portraitDataUrl, profileUploadToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed — please try again.';
      console.error('[ProfileStudio] Upload failed:', error);
      setUploadSucceeded(false);
      setStatus(message);
    } finally {
      setUploading(false);
    }
  }, [deviceIdParam, goBackToProfile, persistNow, uploading]);

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      {/* No title — the top tools sit where the normal painter's do. Close
          stays as a small floating control so it never crowds the toolbar. */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={handleClose}
          disabled={uploading}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Back to profile"
        >
          <Text style={styles.closeTxt}>❎</Text>
        </TouchableOpacity>
      </View>

      {/* Top tools — the SAME WorkspaceToolbar the normal workspace uses */}
      <WorkspaceToolbar
        styles={sharedWorkspaceStyles}
        hitSlop={LARGE_HIT_SLOP}
        // Keep the toolbar clear of the iPhone camera island. WorkspaceToolbar
        // subtracts 18 from this value, so 68 places it about 50pt lower.
        topInset={68}
        isBrushActive
        isLineActive={false}
        isEraserActive={false}
        onBrush={toggleBrushOptions}
        onLine={() => setPickerVisible(true)}
        onEraser={clearAll}
        onRandom={randomizeBrush}
        onUndo={undo}
        onRedo={redo}
        onClear={clearAll}
        undoDisabled={strokes.length === 0}
        redoDisabled={redoStack.length === 0}
        clearDisabled={strokes.length === 0}
        brushOptionsVisible={brushOptionsVisible}
        onFlipX={toggleMirrorX}
        onFlipY={toggleMirrorY}
        onRotateLeft={() => rotateBrush('left')}
        onRotateRight={() => rotateBrush('right')}
        onRotateLeftLongPress={() => toggleAutoRotate('left')}
        onRotateRightLongPress={() => toggleAutoRotate('right')}
        onRecentEmojiPress={(emoji) => { void selectRecentEmoji(emoji); }}
        recentEmojis={recentEmojis}
        mirrorX={mirrorX}
        mirrorY={mirrorY}
        autoRotateEnabled={autoRotateEnabled}
        autoRotateDirection={autoRotateDirection}
        brushEmoji={brushEmoji}
        isLandscape={false}
      />

      {/* Canvas */}
      <View style={styles.canvasWrap}>
        {loading ? (
          <View style={[styles.canvas, styles.canvasLoading]}>
            <ActivityIndicator color="#ff9f6b" size="large" />
            <Text style={styles.loadingTxt}>Loading your portrait…</Text>
          </View>
        ) : (
          <View
            ref={shotRef}
            collapsable={false}
            style={styles.canvas}
            {...panResponder.panHandlers}
          >
            {backgroundUri ? (
              <Image
                source={{ uri: backgroundUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onLoad={() => { lastGoodBackgroundRef.current = backgroundUri; }}
                onError={() => handleBackgroundLoadError(backgroundUri)}
              />
            ) : null}
            <PaintCanvas
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              strokes={strokes}
              liveStroke={liveStroke}
              forceSkia
              // MUST be transparent: EmojiCanvas defaults to an opaque #030303
              // backdrop, and it renders AFTER the passport <Image> above — so
              // without this the canvas paints solid black straight over the
              // portrait you are meant to be painting on top of.
              backgroundColor="transparent"
            />
          </View>
        )}
      </View>

      {status && !uploadSucceeded ? <Text style={styles.status}>{status}</Text> : null}

      {/* Bottom: brush controls + upload. The profile name is edited on the
          Profile page, never inside the painter. */}
      <View style={styles.bottomRow}>
        <View style={styles.brushControlsWrap}>
          <BrushControls
            styles={sharedWorkspaceStyles}
            hitSlop={LARGE_HIT_SLOP}
            brushSize={brushSize}
            sizeInput={sizeInput}
            sizeSliderMaximum={160}
            onSizeSliderChange={handleBrushSizeChange}
            onSizeInputChange={handleSizeInputChange}
            onSizeInputSubmit={commitSizeInput}
            onSizeInputFocus={() => {}}
            onSizeInputBlur={commitSizeInput}
            onToggleOpacity={toggleBrushMode}
            isOpacityTransparent={brushMode !== 'opaque'}
            opacityToggleEmoji={brushMode === 'smudge' ? '👆' : brushMode === 'transparent' ? '1️⃣' : '💯'}
            smudgeActive={brushMode === 'smudge'}
            smudgeSmoothness={smudgeSmoothness}
            onSmudgeSmoothnessChange={setSmudgeSmoothness}
            brushEmoji={brushEmoji}
            onEmojiPickerOpen={() => setPickerVisible(true)}
            isIpad={IS_IPAD}
            isLandscape={false}
          />
        </View>
        <TouchableOpacity
          style={[styles.uploadBtn, (uploading || loading) && styles.uploadDisabled]}
          onPress={() => void handleUpload()}
          disabled={uploading || loading}
          accessibilityLabel="Upload passport and return to profile"
        >
          {uploading ? (
            <ActivityIndicator color="#1a0e08" size="small" />
          ) : (
            <Text style={styles.uploadTxt}>📤</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Emoji picker — the SAME modal the normal workspace uses: full
          catalogue, search, recents and custom brushes, instead of a
          hard-coded grid of 120 emojis. */}
      <EmojiPickerModal
        visible={pickerVisible}
        styles={emojiPickerStyles}
        emojiSearch={emojiSearch}
        onEmojiSearchChange={setEmojiSearch}
        recentEmojis={recentEmojis}
        brushEmoji={brushEmoji}
        emojiResults={emojiResults}
        onSelectEmoji={selectEmoji}
        onLoadCustomBrushToWorkspace={selectEmoji}
        onClose={() => setPickerVisible(false)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        mirrorX={mirrorX}
        mirrorY={mirrorY}
        rotation={brushRotation}
        onToggleMirrorX={toggleMirrorX}
        onToggleMirrorY={toggleMirrorY}
        onTurnLeft={() => rotateBrush('left')}
        onTurnRight={() => rotateBrush('right')}
        onTurnRightLongPress={() => toggleAutoRotate('right')}
        autoRotateEnabled={autoRotateEnabled}
      />

      {uploadSucceeded ? (
        <View style={styles.successOverlay} accessibilityRole="alert">
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>✅</Text>
            <Text style={styles.successTitle}>Profile image updated</Text>
            <Text style={styles.successBody}>Opening your refreshed profile…</Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121212' },
  header: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    paddingHorizontal: 14, paddingTop: 4, paddingBottom: 2, minHeight: 34,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  closeBtn: { padding: 4 },
  closeTxt: { fontSize: 24 },
  toolRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingBottom: 8,
  },
  emojiBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#242424',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#ff9f6b55',
  },
  toolBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#242424',
    alignItems: 'center', justifyContent: 'center',
  },
  toolDisabled: { opacity: 0.35 },
  toolTxt: { fontSize: 18 },
  sizeSlider: { flex: 1, minWidth: 70, height: 36 },
  sizeLabel: { color: '#ff9f6b', fontSize: 13, fontWeight: '700', width: 30, textAlign: 'right' },
  canvasWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  canvas: {
    width: CANVAS_SIZE, height: CANVAS_SIZE, backgroundColor: '#f5efe6',
    borderRadius: 12, overflow: 'hidden',
  },
  canvasLoading: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingTxt: { color: '#9a9a9a', fontSize: 14 },
  status: { color: '#ff8f8f', fontSize: 13, textAlign: 'center', paddingHorizontal: 20, paddingTop: 6 },
  bottomRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  brushControlsWrap: {
    flex: 1,
    minWidth: 0,
  },
  uploadBtn: {
    width: 52, minHeight: 42, borderRadius: 12, alignItems: 'center',
    justifyContent: 'center', backgroundColor: '#ff9f6b',
  },
  uploadDisabled: { opacity: 0.5 },
  uploadTxt: { color: '#1a0e08', fontSize: 17, fontWeight: '800' },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20000,
    backgroundColor: 'rgba(7,10,8,0.84)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCard: {
    minWidth: 230,
    maxWidth: screenWidth - 48,
    borderRadius: 22,
    paddingHorizontal: 28,
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: '#18231b',
    borderWidth: 1,
    borderColor: 'rgba(126,230,157,0.5)',
  },
  successEmoji: { fontSize: 46, marginBottom: 8 },
  successTitle: { color: '#dff8e5', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  successBody: { color: '#9fc5a8', fontSize: 13, fontWeight: '700', marginTop: 5, textAlign: 'center' },
  pickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center',
  },
  pickerSheet: {
    maxWidth: Math.min(screenWidth - 32, 560), maxHeight: screenHeight * 0.7,
    backgroundColor: '#1d1d1d', borderRadius: 18, padding: 16,
  },
  pickerTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  pickerGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  pickerCell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

export default ProfileStudioScreen;
