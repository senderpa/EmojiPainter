import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import { View, TouchableOpacity, Platform, Animated as RNAnimated, Dimensions } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Slider from '@react-native-community/slider';
import type { Insets } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { Canvas, Group, Vertices, vec, ImageShader, Line } from '@shopify/react-native-skia';

import CanvasViewport from './CanvasViewport';
import WorkspaceToolbar from './WorkspaceToolbar';
import BrushControls from './BrushControls';
import QuickActionsStrip from './QuickActionsStrip';
import EmojiPickerModal from './EmojiPickerModal';
import type { Stroke, TraceState } from '../state/PaintingContext';
import { useAppSettings } from '../context/AppSettingsContext';
import { getStamp } from '../components/EmojiCanvas';

import type { EmojiEntry } from '../lib/emojiCatalog';

interface PaintingWorkspaceProps {
  canvasBackgroundColor?: string;
  styles: any;
  hitSlop: Insets | { top: number; bottom: number; left: number; right: number };
  canvasSize: number;
  canvasRatio: number;
  strokeState: {
    strokes: Stroke[];
    liveStroke: Stroke | null;
    liveVersion: number;
  };
  gestures: {
    canvasGesture: any;
    canvasAnimatedStyle: any;
    panHandlers: any;
    traceGesture: any;
    traceAnimatedStyle: any;
    onZoomUpdate?: (state: { scale: number; translateX: number; translateY: number }) => void;
  };
  traceState: {
    trace: TraceState;
    showTraceControls: boolean;
    traceLoading: boolean;
    traceLoadingMessage: string;
    isTraceAdjusting: boolean;
    handleTraceScaleChange: (value: number) => void;
    handleTraceConfirm: () => void;
    handleTraceRemove: () => void;
    handleTraceOpacityChange: (value: number) => void;
    handleTraceToggleBackground: () => void;
    minTraceScale: number;
    maxTraceScale: number;
  };
  toolbarState: {
    /** Main workspace only: omit and no Layers button renders. */
    onLayers?: () => void;
    layersActive?: boolean;
    isBrushActive: boolean;
    isLineActive: boolean;
    isEraserActive: boolean;
    isEmojiPlaneActive?: boolean;
    activateBrushTool: () => void;
    activateLineTool: () => void;
    activateEraserTool: () => void;
    activateEmojiPlaneTool?: () => void;
    handleRandomEmoji: () => void;
    undoStroke: () => void;
    redoStroke: () => void;
    handleClearCanvas: () => void;
    handleFaceFilter?: () => void;
    undoDisabled: boolean;
    redoDisabled: boolean;
    clearDisabled: boolean;
    topInset: number;
    brushOptionsVisible?: boolean;
    handleFlipX?: () => void;
    handleFlipY?: () => void;
    handleRotateLeft?: () => void;
    handleRotateRight?: () => void;
    handleRotateLeftLongPress?: () => void;
    handleRotateRightLongPress?: () => void;
    handleRecentEmojiPress?: (emoji: string) => void;
    recentEmojis?: string[];
    mirrorX?: boolean;
    mirrorY?: boolean;
    autoRotateEnabled?: boolean;
    autoRotateDirection?: 'left' | 'right' | null;
    brushEmoji?: string;
    tutorialActive?: boolean;
    tutorialCurrentLesson?: number;
    tutorialBlinkScale?: any;
    tutorialBlinkOpacity?: any;
  };
  brushControlsState: {
    brushSize: number;
    sizeInput: string;
    setSizeInput: (value: string) => void;
    dispatchSetBrushSize: (size: number) => void;
    setSizeInputFocused: (value: boolean) => void;
    toggleBrushOpacity: () => void;
    isOpacityMostlyTransparent: boolean;
    opacityToggleEmoji: string;
    smudgeActive?: boolean;
    smudgeSmoothness?: number;
    onSmudgeSmoothnessChange?: (value: number) => void;
    onBrushPreview?: (size: number) => void;
    onBrushPreviewComplete?: (size: number) => void;
    sizeSliderMaximum?: number;
    spacingSlider?: {
      value: number;
      onChange: (value: number) => void;
      onComplete?: (value: number) => void;
    };
    tutorialActive?: boolean;
    tutorialCurrentLesson?: number;
    tutorialBlinkScale?: any;
    tutorialBlinkOpacity?: any;
  };
  quickActionsState: {
    actionButtons: Array<{ key: string; icon: string; label: string; helperLabel?: string; disabled?: boolean; onPress?: () => void; onLongPress?: () => void; onLayout?: (coords: { x: number; y: number; width: number; height: number }) => void }>;
    infoPulseScale: any;
    infoPulseOpacity: any;
    emojiBounceScale?: any;
    onInfoButtonLayout?: (coords: { x: number; y: number; width: number; height: number }) => void;
  };
  showBrushControls?: boolean;
  customQuickActions?: React.ReactNode;
  emojiPickerState: {
    emojiPickerVisible: boolean;
    setEmojiPickerVisible: (value: boolean) => void;
    emojiSearch: string;
    setEmojiSearch: (value: string) => void;
    recentEmojis: string[];
    brushEmoji: string;
    emojiResults: EmojiEntry[];
    handleEmojiSelect: (emoji: string) => void;
    onLoadCustomBrushToWorkspace?: (emoji: string) => void;
    mirrorX: boolean;
    mirrorY: boolean;
    rotation: number;
    onToggleMirrorX: () => void;
    onToggleMirrorY: () => void;
    spacingSlider?: {
      value: number;
      minimum: number;
      maximum: number;
      onChange: (value: number) => void;
      onComplete?: (value: number) => void;
    };
    onTurnLeft: () => void;
    onTurnRight: () => void;
    onEmojiPickerOpen?: () => void;
  };
  previewStroke?: Stroke | null;
  diceScale?: SharedValue<number>;
  watermarkLetter?: string | null;
  frameMode?: boolean;
  handMode?: 'left' | 'right';
  isLandscape?: boolean;
  polygonPoints?: Array<{ x: number; y: number }>;
  emojiPlanes?: Array<{
    id: string;
    emoji: string;
    corners: {
      topLeft: { x: number; y: number };
      topMid: { x: number; y: number };
      topRight: { x: number; y: number };
      rightMid: { x: number; y: number };
      bottomRight: { x: number; y: number };
      bottomMid: { x: number; y: number };
      bottomLeft: { x: number; y: number };
      leftMid: { x: number; y: number };
    };
    lifetime: number;
    zIndex: number;
    opacity: number;
  }>;
  selectedPlaneId?: string | null;
  draggingCorner?: { planeId: string; corner: string } | null;
  forceSkia?: boolean;
  onPlaneCornerDragStart?: (planeId: string, corner: string) => void;
  onPlaneCornerDrag?: (planeId: string, corner: string, x: number, y: number) => void;
  onPlaneCornerDragEnd?: (planeId: string) => void;
  showToolbar?: boolean;
}

