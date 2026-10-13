import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, LayoutChangeEvent, PanResponder, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import CustomAnimatorSlider from './CustomAnimatorSlider';

import PaintCanvas from '../workspace/PaintCanvas';
import type { Stroke } from '../state/PaintingContext';
import { FrameBuffer, type AnimatorStroke, type BrushSnapshot, type GlyphSample } from './FrameBuffer';
import { AnimatorRenderer, NoopAnimatorRenderer, type GlyphInstance } from './AnimatorRenderer';

type Props = {
  frameBuffer: FrameBuffer;
  renderer?: AnimatorRenderer;
  isLooping: boolean;
  fps: number;
  strokeLength: number;
  totalFrames: number;
  playhead: number;
  brush: BrushSnapshot;
  onToggleLoop: () => void;
  onChangeFps: (fps: number) => void;
  onChangeStrokeLength: (value: number) => void;
  onChangeTotalFrames: (value: number) => void;
  onChangePlayhead: (value: number) => void;
  onClose: () => void;
  onTogglePlayback: () => void;
  onSetPlaybackState?: (next: boolean) => void;
  isPlaying: boolean;
};

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const stageSize = Math.min(screenWidth, screenHeight * 0.7);
const SAMPLE_SPACING_RATIO = 0.2;
const MIN_SAMPLE_SPACING = 0.8;
const TEXT_FONT = 'vrtlfinal';
const HANDLE_WIDTH = 20;

