/**
 * Wording Completion Overlay
 *
 * Displays a grid of all letter videos playing in sync
 * Shows export progress and final composed video
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Animated, Dimensions, Platform, ScrollView } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

type LetterVideo = {
  letter: string;
  videoPath: string;
};

type CompletionOverlayProps = {
  visible: boolean;
  word: string;
  videoPath: string; // Final stitched video
  letterVideos: LetterVideo[]; // Individual letter videos
  exportProgress: number; // 0-100 export progress
  isExporting: boolean; // True while exporting final composition
  onClose: () => void;
  onViewFolder: () => void;
  onExportComposition: () => void; // Called when user clicks "Export All"
};

const CompletionOverlay: React.FC<CompletionOverlayProps> = ({
  visible,
  word,
  videoPath,
  letterVideos,
  exportProgress,
  isExporting,
  onClose,
  onViewFolder,
  onExportComposition
}) => {
  const [videoExists, setVideoExists] = useState(false);
  const scaleAnim = React.useRef(new Animated.Value(0)).current;

  // Check if final video exists
  useEffect(() => {
    const checkVideo = async () => {
      if (!videoPath) {
        setVideoExists(false);
        return;
      }

      try {
        const cleanPath = videoPath.replace(/^file:\/\//, '');
        const info = await FileSystem.getInfoAsync(cleanPath);
        setVideoExists(info.exists);
      } catch (error) {
        console.error('[CompletionOverlay] Failed to check video:', error);
        setVideoExists(false);
      }
    };

    if (visible && videoPath) {
      checkVideo();
    }
  }, [visible, videoPath]);

  // Entrance animation
  useEffect(() => {
    if (visible) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 20,
        friction: 7,
        useNativeDriver: true
      }).start();
    } else {
      scaleAnim.setValue(0);
    }
  }, [visible]);

  // Calculate cell size to fit all letters in one row
  // Screen width - container padding - grid padding - gaps between cells
  const availableWidth = SCREEN_WIDTH * 0.9 * 0.95; // 90% container, 95% of that for grid content
  const numLetters = letterVideos?.length || 0;
  const gapSize = 4;
  const totalGaps = Math.max(0, numLetters - 1) * gapSize;
  const cellSize = numLetters > 0
    ? Math.floor((availableWidth - totalGaps - 8) / numLetters) // 8 for grid padding
    : 128;

  // Cap at reasonable min/max sizes
  const finalCellSize = Math.max(48, Math.min(cellSize, 128));


  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.container, { transform: [{ scale: scaleAnim }] }]}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {/* Header */}
            <Text style={styles.celebrationIcon}>🎉</Text>
            <Text style={styles.title}>Complete!</Text>
            <Text style={styles.word}>{word}</Text>

            {/* Grid of letter videos - single horizontal row */}
            {!isExporting && letterVideos && letterVideos.length > 0 && (
              <View style={styles.gridContainer}>
                <Text style={styles.gridLabel}>Your Letters</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalScrollContent}
                >
                  <View style={styles.grid}>
                    {letterVideos.map((letterVideo, index) => (
                      <View
                        key={index}
                        style={[
                          styles.gridCell,
                          {
                            width: finalCellSize,
                            height: finalCellSize
                          }
                        ]}
                      >
                      <View style={styles.letterLabel}>
                        <Text style={styles.letterLabelText}>{letterVideo.letter}</Text>
                      </View>
                      {letterVideo.videoPath ? (
                        <Video
                          source={{ uri: letterVideo.videoPath }}
                          style={styles.gridVideo}
                          resizeMode={ResizeMode.COVER}
                          shouldPlay
                          isLooping
                          isMuted
                          useNativeControls={false}
                        />
                      ) : (
                        <View style={styles.gridPlaceholder}>
                          <Text style={styles.gridPlaceholderText}>?</Text>
                        </View>
                      )}
                    </View>
                  ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* Export progress */}
            {isExporting && (
              <View style={styles.exportingContainer}>
                <Text style={styles.exportingText}>Creating composition...</Text>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${exportProgress}%` }]} />
                </View>
                <Text style={styles.progressText}>{exportProgress.toFixed(0)}%</Text>
              </View>
            )}

            {/* Final video preview */}
            {videoExists && videoPath && !isExporting && (
              <View style={styles.finalVideoContainer}>
                <Text style={styles.finalVideoLabel}>Final Composition</Text>
                <Video
                  source={{ uri: videoPath }}
                  style={styles.finalVideo}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay
                  isLooping
                  useNativeControls={false}
                />
              </View>
            )}

            {/* Action buttons */}
            <View style={styles.buttonContainer}>
              {!isExporting && !videoExists && (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={onExportComposition}
                >
                  <Text style={styles.primaryButtonText}>Export All ✨</Text>
                </TouchableOpacity>
              )}

              {videoExists && (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={onViewFolder}
                >
                  <Text style={styles.primaryButtonText}>View in Library 📂</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={onClose}
              >
                <Text style={styles.secondaryButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  container: {
    width: '90%',
    maxWidth: 600,
    maxHeight: '90%',
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#333',
  },
  scrollContent: {
    padding: 24,
    alignItems: 'center',
    gap: 16
  },
  celebrationIcon: {
    fontSize: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center'
  },
  word: {
    fontSize: 28,
    fontWeight: '900',
    color: '#4a9eff',
    textAlign: 'center',
    marginBottom: 8
  },
  gridContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 12
  },
  gridLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  horizontalScrollContent: {
    paddingHorizontal: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'nowrap', // CRITICAL: Keep all letters in one row
    gap: 4,
    backgroundColor: '#000',
    padding: 4,
    borderRadius: 12,
    alignItems: 'center',
  },
  gridCell: {
    position: 'relative',
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#444',
  },
  letterLabel: {
    position: 'absolute',
    top: 4,
    left: 4,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  letterLabelText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  gridVideo: {
    width: '100%',
    height: '100%',
  },
  gridPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#333',
  },
  gridPlaceholderText: {
    fontSize: 24,
    color: '#666',
  },
  exportingContainer: {
    width: '100%',
    paddingVertical: 32,
    alignItems: 'center',
    gap: 16,
  },
  exportingText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4a9eff',
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
  },
  finalVideoContainer: {
    width: '100%',
    gap: 8,
  },
  finalVideoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  finalVideo: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#4a9eff'
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
    marginTop: 8
  },
  primaryButton: {
    backgroundColor: '#4a9eff',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center'
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff'
  },
  secondaryButton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444'
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff'
  }
});

export default CompletionOverlay;
