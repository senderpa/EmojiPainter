// @ts-nocheck - Legacy code with complex types
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Image, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Slider from '@react-native-community/slider';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import JSZip from 'jszip';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireNativeModule } from 'expo-modules-core';

import { generatePreviewFrames, exportTimelapse, exportGif, exportWebM, addExportProgressListener, cancelExport } from '../native/timelapse';
import { resolveSmudgeTilesFromFiles } from '../lib/smudge/skiaOffscreenRender';
import { BASE_FONT_FAMILY } from '../theme/fontConfig';
import type { RootStackParamList } from '../App';
import { usePainting } from '../state/PaintingContext';
import type { Stroke } from '../state/PaintingContext';
import TransparentEmojiCanvas from '../components/TransparentEmojiCanvas';
import { buildTimelineData, PlaybackMode, getModeDuration, createSnapshot } from '../lib/timelapse';
import AnimatedLoader from '../components/AnimatedLoader';
import { markFirstExport } from '../lib/ratingTracker';
import { emitAppEvent } from '../lib/appEvents';
import { addVideoToStorage } from '../video/videoStorage';
import { CustomOverlayHelper } from '../components/CustomOverlay';
import { useHelperMode } from '../tutorial/useHelperMode';
import HelperLabel, { HelperRing } from '../tutorial/HelperLabel';
import ButtonGlow from '../tutorial/ButtonGlow';

// ============================================================================
// Adaptive Resampling (matches EmojiCanvas.tsx behavior)
// ============================================================================

const MIN_RESAMPLE_SPACING = 0.03;
const RESAMPLE_CURVATURE_THRESHOLD = 0.95;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

const resolveResampleSpacing = (stroke: Stroke): number => {
  const span = Math.max(1, stroke.stampSpan ?? stroke.size * 1.1);
  const normalized = typeof stroke.spacing === 'number' ? clamp01(stroke.spacing) : 0.12;
  const base = span * 0.06;
  const extra = span * (0.18 * normalized + 0.02);
  return Math.max(MIN_RESAMPLE_SPACING, base + extra);
};

const distanceSq = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const curvatureCosine = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const abLen = Math.hypot(abx, aby);
  const bcLen = Math.hypot(bcx, bcy);
  if (abLen === 0 || bcLen === 0) return 1;
  return (abx * bcx + aby * bcy) / (abLen * bcLen);
};

const adaptiveResamplePoints = <T extends { x: number; y: number }>(points: T[], minSpacing: number): T[] => {
  if (points.length <= 2) {
    return points;
  }
  const spacing = Math.max(MIN_RESAMPLE_SPACING, minSpacing);
  const spacingSq = spacing * spacing;
  const result: T[] = [points[0]];
  let lastKept = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    if (distanceSq(current, lastKept) >= spacingSq) {
      result.push(current);
      lastKept = current;
      continue;
    }
    const next = points[i + 1];
    if (curvatureCosine(lastKept, current, next) < RESAMPLE_CURVATURE_THRESHOLD) {
      result.push(current);
      lastKept = current;
    }
  }
  result.push(points[points.length - 1]);
  return result;
};

// ============================================================================

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// Configuration constants
const MIN_PLAYER_SIZE = 240;
const PREVIEW_SIZE = 400; // Preview player size (keep small for performance)
const PNG_EXPORT_SIZE = 8192; // Ultra-high-resolution PNG exports (8K) for emoji quality preservation
const GIF_EXPORT_SIZE = 512; // GIF export size
const VIDEO_EXPORT_SIZE = 4096; // MP4/MOV export size - maximum quality
const MP4_SIZE_HD = 4096; // Maximum quality 4K export
const VIDEO_STORAGE_PREVIEW_SIZE = 128;
const VIDEO_STORAGE_PREVIEW_FPS = 24;
const MIN_FPS = 1;
const MAX_FPS = 60;
const DEFAULT_FPS = 12;
const DEFAULT_HOLD_SECONDS = 1;
const CHUNK_SIZE_PNG = 15;
const MEMORY_WARNING_THRESHOLD_MB = 400;
const MEMORY_WARNING_FRAME_COUNT = 200;

const celebrationEmojis = ['🎉', '🎊', '✨', '🥳', '🌟', '💥', '🎈'];

const DEFAULT_TIMELAPSE_SETTINGS = {
  speedMultiplier: 10,
  playbackMode: 'simultaneous' as PlaybackMode,
  limitTo30s: false,
  holdLastFrameSeconds: 0, // No hold when ping-pong is enabled
  pingPongMode: true, // Enable ping-pong loop: forward → reverse → repeat
  reverseMode: false // Start from full drawing and go backwards to empty
};

// Utility: normalize strokes from the logical canvas size into the export render size.
// This keeps exports device-independent and guarantees we always render the full canvas.
const scaleStrokesForExport = (input: Stroke[], targetSize: number, sourceSize: number): Stroke[] => {
  if (!Number.isFinite(sourceSize) || sourceSize <= 0) {
    return input;
  }
  const scale = targetSize / sourceSize;
  if (Math.abs(scale - 1) < 0.0001) {
    return input;
  }

  return input.map((stroke) => ({
    ...stroke,
    size: stroke.size * scale,
    spacing: typeof stroke.spacing === 'number' ? stroke.spacing * scale : stroke.spacing,
    stampSpan: typeof stroke.stampSpan === 'number' ? stroke.stampSpan * scale : stroke.stampSpan,
    planeCorners: stroke.planeCorners ? {
      topLeft: { x: stroke.planeCorners.topLeft.x * scale, y: stroke.planeCorners.topLeft.y * scale },
      topRight: { x: stroke.planeCorners.topRight.x * scale, y: stroke.planeCorners.topRight.y * scale },
      bottomRight: { x: stroke.planeCorners.bottomRight.x * scale, y: stroke.planeCorners.bottomRight.y * scale },
      bottomLeft: { x: stroke.planeCorners.bottomLeft.x * scale, y: stroke.planeCorners.bottomLeft.y * scale }
    } : stroke.planeCorners,
    planeCornerHistory: stroke.planeCornerHistory
      ? stroke.planeCornerHistory.map(snapshot => ({
        topLeft: { x: snapshot.topLeft.x * scale, y: snapshot.topLeft.y * scale },
        topRight: { x: snapshot.topRight.x * scale, y: snapshot.topRight.y * scale },
        bottomRight: { x: snapshot.bottomRight.x * scale, y: snapshot.bottomRight.y * scale },
        bottomLeft: { x: snapshot.bottomLeft.x * scale, y: snapshot.bottomLeft.y * scale },
        timestamp: snapshot.timestamp
      }))
      : stroke.planeCornerHistory,
    bakedBounds: stroke.bakedBounds ? {
      x: stroke.bakedBounds.x * scale,
      y: stroke.bakedBounds.y * scale,
      w: stroke.bakedBounds.w * scale,
      h: stroke.bakedBounds.h * scale
    } : stroke.bakedBounds,
    points: stroke.points.map((point) => ({
      ...point,
      x: point.x * scale,
      y: point.y * scale,
      w: typeof point.w === 'number' ? point.w * scale : point.w
    }))
  }));
};

// Abort translations in 8 languages
const abortTranslations = [
  '❎ Abort',        // English
  '❎ Abortar',     // Spanish/Portuguese
  '❎ Annuler',     // French
  '❎ Abbrechen',   // German
  '❎ Annulla',     // Italian
  '❎ 中止',         // Japanese
  '❎ 取消',         // Chinese
  '❎ Отменить',    // Russian
];

type CelebrationState = { id: number; message: string } | null;
type ExportFormat = 'gif' | 'mp4' | 'png' | 'zip';

interface ExportState {
  active: boolean;
  format: ExportFormat | null;
  status: string;
  progress: { current: number; total: number } | null;
}

// Typewriter abort button component
const TypewriterAbortButton: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const [currentLangIndex, setCurrentLangIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    const fullText = abortTranslations[currentLangIndex];

    if (isTyping) {
      // Typewriter effect
      let charIndex = 0;
      const typeInterval = setInterval(() => {
        if (charIndex < fullText.length) {
          setDisplayedText(fullText.substring(0, charIndex + 1));
          charIndex++;
        } else {
          clearInterval(typeInterval);
          setIsTyping(false);
          // Wait 3 seconds before switching to next language
          setTimeout(() => {
            setIsTyping(true);
            setCurrentLangIndex((prev) => (prev + 1) % abortTranslations.length);
          }, 3000);
        }
      }, 100); // 100ms per character

      return () => clearInterval(typeInterval);
    }
  }, [currentLangIndex, isTyping]);

  return (
    <TouchableOpacity style={styles.exportAbortButton} onPress={onPress}>
      <Text style={styles.exportAbortButtonText}>{displayedText}</Text>
    </TouchableOpacity>
  );
};

// Lazy load EmojisprayBridge - only when needed
let EmojisprayBridge: any = null;
const getEmojisprayBridge = () => {
  if (EmojisprayBridge === null) {
    try {
      EmojisprayBridge = requireNativeModule('EmojisprayBridge');
      console.log('[TimelapseScreen] EmojisprayBridge loaded successfully');
    } catch (error) {
      console.log('[TimelapseScreen] EmojisprayBridge not available:', error);
      EmojisprayBridge = undefined; // Mark as unavailable
    }
  }
  return EmojisprayBridge;
};

