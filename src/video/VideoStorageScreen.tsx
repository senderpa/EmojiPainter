/**
 * Video Storage Screen
 *
 * Lists all saved transparent MOV files
 * Allows import, delete, and selection for video editor
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Image, Modal, Share, Platform, Dimensions, ScrollView, PanResponder } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { CustomOverlayHelper } from '../components/CustomOverlay';
import Slider from '@react-native-community/slider';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { ResizeMode } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RootStackParamList } from '../App';
import { emitAppEvent } from '../lib/appEvents';
import {
  getAllVideos,
  getVideosInFolder,
  importVideo,
  deleteVideo,
  validateMOVFormat,
  initializeVideoStorage,
  type VideoMetadata
} from './videoStorage';
import ShortVideoPlayer from './ShortVideoPlayer';

const isImageItem = (item: VideoMetadata) =>
  item.mediaType === 'image' || item.uri?.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/);

const getShareMimeType = (item: VideoMetadata) => {
  if (isImageItem(item)) {
    const lowerUri = item.uri.toLowerCase();
    if (lowerUri.endsWith('.jpg') || lowerUri.endsWith('.jpeg')) return 'image/jpeg';
    if (lowerUri.endsWith('.webp')) return 'image/webp';
    return 'image/png';
  }
  return 'video/quicktime';
};

const PreviewVideoPlayer: React.FC<{ uri: string; isVisible?: boolean }> = ({ uri, isVisible = true }) => {
  return (
    <ShortVideoPlayer
      uri={uri}
      style={styles.thumbnail}
      resizeMode={ResizeMode.COVER}
      shouldPlay={isVisible}
      isMuted
    />
  );
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'VideoStorage'>;

export default function VideoStorageScreen() {
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionMenuVideo, setActionMenuVideo] = useState<VideoMetadata | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoMetadata | null>(null);
  const [visibleVideoIds, setVisibleVideoIds] = useState<Set<string>>(new Set());
  const [markedForDeletion, setMarkedForDeletion] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<VideoMetadata | null>(null);

  // View mode state: list, icon, or grid
  type ViewMode = 'list' | 'icon' | 'grid';
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Grid size state (1-10, controls items per row)
  const [gridSize, setGridSize] = useState(3); // Default 3 items per row

  // Video icon positions for grid views (video.id -> {x, y})
  const [iconPositions, setIconPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Window dimensions for responsive layout
  const [windowDimensions, setWindowDimensions] = useState(() => {
    const { width, height } = Dimensions.get('window');
    return { width, height };
  });

  // Update dimensions on orientation change
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setWindowDimensions({ width: window.width, height: window.height });
    });

    return () => subscription?.remove();
  }, []);

  // Check if iPad and landscape
  const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad;
  const isLandscape = windowDimensions.width > windowDimensions.height;

  // Load videos on mount and when folder changes
  useEffect(() => {
    const init = async () => {
      await initializeVideoStorage();
      if (isMountedRef.current) await loadVideos();
    };
    init();
  }, [currentFolder]);

  // Reload videos when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      console.log('[VideoStorage] Screen focused, reloading videos...');
      loadVideos();
    }, [])
  );

  const loadVideos = async () => {
    if (!isMountedRef.current) return;
    setLoading(true);
    try {
      if (currentFolder && currentFolder.folderPath) {
        const folderVideos = await getVideosInFolder(currentFolder.folderPath);
        if (!isMountedRef.current) return;
        setVideos(folderVideos);
      } else {
        const allVideos = await getAllVideos();
        if (!isMountedRef.current) return;
        setVideos(allVideos);
      }
    } catch (e) {
      // ignore on unmount
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  // Open a folder
  const openFolder = useCallback((folder: VideoMetadata) => {
    if (folder.isFolder) {
      setCurrentFolder(folder);
    }
  }, []);

  // Go back to folder list
  const goBack = useCallback(() => {
    setCurrentFolder(null);
  }, []);

  // Handle view mode change
  const handleViewModeChange = useCallback((newMode: ViewMode) => {
    if (newMode === viewMode) return;

    setViewMode(newMode);

    // Calculate grid positions when switching to grid
    if (newMode === 'grid') {
      calculateGridPositions();
    }
  }, [viewMode, videos]);

  // Calculate grid positions for videos (responsive based on gridSize slider)
  const calculateGridPositions = useCallback(() => {
    const screenWidth = windowDimensions.width;
    const padding = 16;
    const gap = 16;

    // Calculate item size based on gridSize (1-10 items per row)
    const columns = gridSize;
    const availableWidth = screenWidth - (padding * 2) - (gap * (columns - 1));
    const itemSize = Math.floor(availableWidth / columns);

    const startX = padding;

    const positions = new Map<string, { x: number; y: number }>();
    videos.forEach((video, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      positions.set(video.id, {
        x: startX + col * (itemSize + gap),
        y: 100 + row * (itemSize + gap)
      });
    });
    setIconPositions(positions);
  }, [videos, gridSize, windowDimensions]);

  // Recalculate grid when gridSize changes and we're in grid mode
  useEffect(() => {
    if (viewMode === 'grid') {
      calculateGridPositions();
    }
  }, [gridSize, viewMode, calculateGridPositions]);


  // Handle import
  const handleImport = async () => {
    try {
      setImporting(true);

      // Request permissions
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        CustomOverlayHelper.show({ title: 'Permission Required', message: 'Please allow access to your photo library to import videos.' });
        setImporting(false);
        return;
      }

      // Pick video from photo library
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1
      });

      if (result.canceled) {
        setImporting(false);
        return;
      }

      const file = result.assets[0];
      console.log('[VideoStorage] Selected video:', file.uri);

      // Validate format
      const validation = await validateMOVFormat(file.uri);
      if (!validation.valid) {
        CustomOverlayHelper.show({ title: 'Invalid Format', message: validation.error || 'Only transparent MOV files (HEVC with alpha) are supported.' });
        setImporting(false);
        return;
      }

      // Import video
      const metadata = await importVideo(file.uri);
      if (!isMountedRef.current) return;
      if (metadata) {
        CustomOverlayHelper.show({ title: 'Success', message: 'Video imported successfully!' });
        await loadVideos();
      } else {
        CustomOverlayHelper.show({ title: 'Error', message: 'Failed to import video.' });
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      CustomOverlayHelper.show({ title: 'Error', message: `Failed to import: ${error}` });
    } finally {
      if (isMountedRef.current) setImporting(false);
    }
  };

  // Handle delete with animation
  const handleDelete = useCallback(async (video: VideoMetadata) => {
    if (markedForDeletion === video.id) {
      // Second click - show lightning and delete immediately
      setMarkedForDeletion(`${video.id}_flash`);

      // Wait 300ms for flash animation, then remove from list
      setTimeout(async () => {
        // Remove from UI immediately
        setVideos(prev => prev.filter(v => v.id !== video.id));
        setMarkedForDeletion(null);

        // Delete from storage in background
        await deleteVideo(video.id);
      }, 300);
    } else {
      // First click - mark for deletion (show X)
      setMarkedForDeletion(video.id);
    }
  }, [markedForDeletion]);

  // Toggle selection mode
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => !prev);
    setSelectedIds(new Set());
  }, []);

  // Toggle video selection
  const toggleVideoSelection = useCallback((videoId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(videoId)) {
        newSet.delete(videoId);
      } else {
        newSet.add(videoId);
      }
      return newSet;
    });
  }, []);

  // Handle video selection (show action menu or toggle selection)
  const handleSelect = useCallback((video: VideoMetadata) => {
    // Check if this is a folder
    if (video.isFolder) {
      openFolder(video);
      return;
    }

    if (selectionMode) {
      toggleVideoSelection(video.id);
    } else {
      // Show action menu
      setActionMenuVideo(video);
    }
  }, [selectionMode, toggleVideoSelection, openFolder]);

  // Open selected videos in Video Editor (supports multiple videos)
  const openInEditor = useCallback(() => {
    const selectedCount = selectedIds.size;
    if (selectedCount === 0) return;
    const selectedItems = videos.filter(v => selectedIds.has(v.id));
    if (selectedItems.some(isImageItem)) {
      CustomOverlayHelper.show({
        title: 'Images not supported',
        message: 'Only videos can be opened in the video editor. Images can be exported or deleted from storage.'
      });
      return;
    }

    // Get all selected video IDs
    const videoIds = Array.from(selectedIds);

    // Navigate to Video Editor with all selected videos
    navigation.navigate('VideoEditor', {
      initialVideoIds: videoIds
    });

    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [selectedIds, navigation]);

  // Export selected videos
  const exportSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;

    try {
      for (const videoId of selectedIds) {
        const video = videos.find(v => v.id === videoId);
        if (video) {
          // Ensure file:// URI format for iOS
          let shareUri = video.uri.startsWith('file://') ? video.uri : `file://${video.uri}`;
          const mimeType = getShareMimeType(video);
          const uti = isImageItem(video) ? 'public.image' : 'public.movie';

          // iOS needs expo-sharing for local file URIs. Use the correct MIME/UTI for images vs videos.
          console.log('[VideoStorage] Sharing video:', shareUri);

          if (Platform.OS === 'ios') {
            // For iOS, use Sharing.shareAsync which properly handles files
            const Sharing = require('expo-sharing');
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(shareUri, {
                mimeType,
                dialogTitle: video.filename,
                UTI: uti
              });
            } else {
              CustomOverlayHelper.show({ title: 'Error', message: 'Sharing is not available on this device' });
            }
          } else {
            await Share.share({
              message: `Share ${video.filename}`,
              title: video.filename,
              url: shareUri
            });
          }
        }
      }
    } catch (error) {
      console.error('[VideoStorage] Export failed:', error);
      CustomOverlayHelper.show({ title: 'Export Failed', message: `Could not share videos: ${error}` });
    }
  }, [selectedIds, videos]);

  // Delete selected videos
  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;

    // Delete immediately - no confirmation dialog
    for (const videoId of selectedIds) {
      await deleteVideo(videoId);
    }
    await loadVideos();
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [selectedIds]);

  // Action menu handlers
  const handleActionMenuOpenFramer = useCallback(() => {
    if (!actionMenuVideo) return;
    if (isImageItem(actionMenuVideo)) return;
    const video = actionMenuVideo;
    setActionMenuVideo(null);
    // Navigate to Paint screen with Framer auto-open and video auto-import params
    navigation.navigate('Paint', {
      openFramer: true,
      framerAutoImportVideoUri: video.uri,
      framerAutoImportVideoDuration: video.duration
    });
  }, [actionMenuVideo, navigation]);

  const handleActionMenuOpenVideoEditor = useCallback(() => {
    if (!actionMenuVideo) return;
    if (isImageItem(actionMenuVideo)) return;
    const video = actionMenuVideo;
    setActionMenuVideo(null);
    // Navigate to Video Editor with this video pre-loaded
    navigation.navigate('VideoEditor', {
      initialVideoIds: [video.id]
    });
  }, [actionMenuVideo, navigation]);

  const handleActionMenuExport = useCallback(async () => {
    if (!actionMenuVideo) return;
    const video = actionMenuVideo;
    setActionMenuVideo(null);

    console.log('[VideoStorage] Starting export for:', video.filename);
    console.log('[VideoStorage] Video URI:', video.uri);

    // Emit export complete event to show overlay with share button
    emitAppEvent('export:complete', {
      uri: video.uri,
      filename: video.filename,
      mediaType: isImageItem(video) ? 'image' : 'video'
    });
  }, [actionMenuVideo]);

  const handleActionMenuDelete = useCallback(async () => {
    if (!actionMenuVideo) return;
    const video = actionMenuVideo;
    setActionMenuVideo(null);
    // Delete immediately from action menu
    await deleteVideo(video.id);
    await loadVideos();
  }, [actionMenuVideo]);

  const handleActionMenuSelect = useCallback(() => {
    if (!actionMenuVideo) return;
    const videoId = actionMenuVideo.id;
    setActionMenuVideo(null);
    setSelectionMode(true);
    setSelectedIds(new Set([videoId]));
  }, [actionMenuVideo]);

  const openPreview = useCallback((video: VideoMetadata) => {
    setPreviewVideo(video);
  }, []);

  const closePreview = useCallback(() => setPreviewVideo(null), []);

  // Format duration (supports sub-second videos)
  const formatDuration = (ms: number) => {
    // For very short videos (< 1 second), show milliseconds
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Format file size
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Render video item
  const renderItem = ({ item }: { item: VideoMetadata }) => {
    const isSelected = selectedIds.has(item.id);
    const inlinePreviewUri = item.previewUri ?? item.uri;
    const isVisible = visibleVideoIds.has(item.id);
    const isExport = item.isExport ?? false;
    const isFolder = item.isFolder ?? false;

    // Calculate thumbnail dimensions based on type
    const thumbnailStyle = isExport
      ? {
          // Exports: 4K aspect ratio (e.g., 3840x2160 -> 142x80 to fit height of 80)
          width: Math.round((item.previewWidth ?? 80) * (80 / (item.previewHeight ?? 80))),
          height: 80
        }
      : {
          // Imports: square
          width: 80,
          height: 80
        };

    return (
      <View
        onLayout={(event) => {
          // Simple visibility check - just track if item has been rendered
          setVisibleVideoIds(prev => new Set(prev).add(item.id));
        }}
      >
        <TouchableOpacity
          style={[
            styles.videoItem,
            isSelected && styles.videoItemSelected,
            isFolder && styles.folderItem
          ]}
          onPress={() => handleSelect(item)}
          onLongPress={toggleSelectionMode}
        >
          {/* Selection checkbox */}
          {selectionMode && !isFolder && (
            <View style={styles.checkboxContainer}>
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Text style={styles.checkboxCheck}>✓</Text>}
              </View>
            </View>
          )}

          {/* Thumbnail / inline preview */}
          <View style={[styles.thumbnailContainer, thumbnailStyle]}>
            {isFolder ? (
              <View style={styles.folderIconContainer}>
                <Text style={styles.folderIcon}>📁</Text>
              </View>
            ) : isImageItem(item) && inlinePreviewUri ? (
              <Image source={{ uri: inlinePreviewUri }} style={styles.thumbnail} resizeMode="cover" />
            ) : inlinePreviewUri ? (
              <PreviewVideoPlayer uri={inlinePreviewUri} isVisible={isVisible} />
            ) : item.thumbnail ? (
              <Image
                source={{ uri: item.thumbnail }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.thumbnailPlaceholder}>
                <Text style={styles.thumbnailIcon}>VID</Text>
              </View>
            )}
          </View>

        {/* Info */}
        <View style={styles.videoInfo}>
          <Text style={styles.videoFilename} numberOfLines={1}>
            {isFolder ? item.wordTitle : item.filename}
          </Text>
          {isFolder ? (
            <Text style={styles.videoDetails}>
              {item.videoCount} video{item.videoCount !== 1 ? 's' : ''}
            </Text>
          ) : (
            <Text style={styles.videoDetails}>
              {item.width}×{item.height} • {item.duration > 0 ? formatDuration(item.duration) : 'Unknown duration'}
            </Text>
          )}
          <Text style={styles.videoDate}>{formatDate(item.createdAt)}</Text>
        </View>

        {/* Actions */}
        {!selectionMode && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDelete(item)}
          >
            <Text style={styles.deleteButtonText}>
              {markedForDeletion === `${item.id}_flash` ? '⚡️' : markedForDeletion === item.id ? '❌' : '🗑️'}
            </Text>
          </TouchableOpacity>
        )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {currentFolder ? (
          <TouchableOpacity style={styles.closeButton} onPress={goBack}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <Text style={styles.closeButtonText}>❎</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1, flexDirection: 'column', alignItems: 'center' }}>
          <Text style={styles.headerTitle}>
            {selectionMode
              ? `${selectedIds.size} selected`
              : currentFolder
              ? currentFolder.wordTitle
              : 'Video Storage'}
          </Text>
          {/* View Mode Picker - Show only when not in selection mode and not in folder */}
          {!selectionMode && !currentFolder && (
            <View style={styles.viewModePicker}>
              <TouchableOpacity
                style={[styles.viewModeButton, viewMode === 'list' && styles.viewModeButtonActive]}
                onPress={() => handleViewModeChange('list')}
              >
                <Text style={[styles.viewModeButtonText, viewMode === 'list' && styles.viewModeButtonTextActive]}>
                  ☰
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewModeButton, viewMode === 'icon' && styles.viewModeButtonActive]}
                onPress={() => handleViewModeChange('icon')}
              >
                <Text style={[styles.viewModeButtonText, viewMode === 'icon' && styles.viewModeButtonTextActive]}>
                  📄
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewModeButton, viewMode === 'grid' && styles.viewModeButtonActive]}
                onPress={() => handleViewModeChange('grid')}
              >
                <Text style={[styles.viewModeButtonText, viewMode === 'grid' && styles.viewModeButtonTextActive]}>
                  ⊞
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        {selectionMode ? (
          <TouchableOpacity
            style={[styles.importButton, { width: 80 }]}
            onPress={toggleSelectionMode}
          >
            <Text style={[styles.importButtonText, { fontSize: 14 }]}>Done</Text>
          </TouchableOpacity>
        ) : !currentFolder ? (
          <TouchableOpacity
            style={styles.importButton}
            onPress={handleImport}
            disabled={importing}
          >
            <Text style={styles.importButtonText}>+</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      {/* Selection actions bar */}
      {selectionMode && selectedIds.size > 0 && (
        <View style={styles.actionsBar}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={openInEditor}
          >
            <Text style={styles.actionButtonText}>Open in Editor</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={exportSelected}
          >
            <Text style={styles.actionButtonText}>📤 Export</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonDanger]}
            onPress={deleteSelected}
          >
            <Text style={styles.actionButtonText}>🗑️ Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Subtitle */}
      <Text style={styles.subtitle}>
        Transparent MOV files and image backups
      </Text>

      {/* Grid Size Slider - Show only in grid mode */}
      {viewMode === 'grid' && !loading && videos.length > 0 && (
        <View style={styles.gridSizeSliderContainer}>
          <Text style={styles.gridSizeLabel}>Grid Size:</Text>
          <Slider
            style={styles.gridSizeSlider}
            minimumValue={1}
            maximumValue={10}
            step={1}
            value={gridSize}
            onValueChange={setGridSize}
            minimumTrackTintColor="#ff9f6b"
            maximumTrackTintColor="#333"
            thumbTintColor="#ff9f6b"
          />
          <Text style={styles.gridSizeValue}>{gridSize}</Text>
        </View>
      )}

      {/* Loading */}
      {loading && (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#ff9f6b" />
        </View>
      )}

      {/* Empty state */}
      {!loading && videos.length === 0 && (
        <View style={styles.centerContent}>
          <Text style={styles.emptyIcon}>📹</Text>
          <Text style={styles.emptyText}>No videos yet</Text>
          <Text style={styles.emptySubtext}>
            Tap + to import transparent MOV files
          </Text>
        </View>
      )}

      {/* Video list - LIST VIEW */}
      {!loading && videos.length > 0 && viewMode === 'list' && (
        <FlatList
          data={videos}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          removeClippedSubviews={true}
          maxToRenderPerBatch={5}
          windowSize={5}
          onViewableItemsChanged={({ viewableItems }) => {
            const visibleIds = new Set(viewableItems.map(item => item.item.id));
            setVisibleVideoIds(visibleIds);
          }}
          viewabilityConfig={{
            itemVisiblePercentThreshold: 50
          }}
        />
      )}

      {/* Icon View - Large image on left, info on right */}
      {!loading && videos.length > 0 && viewMode === 'icon' && (
        <FlatList
          data={videos}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item.id);
            const inlinePreviewUri = item.previewUri ?? item.uri;
            const isVisible = visibleVideoIds.has(item.id);
            const isFolder = item.isFolder ?? false;

            return (
              <TouchableOpacity
                style={[
                  styles.iconViewItem,
                  isSelected && styles.iconViewItemSelected,
                  isFolder && styles.folderItem
                ]}
                onPress={() => handleSelect(item)}
                onLongPress={toggleSelectionMode}
              >
                {/* Large video preview on left (60% of screen height max) */}
                <View style={styles.iconViewImageContainer}>
                  {isFolder ? (
                    <View style={styles.folderIconContainer}>
                      <Text style={styles.folderIcon}>📁</Text>
                    </View>
                  ) : isImageItem(item) && inlinePreviewUri ? (
                    <Image source={{ uri: inlinePreviewUri }} style={styles.thumbnail} resizeMode="cover" />
                  ) : inlinePreviewUri ? (
                    <PreviewVideoPlayer uri={inlinePreviewUri} isVisible={isVisible} />
                  ) : item.thumbnail ? (
                    <Image
                      source={{ uri: item.thumbnail }}
                      style={styles.thumbnail}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.thumbnailPlaceholder}>
                      <Text style={styles.thumbnailIcon}>VID</Text>
                    </View>
                  )}
                </View>

                {/* Info on right */}
                <View style={styles.iconViewInfo}>
                  <Text style={styles.iconViewFilename} numberOfLines={2}>
                    {isFolder ? item.wordTitle : item.filename}
                  </Text>
                  {isFolder ? (
                    <Text style={styles.iconViewDetails}>
                      📂 {item.videoCount} video{item.videoCount !== 1 ? 's' : ''}
                    </Text>
                  ) : (
                    <>
                      <Text style={styles.iconViewDetails}>
                        📐 {item.width} × {item.height}
                      </Text>
                      <Text style={styles.iconViewDetails}>
                        ⏱️ {item.duration > 0 ? formatDuration(item.duration) : 'Unknown'}
                      </Text>
                      <Text style={styles.iconViewDetails}>
                        📅 {formatDate(item.createdAt)}
                      </Text>
                      {item.isExport && (
                        <Text style={styles.iconViewDetails}>
                          🎬 Export
                        </Text>
                      )}
                    </>
                  )}

                  {/* Action buttons */}
                  {!selectionMode && !isFolder && (
                    <View style={styles.iconViewActions}>
                      <TouchableOpacity
                        style={styles.iconViewActionButton}
                        onPress={() => setActionMenuVideo(item)}
                      >
                        <Text style={styles.iconViewActionText}>⋮</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconViewActionButton}
                        onPress={() => handleDelete(item)}
                      >
                        <Text style={styles.iconViewActionText}>
                          {markedForDeletion === `${item.id}_flash` ? '⚡️' : markedForDeletion === item.id ? '❌' : '🗑️'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Selection checkbox */}
                {selectionMode && !isFolder && (
                  <View style={styles.iconViewCheckbox}>
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                      {isSelected && <Text style={styles.checkboxCheck}>✓</Text>}
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          onViewableItemsChanged={({ viewableItems }) => {
            const visibleIds = new Set(viewableItems.map(item => item.item.id));
            setVisibleVideoIds(visibleIds);
          }}
          viewabilityConfig={{
            itemVisiblePercentThreshold: 50
          }}
        />
      )}

      {/* Grid View - Responsive grid layout */}
      {!loading && videos.length > 0 && viewMode === 'grid' && (
        <FlatList
          data={videos}
          keyExtractor={item => item.id}
          numColumns={gridSize}
          key={`grid-${gridSize}`} // Force re-render when gridSize changes
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item.id);
            const inlinePreviewUri = item.previewUri ?? item.uri;
            const isVisible = visibleVideoIds.has(item.id);
            const isFolder = item.isFolder ?? false;

            // Calculate item size
            const screenWidth = windowDimensions.width;
            const padding = 16;
            const gap = 16;
            const availableWidth = screenWidth - (padding * 2) - (gap * (gridSize - 1));
            const itemSize = Math.floor(availableWidth / gridSize);

            return (
              <TouchableOpacity
                style={[
                  styles.gridItem,
                  {
                    width: itemSize,
                    height: itemSize,
                    marginRight: ((videos.indexOf(item) + 1) % gridSize === 0) ? 0 : gap,
                    marginBottom: gap
                  },
                  isSelected && styles.gridItemSelected,
                  isFolder && styles.folderItem
                ]}
                onPress={() => handleSelect(item)}
                onLongPress={toggleSelectionMode}
              >
                {/* Video/image preview */}
                {isFolder ? (
                  <View style={[styles.folderIconContainer, { width: itemSize, height: itemSize }]}>
                    <Text style={[styles.folderIcon, { fontSize: itemSize * 0.4 }]}>📁</Text>
                  </View>
                ) : isImageItem(item) && inlinePreviewUri ? (
                  <Image source={{ uri: inlinePreviewUri }} style={styles.thumbnail} resizeMode="cover" />
                ) : inlinePreviewUri ? (
                  <PreviewVideoPlayer uri={inlinePreviewUri} isVisible={isVisible} />
                ) : item.thumbnail ? (
                  <Image
                    source={{ uri: item.thumbnail }}
                    style={styles.thumbnail}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.thumbnailPlaceholder}>
                    <Text style={styles.thumbnailIcon}>VID</Text>
                  </View>
                )}

                {/* Filename overlay */}
                <View style={styles.gridItemOverlay}>
                  <Text style={styles.gridItemFilename} numberOfLines={1}>
                    {isFolder ? item.wordTitle : item.filename}
                  </Text>
                </View>

                {/* Selection checkbox */}
                {selectionMode && !isFolder && (
                  <View style={styles.gridItemCheckbox}>
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                      {isSelected && <Text style={styles.checkboxCheck}>✓</Text>}
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          onViewableItemsChanged={({ viewableItems }) => {
            const visibleIds = new Set(viewableItems.map(item => item.item.id));
            setVisibleVideoIds(visibleIds);
          }}
          viewabilityConfig={{
            itemVisiblePercentThreshold: 50
          }}
        />
      )}

      {/* Import indicator */}
      {importing && (
        <View style={styles.importingOverlay}>
          <ActivityIndicator size="large" color="#ff9f6b" />
          <Text style={styles.importingText}>Importing video...</Text>
        </View>
      )}

      {/* Preview modal */}
      <Modal
        visible={previewVideo !== null}
        transparent
        animationType="fade"
        onRequestClose={closePreview}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={styles.previewModalBackdrop}>
          <View style={[
            styles.previewModalContent,
            IS_IPAD && isLandscape && styles.previewModalContentLandscape
          ]}>
            {previewVideo && (
              <>
                {/* Close button - top right */}
                <TouchableOpacity style={styles.previewCloseButton} onPress={closePreview}>
                  <Text style={styles.previewCloseButtonText}>❎</Text>
                </TouchableOpacity>

                <Text style={styles.previewModalTitle} numberOfLines={1}>
                  {previewVideo.filename}
                </Text>
                <Text style={styles.previewModalSubtitle}>
                  {previewVideo.width}×{previewVideo.height} • {previewVideo.duration > 0 ? formatDuration(previewVideo.duration) : 'Unknown duration'}
                </Text>
                <View style={styles.previewVideoWrapper}>
                  <ShortVideoPlayer
                    uri={previewVideo.previewUri ?? previewVideo.uri}
                    style={styles.previewVideo}
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay
                    isMuted
                    useNativeControls
                  />
                </View>
                <Text style={styles.previewHint}>Low-res preview playback</Text>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Action menu modal */}
      <Modal
        visible={actionMenuVideo !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMenuVideo(null)}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <TouchableOpacity
          style={[
            styles.actionMenuBackdrop,
            IS_IPAD && isLandscape && styles.actionMenuBackdropLandscape
          ]}
          activeOpacity={1}
          onPress={() => setActionMenuVideo(null)}
        >
          <View style={[
            styles.actionMenuPanel,
            IS_IPAD && isLandscape && styles.actionMenuPanelLandscape
          ]}>
            {actionMenuVideo && (
              <>
                <View style={styles.actionMenuHeader}>
                  <Text style={styles.actionMenuTitle} numberOfLines={1}>
                    {actionMenuVideo.filename}
                  </Text>
                  <Text style={styles.actionMenuSubtitle}>
                    {actionMenuVideo.width}×{actionMenuVideo.height} • {isImageItem(actionMenuVideo)
                      ? 'Image'
                      : actionMenuVideo.duration > 0
                        ? formatDuration(actionMenuVideo.duration)
                        : 'Unknown'}
                  </Text>
                </View>

                {!isImageItem(actionMenuVideo) && (
                  <TouchableOpacity
                    style={styles.actionMenuItem}
                    onPress={() => {
                      if (!actionMenuVideo) return;
                      const video = actionMenuVideo;
                      setActionMenuVideo(null);
                      navigation.navigate('VideoPreview', {
                        uri: video.uri,
                        filename: video.filename
                      });
                    }}
                  >
                    <Text style={styles.actionMenuIcon}>▶️</Text>
                    <Text style={styles.actionMenuText}>Preview</Text>
                  </TouchableOpacity>
                )}

                {!isImageItem(actionMenuVideo) && (
                  <TouchableOpacity
                    style={styles.actionMenuItem}
                    onPress={handleActionMenuOpenFramer}
                  >
                    <Text style={styles.actionMenuIcon}>🎬</Text>
                    <Text style={styles.actionMenuText}>Open in Framer</Text>
                  </TouchableOpacity>
                )}

                {!isImageItem(actionMenuVideo) && (
                  <TouchableOpacity
                    style={styles.actionMenuItem}
                    onPress={handleActionMenuOpenVideoEditor}
                  >
                    <Text style={styles.actionMenuIcon}>🎞️</Text>
                    <Text style={styles.actionMenuText}>Open in Video Editor</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={handleActionMenuSelect}
                >
                  <Text style={styles.actionMenuIcon}>✓</Text>
                  <Text style={styles.actionMenuText}>Select</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={handleActionMenuExport}
                >
                  <Text style={styles.actionMenuIcon}>📤</Text>
                  <Text style={styles.actionMenuText}>Export</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionMenuItem, styles.actionMenuItemDanger]}
                  onPress={handleActionMenuDelete}
                >
                  <Text style={styles.actionMenuIcon}>🗑️</Text>
                  <Text style={[styles.actionMenuText, styles.actionMenuTextDanger]}>Delete</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionMenuCancel}
                  onPress={() => setActionMenuVideo(null)}
                >
                  <Text style={styles.actionMenuCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333'
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
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  importButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ff9f6b',
    borderRadius: 20
  },
  importButtonText: {
    color: '#000',
    fontSize: 28,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  subtitle: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    fontFamily: 'vrtlfinal'
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    fontFamily: 'vrtlfinal'
  },
  emptySubtext: {
    color: '#888',
    fontSize: 14,
    fontFamily: 'vrtlfinal'
  },
  listContent: {
    padding: 16
  },
  videoItem: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333'
  },
  thumbnailContainer: {
    marginRight: 12
    // Width and height set dynamically based on isExport
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#000'
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center'
  },
  thumbnailIcon: {
    fontSize: 32
  },
  folderItem: {
    backgroundColor: '#2a2a0f',
    borderColor: '#ff9f6b'
  },
  folderIconContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#3a3a1f',
    justifyContent: 'center',
    alignItems: 'center'
  },
  folderIcon: {
    fontSize: 48
  },
  backButtonText: {
    color: '#ff9f6b',
    fontSize: 28,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  videoInfo: {
    flex: 1,
    justifyContent: 'center'
  },
  videoFilename: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  videoDetails: {
    color: '#888',
    fontSize: 12,
    marginBottom: 2,
    fontFamily: 'vrtlfinal'
  },
  videoDate: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'vrtlfinal'
  },
  deleteButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center'
  },
  deleteButtonText: {
    fontSize: 20,
    fontFamily: 'vrtlfinal'
  },
  importingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000
  },
  importingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
    fontFamily: 'vrtlfinal'
  },
  previewModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  previewModalContent: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#0a0a0a',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333'
  },
  previewModalTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  previewModalSubtitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 12,
    fontFamily: 'vrtlfinal'
  },
  previewVideoWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12
  },
  previewVideo: {
    width: '100%',
    height: '100%'
  },
  previewHint: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'vrtlfinal'
  },
  previewCloseButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  previewCloseButtonText: {
    fontSize: 24,
    fontFamily: 'vrtlfinal'
  },
  videoItemSelected: {
    borderColor: '#ff9f6b',
    borderWidth: 2,
    backgroundColor: '#2a1f1a'
  },
  checkboxContainer: {
    marginRight: 12,
    justifyContent: 'center'
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#666',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000'
  },
  checkboxSelected: {
    borderColor: '#ff9f6b',
    backgroundColor: '#ff9f6b'
  },
  checkboxCheck: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal'
  },
  actionsBar: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    backgroundColor: '#1a1a1a'
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: '#ff9f6b',
    borderRadius: 8,
    alignItems: 'center'
  },
  actionButtonDanger: {
    backgroundColor: '#ff6b6b'
  },
  actionButtonText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  actionMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    padding: 16
  },
  actionMenuPanel: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333'
  },
  actionMenuHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    backgroundColor: '#0a0a0a'
  },
  actionMenuTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  actionMenuSubtitle: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'vrtlfinal'
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a'
  },
  actionMenuItemDanger: {
    backgroundColor: '#1a0a0a'
  },
  actionMenuIcon: {
    fontSize: 24,
    marginRight: 12,
    width: 32,
    textAlign: 'center'
  },
  actionMenuText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    fontFamily: 'vrtlfinal'
  },
  actionMenuTextDanger: {
    color: '#ff6b6b'
  },
  actionMenuCancel: {
    padding: 16,
    backgroundColor: '#0a0a0a',
    alignItems: 'center'
  },
  actionMenuCancelText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  // View mode picker styles
  viewModePicker: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8
  },
  viewModeButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333'
  },
  viewModeButtonActive: {
    backgroundColor: '#ff9f6b',
    borderColor: '#ff9f6b'
  },
  viewModeButtonText: {
    fontSize: 24,
    color: '#888'
  },
  viewModeButtonTextActive: {
    color: '#000'
  },
  // Grid size slider styles
  gridSizeSliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    gap: 12
  },
  gridSizeLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'vrtlfinal',
    minWidth: 70
  },
  gridSizeSlider: {
    flex: 1,
    height: 40
  },
  gridSizeValue: {
    color: '#ff9f6b',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'vrtlfinal',
    minWidth: 30,
    textAlign: 'center'
  },
  // Icon view styles
  iconViewItem: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden'
  },
  iconViewItemSelected: {
    borderColor: '#ff9f6b',
    borderWidth: 2,
    backgroundColor: '#2a1f1a'
  },
  iconViewImageContainer: {
    width: '45%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center'
  },
  iconViewInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between'
  },
  iconViewFilename: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    fontFamily: 'vrtlfinal'
  },
  iconViewDetails: {
    color: '#888',
    fontSize: 13,
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  iconViewActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8
  },
  iconViewActionButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333'
  },
  iconViewActionText: {
    fontSize: 20
  },
  iconViewCheckbox: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10
  },
  // Grid view styles
  gridContent: {
    padding: 16
  },
  gridItem: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333'
  },
  gridItemSelected: {
    borderColor: '#ff9f6b',
    borderWidth: 2
  },
  gridItemOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 8
  },
  gridItemFilename: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  gridItemCheckbox: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10
  },
  // iPad landscape styles
  actionMenuBackdropLandscape: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  actionMenuPanelLandscape: {
    width: '70%',
    maxWidth: 600,
    alignSelf: 'center'
  },
  previewModalContentLandscape: {
    maxWidth: 700
  }
});
