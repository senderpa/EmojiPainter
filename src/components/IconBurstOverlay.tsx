import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus, Dimensions, StyleSheet, Animated as RNAnimated, Easing, Image } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';

import { addAppEventListener } from '../lib/appEvents';
import { isIconBurstSuppressed, subscribeIconBurstSuppression } from '../lib/uiSuppression';
import { resolvePrefetchableImageUri } from '../lib/imageSource';
import { getRandomImageLogoSet, LogoSet } from '../lib/logoManifest';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const ICON_SIZE = Math.min(screenWidth * 0.5, 260);
const FILL_SCALE_X = screenWidth / ICON_SIZE;
const FILL_SCALE_Y = screenHeight / ICON_SIZE;

const BURST_SOUNDS = [
  require('../../assets/sounds/wobble1.wav'),
  require('../../assets/sounds/wobble2.wav'),
  require('../../assets/sounds/wobble3.wav')
] as const;

const BASS_SOUNDS = [
  require('../../assets/sounds/bass1.wav'),
  require('../../assets/sounds/bass2.wav'),
  require('../../assets/sounds/bass3.wav'),
  require('../../assets/sounds/bass4.wav'),
  require('../../assets/sounds/bass5.wav')
] as const;

type BurstContext = 'startup' | 'background';
type PrimePayload = { context?: BurstContext } | undefined;
type TimeoutRef = ReturnType<typeof setTimeout> | null;

const IconBurstOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [currentLogoSet, setCurrentLogoSet] = useState<LogoSet | null>(null);
  const [nextLogoSet, setNextLogoSet] = useState<LogoSet | null>(null);
  const animatingRef = useRef(false);
  const specialAnimationCountRef = useRef(0);

  const opacity = useRef(new RNAnimated.Value(0)).current;
  const scaleX = useRef(new RNAnimated.Value(1)).current;
  const scaleY = useRef(new RNAnimated.Value(1)).current;
  const translateX = useRef(new RNAnimated.Value(0)).current;
  const translateY = useRef(new RNAnimated.Value(0)).current;
  const rotate = useRef(new RNAnimated.Value(0)).current;

  const rotation = useMemo(
    () => rotate.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }),
    [rotate]
  );

  const transformStyle = useMemo(
    () => ({
      transform: [
        { translateX },
        { translateY },
        { scaleX },
        { scaleY },
        { rotate: rotation }
      ]
    }),
    [rotation, scaleX, scaleY, translateX, translateY]
  );

  const frameStartTimeoutRef = useRef<TimeoutRef>(null);
  const frameStepTimeoutRef = useRef<TimeoutRef>(null);
  const activeSoundRef = useRef<Audio.Sound | null>(null);
  const lastAppStateRef = useRef<AppStateStatus>(AppState.currentState);
  const preparingNextRef = useRef<boolean>(false);
  const backgroundTimestampRef = useRef<number | null>(null);
  // iOS raises `inactive` for interruptions that are NOT a backgrounding: the
  // ReplayKit permission alert, the low-battery warning, a memory warning. Only
  // a real `background` transition may play the return animation.
  const reachedBackgroundRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (frameStartTimeoutRef.current) {
      clearTimeout(frameStartTimeoutRef.current);
      frameStartTimeoutRef.current = null;
    }
    if (frameStepTimeoutRef.current) {
      clearTimeout(frameStepTimeoutRef.current);
      frameStepTimeoutRef.current = null;
    }
  }, []);

  const stopActiveSound = useCallback(async () => {
    const active = activeSoundRef.current;
    if (!active) {
      return;
    }
    try {
      await active.stopAsync();
    } catch {
      // ignore
    }
    active.unloadAsync().catch(() => {});
    activeSoundRef.current = null;
  }, []);

  // Clean up old logo set images from memory
  const cleanupOldLogoSet = useCallback(async (logoSet: LogoSet | null) => {
    if (!logoSet) return;

    try {
      // Unload base icon (only if queryCache is available)
      if (Image.queryCache) {
        const baseUri = resolvePrefetchableImageUri(logoSet.baseIcon);
        if (baseUri) {
          await Image.queryCache([baseUri]);
        }

        // Unload all frames
        for (const frame of logoSet.frames) {
          const frameUri = resolvePrefetchableImageUri(frame);
          if (frameUri) {
            await Image.queryCache([frameUri]);
          }
        }
      }

      console.log(`🧹 Cleaned up logo set: ${logoSet.id}`);
    } catch (error) {
      console.warn('Failed to cleanup logo set:', error);
    }
  }, []);

  // Load a new random logo set and prepare the next one
  const loadNewLogoSet = useCallback(async () => {
    const oldLogoSet = currentLogoSet;
    const newLogoSet = getRandomImageLogoSet();

    console.log(`🎨 Loading new logo set: ${newLogoSet.id}`);

    // Prefetch new images
    try {
      if (newLogoSet.type === 'image') {
        const baseUri = resolvePrefetchableImageUri(newLogoSet.baseIcon);
        if (baseUri) {
          await Image.prefetch(baseUri);
        }
        const prefetchPromises = newLogoSet.frames
          .map(frame => resolvePrefetchableImageUri(frame))
          .filter((uri): uri is string => !!uri)
          .map(uri => Image.prefetch(uri));
        await Promise.all(prefetchPromises);
        console.log(`✅ Prefetched logo set ${newLogoSet.id}: 1 base + ${newLogoSet.frames.length} frames`);
      }
    } catch (error) {
      console.warn('Failed to prefetch logo set:', error);
    }

    setCurrentLogoSet(newLogoSet);

    // Clean up old logo set after a delay
    if (oldLogoSet && oldLogoSet.id !== newLogoSet.id) {
      setTimeout(() => {
        cleanupOldLogoSet(oldLogoSet).catch(() => {});
      }, 2000);
    }
  }, [currentLogoSet, cleanupOldLogoSet]);

  // Pre-load the next logo set for instant display
  const prepareNextLogoSet = useCallback(async () => {
    // Prevent multiple simultaneous preparations
    if (preparingNextRef.current) {
      console.log('⏭️ Already preparing next logo set, skipping');
      return;
    }

    preparingNextRef.current = true;
    const newNextSet = getRandomImageLogoSet();
    console.log(`🔮 Pre-loading NEXT logo set: ${newNextSet.id}`);

    try {
      // Prefetch image frames
      if (newNextSet.type === 'image') {
        const baseUri = resolvePrefetchableImageUri(newNextSet.baseIcon);
        if (baseUri) {
          await Image.prefetch(baseUri);
        }
        const prefetchPromises = newNextSet.frames
          .map(frame => resolvePrefetchableImageUri(frame))
          .filter((uri): uri is string => !!uri)
          .map(uri => Image.prefetch(uri));
        await Promise.all(prefetchPromises);
        console.log(`✅ Next logo set ready: ${newNextSet.id}`);
      }
      setNextLogoSet(newNextSet);
    } catch (error) {
      console.warn('Failed to prefetch next logo set:', error);
    } finally {
      preparingNextRef.current = false;
    }
  }, []);

  const resetState = useCallback((context: BurstContext) => {
    animatingRef.current = false;
    clearTimers();
    stopActiveSound().catch(() => {});
    setFrameIndex(0);
    setVisible(true);
    opacity.stopAnimation?.(() => {});
    scaleX.stopAnimation?.(() => {});
    scaleY.stopAnimation?.(() => {});
    translateX.stopAnimation?.(() => {});
    translateY.stopAnimation?.(() => {});
    rotate.stopAnimation?.(() => {});
    opacity.setValue(1);
    const baseScale = context === 'startup' ? 1.12 : 1.05;
    scaleX.setValue(FILL_SCALE_X * baseScale);
    scaleY.setValue(FILL_SCALE_Y * baseScale);
    translateX.setValue(0);
    translateY.setValue(0);
    rotate.setValue(0);
  }, [clearTimers, opacity, rotate, scaleX, scaleY, stopActiveSound, translateX, translateY]);

  const startFrameSequence = useCallback((frames: number[], intervalMs: number) => {
    if (!frames.length) {
      setFrameIndex(0);
      return;
    }
    let index = 0;
    const run = () => {
      setFrameIndex(frames[index] ?? 0);
      index += 1;
      if (index >= frames.length) {
        frameStepTimeoutRef.current = setTimeout(() => {
          setFrameIndex(0);
          frameStepTimeoutRef.current = null;
        }, Math.max(32, intervalMs));
        return;
      }
      frameStepTimeoutRef.current = setTimeout(run, Math.max(16, intervalMs));
    };
    run();
  }, []);

  const playBurstSound = useCallback(async (useSpecialSound: boolean = false): Promise<number | null> => {
    await stopActiveSound();

    if (!useSpecialSound) {
      // Normal sound
      const choice = BURST_SOUNDS[Math.floor(Math.random() * BURST_SOUNDS.length)];
      if (!choice) return null;

      try {
        const { sound, status } = await Audio.Sound.createAsync(choice, { volume: 0.6 });
        activeSoundRef.current = sound;
        const duration = status.isLoaded ? status.durationMillis ?? null : null;
        sound.setOnPlaybackStatusUpdate((playbackStatus) => {
          if (!playbackStatus?.isLoaded) return;
          if (playbackStatus.didJustFinish) {
            sound.setOnPlaybackStatusUpdate(null);
            sound.unloadAsync().catch(() => {});
            if (activeSoundRef.current === sound) activeSoundRef.current = null;
          }
        });
        await sound.replayAsync();
        return duration;
      } catch (error) {
        console.warn('Icon burst sound failed', error);
        return null;
      }
    }

    // SPECIAL SOUND with random variations
    try {
      specialAnimationCountRef.current += 1;
      const isDoubleSound = specialAnimationCountRef.current % 5 === 0;

      // Random bass sound
      const choice = BASS_SOUNDS[Math.floor(Math.random() * BASS_SOUNDS.length)];
      if (!choice) return null;

      // Random volume (0.5 to 1.0)
      const volume = 0.5 + Math.random() * 0.5;

      // Random pitch/rate (0.6 to 1.4)
      const rate = 0.6 + Math.random() * 0.8;

      console.log(`🎵 Special sound: volume=${volume.toFixed(2)}, rate=${rate.toFixed(2)}, double=${isDoubleSound}`);

      const { sound, status } = await Audio.Sound.createAsync(choice, {
        volume,
        rate,
        shouldCorrectPitch: false // Keep pitch natural with rate change
      });
      activeSoundRef.current = sound;
      const duration = status.isLoaded ? status.durationMillis ?? null : null;

      sound.setOnPlaybackStatusUpdate((playbackStatus) => {
        if (!playbackStatus?.isLoaded) return;
        if (playbackStatus.didJustFinish) {
          sound.setOnPlaybackStatusUpdate(null);
          sound.unloadAsync().catch(() => {});
          if (activeSoundRef.current === sound) activeSoundRef.current = null;
        }
      });

      await sound.replayAsync();

      // Every 5th special: play second sound shortly after
      if (isDoubleSound) {
        setTimeout(async () => {
          try {
            const choice2 = BASS_SOUNDS[Math.floor(Math.random() * BASS_SOUNDS.length)];
            if (!choice2) return;
            const volume2 = 0.4 + Math.random() * 0.4;
            const rate2 = 0.7 + Math.random() * 0.9;
            console.log(`🎵 Second sound: volume=${volume2.toFixed(2)}, rate=${rate2.toFixed(2)}`);
            const { sound: sound2 } = await Audio.Sound.createAsync(choice2, {
              volume: volume2,
              rate: rate2,
              shouldCorrectPitch: false
            });
            sound2.setOnPlaybackStatusUpdate((ps) => {
              if (!ps?.isLoaded) return;
              if (ps.didJustFinish) {
                sound2.setOnPlaybackStatusUpdate(null);
                sound2.unloadAsync().catch(() => {});
              }
            });
            await sound2.replayAsync();
          } catch (e) {
            console.warn('Second sound failed', e);
          }
        }, 100 + Math.random() * 150);
      }

      return duration;
    } catch (error) {
      console.warn('Special sound failed', error);
      return null;
    }
  }, [stopActiveSound]);

  const triggerFrameBurst = useCallback(
    async (context: BurstContext, logoSet: LogoSet, isSpecial: boolean = false) => {
      // Now we have 10 frames available (0-9)
      const frameOptions = context === 'startup'
        ? [5, 7, 10]      // Startup: 5, 7, or all 10 frames
        : [0, 4, 6, 10];  // Background: 0, 4, 6, or all 10 frames

      let requestedCount = frameOptions[Math.floor(Math.random() * frameOptions.length)] ?? 0;

      // Special animation: always use all 10 frames and play them twice
      if (isSpecial && context !== 'startup') {
        requestedCount = 10;
      }

      if (!animatingRef.current) {
        return;
      }
      if (requestedCount <= 0) {
        setFrameIndex(0);
        return;
      }

      let duration = await playBurstSound(isSpecial);
      if (!duration || duration <= 0) {
        duration = context === 'startup' ? 360 : 240 + Math.random() * 140;
      }

      // Build frame pool from available frames (1 to logoSet.frames.length)
      const available = Array.from({ length: logoSet.frames.length }, (_, idx) => idx + 1);
      const frames: number[] = [];

      if (requestedCount >= available.length && available.length > 0) {
        // Use all frames, then repeat randomly to fill count
        frames.push(...available);
        while (frames.length < requestedCount) {
          frames.push(available[Math.floor(Math.random() * available.length)] ?? 1);
        }
      } else {
        // Pick random unique frames
        const pool = [...available];
        while (frames.length < requestedCount && pool.length > 0) {
          const pick = Math.floor(Math.random() * pool.length);
          frames.push(pool.splice(pick, 1)[0] ?? 1);
        }
        while (frames.length < requestedCount) {
          frames.push(available[Math.floor(Math.random() * available.length)] ?? 1);
        }
      }

      // Special animation: play all frames twice
      if (isSpecial && context !== 'startup') {
        const doubledFrames = [...frames, ...frames];
        const interval = Math.max(24, Math.round((duration * 2) / Math.max(1, doubledFrames.length)));
        startFrameSequence(doubledFrames, interval);
      } else {
        const interval = Math.max(24, Math.round(duration / Math.max(1, frames.length)));
        startFrameSequence(frames, interval);
      }

      if (context !== 'startup') {
        const hapticStyles = [
          Haptics.ImpactFeedbackStyle.Medium,
          Haptics.ImpactFeedbackStyle.Heavy,
          Haptics.ImpactFeedbackStyle.Soft,
          Haptics.ImpactFeedbackStyle.Light,
          Haptics.ImpactFeedbackStyle.Rigid
        ];
        const randomStyle = hapticStyles[Math.floor(Math.random() * hapticStyles.length)] ?? Haptics.ImpactFeedbackStyle.Medium;
        void Haptics.impactAsync(randomStyle).catch(() => {});
      }
    },
    [playBurstSound, startFrameSequence]
  );

  const runOverlay = useCallback(
    (context: BurstContext) => {
      if (!currentLogoSet) {
        console.warn('No logo set loaded, skipping burst animation');
        return;
      }

      resetState(context);
      animatingRef.current = true;

      const isStartup = context === 'startup';
      // 1 in 10 chance for special animation when coming from background
      const isSpecial = !isStartup && Math.random() < 0.1;
      const timingMultiplier = isSpecial ? 2 : 1;

      if (isSpecial) {
        console.log('🌟 Special animation triggered!');
      }

      const holdDuration = isStartup ? 0 : 20 * timingMultiplier; // REDUCED from 120ms to 20ms for faster start
      const entryDuration = isStartup ? 100 : (300 + Math.random() * 260) * timingMultiplier;
      const exitDelay = isStartup ? 900 : (60 + Math.random() * 80) * timingMultiplier;
      const exitDuration = isStartup ? 200 : (100 + Math.random() * 140) * timingMultiplier;
      const targetScale = isStartup ? 0.32 : 0.38 + Math.random() * 0.18;
      const targetTranslateY = isStartup
        ? -screenHeight * 0.22
        : -screenHeight * (0.2 + Math.random() * 0.26);
      const targetTranslateX = isStartup ? 0 : (Math.random() - 0.5) * screenWidth * 0.5;
      const startScaleFactor = isStartup ? 1.85 : 1.05 + Math.random() * 0.08;
      const startTranslateY = isStartup ? 0 : (Math.random() - 0.5) * screenHeight * 0.08;
      const startTranslateX = isStartup ? 0 : (Math.random() - 0.5) * screenWidth * 0.18;
      const startTilt = isStartup ? 0 : (Math.random() - 0.5) * 24;

      scaleX.setValue(FILL_SCALE_X * startScaleFactor);
      scaleY.setValue(FILL_SCALE_Y * startScaleFactor);
      translateY.setValue(startTranslateY);
      translateX.setValue(startTranslateX);
      rotate.setValue(startTilt);

      const finishOverlay = () => {
        animatingRef.current = false;
        clearTimers();
        stopActiveSound().catch(() => {});
        setFrameIndex(0);
        setVisible(false);

        // Always ensure next logo set is pre-loaded and ready for instant display
        // This guarantees the next background transition will have a logo ready
        console.log('🔄 Ensuring next logo set is prepared after animation');
        prepareNextLogoSet().catch(console.error);
      };

      // CRITICAL FIX: Show frame 1 burst MUCH EARLIER so it's visible immediately
      // Old calculation was ~240-320ms, now it's ~50-80ms for instant burst visibility
      const frameDelay = isStartup
        ? 50
        : (holdDuration + Math.min(60, Math.round(entryDuration * 0.12))) * (isSpecial ? 1.5 : 1);

      console.log(`⏱️ Animation Timing - Hold: ${holdDuration}ms | Entry: ${entryDuration}ms | Frame Burst Delay: ${frameDelay}ms | Exit: ${exitDuration}ms after ${exitDelay}ms`);

      if (frameStartTimeoutRef.current) {
        clearTimeout(frameStartTimeoutRef.current);
      }
      frameStartTimeoutRef.current = setTimeout(() => {
        frameStartTimeoutRef.current = null;
        if (animatingRef.current) {
          void triggerFrameBurst(context, currentLogoSet, isSpecial);
        }
      }, frameDelay);

      const exitTargetTranslateY = targetTranslateY - screenHeight * (isStartup ? 0.18 : 0.12);
      const exitAnimations = RNAnimated.parallel([
        RNAnimated.timing(scaleX, {
          toValue: 0.001,
          duration: exitDuration,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true
        }),
        RNAnimated.timing(scaleY, {
          toValue: 0.001,
          duration: exitDuration,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true
        }),
        RNAnimated.timing(opacity, {
          toValue: 0,
          duration: Math.max(160, exitDuration - 20),
          delay: isStartup ? 40 : 20,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true
        }),
        RNAnimated.timing(translateY, {
          toValue: exitTargetTranslateY,
          duration: exitDuration,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true
        })
      ]);

      let entryAnimations: RNAnimated.CompositeAnimation;
      if (isStartup) {
        entryAnimations = RNAnimated.parallel([
          RNAnimated.timing(scaleX, {
            toValue: targetScale,
            duration: entryDuration,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true
          }),
          RNAnimated.timing(scaleY, {
            toValue: targetScale,
            duration: entryDuration,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true
          }),
          RNAnimated.timing(translateY, {
            toValue: targetTranslateY,
            duration: entryDuration,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true
          })
        ]);
      } else {
        const scaleDamping = 6.2 + Math.random() * 1.8;
        const scaleStiffness = 135 + Math.random() * 35;
        const translateDamping = 6.6 + Math.random() * 1.8;
        const translateStiffness = 120 + Math.random() * 30;
        const rotationDamping = 6.8 + Math.random() * 2;
        const rotationStiffness = 130 + Math.random() * 40;

        entryAnimations = RNAnimated.parallel([
          RNAnimated.spring(scaleX, {
            toValue: targetScale,
            damping: scaleDamping,
            stiffness: scaleStiffness,
            mass: 0.8,
            useNativeDriver: true
          }),
          RNAnimated.spring(scaleY, {
            toValue: targetScale,
            damping: scaleDamping,
            stiffness: scaleStiffness,
            mass: 0.8,
            useNativeDriver: true
          }),
          RNAnimated.spring(translateY, {
            toValue: targetTranslateY,
            damping: translateDamping,
            stiffness: translateStiffness,
            mass: 0.92,
            useNativeDriver: true
          }),
          RNAnimated.spring(rotate, {
            toValue: 0,
            damping: rotationDamping,
            stiffness: rotationStiffness,
            mass: 0.7,
            useNativeDriver: true
          }),
          RNAnimated.timing(translateX, {
            toValue: targetTranslateX,
            duration: entryDuration,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true
          })
        ]);
      }

      RNAnimated.sequence([
        RNAnimated.delay(holdDuration),
        entryAnimations,
        RNAnimated.delay(exitDelay),
        exitAnimations
      ]).start(({ finished }) => {
        if (!finished) {
          finishOverlay();
          return;
        }
        finishOverlay();
      });
    },
    [
      currentLogoSet,
      clearTimers,
      resetState,
      stopActiveSound,
      triggerFrameBurst,
      scaleX,
      scaleY,
      translateY,
      opacity,
      translateX,
      rotate,
      setFrameIndex,
      setVisible
    ]
  );

  const handlePrimeEvent = useCallback(
    (payload: PrimePayload) => {
      const context: BurstContext = payload?.context ?? 'background';
      resetState(context);
    },
    [resetState]
  );

  // Load initial logo set on mount and prepare next
  // Use ref to ensure this only runs once on mount
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    loadNewLogoSet().then(() => {
      // After initial load, prepare the next one immediately
      prepareNextLogoSet().catch(console.error);
    }).catch(console.error);
  }, [loadNewLogoSet, prepareNextLogoSet]);

  // Event listeners for manual triggers
  useEffect(() => {
    const unsubPrime = addAppEventListener('iconBurst:prime', handlePrimeEvent);
    const unsubRun = addAppEventListener('iconBurst:run', (payload: PrimePayload) => {
      const context: BurstContext = payload?.context ?? 'background';
      runOverlay(context);
    });
    // DISABLED: Startup animations - we only want icon animation when returning from background
    // const unsubStartupShown = addAppEventListener('startup:shown', () => {
    //   resetState('startup');
    // });
    // const unsubStartupClosing = addAppEventListener('startup:closing', () => {
    //   runOverlay('startup');
    // });
    return () => {
      unsubPrime();
      unsubRun();
      // unsubStartupShown();
      // unsubStartupClosing();
    };
  }, [handlePrimeEvent, resetState, runOverlay]);

  // App state listener - load new logo set on background/foreground transitions
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const previous = lastAppStateRef.current;
      lastAppStateRef.current = next;

      if (next === 'inactive' && previous === 'active') {
        // Screen recording (or any other capture) owns the screen: never cover it.
        if (isIconBurstSuppressed()) {
          console.log('🚫 Icon burst suppressed (screen capture active)');
          clearTimers();
          animatingRef.current = false;
          setVisible(false);
          return;
        }
        // 🎯 INSTANT SHOW: Frame 0 appears IMMEDIATELY when app starts backgrounding
        if (backgroundTimestampRef.current === null) {
          backgroundTimestampRef.current = Date.now();
          console.log('⚡ App becoming inactive - SHOWING FRAME 0 NOW!');
        }

        // Prepare logo set for when we return
        if (nextLogoSet) {
          console.log(`✅ Pre-loaded logo set ${nextLogoSet.id} ready`);
          setCurrentLogoSet(nextLogoSet);
          setNextLogoSet(null);
          prepareNextLogoSet().catch(console.error);
        } else {
          console.warn('⚠️ Next logo set not ready, loading NOW...');
          loadNewLogoSet().then(() => {
            prepareNextLogoSet().catch(console.error);
          }).catch(console.error);
        }

        // SHOW FRAME 0 IMMEDIATELY - static, no animation
        if (currentLogoSet || nextLogoSet) {
          console.log('📍 Displaying static frame 0 INSTANTLY');
          animatingRef.current = false;  // No animation
          clearTimers();                  // Cancel any pending timers
          setFrameIndex(0);              // Frame 0 only
          setVisible(true);              // Make visible
          opacity.setValue(1);
          scaleX.setValue(FILL_SCALE_X * 1.05);
          scaleY.setValue(FILL_SCALE_Y * 1.05);
          translateX.setValue(0);
          translateY.setValue(0);
          rotate.setValue(0);
        }
      } else if (next === 'background') {
        // App fully backgrounded - just ensure frame 0 is still showing
        reachedBackgroundRef.current = true;
        console.log('🚀 App fully backgrounded');
      } else if (next === 'active' && (previous === 'background' || previous === 'inactive')) {
        // ONLY animate when returning from actual background
        const timeInBackground = backgroundTimestampRef.current
          ? Date.now() - backgroundTimestampRef.current
          : 0;
        const wasRealBackground = reachedBackgroundRef.current;
        reachedBackgroundRef.current = false;

        if (isIconBurstSuppressed() || !wasRealBackground) {
          // A system alert (screen-capture permission, battery, memory) — not a
          // backgrounding. Show nothing at all, just clean up.
          console.log(`⏭️ Skipping animation - ${isIconBurstSuppressed() ? 'suppressed' : 'system interruption, never backgrounded'}`);
          clearTimers();
          animatingRef.current = false;
          setVisible(false);
        } else if (timeInBackground > 800) {
          console.log(`✅ App was in background for ${timeInBackground}ms - playing animation`);
          runOverlay('background');
        } else {
          console.log(`⏭️ Skipping animation - only ${timeInBackground}ms in background (${timeInBackground < 800 ? 'too quick' : 'system interruption'})`);
          setVisible(false);
        }

        // Clear background timestamp
        backgroundTimestampRef.current = null;
      }
    });
    return () => {
      subscription.remove();
    };
  }, [runOverlay, loadNewLogoSet, prepareNextLogoSet, nextLogoSet, currentLogoSet, opacity, scaleX, scaleY, translateX, translateY, rotate, clearTimers]);

  // A capture can begin while the overlay is mid-animation (the user allows
  // screen recording right after resuming) — tear it down on the spot.
  useEffect(() => subscribeIconBurstSuppression((suppressed) => {
    if (!suppressed) return;
    clearTimers();
    animatingRef.current = false;
    backgroundTimestampRef.current = null;
    reachedBackgroundRef.current = false;
    stopActiveSound().catch(() => {});
    opacity.setValue(0);
    setVisible(false);
  }), [clearTimers, opacity, stopActiveSound]);

  useEffect(() => {
    return () => {
      clearTimers();
      stopActiveSound().catch(() => {});
    };
  }, [clearTimers, stopActiveSound]);

  if (!visible || !currentLogoSet || currentLogoSet.type !== 'image') {
    return null;
  }

  // Get the current frame source
  const currentFrameSource = frameIndex === 0
    ? currentLogoSet.baseIcon
    : currentLogoSet.frames[frameIndex - 1] ?? currentLogoSet.baseIcon;

  // Render as a plain non-blocking overlay (NOT a Modal). An iOS <Modal>
  // intercepts ALL touches across the screen while visible, so the resume/
  // background icon animation blocked painting & taps until it finished. A
  // root-level absolute View with pointerEvents="none" plays on top while
  // letting every touch pass straight through to the canvas underneath.
  return (
    <RNAnimated.View pointerEvents="none" style={[styles.overlay, { opacity }]}>
      <RNAnimated.Image
        source={currentFrameSource}
        style={[styles.icon, transformStyle]}
      />
    </RNAnimated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999999,
    elevation: 999999
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    resizeMode: 'stretch'
  }
});

export default IconBurstOverlay;