type StrokeCacheEntry = {
  version: number;
  stroke: Stroke;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeFrameIndex = (frame: number, total: number) => {
  if (total <= 0) return 0;
  const mod = frame % total;
  return mod < 0 ? mod + total : mod;
};

const strokeMatchesFrame = (stroke: AnimatorStroke, frameIndex: number, totalFrames: number) => {
  if (stroke.duration === -1 || stroke.isBackground) {
    return true;
  }
  const normalizedStart = normalizeFrameIndex(stroke.startFrame, totalFrames);
  const duration = Math.max(1, stroke.duration);
  const endInclusive = normalizedStart + duration;
  if (endInclusive <= totalFrames) {
    return frameIndex >= normalizedStart && frameIndex < endInclusive;
  }
  const overflow = endInclusive % totalFrames;
  return frameIndex >= normalizedStart || frameIndex < overflow;
};

const convertAnimatorStrokeToCanvasStroke = (
  stroke: AnimatorStroke,
  cache: Map<string, StrokeCacheEntry>
): Stroke | null => {
  const version = stroke.samples.length;
  const cached = cache.get(stroke.id);
  if (cached && cached.version === version) {
    return cached.stroke;
  }
  if (version === 0) {
    return null;
  }
  const emojiSequence = stroke.samples.map((sample) => sample.emoji);
  const points = stroke.samples.map((sample) => ({
    x: sample.x,
    y: sample.y,
    t: sample.t,
    w: sample.size
  }));
  const converted: Stroke = {
    id: stroke.id,
    emoji: stroke.brush.emoji,
    size: stroke.brush.size,
    opacity: stroke.brush.opacity,
    spacing: stroke.brush.spacing,
    mirrorX: stroke.brush.mirrorX,
    mirrorY: stroke.brush.mirrorY,
    rotation: stroke.brush.rotation,
    points,
    emojiSequence
  };
  cache.set(stroke.id, { version, stroke: converted });
  return converted;
};

const resolveSampleSpacing = (brush: BrushSnapshot) => {
  const baseSize = Math.max(1, brush.size);
  const normalized = typeof brush.spacing === 'number' ? clamp(brush.spacing, 0, 1) : 0.15;
  const spacing = baseSize * SAMPLE_SPACING_RATIO * (0.6 + normalized * 0.8);
  return Math.max(MIN_SAMPLE_SPACING, spacing);
};

const computeCompositeStrokes = (
  buffer: FrameBuffer,
  frameIndex: number,
  totalFrames: number,
  cache: Map<string, StrokeCacheEntry>
) => {
  const composite: Stroke[] = [];
  const strokes = buffer.getStrokes();
  strokes.forEach((stroke) => {
    const converted = convertAnimatorStrokeToCanvasStroke(stroke, cache);
    if (!converted) {
      return;
    }
    if (stroke.isBackground || stroke.duration === -1) {
      composite.push(converted);
      return;
    }
    if (strokeMatchesFrame(stroke, frameIndex, totalFrames)) {
      composite.push(converted);
    }
  });
  return composite;
};

export const AnimatorWorkspace: React.FC<Props> = ({
  frameBuffer,
  renderer = new NoopAnimatorRenderer(),
  isLooping,
  fps,
  strokeLength,
  totalFrames,
  playhead,
  brush,
  onToggleLoop,
  onChangeFps,
  onChangeStrokeLength,
  onChangeTotalFrames,
  onChangePlayhead,
  onClose,
  onTogglePlayback,
  onSetPlaybackState,
  isPlaying
}) => {
  const [compositeRevision, setCompositeRevision] = useState(0);
  const [timelineWidth, setTimelineWidth] = useState(stageSize);
  const strokeCacheRef = useRef<Map<string, StrokeCacheEntry>>(new Map());
  const brushStateRef = useRef<BrushSnapshot>(brush);
  const frozenBrushRef = useRef<BrushSnapshot | null>(null);
  const stageRefreshQueuedRef = useRef(false);
  const playheadRef = useRef(playhead);
  const totalFramesRef = useRef(totalFrames);
  const strokeLengthRef = useRef(strokeLength);
  const fpsRef = useRef(fps);
  const timelineWidthRef = useRef(timelineWidth);
  const pointerActiveRef = useRef(false);
  const spacingCarryRef = useRef(0);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const activeBucketRef = useRef<{ id: string; stroke: AnimatorStroke } | null>(null);
  const gestureStrokeIdsRef = useRef<string[]>([]);
  const undoStackRef = useRef<string[][]>([]);
  const redoStackRef = useRef<string[][]>([]);
  const strokeArchiveRef = useRef<Map<string, AnimatorStroke>>(new Map());
  const [undoState, setUndoState] = useState({ undo: false, redo: false });
  const [cropRange, setCropRange] = useState<[number, number]>([
    0,
    Math.max(0, totalFrames - 1)
  ]);
  const cropRangeRef = useRef<[number, number]>([0, Math.max(0, totalFrames - 1)]);
  const dragHandleRef = useRef<{ type: 'start' | 'end'; frame: number } | null>(null);
  const playbackRafRef = useRef<number | null>(null);
  const playbackTimestampRef = useRef<number | null>(null);
  const playbackAccumulatorRef = useRef(0);

  useEffect(() => {
    brushStateRef.current = brush;
  }, [brush]);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  useEffect(() => {
    totalFramesRef.current = totalFrames;
  }, [totalFrames]);

  useEffect(() => {
    strokeLengthRef.current = strokeLength;
  }, [strokeLength]);

  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

  useEffect(() => {
    timelineWidthRef.current = timelineWidth;
  }, [timelineWidth]);

  useEffect(() => {
    cropRangeRef.current = cropRange;
    if (playhead < cropRange[0]) {
      onChangePlayhead(cropRange[0]);
    } else if (playhead > cropRange[1]) {
      onChangePlayhead(cropRange[1]);
    }
  }, [cropRange, onChangePlayhead, playhead]);

  useEffect(() => {
    setCropRange(([start, end]) => {
      const maxFrame = Math.max(0, totalFrames - 1);
      const nextStart = Math.min(start, maxFrame);
      const nextEnd = Math.max(nextStart, Math.min(end, maxFrame));
      cropRangeRef.current = [nextStart, nextEnd];
      return [nextStart, nextEnd];
    });
  }, [totalFrames]);

  const requestCompositeRefresh = useCallback(() => {
    if (stageRefreshQueuedRef.current) {
      return;
    }
    stageRefreshQueuedRef.current = true;
    requestAnimationFrame(() => {
      stageRefreshQueuedRef.current = false;
      setCompositeRevision((value) => value + 1);
    });
  }, []);

  const stageStrokes = useMemo(
    () => computeCompositeStrokes(frameBuffer, playhead, totalFrames, strokeCacheRef.current),
    [frameBuffer, playhead, totalFrames, compositeRevision]
  );

  useEffect(() => {
    void renderer.configure({ width: stageSize, height: stageSize });
  }, [renderer]);

  const ensureBucketForFrame = useCallback(
    (frameIndex: number) => {
      const existing = activeBucketRef.current;
      if (existing) {
        if (existing.stroke.isBackground || existing.stroke.startFrame === frameIndex) {
          return existing;
        }
      }
      const brushSnapshot = frozenBrushRef.current ?? brushStateRef.current;
      const rawDuration = strokeLengthRef.current;
      const duration =
        rawDuration === -1 ? -1 : Math.max(1, Math.min(totalFramesRef.current, rawDuration));
      const newStroke: Omit<AnimatorStroke, 'id'> = {
        brush: { ...brushSnapshot },
        startFrame: duration === -1 ? 0 : normalizeFrameIndex(frameIndex, totalFramesRef.current),
        duration,
        samples: [],
        isBackground: duration === -1
      };
      const strokeId = frameBuffer.addStroke(newStroke);
      const stored = frameBuffer.getStroke(strokeId);
      if (!stored) {
        return null;
      }
      activeBucketRef.current = { id: strokeId, stroke: stored };
      strokeArchiveRef.current.set(strokeId, stored);
      gestureStrokeIdsRef.current.push(strokeId);
      requestCompositeRefresh();
      return activeBucketRef.current;
    },
    [frameBuffer, requestCompositeRefresh]
  );

  const appendSample = useCallback(
    (point: { x: number; y: number }) => {
      const currentFrame =
        strokeLengthRef.current === -1 ? playheadRef.current : clamp(playheadRef.current, 0, totalFramesRef.current - 1);
      const bucket = ensureBucketForFrame(currentFrame);
      if (!bucket) {
        return;
      }
      const brushSnapshot = bucket.stroke.brush;
      const glyph: GlyphInstance = {
        emoji: brushSnapshot.emoji,
        x: point.x,
        y: point.y,
        size: brushSnapshot.size,
        opacity: brushSnapshot.opacity,
        rotation: brushSnapshot.rotation,
        mirrorX: brushSnapshot.mirrorX,
        mirrorY: brushSnapshot.mirrorY
      };
      const sample: GlyphSample = {
        emoji: glyph.emoji,
        x: glyph.x,
        y: glyph.y,
        size: glyph.size,
        opacity: glyph.opacity,
        rotation: glyph.rotation,
        mirrorX: glyph.mirrorX,
        mirrorY: glyph.mirrorY,
        dynamicEmoji: brushSnapshot.dynamicEmoji,
        anchor: { x: 0, y: 0 },
        t: Date.now()
      };
      bucket.stroke.samples.push(sample);
      void renderer.addGlyphToFrame(glyph, bucket.stroke.isBackground ? 0 : bucket.stroke.startFrame, bucket.stroke.duration);
      requestCompositeRefresh();
    },
    [ensureBucketForFrame, renderer, requestCompositeRefresh]
  );

  const appendInterpolatedSamples = useCallback(
    (point: { x: number; y: number }) => {
      const lastPoint = lastPointRef.current;
      const brushSnapshot = frozenBrushRef.current ?? brushStateRef.current;
      const spacing = resolveSampleSpacing(brushSnapshot);
      if (!lastPoint) {
        appendSample(point);
        lastPointRef.current = point;
        spacingCarryRef.current = 0;
        return;
      }
      const dx = point.x - lastPoint.x;
      const dy = point.y - lastPoint.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.001) {
        return;
      }
      let carry = spacingCarryRef.current;
      let travelled = spacing - carry;
      if (distance + carry < spacing) {
        spacingCarryRef.current = distance + carry;
        return;
      }
      const normX = dx / distance;
      const normY = dy / distance;
      while (travelled <= distance) {
        const samplePoint = {
          x: lastPoint.x + normX * travelled,
          y: lastPoint.y + normY * travelled
        };
        appendSample(samplePoint);
        travelled += spacing;
      }
      spacingCarryRef.current = distance + carry - (travelled - spacing);
      lastPointRef.current = point;
    },
    [appendSample]
  );

  const finalizeGesture = useCallback(() => {
    pointerActiveRef.current = false;
    spacingCarryRef.current = 0;
    lastPointRef.current = null;
    activeBucketRef.current = null;
    frozenBrushRef.current = null;
    if (gestureStrokeIdsRef.current.length > 0) {
      undoStackRef.current.push([...gestureStrokeIdsRef.current]);
      redoStackRef.current = [];
      setUndoState({
        undo: undoStackRef.current.length > 0,
        redo: redoStackRef.current.length > 0
      });
    }
    gestureStrokeIdsRef.current = [];
  }, []);

  const handlePointerStart = useCallback((event: any) => {
    event?.stopPropagation?.();
    const { locationX = 0, locationY = 0 } = event.nativeEvent ?? {};
    const clampedX = clamp(locationX, 0, stageSize);
    const clampedY = clamp(locationY, 0, stageSize);
    frozenBrushRef.current = { ...brushStateRef.current };
    pointerActiveRef.current = true;
    gestureStrokeIdsRef.current = [];
    activeBucketRef.current = null;
    lastPointRef.current = { x: clampedX, y: clampedY };
    spacingCarryRef.current = 0;
    appendSample({ x: clampedX, y: clampedY });
  }, [appendSample]);

  const handlePointerMove = useCallback((event: any) => {
    if (!pointerActiveRef.current) {
      return;
    }
    event?.stopPropagation?.();
    const { locationX = 0, locationY = 0 } = event.nativeEvent ?? {};
    const clampedX = clamp(locationX, 0, stageSize);
    const clampedY = clamp(locationY, 0, stageSize);
    appendInterpolatedSamples({ x: clampedX, y: clampedY });
  }, [appendInterpolatedSamples]);

  const handlePointerEnd = useCallback((event: any) => {
    event?.stopPropagation?.();
    finalizeGesture();
  }, [finalizeGesture]);

  const stageResponder = useMemo(
    () =>
      PanResponder.create({
        // Only claim a new touch when no stroke is already active so a second
        // finger on a slider doesn't get stolen by the canvas.
        onStartShouldSetPanResponder: () => !pointerActiveRef.current,
        // Never steal move events from another responder (e.g. a slider).
        onMoveShouldSetPanResponder: () => false,
        onPanResponderGrant: handlePointerStart,
        onPanResponderMove: handlePointerMove,
        onPanResponderRelease: handlePointerEnd,
        onPanResponderTerminate: handlePointerEnd,
        // Never yield an active stroke to another responder.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true
      }),
    [handlePointerEnd, handlePointerMove, handlePointerStart]
  );

  const removeStrokes = useCallback(
    (ids: string[]) => {
      ids.forEach((id) => {
        frameBuffer.removeStroke(id);
        strokeCacheRef.current.delete(id);
      });
      requestCompositeRefresh();
    },
    [frameBuffer, requestCompositeRefresh]
  );

  const handleUndo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) {
      return;
    }
    removeStrokes(entry);
    redoStackRef.current.push(entry);
    setUndoState({
      undo: undoStackRef.current.length > 0,
      redo: redoStackRef.current.length > 0
    });
  }, [removeStrokes]);

  const handleRedo = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) {
      return;
    }
    const restored: string[] = [];
    entry.forEach((strokeId) => {
      const archived = strokeArchiveRef.current.get(strokeId);
      if (!archived) {
        return;
      }
      frameBuffer.addStroke({
        ...archived,
        id: strokeId,
        samples: archived.samples.map((sample) => ({ ...sample }))
      });
      const refreshed = frameBuffer.getStroke(strokeId);
      if (refreshed) {
        strokeArchiveRef.current.set(strokeId, refreshed);
      }
      restored.push(strokeId);
    });
    if (restored.length === 0) {
      return;
    }
    undoStackRef.current.push(restored);
    setUndoState({
      undo: undoStackRef.current.length > 0,
      redo: redoStackRef.current.length > 0
    });
    requestCompositeRefresh();
  }, [frameBuffer, requestCompositeRefresh]);

  const handleClearAll = useCallback(() => {
    frameBuffer.clear();
    strokeCacheRef.current.clear();
    strokeArchiveRef.current.clear();
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoState({ undo: false, redo: false });
    requestCompositeRefresh();
    void renderer.clearAllFrames();
  }, [frameBuffer, renderer, requestCompositeRefresh]);

  const stepFrame = useCallback(() => {
    const [startRange, endRange] = cropRangeRef.current;
    if (startRange === endRange) {
      onChangePlayhead(startRange);
      playheadRef.current = startRange;
      return;
    }
    let next = playheadRef.current + 1;
    if (next > endRange) {
      if (isLooping) {
        next = startRange;
      } else {
        if (onSetPlaybackState) {
          onSetPlaybackState(false);
        } else if (isPlaying) {
          onTogglePlayback();
        }
        return;
      }
    }
    playheadRef.current = next;
    onChangePlayhead(next);
  }, [isLooping, isPlaying, onChangePlayhead, onSetPlaybackState, onTogglePlayback]);

  useEffect(() => {
    if (isPlaying && fps <= 0) {
      if (onSetPlaybackState) {
        onSetPlaybackState(false);
      } else {
        onTogglePlayback();
      }
    }
  }, [fps, isPlaying, onSetPlaybackState, onTogglePlayback]);

  useEffect(() => {
    if (!isPlaying) {
      if (playbackRafRef.current) {
        cancelAnimationFrame(playbackRafRef.current);
      }
      playbackRafRef.current = null;
      playbackTimestampRef.current = null;
      playbackAccumulatorRef.current = 0;
      return;
    }
    const tick = (timestamp: number) => {
      if (playbackTimestampRef.current == null) {
        playbackTimestampRef.current = timestamp;
      }
      const delta = timestamp - (playbackTimestampRef.current ?? timestamp);
      playbackTimestampRef.current = timestamp;
      playbackAccumulatorRef.current += delta;
      const currentFps = fpsRef.current;
      if (currentFps > 0) {
        const frameDuration = 1000 / currentFps;
        while (playbackAccumulatorRef.current >= frameDuration) {
          playbackAccumulatorRef.current -= frameDuration;
          stepFrame();
        }
      }
      playbackRafRef.current = requestAnimationFrame(tick);
    };
    playbackRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (playbackRafRef.current) {
        cancelAnimationFrame(playbackRafRef.current);
      }
      playbackRafRef.current = null;
    };
  }, [isPlaying, stepFrame]);

  const handleTimelineLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.max(1, event.nativeEvent.layout.width);
    setTimelineWidth(width);
  }, []);

  const adjustCropHandle = useCallback((type: 'start' | 'end', deltaPixels: number) => {
    const drag = dragHandleRef.current;
    if (!drag || drag.type !== type) {
      return;
    }
    const total = Math.max(1, totalFramesRef.current - 1);
    const deltaFrames = Math.round((deltaPixels / Math.max(1, timelineWidthRef.current)) * total);
    let nextFrame = clamp(drag.frame + deltaFrames, 0, totalFramesRef.current - 1);
    if (type === 'start') {
      nextFrame = Math.min(nextFrame, cropRangeRef.current[1] - 1);
      cropRangeRef.current = [nextFrame, cropRangeRef.current[1]];
    } else {
      nextFrame = Math.max(nextFrame, cropRangeRef.current[0] + 1);
      cropRangeRef.current = [cropRangeRef.current[0], nextFrame];
    }
    setCropRange([cropRangeRef.current[0], cropRangeRef.current[1]]);
  }, []);

  const cropStartResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragHandleRef.current = { type: 'start', frame: cropRangeRef.current[0] };
        },
        onPanResponderMove: (_, gestureState) => {
          adjustCropHandle('start', gestureState.dx);
        },
        onPanResponderRelease: () => {
          dragHandleRef.current = null;
        },
        onPanResponderTerminate: () => {
          dragHandleRef.current = null;
        }
      }),
    [adjustCropHandle]
  );

  const cropEndResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragHandleRef.current = { type: 'end', frame: cropRangeRef.current[1] };
        },
        onPanResponderMove: (_, gestureState) => {
          adjustCropHandle('end', gestureState.dx);
        },
        onPanResponderRelease: () => {
          dragHandleRef.current = null;
        },
        onPanResponderTerminate: () => {
          dragHandleRef.current = null;
        }
      }),
    [adjustCropHandle]
  );

  const renderTicks = () => {
    const ticks: React.ReactElement[] = [];
    const visible = Math.min(totalFrames, 200);
    for (let i = 0; i < visible; i += 1) {
      ticks.push(<View key={`tick-${i}`} style={styles.timelineTick} />);
    }
    return ticks;
  };

  const playheadPosition =
    totalFrames <= 1
      ? 0
      : (playhead / Math.max(1, totalFrames - 1)) * timelineWidth;
  const cropStartPosition =
    totalFrames <= 1
      ? 0
      : (cropRange[0] / Math.max(1, totalFrames - 1)) * timelineWidth;
  const cropEndPosition =
    totalFrames <= 1
      ? timelineWidth
      : (cropRange[1] / Math.max(1, totalFrames - 1)) * timelineWidth;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Animator</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.headerButton, !undoState.undo && styles.headerButtonDisabled]}
            onPress={handleUndo}
            disabled={!undoState.undo}
          >
            <Text style={styles.headerButtonLabel}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerButton, !undoState.redo && styles.headerButtonDisabled]}
            onPress={handleRedo}
            disabled={!undoState.redo}
          >
            <Text style={styles.headerButtonLabel}>Redo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={handleClearAll}>
            <Text style={styles.headerButtonLabel}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.stageWrapper}>
        <View style={styles.stage} {...stageResponder.panHandlers}>
          <PaintCanvas
            width={stageSize}
            height={stageSize}
            strokes={stageStrokes}
            liveStroke={null}
            liveVersion={compositeRevision}
            backgroundColor="#1c1c1c"
          />
          <View pointerEvents="none" style={styles.stageOverlay}>
            <Text style={styles.stageOverlayText}>
              Frame {playhead + 1} / {totalFrames}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.transportRow}>
        <TouchableOpacity
          style={[styles.playButton, isPlaying && styles.playButtonActive]}
          onPress={onTogglePlayback}
        >
          <Text style={styles.playButtonText}>{isPlaying ? 'Pause' : 'Play'}</Text>
        </TouchableOpacity>
        <CustomAnimatorSlider
          style={styles.sliderGroup}
          label="FPS"
          value={fps}
          minimumValue={0}
          maximumValue={60}
          step={1}
          onValueChange={(v) => { fpsRef.current = v; }}
          onSlidingComplete={(v) => onChangeFps(v)}
          minimumTrackTintColor="#ff9f6b"
          thumbTintColor="#ff9f6b"
        />
        <CustomAnimatorSlider
          style={styles.sliderGroup}
          label="Stroke"
          value={strokeLength}
          minimumValue={-1}
          maximumValue={Math.max(1, totalFrames)}
          step={1}
          onValueChange={(v) => { strokeLengthRef.current = v; }}
          onSlidingComplete={(v) => onChangeStrokeLength(v)}
          minimumTrackTintColor="#4CAF50"
          thumbTintColor="#4CAF50"
          valueFormatter={(v) => (v === -1 ? '∞ BG' : String(v))}
        />
      </View>
      <View style={styles.inputRow}>
        <View style={styles.frameInput}>
          <Text style={styles.sliderLabel}>Total Frames</Text>
          <TextInput
            keyboardType="numeric"
            value={String(totalFrames)}
            onChangeText={(value) => {
              const parsed = parseInt(value, 10);
              if (Number.isFinite(parsed)) {
                onChangeTotalFrames(Math.min(20000, Math.max(1, parsed)));
              }
            }}
            style={styles.frameInputField}
          />
        </View>
        <TouchableOpacity
          style={[styles.loopButton, isLooping && styles.loopButtonActive]}
          onPress={onToggleLoop}
        >
          <Text style={styles.loopButtonText}>{isLooping ? 'Looping' : 'Loop'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.timelineContainer}>
        <View style={styles.timelineCanvas} onLayout={handleTimelineLayout}>
          <View style={styles.timelineTicks}>{renderTicks()}</View>
          <View
            pointerEvents="none"
            style={[
              styles.timelineCropRange,
              {
                left: cropStartPosition,
                width: Math.max(2, cropEndPosition - cropStartPosition)
              }
            ]}
          />
          <View
            pointerEvents="none"
            style={[styles.timelinePlayhead, { left: playheadPosition - 1 }]}
          />
          <View
            style={[styles.timelineHandle, { left: cropStartPosition - HANDLE_WIDTH / 2 }]}
            {...cropStartResponder.panHandlers}
          >
            <Text style={styles.timelineHandleLabel}>A</Text>
          </View>
          <View
            style={[styles.timelineHandle, { left: cropEndPosition - HANDLE_WIDTH / 2 }]}
            {...cropEndResponder.panHandlers}
          >
            <Text style={styles.timelineHandleLabel}>B</Text>
          </View>
        </View>
        <CustomAnimatorSlider
          value={playhead}
          minimumValue={cropRange[0]}
          maximumValue={cropRange[1]}
          step={1}
          onValueChange={(v) => onChangePlayhead(v)}
          onSlidingComplete={(v) => onChangePlayhead(v)}
          minimumTrackTintColor="#ffc107"
          thumbTintColor="#ffc107"
        />
        <View style={styles.timelineFooter}>
          <Text style={styles.timelineLabel}>
            Frame {playhead + 1} / {totalFrames}
          </Text>
          <Text style={styles.timelineLabel}>
            Range {cropRange[0] + 1} – {cropRange[1] + 1}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#030303'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: TEXT_FONT
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  headerButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1f1f1f'
  },
  headerButtonDisabled: {
    opacity: 0.35
  },
  headerButtonLabel: {
    color: '#fff',
    fontFamily: TEXT_FONT,
    fontSize: 12
  },
  closeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#d84315'
  },
  closeButtonText: {
    color: '#fff',
    fontFamily: TEXT_FONT,
    fontSize: 12
  },
  stageWrapper: {
    alignSelf: 'center',
    width: stageSize,
    height: stageSize,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#111'
  },
  stage: {
    flex: 1
  },
  stageOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)'
  },
  stageOverlayText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: TEXT_FONT
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16
  },
  playButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#222'
  },
  playButtonActive: {
    backgroundColor: '#4CAF50'
  },
  playButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontFamily: TEXT_FONT
  },
  sliderGroup: {
    flex: 1
  },
  sliderLabel: {
    color: '#fff',
    fontSize: 12,
    marginBottom: 4,
    fontFamily: TEXT_FONT
  },
  slider: {
    width: '100%',
    height: 32
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12
  },
  frameInput: {
    flex: 1
  },
  frameInputField: {
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#333',
    fontFamily: TEXT_FONT
  },
  loopButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#666'
  },
  loopButtonActive: {
    borderColor: '#4CAF50'
  },
  loopButtonText: {
    color: '#fff',
    fontFamily: TEXT_FONT
  },
  timelineContainer: {
    backgroundColor: '#050505',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
    padding: 12,
    gap: 12
  },
  timelineCanvas: {
    height: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
    backgroundColor: '#0f0f0f',
    overflow: 'hidden',
    justifyContent: 'center'
  },
  timelineTicks: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 4
  },
  timelineTick: {
    width: 2,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.08)'
  },
  timelineCropRange: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.06)'
  },
  timelinePlayhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#76ff03'
  },
  timelineHandle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)'
  },
  timelineHandleLabel: {
    color: '#fff',
    fontFamily: TEXT_FONT,
    fontSize: 12
  },
  timelineFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  timelineLabel: {
    color: '#fff',
    fontSize: 12,
    fontFamily: TEXT_FONT
  }
});
