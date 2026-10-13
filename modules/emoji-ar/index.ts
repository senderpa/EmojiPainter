/**
 * EmojiAr — JS bindings for the ARKit native module.
 *
 * Tolerant resolution like modules/emojispray-bridge: when the native module
 * is absent (simulator without ARKit views, Android, Expo Go) all exports
 * degrade gracefully so importing this file never crashes.
 */
import * as React from 'react';
import type { ViewProps } from 'react-native';

export interface EmojiArConstants {
  isFaceTrackingSupported: boolean;
  isWorldTrackingSupported: boolean;
  isLiDARAvailable: boolean;
  maxTrackedFaces: number;
}

export interface FaceFilterViewProps extends ViewProps {
  /** Pause face tracking (preserves the loaded head) for fast scene switching */
  paused?: boolean;
  /** Local USDZ/GLB path of the server-rigged emoji head ("" clears it) */
  modelPath?: string;
  /** arkit blendShape key → morph-target name (from the server payload) */
  arkitMapping?: Record<string, string>;
  /** Default face-mesh mask: 'none' | 'grey' | 'camera' | 'model' */
  maskMode?: 'none' | 'grey' | 'camera' | 'model';
  /** Paint emoji stamps onto the grey face mask (touch → mesh UV) */
  paintEnabled?: boolean;
  /** Brush emoji used for face-mask painting */
  brushEmoji?: string;
  /** Brush size in pixels (8–400) */
  paintSizePx?: number;
  /** 'stamp' = emoji stamps · 'smudge' = drag the canvas/webcam pixels like a finger */
  paintMode?: 'stamp' | 'smudge';
  /** Smudge colour-carry strength (0–1) when paintMode === 'smudge' */
  smudgeStrength?: number;
  /** Restore a previously-saved paint texture (file path) */
  paintTexturePath?: string;
  /** SD-restyled overlay for the webcam (textured) mask ("" = original) */
  cameraOverlayTexturePath?: string;
  /** Show the big face-tracked transparent paint plane behind the mask. */
  facePlaneEnabled?: boolean;
  onFacesChanged?: (event: { nativeEvent: { count: number } }) => void;
  onSessionReady?: (event: { nativeEvent: Record<string, never> }) => void;
  onModelLoaded?: (event: { nativeEvent: { ok: boolean } }) => void;
  onArError?: (event: { nativeEvent: { message: string } }) => void;
}

export interface SavedFrontMask {
  id: string;
  name: string;
  createdAt: number;
  markCount: number;
  thumbnailPath: string;
  isAutosave: boolean;
}

export interface FrontMaskViewProps extends ViewProps {
  paused?: boolean;
  brushSizeMeters?: number;
  /** RGB or RGBA, either 0…1 or 0…255. */
  brushColor?: number[];
  brushMode?: 'spray' | 'relief' | 'texture' | 'emoji';
  brushEmoji?: string;
  /** Next touch samples the real front-camera image instead of painting. */
  eyedropperEnabled?: boolean;
  sprayCanEnabled?: boolean;
  gridEnabled?: boolean;
  cameraTextureEnabled?: boolean;
  /**
   * Where Texture/Relief land. `auto` (default) picks per touch: the face mesh
   * when the finger is on the face, the surrounding paint plane when it is not.
   * The explicit values pin one surface: `face`, `plane` (head-tracked plane
   * around the face) or `front3D` (camera-facing plane in front of the face).
   */
  textureTarget?: 'auto' | 'face' | 'plane' | 'front3D';
  /** Free Mode: emoji/spray marks float in the space around the head. */
  freeModeEnabled?: boolean;
  /** Texture/Relief drag shape. Clean is the default continuous line. */
  textureLineStyle?: 'clean' | 'spray';
  /** Add a generated surface normal to Texture (Relief always uses one). */
  textureNormalEnabled?: boolean;
  brushMirrorX?: boolean;
  brushMirrorY?: boolean;
  brushRotation?: number;
  brushSpacing?: number;
  onSessionReady?: (event: { nativeEvent: Record<string, never> }) => void;
  onFaceChanged?: (event: { nativeEvent: { count: number } }) => void;
  onHistoryChanged?: (event: { nativeEvent: {
    undoCount: number;
    redoCount: number;
    markCount: number;
  } }) => void;
  /** A new user gesture produced committed paint; never emitted for mask loading/history replay. */
  onStrokeCommitted?: (event: { nativeEvent: { strokeId: string } }) => void;
  onMasksChanged?: (event: { nativeEvent: { masks: SavedFrontMask[] } }) => void;
  onMaskLoaded?: (event: { nativeEvent: {
    id: string;
    name: string;
    markCount: number;
  } }) => void;
  onColorPicked?: (event: { nativeEvent: {
    rgba: [number, number, number, number];
    hex: string;
  } }) => void;
  /** Free Mode locked its camera-parallel drawing plane for this stroke. */
  onFreePlaneLocked?: (event: { nativeEvent: {
    axis: string;
    distanceCm: number;
  } }) => void;
  onArError?: (event: { nativeEvent: { message: string } }) => void;
}

