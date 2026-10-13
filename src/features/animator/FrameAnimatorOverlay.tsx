// @ts-nocheck
import React from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Image,
  ActivityIndicator,
  StyleSheet,
  Animated as RNAnimated,
  Platform,
  Dimensions,
  Keyboard
} from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { runOnJS } from 'react-native-reanimated';
import BrushEmojiIcon from '../../components/BrushEmojiIcon';
import PaintCanvas from '../../workspace/PaintCanvas';
import { CustomOverlayHelper } from '../../components/CustomOverlay';
import type { Stroke } from '../../state/PaintingContext';
import type { DailyPrompt } from '../../types/dailyPrompt';
import { formatPrompt, } from '../../types/dailyPrompt';
import { getTopicMetadata } from '../../lib/dailyTopics';
import {
  canUploadChallengeEarly,
  getChallengeStrokesRemaining,
} from '../../lib/challengeUploadEligibility';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: screenWidthModule, height: screenHeightModule } = Dimensions.get('window');
const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;
const CANVAS_RATIO = 1;
const LARGE_HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 } as const;
/** Extra reach around the sprint-timer ✕ so a Pencil tip never misses it. */
const TIMER_CLOSE_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;
const PROMPT_CARD_WIDTH = Math.min(320, screenWidthModule * 0.78);
const PROMPT_CARD_HEIGHT = 60;
const PROMPT_CARD_GAP = 8;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnimationFrame {
  id: string;
  strokes: Stroke[];
  timestamp: number;
  thumbnail?: string;
  renderedImageUri?: string;
}

export interface OnionSkinning {
  enabled: boolean;
  before: number;
  after: number;
  opacity: number;
  color: string;
}

export interface FrameAnimatorOverlayProps {
  // Frame state
  frameMode: boolean;
  frames: AnimationFrame[];
  setFrames: (frames: AnimationFrame[]) => void;
  currentFrameIndex: number;
  setCurrentFrameIndex: (index: number) => void;
  isPlayingFrames: boolean;
  frameTimelineVisible: boolean;
  frameTimelineScrollRef: React.RefObject<ScrollView | null>;
  selectedFrameForMove: number | null;
  setSelectedFrameForMove: (index: number | null) => void;
  deleteConfirmActive: boolean;
  deleteAllConfirmActive: boolean;
  showDeleteAllPrompt: boolean;
  regeneratingThumbnails: boolean;
  thumbnailsRegenerated: number;
  totalThumbnailsToRegenerate: number;

  // Export / playback state
  exportFps: number;
  setExportFps: (fps: number) => void;
  activeFrameLength: number;
  setActiveFrameLength: (length: number) => void;
  framePaintLength: number;
  setFramePaintLength: (length: number) => void;
  onionSkinning: OnionSkinning;
  setOnionSkinning: (updater: ((prev: OnionSkinning) => OnionSkinning) | OnionSkinning) => void;
  cloneCount: string;
  setCloneCount: (count: string) => void;
  exportFormat: 'mov' | 'gif' | 'png';
  setExportFormat: (format: 'mov' | 'gif' | 'png') => void;
  exportTransparent: boolean;
  setExportTransparent: (transparent: boolean) => void;
  exportLoopMode: 'normal' | 'pingpong' | 'reverse';
  setExportLoopMode: (mode: 'normal' | 'pingpong' | 'reverse') => void;
  exportPreviewPlaying: boolean;
  setExportPreviewPlaying: (playing: boolean) => void;
  exportPreviewFrameIndex: number;
  setExportPreviewFrameIndex: (index: number) => void;

  // Modal visibility
  addFrameModalVisible: boolean;
  setAddFrameModalVisible: (visible: boolean) => void;
  frameSettingsVisible: boolean;
  setFrameSettingsVisible: (visible: boolean) => void;
  animationExportVisible: boolean;
  setAnimationExportVisible: (visible: boolean) => void;

  // Handlers
  toggleFrameMode: (enable: boolean) => Promise<void> | void;
  toggleFramePlayback: () => Promise<void> | void;
  saveCurrentFrame: () => Promise<void>;
  regenerateAllThumbnails: () => Promise<void>;
  deleteCurrentFrame: () => void;
  deleteAllFrames: () => void;
  addNewFrame: (duplicate: boolean) => Promise<void> | void;
  switchToFrame: (index: number) => Promise<void> | void;
  moveFrame: (from: number, to: number) => void;
  handleOpenEmojiPicker: () => void;
  handleAnimationExport: () => Promise<void> | void;
  handleSaveAnimation: () => Promise<void> | void;

  // Brush
  brushEmoji: string;

  // Layout
  isLandscape: boolean;
  insets: { top: number; bottom: number; left: number; right: number };
  screenWidth: number;
  screenHeight: number;
  canvasSize: number;

  // Challenge overlay
  activeChallenge: { prompt: DailyPrompt; endsAt: number } | null;
  viewShotLayout: { x: number; y: number; width: number; height: number } | null;
  challengeTimerGesture: any;
  challengeTimerStyle: any;
  /** Tap gesture for the timer's ✕. Built in PaintScreen next to the pan/pinch
   *  gestures it has to out-prioritise (see the Pencil note there). */
  challengeTimerCloseGesture: any;
  challengeStrokeCount: number;
  showChallengeCancelConfirmation: () => void;
  challengeExpired: boolean;
  challengeTimeLabel: string;
  mysteryTopicSelected: boolean;
  mysteryTopic: string | null;
  infoLanguage: string;

