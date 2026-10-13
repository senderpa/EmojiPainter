/**
 * Timeline Component
 *
 * Visual timeline with scrubbing playhead and crop handles
 * Based on emojipaintD TimelineView (animator.ts lines 703-728)
 */

import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions, PanResponder, GestureResponderEvent, LayoutChangeEvent, Platform } from 'react-native';
import { Canvas, Rect, Line, vec, RoundedRect } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { clampPlaneLifetime, normalizePlaneFrame, planeLifetimeWraps } from './emojiPlaneTimeline';

const IS_MOBILE = Platform.OS === 'ios' && !Platform.isPad;

const TIMELINE_HEIGHT = 48;
const PLAYHEAD_WIDTH = 4; // Thicker for visibility
const HANDLE_WIDTH = 24; // Larger handles for easier grabbing
const HANDLE_EXTRA_HEIGHT = 12; // Extra height above/below timeline for easier grabbing
const HANDLE_HIT_AREA = IS_MOBILE ? 80 : 60; // Even larger on mobile: 80px touch area
const PLAYHEAD_HIT_AREA = 35; // Smaller than handles so handles take priority
const HANDLE_TOUCH_TARGET_HEIGHT = 80; // Tall touch target for handles

interface EmojiPlaneKeyframe {
  frame: number;
  corners: any;
  opacity: number;
}

interface EmojiPlane {
  id: string;
  emoji: string;
  birthFrame: number;
  lifetime: number;
  zIndex: number;
  keyframes: EmojiPlaneKeyframe[];
}

