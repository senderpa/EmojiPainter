import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

interface TimelapsePlayerProps {
  isPlaying: boolean;
  width: number;
  height: number;
  loop?: boolean;
  onFinished?: () => void;
  frames?: { uri: string }[] | null;
  frameRate?: number;
  holdSeconds?: number;
  loading?: boolean;
  pingPong?: boolean; // Enable ping-pong mode: forward → hold → reverse → hold → repeat
}

const TimelapsePlayer: React.FC<TimelapsePlayerProps> = ({
  isPlaying,
  width,
  height,
  loop = false,
  onFinished,
  frames,
  frameRate,
  holdSeconds = 0,
  loading = false,
  pingPong = false
}) => {
  const hasFrames = Array.isArray(frames) && frames.length > 0;
  const resolvedFrameRate = hasFrames ? Math.max(1, frameRate ?? Math.max(1, frames.length / 2)) : 1;
  const [frameIndex, setFrameIndex] = useState(0);
  const frameIndexRef = useRef(0);
  const frameAccumulatorRef = useRef(0);
  const holdDurationMs = Math.max(0, holdSeconds * 1000);
  const holdRemainingRef = useRef(holdDurationMs);
  const directionRef = useRef(1); // 1 = forward, -1 = reverse (for ping-pong mode)

  // Reset hold timer when holdDurationMs changes, but preserve animation state
  useEffect(() => {
    if (!hasFrames) {
      frameIndexRef.current = 0;
      setFrameIndex(0);
      frameAccumulatorRef.current = 0;
      directionRef.current = 1;
      holdRemainingRef.current = 0;
      return;
    }
    // Only reset hold timer if we're at an endpoint, otherwise it interrupts smooth playback
    const lastFrameIndex = frames?.length ? frames.length - 1 : 0;
    const isAtEndpoint = frameIndexRef.current === 0 || frameIndexRef.current === lastFrameIndex;
    if (isAtEndpoint) {
      holdRemainingRef.current = holdDurationMs;
    }
  }, [hasFrames, holdDurationMs, frames?.length]);

  useEffect(() => {
    if (!hasFrames || !isPlaying) {
      return;
    }
    let rafId: number | null = null;
    let lastTimestamp: number | null = null;
    const frameDuration = 1000 / Math.max(1, resolvedFrameRate);

    const step = (timestamp: number) => {
      if (!hasFrames || !frames || frames.length === 0) {
        return;
      }
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }
      const delta = timestamp - lastTimestamp;
      frameAccumulatorRef.current += delta;

      while (frameAccumulatorRef.current >= frameDuration) {
        frameAccumulatorRef.current -= frameDuration;
        const lastFrameIndex = frames.length - 1;
        const direction = directionRef.current;

        // Handle ping-pong mode - ALWAYS loops continuously
        if (pingPong) {
          // Check if we're at an end and need to hold
          if ((direction === 1 && frameIndexRef.current === lastFrameIndex) ||
              (direction === -1 && frameIndexRef.current === 0)) {
            // At an end - hold if configured
            if (holdDurationMs > 0 && holdRemainingRef.current > 0) {
              holdRemainingRef.current = Math.max(0, holdRemainingRef.current - frameDuration);
              if (holdRemainingRef.current > 0) {
                // Still holding - stay on current frame
                lastTimestamp = timestamp;
                rafId = requestAnimationFrame(step);
                return;
              }
            }
            // Hold complete - reverse direction and continue looping forever
            holdRemainingRef.current = holdDurationMs;
            directionRef.current = -direction;
          }

          // Move to next frame in current direction
          const nextIndex = frameIndexRef.current + directionRef.current;
          frameIndexRef.current = Math.max(0, Math.min(lastFrameIndex, nextIndex));
          setFrameIndex(frameIndexRef.current);
        } else {
          // Normal mode (non-ping-pong) - ALWAYS loops continuously
          if (frameIndexRef.current === lastFrameIndex && holdDurationMs > 0) {
            if (holdRemainingRef.current > 0) {
              holdRemainingRef.current = Math.max(0, holdRemainingRef.current - frameDuration);
              if (holdRemainingRef.current > 0) {
                // Still holding at last frame
                lastTimestamp = timestamp;
                rafId = requestAnimationFrame(step);
                return;
              }
            }
            holdRemainingRef.current = holdDurationMs;
          }

          let nextIndex = frameIndexRef.current + 1;
          if (nextIndex >= frames.length) {
            // Always loop back to start (loop prop is ignored - we always loop)
            nextIndex = 0;
            holdRemainingRef.current = holdDurationMs;
            // Call onFinished callback when looping back (useful for tracking cycles)
            onFinished?.();
          }
          frameIndexRef.current = nextIndex;
          setFrameIndex(nextIndex);
        }
      }

      lastTimestamp = timestamp;
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [frames, hasFrames, holdDurationMs, isPlaying, loop, onFinished, resolvedFrameRate]);

  if (!hasFrames) {
    return (
      <View style={[styles.container, { width, height }]}>
        {loading ? <ActivityIndicator color="#ff6b6b" /> : null}
      </View>
    );
  }

  const currentFrame = frames[Math.min(frameIndex, frames.length - 1)];

  return (
    <View style={[styles.container, { width, height }]}>
      <Image source={{ uri: currentFrame.uri }} style={{ width, height }} resizeMode="contain" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center'
  }
});

export default TimelapsePlayer;
