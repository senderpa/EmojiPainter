/**
 * AnimatedLoader - Loader animation with progress bar
 *
 * Shows smooth looping logo frame animation with optional progress percentage
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated as RNAnimated, TouchableOpacity, Image, Platform } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { getRandomLogoSetWithTracking, type LogoSet } from '../lib/logoManifest';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

type AnimatedLoaderProps = {
  progress?: number; // 0-100, optional progress percentage
  message?: string; // Optional message to display
  showProgressBar?: boolean; // Show progress bar
  speed?: number; // Playback speed multiplier (0.5 = slow, 1.0 = normal, 2.0 = fast)
  onAbort?: () => void; // Optional abort callback
  showAbortButton?: boolean; // Show abort button
  useLogoAnimation?: boolean; // Use logo frames instead of video
};

const AnimatedLoader: React.FC<AnimatedLoaderProps> = ({
  progress,
  message = 'Please wait...',
  showProgressBar = false,
  speed = 1.0,
  onAbort,
  showAbortButton = false,
  useLogoAnimation = true
}) => {
  const videoRef = useRef<Video>(null);
  const progressAnim = useRef(new RNAnimated.Value(0)).current;
  const [logoSet, setLogoSet] = useState<LogoSet | null>(null);
  const [logoFrameIndex, setLogoFrameIndex] = useState(0);

  // Start video playback immediately when component mounts
  useEffect(() => {
    const playVideo = async () => {
      if (videoRef.current) {
        try {
          console.log('[AnimatedLoader] Starting video playback at speed:', speed);
          await videoRef.current.playAsync();
          await videoRef.current.setIsLoopingAsync(true);
          await videoRef.current.setRateAsync(speed, true);
          console.log('[AnimatedLoader] Video playback started successfully');
        } catch (error) {
          console.log('[AnimatedLoader] Video playback error:', error);
        }
      }
    };

    // Small delay to ensure video component is mounted
    const timeout = setTimeout(playVideo, 100);
    return () => clearTimeout(timeout);
  }, []);

  // Update playback rate when speed changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.setRateAsync(speed, true).catch(() => {});
    }
  }, [speed]);

  // Trigger haptic feedback on progress milestones
  useEffect(() => {
    if (typeof progress === 'number') {
      // Trigger haptic at 25%, 50%, 75%, 100%
      const rounded = Math.round(progress);
      if (rounded === 25 || rounded === 50 || rounded === 75) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } else if (rounded === 100) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      }
    }
  }, [progress]);

  // Animate progress bar
  useEffect(() => {
    if (typeof progress === 'number') {
      RNAnimated.timing(progressAnim, {
        toValue: progress,
        duration: 300,
        useNativeDriver: false
      }).start();
    }
  }, [progress, progressAnim]);

  // Load random logo set - always load on mount
  useEffect(() => {
    if (!logoSet) {
      getRandomLogoSetWithTracking().then(newLogoSet => {
        console.log('[AnimatedLoader] Loaded logo set:', newLogoSet.id, 'type:', newLogoSet.type);
        setLogoSet(newLogoSet);
        setLogoFrameIndex(0);
      });
    }
  }, [logoSet]);

  // Cycle through logo frames (only for image-based logos)
  useEffect(() => {
    if (!logoSet) return;

    // For video logos, no frame cycling needed
    if (logoSet.type === 'video') return;

    const interval = setInterval(() => {
      setLogoFrameIndex((prev) => (prev + 1) % (logoSet.frames.length + 1));
    }, 80); // 80ms per frame for smooth animation

    return () => clearInterval(interval);
  }, [logoSet]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%']
  });

  return (
    <View style={styles.container}>
      <View style={styles.overlay}>
        {/* Loader Animation - random logo from manifest */}
        <View style={styles.loaderBox}>
          {logoSet ? (
            logoSet.type === 'image' ? (
              // Image frame animation
              <Image
                source={logoFrameIndex === 0 ? logoSet.baseIcon : logoSet.frames[logoFrameIndex - 1] ?? logoSet.baseIcon}
                style={styles.loaderLogo}
              />
            ) : (
              // Video logo
              <Video
                ref={videoRef}
                source={logoSet.videoSource}
                style={styles.loaderVideo}
                resizeMode={ResizeMode.CONTAIN}
                isMuted={false}
                shouldPlay={true}
                isLooping={true}
              />
            )
          ) : null}
        </View>

        {/* Message */}
        <Text style={styles.message}>{message}</Text>

        {/* Progress Bar */}
        {showProgressBar && typeof progress === 'number' && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <RNAnimated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        )}

        {/* Abort Button */}
        {showAbortButton && onAbort && (
          <TouchableOpacity
            style={styles.abortButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onAbort();
            }}
          >
            <Text style={styles.abortButtonText}>❌ Abort Export</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24
  },
  loaderBox: {
    width: IS_IPAD ? 512 : 358, // 30% smaller on phone (512 * 0.7 = 358)
    height: IS_IPAD ? 512 : 358,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loaderVideo: {
    width: '100%',
    height: '100%'
  },
  loaderLogo: {
    width: 200,
    height: 200,
    resizeMode: 'contain'
  },
  message: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 0.5
  },
  progressContainer: {
    width: '80%',
    maxWidth: 400,
    gap: 12
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 4,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#5a8aca',
    borderRadius: 4
  },
  progressText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
    textAlign: 'center'
  },
  abortButton: {
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 32,
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FF3B30'
  },
  abortButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FF3B30',
    textAlign: 'center'
  }
});

export default AnimatedLoader;