interface TimelineProps {
  frameCount: number;
  currentFrame: number;
  cropStart: number;
  cropEnd: number;
  onScrub: (frame: number) => void;
  onCropChange: (start: number, end: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  emojiPlanes?: EmojiPlane[];
  selectedPlaneId?: string | null;
  emojiPlaneToolActive?: boolean;
  isRecording?: boolean; // Auto-recording mode indicator
}

const Timeline: React.FC<TimelineProps> = ({
  frameCount,
  currentFrame,
  cropStart,
  cropEnd,
  onScrub,
  onCropChange,
  isPlaying,
  setIsPlaying,
  emojiPlanes = [],
  selectedPlaneId = null,
  emojiPlaneToolActive = false,
  isRecording = false
}) => {
  // Make timeline width responsive to device rotation
  const [timelineWidth, setTimelineWidth] = useState(Dimensions.get('window').width - 32);

  // Update timeline width on dimension changes (rotation)
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setTimelineWidth(window.width - 32);
      console.log('[TIMELINE] Width updated to:', window.width - 32);
    });

    return () => subscription?.remove();
  }, []);

  // Use REF for dragging state - immediate updates, no async delays!
  const draggingHandleRef = useRef<'start' | 'end' | 'playhead' | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | 'playhead' | null>(null);
  const [hoveringHandle, setHoveringHandle] = useState<'start' | 'end' | 'playhead' | null>(null);

  // Store drag offset: difference between touch position and handle position when grab starts
  const dragOffsetRef = useRef<number>(0);

  // Track if playback was active before scrubbing started
  const wasPlayingBeforeScrubRef = useRef<boolean>(false);

  // Double-tap detection
  const lastTapTimeRef = useRef<number>(0);
  const lastTapXRef = useRef<number>(0);
  const DOUBLE_TAP_DELAY = 300; // Max 300ms between taps
  const DOUBLE_TAP_DISTANCE = 50; // Max 50px between taps

  // Helper to set dragging state (both ref and state)
  const setDragging = useCallback((handle: 'start' | 'end' | 'playhead' | null) => {
    draggingHandleRef.current = handle; // Immediate!
    setDraggingHandle(handle); // For UI
  }, []);

  // Helper: Check if touch is within handle hit zone
  const isInHandleZone = useCallback((touchX: number, handleX: number): boolean => {
    return Math.abs(touchX - handleX) <= HANDLE_HIT_AREA; // Large touch area for easy grabbing
  }, []);

  // Helper: Check if touch is within playhead hit zone (larger than handles)
  const isInPlayheadZone = useCallback((touchX: number, playheadX: number): boolean => {
    return Math.abs(touchX - playheadX) <= PLAYHEAD_HIT_AREA; // Extra large for thin playhead
  }, []);

  // Calculate positions
  const playheadX = (currentFrame / Math.max(1, frameCount - 1)) * timelineWidth;
  const cropStartX = (cropStart / Math.max(1, frameCount - 1)) * timelineWidth;
  const cropEndX = ((cropEnd - 1) / Math.max(1, frameCount - 1)) * timelineWidth;

  // Pan responder for scrubbing and handle dragging - RECREATE when positions change
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt: GestureResponderEvent) => {
          const x = evt.nativeEvent.locationX;
          const now = Date.now();

          // Check for double-tap
          const timeSinceLastTap = now - lastTapTimeRef.current;
          const distanceFromLastTap = Math.abs(x - lastTapXRef.current);

          if (timeSinceLastTap < DOUBLE_TAP_DELAY && distanceFromLastTap < DOUBLE_TAP_DISTANCE) {
            // Double-tap detected! Toggle play/pause
            console.log('[TIMELINE] ⏯️ Double-tap detected! Toggling playback');
            setIsPlaying(!isPlaying);
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

            // Reset tap tracking
            lastTapTimeRef.current = 0;
            lastTapXRef.current = 0;
            return; // Don't do any scrubbing or handle grabbing
          }

          // Save tap time and position for next tap
          lastTapTimeRef.current = now;
          lastTapXRef.current = x;

          // Save current play state and pause playback during scrubbing
          wasPlayingBeforeScrubRef.current = isPlaying;
          if (isPlaying) {
            setIsPlaying(false);
            console.log('[TIMELINE] ⏸️ Paused playback for scrubbing');
          }

          const distToStart = Math.abs(x - cropStartX);
          const distToEnd = Math.abs(x - cropEndX);
          const distToPlayhead = Math.abs(x - playheadX);

          console.log(`[TIMELINE] 🎯 Touch at x=${x.toFixed(0)}`);
          console.log(`[TIMELINE] Distances: Start=${distToStart.toFixed(0)}px, End=${distToEnd.toFixed(0)}px, Playhead=${distToPlayhead.toFixed(0)}px`);
          console.log(`[TIMELINE] Positions: Start=${cropStartX.toFixed(0)}, End=${cropEndX.toFixed(0)}, Playhead=${playheadX.toFixed(0)}`);

          // Priority order: CLOSEST handle wins!
          // 1. Check START crop handle (within 50px)
          if (distToStart <= HANDLE_HIT_AREA && distToStart <= distToEnd && distToStart <= distToPlayhead) {
            console.log('[TIMELINE] 🟠 Grabbed START crop handle (closest)');
            dragOffsetRef.current = x - cropStartX; // Store offset between touch and handle
            console.log(`[TIMELINE] 📏 Drag offset: ${dragOffsetRef.current.toFixed(1)}px`);
            setDragging('start'); // Use ref+state setter
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            return; // STOP HERE - don't scrub!
          }

          // 2. Check END crop handle (within 50px)
          if (distToEnd <= HANDLE_HIT_AREA && distToEnd <= distToPlayhead) {
            console.log('[TIMELINE] 🟠 Grabbed END crop handle (closest)');
            dragOffsetRef.current = x - cropEndX; // Store offset between touch and handle
            console.log(`[TIMELINE] 📏 Drag offset: ${dragOffsetRef.current.toFixed(1)}px`);
            setDragging('end'); // Use ref+state setter
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            return; // STOP HERE - don't scrub!
          }

          // 3. Check playhead (within 35px)
          if (distToPlayhead <= PLAYHEAD_HIT_AREA) {
            console.log('[TIMELINE] 🟢 Grabbed PLAYHEAD');
            dragOffsetRef.current = x - playheadX; // Store offset between touch and handle
            setDragging('playhead'); // Use ref+state setter
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            return; // STOP HERE - don't scrub!
          }

          // 4. Otherwise scrub timeline (LOWEST PRIORITY)
          console.log('[TIMELINE] ⏩ Timeline scrub (no handles nearby)');
          setDragging(null); // Not dragging anything
          dragOffsetRef.current = 0; // No offset for direct scrubbing
          const frame = Math.floor((x / timelineWidth) * frameCount);
          onScrub(Math.max(0, Math.min(frameCount - 1, frame)));
          void Haptics.selectionAsync();
        },
        onPanResponderMove: (evt: GestureResponderEvent) => {
          const x = evt.nativeEvent.locationX;

          // Use REF (not state!) for immediate, synchronous value
          const currentDragging = draggingHandleRef.current;

          if (currentDragging === 'start') {
            // Dragging left crop handle - apply offset to maintain grab position
            const adjustedX = x - dragOffsetRef.current;
            const t = Math.max(0, Math.min(1, adjustedX / timelineWidth));
            const frame = Math.floor(t * frameCount);
            const newStart = Math.max(0, Math.min(cropEnd - 1, frame));
            console.log(`[TIMELINE] 🟠 Moving START crop handle: x=${x.toFixed(0)}, offset=${dragOffsetRef.current.toFixed(1)}, adjustedX=${adjustedX.toFixed(0)}, ${cropStart} → ${newStart}`);
            onCropChange(newStart, cropEnd);
          } else if (currentDragging === 'end') {
            // Dragging right crop handle - apply offset to maintain grab position
            const adjustedX = x - dragOffsetRef.current;
            const t = Math.max(0, Math.min(1, adjustedX / timelineWidth));
            const frame = Math.floor(t * frameCount);
            const newEnd = Math.max(cropStart + 1, Math.min(frameCount, frame + 1));
            console.log(`[TIMELINE] 🟠 Moving END crop handle: x=${x.toFixed(0)}, offset=${dragOffsetRef.current.toFixed(1)}, adjustedX=${adjustedX.toFixed(0)}, ${cropEnd} → ${newEnd}`);
            onCropChange(cropStart, newEnd);
          } else if (currentDragging === 'playhead') {
            // Dragging playhead to scrub - apply offset to maintain grab position
            const adjustedX = x - dragOffsetRef.current;
            const t = Math.max(0, Math.min(1, adjustedX / timelineWidth));
            const frame = Math.floor(t * frameCount);
            console.log(`[TIMELINE] 🟢 Dragging playhead: x=${x.toFixed(0)}, offset=${dragOffsetRef.current.toFixed(1)}, adjustedX=${adjustedX.toFixed(0)}, frame=${frame}`);
            onScrub(Math.max(0, Math.min(frameCount - 1, frame)));
          }
          // REMOVED else branch that was causing scrubbing when not dragging anything

          // Update hover state for visual feedback during drag
          if (draggingHandle) {
            // Keep current dragging state, don't change hover
            // This prevents losing the handle during drag
          } else {
            if (isInHandleZone(x, cropStartX)) {
              setHoveringHandle('start');
            } else if (isInHandleZone(x, cropEndX)) {
              setHoveringHandle('end');
            } else if (isInPlayheadZone(x, playheadX)) {
              setHoveringHandle('playhead');
            } else {
              setHoveringHandle(null);
            }
          }
        },
        onPanResponderRelease: () => {
          console.log('[TIMELINE] 🏁 Released handle');
          setDragging(null); // Clear ref+state
          setHoveringHandle(null);

          // Restore previous play state
          if (wasPlayingBeforeScrubRef.current) {
            setIsPlaying(true);
            console.log('[TIMELINE] ▶️ Resumed playback after scrubbing');
          }
        },
        onPanResponderTerminate: () => {
          console.log('[TIMELINE] ⚠️ Gesture terminated');
          setDragging(null); // Clear ref+state
          setHoveringHandle(null);

          // Restore previous play state
          if (wasPlayingBeforeScrubRef.current) {
            setIsPlaying(true);
            console.log('[TIMELINE] ▶️ Resumed playback after gesture termination');
          }
        }
      }),
    [cropStartX, cropEndX, playheadX, timelineWidth, frameCount, cropStart, cropEnd, draggingHandle, onScrub, onCropChange, isPlaying, setIsPlaying]
  );

  // Calculate frame dividers (show max 100 dividers)
  const dividerStep = Math.max(1, Math.floor(frameCount / 100));
  const dividers: number[] = [];
  for (let i = 0; i < frameCount; i += dividerStep) {
    const x = (i / Math.max(1, frameCount - 1)) * timelineWidth;
    dividers.push(x);
  }

  // Handle layout changes to get accurate width
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0 && width !== timelineWidth) {
      setTimelineWidth(width);
      console.log('[TIMELINE] Layout width updated to:', width);
    }
  }, [timelineWidth]);

  // Calculate offset to center timeline in taller container
  const timelineOffsetY = (HANDLE_TOUCH_TARGET_HEIGHT - TIMELINE_HEIGHT) / 2;

  return (
    <View
      style={styles.container}
      {...panResponder.panHandlers}
      onTouchStart={() => console.log('[TIMELINE] ⚡ Touch START detected on timeline container')}
      onLayout={handleLayout}
      collapsable={false}
    >
      <Canvas style={{ width: timelineWidth, height: TIMELINE_HEIGHT, pointerEvents: 'none', marginTop: timelineOffsetY }}>
        {/* Background */}
        <Rect
          x={0}
          y={0}
          width={timelineWidth}
          height={TIMELINE_HEIGHT}
          color="#050505"
        />

        {/* Frame dividers */}
        {dividers.map((x, index) => (
          <Line
            key={index}
            p1={vec(x, 0)}
            p2={vec(x, TIMELINE_HEIGHT)}
            color="#1a1a1a"
            style="stroke"
            strokeWidth={1}
          />
        ))}

        {/* Emoji Plane Markers - show birth and lifetime (staggered vertically) */}
        {emojiPlanes.map((plane, index) => {
          const birthFrame = normalizePlaneFrame(plane.birthFrame, cropStart, cropEnd);
          const lifetime = clampPlaneLifetime(plane.lifetime, cropStart, cropEnd);
          const startX = (birthFrame / frameCount) * timelineWidth;
          const isShort = lifetime <= 3;
          const wraps = planeLifetimeWraps(birthFrame, lifetime, cropStart, cropEnd);
          const firstEnd = wraps ? cropEnd : birthFrame + lifetime;
          const segments = [{ start: birthFrame, end: firstEnd }];
          if (wraps) segments.push({ start: cropStart, end: cropStart + (birthFrame + lifetime - cropEnd) });

          // Stagger each plane marker up by 2px per index
          const yOffset = index * 2;
          const baseY = TIMELINE_HEIGHT - 4;

          return (
            <React.Fragment key={plane.id}>
              {isShort ? (
                // Short lifetime: show as a dot
                <Rect
                  x={startX - 2}
                  y={baseY - 2 - yOffset}
                  width={4}
                  height={4}
                  color="#ff6b6b"
                  opacity={0.8}
                />
              ) : (
                // Wrapped lifetimes are two joined logical segments, one on each timeline edge.
                segments.map((segment, segmentIndex) => {
                  const x = (segment.start / frameCount) * timelineWidth;
                  const endX = (segment.end / frameCount) * timelineWidth;
                  return <Rect
                    key={`plane-segment-${segmentIndex}`}
                    x={x}
                    y={baseY - yOffset}
                    width={Math.max(1, endX - x)}
                    height={2}
                    color="#ff6b6b"
                    opacity={0.7}
                  />;
                })
              )}
            </React.Fragment>
          );
        })}

        {/* Yellow Keyframe Display - show dots normally, line only during recording */}
        {emojiPlaneToolActive && selectedPlaneId && (() => {
          const selectedPlane = emojiPlanes.find(p => p.id === selectedPlaneId);
          if (!selectedPlane || !selectedPlane.keyframes || selectedPlane.keyframes.length === 0) {
            return null;
          }

          // Only show line when RECORDING and PLAYING (auto-recording mode)
          if (isRecording && isPlaying) {
            // When recording: show a single yellow line across all keyframes
            const firstFrame = selectedPlane.keyframes[0].frame;
            const lastFrame = selectedPlane.keyframes[selectedPlane.keyframes.length - 1].frame;
            const firstAbsoluteFrame = normalizePlaneFrame(selectedPlane.birthFrame + firstFrame, cropStart, cropEnd);
            const lastAbsoluteFrame = normalizePlaneFrame(selectedPlane.birthFrame + lastFrame, cropStart, cropEnd);
            const lineStartX = (firstAbsoluteFrame / frameCount) * timelineWidth;
            const lineEndX = (lastAbsoluteFrame / frameCount) * timelineWidth;
            const lineWidth = Math.max(1, lineEndX - lineStartX);

            return (
              <Rect
                key="keyframe-line"
                x={lineStartX}
                y={8}
                width={lineWidth}
                height={2}
                color="#ffd700"
                opacity={0.8}
              />
            );
          } else {
            // Always show individual dots (default behavior)
            return selectedPlane.keyframes.map((keyframe, index) => {
              const absoluteFrame = normalizePlaneFrame(selectedPlane.birthFrame + keyframe.frame, cropStart, cropEnd);
              const keyframeX = (absoluteFrame / frameCount) * timelineWidth;

              return (
                <Rect
                  key={`keyframe-${selectedPlane.id}-${index}`}
                  x={keyframeX - 3}
                  y={4}
                  width={6}
                  height={6}
                  color="#ffd700"
                  opacity={0.9}
                />
              );
            });
          }
        })()}

        {/* Playhead (green vertical line - drawn FIRST so it's underneath handles) */}
        <Rect
          x={playheadX - (hoveringHandle === 'playhead' || draggingHandle === 'playhead' ? 10 : PLAYHEAD_WIDTH) / 2}
          y={0}
          width={hoveringHandle === 'playhead' || draggingHandle === 'playhead' ? 10 : PLAYHEAD_WIDTH}
          height={TIMELINE_HEIGHT}
          color={draggingHandle === 'playhead' ? '#00ff00' : (hoveringHandle === 'playhead' ? '#22c55e' : '#4ade80')}
        />

        {/* Orange crop frame outline (animator.ts line 709-711) */}
        <Rect
          x={cropStartX}
          y={0}
          width={cropEndX - cropStartX}
          height={TIMELINE_HEIGHT}
          style="stroke"
          strokeWidth={2}
          color="#ff8c00"
        />

        {/* Left crop handle - EXTENDS ABOVE/BELOW - drawn LAST so it's on top */}
        <Rect
          x={cropStartX - HANDLE_WIDTH / 2}
          y={-HANDLE_EXTRA_HEIGHT}
          width={HANDLE_WIDTH}
          height={TIMELINE_HEIGHT + (HANDLE_EXTRA_HEIGHT * 2)}
          color={hoveringHandle === 'start' || draggingHandle === 'start' ? '#ffcc00' : '#ff8c00'}
        />

        {/* Right crop handle - EXTENDS ABOVE/BELOW - drawn LAST so it's on top */}
        <Rect
          x={cropEndX - HANDLE_WIDTH / 2}
          y={-HANDLE_EXTRA_HEIGHT}
          width={HANDLE_WIDTH}
          height={TIMELINE_HEIGHT + (HANDLE_EXTRA_HEIGHT * 2)}
          color={hoveringHandle === 'end' || draggingHandle === 'end' ? '#ffcc00' : '#ff8c00'}
        />
      </Canvas>

      {/* Invisible touch targets for crop handles - positioned in FOREGROUND with higher z-index */}
      {/* Left crop handle touch target */}
      <View
        style={{
          position: 'absolute',
          left: cropStartX - HANDLE_HIT_AREA / 2,
          top: 0, // Start at container top (container is now full touch target height)
          width: HANDLE_HIT_AREA,
          height: HANDLE_TOUCH_TARGET_HEIGHT,
          zIndex: 100, // Always on top
          // backgroundColor: 'rgba(255, 0, 0, 0.2)', // Debug: uncomment to visualize
        }}
        pointerEvents="box-none" // Allow touches to pass through to PanResponder
      />

      {/* Right crop handle touch target */}
      <View
        style={{
          position: 'absolute',
          left: cropEndX - HANDLE_HIT_AREA / 2,
          top: 0, // Start at container top (container is now full touch target height)
          width: HANDLE_HIT_AREA,
          height: HANDLE_TOUCH_TARGET_HEIGHT,
          zIndex: 100, // Always on top
          // backgroundColor: 'rgba(0, 255, 0, 0.2)', // Debug: uncomment to visualize
        }}
        pointerEvents="box-none" // Allow touches to pass through to PanResponder
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%', // Take full available width
    height: HANDLE_TOUCH_TARGET_HEIGHT, // Use full touch target height so handles are always reachable
    borderRadius: 10,
    overflow: 'visible', // Changed from 'hidden' to allow touch events
    marginVertical: 8,
    justifyContent: 'center', // Center the timeline content vertically
    backgroundColor: 'transparent' // Transparent so only timeline bar shows, not extended area
  }
});

export default Timeline;