const PaintingWorkspace: React.FC<PaintingWorkspaceProps> = ({
  canvasBackgroundColor,
  styles,
  hitSlop,
  canvasSize,
  canvasRatio,
  strokeState,
  gestures,
  traceState,
  toolbarState,
  brushControlsState,
  quickActionsState,
  showBrushControls = true,
  customQuickActions,
  emojiPickerState,
  previewStroke,
  diceScale,
  watermarkLetter,
  frameMode = false,
  handMode = 'right',
  isLandscape = false,
  polygonPoints = [],
  emojiPlanes = [],
  selectedPlaneId = null,
  draggingCorner = null,
  forceSkia,
  onPlaneCornerDragStart,
  onPlaneCornerDrag,
  onPlaneCornerDragEnd,
  showToolbar = true
}) => {
  const isIpad = Platform.OS === 'ios' && (Platform as any)?.isPad === true;
  const { strokes, liveStroke, liveVersion } = strokeState;
  const { colors } = useAppSettings();

  // Get actual screen dimensions for proper edge positioning
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  // Animated values for toolbar transitions (1 second transition)
  const toolbarRightAnim = useRef(new RNAnimated.Value(isLandscape && isIpad ? 0 : -200)).current;
  const quickActionsLeftAnim = useRef(new RNAnimated.Value(isLandscape && isIpad ? 0 : -200)).current;

  // Animated value for slider position in frame mode
  const sliderBottomAnim = useRef(new RNAnimated.Value(
    isIpad && isLandscape
      ? (frameMode ? screenHeight * 0.05 + 20 : -30 - screenHeight * 0.05) // Moved 50px down in landscape
      : (frameMode ? (isIpad ? 200 : 140) : (isIpad ? 180 : 70)) // Moved 150px up in portrait iPad
  )).current;

  // Animate toolbars when landscape mode changes
  useEffect(() => {
    if (!isIpad) return;

    const shouldBeVisible = isLandscape;
    const toValue = shouldBeVisible ? 0 : -200;

    RNAnimated.parallel([
      RNAnimated.timing(toolbarRightAnim, {
        toValue,
        duration: 1000,
        useNativeDriver: true
      }),
      RNAnimated.timing(quickActionsLeftAnim, {
        toValue,
        duration: 1000,
        useNativeDriver: true
      })
    ]).start();
  }, [isLandscape, isIpad, toolbarRightAnim, quickActionsLeftAnim]);

  // Animate slider position when frame mode changes in iPad landscape
  useEffect(() => {
    if (!isIpad) return;

    const targetBottom = isLandscape
      ? (frameMode ? screenHeight * 0.05 + 20 : -30 - screenHeight * 0.05) // Moved 50px down in landscape
      : (frameMode ? 200 : 180); // Moved 150px up in portrait iPad

    RNAnimated.timing(sliderBottomAnim, {
      toValue: targetBottom,
      duration: 400,
      useNativeDriver: false // Can't use native driver for layout properties
    }).start();
  }, [frameMode, isIpad, isLandscape, sliderBottomAnim, screenHeight]);

  const quickActions = useMemo(
    () => quickActionsState.actionButtons.map((button) => ({ ...button, onPress: button.onPress ?? (() => undefined) })),
    [quickActionsState.actionButtons]
  );

  return (
    <>
      {showToolbar ? (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0
        }}>
          <WorkspaceToolbar
            styles={styles}
            hitSlop={hitSlop}
            topInset={toolbarState.topInset}
            isBrushActive={toolbarState.isBrushActive}
            isLineActive={toolbarState.isLineActive}
            isEraserActive={toolbarState.isEraserActive}
            isEmojiPlaneActive={toolbarState.isEmojiPlaneActive}
            onBrush={toolbarState.activateBrushTool}
            onLine={toolbarState.activateLineTool}
            onLayers={toolbarState.onLayers}
            layersActive={toolbarState.layersActive}
            onEraser={toolbarState.activateEraserTool}
            onEmojiPlane={toolbarState.activateEmojiPlaneTool}
            onRandom={toolbarState.handleRandomEmoji}
            onUndo={toolbarState.undoStroke}
            onRedo={toolbarState.redoStroke}
            onClear={toolbarState.handleClearCanvas}
            onFaceFilter={toolbarState.handleFaceFilter}
            undoDisabled={toolbarState.undoDisabled}
            redoDisabled={toolbarState.redoDisabled}
            clearDisabled={toolbarState.clearDisabled}
            randomScale={diceScale}
            brushOptionsVisible={toolbarState.brushOptionsVisible}
            onFlipX={toolbarState.handleFlipX}
            onFlipY={toolbarState.handleFlipY}
            onRotateLeft={toolbarState.handleRotateLeft}
            onRotateRight={toolbarState.handleRotateRight}
            onRotateLeftLongPress={toolbarState.handleRotateLeftLongPress}
            onRotateRightLongPress={toolbarState.handleRotateRightLongPress}
            onRecentEmojiPress={toolbarState.handleRecentEmojiPress}
            recentEmojis={toolbarState.recentEmojis}
            mirrorX={toolbarState.mirrorX}
            mirrorY={toolbarState.mirrorY}
            autoRotateEnabled={toolbarState.autoRotateEnabled}
            autoRotateDirection={toolbarState.autoRotateDirection}
            brushEmoji={toolbarState.brushEmoji}
            handMode={handMode}
            isLandscape={false}
            suppressRandomHelper={emojiPickerState.emojiPickerVisible}
            tutorialActive={toolbarState.tutorialActive}
            tutorialCurrentLesson={toolbarState.tutorialCurrentLesson}
            tutorialBlinkScale={toolbarState.tutorialBlinkScale}
            tutorialBlinkOpacity={toolbarState.tutorialBlinkOpacity}
          />
        </View>
      ) : null}

      <CanvasViewport
        canvasBackgroundColor={canvasBackgroundColor}
        width={canvasSize}
        height={canvasSize * canvasRatio}
        strokes={strokes}
        liveStroke={liveStroke}
        liveVersion={liveVersion}
        previewStroke={previewStroke}
        canvasGesture={gestures.canvasGesture}
        canvasAnimatedStyle={gestures.canvasAnimatedStyle}
        panHandlers={gestures.panHandlers}
        trace={traceState.trace}
        traceGesture={gestures.traceGesture}
        traceAnimatedStyle={gestures.traceAnimatedStyle}
        traceLoading={traceState.traceLoading}
        traceLoadingMessage={traceState.traceLoadingMessage}
        showTraceControls={traceState.showTraceControls}
        isTraceAdjusting={traceState.isTraceAdjusting}
        onZoomUpdate={gestures.onZoomUpdate}
        watermarkLetter={watermarkLetter}
        emojiPlanes={emojiPlanes}
        selectedPlaneId={selectedPlaneId}
        isEmojiPlaneActive={toolbarState.isEmojiPlaneActive}
        draggingCorner={draggingCorner}
        forceSkia={forceSkia}
        onPlaneCornerDragStart={onPlaneCornerDragStart}
        onPlaneCornerDrag={onPlaneCornerDrag}
        onPlaneCornerDragEnd={onPlaneCornerDragEnd}
        styles={styles}
      />

      {/* Polygon tool overlay - dots rendered inside canvas coordinate space */}
      {polygonPoints && polygonPoints.length > 0 && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: canvasSize,
          height: canvasSize,
          pointerEvents: 'none'
        }}>
          {polygonPoints.map((p, i) => {
            // Points are already in canvas coordinates (0 to canvasSize)
            const isFirst = i === 0;
            const size = isFirst ? 24 : 16;
            return (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  left: p.x - size / 2,
                  top: p.y - size / 2,
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: isFirst ? '#00ff00' : '#ffffff',
                  borderWidth: 2,
                  borderColor: '#000000',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.5,
                  shadowRadius: 3
                }}
              />
            );
          })}
        </View>
      )}


      {showBrushControls ? (
        <>
          <RNAnimated.View style={{
            position: 'absolute',
            bottom: isIpad && isLandscape ? sliderBottomAnim : (() => {
              // Portrait mode positioning - moved 150px up on iPad portrait
              return frameMode ? (isIpad ? 200 : 140) : (isIpad ? 180 : 70);
            })(),
            left: 0,
            right: 0
          }}>
            <BrushControls
              styles={styles}
              hitSlop={hitSlop}
              brushSize={brushControlsState.brushSize}
              sizeInput={brushControlsState.sizeInput}
              sizeSliderMaximum={brushControlsState.sizeSliderMaximum}
              onSizeSliderChange={(value) => {
                const next = Math.round(value);
                brushControlsState.setSizeInput(String(next));
                brushControlsState.dispatchSetBrushSize(next);
                brushControlsState.onBrushPreview?.(next);
              }}
              onSizeSliderComplete={(value) => {
                const next = Math.round(value);
                brushControlsState.onBrushPreviewComplete?.(next);
              }}
              onSizeInputChange={(text) => brushControlsState.setSizeInput(text.replace(/[^0-9]/g, ''))}
              onSizeInputSubmit={() => {
                const parsed = Number(brushControlsState.sizeInput);
                const maxSize = brushControlsState.sizeSliderMaximum ?? 150;
                if (Number.isFinite(parsed)) {
                  const clamped = Math.min(maxSize, Math.max(1, Math.round(parsed)));
                  brushControlsState.setSizeInput(String(clamped));
                  brushControlsState.dispatchSetBrushSize(clamped);
                  brushControlsState.onBrushPreview?.(clamped);
                } else {
                  brushControlsState.setSizeInput(String(brushControlsState.brushSize));
                }
                brushControlsState.setSizeInputFocused(false);
                const finalSize = Number.isFinite(parsed)
                  ? Math.min(maxSize, Math.max(1, Math.round(parsed)))
                  : brushControlsState.brushSize;
                brushControlsState.onBrushPreviewComplete?.(finalSize);
              }}
              onSizeInputFocus={() => brushControlsState.setSizeInputFocused(true)}
              onSizeInputBlur={() => brushControlsState.setSizeInputFocused(false)}
              onToggleOpacity={brushControlsState.toggleBrushOpacity}
              isOpacityTransparent={brushControlsState.isOpacityMostlyTransparent}
              opacityToggleEmoji={brushControlsState.opacityToggleEmoji}
              smudgeActive={brushControlsState.smudgeActive}
              smudgeSmoothness={brushControlsState.smudgeSmoothness}
              onSmudgeSmoothnessChange={brushControlsState.onSmudgeSmoothnessChange}
              spacingSlider={brushControlsState.spacingSlider}
              handMode={handMode}
              isIpad={isIpad}
              isLandscape={isLandscape}
              brushEmoji={emojiPickerState.brushEmoji}
              onEmojiPickerOpen={emojiPickerState.onEmojiPickerOpen || (() => emojiPickerState.setEmojiPickerVisible(true))}
              tutorialActive={brushControlsState.tutorialActive}
              tutorialCurrentLesson={brushControlsState.tutorialCurrentLesson}
              tutorialBlinkScale={brushControlsState.tutorialBlinkScale}
              tutorialBlinkOpacity={brushControlsState.tutorialBlinkOpacity}
            />
          </RNAnimated.View>

        </>
      ) : null}

      {/* Standalone Trace Controls Panel */}
      {traceState.trace.imageUri && traceState.showTraceControls ? (
        <View style={{
          position: 'absolute',
          bottom: (() => {
            const baseBottom = Platform.OS === 'ios' && (Platform as any)?.isPad ? 220 : 120;
            if (isIpad && isLandscape) {
              return baseBottom - (screenHeight * 0.20); // 20% lower in landscape
            }
            return baseBottom;
          })(),
          left: 0,
          right: 0,
          paddingHorizontal: 12,
          alignItems: 'center',
          pointerEvents: 'box-none',
          zIndex: 20 // Above topics overlay (zIndex: 10)
        }}>
          <View style={{
            backgroundColor: `${colors.surface}B2`,
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 14,
            gap: 16,
            width: '100%',
            maxWidth: Math.min(600, canvasSize + 24),
            shadowColor: colors.background,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 8,
            elevation: 5
          }}>
            {/* Mode Toggle Row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                onPress={traceState.handleTraceToggleBackground}
                accessibilityRole="button"
                accessibilityLabel={traceState.trace.isBackground ? 'Switch to trace mode' : 'Switch to background mode'}
                hitSlop={hitSlop}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: traceState.trace.isBackground ? '#0a84ff' : colors.border
                }}
              >
                <Text style={{ fontSize: 16 }}>{traceState.trace.isBackground ? '🌅' : '🔍'}</Text>
                <Text style={{
                  color: traceState.trace.isBackground ? '#ffffff' : colors.textSecondary,
                  fontSize: 12,
                  fontFamily: 'vrtlfinal',
                  fontWeight: '600'
                }}>
                  {traceState.trace.isBackground ? 'Background' : 'Trace'}
                </Text>
              </TouchableOpacity>
              <Text style={{
                color: colors.textSecondary,
                fontSize: 10,
                flex: 1.2,
                fontFamily: 'vrtlfinal',
                textAlign: 'center'
              }}>
                {traceState.trace.isBackground
                  ? 'Image behind strokes — included in exports'
                  : 'Semi-transparent overlay — for drawing reference'}
              </Text>
            </View>

            {/* Scale Slider Row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 20, width: 28, textAlign: 'center', opacity: 0.6 }} accessibilityLabel="Trace scale">↔️</Text>
              <Slider
                style={{ flex: 1, height: 40 }}
                minimumValue={traceState.minTraceScale}
                maximumValue={traceState.maxTraceScale}
                step={0.01}
                value={traceState.trace.scale}
                minimumTrackTintColor="#30d158"
                maximumTrackTintColor={colors.border}
                thumbTintColor="#30d158"
                onValueChange={traceState.handleTraceScaleChange}
                accessibilityLabel="Trace scale"
                accessibilityHint="Adjust trace size"
              />
              <TouchableOpacity
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  backgroundColor: '#30d158',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
                onPress={traceState.handleTraceConfirm}
                accessibilityRole="button"
                accessibilityLabel="Lock trace and hide controls"
                hitSlop={hitSlop}
              >
                <Text style={{ fontSize: 20 }}>✔️</Text>
              </TouchableOpacity>
            </View>
            {/* Opacity Slider Row - hidden in background mode (fully opaque) */}
            {!traceState.trace.isBackground ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 20, width: 28, textAlign: 'center', opacity: 0.6 }} accessibilityLabel="Trace opacity">🖼️</Text>
              <Slider
                style={[
                  { flex: 1, height: 40 },
                  isIpad && { flex: 1.5 } // 50% longer on iPad
                ]}
                minimumValue={0}
                maximumValue={1}
                step={0.01}
                value={traceState.trace.opacity}
                minimumTrackTintColor="#ff9f6b"
                maximumTrackTintColor={colors.border}
                thumbTintColor="#ff9f6b"
                onValueChange={traceState.handleTraceOpacityChange}
                accessibilityLabel="Trace opacity"
                accessibilityHint="Adjust trace transparency"
              />
              <TouchableOpacity
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  backgroundColor: '#ff3b30',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
                onPress={traceState.handleTraceRemove}
                accessibilityRole="button"
                accessibilityLabel="Remove trace image"
                hitSlop={hitSlop}
              >
                <Text style={{ fontSize: 20 }}>🗑️</Text>
              </TouchableOpacity>
            </View>
            ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
              <TouchableOpacity
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  backgroundColor: '#ff3b30',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
                onPress={traceState.handleTraceRemove}
                accessibilityRole="button"
                accessibilityLabel="Remove background image"
                hitSlop={hitSlop}
              >
                <Text style={{ fontSize: 20 }}>🗑️</Text>
              </TouchableOpacity>
            </View>
            )}
          </View>
        </View>
      ) : null}

      {/* Quick Actions - vertical on left/right in landscape based on hand mode */}
      <View style={{
        ...(isIpad && isLandscape ? {
          // Landscape: vertical stack at edge (left for right-hand, right for left-hand)
          position: 'absolute',
          ...(handMode === 'left' ? {
            right: -screenWidth * 0.20
          } : {
            left: -screenWidth * 0.20
          }),
          bottom: handMode === 'right' ? 200 - (screenHeight * 0.05) : 200, // Right-handed: 5% down
          top: toolbarState.topInset + 20,
          width: 60,
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: 'center'
        } : {
          // Portrait: horizontal bar at bottom
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0
        })
      }}>
        {customQuickActions ?? (
          <QuickActionsStrip
            styles={styles}
            actions={quickActions}
            hitSlop={hitSlop}
            infoPulseScale={quickActionsState.infoPulseScale}
            infoPulseOpacity={quickActionsState.infoPulseOpacity}
            emojiBounceScale={quickActionsState.emojiBounceScale}
            onInfoButtonLayout={quickActionsState.onInfoButtonLayout}
            isLandscape={isIpad && isLandscape}
          />
        )}
      </View>

      <EmojiPickerModal
        visible={emojiPickerState.emojiPickerVisible}
        styles={styles}
        emojiSearch={emojiPickerState.emojiSearch}
        onEmojiSearchChange={emojiPickerState.setEmojiSearch}
        recentEmojis={emojiPickerState.recentEmojis}
        brushEmoji={emojiPickerState.brushEmoji}
        emojiResults={emojiPickerState.emojiResults}
        onSelectEmoji={emojiPickerState.handleEmojiSelect}
        onLoadCustomBrushToWorkspace={emojiPickerState.onLoadCustomBrushToWorkspace}
        onClose={() => emojiPickerState.setEmojiPickerVisible(false)}
        hitSlop={hitSlop}
        mirrorX={emojiPickerState.mirrorX}
        mirrorY={emojiPickerState.mirrorY}
        rotation={emojiPickerState.rotation}
        onToggleMirrorX={emojiPickerState.onToggleMirrorX}
        onToggleMirrorY={emojiPickerState.onToggleMirrorY}
        spacingSlider={emojiPickerState.spacingSlider}
        onTurnLeft={emojiPickerState.onTurnLeft}
        onTurnRight={emojiPickerState.onTurnRight}
      />
    </>
  );
};

export default PaintingWorkspace;
