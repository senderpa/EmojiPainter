import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useCanvasRef } from '@shopify/react-native-skia';
import { ResizeMode } from 'expo-av';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import VectorCanvas from './VectorCanvas';
import { clearVectorStampCache } from './vectorStampCache';
import {
  panCamera,
  sanitizeCamera,
  screenToWorld,
  worldOriginRebaseOffset,
  worldSizeForScreenBrush,
  zoomAroundFocal,
} from './vectorCamera';
import { evalTimeline, timelineDurationMs } from './vectorTimeline';
import {
  DEFAULT_SPACING_RATIO,
  MIN_SPACING_RATIO,
  VectorBrushMode,
  VectorCameraState,
  VectorLoopMode,
  VectorSample,
  VectorStroke,
  VectorEmojiPlane,
  VectorTraceImage,
  VECTOR_EASING_OPTIONS,
  VectorViewpoint,
} from './vectorTypes';
import {
  clearVectorDocument,
  deleteStroke,
  loadSessionPreviewUri,
  loadVectorDocument,
  loadVectorManifest,
  saveSessionPreview,
  type LoadedVectorDocument,
  saveManifest,
  saveStroke,
} from './vectorDocument';
import { ensureScreenRecordingStopped, startScreenRecording, stopScreenRecording } from '../native/screenRecorder';
import EmojiPickerModal from '../workspace/EmojiPickerModal';
import WorkspaceToolbar from '../workspace/WorkspaceToolbar';
import BrushControls from '../workspace/BrushControls';
import BrushEmojiIcon from '../components/BrushEmojiIcon';
import vectorStyles from '../workspace/sharedWorkspaceStyles';
import { IS_IPAD, LARGE_HIT_SLOP } from '../lib/paintConstants';
import ShortVideoPlayer from '../video/ShortVideoPlayer';
import emojiPickerStyles from '../workspace/emojiPickerStyles';
import { renderableEmojiEntries, searchRenderableEmojis } from '../lib/emojiCatalog';
import { getCustomBrushPNGData, isCustomBrushReference } from '../lib/customBrushRegistry';
import { saveVectorProject } from '../lib/storage';
import { addVideo } from '../video/videoStorage';
import { emitAppEvent } from '../lib/appEvents';
import { smudgeStrength } from '../lib/smudge/smudgeTypes';
import { recordLifetimeStrokeCommit } from '../lib/lifetimeStats';
import { useLifetimeActivity } from '../lib/useLifetimeActivity';
import EmojiPlanePanel, { EMOJI_PLANE_PANEL_WIDTH, type EmojiPlanePanelLayout } from '../components/EmojiPlanePanel';
import {
  findLatticeHandle,
  latticeCorners,
  latticeFromPlaneCorners,
  movePlaneHandle,
  resampleLattice,
  rotatePlaneGeometry,
  scalePlaneGeometry,
  translatePlaneGeometry,
  type LatticeLevel,
} from '../lib/planeLattice';
import { placePanelAwayFromRect } from '../lib/emojiPlanePanelPlacement';
import { projectWorldPoint } from './vectorProjection';
import { vectorPlaneCenter, vectorPlanePoints, vectorPlaneToStroke, vectorPlaneWorldBounds } from './vectorPlane';

// Vector Mode workspace (V1) — the "normal workspace, but vector":
// world-coordinate strokes, focal-point pinch zoom over a huge range, Mac width
// semantics (worldSize = screenBrush/zoom at creation → world-constant after),
// spacing floor 0.00001, crisp Skia re-render at any zoom, schema-v1 documents.
// Gesture arbitration per the handoff: one finger/Pencil draws, two fingers
// always claim pan/zoom and cancel an uncommitted stroke.

/** Screen-point brush range for the shared BrushControls slider. */
const VECTOR_BRUSH_MAX = 240;
/** Densest→loosest stamp spacing, as a ratio of brush size. */
const MAX_SPACING_RATIO = 0.6;
/** BrushControls' spacing slider is fixed at 0.0001…999, so ratios are scaled into it. */
const SPACING_SLIDER_SCALE = 1000;

function formatTimelineDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0.0s';
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1).padStart(4, '0')}s`;
}

interface StampData {
  positions: { x: number; y: number }[];
  carry: number;
  step: number;
  pathLength: number;
}

/** Derive world-space stamp centers from samples (budgeted spacing walk). */
function computeStampData(samples: VectorSample[], worldSize: number, spacingRatio: number): StampData {
  if (samples.length === 0) return { positions: [], carry: 0, step: Math.max(1e-12, worldSize * Math.max(MIN_SPACING_RATIO, spacingRatio)), pathLength: 0 };
  const ratio = Math.max(MIN_SPACING_RATIO, spacingRatio);
  let step = Math.max(1e-12, worldSize * ratio);
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    total += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
  }
  const out: { x: number; y: number }[] = [{ x: samples[0].x, y: samples[0].y }];
  let carried = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const ax = samples[i - 1].x, ay = samples[i - 1].y;
    const dx = samples[i].x - ax, dy = samples[i].y - ay;
    const len = Math.hypot(dx, dy);
    if (len <= 1e-12) continue;
    let d = step - carried;
    while (d <= len) {
      out.push({ x: ax + (dx * d) / len, y: ay + (dy * d) / len });
      d += step;
    }
    carried = len - (d - step);
  }
  return { positions: out, carry: carried, step, pathLength: total };
}

/**
 * Extend a live stroke's stamp cache in O(new segment length). The previous
 * implementation called computeStamps over the complete path on every touch
 * event, turning a long stroke into an accidental O(n²) operation.
 */
function appendStampData(stroke: VectorStroke, sample: VectorSample): StampData {
  const previous = stroke.samples[stroke.samples.length - 1];
  const positions = stroke.stampPositions ?? (stroke.samples[0] ? [{ x: stroke.samples[0].x, y: stroke.samples[0].y }] : []);
  const step = Number.isFinite(stroke.stampStep) && (stroke.stampStep ?? 0) > 0
    ? stroke.stampStep as number
    : Math.max(1e-12, stroke.worldSize * Math.max(MIN_SPACING_RATIO, stroke.spacingRatio));
  let carried = Number.isFinite(stroke.stampCarry) ? stroke.stampCarry as number : 0;
  if (!previous) {
    positions.push({ x: sample.x, y: sample.y });
    return { positions, carry: carried, step, pathLength: 0 };
  }
  const dx = sample.x - previous.x;
  const dy = sample.y - previous.y;
  const len = Math.hypot(dx, dy);
  const pathLength = (Number.isFinite(stroke.stampPathLength) ? stroke.stampPathLength as number : 0) + len;
  if (len <= 1e-12) return { positions, carry: carried, step, pathLength };
  let distance = step - carried;
  while (distance <= len) {
    positions.push({ x: previous.x + (dx * distance) / len, y: previous.y + (dy * distance) / len });
    distance += step;
  }
  carried = len - (distance - step);
  return { positions, carry: carried, step, pathLength };
}

function boundsOf(samples: VectorSample[], worldSize: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of samples) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  const half = worldSize / 2;
  return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
}

function translateStrokeOrigin(stroke: VectorStroke, originX: number, originY: number): VectorStroke {
  const move = (point: { x: number; y: number }) => ({ x: point.x - originX, y: point.y - originY });
  return {
    ...stroke,
    samples: stroke.samples.map((sample) => ({
      ...sample,
      x: sample.x - originX,
      y: sample.y - originY,
    })),
    worldBounds: {
      minX: stroke.worldBounds.minX - originX,
      minY: stroke.worldBounds.minY - originY,
      maxX: stroke.worldBounds.maxX - originX,
      maxY: stroke.worldBounds.maxY - originY,
    },
    stampPositions: stroke.stampPositions?.map((point) => ({
      x: point.x - originX,
      y: point.y - originY,
    })),
    ...(stroke.planeCorners ? {
      planeCorners: {
        topLeft: move(stroke.planeCorners.topLeft),
        topRight: move(stroke.planeCorners.topRight),
        bottomRight: move(stroke.planeCorners.bottomRight),
        bottomLeft: move(stroke.planeCorners.bottomLeft),
      },
    } : {}),
    ...(stroke.planeLattice ? { planeLattice: stroke.planeLattice.map(move) } : {}),
  };
}

/**
 * World-space erase: samples within `radius` of `point` are removed from the
 * stroke. Samples are never persisted as a raw path with "holes" — the
 * spacing walk in computeStamps would bridge a gap with a straight line — so
 * an erased-through stroke is split into separate contiguous fragments, each
 * becoming its own stroke. Returns [stroke] unchanged (same reference) when
 * nothing is hit, so callers can cheaply detect a no-op.
 */
function eraseStrokeAt(stroke: VectorStroke, point: { x: number; y: number }, radius: number): VectorStroke[] {
  if (stroke.samples.length === 0) return [stroke];
  const b = stroke.worldBounds;
  if (point.x + radius < b.minX || point.x - radius > b.maxX || point.y + radius < b.minY || point.y - radius > b.maxY) {
    return [stroke];
  }
  const hitRadius = radius + stroke.worldSize / 2;
  let anyErased = false;
  const keep = stroke.samples.map((s) => {
    const hit = Math.hypot(s.x - point.x, s.y - point.y) < hitRadius;
    if (hit) anyErased = true;
    return !hit;
  });
  if (!anyErased) return [stroke];

  const fragments: VectorSample[][] = [];
  let current: VectorSample[] = [];
  for (let i = 0; i < stroke.samples.length; i += 1) {
    if (keep[i]) current.push(stroke.samples[i]);
    else if (current.length > 0) {
      fragments.push(current);
      current = [];
    }
  }
  if (current.length > 0) fragments.push(current);

  return fragments.map((samples, idx) => ({
    ...stroke,
    strokeID: idx === 0 ? stroke.strokeID : `${stroke.strokeID}-e${idx}`,
    samples,
    ...(() => {
      const stampData = computeStampData(samples, stroke.worldSize, stroke.spacingRatio);
      return { stampPositions: stampData.positions, stampCarry: stampData.carry, stampStep: stampData.step, stampPathLength: stampData.pathLength };
    })(),
    worldBounds: boundsOf(samples, stroke.worldSize),
  }));
}

export interface VectorWorkspaceProps {
  visible: boolean;
  onClose: () => void;
  initialProjectName?: string | null;
  initialBrushEmoji?: string;
  initialBrushMode?: VectorBrushMode;
  initialRecentEmojis?: string[];
  initialSmudgeSmoothness?: number;
  onBrushEmojiChange?: (emoji: string) => void;
  onBrushModeChange?: (mode: VectorBrushMode) => void;
  onSmudgeSmoothnessChange?: (value: number) => void;
}

const VectorWorkspace: React.FC<VectorWorkspaceProps> = ({
  visible,
  onClose,
  initialProjectName = null,
  initialBrushEmoji = '🙂',
  initialBrushMode = 'opaque',
  initialRecentEmojis = [],
  initialSmudgeSmoothness = 0.5,
  onBrushEmojiChange,
  onBrushModeChange,
  onSmudgeSmoothnessChange,
}) => {
  useLifetimeActivity('vector', visible);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [camera, setCamera] = useState<VectorCameraState>({ cx: 0, cy: 0, zoom: 1 });
  const [strokes, setStrokes] = useState<VectorStroke[]>([]);
  const [liveStroke, setLiveStroke] = useState<VectorStroke | null>(null);
  const [brushEmoji, setBrushEmoji] = useState(initialBrushEmoji);
  const [brushScreenPx, setBrushScreenPx] = useState(64);
  const [sizeInput, setSizeInput] = useState('64');
  const [brushOptionsVisible, setBrushOptionsVisible] = useState(false);
  const brushOptionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [brushMode, setBrushMode] = useState<VectorBrushMode>(initialBrushMode);
  const [smudgeSmoothness, setSmudgeSmoothness] = useState(initialSmudgeSmoothness);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [brushRotation, setBrushRotation] = useState(0);
  const [spacingRatio, setSpacingRatio] = useState(DEFAULT_SPACING_RATIO);
  const [redoStack, setRedoStack] = useState<VectorStroke[]>([]);
  const [toolMode, setToolMode] = useState<'brush' | 'line' | 'eraser' | 'emojiplane'>('brush');
  const toolModeRef = useRef(toolMode);
  toolModeRef.current = toolMode;
  const [editingPlane, setEditingPlane] = useState<VectorEmojiPlane | null>(null);
  const editingPlaneRef = useRef<VectorEmojiPlane | null>(null);
  editingPlaneRef.current = editingPlane;
  const initialPlaneRef = useRef<VectorEmojiPlane | null>(null);
  const planeGestureStartRef = useRef<VectorEmojiPlane | null>(null);
  const planeDragRef = useRef<{
    kind: 'handle' | 'body';
    handle?: string;
    offsetX?: number;
    offsetY?: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const [planeUndoStack, setPlaneUndoStack] = useState<VectorEmojiPlane[]>([]);
  const [planeRedoStack, setPlaneRedoStack] = useState<VectorEmojiPlane[]>([]);
  const [traceImage, setTraceImage] = useState<VectorTraceImage | null>(null);
  const [tracePanelOpen, setTracePanelOpen] = useState(false);
  const [traceVisible, setTraceVisible] = useState(true);
  const [tracePlaced, setTracePlaced] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [recentBrushes, setRecentBrushes] = useState<string[]>(initialRecentEmojis);
  const [viewpoints, setViewpoints] = useState<VectorViewpoint[]>([]);
  const [loopMode, setLoopMode] = useState<VectorLoopMode>('pingPong');
  const [selectedVpId, setSelectedVpId] = useState<string | null>(null);
  const [vpPanelOpen, setVpPanelOpen] = useState(false);
  const [easePickerOpen, setEasePickerOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);
  const [recordedPreviewReady, setRecordedPreviewReady] = useState(false);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [videoAction, setVideoAction] = useState<'share' | 'photos' | 'storage' | null>(null);
  const [videoSavedToPhotos, setVideoSavedToPhotos] = useState(false);
  const [videoSavedToStorage, setVideoSavedToStorage] = useState(false);
  const [saveProjectVisible, setSaveProjectVisible] = useState(false);
  // Vector used to silently reopen the last document. Ask instead.
  const [resumePrompt, setResumePrompt] = useState<{ strokes: number; preview: string | null } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [projectName, setProjectName] = useState(initialProjectName ?? '');
  const [projectNameDraft, setProjectNameDraft] = useState(initialProjectName ?? '');
  const [projectSaving, setProjectSaving] = useState(false);
  const closingRef = useRef(false);
  const documentIDRef = useRef<string | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const liveRef = useRef<VectorStroke | null>(null);
  /** Latched for the whole gesture once a second finger appears. */
  const multiTouchRef = useRef(false);
  const strokeCounter = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewpointsRef = useRef(viewpoints);
  viewpointsRef.current = viewpoints;
  const loopRef = useRef(loopMode);
  loopRef.current = loopMode;
  const playRafRef = useRef<number | null>(null);
  const playResolveRef = useRef<(() => void) | null>(null);
  const rebasingWorldRef = useRef(false);
  const canvasRef = useCanvasRef();
  const vpCounter = useRef(0);
  const tracePlacementActiveRef = useRef(false);
  const traceDragLastRef = useRef({ x: 0, y: 0 });
  const traceRotationLastRef = useRef(0);
  tracePlacementActiveRef.current = Boolean(traceImage && tracePanelOpen && !playing && !exporting);

  // ReplayKit has finished writing by the time stopScreenRecording resolves,
  // but AVPlayer can still race the file hand-off on a busy device. Keep the
  // finish screen alive while the player is mounted a beat later.
  useEffect(() => {
    if (!recordedVideoUri) {
      setRecordedPreviewReady(false);
      return undefined;
    }
    setRecordedPreviewReady(false);
    const timer = setTimeout(() => setRecordedPreviewReady(true), 250);
    return () => clearTimeout(timer);
  }, [recordedVideoUri]);

  useEffect(() => {
    if (initialProjectName) {
      setProjectName(initialProjectName);
      setProjectNameDraft(initialProjectName);
    }
  }, [initialProjectName]);

  useEffect(() => {
    if (!visible) return;
    setBrushEmoji(initialBrushEmoji || '🙂');
    setBrushMode(initialBrushMode);
    setSmudgeSmoothness(Math.max(0, Math.min(1, initialSmudgeSmoothness)));
    setRecentBrushes(initialRecentEmojis);
  }, [initialBrushEmoji, initialBrushMode, initialRecentEmojis, initialSmudgeSmoothness, visible]);

  useEffect(() => () => {
    void ensureScreenRecordingStopped();
  }, []);

  // ── Open: ask FIRST, load after ────────────────────────────────────────────
  // Only the manifest is read here (one file). Reading every stroke up front is
  // what made the workspace sit on an empty canvas for ~30s before it could
  // even offer resume-or-new.
  useEffect(() => {
    if (!visible) return;
    void (async () => {
      const meta = await loadVectorManifest();
      if (!meta) return;
      documentIDRef.current = meta.documentID;
      if (meta.strokeOrder.length > 0) {
        // The manifest is enough to show the choice. The optional thumbnail
        // must not hold the prompt behind another filesystem read.
        setResumePrompt({ strokes: meta.strokeOrder.length, preview: null });
        void loadSessionPreviewUri().then((preview) => {
          setResumePrompt((current) => current ? { ...current, preview } : current);
        });
        return;
      }
      setCamera(sanitizeCamera(meta.camera ?? { cx: 0, cy: 0, zoom: 1 }, { cx: 0, cy: 0, zoom: 1 }));
      if (meta.viewpoints) { setViewpoints(meta.viewpoints); vpCounter.current = meta.viewpoints.length; }
      if (meta.loopMode) setLoopMode(meta.loopMode);
    })();
  }, [visible]);

  /** "Resume": now do the expensive full read. */
  const resumeVectorDocument = useCallback(() => {
    setRestoring(true);
    void (async () => {
      try {
        const doc = await loadVectorDocument();
        if (doc) {
          documentIDRef.current = doc.meta.documentID;
          setCamera(sanitizeCamera(doc.meta.camera ?? { cx: 0, cy: 0, zoom: 1 }, { cx: 0, cy: 0, zoom: 1 }));
          setStrokes(
            doc.strokes.map((s) => ({
              ...s,
              ...(() => {
                const stampData = computeStampData(s.samples, s.worldSize, s.spacingRatio);
                return { stampPositions: stampData.positions, stampCarry: stampData.carry, stampStep: stampData.step, stampPathLength: stampData.pathLength };
              })(),
            }))
          );
          strokeCounter.current = doc.strokes.length;
          if (doc.meta.viewpoints) { setViewpoints(doc.meta.viewpoints); vpCounter.current = doc.meta.viewpoints.length; }
          if (doc.meta.loopMode) setLoopMode(doc.meta.loopMode);
        }
      } finally {
        setRestoring(false);
        setResumePrompt(null);
      }
    })();
  }, []);

  const scheduleManifestSave = useCallback((order?: string[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        const ids = order ?? strokesRef.current.map((s) => s.strokeID);
        documentIDRef.current = await saveManifest(
          documentIDRef.current, cameraRef.current, ids, viewpointsRef.current, loopRef.current
        );
      })();
    }, 1200);
  }, []);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // Keep document coordinates local even after very large pans followed by a
  // deep zoom. Skia is float-backed and JS numbers are doubles; translating
  // every world-space consumer together preserves the exact view while
  // recovering subpixel precision around the active camera.
  useEffect(() => {
    const origin = worldOriginRebaseOffset(camera);
    if (!origin || rebasingWorldRef.current) return;
    rebasingWorldRef.current = true;

    const shiftedCamera = {
      ...cameraRef.current,
      cx: cameraRef.current.cx - origin.x,
      cy: cameraRef.current.cy - origin.y,
    };
    cameraRef.current = shiftedCamera;
    setCamera(shiftedCamera);

    const shiftedStrokes = strokesRef.current.map((stroke) =>
      translateStrokeOrigin(stroke, origin.x, origin.y)
    );
    strokesRef.current = shiftedStrokes;
    setStrokes(shiftedStrokes);
    setRedoStack((stack) =>
      stack.map((stroke) => translateStrokeOrigin(stroke, origin.x, origin.y))
    );

    const shiftedViewpoints = viewpointsRef.current.map((viewpoint) => ({
      ...viewpoint,
      cx: viewpoint.cx - origin.x,
      cy: viewpoint.cy - origin.y,
    }));
    viewpointsRef.current = shiftedViewpoints;
    setViewpoints(shiftedViewpoints);
    setTraceImage((trace) => trace ? {
      ...trace,
      worldX: trace.worldX - origin.x,
      worldY: trace.worldY - origin.y,
    } : trace);
    setEditingPlane((plane) => {
      if (!plane) return plane;
      const shifted = translatePlaneGeometry(plane as any, -origin.x, -origin.y) as VectorEmojiPlane;
      editingPlaneRef.current = shifted;
      if (initialPlaneRef.current) {
        initialPlaneRef.current = translatePlaneGeometry(initialPlaneRef.current as any, -origin.x, -origin.y) as VectorEmojiPlane;
      }
      return shifted;
    });
    setPlaneUndoStack((stack) => stack.map((plane) =>
      translatePlaneGeometry(plane as any, -origin.x, -origin.y) as VectorEmojiPlane
    ));
    setPlaneRedoStack((stack) => stack.map((plane) =>
      translatePlaneGeometry(plane as any, -origin.x, -origin.y) as VectorEmojiPlane
    ));

    Promise.all(shiftedStrokes.map((stroke) => saveStroke(stroke)))
      .catch((error) => console.warn('[Vector] floating-origin save failed:', error));
    scheduleManifestSave(shiftedStrokes.map((stroke) => stroke.strokeID));
    rebasingWorldRef.current = false;
  }, [camera, scheduleManifestSave]);

  // ── Eraser (world-space; see eraseStrokeAt for why it splits strokes) ──────
  const eraseAt = useCallback((sx: number, sy: number) => {
    const cam = cameraRef.current;
    const w = screenToWorld(cam, sx, sy, width, height);
    const worldRadius = brushScreenPx / cam.zoom / 2;
    setStrokes((prev) => {
      let changed = false;
      const next: VectorStroke[] = [];
      for (const s of prev) {
        const fragments = eraseStrokeAt(s, w, worldRadius);
        if (fragments.length !== 1 || fragments[0] !== s) {
          changed = true;
          void deleteStroke(s.strokeID);
          for (const f of fragments) void saveStroke(f);
        }
        next.push(...fragments);
      }
      if (!changed) return prev;
      scheduleManifestSave(next.map((s) => s.strokeID));
      return next;
    });
  }, [brushScreenPx, scheduleManifestSave, width, height]);

  // ── Drawing ────────────────────────────────────────────────────────────────
  const beginStroke = useCallback((sx: number, sy: number) => {
    if (toolModeRef.current === 'eraser') {
      eraseAt(sx, sy);
      return;
    }
    const cam = cameraRef.current;
    const w = screenToWorld(cam, sx, sy, width, height);
    const worldSize = worldSizeForScreenBrush(brushScreenPx, cam.zoom);
    const halfWorldSize = worldSize / 2;
    strokeCounter.current += 1;
    const stroke: VectorStroke = {
      strokeID: `stroke-${Date.now().toString(36)}-${strokeCounter.current}`,
      emoji: brushEmoji,
      // Exact world-constant semantics: at creation this always projects back
      // to the selected screen brush size. Extreme values are handled by the
      // viewport-rebased renderer instead of shrinking the saved stroke.
      worldSize,
      screenSizeAtCreation: brushScreenPx,
      widthMode: 'worldConstant',
      opacity: brushMode === 'transparent' ? 0.01 : 1,
      brushMode,
      ...(brushMode === 'smudge'
        ? { smudgeStrength, edgeBlendStrength: smudgeSmoothness }
        : {}),
      spacingRatio,
      rotationDegrees: brushRotation,
      mirrorX,
      mirrorY,
      startedAtMilliseconds: Date.now(),
      endedAtMilliseconds: 0,
      samples: [{ x: w.x, y: w.y, timeMilliseconds: 0 }],
      worldBounds: {
        minX: w.x - halfWorldSize,
        minY: w.y - halfWorldSize,
        maxX: w.x + halfWorldSize,
        maxY: w.y + halfWorldSize,
      },
      stampPositions: [{ x: w.x, y: w.y }],
      stampCarry: 0,
      stampStep: Math.max(1e-12, worldSize * Math.max(MIN_SPACING_RATIO, spacingRatio)),
      stampPathLength: 0,
    };
    liveRef.current = stroke;
    setLiveStroke(stroke);
  }, [brushEmoji, brushMode, brushRotation, brushScreenPx, eraseAt, height, mirrorX, mirrorY, smudgeSmoothness, spacingRatio, width]);

  const extendStroke = useCallback((sx: number, sy: number) => {
    if (toolModeRef.current === 'eraser') {
      eraseAt(sx, sy);
      return;
    }
    const stroke = liveRef.current;
    if (!stroke) return;
    const w = screenToWorld(cameraRef.current, sx, sy, width, height);
    if (toolModeRef.current === 'line') {
      // Ruler mode: the stroke is always exactly the anchor (first touch) and
      // the current touch — never accumulated — so it redraws as a straight,
      // re-aimable segment until release.
      const anchor = stroke.samples[0];
      const next: VectorStroke = {
        ...stroke,
        samples: [anchor, { x: w.x, y: w.y, timeMilliseconds: Date.now() - stroke.startedAtMilliseconds }],
      };
      const stampData = computeStampData(next.samples, next.worldSize, next.spacingRatio);
      next.stampPositions = stampData.positions;
      next.stampCarry = stampData.carry;
      next.stampStep = stampData.step;
      next.stampPathLength = stampData.pathLength;
      next.worldBounds = boundsOf(next.samples, next.worldSize);
      liveRef.current = next;
      setLiveStroke(next);
      return;
    }
    const last = stroke.samples[stroke.samples.length - 1];
    // Sample gate: ~1/4 stamp spacing in world units.
    if (Math.hypot(w.x - last.x, w.y - last.y) < stroke.worldSize * 0.05) return;
    const sample = { x: w.x, y: w.y, timeMilliseconds: Date.now() - stroke.startedAtMilliseconds };
    const stampData = appendStampData(stroke, sample);
    // This is the private, still-live stroke. Mutating its append-only arrays
    // avoids copying the entire touch path on every move; committed strokes
    // remain immutable once they enter `strokes`.
    stroke.samples.push(sample);
    const next: VectorStroke = {
      ...stroke,
      samples: stroke.samples,
      stampPositions: stampData.positions,
      stampCarry: stampData.carry,
      stampStep: stampData.step,
      stampPathLength: stampData.pathLength,
    };
    // Extend the cached bounds in O(1). Re-scanning every sample for every
    // touch event made an otherwise valid long stroke quadratic in its length.
    const half = next.worldSize / 2;
    next.worldBounds = {
      minX: Math.min(stroke.worldBounds.minX, w.x - half),
      minY: Math.min(stroke.worldBounds.minY, w.y - half),
      maxX: Math.max(stroke.worldBounds.maxX, w.x + half),
      maxY: Math.max(stroke.worldBounds.maxY, w.y + half),
    };
    liveRef.current = next;
    setLiveStroke(next);
  }, [eraseAt, width, height]);

  const commitStroke = useCallback(() => {
    const stroke = liveRef.current;
    liveRef.current = null;
    setLiveStroke(null);
    if (!stroke || stroke.samples.length === 0) return;
    const done: VectorStroke = { ...stroke, endedAtMilliseconds: Date.now() - stroke.startedAtMilliseconds };
    void recordLifetimeStrokeCommit({
      eventId: `vector:${done.strokeID}`,
      workspace: 'vector',
    });
    setStrokes((prev) => {
      const next = [...prev, done];
      void saveStroke(done);
      scheduleManifestSave(next.map((s) => s.strokeID));
      return next;
    });
    setRedoStack([]);
    void Haptics.selectionAsync();
  }, [scheduleManifestSave]);

  const cancelStroke = useCallback(() => {
    liveRef.current = null;
    setLiveStroke(null);
  }, []);

  const updateEditingPlane = useCallback((next: VectorEmojiPlane, remember = true) => {
    const previous = editingPlaneRef.current;
    if (remember && previous) {
      setPlaneUndoStack((stack) => [...stack, previous]);
      setPlaneRedoStack([]);
    }
    editingPlaneRef.current = next;
    setEditingPlane(next);
  }, []);

  const createVectorPlane = useCallback((sx: number, sy: number) => {
    const cam = cameraRef.current;
    const center = screenToWorld(cam, sx, sy, width, height);
    // Match the normal workspace exactly: plane sizing caps the brush at 40, then multiplies by 6.
    const screenSize = Math.max(6, Math.min(40, brushScreenPx) * 6);
    const half = screenSize / Math.max(cam.zoom, 1e-12) / 2;
    const now = Date.now();
    const corners = {
      topLeft: { x: center.x - half, y: center.y - half },
      topMid: { x: center.x, y: center.y - half },
      topRight: { x: center.x + half, y: center.y - half },
      rightMid: { x: center.x + half, y: center.y },
      bottomRight: { x: center.x + half, y: center.y + half },
      bottomMid: { x: center.x, y: center.y + half },
      bottomLeft: { x: center.x - half, y: center.y + half },
      leftMid: { x: center.x - half, y: center.y },
    };
    const plane: VectorEmojiPlane = {
      id: `plane-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      emoji: brushEmoji,
      corners,
      timestamp: now,
      cornerHistory: [{
        topLeft: { ...corners.topLeft }, topRight: { ...corners.topRight },
        bottomRight: { ...corners.bottomRight }, bottomLeft: { ...corners.bottomLeft }, timestamp: now,
      }],
      opacity: 1,
      rotation: 0,
      scale: 1,
      visible: true,
      zIndex: strokesRef.current.length,
    };
    initialPlaneRef.current = plane;
    editingPlaneRef.current = plane;
    setEditingPlane(plane);
    setPlaneUndoStack([]);
    setPlaneRedoStack([]);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [brushEmoji, brushScreenPx, height, width]);

  const beginPlaneInteraction = useCallback((sx: number, sy: number) => {
    const plane = editingPlaneRef.current;
    if (!plane) {
      createVectorPlane(sx, sy);
      return;
    }
    const point = screenToWorld(cameraRef.current, sx, sy, width, height);
    const hitRadius = 34 / Math.max(cameraRef.current.zoom, 1e-12);
    let handle: string | null = null;
    if (plane.lattice && (plane.latticeLevel ?? 1) > 1) {
      const index = findLatticeHandle(plane.lattice, point.x, point.y, hitRadius);
      if (index !== null) handle = `lattice:${index}`;
    } else {
      const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
      let best = hitRadius;
      for (const key of corners) {
        const distance = Math.hypot(point.x - plane.corners[key].x, point.y - plane.corners[key].y);
        if (distance < best) { best = distance; handle = key; }
      }
    }
    planeGestureStartRef.current = plane;
    if (handle) {
      const handlePoint = handle.startsWith('lattice:')
        ? plane.lattice?.[Number(handle.slice(8))]
        : plane.corners[handle as keyof typeof plane.corners];
      planeDragRef.current = {
        kind: 'handle', handle,
        offsetX: (handlePoint?.x ?? point.x) - point.x,
        offsetY: (handlePoint?.y ?? point.y) - point.y,
        lastX: point.x, lastY: point.y,
      };
      return;
    }
    const bounds = vectorPlaneWorldBounds(plane);
    if (point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY) {
      planeDragRef.current = { kind: 'body', lastX: point.x, lastY: point.y };
    } else {
      // Applying/cancelling is explicit. A tap outside simply keeps the current plane safe.
      planeGestureStartRef.current = null;
    }
  }, [createVectorPlane, height, width]);

  const extendPlaneInteraction = useCallback((sx: number, sy: number) => {
    const drag = planeDragRef.current;
    const plane = editingPlaneRef.current;
    if (!drag || !plane) return;
    const point = screenToWorld(cameraRef.current, sx, sy, width, height);
    const next = drag.kind === 'handle' && drag.handle
      ? movePlaneHandle(plane as any, drag.handle, point.x + (drag.offsetX ?? 0), point.y + (drag.offsetY ?? 0)) as VectorEmojiPlane
      : translatePlaneGeometry(plane as any, point.x - drag.lastX, point.y - drag.lastY) as VectorEmojiPlane;
    drag.lastX = point.x;
    drag.lastY = point.y;
    editingPlaneRef.current = next;
    setEditingPlane(next);
  }, [height, width]);

  const endPlaneInteraction = useCallback(() => {
    const start = planeGestureStartRef.current;
    const current = editingPlaneRef.current;
    if (start && current && start !== current) {
      setPlaneUndoStack((stack) => [...stack, start]);
      setPlaneRedoStack([]);
      void Haptics.selectionAsync();
    }
    planeGestureStartRef.current = null;
    planeDragRef.current = null;
  }, []);

  const moveTraceByScreen = useCallback((dx: number, dy: number) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const zoom = Math.max(cameraRef.current.zoom, 1e-9);
    setTraceImage((prev) => (prev ? {
      ...prev,
      worldX: prev.worldX + dx / zoom,
      worldY: prev.worldY + dy / zoom,
    } : prev));
  }, []);

  // ── Gestures (arbiter per handoff) ────────────────────────────────────────
  const gesture = useMemo(() => {
    const draw = Gesture.Pan()
      .minPointers(1)
      .maxPointers(1)
      .minDistance(0)
      .runOnJS(true)
      .onTouchesDown((e) => {
        // A second finger means navigation — never let it become a stroke.
        // The flag latches for the whole gesture: onBegin can fire AFTER the
        // pinch has already started, so cancelling once is not enough. A stray
        // stroke born mid-pinch gets worldSize = brushPx / (small zoom), i.e.
        // enormous, and crashes the renderer as soon as you zoom back in.
        if (e.numberOfTouches > 1) {
          multiTouchRef.current = true;
          cancelStroke();
        }
      })
      .onBegin((e) => {
        if (multiTouchRef.current) return;
        if (tracePlacementActiveRef.current) {
          traceDragLastRef.current = { x: e.x, y: e.y };
          return;
        }
        if (toolModeRef.current === 'emojiplane') {
          beginPlaneInteraction(e.x, e.y);
          return;
        }
        beginStroke(e.x, e.y);
      })
      .onUpdate((e) => {
        if (multiTouchRef.current) return;
        if (tracePlacementActiveRef.current) {
          const dx = e.x - traceDragLastRef.current.x;
          const dy = e.y - traceDragLastRef.current.y;
          traceDragLastRef.current = { x: e.x, y: e.y };
          moveTraceByScreen(dx, dy);
          return;
        }
        if (toolModeRef.current === 'emojiplane') {
          extendPlaneInteraction(e.x, e.y);
          return;
        }
        extendStroke(e.x, e.y);
      })
      .onEnd(() => {
        if (multiTouchRef.current) { cancelStroke(); return; }
        if (tracePlacementActiveRef.current) return;
        if (toolModeRef.current === 'emojiplane') { endPlaneInteraction(); return; }
        commitStroke();
      })
      .onTouchesUp((e) => {
        // Clear the latch only when every finger is off the glass. Without this
        // the flag can stay stuck true (two fingers landing before the draw
        // gesture begins means its onFinalize may never run) and drawing would
        // stop working entirely.
        if (e.numberOfTouches === 0) multiTouchRef.current = false;
      })
      .onFinalize((_e, success) => {
        if (!success || multiTouchRef.current) cancelStroke();
        if (toolModeRef.current === 'emojiplane') endPlaneInteraction();
        multiTouchRef.current = false;
      });

    const pan2 = Gesture.Pan()
      .minPointers(2)
      .maxPointers(2)
      .runOnJS(true)
      .onStart(() => { multiTouchRef.current = true; cancelStroke(); endPlaneInteraction(); })
      .onChange((e) => {
        if (tracePlacementActiveRef.current) moveTraceByScreen(e.changeX, e.changeY);
        else setCamera((cam) => panCamera(cam, e.changeX, e.changeY));
      })
      .onEnd(() => { multiTouchRef.current = false; });

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => { multiTouchRef.current = true; cancelStroke(); endPlaneInteraction(); })
      .onChange((e) => {
        if (tracePlacementActiveRef.current) {
          setTraceImage((prev) => (prev ? {
            ...prev,
            scale: Math.max(0.2, Math.min(4, (prev.scale ?? 1) * e.scaleChange)),
          } : prev));
        } else {
          setCamera((cam) => zoomAroundFocal(cam, e.scaleChange, e.focalX, e.focalY, width, height));
        }
      })
      .onEnd(() => {
        multiTouchRef.current = false;
        scheduleManifestSave();
      });

    const rotation = Gesture.Rotation()
      .runOnJS(true)
      .onStart((e) => {
        multiTouchRef.current = true;
        cancelStroke();
        endPlaneInteraction();
        traceRotationLastRef.current = e.rotation;
      })
      .onChange((e) => {
        if (tracePlacementActiveRef.current) {
          const delta = e.rotation - traceRotationLastRef.current;
          traceRotationLastRef.current = e.rotation;
          setTraceImage((prev) => (prev ? {
            ...prev,
            rotationDegrees: Math.max(-180, Math.min(180, (prev.rotationDegrees ?? 0) + (delta * 180) / Math.PI)),
          } : prev));
        } else {
          traceRotationLastRef.current = e.rotation;
        }
      })
      .onEnd(() => { multiTouchRef.current = false; });

    return Gesture.Race(Gesture.Simultaneous(pinch, pan2, rotation), draw);
  }, [beginPlaneInteraction, beginStroke, extendPlaneInteraction, extendStroke, endPlaneInteraction, commitStroke, cancelStroke, moveTraceByScreen, scheduleManifestSave, width, height]);

  // ── Toolbar actions ────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    void Haptics.selectionAsync();
    if (toolModeRef.current === 'emojiplane' && editingPlaneRef.current && planeUndoStack.length > 0) {
      const previous = planeUndoStack[planeUndoStack.length - 1];
      const current = editingPlaneRef.current;
      editingPlaneRef.current = previous;
      setEditingPlane(previous);
      setPlaneUndoStack((stack) => stack.slice(0, -1));
      setPlaneRedoStack((stack) => [...stack, current]);
      return;
    }
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const removed = prev[prev.length - 1];
      void deleteStroke(removed.strokeID);
      const next = prev.slice(0, -1);
      scheduleManifestSave(next.map((s) => s.strokeID));
      setRedoStack((stack) => [...stack, removed]);
      return next;
    });
  }, [planeUndoStack, scheduleManifestSave]);

  const handleRedo = useCallback(() => {
    if (toolModeRef.current === 'emojiplane' && editingPlaneRef.current && planeRedoStack.length > 0) {
      const nextPlane = planeRedoStack[planeRedoStack.length - 1];
      const current = editingPlaneRef.current;
      editingPlaneRef.current = nextPlane;
      setEditingPlane(nextPlane);
      setPlaneRedoStack((stack) => stack.slice(0, -1));
      setPlaneUndoStack((stack) => [...stack, current]);
      void Haptics.selectionAsync();
      return;
    }
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const restored = stack[stack.length - 1];
      void Haptics.selectionAsync();
      setStrokes((prev) => {
        const next = [...prev, restored];
        void saveStroke(restored);
        scheduleManifestSave(next.map((s) => s.strokeID));
        return next;
      });
      return stack.slice(0, -1);
    });
  }, [planeRedoStack, scheduleManifestSave]);

  const handleClear = useCallback(() => {
    Alert.alert('Clear vector canvas?', 'Remove every stroke in this document?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        setStrokes([]);
        setRedoStack([]);
        setEditingPlane(null);
        editingPlaneRef.current = null;
        initialPlaneRef.current = null;
        setPlaneUndoStack([]);
        setPlaneRedoStack([]);
        documentIDRef.current = null;
        void clearVectorDocument();
      } },
    ]);
  }, []);

  /** "Start new" from the resume prompt: wipe the restored document. */
  const startNewVectorDocument = useCallback(() => {
    void Haptics.selectionAsync();
    setResumePrompt(null);
    setStrokes([]);
    setRedoStack([]);
    setEditingPlane(null);
    editingPlaneRef.current = null;
    initialPlaneRef.current = null;
    setPlaneUndoStack([]);
    setPlaneRedoStack([]);
    setViewpoints([]);
    viewpointsRef.current = [];
    setSelectedVpId(null);
    setCamera({ cx: 0, cy: 0, zoom: 1 });
    setProjectName('');
    documentIDRef.current = null;
    clearVectorStampCache();
    void clearVectorDocument();
  }, []);

  /** Session thumbnail for the resume prompt (and a visual record of a save). */
  const captureSessionPreview = useCallback(async () => {
    try {
      const image = canvasRef.current?.makeImageSnapshot();
      if (!image) return;
      const base64 = image.encodeToBase64();
      image.dispose?.();
      if (base64) await saveSessionPreview(base64);
    } catch (error) {
      console.warn('[Vector] session preview capture failed:', error);
    }
  }, [canvasRef]);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    void (async () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await captureSessionPreview();
      documentIDRef.current = await saveManifest(
        documentIDRef.current,
        cameraRef.current,
        strokesRef.current.map((s) => s.strokeID),
        viewpointsRef.current,
        loopRef.current,
      );
      clearVectorStampCache();
      onClose();
    })().finally(() => {
      closingRef.current = false;
    });
  }, [captureSessionPreview, onClose]);

  const closeViewpointPanel = useCallback(() => {
    setEasePickerOpen(false);
    setVpPanelOpen(false);
  }, []);

  const toggleViewpointPanel = useCallback(() => {
    setVpPanelOpen((open) => {
      if (open) setEasePickerOpen(false);
      return !open;
    });
  }, []);

  const resetCamera = useCallback(() => {
    void Haptics.selectionAsync();
    setCamera({ cx: 0, cy: 0, zoom: 1 });
  }, []);

  // ── Viewpoints ──────────────────────────────────────────────────────────────
  const captureViewpoint = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    vpCounter.current += 1;
    const cam = cameraRef.current;
    const vp: VectorViewpoint = {
      id: `view-${Date.now().toString(36)}-${vpCounter.current}`,
      label: `View ${vpCounter.current}`,
      cx: cam.cx, cy: cam.cy, zoom: cam.zoom,
      holdMs: 700,
      durationToNextMs: 1800,
      easing: 'easeInOut',
    };
    setViewpoints((prev) => {
      const next = [...prev, vp];
      viewpointsRef.current = next;
      scheduleManifestSave();
      return next;
    });
    setSelectedVpId(vp.id);
  }, [scheduleManifestSave]);

  const jumpToViewpoint = useCallback((vp: VectorViewpoint) => {
    void Haptics.selectionAsync();
    setSelectedVpId(vp.id);
    setCamera((cam) => sanitizeCamera({ cx: vp.cx, cy: vp.cy, zoom: vp.zoom }, cam));
  }, []);

  const deleteViewpoint = useCallback((id: string) => {
    setViewpoints((prev) => {
      const next = prev.filter((v) => v.id !== id);
      viewpointsRef.current = next;
      scheduleManifestSave();
      return next;
    });
  }, [scheduleManifestSave]);

  const updateViewpoint = useCallback((id: string, patch: Partial<VectorViewpoint>) => {
    setViewpoints((prev) => {
      const next = prev.map((v) => (v.id === id ? { ...v, ...patch } : v));
      viewpointsRef.current = next;
      scheduleManifestSave();
      return next;
    });
  }, [scheduleManifestSave]);

  const cycleLoopMode = useCallback(() => {
    void Haptics.selectionAsync();
    setLoopMode((m) => {
      const next: VectorLoopMode = m === 'once' ? 'loop' : m === 'loop' ? 'pingPong' : 'once';
      loopRef.current = next;
      scheduleManifestSave();
      return next;
    });
  }, [scheduleManifestSave]);

  // ── Fly playback (deterministic timeline) ───────────────────────────────────
  const stopPlayback = useCallback(() => {
    if (playRafRef.current != null) cancelAnimationFrame(playRafRef.current);
    playRafRef.current = null;
    setPlaying(false);
    const resolve = playResolveRef.current;
    playResolveRef.current = null;
    resolve?.();
  }, []);

  const playTimeline = useCallback((onDone?: () => void) => {
    const views = viewpointsRef.current;
    if (views.length < 2) { onDone?.(); return; }
    const total = timelineDurationMs(views, loopRef.current);
    if (total <= 0) { onDone?.(); return; }
    closeViewpointPanel();
    setPlaying(true);
    playResolveRef.current = onDone ?? null;
    const start = Date.now();
    const tick = () => {
      const t = Date.now() - start;
      const cam = evalTimeline(viewpointsRef.current, loopRef.current, t);
      if (cam) setCamera(cam);
      if (t >= total) {
        playRafRef.current = null;
        setPlaying(false);
        playResolveRef.current = null;
        onDone?.();
        return;
      }
      playRafRef.current = requestAnimationFrame(tick);
    };
    playRafRef.current = requestAnimationFrame(tick);
  }, [closeViewpointPanel]);

  const togglePlay = useCallback(() => {
    if (playing) stopPlayback();
    else playTimeline();
  }, [playing, playTimeline, stopPlayback]);

  useEffect(() => () => { if (playRafRef.current != null) cancelAnimationFrame(playRafRef.current); }, []);

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportPng = useCallback(async () => {
    setExporting(true);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Give the layout a beat, then snapshot the live Skia canvas.
      await new Promise((r) => setTimeout(r, 60));
      const image = canvasRef.current?.makeImageSnapshot();
      if (!image) throw new Error('snapshot failed');
      const base64 = image.encodeToBase64();
      const path = `${FileSystem.cacheDirectory}vector-${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
      await MediaLibrary.saveToLibraryAsync(path).catch(() => {});
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'image/png' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not export the image.');
    } finally {
      setExporting(false);
    }
  }, [canvasRef]);

  const exportVideo = useCallback(async () => {
    if (viewpointsRef.current.length < 2) {
      Alert.alert('Fly-through video', 'Add at least two viewpoints (📸) first, then play them as a flight.');
      return;
    }
    setExporting(true);
    setRecordedVideoUri(null);
    setVideoSavedToPhotos(false);
    setVideoSavedToStorage(false);
    let recordingStarted = false;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      // Use ReplayKit for Vector flights. The direct Metal exporter can retain
      // several 2048px emoji textures at once on iPhone and trigger iOS
      // memory-pressure termination; ReplayKit captures the already bounded,
      // zoom-safe VectorCanvas and also supports smudge/trace content.
      // Commit the clean, control-free export layout before ReplayKit receives
      // its first frame.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const started = await startScreenRecording(false);
      if (!started.ok) throw new Error(started.error || 'Screen recording could not start.');
      recordingStarted = true;
      // Put the renderer on the exact first viewpoint before recording. The
      // lead-in lets Skia commit that frame, avoiding a black/stale first frame.
      const first = evalTimeline(viewpointsRef.current, loopRef.current, 0);
      if (first) setCamera(first);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 120));
      await new Promise<void>((resolve) => playTimeline(resolve));
      // Hold the final viewpoint for one frame so the final encoded timestamp
      // is non-zero and the last viewpoint is not dropped by the recorder.
      await new Promise((r) => setTimeout(r, 120));
      const { ok, url, error } = await stopScreenRecording();
      recordingStarted = false;
      if (!ok || !url) throw new Error(error || 'Recording ended, but iOS did not return a playable video file.');

      // Move the completed movie to a cache file before AVPlayer sees it. The
      // recorder owns the Documents file and may still be releasing ReplayKit
      // resources when its promise resolves; a private copy removes that
      // lifetime race and also gives Share/Photos/Video Storage one stable URI.
      await new Promise((resolve) => setTimeout(resolve, 180));
      let previewUri = url;
      try {
        const sourceInfo = await FileSystem.getInfoAsync(url);
        if (!sourceInfo.exists) throw new Error('The completed recording file is missing.');
        const cacheRoot = FileSystem.cacheDirectory;
        if (cacheRoot) {
          const stagedUri = `${cacheRoot}vector-recording-${Date.now()}.mov`;
          await FileSystem.copyAsync({ from: url, to: stagedUri });
          const stagedInfo = await FileSystem.getInfoAsync(stagedUri);
          if (stagedInfo.exists) previewUri = stagedUri;
        }
      } catch (stageError) {
        // The native file was already validated; using it directly preserves
        // the result if a low-storage cache copy is unavailable.
        console.warn('[Vector] recording staging failed; using native file:', stageError);
      }
      setRecordedVideoUri(previewUri);
      setRecordedDurationMs(Math.max(1, timelineDurationMs(viewpointsRef.current, loopRef.current) + 240));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      stopPlayback();
      if (recordingStarted) await stopScreenRecording().catch(() => {});
      Alert.alert('Video export failed', error instanceof Error ? error.message : 'Could not record the flight.');
    } finally {
      stopPlayback();
      setExporting(false);
    }
  }, [playTimeline, stopPlayback, width]);

  const shareRecordedVideo = useCallback(async () => {
    if (!recordedVideoUri || videoAction) return;
    setVideoAction('share');
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      const isMp4 = recordedVideoUri.toLowerCase().endsWith('.mp4');
      await Sharing.shareAsync(recordedVideoUri, {
        mimeType: isMp4 ? 'video/mp4' : 'video/quicktime',
        UTI: isMp4 ? 'public.mpeg-4' : 'public.movie',
        dialogTitle: 'Vector fly-through',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/cancel|dismiss/i.test(message)) Alert.alert('Share failed', message);
    } finally {
      setVideoAction(null);
    }
  }, [recordedVideoUri, videoAction]);

  const saveRecordedToPhotos = useCallback(async () => {
    if (!recordedVideoUri || videoAction || videoSavedToPhotos) return;
    setVideoAction('photos');
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Photo Library permission is required.');
      await MediaLibrary.saveToLibraryAsync(recordedVideoUri);
      setVideoSavedToPhotos(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Could not save to Photos.');
    } finally {
      setVideoAction(null);
    }
  }, [recordedVideoUri, videoAction, videoSavedToPhotos]);

  const saveRecordedToVideoStorage = useCallback(async () => {
    if (!recordedVideoUri || videoAction || videoSavedToStorage) return;
    setVideoAction('storage');
    try {
      const saved = await addVideo(recordedVideoUri, Math.round(width), Math.round(height), recordedDurationMs, undefined, { isExport: true });
      if (!saved) throw new Error('The recording could not be copied into Video Storage.');
      setVideoSavedToStorage(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Storage failed', error instanceof Error ? error.message : 'Could not save the video.');
    } finally {
      setVideoAction(null);
    }
  }, [height, recordedDurationMs, recordedVideoUri, videoAction, videoSavedToStorage, width]);

  const openProjectSave = useCallback(() => {
    const fallback = `Vector ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    setProjectNameDraft(projectName || fallback);
    setSaveProjectVisible(true);
  }, [projectName]);

  const saveCurrentVectorProject = useCallback(async () => {
    const name = projectNameDraft.trim();
    if (!name || projectSaving) return;
    setProjectSaving(true);
    try {
      await Promise.all(strokesRef.current.map((stroke) => saveStroke(stroke)));
      documentIDRef.current = await saveManifest(
        documentIDRef.current,
        cameraRef.current,
        strokesRef.current.map((stroke) => stroke.strokeID),
        viewpointsRef.current,
        loopRef.current,
      );
      // The stroke files were just written and the manifest is authoritative;
      // rereading every stroke here made Save progressively slower as drawings
      // grew. Package the in-memory authoritative strokes instead.
      const meta = await loadVectorManifest();
      if (!meta) throw new Error('The Vector document manifest could not be assembled.');
      const document: LoadedVectorDocument = { meta, strokes: strokesRef.current };

      let previewUri: string | null = null;
      const snapshot = canvasRef.current?.makeImageSnapshot();
      const snapshotBase64 = snapshot?.encodeToBase64() ?? null;
      if (snapshot) {
        const previewDir = `${FileSystem.documentDirectory}vector/project-previews/`;
        const dirInfo = await FileSystem.getInfoAsync(previewDir);
        if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(previewDir, { intermediates: true });
        const safeName = name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'vector';
        previewUri = `${previewDir}${safeName}-${Date.now()}.png`;
        if (snapshotBase64) {
          await FileSystem.writeAsStringAsync(previewUri, snapshotBase64, { encoding: FileSystem.EncodingType.Base64 });
        }
      }
      snapshot?.dispose?.();

      await saveVectorProject(name, document, previewUri);
      // Keep the session thumbnail in step with the save, so the resume prompt
      // shows what was actually saved.
      if (snapshotBase64) await saveSessionPreview(snapshotBase64).catch(() => undefined);
      emitAppEvent('projects/updated');
      setProjectName(name);
      setProjectNameDraft(name);
      setSaveProjectVisible(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Vector project saved', `“${name}” is now available in Projects and will reopen directly in Vector mode.`);
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Could not save the Vector project.');
    } finally {
      setProjectSaving(false);
    }
  }, [canvasRef, projectNameDraft, projectSaving]);

  const chooseExport = useCallback(() => {
    Alert.alert('Export', 'What would you like to export?', [
      { text: 'Cancel', style: 'cancel' },
      { text: '🖼 This view (PNG)', onPress: () => void exportPng() },
      { text: '🎬 Fly-through video', onPress: () => void exportVideo() },
    ]);
  }, [exportPng, exportVideo]);

  const pickTraceImage = useCallback(async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        Alert.alert('Permission required', 'Grant photo access to import a trace image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      const cam = cameraRef.current;
      // Pinned in world space (not screen space) so it stays under the art at
      // every zoom level, matching how Vector Mode's camera actually works.
      const viewWorldWidth = width / cam.zoom;
      const worldWidth = viewWorldWidth * 0.8;
      const aspect = asset.width && asset.height ? asset.height / asset.width : 1;
      const worldHeight = worldWidth * aspect;
      setTraceImage({
        uri: asset.uri,
        worldX: cam.cx - worldWidth / 2,
        worldY: cam.cy - worldHeight / 2,
        worldWidth,
        worldHeight,
        opacity: 0.5,
        scale: 1,
        rotationDegrees: 0,
      });
      setTraceVisible(true);
      setTracePlaced(false);
      setTracePanelOpen(true);
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : 'Could not import the trace image.');
    }
  }, [width]);

  const removeTraceImage = useCallback(() => {
    setTraceImage(null);
    setTracePlaced(false);
    setTracePanelOpen(false);
  }, []);

  const handleTraceImageAspect = useCallback((aspect: number) => {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    setTraceImage((prev) => {
      if (!prev || !Number.isFinite(prev.worldWidth) || prev.worldWidth <= 0) return prev;
      const nextHeight = prev.worldWidth * aspect;
      return Math.abs(nextHeight - prev.worldHeight) < 0.5 ? prev : { ...prev, worldHeight: nextHeight };
    });
  }, []);

  const changeTraceOpacity = useCallback((value: number) => {
    setTraceImage((prev) => (prev ? { ...prev, opacity: Math.max(0, Math.min(1, value)) } : prev));
  }, []);

  const changeTraceScale = useCallback((value: number) => {
    setTraceImage((prev) => (prev ? { ...prev, scale: Math.max(0.2, Math.min(4, value)) } : prev));
  }, []);

  const changeTraceRotation = useCallback((value: number) => {
    setTraceImage((prev) => (prev ? { ...prev, rotationDegrees: Math.max(-180, Math.min(180, value)) } : prev));
  }, []);

  const placeTraceImage = useCallback(() => {
    if (!traceImage) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTracePlaced(true);
    setTracePanelOpen(false);
  }, [traceImage]);

  const toggleTraceVisible = useCallback(() => {
    void Haptics.selectionAsync();
    setTraceVisible((visibleNow) => !visibleNow);
  }, []);

  const pickEmoji = useCallback(async (emoji: string) => {
    if (!emoji) return;
    if (isCustomBrushReference(emoji)) {
      const png = await getCustomBrushPNGData(emoji).catch(() => null);
      if (!png) {
        Alert.alert('Brush unavailable', 'This custom brush could not be loaded.');
        return;
      }
    }
    setBrushEmoji(emoji);
    setRecentBrushes((prev) => [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 12));
    onBrushEmojiChange?.(emoji);
    setPickerVisible(false);
  }, [onBrushEmojiChange]);

  const toggleMirrorX = useCallback(() => {
    void Haptics.selectionAsync();
    setMirrorX((v) => !v);
  }, []);

  const toggleMirrorY = useCallback(() => {
    void Haptics.selectionAsync();
    setMirrorY((v) => !v);
  }, []);

  const turnLeft = useCallback(() => {
    void Haptics.selectionAsync();
    setBrushRotation((r) => (r - 90 + 360) % 360);
  }, []);

  const turnRight = useCallback(() => {
    void Haptics.selectionAsync();
    setBrushRotation((r) => (r + 90) % 360);
  }, []);

  const cycleBrushMode = useCallback(() => {
    const next: VectorBrushMode =
      brushMode === 'opaque' ? 'transparent' : brushMode === 'transparent' ? 'smudge' : 'opaque';
    setBrushMode(next);
    onBrushModeChange?.(next);
    void Haptics.selectionAsync();
  }, [brushMode, onBrushModeChange]);

  const changeSmudgeSmoothness = useCallback((value: number) => {
    const next = Math.max(0, Math.min(1, value));
    setSmudgeSmoothness(next);
    onSmudgeSmoothnessChange?.(next);
  }, [onSmudgeSmoothnessChange]);

  const emojiResults = useMemo(
    () => (emojiSearch.trim().length > 0 ? searchRenderableEmojis(emojiSearch) : renderableEmojiEntries),
    [emojiSearch]
  );

  const randomizeBrush = useCallback(() => {
    const pool = emojiResults.length > 0 ? emojiResults : renderableEmojiEntries;
    if (pool.length === 0) return;
    const entry = pool[Math.floor(Math.random() * pool.length)];
    void pickEmoji(entry.emoji);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [emojiResults, pickEmoji]);

  // ── Normal-workspace toolbar wiring ────────────────────────────────────────
  const changeBrushSize = useCallback((value: number) => {
    const next = Math.max(1, Math.min(VECTOR_BRUSH_MAX, Math.round(value)));
    setBrushScreenPx(next);
    setSizeInput(String(next));
  }, []);

  const commitSizeInput = useCallback(() => {
    const parsed = Number(sizeInput);
    if (Number.isFinite(parsed) && sizeInput.length > 0) changeBrushSize(parsed);
    else setSizeInput(String(Math.round(brushScreenPx)));
  }, [brushScreenPx, changeBrushSize, sizeInput]);

  const activateBrushTool = useCallback(() => {
    void Haptics.selectionAsync();
    if (toolMode === 'brush') {
      // Already active: the button toggles the options drawer under it, exactly
      // like the normal workspace (auto-hides after 3s).
      setBrushOptionsVisible((prev) => {
        const next = !prev;
        if (brushOptionsTimer.current) clearTimeout(brushOptionsTimer.current);
        if (next) brushOptionsTimer.current = setTimeout(() => setBrushOptionsVisible(false), 3000);
        return next;
      });
      return;
    }
    setToolMode('brush');
    setBrushOptionsVisible(false);
  }, [toolMode]);

  const activateLineTool = useCallback(() => {
    void Haptics.selectionAsync();
    setBrushOptionsVisible(false);
    setToolMode((m) => (m === 'line' ? 'brush' : 'line'));
  }, []);

  const activateEraserTool = useCallback(() => {
    void Haptics.selectionAsync();
    setBrushOptionsVisible(false);
    setToolMode((m) => (m === 'eraser' ? 'brush' : 'eraser'));
  }, []);

  const activateEmojiPlaneTool = useCallback(() => {
    void Haptics.selectionAsync();
    setBrushOptionsVisible(false);
    setToolMode('emojiplane');
  }, []);

  const changePlaneLatticeLevel = useCallback((level: LatticeLevel) => {
    const plane = editingPlaneRef.current;
    if (!plane) return;
    const currentLevel = (plane.latticeLevel ?? 1) as LatticeLevel;
    if (currentLevel === level && plane.lattice) return;
    const lattice = plane.lattice && currentLevel > 1
      ? resampleLattice(plane.lattice, currentLevel, level)
      : latticeFromPlaneCorners(level, plane.corners);
    updateEditingPlane({ ...plane, lattice, latticeLevel: level, corners: latticeCorners(lattice, level) });
  }, [updateEditingPlane]);

  const changePlaneOpacity = useCallback((opacity: number) => {
    const plane = editingPlaneRef.current;
    if (plane) updateEditingPlane({ ...plane, opacity: Math.max(0, Math.min(1, opacity)) });
  }, [updateEditingPlane]);

  const changePlaneRotation = useCallback((rotation: number) => {
    const plane = editingPlaneRef.current;
    if (!plane) return;
    const next = Math.max(0, Math.min(360, rotation));
    const delta = next - (plane.rotation ?? 0);
    if (Math.abs(delta) < 0.001) return;
    updateEditingPlane({
      ...(rotatePlaneGeometry(plane as any, vectorPlaneCenter(plane), delta) as VectorEmojiPlane),
      rotation: next,
    });
  }, [updateEditingPlane]);

  const changePlaneScale = useCallback((scale: number) => {
    const plane = editingPlaneRef.current;
    if (!plane) return;
    const next = Math.max(0.25, Math.min(2.5, scale));
    const factor = next / Math.max(0.25, plane.scale ?? 1);
    if (Math.abs(factor - 1) < 0.0001) return;
    updateEditingPlane({
      ...(scalePlaneGeometry(plane as any, vectorPlaneCenter(plane), factor) as VectorEmojiPlane),
      scale: next,
    });
  }, [updateEditingPlane]);

  const togglePlaneVisibility = useCallback(() => {
    const plane = editingPlaneRef.current;
    if (plane) updateEditingPlane({ ...plane, visible: plane.visible === false });
  }, [updateEditingPlane]);

  const resetEditingPlane = useCallback(() => {
    const initial = initialPlaneRef.current;
    if (!initial || !editingPlaneRef.current) return;
    updateEditingPlane({ ...initial, emoji: editingPlaneRef.current.emoji });
  }, [updateEditingPlane]);

  const cancelEditingPlane = useCallback(() => {
    editingPlaneRef.current = null;
    initialPlaneRef.current = null;
    setEditingPlane(null);
    setPlaneUndoStack([]);
    setPlaneRedoStack([]);
    void Haptics.selectionAsync();
  }, []);

  const applyEditingPlane = useCallback(() => {
    const plane = editingPlaneRef.current;
    if (!plane) return;
    const stroke = vectorPlaneToStroke(plane);
    setStrokes((previous) => {
      const next = [...previous, stroke];
      void saveStroke(stroke);
      scheduleManifestSave(next.map((item) => item.strokeID));
      return next;
    });
    setRedoStack([]);
    editingPlaneRef.current = null;
    initialPlaneRef.current = null;
    setEditingPlane(null);
    setPlaneUndoStack([]);
    setPlaneRedoStack([]);
    void recordLifetimeStrokeCommit({ eventId: `vector:${stroke.strokeID}`, workspace: 'vector' });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [scheduleManifestSave]);

  useEffect(() => () => { if (brushOptionsTimer.current) clearTimeout(brushOptionsTimer.current); }, []);

  const handleSpacingSliderChange = useCallback((value: number) => {
    const ratio = value / SPACING_SLIDER_SCALE;
    setSpacingRatio(Math.max(MIN_SPACING_RATIO, Math.min(MAX_SPACING_RATIO, ratio)));
  }, []);

  // Zoom pill: readable across the full 1e-9…1e9 range (switches to exponent).
  const zoomLabel = useMemo(() => {
    const format = (value: number) => {
      if (!Number.isFinite(value)) return '1';
      if (value >= 1e5) return value.toExponential(1).replace('e+', 'e');
      if (value >= 10) return String(Math.round(value));
      return value.toFixed(1);
    };
    return camera.zoom >= 1 ? `${format(camera.zoom)}×` : `1/${format(1 / camera.zoom)}×`;
  }, [camera.zoom]);
  const selectedViewpoint = useMemo(
    () => viewpoints.find((viewpoint) => viewpoint.id === selectedVpId) ?? null,
    [selectedVpId, viewpoints]
  );
  const selectedEasingOption = useMemo(
    () => VECTOR_EASING_OPTIONS.find((option) => option.value === selectedViewpoint?.easing) ?? VECTOR_EASING_OPTIONS[0],
    [selectedViewpoint]
  );
  const totalViewpointDurationMs = useMemo(
    () => timelineDurationMs(viewpoints, loopMode),
    [loopMode, viewpoints]
  );

  const planePanelLayout: EmojiPlanePanelLayout = IS_IPAD
    ? (width > height ? 'tabletLandscape' : 'tabletPortrait')
    : 'phone';
  const [planePanelSize, setPlanePanelSize] = useState({
    width: EMOJI_PLANE_PANEL_WIDTH.phone,
    height: 174,
  });
  const [planePanelAnchor, setPlanePanelAnchor] = useState({ left: 12, top: insets.top + 82 });
  const planePanelAnchorRef = useRef(planePanelAnchor);
  planePanelAnchorRef.current = planePanelAnchor;

  useEffect(() => {
    if (toolMode !== 'emojiplane' || !editingPlane) return;
    const projected = vectorPlanePoints(editingPlane).map((point) =>
      projectWorldPoint(point.x, point.y, camera, width, height)
    );
    const xs = projected.map((point) => point.x);
    const ys = projected.map((point) => point.y);
    const margin = 14;
    const obstacle = {
      x: Math.min(...xs) - margin,
      y: Math.min(...ys) - margin,
      width: Math.max(...xs) - Math.min(...xs) + margin * 2,
      height: Math.max(...ys) - Math.min(...ys) + margin * 2,
    };
    const safeTop = insets.top + 72;
    const safeBottom = height - insets.bottom - 112;
    const anchor = placePanelAwayFromRect(
      { x: 6, y: safeTop, width: width - 12, height: Math.max(1, safeBottom - safeTop) },
      obstacle,
      planePanelSize,
      12,
      8,
    );
    planePanelAnchorRef.current = anchor;
    setPlanePanelAnchor(anchor);
    // Deliberately key this to selection/open and measured panel dimensions, not every geometry
    // update: dragging or using a slider must never make the controls jump away mid-gesture.
  }, [editingPlane?.id, height, insets.bottom, insets.top, planePanelSize, toolMode, width]);

  const planePanelDragGesture = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .onChange((event) => {
      const current = planePanelAnchorRef.current;
      const next = {
        left: Math.max(6, Math.min(width - planePanelSize.width - 6, current.left + event.changeX)),
        top: Math.max(insets.top + 72, Math.min(height - insets.bottom - planePanelSize.height - 8, current.top + event.changeY)),
      };
      planePanelAnchorRef.current = next;
      setPlanePanelAnchor(next);
    }), [height, insets.bottom, insets.top, planePanelSize.height, planePanelSize.width, width]);

  if (!visible) return null;

  return (
    <View style={styles.fullscreen}>
      <GestureDetector gesture={gesture}>
        <View style={{ width, height }}>
          <VectorCanvas
            strokes={strokes}
            liveStroke={liveStroke}
            camera={camera}
            width={width}
            height={height}
            canvasRef={canvasRef}
            traceImage={traceImage}
            traceVisible={traceVisible}
            onTraceImageAspect={handleTraceImageAspect}
            editingPlaneStroke={editingPlane ? vectorPlaneToStroke(editingPlane) : null}
            showPlaneControls={toolMode === 'emojiplane' && !playing && !exporting}
          />
        </View>
      </GestureDetector>

      {/* While playing/exporting the whole UI hides so the flight fills the frame.
          A single stop button stays so playback can be interrupted. */}
      {playing && !exporting && (
        <TouchableOpacity style={styles.stopFab} onPress={stopPlayback} accessibilityLabel="Stop playback">
          <Text style={styles.toolEmoji}>⏹</Text>
        </TouchableOpacity>
      )}

      {/* Top: the normal workspace's own toolbar (tools + brush options drawer) */}
      {!playing && !exporting && (
      <WorkspaceToolbar
        styles={vectorStyles}
        hitSlop={LARGE_HIT_SLOP}
        topInset={insets.top}
        isBrushActive={toolMode === 'brush'}
        isLineActive={toolMode === 'line'}
        isEraserActive={toolMode === 'eraser'}
        isEmojiPlaneActive={toolMode === 'emojiplane'}
        onBrush={activateBrushTool}
        onLine={activateLineTool}
        onEraser={activateEraserTool}
        onEmojiPlane={activateEmojiPlaneTool}
        onRandom={randomizeBrush}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        undoDisabled={toolMode === 'emojiplane' ? planeUndoStack.length === 0 : strokes.length === 0}
        redoDisabled={toolMode === 'emojiplane' ? planeRedoStack.length === 0 : redoStack.length === 0}
        clearDisabled={strokes.length === 0 && !editingPlane}
        brushOptionsVisible={brushOptionsVisible}
        onFlipX={toggleMirrorX}
        onFlipY={toggleMirrorY}
        onRotateLeft={turnLeft}
        onRotateRight={turnRight}
        onRecentEmojiPress={(emoji) => { void pickEmoji(emoji); }}
        recentEmojis={recentBrushes}
        mirrorX={mirrorX}
        mirrorY={mirrorY}
        brushEmoji={brushEmoji}
        isLandscape={false}
      />
      )}

      {/* Close: alone in the top-right corner, small, away from the tools */}
      {!playing && !exporting && (
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 10 }]}
          onPress={handleClose}
          accessibilityLabel="Close vector mode"
        >
          <Text style={styles.closeEmoji}>❎</Text>
        </TouchableOpacity>
      )}

      {traceImage && tracePlaced && !tracePanelOpen && !playing && !exporting && (
        <TouchableOpacity
          style={[styles.traceInfoBtn, { top: insets.top + 52 }]}
          onPress={() => setTracePanelOpen(true)}
          accessibilityLabel="Open trace image placement information"
        >
          <Text style={styles.traceInfoText}>ⓘ</Text>
        </TouchableOpacity>
      )}

      {/* Zoom pill (tap = reset to 1×) */}
      {!playing && !exporting && (
        <TouchableOpacity
          style={[styles.zoomChip, { top: insets.top + 10 }]}
          onPress={resetCamera}
          accessibilityLabel="Reset camera to 1×"
        >
          <Text style={styles.zoomText}>{zoomLabel}</Text>
        </TouchableOpacity>
      )}

      {/* Left rail: vector extras + the action buttons (bottom keeps only the
          brush picker, sliders and the alpha toggle) */}
      {!playing && !exporting && (
      <View style={[styles.sideBar, { top: insets.top + 86 }]} pointerEvents="box-none">
        <TouchableOpacity style={styles.sideBtn} onPress={captureViewpoint} accessibilityLabel="Add viewpoint here">
          <Text style={styles.toolEmoji}>📸</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sideBtn, vpPanelOpen && styles.sideBtnActive]}
          onPress={toggleViewpointPanel}
          accessibilityLabel="Viewpoints panel"
        >
          <Text style={styles.toolEmoji}>🎞</Text>
          {viewpoints.length > 0 && (
            <View style={styles.countBadge}><Text style={styles.countText}>{viewpoints.length}</Text></View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sideBtn, viewpoints.length < 2 && { opacity: 0.4 }]}
          disabled={viewpoints.length < 2}
          onPress={togglePlay}
          accessibilityLabel="Play fly-through"
        >
          <Text style={styles.toolEmoji}>▶️</Text>
        </TouchableOpacity>
        <View style={styles.sideDivider} />
        <TouchableOpacity style={styles.sideBtn} onPress={openProjectSave} accessibilityLabel="Save Vector project">
          <Text style={styles.toolEmoji}>💾</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sideBtn, traceImage && styles.sideBtnActive]}
          onPress={() => (traceImage ? setTracePanelOpen((o) => !o) : void pickTraceImage())}
          accessibilityLabel={traceImage ? 'Trace image tools' : 'Import trace image'}
        >
          <Text style={styles.toolEmoji}>{traceImage ? (tracePanelOpen ? '👀' : '🛠️') : '🖼️'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sideBtn, exporting && { opacity: 0.4 }]}
          disabled={exporting}
          onPress={chooseExport}
          accessibilityLabel="Export painting or fly-through"
        >
          <Text style={styles.toolEmoji}>{exporting ? '⌛' : '📤'}</Text>
        </TouchableOpacity>
      </View>
      )}

      {toolMode === 'emojiplane' && editingPlane && !playing && !exporting && (
        <View
          style={[styles.planePanelWrap, planePanelAnchor]}
          onLayout={(event) => {
            const measured = event.nativeEvent.layout;
            if (Math.abs(measured.width - planePanelSize.width) > 0.5 || Math.abs(measured.height - planePanelSize.height) > 0.5) {
              setPlanePanelSize({ width: measured.width, height: measured.height });
            }
          }}
        >
          <GestureDetector gesture={planePanelDragGesture}>
            <View style={styles.planePanelDragHandle}>
              <Text style={styles.planePanelDragText}>⠿ move</Text>
            </View>
          </GestureDetector>
          <EmojiPlanePanel
            emoji={editingPlane.emoji}
            opacity={editingPlane.opacity}
            rotation={editingPlane.rotation ?? 0}
            scale={editingPlane.scale ?? 1}
            visible={editingPlane.visible !== false}
            layout={planePanelLayout}
            canReset={Boolean(initialPlaneRef.current && editingPlane !== initialPlaneRef.current)}
            latticeLevel={(editingPlane.latticeLevel ?? 1) as LatticeLevel}
            onLatticeLevelChange={changePlaneLatticeLevel}
            onOpacityChange={changePlaneOpacity}
            onRotationChange={changePlaneRotation}
            onScaleChange={changePlaneScale}
            onToggleVisibility={togglePlaneVisibility}
            onReset={resetEditingPlane}
            onCancel={cancelEditingPlane}
            onCommit={applyEditingPlane}
          />
        </View>
      )}

      {/* Trace image panel */}
      {tracePanelOpen && traceImage && !playing && !exporting && (
        <View style={styles.vpPanel}>
          <View style={styles.vpHeader}>
            <View>
              <Text style={styles.vpTitle}>🖼️ Trace image</Text>
              <Text style={styles.traceModeHint}>{tracePlaced ? 'Adjust placement, then place again' : 'Adjust before placing'}</Text>
            </View>
            <View style={styles.traceHeaderActions}>
              <TouchableOpacity onPress={removeTraceImage} accessibilityLabel="Remove trace image">
                <Text style={styles.resultCloseText}>✕ Remove</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.panelCloseBtn} onPress={() => setTracePanelOpen(false)} accessibilityLabel="Close trace image panel">
                <Text style={styles.panelCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.traceToggleRow}>
            <Text style={styles.vpEditLabel}>Trace preview</Text>
            <TouchableOpacity
              style={[styles.traceToggle, traceVisible && styles.traceToggleOn]}
              onPress={toggleTraceVisible}
              accessibilityLabel="Toggle trace image visibility"
              accessibilityState={{ checked: traceVisible }}
            >
              <Text style={styles.traceToggleText}>{traceVisible ? '👁 On' : '◌ Off'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.vpEditLabel}>Opacity {(traceImage.opacity * 100).toFixed(0)}%</Text>
          <Slider
            style={styles.vpSlider}
            minimumValue={0.05}
            maximumValue={1}
            value={traceImage.opacity}
            onValueChange={changeTraceOpacity}
            disabled={!traceVisible}
            minimumTrackTintColor="#5ba8ff"
            maximumTrackTintColor="#3a3a3a"
            thumbTintColor="#5ba8ff"
            accessibilityLabel="Trace image opacity"
          />
          <Text style={styles.vpEditLabel}>Scale {((traceImage.scale ?? 1) * 100).toFixed(0)}% · drag with one finger or pinch with two</Text>
          <Slider
            style={styles.vpSlider}
            minimumValue={0.2}
            maximumValue={4}
            step={0.01}
            value={traceImage.scale ?? 1}
            onValueChange={changeTraceScale}
            minimumTrackTintColor="#6fce9b"
            maximumTrackTintColor="#3a3a3a"
            thumbTintColor="#6fce9b"
            accessibilityLabel="Trace image scale"
          />
          <Text style={styles.vpEditLabel}>Rotation {Math.round(traceImage.rotationDegrees ?? 0)}° · two-finger rotate or use slider</Text>
          <Slider
            style={styles.vpSlider}
            minimumValue={-180}
            maximumValue={180}
            step={1}
            value={traceImage.rotationDegrees ?? 0}
            onValueChange={changeTraceRotation}
            minimumTrackTintColor="#d99bff"
            maximumTrackTintColor="#3a3a3a"
            thumbTintColor="#d99bff"
            accessibilityLabel="Trace image rotation"
          />
          <TouchableOpacity style={styles.placeTraceButton} onPress={placeTraceImage} accessibilityLabel="Place trace image">
            <Text style={styles.placeTraceText}>✓ Place trace image</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Viewpoints editing panel */}
      {vpPanelOpen && !playing && !exporting && (
        <View style={styles.vpPanel}>
          <View style={styles.vpHeader}>
            <Text style={styles.vpTitle}>🎞 Viewpoints</Text>
            <TouchableOpacity style={styles.panelCloseBtn} onPress={closeViewpointPanel} accessibilityLabel="Close viewpoints panel">
              <Text style={styles.panelCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.vpStrip}>
            {viewpoints.length === 0 && <Text style={styles.vpEmpty}>Frame a shot, tap 📸 to save this view. Add a few, then ▶️ flies between them.</Text>}
            {viewpoints.map((vp, i) => (
              <TouchableOpacity
                key={vp.id}
                style={[styles.vpChip, selectedVpId === vp.id && styles.vpChipActive]}
                onPress={() => jumpToViewpoint(vp)}
                onLongPress={() => deleteViewpoint(vp.id)}
              >
                <Text style={styles.vpChipNum}>{i + 1}</Text>
                <Text style={styles.vpChipLabel}>{vp.label}</Text>
                <Text style={styles.vpChipDel} onPress={() => deleteViewpoint(vp.id)}> ✕</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.timelineSummary}>
            <View>
              <Text style={styles.timelineSummaryLabel}>
                ⏱ {loopMode === 'loop' ? 'Cycle time' : 'Total flight time'}
              </Text>
              <Text style={styles.timelineSummaryHint}>
                {viewpoints.length < 2 ? 'Add at least 2 views' : loopMode === 'loop' ? 'One repeatable cycle' : loopMode === 'pingPong' ? 'Forward + return' : 'One-way flight'}
              </Text>
            </View>
            <Text style={styles.timelineSummaryValue}>
              {viewpoints.length < 2 ? '—' : formatTimelineDuration(totalViewpointDurationMs)}
            </Text>
          </View>
          <View style={styles.timingOptionsRow}>
            <TouchableOpacity
              style={styles.easeChip}
              onPress={() => selectedViewpoint && setEasePickerOpen(true)}
              disabled={!selectedViewpoint}
              accessibilityLabel="Choose viewpoint easing"
            >
              <Text style={styles.easeText}>∿ {selectedViewpoint ? selectedEasingOption.label : 'Choose easing'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.loopChip} onPress={cycleLoopMode} accessibilityLabel="Choose loop mode">
              <Text style={styles.loopText}>
                {loopMode === 'once' ? '▶ once' : loopMode === 'loop' ? '↻ loop' : '⇄ ping-pong'}
              </Text>
            </TouchableOpacity>
          </View>
          {selectedViewpoint && (
            <View style={styles.vpEdit}>
              <Text style={styles.vpEditLabel}>⏱ Travel {(selectedViewpoint.durationToNextMs / 1000).toFixed(1)}s</Text>
              <Slider
                style={styles.vpSlider}
                minimumValue={200} maximumValue={8000} step={100}
                value={selectedViewpoint.durationToNextMs}
                onValueChange={(v) => updateViewpoint(selectedViewpoint.id, { durationToNextMs: Math.round(v) })}
                minimumTrackTintColor="#5ba8ff" maximumTrackTintColor="#3a3a3a" thumbTintColor="#5ba8ff"
              />
              <Text style={styles.vpEditLabel}>⏸ Hold {(selectedViewpoint.holdMs / 1000).toFixed(1)}s</Text>
              <Slider
                style={styles.vpSlider}
                minimumValue={0} maximumValue={5000} step={100}
                value={selectedViewpoint.holdMs}
                onValueChange={(v) => updateViewpoint(selectedViewpoint.id, { holdMs: Math.round(v) })}
                minimumTrackTintColor="#8b6dff" maximumTrackTintColor="#3a3a3a" thumbTintColor="#8b6dff"
              />
            </View>
          )}
        </View>
      )}

      <Modal
        visible={easePickerOpen && vpPanelOpen && !playing && !exporting && Boolean(selectedViewpoint)}
        transparent
        animationType="fade"
        onRequestClose={() => setEasePickerOpen(false)}
      >
        <View style={styles.easeModalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setEasePickerOpen(false)}
            accessibilityLabel="Close easing picker"
          />
          <View style={styles.easeModalCard}>
            <View style={styles.easeModalHeader}>
              <View>
                <Text style={styles.easeModalTitle}>Flight easing</Text>
                <Text style={styles.easeModalSubtitle}>How View {Math.max(1, viewpoints.findIndex((viewpoint) => viewpoint.id === selectedViewpoint?.id) + 1)} travels to the next view</Text>
              </View>
              <TouchableOpacity style={styles.panelCloseBtn} onPress={() => setEasePickerOpen(false)} accessibilityLabel="Close easing picker">
                <Text style={styles.panelCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.easeOptionsList} contentContainerStyle={styles.easeOptionsContent}>
              {VECTOR_EASING_OPTIONS.map((option) => {
                const selected = selectedViewpoint?.easing === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.easeOption, selected && styles.easeOptionSelected]}
                    onPress={() => {
                      if (selectedViewpoint) updateViewpoint(selectedViewpoint.id, { easing: option.value });
                      setEasePickerOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.easeOptionText}>
                      <Text style={styles.easeOptionLabel}>{option.label}</Text>
                      <Text style={styles.easeOptionDescription}>{option.description}</Text>
                    </View>
                    {selected && <Text style={styles.easeOptionCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Bottom dock: same brush controls + quick actions as the normal workspace */}
      {!playing && !exporting && (
      <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 8) }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.bottomPickerBtn}
          onPress={() => setPickerVisible(true)}
          accessibilityLabel="Choose brush emoji"
        >
          <BrushEmojiIcon emoji={brushEmoji} size={30} textStyle={{ fontSize: 26 }} />
        </TouchableOpacity>
        <View style={styles.bottomControlsFill}>
        <BrushControls
          styles={vectorStyles}
          hitSlop={LARGE_HIT_SLOP}
          brushSize={brushScreenPx}
          sizeInput={sizeInput}
          sizeSliderMaximum={VECTOR_BRUSH_MAX}
          onSizeSliderChange={changeBrushSize}
          onSizeInputChange={(text) => setSizeInput(text.replace(/[^0-9]/g, ''))}
          onSizeInputSubmit={commitSizeInput}
          onSizeInputFocus={() => {}}
          onSizeInputBlur={commitSizeInput}
          onToggleOpacity={cycleBrushMode}
          isOpacityTransparent={brushMode !== 'opaque'}
          opacityToggleEmoji={brushMode === 'opaque' ? '💯' : brushMode === 'transparent' ? '1️⃣' : '👆'}
          smudgeActive={brushMode === 'smudge'}
          smudgeSmoothness={smudgeSmoothness}
          onSmudgeSmoothnessChange={changeSmudgeSmoothness}
          spacingSlider={{
            value: spacingRatio * SPACING_SLIDER_SCALE,
            onChange: handleSpacingSliderChange,
          }}
          isIpad={IS_IPAD}
          isLandscape={false}
          brushEmoji={brushEmoji}
          onEmojiPickerOpen={() => setPickerVisible(true)}
        />
        </View>
      </View>
      )}

      {/* Resume or start fresh — offered from the manifest alone, so it appears
          immediately instead of after every stroke file has been read. */}
      <Modal
        visible={resumePrompt !== null}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setResumePrompt(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.saveProjectCard}>
            <Text style={styles.resultTitle}>🔷 Vector Mode</Text>
            {resumePrompt?.preview ? (
              <Image
                source={{ uri: resumePrompt.preview }}
                style={styles.resumePreview}
                resizeMode="cover"
                accessibilityLabel="Preview of your last vector drawing"
              />
            ) : null}
            <Text style={styles.saveProjectInfo}>
              {`Your last drawing has ${resumePrompt?.strokes ?? 0} stroke${(resumePrompt?.strokes ?? 0) === 1 ? '' : 's'}. Continue it, or start with an empty canvas?`}
            </Text>
            <View style={styles.saveProjectActions}>
              <TouchableOpacity
                style={styles.saveProjectCancel}
                onPress={startNewVectorDocument}
                disabled={restoring}
                accessibilityLabel="Start a new empty vector drawing"
              >
                <Text style={styles.saveProjectCancelText}>🆕  Start new</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveProjectConfirm, restoring && { opacity: 0.6 }]}
                onPress={resumeVectorDocument}
                disabled={restoring}
                accessibilityLabel="Resume the last vector drawing"
              >
                {restoring
                  ? <ActivityIndicator color="#07131f" />
                  : <Text style={styles.saveProjectConfirmText}>▶  Resume</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <EmojiPickerModal
        visible={pickerVisible}
        styles={emojiPickerStyles}
        emojiSearch={emojiSearch}
        onEmojiSearchChange={setEmojiSearch}
        recentEmojis={recentBrushes}
        brushEmoji={brushEmoji}
        emojiResults={emojiResults}
        onSelectEmoji={(emoji) => { void pickEmoji(emoji); }}
        onLoadCustomBrushToWorkspace={(emoji) => { void pickEmoji(emoji); }}
        onClose={() => setPickerVisible(false)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        mirrorX={mirrorX}
        mirrorY={mirrorY}
        rotation={brushRotation}
        onToggleMirrorX={toggleMirrorX}
        onToggleMirrorY={toggleMirrorY}
        onTurnLeft={turnLeft}
        onTurnRight={turnRight}
      />

      <Modal
        visible={Boolean(recordedVideoUri)}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setRecordedVideoUri(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.videoResultCard}>
            <View style={styles.resultHeader}>
              <View>
                <Text style={styles.resultTitle}>🎬 Vector fly-through</Text>
                <Text style={styles.resultSubtitle}>Recording complete · preview before saving</Text>
              </View>
              <TouchableOpacity style={styles.resultClose} onPress={() => setRecordedVideoUri(null)}>
                <Text style={styles.resultCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {recordedVideoUri && (
              <View style={[styles.recordedPreview, { aspectRatio: width / Math.max(1, height) }]}>
                {recordedPreviewReady ? (
                  <ShortVideoPlayer
                    uri={recordedVideoUri}
                    style={StyleSheet.absoluteFill}
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay
                    // ReplayKit exports this Vector flight without audio. A
                    // muted preview avoids an AVAudioSession transition while
                    // the finish modal is being presented.
                    isMuted
                  />
                ) : (
                  <View style={styles.recordedPreviewLoading}>
                    <ActivityIndicator color="#8fc1ff" />
                    <Text style={styles.recordedPreviewLoadingText}>Preparing preview…</Text>
                  </View>
                )}
              </View>
            )}

            <View style={styles.resultActions}>
              <TouchableOpacity style={styles.resultPrimaryButton} onPress={() => void shareRecordedVideo()} disabled={Boolean(videoAction)}>
                <Text style={styles.resultPrimaryText}>{videoAction === 'share' ? 'Sharing…' : '📤 Share'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resultButton, videoSavedToPhotos && styles.resultButtonDone]}
                onPress={() => void saveRecordedToPhotos()}
                disabled={Boolean(videoAction) || videoSavedToPhotos}
              >
                <Text style={styles.resultButtonText}>{videoSavedToPhotos ? '✓ Saved to Photos' : '📱 Save to Photos'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resultButton, videoSavedToStorage && styles.resultButtonDone]}
                onPress={() => void saveRecordedToVideoStorage()}
                disabled={Boolean(videoAction) || videoSavedToStorage}
              >
                <Text style={styles.resultButtonText}>{videoSavedToStorage ? '✓ Saved to Video Storage' : '🎥 Save to Video Storage'}</Text>
              </TouchableOpacity>
              {videoSavedToStorage && (
                <TouchableOpacity style={styles.resultButton} onPress={() => {
                  setRecordedVideoUri(null);
                  onClose();
                  navigation.navigate('VideoStorage');
                }}>
                  <Text style={styles.resultButtonText}>📂 Open Video Storage</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.resultFooter}>
              {videoAction ? <ActivityIndicator color="#fff" /> : (
                <TouchableOpacity onPress={() => { setRecordedVideoUri(null); void exportVideo(); }}>
                  <Text style={styles.recordAgainText}>↻ Record again</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setRecordedVideoUri(null)}>
                <Text style={styles.keepEditingText}>Keep editing</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={saveProjectVisible}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => { if (!projectSaving) setSaveProjectVisible(false); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.saveProjectCard}>
            <Text style={styles.resultTitle}>💾 Save Vector project</Text>
            <Text style={styles.saveProjectInfo}>
              Saves artwork, camera, viewpoints, timing and loop mode to the normal Projects library.
            </Text>
            <TextInput
              style={styles.projectNameInput}
              value={projectNameDraft}
              onChangeText={setProjectNameDraft}
              placeholder="Project name"
              placeholderTextColor="#777"
              autoFocus
              selectTextOnFocus
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={() => void saveCurrentVectorProject()}
            />
            <View style={styles.saveProjectActions}>
              <TouchableOpacity style={styles.saveProjectCancel} onPress={() => setSaveProjectVisible(false)} disabled={projectSaving}>
                <Text style={styles.saveProjectCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveProjectConfirm, (!projectNameDraft.trim() || projectSaving) && { opacity: 0.5 }]}
                onPress={() => void saveCurrentVectorProject()}
                disabled={!projectNameDraft.trim() || projectSaving}
              >
                {projectSaving ? <ActivityIndicator color="#07131f" /> : <Text style={styles.saveProjectConfirmText}>Save to Projects</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  planePanelWrap: { position: 'absolute', zIndex: 80 },
  planePanelDragHandle: {
    alignSelf: 'center', paddingHorizontal: 9, paddingVertical: 3, marginBottom: 2,
    borderRadius: 7, backgroundColor: 'rgba(20,20,20,0.88)', borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.45)',
  },
  planePanelDragText: { color: 'rgba(255,255,255,0.68)', fontSize: 9, fontWeight: '800' },
  fullscreen: { ...StyleSheet.absoluteFillObject, zIndex: 11600, backgroundColor: '#101014' },
  zoomChip: {
    position: 'absolute',
    left: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(20,20,26,0.9)',
    borderWidth: 1,
    borderColor: '#2f4c73',
    zIndex: 40,
  },
  zoomText: { color: '#8fc1ff', fontSize: 12, fontWeight: '800' },
  toolEmoji: { fontSize: 14 },
  bottomDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
  },
  bottomPickerBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,26,0.95)',
    borderWidth: 2,
    borderColor: '#5ba8ff',
  },
  bottomControlsFill: { flex: 1 },
  sideDivider: { height: 1, marginVertical: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  sideBar: { position: 'absolute', left: 12, gap: 7, zIndex: 25 },
  sideBtn: {
    // 30% smaller than the original 46pt so the rail stays out of the way.
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(20,20,26,0.92)', borderWidth: 1, borderColor: '#2f4c73',
  },
  closeBtn: {
    position: 'absolute', right: 12, width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', zIndex: 40,
    backgroundColor: 'rgba(20,20,26,0.92)', borderWidth: 1, borderColor: '#2f4c73',
  },
  closeEmoji: { fontSize: 14 },
  traceInfoBtn: {
    position: 'absolute', right: 12, width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', zIndex: 40,
    backgroundColor: 'rgba(20,20,26,0.92)', borderWidth: 1, borderColor: '#6fce9b',
  },
  traceInfoText: { color: '#a9f0c6', fontSize: 18, fontWeight: '900' },
  sideBtnActive: { backgroundColor: '#20344f', borderColor: '#5ba8ff' },
  countBadge: {
    position: 'absolute', top: -3, right: -3, minWidth: 13, height: 13, borderRadius: 7,
    backgroundColor: '#5ba8ff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  countText: { color: '#06121f', fontSize: 8, fontWeight: '800' },
  stopFab: {
    position: 'absolute', bottom: 40, alignSelf: 'center', width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(200,40,40,0.92)', zIndex: 20,
  },
  vpPanel: {
    position: 'absolute', left: 68, right: 12, bottom: 180, padding: 12, borderRadius: 16, zIndex: 26,
    backgroundColor: 'rgba(12,12,18,0.96)', borderWidth: 1, borderColor: 'rgba(91,168,255,0.4)',
  },
  vpHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  vpTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  traceModeHint: { color: '#9ba8b8', fontSize: 10, marginTop: 2 },
  traceHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  panelCloseBtn: {
    width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#25252c', borderWidth: 1, borderColor: '#48566b',
  },
  panelCloseText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  loopChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#20344f', borderWidth: 1, borderColor: '#5ba8ff' },
  loopText: { color: '#8fc1ff', fontSize: 12, fontWeight: '700' },
  vpStrip: { maxHeight: 60 },
  vpEmpty: { color: 'rgba(255,255,255,0.5)', fontSize: 12, paddingVertical: 10 },
  vpChip: {
    marginRight: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, minWidth: 68,
    backgroundColor: '#222', borderWidth: 1, borderColor: '#3a3a3a', flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  vpChipActive: { backgroundColor: '#20344f', borderColor: '#5ba8ff' },
  vpChipNum: { color: '#5ba8ff', fontSize: 12, fontWeight: '900' },
  vpChipLabel: { color: '#fff', fontSize: 12, fontWeight: '700' },
  vpChipDel: { color: '#ff8080', fontSize: 12, fontWeight: '800' },
  vpEdit: { marginTop: 8, gap: 2 },
  vpEditLabel: { color: '#dcdcdc', fontSize: 11, fontWeight: '700' },
  vpSlider: { width: '100%', height: 28 },
  timelineSummary: {
    marginTop: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(91,168,255,0.10)', borderWidth: 1, borderColor: 'rgba(91,168,255,0.24)',
  },
  timelineSummaryLabel: { color: '#d9eaff', fontSize: 12, fontWeight: '800' },
  timelineSummaryHint: { color: 'rgba(217,234,255,0.58)', fontSize: 10, marginTop: 2 },
  timelineSummaryValue: { color: '#8fc1ff', fontSize: 16, fontWeight: '900' },
  timingOptionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  easeChip: { flex: 1, marginTop: 0, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: '#2a2436', borderWidth: 1, borderColor: '#8b6dff' },
  easeText: { color: '#c3b3ff', fontSize: 11, fontWeight: '700' },
  easeModalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.78)' },
  easeModalCard: {
    width: '100%', maxWidth: 560, maxHeight: '82%', padding: 16, borderRadius: 20,
    backgroundColor: '#15151b', borderWidth: 1, borderColor: '#536b91', zIndex: 2,
  },
  easeModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  easeModalTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  easeModalSubtitle: { color: '#9ba8b8', fontSize: 11, marginTop: 3, maxWidth: 300 },
  easeOptionsList: { maxHeight: 470 },
  easeOptionsContent: { gap: 7 },
  easeOption: {
    minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#22232a', borderWidth: 1, borderColor: '#343944',
  },
  easeOptionSelected: { backgroundColor: '#263a54', borderColor: '#5ba8ff' },
  easeOptionText: { flex: 1 },
  easeOptionLabel: { color: '#fff', fontSize: 13, fontWeight: '800' },
  easeOptionDescription: { color: '#9ba8b8', fontSize: 10, marginTop: 2 },
  easeOptionCheck: { color: '#8fc1ff', fontSize: 19, fontWeight: '900', marginLeft: 10 },
  traceToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  traceToggle: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: '#292930', borderWidth: 1, borderColor: '#484854' },
  traceToggleOn: { backgroundColor: '#183629', borderColor: '#6fce9b' },
  traceToggleText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  placeTraceButton: { minHeight: 42, marginTop: 8, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#6fce9b' },
  placeTraceText: { color: '#071a10', fontSize: 13, fontWeight: '900' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  videoResultCard: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '94%',
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#15151b',
    borderWidth: 1,
    borderColor: '#3d536f',
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  resultTitle: { color: '#fff', fontSize: 21, fontWeight: '900' },
  resultSubtitle: { color: '#9ba8b8', fontSize: 12, marginTop: 3 },
  resultClose: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#25252c', borderWidth: 1, borderColor: '#444',
  },
  resultCloseText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  recordedPreview: {
    width: '100%',
    flexShrink: 1,
    minHeight: 220,
    maxHeight: 470,
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#333',
  },
  recordedPreviewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  recordedPreviewLoadingText: { color: '#9ba8b8', fontSize: 12, fontWeight: '700' },
  resultActions: { marginTop: 14, gap: 9 },
  resultPrimaryButton: {
    minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  resultPrimaryText: { color: '#000', fontSize: 15, fontWeight: '900' },
  resultButton: {
    minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#262630', borderWidth: 1, borderColor: '#484854',
  },
  resultButtonDone: { backgroundColor: '#183629', borderColor: '#5fbf88' },
  resultButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  resultFooter: {
    marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 30,
  },
  recordAgainText: { color: '#8fc1ff', fontSize: 13, fontWeight: '800' },
  keepEditingText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  saveProjectCard: {
    width: '100%',
    maxWidth: 520,
    padding: 22,
    borderRadius: 20,
    backgroundColor: '#15151b',
    borderWidth: 1,
    borderColor: '#3d536f',
  },
  resumePreview: {
    width: '100%', height: 170, borderRadius: 14, marginTop: 14,
    backgroundColor: '#0b0b10', borderWidth: 1, borderColor: '#2f4c73',
  },
  saveProjectInfo: { color: '#aeb7c4', fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 16 },
  projectNameInput: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#6faeea',
    backgroundColor: '#09090c',
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    paddingHorizontal: 14,
  },
  saveProjectActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  saveProjectCancel: {
    flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#292930',
  },
  saveProjectCancelText: { color: '#fff', fontWeight: '800' },
  saveProjectConfirm: {
    flex: 1.5, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#8fc1ff',
  },
  saveProjectConfirmText: { color: '#07131f', fontWeight: '900' },
});

export default VectorWorkspace;
