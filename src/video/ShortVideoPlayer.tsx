import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus, StyleProp, ViewStyle } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { getCompletionReplayDelay } from './shortVideoPolicy';

export interface ShortVideoPlayerProps {
  uri: string;
  style?: StyleProp<ViewStyle>;
  resizeMode?: ResizeMode;
  isMuted?: boolean;
  shouldPlay?: boolean;
  useNativeControls?: boolean;
  onReadyForDisplay?: () => void;
}

/** A lifecycle-safe player for gallery cells, including sub-second clips. */
export const ShortVideoPlayer = React.memo(({
  uri, style, resizeMode = ResizeMode.CONTAIN, isMuted = true, shouldPlay = true,
  useNativeControls = false, onReadyForDisplay,
}: ShortVideoPlayerProps) => {
  const playerRef = useRef<Video | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const durationRef = useRef<number | null>(null);
  const completionRestartPendingRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const clearRestart = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  const startFromBeginning = useCallback(async () => {
    const player = playerRef.current;
    if (!mountedRef.current || !player || appStateRef.current !== 'active') return;
    const generation = generationRef.current;
    try {
      await player.setPositionAsync(0);
      if (generation !== generationRef.current || !mountedRef.current) return;
      await player.playAsync();
      completionRestartPendingRef.current = false;
    } catch {
      completionRestartPendingRef.current = false;
      /* player may have been unloaded during reuse */
    }
  }, []);

  const scheduleRestart = useCallback((delay: number) => {
    clearRestart();
    const generation = generationRef.current;
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (generation === generationRef.current) void startFromBeginning();
    }, delay);
  }, [clearRestart, startFromBeginning]);

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    durationRef.current = status.durationMillis ?? durationRef.current;
    if (status.didJustFinish) {
      if (completionRestartPendingRef.current) return;
      completionRestartPendingRef.current = true;
      void playerRef.current?.pauseAsync().catch(() => undefined);
      scheduleRestart(getCompletionReplayDelay(durationRef.current));
    } else if (shouldPlay && !status.isPlaying && !status.isBuffering && appStateRef.current === 'active') {
      // Covers delayed readiness and interruptions without creating a second timer.
      // A completion restart already owns the timer, including the deliberate
      // one-second pause for short clips.
      if (completionRestartPendingRef.current) return;
      scheduleRestart(80);
    }
  }, [scheduleRestart, shouldPlay]);

  useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
      if (next !== 'active') clearRestart();
      else if (shouldPlay) {
        const shortReplayDelay = completionRestartPendingRef.current
          ? getCompletionReplayDelay(durationRef.current)
          : 0;
        scheduleRestart(shortReplayDelay);
      }
    });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      completionRestartPendingRef.current = false;
      clearRestart();
      subscription.remove();
      // Pause alone leaves AVPlayer holding the just-finished file while a
      // replacement player can be mounted (Vector's Record again flow does
      // this immediately). Explicitly unload the native player so the old
      // AVAsset cannot race the next finish-screen player.
      void playerRef.current?.unloadAsync().catch(() => undefined);
    };
  }, [clearRestart, scheduleRestart, shouldPlay]);

  useEffect(() => {
    generationRef.current += 1;
    durationRef.current = null;
    completionRestartPendingRef.current = false;
    clearRestart();
  }, [uri, clearRestart]);

  return <Video ref={playerRef} source={{ uri }} style={style} resizeMode={resizeMode}
    shouldPlay={shouldPlay} isLooping={false} isMuted={isMuted} useNativeControls={useNativeControls}
    onReadyForDisplay={onReadyForDisplay} onPlaybackStatusUpdate={onStatus} />;
});

export default ShortVideoPlayer;
