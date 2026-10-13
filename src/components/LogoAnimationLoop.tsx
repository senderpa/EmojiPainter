import React, { useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, Image, StyleSheet, View, TouchableOpacity, AppState, AppStateStatus } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { Video, ResizeMode, Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { resolvePrefetchableImageUri } from '../lib/imageSource';
import { getRandomLogoSetWithTracking, LogoSet } from '../lib/logoManifest';

const INFO_VIDEO_INITIAL_VOLUME = 0.1;
const INFO_VIDEO_VOLUME_STEP = 0.01;
const randomVideoLoopLimit = (): number => 3 + Math.floor(Math.random() * 3);

interface LogoAnimationLoopProps {
  size?: number;
  frameInterval?: number;
  isMuted?: boolean; // Control video sound
  visible?: boolean; // Pause media while a parent overlay is covering the logo
  onPress?: () => void; // Optional click handler
}

const LogoAnimationLoop: React.FC<LogoAnimationLoopProps> = ({
  size = 84, // Reduced by 30% from 120
  frameInterval = 80,
  isMuted = false,
  visible = true,
  onPress
}) => {
  const [logoSet, setLogoSet] = useState<LogoSet | null>(null);
  const [nextLogoSet, setNextLogoSet] = useState<LogoSet | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isAppActive, setIsAppActive] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(INFO_VIDEO_INITIAL_VOLUME);
  const [isLoading, setIsLoading] = useState(false);
  const scale = useRef(new RNAnimated.Value(1)).current;
  const opacity = useRef(new RNAnimated.Value(1)).current;
  const videoRef = useRef<any>(null);
  const nextVideoRef = useRef<any>(null);
  const drumSoundRef = useRef<Audio.Sound | null>(null);
  const completedVideoLoopsRef = useRef(0);
  const videoLoopLimitRef = useRef(randomVideoLoopLimit());
  const changingLogoRef = useRef(false);

  const resetVideoCycle = () => {
    completedVideoLoopsRef.current = 0;
    videoLoopLimitRef.current = randomVideoLoopLimit();
    setVolume(INFO_VIDEO_INITIAL_VOLUME);
  };

  // Random drum hit sound generator (bass/snare with variations)
  const playRandomDrumHit = async () => {
    try {
      // Unload previous sound if exists
      if (drumSoundRef.current) {
        await drumSoundRef.current.unloadAsync();
        drumSoundRef.current = null;
      }

      // Randomly choose between bass or wobble (snare-like)
      const drumType = Math.random() > 0.5 ? 'bass' : 'wobble';

      // Random pitch variation (0.8 to 1.2)
      const pitchVariation = 0.8 + Math.random() * 0.4;

      // Random volume (0.4 to 0.7)
      const volume = 0.4 + Math.random() * 0.3;

      // Select random sound file
      const soundFiles = {
        bass: [
          require('../../assets/sounds/bass1.wav'),
          require('../../assets/sounds/bass2.wav'),
          require('../../assets/sounds/bass3.wav'),
          require('../../assets/sounds/bass4.wav'),
          require('../../assets/sounds/bass5.wav')
        ],
        wobble: [
          require('../../assets/sounds/wobble1.wav'),
          require('../../assets/sounds/wobble2.wav'),
          require('../../assets/sounds/wobble3.wav')
        ]
      };

      const selectedFiles = soundFiles[drumType];
      const randomFile = selectedFiles[Math.floor(Math.random() * selectedFiles.length)];

      // Create sound with hall effect (reverb simulation via volume envelope)
      const { sound } = await Audio.Sound.createAsync(
        randomFile,
        {
          shouldPlay: true,
          volume: volume,
          rate: pitchVariation,
          pitchCorrectionQuality: Audio.PitchCorrectionQuality.High
        }
      );

      drumSoundRef.current = sound;
      console.log(`🥁 Playing ${drumType} hit at ${pitchVariation.toFixed(2)}x pitch, ${(volume * 100).toFixed(0)}% volume`);

      // Auto-cleanup after playing
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
        }
      });
    } catch (error) {
      console.warn('Failed to play drum hit:', error);
    }
  };

  // Cleanup sound on unmount
  useEffect(() => {
    return () => {
      if (drumSoundRef.current) {
        drumSoundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  // Function to load next logo (for click handler)
  const loadNextLogo = async () => {
    if (changingLogoRef.current) return;
    changingLogoRef.current = true;
    try {
      // Generate random playback speed (0.8 to 1.2)
      const newPlaybackRate = 0.8 + Math.random() * 0.4;
      setPlaybackRate(newPlaybackRate);
      console.log(`🎵 New playback rate: ${newPlaybackRate.toFixed(2)}x`);

      setIsLoading(true);
      const newLogoSet = await getRandomLogoSetWithTracking();
      console.log(`Loading next logo: ${newLogoSet.id} (type: ${newLogoSet.type})`);

      resetVideoCycle();
      setFrameIndex(0);

      if (newLogoSet.type === 'video') {
        // Pre-load video media in the hidden player before swapping.
        setNextLogoSet(newLogoSet);
      } else {
        // Image sequences do not use the hidden Video player, so swap directly.
        setLogoSet(newLogoSet);
        setNextLogoSet(null);
        setIsLoading(false);
        changingLogoRef.current = false;
      }
    } catch (error) {
      console.warn('Failed to load next logo:', error);
      setIsLoading(false);
      changingLogoRef.current = false;
    }
  };

  // Swap to next video once it's loaded
  const swapToNextVideo = () => {
    if (nextLogoSet) {
      console.log(`✅ Swapping to loaded video: ${nextLogoSet.id}`);
      setLogoSet(nextLogoSet);
      setNextLogoSet(null);
      setIsLoading(false);
    }
  };

  // Handle press - call onPress if provided, otherwise cycle logo
  const handlePress = () => {
    // Heavy haptic feedback
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Play random drum hit sound
    void playRandomDrumHit();

    if (onPress) {
      onPress();
    } else {
      loadNextLogo();
    }
  };

  // Track app state (foreground/background)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('[LogoAnimation] App came to foreground - resuming animation');
        setIsAppActive(true);
        // Resume video if it exists
        if (videoRef.current && visible) {
          videoRef.current.playAsync().catch(() => {});
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        console.log('[LogoAnimation] App went to background - pausing animation on current frame');
        setIsAppActive(false);
        // Pause video if it exists
        if (videoRef.current) {
          videoRef.current.pauseAsync().catch(() => {});
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [visible]);

  // Stop both the logo video and its click sound while another lesson overlay
  // is covering the Info panel. This prevents hidden media from leaking audio.
  useEffect(() => {
    if (visible) {
      resetVideoCycle();
      if (videoRef.current && isAppActive) {
        videoRef.current.setPositionAsync(0).catch(() => {});
        videoRef.current.setIsMutedAsync(isMuted).catch(() => {});
        videoRef.current.setVolumeAsync(isMuted ? 0 : INFO_VIDEO_INITIAL_VOLUME).catch(() => {});
        videoRef.current.playAsync().catch(() => {});
      }
      return;
    }
    resetVideoCycle();
    changingLogoRef.current = false;
    videoRef.current?.pauseAsync().catch(() => {});
    videoRef.current?.setPositionAsync(0).catch(() => {});
    videoRef.current?.setVolumeAsync(0).catch(() => {});
    if (drumSoundRef.current) {
      drumSoundRef.current.stopAsync().catch(() => {});
      drumSoundRef.current.unloadAsync().catch(() => {});
      drumSoundRef.current = null;
    }
  }, [isAppActive, isMuted, visible]);

  // Load logo set on mount
  useEffect(() => {
    const loadLogoSet = async () => {
      // Set random playback rate on first load
      const initialPlaybackRate = 0.8 + Math.random() * 0.4;
      setPlaybackRate(initialPlaybackRate);
      console.log(`🎵 Initial playback rate: ${initialPlaybackRate.toFixed(2)}x`);

      const newLogoSet = await getRandomLogoSetWithTracking();
      console.log(`Loading logo animation: ${newLogoSet.id} (type: ${newLogoSet.type})`);

      // For video logos, just set it immediately (no prefetching needed)
      if (newLogoSet.type === 'video') {
        console.log(`✅ Video logo ready: ${newLogoSet.id}`);
        setLogoSet(newLogoSet);
        return;
      }

      // For image logos, prefetch images
      try {
        const baseUri = resolvePrefetchableImageUri(newLogoSet.baseIcon);
        if (baseUri) {
          await Image.prefetch(baseUri);
        }
        const prefetchPromises = newLogoSet.frames
          .map(frame => resolvePrefetchableImageUri(frame))
          .filter((uri): uri is string => !!uri)
          .map(uri => Image.prefetch(uri));
        await Promise.all(prefetchPromises);
        console.log(`✅ Logo animation ready: ${newLogoSet.id}`);
        setLogoSet(newLogoSet);
      } catch (error) {
        console.warn('Failed to prefetch logo animation:', error);
        setLogoSet(newLogoSet); // Use it anyway
      }
    };

    loadLogoSet();
  }, []);

  // Continuous frame loop (only for image-based logos)
  useEffect(() => {
    if (!logoSet || logoSet.type === 'video' || !visible) return;

    const interval = setInterval(() => {
      setFrameIndex((prev) => {
        // Loop through all frames (0 = base, 1-10 = frames)
        const maxFrames = logoSet.frames.length;
        return (prev + 1) % (maxFrames + 1);
      });
    }, frameInterval);

    return () => clearInterval(interval);
  }, [logoSet, frameInterval, visible]);

  // Subtle pulse animation
  useEffect(() => {
    const pulseAnimation = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(scale, {
          toValue: 1.05,
          duration: 1200,
          useNativeDriver: true
        }),
        RNAnimated.timing(scale, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true
        })
      ])
    );

    pulseAnimation.start();

    return () => {
      pulseAnimation.stop();
    };
  }, [scale]);

  if (!logoSet) {
    // First load placeholder - only shows on very first load
    return (
      <View style={[styles.container, { width: size, height: size, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ fontSize: size / 2, opacity: 0.5 }}>🎨</Text>
      </View>
    );
  }

  // Render video logo
  if (logoSet.type === 'video') {
    const content = (
      <View style={styles.container}>
        {/* Current visible video */}
        <RNAnimated.View
          style={{
            width: size,
            height: size,
            transform: [{ scale }],
            opacity
          }}
        >
          {/* Placeholder app icon behind video */}
          <Image
            source={require('../../assets/icon.png')}
            style={{
              width: '100%',
              height: '100%',
              position: 'absolute',
              top: 0,
              left: 0
            }}
            resizeMode="contain"
          />

          {/* Video on top */}
          <Video
            ref={videoRef}
            source={logoSet.videoSource}
            style={{ width: '100%', height: '100%' }}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={isAppActive && visible}
            isLooping
            isMuted={isMuted}
            volume={isMuted ? 0 : volume}
            rate={playbackRate}
            useNativeControls={false}
            onLoad={() => {
              resetVideoCycle();
              changingLogoRef.current = false;
              if (videoRef.current) {
                videoRef.current.setRateAsync(playbackRate, true).catch(() => {});
                videoRef.current.setIsMutedAsync(isMuted || !visible).catch(() => {});
                videoRef.current.setVolumeAsync(
                  isMuted || !visible ? 0 : INFO_VIDEO_INITIAL_VOLUME
                ).catch(() => {});
              }
            }}
            onPlaybackStatusUpdate={(status: any) => {
              if (!visible || !status.isLoaded || !status.didJustFinish || changingLogoRef.current) return;

              completedVideoLoopsRef.current += 1;
              if (completedVideoLoopsRef.current >= videoLoopLimitRef.current) {
                videoRef.current?.pauseAsync().catch(() => {});
                void loadNextLogo();
                return;
              }

              const nextVolume = Math.min(
                1,
                INFO_VIDEO_INITIAL_VOLUME + completedVideoLoopsRef.current * INFO_VIDEO_VOLUME_STEP
              );
              setVolume(nextVolume);
              videoRef.current?.setVolumeAsync(isMuted ? 0 : nextVolume).catch(() => {});
            }}
            onError={(error) => {
              console.warn('❌ Video failed to load:', error);
              changingLogoRef.current = false;
              // Placeholder icon will be visible
            }}
          />
        </RNAnimated.View>

        {/* Pre-load next video in background (invisible) */}
        {nextLogoSet && nextLogoSet.type === 'video' && (
          <View style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}>
            <Video
              ref={nextVideoRef}
              source={nextLogoSet.videoSource}
              style={{ width: size, height: size }}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={false}
              isLooping
              isMuted={true}
              useNativeControls={false}
              onReadyForDisplay={() => {
                console.log('📺 Next video ready for display, swapping now');
                swapToNextVideo();
              }}
              onError={(error) => {
                console.warn('❌ Next video failed to load:', error);
                setNextLogoSet(null);
                setIsLoading(false);
                changingLogoRef.current = false;
              }}
            />
          </View>
        )}
      </View>
    );

    // Wrap in TouchableOpacity if clickable
    return onPress || !isMuted ? (
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    ) : content;
  }

  // Render image frame animation
  const currentFrameSource = frameIndex === 0
    ? logoSet.baseIcon
    : logoSet.frames[frameIndex - 1] ?? logoSet.baseIcon;

  const imageContent = (
    <View style={styles.container}>
      <RNAnimated.Image
        source={currentFrameSource}
        style={[
          styles.image,
          {
            width: size,
            height: size,
            transform: [{ scale }],
            opacity
          }
        ]}
        resizeMode="contain"
        resizeMethod="scale" // Better quality rendering on mobile
      />
    </View>
  );

  // Wrap in TouchableOpacity if clickable
  return onPress || !isMuted ? (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
      {imageContent}
    </TouchableOpacity>
  ) : imageContent;
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  image: {
    // Size set by props
  }
});

export default LogoAnimationLoop;
