// @ts-nocheck - Legacy code with complex types
/**
 * Framer Workspace: Time-based animation editor
 *
 * Frame-by-frame animation system:
 * - Each frame is self-contained with its own complete strokes
 * - Stroke length slider controls duration (how many frames the stroke appears on)
 * - Length=12 frames @ 12 FPS = stroke lasts 1 second
 * - Stamps are copied to multiple consecutive frames for persistence
 * - Frame-by-frame export works perfectly (each frame has all needed stamps)
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { View, Modal, TouchableOpacity, StyleSheet, Dimensions, StatusBar, TextInput, Alert, Platform, PanResponder, ScrollView, Image, KeyboardAvoidingView, ActivityIndicator, Animated as RNAnimated, useWindowDimensions, Keyboard, InputAccessoryView, InteractionManager, type GestureResponderEvent } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { PinchGestureHandler, PanGestureHandler, State } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import CustomAnimatorSlider from '../animator/CustomAnimatorSlider';
import { Canvas, useCanvasRef, Group, Image as SkiaImage, Paint, BlendMode, Line, vec, Circle, Vertices, Skia, ImageShader } from '@shopify/react-native-skia';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Video, ResizeMode } from 'expo-av';
import ViewShot from 'react-native-view-shot';
import Timeline from './Timeline';
import { getStamp } from '../components/EmojiCanvas';
import BrushEmojiIcon from '../components/BrushEmojiIcon';
import { exportAsGIF, exportAsMOV, exportAsMOVFromPaths, saveFrameToFile, getExportDimensions, shareExport, type FrameData as ExportFrameData } from './FramerExporter';
import { saveProject, createProjectPayload, saveProjectUnified, listProjects, loadProjectUnified } from '../lib/storage';
import { saveAutosave, loadAutosave } from '../lib/autosave';
import { saveFramerChallengeAutosave as persistFramerChallenge, loadFramerChallengeAutosave, clearFramerChallengeAutosave } from '../lib/sprintAutosave';
import { getRandomLogoSet, type LogoSet } from '../lib/logoManifest';
import { getAllVideos, addVideoToStorage, type VideoMetadata } from '../video/videoStorage';
import EmojiPickerModal from '../workspace/EmojiPickerModal';
import { searchRenderableEmojis, renderableEmojiEntries, type EmojiEntry } from '../lib/emojiCatalog';
import { useAppSettings } from '../context/AppSettingsContext';
import { isCustomBrushReference } from '../lib/customBrushRegistry';
import { emitAppEvent } from '../lib/appEvents';
import { DEFAULT_FRAME_COUNT, isValidFrameCount, parseFrameCount } from './frameCount';
import {
  canUploadChallengeEarly,
  getChallengeStrokesRemaining,
} from '../lib/challengeUploadEligibility';
import { recordLifetimeStrokeCommit } from '../lib/lifetimeStats';
import { useLifetimeActivity } from '../lib/useLifetimeActivity';
import {
  clampPlaneLifetime,
  isPlaneVisibleAtFrame,
  normalizePlaneFrame,
  planeFrameDistance,
  planeLastVisibleFrame,
  planeLifetimeWraps,
  planeTimelineLength,
} from './emojiPlaneTimeline';

const FRAMER_STORAGE_KEY = '@emojipaint_framer_project';
const FRAMER_SAVED_SLOTS_KEY = '@emojipaint_framer_saved_slots'; // Key for list of saved frame slots

// Video storage preview settings
const VIDEO_STORAGE_PREVIEW_SIZE = 128;
const VIDEO_STORAGE_PREVIEW_FPS = 24;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IS_IPAD = Platform.OS === 'ios' && Platform.isPad;
const IS_MOBILE = !IS_IPAD;

// Helper function to calculate canvas size based on current dimensions
const getCanvasSize = (windowWidth: number, windowHeight: number): number => {
  const isLandscape = windowWidth > windowHeight;
  const baseSize = Math.min(windowWidth, windowHeight) * 0.85;

  if (IS_IPAD) {
    // iPad: scaled down 20% in landscape to show full canvas, 56% bigger in portrait
    if (isLandscape) {
      return (baseSize - 305) * 0.92; // 92% scale (20% smaller than before) to show full frame
    } else {
      return (baseSize - 305) * 1.56; // 56% bigger in portrait (30% + 20% more)
    }
  }
  return baseSize;
};

// Default zoom: 100% (1.0) for all devices - no initial zoom
const DEFAULT_ZOOM = 1.0;

interface BackgroundStroke {
  emoji: string;
  x: number;
  y: number;
  size: number;
  opacity: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
}


// Emoji Plane Keyframe: Records transform state at a specific frame
interface EmojiPlaneKeyframe {
  frame: number;           // Relative frame number (0-based from birthFrame)
  corners: {               // Corner positions at this frame
    topLeft: { x: number; y: number };
    topMid: { x: number; y: number };
    topRight: { x: number; y: number };
    rightMid: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomMid: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    leftMid: { x: number; y: number };
  };
  opacity: number;         // Opacity at this frame (0-1)
}

// Emoji Plane: 2D transformable quad with 4 corner handles + 8 edge handles
interface EmojiPlane {
  id: string;              // Unique ID
  emoji: string;           // The emoji to display
  imageUri?: string;       // Optional image URI (if using image instead of emoji)
  corners: {               // 4 corner points + 8 edge midpoints in canvas coordinates
    topLeft: { x: number; y: number };
    topMid: { x: number; y: number };
    topRight: { x: number; y: number };
    rightMid: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomMid: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    leftMid: { x: number; y: number };
  };
  birthFrame: number;      // Frame when plane was created
  lifetime: number;        // How many frames it lasts
  zIndex: number;          // Stacking order (higher = on top)
  opacity: number;         // Base opacity (0-1)
  visible?: boolean;       // Visibility toggle (defaults to true)
  keyframes: EmojiPlaneKeyframe[]; // Manually stamped keyframes
  renderLayer?: 'front' | 'behind-strokes' | 'background'; // Special layer positioning
}

export interface FramerWorkspaceHandle {
  getFramerState: () => FramerStateData | null;
  preserveFramesOnComplete: () => void;
}

export interface FramerStateData {
  frames: any[];
  backgroundImage: string | null;
  importedBackgroundStrokes: BackgroundStroke[];
  videoBackground: {
    uri: string;
    startTime: number;
    metadata: any;
    cropScale: number;
    cropOffsetX: number;
    cropOffsetY: number;
  } | null;
  fps: number;
  strokeLength: number;
  loop: boolean;
  cropStart: number;
  cropEnd: number;
  // Emoji planes data
  emojiPlanes?: EmojiPlane[];
  // 🎬 Mini preview video URI from animation save
  miniPreviewVideoUri?: string;
}

interface FramerWorkspaceProps {
  visible: boolean;
  onClose: () => void;
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  brushRotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  isEraser: boolean;
  onOpenEmojiPicker: () => void; // Callback to open emoji picker (fallback, deprecated)
  onBrushEmojiChange?: (emoji: string) => void; // Callback to change brush emoji (new overlay picker)
  // Emoji picker sync callbacks - link Framer picker to main picker state
  onToggleMirrorX?: () => void;
  onToggleMirrorY?: () => void;
  onTurnLeft?: () => void;
  onTurnRight?: () => void;
  onSpacingChange?: (sliderValue: number) => void;
  onSpacingComplete?: (sliderValue: number) => void;
  spacingSliderValue?: number; // Converted slider value (from normalized spacing)
  spacingSliderMin?: number; // Slider minimum value
  spacingSliderMax?: number; // Slider maximum value
  sharedRecentEmojis?: string[]; // Shared recent emojis from main picker
  onRecentEmojisChange?: (emojis: string[]) => void; // Callback to update shared recent emojis
  backgroundStrokes?: BackgroundStroke[]; // Import current canvas strokes as backdrop
  workspaceSnapshotUri?: string | null; // Snapshot image of workspace for background
  autoImportVideo?: { uri: string; duration: number } | null; // Auto-import video from Video Storage
  initialFramerData?: FramerStateData | null; // Restore Framer state from saved project
  onFramerStateRestored?: () => void; // Callback after successful restoration
  // Topic challenge integration
  activeChallenge?: { prompt: any; endsAt: number } | null; // Active topic challenge
  challengeRemainingMs?: number; // Remaining time in challenge
  onChallengeComplete?: (videoUri: string, videoDuration: number) => Promise<void>; // Callback when challenge ends with MOV
  onChallengeCancel?: () => void; // Discard the active challenge/timer (same as the normal workspace's "Cancel Challenge")
}

interface EmojiStamp {
  x: number;
  y: number;
  emoji: string;
  size: number;
  opacity: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  birthFrame: number; // Legacy: Frame where stamp was created (kept for compatibility)
  lifetime: number;    // Legacy: Always 1 - each frame is self-contained (kept for compatibility)
}

/**
 * Frame data: each frame has its own list of emoji stamps
 */
interface FrameData {
  stamps: EmojiStamp[];
}

/**
 * Automated test functions - inlined to avoid Metro resolution issues
 */
const testFramerPainting = () => {
  console.log('=== FRAMER AUTOMATED TEST ===');

  // Test 1: Verify getStamp is available
  console.log('Test 1: getStamp function exists');
  if (typeof getStamp !== 'function') {
    console.error('❌ FAIL: getStamp is not a function');
    return false;
  }
  console.log('✅ PASS: getStamp is a function');

  // Test 2: Verify stamp creation
  console.log('Test 2: Creating stamp for 🎨 size 64');
  const stamp = getStamp('🎨', 64);
  if (!stamp) {
    console.error('❌ FAIL: Could not create stamp');
    return false;
  }
  console.log('✅ PASS: Stamp created successfully');

  // Test 3: Verify stamp has correct properties
  console.log('Test 3: Verify stamp properties');
  if (!stamp.widthPx || !stamp.heightPx || !stamp.image) {
    console.error('❌ FAIL: Stamp missing required properties');
    console.error(`Stamp has: widthPx=${stamp.widthPx}, heightPx=${stamp.heightPx}, image=${!!stamp.image}`);
    return false;
  }
  console.log(`✅ PASS: Stamp has dimensions ${stamp.widthPx}x${stamp.heightPx}px`);

  console.log('=== ALL TESTS PASSED ===');
  return true;
};

const testFramePainting = () => {
  console.log('=== FRAME PAINTING TEST ===');

  // Simulate frame painting logic
  const frameCount = 300;
  const currentFrame = 0;
  const strokeLength = 3;

  // Calculate active frames
  const activeIndices: number[] = [];
  const endFrame = (currentFrame + strokeLength) % frameCount;
  const isWrapping = endFrame < currentFrame;

  for (let i = 0; i < frameCount; i++) {
    if (isWrapping) {
      if ((i >= currentFrame && i < frameCount) || (i < endFrame)) {
        activeIndices.push(i);
      }
    } else {
      if (i >= currentFrame && i < endFrame) {
        activeIndices.push(i);
      }
    }
  }

  console.log(`Current frame: ${currentFrame}`);
  console.log(`Stroke length: ${strokeLength}`);
  console.log(`Active frames: [${activeIndices.join(', ')}]`);
  console.log(`Expected: [0, 1, 2]`);

  if (activeIndices.length !== 3) {
    console.error(`❌ FAIL: Expected 3 active frames, got ${activeIndices.length}`);
    return false;
  }

  if (activeIndices[0] !== 0 || activeIndices[1] !== 1 || activeIndices[2] !== 2) {
    console.error('❌ FAIL: Active frames incorrect');
    return false;
  }

  console.log('✅ PASS: Frame calculation correct');
  console.log('=== FRAME PAINTING TEST PASSED ===');
  return true;
};

// Isolated slider — owns its own display state so FramerWorkspace never re-renders on slider ticks
const FramerSizeSlider = React.memo(({
  value,
  onRefUpdate,
  sliderStyle,
  labelStyle,
  trackStyle,
}: {
  value: number;
  onRefUpdate: (v: number) => void;
  sliderStyle?: object;
  labelStyle?: object;
  trackStyle?: object;
}) => {
  const [display, setDisplay] = useState(value);
  useEffect(() => { setDisplay(value); }, [value]);
  return (
    <View style={sliderStyle}>
      <Text style={labelStyle}>🖌️ {display}</Text>
      <Slider
        style={trackStyle}
        minimumValue={1}
        maximumValue={170}
        step={1}
        value={display}
        onValueChange={(v) => { const r = Math.round(v); setDisplay(r); onRefUpdate(r); }}
        onSlidingComplete={(v) => { onRefUpdate(Math.round(v)); }}
        minimumTrackTintColor="#4ade80"
        maximumTrackTintColor="#444"
        thumbTintColor="#4ade80"
      />
    </View>
  );
});

const FramerLengthSlider = React.memo(({
  value,
  maxValue,
  onRefUpdate,
  onPersist,
  sliderStyle,
  labelStyle,
  trackStyle,
}: {
  value: number;
  maxValue: number;
  onRefUpdate: (v: number) => void;
  onPersist: (v: number) => void;
  sliderStyle?: object;
  labelStyle?: object;
  trackStyle?: object;
}) => {
  const [display, setDisplay] = useState(value);
  useEffect(() => { setDisplay(value); }, [value]);
  return (
    <View style={sliderStyle}>
      <Text style={labelStyle}>📏 {display}f</Text>
      <Slider
        style={trackStyle}
        minimumValue={1}
        maximumValue={maxValue}
        step={1}
        value={display}
        onValueChange={(v) => { const r = Math.round(v); setDisplay(r); onRefUpdate(r); }}
        onSlidingComplete={(v) => { const r = Math.round(v); onRefUpdate(r); onPersist(r); }}
        minimumTrackTintColor="#ff9f6b"
        maximumTrackTintColor="#444"
        thumbTintColor="#ff9f6b"
      />
    </View>
  );
});

const FramerWorkspace = forwardRef((
  {
    visible,
    onClose,
    brushEmoji,
  brushSize,
  brushOpacity,
  brushSpacing,
  brushRotation,
  onToggleMirrorX,
  onToggleMirrorY,
  onTurnLeft,
  onTurnRight,
  onSpacingChange,
  onSpacingComplete,
  spacingSliderValue,
  spacingSliderMin,
  spacingSliderMax,
  sharedRecentEmojis,
  onRecentEmojisChange,
  mirrorX,
  mirrorY,
  isEraser,
  onOpenEmojiPicker,
  onBrushEmojiChange,
  backgroundStrokes = [],
  workspaceSnapshotUri = null,
  autoImportVideo = null,
  initialFramerData = null,
  onFramerStateRestored,
  // Topic challenge props
  activeChallenge = null,
  challengeRemainingMs = 0,
  onChallengeComplete,
  onChallengeCancel
  }: FramerWorkspaceProps,
  ref: React.Ref<FramerWorkspaceHandle>
) => {
  useLifetimeActivity('framer', visible);
  // Navigation for Video Storage button
  const navigation = useNavigation();

  // App settings (hand mode for layout)
  const { settings } = useAppSettings();
  const handMode = settings.handMode;

  // Window dimensions for orientation detection
  const windowDimensions = useWindowDimensions();
  const isLandscape = windowDimensions.width > windowDimensions.height;

  // Animation state — keep the established 90-frame default; user input may
  // safely scale up to the validated maximum in frameCount.ts.
  const [frameCount, setFrameCount] = useState(DEFAULT_FRAME_COUNT);
  const [frameCountDraft, setFrameCountDraft] = useState(String(DEFAULT_FRAME_COUNT));
  const [frameCountEditing, setFrameCountEditing] = useState(false);
  const commitFrameCount = useCallback((raw: string = frameCountDraft) => {
    const next = parseFrameCount(raw, frameCount);
    setFrameCount(next);
    setFrameCountDraft(String(next));
    setFrameCountEditing(false);
    return next;
  }, [frameCountDraft, frameCount]);
  const beginFrameCountEdit = useCallback(() => {
    setFrameCountDraft(String(frameCount));
    setFrameCountEditing(true);
  }, [frameCount]);
  useEffect(() => {
    if (!frameCountEditing) setFrameCountDraft(String(frameCount));
  }, [frameCount, frameCountEditing]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [cropStart, setCropStart] = useState(0);
  const [cropEnd, setCropEnd] = useState(DEFAULT_FRAME_COUNT);
  const [hasExported, setHasExported] = useState(false); // Track if user has exported

  // Frame data stored in REF (mutable like desktop animator canvas contexts)
  const framesRef = useRef<FrameData[]>(
    Array.from({ length: 300 }, () => ({ stamps: [] }))
  );

  // Render trigger - increment to force re-render
  const [, setRenderTrigger] = useState(0);
  const renderScheduled = useRef(false);

  // Schedule render via RAF - batches multiple paint calls (desktop scheduleSimpleRender pattern)
  const scheduleRender = useCallback(() => {
    if (renderScheduled.current) return; // Already scheduled
    renderScheduled.current = true;

    requestAnimationFrame(() => {
      renderScheduled.current = false;
      setRenderTrigger(prev => prev + 1);
    });
  }, []);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false); // Automatic keyframe recording mode
  const [fps, setFps] = useState(30); // Default 30 FPS
  const [loop, setLoop] = useState(true);
  const [onionSkin, setOnionSkin] = useState(false); // Onion skin: show prev/next frame
  const [strokeLength, setStrokeLength] = useState(10); // Default 10 frames
  const [showBackground, setShowBackground] = useState(true); // Show/hide background images
  const [showBrushOptions, setShowBrushOptions] = useState(false); // Show/hide brush options panel
  const brushOptionsTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Auto-hide timer

  // Recording mode refs
  const recPressStartTimeRef = useRef<number>(0); // Track when REC button press starts
  const recLongPressTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Long-press timer
  const recAutoKeyframeIntervalRef = useRef<NodeJS.Timeout | null>(null); // Auto-keyframe timer

  // Transport controls removed - now in bottom panel only

  // Clear button state (trash emoji with smart behavior)
  const [clearState, setClearState] = useState<'idle' | 'warning' | 'showAll'>('idle');
  const clearTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Undo/Redo state - history management
  const [undoStack, setUndoStack] = useState<FrameData[][]>([]);
  const [redoStack, setRedoStack] = useState<FrameData[][]>([]);
  const maxHistorySize = 3; // Keep last 3 strokes only

  // Zoom state for canvas - use module-level DEFAULT_ZOOM constant
  const [zoomScale, setZoomScale] = useState(DEFAULT_ZOOM);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const canvasContainerRef = useRef<View | null>(null);
  const zoomRef = useRef({ scale: DEFAULT_ZOOM, lastScale: DEFAULT_ZOOM, targetScale: DEFAULT_ZOOM });
  const panRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const zoomAnimationRef = useRef<number | null>(null);
  const [zoomModeEnabled, setZoomModeEnabled] = useState(false); // Toggle for zoom mode

  // Settings modal state
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [portfolioPickerVisible, setPortfolioPickerVisible] = useState(false);
  const [portfolioProjects, setPortfolioProjects] = useState<Array<{name: string, preview?: string, miniVideo?: string}>>([]);
  const [loadingPortfolioProjects, setLoadingPortfolioProjects] = useState(false);

  // Fixed logical canvas size - always use portrait size for coordinate system
  const logicalCanvasSize = useMemo(() => {
    if (!windowDimensions?.width || !windowDimensions?.height) {
      // Use portrait size as fixed coordinate space
      return getCanvasSize(SCREEN_HEIGHT, SCREEN_WIDTH); // portrait: height > width
    }
    // Always calculate as if in portrait for consistent coordinate space
    const w = Math.max(windowDimensions.width, windowDimensions.height);
    const h = Math.min(windowDimensions.width, windowDimensions.height);
    return getCanvasSize(h, w); // portrait orientation
  }, [windowDimensions?.width, windowDimensions?.height]);

  // Display canvas size - scaled differently for landscape vs portrait
  const canvasSize = useMemo(() => {
    if (!windowDimensions?.width || !windowDimensions?.height) {
      return getCanvasSize(SCREEN_WIDTH, SCREEN_HEIGHT);
    }
    const isLandscape = windowDimensions.width > windowDimensions.height;
    if (IS_IPAD && isLandscape) {
      // In landscape: scale down to 80% of logical size to show full canvas
      return logicalCanvasSize * 0.80;
    }
    return logicalCanvasSize; // Portrait: use full logical size
  }, [windowDimensions?.width, windowDimensions?.height, logicalCanvasSize]);
  const [exportQuality, setExportQuality] = useState<'low' | 'high' | 'ultra'>('high'); // Export quality for GIF/MOV
  // Export background. 'transparent' keeps the captured PNGs alpha — but a transparent MOV only
  // survives if the device can encode HEVC-with-alpha; MP4ExporterModule silently falls back to
  // H.264 (no alpha) and undefined alpha reads as BLACK. Baking a colour in here sidesteps the
  // codec question entirely and is also the only way to get a predictable GIF, since GIF has just
  // 1-bit transparency. Colour is composited into every captured frame, below all other layers.
  const [exportBgMode, setExportBgMode] = useState<'transparent' | 'color'>('transparent');
  const [exportBgColor, setExportBgColor] = useState('#000000');
  const [backgroundImageUri, setBackgroundImageUri] = useState<string | null>(null);
  const [importedBackgroundStrokes, setImportedBackgroundStrokes] = useState<BackgroundStroke[]>([]);
  const [miniPreviewVideoUri, setMiniPreviewVideoUri] = useState<string | null>(null);

  // Line tool state - for time-based straight line animation
  const [lineToolActive, setLineToolActive] = useState(false);
  const lineStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const linePreviewPointRef = useRef<{ x: number; y: number } | null>(null);

  // Broom/Eraser tool state
  const [broomToolActive, setBroomToolActive] = useState(false);
  const [broomCursorPos, setBroomCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [broomIsClearing, setBroomIsClearing] = useState(false); // true when finger is down and clearing

  // Emoji Plane tool state
  const [emojiPlaneToolActive, setEmojiPlaneToolActive] = useState(false);
  const [emojiPlanes, setEmojiPlanes] = useState<EmojiPlane[]>([]);
  const emojiPlanesRef = useRef<EmojiPlane[]>([]);
  const [selectedPlaneId, setSelectedPlaneId] = useState<string | null>(null);
  const selectedPlaneIdRef = useRef<string | null>(null);
  type CornerType = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';
  const [draggingCorner, setDraggingCorner] = useState<{ planeId: string; corner: CornerType } | null>(null);
  const draggingCornerRef = useRef<{ planeId: string; corner: CornerType; offsetX?: number; offsetY?: number } | null>(null);
  const [draggingPlane, setDraggingPlane] = useState<{ planeId: string; startX: number; startY: number } | null>(null);
  const draggingPlaneRef = useRef<{ planeId: string; startX: number; startY: number } | null>(null);
  const planePinchRef = useRef<{ planeId: string; initialDistance: number; initialCorners: any } | null>(null);
  const nextZIndexRef = useRef(1);
  const [selectedCorner, setSelectedCorner] = useState<CornerType | null>(null); // Selected corner for easier grabbing
  const [planeInfoModalVisible, setPlaneInfoModalVisible] = useState(false); // Plane settings overlay
  const [planeInfoId, setPlaneInfoId] = useState<string | null>(null); // Which plane's info to show
  const [scaleKeyframesWithLength, setScaleKeyframesWithLength] = useState(false); // Toggle for scaling keyframes
  const [keyframeScaleValue, setKeyframeScaleValue] = useState(1.0); // Live keyframe scaling slider value (0.1 to 2.0)
  const [addPlaneMenuVisible, setAddPlaneMenuVisible] = useState(false); // Menu for choosing emoji vs image plane

  // Emoji picker state - overlay picker (no need to close Framer!)
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  // Use shared recent emojis from parent if provided, otherwise use local state
  const [localRecentEmojis, setLocalRecentEmojis] = useState<string[]>([]);
  // Use shared if available, otherwise local. Always ensure we have an array.
  const recentEmojis = sharedRecentEmojis || localRecentEmojis || [];
  const setRecentEmojis = onRecentEmojisChange || setLocalRecentEmojis;

  // Handler for emoji selection in embedded overlay
  const handleEmojiPickerSelect = useCallback((emoji: string) => {
    try {

      // Validate emoji
      if (!emoji || typeof emoji !== 'string' || emoji.length === 0) {
        console.warn('[FRAMER EMOJI PICKER] Invalid emoji:', emoji);
        return;
      }

      // Update local emoji brush
      setLocalEmoji(emoji);

      // Update ref (immediate effect)
      if (framerBrushEmojiRef) {
        framerBrushEmojiRef.current = emoji;
      }

      // Update parent's brush emoji
      if (onBrushEmojiChange && typeof onBrushEmojiChange === 'function') {
        try {
          onBrushEmojiChange(emoji);
        } catch (err) {
          console.warn('[FRAMER EMOJI PICKER] Error updating parent emoji:', err);
        }
      }

      // Update shared recent emojis list
      const updatedRecent = [emoji, ...(Array.isArray(recentEmojis) ? recentEmojis.filter(e => e !== emoji) : [])].slice(0, 20);
      setRecentEmojis(updatedRecent);

      // Sync recent emojis back to PaintScreen via callback
      if (onRecentEmojisChange && typeof onRecentEmojisChange === 'function') {
        try {
          onRecentEmojisChange(updatedRecent);
        } catch (err) {
          console.warn('[FRAMER EMOJI PICKER] Error syncing recent emojis:', err);
        }
      }

      // Save to AsyncStorage
      AsyncStorage.setItem('@framer_recent_emojis', JSON.stringify(updatedRecent)).catch(err =>
        console.error('[FRAMER EMOJI] Failed to save recent emojis:', err)
      );

      // CRITICAL: Only clear frames if NOT in active challenge
      // During challenge, emoji changes should NOT clear frames
      if (!activeChallenge) {
        try {
          framesRef.current = Array.from({ length: frameCount }, () => ({ stamps: [] }));
          setFrameCount(frameCount);
          setCurrentFrame(0);
          setCropStart(0);
          setCropEnd(frameCount);
          setUndoStack([]);
          setRedoStack([]);
          scheduleRender();
        } catch (err) {
          console.error('[FRAMER EMOJI PICKER] Error clearing frames:', err);
        }
      } else {
        scheduleRender(); // Just re-render with new emoji
      }

      // Close the overlay picker
      setEmojiPickerVisible(false);
      setEmojiSearch('');

      // Haptic feedback
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
          // Haptics not available on some simulators
        });
      } catch (hapErr) {
        console.warn('[FRAMER EMOJI PICKER] Haptics error (non-fatal):', hapErr);
      }
    } catch (error) {
      console.error('[FRAMER EMOJI PICKER] Error selecting emoji:', error);
    }
  }, [recentEmojis, setRecentEmojis, frameCount, onBrushEmojiChange, onRecentEmojisChange, setLocalEmoji, setFrameCount, setCurrentFrame, setCropStart, setCropEnd, setUndoStack, setRedoStack, scheduleRender, setEmojiPickerVisible, setEmojiSearch, activeChallenge]);

  // Debug: Log emoji picker visibility changes
  // Removed excessive debug logging that spams console every render

  // Load recent emojis from AsyncStorage on mount (if not provided by parent)
  useEffect(() => {
    if (!sharedRecentEmojis) {
      AsyncStorage.getItem('@framer_recent_emojis')
        .then(data => {
          if (data) {
            try {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed)) {
                setLocalRecentEmojis(parsed);
              }
            } catch (err) {
              console.error('[FRAMER EMOJI] Failed to parse recent emojis:', err);
            }
          }
        })
        .catch(err => console.error('[FRAMER EMOJI] Failed to load recent emojis:', err));
    }
  }, [sharedRecentEmojis]);

  // Handle orientation changes - reset zoom to default for new orientation
  useEffect(() => {

    setZoomScale(DEFAULT_ZOOM);
    zoomRef.current.scale = DEFAULT_ZOOM;
    zoomRef.current.lastScale = DEFAULT_ZOOM;
    zoomRef.current.targetScale = DEFAULT_ZOOM;

    // Reset pan offset when changing zoom
    setCanvasOffset({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0, startX: 0, startY: 0 };
  }, [isLandscape]);

  // Auto-play when returning to Framers (after export/save)
  useEffect(() => {
    if (visible && !isPlaying) {
      // Auto-start playback when workspace becomes visible
      setIsPlaying(true);
    }
  }, [visible]);

  // Emoji search results
  const emojiResults = useMemo(() => {
    if (emojiSearch.trim()) {
      return searchRenderableEmojis(emojiSearch);
    }
    return renderableEmojiEntries;
  }, [emojiSearch]);

  // Video background state - NOW USING VIDEO DIRECTLY INSTEAD OF FRAMES (MEMORY EFFICIENT!)
  const [videoUri, setVideoUri] = useState<string | null>(null); // Direct video URI
  const [videoStartTime, setVideoStartTime] = useState<number>(0); // Trim start time in seconds
  const [videoMetadata, setVideoMetadata] = useState<{ fps: number; duration: number; frameCount: number } | null>(null);
  const videoRef = useRef<any>(null); // Video component ref for seeking
  const [videoReady, setVideoReady] = useState(false); // Track if video is ready for seeking
  const [videoVolume, setVideoVolume] = useState(0.1); // Progressive volume (starts at 0.1, increases each loop)
  const videoLoopCount = useRef(0); // Track number of loops for volume progression

  // Video trimming modal state
  const [videoTrimModalVisible, setVideoTrimModalVisible] = useState(false);
  const [selectedVideoUri, setSelectedVideoUri] = useState<string | null>(null);
  const [selectedVideoDuration, setSelectedVideoDuration] = useState<number>(0);
  const [trimStart, setTrimStart] = useState<number>(0); // In seconds
  const [trimEnd, setTrimEnd] = useState<number>(0); // In seconds

  // Video crop/pan state for trim overlay
  const [videoCropScale, setVideoCropScale] = useState<number>(1.0); // Zoom level
  const [videoCropOffsetX, setVideoCropOffsetX] = useState<number>(0); // Pan X offset
  const [videoCropOffsetY, setVideoCropOffsetY] = useState<number>(0); // Pan Y offset

  // Animated gesture values for trim overlay crop controls
  const cropScale = useSharedValue(1.0);
  const cropTranslateX = useSharedValue(0);
  const cropTranslateY = useSharedValue(0);
  const cropBaseScale = useSharedValue(1.0); // Store base scale for pinch

  // Video storage picker modal state
  const [videoStoragePickerVisible, setVideoStoragePickerVisible] = useState(false);
  const [storageVideos, setStorageVideos] = useState<VideoMetadata[]>([]);
  const [loadingStorageVideos, setLoadingStorageVideos] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false); // Separate state for video import
  const [importingFrameIndex, setImportingFrameIndex] = useState(0); // Track current frame being imported
  const [importingFrameTotal, setImportingFrameTotal] = useState(0); // Total frames to import
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMaxGrowth, setExportMaxGrowth] = useState(1.5); // Random max growth (1.5x to 3.5x) based on frame count, reduced to half intensity
  const exportAbortRef = useRef(false); // Ref for aborting export mid-process
  // Drives a SMOOTH, time-based "fake" export % — the real frame-render loop
  // (captureRef per frame) blocks the JS thread so the true progress can't
  // repaint (looked stuck 1-4% then jumped to ~84%). The timer advances the bar
  // steadily toward ~92%; real completion snaps it to 100%.
  const exportFakeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopFakeExportProgress = useCallback((finalValue?: number) => {
    if (exportFakeTimerRef.current) {
      clearInterval(exportFakeTimerRef.current);
      exportFakeTimerRef.current = null;
    }
    if (typeof finalValue === 'number') setExportProgress(finalValue);
  }, []);
  const startFakeExportProgress = useCallback((estimatedMs: number, kind: string) => {
    if (exportFakeTimerRef.current) clearInterval(exportFakeTimerRef.current);
    const startedAt = Date.now();
    const estMs = Math.max(2500, estimatedMs);
    console.log(`[FRAMER-EXPORT] ${kind}: fake progress started, est ${Math.round(estMs)}ms`);
    exportFakeTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // Ease toward 0.92 and hold there until the real export finishes.
      const p = Math.min(0.92, 1 - Math.exp(-2.3 * (elapsed / estMs)));
      setExportProgress(p);
    }, 60);
  }, []);
  // Safety net: whenever an export ends (success, error OR cancel — all call
  // setIsExporting(false)) make sure the fake-progress timer is stopped.
  useEffect(() => {
    if (!isExporting && exportFakeTimerRef.current) {
      clearInterval(exportFakeTimerRef.current);
      exportFakeTimerRef.current = null;
    }
  }, [isExporting]);

  // Save animation modal loader state (separate from button state)
  const [showSaveAnimationLoaderModal, setShowSaveAnimationLoaderModal] = useState(false);
  const [saveAnimationLoaderMessage, setSaveAnimationLoaderMessage] = useState('Saving animation...');
  const wasPlayingBeforeSaveRef = useRef(false); // Track if animation was playing before save
  const canvasViewRef = useRef<View | null>(null);
  const frameExportViewRef = useRef<ViewShot | null>(null); // ViewShot for capturing frames with backgrounds

  // Video frame thumbnail for export (replaces live Video component during export)
  const [videoFrameThumbnailUri, setVideoFrameThumbnailUri] = useState<string | null>(null);

  // Export preview frames - show random frames during export
  const [exportPreviewFrames, setExportPreviewFrames] = useState<string[]>([]);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [isExportPreviewPlaying, setIsExportPreviewPlaying] = useState(true); // Control preview playback in export dialog

  // Canvas bounds tracking for touch detection (relative to container)
  const canvasBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Lerp scaling for smooth size transitions while drawing
  const previousBrushSizeRef = useRef(brushSize);
  const targetBrushSizeRef = useRef(brushSize);

  // Export format selection modal (in-game, not native)
  const [exportFormatVisible, setExportFormatVisible] = useState(false);
  const [exportDialogFPS, setExportDialogFPS] = useState(fps); // FPS slider for export dialog
  const [cancelTextColor, setCancelTextColor] = useState('#fff'); // Animated cancel text color
  const [cancelTextShadow, setCancelTextShadow] = useState(''); // Animated text shadow for glow

  // Custom success modal state (in-game, not native)
  const [exportSuccessVisible, setExportSuccessVisible] = useState(false);
  const [exportSuccessData, setExportSuccessData] = useState<{
    type: 'gif' | 'mov';
    fileUri: string;
    frameCount: number;
    quality: string;
    fps: number;
    loop: boolean;
    videoMetaId?: number; // ID in video storage for "Video Storage" button
  } | null>(null);

  // Saved frame slots picker modal
  const [savedSlotsPickerVisible, setSavedSlotsPickerVisible] = useState(false);
  const [selectedSavedSlotId, setSelectedSavedSlotId] = useState<string | null>(null);
  const [currentLoadedSlotId, setCurrentLoadedSlotId] = useState<string | null>(null); // Track which project is currently loaded

  // Custom save notification modal (replaces native Alert)
  const [saveNotificationVisible, setSaveNotificationVisible] = useState(false);
  const [saveNotificationMessage, setSaveNotificationMessage] = useState('');
  const [savedSlots, setSavedSlots] = useState<Array<{
    id: string;
    name: string;
    frameCount: number;
    totalStamps: number;
    cropRange: { start: number; end: number };
    savedAt: string;
    previewUri?: string;
    miniPreviewVideoUri?: string; // 🎬 Mini video preview (128x128 MOV for autoplay)
  }>>([]);

  // Export animation: random logo frames
  const [exportLogoSet, setExportLogoSet] = useState<LogoSet | null>(null);
  const [exportLogoFrameIndex, setExportLogoFrameIndex] = useState(0);

  // Topic challenge state
  const [challengeCompletionVisible, setChallengeCompletionVisible] = useState(false);
  const [challengeCompletedVideoUri, setChallengeCompletedVideoUri] = useState<string | null>(null);
  const [challengeCompletedVideoDuration, setChallengeCompletedVideoDuration] = useState(0);
  const [challengeExportStatus, setChallengeExportStatus] = useState<string>('Creating your video...');
  const [challengeUploadStatus, setChallengeUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [showChallengeUploadConfirm, setShowChallengeUploadConfirm] = useState(false); // Confirmation dialog before upload
  const challengeHandledRef = useRef(false); // Prevent double-handling
  const challengePaintStrokeCountRef = useRef(0);
  const [challengePaintStrokeCount, setChallengePaintStrokeCount] = useState(0);
  const challengeEarlyUploadUnlocked = canUploadChallengeEarly(challengePaintStrokeCount);
  const challengeEarlyUploadStrokesRemaining = getChallengeStrokesRemaining(challengePaintStrokeCount);
  const paintedDuringGestureRef = useRef(false);
  const lifetimeGestureIdRef = useRef<string | null>(null);
  /** Set below; called once per gesture from the first painted point. */
  const beginPaintGestureRef = useRef<(() => void) | null>(null);
  const lastActiveChallengeRef = useRef<any>(null); // Track last challenge to detect changes
  const challengeFramesClearedRef = useRef(false); // Track if frames cleared for this challenge session
  const [showChallengeWarningModal, setShowChallengeWarningModal] = useState(false); // Warning before clearing frames
  const challengeWarningShownRef = useRef(false); // Track if warning was already shown for this challenge
  const framerAutosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Debounced autosave during challenge

  // Draggable challenge timer
  const framerTimerX = useSharedValue(0);
  const framerTimerY = useSharedValue(0);
  const framerTimerDragStartX = useRef(0);
  const framerTimerDragStartY = useRef(0);
  const framerTimerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: framerTimerX.value }, { translateY: framerTimerY.value }]
  }));

  // Save animation loading state
  const [isSavingAnimation, setIsSavingAnimation] = useState(false);
  const [saveAnimationStatus, setSaveAnimationStatus] = useState('');

  // CRITICAL: Use refs DIRECTLY for brush settings (no local state!)
  // This ensures immediate updates without state delays
  const framerBrushSizeRef = useRef(brushSize);
  const framerBrushEmojiRef = useRef(brushEmoji);
  const strokeLengthRef = useRef(strokeLength);
  const framerBrushSpacingRef = useRef(brushSpacing);
  const framerBrushRotationRef = useRef(brushRotation);
  const recentEmojisRef = useRef<string[]>([]);

  // Stable callbacks for isolated slider components — update refs without causing parent re-renders
  const handleSizeRefUpdate = useCallback((v: number) => { framerBrushSizeRef.current = v; }, []);
  const handleLengthRefUpdate = useCallback((v: number) => { strokeLengthRef.current = v; }, []);
  const handleLengthPersist = useCallback((v: number) => {
    strokeLengthRef.current = v;
    setStrokeLength(v);
  }, []);

  // Emoji button bounce animation
  const emojiScale = useRef(new RNAnimated.Value(1)).current;
  const [localEmoji, setLocalEmoji] = useState(brushEmoji); // Local state for random emoji
  const [diceClickInProgress, setDiceClickInProgress] = useState(false); // Prevent rapid clicks

  // REC button pulse animation
  const recButtonScale = useRef(new RNAnimated.Value(1)).current;

  // Local brush transform state (independent from parent workspace)
  const [framerMirrorX, setFramerMirrorX] = useState(false);
  const [framerMirrorY, setFramerMirrorY] = useState(false);
  const [framerRotation, setFramerRotation] = useState(0);
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  const autoRotateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Opacity toggle state (0.1 transparent, 1.0 opaque)
  const [framerBrushOpacity, setFramerBrushOpacity] = useState(brushOpacity);
  const framerBrushOpacityRef = useRef(brushOpacity);
  const isFramerOpacityTransparent = framerBrushOpacity <= 0.15; // Consider <= 0.15 as "transparent mode"
  const framerOpacityToggleEmoji = isFramerOpacityTransparent ? '1️⃣' : '💯';

  // Common emoji list for random picker
  const FRAMER_EMOJIS = [
    '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂',
    '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜',
    '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞', '😔',
    '🌟', '✨', '💫', '⭐', '🌈', '🔥', '💧', '💦', '❄️', '⚡',
    '🎨', '🖌️', '✏️', '🖍️', '🖊️', '✒️', '🖋️', '📝', '📄', '📃',
    '🎭', '🎪', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🎸', '🎺',
    '🚀', '🛸', '🌍', '🌎', '🌏', '🌙', '☀️', '⭐', '💫', '✨'
  ];

  // Random emoji picker - Uses ALL renderable emojis from catalog
  const exitPlacerMode = useCallback(() => {
    if (!emojiPlaneToolActive) return;
    setEmojiPlaneToolActive(false);
    setSelectedPlaneId(null);
    setDraggingCorner(null);
    setDraggingPlane(null);
    planePinchRef.current = null;
  }, []);

  // Random emoji picker - Uses ALL renderable emojis from catalog
  const handleRandomEmoji = useCallback(() => {
    // CRITICAL: Prevent rapid clicks causing multiple animations/crashes
    if (diceClickInProgress) {
      return;
    }

    setDiceClickInProgress(true);

    try {
      // Safety check: emoji catalog loaded
      if (!renderableEmojiEntries || renderableEmojiEntries.length === 0) {
        console.warn('[FRAMER EMOJI] 🎲 Emoji catalog not ready');
        setDiceClickInProgress(false);
        return;
      }

      // Exit placer mode if active
      try {
        if (typeof exitPlacerMode === 'function') {
          exitPlacerMode();
        }
      } catch (err) {
        console.warn('[FRAMER EMOJI] Error exiting placer mode:', err);
      }

      const currentEmoji = framerBrushEmojiRef?.current;

      // Extract valid emojis from catalog
      const allEmojis = renderableEmojiEntries
        .map(entry => entry?.emoji)
        .filter((e): e is string => typeof e === 'string' && e.length > 0);

      if (allEmojis.length === 0) {
        console.warn('[FRAMER EMOJI] 🎲 No valid emojis in catalog');
        setDiceClickInProgress(false);
        return;
      }

      // Pick random emoji (different from current if possible)
      let newEmoji = currentEmoji;
      if (allEmojis.length > 1) {
        do {
          newEmoji = allEmojis[Math.floor(Math.random() * allEmojis.length)];
        } while (newEmoji === currentEmoji && allEmojis.length > 1);
      } else {
        newEmoji = allEmojis[0];
      }


      // Update ref (immediate effect)
      if (framerBrushEmojiRef) {
        framerBrushEmojiRef.current = newEmoji;
      }

      // Update local state
      setLocalEmoji(newEmoji);

      // CRITICAL: Call parent callback directly (avoid state update issues)
      if (typeof onBrushEmojiChange === 'function') {
        try {
          onBrushEmojiChange(newEmoji);
        } catch (err) {
          console.warn('[FRAMER EMOJI] Error updating parent emoji:', err);
        }
      }

      // CRITICAL: Update recent emojis directly (avoid async state updates)
      try {
        const filtered = localRecentEmojis.filter(e => e !== newEmoji);
        const updated = [newEmoji, ...filtered].slice(0, 8);

        // Call parent callback synchronously
        if (typeof onRecentEmojisChange === 'function') {
          onRecentEmojisChange(updated);
        } else {
          // Save to AsyncStorage if no callback
          AsyncStorage.setItem('@framer_recent_emojis', JSON.stringify(updated)).catch(err =>
            console.error('[FRAMER EMOJI] Failed to save recent emojis:', err)
          );
        }

        // Update local state
        setLocalRecentEmojis(updated);
      } catch (err) {
        console.error('[FRAMER EMOJI] Error updating recent emojis:', err);
      }

      // Trigger bounce animation (re-enable button immediately for responsiveness)
      try {
        if (emojiScale && typeof emojiScale.setValue === 'function') {
          emojiScale.setValue(0.6);
          RNAnimated.spring(emojiScale, {
            toValue: 1,
            friction: 4,
            tension: 300, // Faster animation (higher tension)
            useNativeDriver: true
          }).start();

          // Re-enable button immediately (don't wait for animation)
          setDiceClickInProgress(false);

          // Safety timeout: ensure button is re-enabled if something goes wrong
          setTimeout(() => {
            setDiceClickInProgress(false);
          }, 500);
        } else {
          setDiceClickInProgress(false);
        }
      } catch (animErr) {
        console.warn('[FRAMER EMOJI] Animation error (non-fatal):', animErr);
        setDiceClickInProgress(false);
      }

      // Haptic feedback (non-blocking)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
        // Haptics not available on some simulators
      });
    } catch (error) {
      console.error('[FRAMER EMOJI] 🎲 Dice button error:', error);
      // CRITICAL: Always reset lock on error to allow retry
      setDiceClickInProgress(false);
    }
  }, [renderableEmojiEntries, emojiScale, localRecentEmojis, onBrushEmojiChange, onRecentEmojisChange]);

  // Emoji picker selection handler
  const handleEmojiSelect = useCallback((emoji: string) => {
    try {
      // CRITICAL: Safely exit placer mode
      if (typeof exitPlacerMode === 'function') {
        exitPlacerMode();
      }

      // Update parent's brush emoji (if callback provided)
      if (typeof onBrushEmojiChange === 'function') {
        onBrushEmojiChange(emoji);
      }

      // Update local state
      framerBrushEmojiRef.current = emoji;
      setLocalEmoji(emoji);

      // Update recent emojis
      setRecentEmojis(prev => {
        const filtered = prev.filter(e => e !== emoji);
        const updated = [emoji, ...filtered].slice(0, 8); // Keep last 8
        // Save to AsyncStorage
        AsyncStorage.setItem('@framer_recent_emojis', JSON.stringify(updated)).catch(err =>
          console.error('[FRAMER EMOJI] Failed to save recent emojis:', err)
        );
        return updated;
      });

      // Trigger bounce animation
      emojiScale.setValue(0.8);
      RNAnimated.spring(emojiScale, {
        toValue: 1,
        friction: 3,
        tension: 200,
        useNativeDriver: true
      }).start();

      // Close picker
      setEmojiPickerVisible(false);
      void Haptics.selectionAsync();
    } catch (error) {
      console.error('[FRAMER EMOJI] Error in handleEmojiSelect:', error);
    }
  }, [emojiScale, setLocalEmoji, setRecentEmojis, setEmojiPickerVisible, exitPlacerMode, onBrushEmojiChange]);

  // Toggle functions for Framer-specific brush transforms
  const handleToggleFramerMirrorX = useCallback(() => {
    void Haptics.selectionAsync();
    setFramerMirrorX(prev => !prev);
  }, [framerMirrorX]);

  const handleToggleFramerMirrorY = useCallback(() => {
    void Haptics.selectionAsync();
    setFramerMirrorY(prev => !prev);
  }, [framerMirrorY]);

  const handleToggleFramerOpacity = useCallback(() => {
    const newOpacity = framerBrushOpacity <= 0.15 ? 1.0 : 0.1;
    setFramerBrushOpacity(newOpacity);
    framerBrushOpacityRef.current = newOpacity;
    void Haptics.selectionAsync();
  }, [framerBrushOpacity]);

  const handleTurnFramerLeft = useCallback(() => {
    void Haptics.selectionAsync();
    setFramerRotation(prev => prev - 45);
  }, [framerRotation]);

  const handleTurnFramerRight = useCallback(() => {
    if (autoRotateEnabled) {
      // If auto-rotate is active, toggle it off
      setAutoRotateEnabled(false);
      void Haptics.selectionAsync();
    } else {
      // Normal rotation
      void Haptics.selectionAsync();
      setFramerRotation(prev => prev + 45);
    }
  }, [framerRotation, autoRotateEnabled]);

  const handleTurnFramerRightLongPress = useCallback(() => {
    // Toggle auto-rotate on long press
    setAutoRotateEnabled(prev => !prev);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [autoRotateEnabled]);

  // Handle setting emoji from recent emojis list
  const handleSetLocalEmoji = useCallback((emoji: string) => {
    try {
      exitPlacerMode();

      // Update parent's brush emoji (if callback provided)
      if (typeof onBrushEmojiChange === 'function') {
        onBrushEmojiChange(emoji);
      }

      // Update local state
      framerBrushEmojiRef.current = emoji;
      setLocalEmoji(emoji);

      // Update recent emojis (move to front) - NO CALLBACK IN STATE UPDATER!
      setRecentEmojis((prev: string[] | undefined) => {
        const safePrev = prev || [];
        const filtered = safePrev.filter(e => e !== emoji);
        const updated = [emoji, ...filtered].slice(0, 8); // Keep last 8

        // IMPORTANT: Don't call callbacks here - they may not be defined in Release build
        // Callbacks will be called in useEffect when recentEmojis state changes
        return updated;
      });

      // Defer animation to next frame to avoid race condition with parent state updates
      // This prevents EXC_BAD_ACCESS when animated view is unmounted during parent re-render
      requestAnimationFrame(() => {
        try {
          // Double-check component is still mounted before animating
          if (emojiScale && typeof emojiScale.setValue === 'function') {
            emojiScale.setValue(0.8);
            RNAnimated.spring(emojiScale, {
              toValue: 1,
              friction: 3,
              tension: 200,
              useNativeDriver: true
            }).start();
          }
        } catch (animError) {
          // Silently catch animation errors (e.g., component unmounted)
        }
      });

      void Haptics.selectionAsync();
    } catch (error) {
      console.error('[FRAMER EMOJI] Error selecting recent emoji:', error);
    }
  }, [emojiScale, setRecentEmojis, exitPlacerMode, onBrushEmojiChange]);

  // Auto-rotate animation loop
  useEffect(() => {
    if (autoRotateEnabled) {
      // Rotate 360° in 6 seconds = 60° per second
      // Update every 100ms = 6° per update
      const interval = setInterval(() => {
        setFramerRotation(prev => (prev + 6) % 360);
      }, 100);

      autoRotateIntervalRef.current = interval;

      return () => {
        clearInterval(interval);
        autoRotateIntervalRef.current = null;
      };
    } else if (autoRotateIntervalRef.current) {
      clearInterval(autoRotateIntervalRef.current);
      autoRotateIntervalRef.current = null;
    }
  }, [autoRotateEnabled]);

  // Load recent emojis on mount
  useEffect(() => {
    AsyncStorage.getItem('@framer_recent_emojis')
      .then(data => {
        if (data) {
          const parsed = JSON.parse(data);
          setRecentEmojis(parsed);
        }
      })
      .catch(err => console.error('[FRAMER EMOJI] Failed to load recent emojis:', err));
  }, []);

  // Sync recent emojis to parent and AsyncStorage when they change
  useEffect(() => {

    if (recentEmojis && recentEmojis.length > 0) {
      // Update ref for quick access
      recentEmojisRef.current = recentEmojis;

      // Notify parent component of changes
      // NOTE: Don't add onRecentEmojisChange to dependency array - it would cause infinite loops
      // since parent callbacks can change on every render, triggering this effect endlessly
      if (typeof onRecentEmojisChange === 'function') {
        // Validate we're passing the array, not a function
        if (Array.isArray(recentEmojis)) {
          onRecentEmojisChange(recentEmojis);
        } else {
          console.error('[FRAMER EMOJI] ❌ ERROR: recentEmojis is not an array!', typeof recentEmojis, recentEmojis);
        }
      } else {
        // Save to AsyncStorage if no parent callback
        AsyncStorage.setItem('@framer_recent_emojis', JSON.stringify(recentEmojis)).catch(err =>
          console.error('[FRAMER EMOJI] Failed to save recent emojis to AsyncStorage:', err)
        );
      }
    }
  }, [recentEmojis]);

  // Rotate export preview frames during actual export every 500ms
  useEffect(() => {
    if (exportPreviewFrames.length > 1 && isExporting) {
      const interval = setInterval(() => {
        setCurrentPreviewIndex(prev => (prev + 1) % exportPreviewFrames.length);
      }, 500);
      return () => clearInterval(interval);
    }
  }, [exportPreviewFrames.length, isExporting]);

  // Rotate export preview frames in dialog based on FPS and play state
  useEffect(() => {
    if (exportPreviewFrames.length > 1 && exportFormatVisible && isExportPreviewPlaying && !isExporting) {
      const frameTimeMs = 1000 / exportDialogFPS; // Time per frame
      const interval = setInterval(() => {
        setCurrentPreviewIndex(prev => (prev + 1) % exportPreviewFrames.length);
      }, frameTimeMs);
      return () => clearInterval(interval);
    }
  }, [exportPreviewFrames.length, exportFormatVisible, exportDialogFPS, isExportPreviewPlaying, isExporting]);

  // Sync refs from props (emoji picker and size changes)
  useEffect(() => {
    const oldEmoji = framerBrushEmojiRef.current;
    framerBrushEmojiRef.current = brushEmoji;
    setLocalEmoji(brushEmoji); // Update local state too

    // Trigger bounce animation when emoji changes from picker
    if (oldEmoji !== brushEmoji) {
      emojiScale.setValue(0.8);
      RNAnimated.spring(emojiScale, {
        toValue: 1,
        friction: 3,
        tension: 200,
        useNativeDriver: true
      }).start();
    }

  }, [brushEmoji, emojiScale]);

  useEffect(() => {
    const oldSize = framerBrushSizeRef.current;
    framerBrushSizeRef.current = brushSize;
  }, [brushSize]);

  // Sync strokeLength ref
  useEffect(() => {
    const oldLength = strokeLengthRef.current;
    strokeLengthRef.current = strokeLength;
  }, [strokeLength]);

  // REC button continuous pulse animation
  useEffect(() => {
    const pulseAnimation = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(recButtonScale, {
          toValue: 1.15,
          duration: 800,
          useNativeDriver: true
        }),
        RNAnimated.timing(recButtonScale, {
          toValue: 1.0,
          duration: 800,
          useNativeDriver: true
        })
      ])
    );
    pulseAnimation.start();

    return () => {
      pulseAnimation.stop();
    };
  }, [recButtonScale]);

  // Expose getFramerState function to parent via ref
  useImperativeHandle(ref, () => ({
    getFramerState: (): FramerStateData | null => {
      try {
        // Export if we have frames (regardless of stamps content)
        // Frames are valid even if empty, they might get filled later
        const hasFrames = framesRef.current && framesRef.current.length > 0;
        if (!hasFrames) {
          return null;
        }

        const state: FramerStateData = {
          frames: framesRef.current,
          backgroundImage: backgroundImageUri,
          importedBackgroundStrokes,
          videoBackground: videoUri ? {
            uri: videoUri,
            startTime: videoStartTime,
            metadata: videoMetadata,
            cropScale: videoCropScale,
            cropOffsetX: videoCropOffsetX,
            cropOffsetY: videoCropOffsetY
          } : null,
          fps,
          strokeLength,
          loop,
          cropStart,
          cropEnd,
          emojiPlanes,
          miniPreviewVideoUri: miniPreviewVideoUri || undefined
        };

        return state;
      } catch (error) {
        console.error('[FRAMER STATE] Failed to export state:', error);
        return null;
      }
    },
    preserveFramesOnComplete: () => {
      preserveFramesRef.current = true;
    },
  }), [backgroundImageUri, importedBackgroundStrokes, videoUri, videoStartTime, videoMetadata, videoCropScale, videoCropOffsetX, videoCropOffsetY, fps, strokeLength, loop, cropStart, cropEnd, miniPreviewVideoUri, emojiPlanes]);

  // Track if restoration has been performed to prevent duplicate restorations
  const hasRestoredRef = useRef(false);

  // AUTO-LOAD: Check for saved project data when Framer opens
  useEffect(() => {
    if (!visible) {
      return; // Only run when Framer becomes visible
    }

    const loadProjectIfSaved = async () => {
      try {
        // Check if there's a flag to load a project
        const loadFlagStr = await AsyncStorage.getItem('@framer_should_load_project');

        if (loadFlagStr === 'true') {

          // Get the project data
          const projectDataStr = await AsyncStorage.getItem('@framer_project_data');

          if (projectDataStr) {
            try {
              const projectData = JSON.parse(projectDataStr);
              const { framerData } = projectData;

              // Restore this data IMMEDIATELY
              if (framerData && framerData.frames) {

                // Restore frames directly
                if (framesRef.current) {
                  framesRef.current = framerData.frames;
                }

                // Restore other project data
                if (framerData.backgroundImage) {
                  setBackgroundImageUri(framerData.backgroundImage);
                }

                if (framerData.videoBackground) {
                  setVideoUri(framerData.videoBackground.uri);
                  if (framerData.videoBackground.startTime !== undefined) {
                    setVideoStartTime(framerData.videoBackground.startTime);
                  }
                }

                if (framerData.fps) {
                  setFps(framerData.fps);
                }

                if (framerData.loop !== undefined) {
                  setLoop(framerData.loop);
                }

                if (framerData.strokeLength !== undefined) {
                  setStrokeLength(framerData.strokeLength);
                }

                if (framerData.cropStart !== undefined) {
                  setCropStart(framerData.cropStart);
                }

                if (framerData.cropEnd !== undefined) {
                  setCropEnd(framerData.cropEnd);
                }

                // Update frame count for UI
                setFrameCount(framerData.frames.length);

                // Force a render update
                scheduleRender();
              }

              // Clear the load flag after reading
              await AsyncStorage.removeItem('@framer_should_load_project');
              await AsyncStorage.removeItem('@framer_project_data');

            } catch (parseError) {
              console.error('[FRAMER OPEN] Failed to parse project data:', parseError);
            }
          } else {
            await AsyncStorage.removeItem('@framer_should_load_project');
          }
        }
      } catch (error) {
        console.error('[FRAMER OPEN] Auto-load error:', error);
      }
    };

    loadProjectIfSaved();
  }, [visible]);

  // Effect: Restore frames from autosave if resuming active challenge
  useEffect(() => {
    if (!activeChallenge || !visible || hasRestoredRef.current) {
      return;
    }

    const isNewChallenge = lastActiveChallengeRef.current?.endsAt !== activeChallenge.endsAt;
    const alreadyWipedThisChallenge = wipedChallengeRef.current === activeChallenge.endsAt;

    // Only restore if this is a RESUMED challenge (not new)
    if (isNewChallenge || !alreadyWipedThisChallenge) {
      return;
    }

    void (async () => {
      try {
        const [savedChallenge, savedState] = await Promise.all([
          loadFramerChallengeAutosave(),
          loadAutosave(),
        ]);
        const matchingChallenge = savedChallenge?.endsAt === activeChallenge.endsAt ? savedChallenge : null;
        const framerState = matchingChallenge ?? savedState?.framerState;
        if (framerState) {

          // Restore frames with validation
          if (framerState.frames && Array.isArray(framerState.frames) && framerState.frames.length > 0) {
            framesRef.current = framerState.frames;
            setFrameCount(framerState.frames.length);

            // Restore related settings
            if (framerState.fps) setFps(framerState.fps);
            if (framerState.loop !== undefined) setLoop(framerState.loop);
            if (typeof framerState.cropStart === 'number') setCropStart(framerState.cropStart);
            if (typeof framerState.cropEnd === 'number') setCropEnd(framerState.cropEnd);

            const restoredStrokeCount = matchingChallenge
              ? Math.max(0, Math.floor(matchingChallenge.strokeCount || 0))
              : 0;
            challengePaintStrokeCountRef.current = restoredStrokeCount;
            setChallengePaintStrokeCount(restoredStrokeCount);

            // Force render with restored frames
            scheduleRender();
            hasRestoredRef.current = true;
          } else {
            console.warn('[FRAMER CHALLENGE RESTORE] ⚠️ No frames in autosave');
          }
        } else {
          console.warn('[FRAMER CHALLENGE RESTORE] ⚠️ No autosave found for challenge');
        }
      } catch (error) {
        console.error('[FRAMER CHALLENGE RESTORE] Error restoring from autosave:', error);
      }
    })();
  }, [activeChallenge, visible]);

  // Restore Framer state from saved project
  useEffect(() => {
    // Skip if no data, not visible, or already restored this session
    if (!initialFramerData || !visible || hasRestoredRef.current) {
      return;
    }

    try {
      // FIX #5: Restore frames with validation - check if empty
      if (initialFramerData.frames && Array.isArray(initialFramerData.frames)) {
        // VALIDATION: Check if frames have actual data (not empty array)
        if (initialFramerData.frames.length === 0) {
          console.warn('[FRAMER RESTORE] ⚠️ Frames array is empty, using default 90 frames');
          framesRef.current = Array.from({ length: 90 }, () => ({ stamps: [] }));
          setFrameCount(90);
        } else {
          // Valid frames with data - load them
          framesRef.current = initialFramerData.frames;
          setFrameCount(initialFramerData.frames.length);
        }
      } else {
        // No frames in restored data - start with default 90
        framesRef.current = Array.from({ length: 90 }, () => ({ stamps: [] }));
        setFrameCount(90);
      }

      // Restore background image
      if (initialFramerData.backgroundImage) {
        setBackgroundImageUri(initialFramerData.backgroundImage);
      }

      // Restore imported background strokes
      if (initialFramerData.importedBackgroundStrokes && Array.isArray(initialFramerData.importedBackgroundStrokes)) {
        setImportedBackgroundStrokes(initialFramerData.importedBackgroundStrokes);
      }

      // Restore video background
      if (initialFramerData.videoBackground) {
        setVideoUri(initialFramerData.videoBackground.uri);
        setVideoStartTime(initialFramerData.videoBackground.startTime || 0);
        setVideoMetadata(initialFramerData.videoBackground.metadata);
        setVideoCropScale(initialFramerData.videoBackground.cropScale || 1.0);
        setVideoCropOffsetX(initialFramerData.videoBackground.cropOffsetX || 0);
        setVideoCropOffsetY(initialFramerData.videoBackground.cropOffsetY || 0);
        setVideoReady(false); // Will be set to true when video loads
      }

      // Restore settings
      if (initialFramerData.fps) {
        setFps(initialFramerData.fps);
      }
      if (initialFramerData.strokeLength) {
        setStrokeLength(initialFramerData.strokeLength);
      }
      if (typeof initialFramerData.loop === 'boolean') {
        setLoop(initialFramerData.loop);
      }
      if (typeof initialFramerData.cropStart === 'number') {
        setCropStart(initialFramerData.cropStart);
      }
      if (typeof initialFramerData.cropEnd === 'number') {
        setCropEnd(initialFramerData.cropEnd);
      }

      // Force render to show restored frames
      scheduleRender();

      // Mark as restored to prevent duplicate restorations
      hasRestoredRef.current = true;

      // Notify parent that restoration is complete
      if (onFramerStateRestored) {
        onFramerStateRestored();
      }

    } catch (error) {
      console.error('[FRAMER RESTORE] Failed to restore Framer state:', error);
    }
  }, [initialFramerData, visible, activeChallenge, scheduleRender, onFramerStateRestored]);

  // Reset restoration flag when Framer closes OR when challenge changes
  useEffect(() => {
    if (!visible) {
      hasRestoredRef.current = false;
    }
  }, [visible]);

  // CRITICAL FIX: Reset restoration flag when challenge changes to prevent old frames persisting
  useEffect(() => {
    if (activeChallenge) {
      hasRestoredRef.current = false;
    }
  }, [activeChallenge?.endsAt]);

  // CLEANUP: Proper cleanup on component unmount to prevent memory leaks
  useEffect(() => {
    return () => {

      // Clear all timers
      if (brushOptionsTimeoutRef.current) {
        clearTimeout(brushOptionsTimeoutRef.current);
        brushOptionsTimeoutRef.current = null;
      }
      if (recLongPressTimeoutRef.current) {
        clearTimeout(recLongPressTimeoutRef.current);
        recLongPressTimeoutRef.current = null;
      }
      if (recAutoKeyframeIntervalRef.current) {
        clearTimeout(recAutoKeyframeIntervalRef.current);
        recAutoKeyframeIntervalRef.current = null;
      }

      // Reset all Refs
      hasRestoredRef.current = false;
      wipedChallengeRef.current = null;
      lastActiveChallengeRef.current = null;
      challengeHandledRef.current = false;
      renderScheduled.current = false;

      // Clear undo/redo stacks to free memory
      setUndoStack([]);
      setRedoStack([]);

    };
  }, []);

  // TOPIC CHALLENGE: Wipe workspace and lock to 90 frames when new challenge starts
  // Track which challenge we've already wiped for to prevent repeated wipes
  const wipedChallengeRef = useRef<number | null>(null);
  const preserveFramesRef = useRef(false);

  useEffect(() => {
    // Reset tracking when challenge ENDS
    if (!activeChallenge) {
      if (preserveFramesRef.current) {
        // Upload just completed — keep frames so user can see their work
        preserveFramesRef.current = false;
        wipedChallengeRef.current = null;
        lastActiveChallengeRef.current = null;
        challengeHandledRef.current = false;
        setShowChallengeWarningModal(false);
        return;
      }
      // CRITICAL: Clear frames when exiting challenge normally
      framesRef.current = Array.from({ length: 90 }, () => ({ stamps: [] }));
      setFrameCount(90);
      setCurrentFrame(0);
      setCropStart(0);
      setCropEnd(90);
      setUndoStack([]);
      setRedoStack([]);
      challengePaintStrokeCountRef.current = 0;
      setChallengePaintStrokeCount(0);
      paintedDuringGestureRef.current = false;

      wipedChallengeRef.current = null;
      lastActiveChallengeRef.current = null;
      challengeHandledRef.current = false;
      setShowChallengeWarningModal(false);
      scheduleRender();
      return;
    }

    // If framers closes but challenge is still active, KEEP FRAMES ALIVE
    // Autosave will restore them on resume
    if (!visible) {
      // Save current state for recovery
      void (async () => {
        try {
          await saveAutosave({
            strokes: [],
            brushEmoji: framerBrushEmojiRef.current || '✏️',
            brushSize: framerBrushSizeRef.current || 40,
            brushOpacity: framerBrushOpacityRef.current || 1.0,
            brushSpacing: framerBrushSpacingRef.current || 1,
            brushRotation: framerBrushRotationRef.current || 0,
            trace: {
              imageUri: null,
              scale: 1,
              offsetX: 0,
              offsetY: 0,
              opacity: 1,
              rotation: 0
            },
            recentEmojis: recentEmojisRef.current || [],
            emojiPlanes: []
          });
        } catch (error) {
          console.error('[FRAMER CHALLENGE] ⚠️ Autosave failed:', error);
        }
      })();
      setShowChallengeWarningModal(false);
      return;
    }

    // Check if this is a NEW challenge that we haven't shown warning for yet
    const isNewChallenge = lastActiveChallengeRef.current?.endsAt !== activeChallenge.endsAt;
    const alreadyWipedThisChallenge = wipedChallengeRef.current === activeChallenge.endsAt;

    // CRITICAL: If resuming same challenge, restore frames from autosave
    if (!isNewChallenge && alreadyWipedThisChallenge) {
      // Restore autosaved frames if available
      void (async () => {
        try {
          const savedState = await loadAutosave();
          if (savedState) {
            // Frames will be restored by the main autosave recovery logic
          } else {
            console.warn('[FRAMER CHALLENGE] ⚠️ No autosaved state found');
          }
        } catch (error) {
          console.error('[FRAMER CHALLENGE] Error restoring autosave:', error);
        }
      })();
      return;
    }

    // Show warning modal ONLY ONCE per challenge (new challenge)
    // Button will handle clearing frames
    if (isNewChallenge && !alreadyWipedThisChallenge) {
      setShowChallengeWarningModal(true);
      lastActiveChallengeRef.current = activeChallenge;
      return;
    }
  }, [activeChallenge, visible]);

  // TOPIC CHALLENGE: Auto-export MOV when timer ends
  useEffect(() => {
    if (!activeChallenge || !visible) {
      return;
    }

    // Don't fire upload confirm while the entry warning modal is still showing —
    // user hasn't even started this challenge yet, so there's nothing to export.
    if (showChallengeWarningModal) {
      return;
    }

    // Also guard: if the challenge hasn't been wiped yet the user hasn't entered
    const alreadyEnteredChallenge = wipedChallengeRef.current === activeChallenge.endsAt;
    if (!alreadyEnteredChallenge) {
      return;
    }

    // Timer reached 0 and we haven't handled completion yet
    if (challengeRemainingMs <= 0 && !challengeHandledRef.current) {
      challengeHandledRef.current = true;

      // Show confirmation dialog - SAME as pin button
      // User can choose to proceed or cancel (no auto-export without confirmation)
      setShowChallengeUploadConfirm(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return; // Dialog will handle the export from here
    }
  }, [challengeRemainingMs, activeChallenge, visible, showChallengeWarningModal]);

  // Pinch gesture handler for zoom (using modern approach)
  const savedScale = useSharedValue(1.0);
  const onPinchGestureEvent = useCallback((event: any) => {
    'worklet';
    const state = event.nativeEvent.state;

    if (state === State.BEGAN) {
      savedScale.value = cropScale.value;
    } else if (state === State.ACTIVE) {
      const newScale = Math.max(1.0, Math.min(3.0, savedScale.value * event.nativeEvent.scale));
      cropScale.value = newScale;
    } else if (state === State.END || state === State.CANCELLED) {
      cropBaseScale.value = cropScale.value;
      // Save to state when gesture ends (run on JS thread)
      const finalScale = cropScale.value;
      runOnJS(setVideoCropScale)(finalScale);
    }
  }, []);

  // Pan gesture handler for offset (using modern approach)
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const onPanGestureEvent = useCallback((event: any) => {
    'worklet';
    const state = event.nativeEvent.state;

    if (state === State.BEGAN) {
      savedTranslateX.value = cropTranslateX.value;
      savedTranslateY.value = cropTranslateY.value;
    } else if (state === State.ACTIVE) {
      const maxOffset = 200; // Max pan distance in pixels
      cropTranslateX.value = Math.max(-maxOffset, Math.min(maxOffset, savedTranslateX.value + event.nativeEvent.translationX));
      cropTranslateY.value = Math.max(-maxOffset, Math.min(maxOffset, savedTranslateY.value + event.nativeEvent.translationY));
    } else if (state === State.END || state === State.CANCELLED) {
      // Save to state when gesture ends (run on JS thread)
      const finalX = cropTranslateX.value;
      const finalY = cropTranslateY.value;
      runOnJS(setVideoCropOffsetX)(finalX);
      runOnJS(setVideoCropOffsetY)(finalY);
    }
  }, []);

  // Animated style for crop preview
  const cropAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: cropTranslateX.value },
        { translateY: cropTranslateY.value },
        { scale: cropScale.value }
      ]
    };
  });

  // Sync animated crop values when trim modal opens or crop state changes
  useEffect(() => {
    if (videoTrimModalVisible) {
      // Reset animated values to match state
      cropScale.value = videoCropScale;
      cropTranslateX.value = videoCropOffsetX;
      cropTranslateY.value = videoCropOffsetY;
      cropBaseScale.value = videoCropScale;
    }
  }, [videoTrimModalVisible, videoCropScale, videoCropOffsetX, videoCropOffsetY]);

  // Reset video ready state when video URI changes
  useEffect(() => {
    setVideoReady(false);
  }, [videoUri]);

  // Smooth video seeking when currentFrame changes - fixes choppy playback
  useEffect(() => {
    if (videoRef.current && videoUri && videoMetadata && showBackground && videoReady) {
      const targetPositionMs = (videoStartTime + (currentFrame / videoMetadata.fps)) * 1000;

      // Use setPositionAsync for smooth seeking with precise tolerances
      videoRef.current.setPositionAsync(targetPositionMs, {
        toleranceMillisBefore: 100,
        toleranceMillisAfter: 100
      }).catch((err: any) => {
        // Silently fail - normal during rapid frame changes
      });
    }
  }, [currentFrame, videoUri, videoMetadata, videoStartTime, showBackground, videoReady]);

  // Reset video volume and loop count when video changes or playback starts
  useEffect(() => {
    if (videoUri) {
      videoLoopCount.current = 0;
      setVideoVolume(0.1);
    }
  }, [videoUri, isPlaying]);

  // Animate Cancel text with random red glow effect
  useEffect(() => {
    if (!exportFormatVisible) {
      // Reset to white when modal closes
      setCancelTextColor('#fff');
      setCancelTextShadow('');
      return;
    }

    const colors = [
      { color: '#fff', shadow: '' }, // White - normal
      { color: '#ffaaaa', shadow: '0 0 2px rgba(255, 0, 0, 0.3)' }, // Light pink
      { color: '#ff6b6b', shadow: '0 0 4px rgba(255, 0, 0, 0.5)' }, // Light red
      { color: '#ef4444', shadow: '0 0 8px rgba(239, 68, 68, 0.8)' }, // Dark red with glow
      { color: '#ff0000', shadow: '0 0 12px rgba(255, 0, 0, 1), 0 0 20px rgba(255, 0, 0, 0.6)' }, // Bright red with strong glow
      { color: '#ef4444', shadow: '0 0 8px rgba(239, 68, 68, 0.8)' }, // Dark red with glow
      { color: '#ff6b6b', shadow: '0 0 4px rgba(255, 0, 0, 0.5)' }, // Light red
      { color: '#ffaaaa', shadow: '0 0 2px rgba(255, 0, 0, 0.3)' } // Light pink
    ];

    let index = 0;

    const interval = setInterval(() => {
      // Random progression - sometimes skip ahead, sometimes go backwards
      const rand = Math.random();
      if (rand > 0.7) {
        index = (index + 2) % colors.length; // Jump forward
      } else if (rand > 0.4) {
        index = (index + 1) % colors.length; // Normal progression
      } else {
        index = (index + colors.length - 1) % colors.length; // Go backwards
      }

      const { color, shadow } = colors[index];
      setCancelTextColor(color);
      setCancelTextShadow(shadow);
    }, 150); // Fast random animation (150ms)

    return () => clearInterval(interval);
  }, [exportFormatVisible]);

  // Load user preferences from AsyncStorage on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const savedFps = await AsyncStorage.getItem('@framer_fps');
        const savedStrokeLength = await AsyncStorage.getItem('@framer_stroke_length');

        if (savedFps) {
          const fpsValue = parseInt(savedFps, 10);
          if (!isNaN(fpsValue) && fpsValue >= 1 && fpsValue <= 60) {
            setFps(fpsValue);
          }
        }

        if (savedStrokeLength) {
          const lengthValue = parseInt(savedStrokeLength, 10);
          if (!isNaN(lengthValue) && lengthValue >= 1) {
            setStrokeLength(lengthValue);
          }
        }
      } catch (error) {
        console.error('[FRAMER] Error loading preferences:', error);
      }
    };

    void loadPreferences();
  }, []);

  // Auto-import video from Video Storage when prop is provided
  useEffect(() => {
    if (!autoImportVideo || !visible) return;

    const importVideo = async () => {
      try {

        const videoDuration = autoImportVideo.duration / 1000; // Convert to seconds

        // Show trimming modal
        setSelectedVideoUri(autoImportVideo.uri);
        setSelectedVideoDuration(videoDuration);
        setTrimStart(0);
        setTrimEnd(videoDuration);
        setVideoTrimModalVisible(true);

      } catch (error) {
        console.error('[FRAMER] Failed to auto-import video:', error);
        CustomOverlayHelper.alert('Error', 'Failed to import video from storage');
      }
    };

    void importVideo();
  }, [autoImportVideo, visible]);

  // Save FPS to AsyncStorage when it changes
  useEffect(() => {
    const saveFps = async () => {
      try {
        await AsyncStorage.setItem('@framer_fps', fps.toString());
      } catch (error) {
        console.error('[FRAMER] Error saving FPS:', error);
      }
    };

    void saveFps();
  }, [fps]);

  // Save stroke length to AsyncStorage when it changes
  useEffect(() => {
    const saveStrokeLength = async () => {
      try {
        await AsyncStorage.setItem('@framer_stroke_length', strokeLength.toString());
      } catch (error) {
        console.error('[FRAMER] Error saving stroke length:', error);
      }
    };

    void saveStrokeLength();
  }, [strokeLength]);

  // Drawing state - using ref for immediate updates in PanResponder
  const isDrawing = useRef(false);
  const lastDrawPoint = useRef<{ x: number; y: number } | null>(null);
  const canvasLayout = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Track current frame in ref for real-time access during playback
  const currentFrameRef = useRef(currentFrame);

  // Playback timing (FPS-based accumulation like emojipaintD)
  const accumMs = useRef(0);
  const lastTimestamp = useRef(0);
  const rafId = useRef<number | null>(null);

  // Canvas ref
  const canvasRef = useCanvasRef();

  // Keep ref in sync with state
  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  // Auto-import background strokes from main workspace when component opens
  useEffect(() => {
    // Only log when actually visible to reduce spam
    if (visible && backgroundStrokes && backgroundStrokes.length > 0) {
      setImportedBackgroundStrokes(backgroundStrokes);
    }
  }, [visible, backgroundStrokes]);

  // Load saved slots when settings modal opens
  useEffect(() => {
    if (settingsVisible) {
      void loadSavedSlots();
    }
  }, [settingsVisible, loadSavedSlots]);

  // Debug: Log when importedBackgroundStrokes changes
  useEffect(() => {
    if (importedBackgroundStrokes.length > 0) {
    }
  }, [importedBackgroundStrokes]);

  // Log when workspace snapshot is received
  useEffect(() => {
    if (workspaceSnapshotUri) {
    }
  }, [workspaceSnapshotUri]);

  // AUTOSAVE: Periodic autosave every 30 seconds
  // FIX #2: Add frequent autosave to prevent work loss
  useEffect(() => {
    if (!visible || isExporting || isPlaying) return; // Don't autosave while exporting/playing

    const autoSaveTimer = setInterval(async () => {
      try {

        // Get current slots
        const slots = await loadSavedSlots();

        if (slots && slots.length > 0) {
          // Overwrite the most recent slot (index 0)
          const success = await overwriteProject(slots[0].id);
          if (success) {
          } else {
            console.warn('[FRAMER AUTOSAVE] ⚠️ Periodic autosave returned false');
          }
        } else {
          // No saved projects yet, create new one
          const success = await autoSaveProject();
          if (success) {
          } else {
            console.warn('[FRAMER AUTOSAVE] ⚠️ Initial autosave returned false');
          }
        }
      } catch (error) {
        console.error('[FRAMER AUTOSAVE] ⚠️ Periodic autosave failed:', error);
        // Don't crash, just log the error
      }
    }, 30000); // Every 30 seconds

    return () => {
      clearInterval(autoSaveTimer);
    };
  }, [visible, isExporting, isPlaying, loadSavedSlots, overwriteProject, autoSaveProject]);

  // AUTOSAVE on Frame Change: Debounced autosave when frame count changes
  // FIX #3: Add autosave when user makes changes
  useEffect(() => {
    if (!visible || isExporting || frameCount === 0 || activeChallenge) return; // Don't autosave during challenge

    const autoSaveOnChange = async () => {
      try {
        const slots = await loadSavedSlots();
        if (slots && slots.length > 0) {
          await overwriteProject(slots[0].id);
        }
      } catch (error) {
        console.error('[FRAMER AUTOSAVE] ⚠️ Failed to autosave on frame change:', error);
      }
    };

    // Debounce 2 seconds - only save if no changes for 2 seconds
    const timer = setTimeout(autoSaveOnChange, 2000);
    return () => clearTimeout(timer);
  }, [frameCount, visible, isExporting, activeChallenge, loadSavedSlots, overwriteProject]);

  // Smooth zoom lerping - animate zoom scale to target
  useEffect(() => {
    const animateZoom = (): void => {
      const target = zoomRef.current.targetScale;
      const diff = target - zoomScale;

      // Lerp factor: 0.2 = smooth but responsive zoom animation
      const lerpFactor = 0.2;

      if (Math.abs(diff) > 0.001) {
        const newScale = zoomScale + diff * lerpFactor;
        setZoomScale(newScale);
        zoomRef.current.lastScale = newScale;
        zoomAnimationRef.current = requestAnimationFrame(animateZoom);
      } else {
        // Snap to target when close enough
        setZoomScale(target);
        zoomRef.current.lastScale = target;
        zoomAnimationRef.current = null;
      }
    };

    // Start animation if target differs from current
    if (Math.abs(zoomRef.current.targetScale - zoomScale) > 0.001) {
      if (zoomAnimationRef.current === null) {
        zoomAnimationRef.current = requestAnimationFrame(animateZoom);
      }
    }

    return () => {
      if (zoomAnimationRef.current !== null) {
        cancelAnimationFrame(zoomAnimationRef.current);
      }
    };
  }, [zoomScale]);

  // RUN AUTOMATED TESTS when component mounts
  useEffect(() => {
    if (visible) {
      console.log('\n\n========================================');
      console.log('🧪 FRAMER WORKSPACE AUTOMATED TESTS');
      console.log('========================================\n');

      const test1Pass = testFramerPainting();
      const test2Pass = testFramePainting();

      if (test1Pass && test2Pass) {
        console.log('\n✅ ALL AUTOMATED TESTS PASSED');
        console.log('Framer workspace is ready for painting!\n');
      } else {
        console.error('\n❌ AUTOMATED TESTS FAILED');
        console.error('Framer workspace may not work correctly\n');
      }
      console.log('========================================\n\n');
    }
  }, [visible]);

  // Force re-render when refs change (for UI display)
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    forceUpdate(prev => prev + 1); // Force UI update to show new emoji/size
  }, [brushEmoji, brushSize]);

  // Debug: Log when stroke length or FPS changes (affects ALL strokes dynamically!)
  useEffect(() => {
    const durationSec = strokeLength / fps;
  }, [strokeLength, fps]);

  // Debug: Log ALL brush settings when visible
  useEffect(() => {
    if (visible) {
    }
  }, [visible, brushEmoji, brushSize, brushOpacity, brushRotation, mirrorX, mirrorY]);

  // Update frames array when frame count changes
  useEffect(() => {
    if (framesRef.current && frameCount !== framesRef.current.length) {
      const newFrames = Array.from({ length: frameCount }, (_, i) =>
        i < framesRef.current.length ? framesRef.current[i] : { stamps: [] }
      );
      framesRef.current = newFrames;

      if (currentFrame >= frameCount) {
        setCurrentFrame(frameCount - 1);
      }
      // Reset crop range to full timeline (animator.ts lines 547-549)
      setCropStart(0);
      setCropEnd(frameCount);
      scheduleRender();
    }
  }, [frameCount, currentFrame, scheduleRender]);

  /**
   * Paint stroke point to MULTIPLE consecutive frames based on strokeLength slider
   *
   * NEW SYSTEM (frame-by-frame export compatible):
   * - Length slider controls how many frames the stroke appears on
   * - Each frame gets its own COPY of the stamp (self-contained)
   * - Length=12 @ 12fps = stroke lasts 1 second
   * - Frame-by-frame export works because each frame has complete strokes
   */
  const paintStrokePoint = useCallback((x: number, y: number) => {
    // PERF: this runs once per INTERPOLATED point — a single fast swipe is
    // dozens of calls. Anything that touches React state or storage belongs at
    // gesture boundaries, not here. Auto-closing the brush panel moved to
    // beginPaintGesture(); the challenge autosave moved to finishPaintGesture().
    if (!paintedDuringGestureRef.current) {
      paintedDuringGestureRef.current = true;
      beginPaintGestureRef.current?.();
    }

    const currentFrame = currentFrameRef.current;
    // IMPORTANT: When paused or fps=0, always use stroke length of 1
    // When playing, use the configured stroke length
    const isPaused = !isPlaying || fps === 0;
    const currentLength = isPaused ? 1 : strokeLengthRef.current;

    // Read refs DIRECTLY at paint time
    const currentEmoji = framerBrushEmojiRef.current;
    const targetSize = framerBrushSizeRef.current;

    // Lerp scaling: Smoothly transition from previous size to target size
    // This allows dynamic size changes while drawing without abrupt jumps
    const lerpFactor = 0.3; // 30% interpolation (adjust for smoother/faster transitions)
    const currentSize = previousBrushSizeRef.current + (targetSize - previousBrushSizeRef.current) * lerpFactor;

    // Update previous size for next stroke point
    previousBrushSizeRef.current = currentSize;


    // Create stamp template
    const stamp: EmojiStamp = {
      x,
      y,
      emoji: currentEmoji,
      size: currentSize * 1.26, // 1.26x (another ~5% smaller than the old 1.33x)
      opacity: framerBrushOpacity, // Use Framer-specific opacity (💯/1️⃣ toggle)
      rotation: framerRotation, // Use Framer-specific rotation
      mirrorX: framerMirrorX,   // Use Framer-specific mirror X
      mirrorY: framerMirrorY,   // Use Framer-specific mirror Y
      birthFrame: currentFrame,
      lifetime: currentLength
    };

    // Copy stamp to MULTIPLE consecutive frames based on strokeLength
    // IMPORTANT: Wrap around the CROP RANGE, not the full frameCount
    for (let i = 0; i < currentLength; i++) {
      let targetFrame = currentFrame + i;

      // If target exceeds cropEnd, wrap to cropStart (respects trim handles)
      if (targetFrame >= cropEnd) {
        const overflow = targetFrame - cropEnd;
        const cropRange = cropEnd - cropStart;
        targetFrame = cropStart + (overflow % cropRange);
      }

      if (framesRef.current[targetFrame]) {
        // Each frame gets its own copy of the stamp
        framesRef.current[targetFrame].stamps.push({ ...stamp });
      }
    }

    // Schedule batched render (rAF-coalesced, so this is one render per frame
    // no matter how many points a single move event carries)
    scheduleRender();
  }, [framerBrushOpacity, framerRotation, framerMirrorX, framerMirrorY, frameCount, cropStart, cropEnd, scheduleRender, isPlaying, fps]);

  /**
   * Interpolate and paint between two points
   * Spacing is based on brush size only (strokeLength controls frame duration, not spacing)
   * IMPORTANT: Use ref for dynamic size changes during drawing!
   */
  const interpolateAndPaint = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);

    const currentBrushSize = framerBrushSizeRef.current;
    const isPaused = !isPlaying || fps === 0;

    // Use the SMALLER of current and previous size for spacing — prevents gaps
    // when brush size increases mid-stroke (larger size = wider spacing = visible gaps)
    const prevSize = previousBrushSizeRef.current;
    const minSize = Math.min(currentBrushSize, prevSize > 0 ? prevSize : currentBrushSize);
    const spacing = isPaused ? 1 : Math.max(1, minSize * 0.25);

    if (distance <= spacing) {
      paintStrokePoint(x2, y2);
      return;
    }

    const steps = Math.ceil(distance / spacing);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t;
      const y = y1 + dy * t;
      paintStrokePoint(x, y);
    }
  }, [paintStrokePoint, isPlaying, fps]);

  /**
   * Debounced autosave of framer frames during an active challenge, so a crash
   * never loses more than one stroke plus the debounce window.
   *
   * PERF: this serialises EVERY frame's stamp list. On a busy animation that is
   * a multi-hundred-millisecond JSON.stringify on the JS thread, and it used to
   * be armed from `paintStrokePoint` — i.e. per interpolated point — so it fired
   * ~3s after you lifted the Pencil, which is exactly when you put it back down
   * for the next stroke. That stall was the "drawing doesn't start / starts
   * late" symptom. It is now armed once per finished gesture, is skipped while a
   * gesture is in flight (rescheduled instead), and runs off the interaction
   * queue so it can never land between a touch-down and the first stamp.
   */
  // Lets the debounced timer re-arm itself without depending on its own identity.
  const saveFramerChallengeAutosaveRef = useRef<(() => void) | null>(null);
  const saveFramerChallengeAutosave = useCallback(() => {
    if (!activeChallenge) return;
    if (framerAutosaveTimeoutRef.current) {
      clearTimeout(framerAutosaveTimeoutRef.current);
    }
    framerAutosaveTimeoutRef.current = setTimeout(() => {
      framerAutosaveTimeoutRef.current = null;
      // A finger/Pencil is still down — writing now would stutter the stroke.
      if (isDrawing.current) {
        saveFramerChallengeAutosaveRef.current?.();
        return;
      }
      InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const frames = framesRef.current;
          // 1. Dedicated framer challenge autosave — survives crashes and battery death
          const startedAt = activeChallenge.endsAt - (Math.max(1, activeChallenge.prompt.timeMinutes ?? 30) * 60 * 1000);
          await persistFramerChallenge({
            prompt: activeChallenge.prompt,
            startedAt,
            endsAt: activeChallenge.endsAt,
            savedAt: new Date().toISOString(),
            frames,
            fps,
            loop,
            cropStart,
            cropEnd,
            strokeCount: challengePaintStrokeCountRef.current,
          });
          // 2. Also write to general autosave so existing restore path still works
          await saveAutosave({
            strokes: [],
            brushEmoji: framerBrushEmojiRef.current || '✏️',
            brushSize: framerBrushSizeRef.current || 40,
            brushOpacity: framerBrushOpacityRef.current || 1.0,
            brushSpacing: framerBrushSpacingRef.current || 1,
            brushRotation: framerBrushRotationRef.current || 0,
            trace: { imageUri: null, scale: 1, offsetX: 0, offsetY: 0, opacity: 1, rotation: 0 },
            recentEmojis: recentEmojisRef.current || [],
            emojiPlanes: [],
            framerState: { frames, fps, loop, cropStart, cropEnd }
          } as any);
        } catch (error) {
          console.error('[FRAMER CHALLENGE] ⚠️ Periodic autosave failed:', error);
        }
      })();
      });
    }, 3000);
  }, [activeChallenge, fps, loop, cropStart, cropEnd]);
  saveFramerChallengeAutosaveRef.current = saveFramerChallengeAutosave;

  /**
   * Paint a straight line with REVERSE TIME-BASED animation
   * Full line appears instantly, then emojis disappear one by one from START to END
   * strokeLength controls how many frames the line takes to fully disappear
   */
  const paintLine = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    if (!paintedDuringGestureRef.current) {
      paintedDuringGestureRef.current = true;
      beginPaintGestureRef.current?.();
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);

    // Use current brush size for spacing
    const currentBrushSize = framerBrushSizeRef.current;
    const spacing = Math.max(1, currentBrushSize * 0.3);

    const currentFrame = currentFrameRef.current;
    const isPaused = !isPlaying || fps === 0;
    const currentLength = isPaused ? 1 : strokeLengthRef.current;


    if (distance <= spacing) {
      // Single point - paint with full lifetime
      const currentEmoji = framerBrushEmojiRef.current;
      const targetSize = framerBrushSizeRef.current;
      const stamp: EmojiStamp = {
        x: x2,
        y: y2,
        emoji: currentEmoji,
        size: targetSize * 1.26,
        opacity: framerBrushOpacity,
        rotation: framerRotation,
        mirrorX: framerMirrorX,
        mirrorY: framerMirrorY,
        birthFrame: currentFrame,
        lifetime: currentLength
      };

      if (framesRef.current[currentFrame]) {
        framesRef.current[currentFrame].stamps.push(stamp);
      }
      scheduleRender();
      return;
    }

    // Calculate all points along the line
    const steps = Math.ceil(distance / spacing);
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t;
      const y = y1 + dy * t;
      points.push({ x, y });
    }

    const currentEmoji = framerBrushEmojiRef.current;
    const targetSize = framerBrushSizeRef.current;

    // Create FULL LINE on current frame
    // Each emoji gets a progressively LONGER lifetime
    // First emoji (start) disappears first (lifetime=1), last emoji (end) disappears last (lifetime=currentLength)
    points.forEach((point, index) => {
      // Calculate lifetime: first point has shortest life (1), last point has longest (currentLength)
      // This creates the effect of the line shrinking from start to end
      const normalizedPosition = index / (points.length - 1); // 0 to 1
      const lifetime = Math.max(1, Math.round(1 + (normalizedPosition * (currentLength - 1))));

      const stamp: EmojiStamp = {
        x: point.x,
        y: point.y,
        emoji: currentEmoji,
        size: targetSize * 1.26,
        opacity: framerBrushOpacity,
        rotation: framerRotation,
        mirrorX: framerMirrorX,
        mirrorY: framerMirrorY,
        birthFrame: currentFrame,
        lifetime: lifetime
      };

      if (framesRef.current[currentFrame]) {
        framesRef.current[currentFrame].stamps.push(stamp);
      }
    });

    scheduleRender();
  }, [isPlaying, fps, framerBrushOpacity, framerRotation, framerMirrorX, framerMirrorY, cropStart, cropEnd, scheduleRender]);

  // Sync emojiPlanes state with ref
  useEffect(() => {
    emojiPlanesRef.current = emojiPlanes;
  }, [emojiPlanes]);

  /**
   * Create a new emoji plane at the center of canvas
   * Size is controlled by brush size slider (max size = full canvas)
   */
  const createEmojiPlane = useCallback(() => {
    const currentFrame = currentFrameRef.current;
    const brushSize = framerBrushSizeRef.current;
    const currentEmoji = framerBrushEmojiRef.current;
    // Planes use the same cyclic lifetime as ordinary Framer strokes: they may start on ANY active
    // frame and continue through cropEnd by wrapping to cropStart. The previous "safe last 2 frames"
    // shift was the hidden reason late planes could never use the full lifetime range.
    const lifetime = clampPlaneLifetime(strokeLengthRef.current, cropStart, cropEnd);
    const birthFrame = normalizePlaneFrame(currentFrame, cropStart, cropEnd);

    // Calculate plane size based on brush size slider
    // brushSize range: 1-300
    // At max (300): plane is full canvas size
    // At min (1): plane is very small (NO MINIMUM - allow 1px distortion)
    const sizeRatio = brushSize / 300; // 0 to 1
    const minSize = 1; // Minimum 1px - allow extreme distortion
    const maxSize = canvasSize * 0.9; // Max 90% of canvas
    const planeSize = (minSize + (maxSize - minSize) * sizeRatio) * 2; // 2x bigger default size

    // Center the plane in canvas
    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;
    const halfSize = planeSize / 2;

    // Create initial corners
    const initialCorners = {
      topLeft: { x: centerX - halfSize, y: centerY - halfSize },
      topMid: { x: centerX, y: centerY - halfSize },
      topRight: { x: centerX + halfSize, y: centerY - halfSize },
      rightMid: { x: centerX + halfSize, y: centerY },
      bottomRight: { x: centerX + halfSize, y: centerY + halfSize },
      bottomMid: { x: centerX, y: centerY + halfSize },
      bottomLeft: { x: centerX - halfSize, y: centerY + halfSize },
      leftMid: { x: centerX - halfSize, y: centerY }
    };

    // AUTO FADE-IN: Create automatic fade-in keyframes for timelapse effect
    // Makes emojis appear gradually like brush strokes instead of popping in instantly
    const fadeInDuration = Math.min(8, Math.floor(lifetime / 3)); // Fade in over 8 frames or 1/3 of lifetime (whichever is less)
    const autoKeyframes: EmojiPlaneKeyframe[] = [];

    // Create fade-in keyframes: start at 0 opacity, fade to full over fadeInDuration frames
    for (let i = 0; i <= fadeInDuration; i++) {
      const relativeFrame = i;
      const progress = fadeInDuration === 0 ? 1 : i / fadeInDuration; // 0 to 1
      autoKeyframes.push({
        frame: relativeFrame,
        corners: { ...initialCorners },
        opacity: progress // Fade from 0 to 1
      });
    }

    const newPlane: EmojiPlane = {
      id: `plane-${Date.now()}-${Math.random()}`,
      emoji: currentEmoji,
      corners: initialCorners,
      birthFrame: birthFrame,
      lifetime: lifetime,
      zIndex: nextZIndexRef.current++,
      opacity: 1.0,
      keyframes: autoKeyframes, // Start with auto fade-in keyframes for timelapse effect
      renderLayer: 'front' // Default: above strokes
    };

    setEmojiPlanes(prev => {
      const newPlanes = [...prev, newPlane];

      // Auto-pause playback when first plane is added
      if (prev.length === 0 && isPlaying) {
        setIsPlaying(false);
      }

      return newPlanes;
    });
    setSelectedPlaneId(newPlane.id);

    // Save to undo stack
    saveToUndoStack();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [canvasSize, isPlaying, fps, saveToUndoStack, frameCount, currentFrame, cropStart, cropEnd]);


  /**
   * Check if a quad is self-intersecting using line segment intersection test
   * Returns true if the quad crosses itself (invalid)
   */
  const isQuadSelfIntersecting = useCallback((corners: EmojiPlane['corners']): boolean => {
    const { topLeft, topRight, bottomRight, bottomLeft } = corners;

    // Helper: Check if two line segments intersect
    const segmentsIntersect = (
      p1: {x: number, y: number}, p2: {x: number, y: number},
      p3: {x: number, y: number}, p4: {x: number, y: number}
    ): boolean => {
      const det = (p2.x - p1.x) * (p4.y - p3.y) - (p4.x - p3.x) * (p2.y - p1.y);
      if (Math.abs(det) < 1e-10) return false; // Parallel

      const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p4.x - p3.x) * (p3.y - p1.y)) / det;
      const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y)) / det;

      return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    };

    // Check if opposite edges intersect (top-bottom vs left-right diagonals)
    // Check top-left to bottom-right diagonal against top-right to bottom-left diagonal
    const diag1Intersects = segmentsIntersect(topLeft, bottomRight, topRight, bottomLeft);

    // Check if any adjacent edges would cause the quad to fold on itself
    // Top edge vs bottom edge
    const topBottomIntersect = segmentsIntersect(topLeft, topRight, bottomLeft, bottomRight);
    // Left edge vs right edge
    const leftRightIntersect = segmentsIntersect(topLeft, bottomLeft, topRight, bottomRight);

    return diag1Intersects || topBottomIntersect || leftRightIntersect;
  }, []);

  /**
   * Ensure consistent corner ordering (clockwise from top-left)
   * Prevents sudden orientation flips by checking winding order
   */
  const ensureConsistentWindingOrder = useCallback((corners: EmojiPlane['corners']): EmojiPlane['corners'] => {
    const { topLeft, topRight, bottomRight, bottomLeft } = corners;

    // Calculate signed area using shoelace formula
    // Positive = counter-clockwise, Negative = clockwise
    const signedArea =
      (topRight.x - topLeft.x) * (topRight.y + topLeft.y) +
      (bottomRight.x - topRight.x) * (bottomRight.y + topRight.y) +
      (bottomLeft.x - bottomRight.x) * (bottomLeft.y + bottomRight.y) +
      (topLeft.x - bottomLeft.x) * (topLeft.y + bottomLeft.y);

    // If clockwise (negative area), maintain current order
    // If counter-clockwise (positive area), we may want to flip, but for now just warn
    if (signedArea > 0) {
      console.warn('[FRAMER PLANE] Warning: Counter-clockwise winding detected');
    }

    // Return corners as-is - Skia Vertices handles orientation automatically
    return corners;
  }, []);

  /**
   * Generate a perspective-correct mesh grid for warping
   * Uses bilinear interpolation with proper perspective division
   * @param corners - The 4 corner positions of the quad
   * @param gridSize - Number of divisions (e.g., 9 = 9x9 grid = 10x10 vertices)
   * @param textureSize - Size of the source texture for UV mapping
   * @returns Arrays of vertices, texture coords, and indices for triangles
   */
  /**
   * Solve homography matrix H (3x3) that maps source quad to destination corners
   * Uses Direct Linear Transform (DLT) algorithm
   * Source quad is unit square: (0,0), (1,0), (1,1), (0,1)
   * Destination is the 4 corner positions
   */
  const solveHomography = useCallback((corners: EmojiPlane['corners']): number[][] => {
    const { topLeft, topRight, bottomRight, bottomLeft } = corners;

    // Source points (unit square in normalized coordinates)
    const src = [
      { x: 0, y: 0 }, // top-left
      { x: 1, y: 0 }, // top-right
      { x: 1, y: 1 }, // bottom-right
      { x: 0, y: 1 }  // bottom-left
    ];

    // Destination points (actual corner positions)
    const dst = [topLeft, topRight, bottomRight, bottomLeft];

    // Build 8x8 matrix for DLT (2 equations per point correspondence)
    const A: number[][] = [];

    for (let i = 0; i < 4; i++) {
      const { x: sx, y: sy } = src[i];
      const { x: dx, y: dy } = dst[i];

      // First equation (x-coordinate)
      A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
      // Second equation (y-coordinate)
      A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    }

    // Build right-hand side vector
    const b = [
      dst[0].x, dst[0].y,
      dst[1].x, dst[1].y,
      dst[2].x, dst[2].y,
      dst[3].x, dst[3].y
    ];

    // Solve Ah = b using Gaussian elimination
    const h = gaussianElimination(A, b);

    // Construct 3x3 homography matrix
    const H = [
      [h[0], h[1], h[2]],
      [h[3], h[4], h[5]],
      [h[6], h[7], 1.0]
    ];

    return H;
  }, []);

  /**
   * Gaussian elimination to solve linear system Ax = b
   */
  const gaussianElimination = (A: number[][], b: number[]): number[] => {
    const n = A.length;
    const augmented = A.map((row, i) => [...row, b[i]]);

    // Forward elimination
    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
          maxRow = k;
        }
      }

      // Swap rows
      [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

      // Make all rows below this one 0 in current column
      for (let k = i + 1; k < n; k++) {
        const factor = augmented[k][i] / augmented[i][i];
        for (let j = i; j <= n; j++) {
          augmented[k][j] -= factor * augmented[i][j];
        }
      }
    }

    // Back substitution
    const x: number[] = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = augmented[i][n];
      for (let j = i + 1; j < n; j++) {
        x[i] -= augmented[i][j] * x[j];
      }
      x[i] /= augmented[i][i];
    }

    return x;
  };

  /**
   * Apply homography transform to a point (u, v) in normalized coordinates
   * Returns (x, y) in canvas coordinates
   */
  const applyHomography = (H: number[][], u: number, v: number): { x: number; y: number } => {
    const w = H[2][0] * u + H[2][1] * v + H[2][2];
    const x = (H[0][0] * u + H[0][1] * v + H[0][2]) / w;
    const y = (H[1][0] * u + H[1][1] * v + H[1][2]) / w;
    return { x, y };
  };

  /**
   * Generate perspective-correct mesh using homography transform
   * Uses subdivided grid (20x20) for smooth distortion
   */
  const generatePerspectiveMesh = useCallback((
    corners: EmojiPlane['corners'],
    gridSize: number = 20, // Increased from 9 to 20 for smoother distortion
    textureSize: { width: number; height: number },
    isCustomEmoji: boolean = false // Custom emojis need less aggressive padding
  ): {
    vertices: any[];
    textures: any[];
    indices: number[];
  } => {
    const divisions = gridSize;
    const vertices: any[] = [];
    const textures: any[] = [];
    const indices: number[] = [];

    // Solve homography matrix for perspective-correct transform
    const H = solveHomography(corners);

    // Crop texture coordinates to remove transparent padding
    // Regular emoji stamps have 40% padding, so we crop to 0.25
    // Custom emoji PNGs have minimal padding, so we use minimal cropping (0.05)
    // This ensures custom emojis show fully without cropping
    const texturePadding = isCustomEmoji ? 0.05 : 0.25;
    const textureStart = textureSize.width * texturePadding;
    const textureEnd = textureSize.width * (1 - texturePadding);
    const textureStartY = textureSize.height * texturePadding;
    const textureEndY = textureSize.height * (1 - texturePadding);

    // Generate vertices using homography transform (PERSPECTIVE-CORRECT!)
    for (let row = 0; row <= divisions; row++) {
      const v = row / divisions; // Vertical parameter [0, 1]
      for (let col = 0; col <= divisions; col++) {
        const u = col / divisions; // Horizontal parameter [0, 1]

        // Apply homography to get canvas position (perspective-correct!)
        const position = applyHomography(H, u, v);

        vertices.push(vec(position.x, position.y));

        // Texture coordinates remain linear (u, v) - the perspective correction
        // is applied to the VERTEX positions, not the texture coordinates
        const texU = textureStart + (textureEnd - textureStart) * u;
        const texV = textureStartY + (textureEndY - textureStartY) * v;
        textures.push(vec(texU, texV));
      }
    }

    // Generate triangle indices (two triangles per grid cell)
    for (let row = 0; row < divisions; row++) {
      for (let col = 0; col < divisions; col++) {
        const topLeftIdx = row * (divisions + 1) + col;
        const topRightIdx = topLeftIdx + 1;
        const bottomLeftIdx = (row + 1) * (divisions + 1) + col;
        const bottomRightIdx = bottomLeftIdx + 1;

        // First triangle (top-left, top-right, bottom-left)
        indices.push(topLeftIdx, topRightIdx, bottomLeftIdx);
        // Second triangle (top-right, bottom-right, bottom-left)
        indices.push(topRightIdx, bottomRightIdx, bottomLeftIdx);
      }
    }

    return { vertices, textures, indices };
  }, [solveHomography]);

  /**
   * Recalculate edge midpoints based on corner positions
   * This ensures edge midpoints stay at the midpoint between corners
   */
  const recalculateEdgeMidpoints = useCallback((corners: EmojiPlane['corners']): EmojiPlane['corners'] => {
    return {
      ...corners,
      topMid: {
        x: (corners.topLeft.x + corners.topRight.x) / 2,
        y: (corners.topLeft.y + corners.topRight.y) / 2
      },
      rightMid: {
        x: (corners.topRight.x + corners.bottomRight.x) / 2,
        y: (corners.topRight.y + corners.bottomRight.y) / 2
      },
      bottomMid: {
        x: (corners.bottomLeft.x + corners.bottomRight.x) / 2,
        y: (corners.bottomLeft.y + corners.bottomRight.y) / 2
      },
      leftMid: {
        x: (corners.topLeft.x + corners.bottomLeft.x) / 2,
        y: (corners.topLeft.y + corners.bottomLeft.y) / 2
      }
    };
  }, []);

  /**
   * Update a corner/edge point position of a plane
   * For corner handles: update corner and recalculate adjacent edge midpoints
   * For edge handles: move along the edge line (constrained)
   * NOTE: Does NOT auto-create keyframes - only creates keyframes when REC button is pressed
   */
  const updatePlaneCorner = useCallback((planeId: string, corner: CornerType, x: number, y: number) => {

    setEmojiPlanes(prev => prev.map(plane => {
      if (plane.id === planeId) {
        const oldCorner = plane.corners[corner];

        const newCorners = { ...plane.corners };

        // Check if this is a corner handle (not edge midpoint)
        const isCorner = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].includes(corner);

        if (isCorner) {
          // DISABLED: Self-intersection check was too restrictive and prevented valid outward corner movements
          // Create test corners with the new position
          // const testCorners = { ...plane.corners };
          // testCorners[corner] = { x, y };

          // Check for self-intersection - prevent invalid transforms
          // if (isQuadSelfIntersecting(testCorners)) {
          //   console.warn(`[FRAMER PLANE] Prevented self-intersecting transform on ${corner}`);
          //   // Return plane unchanged - reject this corner movement
          //   return plane;
          // }

          // Update the corner - allow free movement
          newCorners[corner] = { x, y };

          // Ensure consistent winding order
          const orderedCorners = ensureConsistentWindingOrder(newCorners);

          // Recalculate ALL edge midpoints based on new corner positions
          return {
            ...plane,
            corners: recalculateEdgeMidpoints(orderedCorners)
          };
        } else {
          // This is an edge midpoint - just update it directly
          newCorners[corner] = { x, y };
          return {
            ...plane,
            corners: newCorners
          };
        }
      }
      return plane;
    }));

    emojiPlanesRef.current = emojiPlanesRef.current.map(plane => {
      if (plane.id === planeId) {
        const newCorners = { ...plane.corners };
        const isCorner = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].includes(corner);

        if (isCorner) {
          // DISABLED: Self-intersection check was too restrictive
          // Create test corners with the new position
          // const testCorners = { ...plane.corners };
          // testCorners[corner] = { x, y };

          // Check for self-intersection - prevent invalid transforms
          // if (isQuadSelfIntersecting(testCorners)) {
          //   // Return plane unchanged - reject this corner movement
          //   return plane;
          // }

          // Update the corner - allow free movement
          newCorners[corner] = { x, y };

          // Ensure consistent winding order
          const orderedCorners = ensureConsistentWindingOrder(newCorners);

          // Recalculate ALL edge midpoints based on new corner positions
          return {
            ...plane,
            corners: recalculateEdgeMidpoints(orderedCorners)
          };
        } else {
          newCorners[corner] = { x, y };
          return {
            ...plane,
            corners: newCorners
          };
        }
      }
      return plane;
    });
  }, [recalculateEdgeMidpoints, ensureConsistentWindingOrder]);

  /**
   * Move entire plane by delta
   */
  const movePlane = useCallback((planeId: string, deltaX: number, deltaY: number) => {
    setEmojiPlanes(prev => prev.map(plane => {
      if (plane.id === planeId) {
        const newCorners = { ...plane.corners };
        // Move all 8 points
        Object.keys(newCorners).forEach(key => {
          const cornerKey = key as CornerType;
          newCorners[cornerKey] = {
            x: newCorners[cornerKey].x + deltaX,
            y: newCorners[cornerKey].y + deltaY
          };
        });
        return { ...plane, corners: newCorners };
      }
      return plane;
    }));
    emojiPlanesRef.current = emojiPlanesRef.current.map(plane => {
      if (plane.id === planeId) {
        const newCorners = { ...plane.corners };
        Object.keys(newCorners).forEach(key => {
          const cornerKey = key as CornerType;
          newCorners[cornerKey] = {
            x: newCorners[cornerKey].x + deltaX,
            y: newCorners[cornerKey].y + deltaY
          };
        });
        return { ...plane, corners: newCorners };
      }
      return plane;
    });
  }, []);

  /**
   * Update the lifetime (duration) of a plane
   * Keeps birthFrame fixed, only adjusts endFrame
   * Covers 1...the complete active crop range and wraps at cropEnd.
   */
  const updatePlaneLifetime = useCallback((planeId: string, newLifetime: number) => {
    setEmojiPlanes(prev => prev.map(plane => {
      if (plane.id === planeId) {
        const clampedLifetime = clampPlaneLifetime(newLifetime, cropStart, cropEnd);

        return {
          ...plane,
          lifetime: clampedLifetime
        };
      }
      return plane;
    }));

    emojiPlanesRef.current = emojiPlanesRef.current.map(plane => {
      if (plane.id === planeId) {
        const clampedLifetime = clampPlaneLifetime(newLifetime, cropStart, cropEnd);

        return {
          ...plane,
          lifetime: clampedLifetime
        };
      }
      return plane;
    });

    saveToUndoStack();
    scheduleRender();
  }, [cropStart, cropEnd, saveToUndoStack, scheduleRender]);

  /**
   * Update the birth frame (start position) of a plane
   * Adjusts lifetime to maintain endFrame position
   */
  const updatePlaneBirthFrame = useCallback((planeId: string, newBirthFrame: number) => {
    setEmojiPlanes(prev => prev.map(plane => {
      if (plane.id === planeId) {
        const clampedBirthFrame = Math.max(cropStart, Math.min(cropEnd - 1, Math.round(newBirthFrame)));
        // Maintain the same cyclic end point. A zero distance represents the full active range.
        const fullLength = planeTimelineLength(cropStart, cropEnd);
        const oldEndExclusive = normalizePlaneFrame(plane.birthFrame + plane.lifetime, cropStart, cropEnd);
        const distance = planeFrameDistance(clampedBirthFrame, oldEndExclusive, cropStart, cropEnd);
        const newLifetime = clampPlaneLifetime(plane.lifetime, cropStart, cropEnd) === fullLength
          ? fullLength
          : (distance === 0 ? fullLength : distance);

        return {
          ...plane,
          birthFrame: clampedBirthFrame,
          lifetime: newLifetime
        };
      }
      return plane;
    }));

    emojiPlanesRef.current = emojiPlanesRef.current.map(plane => {
      if (plane.id === planeId) {
        const clampedBirthFrame = Math.max(cropStart, Math.min(cropEnd - 1, Math.round(newBirthFrame)));
        const fullLength = planeTimelineLength(cropStart, cropEnd);
        const oldEndExclusive = normalizePlaneFrame(plane.birthFrame + plane.lifetime, cropStart, cropEnd);
        const distance = planeFrameDistance(clampedBirthFrame, oldEndExclusive, cropStart, cropEnd);
        const newLifetime = clampPlaneLifetime(plane.lifetime, cropStart, cropEnd) === fullLength
          ? fullLength
          : (distance === 0 ? fullLength : distance);

        return {
          ...plane,
          birthFrame: clampedBirthFrame,
          lifetime: newLifetime
        };
      }
      return plane;
    });

    saveToUndoStack();
    scheduleRender();
  }, [cropStart, cropEnd, saveToUndoStack, scheduleRender]);

  /**
   * Update the opacity of a plane
   */
  const updatePlaneOpacity = useCallback((planeId: string, newOpacity: number) => {
    setEmojiPlanes(prev => prev.map(plane => {
      if (plane.id === planeId) {
        return {
          ...plane,
          opacity: Math.max(0, Math.min(1, newOpacity)) // Clamp between 0 and 1
        };
      }
      return plane;
    }));
    emojiPlanesRef.current = emojiPlanesRef.current.map(plane => {
      if (plane.id === planeId) {
        return {
          ...plane,
          opacity: Math.max(0, Math.min(1, newOpacity))
        };
      }
      return plane;
    });

    scheduleRender();
  }, [scheduleRender]);

  /**
   * Toggle plane visibility on/off
   */
  const togglePlaneVisibility = useCallback((planeId: string) => {
    setEmojiPlanes(prev => prev.map(plane => {
      if (plane.id === planeId) {
        return {
          ...plane,
          visible: !plane.visible // Toggle visibility (defaults to true if not set)
        };
      }
      return plane;
    }));
    emojiPlanesRef.current = emojiPlanesRef.current.map(plane => {
      if (plane.id === planeId) {
        return {
          ...plane,
          visible: !plane.visible
        };
      }
      return plane;
    });

    scheduleRender();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [scheduleRender]);

  /**
   * Scale a plane from its center (for pinch gestures)
   */
  const scalePlane = useCallback((planeId: string, scaleFactor: number) => {
    setEmojiPlanes(prev => prev.map(plane => {
      if (plane.id === planeId) {
        const corners = plane.corners;
        // Calculate center point
        const centerX = (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4;
        const centerY = (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4;

        // Scale all corners from center
        const scaledCorners = {
          topLeft: {
            x: centerX + (corners.topLeft.x - centerX) * scaleFactor,
            y: centerY + (corners.topLeft.y - centerY) * scaleFactor
          },
          topMid: {
            x: centerX + (corners.topMid.x - centerX) * scaleFactor,
            y: centerY + (corners.topMid.y - centerY) * scaleFactor
          },
          topRight: {
            x: centerX + (corners.topRight.x - centerX) * scaleFactor,
            y: centerY + (corners.topRight.y - centerY) * scaleFactor
          },
          rightMid: {
            x: centerX + (corners.rightMid.x - centerX) * scaleFactor,
            y: centerY + (corners.rightMid.y - centerY) * scaleFactor
          },
          bottomRight: {
            x: centerX + (corners.bottomRight.x - centerX) * scaleFactor,
            y: centerY + (corners.bottomRight.y - centerY) * scaleFactor
          },
          bottomMid: {
            x: centerX + (corners.bottomMid.x - centerX) * scaleFactor,
            y: centerY + (corners.bottomMid.y - centerY) * scaleFactor
          },
          bottomLeft: {
            x: centerX + (corners.bottomLeft.x - centerX) * scaleFactor,
            y: centerY + (corners.bottomLeft.y - centerY) * scaleFactor
          },
          leftMid: {
            x: centerX + (corners.leftMid.x - centerX) * scaleFactor,
            y: centerY + (corners.leftMid.y - centerY) * scaleFactor
          }
        };

        return { ...plane, corners: scaledCorners };
      }
      return plane;
    }));
    emojiPlanesRef.current = emojiPlanesRef.current.map(plane => {
      if (plane.id === planeId) {
        const corners = plane.corners;
        const centerX = (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4;
        const centerY = (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4;

        const scaledCorners = {
          topLeft: {
            x: centerX + (corners.topLeft.x - centerX) * scaleFactor,
            y: centerY + (corners.topLeft.y - centerY) * scaleFactor
          },
          topMid: {
            x: centerX + (corners.topMid.x - centerX) * scaleFactor,
            y: centerY + (corners.topMid.y - centerY) * scaleFactor
          },
          topRight: {
            x: centerX + (corners.topRight.x - centerX) * scaleFactor,
            y: centerY + (corners.topRight.y - centerY) * scaleFactor
          },
          rightMid: {
            x: centerX + (corners.rightMid.x - centerX) * scaleFactor,
            y: centerY + (corners.rightMid.y - centerY) * scaleFactor
          },
          bottomRight: {
            x: centerX + (corners.bottomRight.x - centerX) * scaleFactor,
            y: centerY + (corners.bottomRight.y - centerY) * scaleFactor
          },
          bottomMid: {
            x: centerX + (corners.bottomMid.x - centerX) * scaleFactor,
            y: centerY + (corners.bottomMid.y - centerY) * scaleFactor
          },
          bottomLeft: {
            x: centerX + (corners.bottomLeft.x - centerX) * scaleFactor,
            y: centerY + (corners.bottomLeft.y - centerY) * scaleFactor
          },
          leftMid: {
            x: centerX + (corners.leftMid.x - centerX) * scaleFactor,
            y: centerY + (corners.leftMid.y - centerY) * scaleFactor
          }
        };

        return { ...plane, corners: scaledCorners };
      }
      return plane;
    });
    scheduleRender();
  }, [scheduleRender]);

  /**
   * Manually stamp a keyframe for the selected plane at current frame
   * This replaces the old auto-recording system - now user manually stamps keyframes with REC button
   */
  const stampKeyframe = useCallback((planeId: string) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId);
    if (!plane) return;

    if (!isPlaneVisibleAtFrame(plane.birthFrame, plane.lifetime, currentFrameRef.current, cropStart, cropEnd)) return;
    const relativeFrame = planeFrameDistance(plane.birthFrame, currentFrameRef.current, cropStart, cropEnd);

    const newKeyframe: EmojiPlaneKeyframe = {
      frame: relativeFrame,
      corners: { ...plane.corners },
      opacity: plane.opacity
    };

    // Single update - remove duplicate mapping!
    const updatedPlanes = emojiPlanesRef.current.map(p => {
      if (p.id === planeId) {
        const filteredKeyframes = p.keyframes.filter(kf => kf.frame !== relativeFrame);
        return {
          ...p,
          keyframes: [...filteredKeyframes, newKeyframe].sort((a, b) => a.frame - b.frame)
        };
      }
      return p;
    });

    // Update both ref and state once
    emojiPlanesRef.current = updatedPlanes;
    setEmojiPlanes(updatedPlanes);

    console.log(`[PLANE KEYFRAME] Stamped keyframe at frame ${relativeFrame} for plane ${planeId}`);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [cropEnd, cropStart]);

  /**
   * Delete a specific plane by ID and auto-select next one in list
   */
  const deletePlane = useCallback((planeId: string) => {
    if (!planeId) return;

    const currentPlanes = emojiPlanesRef.current;
    const currentIndex = currentPlanes.findIndex(p => p.id === planeId);

    // Filter out the deleted plane
    const newPlanes = currentPlanes.filter(p => p.id !== planeId);

    // Auto-select next plane in list (or previous if deleting last one)
    let newSelectedId: string | null = null;
    if (newPlanes.length > 0) {
      if (currentIndex < newPlanes.length) {
        // Select the plane that's now at the same index (next plane)
        newSelectedId = newPlanes[currentIndex].id;
      } else {
        // We deleted the last plane, select the new last plane
        newSelectedId = newPlanes[newPlanes.length - 1].id;
      }
    }

    setEmojiPlanes(newPlanes);
    emojiPlanesRef.current = newPlanes;
    setSelectedPlaneId(newSelectedId);
    selectedPlaneIdRef.current = newSelectedId;
    saveToUndoStack();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [saveToUndoStack]);

  /**
   * Delete selected plane and auto-select next one in list (wrapper for backward compatibility)
   */
  const deleteSelectedPlane = useCallback(() => {
    if (selectedPlaneId) {
      deletePlane(selectedPlaneId);
    }
  }, [selectedPlaneId, deletePlane]);

  /**
   * Check if a point is near a control point (corner or edge midpoint) for dragging
   */
  const findNearestCorner = useCallback((x: number, y: number, plane: EmojiPlane): CornerType | null => {
    const CORNER_RADIUS = 80; // Generous touch radius for easy grabbing with finger or mouse

    // Only detect the 4 corner control points
    const controlPoints = [
      { name: 'topLeft' as CornerType, pos: plane.corners.topLeft },
      { name: 'topRight' as CornerType, pos: plane.corners.topRight },
      { name: 'bottomRight' as CornerType, pos: plane.corners.bottomRight },
      { name: 'bottomLeft' as CornerType, pos: plane.corners.bottomLeft }
    ];

    // Find the NEAREST corner within radius (prioritize closest corner)
    let nearestCorner: CornerType | null = null;
    let nearestDist = CORNER_RADIUS;

    for (const point of controlPoints) {
      const dist = Math.hypot(point.pos.x - x, point.pos.y - y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestCorner = point.name;
      }
    }

    return nearestCorner;
  }, []);

  /**
   * Get visible planes on current frame, sorted by z-index
   */
  const getVisiblePlanes = useCallback(() => {
    const currentFrame = currentFrameRef.current;
    return emojiPlanesRef.current
      .filter(plane => {
        return isPlaneVisibleAtFrame(
          plane.birthFrame, plane.lifetime, currentFrame, cropStart, cropEnd,
        ) && plane.visible !== false;
      })
      .sort((a, b) => a.zIndex - b.zIndex); // Lower zIndex = drawn first (back)
  }, [cropEnd, cropStart]);

  /**
   * Reorder planes (change z-index)
   */
  const reorderPlanes = useCallback((reorderedPlanes: EmojiPlane[]) => {
    // Reassign z-indices based on new order
    const updated = reorderedPlanes.map((plane, index) => ({
      ...plane,
      zIndex: index + 1
    }));
    setEmojiPlanes(updated);
    saveToUndoStack();
  }, [saveToUndoStack]);

  /**
   * Broom/Eraser tool: Remove stamps within radius of the eraser
   * Clears stamps from the current frame only
   * Works during playback without pausing
   */
  const clearStampsAtPoint = useCallback((x: number, y: number) => {
    const currentFrame = currentFrameRef.current;
    const eraserRadius = framerBrushSizeRef.current * 1.5; // Eraser is 1.5x brush size

    if (!framesRef.current[currentFrame]) return;

    const frame = framesRef.current[currentFrame];
    const initialCount = frame.stamps.length;

    // Filter out stamps that are within the eraser radius
    // Check both position AND visibility (birthFrame/lifetime)
    frame.stamps = frame.stamps.filter(stamp => {
      const dist = Math.hypot(stamp.x - x, stamp.y - y);
      return dist > eraserRadius; // Keep stamps outside the radius
    });

    const removedCount = initialCount - frame.stamps.length;
    if (removedCount > 0) {
      scheduleRender();
    }
  }, [scheduleRender]);

  // PHASE 8: Interpolate light layer keyframes during playback
  /**
   * Linear interpolation helper
   */
  const lerp = useCallback((a: number, b: number, t: number) => {
    return a + (b - a) * t;
  }, []);

  /**
   * Get interpolated emoji plane values for a specific frame
   * Returns interpolated corners and opacity
   */
  const getInterpolatedPlaneValues = useCallback((plane: EmojiPlane, relativeFrame: number) => {
    if (plane.keyframes.length === 0) {
      return { corners: plane.corners, opacity: plane.opacity };
    }

    // Sort keyframes by frame
    const sortedKeyframes = [...plane.keyframes].sort((a, b) => a.frame - b.frame);

    // Find keyframe before and after current frame
    let beforeKeyframe: EmojiPlaneKeyframe | null = null;
    let afterKeyframe: EmojiPlaneKeyframe | null = null;

    for (let i = 0; i < sortedKeyframes.length; i++) {
      if (sortedKeyframes[i].frame <= relativeFrame) {
        beforeKeyframe = sortedKeyframes[i];
      }
      if (sortedKeyframes[i].frame >= relativeFrame && !afterKeyframe) {
        afterKeyframe = sortedKeyframes[i];
      }
    }

    // If no keyframes before, use first keyframe
    if (!beforeKeyframe) {
      beforeKeyframe = sortedKeyframes[0];
    }

    // LOOP ANIMATION: If no keyframes after current frame, loop back to first keyframe
    if (!afterKeyframe) {
      afterKeyframe = sortedKeyframes[0]; // Loop to first keyframe instead of holding last
    }

    // If both are the same keyframe, return its values directly
    if (beforeKeyframe.frame === afterKeyframe.frame) {
      return {
        corners: beforeKeyframe.corners,
        opacity: beforeKeyframe.opacity
      };
    }

    // Interpolate between keyframes (supports looping across timeline boundary)
    let frameDelta = afterKeyframe.frame - beforeKeyframe.frame;

    // LOOP ANIMATION: If afterKeyframe is earlier than beforeKeyframe, we're looping
    if (frameDelta < 0) {
      // Calculate distance wrapping around the plane's lifetime
      frameDelta = (clampPlaneLifetime(plane.lifetime, cropStart, cropEnd) - beforeKeyframe.frame) + afterKeyframe.frame;
    }

    const t = (relativeFrame - beforeKeyframe.frame) / frameDelta;

    // Interpolate each corner
    const interpolatedCorners = {
      topLeft: {
        x: lerp(beforeKeyframe.corners.topLeft.x, afterKeyframe.corners.topLeft.x, t),
        y: lerp(beforeKeyframe.corners.topLeft.y, afterKeyframe.corners.topLeft.y, t)
      },
      topMid: {
        x: lerp(beforeKeyframe.corners.topMid.x, afterKeyframe.corners.topMid.x, t),
        y: lerp(beforeKeyframe.corners.topMid.y, afterKeyframe.corners.topMid.y, t)
      },
      topRight: {
        x: lerp(beforeKeyframe.corners.topRight.x, afterKeyframe.corners.topRight.x, t),
        y: lerp(beforeKeyframe.corners.topRight.y, afterKeyframe.corners.topRight.y, t)
      },
      rightMid: {
        x: lerp(beforeKeyframe.corners.rightMid.x, afterKeyframe.corners.rightMid.x, t),
        y: lerp(beforeKeyframe.corners.rightMid.y, afterKeyframe.corners.rightMid.y, t)
      },
      bottomRight: {
        x: lerp(beforeKeyframe.corners.bottomRight.x, afterKeyframe.corners.bottomRight.x, t),
        y: lerp(beforeKeyframe.corners.bottomRight.y, afterKeyframe.corners.bottomRight.y, t)
      },
      bottomMid: {
        x: lerp(beforeKeyframe.corners.bottomMid.x, afterKeyframe.corners.bottomMid.x, t),
        y: lerp(beforeKeyframe.corners.bottomMid.y, afterKeyframe.corners.bottomMid.y, t)
      },
      bottomLeft: {
        x: lerp(beforeKeyframe.corners.bottomLeft.x, afterKeyframe.corners.bottomLeft.x, t),
        y: lerp(beforeKeyframe.corners.bottomLeft.y, afterKeyframe.corners.bottomLeft.y, t)
      },
      leftMid: {
        x: lerp(beforeKeyframe.corners.leftMid.x, afterKeyframe.corners.leftMid.x, t),
        y: lerp(beforeKeyframe.corners.leftMid.y, afterKeyframe.corners.leftMid.y, t)
      }
    };

    return {
      corners: interpolatedCorners,
      opacity: lerp(beforeKeyframe.opacity, afterKeyframe.opacity, t)
    };
  }, [cropEnd, cropStart, lerp]);

  /**
   * Apply interpolated emoji plane values ALWAYS (during playback AND manual scrubbing)
   * Watches currentFrame and applies interpolated keyframe values from planes with keyframes
   * ALWAYS INTERPOLATES: Works during playback AND when manually scrubbing timeline
   * ALWAYS PLAYS: Keyframes play even when placer mode is closed
   */
  useEffect(() => {
    // ALWAYS apply interpolation - works during playback AND manual scrubbing!
    // This allows you to see the interpolated state when moving timeline by hand

    // Update each plane that has keyframes
    let updatedAny = false;
    const updatedPlanes = emojiPlanesRef.current.map(plane => {
      if (plane.keyframes.length === 0) {
        return plane; // Skip planes without keyframes
      }

      if (!isPlaneVisibleAtFrame(plane.birthFrame, plane.lifetime, currentFrame, cropStart, cropEnd)) return plane;
      // Cyclic distance stays 0...lifetime-1 even when the plane crosses cropEnd -> cropStart.
      const relativeFrame = planeFrameDistance(plane.birthFrame, currentFrame, cropStart, cropEnd);

      // Get interpolated values
      const interpolated = getInterpolatedPlaneValues(plane, relativeFrame);

      updatedAny = true;
      return {
        ...plane,
        corners: interpolated.corners,
        opacity: interpolated.opacity
      };
    });

    if (updatedAny) {
      setEmojiPlanes(updatedPlanes);
      emojiPlanesRef.current = updatedPlanes;
      scheduleRender();
    }
  }, [currentFrame, cropStart, cropEnd]);

  // Calculate distance between two touches (for pinch zoom)
  const getDistance = useCallback((touches: any[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  // Calculate angle between two touches (for rotation)
  const getAngle = useCallback((touches: any[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[1].pageX - touches[0].pageX;
    const dy = touches[1].pageY - touches[0].pageY;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  }, []);

  // Track if we're in zoom mode (prevents accidental drawing during pinch)
  const isZooming = useRef(false);

  // Helper: Check if touch is within canvas drawing area
  const isTouchInCanvas = useCallback((touch: any): boolean => {
    if (!canvasBoundsRef.current) return true;

    const touchX = touch.pageX ?? 0;
    const touchY = touch.pageY ?? 0;
    const bounds = canvasBoundsRef.current;

    const inBounds = touchX >= bounds.x && touchX <= (bounds.x + bounds.width) &&
           touchY >= bounds.y && touchY <= (bounds.y + bounds.height);

    return inBounds;
  }, []);

  // Helper: Count how many touches are within canvas bounds
  const countTouchesInCanvas = useCallback((touches: any[]): number => {
    return touches.filter(touch => isTouchInCanvas(touch)).length;
  }, [isTouchInCanvas]);

  /** Once-per-gesture side effects, kept out of the per-point paint path. */
  const beginPaintGesture = useCallback(() => {
    if (!lifetimeGestureIdRef.current) {
      lifetimeGestureIdRef.current = `framer:${Date.now()}:${Math.floor(Math.random() * 1e9)}`;
    }
    setShowBrushOptions(false);
  }, []);
  beginPaintGestureRef.current = beginPaintGesture;

  const finishPaintGesture = useCallback(() => {
    const lifetimeGestureId = lifetimeGestureIdRef.current;
    if (paintedDuringGestureRef.current && lifetimeGestureId) {
      void recordLifetimeStrokeCommit({
        eventId: lifetimeGestureId,
        workspace: 'framer',
      });
    }
    lifetimeGestureIdRef.current = null;
    if (activeChallenge && paintedDuringGestureRef.current) {
      const nextCount = challengePaintStrokeCountRef.current + 1;
      challengePaintStrokeCountRef.current = nextCount;
      setChallengePaintStrokeCount(nextCount);
      saveFramerChallengeAutosave();
    }
    paintedDuringGestureRef.current = false;
  }, [activeChallenge, saveFramerChallengeAutosave]);

  // PanResponder for touch handling (drawing + zoom)
  const panResponder = useMemo(() =>
    PanResponder.create({
      // Only claim a new touch when not already drawing, so a slider finger
      // doesn't get stolen by the canvas PanResponder.
      onStartShouldSetPanResponder: () => !isDrawing.current,
      // Re-claim move events when iOS terminated us (slider lift) but drawing finger is still on canvas.
      onMoveShouldSetPanResponder: (evt: GestureResponderEvent) => {
        if (!isDrawing.current) return false;
        const canvasCount = countTouchesInCanvas(evt.nativeEvent.touches);
        if (canvasCount === 0) {
          // Drawing finger already lifted without us seeing — clear stale state.
          isDrawing.current = false;
          lastDrawPoint.current = null;
          return false;
        }
        return true;
      },
      // Never yield an active stroke to another responder.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const touches = evt.nativeEvent.touches;
        const touchesInCanvas = countTouchesInCanvas(touches);

        // Resume after iOS terminate (e.g. slider finger lifted): drawing finger still active on canvas.
        // Re-anchor lastDrawPoint so onPanResponderMove picks up seamlessly without a new stroke.
        if (isDrawing.current && !isZooming.current) {
          const canvasTouch = touches.find(t => isTouchInCanvas(t));
          if (canvasTouch && canvasBoundsRef.current) {
            const displayScale = logicalCanvasSize / canvasSize;
            lastDrawPoint.current = {
              x: (canvasTouch.pageX - canvasBoundsRef.current.x) * displayScale,
              y: (canvasTouch.pageY - canvasBoundsRef.current.y) * displayScale
            };
          }
          return;
        }

        // ZOOM MODE: Enable pinch zoom and panning
        if (zoomModeEnabled) {
          if (touches.length === 2 && touchesInCanvas === 2) {
            // Two-finger: both pinch zoom AND panning (only if BOTH on canvas)
            isDrawing.current = false;
            isZooming.current = true;
            const distance = getDistance(touches);
            zoomRef.current.lastScale = zoomRef.current.targetScale;
            zoomRef.current.scale = distance;
            // Also track center point for two-finger panning
            const centerX = (touches[0].pageX + touches[1].pageX) / 2;
            const centerY = (touches[0].pageY + touches[1].pageY) / 2;
            panRef.current.startX = canvasOffset.x;
            panRef.current.startY = canvasOffset.y;
            panRef.current.x = centerX;
            panRef.current.y = centerY;
            return;
          } else if (touches.length === 1 && touchesInCanvas === 1) {
            // Single finger: pan if zoomed beyond default, otherwise do nothing
            if (zoomScale > DEFAULT_ZOOM) {
              isDrawing.current = false;
              isZooming.current = true; // Use zoom mode for panning
              const touch = evt.nativeEvent;
              panRef.current.startX = canvasOffset.x;
              panRef.current.startY = canvasOffset.y;
              panRef.current.x = touch.pageX;
              panRef.current.y = touch.pageY;
            }
            return;
          }
        }

        // EMOJI PLANE TOOL GUARD: Prevent normal drawing when placer mode is active
        // User must deselect plane or switch to another tool to draw normally
        if (emojiPlaneToolActive) {
          // Skip this check - placer mode has its own touch handling below
          // This allows plane manipulation but prevents normal brush drawing
        }

        // DRAWING MODE: Only stop drawing if BOTH touches are on canvas (zoom gesture)
        // Allow drawing to continue if one touch is on canvas and another is on UI (e.g., size slider)
        if (touches.length === 2 && touchesInCanvas === 2) {
          isDrawing.current = false;
          isZooming.current = false;
          return;
        } else if (touches.length === 2 && touchesInCanvas === 1) {
          // One finger on canvas, one on UI - ALLOW drawing to continue
          // Don't return - allow drawing to continue below
        } else if (touches.length > 2) {
          isDrawing.current = false;
          return;
        }

        // Drawing: Find the touch that's on the canvas
        const canvasTouch = touches.find(touch => isTouchInCanvas(touch));
        if (!canvasTouch) {
          return;
        }

        // Use pageX/pageY (absolute screen coordinates)
        const touchX = canvasTouch.pageX ?? 0;
        const touchY = canvasTouch.pageY ?? 0;

        const canvasBounds = canvasBoundsRef.current;
        if (!canvasBounds) {
          return;
        }


        // Subtract canvas absolute position to get canvas-relative coordinates
        let x = touchX - canvasBounds.x;
        let y = touchY - canvasBounds.y;

        // Scale coordinates from display size to logical size
        const displayScale = logicalCanvasSize / canvasSize;
        x = x * displayScale;
        y = y * displayScale;


        // Save state to undo stack before drawing
        saveToUndoStack();

        // Reset lerp for new stroke - start from current brush size
        previousBrushSizeRef.current = framerBrushSizeRef.current;

        // LINE TOOL: Store start point and wait for release
        if (lineToolActive) {
          lineStartPointRef.current = { x, y };
          linePreviewPointRef.current = null;
          isDrawing.current = true;
          isZooming.current = false;
          lastDrawPoint.current = { x, y };
          void Haptics.selectionAsync();
          return;
        }

        // BROOM TOOL: Start clearing stamps
        if (broomToolActive) {
          setBroomIsClearing(true);
          setBroomCursorPos({ x, y });
          clearStampsAtPoint(x, y);
          isDrawing.current = true;
          isZooming.current = false;
          lastDrawPoint.current = { x, y };
          void Haptics.selectionAsync();
          return;
        }

        // EMOJI PLANE TOOL: Detect corner touch or plane body touch for selection
        if (emojiPlaneToolActive) {

          // IMPORTANT: Check for two-finger touches FIRST - skip single-touch logic if user is doing pinch gesture
          if (touches.length === 2) {
            isDrawing.current = true; // Allow onPanResponderMove to process pinch
            isZooming.current = false;
            return;
          }

          // Get all visible planes (respecting birthFrame and lifetime)
          const visiblePlanes = getVisiblePlanes();

          // Auto-create first plane if none exist
          if (visiblePlanes.length === 0) {
            createEmojiPlane();
            isDrawing.current = false;
            isZooming.current = false;
            return;
          }

          // PRIORITY 1: Check if user touched a corner on ANY plane (corners have highest priority!)
          // First check selected plane, then check all other planes
          let cornerFound = false;
          if (selectedPlaneId) {
            const selectedPlane = visiblePlanes.find(p => p.id === selectedPlaneId);
            if (selectedPlane) {
              const corner = findNearestCorner(x, y, selectedPlane);
              if (corner) {
                // Calculate offset between touch point and actual corner position
                const cornerPos = selectedPlane.corners[corner];
                const offsetX = cornerPos.x - x;
                const offsetY = cornerPos.y - y;
                setDraggingCorner({ planeId: selectedPlaneId, corner });
                draggingCornerRef.current = { planeId: selectedPlaneId, corner, offsetX, offsetY };
                isDrawing.current = true;
                isZooming.current = false;
                lastDrawPoint.current = { x, y };
                void Haptics.selectionAsync();
                saveToUndoStack(); // Save before starting corner drag
                cornerFound = true;
              }
            }
          }

          // Check corners on all other planes if selected plane corner not found
          if (!cornerFound) {
            for (const plane of visiblePlanes) {
              if (plane.id === selectedPlaneId) continue; // Skip selected plane (already checked)
              const corner = findNearestCorner(x, y, plane);
              if (corner) {
                // Calculate offset between touch point and actual corner position
                const cornerPos = plane.corners[corner];
                const offsetX = cornerPos.x - x;
                const offsetY = cornerPos.y - y;
                setSelectedPlaneId(plane.id);
                selectedPlaneIdRef.current = plane.id;
                setDraggingCorner({ planeId: plane.id, corner });
                draggingCornerRef.current = { planeId: plane.id, corner, offsetX, offsetY };
                isDrawing.current = true;
                isZooming.current = false;
                lastDrawPoint.current = { x, y };
                void Haptics.selectionAsync();
                saveToUndoStack(); // Save before starting corner drag
                cornerFound = true;
                break;
              }
            }
          }

          // If corner was found and grabbed, return early
          if (cornerFound) {
            isZooming.current = false;
            return;
          }

          // PRIORITY 2: If no corner touched, check if user touched a plane body to select it
          // Find all planes that contain this point (might be multiple if overlapping)
          const touchedPlanes = visiblePlanes.filter(plane => {
            // Simple bounding box check - point inside the quadrilateral
            const corners = plane.corners;
            const minX = Math.min(corners.topLeft.x, corners.topRight.x, corners.bottomLeft.x, corners.bottomRight.x);
            const maxX = Math.max(corners.topLeft.x, corners.topRight.x, corners.bottomLeft.x, corners.bottomRight.x);
            const minY = Math.min(corners.topLeft.y, corners.topRight.y, corners.bottomLeft.y, corners.bottomRight.y);
            const maxY = Math.max(corners.topLeft.y, corners.topRight.y, corners.bottomLeft.y, corners.bottomRight.y);

            return x >= minX && x <= maxX && y >= minY && y <= maxY;
          });

          if (touchedPlanes.length > 0) {
            // Cycle through touched planes - find current selected in list, select next
            if (selectedPlaneId && touchedPlanes.some(p => p.id === selectedPlaneId)) {
              const currentIndex = touchedPlanes.findIndex(p => p.id === selectedPlaneId);
              const nextIndex = (currentIndex + 1) % touchedPlanes.length;
              const nextPlane = touchedPlanes[nextIndex];
              setSelectedPlaneId(nextPlane.id);
              selectedPlaneIdRef.current = nextPlane.id;

              // DON'T start dragging yet - wait for onPanResponderMove to determine if it's a drag or pinch
              isDrawing.current = true; // Enable movement tracking
              lastDrawPoint.current = { x, y };
              void Haptics.selectionAsync();
            } else {
              // Select the topmost plane (highest z-index)
              const topmostPlane = touchedPlanes[touchedPlanes.length - 1];
              setSelectedPlaneId(topmostPlane.id);
              selectedPlaneIdRef.current = topmostPlane.id;

              // DON'T start dragging yet - wait for onPanResponderMove to determine if it's a drag or pinch
              isDrawing.current = true; // Enable movement tracking
              lastDrawPoint.current = { x, y };
              void Haptics.selectionAsync();
            }
          } else {
            // No plane touched - deselect
            isDrawing.current = false;
          }

          isZooming.current = false;
          return;
        }

        isDrawing.current = true;
        isZooming.current = false; // Not zooming
        lastDrawPoint.current = { x, y };
        paintStrokePoint(x, y);
        void Haptics.selectionAsync();
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const touches = evt.nativeEvent.touches;

        // ZOOM MODE: Handle pinch zoom and panning
        if (zoomModeEnabled && isZooming.current) {
          if (touches.length === 2) {
            // Two-finger: pinch zoom + panning
            const distance = getDistance(touches);
            const scaleFactor = distance / zoomRef.current.scale;
            const dampingFactor = 0.8; // Increased from 0.5 for more responsive zoom
            const dampedScaleFactor = 1 + (scaleFactor - 1) * dampingFactor;
            const newScale = Math.max(DEFAULT_ZOOM, Math.min(3, zoomRef.current.lastScale * dampedScaleFactor));

            setZoomScale(newScale);
            zoomRef.current.targetScale = newScale;
            zoomRef.current.lastScale = newScale;

            // Snap to center when reaching default zoom, otherwise allow panning
            if (newScale === DEFAULT_ZOOM) {
              setCanvasOffset({ x: 0, y: 0 });
              panRef.current = { x: 0, y: 0, startX: 0, startY: 0 };
            } else {
              // Also pan based on center point movement
              const centerX = (touches[0].pageX + touches[1].pageX) / 2;
              const centerY = (touches[0].pageY + touches[1].pageY) / 2;
              const deltaX = centerX - panRef.current.x;
              const deltaY = centerY - panRef.current.y;

              setCanvasOffset({
                x: panRef.current.startX + deltaX,
                y: panRef.current.startY + deltaY
              });
            }

            return;
          } else if (touches.length === 1) {
            // Pan the canvas
            const touch = evt.nativeEvent;
            const deltaX = touch.pageX - panRef.current.x;
            const deltaY = touch.pageY - panRef.current.y;

            setCanvasOffset({
              x: panRef.current.startX + deltaX,
              y: panRef.current.startY + deltaY
            });

            return;
          }
        }

        // EMOJI PLANE TOOL: Two-finger pinch to scale (CHECK THIS FIRST - works anywhere on screen!)
        if (emojiPlaneToolActive && selectedPlaneId && touches.length === 2) {
          const distance = getDistance(touches);

          // Initialize pinch if not already started
          if (!planePinchRef.current) {
            const selectedPlane = emojiPlanesRef.current.find(p => p.id === selectedPlaneId);
            if (selectedPlane) {
              planePinchRef.current = {
                planeId: selectedPlaneId,
                initialDistance: distance,
                initialCorners: { ...selectedPlane.corners }
              };
            }
          } else {
            // Calculate incremental scale factor from last distance
            const scaleFactor = distance / planePinchRef.current.initialDistance;
            scalePlane(selectedPlaneId, scaleFactor);

            // Update for next frame - use current corners and distance as new baseline
            const updatedPlane = emojiPlanesRef.current.find(p => p.id === selectedPlaneId);
            if (updatedPlane) {
              planePinchRef.current = {
                planeId: selectedPlaneId,
                initialDistance: distance,
                initialCorners: { ...updatedPlane.corners }
              };
            }
          }
          return;
        }

        // DRAWING MODE: Only stop if BOTH touches are on canvas (unless emoji plane tool active)
        // Allow drawing to continue if one touch is on canvas and another is on UI
        const touchesInCanvas = countTouchesInCanvas(touches);
        if (touches.length === 2 && touchesInCanvas === 2 && !emojiPlaneToolActive) {
          // Both touches on canvas - stop drawing
          return;
        }

        // Continue drawing if we have an active drawing session
        if (!isDrawing.current || isZooming.current) return;

        // Find the touch that's on the canvas (even if there are multiple touches)
        const canvasTouch = touches.find(touch => isTouchInCanvas(touch));
        if (!canvasTouch) {
          // No touch on canvas anymore - stop drawing
          return;
        }

        // Use pageX/pageY (absolute screen coordinates) - SAME as onPanResponderGrant
        const touchX = canvasTouch.pageX ?? 0;
        const touchY = canvasTouch.pageY ?? 0;

        const canvasBounds = canvasBoundsRef.current;
        if (!canvasBounds) return;

        // Subtract canvas absolute position to get canvas-relative coordinates
        let x = touchX - canvasBounds.x;
        let y = touchY - canvasBounds.y;

        // Scale coordinates from display size to logical size
        const displayScale = logicalCanvasSize / canvasSize;
        x = x * displayScale;
        y = y * displayScale;

        // LINE TOOL: Update preview end point (don't paint yet)
        if (lineToolActive && lineStartPointRef.current) {
          linePreviewPointRef.current = { x, y };
          scheduleRender(); // Trigger re-render to show preview line
          return;
        }

        // BROOM TOOL: Continue clearing as user drags
        if (broomToolActive && broomIsClearing) {
          setBroomCursorPos({ x, y });
          clearStampsAtPoint(x, y);
          lastDrawPoint.current = { x, y };
          return;
        }

        // EMOJI PLANE TOOL: Drag corner to transform plane (CHECK THIS FIRST!)
        // NOTE: Only check draggingCornerRef, not emojiPlaneToolActive - once corner is grabbed, keep dragging it
        if (draggingCornerRef.current) {
          const { planeId, corner, offsetX = 0, offsetY = 0 } = draggingCornerRef.current;

          // Apply the offset to keep the corner at the correct position relative to the touch
          const adjustedX = x + offsetX;
          const adjustedY = y + offsetY;

          updatePlaneCorner(planeId, corner, adjustedX, adjustedY);

          lastDrawPoint.current = { x, y };
          scheduleRender(); // Trigger re-render to show updated plane
          return;
        }

        // EMOJI PLANE TOOL: Start plane body drag if not already dragging and single touch
        if (emojiPlaneToolActive && selectedPlaneIdRef.current && !draggingCornerRef.current && !draggingPlaneRef.current && touches.length === 1) {
          // Start dragging the plane body now that we know it's a single-touch movement
          setDraggingPlane({ planeId: selectedPlaneIdRef.current, startX: x, startY: y });
          draggingPlaneRef.current = { planeId: selectedPlaneIdRef.current, startX: x, startY: y };
          lastDrawPoint.current = { x, y };
          saveToUndoStack(); // Save before starting drag
          return;
        }

        // EMOJI PLANE TOOL: Drag plane body to move entire plane
        if (emojiPlaneToolActive && draggingPlaneRef.current) {
          const { planeId, startX, startY } = draggingPlaneRef.current;
          const deltaX = x - (lastDrawPoint.current?.x ?? startX);
          const deltaY = y - (lastDrawPoint.current?.y ?? startY);
          movePlane(planeId, deltaX, deltaY);
          lastDrawPoint.current = { x, y };
          scheduleRender(); // Trigger re-render to show updated plane
          return;
        }

        if (lastDrawPoint.current) {
          interpolateAndPaint(lastDrawPoint.current.x, lastDrawPoint.current.y, x, y);
        }

        lastDrawPoint.current = { x, y };
      },
      onPanResponderRelease: (evt: GestureResponderEvent) => {
        // When a non-drawing finger (e.g. slider) lifts, React Native fires release on the active
        // responder even though the drawing finger is still down. Check remaining touches first.
        const remainingTouches = evt.nativeEvent.touches; // active touches AFTER this lift
        if (countTouchesInCanvas(remainingTouches) > 0) {
          // Drawing finger still on canvas — re-anchor draw point and keep going.
          // onMoveShouldSetPanResponder will re-claim the gesture on the next move.
          const canvasTouch = remainingTouches.find(t => isTouchInCanvas(t));
          if (canvasTouch && canvasBoundsRef.current) {
            const displayScale = logicalCanvasSize / canvasSize;
            lastDrawPoint.current = {
              x: (canvasTouch.pageX - canvasBoundsRef.current.x) * displayScale,
              y: (canvasTouch.pageY - canvasBoundsRef.current.y) * displayScale
            };
          }
          isZooming.current = false;
          return;
        }

        // All fingers lifted — finalize the stroke normally.

        // LINE TOOL: Paint the complete line on release
        if (lineToolActive && lineStartPointRef.current && linePreviewPointRef.current) {
          const start = lineStartPointRef.current;
          const end = linePreviewPointRef.current;
          paintLine(start.x, start.y, end.x, end.y);
          lineStartPointRef.current = null;
          linePreviewPointRef.current = null;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }

        // BROOM TOOL: Stop clearing on release and hide cursor
        if (broomToolActive && broomIsClearing) {
          setBroomIsClearing(false);
          setBroomCursorPos(null);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }

        // EMOJI PLANE TOOL: Stop dragging corner
        if (emojiPlaneToolActive && draggingCornerRef.current) {
          setDraggingCorner(null);
          draggingCornerRef.current = null;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }

        // EMOJI PLANE TOOL: Stop dragging plane body
        if (emojiPlaneToolActive && draggingPlaneRef.current) {
          setDraggingPlane(null);
          draggingPlaneRef.current = null;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }

        // EMOJI PLANE TOOL: Stop pinch scaling
        if (planePinchRef.current) {
          planePinchRef.current = null;
        }

        finishPaintGesture();

        isDrawing.current = false;
        isZooming.current = false;
        lastDrawPoint.current = null;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      },
      onPanResponderTerminate: (evt: GestureResponderEvent) => {
        const remainingTouches = evt.nativeEvent.touches;
        if (countTouchesInCanvas(remainingTouches) > 0) {
          // Drawing finger still on canvas after terminate — keep drawing state intact.
          isZooming.current = false;
          return;
        }

        // No canvas touch remains — full cleanup.
        lineStartPointRef.current = null;
        linePreviewPointRef.current = null;
        finishPaintGesture();

        if (broomIsClearing) {
          setBroomIsClearing(false);
          setBroomCursorPos(null);
        }

        isZooming.current = false;
      }
    }),
    // NOTE: `currentFrame` deliberately absent. Nothing in these handlers reads
    // it (the paint path goes through `currentFrameRef`), but leaving it here
    // rebuilt the whole PanResponder — and handed the canvas View a brand-new
    // `panHandlers` object — on every single playback tick, which drops touches
    // mid-stroke while an animation is running.
    [zoomModeEnabled, zoomScale, canvasOffset, getDistance, interpolateAndPaint, paintStrokePoint, saveToUndoStack, isTouchInCanvas, countTouchesInCanvas, getAngle, lineToolActive, paintLine, broomToolActive, broomIsClearing, clearStampsAtPoint, updatePlaneCorner, movePlane, scalePlane, emojiPlaneToolActive, selectedPlaneId, createEmojiPlane, getVisiblePlanes, findNearestCorner, finishPaintGesture]
  ).panHandlers;

  // Playback loop with FPS-based time accumulation (optimized for smooth 30fps playback)
  // PERFORMANCE: Reduced re-renders by batching frame updates
  useEffect(() => {
    if (!isPlaying) {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      return;
    }

    const stepMs = 1000 / fps; // Time per frame in milliseconds

    const tick = (timestamp: number) => {
      if (lastTimestamp.current === 0) {
        lastTimestamp.current = timestamp;
      }

      const deltaMs = timestamp - lastTimestamp.current;
      lastTimestamp.current = timestamp;
      accumMs.current += deltaMs;

      // Step frame when accumulated time exceeds frame time
      while (accumMs.current >= stepMs) {
        // Compute next frame from the ref (always current, no state lag)
        const next = currentFrameRef.current + 1;
        let newFrame: number;

        if (next >= cropEnd) {
          if (loop) {
            newFrame = cropStart;
            // Progressive video volume: increase by 0.1 each loop, max 0.7
            if (videoUri && videoRef.current) {
              videoLoopCount.current += 1;
              const newVolume = Math.min(0.1 + (videoLoopCount.current * 0.1), 0.7);
              setVideoVolume(newVolume);
              videoRef.current.setVolumeAsync(newVolume).catch((err: any) => {
                console.error('[FRAMER] Failed to set volume:', err);
              });
            }
          } else {
            newFrame = cropEnd - 1;
            setIsPlaying(false);
          }
        } else if (next < cropStart) {
          newFrame = cropStart;
        } else {
          newFrame = next;
        }

        // Sync ref immediately — paintStrokePoint reads this ref, so it must be
        // up-to-date before any touch events fire (useEffect sync is too late)
        currentFrameRef.current = newFrame;
        setCurrentFrame(newFrame);
        accumMs.current -= stepMs;
      }

      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);

    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      lastTimestamp.current = 0;
      accumMs.current = 0;
    };
  }, [isPlaying, fps, cropStart, cropEnd, loop]);

  // Export/Import animation: Load random logo when export or import starts
  useEffect(() => {
    if ((isExporting || isImporting) && !exportLogoSet) {
      setExportLogoSet(getRandomLogoSet());
      setExportLogoFrameIndex(0);
    } else if (!isExporting && !isImporting) {
      setExportLogoSet(null);
      setExportLogoFrameIndex(0);
    }
  }, [isExporting, isImporting, exportLogoSet]);

  // Export/Import animation: Cycle through logo frames with random speed variation
  useEffect(() => {
    if ((!isExporting && !isImporting) || !exportLogoSet) return;

    // Video logos play automatically - no frame cycling needed
    if (exportLogoSet.type === 'video') return;

    let timeoutId: NodeJS.Timeout;
    const totalFrames = exportLogoSet.frames.length + 1; // +1 for base icon

    const advanceFrame = () => {
      setExportLogoFrameIndex((prev) => {
        const nextFrame = (prev + 1) % totalFrames;

        // Calculate next frame delay with random variation (70-110ms, ±25% variation for stop-motion feel)
        const baseDelay = 80;
        const randomVariation = 0.5 + (Math.random() * 0.5); // 0.5x to 1.0x (50% to 100% of base)
        const delay = baseDelay * randomVariation;

        // If we're on the last frame, hold it longer before looping (2x base delay for smooth loop)
        const isLastFrame = prev === totalFrames - 1;
        const actualDelay = isLastFrame ? baseDelay * 2 : delay;


        timeoutId = setTimeout(advanceFrame, actualDelay);
        return nextFrame;
      });
    };

    // Start the animation
    timeoutId = setTimeout(advanceFrame, 80);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isExporting, isImporting, exportLogoSet]);

  // Toggle playback
  const togglePlayback = useCallback(() => {
    setIsPlaying(prev => !prev);
    void Haptics.selectionAsync();
  }, []);

  // Transport PanResponder removed - controls now in bottom panel

  // Smart clear button handler
  const handleClearButton = useCallback(() => {
    if (clearState === 'idle') {
      // First click: show "ALL" button for 3s
      setClearState('showAll');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

      // Reset after 3 seconds
      clearTimeoutRef.current = setTimeout(() => {
        setClearState('idle');
      }, 3000);
    } else if (clearState === 'showAll') {
      // Second click on trash: clear current frame only
      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current);
      }

      // Pause playback during clear
      const wasPlaying = isPlaying;
      if (wasPlaying) {
        setIsPlaying(false);
      }

      // Clear current frame
      framesRef.current[currentFrame] = { stamps: [] };
      scheduleRender();
      setClearState('idle');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);


      // Resume playback after short delay
      if (wasPlaying) {
        setTimeout(() => setIsPlaying(true), 100);
      }
    }
  }, [clearState, currentFrame, scheduleRender, isPlaying]);

  // Handle "ALL" button click - clear all frames
  const handleClearAll = useCallback(async () => {
    if (clearTimeoutRef.current) {
      clearTimeout(clearTimeoutRef.current);
    }


    // Remember if playback was on
    const wasPlaying = isPlaying;

    // Stop playback immediately
    setIsPlaying(false);

    // Reset to first frame
    setCurrentFrame(0);

    // Reset frame count to default 300
    setFrameCount(300);

    // FORCE CLEAR ALL FRAMES - create entirely new array with 300 frames
    const emptyFrames = [];
    for (let i = 0; i < 300; i++) {
      emptyFrames.push({ stamps: [] });
    }
    framesRef.current = emptyFrames;

    // Clear all backgrounds too
    setBackgroundImageUri(null);
    setImportedBackgroundStrokes([]);

    // Clear video URI and metadata
    setVideoUri(null);
    setVideoStartTime(0);
    setVideoMetadata(null);
    setVideoReady(false);
    challengePaintStrokeCountRef.current = 0;
    setChallengePaintStrokeCount(0);
    paintedDuringGestureRef.current = false;

    // Clear all emoji planes and placer state
    setEmojiPlanes([]);
    emojiPlanesRef.current = [];
    setSelectedPlaneId(null);
    selectedPlaneIdRef.current = null;
    setDraggingCorner(null);
    draggingCornerRef.current = null;
    planePinchRef.current = null;

    // Wipe autosave so reload starts with empty frames
    try {
      await AsyncStorage.removeItem(FRAMER_STORAGE_KEY);
    } catch (error) {
      console.error('[FRAMER] Failed to wipe autosave:', error);
    }

    // Clear currently loaded project ID (starting fresh)
    setCurrentLoadedSlotId(null);

    // Force immediate render
    scheduleRender();

    // Reset state
    setClearState('idle');

    // Restart playback if it was on before clearing
    if (wasPlaying) {
      setIsPlaying(true);
    }

    // Haptic feedback
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

  }, [frameCount, scheduleRender, isPlaying]);

  // Handle challenge entry - clear frames and start challenge
  const handleChallengeEnter = useCallback(() => {
    if (!activeChallenge) return;


    // Wipe all frames - LIMIT TO 90 FRAMES FOR CHALLENGE MODE
    framesRef.current = Array.from({ length: 90 }, () => ({ stamps: [] }));
    setFrameCount(90);
    setCurrentFrame(0);

    // Lock crop range to 0-90
    setCropStart(0);
    setCropEnd(90);

    // Clear backgrounds
    setBackgroundImageUri(null);
    setImportedBackgroundStrokes([]);
    setVideoUri(null);
    setVideoStartTime(0);
    setVideoMetadata(null);
    setVideoReady(false);

    // Reset challenge handled flag only when timer is still running.
    // If timer already expired, keep it as handled — the user can manually trigger
    // upload via the pin button. We don't want the timer useEffect firing the
    // upload confirm immediately after the user just entered on blank frames.
    if (challengeRemainingMs > 0) {
      challengeHandledRef.current = false;
    } else {
      challengeHandledRef.current = true;
    }

    // Force render
    scheduleRender();

    // Mark this challenge as wiped
    wipedChallengeRef.current = activeChallenge.endsAt;
    lastActiveChallengeRef.current = activeChallenge;

    // Hide modal
    setShowChallengeWarningModal(false);

  }, [activeChallenge, scheduleRender, challengeRemainingMs]);

  // Handle challenge close - exit framers without clearing
  const handleChallengeClose = useCallback(() => {
    setShowChallengeWarningModal(false);
    setShowChallengeUploadConfirm(false); // clear any stale upload confirm before closing
    challengeHandledRef.current = false; // reset so timer can fire properly next open
    onClose(); // Close framers and return to main workspace
  }, [onClose]);

  // Save current state to undo stack (called before making changes)
  const saveToUndoStack = useCallback(() => {
    // Deep copy current frames
    const stateCopy: FrameData[] = framesRef.current.map(frame => ({
      stamps: frame.stamps.map(stamp => ({ ...stamp }))
    }));

    setUndoStack(prev => {
      const newStack = [...prev, stateCopy];
      // Limit history size
      if (newStack.length > maxHistorySize) {
        newStack.shift();
      }
      return newStack;
    });

    // Clear redo stack when new action is performed
    setRedoStack([]);

    console.log('[UNDO] State saved to undo stack');
  }, [maxHistorySize]);

  // Undo - revert to previous state
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) {
      console.log('[UNDO] Nothing to undo');
      return;
    }

    // Save current state to redo stack
    const currentState: FrameData[] = framesRef.current.map(frame => ({
      stamps: frame.stamps.map(stamp => ({ ...stamp }))
    }));
    setRedoStack(prev => [...prev, currentState]);

    // Pop from undo stack
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));

    // Restore previous state
    framesRef.current = previousState.map(frame => ({
      stamps: frame.stamps.map(stamp => ({ ...stamp }))
    }));

    scheduleRender();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    console.log('[UNDO] ✅ Reverted to previous state. Undo stack:', undoStack.length - 1);
  }, [undoStack, scheduleRender]);

  // Redo - restore next state
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) {
      console.log('[REDO] Nothing to redo');
      return;
    }

    // Save current state to undo stack
    const currentState: FrameData[] = framesRef.current.map(frame => ({
      stamps: frame.stamps.map(stamp => ({ ...stamp }))
    }));
    setUndoStack(prev => {
      const newStack = [...prev, currentState];
      if (newStack.length > maxHistorySize) {
        newStack.shift();
      }
      return newStack;
    });

    // Pop from redo stack
    const nextState = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));

    // Restore next state
    framesRef.current = nextState.map(frame => ({
      stamps: frame.stamps.map(stamp => ({ ...stamp }))
    }));

    scheduleRender();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    console.log('[REDO] ✅ Restored next state. Redo stack:', redoStack.length - 1);
  }, [redoStack, maxHistorySize, scheduleRender]);

  // Step one frame forward
  const stepFrameForward = useCallback(() => {
    setCurrentFrame(prev => {
      const next = prev + 1;
      return next >= frameCount ? 0 : next;
    });
    void Haptics.selectionAsync();
  }, [frameCount]);

  // Step one frame backward
  const stepFrameBackward = useCallback(() => {
    setCurrentFrame(prev => {
      const next = prev - 1;
      return next < 0 ? frameCount - 1 : next;
    });
    void Haptics.selectionAsync();
  }, [frameCount]);

  // Scrub to frame - Pause when scrubbing
  const scrubToFrame = useCallback((frame: number) => {
    setCurrentFrame(frame);
    // Pause when user grabs timeline (allows precise frame selection)
    if (isPlaying) {
      setIsPlaying(false);
    }
  }, [isPlaying]);

  // Auto-play on open - start from cropStart and load saved project
  useEffect(() => {
    if (visible) {
      // Try to load saved project first
      loadFramerProject().then((loaded) => {
        if (!loaded) {
          // No saved project, start fresh
        }
        // Only set frame to cropStart on FIRST open, not every time cropStart changes
        setCurrentFrame(cropStart);
        setIsPlaying(true);
      });
    }
  }, [visible, loadFramerProject]); // Removed cropStart to prevent jumping when dragging handles

  // Handle crop range change (animator.ts lines 1642-1649)
  const handleCropChange = useCallback((start: number, end: number) => {

    // TOPIC CHALLENGE: Lock crop end at 90 during challenge
    if (activeChallenge) {
      if (end !== 90) {
        end = 90; // Force end to stay at 90
      }
      // Still allow start handle to move
    }

    // Store old values for comparison
    const oldStart = cropStart;
    const oldEnd = cropEnd;

    setCropStart(start);
    setCropEnd(end);

    // Only adjust currentFrame if it's truly outside the NEW range
    // AND if we're not just dragging the handles (allow manual positioning)
    setCurrentFrame(prev => {
      // If moving the start handle forward (trimming left), don't force jump
      if (start > oldStart && prev >= start && prev < end) {
        return prev; // Keep current position if it's now within range
      }

      // If moving the end handle backward (trimming right), don't force jump
      if (end < oldEnd && prev >= start && prev < end) {
        return prev; // Keep current position if it's now within range
      }

      // Only adjust if truly outside the crop range
      if (prev < start) {
        return start;
      }
      if (prev >= end) {
        return end - 1;
      }

      return prev;
    });
  }, [cropStart, cropEnd, activeChallenge]);

  // Auto-save frames to storage
  const saveFramerProject = useCallback(async () => {
    try {
      const project = {
        frames: framesRef.current,
        frameCount,
        cropStart,
        cropEnd,
        videoUri,
        videoStartTime,
        videoMetadata,
        videoCropScale,
        videoCropOffsetX,
        videoCropOffsetY,
        backgroundImageUri,
        importedBackgroundStrokes,
        // Save emoji planes data
        emojiPlanes,
        savedAt: new Date().toISOString()
      };
      await AsyncStorage.setItem(FRAMER_STORAGE_KEY, JSON.stringify(project));
      return true;
    } catch (error) {
      console.error('[FRAMER] Failed to save project:', error);
      return false;
    }
  }, [frameCount, cropStart, cropEnd, videoUri, videoStartTime, videoMetadata, videoCropScale, videoCropOffsetX, videoCropOffsetY, backgroundImageUri, importedBackgroundStrokes, emojiPlanes]);

  // Load saved project
  const loadFramerProject = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(FRAMER_STORAGE_KEY);
      if (stored) {
        const project = JSON.parse(stored);
        framesRef.current = project.frames;
        setFrameCount(project.frameCount);
        setCropStart(project.cropStart);
        setCropEnd(project.cropEnd);

        // Restore video URI and metadata if they exist
        if (project.videoUri) {
          setVideoUri(project.videoUri);
          setVideoStartTime(project.videoStartTime || 0);
        }
        if (project.videoMetadata) {
          setVideoMetadata(project.videoMetadata);
        }

        // Restore video crop settings if they exist
        if (typeof project.videoCropScale === 'number') {
          setVideoCropScale(project.videoCropScale);
        }
        if (typeof project.videoCropOffsetX === 'number') {
          setVideoCropOffsetX(project.videoCropOffsetX);
        }
        if (typeof project.videoCropOffsetY === 'number') {
          setVideoCropOffsetY(project.videoCropOffsetY);
        }

        // Restore backgrounds if they exist
        if (project.backgroundImageUri) {
          setBackgroundImageUri(project.backgroundImageUri);
        }
        if (project.importedBackgroundStrokes && Array.isArray(project.importedBackgroundStrokes)) {
          setImportedBackgroundStrokes(project.importedBackgroundStrokes);
        }

        // Restore emoji planes if they exist
        if (project.emojiPlanes && Array.isArray(project.emojiPlanes)) {
          setEmojiPlanes(project.emojiPlanes);
          emojiPlanesRef.current = project.emojiPlanes;
          // Restore next z-index from highest plane
          const maxZIndex = project.emojiPlanes.reduce((max: number, plane: EmojiPlane) => Math.max(max, plane.zIndex), 0);
          nextZIndexRef.current = maxZIndex + 1;
        }

        scheduleRender();
        return true;
      }
    } catch (error) {
      console.error('[FRAMER] Failed to load project:', error);
    }
    return false;
  }, [scheduleRender]);

  // Load all saved slots from storage
  const loadSavedSlots = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(FRAMER_SAVED_SLOTS_KEY);
      if (stored) {
        const slots = JSON.parse(stored);
        setSavedSlots(slots);
        return slots;
      }
      setSavedSlots([]);
      return [];
    } catch (error) {
      console.error('[FRAMER SLOTS] Failed to load slots:', error);
      setSavedSlots([]);
      return [];
    }
  }, []);

  // Save ALL frames in selected crop range (separate from project)
  const saveSingleFrames = useCallback(async () => {

    try {

      // Validate frames exist
      if (!framesRef.current) {
        console.error('[FRAMER SINGLE] ❌ framesRef.current is null or undefined');
        CustomOverlayHelper.alert('❌ Error', 'No frames to save - framesRef is null');
        return false;
      }

      // Validate crop range is valid
      if (typeof cropStart !== 'number' || typeof cropEnd !== 'number') {
        console.error('[FRAMER SINGLE] ❌ cropStart or cropEnd is not a number:', { cropStart, cropEnd });
        CustomOverlayHelper.alert('❌ Error', 'Invalid crop range - not numbers');
        return false;
      }

      if (cropStart < 0 || cropEnd > framesRef.current.length || cropStart >= cropEnd) {
        console.error('[FRAMER SINGLE] ❌ cropStart/cropEnd out of bounds:', {
          cropStart,
          cropEnd,
          framesLength: framesRef.current.length
        });
        CustomOverlayHelper.alert('❌ Error', `Invalid crop range: ${cropStart}-${cropEnd} (total: ${framesRef.current.length})`);
        return false;
      }

      // Save ONLY frames in the selected crop range
      const croppedFrames = framesRef.current.slice(cropStart, cropEnd);

      // Validate frames
      if (!croppedFrames || croppedFrames.length === 0) {
        console.error('[FRAMER SINGLE] ❌ No cropped frames:', { cropStart, cropEnd, total: framesRef.current.length });
        CustomOverlayHelper.alert('❌ Error', 'No frames selected to save');
        return false;
      }

      const totalStamps = croppedFrames.reduce((sum, f) => sum + (f?.stamps?.length || 0), 0);

      // Generate unique ID and timestamp name
      const slotId = `slot_${Date.now()}`;
      const defaultName = `Frames ${cropStart}-${cropEnd} (${new Date().toLocaleTimeString()})`;


      // Prompt user for custom name using native Alert.prompt
      return new Promise<boolean>((resolve) => {
        try {
          const { Alert } = require('react-native');

          Alert.prompt(
            '💾 Save Frames',
            `${croppedFrames.length} frames (${totalStamps} stamps)\n\nEnter a name for this save:`,
            [
              {
                text: 'Cancel',
                onPress: () => {
                  resolve(false);
                },
                style: 'cancel'
              },
              {
                text: 'Use Timestamp',
                onPress: () => {
                  completeSave(slotId, defaultName, croppedFrames, totalStamps)
                    .then(() => {
                      resolve(true);
                    })
                    .catch((error) => {
                      console.error('[FRAMER SINGLE] Error in timestamp save:', error);
                      setIsSavingAnimation(false);
                      setSaveAnimationStatus('');
                      CustomOverlayHelper.alert('❌ Save Failed', `${error instanceof Error ? error.message : 'Unknown error'}`);
                      resolve(false);
                    });
                }
              },
              {
                text: 'Save',
                onPress: (inputValue: string) => {
                  const finalName = inputValue && inputValue.trim() ? inputValue.trim() : defaultName;
                  completeSave(slotId, finalName, croppedFrames, totalStamps)
                    .then(() => {
                      resolve(true);
                    })
                    .catch((error) => {
                      console.error('[FRAMER SINGLE] Error in custom save:', error);
                      setIsSavingAnimation(false);
                      setSaveAnimationStatus('');
                      CustomOverlayHelper.alert('❌ Save Failed', `${error instanceof Error ? error.message : 'Unknown error'}`);
                      resolve(false);
                    });
                }
              }
            ],
            'plain-text',
            defaultName
          );
        } catch (promptError) {
          console.error('[FRAMER SINGLE] Error showing prompt:', promptError);
          resolve(false);
        }
      });

      async function completeSave(
        slotId: string,
        slotName: string,
        croppedFrames: any[],
        totalStamps: number
      ) {
        try {
          // START LOADING STATE
          setIsSavingAnimation(true);
          setSaveAnimationStatus('Generating previews...');

          // Generate preview snapshot of first frame
          let previewUri: string | undefined;
          let miniPreviewVideoUri: string | undefined;
          try {
            const tempCurrentFrame = currentFrame;
            setCurrentFrame(cropStart);
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait for render

            const viewShot = frameExportViewRef.current;
            if (viewShot) {
              const { captureRef } = await import('react-native-view-shot');

              // Generate full preview
              previewUri = await captureRef(viewShot, {
                format: 'png',
                quality: 0.5,
                result: 'data-uri'
              });

              // Generate 128x128 mini video preview (animated MOV for autoplay)
              try {
                // ⚠️ MEMORY OPTIMIZATION: Sample only 4 frames (not 8) to prevent memory crash on large animations
                const previewFrameIndices: number[] = [];
                const maxPreviewFrames = 4; // Reduced from 8 to 4 for memory safety
                const frameStep = Math.max(1, Math.floor((cropEnd - cropStart) / maxPreviewFrames));
                for (let i = cropStart; i < cropEnd; i += frameStep) {
                  previewFrameIndices.push(i);
                }


                // Capture each sampled frame as image
                const frameImages: string[] = [];
                for (let i = 0; i < previewFrameIndices.length; i++) {
                  try {
                    setCurrentFrame(previewFrameIndices[i]);
                    // ⚠️ CRITICAL: Wait longer between captures (300ms) to allow GC and memory cleanup
                    await new Promise(resolve => setTimeout(resolve, 300));


                    let frameImage = await captureRef(viewShot, {
                      format: 'png',
                      quality: 0.2, // ⚠️ REDUCED from 0.3 to 0.2 for lower memory footprint
                      width: 128,
                      height: 128,
                      result: 'data-uri'
                    });

                    if (frameImage) {
                      frameImages.push(frameImage);
                      // ⚠️ Force cleanup after each frame to free memory
                      frameImage = null; // explicitly null the image to help GC
                    } else {
                      console.warn(`[FRAMER SINGLE] ⚠️ Frame ${i + 1} capture returned null`);
                    }
                  } catch (frameError) {
                    console.warn(`[FRAMER SINGLE] ⚠️ Frame ${i + 1} capture failed:`, frameError);
                    // Continue with next frame instead of failing
                  }
                }

                // Generate mini MOV using native exporter
                if (frameImages.length > 0) {
                  try {
                    const { exportMp4FromFrames } = await import('../native/exporter');
                    const FileSystem = require('expo-file-system');
                    const tempDir = FileSystem.cacheDirectory;
                    const miniVideoPath = `${tempDir}mini_preview_${Date.now()}.mov`;


                    // ✅ CRITICAL FIX: Convert base64 data URIs to actual PNG files
                    // The native exporter expects file paths, not data URIs
                    const frameFilePaths: string[] = [];
                    for (let i = 0; i < frameImages.length; i++) {
                      const dataUri = frameImages[i];
                      if (!dataUri || !dataUri.startsWith('data:')) {
                        console.warn(`[FRAMER SINGLE] ⚠️ Frame ${i} is not a valid data URI, skipping`);
                        continue;
                      }

                      try {
                        // Extract base64 data from data URI
                        const base64Data = dataUri.split(',')[1];
                        if (!base64Data) {
                          console.warn(`[FRAMER SINGLE] ⚠️ Frame ${i} has no base64 data`);
                          continue;
                        }

                        // Write to temp file using modern FileSystem API
                        const frameFilePath = `${tempDir}mini_frame_${Date.now()}_${i}.png`;
                        // Use FileSystem.writeAsStringAsync with proper encoding (works with newer expo-file-system)
                        // Fallback to alternative method if deprecated
                        try {
                          if (FileSystem.writeAsStringAsync) {
                            await FileSystem.writeAsStringAsync(frameFilePath, base64Data, {
                              encoding: 'base64',
                            });
                          } else if (FileSystem.writeBytesAsync) {
                            // Convert base64 to bytes if needed
                            const bytes = Buffer.from(base64Data, 'base64');
                            await FileSystem.writeBytesAsync(frameFilePath, bytes);
                          }
                        } catch (fallbackError) {
                          // If modern APIs fail, try legacy
                          if (FileSystem.documentDirectory) {
                            await FileSystem.writeAsStringAsync(frameFilePath, base64Data, {
                              encoding: FileSystem.EncodingType?.Base64 || 'base64',
                            });
                          } else {
                            throw fallbackError;
                          }
                        }
                        frameFilePaths.push(frameFilePath);
                      } catch (frameFileError) {
                        console.warn(`[FRAMER SINGLE] ⚠️ Failed to write frame ${i}:`, frameFileError);
                      }
                    }

                    if (frameFilePaths.length === 0) {
                      throw new Error('No valid frame files were created');
                    }


                    await exportMp4FromFrames(
                      frameFilePaths,
                      miniVideoPath,
                      {
                        width: 128,
                        height: 128,
                        fps: 10, // Low FPS for small file size
                      }
                    );

                    miniPreviewVideoUri = miniVideoPath;
                    setMiniPreviewVideoUri(miniVideoPath);  // 🎬 Update state for project save

                    // Cleanup temp frame files
                    try {
                      for (const framePath of frameFilePaths) {
                        await FileSystem.deleteAsync(framePath, { idempotent: true });
                      }
                    } catch (cleanupError) {
                      console.warn('[FRAMER SINGLE] ⚠️ Failed to cleanup temp frame files:', cleanupError);
                    }
                  } catch (videoError) {
                    console.warn('[FRAMER SINGLE] ⚠️ Mini video generation failed (will use PNG):', videoError);
                  }
                }
              } catch (miniError) {
                console.warn('[FRAMER SINGLE] ⚠️ Failed to create mini preview:', miniError);
              }
            }
            setCurrentFrame(tempCurrentFrame);
          } catch (previewError) {
            console.warn('[FRAMER SINGLE] ❌ Failed to create preview:', previewError);
          }

          // Create slot metadata (will be updated with miniPreviewVideoUri later if available)
          setSaveAnimationStatus('Saving frames to storage...');
          setSaveAnimationLoaderMessage('📝 Saving frames...');
          let slotMetadata = {
            id: slotId,
            name: slotName,
            frameCount: croppedFrames.length,
            totalStamps,
            cropRange: { start: cropStart, end: cropEnd },
            savedAt: new Date().toISOString(),
            previewUri,
            miniPreviewVideoUri: miniPreviewVideoUri || undefined // 🎬 Will be updated if video was generated
          };

          // ✅ CRITICAL FIX: Update metadata if miniPreviewVideoUri was successfully generated
          if (miniPreviewVideoUri) {
            slotMetadata.miniPreviewVideoUri = miniPreviewVideoUri;
          } else {
            console.warn('[FRAMER SINGLE] ⚠️ No mini preview video URI - will save without video');
          }

          // Save frame data separately with slot ID + ALL background data
          const slotData = {
            frames: croppedFrames.map((frame, index) => ({
              index: cropStart + index,
              stamps: frame?.stamps || [],
              stampCount: frame?.stamps?.length || 0
            })),
            // Background data
            backgroundImage: backgroundImageUri || null,
            importedBackgroundStrokes: importedBackgroundStrokes || [],
            videoBackground: videoUri ? {
              uri: videoUri,
              startTime: videoStartTime || 0,
              metadata: videoMetadata || null,
              cropScale: videoCropScale || 1.0,
              cropOffsetX: videoCropOffsetX || 0,
              cropOffsetY: videoCropOffsetY || 0
            } : null,
            // Settings
            fps: fps || 30,
            strokeLength: strokeLength || 5,
            loop: loop !== undefined ? loop : true,
            ...slotMetadata
          };

          // Load existing slots list
          const slots = await loadSavedSlots();

          // Add new slot to list (max 10 slots) - WITH updated metadata including miniPreviewVideoUri
          const updatedSlots = [slotMetadata, ...slots].slice(0, 10);

          // Save updated slots list with miniPreviewVideoUri included
          await AsyncStorage.setItem(FRAMER_SAVED_SLOTS_KEY, JSON.stringify(updatedSlots));

          // Save slot data
          await AsyncStorage.setItem(`${FRAMER_SAVED_SLOTS_KEY}_${slotId}`, JSON.stringify(slotData));


          // ✅ CRITICAL FIX: Update @framer_persistent_data with miniPreviewVideoUri for portfolio save
          // When ExportScreen reads @framer_persistent_data to save "Save All", it needs the video URI
          try {
            const currentFramerData = await AsyncStorage.getItem('@framer_persistent_data');
            if (currentFramerData) {
              const framerData = JSON.parse(currentFramerData);
              framerData.miniPreviewVideoUri = miniPreviewVideoUri || null;
              await AsyncStorage.setItem('@framer_persistent_data', JSON.stringify(framerData));
            }
          } catch (error) {
            console.warn('[FRAMER SINGLE] ⚠️ Failed to update @framer_persistent_data:', error);
          }

          // ALSO save as project in portfolio (🗂️) using UNIFIED SYSTEM
          setSaveAnimationStatus('Saving to portfolio...');
          setSaveAnimationLoaderMessage('📁 Creating project...');

          try {
            // Create a project from the saved animation frames
            const projectPayload = createProjectPayload({
              strokes: [], // Animation frames don't have strokes
              trace: null,
              brushEmoji: '🎬',
              brushSize: 0,
              brushOpacity: 0,
              brushSpacing: 0,
              brushRotation: 0,
              mirrorX: false,
              mirrorY: false,
              recentEmojis: [],
              // Store the animation frames reference in preview for ExportScreen to find
              preview: previewUri || null
            });

            // Add animation metadata
            const projectData = {
              ...projectPayload,
              frames: croppedFrames, // Store animation frames
              frameCount: croppedFrames.length,
              isAnimation: true,
              fps: 30,
              miniPreviewVideoUri: miniPreviewVideoUri || undefined,
              framerSlotId: slotId, // Link back to framer slot
              framerSlotName: slotName
            };

            // Save as project with same name
            await saveProject(slotName, projectData);

            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            // Show completion in loader
            setSaveAnimationLoaderMessage('✅ Complete! Opening project...');
            await new Promise(resolve => setTimeout(resolve, 800)); // Show success briefly

            // Refresh slots list
            await loadSavedSlots();

            // BACKUP: Save snapshot of frames for recovery on failure
            try {
              const backupKey = `@framer_frames_backup_${slotName}`;
              const bgData = null;
              const backupData = {
                timestamp: new Date().toISOString(),
                slotName,
                frameCount: framesRef.current.length,
                hasBackground: bgData !== null,
                backgroundUrl: bgData?.url || null,
                backgroundOpacity: bgData?.opacity || 1,
                backgroundScale: bgData?.scale || 1,
                backgroundOffset: bgData?.offset || { x: 0, y: 0 },
              };
              await AsyncStorage.setItem(backupKey, JSON.stringify(backupData));
            } catch (backupError) {
              console.warn('[FRAMER SINGLE] ⚠️ Failed to create backup snapshot:', backupError);
              // Non-critical, don't fail the entire save
            }

            // Signal to open portfolio/ExportScreen with the saved project
            try {
              await AsyncStorage.setItem('@open_export_screen_project', slotName);
            } catch (storageError) {
              console.warn('[FRAMER SINGLE] ⚠️ Failed to set ExportScreen open flag:', storageError);
            }

            // KEEP FRAMER OPEN - Do NOT call onClose()
            // User stays in Framer to see the save succeeded

          } catch (portfolioError) {
            console.warn('[FRAMER SINGLE] ⚠️ Failed to save as portfolio project:', portfolioError);
            // Still show success - animation was saved to Framer slots
          }

          // CLEAR LOADING STATE
          setIsSavingAnimation(false);
          setSaveAnimationStatus('');
          setSaveAnimationLoaderMessage('');
        } catch (error) {
          console.error('[FRAMER SINGLE] Failed to complete save:', error);
          // CLEAR LOADING STATE ON ERROR
          setIsSavingAnimation(false);
          setSaveAnimationStatus('');
          setSaveAnimationLoaderMessage('');
          CustomOverlayHelper.alert('❌ Save Failed', `Could not save frames: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('[FRAMER SINGLE] Failed to save frames:', error);
      // Ensure loading state is cleared on outer error
      setIsSavingAnimation(false);
      setSaveAnimationStatus('');
      setSaveAnimationLoaderMessage('');
      CustomOverlayHelper.alert('❌ Save Failed', `Could not save frames: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }, [cropStart, cropEnd, loadSavedSlots, currentFrame]);

  // Show picker modal to select which saved frames to load
  const loadSingleFrames = useCallback(async () => {
    try {
      const slots = await loadSavedSlots();
      if (slots.length === 0) {
        CustomOverlayHelper.alert('ℹ️ No Saved Frames', 'No saved frames found. Save some frames first!');
        return false;
      }

      // Show picker modal
      setSavedSlotsPickerVisible(true);
      return true;
    } catch (error) {
      console.error('[FRAMER SLOTS] Failed to show picker:', error);
      CustomOverlayHelper.alert('❌ Load Failed', 'Could not load saved frames');
      return false;
    }
  }, [loadSavedSlots]);

  // Load a specific slot by ID
  const loadSlotById = useCallback(async (slotId: string) => {
    try {
      const slotDataStr = await AsyncStorage.getItem(`${FRAMER_SAVED_SLOTS_KEY}_${slotId}`);
      if (!slotDataStr) {
        console.warn('[FRAMER SLOTS] ⚠️ Slot data not found, checking for backup...');
        // Check if backup exists
        const backupKey = `@framer_frames_backup_${slotId}`;
        const backupStr = await AsyncStorage.getItem(backupKey);
        if (backupStr) {
          try {
            const backupData = JSON.parse(backupStr);
            CustomOverlayHelper.alert('⚠️ Recovered from Backup', `Slot data was corrupted. Recovered backup from ${new Date(backupData.timestamp).toLocaleString()}. Frame count: ${backupData.frameCount}`);
          } catch (parseError) {
            console.warn('[FRAMER SLOTS] ⚠️ Backup data is also corrupted:', parseError);
          }
        }
        CustomOverlayHelper.alert('❌ Error', 'Saved frames not found');
        return false;
      }

      let slotData;
      try {
        slotData = JSON.parse(slotDataStr);
      } catch (parseError) {
        console.error('[FRAMER SLOTS] ❌ Failed to parse slot data:', parseError);
        // Try to recover from backup
        const backupKey = `@framer_frames_backup_${slotId}`;
        const backupStr = await AsyncStorage.getItem(backupKey);
        if (backupStr) {
          try {
            const backupData = JSON.parse(backupStr);
            CustomOverlayHelper.alert('⚠️ Recovery Needed', `Slot data was corrupted. A backup snapshot exists from ${new Date(backupData.timestamp).toLocaleString()} with ${backupData.frameCount} frames. You may need to re-import to fully restore.`);
            return false;
          } catch (backupParseError) {
            console.warn('[FRAMER SLOTS] ⚠️ Backup also corrupted:', backupParseError);
          }
        }
        CustomOverlayHelper.alert('❌ Error', 'Could not parse saved frames data');
        return false;
      }


      // Safety check: ensure frames array exists and is valid
      if (!slotData.frames || !Array.isArray(slotData.frames) || slotData.frames.length === 0) {
        console.warn('[FRAMER SLOTS] ⚠️ No frames in slot data or invalid format');
        // Try to recover from backup for this case too
        const backupKey = `@framer_frames_backup_${slotId}`;
        const backupStr = await AsyncStorage.getItem(backupKey);
        if (backupStr) {
          try {
            const backupData = JSON.parse(backupStr);
            CustomOverlayHelper.alert('⚠️ Recovery Info', `Backup available: ${backupData.frameCount} frames saved on ${new Date(backupData.timestamp).toLocaleString()}`);
          } catch (e) {
            console.warn('[FRAMER SLOTS] ⚠️ Backup check failed:', e);
          }
        }
        CustomOverlayHelper.alert('❌ Error', 'No frames found in saved data');
        return false;
      }

      // Restore ALL frames from saved data
      const loadedFrames = slotData.frames.map((frameData: any) => {
        // Ensure frame data has stamps array
        const stamps = Array.isArray(frameData.stamps) ? frameData.stamps : [];
        return { stamps };
      });

      framesRef.current = loadedFrames;
      setFrameCount(loadedFrames.length);
      setCropStart(0);
      setCropEnd(loadedFrames.length);
      setCurrentFrame(0);

      // Restore background data
      if (slotData.backgroundImage) {
        setBackgroundImageUri(slotData.backgroundImage);
      } else {
        setBackgroundImageUri(null);
      }

      if (slotData.importedBackgroundStrokes && Array.isArray(slotData.importedBackgroundStrokes)) {
        // ✅ CRITICAL: Validate strokes have required properties before restoring
        const validatedStrokes = slotData.importedBackgroundStrokes.filter((stroke: any) => {
          if (!stroke || typeof stroke !== 'object') {
            return false;
          }
          // Ensure stroke has points array and emoji property
          if (!Array.isArray(stroke.points) || !stroke.emoji) {
            return false;
          }
          return true;
        });

        setImportedBackgroundStrokes(validatedStrokes);
        if (validatedStrokes.length > 0) {
        } else {
          console.warn('[FRAMER SLOTS] ⚠️ No valid background strokes found after validation');
        }
      } else {
        setImportedBackgroundStrokes([]);
      }

      if (slotData.videoBackground && typeof slotData.videoBackground === 'object' && slotData.videoBackground.uri) {
        try {
          setVideoUri(slotData.videoBackground.uri);
          setVideoStartTime(slotData.videoBackground.startTime || 0);
          setVideoMetadata(slotData.videoBackground.metadata || null);
          setVideoCropScale(slotData.videoBackground.cropScale || 1.0);
          setVideoCropOffsetX(slotData.videoBackground.cropOffsetX || 0);
          setVideoCropOffsetY(slotData.videoBackground.cropOffsetY || 0);
          setVideoReady(false); // Will be set to true when video loads
        } catch (videoError) {
          console.warn('[FRAMER SLOTS] ⚠️ Error restoring video:', videoError);
          setVideoUri(null);
          setVideoStartTime(0);
          setVideoMetadata(null);
          setVideoReady(false);
        }
      } else {
        setVideoUri(null);
        setVideoStartTime(0);
        setVideoMetadata(null);
        setVideoReady(false);
      }

      // Restore settings
      if (slotData.fps) {
        setFps(slotData.fps);
      }
      if (slotData.strokeLength) {
        setStrokeLength(slotData.strokeLength);
      }
      if (typeof slotData.loop === 'boolean') {
        setLoop(slotData.loop);
      }

      scheduleRender();

      // Track the currently loaded project ID for future overwrite saves
      setCurrentLoadedSlotId(slotId);


      // CLEANUP: Remove old backup now that we've successfully loaded
      try {
        const backupKey = `@framer_frames_backup_${slotId}`;
        await AsyncStorage.removeItem(backupKey);
      } catch (cleanupError) {
        console.warn('[FRAMER SLOTS] ⚠️ Failed to cleanup backup:', cleanupError);
        // Non-critical, don't fail the load
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Close picker modal and settings modal
      setSavedSlotsPickerVisible(false);
      setSettingsVisible(false);

      return true;
    } catch (error) {
      console.error('[FRAMER SLOTS] Failed to load slot:', error);
      CustomOverlayHelper.alert('❌ Load Failed', 'Could not load saved frames');
      return false;
    }
  }, [scheduleRender]);

  // Load from Portfolio Projects (UNIFIED SYSTEM)
  const loadFromPortfolio = useCallback(async (projectName: string) => {
    try {
      setLoadingPortfolioProjects(true);

      // Load using unified load function
      const payload = await loadProjectUnified(projectName, 'framer');
      if (!payload || !payload.framerFrames) {
        CustomOverlayHelper.alert('❌ Error', 'No Framer data found in this project');
        return false;
      }

      // Extract framer data
      const slotData = payload.framerFrames;

      // Safety check: ensure frames array exists and is valid
      if (!slotData.frames || !Array.isArray(slotData.frames) || slotData.frames.length === 0) {
        console.warn('[FRAMER PORTFOLIO] ⚠️ No frames in portfolio project');
        CustomOverlayHelper.alert('❌ Error', 'No frames found in this project');
        return false;
      }

      // ✅ CRITICAL FIX: CLEAR ALL OLD STATE BEFORE RESTORING
      setImportedBackgroundStrokes([]);
      setBackgroundImageUri(null);
      setVideoUri(null);
      setVideoStartTime(0);
      setVideoMetadata(null);
      setVideoCropScale(1.0);
      setVideoCropOffsetX(0);
      setVideoCropOffsetY(0);
      setVideoReady(false);

      // Restore frames
      const loadedFrames = slotData.frames.map((frameData: any) => {
        const stamps = Array.isArray(frameData.stamps) ? frameData.stamps : [];
        return { stamps };
      });

      framesRef.current = loadedFrames;
      setFrameCount(loadedFrames.length);
      setCropStart(0);
      setCropEnd(loadedFrames.length);
      setCurrentFrame(0);
      setFps(slotData.fps || 30);

      // Restore background if present
      if (slotData.backgroundImage) {
        setBackgroundImageUri(slotData.backgroundImage);
      }

      // Restore video if present
      if (slotData.videoBackground && typeof slotData.videoBackground === 'object' && slotData.videoBackground.uri) {
        try {
          setVideoUri(slotData.videoBackground.uri);
          setVideoStartTime(slotData.videoBackground.startTime || 0);
          setVideoMetadata(slotData.videoBackground.metadata || null);
          setVideoCropScale(slotData.videoBackground.cropScale || 1.0);
          setVideoCropOffsetX(slotData.videoBackground.cropOffsetX || 0);
          setVideoCropOffsetY(slotData.videoBackground.cropOffsetY || 0);
          setVideoReady(false);
        } catch (videoError) {
          console.warn('[FRAMER PORTFOLIO] ⚠️ Error restoring video:', videoError);
          setVideoUri(null);
        }
      }

      // ✅ CRITICAL: Restore workspace strokes (background/main workspace strokes)
      // Try multiple sources: slotData.importedBackgroundStrokes, payload.strokes, or payload.workspaceStrokes
      let workspaceStrokesToRestore: any[] = [];

      if (slotData.importedBackgroundStrokes && Array.isArray(slotData.importedBackgroundStrokes) && slotData.importedBackgroundStrokes.length > 0) {
        workspaceStrokesToRestore = slotData.importedBackgroundStrokes;
      } else if (payload.strokes && Array.isArray(payload.strokes) && payload.strokes.length > 0) {
        workspaceStrokesToRestore = payload.strokes;
      } else if ((payload as any).workspaceStrokes && Array.isArray((payload as any).workspaceStrokes) && (payload as any).workspaceStrokes.length > 0) {
        workspaceStrokesToRestore = (payload as any).workspaceStrokes;
      }

      if (workspaceStrokesToRestore.length > 0) {
        try {
          // ✅ CRITICAL: Validate strokes have required properties before restoring
          const validatedStrokes = workspaceStrokesToRestore.filter((stroke: any) => {
            // Check if stroke has required properties
            if (!stroke || typeof stroke !== 'object') {
              console.warn('[FRAMER PORTFOLIO] ⚠️ Skipping invalid stroke (not an object)');
              return false;
            }

            // Ensure stroke has points array
            if (!Array.isArray(stroke.points)) {
              console.warn('[FRAMER PORTFOLIO] ⚠️ Skipping stroke with missing/invalid points array');
              return false;
            }

            // Ensure stroke has required emoji property
            if (!stroke.emoji) {
              console.warn('[FRAMER PORTFOLIO] ⚠️ Skipping stroke with missing emoji');
              return false;
            }

            return true;
          });

          if (validatedStrokes.length > 0) {
            setImportedBackgroundStrokes(validatedStrokes);
          } else {
            console.warn('[FRAMER PORTFOLIO] ⚠️ No valid strokes found after validation');
            setImportedBackgroundStrokes([]);
          }
        } catch (strokeError) {
          console.warn('[FRAMER PORTFOLIO] ⚠️ Error restoring workspace strokes:', strokeError);
          setImportedBackgroundStrokes([]);
        }
      } else {
        setImportedBackgroundStrokes([]);
      }

      // Restore settings
      if (slotData.fps) {
        setFps(slotData.fps);
      }

      if (slotData.loop !== undefined) {
        setLoop(slotData.loop);
      }

      if (slotData.strokeLength !== undefined) {
        setStrokeLength(slotData.strokeLength);
      }

      scheduleRender();
      setPortfolioPickerVisible(false);
      setSettingsVisible(false);

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      CustomOverlayHelper.alert('✅ Loaded from Portfolio', `Loaded ${loadedFrames.length} frames from "${projectName}"`);

      return true;
    } catch (error) {
      console.error('[FRAMER PORTFOLIO] Failed to load from portfolio:', error);
      CustomOverlayHelper.alert('❌ Load Failed', 'Could not load project from portfolio');
      return false;
    } finally {
      setLoadingPortfolioProjects(false);
    }
  }, [scheduleRender]);

  // Show portfolio projects picker
  const showPortfolioProjects = useCallback(async () => {
    try {
      setLoadingPortfolioProjects(true);

      // Get all projects
      const projects = await listProjects();

      // Filter to only projects with framer data and extract preview URIs
      const framerProjects: Array<{name: string, preview?: string, miniVideo?: string}> = [];
      for (const projectName of projects) {
        try {
          const payload = await loadProjectUnified(projectName, 'framer');
          if (payload?.framerFrames?.frames?.length) {
            // Extract preview URIs from payload (fallback for older projects)
            const preview = payload.preview || (payload.framerFrames?.previewUri);
            // Extract mini video preview (new projects saved with Save Animation)
            const miniVideo = payload.framerFrames?.miniPreviewVideoUri;

            framerProjects.push({
              name: projectName,
              preview,
              miniVideo
            });

          }
        } catch (e) {
          // Skip projects that fail to load
          console.warn('[FRAMER PORTFOLIO] Could not check project:', projectName);
        }
      }


      if (framerProjects.length === 0) {
        CustomOverlayHelper.alert('No Framer Projects', 'No saved projects with Framer data found in portfolio');
        return;
      }

      setPortfolioProjects(framerProjects);
      setPortfolioPickerVisible(true);
    } catch (error) {
      console.error('[FRAMER PORTFOLIO] Failed to list projects:', error);
      CustomOverlayHelper.alert('❌ Error', 'Could not load projects list');
    } finally {
      setLoadingPortfolioProjects(false);
    }
  }, []);

  // FIX #4: Resume the most recent saved session
  const resumeLastSession = useCallback(async () => {
    try {
      const slots = await loadSavedSlots();
      if (!slots || slots.length === 0) {
        CustomOverlayHelper.alert('No Sessions', 'No saved sessions found. Start a new session to auto-save.');
        return;
      }

      // ALWAYS load slots[0] which is the MOST RECENT (newest first)
      const latestSlot = slots[0];

      await loadSlotById(latestSlot.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('[FRAMER] Failed to resume session:', error);
      CustomOverlayHelper.alert('Error', 'Failed to load last session');
    }
  }, [loadSavedSlots, loadSlotById]);

  // Delete a slot
  const deleteSlot = useCallback(async (slotId: string) => {
    try {
      // Remove from list
      const slots = savedSlots.filter(s => s.id !== slotId);
      await AsyncStorage.setItem(FRAMER_SAVED_SLOTS_KEY, JSON.stringify(slots));

      // Remove slot data
      await AsyncStorage.removeItem(`${FRAMER_SAVED_SLOTS_KEY}_${slotId}`);

      // Refresh list
      await loadSavedSlots();

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (error) {
      console.error('[FRAMER SLOTS] Failed to delete slot:', error);
      return false;
    }
  }, [savedSlots, loadSavedSlots]);

  // Auto-save project after MOV export (silent, no prompts)
  const autoSaveProject = useCallback(async (exportedVideoPreviewUri?: string): Promise<boolean> => {
    try {

      // Save ONLY frames in the selected crop range
      const croppedFrames = framesRef.current.slice(cropStart, cropEnd);
      const totalStamps = croppedFrames.reduce((sum, f) => sum + f.stamps.length, 0);

      // Generate unique ID and timestamp name
      const slotId = `slot_${Date.now()}`;
      const defaultName = `Export ${new Date().toLocaleString()}`;

      // Use exported video preview as project thumbnail if available
      const previewUri = exportedVideoPreviewUri;

      // Create slot metadata
      const slotMetadata = {
        id: slotId,
        name: defaultName,
        frameCount: croppedFrames.length,
        totalStamps,
        cropRange: { start: cropStart, end: cropEnd },
        savedAt: new Date().toISOString(),
        previewUri
      };

      // Save frame data separately with slot ID + ALL background data
      const slotData = {
        frames: croppedFrames.map((frame, index) => ({
          index: cropStart + index,
          stamps: frame.stamps,
          stampCount: frame.stamps.length
        })),
        // Background data
        backgroundImage: backgroundImageUri,
        importedBackgroundStrokes,
        videoBackground: videoUri ? {
          uri: videoUri,
          startTime: videoStartTime,
          metadata: videoMetadata,
          cropScale: videoCropScale,
          cropOffsetX: videoCropOffsetX,
          cropOffsetY: videoCropOffsetY
        } : null,
        // Settings
        fps,
        strokeLength,
        loop,
        ...slotMetadata
      };

      // Load existing slots list
      const slots = await loadSavedSlots();

      // Add new slot to list (max 20 slots for auto-saves)
      const updatedSlots = [slotMetadata, ...slots].slice(0, 20);

      // Save updated slots list
      await AsyncStorage.setItem(FRAMER_SAVED_SLOTS_KEY, JSON.stringify(updatedSlots));

      // Save slot data
      await AsyncStorage.setItem(`${FRAMER_SAVED_SLOTS_KEY}_${slotId}`, JSON.stringify(slotData));


      // Refresh slots list
      await loadSavedSlots();

      return true;
    } catch (error) {
      console.error('[FRAMER AUTO-SAVE] Failed to auto-save:', error);
      return false;
    }
  }, [cropStart, cropEnd, loadSavedSlots, backgroundImageUri, importedBackgroundStrokes, videoUri, videoStartTime, videoMetadata, videoCropScale, videoCropOffsetX, videoCropOffsetY, fps, strokeLength, loop]);

  // Overwrite existing project (update loaded slot)
  const overwriteProject = useCallback(async (slotId: string, exportedVideoPreviewUri?: string): Promise<boolean> => {
    try {

      // Save ONLY frames in the selected crop range
      const croppedFrames = framesRef.current.slice(cropStart, cropEnd);
      const totalStamps = croppedFrames.reduce((sum, f) => sum + f.stamps.length, 0);

      // Get existing slot metadata to preserve name
      const slots = await loadSavedSlots();
      const existingSlot = slots.find(s => s.id === slotId);
      const slotName = existingSlot?.name || `Updated ${new Date().toLocaleString()}`;

      // Use exported video preview as project thumbnail if available, otherwise keep existing
      const previewUri = exportedVideoPreviewUri || existingSlot?.previewUri;

      // Update slot metadata
      const slotMetadata = {
        id: slotId, // Keep same ID
        name: slotName,
        frameCount: croppedFrames.length,
        totalStamps,
        cropRange: { start: cropStart, end: cropEnd },
        savedAt: new Date().toISOString(), // Update timestamp
        previewUri
      };

      // Save frame data with same slot ID
      const slotData = {
        frames: croppedFrames.map((frame, index) => ({
          index: cropStart + index,
          stamps: frame.stamps,
          stampCount: frame.stamps.length
        })),
        // Background data
        backgroundImage: backgroundImageUri,
        importedBackgroundStrokes,
        videoBackground: videoUri ? {
          uri: videoUri,
          startTime: videoStartTime,
          metadata: videoMetadata,
          cropScale: videoCropScale,
          cropOffsetX: videoCropOffsetX,
          cropOffsetY: videoCropOffsetY
        } : null,
        // Settings
        fps,
        strokeLength,
        loop,
        ...slotMetadata
      };

      // Update slots list (replace existing slot with updated metadata)
      const updatedSlots = slots.map(s => s.id === slotId ? slotMetadata : s);

      // Save updated slots list
      await AsyncStorage.setItem(FRAMER_SAVED_SLOTS_KEY, JSON.stringify(updatedSlots));

      // Overwrite slot data
      await AsyncStorage.setItem(`${FRAMER_SAVED_SLOTS_KEY}_${slotId}`, JSON.stringify(slotData));


      // Refresh slots list
      await loadSavedSlots();

      return true;
    } catch (error) {
      console.error('[FRAMER OVERWRITE] Failed to overwrite project:', error);
      return false;
    }
  }, [cropStart, cropEnd, loadSavedSlots, backgroundImageUri, importedBackgroundStrokes, videoUri, videoStartTime, videoMetadata, videoCropScale, videoCropOffsetX, videoCropOffsetY, fps, strokeLength, loop]);

  // Import background image from device
  const handleImportBackgroundImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 1
      });

      if (!result.canceled && result.assets[0]) {
        setBackgroundImageUri(result.assets[0].uri);
        // Clear imported strokes when importing an image
        setImportedBackgroundStrokes([]);
        // Clear video background when importing an image
        setVideoUri(null);
        setVideoStartTime(0);
        setVideoMetadata(null);
        setVideoReady(false);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        // Close settings after successful import
        setSettingsVisible(false);
      }
    } catch (error) {
      console.error('[FRAMER] Failed to import background image:', error);
      CustomOverlayHelper.alert('Error', 'Failed to import background image');
    }
  }, []);

  // Import video as background - COMPLETELY REWRITTEN FOR RELIABILITY
  const handleImportVideo = useCallback(async () => {
    try {

      // Close settings modal FIRST
      setSettingsVisible(false);

      // Wait for settings to close before picking video
      await new Promise(resolve => setTimeout(resolve, 100));

      // Pick video from library (no native cropping - we'll do it in trim overlay)
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false, // We'll handle cropping ourselves
        quality: 1
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const videoUri = result.assets[0].uri;
      const videoDuration = result.assets[0].duration ? result.assets[0].duration / 1000 : 0; // Convert to seconds


      // Check duration limit (max 100 seconds)
      if (videoDuration > 100) {
        CustomOverlayHelper.alert('Video Too Long', `Video is ${videoDuration.toFixed(1)}s. Maximum is 100 seconds (3000 frames).`);
        return;
      }

      // Set ALL video data FIRST (critical!)
      setSelectedVideoUri(videoUri);
      setSelectedVideoDuration(videoDuration);
      setTrimStart(0);
      setTrimEnd(videoDuration);

      // Reset crop to defaults
      setVideoCropScale(1.0);
      setVideoCropOffsetX(0);
      setVideoCropOffsetY(0);

      // CRITICAL: Use double requestAnimationFrame to ensure state is fully set
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVideoTrimModalVisible(true);
        });
      });

    } catch (error) {
      console.error('[FRAMER VIDEO] Failed to pick video:', error);
      CustomOverlayHelper.alert('Error', 'Failed to pick video. Please try again.');
    }
  }, []);

  // Process video with trimming applied
  const handleProcessTrimmedVideo = useCallback(async () => {
    if (!selectedVideoUri) return;

    try {
      setVideoTrimModalVisible(false);

      const trimmedDuration = trimEnd - trimStart;

      // Calculate frame count at current FPS for trimmed duration
      const targetFps = fps;
      const calculatedFrameCount = Math.floor(trimmedDuration * targetFps);

      // Check frame count limit (max 3000 frames)
      if (calculatedFrameCount > 3000) {
        CustomOverlayHelper.alert('Too Many Frames', `Video would generate ${calculatedFrameCount} frames. Maximum is 3000 frames.`);
        return;
      }


      // MEMORY EFFICIENT: Just store video URI and metadata, no frame extraction!
      setVideoUri(selectedVideoUri);
      setVideoStartTime(trimStart);
      setVideoMetadata({
        fps: targetFps,
        duration: trimmedDuration,
        frameCount: calculatedFrameCount
      });

      // Clear other backgrounds
      setBackgroundImageUri(null);
      setImportedBackgroundStrokes([]);

      // Update frame count to match video
      setFrameCount(calculatedFrameCount);

      // Reset to first frame
      setCurrentFrame(0);

      // Update crop range to match new frame count - use FULL video frame count
      setCropStart(0);
      setCropEnd(calculatedFrameCount); // Use video's actual frame count (not limited to 90)

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Close trim modal
      setVideoTrimModalVisible(false);

      // Close settings modal to show the imported video
      setSettingsVisible(false);

      CustomOverlayHelper.alert('Video Imported', `Ready to animate ${calculatedFrameCount} frames at ${targetFps} FPS`);

    } catch (error) {
      console.error('[FRAMER VIDEO] Failed to import video:', error);
      CustomOverlayHelper.alert('Error', 'Failed to import video. Please try again.');
    }
  }, [selectedVideoUri, trimStart, trimEnd, fps]);

  // Load videos from storage
  const loadStorageVideos = useCallback(async () => {
    try {
      setLoadingStorageVideos(true);
      const videos = await getAllVideos();
      setStorageVideos(videos);
    } catch (error) {
      console.error('[FRAMER VIDEO STORAGE] Failed to load videos:', error);
      CustomOverlayHelper.alert('Error', 'Failed to load videos from storage');
    } finally {
      setLoadingStorageVideos(false);
    }
  }, []);

  // Import from video storage - show picker modal
  const handleImportFromVideoStorage = useCallback(async () => {
    // Close settings first, then open video storage picker
    setSettingsVisible(false);

    // Use requestAnimationFrame to ensure settings modal closes before opening storage picker
    requestAnimationFrame(() => {
      setVideoStoragePickerVisible(true);
      void loadStorageVideos();
    });
  }, [loadStorageVideos]);

  // Handle selecting a video from storage - COMPLETELY REWRITTEN
  const handleSelectStorageVideo = useCallback(async (video: VideoMetadata) => {
    try {

      // Use the video's URI and duration
      const videoUri = video.uri;
      const videoDuration = video.duration / 1000; // Convert to seconds


      // Set ALL video data FIRST
      setSelectedVideoUri(videoUri);
      setSelectedVideoDuration(videoDuration);
      setTrimStart(0);
      setTrimEnd(videoDuration);

      // Reset crop to defaults
      setVideoCropScale(1.0);
      setVideoCropOffsetX(0);
      setVideoCropOffsetY(0);

      // Close picker modal FIRST
      setVideoStoragePickerVisible(false);

      // CRITICAL: Use requestAnimationFrame to ensure modal close completes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVideoTrimModalVisible(true);
        });
      });

    } catch (error) {
      console.error('[FRAMER VIDEO STORAGE] Failed to select video:', error);
      CustomOverlayHelper.alert('Error', 'Failed to select video from storage');
    }
  }, []);

  // Import strokes from current workspace
  const handleImportWorkspaceStrokes = useCallback(() => {
    if (backgroundStrokes && backgroundStrokes.length > 0) {
      setImportedBackgroundStrokes(backgroundStrokes);
      // Clear background image when importing strokes
      setBackgroundImageUri(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      CustomOverlayHelper.alert('✅ Imported!', `${backgroundStrokes.length} strokes imported as background`);
    } else {
      CustomOverlayHelper.alert('ℹ️ No Strokes', 'Current workspace has no strokes to import');
    }
  }, [backgroundStrokes]);

  // Remove background (image and strokes)
  const handleRemoveBackground = useCallback(() => {
    // Clear all background types
    setBackgroundImageUri(null);
    setImportedBackgroundStrokes([]);
    setVideoUri(null);
    setVideoStartTime(0);
    setVideoMetadata(null);
    setVideoReady(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  /**
   * Generate a video frame thumbnail at a specific time
   * This is used during export to replace the live Video component
   */
  const generateVideoFrameThumbnail = useCallback(async (frameIndex: number): Promise<string> => {
    if (!videoUri || !videoMetadata) {
      throw new Error('No video loaded');
    }

    try {
      // Calculate the time in seconds for this frame
      const timeInSeconds = videoStartTime + (frameIndex / videoMetadata.fps);
      const timeInMs = timeInSeconds * 1000;


      // Generate thumbnail at exact time
      const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time: timeInMs,
        quality: 1.0
      });

      return uri;
    } catch (error) {
      console.error(`[EXPORT VIDEO] Failed to generate thumbnail for frame ${frameIndex}:`, error);
      throw error;
    }
  }, [videoUri, videoMetadata, videoStartTime]);

  /**
   * Render a single frame to image (background + strokes)
   * Returns base64 data URI
   */
  // ✅ OPTIMIZATION: Cache captureRef import at module level instead of per-frame
  const captureRefRef = useRef<any>(null);
  const initializeCaptureRef = useCallback(async () => {
    if (!captureRefRef.current) {
      const module = await import('react-native-view-shot');
      captureRefRef.current = module.captureRef;
    }
    return captureRefRef.current;
  }, []);

  const renderFrameToImage = useCallback(async (frameIndex: number, quality: number = 1.0): Promise<string> => {
    try {
      // Use ViewShot to capture entire frame including background images
      const viewShot = frameExportViewRef.current;
      if (!viewShot) {
        throw new Error('ViewShot not available');
      }

      // Get frame data
      const frame = framesRef.current[frameIndex];
      if (!frame) {
        throw new Error(`Frame ${frameIndex} not found`);
      }

      // ✅ OPTIMIZATION: Use cached captureRef instead of re-importing each time
      const captureRef = await initializeCaptureRef();
      const uri = await captureRef(viewShot, {
        format: 'png',
        quality: quality, // ✅ Adaptive quality for large exports
        result: 'data-uri',
        width: canvasSize,
        height: canvasSize
      });

      return uri;
    } catch (error) {
      console.error(`[EXPORT] Failed to render frame ${frameIndex}:`, error);

      // FIX #6: Memory error recovery - return blank frame instead of crashing
      const errorMsg = String(error).toLowerCase();
      if (errorMsg.includes('memory') || errorMsg.includes('oom') || errorMsg.includes('out of memory')) {
        console.warn('[EXPORT] ⚠️ Memory error at frame', frameIndex, '- skipping frame with blank PNG');
        // Return blank PNG instead of crashing (allows export to continue)
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      }

      throw error;
    }
  }, [canvasSize, initializeCaptureRef]);

  /**
   * Handle GIF export
   */
  const handleExportGIF = useCallback(async () => {
    try {
      setIsExporting(true);
      setExportProgress(0);
      setExportPreviewFrames([]); // Reset preview frames
      setCurrentPreviewIndex(0);
      exportAbortRef.current = false; // Reset abort flag


      // Verify ViewShot ref is ready
      if (!frameExportViewRef.current) {
        console.error('[EXPORT GIF] ❌ frameExportViewRef is not ready!');
        CustomOverlayHelper.alert('Export Error', 'Export view not ready. Please wait a moment and try again.');
        setIsExporting(false);
        return;
      }

      // Check if export is too large with video background
      const totalFrames = cropEnd - cropStart;
      if (videoUri && totalFrames > 150) {
        CustomOverlayHelper.alert(
          'Large Export with Video',
          `Exporting ${totalFrames} frames with video background may cause memory issues.\n\nRecommendations:\n• Reduce frame range (current: ${totalFrames})\n• Use 'low' quality\n• Export in smaller chunks\n\nContinue anyway?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => { setIsExporting(false); } },
            { text: 'Continue', style: 'default' }
          ]
        );
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Pause playback
      setIsPlaying(false);

      // ALWAYS include backgrounds in export (ignore eye button)
      const originalShowBackground = showBackground;
      setShowBackground(true);

      // Check if ANY background is present (video, snapshot, or image)
      const hasBackground = !!(videoUri || workspaceSnapshotUri || backgroundImageUri);

      // Wait for background to render (longer for video to load and seek)
      const initialWait = videoUri ? 500 : (hasBackground ? 250 : 150);
      await new Promise(resolve => setTimeout(resolve, initialWait));

      // If video, ensure it's ready
      if (videoUri && !videoReady) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Render frames in crop range
      const framesToExport: ExportFrameData[] = [];

      // Start the SMOOTH faked progress bar. The real render loop (captureRef per
      // frame) blocks the JS thread so a true % can't repaint (looked stuck 1-4%
      // then jumped to ~84%). Estimate ~140ms/frame + encode; if the real export
      // finishes sooner it snaps to 100% (quick end).
      console.log(`[FRAMER-EXPORT] render start: ${totalFrames} frames, quality=${exportQuality}, fps=${fps}`);
      startFakeExportProgress(totalFrames * 140 + 1500, 'export');

      // Calculate random max growth (1.5x to 3.5x) based on frame count
      // More frames = higher max growth for dramatic effect (reduced to half intensity)
      const baseMax = 1.5; // 150% minimum (was 300%)
      const frameBonus = Math.min(1.5, totalFrames / 10); // +1x per 10 frames, max +1.5x (was +3x)
      const randomVariation = Math.random() * 0.5; // +0 to +0.5x random (was +1x)
      const maxGrowth = baseMax + frameBonus + randomVariation;
      setExportMaxGrowth(maxGrowth);

      // MEMORY OPTIMIZATION: Process frames in batches to prevent crashes with backgrounds
      // iPad has less memory than iPhone - use smaller batches
      const isIPad = Platform.OS === 'ios' && (Dimensions.get('window').height > 700 || Dimensions.get('window').width > 700);

      // Adaptive batch sizing based on device and background
      // iPad: 10-15 frames per batch (less memory available)
      // iPhone: 20-50 frames per batch (more memory available)
      let BATCH_SIZE = isIPad
        ? (hasBackground ? 10 : 15)  // iPad: smaller batches
        : (hasBackground ? 20 : 50); // iPhone: normal batches

      // CRITICAL: Reduce batch size further if frame count is very high (90+ frames)
      // This prevents memory crash on iPad during large exports
      if (totalFrames > 80) {
        BATCH_SIZE = isIPad
          ? (hasBackground ? 3 : 5)    // iPad with 80+ frames: extra-small batches to prevent OOM
          : (hasBackground ? 10 : 20); // iPhone with 80+ frames: smaller batches
      } else if (isIPad && totalFrames > 60) {
        BATCH_SIZE = hasBackground ? 5 : 8; // iPad with 60-80 frames: smaller batches
      }

      // iPad also needs more cleanup time between batches
      // Increase cleanup time for large exports - 1200ms for 60+ frames on iPad prevents OOM
      const CLEANUP_TIME = isIPad
        ? (totalFrames > 60 ? 1200 : 400) // iPad: 1200ms for 60+ frames, 400ms normal
        : (totalFrames > 80 ? 300 : 200);  // iPhone: 300ms for 80+ frames, 200ms normal

      const numBatches = Math.ceil(totalFrames / BATCH_SIZE);

      for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
        const batchStart = cropStart + (batchIndex * BATCH_SIZE);
        const batchEnd = Math.min(batchStart + BATCH_SIZE, cropEnd);

        for (let i = batchStart; i < batchEnd; i++) {
          // Check if export was aborted
          if (exportAbortRef.current) {
            setShowBackground(originalShowBackground);
            setIsExporting(false);
            setVideoFrameThumbnailUri(null); // Clear video thumbnail on cancel
            CustomOverlayHelper.alert('❌ Export Cancelled', 'GIF export was cancelled');
            return;
          }

          // Set current frame to render
          setCurrentFrame(i);

          // If video background, generate thumbnail for this frame
          if (videoUri) {
            try {
              const thumbnail = await generateVideoFrameThumbnail(i);
              setVideoFrameThumbnailUri(thumbnail);
            } catch (thumbError) {
              console.error(`[EXPORT] Failed to generate video thumbnail for frame ${i}:`, thumbError);
              throw new Error(`Failed to generate video thumbnail for frame ${i}`);
            }
          }

          // Wait for frame to render (longer for backgrounds to load/seek)
          // Video needs thumbnail generation time, images need time to load, no background is fastest
          // Light layer needs extra time, especially with white glow overlay (double rendering)
          const frameWaitTime = videoUri ? 300 : (hasBackground ? 150 : 100);
          await new Promise(resolve => setTimeout(resolve, frameWaitTime));

          try {
            // Capture frame
            const imageUri = await renderFrameToImage(i);

            framesToExport.push({
              frameIndex: i,
              imageUri
            });

            // Capture preview frame every 10th frame
            if ((i - cropStart) % 10 === 0) {
              setExportPreviewFrames(prev => [...prev, imageUri]);
            }

            setExportProgress((i - cropStart + 1) / totalFrames * 0.8); // 80% for rendering
          } catch (frameError) {
            console.error(`[EXPORT GIF] Failed to render frame ${i}:`, frameError);
            throw new Error(`Memory error at frame ${i}. Try reducing frame count or quality.`);
          }
        }

        // CRITICAL: Force memory cleanup between batches
        // iPad needs more time for memory cleanup due to less available RAM
        if (batchIndex < numBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, CLEANUP_TIME)); // Allow garbage collection
        }
      }

      // Check abort before final export
      if (exportAbortRef.current) {
        setShowBackground(originalShowBackground);
        setIsExporting(false);
        CustomOverlayHelper.alert('❌ Export Cancelled', 'GIF export was cancelled');
        return;
      }

      // Restore original background visibility
      setShowBackground(originalShowBackground);


      // Export as GIF (uses quality setting)
      const dimensions = getExportDimensions(exportQuality, canvasSize, 'gif');
      const result = await exportAsGIF(framesToExport, {
        format: 'gif',
        quality: exportQuality,
        fps,
        startFrame: cropStart,
        endFrame: cropEnd,
        width: dimensions.width,
        height: dimensions.height,
        loopCount: loop ? 0 : 1 // 0 = infinite loop, 1 = play once
      }, (progress) => {
        // Real progress ignored on purpose — the smooth fake timer drives the bar.
      });

      console.log('[FRAMER-EXPORT] ✅ done — snapping bar to 100%');
      stopFakeExportProgress(1);
      setIsExporting(false);
      setVideoFrameThumbnailUri(null); // Clear video thumbnail after export
      setExportPreviewFrames([]); // Clear preview frames
      setCurrentPreviewIndex(0);

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      emitAppEvent('video:saved', { type: 'gif' });

      // Show custom in-game success modal (not native alert)
      setExportSuccessData({
        type: 'gif',
        fileUri: result,
        frameCount: totalFrames,
        quality: exportQuality,
        fps,
        loop
      });
      setExportSuccessVisible(true);

      // After first export, set cropEnd to full frame count
      if (!hasExported) {
        setHasExported(true);
        setCropEnd(frameCount);
      }
    } catch (error) {
      console.error('[EXPORT GIF] Error:', error);
      setIsExporting(false);
      setVideoFrameThumbnailUri(null); // Clear video thumbnail on error
      // Restore background visibility on error
      setShowBackground(showBackground);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isMemoryError = errorMessage.toLowerCase().includes('memory') || errorMessage.toLowerCase().includes('crash');

      CustomOverlayHelper.alert(
        '❌ Export Failed',
        isMemoryError
          ? `Memory error: ${errorMessage}\n\nWith video backgrounds:\n• Reduce frame count (try 100-150 frames)\n• Use 'low' quality\n• Export in smaller chunks\n• Remove video background temporarily`
          : `Could not export frames: ${errorMessage}\n\nPlease check:\n• Photo library permissions\n• Available storage space\n• Frame count is reasonable`,
        [{ text: 'OK' }]
      );
    }
  }, [cropStart, cropEnd, exportQuality, fps, canvasSize, renderFrameToImage, showBackground, hasExported, frameCount, videoUri, videoReady]);

  /**
   * Handle MOV export with HEVC alpha
   */
  const handleExportMOV = useCallback(async () => {
    try {
      setIsExporting(true);
      setExportProgress(0);
      setExportPreviewFrames([]); // Reset preview frames
      setCurrentPreviewIndex(0);
      exportAbortRef.current = false; // Reset abort flag


      // Verify ViewShot ref is ready
      if (!frameExportViewRef.current) {
        console.error('[EXPORT MOV] ❌ frameExportViewRef is not ready!');
        CustomOverlayHelper.alert('Export Error', 'Export view not ready. Please wait a moment and try again.');
        setIsExporting(false);
        return;
      }

      // Check if export is too large with video background
      const totalFrames = cropEnd - cropStart;
      if (videoUri && totalFrames > 150) {
        CustomOverlayHelper.alert(
          'Large Export with Video',
          `Exporting ${totalFrames} frames with video background may cause memory issues.\n\nRecommendations:\n• Reduce frame range (current: ${totalFrames})\n• Use 'low' quality\n• Export in smaller chunks\n\nContinue anyway?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => { setIsExporting(false); } },
            { text: 'Continue', style: 'default' }
          ]
        );
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Pause playback
      setIsPlaying(false);

      // ALWAYS include backgrounds in export (ignore eye button)
      const originalShowBackground = showBackground;
      setShowBackground(true);

      // Check if ANY background is present (video, snapshot, or image)
      const hasBackground = !!(videoUri || workspaceSnapshotUri || backgroundImageUri);

      // Wait for background to render (longer for video to load and seek)
      const initialWait = videoUri ? 500 : (hasBackground ? 250 : 150);
      await new Promise(resolve => setTimeout(resolve, initialWait));

      // If video, ensure it's ready
      if (videoUri && !videoReady) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Render frames in crop range
      const framesToExport: ExportFrameData[] = [];

      // Start the SMOOTH faked progress bar. The real render loop (captureRef per
      // frame) blocks the JS thread so a true % can't repaint (looked stuck 1-4%
      // then jumped to ~84%). Estimate ~140ms/frame + encode; if the real export
      // finishes sooner it snaps to 100% (quick end).
      console.log(`[FRAMER-EXPORT] render start: ${totalFrames} frames, quality=${exportQuality}, fps=${fps}`);
      startFakeExportProgress(totalFrames * 140 + 1500, 'export');

      // Calculate random max growth (1.5x to 3.5x) based on frame count
      // More frames = higher max growth for dramatic effect (reduced to half intensity)
      const baseMax = 1.5; // 150% minimum (was 300%)
      const frameBonus = Math.min(1.5, totalFrames / 10); // +1x per 10 frames, max +1.5x (was +3x)
      const randomVariation = Math.random() * 0.5; // +0 to +0.5x random (was +1x)
      const maxGrowth = baseMax + frameBonus + randomVariation;
      setExportMaxGrowth(maxGrowth);

      // MEMORY OPTIMIZATION: Process frames in batches to prevent crashes with backgrounds
      // iPad has less memory than iPhone - use smaller batches
      const isIPad = Platform.OS === 'ios' && (Dimensions.get('window').height > 700 || Dimensions.get('window').width > 700);

      // Adaptive batch sizing based on device and background
      // iPad: 10-15 frames per batch (less memory available)
      // iPhone: 20-50 frames per batch (more memory available)
      let BATCH_SIZE = isIPad
        ? (hasBackground ? 10 : 15)  // iPad: smaller batches
        : (hasBackground ? 20 : 50); // iPhone: normal batches

      // Batch sizing. The small batches + long cleanup below are OOM protection
      // for VIDEO/IMAGE backgrounds (big per-frame memory). Plain emoji frames
      // (no background) are tiny → use large batches so export is fast.
      if (!hasBackground) {
        BATCH_SIZE = 30; // no background: big batches on any device
      } else if (totalFrames > 80) {
        BATCH_SIZE = isIPad ? 3 : 10;   // 80+ frames WITH background: extra-small
      } else if (isIPad && totalFrames > 60) {
        BATCH_SIZE = 5;                  // iPad 60-80 frames with background
      }

      // Cleanup pause between batches — only needed to let the OS reclaim the big
      // background buffers. Minimal when there is no background.
      const CLEANUP_TIME = !hasBackground
        ? 60
        : (isIPad
            ? (totalFrames > 60 ? 1200 : 400) // iPad WITH background
            : (totalFrames > 80 ? 300 : 200));

      const numBatches = Math.ceil(totalFrames / BATCH_SIZE);

      // ✅ OPTIMIZATION: Determine quality based on frame count (huge exports use lower quality)
      // For 900+ frames, use 0.85 quality - imperceptible difference but ~15% faster rendering
      const frameQuality = totalFrames > 200 ? 0.85 : (totalFrames > 100 ? 0.9 : 1.0);

      // Parallel frame-render concurrency. No background → emoji frames are small,
      // so render 4 at once (much faster). WITH a background, throttle to avoid OOM.
      const RENDER_CONCURRENCY = !hasBackground
        ? 4
        : (isIPad ? (totalFrames > 60 ? 1 : 2) : 3);

      for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
        const batchStart = cropStart + (batchIndex * BATCH_SIZE);
        const batchEnd = Math.min(batchStart + BATCH_SIZE, cropEnd);

        // ✅ OPTIMIZATION: Process frames in parallel within the batch
        const batchFrameIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

        for (let parallelIdx = 0; parallelIdx < batchFrameIndices.length; parallelIdx += RENDER_CONCURRENCY) {
          // Check if export was aborted
          if (exportAbortRef.current) {
            setShowBackground(originalShowBackground);
            setIsExporting(false);
            setVideoFrameThumbnailUri(null);
            CustomOverlayHelper.alert('❌ Export Cancelled', 'MOV export was cancelled');
            return;
          }

          // Get up to RENDER_CONCURRENCY frames to render in parallel
          const parallelBatch = batchFrameIndices.slice(parallelIdx, parallelIdx + RENDER_CONCURRENCY);

          // ✅ OPTIMIZATION: Prepare all frames in parallel (reduce wait times)
          const preparePromises = parallelBatch.map(async (i) => {
            // Set current frame for UI
            setCurrentFrame(i);

            // If video background, generate thumbnail for this frame
            if (videoUri) {
              try {
                const thumbnail = await generateVideoFrameThumbnail(i);
                setVideoFrameThumbnailUri(thumbnail);
              } catch (thumbError) {
                console.error(`[EXPORT] Failed to generate video thumbnail for frame ${i}:`, thumbError);
                throw thumbError;
              }
            }

            return i;
          });

          try {
            await Promise.all(preparePromises);
          } catch (error) {
            console.error('[EXPORT MOV] Failed to prepare frames:', error);
            throw error;
          }

          // ✅ OPTIMIZATION: Reduced wait time (from 100-300ms to 30-80ms)
          // With parallelism, we need much less time to wait
          const optimizedWaitTime = videoUri ? 80 : (hasBackground ? 50 : 30);
          await new Promise(resolve => setTimeout(resolve, optimizedWaitTime));

          // ✅ OPTIMIZATION: Render all frames in parallel
          const renderPromises = parallelBatch.map(i =>
            renderFrameToImage(i, frameQuality)
              .then(imageUri => ({
                index: i,
                uri: imageUri
              }))
              .catch(frameError => {
                console.error(`[EXPORT MOV] Failed to render frame ${i}:`, frameError);
                throw new Error(`Memory error at frame ${i}. Try reducing frame count or quality.`);
              })
          );

          try {
            const results = await Promise.all(renderPromises);
            results.forEach(result => {
              framesToExport.push({
                frameIndex: result.index,
                imageUri: result.uri
              });
            });
            // Help GC: null out intermediate render results after pushing to framesToExport
            (results as any[]).length = 0;

            // Update progress for all rendered frames
            const processedFrames = Math.min(parallelIdx + RENDER_CONCURRENCY, batchFrameIndices.length);
            // Real per-frame progress ignored — the smooth fake timer drives the bar.
            console.log(`[FRAMER-EXPORT] rendered ${processedFrames}/${batchFrameIndices.length} in batch`);
          } catch (error) {
            throw error;
          }
        }

        // CRITICAL: Force memory cleanup between batches
        // iPad needs more time for memory cleanup due to less available RAM
        // Use CLEANUP_TIME (1200ms for iPad 60+ frames) to prevent OOM
        if (batchIndex < numBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, CLEANUP_TIME));
        }
      }

      // Check abort before final export
      if (exportAbortRef.current) {
        setShowBackground(originalShowBackground);
        setIsExporting(false);
        CustomOverlayHelper.alert('❌ Export Cancelled', 'MOV export was cancelled');
        return;
      }

      // Restore original background visibility
      setShowBackground(originalShowBackground);


      // Export as MOV (device-specific resolution for stability)
      const dimensions = getExportDimensions(exportQuality, canvasSize, 'mov');
      const result = await exportAsMOV(framesToExport, {
        format: 'mov',
        quality: exportQuality,
        fps,
        startFrame: cropStart,
        endFrame: cropEnd,
        width: dimensions.width,
        height: dimensions.height,
        loopCount: loop ? 0 : 1 // 0 = infinite loop, 1 = play once (for MOV metadata)
      }, (progress) => {
        // Real progress ignored on purpose — the smooth fake timer drives the bar.
      });

      console.log('[FRAMER-EXPORT] ✅ done — snapping bar to 100%');
      stopFakeExportProgress(1);
      setIsExporting(false);
      setVideoFrameThumbnailUri(null); // Clear video thumbnail after export
      setExportPreviewFrames([]); // Clear preview frames
      setCurrentPreviewIndex(0);

      // CRITICAL MEMORY CLEANUP: Large exports need immediate garbage collection
      // Clear the large framesToExport array from memory
      try {
        // Force garbage collection on large exports
        if (totalFrames > 80) {
          // Clear array reference
          framesToExport.length = 0;
          await new Promise(resolve => setTimeout(resolve, 500)); // Allow GC time
        }
      } catch (cleanupError) {
        console.warn('[EXPORT MOV] Memory cleanup error:', cleanupError);
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Save to video storage with automatic project linking
      let videoMeta: any = null;
      try {
        const duration = (totalFrames / fps) * 1000; // Duration in milliseconds

        // Generate project ID: use loaded project name if available, otherwise use current timestamp
        // The project name is used to link the video back to the project for previews
        const projectId = currentLoadedSlotId || `framer_${Date.now()}`;

        // Preview builder: re-export at smaller size for storage thumbnail
        // OPTIMIZATION: Skip preview builder for large frame counts on iPad to save memory
        // The main video will be used as preview instead
        const previewBuilder = totalFrames > 80 && isIPad
          ? undefined  // Skip preview generation for large exports on iPad
          : async (destUri: string) => {

              // Re-export frames at preview size
              const previewFrames = framesToExport.map(frame => ({
                ...frame,
                // Frames are already rendered, just mark for preview export
              }));

              await exportAsMOV(previewFrames, {
                format: 'mov',
                quality: 'low', // Use low quality for preview
                fps: VIDEO_STORAGE_PREVIEW_FPS,
                startFrame: cropStart,
                endFrame: cropEnd,
                width: VIDEO_STORAGE_PREVIEW_SIZE,
                height: VIDEO_STORAGE_PREVIEW_SIZE,
                loopCount: loop ? 0 : 1
              }, undefined);
            };

        const dimensions = getExportDimensions(exportQuality, canvasSize, 'mov');
        videoMeta = await addVideoToStorage(
          result,
          dimensions.width,
          dimensions.height,
          duration,
          projectId,
          { previewBuilder }
        );

        if (videoMeta) {
          emitAppEvent('video:saved', { id: videoMeta.id });
        }
      } catch (saveError) {
        console.error('[FRAMER MOV] Failed to save to video storage:', saveError);
      }

      // Show custom in-game success modal with video preview and storage button
      setExportSuccessData({
        type: 'mov',
        fileUri: result,
        frameCount: totalFrames,
        quality: exportQuality,
        fps,
        loop,
        videoMetaId: videoMeta?.id // Include video storage ID for navigation
      });
      setExportSuccessVisible(true);
      // NOTE: intentionally NOT emitting 'export:complete' — that would pop the
      // app-root ExportCompleteOverlay as a SECOND preview when the user closes
      // Framer. The Framer's own success modal (exportSuccessVisible) is the one.

      // AUTO-SAVE: Save project automatically after MOV export (use video preview as thumbnail)
      // If a project is already loaded, offer to overwrite or save as new
      try {
        const videoPreviewUri = videoMeta?.previewUri;

        if (currentLoadedSlotId) {
          // Project is loaded - show options
          CustomOverlayHelper.alert(
            '💾 Save Project',
            'A project is already loaded. How would you like to save?',
            [
              {
                text: '🔄 Update Current Project',
                onPress: async () => {
                  try {
                    await overwriteProject(currentLoadedSlotId, videoPreviewUri);
                    CustomOverlayHelper.alert('✅ Saved', 'Project updated successfully!');
                  } catch (err) {
                    console.error('[FRAMER MOV] Failed to overwrite project:', err);
                    CustomOverlayHelper.alert('❌ Error', 'Failed to update project');
                  }
                }
              },
              {
                text: '➕ Save as New Project',
                onPress: async () => {
                  try {
                    await autoSaveProject(videoPreviewUri);
                    CustomOverlayHelper.alert('✅ Saved', 'New project created successfully!');
                  } catch (err) {
                    console.error('[FRAMER MOV] Failed to save new project:', err);
                    CustomOverlayHelper.alert('❌ Error', 'Failed to save new project');
                  }
                }
              },
              {
                text: 'Cancel',
                style: 'cancel'
              }
            ]
          );
        } else {
          // No project loaded - auto-save as new
          await autoSaveProject(videoPreviewUri);
        }
      } catch (autoSaveError) {
        console.error('[FRAMER MOV] Failed to auto-save project:', autoSaveError);
        // Don't show error to user - auto-save is silent
      }

      // After first export, set cropEnd to full frame count
      if (!hasExported) {
        setHasExported(true);
        setCropEnd(frameCount);
      }
    } catch (error) {
      console.error('[EXPORT MOV] Error:', error);
      setIsExporting(false);
      setVideoFrameThumbnailUri(null); // Clear video thumbnail on error
      // Restore background visibility on error
      setShowBackground(showBackground);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isMemoryError = errorMessage.toLowerCase().includes('memory') || errorMessage.toLowerCase().includes('crash');

      CustomOverlayHelper.alert(
        '❌ Export Failed',
        isMemoryError
          ? `Memory error: ${errorMessage}\n\nWith video backgrounds:\n• Reduce frame count (try 100-150 frames)\n• Use 'low' quality\n• Export in smaller chunks\n• Remove video background temporarily`
          : `Could not export frames: ${errorMessage}\n\nPlease check:\n• Photo library permissions\n• Available storage space\n• Frame count is reasonable`,
        [{ text: 'OK' }]
      );
    }
  }, [cropStart, cropEnd, exportQuality, fps, canvasSize, renderFrameToImage, showBackground, hasExported, frameCount, videoUri, videoReady]);

  // Handle close - AUTO-SAVE without confirmation
  const handleClose = useCallback(async () => {
    // Auto-save frames before closing
    await saveFramerProject();

    // Don't clear frames - they're saved!
    setCurrentFrame(0);
    setIsPlaying(false);
    onClose();
  }, [onClose, saveFramerProject]);

  // Get current frame's stamps - NO FILTERING! Each frame is self-contained.
  // Length slider now controls stroke density (spacing), not frame visibility
  const currentStamps = framesRef.current[currentFrame]?.stamps || [];

  // Debug: Log stamp count (only when stamps change)
  useEffect(() => {
    if (currentStamps.length > 0) {
    }
  }, [currentFrame, currentStamps.length]);

  // Onion skin: Get prev and next frame stamps with wrapping
  // When on first frame (0), show last frame as previous (red)
  // When on last frame, show first frame (0) as next (green)
  const prevFrame = currentFrame === 0 ? frameCount - 1 : currentFrame - 1;
  const nextFrame = currentFrame === frameCount - 1 ? 0 : currentFrame + 1;

  // Automatically show onion skin when paused (not playing) - no manual toggle needed
  const shouldShowOnionSkin = !isPlaying;
  const prevFrameStamps = shouldShowOnionSkin ? (framesRef.current[prevFrame]?.stamps || []) : [];
  const nextFrameStamps = shouldShowOnionSkin ? (framesRef.current[nextFrame]?.stamps || []) : [];

  // Video Storage Preview Component - static preview image (no glitching)
  const VideoStoragePreview: React.FC<{ video: VideoMetadata }> = ({ video }) => {
    const [previewUri, setPreviewUri] = useState<string | null>(null);

    useEffect(() => {
      // Generate a single preview frame from video to avoid glitching
      const generatePreview = async () => {
        try {
          if (video.previewUri) {
            // Use existing preview if available
            setPreviewUri(video.previewUri);
          } else {
            // Generate preview frame from video
            const { uri } = await VideoThumbnails.getThumbnailAsync(video.uri, {
              time: 0,
              quality: 0.5
            });
            setPreviewUri(uri);
          }
        } catch (error) {
          console.warn('[VideoStoragePreview] Failed to generate preview:', error);
          setPreviewUri(null);
        }
      };

      void generatePreview();
    }, [video.uri, video.previewUri]);

    if (!previewUri) {
      return (
        <View style={{ width: 80, height: 80, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', borderRadius: 8 }}>
          <Text style={{ color: '#666', fontSize: 10 }}>...</Text>
        </View>
      );
    }

    return (
      <Image
        source={{ uri: previewUri }}
        style={{ width: 80, height: 80, borderRadius: 8, backgroundColor: '#0a0a0a' }}
        resizeMode="cover"
      />
    );
  };

  // Cleanup recording timers on unmount or when recording stops
  useEffect(() => {
    return () => {
      // Clean up long-press timeout
      if (recLongPressTimeoutRef.current) {
        clearTimeout(recLongPressTimeoutRef.current);
        recLongPressTimeoutRef.current = null;
      }
      // Clean up auto-keyframe interval
      if (recAutoKeyframeIntervalRef.current) {
        clearInterval(recAutoKeyframeIntervalRef.current);
        recAutoKeyframeIntervalRef.current = null;
      }
    };
  }, []);

  // Emoji picker styles
  const pickerStyles = useMemo(() => StyleSheet.create({
    pickerContainer: {
      flex: 1,
      width: '100%',
      maxWidth: '100%',
      backgroundColor: '#111111',
      paddingTop: 48,
      paddingHorizontal: 24,
      paddingBottom: 32
    },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16
    },
    pickerHeaderLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginRight: 12
    },
    pickerCloseIcon: {
      color: '#ffffff',
      fontSize: 24,
      fontWeight: '700'
    } as any,
    pickerSpacingSlider: {
      flex: 1,
      height: 32
    },
    pickerSelectedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: '#1f1f1f',
      borderRadius: 16,
      paddingHorizontal: 18,
      paddingVertical: 14,
      marginBottom: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#2a2a2a'
    },
    pickerSelectedLabel: {
      color: '#bbbbbb',
      fontSize: 14,
      fontWeight: '600'
    },
    pickerSelectedEmojiBubble: {
      backgroundColor: '#2d2d2d',
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 6
    },
    pickerSelectedEmoji: {
      fontSize: 30,
      lineHeight: 34,
      textAlign: 'center'
    },
    recentSection: {
      marginBottom: 12
    },
    recentLabel: {
      color: '#bbb',
      fontSize: 14,
      marginBottom: 6
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4
    },
    recentEmojiButton: {
      backgroundColor: '#2a2a2a',
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    recentEmojiButtonActive: {
      backgroundColor: '#ff6b6b'
    },
    recentEmoji: {
      fontSize: 20,
      lineHeight: 24,
      textAlign: 'center'
    },
    pickerTitle: {
      color: '#ffffff',
      fontWeight: '700',
      fontSize: 20,
      marginBottom: 0,
      textAlign: 'left'
    } as any,
    pickerSearch: {
      backgroundColor: '#2a2a2a',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: '#fff',
      marginBottom: 14,
      fontFamily: 'vrtlfinal'
    } as any,
    pickerFlipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 18
    },
    pickerFlipButton: {
      flex: 1,
      backgroundColor: '#202020',
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#303030'
    },
    pickerFlipButtonActive: {
      backgroundColor: '#ff6b6b',
      borderColor: '#ff6b6b'
    },
    pickerFlipEmoji: {
      fontSize: 18,
      lineHeight: 20
    },
    pickerFlipEmojiActive: {
      color: '#050505'
    } as any,
  }), []);

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={handleClose}
        supportedOrientations={['portrait', 'landscape']}
      >
      <StatusBar hidden />
      <View style={styles.container}>
        {/* Top Controls - ALL ACTION BUTTONS */}
        <View style={styles.topBar}>
          {/* Brush Options Button - Shows brush icon, opens options panel */}
          <TouchableOpacity
            style={[styles.topActionButton, showBrushOptions && styles.topActionButtonActive]}
            onPress={() => {
              exitPlacerMode();
              const newState = !showBrushOptions;
              setShowBrushOptions(newState);
              void Haptics.selectionAsync();

              // Clear existing timer
              if (brushOptionsTimeoutRef.current) {
                clearTimeout(brushOptionsTimeoutRef.current);
                brushOptionsTimeoutRef.current = null;
              }

              // Start auto-hide timer if opening
              if (newState) {
                brushOptionsTimeoutRef.current = setTimeout(() => {
                  setShowBrushOptions(false);
                }, 3000);
              }
            }}
          >
            <Text style={styles.topActionButtonEmoji}>🖌️</Text>
          </TouchableOpacity>

          {/* Emoji Plane Tool Button - 📐 for 2D transformable emoji planes */}
          <TouchableOpacity
            style={[styles.topActionButton, emojiPlaneToolActive && styles.topActionButtonActive]}
            onPress={() => {
              void Haptics.selectionAsync();
              const newState = !emojiPlaneToolActive;
              setEmojiPlaneToolActive(newState);
              if (newState) {
                setLineToolActive(false);
                setBroomToolActive(false);

                // Auto-select newest placed emoji if any exist
                if (emojiPlanesRef.current.length > 0) {
                  // Find the plane with the highest zIndex (newest)
                  const newestPlane = emojiPlanesRef.current.reduce((prev, current) =>
                    (current.zIndex > prev.zIndex) ? current : prev
                  );
                  setSelectedPlaneId(newestPlane.id);
                } else {
                  setSelectedPlaneId(null);
                }
              }
            }}
          >
            <Text style={styles.topActionButtonEmoji}>📐</Text>
          </TouchableOpacity>

          {/* Line Tool Button - 📏 for time-based straight lines (iPad only - iPhone uses brush panel) */}
          {!IS_MOBILE && (
            <TouchableOpacity
              style={[styles.topActionButton, lineToolActive && styles.topActionButtonActive]}
              onPress={() => {
                void Haptics.selectionAsync();
                const newState = !lineToolActive;
                setLineToolActive(newState);
                if (newState) {
                  setBroomToolActive(false); // Disable broom when line is active
                  setEmojiPlaneToolActive(false); // Auto-close placer mode
                  setSelectedPlaneId(null);
                }
                lineStartPointRef.current = null;
                linePreviewPointRef.current = null;
              }}
            >
              <Text style={styles.topActionButtonEmoji}>📏</Text>
            </TouchableOpacity>
          )}

          {/* Broom/Eraser Tool Button - 🧹 for clearing stamps (iPad only - iPhone uses brush panel) */}
          {!IS_MOBILE && (
            <TouchableOpacity
              style={[styles.topActionButton, broomToolActive && styles.topActionButtonActive]}
              onPress={() => {
                void Haptics.selectionAsync();
                const newState = !broomToolActive;
                setBroomToolActive(newState);
                if (newState) {
                  setLineToolActive(false);
                  setEmojiPlaneToolActive(false);
                  setBroomCursorPos(null);
                  setBroomIsClearing(false);
                } else {
                  setBroomCursorPos(null);
                  setBroomIsClearing(false);
                }
              }}
            >
              <Text style={styles.topActionButtonEmoji}>🧹</Text>
            </TouchableOpacity>
          )}

          {/* Background Visibility Button - HIDDEN per user request */}
          {false && (
            <TouchableOpacity
              style={[styles.topActionButton, !showBackground && styles.topActionButtonWarning]}
              onPress={() => {
                setShowBackground(!showBackground);
                void Haptics.selectionAsync();
              }}
            >
              <Text style={styles.topActionButtonEmoji}>👁️</Text>
            </TouchableOpacity>
          )}

          {/* Zoom Mode Button - REMOVED per user request (iOS mobile doesn't need it) */}

          {/* Smart Clear Button - inline trash + ALL */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <TouchableOpacity
              style={[
                styles.topActionButton,
                clearState === 'showAll' && styles.topActionButtonWarning
              ]}
              onPress={handleClearButton}
            >
              <Text style={styles.topActionButtonEmoji}>🗑️</Text>
            </TouchableOpacity>

            {/* ALL button appears inline when showAll state is active */}
            {clearState === 'showAll' && (
              <TouchableOpacity
                style={{
                  backgroundColor: '#ff3333',
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderWidth: 2,
                  borderColor: '#fff',
                  shadowColor: '#ff0000',
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.8,
                  shadowRadius: 8
                }}
                onPress={() => {
                  // Explode animation via haptics
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                  handleClearAll();
                }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>ALL</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Settings Button - Disabled during challenge mode */}
          {!activeChallenge && (
            <TouchableOpacity
              style={styles.topActionButton}
              onPress={() => {
                setSettingsVisible(true);
                void Haptics.selectionAsync();
              }}
            >
              <Text style={styles.topActionButtonEmoji}>⚙️</Text>
            </TouchableOpacity>
          )}

          {/* Export Button - Disabled during challenge mode (export happens automatically) */}
          {!activeChallenge && (
            <TouchableOpacity
              style={styles.topActionButton}
              onPress={() => {
                void Haptics.selectionAsync();
                setExportDialogFPS(fps); // Sync with current FPS
                setExportFormatVisible(true);
              }}
            >
              <Text style={styles.topActionButtonEmoji}>💾</Text>
            </TouchableOpacity>
          )}

          {/* Challenge Upload Confirmation Dialog Modal */}
          {showChallengeUploadConfirm && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 9999
              }}
            >
              <View
                style={{
                  backgroundColor: '#1a1a1a',
                  borderRadius: 16,
                  padding: 24,
                  marginHorizontal: 30,
                  borderWidth: 1,
                  borderColor: '#444'
                }}
              >
                <Text
                  style={{
                    fontSize: 18,
                    fontWeight: 'bold',
                    color: '#fff',
                    marginBottom: 16,
                    textAlign: 'center',
                    fontFamily: 'vrtlfinal'
                  }}
                >
                  Generate & Upload Video?
                </Text>
                <Text
                  style={{
                    fontSize: 14,
                    color: '#aaa',
                    marginBottom: 24,
                    textAlign: 'center'
                  }}
                >
                  This will generate a video from your frames and upload it to the gallery.
                </Text>

                <View style={{ gap: 10 }}>
                  <TouchableOpacity
                    style={{
                      backgroundColor: '#333',
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      borderRadius: 8,
                      alignItems: 'center'
                    }}
                    onPress={() => {
                      setShowChallengeUploadConfirm(false);
                      void Haptics.selectionAsync();
                    }}
                  >
                    <Text
                      style={{
                        color: '#fff',
                        fontSize: 16,
                        fontWeight: '600',
                        fontFamily: 'vrtlfinal'
                      }}
                    >
                      Keep Painting
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{
                      backgroundColor: 'rgba(255,80,80,0.18)',
                      borderWidth: 1,
                      borderColor: '#ff6b6b',
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      borderRadius: 8,
                      alignItems: 'center'
                    }}
                    onPress={() => {
                      setShowChallengeUploadConfirm(false);
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      onChallengeCancel?.();
                    }}
                  >
                    <Text
                      style={{
                        color: '#ff6b6b',
                        fontSize: 16,
                        fontWeight: '600',
                        fontFamily: 'vrtlfinal'
                      }}
                    >
                      Cancel Challenge
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{
                      backgroundColor: '#4ade80',
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      borderRadius: 8,
                      alignItems: 'center'
                    }}
                    onPress={() => {
                      setShowChallengeUploadConfirm(false);
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      // Start the export process
                      (async () => {
                        let tempDir: string | undefined;
                        const originalShowBackground = showBackground;
                        try {

                          // Reset export state
                          exportAbortRef.current = false;
                          setChallengeExportStatus('Creating upload...');
                          setExportProgress(0);

                          // ✅ FIX #8: Show completion overlay immediately so user sees "Creating upload..." status
                          setChallengeCompletionVisible(true);
                          setChallengeCompletedVideoUri(null); // Clear any previous video URI
                          setChallengeUploadStatus('idle'); // Reset upload status

                          // Get current FPS
                          const currentFps = fps || 30;
                          const exportFrameCount = cropEnd - cropStart;

                          // Select random logo set
                          const logo = getRandomLogoSet();
                          setExportLogoSet(logo);
                          setExportMaxGrowth(Math.min(3.5, 1.5 + (exportFrameCount / 500)));

                          // Verify ViewShot ref is ready
                          if (!frameExportViewRef.current) {
                            console.error('[FRAMER CHALLENGE] ❌ frameExportViewRef is not ready!');
                            throw new Error('Export view not ready. Please try again.');
                          }

                          // Pause playback and ensure backgrounds visible
                          setIsPlaying(false);
                          setShowBackground(true);

                          // STEP 1: Render frames and STREAM to disk (professional approach!)
                          setChallengeExportStatus('Rendering frames...');

                          const hasBackground = !!(videoUri || backgroundImageUri);

                          // FIX #7: iPad optimization for challenge export - reduce wait times on iPad
                          const isIPad = Platform.OS === 'ios' && (Dimensions.get('window').height > 700 || Dimensions.get('window').width > 700);

                          // Create temp directory for streaming frame saves
                          const timestamp = Date.now();
                          tempDir = `${FileSystem.cacheDirectory}temp_debug_${timestamp}`;
                          await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });

                          const framePaths: string[] = [];

                          // Initial wait for background to load (iPad needs more time due to memory pressure)
                          const initialWait = videoUri
                            ? (isIPad ? 800 : 500)
                            : (hasBackground ? (isIPad ? 400 : 250) : 100);
                          await new Promise(resolve => setTimeout(resolve, initialWait));

                          // STREAMING APPROACH: Render and save each frame immediately
                          // This keeps memory usage MINIMAL - only 1 frame in memory at a time!
                          // Works with ANY resolution (1080px, 2048px, 4096px) and ANY frame count!
                          for (let i = cropStart; i < cropEnd; i++) {
                            if (exportAbortRef.current) {
                              await FileSystem.deleteAsync(tempDir, { idempotent: true });
                              setChallengeCompletionVisible(false);
                              setShowBackground(originalShowBackground);
                              return;
                            }

                            const frameNum = i - cropStart + 1;
                            setChallengeExportStatus(`Rendering frame ${frameNum}/${exportFrameCount}...`);

                            setCurrentFrame(i);

                            // If video background, generate thumbnail
                            if (videoUri) {
                              try {
                                const thumbnail = await generateVideoFrameThumbnail(i);
                                setVideoFrameThumbnailUri(thumbnail);
                              } catch (error) {
                                console.error('[FRAMER CHALLENGE] Video thumbnail failed:', error);
                              }
                            }

                            // Wait for frame to render (reduced time for speed, but iPad gets more cleanup time)
                            const waitTime = videoUri
                              ? (isIPad ? 300 : 150)
                              : (hasBackground ? (isIPad ? 150 : 80) : 40);
                            await new Promise(resolve => setTimeout(resolve, waitTime));

                            try {
                              // Render frame to image with timeout
                              const timeoutMs = 10000;
                              const renderPromise = renderFrameToImage(i);
                              const timeoutPromise = new Promise<never>((_, reject) =>
                                setTimeout(() => reject(new Error(`Frame ${i} timeout (${timeoutMs}ms)`)), timeoutMs)
                              );

                              const imageUri = await Promise.race([renderPromise, timeoutPromise]);

                              if (!imageUri || typeof imageUri !== 'string' || imageUri.length < 50) {
                                throw new Error(`Invalid image URI for frame ${i}`);
                              }

                              // STREAM TO DISK: Save frame immediately and clear from memory!
                              const framePath = await saveFrameToFile(imageUri, frameNum - 1, tempDir);
                              framePaths.push(framePath);

                              // Frame data is now on disk and cleared from memory ✅

                              // Update progress (80% for rendering, 20% for encoding)
                              const progress = (frameNum / exportFrameCount) * 0.8;
                              setExportProgress(progress);

                              if (frameNum % 10 === 0 || frameNum === exportFrameCount) {
                              }
                            } catch (error) {
                              console.error(`[FRAMER CHALLENGE] ❌ Frame ${i} failed:`, error);
                              await FileSystem.deleteAsync(tempDir, { idempotent: true });
                              throw new Error(`Failed to render frame ${frameNum}: ${error instanceof Error ? error.message : 'Unknown'}`);
                            }
                          }


                          // STEP 2: Encode video from disk (streaming approach - no memory overhead!)
                          setChallengeExportStatus('Encoding video...');

                          const dimensions = getExportDimensions('high', canvasSize, 'mov');

                          const exportedVideoUri = await exportAsMOVFromPaths(framePaths, {
                            format: 'mov',
                            quality: 'high',
                            fps: currentFps,
                            startFrame: cropStart,
                            endFrame: cropEnd,
                            width: dimensions.width,
                            height: dimensions.height,
                            loopCount: loop ? 0 : 1
                          }, (progress) => {
                            const totalProgress = 0.8 + progress * 0.2; // Final 20%
                            setExportProgress(totalProgress);
                          });


                          // Validate exported video URI
                          if (!exportedVideoUri || typeof exportedVideoUri !== 'string') {
                            throw new Error('Invalid video URI returned from export');
                          }

                          // Calculate video duration in milliseconds
                          const videoDuration = ((cropEnd - cropStart) / currentFps) * 1000;

                          // Store the completed video info
                          // Ensure URI has file:// prefix for Video component
                          const videoUriWithPrefix = exportedVideoUri.startsWith('file://') ? exportedVideoUri : `file://${exportedVideoUri}`;
                          setChallengeCompletedVideoUri(videoUriWithPrefix);
                          setChallengeCompletedVideoDuration(videoDuration);
                          setChallengeExportStatus('Complete!');
                          setExportProgress(1.0);


                          // Clean up temp directory (NOT the video file - that's in cache root)
                          await FileSystem.deleteAsync(tempDir, { idempotent: true });

                          // Restore original background visibility
                          setShowBackground(originalShowBackground);

                          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

                        } catch (error) {
                          console.error('[FRAMER CHALLENGE] ❌ Export failed:', error);
                          console.error('[FRAMER CHALLENGE] Error stack:', error instanceof Error ? error.stack : 'No stack trace');

                          // ✅ FIX #9: Show error status in overlay for better UX
                          const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred during video export';
                          setChallengeExportStatus(`❌ Error: ${errorMsg.substring(0, 50)}...`);

                          // Clean up temp directory on error (if it exists)
                          try {
                            if (typeof tempDir !== 'undefined') {
                              await FileSystem.deleteAsync(tempDir, { idempotent: true });
                            }
                          } catch (cleanupError) {
                            console.error('[FRAMER CHALLENGE] Cleanup error:', cleanupError);
                          }

                          // Wait 2 seconds before closing so user sees the error
                          await new Promise(resolve => setTimeout(resolve, 2000));
                          setChallengeCompletionVisible(false);
                          setShowBackground(originalShowBackground);

                          // Show detailed error alert
                          CustomOverlayHelper.alert(
                            'Video Export Failed',
                            errorMsg,
                            [{ text: 'OK' }]
                          );
                        }
                      })();
                    }}
                  >
                    <Text style={{ color: '#000', fontSize: 16, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      Yes, Upload!
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {!IS_MOBILE ? (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {/* Undo Button - iPad: centered in top row */}
              <TouchableOpacity
                style={{
                  backgroundColor: undoStack.length > 0 ? 'rgba(30, 30, 30, 0.9)' : 'rgba(30, 30, 30, 0.4)',
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: undoStack.length > 0 ? '#fff' : '#666'
                }}
                onPress={handleUndo}
                disabled={undoStack.length === 0}
              >
                <Text style={{ fontSize: 18 }}>↩️</Text>
              </TouchableOpacity>

              {/* Redo Button - iPad: centered in top row */}
              <TouchableOpacity
                style={{
                  backgroundColor: redoStack.length > 0 ? 'rgba(30, 30, 30, 0.9)' : 'rgba(30, 30, 30, 0.4)',
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: redoStack.length > 0 ? '#fff' : '#666',
                  opacity: redoStack.length > 0 ? 1 : 0.3
                }}
                onPress={handleRedo}
                disabled={redoStack.length === 0}
              >
                <Text style={{ fontSize: 18 }}>↪️</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {/* Close Button */}
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Text style={styles.closeButtonText}>❎</Text>
          </TouchableOpacity>
        </View>

        {/* Brush Options Panel - Shows tool toggles, recent emojis and transform options */}
        {showBrushOptions && (
          <View style={{
            position: 'absolute',
            top: IS_MOBILE ? 70 : 100, // Mobile: closer to top bar, iPad: moved down more
            left: 10,
            backgroundColor: 'rgba(20, 20, 20, 0.98)',
            borderRadius: 12,
            padding: 12,
            borderWidth: 1,
            borderColor: '#3a3a44',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
            zIndex: 10000, // Very high to show over everything
            minWidth: 280,
            pointerEvents: 'box-none' // Let touches pass through to canvas below
          }}>
            {/* ROW 1: Tool Toggles - Alpha, Line Tool, Clear Tool (iPhone only) */}
            {IS_MOBILE && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: '#888', fontSize: 11, marginBottom: 6, fontWeight: '600' }}>TOOLS</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {/* Opacity Toggle Button - 💯 (opaque) / 1️⃣ (transparent 0.1) */}
                  <TouchableOpacity
                    style={{
                      width: 56,
                      height: 48,
                      borderRadius: 8,
                      backgroundColor: isFramerOpacityTransparent ? '#3a3a44' : '#1a1a1f',
                      borderWidth: 1,
                      borderColor: isFramerOpacityTransparent ? '#ff9f6b' : '#2a2a2f',
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}
                    onPress={() => {
                      handleToggleFramerOpacity();
                      // Reset auto-hide timer
                      if (brushOptionsTimeoutRef.current) {
                        clearTimeout(brushOptionsTimeoutRef.current);
                        brushOptionsTimeoutRef.current = setTimeout(() => {
                          setShowBrushOptions(false);
                        }, 3000);
                      }
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>
                      {framerOpacityToggleEmoji}
                    </Text>
                  </TouchableOpacity>

                  {/* Line Tool Button */}
                  <TouchableOpacity
                    style={{
                      width: 56,
                      height: 48,
                      borderRadius: 8,
                      backgroundColor: lineToolActive ? '#3a3a44' : '#1a1a1f',
                      borderWidth: 1,
                      borderColor: lineToolActive ? '#4ade80' : '#2a2a2f',
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      const newState = !lineToolActive;
                      setLineToolActive(newState);
                      if (newState) {
                        setBroomToolActive(false);
                        setEmojiPlaneToolActive(false);
                        setSelectedPlaneId(null);
                      }
                      lineStartPointRef.current = null;
                      linePreviewPointRef.current = null;
                      // Reset auto-hide timer
                      if (brushOptionsTimeoutRef.current) {
                        clearTimeout(brushOptionsTimeoutRef.current);
                        brushOptionsTimeoutRef.current = setTimeout(() => {
                          setShowBrushOptions(false);
                        }, 3000);
                      }
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>📏</Text>
                  </TouchableOpacity>

                  {/* Broom/Eraser Tool Button */}
                  <TouchableOpacity
                    style={{
                      width: 56,
                      height: 48,
                      borderRadius: 8,
                      backgroundColor: broomToolActive ? '#3a3a44' : '#1a1a1f',
                      borderWidth: 1,
                      borderColor: broomToolActive ? '#4ade80' : '#2a2a2f',
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      const newState = !broomToolActive;
                      setBroomToolActive(newState);
                      if (newState) {
                        setLineToolActive(false);
                        setEmojiPlaneToolActive(false);
                        setBroomCursorPos(null);
                        setBroomIsClearing(false);
                      } else {
                        setBroomCursorPos(null);
                        setBroomIsClearing(false);
                      }
                      // Reset auto-hide timer
                      if (brushOptionsTimeoutRef.current) {
                        clearTimeout(brushOptionsTimeoutRef.current);
                        brushOptionsTimeoutRef.current = setTimeout(() => {
                          setShowBrushOptions(false);
                        }, 3000);
                      }
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>🧹</Text>
                  </TouchableOpacity>

                  {/* Spacer Gap */}
                  <View style={{ width: 12 }} />

                  {/* Close Button */}
                  <TouchableOpacity
                    style={{
                      width: 56,
                      height: 48,
                      borderRadius: 8,
                      backgroundColor: '#1a1a1f',
                      borderWidth: 1,
                      borderColor: '#2a2a2f',
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setShowBrushOptions(false);
                      if (brushOptionsTimeoutRef.current) {
                        clearTimeout(brushOptionsTimeoutRef.current);
                        brushOptionsTimeoutRef.current = null;
                      }
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ROW 2: Recent Emojis - Last 4 emojis (+ Opacity Toggle on iPad) */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: '#888', fontSize: 11, marginBottom: 6, fontWeight: '600' }}>RECENT</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(recentEmojis || []).slice(0, 4).map((emoji, i) => {
                  // Apply transforms if this is the selected emoji
                  const isSelected = localEmoji === emoji;
                  const transform = [];
                  if (isSelected) {
                    transform.push({ rotate: `${framerRotation}deg` });
                    if (framerMirrorX) transform.push({ scaleX: -1 });
                    if (framerMirrorY) transform.push({ scaleY: -1 });
                  }

                  return (
                    <TouchableOpacity
                      key={`recent-${i}`}
                      style={{
                        width: 56,
                        height: 48,
                        borderRadius: 8,
                        backgroundColor: isSelected ? '#3a3a44' : '#1a1a1f',
                        borderWidth: 1,
                        borderColor: isSelected ? '#4ade80' : '#2a2a2f',
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}
                      onPress={() => {
                        handleSetLocalEmoji(emoji);
                        void Haptics.selectionAsync();
                        // Reset auto-hide timer
                        if (brushOptionsTimeoutRef.current) {
                          clearTimeout(brushOptionsTimeoutRef.current);
                          brushOptionsTimeoutRef.current = setTimeout(() => {
                            setShowBrushOptions(false);
                          }, 3000);
                        }
                      }}
                    >
                      <BrushEmojiIcon
                        emoji={emoji}
                        size={28}
                        textStyle={{
                          fontSize: 28,
                          transform: transform.length > 0 ? transform : undefined
                        }}
                      />
                    </TouchableOpacity>
                  );
                })}

                {/* Opacity Toggle Button - iPad only (iPhone has it in TOOLS row) */}
                {!IS_MOBILE && (
                  <TouchableOpacity
                    style={{
                      width: 56,
                      height: 48,
                      borderRadius: 8,
                      backgroundColor: isFramerOpacityTransparent ? '#3a3a44' : '#1a1a1f',
                      borderWidth: 1,
                      borderColor: isFramerOpacityTransparent ? '#ff9f6b' : '#2a2a2f',
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}
                    onPress={() => {
                      handleToggleFramerOpacity();
                      // Reset auto-hide timer
                      if (brushOptionsTimeoutRef.current) {
                        clearTimeout(brushOptionsTimeoutRef.current);
                        brushOptionsTimeoutRef.current = setTimeout(() => {
                          setShowBrushOptions(false);
                        }, 3000);
                      }
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>
                      {framerOpacityToggleEmoji}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* ROW 3: Transform Options */}
            <View>
              <Text style={{ color: '#888', fontSize: 11, marginBottom: 6, fontWeight: '600' }}>TRANSFORM</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {/* Mirror X */}
                <TouchableOpacity
                  style={{
                    width: 56,
                    height: 48,
                    borderRadius: 8,
                    backgroundColor: framerMirrorX ? '#3a3a44' : '#1a1a1f',
                    borderWidth: 1,
                    borderColor: framerMirrorX ? '#4ade80' : '#2a2a2f',
                    justifyContent: 'center',
                    alignItems: 'center'
                  }}
                  onPress={() => {
                    handleToggleFramerMirrorX();
                    // Reset auto-hide timer
                    if (brushOptionsTimeoutRef.current) {
                      clearTimeout(brushOptionsTimeoutRef.current);
                      brushOptionsTimeoutRef.current = setTimeout(() => {
                        setShowBrushOptions(false);
                      }, 3000);
                    }
                  }}
                >
                  <Text style={{ fontSize: 20 }}>↔️</Text>
                </TouchableOpacity>

                {/* Mirror Y */}
                <TouchableOpacity
                  style={{
                    width: 56,
                    height: 48,
                    borderRadius: 8,
                    backgroundColor: framerMirrorY ? '#3a3a44' : '#1a1a1f',
                    borderWidth: 1,
                    borderColor: framerMirrorY ? '#4ade80' : '#2a2a2f',
                    justifyContent: 'center',
                    alignItems: 'center'
                  }}
                  onPress={() => {
                    handleToggleFramerMirrorY();
                    // Reset auto-hide timer
                    if (brushOptionsTimeoutRef.current) {
                      clearTimeout(brushOptionsTimeoutRef.current);
                      brushOptionsTimeoutRef.current = setTimeout(() => {
                        setShowBrushOptions(false);
                      }, 3000);
                    }
                  }}
                >
                  <Text style={{ fontSize: 20 }}>↕️</Text>
                </TouchableOpacity>

                {/* Rotate Left */}
                <TouchableOpacity
                  style={{
                    width: 56,
                    height: 48,
                    borderRadius: 8,
                    backgroundColor: '#1a1a1f',
                    borderWidth: 1,
                    borderColor: '#2a2a2f',
                    justifyContent: 'center',
                    alignItems: 'center'
                  }}
                  onPress={() => {
                    handleTurnFramerLeft();
                    // Reset auto-hide timer
                    if (brushOptionsTimeoutRef.current) {
                      clearTimeout(brushOptionsTimeoutRef.current);
                      brushOptionsTimeoutRef.current = setTimeout(() => {
                        setShowBrushOptions(false);
                      }, 3000);
                    }
                  }}
                >
                  <Text style={{ fontSize: 20 }}>⟲</Text>
                </TouchableOpacity>

                {/* Rotate Right / Auto-rotate */}
                <TouchableOpacity
                  style={{
                    width: 56,
                    height: 48,
                    borderRadius: 8,
                    backgroundColor: autoRotateEnabled ? '#4ade80' : '#1a1a1f',
                    borderWidth: 1,
                    borderColor: autoRotateEnabled ? '#4ade80' : '#2a2a2f',
                    justifyContent: 'center',
                    alignItems: 'center'
                  }}
                  onPress={() => {
                    handleTurnFramerRight();
                    // Reset auto-hide timer
                    if (brushOptionsTimeoutRef.current) {
                      clearTimeout(brushOptionsTimeoutRef.current);
                      brushOptionsTimeoutRef.current = setTimeout(() => {
                        setShowBrushOptions(false);
                      }, 3000);
                    }
                  }}
                  onLongPress={() => {
                    handleTurnFramerRightLongPress();
                    // Reset auto-hide timer
                    if (brushOptionsTimeoutRef.current) {
                      clearTimeout(brushOptionsTimeoutRef.current);
                      brushOptionsTimeoutRef.current = setTimeout(() => {
                        setShowBrushOptions(false);
                      }, 3000);
                    }
                  }}
                  delayLongPress={600}
                >
                  <Text style={{ fontSize: 20 }}>⟳</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}


        {/* Play/Pause + FPS Slider - Mobile only, positioned under top buttons */}
        {IS_MOBILE && (
          <View style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Play/Pause Button - Always visible */}
            <TouchableOpacity
              style={{
                backgroundColor: isPlaying ? '#ff6b6b' : '#1a1a1a',
                borderRadius: 6,
                padding: 8,
                borderWidth: 1,
                borderColor: isPlaying ? '#ff8c8c' : '#444',
                minWidth: 44,
                alignItems: 'center'
              }}
              onPress={togglePlayback}
            >
              <Text style={{ fontSize: 16 }}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>

            {/* FPS Slider - Always visible */}
            <CustomAnimatorSlider
              style={{ flex: 1 }}
              label="⏱️"
              value={fps}
              minimumValue={1}
              maximumValue={60}
              step={1}
              onValueChange={setFps}
              onSlidingComplete={setFps}
              minimumTrackTintColor="#ff6b6b"
              thumbTintColor="#ff6b6b"
              valueFormatter={(v) => String(v)}
            />

            {/* Undo Button */}
            <TouchableOpacity
              style={{
                backgroundColor: undoStack.length > 0 ? 'rgba(30, 30, 30, 0.9)' : 'rgba(30, 30, 30, 0.4)',
                width: 36,
                height: 36,
                borderRadius: 18,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: undoStack.length > 0 ? '#fff' : '#444'
              }}
              onPress={handleUndo}
              disabled={undoStack.length === 0}
            >
              <Text style={{ fontSize: 18 }}>↩️</Text>
            </TouchableOpacity>

            {/* Redo Button - always reserve space to prevent undo button from moving */}
            <TouchableOpacity
              style={{
                backgroundColor: redoStack.length > 0 ? 'rgba(30, 30, 30, 0.9)' : 'rgba(30, 30, 30, 0.4)',
                width: 36,
                height: 36,
                borderRadius: 18,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: redoStack.length > 0 ? '#fff' : '#444',
                opacity: redoStack.length > 0 ? 1 : 0.3
              }}
              onPress={handleRedo}
              disabled={redoStack.length === 0}
            >
              <Text style={{ fontSize: 18 }}>↪️</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Canvas Area with PanResponder - pinch-to-zoom and drawing work anywhere */}
        <View style={styles.canvasContainer} {...panResponder}>
          {/* Zoom controls - REMOVED per user request */}

          {/* Undo/Redo Overlay removed - iPad buttons now live in top bar */}

          {/* ViewShot wrapper for export - uses logical size for consistent coordinates */}
          <ViewShot
            ref={frameExportViewRef}
            options={{
              format: 'png',
              quality: 1.0,
              result: 'data-uri',
              width: logicalCanvasSize,
              height: logicalCanvasSize
            }}
            style={{
              width: canvasSize,
              height: canvasSize,
              position: 'relative',
              overflow: 'hidden',
              backgroundColor: 'transparent'
            }}
            onLayout={(event) => {
              // Measure absolute position on screen
              event.target.measure((x, y, width, height, pageX, pageY) => {
                canvasBoundsRef.current = { x: pageX, y: pageY, width, height };
              });
            }}
          >
            {/* Content container - scaled to fit display size */}
            <View
              style={{
                width: logicalCanvasSize,
                height: logicalCanvasSize,
                position: 'absolute',
                transform: [{ scale: canvasSize / logicalCanvasSize }],
                transformOrigin: 'top left',
                backgroundColor: 'transparent'
              }}
              pointerEvents="box-none"
            >
              {/* Export background fill — BOTTOM layer, so captureRef bakes it into every frame and
                  the encoder never has to deal with alpha. Rendered during export AND in the editor
                  so what you see is what you get. */}
              {exportBgMode === 'color' && (
                <View style={{ position: 'absolute', width: logicalCanvasSize, height: logicalCanvasSize, backgroundColor: exportBgColor }} />
              )}

              {/* Checkerboard background to show transparency - hidden during export for transparent PNG */}
              {!isExporting && exportBgMode === 'transparent' && <View style={[styles.checkerboard, { width: logicalCanvasSize, height: logicalCanvasSize, position: 'absolute' }]} />}

              {/* Background images layer - behind canvas (toggled by eye button) */}
              {showBackground && workspaceSnapshotUri && !backgroundImageUri && !videoUri && (
                <Image
                  source={{ uri: workspaceSnapshotUri }}
                  style={{
                    position: 'absolute',
                    width: logicalCanvasSize,
                    height: logicalCanvasSize,
                    opacity: 1.0
                  }}
                  resizeMode="stretch"
                />
              )}
              {showBackground && backgroundImageUri && !videoUri && (
                <Image
                  source={{ uri: backgroundImageUri }}
                  style={{
                    position: 'absolute',
                    width: logicalCanvasSize,
                    height: logicalCanvasSize,
                    opacity: 1.0
                  }}
                  resizeMode="stretch"
                />
              )}

              {/* Video layer - shows video at current frame time (toggled by eye button) - fills frame with crop transform */}
              {showBackground && videoUri && videoMetadata && (
                <View
                  style={{
                    position: 'absolute',
                    width: logicalCanvasSize,
                    height: logicalCanvasSize,
                    overflow: 'hidden'
                  }}
                  pointerEvents="none"
                >
                  <View
                    style={{
                      width: logicalCanvasSize,
                      height: logicalCanvasSize,
                      transform: [
                        { translateX: videoCropOffsetX },
                        { translateY: videoCropOffsetY },
                        { scale: videoCropScale }
                      ]
                    }}
                  >
                    {/* During export: Use Image with video frame thumbnail (Video component doesn't capture properly) */}
                    {/* During normal playback: Use live Video component for smooth seeking */}
                    {isExporting && videoFrameThumbnailUri ? (
                      <Image
                        source={{ uri: videoFrameThumbnailUri }}
                        style={{
                          width: logicalCanvasSize,
                          height: logicalCanvasSize,
                          opacity: 1.0
                        }}
                        resizeMode="cover"
                      />
                    ) : (
                      <Video
                        ref={videoRef}
                        source={{ uri: videoUri }}
                        style={{
                          width: logicalCanvasSize,
                          height: logicalCanvasSize,
                          opacity: 1.0
                        }}
                        resizeMode={ResizeMode.COVER}
                        shouldPlay={false}
                        isLooping={false}
                        isMuted={false}
                        volume={videoVolume}
                        useNativeControls={false}
                        progressUpdateIntervalMillis={16}
                        onLoad={() => {
                          setVideoReady(true);
                          // Set initial volume to 0.1
                          if (videoRef.current) {
                            videoRef.current.setVolumeAsync(0.1).catch((err: any) => {
                              console.error('[FRAMER] Failed to set initial volume:', err);
                            });
                          }
                        }}
                        onError={(error) => {
                          console.error('[FRAMER VIDEO] Video load error:', error);
                          setVideoReady(false);
                        }}
                      />
                    )}
                  </View>
                </View>
              )}

              {/* Skia Canvas - transparent, on top of background */}
              <Canvas
                ref={canvasRef}
                style={{
                  width: logicalCanvasSize,
                  height: logicalCanvasSize,
                  backgroundColor: 'transparent',
                  position: 'absolute',
                  pointerEvents: 'none'
                }}
              >
                <Group>
                  {/* Render imported background strokes if no images (toggled by eye button) */}
                  {showBackground && !workspaceSnapshotUri && !backgroundImageUri && importedBackgroundStrokes.length > 0 && (
                  <>
                    {importedBackgroundStrokes.map((bgStroke, bgIndex) => {
                      // Validate stroke has required properties
                      if (!bgStroke || bgStroke.x === undefined || bgStroke.y === undefined ||
                          bgStroke.size === undefined || !bgStroke.emoji) {
                        console.warn(`[FRAMER CANVAS] Invalid background stroke at index ${bgIndex}`);
                        return null;
                      }

                      const bgStampEntry = getStamp(bgStroke.emoji, bgStroke.size);
                      if (!bgStampEntry) {
                        console.warn(`[FRAMER CANVAS] Could not get stamp for background emoji: ${bgStroke.emoji}`);
                        return null;
                      }

                      if (bgIndex === 0) {
                      }

                      return (
                        <SkiaImage
                          key={`bg-${bgIndex}`}
                          image={bgStampEntry.image}
                          x={bgStroke.x - bgStroke.size / 2}
                          y={bgStroke.y - bgStroke.size / 2}
                          width={bgStroke.size}
                          height={bgStroke.size}
                          opacity={(bgStroke.opacity ?? 1) * 0.5} // 50% opacity for backdrop
                        />
                      );
                    })}
                  </>
                )}

                {/* Onion Skin: Render previous frame (50% opacity) - only when paused */}
                {shouldShowOnionSkin && prevFrameStamps.map((stamp, index) => {
                  const stampEntry = getStamp(stamp.emoji, stamp.size);
                  if (!stampEntry) return null;

                  // Make stamps 70% bigger (1.7x)
                  const displaySize = stamp.size * 1.7;

                  // Build transform matrix for rotation and mirroring
                  const transforms = [];

                  // Apply rotation around stamp center
                  if (stamp.rotation !== 0) {
                    transforms.push({ rotate: (stamp.rotation * Math.PI) / 180 });
                  }

                  // Apply mirroring - use separate scaleX/scaleY instead of nested object
                  if (stamp.mirrorX) {
                    transforms.push({ scaleX: -1 });
                  }
                  if (stamp.mirrorY) {
                    transforms.push({ scaleY: -1 });
                  }

                  return (
                    <SkiaImage
                      key={`prev-${prevFrame}-${index}`}
                      image={stampEntry.image}
                      x={stamp.x - displaySize / 2}
                      y={stamp.y - displaySize / 2}
                      width={displaySize}
                      height={displaySize}
                      opacity={stamp.opacity * 0.1} // 10% opacity for previous frame (very transparent)
                      color="#ff6b6b" // Red tint for previous frame
                      transform={transforms.length > 0 ? transforms : undefined}
                      origin={{ x: stamp.x, y: stamp.y }}
                    />
                  );
                })}

                {/* Onion Skin: Render next frame (50% opacity) - only when paused */}
                {shouldShowOnionSkin && nextFrameStamps.map((stamp, index) => {
                  const stampEntry = getStamp(stamp.emoji, stamp.size);
                  if (!stampEntry) return null;

                  // Make stamps 70% bigger (1.7x)
                  const displaySize = stamp.size * 1.7;

                  // Build transform matrix for rotation and mirroring
                  const transforms = [];

                  // Apply rotation around stamp center
                  if (stamp.rotation !== 0) {
                    transforms.push({ rotate: (stamp.rotation * Math.PI) / 180 });
                  }

                  // Apply mirroring - use separate scaleX/scaleY instead of nested object
                  if (stamp.mirrorX) {
                    transforms.push({ scaleX: -1 });
                  }
                  if (stamp.mirrorY) {
                    transforms.push({ scaleY: -1 });
                  }

                  return (
                    <SkiaImage
                      key={`next-${nextFrame}-${index}`}
                      image={stampEntry.image}
                      x={stamp.x - displaySize / 2}
                      y={stamp.y - displaySize / 2}
                      width={displaySize}
                      height={displaySize}
                      opacity={stamp.opacity * 0.1} // 10% opacity for next frame (very transparent)
                      color="#4ade80" // Green tint for next frame
                      transform={transforms.length > 0 ? transforms : undefined}
                      origin={{ x: stamp.x, y: stamp.y }}
                    />
                  );
                })}

                {/* Render current frame's emoji stamps (on top of background and onion skin) */}
                {currentStamps.map((stamp, index) => {
                  const stampEntry = getStamp(stamp.emoji, stamp.size);
                  if (!stampEntry) {
                    console.warn(`[FRAMER RENDER] Could not get stamp for emoji: ${stamp.emoji} size: ${stamp.size}`);
                    return null;
                  }

                  // Make stamps 70% bigger (1.7x)
                  const displaySize = stamp.size * 1.7;

                  // Build transform matrix for rotation and mirroring
                  const transforms = [];

                  // Apply rotation around stamp center
                  if (stamp.rotation !== 0) {
                    transforms.push({ rotate: (stamp.rotation * Math.PI) / 180 });
                  }

                  // Apply mirroring - use separate scaleX/scaleY instead of nested object
                  if (stamp.mirrorX) {
                    transforms.push({ scaleX: -1 });
                  }
                  if (stamp.mirrorY) {
                    transforms.push({ scaleY: -1 });
                  }

                  return (
                    <SkiaImage
                      key={`frame-${currentFrame}-${index}`}
                      image={stampEntry.image}
                      x={stamp.x - displaySize / 2}
                      y={stamp.y - displaySize / 2}
                      width={displaySize}
                      height={displaySize}
                      opacity={stamp.opacity}
                      transform={transforms.length > 0 ? transforms : undefined}
                      origin={{ x: stamp.x, y: stamp.y }}
                    />
                  );
                })}

                {/* Emoji Planes - Render visible planes sorted by z-index */}
                {(() => {
                  const visiblePlanes = getVisiblePlanes();
                  if (visiblePlanes.length === 0) return null;

                  return visiblePlanes.map(plane => {
                    // Custom emojis (PNG) need smaller size to avoid cropping; normal emoji stays at 100px
                    const stampSize = (isCustomBrushReference(plane.emoji) || plane.emoji.startsWith('data:image/png;base64,')) ? 70 : 100;
                    const stampEntry = getStamp(plane.emoji, stampSize);
                    if (!stampEntry) return null;

                    const corners = plane.corners;
                    const isSelected = plane.id === selectedPlaneId && emojiPlaneToolActive;
                    const isCustom = isCustomBrushReference(plane.emoji) || plane.emoji.startsWith('data:image/png;base64,');

                    // Generate perspective-correct mesh with 9x9 grid for smooth warping
                    const imageWidth = stampEntry.image.width();
                    const imageHeight = stampEntry.image.height();

                    // Use mesh-based rendering for proper perspective transformation
                    // Grid size 9 = 9x9 cells = 10x10 vertices = 162 triangles
                    // This creates smooth, natural distortion without the "only 4 diagonals" feel
                    const mesh = generatePerspectiveMesh(
                      corners,
                      9, // Grid divisions - higher = smoother but more vertices
                      { width: imageWidth, height: imageHeight },
                      isCustom // Pass custom emoji flag for proper padding
                    );

                    // Check if plane is visible at current frame for red border
                    const isVisibleAtCurrentFrame = isPlaneVisibleAtFrame(
                      plane.birthFrame, plane.lifetime, currentFrame, cropStart, cropEnd,
                    );

                    return (
                      <Group key={plane.id} opacity={plane.opacity}>
                        {/* MESH-BASED PERSPECTIVE DISTORTION - No more "4 diagonal" limitation! */}
                        {/* The mesh creates natural perspective with smooth interpolation across the entire surface */}
                        <Vertices
                          vertices={mesh.vertices}
                          textures={mesh.textures}
                          indices={mesh.indices}
                        >
                          <ImageShader
                            image={stampEntry.image}
                            fit="cover"
                            rect={{ x: 0, y: 0, width: imageWidth, height: imageHeight }}
                          />
                        </Vertices>

                        {/* RED border for ALL visible planes at current frame - ONLY when tool is active */}
                        {isVisibleAtCurrentFrame && emojiPlaneToolActive && (
                          <>
                            <Line
                              p1={vec(corners.topLeft.x, corners.topLeft.y)}
                              p2={vec(corners.topRight.x, corners.topRight.y)}
                              color="#ef4444"
                              style="stroke"
                              strokeWidth={2}
                              opacity={0.7}
                            />
                            <Line
                              p1={vec(corners.topRight.x, corners.topRight.y)}
                              p2={vec(corners.bottomRight.x, corners.bottomRight.y)}
                              color="#ef4444"
                              style="stroke"
                              strokeWidth={2}
                              opacity={0.7}
                            />
                            <Line
                              p1={vec(corners.bottomRight.x, corners.bottomRight.y)}
                              p2={vec(corners.bottomLeft.x, corners.bottomLeft.y)}
                              color="#ef4444"
                              style="stroke"
                              strokeWidth={2}
                              opacity={0.7}
                            />
                            <Line
                              p1={vec(corners.bottomLeft.x, corners.bottomLeft.y)}
                              p2={vec(corners.topLeft.x, corners.topLeft.y)}
                              color="#ef4444"
                              style="stroke"
                              strokeWidth={2}
                              opacity={0.7}
                            />
                          </>
                        )}

                        {/* WHITE border ONLY for selected plane (shows on top of red) */}
                        {isSelected && (
                          <>
                            {/* 4 CORNER HANDLES - Small but visible, turn yellow when grabbed */}
                            {/* Top-left corner */}
                            <Circle
                              cx={corners.topLeft.x}
                              cy={corners.topLeft.y}
                              r={18}
                              color={draggingCorner?.corner === 'topLeft' ? '#ffdd00' : '#00ff88'}
                              opacity={1.0}
                            />
                            <Circle cx={corners.topLeft.x} cy={corners.topLeft.y} r={12} color="#ffffff" opacity={0.5} />
                            {/* Top-right corner */}
                            <Circle
                              cx={corners.topRight.x}
                              cy={corners.topRight.y}
                              r={18}
                              color={draggingCorner?.corner === 'topRight' ? '#ffdd00' : '#00ff88'}
                              opacity={1.0}
                            />
                            <Circle cx={corners.topRight.x} cy={corners.topRight.y} r={12} color="#ffffff" opacity={0.5} />
                            {/* Bottom-right corner */}
                            <Circle
                              cx={corners.bottomRight.x}
                              cy={corners.bottomRight.y}
                              r={18}
                              color={draggingCorner?.corner === 'bottomRight' ? '#ffdd00' : '#00ff88'}
                              opacity={1.0}
                            />
                            <Circle cx={corners.bottomRight.x} cy={corners.bottomRight.y} r={12} color="#ffffff" opacity={0.5} />
                            {/* Bottom-left corner */}
                            <Circle
                              cx={corners.bottomLeft.x}
                              cy={corners.bottomLeft.y}
                              r={18}
                              color={draggingCorner?.corner === 'bottomLeft' ? '#ffdd00' : '#00ff88'}
                              opacity={1.0}
                            />
                            <Circle cx={corners.bottomLeft.x} cy={corners.bottomLeft.y} r={12} color="#ffffff" opacity={0.5} />

                            {/* White border lines for selected plane (thin, on top of red) */}
                            <Line
                              p1={vec(corners.topLeft.x, corners.topLeft.y)}
                              p2={vec(corners.topRight.x, corners.topRight.y)}
                              color="#ffffff"
                              style="stroke"
                              strokeWidth={1}
                              opacity={0.8}
                            />
                            <Line
                              p1={vec(corners.topRight.x, corners.topRight.y)}
                              p2={vec(corners.bottomRight.x, corners.bottomRight.y)}
                              color="#ffffff"
                              style="stroke"
                              strokeWidth={1}
                              opacity={0.8}
                            />
                            <Line
                              p1={vec(corners.bottomRight.x, corners.bottomRight.y)}
                              p2={vec(corners.bottomLeft.x, corners.bottomLeft.y)}
                              color="#ffffff"
                              style="stroke"
                              strokeWidth={1}
                              opacity={0.8}
                            />
                            <Line
                              p1={vec(corners.bottomLeft.x, corners.bottomLeft.y)}
                              p2={vec(corners.topLeft.x, corners.topLeft.y)}
                              color="#ffffff"
                              style="stroke"
                              strokeWidth={1}
                              opacity={0.8}
                            />
                          </>
                        )}
                      </Group>
                    );
                  });
                })()}

                {/* Line Tool Preview - Show emoji stamps distributed along line */}
                {lineToolActive && lineStartPointRef.current && linePreviewPointRef.current && (() => {
                  const start = lineStartPointRef.current;
                  const end = linePreviewPointRef.current;
                  const dx = end.x - start.x;
                  const dy = end.y - start.y;
                  const distance = Math.hypot(dx, dy);
                  const currentBrushSize = framerBrushSizeRef.current;
                  const spacing = Math.max(1, currentBrushSize * 0.3);
                  const steps = Math.ceil(distance / spacing);

                  const previewStamps: Array<{ x: number; y: number }> = [];
                  for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    previewStamps.push({
                      x: start.x + dx * t,
                      y: start.y + dy * t
                    });
                  }

                  const currentEmoji = framerBrushEmojiRef.current;
                  const displaySize = currentBrushSize * 1.26;
                  const stampEntry = getStamp(currentEmoji, currentBrushSize);
                  if (!stampEntry) return null;

                  return previewStamps.map((stamp, index) => (
                    <SkiaImage
                      key={`preview-${index}`}
                      image={stampEntry.image}
                      x={stamp.x - displaySize / 2}
                      y={stamp.y - displaySize / 2}
                      width={displaySize}
                      height={displaySize}
                      opacity={0.5}
                    />
                  ));
                })()}

                {/* Broom Tool Cursor - Circle indicating eraser radius (green when hovering, red when clearing) */}
                {broomToolActive && broomCursorPos && (
                  <Circle
                    cx={broomCursorPos.x}
                    cy={broomCursorPos.y}
                    r={framerBrushSizeRef.current * 1.5}
                    color={broomIsClearing ? '#ff0000' : '#00ff00'}
                    style="stroke"
                    strokeWidth={3}
                    opacity={0.8}
                  />
                )}
                </Group>
              </Canvas>

              {/* Emoji corner handles for selected emoji planes - HIDDEN DURING EXPORT */}
              {!isExporting && getVisiblePlanes().some(p => p.id === selectedPlaneId) && (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'box-none' }}>
                  {getVisiblePlanes()
                    .filter(p => p.id === selectedPlaneId)
                    .map(plane => {
                      const isDragging = draggingCorner?.planeId === plane.id;
                      const cornerEmoji = isDragging ? '✊' : '🫵';
                      const corners = [
                        { pos: plane.corners.topLeft, name: 'topLeft' },
                        { pos: plane.corners.topRight, name: 'topRight' },
                        { pos: plane.corners.bottomRight, name: 'bottomRight' },
                        { pos: plane.corners.bottomLeft, name: 'bottomLeft' }
                      ];

                      return corners.map(corner => (
                        <View
                          key={`emoji-corner-${plane.id}-${corner.name}`}
                          style={{
                            position: 'absolute',
                            left: corner.pos.x - 12,
                            top: corner.pos.y - 12,
                            width: 24,
                            height: 24,
                            justifyContent: 'center',
                            alignItems: 'center',
                            pointerEvents: 'none'
                          }}
                        >
                          <Text style={{ fontSize: 20, lineHeight: 20 }}>{cornerEmoji}</Text>
                        </View>
                      ));
                    })}
                </View>
              )}
            </View>
          </ViewShot>
        </View>

        {/* Plus Button Overlay - FLIPS SIDE BASED ON HAND MODE - Show when emoji plane tool is active - HIDDEN DURING EXPORT */}
        {!isExporting && emojiPlaneToolActive && (
          <TouchableOpacity
            style={{
              position: 'absolute',
              bottom: SCREEN_HEIGHT * 0.3,
              ...(handMode === 'left' ? { left: 20 } : { right: 20 }), // Right-hand: right, Left-hand: left
              width: 50,
              height: 50,
              borderRadius: 25,
              backgroundColor: '#ff6b6b',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.3,
              shadowRadius: 4,
              elevation: 5,
              zIndex: 100
            }}
            onPress={() => {
              createEmojiPlane();
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
            accessibilityRole="button"
            accessibilityLabel="Add new emoji plane"
          >
            <Text style={{ fontSize: 28, lineHeight: 32 }}>➕</Text>
          </TouchableOpacity>
        )}

        {/* Delete Button Overlay - FLIPS SIDE BASED ON HAND MODE - Show when a plane is selected - NEXT TO PLUS BUTTON */}
        {emojiPlaneToolActive && selectedPlaneId && (
          <TouchableOpacity
            style={{
              position: 'absolute',
              bottom: SCREEN_HEIGHT * 0.3,
              ...(handMode === 'left' ? { left: 80 } : { right: 80 }), // Positioned away from edge (20 + 50 + 10 gap)
              width: 50,
              height: 50,
              borderRadius: 25,
              backgroundColor: '#ef4444',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.3,
              shadowRadius: 4,
              elevation: 5,
              zIndex: 100
            }}
            onPress={() => {
              deleteSelectedPlane();
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            }}
            accessibilityRole="button"
            accessibilityLabel="Delete selected plane"
          >
            <Text style={{ fontSize: 28, lineHeight: 32 }}>🗑️</Text>
          </TouchableOpacity>
        )}

        {/* REC Button (SINGLE) - FLIPS SIDE - Same height as Play/Pause, opposite side of trash/plus */}
        {emojiPlaneToolActive && selectedPlaneId && (() => {
          const selectedPlane = emojiPlanes.find(p => p.id === selectedPlaneId);
          if (!selectedPlane) return null;

          // Check if current frame has a keyframe for this plane
          const relativeFrame = planeFrameDistance(selectedPlane.birthFrame, currentFrame, cropStart, cropEnd);
          const hasKeyframeAtCurrentFrame = selectedPlane.keyframes.some(kf => kf.frame === relativeFrame);

          return (
            <>
              {/* REC and Play/Pause Buttons - BOTH on left side next to each other */}
              <View
                style={{
                  position: 'absolute',
                  bottom: SCREEN_HEIGHT * 0.3, // SAME HEIGHT as plus/trash buttons
                  ...(handMode === 'left' ? { right: 20 } : { left: 20 }), // OPPOSITE side of plus/trash
                  flexDirection: 'row',
                  gap: 10,
                  zIndex: 100
                }}
              >
                {/* REC Button - Normal click for single keyframe, long-press for auto-recording */}
                <RNAnimated.View
                  style={{
                    transform: [{ scale: recButtonScale }]
                  }}
                >
                  <TouchableOpacity
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 25,
                      backgroundColor: isRecording ? '#ff3333' : '#ff8800',
                      borderWidth: 2,
                      borderColor: isRecording ? '#ff6666' : '#ffaa44',
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: isRecording ? 0.5 : 0.3,
                      shadowRadius: isRecording ? 8 : 4,
                      elevation: isRecording ? 8 : 5
                    }}
                    onPressIn={() => {
                      // Record press start time
                      recPressStartTimeRef.current = Date.now();

                      // Set up long-press timeout (500ms)
                      if (recLongPressTimeoutRef.current) {
                        clearTimeout(recLongPressTimeoutRef.current);
                      }

                      recLongPressTimeoutRef.current = setTimeout(() => {
                        // Long-press detected - enter recording mode
                        if (!isRecording && selectedPlane) {
                          setIsRecording(true);
                          setIsPlaying(true); // Start playing

                          // Start auto-keyframe interval (every 1 second)
                          if (recAutoKeyframeIntervalRef.current) {
                            clearInterval(recAutoKeyframeIntervalRef.current);
                          }

                          recAutoKeyframeIntervalRef.current = setInterval(() => {
                            stampKeyframe(selectedPlane.id);
                          }, 1000); // 1 second interval

                          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        }
                      }, 500);
                    }}
                    onPressOut={() => {
                      const pressDuration = Date.now() - recPressStartTimeRef.current;

                      // Clear long-press timeout if press was shorter than 500ms
                      if (recLongPressTimeoutRef.current) {
                        clearTimeout(recLongPressTimeoutRef.current);
                        recLongPressTimeoutRef.current = null;
                      }

                      // If press was short (< 500ms), record a single keyframe (normal behavior)
                      if (pressDuration < 500 && selectedPlane && !isRecording) {
                        // Click animation
                        RNAnimated.sequence([
                          RNAnimated.timing(recButtonScale, {
                            toValue: 0.9,
                            duration: 100,
                            useNativeDriver: true
                          }),
                          RNAnimated.timing(recButtonScale, {
                            toValue: 1.0,
                            duration: 100,
                            useNativeDriver: true
                          })
                        ]).start();

                        stampKeyframe(selectedPlane.id);
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      }
                      // If press was long (>= 500ms) and already recording, stop recording
                      else if (pressDuration >= 500 && isRecording) {
                        setIsRecording(false);
                        setIsPlaying(false); // Stop playing

                        // Clear auto-keyframe interval
                        if (recAutoKeyframeIntervalRef.current) {
                          clearInterval(recAutoKeyframeIntervalRef.current);
                          recAutoKeyframeIntervalRef.current = null;
                        }

                        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={isRecording ? 'Stop auto-recording keyframes' : 'Click: record keyframe, Long-press: start auto-recording'}
                  >
                    <Text style={{ fontSize: 20 }}>{isRecording ? '⏹' : '⏺'}</Text>
                  </TouchableOpacity>
                </RNAnimated.View>

                {/* Play/Pause Button - Next to REC button */}
                <TouchableOpacity
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 25,
                    backgroundColor: isPlaying ? '#22c55e' : '#1a1a1a',
                    borderWidth: 2,
                    borderColor: isPlaying ? '#4ade80' : '#444',
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.3,
                    shadowRadius: 4,
                    elevation: 5
                  }}
                  onPress={() => {
                    setIsPlaying(!isPlaying);
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={isPlaying ? 'Pause animation' : 'Play animation'}
                >
                  <Text style={{ fontSize: 24, fontWeight: 'bold' }}>{isPlaying ? '⏸️' : '▶️'}</Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}

        {/* Emoji Planes Sidebar - FLIPS SIDES BASED ON HAND MODE - 3x SMALLER, click thumbnail to open info */}
        {emojiPlanes.length > 0 && (
          <View
            style={{
              position: 'absolute',
              ...(handMode === 'left' ? { left: 10 } : { right: 10 }), // Right-hand: right side, Left-hand: left side
              top: SCREEN_HEIGHT * 0.15 + (IS_MOBILE ? 50 : 0), // iPhone: 50px lower, iPad: normal position
              bottom: SCREEN_HEIGHT * 0.3 + 70, // End above +/trash buttons (bottom position + button height + margin)
              width: 40, // 3x smaller (104 / 3 ≈ 35, rounded to 40 for better visibility)
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              borderRadius: 8,
              padding: 4,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.4,
              shadowRadius: 6,
              elevation: 5,
              zIndex: 100
            }}
          >
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ gap: 5 }}
              showsVerticalScrollIndicator={true}
            >
              {emojiPlanes.map((plane, index) => {
                const isSelected = plane.id === selectedPlaneId;
                // Check if plane is visible at current frame
                const isVisibleAtCurrentFrame = isPlaneVisibleAtFrame(
                  plane.birthFrame, plane.lifetime, currentFrame, cropStart, cropEnd,
                );
                // Color code based on visibility: Orange when visible, Gray when not visible
                const highlightColor = isVisibleAtCurrentFrame ? (isPlaying ? '#ff8800' : '#ef4444') : '#666666'; // Orange/Red : Gray
                return (
                  <TouchableOpacity
                    key={plane.id}
                    style={{
                      width: 32, // 3x smaller (83 / 3 ≈ 28, rounded to 32)
                      height: 32, // Square for emoji
                      backgroundColor: isSelected ? `${highlightColor}40` : 'rgba(255, 255, 255, 0.1)',
                      borderRadius: 6,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: isSelected ? 2 : 1, // Thinner borders for smaller size
                      borderColor: isSelected ? '#ffffff' : highlightColor,
                      overflow: 'hidden',
                      opacity: isVisibleAtCurrentFrame ? 1.0 : 0.5 // Dim when not visible
                    }}
                    onPress={() => {
                      // Select plane AND open info panel
                      setSelectedPlaneId(plane.id);
                      selectedPlaneIdRef.current = plane.id;
                      setPlaneInfoId(plane.id);
                      setPlaneInfoModalVisible(true);
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Open settings for plane ${index + 1}`}
                  >
                    <BrushEmojiIcon
                      emoji={plane.emoji}
                      size={20}
                      textStyle={{ fontSize: 20 }}
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Controls Panel */}
        <View style={styles.controlsPanel}>
          {/* Frame count input with play/pause and emoji picker - ALL IN ONE ROW */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 2, gap: 6 }}>
            {/* Frames label emoji - clickable to show video info */}
            <TouchableOpacity
              onPress={() => {
                if (videoUri && videoMetadata) {
                  CustomOverlayHelper.alert(
                    '🎬 Video Info',
                    `Frames: ${videoMetadata.frameCount}\nDuration: ${videoMetadata.duration.toFixed(1)}s\nFPS: ${videoMetadata.fps}\n\nMemory efficient: Using video directly (no frame extraction)`,
                    [{ text: 'OK' }]
                  );
                }
              }}
              disabled={!videoUri || !videoMetadata}
            >
              <Text style={{ fontSize: 20, opacity: (videoUri && videoMetadata) ? 1 : 0.4 }}>🎬</Text>
            </TouchableOpacity>

            {/* Frame count input */}
            <TextInput
              style={[styles.compactInput, { minWidth: 50 }]}
              value={frameCountEditing ? frameCountDraft : String(frameCount)}
              onFocus={beginFrameCountEdit}
              onChangeText={(text) => {
                setFrameCountDraft(text.replace(/[^0-9]/g, '').slice(0, 4));
                if (isValidFrameCount(text)) setFrameCount(Number(text));
              }}
              keyboardType="number-pad"
              maxLength={4}
              inputAccessoryViewID="framer-frame-count-input"
              returnKeyType="done"
              onSubmitEditing={() => { commitFrameCount(); Keyboard.dismiss(); }}
            />

            {/* Selected count */}
            <Text style={[styles.cropCount, { fontSize: 11 }]}>({cropEnd - cropStart})</Text>

            {/* Frame display */}
            <Text style={{ fontSize: 11, color: '#888', fontWeight: '600' }}>
              {currentFrame + 1}
            </Text>

            {/* iPad: Playback controls with centered play/pause, bigger buttons and gaps */}
            {!IS_MOBILE && (
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                marginLeft: 'auto',
                marginRight: 'auto'
              }}>
                {/* Frame step backward - visible when paused, invisible spacer when playing */}
                {!isPlaying ? (
                  <TouchableOpacity
                    style={{
                      backgroundColor: '#1a1a1a',
                      borderRadius: 8,
                      padding: 6,
                      borderWidth: 1,
                      borderColor: '#444',
                      minWidth: 42,
                      alignItems: 'center'
                    }}
                    onPress={stepFrameBackward}
                  >
                    <Text style={{ fontSize: 21 }}>⬅️</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: 54, height: 33 }} />
                )}

                {/* Play/Pause Button - Always visible */}
                <TouchableOpacity
                  style={{
                    backgroundColor: '#1a1a1a',
                    borderRadius: 8,
                    padding: 6,
                    borderWidth: 1,
                    borderColor: '#444',
                    minWidth: 42,
                    alignItems: 'center'
                  }}
                  onPress={togglePlayback}
                >
                  <Text style={{ fontSize: 21 }}>{isPlaying ? '⏸' : '▶'}</Text>
                </TouchableOpacity>

                {/* Frame step forward - visible when paused, invisible spacer when playing */}
                {!isPlaying ? (
                  <TouchableOpacity
                    style={{
                      backgroundColor: '#1a1a1a',
                      borderRadius: 8,
                      padding: 6,
                      borderWidth: 1,
                      borderColor: '#444',
                      minWidth: 42,
                      alignItems: 'center'
                    }}
                    onPress={stepFrameForward}
                  >
                    <Text style={{ fontSize: 21 }}>➡️</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: 54, height: 33 }} />
                )}
              </View>
            )}

            {/* Mobile: Frame step backward - only when paused */}
            {IS_MOBILE && !isPlaying && (
              <TouchableOpacity
                style={{
                  backgroundColor: '#1a1a1a',
                  borderRadius: 6,
                  padding: 4,
                  borderWidth: 1,
                  borderColor: '#444',
                  minWidth: 32,
                  alignItems: 'center'
                }}
                onPress={stepFrameBackward}
              >
                <Text style={{ fontSize: 16 }}>⬅️</Text>
              </TouchableOpacity>
            )}

            {/* Play/Pause Button - Mobile only */}
            {IS_MOBILE && (
              <TouchableOpacity
                style={{
                  backgroundColor: '#1a1a1a',
                  borderRadius: 6,
                  padding: 4,
                  borderWidth: 1,
                  borderColor: '#444',
                  minWidth: 32,
                  alignItems: 'center'
                }}
                onPress={togglePlayback}
              >
                <Text style={{ fontSize: 16 }}>{isPlaying ? '⏸' : '▶'}</Text>
              </TouchableOpacity>
            )}

            {/* Mobile: Frame step forward - only when paused */}
            {IS_MOBILE && !isPlaying && (
              <TouchableOpacity
                style={{
                  backgroundColor: '#1a1a1a',
                  borderRadius: 6,
                  padding: 4,
                  borderWidth: 1,
                  borderColor: '#444',
                  minWidth: 32,
                  alignItems: 'center'
                }}
                onPress={stepFrameForward}
              >
                <Text style={{ fontSize: 16 }}>➡️</Text>
              </TouchableOpacity>
            )}

            {/* Emoji Picker Button - Always show (same row) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <TouchableOpacity
                style={{ alignItems: 'center', justifyContent: 'center', padding: 2 }}
                onPress={() => {
                  setEmojiPickerVisible(true);
                }}
              >
                <RNAnimated.View style={{ transform: [{ scale: emojiScale }] }}>
                  <BrushEmojiIcon
                    emoji={localEmoji}
                    size={32}
                    textStyle={{ fontSize: 32 }}
                  />
                </RNAnimated.View>
              </TouchableOpacity>

              {/* Random Emoji Button (Dice) - Always show */}
              <TouchableOpacity
                style={{ alignItems: 'center', justifyContent: 'center', padding: 2 }}
                onPress={handleRandomEmoji}
              >
                <Text style={{ fontSize: 24 }}>🎲</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Mobile controls moved to top bar */}

          {/* ALL SLIDERS ROW - FPS, Length, Size */}
          <View style={[styles.allSlidersRow, !IS_MOBILE && isLandscape && { marginTop: 8 }]}>
            {/* FPS Slider - iPad only (mobile has it in top section) */}
            {!IS_MOBILE && (
              <CustomAnimatorSlider
                style={styles.compactSlider}
                label="⏱️"
                value={fps}
                minimumValue={1}
                maximumValue={60}
                step={1}
                onValueChange={setFps}
                onSlidingComplete={setFps}
                minimumTrackTintColor="#ff6b6b"
                thumbTintColor="#ff6b6b"
                valueFormatter={(v) => String(v)}
              />
            )}

            {/* Length Slider — isolated React.memo component, parent never re-renders on tick */}
            <FramerLengthSlider
              value={strokeLength}
              maxValue={frameCount}
              onRefUpdate={handleLengthRefUpdate}
              onPersist={handleLengthPersist}
              sliderStyle={styles.compactSlider}
              labelStyle={styles.compactSliderLabel}
              trackStyle={styles.compactSliderTrack}
            />

            {/* Size Slider — isolated React.memo component, parent never re-renders on tick */}
            <FramerSizeSlider
              value={brushSize}
              onRefUpdate={handleSizeRefUpdate}
              sliderStyle={styles.compactSlider}
              labelStyle={styles.compactSliderLabel}
              trackStyle={styles.compactSliderTrack}
            />

          </View>

          {/* Timeline - MOVED TO BOTTOM */}
          <Timeline
            frameCount={frameCount}
            currentFrame={currentFrame}
            cropStart={cropStart}
            cropEnd={cropEnd}
            onScrub={scrubToFrame}
            onCropChange={handleCropChange}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            emojiPlanes={emojiPlanes}
            selectedPlaneId={selectedPlaneId}
            emojiPlaneToolActive={emojiPlaneToolActive}
            isRecording={isRecording}
          />

          {/* Removed video info panel - details now shown by clicking 🎬 emoji */}
        </View>
      </View>

      {/* Settings Modal */}
      <Modal
        visible={settingsVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSettingsVisible(false)}
        supportedOrientations={['portrait', 'landscape']}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.settingsOverlay}>
            <View style={styles.settingsModal}>
              <ScrollView
                style={styles.settingsScroll}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 100 }}
              >
              {/* Header */}
              <View style={styles.settingsHeader}>
                <Text style={styles.settingsTitle}>⚙️ Framer Settings</Text>
                <TouchableOpacity
                  style={styles.settingsCloseButton}
                  onPress={() => setSettingsVisible(false)}
                >
                  <Text style={styles.settingsCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Export Quality Section */}
              <View style={styles.settingsSection}>
                <Text style={styles.settingsSectionTitle}>Export Quality</Text>
                <Text style={styles.settingsInfo}>Quality for GIF/MOV exports</Text>
                <Text style={styles.settingsHint}>Higher quality = larger file size</Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {([
                    { value: 'low', label: 'Low', size: '~170px' },
                    { value: 'high', label: 'High', size: '~510px' },
                    { value: 'ultra', label: 'Ultra', size: '~1024px' }
                  ] as const).map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderRadius: 8,
                        backgroundColor: exportQuality === option.value ? '#2d5016' : '#1a1a1a',
                        borderWidth: 2,
                        borderColor: exportQuality === option.value ? '#4ade80' : '#333',
                        alignItems: 'center'
                      }}
                      onPress={() => setExportQuality(option.value)}
                    >
                      <Text style={{ color: exportQuality === option.value ? '#4ade80' : '#888', fontWeight: '600' }}>
                        {option.label}
                      </Text>
                      <Text style={{ color: exportQuality === option.value ? '#4ade80' : '#666', fontSize: 11, marginTop: 2 }}>
                        {option.size}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Export Background — transparent vs a baked colour */}
              <View style={styles.settingsSection}>
                <Text style={styles.settingsSectionTitle}>Export Background</Text>
                <Text style={styles.settingsInfo}>
                  {exportBgMode === 'transparent'
                    ? 'Transparent — MOV keeps alpha only if this device can encode HEVC with alpha, otherwise it falls back to black. GIF supports 1-bit transparency only.'
                    : 'Colour is baked into every exported frame — identical result in GIF and MOV.'}
                </Text>

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  {([
                    { value: 'transparent', label: 'Transparent' },
                    { value: 'color', label: 'Colour' }
                  ] as const).map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 8,
                        alignItems: 'center',
                        backgroundColor: exportBgMode === option.value ? '#2d5016' : '#1a1a1a',
                        borderWidth: 2,
                        borderColor: exportBgMode === option.value ? '#4ade80' : '#333'
                      }}
                      onPress={() => setExportBgMode(option.value)}
                    >
                      <Text style={{ color: exportBgMode === option.value ? '#4ade80' : '#888', fontWeight: '600' }}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {exportBgMode === 'color' && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                    {(['#000000','#FFFFFF','#FF3B30','#FF9500','#FFCC00','#34C759','#007AFF','#AF52DE']).map((swatch) => (
                      <TouchableOpacity
                        key={swatch}
                        accessibilityRole="button"
                        accessibilityLabel={`Export background ${swatch}`}
                        onPress={() => setExportBgColor(swatch)}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 17,
                          backgroundColor: swatch,
                          borderWidth: exportBgColor === swatch ? 3 : 1,
                          borderColor: exportBgColor === swatch ? '#4ade80' : '#555'
                        }}
                      />
                    ))}
                  </View>
                )}
              </View>

              {/* Background Section */}
              <View style={styles.settingsSection}>
                <Text style={styles.settingsSectionTitle}>Background</Text>
                {(importedBackgroundStrokes.length > 0 || backgroundImageUri || workspaceSnapshotUri || videoUri) ? (
                  <View>
                    <Text style={styles.settingsInfo}>
                      {videoUri
                        ? `Video background (${videoMetadata?.frameCount || 0} frames @ ${videoMetadata?.fps || 0} FPS)`
                        : backgroundImageUri
                          ? 'Manual background image (50% opacity)'
                          : workspaceSnapshotUri
                            ? 'Workspace snapshot (50% opacity)'
                            : importedBackgroundStrokes.length > 0
                              ? `${importedBackgroundStrokes.length} background strokes`
                              : 'Background active'}
                    </Text>

                    {/* Hide/Show Background Toggle */}
                    <TouchableOpacity
                      style={[styles.settingsButton, { backgroundColor: showBackground ? '#1a1a1a' : '#666' }]}
                      onPress={() => {
                        setShowBackground(!showBackground);
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                    >
                      <Text style={styles.settingsButtonText}>
                        {showBackground ? '👁 Background Visible' : '👁‍🗨 Background Hidden'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.settingsButtonDanger}
                      onPress={handleRemoveBackground}
                    >
                      <Text style={styles.settingsButtonText}>Remove Background</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.settingsInfo}>No background active</Text>
                )}
                <TouchableOpacity
                  style={styles.settingsButton}
                  onPress={handleImportBackgroundImage}
                >
                  <Text style={styles.settingsButtonText}>Import Background Image</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.settingsButton, { backgroundColor: '#1e4620' }]}
                  onPress={handleImportVideo}
                >
                  <Text style={styles.settingsButtonText}>🎬 Import Video Background</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.settingsButton, { backgroundColor: '#000000' }]}
                  onPress={handleImportFromVideoStorage}
                >
                  <Text style={styles.settingsButtonText}>📁 Import from Video Storage</Text>
                </TouchableOpacity>
              </View>

              {/* Animation Settings Section */}
              <View style={styles.settingsSection}>
                <Text style={styles.settingsSectionTitle}>Animation Settings</Text>

                {/* FPS */}
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>FPS:</Text>
                  <TextInput
                    style={styles.settingsInput}
                    value={fps.toString()}
                    onChangeText={(text) => {
                      const num = parseInt(text, 10);
                      if (!isNaN(num) && num >= 1 && num <= 60) {
                        setFps(num);
                      }
                    }}
                    keyboardType="number-pad"
                  />
                </View>

                {/* Stroke Length */}
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>Stroke Length (frames):</Text>
                  <TextInput
                    style={styles.settingsInput}
                    value={strokeLength.toString()}
                    onChangeText={(text) => {
                      const num = parseInt(text, 10);
                      if (!isNaN(num) && num >= 1 && num <= frameCount) {
                        setStrokeLength(num);
                      }
                    }}
                    keyboardType="number-pad"
                  />
                </View>

                {/* Total Frame Count - Enhanced with Done Button */}
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>Total Frames:</Text>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    {/* Display current value above input */}
                    <Text style={{ fontSize: 14, color: '#a855f7', fontWeight: 'bold', marginBottom: 4 }}>
                      Current: {frameCount}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput
                        style={[styles.settingsInput, { flex: 1 }]}
                        value={frameCountEditing ? frameCountDraft : String(frameCount)}
                        onFocus={beginFrameCountEdit}
                        onChangeText={(text) => {
                          setFrameCountDraft(text.replace(/[^0-9]/g, '').slice(0, 4));
                          if (isValidFrameCount(text)) setFrameCount(Number(text));
                        }}
                        keyboardType="number-pad"
                        placeholder="1-5000"
                        placeholderTextColor="#666"
                        returnKeyType="done"
                        inputAccessoryViewID="framer-frame-count-input"
                        onSubmitEditing={() => { commitFrameCount(); Keyboard.dismiss(); }}
                      />
                      {/* Done button above keyboard */}
                      <TouchableOpacity
                        style={{
                          backgroundColor: '#fff',
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderRadius: 8,
                          justifyContent: 'center',
                          alignItems: 'center'
                        }}
                        onPress={() => {
                          commitFrameCount();
                          Keyboard.dismiss();
                        }}
                      >
                        <Text style={{ color: '#000', fontSize: 12, fontWeight: 'bold' }}>✓ Done</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>

              {/* Project Management Section - REMOVED */}
              {/* Use ExportScreen for project management instead */}

              {/* Close Button */}
              <TouchableOpacity
                style={styles.settingsButtonPrimary}
                onPress={() => setSettingsVisible(false)}
              >
                <Text style={styles.settingsButtonText}>Done</Text>
              </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <InputAccessoryView nativeID="framer-frame-count-input">
        <View style={{ backgroundColor: '#111', padding: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: '#444' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>Frames</Text>
          <TextInput
            style={{ flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1, borderColor: '#fff', backgroundColor: '#000', color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center', paddingHorizontal: 12 }}
            value={frameCountDraft}
            onChangeText={(text) => {
              const clean = text.replace(/[^0-9]/g, '').slice(0, 4);
              setFrameCountDraft(clean);
              if (isValidFrameCount(clean)) setFrameCount(Number(clean));
            }}
            keyboardType="number-pad"
            returnKeyType="done"
            selectTextOnFocus
            onSubmitEditing={() => { commitFrameCount(); Keyboard.dismiss(); }}
            accessibilityLabel="Frame count being edited"
          />
          <TouchableOpacity
            onPress={() => { commitFrameCount(); Keyboard.dismiss(); }}
            style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#000', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 }}
          >
            <Text style={{ color: '#000', fontWeight: '800' }}>Close Keyboard</Text>
          </TouchableOpacity>
        </View>
      </InputAccessoryView>

      {/* Portfolio Projects Picker Modal (UNIFIED SYSTEM) */}
      <Modal
        visible={portfolioPickerVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setPortfolioPickerVisible(false);
          setSettingsVisible(true);
        }}
        supportedOrientations={['portrait', 'landscape']}
      >
        <View style={styles.settingsOverlay}>
          <View style={[styles.settingsModal, { maxHeight: '80%' }]}>
            <ScrollView style={styles.settingsScroll}>
              {/* Header */}
              <View style={styles.settingsHeader}>
                <Text style={styles.settingsTitle}>📂 Load from Portfolio</Text>
                <TouchableOpacity
                  style={styles.settingsCloseButton}
                  onPress={() => {
                    setPortfolioPickerVisible(false);
                    setSettingsVisible(true);
                  }}
                >
                  <Text style={styles.settingsCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Projects List */}
              {portfolioProjects.length > 0 ? (
                <View>
                  {portfolioProjects.map((project) => {
                    // Debug logging for video preview
                    if (project.miniVideo) {
                    }

                    return (
                    <TouchableOpacity
                      key={project.name}
                      style={{
                        backgroundColor: '#2a2a2a',
                        borderRadius: 12,
                        padding: 12,
                        marginBottom: 12,
                        marginHorizontal: 16,
                        borderWidth: 2,
                        borderColor: '#444',
                        flexDirection: 'row',
                        alignItems: 'center'
                      }}
                      onPress={() => void loadFromPortfolio(project.name)}
                    >
                      {/* Preview: Show mini video autoplay if available, else show image, else emoji */}
                      <View style={{
                        width: 80,
                        height: 80,
                        borderRadius: 8,
                        marginRight: 12,
                        backgroundColor: '#1a1a1a',
                        justifyContent: 'center',
                        alignItems: 'center',
                        overflow: 'hidden'
                      }}>
                        {project.miniVideo && project.miniVideo.trim().length > 0 ? (
                          // 🎬 Show autoplay video preview if available
                          <Video
                            source={{ uri: project.miniVideo }}
                            style={{
                              width: '100%',
                              height: '100%',
                              borderRadius: 8
                            }}
                            resizeMode={ResizeMode.CONTAIN}
                            isLooping={true}
                            shouldPlay={true}
                            useNativeControls={false}
                            progressUpdateIntervalMillis={500}
                            onError={(error: any) => {
                              console.warn('[FRAMER VIDEO] Error playing video:', error);
                            }}
                          />
                        ) : project.preview ? (
                          // Fallback to static image for older projects
                          <Image
                            source={{ uri: project.preview }}
                            style={{
                              width: '100%',
                              height: '100%',
                              borderRadius: 8
                            }}
                            resizeMode="cover"
                          />
                        ) : (
                          // Placeholder if no preview
                          <Text style={{ fontSize: 32, color: '#666' }}>🎬</Text>
                        )}
                      </View>

                      {/* Project Info */}
                      <View style={{ flex: 1 }}>
                        <Text style={{
                          fontSize: 16,
                          color: '#fff',
                          fontWeight: 'bold',
                          fontFamily: 'vrtlfinal'
                        }}>
                          {project.name}
                        </Text>
                        <Text style={{
                          fontSize: 12,
                          color: '#aaa',
                          marginTop: 4,
                          fontFamily: 'vrtlfinal'
                        }}>
                          {project.miniVideo ? '🎬 Animated preview' : '📸 Static preview'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
                  <Text style={{
                    color: '#aaa',
                    fontSize: 14,
                    textAlign: 'center',
                    fontFamily: 'vrtlfinal'
                  }}>
                    No projects with Framer data found
                  </Text>
                </View>
              )}

              {/* Close Button */}
              <TouchableOpacity
                style={[styles.settingsButtonPrimary, { marginHorizontal: 16, marginTop: 20 }]}
                onPress={() => {
                  setPortfolioPickerVisible(false);
                  setSettingsVisible(true);
                }}
              >
                <Text style={styles.settingsButtonText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Video Storage Picker Modal */}
      <Modal
        visible={videoStoragePickerVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setVideoStoragePickerVisible(false);
          setSettingsVisible(true);
        }}
        supportedOrientations={['portrait', 'landscape']}
      >
        <View style={styles.settingsOverlay}>
          <View style={[styles.settingsModal, { maxHeight: '70%' }]}>
            <ScrollView style={styles.settingsScroll}>
              {/* Header */}
              <View style={styles.settingsHeader}>
                <Text style={styles.settingsTitle}>📁 Video Storage</Text>
                <TouchableOpacity
                  style={styles.settingsCloseButton}
                  onPress={() => {
                    setVideoStoragePickerVisible(false);
                    setSettingsVisible(true);
                  }}
                >
                  <Text style={styles.settingsCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.settingsInfo, { marginBottom: 20 }]}>
                Select a video to import as background frames
              </Text>

              {/* Loading State */}
              {loadingStorageVideos && (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <Text style={{ color: '#888', fontSize: 16 }}>Loading videos...</Text>
                </View>
              )}

              {/* Empty State */}
              {!loadingStorageVideos && storageVideos.length === 0 && (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <Text style={{ color: '#888', fontSize: 16, textAlign: 'center' }}>
                    No videos in storage.{'\n'}Create videos in the Video Editor first.
                  </Text>
                </View>
              )}

              {/* Video Grid */}
              {!loadingStorageVideos && storageVideos.length > 0 && (
                <View style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 12,
                  paddingBottom: 20
                }}>
                  {storageVideos.map((video) => (
                    <TouchableOpacity
                      key={video.id}
                      onPress={() => handleSelectStorageVideo(video)}
                      style={{
                        width: 140,
                        backgroundColor: '#1a1a1a',
                        borderRadius: 12,
                        overflow: 'hidden',
                        borderWidth: 2,
                        borderColor: '#333'
                      }}
                    >
                      {/* Static Video Preview (no glitching) */}
                      <View style={{ alignItems: 'center', paddingTop: 8 }}>
                        <VideoStoragePreview video={video} />
                      </View>

                      {/* Video Info */}
                      <View style={{ padding: 8 }}>
                        <Text style={{
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: '600',
                          marginBottom: 4
                        }} numberOfLines={1}>
                          {video.name || 'Untitled'}
                        </Text>
                        <Text style={{ color: '#888', fontSize: 11 }}>
                          {(video.duration / 1000).toFixed(1)}s • {video.frameCount} frames
                        </Text>
                        <Text style={{ color: '#666', fontSize: 10, marginTop: 2 }}>
                          {video.fps} FPS
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Cancel Button */}
              <TouchableOpacity
                style={[styles.settingsButton, { backgroundColor: '#333', marginTop: 10 }]}
                onPress={() => {
                  setVideoStoragePickerVisible(false);
                  setSettingsVisible(true);
                }}
              >
                <Text style={styles.settingsButtonText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Full-featured Emoji Picker Modal - Exact clone with all features (mirror, rotation, custom brushes, etc.) */}
      <EmojiPickerModal
        visible={emojiPickerVisible}
        styles={pickerStyles}
        emojiSearch={emojiSearch}
        onEmojiSearchChange={setEmojiSearch}
        recentEmojis={recentEmojis}
        brushEmoji={localEmoji}
        emojiResults={emojiResults}
        onSelectEmoji={(emoji: string) => {
          handleEmojiPickerSelect(emoji);
          setEmojiPickerVisible(false);
        }}
        onLoadCustomBrushToWorkspace={undefined}
        onClose={() => {
          setEmojiPickerVisible(false);
          setEmojiSearch('');
        }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        mirrorX={framerMirrorX}
        mirrorY={framerMirrorY}
        rotation={framerRotation}
        onToggleMirrorX={handleToggleFramerMirrorX}
        onToggleMirrorY={handleToggleFramerMirrorY}
        spacingSlider={undefined}
        onTurnLeft={handleTurnFramerLeft}
        onTurnRight={handleTurnFramerRight}
        onTurnRightLongPress={handleTurnFramerRightLongPress}
        autoRotateEnabled={autoRotateEnabled}
      />

      {/* Video Trimming Modal - FULLSCREEN OVERLAY ON TOP OF SETTINGS AND STORAGE PICKER */}
      <Modal
        visible={videoTrimModalVisible}
        animationType="slide"
        transparent={true}
        statusBarTranslucent={true}
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => {
          setVideoTrimModalVisible(false);
          // Settings stays open - no need to restore it
        }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)' }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingTop: 60,
            paddingBottom: 20,
            backgroundColor: '#1a1a1a',
            borderBottomWidth: 2,
            borderBottomColor: '#4ade80'
          }}>
            <Text style={{ fontSize: 24, color: '#fff', fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
              ✂️ Trim Video
            </Text>
            <TouchableOpacity
              onPress={() => {
                setVideoTrimModalVisible(false);
                // Settings stays visible underneath
              }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: '#333',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          >
            <Text style={{ color: '#aaa', fontSize: 14, marginBottom: 20, fontFamily: 'vrtlfinal' }}>
              Select the portion of video to import
            </Text>

            {/* Video Preview with Crop/Pan/Zoom Controls */}
            {selectedVideoUri && (() => {
              const { width, height } = Dimensions.get('window');
              const isIPad = Platform.OS === 'ios' && (width >= 768 || height >= 768);
              const isLandscape = width > height;
              const videoPreviewWidth = (isIPad && isLandscape) ? '30%' : '100%'; // 70% smaller on iPad landscape

              return (
                <View>
                  <View style={{
                    width: videoPreviewWidth,
                    aspectRatio: 1,
                    marginBottom: 12,
                    borderRadius: 12,
                    overflow: 'hidden',
                    backgroundColor: '#0a0a0a',
                    borderWidth: 2,
                    borderColor: '#4ade80',
                    alignSelf: 'center'
                  }}>
                  <PanGestureHandler onGestureEvent={onPanGestureEvent}>
                    <Animated.View style={{ width: '100%', height: '100%' }}>
                      <PinchGestureHandler onGestureEvent={onPinchGestureEvent}>
                        <Animated.View style={[{ width: '100%', height: '100%' }, cropAnimatedStyle]}>
                          <Video
                            source={{ uri: selectedVideoUri }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode={ResizeMode.COVER}
                            shouldPlay
                            isLooping
                            isMuted
                            useNativeControls={false}
                          />
                        </Animated.View>
                      </PinchGestureHandler>
                    </Animated.View>
                  </PanGestureHandler>
                </View>

                {/* Crop/Zoom Instructions and Reset Button */}
                <View style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 20,
                  paddingHorizontal: 12,
                  padding: 10,
                  backgroundColor: '#1a1a1a',
                  borderRadius: 8
                }}>
                  <Text style={{ color: '#4ade80', fontSize: 11, flex: 1, fontFamily: 'vrtlfinal' }}>
                    📌 Pinch to zoom • Drag to pan
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      // Reset crop/pan/zoom
                      cropScale.value = withSpring(1.0);
                      cropTranslateX.value = withSpring(0);
                      cropTranslateY.value = withSpring(0);
                      cropBaseScale.value = 1.0;
                      setVideoCropScale(1.0);
                      setVideoCropOffsetX(0);
                      setVideoCropOffsetY(0);
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      backgroundColor: '#333',
                      borderRadius: 6
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'vrtlfinal' }}>
                      Reset
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}

            {/* Duration Info */}
            <View style={{ marginBottom: 20, padding: 12, backgroundColor: '#1a1a1a', borderRadius: 8 }}>
              <Text style={{ color: '#4ade80', fontSize: 14, marginBottom: 4, fontFamily: 'vrtlfinal' }}>
                Video Duration: {selectedVideoDuration.toFixed(1)}s
              </Text>
              <Text style={{ color: '#888', fontSize: 12, fontFamily: 'vrtlfinal' }}>
                Selected: {trimStart.toFixed(1)}s to {trimEnd.toFixed(1)}s ({(trimEnd - trimStart).toFixed(1)}s)
              </Text>
              <Text style={{ color: '#666', fontSize: 11, marginTop: 4, fontFamily: 'vrtlfinal' }}>
                Frames: ~{Math.floor((trimEnd - trimStart) * fps)} at {fps} FPS
              </Text>
            </View>

            {/* Start Time Slider */}
            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: '#fff', fontSize: 14, marginBottom: 8, fontFamily: 'vrtlfinal' }}>
                Start: {trimStart.toFixed(1)}s
              </Text>
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={0}
                maximumValue={selectedVideoDuration}
                value={trimStart}
                onValueChange={(value) => {
                  const newStart = Math.min(value, trimEnd - 0.1); // Keep at least 0.1s gap
                  setTrimStart(newStart);
                }}
                minimumTrackTintColor="#4ade80"
                maximumTrackTintColor="#333"
                thumbTintColor="#4ade80"
                step={0.1}
              />
            </View>

            {/* End Time Slider */}
            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: '#fff', fontSize: 14, marginBottom: 8, fontFamily: 'vrtlfinal' }}>
                End: {trimEnd.toFixed(1)}s
              </Text>
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={0}
                maximumValue={selectedVideoDuration}
                value={trimEnd}
                onValueChange={(value) => {
                  const newEnd = Math.max(value, trimStart + 0.1); // Keep at least 0.1s gap
                  setTrimEnd(newEnd);
                }}
                minimumTrackTintColor="#4ade80"
                maximumTrackTintColor="#333"
                thumbTintColor="#4ade80"
                step={0.1}
              />
            </View>

            {/* FPS Control - Slider */}
            <View style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'vrtlfinal' }}>
                  FPS (Frames Per Second)
                </Text>
                <Text style={{ color: '#4ade80', fontSize: 16, fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                  {fps}
                </Text>
              </View>
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={6}
                maximumValue={60}
                value={fps}
                onValueChange={(value) => {
                  const roundedFps = Math.round(value);
                  setFps(roundedFps);
                }}
                minimumTrackTintColor="#4ade80"
                maximumTrackTintColor="#333"
                thumbTintColor="#4ade80"
                step={1}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: '#666', fontSize: 10, fontFamily: 'vrtlfinal' }}>
                  6 FPS (slow)
                </Text>
                <Text style={{ color: '#666', fontSize: 10, fontFamily: 'vrtlfinal' }}>
                  60 FPS (smooth)
                </Text>
              </View>
              <Text style={{ color: '#888', fontSize: 11, marginTop: 8, textAlign: 'center', fontFamily: 'vrtlfinal' }}>
                Higher FPS = smoother animation, more frames
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: 16,
                  backgroundColor: '#333',
                  borderRadius: 12,
                  alignItems: 'center'
                }}
                onPress={() => {
                  setVideoTrimModalVisible(false);
                  // Settings stays visible
                }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: 16,
                  backgroundColor: '#1e4620',
                  borderRadius: 12,
                  alignItems: 'center'
                }}
                onPress={() => {
                  void handleProcessTrimmedVideo();
                }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                  ✓ Import
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Export Format Selection Modal (In-Game) */}
      {exportFormatVisible && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 15000,
          paddingHorizontal: 10
        }}>
          <View style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 24,
            padding: 24,
            width: '100%',
            maxWidth: 500,
            alignItems: 'center',
            borderWidth: 2,
            borderColor: '#4ade80',
            maxHeight: '90%'
          }}>
            {/* Header */}
            <Text style={{ fontSize: 32, marginBottom: 12 }}>📤</Text>
            <Text style={{ fontSize: 26, color: '#fff', marginBottom: 8, fontWeight: 'bold', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
              Export Animation
            </Text>
            <Text style={{ fontSize: 13, color: '#888', marginBottom: 24, textAlign: 'center', fontFamily: 'vrtlfinal' }}>
              {cropEnd - cropStart} frames • Quality: {exportQuality}
            </Text>

            {/* Animation Info Section - no preview playback */}
            <View style={{
              width: '100%',
              backgroundColor: '#1a1a1a',
              borderRadius: 16,
              borderWidth: 2,
              borderColor: '#4ade80',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 20,
              paddingVertical: 16,
              paddingHorizontal: 12
            }}>
              <Text style={{ color: '#4ade80', fontFamily: 'vrtlfinal', fontSize: 14, fontWeight: 'bold', marginBottom: 4 }}>
                {cropEnd - cropStart} frames ready
              </Text>
              <Text style={{ color: '#888', fontFamily: 'vrtlfinal', fontSize: 11 }}>
                Adjust FPS slider below to preview video duration
              </Text>
            </View>

            {/* FPS Slider Section with Duration */}
            <View style={{ width: '100%', marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: '#888', fontFamily: 'vrtlfinal', fontSize: 13 }}>Playback FPS</Text>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <Text style={{ color: '#4ade80', fontFamily: 'vrtlfinal', fontSize: 16, fontWeight: 'bold' }}>
                    {exportDialogFPS} FPS
                  </Text>
                  <View style={{ backgroundColor: 'rgba(74, 222, 128, 0.2)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: '#4ade80', fontFamily: 'vrtlfinal', fontSize: 12, fontWeight: 'bold' }}>
                      {Math.round((cropEnd - cropStart) / exportDialogFPS)}s
                    </Text>
                  </View>
                </View>
              </View>
              <View style={{
                height: 40,
                backgroundColor: '#2a2a2a',
                borderRadius: 10,
                justifyContent: 'center',
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor: '#4ade80'
              }}>
                <Slider
                  style={{ width: '100%', height: 30 }}
                  minimumValue={1}
                  maximumValue={60}
                  step={1}
                  value={exportDialogFPS}
                  onValueChange={setExportDialogFPS}
                  minimumTrackTintColor="#4ade80"
                  maximumTrackTintColor="#444"
                  thumbTintColor="#4ade80"
                />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: 4 }}>
                <Text style={{ color: '#666', fontSize: 11, fontFamily: 'vrtlfinal' }}>1 FPS (slow)</Text>
                <Text style={{ color: '#666', fontSize: 11, fontFamily: 'vrtlfinal' }}>60 FPS (fast)</Text>
              </View>
              <Text style={{ color: '#666', fontSize: 10, fontFamily: 'vrtlfinal', marginTop: 8, textAlign: 'center' }}>
                {cropEnd - cropStart} frames → {Math.round((cropEnd - cropStart) / exportDialogFPS)}s video
              </Text>
            </View>

            {/* Export Options Grid */}
            <View style={{ width: '100%', marginBottom: 8 }}>
              {/* GIF Option */}
              <TouchableOpacity
                style={{
                  width: '100%',
                  backgroundColor: '#4ade80',
                  borderRadius: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  marginBottom: 10,
                  alignItems: 'center'
                }}
                onPress={() => {
                  setExportFormatVisible(false);
                  setFps(exportDialogFPS); // Apply FPS before export
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setTimeout(() => void handleExportGIF(), 100);
                }}
              >
                <Text style={{ fontSize: 16, color: '#000', fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                  🎞️ GIF Sequence
                </Text>
              </TouchableOpacity>

              {/* MOV Option */}
              <TouchableOpacity
                style={{
                  width: '100%',
                  backgroundColor: '#60a5fa',
                  borderRadius: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  marginBottom: 10,
                  alignItems: 'center'
                }}
                onPress={() => {
                  setExportFormatVisible(false);
                  setFps(exportDialogFPS); // Apply FPS before export
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setTimeout(() => void handleExportMOV(), 100);
                }}
              >
                <Text style={{ fontSize: 16, color: '#fff', fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                  🎬 MOV Sequence
                </Text>
              </TouchableOpacity>

              {/* ✅ REMOVED: Save Animation button - users now export MOV directly instead */}
            </View>

            {/* Cancel Button */}
            <TouchableOpacity
              style={{
                width: '100%',
                backgroundColor: '#333',
                borderRadius: 12,
                paddingVertical: 12,
                paddingHorizontal: 16,
                alignItems: 'center'
              }}
              onPress={() => {
                setExportFormatVisible(false);
                setIsExportPreviewPlaying(true); // Reset to playing
                void Haptics.selectionAsync();
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: cancelTextColor,
                  fontFamily: 'vrtlfinal',
                  textShadowColor: cancelTextShadow ? 'rgba(255, 0, 0, 0.8)' : 'transparent',
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: cancelTextShadow ? 8 : 0
                }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Export/Import Progress Overlay */}
      {(isExporting || isImporting) && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#000000',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000
        }}
        pointerEvents="auto"
        >
          <View style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 20,
            padding: 30,
            width: '80%',
            maxWidth: 400,
            alignItems: 'center',
            borderWidth: 2,
            borderColor: '#4ade80'
          }}>
            {/* Show rotating preview frames if available, otherwise show animated logo */}
            {exportPreviewFrames.length > 0 ? (
              <Image
                source={{ uri: exportPreviewFrames[currentPreviewIndex] }}
                style={{
                  width: 180,
                  height: 180,
                  marginBottom: 20,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: '#4ade80'
                }}
                resizeMode="cover"
              />
            ) : (
              /* Animated logo frames - GROW from 100% to 150-350% during export/import (random based on frame count, reduced to half intensity) */
              exportLogoSet && (() => {
                const baseSize = 84;
                // Smooth easing: ease-out-cubic for smooth deceleration
                const easedProgress = 1 - Math.pow(1 - exportProgress, 3);
                const growthFactor = 1 + (easedProgress * (exportMaxGrowth - 1)); // 1x at 0%, exportMaxGrowth at 100%
                const currentSize = baseSize * growthFactor;

                // Render video logo
                if (exportLogoSet.type === 'video') {
                  return (
                    <Video
                      source={exportLogoSet.videoSource}
                      style={{
                        width: currentSize,
                        height: currentSize,
                        marginBottom: 20
                      }}
                      resizeMode={ResizeMode.CONTAIN}
                      shouldPlay={true}
                      isLooping={true}
                      isMuted={true}
                    />
                  );
                }

                // Render image frame animation
                return (
                  <Image
                    source={exportLogoFrameIndex === 0 ? exportLogoSet.baseIcon : exportLogoSet.frames[exportLogoFrameIndex - 1]}
                    style={{
                      width: currentSize,
                      height: currentSize,
                      marginBottom: 20
                    }}
                    resizeMode="contain"
                  />
                );
              })()
            )}

            <Text style={{ fontSize: 24, color: '#fff', marginBottom: 20, fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
              {isImporting ? 'Importing and Creating Frames...' : 'Exporting...'}
            </Text>

            {/* Progress bar */}
            <View style={{
              width: '100%',
              height: 30,
              backgroundColor: '#333',
              borderRadius: 15,
              overflow: 'hidden',
              marginBottom: 15
            }}>
              <View style={{
                width: `${exportProgress * 100}%`,
                height: '100%',
                backgroundColor: '#4ade80',
                borderRadius: 15
              }} />
            </View>

            <Text style={{ fontSize: 16, color: '#888', fontFamily: 'vrtlfinal' }}>
              {Math.round(exportProgress * 100)}% Complete
            </Text>

            <Text style={{ fontSize: 12, color: '#666', marginTop: 10, textAlign: 'center', fontFamily: 'vrtlfinal' }}>
              {isImporting
                ? `Creating frame ${importingFrameIndex} of ${importingFrameTotal}...`
                : `Rendering ${cropEnd - cropStart} frames...`
              }
            </Text>

            {/* Abort Export Button */}
            <TouchableOpacity
              style={{
                marginTop: 20,
                paddingHorizontal: 30,
                paddingVertical: 12,
                backgroundColor: '#ef4444',
                borderRadius: 10,
                zIndex: 10001 // Above overlay
              }}
              activeOpacity={0.7}
              pointerEvents="auto"
              onPress={() => {
                exportAbortRef.current = true;
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }}
            >
              <Text style={{ fontSize: 16, color: '#fff', fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>❌ Abort Export</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Save Animation Loader Modal */}
      {showSaveAnimationLoaderModal && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000
        }}
        pointerEvents="box-only"
        >
          <View style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 20,
            padding: 30,
            width: '80%',
            maxWidth: 400,
            alignItems: 'center',
            borderWidth: 2,
            borderColor: '#a855f7'
          }}>
            <Text style={{ fontSize: 28, marginBottom: 20 }}>💾</Text>
            <Text style={{ fontSize: 20, color: '#fff', marginBottom: 15, fontWeight: 'bold', fontFamily: 'vrtlfinal', textAlign: 'center' }}>
              {saveAnimationLoaderMessage}
            </Text>
            <ActivityIndicator size="large" color="#a855f7" />
            <Text style={{ fontSize: 12, color: '#666', marginTop: 20, textAlign: 'center', fontFamily: 'vrtlfinal' }}>
              This may take a moment...
            </Text>
          </View>
        </View>
      )}

      {/* Custom Export Success Modal (In-Game, not native alert) */}
      {exportSuccessVisible && exportSuccessData && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 20000
        }}>
          <View style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 20,
            padding: 30,
            width: '85%',
            maxWidth: 450,
            alignItems: 'center',
            borderWidth: 2,
            borderColor: '#4ade80'
          }}>
            <Text style={{ fontSize: 40, marginBottom: 15 }}>✅</Text>

            <Text style={{ fontSize: 24, color: '#fff', marginBottom: 10, fontWeight: 'bold', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
              {exportSuccessData.type === 'gif' ? 'GIF Created!' : 'Video Created!'}
            </Text>

            {/* Video Preview - Looping autoplay (for both MOV and GIF) */}
            {exportSuccessData.fileUri && (
              <View style={{
                width: '100%',
                aspectRatio: 1,
                marginBottom: 15,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: '#000'
              }}>
                <Video
                  source={{ uri: exportSuccessData.fileUri.startsWith('file://') ? exportSuccessData.fileUri : `file://${exportSuccessData.fileUri}` }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay
                  isLooping
                  isMuted
                  useNativeControls={false}
                />
              </View>
            )}

            <Text style={{ fontSize: 14, color: '#888', marginBottom: 20, textAlign: 'center', fontFamily: 'vrtlfinal' }}>
              Saved to "EmojiPaint Exports" album in Photos
              {exportSuccessData.type === 'mov' && '\n& Video Storage'}
            </Text>

            <View style={{
              backgroundColor: '#2a2a2a',
              padding: 15,
              borderRadius: 10,
              width: '100%',
              marginBottom: 25
            }}>
              <Text style={{ fontSize: 13, color: '#4ade80', textAlign: 'center', marginBottom: 8, fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                Export Settings
              </Text>
              <Text style={{ fontSize: 12, color: '#aaa', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
                {exportSuccessData.frameCount} frames • {exportSuccessData.quality} quality
              </Text>
              <Text style={{ fontSize: 12, color: '#aaa', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
                {exportSuccessData.fps} FPS • {exportSuccessData.loop ? 'Loop ∞' : 'Play once'}
              </Text>
            </View>

            {/* Action Buttons Row */}
            <View style={{ width: '100%', gap: 10 }}>
              {/* Share and Video Storage buttons side-by-side */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {/* Share Button */}
                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 15,
                    backgroundColor: '#4ade80',
                    borderRadius: 12
                  }}
                  onPress={async () => {
                    setExportSuccessVisible(false);
                    await shareExport(exportSuccessData.fileUri, exportSuccessData.type);
                  }}
                >
                  <Text style={{ fontSize: 16, color: '#000', fontWeight: 'bold', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
                    📤 Share
                  </Text>
                </TouchableOpacity>

                {/* Video Storage Button - only for MOV exports */}
                {exportSuccessData.type === 'mov' && exportSuccessData.videoMetaId && (
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      paddingVertical: 15,
                      backgroundColor: '#3b82f6',
                      borderRadius: 12
                    }}
                    onPress={() => {
                      setExportSuccessVisible(false);
                      void Haptics.selectionAsync();
                      // Close Framer first, then navigate to Video Storage
                      onClose();
                      setTimeout(() => {
                        (navigation as any).navigate('VideoStorage', {
                          initialScrollToId: exportSuccessData.videoMetaId
                        });
                      }, 350);
                    }}
                  >
                    <Text style={{ fontSize: 16, color: '#fff', fontWeight: 'bold', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
                      📁 Storage
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Done Button */}
              <TouchableOpacity
                style={{
                  width: '100%',
                  paddingVertical: 15,
                  backgroundColor: '#333',
                  borderRadius: 12
                }}
                onPress={() => {
                  setExportSuccessVisible(false);
                  void Haptics.selectionAsync();
                }}
              >
                <Text style={{ fontSize: 16, color: '#fff', fontWeight: 'bold', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
                  Done
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Saved Frames Picker Modal (In-Game) */}
      <Modal
        visible={savedSlotsPickerVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setSavedSlotsPickerVisible(false)}
        supportedOrientations={['portrait', 'landscape']}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <View style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 20,
            padding: 25,
            width: '90%',
            maxWidth: 500,
            maxHeight: '80%',
            borderWidth: 2,
            borderColor: '#4ade80'
          }}>
            <Text style={{ fontSize: 24, color: '#fff', marginBottom: 20, fontWeight: 'bold', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
              📂 Load Saved Frames
            </Text>

            {/* Scrollable list of saved slots */}
            <ScrollView style={{ maxHeight: 400, marginBottom: 20 }}>
              {savedSlots.length === 0 ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: '#888', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
                    No saved frames found.
                    {'\n'}
                    Save some frames first!
                  </Text>
                </View>
              ) : (
                savedSlots.map((slot) => (
                  <View
                    key={slot.id}
                    style={{
                      backgroundColor: '#2a2a2a',
                      borderRadius: 12,
                      padding: 15,
                      marginBottom: 12,
                      borderWidth: 1,
                      borderColor: '#4ade80'
                    }}
                  >
                    <Text style={{ fontSize: 16, color: '#fff', fontWeight: 'bold', marginBottom: 8, fontFamily: 'vrtlfinal' }}>
                      {slot.name}
                    </Text>

                    <Text style={{ fontSize: 13, color: '#aaa', marginBottom: 4, fontFamily: 'vrtlfinal' }}>
                      🎬 {slot.frameCount} frames • 🎨 {slot.totalStamps} stamps
                    </Text>

                    <Text style={{ fontSize: 12, color: '#888', marginBottom: 12, fontFamily: 'vrtlfinal' }}>
                      📅 {new Date(slot.savedAt).toLocaleString()}
                    </Text>

                    {/* Load and Delete buttons */}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity
                        style={{
                          flex: 1,
                          paddingVertical: 10,
                          backgroundColor: '#4ade80',
                          borderRadius: 8,
                          alignItems: 'center'
                        }}
                        onPress={() => {
                          void loadSlotById(slot.id);
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        }}
                      >
                        <Text style={{ fontSize: 14, color: '#000', fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                          ✅ Load
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={{
                          flex: 1,
                          paddingVertical: 10,
                          backgroundColor: '#ef4444',
                          borderRadius: 8,
                          alignItems: 'center'
                        }}
                        onPress={() => {
                          CustomOverlayHelper.alert(
                            '⚠️ Delete Saved Frames',
                            `Delete "${slot.name}"?`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: () => {
                                  void deleteSlot(slot.id);
                                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                }
                              }
                            ]
                          );
                        }}
                      >
                        <Text style={{ fontSize: 14, color: '#fff', fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                          🗑️ Delete
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            {/* Cancel button */}
            <TouchableOpacity
              style={{
                width: '100%',
                paddingVertical: 15,
                backgroundColor: '#333',
                borderRadius: 12
              }}
              onPress={() => {
                setSavedSlotsPickerVisible(false);
                void Haptics.selectionAsync();
              }}
            >
              <Text style={{ fontSize: 16, color: '#fff', fontWeight: 'bold', textAlign: 'center', fontFamily: 'vrtlfinal' }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Topic Challenge Timer Overlay - Draggable, top-right, with X to end early */}
      {activeChallenge && (
        <Animated.View
          style={[{
            position: 'absolute',
            top: IS_MOBILE ? 72 : 84,
            right: IS_MOBILE ? 52 : 60,
            zIndex: 50000,
          }, framerTimerAnimatedStyle]}
        >
          <View
            style={{
              backgroundColor: 'rgba(10, 10, 10, 0.92)',
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 8,
              alignItems: 'center',
              borderWidth: 2,
              borderColor: challengeRemainingMs <= 0 ? '#ff6b6b' : '#82ffa1',
              shadowColor: '#000',
              shadowOpacity: 0.5,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 12,
              flexDirection: 'row',
              gap: 8,
            }}
          >
            {/* Drag handle — pan to move */}
            <View
              {...(() => {
                const { PanResponder } = require('react-native');
                return PanResponder.create({
                  onStartShouldSetPanResponder: () => true,
                  onMoveShouldSetPanResponder: () => true,
                  onPanResponderGrant: () => {
                    framerTimerDragStartX.current = framerTimerX.value;
                    framerTimerDragStartY.current = framerTimerY.value;
                  },
                  onPanResponderMove: (_: any, gs: any) => {
                    framerTimerX.value = framerTimerDragStartX.current + gs.dx;
                    framerTimerY.value = framerTimerDragStartY.current + gs.dy;
                  },
                }).panHandlers;
              })()}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginRight: 2 }}>⠿</Text>
              <Text style={{
                fontSize: IS_MOBILE ? 18 : 22,
                fontWeight: '800',
                color: challengeRemainingMs <= 0 ? '#ff6b6b' : '#82ffa1',
                fontFamily: 'vrtlfinal'
              }}>
                {challengeRemainingMs <= 0 ? '00:00' : (() => {
                  const totalSeconds = Math.ceil(challengeRemainingMs / 1000);
                  const minutes = Math.floor(totalSeconds / 60);
                  const seconds = Math.max(0, totalSeconds % 60);
                  const mm = minutes.toString().padStart(2, '0');
                  const ss = seconds.toString().padStart(2, '0');
                  return `${mm}:${ss}`;
                })()}
              </Text>
            </View>
            {/* X button — early hand-in */}
            <TouchableOpacity
              onPress={() => {
                if (challengeRemainingMs > 0 && !challengeEarlyUploadUnlocked) {
                  return;
                }
                setShowChallengeUploadConfirm(true);
                void Haptics.selectionAsync();
              }}
              disabled={challengeRemainingMs > 0 && !challengeEarlyUploadUnlocked}
              accessibilityState={{ disabled: challengeRemainingMs > 0 && !challengeEarlyUploadUnlocked }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: challengeRemainingMs > 0 && !challengeEarlyUploadUnlocked
                  ? 'rgba(120,120,120,0.22)'
                  : 'rgba(255,80,80,0.25)',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: challengeRemainingMs > 0 && !challengeEarlyUploadUnlocked ? 0.55 : 1,
              }}
            >
              <Text style={{
                fontSize: 13,
                color: challengeRemainingMs > 0 && !challengeEarlyUploadUnlocked ? '#999' : '#ff6b6b',
                fontWeight: '900',
                lineHeight: 16,
              }}>✕</Text>
            </TouchableOpacity>
          </View>
          {challengeRemainingMs > 0 && !challengeEarlyUploadUnlocked ? (
            <Text style={{
              color: '#aaa',
              fontSize: 9,
              fontFamily: 'vrtlfinal',
              textAlign: 'center',
              marginTop: 4,
            }}>
              {`Paint ${challengeEarlyUploadStrokesRemaining} more emoji stroke${challengeEarlyUploadStrokesRemaining === 1 ? '' : 's'} to upload early`}
            </Text>
          ) : null}
        </Animated.View>
      )}

      {/* Challenge Warning Modal - shown before clearing frames */}
      {showChallengeWarningModal && (
        <View style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.92)',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 70000,
          padding: 24
        }}>
          <View style={{
            backgroundColor: '#111',
            borderRadius: 28,
            padding: 32,
            maxWidth: 460,
            width: '100%',
            borderWidth: 2,
            borderColor: 'rgba(255,255,255,0.08)',
            alignItems: 'center',
            gap: 8
          }}>
            <Text style={{ fontSize: 48, marginBottom: 4 }}>🎬</Text>
            <Text style={{
              fontSize: 22, fontWeight: '900', color: '#fff',
              textAlign: 'center', fontFamily: 'vrtlfinal', marginBottom: 6
            }}>
              Framers Clears Your Canvas
            </Text>
            <Text style={{
              fontSize: 15, color: 'rgba(255,255,255,0.55)',
              textAlign: 'center', lineHeight: 22, marginBottom: 20
            }}>
              Opening Framers resets the 90-frame workspace.{'\n'}Your current challenge painting stays safe.
            </Text>

            {/* Resume — go back to painting */}
            <TouchableOpacity
              onPress={handleChallengeClose}
              style={{
                width: '100%',
                backgroundColor: '#1db954',
                borderRadius: 16,
                paddingVertical: 18,
                alignItems: 'center',
                marginBottom: 10,
                shadowColor: '#1db954',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 10
              }}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', fontFamily: 'vrtlfinal' }}>
                RESUME PAINTING
              </Text>
            </TouchableOpacity>

            {/* Enter Framers — destructive */}
            <TouchableOpacity
              onPress={handleChallengeEnter}
              style={{
                width: '100%',
                backgroundColor: '#c0392b',
                borderRadius: 16,
                paddingVertical: 18,
                alignItems: 'center',
                shadowColor: '#c0392b',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 10
              }}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', fontFamily: 'vrtlfinal' }}>
                ENTER FRAMERS
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Challenge Completion Overlay (Hoorah!) */}
      {challengeCompletionVisible && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 100001
        }}>
          <View style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 24,
            padding: 30,
            width: '85%',
            maxWidth: 500,
            alignItems: 'center',
            borderWidth: 3,
            borderColor: '#4ade80'
          }}>
            {/* Celebration Header */}
            <Text style={{ fontSize: 48, marginBottom: 10 }}>🎉</Text>
            <Text style={{
              fontSize: 28,
              color: '#fff',
              fontWeight: 'bold',
              textAlign: 'center',
              marginBottom: 8,
              fontFamily: 'vrtlfinal'
            }}>
              Hoorah!
            </Text>
            <Text style={{
              fontSize: 16,
              color: '#888',
              textAlign: 'center',
              marginBottom: 24,
              fontFamily: 'vrtlfinal'
            }}>
              Challenge completed! 🎬
            </Text>

            {/* Video Preview or Loading */}
            <View style={{
              width: '100%',
              aspectRatio: 1,
              backgroundColor: '#000',
              borderRadius: 16,
              overflow: 'hidden',
              marginBottom: 24,
              borderWidth: 2,
              borderColor: '#333',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              {challengeCompletedVideoUri ? (
                <>
                  <Video
                    source={{ uri: challengeCompletedVideoUri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay={true}
                    isLooping={true}
                    isMuted={false}
                    useNativeControls={false}
                    volume={1.0}
                    onError={(error) => {
                      console.error('[FRAMER HOORAH] ❌ Video load error:', error);
                      console.error('[FRAMER HOORAH] Failed URI:', challengeCompletedVideoUri);
                    }}
                    onPlaybackStatusUpdate={(_status) => {
                    }}
                  />
                </>
              ) : (
                <>
                  <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
                    <ActivityIndicator size="large" color="#4ade80" />
                    <Text style={{
                      fontSize: 14,
                      color: '#4ade80',
                      marginTop: 16,
                      fontFamily: 'vrtlfinal',
                      fontWeight: 'bold'
                    }}>
                      {challengeExportStatus}
                    </Text>
                    {/* Progress Bar */}
                    <View style={{
                      width: 200,
                      height: 6,
                      backgroundColor: '#333',
                      borderRadius: 3,
                      marginTop: 12,
                      overflow: 'hidden'
                    }}>
                      <View style={{
                        width: `${(exportProgress * 100).toFixed(0)}%`,
                        height: '100%',
                        backgroundColor: '#4ade80',
                        borderRadius: 3
                      }} />
                    </View>
                    <Text style={{
                      fontSize: 11,
                      color: '#888',
                      marginTop: 8,
                      fontFamily: 'vrtlfinal'
                    }}>
                      {(exportProgress * 100).toFixed(0)}%
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Stats */}
            <View style={{
              flexDirection: 'row',
              gap: 20,
              marginBottom: 24,
              justifyContent: 'center'
            }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 11, color: '#888', marginBottom: 4, fontFamily: 'vrtlfinal' }}>Frames</Text>
                <Text style={{ fontSize: 18, color: '#4ade80', fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                  {cropEnd - cropStart}
                </Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 11, color: '#888', marginBottom: 4, fontFamily: 'vrtlfinal' }}>FPS</Text>
                <Text style={{ fontSize: 18, color: '#4ade80', fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                  {fps || 30}
                </Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 11, color: '#888', marginBottom: 4, fontFamily: 'vrtlfinal' }}>Duration</Text>
                <Text style={{ fontSize: 18, color: '#4ade80', fontWeight: 'bold', fontFamily: 'vrtlfinal' }}>
                  {challengeCompletedVideoDuration ? (challengeCompletedVideoDuration / 1000).toFixed(1) : '-'}s
                </Text>
              </View>
            </View>

            {/* Upload Button - Only show when video is ready */}
            {challengeCompletedVideoUri && challengeUploadStatus !== 'success' && (
              <TouchableOpacity
                style={{
                  backgroundColor: challengeUploadStatus === 'uploading' ? '#666' : '#4ade80',
                  borderRadius: 12,
                  paddingVertical: 16,
                  paddingHorizontal: 30,
                  width: '100%',
                  alignItems: 'center',
                  marginBottom: 12,
                  opacity: challengeUploadStatus === 'uploading' ? 0.6 : 1
                }}
                disabled={challengeUploadStatus === 'uploading'}
                onPress={async () => {
                  if (onChallengeComplete) {
                    try {
                      setChallengeUploadStatus('uploading');
                      await onChallengeComplete(challengeCompletedVideoUri, challengeCompletedVideoDuration);

                      setChallengeUploadStatus('success');
                      // Don't auto-close - show success panel with buttons
                    } catch (error) {
                      console.error('[FRAMER CHALLENGE] ❌ Upload failed:', error);
                      console.error('[FRAMER CHALLENGE] Error details:', {
                        message: error instanceof Error ? error.message : String(error),
                        videoUri: challengeCompletedVideoUri,
                        videoDuration: challengeCompletedVideoDuration
                      });

                      setChallengeUploadStatus('error');

                      // Show detailed error message
                      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
                      CustomOverlayHelper.alert(
                        'Upload Failed',
                        `${errorMsg}\n\nCheck console for details.\n\nVideo URI: ${challengeCompletedVideoUri?.substring(0, 50)}...`,
                        [{ text: 'OK' }]
                      );

                      // Reset upload status after showing error
                      setTimeout(() => {
                        setChallengeUploadStatus('idle');
                      }, 3000);
                    }
                  } else {
                    console.warn('[FRAMER CHALLENGE] No onChallengeComplete callback provided');
                    CustomOverlayHelper.alert('Upload Not Available', 'No upload callback configured');
                  }
                }}
              >
                {challengeUploadStatus === 'uploading' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{
                    fontSize: 18,
                    color: '#000',
                    fontWeight: 'bold',
                    fontFamily: 'vrtlfinal'
                  }}>
                    📤 Upload to Gallery
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Success Message with Action Buttons */}
            {challengeUploadStatus === 'success' && (
              <>
                <View style={{
                  backgroundColor: '#4ade80',
                  borderRadius: 12,
                  paddingVertical: 16,
                  paddingHorizontal: 30,
                  width: '100%',
                  alignItems: 'center',
                  marginBottom: 20
                }}>
                  <Text style={{
                    fontSize: 18,
                    color: '#000',
                    fontWeight: 'bold',
                    fontFamily: 'vrtlfinal'
                  }}>
                    ✅ Uploaded Successfully!
                  </Text>
                </View>

                {/* Back to Framers Button */}
                <TouchableOpacity
                  style={{
                    backgroundColor: '#3b82f6',
                    borderRadius: 12,
                    paddingVertical: 16,
                    paddingHorizontal: 30,
                    width: '100%',
                    alignItems: 'center',
                    marginBottom: 12
                  }}
                  onPress={() => {
                    setChallengeCompletionVisible(false);
                    setChallengeUploadStatus('idle');
                    // Stay in framers workspace
                  }}
                >
                  <Text style={{
                    fontSize: 18,
                    color: '#fff',
                    fontWeight: 'bold',
                    fontFamily: 'vrtlfinal'
                  }}>
                    ← Back to Framers
                  </Text>
                </TouchableOpacity>

                {/* View in Gallery Button */}
                <TouchableOpacity
                  style={{
                    backgroundColor: '#10b981',
                    borderRadius: 12,
                    paddingVertical: 16,
                    paddingHorizontal: 30,
                    width: '100%',
                    alignItems: 'center',
                    marginBottom: 12
                  }}
                  onPress={async () => {
                    setChallengeCompletionVisible(false);
                    setChallengeUploadStatus('idle');
                    // Wait for the parent to finish closing Framer before
                    // navigating. Otherwise Framer's native Modal can remain
                    // above the gallery and swallow every touch.
                    await onClose();
                    await new Promise(resolve => setTimeout(resolve, 480));
                    navigation.navigate('Paint' as any, { openGallery: true });
                  }}
                >
                  <Text style={{
                    fontSize: 18,
                    color: '#fff',
                    fontWeight: 'bold',
                    fontFamily: 'vrtlfinal'
                  }}>
                    🏛️ View in Gallery
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {/* Close Button - Only show when not success */}
            {challengeUploadStatus !== 'success' && (
              <TouchableOpacity
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 20,
                  width: '100%',
                  alignItems: 'center'
                }}
                onPress={() => {
                  setChallengeCompletionVisible(false);
                  onClose(); // Close Framer workspace
                }}
              >
                <Text style={{
                  fontSize: 14,
                  color: '#888',
                  fontFamily: 'vrtlfinal'
                }}>
                  {challengeCompletedVideoUri ? 'Close' : 'Cancel'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* PLANE INFO PANEL - Compact overlay with background dim */}
      {planeInfoModalVisible && planeInfoId && (() => {
        const plane = emojiPlanes.find(p => p.id === planeInfoId);
        if (!plane) return null;

        const planeIndex = emojiPlanes.findIndex(p => p.id === planeInfoId);
        const startFrame = normalizePlaneFrame(plane.birthFrame, cropStart, cropEnd) + 1;
        const endFrame = planeLastVisibleFrame(plane.birthFrame, plane.lifetime, cropStart, cropEnd) + 1;
        const lifetimeMax = planeTimelineLength(cropStart, cropEnd);
        const effectiveLifetime = clampPlaneLifetime(plane.lifetime, cropStart, cropEnd);
        const wrapsTimeline = planeLifetimeWraps(plane.birthFrame, effectiveLifetime, cropStart, cropEnd);

        return (
          <>
            {/* Background Dim - Click to close */}
            <TouchableOpacity
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                zIndex: 99999
              }}
              activeOpacity={1}
              onPress={() => setPlaneInfoModalVisible(false)}
            />

            {/* Panel - Positioned on right/left side based on hand mode */}
            <View style={{
              position: 'absolute',
              top: 100,
              ...(handMode === 'left' ? { left: 60 } : { right: 60 }), // Next to planes list (40px + 20px margin)
              width: 300,
              maxHeight: '80%',
              backgroundColor: 'rgba(20, 20, 20, 0.98)',
              borderRadius: 12,
              padding: 16,
              borderWidth: 2,
              borderColor: '#4ade80',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.5,
              shadowRadius: 12,
              zIndex: 100000
            }}>
              <ScrollView showsVerticalScrollIndicator={true}>
                {/* Header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <BrushEmojiIcon
                    emoji={plane.emoji}
                    size={32}
                    textStyle={{ fontSize: 32 }}
                  />
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    {/* Visibility Toggle Button */}
                    <TouchableOpacity
                      onPress={() => togglePlaneVisibility(plane.id)}
                      style={{
                        padding: 6,
                        borderRadius: 6,
                        backgroundColor: plane.visible !== false ? '#4ade80' : '#666',
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}
                    >
                      <Text style={{ fontSize: 18 }}>
                        {plane.visible !== false ? '👁️' : '🚫'}
                      </Text>
                    </TouchableOpacity>
                    {/* Close Button */}
                    <TouchableOpacity onPress={() => setPlaneInfoModalVisible(false)}>
                      <Text style={{ fontSize: 20 }}>❎</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* VISUAL TIMELINE - Shows plane block and keyframes */}
                <View style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ color: '#888', fontSize: 11, fontWeight: '600' }}>
                      TIMELINE: Frames {startFrame}→{endFrame} ({effectiveLifetime}/{lifetimeMax}{wrapsTimeline ? ', wraps' : ''})
                    </Text>
                    {/* Play/Pause Toggle Button */}
                    <TouchableOpacity
                      onPress={() => {
                        setIsPlaying(!isPlaying);
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      }}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 4,
                        borderRadius: 6,
                        backgroundColor: isPlaying ? '#ff6b6b' : '#4ade80',
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}
                    >
                      <Text style={{ fontSize: 16, fontWeight: '600' }}>
                        {isPlaying ? '⏸' : '▶'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Timeline Track */}
                  <View style={{
                    height: 60,
                    backgroundColor: '#1a1a1a',
                    borderRadius: 6,
                    position: 'relative',
                    borderWidth: 1,
                    borderColor: '#333'
                  }}>
                    {/* Plane Active Block */}
                    <View style={{
                      position: 'absolute',
                      left: `${(plane.birthFrame / frameCount) * 100}%`,
                      width: `${(effectiveLifetime / frameCount) * 100}%`,
                      height: '100%',
                      backgroundColor: 'rgba(74, 222, 128, 0.3)',
                      borderWidth: 2,
                      borderColor: '#4ade80',
                      borderRadius: 4
                    }}>
                      {/* Keyframe Markers */}
                      {plane.keyframes.map((kf, idx) => {
                        const relativePos = (kf.frame / effectiveLifetime) * 100;
                        if (relativePos >= 0 && relativePos <= 100) {
                          return (
                            <View
                              key={idx}
                              style={{
                                position: 'absolute',
                                left: `${relativePos}%`,
                                top: 0,
                                bottom: 0,
                                width: 3,
                                backgroundColor: '#ff8800',
                                borderRadius: 1
                              }}
                            />
                          );
                        }
                        return null;
                      })}

                      {/* Block Label */}
                      <View style={{
                        flex: 1,
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}>
                        <BrushEmojiIcon
                          emoji={plane.emoji}
                          size={20}
                          textStyle={{
                            fontSize: 20,
                            color: '#fff',
                            textShadowColor: '#000',
                            textShadowOffset: { width: 1, height: 1 },
                            textShadowRadius: 2
                          }}
                        />
                      </View>
                    </View>

                    {/* Current Frame Indicator */}
                    <View style={{
                      position: 'absolute',
                      left: `${(currentFrame / frameCount) * 100}%`,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      backgroundColor: '#ef4444'
                    }} />
                  </View>
                </View>

                {/* Start Frame Slider */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: '#888', fontSize: 11, marginBottom: 4, fontWeight: '600' }}>START FRAME: {startFrame}</Text>
                  <CustomAnimatorSlider
                    style={{ width: '100%' }}
                    value={plane.birthFrame}
                    minimumValue={cropStart}
                    maximumValue={Math.max(cropStart, cropEnd - 1)}
                    step={1}
                    onValueChange={(value) => updatePlaneBirthFrame(plane.id, value)}
                    onSlidingComplete={(value) => updatePlaneBirthFrame(plane.id, value)}
                    minimumTrackTintColor="#4ade80"
                    thumbTintColor="#4ade80"
                  />
                </View>

                {/* Lifetime Slider */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: '#888', fontSize: 11, marginBottom: 4, fontWeight: '600' }}>LIFETIME: {effectiveLifetime}/{lifetimeMax} frames</Text>
                  <CustomAnimatorSlider
                    style={{ width: '100%' }}
                    value={effectiveLifetime}
                    minimumValue={1}
                    maximumValue={lifetimeMax}
                    step={1}
                    onValueChange={(value) => updatePlaneLifetime(plane.id, value)}
                    onSlidingComplete={(value) => updatePlaneLifetime(plane.id, value)}
                    minimumTrackTintColor="#4ade80"
                    thumbTintColor="#4ade80"
                  />
                </View>

                {/* Scale Keyframes Toggle */}
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#2a2a2a',
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 12
                  }}
                  onPress={() => setScaleKeyframesWithLength(!scaleKeyframesWithLength)}
                >
                  <Text style={{ color: '#fff', fontSize: 12 }}>Scale Keyframes with Length</Text>
                  <View style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    backgroundColor: scaleKeyframesWithLength ? '#4ade80' : '#444',
                    borderWidth: 2,
                    borderColor: '#fff',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {scaleKeyframesWithLength && <Text style={{ color: '#000', fontSize: 14 }}>✓</Text>}
                  </View>
                </TouchableOpacity>

                {/* Keyframe Scale Slider */}
                {plane.keyframes.length > 0 && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: '#888', fontSize: 11, marginBottom: 4, fontWeight: '600' }}>SCALE KEYFRAMES: {keyframeScaleValue.toFixed(1)}x</Text>
                    <CustomAnimatorSlider
                      style={{ width: '100%' }}
                      value={keyframeScaleValue}
                      minimumValue={0.1}
                      maximumValue={2.0}
                      step={0.1}
                      onValueChange={(value) => setKeyframeScaleValue(value)}
                      onSlidingComplete={(value) => {
                        setEmojiPlanes(prev => prev.map(p => {
                          if (p.id !== plane.id) return p;
                          return { ...p, keyframes: p.keyframes.map(kf => ({ ...kf, frame: Math.round(kf.frame * value) })) };
                        }));
                        emojiPlanesRef.current = emojiPlanesRef.current.map(p => {
                          if (p.id !== plane.id) return p;
                          return { ...p, keyframes: p.keyframes.map(kf => ({ ...kf, frame: Math.round(kf.frame * value) })) };
                        });
                        setKeyframeScaleValue(1.0);
                      }}
                      minimumTrackTintColor="#ff8800"
                      thumbTintColor="#ff8800"
                    />
                  </View>
                )}

                {/* Opacity Slider */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: '#888', fontSize: 11, marginBottom: 4, fontWeight: '600' }}>OPACITY: {Math.round(plane.opacity * 100)}%</Text>
                  <CustomAnimatorSlider
                    style={{ width: '100%' }}
                    value={plane.opacity}
                    minimumValue={0}
                    maximumValue={1}
                    step={0.05}
                    onValueChange={(value) => updatePlaneOpacity(plane.id, value)}
                    onSlidingComplete={(value) => updatePlaneOpacity(plane.id, value)}
                    minimumTrackTintColor="#4ade80"
                    thumbTintColor="#4ade80"
                  />
                </View>

                {/* Layer Hierarchy Controls */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: '#888', fontSize: 11, marginBottom: 6, fontWeight: '600' }}>LAYER</Text>

                  {/* Hierarchy controls - Move planes up/down in the list */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        backgroundColor: '#333',
                        borderRadius: 8,
                        padding: 10,
                        alignItems: 'center',
                        opacity: planeIndex === emojiPlanes.length - 1 ? 0.5 : 1
                      }}
                      onPress={() => {
                        if (planeIndex < emojiPlanes.length - 1) {
                          // Move down in list (swap with next plane)
                          const newPlanes = [...emojiPlanes];
                          [newPlanes[planeIndex], newPlanes[planeIndex + 1]] = [newPlanes[planeIndex + 1], newPlanes[planeIndex]];
                          setEmojiPlanes(newPlanes);
                          emojiPlanesRef.current = newPlanes;
                          saveToUndoStack();
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }
                      }}
                      disabled={planeIndex === emojiPlanes.length - 1}
                    >
                      <Text style={{ fontSize: 16 }}>⬇️ Down</Text>
                    </TouchableOpacity>

                    <Text style={{ color: '#888', fontSize: 12, minWidth: 40, textAlign: 'center' }}>#{planeIndex + 1}</Text>

                    <TouchableOpacity
                      style={{
                        flex: 1,
                        backgroundColor: '#333',
                        borderRadius: 8,
                        padding: 10,
                        alignItems: 'center',
                        opacity: planeIndex === 0 ? 0.5 : 1
                      }}
                      onPress={() => {
                        if (planeIndex > 0) {
                          // Move up in list (swap with previous plane)
                          const newPlanes = [...emojiPlanes];
                          [newPlanes[planeIndex - 1], newPlanes[planeIndex]] = [newPlanes[planeIndex], newPlanes[planeIndex - 1]];
                          setEmojiPlanes(newPlanes);
                          emojiPlanesRef.current = newPlanes;
                          saveToUndoStack();
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }
                      }}
                      disabled={planeIndex === 0}
                    >
                      <Text style={{ fontSize: 16 }}>⬆️ Up</Text>
                    </TouchableOpacity>
                  </View>

                </View>

                {/* Keyframes Count */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: '#888', fontSize: 11, marginBottom: 4, fontWeight: '600' }}>KEYFRAMES</Text>
                  <Text style={{ color: '#fff', fontSize: 14 }}>{plane.keyframes.length} keyframe{plane.keyframes.length !== 1 ? 's' : ''}</Text>
                </View>

                {/* Delete All Keyframes Button */}
                {plane.keyframes.length > 0 && (
                  <TouchableOpacity
                    style={{ backgroundColor: '#ff8800', borderRadius: 8, padding: 10, alignItems: 'center', marginBottom: 8 }}
                    onPress={() => {
                      setEmojiPlanes(prev => prev.map(p => p.id === plane.id ? { ...p, keyframes: [] } : p));
                      emojiPlanesRef.current = emojiPlanesRef.current.map(p => p.id === plane.id ? { ...p, keyframes: [] } : p);
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#fff' }}>🗑️ Delete All Keyframes</Text>
                  </TouchableOpacity>
                )}

                {/* Delete Plane Button */}
                <TouchableOpacity
                  style={{ backgroundColor: '#ef4444', borderRadius: 8, padding: 10, alignItems: 'center' }}
                  onPress={() => {
                    deletePlane(plane.id);
                    setPlaneInfoModalVisible(false);
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#fff' }}>🗑️ Delete Plane</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </>
        );
      })()}
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingTop: 40
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: 12,
    paddingRight: 48,
    paddingVertical: 8,
    gap: 8,
    zIndex: 1000,
    elevation: 1000 // Android elevation
  },
  topActionButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#333'
  },
  topActionButtonActive: {
    backgroundColor: '#2a2a2a',
    borderColor: '#4ade80'
  },
  topActionButtonWarning: {
    backgroundColor: '#3a1a1a',
    borderColor: '#ff6b6b'
  },
  topActionButtonEmoji: {
    fontSize: 24
  },
  closeButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeButtonText: {
    fontSize: 32
  },
  emojiButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 20
  },
  emojiButtonText: {
    fontSize: 24
  },
  canvasContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    position: 'relative'
  },
  checkerboard: {
    position: 'absolute',
    backgroundColor: 'transparent', // Transparent so onion skin layers are visible
    // Create checkerboard pattern via border
    borderWidth: 1,
    borderColor: '#333'
  },
  drawingIndicator: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8
  },
  drawingText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600'
  },
  allSlidersRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 4, // Reduced from 12 to bring slider closer to first row
    paddingBottom: 0, // Reduced from 2 to bring timeline even closer
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap', // Allow wrapping in portrait mode
    width: '100%'
  },
  compactSlider: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'stretch',
    minWidth: 100 // Prevent sliders from becoming too narrow
  },
  compactSliderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 4
  },
  compactSliderTrack: {
    width: '100%',
    height: 30
  },
  inlineLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    minWidth: 70
  },
  durationInfo: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '600'
  },
  lifetimeHint: {
    fontSize: 10,
    color: '#4ade80',
    textAlign: 'center',
    marginBottom: 8,
    fontStyle: 'italic'
  },
  // Floating transport controls
  floatingTransport: {
    backgroundColor: 'rgba(26, 26, 26, 0.95)',
    borderRadius: 20,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 2,
    borderColor: '#444'
  },
  dragHandle: {
    alignItems: 'center',
    marginBottom: 8
  },
  dragIndicator: {
    width: 40,
    height: 4,
    backgroundColor: '#666',
    borderRadius: 2
  },
  transportButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  transportButton: {
    width: 40,
    height: 40,
    backgroundColor: '#333',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center'
  },
  transportButtonText: {
    fontSize: 20
  },
  transportPlayButton: {
    width: 60,
    height: 60,
    backgroundColor: '#ff6b6b',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center'
  },
  transportPlayText: {
    fontSize: 32,
    color: '#fff'
  },
  transportFrameDisplay: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    textAlign: 'center',
    marginTop: 8
  },
  controlsPanel: {
    width: '100%', // Ensure it respects device width
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    gap: 4, // Reduced from 12 to bring rows closer
    zIndex: 1000,
    elevation: 1000 // Android elevation
  },
  frameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexWrap: 'wrap',
    gap: 8
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: 8,
    marginVertical: 8
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 70,
    borderWidth: 2,
    borderColor: '#444'
  },
  actionButtonActive: {
    backgroundColor: '#ff9f6b',
    borderColor: '#ff9f6b'
  },
  actionButtonWarning: {
    backgroundColor: '#ff4444',
    borderColor: '#ff4444'
  },
  actionButtonEmoji: {
    fontSize: 28,
    marginBottom: 4
  },
  actionButtonLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center'
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'space-between',
    flexWrap: 'wrap'
  },
  compactLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#aaa',
    marginBottom: 2
  },
  framesGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  compactInput: {
    width: 50,
    backgroundColor: '#2a2a2a',
    borderRadius: 6,
    padding: 6,
    fontSize: 14,
    color: '#fff',
    textAlign: 'center'
  },
  cropCount: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#ff8c00'
  },
  // Zoom controls
  zoomControls: {
    position: 'absolute',
    bottom: 16, // Positioned above bottom panel
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6, // Reduced from 8
    backgroundColor: 'rgba(26, 26, 26, 0.9)',
    borderRadius: 10, // Reduced from 12
    padding: 6, // Reduced from 8
    zIndex: 10
  },
  zoomButton: {
    width: 32, // Reduced from 40 (20% smaller)
    height: 32, // Reduced from 40 (20% smaller)
    backgroundColor: '#333',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center'
  },
  zoomButtonText: {
    fontSize: 13 // Reduced from 16 (about 20% smaller)
  },
  zoomLabel: {
    fontSize: 11, // Reduced from 14 (about 20% smaller)
    fontWeight: '600',
    color: '#fff',
    minWidth: 40, // Reduced from 50
    textAlign: 'center'
  },
  zoomResetButton: {
    backgroundColor: '#ff6b6b',
    paddingHorizontal: 10, // Reduced from 12
    paddingVertical: 6, // Reduced from 8
    borderRadius: 6 // Reduced from 8
  },
  zoomResetText: {
    fontSize: 10, // Reduced from 12 (about 20% smaller)
    fontWeight: '600',
    color: '#fff'
  },
  // Settings modal
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  settingsModal: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    width: '100%',
    maxWidth: 600,
    maxHeight: '90%'
  },
  settingsScroll: {
    padding: 20
  },
  settingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 2,
    borderBottomColor: '#333'
  },
  settingsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff'
  },
  settingsCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center'
  },
  settingsCloseText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold'
  },
  settingsSection: {
    marginBottom: 25,
    padding: 15,
    backgroundColor: '#2a2a2a',
    borderRadius: 12
  },
  settingsSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#4ade80',
    marginBottom: 12
  },
  settingsInfo: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 8
  },
  settingsHint: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    marginBottom: 12
  },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15
  },
  settingsSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  settingsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    minWidth: 100
  },
  settingsSlider: {
    flex: 1,
    height: 40
  },
  settingsInput: {
    backgroundColor: '#333',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
    minWidth: 70,
    borderWidth: 1,
    borderColor: '#444'
  },
  settingsButton: {
    backgroundColor: '#4ade80',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 10
  },
  settingsButtonDanger: {
    backgroundColor: '#ff6b6b',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 10
  },
  settingsButtonPrimary: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 14, // 5% smaller than 15
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10
  },
  settingsButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff'
  }
});

export default FramerWorkspace;
