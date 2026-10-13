// @ts-nocheck
/**
 * PrivateStudioOverlay — pure presentational component for the Private Studio.
 *
 * Renders the Private Studio Modal (passport name, canvas workspace, stats,
 * control bar) plus the inline Private Studio Leaderboard Overlay that slides
 * in without closing the modal.
 *
 * All state arrives via props — ZERO internal side-effects.
 *
 * @see ARCHITECTURE.md for the extraction guide and props contract
 */
import React from 'react';
import {
  ActivityIndicator,
  Animated as RNAnimated,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import PaintingWorkspace from '../../workspace/PaintingWorkspace';
import type { UseLeaderboardResult } from '../leaderboard/useLeaderboard';
import type { CoinLevel } from '../../lib/profileStats';
import type { PrivateStudioLeaderboardEntry } from '../../lib/privateStudio';
import type { UsePrivateStudioResult } from './usePrivateStudio';

// ---------------------------------------------------------------------------
// Constants (self-contained — not imported from PaintScreen)
// ---------------------------------------------------------------------------
const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;
const LARGE_HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 } as const;
const CANVAS_RATIO = 1;
const { width: screenWidth } = Dimensions.get('window');
const PICKER_COLUMN_COUNT = Math.min(18, Math.max(8, Math.floor(screenWidth / 40)));
const MIN_TRACE_SCALE = 0.01;
const MAX_TRACE_SCALE = 3;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PrivateStudioOverlayProps extends UsePrivateStudioResult {
  // ── Visibility guards ──────────────────────────────────────────────────
  challengeCompleteVisible: boolean;

  // ── Profile workspace mode ─────────────────────────────────────────────
  profileWorkspaceVisible: boolean;
  closeProfileWorkspace: () => void;
  closePrivateStudio: () => void;

  // ── Header actions ─────────────────────────────────────────────────────
  openGalleryFromPrivateStudio: () => void;
  openLeaderboardFromPrivateStudio: () => void;

  // ── Canvas animated style (derived from privateStudioCanvasFlight in
  //    PaintScreen — passed pre-computed to keep this component pure) ───────
  privateStudioCanvasAnimatedStyle: object;

  // ── PaintScreen StyleSheet (opaque pass-through for PaintingWorkspace) ──
  styles: any;

  // ── Canvas / painting workspace ────────────────────────────────────────
  canvasSize: number;
  strokes: any[];
  liveStroke: any;
  liveVersion: number;
  canvasGesture: any;
  canvasAnimatedStyle: any;
  canvasPanResponder: any;
  gesture: any;
  traceAnimatedStyle: any;
  handleCanvasZoomUpdate: (scale: number) => void;

  // ── Trace ──────────────────────────────────────────────────────────────
  trace: any;
  showTraceControls: boolean;
  traceLoading: boolean;
  traceLoadingMessage: string;
  isTraceAdjusting: boolean;
  handleTraceScaleChange: (v: number) => void;
  handleTraceConfirm: () => void;
  removeTrace: () => void;
  handleTraceOpacityChange: (v: number) => void;
  handleTraceToggleBackground: () => void;

  // ── Tools ──────────────────────────────────────────────────────────────
  isBrushActive: boolean;
  isLineActive: boolean;
  isEraserActive: boolean;
  activateBrushTool: () => void;
  activateLineTool: () => void;
  activateEraserTool: () => void;
  handleRandomEmoji: () => void;
  handleFirstTimeTest: () => void;
  undoStroke: () => void;
  redoStroke: () => void;
  handleClearCanvas: () => void;
  undoStack: any[];
  insets: { top: number; bottom: number };

  // ── Brush controls ─────────────────────────────────────────────────────
  displayBrushSize: number;
  sizeInput: string;
  setSizeInput: (v: string) => void;
  handleDisplayBrushSizeChange: (v: number) => void;
  setSizeInputFocused: (v: boolean) => void;
  toggleBrushOpacity: () => void;
  isOpacityMostlyTransparent: boolean;
  opacityToggleEmoji: string;
  brushMode: string;
  smudgeSmoothness: number;
  handleSmudgeSmoothnessChange: (v: number) => void;
  handleDisplayBrushPreview: () => void;
  handleDisplayBrushPreviewComplete: () => void;
  displayBrushSizeMax: number;

  // ── Quick actions ──────────────────────────────────────────────────────
  privateStudioQuickActions: any[];
  infoPulseScale: any;
  infoPulseOpacity: any;
  emojiBounceScale: any;
  handleInfoButtonLayout: (e: any) => void;

  // ── Emoji picker ───────────────────────────────────────────────────────
  emojiPickerVisible: boolean;
  setEmojiPickerVisible: (v: boolean) => void;
  emojiSearch: string;
  setEmojiSearch: (v: string) => void;
  recentEmojis: string[];
  brushEmoji: string;
  emojiResults: any[];
  handleEmojiSelect: (emoji: string) => void;
  handleLoadCustomBrushToWorkspace: (key: string) => void;
  emojiListRef: any;
  handleScrollToIndexFailed: (info: any) => void;
  emojiScrollOffsetRef: React.MutableRefObject<number>;
  handleEmojiPickerScroll: (offset: number) => void;
  centerEmojiInPicker: (emoji: string) => void;
  mirrorX: boolean;
  mirrorY: boolean;
  brushRotation: number;
  toggleMirrorX: () => void;
  toggleMirrorY: () => void;
  getEmojiItemLayout: (data: any, index: number) => { length: number; offset: number; index: number };
  emojiPickerSpacingSlider: React.ReactNode;
  turnBrushLeft: () => void;
  turnBrushRight: () => void;
  turnBrushRightLongPress: () => void;
  autoRotateEnabled: boolean;

  // ── Canvas preview / misc ──────────────────────────────────────────────
  brushPreviewStroke: any;
  diceScale: any;
  wording: { isWordingActive: () => boolean; getCurrentLetter: () => string | null };
  currentPassportImage: string | null;

  // ── Toolbar / control bar (pre-built ReactNodes) ───────────────────────
  privateStudioToolbar: React.ReactNode;
  privateStudioControlBar: React.ReactNode;

  // ── Name input handlers ────────────────────────────────────────────────
  handlePrivateStudioNameChange: (text: string) => void;
  clearPrivateStudioTypewriter: () => void;
  handleRandomPrivateStudioName: (opts: { animate: boolean; bounce: boolean }) => void;

  // ── Stats / level ──────────────────────────────────────────────────────
  totalTimeLabel: string;
  totalStrokeLabel: string;
  coinCount: number;
  currentCoinLevel: CoinLevel;
  nextCoinLevel: CoinLevel | null;
  nextLevelRemainingCoins: number;

  // ── Passport snapshot animation ────────────────────────────────────────
  passportSnapshotsAnimationActive: boolean;
  passportSnapshotsFrames: string[];
  passportSnapshotsCurrentFrame: number;
  passportSnapshotsOpacity: RNAnimated.Value;

  // ── Leaderboard (from useLeaderboard) ─────────────────────────────────
  leaderboard: UseLeaderboardResult;
  ownLeaderboardEntryIdSet: Set<string>;
  refreshLeaderboard: () => Promise<any>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PrivateStudioOverlay: React.FC<PrivateStudioOverlayProps> = (props) => {
  const {
    // Visibility / loading
    privateStudioVisible,
    privateStudioLoading,
    privateStudioSaving,
    privateStudioUploadInFlight,
    challengeCompleteVisible,
    // Profile workspace
    profileWorkspaceVisible,
    closeProfileWorkspace,
    closePrivateStudio,
    // Header actions
    openGalleryFromPrivateStudio,
    openLeaderboardFromPrivateStudio,
    // Canvas animation
    privateStudioCanvasAnimatedStyle,
    // Passport
    privateStudioError,
    privateStudioStatusMessage,
    // PaintScreen styles pass-through
    styles,
    // Canvas / painting
    canvasSize,
    strokes,
    liveStroke,
    liveVersion,
    canvasGesture,
    canvasAnimatedStyle,
    canvasPanResponder,
    gesture,
    traceAnimatedStyle,
    handleCanvasZoomUpdate,
    // Trace
    trace,
    showTraceControls,
    traceLoading,
    traceLoadingMessage,
    isTraceAdjusting,
    handleTraceScaleChange,
    handleTraceConfirm,
    removeTrace,
    handleTraceOpacityChange,
    handleTraceToggleBackground,
    // Tools
    isBrushActive,
    isLineActive,
    isEraserActive,
    activateBrushTool,
    activateLineTool,
    activateEraserTool,
    handleRandomEmoji,
    handleFirstTimeTest,
    undoStroke,
    redoStroke,
    handleClearCanvas,
    undoStack,
    insets,
    // Brush controls
    displayBrushSize,
    sizeInput,
    setSizeInput,
    handleDisplayBrushSizeChange,
    setSizeInputFocused,
    toggleBrushOpacity,
    isOpacityMostlyTransparent,
    opacityToggleEmoji,
    brushMode,
    smudgeSmoothness,
    handleSmudgeSmoothnessChange,
    handleDisplayBrushPreview,
    handleDisplayBrushPreviewComplete,
    displayBrushSizeMax,
    // Quick actions
    privateStudioQuickActions,
    infoPulseScale,
    infoPulseOpacity,
    emojiBounceScale,
    handleInfoButtonLayout,
    // Emoji picker
    emojiPickerVisible,
    setEmojiPickerVisible,
    emojiSearch,
    setEmojiSearch,
    recentEmojis,
    brushEmoji,
    emojiResults,
    handleEmojiSelect,
    handleLoadCustomBrushToWorkspace,
    emojiListRef,
    handleScrollToIndexFailed,
    emojiScrollOffsetRef,
    handleEmojiPickerScroll,
    centerEmojiInPicker,
    mirrorX,
    mirrorY,
    brushRotation,
    toggleMirrorX,
    toggleMirrorY,
    getEmojiItemLayout,
    emojiPickerSpacingSlider,
    turnBrushLeft,
    turnBrushRight,
    turnBrushRightLongPress,
    autoRotateEnabled,
    // Canvas misc
    brushPreviewStroke,
    diceScale,
    wording,
    currentPassportImage,
    // Pre-built ReactNodes
    privateStudioToolbar,
    privateStudioControlBar,
    // Stats / level
    totalTimeLabel,
    totalStrokeLabel,
    coinCount,
    currentCoinLevel,
    nextCoinLevel,
    nextLevelRemainingCoins,
    // Passport snapshots
    passportSnapshotsAnimationActive,
    passportSnapshotsFrames,
    passportSnapshotsCurrentFrame,
    passportSnapshotsOpacity,
    // Leaderboard
    leaderboard,
    ownLeaderboardEntryIdSet,
    refreshLeaderboard,
  } = props;

  const isBusy = privateStudioSaving || privateStudioUploadInFlight;

  return (
    <Modal
      visible={privateStudioVisible && !challengeCompleteVisible}
      animationType="slide"
      transparent
      onRequestClose={profileWorkspaceVisible ? closeProfileWorkspace : closePrivateStudio}
      supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
    >
      <View style={[s.fullscreenOverlay, s.privateStudioOverlay]}>
        <View style={[s.fullscreenSheet, s.privateStudioSheet]}>

          {/* ── Header ──────────────────────────────────────────────────── */}
          <View style={[s.fullscreenHeader, s.privateStudioHeader]}>
            <View style={s.privateStudioHeaderTitleBlock}>
              <Text style={s.fullscreenTitle}>
                {profileWorkspaceVisible ? 'Edit Profile' : 'Profil Studio'}
              </Text>
            </View>
            <View style={s.privateStudioHeaderActions}>
              {!profileWorkspaceVisible && (
                <>
                  <TouchableOpacity
                    onPress={openGalleryFromPrivateStudio}
                    accessibilityRole="button"
                    accessibilityLabel="Open Gallery"
                    style={s.privateStudioActionButton}
                    hitSlop={LARGE_HIT_SLOP}
                    disabled={isBusy}
                  >
                    <Text style={[s.privateStudioActionEmoji, s.privateStudioActionEmojiGallery]}>
                      🏛️
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={openLeaderboardFromPrivateStudio}
                    accessibilityRole="button"
                    accessibilityLabel="Open Leaderboard"
                    style={s.privateStudioActionButton}
                    hitSlop={LARGE_HIT_SLOP}
                    disabled={isBusy}
                  >
                    <Text style={[s.privateStudioActionEmoji, s.privateStudioActionEmojiLeaderboard]}>
                      🏆
                    </Text>
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity
                onPress={profileWorkspaceVisible ? closeProfileWorkspace : closePrivateStudio}
                accessibilityRole="button"
                accessibilityLabel={profileWorkspaceVisible ? 'Back to Profile' : 'Close Profil Studio'}
                style={s.privateStudioCloseButton}
                hitSlop={LARGE_HIT_SLOP}
                disabled={isBusy}
              >
                <Text
                  style={[
                    s.fullscreenClose,
                    s.privateStudioCloseLabel,
                    isBusy && s.fullscreenCloseDisabled,
                  ]}
                >
                  ❎
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Body ────────────────────────────────────────────────────── */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
            style={s.privateStudioBody}
          >
            <View style={s.privateStudioContent}>

              {/* Toolbar slot */}
              {privateStudioToolbar}

              {/* Canvas workspace */}
              <View style={s.privateStudioWorkspaceSection}>
                <View style={s.privateStudioWorkspaceWrapper}>
                  {privateStudioLoading ? (
                    <View style={s.privateStudioLoading}>
                      <ActivityIndicator color="#ff9f6b" size="large" />
                      <Text style={s.privateStudioLoadingLabel}>Loading studio…</Text>
                    </View>
                  ) : (
                    <View style={s.privateStudioWorkspaceInner}>
                      <View style={[s.canvasStage, s.privateStudioCanvasStage]}>
                        {/* Portrait backdrop */}
                        {currentPassportImage ? (
                          <Image
                            source={{ uri: currentPassportImage }}
                            style={[StyleSheet.absoluteFill, s.passportBackdrop]}
                            resizeMode="cover"
                            pointerEvents="none"
                          />
                        ) : null}

                        <RNAnimated.View style={[s.privateStudioScaler, privateStudioCanvasAnimatedStyle]}>
                          <PaintingWorkspace
                            styles={styles}
                            hitSlop={LARGE_HIT_SLOP}
                            canvasSize={canvasSize}
                            canvasRatio={CANVAS_RATIO}
                            showToolbar={false}
                            strokeState={{ strokes, liveStroke, liveVersion }}
                            gestures={{
                              canvasGesture,
                              canvasAnimatedStyle,
                              panHandlers: canvasPanResponder.panHandlers,
                              traceGesture: gesture,
                              traceAnimatedStyle,
                              onZoomUpdate: handleCanvasZoomUpdate,
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
                              maxTraceScale: MAX_TRACE_SCALE,
                            }}
                            toolbarState={{
                              isBrushActive,
                              isLineActive,
                              isEraserActive,
                              activateBrushTool,
                              activateLineTool,
                              activateEraserTool,
                              handleRandomEmoji,
                              handleFirstTimeTest,
                              undoStroke,
                              redoStroke,
                              handleClearCanvas,
                              undoDisabled: strokes.length === 0,
                              redoDisabled: undoStack.length === 0,
                              clearDisabled: strokes.length === 0,
                              topInset: insets.top,
                            }}
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
                            }}
                            quickActionsState={{
                              actionButtons: privateStudioQuickActions,
                              infoPulseScale,
                              infoPulseOpacity,
                              emojiBounceScale,
                              onInfoButtonLayout: handleInfoButtonLayout,
                            }}
                            showBrushControls={false}
                            customQuickActions={<></>}
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
                              autoRotateEnabled,
                            }}
                            previewStroke={brushPreviewStroke}
                            diceScale={diceScale}
                            watermarkLetter={wording.isWordingActive() ? wording.getCurrentLetter() : null}
                          />
                        </RNAnimated.View>
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {/* Details: profile names are edited on ProfilePage. The painter
                  only keeps status information and its brush/upload controls. */}
              <View style={s.privateStudioDetails}>
                <View style={s.privateStudioIdentityRow}>
                  {!profileWorkspaceVisible ? (
                    <View style={s.privateStudioStatsColumn}>
                      <Text style={s.privateStudioStatText}>
                        Total time {totalTimeLabel} · {totalStrokeLabel} strokes overall
                      </Text>
                      <Text style={s.privateStudioStatText}>
                        Coins {coinCount.toLocaleString()} · Level {currentCoinLevel.emoji}{' '}
                        {currentCoinLevel.name}
                      </Text>
                      <Text style={s.privateStudioLevelHint}>
                        {nextCoinLevel
                          ? `${nextCoinLevel.emoji} ${nextCoinLevel.name} in ${nextLevelRemainingCoins} more ${
                              nextLevelRemainingCoins === 1 ? 'coin' : 'coins'
                            }`
                          : 'Max level reached!'}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {privateStudioStatusMessage ? (
                  <Text style={s.privateStudioMessage}>{privateStudioStatusMessage}</Text>
                ) : null}
                {privateStudioError ? (
                  <Text style={s.privateStudioErrorText}>{privateStudioError}</Text>
                ) : null}
              </View>

              {/* The same brush controls, including the opaque/transparent/
                  smudge toggle, are available in profile workspace mode too. */}
              <View style={s.privateStudioControlsRowWrapper}>
                {privateStudioControlBar}
              </View>
            </View>
          </KeyboardAvoidingView>

          {/* ── Passport Snapshot Animation Overlay ───────────────────── */}
          {passportSnapshotsAnimationActive &&
            passportSnapshotsFrames.length > 0 &&
            passportSnapshotsFrames[passportSnapshotsCurrentFrame] ? (
            <RNAnimated.View
              style={[
                StyleSheet.absoluteFill,
                {
                  opacity: passportSnapshotsOpacity,
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  justifyContent: 'center',
                  alignItems: 'center',
                  zIndex: 10000,
                },
              ]}
              pointerEvents="none"
            >
              <Image
                source={{ uri: passportSnapshotsFrames[passportSnapshotsCurrentFrame] }}
                style={{
                  width: Math.min(400, screenWidth * 0.8),
                  height: Math.min(400, screenWidth * 0.8),
                  borderRadius: 20,
                  borderWidth: 3,
                  borderColor: '#ff9f6b',
                }}
                resizeMode="contain"
              />
              <Text style={s.snapshotJourneyLabel}>
                Your Passport Journey: {passportSnapshotsCurrentFrame + 1} /{' '}
                {passportSnapshotsFrames.length}
              </Text>
            </RNAnimated.View>
          ) : null}
        </View>

        {/* ── Private Studio Leaderboard Overlay ──────────────────────────── */}
        {leaderboard.privateStudioLeaderboardOverlayVisible && (
          <RNAnimated.View
            style={[
              s.fullscreenOverlay,
              {
                opacity: leaderboard.privateStudioLeaderboardOverlayAnim,
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 16000,
              },
            ]}
            pointerEvents={leaderboard.privateStudioLeaderboardOverlayVisible ? 'auto' : 'none'}
          >
            <View style={[s.leaderboardSheet, { flex: 1 }]}>
              {/* Leaderboard header */}
              <View style={[s.fullscreenHeader, s.leaderboardHeader]}>
                <Text style={[s.fullscreenTitle, { flex: 1 }]}>Leaderboard</Text>
                <TouchableOpacity
                  onPress={leaderboard.closePrivateStudioLeaderboardOverlay}
                  accessibilityRole="button"
                  accessibilityLabel="Close Leaderboard"
                  hitSlop={LARGE_HIT_SLOP}
                >
                  <Text style={s.fullscreenClose}>❎</Text>
                </TouchableOpacity>
              </View>

              {/* Leaderboard body */}
              {leaderboard.leaderboardLoading ? (
                <View style={[s.leaderboardLoading, { flex: 1, justifyContent: 'center' }]}>
                  <ActivityIndicator color="#ff9f6b" size="large" />
                  <Text style={s.leaderboardLoadingLabel}>Loading leaderboard…</Text>
                </View>
              ) : leaderboard.leaderboardError ? (
                <View style={s.leaderboardErrorBlock}>
                  <Text style={s.leaderboardErrorText}>{leaderboard.leaderboardError}</Text>
                  <TouchableOpacity
                    onPress={refreshLeaderboard}
                    style={{ marginTop: 16 }}
                    accessibilityRole="button"
                    accessibilityLabel="Retry leaderboard"
                  >
                    <Text style={[s.leaderboardRefreshText, { color: '#ff9f6b' }]}>
                      ↻ Retry
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <FlatList
                  ref={leaderboard.leaderboardListRef}
                  data={leaderboard.leaderboardEntries.slice(
                    0,
                    leaderboard.leaderboardPage * 50
                  )}
                  renderItem={({ item, index }: { item: PrivateStudioLeaderboardEntry; index: number }) => {
                    const isOwnEntry = ownLeaderboardEntryIdSet.has(item.id);
                    return (
                      <TouchableOpacity
                        style={s.leaderboardRow}
                        onPress={() => leaderboard.handleLeaderboardEntryPress(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`View ${item.name}'s passport`}
                        activeOpacity={0.9}
                      >
                        <View style={s.leaderboardRankBadge}>
                          <Text style={s.leaderboardRankText}>
                            #{item.rank ?? index + 1}
                          </Text>
                        </View>
                        <View style={s.leaderboardMeta}>
                          <Text style={s.leaderboardName}>{item.name}</Text>
                        </View>
                        <View style={s.leaderboardImageButton}>
                          {item.imageUrl ? (
                            <Image
                              source={{ uri: item.imageUrl }}
                              style={s.leaderboardImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={s.leaderboardImagePlaceholder}>
                              <Text style={s.leaderboardImagePlaceholderLabel}>View</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                  keyExtractor={(item, index) => `${item.id}-${index}`}
                  contentContainerStyle={{ paddingBottom: 16 }}
                  scrollEnabled
                  removeClippedSubviews
                  maxToRenderPerBatch={10}
                  windowSize={5}
                  initialNumToRender={15}
                />
              )}
            </View>
          </RNAnimated.View>
        )}
      </View>
    </Modal>
  );
};

export default React.memo(PrivateStudioOverlay);

// ---------------------------------------------------------------------------
// Styles (all private-studio specific styles — self-contained, not from PaintScreen)
// ---------------------------------------------------------------------------
const s = StyleSheet.create({
  // ── Shared fullscreen wrappers ─────────────────────────────────────────
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenSheet: {
    flex: 1,
    width: '100%',
    backgroundColor: '#0d0d0d',
    borderRadius: 0,
  },
  fullscreenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fullscreenTitle: {
    color: '#ffdc82',
    fontSize: 20,
    fontWeight: '700',
  },
  fullscreenClose: {
    color: '#ffffff',
    fontSize: 22,
  },
  fullscreenCloseDisabled: {
    opacity: 0.35,
  },

  // ── Private Studio shell ───────────────────────────────────────────────
  privateStudioOverlay: {
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    padding: 0,
  },
  privateStudioSheet: {
    borderRadius: 0,
  },
  privateStudioHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  privateStudioHeaderTitleBlock: {
    flex: 1,
  },
  privateStudioHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  privateStudioActionButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },
  privateStudioActionEmoji: {
    fontSize: 22,
  },
  privateStudioActionEmojiGallery: {
    color: '#9fd5ff',
  },
  privateStudioActionEmojiLeaderboard: {
    color: '#ffdc82',
  },
  privateStudioCloseButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  privateStudioCloseLabel: {
    fontSize: 22,
  },
  privateStudioBody: {
    flex: 1,
  },
  privateStudioContent: {
    flex: 1,
    gap: 0,
  },

  // ── Canvas section ─────────────────────────────────────────────────────
  privateStudioWorkspaceSection: {
    flex: 1,
    minHeight: 0,
  },
  privateStudioWorkspaceWrapper: {
    flex: 1,
  },
  privateStudioLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  privateStudioLoadingLabel: {
    color: '#bbbbbb',
    fontSize: 14,
  },
  privateStudioWorkspaceInner: {
    flex: 1,
  },
  canvasStage: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  privateStudioCanvasStage: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  passportBackdrop: {
    opacity: 0.22,
    borderRadius: 12,
  },
  privateStudioScaler: {
    flex: 1,
  },

  // ── Details row ────────────────────────────────────────────────────────
  privateStudioDetails: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  privateStudioIdentityRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  privateStudioNameColumn: {
    flex: 1,
    gap: 6,
  },
  privateStudioLabel: {
    color: '#8e8e92',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  privateStudioNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  privateStudioNameInput: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#ffffff',
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },
  privateStudioRandomNameWrapper: {
    // wraps the animated scale transform
  },
  privateStudioRandomNameButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },
  privateStudioRandomNameEmoji: {
    fontSize: 20,
  },
  privateStudioStatsColumn: {
    flex: 1,
    gap: 4,
    alignItems: 'flex-end',
  },
  privateStudioStatText: {
    color: '#bbbbbb',
    fontSize: 12,
    textAlign: 'right',
  },
  privateStudioLevelHint: {
    color: '#ff9f6b',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  privateStudioMessage: {
    color: '#82ffa1',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 4,
  },
  privateStudioErrorText: {
    color: '#ff6b6b',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 4,
  },
  privateStudioControlsRowWrapper: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },

  // ── Passport snapshot journey ──────────────────────────────────────────
  snapshotJourneyLabel: {
    marginTop: 16,
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  // ── Private Studio Leaderboard Overlay ────────────────────────────────
  leaderboardSheet: {
    flex: 1,
    width: '100%',
    backgroundColor: '#101010',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 16,
  },
  leaderboardHeader: {
    marginBottom: 4,
  },
  leaderboardLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  leaderboardLoadingLabel: {
    color: '#bbbbbb',
    fontSize: 14,
  },
  leaderboardErrorBlock: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  leaderboardErrorText: {
    color: '#ff6b6b',
    fontSize: 15,
    textAlign: 'center',
  },
  leaderboardRefreshText: {
    fontSize: 15,
    fontWeight: '600',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181818',
    borderRadius: 18,
    padding: 12,
    gap: 12,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#292929',
  },
  leaderboardRankBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ff6b6b20',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ff6b6b70',
  },
  leaderboardRankText: {
    color: '#ff6b6b',
    fontWeight: '700',
    fontSize: 13,
  },
  leaderboardMeta: {
    flex: 1,
    gap: 4,
  },
  leaderboardName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  leaderboardImageButton: {
    width: 64,
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  leaderboardImage: {
    width: '100%',
    height: '100%',
  },
  leaderboardImagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardImagePlaceholderLabel: {
    color: '#ffdc82',
    fontSize: 12,
    fontWeight: '600',
  },
});