export type WallPaintToolMode = 'brush' | 'line' | 'eraser' | 'smudge';

/** Sun / shadow lighting mood applied to the AR scene */
export type WallPaintSunPreset =
  | 'noon'
  | 'studio'
  | 'morning'
  | 'sunset'
  | 'hard'
  | 'soft'
  | 'dramatic'
  | 'off';

export interface WallPaintViewProps extends ViewProps {
  brushEmoji?: string;
  brushSizeMeters?: number;
  /** Same normalized spacing as the 2D canvas: stamp distance = size × spacing */
  brushSpacing?: number;
  brushOpacity?: number;
  mirrorX?: boolean;
  /** 🖌️ mirror/rotate brush options — the glyph itself. Distinct from `mirrorX` above, which is a
   * paint-SYMMETRY brush (stamps a second mirrored copy across the screen), not a glyph flip. */
  stampMirrorX?: boolean;
  stampMirrorY?: boolean;
  /** Degrees, same convention as the 2D/Metal engines' brush rotation. */
  stampRotation?: number;
  /** Active tool, mirrors the 2D workspace tools */
  toolMode?: WallPaintToolMode;
  /** Smudge reach 0–6 (∞ ceiling; how far the dragged camera pixels are carried) */
  smudgeStrength?: number;
  /** Smudge texture focus: 0 = sharp lift, 0.5 = legacy, 1 = soft cloud */
  smudgeFocus?: number;
  /** Smudge flow: 0 = locked first-pickup stamps, 0.5 = legacy, 1 = dense soft local cloud */
  smudgeFlow?: number;
  /** Frame Animator: legacy strokes stay visible; new strokes receive frame timing. */
  animationEnabled?: boolean;
  /** Paused-only scrub. During playback the native CADisplayLink owns the frame. */
  animationCurrentFrame?: number;
  /** Starts/stops the NATIVE playback clock (CADisplayLink at animationFps). */
  animationPlaying?: boolean;
  /** Timeline frame count, capped at 900 for lightweight AR playback. */
  animationTotalFrames?: number;
  /** New-stroke lifetime in frames; -1 makes a permanent background stroke. */
  animationStrokeLength?: number;
  animationFps?: number;
  animationLooping?: boolean;
  /** Pause the AR session (scene + strokes preserved) for fast scene switching */
  paused?: boolean;
  /** Collect RoomPlan in the background on supported LiDAR devices. */
  roomPlanEnabled?: boolean;
  /** Show the optional RoomPlan/hybrid preview without touching live strokes. */
  roomPreviewEnabled?: boolean;
  /** Show the 3D spray can companion (default true) */
  sprayCanEnabled?: boolean;
  /** Spray hiss + shake rattle sounds (default true) */
  soundEnabled?: boolean;
  /** Flash a grid when a surface is detected (default true) */
  gridEnabled?: boolean;
  /** Sun angle + shadow mood for the AR scene (default 'studio') */
  sunPreset?: WallPaintSunPreset;
  /** How dark the cast shadow is, 0 (none) … 1 (black). Default 0.5 */
  shadowStrength?: number;
  /** How much the sun lights/shades the strokes, 0 (flat) … 1 (fully lit). Default 0.5 */
  strokeLightAmount?: number;
  /** How fast the sun drifts to follow the spray can, 0 (glacial) … 1 (snappy). Default 0.08 */
  sunFollowSpeed?: number;
  /** Blend strokes into the real scene: distance fog + room-matched brightness/colour */
  blendFilterEnabled?: boolean;
  /** How hard strokes are pulled toward the scene, 0 (subtle) … 1 (strong). Default 0.5 */
  blendAmount?: number;
  /** AR plane occlusion: detected walls hide virtual content behind them (default true) */
  occlusionEnabled?: boolean;
  /** Person segmentation: a human in view renders on top of the strokes (default off) */
  personOcclusionEnabled?: boolean;
  /** Strokes cast a real shadow onto AR planes (default off = clean flat decals). */
  strokeShadowsEnabled?: boolean;
  /** Painting over an existing stroke lifts the new one a hair more each time (default off). */
  strokeStackingEnabled?: boolean;
  /** Per-layer stacking lift 0…1 → 0.5mm…9mm. */
  strokeStackHeight?: number;
  /** When on, the sun strongly follows where you aim/paint (shadows swing). */
  sunFollowEnabled?: boolean;
  /** Dominant emoji color [r,g,b] (0-255) for paint drips */
  dripColor?: number[];
  /** The emoji's top colours [[r,g,b],…] (0-255) for multi-colour drip gradients */
  dripColors?: number[][];
  onPlanesChanged?: (event: { nativeEvent: { count: number } }) => void;
  /** A paint touch missed all bounded, detected AR planes. */
  onSurfaceUnavailable?: (event: { nativeEvent: Record<string, never> }) => void;
  /** A saved scene restored its Animator configuration. */
  onAnimationLoaded?: (event: { nativeEvent: {
    enabled: boolean;
    currentFrame: number;
    totalFrames: number;
    strokeLength: number;
    fps: number;
    looping: boolean;
  } }) => void;
  /** Native playback clock advanced (or stopped — final sync). */
  onAnimationFrameChanged?: (event: { nativeEvent: { frame: number } }) => void;
  /** Non-looping playback reached the last frame and stopped. */
  onAnimationEnded?: (event: { nativeEvent: Record<string, never> }) => void;
  onHistoryChanged?: (event: { nativeEvent: { undoCount: number; redoCount: number } }) => void;
  /** Brush resized by two-finger pinch — size in meters */
  onBrushSizeChanged?: (event: { nativeEvent: { size: number } }) => void;
  onSessionReady?: (event: { nativeEvent: { lidar: boolean } }) => void;
  onArError?: (event: { nativeEvent: { message: string } }) => void;
  /** Scene load lifecycle: relocalizing → found → replaying → done */
  onSceneStatus?: (event: { nativeEvent: { status: 'relocalizing' | 'found' | 'replaying' | 'done'; total?: number } }) => void;
  /** Quiet RoomPlan readiness; scanning/partial are not shown as UI by default. */
  onRoomReadinessChanged?: (event: { nativeEvent: {
    state: 'unsupported' | 'scanning' | 'partial' | 'roomReady';
    confidence: number;
    wallCount?: number;
    floorCount?: number;
    openingCount?: number;
    coverage?: number;
    stability?: number;
    viewpoints?: number;
    worldMappingStatus?: string;
  } }) => void;
  /** A new paint touch stopped any active melt, destroy, or converted-3D effect. */
  onStrokeStarted?: (event: { nativeEvent: {
    meltdownStopped: boolean;
    destroyStopped: boolean;
    threeDStopped: boolean;
  } }) => void;
  /** A new user gesture produced committed paint; never emitted for restore/history replay. */
  onStrokeCommitted?: (event: { nativeEvent: { strokeId: string } }) => void;
}

