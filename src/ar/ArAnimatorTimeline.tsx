import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';

/** AR animation FPS ceiling — 30 divides cleanly into ARKit's 60 fps → no judder. */
export const AR_ANIMATION_MAX_FPS = 30;

/**
 * AR Animator timeline — same transport as the 2D Animator workspace.
 *
 * OWNS the playback clock (a JS interval) in LOCAL state so playback re-renders
 * ONLY this small component. Each tick it calls `onFrameTick(frame)`, which the
 * parent forwards to native imperatively (seekAnimation) — the big AR screen
 * never re-renders per frame. When paused it mirrors the parent's `currentFrame`.
 *
 * The playhead slider is scrub-gated: `@react-native-community/slider` fires
 * `onValueChange` for PROGRAMMATIC value changes too (every clock tick), so only
 * a real finger drag — bracketed by onSlidingStart/onSlidingComplete — may seek.
 */
export interface ArAnimatorTimelineProps {
  fps: number;
  strokeLength: number;
  backgroundStroke: boolean;
  totalFrames: number;
  currentFrame: number;
  playing: boolean;
  looping: boolean;
  expanded: boolean;
  onSetFps: (fps: number) => void;
  onSetStrokeLength: (frames: number) => void;
  onSetPlaying: (playing: boolean) => void;
  onSetLooping: (looping: boolean) => void;
  onSetExpanded: (expanded: boolean) => void;
  onSeek: (frame: number) => void;
  /** Per-frame tick during playback → parent drives native imperatively. */
  onFrameTick: (frame: number) => void;
}

