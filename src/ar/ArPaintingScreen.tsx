/**
 * ArPaintingScreen — the main 2D painting workspace, but in AR.
 *
 * Single compact top row (flex-sized so it always fits any iPhone width):
 * brush / line / eraser / random / mirror / undo / redo / 📸 camera /
 * trash / close — with a mini LiDAR+stroke info line beneath. Bottom keeps
 * the 2D-workspace layout (emoji bubble, size slider, alpha toggle).
 * Brush emoji and opacity are shared with the 2D workspace through
 * PaintingContext; stamp density matches the 2D stroke feel.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, Modal, Platform, ScrollView, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { startScreenRecording, stopScreenRecording } from '../native/screenRecorder';

import {
  WallPaintNativeView,
  EmojiArConstantsValue,
  type WallPaintToolMode,
  type WallPaintViewRef,
  type WallPaintSunPreset,
} from '../../modules/emoji-ar';
import { usePainting } from '../state/PaintingContext';
import { renderableEmojiEntries, searchRenderableEmojis } from '../lib/emojiCatalog';
import { isCustomBrushReference, getCustomBrushPNGData } from '../lib/customBrushRegistry';
import { saveArSceneProject } from '../lib/storage';
import emojiColorIndex from '../data/emojiColorIndex.json';
import EmojiPickerModal from '../workspace/EmojiPickerModal';
import emojiPickerStyles from '../workspace/emojiPickerStyles';
import BrushEmojiIcon from '../components/BrushEmojiIcon';
import ArAnimatorTimeline from './ArAnimatorTimeline';
import RoomViewerModal, { type RoomViewerData } from './RoomViewerModal';
import { markProfileLevelAchievement } from '../lib/profileLevelAchievements';
import { recordLifetimeStrokeCommit } from '../lib/lifetimeStats';
import { useLifetimeActivity } from '../lib/useLifetimeActivity';

interface ArPaintingScreenProps {
  visible: boolean;
  onClose: () => void;
  /** Fast-switch to Front Camera (both native scenes stay mounted + paused) */
  onSwitchToFrontCamera?: () => void;
  /** When set, relocalize this saved scene's room and replay its strokes */
  pendingSceneDir?: string | null;
  onSceneConsumed?: () => void;
  /** When set, open this local image/video path as a wall placement in AR */
  pendingPlacementPath?: string | null;
  pendingPlacementIsVideo?: boolean;
  onPlacementConsumed?: () => void;
}

type ArUiMode = 'paint' | 'cameraOptions' | 'capture' | 'placing' | 'scenes' | 'settings';

interface SavedArScene {
  id: string;
  dir: string;
  snapshotPath: string;
  strokeCount: number;
  createdAt: number;
  roomReady?: boolean;
  roomSurfaceCount?: number;
}

type RoomReadiness = {
  state: 'unsupported' | 'scanning' | 'partial' | 'roomReady';
  confidence: number;
  wallCount?: number;
  floorCount?: number;
  openingCount?: number;
  coverage?: number;
  stability?: number;
  viewpoints?: number;
  worldMappingStatus?: string;
};

const AR_SCENES_KEY = 'emojipaint/ar-scenes';