export interface RoomPreviewViewProps extends ViewProps {
  /** JSON-stringified RoomViewerData (roomPlanSurfaces + strokes). */
  roomDataJSON?: string;
}

/** Ref handle exposing the native view AsyncFunctions */
export interface FaceFilterViewRef {
  /** Grab the plain front-camera selfie (JPEG path) for upload */
  captureSelfie: () => Promise<string>;
  /** Capture the composed puppet view (camera + emoji head) as a PNG */
  snapshot: () => Promise<string>;
  /** Reset the grey-mask paint canvas */
  clearFacePaint: () => Promise<void>;
  /** Export the painted mask texture to a PNG (for persistence); returns path */
  exportFacePaint: () => Promise<string>;
  /** Export the baked webcam face texture (for SD restyling); returns path */
  exportCameraTexture: () => Promise<string>;
  /** Reshoot frame-0 in place (fresh webcam bake, no node teardown → no flash) */
  rebakeCamera: () => Promise<void>;
  /** Preload SD frames into memory (index 0 = original) for instant playback */
  sdSetFrames: (paths: string[]) => Promise<void>;
  /** Play the preloaded frames as a video at `fps` (1–30), never hiding the mask */
  sdPlay: (fps: number) => Promise<void>;
  /** Stop playback and seed the paint canvas with the stopped-on frame */
  sdStop: () => Promise<void>;
  /** Jump to a specific preloaded frame (scrub/step) */
  sdShowFrame: (index: number) => Promise<void>;
  /** Preload the background plane's SD frames (played in sync with the mask). */
  sdSetPlaneFrames: (paths: string[]) => Promise<void>;
  /** Export the background plane's paint canvas (for SD); returns path. */
  exportPlaneTexture: () => Promise<string>;
}