// Celebration overlay component
const CelebrationOverlay: React.FC<{ state: CelebrationState }> = ({ state }) => {
  const drops = useMemo(() => {
    if (!state) return [];
    return Array.from({ length: 8 }).map((_, index) => {
      const anim = new Animated.Value(0);
      return {
        key: `${state.id}-${index}`,
        anim,
        left: Math.random(),
        horizontal: (Math.random() - 0.5) * 80,
        start: -60 - Math.random() * 20,
        end: 160 + Math.random() * 60,
        rotateStart: (Math.random() - 0.5) * 30,
        rotateEnd: (Math.random() - 0.5) * 40,
        emoji: celebrationEmojis[Math.floor(Math.random() * celebrationEmojis.length)],
        delay: Math.random() * 300,
      };
    });
  }, [state]);

  useEffect(() => {
    drops.forEach((drop) => {
      Animated.timing(drop.anim, {
        toValue: 1,
        duration: 1400 + Math.random() * 600,
        delay: drop.delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    });
  }, [drops]);

  if (!state) return null;

  return (
    <View pointerEvents="none" style={styles.celebrationContainer}>
      <View style={styles.celebrationMessageBubble}>
        <Text style={styles.celebrationMessageText}>{state.message}</Text>
      </View>
      {drops.map((drop) => (
        <Animated.Text
          key={drop.key}
          style={[
            styles.celebrationEmoji,
            {
              left: `${drop.left * 100}%`,
              transform: [
                { translateX: drop.anim.interpolate({ inputRange: [0, 1], outputRange: [0, drop.horizontal] }) },
                { translateY: drop.anim.interpolate({ inputRange: [0, 1], outputRange: [drop.start, drop.end] }) },
                { rotate: drop.anim.interpolate({ inputRange: [0, 1], outputRange: [`${drop.rotateStart}deg`, `${drop.rotateEnd}deg`] }) },
              ],
              opacity: drop.anim.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
            },
          ]}
        >
          {drop.emoji}
        </Animated.Text>
      ))}
    </View>
  );
};

// FPS slider conversion helpers
const fpsToSlider = (fps: number, minFps: number, maxFps: number) => {
  const safeMax = Math.max(minFps, maxFps);
  if (safeMax <= minFps) return 0;
  const clamped = Math.min(safeMax, Math.max(minFps, fps));
  const ratio = safeMax / minFps;
  if (ratio <= 1) return 0;
  return Math.log(clamped / minFps) / Math.log(ratio);
};

const sliderToFps = (value: number, minFps: number, maxFps: number) => {
  const safeMax = Math.max(minFps, maxFps);
  if (safeMax <= minFps) return minFps;
  const ratio = safeMax / minFps;
  return minFps * Math.pow(ratio, Math.min(1, Math.max(0, value)));
};

const SPEED_WORDS = [
  'speed',
  'tempo',
  'geschwindigkeit',
  'velocidad',
  'скорость',
  '速度',
  '속도',
  'vitesse',
  'velocità',
  'rapidez',
  'سرعة',
  'गति',
  'hız',
  'скорость',
  'ritmo'
];

const SPEED_GLITCH_CHARS = ['*', '#', '~', '░', '▓', '✶', '¿', '¡', '/', '\\', '|', '^'];
const HOLD_WORDS = [
  'hold last frame',
  'halte letztes bild',
  'mantén último cuadro',
  '維持最後畫面',
  '保持最后画面',
  '마지막 프레임 유지',
  'maintenir dernier plan',
  'mantieni l’ultimo frame',
  'mantém o quadro final',
  'احتفظ بالإطار الأخير',
  'अंतिम फ़्रेम रोकें',
  'son kareyi tut',
  'último frame',
  'houding laatste beeld',
  'держи последний кадр'
];


const TIMELAPSE_KEYS = ['close', 'timelapse_export', 'playback_sequential', 'playback_simultaneous', 'playback_historical'];

const TimelapseScreen: React.FC = () => {
  console.log('[TimelapseScreen] Component rendering');
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'Timelapse'>>();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { strokes: contextStrokes } = usePainting();
  const { activeHelperKey, glowCounters, triggerHelper, tutorialModeEnabled, helperModeEnabled } = useHelperMode({ keys: TIMELAPSE_KEYS });

  // State
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingPhase, setLoadingPhase] = useState(''); // Show what's being loaded
  const [preloadedFrames, setPreloadedFrames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [timelineReady, setTimelineReady] = useState(false); // Timeline data fully computed

  // Playback state - defaults will be overridden by persisted values
  const [isPlaying, setPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(DEFAULT_TIMELAPSE_SETTINGS.speedMultiplier); // default 10x speed for first visit
  const [speedTypeLabel, setSpeedTypeLabel] = useState('speed');
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(DEFAULT_TIMELAPSE_SETTINGS.playbackMode); // Playback animation mode - default to simultaneous
  const [limitTo30s, setLimitTo30s] = useState(DEFAULT_TIMELAPSE_SETTINGS.limitTo30s); // Toggle for limiting export to 30s max
  const [holdLastFrameSeconds, setHoldLastFrameSeconds] = useState(DEFAULT_TIMELAPSE_SETTINGS.holdLastFrameSeconds); // Hold last frame duration
  const [pingPongMode, setPingPongMode] = useState(DEFAULT_TIMELAPSE_SETTINGS.pingPongMode); // Ping-pong mode: play forward, hold, play backward, repeat
  const [reverseMode, setReverseMode] = useState(DEFAULT_TIMELAPSE_SETTINGS.reverseMode); // Reverse mode: start from full drawing and go backwards
  const [currentTime, setCurrentTime] = useState(0);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isModeSwitching, setIsModeSwitching] = useState(false); // Prevent crashes during mode switch
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showMovOptions, setShowMovOptions] = useState(false);
  const [movFilePath, setMovFilePath] = useState<string | null>(null);
  const [movFileIsTemp, setMovFileIsTemp] = useState(false);
  const [showPngQualityOptions, setShowPngQualityOptions] = useState(false);
  const [showPngOptions, setShowPngOptions] = useState(false);
  const [pngFilePath, setPngFilePath] = useState<string | null>(null);
  const [pngExportSize, setPngExportSize] = useState<2048 | 4096 | 8192 | 16384>(8192);

  // Debug PNG quality modal visibility
  useEffect(() => {
    console.log('[PNG Export] Quality modal state changed:', showPngQualityOptions);
  }, [showPngQualityOptions]);

  // Auto-pause after idle to reduce memory pressure
  const lastInteractionRef = useRef<number>(Date.now());
  const autoPauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedTypeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedWordIndexRef = useRef(0);
  const holdWordIndexRef = useRef(0);
  const holdLabelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holdLabelText, setHoldLabelText] = useState(HOLD_WORDS[0]);

  // Refs for animation values to avoid restarting animation when they change
const holdLastFrameSecondsRef = useRef(holdLastFrameSeconds);
const pingPongModeRef = useRef(pingPongMode);
const reverseModeRef = useRef(reverseMode);
const animationDirectionRef = useRef(1); // 1 = forward, -1 = reverse (for ping-pong)

  // Update refs when values change (doesn't restart animation)
  useEffect(() => {
    holdLastFrameSecondsRef.current = holdLastFrameSeconds;
  }, [holdLastFrameSeconds]);

  useEffect(() => {
    pingPongModeRef.current = pingPongMode;
    // Set direction based on reverseMode when ping-pong mode changes
    animationDirectionRef.current = reverseModeRef.current ? -1 : 1;
  }, [pingPongMode]);

  useEffect(() => {
    reverseModeRef.current = reverseMode;
    // When reverse mode is enabled/disabled, restart from appropriate position
    // Only update if playbackDurationMs is valid (> 0)
    if (playbackDurationMs > 0) {
      if (reverseMode) {
        // Start from end when enabling reverse mode (both normal and ping-pong)
        setCurrentTime(playbackDurationMs);
        animationDirectionRef.current = -1; // Go backward
      } else {
        // Start from beginning when disabling reverse mode (both normal and ping-pong)
        setCurrentTime(0);
        animationDirectionRef.current = 1; // Go forward
      }
    }
  }, [reverseMode, playbackDurationMs]);

  // Reset direction based on reverseMode when playback loops
  // CRITICAL: Don't force direction=1 if reverseMode is enabled
  useEffect(() => {
    if (currentTime === 0 && !reverseModeRef.current) {
      animationDirectionRef.current = 1;
    } else if (currentTime === playbackDurationMs && reverseModeRef.current) {
      animationDirectionRef.current = -1;
    }
  }, [currentTime, playbackDurationMs]);

  // CRITICAL FIX: Dynamic max speed to GUARANTEE minimum 1-second output video
  // Formula: maxSpeed = timelineDuration / minOutputDuration
  // This ensures: outputDuration = timelineDuration / maxSpeed >= minOutputDuration
  // Examples:
  //   - 10s timeline → max 10x speed → output = 10s/10x = 1.0s ✓
  //   - 100s timeline → max 100x speed → output = 100s/100x = 1.0s ✓
  //   - 1000s timeline (LOTS of strokes) → max 1000x speed → output = 1000s/1000x = 1.0s ✓
  //   - 0.5s timeline (few strokes) → max 0.5x speed → output = 0.5s/0.5x = 1.0s ✓
  const maxSpeedValue = useMemo(() => {
    const MIN_OUTPUT_VIDEO_DURATION = 1.0; // Target: always allow compressing to 1s
    const MIN_SPEED_MULTIPLIER = 0.01;
    const MINIMUM_CAP = 100; // Minimum slider range (always allow at least 100x) - INCREASED from 30x

    if (!Number.isFinite(playbackDurationMs) || playbackDurationMs <= 0) {
      console.log(`[Speed Slider] ⚠️ Invalid duration (${playbackDurationMs}ms), using MINIMUM_CAP: ${MINIMUM_CAP}x`);
      return MINIMUM_CAP;
    }

    const timelineDurationSeconds = Math.max(0.001, playbackDurationMs / 1000);
    const calculatedMax = timelineDurationSeconds / MIN_OUTPUT_VIDEO_DURATION;

    // Dynamic max with NO UPPER CAP - if you have 10000s of strokes, you can use 10000x speed!
    const dynamicMax = Math.max(MIN_SPEED_MULTIPLIER, calculatedMax);

    // Always allow at least MINIMUM_CAP (100x), but go as high as needed for 1s output
    const finalMax = Math.max(MINIMUM_CAP, dynamicMax);

    console.log(`🚀 [DYNAMIC SPEED SLIDER] Timeline: ${timelineDurationSeconds.toFixed(2)}s → Calculated: ${calculatedMax.toFixed(2)}x → Final Max: ${finalMax.toFixed(2)}x (allows compression to ${(timelineDurationSeconds / finalMax).toFixed(2)}s min output)`);

    return finalMax;
  }, [playbackDurationMs]);

  // Clamp speed multiplier when max decreases
  useEffect(() => {
    if (speedMultiplier > maxSpeedValue) {
      setSpeedMultiplier(maxSpeedValue);
    }
  }, [maxSpeedValue, speedMultiplier]);

  // Animated speed label typewriter (🐌)
  useEffect(() => {
    let cancelled = false;

    const clearSpeedTimeout = () => {
      if (speedTypeTimeoutRef.current) {
        clearTimeout(speedTypeTimeoutRef.current);
        speedTypeTimeoutRef.current = null;
      }
    };

    const schedule = (fn: () => void, delay: number) => {
      if (cancelled) {
        return;
      }
      clearSpeedTimeout();
      speedTypeTimeoutRef.current = setTimeout(fn, delay);
    };

    const startTypingCycle = () => {
      if (cancelled) {
        return;
      }
      const word = SPEED_WORDS[speedWordIndexRef.current % SPEED_WORDS.length];
      const target = word.toUpperCase();
      let step = 0;

      const typeNext = () => {
        if (cancelled) {
          return;
        }
        if (step < target.length) {
          const glitchActive = Math.random() < 0.45;
          const glitchChar = SPEED_GLITCH_CHARS[Math.floor(Math.random() * SPEED_GLITCH_CHARS.length)];
          setSpeedTypeLabel(`${target.slice(0, step)}${glitchActive ? glitchChar : ''}`);
          step += 1;
          const delay = 30 + Math.random() * 90;
          schedule(typeNext, delay);
        } else {
          setSpeedTypeLabel(target);
          const holdDuration = 400 + Math.random() * 1600;
          schedule(() => {
            const scrambleIterations = 2 + Math.floor(Math.random() * 3);
            let iteration = 0;

            const scramble = () => {
              if (cancelled) {
                return;
              }
              if (iteration < scrambleIterations) {
                const scrambled = target
                  .split('')
                  .map((char) => (Math.random() < 0.5 ? SPEED_GLITCH_CHARS[Math.floor(Math.random() * SPEED_GLITCH_CHARS.length)] : char))
                  .join('');
                setSpeedTypeLabel(scrambled);
                iteration += 1;
                schedule(scramble, 60 + Math.random() * 120);
              } else {
                speedWordIndexRef.current = (speedWordIndexRef.current + 1) % SPEED_WORDS.length;
                schedule(startTypingCycle, 80 + Math.random() * 200);
              }
            };

            scramble();
          }, holdDuration);
        }
      };

      typeNext();
    };

    startTypingCycle();

    return () => {
      cancelled = true;
      clearSpeedTimeout();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const clearHoldTimeout = () => {
      if (holdLabelTimeoutRef.current) {
        clearTimeout(holdLabelTimeoutRef.current);
        holdLabelTimeoutRef.current = null;
      }
    };

    const schedule = (fn: () => void, delay: number) => {
      if (cancelled) {
        return;
      }
      clearHoldTimeout();
      holdLabelTimeoutRef.current = setTimeout(fn, delay);
    };

    const cycleHoldWord = () => {
      if (cancelled) {
        return;
      }
      holdWordIndexRef.current = (holdWordIndexRef.current + 1) % HOLD_WORDS.length;
      setHoldLabelText(HOLD_WORDS[holdWordIndexRef.current]);
      schedule(cycleHoldWord, 15000 + Math.random() * 5000);
    };

    schedule(cycleHoldWord, 15000);

    return () => {
      cancelled = true;
      clearHoldTimeout();
    };
  }, []);

  // Cycle through 7 different export button animations
  useEffect(() => {
    const runAnimation = () => {
      exportAnimValue.setValue(0);
      Animated.timing(exportAnimValue, {
        toValue: 1,
        duration: EXPORT_ANIM_DURATION,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true
      }).start(() => {
        // Move to next animation style
        exportAnimationIndexRef.current = (exportAnimationIndexRef.current + 1) % EXPORT_ANIM_STYLES;
        runAnimation();
      });
    };

    runAnimation();

    return () => {
      exportAnimValue.stopAnimation();
    };
  }, [exportAnimValue, EXPORT_ANIM_DURATION, EXPORT_ANIM_STYLES]);

  // Compute export button animated style based on current animation index
  const getExportButtonAnimatedStyle = useCallback(() => {
    const index = exportAnimationIndexRef.current;

    switch (index) {
      case 0: // Glowing (opacity pulse)
        return {
          opacity: exportAnimValue.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0.7, 1, 0.7]
          }),
          shadowOpacity: exportAnimValue.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0.3, 0.9, 0.3]
          })
        };

      case 1: // Bouncing scale
        return {
          transform: [{
            scale: exportAnimValue.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [1, 1.15, 1]
            })
          }]
        };

      case 2: // Move left-right
        return {
          transform: [{
            translateX: exportAnimValue.interpolate({
              inputRange: [0, 0.25, 0.75, 1],
              outputRange: [0, -4, 4, 0]
            })
          }]
        };

      case 3: // Jump up-down
        return {
          transform: [{
            translateY: exportAnimValue.interpolate({
              inputRange: [0, 0.3, 0.5, 0.7, 1],
              outputRange: [0, -6, 0, -3, 0]
            })
          }]
        };

      case 4: // Glitch (rapid micro-movements)
        return {
          transform: [
            {
              translateX: exportAnimValue.interpolate({
                inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
                outputRange: [0, 2, -2, 1, -1, 0, -2, 2, -1, 1, 0]
              })
            },
            {
              translateY: exportAnimValue.interpolate({
                inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
                outputRange: [0, -1, 1, -2, 2, 0, 1, -1, 2, -2, 0]
              })
            }
          ]
        };

      case 5: // Vibrate (high-frequency shake)
        return {
          transform: [{
            rotate: exportAnimValue.interpolate({
              inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
              outputRange: ['0deg', '2deg', '-2deg', '2deg', '-2deg', '0deg', '-1deg', '1deg', '-1deg', '1deg', '0deg']
            })
          }]
        };

      case 6: // Pulse scale with rotation
        return {
          transform: [
            {
              scale: exportAnimValue.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [1, 1.1, 1]
              })
            },
            {
              rotate: exportAnimValue.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: ['0deg', '5deg', '0deg']
              })
            }
          ]
        };

      default:
        return {};
    }
  }, [exportAnimValue]);

  // Export state
  const [exportState, setExportState] = useState<ExportState>({
    active: false,
    format: null,
    status: '',
    progress: null,
  });
  const [exportProgress, setExportProgress] = useState(0); // 0-100 for AnimatedLoader
  const exportCancelRef = useRef(false);
  const wasPlayingBeforeExportRef = useRef(false); // Track if was playing before export
  const autoExportTriggeredRef = useRef(false); // Prevent double auto-export trigger

  // Export options overlay
  const [showExportOptions, setShowExportOptions] = useState(false);

  // Celebration
  const [celebrationState, setCelebrationState] = useState<CelebrationState>(null);
  const celebrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animation
  const paletteScale = useRef(new Animated.Value(1)).current;
  const leavingRef = useRef(false);

  // Export button animations - 7 different styles cycling
  const exportAnimValue = useRef(new Animated.Value(0)).current;
  const exportAnimationIndexRef = useRef(0);
  const EXPORT_ANIM_DURATION = 2000; // Each animation lasts 2 seconds
  const EXPORT_ANIM_STYLES = 7; // Number of different animation styles

  // Build timeline data for playback - now stored in ref for persistence
  const timelineDataRef = useRef<ReturnType<typeof buildTimelineData>>({
    strokes: [],
    modes: {
      historical: { duration: 0, pointTimes: [] },
      sequential: { duration: 0, pointTimes: [] },
      simultaneous: { duration: 0, pointTimes: [] }
    },
    totalPoints: 0
  });

  // Access timeline data from ref
  const timelineData = useMemo(() => {
    if (!timelineReady || strokes.length === 0) {
      return {
        strokes: [],
        modes: {
          historical: { duration: 0, pointTimes: [] },
          sequential: { duration: 0, pointTimes: [] },
          simultaneous: { duration: 0, pointTimes: [] }
        },
        totalPoints: 0
      };
    }
    return timelineDataRef.current;
  }, [strokes.length, timelineReady]);

  // Playback duration (animation only, without hold frame)
  const playbackDurationMs = useMemo(() => {
    const baseDuration = getModeDuration(timelineData, playbackMode);
    console.log(`[Timelapse Duration] Mode: ${playbackMode}, Duration: ${(baseDuration / 1000).toFixed(2)}s (${baseDuration}ms)`);
    return baseDuration;
  }, [timelineData, playbackMode]);

  // Detect iPad for FULLSCREEN layout
  const isIPad = useMemo(() => screenWidth > 700, [screenWidth]);
  const isLandscape = useMemo(() => screenWidth > screenHeight, [screenWidth, screenHeight]);

  // CRITICAL FIX: Canvas must match the ORIGINAL painting canvas size
  // Strokes are stored in the coordinate space of the original canvas
  // If we render at a different size, strokes will be cropped/zoomed
  const originalCanvasSize = useMemo(() => {
    // Match PaintScreen canvas calculation EXACTLY
    const base = Math.min(screenWidth, screenHeight * 0.85);
    return isIPad ? base * 0.8 : base;
  }, [screenWidth, screenHeight, isIPad]);

  const canvasPixelSize = useMemo(() => Math.max(1, Math.round(originalCanvasSize)), [originalCanvasSize]);

  // Display size for the View container
  // CRITICAL: Canvas is rendered at originalCanvasSize then SCALED DOWN to fit this container
  // We wrap the canvas in a View with transform: scale to show 100% of painting area
  const canvasRenderSize = useMemo(() => {
    if (isIPad) {
      // iPad: Use more space to ensure full painting is visible after scaling
      const maxSize = Math.min(
        screenWidth - 60,  // Margins for UI
        (screenHeight * 0.65) // Use 65% of screen height
      );
      const scale = maxSize / originalCanvasSize;
      console.log('[Timelapse] iPad - Container:', maxSize, 'px | Canvas:', originalCanvasSize, 'px | Scale:', scale.toFixed(3));
      return maxSize;
    } else {
      // iPhone: Compact display with more room
      const displaySize = Math.min(screenWidth - 40, screenHeight - 400);
      const scale = displaySize / originalCanvasSize;
      console.log('[Timelapse] iPhone - Container:', displaySize, 'px | Canvas:', originalCanvasSize, 'px | Scale:', scale.toFixed(3));
      return displaySize;
    }
  }, [screenWidth, screenHeight, isIPad, originalCanvasSize]);

  // Calculate export parameters based on speed and 30s limit
  const exportParams = useMemo(() => {
    // Get actual timeline duration in seconds (how long the drawing took, WITHOUT hold frame)
    const baseTimelineDuration = getModeDuration(timelineData, playbackMode);
    const actualTimelineSeconds = Math.max(1, baseTimelineDuration / 1000);

    // Calculate export video duration based on speed multiplier
    // Speed 1x = full timeline, Speed 10x = timeline/10, Speed 20x = timeline/20
    const exportDurationBeforeLimit = actualTimelineSeconds / speedMultiplier;

    // Apply 30s limit if enabled
    const exportDuration = limitTo30s && exportDurationBeforeLimit > 30
      ? 30
      : exportDurationBeforeLimit;

    // Fixed FPS for smooth video (30 FPS is standard)
    const fps = 30;

    const frameCount = Math.round(exportDuration * fps);

    return {
      fps,
      exportDuration, // This is the output video duration
      frameCount,
      actualTimelineSeconds, // This is passed to native as durationSeconds (the stroke timeline)
      speedMultiplier // Pass this through for display
    };
  }, [timelineData, playbackMode, speedMultiplier, limitTo30s]);

  // Calculate final output video duration with hold frames and ping-pong
  const outputVideoDuration = useMemo(() => {
    const baseTimelineDuration = getModeDuration(timelineData, playbackMode);
    const actualTimelineSeconds = Math.max(1, baseTimelineDuration / 1000);

    // Calculate animation duration after speed multiplier
    const animationDuration = actualTimelineSeconds / speedMultiplier;

    // Apply 30s limit if enabled
    const limitedAnimationDuration = limitTo30s && animationDuration > 30 ? 30 : animationDuration;

    // Add hold frame time
    const durationWithHold = limitedAnimationDuration + holdLastFrameSeconds;

    // Double if ping-pong mode (forward + reverse)
    const finalDuration = pingPongMode ? durationWithHold * 2 : durationWithHold;

    return finalDuration;
  }, [timelineData, playbackMode, speedMultiplier, limitTo30s, holdLastFrameSeconds, pingPongMode]);

  // Throttle frame updates for large stroke counts to prevent crashes
  const frameThrottleMs = useMemo(() => {
    if (strokes.length > 500) return 200; // 5 fps for very large
    if (strokes.length > 250) return 100; // 10 fps for large
    return 33; // 30 fps for normal
  }, [strokes.length]);

  // Throttled current time for rendering (updates less frequently with many strokes)
  const [throttledTime, setThrottledTime] = useState(0);
  const lastThrottleUpdateRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastThrottleUpdateRef.current;

    if (elapsed >= frameThrottleMs || currentTime === 0) {
      setThrottledTime(currentTime);
      lastThrottleUpdateRef.current = now;
    }
  }, [currentTime, frameThrottleMs]);

  // Get strokes visible at current time using point-based animation
  // OPTIMIZED: Uses throttled time to reduce re-renders with large stroke counts
  const visibleStrokes = useMemo(() => {
    // During mode switching, show a simplified preview
    if (isModeSwitching) {
      console.log('[TimelapseScreen] Mode switching - showing simplified preview');
      return timelineData.strokes; // Show all strokes during transition
    }

    console.log('[TimelapseScreen] visibleStrokes recalculating:', {
      strokesLength: strokes.length,
      timelineStrokesLength: timelineData.strokes.length,
      playbackDurationMs,
      throttledTime,
      playbackMode
    });

    if (strokes.length === 0 || timelineData.strokes.length === 0) {
      console.log('[TimelapseScreen] visibleStrokes: no strokes, returning []');
      return [];
    }
    if (playbackDurationMs === 0) {
      console.log('[TimelapseScreen] visibleStrokes: playbackDuration=0, showing all strokes');
      return timelineData.strokes;
    }

    // Get base timeline duration (without hold frame)
    const baseTimelineDuration = getModeDuration(timelineData, playbackMode);
    // Clamp time to valid range [0, baseTimelineDuration]
    // This ensures strokes render correctly even during hold periods (when time goes negative or past max)
    const cappedTime = Math.max(0, Math.min(throttledTime, baseTimelineDuration));

    // Use createSnapshot to get partial strokes based on point timings with selected playback mode
    const snapshot = createSnapshot(timelineData, playbackMode, cappedTime);
    console.log('[TimelapseScreen] visibleStrokes: snapshot has', snapshot.length, 'strokes (time capped at', cappedTime, 'ms)');
    return snapshot;
  }, [timelineData, playbackMode, throttledTime, strokes.length, playbackDurationMs, isModeSwitching]);

  // Load persisted settings
  const loadSettings = useCallback(async () => {
    try {
      const [savedSpeed, savedMode, savedLimit, savedHold, savedPingPong, savedReverse, savedPngQuality] = await Promise.all([
        AsyncStorage.getItem('timelapse_speed'),
        AsyncStorage.getItem('timelapse_mode'),
        AsyncStorage.getItem('timelapse_limit30s'),
        AsyncStorage.getItem('timelapse_hold'),
        AsyncStorage.getItem('timelapse_pingpong'),
        AsyncStorage.getItem('timelapse_reverse'),
        AsyncStorage.getItem('@settings_png_quality')
      ]);

      const updates: [string, string][] = [];

      const parsedSpeed = savedSpeed !== null ? parseFloat(savedSpeed) : NaN;
      if (!Number.isNaN(parsedSpeed)) {
        setSpeedMultiplier(parsedSpeed);
      } else {
        setSpeedMultiplier(DEFAULT_TIMELAPSE_SETTINGS.speedMultiplier);
        updates.push(['timelapse_speed', DEFAULT_TIMELAPSE_SETTINGS.speedMultiplier.toString()]);
      }

      const validModes: PlaybackMode[] = ['simultaneous', 'sequential', 'historical'];
      if (savedMode && validModes.includes(savedMode as PlaybackMode)) {
        setPlaybackMode(savedMode as PlaybackMode);
      } else {
        setPlaybackMode(DEFAULT_TIMELAPSE_SETTINGS.playbackMode);
        updates.push(['timelapse_mode', DEFAULT_TIMELAPSE_SETTINGS.playbackMode]);
      }

      if (savedLimit !== null) {
        setLimitTo30s(savedLimit === 'true');
      } else {
        setLimitTo30s(DEFAULT_TIMELAPSE_SETTINGS.limitTo30s);
        updates.push(['timelapse_limit30s', DEFAULT_TIMELAPSE_SETTINGS.limitTo30s.toString()]);
      }

      const parsedHold = savedHold !== null ? parseFloat(savedHold) : NaN;
      if (!Number.isNaN(parsedHold)) {
        setHoldLastFrameSeconds(parsedHold);
      } else {
        setHoldLastFrameSeconds(DEFAULT_TIMELAPSE_SETTINGS.holdLastFrameSeconds);
        updates.push(['timelapse_hold', DEFAULT_TIMELAPSE_SETTINGS.holdLastFrameSeconds.toString()]);
      }

      if (savedPingPong !== null) {
        setPingPongMode(savedPingPong === 'true');
      } else {
        setPingPongMode(DEFAULT_TIMELAPSE_SETTINGS.pingPongMode);
        updates.push(['timelapse_pingpong', DEFAULT_TIMELAPSE_SETTINGS.pingPongMode.toString()]);
      }

      if (savedReverse !== null) {
        setReverseMode(savedReverse === 'true');
      } else {
        setReverseMode(DEFAULT_TIMELAPSE_SETTINGS.reverseMode);
        updates.push(['timelapse_reverse', DEFAULT_TIMELAPSE_SETTINGS.reverseMode.toString()]);
      }

      // Load PNG export quality (4K default)
      const parsedPngQuality = savedPngQuality !== null ? parseInt(savedPngQuality, 10) : NaN;
      const validQuality: (4096 | 8192 | 16384)[] = [4096, 8192, 16384];
      if (validQuality.includes(parsedPngQuality as any)) {
        setPngExportSize(parsedPngQuality as 4096 | 8192 | 16384);
        console.log('[Timelapse] Loaded PNG quality:', parsedPngQuality);
      } else {
        setPngExportSize(4096); // Default to 4K
        updates.push(['@settings_png_quality', '4096']);
      }

      if (updates.length > 0) {
        await AsyncStorage.multiSet(updates);
      }

      console.log('[TimelapseScreen] Loaded settings:', {
        speed: savedSpeed ?? DEFAULT_TIMELAPSE_SETTINGS.speedMultiplier.toString(),
        mode: savedMode ?? DEFAULT_TIMELAPSE_SETTINGS.playbackMode,
        limit: savedLimit ?? DEFAULT_TIMELAPSE_SETTINGS.limitTo30s.toString(),
        hold: savedHold ?? DEFAULT_TIMELAPSE_SETTINGS.holdLastFrameSeconds.toString(),
        pingpong: savedPingPong ?? DEFAULT_TIMELAPSE_SETTINGS.pingPongMode.toString()
      });
    } catch (err) {
      console.log('[TimelapseScreen] Failed to load settings:', err);
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  // Save settings when they change
  const saveSettings = useCallback(async () => {
    try {
      await Promise.all([
        AsyncStorage.setItem('timelapse_speed', speedMultiplier.toString()),
        AsyncStorage.setItem('timelapse_mode', playbackMode),
        AsyncStorage.setItem('timelapse_limit30s', limitTo30s.toString()),
        AsyncStorage.setItem('timelapse_hold', holdLastFrameSeconds.toString()),
        AsyncStorage.setItem('timelapse_pingpong', pingPongMode.toString()),
        AsyncStorage.setItem('timelapse_reverse', reverseMode.toString())
      ]);
    } catch (err) {
      console.log('[TimelapseScreen] Failed to save settings:', err);
    }
  }, [speedMultiplier, playbackMode, limitTo30s, holdLastFrameSeconds, pingPongMode, reverseMode]);

  // Load settings ONCE on mount before anything else
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Save settings whenever they change
  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings();
  }, [speedMultiplier, playbackMode, limitTo30s, holdLastFrameSeconds, pingPongMode, reverseMode, settingsLoaded, saveSettings]);

  // Auto-start playback when timeline is ready (has duration > 0)
  useEffect(() => {
    console.log('[TimelapseScreen] Auto-play check:', {
      strokes: strokes.length,
      timelineReady,
      playbackDurationMs,
      exportActive: exportState.active,
      isPlaying,
      willAutoStart: strokes.length > 0 && timelineReady && playbackDurationMs > 0 && !exportState.active && !isPlaying
    });

    if (strokes.length > 0 && timelineReady && playbackDurationMs > 0 && !exportState.active && !isPlaying) {
      console.log('[TimelapseScreen] ✅ AUTO-STARTING PLAYBACK');
      setPlaying(true);
    }
  }, [strokes.length, timelineReady, playbackDurationMs, exportState.active, isPlaying]);

  // Calculate estimated memory usage
  const estimateMemoryUsageMB = useCallback((frames: number, size: number) => {
    return (frames * size * size * 4) / (1024 * 1024);
  }, []);

  // Load strokes and build timeline for stamp-by-stamp animation
  // ROBUST LOADER: Pre-computes ALL timeline data upfront for smooth playback
  const loadStrokes = useCallback(async () => {
    try {
      setLoading(true);
      setLoadingProgress(0);
      setLoadingPhase('Initializing...');
      setError(null);
      setTimelineReady(false);

      // CRITICAL FIX: Use passed strokes from navigation params if available (for wording mode)
      // This avoids race conditions with PaintingContext
      // Extract wordingStrokes ONCE at the start to avoid issues when params are cleared later
      const wordingStrokesSnapshot = route.params?.wordingStrokes;
      const strokesToLoad = wordingStrokesSnapshot || contextStrokes;

      if (!strokesToLoad || strokesToLoad.length === 0) {
        setError('No strokes found. Draw something first!');
        setStrokes([]);
        setLoading(false);
        return;
      }

      console.log('[TimelapseScreen] 🚀 ROBUST LOADER: Starting load for', strokesToLoad.length, 'strokes');
      if (wordingStrokesSnapshot) {
        console.log('[TimelapseScreen] ✅ Using strokes passed from wording mode (avoiding context race condition)');
      }

      // Phase 1: Load strokes (10%)
      setLoadingPhase(`Loading ${strokesToLoad.length} strokes...`);
      setLoadingProgress(0.1);
      await new Promise(resolve => setTimeout(resolve, 50)); // Allow UI to update

      // Smudge tiles are files now → pull their base64 from disk so timelapse renders smudge correctly.
      const resolvedStrokes = await resolveSmudgeTilesFromFiles(strokesToLoad);
      setStrokes(resolvedStrokes);

      // Determine canvas size based on stroke count for memory optimization
      let canvasSize = 512;
      if (strokesToLoad.length > 500) canvasSize = 320;
      else if (strokesToLoad.length > 250) canvasSize = 384;
      else if (strokesToLoad.length > 100) canvasSize = 448;

      console.log('[TimelapseScreen] ✓ Phase 1: Strokes loaded');
      console.log(`[TimelapseScreen] 💾 Memory optimization: Canvas size ${canvasSize}px for ${strokesToLoad.length} strokes`);

      // Phase 2: Build timeline data (30%)
      setLoadingPhase('Building timeline...');
      setLoadingProgress(0.3);
      await new Promise(resolve => setTimeout(resolve, 50));

      console.log('[TimelapseScreen] Building timeline data...');
      const timelineStart = Date.now();
      const timeline = buildTimelineData(strokesToLoad);
      const timelineMs = Date.now() - timelineStart;
      console.log('[TimelapseScreen] ✓ Phase 2: Timeline built in', timelineMs, 'ms');
      console.log('[TimelapseScreen] Timeline stats:', {
        totalPoints: timeline.totalPoints,
        historicalDuration: timeline.modes.historical.duration,
        sequentialDuration: timeline.modes.sequential.duration,
        simultaneousDuration: timeline.modes.simultaneous.duration
      });

      // Phase 3: Validate all modes (50%)
      setLoadingPhase('Validating playback modes...');
      setLoadingProgress(0.5);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Validate each mode has valid data
      const modesValid = ['historical', 'sequential', 'simultaneous'].every(mode => {
        const modeData = timeline.modes[mode as PlaybackMode];
        const isValid = modeData.duration > 0 && modeData.pointTimes.length === timeline.strokes.length;
        console.log(`[TimelapseScreen] Mode ${mode}: duration=${modeData.duration}ms, valid=${isValid}`);
        return isValid;
      });

      if (!modesValid) {
        throw new Error('Timeline validation failed - some modes have invalid data');
      }
      console.log('[TimelapseScreen] ✓ Phase 3: All modes validated');

      // Phase 4: Store timeline data (70%)
      setLoadingPhase('Preparing renderer...');
      setLoadingProgress(0.7);
      await new Promise(resolve => setTimeout(resolve, 50));

      timelineDataRef.current = timeline;
      setTimelineReady(true);
      console.log('[TimelapseScreen] ✓ Phase 4: Timeline data stored');

      // Phase 5: Initialize playback (90%)
      setLoadingPhase('Initializing playback...');
      setLoadingProgress(0.9);
      await new Promise(resolve => setTimeout(resolve, 50));

      setCurrentTime(0);
      setCurrentFrameIndex(0);
      console.log('[TimelapseScreen] ✓ Phase 5: Playback initialized');

      // Phase 6: Complete (100%)
      setLoadingPhase('Ready!');
      setLoadingProgress(1);
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('[TimelapseScreen] ✅ ROBUST LOADER: Complete! Ready for', strokesToLoad.length, 'strokes');
      setLoading(false);
      setPlaying(true); // Auto-play
      console.log('[TimelapseScreen] Starting playback...');
    } catch (err) {
      console.error('[TimelapseScreen] ❌ ROBUST LOADER: Failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load strokes');
      setStrokes([]);
      setTimelineReady(false);
      setLoading(false);
    }
    // CRITICAL: Only depend on contextStrokes, NOT route.params
    // route.params gets cleared during auto-export which would trigger unwanted re-loads
    // The wordingStrokes are captured from route.params at function call time
  }, [contextStrokes]);

  useFocusEffect(
    useCallback(() => {
      console.log('[TimelapseScreen] useFocusEffect triggered - loading strokes');
      loadStrokes();
      leavingRef.current = false;

      // CRITICAL FIX: Reset flag when screen focuses with new auto-export params
      // This allows each new letter to trigger auto-export
      if (route.params?.autoExport && route.params?.wordingLetterIndex !== undefined) {
        console.log('[TimelapseScreen] Resetting auto-export flag for new letter', route.params.wordingLetterIndex);
        autoExportTriggeredRef.current = false;
      }

      // Run periodic cleanup every 60 seconds to prevent memory buildup
      cleanupOldExports(); // Run once on focus
      const cleanupInterval = setInterval(() => {
        cleanupOldExports();
      }, 60000); // Every 60 seconds

      return () => {
        console.log('[TimelapseScreen] Screen losing focus - cleaning up');
        leavingRef.current = true;
        setPlaying(false); // Stop playback FIRST
        clearInterval(cleanupInterval); // Stop periodic cleanup
        // REMOVED: autoExportTriggeredRef.current = false; // Flag is now reset after successful export only

        // CRITICAL: Clear strokes after a small delay to allow animation loop to fully stop
        // This prevents EXC_BAD_ACCESS from native canvas trying to render during cleanup
        setTimeout(() => {
          console.log('[TimelapseScreen] Delayed cleanup - clearing strokes and frames');
          setStrokes([]); // Clear strokes to free memory
          setPreloadedFrames([]); // Clear any preloaded frames
        }, 100);

        if (celebrationTimeoutRef.current) {
          clearTimeout(celebrationTimeoutRef.current);
        }
      };
    }, [loadStrokes, cleanupOldExports, route.params?.autoExport, route.params?.wordingLetterIndex])
  );

  // Auto-trigger export for wording mode
  useEffect(() => {
    const autoExport = route.params?.autoExport;
    const letterIndex = route.params?.wordingLetterIndex;

    if (autoExport && timelineReady && !exportState.active && letterIndex !== undefined && !autoExportTriggeredRef.current) {
      console.log(`[TimelapseScreen] 🚀 Auto-triggering export for letter ${letterIndex}`);

      // Mark as triggered to prevent double-trigger
      autoExportTriggeredRef.current = true;

      // Clear params to prevent re-triggering
      navigation.setParams({
        autoExport: undefined,
        wordingMode: undefined,
        wordingLetterIndex: undefined,
        wordingStrokes: undefined
      });

      // Trigger export after a small delay to ensure UI is ready
      const timeout = setTimeout(() => {
        void handleExportWebM();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [route.params?.autoExport, route.params?.wordingLetterIndex, timelineReady, exportState.active, handleExportWebM, navigation]);

  // Listen for export progress updates from native module
  useEffect(() => {
    const subscription = addExportProgressListener((current, total) => {
      setExportState(prev => ({
        ...prev,
        progress: { current, total }
      }));
      // Update percentage for AnimatedLoader
      const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
      setExportProgress(percentage);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Auto-pause after 3 minutes of idle time to prevent memory crash
  useEffect(() => {
    if (!isPlaying) return;

    const checkIdleTime = () => {
      const idleTime = Date.now() - lastInteractionRef.current;
      const threeMinutes = 3 * 60 * 1000;

      if (idleTime > threeMinutes) {
        console.log('[TimelapseScreen] Auto-pausing after 3 minutes of idle time');
        setPlaying(false);
      }
    };

    // Check every 30 seconds
    const interval = setInterval(checkIdleTime, 30000);

    return () => clearInterval(interval);
  }, [isPlaying]);

  // Update last interaction time when user changes settings
  const updateInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now();
  }, []);

  // Playback animation loop - stamp-by-stamp with speed multiplier
  // OPTIMIZED: 30fps instead of 60fps to reduce memory pressure
  useEffect(() => {
    console.log('[TimelapseScreen] 🔄 Animation loop effect triggered (speed:', speedMultiplier + 'x):', {
      isPlaying,
      timelineReady,
      playbackDurationMs,
      exportActive: exportState.active,
      speedMultiplier
    });

    // Pause animation during export or if timeline not ready
    if (!isPlaying || !timelineReady || playbackDurationMs === 0 || exportState.active) {
      console.log('[TimelapseScreen] Animation loop NOT starting (conditions not met)');
      return;
    }

    console.log('[TimelapseScreen] STARTING ANIMATION LOOP (MEMORY OPTIMIZED)');
    let rafId: number | null = null;
    let lastTimestamp: number | null = null;
    const targetFrameTime = 1000 / 30; // 30fps for preview (reduce from 60fps)
    let frameAccumulator = 0;
    let frameCount = 0;
    let lastGCTime = Date.now();
    let isRunning = true; // Safety flag to prevent memory access after cleanup
    // Direction is tracked in animationDirectionRef for persistence across frames

    const step = (timestamp: number) => {
      // CRITICAL: Check if still running before accessing any state/refs
      if (!isRunning) {
        console.log('[TimelapseScreen] Animation stopped, skipping frame');
        return;
      }

      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }

      const delta = timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      frameAccumulator += delta;

      // Throttle to 30fps to reduce memory pressure
      if (frameAccumulator >= targetFrameTime) {
        const updateDelta = frameAccumulator;
        frameAccumulator = 0;
        frameCount++;

        // Log every 30 frames (once per second at 30fps)
        if (frameCount % 30 === 0) {
          console.log('[TimelapseScreen] Animation @', speedMultiplier + 'x speed, frame', frameCount, 'delta:', updateDelta.toFixed(1), 'ms');

          // Periodic memory cleanup hint every 5 seconds
          const now = Date.now();
          if (now - lastGCTime > 5000) {
            lastGCTime = now;
            // Hint to JS engine that this is a good time for GC
            if (global.gc) {
              console.log('[TimelapseScreen] 🧹 Memory cleanup hint');
            }
          }
        }

        // CRITICAL: Check again before state update
        if (!isRunning) return;

        // Apply speed multiplier to make animation faster/slower
        setCurrentTime((prev) => {
          const timeDelta = updateDelta * speedMultiplier * animationDirectionRef.current;
          const next = prev + timeDelta;

          // Log every 30 frames to see currentTime progression with speed
          if (frameCount % 30 === 0) {
            console.log('[TimelapseScreen] Time:', prev.toFixed(0), '→', next.toFixed(0), 'ms (', speedMultiplier + 'x speed, dir:', animationDirectionRef.current, ') / max:', playbackDurationMs.toFixed(0), 'ms');
          }

          const HOLD_DURATION_MS = holdLastFrameSecondsRef.current * 1000;
          const isReverse = reverseModeRef.current;

          /**
           * TIMELAPSE MODE COMBINATIONS - Complete Reference
           *
           * 1. NORMAL FORWARD (default):
           *    - time: 0 → max → hold → loop to 0
           *    - direction: always 1 (forward)
           *    - "last frame" = max (oldest strokes shown last)
           *
           * 2. NORMAL REVERSE (reverseMode=true):
           *    - time: max → 0 → hold → loop to max
           *    - direction: always -1 (backward)
           *    - "last frame" = 0 (youngest strokes shown last)
           *    - CRITICAL: Hold occurs at time=0, going negative for tracking
           *
           * 3. PING-PONG FORWARD START (pingPongMode=true):
           *    - time: 0 → max → hold → max → 0 → hold → loop
           *    - direction: 1, -1, 1, -1... (alternates)
           *    - holds at BOTH ends
           *
           * 4. PING-PONG REVERSE START (pingPongMode=true, reverseMode=true):
           *    - time: max → 0 → hold → 0 → max → hold → loop
           *    - direction: -1, 1, -1, 1... (alternates, starts backward)
           *    - holds at BOTH ends
           *
           * HOLD MECHANISM:
           * - Forward: time goes past max (max+delta) to track hold duration
           * - Reverse: time goes negative (0-delta) to track hold duration
           * - Snapshot rendering: CLAMPS time to [0, max] so strokes display correctly
           * - Loop triggers: when hold duration exceeds HOLD_DURATION_MS
           */

          // PING-PONG MODE: Alternates direction at each end
          // With reverseMode flag: starts backward instead of forward
          if (pingPongModeRef.current) {
            // The direction naturally toggles between 1 and -1
            // reverseMode affects the initial direction (set in useEffect), not the ping-pong logic
            if (animationDirectionRef.current === 1) {
              // Going forward
              if (next >= playbackDurationMs) {
                // Reached the end - always hold (even if hold=0, we hold for 1 frame minimum)
                if (prev >= playbackDurationMs && next < playbackDurationMs + HOLD_DURATION_MS) {
                  // Still holding
                  return playbackDurationMs;
                } else if (next >= playbackDurationMs + HOLD_DURATION_MS) {
                  // Hold complete - reverse direction
                  console.log('[TimelapseScreen] Ping-pong: Hold at end complete, reversing');
                  animationDirectionRef.current = -1;
                  return playbackDurationMs;
                } else {
                  // Just reached end - start holding
                  return playbackDurationMs;
                }
              }
              return next;
            } else {
              // Going backward
              if (next <= 0) {
                // Reached the start - hold before going forward again
                if (prev <= 0 && next > -HOLD_DURATION_MS) {
                  // Still holding at start (tracking negative time for hold)
                  return 0;
                } else if (next <= -HOLD_DURATION_MS) {
                  // Hold complete - go forward again
                  console.log('[TimelapseScreen] Ping-pong: Hold at start complete, going forward');
                  animationDirectionRef.current = 1;
                  return 0;
                } else {
                  // Just reached start - start holding
                  console.log('[TimelapseScreen] Ping-pong: Reached start, holding');
                  return 0;
                }
              }
              return next;
            }
          }

          // NORMAL MODE with REVERSE flag support
          if (isReverse) {
            // REVERSE MODE: Go backward, hold at start, loop back to end
            if (next <= 0) {
              // Reached or past the start
              if (prev <= 0 && next > -HOLD_DURATION_MS) {
                // Currently holding at first frame
                return 0;
              } else if (next <= -HOLD_DURATION_MS) {
                // Hold complete - loop back to end
                console.log('[TimelapseScreen] Reverse mode + hold complete, looping to end');
                animationDirectionRef.current = -1; // Maintain backward direction
                return playbackDurationMs;
              } else {
                // Just reached start - start holding (shows first frame)
                return 0;
              }
            }
            return next;
          } else {
            // NORMAL FORWARD MODE: Hold at end, then loop back to start
            if (next >= playbackDurationMs) {
              // Reached or past the end
              if (prev >= playbackDurationMs && next < playbackDurationMs + HOLD_DURATION_MS) {
                // Currently holding at last frame
                return playbackDurationMs;
              } else if (next >= playbackDurationMs + HOLD_DURATION_MS) {
                // Hold complete - loop back to start
                console.log('[TimelapseScreen] Animation + hold complete, restarting');
                animationDirectionRef.current = 1; // Maintain forward direction
                return 0;
              } else {
                // Just reached end - start holding (shows last frame)
                return playbackDurationMs;
              }
            }
            return next;
          }
        });
      }

      // CRITICAL: Check before scheduling next frame
      if (isRunning) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);

    return () => {
      console.log('[TimelapseScreen] Animation loop cleanup, frameCount:', frameCount);
      // CRITICAL: Set flag first to stop any in-flight frames
      isRunning = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, [isPlaying, timelineReady, playbackDurationMs, speedMultiplier, exportState.active]);

  // Trigger celebration
  const triggerCelebration = useCallback(() => {
    if (leavingRef.current) return;
    const messages = ['Timelapse ready!', 'Nice export!', 'Video saved!', 'All done!', 'Export complete!'];
    const message = messages[Math.floor(Math.random() * messages.length)];
    setCelebrationState({ id: Date.now(), message });
    if (celebrationTimeoutRef.current) {
      clearTimeout(celebrationTimeoutRef.current);
    }
    celebrationTimeoutRef.current = setTimeout(() => {
      if (!leavingRef.current) {
        setCelebrationState(null);
      }
    }, 2400);
  }, []);

  // Show memory warning if needed - DISABLED per user request
  const showMemoryWarningIfNeeded = useCallback(async (frames: number, size: number): Promise<boolean> => {
    // Always return true - warning disabled
    return true;
  }, []);

  // Show export format picker
  const showExportFormatPicker = useCallback(() => {
    updateInteraction(); // User is exporting, update interaction time
    if (strokes.length === 0) {
      CustomOverlayHelper.alert('No strokes', 'Draw something first!');
      return;
    }

    setShowExportOptions(true);
  }, [strokes.length, updateInteraction]);

  // Memory cleanup helper - clean up old cache files
  const cleanupOldExports = useCallback(async () => {
    try {
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) return;

      const files = await FileSystem.readDirectoryAsync(cacheDir);
      const exportFiles = files.filter(f =>
        f.startsWith('timelapse-') ||
        f.startsWith('snapshot-')
      );

      // Delete old export files (keep very recent ones only)
      const now = Date.now();
      let deletedCount = 0;
      for (const file of exportFiles) {
        try {
          const filePath = `${cacheDir}${file}`;
          const info = await FileSystem.getInfoAsync(filePath);
          if (info.exists && 'modificationTime' in info) {
            // Delete files older than 2 minutes (more aggressive cleanup)
            if (now - (info.modificationTime || 0) * 1000 > 2 * 60 * 1000) {
              await FileSystem.deleteAsync(filePath, { idempotent: true });
              deletedCount++;
            }
          }
        } catch (err) {
          // Ignore errors deleting individual files
        }
      }
      if (deletedCount > 0) {
        console.log('[Cleanup] Deleted', deletedCount, 'old export files');
      }
    } catch (err) {
      // Ignore cleanup errors
      console.log('[Cleanup] Error cleaning old exports:', err);
    }
  }, []);

  // Media Library permissions helper (for saving to Photos)
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

  // Export handlers
  const handleExportGif = useCallback(async () => {
    // Reset cancel flag before starting new export
    exportCancelRef.current = false;

    // Clean up old exports first to free memory
    await cleanupOldExports();

    // PAUSE PLAYBACK AND CLEAR PREVIEW during export to reduce memory pressure
    wasPlayingBeforeExportRef.current = isPlaying;
    console.log('[GIF Export] Pausing playback (was playing:', isPlaying, ')');
    setPlaying(false);
    setCurrentTime(0); // Clear preview to reduce memory usage during export

    console.log('[GIF Export] === STARTING CRASH-SAFE GIF EXPORT (512x512) ===');
    console.log('[GIF Export] Playback mode:', playbackMode);
    console.log('[GIF Export] Speed multiplier:', speedMultiplier);
    console.log('[GIF Export] Hold last frame:', holdLastFrameSeconds, 's');
    console.log('[GIF Export] Ping-pong mode:', pingPongMode);
    console.log('[GIF Export] Limit to 30s:', limitTo30s);
    console.log('[GIF Export] Timeline durations:', {
      historical: timelineData.modes.historical.duration,
      sequential: timelineData.modes.sequential.duration,
      simultaneous: timelineData.modes.simultaneous.duration
    });

    // Calculate the ACTUAL timeline duration based on the selected playback mode (without hold frame)
    const timelineDurationMs = getModeDuration(timelineData, playbackMode);
    const timelineDurationSeconds = timelineDurationMs / 1000;

    console.log('[GIF Export] Timeline duration (from playback):', timelineDurationSeconds, 'seconds');

    // Calculate export duration based on speed
    const animationDuration = timelineDurationSeconds / speedMultiplier;
    const totalDuration = animationDuration + holdLastFrameSeconds;

    // Apply 30s limit if enabled
    const finalDuration = limitTo30s && totalDuration > 30 ? 30 : totalDuration;
    const actualAnimationDuration = limitTo30s && totalDuration > 30
      ? 30 - holdLastFrameSeconds
      : animationDuration;

    // GIF export with optimized size
    const gifSize = GIF_EXPORT_SIZE; // 512x512 for good quality
    const gifFps = 10; // Reduced from 12 for memory efficiency
    const isPingPong = pingPongMode;
    const totalFrames = Math.round((isPingPong ? finalDuration * 2 + holdLastFrameSeconds : finalDuration) * gifFps);

    console.log('[GIF Export] Calculated params (MEMORY OPTIMIZED):');
    console.log('  - Animation duration:', actualAnimationDuration, 's');
    console.log('  - Hold duration:', holdLastFrameSeconds, 's');
    console.log('  - Total duration:', finalDuration, 's');
    console.log('  - Ping-pong mode:', isPingPong);
    console.log('  - GIF size:', gifSize + 'x' + gifSize, '(optimized for memory)');
    console.log('  - GIF FPS:', gifFps);
    console.log('  - Total frames:', totalFrames);
    console.log('  - Est. memory:', ((totalFrames * gifSize * gifSize * 4) / (1024 * 1024)).toFixed(0), 'MB');

    const shouldContinue = await showMemoryWarningIfNeeded(totalFrames, gifSize);
    if (!shouldContinue) return;

    try {
      setExportState({ active: true, format: 'gif', status: '🧩 Preparing GIF export…', progress: null });
      setExportProgress(0);

      const outputPath = `${FileSystem.cacheDirectory}timelapse-${gifSize}-${Date.now()}.gif`;
      const statusDuration = isPingPong ? `${(finalDuration * 2).toFixed(1)}s (ping-pong)` : `${finalDuration.toFixed(1)}s`;
      setExportState(prev => ({
        ...prev,
        status: `🖼️ GIF ${gifSize}×${gifSize} • ${gifFps}fps • ${statusDuration}`,
        progress: { current: 0, total: totalFrames }
      }));

      // Use remapped timeline based on playback mode (like preview does!)
      // Native code will handle speed by mapping timeline to video duration
      const modePointTimes = timelineData.modes[playbackMode].pointTimes;
      let remappedStrokes = timelineData.strokes.map((stroke, strokeIndex) => {
        const times = modePointTimes[strokeIndex] ?? [];
        const remappedPoints = stroke.points.map((point, pointIndex) => ({
          ...point,
          t: times[pointIndex] ?? 0
        }));

        // Add hold frame by duplicating last point at timeline end
        if (remappedPoints.length > 0 && holdLastFrameSeconds > 0) {
          const lastPoint = remappedPoints[remappedPoints.length - 1];
          // Duplicate at timeline end - native spreads this across video duration
          remappedPoints.push({
            ...lastPoint,
            t: timelineDurationMs
          });
        }

        return { ...stroke, points: remappedPoints };
      });

      // FIRST FRAME = LAST FRAME: Prepend a static frame showing the completed painting
      // Add all strokes' final points at t=-100ms (before animation starts)
      remappedStrokes = remappedStrokes.map(stroke => {
        if (stroke.points.length > 0) {
          const lastPoint = stroke.points[stroke.points.length - 1];
          return {
            ...stroke,
            points: [
              { ...lastPoint, t: -100 }, // Show completed painting for first frame
              ...stroke.points
            ]
          };
        }
        return stroke;
      });

      // REVERSE MODE: Reverse stroke order and stroke points for backwards playback
      if (reverseMode) {
        console.log('[GIF Export] 🔄 REVERSE MODE ENABLED - reversing strokes and points');

        // Step 1: Reverse the stroke array (last stroke becomes first)
        remappedStrokes = [...remappedStrokes].reverse();

        // Step 2: For each stroke, reverse its points and recalculate timestamps
        // The first point should now be where the last point was
        remappedStrokes = remappedStrokes.map(stroke => {
          const reversedPoints = [...stroke.points].reverse();

          // Recalculate timestamps - find the time span of original stroke
          const originalFirstTime = stroke.points[0].t;
          const originalLastTime = stroke.points[stroke.points.length - 1].t;
          const timeSpan = originalLastTime - originalFirstTime;

          // Map reversed points to new timeline positions
          // First reversed point should start where original last point was
          const recalculatedPoints = reversedPoints.map((p, index) => ({
            ...p,
            t: originalFirstTime + (timeSpan * (index / (reversedPoints.length - 1)))
          }));

          return {
            ...stroke,
            points: recalculatedPoints
          };
        });

        console.log('[GIF Export] Reversed', remappedStrokes.length, 'strokes for backwards playback');
      }

      // PING-PONG MODE: Create forward + hold + reverse timeline
      let pingPongDuration = finalDuration;
      let pingPongAnimationDuration = actualAnimationDuration;
      if (pingPongMode) {
        console.log('[GIF Export] 🔄 PING-PONG MODE ENABLED (hold=' + holdLastFrameSeconds + 's)');

        // Calculate hold time in timeline milliseconds
        const holdTimeMs = holdLastFrameSeconds * 1000 * speedMultiplier;

        remappedStrokes = remappedStrokes.map(stroke => {
          const forwardPoints = stroke.points;

          // Add hold frames at 100% (duplicate last point)
          const lastPoint = forwardPoints[forwardPoints.length - 1];
          const holdPoints = holdTimeMs > 0 ? [{
            ...lastPoint,
            t: timelineDurationMs + holdTimeMs
          }] : [];

          // Create reverse points (excluding first and last to avoid duplicates)
          const reversePoints = forwardPoints
            .slice(1, -1)
            .reverse()
            .map(point => ({
              ...point,
              t: 2 * timelineDurationMs + holdTimeMs - point.t // Mirror time after hold
            }));

          // Complete sequence: forward → hold → reverse
          return {
            ...stroke,
            points: [...forwardPoints, ...holdPoints, ...reversePoints]
          };
        });

        // Duration: forward + hold + reverse
        pingPongDuration = finalDuration * 2 + holdLastFrameSeconds;
        pingPongAnimationDuration = actualAnimationDuration * 2 + holdLastFrameSeconds;
        console.log('[GIF Export] Ping-pong: total duration', pingPongDuration, 's (forward + hold + reverse)');
        console.log('[GIF Export] Ping-pong: timeline 0→', timelineDurationMs, '→ hold', holdTimeMs, 'ms →', 2 * timelineDurationMs + holdTimeMs, 'ms');
      }

      console.log('[GIF Export] Using remapped timeline for', playbackMode, 'mode');
      const finalTimelineMs = pingPongMode ? (2 * timelineDurationMs + (holdLastFrameSeconds * 1000 * speedMultiplier)) : timelineDurationMs;
      console.log('[GIF Export] Timeline:', finalTimelineMs, 'ms');
      console.log('[GIF Export] Video duration:', pingPongDuration, 's (animation:', pingPongAnimationDuration, 's + hold:', holdLastFrameSeconds, 's)');
      console.log('[GIF Export] Speed:', speedMultiplier, 'x');
      console.log('[GIF Export] Native will map', finalTimelineMs, 'ms timeline →', pingPongDuration, 's video');
      console.log('[GIF Export] First stroke point times (first 5):', remappedStrokes[0]?.points.slice(0, 5).map(p => p.t));
      console.log('[GIF Export] Last stroke point times (first 5):', remappedStrokes[remappedStrokes.length - 1]?.points.slice(0, 5).map(p => p.t));

      // CRITICAL FIX: Apply adaptive resampling to match canvas rendering EXACTLY
      // Canvas uses adaptiveResamplePoints to decide which stamps to render
      // Export must use the same logic to get identical spacing!
      const resampledStrokes = remappedStrokes.map(stroke => {
        const spacing = resolveResampleSpacing(stroke);
        const resampledPoints = adaptiveResamplePoints(stroke.points, spacing);
        console.log(`[GIF Export] Stroke ${stroke.id}: ${stroke.points.length} → ${resampledPoints.length} points (${stroke.spacing?.toFixed(2)} spacing)`);
        return {
          ...stroke,
          points: resampledPoints
        };
      });

      console.log('[GIF Export] Calling MEMORY-OPTIMIZED exportGif with:');
      console.log('  - strokes:', resampledStrokes.length);
      console.log('  - size:', gifSize + 'x' + gifSize);
      console.log('  - fps:', gifFps);
      console.log('  - durationSeconds:', pingPongDuration);
      console.log('  - outputPath:', outputPath);

      const sizedStrokes = scaleStrokesForExport(resampledStrokes, gifSize, canvasPixelSize);

      // Log custom strokes in sizedStrokes
      const customStrokesInExport = sizedStrokes.filter(s => s.emoji.startsWith('custom_brush_'));
      console.log('[GIF Export] Custom strokes in export:', customStrokesInExport.length, 'out of', sizedStrokes.length);
      if (customStrokesInExport.length > 0) {
        console.log('[GIF Export] Custom stroke emojis:', customStrokesInExport.map(s => s.emoji).slice(0, 5));
      }

      const result = await exportGif(
        sizedStrokes,
        gifSize,
        gifSize,
        gifFps,
        pingPongDuration,
        pingPongAnimationDuration,
        outputPath,
        0.8
      );

      console.log('[GIF Export] Result:', result);

      if (!result.success) throw new Error('GIF export failed');

      setExportState({ active: false, format: null, status: '', progress: null });
      triggerCelebration();

      // Calculate file size
      const fileInfo = await FileSystem.getInfoAsync(result.outputPath);
      const fileSizeMB = fileInfo.exists && 'size' in fileInfo ? (fileInfo.size / (1024 * 1024)).toFixed(1) : '?';

      // Share directly
      const shareTitle = isPingPong
        ? `Timelapse GIF ${fileSizeMB}MB (${gifSize}x${gifSize}, ${(finalDuration * 2).toFixed(1)}s ping-pong @ ${speedMultiplier.toFixed(1)}x)`
        : `Timelapse GIF ${fileSizeMB}MB (${gifSize}x${gifSize}, ${finalDuration.toFixed(1)}s @ ${speedMultiplier.toFixed(1)}x)`;
      // Show the Export-Complete overlay: a looping mini preview above the Share
      // button (GIF animates via <Image>). Keep the file — the overlay needs it.
      emitAppEvent('export:complete', { uri: result.outputPath, filename: shareTitle, mediaType: 'image' });

      // Track first export for rating prompt
      await markFirstExport();

      // RESTART PLAYBACK if it was playing before export
      if (wasPlayingBeforeExportRef.current) {
        console.log('[GIF Export] ✅ Export complete, restarting playback');
        setCurrentTime(0);
        await new Promise(resolve => setTimeout(resolve, 100)); // Brief pause
        setPlaying(true);
      }
    } catch (err) {
      console.error('[GIF Export] FAILED:', err);
      CustomOverlayHelper.alert('Export Failed', err instanceof Error ? err.message : 'Unknown error');
      setExportState({ active: false, format: null, status: '', progress: null });

      // RESTART PLAYBACK on error too if it was playing
      if (wasPlayingBeforeExportRef.current) {
        console.log('[GIF Export] ❌ Export failed, restarting playback');
        setCurrentTime(0);
        setTimeout(() => setPlaying(true), 100);
      }
    }
  }, [strokes, playbackMode, speedMultiplier, holdLastFrameSeconds, pingPongMode, limitTo30s, timelineData, showMemoryWarningIfNeeded, triggerCelebration, cleanupOldExports, isPlaying, canvasPixelSize]);

  const handleExportMp4 = useCallback(async () => {
    // Reset cancel flag before starting new export
    exportCancelRef.current = false;

    // Clean up old exports first to free memory
    await cleanupOldExports();

    // PAUSE PLAYBACK AND CLEAR PREVIEW during export
    wasPlayingBeforeExportRef.current = isPlaying;
    console.log('[MP4 Export] Pausing playback (was playing:', isPlaying, ')');
    setPlaying(false);
    setCurrentTime(0);

    console.log('[MP4 Export] === STARTING FRESH MP4 EXPORT ===');
    console.log('[MP4 Export] Playback mode:', playbackMode);
    console.log('[MP4 Export] Speed multiplier:', speedMultiplier);
    console.log('[MP4 Export] Hold last frame:', holdLastFrameSeconds);
    console.log('[MP4 Export] Limit to 30s:', limitTo30s);
    console.log('[MP4 Export] Timeline durations:', {
      historical: timelineData.modes.historical.duration,
      sequential: timelineData.modes.sequential.duration,
      simultaneous: timelineData.modes.simultaneous.duration
    });

    // Calculate the ACTUAL timeline duration based on the selected playback mode
    const timelineDurationMs = playbackDurationMs; // This already respects the playback mode
    const timelineDurationSeconds = timelineDurationMs / 1000;

    console.log('[MP4 Export] Timeline duration (from playback):', timelineDurationSeconds, 'seconds');

    // Calculate export video duration based on speed
    const animationDuration = timelineDurationSeconds / speedMultiplier;
    const totalDuration = animationDuration + holdLastFrameSeconds;

    // Apply 30s limit if enabled
    let finalDuration = limitTo30s && totalDuration > 30 ? 30 : totalDuration;
    let actualAnimationDuration = limitTo30s && totalDuration > 30
      ? 30 - holdLastFrameSeconds
      : animationDuration;

    // CRITICAL: Ensure minimum video duration of 1.1 seconds for MP4 export
    const MIN_EXPORT_DURATION = 1.1;
    const effectiveDuration = isPingPong ? finalDuration * 2 : finalDuration;
    if (effectiveDuration < MIN_EXPORT_DURATION) {
      const requiredSlowdown = MIN_EXPORT_DURATION / effectiveDuration;
      console.log(`[MP4 Export] ⚠️ Duration ${effectiveDuration.toFixed(2)}s < ${MIN_EXPORT_DURATION}s, slowing down by ${requiredSlowdown.toFixed(2)}x`);

      // Slow down by increasing duration proportionally
      finalDuration = finalDuration * requiredSlowdown;
      actualAnimationDuration = actualAnimationDuration * requiredSlowdown;

      console.log(`[MP4 Export] ✅ Adjusted duration: ${(isPingPong ? finalDuration * 2 : finalDuration).toFixed(2)}s`);
    }

    // Fixed 30 FPS for smooth video
    const fps = 24; // Reduced from 30 to save memory
    const isPingPong = pingPongMode;
    const animationFrames = Math.round(actualAnimationDuration * fps);
    const holdFrames = Math.round(holdLastFrameSeconds * fps);
    const totalFrames = isPingPong ? animationFrames * 2 : animationFrames + holdFrames;

    console.log('[MP4 Export] Calculated params (MEMORY OPTIMIZED):');
    console.log('  - Animation duration:', actualAnimationDuration, 's');
    console.log('  - Hold duration:', holdLastFrameSeconds, 's');
    console.log('  - Total duration:', finalDuration, 's');
    console.log('  - Ping-pong mode:', isPingPong);
    console.log('  - Animation frames:', animationFrames);
    console.log('  - Hold frames:', holdFrames);
    console.log('  - Total frames:', totalFrames);
    console.log('  - FPS:', fps, '(optimized for memory)');
    console.log('  - Est. memory:', ((totalFrames * MP4_SIZE_HD * MP4_SIZE_HD * 4) / (1024 * 1024)).toFixed(0), 'MB');

    const shouldContinue = await showMemoryWarningIfNeeded(totalFrames, MP4_SIZE_HD);
    if (!shouldContinue) return;

    try {
      setExportState({ active: true, format: 'mp4', status: 'Preparing MP4…', progress: null });
      setExportProgress(0);

      const outputPath = `${FileSystem.cacheDirectory}timelapse-hd-${Date.now()}.mp4`;
      const statusDuration = isPingPong ? `${(finalDuration * 2).toFixed(1)}s (ping-pong)` : `${finalDuration.toFixed(1)}s`;
      const durationInfo = isPingPong ? ` (ping-pong @ ${speedMultiplier.toFixed(1)}x, ${playbackMode})` : ` (${finalDuration.toFixed(1)}s @ ${speedMultiplier.toFixed(1)}x, ${playbackMode})`;
      setExportState(prev => ({ ...prev, status: `🎥 ${MP4_SIZE_HD}p • ${fps}fps • ${statusDuration}${durationInfo}`, progress: { current: 0, total: totalFrames } }));

      // Use remapped timeline based on playback mode (like preview does!)
      // Native code will handle speed by mapping timeline to video duration
      const modePointTimes = timelineData.modes[playbackMode].pointTimes;
      let remappedStrokes = timelineData.strokes.map((stroke, strokeIndex) => {
        const times = modePointTimes[strokeIndex] ?? [];
        const remappedPoints = stroke.points.map((point, pointIndex) => ({
          ...point,
          t: times[pointIndex] ?? 0
        }));

        // Add hold frame by duplicating last point at timeline end
        if (remappedPoints.length > 0 && holdLastFrameSeconds > 0) {
          const lastPoint = remappedPoints[remappedPoints.length - 1];
          // Duplicate at timeline end - native spreads this across video duration
          remappedPoints.push({
            ...lastPoint,
            t: timelineDurationMs
          });
        }

        return { ...stroke, points: remappedPoints };
      });

      // FIRST FRAME = LAST FRAME: Prepend a static frame showing the completed painting
      // Add all strokes' final points at t=-100ms (before animation starts)
      remappedStrokes = remappedStrokes.map(stroke => {
        if (stroke.points.length > 0) {
          const lastPoint = stroke.points[stroke.points.length - 1];
          return {
            ...stroke,
            points: [
              { ...lastPoint, t: -100 }, // Show completed painting for first frame
              ...stroke.points
            ]
          };
        }
        return stroke;
      });

      // REVERSE MODE: Reverse stroke order and stroke points for backwards playback
      if (reverseMode) {
        console.log('[MP4 Export] 🔄 REVERSE MODE ENABLED - reversing strokes and points');

        // Step 1: Reverse the stroke array (last stroke becomes first)
        remappedStrokes = [...remappedStrokes].reverse();

        // Step 2: For each stroke, reverse its points and recalculate timestamps
        // The first point should now be where the last point was
        remappedStrokes = remappedStrokes.map(stroke => {
          const reversedPoints = [...stroke.points].reverse();

          // Recalculate timestamps - find the time span of original stroke
          const originalFirstTime = stroke.points[0].t;
          const originalLastTime = stroke.points[stroke.points.length - 1].t;
          const timeSpan = originalLastTime - originalFirstTime;

          // Map reversed points to new timeline positions
          // First reversed point should start where original last point was
          const recalculatedPoints = reversedPoints.map((p, index) => ({
            ...p,
            t: originalFirstTime + (timeSpan * (index / (reversedPoints.length - 1)))
          }));

          return {
            ...stroke,
            points: recalculatedPoints
          };
        });

        console.log('[MP4 Export] Reversed', remappedStrokes.length, 'strokes for backwards playback');
      }

      // PING-PONG MODE: If hold frame is 0, create reverse timeline for seamless loop
      let pingPongDuration = finalDuration;
      let pingPongAnimationDuration = actualAnimationDuration;
      if (pingPongMode) {
        console.log('[MP4 Export] 🔄 PING-PONG MODE ENABLED (hold=0)');
        // Extend each stroke's points with reverse sequence for smooth loop
        remappedStrokes = remappedStrokes.map(stroke => {
          // Create reverse points (excluding first and last to avoid duplicates at loop points)
          const reversePoints = stroke.points
            .slice(1, -1) // Exclude endpoints
            .reverse()
            .map(point => ({
              ...point,
              t: 2 * timelineDurationMs - point.t // Mirror time around timeline end
            }));

          // Extend stroke: forward points + reverse points
          return {
            ...stroke,
            points: [...stroke.points, ...reversePoints]
          };
        });

        // Double the duration for ping-pong
        pingPongDuration = finalDuration * 2;
        pingPongAnimationDuration = actualAnimationDuration * 2;
        console.log('[MP4 Export] Ping-pong: doubled duration to', pingPongDuration, 's');
        console.log('[MP4 Export] Ping-pong: timeline 0→', timelineDurationMs, '→', 2 * timelineDurationMs, 'ms');
      }

      console.log('[MP4 Export] Using remapped timeline for', playbackMode, 'mode');
      console.log('[MP4 Export] Timeline:', timelineDurationMs, 'ms');
      console.log('[MP4 Export] Video duration:', pingPongDuration, 's (animation:', pingPongAnimationDuration, 's + hold:', holdLastFrameSeconds, 's)');
      console.log('[MP4 Export] Speed:', speedMultiplier, 'x');
      console.log('[MP4 Export] Native will map', pingPongMode ? 2 * timelineDurationMs : timelineDurationMs, 'ms timeline →', pingPongDuration, 's video');
      console.log('[MP4 Export] First stroke point times (first 5):', remappedStrokes[0]?.points.slice(0, 5).map(p => p.t));
      console.log('[MP4 Export] Last stroke point times (first 5):', remappedStrokes[remappedStrokes.length - 1]?.points.slice(0, 5).map(p => p.t));

      // CRITICAL FIX: Apply adaptive resampling to match canvas rendering EXACTLY
      const resampledStrokes = remappedStrokes.map(stroke => {
        const spacing = resolveResampleSpacing(stroke);
        const resampledPoints = adaptiveResamplePoints(stroke.points, spacing);
        console.log(`[MP4 Export] Stroke ${stroke.id}: ${stroke.points.length} → ${resampledPoints.length} points (${stroke.spacing?.toFixed(2)} spacing)`);
        return {
          ...stroke,
          points: resampledPoints
        };
      });

      console.log('[MP4 Export] Calling exportTimelapse with:');
      console.log('  - strokes:', resampledStrokes.length);
      console.log('  - size:', MP4_SIZE_HD);
      console.log('  - fps:', fps);
      console.log('  - durationSeconds:', pingPongDuration);
      console.log('  - outputPath:', outputPath);
      console.log('  - Note: Native will create', totalFrames, 'frames for', pingPongDuration, 's video');

      const sizedStrokes = scaleStrokesForExport(resampledStrokes, MP4_SIZE_HD, canvasPixelSize);

      // Log custom strokes in sizedStrokes
      const customStrokesInExport = sizedStrokes.filter(s => s.emoji.startsWith('custom_brush_'));
      console.log('[MP4 Export] Custom strokes in export:', customStrokesInExport.length, 'out of', sizedStrokes.length);
      if (customStrokesInExport.length > 0) {
        console.log('[MP4 Export] Custom stroke emojis:', customStrokesInExport.map(s => s.emoji).slice(0, 5));
      }

      const result = await exportTimelapse(
        sizedStrokes,
        MP4_SIZE_HD,
        MP4_SIZE_HD,
        fps,
        pingPongDuration,
        pingPongAnimationDuration,
        outputPath
      );

      console.log('[MP4 Export] Result:', result);

      if (!result.success) throw new Error('MP4 export failed');

      setExportState({ active: false, format: null, status: '', progress: null });
      triggerCelebration();

      // Save to video storage with project linking
      try {
        const projectId = `timelapse_${Date.now()}`;
        const videoDuration = (isPingPong ? finalDuration * 2 : finalDuration) * 1000; // Convert to milliseconds
        console.log('[Timelapse Export] Saving to video storage with project link:', projectId);

        const videoMeta = await addVideoToStorage(
          result.outputPath,
          result.width,
          result.height,
          videoDuration,
          projectId
        );

        if (videoMeta) {
          console.log('[Timelapse Export] ✅ Saved to video storage:', videoMeta.id);
        }
      } catch (storageError) {
        console.error('[Timelapse Export] Failed to save to video storage:', storageError);
        // Don't block export if storage fails
      }

      // Share directly
      const shareTitle = isPingPong
        ? `Timelapse ${(finalDuration * 2).toFixed(1)}s ping-pong @ ${speedMultiplier.toFixed(1)}x (${playbackMode})`
        : `Timelapse ${finalDuration.toFixed(1)}s @ ${speedMultiplier.toFixed(1)}x (${playbackMode})`;
      // Looping mini preview above Share (MOV plays via <Video>). Keep the file.
      emitAppEvent('export:complete', { uri: result.outputPath, filename: shareTitle, mediaType: 'video' });

      // Track first export for rating prompt
      await markFirstExport();

      // RESTART PLAYBACK if it was playing before export
      if (wasPlayingBeforeExportRef.current) {
        console.log('[MP4 Export] ✅ Export complete, restarting playback');
        setCurrentTime(0);
        await new Promise(resolve => setTimeout(resolve, 100));
        setPlaying(true);
      }
    } catch (err) {
      console.error('[MP4 Export] FAILED:', err);
      CustomOverlayHelper.show({ title: 'Export Failed', message: err instanceof Error ? err.message : 'Unknown error' });
      setExportState({ active: false, format: null, status: '', progress: null });

      // RESTART PLAYBACK on error too
      if (wasPlayingBeforeExportRef.current) {
        console.log('[MP4 Export] ❌ Export failed, restarting playback');
        setCurrentTime(0);
        setTimeout(() => setPlaying(true), 100);
      }
    }
  }, [strokes, playbackMode, speedMultiplier, holdLastFrameSeconds, pingPongMode, limitTo30s, timelineData, showMemoryWarningIfNeeded, triggerCelebration, cleanupOldExports, isPlaying, canvasPixelSize]);

  const handleExportWebM = useCallback(async () => {
    // Reset cancel flag before starting new export
    exportCancelRef.current = false;

    // Clean up old exports first to free memory
    await cleanupOldExports();

    // PAUSE PLAYBACK AND CLEAR PREVIEW during export
    wasPlayingBeforeExportRef.current = isPlaying;
    console.log('[WebM Export] Pausing playback (was playing:', isPlaying, ')');
    setPlaying(false);
    setCurrentTime(0);

    console.log('[WebM Export] === STARTING WebM EXPORT ===');
    console.log('[WebM Export] Playback mode:', playbackMode);
    console.log('[WebM Export] Speed multiplier:', speedMultiplier);
    console.log('[WebM Export] Hold last frame:', holdLastFrameSeconds, 's');
    console.log('[WebM Export] Limit to 30s:', limitTo30s);

    // Calculate the ACTUAL timeline duration based on the selected playback mode (without hold frame)
    const timelineDurationMs = getModeDuration(timelineData, playbackMode);
    const timelineDurationSeconds = timelineDurationMs / 1000;

    console.log('[WebM Export] Timeline duration (from playback):', timelineDurationSeconds, 'seconds');

    // Calculate export duration based on speed
    const animationDuration = timelineDurationSeconds / speedMultiplier;
    const totalDuration = animationDuration + holdLastFrameSeconds;

    // Apply 30s limit if enabled
    let finalDuration = limitTo30s && totalDuration > 30 ? 30 : totalDuration;
    let actualAnimationDuration = limitTo30s && totalDuration > 30
      ? 30 - holdLastFrameSeconds
      : animationDuration;

    // CRITICAL: Ensure minimum video duration of 1.1 seconds for MOV export
    const MIN_EXPORT_DURATION = 1.1;
    const effectiveDuration = isPingPong ? finalDuration * 2 : finalDuration;
    if (effectiveDuration < MIN_EXPORT_DURATION) {
      const requiredSlowdown = MIN_EXPORT_DURATION / effectiveDuration;
      console.log(`[WebM Export] ⚠️ Duration ${effectiveDuration.toFixed(2)}s < ${MIN_EXPORT_DURATION}s, slowing down by ${requiredSlowdown.toFixed(2)}x`);

      // Slow down by increasing duration proportionally
      finalDuration = finalDuration * requiredSlowdown;
      actualAnimationDuration = actualAnimationDuration * requiredSlowdown;

      console.log(`[WebM Export] ✅ Adjusted duration: ${(isPingPong ? finalDuration * 2 : finalDuration).toFixed(2)}s`);
    }

    const fps = 24; // Reduced from 30 to save memory
    const isPingPong = pingPongMode;
    const totalFrames = Math.round((isPingPong ? finalDuration * 2 : finalDuration) * fps);

    console.log('[WebM Export] Calculated params (MEMORY OPTIMIZED):');
    console.log('  - Animation duration:', actualAnimationDuration, 's');
    console.log('  - Hold duration:', holdLastFrameSeconds, 's');
    console.log('  - Total duration:', finalDuration, 's');
    console.log('  - Ping-pong mode:', isPingPong);
    console.log('  - FPS:', fps, '(optimized for memory)');
    console.log('  - Total frames:', totalFrames);
    console.log('  - Est. memory:', ((totalFrames * MP4_SIZE_HD * MP4_SIZE_HD * 4) / (1024 * 1024)).toFixed(0), 'MB');

    const shouldContinue = await showMemoryWarningIfNeeded(totalFrames, MP4_SIZE_HD);
    if (!shouldContinue) return;

    try {
      setExportState({ active: true, format: 'mp4', status: '✨ Preparing Transparent…', progress: null });
      setExportProgress(0);

      const outputPath = `${FileSystem.cacheDirectory}timelapse-transparent-${Date.now()}.mov`;
      const statusDuration = isPingPong ? `${(finalDuration * 2).toFixed(1)}s (ping-pong)` : `${finalDuration.toFixed(1)}s`;
      const durationInfo = isPingPong ? ` (ping-pong @ ${speedMultiplier.toFixed(1)}x, ${playbackMode})` : ` (${finalDuration.toFixed(1)}s @ ${speedMultiplier.toFixed(1)}x, ${playbackMode})`;
      setExportState(prev => ({ ...prev, status: `✨ Transparent ${MP4_SIZE_HD}p • ${fps}fps • ${statusDuration}${durationInfo}`, progress: { current: 0, total: totalFrames } }));

      // Use remapped timeline based on playback mode (like preview does!)
      // Native code will handle speed by mapping timeline to video duration
      const modePointTimes = timelineData.modes[playbackMode].pointTimes;
      let remappedStrokes = timelineData.strokes.map((stroke, strokeIndex) => {
        const times = modePointTimes[strokeIndex] ?? [];
        const remappedPoints = stroke.points.map((point, pointIndex) => ({
          ...point,
          t: times[pointIndex] ?? 0
        }));

        // Add hold frame by duplicating last point at timeline end
        if (remappedPoints.length > 0 && holdLastFrameSeconds > 0) {
          const lastPoint = remappedPoints[remappedPoints.length - 1];
          // Duplicate at timeline end - native spreads this across video duration
          remappedPoints.push({
            ...lastPoint,
            t: timelineDurationMs
          });
        }

        return { ...stroke, points: remappedPoints };
      });

      // FIRST FRAME = LAST FRAME: Prepend a static frame showing the completed painting
      // Add all strokes' final points at t=-100ms (before animation starts)
      remappedStrokes = remappedStrokes.map(stroke => {
        if (stroke.points.length > 0) {
          const lastPoint = stroke.points[stroke.points.length - 1];
          return {
            ...stroke,
            points: [
              { ...lastPoint, t: -100 }, // Show completed painting for first frame
              ...stroke.points
            ]
          };
        }
        return stroke;
      });

      // PING-PONG MODE: Create forward + hold + reverse timeline
      let pingPongDuration = finalDuration;
      let pingPongAnimationDuration = actualAnimationDuration;
      if (pingPongMode) {
        console.log('[WebM Export] 🔄 PING-PONG MODE ENABLED (hold=' + holdLastFrameSeconds + 's)');

        // Calculate hold time in timeline milliseconds
        const holdTimeMs = holdLastFrameSeconds * 1000 * speedMultiplier;

        remappedStrokes = remappedStrokes.map(stroke => {
          const forwardPoints = stroke.points;

          // Add hold frames at 100% (duplicate last point)
          const lastPoint = forwardPoints[forwardPoints.length - 1];
          const holdPoints = holdTimeMs > 0 ? [{
            ...lastPoint,
            t: timelineDurationMs + holdTimeMs
          }] : [];

          // Create reverse points (excluding first and last to avoid duplicates)
          const reversePoints = forwardPoints
            .slice(1, -1)
            .reverse()
            .map(point => ({
              ...point,
              t: 2 * timelineDurationMs + holdTimeMs - point.t // Mirror time after hold
            }));

          // Complete sequence: forward → hold → reverse
          return {
            ...stroke,
            points: [...forwardPoints, ...holdPoints, ...reversePoints]
          };
        });

        // Duration: forward + hold + reverse
        pingPongDuration = finalDuration * 2 + holdLastFrameSeconds;
        pingPongAnimationDuration = actualAnimationDuration * 2 + holdLastFrameSeconds;
        console.log('[WebM Export] Ping-pong: total duration', pingPongDuration, 's (forward + hold + reverse)');
        console.log('[WebM Export] Ping-pong: timeline 0→', timelineDurationMs, '→ hold', holdTimeMs, 'ms →', 2 * timelineDurationMs + holdTimeMs, 'ms');
      }

      console.log('[WebM Export] Using remapped timeline for', playbackMode, 'mode');
      const finalTimelineMs = pingPongMode ? (2 * timelineDurationMs + (holdLastFrameSeconds * 1000 * speedMultiplier)) : timelineDurationMs;
      console.log('[WebM Export] Timeline:', finalTimelineMs, 'ms');
      console.log('[WebM Export] Video duration:', pingPongDuration, 's (animation:', pingPongAnimationDuration, 's + hold:', holdLastFrameSeconds, 's)');
      console.log('[WebM Export] Speed:', speedMultiplier, 'x');
      console.log('[WebM Export] Native will map', finalTimelineMs, 'ms timeline →', pingPongDuration, 's video');

      // CRITICAL FIX: Apply adaptive resampling to match canvas rendering EXACTLY
      const resampledStrokes = remappedStrokes.map(stroke => {
        const spacing = resolveResampleSpacing(stroke);
        const resampledPoints = adaptiveResamplePoints(stroke.points, spacing);
        console.log(`[WebM Export] Stroke ${stroke.id}: ${stroke.points.length} → ${resampledPoints.length} points (${stroke.spacing?.toFixed(2)} spacing)`);
        return {
          ...stroke,
          points: resampledPoints
        };
      });

      const sizedStrokes = scaleStrokesForExport(resampledStrokes, MP4_SIZE_HD, canvasPixelSize);

      // Log custom strokes in sizedStrokes
      const customStrokesInExport = sizedStrokes.filter(s => s.emoji.startsWith('custom_brush_'));
      console.log('[WebM Export] Custom strokes in export:', customStrokesInExport.length, 'out of', sizedStrokes.length);
      if (customStrokesInExport.length > 0) {
        console.log('[WebM Export] Custom stroke emojis:', customStrokesInExport.map(s => s.emoji).slice(0, 5));
      }

      console.log('[WebM Export] Calling exportWebM with:');
      console.log('  - strokes:', sizedStrokes.length);
      console.log('  - size:', MP4_SIZE_HD);
      console.log('  - fps:', fps);
      console.log('  - durationSeconds:', pingPongDuration);
      console.log('  - outputPath:', outputPath);

      const result = await exportWebM(
        sizedStrokes,
        MP4_SIZE_HD,
        MP4_SIZE_HD,
        fps,
        pingPongDuration,
        pingPongAnimationDuration,
        outputPath
      );

      console.log('[WebM Export] Result:', result);

      if (!result.success) throw new Error('WebM export failed');

      setExportState({ active: false, format: null, status: '', progress: null });
      triggerCelebration();

      const previewBuilder = async (destUri: string) => {
        console.log('[WebM Export] Generating storage preview at', destUri);
        const previewStrokes = scaleStrokesForExport(resampledStrokes, VIDEO_STORAGE_PREVIEW_SIZE, canvasPixelSize);
        const previewResult = await exportTimelapse(
          previewStrokes,
          VIDEO_STORAGE_PREVIEW_SIZE,
          VIDEO_STORAGE_PREVIEW_SIZE,
          VIDEO_STORAGE_PREVIEW_FPS,
          pingPongDuration,
          pingPongAnimationDuration,
          destUri
        );
        return {
          uri: previewResult.outputPath,
          width: VIDEO_STORAGE_PREVIEW_SIZE,
          height: VIDEO_STORAGE_PREVIEW_SIZE
        };
      };

      let videoMeta: any = null;

      try {
        const { addVideo } = require('../video/videoStorage');
        videoMeta = await addVideo(
          result.outputPath,
          MP4_SIZE_HD,
          MP4_SIZE_HD,
          pingPongDuration * 1000, // Convert to milliseconds
          undefined,
          { previewBuilder }
        );
        if (videoMeta) {
          console.log('[WebM Export] ✅ Saved to video storage:', videoMeta.id);
          await FileSystem.deleteAsync(result.outputPath, { idempotent: true }).catch(() => {});
        }
      } catch (saveError) {
        console.error('[WebM Export] Failed to save to video storage:', saveError);
      }

      const shareablePath = videoMeta?.uri ?? result.outputPath;

      // WORDING MODE: Navigate back to Paint screen with video path (skip share dialog)
      if (route.params?.wordingMode && route.params?.wordingLetterIndex !== undefined) {
        const letterIndex = route.params.wordingLetterIndex;
        console.log(`[WebM Export] 🎯 Wording mode: Navigating back to Paint with video for letter ${letterIndex}`);

        // CRITICAL FIX: Reset auto-export flag so next letter can trigger export
        autoExportTriggeredRef.current = false;

        navigation.navigate('Paint', {
          wordingVideoPath: shareablePath,
          wordingLetterIndex: letterIndex
        });
        return;
      }

      // NORMAL MODE: show the Export-Complete overlay — looping preview + Share +
      // "Open in AR". This is the TRANSPARENT (HEVC+alpha) MOV, so placing it on a
      // wall in AR is genuinely see-through. (Replaces the old emoji-spray panel.)
      setMovFilePath(shareablePath);
      setMovFileIsTemp(!videoMeta);
      emitAppEvent('export:complete', {
        uri: shareablePath.startsWith('file://') ? shareablePath : `file://${shareablePath}`,
        filename: 'Transparent Timelapse.mov',
        mediaType: 'video',
      });
    } catch (err) {
      console.error('[WebM Export] FAILED:', err);
      CustomOverlayHelper.alert('Export Failed', err instanceof Error ? err.message : 'Unknown error');
      setExportState({ active: false, format: null, status: '', progress: null });

      // RESTART PLAYBACK on error
      if (wasPlayingBeforeExportRef.current) {
        console.log('[WebM Export] ❌ Export failed, restarting playback');
        setCurrentTime(0);
        setTimeout(() => setPlaying(true), 100);
      }
    }
  }, [strokes, playbackMode, speedMultiplier, holdLastFrameSeconds, pingPongMode, limitTo30s, timelineData, showMemoryWarningIfNeeded, triggerCelebration, cleanupOldExports, isPlaying, canvasPixelSize]);

  const handleExportPng = useCallback(async (selectedSize: number) => {
    // Reset cancel flag before starting new export
    exportCancelRef.current = false;

    // Clean up old exports first to free memory
    await cleanupOldExports();

    // PAUSE PLAYBACK AND CLEAR PREVIEW during export
    wasPlayingBeforeExportRef.current = isPlaying;
    setPlaying(false);
    setCurrentTime(0);

    // Determine quality label
    const qualityLabel = selectedSize === 2048 ? '2K' : selectedSize === 4096 ? '4K' : selectedSize === 8192 ? '8K' : '16K';

    try {
      setExportState({ active: true, format: 'png', status: `Generating ${qualityLabel} ultra-HD frame...`, progress: null });
      setExportProgress(0);

      // Generate single frame showing final state (all strokes) at selected resolution
      const scaledStrokes = scaleStrokesForExport(strokes, selectedSize, canvasPixelSize);
      const frames = await generatePreviewFrames(
        scaledStrokes,
        selectedSize,
        selectedSize,
        1
      );
      const outputPath = `${FileSystem.cacheDirectory}snapshot-${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(outputPath, frames[0].base64, { encoding: FileSystem.EncodingType.Base64 });

      setExportState({ active: false, format: null, status: '', progress: null });
      triggerCelebration();

      // Store PNG path and show options modal
      setPngFilePath(outputPath);
      setShowPngOptions(true);

      // RESTART PLAYBACK if it was playing before export
      if (wasPlayingBeforeExportRef.current) {
        setCurrentTime(0);
        await new Promise(resolve => setTimeout(resolve, 100));
        setPlaying(true);
      }
    } catch (err) {
      console.error('PNG export failed:', err);
      CustomOverlayHelper.alert('Export Failed', err instanceof Error ? err.message : 'Unknown error');
      setExportState({ active: false, format: null, status: '', progress: null });

      // RESTART PLAYBACK on error
      if (wasPlayingBeforeExportRef.current) {
        setCurrentTime(0);
        setTimeout(() => setPlaying(true), 100);
      }
    }
  }, [strokes, triggerCelebration, cleanupOldExports, isPlaying, canvasPixelSize]);

  const handleExportZip = useCallback(async () => {
    // Reset cancel flag before starting new export
    exportCancelRef.current = false;

    // Clean up old exports first to free memory
    await cleanupOldExports();

    // PAUSE PLAYBACK AND CLEAR PREVIEW during export
    wasPlayingBeforeExportRef.current = isPlaying;
    setPlaying(false);
    setCurrentTime(0);

    // Export each stroke as a separate frame (progressive build-up)
    const totalFrames = strokes.length;
    const shouldContinue = await showMemoryWarningIfNeeded(totalFrames, PNG_EXPORT_SIZE);
    if (!shouldContinue) {
      // User cancelled - restore playback if it was playing
      if (wasPlayingBeforeExportRef.current) {
        setCurrentTime(0);
        setTimeout(() => setPlaying(true), 100);
      }
      return;
    }

    try {
      setExportState({ active: true, format: 'zip', status: `Generating ${totalFrames} stroke frames...`, progress: { current: 0, total: totalFrames } });
      setExportProgress(0);
      const zip = new JSZip();
      const framesFolder = zip.folder('frames');
      if (!framesFolder) throw new Error('Failed to create ZIP folder');

      const scaledStrokes = scaleStrokesForExport(strokes, PNG_EXPORT_SIZE, canvasPixelSize);

      // Generate each frame showing strokes progressively (frame 0 = no strokes, frame 1 = first stroke, etc.)
      for (let frameIndex = 0; frameIndex <= totalFrames; frameIndex++) {
        setExportState(prev => ({
          ...prev,
          status: `Generating frame ${frameIndex + 1}/${totalFrames + 1}...`,
          progress: { current: frameIndex, total: totalFrames + 1 }
        }));

        // Take only the strokes up to this frame
        const strokesUpToFrame = scaledStrokes.slice(0, frameIndex);

        // Generate a single frame with these strokes
        const frames = await generatePreviewFrames(
          strokesUpToFrame,
          PNG_EXPORT_SIZE,
          PNG_EXPORT_SIZE,
          1 // Just one frame showing final state
        );

        if (frames.length > 0) {
          const fileName = `frame-${frameIndex.toString().padStart(4, '0')}.png`;
          framesFolder.file(fileName, frames[0].base64, { base64: true });
        }
      }

      setExportState(prev => ({ ...prev, status: 'Compressing ZIP...', progress: null }));
      const zipBlob = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const outputPath = `${FileSystem.cacheDirectory}stroke-sequence-${Date.now()}.zip`;
      await FileSystem.writeAsStringAsync(outputPath, zipBlob, { encoding: FileSystem.EncodingType.Base64 });

      setExportState({ active: false, format: null, status: '', progress: null });
      triggerCelebration();

      // Share directly
      await Sharing.shareAsync(outputPath, {
        mimeType: 'application/zip',
        dialogTitle: `PNG Sequence (${totalFrames + 1} frames)`
      });

      // Clean up after sharing
      await FileSystem.deleteAsync(outputPath, { idempotent: true }).catch(() => {});

      // RESTART PLAYBACK if it was playing before export
      if (wasPlayingBeforeExportRef.current) {
        setCurrentTime(0);
        await new Promise(resolve => setTimeout(resolve, 100));
        setPlaying(true);
      }
    } catch (err) {
      console.error('ZIP export failed:', err);
      CustomOverlayHelper.alert('Export Failed', err instanceof Error ? err.message : 'Unknown error');
      setExportState({ active: false, format: null, status: '', progress: null });

      // RESTART PLAYBACK on error
      if (wasPlayingBeforeExportRef.current) {
        setCurrentTime(0);
        setTimeout(() => setPlaying(true), 100);
      }
    }
  }, [strokes, showMemoryWarningIfNeeded, triggerCelebration, cleanupOldExports, isPlaying, canvasPixelSize]);

  const handleCancelExport = useCallback(() => {
    exportCancelRef.current = true;
    cancelExport(); // Call native cancel method
    setExportState({ active: false, format: null, status: '', progress: null });
  }, []);

  const cleanupMovFile = useCallback(async () => {
    if (movFilePath && movFileIsTemp) {
      await FileSystem.deleteAsync(movFilePath, { idempotent: true }).catch(() => {});
    }
    setMovFilePath(null);
    setMovFileIsTemp(false);
  }, [movFilePath, movFileIsTemp]);

  // Handle MOV export options
  const handleMovSendToEmojispray = useCallback(async () => {
    if (!movFilePath) return;

    try {
      const bridge = getEmojisprayBridge();
      if (!bridge) {
        CustomOverlayHelper.alert('Error', 'Emojispray bridge not available');
        return;
      }

      console.log('[TimelapseScreen] Calling EmojisprayBridge.sendToEmojispray with path:', movFilePath);
      const result = await bridge.sendToEmojispray(movFilePath);
      console.log('[TimelapseScreen] Emojispray result:', result);

      if (result.status === 'opened') {
        console.log('[TimelapseScreen] ✓ Video successfully sent to app');
      } else if (result.status === 'cancelled') {
        console.log('[TimelapseScreen] User cancelled app selection');
      } else if (result.status === 'not_installed') {
        CustomOverlayHelper.alert('No Apps Available', 'No apps are installed that can open MOV files. Make sure Emojispray is installed.');
      } else {
        CustomOverlayHelper.alert('Failed', 'Could not send to Emojispray');
      }
    } catch (error) {
      console.error('[TimelapseScreen] Emojispray error:', error);
      CustomOverlayHelper.alert('Error', 'Failed to send to Emojispray');
    } finally {
      setShowMovOptions(false);
      await cleanupMovFile();

      if (wasPlayingBeforeExportRef.current) {
        console.log('[MOV] Restarting playback after send to Emojispray');
        setCurrentTime(0);
        setTimeout(() => setPlaying(true), 100);
      }
    }
  }, [movFilePath, cleanupMovFile]);

  const handleMovShare = useCallback(async () => {
    if (!movFilePath) return;

    try {
      await Sharing.shareAsync(movFilePath, {
        mimeType: 'video/quicktime',
        dialogTitle: 'Transparent Timelapse MOV'
      });
    } catch (error) {
      console.error('[TimelapseScreen] Share error:', error);
      CustomOverlayHelper.alert('Error', 'Failed to share video');
    } finally {
      setShowMovOptions(false);
      await cleanupMovFile();

      if (wasPlayingBeforeExportRef.current) {
        console.log('[MOV] Restarting playback after share');
        setCurrentTime(0);
        setTimeout(() => setPlaying(true), 100);
      }
    }
  }, [movFilePath, cleanupMovFile]);

  const handleCloseMovOptions = useCallback(() => {
    setShowMovOptions(false);
    cleanupMovFile();

    if (wasPlayingBeforeExportRef.current) {
      console.log('[MOV] Restarting playback after cancel');
      setCurrentTime(0);
      setTimeout(() => setPlaying(true), 100);
    }
  }, [cleanupMovFile]);

  // PNG export options handlers
  const cleanupPngFile = useCallback(async () => {
    if (pngFilePath) {
      await FileSystem.deleteAsync(pngFilePath, { idempotent: true }).catch(() => {});
    }
    setPngFilePath(null);
  }, [pngFilePath]);

  const handlePngSendToEmojispray = useCallback(async () => {
    if (!pngFilePath) return;

    try {
      const result = await sendImageToEmojispray(pngFilePath);
      if (result === 'not_installed') {
        CustomOverlayHelper.alert('Emojispray not installed', 'Install Emojispray from the App Store to drop this artwork into AR.');
      } else if (result === 'failed') {
        CustomOverlayHelper.alert('Emojispray unavailable', 'Could not hand off to Emojispray.');
      }
    } catch (error) {
      console.error('[TimelapseScreen] Emojispray error:', error);
      CustomOverlayHelper.alert('Error', 'Failed to send to Emojispray');
    } finally {
      setShowPngOptions(false);
      await cleanupPngFile();
    }
  }, [pngFilePath, cleanupPngFile]);

  const handlePngShare = useCallback(async () => {
    if (!pngFilePath) return;

    try {
      await Sharing.shareAsync(pngFilePath, {
        mimeType: 'image/png',
        dialogTitle: 'Ultra-HD PNG Export'
      });
    } catch (error) {
      console.error('[TimelapseScreen] Share error:', error);
      CustomOverlayHelper.alert('Error', 'Failed to share image');
    } finally {
      setShowPngOptions(false);
      await cleanupPngFile();
    }
  }, [pngFilePath, cleanupPngFile]);

  const handleClosePngOptions = useCallback(() => {
    setShowPngOptions(false);
    cleanupPngFile();
  }, [cleanupPngFile]);

  const handleBack = useCallback(() => {
    leavingRef.current = true;
    Animated.spring(paletteScale, { toValue: 0.95, useNativeDriver: true }).start(() => {
      navigation.goBack();
    });
  }, [navigation, paletteScale]);

  if (loading) {
    return (
      <AnimatedLoader
        progress={loadingProgress > 0 ? loadingProgress * 100 : undefined}
        message={loadingPhase || 'Loading Timelapse...'}
        showProgressBar={loadingProgress > 0}
        useLogoAnimation={false}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadStrokes}>
            <Text style={styles.retryButtonText}>🔄 Retry</Text>
          </TouchableOpacity>
        </View>
        {/* Close button — fixed top-right */}
        <View style={styles.closeButtonFixed}>
          <TouchableOpacity
            onPress={() => { triggerHelper('close'); handleBack(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.closeButtonText}>❎</Text>
          </TouchableOpacity>
          <HelperRing visible={activeHelperKey === 'close' && helperModeEnabled} />
          <HelperLabel text="Close" visible={activeHelperKey === 'close'} position="below" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CelebrationOverlay state={celebrationState} />
      {/* Content */}
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={[
          styles.scrollContentInner,
          isIPad && styles.scrollContentInnerIPad
        ]}
      >
        {/* Player - Shows strokes growing stamp-by-stamp */}
        <View style={[styles.playerContainer, isIPad && styles.playerContainerIPad]}>
          <View style={[styles.player, isIPad && styles.playerIPad, { width: canvasRenderSize, height: canvasRenderSize, justifyContent: 'center', alignItems: 'center' }]}>
            {strokes.length > 0 && !leavingRef.current ? (
              <View
                style={{
                  width: originalCanvasSize,
                  height: originalCanvasSize,
                  transform: [{ scale: canvasRenderSize / originalCanvasSize }],
                }}
              >
                <TransparentEmojiCanvas
                  width={originalCanvasSize}
                  height={originalCanvasSize}
                  /* Smudge with a baked tile blits cheaply (shows in the preview). Any smudge stroke
                     WITHOUT a tile is skipped, so it can never fall back to per-frame CPU re-bake
                     (which froze playback ~30s). */
                  strokes={visibleStrokes.filter((s) => !s.isSmudge || !!s.bakedTile)}
                />
              </View>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: '#888', fontFamily: BASE_FONT_FAMILY }}>
                  {leavingRef.current ? '' : 'No strokes'}
                </Text>
              </View>
            )}
            {/* Mode switching overlay */}
            {isModeSwitching && (
              <View style={styles.modeSwitchingOverlay}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.modeSwitchingText}>Switching mode...</Text>
              </View>
            )}
          </View>
        </View>

        {/* Playback Controls (Play/Pause removed; autoplay only) */}
        <View style={[styles.controlsCard, isIPad && styles.controlsCardIPad]}>
          {/* Debug Info */}
          <View style={styles.sliderContainer}>
            {/* Removed playing state row */}
            <Text style={[styles.sliderLabel, { fontSize: 9, color: '#666' }]}>
              Strokes: {visibleStrokes.length}/{strokes.length} | Points: {visibleStrokes.reduce((sum, s) => sum + s.points.length, 0)}/{strokes.reduce((sum, s) => sum + s.points.length, 0)}
            </Text>
          </View>

          {/* Playback Mode Selector */}
          <View style={[styles.sliderContainer, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <Text style={styles.sliderLabel}>
              Playback {speedMultiplier.toFixed(1)}x {isModeSwitching ? '🔄' : ''}
            </Text>
            <View style={[styles.modeSelector, { justifyContent: 'flex-end' }]}>
              <View style={{ position: 'relative' }}>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  { flex: 0, paddingHorizontal: 16 },
                  playbackMode === 'sequential' && styles.modeButtonActive,
                  isModeSwitching && styles.modeButtonDisabled
                ]}
                onPress={async () => {
                  triggerHelper('playback_sequential');
                  if (playbackMode !== 'sequential' && !isModeSwitching) {
                    console.log('[TimelapseScreen] 🔄 MODE SWITCH: sequential');
                    setIsModeSwitching(true);
                    setPlaying(false);
                    setCurrentTime(0);
                    updateInteraction();

                    // Allow UI to update
                    await new Promise(resolve => setTimeout(resolve, 100));

                    setPlaybackMode('sequential');
                    console.log('[TimelapseScreen] Mode set to sequential, waiting for settle...');

                    // Wait for timeline to update
                    await new Promise(resolve => setTimeout(resolve, 300));

                    console.log('[TimelapseScreen] ✓ Mode switch complete, resuming');
                    setIsModeSwitching(false);
                    setPlaying(true);
                  }
                }}
                disabled={isModeSwitching}
              >
                <Text style={[styles.modeButtonText, playbackMode === 'sequential' && styles.modeButtonTextActive]}>
                  ↗️
                </Text>
              </TouchableOpacity>
              <HelperRing visible={activeHelperKey === 'playback_sequential' && helperModeEnabled} />
              <HelperLabel text="Sequential" visible={activeHelperKey === 'playback_sequential'} position="above" />
              </View>
              <View style={{ position: 'relative' }}>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  { flex: 0, paddingHorizontal: 16 },
                  playbackMode === 'simultaneous' && styles.modeButtonActive,
                  isModeSwitching && styles.modeButtonDisabled
                ]}
                onPress={async () => {
                  triggerHelper('playback_simultaneous');
                  if (playbackMode !== 'simultaneous' && !isModeSwitching) {
                    console.log('[TimelapseScreen] 🔄 MODE SWITCH: simultaneous');
                    setIsModeSwitching(true);
                    setPlaying(false);
                    setCurrentTime(0);
                    updateInteraction();

                    await new Promise(resolve => setTimeout(resolve, 100));

                    setPlaybackMode('simultaneous');
                    console.log('[TimelapseScreen] Mode set to simultaneous, waiting for settle...');

                    await new Promise(resolve => setTimeout(resolve, 300));

                    console.log('[TimelapseScreen] ✓ Mode switch complete, resuming');
                    setIsModeSwitching(false);
                    setPlaying(true);
                  }
                }}
                disabled={isModeSwitching}
              >
                <Text style={[styles.modeButtonText, playbackMode === 'simultaneous' && styles.modeButtonTextActive]}>
                  ⚡
                </Text>
              </TouchableOpacity>
              <HelperRing visible={activeHelperKey === 'playback_simultaneous' && helperModeEnabled} />
              <HelperLabel text="Simultaneous" visible={activeHelperKey === 'playback_simultaneous'} position="above" />
              </View>
              <View style={{ position: 'relative' }}>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  { flex: 0, paddingHorizontal: 16 },
                  playbackMode === 'historical' && styles.modeButtonActive,
                  isModeSwitching && styles.modeButtonDisabled
                ]}
                onPress={async () => {
                  triggerHelper('playback_historical');
                  if (playbackMode !== 'historical' && !isModeSwitching) {
                    console.log('[TimelapseScreen] 🔄 MODE SWITCH: historical');
                    setIsModeSwitching(true);
                    setPlaying(false);
                    setCurrentTime(0);
                    updateInteraction();

                    await new Promise(resolve => setTimeout(resolve, 100));

                    setPlaybackMode('historical');
                    console.log('[TimelapseScreen] Mode set to historical, waiting for settle...');

                    await new Promise(resolve => setTimeout(resolve, 300));

                    console.log('[TimelapseScreen] ✓ Mode switch complete, resuming');
                    setIsModeSwitching(false);
                    setPlaying(true);
                  }
                }}
                disabled={isModeSwitching}
              >
                <Text style={[styles.modeButtonText, playbackMode === 'historical' && styles.modeButtonTextActive]}>
                  🕐
                </Text>
              </TouchableOpacity>
              <HelperRing visible={activeHelperKey === 'playback_historical' && helperModeEnabled} />
              <HelperLabel text="Historical" visible={activeHelperKey === 'playback_historical'} position="above" />
              </View>
            </View>
          </View>

          {/* Animation Speed and Hold Time Sliders - side by side on iPad landscape */}
          <View style={isIPad && isLandscape ? { flexDirection: 'row', gap: 12 } : {}}>
            {/* Animation Speed Slider */}
            <View style={[styles.sliderContainer, isIPad && isLandscape && { flex: 1 }]}>
              <Slider
                style={styles.sliderSmall}
                minimumValue={0.1}
                maximumValue={maxSpeedValue}
                value={Number.isFinite(speedMultiplier) ? Math.max(0.1, Math.min(speedMultiplier, maxSpeedValue)) : 1}
                onValueChange={(value) => {
                  const newSpeed = Math.round(value * 10) / 10;
                  console.log('[Speed Slider] Changing speed:', speedMultiplier, '→', newSpeed);
                  setSpeedMultiplier(newSpeed);
                  updateInteraction();
                  // Ensure playback stays active
                  if (!isPlaying) {
                    setPlaying(true);
                  }
                }}
                minimumTrackTintColor="#007AFF"
                maximumTrackTintColor="#E0E0E0"
                thumbTintColor="#007AFF"
                step={0.1}
              />
              <View style={styles.sliderLabels}>
                <View style={styles.speedLabelRow}>
                  <Text style={styles.sliderLabelText}>🐌</Text>
                  <Text style={styles.sliderSpeedText}>{speedTypeLabel}</Text>
                </View>
                <Text style={styles.sliderLabelText}>🚀</Text>
              </View>
            </View>

            {/* Hold Last Frame Slider */}
            <View style={[styles.sliderContainer, isIPad && isLandscape && { flex: 1 }]}>
              <Slider
                style={styles.sliderSmall}
                minimumValue={0}
                maximumValue={5}
                value={Number.isFinite(holdLastFrameSeconds) ? Math.max(0, Math.min(holdLastFrameSeconds, 5)) : 0}
                onValueChange={(value) => {
                  const rounded = Math.round(value * 2) / 2; // Round to 0.5 increments
                  console.log('[Hold Slider] Changing hold time:', holdLastFrameSeconds, '→', rounded);
                  setHoldLastFrameSeconds(rounded);
                  updateInteraction();
                  // Ensure playback stays active and loops properly
                  if (!isPlaying) {
                    setPlaying(true);
                  }
                }}
                minimumTrackTintColor="#007AFF"
                maximumTrackTintColor="#E0E0E0"
                thumbTintColor="#007AFF"
                step={0.5}
              />
              <View style={styles.sliderLabels}>
                <Text style={styles.sliderLabelText}>⏸️ Hold: {holdLastFrameSeconds}s</Text>
              </View>
            </View>
          </View>

          {/* Duration Limit Toggle with Ping-Pong Button */}
          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>⏱️ {limitTo30s ? '30s max' : 'Full'}</Text>
            <View style={styles.modeSelector}>
              <TouchableOpacity
                style={[styles.modeButton, !limitTo30s && styles.modeButtonActive]}
                onPress={() => { setLimitTo30s(false); updateInteraction(); }}
              >
                <Text style={[styles.modeButtonText, !limitTo30s && styles.modeButtonTextActive]}>
                  ♾️
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeButton, limitTo30s && styles.modeButtonActive]}
                onPress={() => { setLimitTo30s(true); updateInteraction(); }}
              >
                <Text style={[styles.modeButtonText, limitTo30s && styles.modeButtonTextActive]}>
                  ⏱️
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeButton, pingPongMode && styles.modeButtonActive]}
                onPress={() => { setPingPongMode(!pingPongMode); updateInteraction(); }}
              >
                <Text style={[styles.modeButtonText, pingPongMode && styles.modeButtonTextActive]}>
                  🏓
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeButton, reverseMode && styles.modeButtonActive]}
                onPress={() => { setReverseMode(!reverseMode); updateInteraction(); }}
              >
                <Text style={[styles.modeButtonText, reverseMode && styles.modeButtonTextActive]}>
                  🔙
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Output Duration Info with Inline Export Button */}
          <View style={styles.durationInfoRow}>
            <View style={styles.durationInfoContainer}>
              <Text style={styles.durationInfoText}>
                Output: {outputVideoDuration.toFixed(1)}s {pingPongMode ? '(ping-pong)' : ''}
              </Text>
            </View>

            {/* Animated Export Button - cycles through 7 animation styles */}
            <View style={{ position: 'relative' }}>
              <Animated.View style={[styles.inlineExportButtonContainer, getExportButtonAnimatedStyle()]}>
                <TouchableOpacity
                  style={[styles.inlineExportButton, exportState.active && styles.exportButtonDisabled]}
                  onPress={() => { triggerHelper('timelapse_export'); showExportFormatPicker(); }}
                  disabled={exportState.active}
                >
                  <Text style={styles.inlineExportButtonText}>📤</Text>
                </TouchableOpacity>
              </Animated.View>
              <ButtonGlow counter={glowCounters.timelapse_export ?? 0} enabled={tutorialModeEnabled} />
              <HelperRing visible={activeHelperKey === 'timelapse_export' && helperModeEnabled} />

              <HelperLabel text="Export video" visible={activeHelperKey === 'timelapse_export'} position="above" />
            </View>
          </View>
        </View>

        {/* Export Status Box */}
        {exportState.active && (
          <View style={[styles.exportStatusCard, isIPad && styles.exportStatusCardIPad]}>
            <Text style={styles.exportStatusText}>{exportState.status}</Text>
            {exportState.progress && (
              <View style={styles.exportProgressContainer}>
                <View style={styles.exportProgressBar}>
                  <View style={[styles.exportProgressFill, { width: `${(exportState.progress.current / exportState.progress.total) * 100}%` }]} />
                </View>
                <Text style={styles.exportProgressText}>{exportState.progress.current} / {exportState.progress.total}</Text>
              </View>
            )}
            <TypewriterAbortButton onPress={handleCancelExport} />
          </View>
        )}
      </ScrollView>

      {/* Export Options Overlay */}
      <Modal
        visible={showExportOptions}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExportOptions(false)}
        supportedOrientations={['portrait', 'landscape']}
      >
        <TouchableOpacity
          style={styles.overlayBackground}
          activeOpacity={1}
          onPress={() => setShowExportOptions(false)}
        >
          <View style={styles.overlayPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.overlayTitle}>Export Timelapse</Text>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={() => { setShowExportOptions(false); handleExportGif(); }}
            >
              <Text style={styles.overlayButtonText}>🖼️ GIF 512x512</Text>
            </TouchableOpacity>

            {/* MP4 export hidden - keeping only MOV for video exports */}
            {/* <TouchableOpacity
              style={styles.overlayButton}
              onPress={() => { setShowExportOptions(false); handleExportMp4(); }}
            >
              <Text style={styles.overlayButtonText}>🎥 MP4 (4096p Ultra HD)</Text>
            </TouchableOpacity> */}

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={() => { setShowExportOptions(false); handleExportWebM(); }}
            >
              <Text style={styles.overlayButtonText}>✨ MOV (4096p Transparent)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={() => {
                console.log('[PNG Export] Exporting PNG at', pngExportSize, 'quality');
                setShowExportOptions(false);
                handleExportPng(pngExportSize);
              }}
            >
              <Text style={styles.overlayButtonText}>📷 Export PNG ({pngExportSize === 4096 ? '4K' : pngExportSize === 8192 ? '8K' : '16K'})</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={() => { setShowExportOptions(false); handleExportZip(); }}
            >
              <Text style={styles.overlayButtonText}>📦 PNG Sequence (ZIP)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayButton, styles.overlayCancelButton]}
              onPress={() => setShowExportOptions(false)}
            >
              <Text style={[styles.overlayButtonText, styles.overlayCancelButtonText]}>❌ Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MOV Options Overlay */}
      <Modal
        visible={showMovOptions}
        transparent
        animationType="fade"
        onRequestClose={handleCloseMovOptions}
        supportedOrientations={['portrait', 'landscape']}
      >
        <TouchableOpacity
          style={styles.overlayBackground}
          activeOpacity={1}
          onPress={handleCloseMovOptions}
        >
          <View style={styles.overlayPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.overlayTitle}>MOV Export Complete</Text>
            <Text style={styles.overlaySubtitle}>Choose what to do with your video:</Text>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={handleMovSendToEmojispray}
            >
              <Text style={styles.overlayButtonText}>🎨 Send to Emojispray</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={handleMovShare}
            >
              <Text style={styles.overlayButtonText}>📤 Share</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={async () => {
                setShowMovOptions(false);
                await cleanupMovFile();
                navigation.navigate('VideoStorage');
                if (wasPlayingBeforeExportRef.current) {
                  console.log('[MOV] Restarting playback after video storage');
                  setCurrentTime(0);
                  setTimeout(() => setPlaying(true), 100);
                }
              }}
            >
              <Text style={styles.overlayButtonText}>📹 Video Storage</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayButton, styles.overlayCancelButton]}
              onPress={handleCloseMovOptions}
            >
              <Text style={[styles.overlayButtonText, styles.overlayCancelButtonText]}>❌ Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* PNG Quality Selection Overlay */}
      <Modal
        visible={showPngQualityOptions}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPngQualityOptions(false)}
        supportedOrientations={['portrait', 'landscape']}
      >
        <TouchableOpacity
          style={styles.overlayBackground}
          activeOpacity={1}
          onPress={() => {
            console.log('[PNG Export] Quality modal dismissed via background tap');
            setShowPngQualityOptions(false);
          }}
        >
          <View style={styles.overlayPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.overlayTitle}>Choose PNG Quality</Text>
            <Text style={styles.overlaySubtitle}>Higher = better detail & larger file</Text>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={() => { setShowPngQualityOptions(false); handleExportPng(4096); }}
            >
              <Text style={styles.overlayButtonText}>4K</Text>
              <Text style={styles.overlayButtonSubtext}>4096×4096 - Balanced quality</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={() => { setShowPngQualityOptions(false); handleExportPng(8192); }}
            >
              <Text style={styles.overlayButtonText}>8K</Text>
              <Text style={styles.overlayButtonSubtext}>8192×8192 - High quality</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={() => { setShowPngQualityOptions(false); handleExportPng(16384); }}
            >
              <Text style={styles.overlayButtonText}>16K</Text>
              <Text style={styles.overlayButtonSubtext}>16384×16384 - Maximum quality (slow)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayButton, styles.overlayCancelButton]}
              onPress={() => setShowPngQualityOptions(false)}
            >
              <Text style={[styles.overlayButtonText, styles.overlayCancelButtonText]}>❌ Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* PNG Export Options Overlay */}
      <Modal
        visible={showPngOptions}
        transparent
        animationType="fade"
        onRequestClose={handleClosePngOptions}
        supportedOrientations={['portrait', 'landscape']}
      >
        <TouchableOpacity
          style={styles.overlayBackground}
          activeOpacity={1}
          onPress={handleClosePngOptions}
        >
          <View style={styles.overlayPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.overlayTitle}>PNG Export Complete</Text>
            <Text style={styles.overlaySubtitle}>Choose what to do with your image:</Text>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={handlePngShare}
            >
              <Text style={styles.overlayButtonText}>📤 Share</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayButton}
              onPress={handlePngSendToEmojispray}
            >
              <Text style={styles.overlayButtonText}>✨ Send to Emojispray</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayButton, styles.overlayCancelButton]}
              onPress={handleClosePngOptions}
            >
              <Text style={[styles.overlayButtonText, styles.overlayCancelButtonText]}>❌ Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Export Progress Loader */}
      {exportState.active && (
        <AnimatedLoader
          progress={exportProgress}
          message={exportState.status || 'Exporting timelapse...'}
          showProgressBar={true}
          showAbortButton={true}
          onAbort={handleCancelExport}
          speed={0.67}
        />
      )}

      {/* Close button — fixed top-right, always visible */}
      <View style={styles.closeButtonFixed}>
        <TouchableOpacity
          onPress={() => { triggerHelper('close'); handleBack(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.closeButtonText}>❎</Text>
        </TouchableOpacity>
        <HelperRing visible={activeHelperKey === 'close' && helperModeEnabled} />
        <HelperLabel text="Close" visible={activeHelperKey === 'close'} position="below" />
      </View>

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0c0c' },
  scrollContent: { flex: 1 },
  scrollContentInner: {
    padding: 12,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 32,
  },
  scrollContentInnerIPad: {
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, fontSize: 16, color: '#666', fontFamily: BASE_FONT_FAMILY },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  errorText: { fontSize: 16, color: '#FF3B30', textAlign: 'center', marginBottom: 16, fontFamily: BASE_FONT_FAMILY },
  retryButton: { paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#007AFF', borderRadius: 8 },
  retryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', fontFamily: BASE_FONT_FAMILY },
  playerContainer: { alignItems: 'center', marginBottom: 12, position: 'relative' },
  playerContainerIPad: {
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  player: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#050a15' },
  playerIPad: {
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  closeButtonFixed: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 16,
    right: 52,
    zIndex: 9999,
  },
  // Play/Pause removed; styles kept for reference but unused
  playPauseButton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#404040',
  },
  playPauseButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  playPauseButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: BASE_FONT_FAMILY,
  },
  progressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  progressCard: {
    backgroundColor: 'rgba(20,20,25,0.92)',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 16,
    minWidth: 260,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  progressEmoji: {
    fontSize: 36,
    marginBottom: 6,
  },
  progressTitle: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 10,
    fontFamily: BASE_FONT_FAMILY,
  },
  progressNumbers: {
    color: '#cbd5e1',
    fontSize: 13,
    marginTop: 8,
    fontFamily: BASE_FONT_FAMILY,
  },
  closeButtonText: { fontSize: 26, lineHeight: 30, color: '#FFFFFF', fontFamily: BASE_FONT_FAMILY },
  controlsCard: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 8, marginBottom: 8 },
  controlsCardIPad: { padding: 10, marginBottom: 10 },
  controlRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8 },
  playButton: { backgroundColor: '#007AFF', paddingHorizontal: 24, paddingVertical: 8, borderRadius: 6 },
  playButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', fontFamily: BASE_FONT_FAMILY },
  sliderContainer: { marginBottom: 6 },
  sliderContainerDisabled: { opacity: 0.4 },
  sliderLabel: { fontSize: 11, color: '#CCCCCC', marginBottom: 3, fontFamily: BASE_FONT_FAMILY },
  slider: { width: '100%', height: 32 },
  sliderSmall: { width: '100%', height: 24 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabelText: { fontSize: 12, color: '#999999', fontFamily: BASE_FONT_FAMILY },
  speedLabelRow: { flexDirection: 'row', alignItems: 'center' },
  sliderSpeedText: { marginLeft: 6, fontSize: 10, color: '#7dd3fc', fontFamily: BASE_FONT_FAMILY, letterSpacing: 0.6, textTransform: 'uppercase' },
  durationInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 8 },
  durationInfoContainer: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#1a1a1a', borderRadius: 8, borderWidth: 1, borderColor: '#333' },
  durationInfoText: { fontSize: 13, color: '#7dd3fc', fontFamily: BASE_FONT_FAMILY, fontWeight: '600', textAlign: 'center' },
  inlineExportButtonContainer: {
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    elevation: 5,
    borderRadius: 8
  },
  inlineExportButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)'
  },
  inlineExportButtonText: {
    fontSize: 24,
    color: '#FFFFFF'
  },
  modeSelector: { flexDirection: 'row', gap: 4, marginBottom: 2 },
  modeButton: { flex: 1, paddingVertical: 6, paddingHorizontal: 4, backgroundColor: '#2a2a2a', borderRadius: 6, alignItems: 'center' },
  // Black theme with clear selected contrast
  modeButtonActive: { backgroundColor: '#000000', borderColor: '#FFFFFF', borderWidth: 1 },
  modeButtonDisabled: { opacity: 0.4 },
  modeButtonText: { fontSize: 18, color: '#AAAAAA', fontWeight: '500', fontFamily: BASE_FONT_FAMILY },
  modeButtonTextActive: { color: '#FFFFFF', fontWeight: '700' },
  modeSwitchingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  modeSwitchingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
    fontFamily: BASE_FONT_FAMILY,
  },
  holdContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  holdLabel: { fontSize: 11, color: '#CCCCCC', flex: 1, fontFamily: BASE_FONT_FAMILY },
  holdInput: { width: 50, height: 26, backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#404040', borderRadius: 5, paddingHorizontal: 4, fontSize: 11, textAlign: 'center', fontFamily: BASE_FONT_FAMILY, color: '#FFFFFF' },
  holdInputEditing: { borderColor: '#007AFF', borderWidth: 2 },
  infoCard: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 8, marginBottom: 8 },
  infoText: { fontSize: 10, color: '#CCCCCC', marginBottom: 2, fontFamily: BASE_FONT_FAMILY },
  exportStatusCard: { backgroundColor: '#2a2a1a', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 2, borderColor: '#FFD700' },
  exportStatusCardIPad: { padding: 14, marginBottom: 14 },
  exportStatusText: { fontSize: 12, fontWeight: '600', color: '#FFFFFF', marginBottom: 8, fontFamily: BASE_FONT_FAMILY },
  exportProgressContainer: { marginBottom: 8 },
  exportProgressBar: { height: 6, backgroundColor: '#3a3a3a', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  exportProgressFill: { height: '100%', backgroundColor: '#007AFF' },
  exportProgressText: { fontSize: 11, color: '#CCCCCC', textAlign: 'center', fontFamily: BASE_FONT_FAMILY },
  exportAbortButton: { backgroundColor: '#FF3B30', paddingVertical: 8, borderRadius: 5, alignItems: 'center' },
  exportAbortButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', fontFamily: BASE_FONT_FAMILY },
  exportCard: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12 },
  exportCardIPad: { padding: 16 },
  exportMainButton: { backgroundColor: '#007AFF', borderRadius: 8, padding: 16, alignItems: 'center' },
  exportMainButtonText: { fontSize: 32, color: '#FFFFFF', marginBottom: 2, fontFamily: BASE_FONT_FAMILY },
  exportMainButtonSubtext: { fontSize: 11, color: '#FFFFFF', opacity: 0.9, fontFamily: BASE_FONT_FAMILY },
  exportButtonDisabled: { opacity: 0.5 },
  celebrationContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 },
  celebrationMessageBubble: {
    position: 'absolute',
    top: '45%',
    left: '50%',
    transform: [{ translateX: -100 }, { translateY: -20 }],
    backgroundColor: 'rgba(0, 122, 255, 0.95)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  celebrationMessageText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', fontFamily: BASE_FONT_FAMILY },
  celebrationEmoji: { position: 'absolute', fontSize: 40, top: 0 },
  // Export overlay modal styles
  overlayBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  overlayPanel: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  overlayTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 16,
    fontFamily: BASE_FONT_FAMILY,
  },
  overlaySubtitle: {
    fontSize: 14,
    color: '#CCCCCC',
    textAlign: 'center',
    marginBottom: 20,
    fontFamily: BASE_FONT_FAMILY,
  },
  overlayButton: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 12,
    alignItems: 'center',
  },
  overlayButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    fontFamily: BASE_FONT_FAMILY,
  },
  overlayButtonSubtext: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
    fontFamily: BASE_FONT_FAMILY,
  },
  overlayCancelButton: {
    backgroundColor: '#2a2a2a',
    marginTop: 4,
  },
  overlayCancelButtonText: {
    color: '#FF3B30',
  },
});

export default TimelapseScreen;