// Dominant "filled" color per emoji, from the Color-Engine catalog.
function hsvToRgb255(h: number, s: number, v: number): number[] {
  const sf = s / 100, vf = v / 100;
  const c = vf * sf;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vf - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const DRIP_COLOR_BY_EMOJI: Record<string, number[]> = (() => {
  const map: Record<string, number[]> = {};
  for (const entry of emojiColorIndex as any[]) {
    const clusters = (entry.c as number[][]) || [];
    // Pick the cluster that best balances prominence (weight) and colorfulness
    let best: number[] | null = null;
    let bestScore = -1;
    for (const cl of clusters) {
      const [ch, cs, cv, w] = cl;
      const score = (w || 0) * (cs / 100 + 0.18);
      if (score > bestScore) { bestScore = score; best = [ch, cs, cv]; }
    }
    const hsv = best ?? [entry.h, entry.s, entry.v];
    map[entry.e] = hsvToRgb255(hsv[0], hsv[1], hsv[2]);
  }
  return map;
})();

// The emoji's TOP few colours (from the trusted catalog) → drip gradient palette.
const DRIP_PALETTE_BY_EMOJI: Record<string, number[][]> = (() => {
  const map: Record<string, number[][]> = {};
  for (const entry of emojiColorIndex as any[]) {
    const clusters = (entry.c as number[][]) || [];
    const scored = clusters
      .map((cl) => ({ cl, score: (cl[3] || 0) * (cl[1] / 100 + 0.18) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ cl }) => hsvToRgb255(cl[0], cl[1], cl[2]));
    map[entry.e] = scored.length > 0 ? scored : [DRIP_COLOR_BY_EMOJI[entry.e] ?? [230, 60, 60]];
  }
  return map;
})();

// Sun / shadow moods — the ☀️ picker in AR settings. `key` matches the native preset.
const SUN_PRESETS: { key: WallPaintSunPreset; emoji: string; label: string; shadow: number }[] = [
  { key: 'studio', emoji: '💡', label: 'Studio', shadow: 1.0 },
  { key: 'noon', emoji: '☀️', label: 'Noon', shadow: 0.5 },
  { key: 'morning', emoji: '🌅', label: 'Morning', shadow: 0.44 },
  { key: 'sunset', emoji: '🌇', label: 'Sunset', shadow: 0.5 },
  { key: 'hard', emoji: '🔦', label: 'Hard', shadow: 0.68 },
  { key: 'soft', emoji: '☁️', label: 'Soft', shadow: 0.3 },
  { key: 'dramatic', emoji: '🌘', label: 'Dramatic', shadow: 0.78 },
  { key: 'off', emoji: '🚫', label: 'No shadow', shadow: 0 },
];

const MIN_BRUSH_METERS = 0.02;
const MAX_BRUSH_METERS = 0.6;
const BRUSH_DIM_OPACITY = 0.5;
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
const AR_ANIMATION_DEFAULT_FRAMES = 90;
const AR_ANIMATION_MAX_FRAMES = 900;
// Smudge Reach ceiling — a HIGH max (not infinite). Natural default stays ~0.7.
const AR_SMUDGE_MAX_REACH = 2.5;

const ArPaintingScreen: React.FC<ArPaintingScreenProps> = ({
  visible,
  onClose,
  onSwitchToFrontCamera,
  pendingSceneDir,
  onSceneConsumed,
  pendingPlacementPath,
  pendingPlacementIsVideo = false,
  onPlacementConsumed,
}) => {
  useLifetimeActivity('ar-scene', visible);
  const {
    brushEmoji,
    brushOpacity,
    recentEmojis,
    mirrorX,
    mirrorY,
    brushRotation,
    brushSpacing,
    dispatch,
  } = usePainting();
  const insets = useSafeAreaInsets();

  const wallViewRef = useRef<WallPaintViewRef | null>(null);
  const [toolMode, setToolMode] = useState<WallPaintToolMode>('brush');
  // AR-only default brush size (15% bigger than the original 8cm; 2D canvas unaffected)
  const [brushSizeMeters, setBrushSizeMeters] = useState(0.092);
  const [smudgeStrength, setSmudgeStrength] = useState(0.7); // 0–6 (∞ ceiling), natural default 0.7
  const [smudgeFocus, setSmudgeFocus] = useState(0); // default: crisp, undiffused camera lift
  const [smudgeFlow, setSmudgeFlow] = useState(0.5); // 0 locked pickup stamps · 0.5 legacy · 1 dense soft cloud
  const [smudgeReachEnabled, setSmudgeReachEnabled] = useState(true);
  const [smudgeFocusEnabled, setSmudgeFocusEnabled] = useState(true);
  const [smudgeFlowEnabled, setSmudgeFlowEnabled] = useState(true);
  // Mirror/rotation/spacing live in PaintingContext (shared with the 2D
  // workspace) so the full Brush Library picker controls them identically.
  const setMirrorX = useCallback(
    (value: boolean) => dispatch({ type: 'SET_MIRROR_X', value }),
    [dispatch]
  );
  const setMirrorY = useCallback(
    (value: boolean) => dispatch({ type: 'SET_MIRROR_Y', value }),
    [dispatch]
  );
  const [emojiSearch, setEmojiSearch] = useState('');
  const [sprayCanEnabled, setSprayCanEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [sunPreset, setSunPreset] = useState<WallPaintSunPreset>('studio');
  const [shadowStrength, setShadowStrength] = useState(1.0); // 0–1 shadow darkness
  const [strokeLightAmount, setStrokeLightAmount] = useState(0.5); // 0 flat … 1 fully lit
  const [sunFollowSpeed, setSunFollowSpeed] = useState(0.08); // 0 glacial … 1 snappy
  const [blendFilter, setBlendFilter] = useState(true); // blend strokes into real world (default on)
  const [strokeShadows, setStrokeShadows] = useState(false); // strokes cast a shadow onto AR planes
  const [strokeStacking, setStrokeStacking] = useState(false); // stack strokes over each other
  const [strokeStackHeight, setStrokeStackHeight] = useState(1.0); // 0–1 per-layer lift (default max)
  const [sunFollowEnabled, setSunFollowEnabled] = useState(false); // sun strongly follows aim/paint
  // Long-press "specials" effects menu.
  const [specialsVisible, setSpecialsVisible] = useState(false);
  const [meltdownOn, setMeltdownOn] = useState(false);
  const [destroyOn, setDestroyOn] = useState(false);
  // Wash effect. Runs entirely in SceneKit on-device — no model server,
  // downloaded mesh, account, or network connection is involved.
  const [washOn, setWashOn] = useState(false);
  const specialsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [blendAmount, setBlendAmount] = useState(0.5); // 0 subtle … 1 strong
  const [occlusion, setOcclusion] = useState(true); // AR planes hide content behind them
  const [personOcclusion, setPersonOcclusion] = useState(true); // people-over-strokes default on
  // Lightweight stroke-lifetime Animator. Native AR keeps one 3D node per
  // gesture and only changes visibility at the playhead—no per-frame copies.
  const [animationEnabled, setAnimationEnabled] = useState(false);
  const [animationPlaying, setAnimationPlaying] = useState(false);
  const [animationLooping, setAnimationLooping] = useState(true);
  const [animationFps, setAnimationFps] = useState(12);
  const [animationTotalFrames, setAnimationTotalFrames] = useState(AR_ANIMATION_DEFAULT_FRAMES);
  const [animationStrokeLength, setAnimationStrokeLength] = useState(3);
  const [animationBackgroundStroke, setAnimationBackgroundStroke] = useState(false);
  const [animationTimelineExpanded, setAnimationTimelineExpanded] = useState(true);
  // PURE-JS playhead — exactly like the 2D Animator. A JS interval clock at the
  // picked FPS advances this frame; it is sent to native ONLY as the
  // `animationCurrentFrame` prop (which every AR build understands) so native
  // shows/hides each stroke by its [start, start+life) window. No native clock,
  // no native events — so the counter runs on any build, phone included.
  const [animationPlayhead, setAnimationPlayhead] = useState(0);
  const sunIndex = Math.max(0, SUN_PRESETS.findIndex((s) => s.key === sunPreset));
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [lidarActive, setLidarActive] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  // Quick brush mini-panel under 🖌️ (mirror · rotate · alpha · last-5 emojis), like the 2D workspace.
  const [brushPanelOpen, setBrushPanelOpen] = useState(false);
  const brushPanelHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideBrushPanel = useCallback(() => {
    if (brushPanelHideTimer.current) {
      clearTimeout(brushPanelHideTimer.current);
      brushPanelHideTimer.current = null;
    }
    setBrushPanelOpen(false);
  }, []);

  const showBrushPanel = useCallback(() => {
    if (brushPanelHideTimer.current) clearTimeout(brushPanelHideTimer.current);
    setBrushPanelOpen(true);
    brushPanelHideTimer.current = setTimeout(() => {
      brushPanelHideTimer.current = null;
      setBrushPanelOpen(false);
    }, 7000);
  }, []);

  useEffect(() => () => {
    if (brushPanelHideTimer.current) clearTimeout(brushPanelHideTimer.current);
  }, []);

  const toggleBrushPanel = useCallback(() => {
    void Haptics.selectionAsync();
    setToolMode('brush');
    if (brushPanelOpen) hideBrushPanel();
    else showBrushPanel();
  }, [brushPanelOpen, hideBrushPanel, showBrushPanel]);
  const [uiMode, setUiMode] = useState<ArUiMode>('paint');
  const [recording, setRecording] = useState(false);
  const [savedScenes, setSavedScenes] = useState<SavedArScene[]>([]);
  const savedRooms = useMemo(() => savedScenes.filter((s) => s.roomReady), [savedScenes]);
  const [sceneStatus, setSceneStatus] = useState<string | null>(null);
  const [roomReadiness, setRoomReadiness] = useState<RoomReadiness | null>(null);
  // RoomPlan has no official completion percentage.  Permit an early save once
  // the native manager has enough anchored wall/floor evidence for an ARWorldMap;
  // the manager still latches `roomReady` separately for the full 3D inspector.
  const canSaveRoom = !!roomReadiness && roomReadiness.state !== 'unsupported' && (
    roomReadiness.state === 'roomReady'
    || (
      roomReadiness.state === 'partial'
      && (roomReadiness.confidence || 0) >= 0.35
      && (roomReadiness.wallCount || 0) > 0
      && ((roomReadiness.floorCount || 0) > 0 || (roomReadiness.coverage || 0) >= 0.12)
    )
  );
  const [roomPreviewEnabled, setRoomPreviewEnabled] = useState(false);
  const [roomViewerVisible, setRoomViewerVisible] = useState(false);
  const [roomViewerData, setRoomViewerData] = useState<RoomViewerData | null>(null);
  const [roomViewerDir, setRoomViewerDir] = useState<string | null>(null);
  const [roomViewerLoading, setRoomViewerLoading] = useState(false);
  const [surfaceHintVisible, setSurfaceHintVisible] = useState(false);
  const [surfaceHintMode, setSurfaceHintMode] = useState<'text' | 'eyes'>('text');
  const surfaceHintCountRef = useRef(0);
  const surfaceHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfaceHintAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const surfaceHintX = useRef(new Animated.Value(0)).current;

  const showSurfaceHint = useCallback(() => {
    const mode = surfaceHintCountRef.current % 2 === 0 ? 'text' : 'eyes';
    surfaceHintCountRef.current += 1;
    setSurfaceHintMode(mode);
    setSurfaceHintVisible(true);

    if (surfaceHintTimerRef.current) clearTimeout(surfaceHintTimerRef.current);
    surfaceHintAnimationRef.current?.stop();
    surfaceHintX.setValue(-10);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(surfaceHintX, { toValue: 10, duration: 430, useNativeDriver: true }),
        Animated.timing(surfaceHintX, { toValue: -10, duration: 430, useNativeDriver: true }),
      ]),
      { iterations: 3 }
    );
    surfaceHintAnimationRef.current = animation;
    if (mode === 'eyes') animation.start();

    surfaceHintTimerRef.current = setTimeout(() => {
      surfaceHintAnimationRef.current?.stop();
      surfaceHintAnimationRef.current = null;
      setSurfaceHintVisible(false);
    }, 2400);
  }, [surfaceHintX]);

  const setBrushEmoji = useCallback(
    (emoji: string) => {
      if (emoji && emoji.trim().length > 0) {
        dispatch({ type: 'SET_BRUSH_EMOJI', emoji });
      }
    },
    [dispatch]
  );

  // Picking from the Brush Library dismisses it, same as the 2D workspace.
  const handlePickEmoji = useCallback(
    (emoji: string) => {
      setBrushEmoji(emoji);
      setPickerVisible(false);
    },
    [setBrushEmoji]
  );

  // `brushEmoji` is shared with the 2D screen, so it may already be a `custom_brush_<n>` registry id
  // when AR opens. Native can't read the registry — it renders whatever string it gets as TEXT — so
  // resolve the id to the PNG data URI the native side knows how to decode.
  const [customBrushDataUri, setCustomBrushDataUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!isCustomBrushReference(brushEmoji)) {
      setCustomBrushDataUri(null);
      return;
    }
    void (async () => {
      try {
        const base64 = await getCustomBrushPNGData(brushEmoji);
        if (!cancelled) {
          setCustomBrushDataUri(base64 ? `data:image/png;base64,${base64}` : null);
        }
      } catch (error) {
        console.warn('[AR] failed to resolve custom brush PNG:', error);
        if (!cancelled) setCustomBrushDataUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brushEmoji]);

  // What the native view actually paints with. A custom brush that hasn't resolved yet falls back to
  // a plain emoji rather than leaking the raw id (which native would draw as literal characters).
  const nativeBrushEmoji = useMemo(() => {
    if (isCustomBrushReference(brushEmoji)) return customBrushDataUri ?? '🙂';
    return brushEmoji || '🙂';
  }, [brushEmoji, customBrushDataUri]);

  const handleRandomEmoji = useCallback(() => {
    void Haptics.selectionAsync();
    const entry = renderableEmojiEntries[Math.floor(Math.random() * renderableEmojiEntries.length)];
    if (entry?.emoji) setBrushEmoji(entry.emoji);
  }, [setBrushEmoji]);

  // Search results for the full Brush Library picker (same catalog as 2D).
  const emojiResults = useMemo(
    () => (emojiSearch.trim().length > 0 ? searchRenderableEmojis(emojiSearch) : renderableEmojiEntries),
    [emojiSearch]
  );

  // Rotation controls (15° steps, same feel as the 2D picker).
  const onTurnLeft = useCallback(
    () => dispatch({ type: 'SET_BRUSH_ROTATION', rotation: (((brushRotation - 15) % 360) + 360) % 360 }),
    [brushRotation, dispatch]
  );
  const onTurnRight = useCallback(
    () => dispatch({ type: 'SET_BRUSH_ROTATION', rotation: (brushRotation + 15) % 360 }),
    [brushRotation, dispatch]
  );
  const spacingSlider = useMemo(
    () => ({
      value: brushSpacing,
      minimum: 0.001,
      maximum: 1,
      onChange: (value: number) => dispatch({ type: 'SET_BRUSH_SPACING', spacing: value }),
    }),
    [brushSpacing, dispatch]
  );

  // Same alpha toggle as the 2D workspace: 💯 ↔ 1️⃣ (full ↔ half transparent)
  const isOpacityMostlyTransparent = brushOpacity <= BRUSH_DIM_OPACITY + 0.05;

  // One cycling brush-mode button, exactly like the 2D workspace:
  //   💯 opaque → 1️⃣ transparent → 👇 smudge → 💯 …
  const brushModeIcon = toolMode === 'smudge' ? '👇' : (isOpacityMostlyTransparent ? '1️⃣' : '💯');
  const cycleBrushMode = useCallback(() => {
    void Haptics.selectionAsync();
    if (toolMode === 'smudge') {
      setToolMode('brush');
      dispatch({ type: 'SET_BRUSH_OPACITY', opacity: 1 });          // → 💯 opaque
    } else if (isOpacityMostlyTransparent) {
      setToolMode('smudge');                                        // → 👇 smudge
    } else {
      dispatch({ type: 'SET_BRUSH_OPACITY', opacity: BRUSH_DIM_OPACITY }); // → 1️⃣ transparent
    }
  }, [toolMode, isOpacityMostlyTransparent, dispatch]);

  const handleSnapshot = useCallback(async () => {
    try {
      const path = await wallViewRef.current?.snapshot();
      if (!path) throw new Error('No snapshot path');
      await MediaLibrary.saveToLibraryAsync(path);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('📸 Saved', 'Saved to Photos.');
    } catch (error) {
      console.warn('[ArPainting] Snapshot failed:', error);
      Alert.alert('Snapshot failed', 'Could not save. Please try again.');
    }
  }, []);

  // ── Camera hub: place media / capture / switch to face filter ─────────────
  const handlePlaceMedia = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 1,
        videoMaxDuration: 30,
      });
      if (result.canceled || !result.assets?.[0]) {
        setUiMode('paint');
        return;
      }
      const asset = result.assets[0];
      const path = asset.uri.replace('file://', '');
      await wallViewRef.current?.startPlacement(path, asset.type === 'video');
      setUiMode('placing');
      void Haptics.selectionAsync();
    } catch (error) {
      console.warn('[ArPainting] Media placement failed:', error);
      Alert.alert('Import failed', 'Could not load that file.');
      setUiMode('paint');
    }
  }, []);

  const handleConfirmPlacement = useCallback(async () => {
    await wallViewRef.current?.confirmPlacement();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setUiMode('paint');
  }, []);

  const handleCancelPlacement = useCallback(async () => {
    await wallViewRef.current?.cancelPlacement();
    setUiMode('paint');
  }, []);

  const handleCapturePhoto = useCallback(async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const path = await wallViewRef.current?.snapshot();
      if (!path) throw new Error('No snapshot');
      await MediaLibrary.saveToLibraryAsync(path);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('✅ Saved to Photos');
    } catch (error) {
      console.warn('[ArPainting] Capture failed:', error);
      Alert.alert('Capture failed', 'Please try again.');
    }
  }, []);

  const handleFilmStart = useCallback(async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const started = await startScreenRecording(false);
      if (started.ok) setRecording(true);
    } catch (error) {
      console.warn('[ArPainting] Film start failed:', error);
    }
  }, []);

  const handleFilmStop = useCallback(async () => {
    if (!recording) return;
    setRecording(false);
    try {
      const { ok, url } = await stopScreenRecording();
      if (ok && url) {
        await MediaLibrary.saveToLibraryAsync(url);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('✅ Saved to Photos');
      }
    } catch (error) {
      console.warn('[ArPainting] Film stop failed:', error);
      Alert.alert('Recording failed', 'Could not save the video.');
    }
  }, [recording]);

  // ── AR scene persistence (room map + strokes + snapshot) ───────────────────
  const loadSceneList = useCallback(async (): Promise<SavedArScene[]> => {
    try {
      const raw = await AsyncStorage.getItem(AR_SCENES_KEY);
      const list = raw ? (JSON.parse(raw) as SavedArScene[]) : [];
      setSavedScenes(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const handleSaveScene = useCallback(async () => {
    try {
      setUiMode('paint');
      setSceneStatus('💾 Mapping the room…');
      const wallView = wallViewRef.current;
      const result = await (wallView?.saveRoom?.() ?? wallView?.saveScene());
      if (!result) throw new Error('No result');
      const entry: SavedArScene = {
        id: `scene_${result.dir.split('scene_').pop() ?? String(result.strokeCount)}`,
        dir: result.dir,
        snapshotPath: result.snapshotPath,
        strokeCount: result.strokeCount,
        createdAt: 0, // replaced below
        roomReady: result.roomReady,
        roomSurfaceCount: result.roomSurfaceCount,
      };
      const list = await loadSceneList();
      const next = [{ ...entry, createdAt: new Date().getTime() }, ...list].slice(0, 30);
      await AsyncStorage.setItem(AR_SCENES_KEY, JSON.stringify(next));
      if (result.strokeCount >= 13) {
        markProfileLevelAchievement('first_ar_scene_13').catch(() => undefined);
      }
      setSavedScenes(next);

      // ALSO register in the unified project library (shows in 🗂️ Projects)
      try {
        const now = new Date();
        const projectName = `🧱 AR Scene ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        await saveArSceneProject(projectName, result.dir, result.snapshotPath, result.strokeCount);
      } catch (projErr) {
        console.warn('[ArPainting] Project-library registration failed:', projErr);
      }

      setSceneStatus(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('💾 Scene saved', `Room + ${result.strokeCount} strokes saved.\nFind it in 🗂️ Projects or 📸 → My AR Scenes.`);
    } catch (error: any) {
      setSceneStatus(null);
      console.warn('[ArPainting] Scene save failed:', error);
      Alert.alert('Save failed', String(error?.message ?? error));
    }
  }, [loadSceneList]);

  const handleLoadScene = useCallback(async (scene: SavedArScene) => {
    try {
      setUiMode('paint');
      await wallViewRef.current?.loadScene(scene.dir);
    } catch (error) {
      console.warn('[ArPainting] Scene load failed:', error);
      Alert.alert('Load failed', 'Could not load this scene.');
    }
  }, []);

  const openLiveRoomViewer = useCallback(async () => {
    setRoomViewerLoading(true);
    setRoomViewerDir(null);
    try {
      const payload = await wallViewRef.current?.getRoomViewerData();
      if (!payload) throw new Error('Room is still being tracked');
      setRoomViewerData(payload as RoomViewerData);
      setRoomViewerVisible(true);
    } catch (error) {
      console.warn('[ArPainting] Room viewer unavailable:', error);
      Alert.alert('ROOM is still preparing', 'Keep looking around until the room reaches a stronger tracking state.');
    } finally {
      setRoomViewerLoading(false);
    }
  }, []);

  const openSavedRoomViewer = useCallback((scene: SavedArScene) => {
    setRoomViewerData(null);
    setRoomViewerDir(scene.dir);
    setRoomViewerVisible(true);
  }, []);

  // AR painting always opens at full (100%) brush opacity by default.
  useEffect(() => {
    if (visible) dispatch({ type: 'SET_BRUSH_OPACITY', opacity: 1 });
  }, [visible, dispatch]);

  useEffect(() => {
    if (!animationEnabled) setAnimationPlaying(false);
  }, [animationEnabled]);

  useEffect(() => {
    setAnimationStrokeLength((length) => Math.min(length, animationTotalFrames));
    setAnimationPlayhead((frame) => Math.min(frame, Math.max(0, animationTotalFrames - 1)));
  }, [animationTotalFrames]);

  // The live playhead during playback lives in a ref (not screen state) — the
  // clock is owned by the isolated ArAnimatorTimeline and drives native
  // imperatively, so the whole AR screen does NOT re-render every frame.
  const livePlayheadRef = useRef(0);

  // Push a frame to native the fast way (imperative seekAnimation, no re-render).
  // Old native builds without seekAnimation fall back to the prop path.
  const pushFrameToNative = useCallback((frame: number) => {
    livePlayheadRef.current = frame;
    const view = wallViewRef.current as
      | (WallPaintViewRef & { seekAnimation?: (f: number) => Promise<void> })
      | null;
    if (typeof view?.seekAnimation === 'function') {
      void view.seekAnimation(frame);
    } else {
      setAnimationPlayhead(frame);
    }
  }, []);

  // When playback stops, commit the live frame to state so the paused prop/UI match.
  useEffect(() => {
    if (!animationPlaying) setAnimationPlayhead(livePlayheadRef.current);
  }, [animationPlaying]);

  // Scrub / step — pauses and jumps to a frame (both state + native).
  const handleAnimationSeek = useCallback((frame: number) => {
    setAnimationPlaying(false);
    livePlayheadRef.current = frame;
    setAnimationPlayhead(frame);
    const view = wallViewRef.current as
      | (WallPaintViewRef & { seekAnimation?: (f: number) => Promise<void> })
      | null;
    if (typeof view?.seekAnimation === 'function') void view.seekAnimation(frame);
  }, []);
  // Specials menu opens on a DOUBLE-TAP of the 🗑️ button; a single tap still
  // asks to clear (after a short beat to see if a second tap arrives).
  const trashTapAtRef = useRef(0);
  const eraserTapAtRef = useRef(0);
  const trashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTrashPress = useCallback(() => {
    const now = Date.now();
    if (now - trashTapAtRef.current < 350) {
      // Double tap → specials
      trashTapAtRef.current = 0;
      if (trashTimerRef.current) { clearTimeout(trashTimerRef.current); trashTimerRef.current = null; }
      openSpecialsRef.current?.();
      return;
    }
    trashTapAtRef.current = now;
    void Haptics.selectionAsync();
    if (trashTimerRef.current) clearTimeout(trashTimerRef.current);
    trashTimerRef.current = setTimeout(() => {
      trashTimerRef.current = null;
      trashTapAtRef.current = 0;
      Alert.alert('Clear all?', 'Remove every AR stroke?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => {
          setMeltdownOn(false);   // native clear ends the melt — keep JS in sync
          setDestroyOn(false);
          setWashOn(false);
          void wallViewRef.current?.clear();
        } },
      ]);
    }, 360);
  }, []);
  const openSpecialsRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { if (trashTimerRef.current) clearTimeout(trashTimerRef.current); }, []);

  // Specials menu: open, then auto-hide after 5s (per the spec).
  const openSpecials = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSpecialsVisible(true);
    if (specialsHideTimer.current) clearTimeout(specialsHideTimer.current);
    specialsHideTimer.current = setTimeout(() => setSpecialsVisible(false), 5000);
  }, []);
  openSpecialsRef.current = openSpecials;
  const toggleMeltdown = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !meltdownOn;
    setMeltdownOn(next);
    if (next) {
      setDestroyOn(false);
      setWashOn(false);
      void wallViewRef.current?.startMeltdown();
    } else {
      void wallViewRef.current?.stopMeltdown();
    }
    if (specialsHideTimer.current) clearTimeout(specialsHideTimer.current);
    specialsHideTimer.current = setTimeout(() => setSpecialsVisible(false), 5000);
  }, [meltdownOn]);

  const toggleDestroy = useCallback(() => {
    const next = !destroyOn;
    void Haptics.impactAsync(next ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium);
    setDestroyOn(next);
    if (next) {
      setMeltdownOn(false);
      setWashOn(false);
      void wallViewRef.current?.startDestroy();
    } else {
      void wallViewRef.current?.stopDestroy();
    }
    if (specialsHideTimer.current) clearTimeout(specialsHideTimer.current);
    specialsHideTimer.current = setTimeout(() => setSpecialsVisible(false), 5000);
  }, [destroyOn]);

  useEffect(() => () => { if (specialsHideTimer.current) clearTimeout(specialsHideTimer.current); }, []);

  // Wash: the painted strokes go wet and run down the real surfaces under
  // world gravity, smearing and mixing until they pool on the floor. Fully
  // on-device, and the washed result is frozen into the artwork when it stops.
  const setWashEnabled = useCallback((enabled: boolean) => {
    setWashOn(enabled);
    if (enabled) {
      setMeltdownOn(false);
      setDestroyOn(false);
      void wallViewRef.current?.startWash();
    } else {
      void wallViewRef.current?.stopWash();
    }
  }, []);

  const toggleWash = useCallback(() => {
    const next = !washOn;
    void Haptics.impactAsync(next ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium);
    setWashEnabled(next);
    if (next) setSpecialsVisible(false);
    if (specialsHideTimer.current) clearTimeout(specialsHideTimer.current);
    specialsHideTimer.current = setTimeout(() => setSpecialsVisible(false), 5000);
  }, [setWashEnabled, washOn]);

  // One-tap Animator: turning it ON goes straight into looping play mode.
  const toggleAnimator = useCallback((enabled: boolean) => {
    setAnimationEnabled(enabled);
    setAnimationPlaying(enabled);
    if (enabled) { setAnimationTimelineExpanded(true); setAnimationLooping(true); }
  }, []);

  useEffect(() => () => {
    if (surfaceHintTimerRef.current) clearTimeout(surfaceHintTimerRef.current);
    surfaceHintAnimationRef.current?.stop();
  }, []);

  // Auto-load a scene handed in from the project library
  useEffect(() => {
    if (!visible || !pendingSceneDir) return;
    const timer = setTimeout(async () => {
      try {
        setUiMode('paint');
        await wallViewRef.current?.loadScene(pendingSceneDir);
      } catch (error) {
        console.warn('[ArPainting] Pending scene load failed:', error);
      } finally {
        onSceneConsumed?.();
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [visible, pendingSceneDir, onSceneConsumed]);

  // Auto-place an exported workspace PNG handed in from the main canvas.
  useEffect(() => {
    if (!visible || !pendingPlacementPath) return;
    const timer = setTimeout(async () => {
      try {
        await wallViewRef.current?.startPlacement(pendingPlacementPath, pendingPlacementIsVideo);
        setUiMode('placing');
        void Haptics.selectionAsync();
      } catch (error) {
        console.warn('[ArPainting] Pending media placement failed:', error);
        Alert.alert('Open in AR failed', 'Could not place that artwork in the AR scene.');
      } finally {
        onPlacementConsumed?.();
      }
    }, 550);
    return () => clearTimeout(timer);
  }, [visible, pendingPlacementPath, pendingPlacementIsVideo, onPlacementConsumed]);

  const handleDeleteScene = useCallback(async (scene: SavedArScene) => {
    const list = await loadSceneList();
    const next = list.filter((s) => s.dir !== scene.dir);
    await AsyncStorage.setItem(AR_SCENES_KEY, JSON.stringify(next));
    setSavedScenes(next);
  }, [loadSceneList]);



  // Mount the native AR view only after the first open — then keep it alive
  const [everOpened, setEverOpened] = useState(false);
  if (visible && !everOpened) setEverOpened(true);
  if (!everOpened) return null;

  if (!WallPaintNativeView || !EmojiArConstantsValue.isWorldTrackingSupported) {
    if (!visible) return null;
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.unsupportedWrap}>
          <View style={styles.unsupportedPanel}>
            <Text style={styles.unsupportedText}>
              AR painting is not supported on this device.
            </Text>
            <TouchableOpacity style={styles.unsupportedButton} onPress={onClose}>
              <Text style={styles.unsupportedButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // Stays MOUNTED when hidden (display:none + paused session) so strokes and
  // tracking survive fast switches to the face filter and back.
  return (
    <View
      style={[styles.fullscreen, !visible && styles.hidden]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={styles.container}>
        <WallPaintNativeView
          // @ts-expect-error — expo-modules view ref exposes native AsyncFunctions
          ref={wallViewRef}
          style={StyleSheet.absoluteFill}
          brushEmoji={nativeBrushEmoji}
          brushSizeMeters={brushSizeMeters}
          brushSpacing={brushSpacing}
          brushOpacity={brushOpacity}
          // NOTE: native "mirrorX" is a paint-SYMMETRY brush (stamps a mirrored copy across the
          // screen), unrelated to the 🖌️ mirror option below — this existing binding is unchanged.
          mirrorX={mirrorX}
          // 🖌️ mirror/rotate brush options — the glyph itself. AR never had this; wired from the
          // same shared state the 2D and Metal engines already read.
          stampMirrorX={mirrorX}
          stampMirrorY={mirrorY}
          stampRotation={brushRotation}
          toolMode={toolMode}
          smudgeStrength={smudgeReachEnabled ? smudgeStrength : 0.7}
          smudgeFocus={smudgeFocusEnabled ? smudgeFocus : 0.5}
          smudgeFlow={smudgeFlowEnabled ? smudgeFlow : 0.5}
          animationEnabled={animationEnabled}
          animationCurrentFrame={animationPlaying ? livePlayheadRef.current : animationPlayhead}
          animationPlaying={animationEnabled && animationPlaying}
          animationTotalFrames={animationTotalFrames}
          animationStrokeLength={animationBackgroundStroke ? -1 : animationStrokeLength}
          animationFps={animationFps}
          animationLooping={animationLooping}
          roomPlanEnabled
          roomPreviewEnabled={roomPreviewEnabled}
          sprayCanEnabled={sprayCanEnabled && toolMode !== 'smudge'}
          soundEnabled={soundEnabled}
          gridEnabled={gridEnabled}
          sunPreset={sunPreset}
          shadowStrength={shadowStrength}
          strokeLightAmount={strokeLightAmount}
          sunFollowSpeed={sunFollowSpeed}
          blendFilterEnabled={blendFilter}
          blendAmount={blendAmount}
          occlusionEnabled={occlusion}
          personOcclusionEnabled={personOcclusion}
          strokeShadowsEnabled={strokeShadows}
          strokeStackingEnabled={strokeStacking}
          strokeStackHeight={strokeStackHeight}
          sunFollowEnabled={sunFollowEnabled}
          dripColor={DRIP_COLOR_BY_EMOJI[brushEmoji] ?? [230, 60, 60]}
          dripColors={DRIP_PALETTE_BY_EMOJI[brushEmoji] ?? [DRIP_COLOR_BY_EMOJI[brushEmoji] ?? [230, 60, 60]]}
          onBrushSizeChanged={(e) => setBrushSizeMeters(e.nativeEvent.size)}
          paused={!visible}
          onSurfaceUnavailable={showSurfaceHint}
          onStrokeStarted={(e) => {
            // The panel is only a quick setup surface. Once painting starts,
            // hide it immediately so it cannot cover the AR canvas.
            hideBrushPanel();
            const { meltdownStopped, destroyStopped, threeDStopped } = e.nativeEvent;
            if (meltdownStopped) setMeltdownOn(false);
            if (destroyStopped) setDestroyOn(false);
            if (threeDStopped) setWashOn(false);
          }}
          onStrokeCommitted={(e) => {
            void recordLifetimeStrokeCommit({
              eventId: `ar-scene:${e.nativeEvent.strokeId}`,
              workspace: 'ar-scene',
            });
          }}
          onAnimationLoaded={(e) => {
            const restored = e.nativeEvent;
            const total = Math.max(1, Math.min(AR_ANIMATION_MAX_FRAMES, Math.round(restored.totalFrames || AR_ANIMATION_DEFAULT_FRAMES)));
            const strokeLength = Math.round(restored.strokeLength ?? 3);
            setAnimationEnabled(!!restored.enabled);
            setAnimationPlaying(!!restored.enabled); // Animator on = playing
            setAnimationTotalFrames(total);
            setAnimationPlayhead(Math.max(0, Math.min(total - 1, Math.round(restored.currentFrame || 0))));
            setAnimationFps(Math.max(1, Math.min(30, Math.round(restored.fps || 12))));
            setAnimationLooping(restored.looping !== false);
            setAnimationBackgroundStroke(strokeLength === -1);
            if (strokeLength !== -1) setAnimationStrokeLength(Math.max(1, Math.min(total, strokeLength)));
          }}
          onHistoryChanged={(e) => {
            setUndoCount(e.nativeEvent.undoCount);
            setRedoCount(e.nativeEvent.redoCount);
          }}
          onSessionReady={(e) => setLidarActive(!!e.nativeEvent.lidar)}
          onRoomReadinessChanged={(e) => {
            const readiness = e.nativeEvent as RoomReadiness;
            setRoomReadiness(readiness);
          }}
          onSceneStatus={(e) => {
            const { status, total } = e.nativeEvent;
            if (status === 'relocalizing') setSceneStatus('🔍 Move your phone around the room to find it…');
            else if (status === 'found') setSceneStatus('✅ Room found!');
            else if (status === 'replaying') setSceneStatus(`🖌 Repainting ${total ?? ''} strokes…`);
            else setSceneStatus(null);
          }}
          onArError={(e) => Alert.alert('AR Error', e.nativeEvent.message)}
        />

        {/* Scene load status banner */}
        {sceneStatus && (
          <View style={styles.sceneBanner} pointerEvents="none">
            <Text style={styles.sceneBannerText}>{sceneStatus}</Text>
          </View>
        )}

        {/* Only shown after a real paint attempt misses every detected AR plane. */}
        {surfaceHintVisible && (
          <View
            style={[styles.surfaceHintWrap, { top: Math.max(insets.top + 54, 70) }]}
            pointerEvents="none"
          >
            <View style={styles.surfaceHintPill}>
              {surfaceHintMode === 'text' ? (
                <Text style={styles.surfaceHintText}>Look around a little more</Text>
              ) : (
                <Animated.View style={{ transform: [{ translateX: surfaceHintX }] }}>
                  <Text style={styles.surfaceHintEyes}>👁️ 👁️</Text>
                </Animated.View>
              )}
            </View>
          </View>
        )}

        {/* Top toolbar — single compact row, sized to always fit the screen:
            tools · camera+lidar info · trash · close */}
        {uiMode === 'paint' && (
        <View style={[styles.topToolbarWrap, { top: Math.max(0, insets.top - 22) }]} pointerEvents="box-none">
          <View style={styles.topToolbar}>
            {([
              { key: 'brush', emoji: '🖌️', active: toolMode === 'brush', onPress: toggleBrushPanel, label: 'Brush tool (mirror · rotate · alpha · pick)' },
              { key: 'line', emoji: '📏', active: toolMode === 'line', onPress: () => { void Haptics.selectionAsync(); setToolMode('line'); }, label: 'Line tool' },
              { key: 'eraser', emoji: '🧽', active: toolMode === 'eraser' || washOn, onPress: () => {
                  void Haptics.selectionAsync();
                  // Wash is persistent. While it is active, one sponge tap
                  // reopens Specials so the same button can toggle it OFF.
                  if (washOn) { openSpecialsRef.current?.(); return; }
                  setToolMode('eraser');
                  const now = Date.now();
                  if (now - eraserTapAtRef.current < 350) { eraserTapAtRef.current = 0; openSpecialsRef.current?.(); }
                  else { eraserTapAtRef.current = now; }
                }, label: washOn ? 'Wash active — tap to reopen specials' : 'Eraser tool (double-tap for specials)' },
              { key: 'texture', emoji: '🖼️', active: toolMode === 'smudge', onPress: () => {
                  void Haptics.selectionAsync();
                  if (toolMode === 'smudge') {
                    setToolMode('brush');
                    dispatch({ type: 'SET_BRUSH_OPACITY', opacity: 1 }); // → 💯 opaque
                  } else {
                    setToolMode('smudge');                              // → paint with live camera texture
                  }
                }, label: toolMode === 'smudge' ? 'Texture tool active — tap for brush' : 'Texture tool (paint with live camera)' },
              { key: 'anim', emoji: '🎞️', active: animationEnabled, onPress: () => {
                  void Haptics.selectionAsync();
                  toggleAnimator(!animationEnabled); // ON = looping play immediately
                }, label: 'Toggle AR Animator' },
              { key: 'settings', emoji: '⚙️', onPress: () => { void Haptics.selectionAsync(); void loadSceneList(); setUiMode('settings'); }, label: 'AR settings' },
              { key: 'undo', emoji: '↩️', disabled: undoCount === 0, onPress: () => { void wallViewRef.current?.undo(); }, label: 'Undo' },
              { key: 'redo', emoji: '↪️', disabled: redoCount === 0, onPress: () => { void wallViewRef.current?.redo(); }, label: 'Redo' },
              { key: 'camera', emoji: '📸', onPress: () => { void Haptics.selectionAsync(); setUiMode('cameraOptions'); }, label: 'Camera options' },
              { key: 'clear', emoji: '🗑️', disabled: undoCount === 0 && !washOn, onPress: handleTrashPress, label: 'Clear all strokes (double-tap for specials)' },
            ] as const).map((btn) => (
              <TouchableOpacity
                key={btn.key}
                style={[
                  styles.topToolButton,
                  ('active' in btn && btn.active) ? styles.topToolButtonActive : null,
                  ('disabled' in btn && btn.disabled) ? styles.topToolButtonDisabled : null,
                ]}
                onPress={btn.onPress}
                disabled={'disabled' in btn ? btn.disabled : false}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={btn.label}
              >
                <Text style={styles.topToolEmoji}>{btn.emoji}</Text>
              </TouchableOpacity>
            ))}
            {onSwitchToFrontCamera && (
              <TouchableOpacity
                style={styles.topToolButton}
                onPress={() => {
                  void Haptics.selectionAsync();
                  hideBrushPanel();
                  setUiMode('paint');
                  onSwitchToFrontCamera();
                }}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Switch to Front Camera"
              >
                <Text style={styles.topToolEmoji}>🙂</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.topToolButton}
              onPress={onClose}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Close AR painting"
            >
              <Text style={styles.topToolEmoji}>❎</Text>
            </TouchableOpacity>
          </View>
          {/* LiDAR / plane info — mini line right under the row */}
          <Text style={styles.topStatusText}>
            {lidarActive ? '🛰 LiDAR' : '📐 Planes'} · {undoCount} strokes
          </Text>
        </View>
        )}

        {/* RoomPlan stays invisible while scanning. Once the room reaches a
            strong confidence, these controls only toggle its preview or save
            package; the live painting nodes remain untouched. */}
        {uiMode === 'paint' && roomReadiness && roomReadiness.state !== 'unsupported' && roomReadiness.state !== 'scanning' && (
          <View style={[styles.roomControls, { top: Math.max(0, insets.top - 22) + 82 }]} pointerEvents="box-none">
            <TouchableOpacity
              style={[styles.roomButton, roomPreviewEnabled && styles.roomButtonActive]}
              onPress={() => {
                void Haptics.selectionAsync();
                setRoomPreviewEnabled((enabled) => !enabled);
              }}
              accessibilityRole="button"
              accessibilityLabel="Toggle live room preview"
            >
              <Text style={styles.roomButtonText}>🏠 AR ROOM</Text>
            </TouchableOpacity>
            {roomReadiness.state === 'roomReady' && (
              <TouchableOpacity
                style={styles.roomButton}
                onPress={() => { void Haptics.selectionAsync(); void openLiveRoomViewer(); }}
                disabled={roomViewerLoading}
                accessibilityRole="button"
                accessibilityLabel="Open room 3D viewer"
              >
                <Text style={styles.roomButtonText}>{roomViewerLoading ? '…' : '🧊 3D VIEW'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.roomButton, !canSaveRoom && styles.roomButtonDisabled]}
              onPress={() => { void Haptics.selectionAsync(); void handleSaveScene(); }}
              disabled={!canSaveRoom}
              accessibilityRole="button"
              accessibilityLabel="Save room"
            >
              <Text style={styles.roomButtonText}>💾 SAVE</Text>
            </TouchableOpacity>
          </View>
        )}

        {uiMode === 'paint' && roomReadiness && roomReadiness.state !== 'unsupported' && roomReadiness.state !== 'roomReady' && (
          <View style={[styles.roomTrackingPill, { top: Math.max(0, insets.top - 22) + 116 }]} pointerEvents="none">
            <Text style={styles.roomTrackingText}>🏠 ROOM TRACKING · {Math.round((roomReadiness.confidence || 0) * 100)}%</Text>
          </View>
        )}

        {/* Brush mini-panel under 🖌️ — quick mirror/rotate/alpha + last-5 emojis (tap 🖌️ to toggle) */}
        {uiMode === 'paint' && brushPanelOpen && (
          <View
            style={{
              position: 'absolute', top: Math.max(0, insets.top - 22) + 60, alignSelf: 'center',
              backgroundColor: 'rgba(18,18,18,0.96)', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12,
              borderWidth: 1, borderColor: '#333', gap: 10, zIndex: 50
            }}
          >
            {/* last-5 picked emojis + open full picker */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
              {recentEmojis.slice(0, 5).map((e) => (
                <TouchableOpacity
                  key={e}
                  onPress={() => { void Haptics.selectionAsync(); setBrushEmoji(e); }}
                  style={{ padding: 5, borderRadius: 10, borderWidth: 2, borderColor: e === brushEmoji ? '#ff6b6b' : '#333', backgroundColor: '#222' }}
                  accessibilityLabel={`Use ${e}`}
                >
                  <BrushEmojiIcon emoji={e} size={26} textStyle={{ fontSize: 26 }} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => { void Haptics.selectionAsync(); setPickerVisible(true); }}
                style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' }}
                accessibilityLabel="Open full emoji picker"
              >
                <Text style={{ fontSize: 20 }}>🔍</Text>
              </TouchableOpacity>
            </View>
            {/* mirror · rotate · alpha toggles */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
              {([
                { key: 'mx', label: '↔️', active: mirrorX, onPress: () => setMirrorX(!mirrorX) },
                { key: 'my', label: '↕️', active: mirrorY, onPress: () => setMirrorY(!mirrorY) },
                { key: 'rl', label: '↺', active: false, onPress: onTurnLeft },
                { key: 'rr', label: '↻', active: false, onPress: onTurnRight },
                { key: 'mode', label: brushModeIcon, active: toolMode === 'smudge' || isOpacityMostlyTransparent, onPress: cycleBrushMode },
              ] as const).map((t) => (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => { void Haptics.selectionAsync(); t.onPress(); }}
                  style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#222', borderWidth: 2, borderColor: t.active ? '#ff6b6b' : '#333' }}
                  accessibilityLabel={t.key}
                >
                  <Text style={{ fontSize: 20 }}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Bottom controls — same layout as the 2D workspace */}
        {uiMode === 'paint' && (
        <View style={[styles.bottomControls, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          {/* Emoji picker bubble (same as 2D selected-emoji button) */}
          <TouchableOpacity
            style={styles.emojiBubble}
            onPress={() => { void Haptics.selectionAsync(); setPickerVisible(true); }}
            accessibilityLabel="Choose brush emoji"
          >
            <BrushEmojiIcon emoji={brushEmoji || '🙂'} size={30} textStyle={{ fontSize: 30 }} />
          </TouchableOpacity>

          {/* Dice — between emoji picker and size slider for one-thumb access */}
          <TouchableOpacity
            style={styles.diceButton}
            onPress={handleRandomEmoji}
            accessibilityLabel="Random emoji"
          >
            <Text style={{ fontSize: 24 }}>🎲</Text>
          </TouchableOpacity>

          <View style={styles.slidersColumn}>
            {/* Size slider — no number; a 3D preview shows the actual size */}
            <View style={styles.sliderRow}>
              <Slider
                style={styles.slider}
                minimumValue={MIN_BRUSH_METERS}
                maximumValue={MAX_BRUSH_METERS}
                value={brushSizeMeters}
                onValueChange={(v) => {
                  setBrushSizeMeters(v);
                  void wallViewRef.current?.previewBrushSize();
                }}
                minimumTrackTintColor="#ff6b6b"
                maximumTrackTintColor="#333"
                thumbTintColor="#ff6b6b"
                accessibilityLabel="Brush size"
              />
            </View>
          </View>

          {/* One cycling brush-mode button — like the 2D workspace:
              💯 opaque → 1️⃣ transparent → 👇 smudge (drag to smear the real
              world into the wall, liquid). The size slider doubles as smudge size. */}
          <TouchableOpacity
            style={[styles.alphaToggle, toolMode === 'smudge' && styles.alphaToggleActive]}
            onPress={cycleBrushMode}
            accessibilityLabel="Brush mode: opaque, transparent, or smudge"
          >
            <Text style={{ fontSize: 22 }}>{brushModeIcon}</Text>
          </TouchableOpacity>
        </View>
        )}

        {/* Camera texture scale and rotation are mapped automatically from the
            same AR frame; only the three creative smudge controls remain. */}
        {uiMode === 'paint' && toolMode === 'smudge' && (
          <View
            style={[
              styles.smudgeControlsWrap,
              animationEnabled && { bottom: animationTimelineExpanded ? 226 : 158 },
            ]}
            pointerEvents="box-none"
          >
            <View style={styles.smudgeControlColumn}>
              <View style={styles.smudgeControlHeader}>
                <Text style={[styles.smudgeControlLabel, { color: '#35d6c8' }]}>〰 Flow</Text>
                <TouchableOpacity
                  style={[styles.smudgeBypass, smudgeFlowEnabled && { backgroundColor: '#35d6c8' }]}
                  onPress={() => setSmudgeFlowEnabled((enabled) => !enabled)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: smudgeFlowEnabled }}
                  accessibilityLabel="Enable smudge flow"
                >
                  <Text style={styles.smudgeBypassText}>{smudgeFlowEnabled ? '✓' : '–'}</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.smudgeVerticalBox, { borderColor: '#35d6c866', opacity: smudgeFlowEnabled ? 1 : 0.35 }]}>
                <Slider
                  style={styles.smudgeVerticalSlider}
                  minimumValue={0}
                  maximumValue={1}
                  value={smudgeFlow}
                  onValueChange={setSmudgeFlow}
                  disabled={!smudgeFlowEnabled}
                  minimumTrackTintColor="#35d6c8"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#35d6c8"
                  accessibilityLabel="Smudge flow"
                  accessibilityHint="Down locks and repeats the first sharp camera patch; center keeps the original behavior; up creates a soft dense local mix"
                />
              </View>
            </View>
            <View style={styles.smudgeControlColumn}>
              <View style={styles.smudgeControlHeader}>
                <Text style={[styles.smudgeControlLabel, { color: '#ff9f43' }]}>◉ Focus</Text>
                <TouchableOpacity
                  style={[styles.smudgeBypass, smudgeFocusEnabled && { backgroundColor: '#ff9f43' }]}
                  onPress={() => setSmudgeFocusEnabled((enabled) => !enabled)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: smudgeFocusEnabled }}
                  accessibilityLabel="Enable smudge focus"
                >
                  <Text style={styles.smudgeBypassText}>{smudgeFocusEnabled ? '✓' : '–'}</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.smudgeVerticalBox, { borderColor: '#ff9f4366', opacity: smudgeFocusEnabled ? 1 : 0.35 }]}>
                <Slider
                  style={styles.smudgeVerticalSlider}
                  minimumValue={0}
                  maximumValue={1}
                  value={smudgeFocus}
                  onValueChange={setSmudgeFocus}
                  disabled={!smudgeFocusEnabled}
                  minimumTrackTintColor="#ff9f43"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#ff9f43"
                  accessibilityLabel="Smudge focus"
                  accessibilityHint="Down keeps lifted detail sharp; center keeps the original behavior; up creates a soft cloudy smudge"
                />
              </View>
            </View>
            <View style={styles.smudgeControlColumn}>
              <View style={styles.smudgeControlHeader}>
                <Text style={[styles.smudgeControlLabel, { color: '#8b6dff' }]}>👇 Reach</Text>
                <TouchableOpacity
                  style={[styles.smudgeBypass, smudgeReachEnabled && { backgroundColor: '#8b6dff' }]}
                  onPress={() => setSmudgeReachEnabled((enabled) => !enabled)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: smudgeReachEnabled }}
                  accessibilityLabel="Enable smudge reach"
                >
                  <Text style={styles.smudgeBypassText}>{smudgeReachEnabled ? '✓' : '–'}</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.smudgeVerticalBox, { borderColor: '#8b6dff66', opacity: smudgeReachEnabled ? 1 : 0.35 }]}>
                <Slider
                  style={styles.smudgeVerticalSlider}
                  minimumValue={0}
                  maximumValue={AR_SMUDGE_MAX_REACH}
                  value={smudgeStrength}
                  onValueChange={setSmudgeStrength}
                  disabled={!smudgeReachEnabled}
                  minimumTrackTintColor="#8b6dff"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#8b6dff"
                  accessibilityLabel="Smudge reach"
                  accessibilityHint="How far behind your finger real camera pixels are sampled and dragged onto the wall. Down = short dry smear; up = long strong pull"
                />
              </View>
            </View>
          </View>
        )}

        {/* AR Animator timeline — controlled by the JS playhead (2D-Animator style). */}
        {uiMode === 'paint' && animationEnabled && (
          <View
            style={[
              styles.animationTimelineWrap,
              { bottom: Math.max(insets.bottom, 14) + 88 },
            ]}
            pointerEvents="box-none"
          >
            <ArAnimatorTimeline
              fps={animationFps}
              strokeLength={animationStrokeLength}
              backgroundStroke={animationBackgroundStroke}
              totalFrames={animationTotalFrames}
              currentFrame={animationPlayhead}
              playing={animationPlaying}
              looping={animationLooping}
              expanded={animationTimelineExpanded}
              onSetFps={setAnimationFps}
              onSetStrokeLength={setAnimationStrokeLength}
              onSetPlaying={setAnimationPlaying}
              onSetLooping={setAnimationLooping}
              onSetExpanded={setAnimationTimelineExpanded}
              onSeek={handleAnimationSeek}
              onFrameTick={pushFrameToNative}
            />
          </View>
        )}

        {/* Long-press "specials" effects menu (auto-hides after 5s). */}
        {uiMode === 'paint' && specialsVisible && (
          <View
            style={[styles.specialsWrap, { bottom: Math.max(insets.bottom, 14) + 96 }]}
            pointerEvents="box-none"
          >
            <View style={styles.specialsPanel}>
              <TouchableOpacity
                style={[styles.specialBtn, meltdownOn && styles.specialBtnActive]}
                onPress={toggleMeltdown}
                accessibilityLabel="Meltdown effect"
              >
                <Text style={styles.specialEmoji}>🫠</Text>
                <Text style={styles.specialLabel}>{meltdownOn ? 'Melting…' : 'Meltdown'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.specialBtn, destroyOn && styles.specialBtnActive]}
                onPress={toggleDestroy}
                accessibilityLabel="Destroy effect"
              >
                <Text style={styles.specialEmoji}>💥</Text>
                <Text style={styles.specialLabel}>{destroyOn ? 'Destroying…' : 'Destroy'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.specialBtn, washOn && styles.specialBtnActive]}
                onPress={toggleWash}
                accessibilityLabel="Wash effect"
                accessibilityHint="Washes the painted strokes down the real surfaces with water"
              >
                <Text style={styles.specialEmoji}>💧</Text>
                <Text style={styles.specialLabel}>{washOn ? 'Washing…' : 'Wash'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.specialsHint}>✨ Specials · {meltdownOn ? 'tap Meltdown to stop' : destroyOn ? 'tap Destroy to stop' : washOn ? 'tap Wash to stop' : 'pick an effect'}</Text>
          </View>
        )}

        {/* AR painting settings (distinct from face filter) */}
        {uiMode === 'settings' && (
          <View style={styles.settingsOverlay}>
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>🧱 AR Painting Settings</Text>
              <TouchableOpacity
                onPress={() => { void Haptics.selectionAsync(); setUiMode('paint'); }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Close settings"
              >
                <Text style={{ fontSize: 24 }}>❎</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.settingsContent}>
              {savedRooms.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text style={styles.roomsSectionTitle}>🏠 Saved Rooms</Text>
                  {savedRooms.map((scene) => (
                    <View key={scene.dir} style={styles.sceneItem}>
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                        onPress={() => { void Haptics.selectionAsync(); void handleLoadScene(scene); }}
                      >
                        <Image source={{ uri: `file://${scene.snapshotPath}` }} style={styles.sceneThumb} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modeButtonTitle}>
                            {new Date(scene.createdAt).toLocaleDateString()} · {new Date(scene.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                          <Text style={styles.modeButtonSub}>{scene.strokeCount} strokes · tap to load AR</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.sceneViewerButton}
                        onPress={() => { void Haptics.selectionAsync(); openSavedRoomViewer(scene); }}
                        accessibilityLabel="Open saved room 3D viewer"
                      >
                        <Text style={styles.sceneViewerText}>3D</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>🥫 3D spray can</Text>
                <Switch value={sprayCanEnabled} onValueChange={setSprayCanEnabled} trackColor={{ false: '#444', true: '#ff6b6b' }} />
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>🔊 Spray &amp; shake sounds</Text>
                <Switch value={soundEnabled} onValueChange={setSoundEnabled} trackColor={{ false: '#444', true: '#ff6b6b' }} />
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>📐 Grid on surface found</Text>
                <Switch value={gridEnabled} onValueChange={setGridEnabled} trackColor={{ false: '#444', true: '#ff6b6b' }} />
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>🧱 Wall occlusion</Text>
                <Switch value={occlusion} onValueChange={setOcclusion} trackColor={{ false: '#444', true: '#ff6b6b' }} />
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>🧍 People over strokes</Text>
                <Switch value={personOcclusion} onValueChange={setPersonOcclusion} trackColor={{ false: '#444', true: '#ff6b6b' }} />
              </View>
              <View style={styles.settingRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.settingLabel}>🌑 Stroke shadows</Text>
                  <Text style={styles.settingInlineHint}>Strokes cast a shadow onto the surface (lifts them slightly off the wall)</Text>
                </View>
                <Switch value={strokeShadows} onValueChange={setStrokeShadows} trackColor={{ false: '#444', true: '#ff6b6b' }} />
              </View>
              <View style={styles.settingRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.settingLabel}>🧱 Stacking strokes</Text>
                  <Text style={styles.settingInlineHint}>Painting over a stroke lifts the new one a hair higher — stack layers without z-fighting</Text>
                </View>
                <Switch value={strokeStacking} onValueChange={setStrokeStacking} trackColor={{ false: '#444', true: '#ff6b6b' }} />
              </View>
              {strokeStacking && (
                <>
                  <View style={styles.settingRow}>
                    <Text style={styles.settingLabel}>📏 Stack height</Text>
                    <Text style={styles.sunCurrentLabel}>{Math.round(strokeStackHeight * 100)}%</Text>
                  </View>
                  <Slider
                    minimumValue={0}
                    maximumValue={1}
                    value={strokeStackHeight}
                    onValueChange={setStrokeStackHeight}
                    minimumTrackTintColor="#8b6dff"
                    maximumTrackTintColor="#444"
                    thumbTintColor="#8b6dff"
                    style={{ height: 36, marginTop: -4 }}
                  />
                  <Text style={styles.settingInlineHint}>Minimal on purpose — each layer only rises ~0.4–3 mm.</Text>
                </>
              )}

              <View style={styles.settingRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.settingLabel}>🎞️ AR Animator</Text>
                  <Text style={styles.settingInlineHint}>Draw strokes in time on real surfaces</Text>
                </View>
                <Switch
                  value={animationEnabled}
                  onValueChange={(enabled) => {
                    void Haptics.selectionAsync();
                    toggleAnimator(enabled); // ON = looping play immediately
                  }}
                  trackColor={{ false: '#444', true: '#76b900' }}
                />
              </View>
              {animationEnabled && (
                <View style={styles.animationSettingsCard}>
                  <Text style={styles.settingInlineHint}>
                    ⏱ FPS and 🖌 stroke life now live on the timeline in the paint view — change them on the fly.
                  </Text>
                  <View style={styles.settingRow}>
                    <Text style={styles.settingLabel}>🎞 Timeline length</Text>
                    <Text style={styles.animationSettingValue}>{animationTotalFrames} frames</Text>
                  </View>
                  <Slider
                    minimumValue={2}
                    maximumValue={AR_ANIMATION_MAX_FRAMES}
                    step={1}
                    value={animationTotalFrames}
                    onValueChange={(value) => setAnimationTotalFrames(Math.round(value))}
                    minimumTrackTintColor="#76ff03"
                    maximumTrackTintColor="#444"
                    thumbTintColor="#76ff03"
                    style={styles.animationSettingSlider}
                    accessibilityLabel="AR animation timeline length"
                  />
                  <Text style={styles.settingInlineHint}>Starts at a lightweight 90 frames; maximum is 900.</Text>

                  <View style={styles.settingRow}>
                    <Text style={styles.settingLabel}>∞ Permanent background strokes</Text>
                    <Switch
                      value={animationBackgroundStroke}
                      onValueChange={setAnimationBackgroundStroke}
                      trackColor={{ false: '#444', true: '#4caf50' }}
                    />
                  </View>
                  <View style={styles.settingRow}>
                    <Text style={styles.settingLabel}>↻ Loop playback</Text>
                    <Switch
                      value={animationLooping}
                      onValueChange={setAnimationLooping}
                      trackColor={{ false: '#444', true: '#76b900' }}
                    />
                  </View>
                  <Text style={styles.settingInlineHint}>
                    Strokes already painted before Animator was enabled stay visible as the background. Paint while playing to draw directly through time.
                  </Text>
                </View>
              )}

              {/* One slider steps through all sun moods; the big chip shows the current one */}
              <View style={styles.sunHeader}>
                <Text style={styles.settingLabel}>☀️ Sun &amp; shadows</Text>
                <View style={styles.sunCurrent}>
                  <Text style={styles.sunCurrentEmoji}>{SUN_PRESETS[sunIndex].emoji}</Text>
                  <Text style={styles.sunCurrentLabel}>{SUN_PRESETS[sunIndex].label}</Text>
                </View>
              </View>
              <Slider
                minimumValue={0}
                maximumValue={SUN_PRESETS.length - 1}
                step={1}
                value={sunIndex}
                onValueChange={(v) => {
                  const s = SUN_PRESETS[Math.round(v)];
                  if (!s || s.key === sunPreset) return;
                  void Haptics.selectionAsync();
                  setSunPreset(s.key);
                  setShadowStrength(s.shadow);
                }}
                minimumTrackTintColor="#ffcf5c"
                maximumTrackTintColor="#444"
                thumbTintColor="#ffcf5c"
                style={{ height: 36 }}
              />
              <View style={styles.sunTicks}>
                {SUN_PRESETS.map((s) => (
                  <Text key={s.key} style={[styles.sunTick, s.key === sunPreset && styles.sunTickActive]}>{s.emoji}</Text>
                ))}
              </View>

              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>🌑 Shadow strength</Text>
                <Text style={styles.sunCurrentLabel}>{Math.round(shadowStrength * 100)}%</Text>
              </View>
              <Slider
                minimumValue={0}
                maximumValue={1}
                value={shadowStrength}
                onValueChange={setShadowStrength}
                minimumTrackTintColor="#ff6b6b"
                maximumTrackTintColor="#444"
                thumbTintColor="#ff6b6b"
                disabled={sunPreset === 'off'}
                style={{ height: 36, marginTop: -4, opacity: sunPreset === 'off' ? 0.4 : 1 }}
              />

              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>💡 Light on strokes</Text>
                <Text style={styles.sunCurrentLabel}>{Math.round(strokeLightAmount * 100)}%</Text>
              </View>
              <Slider
                minimumValue={0}
                maximumValue={1}
                value={strokeLightAmount}
                onValueChange={setStrokeLightAmount}
                minimumTrackTintColor="#6bd0ff"
                maximumTrackTintColor="#444"
                thumbTintColor="#6bd0ff"
                style={{ height: 36, marginTop: -4 }}
              />

              <View style={styles.settingRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.settingLabel}>🌞 Sun follows your aim</Text>
                  <Text style={styles.settingInlineHint}>The sun swings toward where you paint — shadows move with you</Text>
                </View>
                <Switch value={sunFollowEnabled} onValueChange={setSunFollowEnabled} trackColor={{ false: '#444', true: '#ffcf5c' }} />
              </View>
              {sunFollowEnabled && (
                <>
                  <View style={styles.settingRow}>
                    <Text style={styles.settingLabel}>🌀 Sun follow speed</Text>
                    <Text style={styles.sunCurrentLabel}>{Math.round(sunFollowSpeed * 100)}%</Text>
                  </View>
                  <Slider
                    minimumValue={0}
                    maximumValue={1}
                    value={sunFollowSpeed}
                    onValueChange={setSunFollowSpeed}
                    minimumTrackTintColor="#ffcf5c"
                    maximumTrackTintColor="#444"
                    thumbTintColor="#ffcf5c"
                    style={{ height: 36, marginTop: -4 }}
                  />
                </>
              )}

              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>🌫️ Blend strokes into world</Text>
                <Switch value={blendFilter} onValueChange={setBlendFilter} trackColor={{ false: '#444', true: '#ff6b6b' }} />
              </View>
              {blendFilter && (
                <>
                  <View style={styles.settingRow}>
                    <Text style={styles.settingLabel}>🎚️ Merge amount</Text>
                    <Text style={styles.sunCurrentLabel}>{Math.round(blendAmount * 100)}%</Text>
                  </View>
                  <Slider
                    minimumValue={0}
                    maximumValue={1}
                    value={blendAmount}
                    onValueChange={setBlendAmount}
                    minimumTrackTintColor="#9d7bff"
                    maximumTrackTintColor="#444"
                    thumbTintColor="#9d7bff"
                    style={{ height: 36, marginTop: -4 }}
                  />
                  <Text style={styles.settingHint}>
                    Far strokes fade &amp; take the room’s colour; dark rooms darken the strokes and shadows fall across them — so paint sits in the real scene.
                  </Text>
                </>
              )}

              <Text style={styles.settingHint}>
                Brush size and opacity are on the painting screen. These settings affect only AR painting — the face filter has its own.
              </Text>
            </ScrollView>
          </View>
        )}

        {/* Camera options hub */}
        {uiMode === 'cameraOptions' && (
          <View style={styles.modeOverlay}>
            <View style={styles.modePanel}>
              <Text style={styles.modeTitle}>📸 Camera</Text>
              <TouchableOpacity style={styles.modeButton} onPress={() => { void handlePlaceMedia(); }}>
                <Text style={styles.modeButtonEmoji}>🖼️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeButtonTitle}>Add Image / Video to Wall</Text>
                  <Text style={styles.modeButtonSub}>Pick from library, drag + pinch, then place it in the room</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modeButton} onPress={() => { void Haptics.selectionAsync(); setUiMode('capture'); }}>
                <Text style={styles.modeButtonEmoji}>📷</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeButtonTitle}>Photo / Video</Text>
                  <Text style={styles.modeButtonSub}>Capture your AR scene straight to Photos</Text>
                </View>
              </TouchableOpacity>
              {onSwitchToFrontCamera && (
                <TouchableOpacity
                  style={styles.modeButton}
                  onPress={() => { void Haptics.selectionAsync(); setUiMode('paint'); onSwitchToFrontCamera(); }}
                >
                  <Text style={styles.modeButtonEmoji}>🙂</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modeButtonTitle}>Front Camera</Text>
                    <Text style={styles.modeButtonSub}>Switch scenes — both paintings stay exactly where you left them</Text>
                  </View>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.modeButton} onPress={() => { void handleSaveScene(); }}>
                <Text style={styles.modeButtonEmoji}>💾</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeButtonTitle}>Save AR Scene</Text>
                  <Text style={styles.modeButtonSub}>Room map + all strokes — reload it in the same room later</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modeButton}
                onPress={() => { void Haptics.selectionAsync(); void loadSceneList(); setUiMode('scenes'); }}
              >
                <Text style={styles.modeButtonEmoji}>📂</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeButtonTitle}>My AR Scenes</Text>
                  <Text style={styles.modeButtonSub}>Load a saved room — it finds the spot and repaints itself</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modeCancel} onPress={() => setUiMode('paint')}>
                <Text style={styles.modeCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Media placement: drag + pinch, then place */}
        {uiMode === 'placing' && (
          <View style={styles.placingBar} pointerEvents="box-none">
            <Text style={styles.placingHint}>👆 Drag to move · 🤏 Pinch to scale</Text>
            <View style={styles.placingButtons}>
              <TouchableOpacity style={styles.placingCancel} onPress={() => { void handleCancelPlacement(); }}>
                <Text style={styles.placingCancelText}>✖ Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.placingConfirm} onPress={() => { void handleConfirmPlacement(); }}>
                <Text style={styles.placingConfirmText}>✅ Place</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Saved AR scenes library */}
        {uiMode === 'scenes' && (
          <View style={styles.modeOverlay}>
            <View style={[styles.modePanel, { maxHeight: '75%' }]}>
              <Text style={styles.modeTitle}>📂 My AR Scenes</Text>
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                {savedScenes.length === 0 && (
                  <Text style={styles.modeButtonSub}>No saved scenes yet — paint something and use 💾 Save AR Scene.</Text>
                )}
                {savedScenes.map((scene) => (
                  <View key={scene.dir} style={styles.sceneItem}>
                    <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={() => { void handleLoadScene(scene); }}>
                      <Image source={{ uri: `file://${scene.snapshotPath}` }} style={styles.sceneThumb} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.modeButtonTitle}>
                          {new Date(scene.createdAt).toLocaleDateString()} · {new Date(scene.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        <Text style={styles.modeButtonSub}>{scene.strokeCount} strokes · tap to load AR</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.sceneViewerButton} onPress={() => openSavedRoomViewer(scene)} accessibilityLabel="Open saved room 3D viewer">
                      <Text style={styles.sceneViewerText}>3D</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.sceneDeleteButton} onPress={() => {
                      Alert.alert('Delete scene?', 'Remove this saved AR scene?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => void handleDeleteScene(scene) },
                      ]);
                    }} accessibilityLabel="Delete saved room">
                      <Text style={styles.sceneDeleteText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.modeCancel} onPress={() => setUiMode('paint')}>
                <Text style={styles.modeCancelText}>Back</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Direct capture mode: centered circle — tap photo, hold film */}
        {uiMode === 'capture' && (
          <View style={styles.captureBar} pointerEvents="box-none">
            <TouchableOpacity
              style={[styles.captureBack, { top: insets.top + 10 }]}
              onPress={() => { void handleFilmStop(); setUiMode('paint'); }}
              accessibilityLabel="Back to painting"
            >
              <Text style={{ fontSize: 20 }}>⬅️</Text>
            </TouchableOpacity>
            <View style={styles.captureCenter}>
              <TouchableOpacity
                style={[styles.captureButton, recording && styles.captureButtonRecording]}
                onPress={() => void handleCapturePhoto()}
                onLongPress={() => void handleFilmStart()}
                onPressOut={() => void handleFilmStop()}
                delayLongPress={350}
                accessibilityLabel="Take photo, hold to record"
              >
                <View style={[styles.captureInner, recording && styles.captureInnerRecording]} />
              </TouchableOpacity>
              <Text style={styles.captureHint}>tap photo · hold film{recording ? ' · 🔴 REC' : ''}</Text>
            </View>
          </View>
        )}

        <RoomViewerModal
          visible={roomViewerVisible}
          onClose={() => { setRoomViewerVisible(false); setRoomViewerData(null); setRoomViewerDir(null); }}
          data={roomViewerData}
          roomDir={roomViewerDir}
          title="EmojiPainter Room"
          onOpenAR={() => { setRoomViewerVisible(false); setRoomViewerData(null); setRoomViewerDir(null); setUiMode('paint'); }}
        />

        {/* The REAL Brush Library picker (identical to the 2D workspace):
            last-picked preview, recents, mirror/rotate, spacing slider, search
            grid, and the 🎨 Color-Engine ring toggle. Opened from the bubble. */}
        <EmojiPickerModal
          visible={pickerVisible}
          styles={emojiPickerStyles}
          emojiSearch={emojiSearch}
          onEmojiSearchChange={setEmojiSearch}
          recentEmojis={recentEmojis}
          // The PICKER needs the raw brush value (a `custom_brush_<n>` id for custom brushes) so it can
          // highlight the selected entry — not the resolved data URI that only the native view wants.
          brushEmoji={brushEmoji}
          emojiResults={emojiResults}
          onSelectEmoji={handlePickEmoji}
          onClose={() => setPickerVisible(false)}
          hitSlop={HIT_SLOP}
          mirrorX={mirrorX}
          mirrorY={mirrorY}
          rotation={brushRotation}
          onToggleMirrorX={() => setMirrorX(!mirrorX)}
          onToggleMirrorY={() => setMirrorY(!mirrorY)}
          spacingSlider={spacingSlider}
          onTurnLeft={onTurnLeft}
          onTurnRight={onTurnRight}
        />
      </View>
    </View>
  );
};

// The top toolbar's buttons are flex:1, so they already stretch to any width —
// only their HEIGHT and glyph size need help. An iPad has the room to make them
// a fifth larger and easier to hit; phones and small screens keep the compact
// sizing, where the row is already tight.
const IS_PAD = Platform.OS === 'ios' && Platform.isPad;
const TOP_TOOL_SCALE = IS_PAD ? 1.2 : 1;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topToolbarWrap: {
    position: 'absolute',
    left: 8,
    right: 8,
    alignItems: 'center',
    zIndex: 30,
  },
  topToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 3,
    backgroundColor: 'rgba(15,15,15,0.92)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 5 * TOP_TOOL_SCALE,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2d2d2d',
  },
  // flex:1 buttons share the row equally — always fits any screen width
  topToolButton: {
    flex: 1,
    backgroundColor: 'rgba(31,31,31,0.85)',
    borderRadius: 8,
    paddingVertical: 6 * TOP_TOOL_SCALE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topToolButtonActive: { backgroundColor: '#ff6b6b' },
  topToolButtonDisabled: { opacity: 0.35 },
  topToolEmoji: { fontSize: 15 * TOP_TOOL_SCALE, color: '#fff' },
  topStatusText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
  roomControls: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 32,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  roomButton: {
    minHeight: 30,
    paddingHorizontal: 9,
    flexShrink: 1,
    borderRadius: 15,
    backgroundColor: 'rgba(16,36,44,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(89,220,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomButtonActive: { backgroundColor: 'rgba(28,104,116,0.95)' },
  roomButtonDisabled: { opacity: 0.58 },
  roomButtonText: { color: '#d9fbff', fontSize: 10, fontWeight: '800' },
  roomTrackingPill: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 31,
    alignItems: 'center',
  },
  roomTrackingText: {
    color: '#c9f5ff',
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: 'rgba(16,36,44,0.9)',
    borderColor: 'rgba(89,220,255,0.55)',
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  surfaceHintWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 80,
    alignItems: 'center',
  },
  surfaceHintPill: {
    minWidth: 156,
    minHeight: 42,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,18,18,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  surfaceHintText: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
  surfaceHintEyes: { color: '#fff', fontSize: 20, lineHeight: 23, textAlign: 'center' },

  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(15,15,15,0.92)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2d2d2d',
  },
  diceButton: {
    backgroundColor: '#2d2d2d',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiBubble: {
    backgroundColor: '#2d2d2d',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slidersColumn: { flex: 1, gap: 0 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sliderLabel: { color: '#fff', fontSize: 12, fontWeight: '600', width: 70 },
  slider: { flex: 1, height: 28 },
  alphaToggle: {
    backgroundColor: 'rgba(31,31,31,0.85)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  alphaToggleActive: { backgroundColor: '#ff6b6b' },
  // Anchored bottom-right above the mode toggle; each experiment has a bypass.
  smudgeControlsWrap: { position: 'absolute', right: 14, bottom: 112, flexDirection: 'row', alignItems: 'flex-end', gap: 8, zIndex: 40 },
  smudgeControlColumn: { width: 50, alignItems: 'center' },
  smudgeControlHeader: { height: 38, marginBottom: 4, alignItems: 'center', justifyContent: 'space-between' },
  smudgeControlLabel: { fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' },
  smudgeBypass: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#555', borderWidth: 1, borderColor: '#ffffff55' },
  smudgeBypassText: { color: '#111', fontSize: 11, fontWeight: '900', lineHeight: 13 },
  smudgeVerticalBox: { width: 46, height: 190, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0009', borderRadius: 23, borderWidth: 1 },
  smudgeVerticalSlider: { width: 180, height: 44, transform: [{ rotate: '-90deg' }] },

  animationTimelineWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 45,
    alignItems: 'center',
  },
  specialsWrap: { position: 'absolute', left: 12, right: 12, zIndex: 60, alignItems: 'center' },
  specialsPanel: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(10,10,10,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,159,107,0.5)',
  },
  specialBtn: {
    width: 92,
    height: 88,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#242424',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  specialBtnActive: { backgroundColor: '#5a2f12', borderColor: '#ff9f6b' },
  specialEmoji: { fontSize: 30 },
  specialLabel: { color: '#fff', fontSize: 12, fontWeight: '800' },
  specialsHint: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 8 },

  fullscreen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 11500,
  },
  hidden: { display: 'none' },

  settingsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,8,8,0.98)',
    zIndex: 40,
    paddingTop: 54,
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  roomsSectionTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  settingsTitle: { color: '#fff', fontSize: 19, fontWeight: '800' },
  settingsContent: { padding: 20, paddingTop: 4, gap: 14 },
  animationSettingsCard: {
    gap: 7,
    padding: 13,
    borderRadius: 16,
    backgroundColor: 'rgba(118,255,3,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(118,255,3,0.22)',
  },
  animationSettingValue: { color: '#b9ff7b', fontSize: 13, fontWeight: '800' },
  animationSettingSlider: { height: 32, marginTop: -5 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingLabel: { color: '#eee', fontSize: 15, fontWeight: '600' },
  settingInlineHint: { color: 'rgba(255,255,255,0.52)', fontSize: 11, lineHeight: 15, marginTop: 2 },
  settingHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 8, lineHeight: 17 },
  sunHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sunCurrent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sunCurrentEmoji: { fontSize: 22 },
  sunCurrentLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sunTicks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6, paddingHorizontal: 6 },
  sunTick: { fontSize: 15, opacity: 0.35 },
  sunTickActive: { opacity: 1 },
  modeOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modePanel: {
    width: '86%',
    maxWidth: 400,
    backgroundColor: 'rgba(18,18,18,0.97)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    padding: 18,
    gap: 10,
  },
  modeTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  modeButtonEmoji: { fontSize: 28 },
  modeButtonTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modeButtonSub: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5, marginTop: 1 },
  modeCancel: { alignItems: 'center', paddingVertical: 8 },
  modeCancelText: { color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '600' },

  placingBar: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    alignItems: 'center',
    gap: 12,
  },
  placingHint: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    overflow: 'hidden',
  },
  placingButtons: { flexDirection: 'row', gap: 14 },
  placingCancel: {
    backgroundColor: 'rgba(40,40,40,0.9)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  placingCancelText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  placingConfirm: {
    backgroundColor: '#4caf50',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: '#fff',
  },
  placingConfirmText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  captureBar: { ...StyleSheet.absoluteFillObject },
  captureBack: {
    position: 'absolute',
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  captureCenter: {
    position: 'absolute',
    bottom: 36,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
  },
  captureButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  captureButtonRecording: { borderColor: '#ff3b30' },
  captureInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  captureInnerRecording: { width: 28, height: 28, borderRadius: 7, backgroundColor: '#ff3b30' },
  captureHint: { color: 'rgba(255,255,255,0.75)', fontSize: 11 },

  sceneBanner: {
    position: 'absolute',
    top: '42%',
    left: 30,
    right: 30,
    alignItems: 'center',
  },
  sceneBannerText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 14,
    overflow: 'hidden',
    textAlign: 'center',
  },
  sceneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    padding: 10,
  },
  sceneThumb: {
    width: 72,
    height: 54,
    borderRadius: 8,
    backgroundColor: '#222',
  },
  sceneViewerButton: {
    width: 42,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#176a79',
  },
  sceneViewerText: { color: '#d9fbff', fontSize: 12, fontWeight: '900' },
  sceneDeleteButton: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(130,38,45,0.7)',
  },
  sceneDeleteText: { color: '#ffd8d8', fontSize: 15, fontWeight: '800' },

  unsupportedWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unsupportedPanel: {
    backgroundColor: '#181818',
    borderRadius: 20,
    padding: 24,
    width: '80%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 16,
  },
  unsupportedText: { color: '#fff', fontSize: 16, textAlign: 'center', lineHeight: 22 },
  unsupportedButton: {
    backgroundColor: '#ff9f6b',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  unsupportedButtonText: { color: '#000', fontSize: 15, fontWeight: '700' },
});

export default ArPaintingScreen;
