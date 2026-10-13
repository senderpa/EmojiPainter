// @ts-nocheck - Legacy code with complex types
/**
 * Video Editor Screen
 *
 * Layered video composition workspace with:
 * - 4K canvas with zoom/pan
 * - Video layer management (reorder, scale, position)
 * - Pinch-zoom and drag gestures
 * - Selection states (orange/white frames)
 * - Export final composition
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Alert, Dimensions, PanResponder, ActivityIndicator, Image, Animated, Modal, Platform, NativeModules } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Video, ResizeMode, Audio } from 'expo-av';
import { emitAppEvent } from '../lib/appEvents';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import type { RootStackParamList } from '../App';
import { addVideo, getAllVideos, type VideoMetadata } from './videoStorage';
import { renderComposition } from './videoProcessing';
import { presentLicensesOverlay } from '../native/licenses';
import AnimatedLoader from '../components/AnimatedLoader';
import { VIDEO_EDITOR_LANGUAGES, VIDEO_EDITOR_TRANSLATIONS, type VideoEditorLanguage } from './videoEditorTranslations';
import { getRandomLogoSet, type LogoSet } from '../lib/logoManifest';
import RNFS from 'react-native-fs';
import {
  exportVideoComposition,
  type VideoExportOptions,
  type CaptureFallbackOptions,
  type VideoLayer as ExportVideoLayer,
} from './videoExport';
import { startScreenRecording, stopScreenRecording, isScreenRecordingActive, isScreenRecorderSupported } from '../native/screenRecorder';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useAppSettings } from '../context/AppSettingsContext';
import * as ImagePicker from 'expo-image-picker';
import { CustomOverlayHelper } from '../components/CustomOverlay';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const CANVAS_WIDTH = 3840; // 4K width
const CANVAS_HEIGHT = 2160; // 4K height

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'VideoEditor'>;
type RoutePropType = RouteProp<RootStackParamList, 'VideoEditor'>;

export interface PositionKeyframe {
  time: number; // Time in milliseconds
  x: number;
  y: number;
  scale: number;
}

export interface VideoLayer {
  id: string;
  videoId: string;
  metadata: VideoMetadata;
  x: number; // Position on canvas
  y: number;
  scale: number; // 1.0 = 100%
  zIndex: number; // Layer order
  keyframes?: PositionKeyframe[]; // Position animation keyframes
}

export interface SavedProject {
  id: string;
  name: string;
  timestamp: number;
  thumbnail?: string;
  layers: Array<{
    videoId: string;
    x: number;
    y: number;
    scale: number;
    zIndex: number;
  }>;
}

const PROJECTS_STORAGE_KEY = '@video_editor_projects';
const ACTIVE_SESSION_KEY = '@video_editor_active_session';
const FIRST_VISIT_KEY = '@video_editor_first_visit';
const APP_VERSION = '0.1.0'; // Video Editor version

async function loadProjects(): Promise<SavedProject[]> {
  try {
    const data = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('[VideoEditor] Failed to load projects:', error);
    return [];
  }
}

async function saveActiveSession(layers: VideoLayer[]): Promise<void> {
  try {
    const session = {
      layers: layers.map(layer => ({
        videoId: layer.videoId,
        x: layer.x,
        y: layer.y,
        scale: layer.scale,
        zIndex: layer.zIndex
      })),
      savedAt: Date.now()
    };
    await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
    console.log('[VideoEditor] Active session saved');
  } catch (error) {
    console.error('[VideoEditor] Failed to save active session:', error);
  }
}

async function loadActiveSession(): Promise<any | null> {
  try {
    const data = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('[VideoEditor] Failed to load active session:', error);
    return null;
  }
}

export async function clearActiveSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
    console.log('[VideoEditor] Active session cleared');
  } catch (error) {
    console.error('[VideoEditor] Failed to clear active session:', error);
  }
}

async function saveProject(project: SavedProject): Promise<void> {
  try {
    const projects = await loadProjects();
    const existingIndex = projects.findIndex(p => p.id === project.id);
    if (existingIndex >= 0) {
      projects[existingIndex] = project;
    } else {
      projects.push(project);
    }
    await AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch (error) {
    console.error('[VideoEditor] Failed to save project:', error);
    throw error;
  }
}

async function deleteProject(projectId: string): Promise<void> {
  try {
    const projects = await loadProjects();
    const filtered = projects.filter(p => p.id !== projectId);
    await AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('[VideoEditor] Failed to delete project:', error);
    throw error;
  }
}

export default function VideoEditorScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();
  const insets = useSafeAreaInsets();
  const { settings } = useAppSettings();

  const [layers, setLayers] = useState<VideoLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [availableVideos, setAvailableVideos] = useState<VideoMetadata[]>([]);
  const [currentFolder, setCurrentFolder] = useState<VideoMetadata | null>(null); // Current folder being browsed
  const [folderVideos, setFolderVideos] = useState<VideoMetadata[]>([]); // Videos inside current folder
  const [showLayerList, setShowLayerList] = useState(false);
  const [canvasLocked, setCanvasLocked] = useState(true); // Start in locked mode
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [showVideoPickerModal, setShowVideoPickerModal] = useState(false);
  const [saveButtonEmoji, setSaveButtonEmoji] = useState('💿'); // Animated save button emoji
  const [isSavePressed, setIsSavePressed] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false); // Loader for saving project
  const [closeButtonEmoji, setCloseButtonEmoji] = useState('❎'); // Close button emoji (❎ or ✳️)
  const hasAutoClickedRef = useRef(false); // Track if we've auto-clicked the + button

  // Letter panel state - letters in panels, only move when knob touches them
  const [zoomLetters, setZoomLetters] = useState<Array<{
    id: string;
    letter: string;
    x: number;
    y: number;
    originalX: number;
    originalY: number;
    vx: number;
    vy: number;
  }>>([]);

  const [scaleLetters, setScaleLetters] = useState<Array<{
    id: string;
    letter: string;
    x: number;
    y: number;
    originalX: number;
    originalY: number;
    vx: number;
    vy: number;
  }>>([]);

  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [infoLanguage, setInfoLanguage] = useState<'en' | 'de' | 'fr' | 'ru' | 'zh' | 'ko' | 'ja'>('en');
  const [logoSet, setLogoSet] = useState<LogoSet | null>(null);
  const [logoFrameIndex, setLogoFrameIndex] = useState(0);
  const [isRecordingExport, setIsRecordingExport] = useState(false);
  const [showRecordingPreview, setShowRecordingPreview] = useState(false);
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState<string | null>(null);

  // Position recording state
  const [isRecordingPosition, setIsRecordingPosition] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [showPositionOverlay, setShowPositionOverlay] = useState(false);
  const [showComingSoonOverlay, setShowComingSoonOverlay] = useState(false);
  const [comingSoonLogoSet, setComingSoonLogoSet] = useState<LogoSet | null>(null);
  const [comingSoonFrameIndex, setComingSoonFrameIndex] = useState(0);

  // Video playback tracking for position animation
  const [playbackTime, setPlaybackTime] = useState(0); // Current playback time in ms
  const [longestVideoDuration, setLongestVideoDuration] = useState(0); // Duration of longest video in ms
  const [isPlayingAnimation, setIsPlayingAnimation] = useState(false);
  const playbackIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // First visit welcome message
  const [showWelcomeMessage, setShowWelcomeMessage] = useState(false);
  const [welcomeLogoSet, setWelcomeLogoSet] = useState<LogoSet | null>(null);
  const [welcomeFrameIndex, setWelcomeFrameIndex] = useState(0);

  const prevZoomRef = useRef(canvasZoom);
  const prevScaleRef = useRef(selectedLayer?.scale || 1);

  // Ref for canvas snapshot
  const canvasRef = useRef<View>(null);

  // Map to store video refs for each layer (for scrubbing during export)
  const layerVideoRefs = useRef<Map<string, any>>(new Map());

  // Helper: Calculate knob position and detect letter collisions
  const getKnobPosition = useCallback((value: number, min: number, max: number, sliderIndex: number) => {
    const panelWidth = (screenWidth - 48) / 2;
    const sliderX = sliderIndex === 0 ? 16 : (screenWidth / 2 + 8);
    const sliderY = screenHeight - 70;
    const normalizedValue = (value - min) / (max - min);
    const knobX = sliderX + (normalizedValue * panelWidth);
    const knobY = sliderY;
    const knobRadius = 20; // Approximate thumb size
    return { knobX, knobY, knobRadius };
  }, []);

  const checkLetterCollision = useCallback((letter: { x: number; y: number }, knobX: number, knobY: number, knobRadius: number) => {
    const letterCenterX = letter.x + 15; // Half of letter width
    const letterCenterY = letter.y + 15; // Half of letter height
    const distance = Math.sqrt(Math.pow(letterCenterX - knobX, 2) + Math.pow(letterCenterY - knobY, 2));
    return distance < (knobRadius + 15); // Letter collision radius
  }, []);

  // Canvas zoom and pan
  const [canvasZoom, setCanvasZoom] = useState(0.08); // Start at 8% zoom (minimum)
  const [canvasPanX, setCanvasPanX] = useState(0);
  const [canvasPanY, setCanvasPanY] = useState(0);

  // Auto-animate zoom to 30% on iPad
  useEffect(() => {
    if (Platform.OS === 'ios' && (Platform as any)?.isPad) {
      // Animate from 0.08 to 0.3 over 1 second
      const startZoom = 0.08;
      const targetZoom = 0.3;
      const duration = 1000; // 1 second
      const startTime = Date.now();

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease-out animation
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        const currentZoom = startZoom + (targetZoom - startZoom) * easeProgress;

        setCanvasZoom(currentZoom);

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      // Start animation after a short delay
      const timer = setTimeout(() => {
        requestAnimationFrame(animate);
      }, 300);

      return () => clearTimeout(timer);
    }
  }, []);

  // Initialize letters - positioned at top under toolbar
  useEffect(() => {
    // ZOOM letters - positioned on right side
    const zoomText = 'ZOOM';
    const panelWidth = (screenWidth - 48) / 2; // Half slider width
    const zoomPanelX = 16; // Left margin
    const zoomPanelY = 100; // Top position to match new panel location
    const letterSpacing = 10; // Smaller spacing for tiny letters
    const startX = zoomPanelX + panelWidth - (zoomText.length * letterSpacing) - 10; // Right-aligned

    setZoomLetters(zoomText.split('').map((letter, i) => {
      const originalX = startX + (i * letterSpacing);
      const originalY = zoomPanelY;
      return {
        id: `zoom_${i}`,
        letter,
        x: originalX,
        y: originalY,
        originalX,
        originalY,
        vx: 0,
        vy: 0
      };
    }));

    // SCALE letters - positioned on right side
    const scaleText = 'SCALE';
    const scalePanelX = screenWidth / 2 + 8; // Right half + gap
    const scalePanelY = 100; // Top position to match new panel location
    const scaleStartX = scalePanelX + panelWidth - (scaleText.length * letterSpacing) - 10;

    setScaleLetters(scaleText.split('').map((letter, i) => {
      const originalX = scaleStartX + (i * letterSpacing);
      const originalY = scalePanelY;
      return {
        id: `scale_${i}`,
        letter,
        x: originalX,
        y: originalY,
        originalX,
        originalY,
        vx: 0,
        vy: 0
      };
    }));
  }, []);

  // Physics simulation - letters slowly return to original position
  useEffect(() => {
    if (zoomLetters.length === 0 && scaleLetters.length === 0) return;

    const interval = setInterval(() => {
      const friction = 0.92;
      const returnForce = 0.15; // Pull back to original position

      const updateLetter = (letter: typeof zoomLetters[0]) => {
        let { x, y, vx, vy, originalX, originalY } = letter;

        // Apply friction to slow down
        vx *= friction;
        vy *= friction;

        // Gentle force pulling back to original position
        const dx = originalX - x;
        const dy = originalY - y;
        vx += dx * returnForce;
        vy += dy * returnForce;

        // Update position
        x += vx;
        y += vy;

        // Snap to original if very close
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) {
          x = originalX;
          y = originalY;
          vx = 0;
          vy = 0;
        }

        return { ...letter, x, y, vx, vy };
      };

      setZoomLetters(prev => prev.map(updateLetter));
      setScaleLetters(prev => prev.map(updateLetter));
    }, 16); // ~60fps

    return () => clearInterval(interval);
  }, [zoomLetters.length, scaleLetters.length]);

  // Load available videos and restore session
  useEffect(() => {
    loadVideos();
  }, []);

  const loadVideos = async () => {
    setIsLoadingVideos(true);
    try {
      const videos = await getAllVideos();
      // Include folders in available videos for layer import
      setAvailableVideos(videos);

      // Check if we have initial videos from navigation params
      const hasInitialVideos = route.params?.initialVideoIds?.length || route.params?.initialVideoId;

      if (hasInitialVideos) {
        // Handle initial video(s) from navigation
        if (route.params?.initialVideoIds && route.params.initialVideoIds.length > 0) {
          // Multiple videos - add all as layers in overlapping stack layout
          const videosToAdd = route.params.initialVideoIds
            .map(videoId => videos.find(v => v.id === videoId))
            .filter((v): v is VideoMetadata => v !== undefined);

          if (videosToAdd.length > 1) {
            addLayersInGrid(videosToAdd);
          } else if (videosToAdd.length === 1) {
            addLayer(videosToAdd[0]);
          }
        } else if (route.params?.initialVideoId) {
          // Single video - add as first layer
          const video = videos.find(v => v.id === route.params.initialVideoId);
          if (video) {
            addLayer(video);
          }
        }
        // Clear the active session since we're starting fresh
        await clearActiveSession();
      } else {
        // No initial videos - check if there's an active session
        const session = await loadActiveSession();
        if (session && session.layers && session.layers.length > 0) {
          // Ask user if they want to resume or start fresh
          CustomOverlayHelper.alert(
            'Resume Session?',
            `You have an existing session with ${session.layers.length} video${session.layers.length > 1 ? 's' : ''}. Would you like to continue or start fresh?`,
            [
              {
                text: 'Start Fresh',
                style: 'destructive',
                onPress: async () => {
                  await clearActiveSession();
                  console.log('[VideoEditor] User chose to start fresh');
                }
              },
              {
                text: 'Resume',
                onPress: () => {
                  console.log('[VideoEditor] Restoring active session with', session.layers.length, 'layers');
                  const restoredLayers: VideoLayer[] = [];
                  for (const layerData of session.layers) {
                    const video = videos.find(v => v.id === layerData.videoId);
                    if (video) {
                      restoredLayers.push({
                        id: `layer_${Date.now()}_${Math.random()}`,
                        videoId: layerData.videoId,
                        metadata: video,
                        x: layerData.x,
                        y: layerData.y,
                        scale: layerData.scale,
                        zIndex: layerData.zIndex
                      });
                    }
                  }
                  if (restoredLayers.length > 0) {
                    setLayers(restoredLayers);
                    setSelectedLayerId(restoredLayers[0].id);
                  }
                }
              }
            ],
            { cancelable: false }
          );
        }
      }
    } finally {
      setIsLoadingVideos(false);
    }
  };

  // Add a video as a layer
  const addLayer = useCallback((video: VideoMetadata) => {
    // Calculate position to place video inside 4K canvas area
    // Place at center of canvas, ensure it's fully visible
    const maxWidth = CANVAS_WIDTH * 0.8; // Use 80% of canvas width
    const maxHeight = CANVAS_HEIGHT * 0.8; // Use 80% of canvas height

    // Calculate scale to fit video inside the safe area if needed
    let initialScale = 1.0;
    if (video.width > maxWidth || video.height > maxHeight) {
      const scaleX = maxWidth / video.width;
      const scaleY = maxHeight / video.height;
      initialScale = Math.min(scaleX, scaleY);
    }

    // Center the video in the canvas
    const videoWidth = video.width * initialScale;
    const videoHeight = video.height * initialScale;
    const x = (CANVAS_WIDTH - videoWidth) / 2;
    const y = (CANVAS_HEIGHT - videoHeight) / 2;

    const newLayer: VideoLayer = {
      id: `layer_${Date.now()}_${Math.random()}`,
      videoId: video.id,
      metadata: video,
      x: x,
      y: y,
      scale: initialScale,
      zIndex: layers.length
    };
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  }, [layers.length]);

  // Add multiple videos in overlapping stack layout
  const addLayersInGrid = useCallback((videos: VideoMetadata[]) => {
    const numVideos = videos.length;
    const MAX_PER_ROW = 8;

    // CRITICAL FIX: Calculate scale to ensure all videos fit INSIDE 4K canvas
    // Find the largest video dimensions
    const maxVideoWidth = Math.max(...videos.map(v => v.width));
    const maxVideoHeight = Math.max(...videos.map(v => v.height));

    // Calculate how much total width we need for all videos in a row
    const videosInFirstRow = Math.min(numVideos, MAX_PER_ROW);

    // Random overlap between 10-30% (use average 20% for calculation)
    const avgOverlap = 0.20;

    // Total width needed = first video full + (n-1) videos with overlap
    const totalWidthNeeded = maxVideoWidth * (1 + (videosInFirstRow - 1) * (1 - avgOverlap));

    // Scale to fit 80% of canvas width and 80% of canvas height
    const scaleForWidth = (CANVAS_WIDTH * 0.8) / totalWidthNeeded;
    const scaleForHeight = (CANVAS_HEIGHT * 0.8) / maxVideoHeight;
    const baseScale = Math.min(scaleForWidth, scaleForHeight);

    console.log('[VideoEditor] Calculated base scale:', baseScale, 'for', numVideos, 'videos');

    // Create layers with overlapping positions in a row
    const newLayers: VideoLayer[] = videos.map((video, index) => {
      const scale = baseScale;
      const videoWidth = video.width * scale;
      const videoHeight = video.height * scale;

      // Random overlap between 10-30%
      const overlapPercent = 0.10 + Math.random() * 0.20; // 10-30%
      const spacing = videoWidth * (1 - overlapPercent);

      // Calculate position in row (max 8 per row)
      const row = Math.floor(index / MAX_PER_ROW);
      const col = index % MAX_PER_ROW;

      // Start position - centered horizontally and vertically in 4K frame
      const rowStartX = CANVAS_WIDTH * 0.1;

      // CRITICAL: Center vertically in 4K frame
      const totalHeight = videoHeight;
      const centerY = (CANVAS_HEIGHT - totalHeight) / 2;
      const rowStartY = centerY + (row * CANVAS_HEIGHT * 0.3); // Multi-row spacing if needed

      // Position with overlap
      const x = rowStartX + (col * spacing);
      const y = rowStartY;

      return {
        id: `layer_${Date.now()}_${index}_${Math.random()}`,
        videoId: video.id,
        metadata: video,
        x,
        y,
        scale,
        zIndex: index
      };
    });

    setLayers(newLayers);
    if (newLayers.length > 0) {
      setSelectedLayerId(newLayers[0].id);
    }
  }, []);

  // Auto-save active session whenever layers change
  useEffect(() => {
    if (layers.length > 0) {
      saveActiveSession(layers);
    }
  }, [layers]);

  // Check for first visit and show welcome message
  useEffect(() => {
    const checkFirstVisit = async () => {
      try {
        const hasVisited = await AsyncStorage.getItem(FIRST_VISIT_KEY);
        if (!hasVisited) {
          // First visit - show welcome message
          const randomLogo = getRandomLogoSet();
          setWelcomeLogoSet(randomLogo);
          setWelcomeFrameIndex(0);
          setShowWelcomeMessage(true);
          // Mark as visited
          await AsyncStorage.setItem(FIRST_VISIT_KEY, 'true');
          console.log('[VideoEditor] First visit - showing welcome message');
        }
      } catch (error) {
        console.error('[VideoEditor] Failed to check first visit:', error);
      }
    };

    checkFirstVisit();
  }, []);

  // Welcome message auto-dismiss after 7 seconds
  useEffect(() => {
    if (!showWelcomeMessage) return;

    const timer = setTimeout(() => {
      setShowWelcomeMessage(false);
    }, 7000);

    return () => clearTimeout(timer);
  }, [showWelcomeMessage]);

  // Logo frame animation for welcome message
  useEffect(() => {
    if (!showWelcomeMessage || !welcomeLogoSet || welcomeLogoSet.type === 'video') return;

    if (welcomeLogoSet.frames && welcomeLogoSet.frames.length > 0) {
      const interval = setInterval(() => {
        setWelcomeFrameIndex((prev) => (prev + 1) % welcomeLogoSet.frames.length);
      }, 80);
      return () => clearInterval(interval);
    }
  }, [showWelcomeMessage, welcomeLogoSet]);

  // Logo animation effect - cycle through frames when info modal is open
  useEffect(() => {
    if (!showInfoModal || !logoSet || !logoSet.frames || logoSet.frames.length === 0) return;

    const interval = setInterval(() => {
      setLogoFrameIndex((prev) => (prev + 1) % (logoSet.frames.length + 1));
    }, 80); // 80ms per frame for smooth animation

    return () => clearInterval(interval);
  }, [showInfoModal, logoSet]);

  // Load random logo set when info modal opens
  useEffect(() => {
    if (showInfoModal && !logoSet) {
      setLogoSet(getRandomLogoSet());
      setLogoFrameIndex(0);
    } else if (!showInfoModal) {
      // Reset when modal closes
      setLogoSet(null);
      setLogoFrameIndex(0);
    }
  }, [showInfoModal, logoSet]);

  // Coming soon overlay animation - show for 3s, then scale out for 1s
  useEffect(() => {
    if (!showComingSoonOverlay) return;

    const displayTimer = setTimeout(() => {
      // After 3 seconds, start scale out animation
      setShowComingSoonOverlay(false);
    }, 3000);

    const closeTimer = setTimeout(() => {
      // After 4 seconds total (3s display + 1s scale out), close completely
      setComingSoonLogoSet(null);
      setComingSoonFrameIndex(0);
    }, 4000);

    return () => {
      clearTimeout(displayTimer);
      clearTimeout(closeTimer);
    };
  }, [showComingSoonOverlay]);

  // Logo frame animation for coming soon overlay
  useEffect(() => {
    if (!showComingSoonOverlay || !comingSoonLogoSet || comingSoonLogoSet.type === 'video') return;

    if (comingSoonLogoSet.frames && comingSoonLogoSet.frames.length > 0) {
      const interval = setInterval(() => {
        setComingSoonFrameIndex((prev) => (prev + 1) % comingSoonLogoSet.frames.length);
      }, 80);
      return () => clearInterval(interval);
    }
  }, [showComingSoonOverlay, comingSoonLogoSet]);

  // Calculate longest video duration for timeline
  useEffect(() => {
    if (layers.length === 0) {
      setLongestVideoDuration(0);
      return;
    }

    const maxDuration = Math.max(...layers.map(layer => layer.metadata.duration || 0));
    setLongestVideoDuration(maxDuration);
  }, [layers]);

  // Position animation playback - interpolate position based on playback time
  useEffect(() => {
    if (!isPlayingAnimation || longestVideoDuration === 0) {
      // Clean up interval when not playing
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
      return;
    }

    // Start playback loop - update position every 16ms (~60fps)
    playbackIntervalRef.current = setInterval(() => {
      setPlaybackTime((prev) => {
        const next = prev + 16;
        // Loop back to start when reaching end
        if (next >= longestVideoDuration) {
          return 0;
        }
        return next;
      });
    }, 16);

    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    };
  }, [isPlayingAnimation, longestVideoDuration]);

  // Apply position interpolation to layers with keyframes during playback
  useEffect(() => {
    if (!isPlayingAnimation) return;

    // PERFORMANCE: Use ref to avoid triggering additional re-renders
    // For each layer with keyframes, interpolate position
    setLayers((prevLayers) => {
      const hasChanges = prevLayers.some(
        layer => layer.keyframes && layer.keyframes.length >= 2
      );

      if (!hasChanges) return prevLayers;

      return prevLayers.map((layer) => {
        if (!layer.keyframes || layer.keyframes.length < 2) return layer;

        // Find keyframes to interpolate between
        const keyframes = [...layer.keyframes].sort((a, b) => a.time - b.time);

        // If playback time is at or before first keyframe, use first keyframe position
        if (playbackTime <= keyframes[0].time) {
          const firstKeyframe = keyframes[0];
          // Only update if different to avoid infinite loops
          if (layer.x === firstKeyframe.x && layer.y === firstKeyframe.y && layer.scale === firstKeyframe.scale) {
            return layer;
          }
          return {
            ...layer,
            x: firstKeyframe.x,
            y: firstKeyframe.y,
            scale: firstKeyframe.scale
          };
        }

        // If playback time is after last keyframe, use last keyframe position
        if (playbackTime >= keyframes[keyframes.length - 1].time) {
          const lastKeyframe = keyframes[keyframes.length - 1];
          // Only update if different
          if (layer.x === lastKeyframe.x && layer.y === lastKeyframe.y && layer.scale === lastKeyframe.scale) {
            return layer;
          }
          return {
            ...layer,
            x: lastKeyframe.x,
            y: lastKeyframe.y,
            scale: lastKeyframe.scale
          };
        }

        // Find the two keyframes to interpolate between
        let startKeyframe = keyframes[0];
        let endKeyframe = keyframes[1];

        for (let i = 0; i < keyframes.length - 1; i++) {
          if (playbackTime >= keyframes[i].time && playbackTime <= keyframes[i + 1].time) {
            startKeyframe = keyframes[i];
            endKeyframe = keyframes[i + 1];
            break;
          }
        }

        // Linear interpolation
        const duration = endKeyframe.time - startKeyframe.time;
        const elapsed = playbackTime - startKeyframe.time;
        const progress = duration > 0 ? elapsed / duration : 0;

        const interpolatedX = startKeyframe.x + (endKeyframe.x - startKeyframe.x) * progress;
        const interpolatedY = startKeyframe.y + (endKeyframe.y - startKeyframe.y) * progress;
        const interpolatedScale = startKeyframe.scale + (endKeyframe.scale - startKeyframe.scale) * progress;

        // Only update if values changed (avoid unnecessary re-renders)
        if (Math.abs(layer.x - interpolatedX) < 0.1 &&
            Math.abs(layer.y - interpolatedY) < 0.1 &&
            Math.abs(layer.scale - interpolatedScale) < 0.001) {
          return layer;
        }

        return {
          ...layer,
          x: interpolatedX,
          y: interpolatedY,
          scale: interpolatedScale
        };
      });
    });
  }, [playbackTime, isPlayingAnimation]);

  // Auto-click + button when video editor is empty (only once on mount)
  useEffect(() => {
    if (layers.length === 0 && !hasAutoClickedRef.current && availableVideos.length > 0) {
      // Delay slightly to ensure UI is ready
      const timer = setTimeout(() => {
        console.log('[VideoEditor] Auto-clicking + button (empty editor)');
        setShowVideoPickerModal(true);
        hasAutoClickedRef.current = true;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [layers.length, availableVideos.length]);

  // Remove a layer
  const removeLayer = useCallback((layerId: string) => {
    setLayers(prev => prev.filter(l => l.id !== layerId));
    if (selectedLayerId === layerId) {
      setSelectedLayerId(null);
    }
  }, [selectedLayerId]);

  // Play random click sound
  const playRandomClickSound = useCallback(async () => {
    // Skip if sound is disabled
    if (!settings.soundEnabled) {
      return;
    }

    try {
      const sounds = [
        require('../../assets/sounds/wobble1.wav'),
        require('../../assets/sounds/wobble2.wav'),
        require('../../assets/sounds/wobble3.wav'),
        require('../../assets/sounds/bass1.wav'),
        require('../../assets/sounds/bass2.wav'),
        require('../../assets/sounds/bass3.wav'),
        require('../../assets/sounds/bass4.wav'),
        require('../../assets/sounds/bass5.wav'),
      ];
      const randomSound = sounds[Math.floor(Math.random() * sounds.length)];
      const { sound } = await Audio.Sound.createAsync(randomSound);
      await sound.playAsync();
      // Unload after playing
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (error) {
      console.error('[VideoEditor] Failed to play click sound:', error);
    }
  }, [settings.soundEnabled]);

  // Update layer position (absolute position)
  const updateLayerPosition = useCallback((layerId: string, newX: number, newY: number) => {
    console.log(`[VideoEditor] Updating layer ${layerId} position to (${newX.toFixed(1)}, ${newY.toFixed(1)})`);

    // If playback animation is active and user is manually moving, pause playback
    if (isPlayingAnimation && !isRecordingPosition) {
      console.log('[VideoEditor] User manually moving layer during playback, pausing animation');
      setIsPlayingAnimation(false);
    }

    setLayers(prev =>
      prev.map(l => {
        if (l.id !== layerId) return l;

        // If recording position for this layer, add keyframe
        if (isRecordingPosition && layerId === selectedLayerId && recordingStartTime) {
          const elapsedTime = Date.now() - recordingStartTime;
          const newKeyframe: PositionKeyframe = {
            time: elapsedTime,
            x: newX,
            y: newY,
            scale: l.scale
          };
          console.log('[VideoEditor] Adding position keyframe at', elapsedTime, 'ms');
          return {
            ...l,
            x: newX,
            y: newY,
            keyframes: [...(l.keyframes || []), newKeyframe]
          };
        }

        return { ...l, x: newX, y: newY };
      })
    );
  }, [isRecordingPosition, selectedLayerId, recordingStartTime, isPlayingAnimation]);

  // Update layer scale (slower, clamped)
  // Note: Position is handled separately by the pinch gesture to scale from center
  const updateLayerScale = useCallback((layerId: string, delta: number) => {
    setLayers(prev =>
      prev.map(l => {
        if (l.id !== layerId) return l;

        // Make scaling slower (divide delta by 10)
        const slowDelta = delta * 0.1;
        const newScale = Math.max(0.1, Math.min(5.0, l.scale + slowDelta));

        console.log(`[VideoEditor] Updating layer ${layerId} scale to ${newScale.toFixed(2)}`);

        return {
          ...l,
          scale: newScale
          // Position is updated separately via updateLayerPosition for center-based scaling
        };
      })
    );
  }, []);

  // Move layer up in z-index
  const moveLayerUp = useCallback((layerId: string) => {
    setLayers(prev => {
      const index = prev.findIndex(l => l.id === layerId);
      if (index < prev.length - 1) {
        const newLayers = [...prev];
        [newLayers[index].zIndex, newLayers[index + 1].zIndex] = [
          newLayers[index + 1].zIndex,
          newLayers[index].zIndex
        ];
        return newLayers;
      }
      return prev;
    });
  }, []);

  // Move layer down in z-index
  const moveLayerDown = useCallback((layerId: string) => {
    setLayers(prev => {
      const index = prev.findIndex(l => l.id === layerId);
      if (index > 0) {
        const newLayers = [...prev];
        [newLayers[index].zIndex, newLayers[index - 1].zIndex] = [
          newLayers[index - 1].zIndex,
          newLayers[index].zIndex
        ];
        return newLayers;
      }
      return prev;
    });
  }, []);

  // Swap layer positions (for drag-to-reorder)
  const swapLayers = useCallback((fromId: string, toId: string) => {
    setLayers(prev => {
      const newLayers = [...prev];
      const fromLayer = newLayers.find(l => l.id === fromId);
      const toLayer = newLayers.find(l => l.id === toId);

      if (fromLayer && toLayer) {
        const tempZIndex = fromLayer.zIndex;
        fromLayer.zIndex = toLayer.zIndex;
        toLayer.zIndex = tempZIndex;
      }

      return newLayers;
    });
  }, []);

  // Canvas pan and pinch gesture (respects lock)
  const canvasLockedRef = useRef(canvasLocked);
  canvasLockedRef.current = canvasLocked;

  const initialCanvasPan = useRef({ x: 0, y: 0 });
  const initialCanvasZoom = useRef(canvasZoom);
  const initialCanvasDistance = useRef(0);

  // Helper to calculate distance between two touches
  const getCanvasDistance = (touches: any[]) => {
    if (touches.length < 2) return 0;
    const [touch1, touch2] = touches;
    const dx = touch1.pageX - touch2.pageX;
    const dy = touch1.pageY - touch2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const canvasPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !canvasLockedRef.current, // When unlocked (false), can pan canvas
      onPanResponderGrant: (evt) => {
        // Store initial canvas pan position
        initialCanvasPan.current = { x: canvasPanX, y: canvasPanY };
        initialCanvasZoom.current = canvasZoom;

        // Store initial distance for pinch zoom
        if (evt.nativeEvent.touches.length === 2) {
          initialCanvasDistance.current = getCanvasDistance(evt.nativeEvent.touches);
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        if (canvasLockedRef.current) return; // Only pan when unlocked

        const touches = evt.nativeEvent.touches;

        // Two-finger pinch to zoom canvas
        if (touches.length === 2) {
          const currentDistance = getCanvasDistance(touches);
          if (initialCanvasDistance.current > 0) {
            // Calculate zoom change - MUCH SLOWER (divide by 2000 instead of 500)
            const distanceDelta = currentDistance - initialCanvasDistance.current;
            const zoomDelta = distanceDelta / 2000; // Much slower zoom
            const newZoom = Math.max(0.08, Math.min(2.0, initialCanvasZoom.current + zoomDelta));
            setCanvasZoom(newZoom);
          }
        }
        // Single-finger pan
        else if (touches.length === 1) {
          // Use absolute position: initial + delta
          setCanvasPanX(initialCanvasPan.current.x + gestureState.dx);
          setCanvasPanY(initialCanvasPan.current.y + gestureState.dy);
        }
      },
      onPanResponderRelease: () => {
        initialCanvasDistance.current = 0; // Reset for next gesture
      }
    })
  ).current;

  // Scrub all video layers to a specific time for fallback capture export
  const renderAtTime = useCallback(async (timeSec: number) => {
    const timeMs = timeSec * 1000;

    // Seek all video players to the target time
    const seekPromises = Array.from(layerVideoRefs.current.values()).map(async (videoRef) => {
      if (videoRef && videoRef.current) {
        try {
          await videoRef.current.setPositionAsync(timeMs);
          // Small delay to ensure frame is rendered
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          console.warn('[VideoEditor] Failed to seek video:', error);
        }
      }
    });

    await Promise.all(seekPromises);
  }, []);

  // Export via screen recording (renders frames from playing canvas)
  const handleExport = useCallback(async () => {
    if (layers.length === 0) {
      CustomOverlayHelper.alert('No Layers', 'Add at least one video layer to export.');
      return;
    }

    try {
      setIsExporting(true);
      setIsRecordingExport(true); // Hide UI elements
      setExportStatus('Rendering frames...');

      // Free up memory before export
      console.log('[VideoEditor] Freeing memory before export...');
      if (global.gc) {
        global.gc();
      }

      // Calculate max video duration
      const maxDuration = layers.reduce(
        (acc, layer) => Math.max(acc, layer.metadata.duration || 0),
        0
      );
      const durationMs = maxDuration > 0 ? maxDuration : 5000;
      const fps = 30;
      const totalFrames = Math.ceil((durationMs / 1000) * fps);

      console.log(`[VideoEditor] Recording ${totalFrames} frames at ${fps}fps for ${(durationMs/1000).toFixed(1)}s`);

      // Zoom canvas to max width (no frames showing)
      const targetZoom = screenWidth / CANVAS_WIDTH;
      setCanvasZoom(targetZoom);
      setCanvasPanX(0);
      setCanvasPanY(0);

      // Wait for zoom to apply
      await new Promise(resolve => setTimeout(resolve, 500));

      // Capture frames by taking screenshots at intervals
      const frames: string[] = [];
      const frameInterval = 1000 / fps;
      let currentFrame = 0;

      while (currentFrame < totalFrames) {
        try {
          if (!canvasRef.current) break;

          const frameUri = await captureRef(canvasRef.current, {
            format: 'png',
            quality: 1.0,
            result: 'tmpfile'
          });

          frames.push(frameUri);
          currentFrame++;

          const progress = Math.round((currentFrame / totalFrames) * 100);
          setExportProgress(progress);
          setExportStatus(`Rendering frames... ${progress}%`);

          // Wait for next frame interval
          await new Promise(resolve => setTimeout(resolve, frameInterval));
        } catch (error) {
          console.error('[VideoEditor] Frame capture failed:', error);
          break;
        }
      }

      console.log(`[VideoEditor] Captured ${frames.length} frames`);

      // Use videoProcessing to stitch frames into video
      setExportStatus('Encoding video...');
      const outputDir = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}video-exports/`;
      await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
      const outputUri = `${outputDir}composition_${Date.now()}.mov`;

      // Import the frame stitching logic
      const { stitchFramesToVideo } = require('./videoProcessing');
      await stitchFramesToVideo(frames, outputUri, fps);

      setExportStatus('Saving to Video Storage...');
      const saved = await addVideo(outputUri, CANVAS_WIDTH, CANVAS_HEIGHT, durationMs, undefined, {
        isExport: true,
        isEditorExport: true
      });

      if (!saved) {
        throw new Error('Export succeeded but failed to register video in storage.');
      }

      setExportStatus('Complete!');

      // Clean up frame files
      for (const frameUri of frames) {
        try {
          await FileSystem.deleteAsync(frameUri, { idempotent: true });
        } catch {}
      }

      // Emit event for export complete overlay
      emitAppEvent('export:complete', {
        uri: outputUri,
        filename: saved.filename
      });

      // Reset zoom
      setCanvasZoom(0.08);

    } catch (error) {
      console.error('[VideoEditor] Export error:', error);
      CustomOverlayHelper.alert('Export Failed', error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsExporting(false);
      setIsRecordingExport(false);
      setExportStatus('');
    }
  }, [layers]);

  // New ffmpeg-based export with ProRes 4444 alpha support
  const handleExportWithFFmpeg = useCallback(async () => {
    if (layers.length === 0) {
      CustomOverlayHelper.alert('No Layers', 'Add at least one video layer to export.');
      return;
    }

    try {
      setIsExporting(true);
      setExportStatus('Preparing ffmpeg export...');

      // Calculate max duration from all layers
      const maxDuration = layers.reduce(
        (acc, layer) => Math.max(acc, layer.metadata.duration || 0),
        0
      );
      const exportDuration = maxDuration > 0 ? maxDuration / 1000 : 5; // Convert to seconds
      const fps = 30;

      // Create exports directory if it doesn't exist
      const exportsDir = `${RNFS.DocumentDirectoryPath}/exports`;
      const dirExists = await RNFS.exists(exportsDir);
      if (!dirExists) {
        await RNFS.mkdir(exportsDir);
      }

      const timestamp = Date.now();
      const outputPath = `${exportsDir}/composition_${timestamp}.mov`;

      // Sort layers by zIndex (bottom to top)
      const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex);

      // Build export layer configuration
      const exportLayers: ExportVideoLayer[] = sortedLayers.map((layer) => ({
        path: layer.metadata.uri.replace('file://', ''), // Remove file:// prefix for ffmpeg
        startTime: 0,
        endTime: undefined // Use full duration
      }));

      console.log('[VideoEditor] Starting ffmpeg export:', {
        layers: exportLayers.length,
        duration: exportDuration,
        fps,
        outputPath
      });

      const ffmpegOpts: VideoExportOptions = {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        fps,
        layers: exportLayers,
        outputPath,
        duration: exportDuration,
      };

      const fallbackOpts: CaptureFallbackOptions = {
        ...ffmpegOpts,
        editorRef: canvasRef,
        renderAtTime,
      };

      setExportStatus('Exporting with ffmpeg (ProRes 4444)...');
      const finalPath = await exportVideoComposition(ffmpegOpts, fallbackOpts);

      console.log('[VideoEditor] Export success:', finalPath);
      setExportStatus('Saving to Video Storage...');

      // Add to video storage
      const saved = await addVideo(
        `file://${finalPath}`,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
        maxDuration,
        undefined,
        { isExport: true, isEditorExport: true }
      );

      setIsExporting(false);
      setExportStatus('');

      CustomOverlayHelper.alert(
        'Export Complete',
        'ProRes 4444 video exported to Video Storage with alpha transparency preserved.',
        [
          { text: 'OK' },
          {
            text: 'Share',
            onPress: async () => {
              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(`file://${finalPath}`);
              }
            }
          }
        ]
      );

      emitAppEvent('videoExported');
    } catch (error) {
      console.error('[VideoEditor] FFmpeg export failed:', error);
      setIsExporting(false);
      setExportStatus('');

      CustomOverlayHelper.alert(
        'Export Failed',
        `FFmpeg export error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        [
          { text: 'OK' },
          {
            text: 'Try Old Method',
            onPress: () => handleExport()
          }
        ]
      );
    }
  }, [layers, renderAtTime, handleExport]);

  const exportComposition = useCallback(
    async (format: 'mov' | 'mp4') => {
      try {
        setIsExporting(true);
        setExportStatus('Preparing export...');

        const sortedLayers = [...layers];
        if (sortedLayers.length === 0) {
          throw new Error('No layers to export.');
        }

        const maxDuration = sortedLayers.reduce(
          (acc, layer) => Math.max(acc, layer.metadata.duration || 0),
          0
        );
        const exportDuration = maxDuration > 0 ? maxDuration : 5000; // Default to 5s if metadata missing
        if (maxDuration === 0) {
          console.warn('[VideoEditor] Layer durations missing, defaulting export to 5s.');
        }

        const outputDir = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}video-exports/`;
        await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
        const outputUri = `${outputDir}composition_${Date.now()}.${format}`;

        setExportStatus('Rendering composition... 0%');

        // Log export data for debugging
        console.log('[VideoEditor] === EXPORT COMPOSITION ===');
        sortedLayers.forEach((layer, index) => {
          console.log(`[VideoEditor] Layer ${index + 1}:`, {
            filename: layer.metadata.filename,
            position: `(${layer.x.toFixed(1)}, ${layer.y.toFixed(1)})`,
            scale: layer.scale.toFixed(2),
            size: `${layer.metadata.width}x${layer.metadata.height}`,
            scaledSize: `${(layer.metadata.width * layer.scale).toFixed(0)}x${(layer.metadata.height * layer.scale).toFixed(0)}`
          });
        });

        await renderComposition({
          layers: sortedLayers.map((layer) => ({
            sourceUri: layer.metadata.uri,
            x: layer.x,
            y: layer.y,
            width: layer.metadata.width,
            height: layer.metadata.height,
            scale: layer.scale,
            zIndex: layer.zIndex
          })),
          canvasWidth: CANVAS_WIDTH,
          canvasHeight: CANVAS_HEIGHT,
          durationMs: exportDuration,
          outputUri,
          format,
          onProgress: (progress) => {
            setExportProgress(progress);
            setExportStatus(`Rendering composition... ${progress}%`);
          }
        });

        setExportStatus('Saving to Video Storage...');
        const saved = await addVideo(outputUri, CANVAS_WIDTH, CANVAS_HEIGHT, exportDuration, undefined, { isExport: true, isEditorExport: true });
        if (!saved) {
          throw new Error('Export succeeded but failed to register video in storage.');
        }

        setExportStatus('Complete!');
        // Emit event for export complete overlay
        emitAppEvent('export:complete', {
          uri: outputUri,
          filename: saved.filename
        });
      } catch (error) {
        console.error('Export error:', error);
        CustomOverlayHelper.alert('Export Failed', error instanceof Error ? error.message : 'Unknown error occurred');
      } finally {
        setIsExporting(false);
        setExportStatus('');
      }
    },
    [layers, navigation]
  );

  const selectedLayer = layers.find(l => l.id === selectedLayerId);

  const handleSaveProject = useCallback(async () => {
    if (layers.length === 0) {
      CustomOverlayHelper.alert('No Layers', 'Add some videos before saving a project.');
      return;
    }

    setIsSavingProject(true);

    try {
      // Wait a moment for videos to render before capturing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Capture canvas snapshot with videos using screen recording
      let thumbnail: string | undefined;
      try {
        // Check if screen recording is supported
        const isSupported = await isScreenRecorderSupported();

        if (isSupported) {
          console.log('[VideoEditor] 🎥 Using screen recording to capture snapshot with videos');

          // Start screen recording (no microphone)
          const startResult = await startScreenRecording(false);
          if (startResult.ok) {
            console.log('[VideoEditor] Screen recording started');

            // Record for 1 second to capture the canvas with videos
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Stop recording
            const stopResult = await stopScreenRecording();
            if (stopResult.ok && stopResult.url) {
              console.log('[VideoEditor] Screen recording stopped, extracting thumbnail from:', stopResult.url);

              // Extract thumbnail from the recorded video
              try {
                const { uri } = await VideoThumbnails.getThumbnailAsync(stopResult.url, {
                  time: 0, // First frame
                  quality: 1.0,
                });

                console.log('[VideoEditor] ✅ Thumbnail extracted:', uri);

                // Read thumbnail as base64
                const base64 = await RNFS.readFile(uri, 'base64');
                thumbnail = `data:image/jpeg;base64,${base64}`;

                // Clean up recorded video file
                try {
                  await RNFS.unlink(stopResult.url.replace('file://', ''));
                  console.log('[VideoEditor] Cleaned up screen recording file');
                } catch (cleanupError) {
                  console.warn('[VideoEditor] Failed to cleanup recording:', cleanupError);
                }
              } catch (thumbnailError) {
                console.warn('[VideoEditor] Failed to extract thumbnail from recording:', thumbnailError);
              }
            } else {
              console.warn('[VideoEditor] Failed to stop screen recording');
            }
          } else {
            console.warn('[VideoEditor] Failed to start screen recording');
          }
        }

        // Fallback to captureRef if screen recording failed or not supported
        if (!thumbnail && canvasRef.current) {
          console.log('[VideoEditor] Falling back to captureRef (videos may not be visible)');
          thumbnail = await captureRef(canvasRef.current, {
            format: 'png',
            quality: 1.0,
            result: 'base64'
          });
          thumbnail = `data:image/png;base64,${thumbnail}`;
        }
      } catch (error) {
        console.warn('[VideoEditor] Failed to capture thumbnail:', error);
      }

      const projectId = currentProjectId ?? `project_${Date.now()}`;
      const projectName = `Composition ${new Date().toLocaleDateString()}`;

      const project: SavedProject = {
        id: projectId,
        name: projectName,
        timestamp: Date.now(),
        thumbnail,
        layers: layers.map(layer => ({
          videoId: layer.videoId,
          x: layer.x,
          y: layer.y,
          scale: layer.scale,
          zIndex: layer.zIndex
        }))
      };

      await saveProject(project);
      setCurrentProjectId(projectId);

      // Show success for a moment before hiding loader
      await new Promise(resolve => setTimeout(resolve, 800));

      setIsSavingProject(false);

      // Show success emoji briefly
      setSaveButtonEmoji('💾');
      setTimeout(() => {
        setSaveButtonEmoji('💿'); // Reset to start of animation
        setIsSavePressed(false);
      }, 500);

      CustomOverlayHelper.alert('✅ Saved', `Project "${projectName}" saved successfully!`);
    } catch (error) {
      console.error('[VideoEditor] Save failed:', error);
      setIsSavingProject(false);
      CustomOverlayHelper.alert('Error', 'Failed to save project. Please try again.');
      setIsSavePressed(false);
      setSaveButtonEmoji('💿'); // Reset on error
    }
  }, [layers, currentProjectId]);

  // Animated save button emoji cycling (💿 → 📀 → 💽)
  useEffect(() => {
    if (isSavePressed) return; // Don't animate while saving

    const emojis = ['💿', '📀', '💽'];
    let index = emojis.indexOf(saveButtonEmoji);
    if (index === -1) index = 0;

    const timer = setInterval(() => {
      index = (index + 1) % emojis.length;
      setSaveButtonEmoji(emojis[index]);
    }, 1000); // Switch every 1 second

    return () => clearInterval(timer);
  }, [saveButtonEmoji, isSavePressed]);

  const handleInfoPress = useCallback(async () => {
    const projects = await loadProjects();
    setSavedProjects(projects);
    setShowProjectsModal(true);
  }, []);

  const handleLoadProject = useCallback(async (project: SavedProject) => {
    try {
      const videos = await getAllVideos();
      const newLayers: VideoLayer[] = [];

      for (const layerData of project.layers) {
        const video = videos.find(v => v.id === layerData.videoId);
        if (video) {
          newLayers.push({
            id: `layer_${Date.now()}_${Math.random()}`,
            videoId: layerData.videoId,
            metadata: video,
            x: layerData.x,
            y: layerData.y,
            scale: layerData.scale,
            zIndex: layerData.zIndex
          });
        }
      }

      setLayers(newLayers);
      setCurrentProjectId(project.id);
      setShowProjectsModal(false);
      CustomOverlayHelper.alert('✅ Loaded', `Project "${project.name}" loaded successfully!`);
    } catch (error) {
      console.error('[VideoEditor] Load failed:', error);
      CustomOverlayHelper.alert('Error', 'Failed to load project. Please try again.');
    }
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    try {
      await deleteProject(projectId);
      const projects = await loadProjects();
      setSavedProjects(projects);
      CustomOverlayHelper.alert('✅ Deleted', 'Project deleted successfully!');
    } catch (error) {
      console.error('[VideoEditor] Delete failed:', error);
      CustomOverlayHelper.alert('Error', 'Failed to delete project.');
    }
  }, []);

  const handleExportProject = useCallback(async (project: SavedProject) => {
    try {
      // Create JSON file from project
      const projectJson = JSON.stringify(project, null, 2);
      const filename = `${project.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.json`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      await FileSystem.writeAsStringAsync(fileUri, projectJson);

      // Share via iOS share sheet
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: `Export ${project.name}`
        });
      } else {
        CustomOverlayHelper.alert('Error', 'Sharing is not available on this device.');
      }
    } catch (error) {
      console.error('[VideoEditor] Export project failed:', error);
      CustomOverlayHelper.alert('Error', 'Failed to export project. Please try again.');
    }
  }, []);

  // Pick image from library and add as layer
  const handlePickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
        allowsMultipleSelection: false
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        console.log('[VideoEditor] Image picked:', asset.uri, 'size:', asset.width, 'x', asset.height);

        // Add image as a video layer with isImage flag
        const imageMetadata: VideoMetadata & { isImage?: boolean } = {
          id: `image_${Date.now()}`,
          filename: asset.uri.split('/').pop() || 'image.jpg',
          uri: asset.uri,
          width: asset.width || CANVAS_WIDTH,
          height: asset.height || CANVAS_HEIGHT,
          duration: 5000, // 5 seconds default for images
          createdAt: Date.now(),
          isFolder: false,
          isImage: true // Mark as image so rendering knows to use Image component instead of Video
        };

        addLayer(imageMetadata);
        setShowVideoPickerModal(false);
        setCurrentFolder(null);
        setFolderVideos([]);
      }
    } catch (error) {
      console.error('[VideoEditor] Image picker error:', error);
      CustomOverlayHelper.alert('Error', 'Failed to pick image. Please try again.');
    }
  }, [addLayer]);

  // Screen recording using iOS native ReplayKit
  const handleScreenRecording = useCallback(async () => {
    try {
      const ScreenRecorder = NativeModules.ScreenRecorderModule;

      if (!ScreenRecorder) {
        CustomOverlayHelper.alert('Not Available', 'Screen recording is not available on this device.');
        return;
      }

      if (isRecording) {
        // Stop recording
        console.log('[ScreenRecorder] Stopping recording...');
        const result = await ScreenRecorder.stopRecording(false);

        if (result.ok) {
          setIsRecording(false);
          console.log('[ScreenRecorder] Recording saved:', result.url);

          CustomOverlayHelper.alert(
            'Recording Saved',
            'Screen recording has been saved successfully!',
            [
              {
                text: 'View in Files',
                onPress: () => {
                  console.log('[ScreenRecorder] Video path:', result.url);
                }
              },
              { text: 'OK' }
            ]
          );
        } else {
          setIsRecording(false);
          CustomOverlayHelper.alert('Error', result.error || 'Failed to stop recording');
        }
      } else {
        // Start recording
        console.log('[ScreenRecorder] Starting recording...');
        const result = await ScreenRecorder.startRecording(false); // false = no microphone

        if (result.ok) {
          setIsRecording(true);
          console.log('[ScreenRecorder] Recording started, output:', result.url);
        } else {
          CustomOverlayHelper.alert('Error', result.error || 'Failed to start recording');
        }
      }
    } catch (error) {
      console.error('[ScreenRecorder] Error:', error);
      CustomOverlayHelper.alert('Error', 'Screen recording failed. Please try again.');
      setIsRecording(false);
    }
  }, [isRecording]);

  return (
    <View style={styles.container}>
      {/* Header with all buttons in horizontal layout - hide during recording export */}
      {!isRecordingExport && (
        <View style={[styles.header, { paddingTop: insets.top }]}>
          {/* Horizontal toolbar buttons on the left */}
          <View style={styles.headerToolbar}>
            <TouchableOpacity
              style={styles.toolbarButton}
              onPress={handleInfoPress}
              accessibilityRole="button"
              accessibilityLabel="Show saved projects"
            >
              <Text style={styles.toolbarButtonText}>📁</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.toolbarButton}
              onPress={() => setShowInfoModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Show video editor help and FFmpeg license"
            >
              <Text style={styles.toolbarButtonText}>ℹ️</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolbarButton} onPress={handleSaveProject}>
              <Text style={styles.toolbarButtonText}>💾</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolbarButton, isRecordingPosition && { backgroundColor: '#ff6b6b' }]}
              onPress={() => {
                if (!selectedLayerId) {
                  CustomOverlayHelper.alert('No Layer Selected', 'Please select a layer to record its position.');
                  return;
                }
                if (isRecordingPosition) {
                  // Stop recording and immediately start playback animation
                  setIsRecordingPosition(false);
                  setRecordingStartTime(null);

                  // Start playback immediately to show the recorded animation
                  setTimeout(() => {
                    setPlaybackTime(0);
                    setIsPlayingAnimation(true);
                  }, 50);

                  console.log('[VideoEditor] ✅ Position recording stopped, starting playback immediately');
                } else {
                  // Start recording (stop playback if active)
                  setIsPlayingAnimation(false);
                  setPlaybackTime(0);
                  setIsRecordingPosition(true);
                  setRecordingStartTime(Date.now());
                  // Add initial keyframe
                  const layer = layers.find(l => l.id === selectedLayerId);
                  if (layer) {
                    const initialKeyframe: PositionKeyframe = {
                      time: 0,
                      x: layer.x,
                      y: layer.y,
                      scale: layer.scale
                    };
                    setLayers(prev => prev.map(l =>
                      l.id === selectedLayerId
                        ? { ...l, keyframes: [initialKeyframe] }
                        : l
                    ));
                  }
                  console.log('[VideoEditor] ▶️ Position recording started');
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={isRecordingPosition ? 'Stop recording position' : 'Start recording position'}
            >
              <Text style={styles.toolbarButtonText}>📌</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolbarButton, styles.exportToolbarButton]}
              onPress={() => {
                CustomOverlayHelper.alert('Coming Soon', 'Export feature is under development!');
              }}
            >
              <Text style={styles.toolbarButtonText}>📤</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolbarButton]}
              onPress={() => {
                // Show coming soon overlay with random logo
                const randomLogo = getRandomLogoSet();
                setComingSoonLogoSet(randomLogo);
                setComingSoonFrameIndex(0);
                setShowComingSoonOverlay(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Screen recording - coming soon"
            >
              <Text style={styles.toolbarButtonText}>📹</Text>
            </TouchableOpacity>
            {/* Always show position overlay button (greyed when no keyframes) */}
            <TouchableOpacity
              style={[
                styles.toolbarButton,
                // Highlight if recording or if there are keyframes to show
                (isRecordingPosition || layers.some(l => l.keyframes && l.keyframes.length > 0)) && { backgroundColor: '#4ade80' }
              ]}
              onPress={() => setShowPositionOverlay(true)}
              accessibilityRole="button"
              accessibilityLabel="View position keyframes"
            >
              <Text style={styles.toolbarButtonText}>🎬</Text>
            </TouchableOpacity>
          </View>

          {/* Close button on the right */}
          <TouchableOpacity
            style={styles.closeButton}
            onPressIn={async () => {
              setCloseButtonEmoji('✳️');
              await playRandomClickSound();
            }}
            onPressOut={() => {
              setTimeout(() => setCloseButtonEmoji('❎'), 100);
            }}
            onPress={() => {
              setTimeout(() => navigation.goBack(), 150);
            }}
          >
            <Text style={styles.closeButtonText}>{closeButtonEmoji}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main workspace */}
      <View style={styles.workspace}>
        {/* Canvas area */}
        <View
          style={styles.canvasContainer}
          {...canvasPanResponder.panHandlers}
        >
          <View
            ref={canvasRef}
            style={[
              styles.canvas,
              {
                width: CANVAS_WIDTH * canvasZoom,
                height: CANVAS_HEIGHT * canvasZoom,
                transform: [
                  { translateX: canvasPanX },
                  { translateY: canvasPanY }
                ]
              }
            ]}
          >
            {/* 4K frame indicator - hide during recording export */}
            {!isRecordingExport && <View style={styles.canvasFrame} />}

            {/* Video layers */}
            {layers
              .sort((a, b) => a.zIndex - b.zIndex)
              .map(layer => (
                <VideoLayerView
                  key={layer.id}
                  layer={layer}
                  selected={selectedLayerId === layer.id}
                  canvasZoom={canvasZoom}
                  canvasLocked={canvasLocked}
                  onSelect={() => setSelectedLayerId(layer.id)}
                  onMove={(newX, newY) => updateLayerPosition(layer.id, newX, newY)}
                  onScale={(delta) => updateLayerScale(layer.id, delta)}
                  hideFrame={isRecordingExport}
                  videoRefCallback={(ref) => {
                    layerVideoRefs.current.set(layer.id, ref);
                  }}
                />
              ))}
          </View>
        </View>

        {/* Top-left lock button and top-right zoom slider - hide during recording export */}
        {!showLayerList && !isRecordingExport && (
          <>
            {/* Lock button - top-left, no background, 3x bigger emoji */}
            <TouchableOpacity
              style={styles.lockButtonTopLeft}
              onPress={() => setCanvasLocked(!canvasLocked)}
              accessibilityRole="button"
              accessibilityLabel={canvasLocked ? "Canvas locked" : "Canvas unlocked"}
            >
              <Text style={[styles.lockButtonTextLarge, canvasLocked && styles.lockButtonTextActive]}>
                {canvasLocked ? '🔒' : '🔓'}
              </Text>
            </TouchableOpacity>

            {/* Zoom slider - top-right with label */}
            <View style={styles.zoomSliderContainer}>
              <Text style={styles.sliderLabelRight}>ZOOM</Text>
              <View style={styles.zoomSliderPanel}>
                <Slider
                  style={styles.topSlider}
                  minimumValue={0.08}
                  maximumValue={0.5}
                  value={canvasZoom}
                  onValueChange={(value) => {
                    const delta = value - prevZoomRef.current;
                    prevZoomRef.current = value;

                    // Only push letters when knob collides with them
                    if (Math.abs(delta) > 0.001) {
                      const { knobX, knobY, knobRadius } = getKnobPosition(value, 0.08, 0.5, 0);

                      setZoomLetters(prev => prev.map(letter => {
                        const isColliding = checkLetterCollision(letter, knobX, knobY, knobRadius);
                        if (isColliding) {
                          // Small push in direction of slider movement
                          return {
                            ...letter,
                            vx: letter.vx + delta * 300,
                            vy: letter.vy + (Math.random() - 0.5) * 20
                          };
                        }
                        return letter;
                      }));
                    }
                    setCanvasZoom(value);
                  }}
                  minimumTrackTintColor="#ff9f6b"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#ff9f6b"
                />
              </View>
            </View>
          </>
        )}

        {/* Bottom controls: layers, add video, and scale slider - hide during recording export */}
        {!isRecordingExport && (
        <View style={styles.bottomControls}>
          <TouchableOpacity
            style={styles.layersButtonAboveSliders}
            onPress={() => setShowLayerList(!showLayerList)}
          >
            <Text style={styles.layersButtonAboveSlidersText}>📋 ({layers.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addVideoButtonBottomLeft}
            onPress={() => {
              if (availableVideos.length === 0) {
                CustomOverlayHelper.alert('No Videos', 'Go to Video Storage to import videos first.');
                return;
              }
              setShowVideoPickerModal(true);
            }}
          >
            <Text style={styles.addVideoButtonText}>+</Text>
          </TouchableOpacity>

          {/* Scale slider - bottom-right when layer selected */}
          {!showLayerList && selectedLayer && (
            <View style={styles.scaleSliderBottomRight}>
              <Text style={styles.sliderLabelBottom}>SCALE</Text>
              <Slider
                style={styles.bottomSlider}
                minimumValue={0.1}
                maximumValue={5.0}
                value={selectedLayer.scale}
                onValueChange={(value) => {
                  const delta = value - prevScaleRef.current;
                  prevScaleRef.current = value;

                  // Only push letters when knob collides with them
                  if (Math.abs(delta) > 0.01) {
                    const { knobX, knobY, knobRadius } = getKnobPosition(value, 0.1, 5.0, 1);

                    setScaleLetters(prev => prev.map(letter => {
                      const isColliding = checkLetterCollision(letter, knobX, knobY, knobRadius);
                      if (isColliding) {
                        // Small push in direction of slider movement
                        return {
                          ...letter,
                          vx: letter.vx + delta * 150,
                          vy: letter.vy + (Math.random() - 0.5) * 20
                        };
                      }
                      return letter;
                    }));
                  }

                  // Scale from center instead of top-left
                  const oldScale = selectedLayer.scale;
                  const scaleDelta = value - oldScale;

                  // Calculate center point of the video at current scale
                  const videoWidth = selectedLayer.metadata.width * oldScale;
                  const videoHeight = selectedLayer.metadata.height * oldScale;
                  const centerX = selectedLayer.x + videoWidth / 2;
                  const centerY = selectedLayer.y + videoHeight / 2;

                  // Calculate new dimensions
                  const newVideoWidth = selectedLayer.metadata.width * value;
                  const newVideoHeight = selectedLayer.metadata.height * value;

                  // Calculate new position to keep center point fixed
                  const newX = centerX - newVideoWidth / 2;
                  const newY = centerY - newVideoHeight / 2;

                  setLayers(prev =>
                    prev.map(l => (l.id === selectedLayer.id ? { ...l, scale: value, x: newX, y: newY } : l))
                  );
                }}
                minimumTrackTintColor="#ff9f6b"
                maximumTrackTintColor="#333"
                thumbTintColor="#ff9f6b"
              />
            </View>
          )}
        </View>
        )}
      </View>

      {layers.length > 0 && !isRecordingExport && (
        <View style={styles.layerFilmstrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.layerFilmstripContent}
          >
            {[...layers]
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((layer, index, sortedArray) => (
                <FilmstripItem
                  key={layer.id}
                  layer={layer}
                  isSelected={selectedLayerId === layer.id}
                  isDragging={draggingLayerId === layer.id}
                  onPress={() => setSelectedLayerId(layer.id)}
                  onLongPress={() => setDraggingLayerId(layer.id)}
                  onDragOver={(targetLayerId) => {
                    if (draggingLayerId && draggingLayerId !== targetLayerId) {
                      swapLayers(draggingLayerId, targetLayerId);
                    }
                  }}
                  onDragEnd={() => setDraggingLayerId(null)}
                  onDuplicate={() => {
                    // Add same video again, positioned to the right
                    const newLayer: VideoLayer = {
                      id: `${Date.now()}_${Math.random()}`,
                      metadata: layer.metadata,
                      x: layer.x + 200, // Position to the right
                      y: layer.y,
                      scale: layer.scale,
                      zIndex: layers.length // Put on top
                    };
                    setLayers([...layers, newLayer]);
                    setSelectedLayerId(newLayer.id);
                  }}
                />
              ))}
          </ScrollView>
        </View>
      )}

      {/* Layer list overlay (toggleable) */}
      {showLayerList && (
        <View style={styles.layerListOverlay}>
          <View style={styles.layerListPanel}>
            <View style={styles.layerListHeader}>
              <TouchableOpacity
                style={styles.addLayerButton}
                onPress={() => {
                  if (availableVideos.length === 0) {
                    CustomOverlayHelper.alert('No Videos', 'Go to Video Storage to import videos first.');
                    return;
                  }
                  setShowLayerList(false);
                  setShowVideoPickerModal(true);
                }}
              >
                <Text style={styles.addLayerButtonText}>+</Text>
              </TouchableOpacity>
              <Text style={styles.layerListTitle}>Layers ({layers.length})</Text>
              <TouchableOpacity
                style={styles.closeLayerListButton}
                onPress={() => setShowLayerList(false)}
              >
                <Text style={styles.closeLayerListButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.layerListScroll}>
              {layers.length === 0 && (
                <Text style={styles.emptyLayersText}>
                  Tap + to add videos
                </Text>
              )}

              {[...layers]
                .sort((a, b) => b.zIndex - a.zIndex) // Top to bottom
                .map((layer, index) => (
                  <View
                    key={layer.id}
                    style={[
                      styles.layerItem,
                      selectedLayerId === layer.id && styles.layerItemSelected
                    ]}
                  >
                    {/* Layer preview thumbnail */}
                    <View style={styles.layerThumbnailContainer}>
                      {layer.metadata.previewUri ? (
                        <LayerPreviewVideo uri={layer.metadata.previewUri} />
                      ) : layer.metadata.thumbnail ? (
                        <Image source={{ uri: layer.metadata.thumbnail }} style={styles.layerThumbnail} />
                      ) : (
                        <View style={styles.layerThumbnailPlaceholder}>
                          <Text style={styles.layerThumbnailIcon}>VID</Text>
                        </View>
                      )}
                    </View>

                    <TouchableOpacity
                      style={styles.layerInfo}
                      onPress={() => {
                        setSelectedLayerId(layer.id);
                        setShowLayerList(false);
                      }}
                    >
                      <Text style={styles.layerName} numberOfLines={1}>
                        {layer.metadata.filename}
                      </Text>
                      <Text style={styles.layerDetails}>
                        {Math.round(layer.scale * 100)}% • Layer {layers.length - layer.zIndex}
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.layerActions}>
                      <TouchableOpacity
                        style={styles.layerActionButton}
                        onPress={() => moveLayerUp(layer.id)}
                        disabled={index === 0}
                      >
                        <Text style={[styles.layerActionText, index === 0 && styles.layerActionDisabled]}>⬆️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.layerActionButton}
                        onPress={() => moveLayerDown(layer.id)}
                        disabled={index === layers.length - 1}
                      >
                        <Text style={[styles.layerActionText, index === layers.length - 1 && styles.layerActionDisabled]}>⬇️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.layerActionButton}
                        onPress={() => removeLayer(layer.id)}
                      >
                        <Text style={styles.layerActionText}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
            </ScrollView>
          </View>
        </View>
      )}

      {/* Loading videos overlay */}
      {isLoadingVideos && (
        <View style={styles.exportOverlay}>
          <ActivityIndicator size="large" color="#ff9f6b" />
          <Text style={styles.exportText}>Loading videos...</Text>
        </View>
      )}

      {/* Export loading overlay */}
      {isExporting && (
        <AnimatedLoader
          progress={exportProgress}
          message={exportStatus || 'Exporting video...'}
          showProgressBar={true}
        />
      )}


      {/* Video Picker Modal */}
      {showVideoPickerModal && (
        <View style={styles.projectsModal}>
          <View style={styles.projectsModalContent}>
            <View style={styles.projectsModalHeader}>
              {currentFolder ? (
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => {
                    setCurrentFolder(null);
                    setFolderVideos([]);
                  }}
                >
                  <Text style={styles.backButtonText}>← Back</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.projectsModalTitle}>
                {currentFolder ? currentFolder.wordTitle || currentFolder.folderName : 'Add Videos to Project'}
              </Text>
              <TouchableOpacity onPress={() => {
                setShowVideoPickerModal(false);
                setCurrentFolder(null);
                setFolderVideos([]);
              }}>
                <Text style={styles.projectsModalClose}>×</Text>
              </TouchableOpacity>
            </View>
            {/* Camera button for adding images */}
            {!currentFolder && (
              <TouchableOpacity
                style={styles.imagePickerButton}
                onPress={handlePickImage}
              >
                <Text style={styles.imagePickerIcon}>📷</Text>
                <Text style={styles.imagePickerText}>Add Image from Library</Text>
              </TouchableOpacity>
            )}
            <ScrollView style={styles.projectsList}>
              {(currentFolder ? folderVideos : availableVideos).length === 0 ? (
                <Text style={styles.projectsEmptyText}>
                  {currentFolder ? 'No videos in this folder' : 'No videos available. Go to Video Storage to import some!'}
                </Text>
              ) : (
                (currentFolder ? folderVideos : availableVideos).map(video => (
                  <TouchableOpacity
                    key={video.id}
                    style={styles.videoPickerItem}
                    onPress={async () => {
                      if (video.isFolder && !currentFolder) {
                        // Navigate into folder
                        setCurrentFolder(video);
                        // Load folder contents
                        try {
                          const folderPath = video.folderPath!;
                          const folderContents = await FileSystem.readDirectoryAsync(folderPath);
                          const videoFiles = folderContents.filter(f => f.endsWith('.mov') || f.endsWith('.MOV'));

                          const videos: VideoMetadata[] = videoFiles.map((file, idx) => ({
                            id: `${video.id}_${file}`,
                            filename: file,
                            uri: `${folderPath}/${file}`,
                            width: 512,
                            height: 512,
                            duration: 2000,
                            createdAt: Date.now(),
                            isFolder: false
                          }));
                          setFolderVideos(videos);
                        } catch (error) {
                          console.error('[VideoEditor] Failed to load folder:', error);
                        }
                      } else {
                        // Add video as layer
                        addLayer(video);
                        setShowVideoPickerModal(false);
                        setCurrentFolder(null);
                        setFolderVideos([]);
                      }
                    }}
                  >
                    {video.isFolder ? (
                      <View style={styles.videoPickerThumbnailPlaceholder}>
                        <Text style={styles.videoPickerIcon}>📁</Text>
                        {video.videoCount ? (
                          <Text style={styles.folderCountBadge}>{video.videoCount}</Text>
                        ) : null}
                      </View>
                    ) : video.previewUri ? (
                      <Video
                        source={{ uri: video.previewUri }}
                        style={styles.videoPickerThumbnail}
                        resizeMode={ResizeMode.COVER}
                        shouldPlay
                        isLooping
                        isMuted
                        useNativeControls={false}
                      />
                    ) : video.thumbnail ? (
                      <Image source={{ uri: video.thumbnail }} style={styles.videoPickerThumbnail} />
                    ) : (
                      <View style={styles.videoPickerThumbnailPlaceholder}>
                        <Text style={styles.videoPickerIcon}>VID</Text>
                      </View>
                    )}
                    <View style={styles.videoPickerInfo}>
                      <Text style={styles.videoPickerName} numberOfLines={1}>
                        {video.isFolder ? (video.wordTitle || video.folderName) : video.filename}
                      </Text>
                      <Text style={styles.videoPickerDetails}>
                        {video.isFolder
                          ? `${video.videoCount || 0} videos`
                          : `${video.width}×${video.height} • ${Math.round(video.duration / 1000)}s`
                        }
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {/* Info Modal - Help and License */}
      <Modal
        visible={showInfoModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}
        supportedOrientations={Platform.OS === 'ios' && (Platform as any)?.isPad ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ width: '100%', maxWidth: 600, height: '90%', backgroundColor: '#1a1a1a', borderRadius: 16, borderWidth: 2, borderColor: '#ff9f6b' }}>
            {/* Close button */}
            <TouchableOpacity
              onPress={() => setShowInfoModal(false)}
              style={{ position: 'absolute', top: 10, right: 10, width: 40, height: 40, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, justifyContent: 'center', alignItems: 'center', zIndex: 10 }}
            >
              <Text style={{ color: '#fff', fontSize: 28, fontWeight: 'bold' }}>×</Text>
            </TouchableOpacity>

            {/* Title */}
            <Text style={{ color: '#ff9f6b', fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginTop: 20, marginBottom: 10, fontFamily: 'vrtlfinal' }}>
              {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].title}
            </Text>

            {/* Language Flags - smaller, no panels */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, marginBottom: 20 }}>
              {VIDEO_EDITOR_LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang.id}
                  onPress={() => setInfoLanguage(lang.id as VideoEditorLanguage)}
                  style={{
                    opacity: infoLanguage === lang.id ? 1 : 0.35,
                    transform: [{ scale: infoLanguage === lang.id ? 1.15 : 1 }]
                  }}
                >
                  <Text style={{ fontSize: 26 }}>{lang.flag}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Scrollable content */}
            <ScrollView
              style={{ flex: 1, padding: 20 }}
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={true}
            >
                <Text style={styles.infoSectionTitle}>{VIDEO_EDITOR_TRANSLATIONS[infoLanguage].overview}</Text>
                <Text style={styles.infoText}>
                  {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].overviewText}
                </Text>

                <Text style={styles.infoSectionTitle}>{VIDEO_EDITOR_TRANSLATIONS[infoLanguage].allButtons}</Text>

                <Text style={styles.infoBold}>{VIDEO_EDITOR_TRANSLATIONS[infoLanguage].topToolbar}</Text>
                <Text style={styles.infoText}>
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].projectsButton}{'\n'}
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].infoButton}{'\n'}
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].saveButton}{'\n'}
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].exportButton}{'\n'}
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].closeButton}
                </Text>

                <Text style={styles.infoBold}>{VIDEO_EDITOR_TRANSLATIONS[infoLanguage].canvasControls}</Text>
                <Text style={styles.infoText}>
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].lockButton}{'\n'}
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].zoomSlider}{'\n'}
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].scaleSlider}
                </Text>

                <Text style={styles.infoBold}>{VIDEO_EDITOR_TRANSLATIONS[infoLanguage].bottomControls}</Text>
                <Text style={styles.infoText}>
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].layersButton}{'\n'}
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].addVideoButton}{'\n'}
                  • {VIDEO_EDITOR_TRANSLATIONS[infoLanguage].filmstrip}
                </Text>

                {/* Legal Notice Section */}
                <View style={{ marginTop: 30, marginBottom: 20 }}>
                  <Text style={{...styles.infoSectionTitle, textAlign: 'center'}}>{VIDEO_EDITOR_TRANSLATIONS[infoLanguage].legal}</Text>
                  <Text style={{...styles.infoText, textAlign: 'center', fontSize: 12, marginTop: 10 }}>
                    This Video Editor uses FFmpeg Kit for video processing.{'\n\n'}
                    FFmpeg Kit is licensed under the LGPL v3.0 license.{'\n\n'}
                    Copyright © 2018-2024 Taner Sener.{'\n\n'}
                    Full source code and licenses available at:{'\n'}
                    https://ffmpeg.org{'\n'}
                    https://github.com/arthenica/ffmpeg-kit
                  </Text>

                  {/* Animated Logo */}
                  {logoSet && logoSet.frames && logoSet.frames.length > 0 && (
                    <View style={{ alignItems: 'center', marginTop: 30, marginBottom: 20 }}>
                      <Image
                        source={
                          logoFrameIndex === 0 || logoFrameIndex - 1 >= logoSet.frames.length
                            ? logoSet.baseIcon
                            : (logoSet.frames[logoFrameIndex - 1] ?? logoSet.baseIcon)
                        }
                        style={{ width: 120, height: 120, resizeMode: 'contain' }}
                      />
                    </View>
                  )}
                </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Saved Projects Modal */}
      <Modal
        visible={showProjectsModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowProjectsModal(false)}
        supportedOrientations={Platform.OS === 'ios' && (Platform as any)?.isPad ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={styles.projectsModal}>
          <View style={styles.projectsModalContent}>
            <View style={styles.projectsModalHeader}>
              {/* Animated save button on the left */}
              <TouchableOpacity
                onPressIn={() => {
                  setIsSavePressed(true);
                  setSaveButtonEmoji('🪩');
                }}
                onPress={handleSaveProject}
                style={styles.projectsModalSaveButton}
              >
                <Text style={styles.projectsModalSaveButtonText}>{isSavePressed ? '🪩' : saveButtonEmoji}</Text>
              </TouchableOpacity>

              <Text style={styles.projectsModalTitle}>Saved Projects</Text>

              {/* Close button on the right */}
              <TouchableOpacity onPress={() => setShowProjectsModal(false)}>
                <Text style={styles.projectsModalClose}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.projectsList}>
              {savedProjects.length === 0 ? (
                <Text style={styles.projectsEmptyText}>No saved projects yet. Save your current composition to get started!</Text>
              ) : (
                savedProjects.map(project => (
                  <View key={project.id} style={styles.projectItem}>
                    {project.thumbnail && (
                      <Image source={{ uri: project.thumbnail }} style={styles.projectThumbnail} />
                    )}
                    <View style={styles.projectInfo}>
                      <Text style={styles.projectName}>{project.name}</Text>
                      <Text style={styles.projectDetails}>
                        {project.layers.length} layers • {new Date(project.timestamp).toLocaleDateString()}
                      </Text>
                    </View>
                    <View style={styles.projectActions}>
                      <TouchableOpacity
                        style={styles.projectActionButton}
                        onPress={() => handleLoadProject(project)}
                      >
                        <Text style={styles.projectActionText}>Load</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.projectActionButton}
                        onPress={() => handleExportProject(project)}
                      >
                        <Text style={styles.projectActionText}>Export</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.projectActionButton, styles.projectDeleteButton]}
                        onPress={() => {
                          CustomOverlayHelper.alert(
                            'Delete Project',
                            `Are you sure you want to delete "${project.name}"?`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: () => handleDeleteProject(project.id) }
                            ]
                          );
                        }}
                      >
                        <Text style={styles.projectActionText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            {/* Video Storage button - only show if videos exist */}
            {availableVideos.length > 0 && (
              <TouchableOpacity
                style={styles.videoStorageButton}
                onPress={() => {
                  setShowProjectsModal(false);
                  navigation.navigate('VideoStorage');
                }}
              >
                <Text style={styles.videoStorageButtonText}>Video Storage</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Recording Preview Modal */}
      <Modal
        visible={showRecordingPreview}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowRecordingPreview(false);
          setRecordingPreviewUrl(null);
        }}
        supportedOrientations={Platform.OS === 'ios' && (Platform as any)?.isPad ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={styles.recordingPreviewModal}>
          <View style={styles.recordingPreviewContent}>
            {/* Header with close button */}
            <View style={styles.recordingPreviewHeader}>
              <Text style={styles.recordingPreviewTitle}>📹 Screen Recording</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowRecordingPreview(false);
                  setRecordingPreviewUrl(null);
                }}
                style={styles.recordingPreviewCloseButton}
              >
                <Text style={styles.recordingPreviewCloseText}>×</Text>
              </TouchableOpacity>
            </View>

            {/* Video preview with autoplay and loop */}
            {recordingPreviewUrl && (
              <View style={styles.recordingPreviewVideoContainer}>
                <Video
                  source={{ uri: recordingPreviewUrl }}
                  style={styles.recordingPreviewVideo}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  isLooping
                  shouldPlay
                  isMuted={!settings.soundEnabled}
                />
              </View>
            )}

            {/* Action buttons */}
            <View style={styles.recordingPreviewActions}>
              <TouchableOpacity
                style={[styles.recordingPreviewButton, styles.recordingPreviewButtonPrimary]}
                onPress={async () => {
                  if (recordingPreviewUrl) {
                    try {
                      await Sharing.shareAsync(recordingPreviewUrl, {
                        mimeType: 'video/mp4',
                        dialogTitle: 'Share Recording'
                      });
                    } catch (err) {
                      console.error('[ScreenRecorder] Share failed:', err);
                      CustomOverlayHelper.alert('Error', 'Failed to share recording.');
                    }
                  }
                }}
              >
                <Text style={styles.recordingPreviewButtonText}>📤 Share</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.recordingPreviewButton, styles.recordingPreviewButtonSecondary]}
                onPress={() => {
                  setShowRecordingPreview(false);
                  setRecordingPreviewUrl(null);
                }}
              >
                <Text style={styles.recordingPreviewButtonText}>✓ Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Position Overlay Modal */}
      <Modal
        visible={showPositionOverlay}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPositionOverlay(false)}
        supportedOrientations={Platform.OS === 'ios' && (Platform as any)?.isPad ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={styles.positionOverlayModal}>
          <View style={styles.positionOverlayContent}>
            {/* Header */}
            <View style={styles.positionOverlayHeader}>
              <Text style={styles.positionOverlayTitle}>🎬 Position Keyframes</Text>
              <TouchableOpacity
                onPress={() => setShowPositionOverlay(false)}
                style={styles.positionOverlayCloseButton}
              >
                <Text style={styles.positionOverlayCloseText}>×</Text>
              </TouchableOpacity>
            </View>

            {/* Layers with keyframes */}
            <ScrollView style={styles.positionOverlayScroll}>
              {layers.filter(layer => layer.keyframes && layer.keyframes.length > 0).length === 0 ? (
                <View style={styles.positionOverlayEmpty}>
                  <Text style={styles.positionOverlayEmptyIcon}>🎬</Text>
                  <Text style={styles.positionOverlayEmptyText}>No position animations yet</Text>
                  <Text style={styles.positionOverlayEmptyHint}>
                    Select a layer, press 📌 to start recording, move the layer, then press 📌 again to stop
                  </Text>
                </View>
              ) : (
                layers
                  .filter(layer => layer.keyframes && layer.keyframes.length > 0)
                  .map(layer => (
                    <View key={layer.id} style={styles.positionOverlayLayer}>
                      {/* Layer header */}
                      <View style={styles.positionOverlayLayerHeader}>
                        <View style={styles.positionOverlayLayerInfo}>
                          <Text style={styles.positionOverlayLayerName} numberOfLines={1}>
                            {layer.metadata.filename}
                          </Text>
                          <Text style={styles.positionOverlayLayerKeyframeCount}>
                            {layer.keyframes?.length || 0} keyframes
                          </Text>
                        </View>

                        {/* Playback controls */}
                        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 8 }}>
                          <TouchableOpacity
                            style={{
                              backgroundColor: isPlayingAnimation ? '#ff6b6b' : '#4ade80',
                              paddingHorizontal: 16,
                              paddingVertical: 8,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: isPlayingAnimation ? '#ff8888' : '#6bffb0'
                            }}
                            onPress={() => {
                              if (isPlayingAnimation) {
                                // Pause playback
                                setIsPlayingAnimation(false);
                              } else {
                                // Start playback from beginning
                                setPlaybackTime(0);
                                setIsPlayingAnimation(true);
                              }
                            }}
                          >
                            <Text style={{ fontSize: 20 }}>{isPlayingAnimation ? '⏸️' : '▶️'}</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={{
                              backgroundColor: '#666',
                              paddingHorizontal: 16,
                              paddingVertical: 8,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: '#888'
                            }}
                            onPress={() => {
                              // Stop playback and reset to start
                              setIsPlayingAnimation(false);
                              setPlaybackTime(0);
                            }}
                          >
                            <Text style={{ fontSize: 20 }}>⏹️</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={styles.positionOverlayLayerActions}>
                          <TouchableOpacity
                            style={styles.positionOverlayReRecordButton}
                            onPress={() => {
                              // Clear keyframes and start new recording
                              setLayers(prev => prev.map(l =>
                                l.id === layer.id ? { ...l, keyframes: [] } : l
                              ));
                              setSelectedLayerId(layer.id);
                              setIsRecordingPosition(true);
                              setRecordingStartTime(Date.now());
                              setIsPlayingAnimation(false);
                              setShowPositionOverlay(false);
                              CustomOverlayHelper.alert('Recording', 'Move the layer to record new position keyframes. Press 📌 when done.');
                            }}
                          >
                            <Text style={styles.positionOverlayReRecordText}>🔄 Re-Record</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.positionOverlayClearButton}
                            onPress={() => {
                              CustomOverlayHelper.alert(
                                'Clear Keyframes',
                                `Remove all position keyframes from "${layer.metadata.filename}"?`,
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Clear',
                                    style: 'destructive',
                                    onPress: () => {
                                      setLayers(prev => prev.map(l =>
                                        l.id === layer.id ? { ...l, keyframes: [] } : l
                                      ));
                                      setIsPlayingAnimation(false);
                                    }
                                  }
                                ]
                              );
                            }}
                          >
                            <Text style={styles.positionOverlayClearText}>🗑️</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Keyframes list */}
                      <View style={styles.positionOverlayKeyframes}>
                        {layer.keyframes?.map((keyframe, index) => (
                          <View key={`${layer.id}-${index}`} style={styles.positionOverlayKeyframe}>
                            <View style={styles.positionOverlayKeyframeInfo}>
                              <Text style={styles.positionOverlayKeyframeTime}>
                                {(keyframe.time / 1000).toFixed(2)}s
                              </Text>
                              <Text style={styles.positionOverlayKeyframeDetails}>
                                x: {keyframe.x.toFixed(0)}, y: {keyframe.y.toFixed(0)}, scale: {keyframe.scale.toFixed(2)}
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={styles.positionOverlayKeyframeRemove}
                              onPress={() => {
                                setLayers(prev => prev.map(l =>
                                  l.id === layer.id
                                    ? { ...l, keyframes: l.keyframes?.filter((_, i) => i !== index) }
                                    : l
                                ));
                              }}
                            >
                              <Text style={styles.positionOverlayKeyframeRemoveText}>×</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))
              )}
            </ScrollView>

            {/* Info footer */}
            <View style={styles.positionOverlayFooter}>
              <Text style={styles.positionOverlayFooterText}>
                💡 Tip: Position keyframes will be played back during recording
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Coming Soon Overlay Modal */}
      <Modal
        visible={showComingSoonOverlay}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowComingSoonOverlay(false)}
      >
        <View style={styles.comingSoonOverlay}>
          <Animated.View style={[
            styles.comingSoonContent,
            {
              transform: [{
                scale: showComingSoonOverlay ? 1 : 0
              }]
            }
          ]}>
            <Text style={styles.comingSoonText}>Coming Soon</Text>
            {comingSoonLogoSet && (
              <View style={styles.comingSoonLogoContainer}>
                {comingSoonLogoSet.type === 'video' ? (
                  <Video
                    source={comingSoonLogoSet.videoSource}
                    style={styles.comingSoonLogo}
                    shouldPlay
                    isLooping
                    isMuted
                    resizeMode={ResizeMode.CONTAIN}
                  />
                ) : (
                  <Image
                    source={comingSoonLogoSet.type === 'frames' && comingSoonLogoSet.frames
                      ? comingSoonLogoSet.frames[comingSoonFrameIndex % comingSoonLogoSet.frames.length]
                      : comingSoonLogoSet.baseIcon}
                    style={styles.comingSoonLogo}
                    resizeMode="contain"
                  />
                )}
              </View>
            )}
          </Animated.View>
        </View>
      </Modal>

      {/* Welcome Message Modal - First Visit */}
      <Modal
        visible={showWelcomeMessage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowWelcomeMessage(false)}
      >
        <TouchableOpacity
          style={styles.welcomeOverlay}
          activeOpacity={1}
          onPress={() => setShowWelcomeMessage(false)}
        >
          <View style={styles.welcomeContent}>
            <Text style={styles.welcomeTitle}>Video Editor Workspace</Text>
            <Text style={styles.welcomeSubtitle}>Still in Development</Text>

            <Text style={styles.welcomeMessage}>
              Export and many features are not built yet.{'\n'}
              Stay tuned for updates!
            </Text>

            {/* Small logo video */}
            {welcomeLogoSet && (
              <View style={styles.welcomeLogoContainer}>
                {welcomeLogoSet.type === 'video' ? (
                  <Video
                    source={welcomeLogoSet.videoSource}
                    style={styles.welcomeLogo}
                    shouldPlay
                    isLooping
                    isMuted
                    resizeMode={ResizeMode.CONTAIN}
                  />
                ) : (
                  <Image
                    source={welcomeLogoSet.type === 'frames' && welcomeLogoSet.frames
                      ? welcomeLogoSet.frames[welcomeFrameIndex % welcomeLogoSet.frames.length]
                      : welcomeLogoSet.baseIcon}
                    style={styles.welcomeLogo}
                    resizeMode="contain"
                  />
                )}
              </View>
            )}

            <Text style={styles.welcomeVersion}>Version {APP_VERSION}</Text>

            <Text style={styles.welcomeDismissHint}>Tap anywhere to continue</Text>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Save Project Loader Overlay */}
      {isSavingProject && (
        <View style={styles.saveLoaderOverlay}>
          <View style={styles.saveLoaderContainer}>
            <AnimatedLoader
              message="Saving Project..."
              emoji="💾"
            />
            <Text style={styles.saveLoaderText}>Capturing workspace snapshot</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// Filmstrip item component with drag-to-reorder and duplicate
interface FilmstripItemProps {
  layer: VideoLayer;
  isSelected: boolean;
  isDragging: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDragOver: (layerId: string) => void;
  onDragEnd: () => void;
  onDuplicate: () => void;
}

function FilmstripItem({
  layer,
  isSelected,
  isDragging,
  onPress,
  onLongPress,
  onDragOver,
  onDragEnd,
  onDuplicate
}: FilmstripItemProps) {
  const [showDuplicateBubble, setShowDuplicateBubble] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const extraLongPressTimer = useRef<NodeJS.Timeout | null>(null);

  const handlePressIn = useCallback(() => {
    // Start timer for long press (drag mode)
    longPressTimer.current = setTimeout(() => {
      onLongPress();
      // Start extra-long press timer for duplicate option
      extraLongPressTimer.current = setTimeout(() => {
        setShowDuplicateBubble(true);
      }, 5000); // 5 seconds total (long press happens at ~500ms, so 4.5s more)
    }, 500);
  }, [onLongPress]);

  const handlePressOut = useCallback(() => {
    // Clear timers
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (extraLongPressTimer.current) {
      clearTimeout(extraLongPressTimer.current);
      extraLongPressTimer.current = null;
    }
    setShowDuplicateBubble(false);
  }, []);

  const handleDuplicate = useCallback(() => {
    setShowDuplicateBubble(false);
    handlePressOut();
    onDuplicate();
  }, [onDuplicate, handlePressOut]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => isDragging,
      onPanResponderMove: () => {
        // Trigger drag over when moving
        if (isDragging) {
          onDragOver(layer.id);
        }
      },
      onPanResponderRelease: () => {
        if (isDragging) {
          onDragEnd();
        }
        handlePressOut();
      }
    })
  ).current;

  return (
    <View style={{ position: 'relative' }}>
      <TouchableOpacity
        style={[
          styles.filmstripItem,
          isSelected ? styles.filmstripItemSelected : styles.filmstripItemUnselected,
          isDragging && styles.filmstripItemDragging
        ]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        {...panResponder.panHandlers}
      >
      {layer.metadata.previewUri ? (
        <Video
          source={{ uri: layer.metadata.previewUri }}
          style={styles.filmstripThumbnail}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping
          isMuted
          useNativeControls={false}
        />
      ) : layer.metadata.thumbnail ? (
        <Image source={{ uri: layer.metadata.thumbnail }} style={styles.filmstripThumbnail} />
      ) : (
        <View style={styles.filmstripThumbnailPlaceholder}>
          <Text style={styles.filmstripPlaceholderIcon}>VID</Text>
        </View>
      )}
      <Text style={styles.filmstripLabel} numberOfLines={1}>
        {layer.metadata.filename}
      </Text>
      {/* Position keyframe indicator */}
      {layer.keyframes && layer.keyframes.length > 0 && (
        <View style={styles.filmstripKeyframeBadge}>
          <Text style={styles.filmstripKeyframeBadgeText}>📌</Text>
        </View>
      )}
    </TouchableOpacity>

      {/* Duplicate bubble - speech bubble style */}
      {showDuplicateBubble && (
        <View style={styles.duplicateBubble}>
          <TouchableOpacity
            style={styles.duplicateButton}
            onPress={handleDuplicate}
          >
            <Text style={styles.duplicateButtonText}>Duplicate</Text>
          </TouchableOpacity>
          <View style={styles.duplicateBubbleArrow} />
        </View>
      )}
    </View>
  );
}

// Layer preview video component with simplified playback to prevent crashes
const LayerPreviewVideo: React.FC<{ uri: string }> = ({ uri }) => {
  return (
    <Video
      source={{ uri }}
      style={styles.layerThumbnail}
      resizeMode={ResizeMode.COVER}
      shouldPlay
      isLooping
      isMuted
      useNativeControls={false}
      pointerEvents="none"
    />
  );
};

// Video layer component with drag gesture
interface VideoLayerViewProps {
  layer: VideoLayer;
  selected: boolean;
  canvasZoom: number;
  canvasLocked: boolean;
  onSelect: () => void;
  onMove: (newX: number, newY: number) => void;
  onScale: (delta: number) => void;
  hideFrame?: boolean;
  videoRefCallback?: (ref: any) => void;
}

function VideoLayerView({
  layer,
  selected,
  canvasZoom,
  canvasLocked,
  onSelect,
  onMove,
  onScale,
  hideFrame = false,
  videoRefCallback
}: VideoLayerViewProps) {
  const initialPos = useRef({ x: layer.x, y: layer.y });
  const initialScale = useRef(layer.scale);
  const initialDistance = useRef(0);
  const lockedRef = useRef(canvasLocked);
  const isDraggingRef = useRef(false);
  lockedRef.current = canvasLocked;

  // Animated glow for selected layer
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (selected) {
      // Pulse animation when selected
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: false
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 800,
            useNativeDriver: false
          })
        ])
      ).start();
    } else {
      glowAnim.setValue(0);
    }
  }, [selected, glowAnim]);

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#ff9f6b', '#ffcc99']
  });

  // Use high-quality MOV file instead of preview
  const videoSource = useMemo(() => layer.metadata.uri, [layer.metadata.uri]);

  // CRITICAL: Force re-mount video when layer changes to prevent stale video state
  // Simple key based on layer properties (excluding zIndex to prevent remount on reorder)
  // Include retryCount to force remount on retry
  const videoKey = useMemo(() => `${layer.id}_${layer.metadata.uri}_retry${retryCount}`, [layer.id, layer.metadata.uri, retryCount]);

  // Enhanced playback for short videos
  const videoRef = useRef<any>(null);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastErrorRef = useRef<string>('');

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  // Ensure video starts playing when mounted
  useEffect(() => {
    setHasError(false); // Reset error state when video changes
    const startPlayback = async () => {
      if (!videoRef.current) return;
      try {
        await videoRef.current.playAsync();
      } catch (error) {
        console.warn('[VideoEditor] Failed to start playback:', error);
        // Don't immediately set error - onError handler will catch it
      }
    };

    // Small delay to ensure video is ready (increased for stability)
    const timeout = setTimeout(startPlayback, 200);
    return () => clearTimeout(timeout);
  }, [videoKey]); // Re-run when video changes

  // Expose video ref to parent for export functionality
  useEffect(() => {
    if (videoRef.current && videoRefCallback) {
      videoRefCallback(videoRef);
    }
  }, [videoRef.current, videoRefCallback]);

  const ensurePlayingCanvas = useCallback(async () => {
    if (!videoRef.current || hasError) return;
    try {
      const status = await videoRef.current.getStatusAsync();
      if (status.isLoaded && !status.isPlaying) {
        // CRITICAL: Don't seek - let isLooping handle it naturally
        await videoRef.current.playAsync();
      }
    } catch (error) {
      // Silently fail - video might be unmounting or recovering
    }
  }, [hasError]);

  const handleCanvasStatusUpdate = useCallback(
    (status: any) => {
      if (!status || !status.isLoaded || hasError) return;

      // Auto-restart if stopped - isLooping should handle this but we ensure it plays
      if (!status.isPlaying) {
        ensurePlayingCanvas();
      }
    },
    [ensurePlayingCanvas, hasError]
  );

  // Robust error recovery with exponential backoff
  const handleVideoError = useCallback((error: any) => {
    const errorMsg = JSON.stringify(error);

    // Avoid duplicate error handling
    if (errorMsg === lastErrorRef.current && retryTimeoutRef.current) {
      return;
    }
    lastErrorRef.current = errorMsg;

    console.warn('[VideoEditor] Video playback error for', layer.metadata.filename, ':', error);

    // Try to recover up to 3 times with exponential backoff
    if (retryCount < 3) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 4000); // 1s, 2s, 4s
      console.log(`[VideoEditor] Retrying ${layer.metadata.filename} in ${delay}ms (attempt ${retryCount + 1}/3)`);

      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      retryTimeoutRef.current = setTimeout(() => {
        console.log(`[VideoEditor] Attempting retry for ${layer.metadata.filename}`);
        setRetryCount(prev => prev + 1);
        setHasError(false);
        retryTimeoutRef.current = null;
      }, delay);
    } else {
      console.error(`[VideoEditor] Failed to play ${layer.metadata.filename} after 3 retries`);
      setHasError(true);
    }
  }, [layer.metadata.filename, retryCount]);

  // Helper to calculate distance between two touches
  const getDistance = (touches: any[]) => {
    if (touches.length < 2) return 0;
    const [touch1, touch2] = touches;
    const dx = touch1.pageX - touch2.pageX;
    const dy = touch1.pageY - touch2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => lockedRef.current, // When locked (true), can move videos
      onPanResponderGrant: (evt) => {
        if (!lockedRef.current) {
          return;
        }
        isDraggingRef.current = true;
        onSelect();
        // CRITICAL FIX: Always use current layer position, not stale ref
        initialPos.current = { x: layer.x, y: layer.y };
        initialScale.current = layer.scale;

        if (evt.nativeEvent.touches.length === 2) {
          initialDistance.current = getDistance(evt.nativeEvent.touches);
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        if (!lockedRef.current || !isDraggingRef.current) {
          return;
        }
        const touches = evt.nativeEvent.touches;

        if (touches.length === 2) {
          // Two-finger pinch: scale from center
          const currentDistance = getDistance(touches);
          if (initialDistance.current > 0) {
            const distanceDelta = currentDistance - initialDistance.current;
            const scaleDelta = distanceDelta / 400; // Slower scaling

            // Calculate new scale
            const newScale = Math.max(0.1, Math.min(5.0, initialScale.current + scaleDelta));
            const scaleRatio = newScale / layer.scale;

            // Scale from center: adjust position to keep center fixed
            const centerX = layer.x + (layer.metadata.width * layer.scale) / 2;
            const centerY = layer.y + (layer.metadata.height * layer.scale) / 2;
            const newWidth = layer.metadata.width * newScale;
            const newHeight = layer.metadata.height * newScale;
            const newX = centerX - newWidth / 2;
            const newY = centerY - newHeight / 2;

            onScale(scaleDelta);
            onMove(newX, newY);
            initialScale.current = newScale;
            initialDistance.current = currentDistance;
          }
        } else if (touches.length === 1) {
          // CRITICAL FIX: Use full speed drag (removed 0.5 multiplier)
          const newX = initialPos.current.x + (gestureState.dx / canvasZoom);
          const newY = initialPos.current.y + (gestureState.dy / canvasZoom);
          onMove(newX, newY);
        }
      },
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (!lockedRef.current) {
          return false;
        }
        return Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => {
        initialDistance.current = 0;
        isDraggingRef.current = false;
        // Update initialPos to current position to prevent jumping
        initialPos.current = { x: layer.x, y: layer.y };
      }
    })
  ).current;

  return (
    <Animated.View
      pointerEvents={canvasLocked ? 'auto' : 'none'}
      {...panResponder.panHandlers}
      style={[
        styles.videoLayer,
        {
          left: layer.x * canvasZoom,
          top: layer.y * canvasZoom,
          width: layer.metadata.width * layer.scale * canvasZoom,
          height: layer.metadata.height * layer.scale * canvasZoom,
          borderWidth: hideFrame ? 0 : (selected ? 4 : 2),
          borderColor: hideFrame ? 'transparent' : (selected ? borderColor : '#fff'),
          zIndex: layer.zIndex
        }
      ]}
    >
      {hasError ? (
        <View style={[styles.videoElement, { backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' }]}>
          <Text style={{ color: '#999', fontSize: 12, textAlign: 'center' }}>
            ⚠️{'\n'}Video Error{'\n'}
            <Text style={{ fontSize: 10 }}>{layer.metadata.filename}</Text>
          </Text>
        </View>
      ) : (
        <Video
          key={videoKey}
          ref={videoRef}
          source={{ uri: videoSource }}
          style={styles.videoElement}
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay
          isLooping
          isMuted
          onLoad={ensurePlayingCanvas}
          onPlaybackStatusUpdate={handleCanvasStatusUpdate}
          progressUpdateIntervalMillis={200}
          onReadyForDisplay={ensurePlayingCanvas}
          onError={handleVideoError}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    gap: 12
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '300',
    fontFamily: 'vrtlfinal'
  },
  headerToolbar: {
    flexDirection: 'row',
    gap: 12,
    flex: 1
  },
  toolbarButton: {
    width: 48,
    height: 48,
    backgroundColor: '#333',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#555'
  },
  saveToolbarButton: {
    backgroundColor: '#6b9fff'
  },
  exportToolbarButton: {
    backgroundColor: '#ff9f6b'
  },
  toolbarButtonRecording: {
    backgroundColor: '#FF3B30'
  },
  toolbarButtonText: {
    fontSize: 20,
    fontFamily: 'vrtlfinal'
  },
  bottomControls: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  lockButtonTopLeft: {
    position: 'absolute',
    top: 30,
    left: 20,
    padding: 8,
    zIndex: 100
  },
  lockButtonTextLarge: {
    fontSize: 48, // 3x bigger than original 16px
    fontFamily: 'vrtlfinal'
  },
  lockButtonTextActive: {
    color: '#ff9f6b' // Orange highlight when locked
  },
  layersButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#333',
    borderRadius: 8,
    marginRight: 8
  },
  layersButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  workspace: {
    flex: 1
  },
  layerFilmstrip: {
    borderTopWidth: 1,
    borderTopColor: '#111',
    backgroundColor: '#050505',
    paddingVertical: 10
  },
  layerFilmstripContent: {
    paddingHorizontal: 12,
    alignItems: 'center'
  },
  filmstripItem: {
    width: 110,
    alignItems: 'center',
    marginRight: 12
  },
  filmstripItemSelected: {
    borderColor: '#ff9f6b',
    borderWidth: 2,
    borderRadius: 14,
    padding: 6,
    backgroundColor: '#1a1a1a'
  },
  filmstripItemUnselected: {
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 14,
    padding: 6,
    backgroundColor: '#0f0f0f'
  },
  filmstripItemDragging: {
    opacity: 0.5,
    transform: [{ scale: 1.1 }],
    borderColor: '#ff9f6b',
    borderWidth: 3
  },
  filmstripThumbnail: {
    width: 90,
    height: 64,
    borderRadius: 10,
    marginBottom: 6
  },
  filmstripThumbnailPlaceholder: {
    width: 90,
    height: 64,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#030303',
    justifyContent: 'center',
    alignItems: 'center'
  },
  filmstripPlaceholderIcon: {
    fontSize: 22
  },
  filmstripLabel: {
    color: '#fff',
    fontSize: 10,
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  filmstripKeyframeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(255, 159, 107, 0.9)',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fff'
  },
  filmstripKeyframeBadgeText: {
    fontSize: 12
  },
  duplicateBubble: {
    position: 'absolute',
    top: -50,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000
  },
  duplicateButton: {
    backgroundColor: '#ff9f6b',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5
  },
  duplicateButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal'
  },
  duplicateBubbleArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ff9f6b',
    marginTop: -1
  },
  canvasContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center'
  },
  canvas: {
    backgroundColor: '#1a1a1a',
    position: 'relative'
  },
  canvasFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: '#444',
    borderStyle: 'dashed'
  },
  videoLayer: {
    position: 'absolute',
    overflow: 'hidden'
  },
  videoElement: {
    width: '100%',
    height: '100%'
  },
  layersButtonAboveSliders: {
    backgroundColor: '#000',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#fff'
  },
  layersButtonAboveSlidersText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  addVideoButtonBottomLeft: {
    width: 48,
    height: 48,
    backgroundColor: '#ff9f6b',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff'
  },
  addVideoButtonText: {
    color: '#000',
    fontSize: 24,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  // Zoom slider - top-right
  zoomSliderContainer: {
    position: 'absolute',
    top: 30,
    right: 20,
    width: screenWidth * 0.45, // Half-size width
    zIndex: 100
  },
  zoomSliderPanel: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#333'
  },
  topSlider: {
    width: '100%',
    height: 30
  },
  // Scale slider - bottom-right
  scaleSliderBottomRight: {
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: screenWidth * 0.35
  },
  sliderLabelBottom: {
    textAlign: 'center',
    color: '#888',
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'vrtlfinal',
    letterSpacing: 1,
    marginBottom: 4
  },
  bottomSlider: {
    width: screenWidth * 0.35,
    height: 30
  },
  sliderLabelRight: {
    textAlign: 'center',
    color: '#888',
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'vrtlfinal',
    letterSpacing: 1,
    marginBottom: 4
  },
  // Letter panel frames above sliders
  letterPanelZoom: {
    position: 'absolute',
    top: 90, // Position with the new top-positioned controls
    left: 16,
    width: (screenWidth - 48) / 2,
    height: 33, // Reduced to 50% of original 65
    zIndex: 9998,
    pointerEvents: 'none'
  },
  letterPanelScale: {
    position: 'absolute',
    top: 90, // Position with the new top-positioned controls
    left: screenWidth / 2 + 8,
    width: (screenWidth - 48) / 2,
    height: 33, // Reduced to 50% of original 65
    zIndex: 9998,
    pointerEvents: 'none'
  },
  letterPanelFrame: {
    width: '100%',
    height: '100%',
    borderWidth: 2,
    borderColor: 'rgba(255, 159, 107, 0.4)',
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)'
  },
  letterOverlay: {
    position: 'absolute',
    zIndex: 10000,
    pointerEvents: 'none'
  },
  letterText: {
    color: '#ff9f6b',
    fontSize: 8,  // 70% smaller: 28 * 0.3 ≈ 8
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 6
  },
  layerListOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end'
  },
  layerListPanel: {
    maxHeight: '60%',
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#333'
  },
  layerListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333'
  },
  layerListTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  addLayerButton: {
    width: 32,
    height: 32,
    backgroundColor: '#ff9f6b',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center'
  },
  addLayerButtonText: {
    color: '#000',
    fontSize: 20,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  closeLayerListButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeLayerListButtonText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '300',
    fontFamily: 'vrtlfinal'
  },
  layerListScroll: {
    maxHeight: 300
  },
  emptyLayersText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
    fontFamily: 'vrtlfinal'
  },
  layerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    backgroundColor: '#0a0a0a'
  },
  layerItemSelected: {
    backgroundColor: '#1a1a1a',
    borderLeftWidth: 3,
    borderLeftColor: '#ff9f6b'
  },
  layerThumbnailContainer: {
    width: 64,
    height: 64,
    marginRight: 12,
    borderRadius: 8,
    overflow: 'hidden'
  },
  layerThumbnail: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000'
  },
  layerThumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#030303',
    justifyContent: 'center',
    alignItems: 'center'
  },
  layerThumbnailIcon: {
    fontSize: 24
  },
  layerInfo: {
    flex: 1
  },
  layerName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  layerDetails: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'vrtlfinal'
  },
  layerActions: {
    flexDirection: 'row',
    gap: 8
  },
  layerActionButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center'
  },
  layerActionText: {
    fontSize: 16,
    fontFamily: 'vrtlfinal'
  },
  layerActionDisabled: {
    opacity: 0.3
  },
  exportOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999
  },
  exportText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
    fontFamily: 'vrtlfinal'
  },
  infoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  infoModalContent: {
    width: '100%',
    maxWidth: Platform.OS === 'ios' && (Platform as any)?.isPad && screenWidth > screenHeight ? 700 : 500, // Wider on iPad landscape
    maxHeight: '90%',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#ff9f6b',
    padding: 20
  },
  infoModalClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1
  },
  infoModalCloseText: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '300',
    fontFamily: 'vrtlfinal'
  },
  infoModalTitle: {
    color: '#ff9f6b',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  infoModalScroll: {
    flex: 1,
    paddingBottom: 20
  },
  infoSectionTitle: {
    color: '#ff9f6b',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
    fontFamily: 'vrtlfinal'
  },
  infoText: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
    fontFamily: 'vrtlfinal'
  },
  infoBold: {
    color: '#fff',
    fontWeight: '700'
  },
  projectsModal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000
  },
  projectsModalContent: {
    width: Platform.OS === 'ios' && (Platform as any)?.isPad && screenWidth > screenHeight ? '70%' : '90%', // Narrower on iPad landscape
    maxWidth: Platform.OS === 'ios' && (Platform as any)?.isPad && screenWidth > screenHeight ? 900 : undefined, // Cap width on iPad landscape
    maxHeight: '80%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden'
  },
  projectsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333'
  },
  projectsModalSaveButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'transparent',
    borderRadius: 8,
    minWidth: 44
  },
  projectsModalSaveButtonText: {
    fontSize: 28,
    textAlign: 'center'
  },
  projectsModalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    fontFamily: 'vrtlfinal',
    flex: 1,
    textAlign: 'center'
  },
  projectsModalClose: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '300',
    fontFamily: 'vrtlfinal'
  },
  imagePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 175, 80, 0.95)',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 10
  },
  imagePickerIcon: {
    fontSize: 24
  },
  imagePickerText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  projectsList: {
    maxHeight: 500
  },
  projectsEmptyText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    padding: 32,
    fontFamily: 'vrtlfinal'
  },
  projectItem: {
    flexDirection: 'row',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    alignItems: 'center',
    gap: 10
  },
  projectThumbnail: {
    width: 100,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333'
  },
  projectInfo: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8
  },
  projectName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
    fontFamily: 'vrtlfinal',
    numberOfLines: 2,
    flexWrap: 'wrap'
  },
  projectDetails: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'vrtlfinal'
  },
  projectActions: {
    flexDirection: 'column',
    gap: 6,
    alignItems: 'flex-end'
  },
  projectActionButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#6b9fff',
    borderRadius: 5,
    minWidth: 60,
    alignItems: 'center'
  },
  projectDeleteButton: {
    backgroundColor: '#ff6b6b'
  },
  projectActionText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'vrtlfinal',
    fontWeight: '500'
  },
  videoStorageButton: {
    marginTop: 16,
    marginHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#30d158',
    borderRadius: 12,
    alignItems: 'center'
  },
  videoStorageButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  videoPickerItem: {
    flexDirection: 'row',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    alignItems: 'center'
  },
  videoPickerThumbnail: {
    width: 80,
    height: 45,
    borderRadius: 6,
    marginRight: 12,
    backgroundColor: '#111'
  },
  videoPickerThumbnailPlaceholder: {
    width: 80,
    height: 45,
    borderRadius: 6,
    marginRight: 12,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center'
  },
  videoPickerIcon: {
    fontSize: 24
  },
  folderCountBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#ff9f6b',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '700',
    color: '#000'
  },
  backButton: {
    position: 'absolute',
    left: 16,
    padding: 8
  },
  backButtonText: {
    color: '#ff9f6b',
    fontSize: 16,
    fontWeight: '600'
  },
  videoPickerInfo: {
    flex: 1
  },
  videoPickerName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  videoPickerDetails: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'vrtlfinal'
  },
  // Save loader overlay
  saveLoaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000
  },
  saveLoaderContainer: {
    alignItems: 'center',
    padding: 32
  },
  saveLoaderText: {
    color: '#888',
    fontSize: 14,
    marginTop: 16,
    fontFamily: 'vrtlfinal',
    textAlign: 'center'
  },
  // Recording Preview Modal Styles
  recordingPreviewModal: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  recordingPreviewContent: {
    width: '90%',
    maxWidth: 800,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
    maxHeight: '90%'
  },
  recordingPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20
  },
  recordingPreviewTitle: {
    fontSize: 20,
    color: '#fff',
    fontFamily: 'vrtlfinal',
    fontWeight: 'bold'
  },
  recordingPreviewCloseButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center'
  },
  recordingPreviewCloseText: {
    fontSize: 36,
    color: '#fff',
    lineHeight: 40
  },
  recordingPreviewVideoContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 20
  },
  recordingPreviewVideo: {
    width: '100%',
    height: '100%'
  },
  recordingPreviewActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  recordingPreviewButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center'
  },
  recordingPreviewButtonPrimary: {
    backgroundColor: '#4a9eff'
  },
  recordingPreviewButtonSecondary: {
    backgroundColor: '#333'
  },
  recordingPreviewButtonText: {
    fontSize: 16,
    color: '#fff',
    fontFamily: 'vrtlfinal',
    fontWeight: 'bold'
  },
  // Position Overlay Modal styles
  positionOverlayModal: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  positionOverlayContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    width: screenWidth * 0.9,
    maxHeight: screenHeight * 0.8,
    borderWidth: 2,
    borderColor: '#444'
  },
  positionOverlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333'
  },
  positionOverlayTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    fontFamily: 'vrtlfinal'
  },
  positionOverlayCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center'
  },
  positionOverlayCloseText: {
    fontSize: 30,
    color: '#fff',
    fontWeight: 'bold'
  },
  positionOverlayScroll: {
    flex: 1,
    padding: 16
  },
  positionOverlayEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 30
  },
  positionOverlayEmptyIcon: {
    fontSize: 60,
    marginBottom: 16
  },
  positionOverlayEmptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#888',
    fontFamily: 'vrtlfinal',
    marginBottom: 12
  },
  positionOverlayEmptyHint: {
    fontSize: 14,
    color: '#666',
    fontFamily: 'vrtlfinal',
    textAlign: 'center',
    lineHeight: 20
  },
  positionOverlayLayer: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#444'
  },
  positionOverlayLayerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  positionOverlayLayerInfo: {
    flex: 1,
    marginRight: 12
  },
  positionOverlayLayerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    fontFamily: 'vrtlfinal',
    marginBottom: 4
  },
  positionOverlayLayerKeyframeCount: {
    fontSize: 12,
    color: '#888',
    fontFamily: 'vrtlfinal'
  },
  positionOverlayLayerActions: {
    flexDirection: 'row',
    gap: 8
  },
  positionOverlayReRecordButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8
  },
  positionOverlayReRecordText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal'
  },
  positionOverlayClearButton: {
    backgroundColor: '#f44336',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center'
  },
  positionOverlayClearText: {
    fontSize: 16
  },
  positionOverlayKeyframes: {
    gap: 8
  },
  positionOverlayKeyframe: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333'
  },
  positionOverlayKeyframeInfo: {
    flex: 1
  },
  positionOverlayKeyframeTime: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ff9f6b',
    fontFamily: 'vrtlfinal',
    marginBottom: 4
  },
  positionOverlayKeyframeDetails: {
    fontSize: 12,
    color: '#aaa',
    fontFamily: 'vrtlfinal'
  },
  positionOverlayKeyframeRemove: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12
  },
  positionOverlayKeyframeRemoveText: {
    fontSize: 20,
    color: '#f44336',
    fontWeight: 'bold'
  },
  positionOverlayFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
    backgroundColor: '#1a1a1a'
  },
  positionOverlayFooterText: {
    fontSize: 12,
    color: '#888',
    fontFamily: 'vrtlfinal',
    textAlign: 'center'
  },
  // Coming Soon Overlay styles
  comingSoonOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  comingSoonContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40
  },
  comingSoonText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
    fontFamily: 'vrtlfinal',
    marginBottom: 30,
    textAlign: 'center'
  },
  comingSoonLogoContainer: {
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center'
  },
  comingSoonLogo: {
    width: '100%',
    height: '100%'
  },
  // Welcome Message styles
  welcomeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  welcomeContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    maxWidth: screenWidth * 0.85,
    borderWidth: 2,
    borderColor: '#ff9f6b'
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    fontFamily: 'vrtlfinal',
    marginBottom: 8,
    textAlign: 'center'
  },
  welcomeSubtitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ff9f6b',
    fontFamily: 'vrtlfinal',
    marginBottom: 20,
    textAlign: 'center'
  },
  welcomeMessage: {
    fontSize: 16,
    color: '#ccc',
    fontFamily: 'vrtlfinal',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 20
  },
  welcomeLogoContainer: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 16
  },
  welcomeLogo: {
    width: '100%',
    height: '100%'
  },
  welcomeVersion: {
    fontSize: 11,
    color: '#666',
    fontFamily: 'vrtlfinal',
    marginTop: 16,
    marginBottom: 12
  },
  welcomeDismissHint: {
    fontSize: 12,
    color: '#888',
    fontFamily: 'vrtlfinal',
    fontStyle: 'italic'
  }
});