export interface FrontMaskViewRef {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearMask: () => Promise<void>;
  saveMask: (name: string) => Promise<SavedFrontMask>;
  loadMask: (id: string) => Promise<number>;
  resumeAutosave: () => Promise<number>;
  deleteMask: (id: string) => Promise<void>;
  duplicateMask: (id: string) => Promise<SavedFrontMask>;
  listMasks: () => Promise<SavedFrontMask[]>;
  snapshot: () => Promise<string>;
}

export interface WallPaintViewRef {
  undo: () => Promise<void>;
  /** Jump the native animation playhead to a frame (scrub / step). */
  seekAnimation: (frame: number) => Promise<void>;
  /** Meltdown effect: every stroke oozes into fluid that runs/spreads (perf-capped). */
  startMeltdown: () => Promise<void>;
  stopMeltdown: () => Promise<void>;
  /** Destroy effect: the biggest strokes fall & bounce off the AR planes (perf-capped). */
  startDestroy: () => Promise<void>;
  /** Stop destroy physics immediately, freezing the strokes where they are. */
  stopDestroy: () => Promise<void>;
  /** Wash: painted strokes go wet and run down the real surfaces under gravity, mixing as they pool. */
  startWash: () => Promise<void>;
  /** Freeze the wash where it is — the washed result becomes the permanent artwork. */
  stopWash: () => Promise<void>;
  redo: () => Promise<void>;
  previewBrushSize: () => Promise<void>;
  clear: () => Promise<void>;
  snapshot: () => Promise<string>;
  startPlacement: (path: string, isVideo: boolean) => Promise<void>;
  confirmPlacement: () => Promise<void>;
  cancelPlacement: () => Promise<void>;
  /** Save ARWorldMap + strokes + snapshot; optional RoomPlan files are included. */
  saveScene: () => Promise<{ dir: string; snapshotPath: string; strokeCount: number; roomReady?: boolean; roomSurfaceCount?: number }>;
  /** Save the same editable package, explicitly labelled as a room. */
  saveRoom: () => Promise<{ dir: string; snapshotPath: string; strokeCount: number; roomReady?: boolean; roomSurfaceCount?: number }>;
  /** Get the current RoomPlan + editable world-space strokes for the orbit viewer. */
  getRoomViewerData: () => Promise<Record<string, unknown>>;
  /** Load a saved scene: relocalize the room, then replay strokes */
  loadScene: (dir: string) => Promise<void>;
}

