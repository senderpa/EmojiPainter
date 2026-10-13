// @ts-nocheck - Legacy code with complex types (notification features are tested and working)
import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Pressable, Image, Dimensions, PanResponder, Alert, Modal, ScrollView, TextInput, FlatList, SectionList, type SectionListData, type FlatListProps, type ListRenderItemInfo, type LayoutChangeEvent, ActionSheetIOS, Platform, ActivityIndicator, Animated as RNAnimated, PixelRatio, Easing as RNEasing, KeyboardAvoidingView, Keyboard, AppState, type AppStateStatus, InteractionManager, NativeModules, useWindowDimensions, Switch, Linking } from 'react-native';
import { AppText as Text, AppEmoji } from '../emoji/AppText';
import { useEmojiSet } from '../emoji/EmojiSetContext';
import Slider from '@react-native-community/slider';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import ViewShot, { captureRef, type CaptureOptions } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing as ReanimatedEasing, executeOnUIRuntimeSync, runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Audio, Video, AVPlaybackStatus } from 'expo-av';
import ShortVideoPlayer from '../video/ShortVideoPlayer';
import { Asset } from 'expo-asset';
import Constants from 'expo-constants';
import * as Localization from '../lib/localization';
import { StackActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSessionId } from '../lib/session';
import * as ImageManipulator from 'expo-image-manipulator';
import { flushLifetimeActivity, startLifetimeActivity } from '../lib/lifetimeActivity';
import { useLifetimeActivity } from '../lib/useLifetimeActivity';
import {
  getLifetimeStats,
  mergeLifetimeStats,
  recordLifetimeStrokeCommit,
  resetLifetimeStats,
  setLifetimeCoins,
  subscribeToLifetimeStats,
} from '../lib/lifetimeStats';

import { SMUDGE_MAX_BRUSH_SIZE, MAX_STROKES, MAX_SMUDGE_STROKES, usePainting, orderStrokesByLayer, strokeLayer, strokesForLayer, PAINT_LAYER_ORDER, DEFAULT_PAINT_LAYER, DEFAULT_LAYER_VISIBILITY } from '../state/PaintingContext';
import type { Stroke, StrokePoint, TraceState, EmojiPlane, PlaneCornerSnapshot, PaintLayer, LayerVisibility } from '../state/PaintingContext';
import { useAppSettings } from '../context/AppSettingsContext';
import { smudgeEventThrottleMs, smudgeMaxBrushPixels, smudgeSpacing, smudgeStrength } from '../lib/smudge/smudgeTypes';
import {
  DEFAULT_SNAPSHOT_PROJECT_ID,
  FIRST_TIME_USER_KEY,
  SESSION_COUNT_KEY,
  RANDOM_GALLERY_ROUND_KEY,
  CANVAS_RATIO,
  IS_IPAD,
  BRUSH_SIZE_MAX,
  BRUSH_ROTATION_STEP,
  MIN_TRACE_SCALE,
  MAX_TRACE_SCALE,
  TRACE_DEFAULT_OPACITY,
  BRUSH_DIM_OPACITY,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE_MAIN,
  LARGE_HIT_SLOP,
  STROKE_WARNING_THRESHOLD,
  STROKE_CRITICAL_THRESHOLD,
  EMOJI_ITEM_HEIGHT,
  MAX_INTERPOLATED_POINTS,
  MINIMUM_POINT_SPACING,
  MIN_LINE_SPACING,
  MAX_LINE_POINTS,
  COIN_STORAGE_KEY,
  PRIVATE_STUDIO_STORAGE_KEY,
  PASSPORT_PORTRAIT_STORAGE_KEY,
  PASSPORT_PORTRAIT_SENT_STORAGE_KEY,
  PRIVATE_STUDIO_NAME_MAX,
  PRIVATE_STUDIO_DEFAULT_NAME,
  PRIVATE_STUDIO_DEFAULT_NAME_SHORT,
  PRIVATE_STUDIO_AUTOSAVE_DEBOUNCE_MS,
  PRIVATE_STUDIO_RANDOM_LOCK_KEY,
  GLOBAL_STATS_STORAGE_KEY,
  DEVICE_CREATED_AT_KEY,
  PASSPORT_PORTRAIT_SIZE,
  MAX_SNAPSHOT_SIDE,
  TARGET_SNAPSHOT_SIDE,
  LONG_STROKE_SNAPSHOT_SIDE,
  CHALLENGE_CAPTURE_MAX_SIDE,
  CHALLENGE_CAPTURE_TIMEOUT_MS,
  MIN_CHALLENGE_STROKES,
  TIMER_OVERLAY_MARGIN,
  TIMER_MIN_SCALE,
  TIMER_MAX_SCALE,
  PROMPT_CARD_WIDTH,
  PROMPT_CARD_HEIGHT,
  PROMPT_CARD_GAP,
  GALLERY_STALE_THRESHOLD_MS,
  GALLERY_PAGE_SIZE,
  GALLERY_FETCH_LIMIT,
  GALLERY_LANGUAGE_DEFAULT,
  PRIVATE_STUDIO_NAME_SUGGESTIONS,
  LANGUAGE_FLAG_MAP,
  PRESSURE_MIN_SPACING,
  PRESSURE_APPLY_SMOOTH,
  PRESSURE_RELEASE_SMOOTH,
  SPACING_SLIDER_MIN,
  SPACING_SLIDER_MAX,
  LINE_SPACING_THRESHOLD,
  LINE_SPACING_MULTIPLIER,
  MAX_NORMALIZED_SPACING,
  LONG_STROKE_SNAPSHOT_INTERVAL_MS,
  COIN_LEVELS,
  screenWidth,
  screenHeight,
  isLargeTablet,
  TOOL_SCALE,
  TOOL_BUTTON_PADDING_H,
  TOOL_BUTTON_PADDING_V,
  TOOL_MIN_WIDTH,
  TOOL_FONT_SIZE,
  QUICK_BUTTON_SIZE,
  QUICK_BUTTON_RADIUS,
  QUICK_EMOJI_SIZE,
  SLIDER_LABEL_MIN_WIDTH,
  SLIDER_VALUE_WIDTH,
  SPACING_VALUE_WIDTH,
  OVERLAY_SCALE,
  OVERLAY_BUTTON_WIDTH,
  OVERLAY_BUTTON_PADDING_H,
  OVERLAY_BUTTON_PADDING_V,
  OVERLAY_BUTTON_RADIUS,
  OVERLAY_FONT_SIZE,
  EMOJI_COLUMN_COUNT,
  PICKER_COLUMN_COUNT,
} from '../lib/paintConstants';
import { canUploadChallengeEarly, getChallengeStrokesRemaining } from '../lib/challengeUploadEligibility';
import PinLockModal from '../components/PinLockModal';
import FullscreenImageViewer from '../components/FullscreenImageViewer';
import EmojiPlaneCommitDialog from '../components/EmojiPlaneCommitDialog';
import EmojiPlanePanel, {
  EMOJI_PLANE_PANEL_WIDTH,
  type EmojiPlanePanelLayout,
} from '../components/EmojiPlanePanel';
import {
  latticeFromPlaneCorners, resampleLattice, latticeCorners, findLatticeHandle,
  movePlaneHandle, rotatePlaneGeometry, scalePlaneGeometry, translatePlaneGeometry,
  type LatticeLevel,
} from '../lib/planeLattice';
import { placePanelAwayFromRect } from '../lib/emojiPlanePanelPlacement';
import LayersPanel, { type LayerAction } from '../components/LayersPanel';
import VideoEditorComingSoonModal from '../components/VideoEditorComingSoonModal';
import TimeLimitWarningModal from '../components/TimeLimitWarningModal';
import FrameUploadModal from '../components/FrameUploadModal';
import DailyTopicsNotification from '../components/DailyTopicsNotification';
import type { GalleryVoteUpdate } from '../lib/galleryVoteUpdates';
import { recordGalleryVoteCheck } from '../lib/galleryVoteUpdates';

// Frame-by-frame animation types
interface AnimationFrame {
  id: string;
  strokes: Stroke[];
  timestamp: number;
  thumbnail?: string; // 96x96 low-res snapshot URI
  renderedImageUri?: string; // Full-res rendered image for fast playback (canvas size)
}

import { useWording } from '../wording/WordingContext';
import WordSelectionOverlay from '../wording/WordSelectionOverlay';
import CompletionOverlay from '../wording/CompletionOverlay';
import AnimatedLoader from '../components/AnimatedLoader';
import ClearConfirmOverlay from '../components/ClearConfirmOverlay';
import { LetterCompleteOverlay } from '../components/LetterCompleteOverlay';
import { CustomOverlayHelper } from '../components/CustomOverlay';
import PaintCanvas from '../workspace/PaintCanvas';
import TransparentEmojiCanvas from '../components/TransparentEmojiCanvas';
import BrushEmojiIcon from '../components/BrushEmojiIcon';
import PaintingWorkspace from '../workspace/PaintingWorkspace';
import WorkspaceToolbar from '../workspace/WorkspaceToolbar';
import LogoAnimationLoop from '../components/LogoAnimationLoop';
import AnimatedRandomEntry from '../components/AnimatedRandomEntry';
import FramerWorkspace from '../framer/FramerWorkspace';
import ArModeChooser from '../ar/ArModeChooser';
import ArPaintingScreen from '../ar/ArPaintingScreen';
// FaceMeshOverlay is conditionally required below (excluded from lite builds).
import { renderableEmojiEntries, searchRenderableEmojis } from '../lib/emojiCatalog';
import { measureEmojiSpan, measureSequenceSpan } from '../lib/emojiMetrics';
import { getCustomBrushes, saveCustomBrush, saveCustomBrushPNG } from '../lib/customBrushes';
import { getCustomBrushPNGData, isCustomBrushReference } from '../lib/customBrushRegistry';
import { cropBrushPngMargins } from '../lib/brushPngCrop';
import { isCustomPng } from '../lib/pngNormalizer';
import {
  fetchDailyPaintGallery,
  mutateCachedGalleryEntry,
  persistSolvedState,
  invalidateGalleryCache,
  primeDailyPaintGalleryCache,
  resetDailyPaintGalleryCache,
  setStoredGalleryVote,
  submitDailyPaintGalleryVote,
  type DailyPaintGalleryEntry,
  type DailyPaintGallerySort,
  type DailyPaintGalleryVoteDirection
} from '../lib/dailyPaintGallery';
import type { EmojiEntry } from '../lib/emojiCatalog';
import { createProjectPayload, saveProject, loadProject, saveAnimationProject, saveProjectUnified, saveFaceMaskProject, type AnimationProjectPayload } from '../lib/storage';
import { generateProjectPreview, exportGif, exportWebM, exportTimelapse, addExportProgressListener, exportAnimationFramesNative, isAnimationExportNativeAvailable } from '../native/timelapse';
import { exportGifFromFrames, exportMp4FromFrames } from '../native/exporter';
import { FALLBACK_PROMPTS, getDailyPrompts, getTopicMetadata, TOPIC_LANGUAGES, refreshTopics } from '../lib/dailyTopics';
import type { DailyPrompt } from '../types/dailyPrompt';
import { formatPrompt } from '../types/dailyPrompt';
import { fetchPrivateStudioLeaderboard, uploadPrivateStudioPassport, type PrivateStudioLeaderboardEntry, loadPassportSnapshots, savePassportSnapshot } from '../lib/privateStudio';
import { ensureDeviceId, uploadDailyPaintSprint } from '../lib/dailyPaintUpload';
import type { DailyPaintUploadResult } from '../lib/dailyPaintUpload';
import { renderStrokesToPngFile, hasSmudgeStroke } from '../lib/smudge/skiaOffscreenRender';
import { clearSprintAutosave, saveSprintAutosave, loadSprintAutosave, saveGeneralAutosave, loadGeneralAutosave, clearGeneralAutosave, loadFramerChallengeAutosave, clearFramerChallengeAutosave } from '../lib/sprintAutosave';
import { createChallengeSession, finishChallengeSession, loadChallengeSession, saveChallengeSession, remainingChallengeMs } from '../features/challenge/challengeSession';
import { sendImageToEmojispray } from '../lib/emojispray';
import { clearActiveSession } from '../video/VideoEditorScreen';
import { validateTopicsSync } from '../lib/topicsUpdater';
import { notificationService } from '../services/notificationService';
import { COIN_PAGE_ENABLED } from '../config/buildVariant';
// Lite builds replace CoinShopOverlay and FaceMeshOverlay with an inert module
// in metro.config.js, keeping their AI dependencies out of the bundle.
const IS_LITE_BUILD = !COIN_PAGE_ENABLED;
const CoinShopOverlay = IS_LITE_BUILD ? () => null : require('./CoinShopOverlay').default;
// Face "Emoji Me" scene — excluded from lite/App-Store builds (Coming soon).
const FaceMeshOverlay = IS_LITE_BUILD ? () => null : require('../ar/FaceMeshOverlay').default;
// AR Draw-compatible Front Camera / Mask Mode ships in Lite/App Store too.
// Unlike the legacy Emoji Me scene, this renderer is fully on-device.
const FrontCameraMaskScreen = require('../ar/FrontCameraMaskScreen').default;
// Keep Emoji Front Camera intact, but hide it while this independent scene is tested.
const ENABLE_LEGACY_EMOJI_FRONT_CAMERA = false;
// Vector Mode is included in Lite. It is self-contained and must remain
// reachable so iPad users can draw, save, and reopen vector projects there.
const VectorWorkspace = require('../vector/VectorWorkspace').default;
import { cloneStrokes, cloneTraceState, snapshotPaintingState, type StoredPaintingState } from '../types/storedPainting';
import { incrementStrokeCount, markFirstUpload, markFirstExport, markUserRated } from '../lib/ratingTracker';
import { triggerRatingCheck } from '../lib/ratingEvents';
import * as StoreReview from 'expo-store-review';
import type { RootStackParamList } from '../App';
import { getRandomInfoEntry } from '../lib/randomEntryStorage';
import { getAllVideos, addVideo, addImageToStorage } from '../video/videoStorage';
import { probeVideoMetadata } from '../video/videoProcessing';
import { getRandomLogoSet, getRandomImageLogoSet, type LogoSet, LOGO_SETS } from '../lib/logoManifest';
import { getRandomWelcomerVideo } from '../utils/welcomerVideos';
import { AnimatorWorkspace } from '../animator/AnimatorWorkspace';
import { FrameBuffer } from '../animator/FrameBuffer';
import { AnimatorRenderer, NoopAnimatorRenderer } from '../animator/AnimatorRenderer';
import AnimationSavedOverlay from '../components/AnimationSavedOverlay';
import { addAppEventListener, emitAppEvent } from '../lib/appEvents';
import {
  loadParentalControls,
  saveParentalControls,
  addDailyUsageMs,
  getDailyUsageMs,
  isTimeLimitExceeded,
  validatePin,
  DEFAULT_PARENTAL_SETTINGS,
  type ParentalControlsSettings,
} from '../lib/parentalControls';
import {
  initOfflineGalleryDb,
  saveOfflinePainting,
  getOfflineEntries,
  getOfflineEntryCount,
  type OfflineGalleryEntry,
} from '../lib/offlineGalleryDatabase';
import { getCachedGalleryForOffline } from '../lib/offlineGallerySupport';
import ParentalControlsModal from '../components/ParentalControlsModal';
import { LANGUAGE_OPTIONS, loadLanguagePreference, saveLanguagePreference } from '../lib/languageStorage';
import HelperLabel from '../tutorial/HelperLabel';
import { getElementLabel } from '../tutorial/translations';
import type { TutorialLanguage } from '../tutorial/types';
import { useTutorialActions } from '../tutorial/TutorialContext';
import SuggestTopicOverlay from '../gesser/components/SuggestTopicOverlay';
import GuessGameScreen from '../gesser/screens/GuessGameScreen';
import UserDiscoveryScreen from '../gesser/screens/UserDiscoveryScreen';
import FriendsListScreen from '../gesser/screens/FriendsListScreen';
import { isGesserEnabled } from '../gesser/config';
import {
  PROFILE_DISPLAY_NAME_STORAGE_KEY,
  clearSyncedProfileIdentity,
  createFreshProfileIdentity,
  deleteProfileFromServer,
  fetchServerProfileSnapshot,
  getServerProfileSyncMarker,
  markServerProfileSynced,
  persistProfileDisplayNameLocally,
  restoreServerProfileLocally,
  scheduleStoredProfileStateSync,
  type ServerProfileSnapshot,
} from '../lib/profileSync';
import { fetchCurrentSeason, type SeasonResponse } from '../lib/seasonsApi';
import { maskTopic as _maskTopic, formatMaskedTopic as _formatMaskedTopic, topicsMatch as _topicsMatch } from '../gesser/utils/masking';
import { useLeaderboard, LeaderboardOverlay } from '../features/leaderboard';
import { useInfoPanel, type InfoLanguage } from '../features/info-panel/useInfoPanel';
import InfoPanelOverlay from '../features/info-panel/InfoPanelOverlay';
import { useOnboarding, OnboardingOverlay, FIRST_STROKE_HELPER_KEY } from '../features/onboarding';
import { useChallenge, ChallengeOverlay } from '../features/challenge';
import FrameAnimatorOverlay from '../features/animator/FrameAnimatorOverlay';
import AnimationTypeOverlay from '../features/animator/AnimationTypeOverlay';
import AnimationExportOverlay from '../features/animator/AnimationExportOverlay';
import GesserOverlay from '../features/gesser-overlay/GesserOverlay';
import ExportOptionsOverlay from '../features/export/ExportOptionsOverlay';
import ResumeSessionOverlay from '../features/resume-session/ResumeSessionOverlay';
import WorldBrowserOverlay from '../features/world-browser/WorldBrowserOverlay';
import { GalleryPassportViewer } from '../features/gallery/GalleryPassportViewer';
import WordingOverlay from '../features/wording/WordingOverlay';
import GalleryOverlay from '../features/gallery/GalleryOverlay';
import PrivateStudioOverlay from '../features/private-studio/PrivateStudioOverlay';
import { usePrivateStudio } from '../features/private-studio/usePrivateStudio';
import { CANVAS_TINT_COLOR } from '../lib/canvasTint';

const resolveGalleryPassportName = async (fallbackName?: string | null): Promise<string | undefined> => {
  const storedProfileName = (await AsyncStorage.getItem(PROFILE_DISPLAY_NAME_STORAGE_KEY).catch(() => null))?.trim() ?? '';
  if (storedProfileName.length > 0) {
    return storedProfileName;
  }

  const trimmedFallback = fallbackName?.trim() ?? '';
  if (trimmedFallback.length > 0 && trimmedFallback !== PRIVATE_STUDIO_DEFAULT_NAME_SHORT) {
    return trimmedFallback;
  }

  return undefined;
};

// Top daily-topics notification: show at most once per 24h (cold opens only).
const DAILY_TOPICS_NOTIFICATION_LAST_SHOWN_KEY = 'daily_topics_notification_last_shown';
const DAILY_TOPICS_NOTIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Set true only while iterating on the notification design (shows every open).
// false = production behavior: once per 24h.
const DAILY_TOPICS_NOTIFICATION_ALWAYS_SHOW = false;

/**
 * Clamp the canvas translation so the painting remains visible within the viewport.
 *
 * Translation values are expressed in world units (unscaled). To prevent the user
 * from panning or zooming such that the entire painting leaves the screen, we
 * convert the maximum allowable pan distance into world units based on the
 * current scale and viewport size. At any zoom level we compute how much of
 * the painting extends beyond the viewport in pixels and then convert that
 * distance back into world units.  When the painting is smaller than the
 * viewport on a given axis, no panning is permitted on that axis.
 */
const clampCanvasTranslationWorklet = (
  nextX: number,
  nextY: number,
  scaleValue: number,
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number
) => {
  'worklet';
  const safeScale = Math.max(0.0001, scaleValue);
  // Ensure non‑zero viewport dimensions to avoid division by zero.
  const vpW = Math.max(1, viewportWidth);
  const vpH = Math.max(1, viewportHeight);
  // Convert canvas dimensions into pixel space at the current scale. These are
  // the on‑screen sizes of the painting if it were centered and not panned.
  const canvasPixelWidth = canvasWidth * safeScale;
  const canvasPixelHeight = canvasHeight * safeScale;
  // Half sizes in pixels.
  const halfCanvasPixelW = canvasPixelWidth / 2;
  const halfCanvasPixelH = canvasPixelHeight / 2;
  const halfViewportW = vpW / 2;
  const halfViewportH = vpH / 2;
  // The maximum translation in pixels that still keeps some of the painting in view.
  // If the painting is smaller than the viewport on a given axis, there is no
  // panning allowed on that axis (maxPanPixel = 0) and the canvas remains centered.
  const maxPanPixelX = Math.max(halfCanvasPixelW - halfViewportW, 0);
  const maxPanPixelY = Math.max(halfCanvasPixelH - halfViewportH, 0);
  // Convert back to world units for clamping the raw translation values.
  const maxPanWorldX = maxPanPixelX / safeScale;
  const maxPanWorldY = maxPanPixelY / safeScale;
  const clampedX = maxPanWorldX === 0 ? 0 : Math.max(-maxPanWorldX, Math.min(maxPanWorldX, nextX));
  const clampedY = maxPanWorldY === 0 ? 0 : Math.max(-maxPanWorldY, Math.min(maxPanWorldY, nextY));
  return { x: clampedX, y: clampedY };
};
const sanitizeTopicLabel = (value: string | null | undefined): string => {
  if (typeof value !== 'string') {
    return '';
  }
  const withoutUndefined = value.replace(/\s*undefined$/i, '');
  return withoutUndefined.trim();
};
const sanitizeProjectName = (value: string): string =>
  value.replace(/[\\/:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim();
const formatProjectTimestampName = (date: Date = new Date()): string => {
  const isoDate = date.toISOString().slice(0, 10);
  const timeParts = date
    .toTimeString()
    .slice(0, 8)
    .split(':')
    .join('-');
  return `Project ${isoDate} ${timeParts}`;
};
const collectDeviceLanguageCandidates = (): string[] => {
  const raw: string[] = [];
  const pushValue = (value: unknown) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      raw.push(value);
    }
  };
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
    pushValue(resolved);
  } catch {
    // ignore
  }
  try {
    const settingsManager = (NativeModules as { SettingsManager?: { settings?: Record<string, unknown> } }).SettingsManager;
    const settings = settingsManager?.settings ?? {};
    const appleLanguages = Array.isArray(settings.AppleLanguages) ? settings.AppleLanguages : [];
    appleLanguages.forEach((language) => pushValue(language));
    pushValue(typeof settings.AppleLocale === 'string' ? settings.AppleLocale : null);
  } catch {
    // ignore
  }
  try {
    const i18n = (NativeModules as { I18nManager?: { localeIdentifier?: string; locales?: unknown } }).I18nManager;
    const locales = Array.isArray(i18n?.locales) ? i18n?.locales : [];
    locales.forEach((locale) => pushValue(locale));
    pushValue(i18n?.localeIdentifier);
  } catch {
    // ignore
  }
  const normalized = new Set<string>();
  raw.forEach((value) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }
    const lower = trimmed.toLowerCase();
    normalized.add(lower);
    const base = lower.split(/[-_]/)[0];
    if (base && base.length > 0) {
      normalized.add(base);
    }
  });
  return Array.from(normalized);
};
const spacingNormalizedToSlider = (normalized: number): number => {
  const clamped = clamp(normalized, 0, MAX_NORMALIZED_SPACING);
  const scaled = (clamped / MAX_NORMALIZED_SPACING) * SPACING_SLIDER_MAX;
  return clamp(scaled, SPACING_SLIDER_MIN, SPACING_SLIDER_MAX);
};

const spacingSliderToNormalized = (value: number): number => {
  const clamped = clamp(value, SPACING_SLIDER_MIN, SPACING_SLIDER_MAX);
  return clamp((clamped / SPACING_SLIDER_MAX) * MAX_NORMALIZED_SPACING, PRESSURE_MIN_SPACING, MAX_NORMALIZED_SPACING);
};

const pointDistance = (a: StrokePoint, b: StrokePoint) => {
  'worklet';
  return Math.hypot(b.x - a.x, b.y - a.y);
};

const resolveStampSpan = (stroke: Stroke): number => {
  if (stroke.emojiSequence?.length) {
    const span = measureSequenceSpan(stroke.emojiSequence, stroke.size);
    stroke.stampSpan = span;
    return span;
  }
  if (stroke.stampSpan && stroke.stampSpan > 0) {
    return stroke.stampSpan;
  }
  const span = measureEmojiSpan(stroke.emoji, stroke.size);
  stroke.stampSpan = span;
  return span;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const toEpochMs = (value: number) => (value > 1_000_000_000_000 ? value : value * 1000);

const normalizeDeviceId = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

type GlobalStatsSnapshot = {
  totalTimeMs: number;
  totalStrokes: number;
  coins: number;
};

type CoinLevel = {
  id: number;
  name: string;
  emoji: string;
  minCoins: number;
};


const resolveCoinLevel = (coins: number): CoinLevel => {
  const safeCoins = Math.max(0, Math.floor(coins));
  for (let index = COIN_LEVELS.length - 1; index >= 0; index -= 1) {
    if (safeCoins >= COIN_LEVELS[index].minCoins) {
      return COIN_LEVELS[index];
    }
  }
  return COIN_LEVELS[0];
};

const resolveNextCoinLevel = (coins: number): CoinLevel | null => {
  const safeCoins = Math.max(0, Math.floor(coins));
  for (let index = 0; index < COIN_LEVELS.length; index += 1) {
    const level = COIN_LEVELS[index];
    if (safeCoins < level.minCoins) {
      return level;
    }
  }
  return null;
};

type UploadCelebration = {
  coins: number;
  level: CoinLevel;
  previousLevel: CoinLevel;
  leveledUp: boolean;
};

// ChallengeUploadNotice → moved to features/challenge/useChallenge

const computeStampSpacing = (stampSpan: number, normalizedSpacing: number, lineSpacingMultiplier: number = LINE_SPACING_MULTIPLIER): number => {
  const span = Math.max(1, stampSpan);
  const normalized = clamp(normalizedSpacing, 0, MAX_NORMALIZED_SPACING);
  if (normalized <= LINE_SPACING_THRESHOLD) {
    return Math.max(MINIMUM_POINT_SPACING, span * lineSpacingMultiplier);
  }
  const eased = normalized === 0 ? 0 : Math.pow(normalized, 1.6);
  const spacing = span * eased * 10;
  return Math.max(MINIMUM_POINT_SPACING, spacing);
};
const readTouchCount = (nativeEvent: any): number => {
  if (!nativeEvent) {
    return 0;
  }
  const { touches, numberActiveTouches, changedTouches, touchHistory } = nativeEvent;
  if (Array.isArray(touches) && touches.length) {
    return touches.length;
  }
  if (typeof numberActiveTouches === 'number') {
    return numberActiveTouches;
  }
  if (touchHistory && typeof touchHistory.numberActiveTouches === 'number') {
    return touchHistory.numberActiveTouches;
  }
  if (Array.isArray(changedTouches) && changedTouches.length) {
    return changedTouches.length;
  }
  return 0;
};

type EmojiListProps = FlatListProps<EmojiEntry>;
type ScrollFailureInfo = Parameters<NonNullable<EmojiListProps['onScrollToIndexFailed']>>[0];

// ChallengeConfirmCopy → moved to features/challenge/useChallenge

interface PrivateStudioPersistedState {
  name: string;
  elapsedMs: number;
  strokeCount: number;
  painting: StoredPaintingState;
  updatedAt: string;
}

type SnapshotSizeMode = 'default' | 'compact';

const clampSnapshotDimensions = (width: number, height: number, mode: SnapshotSizeMode = 'default') => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const maxSide = Math.max(safeWidth, safeHeight);
  const targetSide = mode === 'compact' ? LONG_STROKE_SNAPSHOT_SIDE : TARGET_SNAPSHOT_SIDE;
  const maxAllowedSide = mode === 'compact' ? LONG_STROKE_SNAPSHOT_SIDE : MAX_SNAPSHOT_SIDE;
  const allowUpscale = mode !== 'compact';

  if (maxSide < targetSide && allowUpscale) {
    const scale = targetSide / Math.max(1, maxSide);
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale))
    };
  }
  if (maxSide > maxAllowedSide) {
    const scale = maxAllowedSide / maxSide;
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale))
    };
  }
  return { width: safeWidth, height: safeHeight };
};

const formatElapsedLabel = (elapsedMs: number): string => {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// CHALLENGE_CONFIRM_COPY → moved to features/challenge/useChallenge

type ToolMode = 'brush' | 'line' | 'eraser' | 'emojiplane';






const catmullPoint = (p0: StrokePoint, p1: StrokePoint, p2: StrokePoint, p3: StrokePoint, t: number): StrokePoint => {
  'worklet';
  const t2 = t * t;
  const t3 = t2 * t;
  const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  const time = p1.t + (p2.t - p1.t) * t;
  return { x, y, t: time };
};
const generateLinePoints = (start: StrokePoint, end: StrokePoint, spacing: number): StrokePoint[] => {
  'worklet';
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 0.001) {
    return [{ ...start }];
  }

  // FIXED-INTERVAL stamps anchored at `start`.
  //
  // This used to divide the line into `ceil(distance / spacing)` EQUAL parts and
  // walk t = i/N. That makes the real gap `distance / N`, which shrinks
  // continuously as you drag and then snaps back every time N ticks up by one —
  // so on every move event EVERY stamp on the line moved a little. That is the
  // crawling/jittering preview. Anchoring stamp k at exactly `k * spacing` from
  // the start instead means existing stamps never move: dragging only adds or
  // removes stamps at the far end, which is what a straight-line tool should do.
  let clampedSpacing = Math.max(MIN_LINE_SPACING, spacing);
  // Only if a line is so long that fixed spacing would blow the point budget do
  // we fall back to spreading the available stamps evenly over it.
  if (distance / clampedSpacing > MAX_LINE_POINTS - 1) {
    clampedSpacing = distance / (MAX_LINE_POINTS - 1);
  }

  const ux = dx / distance;
  const uy = dy / distance;

  // Interpolate width along line if both points have width
  const startWidth = start.w;
  const endWidth = end.w;
  const hasWidth = startWidth !== undefined && endWidth !== undefined;

  const points: StrokePoint[] = [];
  const pushAt = (travelled: number) => {
    const t = travelled / distance;
    const point: StrokePoint = {
      x: start.x + ux * travelled,
      y: start.y + uy * travelled,
      t: start.t + (end.t - start.t) * t
    };
    if (hasWidth) {
      point.w = startWidth + (endWidth - startWidth) * t;
    }
    points.push(point);
  };

  const wholeSteps = Math.floor(distance / clampedSpacing);
  for (let i = 0; i <= wholeSteps; i += 1) {
    pushAt(i * clampedSpacing);
  }

  // Land a stamp on the fingertip so the line always reaches the cursor. Only
  // when it is at least half a spacing past the last fixed stamp, otherwise the
  // two would overlap and pop in and out as you drag.
  const remainder = distance - wholeSteps * clampedSpacing;
  if (remainder > clampedSpacing * 0.5) {
    pushAt(distance);
  }

  return points;
};

type SmoothedSampleWorkletInput = {
  rawTail: StrokePoint[];
  outputTail: StrokePoint | null;
  sample: StrokePoint;
  targetSpacing: number;
  strokeSize: number;
};

const computeSmoothedSamplePointsOnUI = executeOnUIRuntimeSync((input: SmoothedSampleWorkletInput): StrokePoint[] => {
  'worklet';
  const { rawTail, outputTail, sample, targetSpacing, strokeSize } = input;
  if (!rawTail.length) {
    return [];
  }
  if (!outputTail || rawTail.length === 1) {
    return [{ ...sample }];
  }

  const p0 = rawTail[rawTail.length - 4] ?? rawTail[0];
  const p1 = rawTail[rawTail.length - 3] ?? rawTail[0];
  const p2 = rawTail[rawTail.length - 2];
  const p3 = rawTail[rawTail.length - 1];
  const appendedPoints: StrokePoint[] = [];

  const addCandidate = (candidate: StrokePoint) => {
    if (appendedPoints.length === 0) {
      appendedPoints.push({ ...candidate });
      return;
    }

    let lastPoint = appendedPoints[appendedPoints.length - 1];
    let segmentDistance = pointDistance(lastPoint, candidate);
    let iterations = 0;
    const maxIterations = 512;

    while (segmentDistance >= targetSpacing && segmentDistance > 0.0001 && iterations < maxIterations) {
      const ratio = targetSpacing / segmentDistance;
      const lastWidth = lastPoint.w ?? strokeSize;
      const candWidth = candidate.w ?? strokeSize;
      const newPoint: StrokePoint = {
        x: lastPoint.x + (candidate.x - lastPoint.x) * ratio,
        y: lastPoint.y + (candidate.y - lastPoint.y) * ratio,
        t: lastPoint.t + (candidate.t - lastPoint.t) * ratio,
        w: lastWidth + (candWidth - lastWidth) * ratio
      };
      appendedPoints.push(newPoint);
      lastPoint = newPoint;
      segmentDistance = pointDistance(lastPoint, candidate);
      iterations += 1;
    }

    if (pointDistance(appendedPoints[appendedPoints.length - 1], candidate) > 0.01) {
      appendedPoints.push({ ...candidate });
    } else {
      appendedPoints[appendedPoints.length - 1] = { ...candidate };
    }
  };

  for (let step = 1; step <= 4; step += 1) {
    const t = step / 4;
    const candidate = catmullPoint(p0, p1, p2, p3, t);
    const w0 = p0.w ?? strokeSize;
    const w1 = p1.w ?? strokeSize;
    const w2 = p2.w ?? strokeSize;
    const w3 = p3.w ?? strokeSize;
    const t2 = t * t;
    const t3 = t2 * t;
    const a0 = -0.5 * t3 + t2 - 0.5 * t;
    const a1 = 1.5 * t3 - 2.5 * t2 + 1;
    const a2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
    const a3 = 0.5 * t3 - 0.5 * t2;
    const interpolatedWidth = a0 * w0 + a1 * w1 + a2 * w2 + a3 * w3;
    candidate.w = Math.max(1, interpolatedWidth);
    addCandidate(candidate);
  }

  return appendedPoints;
});

// NOTE: the straight-line tool deliberately calls generateLinePoints() directly
// on the JS thread. It used to go through a synchronous UI-runtime worklet hop
// on every move event, which made the committed geometry depend on event
// timing — unacceptable for a tool whose whole contract is "two points, one
// perfect segment".



// Tutorial translations
type TutorialTranslations = {
  title: string;
  lessons: Array<{
    title: string;
    description: string;
  }>;
  success: string;
  done: string;
};

const TUTORIAL_TRANSLATIONS: Record<InfoLanguage, TutorialTranslations> = {
  en: {
    title: 'TUTORIAL',
    lessons: [
      {
        title: 'LESSON 1: Make a Stroke',
        description: 'Draw something on the canvas with your finger to create your first brush stroke!'
      },
      {
        title: 'LESSON 2: Pick a Different Emoji',
        description: 'Tap the emoji icon at the bottom to open the emoji picker and select a new brush!'
      },
      {
        title: 'LESSON 3: Make a Straight Line',
        description: 'Tap the 📏 button to activate line mode and draw a perfect straight line!'
      },
      {
        title: 'LESSON 4: Pick Random Emoji',
        description: 'Tap the 🎲 button to get a random emoji brush instantly!'
      },
      {
        title: 'LESSON 5: Watch Timelapse',
        description: 'Tap the 🎞️ button to see your creation come to life in a timelapse video!'
      },
      {
        title: 'LESSON 6: Find the Gallery',
        description: 'Tap the ℹ️ button, then explore the 🖼️ Gallery to see amazing creations!'
      }
    ],
    success: '✅ GREAT JOB!',
    done: '🎉 TUTORIAL COMPLETE!\nHave fun creating!'
  },
  de: {
    title: 'TUTORIAL',
    lessons: [
      {
        title: 'LEKTION 1: Mache einen Strich',
        description: 'Zeichne etwas auf der Leinwand mit deinem Finger, um deinen ersten Pinselstrich zu erstellen!'
      },
      {
        title: 'LEKTION 2: Wähle ein anderes Emoji',
        description: 'Tippe auf das Emoji-Symbol unten, um den Emoji-Picker zu öffnen und einen neuen Pinsel auszuwählen!'
      },
      {
        title: 'LEKTION 3: Mache eine gerade Linie',
        description: 'Tippe auf die 📏 Taste, um den Linienmodus zu aktivieren und eine perfekte gerade Linie zu zeichnen!'
      },
      {
        title: 'LEKTION 4: Zufälliges Emoji wählen',
        description: 'Tippe auf die 🎲 Taste, um sofort ein zufälliges Emoji als Pinsel zu erhalten!'
      },
      {
        title: 'LEKTION 5: Zeitraffer ansehen',
        description: 'Tippe auf die 🎞️ Taste, um deine Kreation als Zeitraffer-Video zu sehen!'
      },
      {
        title: 'LEKTION 6: Finde die Galerie',
        description: 'Tippe auf die ℹ️ Taste und erkunde dann die 🖼️ Galerie, um tolle Kreationen zu sehen!'
      }
    ],
    success: '✅ SUPER GEMACHT!',
    done: '🎉 TUTORIAL ABGESCHLOSSEN!\nViel Spaß beim Erstellen!'
  },
  ru: {
    title: 'ОБУЧЕНИЕ',
    lessons: [
      {
        title: 'УРОК 1: Сделай штрих',
        description: 'Нарисуй что-нибудь на холсте пальцем, чтобы создать свой первый мазок кисти!'
      },
      {
        title: 'УРОК 2: Выбери другое эмодзи',
        description: 'Нажми на иконку эмодзи внизу, чтобы открыть выбор эмодзи и выбрать новую кисть!'
      },
      {
        title: 'УРОК 3: Сделай прямую линию',
        description: 'Нажми кнопку 📏, чтобы активировать режим линии и нарисовать идеально прямую линию!'
      },
      {
        title: 'УРОК 4: Выбери случайное эмодзи',
        description: 'Нажми кнопку 🎲, чтобы мгновенно получить случайное эмодзи в качестве кисти!'
      },
      {
        title: 'УРОК 5: Просмотр таймлапс',
        description: 'Нажми кнопку 🎞️, чтобы увидеть свое творение в виде таймлапс-видео!'
      },
      {
        title: 'УРОК 6: Найди галерею',
        description: 'Нажми кнопку ℹ️, затем исследуй 🖼️ Галерею, чтобы увидеть потрясающие творения!'
      }
    ],
    success: '✅ ОТЛИЧНО!',
    done: '🎉 ОБУЧЕНИЕ ЗАВЕРШЕНО!\nПриятного творчества!'
  },
  zh: {
    title: '教程',
    lessons: [
      {
        title: '第1课：画一笔',
        description: '用手指在画布上画些东西，创建你的第一笔画！'
      },
      {
        title: '第2课：选择不同的表情符号',
        description: '点击底部的表情符号图标以打开表情符号选择器并选择新画笔！'
      },
      {
        title: '第3课：画一条直线',
        description: '点击 📏 按钮激活直线模式并画出完美的直线！'
      },
      {
        title: '第4课：选择随机表情符号',
        description: '点击 🎲 按钮立即获取随机表情符号画笔！'
      },
      {
        title: '第5课：观看延时视频',
        description: '点击 🎞️ 按钮查看你的创作延时视频！'
      },
      {
        title: '第6课：找到画廊',
        description: '点击 ℹ️ 按钮，然后探索 🖼️ 画廊以查看精彩作品！'
      }
    ],
    success: '✅ 做得好！',
    done: '🎉 教程完成！\n尽情创作吧！'
  },
  ko: {
    title: '튜토리얼',
    lessons: [
      {
        title: '레슨 1: 획 만들기',
        description: '손가락으로 캔버스에 무언가 그려서 첫 번째 브러시 획을 만드세요!'
      },
      {
        title: '레슨 2: 다른 이모지 선택',
        description: '하단의 이모지 아이콘을 탭하여 이모지 선택기를 열고 새 브러시를 선택하세요!'
      },
      {
        title: '레슨 3: 직선 그리기',
        description: '📏 버튼을 탭하여 선 모드를 활성화하고 완벽한 직선을 그으세요!'
      },
      {
        title: '레슨 4: 무작위 이모지 선택',
        description: '🎲 버튼을 탭하여 즉시 무작위 이모지 브러시를 받으세요!'
      },
      {
        title: '레슨 5: 타임랩스 보기',
        description: '🎞️ 버튼을 탭하여 타임랩스 비디오로 창작물을 확인하세요!'
      },
      {
        title: '레슨 6: 갤러리 찾기',
        description: 'ℹ️ 버튼을 탭한 다음 🖼️ 갤러리를 탐색하여 놀라운 작품을 확인하세요!'
      }
    ],
    success: '✅ 잘했어요!',
    done: '🎉 튜토리얼 완료!\n즐겁게 창작하세요!'
  },
  ja: {
    title: 'チュートリアル',
    lessons: [
      {
        title: 'レッスン1：ストロークを作る',
        description: '指でキャンバスに何か描いて最初のブラシストロークを作成してください！'
      },
      {
        title: 'レッスン2：別の絵文字を選ぶ',
        description: '下部の絵文字アイコンをタップして絵文字ピッカーを開き、新しいブラシを選択してください！'
      },
      {
        title: 'レッスン3：直線を引く',
        description: '📏 ボタンをタップしてラインモードを有効にし、完璧な直線を引いてください！'
      },
      {
        title: 'レッスン4：ランダム絵文字を選ぶ',
        description: '🎲 ボタンをタップしてランダムな絵文字ブラシをすぐに取得してください！'
      },
      {
        title: 'レッスン5：タイムラプスを見る',
        description: '🎞️ ボタンをタップして、作品のタイムラプスビデオを見てください！'
      },
      {
        title: 'レッスン6：ギャラリーを見つける',
        description: 'ℹ️ ボタンをタップしてから、🖼️ ギャラリーを探索して素晴らしい作品を見てください！'
      }
    ],
    success: '✅ よくできました！',
    done: '🎉 チュートリアル完了！\n楽しく創作してください！'
  },
  fr: {
    title: 'TUTORIEL',
    lessons: [
      {
        title: 'LEÇON 1 : Faire un trait',
        description: 'Dessinez quelque chose sur le canvas avec votre doigt pour créer votre premier coup de pinceau !'
      },
      {
        title: 'LEÇON 2 : Choisir un emoji différent',
        description: 'Appuyez sur l\'icône emoji en bas pour ouvrir le sélecteur d\'emoji et choisir un nouveau pinceau !'
      },
      {
        title: 'LEÇON 3 : Tracer une ligne droite',
        description: 'Appuyez sur le bouton 📏 pour activer le mode ligne et tracer une ligne parfaitement droite !'
      },
      {
        title: 'LEÇON 4 : Choisir un emoji aléatoire',
        description: 'Appuyez sur le bouton 🎲 pour obtenir instantanément un pinceau emoji aléatoire !'
      },
      {
        title: 'LEÇON 5 : Regarder le timelapse',
        description: 'Appuyez sur le bouton 🎞️ pour voir votre création en vidéo timelapse !'
      },
      {
        title: 'LEÇON 6 : Trouver la galerie',
        description: 'Appuyez sur le bouton ℹ️, puis explorez la 🖼️ Galerie pour voir des créations incroyables !'
      }
    ],
    success: '✅ EXCELLENT TRAVAIL !',
    done: '🎉 TUTORIEL TERMINÉ !\nAmusez-vous bien !'
  },
  it: {
    title: 'TUTORIAL',
    lessons: [
      {
        title: 'LEZIONE 1: Fai un tratto',
        description: 'Disegna qualcosa sulla tela con il dito per creare il tuo primo tratto di pennello!'
      },
      {
        title: 'LEZIONE 2: Scegli un emoji diverso',
        description: 'Tocca l\'icona emoji in basso per aprire il selettore di emoji e scegliere un nuovo pennello!'
      },
      {
        title: 'LEZIONE 3: Disegna una linea retta',
        description: 'Tocca il pulsante 📏 per attivare la modalità linea e disegnare una linea perfettamente dritta!'
      },
      {
        title: 'LEZIONE 4: Scegli emoji casuali',
        description: 'Tocca il pulsante 🎲 per ottenere istantaneamente un pennello emoji casuale!'
      },
      {
        title: 'LEZIONE 5: Guarda il timelapse',
        description: 'Tocca il pulsante 🎞️ per vedere la tua creazione in un video timelapse!'
      },
      {
        title: 'LEZIONE 6: Trova la galleria',
        description: 'Tocca il pulsante ℹ️, poi esplora la 🖼️ Galleria per vedere creazioni straordinarie!'
      }
    ],
    success: '✅ OTTIMO LAVORO!',
    done: '🎉 TUTORIAL COMPLETO!\nDivertiti a creare!'
  }
};




const WELCOME_UI_TRANSLATIONS: Record<InfoLanguage, {
  greeting: string;
  gallery: string;
  info: string;
  profile: string;
  startPainting: string;
  notifications: string;
  parentalControlsOn: string;
  parentalControlsOff: string;
  notifEnabledTitle: string;
  notifEnabledBody: string;
  notifEnabledBtn: string;
}> = {
  en: {
    greeting: 'Welcome!', gallery: '🖼️ Gallery', info: 'ℹ️ Info', profile: '👤 Profile', startPainting: 'Painting',
    notifications: '🔔 Notifications',
    parentalControlsOn: 'Parental Controls ✓', parentalControlsOff: 'Set Up Parental Controls',
    notifEnabledTitle: '🔔 Notifications Enabled!',
    notifEnabledBody: "You'll receive one random daily reminder to paint a topic challenge. The notification will arrive at a random time between 8 AM - 8 PM with one of today's daily topics.",
    notifEnabledBtn: 'Got it!',
  },
  de: {
    greeting: 'Willkommen!', gallery: '🖼️ Galerie', info: 'ℹ️ Info', profile: '👤 Profil', startPainting: 'Malen',
    notifications: '🔔 Benachrichtigungen',
    parentalControlsOn: 'Kindersicherung ✓', parentalControlsOff: 'Kindersicherung einrichten',
    notifEnabledTitle: '🔔 Benachrichtigungen aktiviert!',
    notifEnabledBody: 'Du erhältst täglich eine zufällige Erinnerung, eine Themen-Challenge zu malen. Die Benachrichtigung kommt zu einer zufälligen Zeit zwischen 8 und 20 Uhr.',
    notifEnabledBtn: 'Alles klar!',
  },
  ru: {
    greeting: 'Добро пожаловать!', gallery: '🖼️ Галерея', info: 'ℹ️ Инфо', profile: '👤 Профиль', startPainting: 'Рисовать',
    notifications: '🔔 Уведомления',
    parentalControlsOn: 'Родительский контроль ✓', parentalControlsOff: 'Настроить родительский контроль',
    notifEnabledTitle: '🔔 Уведомления включены!',
    notifEnabledBody: 'Вы будете получать одно случайное ежедневное напоминание нарисовать тематический челлендж в случайное время с 8:00 до 20:00.',
    notifEnabledBtn: 'Понятно!',
  },
  zh: {
    greeting: '欢迎!', gallery: '🖼️ 藝廊', info: 'ℹ️ 資訊', profile: '👤 個人資料', startPainting: '開始畫',
    notifications: '🔔 通知',
    parentalControlsOn: '家長控制 ✓', parentalControlsOff: '設置家長控制',
    notifEnabledTitle: '🔔 通知已啟用！',
    notifEnabledBody: '您每天將收到一個隨機提醒，提示您完成主題挑戰。通知將在每天 8:00 至 20:00 之間的隨機時間發送。',
    notifEnabledBtn: '知道了！',
  },
  ko: {
    greeting: '환영합니다!', gallery: '🖼️ 갤러리', info: 'ℹ️ 정보', profile: '👤 프로필', startPainting: '그리기',
    notifications: '🔔 알림',
    parentalControlsOn: '자녀 보호 기능 ✓', parentalControlsOff: '자녀 보호 기능 설정',
    notifEnabledTitle: '🔔 알림이 활성화되었습니다!',
    notifEnabledBody: '매일 오전 8시에서 오후 8시 사이 무작위 시간에 오늘의 주제 챌린지를 그리라는 알림 하나를 받게 됩니다.',
    notifEnabledBtn: '알겠어요!',
  },
  ja: {
    greeting: 'ようこそ!', gallery: '🖼️ ギャラリー', info: 'ℹ️ 情報', profile: '👤 プロフィール', startPainting: '描く',
    notifications: '🔔 通知',
    parentalControlsOn: 'ペアレンタルコントロール ✓', parentalControlsOff: 'ペアレンタルコントロールを設定',
    notifEnabledTitle: '🔔 通知が有効になりました！',
    notifEnabledBody: '毎日午前8時から午後8時の間のランダムな時間に、今日のテーマチャレンジを描くリマインダーが1件届きます。',
    notifEnabledBtn: 'わかりました！',
  },
  fr: {
    greeting: 'Bienvenue!', gallery: '🖼️ Galerie', info: 'ℹ️ Info', profile: '👤 Profil', startPainting: 'Peindre',
    notifications: '🔔 Notifications',
    parentalControlsOn: 'Contrôle parental ✓', parentalControlsOff: 'Configurer le contrôle parental',
    notifEnabledTitle: '🔔 Notifications activées !',
    notifEnabledBody: "Vous recevrez un rappel quotidien aléatoire pour peindre un défi thématique, à une heure aléatoire entre 8h et 20h.",
    notifEnabledBtn: 'Compris !',
  },
  it: {
    greeting: 'Benvenuto!', gallery: '🖼️ Galleria', info: 'ℹ️ Info', profile: '👤 Profilo', startPainting: 'Dipingi',
    notifications: '🔔 Notifiche',
    parentalControlsOn: 'Controllo genitori ✓', parentalControlsOff: 'Imposta controllo genitori',
    notifEnabledTitle: '🔔 Notifiche attivate!',
    notifEnabledBody: "Riceverai un promemoria giornaliero casuale per dipingere una sfida tematica, a un'ora casuale tra le 8:00 e le 20:00.",
    notifEnabledBtn: 'Capito!',
  },
};

const TRACE_LOADING_MESSAGES = [
  'Shuffling sprites…',
  'Polishing pixels…',
  'Untangling emoji vines…',
  'Summoning reference wizard…',
  'Brewing trace potion…'
];

// Lazy-loading image with shimmer placeholder and fade-in.
// onReady fires once the image settles (load or error) — used by the
// progressive-reveal system to unlock the next card in the list.
const GalleryThumb: React.FC<{
  uri: string;
  width?: number;
  height?: number;
  style?: any;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  onReady?: () => void;
}> = React.memo(({ uri, width, height, style, resizeMode = 'cover', onReady }) => {
  const opacity = useRef(new RNAnimated.Value(0)).current;
  const [loaded, setLoaded] = React.useState(false);
  const calledRef = useRef(false);

  const settle = React.useCallback(() => {
    setLoaded(true);
    RNAnimated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    if (!calledRef.current) {
      calledRef.current = true;
      onReady?.();
    }
  }, [opacity, onReady]);

  const shimmerStyle = style ?? (width && height ? { width, height } : { width: '100%', height: '100%' });

  return (
    <View style={[shimmerStyle, { backgroundColor: '#1e1e1e', overflow: 'hidden' }]}>
      {!loaded && (
        <View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color="#444" />
        </View>
      )}
      <RNAnimated.Image
        source={{ uri }}
        style={[shimmerStyle, { opacity }]}
        resizeMode={resizeMode}
        onLoad={settle}
        onError={settle}
      />
    </View>
  );
});

// ── Video load queue: max 3 concurrent video loads ──────────────────────────
const _vq: { id: string; run: () => void }[] = [];
let _vActive = 0;
const V_MAX = 3;
function _vFlush() {
  while (_vActive < V_MAX && _vq.length > 0) { _vActive++; _vq.shift()!.run(); }
}
function vStart(id: string, run: () => void, front = false) {
  const i = _vq.findIndex(x => x.id === id);
  if (i > -1) _vq.splice(i, 1);
  if (_vActive < V_MAX) { _vActive++; run(); }
  else { if (front) _vq.unshift({ id, run }); else _vq.push({ id, run }); }
}
function vRelease() { _vActive = Math.max(0, _vActive - 1); _vFlush(); }

// SmartVideoCard — shows static first frame immediately, then loads + autoplays
// video in background via a shared queue (max 3 concurrent). Shows a small
// loading badge (top-right) while the video is buffering.
const SmartVideoCard: React.FC<{
  id: string;
  uri: string;          // video URL (.mp4 / .mov)
  frameUri?: string | null; // static JPEG first-frame (from item.frameUrls[0])
  style?: any;
  width?: number;
  height?: number;
  resizeMode?: 'cover' | 'contain';
  onReady?: () => void; // fires when static frame settles (progressive reveal)
}> = React.memo(({ id, uri, frameUri, style, width, height, resizeMode = 'contain', onReady }) => {
  const [phase, setPhase] = React.useState<'static' | 'loading' | 'playing'>('static');
  const videoFade = useRef(new RNAnimated.Value(0)).current;
  const revealFiredRef = useRef(false);
  const slotHeldRef = useRef(false);
  const mountedRef = useRef(true);

  const boxStyle: any = style ?? (width && height ? { width, height } : { width: '100%', height: '100%' });
  const validFrame = frameUri && !String(frameUri).match(/\.(mov|mp4|webm)(\?|$)/i);

  const fireReveal = useCallback(() => {
    if (!revealFiredRef.current) { revealFiredRef.current = true; onReady?.(); }
  }, [onReady]);

  const acquireSlot = useCallback(() => {
    vStart(id, () => {
      if (!mountedRef.current) { vRelease(); return; }
      slotHeldRef.current = true;
      setPhase('loading');
    });
  }, [id]);

  // No valid static frame → fire reveal + load immediately
  useEffect(() => {
    if (!validFrame) { fireReveal(); acquireSlot(); }
    return () => {
      mountedRef.current = false;
      const i = _vq.findIndex(x => x.id === id);
      if (i > -1) _vq.splice(i, 1);
      if (slotHeldRef.current) { slotHeldRef.current = false; vRelease(); }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFrameReady = useCallback(() => {
    fireReveal();
    if (phase === 'static') acquireSlot();
  }, [fireReveal, acquireSlot, phase]);

  const onVideoDisplayReady = useCallback(() => {
    if (!mountedRef.current) return;
    if (slotHeldRef.current) { slotHeldRef.current = false; vRelease(); }
    setPhase('playing');
    RNAnimated.timing(videoFade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [videoFade]);

  return (
    <View style={[boxStyle, { backgroundColor: '#111', overflow: 'hidden' }]}>
      {/* Static first-frame — stays until video cross-fades in */}
      {validFrame && phase !== 'playing' && (
        <GalleryThumb uri={frameUri!} style={boxStyle} resizeMode={resizeMode} onReady={onFrameReady} />
      )}
      {!validFrame && phase === 'static' && (
        <View style={[boxStyle, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="small" color="#333" />
        </View>
      )}

      {/* Video — mounts hidden after queue slot acquired, fades in when ready */}
      {phase !== 'static' && (
        <RNAnimated.View style={[StyleSheet.absoluteFillObject, { opacity: phase === 'playing' ? videoFade : 0 }]}>
          <ShortVideoPlayer
            uri={uri}
            style={{ width: '100%', height: '100%' }}
            resizeMode={resizeMode}
            shouldPlay
            isMuted
            onReadyForDisplay={onVideoDisplayReady}
          />
        </RNAnimated.View>
      )}

      {/* Loading badge — visible top-right while video is buffering */}
      {phase === 'loading' && (
        <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 8, padding: 4 }}>
          <ActivityIndicator size="small" color="#ff9f6b" />
        </View>
      )}
    </View>
  );
});

// Gallery skeleton/shimmer shown while the gallery is loading for the first time.
const GallerySkeleton: React.FC = () => {
  const pulse = useRef(new RNAnimated.Value(0.3)).current;
  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <RNAnimated.View key={i} style={{ width: 100, height: 100, borderRadius: 8, backgroundColor: '#333', opacity: pulse }} />
      ))}
    </View>
  );
};

/**
 * PaintScreen — the main canvas screen.
 *
 * REFACTORING STATUS: In progress.
 * Target: ~1,500 lines. Currently ~29,000 lines.
 * Each major feature is being extracted to src/features/<name>/.
 * See ARCHITECTURE.md for the extraction protocol and progress.
 *
 * Extraction markers: search "── EXTRACT →" to find what to move next.
 */
const PaintScreen: React.FC = () => {
  const windowSize = useWindowDimensions();
  const isIpadLandscape = IS_IPAD && windowSize.width > windowSize.height;
  const isIpadPortrait = IS_IPAD && windowSize.height > windowSize.width;
  const isWidePortraitTablet = IS_IPAD && windowSize.height > windowSize.width && windowSize.width / windowSize.height > 0.6;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Paint'>>();
  const insets = useSafeAreaInsets();
  const {
    trace,
    dispatch,
    strokes,
    commitStroke,
    brushSize,
    brushEmoji,
    brushSpacing,
    brushRotation,
    brushOpacity,
    brushMode,
    smudgeSmoothness,
    undoStack,
    recentEmojis,
    mirrorX,
    mirrorY,
    subscribeAutosaveDiscard,
    emojiPlanes,
    planeUndoStack,
    planeRedoStack,
    // ── 3-layer system (foreground / middle / background) ──
    // Lives in the painter DATA MODEL (PaintingContext), not in local UI state, so it survives
    // autosave/save/restore and every renderer can read it.
    // The Layers PANEL is a later phase: it consumes `useLayerControls()` from PaintingContext
    // (active layer + setter, per-layer visibility + toggle, per-layer stroke counts) — nothing else
    // needs to be threaded through this screen.
    activeLayer,
    layerVisibility,
    setActiveLayer,
    toggleLayerVisibility,
    layerArtworkStrokeCounts,
    clearLayer,
    mergeLayer,
    pasteStrokesOnLayer
  } = usePainting();
  // Ref mirror: stroke creation runs inside gesture callbacks that must not re-bind on state change.
  const activeLayerRef = useRef<PaintLayer>(activeLayer);
  activeLayerRef.current = activeLayer;
  const layerVisibilityRef = useRef<LayerVisibility>(layerVisibility);
  layerVisibilityRef.current = layerVisibility;
  /**
   * Strokes as the user SEES them: paint order background → middle → foreground, hidden layers
   * dropped. Every export/upload/preview replays this list rather than the raw creation-order array,
   * so a flattened PNG matches the composited canvas. The editable data model is untouched — nothing
   * is ever permanently flattened or reordered by exporting.
   * Returns the very same array reference when layers are unused (no extra work, no re-render churn).
   */
  // ── Layers panel (main workspace only) ──────────────────────────────────────
  const [layersPanelVisible, setLayersPanelVisible] = useState(false);
  const [layerMenuLayer, setLayerMenuLayer] = useState<PaintLayer | null>(null);
  /** Copied stroke DATA, not a flattened image — paste re-clones these onto the target layer. */
  const [layerClipboard, setLayerClipboard] = useState<Stroke[]>([]);

  /**
   * Row thumbnails. Deliberately just the emoji actually painted on each layer rather than a
   * rendered preview: re-rasterising up to three canvases on every stroke is exactly the brush
   * latency this feature must not add. Recomputed only when the stroke array identity changes.
   */
  const layerPreviewGlyphs = useMemo(() => {
    const out: Record<PaintLayer, string[]> = { background: [], middle: [], foreground: [] };
    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const stroke = strokes[i];
      if (!stroke?.emoji || stroke.id?.startsWith('border_')) continue;
      const bucket = out[strokeLayer(stroke)];
      if (bucket.length < 3 && !bucket.includes(stroke.emoji)) bucket.push(stroke.emoji);
    }
    return out;
  }, [strokes]);

  /**
   * Real rendered snapshot per layer, replacing the emoji-glyph placeholder.
   *
   * Generated ONLY while the panel is open and only after the strokes settle (debounced), because
   * this rasterises up to three canvases — doing it per pointer move is exactly the brush latency
   * the layers feature must not introduce. 96px output, downscaled again by the 46pt thumbnail box.
   * A layer with no artwork skips the render entirely and falls back to the glyph strip.
   */
  const [layerThumbnails, setLayerThumbnails] = useState<Record<PaintLayer, string | null>>({
    background: null, middle: null, foreground: null
  });

  useEffect(() => {
    if (!layersPanelVisible) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const next: Record<PaintLayer, string | null> = { background: null, middle: null, foreground: null };
        for (const layer of PAINT_LAYER_ORDER) {
          const own = strokesForLayer(strokes, layer).filter(st => !st?.id?.startsWith('border_'));
          if (own.length === 0) continue;
          try {
            next[layer] = await generateProjectPreview(own, 96, canvasSize, canvasSize * CANVAS_RATIO);
          } catch {
            next[layer] = null;
          }
          if (cancelled) return;
        }
        if (!cancelled) setLayerThumbnails(next);
      })();
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [canvasSize, layersPanelVisible, strokes]);

  const handleLayerAction = useCallback((layer: PaintLayer, action: LayerAction) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    switch (action) {
      case 'copy':
        // Snapshot the real strokes. cloneStrokesForLayer re-ids + re-targets them at paste time,
        // so the clipboard can be pasted repeatedly without colliding ids.
        setLayerClipboard(strokesForLayer(strokes, layer));
        break;
      case 'paste':
        if (layerClipboard.length > 0) pasteStrokesOnLayer(layerClipboard, layer);
        break;
      case 'duplicate':
        pasteStrokesOnLayer(strokesForLayer(strokes, layer), layer);
        break;
      case 'clear':
        clearLayer(layer);
        break;
      case 'mergeDown':
        mergeLayer('foreground');
        break;
      case 'mergeUp':
        mergeLayer('background');
        break;
      default:
        break;
    }
    setLayerMenuLayer(null);
  }, [clearLayer, layerClipboard, mergeLayer, pasteStrokesOnLayer, strokes]);

  const layeredForExport = useCallback(
    (list: Stroke[]) => orderStrokesByLayer(list, layerVisibilityRef.current),
    []
  );
  const wording = useWording();
  const { settings, setTheme, setHandMode, setHelperModeEnabled, setTutorialModeEnabled, setBrushPerformanceMode } = useAppSettings();
  const { addRipple } = useTutorialActions();
  const addRippleRef = useRef(addRipple);
  addRippleRef.current = addRipple;
  const tutorialModeEnabledRef = useRef(settings.tutorialModeEnabled);
  tutorialModeEnabledRef.current = settings.tutorialModeEnabled;
  const brushPerformanceModeRef = useRef(settings.brushPerformanceMode);
  brushPerformanceModeRef.current = settings.brushPerformanceMode;
  // tutorialActiveRef moved to useOnboarding hook — destructured from onboarding result below

  // Framer brush size: 30% bigger on iPad portrait only (not iPhone)
  const framerBrushSize = useMemo(() => {
    return isIpadPortrait ? Math.round(brushSize * 1.3) : brushSize;
  }, [isIpadPortrait, brushSize]);

  // Calculate canvas pixel size (same as TimelapseScreen for consistency)
  const originalCanvasSize = useMemo(() => {
    // Match PaintScreen canvas calculation EXACTLY
    const base = Math.min(windowSize.width, windowSize.height * 0.85);
    return IS_IPAD ? base * 0.8 : base;
  }, [windowSize.width, windowSize.height]);

  const canvasPixelSize = useMemo(() => Math.max(1, Math.round(originalCanvasSize)), [originalCanvasSize]);

  // Scale strokes for export (same as TimelapseScreen)
  const scaleStrokesForExport = useCallback((input: Stroke[], targetSize: number, sourceSize: number): Stroke[] => {
    if (!Number.isFinite(sourceSize) || sourceSize <= 0) {
      return input;
    }
    const scale = targetSize / sourceSize;
    if (Math.abs(scale - 1) < 0.0001) {
      return input;
    }

    return input.map((stroke) => ({
      ...stroke,
      brushSize: stroke.brushSize * scale,
      points: stroke.points.map((pt) => ({
        x: pt.x * scale,
        y: pt.y * scale,
        t: pt.t
      }))
    }));
  }, []);

  // Generate project preview using Metal stroke replay
  const capturePreview = useCallback(async () => {
    try {
      // Pass canvas size so native code renders at correct size (not inferred from bounds)
      return await generateProjectPreview(layeredForExport(strokes), 256, canvasSize, canvasSize);
    } catch (error) {
      console.error('Preview generation failed:', error);
      return null;
    }
  }, [layeredForExport, strokes]);

  // Snapshot system removed - stub functions for compatibility
  const registerPreviewCapture = useCallback((_fn: any) => {}, []);
  const updateSnapshotRasterSize = useCallback((_size: any) => {}, []);
  const recordSnapshotEvent = useCallback(async (_type: any, _options?: any) => {}, []);
  const setSnapshotsSuspended = useCallback((_suspended: boolean) => {}, []);
  const awaitSnapshotQueue = useCallback(async () => {}, []);
  const handleFramerBrushEmojiChange = useCallback((emoji: string) => {
    console.log('[PaintScreen] Framer changed brush emoji:', emoji);
    dispatch({ type: 'SET_BRUSH_EMOJI', emoji });
  }, [dispatch]);
  const handleFramerRecentEmojisChange = useCallback((emojis: string[]) => {
    console.log('[PaintScreen] Framer synced recent emojis:', emojis);
    if (Array.isArray(emojis)) {
      console.log('[PaintScreen] ✅ Emojis is array, dispatching:', emojis);
      dispatch({ type: 'SET_RECENT_EMOJIS', emojis });
    } else {
      console.error('[PaintScreen] ❌ ERROR: Emojis is NOT array!', typeof emojis, emojis);
    }
  }, [dispatch]);

  // Track current session/project name (scoped to app run)
  const [snapshotProjectId, setSnapshotProjectIdState] = useState<string>(DEFAULT_SNAPSHOT_PROJECT_ID);

  // Load current session-scoped name on mount; fallback to timestamped session id
  useEffect(() => {
    const loadSessionName = async () => {
      try {
        const sessionId = await getSessionId();
        // Default project name under this session
        const defaultName = 'active-session';
        setSnapshotProjectIdState(defaultName);
        await AsyncStorage.setItem('current_session_sessionId', sessionId);
      } catch (error) {
        console.error('Failed to load session name:', error);
      }
    };
    loadSessionName();
  }, []);

  // Clean up any stale PENDING_MYSTERY_TOPIC on launch (penalty system removed)
  useEffect(() => {
    AsyncStorage.removeItem('PENDING_MYSTERY_TOPIC').catch(() => {});
  }, []);

  // ── EXTRACT → src/features/challenge/useChallenge.ts ─────────────────────────
  // Word selection overlay state
  const [showWordSelection, setShowWordSelection] = useState(false);
  const wordingCancelledRef = useRef(false); // Track if user manually cancelled

  // Animation type selection modal state
  const [showAnimationModal, setShowAnimationModal] = useState(false);

  // Clear confirmation overlay state
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [strokesClearProgress, setStrokesClearProgress] = useState(0); // 0 to 1, how many strokes to hide

  // Handle wording mode start from route params
  useEffect(() => {
    if (route.params?.startWording && wording.mode === 'inactive' && !wordingCancelledRef.current) {
      console.log('[PaintScreen] Showing word selection overlay with language:', infoLanguage);
      setShowWordSelection(true);
    }
    // Hide word selection overlay when wording mode becomes active
    if (wording.mode === 'active') {
      setShowWordSelection(false);
    }
  }, [route.params?.startWording, wording.mode, infoLanguage]);

  // Handle wording letter export completion from Timelapse
  useEffect(() => {
    const { wordingVideoPath, wordingLetterIndex } = route.params || {};

    if (wordingVideoPath && wordingLetterIndex !== undefined && wording.mode === 'active') {
      console.log(`[PaintScreen] 🎉 Received exported video for letter ${wordingLetterIndex}: ${wordingVideoPath}`);

      // Notify wording context that the export is complete
      wording.onLetterExportComplete(wordingLetterIndex, wordingVideoPath);

      // Clear the params to prevent re-processing
      navigation.setParams({
        wordingVideoPath: undefined,
        wordingLetterIndex: undefined
      });
    }
  }, [route.params?.wordingVideoPath, route.params?.wordingLetterIndex, wording, navigation]);

  // Handle Framer auto-open with video import
  useEffect(() => {
    const { openFramer, framerAutoImportVideoUri, framerAutoImportVideoDuration } = route.params || {};

    if (openFramer && framerAutoImportVideoUri && framerAutoImportVideoDuration) {
      console.log(`[PaintScreen] Auto-opening Framer with video: ${framerAutoImportVideoUri}`);

      // Store video import params for Framer
      setFramerAutoImportVideo({
        uri: framerAutoImportVideoUri,
        duration: framerAutoImportVideoDuration
      });

      // Open Framer workspace
      setFramerWorkspaceVisible(true);

      // Clear the params to prevent re-processing
      navigation.setParams({
        openFramer: undefined,
        framerAutoImportVideoUri: undefined,
        framerAutoImportVideoDuration: undefined
      });
    }
  }, [route.params?.openFramer, route.params?.framerAutoImportVideoUri, route.params?.framerAutoImportVideoDuration, navigation]);

  // When an overlay (leaderboard/gallery) is opened FROM a profile page, remember which profile so we
  // can send the user back there on close (instead of stranding them on the workspace).
  const returnToProfileRef = useRef<string | null>(null);
  const returnToProfileAfterWorkspaceRef = useRef<string | null>(null);
  const [profileStudioOpenRequest, setProfileStudioOpenRequest] = useState(0);
  // Tracks the last profileStudioOpenRequest value already handled, so the
  // open-workspace effect runs exactly once per request (never latches/re-fires).
  const profileStudioOpenHandledRef = useRef(0);
  // Autosave recovery must run exactly once per mount — its effect deps are not
  // stable, so without this guard it re-fires and pops the resume modal over
  // whatever the user is doing (e.g. the Profil Studio workspace).
  const autosaveRecoveryRanRef = useRef(false);
  const consumeReturnToProfile = useCallback((): boolean => {
    const target = returnToProfileRef.current;
    if (!target) return false;
    returnToProfileRef.current = null;
    navigation.navigate('ProfilePage', { deviceId: target });
    return true;
  }, [navigation]);

  // Handle auto-open gallery from navigation params (e.g., from Framer upload success)
  useEffect(() => {
    const { openGallery: shouldOpenGallery, returnToProfile } = route.params || {};

    if (shouldOpenGallery && !galleryVisible) {
      console.log('[PaintScreen] Auto-opening Gallery from navigation params');
      if (returnToProfile) returnToProfileRef.current = returnToProfile;
      openGallery();

      // Clear params
      navigation.setParams({
        openGallery: undefined,
        returnToProfile: undefined
      });
    }
  }, [route.params?.openGallery, galleryVisible, openGallery, navigation]);

  // Handle "open Profile Studio" requests from ProfilePage owner buttons. The
  // dedicated flag avoids mixing this route with the normal paint workspace.
  useEffect(() => {
    const {
      openProfileStudio,
      profileStudioReturnTo,
      openPassport,
      returnToProfile: legacyReturnToProfile,
    } = route.params ?? {};
    const shouldOpenProfileStudio = openProfileStudio === true || openPassport === true;
    const returnTarget = profileStudioReturnTo ?? legacyReturnToProfile;
    // Remember where to return (the ProfilePage device id) so close/upload can
    // navigate back to the profile page instead of the main paint workspace.
    if (returnTarget) returnToProfileAfterWorkspaceRef.current = String(returnTarget);
    if (!shouldOpenProfileStudio) return;
    console.log('[PaintScreen] Opening Profil Studio workspace from navigation params');
    // Clear the one-shot params immediately so re-focusing Paint never re-opens
    // the studio. The nonce guarantees each request produces distinct params.
    navigation.setParams({
      openProfileStudio: undefined,
      profileStudioReturnTo: undefined,
      openPassport: undefined,
      returnToProfile: undefined,
      profileStudioNonce: undefined
    });
    setProfileStudioOpenRequest(request => request + 1);
  }, [
    route.params?.openProfileStudio,
    route.params?.openPassport,
    route.params?.profileStudioNonce,
    route.params?.profileStudioReturnTo,
    route.params?.returnToProfile,
    navigation,
  ]);

  // Handle "open leaderboard" request (e.g. from the new ProfilePage slide-in
  // menu). The leaderboard is an in-screen overlay (not a route), so we call the
  // existing openLeaderboard() then clear the param.
  useEffect(() => {
    const { openLeaderboard: shouldOpenLeaderboard, returnToProfile } = route.params || {};
    if (shouldOpenLeaderboard) {
      console.log('[PaintScreen] Opening profile leaderboard from navigation params');
      if (returnToProfile) returnToProfileRef.current = returnToProfile;
      leaderboard?.openLeaderboard();
      navigation.setParams({ openLeaderboard: undefined, returnToProfile: undefined });
    }
  }, [route.params?.openLeaderboard, leaderboard?.openLeaderboard]);

  useEffect(() => {
    const { openCoinShop: shouldOpenCoinShop, returnToProfile } = route.params || {};
    if (shouldOpenCoinShop) {
      if (IS_LITE_BUILD) {
        navigation.setParams({ openCoinShop: undefined, returnToProfile: undefined });
        return;
      }
      console.log('[PaintScreen] Opening coin shop from navigation params');
      if (returnToProfile) returnToProfileRef.current = returnToProfile;
      setCoinShopVisible(true);
      navigation.setParams({ openCoinShop: undefined, returnToProfile: undefined });
    }
  }, [route.params?.openCoinShop, navigation]);

  // Open AR chooser from route param (e.g. from ProfilePage or overlay nav)
  useEffect(() => {
    if (route.params?.openAR) {
      setArChooserVisible(true);
      navigation.setParams({ openAR: undefined });
    }
  }, [route.params?.openAR]);

  useEffect(() => {
    if (route.params?.openFaceFilter) {
      setArPaintingVisible(false);
      setFrontCameraSessionToken((token) => token + 1);
      setFrontCameraMaskVisible(true);
      navigation.setParams({ openFaceFilter: undefined });
    }
  }, [route.params?.openFaceFilter]);

  useEffect(() => {
    if (route.params?.openArPainting) {
      setArPaintingVisible(true);
      navigation.setParams({ openArPainting: undefined });
    }
  }, [route.params?.openArPainting]);

  useEffect(() => {
    if (route.params?.openAnimator) {
      setFramerWorkspaceVisible(true);
      navigation.setParams({ openAnimator: undefined });
    }
  }, [route.params?.openAnimator]);

  useEffect(() => {
    if (route.params?.openVector) {
      setVectorWorkspaceVisible(true);
      navigation.setParams({ openVector: undefined });
    }
  }, [route.params?.openVector]);

  // Set wording callbacks
  useEffect(() => {

    // Provide callback to get current strokes for export
    wording.onGetCurrentStrokes = () => {
      const snapshot = cloneStrokes(strokes);
      console.log('[PaintScreen] onGetCurrentStrokes returning snapshot with', snapshot.length, 'strokes');
      return snapshot;
    };

    // Provide callback to clear canvas when letter completes
    wording.onLetterComplete = async () => {
      console.log('[PaintScreen] ✨ onLetterComplete called - clearing canvas for next letter');
      // Clear all strokes
      dispatch({ type: 'CLEAR_STROKES' });
      lastPointRef.current = null;
      console.log('[PaintScreen] ✅ Canvas cleared');
    };

    // Provide callback when all letters complete - auto-load to video editor
    wording.onAllComplete = async (videoPath: string) => {
      console.log('[PaintScreen] Word complete! Loading all letter videos to editor...');

      try {
        // Collect all letter video paths
        const letterVideos = wording.letters
          .filter(l => l.exportPath) // Only letters with exported videos
          .map(l => l.exportPath!);

        console.log(`[PaintScreen] Found ${letterVideos.length} letter videos to load`);

        if (letterVideos.length === 0) {
          console.warn('[PaintScreen] No letter videos found!');
          return;
        }

        // Import each letter video into storage and collect their IDs
        const { addVideo } = require('../video/videoStorage');
        const videoIds: string[] = [];

        for (let i = 0; i < letterVideos.length; i++) {
          const letterPath = letterVideos[i];
          const letter = wording.letters[i];
          const filename = `${wording.word}_letter_${letter.letter}.mov`;

          console.log(`[PaintScreen] Importing letter ${letter.letter}: ${filename}`);

          // Add to storage
          const videoId = await addVideo(letterPath, filename);
          videoIds.push(videoId);
        }

        console.log(`[PaintScreen] ✅ Imported ${videoIds.length} letter videos`);

        // Video editor coming soon - show overlay
        setVideoEditorComingSoonVisible(true);

      } catch (error) {
        console.error('[PaintScreen] Failed to load videos to editor:', error);
        CustomOverlayHelper.alert('Error', 'Failed to load videos to editor');
      }
    };

    // Provide callback to get canvas size for export scaling
    wording.onGetCanvasSize = () => {
      console.log('[PaintScreen] onGetCanvasSize called, returning', canvasPixelSize);
      return canvasPixelSize;
    };

    // Provide callback to scale strokes for export
    wording.onScaleStrokes = (strokes: Stroke[], targetSize: number, sourceSize: number) => {
      console.log('[PaintScreen] onScaleStrokes called:', { strokeCount: strokes.length, targetSize, sourceSize });
      return scaleStrokesForExport(strokes, targetSize, sourceSize);
    };

    // Provide callback to navigate to Timelapse for auto-export
    wording.onNavigateToTimelapse = (letterIndex: number, capturedStrokes: any[]) => {
      const strokeSnapshot = cloneStrokes(capturedStrokes);
      console.log(`[PaintScreen] 🚀 Navigating to Timelapse for letter ${letterIndex} auto-export with ${strokeSnapshot.length} strokes`);
      navigation.navigate('Timelapse', {
        autoExport: true,
        wordingMode: true,
        wordingLetterIndex: letterIndex,
        wordingStrokes: strokeSnapshot
      });
    };
  }, [strokes, dispatch, wording, navigation, canvasPixelSize, scaleStrokesForExport]);

  // Save session name when it changes
  const setSnapshotProjectId = useCallback(async (projectId: string) => {
    setSnapshotProjectIdState(projectId);
    try {
      await AsyncStorage.setItem('current_session_name', projectId);
    } catch (error) {
      console.error('Failed to save session name:', error);
    }
  }, []);

  // ── KEEP IN PaintScreen — canvas, tools, strokes ─────────────────────────────
  const [isTraceAdjusting, setTraceAdjusting] = useState(false);
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [isExporting, setExporting] = useState(false);
  const [canvasZoomLevel, setCanvasZoomLevel] = useState(1);
  const hasInitializedEmoji = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const stylusActiveRef = useRef(false);
  const liveStrokeRef = useRef<Stroke | null>(null);
  const liveUpdateRef = useRef<number | null>(null);
  const lastStrokeEndTimeRef = useRef<number>(0); // Track when last stroke ended
  const lastStrokeCountRef = useRef<number>(0); // Track stroke count for rating system
  const [liveVersion, setLiveVersion] = useState(0);
  const brushSizeRef = useRef(brushSize);
  const brushOpacityRef = useRef(brushOpacity);
  const brushModeRef = useRef(brushMode);
  const smudgeSmoothnessRef = useRef(smudgeSmoothness);
  const smudgeLastEventTimeRef = useRef(0);
  const brushEmojiRef = useRef(brushEmoji);
  const brushSpacingRef = useRef(brushSpacing);
  const brushRotationRef = useRef(brushRotation);
  const mirrorXRef = useRef(mirrorX);
  const mirrorYRef = useRef(mirrorY);
const liveSpacingRef = useRef<number | null>(null);
const liveRawPointsRef = useRef<{ x: number; y: number; t: number }[]>([]);
const liveOutputPointsRef = useRef<{ x: number; y: number; t: number }[]>([]);
const liveSpacingCarryRef = useRef(0);
const liveCurrentSpacingRef = useRef(brushSpacing);
const liveStrokeStartRef = useRef<number | null>(null);
const liveLongStrokeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
const liveLastSnapshotRef = useRef<number | null>(null);
const liveLongStrokeFrameIndexRef = useRef(0);
const strokeCountRef = useRef(strokes.length);
const smudgeCountRef = useRef(0);
const viewShotRef = useRef<ViewShot | null>(null);
  const challengeCanvasRef = useRef<ViewShot | null>(null);
  const brushCaptureRef = useRef<ViewShot | null>(null);
  // challengeStartedAtRef, challengeEndedAtRef, challengeLastPromptRef,
  // finalizeChallengeRef, activeChallengeRef — moved to useChallenge hook (destructured below)
  const challengeAutosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generalAutosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineStartRef = useRef<StrokePoint | null>(null);
  /** Current straight-line endpoint. Together with lineStartRef these are the
   *  ONLY inputs to the line's geometry — see the line block in the move
   *  handler. Cleared wherever lineStartRef is. */
  const lineEndRef = useRef<StrokePoint | null>(null);
  const mainPaintingBackupRef = useRef<StoredPaintingState | null>(null);
  const mainCanvasZoomBackupRef = useRef<{ scale: number; translateX: number; translateY: number } | null>(null);
  const privateStudioActiveRef = useRef(false);
  const privateStudioSavingInProgressRef = useRef(false); // Lock to prevent race conditions
  const privateStudioTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Long press emoji picker refs
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPositionRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const activeDrawingTouchIdRef = useRef<number | null>(null);
  const strokeStartFrameIndexRef = useRef<number | null>(null); // Track frame index when stroke started
  const privateStudioSessionStartRef = useRef<number | null>(null);
  const privateStudioElapsedBaseRef = useRef(0);
  const privateStudioAutosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUploadedPassportPortraitRef = useRef<string | null>(null);
  const lastGalleryUploadRef = useRef<DailyPaintUploadResult | null>(null);
  const galleryLastFetchedRef = useRef(0);
  const galleryNeedsRefreshRef = useRef(false);
  const clearPrivateStudioTipTimers = useCallback(() => {
    if (privateStudioTipIntervalRef.current) {
      clearInterval(privateStudioTipIntervalRef.current);
      privateStudioTipIntervalRef.current = null;
    }
    if (privateStudioTipTimeoutRef.current) {
      clearTimeout(privateStudioTipTimeoutRef.current);
      privateStudioTipTimeoutRef.current = null;
    }
  }, []);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const totalStatsRef = useRef<GlobalStatsSnapshot>({ totalTimeMs: 0, totalStrokes: 0, coins: 0 });
  // Canvas redraw bookkeeping only. Lifetime stroke totals are recorded at the
  // COMMIT_STROKE boundary in PaintingContext, never from array length changes.
  const previousStrokeCountRef = useRef(strokes.length);
  const initialSnapshotSize = clampSnapshotDimensions(canvasSize, canvasSize * CANVAS_RATIO);
  const snapshotCaptureSizeRef = useRef<{ width: number; height: number }>(initialSnapshotSize);

  useEffect(() => {
    const { width, height } = clampSnapshotDimensions(canvasSize, canvasSize * CANVAS_RATIO);
    snapshotCaptureSizeRef.current = { width, height };
    updateSnapshotRasterSize({ w: width, h: height });
  }, [canvasSize, updateSnapshotRasterSize]);

  useEffect(() => () => {
    setSnapshotsSuspended(false);
  }, [setSnapshotsSuspended]);

  // CRITICAL: When strokes are loaded from Redux (LOAD_STATE dispatch), increment liveVersion
  // to trigger Canvas re-render. This ensures loaded projects display correctly.
  useEffect(() => {
    // Track stroke count to detect changes
    const currentCount = strokes.length;
    if (previousStrokeCountRef.current !== currentCount) {
      console.log('[PaintScreen] 🔄 Strokes changed from', previousStrokeCountRef.current, 'to', currentCount, '- triggering canvas redraw');
      previousStrokeCountRef.current = currentCount;
      setLiveVersion((prev) => prev + 1);
    }
  }, [strokes.length]);

const capturePreviewImage = useCallback(async (options?: (Partial<CaptureOptions> & { snapshotMode?: SnapshotSizeMode })): Promise<string | null> => {
    const target = challengeCanvasRef.current ?? viewShotRef.current;
    if (!target) {
      console.error('[capturePreviewImage] No target ref available');
      return null;
    }
    console.log('[capturePreviewImage] Target ref found, attempting capture with options:', options);
    try {
      const { snapshotMode = 'default', ...rest } = options ?? {};
      const captureOptions: CaptureOptions = {
        format: 'png',
        quality: 0.9,
        result: 'base64',
        ...rest
      };
      if (captureOptions.width == null && captureOptions.height == null) {
        captureOptions.width = snapshotCaptureSizeRef.current.width;
        captureOptions.height = snapshotCaptureSizeRef.current.height;
      } else {
        const width = typeof captureOptions.width === 'number' && Number.isFinite(captureOptions.width)
          ? captureOptions.width
          : snapshotCaptureSizeRef.current.width;
        const height = typeof captureOptions.height === 'number' && Number.isFinite(captureOptions.height)
          ? captureOptions.height
          : snapshotCaptureSizeRef.current.height;
        const clamped = clampSnapshotDimensions(width, height, snapshotMode);
        captureOptions.width = clamped.width;
        captureOptions.height = clamped.height;
      }

      // IMPORTANT: Clamp dimensions for passport portraits to avoid capture failures
      // iOS drawViewHierarchyInRect fails with very large dimensions (>2048)
      if (captureOptions.width > 1024 || captureOptions.height > 1024) {
        const aspectRatio = captureOptions.width / captureOptions.height;
        if (aspectRatio > 1) {
          captureOptions.width = 1024;
          captureOptions.height = Math.round(1024 / aspectRatio);
        } else {
          captureOptions.height = 1024;
          captureOptions.width = Math.round(1024 * aspectRatio);
        }
        console.log('[capturePreviewImage] Clamped dimensions to avoid iOS capture failure:', captureOptions.width, 'x', captureOptions.height);
      }

      const mode = captureOptions.result ?? 'base64';
      console.log('[capturePreviewImage] Calling captureRef with options:', captureOptions);
      const result = await captureRef(target, captureOptions);
      console.log('[capturePreviewImage] captureRef result:', result ? 'Got result' : 'null');
      if (!result) {
        console.error('[capturePreviewImage] captureRef returned null');
        return null;
      }
      if (mode === 'tmpfile') {
        return result.startsWith('file://') ? result : `file://${result}`;
      }
      if (mode === 'base64') {
        return result.startsWith('data:') ? result : `data:image/png;base64,${result}`;
      }
      return result;
    } catch (error) {
      console.error('[capturePreviewImage] Error during capture:', error);
      return null;
    }
  }, [snapshotCaptureSizeRef]);

  // Capture workspace snapshot for framer background (CANVAS ONLY - like PNG export)
  const captureWorkspaceSnapshot = useCallback(async (): Promise<void> => {
    // Use challengeCanvasRef to capture ONLY the painting area (not UI elements)
    const target = challengeCanvasRef.current ?? viewShotRef.current;
    if (!target) {
      console.warn('[captureWorkspaceSnapshot] No canvas ref available');
      return;
    }

    try {
      // Capture square canvas at 2x resolution for better quality in Framers
      const captureWidth = Math.round(canvasSize * 2);
      const captureHeight = Math.round(canvasSize * 2);

      console.log(`[captureWorkspaceSnapshot] Capturing CANVAS ONLY snapshot: ${captureWidth}x${captureHeight}px (2x resolution for Framers)`);

      const result = await captureRef(target, {
        format: 'png',
        quality: 0.9,
        result: 'tmpfile',
        width: captureWidth,
        height: captureHeight
      });

      if (!result) {
        console.error('[captureWorkspaceSnapshot] captureRef returned null');
        return;
      }

      const uri = result.startsWith('file://') ? result : `file://${result}`;
      console.log('[captureWorkspaceSnapshot] ✅ Canvas-only snapshot captured:', uri);
      setWorkspaceSnapshotUri(uri);
    } catch (error) {
      console.error('[captureWorkspaceSnapshot] Error during capture:', error);
    }
  }, [canvasSize]);

  useEffect(() => {
    registerPreviewCapture((captureOptions) => {
      const size = captureOptions?.size;
      const snapshotMode: SnapshotSizeMode = size && size <= LONG_STROKE_SNAPSHOT_SIDE ? 'compact' : 'default';
      return capturePreviewImage({
        result: 'tmpfile',
        quality: 0.85,
        width: size,
        height: size,
        snapshotMode
      });
    });
    return () => {
      registerPreviewCapture(null);
    };
  }, [capturePreviewImage, registerPreviewCapture]);

  // Check if user has videos in storage when component mounts
  useEffect(() => {
    const checkVideoStorage = async () => {
      try {
        const videos = await getAllVideos();
        const actualVideos = videos.filter(v => !v.isFolder);
        setHasVideosInStorage(actualVideos.length > 0);
        setHasMovVideos(actualVideos.length > 0);
      } catch (error) {
        console.error('[PaintScreen] Error checking video storage:', error);
        setHasVideosInStorage(false);
      }
    };
    void checkVideoStorage();
  }, []);

  const [toolMode, setToolMode] = useState<ToolMode>('brush');
  const toolModeRef = useRef<ToolMode>('brush');
  const [brushOptionsVisible, setBrushOptionsVisible] = useState(false);
  const brushOptionsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const infoPulseValue = useRef(new RNAnimated.Value(0)).current;
  const infoPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Polygon tool state
  const [polygonPoints, setPolygonPoints] = useState<Array<{ x: number; y: number }>>([]);
  const polygonPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const [draggingPolygonIndex, setDraggingPolygonIndex] = useState<number | null>(null);
  const draggingPolygonIndexRef = useRef<number | null>(null);

  // Emoji plane tool state (normal workspace - no keyframes)
  // emojiPlanes now comes from context (line 1595)
  const emojiPlanesRef = useRef<EmojiPlane[]>([]); // Ref for touch handlers to avoid stale closures
  const [selectedPlaneId, setSelectedPlaneId] = useState<string | null>(null);
  const selectedPlaneIdRef = useRef<string | null>(null);
  const [draggingCorner, setDraggingCorner] = useState<{ planeId: string; corner: string } | null>(null);
  const draggingCornerRef = useRef<{ planeId: string; corner: string; offsetX?: number; offsetY?: number } | null>(null);
  const dragStartCornersRef = useRef<EmojiPlane['corners'] | null>(null); // Store initial corners for undo step
  // Gesture geometry lives here until touch-up. Keeping a real immutable preview array (instead of
  // mutating PaintingContext objects) makes every lattice move render immediately while preserving
  // the pre-gesture context snapshot for a single correct undo step.
  const [emojiPlaneGesturePreview, setEmojiPlaneGesturePreview] = useState<EmojiPlane[] | null>(null);
  const planePinchRef = useRef<{
    planeId: string;
    initialDistance: number;
    initialPlane: EmojiPlane;
    initialTouchPos?: { x: number; y: number };
    lastTouchPos?: { x: number; y: number };
  } | null>(null);
  const nextZIndexRef = useRef(0);
  const [planeLifetime, setPlaneLifetime] = useState(30); // Default lifetime for new planes
  const [draggingPlaneId, setDraggingPlaneId] = useState<string | null>(null); // For list reordering
  const [planeExtrasId, setPlaneExtrasId] = useState<string | null>(null); // Long-press extras (eye/duplicate)
  const planeExtrasTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [commitDialogVisible, setCommitDialogVisible] = useState(false);
  const [commitDialogMode, setCommitDialogMode] = useState<'one' | 'all' | null>(null);
  const pendingToolModeRef = useRef<ToolMode | null>(null); // Remember which tool to switch to

  // Tutorial system state — moved to useOnboarding hook (destructured below after hook call)

  // Plus button animation (glow and scale when no planes)
  const plusButtonScale = useSharedValue(1);
  const plusButtonGlow = useSharedValue(0);

  // Trigger animation when all planes are committed
  useEffect(() => {
    if (isEmojiPlaneActive && emojiPlanes.length === 0) {
      // Animate 3 times: scale up and glow
      plusButtonScale.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 300 }),
          withTiming(1, { duration: 300 })
        ),
        3, // Repeat 3 times
        false
      );
      plusButtonGlow.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 300 }),
          withTiming(0, { duration: 300 })
        ),
        3,
        false
      );
    }
  }, [emojiPlanes.length, isEmojiPlaneActive, plusButtonScale, plusButtonGlow]);

  // Deselect emoji plane when tool is deselected
  useEffect(() => {
    if (!isEmojiPlaneActive && selectedPlaneId !== null) {
      setSelectedPlaneId(null);
      selectedPlaneIdRef.current = null;
      console.log('[PAINT TOOL] Tool changed away from emojiplane, deselected plane');
    }
  }, [isEmojiPlaneActive, selectedPlaneId]);

  // Re-entering the tool leaves selectedPlaneId null, and the canvas only lets you drag a plane
  // that is ALREADY selected — without this, planes left over from a previous session of the tool
  // become permanently unreachable (and the controls panel would never appear for them).
  useEffect(() => {
    if (!isEmojiPlaneActive || selectedPlaneId !== null || emojiPlanes.length === 0) return;
    const topmost = [...emojiPlanes].sort((a, b) => a.zIndex - b.zIndex)[emojiPlanes.length - 1];
    setSelectedPlaneId(topmost.id);
    selectedPlaneIdRef.current = topmost.id;
  }, [isEmojiPlaneActive, selectedPlaneId, emojiPlanes]);

  const plusButtonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: plusButtonScale.value }],
    shadowOpacity: 0.3 + (plusButtonGlow.value * 0.5),
    shadowRadius: 4 + (plusButtonGlow.value * 8)
  }));

  // tutorialBlinkScale + tutorialBlinkOpacity moved to useOnboarding hook (destructured below)
  const [fullscreenImageUri, setFullscreenImageUri] = useState<string | null>(null);
  const [gesserTopicVisible, setGesserTopicVisible] = useState(false);
  const [gesserGuessVisible, setGesserGuessVisible] = useState(false);
  // Mystery topic state — moved to useChallenge hook (destructured below after hook call)
  const [gesserDiscoveryVisible, setGesserDiscoveryVisible] = useState(false);
  const [gesserFriendsVisible, setGesserFriendsVisible] = useState(false);

  // Suggest topic UI
  const [suggestTopicMode, setSuggestTopicMode] = useState<'input' | 'review' | null>(null);
  const [suggestTopicInput, setSuggestTopicInput] = useState('');
  const [reviewTopicData, setReviewTopicData] = useState<{id: number; topic: string} | null>(null);

  // Mystery guess overlay (inline guess in gallery)
  const [guessOverlayVisible, setGuessOverlayVisible] = useState(false);
  const [guessInput, setGuessInput] = useState(''); // blank-fill chars typed by user
  const [selectedMysteryPainting, setSelectedMysteryPainting] = useState<DailyPaintGalleryEntry | null>(null);
  const [guessLoading, setGuessLoading] = useState(false);
  const [guessFeedback, setGuessFeedback] = useState<{type: 'success' | 'error'; message: string} | null>(null);
  const guessInputRef = useRef<TextInput>(null);
  const [guessedPaintings, setGuessedPaintings] = useState<Set<number>>(new Set()); // Correctly solved paintings (permanently done)
  const [guessAttempts, setGuessAttempts] = useState<Record<number, number>>({}); // paintingId → attempt count
  const [guessWinVisible, setGuessWinVisible] = useState(false);
  const [guessWinStyleIdx, setGuessWinStyleIdx] = useState(0);
  const [guessAllDone, setGuessAllDone] = useState(false);
  const guessWinParticles = useRef(
    Array.from({ length: 24 }, () => ({
      tx: new RNAnimated.Value(0),
      ty: new RNAnimated.Value(0),
      op: new RNAnimated.Value(0),
      sc: new RNAnimated.Value(1),
      rot: new RNAnimated.Value(0),
    }))
  ).current;

  // iPad landscape orientation detection
  const [isLandscape, setIsLandscape] = useState(() => {
    if (!IS_IPAD) return false;
    const dims = Dimensions.get('window');
    return dims.width > dims.height;
  });
  const [fullscreenImageInfo, setFullscreenImageInfo] = useState<{ topic: string; author: string; date: string; time: string } | null>(null);


  // Listen for orientation changes on iPad
  useEffect(() => {
    if (!IS_IPAD) return;

    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      const newIsLandscape = window.width > window.height;
      setIsLandscape(newIsLandscape);
    });

    return () => subscription?.remove();
  }, []);

  const { sets: emojiSets, activeSetId, setActiveSet: setEmojiSet, importSet: importEmojiSet, deleteSet: deleteEmojiSet } = useEmojiSet();
  const [emojiStyleOpen, setEmojiStyleOpen] = useState(false);
  const [emojiImporting, setEmojiImporting] = useState(false);
  const activeEmojiSetName = emojiSets.find((s) => s.id === activeSetId)?.name ?? 'Apple';
  const [videoEditorComingSoonVisible, setVideoEditorComingSoonVisible] = useState(false);
  const [hasVideosInStorage, setHasVideosInStorage] = useState(false);

// ── Welcome overlay + tutorial state moved to useOnboarding hook ──────────────
// All welcome/tutorial state is now returned from the onboarding hook (declared below
// after the infoPanel hook call). Destructured values are available via `onboarding`.
// Only dailyPromptsVersion + dailyPrompts remain here (used across non-onboarding code).
const [dailyPromptsVersion, setDailyPromptsVersion] = useState(0);
const dailyPrompts = useMemo(() => getDailyPrompts(new Date()), [dailyPromptsVersion]);

const [framePickerVisible, setFramePickerVisible] = useState(false);
const [frameButtonPosition, setFrameButtonPosition] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

// Coin Shop
const [coinShopVisible, setCoinShopVisible] = useState(false);

// Profile System States
const [profileWorkspaceVisible, setProfileWorkspaceVisible] = useState(false);
// NOTE: there is deliberately no AGB/terms gate in this screen any more.
// Acceptance is collected exactly once, by the first-launch intro in
// features/onboarding/CinematicIntro, before this screen can even mount — see
// lib/profileTermsConsent. Do not reintroduce a per-feature consent prompt:
// that is what left a fresh user unable to start a topic with no feedback.
const [profileSyncPromptData, setProfileSyncPromptData] = useState<ServerProfileSnapshot | null>(null);
const [profileSyncBusy, setProfileSyncBusy] = useState(false);
const [profileSyncStatus, setProfileSyncStatus] = useState<'checking' | 'insync' | 'server_newer' | null>(null);
const [profileSyncServerSnapshot, setProfileSyncServerSnapshot] = useState<ServerProfileSnapshot | null>(null);
const [deviceCreatedAt, setDeviceCreatedAt] = useState<string | null>(null);
const [worldBrowserVisible, setWorldBrowserVisible] = useState(false);
// ── EXTRACT → src/features/leaderboard/useLeaderboard.ts ─────────────────────
const [allUsersLeaderboard, setAllUsersLeaderboard] = useState<any[]>([]);
const [worldBrowserLoading, setWorldBrowserLoading] = useState(false);
const [worldBrowserImageTimestamp, setWorldBrowserImageTimestamp] = useState(Date.now());

// World Browser Pagination & Search
const [worldBrowserPage, setWorldBrowserPage] = useState(1);
const [worldBrowserSearch, setWorldBrowserSearch] = useState('');
const [worldBrowserHasMore, setWorldBrowserHasMore] = useState(true);
const [worldBrowserAllUsers, setWorldBrowserAllUsers] = useState<any[]>([]);
const WORLD_BROWSER_PAGE_SIZE = 100;

// Friend System
const [friendRequests, setFriendRequests] = useState<{
  sent: Set<string>;
  received: Set<string>;
  friends: Set<string>;
}>({
  sent: new Set(),
  received: new Set(),
  friends: new Set()
});
const [befriendLoading, setBefriendLoading] = useState<Set<string>>(new Set());
const [friendNotificationCount, setFriendNotificationCount] = useState(0);
// Friends feed: set of device IDs belonging to the current user's friends
const [friendsDeviceIds, setFriendsDeviceIds] = useState<Set<string>>(new Set());

// ── EXTRACT → src/features/gallery/useGallery.ts ─────────────────────────────
const [galleryVisitedThisSession, setGalleryVisitedThisSession] = useState(false);
const [profileNameEditMode, setProfileNameEditMode] = useState(false);
const [galleryPassportViewerVisible, setGalleryPassportViewerVisible] = useState(false);
const [galleryPassportViewerUser, setGalleryPassportViewerUser] = useState<any | null>(null);
const galleryPassportViewerScale = useRef(new RNAnimated.Value(0)).current;
const pendingServerProfilePromptRef = useRef<ServerProfileSnapshot | null>(null);
const profileSyncCheckRef = useRef(0);
const profileSyncDoneRef = useRef(false);

// ── EXTRACT → src/features/private-studio/usePrivateStudio.ts ────────────────
// Legacy private studio state (now represents workspace visibility)
const ps = usePrivateStudio();
const privateStudioVisible = ps.privateStudioVisible;
const setPrivateStudioVisible = ps.setPrivateStudioVisible;
// Legacy in-PaintScreen Profile Studio is still reachable in some full-build
// flows. Give it its own time owner just like the standalone ProfileStudio.
useLifetimeActivity('profile-studio', profileWorkspaceVisible || privateStudioVisible);
const privateStudioLoading = ps.privateStudioLoading;
const setPrivateStudioLoading = ps.setPrivateStudioLoading;
const privateStudioError = ps.privateStudioError;
const setPrivateStudioError = ps.setPrivateStudioError;
const privateStudioName = ps.privateStudioName;
const setPrivateStudioName = ps.setPrivateStudioName;
const privateStudioAutoNameAssignedRef = ps.privateStudioAutoNameAssignedRef;
const privateStudioRandomLocked = ps.privateStudioRandomLocked;
const setPrivateStudioRandomLocked = ps.setPrivateStudioRandomLocked;
const privateStudioRandomUsedRef = ps.privateStudioRandomUsedRef;
const privateStudioTypewriterTimeoutsRef = ps.privateStudioTypewriterTimeoutsRef;
const privateStudioTypewriterActiveRef = ps.privateStudioTypewriterActiveRef;
const privateStudioDiceScale = ps.privateStudioDiceScale;
const privateStudioCanvasFlight = ps.privateStudioCanvasFlight;
const privateStudioFlightVector = ps.privateStudioFlightVector;
const setPrivateStudioFlightVector = ps.setPrivateStudioFlightVector;
const privateStudioCanvasFlightTimeoutRef = ps.privateStudioCanvasFlightTimeoutRef;
const privateStudioElapsedMs = ps.privateStudioElapsedMs;
const setPrivateStudioElapsedMs = ps.setPrivateStudioElapsedMs;
const privateStudioStrokeCount = ps.privateStudioStrokeCount;
const setPrivateStudioStrokeCount = ps.setPrivateStudioStrokeCount;
const privateStudioSaving = ps.privateStudioSaving;
const setPrivateStudioSaving = ps.setPrivateStudioSaving;
const privateStudioUploadInFlight = ps.privateStudioUploadInFlight;
const setPrivateStudioUploadInFlight = ps.setPrivateStudioUploadInFlight;
const privateStudioStatusMessage = ps.privateStudioStatusMessage;
const setPrivateStudioStatusMessage = ps.setPrivateStudioStatusMessage;
// Projects modal state
const showProjectsModal = ps.showProjectsModal;
const setShowProjectsModal = ps.setShowProjectsModal;
const saveButtonEmoji = ps.saveButtonEmoji;
const setSaveButtonEmoji = ps.setSaveButtonEmoji;
const isSavePressed = ps.isSavePressed;
const setIsSavePressed = ps.setIsSavePressed;

  // Animated title emojis for export overlay
  const [exportTitleEmojiIndex, setExportTitleEmojiIndex] = useState(0);
  const EXPORT_TITLE_EMOJIS = ['🧑‍🔧', '👩‍🔧', '👨‍🔧'];

  // Animate export title emojis
  useEffect(() => {
    const interval = setInterval(() => {
      setExportTitleEmojiIndex(prev => (prev + 1) % EXPORT_TITLE_EMOJIS.length);
    }, 600);
    return () => clearInterval(interval);
  }, []);

  // Frame-by-frame animation state
  const [animatorMode, setAnimatorMode] = useState(false);
  const [animatorIsPlaying, setAnimatorIsPlaying] = useState(false);
  const [animatorLoop, setAnimatorLoop] = useState(true);
  const [animatorFps, setAnimatorFps] = useState(12);
  const [animatorStrokeLength, setAnimatorStrokeLength] = useState(3);
  const [animatorTotalFrames, setAnimatorTotalFrames] = useState(300);
  const [animatorPlayhead, setAnimatorPlayhead] = useState(0);
  const animatorFrameBufferRef = useRef(new FrameBuffer(animatorTotalFrames));
  const animatorRendererRef = useRef<AnimatorRenderer>(new NoopAnimatorRenderer());

  const [frameMode, setFrameMode] = useState(false);
  const [frames, setFrames] = useState<AnimationFrame[]>([]); // Start empty - first frame created on toggle
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null); // Track loaded project to prevent cross-contamination
  const [onionSkinning, setOnionSkinning] = useState({
    enabled: true,
    before: 1,
    after: 1,
    opacity: 0.3,
    color: '#ff6b6b' // Red tint for onion skins
  });
  const [isPlayingFrames, setIsPlayingFrames] = useState(false);
  const [framePaintLength, setFramePaintLength] = useState(3); // Default 3-frame lifetime during playback painting
  const [hideOnionForSnapshot, setHideOnionForSnapshot] = useState(false);
  const [frameTimelineVisible, setFrameTimelineVisible] = useState(true);
  const frameTimelineScrollRef = useRef<ScrollView | null>(null);
  const [frameSettingsVisible, setFrameSettingsVisible] = useState(false);
  const [cloneCount, setCloneCount] = useState('1');
  const [addFrameModalVisible, setAddFrameModalVisible] = useState(false);
  const [selectedFrameForMove, setSelectedFrameForMove] = useState<number | null>(null);
  const [frameButtonIcon, setFrameButtonIcon] = useState('📽️'); // Animated icon for frame button
  const [framerWorkspaceVisible, setFramerWorkspaceVisible] = useState(false); // Framer workspace modal

  // ── Challenge feature ─────────────────────────────────────────────────────
  // startChallenge, finalizeChallenge, awardCoins are defined later in this component,
  // so we forward them via a stable ref to avoid Temporal Dead Zone issues.
  const challengeLateRef = useRef<{
    startChallenge: (prompt: any) => void;
    finalizeChallenge: () => Promise<void>;
    awardCoins: (reason: string) => void;
  }>({
    startChallenge: () => {},
    finalizeChallenge: async () => {},
    awardCoins: () => {},
  });
  const challengeStartCallbackRef = useCallback((prompt: any) => {
    challengeLateRef.current.startChallenge(prompt);
  }, []);
  const challengeFinalizeCallbackRef = useCallback(async () => {
    return challengeLateRef.current.finalizeChallenge();
  }, []);
  const challengeAwardCoinsCallbackRef = useCallback((reason: string) => {
    challengeLateRef.current.awardCoins(reason);
  }, []);

  // setInfoVisible/openLeaderboard come from useInfoPanel()/useLeaderboard(),
  // which are declared later and themselves depend on values useChallenge()
  // produces (a genuine circular dependency, not just an ordering slip) — so
  // the same late-ref forwarding as challengeLateRef above is needed here.
  // Without it these were `undefined` on every render, and useChallenge.ts
  // calls setInfoVisible(false) directly inside the mystery-topic-start flow,
  // throwing "setInfoVisible is not a function" — the mystery challenge crash.
  const infoLateRef = useRef<{
    setInfoVisible: (v: boolean) => void;
    openLeaderboard: () => void;
  }>({
    setInfoVisible: () => {},
    openLeaderboard: () => {},
  });
  const setInfoVisibleLateCallback = useCallback((v: boolean) => {
    infoLateRef.current.setInfoVisible(v);
  }, []);
  const openLeaderboardLateCallback = useCallback(() => {
    infoLateRef.current.openLeaderboard();
  }, []);

  // Declared here (not at its original later position) because useChallenge()
  // below reads it synchronously on every render — a declaration further down
  // in this same function body would always be undefined at this point, since
  // each render re-executes top-to-bottom with no carry-over from prior
  // renders. This was silently sending device_id: undefined to the mystery
  // topic API on every request.
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const challenge = useChallenge({
    deviceId,
    strokes,
    infoLanguage,
    awardCoins: challengeAwardCoinsCallbackRef,
    openLeaderboard: openLeaderboardLateCallback,
    setInfoVisible: setInfoVisibleLateCallback,
    navigation,
    notificationService,
    dailyPrompts,
    startChallenge: challengeStartCallbackRef,
    finalizeChallenge: challengeFinalizeCallbackRef,
    framerWorkspaceVisible,
  });
  const {
    activeChallenge, setActiveChallenge, activeChallengeRef,
    challengeRemainingMs, setChallengeRemainingMs,
    challengeCompleteVisible, setChallengeCompleteVisible,
    uploadedPromptTopics, setUploadedPromptTopics,
    challengeStartedAtRef, challengeEndedAtRef, challengeLastPromptRef,
    challengeStrokeCountRef, prevChallengeStrokeCountRef,
    challengeCompletionHandledRef, challengeUploadedRef, finalizeChallengeRef,
    challengeSnapshotUri, setChallengeSnapshotUri,
    challengeCaptureLoading, setChallengeCaptureLoading,
    challengeUploadLoading, setChallengeUploadLoading,
    challengeUploadNotice, setChallengeUploadNotice,
    showFrameUploadModal, setShowFrameUploadModal,
    challengeStrokeCount, setChallengeStrokeCount,
    challengeConfirmPrompt, setChallengeConfirmPrompt,
    challengeConfirmEntries, setChallengeConfirmEntries,
    challengeConfirmLoading, setChallengeConfirmLoading,
    challengeConfirmProcessing, setChallengeConfirmProcessing,
    challengeConfirmError, setChallengeConfirmError,
    challengeConfirmPreviewEntry, setChallengeConfirmPreviewEntry,
    challengeConfirmAnimValuesRef,
    challengeConfirmEmoji, challengeConfirmEmojiAnimatedStyle,
    confirmCopy,
    showNotificationPrompt, setShowNotificationPrompt,
    notificationsEnabled, setNotificationsEnabled,
    mysteryTopic, setMysteryTopic,
    mysteryTopicLoading, setMysteryTopicLoading,
    mysteryTopicSelected, setMysteryTopicSelected,
    showMysteryTopicInInfo, setShowMysteryTopicInInfo,
    diceButtonCooldown, setDiceButtonCooldown,
    diceButtonCountdown, setDiceButtonCountdown,
    mysteryTopicChoices, setMysteryTopicChoices,
    mysteryTopicHistory, setMysteryTopicHistory,
    mysteryConfirmVisible, setMysteryConfirmVisible,
    mysteryBounceAnim, mysteryConfirmCancelledRef,
    mysteryTopicWarningVisible, setMysteryTopicWarningVisible,
    mysteryModalPanel, setMysteryModalPanel,
    mysteryTotalTopicCount, setMysteryTotalTopicCount,
    pendingMysteryTopicChoices, setPendingMysteryTopicChoices,
    mysteryPickerVisible, setMysteryPickerVisible,
    challengeMinutesForDay,
    handleChallengeSelect, cancelChallengeConfirm, confirmStartChallenge,
    openChallengeConfirmPreview, closeChallengeConfirmPreview,
    handleSkipNotifications, handleEnableNotifications,
    handleMysteryTopicSelect, handleMysteryTopicPicked,
    handleReloadMysteryTopic, handleStartMysteryPainting,
    handleCancelMysteryConfirm,
    confirmMysteryTopicWarning, cancelMysteryTopicWarning,
    handleShuffleMysteryTopics, cancelMysteryPicker,
    markPromptUploaded,
    getTopicMetadata,
  } = challenge;

  // Handle notification tap - open info overlay for topic challenge
  useEffect(() => {
    const { openInfoOverlay } = route.params || {};

    if (openInfoOverlay && !challengeConfirmPrompt) {
      console.log('[PaintScreen] Opening topic challenge from notification');

      // Open the shared topic picker used by the challenge feature.
      setMysteryPickerVisible(true);

      // Clear param
      navigation.setParams({
        openInfoOverlay: undefined
      });
    }
  }, [route.params?.openInfoOverlay, challengeConfirmPrompt, navigation]);

  // Restore one authoritative deadline. Legacy workspace autosaves may still
  // restore artwork, but they cannot create a second countdown session.
  useEffect(() => {
    let cancelled = false;
    void loadChallengeSession().then((session) => {
      if (cancelled || !session) return;
      const remaining = remainingChallengeMs(session);
      if (remaining <= 0) return;
      challengeStartedAtRef.current = session.startedAt;
      challengeLastPromptRef.current = session.prompt;
      setChallengeRemainingMs(remaining);
      setActiveChallenge({ prompt: session.prompt, endsAt: session.endsAt });
    });
    return () => { cancelled = true; };
  // Restore once for the mounted app; navigation between workspaces must not
  // recreate the session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  // ── AR modes (📽️ chooser → Face Filter / AR Painting / Animator) ──────────
  const [arChooserVisible, setArChooserVisible] = useState(false);
  // Vector Mode: the workspace as an infinite vector canvas.
  const [vectorWorkspaceVisible, setVectorWorkspaceVisible] = useState(false);
  const [vectorProjectName, setVectorProjectName] = useState<string | null>(null);
  const [arPaintingVisible, setArPaintingVisible] = useState(false);
  const [frontCameraMaskVisible, setFrontCameraMaskVisible] = useState(false);
  // Increment only for a fresh entry into Front Camera. Direct AR ↔ Front
  // switches leave this unchanged so each native scene keeps its own work.
  const [frontCameraSessionToken, setFrontCameraSessionToken] = useState(0);
  // When loading a saved AR scene from the project library, this dir is handed
  // to ArPaintingScreen which relocalizes the room and replays the strokes.
  const [arPendingSceneDir, setArPendingSceneDir] = useState<string | null>(null);
  const [arPendingPlacementUri, setArPendingPlacementUri] = useState<string | null>(null);
  // When the pending AR placement is a VIDEO (e.g. a timelapse "Open in AR"), the
  // native wall scene loops it as a textured plane (transparent MOV → see-through).
  const [arPendingPlacementIsVideo, setArPendingPlacementIsVideo] = useState(false);
  const [faceFilterModeActive, setFaceFilterModeActive] = useState(false);
  const [faceFilterOverlayVisible, setFaceFilterOverlayVisible] = useState(false);
  const [faceFilterTexturePath, setFaceFilterTexturePath] = useState<string | null>(null);
  const [faceFilterTemplate, setFaceFilterTemplate] = useState<'mask' | 'trackers'>('trackers');
  const faceFilterActiveRef = useRef(false);
  const [faceFilterCapturing, setFaceFilterCapturing] = useState(false);
  // Face filter mode has its OWN painting, fully separate from the main canvas
  const faceFilterPaintingRef = useRef<ReturnType<typeof takePaintingSnapshot> | null>(null);
  const [framerAutoImportVideo, setFramerAutoImportVideo] = useState<{ uri: string; duration: number } | null>(null); // Video to auto-import in Framer
  const [workspaceSnapshotUri, setWorkspaceSnapshotUri] = useState<string | null>(null); // Snapshot of workspace for framer background

  /**
   * FRAMER BACKGROUND — regenerated on EVERY entry, never cached.
   *
   * Composites the three visible layers of the CURRENT main-workspace artwork into one fresh
   * PNG and hands it to the Framer as its background. Runs on every open (paint → Framer →
   * paint → Framer again picks up the newest strokes), because a stale background silently
   * showing week-old artwork is worse than no background at all.
   *
   * Renders from STROKE DATA via the offscreen Skia path, not captureRef: the live canvas is a
   * Metal MTKView and capturing it off-screen can yield a blank PNG. This is the same replay the
   * gallery upload uses, so the background matches exactly what an export would produce.
   *
   * `layeredForExport` applies paint order + hidden-layer filtering, and the background is left
   * TRANSPARENT (no colour passed) so per-stroke alpha, soft brushes and triangle-tool alpha all
   * survive instead of being matted onto black or white.
   *
   * Touches ONLY the background. Framer frames/keyframes are separate state and are never
   * cleared here, so animation survives repeated round-trips.
   */
  const regenerateFramerBackground = useCallback(async () => {
    try {
      const visibleStrokesForFramer = layeredForExport(strokes ?? []);
      if (visibleStrokesForFramer.length === 0) {
        return;
      }
      const path = await renderStrokesToPngFile(
        visibleStrokesForFramer,
        canvasSize,
        canvasSize * CANVAS_RATIO,
        null
      );
      if (path) {
        setWorkspaceSnapshotUri(path.startsWith('file://') ? path : `file://${path}`);
      }
    } catch (error) {
      console.warn('[Framer] Could not regenerate background from main workspace:', error);
    }
  }, [canvasSize, layeredForExport, strokes]);

  // Fires on the false -> true transition ONLY, so every Framer entry gets a background built
  // from the newest main-workspace state. A ref guard (not the effect deps) drives this, because
  // `regenerateFramerBackground` changes identity whenever strokes change and would otherwise
  // re-run mid-session while the Framer is already open.
  const framerBackgroundArmedRef = useRef(false);
  useEffect(() => {
    if (!framerWorkspaceVisible) {
      framerBackgroundArmedRef.current = false;
      return;
    }
    if (framerBackgroundArmedRef.current) {
      return;
    }
    framerBackgroundArmedRef.current = true;
    void regenerateFramerBackground();
  }, [framerWorkspaceVisible, regenerateFramerBackground]);

  const [framerInitialData, setFramerInitialData] = useState<any | null>(null); // Initial Framer data when loading project
  const framerEmojiPickerOpen = useRef(false); // Track if emoji picker was opened from framer
  const framerWorkspaceRef = useRef<any>(null); // Ref to access Framer workspace functions
  const framerPersistentDataRef = useRef<any | null>(null); // Persistent Framer data across open/close cycles
  const [deleteConfirmActive, setDeleteConfirmActive] = useState(false); // Track if delete confirmation is active
  const [deleteAllConfirmActive, setDeleteAllConfirmActive] = useState(false); // Track if delete-all confirmation is active
  const [showDeleteAllPrompt, setShowDeleteAllPrompt] = useState(false);
  const deleteConfirmTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const deleteAllConfirmTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const deleteAllPromptTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const playFramesIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const playFramesAnimationRef = useRef<number | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const lastDisplayedFrameRef = useRef<number>(-1);
  const framesRef = useRef<AnimationFrame[]>(frames);
  const pendingFrameSyncRef = useRef(false);
  const currentFrameIndexRef = useRef(currentFrameIndex);
  const isPlayingFramesRef = useRef(isPlayingFrames); // Ref for always-current playback state
  const framePaintLengthRef = useRef(framePaintLength); // Ref for always-current paint length
  const resumeFrameIndexPendingRef = useRef<number | null>(null);

  // Thumbnail regeneration state
  const [regeneratingThumbnails, setRegeneratingThumbnails] = useState(false);
  const [thumbnailsRegenerated, setThumbnailsRegenerated] = useState(0);
  const [totalThumbnailsToRegenerate, setTotalThumbnailsToRegenerate] = useState(0);
  const playbackFpsRef = useRef<number>(exportFps); // Persistent ref for FPS used in playback loop
  const frameModeRef = useRef(frameMode); // Ref for always-current frame mode state (needed in gesture handlers)
  const activeFrameLengthRef = useRef(activeFrameLength); // Ref for always-current active frame length
  const liveFrameStrokeIdRef = useRef<string | null>(null); // Tracks the ID of the current live stroke being painted to frames
  const liveFrameTargetIndicesRef = useRef<number[]>([]);
  const liveFrameStrokeCopiesRef = useRef<Map<number, Stroke>>(new Map());
  const liveFrameAppliedPointsRef = useRef<Map<number, number>>(new Map());

  // Cache for pre-cloned frame strokes to avoid cloning on every playback tick
  // Limit cache to 100 frames to prevent unbounded memory growth
  const MAX_FRAME_CACHE_SIZE = 100;
  const frameCacheRef = useRef<Map<string, Stroke[]>>(new Map());

  // Refs for playback state to avoid dependency issues
  const playbackStateRef = useRef({
    brushEmoji,
    brushSize,
    brushOpacity,
    brushSpacing,
    brushRotation,
    mirrorX,
    mirrorY,
    recentEmojis,
    trace
  });

  // Keep refs in sync with state for playback without triggering re-renders
  useEffect(() => {
    framesRef.current = frames;
    // DON'T clear cache here - we invalidate cache entries selectively when modifying frames
    // Clearing the entire cache causes race conditions during playback when adding strokes
  }, [frames]);

  // Sync emojiPlanesRef with context state (for touch handlers to avoid stale closures)
  useEffect(() => {
    emojiPlanesRef.current = emojiPlanes;
  }, [emojiPlanes]);

  // Reopen framer workspace after emoji picker closes (if it was opened from framer)
  useEffect(() => {
    if (!emojiPickerVisible && framerEmojiPickerOpen.current) {
      framerEmojiPickerOpen.current = false;
      setTimeout(() => {
        setFramerWorkspaceVisible(true);
      }, 100);
    }
  }, [emojiPickerVisible]);

  // Auto-capture workspace snapshot when framer opens
  useEffect(() => {
    if (framerWorkspaceVisible) {
      // Small delay to ensure rendering is complete
      setTimeout(() => {
        void captureWorkspaceSnapshot();
      }, 100);
    }
  }, [framerWorkspaceVisible, captureWorkspaceSnapshot]);

  useEffect(() => {
    currentFrameIndexRef.current = currentFrameIndex;
  }, [currentFrameIndex]);

  useEffect(() => {
    isPlayingFramesRef.current = isPlayingFrames;
  }, [isPlayingFrames]);

  // Load guessed paintings + timestamps from AsyncStorage on mount
  useEffect(() => {
    const loadGuessedPaintings = async () => {
      try {
        const [storedGuessed, storedAttempts] = await Promise.all([
          AsyncStorage.getItem('@guessed_mystery_paintings'),
          AsyncStorage.getItem('@guess_attempts')
        ]);
        if (storedGuessed) {
          setGuessedPaintings(new Set(JSON.parse(storedGuessed)));
        }
        if (storedAttempts) {
          setGuessAttempts(JSON.parse(storedAttempts));
        }
      } catch {
        // ignore
      }
    };
    void loadGuessedPaintings();
  }, []);

  // Save guessed paintings to AsyncStorage when changed
  useEffect(() => {
    const saveGuessedPaintings = async () => {
      try {
        await AsyncStorage.setItem('@guessed_mystery_paintings', JSON.stringify([...guessedPaintings]));
      } catch {
        // ignore
      }
    };
    if (guessedPaintings.size > 0) {
      void saveGuessedPaintings();
    }
  }, [guessedPaintings]);

  // Save guess attempts to AsyncStorage when changed
  useEffect(() => {
    if (Object.keys(guessAttempts).length === 0) return;
    AsyncStorage.setItem('@guess_attempts', JSON.stringify(guessAttempts)).catch(() => {});
  }, [guessAttempts]);

  useEffect(() => {
    if (!isPlayingFrames && pendingFrameSyncRef.current) {
      pendingFrameSyncRef.current = false;
      console.log('[Play & Paint] Materializing frames after playback stopped...');
      const materializedFrames = framesRef.current.map(frame => ({
        ...frame,
        strokes: frame.strokes.map(stroke => ({
          ...stroke,
          points: stroke.points.map(point => ({ ...point }))
        }))
      }));
      framesRef.current = materializedFrames;
      setFrames(materializedFrames);
      console.log('[Play & Paint] Materialized', materializedFrames.length, 'frames with strokes');
    }
  }, [isPlayingFrames]);

  useEffect(() => {
    framePaintLengthRef.current = framePaintLength;
  }, [framePaintLength]);

  useEffect(() => {
    animatorFrameBufferRef.current.setFrameCount(animatorTotalFrames);
    if (animatorPlayhead >= animatorTotalFrames) {
      setAnimatorPlayhead(animatorTotalFrames - 1);
    }
  }, [animatorTotalFrames, animatorPlayhead]);

  const handleAnimatorToggleLoop = useCallback(() => {
    setAnimatorLoop(prev => !prev);
  }, []);

  const handleAnimatorTogglePlayback = useCallback(() => {
    setAnimatorIsPlaying(prev => !prev);
  }, []);

  const handleAnimatorPlayheadChange = useCallback((value: number) => {
    if (Number.isNaN(value)) return;
    const clamped = Math.max(0, Math.min(animatorTotalFrames - 1, Math.floor(value)));
    setAnimatorPlayhead(clamped);
  }, [animatorTotalFrames]);

  const handleAnimatorTotalFramesChange = useCallback((value: number) => {
    const clamped = Math.max(1, Math.min(20000, Math.floor(value)));
    setAnimatorTotalFrames(clamped);
  }, []);

  const handleAnimatorStrokeLenChange = useCallback((value: number) => {
    const clamped = Math.max(-1, Math.min(30, Math.floor(value)));
    setAnimatorStrokeLength(clamped);
  }, []);

  const handleAnimatorFpsChange = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(60, Math.floor(value)));
    setAnimatorFps(clamped);
  }, []);

  const handleAnimatorClose = useCallback(() => {
    setAnimatorIsPlaying(false);
    setAnimatorMode(false);
  }, []);

  useEffect(() => {
    if (!frameMode || !frameTimelineVisible || frames.length === 0) {
      return;
    }
    const scroll = frameTimelineScrollRef.current;
    if (!scroll) {
      return;
    }

    // Calculate sizes based on device and landscape mode
    const thumbSize = IS_IPAD && isLandscape ? 51 : (IS_IPAD ? 64 : 48);
    const gap = IS_IPAD && isLandscape ? 12 : (IS_IPAD ? 16 : 12);
    const padding = IS_IPAD && isLandscape ? 12 : 16;
    const itemWidth = thumbSize + gap;

    // Center the selected frame instead of left-aligning it
    const screenWidth = Dimensions.get('window').width;
    const centerOffset = (screenWidth / 2) - (thumbSize / 2);
    const target = frames.length <= 1
      ? 0
      : Math.max(0, (currentFrameIndex * itemWidth) - centerOffset + padding);

    scroll.scrollTo({ x: target, animated: true });
  }, [frameMode, frameTimelineVisible, frames.length, currentFrameIndex, isLandscape]);

  useEffect(() => {
    frameModeRef.current = frameMode;
  }, [frameMode]);

  useEffect(() => {
    activeFrameLengthRef.current = activeFrameLength;
  }, [activeFrameLength]);
  const calculateActiveFrames = useCallback((currentIndex: number, activeLength: number, totalFrames: number): number[] => {
    // Calculate which frames should receive strokes based on activeFrameLength
    // Center the range around the current frame
    const frames: number[] = [];
    const halfLength = Math.floor((activeLength - 1) / 2);

    for (let i = -halfLength; i <= halfLength + ((activeLength - 1) % 2); i++) {
      const frameIdx = currentIndex + i;
      if (frameIdx >= 0 && frameIdx < totalFrames) {
        frames.push(frameIdx);
      }
    }

    // If we're at the edges, try to maintain the requested count
    if (frames.length < activeLength) {
      if (currentIndex < halfLength) {
        // Near start, add more frames to the right
        for (let i = frames[frames.length - 1] + 1; i < totalFrames && frames.length < activeLength; i++) {
          frames.push(i);
        }
      } else if (currentIndex >= totalFrames - halfLength - 1) {
        // Near end, add more frames to the left
        for (let i = frames[0] - 1; i >= 0 && frames.length < activeLength; i--) {
          frames.unshift(i);
        }
      }
    }

    return frames;
  }, []);

  const resetLiveFrameStampTracking = useCallback(() => {
    liveFrameTargetIndicesRef.current = [];
    liveFrameStrokeCopiesRef.current.clear();
    liveFrameAppliedPointsRef.current.clear();
  }, []);

  const hideDeleteAllPrompt = useCallback(() => {
    if (deleteAllPromptTimeoutRef.current) {
      clearTimeout(deleteAllPromptTimeoutRef.current);
      deleteAllPromptTimeoutRef.current = null;
    }
    setShowDeleteAllPrompt(false);
  }, []);

  const showDeleteAllPromptTemporarily = useCallback(() => {
    setShowDeleteAllPrompt(true);
    if (deleteAllPromptTimeoutRef.current) {
      clearTimeout(deleteAllPromptTimeoutRef.current);
    }
    deleteAllPromptTimeoutRef.current = setTimeout(() => {
      setShowDeleteAllPrompt(false);
      deleteAllPromptTimeoutRef.current = null;
    }, 3000);
  }, []);

  const persistDeleteAllPrompt = useCallback(() => {
    setShowDeleteAllPrompt(true);
    if (deleteAllPromptTimeoutRef.current) {
      clearTimeout(deleteAllPromptTimeoutRef.current);
      deleteAllPromptTimeoutRef.current = null;
    }
  }, []);

  const startLiveFrameCopies = useCallback((baseStroke: Stroke) => {
    liveFrameTargetIndicesRef.current = [];
    liveFrameStrokeCopiesRef.current.clear();
    liveFrameAppliedPointsRef.current.clear();

    if (!frameModeRef.current || !isPlayingFramesRef.current) {
      return;
    }

    const frames = framesRef.current;
    if (frames.length === 0) {
      return;
    }

    // Use activeFrameLength to determine initial target frames
    const activeLength = activeFrameLengthRef.current || 1;
    const currentFrame = currentFrameIndexRef.current;
    const targetFrames = calculateActiveFrames(currentFrame, activeLength, frames.length);

    // Create initial stroke copies for all target frames
    for (const frameIdx of targetFrames) {
      const strokeId = `${baseStroke.id}-f${frameIdx}`;
      liveFrameStrokeCopiesRef.current.set(frameIdx, {
        ...baseStroke,
        id: strokeId,
        points: [] // Will be filled immediately as points are added
      });
      liveFrameTargetIndicesRef.current.push(frameIdx);
    }

    console.log('[Play & Paint] Starting real-time stroke on', targetFrames.length, 'frames:', targetFrames);
  }, [calculateActiveFrames]);

  // Update target frame when frame changes during playback
  const updateLiveFrameTarget = useCallback((newFrameIndex: number) => {
    if (!frameModeRef.current || !isPlayingFramesRef.current) {
      return;
    }

    const stroke = liveStrokeRef.current;
    if (!stroke) {
      return; // No active stroke, nothing to update
    }

    const frames = framesRef.current;
    if (frames.length === 0 || newFrameIndex >= frames.length) {
      return;
    }

    // Check if we're already on this frame
    if (currentFrameIndexRef.current === newFrameIndex) {
      return;
    }

    console.log('[Play & Paint] Frame changed during stroke - updating target frames');

    // SEAMLESS CONTINUATION: Update the current frame index immediately
    currentFrameIndexRef.current = newFrameIndex;

    // Calculate new target frames based on activeFrameLength
    const activeLength = activeFrameLengthRef.current || 1;
    const targetFrames = calculateActiveFrames(newFrameIndex, activeLength, frames.length);

    // Add new frames that aren't already targeted
    for (const frameIdx of targetFrames) {
      if (!liveFrameStrokeCopiesRef.current.has(frameIdx)) {
        // Create new stroke copy for this frame
        liveFrameStrokeCopiesRef.current.set(frameIdx, {
          ...stroke,
          id: `${stroke.id}-f${frameIdx}`,
          points: [] // Will be filled by next points added
        });
        liveFrameTargetIndicesRef.current.push(frameIdx);
        console.log('[Play & Paint] Added frame', frameIdx, 'to active painting set');
      }
    }

    // Don't reset targets or progress - allow seamless continuation
  }, [calculateActiveFrames]);

  /**
   * Sync live frame copies IMMEDIATELY with new points
   * This is called as points are generated for real-time updates
   */
  // PLAY & PAINT SYSTEM: Real-time stamping during playback - INSTANT MODE
  const syncLiveFrameCopiesImmediate = useCallback((newPoints: StrokePoint[]) => {
    // Only run during play & paint mode
    if (!frameModeRef.current || !isPlayingFramesRef.current) {
      return;
    }

    const stroke = liveStrokeRef.current;
    if (!stroke) {
      return;
    }

    // INSTANT MODE: Only stamp to CURRENT visible frame
    const currentFrameIdx = currentFrameIndexRef.current;
    const frame = framesRef.current[currentFrameIdx];

    if (!frame) {
      return;
    }

    console.log('[Play & Paint INSTANT] Stamping', newPoints.length, 'points to frame', currentFrameIdx);

    // Get or create stroke copy for this frame
    let strokeCopy = liveFrameStrokeCopiesRef.current.get(currentFrameIdx);
    if (!strokeCopy) {
      strokeCopy = {
        ...stroke,
        id: `${stroke.id}-f${currentFrameIdx}`,
        points: []
      };
      liveFrameStrokeCopiesRef.current.set(currentFrameIdx, strokeCopy);

      // Add new stroke to frame immediately
      frame.strokes.push(strokeCopy);
    }

    // Append new points DIRECTLY to frame's stroke
    for (const p of newPoints) {
      strokeCopy.points.push({ ...p });
    }

    // Clear cache so frame reloads with new stamps
    frameCacheRef.current.delete(frame.id);

    // Mark that frames need to be persisted when playback stops
    pendingFrameSyncRef.current = true;

    // NO DISPATCH - just let the playback loop handle updates
    // Stamps will appear when frame refreshes naturally during playback
  }, []);

  const syncLiveFrameCopies = useCallback(() => {
    if (!frameModeRef.current || !isPlayingFramesRef.current) {
      return;
    }
    const stroke = liveStrokeRef.current;
    if (!stroke || stroke.points.length === 0) {
      return;
    }
    const targets = liveFrameTargetIndicesRef.current;
    if (targets.length === 0) {
      return;
    }

    const sourcePoints = liveOutputPointsRef.current;
    if (!sourcePoints || sourcePoints.length === 0) {
      return;
    }

    setFrames(prevFrames => {
      if (prevFrames.length === 0) {
        return prevFrames;
      }

      const workingFrames = isPlayingFramesRef.current ? prevFrames : [...prevFrames];

      for (const frameIdx of targets) {
        const frame = workingFrames[frameIdx];
        if (!frame) {
          continue;
        }

        const copies = liveFrameStrokeCopiesRef.current;
        const strokeCopy = copies.get(frameIdx);
        if (!strokeCopy) {
          continue;
        }

        const applied = liveFrameAppliedPointsRef.current.get(frameIdx) ?? 0;
        if (sourcePoints.length <= applied) {
          continue;
        }

        const newPoints = sourcePoints.slice(applied).map(point => ({ ...point }));
        strokeCopy.points = strokeCopy.points.concat(newPoints);
        liveFrameAppliedPointsRef.current.set(frameIdx, sourcePoints.length);

        const strokesArray = isPlayingFramesRef.current ? frame.strokes : [...frame.strokes];
        const existingIndex = strokesArray.findIndex(s => s.id === strokeCopy.id);
        if (existingIndex !== -1) {
          strokesArray[existingIndex] = strokeCopy;
        } else {
          strokesArray.push(strokeCopy);
        }

        if (isPlayingFramesRef.current) {
          frame.strokes = strokesArray;
        } else {
          workingFrames[frameIdx] = {
            ...frame,
            strokes: strokesArray
          };
        }

        frameCacheRef.current.delete(frame.id);
      }

      framesRef.current = workingFrames;
      pendingFrameSyncRef.current = isPlayingFramesRef.current;
      return isPlayingFramesRef.current ? prevFrames : workingFrames;
    });
  }, [setFrames]);

  useEffect(() => {
    if (!isPlayingFrames) {
      // Just reset tracking when playback stops - frames are already materialized by the other useEffect
      resetLiveFrameStampTracking();
    }
  }, [isPlayingFrames, resetLiveFrameStampTracking]);

  useEffect(() => {
    if (!frameMode) {
      resetLiveFrameStampTracking();
      hideDeleteAllPrompt();
    }
  }, [frameMode, hideDeleteAllPrompt, resetLiveFrameStampTracking]);

  useEffect(() => {
    return () => {
      hideDeleteAllPrompt();
    };
  }, [hideDeleteAllPrompt]);

  // Update playback state ref without triggering re-renders
  useEffect(() => {
    playbackStateRef.current = {
      brushEmoji,
      brushSize,
      brushOpacity,
      brushSpacing,
      brushRotation,
      mirrorX,
      mirrorY,
      recentEmojis,
      trace
    };
  }, [brushEmoji, brushSize, brushOpacity, brushSpacing, brushRotation, mirrorX, mirrorY, recentEmojis, trace]);

  // Animate frame button icon when multiple frames exist
  useEffect(() => {
    if (frames.length <= 1) {
      // Only animate when there are multiple frames
      setFrameButtonIcon('📽️');
      return;
    }

    // Animate 3 times per minute: schedule randomly within each 20-second interval
    const scheduleAnimation = () => {
      // Random delay within the next 20 seconds (0-20s)
      const randomDelay = Math.random() * 20000;

      const timeoutId = setTimeout(() => {
        // Animation sequence: 📽️ (3s) → 🎥 (1s) → 📽️
        setFrameButtonIcon('📽️');

        setTimeout(() => {
          setFrameButtonIcon('🎥');

          setTimeout(() => {
            setFrameButtonIcon('📽️');
            // Schedule next animation
            scheduleAnimation();
          }, 1000); // Show 🎥 for 1s
        }, 3000); // Show 📽️ for 3s before switching
      }, randomDelay);

      return timeoutId;
    };

    const timeoutId = scheduleAnimation();

    return () => {
      clearTimeout(timeoutId);
    };
  }, [frames.length]);

  // Cleanup interval and animation on component unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (playFramesIntervalRef.current) {
        clearInterval(playFramesIntervalRef.current);
        playFramesIntervalRef.current = null;
      }
      if (playFramesAnimationRef.current) {
        cancelAnimationFrame(playFramesAnimationRef.current);
        playFramesAnimationRef.current = null;
      }
      // Clear cache on unmount
      frameCacheRef.current.clear();
    };
  }, []);

  // Animation export state
  const [animationExportVisible, setAnimationExportVisible] = useState(false);
  const [exportFormat, setExportFormat] = useState<'mov' | 'gif' | 'png'>('mov');
  const [exportFps, setExportFps] = useState(12);
  const [activeFrameLength, setActiveFrameLength] = useState(1); // Number of frames to paint on simultaneously (1-5)
  const [exportTransparent, setExportTransparent] = useState(true);
  const [exportLoopMode, setExportLoopMode] = useState<'normal' | 'pingpong' | 'reverse'>('normal');
  const [exportPreviewPlaying, setExportPreviewPlaying] = useState(true);
  const [exportPreviewFrameIndex, setExportPreviewFrameIndex] = useState(0);
  const exportPreviewIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [animationExportActive, setAnimationExportActive] = useState(false);
  const [animationExportProgress, setAnimationExportProgress] = useState<{ current: number; total: number } | null>(null);
  // Latest export progress, written by the (bursty) native progress events and
  // by the JS fallback loop; a 50ms sampler flushes it to state so the bar can't
  // be starved by React batching a flood of fast events.
  const animationExportProgressRef = useRef<{ current: number; total: number } | null>(null);
  // Guards against a second export starting while one is in flight (two runs
  // would write the same frame_*.png paths + fight over progress = 1→4% loop).
  const animationExportInProgressRef = useRef(false);

  // Frame history for undo/redo in frame mode
  const [frameHistory, setFrameHistory] = useState<AnimationFrame[][]>([]);
  const [frameHistoryIndex, setFrameHistoryIndex] = useState(-1);

  // Resume modal state
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [resumeAutosaveData, setResumeAutosaveData] = useState<any | null>(null);
  const [resumeLogoSet, setResumeLogoSet] = useState<LogoSet | null>(null);
  const [resumeLogoFrameIndex, setResumeLogoFrameIndex] = useState(0);
  const [skipResumeModalOnce, setSkipResumeModalOnce] = useState(false); // Flag to skip resume modal after explicit project load
  const resumeModalBgAnim = useRef(new RNAnimated.Value(0)).current;
  const resumeModalPanelAnim = useRef(new RNAnimated.Value(0)).current;
  const resumeModalButton1Anim = useRef(new RNAnimated.Value(0)).current;
  const resumeModalButton2Anim = useRef(new RNAnimated.Value(0)).current;

  // Gallery viewer modal animations
  const galleryViewerModalScale = useRef(new RNAnimated.Value(0.3)).current;
  const galleryViewerModalOpacity = useRef(new RNAnimated.Value(0)).current;

  const [privateStudioLeaderboardVisible, setPrivateStudioLeaderboardVisible] = useState(false);
  const [privateStudioTipVisible, setPrivateStudioTipVisible] = useState(false);
  const [privateStudioTipText, setPrivateStudioTipText] = useState('');
  const privateStudioTipScale = useRef(new RNAnimated.Value(0)).current;
const privateStudioTipOpacity = useRef(new RNAnimated.Value(0)).current;
const privateStudioTipBurstProgress = useRef(new RNAnimated.Value(0)).current;
const privateStudioTipIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
const privateStudioTipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const privateStudioTipAnimatedStyle = useMemo(
  () => ({
    opacity: privateStudioTipOpacity,
    transform: [{ scale: privateStudioTipScale }]
  }),
  [privateStudioTipOpacity, privateStudioTipScale]
);

  // Passport snapshot animation state
  const [passportSnapshotsAnimationActive, setPassportSnapshotsAnimationActive] = useState(false);
  const [passportSnapshotsFrames, setPassportSnapshotsFrames] = useState<string[]>([]);
  const [passportSnapshotsCurrentFrame, setPassportSnapshotsCurrentFrame] = useState(0);
  const passportSnapshotsOpacity = useRef(new RNAnimated.Value(0)).current;
  const [currentPassportImage, setCurrentPassportImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PRIVATE_STUDIO_RANDOM_LOCK_KEY)
      .then((value) => {
        if (!cancelled) {
          setPrivateStudioRandomLocked(value === '1');
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (privateStudioRandomLocked) {
      privateStudioRandomUsedRef.current = false;
    }
  }, [privateStudioRandomLocked]);

  const clearPrivateStudioTypewriter = useCallback(() => {
    privateStudioTypewriterTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    privateStudioTypewriterTimeoutsRef.current.clear();
    privateStudioTypewriterActiveRef.current = false;
  }, []);

  const runPrivateStudioTypewriter = useCallback(
    (value: string, onComplete?: () => void) => {
      clearPrivateStudioTypewriter();
      const target = value.slice(0, PRIVATE_STUDIO_NAME_MAX);
      if (target.length === 0) {
        setPrivateStudioName('');
        if (onComplete) {
          onComplete();
        }
        return;
      }
      privateStudioTypewriterActiveRef.current = true;
      let index = 1;
      setPrivateStudioName(target.slice(0, index));
      const scheduleNext = () => {
        const delay = 28 + Math.random() * 52;
        const timeout = setTimeout(() => {
          privateStudioTypewriterTimeoutsRef.current.delete(timeout);
          index += 1;
          setPrivateStudioName(target.slice(0, index));
          if (index < target.length) {
            scheduleNext();
          } else {
            privateStudioTypewriterActiveRef.current = false;
            if (onComplete) {
              onComplete();
            }
          }
        }, delay);
        privateStudioTypewriterTimeoutsRef.current.add(timeout);
      };
      if (target.length > 1) {
        scheduleNext();
      } else {
        privateStudioTypewriterActiveRef.current = false;
        if (onComplete) {
          onComplete();
        }
      }
    },
    [clearPrivateStudioTypewriter]
  );

  const triggerPrivateStudioDiceBounce = useCallback((amplitude = 0.18) => {
    privateStudioDiceScale.stopAnimation(() => {
      privateStudioDiceScale.setValue(1);
      RNAnimated.sequence([
        RNAnimated.timing(privateStudioDiceScale, {
          toValue: 1 + amplitude,
          duration: 160,
          easing: RNEasing.out(RNEasing.ease),
          useNativeDriver: true
        }),
        RNAnimated.spring(privateStudioDiceScale, {
          toValue: 1,
          damping: 14,
          stiffness: 220,
          useNativeDriver: true
        })
      ]).start();
    });
  }, [privateStudioDiceScale]);

  const triggerPrivateStudioCanvasFlight = useCallback(() => {
    if (!privateStudioVisible) {
      return;
    }
    const vector = {
      midX: (Math.random() - 0.5) * 160,
      midY: -80 - Math.random() * 90,
      endX: (Math.random() - 0.5) * 220,
      endY: -220 - Math.random() * 140,
      midScale: 1 + Math.random() * 0.25,
      endScale: 0.32 + Math.random() * 0.18,
      endRotate: (Math.random() - 0.5) * 0.75
    };
    setPrivateStudioFlightVector(vector);
    if (privateStudioCanvasFlightTimeoutRef.current) {
      clearTimeout(privateStudioCanvasFlightTimeoutRef.current);
      privateStudioCanvasFlightTimeoutRef.current = null;
    }
    privateStudioCanvasFlight.stopAnimation(() => {
      privateStudioCanvasFlight.setValue(0);
      RNAnimated.sequence([
        RNAnimated.timing(privateStudioCanvasFlight, {
          toValue: 0.6,
          duration: 220,
          easing: RNEasing.out(RNEasing.cubic),
          useNativeDriver: true
        }),
        RNAnimated.timing(privateStudioCanvasFlight, {
          toValue: 1,
          duration: 320,
          easing: RNEasing.inOut(RNEasing.cubic),
          useNativeDriver: true
        })
      ]).start(() => {
        privateStudioCanvasFlightTimeoutRef.current = setTimeout(() => {
          privateStudioCanvasFlight.setValue(0);
          privateStudioCanvasFlightTimeoutRef.current = null;
        }, 220);
      });
    });
  }, [privateStudioCanvasFlight, privateStudioVisible]);
  const privateStudioTipBurstAnimatedStyle = useMemo(
    () => ({
      opacity: privateStudioTipBurstProgress.interpolate({
        inputRange: [0, 0.3, 0.7, 1],
        outputRange: [0, 0.6, 0.25, 0]
      }),
      transform: [
        {
          scale: privateStudioTipBurstProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.6, 1.85]
          })
        }
      ]
    }),
    [privateStudioTipBurstProgress]
  );
const [animationModalVisible, setAnimationModalVisible] = useState(false);
const [animationEmojiIndex, setAnimationEmojiIndex] = useState(0);
const ANIMATION_EMOJIS = ['📹', '🎥', '📽️'];
// NOTE: leaderboard state/handlers are in the useLeaderboard hook (called below after
// sortGalleryEntries is declared). Use leaderboard.xxx to access them.
// (deviceId is declared earlier, right before useChallenge() — see that comment.)

  const [passportPortrait, setPassportPortrait] = useState<string | null>(null);
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryRefreshing, setGalleryRefreshing] = useState(false);
  const [galleryLoadingMore, setGalleryLoadingMore] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
const [galleryEntries, setGalleryEntries] = useState<DailyPaintGalleryEntry[]>([]);
const [galleryPage, setGalleryPage] = useState(1);
const [galleryVotePending, setGalleryVotePending] = useState<Record<number, boolean>>({});
const [gallerySelectedEntry, setGallerySelectedEntry] = useState<DailyPaintGalleryEntry | null>(null);
const [gallerySelectedPassport, setGallerySelectedPassport] = useState<DailyPaintGalleryEntry | null>(null);
const [profileOverlayEntry, setProfileOverlayEntry] = useState<DailyPaintGalleryEntry | null>(null);
const galleryModes = ['new', 'hot', 'personal', 'mystery', 'friends'] as const;
type GalleryMode = typeof galleryModes[number];
const galleryModeIcons: Record<GalleryMode, string> = { new: '🆕', hot: '🔥', personal: '👤', mystery: '🎲', friends: '👥' };
const galleryModeLabels: Record<GalleryMode, string> = {
  new: 'Newest',
  hot: 'Trending',
  personal: 'Personal',
  mystery: 'Mystery',
  friends: 'Friends'
};
type GalleryLanguageOption = { id: string; flag: string; label: string };
const galleryLanguageOptions = useMemo<GalleryLanguageOption[]>(() => {
  return TOPIC_LANGUAGES.map((code) => {
    const base = LANGUAGE_FLAG_MAP[code] ?? {
      flag: '🏳️',
      label: code.toUpperCase()
    };
    return {
      id: code,
      flag: base.flag,
      label: base.label
    };
  });
}, []);
const preferredGalleryLanguage = useMemo(() => {
  if (galleryLanguageOptions.length === 0) {
    return null;
  }
  const optionIndex = new Map<string, string>();
  galleryLanguageOptions.forEach((option) => {
    optionIndex.set(option.id.toLowerCase(), option.id);
  });
  const consider = (code?: string | null): string | null => {
    if (!code) {
      return null;
    }
    const normalized = code.toLowerCase();
    const direct = optionIndex.get(normalized);
    if (direct) {
      return direct;
    }
    const base = normalized.split(/[-_]/)[0];
    if (base) {
      const baseMatch = optionIndex.get(base);
      if (baseMatch) {
        return baseMatch;
      }
    }
    return null;
  };
  const candidates = collectDeviceLanguageCandidates();
  for (const candidate of candidates) {
    const match = consider(candidate);
    if (match) {
      return match;
    }
  }
  return null;
}, [galleryLanguageOptions]);
const galleryDefaultLanguage = useMemo(
  () =>
    preferredGalleryLanguage ??
    galleryLanguageOptions.find((option) => option.id === GALLERY_LANGUAGE_DEFAULT)?.id ??
    galleryLanguageOptions[0]?.id ??
    GALLERY_LANGUAGE_DEFAULT,
  [galleryLanguageOptions, preferredGalleryLanguage]
);
const [galleryLanguage, setGalleryLanguage] = useState(galleryDefaultLanguage);

// Auto-open gallery flag (for first 33 sessions random pick)
const [shouldAutoOpenGallery, setShouldAutoOpenGallery] = useState(false);

useEffect(() => {
  if (!galleryLanguageOptions.some((option) => option.id === galleryLanguage)) {
    setGalleryLanguage(galleryDefaultLanguage);
  }
}, [galleryDefaultLanguage, galleryLanguage, galleryLanguageOptions]);

// Gallery language stays in sync with app language (set via selectInfoLanguage).
// No longer reset on every gallery open to preserve the user's language choice.

// ── Info Panel feature ────────────────────────────────────────────────────────
const infoPanel = useInfoPanel({
  galleryEntries,
  deviceId,
  dailyPrompts,
  galleryLanguage,
  setGalleryLanguage,
  setNotificationsEnabled,
  notificationService,
  infoPulseValue,
  infoPulseTimeoutRef,
  onCloseExtras: () => {
    setChallengeConfirmPrompt(null);
    setChallengeConfirmLoading(false);
  },
});
const {
  infoVisible, setInfoVisible, infoLanguage, setInfoLanguage, selectInfoLanguage,
  infoCopy, infoLogoKey, setInfoLogoKey, infoRandomEntry, inspirationEntries, hasMovVideos, setHasMovVideos,
  infoLeaderboardFrame, infoAnimationLessonsFrame,
  videoInfoBannerVisible, setVideoInfoBannerVisible, videoInfoBannerTimerRef, animationTutorialVideoRef,
  infoLanguageScrollRef, infoLanguageLayouts, infoLanguageContainerWidth,
  promptBounceRefs, promptPulseTimeoutRef, getPromptBounce, triggerPromptBounce,
  openInfoPanel, closeInfoPanel, openAllOverSettings, closeAllOverSettings,
  openAnimationLessons, closeAnimationLessons, scrollInfoLanguageIntoView,
  stopInfoPulse, scheduleInfoPulse,
  allOverSettingsVisible, setAllOverSettingsVisible,
  animationLessonsVisible, setAnimationLessonsVisible,
  infoDateLabel,
} = infoPanel;

// Wire the real setInfoVisible into infoLateRef so useChallenge can call it
// (see infoLateRef comment near challengeLateRef for why this indirection exists).
useEffect(() => { infoLateRef.current.setInfoVisible = setInfoVisible; }, [setInfoVisible]);

// Auto-open gallery when flag is set (for first 33 sessions random pick)
useEffect(() => {
  if (shouldAutoOpenGallery && !galleryVisible) {
    console.log('[FirstTime] Auto-opening gallery (random session pick)');
    openGallery();
    setShouldAutoOpenGallery(false); // Reset flag
  }
}, [shouldAutoOpenGallery, galleryVisible, openGallery]);

const [galleryPassportEntry, setGalleryPassportEntry] = useState<DailyPaintGalleryEntry | null>(null);
const [galleryMode, setGalleryMode] = useState<GalleryMode>('new');
const galleryModeRef = useRef<GalleryMode>('new');
// Tracks mystery painting IDs we've already notified the owner about — prevents
// duplicate "someone guessed your painting" notifications across gallery refreshes.
const notifiedSolvedMysteriesRef = useRef<Set<string | number>>(new Set());
const galleryLayoutModes = ['default', 'list', 'grid'] as const;
type GalleryLayoutMode = typeof galleryLayoutModes[number];
const [galleryLayout, setGalleryLayout] = useState<GalleryLayoutMode>('default');
const [galleryUpdatedAt, setGalleryUpdatedAt] = useState<string | null>(null);
const [galleryLanguagePickerVisible, setGalleryLanguagePickerVisible] = useState(false);
const [galleryModePickerVisible, setGalleryModePickerVisible] = useState(false);

// ── Parental Controls ──────────────────────────────────────────────────────
const [parentalControls, setParentalControls] = useState<ParentalControlsSettings>(DEFAULT_PARENTAL_SETTINGS);
const [parentalControlsVisible, setParentalControlsVisible] = useState(false);
const [pinLockVisible, setPinLockVisible] = useState(false);
const [pinLockValue, setPinLockValue] = useState('');
const [pinLockError, setPinLockError] = useState('');
const pinLockCallbackRef = useRef<(() => Promise<void>) | null>(null);
const [offlineGalleryEntries, setOfflineGalleryEntries] = useState<DailyPaintGalleryEntry[]>([]);
const [offlineEntryCount, setOfflineEntryCount] = useState(0);
const [offlineMysteryEntries, setOfflineMysteryEntries] = useState<DailyPaintGalleryEntry[]>([]);
const [showOfflineMysteryGallery, setShowOfflineMysteryGallery] = useState(false);
const mysteryButtonBlinkOpacity = useRef(new RNAnimated.Value(1)).current;
const mysteryButtonBlinkScale = useRef(new RNAnimated.Value(1)).current;
const offlineMysteryAutoLoadRef = useRef(false);
const usageSessionStartRef = useRef<number | null>(null);
const [timeLimitWarningVisible, setTimeLimitWarningVisible] = useState(false);
const [galleryAnimatedFrames, setGalleryAnimatedFrames] = useState<Record<number, number>>({});
const galleryImageLastTapRef = useRef<{ id: number | null; timestamp: number }>({ id: null, timestamp: 0 });
const passportImageLastTapRef = useRef<number>(0);
const activeLanguageOption = useMemo(() => {
  const fallback = galleryLanguageOptions[0];
  return galleryLanguageOptions.find((option) => option.id === galleryLanguage) ?? fallback ?? { id: galleryLanguage, flag: '🏳️', label: galleryLanguage.toUpperCase() };
}, [galleryLanguage, galleryLanguageOptions]);
const sortGalleryEntries = useCallback(
  (entries: DailyPaintGalleryEntry[], modeOverride?: GalleryMode): DailyPaintGalleryEntry[] => {
    if (entries.length <= 1) {
      return entries.slice();
    }
    const mode = modeOverride ?? galleryModeRef.current;
    console.log(`[sortGalleryEntries] Sorting ${entries.length} entries with mode: ${mode}`);
    const resolveTimestamp = (entry: DailyPaintGalleryEntry): number => {
      const isoSource = entry.updatedAt ?? entry.uploadedAt ?? null;
      if (isoSource) {
        const parsed = Date.parse(isoSource);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
      if (typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)) {
        return entry.createdAt;
      }
      return 0;
    };
    const resolveScore = (entry: DailyPaintGalleryEntry): number => {
      const up = typeof entry.upvotes === 'number' ? entry.upvotes : 0;
      const down = typeof entry.downvotes === 'number' ? entry.downvotes : 0;
      return up - down;
    };
    const resolveUpvotes = (entry: DailyPaintGalleryEntry): number =>
      typeof entry.upvotes === 'number' ? entry.upvotes : 0;
    const sorted = [...entries];
    // For 'hot' (Trending) mode: sort by votes (highest to lowest)
    if (mode === 'mystery' || mode === 'friends') {
      console.log(`[sortGalleryEntries] Using NEWEST sort for mode="${mode}" (newest to oldest)`);
      sorted.sort((a, b) => {
        const timeDiff = resolveTimestamp(b) - resolveTimestamp(a);
        if (timeDiff !== 0) return timeDiff;
        return b.id - a.id;
      });
      return sorted;
    }
    if (mode === 'hot') {
      console.log('[sortGalleryEntries] Using TRENDING sort (by votes)');
      sorted.sort((a, b) => {
        const scoreDiff = resolveScore(b) - resolveScore(a);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        const upvoteDiff = resolveUpvotes(b) - resolveUpvotes(a);
        if (upvoteDiff !== 0) {
          return upvoteDiff;
        }
        const timeDiff = resolveTimestamp(b) - resolveTimestamp(a);
        if (timeDiff !== 0) {
          return timeDiff;
        }
        return b.id - a.id;
      });
      console.log('[sortGalleryEntries] After sort, first 5 scores:', sorted.slice(0, 5).map(e => ({ id: e.id, score: resolveScore(e), upvotes: e.upvotes, downvotes: e.downvotes })));
      return sorted;
    }
    console.log('[sortGalleryEntries] Using NEWEST sort (by timestamp)');
    sorted.sort((a, b) => {
      const timeDiff = resolveTimestamp(b) - resolveTimestamp(a);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      const upvoteDiff = resolveUpvotes(b) - resolveUpvotes(a);
      if (upvoteDiff !== 0) {
        return upvoteDiff;
      }
      return b.id - a.id;
    });
    return sorted;
  },
  []
);
// ---------------------------------------------------------------------------
// Leaderboard feature — hook call (after sortGalleryEntries + setGalleryEntries are ready)
// ---------------------------------------------------------------------------
const leaderboard = useLeaderboard({
  deviceId,
  navigation,
  insets,
  infoVisible,
  setInfoVisible,
  setGalleryEntries,
  sortGalleryEntries: (entries) => sortGalleryEntries(entries),
  setPrivateStudioLeaderboardVisible,
  consumeReturnToProfile,
});
// Destructure commonly used values so existing call-sites in PaintScreen still work
const {
  openLeaderboard,
  closeLeaderboard,
  refreshLeaderboard,
  openProfileLeaderboard,
  closeProfileLeaderboard,
  clearLeaderboardCache,
  closePrivateStudioLeaderboardOverlay,
  leaderboardEntries,
  leaderboardEntriesRef,
  mergeGalleryWithLeaderboard,
  privateStudioTopEntries,
  ownLeaderboardEntryIdSet,
} = leaderboard;

// Wire the real openLeaderboard into infoLateRef so useChallenge can call it
// (see infoLateRef comment near challengeLateRef for why this indirection exists).
useEffect(() => { infoLateRef.current.openLeaderboard = openLeaderboard; }, [openLeaderboard]);

// Offline mode flag — show local gallery instead of live gallery
const isOfflineGalleryMode = parentalControls.offlineMode;
const activeGalleryEntries = isOfflineGalleryMode
  ? (showOfflineMysteryGallery && galleryMode === 'mystery' ? offlineMysteryEntries : offlineGalleryEntries)
  : galleryEntries;

const galleryPageCount = useMemo(
  () => Math.max(1, Math.ceil(Math.max(activeGalleryEntries.length, 0) / GALLERY_PAGE_SIZE)),
  [activeGalleryEntries.length]
);

// Adapt OfflineGalleryEntry → DailyPaintGalleryEntry for gallery rendering
const adaptOfflineEntries = useCallback(
  (entries: OfflineGalleryEntry[]): DailyPaintGalleryEntry[] =>
    entries.map((e) => ({
      id: -(e.id + 100000), // negative to avoid server ID clash
      imageUrl: e.imageUri,
      rawUrl: e.imageUri,
      topic: e.topic,
      createdAt: e.createdAt,
      durationSec: e.durationSec ?? undefined,
      isMysteryPaint: e.isMysteryPaint === 1,
      mysteryTopicText: e.mysteryTopicText ?? undefined,
      mysteryTopicId: 0,
      passportName: null,
      passportPortrait: null,
      deviceId: null,
      rank: null,
      coins: null,
      upvotes: 0,
      downvotes: 0,
    })),
  []
);

const loadOfflineGallery = useCallback(async () => {
  const raw = await getOfflineEntries();
  const cnt = raw.length;
  setOfflineEntryCount(cnt);
  setOfflineGalleryEntries(adaptOfflineEntries(raw));
}, [adaptOfflineEntries]);

const loadOfflineMysteryCache = useCallback(async () => {
  const [newCached, mysteryCached] = await Promise.all([
    getCachedGalleryForOffline('new'),
    getCachedGalleryForOffline('mystery'),
  ]);
  const allCached = [...newCached, ...mysteryCached];
  const seen = new Set<number>();
  const mysteryOnly = allCached.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return e.isMysteryPaint === true;
  });
  const adapted = mysteryOnly.map((e) => ({
    id: e.id, imageUrl: e.imageUrl, rawUrl: e.rawUrl, topic: e.topic,
    createdAt: e.createdAt, challengeAt: e.challengeAt, durationSec: e.durationSec,
    width: e.width, height: e.height, deviceId: e.deviceId,
    passportName: e.passportName, passportPortrait: e.passportPortrait,
    frameUrls: e.frameUrls, frameCount: e.frameCount, coinCount: e.coinCount,
    coins: e.coins, rank: e.rank, uploadedAt: e.uploadedAt, updatedAt: e.updatedAt,
    upvotes: e.upvotes, downvotes: e.downvotes, isMysteryPaint: true as const,
    mysteryPaintingId: e.mysteryPaintingId, mysteryTopicText: e.mysteryTopicText,
    isSolved: e.isSolved === true, solverName: e.solverName,
    solveCount: e.solveCount, totalAttempts: e.totalAttempts,
  } as DailyPaintGalleryEntry));
  setOfflineMysteryEntries(adapted);
  setShowOfflineMysteryGallery(true);
  if (galleryModeRef.current !== 'mystery') {
    setGalleryMode('mystery');
    galleryModeRef.current = 'mystery';
  }
  return adapted.length;
}, []);

// Auto-load mystery cache with blink animation when offline + gallery opens with 0 local paintings
useEffect(() => {
  if (!isOfflineGalleryMode || !galleryVisible) return;
  if (offlineEntryCount !== 0) return;
  if (offlineMysteryAutoLoadRef.current) return;
  offlineMysteryAutoLoadRef.current = true;

  // Blink animation then auto-load
  let cancelled = false;
  const blink = RNAnimated.loop(
    RNAnimated.sequence([
      RNAnimated.timing(mysteryButtonBlinkOpacity, { toValue: 0.2, duration: 300, useNativeDriver: true }),
      RNAnimated.timing(mysteryButtonBlinkOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]),
    { iterations: 4 }
  );
  const pulse = RNAnimated.loop(
    RNAnimated.sequence([
      RNAnimated.timing(mysteryButtonBlinkScale, { toValue: 1.07, duration: 300, useNativeDriver: true }),
      RNAnimated.timing(mysteryButtonBlinkScale, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]),
    { iterations: 4 }
  );
  blink.start();
  pulse.start();
  const timer = setTimeout(() => {
    if (!cancelled) {
      blink.stop();
      pulse.stop();
      mysteryButtonBlinkOpacity.setValue(1);
      mysteryButtonBlinkScale.setValue(1);
      void loadOfflineMysteryCache();
    }
  }, 2500);
  return () => {
    cancelled = true;
    clearTimeout(timer);
    blink.stop();
    pulse.stop();
    mysteryButtonBlinkOpacity.setValue(1);
    mysteryButtonBlinkScale.setValue(1);
  };
}, [isOfflineGalleryMode, galleryVisible, offlineEntryCount, loadOfflineMysteryCache, mysteryButtonBlinkOpacity, mysteryButtonBlinkScale]);

useEffect(() => {
  if (!galleryVisible) {
    offlineMysteryAutoLoadRef.current = false;
  }
}, [galleryVisible]);

useEffect(() => {
  setGalleryPage((prev) => {
    const clamped = Math.min(Math.max(1, prev), galleryPageCount);
    return clamped === prev ? prev : clamped;
  });
}, [galleryPageCount]);

useEffect(() => {
  setGalleryPage(1);
}, [galleryMode]);

const currentGalleryPage = useMemo(
  () => Math.min(Math.max(1, galleryPage), galleryPageCount),
  [galleryPage, galleryPageCount]
);

const visibleGalleryEntries = useMemo(() => {
  if (activeGalleryEntries.length === 0) {
    return [];
  }
  const start = (currentGalleryPage - 1) * GALLERY_PAGE_SIZE;
  return activeGalleryEntries.slice(start, start + GALLERY_PAGE_SIZE);
}, [currentGalleryPage, activeGalleryEntries]);

const galleryStatsText = useMemo(() => {
  const countLabel = `${galleryEntries.length.toLocaleString()} ${galleryEntries.length === 1 ? 'upload' : 'uploads'}`;
  const modeLabel =
    galleryMode === 'hot' ? 'Trending uploads' :
    galleryMode === 'mystery' ? 'Mystery posts' :
    galleryMode === 'friends' ? 'Friends uploads' :
    'Newest uploads';
  return `${modeLabel} • Page ${currentGalleryPage}/${galleryPageCount} • ${countLabel}`;
}, [currentGalleryPage, galleryEntries.length, galleryMode, galleryPageCount]);

type GallerySection = SectionListData<DailyPaintGalleryEntry> & {
  key: string;
  subtitle: string | null;
};

const gallerySections = useMemo<GallerySection[]>(() => {
  if (visibleGalleryEntries.length === 0) {
    return [];
  }
  const map = new Map<string, DailyPaintGalleryEntry[]>();
  visibleGalleryEntries.forEach((entry) => {
    const timestamp = entry.challengeAt ?? entry.createdAt ?? null;
    const date =
      timestamp != null && Number.isFinite(timestamp)
        ? new Date(toEpochMs(timestamp)).toISOString().slice(0, 10)
        : 'unknown';
    const bucket = map.get(date);
    if (bucket) {
      bucket.push(entry);
    } else {
      map.set(date, [entry]);
    }
  });
  const sections: GallerySection[] = Array.from(map.entries())
    .map(([date, entries]) => {
      const parsed = date !== 'unknown' ? new Date(date) : null;
      if (parsed) {
        const weekdayLabel = parsed.toLocaleDateString(undefined, { weekday: 'long' });
        const dateLabel = parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
        return { key: date, title: weekdayLabel, subtitle: dateLabel, data: entries };
      }
      return {
        key: date,
        title: 'Unknown date',
        subtitle: 'Entries without a timestamp',
        data: entries
      };
    })
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  return sections;
}, [visibleGalleryEntries]);

// Stable extraData reference — prevents SectionList from re-rendering all items on every parent render.
// Only changes when the specific fields that affect cell appearance actually change.
const galleryExtraData = useMemo(() => ({
  galleryVotePending,
  galleryLanguage,
  galleryPage,
  galleryMode,
  galleryLayout,
  guessedPaintings,
  guessAttempts,
}), [galleryVotePending, galleryLanguage, galleryPage, galleryMode, galleryLayout, guessedPaintings, guessAttempts]);

// All entries for the current page — no gating. Used to gate a "reveal next card only once
// the previous card's image/video finished loading" chain that reset to 3 on every layout
// switch (visible as a full-looking reload every time) and could stall permanently at ~4 items
// if any one card's load hung — SmartVideoCard in particular shares a global 3-concurrent load
// queue, so a queued video could block the whole chain indefinitely. The page's entries are
// already loaded in memory; just show all of them.
const revealedGalleryEntries = visibleGalleryEntries;

const galleryPagination = useMemo(() => {
  if (galleryPageCount <= 1) {
    return null;
  }
  return (
    <View style={styles.galleryPagination}>
      {Array.from({ length: galleryPageCount }).map((_, index) => {
        const pageNumber = index + 1;
        const active = pageNumber === currentGalleryPage;
        const handlePress = () => {
          if (active) {
            return;
          }
          void Haptics.selectionAsync();
          setGalleryPage(pageNumber);
        };
        return (
          <TouchableOpacity
            key={`gallery-page-${pageNumber}`}
            style={[styles.galleryPaginationButton, active && styles.galleryPaginationButtonActive]}
            onPress={handlePress}
            disabled={active}
            accessibilityRole="button"
            accessibilityLabel={`Show gallery page ${pageNumber}`}
          >
            <Text
              style={[styles.galleryPaginationLabel, active && styles.galleryPaginationLabelActive]}
            >
              {pageNumber}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}, [currentGalleryPage, galleryPageCount]);

  useEffect(() => {
    galleryModeRef.current = galleryMode;
  }, [galleryMode]);
  const [totalTimeMs, setTotalTimeMs] = useState(0);
  const [totalStrokes, setTotalStrokes] = useState(0);
  // activeChallenge + setActiveChallenge — moved to useChallenge hook (destructured above)

  const takePaintingSnapshot = useCallback((): StoredPaintingState => ({
    ...snapshotPaintingState({
      strokes,
      brushEmoji,
      brushSize,
      brushOpacity,
      brushSpacing,
      brushRotation,
      recentEmojis,
      trace,
      // 3-layer system: per-stroke assignment already rides on each Stroke; these are the
      // editor-level bits (which layer is active, which layers are hidden).
      activeLayer,
      layerVisibility
    }),
    // Include frame-by-frame animation data if in frame mode
    frameMode,
    frames: frameMode ? frames.map(f => ({
      id: f.id,
      strokes: cloneStrokes(f.strokes),
      timestamp: f.timestamp,
      thumbnail: f.thumbnail
    })) : undefined,
    currentFrameIndex: frameMode ? currentFrameIndex : undefined,
    exportFps: frameMode ? exportFps : undefined
  }), [activeLayer, brushEmoji, brushOpacity, brushRotation, brushSize, brushSpacing, layerVisibility, recentEmojis, strokes, trace, frameMode, frames, currentFrameIndex, exportFps]);

  const restorePaintingState = useCallback((state: StoredPaintingState | null) => {
    if (!state) {
      dispatch({ type: 'RESET' });
      void setSnapshotProjectId(DEFAULT_SNAPSHOT_PROJECT_ID);
      previousStrokeCountRef.current = 0;
      setFrameMode(false);
      setFrames([]);
      setCurrentFrameIndex(0);
      return;
    }
    previousStrokeCountRef.current = state.strokes.length;
    dispatch({
      type: 'LOAD_STATE',
      payload: {
        strokes: cloneStrokes(state.strokes),
        brushEmoji: state.brushEmoji,
        brushSize: state.brushSize,
        brushOpacity: state.brushOpacity,
        brushSpacing: state.brushSpacing,
        brushRotation: state.brushRotation ?? 0,
        recentEmojis: state.recentEmojis,
        trace: cloneTraceState(state.trace),
        // 3-layer system — passed EXPLICITLY (with defaults) because this is a real artwork switch:
        // a painting saved before layers existed carries neither key and must reopen as
        // "default layer, all layers visible", rendering exactly as it always did.
        activeLayer: state.activeLayer ?? DEFAULT_PAINT_LAYER,
        layerVisibility: state.layerVisibility ?? DEFAULT_LAYER_VISIBILITY
      }
    });

    // Restore frame-by-frame animation state if present
    // Check for either frameMode OR isAnimation (saved projects use isAnimation: true)
    const frames = state.frames && Array.isArray(state.frames) ? state.frames : [];
    const hasFrameData = (state.frameMode || (state as any).isAnimation) && frames.length > 0;
    if (hasFrameData) {
      console.log('[PaintScreen] Restoring animation with', frames.length, 'frames (frameMode:', state.frameMode, 'isAnimation:', (state as any).isAnimation, ')');

      // Restore frames and keep frame mode active
      const restoredFrames = frames.map(f => ({
        id: f.id,
        strokes: cloneStrokes(f.strokes),
        timestamp: f.timestamp,
        thumbnail: f.thumbnail
      }));
      setFrames(restoredFrames);
      framesRef.current = restoredFrames; // Update ref immediately
      setCurrentFrameIndex(state.currentFrameIndex ?? 0);
      currentFrameIndexRef.current = state.currentFrameIndex ?? 0; // Update ref immediately
      if (state.exportFps || (state as any).fps) {
        setExportFps(state.exportFps || (state as any).fps);
      }

      // Keep frame mode active if frames exist
      setFrameMode(true);
      frameModeRef.current = true; // Update ref immediately

      // Clear frame cache to force reload
      frameCacheRef.current.clear();

      // Initialize frame history with current state
      setFrameHistory([frames.map(f => ({ ...f, strokes: cloneStrokes(f.strokes) }))]);
      setFrameHistoryIndex(0);

      // Load the current frame's strokes to the visible canvas
      const currentIdx = state.currentFrameIndex ?? 0;
      const currentFrame = frames[currentIdx];
      if (currentFrame) {
        dispatch({
          type: 'LOAD_STATE',
          payload: {
            strokes: cloneStrokes(currentFrame.strokes),
            brushEmoji: state.brushEmoji,
            brushSize: state.brushSize,
            brushOpacity: state.brushOpacity,
            brushSpacing: state.brushSpacing,
            brushRotation: state.brushRotation ?? 0,
            recentEmojis: state.recentEmojis,
            trace: cloneTraceState(state.trace),
            activeLayer: state.activeLayer ?? DEFAULT_PAINT_LAYER,
            layerVisibility: state.layerVisibility ?? DEFAULT_LAYER_VISIBILITY
          }
        });
      }

      console.log('[PaintScreen] ✅ Frames restored, frame mode active, current frame loaded');
    } else {
      setFrameMode(false);
      setFrames([]);
      setCurrentFrameIndex(0);
    }
  }, [dispatch, setSnapshotProjectId]);

  const persistPrivateStudioState = useCallback(async () => {
    try {
      // Take snapshot from current painting context (which contains Private Studio strokes while modal is open)
      const painting = takePaintingSnapshot();

      console.log('[Profile] 💾 Saving profile workspace with', painting.strokes.length, 'strokes');

      const payload: PrivateStudioPersistedState = {
        name: privateStudioName.trim().length > 0
          ? privateStudioName.trim().slice(0, PRIVATE_STUDIO_NAME_MAX)
          : PRIVATE_STUDIO_DEFAULT_NAME_SHORT,
        elapsedMs: privateStudioElapsedMs,
        strokeCount: painting.strokes.length,
        painting,
        updatedAt: new Date().toISOString()
      };
      await AsyncStorage.setItem(PRIVATE_STUDIO_STORAGE_KEY, JSON.stringify(payload));
      console.log('[Profile] ✅ Profile workspace saved successfully:', {
        strokeCount: painting.strokes.length,
        name: payload.name,
        elapsedMs: payload.elapsedMs
      });
      setPrivateStudioError(null);
      return payload;
    } catch (error) {
      console.error('[Profile] ❌ Profile Studio save failed:', error);
      setPrivateStudioError('Could not save Profil Studio progress.');
      throw error;
    }
  }, [privateStudioElapsedMs, privateStudioName, setPrivateStudioError, takePaintingSnapshot]);

  const schedulePrivateStudioAutosave = useCallback(() => {
    if (!privateStudioActiveRef.current) {
      return;
    }
    if (privateStudioAutosaveTimeoutRef.current) {
      clearTimeout(privateStudioAutosaveTimeoutRef.current);
    }
    privateStudioAutosaveTimeoutRef.current = setTimeout(() => {
      privateStudioAutosaveTimeoutRef.current = null;
      void persistPrivateStudioState().catch(() => undefined);
    }, PRIVATE_STUDIO_AUTOSAVE_DEBOUNCE_MS);
  }, [persistPrivateStudioState]);

  const persistGlobalStats = useCallback(async (patch: Partial<GlobalStatsSnapshot>) => {
    try {
      const next = patch.coins != null
        ? await setLifetimeCoins(patch.coins)
        : await mergeLifetimeStats(patch);
      totalStatsRef.current = next;
      scheduleStoredProfileStateSync();
    } catch (error) {
      console.warn('Failed to persist global painting stats', error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadGlobalStats = async () => {
      try {
        const raw = await AsyncStorage.getItem(GLOBAL_STATS_STORAGE_KEY);
        const stats = await getLifetimeStats();
        let coins = stats.coins;
        const hadCoinsField = raw != null && (() => {
          try {
            return typeof (JSON.parse(raw) as { coins?: unknown }).coins === 'number';
          } catch {
            return false;
          }
        })();
        if (!hadCoinsField) {
          const legacy = await AsyncStorage.getItem(COIN_STORAGE_KEY);
          if (legacy) {
            const parsedCoins = Number(legacy);
            if (Number.isFinite(parsedCoins)) {
              coins = Math.floor(parsedCoins); // Allow negative coins
            }
          }
        }
        if (cancelled) {
          return;
        }
        totalStatsRef.current = { ...stats, coins };
        setTotalTimeMs(stats.totalTimeMs);
        setTotalStrokes(stats.totalStrokes);
        setCoinCount(coins);
        if (!hadCoinsField) {
          void persistGlobalStats({ coins });
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load global painting stats', error);
        }
      }
    };
    void loadGlobalStats();
    return () => {
      cancelled = true;
    };
  }, [persistGlobalStats]);

  useEffect(() => subscribeToLifetimeStats((stats) => {
    totalStatsRef.current = stats;
    setTotalTimeMs(stats.totalTimeMs);
    setTotalStrokes(stats.totalStrokes);
    setCoinCount(stats.coins);
    scheduleStoredProfileStateSync();
  }), []);

  useEffect(() => {
    let cancelled = false;
    ensureDeviceId()
      .then(async (id) => {
        if (!cancelled) {
          const trimmed = typeof id === 'string' ? id.trim() : id;
          setDeviceId(trimmed);
          // Stamp creation date on first ever run (never overwrites existing)
          try {
            const existing = await AsyncStorage.getItem(DEVICE_CREATED_AT_KEY);
            if (!existing && trimmed) {
              await AsyncStorage.setItem(DEVICE_CREATED_AT_KEY, new Date().toISOString());
            }
          } catch { /* ignore */ }
        }
      })
      .catch((error) => {
        console.warn('Device identifier unavailable', error);
        if (!cancelled) {
          setDeviceId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await AsyncStorage.multiGet([
          PASSPORT_PORTRAIT_STORAGE_KEY,
          PASSPORT_PORTRAIT_SENT_STORAGE_KEY
        ]);
        if (cancelled) {
          return;
        }
        const cache = new Map(entries ?? []);
        const storedPortrait = cache.get(PASSPORT_PORTRAIT_STORAGE_KEY);
        if (typeof storedPortrait === 'string' && storedPortrait.trim().length > 0) {
          setPassportPortrait(storedPortrait.trim());
        }
        const lastSent = cache.get(PASSPORT_PORTRAIT_SENT_STORAGE_KEY);
        if (typeof lastSent === 'string' && lastSent.trim().length > 0) {
          lastUploadedPassportPortraitRef.current = lastSent.trim();
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load cached passport portrait', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // challengeRemainingMs — moved to useChallenge hook (destructured above)
  const [showChallengeCancelDialog, setShowChallengeCancelDialog] = useState(false);
  const [sizeInput, setSizeInput] = useState(() => String(brushSize));
  const [traceLoading, setTraceLoading] = useState(false);
  const [showTraceControls, setShowTraceControls] = useState(false);
  const [traceLoadingMessage, setTraceLoadingMessage] = useState('Loading trace…');
  const [sizeInputFocused, setSizeInputFocused] = useState(false);
  const emojiListRef = useRef<FlatList<EmojiEntry> | null>(null);
  const emojiScrollOffsetRef = useRef(0);
  const multiTouchAbortRef = useRef(false);
const diceScale = useSharedValue(1);
const galleryViewerScale = useSharedValue(1);
const galleryViewerBaseScale = useSharedValue(1);
  const settingsGearRotation = useSharedValue(0);
  const dicePulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerDiceBounceRef = useRef<(amplitude?: number) => void>(() => {});
  const emojiBounceScale = useRef(new RNAnimated.Value(1)).current;
  const brushPreviewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [brushPreviewStroke, setBrushPreviewStroke] = useState<Stroke | null>(null);

  // Auto-rotate state
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  const [autoRotateDirection, setAutoRotateDirection] = useState<'left' | 'right' | null>(null);
  const autoRotateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const simpleEmojiChoices = useMemo(
    () => renderableEmojiEntries.map((entry) => entry.emoji),
    []
  );

  // Start continuous gear rotation animation (360° in 12 seconds)
  useEffect(() => {
    settingsGearRotation.value = withRepeat(
      withTiming(2 * Math.PI, {
        duration: 12000,
        easing: ReanimatedEasing.linear
      }),
      -1, // Infinite repeat
      false // Don't reverse
    );
  }, []);

  // Auto-rotate animation loop - pauses during drawing
  useEffect(() => {
    if (autoRotateEnabled && autoRotateDirection) {
      // Rotate 360° in 6 seconds = 60° per second
      // Update every 250ms = 15° per update (less frequent to reduce crashes)
      const rotationStep = autoRotateDirection === 'left' ? -15 : 15;
      const interval = setInterval(() => {
        // Only rotate if not currently drawing
        if (!liveStrokeRef.current) {
          setBrushRotationImmediate(prev => (prev + rotationStep + 360) % 360);
        }
      }, 250);

      autoRotateIntervalRef.current = interval;
      console.log(`[BRUSH] Auto-rotate started: ${autoRotateDirection}`);

      return () => {
        clearInterval(interval);
        autoRotateIntervalRef.current = null;
        console.log('[BRUSH] Auto-rotate stopped');
      };
    } else if (autoRotateIntervalRef.current) {
      clearInterval(autoRotateIntervalRef.current);
      autoRotateIntervalRef.current = null;
    }
  }, [autoRotateEnabled, autoRotateDirection, setBrushRotationImmediate]);

  // Challenge complete + confirm state — moved to useChallenge hook (destructured above)
  // Notification state — moved to useChallenge hook (destructured above)
const canvasResponderTargetRef = useRef<number | null>(null);
const zoomDisplay = Math.max(0.0001, canvasZoomLevel);
const displayBrushSize = useMemo(() => brushSize, [brushSize]);
const displayBrushSizeMax = useMemo(
  () => (brushMode === 'smudge' ? SMUDGE_MAX_BRUSH_SIZE : BRUSH_SIZE_MAX),
  [brushMode]
);
const pendingBrushSizeChangeRef = useRef<number | null>(null);

  const getCanvasTouchCount = useCallback((nativeEvent: any): number => {
    if (!nativeEvent) {
      return 0;
    }
    const currentTarget =
      canvasResponderTargetRef.current !== null
        ? canvasResponderTargetRef.current
        : (nativeEvent.target ?? null);
    const touches = nativeEvent.touches;
    if (currentTarget && Array.isArray(touches) && touches.length > 0) {
      const count = touches.filter((touch) => touch?.target === currentTarget).length;
      if (count > 0) {
        return count;
      }
    }
    return readTouchCount(nativeEvent);
  }, []);

useEffect(() => {
  const previous = prevChallengeStrokeCountRef.current;
  prevChallengeStrokeCountRef.current = strokes.length;
  if (!activeChallenge || challengeCompletionHandledRef.current) {
    return;
  }
  if (strokes.length > previous) {
    const delta = strokes.length - previous;
    challengeStrokeCountRef.current += delta;
    setChallengeStrokeCount(challengeStrokeCountRef.current);
  }
}, [activeChallenge, strokes.length]);
const [coinCount, setCoinCount] = useState(0);
const coinScale = useRef(new RNAnimated.Value(0)).current;
const penaltyCoinScale = useRef(new RNAnimated.Value(0)).current; // For -1 coin penalty animation
const penaltyCoinY = useRef(new RNAnimated.Value(0)).current; // For downward motion
const [uploadCelebration, setUploadCelebration] = useState<UploadCelebration | null>(null);
const [retryHelperVisible, setRetryHelperVisible] = useState(false);
const retryHelperScale = useRef(new RNAnimated.Value(0)).current;
const retryHelperAnimationRef = useRef<ReturnType<typeof RNAnimated.timing> | null>(null);
const overlaySwapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerCoinBurst = useCallback(() => {
    coinScale.stopAnimation(() => {
      coinScale.setValue(0);
      RNAnimated.sequence([
        RNAnimated.timing(coinScale, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
          easing: RNEasing.out(RNEasing.ease)
        }),
        RNAnimated.timing(coinScale, {
          toValue: 0,
          duration: 260,
          delay: 300,
          useNativeDriver: true,
          easing: RNEasing.inOut(RNEasing.ease)
        })
      ]).start();
    });
  }, [coinScale]);

  const triggerPenaltyCoinAnimation = useCallback(() => {
    console.log('[Gesser] 💸 Triggering -1 coin penalty animation');
    penaltyCoinScale.stopAnimation(() => {
      penaltyCoinScale.setValue(0);
      penaltyCoinY.setValue(0);
      RNAnimated.parallel([
        // Scale animation: fade in, grow, then fade out
        RNAnimated.sequence([
          RNAnimated.timing(penaltyCoinScale, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
            easing: RNEasing.out(RNEasing.ease)
          }),
          RNAnimated.timing(penaltyCoinScale, {
            toValue: 0,
            duration: 400,
            delay: 800,
            useNativeDriver: true,
            easing: RNEasing.in(RNEasing.ease)
          })
        ]),
        // Y position: fall downward
        RNAnimated.timing(penaltyCoinY, {
          toValue: 80, // Fall 80 pixels downward
          duration: 1400,
          useNativeDriver: true,
          easing: RNEasing.out(RNEasing.quad)
        })
      ]).start();
    });
  }, [penaltyCoinScale, penaltyCoinY]);

// ── Onboarding feature ────────────────────────────────────────────────────────
// Stable ref for late-defined navigation callbacks (openGallery / openPrivateStudio /
// refreshGallery are useCallbacks declared further down; assigned via .current = after
// each is created to avoid Temporal Dead Zone errors at this early hook call site).
const onboardingLateCallbacksRef = useRef({
  openGallery: () => {},
  openPrivateStudio: () => {},
  refreshGallery: (_mode, _opts) => {},
});
const onboarding = useOnboarding({
  infoLanguage,
  setInfoLanguage,
  setInfoVisible,
  lateCallbacksRef: onboardingLateCallbacksRef,
  settings,
  setHandMode,
  galleryEntries,
  galleryError,
  galleryVisible,
  strokes,
  liveVersion,
  isLineActive: toolMode === 'line',
  setNotificationsEnabled,
  setParentalControlsVisible,
});
const {
  welcomeOverlayVisible, setWelcomeOverlayVisible,
  welcomerVideoSource, welcomeVideoRef, welcomeVideoLogo,
  welcomeHasInteracted, setWelcomeHasInteracted,
  parentalFromWelcomeRef, firstStrokeHelperVisible, firstStrokeHelperText,
  welcomeTypewriterText, pendingFirstTimeWelcomeRef, welcomeAutoOpenTimersRef,
  tutorialActive, setTutorialActive,
  tutorialCurrentLesson, setTutorialCurrentLesson,
  tutorialShowSuccess, tutorialEmojiPickerOpened, setTutorialEmojiPickerOpened,
  tutorialRandomEmojiPicked, setTutorialRandomEmojiPicked,
  tutorialTimelapseOpened, setTutorialTimelapseOpened,
  tutorialVideoLogo, tutorialVideoRef, tutorialActiveRef,
  tutorialGalleryOpenedRef, tutorialBlinkScale, tutorialBlinkOpacity,
  loadWelcomeVideoQueue, handleWelcomeVideoEnd, handleWelcomeVideoTap,
  handleWelcomeTutorial, handleWelcomeProfile, handleWelcomePaint,
  handleWelcomeGallery, handleWelcomeParentalControls,
  completeTutorialLesson, triggerLessonCompletion,
} = onboarding;

  const showRetryHelper = useCallback(() => {
    const holdMs = 3000 + Math.round(Math.random() * 2000);
    retryHelperAnimationRef.current?.stop();
    retryHelperScale.stopAnimation(() => undefined);
    retryHelperScale.setValue(0.6);
    setRetryHelperVisible(true);
    const sequence = RNAnimated.sequence([
      RNAnimated.spring(retryHelperScale, {
        toValue: 1.1,
        friction: 6,
        tension: 160,
        useNativeDriver: true
      }),
      RNAnimated.spring(retryHelperScale, {
        toValue: 1,
        friction: 7,
        tension: 140,
        useNativeDriver: true
      }),
      RNAnimated.delay(holdMs),
      RNAnimated.timing(retryHelperScale, {
        toValue: 0,
        duration: 240,
        easing: RNEasing.in(RNEasing.back(2)),
        useNativeDriver: true
      })
    ]);
    retryHelperAnimationRef.current = sequence;
    sequence.start(({ finished }) => {
      if (finished) {
        setRetryHelperVisible(false);
        retryHelperScale.setValue(0);
      }
      retryHelperAnimationRef.current = null;
    });
  }, [retryHelperScale]);
  const scheduleOverlaySwap = useCallback(
    (fn: () => void, delay = 480) => {
      if (overlaySwapTimeoutRef.current) {
        clearTimeout(overlaySwapTimeoutRef.current);
      }
      overlaySwapTimeoutRef.current = setTimeout(() => {
        overlaySwapTimeoutRef.current = null;
        InteractionManager.runAfterInteractions(fn);
      }, delay);
    },
    []
  );

  const awardCoins = useCallback((amount: number) => {
    const normalizedAmount = Math.max(0, Math.floor(amount));
    if (normalizedAmount <= 0) {
      return;
    }
    triggerCoinBurst();
    setCoinCount((current) => {
      const previousLevel = resolveCoinLevel(current);
      const next = current + normalizedAmount;
      const nextLevel = resolveCoinLevel(next);
      void persistGlobalStats({ coins: next });
      setUploadCelebration({
        coins: next,
        level: nextLevel,
        previousLevel,
        leveledUp: nextLevel.id > previousLevel.id
      });
      return next;
    });
  }, [persistGlobalStats, triggerCoinBurst]);
  // Wire awardCoins into challengeLateRef so useChallenge can call it
  useEffect(() => { challengeLateRef.current.awardCoins = awardCoins; }, [awardCoins]);

  const persistChallengeAutosave = useCallback(async () => {
    if (!activeChallenge || !challengeStartedAtRef.current) {
      return;
    }

    // Don't save autosave when in private studio or face filter mode - separate workspaces
    if (privateStudioActiveRef.current || faceFilterActiveRef.current) {
      console.log('[PaintScreen] Skipping challenge autosave - in private studio / face filter workspace');
      return;
    }

    try {
      const elapsedMs = Date.now() - challengeStartedAtRef.current;
      const painting = takePaintingSnapshot();
      const remainingMs = Math.max(0, activeChallenge.endsAt - Date.now());
      const timeRunout = remainingMs <= 0;

      await saveSprintAutosave({
        prompt: activeChallenge.prompt,
        startedAt: challengeStartedAtRef.current,
        endsAt: activeChallenge.endsAt,
        savedAt: new Date().toISOString(),
        painting,
        elapsedMs,
        strokeCount: challengeStrokeCountRef.current,
        timeRunout,
        uploaded: challengeUploadedRef.current
      });
    } catch (error) {
      console.error('[PaintScreen] Failed to persist challenge autosave:', error);
    }
  }, [activeChallenge, takePaintingSnapshot]);

  const scheduleChallengeAutosave = useCallback(() => {
    if (!activeChallenge) {
      return;
    }
    if (challengeAutosaveTimeoutRef.current) {
      clearTimeout(challengeAutosaveTimeoutRef.current);
    }
    challengeAutosaveTimeoutRef.current = setTimeout(() => {
      challengeAutosaveTimeoutRef.current = null;
      void persistChallengeAutosave();
    }, 5000); // Increased from 1600ms to 5000ms to reduce memory pressure
  }, [activeChallenge, persistChallengeAutosave]);

  // General autosave for non-challenge work (includes frame-by-frame)
  const persistGeneralAutosave = useCallback(async () => {
    // Only save when NOT in challenge mode, private studio, or face filter mode
    if (activeChallenge || privateStudioActiveRef.current || faceFilterActiveRef.current) {
      return;
    }

    try {
      const painting = takePaintingSnapshot();

      // Load framer frames from storage
      let framerFrames = null;
      try {
        const framerData = await AsyncStorage.getItem('@emojipaint_framer_project');
        if (framerData) {
          framerFrames = JSON.parse(framerData);
        }
      } catch (error) {
        console.warn('[GeneralAutosave] Failed to load framer frames:', error);
      }

      await saveGeneralAutosave({
        savedAt: new Date().toISOString(),
        painting,
        strokeCount: painting.strokes.length,
        frameMode: frameMode, // Save frame mode state
        framerFrames // Include framer frames
      });

      // Track NEW strokes for rating prompt (delta since last autosave)
      const currentStrokeCount = painting.strokes.length;
      const previousCount = lastStrokeCountRef.current ?? 0;
      const newStrokes = Math.max(0, currentStrokeCount - previousCount);
      if (newStrokes > 0) {
        await incrementStrokeCount(newStrokes);
        lastStrokeCountRef.current = currentStrokeCount;
        triggerRatingCheck();
      }
    } catch (error) {
      console.error('[PaintScreen] Failed to persist general autosave:', error);
    }
  }, [activeChallenge, takePaintingSnapshot, frameMode]);

  const scheduleGeneralAutosave = useCallback(() => {
    // Skip if in challenge mode, private studio, or face filter mode
    if (activeChallenge || privateStudioActiveRef.current || faceFilterActiveRef.current) {
      return;
    }
    if (generalAutosaveTimeoutRef.current) {
      clearTimeout(generalAutosaveTimeoutRef.current);
    }
    generalAutosaveTimeoutRef.current = setTimeout(() => {
      generalAutosaveTimeoutRef.current = null;
      void persistGeneralAutosave();
    }, 5000);
  }, [activeChallenge, persistGeneralAutosave]);



  // Listen for language selected in StartupOverlay (save is handled inside StartupOverlay itself)
  useEffect(() => {
    return addAppEventListener<string>('startup:language_selected', (lang) => {
      setInfoLanguage(lang as InfoLanguage);
    });
  }, []);

  // Forward ref: the mount-time first-time detection lives far below this
  // point, so it reaches the callback through a ref instead of a TDZ error.
  const showPendingFirstTimeWelcomeRef = useRef<(() => void) | null>(null);

  /**
   * Show the first-time Welcome overlay, once.
   *
   * MUST NOT depend on the `startup:hidden` event alone. That event is emitted
   * by the first-launch intro, and the intro now finishes BEFORE this screen is
   * mounted (the navigator is not mounted until the AGB gate is accepted), so
   * the event fires with no listener attached and the Welcome page never
   * appeared for a fresh install. Both the event and the first-time detection
   * below call this; the ref makes it idempotent.
   */
  const showPendingFirstTimeWelcome = useCallback(() => {
    if (!pendingFirstTimeWelcomeRef.current) return;
    pendingFirstTimeWelcomeRef.current = false;
    setTimeout(() => {
      loadWelcomeVideoQueue();
      setWelcomeOverlayVisible(true);
    }, 200);
  }, [loadWelcomeVideoQueue, setWelcomeOverlayVisible]);
  showPendingFirstTimeWelcomeRef.current = showPendingFirstTimeWelcome;

  // When startup splash finishes: refresh server topics, then show first-time welcome if pending
  useEffect(() => {
    return addAppEventListener('startup:hidden', () => {
      void (async () => {
        await refreshTopics();
        setDailyPromptsVersion(v => v + 1);
        showPendingFirstTimeWelcome();
      })();
    });
  }, [showPendingFirstTimeWelcome]);

  // When App.tsx finishes checking/downloading the latest topics JSON from the server,
  // immediately reload — this fires as soon as the download is done regardless of
  // whether the startup animation has finished yet (appEvents replays lastPayload
  // for late-registering listeners, so this works even on first render)
  useEffect(() => {
    return addAppEventListener('topics:ready', () => {
      void (async () => {
        await refreshTopics();
        setDailyPromptsVersion(v => v + 1);
      })();
    });
  }, []);

  // Listen for startup quick-nav buttons
  useEffect(() => {
    const unsubGallery = addAppEventListener('startup:open_gallery', () => {
      setTimeout(() => setGalleryVisible(true), 200);
    });
    const unsubInfo = addAppEventListener('startup:open_info', () => {
      setTimeout(() => setInfoVisible(true), 200);
    });
    return () => { unsubGallery(); unsubInfo(); };
  }, []);

  // Show storage button as soon as the first video/GIF is saved from Framer
  useEffect(() => {
    return addAppEventListener('video:saved', () => {
      setHasMovVideos(true);
      setHasVideosInStorage(true);
    });
  }, []);

 const offsetX = useSharedValue(trace.offsetX);
 const offsetY = useSharedValue(trace.offsetY);
 const scale = useSharedValue(trace.scale);
 const rotation = useSharedValue(trace.rotation);
 const opacity = useSharedValue(trace.opacity);
  const panStartX = useSharedValue(trace.offsetX);
  const panStartY = useSharedValue(trace.offsetY);
  const pinchStartScale = useSharedValue(trace.scale);
  const rotationStart = useSharedValue(trace.rotation);

  useEffect(() => {
    offsetX.value = trace.offsetX;
   offsetY.value = trace.offsetY;
   scale.value = trace.scale;
   rotation.value = trace.rotation;
   opacity.value = trace.opacity;
    panStartX.value = trace.offsetX;
    panStartY.value = trace.offsetY;
    pinchStartScale.value = trace.scale;
    rotationStart.value = trace.rotation;
  }, [trace.offsetX, trace.offsetY, trace.scale, trace.rotation, trace.opacity, offsetX, offsetY, scale, rotation, opacity, panStartX, panStartY, pinchStartScale, rotationStart]);

  // Track if trace scale animation is in progress (prevent useEffect from overriding)
  const isAnimatingScale = useRef(false);

  const commitTrace = useCallback(
    (partial: Partial<typeof trace>) => {
      dispatch({ type: 'SET_TRACE', trace: partial });
    },
    [dispatch]
  );

  useEffect(() => {
    if (!hasInitializedEmoji.current && simpleEmojiChoices.length > 0) {
      const initialEmoji = simpleEmojiChoices[Math.floor(Math.random() * simpleEmojiChoices.length)];
      dispatch({ type: 'SET_BRUSH_EMOJI', emoji: initialEmoji });
      hasInitializedEmoji.current = true;
    }
  }, [dispatch, simpleEmojiChoices]);

  /**
   * Every "finish the sprint now" entry point (✕ stop, upload early, tapping
   * the brush at 00:00) goes through here. `challengeCompletionHandledRef` is a
   * double-finalize guard, but a finalize interrupted by backgrounding could
   * latch it without ever opening the upload overlay — leaving all of those
   * buttons permanently dead. If the guard is set but no overlay is on screen,
   * the previous attempt did not finish: clear it and let the user retry.
   */
  const requestChallengeFinalize = useCallback(() => {
    if (!finalizeChallengeRef.current) return;
    if (challengeCompletionHandledRef.current) {
      if (challengeCompleteVisible) return;
      challengeCompletionHandledRef.current = false;
    }
    void finalizeChallengeRef.current();
  }, [challengeCompleteVisible]);

  const cycleBrushEmoji = useCallback(() => {
    void Haptics.selectionAsync();
    // If challenge time is expired (00:00), trigger finalize instead of opening picker
    if (activeChallenge && challengeRemainingMs <= 0) {
      requestChallengeFinalize();
      return;
    }
    // Set flag for tutorial lesson 0 - will trigger completion via useEffect
    if (tutorialActive && tutorialCurrentLesson === 0) {
      console.log('[Tutorial] Lesson 0: Emoji picker button clicked!');
      setTutorialEmojiPickerOpened(true);
    }
    setEmojiPickerVisible(true);
  }, [activeChallenge, challengeRemainingMs, requestChallengeFinalize, tutorialActive, tutorialCurrentLesson]);

  const deferredEmojiSearch = useDeferredValue(emojiSearch.trim());
  const emojiResults = useMemo(() => {
    if (!deferredEmojiSearch) {
      return renderableEmojiEntries;
    }
    return searchRenderableEmojis(deferredEmojiSearch).slice();
  }, [deferredEmojiSearch]);
  const allEmojiChoices = simpleEmojiChoices;

  const computeEmojiOffset = useCallback((emoji: string) => {
    const index = renderableEmojiEntries.findIndex((entry) => entry.emoji === emoji);
    if (index === -1) {
      return null;
    }
    const row = Math.floor(index / PICKER_COLUMN_COUNT);
    return row * EMOJI_ITEM_HEIGHT;
  }, []);

  const centerEmojiInPicker = useCallback(
    (targetEmoji: string | null, options?: { animated?: boolean }) => {
      if (!targetEmoji) {
        return;
      }
      const offset = computeEmojiOffset(targetEmoji);
      if (offset == null) {
        return;
      }
      const clampedOffset = Math.max(0, offset);
      emojiScrollOffsetRef.current = clampedOffset;
      if (!emojiPickerVisible) {
        return;
      }
      const list = emojiListRef.current;
      if (!list) {
        return;
      }
      const animated = options?.animated ?? true;
      InteractionManager.runAfterInteractions(() => {
        try {
          list.scrollToOffset({ offset: clampedOffset, animated });
        } catch {
          // ignore
        }
      });
    },
    [computeEmojiOffset, emojiPickerVisible]
  );

  const handleEmojiPickerScroll = useCallback((offset: number) => {
    emojiScrollOffsetRef.current = Math.max(0, offset);
  }, []);

  useEffect(() => {
    if (!emojiPickerVisible) {
      return;
    }
    const list = emojiListRef.current;
    if (!list) {
      return;
    }
    const offset = Math.max(0, emojiScrollOffsetRef.current);
    InteractionManager.runAfterInteractions(() => {
      try {
        list.scrollToOffset({ offset, animated: false });
      } catch {
        // ignore
      }
    });
  }, [emojiPickerVisible]);

  useEffect(() => {
    if (!emojiPickerVisible) {
      return;
    }
    centerEmojiInPicker(brushEmoji, { animated: false });
  }, [brushEmoji, centerEmojiInPicker, emojiPickerVisible]);

  const clearDicePulseTimeout = useCallback(() => {
    if (dicePulseTimeoutRef.current) {
      clearTimeout(dicePulseTimeoutRef.current);
      dicePulseTimeoutRef.current = null;
    }
  }, []);

  const scheduleDicePulse = useCallback(() => {
    clearDicePulseTimeout();
    const delay = 3000 + Math.floor(Math.random() * 6000);
    dicePulseTimeoutRef.current = setTimeout(() => {
      dicePulseTimeoutRef.current = null;
      triggerDiceBounceRef.current(0.04 + Math.random() * 0.05);
    }, delay);
  }, [clearDicePulseTimeout]);

  const triggerDiceBounce = useCallback((amplitude = 0.08) => {
    clearDicePulseTimeout();
    diceScale.value = withSequence(
      withTiming(1 + amplitude, {
        duration: 180,
        easing: ReanimatedEasing.out(ReanimatedEasing.ease)
      }),
      withSpring(1, {
        damping: 14,
        stiffness: 260
      })
    );
    scheduleDicePulse();
  }, [clearDicePulseTimeout, diceScale, scheduleDicePulse]);

  useEffect(() => {
    triggerDiceBounceRef.current = triggerDiceBounce;
  }, [triggerDiceBounce]);

  useEffect(() => {
    scheduleDicePulse();
    return () => {
      clearDicePulseTimeout();
      diceScale.value = 1;
    };
  }, [clearDicePulseTimeout, diceScale, scheduleDicePulse]);

  const triggerEmojiBounce = useCallback(() => {
    emojiBounceScale.stopAnimation(() => {
      RNAnimated.sequence([
        RNAnimated.timing(emojiBounceScale, {
          toValue: 1.12,
          duration: 160,
          easing: RNEasing.out(RNEasing.ease),
          useNativeDriver: true
        }),
        RNAnimated.spring(emojiBounceScale, {
          toValue: 1,
          friction: 6,
          tension: 160,
          useNativeDriver: true
        })
      ]).start();
    });
  }, [emojiBounceScale]);

  const clearBrushPreviewTimeout = useCallback(() => {
    if (brushPreviewTimeoutRef.current) {
      clearTimeout(brushPreviewTimeoutRef.current);
      brushPreviewTimeoutRef.current = null;
    }
  }, []);

  const updateBrushPreview = useCallback((size: number, emojiOverride?: string) => {
    const referencePoint = lastPointRef.current ?? {
      x: canvasSize / 2,
      y: (canvasSize * CANVAS_RATIO) / 2,
      t: Date.now()
    };

    // Single emoji preview directly at the center
    const previewEmoji = emojiOverride ?? brushEmoji;
    const previewPoint = {
      x: referencePoint.x,
      y: referencePoint.y,
      t: Date.now()
    };

    const previewStroke: Stroke = {
      id: 'preview-stroke',
      emoji: previewEmoji,
      size,
      opacity: brushOpacity,
      spacing: brushSpacing,
      points: [previewPoint],
      emojiSequence: [previewEmoji],
      mirrorX: mirrorXRef.current,
      mirrorY: mirrorYRef.current,
      rotation: brushRotationRef.current
    };
    setBrushPreviewStroke(previewStroke);
    clearBrushPreviewTimeout();
    brushPreviewTimeoutRef.current = setTimeout(() => {
      setBrushPreviewStroke(null);
      brushPreviewTimeoutRef.current = null;
    }, 1200);
  }, [brushEmoji, brushOpacity, brushSpacing, canvasSize, clearBrushPreviewTimeout]);

  const toggleMirrorX = useCallback(() => {
    void Haptics.selectionAsync();
    const next = !mirrorX;
    dispatch({ type: 'SET_MIRROR_X', value: next });
    updateBrushPreview(brushSize);
  }, [brushSize, dispatch, mirrorX, updateBrushPreview]);

  const toggleMirrorY = useCallback(() => {
    void Haptics.selectionAsync();
    const next = !mirrorY;
    dispatch({ type: 'SET_MIRROR_Y', value: next });
    updateBrushPreview(brushSize);
  }, [brushSize, dispatch, mirrorY, updateBrushPreview]);

  const setBrushRotationImmediate = useCallback(
    (value: number | ((prev: number) => number)) => {
      const numValue = typeof value === 'function' ? value(brushRotationRef.current) : value;
      const wrapped = ((numValue % 360) + 360) % 360;
      const normalized = Math.abs(wrapped) < 0.0001 ? 0 : wrapped;
      dispatch({ type: 'SET_BRUSH_ROTATION', rotation: normalized });
      brushRotationRef.current = normalized;
      // Only update preview if not currently drawing to avoid blocking
      if (!liveStrokeRef.current) {
        updateBrushPreview(brushSize);
      }
    },
    [brushSize, dispatch, updateBrushPreview]
  );

  const turnBrushLeft = useCallback(() => {
    if (autoRotateEnabled) {
      // If auto-rotate is active, toggle it off and snap to nearest 45° angle
      setAutoRotateEnabled(false);
      setAutoRotateDirection(null);

      // Snap to nearest 45° increment (0, 45, 90, 135, 180, 225, 270, 315)
      const currentRotation = brushRotationRef.current;
      const snapAngle = Math.round(currentRotation / 45) * 45;
      setBrushRotationImmediate(snapAngle % 360);

      void Haptics.selectionAsync();
      console.log(`[BRUSH] Auto-rotate disabled, snapped ${currentRotation.toFixed(0)}° → ${snapAngle}°`);
    } else {
      // Normal rotation
      void Haptics.selectionAsync();
      setBrushRotationImmediate(brushRotation - BRUSH_ROTATION_STEP);
    }
  }, [brushRotation, setBrushRotationImmediate, autoRotateEnabled]);

  const turnBrushRight = useCallback(() => {
    if (autoRotateEnabled) {
      // If auto-rotate is active, toggle it off and snap to nearest 45° angle
      setAutoRotateEnabled(false);
      setAutoRotateDirection(null);

      // Snap to nearest 45° increment (0, 45, 90, 135, 180, 225, 270, 315)
      const currentRotation = brushRotationRef.current;
      const snapAngle = Math.round(currentRotation / 45) * 45;
      setBrushRotationImmediate(snapAngle % 360);

      void Haptics.selectionAsync();
      console.log(`[BRUSH] Auto-rotate disabled, snapped ${currentRotation.toFixed(0)}° → ${snapAngle}°`);
    } else {
      // Normal rotation
      void Haptics.selectionAsync();
      setBrushRotationImmediate(brushRotation + BRUSH_ROTATION_STEP);
    }
  }, [brushRotation, setBrushRotationImmediate, autoRotateEnabled]);

  const turnBrushRightLongPress = useCallback(() => {
    // Toggle auto-rotate on long press
    setAutoRotateEnabled(prev => !prev);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('[BRUSH] Auto-rotate toggled:', !autoRotateEnabled);
  }, [autoRotateEnabled]);

  const handleBrushPreview = useCallback((size: number) => {
    updateBrushPreview(size);
  }, [updateBrushPreview]);

  const handleBrushPreviewComplete = useCallback((size: number) => {
    updateBrushPreview(size);
  }, [updateBrushPreview]);

  useEffect(() => () => {
    clearBrushPreviewTimeout();
  }, [clearBrushPreviewTimeout]);

  const handleRandomEmoji = useCallback(() => {
    if (allEmojiChoices.length === 0) {
      return;
    }
    void Haptics.selectionAsync();
    const randomIndex = Math.floor(Math.random() * allEmojiChoices.length);
    const emoji = allEmojiChoices[randomIndex];
    dispatch({ type: 'SET_BRUSH_EMOJI', emoji });
    centerEmojiInPicker(emoji, { animated: true });
    triggerDiceBounceRef.current(0.12);
    triggerEmojiBounce();
    updateBrushPreview(brushSize, emoji);

    // Complete tutorial lesson 3 if active - set state for detection
    if (tutorialActive && tutorialCurrentLesson === 3) {
      console.log('[Tutorial] Lesson 3 completed - user picked random emoji!');
      setTutorialRandomEmojiPicked(true);
    }
  }, [allEmojiChoices, brushSize, centerEmojiInPicker, dispatch, triggerEmojiBounce, updateBrushPreview, tutorialActive, tutorialCurrentLesson]);

  // Handle first-time test button - resets storage and triggers welcome overlay
  const handleFirstTimeTest = useCallback(async () => {
    console.log('[FirstTime] Testing button pressed - resetting first-time flags');
    try {
      // Clear all first-time related storage
      await AsyncStorage.removeItem(FIRST_TIME_USER_KEY);
      await AsyncStorage.removeItem(SESSION_COUNT_KEY);
      await AsyncStorage.removeItem(RANDOM_GALLERY_ROUND_KEY);
      await AsyncStorage.removeItem(FIRST_STROKE_HELPER_KEY);

      // Load queue of 33 videos and show welcome overlay
      loadWelcomeVideoQueue();
      setWelcomeOverlayVisible(true);

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('[FirstTime] Failed to reset first-time flags:', error);
    }
  }, [loadWelcomeVideoQueue]);

  const handleOpenEmojiPicker = useCallback(() => {
    void Haptics.selectionAsync();
    // If challenge time is expired (00:00), trigger finalize instead of opening picker
    if (activeChallenge && challengeRemainingMs <= 0) {
      requestChallengeFinalize();
      return;
    }
    setEmojiPickerVisible(true);
  }, [activeChallenge, challengeRemainingMs, requestChallengeFinalize]);

  const handleCanvasZoomUpdate = useCallback(
    (state: { scale: number; translateX: number; translateY: number }) => {
      setCanvasZoomLevel(state.scale);
      const safeScale = Math.max(0.0001, state.scale);

      // ZOOM JUMP FIX: Detect if zoom is actively changing
      // If scale changed, extend the cooldown to prevent painting during animation settling
      const previousScale = mainCanvasTransformRef.current.scale;
      const scaleChanged = Math.abs(previousScale - safeScale) > 0.001; // Threshold for meaningful change

      if (scaleChanged) {
        // Zoom is actively changing - extend cooldown timestamp
        // This prevents painting while ResumableZoom's internal animation is settling
        zoomCooldownTimestampRef.current = Date.now();

        if (__DEV__) {
          console.log('[Zoom Debug] Scale changed - cooldown extended', {
            previousScale: previousScale.toFixed(3),
            newScale: safeScale.toFixed(3),
            cooldownExtended: true
          });
        }
      }

      // Store zoom state WITHOUT dividing - zoom toolkit provides absolute values
      canvasScale.value = safeScale;
      canvasTranslateX.value = state.translateX;
      canvasTranslateY.value = state.translateY;

      // Store in ref for coordinate transformation
      mainCanvasTransformRef.current = {
        scale: safeScale,
        translateX: state.translateX,
        translateY: state.translateY
      };
    },
    [dispatch]
  );

  const setBrushSizeImmediate = useCallback(
    (size: number) => {
      const clamped = Math.min(BRUSH_SIZE_MAX, Math.max(1, Math.round(size)));
      dispatch({ type: 'SET_BRUSH_SIZE', size: clamped });
      brushSizeRef.current = clamped;
      // CRITICAL FIX FOR DYNAMIC WIDTH: Do NOT update liveStroke.size during drawing!
      // The stroke.size must remain constant (set at stroke initialization).
      // Only per-point width (w) should vary, sampled from brushSizeRef.current at each point.
      // This prevents the entire stroke from scaling uniformly - instead each point
      // gets its own width value, creating true variable-width strokes.
      // The renderer uses point.w ?? stroke.size for each stamp.
      pendingBrushSizeChangeRef.current = null;
    },
    [dispatch]
  );

  const updateBrushSpacingLive = useCallback((spacing: number) => {
    const normalized = clamp(spacing, 0, MAX_NORMALIZED_SPACING);
    liveSpacingRef.current = normalized;
    liveCurrentSpacingRef.current = normalized;
  }, []);

  const setBrushSpacingImmediate = useCallback(
    (normalized: number) => {
      const clamped = clamp(normalized, PRESSURE_MIN_SPACING, MAX_NORMALIZED_SPACING);
      dispatch({ type: 'SET_BRUSH_SPACING', spacing: clamped });
      brushSpacingRef.current = clamped;
      updateBrushSpacingLive(clamped);
    },
    [dispatch, updateBrushSpacingLive]
  );

  const handlePrivateStudioSizeChange = useCallback(
    (sliderValue: number) => {
      const size = Math.max(1, Math.min(BRUSH_SIZE_MAX, Math.round(sliderValue)));
      setSizeInput(String(size));
      setBrushSizeImmediate(size);
      updateBrushPreview(size);
    },
    [setBrushSizeImmediate, setSizeInput, updateBrushPreview]
  );

  const handleBrushSpacingChange = useCallback(
    (sliderValue: number) => {
      setBrushSpacingImmediate(spacingSliderToNormalized(sliderValue));
    },
    [setBrushSpacingImmediate]
  );

  const handleBrushSpacingComplete = useCallback(
    (sliderValue: number) => {
      setBrushSpacingImmediate(spacingSliderToNormalized(sliderValue));
    },
    [setBrushSpacingImmediate]
  );

  useEffect(() => () => {
    clearPrivateStudioTypewriter();
  }, [clearPrivateStudioTypewriter]);

  useEffect(() => () => {
    if (privateStudioCanvasFlightTimeoutRef.current) {
      clearTimeout(privateStudioCanvasFlightTimeoutRef.current);
      privateStudioCanvasFlightTimeoutRef.current = null;
    }
    privateStudioCanvasFlight.stopAnimation();
    privateStudioCanvasFlight.setValue(0);
  }, [privateStudioCanvasFlight]);

  const startPrivateStudioTimer = useCallback(() => {
    if (privateStudioTimerRef.current) {
      clearInterval(privateStudioTimerRef.current);
    }
    privateStudioSessionStartRef.current = Date.now();
    privateStudioTimerRef.current = setInterval(() => {
      const start = privateStudioSessionStartRef.current;
      if (start == null) {
        return;
      }
      const base = privateStudioElapsedBaseRef.current;
      setPrivateStudioElapsedMs(base + (Date.now() - start));
    }, 1000);
  }, []);

  const stopPrivateStudioTimer = useCallback(() => {
    if (privateStudioTimerRef.current) {
      clearInterval(privateStudioTimerRef.current);
      privateStudioTimerRef.current = null;
    }
    if (privateStudioSessionStartRef.current != null) {
      const total = privateStudioElapsedBaseRef.current + (Date.now() - privateStudioSessionStartRef.current);
      privateStudioElapsedBaseRef.current = total;
      setPrivateStudioElapsedMs(total);
    } else {
      privateStudioElapsedBaseRef.current = privateStudioElapsedMs;
    }
    privateStudioSessionStartRef.current = null;
  }, [privateStudioElapsedMs]);

const handlePrivateStudioNameChange = useCallback((value: string) => {
  clearPrivateStudioTypewriter();
  const normalized = value.slice(0, PRIVATE_STUDIO_NAME_MAX);
  setPrivateStudioName(normalized);
  setPrivateStudioStatusMessage(null);
  schedulePrivateStudioAutosave();
  privateStudioRandomUsedRef.current = false;
}, [clearPrivateStudioTypewriter, schedulePrivateStudioAutosave, setPrivateStudioStatusMessage]);

const createRandomPrivateStudioName = useCallback(() => {
  const existing = new Set(
    leaderboardEntries.map((entry) => entry.name.trim().toLowerCase()).filter((name) => name.length > 0)
  );
  let candidate = '';
  let attempts = 0;
  while (attempts < 48) {
    const rawBase =
      PRIVATE_STUDIO_NAME_SUGGESTIONS[
        Math.floor(Math.random() * PRIVATE_STUDIO_NAME_SUGGESTIONS.length)
      ] ?? 'emojiartist';
    const sanitizedBase = rawBase.replace(/[^a-z0-9]/gi, '') || 'emojiartist';
    const base = sanitizedBase.toLowerCase();
    const suffixNumber = Math.floor(Math.random() * 99) + 1;
    const suffix = suffixNumber.toString().padStart(2, '0');
    candidate = `${base}${suffix}`;
    attempts += 1;
    if (!existing.has(candidate.toLowerCase())) {
      break;
    }
  }
  return candidate.slice(0, PRIVATE_STUDIO_NAME_MAX);
}, [leaderboardEntries]);

const handleRandomPrivateStudioName = useCallback(
  (options?: { animate?: boolean; bounce?: boolean; force?: boolean }) => {
    const { animate = true, bounce = true, force = false } = options ?? {};
    if (privateStudioRandomLocked && !force) {
      return null;
    }
    const generated = createRandomPrivateStudioName();
    setPrivateStudioStatusMessage(null);
    privateStudioRandomUsedRef.current = true;
    if (bounce && !privateStudioRandomLocked) {
      triggerPrivateStudioDiceBounce();
    }
    if (animate) {
      runPrivateStudioTypewriter(generated, () => {
        schedulePrivateStudioAutosave();
      });
    } else {
      clearPrivateStudioTypewriter();
      setPrivateStudioName(generated);
      schedulePrivateStudioAutosave();
    }
    return generated;
  },
  [
    clearPrivateStudioTypewriter,
    createRandomPrivateStudioName,
    privateStudioRandomLocked,
    runPrivateStudioTypewriter,
    schedulePrivateStudioAutosave,
    setPrivateStudioStatusMessage,
    triggerPrivateStudioDiceBounce
  ]
);

  useEffect(() => {
    if (
      privateStudioVisible &&
      !profileWorkspaceVisible &&
      !privateStudioLoading &&
      !privateStudioAutoNameAssignedRef.current &&
      (privateStudioName.trim().length === 0 || privateStudioName === PRIVATE_STUDIO_DEFAULT_NAME_SHORT)
    ) {
      if (!privateStudioRandomLocked) {
        const generated = handleRandomPrivateStudioName({ animate: true, bounce: true });
        if (generated) {
          privateStudioAutoNameAssignedRef.current = true;
        }
      }
    }
  }, [handleRandomPrivateStudioName, privateStudioLoading, privateStudioName, privateStudioRandomLocked, privateStudioVisible, profileWorkspaceVisible]);

  const handlePrivateStudioUpload = useCallback(async () => {
    if (privateStudioUploadInFlight) {
      return;
    }
    setPrivateStudioUploadInFlight(true);
    setPrivateStudioStatusMessage(null);
    try {
      const profileDisplayName = profileWorkspaceVisible
        ? (await AsyncStorage.getItem(PROFILE_DISPLAY_NAME_STORAGE_KEY).catch(() => null))?.trim() ?? ''
        : '';
      // Profile workspace names are owned exclusively by ProfilePage. Never
      // revive a stale private-studio name when the profile display name is
      // blank; the upload should remain Anonymous until ProfilePage sets one.
      let passportNameValue = profileWorkspaceVisible ? profileDisplayName : privateStudioName.trim();
      if (!profileWorkspaceVisible && !privateStudioRandomLocked && (passportNameValue.length === 0 || passportNameValue === PRIVATE_STUDIO_DEFAULT_NAME_SHORT)) {
        const generated = handleRandomPrivateStudioName({ animate: false, bounce: false, force: true });
        passportNameValue = (generated ?? privateStudioName).trim();
      }
      if (!profileWorkspaceVisible && privateStudioRandomLocked && passportNameValue.length === 0) {
        CustomOverlayHelper.alert('Name required', 'Enter a passport name before uploading.');
        setPrivateStudioUploadInFlight(false);
        return;
      }
      try {
        await persistPrivateStudioState();
      } catch (error) {
        console.warn('Autosave before upload failed', error);
      }
      console.log('[PrivateStudio] Attempting to capture passport image...');
      console.log('[PrivateStudio] challengeCanvasRef.current:', !!challengeCanvasRef.current);
      console.log('[PrivateStudio] viewShotRef.current:', !!viewShotRef.current);

      const portrait = await capturePreviewImage({
        width: PASSPORT_PORTRAIT_SIZE,
        height: PASSPORT_PORTRAIT_SIZE,
        format: 'jpg', // Use JPEG instead of PNG to reduce file size dramatically
        quality: 0.7 // Reduced from 1.0 to avoid huge file sizes (50MB+)
      });

      console.log('[PrivateStudio] Capture result:', portrait ? 'Success' : 'Failed (null)');

      if (!portrait) {
        throw new Error('Could not capture passport image. Canvas ref not available or capture failed.');
      }
      const appVersion = Constants?.expoConfig?.version ?? Constants?.manifest?.version ?? 'dev';
      await flushLifetimeActivity();
      const latestLifetimeStats = await getLifetimeStats();
      const lifetimeStrokes = Math.max(
        latestLifetimeStats.totalStrokes,
        totalStrokes,
        strokes.length
      );
      const lifetimeSeconds = Math.max(
        0,
        Math.floor(Math.max(latestLifetimeStats.totalTimeMs, totalTimeMs) / 1000)
      );
      // Portrait is now JPEG, update MIME type accordingly
      const normalizedPortrait = portrait.startsWith('data:')
        ? portrait
        : portrait.includes('/9j/') || portrait.includes('iVBOR') === false
          ? `data:image/jpeg;base64,${portrait}` // JPEG signature
          : `data:image/png;base64,${portrait}`; // Fallback to PNG if detected
      setPassportPortrait(normalizedPortrait);
      setCurrentPassportImage(normalizedPortrait);
      AsyncStorage.setItem(PASSPORT_PORTRAIT_STORAGE_KEY, normalizedPortrait).catch(() => undefined);
      void savePassportSnapshot(normalizedPortrait).catch(() => undefined);
      lastUploadedPassportPortraitRef.current = null;
      AsyncStorage.removeItem(PASSPORT_PORTRAIT_SENT_STORAGE_KEY).catch(() => undefined);
      if (!privateStudioRandomLocked && privateStudioRandomUsedRef.current) {
        setPrivateStudioRandomLocked(true);
        AsyncStorage.setItem(PRIVATE_STUDIO_RANDOM_LOCK_KEY, '1').catch(() => undefined);
      }
      privateStudioRandomUsedRef.current = false;

      clearPrivateStudioTransientState(); // stops timer, cancels autosave, sets activeRef=false, hides studio
      if (mainPaintingBackupRef.current) {
        restorePaintingState(mainPaintingBackupRef.current);
      } else {
        restorePaintingState(null);
      }
      mainPaintingBackupRef.current = null;
      setSnapshotsSuspended(false);
      // Restore main workspace zoom state
      if (mainCanvasZoomBackupRef.current) {
        canvasScale.value = mainCanvasZoomBackupRef.current.scale;
        canvasTranslateX.value = mainCanvasZoomBackupRef.current.translateX;
        canvasTranslateY.value = mainCanvasZoomBackupRef.current.translateY;
        mainCanvasTransformRef.current = { ...mainCanvasZoomBackupRef.current };
        mainCanvasZoomBackupRef.current = null;
      }

      // If opened from ProfilePage, navigate back there with the new portrait animation.
      const returnTarget = returnToProfileAfterWorkspaceRef.current;
      returnToProfileAfterWorkspaceRef.current = null;
      setPrivateStudioSaving(false);
      if (returnTarget) {
        navigation.navigate('ProfilePage', { deviceId: returnTarget, portrait: normalizedPortrait, playPortraitAnim: true });
      }

      void (async () => {
        try {
          const result = await uploadPrivateStudioPassport({
            name: passportNameValue.length > 0 ? passportNameValue : 'Anonymous',
            totalSeconds: lifetimeSeconds,
            totalStrokes: lifetimeStrokes,
            portraitDataUrl: normalizedPortrait,
            appVersion,
            coinCount
          });
          if (deviceId) void markServerProfileSynced(deviceId);
          const successMessage = result.message?.trim().length ? result.message : 'Passport uploaded!';
          setPrivateStudioStatusMessage(successMessage);
          setCurrentPassportImage(normalizedPortrait);
          console.log('[Profile] Returned to profile card after successful upload');
          void refreshLeaderboard();
        } catch (error) {
          let message = error instanceof Error ? error.message : 'Upload failed.';
          console.error('[PaintScreen] Passport upload error:', error);

          if (typeof message === 'string') {
            if (/network request failed/i.test(message)) {
              message = 'Upload failed — please check your connection.';
            } else if (/timed out/i.test(message)) {
              message = 'Upload timed out — try again in a moment.';
            } else if (/aborted/i.test(message)) {
              // Server rejected the upload - likely device ID conflict
              message = 'Upload was rejected by server. This may happen after reinstalling the app. Try again or contact support if issue persists.';
            }
          }
          setPrivateStudioStatusMessage(message);
          CustomOverlayHelper.alert('Upload failed', message);
        } finally {
          setPrivateStudioUploadInFlight(false);
        }
      })();

      return;
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Upload failed.';
      console.error('[PaintScreen] Passport upload error:', error);

      if (typeof message === 'string') {
        if (/network request failed/i.test(message)) {
          message = 'Upload failed — please check your connection.';
        } else if (/timed out/i.test(message)) {
          message = 'Upload timed out — try again in a moment.';
        } else if (/aborted/i.test(message)) {
          // Server rejected the upload - likely device ID conflict
          message = 'Upload was rejected by server. This may happen after reinstalling the app. Try again or contact support if issue persists.';
        }
      }
      setPrivateStudioStatusMessage(message);
      CustomOverlayHelper.alert('Upload failed', message);
      privateStudioRandomUsedRef.current = false;
      setPrivateStudioUploadInFlight(false);
    }
  }, [capturePreviewImage, clearPrivateStudioTransientState, deviceId, handleRandomPrivateStudioName, persistPrivateStudioState, privateStudioName, privateStudioRandomLocked, privateStudioUploadInFlight, profileWorkspaceVisible, refreshLeaderboard, restorePaintingState, setPrivateStudioStatusMessage, setSnapshotsSuspended, strokes.length, totalStrokes, totalTimeMs]);

  useEffect(() => {
    if (!privateStudioActiveRef.current) {
      return;
    }
    setPrivateStudioStrokeCount(strokes.length);
    schedulePrivateStudioAutosave();
  }, [schedulePrivateStudioAutosave, strokes]);

  useEffect(() => {
    if (!privateStudioActiveRef.current) {
      return;
    }
    schedulePrivateStudioAutosave();
  }, [privateStudioElapsedMs, schedulePrivateStudioAutosave]);

  // activeChallengeRef sync → moved to useChallenge

  useEffect(() => {
    if (!activeChallenge) {
      return;
    }
    void persistChallengeAutosave();
  }, [activeChallenge, persistChallengeAutosave]);

  useEffect(() => {
    if (!activeChallenge) {
      return;
    }
    scheduleChallengeAutosave();
  }, [activeChallenge, scheduleChallengeAutosave, strokes.length]);

  // Schedule general autosave when strokes or frames change (non-challenge work)
  useEffect(() => {
    if (activeChallenge || privateStudioActiveRef.current || faceFilterActiveRef.current) {
      return;
    }
    scheduleGeneralAutosave();
  }, [activeChallenge, scheduleGeneralAutosave, strokes.length, frames.length]);

useEffect(() => {
  if (!privateStudioVisible) {
    clearPrivateStudioTipTimers();
    setPrivateStudioTipVisible(false);
    setPrivateStudioTipText('');
    privateStudioTipScale.setValue(0);
    privateStudioTipOpacity.setValue(0);
    privateStudioTipBurstProgress.setValue(0);
    return;
  }
  clearPrivateStudioTipTimers();
  const message = 'Here you can create/Paint your own profil image for the public Leaderboard! :)))';
  setPrivateStudioTipVisible(true);
  setPrivateStudioTipText('');
  privateStudioTipScale.setValue(0.8);
  privateStudioTipOpacity.setValue(0);
  privateStudioTipBurstProgress.setValue(0);
  RNAnimated.parallel([
    RNAnimated.spring(privateStudioTipScale, {
      toValue: 1,
      bounciness: 12,
      speed: 10,
      useNativeDriver: true
    }),
    RNAnimated.timing(privateStudioTipOpacity, {
      toValue: 1,
      duration: 220,
      easing: RNEasing.out(RNEasing.ease),
      useNativeDriver: true
    })
  ]).start();
  let index = 0;
  privateStudioTipIntervalRef.current = setInterval(() => {
    index += 1;
    setPrivateStudioTipText(message.slice(0, index));
    if (index >= message.length && privateStudioTipIntervalRef.current) {
      clearInterval(privateStudioTipIntervalRef.current);
      privateStudioTipIntervalRef.current = null;
    }
  }, 28 + Math.random() * 36);
  privateStudioTipTimeoutRef.current = setTimeout(() => {
    clearPrivateStudioTipTimers();
    privateStudioTipBurstProgress.setValue(0);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    RNAnimated.parallel([
      RNAnimated.sequence([
        RNAnimated.timing(privateStudioTipScale, {
          toValue: 1.18,
          duration: 120,
          useNativeDriver: true
        }),
        RNAnimated.timing(privateStudioTipScale, {
          toValue: 1.35,
          duration: 90,
          useNativeDriver: true
        }),
        RNAnimated.timing(privateStudioTipScale, {
          toValue: 0.25,
          duration: 190,
          easing: RNEasing.in(RNEasing.ease),
          useNativeDriver: true
        })
      ]),
      RNAnimated.timing(privateStudioTipOpacity, {
        toValue: 0,
        duration: 220,
        easing: RNEasing.in(RNEasing.ease),
        useNativeDriver: true
      }),
      RNAnimated.timing(privateStudioTipBurstProgress, {
        toValue: 1,
        duration: 360,
        easing: RNEasing.out(RNEasing.exp),
        useNativeDriver: true
      })
    ]).start(() => {
      setPrivateStudioTipVisible(false);
      setPrivateStudioTipText('');
      privateStudioTipScale.setValue(0);
      privateStudioTipOpacity.setValue(0);
      privateStudioTipBurstProgress.setValue(0);
    });
  }, 7000 + Math.random() * 8000);
  return () => {
    clearPrivateStudioTipTimers();
    setPrivateStudioTipVisible(false);
    setPrivateStudioTipText('');
    privateStudioTipScale.setValue(0);
    privateStudioTipOpacity.setValue(0);
    privateStudioTipBurstProgress.setValue(0);
  };
}, [
  clearPrivateStudioTipTimers,
  privateStudioTipBurstProgress,
  privateStudioTipOpacity,
  privateStudioTipScale,
  privateStudioVisible
]);

  // Passport snapshot animation - dynamic speed: 0.3s per frame, or 0.1s if >20 frames
  useEffect(() => {
    if (!passportSnapshotsAnimationActive || passportSnapshotsFrames.length === 0) {
      return;
    }

    // Calculate interval based on frame count: 0.3s max, or 0.1s if more than 20 frames
    const intervalMs = passportSnapshotsFrames.length > 20 ? 100 : 300;
    console.log('[PassportAnimation] Starting with', passportSnapshotsFrames.length, 'frames at', intervalMs, 'ms per frame');

    const frameInterval = setInterval(() => {
      setPassportSnapshotsCurrentFrame(prevFrame => {
        const nextFrame = prevFrame + 1;

        // If we've shown all frames, hide the animation
        if (nextFrame >= passportSnapshotsFrames.length) {
          clearInterval(frameInterval);

          // Fade out animation
          RNAnimated.timing(passportSnapshotsOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true
          }).start(() => {
            setPassportSnapshotsAnimationActive(false);
            setPassportSnapshotsFrames([]);
            setPassportSnapshotsCurrentFrame(0);
          });

          return prevFrame; // Don't increment beyond array bounds
        }

        return nextFrame;
      });
    }, intervalMs);

    return () => clearInterval(frameInterval);
  }, [passportSnapshotsAnimationActive, passportSnapshotsFrames.length, passportSnapshotsOpacity]);

  const getEmojiItemLayout = useCallback<NonNullable<EmojiListProps['getItemLayout']>>((_, index) => {
    const row = Math.floor(index / PICKER_COLUMN_COUNT);
    return { length: EMOJI_ITEM_HEIGHT, offset: row * EMOJI_ITEM_HEIGHT, index };
  }, []);

  const handleScrollToIndexFailed = useCallback(
    (info: ScrollFailureInfo) => {
      const fallbackEmoji =
        emojiResults[info.index]?.emoji ??
        brushEmoji ??
        emojiResults[emojiResults.length - 1]?.emoji ??
        null;
      if (fallbackEmoji) {
        requestAnimationFrame(() => {
          centerEmojiInPicker(fallbackEmoji, { animated: false });
        });
      }
    },
    [brushEmoji, centerEmojiInPicker, emojiResults]
  );

  /**
   * Check for uncommitted emoji planes when leaving placer tool
   * Shows dialog if multiple planes exist with some uncommitted
   */
  const handleLeavingEmojiPlacer = useCallback((targetTool: ToolMode) => {
    // Only show dialog if leaving emoji plane tool
    if (toolMode !== 'emojiplane') {
      setToolMode(targetTool);
      return;
    }

    // Count committed vs uncommitted planes
    const uncommittedPlanes = emojiPlanes.filter(p => p.visible !== false); // uncommitted planes have visible !== false
    const committedPlanes = emojiPlanes.filter(p => p.visible === false);

    // If no uncommitted planes or all committed, just switch tool
    if (uncommittedPlanes.length === 0 || committedPlanes.length === emojiPlanes.length) {
      setToolMode(targetTool);
      return;
    }

    // If only one uncommitted plane, show "one" dialog
    if (uncommittedPlanes.length === 1) {
      setCommitDialogMode('one');
    } else {
      // Multiple uncommitted planes
      setCommitDialogMode('all');
    }

    // Remember which tool to switch to
    pendingToolModeRef.current = targetTool;
    setCommitDialogVisible(true);
  }, [toolMode, emojiPlanes]);

  const activateBrushTool = useCallback(() => {
    void Haptics.selectionAsync();
    if (toolMode === 'brush') {
      // Toggle options overlay when brush is already active
      setBrushOptionsVisible(prev => !prev);
      // Start 3-second auto-hide timer when showing
      if (!brushOptionsVisible) {
        if (brushOptionsTimerRef.current) {
          clearTimeout(brushOptionsTimerRef.current);
        }
        brushOptionsTimerRef.current = setTimeout(() => {
          setBrushOptionsVisible(false);
        }, 3000);
      }
    } else {
      // Check for uncommitted planes when leaving emoji placer
      handleLeavingEmojiPlacer('brush');
      setBrushOptionsVisible(false);
      // Clear polygon points when switching away from polygon tool
      setPolygonPoints([]);
      polygonPointsRef.current = [];
    }
  }, [toolMode, brushOptionsVisible, handleLeavingEmojiPlacer]);

  const activateLineTool = useCallback(() => {
    void Haptics.selectionAsync();
    handleLeavingEmojiPlacer('line');
    setBrushOptionsVisible(false);
    // Clear polygon points when switching away from polygon tool
    setPolygonPoints([]);
    polygonPointsRef.current = [];
  }, [handleLeavingEmojiPlacer]);

  const activateEraserTool = useCallback(() => {
    void Haptics.selectionAsync();
    handleLeavingEmojiPlacer('eraser');
    setBrushOptionsVisible(false);
    // Clear polygon points when switching away from polygon tool
    setPolygonPoints([]);
    polygonPointsRef.current = [];
  }, [handleLeavingEmojiPlacer]);

  const activateEmojiPlaneTool = useCallback(() => {
    void Haptics.selectionAsync();
    setToolMode('emojiplane');
    setBrushOptionsVisible(false);
    // Emoji plane creation now only happens on canvas tap or plus button click
  }, []);

  // Emoji plane utility functions
  const createEmojiPlane = useCallback((tapX?: number, tapY?: number) => {
    // Use refs to get current values (avoids stale closure)
    const currentEmoji = brushEmojiRef.current;
    const currentBrushSize = brushSizeRef.current;
    const lifetime = planeLifetime;

    console.log('[CREATE EMOJI PLANE] Creating plane with emoji:', currentEmoji, 'brushSize:', currentBrushSize, 'from ref');

    // Cap plane size at brushSize 40 - don't allow bigger planes
    // Effective brush size range: 1-40 for plane sizing
    // Size calculation: cappedSize * 6 = 6-240px plane sizes
    const cappedBrushSize = Math.min(currentBrushSize, 40);
    const planeSize = cappedBrushSize * 6;

    // Center the plane at tap position if provided, otherwise canvas center
    const canvasSizeValue = canvasPixelSize;
    const centerX = tapX !== undefined ? tapX : canvasSizeValue / 2;
    const centerY = tapY !== undefined ? tapY : canvasSizeValue / 2;
    const halfSize = planeSize / 2;

    // Create initial corners for the plane
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

    const creationTimestamp = Date.now();

    // Create initial corner snapshot for timelapse history
    const initialSnapshot: PlaneCornerSnapshot = {
      topLeft: { x: initialCorners.topLeft.x, y: initialCorners.topLeft.y },
      topRight: { x: initialCorners.topRight.x, y: initialCorners.topRight.y },
      bottomRight: { x: initialCorners.bottomRight.x, y: initialCorners.bottomRight.y },
      bottomLeft: { x: initialCorners.bottomLeft.x, y: initialCorners.bottomLeft.y },
      timestamp: creationTimestamp
    };

    // Create a plane object that can be edited with corner handles
    const newPlane: EmojiPlane = {
      id: `plane-${Date.now()}-${Math.random()}`,
      emoji: currentEmoji, // Use current brush emoji
      corners: initialCorners,
      timestamp: creationTimestamp, // For timelapse
      cornerHistory: [initialSnapshot], // Start history with initial position
      opacity: 1.0, // Always opaque - ignore alpha transparent toggle for planes
      rotation: 0,
      scale: 1,
      visible: true,
      zIndex: nextZIndexRef.current++,
      layer: activeLayerRef.current // 3-layer system: place on the active layer
    };

    // Add plane to context state (undo/redo enabled)
    dispatch({ type: 'ADD_EMOJI_PLANE', plane: newPlane });

    // Select the new plane
    setSelectedPlaneId(newPlane.id);
    selectedPlaneIdRef.current = newPlane.id;

    const positionDesc = tapX !== undefined && tapY !== undefined
      ? `at tap (${tapX.toFixed(0)}, ${tapY.toFixed(0)})`
      : 'at canvas center';
    console.log(`[PAINT PLANE] Created plane ${newPlane.id} with emoji ${currentEmoji}, size=${currentBrushSize}, ${positionDesc}`);

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [planeLifetime, canvasPixelSize, dispatch]);

  const updatePlaneLifetime = useCallback((planeId: string, newLifetime: number) => {
    const clampedLifetime = Math.max(1, Math.min(999, newLifetime));

    // Update via dispatch (undo/redo enabled)
    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        lifetime: clampedLifetime,
        timestamp: Date.now() // Update timestamp for timelapse
      }
    });
  }, [dispatch]);

  const scalePlane = useCallback((planeId: string, scaleFactor: number) => {
    const plane = emojiPlanes.find(p => p.id === planeId);
    if (!plane) return;

    const corners = plane.corners;
    const centerX = (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4;
    const centerY = (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4;
    const scaled = scalePlaneGeometry(plane, { x: centerX, y: centerY }, scaleFactor);

    // Update via dispatch (undo/redo enabled - each scale is a step)
    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        corners: scaled.corners,
        lattice: scaled.lattice,
        latticeLevel: scaled.latticeLevel,
        timestamp: Date.now() // Update timestamp for timelapse
      }
    });
  }, [emojiPlanes, dispatch]);

  const updatePlaneRotation = useCallback((planeId: string, nextValue: number) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId);
    if (!plane) return;
    const next = Math.max(0, Math.min(360, nextValue));
    const previous = plane.rotation ?? 0;
    const delta = next - previous;
    if (Math.abs(delta) < 0.001) return;
    const corners = plane.corners;
    const center = {
      x: (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4,
      y: (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4,
    };
    const rotated = rotatePlaneGeometry(plane, center, delta);
    const updatedPlane = { ...rotated, rotation: next, timestamp: Date.now() };
    emojiPlanesRef.current = emojiPlanesRef.current.map(item => item.id === planeId ? updatedPlane : item);
    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        corners: rotated.corners,
        lattice: rotated.lattice,
        latticeLevel: rotated.latticeLevel,
        rotation: updatedPlane.rotation,
        timestamp: updatedPlane.timestamp,
      },
    });
  }, [dispatch]);

  const updatePlaneScale = useCallback((planeId: string, nextValue: number) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId);
    if (!plane) return;
    const next = Math.max(0.25, Math.min(2.5, nextValue));
    const previous = Math.max(0.25, plane.scale ?? 1);
    const factor = next / previous;
    if (Math.abs(factor - 1) < 0.0001) return;
    const corners = plane.corners;
    const center = {
      x: (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4,
      y: (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4,
    };
    const scaled = scalePlaneGeometry(plane, center, factor);
    const updatedPlane = { ...scaled, scale: next, timestamp: Date.now() };
    emojiPlanesRef.current = emojiPlanesRef.current.map(item => item.id === planeId ? updatedPlane : item);
    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        corners: scaled.corners,
        lattice: scaled.lattice,
        latticeLevel: scaled.latticeLevel,
        scale: updatedPlane.scale,
        timestamp: updatedPlane.timestamp,
      },
    });
  }, [dispatch]);

  const deletePlane = useCallback((planeId: string | null) => {
    // Validate plane ID exists
    if (!planeId) {
      console.warn('[PAINT PLANE] Cannot delete: planeId is null or undefined');
      return;
    }

    // Verify plane exists before deleting
    const planeExists = emojiPlanes.some(p => p.id === planeId);
    if (!planeExists) {
      console.warn(`[PAINT PLANE] Cannot delete: plane ${planeId} not found in current planes`);
      return;
    }

    console.log(`[PAINT PLANE] Deleting plane ${planeId}`);

    // Delete via dispatch (undo/redo enabled)
    dispatch({ type: 'DELETE_EMOJI_PLANE', planeId });

    // Auto-select another plane if any exist
    const remainingPlanes = emojiPlanes.filter(p => p.id !== planeId);
    if (selectedPlaneId === planeId) {
      if (remainingPlanes.length > 0) {
        const nextPlane = remainingPlanes[remainingPlanes.length - 1];
        setSelectedPlaneId(nextPlane.id);
        selectedPlaneIdRef.current = nextPlane.id;
        console.log(`[PAINT PLANE] Auto-selected next plane ${nextPlane.id}`);
      } else {
        setSelectedPlaneId(null);
        selectedPlaneIdRef.current = null;
        console.log(`[PAINT PLANE] No more planes - cleared selection`);
      }
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [selectedPlaneId, emojiPlanes, dispatch]);

  // Reorder planes in the list (for drag-and-drop hierarchy control)
  const reorderPlane = useCallback((planeId: string, targetIndex: number) => {
    const fromIndex = emojiPlanes.findIndex(p => p.id === planeId);
    if (fromIndex === -1 || fromIndex === targetIndex) return;

    const newPlanes = [...emojiPlanes];
    const [movedPlane] = newPlanes.splice(fromIndex, 1);
    newPlanes.splice(targetIndex, 0, movedPlane);

    // Update zIndex to match new order (index 0 = bottom, higher index = on top)
    const reorderedPlanes = newPlanes.map((plane, index) => ({
      ...plane,
      zIndex: index,
      timestamp: Date.now() // Update timestamp for this action
    }));

    // Use SET_EMOJI_PLANES to replace entire array (undo/redo enabled)
    dispatch({ type: 'SET_EMOJI_PLANES', planes: reorderedPlanes });

    void Haptics.selectionAsync();
  }, [emojiPlanes, dispatch]);

  // Update corner in ref only (for smooth dragging) - call commitCornerChange on release
  const updatePlaneCornerRef = useCallback((planeId: string, cornerKey: string, x: number, y: number) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId);
    if (!plane) return;
    const updated = movePlaneHandle(plane, cornerKey, x, y);
    if (updated === plane) return;
    const preview = emojiPlanesRef.current.map(p => (p.id === planeId ? updated : p));
    emojiPlanesRef.current = preview;
    setEmojiPlaneGesturePreview(preview);
  }, []);

  // Commit corner change to context (creates undo step + adds snapshot to history)
  const commitCornerChange = useCallback((planeId: string) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId);
    if (!plane) return;

    const timestamp = Date.now();

    // Create corner snapshot for timelapse history
    const snapshot: PlaneCornerSnapshot = {
      topLeft: { x: plane.corners.topLeft.x, y: plane.corners.topLeft.y },
      topRight: { x: plane.corners.topRight.x, y: plane.corners.topRight.y },
      bottomRight: { x: plane.corners.bottomRight.x, y: plane.corners.bottomRight.y },
      bottomLeft: { x: plane.corners.bottomLeft.x, y: plane.corners.bottomLeft.y },
      timestamp
    };

    // Add snapshot to history
    const newHistory = [...(plane.cornerHistory || []), snapshot];

    console.log(`[PAINT PLANE] Corner change committed - history now has ${newHistory.length} snapshots`);

    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        corners: plane.corners,
        lattice: plane.lattice?.map(point => ({ ...point })),
        latticeLevel: plane.latticeLevel,
        cornerHistory: newHistory,
        timestamp
      }
    });
  }, [dispatch]);

  const handlePlaneCornerDragStart = useCallback((planeId: string, corner: string, touchX?: number, touchY?: number) => {
    // Calculate offset if touch position is provided
    let offsetX = 0;
    let offsetY = 0;

    if (touchX !== undefined && touchY !== undefined && corner !== 'center') {
      const plane = emojiPlanesRef.current.find(p => p.id === planeId);
      if (plane) {
        const cornerPos = corner.startsWith('lattice:')
          ? plane.lattice?.[Number(corner.slice('lattice:'.length))]
          : (plane.corners[corner as keyof typeof plane.corners] as { x: number; y: number });
        if (cornerPos) {
          offsetX = cornerPos.x - touchX;
          offsetY = cornerPos.y - touchY;
          console.log(`[PLACER] Calculated offset for ${corner}: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
        }
      }
    }

    setDraggingCorner({ planeId, corner });
    draggingCornerRef.current = { planeId, corner, offsetX, offsetY };
    void Haptics.selectionAsync();
  }, []);

  const handlePlaneCornerDrag = useCallback((planeId: string, corner: string, x: number, y: number) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId);
    if (!plane) return;

    const newCorners = { ...plane.corners };

    if (corner === 'center') {
      // Moving entire plane - calculate delta from current center and apply to all corners
      const currentCenterX = (plane.corners.topLeft.x + plane.corners.topRight.x) / 2;
      const currentCenterY = (plane.corners.topLeft.y + plane.corners.bottomLeft.y) / 2;
      const deltaX = x - currentCenterX;
      const deltaY = y - currentCenterY;

      // Move all 8 points
      Object.keys(newCorners).forEach(key => {
        const cornerKey = key as keyof typeof plane.corners;
        newCorners[cornerKey] = {
          x: plane.corners[cornerKey].x + deltaX,
          y: plane.corners[cornerKey].y + deltaY
        };
      });
    } else {
      // Moving a single corner
      (newCorners as any)[corner] = { x, y };
    }

    // Always recalculate edge midpoints
    newCorners.topMid = {
      x: (newCorners.topLeft.x + newCorners.topRight.x) / 2,
      y: (newCorners.topLeft.y + newCorners.topRight.y) / 2
    };
    newCorners.rightMid = {
      x: (newCorners.topRight.x + newCorners.bottomRight.x) / 2,
      y: (newCorners.topRight.y + newCorners.bottomRight.y) / 2
    };
    newCorners.bottomMid = {
      x: (newCorners.bottomLeft.x + newCorners.bottomRight.x) / 2,
      y: (newCorners.bottomLeft.y + newCorners.bottomRight.y) / 2
    };
    newCorners.leftMid = {
      x: (newCorners.topLeft.x + newCorners.bottomLeft.x) / 2,
      y: (newCorners.topLeft.y + newCorners.bottomLeft.y) / 2
    };

    // Update state for immediate visual feedback during dragging
    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        corners: newCorners
      }
    });

    // Keep dragging corner state for visual feedback
    setDraggingCorner({ planeId, corner });
  }, [dispatch]);

  const handlePlaneCornerDragEnd = useCallback((planeId: string) => {
    commitCornerChange(planeId);
    setDraggingCorner(null);
    draggingCornerRef.current = null;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [commitCornerChange]);

  // Move entire plane by delta
  const movePlane = useCallback((planeId: string, deltaX: number, deltaY: number) => {
    const plane = emojiPlanes.find(p => p.id === planeId);
    if (!plane) return;
    const moved = translatePlaneGeometry(plane, deltaX, deltaY);
    const newCorners = moved.corners;

    const timestamp = Date.now();

    // Create corner snapshot for timelapse history (track position changes)
    const snapshot: PlaneCornerSnapshot = {
      topLeft: { x: newCorners.topLeft.x, y: newCorners.topLeft.y },
      topRight: { x: newCorners.topRight.x, y: newCorners.topRight.y },
      bottomRight: { x: newCorners.bottomRight.x, y: newCorners.bottomRight.y },
      bottomLeft: { x: newCorners.bottomLeft.x, y: newCorners.bottomLeft.y },
      timestamp
    };

    // Add snapshot to history
    const newHistory = [...(plane.cornerHistory || []), snapshot];

    // Update via dispatch (undo/redo enabled - each move is a step)
    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        corners: newCorners,
        lattice: moved.lattice,
        latticeLevel: moved.latticeLevel,
        cornerHistory: newHistory,
        timestamp
      }
    });
  }, [emojiPlanes, dispatch]);

  // Commit plane as a stroke (bakes it into the canvas)
  /**
   * Change how many handles a plane exposes.
   *
   * The existing shape is RESAMPLED onto the new density rather than reset: going 4 -> 36 adds
   * handles that already sit on the current surface, and going back down keeps the coarse shape.
   * Anything without a lattice yet is seeded from its four corners through the same projection the
   * renderer uses, so switching level never moves the artwork.
   */
  const setPlaneLatticeLevel = useCallback((planeId: string, level: LatticeLevel) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId);
    if (!plane) return;
    const currentLevel = (plane.latticeLevel ?? 1) as LatticeLevel;
    if (currentLevel === level && plane.lattice) return;

    const existing = plane.lattice;
    const next = existing && currentLevel > 1
      ? resampleLattice(existing, currentLevel, level)
      : latticeFromPlaneCorners(level, plane.corners);

    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: { lattice: next, latticeLevel: level, corners: latticeCorners(next, level) }
    });
  }, [dispatch]);

  const commitPlaneAsStroke = useCallback((planeId: string) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId) ?? emojiPlanes.find(p => p.id === planeId);
    if (!plane) return;

    console.log(`[PAINT PLANE] Committing plane ${planeId} as stroke`);
    console.log(`[PAINT PLANE] Original corners:`, {
      topLeft: plane.corners.topLeft,
      topRight: plane.corners.topRight,
      bottomRight: plane.corners.bottomRight,
      bottomLeft: plane.corners.bottomLeft
    });

    // CRITICAL: Ensure final corner state is captured in history
    // This captures any corner distortions made during interaction
    const timestamp = Date.now();
    let finalCornerHistory = [...(plane.cornerHistory || [])];

    // Check if the last snapshot matches current corners (within tolerance)
    const lastSnapshot = finalCornerHistory[finalCornerHistory.length - 1];
    const tolerance = 0.1; // Allow small floating-point differences
    const cornersChanged = !lastSnapshot ||
      Math.abs(lastSnapshot.topLeft.x - plane.corners.topLeft.x) > tolerance ||
      Math.abs(lastSnapshot.topLeft.y - plane.corners.topLeft.y) > tolerance ||
      Math.abs(lastSnapshot.topRight.x - plane.corners.topRight.x) > tolerance ||
      Math.abs(lastSnapshot.topRight.y - plane.corners.topRight.y) > tolerance ||
      Math.abs(lastSnapshot.bottomRight.x - plane.corners.bottomRight.x) > tolerance ||
      Math.abs(lastSnapshot.bottomRight.y - plane.corners.bottomRight.y) > tolerance ||
      Math.abs(lastSnapshot.bottomLeft.x - plane.corners.bottomLeft.x) > tolerance ||
      Math.abs(lastSnapshot.bottomLeft.y - plane.corners.bottomLeft.y) > tolerance;

    // If corners have changed since last snapshot, add final snapshot
    if (cornersChanged) {
      console.log('[PAINT PLANE] Corner distortion detected at commit - capturing final state');
      const finalSnapshot: PlaneCornerSnapshot = {
        topLeft: { x: plane.corners.topLeft.x, y: plane.corners.topLeft.y },
        topRight: { x: plane.corners.topRight.x, y: plane.corners.topRight.y },
        bottomRight: { x: plane.corners.bottomRight.x, y: plane.corners.bottomRight.y },
        bottomLeft: { x: plane.corners.bottomLeft.x, y: plane.corners.bottomLeft.y },
        timestamp
      };
      finalCornerHistory.push(finalSnapshot);
    }

    // Calculate center of the plane (for stroke metadata only, not rendering)
    const centerX = (plane.corners.topLeft.x + plane.corners.topRight.x + plane.corners.bottomLeft.x + plane.corners.bottomRight.x) / 4;
    const centerY = (plane.corners.topLeft.y + plane.corners.topRight.y + plane.corners.bottomLeft.y + plane.corners.bottomRight.y) / 4;

    // Calculate average size
    const width = Math.abs(plane.corners.topRight.x - plane.corners.topLeft.x);
    const height = Math.abs(plane.corners.bottomLeft.y - plane.corners.topLeft.y);
    const avgSize = (width + height) / 2;

    // Create a single-point stroke at the center (for metadata only)
    const strokePoint: StrokePoint = {
      x: centerX,
      y: centerY,
      t: timestamp,
      w: avgSize
    };

    // Store exact corner positions for accurate rendering
    const planeCorners = {
      topLeft: { x: plane.corners.topLeft.x, y: plane.corners.topLeft.y },
      topRight: { x: plane.corners.topRight.x, y: plane.corners.topRight.y },
      bottomRight: { x: plane.corners.bottomRight.x, y: plane.corners.bottomRight.y },
      bottomLeft: { x: plane.corners.bottomLeft.x, y: plane.corners.bottomLeft.y }
    };

    // Determine if this is a custom emoji and the appropriate stamp size
    const isCustom = isCustomBrushReference(plane.emoji) || plane.emoji.startsWith('data:image/png;base64,');
    const planeStampSize = isCustom ? 90 : 128;

    const stroke: Stroke = {
      id: `plane-baked-${timestamp}-${Math.random()}`,
      emoji: plane.emoji,
      size: avgSize,
      opacity: plane.opacity,
      spacing: 1.0,
      stampSpan: measureEmojiSpan(plane.emoji, avgSize),
      points: [strokePoint],
      mirrorX: false,
      mirrorY: false,
      rotation: 0,
      isEraser: false,
      // Plane-specific data for distorted rendering
      isPlane: true,
      planeCorners: planeCorners,
      // Carry the distortion lattice onto the baked stroke, otherwise an applied plane would snap
      // back to the 4-corner shape and lose every interior bend the user made.
      ...(plane.lattice && (plane.latticeLevel ?? 1) > 1
        ? { planeLattice: plane.lattice.map(pt => ({ x: pt.x, y: pt.y })), planeLatticeLevel: plane.latticeLevel }
        : {}),
      planeCornerHistory: finalCornerHistory, // Use final history with all distortions captured
      planeStampSize: planeStampSize, // Store the stamp size used during placer
      isCustomEmoji: isCustom, // Store whether this uses custom emoji (affects texture padding)
      // 3-layer system: a committed plane keeps the layer it was placed on (falling back to the
      // currently active layer for planes created before layers existed).
      layer: plane.layer ?? activeLayerRef.current
    };

    console.log(`[PAINT PLANE] Corner history length: ${finalCornerHistory.length} snapshots`);

    console.log(`[PAINT PLANE] Committed corners:`, stroke.planeCorners);

    // Add stroke to canvas using dispatch
    dispatch({ type: 'COMMIT_STROKE', stroke });

    // Remove the plane via dispatch (undo/redo enabled)
    dispatch({ type: 'DELETE_EMOJI_PLANE', planeId });

    // Auto-select another plane if any exist
    const remainingPlanes = emojiPlanes.filter(p => p.id !== planeId);
    if (remainingPlanes.length > 0) {
      const nextPlane = remainingPlanes[remainingPlanes.length - 1]; // Select last one
      setSelectedPlaneId(nextPlane.id);
      selectedPlaneIdRef.current = nextPlane.id;
      console.log(`[PAINT PLANE] Auto-selected plane ${nextPlane.id}`);
    } else {
      setSelectedPlaneId(null);
      selectedPlaneIdRef.current = null;
      console.log(`[PAINT PLANE] No more planes - cleared selection`);
    }

    console.log(`[PAINT PLANE] ✅ Plane committed as stroke and removed from planes`);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [emojiPlanes, dispatch]);

  // Auto-commit all planes when switching away from plane tool
  const commitAllPlanes = useCallback(() => {
    // Sort by zIndex ascending so strokes are appended in correct layer order
    // (lower zIndex committed first = drawn first = underneath higher-zIndex planes)
    const currentPlanes = [...emojiPlanes].sort((a, b) => a.zIndex - b.zIndex);
    if (currentPlanes.length === 0) return;

    console.log(`[PAINT PLANE] Auto-committing ${currentPlanes.length} plane(s) when switching tools`);

    currentPlanes.forEach(plane => {
      commitPlaneAsStroke(plane.id);
    });
  }, [emojiPlanes, commitPlaneAsStroke]);

  const togglePlaneVisibility = useCallback((planeId: string) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId) ?? emojiPlanes.find(p => p.id === planeId);
    if (!plane) return;
    const nextVisible = plane.visible === false;
    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        visible: nextVisible,
        timestamp: Date.now()
      }
    });
  }, [dispatch, emojiPlanes]);

  const updatePlaneOpacity = useCallback((planeId: string, value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        opacity: clamped,
        timestamp: Date.now()
      }
    });
  }, [dispatch]);

  // Restore a plane to the placement it had when it was created. cornerHistory[0] is written by
  // createEmojiPlane/duplicatePlane, so it is the authoritative "initial corners" record; the four
  // edge midpoints are derived because snapshots only store the four true corners.
  const resetPlaneCorners = useCallback((planeId: string) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId) ?? emojiPlanes.find(p => p.id === planeId);
    const initial = plane?.cornerHistory?.[0];
    if (!plane || !initial) return;

    const timestamp = Date.now();
    const restoredCorners: EmojiPlane['corners'] = {
      topLeft: { x: initial.topLeft.x, y: initial.topLeft.y },
      topMid: {
        x: (initial.topLeft.x + initial.topRight.x) / 2,
        y: (initial.topLeft.y + initial.topRight.y) / 2
      },
      topRight: { x: initial.topRight.x, y: initial.topRight.y },
      rightMid: {
        x: (initial.topRight.x + initial.bottomRight.x) / 2,
        y: (initial.topRight.y + initial.bottomRight.y) / 2
      },
      bottomRight: { x: initial.bottomRight.x, y: initial.bottomRight.y },
      bottomMid: {
        x: (initial.bottomLeft.x + initial.bottomRight.x) / 2,
        y: (initial.bottomLeft.y + initial.bottomRight.y) / 2
      },
      bottomLeft: { x: initial.bottomLeft.x, y: initial.bottomLeft.y },
      leftMid: {
        x: (initial.topLeft.x + initial.bottomLeft.x) / 2,
        y: (initial.topLeft.y + initial.bottomLeft.y) / 2
      }
    };

    // Append rather than truncate: the timelapse replays cornerHistory, so the move back to the
    // start has to be part of the story instead of erasing it.
    const resetSnapshot: PlaneCornerSnapshot = {
      topLeft: { x: initial.topLeft.x, y: initial.topLeft.y },
      topRight: { x: initial.topRight.x, y: initial.topRight.y },
      bottomRight: { x: initial.bottomRight.x, y: initial.bottomRight.y },
      bottomLeft: { x: initial.bottomLeft.x, y: initial.bottomLeft.y },
      timestamp
    };

    dispatch({
      type: 'UPDATE_EMOJI_PLANE',
      planeId,
      updates: {
        corners: restoredCorners,
        ...(plane.lattice && (plane.latticeLevel ?? 1) > 1
          ? {
              lattice: latticeFromPlaneCorners(plane.latticeLevel as LatticeLevel, restoredCorners),
              latticeLevel: plane.latticeLevel,
            }
          : {}),
        cornerHistory: [...(plane.cornerHistory || []), resetSnapshot],
        rotation: 0,
        scale: 1,
        timestamp
      }
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [dispatch, emojiPlanes]);

  const duplicatePlane = useCallback((planeId: string) => {
    const plane = emojiPlanesRef.current.find(p => p.id === planeId) ?? emojiPlanes.find(p => p.id === planeId);
    if (!plane) return;

    const maxZIndex = emojiPlanesRef.current.reduce((max, p) => Math.max(max, p.zIndex), -Infinity);
    const offset = 18;
    const offsetCorners = Object.fromEntries(
      Object.entries(plane.corners).map(([key, value]) => [
        key,
        { x: value.x + offset, y: value.y + offset }
      ])
    ) as EmojiPlane['corners'];

    const timestamp = Date.now();
    const initialSnapshot: PlaneCornerSnapshot = {
      topLeft: { x: offsetCorners.topLeft.x, y: offsetCorners.topLeft.y },
      topRight: { x: offsetCorners.topRight.x, y: offsetCorners.topRight.y },
      bottomRight: { x: offsetCorners.bottomRight.x, y: offsetCorners.bottomRight.y },
      bottomLeft: { x: offsetCorners.bottomLeft.x, y: offsetCorners.bottomLeft.y },
      timestamp
    };
    const newPlane: EmojiPlane = {
      ...plane,
      id: `plane-${timestamp}-${Math.random()}`,
      corners: offsetCorners,
      ...(plane.lattice
        ? { lattice: plane.lattice.map(point => ({ x: point.x + offset, y: point.y + offset })) }
        : {}),
      timestamp,
      cornerHistory: [initialSnapshot],
      visible: plane.visible !== false,
      zIndex: Number.isFinite(maxZIndex) ? maxZIndex + 1 : 0
    };

    dispatch({ type: 'ADD_EMOJI_PLANE', plane: newPlane });
    setSelectedPlaneId(newPlane.id);
    selectedPlaneIdRef.current = newPlane.id;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [dispatch, emojiPlanes]);

  const clearPlaneExtrasTimer = useCallback(() => {
    if (planeExtrasTimerRef.current) {
      clearTimeout(planeExtrasTimerRef.current);
      planeExtrasTimerRef.current = null;
    }
  }, []);

  const schedulePlaneExtrasHide = useCallback((planeId: string | null) => {
    clearPlaneExtrasTimer();
    if (!planeId) return;
    planeExtrasTimerRef.current = setTimeout(() => {
      setPlaneExtrasId(null);
    }, 3000);
  }, [clearPlaneExtrasTimer]);

  const showPlaneExtras = useCallback((planeId: string) => {
    setPlaneExtrasId(planeId);
    schedulePlaneExtrasHide(planeId);
  }, [schedulePlaneExtrasHide]);

  const bumpPlaneExtras = useCallback((planeId?: string) => {
    const targetId = planeId ?? planeExtrasId;
    if (!targetId) return;
    schedulePlaneExtrasHide(targetId);
  }, [planeExtrasId, schedulePlaneExtrasHide]);

  useEffect(() => {
    return () => {
      clearPlaneExtrasTimer();
    };
  }, [clearPlaneExtrasTimer]);

  const handleClearCanvas = useCallback(() => {
    void Haptics.selectionAsync();
    setShowClearConfirm(true);
  }, []);

  // Brush options handlers
  const extendBrushOptionsTimer = useCallback(() => {
    if (brushOptionsTimerRef.current) {
      clearTimeout(brushOptionsTimerRef.current);
    }
    brushOptionsTimerRef.current = setTimeout(() => {
      setBrushOptionsVisible(false);
    }, 3000);
  }, []);

  const handleFlipX = useCallback(() => {
    void Haptics.selectionAsync();
    dispatch({ type: 'SET_MIRROR_X', value: !mirrorX });
    extendBrushOptionsTimer();
  }, [mirrorX, dispatch, extendBrushOptionsTimer]);

  const handleFlipY = useCallback(() => {
    void Haptics.selectionAsync();
    dispatch({ type: 'SET_MIRROR_Y', value: !mirrorY });
    extendBrushOptionsTimer();
  }, [mirrorY, dispatch, extendBrushOptionsTimer]);

  const handleRotateLeft = useCallback(() => {
    void Haptics.selectionAsync();
    // Normal press: rotate by 90° and turn off auto-rotate if it's on
    if (autoRotateEnabled && autoRotateDirection === 'left') {
      setAutoRotateEnabled(false);
      setAutoRotateDirection(null);
      console.log('[BRUSH] Auto-rotate left disabled');
    } else {
      const newRotation = (brushRotation - 90 + 360) % 360;
      dispatch({ type: 'SET_BRUSH_ROTATION', rotation: newRotation });
    }
    extendBrushOptionsTimer();
  }, [brushRotation, dispatch, extendBrushOptionsTimer, autoRotateEnabled, autoRotateDirection]);

  const handleRotateRight = useCallback(() => {
    void Haptics.selectionAsync();
    // Normal press: rotate by 90° and turn off auto-rotate if it's on
    if (autoRotateEnabled && autoRotateDirection === 'right') {
      setAutoRotateEnabled(false);
      setAutoRotateDirection(null);
      console.log('[BRUSH] Auto-rotate right disabled');
    } else {
      const newRotation = (brushRotation + 90) % 360;
      dispatch({ type: 'SET_BRUSH_ROTATION', rotation: newRotation });
    }
    extendBrushOptionsTimer();
  }, [brushRotation, dispatch, extendBrushOptionsTimer, autoRotateEnabled, autoRotateDirection]);

  const handleRotateLeftLongPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Long press: toggle auto-rotate left
    if (autoRotateEnabled && autoRotateDirection === 'left') {
      setAutoRotateEnabled(false);
      setAutoRotateDirection(null);
      console.log('[BRUSH] Auto-rotate left disabled');
    } else {
      setAutoRotateEnabled(true);
      setAutoRotateDirection('left');
      console.log('[BRUSH] Auto-rotate left enabled');
    }
    extendBrushOptionsTimer();
  }, [autoRotateEnabled, autoRotateDirection, extendBrushOptionsTimer]);

  const handleRotateRightLongPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Long press: toggle auto-rotate right
    if (autoRotateEnabled && autoRotateDirection === 'right') {
      setAutoRotateEnabled(false);
      setAutoRotateDirection(null);
      console.log('[BRUSH] Auto-rotate right disabled');
    } else {
      setAutoRotateEnabled(true);
      setAutoRotateDirection('right');
      console.log('[BRUSH] Auto-rotate right enabled');
    }
    extendBrushOptionsTimer();
  }, [autoRotateEnabled, autoRotateDirection, extendBrushOptionsTimer]);

  const handleRecentEmojiPress = useCallback(async (emoji: string) => {
    void Haptics.selectionAsync();
    if (isCustomBrushReference(emoji)) {
      try {
        await getCustomBrushPNGData(emoji);
      } catch (error) {
        console.warn('[Brush] Failed to preload custom brush:', error);
      }
    }
    dispatch({ type: 'SET_BRUSH_EMOJI', emoji });
    extendBrushOptionsTimer();
  }, [dispatch, extendBrushOptionsTimer]);

  // Preload all custom brush PNGs into cache once on mount
  useEffect(() => {
    let cancelled = false;
    const preload = async () => {
      try {
        const brushes = await getCustomBrushes();
        for (const brush of brushes) {
          if (cancelled) return;
          if (brush.brushPngId && isCustomBrushReference(brush.brushPngId)) {
            await getCustomBrushPNGData(brush.brushPngId);
          }
        }
      } catch (error) {
        console.warn('[Brush] Failed to preload custom brushes:', error);
      }
    };
    void preload();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClearConfirmed = useCallback(async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    // IMPORTANT: First clear uncommitted emoji planes from placer tool
    // This ensures the scene is completely empty before clearing strokes
    if (emojiPlanes.length > 0) {
      console.log(`[PAINT SCREEN] Clearing ${emojiPlanes.length} uncommitted emoji planes before clearing canvas`);
      emojiPlanes.forEach(plane => {
        dispatch({ type: 'DELETE_EMOJI_PLANE', planeId: plane.id });
      });
    }

    // Now clear all strokes
    dispatch({ type: 'CLEAR_STROKES' });
    lastPointRef.current = null;
    clearBrushPreviewTimeout();
    setBrushPreviewStroke(null);
    // Clear video editor session when canvas is cleared
    void clearActiveSession();
    // Clear frame animation session data
    try {
      await AsyncStorage.removeItem('@frame_animation_data');
      console.log('[Frame Mode] Cleared persisted animation data on canvas clear');
    } catch (error) {
      console.error('[Frame Mode] Failed to clear animation data:', error);
    }
    setShowClearConfirm(false);
    setStrokesClearProgress(0); // Reset for next time
  }, [clearBrushPreviewTimeout, dispatch, clearActiveSession, emojiPlanes]);

  // Resume modal handlers
  const handleResumeSession = useCallback(async () => {
    console.log('[PaintScreen] User chose to resume session');

    // Restore painting state from autosave data (includes frame mode restoration)
    if (resumeAutosaveData?.painting) {
      console.log('[PaintScreen] Restoring painting state:', resumeAutosaveData.painting.strokes.length, 'strokes', resumeAutosaveData.painting.frames?.length || 0, 'frames');
      restorePaintingState(resumeAutosaveData.painting);
      // Note: Frame mode is already restored inside restorePaintingState, no need to call toggleFrameMode
    }

    // Restore framer frames from autosave
    if (resumeAutosaveData?.framerFrames) {
      try {
        await AsyncStorage.setItem('@emojipaint_framer_project', JSON.stringify(resumeAutosaveData.framerFrames));
        // Set framerInitialData so Framer will load these frames when opened
        setFramerInitialData(resumeAutosaveData.framerFrames);
        console.log('[PaintScreen] Restored framer frames from autosave and set initial data');
      } catch (error) {
        console.error('[PaintScreen] Failed to restore framer frames:', error);
      }
    }

    setShowResumeModal(false);
    setResumeAutosaveData(null);
  }, [resumeAutosaveData, restorePaintingState]);

  const handleStartFresh = useCallback(async () => {
    console.log('[PaintScreen] User chose to start fresh');
    // Preserve the startup-animated (random) brush emoji across the reset, so the brush keeps the emoji
    // picked on the welcome screen instead of snapping back to the default.
    const startupEmoji = brushEmojiRef.current;
    await clearSprintAutosave();
    await clearGeneralAutosave();
    // Clear frame animation session data
    try {
      await AsyncStorage.removeItem('@frame_animation_data');
      console.log('[Frame Mode] Cleared persisted animation data on start fresh');
    } catch (error) {
      console.error('[Frame Mode] Failed to clear animation data:', error);
    }
    // Clear framer project data
    try {
      await AsyncStorage.removeItem('@emojipaint_framer_project');
      // Clear framerInitialData so Framer opens empty
      setFramerInitialData(null);
      framerPersistentDataRef.current = null; // Clear persistent ref
    } catch (error) {
      console.error('[Framer] Failed to clear framer project:', error);
    }
    dispatch({ type: 'RESET' });
    // Re-apply the welcome-screen picked emoji (RESET reverts brush to the default).
    if (startupEmoji && startupEmoji !== '😀') {
      dispatch({ type: 'SET_BRUSH_EMOJI', emoji: startupEmoji });
    }

    // Clear frame mode state
    setFrameMode(false);
    setFrames([]);
    setCurrentFrameIndex(0);
    setFrameHistory([]);
    setFrameHistoryIndex(-1);
    setIsPlayingFrames(false);
    frameCacheRef.current.clear();

    setActiveChallenge(null);
    setChallengeRemainingMs(0);
    setChallengeStrokeCount(0);
    setShowResumeModal(false);
    setResumeAutosaveData(null);

    console.log('[PaintScreen] All state cleared - starting fresh');
  }, [dispatch]);


  const handleRateApp = useCallback(async () => {
    const appStoreReviewUrl = 'itms-apps://itunes.apple.com/app/id6753342820?action=write-review';
    const appStoreWebReviewUrl = 'https://apps.apple.com/de/app/emoji-painter/id6753342820?action=write-review';
    try {
      void Haptics.selectionAsync();
      // Opening the product page is deterministic in a Metro/dev build and
      // lets the user submit the real star rating and written review. The
      // native StoreKit sheet remains the fallback when App Store is absent.
      try {
        await Linking.openURL(appStoreReviewUrl);
        await markUserRated();
        console.log('[PaintScreen] Opened App Store review page');
        return;
      } catch (storeError) {
        console.warn('[PaintScreen] App Store review URL unavailable:', storeError);
      }

      const available = await StoreReview.isAvailableAsync();
      if (available) {
        await StoreReview.requestReview();
        await markUserRated();
        console.log('[PaintScreen] Opened native StoreKit review sheet');
        return;
      }

      if (await Linking.canOpenURL(appStoreWebReviewUrl)) {
        await Linking.openURL(appStoreWebReviewUrl);
        await markUserRated();
        return;
      }

      CustomOverlayHelper.alert('Rating', 'The App Store is not available on this device');
    } catch (error) {
      console.error('[PaintScreen] Error requesting review:', error);
      CustomOverlayHelper.alert('Error', 'Could not open rating dialog');
    }
  }, []);

  const handleVideoEditor = useCallback(() => {
    void Haptics.selectionAsync();
    setInfoVisible(false);
    console.log('[PaintScreen] Opening Video Editor from info overlay');
    navigation.navigate('VideoEditor' as any);
  }, [setInfoVisible, navigation]);

  const openPrivateStudio = useCallback(() => {
    if (infoVisible) {
      setInfoVisible(false);
    }
    if (leaderboard.leaderboardVisible) {
      closeLeaderboard();
    }
    void (async () => {
      try {
        const currentDeviceId = deviceId ?? await ensureDeviceId();
        console.log('[Profile] Opening ProfilePage from profile button:', currentDeviceId);
        navigation.navigate('ProfilePage', { deviceId: currentDeviceId });
      } catch (error) {
        console.warn('[Profile] Direct profile open failed:', error);
        CustomOverlayHelper.alert('Profile', 'Could not open your profile page.');
      }
    })();
  }, [closeLeaderboard, deviceId, ensureDeviceId, infoVisible, leaderboard.leaderboardVisible, navigation]);
  // Bind late callback for onboarding hook (declared before this callback due to hook ordering)
  onboardingLateCallbacksRef.current.openPrivateStudio = openPrivateStudio;

  // Internal function to handle actual workspace setup
  const setupPrivateStudioWorkspace = useCallback(() => {
    if (privateStudioAutosaveTimeoutRef.current) {
      clearTimeout(privateStudioAutosaveTimeoutRef.current);
      privateStudioAutosaveTimeoutRef.current = null;
    }
    privateStudioRandomUsedRef.current = false;

    // Only backup main workspace if we don't already have a backup
    // This prevents overwriting the backup when reopening profile studio
    if (!mainPaintingBackupRef.current) {
      const snapshot = takePaintingSnapshot();
      mainPaintingBackupRef.current = snapshot;
      console.log('[Profile] Backed up main workspace with', snapshot.strokes.length, 'strokes');
    } else {
      console.log('[Profile] Using existing main workspace backup');
    }

    // Preserve current brush emoji to avoid loading random/old emoji
    const currentBrushEmoji = mainPaintingBackupRef.current?.brushEmoji || brushEmoji;
    privateStudioActiveRef.current = true;
    setSnapshotsSuspended(true);
    // Save main workspace zoom state before resetting, so we can restore it on exit
    if (!mainCanvasZoomBackupRef.current) {
      mainCanvasZoomBackupRef.current = {
        scale: canvasScale.value,
        translateX: canvasTranslateX.value,
        translateY: canvasTranslateY.value
      };
    }
    // Reset canvas zoom/pan for profile studio - inherited zoom breaks painting
    canvasScale.value = 1;
    canvasTranslateX.value = 0;
    canvasTranslateY.value = 0;
    mainCanvasTransformRef.current = { scale: 1, translateX: 0, translateY: 0 };
    privateStudioElapsedBaseRef.current = 0;
    setPrivateStudioError(null);
    setPrivateStudioStatusMessage(null);
    setPrivateStudioLoading(true);
    setPrivateStudioLeaderboardVisible(false);
    clearPrivateStudioTipTimers();
    setPrivateStudioTipVisible(false);
    setPrivateStudioTipText('');
    privateStudioTipScale.setValue(0);
    clearPrivateStudioTypewriter();
    // DON'T set visible yet - wait until strokes are loaded!

    // NOTE: Passport snapshots (upload history) are NOT loaded when entering edit mode
    // They are only shown in the profile overlay (view mode) for fast loading
    // This prevents showing old uploaded profiles when user is editing current profile
    console.log('[Profile] Entering edit mode - upload history will not be shown');

    void (async () => {
      // Fallback for when stroke data is missing (e.g. after a server profile
      // restore, which only brings back the rendered passport image, never the
      // strokes): show the latest passport image as the canvas background so
      // the user always sees their current profile and can paint over it.
      // The background is included in the ViewShot capture on close/upload.
      const applyPortraitBackgroundFallback = async (): Promise<boolean> => {
        try {
          let portrait = await AsyncStorage.getItem(PASSPORT_PORTRAIT_STORAGE_KEY);
          if (!portrait || portrait.trim().length === 0) {
            const snapshots = await loadPassportSnapshots();
            portrait = snapshots.length > 0 ? snapshots[snapshots.length - 1].imageDataUrl : null;
          }
          if (!portrait || portrait.trim().length === 0) {
            return false;
          }
          console.log('[Profile] 🖼️ No strokes available — using latest passport image as canvas background');
          dispatch({
            type: 'SET_TRACE',
            trace: { imageUri: portrait, scale: 1, offsetX: 0, offsetY: 0, rotation: 0, opacity: 1, isBackground: true }
          });
          return true;
        } catch (error) {
          console.warn('[Profile] Portrait background fallback failed:', error);
          return false;
        }
      };

      try {
        console.log('[Profile] 📂 Loading profile workspace from AsyncStorage...');
        const stored = await AsyncStorage.getItem(PRIVATE_STUDIO_STORAGE_KEY);
        if (stored) {
          console.log('[Profile] ✅ Found saved profile workspace data');
          const parsed = JSON.parse(stored) as PrivateStudioPersistedState;
          const baseElapsed = Math.max(0, Math.floor(Number(parsed.elapsedMs) || 0));
          privateStudioElapsedBaseRef.current = baseElapsed;
          const persistedName = parsed.name?.trim() ?? '';
          setPrivateStudioName(persistedName.slice(0, PRIVATE_STUDIO_NAME_MAX));
          privateStudioAutoNameAssignedRef.current = true;
          setPrivateStudioStrokeCount(parsed.strokeCount ?? parsed.painting.strokes.length);
          setPrivateStudioElapsedMs(baseElapsed);

          // Load Private Studio state into context so toolbar/gestures work
          console.log('[Profile] 📥 Restoring painting with', parsed.painting?.strokes?.length || 0, 'strokes');
          console.log('[Profile] Saved data:', {
            name: parsed.name,
            elapsedMs: parsed.elapsedMs,
            strokeCount: parsed.strokeCount,
            actualStrokeCount: parsed.painting?.strokes?.length || 0,
            updatedAt: parsed.updatedAt
          });
          restorePaintingState(parsed.painting);
          // Restore current brush emoji (don't use saved emoji from private studio)
          dispatch({ type: 'SET_BRUSH_EMOJI', emoji: currentBrushEmoji });
          console.log('[Profile] ✅ Profile studio loaded successfully with', parsed.painting?.strokes?.length || 0, 'strokes');

          // Saved state can be empty (e.g. wiped by a profile reset) while a
          // synced passport image still exists — fall back to that image.
          const hasStrokes = (parsed.painting?.strokes?.length ?? 0) > 0;
          const hasTraceImage = Boolean(parsed.painting?.trace?.imageUri);
          if (!hasStrokes && !hasTraceImage) {
            await applyPortraitBackgroundFallback();
          }

          // Show workspace ONLY AFTER strokes are loaded
          setPrivateStudioVisible(true);
          console.log('[Profile] ✅ Workspace now visible with loaded strokes');
        } else {
          console.log('[Profile] ⚠️ No saved profile workspace found - starting fresh');
          privateStudioElapsedBaseRef.current = 0;
          const syncedDisplayName = await AsyncStorage.getItem(PROFILE_DISPLAY_NAME_STORAGE_KEY);
          const nextName =
            typeof syncedDisplayName === 'string' && syncedDisplayName.trim().length > 0
              ? syncedDisplayName.trim().slice(0, PRIVATE_STUDIO_NAME_MAX)
              : '';
          setPrivateStudioName(nextName);
          privateStudioAutoNameAssignedRef.current = false;
          setPrivateStudioStrokeCount(0);
          setPrivateStudioElapsedMs(0);

          // Load empty state into context
          restorePaintingState(null);
          // Restore current brush emoji (don't reset to default)
          dispatch({ type: 'SET_BRUSH_EMOJI', emoji: currentBrushEmoji });

          // No local stroke data (typical after server profile restore) —
          // show the latest synced passport image so the user can rework it.
          await applyPortraitBackgroundFallback();

          // Show workspace (empty is fine)
          setPrivateStudioVisible(true);
          console.log('[Profile] ✅ Workspace now visible (empty/fresh)');
        }
      } catch (error) {
        console.error('[Profile] ❌ Profile Studio load failed:', error);
        privateStudioElapsedBaseRef.current = 0;
        setPrivateStudioName(PRIVATE_STUDIO_DEFAULT_NAME_SHORT);
        privateStudioAutoNameAssignedRef.current = false;
        setPrivateStudioStrokeCount(0);
        setPrivateStudioElapsedMs(0);
        setPrivateStudioError('Unable to load Profil Studio data — starting fresh.');

        // Load empty state into context on error
        restorePaintingState(null);
        // Restore current brush emoji even on error
        dispatch({ type: 'SET_BRUSH_EMOJI', emoji: currentBrushEmoji });

        // Even when stored state is corrupt, the synced passport image may
        // still be available — better than a blank canvas.
        await applyPortraitBackgroundFallback();

        // Show workspace even on error (empty is fine)
        setPrivateStudioVisible(true);
        console.log('[Profile] ⚠️ Workspace visible after load error (starting fresh)');
      } finally {
        setPrivateStudioLoading(false);
        startPrivateStudioTimer();
      }
    })();
  }, [clearPrivateStudioTipTimers, clearPrivateStudioTypewriter, dispatch, passportSnapshotsOpacity, privateStudioTipScale, restorePaintingState, setPrivateStudioElapsedMs, setPrivateStudioError, setPrivateStudioLoading, setPrivateStudioName, setPrivateStudioStatusMessage, setPrivateStudioStrokeCount, setSnapshotsSuspended, startPrivateStudioTimer, takePaintingSnapshot]);

  const clearPrivateStudioTransientState = useCallback(() => {
    clearPrivateStudioTypewriter();
    stopPrivateStudioTimer();
    if (privateStudioAutosaveTimeoutRef.current) {
      clearTimeout(privateStudioAutosaveTimeoutRef.current);
      privateStudioAutosaveTimeoutRef.current = null;
    }
    privateStudioRandomUsedRef.current = false;
    privateStudioActiveRef.current = false;
    setPrivateStudioVisible(false);
    setProfileWorkspaceVisible(false);
    setPrivateStudioLeaderboardVisible(false);
    closeProfileLeaderboard();
    clearPrivateStudioTipTimers();
    setPrivateStudioTipVisible(false);
    setPrivateStudioTipText('');
  }, [clearPrivateStudioTipTimers, clearPrivateStudioTypewriter, stopPrivateStudioTimer, closeProfileLeaderboard]);

  const closePrivateStudio = useCallback(() => {
    setPrivateStudioSaving(true);
    clearPrivateStudioTransientState();

    // CRITICAL MEMORY CLEANUP: Clear gallery and leaderboard entries to free ~1GB memory
    console.log('[Memory] Clearing gallery and leaderboard entries on studio close');
    setGalleryEntries([]);
    setGallerySelectedEntry(null);
    setGallerySelectedPassport(null);
    setGalleryVisible(false);
    setGalleryError(null);
    clearLeaderboardCache();

    closeLeaderboard();
    void (async () => {
      try {
        await persistPrivateStudioState();
      } catch (error) {
        console.warn('Profil Studio save on close failed', error);
      } finally {
        setPrivateStudioSaving(false);
        if (mainPaintingBackupRef.current) {
          restorePaintingState(mainPaintingBackupRef.current);
        } else {
          restorePaintingState(null);
        }
        mainPaintingBackupRef.current = null;
        setSnapshotsSuspended(false);
        // Restore main workspace zoom state
        if (mainCanvasZoomBackupRef.current) {
          canvasScale.value = mainCanvasZoomBackupRef.current.scale;
          canvasTranslateX.value = mainCanvasZoomBackupRef.current.translateX;
          canvasTranslateY.value = mainCanvasZoomBackupRef.current.translateY;
          mainCanvasTransformRef.current = { ...mainCanvasZoomBackupRef.current };
          mainCanvasZoomBackupRef.current = null;
        }
      }
    })();
  }, [clearLeaderboardCache, clearPrivateStudioTransientState, closeLeaderboard, persistPrivateStudioState, restorePaintingState, setSnapshotsSuspended]);

  // Profile System Helper Functions
  const formatElapsedTime = useCallback((elapsedMs: number): string => {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return `${totalSeconds}s`;
  }, []);

  const persistProfileDisplayName = useCallback(async (rawName: string) => {
    const trimmedName = rawName.trim();
    const nextName = trimmedName.slice(0, PRIVATE_STUDIO_NAME_MAX);
    setPrivateStudioName(nextName);
    await persistProfileDisplayNameLocally(nextName);

    const savedState = await AsyncStorage.getItem(PRIVATE_STUDIO_STORAGE_KEY);
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        parsed.name = nextName;
        await AsyncStorage.setItem(PRIVATE_STUDIO_STORAGE_KEY, JSON.stringify(parsed));
      } catch (error) {
        console.warn('[Profile] Failed to update persisted profile name:', error);
      }
    }

    // Push name change to server immediately (non-blocking)
    void (async () => {
      try {
        const portrait = await AsyncStorage.getItem(PASSPORT_PORTRAIT_STORAGE_KEY);
        if (!portrait || nextName.length === 0) return;
        const currentId = await ensureDeviceId();
        if (!currentId) return;
        setDeviceId(currentId);
        const { uploadPrivateStudioPassport } = await import('../lib/privateStudio');
        const appVer = Constants?.expoConfig?.version ?? Constants?.manifest?.version ?? 'dev';
        await flushLifetimeActivity();
        const latestLifetimeStats = await getLifetimeStats();
        const lifetimeSeconds = Math.floor(latestLifetimeStats.totalTimeMs / 1000);
        const lifetimeStrokes = latestLifetimeStats.totalStrokes;
        await uploadPrivateStudioPassport({
          name: nextName,
          totalSeconds: lifetimeSeconds,
          totalStrokes: lifetimeStrokes,
          portraitDataUrl: portrait,
          appVersion: appVer,
          coinCount,
        });
        await markServerProfileSynced(currentId);
        console.log('[Profile] Name change pushed to server:', nextName);
      } catch (e) {
        console.warn('[Profile] Failed to push name change to server:', e);
      }
    })();

    scheduleStoredProfileStateSync(0);
    return nextName;
  }, [deviceId, totalTimeMs, totalStrokes, coinCount]);

  const resetLocalProfileState = useCallback(async () => {
    await AsyncStorage.multiRemove([
      PRIVATE_STUDIO_STORAGE_KEY,
      PASSPORT_PORTRAIT_STORAGE_KEY,
      PASSPORT_PORTRAIT_SENT_STORAGE_KEY,
      PRIVATE_STUDIO_RANDOM_LOCK_KEY,
      PROFILE_DISPLAY_NAME_STORAGE_KEY,
    ]);
    await clearSyncedProfileIdentity();
    setPrivateStudioName(PRIVATE_STUDIO_DEFAULT_NAME_SHORT);
    setCurrentPassportImage(null);
    setPassportPortrait(null);
    setPassportSnapshotsFrames([]);
    setPassportSnapshotsCurrentFrame(0);
    setPrivateStudioRandomLocked(false);
    totalStatsRef.current = { totalTimeMs: 0, totalStrokes: 0, coins: 0 };
    setTotalTimeMs(0);
    setTotalStrokes(0);
    setCoinCount(0);
    await resetLifetimeStats();
  }, []);

  const beginFreshProfile = useCallback(async () => {
    await resetLocalProfileState();
    const newDeviceId = await createFreshProfileIdentity();
    setDeviceId(newDeviceId);
    setProfileSyncPromptData(null);
    pendingServerProfilePromptRef.current = null;
    return newDeviceId;
  }, [resetLocalProfileState]);

  const applyServerProfileSnapshot = useCallback(async (snapshot: ServerProfileSnapshot) => {
    await restoreServerProfileLocally(snapshot, {
      passportPortraitStorageKey: PASSPORT_PORTRAIT_STORAGE_KEY,
    });
    setPrivateStudioName(snapshot.name);
    setCurrentPassportImage(snapshot.latestPortrait);
    setPassportPortrait(snapshot.latestPortrait);
    setPassportSnapshotsFrames(snapshot.portraitHistory);
    setPassportSnapshotsCurrentFrame(0);
    let merged = {
      totalTimeMs: snapshot.elapsedMs,
      totalStrokes: snapshot.strokeCount,
      coins: snapshot.coinCount,
    };
    try {
      const raw = await AsyncStorage.getItem(GLOBAL_STATS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GlobalStatsSnapshot>;
        merged = {
          totalTimeMs: Math.max(snapshot.elapsedMs, Number(parsed.totalTimeMs) || 0),
          totalStrokes: Math.max(snapshot.strokeCount, Number(parsed.totalStrokes) || 0),
          coins: Math.max(snapshot.coinCount, Number(parsed.coins) || 0),
        };
      }
    } catch { /* restoreServerProfileLocally already persisted a safe merge */ }
    totalStatsRef.current = merged;
    setTotalTimeMs(merged.totalTimeMs);
    setTotalStrokes(merged.totalStrokes);
    setCoinCount(merged.coins);
    await markServerProfileSynced(snapshot.deviceId);
    setDeviceId(snapshot.deviceId);
  }, [setDeviceId]);

  const runOwnProfileRecoveryCheck = useCallback(async (currentDeviceId: string) => {
    if (!currentDeviceId) return;

    const checkId = Date.now();
    profileSyncCheckRef.current = checkId;

    try {
      const [serverSnapshot, localSyncMarker, localSnapshots, localDisplayName] = await Promise.all([
        fetchServerProfileSnapshot(currentDeviceId),
        getServerProfileSyncMarker(),
        loadPassportSnapshots(),
        AsyncStorage.getItem(PROFILE_DISPLAY_NAME_STORAGE_KEY),
      ]);

      if (profileSyncCheckRef.current !== checkId) return;
      if (!serverSnapshot) { pendingServerProfilePromptRef.current = null; return; }

      const localName = (localDisplayName ?? privateStudioName ?? '').trim();
      const localHasContent = localSnapshots.length > 0 || localName.length > 0;

      // Fresh install: Keychain has old ID but AsyncStorage is completely empty → auto-restore
      if (!localHasContent && !localSyncMarker) {
        await applyServerProfileSnapshot(serverSnapshot);
        return;
      }

      // Local has content for this device — local is authoritative, never overwrite it.
      // runSmartSyncCheck (called alongside this) handles the "server has more" prompt.
      if (localSyncMarker === currentDeviceId || localHasContent) {
        return;
      }

      // Different device ID recovered from Keychain — prompt user to choose.
      // This used to be deferred behind the terms sheet; it is a profile-recovery
      // choice, not a consent question, so it now shows immediately.
      pendingServerProfilePromptRef.current = null;
      setProfileSyncPromptData(serverSnapshot);
    } catch (error) {
      console.warn('[Profile] Recovery check failed:', error);
    }
  }, [applyServerProfileSnapshot, privateStudioName]);

  // Only iOS's own notification permission prompt remains here — the AGB
  // wrapper this used to sit behind is gone (single first-launch gate).
  const requestNotificationsWithTerms = useCallback(async (): Promise<boolean> => {
    const enabled = await notificationService.requestPermissionsAndEnable();
    setNotificationsEnabled(enabled);
    return enabled;
  }, [setNotificationsEnabled]);

  const termsGatedNotificationService = useMemo(() => ({
    ...notificationService,
    requestPermissionsAndEnable: requestNotificationsWithTerms,
  }), [requestNotificationsWithTerms]);

  const handleSyncProfileFromServer = useCallback(async () => {
    const snapshot = profileSyncPromptData;
    if (!snapshot || profileSyncBusy) {
      return;
    }

    setProfileSyncBusy(true);
    try {
      await applyServerProfileSnapshot(snapshot);
      setProfileSyncPromptData(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sync the server profile.';
      CustomOverlayHelper.alert('Sync failed', message);
    } finally {
      setProfileSyncBusy(false);
    }
  }, [applyServerProfileSnapshot, profileSyncBusy, profileSyncPromptData]);

  const handleStartFreshProfile = useCallback(() => {
    if (profileSyncBusy) {
      return;
    }
    CustomOverlayHelper.confirm(
      'Start new profile',
      'This creates a fresh local profile on this device and disconnects it from the previously found server profile.',
      () => {
        void (async () => {
          setProfileSyncBusy(true);
          try {
            await beginFreshProfile();
            setProfileSyncPromptData(null);
          } finally {
            setProfileSyncBusy(false);
          }
        })();
      }
    );
  }, [beginFreshProfile, profileSyncBusy]);

  const handleDeleteProfileFromServer = useCallback(() => {
    if (profileSyncBusy) return;
    CustomOverlayHelper.delete(
      'Delete profile',
      'This removes your local profile data from this device. Your data on the server will remain available for recovery.',
      () => {
        void (async () => {
          setProfileSyncBusy(true);
          try {
            await beginFreshProfile();
            setProfileSyncPromptData(null);
            pendingServerProfilePromptRef.current = null;
          } finally {
            setProfileSyncBusy(false);
          }
        })();
      }
    );
  }, [beginFreshProfile, profileSyncBusy]);

  const overwriteProfileOnServer = useCallback(async () => {
    if (profileSyncBusy) return;
    setProfileSyncBusy(true);
    try {
      const { uploadPrivateStudioPassport } = await import('../lib/privateStudio');
      const appVer = Constants?.expoConfig?.version ?? Constants?.manifest?.version ?? 'dev';
      await flushLifetimeActivity();
      const latestLifetimeStats = await getLifetimeStats();
      const lifetimeSeconds = Math.floor(latestLifetimeStats.totalTimeMs / 1000);
      const lifetimeStrokes = latestLifetimeStats.totalStrokes;
      const portrait = passportPortrait ?? '';
      if (!portrait) {
        CustomOverlayHelper.alert('No Portrait', 'Edit your profile first to capture a portrait image.');
        return;
      }
      await uploadPrivateStudioPassport({
        name: privateStudioName,
        totalSeconds: lifetimeSeconds,
        totalStrokes: lifetimeStrokes,
        portraitDataUrl: portrait,
        appVersion: appVer,
        coinCount
      });
      if (deviceId) await markServerProfileSynced(deviceId);
      profileSyncDoneRef.current = false;
      void refreshLeaderboard();
    } catch (error) {
      console.warn('[Profile] Overwrite upload failed:', error);
      CustomOverlayHelper.alert('Upload Failed', 'Could not upload profile. Please try again.');
    } finally {
      setProfileSyncBusy(false);
    }
  }, [coinCount, passportPortrait, privateStudioName, profileSyncBusy, refreshLeaderboard, totalStrokes, totalTimeMs]);

  // Smart InSync check — runs when profile opens; shows "Sync Now" if server has more data
  const runSmartSyncCheck = useCallback(async (currentDeviceId: string) => {
    setProfileSyncStatus('checking');
    try {
      const snapshot = await fetchServerProfileSnapshot(currentDeviceId);
      if (!snapshot) {
        setProfileSyncStatus(null);
        setProfileSyncServerSnapshot(null);
        return;
      }
      setProfileSyncServerSnapshot(snapshot);
      const localCoins = Math.max(totalStatsRef.current.coins, coinCount);
      const localTime = Math.max(totalStatsRef.current.totalTimeMs, totalTimeMs);
      const serverCoins = snapshot.coinCount ?? 0;
      const serverTime = snapshot.elapsedMs ?? 0;
      // Server is "newer" if it has more coins OR more time than local
      const serverHasMore = serverCoins > localCoins || serverTime > localTime;
      setProfileSyncStatus(serverHasMore ? 'server_newer' : 'insync');
    } catch {
      setProfileSyncStatus(null);
      setProfileSyncServerSnapshot(null);
    }
  }, [coinCount, totalTimeMs]);

  // Apply server snapshot to all local state
  const handleSyncNow = useCallback(async () => {
    const snapshot = profileSyncServerSnapshot;
    if (!snapshot || profileSyncBusy) return;
    setProfileSyncBusy(true);
    try {
      await applyServerProfileSnapshot(snapshot);
      setProfileSyncStatus('insync');
    } catch (error) {
      CustomOverlayHelper.alert('Sync Failed', 'Could not sync profile from server.');
    } finally {
      setProfileSyncBusy(false);
    }
  }, [applyServerProfileSnapshot, profileSyncBusy, profileSyncServerSnapshot]);

  // Profile System Navigation Functions
  const openProfileOverlayForUser = useCallback((userData: any) => {
    // Reworked: visit the new scrollable ProfilePage instead of the old overlay.
    const targetId = userData?.id ?? userData?.deviceId ?? userData?.device_id;
    if (!targetId) return;
    navigation.push('ProfilePage', {
      deviceId: String(targetId),
      name: userData?.name,
      portrait: userData?.imageUrl ?? userData?.portrait ?? null,
      rank: userData?.rank,
    });
  }, [navigation]);

  // Open MY OWN new scrollable profile overview page (cover, bio, edit, diary,
  // followers/following). Closes the legacy overlay first.
  const openOwnProfilePage = useCallback(async () => {
    let id: string | null = deviceId;
    if (!id) {
      try {
        const { ensureDeviceId } = await import('../lib/dailyPaintUpload');
        id = await ensureDeviceId();
      } catch (error) {
        console.warn('[Profile] openOwnProfilePage: failed to get device id', error);
      }
    }
    if (!id) return;
    navigation.push('ProfilePage', { deviceId: String(id) });
  }, [deviceId, navigation]);

  const openGalleryPassportViewer = useCallback((userData: any) => {
    console.log('[Gallery] Opening passport viewer for:', userData.name);
    setGalleryPassportViewerUser(userData);
    setGalleryPassportViewerVisible(true);

    // Animate scale from 0 to 1
    galleryPassportViewerScale.setValue(0);
    RNAnimated.spring(galleryPassportViewerScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true
    }).start();
  }, [galleryPassportViewerScale]);

  const closeGalleryPassportViewer = useCallback(() => {
    console.log('[Gallery] Closing passport viewer');

    // Animate scale back to 0
    RNAnimated.timing(galleryPassportViewerScale, {
      toValue: 0,
      duration: 200,
      easing: RNEasing.in(RNEasing.ease),
      useNativeDriver: true
    }).start(() => {
      setGalleryPassportViewerVisible(false);
      setGalleryPassportViewerUser(null);
    });
  }, [galleryPassportViewerScale]);

  // First visit no longer raises a consent sheet — the workspace opens directly.
  const openProfileWorkspace = useCallback(() => {
    console.log('[Profile] Opening profile workspace');
    // Clear any leaderboard overlay flags so they don't bleed into the workspace modal
    closePrivateStudioLeaderboardOverlay();
    closeProfileLeaderboard();
    setProfileWorkspaceVisible(true);
    setPrivateStudioVisible(true);
    setPrivateStudioLoading(true);
    // Trigger the workspace setup
    setupPrivateStudioWorkspace();
  }, [closePrivateStudioLeaderboardOverlay, closeProfileLeaderboard, setPrivateStudioLoading, setPrivateStudioVisible, setupPrivateStudioWorkspace]);

  useEffect(() => {
    if (profileStudioOpenRequest <= 0) return;
    // Fire EXACTLY once per request. `openProfileWorkspace` is in the deps (its
    // identity changes as studio state updates), so without this guard the effect
    // would re-run and re-open the workspace multiple times for a single request.
    if (profileStudioOpenHandledRef.current === profileStudioOpenRequest) return;
    profileStudioOpenHandledRef.current = profileStudioOpenRequest;
    // No consent read here any more — this used to await hasAcceptedProfileTerms()
    // just to decide between two ways of opening the same workspace.
    openProfileWorkspace();
  }, [openProfileWorkspace, profileStudioOpenRequest]);

  const closeProfileWorkspace = useCallback(() => {
    // Reuse the same upload flow as the Upload button.
    // That keeps "close" and "upload" identical in profile edit mode.
    if (privateStudioUploadInFlight || privateStudioSavingInProgressRef.current) {
      return;
    }
    console.log('[Profile] Close pressed in profile workspace - reusing upload flow');
    void handlePrivateStudioUpload();
  }, [handlePrivateStudioUpload, privateStudioSavingInProgressRef, privateStudioUploadInFlight]);

  const openWorldBrowser = useCallback(async () => {
    // Reworked: open the new standalone WorldPage (search + follow + profiles).
    navigation.navigate('WorldPage');
  }, [navigation]);

  const closeWorldBrowser = useCallback(() => {
    console.log('[Profile] Closing world browser');
    setWorldBrowserVisible(false);
  }, []);

  // closeLeaderboardPreview, closePrivateStudioLeaderboardOverlay, openProfileLeaderboard,
  // closeProfileLeaderboard, ownLeaderboardEntryIds, ownLeaderboardEntryIdSet,
  // handleLeaderboardEntryPress, privateStudioTopEntries — all moved to useLeaderboard hook

  const handleCoinShopAdd = useCallback((amount: number) => {
    const next = coinCount + amount;
    setCoinCount(next);
    totalStatsRef.current = { ...totalStatsRef.current, coins: next };
    void persistGlobalStats({ coins: next });
  }, [coinCount, persistGlobalStats]);

  const handleCoinShopSpend = useCallback((amount: number) => {
    const next = Math.max(0, coinCount - amount);
    setCoinCount(next);
    totalStatsRef.current = { ...totalStatsRef.current, coins: next };
    void persistGlobalStats({ coins: next });
  }, [coinCount, persistGlobalStats]);

  const handleCoinShopClose = useCallback(() => {
    setCoinShopVisible(false);
    consumeReturnToProfile();
  }, [consumeReturnToProfile]);

  const coinStarburst = useMemo(() => {
    if (coinCount <= 0) {
      return '';
    }
    const tier = Math.min(5, Math.floor(coinCount / 5) + 1);
    const glyph = coinCount >= 25 ? '🌟' : coinCount >= 12 ? '✨' : '⭐️';
    return new Array(tier).fill(glyph).join(' ');
  }, [coinCount]);
  const currentCoinLevel = useMemo(() => resolveCoinLevel(coinCount), [coinCount]);
  const nextCoinLevel = useMemo(() => resolveNextCoinLevel(coinCount), [coinCount]);
  const nextLevelRemainingCoins = useMemo(
    () => (nextCoinLevel ? Math.max(0, nextCoinLevel.minCoins - coinCount) : 0),
    [coinCount, nextCoinLevel]
  );
  const celebrationNextLevel = useMemo(
    () => (uploadCelebration ? resolveNextCoinLevel(uploadCelebration.coins) : null),
    [uploadCelebration]
  );
  const celebrationRemainingCoins = useMemo(() => {
    if (!uploadCelebration || !celebrationNextLevel) {
      return 0;
    }
    return Math.max(0, celebrationNextLevel.minCoins - uploadCelebration.coins);
  }, [celebrationNextLevel, uploadCelebration]);

  // challengeConfirmEmojiAnimatedStyle, challengeConfirmEmoji,
  // openChallengeConfirmPreview, closeChallengeConfirmPreview,
  // and emoji-interval cleanup effect → moved to useChallenge

  useEffect(() => {
    const { leaderboardVisible: lbVisible, ownLeaderboardEntryIds: lbOwnIds, leaderboardListRef: lbListRef } = leaderboard;
    if (!lbVisible || leaderboardEntries.length === 0 || lbOwnIds.length === 0) {
      return;
    }
    const ownIds = new Set(lbOwnIds);
    const targetIndex = leaderboardEntries.findIndex((entry) => ownIds.has(entry.id));
    if (targetIndex <= 0) {
      return;
    }
    setTimeout(() => {
      const list = lbListRef.current;
      if (!list) {
        return;
      }
      try {
        list.scrollToIndex({ index: targetIndex, animated: true, viewPosition: 0.2 });
      } catch {
        // ignore
      }
    }, 2000);
  }, [leaderboardEntries, leaderboard.leaderboardVisible, leaderboard.ownLeaderboardEntryIds]);

  // renderLeaderboardItem moved to LeaderboardOverlay component

  // markPromptUploaded → moved to useChallenge

  const resolveDeviceId = useCallback(async (): Promise<string> => {
    if (typeof deviceId === 'string' && deviceId.trim().length > 0) {
      return deviceId.trim();
    }
    const ensuredRaw = await ensureDeviceId();
    const trimmed = typeof ensuredRaw === 'string' ? ensuredRaw.trim() : ensuredRaw;
    setDeviceId(trimmed);
    return trimmed;
  }, [deviceId, setDeviceId]);

  const formatGalleryRunDate = useCallback((timestamp?: number | null) => {
    if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    const ms = toEpochMs(timestamp);
    const date = new Date(ms);
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(date);
    } catch (error) {
      return date.toLocaleDateString();
    }
  }, []);

  const formatGalleryDuration = useCallback((durationSec?: number | null, _topic?: string) => {
    if (durationSec != null && Number.isFinite(durationSec) && durationSec > 0) {
      const totalSec = Math.floor(durationSec);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      if (mins === 0) {
        return `${secs}s`;
      }
      return secs > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${mins} min`;
    }
    return null;
  }, []);

  const getGalleryTravelerName = useCallback((entry: DailyPaintGalleryEntry) => {
    if (typeof entry.passportName === 'string' && entry.passportName.trim().length > 0) {
      return entry.passportName.trim();
    }
    if (typeof entry.deviceId === 'string' && entry.deviceId.trim().length > 0) {
      const normalized = entry.deviceId.trim().toUpperCase();
      return `Traveler ${normalized.slice(0, 6)}`;
    }
    if (typeof entry.passportPortrait === 'string' && entry.passportPortrait.trim().length > 0) {
      return 'Passport traveler';
    }
    return 'Anonymous Painter';
  }, []);

  const createGalleryEntryFromUpload = useCallback(
    (result: DailyPaintUploadResult, fallbackTopic: string): DailyPaintGalleryEntry | null => {
      if (typeof result.imageId !== 'number' || !result.imageUrl) {
        return null;
      }
      const entryPassportName =
        typeof result.passportName === 'string' && result.passportName.trim().length > 0
          ? result.passportName.trim()
          : undefined;
      const entryPassportPortrait =
        typeof result.passportPortrait === 'string' && result.passportPortrait.trim().length > 0
          ? result.passportPortrait.trim()
          : undefined;
      const topic = typeof result.topic === 'string' && result.topic.trim().length > 0
        ? result.topic.trim()
        : fallbackTopic;
      const createdAt = typeof result.createdAt === 'number' ? result.createdAt : Math.floor(Date.now() / 1000);
      const rawDeviceId = typeof result.deviceId === 'string' && result.deviceId.trim().length > 0
        ? result.deviceId.trim()
        : typeof deviceId === 'string' && deviceId.trim().length > 0
          ? deviceId.trim()
          : null;
      // Enrich with own passport data from leaderboard cache if not already present
      const ownLeaderboardEntry = rawDeviceId
        ? leaderboardEntriesRef.current.find(u => {
            const extras = u.extra ?? {};
            const candidates = [u.id, extras['machineId'], extras['machine_id'], extras['deviceId'], extras['device_id']];
            return candidates.some(c => normalizeDeviceId(typeof c === 'string' ? c : undefined) === normalizeDeviceId(rawDeviceId));
          })
        : null;
      const resolvedPassportName = entryPassportName
        ?? (ownLeaderboardEntry?.name && ownLeaderboardEntry.name !== 'Unnamed Passport' ? ownLeaderboardEntry.name : null)
        ?? null;
      const resolvedPassportPortrait = entryPassportPortrait
        ?? (typeof ownLeaderboardEntry?.imageUrl === 'string' && ownLeaderboardEntry.imageUrl.length > 0 ? ownLeaderboardEntry.imageUrl : null)
        ?? null;

      return {
        id: result.imageId,
        imageUrl: result.imageUrl,
        rawUrl: typeof result.rawUrl === 'string' && result.rawUrl.length > 0 ? result.rawUrl : result.imageUrl,
        topic,
        createdAt,
        challengeAt: result.createdAt,
        durationSec: result.dailyTime,
        width: undefined,
        height: undefined,
        upvotes: 0,
        downvotes: 0,
        deviceId: rawDeviceId,
        passportName: resolvedPassportName ?? undefined,
        passportPortrait: resolvedPassportPortrait,
        rank: undefined,
        uploadedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userVote: null,
        isMysteryPaint: result.isMysteryPaint,
        mysteryPaintingId: result.mysteryPaintingId ?? null,
        mysteryTopicText: null, // set after upload by caller when mysteryTopic is known
        isSolved: result.isSolved,
        solverName: result.solverName ?? null,
        totalAttempts: result.totalAttempts,
        machineId: null
      };
    },
    [deviceId]
  );

  const refreshGallery = useCallback(
    async (
      mode: GalleryMode,
      {
        force = false
      }: { force?: boolean }
    ) => {
      setGalleryError(null);

      // Offline mode: show local gallery only
      if (parentalControls.offlineMode) {
        setGalleryLoading(true);
        try {
          await loadOfflineGallery();
        } finally {
          setGalleryLoading(false);
          setGalleryRefreshing(false);
        }
        return;
      }

      if (galleryEntries.length === 0) {
        setGalleryLoading(true);
      } else {
        setGalleryRefreshing(true);
      }
      try {
        const sanitizedDeviceId = typeof deviceId === 'string' && deviceId.trim().length > 0
          ? deviceId.trim()
          : undefined;
        const fetchSort: DailyPaintGallerySort = mode === 'hot' ? 'hot' : 'new';
        console.log(`[Gallery] Refreshing with mode: ${mode}, fetchSort: ${fetchSort} (parallel leaderboard+gallery)`);

        // Fetch leaderboard and gallery in parallel — both must complete before merge
        const [leaderboardResult, entries] = await Promise.all([
          fetchPrivateStudioLeaderboard().catch((err: unknown) => {
            console.log('[Gallery] ⚠️ Leaderboard fetch failed, using cached data:', err instanceof Error ? err.message : 'Unknown error');
            return leaderboardEntriesRef.current;
          }),
          fetchDailyPaintGallery({ sort: fetchSort, limit: GALLERY_FETCH_LIMIT, deviceId: sanitizedDeviceId, force })
        ]);

        let freshLeaderboard: PrivateStudioLeaderboardEntry[] = leaderboardResult ?? leaderboardEntriesRef.current;
        if (freshLeaderboard && freshLeaderboard.length > 0) {
          console.log(`[Gallery] ✅ Fetched ${freshLeaderboard.length} leaderboard entries`);
          leaderboardEntriesRef.current = freshLeaderboard;
        } else {
          freshLeaderboard = leaderboardEntriesRef.current;
        }
        console.log(`[Gallery] Received ${entries.length} entries from API`);
        const trimmedEntries = entries.map((entry) => ({
          ...entry,
          deviceId:
            typeof entry.deviceId === 'string' && entry.deviceId.trim().length > 0
              ? entry.deviceId.trim()
              : entry.deviceId ?? null
        }));
        let enrichedEntries = mergeGalleryWithLeaderboard(trimmedEntries, freshLeaderboard);

        // Filter for personal mode - only show current user's uploads
        if (mode === 'personal' && sanitizedDeviceId) {
          enrichedEntries = enrichedEntries.filter((entry) => entry.deviceId === sanitizedDeviceId);
          console.log(`[Gallery] Personal filter applied: ${enrichedEntries.length} entries match deviceId`);
        }

        // Filter for mystery mode - only show mystery guess posts
        if (mode === 'mystery') {
          enrichedEntries = enrichedEntries.filter((entry) => entry.isMysteryPaint === true);
          console.log(`[Gallery] Mystery filter applied: ${enrichedEntries.length} mystery entries`);
        }

        // Filter for friends mode - only show posts from friends
        if (mode === 'friends' && sanitizedDeviceId) {
          let currentFriendIds = friendsDeviceIds;
          // Always fetch fresh friends list when entering friends mode
          try {
            const { GesserApi: GesserApiModule } = await import('../gesser/api/gesserClient');
            const friendsResponse = await GesserApiModule.listFriends(sanitizedDeviceId);
            const freshIds = new Set<string>(
              friendsResponse.friends
                .map((f) => f.deviceId.trim().toLowerCase())
                .filter((id) => id.length > 0)
            );
            setFriendsDeviceIds(freshIds);
            currentFriendIds = freshIds;
          } catch (err) {
            console.warn('[Gallery] Friends list fetch failed, using cached:', err);
          }
          if (currentFriendIds.size === 0) {
            enrichedEntries = [];
          } else {
            enrichedEntries = enrichedEntries.filter((entry) => {
              const entryDeviceId = typeof entry.deviceId === 'string' ? entry.deviceId.trim().toLowerCase() : '';
              return entryDeviceId.length > 0 && currentFriendIds.has(entryDeviceId);
            });
          }
          console.log(`[Gallery] Friends filter applied: ${enrichedEntries.length} entries from ${currentFriendIds.size} friends`);
        }

        const sortedEntries = sortGalleryEntries(enrichedEntries, mode);
        console.log(`[Gallery] Sorted ${sortedEntries.length} entries. First 3:`, sortedEntries.slice(0, 3).map(e => ({
          id: e.id,
          upvotes: e.upvotes,
          downvotes: e.downvotes,
          score: (e.upvotes ?? 0) - (e.downvotes ?? 0),
          timestamp: e.updatedAt ?? e.uploadedAt
        })));
        setGalleryEntries(sortedEntries);

        // Notify the current device owner when one of their mystery paintings
        // has been solved for the first time (isSolved === true OR solveCount > 0).
        if (sanitizedDeviceId) {
          for (const entry of sortedEntries) {
            if (
              entry.isMysteryPaint &&
              entry.deviceId &&
              entry.deviceId.trim().toLowerCase() === sanitizedDeviceId.toLowerCase() &&
              (entry.isSolved === true || (entry.solveCount ?? 0) > 0)
            ) {
              const paintingKey = entry.mysteryPaintingId ?? entry.id;
              if (paintingKey != null && !notifiedSolvedMysteriesRef.current.has(paintingKey)) {
                notifiedSolvedMysteriesRef.current.add(paintingKey);
                notificationService.notifyMysterySolved().catch(() => {
                  // Ignore — notification failure must not affect gallery
                });
              }
            }
          }
        }

        if (enrichedEntries.length > 0) {
          const latestTimestamp = enrichedEntries.reduce<number | null>((acc, entry) => {
            const candidate = entry.updatedAt ?? entry.uploadedAt ?? null;
            if (!candidate) {
              return acc;
            }
            const parsed = Date.parse(candidate);
            if (Number.isNaN(parsed)) {
              return acc;
            }
            return acc === null || parsed > acc ? parsed : acc;
          }, null);
          setGalleryUpdatedAt(latestTimestamp != null ? new Date(latestTimestamp).toISOString() : new Date().toISOString());
        } else {
          setGalleryUpdatedAt(null);
        }
        galleryLastFetchedRef.current = Date.now();
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Gallery currently unavailable.';
        setGalleryError(message);
        setGalleryUpdatedAt(null);
      } finally {
        setGalleryLoading(false);
        setGalleryRefreshing(false);
      }
    },
    [deviceId, galleryEntries.length, mergeGalleryWithLeaderboard, sortGalleryEntries, fetchPrivateStudioLeaderboard, parentalControls, loadOfflineGallery, friendsDeviceIds]
  );
  // Bind late callback for onboarding hook
  onboardingLateCallbacksRef.current.refreshGallery = refreshGallery;

  const handleGalleryModeChange = useCallback(
    (nextMode: GalleryMode) => {
      if (galleryModeRef.current === nextMode) return;
      setGalleryMode(nextMode);
      galleryModeRef.current = nextMode;
      galleryLastFetchedRef.current = 0;
      galleryNeedsRefreshRef.current = false;
      // Switching to mystery: bust the in-memory cache so solve counts are always fresh
      if (nextMode === 'mystery') {
        invalidateGalleryCache();
      } else {
        setShowOfflineMysteryGallery(false);
      }
      setGalleryEntries([]);
      setGalleryPage(1);
      void refreshGallery(nextMode, { force: true });
    },
    [refreshGallery]
  );

  const openGallery = useCallback(() => {
    if (galleryVisible) {
      return;
    }
    if (parentalControls.enabled && !parentalControls.allowGalleryView) {
      Alert.alert('Gallery Restricted', 'A parent has disabled gallery access.\nOpen Parental Controls to change this.');
      return;
    }
    if (infoVisible) {
      setInfoVisible(false);
    }
    setGalleryVisible(true);
    // Give the gallery time to render the newly uploaded entry before showing
    // the rating prompt. The tracker still decides whether a prompt is due.
    triggerRatingCheck({ delayMs: 3000 });
    setGalleryLanguagePickerVisible(false);
    setGalleryModePickerVisible(false);

    // Mark gallery as visited this session (easter egg: unlocks trace button)
    if (!galleryVisitedThisSession) {
      setGalleryVisitedThisSession(true);
      console.log('[Gallery] Easter egg unlocked: Trace button now available!');
    }

    // Tutorial lesson 3 detection: gallery opened
    if (tutorialActive && tutorialCurrentLesson === 3 && !tutorialGalleryOpenedRef.current) {
      tutorialGalleryOpenedRef.current = true;
      console.log('[Tutorial] Lesson 3: User opened gallery');
      completeTutorialLesson();
    }

    // Pick random layout every time gallery opens
    const randomLayout = galleryLayoutModes[Math.floor(Math.random() * galleryLayoutModes.length)];
    setGalleryLayout(randomLayout);

    const now = Date.now();
    const stale = now - galleryLastFetchedRef.current > GALLERY_STALE_THRESHOLD_MS;
    const shouldForce = galleryNeedsRefreshRef.current || stale || !!galleryError;
    galleryNeedsRefreshRef.current = false;

    // Fetch fresh data on open. Keep cache intact so cached entries show instantly
    // even when server returns 504; force=true bypasses TTL without wiping the cache.
    if (galleryEntries.length === 0) {
      setGalleryLoading(true);
      void refreshGallery(galleryModeRef.current, { force: true });
    } else if (shouldForce) {
      void refreshGallery(galleryModeRef.current, { force: shouldForce });
    }
  }, [galleryEntries.length, galleryError, galleryVisible, infoVisible, refreshGallery, setInfoVisible, tutorialActive, tutorialCurrentLesson, completeTutorialLesson]);
  // Bind late callback for onboarding hook
  onboardingLateCallbacksRef.current.openGallery = openGallery;

  const closeGallery = useCallback(() => {
    if (!galleryVisible) {
      return;
    }
    setGalleryVisible(false);
    setGallerySelectedEntry(null);
    setGalleryPassportEntry(null);
    setGalleryLanguagePickerVisible(false);
    setGalleryModePickerVisible(false);
    // CRITICAL: galleryPassportViewerVisible is rendered OUTSIDE the gallery Modal at zIndex 20000.
    // If the user opened a passport card inside gallery and didn't close it before closing gallery,
    // this overlay stays visible and blocks ALL workspace touches (same bug as profileLeaderboardVisible).
    setGalleryPassportViewerVisible(false);
    setGalleryPassportViewerUser(null);
    galleryPassportViewerScale.setValue(0);
    // If we got here from a profile page, return to it (not the workspace).
    consumeReturnToProfile();
  }, [galleryVisible, setGalleryPassportEntry, galleryPassportViewerScale, consumeReturnToProfile]);

  const openPrivateStudioFromLeaderboard = useCallback(() => {
    if (leaderboard.leaderboardClosing) {
      return;
    }
    leaderboard.closeLeaderboard();
    scheduleOverlaySwap(() => openPrivateStudio());
  }, [leaderboard.closeLeaderboard, leaderboard.leaderboardClosing, openPrivateStudio, scheduleOverlaySwap]);

  const openGalleryFromLeaderboard = useCallback(() => {
    if (leaderboard.leaderboardClosing) {
      return;
    }
    leaderboard.closeLeaderboard();
    scheduleOverlaySwap(() => openGallery());
  }, [leaderboard.closeLeaderboard, leaderboard.leaderboardClosing, openGallery, scheduleOverlaySwap]);

  const openGalleryFromPrivateStudio = useCallback(() => {
    closePrivateStudio();
    scheduleOverlaySwap(() => openGallery());
  }, [closePrivateStudio, openGallery, scheduleOverlaySwap]);

  // openLeaderboardFromPrivateStudio is provided by useLeaderboard hook:
  const openLeaderboardFromPrivateStudio = leaderboard.openLeaderboardFromPrivateStudio;

  const openPrivateStudioFromGallery = useCallback(() => {
    closeGallery();
    scheduleOverlaySwap(() => openPrivateStudio());
  }, [closeGallery, openPrivateStudio, scheduleOverlaySwap]);

  const openLeaderboardFromGallery = useCallback(() => {
    closeGallery();
    scheduleOverlaySwap(() => leaderboard.openLeaderboard());
  }, [closeGallery, leaderboard.openLeaderboard, scheduleOverlaySwap]);

  const openARFromOverlay = useCallback(() => {
    // Clear the returnToProfile redirect BEFORE closing overlays,
    // so closeGallery() doesn't navigate away to ProfilePage.
    returnToProfileRef.current = null;
    closeGallery();
    leaderboard.closeLeaderboard();
    closeInfoPanel();
    // ArModeChooser is a real Modal now — show immediately, no swap delay needed
    setArChooserVisible(true);
  }, [closeGallery, leaderboard.closeLeaderboard, closeInfoPanel]);

  const openArPaintingFromInfo = useCallback(() => {
    returnToProfileRef.current = null;
    closeGallery();
    leaderboard.closeLeaderboard();
    closeInfoPanel();
    setArChooserVisible(false);
    setArPaintingVisible(true);
  }, [closeGallery, leaderboard.closeLeaderboard, closeInfoPanel]);

  const openVectorFromInfo = useCallback(() => {
    returnToProfileRef.current = null;
    closeGallery();
    leaderboard.closeLeaderboard();
    closeInfoPanel();
    setArChooserVisible(false);
    setVectorWorkspaceVisible(true);
  }, [closeGallery, leaderboard.closeLeaderboard, closeInfoPanel]);

  const openMultiPaintFromOverlay = useCallback(() => {
    const emoji = brushEmojiRef.current ?? '🎨';
    AsyncStorage.getItem(PROFILE_DISPLAY_NAME_STORAGE_KEY)
      .then((username) => {
        NativeModules.MultiPainterBridge?.openMultiPainter?.(username ?? '', emoji);
      })
      .catch(() => {
        NativeModules.MultiPainterBridge?.openMultiPainter?.('', emoji);
      });
  }, []);

  const handleGalleryVote = useCallback(
    async (entry: DailyPaintGalleryEntry, direction: DailyPaintGalleryVoteDirection) => {
      if (entry.userVote || galleryVotePending[entry.id]) {
        return;
      }
      // IMMEDIATE haptic and visual feedback
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); // Double tap effect

      // Optimistically update UI immediately for instant feedback
      setGalleryEntries((prev) =>
        prev.map((item) => {
          if (item.id !== entry.id) return item;
          return {
            ...item,
            upvotes: direction === 'up' ? (item.upvotes ?? 0) + 1 : item.upvotes,
            downvotes: direction === 'down' ? (item.downvotes ?? 0) + 1 : item.downvotes,
            userVote: direction // Optimistically mark as voted
          };
        })
      );

      setGalleryVotePending((prev) => ({ ...prev, [entry.id]: true }));
      try {
        const activeDeviceId = await resolveDeviceId();
        const voteResult = await submitDailyPaintGalleryVote({
          imageId: entry.id,
          direction,
          deviceId: activeDeviceId
        });
        const appliedDirection = voteResult.direction ?? direction;
        await setStoredGalleryVote(entry.id, activeDeviceId, appliedDirection);
        mutateCachedGalleryEntry(entry.id, (cached) => {
          if (voteResult.upvotes != null) {
            cached.upvotes = voteResult.upvotes;
          } else if (appliedDirection === 'up') {
            cached.upvotes = (cached.upvotes ?? 0) + 1;
          }
          if (voteResult.downvotes != null) {
            cached.downvotes = voteResult.downvotes;
          } else if (appliedDirection === 'down') {
            cached.downvotes = (cached.downvotes ?? 0) + 1;
          }
        });
        setGalleryEntries((prev) =>
          sortGalleryEntries(
            prev.map((item) => {
            if (item.id !== entry.id) {
              return item;
            }
            const nextUpvotes =
              voteResult.upvotes != null
                ? voteResult.upvotes
                : appliedDirection === 'up'
                  ? (item.upvotes ?? 0) + 1
                  : item.upvotes ?? 0;
            const nextDownvotes =
              voteResult.downvotes != null
                ? voteResult.downvotes
                : appliedDirection === 'down'
                  ? (item.downvotes ?? 0) + 1
                  : item.downvotes ?? 0;
            return {
              ...item,
              userVote: appliedDirection,
              upvotes: nextUpvotes,
              downvotes: nextDownvotes
            };
          }))
        );
        galleryNeedsRefreshRef.current = true;
        // Success haptic - subtle confirmation
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        // REVERT optimistic update on failure
        setGalleryEntries((prev) =>
          prev.map((item) => {
            if (item.id !== entry.id) return item;
            return {
              ...item,
              upvotes: direction === 'up' ? Math.max(0, (item.upvotes ?? 0) - 1) : item.upvotes,
              downvotes: direction === 'down' ? Math.max(0, (item.downvotes ?? 0) - 1) : item.downvotes,
              userVote: undefined // Remove vote mark
            };
          })
        );

        // Failure haptic - distinctive shake pattern
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Vote failed — offline or server error';
        console.error('[Gallery] Vote failed:', message);
        // Show subtle error (don't use Alert to avoid interruption)
      } finally {
        setGalleryVotePending((prev) => {
          const next = { ...prev };
          delete next[entry.id];
          return next;
        });
      }
    },
    [galleryVotePending, resolveDeviceId, setGalleryEntries]
  );

  const resetGalleryViewer = useCallback(() => {
    galleryViewerScale.value = withTiming(1, { duration: 160 });
    galleryViewerBaseScale.value = 1;
  }, [galleryViewerBaseScale, galleryViewerScale]);

  const openGalleryViewer = useCallback(
    (entry: DailyPaintGalleryEntry) => {
      console.log('[Gallery] Opening viewer for entry:', entry.id, 'challengeCompleteVisible:', challengeCompleteVisible);
      setGallerySelectedPassport(null);
      setGallerySelectedEntry(entry);
      galleryViewerScale.value = 1;
      galleryViewerBaseScale.value = 1;

      // Animate modal opening with scale and fade
      galleryViewerModalScale.setValue(0.3);
      galleryViewerModalOpacity.setValue(0);

      console.log('[Gallery] Starting animation, initial opacity:', 0, 'initial scale:', 0.3);

      // Use setTimeout to ensure state updates first
      setTimeout(() => {
        console.log('[Gallery] Running spring animations');
        RNAnimated.parallel([
          RNAnimated.spring(galleryViewerModalScale, {
            toValue: 1,
            tension: 65,
            friction: 9,
            useNativeDriver: true,
          }),
          RNAnimated.timing(galleryViewerModalOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          })
        ]).start(() => {
          console.log('[Gallery] Animations complete, modal should be visible');
        });
      }, 50);
    },
    [galleryViewerBaseScale, galleryViewerScale, galleryViewerModalScale, galleryViewerModalOpacity, challengeCompleteVisible]
  );

  const closeGalleryViewer = useCallback(() => {
    // Animate modal closing with scale and fade
    RNAnimated.parallel([
      RNAnimated.timing(galleryViewerModalScale, {
        toValue: 0.8,
        duration: 150,
        useNativeDriver: true,
      }),
      RNAnimated.timing(galleryViewerModalOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      })
    ]).start(() => {
      setGallerySelectedEntry(null);
      setGallerySelectedPassport(null);
      galleryViewerScale.value = 1;
      galleryViewerBaseScale.value = 1;
    });
  }, [galleryViewerBaseScale, galleryViewerScale, galleryViewerModalScale, galleryViewerModalOpacity]);

  // loadWelcomeVideoQueue, handleWelcomeVideoEnd, handleWelcomeVideoTap
  // — all moved to useOnboarding hook; destructured above.

  // Tutorial blink animation, tutorial lesson detection (0-5), welcome language detection,
  // fly-in animations, 30s video rotation, typewriter effect, loadTutorialVideo,
  // handleWelcomeTutorial, completeTutorialLesson, triggerLessonCompletionRef —
  // all moved to useOnboarding hook; destructured above.

  // ── Face Filter mode (workspace clone, Private Studio pattern) ────────────
  const loadFaceTemplateTrace = useCallback(async (template: 'mask' | 'trackers') => {
    // Prefer the EXACT ARKit UV template if it was generated on this device
    // (Face Filter settings → Generate Exact Mesh Template). The bundled
    // Spark AR templates have a slightly different UV layout.
    let imageUri: string | null = null;
    try {
      const generated = `${FileSystem.documentDirectory}arkit_face_uv_template.png`;
      const info = await FileSystem.getInfoAsync(generated);
      if (info.exists) {
        imageUri = generated;
      }
    } catch {
      // fall through to bundled templates
    }
    if (!imageUri) {
      const moduleRef = template === 'mask'
        ? require('../../assets/face/faceMeshMask.png')
        : require('../../assets/face/faceMeshTrackers.png');
      const asset = Asset.fromModule(moduleRef);
      await asset.downloadAsync();
      imageUri = asset.localUri ?? asset.uri;
    }
    dispatch({
      type: 'SET_TRACE',
      trace: {
        imageUri,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        opacity: 1,
        isBackground: true
      }
    });
  }, [dispatch]);

  const enterFaceFilterMode = useCallback(async () => {
    console.log('[FaceFilter] Entering face filter mode');
    setArChooserVisible(false);
    // Back up the main painting + zoom exactly like Private Studio does
    if (!mainPaintingBackupRef.current) {
      mainPaintingBackupRef.current = takePaintingSnapshot();
    }
    if (!mainCanvasZoomBackupRef.current) {
      mainCanvasZoomBackupRef.current = {
        scale: canvasScale.value,
        translateX: canvasTranslateX.value,
        translateY: canvasTranslateY.value
      };
    }
    canvasScale.value = 1;
    canvasTranslateX.value = 0;
    canvasTranslateY.value = 0;
    mainCanvasTransformRef.current = { scale: 1, translateX: 0, translateY: 0 };
    faceFilterActiveRef.current = true;
    setFaceFilterModeActive(true);
    // Restore the face filter's OWN painting (separate from the main canvas)
    restorePaintingState(faceFilterPaintingRef.current);
    dispatch({ type: 'SET_BRUSH_EMOJI', emoji: brushEmoji });
    try {
      await loadFaceTemplateTrace(faceFilterTemplate);
    } catch (error) {
      console.warn('[FaceFilter] Template load failed:', error);
    }
  }, [brushEmoji, canvasScale, canvasTranslateX, canvasTranslateY, dispatch, faceFilterTemplate, loadFaceTemplateTrace, restorePaintingState, takePaintingSnapshot]);

  const exitFaceFilterMode = useCallback(() => {
    console.log('[FaceFilter] Exiting face filter mode');
    // Persist the face painting so it's still there next time
    if (faceFilterActiveRef.current) {
      faceFilterPaintingRef.current = takePaintingSnapshot();
    }
    faceFilterActiveRef.current = false;
    setFaceFilterModeActive(false);
    setFaceFilterOverlayVisible(false);
    if (mainPaintingBackupRef.current) {
      restorePaintingState(mainPaintingBackupRef.current);
    } else {
      restorePaintingState(null);
    }
    mainPaintingBackupRef.current = null;
    if (mainCanvasZoomBackupRef.current) {
      canvasScale.value = mainCanvasZoomBackupRef.current.scale;
      canvasTranslateX.value = mainCanvasZoomBackupRef.current.translateX;
      canvasTranslateY.value = mainCanvasZoomBackupRef.current.translateY;
      mainCanvasTransformRef.current = { ...mainCanvasZoomBackupRef.current };
      mainCanvasZoomBackupRef.current = null;
    }
  }, [canvasScale, canvasTranslateX, canvasTranslateY, restorePaintingState, takePaintingSnapshot]);

  // Capture the painted canvas as the face texture (1024² tmp PNG).
  // The template backdrop is hidden during capture so ONLY the painted
  // strokes end up on the face — the template is a guide, not part of the mask.
  const captureFaceFilterTexture = useCallback(async (): Promise<string | null> => {
    // Only the face-mode canvas may become the mask texture. If the main
    // workspace is showing, return the last face texture untouched.
    if (!faceFilterActiveRef.current) {
      return faceFilterTexturePath;
    }
    const traceBackup = trace.imageUri
      ? { ...trace }
      : null;
    try {
      // Hide the template AND switch the canvas backdrop to transparent so the
      // exported PNG contains ONLY the painted strokes (alpha everywhere else)
      setFaceFilterCapturing(true);
      if (traceBackup) {
        dispatch({ type: 'SET_TRACE', trace: { ...traceBackup, opacity: 0 } });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
      const path = await capturePreviewImage({ result: 'tmpfile', width: 1024, height: 1024 });
      if (!path) return null;
      setFaceFilterTexturePath(path);
      return path;
    } finally {
      setFaceFilterCapturing(false);
      if (traceBackup) {
        dispatch({ type: 'SET_TRACE', trace: traceBackup });
      }
    }
  }, [capturePreviewImage, dispatch, trace, faceFilterTexturePath]);

  const openFaceFilterOverlay = useCallback(async () => {
    const path = await captureFaceFilterTexture();
    if (!path) {
      Alert.alert('Capture failed', 'Could not capture your painting. Please try again.');
      return;
    }
    setFaceFilterOverlayVisible(true);
  }, [captureFaceFilterTexture]);

  // Save the face-mask painting into the unified project library (🗂️ Projects)
  const handleSaveFaceMaskProject = useCallback(async () => {
    try {
      // Use the face workspace painting (active = current, else last saved snapshot)
      const snapshot = faceFilterActiveRef.current
        ? takePaintingSnapshot()
        : faceFilterPaintingRef.current;
      const maskStrokes = snapshot?.strokes ?? [];
      const payload = createProjectPayload({
        strokes: maskStrokes as any,
        trace: snapshot?.trace ?? { imageUri: null, scale: 1, offsetX: 0, offsetY: 0, rotation: 0, opacity: 1, isBackground: true },
        brushEmoji: snapshot?.brushEmoji ?? brushEmoji,
        brushSize: snapshot?.brushSize ?? brushSize,
        brushOpacity: snapshot?.brushOpacity ?? brushOpacity,
        brushSpacing: snapshot?.brushSpacing ?? brushSpacing,
        brushRotation: snapshot?.brushRotation ?? 0,
        mirrorX: false,
        mirrorY: false,
        recentEmojis: snapshot?.recentEmojis ?? recentEmojis,
      });
      const now = new Date();
      const name = `🎭 Face Mask ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      await saveFaceMaskProject(name, payload, faceFilterTexturePath);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('💾 Mask saved', 'Find it in 🗂️ Projects — loading it reopens the face filter.');
    } catch (error) {
      console.warn('[FaceFilter] Save mask project failed:', error);
      Alert.alert('Save failed', 'Could not save the mask.');
    }
  }, [brushEmoji, brushOpacity, brushSize, brushSpacing, faceFilterTexturePath, recentEmojis, takePaintingSnapshot]);

  const toggleFaceFilterTemplate = useCallback(() => {
    const next = faceFilterTemplate === 'mask' ? 'trackers' : 'mask';
    setFaceFilterTemplate(next);
    void loadFaceTemplateTrace(next).catch((error) =>
      console.warn('[FaceFilter] Template switch failed:', error)
    );
  }, [faceFilterTemplate, loadFaceTemplateTrace]);

  // handleWelcomeProfile, handleWelcomePaint, first-stroke helper effects,
  // handleWelcomeGallery — all moved to useOnboarding hook; destructured above.

  const finalizeChallenge = useCallback(async () => {
    if (!activeChallenge) {
      return;
    }
    // Guard: prevent double-finalization from timer + early upload race condition
    if (challengeCompletionHandledRef.current) {
      return;
    }
    challengeCompletionHandledRef.current = true;
    // RN7: navigate('Paint') would PUSH a duplicate Paint if another screen is
    // on top — popTo returns to this existing instance instead.
    navigation.dispatch(StackActions.popTo('Paint'));
    setEmojiPickerVisible(false);
    closeInfoPanel();
    closeGallery();
    closeGalleryViewer();
    setChallengeConfirmPrompt(null);
    closeChallengeConfirmPreview();
    closeLeaderboard();
    leaderboard.closeLeaderboardPreview();
    setPrivateStudioLeaderboardVisible(false);
    if (privateStudioActiveRef.current) {
      closePrivateStudio();
    } else {
      setPrivateStudioVisible(false);
    }
    setChallengeConfirmEntries(null);
    challengeLastPromptRef.current = activeChallenge.prompt;
    challengeEndedAtRef.current = Date.now();
    setChallengeUploadNotice(null);
    setChallengeUploadLoading(false);
    const meetsMinimumStrokes = challengeStrokeCountRef.current >= MIN_CHALLENGE_STROKES;
    if (!meetsMinimumStrokes) {
      setChallengeSnapshotUri(null);
      setChallengeCaptureLoading(false);
      setChallengeUploadNotice({
        variant: 'error',
        message: `Paint at least ${MIN_CHALLENGE_STROKES} strokes to upload your sprint.`
      });
      setChallengeCompleteVisible(true);
      challengeCompletionHandledRef.current = true;
      void persistChallengeAutosave();
      return;
    }

    const captureTarget = challengeCanvasRef.current ?? viewShotRef.current;
    if (!captureTarget) {
      setChallengeSnapshotUri(null);
      setChallengeCompleteVisible(true);
      challengeCompletionHandledRef.current = true;
      void persistChallengeAutosave();
      return;
    }
    // The upload overlay must NEVER depend on the snapshot finishing. Capturing
    // is async and GPU-backed: if the app is backgrounded mid-await, the promise
    // can hang or reject, the old code's `finally` never ran, and the user was
    // left with an expired timer, no overlay, and a latched guard that also
    // disabled ✕ / upload-early. Show the overlay now; the preview fills in when
    // (or if) the capture lands.
    setChallengeSnapshotUri(null);
    setChallengeCompleteVisible(true);
    void persistChallengeAutosave();
    try {
      setChallengeCaptureLoading(true);
      const captureOptions: CaptureOptions = {
        format: 'png',
        quality: 0.5,
        result: 'tmpfile'
      };
      const ratio = PixelRatio.get();
      let targetWidth = Math.round(canvasSize * ratio);
      let targetHeight = Math.round(canvasSize * CANVAS_RATIO * ratio);
      const maxSide = CHALLENGE_CAPTURE_MAX_SIDE;
      if (targetWidth > maxSide || targetHeight > maxSide) {
        const scale = maxSide / Math.max(targetWidth, targetHeight);
        targetWidth = Math.max(1, Math.round(targetWidth * scale));
        targetHeight = Math.max(1, Math.round(targetHeight * scale));
      }
      captureOptions.width = targetWidth;
      captureOptions.height = targetHeight;
      // Engine-agnostic export: replay strokes through Skia offscreen so the PNG is
      // correct whether the live engine is Metal or Skia (capturing the hidden Metal
      // view via captureRef can yield a blank PNG). Background-trace mode keeps the
      // captureRef path since the bg image lives in the view tree, not in strokes.
      const hasBackgroundImage = trace.isBackground && !!trace.imageUri;
      // Bounded: a capture interrupted by backgrounding can never settle, and an
      // unbounded await here would leave the preview spinner running forever.
      const withTimeout = <T,>(work: Promise<T>): Promise<T | null> =>
        Promise.race([
          work,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), CHALLENGE_CAPTURE_TIMEOUT_MS))
        ]);
      let uri: string | null = null;
      if (!hasBackgroundImage) {
        uri = await withTimeout(renderStrokesToPngFile(layeredForExport(strokes), canvasSize, canvasSize * CANVAS_RATIO, '#000000'));
      }
      if (!uri) {
        uri = await withTimeout(captureRef(captureTarget, captureOptions));
      }
      setChallengeSnapshotUri(uri ?? null);
    } catch (error) {
      console.error('Challenge snapshot failed', error);
      setChallengeSnapshotUri(null);
    } finally {
      setChallengeCaptureLoading(false);
    }
  }, [
    activeChallenge,
    closeChallengeConfirmPreview,
    closeGallery,
    closeGalleryViewer,
    closeInfoPanel,
    closeLeaderboard,
    closePrivateStudio,
    navigation,
    persistChallengeAutosave,
    setChallengeConfirmEntries,
    setChallengeConfirmPrompt,
    setChallengeCompleteVisible,
    setChallengeSnapshotUri,
    setChallengeUploadLoading,
    setChallengeUploadNotice,
    setEmojiPickerVisible,
    leaderboard.closeLeaderboardPreview,
    setPrivateStudioLeaderboardVisible,
    setPrivateStudioVisible
  ]);

  // Wire finalizeChallenge into the late-ref so useChallenge's sprint-completion
  // effect can call it (the hook receives a stable wrapper that forwards here).
  useEffect(() => {
    challengeLateRef.current.finalizeChallenge = finalizeChallenge;
    // Also keep finalizeChallengeRef in sync (used by cancel/early-upload handlers)
    if (finalizeChallengeRef) finalizeChallengeRef.current = finalizeChallenge;
  }, [finalizeChallenge]);

  const galleryPinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          galleryViewerBaseScale.value = galleryViewerScale.value;
        })
        .onUpdate((event) => {
          galleryViewerScale.value = Math.min(Math.max(galleryViewerBaseScale.value * event.scale, 0.5), 3);
        }),
    [galleryViewerBaseScale, galleryViewerScale]
  );

  const galleryDoubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          const next = galleryViewerScale.value > 1 ? 1 : 2;
          galleryViewerScale.value = withTiming(next, { duration: 160 });
          galleryViewerBaseScale.value = next;
        }),
    [galleryViewerBaseScale, galleryViewerScale]
  );

  const galleryViewerGesture = useMemo(
    () => Gesture.Simultaneous(galleryPinchGesture, galleryDoubleTapGesture),
    [galleryDoubleTapGesture, galleryPinchGesture]
  );

  const galleryViewerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: galleryViewerScale.value }]
  }));

  useEffect(() => {
    if (!gallerySelectedEntry && !gallerySelectedPassport) {
      return;
    }
    galleryViewerScale.value = 1;
    galleryViewerBaseScale.value = 1;
  }, [gallerySelectedEntry, gallerySelectedPassport, galleryViewerBaseScale, galleryViewerScale]);

  // Keep galleryModeRef in sync. Refresh is handled by openGallery (on open) and
  // handleGalleryModeChange (on mode switch) — no fetch here to avoid double-fetch loops.
  useEffect(() => {
    galleryModeRef.current = galleryMode;
  }, [galleryMode]);


  const renderGalleryEntry = useCallback(
    (item: DailyPaintGalleryEntry, onReady?: () => void) => {
      const voteDisabled = Boolean(item.userVote) || galleryVotePending[item.id] === true;
      const travelerName = getGalleryTravelerName(item);
      const upvotes = item.upvotes ?? 0;
      const downvotes = item.downvotes ?? 0;
      // On iPad: make entries 20% smaller to fit within the 120px side margins
      const baseWidth = Math.max(280, Math.round(screenWidth - 36));
      const cardWidth = IS_IPAD ? Math.round(baseWidth * 0.8) : baseWidth;
      const rawTopic = typeof item.topic === 'string' ? item.topic : '';
      const topicMeta = getTopicMetadata(rawTopic);
      const normalizedOriginalTopic = sanitizeTopicLabel(rawTopic);
      const translatedTopic = sanitizeTopicLabel(
        topicMeta?.translations?.[galleryLanguage] ?? topicMeta?.translations?.en ?? rawTopic
      );
      const displayTopic = translatedTopic.length > 0 ? translatedTopic : normalizedOriginalTopic || 'Untitled';
      // Mystery: masked topic with hidden letters
      // mysteryTopicText is the actual answer (server: gmp.topic_text); item.topic is the daily challenge topic
      const mysteryDisplayTopic = (() => {
        if (!item.isMysteryPaint) return null;
        const answerText = item.mysteryTopicText || item.topic;
        if (!answerText) return null;
        const seed = item.mysteryTopicId ?? 0;
        const { masked } = _maskTopic(answerText, seed);
        return '🎲 ' + _formatMaskedTopic(masked);
      })();
      const showOriginalTopic = Boolean(
        normalizedOriginalTopic.length > 0 && translatedTopic.length > 0 && translatedTopic !== normalizedOriginalTopic
      );
      const runDateLabel = formatGalleryRunDate(item.challengeAt ?? item.createdAt);
      const runDurationLabel = formatGalleryDuration(item.durationSec, item.topic);
      const metaSegments: string[] = [];
      if (runDateLabel) {
        metaSegments.push(runDateLabel);
      }
      if (runDurationLabel) {
        metaSegments.push(`Used time: ${runDurationLabel}`);
      }
      const metaText = metaSegments.join(' · ');
      const accessibilityTopic = displayTopic || normalizedOriginalTopic || 'gallery entry';

      // Determine image URL - use animated frame if available
      const isAnimated = Boolean(item.frameUrls && item.frameCount && item.frameCount > 1);
      const currentFrameIndex = isAnimated ? (galleryAnimatedFrames[item.id] ?? 0) : 0;
      const displayImageUrl = isAnimated && item.frameUrls && item.frameUrls[currentFrameIndex]
        ? item.frameUrls[currentFrameIndex]
        : item.imageUrl;

      // LIST LAYOUT - compact horizontal cards
      if (galleryLayout === 'list') {
        const listIsVideo = displayImageUrl.toLowerCase().match(/\.(mov|mp4|webm)(\?|$)/);
        const listStaticFrame = listIsVideo ? (item.frameUrls?.[0] ?? null) : null;
        const listThumbUrl = listIsVideo ? displayImageUrl : displayImageUrl;
        return (
          <View style={[styles.galleryCard, { width: cardWidth, flexDirection: 'row', padding: 12, minHeight: 120 }]}>
            <TouchableOpacity
              style={{ width: 100, height: 100, borderRadius: 8, overflow: 'hidden', marginRight: 12 }}
              activeOpacity={0.9}
              onPress={() => openGalleryViewer(item)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Open ${accessibilityTopic}`}
            >
              {listIsVideo
                ? <SmartVideoCard id={`list-${item.id}`} uri={listThumbUrl} frameUri={listStaticFrame} style={{ width: '100%', height: '100%' }} resizeMode="cover" onReady={onReady} />
                : <GalleryThumb uri={listThumbUrl} style={{ width: '100%', height: '100%' }} resizeMode="cover" onReady={onReady} />
              }
            </TouchableOpacity>
            <View style={{ flex: 1, justifyContent: 'space-between' }}>
              <View>
                <Text style={[styles.galleryCardTopic, { fontSize: 14, color: item.isMysteryPaint ? '#0ff' : '#fff' }]}>
                  {mysteryDisplayTopic ?? displayTopic}
                </Text>
                {!item.isMysteryPaint && runDateLabel ? <Text style={[styles.galleryCardMeta, { fontSize: 10 }]}>{runDateLabel}</Text> : null}
                {runDurationLabel ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, marginTop: 1 }}>⏱ {runDurationLabel}</Text> : null}
                <Text style={[styles.galleryCardTraveler, { fontSize: 11, marginTop: 3 }]}>{travelerName}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <TouchableOpacity
                  style={[
                    styles.galleryVoteButton,
                    {
                      paddingHorizontal: 8,
                      paddingVertical: 5,
                      minWidth: 40,
                      backgroundColor: item.userVote === 'up' ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255,255,255,0.05)'
                    },
                    voteDisabled && styles.galleryVoteButtonDisabled
                  ]}
                  onPress={() => handleGalleryVote(item, 'up')}
                  disabled={voteDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Vote up"
                >
                  <Text style={[styles.galleryVoteIcon, { fontSize: 12 }]}>▲ {upvotes}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.galleryVoteButton,
                    {
                      paddingHorizontal: 8,
                      paddingVertical: 5,
                      minWidth: 40,
                      backgroundColor: item.userVote === 'down' ? 'rgba(244, 67, 54, 0.2)' : 'rgba(255,255,255,0.05)'
                    },
                    voteDisabled && styles.galleryVoteButtonDisabled
                  ]}
                  onPress={() => handleGalleryVote(item, 'down')}
                  disabled={voteDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Vote down"
                >
                  <Text style={[styles.galleryVoteIcon, { fontSize: 12 }]}>▼ {downvotes}</Text>
                </TouchableOpacity>
                {item.isMysteryPaint && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <TouchableOpacity
                      style={{ backgroundColor: guessedPaintings.has(item.id) ? '#1a1a1a' : '#0ff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, opacity: guessedPaintings.has(item.id) ? 0.6 : 1 }}
                      onPress={() => handleOpenGuessOverlay(item)}
                      disabled={guessedPaintings.has(item.id)}
                    >
                      <Text style={{ color: guessedPaintings.has(item.id) ? '#555' : '#000', fontSize: 12, fontWeight: '700' }}>
                        {guessedPaintings.has(item.id) ? '✓' : '🔍'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={{ color: item.isSolved ? '#4caf50' : 'rgba(255,255,255,0.35)', fontSize: 11 }}>
                      {item.isSolved ? '✅' : '⬜'} {item.solveCount ?? 0}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        );
      }

      // GRID LAYOUT - small square cards
      if (galleryLayout === 'grid') {
        // iPad: 4 columns, Phone: 2 columns
        const numColumns = IS_IPAD ? 4 : 2;
        const gridCardSize = Math.floor((cardWidth - (numColumns + 1) * 12) / numColumns);
        const gridIsVideo = displayImageUrl.toLowerCase().match(/\.(mov|mp4|webm)(\?|$)/);
        const gridStaticFrame = gridIsVideo ? (item.frameUrls?.[0] ?? null) : null;
        const thumbSize = gridCardSize - 16;
        return (
          <View style={[styles.galleryCard, { width: gridCardSize, padding: 8, margin: 6 }]}>
            <TouchableOpacity
              style={{ width: '100%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}
              activeOpacity={0.9}
              onPress={() => openGalleryViewer(item)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Open ${accessibilityTopic}`}
            >
              {gridIsVideo
                ? <SmartVideoCard id={`grid-${item.id}`} uri={displayImageUrl} frameUri={gridStaticFrame} style={{ width: '100%', height: '100%' }} resizeMode="cover" onReady={onReady} />
                : <GalleryThumb uri={displayImageUrl} style={{ width: '100%', height: '100%' }} resizeMode="cover" onReady={onReady} />
              }
            </TouchableOpacity>
            <Text style={[styles.galleryCardTopic, { fontSize: 11, color: item.isMysteryPaint ? '#0ff' : '#fff' }]} numberOfLines={2}>
              {mysteryDisplayTopic ?? displayTopic}
            </Text>
            <Text style={[styles.galleryCardTraveler, { fontSize: 9 }]} numberOfLines={1}>{travelerName}</Text>
            {runDurationLabel ? <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 8, marginTop: 1 }}>⏱ {runDurationLabel}</Text> : null}
            {item.isMysteryPaint && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: guessedPaintings.has(item.id) ? '#1a1a1a' : 'rgba(0,255,255,0.15)', borderRadius: 6, paddingVertical: 5, alignItems: 'center', borderWidth: 1, borderColor: guessedPaintings.has(item.id) ? '#333' : '#0ff' }}
                  onPress={() => handleOpenGuessOverlay(item)}
                  disabled={guessedPaintings.has(item.id)}
                >
                  <Text style={{ color: guessedPaintings.has(item.id) ? '#555' : '#0ff', fontSize: 10, fontWeight: '700' }}>
                    {guessedPaintings.has(item.id) ? '✓' : '🔍'}
                  </Text>
                </TouchableOpacity>
                <Text style={{ color: item.isSolved ? '#4caf50' : 'rgba(255,255,255,0.35)', fontSize: 10 }}>
                  {item.isSolved ? '✅' : '⬜'}{item.solveCount ?? 0}
                </Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 }}>
              <TouchableOpacity
                style={[
                  styles.galleryVoteButton,
                  {
                    paddingHorizontal: 7,
                    paddingVertical: 4,
                    minWidth: 36,
                    flex: 1,
                    backgroundColor: item.userVote === 'up' ? 'rgba(76, 175, 80, 0.3)' : 'rgba(255,255,255,0.1)'
                  },
                  voteDisabled && styles.galleryVoteButtonDisabled
                ]}
                onPress={() => handleGalleryVote(item, 'up')}
                disabled={voteDisabled}
                accessibilityRole="button"
                accessibilityLabel="Vote up"
              >
                <Text style={[styles.galleryVoteIcon, { fontSize: 11, fontWeight: 'bold', color: item.userVote === 'up' ? '#4CAF50' : '#fff' }]}>
                  ▲ {upvotes}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.galleryVoteButton,
                  {
                    paddingHorizontal: 7,
                    paddingVertical: 4,
                    minWidth: 36,
                    flex: 1,
                    backgroundColor: item.userVote === 'down' ? 'rgba(244, 67, 54, 0.3)' : 'rgba(255,255,255,0.1)'
                  },
                  voteDisabled && styles.galleryVoteButtonDisabled
                ]}
                onPress={() => handleGalleryVote(item, 'down')}
                disabled={voteDisabled}
                accessibilityRole="button"
                accessibilityLabel="Vote down"
              >
                <Text style={[styles.galleryVoteIcon, { fontSize: 11, fontWeight: 'bold', color: item.userVote === 'down' ? '#F44336' : '#fff' }]}>
                  ▼ {downvotes}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }

      // DEFAULT LAYOUT - full cards (existing layout)
      return (
        <View style={[styles.galleryCard, { width: cardWidth }]}>
          <View style={styles.galleryCardHeader}>
            {item.isMysteryPaint ? (
              <>
                <View style={styles.galleryCardTopicRow}>
                  <Text style={styles.galleryCardTopicEmoji}>🎲</Text>
                  <Text style={styles.galleryCardTopic}>
                    {(item.mysteryTopicText || item.topic) ? (
                      (() => {
                        const answerText = item.mysteryTopicText || item.topic;
                        const { masked } = _maskTopic(answerText, item.mysteryTopicId ?? 0);
                        return _formatMaskedTopic(masked);
                      })()
                    ) : (
                      'Mystery Topic'
                    )}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <TouchableOpacity
                    style={[styles.mysteryGuessButton, guessedPaintings.has(item.id) && { opacity: 0.5 }]}
                    onPress={() => handleOpenGuessOverlay(item)}
                    disabled={guessedPaintings.has(item.id)}
                  >
                    <Text style={styles.mysteryGuessButtonText}>
                      {guessedPaintings.has(item.id) ? '✓ Guessed' : '🔍 Guess This!'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={{ color: item.isSolved ? '#4caf50' : 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                    {item.isSolved ? '✅' : '⬜'} {item.solveCount ?? 0}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.galleryCardTopicRow}>
                  {topicMeta?.emoji ? (
                    <Text style={styles.galleryCardTopicEmoji}>{topicMeta.emoji}</Text>
                  ) : null}
                  <Text style={styles.galleryCardTopic}>{displayTopic}</Text>
                </View>
                {showOriginalTopic ? (
                  <Text style={styles.galleryCardTopicOriginal}>{normalizedOriginalTopic}</Text>
                ) : null}
                {metaText ? <Text style={styles.galleryCardMeta}>{metaText}</Text> : null}
              </>
            )}
          </View>
          <TouchableOpacity
            style={styles.galleryCardImageWrapper}
            activeOpacity={0.9}
            onPress={() => openGalleryViewer(item)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Open ${accessibilityTopic}`}
          >
            {displayImageUrl.toLowerCase().match(/\.(mov|mp4|webm)(\?|$)/) ? (
              <SmartVideoCard
                id={`default-${item.id}`}
                uri={displayImageUrl}
                frameUri={item.frameUrls?.[0] ?? null}
                style={styles.galleryCardImage}
                resizeMode="contain"
                onReady={onReady}
              />
            ) : (
              <GalleryThumb uri={displayImageUrl} style={styles.galleryCardImage} resizeMode="contain" onReady={onReady} />
            )}
          </TouchableOpacity>
          <View style={styles.galleryCardFooter}>
            <View style={styles.galleryCardFooterLeft}>
              <Text style={styles.galleryCardTraveler}>{travelerName}</Text>
              <View style={styles.galleryCardVotesRow}>
                <TouchableOpacity
                  style={[
                    styles.galleryVoteButton,
                    item.userVote === 'up' && styles.galleryVoteButtonActive,
                    voteDisabled && styles.galleryVoteButtonDisabled
                  ]}
                  onPress={() => handleGalleryVote(item, 'up')}
                  disabled={voteDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Vote up"
                >
                  <Text
                    style={[
                      styles.galleryVoteIcon,
                      item.userVote === 'up' && styles.galleryVoteIconActive
                    ]}
                  >
                    ▲
                  </Text>
                </TouchableOpacity>
                <Text style={styles.galleryVoteCountLabel}>{upvotes}</Text>
                <TouchableOpacity
                  style={[
                    styles.galleryVoteButton,
                    item.userVote === 'down' && styles.galleryVoteButtonActive,
                    voteDisabled && styles.galleryVoteButtonDisabled
                  ]}
                  onPress={() => handleGalleryVote(item, 'down')}
                  disabled={voteDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Vote down"
                >
                  <Text
                    style={[
                      styles.galleryVoteIcon,
                      item.userVote === 'down' && styles.galleryVoteIconActive
                    ]}
                  >
                    ▼
                  </Text>
                </TouchableOpacity>
                <Text style={styles.galleryVoteCountLabel}>{downvotes}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.galleryCardPassport, !item.passportPortrait && styles.galleryCardPassportDisabled]}
              onPress={async () => {
                if (item.passportPortrait && item.machineId) {
                  try {
                    // Fetch full user data from leaderboard
                    const { fetchPrivateStudioLeaderboard } = await import('../lib/privateStudio');
                    const users = await fetchPrivateStudioLeaderboard();
                    const userData = users.find(u => u.id === item.machineId);

                    if (userData) {
                      openGalleryPassportViewer(userData);
                    } else {
                      // Fallback: create user data from gallery entry
                      openGalleryPassportViewer({
                        id: item.machineId,
                        name: item.passportName || 'Unknown Traveler',
                        imageUrl: item.passportPortrait,
                        strokeCount: 0,
                        elapsedMs: 0,
                        coinCount: 0
                      });
                    }
                  } catch (error) {
                    console.warn('[Gallery] Failed to fetch user data:', error);
                  }
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={item.passportName ? `View passport for ${item.passportName}` : 'View passport'}
              disabled={!item.passportPortrait}
            >
              {item.passportPortrait ? (
                <GalleryThumb uri={item.passportPortrait} style={styles.galleryCardPassportImage} resizeMode="cover" />
              ) : (
                <View style={styles.galleryCardPassportPlaceholder}>
                  <Text style={styles.galleryCardPassportPlaceholderIcon}>🪪</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [formatGalleryDuration, formatGalleryRunDate, galleryImageLastTapRef, galleryLanguage, galleryVotePending, getGalleryTravelerName, handleGalleryVote, openGalleryViewer, setGalleryPassportEntry, galleryAnimatedFrames, galleryLayout, openGalleryPassportViewer, guessedPaintings, handleOpenGuessOverlay, guessAttempts]
  );

  // Animate gallery frames at 3 FPS — only for default layout (not list/grid which use static thumbs).
  // Slower tick prevents 12x/sec parent re-renders from polluting scroll performance.
  useEffect(() => {
    if (!galleryVisible || galleryEntries.length === 0 || galleryLayout !== 'default') {
      return;
    }

    const animatedEntries = galleryEntries.filter(
      entry => entry.frameUrls && entry.frameCount && entry.frameCount > 1
    );

    if (animatedEntries.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      setGalleryAnimatedFrames(prev => {
        const next = { ...prev };
        let changed = false;
        animatedEntries.forEach(entry => {
          if (!entry.frameUrls || !entry.frameCount) return;
          const currentFrame = prev[entry.id] ?? 0;
          const nextFrame = (currentFrame + 1) % entry.frameCount;
          if (nextFrame !== currentFrame) {
            next[entry.id] = nextFrame;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 333); // 3 FPS — smooth enough for preview, light on main thread

    return () => clearInterval(interval);
  }, [galleryVisible, galleryEntries, galleryLayout]);

  const viewerEntry = gallerySelectedEntry ?? gallerySelectedPassport;
  const viewerMode: 'entry' | 'passport' | null = gallerySelectedEntry ? 'entry' : gallerySelectedPassport ? 'passport' : null;
  const viewerTopicMeta = viewerEntry ? getTopicMetadata(viewerEntry.topic) : null;
  const viewerOriginalTopic = sanitizeTopicLabel(viewerEntry?.topic ?? '');
  const viewerTranslatedTopic = sanitizeTopicLabel(
    viewerTopicMeta?.translations?.[galleryLanguage] ?? viewerEntry?.topic ?? ''
  );
  let viewerTitle = viewerMode === 'passport' ? 'Passport portrait' : 'Untitled';
  let viewerSubtitleLine: string | null = null;
  let viewerSupplementLine: string | null = null;
  if (viewerMode === 'entry' && gallerySelectedEntry) {
    if (gallerySelectedEntry.isMysteryPaint) {
      // Same masking the gallery card already applies (renderGalleryEntry
      // above) — the fullscreen viewer must not fall back to the raw topic,
      // which spoils the mystery answer.
      const answerText = gallerySelectedEntry.mysteryTopicText || gallerySelectedEntry.topic;
      if (answerText) {
        const seed = gallerySelectedEntry.mysteryTopicId ?? 0;
        const { masked } = _maskTopic(answerText, seed);
        viewerTitle = '🎲 ' + _formatMaskedTopic(masked);
      } else {
        viewerTitle = '🎲 Mystery';
      }
      // No subtitle: the original/translated topic string is the mystery
      // answer for these entries, so surfacing it here would spoil it too.
    } else {
      viewerTitle = viewerTranslatedTopic.length > 0 ? viewerTranslatedTopic : viewerOriginalTopic || 'Untitled';
      if (
        viewerOriginalTopic.length > 0 &&
        viewerTranslatedTopic.length > 0 &&
        viewerTranslatedTopic !== viewerOriginalTopic
      ) {
        viewerSubtitleLine = viewerOriginalTopic;
      }
    }
  } else if (viewerMode === 'passport' && gallerySelectedPassport) {
    viewerTitle = gallerySelectedPassport.passportName?.trim().length
      ? gallerySelectedPassport.passportName.trim()
      : 'Passport portrait';
    if (viewerTranslatedTopic.length > 0) {
      viewerSubtitleLine = viewerTranslatedTopic;
    }
    if (
      viewerOriginalTopic.length > 0 &&
      viewerTranslatedTopic.length > 0 &&
      viewerTranslatedTopic !== viewerOriginalTopic
    ) {
      viewerSupplementLine = `Topic: ${viewerOriginalTopic}`;
    } else if (viewerTranslatedTopic.length === 0 && viewerOriginalTopic.length > 0) {
      viewerSubtitleLine = `Topic: ${viewerOriginalTopic}`;
    }
  }
  const viewerTravelerLabel = viewerEntry ? getGalleryTravelerName(viewerEntry) : null;
  const viewerRunDate =
    viewerMode === 'entry' && gallerySelectedEntry
      ? formatGalleryRunDate(gallerySelectedEntry.challengeAt ?? gallerySelectedEntry.createdAt)
      : null;
  const viewerUsedTime =
    viewerMode === 'entry' && gallerySelectedEntry
      ? formatGalleryDuration(gallerySelectedEntry.durationSec, gallerySelectedEntry.topic)
      : null;
  // Determine viewer image URL - use animated frame if available
  const viewerIsAnimated = Boolean(
    viewerMode === 'entry' &&
    gallerySelectedEntry?.frameUrls &&
    gallerySelectedEntry?.frameCount &&
    gallerySelectedEntry.frameCount > 1
  );
  const viewerCurrentFrameIndex = viewerIsAnimated && gallerySelectedEntry
    ? (galleryAnimatedFrames[gallerySelectedEntry.id] ?? 0)
    : 0;
  const viewerImageUri =
    viewerMode === 'entry'
      ? (viewerIsAnimated && gallerySelectedEntry?.frameUrls && gallerySelectedEntry.frameUrls[viewerCurrentFrameIndex]
          ? gallerySelectedEntry.frameUrls[viewerCurrentFrameIndex]
          : gallerySelectedEntry?.imageUrl ?? null)
      : gallerySelectedPassport?.passportPortrait ?? null;
  const passportDetailMeta = galleryPassportEntry ? getTopicMetadata(galleryPassportEntry.topic) : null;
  const passportDetailOriginalTopic = sanitizeTopicLabel(galleryPassportEntry?.topic ?? '');
  const passportTranslatedTopicTrimmed = sanitizeTopicLabel(
    passportDetailMeta?.translations?.[galleryLanguage] ?? passportDetailMeta?.translations?.en ?? galleryPassportEntry?.topic ?? ''
  );
  const passportTranslatedTopic =
    passportTranslatedTopicTrimmed.length > 0 ? passportTranslatedTopicTrimmed : passportDetailOriginalTopic;
  const passportHasOriginalTopic =
    passportDetailOriginalTopic.length > 0 &&
    passportTranslatedTopicTrimmed.length > 0 &&
    passportTranslatedTopicTrimmed !== passportDetailOriginalTopic;
  const passportUsedTime = galleryPassportEntry
    ? formatGalleryDuration(galleryPassportEntry.durationSec, galleryPassportEntry.topic)
    : null;
  const passportUploadedLabel = galleryPassportEntry?.uploadedAt
    ? new Date(galleryPassportEntry.uploadedAt).toLocaleString()
    : null;
  const passportTravelerName = galleryPassportEntry ? getGalleryTravelerName(galleryPassportEntry) : 'Unknown traveler';
  const challengeMinimumStrokesMet = challengeStrokeCount >= MIN_CHALLENGE_STROKES;

  const dismissChallengeComplete = useCallback(async () => {
    await clearSprintAutosave().catch(() => undefined);
    if (challengeAutosaveTimeoutRef.current) {
      clearTimeout(challengeAutosaveTimeoutRef.current);
      challengeAutosaveTimeoutRef.current = null;
    }
    if (challengeSnapshotUri) {
      try {
        await FileSystem.deleteAsync(challengeSnapshotUri, { idempotent: true });
      } catch (error) {
        console.warn('Failed to delete challenge snapshot', error);
      }
    }
    setChallengeSnapshotUri(null);
    setChallengeCompleteVisible(false);
    setActiveChallenge(null);
    setChallengeRemainingMs(0);
    setChallengeUploadNotice(null);
    setChallengeUploadLoading(false);
    challengeStartedAtRef.current = null;
    challengeEndedAtRef.current = null;
    challengeLastPromptRef.current = null;
    challengeCompletionHandledRef.current = false;
    challengeUploadedRef.current = false;
    challengeStrokeCountRef.current = 0;
    setChallengeStrokeCount(0);
    prevChallengeStrokeCountRef.current = strokes.length;
    // Clear mystery challenge state when challenge is fully dismissed
    setMysteryTopic(null);
    setMysteryTopicSelected(false);
    // Clear framer challenge autosave on explicit dismiss
    void clearFramerChallengeAutosave().catch(() => undefined);
  }, [challengeSnapshotUri]);

  // Close the complete overlay but KEEP the challenge alive so user can keep painting
  const resumePaintingFromComplete = useCallback(() => {
    setChallengeCompleteVisible(false);
    setChallengeUploadNotice(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const handleRetryChallenge = useCallback(async () => {
    try {
      await dismissChallengeComplete();
    } finally {
      showRetryHelper();
      promptOverlayDismissedRef.current = false;
      setPromptOverlayDismissed(false);
      setPromptOverlayVisible(true);
    }
  }, [dismissChallengeComplete, showRetryHelper]);

  const openChallengeUpload = useCallback(async () => {
    if (challengeUploadLoading) {
      return;
    }
    if (challengeStrokeCountRef.current < MIN_CHALLENGE_STROKES) {
      const message = `Paint at least ${MIN_CHALLENGE_STROKES} strokes to upload.`;
      setChallengeUploadNotice({ variant: 'error', message });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      return;
    }
    void Haptics.selectionAsync();
    const snapshotUri = challengeSnapshotUri;
    const prompt = challengeLastPromptRef.current ?? activeChallenge?.prompt ?? null;
    if (!snapshotUri) {
      const message = 'No sprint snapshot available to upload yet.';
      setChallengeUploadNotice({ variant: 'error', message });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      CustomOverlayHelper.alert('Upload unavailable', message);
      return;
    }
    if (!prompt) {
      const message = 'Sprint prompt data is missing — please retry the challenge.';
      setChallengeUploadNotice({ variant: 'error', message });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      CustomOverlayHelper.alert('Upload unavailable', message);
      return;
    }

    // Check if user has frames - if so, show modal to choose single or all frames
    if (frames.length > 1) {
      setShowFrameUploadModal(true);
      return;
    }

    // No frames or only 1 frame - proceed with normal upload
    await performUpload(false);
  }, [
    challengeUploadLoading,
    challengeSnapshotUri,
    frames.length
  ]);

  const performUpload = useCallback(async (uploadAllFrames: boolean) => {
    console.log('[performUpload] Starting upload, uploadAllFrames:', uploadAllFrames);
    const snapshotUri = challengeSnapshotUri;
    const prompt = challengeLastPromptRef.current ?? activeChallenge?.prompt ?? null;

    console.log('[performUpload] snapshotUri:', snapshotUri);
    console.log('[performUpload] prompt:', prompt);

    if (!snapshotUri || !prompt) {
      console.error('[performUpload] Missing snapshotUri or prompt, aborting');
      setShowFrameUploadModal(false);
      const message = !snapshotUri
        ? 'No sprint snapshot available. Please try again.'
        : 'Sprint prompt data is missing. Please retry the challenge.';
      setChallengeUploadNotice({ variant: 'error', message });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      CustomOverlayHelper.alert('Upload failed', message);
      return;
    }

    const fallbackDurationMinutes =
      typeof prompt.timeMinutes === 'number' && Number.isFinite(prompt.timeMinutes) ? prompt.timeMinutes : 30;
    const startedAt =
      challengeStartedAtRef.current ?? Date.now() - Math.max(1, fallbackDurationMinutes) * 60 * 1000;
    const endedAt = challengeEndedAtRef.current ?? Date.now();

    setShowFrameUploadModal(false);
    setChallengeUploadLoading(true);
    setChallengeUploadNotice(null);

try {
  // Validate topics are in sync before upload
  const topicsValid = await validateTopicsSync();
  if (!topicsValid) {
    CustomOverlayHelper.alert(
      'Topics Update Required',
      'Your daily topics are out of date. Please check your internet connection and restart the app to download the latest topics before uploading.',
      [{ text: 'OK' }]
    );
    setChallengeUploadLoading(false);
    return;
  }

  // ↓↓↓ Expo-safe resize before upload ↓↓↓
  const resized = await ImageManipulator.manipulateAsync(
    snapshotUri,
    [{ resize: { width: 1024, height: 1024 } }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG }
  );
  const newUri = resized.uri;
  // ↑↑↑ END ADDITION ↑↑↑

  // Handle animation uploads - export as GIF instead of individual frames
  let gifUri: string | undefined = undefined;
  if (uploadAllFrames && frames.length > 1) {
    console.log(`[PaintScreen] Exporting ${frames.length} frames as GIF for upload...`);

    // Capture each frame as an image
    const framePaths: string[] = [];
    try {
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];

        // Engine-agnostic: render this frame's strokes straight to a PNG (no need to
        // mutate live state or capture the hidden Metal view, which can come back blank).
        let frameSnapshot = await renderStrokesToPngFile(
          layeredForExport(frame.strokes),
          canvasSize,
          canvasSize * CANVAS_RATIO,
          '#000000'
        );
        if (!frameSnapshot) {
          // Fallback: drive the live canvas and capture it.
          const originalStrokes = strokes;
          dispatch({ type: 'SET_STROKES', payload: frame.strokes });
          await new Promise(resolve => setTimeout(resolve, 50));
          const captureTarget = challengeCanvasRef.current ?? viewShotRef.current;
          if (!captureTarget) {
            throw new Error('Canvas ref not available for frame capture');
          }
          const ratio = PixelRatio.get();
          frameSnapshot = await captureRef(captureTarget, {
            format: 'png',
            quality: 1,
            width: Math.round(canvasSize * ratio),
            height: Math.round(canvasSize * CANVAS_RATIO * ratio)
          });
          dispatch({ type: 'SET_STROKES', payload: originalStrokes });
        }

        // Resize frame to 512x512
        const resizedFrame = await ImageManipulator.manipulateAsync(
          frameSnapshot,
          [{ resize: { width: 512, height: 512 } }],
          { compress: 0.9, format: ImageManipulator.SaveFormat.PNG }
        );

        framePaths.push(resizedFrame.uri);

        console.log(`[PaintScreen] Captured frame ${i + 1}/${frames.length}`);
      }

      // Export GIF from captured frames
      const tempGifPath = `${FileSystem.cacheDirectory}challenge_${Date.now()}.gif`;
      const delays = Array(framePaths.length).fill(1000 / 12); // 12 fps = ~83ms per frame

      const gifPath = await exportGifFromFrames(
        framePaths,
        delays,
        tempGifPath,
        { width: 512, height: 512, loopCount: 0 }
      );

      gifUri = gifPath;
      console.log(`[PaintScreen] GIF exported successfully: ${gifUri}`);
    } catch (error) {
      console.error('[PaintScreen] Failed to export GIF:', error);
      throw new Error('Failed to export animation as GIF');
    }
  }

  // Actual elapsed time from challenge start to submit (covers early hand-in correctly)
  const actualPaintedMs = endedAt - startedAt;

  // Check if this is a mystery paint upload — use state flag, not string comparison
  const isMysteryUpload = mysteryTopicSelected && mysteryTopic !== null;

  // ── OFFLINE MODE: save locally instead of uploading ──────────────────────
  if (parentalControls.offlineMode) {
    await saveOfflinePainting({
      imageUri: newUri,
      topic: prompt.topic.trim(),
      emoji: prompt.emoji ?? '🎨',
      createdAt: endedAt,
      durationSec: Math.floor((endedAt - startedAt) / 1000),
      isMysteryPaint: isMysteryUpload,
      mysteryTopicText: isMysteryUpload ? (mysteryTopic?.topic ?? null) : null,
    });
    await loadOfflineGallery();
    setChallengeUploadLoading(false);
    setChallengeUploadNotice('📴 Saved to your offline gallery!');
    galleryNeedsRefreshRef.current = true;
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  const passportNameForUpload = await resolveGalleryPassportName(privateStudioName);

  const result = await uploadDailyPaintSprint({
    imageUri: newUri,
    topic: prompt.topic.trim(),
    startedAtMs: startedAt,
    endedAtMs: endedAt,
    challengeAtMs: activeChallenge?.endsAt ?? endedAt,
    deviceId: deviceId ?? undefined,
    actualDurationMs: actualPaintedMs,
    passportName: passportNameForUpload,
    passportPortrait: passportPortrait ?? undefined,
    isMysteryPaint: isMysteryUpload,
    mysteryTopicId: isMysteryUpload ? mysteryTopic?.topicId : undefined,
    mysteryTopicText: isMysteryUpload ? mysteryTopic?.topic : undefined,
    topicI18n: (() => {
      const meta = getTopicMetadata(prompt.topic.trim());
      return meta?.translations ? JSON.stringify(meta.translations) : undefined;
    })()
  });

  console.log('[Gesser Upload] ✅ Server response:', {
    isMysteryPaint: result.isMysteryPaint,
    mysteryPaintingId: result.mysteryPaintingId,
    isSolved: result.isSolved,
    solverName: result.solverName,
    totalAttempts: result.totalAttempts
  });

  // Clear pending mystery topic if this was a mystery upload (prevents penalty)
  if (isMysteryUpload) {
    try {
      await AsyncStorage.removeItem('PENDING_MYSTERY_TOPIC');
      console.log('[Gesser] ✅ Cleared pending mystery topic - no penalty will be applied');
    } catch (error) {
      console.error('[Gesser] ❌ Failed to clear pending mystery topic:', error);
    }
  }

      lastGalleryUploadRef.current = result;
      galleryNeedsRefreshRef.current = true;
      galleryLastFetchedRef.current = 0;

      // Record the milestone, but wait for the gallery to open before asking
      // for a rating. This keeps the prompt out of the upload-success modal.
      await markFirstUpload();
      const rawUploadEntry = createGalleryEntryFromUpload(result, prompt.topic.trim());
      // Force mystery flag locally even if server doesn't echo it back
      const uploadEntry = rawUploadEntry && isMysteryUpload
        ? { ...rawUploadEntry, isMysteryPaint: true, mysteryPaintingId: result.mysteryPaintingId ?? null, mysteryTopicId: mysteryTopic?.topicId ?? 0, mysteryTopicText: mysteryTopic?.topic ?? null }
        : rawUploadEntry;
      if (uploadEntry) {
        primeDailyPaintGalleryCache(uploadEntry, 'new');
        if (galleryMode !== 'hot') {
          setGalleryEntries((prev) => {
            const existingIndex = prev.findIndex((item) => item.id === uploadEntry.id);
            let next: DailyPaintGalleryEntry[];
            if (existingIndex >= 0) {
              next = [...prev];
              const previous = next[existingIndex];
              next[existingIndex] = {
                ...uploadEntry,
                userVote: previous.userVote ?? uploadEntry.userVote
              };
            } else {
              next = [uploadEntry, ...prev];
              if (next.length > GALLERY_FETCH_LIMIT) {
                next.length = GALLERY_FETCH_LIMIT;
              }
            }
            return sortGalleryEntries(next);
          });
        }
      }
      if (result.deviceId) {
        const normalizedResultDeviceId = normalizeDeviceId(result.deviceId) ?? result.deviceId;
        if (normalizedResultDeviceId !== deviceId) {
          setDeviceId(normalizedResultDeviceId);
        }
      }
      void refreshLeaderboard();
      void refreshGallery(galleryModeRef.current, { force: true });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await finishChallengeSession('uploaded');
      markPromptUploaded(prompt);
      awardCoins(1);

      // Mark mystery paint as completed and clear mystery state
      if (isMysteryUpload) {
        const { markMysteryPaintCompleted } = await import('../gesser/utils/storage');
        await markMysteryPaintCompleted();
        await AsyncStorage.removeItem('PENDING_MYSTERY_TOPIC');
        console.log('[Gesser] ✅ Mystery completed and PENDING_MYSTERY_TOPIC cleared');
      }
      // Always clear mystery state after any challenge upload (safety net)
      setMysteryTopic(null);
      setMysteryTopicSelected(false);

      challengeUploadedRef.current = true;
      void persistChallengeAutosave();

      // Background: auto-save project with topic name (fire-and-forget, never blocks upload)
      const _sprintTopic = prompt.topic;
      void (async () => {
        try {
          const safeName = _sprintTopic.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 40) || 'sprint';
          const projectName = `${safeName} — Sprint`;
          const framerState = framerWorkspaceRef.current?.getFramerState?.() ?? undefined;
          const payload = createProjectPayload({
            strokes,
            trace,
            brushEmoji: brushEmojiRef.current,
            brushSize: brushSizeRef.current,
            brushOpacity: brushOpacityRef.current,
            brushSpacing: brushSpacingRef.current,
            brushRotation: brushRotationRef.current,
            mirrorX: mirrorXRef.current,
            mirrorY: mirrorYRef.current,
            recentEmojis,
            preview: snapshotUri ?? null,
            frames: frameModeRef.current ? frames : undefined,
            fps: frameModeRef.current ? exportFps : undefined,
            isAnimation: frameModeRef.current || undefined,
            framerFrames: framerState ?? undefined,
          });
          await saveProjectUnified(projectName, payload, 'workspace');
          console.log(`[PaintScreen] ✅ Sprint project saved: "${projectName}"`);
        } catch (saveErr) {
          console.warn('[PaintScreen] Sprint project auto-save failed (non-critical):', saveErr);
        }
      })();

      await dismissChallengeComplete();
      // Use scheduleOverlaySwap (480ms + InteractionManager) before opening gallery.
      // Without this, the challenge-complete Modal's fade-out and the gallery's
      // slide-in run simultaneously, leaving an invisible Modal blocking all touches.
      scheduleOverlaySwap(() => {
        openGallery();
        CustomOverlayHelper.alert('Upload complete', 'Your sprint is live in the EmojiPainter gallery!\n\n📁 Also auto-saved as a project in your library.');
      });
    } catch (error) {
      let message =
        error instanceof Error && error.message
          ? error.message
          : 'Upload failed — please try again.';
      if (typeof message === 'string' && /file_too_large/i.test(message)) {
        message = 'Upload failed — sprint snapshot was too large. Please try again; captures are now scaled down automatically.';
      }
      console.error('Sprint upload failed', error);
      setChallengeUploadNotice({ variant: 'error', message });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      void persistChallengeAutosave();
      CustomOverlayHelper.alert('Upload failed', message);
    } finally {
      setChallengeUploadLoading(false);
    }
  }, [
    activeChallenge,
    challengeSnapshotUri,
    deviceId,
    dismissChallengeComplete,
    markPromptUploaded,
    persistChallengeAutosave,
    createGalleryEntryFromUpload,
    galleryMode,
    refreshGallery,
    refreshLeaderboard,
    openGallery,
    scheduleOverlaySwap,
    awardCoins,
    frames,
    strokes,
    dispatch,
    trace,
    recentEmojis,
    exportFps,
  ]);

  const startChallenge = useCallback((prompt: DailyPrompt) => {
    const promptKey = formatPrompt(prompt, infoLanguage);
    triggerPromptBounce(promptKey);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    challengeStrokeCountRef.current = 0;
    setChallengeStrokeCount(0);
    prevChallengeStrokeCountRef.current = 0;
    const startedAt = Date.now();
    challengeStartedAtRef.current = startedAt;
    challengeEndedAtRef.current = null;
    challengeLastPromptRef.current = prompt;
    setChallengeUploadNotice(null);
    setChallengeUploadLoading(false);
    const minutes = Number.isFinite(prompt.timeMinutes) ? prompt.timeMinutes : 30;
    const durationMs = Math.max(1, minutes) * 60 * 1000;
    const endsAt = startedAt + durationMs;
    challengeCompletionHandledRef.current = false;
    challengeUploadedRef.current = false;
    timerHasCustomPositionRef.current = false;
    liveStrokeRef.current = null;
    lastPointRef.current = null;
    liveRawPointsRef.current = [];
    liveOutputPointsRef.current = [];
    liveSpacingCarryRef.current = 0;
    liveCurrentSpacingRef.current = brushSpacingRef.current;
    liveSpacingRef.current = null;
    lineStartRef.current = null;
  lineEndRef.current = null;
    multiTouchAbortRef.current = false;
    clearBrushPreviewTimeout();
    setBrushPreviewStroke(null);
    setLiveVersion((prev) => prev + 1);
    dispatch({ type: 'CLEAR_STROKES' });
    // Clear video editor session when starting a new challenge
    void clearActiveSession();
    if (challengeSnapshotUri) {
      void FileSystem.deleteAsync(challengeSnapshotUri, { idempotent: true }).catch((error) => {
        console.warn('Failed to clear previous challenge snapshot', error);
      });
    }
    setChallengeSnapshotUri(null);
    setChallengeCompleteVisible(false);
    setChallengeRemainingMs(durationMs);
    setActiveChallenge({ prompt, endsAt });
    void saveChallengeSession(createChallengeSession(prompt, startedAt));
    startTransition(() => {
      setInfoVisible(false);
    });
  }, [challengeSnapshotUri, clearBrushPreviewTimeout, infoLanguage, setBrushPreviewStroke, startTransition, triggerPromptBounce]);
  // Wire startChallenge into challengeLateRef so useChallenge can call it
  useEffect(() => { challengeLateRef.current.startChallenge = startChallenge; }, [startChallenge]);

  // handleChallengeSelect and other pre-challenge handlers are provided by useChallenge hook (destructured above).
  // handleChallengeSelect, confirmStartChallenge, cancelChallengeConfirm,
  // handleEnableNotifications, handleSkipNotifications, notification-check effect,
  // handleMysteryTopicSelect, handleMysteryTopicPicked,
  // confirmMysteryTopicWarning, cancelMysteryTopicWarning → all moved to useChallenge

  // ── PIN lock for parental-controlled offline→online switch ──────────────────
  const promptForPin = useCallback((onSuccess: () => Promise<void>) => {
    pinLockCallbackRef.current = onSuccess;
    setPinLockValue('');
    setPinLockError('');
    setPinLockVisible(true);
  }, []);

  const handlePinLockConfirm = useCallback(async () => {
    if (pinLockValue.length < 4) { setPinLockError('Enter 4–6 digit PIN'); return; }
    const ok = await validatePin(parentalControls, pinLockValue);
    if (ok) {
      setPinLockVisible(false);
      setPinLockValue('');
      setPinLockError('');
      if (pinLockCallbackRef.current) {
        await pinLockCallbackRef.current();
        pinLockCallbackRef.current = null;
      }
    } else {
      setPinLockError('Wrong PIN');
      setPinLockValue('');
    }
  }, [pinLockValue, parentalControls]);

  const handlePinLockCancel = useCallback(() => {
    setPinLockVisible(false);
    setPinLockValue('');
    setPinLockError('');
    pinLockCallbackRef.current = null;
  }, []);

  // handleShuffleMysteryTopics, cancelMysteryPicker, dice-cooldown effect,
  // handleReloadMysteryTopic, handleCancelMysteryConfirm → moved to useChallenge

  // handleStartMysteryPainting → moved to useChallenge

  // Handle opening guess overlay for a mystery painting
  const handleOpenGuessOverlay = useCallback((painting: DailyPaintGalleryEntry) => {
    // Correct guesses are permanently done
    if (guessedPaintings.has(painting.id)) {
      Alert.alert('Already Solved', 'You already got this one right! 🎉');
      return;
    }
    setSelectedMysteryPainting(painting);
    setGuessInput('');
    setGuessFeedback(null);
    setGuessOverlayVisible(true);
  }, [guessedPaintings]);

  const handleOpenGuessFromInfo = useCallback((painting: DailyPaintGalleryEntry) => {
    // Let the Info modal finish its slide-out before mounting Gallery + Guess.
    // Overlapping native modals can otherwise leave Info visually or interactively on top.
    closeInfoPanel();
    scheduleOverlaySwap(() => {
      openGallery();
      handleOpenGuessOverlay(painting);
    });
  }, [closeInfoPanel, handleOpenGuessOverlay, openGallery, scheduleOverlaySwap]);

  const openTopicSuggestionsFromInfo = useCallback(() => {
    closeInfoPanel();
    scheduleOverlaySwap(() => setGesserTopicVisible(true));
  }, [closeInfoPanel, scheduleOverlaySwap]);

  const triggerWinHaptics = useCallback((durationMs: number) => {
    const styles = [
      Haptics.ImpactFeedbackStyle.Light,
      Haptics.ImpactFeedbackStyle.Medium,
      Haptics.ImpactFeedbackStyle.Heavy,
      Haptics.ImpactFeedbackStyle.Rigid,
      Haptics.ImpactFeedbackStyle.Soft,
    ];
    let t = 0;
    while (t < durationMs) {
      const delay = t;
      setTimeout(() => {
        void Haptics.impactAsync(styles[Math.floor(Math.random() * styles.length)]);
      }, delay);
      t += 60 + Math.floor(Math.random() * 180);
    }
    setTimeout(() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), durationMs);
  }, []);

  const triggerWinAnimation = useCallback((styleIdx: number) => {
    const W = screenWidth;
    const H = screenHeight;
    const cx = W / 2;
    const cy = H / 2;
    guessWinParticles.forEach(p => {
      p.tx.setValue(0); p.ty.setValue(0); p.op.setValue(0); p.sc.setValue(0); p.rot.setValue(0);
    });
    setGuessWinStyleIdx(styleIdx);
    setGuessWinVisible(true);

    const anims = guessWinParticles.map((p, i) => {
      const n = guessWinParticles.length;
      const frac = i / n;
      const rand = () => Math.random();
      let toX = 0, toY = 0, toScale = 1.6, toRot = 0, dur = 1200, delay = 0;

      switch (styleIdx) {
        case 0: { // Gold coins arc upward
          const angle = (-Math.PI * 0.85) + frac * Math.PI * 0.7;
          const dist = 120 + rand() * 200;
          toX = Math.cos(angle) * dist;
          toY = Math.sin(angle) * dist - 60;
          toScale = 0.9 + rand() * 0.8;
          toRot = (rand() - 0.5) * 4;
          dur = 1000 + rand() * 600;
          delay = i * 40;
          break;
        }
        case 1: { // Star explosion radially
          const angle = frac * Math.PI * 2;
          const dist = 150 + rand() * 180;
          toX = Math.cos(angle) * dist;
          toY = Math.sin(angle) * dist;
          toScale = 1.2 + rand() * 1.0;
          toRot = rand() * 6;
          dur = 900 + rand() * 500;
          delay = i * 30;
          break;
        }
        case 2: { // Confetti fall from top
          toX = (rand() - 0.5) * W * 0.9;
          toY = cy + rand() * cy;
          toScale = 0.8 + rand() * 0.6;
          toRot = rand() * 8;
          dur = 1000 + rand() * 800;
          delay = rand() * 300;
          break;
        }
        case 3: { // Party emoji fountain
          const angle = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 0.8;
          const dist = 80 + rand() * 280;
          toX = Math.cos(angle) * dist;
          toY = Math.sin(angle) * dist;
          toScale = 1.0 + rand() * 1.2;
          toRot = (rand() - 0.5) * 6;
          dur = 1100 + rand() * 600;
          delay = i * 35;
          break;
        }
        case 4: { // Sparkle spiral outward
          const angle = frac * Math.PI * 4;
          const dist = 60 + i * 14;
          toX = Math.cos(angle) * dist;
          toY = Math.sin(angle) * dist;
          toScale = 1.4 + rand() * 0.8;
          toRot = rand() * 10;
          dur = 1200 + rand() * 400;
          delay = i * 25;
          break;
        }
        case 5: { // Heart shower from top
          toX = (rand() - 0.5) * W * 0.8;
          toY = cy * 0.6 + rand() * cy;
          toScale = 1.0 + rand() * 0.8;
          toRot = (rand() - 0.5) * 3;
          dur = 1200 + rand() * 600;
          delay = rand() * 400;
          break;
        }
        case 6: { // Electric burst all directions at high speed
          const angle = frac * Math.PI * 2;
          const dist = 100 + rand() * 250;
          toX = Math.cos(angle) * dist;
          toY = Math.sin(angle) * dist;
          toScale = 1.8 + rand() * 1.2;
          toRot = rand() * 12;
          dur = 700 + rand() * 400;
          delay = i * 20;
          break;
        }
      }

      return RNAnimated.sequence([
        RNAnimated.delay(delay),
        RNAnimated.parallel([
          RNAnimated.timing(p.op, { toValue: 1, duration: 120, useNativeDriver: true }),
          RNAnimated.timing(p.sc, { toValue: toScale, duration: dur * 0.4, useNativeDriver: true }),
          RNAnimated.timing(p.tx, { toValue: toX, duration: dur, useNativeDriver: true }),
          RNAnimated.timing(p.ty, { toValue: toY, duration: dur, useNativeDriver: true }),
          RNAnimated.timing(p.rot, { toValue: toRot, duration: dur, useNativeDriver: true }),
          RNAnimated.sequence([
            RNAnimated.delay(dur * 0.5),
            RNAnimated.timing(p.op, { toValue: 0, duration: dur * 0.5, useNativeDriver: true }),
          ]),
        ]),
      ]);
    });

    RNAnimated.parallel(anims).start(() => setGuessWinVisible(false));
    const hapticDur = 1000 + Math.floor(Math.random() * 2000);
    triggerWinHaptics(hapticDur);
  }, [guessWinParticles, triggerWinHaptics]);

  // Handle submitting a guess
  const handleSubmitGuess = useCallback(() => {
    if (!selectedMysteryPainting) return;

    // Topic is always embedded in the post — 100% offline comparison
    const seed = selectedMysteryPainting.mysteryTopicId ?? 0;
    const actualTopic = selectedMysteryPainting.mysteryTopicText || selectedMysteryPainting.topic || '';

    // Reconstruct full topic from blank-fill input + revealed letters
    const { masked } = _maskTopic(actualTopic, seed);
    const maskedChars = Array.from(masked) as string[];
    let bIdx = 0;
    const fullGuess = maskedChars.map(c => (c === '_' ? (guessInput[bIdx++] ?? '') : c)).join('');
    if (bIdx > guessInput.length) return;

    // Increment attempt count for this painting
    setGuessAttempts(prev => ({ ...prev, [selectedMysteryPainting.id]: (prev[selectedMysteryPainting.id] ?? 0) + 1 }));
    const newAttemptCount = (guessAttempts[selectedMysteryPainting.id] ?? 0) + 1;

    // After a correct guess, advance to the next unsolved mystery
    const advanceAfterCorrect = (delay: number) => {
      setTimeout(() => {
        setGuessFeedback(null);
        setGuessInput('');
        const allMystery = galleryEntries.filter(e => e.isMysteryPaint);
        const currentId = selectedMysteryPainting.id;
        const available = allMystery.filter(e => e.id !== currentId && !guessedPaintings.has(e.id));
        const next = available[0] ?? null;
        if (next) {
          setSelectedMysteryPainting(next);
          setTimeout(() => guessInputRef.current?.focus(), 80);
        } else {
          setGuessAllDone(true);
          setTimeout(() => {
            setGuessAllDone(false);
            setGuessOverlayVisible(false);
          }, 2400);
        }
      }, delay);
    };

    setGuessLoading(true);
    setGuessFeedback(null);

    const isCorrect = _topicsMatch(fullGuess, actualTopic);

    if (isCorrect) {
      triggerWinAnimation(Math.floor(Math.random() * 7));
      awardCoins(1);
      setGuessedPaintings(prev => new Set([...prev, selectedMysteryPainting.id]));
      setGuessFeedback({ type: 'success', message: '🎉 Correct! +1 coin!' });
      const newSolveCount = (selectedMysteryPainting.solveCount ?? 0) + 1;
      setGalleryEntries(prev => prev.map(item =>
        item.id === selectedMysteryPainting.id
          ? { ...item, isSolved: true, solverName: 'You', totalAttempts: newAttemptCount, solveCount: newSolveCount }
          : item
      ));
      void persistSolvedState(selectedMysteryPainting.id, newSolveCount, newAttemptCount);
      advanceAfterCorrect(1900);
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setGuessFeedback({ type: 'error', message: '❌ Not quite! Try again…' });
      setGuessInput('');
      setGalleryEntries(prev => prev.map(item =>
        item.id === selectedMysteryPainting.id
          ? { ...item, totalAttempts: newAttemptCount } : item
      ));
      setTimeout(() => {
        setGuessFeedback(null);
        setTimeout(() => guessInputRef.current?.focus(), 80);
      }, 1400);
    }

    setGuessLoading(false);
  }, [selectedMysteryPainting, guessInput, awardCoins, galleryEntries, guessedPaintings, guessAttempts, triggerWinAnimation]);

  // Confirm-dialog fetch + emoji animation effect + entries stagger effect → moved to useChallenge

  const resetChallengeState = useCallback(
    (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        void Haptics.selectionAsync();
      }
    challengeCompletionHandledRef.current = false;
    challengeStartedAtRef.current = null;
    challengeEndedAtRef.current = null;
    challengeLastPromptRef.current = null;
    setChallengeUploadNotice(null);
    setChallengeUploadLoading(false);
    challengeStrokeCountRef.current = 0;
    setChallengeStrokeCount(0);
    prevChallengeStrokeCountRef.current = strokes.length;
    void clearSprintAutosave().catch(() => undefined);
    void clearGeneralAutosave().catch(() => undefined);
    void clearFramerChallengeAutosave().catch(() => undefined);
    if (challengeAutosaveTimeoutRef.current) {
      clearTimeout(challengeAutosaveTimeoutRef.current);
      challengeAutosaveTimeoutRef.current = null;
    }
    if (generalAutosaveTimeoutRef.current) {
      clearTimeout(generalAutosaveTimeoutRef.current);
      generalAutosaveTimeoutRef.current = null;
    }
      const snapshotToDelete = challengeSnapshotUri;
      if (snapshotToDelete) {
        void FileSystem.deleteAsync(snapshotToDelete, { idempotent: true }).catch((error) => {
        console.warn('Failed to delete challenge snapshot', error);
      });
    }
    setChallengeSnapshotUri(null);
    setActiveChallenge(null);
    setChallengeRemainingMs(0);
    setChallengeCompleteVisible(false);
    },
    [challengeSnapshotUri]
  );

  const clearChallenge = useCallback(() => {
    resetChallengeState();
  }, [resetChallengeState]);

  // Challenge cancel dialog handlers
  const showChallengeCancelConfirmation = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowChallengeCancelDialog(true);
  }, []);

  const handleChallengeCancelStop = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setShowChallengeCancelDialog(false);
    void finishChallengeSession('cancelled');
    clearChallenge();
  }, [clearChallenge]);

  const handleChallengeEarlyUpload = useCallback(() => {
    if (!canUploadChallengeEarly(challengeStrokeCountRef.current)) {
      const remaining = getChallengeStrokesRemaining(challengeStrokeCountRef.current);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      CustomOverlayHelper.alert(
        'Keep painting',
        `Paint ${remaining} more emoji stroke${remaining === 1 ? '' : 's'} to unlock early upload. The countdown will keep running.`
      );
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowChallengeCancelDialog(false);
    requestChallengeFinalize();
  }, [requestChallengeFinalize]);

  const handleChallengeContinue = useCallback(() => {
    void Haptics.selectionAsync();
    setShowChallengeCancelDialog(false);
  }, []);

  useEffect(() => {
    brushSizeRef.current = brushSize;
    if (!sizeInputFocused) {
      setSizeInput(String(displayBrushSize));
    }
  }, [brushSize, displayBrushSize, sizeInputFocused]);

  useEffect(() => {
    const unsubscribe = subscribeAutosaveDiscard(() => {
      resetChallengeState({ silent: true });
    });
    return unsubscribe;
  }, [resetChallengeState, subscribeAutosaveDiscard]);

  useEffect(() => {
    brushOpacityRef.current = brushOpacity;
  }, [brushOpacity]);

  useEffect(() => {
    brushModeRef.current = brushMode;
  }, [brushMode]);

  useEffect(() => {
    smudgeSmoothnessRef.current = smudgeSmoothness;
  }, [smudgeSmoothness]);

  const handleSmudgeSmoothnessChange = useCallback((value: number) => {
    dispatch({ type: 'SET_SMUDGE_SMOOTHNESS', value });
  }, [dispatch]);

  // Cycle the paint mode: opaque → transparent → smudge → opaque.
  // The selected emoji still controls the brush shape in smudge mode (its alpha becomes the mask).
  const toggleBrushOpacity = useCallback(() => {
    const next = brushMode === 'opaque' ? 'transparent' : brushMode === 'transparent' ? 'smudge' : 'opaque';
    void Haptics.selectionAsync();
    if (next === 'smudge' && brushSizeRef.current > SMUDGE_MAX_BRUSH_SIZE) {
      setBrushSizeImmediate(SMUDGE_MAX_BRUSH_SIZE);
      setSizeInput(String(SMUDGE_MAX_BRUSH_SIZE));
    }
    dispatch({ type: 'SET_BRUSH_MODE', mode: next });
  }, [brushMode, dispatch, setBrushSizeImmediate]);

  useEffect(() => {
    brushEmojiRef.current = brushEmoji;
  }, [brushEmoji]);

  useEffect(() => {
    brushSpacingRef.current = brushSpacing;
  }, [brushSpacing]);

  useEffect(() => {
    brushRotationRef.current = brushRotation;
  }, [brushRotation]);

  useEffect(() => {
    mirrorXRef.current = mirrorX;
  }, [mirrorX]);

  useEffect(() => {
    mirrorYRef.current = mirrorY;
  }, [mirrorY]);

  useEffect(() => {
    toolModeRef.current = toolMode;
  }, [toolMode]);

  useFocusEffect(
    useCallback(() => {
      return startLifetimeActivity(frameMode ? 'animator' : 'normal');
    }, [frameMode])
  );

  // Restore animation project when returning from ExportScreen
  // USES ATOMIC LOAD to prevent frame leakage
  useFocusEffect(
    useCallback(() => {
      const checkAnimationLoad = async () => {
        try {
          const animationData = await AsyncStorage.getItem('@load_animation_data');
          if (animationData) {
            const { projectId, frames: loadedFrames, selectedFrameIndex, fps: loadedFps } = JSON.parse(animationData);

            // Clear the data so it doesn't restore again
            await AsyncStorage.removeItem('@load_animation_data');

            // Safety check: ensure frames array is valid
            if (!Array.isArray(loadedFrames) || loadedFrames.length === 0) {
              console.warn('[PaintScreen] Animation data has no frames or invalid format, skipping restore');
              return;
            }

            // ATOMIC LOAD - this will reset all previous state
            await loadAnimationProjectAtomic(
              projectId || `temp-${Date.now()}`,
              loadedFrames,
              selectedFrameIndex ?? 0,
              loadedFps || 12
            );
          }
        } catch (error) {
          console.error('[PaintScreen] Failed to restore animation:', error);
          // Clear bad data so it doesn't keep crashing
          try {
            await AsyncStorage.removeItem('@load_animation_data');
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      };

      void checkAnimationLoad();
    }, [loadAnimationProjectAtomic])
  );

  // Load AR-scene / face-mask / Vector projects opened from the project library
  useFocusEffect(
    useCallback(() => {
      const checkArLoad = async () => {
        try {
          const vectorRaw = await AsyncStorage.getItem('@load_vector_project');
          if (vectorRaw) {
            await AsyncStorage.removeItem('@load_vector_project');
            const { projectName, vectorDocument } = JSON.parse(vectorRaw);
            if (vectorDocument?.meta && Array.isArray(vectorDocument?.strokes)) {
              const { replaceVectorDocument } = await import('../vector/vectorDocument');
              await replaceVectorDocument(vectorDocument);
              setVectorProjectName(projectName ?? null);
              setVectorWorkspaceVisible(true);
            }
            return;
          }

          const arSceneRaw = await AsyncStorage.getItem('@load_ar_scene');
          if (arSceneRaw) {
            await AsyncStorage.removeItem('@load_ar_scene');
            const { dir } = JSON.parse(arSceneRaw);
            if (dir) {
              setArPendingSceneDir(dir);
              setArPaintingVisible(true);
            }
            return;
          }

          // The old paint-on-face mask mode was removed (replaced by the
          // selfie → rigged-emoji puppet). Drop any stale hand-off key so a
          // legacy saved mask project doesn't trap the user in a dead mode.
          await AsyncStorage.removeItem('@load_facemask');
        } catch (error) {
          console.warn('[PaintScreen] AR/face project load failed:', error);
        }
      };
      void checkArLoad();
    }, [])
  );

  // Auto-sync frames to AsyncStorage whenever they change (for project saving)
  useEffect(() => {
    const syncFramesToStorage = async () => {
      // Legacy @current_animation_frames system removed
      // Framer now persists state to @framer_persistent_data, which ExportScreen reads
    };

    void syncFramesToStorage();
  }, [frames, exportFps]);

  // Memory warning for high stroke counts
  useEffect(() => {
    const count = strokes.length;
    if (count === STROKE_WARNING_THRESHOLD) {
      console.warn(`[Memory] Stroke count reached warning threshold: ${count}`);
      CustomOverlayHelper.alert(
        'High Stroke Count',
        `You have ${count} strokes. Performance may slow down with many more strokes.`,
        [{ text: 'OK', style: 'default' }]
      );
    } else if (count === STROKE_CRITICAL_THRESHOLD) {
      console.error(`[Memory] Stroke count reached critical threshold: ${count}`);
      CustomOverlayHelper.alert(
        'Critical Stroke Count',
        `You have ${count} strokes. Consider saving your work and starting a new canvas to maintain performance.`,
        [{ text: 'OK', style: 'default' }]
      );
    }
  }, [strokes.length]);

  // Recover from autosave on mount (challenge or general)
  useEffect(() => {
    const recoverTopicSession = async () => {
      // HARD once-per-mount guard. The deps below ([dispatch, loadWelcomeVideoQueue])
      // are NOT stable — loadWelcomeVideoQueue changes identity across renders, so
      // this effect re-fired (e.g. when returning from ProfilePage) and popped the
      // resume modal OVER the Profil Studio workspace, then "start fresh" wiped it.
      if (autosaveRecoveryRanRef.current) {
        return;
      }
      autosaveRecoveryRanRef.current = true;
      try {
        // ============ CHECK FOR PROJECT LOAD FLAG ============
        // If a project was explicitly loaded from portfolio, skip ALL autosave recovery
        const skipResume = await AsyncStorage.getItem('@skipResumeModal');
        const isProjectLoaded = skipResume === 'true';

        if (isProjectLoaded) {
          console.log('[PaintScreen] 🎯 Project was explicitly loaded - skipping all autosave recovery');
          setSkipResumeModalOnce(true);
          // Clear the flag NOW that we know it's a project load
          await AsyncStorage.removeItem('@skipResumeModal');
        }

        // ============ LOAD FRAMER DATA FROM PROJECT LOAD ============
        // If Framer data was saved when loading a project, restore it
        const framerDataStr = await AsyncStorage.getItem('@framer_persistent_data');
        if (framerDataStr) {
          try {
            const framerData = JSON.parse(framerDataStr);
            console.log('[PaintScreen] Loading saved Framer data on startup:', {
              frameCount: framerData.frames?.length ?? 0,
              hasBackground: !!framerData.backgroundImage,
              hasVideo: !!framerData.videoBackground
            });
            framerPersistentDataRef.current = framerData;
            setFramerInitialData(framerData);
            // Don't clear it yet - keep it for Framer to use
          } catch (error) {
            console.warn('[PaintScreen] Failed to parse Framer data:', error);
          }
        }

        // ✅ CRITICAL: If project was explicitly loaded, DON'T load ANY autosave
        // The loaded project state was already dispatched in ExportScreen
        if (isProjectLoaded) {
          console.log('[PaintScreen] Project load detected - skipping autosave and sprint recovery');
          return;
        }

        // ============ PARENTAL CONTROLS INIT ============
        usageSessionStartRef.current = Date.now();
        const controls = await loadParentalControls();
        setParentalControls(controls);
        await initOfflineGalleryDb();
        const cnt = await getOfflineEntryCount();
        setOfflineEntryCount(cnt);
        if (controls.enabled && controls.dailyTimeLimitMinutes !== null) {
          const usedMs = await getDailyUsageMs();
          if (isTimeLimitExceeded(controls, usedMs)) {
            setTimeLimitWarningVisible(true);
          }
        }

        // ============ FIRST-TIME EXPERIENCE DETECTION ============
        // Check if this is a first-time user
        const firstTimeDone = await AsyncStorage.getItem(FIRST_TIME_USER_KEY);
        const isFirstTime = firstTimeDone === null;

        // Check for Framer challenge autosave first (highest priority — never lose frames)
        const framerAutosave = await loadFramerChallengeAutosave();
        if (framerAutosave && framerAutosave.frames && framerAutosave.frames.length > 0) {
          const totalStamps = framerAutosave.frames.reduce((n, f) => n + (f.stamps?.length ?? 0), 0);
          if (totalStamps > 0) {
            console.log('[PaintScreen] Recovering Framer challenge:', framerAutosave.prompt.topic, 'frames:', framerAutosave.frames.length);
            const now = Date.now();
            const remainingMs = Math.max(0, framerAutosave.endsAt - now);
            if (remainingMs > 0) {
              challengeStartedAtRef.current = framerAutosave.startedAt;
              setChallengeRemainingMs(remainingMs);
              setActiveChallenge({ prompt: framerAutosave.prompt, endsAt: framerAutosave.endsAt });
              // Load frames into framer initial data so FramerWorkspace restores them
              const initialData = {
                frames: framerAutosave.frames,
                fps: framerAutosave.fps,
                loop: framerAutosave.loop,
                cropStart: framerAutosave.cropStart,
                cropEnd: framerAutosave.cropEnd,
              };
              setFramerInitialData(initialData);
              await AsyncStorage.setItem('@emojipaint_framer_project', JSON.stringify(framerAutosave.frames));
              console.log('[PaintScreen] ✅ Framer challenge restored — open 📽️ to continue');
            } else {
              console.log('[PaintScreen] Framer challenge expired, clearing autosave');
              await clearFramerChallengeAutosave();
            }
            return;
          }
        }

        // Check for regular challenge autosave
        const autosave = await loadSprintAutosave();
        if (autosave) {
          console.log('[PaintScreen] Recovering topic session:', autosave.prompt.topic);

          // Restore painting state
          dispatch({ type: 'RESET' });
          await new Promise(resolve => setTimeout(resolve, 100));
          dispatch({
            type: 'LOAD_STATE',
            payload: {
              strokes: cloneStrokes(autosave.painting.strokes),
              brushEmoji: autosave.painting.brushEmoji,
              brushSize: autosave.painting.brushSize,
              brushOpacity: autosave.painting.brushOpacity,
              brushSpacing: autosave.painting.brushSpacing,
              recentEmojis: autosave.painting.recentEmojis,
              trace: cloneTraceState(autosave.painting.trace)
            }
          });

          // Restore challenge state with timer
          const now = Date.now();
          const remainingMs = Math.max(0, autosave.endsAt - now);

          if (remainingMs > 0) {
            challengeStartedAtRef.current = autosave.startedAt;
            challengeStrokeCountRef.current = autosave.strokeCount;
            setChallengeStrokeCount(autosave.strokeCount);
            prevChallengeStrokeCountRef.current = autosave.painting.strokes.length;
            setChallengeRemainingMs(remainingMs);
            setActiveChallenge({ prompt: autosave.prompt, endsAt: autosave.endsAt });

            console.log('[PaintScreen] Topic session restored:', {
              topic: autosave.prompt.topic,
              elapsedMs: autosave.elapsedMs,
              remainingMs,
              strokes: autosave.painting.strokes.length,
              challengeStrokes: autosave.strokeCount
            });

            // Show animated resume modal only if more than 5 strokes (excludes 4 automatic workspace strokes)
            // Never over the Profil Studio — recovery is async and could finish after the studio opened.
            if (autosave.painting.strokes.length > 5 && !privateStudioActiveRef.current) {
              setResumeAutosaveData(autosave);
              // Load IMAGE logo FIRST before showing modal to prevent race condition
              // Use getRandomImageLogoSet() to ensure we get an image type (not video) for the resume modal
              setResumeLogoSet(getRandomImageLogoSet());
              setResumeLogoFrameIndex(0);
              setShowResumeModal(true);
            } else {
              console.log('[PaintScreen] Autosave has <= 5 strokes, skipping resume prompt (likely just workspace strokes)');
            }
          } else {
            console.log('[PaintScreen] Topic session expired, clearing autosave');
            await clearSprintAutosave();
          }
          return;
        }

        // Check for general autosave (non-challenge work)
        const generalAutosave = await loadGeneralAutosave();

        // Track whether this is a resume session or new session
        let isResumeSession = false;

        // Never pop the resume modal over the Profil Studio (async race on open).
        if (generalAutosave && generalAutosave.painting.strokes.length > 5 && !privateStudioActiveRef.current) {
          // This is a RESUME session (has autosave with meaningful strokes)
          isResumeSession = true;
          console.log('[PaintScreen] Recovering general work:', generalAutosave.painting.strokes.length, 'strokes', generalAutosave.painting.frames?.length || 0, 'frames');

          setResumeAutosaveData(generalAutosave);
          // Load IMAGE logo FIRST before showing modal to prevent race condition
          // Use getRandomImageLogoSet() to ensure we get an image type (not video) for the resume modal
          setResumeLogoSet(getRandomImageLogoSet());
          setResumeLogoFrameIndex(0);
          setShowResumeModal(true);
        } else {
          // This is a NEW session
          console.log('[PaintScreen] No valid autosave or <= 5 strokes - starting NEW session');
        }

        // Reset the flag after checking it so future sessions work normally
        setSkipResumeModalOnce(false);

        // ============ SESSION COUNTING & FIRST-TIME EXPERIENCE ============
        // Only count sessions when starting NEW (not resuming)
        if (!isResumeSession) {
          // Get current session count
          const sessionCountStr = await AsyncStorage.getItem(SESSION_COUNT_KEY);
          const sessionCount = sessionCountStr ? parseInt(sessionCountStr, 10) : 0;
          const newSessionCount = sessionCount + 1;

          console.log(`[FirstTime] NEW session detected - Session count: ${sessionCount} -> ${newSessionCount}`);
          await AsyncStorage.setItem(SESSION_COUNT_KEY, newSessionCount.toString());

          // ============ RANDOM GALLERY AUTO-OPEN (1/33) ============
          // On first session only, randomly pick a round (1-33) to auto-open gallery
          if (isFirstTime) {
            const randomRound = Math.floor(Math.random() * 33) + 1; // 1-33
            await AsyncStorage.setItem(RANDOM_GALLERY_ROUND_KEY, randomRound.toString());
            console.log(`[FirstTime] First-time user! Randomly picked session ${randomRound}/33 for gallery auto-open`);
          }

          // Check if we should auto-open gallery on this session
          if (newSessionCount <= 33) {
            const galleryRoundStr = await AsyncStorage.getItem(RANDOM_GALLERY_ROUND_KEY);
            const galleryRound = galleryRoundStr ? parseInt(galleryRoundStr, 10) : null;

            if (galleryRound === newSessionCount) {
              console.log(`[FirstTime] Session ${newSessionCount} matches gallery round ${galleryRound} - will auto-open gallery after load`);
              // Set flag to auto-open gallery after workspace is ready
              setTimeout(() => {
                setShouldAutoOpenGallery(true);
              }, 2000); // Wait 2 seconds for workspace to load
            }
          }

          // ============ FIRST-TIME WELCOME OVERLAY ============
          if (isFirstTime) {
            console.log('[FirstTime] First-time user detected - showing welcome overlay');
            pendingFirstTimeWelcomeRef.current = true;
            // Show it directly. The intro/AGB gate has already finished by the
            // time this screen mounts, so waiting for its `startup:hidden`
            // event would wait forever — that event fired before we existed.
            showPendingFirstTimeWelcomeRef.current?.();
          }
        } else {
          console.log('[FirstTime] RESUME session detected - not counting as new session');
        }
      } catch (error) {
        console.error('[PaintScreen] Failed to recover topic session:', error);
      }
    };

    recoverTopicSession();
  }, [dispatch, loadWelcomeVideoQueue]); // Run once on mount

  // Resume modal logo animation - load random logo set when modal opens
  useEffect(() => {
    if (showResumeModal && !resumeLogoSet) {
      // Use getRandomImageLogoSet() to ensure we get an image type (not video)
      setResumeLogoSet(getRandomImageLogoSet());
      setResumeLogoFrameIndex(0);
    } else if (!showResumeModal) {
      setResumeLogoSet(null);
      setResumeLogoFrameIndex(0);
    }
  }, [showResumeModal, resumeLogoSet]);

  // Resume modal logo frame cycling
  useEffect(() => {
    if (!showResumeModal || !resumeLogoSet) return;

    const interval = setInterval(() => {
      setResumeLogoFrameIndex((prev) => (prev + 1) % ((resumeLogoSet?.frames?.length ?? 0) + 1));
    }, 100); // 100ms per frame for ~10fps animation

    return () => clearInterval(interval);
  }, [showResumeModal, resumeLogoSet]);

  // Trigger resume modal animations
  useEffect(() => {
    if (showResumeModal) {
      // Reset all animations
      resumeModalBgAnim.setValue(0);
      resumeModalPanelAnim.setValue(0);
      resumeModalButton1Anim.setValue(0);
      resumeModalButton2Anim.setValue(0);

      // Random directions: 0=top, 1=right, 2=bottom, 3=left
      const panelDir = Math.floor(Math.random() * 4);
      const button1Dir = Math.floor(Math.random() * 4);
      const button2Dir = Math.floor(Math.random() * 4);

      // Random animation types: 0=spring, 1=timing with ease
      const panelType = Math.floor(Math.random() * 2);
      const button1Type = Math.floor(Math.random() * 2);
      const button2Type = Math.floor(Math.random() * 2);

      // Start animations with random delays
      const startAnimations = () => {
        // Background fade in
        RNAnimated.timing(resumeModalBgAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();

        // Panel fly in with random delay
        setTimeout(() => {
          if (panelType === 0) {
            RNAnimated.spring(resumeModalPanelAnim, {
              toValue: 1,
              friction: 6 + Math.random() * 4, // 6-10
              tension: 40 + Math.random() * 40, // 40-80
              useNativeDriver: true,
            }).start();
          } else {
            RNAnimated.timing(resumeModalPanelAnim, {
              toValue: 1,
              duration: 400 + Math.random() * 200, // 400-600ms
              useNativeDriver: true,
            }).start();
          }
        }, Math.random() * 100);

        // Button 1 fly in with random delay
        setTimeout(() => {
          if (button1Type === 0) {
            RNAnimated.spring(resumeModalButton1Anim, {
              toValue: 1,
              friction: 5 + Math.random() * 5,
              tension: 60 + Math.random() * 60,
              useNativeDriver: true,
            }).start();
          } else {
            RNAnimated.timing(resumeModalButton1Anim, {
              toValue: 1,
              duration: 500 + Math.random() * 300,
              useNativeDriver: true,
            }).start();
          }
        }, 100 + Math.random() * 150);

        // Button 2 fly in with random delay
        setTimeout(() => {
          if (button2Type === 0) {
            RNAnimated.spring(resumeModalButton2Anim, {
              toValue: 1,
              friction: 5 + Math.random() * 5,
              tension: 60 + Math.random() * 60,
              useNativeDriver: true,
            }).start();
          } else {
            RNAnimated.timing(resumeModalButton2Anim, {
              toValue: 1,
              duration: 500 + Math.random() * 300,
              useNativeDriver: true,
            }).start();
          }
        }, 200 + Math.random() * 150);
      };

      startAnimations();

      // Store the random directions for the render
      (resumeModalPanelAnim as any).direction = panelDir;
      (resumeModalButton1Anim as any).direction = button1Dir;
      (resumeModalButton2Anim as any).direction = button2Dir;
    }
  }, [showResumeModal, resumeModalBgAnim, resumeModalPanelAnim, resumeModalButton1Anim, resumeModalButton2Anim]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const previousState = appStateRef.current;
      const leavingToBackground =
        previousState === 'active' && (nextState === 'inactive' || nextState === 'background');

      if (leavingToBackground && frameModeRef.current && framesRef.current.length > 0) {
        syncLiveFrameCopies();
        const previousIndex = currentFrameIndexRef.current;
        resumeFrameIndexPendingRef.current = previousIndex;
        const firstFrame = framesRef.current[0];
        if (firstFrame) {
          console.log('[Icon Effect] Switching to frame 0 for app preview');
          currentFrameIndexRef.current = 0;
          setCurrentFrameIndex(0);
          const state = playbackStateRef.current;
          dispatch({
            type: 'LOAD_STATE',
            payload: {
              strokes: cloneStrokes(firstFrame.strokes),
              brushEmoji: state.brushEmoji,
              brushSize: state.brushSize,
              brushOpacity: state.brushOpacity,
              brushSpacing: state.brushSpacing,
              brushRotation: state.brushRotation,
              recentEmojis: state.recentEmojis,
              trace: cloneTraceState(state.trace),
              mirrorX: state.mirrorX,
              mirrorY: state.mirrorY
            }
          });
        }
      }

      if (nextState === 'active' && resumeFrameIndexPendingRef.current !== null) {
        const restoreIndex = Math.max(0, Math.min(resumeFrameIndexPendingRef.current, framesRef.current.length - 1));
        resumeFrameIndexPendingRef.current = null;
        if (frameModeRef.current && framesRef.current[restoreIndex]) {
          currentFrameIndexRef.current = restoreIndex;
          setCurrentFrameIndex(restoreIndex);
          const state = playbackStateRef.current;
          const restoreFrame = framesRef.current[restoreIndex];
          dispatch({
            type: 'LOAD_STATE',
            payload: {
              strokes: cloneStrokes(restoreFrame.strokes),
              brushEmoji: state.brushEmoji,
              brushSize: state.brushSize,
              brushOpacity: state.brushOpacity,
              brushSpacing: state.brushSpacing,
              brushRotation: state.brushRotation,
              recentEmojis: state.recentEmojis,
              trace: cloneTraceState(state.trace),
              mirrorX: state.mirrorX,
              mirrorY: state.mirrorY
            }
          });
        }
      }

      if (previousState === 'active' && nextState.match(/inactive|background/)) {
        // Track parental daily usage
        if (usageSessionStartRef.current !== null) {
          const elapsed = Date.now() - usageSessionStartRef.current;
          usageSessionStartRef.current = null;
          void addDailyUsageMs(elapsed);
        }
      } else if (nextState === 'active' && previousState && previousState.match(/inactive|background/)) {
        usageSessionStartRef.current = Date.now();
        // Safety: reset any stuck overlay animation flags when app returns to foreground
        leaderboard.forceResetLeaderboard();
        if (privateStudioSavingInProgressRef.current) {
          privateStudioSavingInProgressRef.current = false;
        }
        // Watchdog: force-close any blocking mystery overlays that can deadlock the workspace
        setMysteryConfirmVisible(false);
        setMysteryPickerVisible(false);
        setMysteryTopicWarningVisible(false);
        mysteryBounceAnim.stopAnimation();
        mysteryBounceAnim.setValue(0);
        // Self-heal: clear galleryPassportViewerVisible — it's an absolute View at zIndex 20000
        // that blocks ALL touches if left open after gallery closes (most common freeze cause)
        setGalleryPassportViewerVisible(false);
        setGalleryPassportViewerUser(null);
        galleryPassportViewerScale.setValue(0);
        // Self-heal: clear profileLeaderboardVisible if profile is not open
        closeProfileLeaderboard();
        // Self-heal: clear any stuck upload loading state
        setChallengeUploadLoading(false);
      }
      appStateRef.current = nextState;
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [closeProfileLeaderboard, dispatch, syncLiveFrameCopies, mysteryBounceAnim, galleryPassportViewerScale]);

  useEffect(() => {
    return () => {
      if (privateStudioTimerRef.current) {
        clearInterval(privateStudioTimerRef.current);
        privateStudioTimerRef.current = null;
      }
      if (privateStudioAutosaveTimeoutRef.current) {
        clearTimeout(privateStudioAutosaveTimeoutRef.current);
        privateStudioAutosaveTimeoutRef.current = null;
      }
      if (challengeAutosaveTimeoutRef.current) {
        clearTimeout(challengeAutosaveTimeoutRef.current);
        challengeAutosaveTimeoutRef.current = null;
      }
      if (generalAutosaveTimeoutRef.current) {
        clearTimeout(generalAutosaveTimeoutRef.current);
        generalAutosaveTimeoutRef.current = null;
      }
      if (overlaySwapTimeoutRef.current) {
        clearTimeout(overlaySwapTimeoutRef.current);
        overlaySwapTimeoutRef.current = null;
      }
      if (promptAutoDismissTimeoutRef.current) {
        clearTimeout(promptAutoDismissTimeoutRef.current);
        promptAutoDismissTimeoutRef.current = null;
      }
      if (promptDismissSoundRef.current) {
        promptDismissSoundRef.current.unloadAsync().catch(() => undefined);
        promptDismissSoundRef.current = null;
      }
    };
  }, []);

  useEffect(() => () => {
    if (retryHelperAnimationRef.current) {
      retryHelperAnimationRef.current.stop();
      retryHelperAnimationRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!leaderboard.leaderboardVisible) {
      setUploadCelebration(null);
    }
  }, [leaderboard.leaderboardVisible]);

  // Sprint countdown interval, completion-reset, and completion-detection effects → moved to useChallenge

  // CRITICAL MEMORY FIX: Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      console.log('[PaintScreen] Cleanup: Clearing all timers');
      if (liveLongStrokeTimerRef.current) {
        clearInterval(liveLongStrokeTimerRef.current);
        liveLongStrokeTimerRef.current = null;
      }
      if (privateStudioTimerRef.current) {
        clearInterval(privateStudioTimerRef.current);
        privateStudioTimerRef.current = null;
      }
      // challengeConfirmEmojiIntervalRef cleanup → handled by useChallenge unmount
    };
  }, []);

  // confirmCopy → from useChallenge

  // Helper function to create boundary strokes for frame previews, scaled to preview size
  const createFrameBorderStrokes = useCallback((frameStrokes: Stroke[], previewSize: number): Stroke[] => {
    if (frameStrokes.length === 0) return [];
    // Calculate scale factor based on canvas size
    const scaleFactor = previewSize / canvasSize;
    const padding = 1; // Minimal padding for previews
    const timestamp = Date.now();
    const borders: Stroke[] = [
      {
        id: `border_top_${timestamp}`,
        emoji: '⬜',
        size: 1,
        opacity: 0,
        spacing: 0.01,
        mirrorX: false,
        mirrorY: false,
        rotation: 0,
        points: [
          { x: padding, y: padding, t: 0 },
          { x: previewSize - padding, y: padding, t: 1 }
        ]
      },
      {
        id: `border_right_${timestamp}`,
        emoji: '⬜',
        size: 1,
        opacity: 0,
        spacing: 0.01,
        mirrorX: false,
        mirrorY: false,
        rotation: 0,
        points: [
          { x: previewSize - padding, y: padding, t: 1 },
          { x: previewSize - padding, y: previewSize * CANVAS_RATIO - padding, t: 2 }
        ]
      },
      {
        id: `border_bottom_${timestamp}`,
        emoji: '⬜',
        size: 1,
        opacity: 0,
        spacing: 0.01,
        mirrorX: false,
        mirrorY: false,
        rotation: 0,
        points: [
          { x: previewSize - padding, y: previewSize * CANVAS_RATIO - padding, t: 2 },
          { x: padding, y: previewSize * CANVAS_RATIO - padding, t: 3 }
        ]
      },
      {
        id: `border_left_${timestamp}`,
        emoji: '⬜',
        size: 1,
        opacity: 0,
        spacing: 0.01,
        mirrorX: false,
        mirrorY: false,
        rotation: 0,
        points: [
          { x: padding, y: previewSize * CANVAS_RATIO - padding, t: 3 },
          { x: padding, y: padding, t: 4 }
        ]
      }
    ];
    // Scale strokes to preview size
    // Make emojis smaller in thumbnails so they don't dominate the preview
    // Scale coordinates normally, but make sizes much smaller for better thumbnail appearance
    const scaledStrokes = frameStrokes.map(stroke => ({
      ...stroke,
      // Scale size much more aggressively for tiny thumbnails
      // User feedback: use 0.00024 multiplier so size 24 emojis appear tiny in preview (10x smaller than 0.0024)
      size: Math.max(0.3, stroke.size * scaleFactor * 0.00024),
      points: stroke.points.map(p => ({
        ...p,
        x: p.x * scaleFactor,
        y: p.y * scaleFactor
      }))
    }));
    return [...borders, ...scaledStrokes];
  }, [canvasSize]);

  // Frame-by-frame animation management
  const saveCurrentFrame = useCallback(async () => {
    if (!frameMode) return;

    // Ensure any live stamps are applied before we snapshot or save
    syncLiveFrameCopies();

    const framesSnapshot = framesRef.current;
    if (!framesSnapshot || framesSnapshot.length === 0) {
      return;
    }

    const safeIndex = Math.max(0, Math.min(currentFrameIndex, framesSnapshot.length - 1));

    // Generate thumbnail AND full-resolution rendered image for preview
    let thumbnailUri: string | undefined;
    let renderedImageUri: string | undefined;
    try {
      const captureTarget = challengeCanvasRef.current ?? viewShotRef.current;
      if (captureTarget) {
        if (strokes.length > 0) {
          // Capture thumbnail at 96x96 for frame strip
          const ratio = PixelRatio.get();
          thumbnailUri = await captureRef(captureTarget, {
            format: 'png',
            quality: 0.8,
            width: Math.round(96 * ratio),
            height: Math.round(96 * CANVAS_RATIO * ratio)
          });

          // Capture full-resolution image for fast playback (canvas size)
          // This makes playback instant and duplication super fast
          renderedImageUri = await captureRef(captureTarget, {
            format: 'png',
            quality: 1.0,
            width: canvasSize,
            height: Math.round(canvasSize * CANVAS_RATIO)
          });
          console.log('[Frame Rendering] Captured full-res image for frame', safeIndex);
        } else {
          // Empty frame - create transparent PNG
          const emptyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
          thumbnailUri = emptyPng;
          renderedImageUri = emptyPng;
        }
      }
    } catch (error) {
      console.error('[saveCurrentFrame] Failed to generate images:', error);
    }

    // Save frame strokes, thumbnail, AND rendered image to memory
    const clonedStrokes = cloneStrokes(strokes);
    setFrames(prev => {
      const sourceFrames = framesRef.current.length > 0 ? framesRef.current : prev;
      if (!sourceFrames || !sourceFrames[safeIndex]) {
        return prev;
      }
      const newFrames = [...sourceFrames];
      newFrames[safeIndex] = {
        ...newFrames[safeIndex],
        strokes: clonedStrokes,
        thumbnail: thumbnailUri,
        renderedImageUri: renderedImageUri
      };
      framesRef.current = newFrames;
      pendingFrameSyncRef.current = false;
      return newFrames;
    });
  }, [frameMode, currentFrameIndex, strokes, challengeCanvasRef, viewShotRef, syncLiveFrameCopies]);

  // Regenerate all frame thumbnails using Metal stroke replay
  const regenerateAllThumbnails = useCallback(async () => {
    if (!frameMode || frames.length === 0) return;

    console.log('[Thumbnail Update] Regenerating all', frames.length, 'frame thumbnails...');
    setRegeneratingThumbnails(true);
    setTotalThumbnailsToRegenerate(frames.length);
    setThumbnailsRegenerated(0);

    const updatedFrames = [...frames];

    for (let i = 0; i < frames.length; i++) {
      try {
        const frame = frames[i];
        const thumbnail = await generateProjectPreview(layeredForExport(frame.strokes), 96, canvasSize, canvasSize);

        if (thumbnail) {
          updatedFrames[i] = {
            ...updatedFrames[i],
            thumbnail
          };
          setThumbnailsRegenerated(i + 1);
          console.log(`[Thumbnail Update] Generated ${i + 1}/${frames.length}`);
        }
      } catch (error) {
        console.error(`[Thumbnail Update] Failed for frame ${i}:`, error);
      }
    }

    setFrames(updatedFrames);
    setRegeneratingThumbnails(false);
    console.log('[Thumbnail Update] Completed all thumbnails');
  }, [frameMode, frames, canvasSize]);

  const switchToFrame = useCallback(async (index: number) => {
    const hasFrameMode = frameMode || frameModeRef.current;
    const targetFrames = framesRef.current.length > 0 ? framesRef.current : frames;
    if (!hasFrameMode || index < 0 || index >= targetFrames.length) return;

    // Store current zoom level before switching
    const currentZoom = mainCanvasTransformRef.current;
    console.log('[Frame Switch] Preserving zoom:', currentZoom);

    // Save current frame first
    await saveCurrentFrame();
    // Hide arrows when switching to different frame
    setSelectedFrameForMove(null);
    // Switch to new frame
    setCurrentFrameIndex(index);
    // Load new frame's strokes (zoom state is preserved in mainCanvasTransformRef)
    dispatch({
      type: 'LOAD_STATE',
      payload: {
        strokes: cloneStrokes(targetFrames[index].strokes),
        brushEmoji,
        brushSize,
        brushOpacity,
        brushSpacing,
        brushRotation,
        mirrorX,
        mirrorY,
        recentEmojis,
        trace: cloneTraceState(trace)
      }
    });

    // Log zoom after frame switch to verify it's preserved
    console.log('[Frame Switch] Zoom after switch:', mainCanvasTransformRef.current);
  }, [frameMode, frames, currentFrameIndex, saveCurrentFrame, dispatch, brushEmoji, brushSize, brushOpacity, brushSpacing, brushRotation, mirrorX, mirrorY, recentEmojis, trace]);

  const addNewFrame = useCallback(async (duplicate: boolean) => {
    if (!frameMode) return;

    // Save current canvas strokes to current frame BEFORE adding new frame
    await saveCurrentFrame();

    // Save current state to history before making changes
    saveFrameHistory();

    const currentFrame = frames[currentFrameIndex];

    const newFrame: AnimationFrame = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      // PERFORMANCE FIX: When duplicating, copy strokes AND rendered images
      // This makes duplication instant even with hundreds of strokes
      strokes: duplicate ? cloneStrokes(strokes) : [],
      timestamp: Date.now(),
      thumbnail: duplicate && currentFrame ? currentFrame.thumbnail : undefined,
      renderedImageUri: duplicate && currentFrame ? currentFrame.renderedImageUri : undefined
    };

    console.log('[Frame Duplication]', duplicate ? `Copying image-based frame (instant)` : 'Creating empty frame');

    // Update frames and switch to new frame
    setFrames(prev => {
      const newFrames = [...prev];
      newFrames.splice(currentFrameIndex + 1, 0, newFrame);
      return newFrames;
    });

    // Switch to the new frame by updating index and loading its strokes
    const newIndex = currentFrameIndex + 1;
    setCurrentFrameIndex(newIndex);

    // Load the new frame's strokes immediately
    dispatch({
      type: 'LOAD_STATE',
      payload: {
        strokes: duplicate ? cloneStrokes(strokes) : [],
        brushEmoji,
        brushSize,
        brushOpacity,
        brushSpacing,
        brushRotation,
        mirrorX,
        mirrorY,
        recentEmojis,
        trace: cloneTraceState(trace)
      }
    });
  }, [frameMode, strokes, currentFrameIndex, frames, dispatch, brushEmoji, brushSize, brushOpacity, brushSpacing, brushRotation, mirrorX, mirrorY, recentEmojis, trace, saveCurrentFrame, saveFrameHistory]);

  /// Hard-stop frame playback NOW (timer + state + ref), without the thumbnail regeneration that
  /// toggleFramePlayback does. Deleting frames while the playhead is running is what leaves
  /// currentFrameIndexRef pointing past the end of the shortened array.
  const stopFramePlaybackImmediate = useCallback(() => {
    if (playFramesIntervalRef.current) {
      clearInterval(playFramesIntervalRef.current);
      playFramesIntervalRef.current = null;
    }
    isPlayingFramesRef.current = false;
    setIsPlayingFrames(false);
  }, []);

  const deleteCurrentFrame = useCallback(() => {
    if (!frameMode || frames.length === 1) return;

    // Double-confirmation logic: first click activates confirmation, second click within 2s deletes
    if (!deleteConfirmActive) {
      // First click - activate confirmation mode
      setDeleteConfirmActive(true);
      console.log('[Frame Mode] Delete confirmation activated - click again within 2s to delete');
      showDeleteAllPromptTemporarily();

      // Clear any existing timeout
      if (deleteConfirmTimeoutRef.current) {
        clearTimeout(deleteConfirmTimeoutRef.current);
      }

      // Set timeout to reset confirmation after 2 seconds
      deleteConfirmTimeoutRef.current = setTimeout(() => {
        setDeleteConfirmActive(false);
        console.log('[Frame Mode] Delete confirmation timed out');
        hideDeleteAllPrompt();
      }, 2000);

      return;
    }

    // Second click within 2s - actually delete the frame
    console.log('[Frame Mode] Deleting frame at index', currentFrameIndex);

    // Clear the timeout
    if (deleteConfirmTimeoutRef.current) {
      clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = null;
    }

    // Reset confirmation state
    setDeleteConfirmActive(false);
    hideDeleteAllPrompt();

    // Save current state to history before making changes
    saveFrameHistory();

    // Delete the current frame (don't save it first since we're deleting it)
    const newFrames = frames.filter((_, idx) => idx !== currentFrameIndex);
    setFrames(newFrames);

    // Calculate new index and switch to it
    const newIndex = Math.max(0, Math.min(currentFrameIndex, newFrames.length - 1));
    // Playback writes currentFrameIndexRef DIRECTLY (see syncLiveFrameCopies), so the ref can be
    // ahead of the state. If setCurrentFrameIndex() lands on the value the state already holds,
    // React bails out, the sync effect never runs, and the ref keeps pointing past the end of the
    // shortened array — after which every finalized stroke fails its bounds check and is silently
    // dropped ("can't paint any more"). Stop playback and pin the ref by hand.
    stopFramePlaybackImmediate();
    currentFrameIndexRef.current = newIndex;
    setCurrentFrameIndex(newIndex);

    // Load the new current frame's strokes
    dispatch({
      type: 'LOAD_STATE',
      payload: {
        strokes: cloneStrokes(newFrames[newIndex].strokes),
        brushEmoji,
        brushSize,
        brushOpacity,
        brushSpacing,
        brushRotation,
        mirrorX,
        mirrorY,
        recentEmojis,
        trace: cloneTraceState(trace)
      }
    });

    console.log('[Frame Mode] Deleted frame, now showing frame', newIndex);
  }, [brushEmoji, brushOpacity, brushRotation, brushSpacing, deleteConfirmActive, dispatch, frameMode, frames, hideDeleteAllPrompt, mirrorX, mirrorY, recentEmojis, saveFrameHistory, showDeleteAllPromptTemporarily, trace, currentFrameIndex, brushSize, stopFramePlaybackImmediate]);

  const deleteAllFrames = useCallback(() => {
    if (!frameMode || frames.length <= 1) return;

    // Double-confirmation logic: first click activates confirmation, second click within 2s deletes
    if (!deleteAllConfirmActive) {
      // First click - activate confirmation mode
      setDeleteAllConfirmActive(true);
      console.log('[Frame Mode] Delete ALL confirmation activated - click again within 2s to delete all frames');
      persistDeleteAllPrompt();

      // Clear any existing timeout
      if (deleteAllConfirmTimeoutRef.current) {
        clearTimeout(deleteAllConfirmTimeoutRef.current);
      }

      // Set timeout to reset confirmation after 2 seconds
      deleteAllConfirmTimeoutRef.current = setTimeout(() => {
        setDeleteAllConfirmActive(false);
        console.log('[Frame Mode] Delete ALL confirmation timed out');
        hideDeleteAllPrompt();
      }, 2000);

      return;
    }

    // Second click within 2s - actually delete all frames except first or currently selected
    console.log('[Frame Mode] Deleting all frames except first and currently selected');

    // Reset confirmation state
    setDeleteAllConfirmActive(false);
    hideDeleteAllPrompt();

    // Clear the timeout
    if (deleteAllConfirmTimeoutRef.current) {
      clearTimeout(deleteAllConfirmTimeoutRef.current);
    }

    // Save current state to history before making changes
    saveFrameHistory();

    // Keep frame 0 (first frame) and current frame
    const framesToKeep = frames.filter((_, idx) => idx === 0 || idx === currentFrameIndex);

    // If current frame is 0, only keep 1 frame
    const newFrames = currentFrameIndex === 0 ? [frames[0]] : framesToKeep;

    setFrames(newFrames);

    // Adjust current index: if we kept 2 frames, current becomes index 1, otherwise 0
    const newIndex = newFrames.length > 1 ? 1 : 0;
    // Same stale-ref hazard as deleteCurrentFrame — pin it explicitly.
    stopFramePlaybackImmediate();
    currentFrameIndexRef.current = newIndex;
    setCurrentFrameIndex(newIndex);

    // Load the frame at new index
    const newFrame = newFrames[newIndex];
    dispatch({
      type: 'LOAD_STROKES',
      strokes: cloneStrokes(newFrame.strokes),
      brushEmoji,
      brushSize,
      brushOpacity,
      brushSpacing,
      brushRotation,
      mirrorX,
      mirrorY,
      recentEmojis,
      trace
    });

    console.log('[Frame Mode] Deleted all except first/selected, now showing frame', newIndex);
  }, [brushEmoji, brushOpacity, brushRotation, brushSpacing, currentFrameIndex, deleteAllConfirmActive, dispatch, frameMode, frames, hideDeleteAllPrompt, mirrorX, mirrorY, persistDeleteAllPrompt, recentEmojis, saveFrameHistory, trace, brushSize, stopFramePlaybackImmediate]);

  const moveFrame = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= frames.length) return;

    // Save current state to history before making changes
    saveFrameHistory();

    setFrames(prev => {
      const newFrames = [...prev];
      const [movedFrame] = newFrames.splice(fromIndex, 1);
      newFrames.splice(toIndex, 0, movedFrame);
      return newFrames;
    });
    // Update current index and selectedFrameForMove if needed
    if (currentFrameIndex === fromIndex) {
      setCurrentFrameIndex(toIndex);
      setSelectedFrameForMove(toIndex); // Keep arrows visible on the moved frame
    } else if (fromIndex < currentFrameIndex && toIndex >= currentFrameIndex) {
      setCurrentFrameIndex(currentFrameIndex - 1);
    } else if (fromIndex > currentFrameIndex && toIndex <= currentFrameIndex) {
      setCurrentFrameIndex(currentFrameIndex + 1);
    } else {
      setSelectedFrameForMove(toIndex); // Keep arrows visible on the moved frame
    }
  }, [frames.length, currentFrameIndex, saveFrameHistory]);

  const toggleFramePlayback = useCallback(async () => {
    if (!frameMode) return;

    if (isPlayingFrames) {
      // Stopping playback
      if (playFramesIntervalRef.current) {
        clearInterval(playFramesIntervalRef.current);
        playFramesIntervalRef.current = null;
      }
      setIsPlayingFrames(false);

      // Save current frame and regenerate all thumbnails ONLY when stopping
      await saveCurrentFrame();
      await regenerateAllThumbnails();
    } else {
      // Starting playback - NO thumbnail generation, just start playing
      setIsPlayingFrames(true);
    }
  }, [frameMode, isPlayingFrames, saveCurrentFrame, regenerateAllThumbnails]);

  // Highly optimized frame playback using requestAnimationFrame
  // Only updates when frames actually change, avoiding excessive dispatch calls
  useEffect(() => {
    if (!frameMode || !isPlayingFrames) {
      // Stop playback
      if (playFramesAnimationRef.current) {
        cancelAnimationFrame(playFramesAnimationRef.current);
        playFramesAnimationRef.current = null;
      }
      lastDisplayedFrameRef.current = -1;
      return;
    }

    // Cancel existing animation loop if any
    if (playFramesAnimationRef.current) {
      cancelAnimationFrame(playFramesAnimationRef.current);
      playFramesAnimationRef.current = null;
    }

    // Start playback using requestAnimationFrame (much more efficient than setInterval)
    playbackStartTimeRef.current = performance.now();
    lastDisplayedFrameRef.current = -1; // Initialize to -1 so first frame (0) will be displayed
    playbackFpsRef.current = exportFps; // Update FPS ref for the animation loop

    console.log('[Frame Playback] Starting playback with', framesRef.current.length, 'frames at', exportFps, 'FPS');

    const animationLoop = () => {
      const currentFrames = framesRef.current;
      if (currentFrames.length === 0) {
        playFramesAnimationRef.current = requestAnimationFrame(animationLoop);
        return;
      }

      // Calculate elapsed time and determine which frame should be displayed
      const elapsed = performance.now() - playbackStartTimeRef.current;
      const frameDuration = 1000 / playbackFpsRef.current; // ms per frame
      const frameIndex = Math.floor(elapsed / frameDuration) % currentFrames.length;

      // Only update if frame actually changed (massive performance improvement)
      if (frameIndex !== lastDisplayedFrameRef.current) {
        lastDisplayedFrameRef.current = frameIndex;
        const frame = currentFrames[frameIndex];

        if (!frame) {
          playFramesAnimationRef.current = requestAnimationFrame(animationLoop);
          return;
        }

        // Update index
        setCurrentFrameIndex(frameIndex);

        // Update live stroke target if painting during playback
        updateLiveFrameTarget(frameIndex);

        // PLAY & PAINT: Always load fresh strokes from frame (no cache)
        // This ensures stamps appear immediately
        const isCurrentlyPainting = liveStrokeRef.current !== null;
        let displayStrokes: Stroke[];

        if (isCurrentlyPainting) {
          // During painting, always load directly from frame to see stamps
          displayStrokes = cloneStrokes(frame.strokes);
        } else {
          // Not painting, use cache for performance
          let cachedStrokes = frameCacheRef.current.get(frame.id);
          if (!cachedStrokes) {
            cachedStrokes = cloneStrokes(frame.strokes);

            // Enforce cache size limit (LRU eviction)
            if (frameCacheRef.current.size >= MAX_FRAME_CACHE_SIZE) {
              const firstKey = frameCacheRef.current.keys().next().value;
              if (firstKey !== undefined) {
                frameCacheRef.current.delete(firstKey);
              }
            }

            frameCacheRef.current.set(frame.id, cachedStrokes);
          }
          displayStrokes = cachedStrokes;
        }

        // Load frame strokes
        const state = playbackStateRef.current;
        dispatch({
          type: 'LOAD_STATE',
          payload: {
            strokes: displayStrokes,
            brushEmoji: state.brushEmoji,
            brushSize: state.brushSize,
            brushOpacity: state.brushOpacity,
            brushSpacing: state.brushSpacing,
            brushRotation: state.brushRotation,
            mirrorX: state.mirrorX,
            mirrorY: state.mirrorY,
            recentEmojis: state.recentEmojis,
            trace: state.trace  // Reuse state instead of cloning - trace doesn't change during playback
          }
        });
      }

      // Continue animation loop
      playFramesAnimationRef.current = requestAnimationFrame(animationLoop);
    };

    // Start the loop
    playFramesAnimationRef.current = requestAnimationFrame(animationLoop);

    return () => {
      if (playFramesAnimationRef.current) {
        cancelAnimationFrame(playFramesAnimationRef.current);
        playFramesAnimationRef.current = null;
      }
    };
  }, [exportFps, frameMode, isPlayingFrames, updateLiveFrameTarget]);

  // Export preview animation
  useEffect(() => {
    if (!animationExportVisible || !exportPreviewPlaying) {
      if (exportPreviewIntervalRef.current) {
        clearInterval(exportPreviewIntervalRef.current);
        exportPreviewIntervalRef.current = null;
      }
      return;
    }

    // Start preview animation
    let direction = exportLoopMode === 'reverse' ? -1 : 1; // 1 for forward, -1 for backward
    exportPreviewIntervalRef.current = setInterval(() => {
      setExportPreviewFrameIndex(prev => {
        let nextIndex = prev + direction;

        if (exportLoopMode === 'pingpong') {
          // Ping-pong mode: reverse direction at ends
          if (nextIndex >= frames.length) {
            direction = -1;
            nextIndex = frames.length - 2;
          } else if (nextIndex < 0) {
            direction = 1;
            nextIndex = 1;
          }
        } else if (exportLoopMode === 'reverse') {
          // Reverse mode: play backwards continuously
          if (nextIndex < 0) {
            nextIndex = frames.length - 1;
          }
        } else {
          // Normal loop mode: play forwards continuously
          nextIndex = (nextIndex + frames.length) % frames.length;
        }

        return nextIndex;
      });
    }, 1000 / exportFps);

    return () => {
      if (exportPreviewIntervalRef.current) {
        clearInterval(exportPreviewIntervalRef.current);
        exportPreviewIntervalRef.current = null;
      }
    };
  }, [animationExportVisible, exportPreviewPlaying, exportFps, exportLoopMode, frames.length]);

  // Reset export preview when modal opens
  useEffect(() => {
    if (animationExportVisible) {
      // Start from last frame if reverse mode, otherwise start from first
      setExportPreviewFrameIndex(exportLoopMode === 'reverse' ? frames.length - 1 : 0);
      setExportPreviewPlaying(true);
    }
  }, [animationExportVisible, exportLoopMode, frames.length]);

  // Listen for animation export progress. The native MP4 encoder is FAST and
  // fires ~1 event per frame in a tight burst; calling setState on each one lets
  // React coalesce them, so the bar looked stuck at 1-4% then jumped to ~84%.
  // Fix: events only update a ref; a fixed 50ms sampler (below) pushes the
  // latest value to state → the bar climbs smoothly for MP4 just like GIF.
  useEffect(() => {
    const subscription = addExportProgressListener((current, total) => {
      animationExportProgressRef.current = { current, total };
    });
    return () => subscription.remove();
  }, []);

  // Sampler: flush the latest export progress to state at a steady ~20fps while
  // an animation export is active (uniform for both native and JS-fallback).
  useEffect(() => {
    if (!animationExportActive) return;
    const id = setInterval(() => {
      const p = animationExportProgressRef.current;
      if (p) setAnimationExportProgress({ current: p.current, total: p.total });
    }, 50);
    return () => clearInterval(id);
  }, [animationExportActive]);

  // Thumbnails are kept in memory only, not auto-generated

  /**
   * ATOMIC RESET: Clear all frame-by-frame state
   * Call this before loading a new project to prevent frame leakage
   */
  const resetFrameSession = useCallback(() => {
    console.log('[resetFrameSession] Clearing all frame state for new project load');

    // Stop playback if active
    if (playFramesAnimationRef.current) {
      cancelAnimationFrame(playFramesAnimationRef.current);
      playFramesAnimationRef.current = null;
    }
    if (playFramesIntervalRef.current) {
      clearInterval(playFramesIntervalRef.current);
      playFramesIntervalRef.current = null;
    }

    // Clear all frame state
    setFrames([]);
    setCurrentFrameIndex(0);
    setFrameMode(false);
    setIsPlayingFrames(false);
    setFrameHistory([]);
    setFrameHistoryIndex(0);
    frameCacheRef.current.clear();
    setCurrentProjectId(null);

    // ✅ CRITICAL: Do NOT clear workspace strokes!
    // Workspace strokes are loaded separately via LOAD_STATE dispatch in ExportScreen
    // Clearing them here would destroy the loaded project strokes
    // Only frame-related state is reset, workspace is preserved for animation backdrop

    console.log('[resetFrameSession] ✅ Frame session reset complete');
  }, []);

  /**
   * ATOMIC LOAD: Load animation project with full reset
   * This is the ONLY way to load frames into the session
   */
  const loadAnimationProjectAtomic = useCallback(async (
    projectId: string,
    frames: AnimationFrame[],
    selectedFrameIndex: number,
    fps: number
  ) => {
    try {
      console.log('[loadAnimationProject] Starting atomic load:', {
        projectId,
        frameCount: frames?.length ?? 0,
        selectedFrameIndex,
        fps
      });

      // STEP 1: Atomic reset - clear everything first
      resetFrameSession();

      // STEP 2: Validate data thoroughly
      if (!Array.isArray(frames) || frames.length === 0) {
        console.warn('[loadAnimationProject] ⚠️ Invalid frames data:', typeof frames, Array.isArray(frames) ? `length=${frames.length}` : 'not an array');
        return;
      }

      // Filter out invalid frames - only require basic frame structure
      // Note: Individual frame strokes may not be present; workspace strokes are handled separately
      const validFrames = frames.filter(f => f && typeof f === 'object' && (f.id || f.timestamp || Array.isArray(f.strokes)));
      if (validFrames.length === 0) {
        console.warn('[loadAnimationProject] ⚠️ No valid frames after filtering. Frame details:', frames.slice(0, 3).map(f => ({ type: typeof f, isObject: f && typeof f === 'object', keys: f ? Object.keys(f) : [] })));
        return;
      }

      // Ensure all frames have at least an empty strokes array for consistency
      const normalizedFrames = validFrames.map((f: any) => ({
        ...f,
        strokes: Array.isArray(f.strokes) ? f.strokes : []
      }));

      const safeIndex = Math.max(0, Math.min(selectedFrameIndex, normalizedFrames.length - 1));

      // STEP 3: Set new project state (use normalized frames)
      setCurrentProjectId(projectId);
      setFrames(normalizedFrames);
      setCurrentFrameIndex(safeIndex);
      setExportFps(fps);
      setFrameMode(true);

      // STEP 4: Load selected frame into workspace
      const selectedFrame = normalizedFrames[safeIndex];
      if (!selectedFrame) {
        console.warn('[loadAnimationProject] ⚠️ Selected frame not found');
        return;
      }

      dispatch({
        type: 'LOAD_STATE',
        payload: {
          strokes: cloneStrokes(selectedFrame?.strokes || []),
          brushEmoji,
          brushSize,
          brushOpacity,
          brushSpacing,
          brushRotation,
          recentEmojis,
          trace
        }
      });

      // STEP 5: Initialize frame history - use small batch to avoid memory issues
      // With very large frame counts, we defer full history initialization
      if (normalizedFrames.length <= 100) {
        // Small project: load all into history
        setFrameHistory([normalizedFrames.map((f: AnimationFrame) => ({ ...f, strokes: cloneStrokes(f.strokes) }))]);
      } else {
        // Large project: just load current frame for now
        console.log('[loadAnimationProject] ⚠️ Large project detected (' + normalizedFrames.length + ' frames), deferred full history load');
        setFrameHistory([normalizedFrames.slice(safeIndex, safeIndex + 1).map((f: AnimationFrame) => ({ ...f, strokes: cloneStrokes(f.strokes) }))]);
      }
      setFrameHistoryIndex(0);

      console.log('[loadAnimationProject] ✅ Project loaded successfully:', {
        projectId,
        frameCount: normalizedFrames.length,
        loadedFrameIndex: safeIndex,
        isLargeProject: normalizedFrames.length > 100
      });
    } catch (error) {
      console.error('[loadAnimationProject] ❌ Error during atomic load:', error);
      // Don't crash the app, just clear the state
      resetFrameSession();
    }
  }, [resetFrameSession, brushEmoji, brushSize, brushOpacity, brushSpacing, brushRotation, recentEmojis, trace, dispatch]);

  const toggleFrameMode = useCallback(async (enable: boolean) => {
    if (enable) {
      // Entering frame mode
      if (frames.length > 0) {
        // Frames already exist from this session - check if current strokes have changed
        const currentFrame = frames[currentFrameIndex] || frames[0];
        const currentStrokesHash = JSON.stringify(strokes.map(s => s.id));
        const savedStrokesHash = JSON.stringify(currentFrame.strokes.map(s => s.id));

        // If strokes have changed while in normal paint mode, update the frame
        if (currentStrokesHash !== savedStrokesHash || strokes.length !== currentFrame.strokes.length) {
          console.log('[Frame Mode] Syncing changes from normal paint mode to frame', currentFrameIndex);
          const updatedFrames = [...frames];
          updatedFrames[currentFrameIndex] = {
            ...updatedFrames[currentFrameIndex],
            strokes: cloneStrokes(strokes)
          };
          setFrames(updatedFrames);
          // Initialize frame history with updated frames
          setFrameHistory([updatedFrames.map(f => ({ ...f, strokes: cloneStrokes(f.strokes) }))]);
          setFrameHistoryIndex(0);
        } else {
          // No changes, just restore frame history
          setFrameHistory([frames.map(f => ({ ...f, strokes: cloneStrokes(f.strokes) }))]);
          setFrameHistoryIndex(0);
        }

        console.log('[Frame Mode] Restoring', frames.length, 'existing frames from session');
        setFrameMode(true);

        // Auto-generate thumbnails for frames that don't have them
        const framesWithoutThumbnails = frames.filter(f => !f.thumbnail || f.thumbnail.length === 0);
        if (framesWithoutThumbnails.length > 0) {
          console.log('[Frame Mode] Auto-generating', framesWithoutThumbnails.length, 'missing thumbnails...');
          // Trigger regeneration after a short delay to allow frame mode to initialize
          setTimeout(async () => {
            await regenerateAllThumbnails();
          }, 300);
        }
      } else {
        // No frames yet - create 1 frame for fresh project
        // First frame contains current strokes
        const initialFrames: AnimationFrame[] = [];
        for (let i = 0; i < 1; i++) {
          initialFrames.push({
            id: `${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`,
            strokes: i === 0 ? cloneStrokes(strokes) : [],
            timestamp: Date.now() + i
          });
        }
        setFrames(initialFrames);
        setCurrentFrameIndex(0);
        // Initialize frame history with first state
        setFrameHistory([initialFrames.map(f => ({ ...f, strokes: cloneStrokes(f.strokes) }))]);
        setFrameHistoryIndex(0);
        setFrameMode(true);
        console.log('[Frame Mode] Created 1 frame for fresh project, first frame has', strokes.length, 'strokes');
      }
    } else {
      const exitFrameIndex = currentFrameIndex;

      // Exiting frame mode - flush, save current frame, and take it to workspace
      await saveCurrentFrame();

      // Stop playback immediately so the active frame doesn't change while we sync
      if (playFramesIntervalRef.current) {
        clearInterval(playFramesIntervalRef.current);
        playFramesIntervalRef.current = null;
      }
      setIsPlayingFrames(false);

      const framesSnapshot = framesRef.current;
      const hasFrames = framesSnapshot.length > 0;
      const safeIndex = hasFrames
        ? Math.max(0, Math.min(exitFrameIndex, framesSnapshot.length - 1))
        : 0;
      const currentFrame = hasFrames ? (framesSnapshot[safeIndex] || framesSnapshot[0]) : undefined;

      // Generate Metal-rendered thumbnail for current frame before closing
      if (currentFrame) {
        try {
          const thumbnail = await generateProjectPreview(layeredForExport(currentFrame.strokes), 96, canvasSize, canvasSize);
          if (thumbnail) {
            setFrames(prev => {
              const sourceFrames = framesRef.current.length > 0 ? framesRef.current : prev;
              if (!sourceFrames || !sourceFrames[safeIndex]) {
                return prev;
              }
              const updated = [...sourceFrames];
              updated[safeIndex] = {
                ...updated[safeIndex],
                thumbnail
              };
              framesRef.current = updated;
              pendingFrameSyncRef.current = false;
              return updated;
            });
            console.log('[Frame Mode] Generated thumbnail for frame', safeIndex, 'before closing');
          }
        } catch (error) {
          console.error('[Frame Mode] Failed to generate thumbnail on close:', error);
        }
      }

      setFrameMode(false);

      // Clear frame history (but keep frames array in state!)
      setFrameHistory([]);
      setFrameHistoryIndex(-1);

      if (currentFrame) {
        // Load the currently selected frame strokes to workspace
        dispatch({
          type: 'LOAD_STATE',
          payload: {
            strokes: cloneStrokes(currentFrame.strokes),
            brushEmoji,
            brushSize,
            brushOpacity,
            brushSpacing,
            brushRotation,
            mirrorX,
            mirrorY,
            recentEmojis,
            trace: cloneTraceState(trace)
          }
        });

        console.log('[Frame Mode] Exited with frame', safeIndex, 'loaded to workspace, keeping', framesSnapshot.length, 'frames in session memory');
      } else {
        console.warn('[Frame Mode] Exited frame mode but no frames available to restore');
      }
    }
  }, [strokes, frames, currentFrameIndex, saveCurrentFrame, dispatch, brushEmoji, brushSize, brushOpacity, brushSpacing, brushRotation, mirrorX, mirrorY, recentEmojis, trace, canvasSize, regenerateAllThumbnails]);

  // Handle animation export - GIF, MOV, or PNG frames
  const handleAnimationExport = useCallback(async () => {
    if (animationExportInProgressRef.current) {
      console.log('[Animation Export] Ignoring duplicate trigger — export already in progress');
      return;
    }
    if (frames.length === 0) {
      CustomOverlayHelper.alert('No Frames', 'Please create at least one frame before exporting.');
      return;
    }
    animationExportInProgressRef.current = true;
    try {
      console.log('[Animation Export] Starting export...');
      console.log(`[Animation Export] Format: ${exportFormat}, FPS: ${exportFps}, Frames: ${frames.length}`);

      setAnimationExportActive(true);
      animationExportProgressRef.current = { current: 0, total: Math.max(1, frames.length) };
      setAnimationExportProgress({ current: 0, total: Math.max(1, frames.length) });
      setAnimationExportVisible(false);

      // Handle loop modes
      const exportFrames = exportLoopMode === 'pingpong'
        ? [...frames, ...frames.slice(1, -1).reverse()] // Ping-pong: forward then backward
        : exportLoopMode === 'reverse'
        ? [...frames].reverse() // Reverse: play backwards
        : frames; // Normal: play forwards

      console.log(`[Animation Export] Exporting ${exportFrames.length} frames as ${exportFormat.toUpperCase()}`);

      if (exportFormat === 'png') {
        // PNG Export - create all frames and share them via native share
        const exportSize = 512;
        const scaleFactor = exportSize / canvasSize;
        const pngPaths: string[] = [];

        console.log('[Animation Export] Generating PNG frames...');

        for (let i = 0; i < exportFrames.length; i++) {
          setAnimationExportProgress({ current: Math.round(((i + 1) / exportFrames.length) * 100), total: 100 });
          if (i % 2 === 0) {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }

          const frame = exportFrames[i];
          const scaledStrokes = layeredForExport(frame.strokes).map(stroke => ({
            ...stroke,
            size: stroke.size * scaleFactor,
            points: stroke.points.map(p => ({
              ...p,
              x: p.x * scaleFactor,
              y: p.y * scaleFactor * CANVAS_RATIO
            }))
          }));

          // Strokes are already scaled to exportSize; pass explicit canvas dims
          // so generateProjectPreview keeps scale=1 (no re-scale / zoom-to-fit).
          let dataUri = await generateProjectPreview(scaledStrokes, exportSize, exportSize, exportSize);
          if (!dataUri) {
            // Empty frame - create transparent PNG instead of throwing error
            console.log(`[Animation Export] Frame ${i + 1} is empty, creating transparent PNG`);
            // 1x1 transparent PNG base64 (smallest possible transparent image)
            dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
          }

          const pngPath = `${FileSystem.cacheDirectory}frame_${String(i + 1).padStart(4, '0')}.png`;
          await FileSystem.writeAsStringAsync(
            pngPath,
            dataUri.replace('data:image/png;base64,', ''),
            { encoding: FileSystem.EncodingType.Base64 }
          );
          pngPaths.push(pngPath);
        }

        setAnimationExportActive(false);
        animationExportProgressRef.current = null;
        setAnimationExportProgress(null);

        console.log(`[Animation Export] ✅ Generated ${pngPaths.length} PNG frames, opening share dialog...`);

        // Share all PNGs using native share - iOS supports multiple files
        try {
          // Share files one by one (native share doesn't support multiple files directly)
          for (let i = 0; i < pngPaths.length; i++) {
            await Sharing.shareAsync(pngPaths[i], {
              mimeType: 'image/png',
              dialogTitle: `Frame ${i + 1}/${pngPaths.length} - Tap to save or share`,
              UTI: 'public.png'
            });
          }
        } finally {
          // Clean up temp files after sharing
          for (const path of pngPaths) {
            await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
          }
        }

      } else {
        // GIF or MOV Export — frame-by-frame ANIMATION (each frame has its OWN
        // stroke set; NOT a timelapse of one painting).
        const fps = exportFps;
        const exportWidth = exportFormat === 'gif' ? 512 : canvasPixelSize;
        const exportHeight = Math.round(exportWidth * CANVAS_RATIO);
        const scaleFactor = exportWidth / canvasSize;
        const timestamp = Date.now();
        const outputPath = `${FileSystem.cacheDirectory}animation_${timestamp}.${exportFormat === 'mov' ? 'mp4' : 'gif'}`;
        const nativeOutputPath = outputPath.replace(/^file:\/\//, '');
        console.log('[Animation Export] Export dimensions:', exportWidth, 'x', exportHeight, '· frames:', exportFrames.length);

        let result: { outputPath: string };

        if (isAnimationExportNativeAvailable()) {
          // FAST PATH: render every frame on the native GPU engine (the same path
          // that makes timelapse export fast; smudge via bakedTile). No per-frame
          // JS render, no PNG base64/disk I/O → seconds instead of minutes.
          // Progress arrives on the native onExportProgress listener.
          console.log('[Animation Export] Native GPU frame exporter →', exportFormat.toUpperCase());
          const scaledFrames = exportFrames.map(frame =>
            frame.strokes.map(stroke => ({
              ...stroke,
              size: stroke.size * scaleFactor,
              points: stroke.points.map(p => ({ ...p, x: p.x * scaleFactor, y: p.y * scaleFactor })),
            }))
          );
          // Native emits onExportProgress {current: frameIndex+1, total: frameCount}
          // into the ref; the 50ms sampler shows "frame X / Y" + a moving bar.
          animationExportProgressRef.current = { current: 0, total: exportFrames.length };
          await exportAnimationFramesNative(
            scaledFrames as any,
            exportWidth,
            exportHeight,
            fps,
            exportFormat === 'mov' ? 'mov' : 'gif',
            nativeOutputPath
          );
          result = { outputPath };
          animationExportProgressRef.current = { current: exportFrames.length, total: exportFrames.length };
          setAnimationExportProgress({ current: exportFrames.length, total: exportFrames.length });
          console.log(`[Animation Export] ✅ ${exportFormat.toUpperCase()} created (native):`, outputPath);
        } else {
          // FALLBACK: JS frame-by-frame render (slower — only if native module is
          // missing, e.g. before a native rebuild).
          console.log('[Animation Export] Native unavailable — JS fallback for', exportFormat.toUpperCase());
          const framePaths: string[] = [];
          for (let i = 0; i < exportFrames.length; i++) {
            animationExportProgressRef.current = { current: i + 1, total: exportFrames.length };
            if (i % 2 === 0) {
              await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            const frame = exportFrames[i];
            const scaledStrokes = layeredForExport(frame.strokes).map(stroke => ({
              ...stroke,
              size: stroke.size * scaleFactor,
              points: stroke.points.map(p => ({ ...p, x: p.x * scaleFactor, y: p.y * scaleFactor }))
            }));
            let dataUri = await generateProjectPreview(scaledStrokes, exportWidth, exportWidth, exportHeight);
            if (!dataUri) {
              dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            }
            const framePath = `${FileSystem.cacheDirectory}frame_${String(i).padStart(4, '0')}.png`;
            await FileSystem.writeAsStringAsync(
              framePath,
              dataUri.replace('data:image/png;base64,', ''),
              { encoding: FileSystem.EncodingType.Base64 }
            );
            framePaths.push(framePath);
          }
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          const nativeFramePaths = framePaths.map(p => p.replace(/^file:\/\//, ''));
          if (exportFormat === 'mov') {
            await exportMp4FromFrames(nativeFramePaths, nativeOutputPath, { width: exportWidth, height: exportHeight, fps });
          } else {
            const delays = Array(framePaths.length).fill(1000 / fps);
            await exportGifFromFrames(nativeFramePaths, delays, nativeOutputPath, { width: exportWidth, height: exportHeight, loopCount: 0 });
          }
          result = { outputPath };
          animationExportProgressRef.current = { current: exportFrames.length, total: exportFrames.length };
          setAnimationExportProgress({ current: exportFrames.length, total: exportFrames.length });
          console.log(`[Animation Export] ✅ ${exportFormat.toUpperCase()} created (JS fallback):`, outputPath);
          for (const framePath of framePaths) {
            await FileSystem.deleteAsync(framePath, { idempotent: true }).catch(() => {});
          }
        }

        animationExportProgressRef.current = null;
        setAnimationExportProgress(null);

        // Save MOV to Photos library.
        if (exportFormat === 'mov') {
          try {
            const granted = await ensureMediaLibraryAccess();
            if (granted) {
              await MediaLibrary.saveToLibraryAsync(result.outputPath);
              console.log('[Animation Export] Saved to Photos library');
            }
          } catch (saveError) {
            console.warn('[Animation Export] Failed to save to Photos:', saveError);
          }
        }

        // Hide the loader and show the Export-Complete overlay: a mini preview
        // that PLAYS IN A LOOP (MOV via Video, GIF via animated Image) above the
        // Share button — instead of dumping straight into the iOS share sheet.
        // Keep the file (overlay needs it; it lives in the cache dir).
        setAnimationExportActive(false);
        emitAppEvent('export:complete', {
          uri: result.outputPath,
          filename: `Animation (${exportFrames.length} frames @ ${fps} FPS).${exportFormat === 'mov' ? 'mp4' : 'gif'}`,
          mediaType: exportFormat === 'mov' ? 'video' : 'image',
        });
      }

    } catch (error) {
      console.error('[Animation Export] ❌ Export failed:', error);
      console.error('[Animation Export] Error stack:', error instanceof Error ? error.stack : 'N/A');
      console.error('[Animation Export] Error details:', JSON.stringify(error, null, 2));
      CustomOverlayHelper.alert(
        'Export Failed',
        `${error instanceof Error ? error.message : 'Unknown error occurred'}\n\nCheck console logs for details.`
      );
      setAnimationExportActive(false);
      animationExportProgressRef.current = null;
      setAnimationExportProgress(null);
    } finally {
      animationExportInProgressRef.current = false;
    }
  }, [exportFormat, exportFps, exportLoopMode, frames, canvasSize, ensureMediaLibraryAccess]);

  // Save animation project - simplified to just save frames without preview
  const handleSaveAnimation = useCallback(async () => {
    try {
      console.log('[Save Animation] 💾 Saving animation project');
      setAnimationExportVisible(false);

      // Show saving status overlay
      let isSaving = true;
      const savingTimer = setTimeout(() => {
        if (isSaving) {
          CustomOverlayHelper.alert('Saving...', 'Creating animation project and preview...');
        }
      }, 1000);

      // CRITICAL: Save current frame's strokes BEFORE creating payload
      // This ensures the active frame's work is included
      await saveCurrentFrame();

      // Smart save logic: If already a saved project, just update frames and create preview
      // Otherwise, create new project with timestamp
      const isExistingProject = !!currentProjectId;
      const sessionName = currentProjectId || `animation_${new Date().toISOString().split('T')[0]}_${Date.now()}`;

      console.log('[Save Animation] 📌 Project mode:', isExistingProject ? 'UPDATE EXISTING' : 'CREATE NEW', '(' + sessionName + ')');

      // Load framer frames from storage
      let framerFrames = null;
      try {
        const framerData = await AsyncStorage.getItem('@emojipaint_framer_project');
        if (framerData) {
          framerFrames = JSON.parse(framerData);
        }
      } catch (error) {
        console.warn('[Save Animation] Failed to load framer frames:', error);
      }

      // Create project payload with frames
      // IMPORTANT: For animation projects, workspace strokes should be EMPTY (only use frame strokes)
      const payload = createProjectPayload({
        strokes: [], // CRITICAL FIX: Keep workspace strokes empty for animation-only projects
        trace,
        brushEmoji,
        brushSize,
        brushOpacity,
        brushSpacing,
        brushRotation,
        mirrorX,
        mirrorY,
        recentEmojis,
        preview: null, // Will create video preview instead
        frames: frames.map(f => ({
          id: f.id,
          strokes: cloneStrokes(f.strokes),
          timestamp: f.timestamp,
          thumbnail: f.thumbnail,
          renderedImageUri: f.renderedImageUri
        })),
        fps: exportFps,
        isAnimation: true,
        framerFrames // Include framer frames
      });

      // Save to current session using UNIFIED system (NEVER mutates runtime state)
      await saveProjectUnified(sessionName, payload, 'workspace');

      // Create mini preview video for project overview
      // Extract first frame as snapshot for instant preview display
      if (frames.length > 0 && frames[0].renderedImageUri) {
        try {
          // Create mini preview video from the first 3 frames
          const previewFrames = frames.slice(0, Math.min(3, frames.length));
          const previewDestination = `${FileSystem.cacheDirectory}animation_preview_${Date.now()}.mp4`
            .replace(/^file:\/\//, '');
          const miniPreviewUri = await exportMp4FromFrames(
            previewFrames.map(frame => frame.renderedImageUri as string),
            previewDestination,
            {
              width: 256,
              height: 256,
              fps: Math.min(exportFps, 12),
            }
          );

          if (miniPreviewUri) {
            // Save mini preview URI to project metadata
            await AsyncStorage.setItem(
              `@project_mini_preview_${sessionName}`,
              miniPreviewUri
            );
            console.log('[Save Animation] ✅ Created mini preview video');
          }
        } catch (previewError) {
          console.warn('[Save Animation] Could not create mini preview video:', previewError);
          // Fallback: Use first frame snapshot as preview
          try {
            await AsyncStorage.setItem(
              `@project_frame_snapshot_${sessionName}`,
              frames[0].renderedImageUri
            );
            console.log('[Save Animation] ✅ Saved first frame snapshot as fallback preview');
          } catch (snapshotError) {
            console.warn('[Save Animation] Could not save frame snapshot:', snapshotError);
          }
        }
      }

      // Update project ID if this was a new project
      if (!currentProjectId) {
        setCurrentProjectId(sessionName);
        console.log('[Save Animation] 🆕 New project created:', sessionName);
      } else {
        console.log('[Save Animation] ♻️ Existing project updated:', sessionName);
      }

      // IMPORTANT FIX: Don't auto-reload after save - this prevents stroke contamination
      // Just close the modal and show success message
      clearTimeout(savingTimer);
      isSaving = false;

      console.log('[Save Animation] ✅ Saved successfully:', {
        projectId: sessionName,
        frameCount: frames.length,
        isNewProject: !isExistingProject
      });

      // Show in-app success overlay instead of native alert
      emitAppEvent('animation:saved', {
        projectId: sessionName,
        frameCount: frames.length,
        isNewProject: !isExistingProject
      });

    } catch (error) {
      console.error('[Save Animation] ❌ Failed:', error);
      CustomOverlayHelper.alert('Save Failed', error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }, [frames, currentFrameIndex, exportFps, currentProjectId, strokes, trace, brushEmoji, brushSize, brushOpacity, brushSpacing, brushRotation, mirrorX, mirrorY, recentEmojis, saveCurrentFrame]);

  // Auto-save current frame DISABLED - only save when switching frames
  // (User requested: only update preview/glitch when clicking and changing frames, not on every stroke)
  useEffect(() => {
    // Disabled auto-save on every stroke - frames are now saved only when switching via switchToFrame()
    return;
  }, [frameMode, strokes, currentFrameIndex]);

  // Cleanup frame playback on unmount
  useEffect(() => {
    return () => {
      if (playFramesIntervalRef.current) {
        clearInterval(playFramesIntervalRef.current);
        playFramesIntervalRef.current = null;
      }
    };
  }, []);

  // Auto-regenerate missing frame thumbnails when frames are loaded
  useEffect(() => {
    if (!frameMode || frames.length === 0 || regeneratingThumbnails || isPlayingFrames) {
      return; // Don't regenerate during playback
    }

    // Find frames without thumbnails
    const framesWithoutThumbnails = frames
      .map((f, index) => ({ frame: f, index }))
      .filter(({ frame }) => !frame.thumbnail || frame.thumbnail.length === 0);

    if (framesWithoutThumbnails.length === 0) {
      return; // All frames have thumbnails
    }

    console.log(`[Thumbnail Regen] Found ${framesWithoutThumbnails.length} frames without thumbnails`);

    // Regenerate thumbnails in the background
    const regenerateThumbnails = async () => {
      setRegeneratingThumbnails(true);
      setTotalThumbnailsToRegenerate(framesWithoutThumbnails.length);
      setThumbnailsRegenerated(0);

      for (const { frame, index } of framesWithoutThumbnails) {
        try {
          // Generate thumbnail using Metal stroke replay
          const thumbnail = await generateProjectPreview(layeredForExport(frame.strokes), 96, canvasSize, canvasSize);

          if (thumbnail) {
            // Update frame with generated thumbnail
            setFrames(prev => {
              const newFrames = [...prev];
              newFrames[index] = {
                ...newFrames[index],
                thumbnail
              };
              return newFrames;
            });

            setThumbnailsRegenerated(prev => prev + 1);
            console.log(`[Thumbnail Regen] Generated thumbnail for frame ${index + 1}/${frames.length}`);
          }
        } catch (error) {
          console.error(`[Thumbnail Regen] Failed to generate thumbnail for frame ${index}:`, error);
        }
      }

      setRegeneratingThumbnails(false);
      console.log('[Thumbnail Regen] Completed');
    };

    // Delay thumbnail regeneration by 500ms to avoid interfering with initial render
    const timer = setTimeout(() => {
      regenerateThumbnails();
    }, 500);

    return () => clearTimeout(timer);
  }, [frameMode, frames.length, regeneratingThumbnails, canvasSize, isPlayingFrames]);

/**
 * CENTRALIZED POINT VALIDATION - Prevents (0,0) jumps and invalid coordinates
 * This function implements all validation checks before adding any point to the stroke.
 * Returns true if point is valid and safe to add, false if it should be rejected.
 */
const validatePointBeforeAppend = useCallback((point: StrokePoint, canvasSizePx: number): boolean => {
  // A) Reject NaN or infinite coordinates
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    if (__DEV__) {
      console.warn('[Point Validation] Rejected non-finite point:', point);
    }
    return false;
  }

  // B) STRICTLY reject significantly negative coordinates - these are from slider/UI touches
  // Canvas coordinates should never be significantly negative (origin is top-left at 0,0)
  // Allow tiny negative values (-5px) for edge touch precision, but reject slider touches (< -5px)
  const NEGATIVE_THRESHOLD = -5;
  if (point.x < NEGATIVE_THRESHOLD || point.y < NEGATIVE_THRESHOLD) {
    if (__DEV__) {
      console.warn('[Point Validation] Rejected NEGATIVE coordinates (slider touch):', point);
    }
    return false;
  }

  // C) Reject points far outside canvas bounds (allow small margin for edge touches)
  const CANVAS_MARGIN = 50; // Reduced margin - be stricter
  if (point.x > canvasSizePx + CANVAS_MARGIN || point.y > canvasSizePx + CANVAS_MARGIN) {
    if (__DEV__) {
      console.warn('[Point Validation] Rejected out-of-bounds point:', point, 'canvasSize:', canvasSizePx);
    }
    return false;
  }

  // D) MAX JUMP DETECTION - Reject points that jump too far from last point
  // This catches slider contamination, coordinate space errors, and touch switching
  const lastPoint = lastPointRef.current;
  if (lastPoint) {
    const dx = point.x - lastPoint.x;
    const dy = point.y - lastPoint.y;
    const jumpDistance = Math.sqrt(dx * dx + dy * dy);

    // Keep this adaptive: quality mode tightens validation a bit, speed mode allows larger hand motion.
    // Generous so fast smudge/paint flicks aren't rejected (which would gap the stroke); slider/UI
    // contamination is already caught by the negative-coordinate check above.
    const MAX_JUMP_RATIO = brushPerformanceModeRef.current === 'quality' ? 0.5 : 0.65;
    const maxJumpDistance = canvasSizePx * MAX_JUMP_RATIO;

    if (jumpDistance > maxJumpDistance) {
      if (__DEV__) {
        console.warn(
          `[Point Validation] Rejected huge jump of ${jumpDistance.toFixed(0)}px ` +
          `(max: ${maxJumpDistance.toFixed(0)}px) from ` +
          `(${lastPoint.x.toFixed(0)}, ${lastPoint.y.toFixed(0)}) to ` +
          `(${point.x.toFixed(0)}, ${point.y.toFixed(0)})`
        );
      }
      return false;
    }
  }

  // E) Reject suspicious (0,0) or near-origin points during active drawing
  // Allow first point to be anywhere, but reject origin jumps mid-stroke
  if (lastPoint) {
    const distFromOrigin = Math.sqrt(point.x * point.x + point.y * point.y);
    if (distFromOrigin < 10) {
      if (__DEV__) {
        console.warn('[Point Validation] Rejected near-origin point during active stroke:', point);
      }
      return false;
    }
  }

  return true;
}, []);

const appendSmoothedSample = useCallback((sample: StrokePoint, targetSpacing: number, canvasSizePx: number) => {
  const raw = liveRawPointsRef.current;
  const output = liveOutputPointsRef.current;
  const stroke = liveStrokeRef.current;
  if (!stroke) {
    return false;
  }

  // CRITICAL: Validate point before appending - prevents (0,0) jumps and coordinate errors
  if (!validatePointBeforeAppend(sample, canvasSizePx)) {
    return false; // Reject invalid point, don't add to stroke
  }

  const prevLength = output.length;
  raw.push(sample);

  if (raw.length === 1) {
    output.length = 0;
    output.push({ ...sample });
    liveSpacingCarryRef.current = 0;
    stroke.points = output;
    return true;
  }

  const workletPoints = computeSmoothedSamplePointsOnUI({
    rawTail: raw.slice(-4),
    outputTail: output.length > 0 ? output[output.length - 1] : null,
    sample,
    targetSpacing,
    strokeSize: stroke.size,
  });

  if (workletPoints.length === 0) {
    return false;
  }

  output.push(...workletPoints);
  liveSpacingCarryRef.current = 0;
  stroke.points = output;

  // REAL-TIME PLAY & PAINT: Add new points to frame IMMEDIATELY
  if (frameModeRef.current && isPlayingFramesRef.current) {
    const newPointsAdded = output.slice(prevLength);
    if (newPointsAdded.length > 0) {
      syncLiveFrameCopiesImmediate(newPointsAdded);
    }
  }

  return true;
}, [syncLiveFrameCopiesImmediate, validatePointBeforeAppend]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    void Haptics.selectionAsync();
    // Close FIRST. Preloading a custom brush reads the whole custom-brush-PNG blob out of
    // AsyncStorage and JSON.parses it (hundreds of KB of base64) — awaiting that before closing
    // left the picker sitting open for 1-3s on a cache miss. The stamp cache resolves the PNG on
    // demand anyway, so this only needs to be warm, not awaited.
    dispatch({ type: 'SET_BRUSH_EMOJI', emoji });
    centerEmojiInPicker(emoji, { animated: false });
    setEmojiPickerVisible(false);
    if (isCustomBrushReference(emoji)) {
      void getCustomBrushPNGData(emoji).catch((error) => {
        console.warn('[Brush] Failed to preload custom brush:', error);
      });
    }
  }, [centerEmojiInPicker, dispatch]);

  const handleLoadCustomBrushToWorkspace = useCallback(async (emoji: string) => {
    if (isCustomBrushReference(emoji)) {
      try {
        await getCustomBrushPNGData(emoji);
      } catch (error) {
        console.warn('[Brush] Failed to preload custom brush:', error);
      }
    }

    brushEmojiRef.current = emoji;
    dispatch({ type: 'SET_BRUSH_EMOJI', emoji });
    setEmojiPickerVisible(false);
    activateEmojiPlaneTool();
    requestAnimationFrame(() => {
      createEmojiPlane();
    });
  }, [activateEmojiPlaneTool, createEmojiPlane, dispatch]);

  // Save frame history for undo/redo
  const saveFrameHistory = useCallback(() => {
    if (!frameMode) return;
    setFrameHistory(prev => {
      // Trim history after current index
      const newHistory = prev.slice(0, frameHistoryIndex + 1);
      // Add current state
      newHistory.push(frames.map(f => ({ ...f, strokes: cloneStrokes(f.strokes) })));
      // Limit history to 50 states
      if (newHistory.length > 50) {
        newHistory.shift();
        return newHistory;
      }
      return newHistory;
    });
    setFrameHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [frameMode, frames, frameHistoryIndex]);

  const undoStroke = useCallback(() => {
    // In emoji plane mode, undo plane operations (corner changes, plane creation/deletion)
    if (isEmojiPlaneActive) {
      if (planeUndoStack.length === 0) {
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      dispatch({ type: 'UNDO_PLANE' });
      console.log('[PAINT PLANE] Undo plane operation');
      return;
    }

    // In frame mode, undo strokes within the current frame (not entire frame operations)
    if (frameMode) {
      if (strokes.length === 0) {
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      dispatch({ type: 'UNDO', count: 1 });
      return;
    }

    // Normal stroke undo
    if (strokes.length === 0) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    dispatch({ type: 'UNDO', count: 1 });
  }, [isEmojiPlaneActive, planeUndoStack.length, frameMode, dispatch, strokes.length]);

  const redoStroke = useCallback(() => {
    // In emoji plane mode, redo plane operations
    if (isEmojiPlaneActive) {
      if (planeRedoStack.length === 0) {
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      dispatch({ type: 'REDO_PLANE' });
      console.log('[PAINT PLANE] Redo plane operation');
      return;
    }

    // In frame mode, redo strokes within the current frame (not entire frame operations)
    if (frameMode) {
      if (undoStack.length === 0) {
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      dispatch({ type: 'REDO', count: 1 });
      return;
    }

    // Normal stroke redo
    if (undoStack.length === 0) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    dispatch({ type: 'REDO', count: 1 });
  }, [isEmojiPlaneActive, frameMode, undoStack.length, planeRedoStack.length, dispatch]);

  const ensureMediaLibraryAccess = useCallback(async () => {
    const current = await MediaLibrary.getPermissionsAsync();
    if (current.granted) {
      return true;
    }
    if (!current.canAskAgain) {
      return false;
    }
    const request = await MediaLibrary.requestPermissionsAsync();
    return request.granted;
  }, []);

  // Export options overlay state
  const [exportOptionsVisible, setExportOptionsVisible] = useState(false);
  const [exportOptionsUri, setExportOptionsUri] = useState<string | null>(null);
  const [exportOptionsType, setExportOptionsType] = useState<'image' | 'video'>('image');
  const [pngExportSize, setPngExportSize] = useState<'4k' | '8k' | '12k'>('4k');

  // Auto-regenerate PNG when quality changes
  useEffect(() => {
    // Only regenerate if export options overlay is already open
    if (exportOptionsVisible && exportOptionsType === 'image' && !isExporting) {
      console.log('[Export] Quality changed to', pngExportSize, '- regenerating PNG...');
      void exportCurrentPainting();
    }
  }, [pngExportSize]); // Only watch pngExportSize

  const showExportOptions = useCallback((uri: string, type: 'image' | 'video') => {
    setExportOptionsUri(uri);
    setExportOptionsType(type);
    setExportOptionsVisible(true);
    // Background: save a permanent copy to app storage so artwork is always accessible
    if (type === 'image') {
      const side = pngExportSize === '12k' ? 12288 : pngExportSize === '8k' ? 8192 : 4096;
      void addImageToStorage(uri, side, side).then(meta => {
        if (meta) {
          setHasMovVideos(true);
          setHasVideosInStorage(true);
        }
      });
    }
  }, [pngExportSize]);

  const closeExportOptions = useCallback(() => {
    setExportOptionsVisible(false);
    setExportOptionsUri(null);
  }, []);

  const handleExportOptionCancel = useCallback(async () => {
    const uriToCleanup = exportOptionsUri;
    closeExportOptions();

    // Clean up temp file when user cancels
    if (uriToCleanup) {
      try {
        await FileSystem.deleteAsync(uriToCleanup, { idempotent: true });
      } catch (e) {
        console.log('Could not delete temp file on cancel:', e);
      }
    }
  }, [closeExportOptions, exportOptionsUri]);

  const handleExportOptionShare = useCallback(async () => {
    if (!exportOptionsUri) return;
    const uriToCleanup = exportOptionsUri;

    try {
      const mimeType = exportOptionsType === 'video' ? 'video/quicktime' : 'image/png';
      const uti = exportOptionsType === 'video' ? 'public.movie' : 'public.png';

      // Share first, then close the modal after share sheet is dismissed
      await Sharing.shareAsync(exportOptionsUri, {
        mimeType,
        dialogTitle: exportOptionsType === 'video' ? 'Share Timelapse Video' : 'Share Emoji Painting',
        UTI: uti
      });

      // Close the export options modal after share completes
      closeExportOptions();
    } catch (error) {
      console.error('Share failed:', error);
      closeExportOptions();
      CustomOverlayHelper.alert('Share failed', 'Could not share your artwork. Please try again.');
    } finally {
      // Clean up temp file after sharing
      try {
        await FileSystem.deleteAsync(uriToCleanup, { idempotent: true });
      } catch (e) {
        console.log('Could not delete temp file:', e);
      }
    }
  }, [closeExportOptions, exportOptionsType, exportOptionsUri]);

  const handleExportOptionEmojispray = useCallback(async () => {
    if (!exportOptionsUri) return;
    const uriToCleanup = exportOptionsUri;
    closeExportOptions();

    try {
      const status = await sendImageToEmojispray(exportOptionsUri);
      if (status === 'not_installed') {
        CustomOverlayHelper.alert('Emojispray not installed', 'Install Emojispray from the App Store to drop this artwork into AR.');
      } else if (status === 'failed') {
        CustomOverlayHelper.alert('Emojispray unavailable', 'Could not hand off to Emojispray.');
      }
    } catch (error) {
      console.warn('Emojispray handoff failed', error);
      CustomOverlayHelper.alert('Emojispray unavailable', 'Could not hand off to Emojispray.');
    } finally {
      // Clean up temp file after Emojispray handoff
      try {
        await FileSystem.deleteAsync(uriToCleanup, { idempotent: true });
      } catch (e) {
        console.log('Could not delete temp file:', e);
      }
    }
  }, [closeExportOptions, exportOptionsUri]);

  const handleExportOptionOpenInAr = useCallback(async () => {
    if (!exportOptionsUri) return;
    const uri = exportOptionsUri;
    const isVideo = exportOptionsType === 'video';
    closeExportOptions();
    setArPendingPlacementUri(uri);
    setArPendingPlacementIsVideo(isVideo);
    setArChooserVisible(false);
    setArPaintingVisible(true);
    void Haptics.selectionAsync();
  }, [closeExportOptions, exportOptionsType, exportOptionsUri]);

  // "Open in AR" from the Export-Complete overlay (timelapse video). The overlay
  // sits at app-root ABOVE the Timelapse screen, so we must (1) copy the video to
  // a permanent path (temp files get cleaned + storage is what the user wants),
  // (2) pop the Timelapse screen so PaintScreen's AR overlay is actually visible,
  // then (3) open AR with the pending video placement (native startPlacement →
  // "ready to place" in front of the camera + a paste button, exactly like the
  // in-AR add-media flow).
  useEffect(() => {
    const unsub = addAppEventListener('ar:placeVideo', (payload: any) => {
      const raw = typeof payload === 'string' ? payload : payload?.uri;
      if (!raw) return;
      void (async () => {
        const srcUri = String(raw).startsWith('file://') ? String(raw) : `file://${raw}`;
        let placePath = srcUri.replace(/^file:\/\//, '');
        // Persist the exported video so it survives temp cleanup / storage save.
        try {
          const dir = `${FileSystem.documentDirectory}ar_videos/`;
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
          const ext = (placePath.split('.').pop() || 'mov').split('?')[0];
          const destUri = `${dir}ar_${Date.now()}.${ext}`;
          await FileSystem.copyAsync({ from: srcUri, to: destUri });
          placePath = destUri.replace(/^file:\/\//, '');
          console.log('[AR placeVideo] persisted video →', placePath);
        } catch (copyErr) {
          console.warn('[AR placeVideo] copy failed, using source path:', copyErr);
        }
        // Close the Timelapse (or any) screen so the AR overlay is on top.
        try { navigation.dispatch(StackActions.popTo('Paint')); } catch (navErr) { console.warn('[AR placeVideo] popTo failed', navErr); }
        setArChooserVisible(false);
        setFaceFilterOverlayVisible(false);
        setArPendingPlacementUri(placePath);
        setArPendingPlacementIsVideo(true);
        setArPaintingVisible(true);
        void Haptics.selectionAsync();
      })();
    });
    return unsub;
  }, [navigation]);

  /**
   * Capture canvas as small emoji-sized PNG and convert to base64
   */
  const captureCanvasAsEmojiPNG = useCallback(async (): Promise<string | null> => {
    try {
      const target = brushCaptureRef.current ?? challengeCanvasRef.current ?? viewShotRef.current;
      if (!target) {
        console.warn('[captureCanvasAsEmojiPNG] No canvas ref available');
        return null;
      }

      // Capture with transparent background
      // Use null instead of 'transparent' - react-native-view-shot handles null as transparent
      const emojiSize = 256;
      const result = await captureRef(target, {
        format: 'png',
        quality: 1.0,
        result: 'tmpfile',
        width: emojiSize,
        height: emojiSize,
        backgroundColor: null // null = transparent background in react-native-view-shot
      });

      if (!result) {
        console.error('[captureCanvasAsEmojiPNG] captureRef returned null');
        return null;
      }

      // Convert file to base64
      const fileUri = result.startsWith('file://') ? result : `file://${result}`;
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      const dataUri = `data:image/png;base64,${base64}`;

      console.log('[captureCanvasAsEmojiPNG] ✅ Canvas captured with transparent background');
      return dataUri;
    } catch (error) {
      console.error('[captureCanvasAsEmojiPNG] Error during capture:', error);
      return null;
    }
  }, []);

  const saveCustomBrushHandler = useCallback(async () => {
    try {
      // Capture canvas as emoji PNG
      const pngDataUri = await captureCanvasAsEmojiPNG();
      if (!pngDataUri) {
        CustomOverlayHelper.alert('Error', 'Failed to capture canvas as PNG');
        return;
      }

      // Extract base64 data from data URI
      const rawBase64 = pngDataUri.replace('data:image/png;base64,', '');

      // The capture is the whole canvas rect, so the artwork is surrounded by empty margin. Trim it
      // so the stamp is the artwork itself rather than a mostly-empty square.
      const base64Data = cropBrushPngMargins(rawBase64);

      // Save PNG data separately and get a brushPngId
      const brushPngId = await saveCustomBrushPNG(base64Data);
      if (!brushPngId) {
        CustomOverlayHelper.alert('Error', 'Failed to save PNG data');
        return;
      }

      // Pre-load the PNG into cache so it's ready for rendering
      console.log(`[saveCustomBrushHandler] Pre-loading ${brushPngId} into cache...`);
      await getCustomBrushPNGData(brushPngId);

      // Save brush metadata with brushPngId reference instead of data URI
      const result = await saveCustomBrush({
        brushPngId: brushPngId, // Use ID reference instead of data URI
        size: brushSize,
        opacity: brushOpacity,
        spacing: brushSpacing,
        rotation: brushRotation,
        mirrorX: mirrorX,
        mirrorY: mirrorY,
        name: `Brush - PNG @ ${new Date().toLocaleTimeString()}`
      });

      if (result) {
        CustomOverlayHelper.alert('Saved!', 'Custom brush saved with current canvas and brush settings', [
          {
            text: 'OK',
            onPress: () => {
              // Auto-open emoji picker to show and select the new custom brush
              setTimeout(() => {
                setEmojiPickerVisible(true);
              }, 300);
            }
          }
        ]);
      } else {
        CustomOverlayHelper.alert('Error', 'Failed to save custom brush');
      }
    } catch (error) {
      console.error('Failed to save custom brush:', error);
      CustomOverlayHelper.alert('Error', 'Failed to save custom brush: ' + String(error));
    }
  }, [brushSize, brushOpacity, brushSpacing, brushRotation, mirrorX, mirrorY, captureCanvasAsEmojiPNG, setEmojiPickerVisible]);

  const handleExportOptionSaveToPhotos = useCallback(async () => {
    if (!exportOptionsUri) return;
    const uriToCleanup = exportOptionsUri;
    closeExportOptions();

    try {
      const granted = await ensureMediaLibraryAccess();
      if (!granted) {
        CustomOverlayHelper.alert('Permission needed', 'Allow photo library access to save your artwork.');
        // Still clean up even if permission denied
        await FileSystem.deleteAsync(uriToCleanup, { idempotent: true }).catch(() => {});
        return;
      }
      await MediaLibrary.saveToLibraryAsync(exportOptionsUri);
      CustomOverlayHelper.alert('Saved', exportOptionsType === 'video' ? 'Video saved to your Photos library.' : 'Image saved to your Photos library.');
    } catch (error) {
      console.error('Save to photos failed:', error);
      CustomOverlayHelper.alert('Save failed', 'Could not save to Photos library. Please try again.');
    } finally {
      // Clean up temp file after saving
      try {
        await FileSystem.deleteAsync(uriToCleanup, { idempotent: true });
      } catch (e) {
        console.log('Could not delete temp file:', e);
      }
    }
  }, [closeExportOptions, ensureMediaLibraryAccess, exportOptionsType, exportOptionsUri]);

  const deliverExportedImage = useCallback(
    async (uri: string) => {
      // Use custom overlay instead of ActionSheetIOS
      showExportOptions(uri, 'image');
    },
    [showExportOptions]
  );

  const panGesture = useMemo(() => {
    return Gesture.Pan()
      .onBegin(() => {
        panStartX.value = offsetX.value;
        panStartY.value = offsetY.value;
        runOnJS(setTraceAdjusting)(true);
      })
      .onUpdate((event) => {
        offsetX.value = panStartX.value + event.translationX;
        offsetY.value = panStartY.value + event.translationY;
      })
      .onEnd(() => {
        runOnJS(commitTrace)({ offsetX: offsetX.value, offsetY: offsetY.value });
        runOnJS(setTraceAdjusting)(false);
      })
      .onFinalize(() => {
        runOnJS(commitTrace)({ offsetX: offsetX.value, offsetY: offsetY.value });
        runOnJS(setTraceAdjusting)(false);
      });
  }, [offsetX, offsetY, commitTrace]);

  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .onStart(() => {
        pinchStartScale.value = scale.value;
      })
      .onUpdate((event) => {
        const next = pinchStartScale.value * event.scale;
        scale.value = Math.min(Math.max(next, MIN_TRACE_SCALE), MAX_TRACE_SCALE);
      })
      .onEnd(() => {
        runOnJS(commitTrace)({ scale: scale.value });
      })
      .onFinalize(() => {
        runOnJS(commitTrace)({ scale: scale.value });
      });
  }, [scale, commitTrace]);

  const rotationGesture = useMemo(() => {
    return Gesture.Rotation()
      .onStart(() => {
        rotationStart.value = rotation.value;
      })
      .onUpdate((event) => {
        rotation.value = rotationStart.value + event.rotation;
      })
      .onEnd(() => {
        runOnJS(commitTrace)({ rotation: rotation.value });
      })
      .onFinalize(() => {
        runOnJS(commitTrace)({ rotation: rotation.value });
      });
  }, [rotation, commitTrace]);

  const gesture = useMemo(() => Gesture.Simultaneous(panGesture, pinchGesture, rotationGesture), [panGesture, pinchGesture, rotationGesture]);

  const canvasScale = useSharedValue(1);
  const canvasStartScale = useSharedValue(1);
  const canvasTranslateX = useSharedValue(0);
  const canvasTranslateY = useSharedValue(0);
  const canvasPanStartX = useSharedValue(0);
  const canvasPanStartY = useSharedValue(0);
  // Track the translation at the beginning of a pinch gesture. These values
  // allow us to compute a new translation that anchors the pinch around the
  // gesture’s focal point. Without this the painting scales around the centre
  // of the viewport, which can push it off‑screen.
  const pinchStartTranslationX = useSharedValue(0);
  const pinchStartTranslationY = useSharedValue(0);
  const canvasViewportWidth = useSharedValue(canvasSize);
  const canvasViewportHeight = useSharedValue(canvasSize * CANVAS_RATIO);
  const [viewShotLayout, setViewShotLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const timerTranslateX = useSharedValue(0);
  const timerTranslateY = useSharedValue(0);
  const timerPanStartX = useSharedValue(0);
  const timerPanStartY = useSharedValue(0);
  const timerScale = useSharedValue(IS_IPAD ? 0.95 : 0.9);
const timerScaleStart = useSharedValue(1);
const timerHasCustomPositionRef = useRef(false);
  const [viewShotWindowRect, setViewShotWindowRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [infoButtonWindowRect, setInfoButtonWindowRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const promptCards = useMemo(() => dailyPrompts.slice(0, 3), [dailyPrompts]);
  const promptCardAnimationsRef = useRef<Record<string, { entry: RNAnimated.Value; exit: RNAnimated.Value }>>({});
  const promptOverlayDismissedRef = useRef(false);
  const promptExitVectorRef = useRef<{ x: number; y: number }>({ x: 0, y: -160 });
  const promptAutoDismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [promptOverlayDismissed, setPromptOverlayDismissed] = useState(false);
  const [promptOverlayVisible, setPromptOverlayVisible] = useState(false);
  // Top notification-style daily-topics panel (replaces the old bottom pill auto-show).
  const [topicsNotificationVisible, setTopicsNotificationVisible] = useState(false);
  const [galleryVoteUpdate, setGalleryVoteUpdate] = useState<GalleryVoteUpdate | null>(null);
  const [galleryVoteCheckCompleted, setGalleryVoteCheckCompleted] = useState(false);
  const galleryVoteCheckInFlightRef = useRef(false);
  const galleryVoteLastCheckedRef = useRef(0);
  const galleryVoteMountedRef = useRef(true);
  const promptRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptDismissSoundRef = useRef<Audio.Sound | null>(null);
  const promptOverlayMetrics = useMemo(() => {
    if (!viewShotLayout || promptCards.length === 0) {
      return null;
    }
    const canvasAreaWidth = canvasSize;
    const canvasAreaHeight = canvasSize * CANVAS_RATIO;
    const stageWidth = viewShotLayout.width;
    const stageHeight = viewShotLayout.height;
    const canvasLeft = viewShotLayout.x + Math.max(0, (stageWidth - canvasAreaWidth) / 2);
    const canvasTop = viewShotLayout.y + Math.max(0, (stageHeight - canvasAreaHeight) / 2);
    const useHorizontalLayout = isIpadLandscape || isWidePortraitTablet;
    const stackHeight = useHorizontalLayout
      ? PROMPT_CARD_HEIGHT
      : PROMPT_CARD_HEIGHT * promptCards.length + PROMPT_CARD_GAP * Math.max(0, promptCards.length - 1);
    const phoneOffset = IS_IPAD ? 0 : 100;
    const baseTop = canvasTop + canvasAreaHeight - stackHeight - 12 + phoneOffset;
    const minTop = viewShotLayout.y + 8;
    const maxTop = viewShotLayout.y + stageHeight - stackHeight - 12;
    const top = Math.max(minTop, Math.min(baseTop, maxTop));
    return {
      top,
      left: canvasLeft,
      width: canvasAreaWidth,
      height: stackHeight + 16
    };
  }, [canvasSize, isIpadLandscape, isWidePortraitTablet, promptCards.length, viewShotLayout]);

  const getPromptCardKey = useCallback((prompt: DailyPrompt) => {
    return `${prompt.emoji}-${prompt.topic}-${prompt.timeMinutes}`;
  }, []);

  const getPromptAnim = useCallback(
    (key: string) => {
      let anim = promptCardAnimationsRef.current[key];
      if (!anim) {
        anim = { entry: new RNAnimated.Value(0), exit: new RNAnimated.Value(0) };
        promptCardAnimationsRef.current[key] = anim;
      }
      return anim;
    },
    []
  );

  const playPromptDismissSound = useCallback(async () => {
    const existing = promptDismissSoundRef.current;
    if (existing) {
      try {
        await existing.replayAsync();
        return;
      } catch {
        try {
          await existing.unloadAsync();
        } catch {
          // ignore unload failure
        }
        promptDismissSoundRef.current = null;
      }
    }
    try {
      const { sound } = await Audio.Sound.createAsync(require('../../assets/sounds/wobble3.wav'), { volume: 0.25 });
      promptDismissSoundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status?.isLoaded) {
          return;
        }
        if (status.didJustFinish) {
          sound.setOnPlaybackStatusUpdate(null);
          sound.unloadAsync().catch(() => undefined);
          if (promptDismissSoundRef.current === sound) {
            promptDismissSoundRef.current = null;
          }
        }
      });
      await sound.playAsync();
    } catch (error) {
      console.warn('prompt click sound failed', error);
    }
  }, []);
  const captureViewShotWindowRect = useCallback(() => {
    if (!viewShotRef.current || typeof (viewShotRef.current as any)?.measureInWindow !== 'function') {
      return;
    }
    try {
      (viewShotRef.current as any).measureInWindow((x: number, y: number, width: number, height: number) => {
        setViewShotWindowRect({ x, y, width, height });
      });
    } catch {
      // ignore measurement failures
    }
  }, []);

const markTimerGrabbed = useCallback(() => {
  timerHasCustomPositionRef.current = true;
}, []);

  const handleViewShotLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setViewShotLayout({ x, y, width, height });
    canvasViewportWidth.value = width;
    canvasViewportHeight.value = height;
    if (!timerHasCustomPositionRef.current) {
      const limitX = Math.max(0, width / 2 - TIMER_OVERLAY_MARGIN);
      const limitY = Math.max(0, height / 2 - TIMER_OVERLAY_MARGIN);
      const desiredX = limitX - 90;
      const desiredY = -limitY + 130;
      timerTranslateX.value = Math.max(-limitX, Math.min(limitX, desiredX));
      timerTranslateY.value = Math.max(-limitY, Math.min(limitY, desiredY));
    } else {
      const limitX = Math.max(0, width / 2 - TIMER_OVERLAY_MARGIN);
      const limitY = Math.max(0, height / 2 - TIMER_OVERLAY_MARGIN);
      timerTranslateX.value = Math.max(-limitX, Math.min(limitX, timerTranslateX.value));
      timerTranslateY.value = Math.max(-limitY, Math.min(limitY, timerTranslateY.value));
    }
    requestAnimationFrame(captureViewShotWindowRect);
  }, [canvasViewportHeight, canvasViewportWidth, captureViewShotWindowRect, timerTranslateX, timerTranslateY]);

  useEffect(() => {
    if (viewShotLayout) {
      captureViewShotWindowRect();
    }
  }, [captureViewShotWindowRect, viewShotLayout]);

const handleInfoButtonLayout = useCallback((rect: { x: number; y: number; width: number; height: number }) => {
    setInfoButtonWindowRect(rect);
  }, []);

const computePromptExitVector = useCallback(() => {
    if (promptOverlayMetrics && infoButtonWindowRect) {
      const sourceX = promptOverlayMetrics.left + promptOverlayMetrics.width / 2;
      const sourceY = promptOverlayMetrics.top + promptOverlayMetrics.height / 2;
      const targetX = infoButtonWindowRect.x + infoButtonWindowRect.width / 2;
      const targetY = infoButtonWindowRect.y + infoButtonWindowRect.height / 2;
      return { x: targetX - sourceX, y: targetY - sourceY };
    }
    if (viewShotWindowRect && infoButtonWindowRect) {
      const sourceX = viewShotWindowRect.x + viewShotWindowRect.width / 2;
      const sourceY = viewShotWindowRect.y + viewShotWindowRect.height - PROMPT_CARD_HEIGHT - 24;
      const targetX = infoButtonWindowRect.x + infoButtonWindowRect.width / 2;
      const targetY = infoButtonWindowRect.y + infoButtonWindowRect.height / 2;
      return { x: targetX - sourceX, y: targetY - sourceY };
    }
    if (viewShotLayout) {
      return {
        x: viewShotLayout.width * 0.25,
        y: -(viewShotLayout.height * 0.35)
      };
    }
    return { x: screenWidth * 0.2, y: -screenHeight * 0.25 };
  }, [infoButtonWindowRect, promptOverlayMetrics, viewShotLayout, viewShotWindowRect]);

  const dismissPromptOverlay = useCallback(
    (_reason: 'auto' | 'tap') => {
      if (promptOverlayDismissedRef.current || !promptOverlayVisible) {
        return;
      }
      promptOverlayDismissedRef.current = true;
      if (promptAutoDismissTimeoutRef.current) {
        clearTimeout(promptAutoDismissTimeoutRef.current);
        promptAutoDismissTimeoutRef.current = null;
      }
      const exitVector = computePromptExitVector();
      promptExitVectorRef.current = exitVector;
      const animations = promptCards.map((prompt, index) => {
        const key = getPromptCardKey(prompt);
        const anim = getPromptAnim(key);
        return new Promise<void>((resolve) => {
          RNAnimated.timing(anim.exit, {
            toValue: 1,
            duration: 520,
            delay: index * 90,
            easing: RNEasing.in(RNEasing.cubic),
            useNativeDriver: true
          }).start(() => resolve());
        });
      });
      Promise.all(animations).then(() => {
        setPromptOverlayVisible(false);
        setPromptOverlayDismissed(true);
        playPromptDismissSound();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      });
    },
    [computePromptExitVector, getPromptAnim, getPromptCardKey, playPromptDismissSound, promptCards, promptOverlayVisible]
  );

  // Keep a stable ref to the latest dismiss fn for hot paths (stroke start).
  const dismissPromptOverlayRef = useRef(dismissPromptOverlay);
  dismissPromptOverlayRef.current = dismissPromptOverlay;

  // Any user interaction (paint, etc.) hides the daily-prompt cards INSTANTLY
  // and cancels a still-pending reveal.
  const dismissPromptsForInteraction = useCallback(() => {
    // Starting to paint hides the top daily-topics notification instantly.
    setTopicsNotificationVisible(false);
    if (promptOverlayDismissedRef.current) return;
    promptOverlayDismissedRef.current = true;
    if (promptRevealTimeoutRef.current) {
      clearTimeout(promptRevealTimeoutRef.current);
      promptRevealTimeoutRef.current = null;
    }
    if (promptAutoDismissTimeoutRef.current) {
      clearTimeout(promptAutoDismissTimeoutRef.current);
      promptAutoDismissTimeoutRef.current = null;
    }
    setPromptOverlayDismissed(true);
    setPromptOverlayVisible(false);
  }, []);
  const dismissPromptsForInteractionRef = useRef(dismissPromptsForInteraction);
  dismissPromptsForInteractionRef.current = dismissPromptsForInteraction;

  const handlePromptCardPress = useCallback(
    (prompt: DailyPrompt) => {
      // block tap if this topic was already uploaded today
      if (uploadedPromptTopics.has(prompt.topic)) {
        return;
      }
  
      // little tap feedback
      void Haptics.selectionAsync().catch(() => undefined);
  
      // pick this prompt as the active challenge
      handleChallengeSelect(prompt);
  
      // open the info overlay immediately
      openInfoPanel();
  
      // hide the prompt overlay now that user chose one
      dismissPromptOverlay('tap');
    },
    [dismissPromptOverlay, handleChallengeSelect, openInfoPanel, uploadedPromptTopics]
  );

  // Top daily-topics notification: a tapped topic starts the challenge exactly
  // like the old pills did (same handler); any other tap just hides the panel.
  const handleTopicsNotificationTopicPress = useCallback(
    (prompt: DailyPrompt) => {
      setTopicsNotificationVisible(false);
      handlePromptCardPress(prompt);
    },
    [handlePromptCardPress]
  );

  const handleTopicsNotificationDismiss = useCallback(() => {
    setTopicsNotificationVisible(false);
  }, []);

  // "Show in Gallery" on the vote-update panel — jump to the user's own uploads
  // (personal gallery mode) so they can see the artwork that got voted on. There is
  // no single-post deep link yet (GalleryOverlay's list has no scroll-to-id), so this
  // opens "My uploads" rather than the one exact post; entryId is threaded through for
  // a future scroll-to-item pass.
  const handleShowVoteUpdateInGallery = useCallback((_entryId: string | undefined) => {
    setTopicsNotificationVisible(false);
    handleGalleryModeChange('personal');
    openGallery();
  }, [handleGalleryModeChange, openGallery]);

  const checkOwnGalleryVoteChanges = useCallback(async () => {
    if (!deviceId || galleryVoteCheckInFlightRef.current) return;
    if (parentalControls.offlineMode) {
      if (galleryVoteMountedRef.current) setGalleryVoteCheckCompleted(true);
      return;
    }

    galleryVoteCheckInFlightRef.current = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const entries = await Promise.race([
        fetchDailyPaintGallery({ sort: 'new', owner: deviceId, limit: 100, force: true }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Gallery vote check timed out')), 12_000);
        }),
      ]);
      const update = await recordGalleryVoteCheck(deviceId, entries);
      if (update && galleryVoteMountedRef.current) {
        // A vote update replaces the daily-topics card for this online session.
        // If system notifications are enabled, keep the in-app card hidden;
        // otherwise the same-sized top card is the fallback.
        setGalleryVoteUpdate(update);
        setTopicsNotificationVisible(false);
        const deliveredAsNotification = await notificationService.notifyGalleryVoteChange(update);
        if (!deliveredAsNotification && galleryVoteMountedRef.current) {
          setTopicsNotificationVisible(true);
        }
      }
    } catch (error) {
      console.warn('[PaintScreen] Gallery vote check failed', error);
    } finally {
      if (timeout) clearTimeout(timeout);
      galleryVoteCheckInFlightRef.current = false;
      galleryVoteLastCheckedRef.current = Date.now();
      if (galleryVoteMountedRef.current) setGalleryVoteCheckCompleted(true);
    }
  }, [deviceId, parentalControls.offlineMode]);

  useEffect(() => {
    galleryVoteMountedRef.current = true;
    return () => {
      galleryVoteMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    setGalleryVoteCheckCompleted(false);
    void checkOwnGalleryVoteChanges();
  }, [checkOwnGalleryVoteChanges, deviceId]);

  useEffect(() => {
    const checkWhenActive = (nextState: AppStateStatus) => {
      if (
        nextState === 'active' &&
        Date.now() - galleryVoteLastCheckedRef.current >= 60_000
      ) {
        void checkOwnGalleryVoteChanges();
      }
    };
    const subscription = AppState.addEventListener('change', checkWhenActive);
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void checkOwnGalleryVoteChanges();
    }, 5 * 60_000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [checkOwnGalleryVoteChanges]);

  // One-shot daily-topics notification (per cold app open): the old bottom
  // pill auto-show is disabled; instead the top notification-style panel is
  // shown at most once per 24h, persisted in AsyncStorage. Guarded so a later
  // dailyPrompts refresh can't re-trigger it (re-open/foreground never shows).
  const promptOverlayStartedRef = useRef(false);
  useEffect(() => {
    if (
      promptOverlayStartedRef.current ||
      promptCards.length === 0 ||
      !galleryVoteCheckCompleted ||
      galleryVoteUpdate
    ) {
      return;
    }
    promptOverlayStartedRef.current = true;

    // Old bottom pills never auto-show anymore (replaced by DailyTopicsNotification).
    promptOverlayDismissedRef.current = true;
    setPromptOverlayDismissed(true);
    setPromptOverlayVisible(false);

    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DAILY_TOPICS_NOTIFICATION_LAST_SHOWN_KEY);
        const lastShown = raw ? Number(raw) : 0;
        if (
          !DAILY_TOPICS_NOTIFICATION_ALWAYS_SHOW &&
          Number.isFinite(lastShown) && lastShown > 0 &&
          Date.now() - lastShown < DAILY_TOPICS_NOTIFICATION_INTERVAL_MS
        ) {
          return; // shown within the last 24h → stay hidden
        }
        await AsyncStorage.setItem(DAILY_TOPICS_NOTIFICATION_LAST_SHOWN_KEY, String(Date.now()));
        if (!cancelled) {
          setTopicsNotificationVisible(true);
        }
      } catch (error) {
        console.warn('[PaintScreen] daily-topics notification gating failed', error);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryVoteCheckCompleted, galleryVoteUpdate, promptCards.length]);

  useEffect(() => {
    const activeKeys = new Set(promptCards.map((prompt) => getPromptCardKey(prompt)));
    Object.keys(promptCardAnimationsRef.current).forEach((key) => {
      if (!activeKeys.has(key)) {
        delete promptCardAnimationsRef.current[key];
      }
    });
  }, [getPromptCardKey, promptCards]);

  useEffect(() => {
    if (!promptOverlayVisible || promptOverlayDismissed) {
      return;
    }
    promptExitVectorRef.current = computePromptExitVector();
  }, [computePromptExitVector, promptOverlayDismissed, promptOverlayVisible]);
  const mainCanvasTransformRef = useRef({ scale: 1, translateX: 0, translateY: 0 });
  const convertDisplaySizeToBase = useCallback((displaySize: number) => {
    // Size slider maps directly to brush size — zoom does not affect it
    return Math.min(BRUSH_SIZE_MAX, Math.max(1, Math.round(displaySize)));
  }, []);
  const handleDisplayBrushSizeChange = useCallback(
    (displaySize: number) => {
      const baseSize = convertDisplaySizeToBase(displaySize);
      setBrushSizeImmediate(baseSize);

      // CRITICAL: Force IMMEDIATE redraw when size changes during active drawing
      // Use setLiveVersion directly (not scheduleLiveRedraw) to bypass requestAnimationFrame
      // This ensures rapid slider changes all trigger redraws without being skipped
      if (liveStrokeRef.current && liveOutputPointsRef.current.length > 0) {
        setLiveVersion((prev) => prev + 1);
      }
    },
    [convertDisplaySizeToBase, setBrushSizeImmediate]
  );
  const handleDisplayBrushPreview = useCallback(
    (displaySize: number) => {
      // CRITICAL: Don't show brush preview while actively drawing
      // This prevents preview stroke from interfering with live stroke rendering
      if (liveStrokeRef.current) {
        return; // Skip preview during active drawing
      }

      // CRITICAL: Don't show preview if stroke just ended (within last 500ms)
      const timeSinceStrokeEnd = Date.now() - lastStrokeEndTimeRef.current;
      if (timeSinceStrokeEnd < 500) {
        return; // Skip preview - too soon after stroke ended
      }

      const baseSize = convertDisplaySizeToBase(displaySize);
      handleBrushPreview(baseSize);
    },
    [convertDisplaySizeToBase, handleBrushPreview]
  );
  const handleDisplayBrushPreviewComplete = useCallback(
    (displaySize: number) => {
      // CRITICAL: Don't show brush preview while actively drawing
      if (liveStrokeRef.current) {
        return; // Skip preview during active drawing
      }

      // CRITICAL: Don't show preview if stroke just ended (within last 500ms)
      // This prevents slider release from showing preview after drawing finish
      const timeSinceStrokeEnd = Date.now() - lastStrokeEndTimeRef.current;
      if (timeSinceStrokeEnd < 500) {
        return; // Skip preview - too soon after stroke ended
      }

      const baseSize = convertDisplaySizeToBase(displaySize);
      handleBrushPreviewComplete(baseSize);
    },
    [convertDisplaySizeToBase, handleBrushPreviewComplete]
  );
  // Track when zoom gesture ends to prevent painting during animation settle
  const zoomCooldownTimestampRef = useRef(0);
  const ZOOM_COOLDOWN_MS = 0;
  // Canvas zoom and pan are handled by react-native-zoom-toolkit
  // Only keeping undo/redo tap gestures here

  const undoTapGesture = useMemo(() => {
    return Gesture.Tap()
      .numberOfTaps(1)
      .minPointers(2)
      .maxDuration(250)
      .onEnd((e, success) => {
        if (success && (e?.numberOfPointers ?? 0) >= 2) {
          runOnJS(undoStroke)();
        }
      })
      .enabled(!showTraceControls);
  }, [showTraceControls, undoStroke]);

  const redoTapGesture = useMemo(() => {
    return Gesture.Tap()
      .numberOfTaps(1)
      .minPointers(3)
      .maxDuration(250)
      .onEnd((e, success) => {
        if (success && (e?.numberOfPointers ?? 0) >= 3) {
          runOnJS(redoStroke)();
        }
      })
      .enabled(!showTraceControls);
  }, [redoStroke, showTraceControls]);

  const canvasGesture = useMemo(
    () => Gesture.Simultaneous(undoTapGesture, redoTapGesture),
    [redoTapGesture, undoTapGesture]
  );

  const timerPanGesture = useMemo(() => {
    return Gesture.Pan()
      .minDistance(1)
      .onBegin(() => {
        timerPanStartX.value = timerTranslateX.value;
        timerPanStartY.value = timerTranslateY.value;
        runOnJS(markTimerGrabbed)();
      })
      .onUpdate((event) => {
        const limitX = Math.max(0, canvasViewportWidth.value / 2 - TIMER_OVERLAY_MARGIN);
        const limitY = Math.max(0, canvasViewportHeight.value / 2 - TIMER_OVERLAY_MARGIN);
        const nextX = timerPanStartX.value + event.translationX;
        const nextY = timerPanStartY.value + event.translationY;
        timerTranslateX.value = Math.max(-limitX, Math.min(limitX, nextX));
        timerTranslateY.value = Math.max(-limitY, Math.min(limitY, nextY));
      })
      .enabled(Boolean(activeChallenge));
  }, [activeChallenge, canvasViewportHeight, canvasViewportWidth, markTimerGrabbed, timerPanStartX, timerPanStartY, timerTranslateX, timerTranslateY]);

  const timerPinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .onStart(() => {
        timerScaleStart.value = timerScale.value;
        runOnJS(markTimerGrabbed)();
      })
      .onUpdate((event) => {
        const next = timerScaleStart.value * event.scale;
        timerScale.value = Math.min(TIMER_MAX_SCALE, Math.max(TIMER_MIN_SCALE, next));
      })
      .enabled(Boolean(activeChallenge));
  }, [activeChallenge, markTimerGrabbed, timerScale, timerScaleStart]);

  const handleTimerDoubleTap = useCallback(() => {
    if (!activeChallenge || challengeRemainingMs <= 0) return;
    if (!canUploadChallengeEarly(challengeStrokeCountRef.current)) {
      const remaining = getChallengeStrokesRemaining(challengeStrokeCountRef.current);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      CustomOverlayHelper.alert(
        'Keep painting',
        `Paint ${remaining} more emoji stroke${remaining === 1 ? '' : 's'} to unlock early upload. The countdown will keep running.`
      );
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'End Sprint Early?',
      'This will end your sprint now and take you to the upload screen.',
      [
        { text: 'Keep Going', style: 'cancel' },
        {
          text: 'End & Upload',
          style: 'destructive',
          onPress: () => {
            if (finalizeChallengeRef.current) {
              void finalizeChallengeRef.current();
            }
          }
        }
      ]
    );
  }, [activeChallenge, challengeRemainingMs]);

  const timerDoubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(300)
        .onEnd(() => { runOnJS(handleTimerDoubleTap)(); })
        .enabled(Boolean(activeChallenge) && challengeRemainingMs > 0),
    [activeChallenge, challengeRemainingMs, handleTimerDoubleTap]
  );

  const challengeTimerGesture = useMemo(
    () => Gesture.Race(timerDoubleTapGesture, Gesture.Simultaneous(timerPanGesture, timerPinchGesture)),
    [timerDoubleTapGesture, timerPanGesture, timerPinchGesture]
  );

  // Sprint-timer ✕ — Apple Pencil safe. Three separate things used to eat a
  // Pencil tap on it:
  //   1. the gesture was built inline in the overlay's JSX, so the 1 Hz clock
  //      re-render tore the handler down and re-attached it every second and a
  //      tap landing in that window was simply lost;
  //   2. Tap's default max travel is a couple of points — a Pencil resolves
  //      sub-pixel drift that a fingertip's contact patch averages away, so the
  //      tap failed its distance check;
  //   3. the timer's own Pan (minDistance 1) activated on that same drift and
  //      cancelled the child tap.
  // Built here (not in the overlay) because blocksExternalGesture only resolves
  // BASE gestures — it silently no-ops on the composed `challengeTimerGesture`.
  // The pan/pinch/double-tap now wait for this tap to fail; they still activate
  // instantly for touches that start outside the ✕, since a gesture that never
  // begins never holds them back. Same close action as before — no duplicate.
  const challengeTimerCloseGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(28)
        .maxDuration(700)
        .blocksExternalGesture(timerPanGesture, timerPinchGesture, timerDoubleTapGesture)
        .onEnd((_event, success) => {
          if (success) runOnJS(showChallengeCancelConfirmation)();
        }),
    [showChallengeCancelConfirmation, timerDoubleTapGesture, timerPanGesture, timerPinchGesture]
  );

  const canvasAnimatedStyle = useAnimatedStyle(() => {
    // Transform is now handled by react-native-zoom-toolkit
    // Keep this for compatibility but don't apply transforms
    return {};
  });

  const traceAnimatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: scale.value },
      { rotateZ: `${rotation.value}rad` }
    ]
  }));
  const challengeTimerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: timerTranslateX.value },
      { translateY: timerTranslateY.value },
      { scale: timerScale.value }
    ]
  }));

  const settingsGearAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${settingsGearRotation.value}rad` }
    ]
  }));

  const scheduleLiveRedraw = useCallback(() => {
    if (liveUpdateRef.current !== null) {
      return;
    }
    liveUpdateRef.current = requestAnimationFrame(() => {
      liveUpdateRef.current = null;
      setLiveVersion((prev) => prev + 1);
      // Note: syncLiveFrameCopiesImmediate is already called from appendSmoothedSample for real-time stamping
    });
  }, []);

const finishLongStrokeTracking = useCallback(() => {
  if (liveLongStrokeTimerRef.current) {
    clearInterval(liveLongStrokeTimerRef.current);
    liveLongStrokeTimerRef.current = null;
  }
  liveStrokeStartRef.current = null;
  liveLastSnapshotRef.current = null;
  liveLongStrokeFrameIndexRef.current = 0;
}, []);

const resetLiveStrokeState = useCallback(() => {
  liveStrokeRef.current = null;
  lastPointRef.current = null;
  stylusActiveRef.current = false;
  liveRawPointsRef.current = [];
    liveOutputPointsRef.current = [];
    liveSpacingCarryRef.current = 0;
    liveCurrentSpacingRef.current = brushSpacingRef.current;
  liveSpacingRef.current = null;
  lineStartRef.current = null;
  lineEndRef.current = null;
  multiTouchAbortRef.current = false;
  canvasResponderTargetRef.current = null;
  pendingBrushSizeChangeRef.current = null;
  liveFrameStrokeIdRef.current = null; // Clear live frame stroke tracking
  smudgeLastEventTimeRef.current = 0;
  resetLiveFrameStampTracking();
    finishLongStrokeTracking();
    scheduleLiveRedraw();
  }, [finishLongStrokeTracking, scheduleLiveRedraw, resetLiveFrameStampTracking]);

useEffect(() => () => {
  if (liveUpdateRef.current !== null) {
    cancelAnimationFrame(liveUpdateRef.current);
    liveUpdateRef.current = null;
  }
  finishLongStrokeTracking();
}, [finishLongStrokeTracking]);

useEffect(() => {
  strokeCountRef.current = strokes.length;
  // Track smudge count separately for the smudge sub-cap (each smudge holds a heavy baked tile).
  let smudges = 0;
  for (let i = 0; i < strokes.length; i += 1) {
    if (strokes[i].isSmudge) smudges += 1;
  }
  smudgeCountRef.current = smudges;
}, [strokes]);

  const screenToCanvasCoords = useCallback((touchX: number, touchY: number) => {
    // locationX/locationY are already relative to the canvas view
    // They don't need transformation - they're already in canvas space!
    // ResumableZoom handles the visual zoom, but touches are in the original canvas coordinate space

    // (Removed per-touch [COORD DEBUG] log — it fired 60–120×/sec during a stroke and, with the JS
    // debugger attached, flooded the bridge and stalled smudging.)

    return { x: touchX, y: touchY };
  }, []);

  /**
   * Detect which emoji is at a specific canvas position
   * Searches through strokes from newest to oldest to find the topmost emoji
   */
  const detectEmojiAtPosition = useCallback((canvasX: number, canvasY: number): string | null => {
    // Search from newest to oldest (reverse order)
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      const hitRadius = stroke.size / 2;

      // Check each point in the stroke
      for (const point of stroke.points) {
        const distance = Math.hypot(canvasX - point.x, canvasY - point.y);
        if (distance <= hitRadius) {
          // Found an emoji at this position
          return stroke.emoji;
        }
      }
    }

    return null; // No emoji found at this position
  }, [strokes]);

  // Brush size is now constant regardless of zoom level - no dynamic scaling

  const initializeLiveStroke = useCallback((initialPoint: StrokePoint, effectiveBrushSize: number) => {
    const now = Date.now();
    resetLiveFrameStampTracking();
    const isSmudgeStroke = brushModeRef.current === 'smudge' && toolModeRef.current !== 'eraser';
    const strokeBrushSize = isSmudgeStroke
      ? Math.min(effectiveBrushSize, SMUDGE_MAX_BRUSH_SIZE)
      : effectiveBrushSize;
    // Store width in the initial point for dynamic stroke width
    const pointWithWidth: StrokePoint = { ...initialPoint, w: strokeBrushSize };
    const stroke: Stroke = {
      id: `${now}-${Math.round(Math.random() * 1e6)}`,
      emoji: brushEmojiRef.current,
      size: strokeBrushSize,
      opacity: brushOpacityRef.current,
      spacing: brushSpacingRef.current,
      stampSpan: measureEmojiSpan(brushEmojiRef.current, strokeBrushSize),
      points: [pointWithWidth],
      mirrorX: mirrorXRef.current,
      mirrorY: mirrorYRef.current,
      rotation: brushRotationRef.current,
      isEraser: toolModeRef.current === 'eraser',
      // 3-layer system: the stroke is BORN on the active layer, so the live preview already renders
      // into the right layer texture (not just after commit). Painting on the default layer writes
      // no key at all, keeping old/new paintings byte-identical when layers are unused.
      ...(activeLayerRef.current !== DEFAULT_PAINT_LAYER ? { layer: activeLayerRef.current } : {}),
      // Smudge mode: the emoji alpha becomes a brush mask that drags existing canvas pixels.
      // edgeBlendStrength carries the user's smoothness slider (0 = pure smear, ~1 = creamy).
      ...(isSmudgeStroke
        ? { isSmudge: true, smudgeStrength, edgeBlendStrength: smudgeSmoothnessRef.current }
        : {}),
      // Mac app animator-style: strokes painted during frame mode get duration metadata
      ...(frameModeRef.current ? {
        startFrame: currentFrameIndexRef.current,
        frameDuration: Math.max(
          1,
          Math.min(framePaintLengthRef.current, Math.max(1, framesRef.current.length))
        )
      } : {})
    };
    liveStrokeRef.current = stroke;
    smudgeLastEventTimeRef.current = 0;
    // Painting is an interaction → hide the daily-prompt cards instantly.
    dismissPromptsForInteractionRef.current();
    lastPointRef.current = pointWithWidth;
    liveRawPointsRef.current = [pointWithWidth];
    liveOutputPointsRef.current = [pointWithWidth];
    liveSpacingCarryRef.current = 0;
    liveSpacingRef.current = null;
    liveCurrentSpacingRef.current = brushSpacingRef.current;
    liveStrokeStartRef.current = now;
    liveLastSnapshotRef.current = now;
    liveLongStrokeFrameIndexRef.current = 0;
    const tool = toolModeRef.current;
    if (tool !== 'line') {
      if (liveLongStrokeTimerRef.current) {
        clearInterval(liveLongStrokeTimerRef.current);
      }
      liveLongStrokeTimerRef.current = setInterval(() => {
        const start = liveStrokeStartRef.current;
        const strokeRef = liveStrokeRef.current;
        if (!start || !strokeRef) {
          finishLongStrokeTracking();
          return;
        }
        const latest = liveLastSnapshotRef.current ?? start;
        const elapsedSinceLast = Date.now() - latest;
        if (elapsedSinceLast < LONG_STROKE_SNAPSHOT_INTERVAL_MS) {
          return;
        }
        if (privateStudioActiveRef.current) {
          return;
        }
        liveLongStrokeFrameIndexRef.current += 1;
        const estimateCount = strokeCountRef.current;
        void recordSnapshotEvent('strokeCommit', {
          timestamp: Date.now(),
          strokeCount: estimateCount,
          skipRaster: false,
          frameIndex: liveLongStrokeFrameIndexRef.current,
          force: true,
          snapshotSize: LONG_STROKE_SNAPSHOT_SIDE
        });
        liveLastSnapshotRef.current = Date.now();
      }, LONG_STROKE_SNAPSHOT_INTERVAL_MS);
    }

    // DIRECT FRAME STAMPING: Track stroke ID for live updates to current frame
    // scheduleLiveRedraw will stamp the entire stroke to the current frame
    if (frameModeRef.current && isPlayingFramesRef.current) {
      liveFrameStrokeIdRef.current = stroke.id;
      startLiveFrameCopies(stroke);
      console.log('[Direct Frame Stamp] Started stroke:', stroke.id, 'on frame', currentFrameIndexRef.current);
    } else {
      liveFrameStrokeIdRef.current = null;
      resetLiveFrameStampTracking();
    }

    scheduleLiveRedraw();
    return stroke;
  }, [brushEmojiRef, brushOpacityRef, brushRotationRef, brushSpacingRef, finishLongStrokeTracking, mirrorXRef, mirrorYRef, privateStudioActiveRef, recordSnapshotEvent, resetLiveFrameStampTracking, scheduleLiveRedraw, setFrames, startLiveFrameCopies]);

  const finalizeCurrentLiveStroke = useCallback((preserveLastPoint: boolean) => {
    const stroke = liveStrokeRef.current;
    if (!stroke || liveOutputPointsRef.current.length === 0) {
      return false;
    }
    const tool = toolModeRef.current;
    const finalized: Stroke = {
      ...stroke,
      spacing: tool === 'line' ? brushSpacingRef.current : (liveCurrentSpacingRef.current ?? brushSpacingRef.current),
      points: liveOutputPointsRef.current.map((point) => ({ ...point }))
    };

    // SYSTEM #1: PLAY & PAINT MODE (playing during animation)
    if (frameModeRef.current && isPlayingFramesRef.current) {
      console.log('[Play & Paint] Stroke finalized - points already stamped to frames during drawing');
      // Play-and-paint writes directly into frame buckets and intentionally
      // skips PaintingContext.COMMIT_STROKE, so record its one real gesture here.
      void recordLifetimeStrokeCommit({
        eventId: `painting:${finalized.id}`,
        workspace: 'animator',
      });
      resetLiveFrameStampTracking();
      // Mark that frames need to be persisted when playback stops
      pendingFrameSyncRef.current = true;
      // Don't commit to canvas - stamps are already on frames
    }
    // SYSTEM #2: NORMAL FRAME PAINTING (not playing)
    else if (frameModeRef.current && !isPlayingFramesRef.current) {
      console.log('[Normal Frame Paint] Adding complete stroke to current frame:', currentFrameIndexRef.current);

      // Update frames array with complete stroke
      setFrames(prevFrames => {
        const newFrames = [...prevFrames];
        if (newFrames.length === 0) return newFrames;
        // CLAMP rather than drop. An out-of-range index used to discard the stroke silently, which
        // reads to the user as "painting is broken" with nothing in the logs.
        const rawIdx = currentFrameIndexRef.current;
        const currentIdx = Math.max(0, Math.min(rawIdx, newFrames.length - 1));
        if (currentIdx !== rawIdx) {
          console.warn(`[Frame Mode] stroke targeted frame ${rawIdx} but only ${newFrames.length} frames exist — clamped to ${currentIdx}`);
          currentFrameIndexRef.current = currentIdx;
        }
        const frame = newFrames[currentIdx];
        frame.strokes.push({ ...finalized });
        // Clear cache for this frame
        frameCacheRef.current.delete(frame.id);
        return newFrames;
      });

      // Also commit to visible canvas so user can see it immediately
      commitStroke(finalized);
    }
    // SYSTEM #3: NORMAL MODE (no frames)
    else {
      // Hard caps: total strokes (memory guardrail — Metal renders are O(1) regardless of count) and a
      // tighter smudge sub-cap (each smudge holds a heavy baked tile).
      const capReason =
        strokeCountRef.current >= MAX_STROKES
          ? { title: 'Canvas Full', message: `Canvas full (${MAX_STROKES.toLocaleString()} strokes) — clear some strokes to keep painting.` }
          : (!!finalized.isSmudge && smudgeCountRef.current >= MAX_SMUDGE_STROKES)
            ? { title: 'Smudge limit reached', message: `You've used the max ${MAX_SMUDGE_STROKES} smudges on this canvas. Clear some to smudge more.` }
            : null;
      if (capReason) {
        CustomOverlayHelper.alert(capReason.title, capReason.message, [{ text: 'OK', style: 'default' }]);
        liveStrokeRef.current = null;
        liveRawPointsRef.current = [];
        liveOutputPointsRef.current = [];
        liveSpacingCarryRef.current = 0;
        liveSpacingRef.current = null;
        return false;
      }
      commitStroke(finalized);
    }

    // CRITICAL: Clear brush preview after stroke finishes
    // This prevents preview emoji from appearing after drawing is done
    clearBrushPreviewTimeout();
    setBrushPreviewStroke(null);

    // Track when stroke ended to prevent slider preview showing immediately after
    lastStrokeEndTimeRef.current = Date.now();

    liveStrokeRef.current = null;
    liveRawPointsRef.current = [];
    liveOutputPointsRef.current = [];
    liveSpacingCarryRef.current = 0;
    liveSpacingRef.current = null;
    liveFrameStrokeIdRef.current = null; // Clear live frame stroke tracking
    if (tool === 'line') {
      lineStartRef.current = null;
  lineEndRef.current = null;
    }
    if (!preserveLastPoint) {
      lastPointRef.current = null;
    }
    finishLongStrokeTracking();
    return true;
  }, [brushSpacingRef, clearBrushPreviewTimeout, commitStroke, finishLongStrokeTracking, resetLiveFrameStampTracking, setBrushPreviewStroke, syncLiveFrameCopies]);

  const restartBrushStrokeWithNewSize = useCallback((baseSize: number) => {
    const stroke = liveStrokeRef.current;
    const lastPoint = lastPointRef.current;
    if (!stroke || !lastPoint || liveOutputPointsRef.current.length === 0) {
      return false;
    }
    finalizeCurrentLiveStroke(true);
    initializeLiveStroke({ ...lastPoint }, baseSize);
    return true;
  }, [finalizeCurrentLiveStroke, initializeLiveStroke]);

  // Polygon tool: Fill closed polygon with grid-based emoji placement
  const fillPolygonWithEmojis = useCallback((points: Array<{ x: number; y: number }>) => {
    if (points.length < 3) {
      console.log('[Polygon] Not enough points to fill (need at least 3)');
      return;
    }

    console.log(`[Polygon] Filling polygon with ${points.length} points`);

    // Get bounding box
    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));

    // Use current brush settings
    const size = brushSizeRef.current;
    const emoji = brushEmojiRef.current;
    const spacing = brushSpacingRef.current || 1.0;
    const opacity = brushOpacityRef.current;
    const rotation = brushRotationRef.current;
    const mirrorX = mirrorXRef.current;
    const mirrorY = mirrorYRef.current;

    // Grid spacing based on brush spacing slider (adjusted for better coverage)
    const gridSpacing = size * Math.max(0.5, spacing * 0.8);

    console.log(`[Polygon] Fill settings - emoji: ${emoji}, size: ${size}, spacing: ${spacing}, gridSpacing: ${gridSpacing.toFixed(1)}`);

    // Point-in-polygon test using ray casting algorithm
    const isPointInPolygon = (x: number, y: number): boolean => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;
        const intersect = ((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    // Create stamps in grid pattern
    const stamps: Array<{ x: number; y: number; rotation: number; mirrorX: boolean; mirrorY: boolean }> = [];

    // Add some offset for better coverage
    const offsetX = gridSpacing / 2;
    const offsetY = gridSpacing / 2;

    for (let y = minY - offsetY; y <= maxY + offsetY; y += gridSpacing) {
      for (let x = minX - offsetX; x <= maxX + offsetX; x += gridSpacing) {
        if (isPointInPolygon(x, y)) {
          stamps.push({
            x,
            y,
            rotation: rotation || 0,
            mirrorX: mirrorX || false,
            mirrorY: mirrorY || false
          });
        }
      }
    }

    console.log(`[Polygon] Created ${stamps.length} stamps to fill polygon`);

    if (stamps.length === 0) {
      console.log('[Polygon] No stamps created - polygon might be too small or spacing too large');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    // Create stroke with all stamps
    const newStroke: Stroke = {
      id: `polygon-${Date.now()}-${Math.random()}`,
      emoji,
      size,
      opacity,
      stamps,
      type: 'stamp',
      points: [],
      frameIndex: frameMode ? currentFrameIndexRef.current : undefined
    };

    // Add to appropriate frame
    if (frameMode) {
      dispatch({ type: 'ADD_FRAME_STROKE', frameIndex: currentFrameIndexRef.current, stroke: newStroke });
    } else {
      dispatch({ type: 'ADD_STROKE', stroke: newStroke });
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    console.log('[Polygon] Polygon filled successfully!');
  }, [frameMode, dispatch]);

  const _cpRef = useRef(null);
  if (_cpRef.current === null) {
    _cpRef.current = PanResponder.create({
      onStartShouldSetPanResponder: (event) => {
        const touchCount = getCanvasTouchCount((event.nativeEvent as any) ?? null);
        return touchCount <= 1;
      },
      onPanResponderStart: (event) => {
        const touchCount = Math.max(1, getCanvasTouchCount((event.nativeEvent as any) ?? null));
        if (touchCount > 1) {
          multiTouchAbortRef.current = true;
        }
      },
      onMoveShouldSetPanResponder: (event, gestureState) => getCanvasTouchCount(event.nativeEvent) <= 1 && gestureState.numberActiveTouches <= 1,
      onPanResponderGrant: (event) => {
        const nativeEvent: any = event.nativeEvent;
        const touchCount = Math.max(1, getCanvasTouchCount(nativeEvent));

        // CRITICAL: Check for multi-touch FIRST, before creating any stroke points!
        // This prevents the "jump" when starting a pinch gesture
        if (touchCount > 1) {
          multiTouchAbortRef.current = true;
          zoomCooldownTimestampRef.current = Date.now();
          return; // Exit immediately, don't create stroke!
        }

        // Tutorial mode: emit touch ripple at touch location
        if (tutorialModeEnabledRef.current && tutorialActiveRef.current) {
          addRippleRef.current(nativeEvent.pageX ?? nativeEvent.locationX ?? 0, nativeEvent.pageY ?? nativeEvent.locationY ?? 0);
        }

        canvasResponderTargetRef.current = nativeEvent.target ?? canvasResponderTargetRef.current;

        // ZOOM COOLDOWN: Prevent painting for 150ms after pinch zoom ends
        // This allows the zoom animation to settle smoothly
        const timeSinceZoom = Date.now() - zoomCooldownTimestampRef.current;
        if (timeSinceZoom < ZOOM_COOLDOWN_MS) {
          return; // Exit without creating stroke - zoom animation still settling
        }

        multiTouchAbortRef.current = false;
        clearBrushPreviewTimeout();
        setBrushPreviewStroke(null);

        // Hide frame move arrows when user starts painting
        if (frameMode && selectedFrameForMove !== null) {
          setSelectedFrameForMove(null);
        }

        // Capture the active drawing touch identifier to prevent cross-touch contamination
        const touches = nativeEvent.touches ?? [];
        if (touches.length > 0) {
          activeDrawingTouchIdRef.current = touches[0].identifier ?? touches[0].touchId ?? 0;
        } else {
          activeDrawingTouchIdRef.current = 0; // Fallback for events without touches array
        }

        const locationX = nativeEvent.locationX ?? 0;
        const locationY = nativeEvent.locationY ?? 0;
        const canvasCoords = screenToCanvasCoords(locationX, locationY);
        // Store position for long press emoji picker
        longPressPositionRef.current = { x: canvasCoords.x, y: canvasCoords.y };
        longPressTriggeredRef.current = false;

        // Start long press timer (3 seconds)
        longPressTimerRef.current = setTimeout(() => {
          // Long press triggered - try to pick emoji at this position
          const detectedEmoji = detectEmojiAtPosition(canvasCoords.x, canvasCoords.y);

          if (detectedEmoji && detectedEmoji !== brushEmojiRef.current) {
            // Found a different emoji - pick it!
            longPressTriggeredRef.current = true;

            // Haptic feedback
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {
              // Ignore haptics errors
            });

            // Update brush emoji
            dispatch({ type: 'SET_BRUSH_EMOJI', emoji: detectedEmoji });

            console.log('[Long Press] Picked emoji:', detectedEmoji);

            // Cancel the current stroke since we're picking instead of drawing
            liveStrokeRef.current = null;
            scheduleLiveRedraw();
          }
        }, 3000);

        const now = Date.now();
        const initialPoint: StrokePoint = { x: canvasCoords.x, y: canvasCoords.y, t: now };
        const tool = toolModeRef.current;
        // Brush size is constant regardless of zoom level
        const effectiveBrushSize = brushSizeRef.current;

        // POLYGON TOOL: Handle point placement and dragging
        if (tool === 'polygon') {
          const SNAP_DISTANCE = 50; // Distance in canvas units to snap to first point
          const DRAG_DISTANCE = 40; // Distance to detect drag on existing point
          const currentPoints = polygonPointsRef.current;
          const firstPoint = currentPoints[0];

          // Clear long press timer since we're interacting with polygon
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }

          // Check if touch is near an existing point (for dragging)
          let nearestPointIndex: number | null = null;
          let nearestDistance = DRAG_DISTANCE;
          currentPoints.forEach((point, index) => {
            const dist = Math.hypot(canvasCoords.x - point.x, canvasCoords.y - point.y);
            if (dist < nearestDistance) {
              nearestDistance = dist;
              nearestPointIndex = index;
            }
          });

          // If near an existing point, start dragging it
          if (nearestPointIndex !== null) {
            console.log(`[Polygon] Starting drag on point ${nearestPointIndex}`);
            setDraggingPolygonIndex(nearestPointIndex);
            draggingPolygonIndexRef.current = nearestPointIndex;
            void Haptics.selectionAsync();
            return;
          }

          // Check if we should close the polygon (near first point with at least 3 points)
          if (currentPoints.length >= 3 && firstPoint) {
            const distToFirst = Math.hypot(canvasCoords.x - firstPoint.x, canvasCoords.y - firstPoint.y);

            if (distToFirst < SNAP_DISTANCE) {
              console.log(`[Polygon] Closing polygon - distance to first point: ${distToFirst.toFixed(1)}`);
              // Close and fill the polygon
              fillPolygonWithEmojis(currentPoints);
              // Clear polygon state
              setPolygonPoints([]);
              polygonPointsRef.current = [];
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              return; // Don't start a normal stroke
            }
          }

          // Add new point to polygon
          const newPoints = [...currentPoints, { x: canvasCoords.x, y: canvasCoords.y }];
          setPolygonPoints(newPoints);
          polygonPointsRef.current = newPoints;
          void Haptics.selectionAsync();

          console.log(`[Polygon] Added point ${newPoints.length}: (${canvasCoords.x.toFixed(1)}, ${canvasCoords.y.toFixed(1)})`);
          return; // Don't start a normal stroke
        }

        // EMOJI PLANE TOOL: Handle plane creation, corner dragging, and plane selection
        if (tool === 'emojiplane') {
          const CORNER_HIT_RADIUS = 80; // Distance in canvas units to detect corner touch (increased for easier grabbing)
          const currentPlanes = emojiPlanesRef.current.filter(plane => plane.visible !== false);

          console.log('[PAINT PLANE TOUCH] currentPlanes count:', currentPlanes.length, 'selectedPlaneId:', selectedPlaneIdRef.current);

          // Clear long press timer since we're interacting with emoji plane
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }

          // Helper function to find nearest corner within hit radius
          // Only detect the 4 real corners (not midpoints)
          const findNearestCorner = (x: number, y: number, plane: EmojiPlane): string | null => {
            // A plane with a lattice is grabbed by its lattice points instead of its 4 corners.
            // Encoded as "lattice:<index>" so the existing corner-drag pipeline carries it
            // unchanged — no parallel drag system.
            if (plane.lattice && (plane.latticeLevel ?? 1) > 1) {
              // Dense grids cannot use the classic 80-unit corner radius: at 16/36 points those
              // circles overlap across the entire image and make body dragging impossible. Base
              // the target on the nearest pair while retaining a comfortable minimum hit area.
              let nearestSpacing = Infinity;
              for (let i = 0; i < plane.lattice.length; i += 1) {
                for (let j = i + 1; j < plane.lattice.length; j += 1) {
                  const distance = Math.hypot(
                    plane.lattice[i].x - plane.lattice[j].x,
                    plane.lattice[i].y - plane.lattice[j].y,
                  );
                  if (distance > 0.01 && distance < nearestSpacing) nearestSpacing = distance;
                }
              }
              // Finger touch targets need real screen-point size, not a mathematical half-spacing —
              // 14-32 was too small to reliably grab on a real device even though it "worked" on
              // paper. Apple's own minimum touch target is 44pt, so floor/ceiling match that.
              const latticeHitRadius = Number.isFinite(nearestSpacing)
                ? Math.max(28, Math.min(48, nearestSpacing * 0.48))
                : 36;
              const hit = findLatticeHandle(plane.lattice, x, y, latticeHitRadius);
              return hit === null ? null : `lattice:${hit}`;
            }
            const corners = plane.corners;
            const cornerNames = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
            let nearestCorner: string | null = null;
            let nearestDistance = CORNER_HIT_RADIUS;

            for (const cornerName of cornerNames) {
              const corner = corners[cornerName as keyof typeof corners];
              const dist = Math.hypot(x - corner.x, y - corner.y);
              if (dist < nearestDistance) {
                nearestDistance = dist;
                nearestCorner = cornerName;
              }
            }

            return nearestCorner;
          };

          // Helper function to check if point is inside plane quad
          const isPointInPlane = (x: number, y: number, plane: EmojiPlane): boolean => {
            const points = plane.lattice && (plane.latticeLevel ?? 1) > 1
              ? plane.lattice
              : [plane.corners.topLeft, plane.corners.topRight, plane.corners.bottomRight, plane.corners.bottomLeft];
            const minX = Math.min(...points.map(point => point.x));
            const maxX = Math.max(...points.map(point => point.x));
            const minY = Math.min(...points.map(point => point.y));
            const maxY = Math.max(...points.map(point => point.y));

            return x >= minX && x <= maxX && y >= minY && y <= maxY;
          };

          // If no planes exist, allow single tap to place the first plane
          if (currentPlanes.length === 0) {
            console.log('[PAINT PLANE] No planes exist - creating first plane at tap');
            createEmojiPlane(canvasCoords.x, canvasCoords.y);
            return; // Don't start a normal stroke
          }

          // First, check if user touched a corner of the SELECTED plane only
          if (selectedPlaneIdRef.current) {
            const selectedPlane = currentPlanes.find(p => p.id === selectedPlaneIdRef.current);
            if (selectedPlane) {
              const corner = findNearestCorner(canvasCoords.x, canvasCoords.y, selectedPlane);
              if (corner) {
                console.log(`[PAINT PLANE] Corner ${corner} touched on selected plane ${selectedPlane.id}`);
                // Calculate offset between touch point and actual corner position
                // A lattice handle is keyed "lattice:<index>", which is NOT a member of `corners` —
                // reading it there returned undefined and threw on `.x` the moment a lattice point
                // was grabbed. Resolve the position from whichever collection actually owns it.
                const cornerPos = corner.startsWith('lattice:')
                  ? selectedPlane.lattice?.[Number(corner.slice('lattice:'.length))]
                  : (selectedPlane.corners[corner as keyof typeof selectedPlane.corners] as { x: number; y: number });
                if (!cornerPos) {
                  return;
                }
                const offsetX = cornerPos.x - canvasCoords.x;
                const offsetY = cornerPos.y - canvasCoords.y;
                // Start corner dragging with offset
                setDraggingCorner({ planeId: selectedPlane.id, corner });
                draggingCornerRef.current = { planeId: selectedPlane.id, corner, offsetX, offsetY };
                void Haptics.selectionAsync();
                return; // Don't start a normal stroke
              }
            }
          }

          // NOTE: there is deliberately no extra corner "exclusion zone" here any more.
          //
          // A 100-unit ring used to swallow the touch and return, but corner detection above
          // already had first refusal at an 80-unit radius — so the 80..100 band was a dead ring
          // where nothing at all happened. On a small plane that ring covered most of the shape,
          // which is why dragging a plane by its body so often did nothing.

          // If no corner touched, check if user touched a plane body to select it
          const touchedPlanes = currentPlanes.filter(plane => isPointInPlane(canvasCoords.x, canvasCoords.y, plane));

          if (touchedPlanes.length > 0) {
            // Select the topmost plane (highest z-index)
            const sortedPlanes = [...touchedPlanes].sort((a, b) => b.zIndex - a.zIndex);
            const topmostPlane = sortedPlanes[0];

            // If tapping the same plane again, allow dragging
            // Only allow editing if plane is already selected (via sidebar)
            // Touching a plane SELECTS it and grabs it in one gesture.
            //
            // This used to refuse unless the plane was already selected, telling the user to
            // "use sidebar to select" — but that sidebar no longer exists, so a plane that was
            // not already active simply could not be picked up at all.
            if (selectedPlaneIdRef.current !== topmostPlane.id) {
              selectedPlaneIdRef.current = topmostPlane.id;
              setSelectedPlaneId(topmostPlane.id);
            }
            console.log(`[PAINT PLANE] Grabbing plane ${topmostPlane.id}`);
            planePinchRef.current = {
              planeId: topmostPlane.id,
              initialDistance: 0, // Will be set on first two-finger detection
              initialPlane: {
                ...topmostPlane,
                corners: Object.fromEntries(
                  Object.entries(topmostPlane.corners).map(([key, point]) => [key, { ...point }])
                ) as EmojiPlane['corners'],
                lattice: topmostPlane.lattice?.map(point => ({ ...point })),
              },
              initialTouchPos: { x: canvasCoords.x, y: canvasCoords.y },
              lastTouchPos: { x: canvasCoords.x, y: canvasCoords.y }
            };
            void Haptics.selectionAsync();

            return; // Don't start a normal stroke
          }

          // No plane touched - do nothing (planes only created via + button)
          console.log('[PAINT PLANE] No plane touched - ignoring touch (use + button to create)');
          return; // Don't start a normal stroke in emoji plane mode
        }

        // Track which frame the stroke started on for cross-frame detection
        strokeStartFrameIndexRef.current = currentFrameIndexRef.current;

        initializeLiveStroke(initialPoint, effectiveBrushSize);

        if (tool === 'line') {
          lineStartRef.current = initialPoint;
          lineEndRef.current = initialPoint;
          // Stays empty for the whole gesture: a straight line collects NO
          // intermediate touch samples.
          liveRawPointsRef.current = [];
          liveOutputPointsRef.current = [{ ...initialPoint }];
          stylusActiveRef.current = false;
          scheduleLiveRedraw();
          return;
        }

        const pointerType = (event.nativeEvent as any)?.pointerType ?? (event.nativeEvent as any)?.touches?.[0]?.type;
        stylusActiveRef.current = pointerType === 'pen' || pointerType === 'stylus';
        liveRawPointsRef.current = [{ ...initialPoint }];
        liveOutputPointsRef.current = [{ ...initialPoint }];
        scheduleLiveRedraw();
      },
      onPanResponderMove: (event) => {
        // Cancel long press timer if touch moves (user is drawing, not long pressing)
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        const nativeEvent: any = event.nativeEvent;

        // CRITICAL: Find and use ONLY the drawing touch, ignore all others (slider, second finger, etc.)
        // Don't use touches[0] - it might be the slider touch!
        const touches = nativeEvent.touches ?? [];
        let drawingTouch: any = null;

        if (touches.length > 0 && activeDrawingTouchIdRef.current !== null) {
          // Find the touch that matches our stored drawing touch ID
          for (const touch of touches) {
            const touchId = touch.identifier ?? touch.touchId ?? 0;
            if (touchId === activeDrawingTouchIdRef.current) {
              drawingTouch = touch;
              break;
            }
          }

          // CRITICAL: If we found the drawing touch, use its coordinates
          // If we didn't find it but we're actively drawing, use LAST KNOWN COORDINATES to bridge the gap
          if (drawingTouch) {
            // Override nativeEvent coordinates with the CORRECT touch's coordinates
            nativeEvent.locationX = drawingTouch.locationX;
            nativeEvent.locationY = drawingTouch.locationY;
            nativeEvent.pageX = drawingTouch.pageX;
            nativeEvent.pageY = drawingTouch.pageY;
          } else if (liveStrokeRef.current && lastPointRef.current) {
            // Can't find the drawing touch in the touches array (slider finger lifting)
            // Use LAST KNOWN GOOD coordinates to maintain continuity and prevent jumps
            // This creates duplicate points at the same location, which spacing algorithm handles gracefully (distance=0)
            // When drawing touch reappears, we'll seamlessly continue from this position
            const lastCoords = lastPointRef.current;
            nativeEvent.locationX = lastCoords.x;
            nativeEvent.locationY = lastCoords.y;
            nativeEvent.pageX = lastCoords.x; // Approximate - not critical for this bridge case
            nativeEvent.pageY = lastCoords.y;
            if (__DEV__) {
              console.log(`[Touch Identity] Bridge gap - using last known coords (${lastCoords.x.toFixed(0)}, ${lastCoords.y.toFixed(0)})`);
            }
          } else {
            // No active stroke and can't find touch - skip this event
            if (__DEV__) {
              console.warn(`[Touch Identity] Drawing touch ${activeDrawingTouchIdRef.current} not found, no active stroke or last point`);
            }
            return;
          }
        }

        // Note: Coordinate validation is now done in validatePointBeforeAppend()
        // We no longer need early rejection here since we've already filtered to the drawing touch

        // CRITICAL: Only check for multi-touch if we DON'T have a valid drawing touch
        // If we successfully found the drawing touch, ignore other touches (slider, UI, etc.)
        // Only abort on genuine canvas multi-touch (pinch zoom)
        if (!drawingTouch) {
          const touchCount = Math.max(1, getCanvasTouchCount(nativeEvent));
          if (touchCount > 1) {
            multiTouchAbortRef.current = true;
            // Set cooldown timestamp to prevent painting immediately after pinch ends
            zoomCooldownTimestampRef.current = Date.now();
            // CRITICAL: Clear live stroke immediately to prevent "jump" during pinch zoom
            liveStrokeRef.current = null;
            // CRITICAL: Clear pending brush size change to prevent stroke restart from wrong position
            pendingBrushSizeChangeRef.current = null;
            scheduleLiveRedraw();
            return;
          }
          if (multiTouchAbortRef.current) {
            // Transitioning from multi-touch to single touch - clear abort and set cooldown
            multiTouchAbortRef.current = false;
            zoomCooldownTimestampRef.current = Date.now();
            liveSpacingCarryRef.current = 0;
            pendingBrushSizeChangeRef.current = null;
            // Don't process this point - wait for next touch event after cooldown
            return;
          }
        } else {
          // CRITICAL: If we have a valid drawing touch, clear any previous multi-touch abort state
          // This allows drawing to continue smoothly when slider touch ends
          multiTouchAbortRef.current = false;
        }

        // POLYGON DRAGGING: Update dragged point position
        if (toolModeRef.current === 'polygon' && draggingPolygonIndexRef.current !== null) {
          const touchX = nativeEvent.locationX ?? 0;
          const touchY = nativeEvent.locationY ?? 0;
          const canvasCoords = screenToCanvasCoords(touchX, touchY);

          const updatedPoints = [...polygonPointsRef.current];
          updatedPoints[draggingPolygonIndexRef.current] = { x: canvasCoords.x, y: canvasCoords.y };
          setPolygonPoints(updatedPoints);
          polygonPointsRef.current = updatedPoints;
          return;
        }

        // EMOJI PLANE TOOL: Handle corner dragging, pinch scaling, and plane dragging
        if (toolModeRef.current === 'emojiplane') {
          const touchX = nativeEvent.locationX ?? 0;
          const touchY = nativeEvent.locationY ?? 0;
          const canvasCoords = screenToCanvasCoords(touchX, touchY);

          // Corner dragging - update ref only for smooth performance
          if (draggingCornerRef.current) {
            const { planeId, corner, offsetX = 0, offsetY = 0 } = draggingCornerRef.current;

            // Apply the offset to keep the corner at the correct position relative to the touch
            const adjustedX = canvasCoords.x + offsetX;
            const adjustedY = canvasCoords.y + offsetY;

            // Update ref only (no dispatch = no undo step during drag)
            updatePlaneCornerRef(planeId, corner, adjustedX, adjustedY);

            // Force re-render by updating a dummy state
            setDraggingCorner({ planeId, corner }); // This triggers re-render for visual feedback

            return;
          }

          // Plane dragging (move all corners together)
          if (planePinchRef.current && planePinchRef.current.planeId) {
            const { planeId } = planePinchRef.current;

            // Check for two-finger pinch scaling
            const touches = nativeEvent.touches ?? [];
            if (touches.length === 2) {
              // Reset initialDistance when transitioning from 1 to 2 fingers
              if (planePinchRef.current.initialDistance === 0) {
                planePinchRef.current.lastTouchPos = undefined; // Disable single-finger drag
              }

              const getDistance = (touches: any[]) => {
                if (touches.length < 2) return 0;
                const dx = touches[0].pageX - touches[1].pageX;
                const dy = touches[0].pageY - touches[1].pageY;
                return Math.sqrt(dx * dx + dy * dy);
              };

              const distance = getDistance(touches);

              // Initialize pinch distance on first two-finger detection
              if (planePinchRef.current.initialDistance === 0) {
                planePinchRef.current.initialDistance = distance;
                const currentPlane = emojiPlanesRef.current.find(p => p.id === planeId);
                if (!currentPlane) return;
                planePinchRef.current.initialPlane = {
                  ...currentPlane,
                  corners: Object.fromEntries(
                    Object.entries(currentPlane.corners).map(([key, point]) => [key, { ...point }])
                  ) as EmojiPlane['corners'],
                  lattice: currentPlane.lattice?.map(point => ({ ...point })),
                };
                console.log(`[PAINT PLANE] Starting pinch scale on plane ${planeId}, initialDistance=${distance.toFixed(0)}`);
                return;
              }

              // Calculate scale factor from distance change
              const scaleFactor = distance / planePinchRef.current.initialDistance;

              // Apply scale to plane (relative to initial corners)
              const plane = emojiPlanesRef.current.find(p => p.id === planeId);
              const initialPlane = planePinchRef.current.initialPlane;
              if (!plane || !initialPlane) return;

              // Calculate center of initial corners
              const initialCorners = initialPlane.corners;
              const centerX = (initialCorners.topLeft.x + initialCorners.topRight.x +
                              initialCorners.bottomLeft.x + initialCorners.bottomRight.x) / 4;
              const centerY = (initialCorners.topLeft.y + initialCorners.topRight.y +
                              initialCorners.bottomLeft.y + initialCorners.bottomRight.y) / 4;
              const scaled = scalePlaneGeometry(initialPlane, { x: centerX, y: centerY }, scaleFactor);
              const preview = emojiPlanesRef.current.map(p => (p.id === planeId ? scaled : p));
              emojiPlanesRef.current = preview;
              setEmojiPlaneGesturePreview(preview);

              return;
            } else if (touches.length === 1 && planePinchRef.current.initialDistance > 0) {
              // Reset pinch when going back to single finger
              planePinchRef.current.initialDistance = 0;
              planePinchRef.current.lastTouchPos = { x: canvasCoords.x, y: canvasCoords.y };
              return;
            }

            // Single-finger drag - move entire plane incrementally
            if (touches.length === 1 || touches.length === 0) {
              // Calculate delta from last touch position
              if (!planePinchRef.current.lastTouchPos) {
                planePinchRef.current.lastTouchPos = { x: canvasCoords.x, y: canvasCoords.y };
                return;
              }

              const deltaX = canvasCoords.x - planePinchRef.current.lastTouchPos.x;
              const deltaY = canvasCoords.y - planePinchRef.current.lastTouchPos.y;

              // Update last touch position for next frame
              planePinchRef.current.lastTouchPos = { x: canvasCoords.x, y: canvasCoords.y };

              // Only move if delta is significant
              if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
                // Update plane position directly in ref (smooth dragging)
                const plane = emojiPlanesRef.current.find(p => p.id === planeId);
                if (!plane) return;

                const moved = translatePlaneGeometry(plane, deltaX, deltaY);
                const preview = emojiPlanesRef.current.map(p => (p.id === planeId ? moved : p));
                emojiPlanesRef.current = preview;
                setEmojiPlaneGesturePreview(preview);
                setDraggingCorner({ planeId, corner: 'body' });
              }
            }

            return;
          }

          return;
        }

        const stroke = liveStrokeRef.current;
        if (!stroke) {
          return;
        }

        // CROSS-FRAME STROKE DETECTION: Check if frame changed during drawing
        // If frame changed (e.g., during playback), split the stroke
        if (frameMode && !isPlayingFramesRef.current && strokeStartFrameIndexRef.current !== null &&
            strokeStartFrameIndexRef.current !== currentFrameIndexRef.current) {
          console.log('[Cross-Frame Draw] Frame changed from', strokeStartFrameIndexRef.current,
                      'to', currentFrameIndexRef.current, '- splitting stroke');

          // Finalize the current stroke on the old frame
          finalizeCurrentLiveStroke(false);

          // Get the last point to continue from
          const lastPoint = lastPointRef.current;
          if (lastPoint) {
            // Restart stroke on the new frame at the same position
            const baseSize = brushSizeRef.current;
            strokeStartFrameIndexRef.current = currentFrameIndexRef.current;
            initializeLiveStroke({ ...lastPoint }, baseSize);

            // Continue processing this move event with the new stroke
            // Fall through to normal move processing below
          } else {
            // No last point to continue from, just reset
            strokeStartFrameIndexRef.current = currentFrameIndexRef.current;
            return;
          }
        }
        const baseEvent = nativeEvent;
        const tool = toolModeRef.current;

        // ── STRAIGHT LINE TOOL ───────────────────────────────────────────────
        // Two numbers define this stroke and nothing else: the start captured on
        // touch-down and the CURRENT finger position. Every move event throws the
        // previous preview away and rebuilds the whole segment from those two
        // points, so the shape cannot depend on how many move events arrived, how
        // fast the finger moved, or which pointer type produced them. No
        // intermediate touch points are collected and nothing is smoothed.
        //
        // This is also why the point generation runs as a PLAIN JS call now: it
        // used to hop synchronously into the Reanimated UI runtime once per move
        // event, which made the result a function of event timing — exactly what
        // a straight line must never be.
        //
        // Nothing here touches the strokes array or undo history: the preview
        // lives only in liveStrokeRef/liveOutputPointsRef until touch-up, and
        // finalizeCurrentLiveStroke commits that same array verbatim, so the
        // committed line is pixel-identical to the last preview.
        if (tool === 'line') {
          const startPoint = lineStartRef.current;
          if (!startPoint) {
            return;
          }
          const canvasCoords = screenToCanvasCoords(baseEvent.locationX ?? 0, baseEvent.locationY ?? 0);
          const sampleTimestamp = typeof baseEvent.timestamp === 'number' ? baseEvent.timestamp : undefined;
          const timestamp = sampleTimestamp !== undefined
            ? Math.round(sampleTimestamp < 1e12 ? sampleTimestamp * 1000 : sampleTimestamp)
            : Date.now();
          const endPoint: StrokePoint = {
            x: canvasCoords.x,
            y: canvasCoords.y,
            t: timestamp,
            w: brushSizeRef.current,
          };
          lineEndRef.current = endPoint;

          const spacingTarget = Math.max(
            MIN_LINE_SPACING,
            computeStampSpacing(resolveStampSpan(stroke), brushSpacingRef.current, brushPerformanceModeRef.current === 'quality' ? 0.16 : 0.2)
          );
          const linePoints = generateLinePoints(startPoint, endPoint, spacingTarget);
          stroke.points = linePoints;
          stroke.spacing = brushSpacingRef.current;
          liveOutputPointsRef.current = linePoints;
          lastPointRef.current = endPoint;
          scheduleLiveRedraw();
          return;
        }

        const baseSpacing = clamp(brushSpacingRef.current, 0, MAX_NORMALIZED_SPACING);
        const lineMode = baseSpacing <= LINE_SPACING_THRESHOLD;
        const rawForce = typeof baseEvent.force === 'number'
          ? baseEvent.force
          : typeof baseEvent.pressure === 'number'
            ? baseEvent.pressure
            : typeof (baseEvent.touches?.[0]?.force) === 'number'
              ? baseEvent.touches[0].force
              : typeof (baseEvent.touches?.[0]?.pressure) === 'number'
                ? baseEvent.touches[0].pressure
                : undefined;
        const normalizedForce = rawForce !== undefined && Number.isFinite(rawForce)
          ? Math.max(0, Math.min(1, rawForce))
          : 0;
        const pressureEngaged = normalizedForce > 0;
        const pressureActive = !lineMode && (stylusActiveRef.current || pressureEngaged);
        const prevSpacing = liveSpacingRef.current ?? baseSpacing;
        const pressureScale = pressureEngaged ? Math.max(0, 1 - normalizedForce) : 1;
        const rawTargetSpacing = pressureActive ? baseSpacing * pressureScale : baseSpacing;
        const targetSpacing = Math.max(PRESSURE_MIN_SPACING, rawTargetSpacing);
        const applyingPressure = targetSpacing < prevSpacing;
        const smoothingFactor = pressureActive
          ? (applyingPressure ? PRESSURE_APPLY_SMOOTH : PRESSURE_RELEASE_SMOOTH)
          : PRESSURE_RELEASE_SMOOTH;
        const smoothedSpacing = clamp(
          prevSpacing + (targetSpacing - prevSpacing) * smoothingFactor,
          PRESSURE_MIN_SPACING,
          1
        );
        liveSpacingRef.current = smoothedSpacing;
        if (pressureEngaged && !lineMode) {
          const syncedSpacing = clamp(smoothedSpacing, 0, MAX_NORMALIZED_SPACING);
          updateBrushSpacingLive(syncedSpacing);
        } else {
          updateBrushSpacingLive(smoothedSpacing);
        }

        const stampSpan = resolveStampSpan(stroke);
        const spacingTarget = computeStampSpacing(stampSpan, smoothedSpacing, brushPerformanceModeRef.current === 'quality' ? 0.16 : 0.2);
        let samplingSpacingTarget = spacingTarget;
        const isLiveSmudge = Boolean(stroke.isSmudge);
        if (isLiveSmudge) {
          const nowMs = Date.now();
          if (nowMs - smudgeLastEventTimeRef.current < smudgeEventThrottleMs) {
            return;
          }
          smudgeLastEventTimeRef.current = nowMs;

          const brushDevicePx = Math.max(1, stroke.size * PixelRatio.get());
          const largeBrushFactor = Math.max(1, brushDevicePx / smudgeMaxBrushPixels);
          samplingSpacingTarget = Math.max(
            spacingTarget,
            stroke.size * smudgeSpacing * Math.min(2.2, largeBrushFactor)
          );
        }
        liveCurrentSpacingRef.current = smoothedSpacing;

        // CRITICAL: Get coalesced touches from the DRAWING touch only, not from baseEvent
        // This prevents slider touch's coalesced events from contaminating the stroke
        const coalescedSource = drawingTouch ?? baseEvent;
        const coalesced: Array<any> = coalescedSource.coalescedTouches ?? [];
        const rawSamples = coalesced.length > 0 ? coalesced : [baseEvent];
        const samples = isLiveSmudge ? [rawSamples[rawSamples.length - 1]] : rawSamples;

        let changed = false;
        samples.forEach((sample) => {
          const sampleX = sample.locationX ?? baseEvent.locationX ?? 0;
          const sampleY = sample.locationY ?? baseEvent.locationY ?? 0;

          const canvasCoords = screenToCanvasCoords(sampleX, sampleY);

          const sampleTimestamp = typeof sample.timestamp === 'number' ? sample.timestamp : undefined;
          const time = sampleTimestamp !== undefined
            ? Math.round(sampleTimestamp < 1e12 ? sampleTimestamp * 1000 : sampleTimestamp)
            : Date.now();
          // Sample current brush size for dynamic width - recalculate to pick up slider changes
          const currentWidth = isLiveSmudge
            ? Math.min(brushSizeRef.current, SMUDGE_MAX_BRUSH_SIZE)
            : brushSizeRef.current;
          const samplePoint: StrokePoint = { x: canvasCoords.x, y: canvasCoords.y, t: time, w: currentWidth };
          if (appendSmoothedSample(samplePoint, samplingSpacingTarget, canvasSize)) {
            changed = true;
          }
          lastPointRef.current = samplePoint;
        });

        stroke.spacing = smoothedSpacing;

        if (changed) {
          scheduleLiveRedraw();
        }
      },
      onPanResponderRelease: () => {
        // Clear long press timer
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        // POLYGON DRAGGING: Stop dragging
        if (draggingPolygonIndexRef.current !== null) {
          console.log(`[Polygon] Stopped dragging point ${draggingPolygonIndexRef.current}`);
          setDraggingPolygonIndex(null);
          draggingPolygonIndexRef.current = null;
          void Haptics.selectionAsync();
          return;
        }

        // EMOJI PLANE TOOL: Stop dragging corner and commit change (creates undo step)
        if (draggingCornerRef.current) {
          const { planeId } = draggingCornerRef.current;
          console.log(`[PAINT PLANE] Released corner of plane ${planeId} - committing change`);

          // Commit the corner change to context (creates single undo step)
          commitCornerChange(planeId);

          setEmojiPlaneGesturePreview(null);
          setDraggingCorner(null);
          draggingCornerRef.current = null;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          return;
        }

        // EMOJI PLANE TOOL: Stop pinch scaling or plane dragging
        if (planePinchRef.current) {
          const { planeId } = planePinchRef.current;
          console.log(`[PAINT PLANE] Released plane ${planeId}`);

          // The same geometry commit handles corner, lattice, body-drag, and pinch changes. This is
          // essential once a lattice exists: committing corners alone leaves the rendered surface
          // behind at its old position.
          commitCornerChange(planeId);

          planePinchRef.current = null;
          setEmojiPlaneGesturePreview(null);
          setDraggingCorner(null); // Clear body-drag render trigger
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return;
        }

        // Don't finalize stroke if long press was triggered (we picked an emoji instead)
        if (!multiTouchAbortRef.current && !longPressTriggeredRef.current) {
          finalizeCurrentLiveStroke(false);
        }
        resetLiveStrokeState();
        multiTouchAbortRef.current = false;
        longPressTriggeredRef.current = false;
        activeDrawingTouchIdRef.current = null; // Clear active touch tracking
        strokeStartFrameIndexRef.current = null; // Clear frame tracking
      },
      onPanResponderTerminate: () => {
        // Clear long press timer
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        // Gesture-handler/zoom can terminate the responder. Finalize plane geometry exactly as a
        // normal release so a warped handle is never left only in the preview ref or stuck active.
        if (draggingCornerRef.current) {
          commitCornerChange(draggingCornerRef.current.planeId);
          draggingCornerRef.current = null;
          setEmojiPlaneGesturePreview(null);
          setDraggingCorner(null);
          return;
        }
        if (planePinchRef.current) {
          commitCornerChange(planePinchRef.current.planeId);
          planePinchRef.current = null;
          setEmojiPlaneGesturePreview(null);
          setDraggingCorner(null);
          return;
        }

        if (!multiTouchAbortRef.current && !longPressTriggeredRef.current) {
          finalizeCurrentLiveStroke(false);
        }
        resetLiveStrokeState();
        multiTouchAbortRef.current = false;
        longPressTriggeredRef.current = false;
        activeDrawingTouchIdRef.current = null; // Clear active touch tracking
        strokeStartFrameIndexRef.current = null; // Clear frame tracking
      }
    });
  }
  const canvasPanResponder = _cpRef.current;

  const handleTraceScaleChange = useCallback(
    (value: number) => {
      const clamped = clamp(value, MIN_TRACE_SCALE, MAX_TRACE_SCALE);
      scale.value = clamped;
      pinchStartScale.value = clamped;
      dispatch({ type: 'SET_TRACE', trace: { scale: clamped } });
    },
    [dispatch, pinchStartScale, scale]
  );

  const handleTraceOpacityChange = useCallback((value: number) => {
    const clamped = clamp(value, 0, 1);
    opacity.value = clamped;
    dispatch({ type: 'SET_TRACE', trace: { opacity: clamped } });
  }, [dispatch, opacity]);

  const handleTraceConfirm = useCallback(() => {
    void Haptics.selectionAsync();
    setShowTraceControls(false);
  }, []);

  const handleTraceToggleBackground = useCallback(() => {
    void Haptics.selectionAsync();
    const nextIsBackground = !trace.isBackground;
    if (nextIsBackground) {
      opacity.value = 1;
      dispatch({ type: 'SET_TRACE', trace: { isBackground: true, opacity: 1 } });
    } else {
      const restoreOpacity = 0.3;
      opacity.value = restoreOpacity;
      dispatch({ type: 'SET_TRACE', trace: { isBackground: false, opacity: restoreOpacity } });
    }
  }, [dispatch, trace.isBackground, opacity]);

  const handleFramePickerSelect = useCallback(async (index: number) => {
    setFramePickerVisible(false);
    void Haptics.selectionAsync();
    if (!frameModeRef.current) {
      await toggleFrameMode(true);
    }
    await switchToFrame(index);
    await toggleFrameMode(false);
  }, [switchToFrame, toggleFrameMode]);

  const removeTrace = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    // CRITICAL FIX: Delete trace image file to prevent memory leak (10-50MB)
    if (trace.imageUri) {
      FileSystem.deleteAsync(trace.imageUri, { idempotent: true }).catch(() => {
        // Silently ignore deletion errors (file may not exist)
      });
    }

    offsetX.value = 0;
    offsetY.value = 0;
    scale.value = 1;
    rotation.value = 0;
    dispatch({
      type: 'SET_TRACE',
      trace: { imageUri: null, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, opacity: 0.3, isBackground: false }
    });
    setShowTraceControls(false);
    setTraceLoading(false);
    setTraceLoadingMessage('Loading trace…');
  }, [dispatch, offsetX, offsetY, rotation, scale, trace.imageUri, trace.opacity]);

  const pickTraceImage = useCallback(async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        CustomOverlayHelper.alert('Permission required', 'Grant photo access to import a trace image.');
        return;
      }
      if (trace.imageUri) {
        CustomOverlayHelper.alert('Trace already loaded', 'Remove the current trace before importing another.');
        return;
      }
      setTraceLoadingMessage(TRACE_LOADING_MESSAGES[Math.floor(Math.random() * TRACE_LOADING_MESSAGES.length)] ?? 'Loading trace…');
      setTraceLoading(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1
      });
      if (result.canceled || result.assets.length === 0) {
        setTraceLoading(false);
        return;
      }
      const asset = result.assets[0];
      const { width: imageWidth, height: imageHeight } = asset;

      // Use the actual visible canvas dimensions
      const canvasWidth = canvasSize;
      const canvasHeight = canvasSize * CANVAS_RATIO;

      // Scale to fit canvas width exactly
      const initialScale = (() => {
        if (!imageWidth || !imageHeight) return 1;
        const scaleToFitWidth = canvasWidth / imageWidth;
        // honor min/max limits
        const clamped = Math.max(MIN_TRACE_SCALE, Math.min(MAX_TRACE_SCALE, scaleToFitWidth));
        return clamped;
      })();

      opacity.value = TRACE_DEFAULT_OPACITY;

      // Reset canvas zoom to default (scale=1, centered)
      setCanvasZoomLevel(1);
      mainCanvasTransformRef.current = {
        scale: 1,
        translateX: 0,
        translateY: 0
      };

      // Start at initialScale, then animate UP
      // iPhone: 4x bigger (3x more), iPad: 1.3x bigger (30% more)
      const targetScale = IS_IPAD ? initialScale * 1.3 : initialScale * 4;

      // Calculate offsets for centered positioning
      const isLandscape = imageWidth && imageHeight && imageWidth > imageHeight;

      const calculatedOffsetX = (() => {
        if (!imageWidth || !imageHeight) return 0;
        const scaledImageWidth = imageWidth * initialScale;
        return (canvasWidth - scaledImageWidth) / 2;
      })();

      const calculatedOffsetY = (() => {
        if (!imageWidth || !imageHeight) return 0;
        const scaledImageHeight = imageHeight * initialScale;
        // Center vertically
        const centered = (canvasHeight - scaledImageHeight) / 2;
        // Portrait: move down 200px, Landscape: move up 200px (subtract instead of add)
        return isLandscape ? centered - 200 : centered + 200;
      })();

      // Set initial shared values BEFORE dispatch to avoid useEffect overwriting animation
      offsetX.value = calculatedOffsetX;
      offsetY.value = calculatedOffsetY;
      scale.value = initialScale;
      rotation.value = 0;
      pinchStartScale.value = initialScale;

      dispatch({
        type: 'SET_TRACE',
        trace: {
          imageUri: asset.uri,
          scale: initialScale,
          offsetX: calculatedOffsetX,
          offsetY: calculatedOffsetY,
          rotation: 0,
          opacity: TRACE_DEFAULT_OPACITY
        }
      });

      // Animate scale on JS thread using requestAnimationFrame for smooth slider movement
      setShowTraceControls(true);

      // Wait 1 second, then animate over 1 second from initialScale to targetScale
      const animationStartTime = Date.now() + 1000; // Start after 1 second delay
      const animationDuration = 1000; // 1 second animation

      const animateScale = () => {
        const now = Date.now();
        const elapsed = now - animationStartTime;

        if (elapsed < 0) {
          // Still in delay period
          requestAnimationFrame(animateScale);
          return;
        }

        if (elapsed < animationDuration) {
          // Animation in progress
          const progress = elapsed / animationDuration;
          const currentScale = initialScale + (targetScale - initialScale) * progress;
          scale.value = currentScale;
          pinchStartScale.value = currentScale;
          dispatch({ type: 'SET_TRACE', trace: { scale: currentScale } });
          requestAnimationFrame(animateScale);
        } else {
          // Animation complete
          scale.value = targetScale;
          pinchStartScale.value = targetScale;
          dispatch({ type: 'SET_TRACE', trace: { scale: targetScale } });
        }
      };

      requestAnimationFrame(animateScale);
    } catch (error) {
      console.error('Trace import failed', error);
      CustomOverlayHelper.alert('Import failed', 'Could not import trace image.');
    } finally {
      setTraceLoading(false);
      setTraceLoadingMessage('Loading trace…');
    }
  }, [dispatch, trace.imageUri]);

  const openTimelapse = useCallback(() => {
    console.log('[PaintScreen] openTimelapse called - navigating to Timelapse screen');
    void Haptics.selectionAsync();

    // Complete tutorial lesson 4 if active - set state for detection
    if (tutorialActive && tutorialCurrentLesson === 4) {
      console.log('[Tutorial] Lesson 4 completed - user opened timelapse!');
      setTutorialTimelapseOpened(true);
    }

    void (async () => {
      await awaitSnapshotQueue();
      console.log('[PaintScreen] Navigating to Timelapse now');
      navigation.navigate('Timelapse');
    })();
  }, [awaitSnapshotQueue, navigation, tutorialActive, tutorialCurrentLesson]);

  const openExportScreen = useCallback(async () => {
    void Haptics.selectionAsync();

    // Frames are now handled by Framer's @framer_persistent_data
    // ExportScreen reads Framer state directly from AsyncStorage
    navigation.navigate('Export');
  }, [navigation]);

  const quickSaveProject = useCallback(async () => {
    if (strokes.length === 0) {
      return;
    }
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Always save to current session
      const projectName = snapshotProjectId;
      console.log('[PaintScreen] Quick save to session:', projectName, 'with', strokes.length, 'strokes');

      // Always regenerate preview from current strokes
      let preview: string | null = null;
      try {
        preview = await capturePreview();
        console.log('[PaintScreen] Generated preview, length:', preview?.length);
      } catch (error) {
        console.warn('Quick save preview capture failed', error);
      }

      // Get Framer data from either active workspace or persistent storage
      let framerData = null;
      try {
        // First try to get from active Framer workspace
        if (framerWorkspaceRef.current?.getFramerState) {
          try {
            framerData = framerWorkspaceRef.current.getFramerState();
          } catch (e) {
            console.warn('[PaintScreen] getFramerState failed:', e);
          }
        }

        // If Framer workspace is closed but we have persistent data, use that
        if (!framerData && framerPersistentDataRef.current) {
          framerData = framerPersistentDataRef.current;
          console.log('[PaintScreen] Using persistent Framer data from ref');
        }

        if (framerData) {
          console.log('[SAVE] ✅ Including Framer data in project save:', {
            frameCount: framerData.frames?.length ?? 0,
            hasBackground: !!framerData.backgroundImage,
            hasVideo: !!framerData.videoBackground,
            fps: framerData.fps,
            hasImportedStrokes: !!framerData.importedBackgroundStrokes?.length
          });
        } else {
          console.log('[SAVE] ℹ️ No Framer data to save (workspace not used or empty)');
        }
      } catch (error) {
        console.error('[PaintScreen] Failed to get Framer data:', error);
      }

      let payload = createProjectPayload({
        strokes,
        trace,
        brushEmoji,
        brushSize,
        brushOpacity,
        brushSpacing,
        brushRotation,
        mirrorX,
        mirrorY,
        recentEmojis,
        preview,
        // 3-layer system: stroke→layer assignment travels on the strokes themselves; the editor-level
        // active layer + per-layer visibility are stored alongside (both optional/additive).
        activeLayer,
        layerVisibility,
        framerFrames: framerData // Include Framer data in payload
      });

      // If we have frames (even if not currently in frame mode), include frame data
      if (frames.length > 0) {
        console.log('[PaintScreen] Saving project with', frames.length, 'frames as animation');
        payload = {
          ...payload,
          frames: frames.map(f => ({
            id: f.id,
            strokes: cloneStrokes(f.strokes),
            timestamp: f.timestamp,
            thumbnail: f.thumbnail
          })),
          fps: exportFps,
          isAnimation: true
        };
      }

      await saveProjectUnified(projectName, payload, 'workspace');
      // Notify listeners (e.g., project list) to refresh
      try { const { emitAppEvent } = require('../lib/appEvents'); emitAppEvent('projects/updated'); } catch {}
      await setSnapshotProjectId(projectName);

      // Auto-reload the project to keep frames visible
      console.log('[PaintScreen] Auto-reloading project after save to restore frames...');
      const reloadedPayload = await loadProject(projectName);
      if (reloadedPayload) {
        restorePaintingState(reloadedPayload as any);
        console.log('[PaintScreen] Project reloaded successfully with', reloadedPayload.frames?.length ?? 0, 'frames');

        // Restore Framer data if present - store in persistent ref
        if (reloadedPayload.framerFrames) {
          framerPersistentDataRef.current = reloadedPayload.framerFrames;
          setFramerInitialData(reloadedPayload.framerFrames);
          console.log('[PaintScreen] Framer data stored persistently for next Framer open');
        }
      }

      CustomOverlayHelper.alert('Saved', 'Session updated.');
    } catch (error) {
      console.error('Save failed', error);
      CustomOverlayHelper.alert('Save failed', 'Could not save project.');
    }
  }, [activeLayer, brushEmoji, brushOpacity, brushRotation, brushSize, brushSpacing, capturePreview, layerVisibility, mirrorX, mirrorY, recentEmojis, saveProject, setSnapshotProjectId, snapshotProjectId, strokes, trace, frameMode, frames, exportFps, restorePaintingState]);

  const exportCurrentPainting = useCallback(async () => {
    if (isExporting || strokes.length === 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      setExporting(true);

      // Determine export size based on PNG export size setting
      let exportSize: number;
      let useMetalRenderer = true; // Always use Metal renderer for high quality

      if (pngExportSize === '12k') {
        exportSize = 12288;
        // 12K = 151 million pixels, ~600MB memory - warn user
        console.warn('[Export] 12K export requires significant memory');
      } else if (pngExportSize === '8k') {
        exportSize = 8192;
      } else { // '4k'
        exportSize = 4096;
      }

      // Smudge can't be reproduced by the native stroke exporter (it can't sample
      // canvas pixels), so paintings with smudge export via the engine-agnostic Skia
      // offscreen replay (device resolution, correct smudge) instead.
      if (hasSmudgeStroke(strokes)) {
        console.log('[Export] Painting has smudge → Skia offscreen export (correct smudge)');
        const smudgeUri = await renderStrokesToPngFile(layeredForExport(strokes), canvasSize, canvasSize * CANVAS_RATIO, null);
        if (smudgeUri) {
          await deliverExportedImage(smudgeUri);
          setExporting(false);
          return;
        }
        console.warn('[Export] Skia smudge export failed — falling back to native renderer');
      }

      // Use Metal renderer for all exports (4K/8K/12K) with transparent background
      console.log(`[Export] Generating ${pngExportSize.toUpperCase()} PNG using Metal renderer (${exportSize}x${exportSize})`);
      const scaleFactor = exportSize / canvasSize;
      const scaledStrokes = layeredForExport(strokes).map(stroke => ({
        ...stroke,
        size: stroke.size * scaleFactor,
        points: stroke.points.map(p => ({
          ...p,
          x: p.x * scaleFactor,
          y: p.y * scaleFactor * CANVAS_RATIO
        }))
      }));

      // CRITICAL: Pass exportSize as canvasWidth/canvasHeight so generateProjectPreview knows strokes are already scaled
      let dataUri: string | null = null;
      try {
        dataUri = await generateProjectPreview(scaledStrokes, exportSize, exportSize, exportSize);
      } catch (memoryError: any) {
        console.error('[Export] Memory error during PNG generation:', memoryError);
        if (pngExportSize === '12k') {
          CustomOverlayHelper.alert(
            '12K Export Failed',
            'Not enough memory for 12K export. Try 8K instead.\n\n12K requires ~600MB of RAM.',
            [{ text: 'OK' }]
          );
        } else {
          CustomOverlayHelper.alert('Export failed', `Memory error: ${memoryError?.message || 'Unknown error'}`);
        }
        setExporting(false);
        return;
      }

      if (!dataUri) {
        CustomOverlayHelper.alert('Export failed', 'Could not generate high-resolution PNG.');
        setExporting(false);
        return;
      }

      // Save data URI to file
      const fsModule = FileSystem as typeof FileSystem & { cacheDirectory?: string; documentDirectory?: string };
      const cacheDir = fsModule.cacheDirectory ?? fsModule.documentDirectory ?? null;
      if (!cacheDir) {
        CustomOverlayHelper.alert('Export failed', 'Could not access file system.');
        setExporting(false);
        return;
      }
      const normalizedDir = cacheDir.endsWith('/') ? cacheDir : `${cacheDir}/`;
      const fileName = `emojipaint-${pngExportSize}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      const tempUri = `${normalizedDir}${fileName}`;

      await FileSystem.writeAsStringAsync(
        tempUri,
        dataUri.replace('data:image/png;base64,', ''),
        { encoding: FileSystem.EncodingType.Base64 }
      );

      console.log(`[Export] ${pngExportSize.toUpperCase()} PNG saved to:`, tempUri);

      await deliverExportedImage(tempUri);
      // NOTE: Don't delete files here! They're needed when user clicks Share/Save.
      // Files will be cleaned up by the export option handlers.
    } catch (error) {
      console.error('Export failed', error);
      CustomOverlayHelper.alert('Export failed', 'Could not export PNG.');
    } finally {
      setExporting(false);
    }
  }, [deliverExportedImage, isExporting, strokes, pngExportSize, canvasSize]);

  const mainQuickActions = useMemo(() => {
    // Count only painted strokes (excluding invisible border strokes)
    const paintedStrokeCount = strokes.filter(s => s?.id && !s.id.startsWith('border_')).length;

    const lang = infoLanguage as TutorialLanguage;
    // Face filter 2D mode: clean canvas — hide all bottom tools
    if (faceFilterModeActive) return [];
    return [
    // Easter egg: Show gallery button until user visits gallery, then show trace button
    !galleryVisitedThisSession
      ? {
          key: 'gallery',
          icon: '🏛️',
          onPress: openGallery,
          label: 'Open gallery',
          helperLabel: getElementLabel(lang, 'gallery_button'),
          showCoachFeedback: false,
          disabled: false
        }
      : trace.imageUri
      ? {
          key: 'import',
          icon: showTraceControls ? '👀' : '🛠️',
          onPress: () => {
            void Haptics.selectionAsync();
            setShowTraceControls((prev) => !prev);
          },
          label: showTraceControls ? 'Hide trace tools' : 'Adjust trace tools',
          helperLabel: getElementLabel(lang, 'trace_button'),
          disabled: traceLoading
        }
      : {
          key: 'import',
          icon: '🖼️',
          onPress: pickTraceImage,
          label: 'Import trace image',
          helperLabel: getElementLabel(lang, 'trace_button'),
          disabled: traceLoading
        },
    {
      key: 'emoji',
      icon: brushEmoji,
      onPress: cycleBrushEmoji,
      label: 'Choose brush emoji',
      helperLabel: getElementLabel(lang, 'emoji_picker_button'),
      disabled: false
    },
    {
      key: 'timelapse',
      icon: '🎞️',
      onPress: openTimelapse,
      label: 'Open timelapse viewer',
      helperLabel: getElementLabel(lang, 'timelapse_button'),
      showCoachFeedback: false,
      disabled: (isExporting || strokes.length === 0 || !!activeChallenge)
    },
    // Frame-by-frame button: always shown (moved to 4th position)
    {
      key: 'frameByFrame',
      icon: frameButtonIcon, // Animated icon when multiple frames exist
      onPress: () => {
        void Haptics.selectionAsync();
        if (activeChallenge || faceFilterModeActive) {
          // Challenge running (or already in a special mode): jump straight to the animator
          setFramerWorkspaceVisible(true);
        } else {
          // No challenge: offer Face Filter / AR Painting / Animator
          setArChooserVisible(true);
        }
      },
      onLongPress: () => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        // Long press opens old frame-by-frame mode (kept for compatibility)
        toggleFrameMode(true);
      },
      onLayout: (coords: { x: number; y: number; width: number; height: number }) => {
        setFrameButtonPosition(coords);
      },
      label: 'Open Framer workspace (long-press for classic frame-by-frame)',
      showCoachFeedback: false,
      disabled: false
    },
    {
      key: 'export',
      icon: isExporting ? '⌛' : '📤',
      onPress: exportCurrentPainting,
      label: 'Export current painting',
      helperLabel: getElementLabel(lang, 'export_button'),
      disabled: isExporting || strokes.length === 0
    },
    {
      key: 'exportScreen',
      icon: '🗂️',
      onPress: activeChallenge ? undefined : openExportScreen,
      label: 'Open export screen',
      helperLabel: getElementLabel(lang, 'export_button'),
      showCoachFeedback: false,
      disabled: (isExporting || strokes.length === 0 || !!activeChallenge)
    },
    // Info button always last (rightmost position)
    {
      key: 'info',
      icon: 'ℹ️',
      onPress: openInfoPanel,
      label: 'Show app guide',
      helperLabel: getElementLabel(lang, 'info_button'),
      showCoachFeedback: false,
      disabled: false
    }
  ];
  }, [brushEmoji, cycleBrushEmoji, exportCurrentPainting, isExporting, openExportScreen, openInfoPanel, openTimelapse, pickTraceImage, strokes, trace.imageUri, showTraceControls, traceLoading, toggleFrameMode, frameButtonIcon, activeChallenge, galleryVisitedThisSession, openGallery, infoLanguage, faceFilterModeActive, openFaceFilterOverlay, toggleFaceFilterTemplate, exitFaceFilterMode]);

  const privateStudioQuickActions = useMemo(
    () => [] as Array<{ key: string; icon: string; label: string; disabled?: boolean; onPress?: () => void }>,
    []
  );

  const privateStudioUploadDisabled = privateStudioUploadInFlight || privateStudioStrokeCount === 0 || privateStudioLoading;

const spacingSliderValue = useMemo(() => spacingNormalizedToSlider(brushSpacing), [brushSpacing]);

  const emojiPickerSpacingSlider = useMemo(() => {
    // Show the emoji stroke spacing slider on all devices (incl. iPad).
    return {
      value: spacingSliderValue,
      minimum: SPACING_SLIDER_MIN,
      maximum: SPACING_SLIDER_MAX,
      onChange: handleBrushSpacingChange,
      onComplete: handleBrushSpacingComplete
    };
  }, [handleBrushSpacingChange, handleBrushSpacingComplete, spacingSliderValue]);

  // Button is "active" (highlighted) whenever it's not the default opaque mode.
  const isOpacityMostlyTransparent = brushMode !== 'opaque';
  const opacityToggleEmoji = brushMode === 'smudge' ? '👆' : brushMode === 'transparent' ? '1️⃣' : '💯';

  const privateStudioCanvasSize = useMemo(() => {
    return canvasSize;
  }, [canvasSize]);
  const privateStudioScale = useMemo(() => 1, []);

  const privateStudioCanvasAnimatedStyle = useMemo(() => {
    const { midX, midY, endX, endY, midScale, endScale, endRotate } = privateStudioFlightVector;
    const translateX = privateStudioCanvasFlight.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0, midX, endX]
    });
    const translateY = privateStudioCanvasFlight.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0, midY, endY]
    });
    const scaleAnimated = privateStudioCanvasFlight.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [1, midScale, endScale]
    });
    const rotate = privateStudioCanvasFlight.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: ['0rad', `${endRotate * 0.6}rad`, `${endRotate}rad`]
    });
    const opacity = privateStudioCanvasFlight.interpolate({
      inputRange: [0, 0.7, 1],
      outputRange: [1, 1, 0]
    });
    return {
      transform: [
        { translateX },
        { translateY },
        { scale: scaleAnimated },
        { scale: privateStudioScale },
        { rotate }
      ],
      opacity
    };
  }, [privateStudioCanvasFlight, privateStudioFlightVector, privateStudioScale]);

  const uploadPulse = useRef(new RNAnimated.Value(0)).current;
  const uploadScale = useMemo(() => uploadPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }), [uploadPulse]);
  const uploadGlowOpacity = useMemo(() => uploadPulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.35, 0] }), [uploadPulse]);

  // leaderboardOverlayAnimatedStyle moved to useLeaderboard hook

  useEffect(() => {
    if (privateStudioUploadDisabled || privateStudioUploadInFlight) {
      uploadPulse.stopAnimation(() => {
        uploadPulse.setValue(0);
      });
      return () => undefined;
    }
    let timeout: NodeJS.Timeout | null = null;
    let cancelled = false;
    const runPulse = () => {
      const delay = 3000 + Math.floor(Math.random() * 2000);
      timeout = setTimeout(() => {
        RNAnimated.sequence([
          RNAnimated.timing(uploadPulse, { toValue: 1, duration: 200, useNativeDriver: true }),
          RNAnimated.timing(uploadPulse, { toValue: 0, duration: 200, useNativeDriver: true }),
          RNAnimated.timing(uploadPulse, { toValue: 1, duration: 160, useNativeDriver: true }),
          RNAnimated.timing(uploadPulse, { toValue: 0, duration: 240, useNativeDriver: true })
        ]).start(({ finished }) => {
          if (finished && !cancelled) {
            runPulse();
          }
        });
      }, delay);
    };
    runPulse();
    return () => {
      cancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      uploadPulse.stopAnimation();
    };
  }, [privateStudioUploadDisabled, privateStudioUploadInFlight, uploadPulse]);


  const privateStudioLeaderboardIntentRef = useRef(false);

  useEffect(() => {
    if (privateStudioLeaderboardVisible) {
      if (!privateStudioLeaderboardIntentRef.current) {
        privateStudioLeaderboardIntentRef.current = true;
        void (async () => {
          try {
            await persistPrivateStudioState();
          } catch (error) {
            console.warn('Profil Studio autosave before leaderboard failed', error);
          }
          await leaderboard.refreshLeaderboard();
        })();
      }
      if (!leaderboard.leaderboardVisible) {
        leaderboard.openLeaderboard();
      }
    } else {
      privateStudioLeaderboardIntentRef.current = false;
      if (privateStudioVisible && leaderboard.leaderboardVisible) {
        leaderboard.closeLeaderboard();
      }
    }
  }, [leaderboard.closeLeaderboard, leaderboard.leaderboardVisible, leaderboard.openLeaderboard, leaderboard.refreshLeaderboard, persistPrivateStudioState, privateStudioLeaderboardVisible, privateStudioVisible, setPrivateStudioStatusMessage]);

  // Memoized onion skin layers to prevent infinite re-rendering
  const onionSkinLayers = useMemo(() => {
    if (!frameMode || !onionSkinning.enabled || isPlayingFrames || hideOnionForSnapshot || !viewShotLayout) {
      return null;
    }

    const onionLayers: JSX.Element[] = [];

    // Get current zoom state to apply to onion skins
    const zoomState = mainCanvasTransformRef.current;
    const zoomScale = zoomState.scale || 1;
    const zoomTranslateX = zoomState.translateX || 0;
    const zoomTranslateY = zoomState.translateY || 0;

    // Find the ACTUAL canvas position by reading border stroke coordinates from CURRENT DRAWING
    const currentBorderStrokes = strokes.filter(s => s?.id && s.id.startsWith('border_'));
    const stageHeight = viewShotLayout.height;

    let canvasOffsetLeft = 0;
    let canvasOffsetTop = 0;

    if (currentBorderStrokes.length >= 4) {
      const topBorder = currentBorderStrokes.find(s => s.id.includes('border_top'));
      const leftBorder = currentBorderStrokes.find(s => s.id.includes('border_left'));

      if (topBorder && topBorder.points.length > 0 && leftBorder && leftBorder.points.length > 0) {
        const borderPadding = 10;
        canvasOffsetLeft = topBorder.points[0].x - borderPadding;
        canvasOffsetTop = topBorder.points[0].y - borderPadding;
      }
    }

    // Fallback: use centered calculation if border strokes not found
    if (canvasOffsetLeft === 0 && canvasOffsetTop === 0) {
      const canvasAreaWidth = canvasSize;
      const canvasAreaHeight = canvasSize * CANVAS_RATIO;
      const stageWidth = viewShotLayout.width;
      canvasOffsetLeft = Math.max(0, (stageWidth - canvasAreaWidth) / 2);
      canvasOffsetTop = Math.max(0, (stageHeight - canvasAreaHeight) / 2);
    }

    // Onion skin positioning uses calculated offsets without additional adjustments

    // Helper: create border strokes for each frame
    const createBorderStrokes = (timestamp: number): Stroke[] => {
      const padding = 10;
      return [
        {
          id: `border_top_${timestamp}`,
          emoji: '⬜',
          size: 2,
          opacity: 0,
          spacing: 0.01,
          mirrorX: false,
          mirrorY: false,
          rotation: 0,
          points: [
            { x: padding, y: padding, t: 0 },
            { x: canvasSize - padding, y: padding, t: 1 }
          ]
        },
        {
          id: `border_right_${timestamp}`,
          emoji: '⬜',
          size: 2,
          opacity: 0,
          spacing: 0.01,
          mirrorX: false,
          mirrorY: false,
          rotation: 0,
          points: [
            { x: canvasSize - padding, y: padding, t: 1 },
            { x: canvasSize - padding, y: canvasSize * CANVAS_RATIO - padding, t: 2 }
          ]
        },
        {
          id: `border_bottom_${timestamp}`,
          emoji: '⬜',
          size: 2,
          opacity: 0,
          spacing: 0.01,
          mirrorX: false,
          mirrorY: false,
          rotation: 0,
          points: [
            { x: canvasSize - padding, y: canvasSize * CANVAS_RATIO - padding, t: 2 },
            { x: padding, y: canvasSize * CANVAS_RATIO - padding, t: 3 }
          ]
        },
        {
          id: `border_left_${timestamp}`,
          emoji: '⬜',
          size: 2,
          opacity: 0,
          spacing: 0.01,
          mirrorX: false,
          mirrorY: false,
          rotation: 0,
          points: [
            { x: padding, y: canvasSize * CANVAS_RATIO - padding, t: 3 },
            { x: padding, y: padding, t: 4 }
          ]
        }
      ];
    };

    // Previous frames (rendered below current frame with transparency)
    for (let i = 1; i <= onionSkinning.before; i++) {
      const frameIndex = currentFrameIndex - i;
      if (frameIndex >= 0 && frameIndex < frames.length && frames[frameIndex].strokes.length > 0) {
        const baseOpacity = Math.max(0.15, 1.0 - (i * 0.2));
        const strokesWithBorders = [...createBorderStrokes(Date.now() + i), ...frames[frameIndex].strokes];
        onionLayers.push(
          <View
            key={`onion-before-${frameIndex}`}
            style={{
              position: 'absolute',
              top: canvasOffsetTop,
              left: canvasOffsetLeft,
              width: canvasSize,
              height: canvasSize * CANVAS_RATIO,
              pointerEvents: 'none',
              opacity: onionSkinning.opacity * baseOpacity,
              transform: [
                { translateX: zoomTranslateX },
                { translateY: zoomTranslateY },
                { scale: zoomScale }
              ]
            }}
          >
            <PaintCanvas
              width={canvasSize}
              height={canvasSize * CANVAS_RATIO}
              strokes={strokesWithBorders}
              liveStroke={null}
              liveVersion={0}
            />
          </View>
        );
      }
    }

    // Next frames (rendered on top with transparency)
    for (let i = 1; i <= onionSkinning.after; i++) {
      const frameIndex = currentFrameIndex + i;
      if (frameIndex >= 0 && frameIndex < frames.length && frames[frameIndex].strokes.length > 0) {
        const baseOpacity = Math.max(0.15, 1.0 - (i * 0.2));
        const strokesWithBorders = [...createBorderStrokes(Date.now() + i + 1000), ...frames[frameIndex].strokes];
        onionLayers.push(
          <View
            key={`onion-after-${frameIndex}`}
            style={{
              position: 'absolute',
              top: canvasOffsetTop,
              left: canvasOffsetLeft,
              width: canvasSize,
              height: canvasSize * CANVAS_RATIO,
              transform: [
                { translateX: zoomTranslateX },
                { translateY: zoomTranslateY },
                { scale: zoomScale }
              ],
              pointerEvents: 'none',
              opacity: onionSkinning.opacity * baseOpacity * 0.9
            }}
          >
            <PaintCanvas
              width={canvasSize}
              height={canvasSize * CANVAS_RATIO}
              strokes={strokesWithBorders}
              liveStroke={null}
              liveVersion={0}
            />
          </View>
        );
      }
    }

    // Special feature: On the last frame, show a preview of the first frame
    if (frames.length > 1 && currentFrameIndex === frames.length - 1 && frames[0].strokes.length > 0) {
      const strokesWithBorders = [...createBorderStrokes(Date.now() + 2000), ...frames[0].strokes];
      onionLayers.push(
        <View
          key={`onion-first-frame-preview`}
          style={{
            position: 'absolute',
            top: canvasOffsetTop,
            left: canvasOffsetLeft,
            width: canvasSize,
            height: canvasSize * CANVAS_RATIO,
            pointerEvents: 'none',
            opacity: onionSkinning.opacity * 0.5,
            transform: [
              { translateX: zoomTranslateX },
              { translateY: zoomTranslateY },
              { scale: zoomScale }
            ]
          }}
        >
          <PaintCanvas
            width={canvasSize}
            height={canvasSize * CANVAS_RATIO}
            strokes={strokesWithBorders}
            liveStroke={null}
            liveVersion={0}
          />
          <View style={{
            position: 'absolute',
            top: 10,
            right: 10,
            backgroundColor: 'rgba(76,175,80,0.8)',
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 4
          }}>
            <Text style={{
              color: '#fff',
              fontSize: 11,
              fontWeight: 'bold',
              fontFamily: 'vrtlfinal'
            }}>🔁 Frame 1</Text>
          </View>
        </View>
      );
    }

    return onionLayers;
  }, [frameMode, onionSkinning, isPlayingFrames, hideOnionForSnapshot, viewShotLayout, strokes, currentFrameIndex, frames, canvasSize, canvasZoomLevel]);

  const privateStudioControlBar = useMemo(() => (
    <View style={styles.privateStudioControlsContainer}>
      <View style={styles.privateStudioControlsRow}>
        <TouchableOpacity
          style={styles.privateStudioEmojiButton}
          onPress={handleOpenEmojiPicker}
          accessibilityRole="button"
          accessibilityLabel="Choose brush emoji"
        >
          <BrushEmojiIcon
            emoji={brushEmoji}
            size={30}
            textStyle={styles.privateStudioEmoji}
            imageStyle={{ backgroundColor: 'rgba(0,0,0,0.08)' }}
          />
        </TouchableOpacity>

        <View style={styles.privateStudioSliderGroup}>
          <Slider
            style={styles.privateStudioSlider}
            minimumValue={1}
            maximumValue={100}
            step={1}
            value={Math.min(100, brushSize)}
            onValueChange={handlePrivateStudioSizeChange}
            minimumTrackTintColor="#ff9f6b"
            maximumTrackTintColor="#2e2e2e"
            thumbTintColor="#ff9f6b"
            accessibilityLabel="Brush size"
          />
          <Text style={styles.privateStudioSliderValue}>
            {brushSize}
            {canvasZoomLevel > 1.0001 && (
              <Text style={{ opacity: 0.6 }}>
                {' '}
                (→{displayBrushSize})
              </Text>
            )}
          </Text>
        </View>
        {IS_IPAD ? (
          <View style={styles.privateStudioSliderGroup}>
            <Slider
              style={styles.privateStudioSlider}
              minimumValue={SPACING_SLIDER_MIN}
              maximumValue={SPACING_SLIDER_MAX}
              value={spacingSliderValue}
              onValueChange={handleBrushSpacingChange}
              onSlidingComplete={handleBrushSpacingComplete}
              minimumTrackTintColor="#9fd5ff"
              maximumTrackTintColor="#2e2e2e"
              thumbTintColor="#9fd5ff"
              accessibilityLabel="Brush spacing"
            />
            <Text style={styles.privateStudioSliderValue}>
              {spacingSliderValue >= 10
                ? spacingSliderValue.toFixed(1)
                : spacingSliderValue >= 1
                  ? spacingSliderValue.toFixed(2)
                  : spacingSliderValue.toFixed(3)}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.privateStudioOpacityButton, isOpacityMostlyTransparent && styles.privateStudioOpacityActive]}
          onPress={toggleBrushOpacity}
          accessibilityRole="button"
          accessibilityLabel="Toggle brush opacity"
        >
          <Text style={styles.privateStudioOpacityEmoji}>{opacityToggleEmoji}</Text>
        </TouchableOpacity>

        <RNAnimated.View
          style={[styles.privateStudioUploadWrapper, { transform: [{ scale: uploadScale }] }, privateStudioUploadDisabled && styles.privateStudioActionDisabled]}
        >
          <TouchableOpacity
            style={styles.privateStudioUploadButton}
            onPress={handlePrivateStudioUpload}
            disabled={privateStudioUploadDisabled}
            accessibilityRole="button"
            accessibilityLabel="Upload passport"
          >
            {privateStudioUploadInFlight ? (
              <ActivityIndicator color="#1a0e08" size="small" />
            ) : (
              <Text style={styles.privateStudioUploadEmoji}>📤</Text>
            )}
          </TouchableOpacity>
          <RNAnimated.View pointerEvents="none" style={[styles.privateStudioUploadGlow, { opacity: uploadGlowOpacity }]} />
        </RNAnimated.View>
      </View>
    </View>
  ), [
    brushEmoji,
    brushSize,
    handleBrushSpacingChange,
    handleBrushSpacingComplete,
    handleOpenEmojiPicker,
    handlePrivateStudioSizeChange,
    handlePrivateStudioUpload,
    isOpacityMostlyTransparent,
    opacityToggleEmoji,
    privateStudioUploadDisabled,
    privateStudioUploadInFlight,
    spacingSliderValue,
    toggleBrushOpacity,
    uploadGlowOpacity,
    uploadScale
  ]);

  const privateStudioToolbar = useMemo(() => (
    <View style={styles.privateStudioToolbarWrap}>
      <WorkspaceToolbar
        styles={styles}
        hitSlop={LARGE_HIT_SLOP}
        // Profile painter toolbar: keep it below the iPhone camera island.
        topInset={insets.top + 50}
        isBrushActive={isBrushActive}
        isLineActive={isLineActive}
        isEraserActive={isEraserActive}
        isEmojiPlaneActive={isEmojiPlaneActive}
        onBrush={activateBrushTool}
        onLine={activateLineTool}
        onEraser={activateEraserTool}
        onEmojiPlane={activateEmojiPlaneTool}
        onRandom={handleRandomEmoji}
        onUndo={undoStroke}
        onRedo={redoStroke}
        onClear={handleClearCanvas}
        undoDisabled={toolMode === 'emojiplane' ? planeUndoStack.length === 0 : strokes.length === 0}
        redoDisabled={toolMode === 'emojiplane' ? planeRedoStack.length === 0 : undoStack.length === 0}
        clearDisabled={strokes.length === 0}
        brushOptionsVisible={brushOptionsVisible}
        onFlipX={handleFlipX}
        onFlipY={handleFlipY}
        onRotateLeft={handleRotateLeft}
        onRotateRight={handleRotateRight}
        onRotateLeftLongPress={handleRotateLeftLongPress}
        onRotateRightLongPress={handleRotateRightLongPress}
        onRecentEmojiPress={handleRecentEmojiPress}
        recentEmojis={recentEmojis}
        mirrorX={mirrorX}
        mirrorY={mirrorY}
        autoRotateEnabled={autoRotateEnabled}
        autoRotateDirection={autoRotateDirection}
        brushEmoji={brushEmoji}
        handMode={settings.handMode}
        isLandscape={false}
        suppressRandomHelper={emojiPickerVisible}
        tutorialActive={tutorialActive}
        tutorialCurrentLesson={tutorialCurrentLesson}
        tutorialBlinkScale={tutorialBlinkScale}
        tutorialBlinkOpacity={tutorialBlinkOpacity}
      />
    </View>
  ), [
    activateBrushTool,
    activateEraserTool,
    activateEmojiPlaneTool,
    activateLineTool,
    autoRotateDirection,
    autoRotateEnabled,
    brushEmoji,
    brushOptionsVisible,
    handleClearCanvas,
    handleFlipX,
    handleFlipY,
    handleRandomEmoji,
    handleRecentEmojiPress,
    handleRotateLeft,
    handleRotateLeftLongPress,
    handleRotateRight,
    handleRotateRightLongPress,
    insets.top,
    isBrushActive,
    isEraserActive,
    isEmojiPlaneActive,
    isLineActive,
    mirrorX,
    mirrorY,
    recentEmojis,
    redoStroke,
    strokes.length,
    settings.handMode,
    tutorialActive,
    tutorialBlinkOpacity,
    tutorialBlinkScale,
    tutorialCurrentLesson,
    undoStroke,
    undoStack.length,
    emojiPickerVisible
  ]);
  const infoPulseScale = infoPulseValue.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const infoPulseOpacity = infoPulseValue.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.8, 1] });


  const rawLiveStroke = liveStrokeRef.current;

  const liveStroke = useMemo(() => {
    if (!rawLiveStroke) {
      return null;
    }
    if (frameMode && isPlayingFrames) {
      const previewCopy = liveFrameStrokeCopiesRef.current.get(currentFrameIndex);
      if (previewCopy && previewCopy.points.length > 0) {
        return {
          ...previewCopy,
          points: previewCopy.points.map(point => ({ ...point }))
        };
      }
    }
    return rawLiveStroke;
  }, [currentFrameIndex, frameMode, isPlayingFrames, liveVersion, rawLiveStroke]);

  const isBrushActive = toolMode === 'brush';
  const isLineActive = toolMode === 'line';
  const isEraserActive = toolMode === 'eraser';
  const isEmojiPlaneActive = toolMode === 'emojiplane';
  const displayedEmojiPlanes = emojiPlaneGesturePreview ?? emojiPlanes;
  const selectedPlane = useMemo(
    () => displayedEmojiPlanes.find(plane => plane.id === selectedPlaneId) ?? null,
    [displayedEmojiPlanes, selectedPlaneId]
  );
  const emojiPlanePanelLayout: EmojiPlanePanelLayout = IS_IPAD
    ? (isIpadLandscape ? 'tabletLandscape' : 'tabletPortrait')
    : 'phone';
  /**
   * Layers panel sits near the TOP, under the toolbar it is opened from, rather than reusing the
   * plane panel's bottom anchor: the panel can grow to three rows plus a long-press menu, and from
   * the bottom that expansion runs into the brush/size controls. Anchoring the top edge means it
   * grows downward into empty canvas instead.
   */
  const layersPanelPosition = useMemo(() => (
    emojiPlanePanelLayout === 'tabletLandscape'
      ? { right: 20, top: insets.top + 90 }
      : {
          left: 0,
          right: 0,
          alignItems: 'center' as const,
          top: insets.top + (emojiPlanePanelLayout === 'tabletPortrait' ? 120 : 96)
        }
  ), [emojiPlanePanelLayout, insets.top]);

  const fallbackEmojiPlanePanelPosition = useMemo(() => (
    emojiPlanePanelLayout === 'tabletLandscape'
      ? { right: 20, top: Math.max(insets.top + 90, windowSize.height * 0.22) }
      : {
          left: 0,
          right: 0,
          alignItems: 'center' as const,
          bottom: insets.bottom + (emojiPlanePanelLayout === 'tabletPortrait' ? 230 : 150)
    }
  ), [emojiPlanePanelLayout, insets.bottom, insets.top, windowSize.height]);

  const [emojiPlanePanelSize, setEmojiPlanePanelSize] = useState({
    width: EMOJI_PLANE_PANEL_WIDTH[emojiPlanePanelLayout],
    height: 174,
  });
  const [emojiPlanePanelAnchor, setEmojiPlanePanelAnchor] = useState<{ left: number; top: number } | null>(null);
  const emojiPlanePanelPosition = emojiPlanePanelAnchor ?? fallbackEmojiPlanePanelPosition;

  // The 📐 options panel used to sit at a fixed dock and could land on top of the very lattice
  // dots it controls. Drag offset is user-placed and kept for the rest of the session (starting
  // over at the default dock every time the panel closes would defeat the point of moving it).
  const emojiPlanePanelDragX = useSharedValue(0);
  const emojiPlanePanelDragY = useSharedValue(0);
  const emojiPlanePanelDragStartX = useSharedValue(0);
  const emojiPlanePanelDragStartY = useSharedValue(0);
  const emojiPlanePanelDragLimitX = windowSize.width * 0.42;
  const emojiPlanePanelDragLimitY = windowSize.height * 0.42;
  const emojiPlanePanelDragGesture = useMemo(
    () => Gesture.Pan()
      .onBegin(() => {
        emojiPlanePanelDragStartX.value = emojiPlanePanelDragX.value;
        emojiPlanePanelDragStartY.value = emojiPlanePanelDragY.value;
      })
      .onUpdate((event) => {
        const nextX = emojiPlanePanelDragStartX.value + event.translationX;
        const nextY = emojiPlanePanelDragStartY.value + event.translationY;
        emojiPlanePanelDragX.value = Math.max(-emojiPlanePanelDragLimitX, Math.min(emojiPlanePanelDragLimitX, nextX));
        emojiPlanePanelDragY.value = Math.max(-emojiPlanePanelDragLimitY, Math.min(emojiPlanePanelDragLimitY, nextY));
      }),
    [
      emojiPlanePanelDragX, emojiPlanePanelDragY, emojiPlanePanelDragStartX, emojiPlanePanelDragStartY,
      emojiPlanePanelDragLimitX, emojiPlanePanelDragLimitY
    ]
  );
  const emojiPlanePanelDragAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: emojiPlanePanelDragX.value },
      { translateY: emojiPlanePanelDragY.value }
    ]
  }));

  // Pick the best side only when the panel opens/selects a plane (and after its real size is known).
  // It intentionally does not depend on the live plane object: rotation/scale/corner drags must not
  // make the controls jump between sides under the user's finger.
  useEffect(() => {
    if (!isEmojiPlaneActive || !selectedPlaneId || !viewShotLayout) {
      setEmojiPlanePanelAnchor(null);
      return;
    }
    const plane = emojiPlanesRef.current.find(item => item.id === selectedPlaneId);
    if (!plane) return;

    const points = plane.lattice && plane.lattice.length > 0
      ? plane.lattice
      : Object.values(plane.corners);
    const canvasWidth = canvasSize;
    const canvasHeight = canvasSize * CANVAS_RATIO;
    // viewShotLayout and this panel are siblings in the same parent, so these coordinates avoid
    // status-bar/window-origin ambiguity that measureInWindow would introduce.
    const canvasLeft = viewShotLayout.x + Math.max(0, (viewShotLayout.width - canvasWidth) / 2);
    const canvasTop = viewShotLayout.y + (IS_IPAD
      ? 24
      : Math.max(0, (viewShotLayout.height - canvasHeight) / 2));
    const transform = mainCanvasTransformRef.current;
    const zoom = Math.max(0.0001, transform.scale);
    const centreX = canvasWidth / 2;
    const centreY = canvasHeight / 2;
    const screenPoints = points.map(point => ({
      x: canvasLeft + centreX + (point.x - centreX) * zoom + transform.translateX,
      y: canvasTop + centreY + (point.y - centreY) * zoom + transform.translateY,
    }));
    const xs = screenPoints.map(point => point.x);
    const ys = screenPoints.map(point => point.y);
    const handleMargin = 12;
    const obstacle = {
      x: Math.min(...xs) - handleMargin,
      y: Math.min(...ys) - handleMargin,
      width: Math.max(...xs) - Math.min(...xs) + handleMargin * 2,
      height: Math.max(...ys) - Math.min(...ys) + handleMargin * 2,
    };
    const safeTop = insets.top + 72;
    const safeBottom = windowSize.height - insets.bottom - (IS_IPAD ? 86 : 104);
    const anchor = placePanelAwayFromRect(
      { x: 0, y: safeTop, width: windowSize.width, height: Math.max(1, safeBottom - safeTop) },
      obstacle,
      emojiPlanePanelSize,
      12,
      8,
    );
    setEmojiPlanePanelAnchor(anchor);
    emojiPlanePanelDragX.value = 0;
    emojiPlanePanelDragY.value = 0;
  }, [
    canvasSize,
    emojiPlanePanelDragX,
    emojiPlanePanelDragY,
    emojiPlanePanelLayout,
    emojiPlanePanelSize,
    insets.bottom,
    insets.top,
    isEmojiPlaneActive,
    selectedPlaneId,
    viewShotLayout,
    windowSize.height,
    windowSize.width,
  ]);

  const challengeTimeLabel = useMemo(() => {
    const totalSeconds = Math.ceil(challengeRemainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.max(0, totalSeconds % 60);
    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }, [challengeRemainingMs]);
  const challengeExpired = Boolean(activeChallenge) && challengeRemainingMs <= 0;
  // challengeMinutesForDay → from useChallenge
  const coinBurstAnimatedStyle = useMemo(() => ({
    transform: [
      {
        scale: coinScale.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.25] })
      }
    ],
    opacity: coinScale.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] })
  }), [coinScale]);

  const penaltyCoinAnimatedStyle = useMemo(() => ({
    transform: [
      {
        scale: penaltyCoinScale.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.3] })
      },
      {
        translateY: penaltyCoinY
      }
    ],
    opacity: penaltyCoinScale.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] })
  }), [penaltyCoinScale, penaltyCoinY]);
  const retryHelperAnimatedStyle = useMemo(
    () => ({
      transform: [{ scale: retryHelperScale }],
      opacity: retryHelperScale.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] })
    }),
    [retryHelperScale]
  );
  const totalTimeLabel = useMemo(() => formatElapsedLabel(totalTimeMs), [totalTimeMs]);
  const totalStrokeLabel = useMemo(() => totalStrokes.toLocaleString(), [totalStrokes]);
  // leaderboardSheetInsets, previewRank, previewStrokeLabel, previewTimeLabel moved to useLeaderboard hook

  // These hooks must be before any conditional return (Rules of Hooks)
  const visibleStrokes = useMemo(() => {
    if (!frameMode) {
      return strokes;
    }
    return strokes.filter((stroke) => {
      if (stroke.startFrame === undefined || stroke.frameDuration === undefined) {
        return true;
      }
      const endFrame = stroke.startFrame + stroke.frameDuration;
      return currentFrameIndex >= stroke.startFrame && currentFrameIndex < endFrame;
    });
  }, [frameMode, strokes, currentFrameIndex]);

  const forceSkiaForCustomBrush = useMemo(
    () => isCustomBrushReference(brushEmoji) || isCustomPng(brushEmoji),
    [brushEmoji]
  );

  if (animatorMode) {
    return (
      <AnimatorWorkspace
        frameBuffer={animatorFrameBufferRef.current}
        renderer={animatorRendererRef.current}
        isLooping={animatorLoop}
        fps={animatorFps}
        strokeLength={animatorStrokeLength}
        totalFrames={animatorTotalFrames}
        playhead={animatorPlayhead}
        brush={{
          emoji: brushEmoji,
          size: brushSize,
          opacity: brushOpacity,
          spacing: brushSpacing,
          rotation: brushRotation,
          mirrorX,
          mirrorY,
          dynamicEmoji: false
        }}
        onToggleLoop={handleAnimatorToggleLoop}
        onChangeFps={handleAnimatorFpsChange}
        onChangeStrokeLength={handleAnimatorStrokeLenChange}
        onChangeTotalFrames={handleAnimatorTotalFramesChange}
        onChangePlayhead={handleAnimatorPlayheadChange}
        onClose={handleAnimatorClose}
        onTogglePlayback={handleAnimatorTogglePlayback}
        onSetPlaybackState={setAnimatorIsPlaying}
        isPlaying={animatorIsPlaying}
      />
    );
  }

  const paintLengthMax = Math.max(1, frames.length || 1);
  const clampedPaintLength = Math.min(framePaintLength, paintLengthMax);

  return (
    <>
      <View style={styles.container}>
        {/* Subtle random color tint over the out-of-canvas area — chosen fresh each app open */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: CANVAS_TINT_COLOR }]} />
        <View pointerEvents="none" style={styles.hiddenCaptureContainer}>
          <ViewShot
            ref={challengeCanvasRef}
            options={{ format: 'png', quality: 1, result: 'tmpfile' }}
            style={[styles.hiddenCaptureCanvas, { backgroundColor: '#000000' }]}
          >
            <View style={[styles.hiddenCaptureInner, { backgroundColor: '#000000', position: 'relative' }]}>
              {/* Background image rendered BEHIND strokes when in background mode */}
              {trace.isBackground && trace.imageUri ? (
                <Image
                  source={{ uri: trace.imageUri }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: canvasSize,
                    height: canvasSize * CANVAS_RATIO
                  }}
                  resizeMode="cover"
                />
              ) : null}
          <PaintCanvas
            width={canvasSize}
            height={canvasSize * CANVAS_RATIO}
            strokes={strokes}
            liveVersion={liveVersion}
            backgroundColor={trace.isBackground && trace.imageUri ? 'transparent' : '#000000'}
          />
            </View>
          </ViewShot>
          <ViewShot
            ref={brushCaptureRef}
            options={{ format: 'png', quality: 1, result: 'tmpfile', backgroundColor: 'transparent' }}
            style={[styles.hiddenCaptureCanvas, { backgroundColor: 'transparent' }]}
          >
            <View style={[styles.hiddenCaptureInner, { backgroundColor: 'transparent' }]}>
              <TransparentEmojiCanvas
                width={canvasSize}
                height={canvasSize * CANVAS_RATIO}
                strokes={visibleStrokes}
                liveVersion={liveVersion}
              />
            </View>
          </ViewShot>
        </View>
        <ViewShot ref={viewShotRef} style={styles.viewShot} options={{ format: 'png', quality: 1 }} onLayout={handleViewShotLayout}>
          <View
            style={styles.canvasStage}
          >
            {/* Frame background - show subtle grid in frame mode */}
            {frameMode && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: canvasSize,
                  height: canvasSize * CANVAS_RATIO,
                  backgroundColor: '#0a0a0a',
                  opacity: 0.3
                }}
              />
            )}

            <PaintingWorkspace
              canvasBackgroundColor={faceFilterModeActive ? (faceFilterCapturing ? 'transparent' : '#d9d9d9') : undefined}
              styles={styles}
              hitSlop={LARGE_HIT_SLOP}
              canvasSize={canvasSize}
              canvasRatio={CANVAS_RATIO}
              forceSkia={forceSkiaForCustomBrush}
              strokeState={{
                strokes: strokesClearProgress > 0
                  ? visibleStrokes.slice(0, Math.max(0, visibleStrokes.length - Math.floor(visibleStrokes.length * strokesClearProgress)))
                  : visibleStrokes,
                liveStroke: (frameMode && isPlayingFrames) ? null : liveStroke, // Hide preview during play - stamps appear instantly on frames
                liveVersion
              }}
              gestures={{
                canvasGesture,
                canvasAnimatedStyle,
                panHandlers: canvasPanResponder.panHandlers,
                traceGesture: gesture,
                traceAnimatedStyle,
                onZoomUpdate: handleCanvasZoomUpdate
              }}
              traceState={{
                trace,
                showTraceControls,
                traceLoading,
                traceLoadingMessage,
                isTraceAdjusting,
                handleTraceScaleChange,
                handleTraceConfirm,
                handleTraceRemove: removeTrace,
                handleTraceOpacityChange,
                handleTraceToggleBackground,
                minTraceScale: MIN_TRACE_SCALE,
                maxTraceScale: MAX_TRACE_SCALE
              }}
              toolbarState={{
                isBrushActive,
                isLineActive,
                // Layers button — MAIN WORKSPACE ONLY. It is passed here, on the
                // PaintingWorkspace toolbar, not on the Private Studio toolbar further up
                // this file (that one belongs to the passport painter).
                onLayers: () => { setLayerMenuLayer(null); setLayersPanelVisible(v => !v); },
                layersActive: layersPanelVisible,
                isEraserActive,
                isEmojiPlaneActive,
                activateBrushTool,
                activateLineTool,
                activateEraserTool,
                activateEmojiPlaneTool,
                handleRandomEmoji,
                undoStroke,
                redoStroke,
                handleClearCanvas,
                handleFaceFilter: faceFilterModeActive ? () => { void openFaceFilterOverlay(); } : undefined,
                undoDisabled: toolMode === 'emojiplane' ? planeUndoStack.length === 0 : strokes.length === 0,
                redoDisabled: toolMode === 'emojiplane' ? planeRedoStack.length === 0 : undoStack.length === 0,
                clearDisabled: strokes.length === 0,
                brushOptionsVisible,
                handleFlipX,
                handleFlipY,
                handleRotateLeft,
                handleRotateRight,
                handleRotateLeftLongPress,
                handleRotateRightLongPress,
                handleRecentEmojiPress,
                recentEmojis,
                mirrorX,
                mirrorY,
                autoRotateEnabled,
                autoRotateDirection,
                brushEmoji,
                topInset: insets.top,
                tutorialActive,
                tutorialCurrentLesson,
                tutorialBlinkScale,
                tutorialBlinkOpacity
              }}
              frameMode={frameMode}
              brushControlsState={{
                brushSize: displayBrushSize,
                sizeInput,
                setSizeInput,
                dispatchSetBrushSize: handleDisplayBrushSizeChange,
                setSizeInputFocused,
                toggleBrushOpacity,
                isOpacityMostlyTransparent,
                opacityToggleEmoji,
                smudgeActive: brushMode === 'smudge',
                smudgeSmoothness,
                onSmudgeSmoothnessChange: handleSmudgeSmoothnessChange,
                onBrushPreview: handleDisplayBrushPreview,
                onBrushPreviewComplete: handleDisplayBrushPreviewComplete,
                sizeSliderMaximum: displayBrushSizeMax,
                spacingSlider: IS_IPAD
                  ? {
                      value: spacingSliderValue,
                      onChange: handleBrushSpacingChange,
                      onComplete: handleBrushSpacingComplete
                    }
                  : undefined,
                tutorialActive,
                tutorialCurrentLesson,
                tutorialBlinkScale,
                tutorialBlinkOpacity
              }}
              quickActionsState={{
                actionButtons: mainQuickActions,
                infoPulseScale,
                infoPulseOpacity,
                emojiBounceScale,
                onInfoButtonLayout: handleInfoButtonLayout
              }}
        emojiPickerState={{
          emojiPickerVisible,
          setEmojiPickerVisible,
          emojiSearch,
          setEmojiSearch,
          recentEmojis,
          brushEmoji,
          emojiResults,
          handleEmojiSelect,
          onLoadCustomBrushToWorkspace: handleLoadCustomBrushToWorkspace,
          emojiListRef,
          handleScrollToIndexFailed,
          scrollOffset: emojiScrollOffsetRef.current,
          onScrollOffsetChange: handleEmojiPickerScroll,
          centerOnEmoji: centerEmojiInPicker,
          numColumns: PICKER_COLUMN_COUNT,
          mirrorX,
          mirrorY,
          rotation: brushRotation,
          onToggleMirrorX: toggleMirrorX,
          onToggleMirrorY: toggleMirrorY,
          getItemLayout: getEmojiItemLayout,
          spacingSlider: emojiPickerSpacingSlider,
          onTurnLeft: turnBrushLeft,
          onTurnRight: turnBrushRight,
          onTurnRightLongPress: turnBrushRightLongPress,
          autoRotateEnabled: autoRotateEnabled,
          onEmojiPickerOpen: cycleBrushEmoji
        }}
        previewStroke={brushPreviewStroke}
        diceScale={diceScale}
        watermarkLetter={wording.isWordingActive() ? wording.getCurrentLetter() : null}
        handMode={settings.handMode}
        isLandscape={isLandscape}
        polygonPoints={polygonPoints}
        emojiPlanes={displayedEmojiPlanes}
        selectedPlaneId={selectedPlaneId}
        draggingCorner={draggingCorner}
        onPlaneCornerDragStart={handlePlaneCornerDragStart}
        onPlaneCornerDrag={handlePlaneCornerDrag}
        onPlaneCornerDragEnd={handlePlaneCornerDragEnd}
      />

            {/* Onion skin layers - render ON TOP of current frame (memoized to prevent re-renders) */}
            {onionSkinLayers}

            {retryHelperVisible ? (
              <View style={styles.retryHelperContainer} pointerEvents="none">
                <RNAnimated.View style={[styles.retryHelperBubble, retryHelperAnimatedStyle]}>
                  <Text style={styles.retryHelperText}>Visit the Info Space to redo the sprint!</Text>
                </RNAnimated.View>
              </View>
            ) : null}
          </View>
        </ViewShot>

        {/* Emoji Plane Corner Indicators - Visual markers for corners (pointer events disabled, PanResponder handles touches) */}
        {toolMode === 'emojiPlacement' && emojiPlanes.some(p => p.id === selectedPlaneId) && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
            {emojiPlanes
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

        {/* Emoji plane controls — only while the plane tool owns the canvas and a plane is selected */}
        {isEmojiPlaneActive && selectedPlane ? (
          <Animated.View
            style={[styles.emojiPlanePanelWrap, emojiPlanePanelPosition, emojiPlanePanelDragAnimatedStyle]}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              if (
                Math.abs(width - emojiPlanePanelSize.width) > 0.5 ||
                Math.abs(height - emojiPlanePanelSize.height) > 0.5
              ) {
                setEmojiPlanePanelSize({ width, height });
              }
            }}
          >
            <GestureDetector gesture={emojiPlanePanelDragGesture}>
              <View style={styles.emojiPlanePanelDragHandle}>
                <Text style={styles.emojiPlanePanelDragHandleText}>⠿ move</Text>
              </View>
            </GestureDetector>
            <EmojiPlanePanel
              emoji={selectedPlane.emoji}
              opacity={selectedPlane.opacity}
              rotation={selectedPlane.rotation ?? 0}
              scale={selectedPlane.scale ?? 1}
              visible={selectedPlane.visible !== false}
              layout={emojiPlanePanelLayout}
              canReset={(selectedPlane.cornerHistory?.length ?? 0) > 0}
              latticeLevel={(selectedPlane.latticeLevel ?? 1) as LatticeLevel}
              onLatticeLevelChange={(level) => setPlaneLatticeLevel(selectedPlane.id, level)}
              onOpacityChange={value => updatePlaneOpacity(selectedPlane.id, value)}
              onRotationChange={value => updatePlaneRotation(selectedPlane.id, value)}
              onScaleChange={value => updatePlaneScale(selectedPlane.id, value)}
              onToggleVisibility={() => {
                void Haptics.selectionAsync();
                togglePlaneVisibility(selectedPlane.id);
              }}
              onReset={() => resetPlaneCorners(selectedPlane.id)}
              onCancel={() => deletePlane(selectedPlane.id)}
              onCommit={() => commitPlaneAsStroke(selectedPlane.id)}
            />
          </Animated.View>
        ) : null}

        {layersPanelVisible ? (
          <View style={[styles.emojiPlanePanelWrap, layersPanelPosition]}>
            <LayersPanel
              activeLayer={activeLayer}
              visibility={layerVisibility}
              counts={layerArtworkStrokeCounts}
              previews={layerPreviewGlyphs}
              thumbnails={layerThumbnails}
              layout={emojiPlanePanelLayout}
              menuLayer={layerMenuLayer}
              hasClipboard={layerClipboard.length > 0}
              onSelect={(layer) => { void Haptics.selectionAsync(); setActiveLayer(layer); }}
              onToggleVisibility={(layer) => { void Haptics.selectionAsync(); toggleLayerVisibility(layer); }}
              onOpenMenu={(layer) => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setLayerMenuLayer(layer); }}
              onCloseMenu={() => setLayerMenuLayer(null)}
              onAction={handleLayerAction}
              onClose={() => { setLayerMenuLayer(null); setLayersPanelVisible(false); }}
            />
          </View>
        ) : null}

        <FrameAnimatorOverlay
          frameMode={frameMode}
          frames={frames}
          setFrames={setFrames}
          currentFrameIndex={currentFrameIndex}
          setCurrentFrameIndex={setCurrentFrameIndex}
          isPlayingFrames={isPlayingFrames}
          frameTimelineVisible={frameTimelineVisible}
          frameTimelineScrollRef={frameTimelineScrollRef}
          selectedFrameForMove={selectedFrameForMove}
          setSelectedFrameForMove={setSelectedFrameForMove}
          deleteConfirmActive={deleteConfirmActive}
          deleteAllConfirmActive={deleteAllConfirmActive}
          showDeleteAllPrompt={showDeleteAllPrompt}
          regeneratingThumbnails={regeneratingThumbnails}
          thumbnailsRegenerated={thumbnailsRegenerated}
          totalThumbnailsToRegenerate={totalThumbnailsToRegenerate}
          exportFps={exportFps}
          setExportFps={setExportFps}
          activeFrameLength={activeFrameLength}
          setActiveFrameLength={setActiveFrameLength}
          framePaintLength={framePaintLength}
          setFramePaintLength={setFramePaintLength}
          onionSkinning={onionSkinning}
          setOnionSkinning={setOnionSkinning}
          cloneCount={cloneCount}
          setCloneCount={setCloneCount}
          exportFormat={exportFormat}
          setExportFormat={setExportFormat}
          exportTransparent={exportTransparent}
          setExportTransparent={setExportTransparent}
          exportLoopMode={exportLoopMode}
          setExportLoopMode={setExportLoopMode}
          exportPreviewPlaying={exportPreviewPlaying}
          setExportPreviewPlaying={setExportPreviewPlaying}
          exportPreviewFrameIndex={exportPreviewFrameIndex}
          setExportPreviewFrameIndex={setExportPreviewFrameIndex}
          addFrameModalVisible={addFrameModalVisible}
          setAddFrameModalVisible={setAddFrameModalVisible}
          frameSettingsVisible={frameSettingsVisible}
          setFrameSettingsVisible={setFrameSettingsVisible}
          animationExportVisible={animationExportVisible}
          setAnimationExportVisible={setAnimationExportVisible}
          toggleFrameMode={toggleFrameMode}
          toggleFramePlayback={toggleFramePlayback}
          saveCurrentFrame={saveCurrentFrame}
          regenerateAllThumbnails={regenerateAllThumbnails}
          deleteCurrentFrame={deleteCurrentFrame}
          deleteAllFrames={deleteAllFrames}
          addNewFrame={addNewFrame}
          switchToFrame={switchToFrame}
          moveFrame={moveFrame}
          handleOpenEmojiPicker={handleOpenEmojiPicker}
          handleAnimationExport={handleAnimationExport}
          handleSaveAnimation={handleSaveAnimation}
          brushEmoji={brushEmoji}
          isLandscape={isLandscape}
          insets={insets}
          screenWidth={screenWidth}
          screenHeight={screenHeight}
          canvasSize={canvasSize}
          activeChallenge={activeChallenge}
          viewShotLayout={viewShotLayout}
          challengeTimerGesture={challengeTimerGesture}
          challengeTimerStyle={challengeTimerStyle}
          challengeTimerCloseGesture={challengeTimerCloseGesture}
          challengeStrokeCount={challengeStrokeCount}
          showChallengeCancelConfirmation={showChallengeCancelConfirmation}
          challengeExpired={challengeExpired}
          challengeTimeLabel={challengeTimeLabel}
          mysteryTopicSelected={mysteryTopicSelected}
          mysteryTopic={mysteryTopic as any}
          infoLanguage={infoLanguage}
          wording={wording}
          promptOverlayVisible={promptOverlayVisible}
          promptOverlayDismissed={promptOverlayDismissed}
          promptCards={promptCards}
          promptOverlayMetrics={promptOverlayMetrics}
          getPromptCardKey={getPromptCardKey}
          getPromptAnim={getPromptAnim}
          promptExitVectorRef={promptExitVectorRef}
          isIpadLandscape={isIpadLandscape}
          isWidePortraitTablet={isWidePortraitTablet}
          handlePromptCardPress={handlePromptCardPress}
          uploadedPromptTopics={uploadedPromptTopics}
          challengeMinutesForDay={challengeMinutesForDay}
        />
      </View>


      <InfoPanelOverlay
        {...infoPanel}
        challengeCompleteVisible={challengeCompleteVisible}
        challengeConfirmPrompt={challengeConfirmPrompt}
        confirmCopy={confirmCopy}
        challengeConfirmEmoji={challengeConfirmEmoji}
        challengeConfirmEmojiAnimatedStyle={challengeConfirmEmojiAnimatedStyle}
        challengeConfirmLoading={challengeConfirmLoading}
        challengeConfirmEntries={challengeConfirmEntries}
        challengeConfirmAnimValuesRef={challengeConfirmAnimValuesRef}
        challengeConfirmError={challengeConfirmError}
        challengeConfirmProcessing={challengeConfirmProcessing}
        showNotificationPrompt={showNotificationPrompt}
        challengeMinutesForDay={challengeMinutesForDay}
        handleChallengeSelect={handleChallengeSelect}
        cancelChallengeConfirm={cancelChallengeConfirm}
        confirmStartChallenge={confirmStartChallenge}
        openChallengeConfirmPreview={openChallengeConfirmPreview}
        handleSkipNotifications={handleSkipNotifications}
        handleEnableNotifications={handleEnableNotifications}
        activeChallenge={activeChallenge}
        uploadedPromptTopics={uploadedPromptTopics}
        dailyPrompts={dailyPrompts}
        mysteryTopicLoading={mysteryTopicLoading}
        showMysteryTopicInInfo={showMysteryTopicInInfo}
        mysteryTopic={mysteryTopic}
        diceButtonCooldown={diceButtonCooldown}
        diceButtonCountdown={diceButtonCountdown}
        handleMysteryTopicSelect={handleMysteryTopicSelect}
        handleReloadMysteryTopic={handleReloadMysteryTopic}
        handleStartMysteryPainting={handleStartMysteryPainting}
        getTopicMetadata={getTopicMetadata}
        openGallery={openGallery}
        openLeaderboard={openLeaderboard}
        openPrivateStudio={openPrivateStudio}
        openAR={openARFromOverlay}
        openArPainting={openArPaintingFromInfo}
        openVector={openVectorFromInfo}
        openMultiPaint={IS_LITE_BUILD ? undefined : openMultiPaintFromOverlay}
        openTopicSuggestions={openTopicSuggestionsFromInfo}
        setFramerWorkspaceVisible={setFramerWorkspaceVisible}
        navigation={navigation}
        handleOpenGuessOverlay={handleOpenGuessFromInfo}
        totalTimeLabel={totalTimeLabel}
        totalStrokeLabel={totalStrokeLabel}
        handleRateApp={handleRateApp}
        settingsGearAnimatedStyle={settingsGearAnimatedStyle}
        insets={insets}
        settings={settings}
        setTheme={setTheme}
        setHandMode={setHandMode}
        setHelperModeEnabled={setHelperModeEnabled}
        setTutorialModeEnabled={setTutorialModeEnabled}
        setBrushPerformanceMode={setBrushPerformanceMode}
        parentalControls={parentalControls}
        setParentalControls={setParentalControls}
        saveParentalControls={saveParentalControls}
        promptForPin={promptForPin}
        refreshGallery={refreshGallery}
        galleryMode={galleryMode}
        notificationsEnabled={notificationsEnabled}
        setNotificationsEnabled={setNotificationsEnabled}
        notificationService={termsGatedNotificationService}
        setParentalControlsVisible={setParentalControlsVisible}
        emojiStyleOpen={emojiStyleOpen}
        setEmojiStyleOpen={setEmojiStyleOpen}
        emojiSets={emojiSets}
        activeSetId={activeSetId}
        setEmojiSet={setEmojiSet}
        deleteEmojiSet={deleteEmojiSet}
        importEmojiSet={importEmojiSet}
        activeEmojiSetName={activeEmojiSetName}
        emojiImporting={emojiImporting}
        setEmojiImporting={setEmojiImporting}
        styles={styles}
      />

      {/* Coin Workshop — excluded from Lite builds */}
      {!IS_LITE_BUILD && (
        <CoinShopOverlay
          visible={coinShopVisible}
          onClose={handleCoinShopClose}
          coinCount={coinCount}
          userName={privateStudioName.trim() || undefined}
          onAddCoins={handleCoinShopAdd}
          onSpendCoins={handleCoinShopSpend}
          passportPortrait={passportPortrait ?? currentPassportImage ?? null}
          onUseAsProfileImage={async (uri: string) => {
            try {
              const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
              const dataUrl = `data:image/jpeg;base64,${b64}`;
              setPassportPortrait(dataUrl);
              setCurrentPassportImage(dataUrl);
              AsyncStorage.setItem(PASSPORT_PORTRAIT_STORAGE_KEY, dataUrl).catch(() => undefined);
              dispatch({
                type: 'SET_TRACE',
                trace: { imageUri: uri, scale: 1, offsetX: 0, offsetY: 0, rotation: 0, opacity: 1, isBackground: true }
              });
              setShowTraceControls(false);
              CustomOverlayHelper.alert('Profile updated', '👤 Profile image set! Open Profile Studio to paint on top of it.');
            } catch (e: any) {
              CustomOverlayHelper.alert('Error', e?.message ?? 'Could not set profile image');
            }
          }}
        />
      )}

      {/* Gesser Feature Overlays */}
      {isGesserEnabled() && (
        <>
          <SuggestTopicOverlay
            visible={gesserTopicVisible}
            onClose={() => {
              setGesserTopicVisible(false);
              setInfoVisible(true); // Return to info panel when closing
            }}
            deviceId={deviceId}
            language={infoLanguage}
            onSuccess={(coins) => {
              console.log('[Gesser] Earned', coins, 'coins');
            }}
          />
          <GuessGameScreen
            visible={gesserGuessVisible}
            onClose={() => setGesserGuessVisible(false)}
            deviceId={deviceId}
            language={infoLanguage}
            onCoinsEarned={(coins) => {
              console.log('[Gesser] Guess correct! Earned', coins, 'coins');
            }}
          />

          {/* Penalty Coin Animation Overlay - Shows -1 coin when mystery topic abandoned */}
          <RNAnimated.View
            style={[
              {
                position: 'absolute',
                top: '20%',
                left: 0,
                right: 0,
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000
              },
              penaltyCoinAnimatedStyle
            ]}
            pointerEvents="none"
          >
            <View
              style={{
                backgroundColor: 'rgba(255, 0, 0, 0.9)',
                paddingVertical: 16,
                paddingHorizontal: 32,
                borderRadius: 20,
                borderWidth: 3,
                borderColor: '#ff4444',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.5,
                shadowRadius: 8
              }}
            >
              <Text
                style={{
                  color: '#fff',
                  fontSize: 48,
                  fontWeight: 'bold',
                  fontFamily: 'vrtlfinal',
                  textAlign: 'center',
                  textShadowColor: 'rgba(0, 0, 0, 0.75)',
                  textShadowOffset: { width: 0, height: 2 },
                  textShadowRadius: 4
                }}
              >
                -1 🪙
              </Text>
              <Text
                style={{
                  color: '#fff',
                  fontSize: 16,
                  fontFamily: 'vrtlfinal',
                  textAlign: 'center',
                  marginTop: 4
                }}
              >
                Mystery Abandoned
              </Text>
            </View>
          </RNAnimated.View>

          <UserDiscoveryScreen
            visible={gesserDiscoveryVisible}
            onClose={() => setGesserDiscoveryVisible(false)}
            deviceId={deviceId}
            language={infoLanguage}
          />
          <FriendsListScreen
            visible={gesserFriendsVisible}
            onClose={() => setGesserFriendsVisible(false)}
            deviceId={deviceId}
            language={infoLanguage}
          />

          <GesserOverlay
            mysteryTopicWarningVisible={mysteryTopicWarningVisible}
            mysteryModalPanel={mysteryModalPanel}
            mysteryTotalTopicCount={mysteryTotalTopicCount}
            mysteryTopicChoices={mysteryTopicChoices}
            mysteryTopicLoading={mysteryTopicLoading}
            mysteryTopicHistory={mysteryTopicHistory}
            pendingMysteryTopicChoices={pendingMysteryTopicChoices}
            infoCopy={infoCopy}
            confirmMysteryTopicWarning={confirmMysteryTopicWarning}
            cancelMysteryTopicWarning={cancelMysteryTopicWarning}
            handleMysteryTopicPicked={handleMysteryTopicPicked}
            handleShuffleMysteryTopics={handleShuffleMysteryTopics}
            cancelMysteryPicker={cancelMysteryPicker}
            setMysteryTopicChoices={setMysteryTopicChoices}
            setPendingMysteryTopicChoices={setPendingMysteryTopicChoices}
            setMysteryTopicHistory={setMysteryTopicHistory}
            mysteryConfirmVisible={mysteryConfirmVisible}
            setMysteryConfirmVisible={setMysteryConfirmVisible}
            mysteryBounceAnim={mysteryBounceAnim}
            mysteryTopic={mysteryTopic}
            infoLanguage={infoLanguage}
            getTopicMetadata={getTopicMetadata}
          />

        </>
      )}

      <PinLockModal
        visible={pinLockVisible}
        pinLockValue={pinLockValue}
        pinLockError={pinLockError}
        onChangeText={(t) => { setPinLockValue(t.replace(/[^0-9]/g, '').slice(0, 6)); setPinLockError(''); }}
        onConfirm={() => void handlePinLockConfirm()}
        onCancel={handlePinLockCancel}
      />

      <FullscreenImageViewer
        imageUri={fullscreenImageUri}
        imageInfo={fullscreenImageInfo}
        windowSize={windowSize}
        isIpad={IS_IPAD}
        isIpadLandscape={isIpadLandscape}
        insets={insets}
        onClose={() => { setFullscreenImageUri(null); setFullscreenImageInfo(null); }}
      />

      <GalleryOverlay
        galleryVisible={galleryVisible}
        challengeCompleteVisible={challengeCompleteVisible}
        closeGallery={closeGallery}
        insets={insets}
        galleryEntries={galleryEntries}
        galleryLoading={galleryLoading}
        galleryRefreshing={galleryRefreshing}
        galleryLoadingMore={galleryLoadingMore}
        galleryError={galleryError}
        galleryUpdatedAt={galleryUpdatedAt}
        galleryPage={galleryPage}
        galleryLayout={galleryLayout}
        galleryMode={galleryMode}
        galleryLanguage={galleryLanguage}
        galleryVotePending={galleryVotePending}
        galleryAnimatedFrames={galleryAnimatedFrames}
        galleryLanguagePickerVisible={galleryLanguagePickerVisible}
        galleryModePickerVisible={galleryModePickerVisible}
        galleryViewerModalOpacity={galleryViewerModalOpacity}
        galleryViewerModalScale={galleryViewerModalScale}
        galleryViewerScale={galleryViewerScale}
        galleryViewerBaseScale={galleryViewerBaseScale}
        galleryViewerAnimatedStyle={galleryViewerAnimatedStyle}
        galleryViewerGesture={galleryViewerGesture}
        guessOverlayVisible={guessOverlayVisible}
        selectedMysteryPainting={selectedMysteryPainting}
        guessInput={guessInput}
        guessLoading={guessLoading}
        guessFeedback={guessFeedback}
        guessedPaintings={guessedPaintings}
        guessAttempts={guessAttempts}
        guessWinVisible={guessWinVisible}
        guessWinStyleIdx={guessWinStyleIdx}
        guessAllDone={guessAllDone}
        guessWinParticles={guessWinParticles}
        isOfflineGalleryMode={isOfflineGalleryMode}
        offlineEntryCount={offlineEntryCount}
        offlineMysteryEntries={offlineMysteryEntries}
        showOfflineMysteryGallery={showOfflineMysteryGallery}
        mysteryButtonBlinkOpacity={mysteryButtonBlinkOpacity}
        mysteryButtonBlinkScale={mysteryButtonBlinkScale}
        galleryStatsText={galleryStatsText}
        mysteryTopic={challenge.mysteryTopic}
        leaderboardEntriesRef={leaderboard.leaderboardEntriesRef}
        openGallery={openGallery}
        openPrivateStudioFromGallery={openPrivateStudioFromGallery}
        openLeaderboardFromGallery={openLeaderboardFromGallery}
        openARFromGallery={openARFromOverlay}
        openGalleryViewer={openGalleryViewer}
        closeGalleryViewer={closeGalleryViewer}
        refreshGallery={refreshGallery}
        handleGalleryModeChange={handleGalleryModeChange}
        handleGalleryVote={handleGalleryVote}
        handleOpenGuessOverlay={handleOpenGuessOverlay}
        handleSubmitGuess={handleSubmitGuess}
        getGalleryTravelerName={getGalleryTravelerName}
        setGalleryLanguage={setGalleryLanguage}
        setGalleryLayout={setGalleryLayout}
        setGalleryPage={setGalleryPage}
        setGallerySelectedEntry={setGallerySelectedEntry}
        setGuessInput={setGuessInput}
        setGuessOverlayVisible={setGuessOverlayVisible}
        setSelectedMysteryPainting={setSelectedMysteryPainting}
        setGuessFeedback={setGuessFeedback}
        setGuessAllDone={setGuessAllDone}
        setShowOfflineMysteryGallery={setShowOfflineMysteryGallery}
        formatGalleryRunDate={formatGalleryRunDate}
        formatGalleryDuration={formatGalleryDuration}
        getTopicMetadata={getTopicMetadata}
        galleryLanguageOptions={galleryLanguageOptions}
        setGalleryLanguagePickerVisible={setGalleryLanguagePickerVisible}
        setGalleryModePickerVisible={setGalleryModePickerVisible}
        activeLanguageOption={activeLanguageOption}
        setGalleryLoadingMore={setGalleryLoadingMore}
        gallerySelectedEntry={gallerySelectedEntry}
        gallerySelectedPassport={gallerySelectedPassport}
        profileOverlayEntry={profileOverlayEntry}
        setProfileOverlayEntry={setProfileOverlayEntry}
        galleryModeRef={galleryModeRef}
        galleryPageCount={galleryPageCount}
        currentGalleryPage={currentGalleryPage}
        visibleGalleryEntries={visibleGalleryEntries}
        galleryExtraData={galleryExtraData}
        revealedGalleryEntries={revealedGalleryEntries}
        resetGalleryViewer={resetGalleryViewer}
        guessInputRef={guessInputRef}
        friendsDeviceIds={friendsDeviceIds}
        infoLanguage={infoLanguage}
        setParentalControlsVisible={setParentalControlsVisible}
        loadOfflineMysteryCache={loadOfflineMysteryCache}
        galleryPagination={galleryPagination}
        renderGalleryEntry={renderGalleryEntry}
        viewerEntry={viewerEntry}
        viewerMode={viewerMode}
        viewerImageUri={viewerImageUri}
        viewerTitle={viewerTitle}
        viewerSubtitleLine={viewerSubtitleLine}
        viewerSupplementLine={viewerSupplementLine}
        viewerTravelerLabel={viewerTravelerLabel}
        viewerRunDate={viewerRunDate}
        viewerUsedTime={viewerUsedTime}
      />

      {/* Gallery Loading Overlay — only show full-screen loader when skeleton is not displayed */}
      {galleryLoading && galleryVisible && galleryEntries.length > 0 && (
        <AnimatedLoader
          message="Loading gallery..."
          showProgressBar={false}
        />
      )}

      {/* Animation Export Overlay — FRESH, dedicated progress UI (not the shared
          AnimatedLoader, whose 300ms bar animation + logo playback made the fast
          MP4 export look stuck). Bar width is set directly from the frame count,
          fed by the 50ms progress sampler. */}
      {animationExportActive && (
        <AnimationExportOverlay
          format={exportFormat}
          current={animationExportProgress?.current ?? 0}
          total={animationExportProgress?.total ?? 0}
        />
      )}

      <Modal
        visible={Boolean(galleryPassportEntry) && !challengeCompleteVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGalleryPassportEntry(null)}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View
          style={[
            styles.galleryPassportOverlay,
            { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }
          ]}
        >
          <View style={styles.galleryPassportCard}>
            <TouchableOpacity
              onPress={() => setGalleryPassportEntry(null)}
              style={styles.galleryPassportCloseButton}
              accessibilityRole="button"
              accessibilityLabel="Close passport details"
            >
              <Text style={styles.galleryPassportCloseLabel}>❎</Text>
            </TouchableOpacity>
            <View style={styles.galleryPassportImageFrame}>
              {galleryPassportEntry?.passportPortrait ? (
                <Pressable
                  onPress={() => {
                    if (!galleryPassportEntry?.passportPortrait) {
                      return;
                    }
                    const now = Date.now();
                    if (now - passportImageLastTapRef.current < 320) {
                      setGallerySelectedPassport(galleryPassportEntry);
                    }
                    passportImageLastTapRef.current = now;
                  }}
                  onLongPress={() => {
                    if (galleryPassportEntry?.passportPortrait) {
                      setGallerySelectedPassport(galleryPassportEntry);
                    }
                  }}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Open passport portrait"
                >
                  <Image
                    source={{ uri: `${galleryPassportEntry.passportPortrait}?t=${Date.now()}` }}
                    style={styles.galleryPassportImage}
                    resizeMode="cover"
                  />
                </Pressable>
              ) : (
                <View style={styles.galleryCardPassportPlaceholder}>
                  <Text style={styles.galleryCardPassportPlaceholderIcon}>🪪</Text>
                </View>
              )}
            </View>
            <View style={styles.galleryPassportBody}>
              <Text style={styles.galleryPassportName}>
                {galleryPassportEntry?.passportName ?? passportTravelerName}
              </Text>
              {passportTranslatedTopic ? (
                <Text style={styles.galleryPassportTopic}>{passportTranslatedTopic}</Text>
              ) : null}
              {passportHasOriginalTopic && passportDetailOriginalTopic ? (
                <Text style={styles.galleryPassportTopicOriginal}>{passportDetailOriginalTopic}</Text>
              ) : null}
              <View style={styles.galleryPassportStatsColumn}>
                {passportUsedTime ? (
                  <Text style={styles.galleryPassportMeta}>Challenge time: {passportUsedTime}</Text>
                ) : null}
                {galleryPassportEntry?.rank ? (
                  <Text style={styles.galleryPassportMeta}>Leaderboard rank #{galleryPassportEntry.rank}</Text>
                ) : null}
                {typeof galleryPassportEntry?.coinCount === 'number' ? (
                  <Text style={styles.galleryPassportMeta}>
                    Coins {galleryPassportEntry.coinCount.toLocaleString()}
                  </Text>
                ) : null}
                {passportUploadedLabel ? (
                  <Text style={styles.galleryPassportMeta}>Uploaded {passportUploadedLabel}</Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <EmojiPlaneCommitDialog
        visible={commitDialogVisible}
        emojiPlanes={emojiPlanes}
        onCommitAll={() => {
          commitAllPlanes();
          if (pendingToolModeRef.current) {
            setToolMode(pendingToolModeRef.current);
            pendingToolModeRef.current = null;
          }
          setCommitDialogVisible(false);
        }}
        onLater={() => setCommitDialogVisible(false)}
        onDeleteAll={() => {
          emojiPlanes.filter(p => p.visible !== false).forEach(plane => {
            dispatch({ type: 'DELETE_EMOJI_PLANE', planeId: plane.id });
          });
          if (pendingToolModeRef.current) {
            setToolMode(pendingToolModeRef.current);
            pendingToolModeRef.current = null;
          }
          setCommitDialogVisible(false);
        }}
      />

      {/* ── Challenge Overlay (cancel dialog + complete modal + confirm preview) ── */}
      <ChallengeOverlay
        {...challenge}
        insets={insets}
        styles={styles}
        challengeMinimumStrokesMet={challengeMinimumStrokesMet}
        coinCount={coinCount}
        coinBurstAnimatedStyle={coinBurstAnimatedStyle}
        coinStarburst={coinStarburst}
        infoLanguage={infoLanguage}
        dismissChallengeComplete={dismissChallengeComplete}
        openChallengeUpload={openChallengeUpload}
        resumePaintingFromComplete={resumePaintingFromComplete}
        handleRetryChallenge={handleRetryChallenge}
        showChallengeCancelDialog={showChallengeCancelDialog}
        handleChallengeCancelStop={handleChallengeCancelStop}
        handleChallengeEarlyUpload={handleChallengeEarlyUpload}
        handleChallengeContinue={handleChallengeContinue}
      />

      <PrivateStudioOverlay
        privateStudioVisible={privateStudioVisible}
        challengeCompleteVisible={challengeCompleteVisible}
        profileWorkspaceVisible={profileWorkspaceVisible}
        privateStudioLoading={privateStudioLoading}
        privateStudioError={privateStudioError}
        privateStudioName={privateStudioName}
        privateStudioSaving={privateStudioSaving}
        privateStudioElapsedMs={privateStudioElapsedMs}
        privateStudioStrokeCount={privateStudioStrokeCount}
        privateStudioUploadInFlight={privateStudioUploadInFlight}
        privateStudioStatusMessage={privateStudioStatusMessage}
        privateStudioTipVisible={privateStudioTipVisible}
        privateStudioTipText={privateStudioTipText}
        privateStudioTipScale={privateStudioTipScale}
        privateStudioTipOpacity={privateStudioTipOpacity}
        privateStudioTipBurstProgress={privateStudioTipBurstProgress}
        privateStudioLeaderboardVisible={privateStudioLeaderboardVisible}
        privateStudioDiceScale={privateStudioDiceScale}
        privateStudioCanvasFlight={privateStudioCanvasFlight}
        privateStudioFlightVector={privateStudioFlightVector}
        privateStudioRandomLocked={privateStudioRandomLocked}
        saveButtonEmoji={saveButtonEmoji}
        isSavePressed={isSavePressed}
        exportTitleEmojiIndex={exportTitleEmojiIndex}
        showProjectsModal={showProjectsModal}
        insets={insets}
        leaderboardPrivateStudioOverlayVisible={leaderboard.privateStudioLeaderboardOverlayVisible}
        leaderboardPrivateStudioOverlayAnim={leaderboard.privateStudioLeaderboardOverlayAnim}
        closePrivateStudioLeaderboardOverlay={leaderboard.closePrivateStudioLeaderboardOverlay}
        leaderboardEntries={leaderboard.leaderboardEntries}
        closePrivateStudio={closePrivateStudio}
        closeProfileWorkspace={closeProfileWorkspace}
        setPrivateStudioName={setPrivateStudioName}
        openLeaderboardFromPrivateStudio={openLeaderboardFromPrivateStudio}
        openGalleryFromPrivateStudio={openGalleryFromPrivateStudio}
        handlePrivateStudioUpload={handlePrivateStudioUpload}
        handleRandomPrivateStudioName={handleRandomPrivateStudioName}
        handlePrivateStudioNameChange={handlePrivateStudioNameChange}
        clearPrivateStudioTypewriter={clearPrivateStudioTypewriter}
        setShowProjectsModal={setShowProjectsModal}
        setIsSavePressed={setIsSavePressed}
        openPrivateStudioFromLeaderboard={openPrivateStudioFromLeaderboard}
        leaderboard={leaderboard}
        ownLeaderboardEntryIdSet={ownLeaderboardEntryIdSet}
        refreshLeaderboard={refreshLeaderboard}
        strokes={strokes}
        undoStack={undoStack}
        wording={wording}
        coinCount={coinCount}
        currentCoinLevel={currentCoinLevel}
        nextCoinLevel={nextCoinLevel}
        nextLevelRemainingCoins={nextLevelRemainingCoins}
        passportSnapshotsFrames={passportSnapshotsFrames}
        passportSnapshotsAnimationActive={passportSnapshotsAnimationActive}
        passportSnapshotsCurrentFrame={passportSnapshotsCurrentFrame}
        passportSnapshotsOpacity={passportSnapshotsOpacity}
        privateStudioCanvasAnimatedStyle={privateStudioCanvasAnimatedStyle}
        canvasSize={canvasSize}
        liveStroke={liveStroke}
        liveVersion={liveVersion}
        canvasGesture={canvasGesture}
        canvasAnimatedStyle={canvasAnimatedStyle}
        canvasPanResponder={canvasPanResponder}
        gesture={gesture}
        traceAnimatedStyle={traceAnimatedStyle}
        handleCanvasZoomUpdate={handleCanvasZoomUpdate}
        styles={styles}
        trace={trace}
        showTraceControls={showTraceControls}
        traceLoading={traceLoading}
        traceLoadingMessage={traceLoadingMessage}
        isTraceAdjusting={isTraceAdjusting}
        handleTraceScaleChange={handleTraceScaleChange}
        handleTraceConfirm={handleTraceConfirm}
        removeTrace={removeTrace}
        handleTraceOpacityChange={handleTraceOpacityChange}
        handleTraceToggleBackground={handleTraceToggleBackground}
        isBrushActive={isBrushActive}
        isLineActive={isLineActive}
        isEraserActive={isEraserActive}
        activateBrushTool={activateBrushTool}
        activateLineTool={activateLineTool}
        activateEraserTool={activateEraserTool}
        handleRandomEmoji={handleRandomEmoji}
        handleFirstTimeTest={handleFirstTimeTest}
        undoStroke={undoStroke}
        redoStroke={redoStroke}
        handleClearCanvas={handleClearCanvas}
        displayBrushSize={displayBrushSize}
        sizeInput={sizeInput}
        setSizeInput={setSizeInput}
        handleDisplayBrushSizeChange={handleDisplayBrushSizeChange}
        setSizeInputFocused={setSizeInputFocused}
        toggleBrushOpacity={toggleBrushOpacity}
        isOpacityMostlyTransparent={isOpacityMostlyTransparent}
        opacityToggleEmoji={opacityToggleEmoji}
        brushMode={brushMode}
        smudgeSmoothness={smudgeSmoothness}
        handleSmudgeSmoothnessChange={handleSmudgeSmoothnessChange}
        handleDisplayBrushPreview={handleDisplayBrushPreview}
        handleDisplayBrushPreviewComplete={handleDisplayBrushPreviewComplete}
        displayBrushSizeMax={displayBrushSizeMax}
        privateStudioQuickActions={privateStudioQuickActions}
        infoPulseScale={infoPulseScale}
        infoPulseOpacity={infoPulseOpacity}
        emojiBounceScale={emojiBounceScale}
        handleInfoButtonLayout={handleInfoButtonLayout}
        emojiPickerVisible={emojiPickerVisible}
        setEmojiPickerVisible={setEmojiPickerVisible}
        emojiSearch={emojiSearch}
        setEmojiSearch={setEmojiSearch}
        recentEmojis={recentEmojis}
        brushEmoji={brushEmoji}
        emojiResults={emojiResults}
        handleEmojiSelect={handleEmojiSelect}
        handleLoadCustomBrushToWorkspace={handleLoadCustomBrushToWorkspace}
        emojiListRef={emojiListRef}
        handleScrollToIndexFailed={handleScrollToIndexFailed}
        emojiScrollOffsetRef={emojiScrollOffsetRef}
        handleEmojiPickerScroll={handleEmojiPickerScroll}
        centerEmojiInPicker={centerEmojiInPicker}
        mirrorX={mirrorX}
        mirrorY={mirrorY}
        brushRotation={brushRotation}
        toggleMirrorX={toggleMirrorX}
        toggleMirrorY={toggleMirrorY}
        getEmojiItemLayout={getEmojiItemLayout}
        emojiPickerSpacingSlider={emojiPickerSpacingSlider}
        turnBrushLeft={turnBrushLeft}
        turnBrushRight={turnBrushRight}
        turnBrushRightLongPress={turnBrushRightLongPress}
        autoRotateEnabled={autoRotateEnabled}
        brushPreviewStroke={brushPreviewStroke}
        diceScale={diceScale}
        currentPassportImage={currentPassportImage}
        privateStudioToolbar={privateStudioToolbar}
        privateStudioControlBar={privateStudioControlBar}
        totalTimeLabel={totalTimeLabel}
        totalStrokeLabel={totalStrokeLabel}
      />

      {/* ---- Leaderboard (modal + preview + loading overlay + profile overlay) ---- */}
      <LeaderboardOverlay
        {...leaderboard}
        challengeCompleteVisible={challengeCompleteVisible}
        uploadCelebration={uploadCelebration}
        coinBurstAnimatedStyle={coinBurstAnimatedStyle}
        celebrationNextLevel={celebrationNextLevel}
        celebrationRemainingCoins={celebrationRemainingCoins}
        openPrivateStudioFromLeaderboard={openPrivateStudioFromLeaderboard}
        openGalleryFromLeaderboard={openGalleryFromLeaderboard}
        openARFromLeaderboard={openARFromOverlay}
        deviceId={deviceId}
        friendRequests={friendRequests}
        befriendLoading={befriendLoading}
        setBefriendLoading={setBefriendLoading}
        setFriendRequests={setFriendRequests}
        setFriendsDeviceIds={setFriendsDeviceIds}
        coinCount={coinCount}
        currentCoinLevel={currentCoinLevel}
        insets={insets}
      />

      {/* Challenge Confirm Preview modal → rendered by ChallengeOverlay above */}

      <VideoEditorComingSoonModal
        visible={videoEditorComingSoonVisible}
        isIpad={IS_IPAD}
        onClose={() => setVideoEditorComingSoonVisible(false)}
      />


      {/* ── Parental Controls Modal ── */}
      <ParentalControlsModal
        visible={parentalControlsVisible}
        settings={parentalControls}
        offlineEntryCount={offlineEntryCount}
        onClose={() => {
          setParentalControlsVisible(false);
          // Opened from the welcome page → return there on close
          if (parentalFromWelcomeRef.current) {
            parentalFromWelcomeRef.current = false;
            setWelcomeOverlayVisible(true);
          }
        }}
        onSettingsChange={(next) => {
          setParentalControls(next);
          if (next.offlineMode !== parentalControls.offlineMode) {
            // Switching mode: reload gallery
            void refreshGallery(galleryMode, { force: true });
          }
        }}
      />

      <TimeLimitWarningModal
        visible={timeLimitWarningVisible}
        onOpenParentalControls={() => {
          setParentalControlsVisible(true);
          setTimeLimitWarningVisible(false);
        }}
      />

      <ExportOptionsOverlay
        exportOptionsVisible={exportOptionsVisible}
        isExporting={isExporting}
        IS_IPAD={IS_IPAD}
        exportFormat={exportFormat}
        exportOptionsType={exportOptionsType}
        exportTitleEmojiIndex={exportTitleEmojiIndex}
        pngExportSize={pngExportSize}
        setPngExportSize={setPngExportSize}
        setExportOptionsVisible={setExportOptionsVisible}
        handleExportOptionCancel={handleExportOptionCancel}
        handleExportOptionShare={handleExportOptionShare}
        handleExportOptionSaveToPhotos={handleExportOptionSaveToPhotos}
        handleExportOptionOpenInAr={handleExportOptionOpenInAr}
        quickSaveProject={quickSaveProject}
        saveCustomBrushHandler={saveCustomBrushHandler}
        closeExportOptions={closeExportOptions}
      />

      <ResumeSessionOverlay
        showResumeModal={showResumeModal}
        resumeAutosaveData={resumeAutosaveData}
        resumeModalBgAnim={resumeModalBgAnim}
        resumeModalPanelAnim={resumeModalPanelAnim}
        resumeModalButton1Anim={resumeModalButton1Anim}
        resumeModalButton2Anim={resumeModalButton2Anim}
        resumeLogoSet={resumeLogoSet}
        resumeLogoFrameIndex={resumeLogoFrameIndex}
        handleStartFresh={handleStartFresh}
        handleResumeSession={handleResumeSession}
        firstStrokeHelperVisible={firstStrokeHelperVisible}
        firstStrokeHelperText={firstStrokeHelperText}
        onboarding={onboarding}
        notificationsEnabled={notificationsEnabled}
        setNotificationsEnabled={setNotificationsEnabled}
        requestNotificationPermission={requestNotificationsWithTerms}
        parentalControls={parentalControls}
        setInfoVisible={setInfoVisible}
        infoCopy={infoCopy}
        infoPulseScale={infoPulseScale}
        infoPulseOpacity={infoPulseOpacity}
        insets={insets}
      />

      <WorldBrowserOverlay
        worldBrowserVisible={worldBrowserVisible}
        worldUsers={allUsersLeaderboard}
        onClose={closeWorldBrowser}
        onSelectUser={openProfileOverlayForUser}
        deviceId={deviceId}
        insets={insets}
        worldBrowserLoading={worldBrowserLoading}
        worldBrowserImageTimestamp={worldBrowserImageTimestamp}
      />

      <GalleryPassportViewer
        galleryPassportViewerVisible={galleryPassportViewerVisible}
        galleryPassportEntry={galleryPassportViewerUser}
        onClose={closeGalleryPassportViewer}
        onAddFriend={() => {
          CustomOverlayHelper.alert('Coming Soon!', 'Friend system is coming soon! Stay tuned for updates.');
        }}
        deviceId={deviceId ?? ''}
        insets={insets}
      />

      {showFrameUploadModal && (
        <FrameUploadModal
          visible={showFrameUploadModal}
          onPickCamera={() => { void performUpload(false); }}
          onPickLibrary={() => { void performUpload(true); }}
          onCancel={() => setShowFrameUploadModal(false)}
        />
      )}

      <WordingOverlay
        wording={wording}
        showWordSelection={showWordSelection}
        setShowWordSelection={setShowWordSelection}
        infoLanguage={infoLanguage}
        wordingCancelledRef={wordingCancelledRef}
        onAlert={(title, message) => CustomOverlayHelper.alert(title, message)}
      />

      {/* Framer Workspace Modal */}
      {/* 📽️ mode chooser: Face Filter / AR Painting / Animator */}
      <ArModeChooser
        visible={arChooserVisible}
        language={infoLanguage}
        faceComingSoon={IS_LITE_BUILD}
        hideEmojiFace={!ENABLE_LEGACY_EMOJI_FRONT_CAMERA}
        onPickFrontCamera={() => {
          setArChooserVisible(false);
          setArPaintingVisible(false);
          setFrontCameraSessionToken((token) => token + 1);
          setFrontCameraMaskVisible(true);
        }}
        onPickFaceFilter={() => {
          // Face ("Emoji Me") scene is "Coming soon" in the lite/App-Store build.
          if (IS_LITE_BUILD) return;
          // New flow: straight into the live face camera; 2D is the detail mode
          setArChooserVisible(false);
          setFaceFilterOverlayVisible(true);
        }}
        onPickArPainting={() => { setArChooserVisible(false); setArPaintingVisible(true); }}
        onPickAnimator={() => { setArChooserVisible(false); setFramerWorkspaceVisible(true); }}
        onPickVector={() => { setArChooserVisible(false); setVectorWorkspaceVisible(true); }}
        onPickMultipaint={IS_LITE_BUILD ? undefined : () => {
          setArChooserVisible(false);
          // Read profile from AsyncStorage and pass to bridge so MultiPainter skips its own onboarding
          const emoji = brushEmojiRef.current ?? '🎨';
          AsyncStorage.getItem(PROFILE_DISPLAY_NAME_STORAGE_KEY)
            .then((username) => {
              NativeModules.MultiPainterBridge?.openMultiPainter?.(
                username ?? '',
                emoji
              );
            })
            .catch(() => {
              NativeModules.MultiPainterBridge?.openMultiPainter?.('', emoji);
            });
        }}
        onClose={() => setArChooserVisible(false)}
      />

      {/* Vector Mode — the workspace as an infinite, always-crisp vector canvas.
          Documents persist in the schema-v1 package in Lite and full builds. */}
      {vectorWorkspaceVisible && (
        <VectorWorkspace
          visible={vectorWorkspaceVisible}
          initialProjectName={vectorProjectName}
          initialBrushEmoji={brushEmoji}
          initialBrushMode={brushMode}
          initialRecentEmojis={recentEmojis}
          initialSmudgeSmoothness={smudgeSmoothness}
          onBrushEmojiChange={(emoji) => dispatch({ type: 'SET_BRUSH_EMOJI', emoji })}
          onBrushModeChange={(mode) => dispatch({ type: 'SET_BRUSH_MODE', mode })}
          onSmudgeSmoothnessChange={(value) => dispatch({ type: 'SET_SMUDGE_SMOOTHNESS', value })}
          onClose={() => setVectorWorkspaceVisible(false)}
        />
      )}

      {/* AR wall painting (back camera, LiDAR when available).
          Stays mounted once opened — fast switch to Front keeps strokes. */}
      <ArPaintingScreen
        visible={arPaintingVisible}
        pendingSceneDir={arPendingSceneDir}
        onSceneConsumed={() => setArPendingSceneDir(null)}
        pendingPlacementPath={arPendingPlacementUri}
        pendingPlacementIsVideo={arPendingPlacementIsVideo}
        onPlacementConsumed={() => { setArPendingPlacementUri(null); setArPendingPlacementIsVideo(false); }}
        onClose={() => setArPaintingVisible(false)}
        // Direct switch pauses AR without resetting either native scene.
        onSwitchToFrontCamera={() => {
          setArPaintingVisible(false);
          setFrontCameraMaskVisible(true);
        }}
      />

      {/* Independent Front Camera scene: on-device AR Draw Mask Mode with
          live face deformation and a local-only mask library. */}
      <FrontCameraMaskScreen
        visible={frontCameraMaskVisible}
        newSessionToken={frontCameraSessionToken}
        onClose={() => setFrontCameraMaskVisible(false)}
        onSwitchToAr={() => {
          setFrontCameraMaskVisible(false);
          setArPaintingVisible(true);
        }}
      />

      {/* Face puppet: selfie → server-rigged emoji head driven by ARKit
          blendshapes. Stays mounted once opened for fast AR ↔ face switching.
          Excluded entirely from lite/App-Store builds (Face scene = "Coming soon"). */}
      {!IS_LITE_BUILD && ENABLE_LEGACY_EMOJI_FRONT_CAMERA && (
        <FaceMeshOverlay
          visible={faceFilterOverlayVisible}
          onClose={() => setFaceFilterOverlayVisible(false)}
          onSwitchToAr={() => {
            setFaceFilterOverlayVisible(false);
            setArPaintingVisible(true);
          }}
        />
      )}

      <FramerWorkspace
        ref={framerWorkspaceRef}
        visible={framerWorkspaceVisible}
        onClose={async () => {
          // ✅ CRITICAL: Save Framer state to @framer_persistent_data before closing
          // This ensures ExportScreen can read it when user clicks "Save All"
          try {
            if (framerWorkspaceRef.current?.getFramerState) {
              const framerState = framerWorkspaceRef.current.getFramerState();
              if (framerState) {
                await AsyncStorage.setItem('@framer_persistent_data', JSON.stringify(framerState));
                console.log('[PaintScreen] ✅ Saved Framer state to @framer_persistent_data on close:', {
                  frameCount: framerState.frames?.length,
                  hasVideo: !!framerState.miniPreviewVideoUri
                });
                // Also update our ref for quick access
                framerPersistentDataRef.current = framerState;
              }
            }
          } catch (error) {
            console.warn('[PaintScreen] ⚠️ Failed to save Framer state on close:', error);
          }

          setFramerWorkspaceVisible(false);
          setFramerAutoImportVideo(null); // Clear auto-import video on close
          setFramerInitialData(null); // Clear initial data after closing
        }}
        brushEmoji={brushEmoji}
        brushSize={framerBrushSize}
        brushOpacity={brushOpacity}
        brushSpacing={brushSpacing}
        brushRotation={brushRotation}
        mirrorX={mirrorX}
        mirrorY={mirrorY}
        isEraser={toolMode === 'eraser'}
        backgroundStrokes={strokes
          // ✅ CRITICAL: Filter out invisible border strokes before passing to Framer
          // Border strokes have IDs like 'border_top_*', 'border_right_*', etc.
          .filter(s => s?.id && !s.id.startsWith('border_'))
          .map(s => {
            // Calculate center position from points array
            let centerX = 0;
            let centerY = 0;

            if (s.points && s.points.length > 0) {
              // Find the bounding box of all points
              let minX = s.points[0].x;
              let maxX = s.points[0].x;
              let minY = s.points[0].y;
              let maxY = s.points[0].y;

              for (const point of s.points) {
                minX = Math.min(minX, point.x);
                maxX = Math.max(maxX, point.x);
                minY = Math.min(minY, point.y);
                maxY = Math.max(maxY, point.y);
              }

              // Center of the stroke
              centerX = (minX + maxX) / 2;
              centerY = (minY + maxY) / 2;
            }

            return {
              emoji: s.emoji,
              x: centerX,
              y: centerY,
              size: s.size,
              opacity: s.opacity ?? 1,
              rotation: s.rotation ?? 0,
              mirrorX: s.mirrorX ?? false,
              mirrorY: s.mirrorY ?? false
            };
          })}
        workspaceSnapshotUri={workspaceSnapshotUri}
        autoImportVideo={framerAutoImportVideo}
        initialFramerData={(() => {
          const base = framerPersistentDataRef.current ?? null;
          if (trace.isBackground && trace.imageUri && !base?.backgroundImage) {
            return { ...(base ?? {}), backgroundImage: trace.imageUri };
          }
          return base;
        })()}
        onFramerStateRestored={() => {
          // Keep persistent data so Framer can reload on subsequent opens
          console.log('[PaintScreen] Framer restored successfully, keeping data for future reopens');
        }}
        // Topic challenge integration
        activeChallenge={activeChallenge}
        challengeRemainingMs={challengeRemainingMs}
        onChallengeComplete={async (videoUri: string, videoDuration: number) => {
          // Upload MOV to gallery
          console.log('[PaintScreen] Framer challenge complete, uploading MOV:', videoUri);

          if (!activeChallenge || !challengeStartedAtRef.current) {
            console.error('[PaintScreen] Cannot upload: missing challenge data');
            throw new Error('Challenge data not available');
          }

          try {
            // Upload the video file to gallery
            const endedAt = Date.now();

            // Check if this is a mystery paint upload — use state flag, not string comparison
            const isMysteryUpload = mysteryTopicSelected && mysteryTopic !== null;

            const passportNameForUpload = await resolveGalleryPassportName(privateStudioName);

            const result = await uploadDailyPaintSprint({
              imageUri: videoUri, // The server accepts video in the 'image' field
              topic: activeChallenge.prompt.topic,
              startedAtMs: challengeStartedAtRef.current,
              endedAtMs: endedAt,
              challengeAtMs: endedAt,
              videoUri: videoUri,
              videoDuration: videoDuration,
              actualDurationMs: endedAt - challengeStartedAtRef.current,
              passportName: passportNameForUpload,
              passportPortrait: passportPortrait ?? undefined,
              isMysteryPaint: isMysteryUpload,
              mysteryTopicId: isMysteryUpload ? mysteryTopic?.topicId : undefined,
              mysteryTopicText: isMysteryUpload ? mysteryTopic?.topic : undefined
            });

            console.log('[PaintScreen] ✅ MOV upload successful!', {
              imageId: result.imageId,
              imageUrl: result.imageUrl,
              isMysteryPaint: result.isMysteryPaint
            });

            // Create gallery entry from upload result — force mystery flag locally
            const rawFramerEntry = createGalleryEntryFromUpload(result, activeChallenge.prompt.topic);
            const uploadEntry = rawFramerEntry && isMysteryUpload
              ? { ...rawFramerEntry, isMysteryPaint: true, mysteryPaintingId: result.mysteryPaintingId ?? null, mysteryTopicId: mysteryTopic?.topicId ?? 0, mysteryTopicText: mysteryTopic?.topic ?? null }
              : rawFramerEntry;
            if (uploadEntry) {
              primeDailyPaintGalleryCache(uploadEntry, 'new');
              if (galleryMode !== 'hot') {
                setGalleryEntries((prev) => {
                  const existingIndex = prev.findIndex((item) => item.id === uploadEntry.id);
                  let next: DailyPaintGalleryEntry[];
                  if (existingIndex >= 0) {
                    next = [...prev];
                    const previous = next[existingIndex];
                    next[existingIndex] = {
                      ...uploadEntry,
                      userVote: previous.userVote ?? uploadEntry.userVote
                    };
                  } else {
                    next = [uploadEntry, ...prev];
                    if (next.length > GALLERY_FETCH_LIMIT) {
                      next.length = GALLERY_FETCH_LIMIT;
                    }
                  }
                  return sortGalleryEntries(next);
                });
              }
            }

            // Save video to local storage (don't block upload if this fails)
            try {
              console.log('[PaintScreen] Saving Framer video to local storage...');
              const metadata = await probeVideoMetadata(videoUri);
              await addVideo(
                videoUri,
                metadata.width,
                metadata.height,
                metadata.durationMs,
                undefined, // No thumbnail yet
                { isExport: true } // Mark as export (not import)
              );
              console.log('[PaintScreen] ✅ Framer video saved to local storage');
            } catch (storageError) {
              console.error('[PaintScreen] ⚠️ Failed to save video to local gallery:', storageError);
              // Don't throw - upload succeeded, local save is just a backup
              // Show user a warning that local save failed but upload succeeded
              const storageMsg = storageError instanceof Error ? storageError.message : 'Storage error';
              CustomOverlayHelper.alert(
                '⚠️ Local Save Failed',
                `Video was uploaded successfully but couldn't be saved locally:\n\n${storageMsg}`
              );
            }

            // Record the milestones. Rating is requested after a safe UI state
            // (the gallery or dismissed export overlay), never during success.
            await markFirstExport();
            await markFirstUpload();

            // Mark mystery paint as completed and clear state
            if (isMysteryUpload) {
              const { markMysteryPaintCompleted } = await import('../gesser/utils/storage');
              await markMysteryPaintCompleted();
              await AsyncStorage.removeItem('PENDING_MYSTERY_TOPIC');
              console.log('[PaintScreen] ✅ Mystery paint completed and cleared after Framer upload');
            }
            // Always clear mystery state after any challenge upload (safety net)
            setMysteryTopic(null);
            setMysteryTopicSelected(false);

            // Background: auto-save project with topic name before clearing challenge
            void (async () => {
              try {
                const framerState = framerWorkspaceRef.current?.getFramerState?.();
                const topicText = activeChallenge.prompt.topic;
                const safeName = topicText.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 40) || 'sprint';
                const projectName = `${safeName} — Sprint`;
                const payload = createProjectPayload({
                  strokes: [],
                  trace: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, opacity: 0.5, imageUri: null },
                  brushEmoji: brushEmojiRef.current,
                  brushSize: brushSizeRef.current,
                  brushOpacity: brushOpacityRef.current,
                  brushSpacing: brushSpacingRef.current,
                  brushRotation: brushRotationRef.current,
                  mirrorX: mirrorXRef.current,
                  mirrorY: mirrorYRef.current,
                  framerFrames: framerState ?? undefined,
                });
                await saveProjectUnified(projectName, payload, 'framer');
                console.log(`[PaintScreen] ✅ Framer sprint project saved: "${projectName}"`);
                CustomOverlayHelper.alert('Project saved', `📁 "${projectName}" saved to your projects library.`);
              } catch (saveErr) {
                console.warn('[PaintScreen] Framer sprint project auto-save failed (non-critical):', saveErr);
              }
            })();

            // END the challenge session after successful upload
            // Clear challenge state WITHOUT showing the hurra overlay
            console.log('[PaintScreen] Ending challenge session after Framer upload');
            await finishChallengeSession('uploaded');
            framerWorkspaceRef.current?.preserveFramesOnComplete?.();
            setActiveChallenge(null);
            challengeStartedAtRef.current = null;
            challengeCompletionHandledRef.current = true;
            setChallengeSnapshotUri(null);
            // Clear dedicated framer challenge autosave — uploaded successfully
            void clearFramerChallengeAutosave().catch(() => undefined);
            // Note: autosave will automatically clear challenge data since activeChallenge is now null

            // Framer will handle its own success display and close
            // The hurra overlay will NOT appear because challenge is already cleared
            console.log('[PaintScreen] Framer will handle success display and close');

          } catch (error) {
            console.error('[PaintScreen] ❌ MOV upload failed:', error);

            // CHALLENGE UPLOAD: Add retry mechanism with user-friendly error
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            const retryableErrors = ['network', 'timeout', 'ENOTFOUND', 'ETIMEDOUT', '502', '503', '504'];
            const isRetryable = retryableErrors.some(e => errorMsg.toLowerCase().includes(e.toLowerCase()));

            if (isRetryable) {
              // Show retry dialog for network/server errors
              CustomOverlayHelper.alert(
                '⚠️ Upload Failed',
                `Network error occurred:\n\n${errorMsg}\n\nWould you like to retry?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Retry Upload',
                    onPress: () => {
                      // Re-throw to trigger retry
                      throw error;
                    }
                  }
                ]
              );
            } else {
              // Show error dialog for other errors
              CustomOverlayHelper.alert(
                '❌ Upload Failed',
                `Could not upload challenge:\n\n${errorMsg}`,
                [
                  { text: 'OK' }
                ]
              );
              throw error;
            }
          }
        }}
        onChallengeCancel={handleChallengeCancelStop}
        onOpenEmojiPicker={() => {
          framerEmojiPickerOpen.current = true;
          setFramerWorkspaceVisible(false);
          setTimeout(() => {
            setEmojiPickerVisible(true);
          }, 100);
        }}
        onBrushEmojiChange={handleFramerBrushEmojiChange}
        sharedRecentEmojis={recentEmojis}
        onRecentEmojisChange={handleFramerRecentEmojisChange}
        onToggleMirrorX={toggleMirrorX}
        onToggleMirrorY={toggleMirrorY}
        onTurnLeft={turnBrushLeft}
        onTurnRight={turnBrushRight}
        onSpacingChange={handleBrushSpacingChange}
        onSpacingComplete={handleBrushSpacingComplete}
        spacingSliderValue={spacingSliderValue}
        spacingSliderMin={SPACING_SLIDER_MIN}
        spacingSliderMax={SPACING_SLIDER_MAX}
      />

      <AnimationTypeOverlay
        animationTypeVisible={showAnimationModal}
        completionVisible={wording.mode === 'complete' || wording.mode === 'stitching'}
        clearConfirmVisible={showClearConfirm}
        framePickerVisible={framePickerVisible}
        frameButtonPosition={frameButtonPosition}
        frames={frames}
        currentFrameIndex={currentFrameIndex}
        wordingMode={wording.mode}
        wordingWord={wording.word}
        wordingFinalVideoPath={(wording as any).finalVideoPath ?? ''}
        wordingLetters={wording.letters as any}
        wordingExportProgress={wording.exportProgress}
        handlers={{
          setShowAnimationModal,
          setInfoVisible,
          wordingCancelledRef,
          toggleFrameMode,
          stopWording: wording.stopWording,
          exportComposition: (wording as any).exportComposition ?? (() => {}),
          handleClearConfirmed,
          setShowClearConfirm,
          setStrokesClearProgress,
          handleFramePickerSelect,
          setFramePickerVisible,
          navigation,
        }}
        insets={insets}
      />

      {/* Top notification-style daily-topics panel (at most once per 24h, cold open only) */}
      <DailyTopicsNotification
        visible={topicsNotificationVisible}
        prompts={promptCards}
        language={infoLanguage}
        topInset={insets.top}
        uploadedTopics={uploadedPromptTopics}
        voteUpdate={galleryVoteUpdate}
        onTopicPress={handleTopicsNotificationTopicPress}
        onDismiss={handleTopicsNotificationDismiss}
        onShowInGallery={handleShowVoteUpdateInGallery}
      />

    </>
  );
};

// iPad gets 20% smaller canvas (more zoom out capability)
const isIpad = Platform.OS === 'ios' && (Platform as any)?.isPad === true;
const canvasSize = Math.min(screenWidth, screenHeight * 0.85) * (isIpad ? 0.8 : 1);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030303',
    paddingBottom: 16,
    position: 'relative'
  },
  emojiPlanePanelWrap: {
    position: 'absolute',
    zIndex: 60
  },
  emojiPlanePanelDragHandle: {
    alignSelf: 'center',
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginBottom: 2,
    borderRadius: 7,
    backgroundColor: 'rgba(20,20,20,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.45)'
  },
  emojiPlanePanelDragHandleText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.2
  },
  hiddenCaptureContainer: {
    position: 'absolute',
    top: -9999,
    left: -9999,
    opacity: 0
  },
  hiddenCaptureCanvas: {
    width: canvasSize,
    height: canvasSize * CANVAS_RATIO
  },
  hiddenCaptureInner: {
    width: canvasSize,
    height: canvasSize * CANVAS_RATIO
    // No backgroundColor - let PaintCanvas control it
  },
  viewShot: {
    flex: 1,
    marginBottom: 12,
    alignSelf: 'center'
  },
  canvasStage: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: IS_IPAD ? 'flex-start' : 'center',
    paddingTop: IS_IPAD ? 24 : 0
  },
  canvasWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  canvasArea: {
    width: canvasSize,
    height: canvasSize * CANVAS_RATIO,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#030303',
    borderWidth: 2,
    borderColor: '#272727',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10
  },
  traceOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: canvasSize,
    height: canvasSize * CANVAS_RATIO,
    alignItems: 'center',
    justifyContent: 'center'
  },
  traceImage: {
    width: '100%',
    height: '100%'
  },
  traceLoadingChip: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999
  },
  traceLoadingText: {
    color: '#ffdc82',
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  challengeCompleteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  challengeCompleteCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#161616',
    borderRadius: 20,
    padding: 20,
    gap: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2d2d2d'
  },
  challengeCompleteTitle: {
    color: '#ffdc82',
    fontWeight: '700',
    fontSize: 22,
    fontFamily: 'vrtlfinal'
  },
  challengeCompleteSubtitle: {
    color: '#fff',
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  challengeCompletePreviewWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#101010',
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  challengeCompleteSpinner: {
    paddingVertical: 24
  },
  challengeCompletePreview: {
    width: '100%',
    height: '100%'
  },
  challengeCompletePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center'
  },
  challengeCompletePlaceholderText: {
    color: '#bbb',
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  challengeCoinBurst: {
    position: 'absolute',
    top: -20,
    alignSelf: 'center'
  },
  challengeCoinBurstLabel: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffdc82',
    textShadowColor: '#402d00',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 2 },
    fontFamily: 'vrtlfinal'
  },
  challengeCoinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  challengeMinimumNotice: {
    color: '#ffb38a',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
    fontFamily: 'vrtlfinal'
  },
  challengeCoinTotal: {
    color: '#ffdc82',
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  challengeCoinStars: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'vrtlfinal'
  },
  challengeUploadSuccess: {
    color: '#82ffa1',
    fontWeight: '600',
    marginTop: 8,
    fontFamily: 'vrtlfinal'
  },
  challengeUploadError: {
    color: '#ff6b6b',
    fontWeight: '600',
    marginTop: 8,
    fontFamily: 'vrtlfinal'
  },
  challengeCompleteActions: {
    flexDirection: 'row',
    gap: 12
  },
  challengeCompletePrimary: {
    flex: 1,
    backgroundColor: '#ff6b6b',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center'
  },
  challengeCompleteCancelButton: {
    backgroundColor: '#2a2a2a'
  },
  challengeCompletePrimarySpinner: {
    paddingVertical: 2
  },
  challengeCompletePrimaryLabel: {
    color: '#fff',
    fontWeight: '700'
  },
  challengeCompleteSecondary: {
    backgroundColor: '#262626',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  challengeCompleteSecondaryLabel: {
    color: '#fff',
    fontWeight: '600'
  },
  tracePanelOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 216,
    pointerEvents: 'box-none'
  },
  toolbarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
    paddingHorizontal: 16
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Math.round(12 * TOOL_SCALE),
    backgroundColor: 'rgba(15,15,15,0.92)',
    borderRadius: Math.round(20 * TOOL_SCALE),
    paddingHorizontal: Math.round(18 * TOOL_SCALE),
    paddingVertical: Math.round(10 * TOOL_SCALE),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2d2d2d',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12
  },
  challengeTimerOverlayArea: {
    position: 'absolute',
    zIndex: 40,
    alignItems: 'center',
    justifyContent: 'center'
  },
  challengeTimerBubble: {
    backgroundColor: 'rgba(10, 10, 10, 0.92)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
    minWidth: 170,
    maxWidth: 220,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12
  },
  challengeTimerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4
  },
  challengeTimerTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  challengeTimerCloseButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8
  },
  challengeTimerCloseLabel: {
    color: '#ff6b6b',
    fontWeight: '700',
    fontSize: 14
  },
  challengeTimerClock: {
    fontSize: 30,
    fontWeight: '800',
    color: '#82ffa1',
    fontVariant: ['tabular-nums']
  },
  challengeTimerClockExpired: {
    color: '#ff6b6b'
  },
  challengeTimerPrompt: {
    marginTop: 2,
    color: '#d8d8d8',
    fontSize: 12
  },
  promptOverlayArea: {
    position: 'absolute',
    zIndex: 35,
    pointerEvents: 'box-none',
    alignItems: 'center',
    justifyContent: 'flex-start'
  },
  promptOverlayStack: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: PROMPT_CARD_GAP,
    paddingHorizontal: 16
  },
  promptOverlayStackLandscape: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: PROMPT_CARD_GAP
  },
  promptCard: {
    width: '100%',
    maxWidth: PROMPT_CARD_WIDTH,
    height: PROMPT_CARD_HEIGHT,
    borderRadius: 18,
    backgroundColor: 'rgba(8, 8, 8, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
    overflow: 'hidden'
  },
  promptCardLandscape: {
    width: PROMPT_CARD_WIDTH,
    maxWidth: PROMPT_CARD_WIDTH,
    minWidth: 160,
    flexGrow: 0,
    flexShrink: 0
  },
  promptCardButton: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center'
  },
  promptCardTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  promptCardTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    flex: 1,
    marginRight: 8
  },
  promptCardTitleDisabled: {
    color: '#777'
  },
  promptCardHint: {
    color: '#ff9f6b',
    fontWeight: '700',
    fontSize: 12
  },
  promptCardMeta: {
    color: '#cfcfcf',
    fontSize: 11,
    marginTop: 2
  },
  challengeBanner: {
    marginBottom: 12,
    alignSelf: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    maxWidth: Math.min(screenWidth - 32, 420)
  },
  challengeBannerExpired: {
    backgroundColor: '#3a1414'
  },
  challengeBannerText: {
    color: '#ffdc82',
    fontWeight: '600',
    flex: 1,
    fontFamily: 'vrtlfinal'
  },
  challengeBannerTextExpired: {
    color: '#f8bfbf',
    fontFamily: 'vrtlfinal'
  },
  challengeDismiss: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#292929'
  },
  challengeDismissLabel: {
    color: '#fff',
    fontWeight: '600'
  },
  toolButton: {
    backgroundColor: 'rgba(31,31,31,0.85)',
    borderRadius: OVERLAY_BUTTON_RADIUS,
    paddingHorizontal: OVERLAY_BUTTON_PADDING_H,
    paddingVertical: OVERLAY_BUTTON_PADDING_V,
    minWidth: OVERLAY_BUTTON_WIDTH,
    alignItems: 'center'
  },
  toolButtonActive: {
    backgroundColor: '#ff6b6b'
  },
  toolEmoji: {
    fontSize: OVERLAY_FONT_SIZE,
    color: '#fff'
  },
  disabledButton: {
    opacity: 0.35
  },
  sizeControls: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: Math.round(12 * TOOL_SCALE),
    paddingHorizontal: Math.round(6 * TOOL_SCALE),
    paddingVertical: Math.round(8 * TOOL_SCALE),
    width: '100%'
  },
  brushControlColumn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    paddingHorizontal: Math.round(8 * TOOL_SCALE),
    paddingVertical: Math.round(4 * TOOL_SCALE),
    gap: Math.round(10 * TOOL_SCALE)
  },
  opacityToggle: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingHorizontal: Math.round(16 * TOOL_SCALE),
    paddingVertical: Math.round(10 * TOOL_SCALE),
    alignItems: 'center',
    justifyContent: 'center'
  },
  opacityToggleEmoji: {
    fontSize: Math.round(20 * TOOL_SCALE),
    color: '#fff'
  },
  sizeSlider: {
    flex: 1
  },
  sliderEmoji: {
    fontSize: Math.round(20 * TOOL_SCALE),
    minWidth: Math.round(26 * TOOL_SCALE),
    textAlign: 'left',
    color: '#fff'
  },
  sliderInput: {
    width: Math.round(54 * TOOL_SCALE),
    paddingHorizontal: 8,
    paddingVertical: Platform.OS === 'ios' ? 6 : 3,
    borderRadius: 8,
    backgroundColor: '#1f1f1f',
    color: '#fff',
    textAlign: 'right',
    fontSize: Math.round(14 * TOOL_SCALE)
  },
  sliderInputIpad: {
    width: Math.round(54 * TOOL_SCALE) - 30 // 30px smaller on iPad
  },
  spacingControlColumn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    paddingHorizontal: Math.round(8 * TOOL_SCALE),
    paddingVertical: Math.round(4 * TOOL_SCALE),
    gap: Math.round(10 * TOOL_SCALE)
  },
  spacingValueLabel: {
    width: Math.round(70 * TOOL_SCALE),
    textAlign: 'right',
    color: '#ffdc82',
    fontSize: Math.round(13 * TOOL_SCALE)
  },
  traceControls: {
    backgroundColor: 'transparent',
    paddingHorizontal: Math.round(14 * TOOL_SCALE),
    paddingVertical: Math.round(12 * TOOL_SCALE),
    gap: Math.round(16 * TOOL_SCALE)
  },
  tracePanelInline: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    paddingHorizontal: Math.round(16 * TOOL_SCALE),
    paddingVertical: Math.round(14 * TOOL_SCALE),
    gap: 16,
    width: '100%',
    maxWidth: Math.min(screenWidth - 24, canvasSize + 24)
  },
  tracePanelHeaderInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  traceActionButtonInline: {
    backgroundColor: '#272727',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10
  },
  traceConfirmButtonInline: {
    backgroundColor: '#30d158'
  },
  traceActionEmojiInline: {
    color: '#fff',
    fontSize: 18
  },
  traceScaleSliderInline: {
    flex: 1
  },
  traceOpacityRowInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  traceOpacitySliderInline: {
    flex: 1
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Math.round(8 * TOOL_SCALE)
  },
  quickActionStaticWrapper: {
    borderRadius: QUICK_BUTTON_RADIUS
  },
  quickActionButton: {
    backgroundColor: '#1f1f1f',
    borderRadius: QUICK_BUTTON_RADIUS,
    width: QUICK_BUTTON_SIZE,
    height: QUICK_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center'
  },
  infoButtonWrapper: {
    borderRadius: QUICK_BUTTON_RADIUS,
    shadowColor: '#ff9f6b',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 18,
    shadowOpacity: 0.28,
    elevation: 6
  },
  infoButton: {
    backgroundColor: '#2b1f1a',
    borderWidth: 1,
    borderColor: '#ff9f6b'
  },
  quickActionEmoji: {
    fontSize: QUICK_EMOJI_SIZE,
    lineHeight: QUICK_EMOJI_SIZE + 4, // Add extra space to prevent cropping
    color: '#fff',
    textAlign: 'center',
    includeFontPadding: false // Android-specific to reduce extra padding
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Math.round(12 * TOOL_SCALE)
  },
  sliderLabel: {
    color: '#bbb',
    fontSize: Math.round(14 * TOOL_SCALE),
    minWidth: Math.round(110 * TOOL_SCALE)
  },
  slider: {
    flex: 1,
    height: Math.round(28 * TOOL_SCALE)
  },
  sliderValue: {
    color: '#fff',
    width: Math.round(48 * TOOL_SCALE),
    textAlign: 'right'
  },
  secondaryButton: {
    backgroundColor: '#1f1f1f',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  secondaryButtonLabel: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center'
  },
  dangerButton: {
    backgroundColor: '#3a1414',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-start',
    alignItems: 'stretch'
  },
  pickerContainer: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    backgroundColor: '#111111',
    paddingTop: 48,
    paddingLeft: 24,
    // iPad keeps room for the right-side controls; iPhone uses the full width
    paddingRight: IS_IPAD ? 60 : 24,
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
  },
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
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', default: undefined })
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
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', default: undefined })
  },
  pickerTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 20,
    marginBottom: 0,
    textAlign: 'left'
  },
  pickerSearch: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#fff',
    marginBottom: 14
  },
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
  },
  pickerFlipLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600'
  },
  pickerFlipLabelActive: {
    color: '#050505'
  },
  pickerList: {
    paddingHorizontal: 14,
    paddingBottom: 96,
    paddingTop: 8
  },
  pickerRow: {
    justifyContent: 'space-evenly',
    gap: 6,
    marginBottom: 6
  },
  pickerEmojiCell: {
    width: Math.floor((screenWidth - 28 - (PICKER_COLUMN_COUNT - 1) * 6) / PICKER_COLUMN_COUNT),
    aspectRatio: 1,
    borderRadius: 13,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: 38
  },
  pickerEmojiCellActive: {
    backgroundColor: '#ff6b6b',
    borderColor: '#ffdc82',
    transform: [{ scale: 1.08 }]
  },
  pickerEmoji: {
    fontSize: 25,
    lineHeight: 29,
    fontFamily: Platform.select({ ios: 'System', default: undefined })
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  privateStudioOverlay: {
    alignItems: 'stretch',
    padding: 0,
    paddingTop: 20, // Move entire overlay 20px down
  },
  fullscreenSheet: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '90%',
    backgroundColor: '#101010',
    borderRadius: 28,
    padding: 24
  },
  leaderboardOverlay: {
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    padding: 0
  },
  leaderboardSheet: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    backgroundColor: '#101010',
    borderRadius: 0,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 16
  },
  leaderboardCelebration: {
    backgroundColor: '#181824',
    borderRadius: 22,
    padding: 20,
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
    gap: 6
  },
  leaderboardCelebrationBurst: {
    position: 'absolute',
    top: -6,
    right: 12
  },
  leaderboardCelebrationBurstLabel: {
    color: '#ffdc82',
    fontSize: 24,
    fontWeight: '700'
  },
  leaderboardCelebrationTitle: {
    color: '#ffdc82',
    fontSize: 20,
    fontWeight: '700'
  },
  leaderboardCelebrationCoins: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600'
  },
  leaderboardCelebrationLevelRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  leaderboardCelebrationLevelEmoji: {
    fontSize: 34
  },
  leaderboardCelebrationLevelLabel: {
    color: '#82ffa1',
    fontSize: 16,
    fontWeight: '700'
  },
  leaderboardCelebrationLevelUp: {
    color: '#ff9f6b',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 10
  },
  leaderboardCelebrationHint: {
    color: '#bbbbbb',
    fontSize: 12
  },
  leaderboardHeader: {
    marginBottom: 12
  },
  leaderboardHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  leaderboardProfileButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  leaderboardProfileEmoji: {
    fontSize: 24,
    color: '#ffdc82'
  },
  leaderboardGalleryButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  leaderboardGalleryEmoji: {
    fontSize: 22,
    color: '#9fd5ff'
  },
  fullscreenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20
  },
  fullscreenTitle: {
    color: '#ffdc82',
    fontSize: 22,
    fontWeight: '700'
  },
  fullscreenClose: {
    color: '#fff',
    fontSize: 22
  },
  fullscreenCloseDisabled: {
    color: '#555'
  },
  fullscreenBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  fullscreenPlaceholder: {
    color: '#bbbbbb',
    fontSize: 16,
    textAlign: 'center'
  },
  privateStudioSheet: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: 0,
    padding: 0,
    paddingBottom: 12
  },
  privateStudioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  privateStudioHeaderTitleBlock: {
    flex: 1,
    alignItems: 'flex-start'
  },
  privateStudioTipContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingHorizontal: 16
  },
  privateStudioTipBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f1f1f',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ff9f6b40',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
    position: 'relative',
    maxWidth: '90%'
  },
  privateStudioTipText: {
    color: '#ffdc82',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
    fontFamily: 'vrtlfinal'
  },
  privateStudioTipTail: {
    position: 'absolute',
    left: 22,
    bottom: -6,
    width: 14,
    height: 14,
    backgroundColor: '#1f1f1f',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ff9f6b40',
    transform: [{ rotate: '45deg' }]
  },
  privateStudioTipBurst: {
    position: 'absolute',
    top: -18,
    left: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  privateStudioTipBurstEmoji: {
    fontSize: 30,
    color: '#ff9f6b'
  },
  privateStudioHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  privateStudioActionButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  privateStudioActionEmoji: {
    fontSize: 20,
    color: '#ffdc82'
  },
  privateStudioActionEmojiGallery: {
    color: '#9fd5ff'
  },
  privateStudioActionEmojiLeaderboard: {
    color: '#ffdc82'
  },
  privateStudioCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#242424',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#383838'
  },
  privateStudioCloseLabel: {
    fontSize: 24,
    color: '#ff7f7f'
  },
  privateStudioBody: {
    flex: 1,
    width: '100%'
  },
  privateStudioContent: {
    flex: 1,
    width: '100%',
    gap: 2
  },
  privateStudioDetails: {
    paddingHorizontal: 8,
    paddingTop: 0,
    paddingBottom: 4,
    gap: 2
  },
  privateStudioIdentityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 0
  },
  privateStudioNameColumn: {
    flex: 1,
    minWidth: 220,
    gap: 6
  },
  privateStudioStatsColumn: {
    minWidth: 200,
    flexShrink: 0,
    gap: 6,
    alignItems: 'flex-end'
  },
  privateStudioLabel: {
    color: '#8e8e92',
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: 'vrtlfinal'
  },
  privateStudioNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#181818',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: Platform.select({ ios: 6, default: 4 }),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  privateStudioNameInput: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: Platform.select({ ios: 10, default: 8 }),
    color: '#ffffff',
    fontSize: 13,
    borderWidth: 0
  },
  privateStudioRandomNameButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f1f1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  privateStudioRandomNameWrapper: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  privateStudioRandomNameEmoji: {
    fontSize: 20,
    color: '#ffdc82'
  },
  privateStudioLevelHint: {
    color: '#82ffa1',
    fontSize: 10,
    fontWeight: '600',
    marginTop: -2,
    textAlign: 'right'
  },
  privateStudioControlsContainer: {
    width: '100%',
    gap: 4,
    paddingHorizontal: 4,
    paddingTop: 4
  },
  privateStudioToolbarWrap: {
    paddingHorizontal: 4,
    marginBottom: 0,
    marginTop: -80
  },
  privateStudioControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 6,
    width: '100%'
  },
  privateStudioControlsRowWrapper: {
    paddingHorizontal: 4,
    marginTop: -16
  },
  privateStudioEmojiButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  privateStudioEmoji: {
    fontSize: 22,
    color: '#ffffff'
  },
  privateStudioSliderGroup: {
    flex: 1,
    minWidth: 90,
    maxWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1b1b1b',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  privateStudioSlider: {
    flex: 1,
    height: 20
  },
  privateStudioSliderValue: {
    color: '#ffffff',
    width: 30,
    textAlign: 'right',
    fontSize: 11,
    fontVariant: Platform.select({ ios: ['tabular-nums'], default: undefined })
  },
  privateStudioUploadWrapper: {
    borderRadius: 12,
    position: 'relative'
  },
  privateStudioUploadButton: {
    backgroundColor: '#ff9f6b',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 54,
    alignItems: 'center',
    justifyContent: 'center'
  },
  privateStudioUploadGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    backgroundColor: '#ffdfc0'
  },
  privateStudioUploadEmoji: {
    fontSize: 22,
    color: '#1a0e08'
  },
  privateStudioActionDisabled: {
    opacity: 0.5
  },
  privateStudioOpacityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  privateStudioOpacityActive: {
    backgroundColor: '#2d2d2d20',
    borderColor: '#ff6b6b70'
  },
  privateStudioOpacityEmoji: {
    fontSize: 16,
    color: '#ffdc82'
  },
  privateStudioStatText: {
    color: '#ffdc82',
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: 'vrtlfinal'
  },
  privateStudioMessage: {
    color: '#82ffa1',
    fontSize: 13,
    marginTop: 4
  },
  privateStudioError: {
    color: '#ff6b6b',
    fontSize: 13,
    marginTop: 4
  },
  privateStudioWorkspaceSection: {
    flex: 1,
    flexGrow: 1,
    width: '100%',
    justifyContent: 'center',
    marginTop: 160
  },
  privateStudioWorkspaceWrapper: {
    flex: 1,
    width: '100%',
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
    position: 'relative'
  },
  privateStudioWorkspaceInner: {
    flex: 1,
    borderRadius: 0,
    overflow: 'visible',
    backgroundColor: 'transparent',
    alignItems: 'stretch',
    justifyContent: 'center'
  },
  privateStudioCanvasStage: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 0
  },
  privateStudioScaler: {
    width: canvasSize,
    height: canvasSize * CANVAS_RATIO,
    alignSelf: 'center'
  },
  privateStudioLoading: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 32
  },
  privateStudioLoadingLabel: {
    color: '#bbbbbb',
    fontSize: 14
  },
  leaderboardBody: {
    flex: 1,
    gap: 16
  },
  leaderboardListWrapper: {
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 24,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#222222'
  },
  leaderboardLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  leaderboardLoadingLabel: {
    color: '#bbbbbb',
    fontSize: 14
  },
  leaderboardMessageBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 12
  },
  leaderboardError: {
    color: '#ff6b6b',
    fontSize: 15,
    textAlign: 'center'
  },
  leaderboardEmpty: {
    color: '#bbbbbb',
    fontSize: 15,
    textAlign: 'center'
  },
  leaderboardList: {
    flex: 1
  },
  leaderboardListContent: {
    gap: 12,
    paddingBottom: 8
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181818',
    borderRadius: 18,
    padding: 12,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#292929',
    position: 'relative'
  },
  leaderboardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8
  },
  leaderboardOwnTag: {
    backgroundColor: '#ff9f6b',
    color: '#050505',
    fontWeight: '700',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6
  },
  leaderboardImageButton: {
    width: 64,
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
    position: 'relative'
  },
  leaderboardRankBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ff6b6b20',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ff6b6b70'
  },
  leaderboardRankText: {
    color: '#ff6b6b',
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  leaderboardMeta: {
    flex: 1,
    gap: 4
  },
  leaderboardName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600'
  },
  leaderboardStats: {
    color: '#ffdc82',
    fontSize: 13
  },
  leaderboardCoins: {
    color: '#82ffa1',
    fontSize: 13,
    fontWeight: '600'
  },
  leaderboardTime: {
    color: '#8e8e92',
    fontSize: 12
  },
  leaderboardImage: {
    width: '100%',
    height: '100%'
  },
  leaderboardImageOverlay: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  leaderboardImageOverlayIcon: {
    color: '#ffdc82',
    fontSize: 12,
    fontWeight: '600'
  },
  leaderboardImagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  leaderboardImagePlaceholderLabel: {
    color: '#ffdc82',
    fontSize: 12,
    fontWeight: '600'
  },
  leaderboardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 4
  },
  leaderboardRefresh: {
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f'
  },
  leaderboardRefreshLabel: {
    color: '#ffdc82',
    fontWeight: '600'
  },
  leaderboardTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4
  },
  leaderboardTab: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  leaderboardTabActive: {
    backgroundColor: '#ff6b6b20',
    borderColor: '#ff6b6b70'
  },
  leaderboardTabLabel: {
    color: '#888888',
    fontSize: 14,
    fontWeight: '600'
  },
  leaderboardTabLabelActive: {
    color: '#ff6b6b'
  },
  leaderboardSeasonBanner: {
    backgroundColor: '#181824',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 4
  },
  leaderboardSeasonTheme: {
    color: '#ffdc82',
    fontSize: 18,
    fontWeight: '700'
  },
  leaderboardSeasonMeta: {
    color: '#9fd5ff',
    fontSize: 13,
    fontWeight: '500'
  },
  leaderboardPreviewSheet: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    backgroundColor: '#050505',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 20,
    alignSelf: 'center'
  },
  leaderboardPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  leaderboardPreviewTitleBlock: {
    gap: 4
  },
  leaderboardPreviewName: {
    color: '#ffdc82',
    fontSize: 20,
    fontWeight: '700'
  },
  leaderboardPreviewRank: {
    color: '#bbbbbb',
    fontSize: 14,
    fontWeight: '600'
  },
  leaderboardPreviewImageWrapper: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center'
  },
  leaderboardPreviewImage: {
    width: '100%',
    height: '100%'
  },
  leaderboardPreviewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24
  },
  leaderboardPreviewPlaceholderLabel: {
    color: '#bbbbbb',
    fontSize: 15,
    textAlign: 'center'
  },
  galleryOverlay: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    padding: 0,
    flex: 1
  },
  gallerySheet: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    backgroundColor: '#111111',
    borderRadius: 0,
    paddingHorizontal: 24,
    gap: 16
  },
  galleryHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: IS_IPAD ? 0 : 24  // Match gallery content padding on iPhone
  },
  galleryHeaderBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 12,
    flexWrap: 'wrap',
    paddingHorizontal: IS_IPAD ? 0 : 24  // Match gallery content padding on iPhone
  },
  galleryHeaderTitleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0
  },
  galleryHeaderSpinner: {
    marginLeft: 6
  },
  galleryLanguageToggle: {
    marginLeft: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#1f1f1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  galleryLanguageToggleFlag: {
    fontSize: 20
  },
  galleryHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  galleryActionButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  galleryActionEmoji: {
    fontSize: 22,
    color: '#9fd5ff'
  },
  galleryActionEmojiProfile: {
    color: '#ffdc82'
  },
  galleryActionEmojiLeaderboard: {
    color: '#ffdc82'
  },
  galleryModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10
  },
  galleryModeButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#1a1a1a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  galleryModeButtonActive: {
    backgroundColor: '#3a3a3a',
    borderColor: '#ff9f6b'
  },
  galleryModeLabel: {
    color: '#bbbbbb',
    fontSize: 15,
    fontWeight: '600'
  },
  galleryModeLabelActive: {
    color: '#ffdc82'
  },
  galleryCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c'
  },
  galleryLanguageDropdown: {
    marginTop: -6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#181818',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a',
    gap: 4
  },
  galleryLanguageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12
  },
  galleryLanguageOptionActive: {
    backgroundColor: '#2b2b2b'
  },
  galleryLanguageOptionFlag: {
    fontSize: 18
  },
  galleryLanguageOptionFlagActive: {
    transform: [{ scale: 1.05 }]
  },
  galleryLanguageOptionLabel: {
    color: '#f5f5f5',
    fontSize: 14,
    fontWeight: '500'
  },
  galleryLanguageOptionLabelActive: {
    color: '#ffdc82'
  },
  galleryDescription: {
    color: '#9ea0a4',
    fontSize: 13,
    marginBottom: 16,
    paddingHorizontal: 16,
    lineHeight: 19
  },
  galleryError: {
    backgroundColor: '#1c0f0f',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a1a1a'
  },
  galleryErrorLabel: {
    color: '#ff9f9f',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12
  },
  galleryRetryButton: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#ff6b6b'
  },
  galleryRetryLabel: {
    color: '#111111',
    fontWeight: '700'
  },
  galleryLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  galleryLoadingLabel: {
    color: '#bdbdbd',
    fontSize: 14
  },
  galleryEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  galleryEmptyLabel: {
    color: '#8e8e92',
    fontSize: 14,
    textAlign: 'center'
  },
  galleryList: {
    flex: 1
  },
  galleryListContent: {
    paddingVertical: 24,
    paddingBottom: 32,
    alignItems: 'center'
  },
  galleryPagination: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 8
  },
  galleryPaginationButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#1f1f1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a'
  },
  galleryPaginationButtonActive: {
    backgroundColor: '#ff6b6b',
    borderColor: '#ff6b6b'
  },
  galleryPaginationLabel: {
    color: '#f5f5f5',
    fontSize: 14,
    fontWeight: '600'
  },
  galleryPaginationLabelActive: {
    color: '#111111'
  },
  galleryStatsRow: {
    width: '100%',
    paddingHorizontal: 18,
    paddingBottom: 8,
    alignItems: 'center'
  },
  galleryStatsLabel: {
    color: '#9ca3af',
    fontSize: 13
  },
  gallerySectionHeader: {
    width: '100%',
    paddingHorizontal: 18,
    paddingVertical: 6
  },
  gallerySectionTitle: {
    color: '#ffdc82',
    fontSize: 14,
    fontWeight: '600'
  },
  gallerySectionSubtitle: {
    color: '#9ea0a4',
    fontSize: 12,
    marginTop: 2
  },
  galleryCard: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 18,
    marginBottom: 28,
    backgroundColor: '#151515',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#262626',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6
  },
  galleryCardHeader: {
    gap: 6
  },
  galleryCardTopicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap'
  },
  galleryCardTopicEmoji: {
    fontSize: 20,
    marginRight: 2
  },
  galleryCardTopic: {
    color: '#ffdc82',
    fontSize: 20,
    fontWeight: '700'
  },
  galleryCardTopicOriginal: {
    color: '#bbbbbb',
    fontSize: 13,
    fontStyle: 'italic'
  },
  galleryCardMeta: {
    color: '#9ea0a4',
    fontSize: 13,
    fontWeight: '500'
  },
  mysteryGuessButton: {
    backgroundColor: '#9C27B0',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginTop: 8,
    alignItems: 'center'
  },
  mysteryGuessButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700'
  },
  galleryCardImageWrapper: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#030303',
    width: '100%',
    aspectRatio: 1
  },
  galleryCardImage: {
    width: '100%',
    height: '100%'
  },
  retryHelperContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center'
  },
  retryHelperBubble: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(10,10,10,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#363636',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    maxWidth: Math.min(canvasSize - 32, 320)
  },
  retryHelperText: {
    color: '#ffdc82',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  galleryCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18
  },
  galleryCardFooterLeft: {
    flex: 1,
    gap: 10
  },
  galleryCardTraveler: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600'
  },
  galleryCardVotesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  galleryVoteButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1d1d1d',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f'
  },
  galleryVoteButtonActive: {
    backgroundColor: '#ff9f6b',
    borderColor: '#ff9f6b'
  },
  galleryVoteButtonDisabled: {
    opacity: 0.5
  },
  galleryVoteIcon: {
    fontSize: 20,
    color: '#f1f1f1'
  },
  galleryVoteIconActive: {
    color: '#111111'
  },
  galleryVoteCountLabel: {
    color: '#ffffff',
    fontSize: 14,
    minWidth: 28,
    textAlign: 'center',
    fontVariant: Platform.select({ ios: ['tabular-nums'], default: undefined })
  },
  galleryCardPassport: {
    width: 64,
    height: 64,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f'
  },
  galleryCardPassportDisabled: {
    opacity: 0.5
  },
  galleryCardPassportImage: {
    width: '100%',
    height: '100%'
  },
  galleryCardPassportPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  galleryCardPassportPlaceholderIcon: {
    fontSize: 24,
    color: '#ffdc82'
  },
  galleryViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.97)',
    zIndex: 999,
    elevation: 999,
  },
  galleryViewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 12
  },
  galleryViewerCloseButton: {
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#1f1f1f'
  },
  galleryViewerCloseLabel: {
    color: '#ffffff',
    fontSize: 18
  },
  galleryViewerResetButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#1f1f1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2d2d2d'
  },
  galleryViewerResetLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600'
  },
  galleryViewerBody: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24
  },
  galleryViewerImageWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  galleryViewerImage: {
    width: '100%',
    aspectRatio: 1,
  },
  galleryViewerCaption: {
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
    gap: 6
  },
  galleryViewerTopic: {
    color: '#ffdc82',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center'
  },
  galleryViewerTopicOriginal: {
    color: '#bbbbbb',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center'
  },
  galleryViewerMeta: {
    color: '#bdbdbd',
    fontSize: 13,
    textAlign: 'center'
  },
  galleryViewerMetaSecondary: {
    color: '#9ea0a4',
    fontSize: 12,
    textAlign: 'center'
  },
  leaderboardPreviewStats: {
    gap: 8
  },
  leaderboardPreviewStat: {
    color: '#ffdc82',
    fontSize: 16,
    fontWeight: '600'
  },
  leaderboardPreviewTimestamp: {
    color: '#8e8e92',
    fontSize: 13
  },
  galleryPassportOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    paddingHorizontal: 24,
    justifyContent: 'center'
  },
  galleryPassportCard: {
    backgroundColor: '#111111',
    borderRadius: 28,
    padding: 24,
    gap: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#272727'
  },
  galleryPassportCloseButton: {
    alignSelf: 'flex-end',
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#1f1f1f'
  },
  galleryPassportCloseLabel: {
    color: '#ffffff',
    fontSize: 16
  },
  galleryPassportImageFrame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#030303',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2d2d2d'
  },
  galleryPassportImage: {
    width: '100%',
    height: '100%'
  },
  galleryPassportBody: {
    gap: 10
  },
  galleryPassportName: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700'
  },
  galleryPassportTopic: {
    color: '#ffdc82',
    fontSize: 16,
    fontWeight: '600'
  },
  galleryPassportTopicOriginal: {
    color: '#bbbbbb',
    fontSize: 13,
    fontStyle: 'italic'
  },
  galleryPassportStatsColumn: {
    gap: 6
  },
  galleryPassportMeta: {
    color: '#a8a8a8',
    fontSize: 13
  },
  challengeConfirmPreviewOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0
  },
  challengeConfirmPreviewSheet: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#101010',
    borderRadius: 28,
    paddingHorizontal: 24
  },
  challengeConfirmPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  challengeConfirmPreviewTitle: {
    color: '#ffdc82',
    fontSize: 20,
    fontWeight: '700'
  },
  challengeConfirmPreviewImageWrapper: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#000',
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center'
  },
  challengeConfirmPreviewFullscreenImage: {
    width: '100%',
    height: '100%'
  },
  challengeConfirmPreviewFullscreenPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  infoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18
  },
  infoSheet: {
    width: '100%',
    maxWidth: IS_IPAD ? 702 : 540, // 30% wider on iPad (540 * 1.3 = 702)
    maxHeight: '85%',
    backgroundColor: '#121212',
    borderRadius: 24,
    padding: 24
  },
  infoHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16
  },
  infoHeaderActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  infoHeaderButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#1f1f1f',
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoHeaderButtonLabel: {
    fontSize: 20,
  },
  infoLogoAnimationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    paddingVertical: 8
  },
  infoTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'vrtlfinal'
  },
  infoSubtitle: {
    marginTop: 4,
    fontSize: 16,
    color: '#ff9f6b',
    fontFamily: 'vrtlfinal'
  },
  infoCloseButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#1f1f1f'
  },
  infoCloseLabel: {
    fontSize: 18,
    color: '#fff',
    fontFamily: 'vrtlfinal'
  },
  infoScrollContent: {
    paddingBottom: 12
  },
  infoActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    marginBottom: 20
  },
  infoPrimaryButton: {
    flex: 1,
    backgroundColor: '#ff6b6b',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center'
  },
  infoPrimaryButtonLabel: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    fontFamily: 'vrtlfinal'
  },
  infoSecondaryButton: {
    flex: 1,
    backgroundColor: '#252525',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a3a3a'
  },
  infoSecondaryButtonLabel: {
    color: '#ffdc82',
    fontWeight: '600',
    fontSize: 16,
    fontFamily: 'vrtlfinal'
  },
  infoStatsLabel: {
    marginTop: 14,
    color: '#8e8e92',
    fontSize: 12,
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  challengeSection: {
    marginBottom: 18,
    backgroundColor: '#181818',
    borderRadius: 20,
    padding: 16,
    gap: 12
  },
  challengeHeading: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  challengeDate: {
    color: '#ff9f6b',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  challengeSubtitle: {
    color: '#bbbbbb',
    fontSize: 14,
    fontFamily: 'vrtlfinal'
  },
  challengePromptList: {
    flexDirection: 'column',
    gap: 8
  },
  challengePromptAnimated: {
    borderRadius: 14
  },
  challengePromptButton: {
    backgroundColor: '#242424',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ff9f6b30',
    shadowColor: '#ff9f6b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4
  },
  challengePromptButtonDisabled: {
    backgroundColor: '#151515',
    borderColor: '#333',
    shadowOpacity: 0,
    elevation: 0,
    opacity: 0.65
  },
  challengePromptText: {
    color: '#ffdc82',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  challengePromptTextDisabled: {
    color: '#777',
    fontFamily: 'vrtlfinal'
  },
  mysteryPromptButton: {
    borderColor: '#9C27B0',
    borderWidth: 3,
    backgroundColor: '#1a0a2e'
  },
  mysteryPromptText: {
    color: '#9C27B0',
    fontWeight: '700'
  },
  challengeConfirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  challengeConfirmCard: {
    width: '100%',
    maxWidth: screenWidth > 768 ? 640 : 360,
    backgroundColor: '#151515',
    borderRadius: 22,
    padding: 22,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a'
  },
  challengeConfirmTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  challengeConfirmTitle: {
    color: '#ffdc82',
    fontSize: 22,
    fontWeight: '700'
  },
  challengeConfirmEmoji: {
    fontSize: 32,
    color: '#ff9f6b'
  },
  challengeConfirmPromptLabel: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600'
  },
  challengeConfirmSubtitle: {
    color: '#d9d9d9',
    fontSize: 15
  },
  challengeConfirmWarning: {
    color: '#ff6b6b',
    fontSize: 14,
    fontWeight: '600'
  },
  challengeConfirmHint: {
    color: '#bbbbbb',
    fontSize: 14
  },
  notificationPrompt: {
    marginTop: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#1a1f2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3f5f'
  },
  notificationPromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8
  },
  notificationPromptIcon: {
    fontSize: 24
  },
  notificationPromptTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff'
  },
  notificationPromptMessage: {
    fontSize: 14,
    color: '#a0a0a0',
    lineHeight: 20,
    marginBottom: 12
  },
  notificationPromptActions: {
    flexDirection: 'row',
    gap: 8
  },
  notificationPromptButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  notificationPromptSkip: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#3a3a3a'
  },
  notificationPromptSkipText: {
    color: '#888888',
    fontSize: 14,
    fontWeight: '600'
  },
  notificationPromptEnable: {
    backgroundColor: '#4a9eff',
    borderWidth: 1,
    borderColor: '#5aadff'
  },
  notificationPromptEnableText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600'
  },
  challengeConfirmGallery: {
    marginTop: 8,
    gap: 8
  },
  challengeConfirmGalleryHeading: {
    color: '#ffdc82',
    fontSize: 14,
    fontWeight: '600'
  },
  challengeConfirmSpinner: {
    paddingVertical: 12
  },
  challengeConfirmImageScroll: {
    maxHeight: screenWidth > 768 ? 680 : 420
  },
  challengeConfirmImageList: {
    gap: 8,
    paddingVertical: 0
  },
  challengeConfirmPreviewWrapper: {
    width: '100%'
  },
  challengeConfirmPreviewAnimated: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#030303',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ffdc8230',
    alignItems: 'center',
    justifyContent: 'center'
  },
  challengeConfirmPreviewImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: 'transparent'
  },
  challengeConfirmPreviewPlaceholder: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  challengeConfirmPreviewPlaceholderLabel: {
    color: '#666',
    fontSize: 14
  },
  challengeConfirmMessage: {
    color: '#a5a5a5',
    fontSize: 13
  },
  challengeConfirmActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8
  },
  challengeConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  challengeConfirmCancel: {
    backgroundColor: '#242424',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a3a3a'
  },
  challengeConfirmPrimary: {
    backgroundColor: '#ff6b6b'
  },
  challengeConfirmCancelLabel: {
    color: '#dcdcdc',
    fontWeight: '600'
  },
  challengeConfirmPrimaryLabel: {
    color: '#fff',
    fontWeight: '700'
  },
  infoLanguageRow: {
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 12,
    paddingHorizontal: 12
  },
  infoLanguageButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#1f1f1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f'
  },
  infoLanguageButtonActive: {
    backgroundColor: '#ff9f6b33',
    borderColor: '#ff9f6b'
  },
  infoLanguageFlag: {
    fontSize: 20
  },
  infoLanguageFlagActive: {
    transform: [{ scale: 1.08 }],
    color: '#ffdc82'
  },
  infoParagraph: {
    color: '#d6d6d6',
    lineHeight: 22,
    marginBottom: 12,
    fontFamily: 'vrtlfinal'
  },
  infoTips: {
    marginTop: 8,
    borderTopColor: '#1f1f1f',
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 12
  },
  infoTip: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#181818',
    borderRadius: 16,
    padding: 12
  },
  infoTipIcon: {
    fontSize: 22
  },
  infoTipText: {
    flex: 1
  },
  infoTipTitle: {
    color: '#fff',
    fontWeight: '600',
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  infoTipDetail: {
    color: '#bcbcbc',
    lineHeight: 20,
    fontFamily: 'vrtlfinal'
  },
  infoFooter: {
    marginTop: 16,
    color: '#ff9f6b',
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  exportOptionsOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)'
  },
  exportOptionsBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
  },
  exportOptionsPanel: {
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 24,
    width: '85%',
    maxWidth: 400,
    gap: 12,
    borderWidth: 1,
    borderColor: '#333'
  },
  exportOptionsTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 4
  },
  exportOptionsSubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 12
  },
  exportOptionButton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: '#3a3a3a'
  },
  exportOptionIcon: {
    fontSize: 28
  },
  exportOptionLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    flex: 1
  },
  exportOptionCancelButton: {
    backgroundColor: '#1a1a1a',
    borderColor: '#444',
    marginTop: 8
  },
  exportOptionCancelLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ff6b6b',
    textAlign: 'center',
    flex: 1
  },
  multiplayerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff9f6b',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 30,
    shadowColor: '#ff9f6b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8
  },
  multiplayerButtonIcon: {
    fontSize: 24,
    marginRight: 8
  },
  multiplayerButtonTitle: {
    color: '#000',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5
  },
  multiplayerActiveCount: {
    color: '#888',
    fontSize: 13,
    marginTop: 12,
    fontWeight: '500'
  },
  // Animation Modal Styles
  animationModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  animationModalCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 500,
    borderWidth: 1,
    borderColor: '#333'
  },
  animationModalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: 'vrtlfinal'
  },
  animationTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  animationTypeButtonIcon: {
    fontSize: 32,
    marginRight: 16
  },
  animationTypeButtonTextContainer: {
    flex: 1
  },
  animationTypeButtonTitle: {
    color: '#000',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  animationTypeButtonSubtitle: {
    color: '#000',
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.7
  },
  animationAboutSection: {
    marginTop: 8,
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222'
  },
  animationAboutTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    fontFamily: 'vrtlfinal'
  },
  animationAboutText: {
    fontSize: 13,
    color: '#aaa',
    lineHeight: 20,
    marginBottom: 8
  },
  animationModalCloseButton: {
    backgroundColor: '#333',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444'
  },
  animationModalCloseButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  // Wording Mode Overlay Styles
  // (Letter watermark now rendered inside CanvasViewport to support zoom)
  wordingTimerOverlay: {
    position: 'absolute',
    bottom: 150,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 10,
    padding: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)'
  },
  wordingTimerBox: {
    alignItems: 'center',
    gap: 2
  },
  wordingTimerLabel: {
    fontSize: 9,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  wordingTimerValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    fontVariant: ['tabular-nums']
  },
  wordingDoneButton: {
    position: 'absolute',
    top: -32,
    right: 0,
    backgroundColor: '#4a9eff',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  wordingDoneButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  wordingTimerCloseButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 10
  },
  wordingTimerCloseIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 14
  },
  wordingProgressOverlay: {
    position: 'absolute',
    bottom: 150,
    left: 20,
    right: 120,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)'
  },
  wordingProgressContainer: {
    gap: 8
  },
  wordingProgressTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 2
  },
  wordingProgressBubbles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center'
  },
  wordingProgressBubble: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center'
  },
  wordingProgressBubblePainting: {
    backgroundColor: '#3a5a8a',
    borderColor: '#5a8aca'
  },
  wordingProgressBubbleExporting: {
    backgroundColor: '#8a6a3a',
    borderColor: '#ca9a5a'
  },
  wordingProgressBubbleComplete: {
    backgroundColor: '#3a8a5a',
    borderColor: '#5aca8a'
  },
  wordingProgressBubbleText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#888'
  },
  wordingProgressBubbleTextComplete: {
    color: '#fff'
  },
  wordingTransitionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)'
  },
  wordingTransitionBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 32,
    paddingHorizontal: 48,
    borderWidth: 2,
    borderColor: '#5a8aca',
    shadowColor: '#5a8aca',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20
  },
  wordingTransitionText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 1
  },
  // Resume Modal Styles
  resumeModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10001
  },
  resumeModalContainer: {
    width: Math.min(screenWidth * 0.85, 420),
    backgroundColor: 'rgba(26, 26, 26, 0.95)',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#ff9f6b',
    shadowColor: '#ff9f6b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20
  },
  resumeModalTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  resumeModalSubtitle: {
    fontSize: 16,
    fontWeight: '400',
    color: '#aaa',
    marginBottom: 32,
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  resumeModalButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2
  },
  resumeModalButtonDestruct: {
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    borderColor: '#ff3b30'
  },
  resumeModalButtonPrimary: {
    backgroundColor: 'rgba(52, 199, 89, 0.15)',
    borderColor: '#34c759'
  },
  resumeModalButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'vrtlfinal'
  },
  // Frame-by-frame controls styles
  frameControlsOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    flexDirection: 'column-reverse',
    backgroundColor: '#000',
    paddingBottom: IS_IPAD ? 20 : 10,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16
  },
  frameTimelineContainer: {
    backgroundColor: 'transparent',
    paddingBottom: 8
  },
  frameControlsRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  frameControlButtonsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: IS_IPAD ? 12 : 8,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0
  },
  frameControlButton: {
    width: IS_IPAD ? 56 : 40,
    height: IS_IPAD ? 56 : 40,
    borderRadius: IS_IPAD ? 28 : 20,
    backgroundColor: 'rgba(50,50,50,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#666'
  },
  frameControlButtonPlay: {
    backgroundColor: 'rgba(76,175,80,0.9)',
    borderColor: '#4CAF50'
  },
  frameControlButtonActive: {
    backgroundColor: 'rgba(76,175,80,0.9)',
    borderColor: '#4CAF50'
  },
  frameControlButtonText: {
    fontSize: IS_IPAD ? 24 : 18
  },
  frameControlDeleteStack: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: IS_IPAD ? 56 : 40
  },
  frameControlAllButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 1,
    borderColor: '#fff'
  },
  frameControlAllButtonText: {
    color: '#fff',
    fontFamily: 'vrtlfinal',
    fontSize: 12,
    letterSpacing: 1.5
  },
  playbackSlidersContainer: {
    position: 'absolute',
    top: 130,
    left: 20,
    right: 20,
    flexDirection: 'row',
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20
  },
  playbackSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: IS_IPAD ? 180 : 140
  },
  playbackSliderLabel: {
    color: '#ffdc82',
    fontSize: IS_IPAD ? 11 : 9,
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal',
    marginRight: 4,
    minWidth: IS_IPAD ? 40 : 35
  },
  playbackSlider: {
    flex: 1,
    height: 24
  },
  frameCounterBox: {
    backgroundColor: 'rgba(50,50,50,0.9)',
    paddingHorizontal: IS_IPAD ? 14 : 10,
    paddingVertical: IS_IPAD ? 10 : 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#666'
  },
  frameCounterText: {
    color: '#fff',
    fontSize: IS_IPAD ? 16 : 12,
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal'
  },
  frameTimeline: {
    flexGrow: 0
  },
  frameTimelineContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    gap: IS_IPAD ? 16 : 12,
    backgroundColor: 'transparent'
  },
  frameThumb: {
    alignItems: 'center'
  },
  frameThumbActive: {
    transform: [{ scale: 1.15 }]
  },
  frameThumbInner: {
    width: IS_IPAD ? 64 : 48, // Square thumbnails (optimized smaller size)
    height: IS_IPAD ? 64 : 48,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#666',
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
    position: 'relative'
  },
  frameThumbImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0
  },
  frameThumbNumber: {
    color: '#fff',
    fontSize: IS_IPAD ? 10 : 8, // Really small number
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal',
    position: 'absolute',
    top: 2,
    left: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden'
  }
});

export default PaintScreen;
