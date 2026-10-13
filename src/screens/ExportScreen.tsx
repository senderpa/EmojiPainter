// @ts-nocheck - Legacy code with complex types
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, Modal, Image, TextInput, Animated, Easing, Platform, ActivityIndicator } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { Video } from 'expo-av';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePainting } from '../state/PaintingContext';
import { createProjectPayload, deleteProject, listProjects, loadProject, saveProject } from '../lib/storage';
import * as Haptics from 'expo-haptics';
import type { RootStackParamList } from '../App';
import { generateProjectPreview } from '../native/timelapse';
import { getAllVideos, getProjectLatestVideo } from '../video/videoStorage';
import { saveCustomBrush } from '../lib/customBrushes';
import type { CustomBrush } from '../lib/customBrushes';
import { CustomOverlay, CustomOverlayHelper } from '../components/CustomOverlay';
import { useHelperMode } from '../tutorial/useHelperMode';
import HelperLabel, { HelperRing } from '../tutorial/HelperLabel';
import ButtonGlow from '../tutorial/ButtonGlow';
import RoomViewerModal from '../ar/RoomViewerModal';

const DEFAULT_SNAPSHOT_PROJECT_ID = 'active-session';

const sanitizeProjectName = (value: string): string => value.replace(/[\/:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim();
const formatProjectTimestampName = (date: Date = new Date()): string => {
  const isoDate = date.toISOString().slice(0, 10);
  const timeParts = date
    .toTimeString()
    .slice(0, 8)
    .split(':')
    .join('-');
  return `Project ${isoDate} ${timeParts}`;
};

const PROJECT_PREVIEW_SIZE = 96;

interface StoredProject {
  name: string;
  updatedAt: string;
  preview: string | null;
  miniPreviewVideoUri?: string | null;
  strokeCount: number;
  hasTrace: boolean;
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  isAnimation?: boolean;
  frameCount?: number;
  fps?: number;
  kind?: 'painting' | 'ar_scene' | 'facemask' | 'vector';
  arSceneDir?: string;
}

interface ProjectCardProps {
  item: StoredProject;
  onLoad: (name: string) => void;
  onDuplicate: (item: StoredProject) => void;
  onDelete: (name: string) => void;
  onShare: (name: string) => void;
  onOpenViewer: (item: StoredProject) => void;
  activeProjectName: string | null;
}

const PROJECT_CARD_KEYS = ['load_project', 'duplicate_project', 'share_project', 'delete_project'];

const ProjectCard: React.FC<ProjectCardProps> = memo(({ item, onLoad, onDuplicate, onDelete, onShare, onOpenViewer, activeProjectName }) => {
  const loadBounce = useRef(new Animated.Value(0)).current;
  const [videoReady, setVideoReady] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const isActive = activeProjectName != null && item.name === activeProjectName;
  const { activeHelperKey, glowCounters, triggerHelper, tutorialModeEnabled } = useHelperMode({ keys: PROJECT_CARD_KEYS });

  useEffect(() => {
      let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const runBounce = () => {
      if (cancelled) {
        return;
      }
      Animated.sequence([
        Animated.timing(loadBounce, {
          toValue: 1,
          duration: 140,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(loadBounce, {
          toValue: 0,
          duration: 220,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        })
      ]).start(({ finished }) => {
        if (finished && !cancelled) {
          const delay = 1600 + Math.random() * 4200;
          timeout = setTimeout(runBounce, delay);
        }
      });
    };

    timeout = setTimeout(runBounce, 600 + Math.random() * 1800);
    return () => {
      cancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      loadBounce.stopAnimation();
      loadBounce.setValue(0);
    };
  }, [loadBounce]);

  const updatedLabel = item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'n/a';
  // If storage key includes a session prefix, surface a short session indicator in subtitle
  const sessionSuffix = (() => {
    // item.name is the logical project name; try to derive session id from preview or keep blank
    return '';
  })();
  const brushLabel = item.brushEmoji ? `${item.brushEmoji} · size ${item.brushSize}` : 'Brush data unavailable';

  return (
    <View style={[styles.card, isActive && styles.cardActive]}>
      <View style={styles.cardPreview}>
        {/* DYNAMIC PREVIEW: Show image first, then video when ready */}
        {item.miniPreviewVideoUri && videoReady ? (
          // Video is ready and loaded - show it
          <Video
            source={{ uri: item.miniPreviewVideoUri }}
            style={styles.cardPreviewImage}
            resizeMode="contain"
            isLooping
            shouldPlay
            useNativeControls={false}
            onLoad={() => setVideoReady(true)}
            onError={() => {
              console.warn('[ProjectCard] ⚠️ Video load failed, falling back to image');
              setVideoReady(false);
            }}
          />
        ) : item.preview ? (
          // Show image (either as fallback from video load, or permanently if no video)
          <Image
            source={{ uri: item.preview }}
            style={styles.cardPreviewImage}
            resizeMode="contain"
            onLoad={() => setImageLoaded(true)}
            onError={() => console.warn('[ProjectCard] ⚠️ Image load failed')}
          />
        ) : (
          <View style={styles.cardPreviewFallback}>
            <Text style={styles.cardPreviewFallbackText}>No preview</Text>
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, isActive && styles.cardTitleActive]} numberOfLines={1}>
            {item.kind === 'vector' ? '🔷 ' : item.isAnimation ? '📽️ ' : ''}{item.name}
          </Text>
          {isActive ? (
            <View style={styles.cardActiveFlag}>
              <Text style={styles.cardActiveFlagText}>Already loaded!</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardMeta}>{updatedLabel}{sessionSuffix ? ` · ${sessionSuffix}` : ''}</Text>
        <Text style={styles.cardStats}>
          {item.kind === 'vector'
            ? `🔷 Vector · ✏️ ${item.strokeCount} strokes`
            : item.frameCount > 0 && item.strokeCount > 0
            ? `✏️ ${item.strokeCount} strokes · 🎬 ${item.frameCount} frames @ ${item.fps || 30} FPS`
            : item.frameCount > 0
            ? `🎬 ${item.frameCount} frames @ ${item.fps || 30} FPS · ${brushLabel}`
            : `✏️ ${item.strokeCount} strokes · ${brushLabel}`}
        </Text>
        <View style={styles.cardActions}>
          <Animated.View
            style={[
              styles.cardActionBouncyWrap,
              {
                transform: [
                  {
                    scale: loadBounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] })
                  }
                ]
              }
            ]}
          >
            <View style={{ position: 'relative' }}>
              <TouchableOpacity
                style={styles.cardActionButton}
                onPress={() => { triggerHelper('load_project'); onLoad(item.name); }}
                accessibilityLabel="Load project"
              >
                <Text style={styles.cardActionEmoji}>📂</Text>
              </TouchableOpacity>
              <ButtonGlow counter={glowCounters.load_project ?? 0} enabled={tutorialModeEnabled} />
              <HelperRing visible={activeHelperKey === 'load_project'} />
              <HelperLabel text="Load" visible={activeHelperKey === 'load_project'} position="above" />
            </View>
          </Animated.View>
          {item.kind === 'ar_scene' && item.arSceneDir && (
            <TouchableOpacity style={[styles.cardActionButton, styles.cardActionRoom]} onPress={() => onOpenViewer(item)} accessibilityLabel="Open room 3D viewer">
              <Text style={styles.cardActionEmoji}>🧊</Text>
            </TouchableOpacity>
          )}
          <View style={{ position: 'relative' }}>
            <TouchableOpacity
              style={styles.cardActionButton}
              onPress={() => { triggerHelper('duplicate_project'); onDuplicate(item); }}
              accessibilityLabel="Duplicate project"
            >
              <Text style={styles.cardActionEmoji}>🧬</Text>
            </TouchableOpacity>
            <ButtonGlow counter={glowCounters.duplicate_project ?? 0} enabled={tutorialModeEnabled} />
            <HelperRing visible={activeHelperKey === 'duplicate_project'} />
            <HelperLabel text="Duplicate" visible={activeHelperKey === 'duplicate_project'} position="above" />
          </View>
          <View style={{ position: 'relative' }}>
            <TouchableOpacity
              style={styles.cardActionButton}
              onPress={() => { triggerHelper('share_project'); onShare(item.name); }}
              accessibilityLabel="Share project"
            >
              <Text style={styles.cardActionEmoji}>📤</Text>
            </TouchableOpacity>
            <ButtonGlow counter={glowCounters.share_project ?? 0} enabled={tutorialModeEnabled} />
            <HelperRing visible={activeHelperKey === 'share_project'} />
            <HelperLabel text="Share" visible={activeHelperKey === 'share_project'} position="above" />
          </View>
          <View style={{ position: 'relative' }}>
            <TouchableOpacity
              style={[styles.cardActionButton, styles.cardActionDanger]}
              onPress={() => { triggerHelper('delete_project'); onDelete(item.name); }}
              accessibilityLabel="Delete project"
            >
              <Text style={styles.cardActionEmoji}>🗑️</Text>
            </TouchableOpacity>
            <ButtonGlow counter={glowCounters.delete_project ?? 0} enabled={tutorialModeEnabled} />
            <HelperRing visible={activeHelperKey === 'delete_project'} />
            <HelperLabel text="Delete" visible={activeHelperKey === 'delete_project'} position="above" />
          </View>
        </View>
      </View>
    </View>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to avoid re-renders when props haven't changed
  return (
    prevProps.item === nextProps.item &&
    prevProps.activeProjectName === nextProps.activeProjectName
  );
});

ProjectCard.displayName = 'ProjectCard';

const EXPORT_SCREEN_KEYS = ['close', 'save_project', 'video_storage'];

const ExportScreen: React.FC = () => {
  const { strokes, trace, brushEmoji, brushSize, brushOpacity, brushSpacing, brushRotation, mirrorX, mirrorY, recentEmojis, dispatch } = usePainting();
  const { activeHelperKey: screenHelperKey, glowCounters: screenGlowCounters, triggerHelper: screenTriggerHelper, tutorialModeEnabled: screenTutorialMode } = useHelperMode({ keys: EXPORT_SCREEN_KEYS });

  // Generate project preview using Metal stroke replay (full canvas, not cropped)
  const capturePreview = useCallback(async () => {
    try {
      // Pass canvas size when known; our canvas is square with ratio 1
      // If your app later uses non-1 ratios, update accordingly
      return await generateProjectPreview(strokes, 256);
    } catch (error) {
      console.error('Preview generation failed:', error);
      return null;
    }
  }, [strokes]);

  // Track current session/project name
  const [snapshotProjectId, setSnapshotProjectIdState] = useState<string>(DEFAULT_SNAPSHOT_PROJECT_ID);

  // On fresh app runs, always start as Unsaved session; do not auto-target last project
  useEffect(() => {
    // Intentionally clear any persisted active project name to avoid cross-run overwrite.
    (async () => {
      try {
        await AsyncStorage.removeItem('current_session_name');
      } catch {}
      setSnapshotProjectIdState(DEFAULT_SNAPSHOT_PROJECT_ID);
    })();
  }, []);

  // Save session name when it changes
  const setSnapshotProjectId = useCallback(async (projectId: string) => {
    setSnapshotProjectIdState(projectId);
    try {
      await AsyncStorage.setItem('current_session_name', projectId);
    } catch (error) {
      console.error('Failed to save session name:', error);
    }
  }, []);

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const isScreenActiveRef = useRef(false);
  const flatListRef = useRef<FlatList>(null);
  const [autoOpenProjectName, setAutoOpenProjectName] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const [saveDialogVisible, setSaveDialogVisible] = useState(false);
  const [saveDialogStep, setSaveDialogStep] = useState<'choice' | 'input' | 'video-preview'>('choice');
  const [pendingSaveName, setPendingSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const paletteScale = useRef(new Animated.Value(1)).current;
  const leavingRef = useRef(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [hasVideos, setHasVideos] = useState(false);
  const [saveButtonEmoji, setSaveButtonEmoji] = useState('💿');
  const [isSavePressed, setIsSavePressed] = useState(false);
  const [isButtonGreenFlash, setIsButtonGreenFlash] = useState(false);
  const [videoStorageEmoji, setVideoStorageEmoji] = useState('🎥');
  const exitAnimation = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const [roomViewerDir, setRoomViewerDir] = useState<string | null>(null);

  // Frame detection and video preview state
  const [detectedFrameCount, setDetectedFrameCount] = useState(0);
  const [shouldGenerateVideoPreview, setShouldGenerateVideoPreview] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);

  // Save button animation
  const saveButtonScaleAnim = useRef(new Animated.Value(1)).current;

  // Delete confirmation state
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deleteProjectName, setDeleteProjectName] = useState<string | null>(null);
  const [deleteSliderValue, setDeleteSliderValue] = useState(0);


  const refreshProjects = useCallback(async () => {
      if (!isScreenActiveRef.current) {
      return;
    }
    setProjectsLoading(true);
    try {
      const names = await listProjects();
      if (!isScreenActiveRef.current) {
        return;
      }
      const items: StoredProject[] = [];
      for (const name of names) {
        if (!isScreenActiveRef.current) {
          return;
        }
        const payload = await loadProject(name);
        if (!isScreenActiveRef.current) {
          return;
        }
        if (!payload) {
          items.push({
            name,
            updatedAt: '',
            preview: null,
            strokeCount: 0,
            hasTrace: false,
            brushEmoji: '',
            brushSize: 0,
            brushOpacity: 0,
            brushSpacing: 0,
            isAnimation: false,
            frameCount: 0,
            fps: 0
          });
          continue;
        }
        // Fetch linked video preview if available (from Framer, Timelapse exports, or save animation)
        let linkedVideoUri: string | null | undefined = payload.framerFrames?.miniPreviewVideoUri ?? null;
        let fallbackPreviewUri: string | null = null;

        // Try to load mini preview video saved during save animation
        if (!linkedVideoUri) {
          try {
            const savedMiniPreview = await AsyncStorage.getItem(`@project_mini_preview_${name}`);
            if (savedMiniPreview) {
              linkedVideoUri = savedMiniPreview;
              console.log('[ExportScreen] ✅ Found mini preview video for project:', name);
            }
          } catch (miniPreviewError) {
            console.warn('[ExportScreen] Could not load mini preview:', miniPreviewError);
          }
        }

        // Try to load frame snapshot as fallback preview
        if (!fallbackPreviewUri) {
          try {
            const savedFrameSnapshot = await AsyncStorage.getItem(`@project_frame_snapshot_${name}`);
            if (savedFrameSnapshot) {
              fallbackPreviewUri = savedFrameSnapshot;
              console.log('[ExportScreen] ✅ Found frame snapshot for project:', name);
            }
          } catch (snapshotError) {
            console.warn('[ExportScreen] Could not load frame snapshot:', snapshotError);
          }
        }

        // If still no video, try linked video from storage
        if (!linkedVideoUri) {
          try {
            const linkedVideo = await getProjectLatestVideo(name);
            if (linkedVideo?.previewUri) {
              linkedVideoUri = linkedVideo.previewUri;
              console.log('[ExportScreen] Found linked video preview for project:', name);
            }
          } catch (videoError) {
            console.warn('[ExportScreen] Failed to fetch linked video for project:', name, videoError);
          }
        }

        items.push({
          name,
          updatedAt: payload.updatedAt ?? '',
          preview: fallbackPreviewUri ?? payload.preview ?? null, // Use fallback snapshot if available, else use original preview
          miniPreviewVideoUri: linkedVideoUri ?? null, // Use mini preview video if available
          strokeCount: payload.metadata?.kind === 'ar_scene'
            ? Number(payload.metadata.strokeCount ?? 0)
            : payload.metadata?.kind === 'vector'
            ? Number(payload.metadata.vectorStrokeCount ?? payload.metadata.vectorDocument?.strokes?.length ?? 0)
            : payload.strokes?.length ?? 0,
          hasTrace: Boolean(payload.trace?.imageUri),
          brushEmoji: payload.brushEmoji ?? '',
          brushSize: payload.brushSize ?? 0,
          brushOpacity: payload.brushOpacity ?? 0,
          brushSpacing: payload.brushSpacing ?? 0,
          isAnimation: payload.isAnimation ?? false,
          frameCount: payload.framerFrames?.frames?.length ?? payload.frames?.length ?? 0,
          fps: payload.framerFrames?.fps ?? payload.fps ?? 0,
          kind: payload.metadata?.kind ?? 'painting',
          arSceneDir: payload.metadata?.arSceneDir,
        });
      }
      if (!isScreenActiveRef.current) {
        return;
      }
      items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      setProjects(items);
    } catch (error) {
      console.warn('projects: refresh failed', error);
      if (isScreenActiveRef.current) {
        setProjects([]);
      }
    } finally {
      if (isScreenActiveRef.current) {
        setProjectsLoading(false);
      }
    }
  }, [listProjects, loadProject]);

  useFocusEffect(
    useCallback(() => {
      isScreenActiveRef.current = true;
      void (async () => {
        // On fresh entry, if a previous active project name exists, roll it into Old session N
        try {
          const prev = await AsyncStorage.getItem('current_session_name');
          if (prev && prev !== DEFAULT_SNAPSHOT_PROJECT_ID) {
            // Find next available Old session N name
            const keys = await listProjects();
            let n = 1;
            let candidate = `Old session ${n}`;
            const existing = new Set(keys);
            while (existing.has(candidate)) {
              n += 1;
              candidate = `Old session ${n}`;
            }
            const payload = await loadProject(prev);
            if (payload) {
              await saveProject(candidate, payload);
              await deleteProject(prev);
            }
            await AsyncStorage.removeItem('current_session_name');
            setSnapshotProjectIdState(DEFAULT_SNAPSHOT_PROJECT_ID);
          }
        } catch (e) {
          console.warn('projects: session rollover failed', e);
        }
        await refreshProjects();
        // Auto-regenerate previews for items missing a preview only
        try {
          const names = await listProjects();
          for (const name of names) {
            if (!isScreenActiveRef.current) break;
            const payload = await loadProject(name);
            if (!payload) continue;

            // CRITICAL: Skip preview generation if we have a video
            // User explicitly requested: "check if there is a video and if not then ok"
            let hasVideo = false;
            try {
              const linkedVideo = await getProjectLatestVideo(name);
              hasVideo = !!linkedVideo?.previewUri || !!payload.framerFrames?.miniPreviewVideoUri;
              if (hasVideo) {
                console.log('[ExportScreen] ✅ Project has video preview, skipping image generation:', name);
              }
            } catch (videoCheckError) {
              // Silently fail - proceed with image generation
              console.warn('[ExportScreen] ⚠️ Could not check for video:', name);
            }

            // Only generate image preview if NO video exists AND NO image preview exists
            if (!payload.preview && !hasVideo && payload.strokes) {
              console.log('[ExportScreen] 🖼️ Generating missing preview for project:', name);
              const fresh = await generateProjectPreview(payload.strokes, 256);
              if (fresh) {
                const updated = createProjectPayload({
                  strokes: payload.strokes,
                  trace: payload.trace,
                  brushEmoji: payload.brushEmoji,
                  brushSize: payload.brushSize,
                  brushOpacity: payload.brushOpacity,
                  brushSpacing: payload.brushSpacing ?? 0.3,
                  brushRotation: payload.brushRotation ?? 0,
                  mirrorX: payload.mirrorX ?? false,
                  mirrorY: payload.mirrorY ?? false,
                  recentEmojis: payload.recentEmojis,
                  preview: fresh,
                  createdAt: payload.createdAt
                });
                await saveProject(name, updated);
              }
            }
          }
          if (isScreenActiveRef.current) {
            await refreshProjects();
          }
        } catch (e) {
          console.warn('projects: auto preview regen failed', e);
        }
      })();
      return () => {
        isScreenActiveRef.current = false;
        setProjects([]);
        setProjectsLoading(true);
      };
    }, [refreshProjects])
  );

  // Check for saved videos on screen focus
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const videos = await getAllVideos();
          setHasVideos(videos.length > 0);
        } catch (error) {
          console.error('[ExportScreen] Failed to check videos:', error);
          setHasVideos(false);
        }
      })();
    }, [])
  );

  // Listen for @open_export_screen_project flag to auto-open & highlight a newly saved project
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const projectName = await AsyncStorage.getItem('@open_export_screen_project');
          if (projectName) {
            setAutoOpenProjectName(projectName);
            await AsyncStorage.removeItem('@open_export_screen_project');

            // Scroll to the project after a short delay to ensure projects list is rendered
            setTimeout(() => {
              if (flatListRef.current && projects.length > 0) {
                const index = projects.findIndex(p => p.name === projectName);
                if (index >= 0) {
                  flatListRef.current.scrollToIndex({ index, animated: true });
                  console.log('[ExportScreen] ✅ Scrolled to newly saved project:', projectName);
                } else {
                  console.warn('[ExportScreen] ⚠️ Could not find project in list:', projectName);
                }
              }
            }, 500);
          }
        } catch (error) {
          console.warn('[ExportScreen] Failed to check auto-open project flag:', error);
        }
      })();
    }, [projects])
  );

  // Auto-clear autoOpenProjectName after 5 seconds (highlight timeout)
  useEffect(() => {
    if (autoOpenProjectName) {
      const timer = setTimeout(() => {
        setAutoOpenProjectName(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [autoOpenProjectName]);

  // Animate save button emoji cycling (FAST!)
  useEffect(() => {
    if (isSavePressed) return;
    const emojis = ['💿', '📀', '💽', '💾'];
    let index = emojis.indexOf(saveButtonEmoji);
    if (index === -1) index = 0;
    const timer = setInterval(() => {
      index = (index + 1) % emojis.length;
      setSaveButtonEmoji(emojis[index]);
    }, 500); // Fast! 500ms
    return () => clearInterval(timer);
  }, [saveButtonEmoji, isSavePressed]);

  // Animate video storage button emoji cycling
  useEffect(() => {
    const emojis = ['🎥', '📽️', '📹'];
    let index = emojis.indexOf(videoStorageEmoji);
    if (index === -1) index = 0;
    const timer = setInterval(() => {
      index = (index + 1) % emojis.length;
      setVideoStorageEmoji(emojis[index]);
    }, 1000);
    return () => clearInterval(timer);
  }, [videoStorageEmoji]);

  // Save button scale animation: subtle bounce
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(saveButtonScaleAnim, {
          toValue: 1.05,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        }),
        Animated.timing(saveButtonScaleAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        })
      ])
    ).start();
  }, [saveButtonScaleAnim]);

  // Helper function to detect Framer frames
  const detectFrames = useCallback(async (): Promise<{ count: number; data: any | null }> => {
    try {
      const animationData = await AsyncStorage.getItem('@current_animation_frames');
      if (animationData) {
        const parsed = JSON.parse(animationData);
        const frameCount = parsed.frames?.length ?? 0;
        console.log('[ExportScreen] Frame detection result:', frameCount, 'frames found');
        return { count: frameCount, data: parsed };
      }
      return { count: 0, data: null };
    } catch (error) {
      console.error('[ExportScreen] Frame detection error:', error);
      return { count: 0, data: null };
    }
  }, []);

  const regenerateAllPreviews = useCallback(async () => {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      const names = await listProjects();
      for (const name of names) {
        const payload = await loadProject(name);
        if (!payload || !payload.strokes) continue;
        const fresh = await generateProjectPreview(payload.strokes, 256);
        const updated = createProjectPayload({
          strokes: payload.strokes,
          trace: payload.trace,
          brushEmoji: payload.brushEmoji,
          brushSize: payload.brushSize,
          brushOpacity: payload.brushOpacity,
          brushSpacing: payload.brushSpacing ?? 0.3,
          brushRotation: payload.brushRotation ?? 0,
          mirrorX: payload.mirrorX ?? false,
          mirrorY: payload.mirrorY ?? false,
          recentEmojis: payload.recentEmojis,
          preview: fresh,
          createdAt: payload.createdAt
        });
        await saveProject(name, updated);
      }
      await refreshProjects();
      CustomOverlayHelper.alert('Previews updated', 'All project thumbnails were regenerated.');
    } catch (e) {
      console.error('Preview regeneration failed', e);
      CustomOverlayHelper.alert('Failed', 'Could not regenerate previews.');
    } finally {
      setRegenBusy(false);
    }
  }, [regenBusy, listProjects, loadProject, refreshProjects]);


  const performProjectSave = useCallback(async (requestedName: string | null, isUpdate: boolean) => {
    try {
      setSaving(true);
      setSaveError(null);
      setProgressMessage('Preparing project...');

      // Determine final name
      let finalName: string;
      if (requestedName) {
        // User provided a name (from "save as") - use it
        const sanitized = sanitizeProjectName(requestedName);
        finalName = sanitized.length > 0 ? sanitized : formatProjectTimestampName();
      } else if (isUpdate) {
        // "Save session" behavior:
        // - If snapshotProjectId is DEFAULT: Create new timestamped project (new session)
        // - If snapshotProjectId is a real project: Update that project (same session)
        if (snapshotProjectId === DEFAULT_SNAPSHOT_PROJECT_ID) {
          finalName = formatProjectTimestampName();
        } else {
          finalName = snapshotProjectId;
        }
      } else {
        // Fallback - create timestamped project
        finalName = formatProjectTimestampName();
      }

      // Generate preview with ALL strokes (not cropped)
      let preview: string | null = null;
      try {
        setProgressMessage('Generating preview...');
        preview = await capturePreview();
        console.log('[ExportScreen] Generated preview for project:', finalName, 'preview length:', preview?.length);
      } catch (error) {
        console.warn('Project preview capture failed', error);
      }

      // Check if there are animation frames to save - try multiple sources
      let framerFramesData: any | null = null;
      let animationFrames: any[] | null = null;
      let animationFps: number | null = null;
      let isAnimation = false;

      try {
        // TRY 1: Get from Framer persistent data (most recent/complete)
        const framerPersistent = await AsyncStorage.getItem('@framer_persistent_data');
        if (framerPersistent) {
          try {
            framerFramesData = JSON.parse(framerPersistent);
            animationFrames = framerFramesData.frames;
            animationFps = framerFramesData.fps;
            isAnimation = true;
            console.log('[ExportScreen] 📹 Found Framer data with', animationFrames?.length, 'frames');
          } catch (e) {
            console.warn('[ExportScreen] Failed to parse Framer persistent data:', e);
          }
        }

        // TRY 2: Fallback to legacy @current_animation_frames
        if (!framerFramesData) {
          const animationData = await AsyncStorage.getItem('@current_animation_frames');
          if (animationData) {
            const parsed = JSON.parse(animationData);
            animationFrames = parsed.frames;
            animationFps = parsed.fps;
            isAnimation = parsed.isAnimation;
            console.log('[ExportScreen] ⚠️ Using legacy animation frames with', animationFrames?.length, 'frames');
          }
        }

        if (animationFrames && animationFrames.length > 0) {
          console.log('[ExportScreen] ✅ Including', animationFrames.length, 'animation frames in save');

          // Generate video preview if user requested it and we have frames
          if (shouldGenerateVideoPreview && animationFrames.length > 0) {
            try {
              setProgressMessage(`Generating video preview (${animationFrames.length} frames)...`);
              setIsGeneratingVideo(true);

              console.log('[ExportScreen] Video preview generation requested for', animationFrames.length, 'frames');
              console.log('[ExportScreen] Note: Video generation requires frame image files. Will be implemented in next phase.');

            } catch (error) {
              console.warn('[ExportScreen] Video preview generation failed (non-fatal):', error);
              // Don't fail the save if video generation fails
            } finally {
              setIsGeneratingVideo(false);
            }
          }
        }
      } catch (error) {
        console.error('[ExportScreen] Failed to read animation frames:', error);
      }

      setProgressMessage('Saving project...');

      // ✅ CRITICAL FIX: Filter out the 4 invisible border strokes before saving
      // Border strokes have IDs like 'border_top_*', 'border_right_*', etc. with opacity: 0
      // We only want to save the real user-drawn strokes
      const realStrokes = strokes.filter(stroke =>
        !stroke.id.startsWith('border_')
      );

      console.log('[ExportScreen] 🎨 Filtered strokes:', {
        before: strokes.length,
        after: realStrokes.length,
        borderStrokesRemoved: strokes.length - realStrokes.length
      });

      const payload = createProjectPayload({
        strokes: realStrokes,
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
        frames: animationFrames ?? undefined,
        fps: animationFps ?? undefined,
        isAnimation,
        framerFrames: framerFramesData ?? undefined  // ✅ CRITICAL: Include complete Framer state
      });

      console.log('[ExportScreen] 💾 Saving project with:', {
        name: finalName,
        hasStrokes: realStrokes.length > 0,
        strokeCount: realStrokes.length,
        hasFrames: !!animationFrames?.length,
        frameCount: animationFrames?.length ?? 0,
        hasFramerData: !!framerFramesData
      });

      await saveProject(finalName, payload);
      // After Save As (requestedName provided), future Save Session should overwrite that name
      await setSnapshotProjectId(finalName);

      setProgressMessage('Refreshing projects...');
      await refreshProjects();

      setSaveDialogVisible(false);
      setPendingSaveName('');
      setSaveDialogStep('choice');
      setProgressMessage('');

      CustomOverlayHelper.alert('Saved', isUpdate ? `Session "${finalName}" updated.` : `Project saved as "${finalName}"`);
    } catch (error) {
      console.error('Save failed', error);
      setSaveError('Could not save project.');
      setProgressMessage('');
    } finally {
      setSaving(false);
      setIsGeneratingVideo(false);
    }
  }, [brushEmoji, brushOpacity, brushRotation, brushSize, brushSpacing, capturePreview, mirrorX, mirrorY, recentEmojis, refreshProjects, setSnapshotProjectId, snapshotProjectId, strokes, trace, shouldGenerateVideoPreview]);

  const openSaveDialog = useCallback(async () => {
    // Flash button green for a brief moment
    setIsButtonGreenFlash(true);
    setTimeout(() => {
      setIsButtonGreenFlash(false);
    }, 100);

    // Show disco ball on press
    setIsSavePressed(true);
    setSaveButtonEmoji('🪩');

    setPendingSaveName('');
    setSaveError(null);

    // Detect frames on dialog open
    console.log('[ExportScreen] Opening save dialog - detecting frames...');
    const { count: frameCount } = await detectFrames();
    setDetectedFrameCount(frameCount);
    console.log('[ExportScreen] Save dialog opened with', frameCount, 'frames detected');

    setSaveDialogStep('choice');
    setSaveDialogVisible(true);

    // Show success emoji briefly, then return to animation
    setTimeout(() => {
      setSaveButtonEmoji('💾');
      setTimeout(() => {
        setIsSavePressed(false);
        setSaveButtonEmoji('💿');
      }, 300);
    }, 150);
  }, [detectFrames]);

  const cancelSaveDialog = useCallback(() => {
      if (isSaving) {
      return;
    }
    setSaveDialogVisible(false);
    setSaveDialogStep('choice');
    setSaveError(null);
    setPendingSaveName('');
  }, [isSaving]);

  const handleSaveSession = useCallback(() => {
    if (isSaving) {
      return;
    }
    // If frames detected, ask about video preview before saving
    if (detectedFrameCount > 0) {
      console.log('[ExportScreen] Showing video preview prompt for', detectedFrameCount, 'frames');
      setShouldGenerateVideoPreview(false);
      setSaveDialogStep('video-preview');
    } else {
      // No frames - proceed directly with save
      void performProjectSave(null, true);
    }
  }, [isSaving, performProjectSave, detectedFrameCount]);

  const handleSaveAsNew = useCallback(() => {
      if (isSaving) {
      return;
    }
    // If frames detected, ask about video preview after naming
    if (detectedFrameCount > 0) {
      // We'll ask about video after they enter the name
      setShouldGenerateVideoPreview(false);
    }
    setPendingSaveName('');
    setSaveError(null);
    setSaveDialogStep('input');
  }, [isSaving, detectedFrameCount]);

  const handleSaveAll = useCallback(() => {
    if (isSaving) {
      return;
    }
    // Save All: create timestamped project that includes both workspace and Framer frames
    console.log('[ExportScreen] Save All - saving workspace strokes + Framer frames');
    setShouldGenerateVideoPreview(true); // Auto-generate video preview when saving all
    void performProjectSave(null, true); // Save as session update with video preview
  }, [isSaving, performProjectSave]);

  const submitSaveAsNew = useCallback(() => {
      if (isSaving) {
      return;
    }
    // If frames detected, ask about video preview before final save
    if (detectedFrameCount > 0) {
      console.log('[ExportScreen] Save as new - showing video preview prompt');
      setShouldGenerateVideoPreview(false);
      setSaveDialogStep('video-preview');
    } else {
      // No frames - proceed directly with save
      void performProjectSave(pendingSaveName, false);
    }
  }, [isSaving, pendingSaveName, performProjectSave, detectedFrameCount]);


  const handleConfirmVideoPreview = useCallback(() => {
    if (isSaving) return;
    console.log('[ExportScreen] User confirmed video preview generation');
    setShouldGenerateVideoPreview(true);
    // Proceed with save - the performProjectSave will handle video generation
    void performProjectSave(pendingSaveName, saveDialogStep === 'video-preview' && snapshotProjectId === DEFAULT_SNAPSHOT_PROJECT_ID ? false : true);
  }, [isSaving, performProjectSave, pendingSaveName, saveDialogStep, snapshotProjectId]);

  const handleSkipVideoPreview = useCallback(() => {
    if (isSaving) return;
    console.log('[ExportScreen] User skipped video preview generation');
    setShouldGenerateVideoPreview(false);
    // Proceed with save without video
    void performProjectSave(pendingSaveName, saveDialogStep === 'video-preview' && snapshotProjectId === DEFAULT_SNAPSHOT_PROJECT_ID ? false : true);
  }, [isSaving, performProjectSave, pendingSaveName, saveDialogStep, snapshotProjectId]);

  const handlePalettePress = useCallback(() => {
      if (leavingRef.current) {
      return;
    }
    leavingRef.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Navigate immediately so Paint screen loads behind
    navigation.navigate('Paint');

    // Cloth falling and crumbling effect
    const fallDuration = 600; // Cloth falls for 600ms
    const crumbleDuration = 300; // Then crumbles fast

    // Slow fall, then fast crumble at the end
    Animated.sequence([
      // Slow cloth-like fall
      Animated.parallel([
        Animated.timing(exitAnimation, {
          toValue: 0.7,
          duration: fallDuration,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(exitOpacity, {
          toValue: 0.8,
          duration: fallDuration,
          easing: Easing.linear,
          useNativeDriver: true
        })
      ]),
      // Fast crumble at the end
      Animated.parallel([
        Animated.timing(exitAnimation, {
          toValue: 1,
          duration: crumbleDuration,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true
        }),
        Animated.timing(exitOpacity, {
          toValue: 0,
          duration: crumbleDuration,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true
        })
      ])
    ]).start();
  }, [navigation, exitAnimation, exitOpacity]);

  const handleVideoStoragePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('VideoStorage');
  }, [navigation]);

  const performLoadProject = useCallback(async (name: string) => {
      try {
      console.log('[ExportScreen] 📂 Starting load of project:', name);
      const payload = await loadProject(name);
      if (!payload) {
        console.error('[ExportScreen] ❌ Payload is null/undefined for project:', name);
        CustomOverlayHelper.alert('Load failed', 'Could not load project data.');
        return;
      }
      console.log('[ExportScreen] ✅ Loaded payload with keys:', Object.keys(payload));

      // ── AR / Face projects: route back into the matching AR mode ──────────
      const projectKind = (payload as any)?.metadata?.kind as string | undefined;
      if (projectKind === 'ar_scene') {
        const dir = (payload as any)?.metadata?.arSceneDir;
        if (dir) {
          await AsyncStorage.setItem('@load_ar_scene', JSON.stringify({ dir }));
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          navigation.navigate('Paint');
          return;
        }
      }
      if (projectKind === 'facemask') {
        await AsyncStorage.setItem('@load_facemask', JSON.stringify({ projectName: name }));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.navigate('Paint');
        return;
      }
      if (projectKind === 'vector') {
        const vectorDocument = (payload as any)?.metadata?.vectorDocument;
        if (!vectorDocument?.meta || !Array.isArray(vectorDocument?.strokes)) {
          CustomOverlayHelper.alert('Load failed', 'This Vector project is missing its document data.');
          return;
        }
        await AsyncStorage.setItem('@load_vector_project', JSON.stringify({
          projectName: name,
          vectorDocument,
        }));
        await setSnapshotProjectId(name);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.navigate('Paint');
        return;
      }

      // ✅ CRITICAL DEBUG: Log what's actually in the payload
      console.log('[ExportScreen] 📦 Payload contents:', {
        strokeCount: payload.strokes?.length ?? 'MISSING',
        brushEmoji: payload.brushEmoji,
        brushSize: payload.brushSize,
        hasTrace: !!payload.trace,
        hasEmojiPlanes: !!payload.emojiPlanes,
        hasFrames: !!payload.frames,
        frameCount: payload.frames?.length ?? 0,
        hasFramerFrames: !!payload.framerFrames,
        framerFrameCount: payload.framerFrames?.frames?.length ?? 0,
        isAnimation: payload.isAnimation,
        frameMode: payload.frameMode
      });

      // Check if this is an animation project
      // Check for animation frames - could be in payload.frames OR payload.framerFrames.frames
      const animationFrames = payload.frames?.length > 0 ? payload.frames :
                             (payload.framerFrames?.frames?.length > 0 ? payload.framerFrames.frames : null);
      const isAnimation = (payload.isAnimation || payload.frameMode || animationFrames?.length > 0) && animationFrames && animationFrames.length > 0;

      console.log('[LoadProject] Project check:', {
        hasFrames: !!animationFrames,
        frameCount: animationFrames?.length,
        isAnimation,
        payloadFrameMode: payload.frameMode,
        payloadIsAnimation: payload.isAnimation
      });

      if (isAnimation && animationFrames) {
        // For animation projects, store frames in AsyncStorage for PaintScreen to restore with atomic load
        await AsyncStorage.setItem('@load_animation_data', JSON.stringify({
          projectId: name, // Use name as project ID for now
          frames: animationFrames,
          selectedFrameIndex: 0, // Always start at first frame when loading
          fps: payload.framerFrames?.fps ?? payload.fps ?? 12,
          projectName: name // Keep for backward compatibility
        }));
        console.log('[LoadProject] Saved animation data for atomic restoration:', animationFrames?.length, 'frames');
      } else {
        // Clear any previous animation data
        await AsyncStorage.removeItem('@load_animation_data');
      }

      console.log('[ExportScreen] 🔄 Dispatching RESET');
      dispatch({ type: 'RESET' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const loadPayload = {
        strokes: payload.strokes ?? [],
        brushEmoji: payload.brushEmoji,
        brushSize: payload.brushSize,
        brushOpacity: payload.brushOpacity,
        brushSpacing: payload.brushSpacing ?? 0.3,
        brushRotation: payload.brushRotation ?? 0,
        mirrorX: payload.mirrorX ?? false,
        mirrorY: payload.mirrorY ?? false,
        recentEmojis: payload.recentEmojis,
        trace: payload.trace,
        emojiPlanes: payload.emojiPlanes ?? []
      };

      console.log('[ExportScreen] 📝 Dispatching LOAD_STATE with strokes:', loadPayload.strokes?.length ?? 0);

      // ✅ DEBUG: Show first stroke if available
      if (loadPayload.strokes && loadPayload.strokes.length > 0) {
        console.log('[ExportScreen] 🎨 First stroke:', {
          id: loadPayload.strokes[0].id,
          emoji: loadPayload.strokes[0].emoji,
          pointsCount: loadPayload.strokes[0].points?.length,
          size: loadPayload.strokes[0].size
        });
      }

      dispatch({
        type: 'LOAD_STATE',
        payload: loadPayload
      });

      // Save Framer data if present - this is CRITICAL for Framer restoration
      if (payload.framerFrames) {
        try {
          // Store in persistent data for current session
          await AsyncStorage.setItem('@framer_persistent_data', JSON.stringify(payload.framerFrames));

          // Also store complete project data for Framer to load on next open
          await AsyncStorage.setItem('@framer_project_data', JSON.stringify({
            projectName: name,
            framerData: payload.framerFrames,
            loadedAt: Date.now(),
            hasFrames: !!payload.framerFrames.frames?.length,
            frameCount: payload.framerFrames.frames?.length ?? 0
          }));

          // Set flag so Framer knows to load on next open
          await AsyncStorage.setItem('@framer_should_load_project', 'true');

          console.log('[LOAD] ✅ Saved Framer data for auto-load on next open:', {
            projectName: name,
            frameCount: payload.framerFrames.frames?.length ?? 0,
            hasBackground: !!payload.framerFrames.backgroundImage,
            hasVideo: !!payload.framerFrames.videoBackground,
            fps: payload.framerFrames.fps
          });
        } catch (error) {
          console.warn('[ExportScreen] Failed to save Framer data:', error);
        }
      } else {
        console.log('[LOAD] ℹ️ No Framer data in project');
      }

      // Set flag to prevent resume modal from showing (project was explicitly loaded)
      try {
        await AsyncStorage.setItem('@skipResumeModal', 'true');
        console.log('[ExportScreen] Set flag to skip resume modal on next app start');
      } catch (error) {
        console.warn('[ExportScreen] Failed to set skip resume modal flag:', error);
      }

      // Snapshot system removed - no longer switching snapshot projects
      await setSnapshotProjectId(name);
      CustomOverlayHelper.alert('Loaded', isAnimation ? `Animation "${name}" loaded with ${payload.frames?.length} frames` : `Project ${name} restored.`);
      navigation.goBack();
    } catch (error) {
      console.error(error);
      CustomOverlayHelper.alert('Load failed', 'Could not load project.');
    }
  }, [dispatch, navigation, projects, setSnapshotProjectId]);

  const loadProjectByName = useCallback((name: string) => {
    CustomOverlayHelper.confirm(
      'Load project?',
      'This will overwrite the current canvas. Continue?',
      () => {
        void performLoadProject(name);
      }
    );
  }, [performLoadProject]);

  const showDeleteConfirmation = useCallback((name: string) => {
    setDeleteProjectName(name);
    setDeleteSliderValue(0);
    setDeleteDialogVisible(true);
  }, []);

  const cancelDeleteConfirmation = useCallback(() => {
    setDeleteDialogVisible(false);
    setDeleteProjectName(null);
    setDeleteSliderValue(0);
  }, []);

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteProjectName) return;
    setDeleteDialogVisible(false);
    await deleteProject(deleteProjectName);
    await refreshProjects();
    setDeleteProjectName(null);
    setDeleteSliderValue(0);
  }, [deleteProjectName, refreshProjects]);

  const removeProject = useCallback((name: string) => {
    if (!name) return;
    showDeleteConfirmation(name);
  }, [showDeleteConfirmation]);

  const duplicateProject = useCallback(async (item: StoredProject) => {
      try {
      const payload = await loadProject(item.name);
      if (!payload) {
        CustomOverlayHelper.alert('Duplicate failed', 'Could not read project data.');
        return;
      }
      const copyName = `${item.name}-copy-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      if (payload.metadata?.kind === 'vector') {
        await saveProject(copyName, {
          ...payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {
            ...payload.metadata,
            savedAt: new Date().toISOString(),
          },
        });
        await refreshProjects();
        CustomOverlayHelper.alert('Duplicated', `Created ${copyName}`);
        return;
      }
      const snapshot = createProjectPayload({
        strokes: payload.strokes,
        trace: payload.trace,
        brushEmoji: payload.brushEmoji,
        brushSize: payload.brushSize,
        brushOpacity: payload.brushOpacity,
        brushSpacing: payload.brushSpacing ?? 0.3,
        brushRotation: payload.brushRotation ?? 0,
        mirrorX: payload.mirrorX ?? false,
        mirrorY: payload.mirrorY ?? false,
        recentEmojis: payload.recentEmojis,
        preview: payload.preview ?? null,
        createdAt: payload.createdAt
      });
      await saveProject(copyName, snapshot);
      // Snapshot system removed - no longer cloning snapshot projects
      await refreshProjects();
      CustomOverlayHelper.alert('Duplicated', `Created ${copyName}`);
    } catch (error) {
      console.error(error);
      CustomOverlayHelper.alert('Duplicate failed', 'Could not duplicate project.');
    }
  }, [refreshProjects]);

  const ensureMediaAccess = useCallback(async (): Promise<boolean> => {
      const permissions = await MediaLibrary.getPermissionsAsync();
    if (permissions.granted) {
      return true;
    }
    if (!permissions.canAskAgain) {
      return false;
    }
    const request = await MediaLibrary.requestPermissionsAsync();
    return request.granted;
  }, []);

  const shareProject = useCallback(async (name: string) => {
      try {
      const payload = await loadProject(name);
      if (!payload) {
        CustomOverlayHelper.alert('Export failed', 'Project data could not be loaded.');
        return;
      }
      const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!directory) {
        CustomOverlayHelper.alert('Export failed', 'Storage unavailable on this device.');
        return;
      }
      const sanitizedName = name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'project';
      const fileUri = `${directory}${sanitizedName}-${Date.now()}.emojipaint.json`;
      const serialized = JSON.stringify({ name, payload }, null, 2);
      await FileSystem.writeAsStringAsync(fileUri, serialized);

      const cleanup = async () => {
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch {
          // ignore
        }
      };

      const shareAvailable = await Sharing.isAvailableAsync();
      if (shareAvailable) {
        try {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/json',
            dialogTitle: `Share ${name}`,
            UTI: Platform.OS === 'ios' ? 'public.json' : undefined
          });
        } finally {
          await cleanup();
        }
        return;
      }

      if (await ensureMediaAccess()) {
        await MediaLibrary.saveToLibraryAsync(fileUri);
        await cleanup();
        CustomOverlayHelper.alert('Saved', `${name} exported to your library.`);
      } else {
        CustomOverlayHelper.alert('Exported', `Project saved to ${fileUri}`);
      }
    } catch (error) {
      console.error('Project export failed', error);
      CustomOverlayHelper.alert('Export failed', error instanceof Error ? error.message : 'Unable to export project.');
    }
  }, [ensureMediaAccess]);

  const activeProjectName = useMemo(
    () => (snapshotProjectId === DEFAULT_SNAPSHOT_PROJECT_ID ? null : snapshotProjectId),
    [snapshotProjectId]
  );

  const openRoomViewer = useCallback((item: StoredProject) => {
    if (item.arSceneDir) setRoomViewerDir(item.arSceneDir);
  }, []);

  const renderProject = useCallback(
    ({ item }: { item: StoredProject }) => (
      <ProjectCard
        item={item}
        onLoad={loadProjectByName}
        onDuplicate={duplicateProject}
        onDelete={removeProject}
        onShare={shareProject}
        onOpenViewer={openRoomViewer}
        activeProjectName={activeProjectName || autoOpenProjectName}
      />
    ),
    [activeProjectName, autoOpenProjectName, duplicateProject, loadProjectByName, openRoomViewer, removeProject, shareProject]
  );


  const workspaceLabel = snapshotProjectId === DEFAULT_SNAPSHOT_PROJECT_ID ? 'Unsaved session' : snapshotProjectId;

  const translateY = exitAnimation.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0, 700, 1500] // Slow fall to 70%, then fast crumble to bottom
  });

  const renderFooter = useCallback(() => {
    if (!hasVideos || projectsLoading) return null;
    return (
      <View style={{ position: 'relative', alignSelf: 'center' }}>
        <TouchableOpacity
          style={styles.videoStorageButton}
          onPress={() => { screenTriggerHelper('video_storage'); handleVideoStoragePress(); }}
          accessibilityLabel="Open Video Storage"
        >
          <Text style={styles.videoStorageButtonText}>{videoStorageEmoji} Video Storage</Text>
        </TouchableOpacity>
        <ButtonGlow counter={screenGlowCounters.video_storage ?? 0} enabled={screenTutorialMode} />
        <HelperRing visible={screenHelperKey === 'video_storage'} />
        <HelperLabel text="Video storage" visible={screenHelperKey === 'video_storage'} position="above" />
      </View>
    );
  }, [hasVideos, projectsLoading, videoStorageEmoji, handleVideoStoragePress]);

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY }], opacity: exitOpacity }]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Projects Overview</Text>
          <View style={styles.headerRightButtons}>
            <View style={{ position: 'relative' }}>
              <Animated.View style={[styles.paletteWrapper, { transform: [{ scale: paletteScale }] }]}>
                <TouchableOpacity
                  style={styles.paletteButton}
                  onPress={() => { screenTriggerHelper('close'); handlePalettePress(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Return to painting"
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.paletteGlyph}>❎</Text>
                </TouchableOpacity>
              </Animated.View>
              <ButtonGlow counter={screenGlowCounters.close ?? 0} enabled={screenTutorialMode} />
              <HelperRing visible={screenHelperKey === 'close'} />
              <HelperLabel text="Return to paint" visible={screenHelperKey === 'close'} position="below" />
            </View>
          </View>
        </View>

        {/* Clean Save Overlay - Green/White */}
        <View style={styles.saveOverlayBubble}>
          <View style={{ position: 'relative' }}>
            <Animated.View style={{ transform: [{ scale: saveButtonScaleAnim }] }}>
              <TouchableOpacity
                style={[styles.saveOverlayButton, isButtonGreenFlash && styles.saveOverlayButtonGreen]}
                onPress={() => { screenTriggerHelper('save_project'); openSaveDialog(); }}
                disabled={isSaving}
                accessibilityLabel="Save current project"
              >
                <View style={styles.saveOverlayContent}>
                  <Text style={styles.saveOverlayLabel}>Save project</Text>
                  <Text style={styles.saveOverlayButtonText}>{isSaving ? '⏳' : saveButtonEmoji}</Text>
                </View>
              </TouchableOpacity>
            </Animated.View>
            <ButtonGlow counter={screenGlowCounters.save_project ?? 0} enabled={screenTutorialMode} />
            <HelperRing visible={screenHelperKey === 'save_project'} />
            <HelperLabel text="Save project" visible={screenHelperKey === 'save_project'} position="below" />
          </View>
        </View>
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statWorkspace}>Current workspace: {workspaceLabel}</Text>
        <View style={styles.statChipRow}>
          <Text style={styles.statChip}>🖌️ {strokes.length}</Text>
          <Text style={styles.statChip}>{trace.imageUri ? '🖼️ with trace' : '⬜️ no trace'}</Text>
          <Text style={styles.statChip}>{`${(Math.max(brushSpacing, 0.001) * 100).toFixed(2)}% spacing`}</Text>
        </View>
      </View>

      {projectsLoading ? (
        <View style={styles.projectsLoading}>
          <ActivityIndicator color="#ff9f6b" size="large" />
          <Text style={styles.projectsLoadingLabel}>Loading projects…</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={projects}
          keyExtractor={(item) => item.name}
          renderItem={renderProject}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={true}
          scrollEventThrottle={16}
          ListEmptyComponent={
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyState}>No saved projects yet.</Text>
              <TouchableOpacity
                style={styles.emptyStateSaveButton}
                onPress={openSaveDialog}
                disabled={isSaving}
                accessibilityLabel="Save your first project"
              >
                <Text style={styles.emptyStateSaveButtonText}>{isSaving ? '⏳' : saveButtonEmoji}</Text>
                <Text style={styles.emptyStateSaveButtonLabel}>Save Project</Text>
              </TouchableOpacity>
            </View>
          }
          ListFooterComponent={renderFooter}
          contentContainerStyle={projects.length === 0 ? styles.emptyContainer : styles.projectList}
        />
      )}

<Modal
  visible={saveDialogVisible}
  transparent
  animationType="fade"
  onRequestClose={cancelSaveDialog}
  supportedOrientations={Platform.OS === 'ios' && (Platform as any).isPad ? ['portrait', 'landscape'] : undefined}
>
  <View style={styles.saveOverlay}>
    <View style={styles.saveCard}>
      {progressMessage ? (
        <>
          <Text style={styles.saveTitle}>Saving Project</Text>
          <Text style={styles.saveSubtitle}>{progressMessage}</Text>
          <ActivityIndicator style={styles.saveBusySpinner} color="#ffdc82" size="large" />
        </>
      ) : saveDialogStep === 'video-preview' ? (
        <>
          <Text style={styles.saveTitle}>🎬 Animation Preview</Text>
          <Text style={styles.saveSubtitle}>
            We detected {detectedFrameCount} animation frames. Create a fast video preview for this project?
          </Text>
          <Text style={styles.videoPreviewCaption}>
            This will generate a MOV file (compressed for speed) that plays when loading this project.
          </Text>
          <TouchableOpacity
            style={[styles.saveChoiceButton, isSaving && styles.saveChoiceButtonDisabled]}
            onPress={handleConfirmVideoPreview}
            disabled={isSaving || isGeneratingVideo}
          >
            <Text style={styles.saveChoiceLabel}>Yes, create video</Text>
            <Text style={styles.saveChoiceCaption}>Generate a MOV preview (30-45 seconds)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveChoiceButton, isSaving && styles.saveChoiceButtonDisabled]}
            onPress={handleSkipVideoPreview}
            disabled={isSaving || isGeneratingVideo}
          >
            <Text style={styles.saveChoiceLabel}>No, skip</Text>
            <Text style={styles.saveChoiceCaption}>Use a static image preview instead</Text>
          </TouchableOpacity>
          {isSaving || isGeneratingVideo ? <ActivityIndicator style={styles.saveBusySpinner} color="#ffdc82" /> : null}
        </>
      ) : saveDialogStep === 'choice' ? (
        <>
          <Text style={styles.saveTitle}>Save Project</Text>
          <Text style={styles.saveSubtitle}>Choose how you want to save this session.</Text>
          <TouchableOpacity
            style={[styles.saveChoiceButton, isSaving && styles.saveChoiceButtonDisabled]}
            onPress={handleSaveSession}
            disabled={isSaving}
          >
            <Text style={styles.saveChoiceLabel}>Save session</Text>
            <Text style={styles.saveChoiceCaption}>
              {snapshotProjectId !== DEFAULT_SNAPSHOT_PROJECT_ID && snapshotProjectId.trim().length > 0
                ? `Update ${snapshotProjectId}`
                : 'Create a timestamped project for this session.'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveChoiceButton, isSaving && styles.saveChoiceButtonDisabled]}
            onPress={handleSaveAsNew}
            disabled={isSaving}
          >
            <Text style={styles.saveChoiceLabel}>Save as new</Text>
            <Text style={styles.saveChoiceCaption}>Pick a custom name and keep this version separately.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveChoiceButton, isSaving && styles.saveChoiceButtonDisabled]}
            onPress={handleSaveAll}
            disabled={isSaving}
          >
            <Text style={styles.saveChoiceLabel}>💾 Save all</Text>
            <Text style={styles.saveChoiceCaption}>Save both workspace strokes and Framer frames together.</Text>
          </TouchableOpacity>
          {isSaving ? <ActivityIndicator style={styles.saveBusySpinner} color="#ffdc82" /> : null}
          <TouchableOpacity style={styles.saveCancel} onPress={cancelSaveDialog} disabled={isSaving}>
            <Text style={styles.saveCancelLabel}>Close</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.saveTitle}>Save as new project</Text>
          <Text style={styles.saveSubtitle}>Give this project a name (optional).</Text>
          <TextInput
            style={styles.saveInput}
            placeholder="Project name"
            placeholderTextColor="#666"
            value={pendingSaveName}
            onChangeText={setPendingSaveName}
            editable={!isSaving}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submitSaveAsNew}
          />
          <Text style={styles.saveHint}>Leave blank to use the current date and time.</Text>
          {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
          <View style={styles.saveActions}>
            <TouchableOpacity
              style={styles.saveBack}
              onPress={() => {
                if (!isSaving) {
                  setSaveDialogStep('choice');
                  setSaveError(null);
                }
              }}
              disabled={isSaving}
            >
              <Text style={styles.saveBackLabel}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveConfirm, isSaving && styles.saveChoiceButtonDisabled]}
              onPress={submitSaveAsNew}
              disabled={isSaving}
            >
              {isSaving ? <ActivityIndicator color="#050505" /> : <Text style={styles.saveConfirmLabel}>Save</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  </View>
</Modal>

      {/* Delete Confirmation Modal with Slider */}
      <Modal
        visible={deleteDialogVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelDeleteConfirmation}
        supportedOrientations={Platform.OS === 'ios' && (Platform as any).isPad ? ['portrait', 'landscape'] : undefined}
      >
        <View style={styles.saveOverlay}>
          <View style={styles.saveCard}>
            <Text style={styles.saveTitle}>⚠️ Delete Project</Text>
            <Text style={styles.saveSubtitle}>
              Are you sure you want to delete "{deleteProjectName}"? This action cannot be undone.
            </Text>
            <View style={styles.deleteSliderContainer}>
              <Text style={styles.deleteSliderLabel}>
                {deleteSliderValue < 0.95 ? 'Slide to Delete →' : 'Release to Confirm'}
              </Text>
              <Slider
                style={styles.deleteSlider}
                value={deleteSliderValue}
                onValueChange={setDeleteSliderValue}
                onSlidingComplete={(value) => {
                  if (value >= 0.95) {
                    confirmDeleteProject();
                  } else {
                    setDeleteSliderValue(0);
                  }
                }}
                minimumValue={0}
                maximumValue={1}
                minimumTrackTintColor="#ff3b30"
                maximumTrackTintColor="#3a3a3a"
                thumbTintColor="#ff3b30"
                inverted={false}
              />
            </View>
            <TouchableOpacity style={styles.saveCancel} onPress={cancelDeleteConfirmation}>
              <Text style={styles.saveCancelLabel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <RoomViewerModal
        visible={roomViewerDir != null}
        roomDir={roomViewerDir}
        title="Project Room"
        onClose={() => setRoomViewerDir(null)}
        onOpenAR={() => {
          const dir = roomViewerDir;
          setRoomViewerDir(null);
          if (dir) {
            void AsyncStorage.setItem('@load_ar_scene', JSON.stringify({ dir }));
            navigation.navigate('Paint');
          }
        }}
      />

      <CustomOverlay ref={(ref) => ref && CustomOverlayHelper.setInstance(ref)} />
    </Animated.View>
  );
};


const styles = StyleSheet.create({
  container: {
      flex: 1,
    backgroundColor: '#0b0b0b',
    padding: 24
  },
  saveOverlayBubble: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    padding: 4,
    marginTop: 12
  },
  saveOverlayContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10
  },
  saveOverlayLabel: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'vrtlfinal',
    color: '#fff'
  },
  saveOverlayButton: {
    borderRadius: 10,
    backgroundColor: '#000',
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  saveOverlayButtonGreen: {
    backgroundColor: '#22c55e'
  },
  saveOverlayButtonText: {
    fontSize: 24
  },
  header: {
      marginBottom: 20,
    backgroundColor: '#141414',
    borderRadius: 18,
    padding: 18,
    gap: 16
  },
  headerRow: {
      flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18
  },
  paletteWrapper: {
      borderRadius: 18,
    overflow: 'hidden'
  },
  paletteButton: {
      width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center'
  },
  paletteGlyph: {
      fontSize: 30,
    color: '#fff',
    fontFamily: 'vrtlfinal'
  },
  headerActions: {
      flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end'
  },
  iconButton: {
      width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonDisabled: {
    opacity: 0.6
  },
  iconButtonPrimary: {
      width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#ff6b6b',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonGlyph: {
      fontSize: 22,
    fontFamily: 'vrtlfinal'
  },
  statRow: {
      gap: 8,
    marginBottom: 20
  },
  statWorkspace: {
      color: '#ffdc82',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  statChipRow: {
      flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4
  },
  statChip: {
      backgroundColor: '#151515',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    color: '#ddd',
    fontSize: 12,
    fontFamily: 'vrtlfinal'
  },
  projectList: {
      gap: 16,
    paddingBottom: 80
  },
  card: {
      flexDirection: 'row',
    gap: 16,
    borderRadius: 16,
    backgroundColor: '#141414',
    padding: 16,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#242424'
  },
  cardActive: {
      borderColor: '#ff9f6b',
    shadowColor: '#ff9f6b',
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 16 },
    elevation: 14,
    backgroundColor: '#1f130b'
  },
  cardPreview: {
      width: PROJECT_PREVIEW_SIZE,
    height: PROJECT_PREVIEW_SIZE,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0b0b0b',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    position: 'relative'
  },
  cardPreviewImage: {
      width: '100%',
    height: '100%',
    // Ensure full image is visible without cropping
    // React Native Image with resizeMode contain respects container; no extra scale
    // Explicitly center it to avoid subpixel offset
    alignSelf: 'center',
    backgroundColor: '#0b0b0b'
  },
  cardPreviewFallback: {
      flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161616'
  },
  cardPreviewFallbackText: {
      color: '#555',
    fontSize: 11,
    textTransform: 'uppercase',
    fontFamily: 'vrtlfinal'
  },
  cardBody: {
      flex: 1,
    gap: 6
  },
  cardTitleRow: {
      flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  cardTitle: {
      color: '#fff',
    fontWeight: '600'
  },
  cardTitleActive: {
      color: '#ffdc82'
  },
  cardActiveFlag: {
      marginLeft: 'auto',
    backgroundColor: '#ff9f6b',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4
  },
  cardActiveFlagText: {
      color: '#1a0e08',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontFamily: 'vrtlfinal'
  },
  cardMeta: {
      color: '#8a8a8a',
    fontSize: 12,
    fontFamily: 'vrtlfinal'
  },
  cardStats: {
      color: '#7a7a7a',
    fontSize: 11,
    fontFamily: 'vrtlfinal'
  },
  cardActions: {
      flexDirection: 'row',
    gap: 10
  },
  cardActionBouncyWrap: {
      borderRadius: 14,
    shadowColor: '#ff9f6b',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3
  },
  cardActionButton: {
      width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardActionDanger: {
      backgroundColor: '#351515'
  },
  cardActionRoom: {
      backgroundColor: '#176a79'
  },
  cardActionEmoji: {
      fontSize: 20,
    color: '#fff',
    fontFamily: 'vrtlfinal'
  },
  projectsLoading: {
      flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 48
  },
  projectsLoadingLabel: {
      color: '#9ea0a4',
    fontSize: 14,
    fontFamily: 'vrtlfinal'
  },
  emptyState: {
      color: '#555',
    textAlign: 'center',
    marginTop: 48
  },
  emptyContainer: {
      flexGrow: 1,
    justifyContent: 'center'
  },
  saveOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
},
  saveCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#141414',
    borderRadius: 18,
    padding: 20,
    gap: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2b2b2b'
},
  saveTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
},
  saveSubtitle: {
    color: '#b5b5b5',
    fontSize: 14,
    fontFamily: 'vrtlfinal'
},
  saveChoiceButton: {
    backgroundColor: '#030303',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f',
    paddingHorizontal: 16,
    paddingVertical: 16
},
  saveChoiceButtonDisabled: {
    opacity: 0.6
},
  saveChoiceLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
},
  saveChoiceCaption: {
    color: '#9ea0a4',
    fontSize: 13,
  marginTop: 6,
    fontFamily: 'vrtlfinal'
},
  videoPreviewCaption: {
    color: '#7a7a7a',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 16,
    fontFamily: 'vrtlfinal'
},
  saveBusySpinner: {
    alignSelf: 'center'
},
  saveCancel: {
    alignSelf: 'center'
},
  saveCancelLabel: {
    color: '#bbbbbb',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
},
  saveInput: {
    backgroundColor: '#030303',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 16,
    fontFamily: 'vrtlfinal'
},
  saveHint: {
    color: '#777',
    fontSize: 12,
    fontFamily: 'vrtlfinal'
},
  saveError: {
    color: '#ff8b8b',
    fontSize: 13,
    fontFamily: 'vrtlfinal'
},
  saveActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
},
  saveBack: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a3a3a',
    alignItems: 'center'
},
  saveBackLabel: {
    color: '#bbbbbb',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
},
  saveConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#ff6b6b',
    alignItems: 'center'
},
  saveConfirmLabel: {
    color: '#050505',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  deleteSliderContainer: {
    backgroundColor: '#030303',
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 2,
    borderColor: '#ff3b30'
  },
  deleteSliderLabel: {
    color: '#ff3b30',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  deleteSlider: {
    width: '100%',
    height: 40
  },
  videoStorageButton: {
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center'
  },
  videoStorageButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'vrtlfinal'
  },
  animatedSaveButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#444'
  },
  animatedSaveButtonText: {
    fontSize: 24
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'left',
    fontFamily: 'vrtlfinal'
  },
  headerRightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 48
  },
  emptyStateSaveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 24,
    paddingHorizontal: 32,
    backgroundColor: '#2a2a2a',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#444'
  },
  emptyStateSaveButtonText: {
    fontSize: 48
  },
  emptyStateSaveButtonLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'vrtlfinal'
  }
});

export default ExportScreen;