  // Prompt overlay
  wording: { isWordingActive: () => boolean };
  promptOverlayVisible: boolean;
  promptOverlayDismissed: boolean;
  promptCards: DailyPrompt[];
  promptOverlayMetrics: { top: number; left: number; width: number; height: number } | null;
  getPromptCardKey: (prompt: DailyPrompt) => string;
  getPromptAnim: (key: string) => { entry: RNAnimated.Value; exit: RNAnimated.Value };
  promptExitVectorRef: React.RefObject<{ x: number; y: number }>;
  isIpadLandscape: boolean;
  isWidePortraitTablet: boolean;
  handlePromptCardPress: (prompt: DailyPrompt) => void;
  uploadedPromptTopics: Set<string>;
  challengeMinutesForDay: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const FrameAnimatorOverlay: React.FC<FrameAnimatorOverlayProps> = ({
  frameMode,
  frames,
  setFrames,
  currentFrameIndex,
  setCurrentFrameIndex,
  isPlayingFrames,
  frameTimelineVisible,
  frameTimelineScrollRef,
  selectedFrameForMove,
  setSelectedFrameForMove,
  deleteConfirmActive,
  deleteAllConfirmActive,
  showDeleteAllPrompt,
  regeneratingThumbnails,
  thumbnailsRegenerated,
  totalThumbnailsToRegenerate,
  exportFps,
  setExportFps,
  activeFrameLength,
  setActiveFrameLength,
  framePaintLength,
  setFramePaintLength,
  onionSkinning,
  setOnionSkinning,
  cloneCount,
  setCloneCount,
  exportFormat,
  setExportFormat,
  exportTransparent,
  setExportTransparent,
  exportLoopMode,
  setExportLoopMode,
  exportPreviewPlaying,
  setExportPreviewPlaying,
  exportPreviewFrameIndex,
  setExportPreviewFrameIndex,
  addFrameModalVisible,
  setAddFrameModalVisible,
  frameSettingsVisible,
  setFrameSettingsVisible,
  animationExportVisible,
  setAnimationExportVisible,
  toggleFrameMode,
  toggleFramePlayback,
  saveCurrentFrame,
  regenerateAllThumbnails,
  deleteCurrentFrame,
  deleteAllFrames,
  addNewFrame,
  switchToFrame,
  moveFrame,
  handleOpenEmojiPicker,
  handleAnimationExport,
  handleSaveAnimation,
  brushEmoji,
  isLandscape,
  insets,
  screenWidth,
  screenHeight,
  canvasSize,
  activeChallenge,
  viewShotLayout,
  challengeTimerGesture,
  challengeTimerStyle,
  challengeTimerCloseGesture,
  challengeStrokeCount,
  showChallengeCancelConfirmation,
  challengeExpired,
  challengeTimeLabel,
  mysteryTopicSelected,
  mysteryTopic,
  infoLanguage,
  wording,
  promptOverlayVisible,
  promptOverlayDismissed,
  promptCards,
  promptOverlayMetrics,
  getPromptCardKey,
  getPromptAnim,
  promptExitVectorRef,
  isIpadLandscape,
  isWidePortraitTablet,
  handlePromptCardPress,
  uploadedPromptTopics,
  challengeMinutesForDay,
}) => {
  // Derived values
  const paintLengthMax = Math.max(1, frames.length || 1);
  const clampedPaintLength = Math.min(framePaintLength, paintLengthMax);


  return (
    <>
      {/* Frame-by-frame controls overlay */}
      {frameMode && (
        <View style={[
          styles.frameControlsOverlay,
          IS_IPAD && isLandscape && {
            top: insets.top + 80 + (screenHeight * 0.02),
            bottom: 'auto',
            left: 10 + (screenWidth * 0.02),
            right: 'auto',
            width: 90,
            backgroundColor: 'rgba(0,0,0,0.9)',
            borderRadius: 20,
            paddingVertical: 16,
            paddingHorizontal: 8,
            paddingBottom: 16,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.5,
            shadowRadius: 12
          },
          IS_IPAD && !isLandscape && {
            bottom: screenHeight * 0.03,
            transform: [{ scale: 1.1 }]
          }
        ]} pointerEvents="box-none">
          {/* Control buttons row */}
          <View style={[
            styles.frameControlsRow,
            IS_IPAD && isLandscape && { paddingHorizontal: 0, paddingVertical: 0 }
          ]} pointerEvents="box-none">
            <View style={[
              styles.frameControlButtonsGroup,
              IS_IPAD && isLandscape && {
                flexDirection: 'column',
                gap: 12
              }
            ]} pointerEvents="auto">
              {/* In landscape: Close at top, Play at bottom. Otherwise: Play first */}
              {IS_IPAD && isLandscape ? (
                <>
                  <TouchableOpacity
                    onPress={() => toggleFrameMode(false)}
                    style={[styles.frameControlButton, IS_IPAD && isLandscape && { width: 70, height: 70, borderRadius: 35 }]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={[styles.frameControlButtonText, { fontSize: 30 }]}>❎</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={async () => {
                      await saveCurrentFrame();
                      await regenerateAllThumbnails();
                      setAnimationExportVisible(true);
                    }}
                    style={[styles.frameControlButton, { backgroundColor: '#2196F3' }, IS_IPAD && isLandscape && { width: 70, height: 70, borderRadius: 35 }]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={[styles.frameControlButtonText, { fontSize: 30 }]}>📤</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={async () => {
                      await saveCurrentFrame();
                      setFrameSettingsVisible(true);
                    }}
                    style={[styles.frameControlButton, IS_IPAD && isLandscape && { width: 70, height: 70, borderRadius: 35 }]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={[styles.frameControlButtonText, { fontSize: 30 }]}>⚙️</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={deleteCurrentFrame}
                    style={[
                      styles.frameControlButton,
                      deleteConfirmActive && { backgroundColor: '#ff3b30' },
                      IS_IPAD && isLandscape && { width: 70, height: 70, borderRadius: 35 }
                    ]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={[styles.frameControlButtonText, { fontSize: 30 }]}>🗑️</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={async () => {
                      await saveCurrentFrame();
                      setOnionSkinning(prev => ({ ...prev, enabled: !prev.enabled }));
                    }}
                    style={[
                      styles.frameControlButton,
                      onionSkinning.enabled && styles.frameControlButtonActive,
                      IS_IPAD && isLandscape && { width: 70, height: 70, borderRadius: 35 }
                    ]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={[styles.frameControlButtonText, { fontSize: 30 }]}>🧅</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => addNewFrame(false)}
                    style={[styles.frameControlButton, IS_IPAD && isLandscape && { width: 70, height: 70, borderRadius: 35 }]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={[styles.frameControlButtonText, { fontSize: 30 }]}>➕</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleOpenEmojiPicker}
                    style={[styles.frameControlButton, IS_IPAD && isLandscape && { width: 70, height: 70, borderRadius: 35 }]}
                    hitSlop={LARGE_HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel="Choose brush emoji"
                  >
                    <BrushEmojiIcon
                      emoji={brushEmoji}
                      size={30}
                      textStyle={[styles.frameControlButtonText, { fontSize: 30 }]}
                      imageStyle={{ backgroundColor: 'rgba(0,0,0,0.08)' }}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={toggleFramePlayback}
                    style={[
                      styles.frameControlButton,
                      styles.frameControlButtonPlay,
                      IS_IPAD && isLandscape && { width: 70, height: 70, borderRadius: 35 }
                    ]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={[styles.frameControlButtonText, { fontSize: 30 }]}>{isPlayingFrames ? '⏸️' : '▶️'}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={toggleFramePlayback}
                    style={[styles.frameControlButton, styles.frameControlButtonPlay]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={styles.frameControlButtonText}>{isPlayingFrames ? '⏸️' : '▶️'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleOpenEmojiPicker}
                    style={styles.frameControlButton}
                    hitSlop={LARGE_HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel="Choose brush emoji"
                  >
                    <BrushEmojiIcon
                      emoji={brushEmoji}
                      size={24}
                      textStyle={styles.frameControlButtonText}
                      imageStyle={{ backgroundColor: 'rgba(0,0,0,0.08)' }}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => addNewFrame(false)}
                    style={styles.frameControlButton}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={styles.frameControlButtonText}>➕</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={async () => {
                      await saveCurrentFrame();
                      setOnionSkinning(prev => ({ ...prev, enabled: !prev.enabled }));
                    }}
                    style={[styles.frameControlButton, onionSkinning.enabled && styles.frameControlButtonActive]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={styles.frameControlButtonText}>🧅</Text>
                  </TouchableOpacity>

                  <View style={styles.frameControlDeleteStack}>
                    {showDeleteAllPrompt && (
                      <TouchableOpacity
                        onPress={deleteAllFrames}
                        style={[
                          styles.frameControlAllButton,
                          deleteAllConfirmActive && { backgroundColor: '#ff3b30' }
                        ]}
                        hitSlop={LARGE_HIT_SLOP}
                      >
                        <Text style={styles.frameControlAllButtonText}>ALL</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      onPress={deleteCurrentFrame}
                      style={[styles.frameControlButton, deleteConfirmActive && { backgroundColor: '#ff3b30' }]}
                      hitSlop={LARGE_HIT_SLOP}
                    >
                      <Text style={styles.frameControlButtonText}>🗑️</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    onPress={async () => {
                      await saveCurrentFrame();
                      setFrameSettingsVisible(true);
                    }}
                    style={styles.frameControlButton}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={styles.frameControlButtonText}>⚙️</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={async () => {
                      await saveCurrentFrame();
                      await regenerateAllThumbnails();
                      setAnimationExportVisible(true);
                    }}
                    style={[styles.frameControlButton, { backgroundColor: '#2196F3' }]}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={styles.frameControlButtonText}>📤</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => toggleFrameMode(false)}
                    style={styles.frameControlButton}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={styles.frameControlButtonText}>❎</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Frame timeline preview panel - separate panel at bottom center */}
      {frameMode && frameTimelineVisible && (
        <View style={{
          position: 'absolute',
          bottom: IS_IPAD && !isLandscape ? insets.bottom + 10 + screenHeight * 0.10 : insets.bottom + 10,
          left: 0,
          right: 0,
          alignItems: 'center',
          zIndex: 998,
          pointerEvents: 'box-none'
        }}>
          <View style={{
            backgroundColor: 'rgba(0,0,0,0.9)',
            borderRadius: 16,
            paddingVertical: IS_IPAD && isLandscape ? 10 : 12,
            paddingHorizontal: IS_IPAD && isLandscape ? 12 : 16,
            maxWidth: '90%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.5,
            shadowRadius: 12
          }} pointerEvents="auto">
            {/* Thumbnail regeneration progress indicator */}
            {regeneratingThumbnails && (
              <View style={{
                position: 'absolute',
                top: -30,
                left: 20,
                right: 20,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                borderRadius: 8,
                padding: 8,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                zIndex: 1000
              }}>
                <ActivityIndicator size="small" color="#4CAF50" />
                <Text style={{ color: '#fff', fontSize: 12 }}>
                  Generating thumbnails... {thumbnailsRegenerated}/{totalThumbnailsToRegenerate}
                </Text>
              </View>
            )}
            <ScrollView
              ref={frameTimelineScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.frameTimeline}
              contentContainerStyle={[
                styles.frameTimelineContent,
                IS_IPAD && isLandscape && {
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  gap: 12
                }
              ]}
            >
              {frames.map((frame, index) => (
                <View key={frame.id} style={{ alignItems: 'center' }}>
                  <TouchableOpacity
                    onPress={() => {
                      // Click switches to this frame
                      switchToFrame(index);
                    }}
                    onLongPress={() => {
                      // Long press shows options menu
                      setSelectedFrameForMove(selectedFrameForMove === index ? null : index);
                    }}
                    style={[
                      styles.frameThumb,
                      index === currentFrameIndex && styles.frameThumbActive,
                      selectedFrameForMove === index && { transform: [{ scale: 1.05 }] }
                    ]}
                    activeOpacity={0.7}
                  >
                    <View style={[
                      styles.frameThumbInner,
                      index === currentFrameIndex && { borderColor: '#ff6b6b', borderWidth: 4 },
                      IS_IPAD && isLandscape && { width: 51, height: 51 }
                    ]}>
                      {/* Mini preview image (optimized for memory) */}
                      {frame.thumbnail ? (
                        <Image
                          source={{ uri: frame.thumbnail }}
                          style={styles.frameThumbImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={{ backgroundColor: '#1a1a1a', flex: 1 }} />
                      )}
                      {/* Small frame number overlaid on preview */}
                      <Text style={styles.frameThumbNumber}>{index + 1}</Text>
                    </View>
                  </TouchableOpacity>
                  {/* Options menu when frame is long-pressed */}
                  {selectedFrameForMove === index && (
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, alignItems: 'center' }}>
                      <TouchableOpacity
                        onPress={() => {
                          moveFrame(index, index - 1);
                        }}
                        disabled={index === 0}
                        style={{
                          backgroundColor: index === 0 ? '#333' : '#4CAF50',
                          borderRadius: 6,
                          paddingHorizontal: 10,
                          paddingVertical: 6
                        }}
                      >
                        <Text style={{ fontSize: 14 }}>⬅️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedFrameForMove(null);
                          addNewFrame(true); // Duplicate this frame
                        }}
                        style={{
                          backgroundColor: '#2196F3',
                          borderRadius: 6,
                          paddingHorizontal: 10,
                          paddingVertical: 6
                        }}
                      >
                        <Text style={{ fontSize: 14 }}>📋</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          moveFrame(index, index + 1);
                        }}
                        disabled={index === frames.length - 1}
                        style={{
                          backgroundColor: index === frames.length - 1 ? '#333' : '#4CAF50',
                          borderRadius: 6,
                          paddingHorizontal: 10,
                          paddingVertical: 6
                        }}
                      >
                        <Text style={{ fontSize: 14 }}>➡️</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      {/* FPS and Length Sliders - positioned at TOP of screen */}
      {frameMode && (
        <View style={styles.playbackSlidersContainer} pointerEvents="auto">
          <View style={styles.playbackSliderRow}>
            <Text style={styles.playbackSliderLabel}>FPS: {exportFps}</Text>
            <Slider
              style={styles.playbackSlider}
              minimumValue={1}
              maximumValue={30}
              step={1}
              value={exportFps}
              onValueChange={setExportFps}
              minimumTrackTintColor="#4dd0e1"
              maximumTrackTintColor="#4a4a4a"
              thumbTintColor="#4dd0e1"
            />
          </View>
          <View style={styles.playbackSliderRow}>
            <Text style={styles.playbackSliderLabel}>Length: {activeFrameLength}</Text>
            <Slider
              style={styles.playbackSlider}
              minimumValue={1}
              maximumValue={60}
              step={1}
              value={activeFrameLength}
              onValueChange={setActiveFrameLength}
              minimumTrackTintColor="#ff6b6b"
              maximumTrackTintColor="#4a4a4a"
              thumbTintColor="#ff6b6b"
            />
          </View>
        </View>
      )}

      {/* Add Frame Modal */}
      <Modal
        visible={addFrameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddFrameModalVisible(false)}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' }}
          activeOpacity={1}
          onPress={() => setAddFrameModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={{
              backgroundColor: '#1a1a1a',
              borderRadius: 16,
              padding: 24,
              width: 300,
              borderWidth: 1,
              borderColor: '#333'
            }}>
              <Text style={{
                color: '#fff',
                fontSize: 20,
                fontWeight: 'bold',
                fontFamily: 'vrtlfinal',
                textAlign: 'center',
                marginBottom: 20
              }}>Add Frame</Text>
              <TouchableOpacity
                onPress={() => {
                  setAddFrameModalVisible(false);
                  addNewFrame(false);
                }}
                style={{
                  backgroundColor: 'rgba(76,175,80,0.15)',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 12,
                  borderWidth: 2,
                  borderColor: '#4CAF50'
                }}
              >
                <Text style={{
                  fontSize: 24,
                  textAlign: 'center',
                  marginBottom: 4
                }}>➕</Text>
                <Text style={{
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: '600',
                  fontFamily: 'vrtlfinal',
                  textAlign: 'center'
                }}>New Blank Frame</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setAddFrameModalVisible(false);
                  addNewFrame(true);
                }}
                style={{
                  backgroundColor: 'rgba(76,175,80,0.15)',
                  borderRadius: 12,
                  padding: 16,
                  borderWidth: 2,
                  borderColor: '#4CAF50'
                }}
              >
                <Text style={{
                  fontSize: 24,
                  textAlign: 'center',
                  marginBottom: 4
                }}>📋</Text>
                <Text style={{
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: '600',
                  fontFamily: 'vrtlfinal',
                  textAlign: 'center'
                }}>Duplicate Current Frame</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Frame Settings Modal */}
      <Modal
        visible={frameSettingsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFrameSettingsVisible(false)}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' }}
          activeOpacity={1}
          onPress={() => setFrameSettingsVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={{
              backgroundColor: '#1a1a1a',
              borderRadius: 16,
              padding: 24,
              width: IS_IPAD ? 680 : 340,
              borderWidth: 1,
              borderColor: '#333'
            }}>
              <Text style={{
                color: '#fff',
                fontSize: 20,
                fontWeight: 'bold',
                fontFamily: 'vrtlfinal',
                textAlign: 'center',
                marginBottom: 20
              }}>⚙️ Animation Settings</Text>

              {/* Total Frame Count */}
              <View style={{ marginBottom: 20 }}>
                <Text style={{
                  color: '#888',
                  fontSize: 14,
                  fontFamily: 'vrtlfinal',
                  marginBottom: 8
                }}>Total Frames: {frames.length}</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <TextInput
                    style={{
                      flex: 1,
                      backgroundColor: '#2a2a2a',
                      borderRadius: 8,
                      borderWidth: 2,
                      borderColor: '#4CAF50',
                      color: '#fff',
                      fontSize: 16,
                      fontFamily: 'vrtlfinal',
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      textAlign: 'center'
                    }}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    value={frames.length.toString()}
                    onChangeText={(text) => {
                      const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
                      if (Number.isFinite(num) && num > 0 && num <= 1000) {
                        const currentCount = frames.length;
                        if (num > currentCount) {
                          // Add new empty frames
                          const newFrames = [...frames];
                          for (let i = 0; i < num - currentCount; i++) {
                            newFrames.push({
                              id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                              strokes: [],
                              timestamp: Date.now()
                            });
                          }
                          setFrames(newFrames);
                        } else if (num < currentCount) {
                          // Remove frames from the end
                          setFrames(frames.slice(0, num));
                          // Adjust current index if needed
                          if (currentFrameIndex >= num) {
                            setCurrentFrameIndex(num - 1);
                          }
                        }
                      }
                    }}
                    onSubmitEditing={() => Keyboard.dismiss()}
                    onBlur={() => Keyboard.dismiss()}
                    placeholder={frames.length.toString()}
                  />
                  <Text style={{
                    color: '#888',
                    fontSize: 12,
                    fontFamily: 'vrtlfinal'
                  }}>(1-1000)</Text>
                </View>
                <Text style={{
                  color: '#666',
                  fontSize: 11,
                  fontFamily: 'vrtlfinal',
                  marginTop: 6,
                  textAlign: 'center'
                }}>Set higher number to auto-create empty frames</Text>
              </View>

              {/* Playback speed & paint length */}
              <View style={{ marginBottom: 20 }}>
                <View style={{
                  flexDirection: IS_IPAD ? 'row' : 'column',
                  gap: 16
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      color: '#888',
                      fontSize: 14,
                      fontFamily: 'vrtlfinal',
                      marginBottom: 8
                    }}>Playback Speed (FPS): {exportFps}</Text>
                    <Slider
                      style={{ width: '100%', height: 40 }}
                      minimumValue={1}
                      maximumValue={180}
                      step={1}
                      value={exportFps}
                      onValueChange={setExportFps}
                      minimumTrackTintColor="#4CAF50"
                      maximumTrackTintColor="#333"
                      thumbTintColor="#4CAF50"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      color: '#888',
                      fontSize: 14,
                      fontFamily: 'vrtlfinal',
                      marginBottom: 8
                    }}>Paint Length (frames): {clampedPaintLength}/{paintLengthMax}</Text>
                    <Slider
                      style={{ width: '100%', height: 40 }}
                      minimumValue={1}
                      maximumValue={paintLengthMax}
                      step={1}
                      value={clampedPaintLength}
                      onValueChange={(value) => {
                        const next = Math.max(1, Math.min(Math.round(value), paintLengthMax));
                        setFramePaintLength(next);
                      }}
                      minimumTrackTintColor="#ff9f6b"
                      maximumTrackTintColor="#333"
                      thumbTintColor="#ff9f6b"
                    />
                    <Text style={{
                      color: '#666',
                      fontSize: 11,
                      fontFamily: 'vrtlfinal',
                      marginTop: 6
                    }}>Sets how many frames a live stroke lasts while painting in play mode (default 3)</Text>
                  </View>
                </View>
              </View>

              {/* Onion Skinning - Previous Frames */}
              <View style={{ marginBottom: 20 }}>
                <Text style={{
                  color: '#888',
                  fontSize: 14,
                  fontFamily: 'vrtlfinal',
                  marginBottom: 8
                }}>Onion Skin - Previous Frames: {onionSkinning.before}</Text>
                <Slider
                  style={{ width: '100%', height: 40 }}
                  minimumValue={0}
                  maximumValue={5}
                  step={1}
                  value={onionSkinning.before}
                  onValueChange={(val) => setOnionSkinning(prev => ({ ...prev, before: val }))}
                  minimumTrackTintColor="#ff9f6b"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#ff9f6b"
                />
              </View>

              {/* Onion Skinning - Next Frames */}
              <View style={{ marginBottom: 20 }}>
                <Text style={{
                  color: '#888',
                  fontSize: 14,
                  fontFamily: 'vrtlfinal',
                  marginBottom: 8
                }}>Onion Skin - Next Frames: {onionSkinning.after}</Text>
                <Slider
                  style={{ width: '100%', height: 40 }}
                  minimumValue={0}
                  maximumValue={5}
                  step={1}
                  value={onionSkinning.after}
                  onValueChange={(val) => setOnionSkinning(prev => ({ ...prev, after: val }))}
                  minimumTrackTintColor="#ff9f6b"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#ff9f6b"
                />
              </View>

              {/* Onion Opacity */}
              <View style={{ marginBottom: 20 }}>
                <Text style={{
                  color: '#888',
                  fontSize: 14,
                  fontFamily: 'vrtlfinal',
                  marginBottom: 8
                }}>Onion Skin Opacity: {Math.round(onionSkinning.opacity * 100)}%</Text>
                <Slider
                  style={{ width: '100%', height: 40 }}
                  minimumValue={0.1}
                  maximumValue={0.8}
                  step={0.05}
                  value={onionSkinning.opacity}
                  onValueChange={(val) => setOnionSkinning(prev => ({ ...prev, opacity: val }))}
                  minimumTrackTintColor="#ff9f6b"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#ff9f6b"
                />
              </View>

              {/* Onion Skin Color */}
              <View style={{ marginBottom: 20 }}>
                <Text style={{
                  color: '#888',
                  fontSize: 14,
                  fontFamily: 'vrtlfinal',
                  marginBottom: 8
                }}>Onion Skin Color</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { color: '#ff6b6b', label: 'Red' },
                    { color: '#6b9bff', label: 'Blue' },
                    { color: '#6bff8e', label: 'Green' },
                    { color: '#ffeb6b', label: 'Yellow' },
                    { color: '#ff6bda', label: 'Pink' },
                    { color: '#888888', label: 'Gray' }
                  ].map((colorOption) => (
                    <TouchableOpacity
                      key={colorOption.color}
                      onPress={() => setOnionSkinning(prev => ({ ...prev, color: colorOption.color }))}
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 8,
                        backgroundColor: colorOption.color,
                        borderWidth: onionSkinning.color === colorOption.color ? 3 : 1,
                        borderColor: onionSkinning.color === colorOption.color ? '#fff' : '#666'
                      }}
                    />
                  ))}
                </View>
              </View>

              {/* Clone Selected Frame */}
              <View style={{ marginBottom: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#333' }}>
                <Text style={{
                  color: '#888',
                  fontSize: 14,
                  fontFamily: 'vrtlfinal',
                  marginBottom: 8
                }}>Clone Frame {currentFrameIndex + 1}</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <TextInput
                    style={{
                      flex: 1,
                      backgroundColor: '#2a2a2a',
                      borderRadius: 8,
                      borderWidth: 2,
                      borderColor: '#9C27B0',
                      color: '#fff',
                      fontSize: 16,
                      fontFamily: 'vrtlfinal',
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      textAlign: 'center'
                    }}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    value={cloneCount}
                    onChangeText={setCloneCount}
                    onSubmitEditing={() => Keyboard.dismiss()}
                    onBlur={() => Keyboard.dismiss()}
                    placeholder="1"
                  />
                  <TouchableOpacity
                    onPress={async () => {
                      const num = parseInt(cloneCount, 10);
                      if (!Number.isFinite(num) || num < 1 || num > 100) {
                        CustomOverlayHelper.alert('Invalid Number', 'Please enter a number between 1 and 100');
                        return;
                      }

                      const sourceFrame = frames[currentFrameIndex];
                      if (!sourceFrame) return;

                      // Clone the frame
                      const newFrames = [...frames];
                      for (let i = 0; i < num; i++) {
                        const clonedFrame: AnimationFrame = {
                          id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                          strokes: sourceFrame.strokes.map(stroke => ({
                            ...stroke,
                            points: stroke.points.map(p => ({ ...p })),
                            emojiSequence: stroke.emojiSequence ? [...stroke.emojiSequence] : undefined
                          })),
                          timestamp: Date.now(),
                          thumbnail: sourceFrame.thumbnail // Copy thumbnail
                        };
                        // Insert after current frame
                        newFrames.splice(currentFrameIndex + 1 + i, 0, clonedFrame);
                      }

                      setFrames(newFrames);
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      CustomOverlayHelper.alert('Success', `Cloned frame ${currentFrameIndex + 1} ${num} time(s)`);
                    }}
                    style={{
                      backgroundColor: 'rgba(156,39,176,0.15)',
                      borderRadius: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderWidth: 2,
                      borderColor: '#9C27B0'
                    }}
                  >
                    <Text style={{
                      color: '#fff',
                      fontSize: 14,
                      fontWeight: 'bold',
                      fontFamily: 'vrtlfinal'
                    }}>Clone</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{
                  color: '#666',
                  fontSize: 11,
                  fontFamily: 'vrtlfinal',
                  marginTop: 6,
                  textAlign: 'center'
                }}>Duplicate current frame including strokes & preview</Text>
              </View>

              <TouchableOpacity
                onPress={() => setFrameSettingsVisible(false)}
                style={{
                  backgroundColor: 'rgba(76,175,80,0.15)',
                  borderRadius: 12,
                  padding: 14,
                  borderWidth: 2,
                  borderColor: '#4CAF50'
                }}
              >
                <Text style={{
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: 'bold',
                  fontFamily: 'vrtlfinal',
                  textAlign: 'center'
                }}>Done</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Animation Export Modal */}
      <Modal
        visible={animationExportVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAnimationExportVisible(false)}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: IS_IPAD ? 40 : 20 }}
          activeOpacity={1}
          onPress={() => setAnimationExportVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={{
              backgroundColor: '#1a1a1a',
              borderRadius: 16,
              padding: IS_IPAD ? 40 : 24,
              width: IS_IPAD ? Math.min(screenWidth * 0.85, 900) : Math.min(screenWidth - 40, 400),
              height: IS_IPAD ? '96%' : undefined,
              maxHeight: IS_IPAD ? '96%' : '92%',
              borderWidth: 1,
              borderColor: '#333'
            }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Header with title and close button */}
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 20
                }}>
                  <View style={{ flex: 1 }} />
                  <Text style={{
                    color: '#fff',
                    fontSize: IS_IPAD ? 24 : 18,
                    fontWeight: 'bold',
                    fontFamily: 'vrtlfinal',
                    textAlign: 'center',
                    flex: 1
                  }}>📤 Export Animation</Text>
                  <TouchableOpacity
                    onPress={() => setAnimationExportVisible(false)}
                    style={{
                      width: 32,
                      height: 32,
                      justifyContent: 'center',
                      alignItems: 'center',
                      flex: 0
                    }}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={{ fontSize: 24 }}>❎</Text>
                  </TouchableOpacity>
                </View>

                {/* Preview Player */}
                <View style={{
                  width: '100%',
                  aspectRatio: 1 / CANVAS_RATIO,
                  backgroundColor: exportTransparent ? 'transparent' : '#000',
                  borderRadius: 12,
                  overflow: 'hidden',
                  marginBottom: 20,
                  borderWidth: 2,
                  borderColor: '#333'
                }}>
                  <PaintCanvas
                    width={IS_IPAD && isLandscape ? 360 : (IS_IPAD ? 720 : 340)}
                    height={(IS_IPAD && isLandscape ? 360 : (IS_IPAD ? 720 : 340)) * CANVAS_RATIO}
                    strokes={(() => {
                      // Create border strokes to define full workspace bounds in preview
                      const previewSize = IS_IPAD && isLandscape ? 360 : (IS_IPAD ? 720 : 340);
                      const scaleFactor = previewSize / canvasSize;
                      const padding = 10;
                      const borderStrokes: Stroke[] = [
                        {
                          id: `preview_border_top`,
                          emoji: '⬜',
                          size: 2 * scaleFactor,
                          opacity: 0,
                          spacing: 0.01,
                          mirrorX: false,
                          mirrorY: false,
                          rotation: 0,
                          points: [
                            { x: padding * scaleFactor, y: padding * scaleFactor, t: 0 },
                            { x: (canvasSize - padding) * scaleFactor, y: padding * scaleFactor, t: 1 }
                          ]
                        },
                        {
                          id: `preview_border_right`,
                          emoji: '⬜',
                          size: 2 * scaleFactor,
                          opacity: 0,
                          spacing: 0.01,
                          mirrorX: false,
                          mirrorY: false,
                          rotation: 0,
                          points: [
                            { x: (canvasSize - padding) * scaleFactor, y: padding * scaleFactor, t: 1 },
                            { x: (canvasSize - padding) * scaleFactor, y: (canvasSize * CANVAS_RATIO - padding) * scaleFactor, t: 2 }
                          ]
                        },
                        {
                          id: `preview_border_bottom`,
                          emoji: '⬜',
                          size: 2 * scaleFactor,
                          opacity: 0,
                          spacing: 0.01,
                          mirrorX: false,
                          mirrorY: false,
                          rotation: 0,
                          points: [
                            { x: (canvasSize - padding) * scaleFactor, y: (canvasSize * CANVAS_RATIO - padding) * scaleFactor, t: 2 },
                            { x: padding * scaleFactor, y: (canvasSize * CANVAS_RATIO - padding) * scaleFactor, t: 3 }
                          ]
                        },
                        {
                          id: `preview_border_left`,
                          emoji: '⬜',
                          size: 2 * scaleFactor,
                          opacity: 0,
                          spacing: 0.01,
                          mirrorX: false,
                          mirrorY: false,
                          rotation: 0,
                          points: [
                            { x: padding * scaleFactor, y: (canvasSize * CANVAS_RATIO - padding) * scaleFactor, t: 3 },
                            { x: padding * scaleFactor, y: padding * scaleFactor, t: 4 }
                          ]
                        }
                      ];
                      // Scale frame strokes and add border strokes for full workspace preview
                      const frameStrokes = (frames[exportPreviewFrameIndex]?.strokes || []).map(stroke => ({
                        ...stroke,
                        size: stroke.size * scaleFactor,
                        points: stroke.points.map(p => ({
                          ...p,
                          x: p.x * scaleFactor,
                          y: p.y * scaleFactor
                        }))
                      }));
                      return [...borderStrokes, ...frameStrokes];
                    })()}
                    liveStroke={null}
                    liveVersion={0}
                    backgroundColor={exportTransparent ? 'transparent' : '#000000'}
                  />
                  {/* Play/Pause overlay */}
                  <TouchableOpacity
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      backgroundColor: 'rgba(0,0,0,0.6)',
                      borderRadius: 20,
                      width: 40,
                      height: 40,
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}
                    onPress={() => setExportPreviewPlaying(!exportPreviewPlaying)}
                  >
                    <Text style={{ fontSize: 20 }}>{exportPreviewPlaying ? '⏸️' : '▶️'}</Text>
                  </TouchableOpacity>
                  {/* Frame counter */}
                  <View style={{
                    position: 'absolute',
                    bottom: 8,
                    left: 8,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 4
                  }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'vrtlfinal' }}>
                      {exportPreviewFrameIndex + 1}/{frames.length}
                    </Text>
                  </View>
                </View>

                {/* Format Selection - All 3 options in one row */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={{
                    color: '#888',
                    fontSize: IS_IPAD ? 16 : 12,
                    fontFamily: 'vrtlfinal',
                    marginBottom: 6
                  }}>Format</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => setExportFormat('gif')}
                      style={{
                        flex: 1,
                        backgroundColor: exportFormat === 'gif' ? '#2196F3' : '#333',
                        borderRadius: 8,
                        padding: IS_IPAD ? 12 : 10,
                        borderWidth: 1.5,
                        borderColor: exportFormat === 'gif' ? '#2196F3' : '#555'
                      }}
                    >
                      <Text style={{
                        color: '#fff',
                        fontSize: IS_IPAD ? 14 : 11,
                        fontWeight: 'bold',
                        fontFamily: 'vrtlfinal',
                        textAlign: 'center'
                      }}>GIF</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setExportFormat('mov')}
                      style={{
                        flex: 1,
                        backgroundColor: exportFormat === 'mov' ? '#2196F3' : '#333',
                        borderRadius: 8,
                        padding: IS_IPAD ? 12 : 10,
                        borderWidth: 1.5,
                        borderColor: exportFormat === 'mov' ? '#2196F3' : '#555'
                      }}
                    >
                      <Text style={{
                        color: '#fff',
                        fontSize: IS_IPAD ? 14 : 11,
                        fontWeight: 'bold',
                        fontFamily: 'vrtlfinal',
                        textAlign: 'center'
                      }}>MOV</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setExportFormat('png')}
                      style={{
                        flex: 1,
                        backgroundColor: exportFormat === 'png' ? '#4CAF50' : '#333',
                        borderRadius: 8,
                        padding: IS_IPAD ? 12 : 10,
                        borderWidth: 1.5,
                        borderColor: exportFormat === 'png' ? '#4CAF50' : '#555'
                      }}
                    >
                      <Text style={{
                        color: '#fff',
                        fontSize: IS_IPAD ? 14 : 11,
                        fontWeight: 'bold',
                        fontFamily: 'vrtlfinal',
                        textAlign: 'center'
                      }}>PNG</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* FPS Setting */}
                <View style={{ marginBottom: 20 }}>
                  <Text style={{
                    color: '#888',
                    fontSize: 14,
                    fontFamily: 'vrtlfinal',
                    marginBottom: 8
                  }}>FPS (Frames Per Second): {exportFps}</Text>
                  <Slider
                    style={{ width: '100%', height: 40 }}
                    minimumValue={1}
                    maximumValue={60}
                    step={1}
                    value={exportFps}
                    onValueChange={setExportFps}
                    minimumTrackTintColor="#2196F3"
                    maximumTrackTintColor="#333"
                    thumbTintColor="#2196F3"
                  />
                </View>

                {/* Background & Loop Mode - All in one row */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={{
                    color: '#888',
                    fontSize: IS_IPAD ? 16 : 12,
                    fontFamily: 'vrtlfinal',
                    marginBottom: 6
                  }}>Background</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                    <TouchableOpacity
                      onPress={() => setExportTransparent(!exportTransparent)}
                      style={{
                        flex: 1,
                        backgroundColor: exportTransparent ? '#4CAF50' : '#333',
                        borderRadius: 8,
                        padding: IS_IPAD ? 12 : 10,
                        borderWidth: 1.5,
                        borderColor: exportTransparent ? '#4CAF50' : '#555',
                        justifyContent: 'center'
                      }}
                    >
                      <Text style={{
                        color: '#fff',
                        fontSize: IS_IPAD ? 14 : 10,
                        fontWeight: 'bold',
                        fontFamily: 'vrtlfinal',
                        textAlign: 'center'
                      }}>🧊 Trans</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{
                    color: '#888',
                    fontSize: IS_IPAD ? 16 : 12,
                    fontFamily: 'vrtlfinal',
                    marginBottom: 6
                  }}>Loop Mode</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => setExportLoopMode('normal')}
                      style={{
                        flex: 1,
                        backgroundColor: exportLoopMode === 'normal' ? '#FF9800' : '#333',
                        borderRadius: 8,
                        padding: IS_IPAD ? 12 : 10,
                        borderWidth: 1.5,
                        borderColor: exportLoopMode === 'normal' ? '#FF9800' : '#555',
                        justifyContent: 'center'
                      }}
                    >
                      <Text style={{
                        color: '#fff',
                        fontSize: IS_IPAD ? 14 : 10,
                        fontWeight: 'bold',
                        fontFamily: 'vrtlfinal',
                        textAlign: 'center'
                      }}>▶️ Fwd</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setExportLoopMode('reverse')}
                      style={{
                        flex: 1,
                        backgroundColor: exportLoopMode === 'reverse' ? '#FF9800' : '#333',
                        borderRadius: 8,
                        padding: IS_IPAD ? 12 : 10,
                        borderWidth: 1.5,
                        borderColor: exportLoopMode === 'reverse' ? '#FF9800' : '#555',
                        justifyContent: 'center'
                      }}
                    >
                      <Text style={{
                        color: '#fff',
                        fontSize: IS_IPAD ? 14 : 10,
                        fontWeight: 'bold',
                        fontFamily: 'vrtlfinal',
                        textAlign: 'center'
                      }}>◀️ Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setExportLoopMode('pingpong')}
                      style={{
                        flex: 1,
                        backgroundColor: exportLoopMode === 'pingpong' ? '#FF9800' : '#333',
                        borderRadius: 8,
                        padding: IS_IPAD ? 12 : 10,
                        borderWidth: 1.5,
                        borderColor: exportLoopMode === 'pingpong' ? '#FF9800' : '#555',
                        justifyContent: 'center'
                      }}
                    >
                      <Text style={{
                        color: '#fff',
                        fontSize: IS_IPAD ? 14 : 10,
                        fontWeight: 'bold',
                        fontFamily: 'vrtlfinal',
                        textAlign: 'center'
                      }}>↔️ Ping</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Save & Export Buttons - Side by side */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <TouchableOpacity
                    onPress={handleSaveAnimation}
                    style={{
                      flex: 1,
                      backgroundColor: 'rgba(76,175,80,0.2)',
                      borderRadius: 10,
                      padding: IS_IPAD ? 14 : 12,
                      borderWidth: 2,
                      borderColor: '#4CAF50'
                    }}
                  >
                    <Text style={{
                      color: '#fff',
                      fontSize: IS_IPAD ? 16 : 14,
                      fontWeight: 'bold',
                      fontFamily: 'vrtlfinal',
                      textAlign: 'center'
                    }}>💾 Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleAnimationExport}
                    style={{
                      flex: 1,
                      backgroundColor: 'rgba(33,150,243,0.2)',
                      borderRadius: 10,
                      padding: IS_IPAD ? 14 : 12,
                      borderWidth: 2,
                      borderColor: '#2196F3'
                    }}
                  >
                    <Text style={{
                      color: '#fff',
                      fontSize: IS_IPAD ? 16 : 14,
                      fontWeight: 'bold',
                      fontFamily: 'vrtlfinal',
                      textAlign: 'center'
                    }}>📤 Export</Text>
                  </TouchableOpacity>
                </View>

                {/* Cancel Button */}
                <TouchableOpacity
                  onPress={() => setAnimationExportVisible(false)}
                  style={{
                    backgroundColor: 'rgba(100,100,100,0.2)',
                    borderRadius: 12,
                    padding: 14,
                    borderWidth: 2,
                    borderColor: '#666'
                  }}
                >
                  <Text style={{
                    color: '#fff',
                    fontSize: 16,
                    fontFamily: 'vrtlfinal',
                    textAlign: 'center'
                  }}>Cancel</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {activeChallenge && viewShotLayout ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.challengeTimerOverlayArea,
            {
              top: viewShotLayout.y,
              left: viewShotLayout.x,
              width: viewShotLayout.width,
              height: viewShotLayout.height
            }
          ]}
        >
          <GestureDetector gesture={challengeTimerGesture}>
            <Animated.View style={[styles.challengeTimerBubble, challengeTimerStyle]}>
              <View style={styles.challengeTimerHeader}>
                <Text style={styles.challengeTimerTitle}>Sprint Timer</Text>
                <GestureDetector gesture={challengeTimerCloseGesture}>
                  <Animated.View
                    style={styles.challengeTimerCloseButton}
                    hitSlop={TIMER_CLOSE_HIT_SLOP}
                    accessible accessibilityRole="button" accessibilityLabel="Cancel challenge"
                  >
                    <Text style={styles.challengeTimerCloseLabel}>✕</Text>
                  </Animated.View>
                </GestureDetector>
              </View>
              <Text style={[styles.challengeTimerClock, challengeExpired && styles.challengeTimerClockExpired]}>
                {challengeExpired ? '00:00' : challengeTimeLabel}
              </Text>
              <Text style={styles.challengeTimerPrompt} numberOfLines={2}>
                {challengeExpired
                  ? "Time's up!"
                  /* Your OWN picked mystery topic, shown so you can remember what you
                     chose mid-sprint. This used to render a bare '🎲 Mystery', which
                     hid it from the one person who already knows the answer. The 🎲
                     prefix keeps it reading as a mystery pick. Spoiler-masking in the
                     GALLERY (other people's entries) is deliberate — do not remove it
                     there; see the _maskTopic branch in PaintScreen. */
                  : (mysteryTopicSelected && mysteryTopic
                      ? `🎲 ${formatPrompt(activeChallenge.prompt, infoLanguage)}`
                      : formatPrompt(activeChallenge.prompt, infoLanguage))}
              </Text>
              {!challengeExpired && (
                <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, fontFamily: 'vrtlfinal', textAlign: 'center', marginTop: 4 }}>
                  {canUploadChallengeEarly(challengeStrokeCount)
                    ? '2× tap to end early'
                    : `Paint ${getChallengeStrokesRemaining(challengeStrokeCount)} more to unlock early upload`}
                </Text>
              )}
            </Animated.View>
          </GestureDetector>
        </View>
      ) : null}

      {!activeChallenge &&
        !wording.isWordingActive() &&
        promptOverlayVisible &&
        !promptOverlayDismissed &&
        promptCards.length > 0 &&
        promptOverlayMetrics ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.promptOverlayArea,
              {
                top: promptOverlayMetrics.top,
                left: promptOverlayMetrics.left,
                width: promptOverlayMetrics.width,
                height: promptOverlayMetrics.height
              }
            ]}
          >
            <View
              pointerEvents="box-none"
              style={[
                styles.promptOverlayStack,
                (isIpadLandscape || isWidePortraitTablet) && styles.promptOverlayStackLandscape
              ]}
            >
              {promptCards.map((prompt, index) => {
                const key = getPromptCardKey(prompt);
                const anim = getPromptAnim(key);
                const exitVector = promptExitVectorRef.current;
                // Slide in from ABOVE (top → down) into place.
                const entryTranslateY = anim.entry.interpolate({ inputRange: [0, 1], outputRange: [-(48 + index * 14), 0] });
                const entryOpacity = anim.entry.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
                const entryScale = anim.entry.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
                const exitOpacity = anim.exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
                const exitScale = anim.exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] });
                const translateX = RNAnimated.multiply(anim.exit, exitVector.x || 0);
                const translateY = RNAnimated.add(
                  entryTranslateY,
                  RNAnimated.multiply(anim.exit, exitVector.y || -160)
                );
                const cardStyle = {
                  opacity: RNAnimated.multiply(entryOpacity, exitOpacity),
                  transform: [
                    { translateX },
                    { translateY },
                    { scale: RNAnimated.multiply(entryScale, exitScale) }
                  ]
                };
                const promptLabel = formatPrompt(prompt, infoLanguage);
                const metadata = getTopicMetadata(prompt.topic ?? '');
                const translatedTopic = metadata?.translations?.[infoLanguage] || metadata?.topic || prompt.topic;
                const alreadyUploaded = uploadedPromptTopics.has(prompt.topic);
                return (
                  <RNAnimated.View
                    key={key}
                    style={[styles.promptCard, isIpadLandscape && styles.promptCardLandscape, cardStyle]}
                  >
                    <TouchableOpacity
                      style={styles.promptCardButton}
                      onPress={() => handlePromptCardPress(prompt)}
                      disabled={alreadyUploaded}
                      accessibilityRole="button"
                      accessibilityLabel={`Start prompt ${promptLabel}`}
                    >
                      <View style={styles.promptCardTextRow}>
                        <Text
                          style={[styles.promptCardTitle, alreadyUploaded && styles.promptCardTitleDisabled]}
                          numberOfLines={2}
                        >
                          {translatedTopic}
                        </Text>
                        <Text style={styles.promptCardHint}>{`${prompt.timeMinutes ?? challengeMinutesForDay}m`}</Text>
                      </View>
                    </TouchableOpacity>
                  </RNAnimated.View>
                );
              })}
            </View>
          </View>
        ) : null}
    </>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
    width: IS_IPAD ? 64 : 48,
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
    fontSize: IS_IPAD ? 10 : 8,
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
    // 44pt target: the visible ✕ and its whole reasonable surround close the
    // sprint, rather than only the ~22x18pt glyph box it used to be.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  }
});

/**
 * PERF: memoised on purpose.
 *
 * PaintScreen bumps `liveVersion` once per animation frame for the whole
 * duration of a stroke, so it re-renders at ~60 fps while you draw. None of
 * this overlay's props change during a stroke, but without a memo boundary the
 * entire animator UI — frame timeline with one <Image> per thumbnail, the FPS /
 * length sliders and the sprint timer — was reconciled on every one of those
 * frames. With a 30-frame animation that is thousands of element creations per
 * second competing with the touch handler for the JS thread, which is what made
 * Pencil strokes lag behind the tip (and occasionally not start at all).
 *
 * Every prop at the call site in PaintScreen is a plain identifier (no inline
 * objects, arrays or arrow functions), so the default shallow compare is enough
 * — keep it that way when adding props here.
 */
export default React.memo(FrameAnimatorOverlay);