const FALLBACK_CONSTANTS: EmojiArConstants = {
  isFaceTrackingSupported: false,
  isWorldTrackingSupported: false,
  isLiDARAvailable: false,
  maxTrackedFaces: 0,
};

let constants: EmojiArConstants = FALLBACK_CONSTANTS;
let FaceFilterNativeView: React.ComponentType<FaceFilterViewProps> | null = null;
let FrontMaskNativeView: React.ComponentType<FrontMaskViewProps> | null = null;
let WallPaintNativeView: React.ComponentType<WallPaintViewProps> | null = null;
let RoomPreviewNativeView: React.ComponentType<RoomPreviewViewProps> | null = null;
let nativeModuleRef: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requireNativeModule, requireNativeViewManager } = require('expo-modules-core');
  const nativeModule = requireNativeModule('EmojiAr');
  nativeModuleRef = nativeModule;
  constants = {
    isFaceTrackingSupported: !!nativeModule.isFaceTrackingSupported,
    isWorldTrackingSupported: !!nativeModule.isWorldTrackingSupported,
    isLiDARAvailable: !!nativeModule.isLiDARAvailable,
    maxTrackedFaces: Number(nativeModule.maxTrackedFaces) || 0,
  };
  FaceFilterNativeView = requireNativeViewManager('EmojiAr', 'FaceFilterView');
  FrontMaskNativeView = requireNativeViewManager('EmojiAr', 'FrontMaskView');
  WallPaintNativeView = requireNativeViewManager('EmojiAr', 'WallPaintView');
  RoomPreviewNativeView = requireNativeViewManager('EmojiAr', 'RoomPreviewView');
  // Startup diagnostic: proves which native build is running (a stale native
  // binary is invisible from JS otherwise — Metro always serves fresh JS).
  try {
    const wallProto = nativeModule.ViewPrototypes?.EmojiAr_WallPaintView;
    const fns = wallProto ? Object.keys(wallProto) : [];
    // Identify WHICH process/device/build this log comes from — Metro serves
    // every connected device, so an unlabelled log can mislead badly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default;
    const idiom = (Platform as { constants?: { interfaceIdiom?: string } }).constants?.interfaceIdiom ?? '?';
    console.log(
      `[EmojiAr] device=${idiom} iOS=${Platform.Version} nativeBuild=${Constants?.nativeBuildVersion ?? '?'} — WallPaintView fns: [${fns.join(', ')}] — seekAnimation ${fns.includes('seekAnimation') ? 'PRESENT ✅' : 'MISSING ❌ (stale native build)'}`
    );
  } catch (diagErr) {
    console.log('[EmojiAr] ViewPrototypes diagnostic failed:', diagErr);
  }
} catch (error) {
  console.warn('[EmojiAr] Native module unavailable — AR features disabled:', error);
}

export { FaceFilterNativeView, FrontMaskNativeView, WallPaintNativeView, RoomPreviewNativeView };
export const EmojiArConstantsValue = constants;
export const isEmojiArAvailable =
  FaceFilterNativeView !== null || FrontMaskNativeView !== null || WallPaintNativeView !== null;

/**
 * Present a local USDZ/USDC head in AR Quick Look (interactive 3D + AR
 * placement). No-ops gracefully when the native module is unavailable.
 */
export async function openARQuickLook(path: string): Promise<void> {
  if (!nativeModuleRef?.openARQuickLook) {
    throw new Error('AR Quick Look is not available on this device.');
  }
  await nativeModuleRef.openARQuickLook(path);
}