const ArAnimatorTimeline: React.FC<ArAnimatorTimelineProps> = ({
  fps,
  strokeLength,
  backgroundStroke,
  totalFrames,
  currentFrame,
  playing,
  looping,
  expanded,
  onSetFps,
  onSetStrokeLength,
  onSetPlaying,
  onSetLooping,
  onSetExpanded,
  onSeek,
  onFrameTick,
}) => {
  const scrubbingRef = useRef(false);
  const [displayFrame, setDisplayFrame] = useState(currentFrame);
  const frameRef = useRef(displayFrame);
  frameRef.current = displayFrame;

  // While paused, follow the parent's frame (scrub / step / reset / clamp).
  useEffect(() => {
    if (!playing) setDisplayFrame(Math.max(0, Math.min(currentFrame, Math.max(0, totalFrames - 1))));
  }, [currentFrame, playing, totalFrames]);

  // The clock — local to this component. Advances displayFrame at the capped FPS
  // and hands each frame to the parent (imperative native seek, no screen re-render).
  useEffect(() => {
    if (!playing || fps <= 0) return;
    const stepMs = 1000 / Math.max(1, Math.min(AR_ANIMATION_MAX_FPS, fps));
    const id = setInterval(() => {
      const nextRaw = frameRef.current + 1;
      let next: number;
      if (nextRaw < totalFrames) {
        next = nextRaw;
      } else if (looping) {
        next = 0;
      } else {
        next = Math.max(0, totalFrames - 1);
      }
      frameRef.current = next;
      setDisplayFrame(next);
      onFrameTick(next);
      if (nextRaw >= totalFrames && !looping) onSetPlaying(false);
    }, stepMs);
    return () => clearInterval(id);
  }, [playing, fps, totalFrames, looping, onFrameTick, onSetPlaying]);

  const safeFrame = Math.max(0, Math.min(displayFrame, Math.max(0, totalFrames - 1)));

  const stepBy = (delta: number) => {
    onSeek((safeFrame + delta + totalFrames) % totalFrames);
  };

  if (!expanded) {
    return (
      <TouchableOpacity
        style={styles.collapsed}
        onPress={() => onSetExpanded(true)}
        accessibilityLabel="Open AR Animator timeline"
      >
        <Text style={styles.collapsedText}>
          🎞 {safeFrame + 1}/{totalFrames} · {fps} fps {playing ? '▶' : '⏸'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.transportRow}>
        <TouchableOpacity
          style={[styles.playButton, playing && styles.playButtonActive]}
          onPress={() => onSetPlaying(!playing)}
          accessibilityLabel={playing ? 'Pause AR animation' : 'Play AR animation'}
        >
          <Text style={styles.playButtonText}>{playing ? '⏸' : '▶️'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.stepButton}
          onPress={() => stepBy(-1)}
          accessibilityLabel="Previous animation frame"
        >
          <Text style={styles.stepText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.frameLabel}>
          Frame {safeFrame + 1} / {totalFrames}
        </Text>
        <TouchableOpacity
          style={styles.stepButton}
          onPress={() => stepBy(1)}
          accessibilityLabel="Next animation frame"
        >
          <Text style={styles.stepText}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.loopButton, looping && styles.loopButtonActive]}
          onPress={() => onSetLooping(!looping)}
          accessibilityLabel="Toggle animation loop"
        >
          <Text style={styles.loopText}>↻</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.collapseButton}
          onPress={() => onSetExpanded(false)}
          accessibilityLabel="Collapse AR Animator timeline"
        >
          <Text style={styles.collapseText}>⌄</Text>
        </TouchableOpacity>
      </View>

      {/* Live FPS + stroke-life sliders — change them on the fly. */}
      <View style={styles.inlineRow}>
        <View style={styles.inlineCol}>
          <Text style={styles.inlineLabel}>⏱ {fps} fps</Text>
          <Slider
            style={styles.inlineSlider}
            minimumValue={1}
            maximumValue={AR_ANIMATION_MAX_FPS}
            step={1}
            value={Math.min(fps, AR_ANIMATION_MAX_FPS)}
            onValueChange={(value) => onSetFps(Math.round(value))}
            minimumTrackTintColor="#ff9f6b"
            maximumTrackTintColor="#3a3a3a"
            thumbTintColor="#ff9f6b"
            accessibilityLabel="AR animation frames per second"
          />
        </View>
        <View style={styles.inlineCol}>
          <Text style={styles.inlineLabel}>
            🖌 life {backgroundStroke ? '∞' : `${strokeLength}f`}
          </Text>
          <Slider
            style={[styles.inlineSlider, backgroundStroke && styles.inlineSliderDisabled]}
            minimumValue={1}
            maximumValue={totalFrames}
            step={1}
            value={Math.min(strokeLength, totalFrames)}
            onValueChange={(value) => onSetStrokeLength(Math.round(value))}
            disabled={backgroundStroke}
            minimumTrackTintColor="#4caf50"
            maximumTrackTintColor="#3a3a3a"
            thumbTintColor="#4caf50"
            accessibilityLabel="New AR stroke lifetime in frames"
          />
        </View>
      </View>

      {/* Playhead — seeks ONLY while a real finger is on it. */}
      <View style={styles.playheadTrack}>
        <View style={styles.ticks} pointerEvents="none">
          {Array.from({ length: 18 }, (_, index) => (
            <View key={index} style={styles.tick} />
          ))}
        </View>
        <Slider
          style={styles.playheadSlider}
          minimumValue={0}
          maximumValue={Math.max(0, totalFrames - 1)}
          step={1}
          value={safeFrame}
          onSlidingStart={() => {
            scrubbingRef.current = true;
            onSetPlaying(false);
          }}
          onValueChange={(value) => {
            if (!scrubbingRef.current) return; // ignore programmatic (clock) echoes
            onSeek(Math.round(value));
          }}
          onSlidingComplete={(value) => {
            scrubbingRef.current = false;
            onSeek(Math.round(value));
          }}
          minimumTrackTintColor="#76ff03"
          maximumTrackTintColor="#3a3a3a"
          thumbTintColor="#76ff03"
          accessibilityLabel="AR animation playhead"
        />
      </View>
      <Text style={styles.hint}>
        {playing
          ? `Playing · each new stroke lives ${backgroundStroke ? '∞' : `${strokeLength}f`} · ${fps} fps`
          : 'Paused · paint lands on THIS frame only — step frames to build them one by one'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  collapsed: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 15,
    backgroundColor: 'rgba(10,10,10,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(118,255,3,0.4)',
  },
  collapsedText: { color: '#c8ff8a', fontSize: 12, fontWeight: '800' },
  panel: {
    width: '100%',
    maxWidth: 620,
    paddingHorizontal: 11,
    paddingTop: 8,
    paddingBottom: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(10,10,10,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(118,255,3,0.35)',
  },
  transportRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playButton: {
    width: 38,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#292929',
  },
  playButtonActive: { backgroundColor: '#4c8f12' },
  playButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  stepButton: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222',
  },
  stepText: { color: '#fff', fontSize: 25, lineHeight: 27, fontWeight: '500' },
  frameLabel: { flex: 1, color: '#fff', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  loopButton: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#3c3c3c',
  },
  loopButtonActive: { borderColor: '#76ff03', backgroundColor: '#294814' },
  loopText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  collapseButton: { width: 27, height: 30, alignItems: 'center', justifyContent: 'center' },
  collapseText: { color: '#aaa', fontSize: 19, fontWeight: '800' },
  inlineRow: { flexDirection: 'row', gap: 12, marginTop: 5, marginBottom: 1 },
  inlineCol: { flex: 1 },
  inlineLabel: { color: '#dcdcdc', fontSize: 10.5, fontWeight: '700', marginBottom: -5, marginLeft: 2 },
  inlineSlider: { width: '100%', height: 28 },
  inlineSliderDisabled: { opacity: 0.35 },
  playheadTrack: { position: 'relative', width: '100%' },
  ticks: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 8,
    height: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  tick: { width: 1, height: 7, backgroundColor: 'rgba(255,255,255,0.16)' },
  playheadSlider: { width: '100%', height: 30, marginTop: 1 },
  hint: { color: 'rgba(255,255,255,0.56)', fontSize: 9.5, textAlign: 'center', marginTop: -3 },
});

export default memo(ArAnimatorTimeline);
