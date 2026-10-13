/**
 * Animated Random Entry Component
 *
 * Displays random community entries:
 * - Loads instantly when info panel opens
 * - Simple fade transition when switching entries
 * - Tap anywhere on panel to load next entry
 */

import React, { useState, useRef, useEffect } from 'react';
import { View, Image, TouchableOpacity, Animated as RNAnimated } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { Video, ResizeMode } from 'expo-av';
import * as Haptics from 'expo-haptics';
import type { DailyPaintGalleryEntry } from '../lib/dailyPaintGallery';
import { maskTopic, formatMaskedTopic } from '../gesser/utils/masking';

const INFO_VIDEO_INITIAL_VOLUME = 0.1;
const INFO_VIDEO_VOLUME_STEP = 0.01;
const randomVideoLoopLimit = (): number => 3 + Math.floor(Math.random() * 3);

interface AnimatedRandomEntryProps {
  galleryEntries: DailyPaintGalleryEntry[];
  initialEntry: DailyPaintGalleryEntry | null;
  visible?: boolean;
  onGuess?: (paintingId: number, topic: string) => void;
}

// Helper function to detect if a URL is a video
const isVideoUrl = (url: string | undefined | null): boolean => {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.mov');
};

export default function AnimatedRandomEntry({
  galleryEntries,
  initialEntry,
  visible = true,
  onGuess,
}: AnimatedRandomEntryProps) {
  const [currentEntry, setCurrentEntry] = useState<DailyPaintGalleryEntry | null>(initialEntry);
  const fadeAnim = useRef(new RNAnimated.Value(1)).current;
  const scale = useRef(new RNAnimated.Value(1)).current;
  const videoRef = useRef<Video | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const completedVideoLoopsRef = useRef(0);
  const videoLoopLimitRef = useRef(randomVideoLoopLimit());
  const changingEntryRef = useRef(false);

  const resetVideoCycle = () => {
    completedVideoLoopsRef.current = 0;
    videoLoopLimitRef.current = randomVideoLoopLimit();
  };

  // Track remaining entries that haven't been shown yet (sorted newest first)
  const [remainingEntries, setRemainingEntries] = useState<DailyPaintGalleryEntry[]>([]);

  // Initialize remaining entries when gallery entries load (sorted newest first)
  useEffect(() => {
    if (galleryEntries && galleryEntries.length > 0) {
      // Sort by createdAt descending (newest first)
      const sorted = [...galleryEntries].sort((a, b) => b.createdAt - a.createdAt);
      // Remove initial entry from remaining if it exists
      const remaining = initialEntry
        ? sorted.filter(e => e.id !== initialEntry.id)
        : sorted;
      setRemainingEntries(remaining);
      console.log('[AnimatedRandomEntry] Initialized with', remaining.length, 'entries (sorted newest first)');
    }
  }, [galleryEntries, initialEntry]);

  // Update current entry when initial entry loads
  useEffect(() => {
    if (initialEntry) {
      setCurrentEntry(initialEntry);
      resetVideoCycle();
    }
  }, [initialEntry]);

  // Adjust video volume based on visibility
  useEffect(() => {
    if (videoRef.current) {
      if (visible) {
        resetVideoCycle();
        videoRef.current.setPositionAsync(0).catch(() => {});
        videoRef.current.setIsMutedAsync(false).catch(() => {});
        videoRef.current.playAsync().catch(() => {});
        videoRef.current.setVolumeAsync(INFO_VIDEO_INITIAL_VOLUME).catch(() => {});
      } else {
        resetVideoCycle();
        changingEntryRef.current = false;
        videoRef.current.pauseAsync().catch(() => {});
        videoRef.current.setPositionAsync(0).catch(() => {});
        videoRef.current.setVolumeAsync(0).catch(() => {});
      }
    }
  }, [visible]);


  const loadNextEntry = (withHaptics = true) => {
    if (changingEntryRef.current) return;
    changingEntryRef.current = true;
    console.log('[AnimatedRandomEntry] 🎨 Click detected, loading next entry');
    if (withHaptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!galleryEntries || galleryEntries.length === 0) {
      console.log('[AnimatedRandomEntry] No gallery entries available');
      changingEntryRef.current = false;
      return;
    }

    // Pause video if playing
    if (videoRef.current) {
      videoRef.current.pauseAsync().catch(() => {});
    }

    // Pick next entry FIRST (before animation)
    let nextEntry: DailyPaintGalleryEntry | null = null;
    let updatedRemaining = [...remainingEntries];

    // If no remaining entries, reset to full sorted list excluding current
    if (updatedRemaining.length === 0 && galleryEntries) {
      const sorted = [...galleryEntries].sort((a, b) => b.createdAt - a.createdAt);
      updatedRemaining = sorted.filter(e => e.id !== currentEntry?.id);
      console.log('[AnimatedRandomEntry] Refilled with', updatedRemaining.length, 'entries');
    }

    // Pick next entry from remaining (newest first, since sorted)
    if (updatedRemaining.length > 0) {
      // Pick from top 3 newest to add some variety
      const topCount = Math.min(3, updatedRemaining.length);
      const randomIndex = Math.floor(Math.random() * topCount);
      nextEntry = updatedRemaining[randomIndex];

      // Remove picked entry from remaining
      updatedRemaining.splice(randomIndex, 1);
      setRemainingEntries(updatedRemaining);
      console.log('[AnimatedRandomEntry] ✅ Picked entry:', nextEntry?.id, nextEntry?.topic, '|', updatedRemaining.length, 'remaining');
    }

    if (!nextEntry) {
      console.log('[AnimatedRandomEntry] ⚠️ No next entry available');
      changingEntryRef.current = false;
      return;
    }

    // Choose random transition style (1-3) - simple smooth bounces
    const transitionStyle = Math.floor(Math.random() * 3) + 1;
    console.log('[AnimatedRandomEntry] Using transition style:', transitionStyle);

    // Animate OUT - simple fade + scale
    const animateOut = RNAnimated.parallel([
      RNAnimated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true
      }),
      RNAnimated.timing(scale, {
        toValue: 0.8,
        duration: 150,
        useNativeDriver: true
      })
    ]);

    // Animate IN with bounce - different styles
    const animateIn = () => {
      // Reset scale based on transition style
      switch (transitionStyle) {
        case 1: // Zoom from small
          scale.setValue(0.7);
          return RNAnimated.parallel([
            RNAnimated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
            RNAnimated.spring(scale, {
              toValue: 1,
              tension: 50,
              friction: 7,
              useNativeDriver: true
            })
          ]);
        case 2: // Zoom from large
          scale.setValue(1.2);
          return RNAnimated.parallel([
            RNAnimated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
            RNAnimated.spring(scale, {
              toValue: 1,
              tension: 40,
              friction: 6,
              useNativeDriver: true
            })
          ]);
        case 3: // Smooth elastic bounce
          scale.setValue(0.5);
          return RNAnimated.parallel([
            RNAnimated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
            RNAnimated.spring(scale, {
              toValue: 1,
              tension: 60,
              friction: 8,
              useNativeDriver: true
            })
          ]);
        default:
          scale.setValue(0.8);
          return RNAnimated.parallel([
            RNAnimated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
            RNAnimated.spring(scale, {
              toValue: 1,
              tension: 50,
              friction: 7,
              useNativeDriver: true
            })
          ]);
      }
    };

    // Execute transition
    animateOut.start(() => {
      // Update entry
      setCurrentEntry(nextEntry);
      setIsVideoReady(false);
      resetVideoCycle();
      changingEntryRef.current = false;

      // Animate in with bounce
      animateIn().start();
    });
  };


  // Show minimal loading state while waiting for first entry (no emoji, just empty box)
  if (!currentEntry) {
    return (
      <View style={{ marginTop: 20, paddingHorizontal: 18, marginBottom: 50 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: '#4CAF50', fontSize: 14, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
            Community Inspiration
          </Text>
        </View>
        <View
          style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 12,
            padding: 13,
            borderWidth: 1,
            borderColor: '#4CAF50',
            minHeight: 200,
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          {/* Empty - no text or emoji during loading */}
        </View>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 20, paddingHorizontal: 18, marginBottom: 50 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ color: '#4CAF50', fontSize: 14, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
          Community Inspiration
        </Text>
      </View>

      <TouchableOpacity
        onPress={() => loadNextEntry(true)}
        activeOpacity={0.7}
      >
        <RNAnimated.View
          style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 12,
            padding: 13,
            borderWidth: 1,
            borderColor: '#4CAF50',
            opacity: fadeAnim,
            transform: [{ scale }]
          }}
        >
          {(() => {
            const isMystery = currentEntry.isMysteryPaint && currentEntry.mysteryPaintingId != null;
            const seed = currentEntry.mysteryPaintingId ?? currentEntry.id;
            const displayTopic = isMystery
              ? formatMaskedTopic(maskTopic(currentEntry.topic, seed).masked)
              : currentEntry.topic;
            return (
              <View style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: isMystery ? '#0ff' : '#fff', fontSize: 17.6, fontFamily: 'vrtlfinal', flex: 1, letterSpacing: isMystery ? 2 : 0 }}>
                    {isMystery ? `🔮 ${displayTopic}` : displayTopic}
                  </Text>
                  <View style={{ backgroundColor: 'rgba(76, 175, 80, 0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: '#4CAF50', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {new Date(currentEntry.createdAt).toLocaleDateString() === new Date().toLocaleDateString()
                        ? 'TODAY'
                        : 'ARCHIVE'}
                    </Text>
                  </View>
                </View>
                {isMystery && onGuess && (
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation(); onGuess(currentEntry.mysteryPaintingId!, currentEntry.topic); }}
                    style={{ marginTop: 8, backgroundColor: '#0ff', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'flex-start' }}
                    activeOpacity={0.75}
                  >
                    <Text style={{ color: '#000', fontWeight: '700', fontSize: 13, fontFamily: 'vrtlfinal' }}>🤔 Guess the topic</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}
          {(() => {
            // Determine media URL and type
            const mediaUrl = currentEntry.rawUrl || currentEntry.imageUrl;
            const isVideo = isVideoUrl(mediaUrl);

            if (!mediaUrl) return null;

            return (
              <View style={{ marginVertical: 8, alignItems: 'center' }} pointerEvents="none">
                {isVideo ? (
                  <Video
                    ref={(ref) => {
                      videoRef.current = ref;
                    }}
                    source={{ uri: mediaUrl }}
                    style={{ width: '105%', aspectRatio: 1, borderRadius: 8, backgroundColor: '#000' }}
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay={visible}
                    isLooping={true}
                    isMuted={!visible}
                    volume={visible ? INFO_VIDEO_INITIAL_VOLUME : 0}
                    useNativeControls={false}
                    onLoad={() => {
                      setIsVideoReady(true);
                      // Ensure sound is enabled when video loads
                      if (videoRef.current && visible) {
                        videoRef.current.setIsMutedAsync(false).catch(() => {});
                        videoRef.current.setVolumeAsync(INFO_VIDEO_INITIAL_VOLUME).catch(() => {});
                      }
                    }}
                    onPlaybackStatusUpdate={(status: any) => {
                      if (visible && status.isLoaded && status.didJustFinish && !changingEntryRef.current) {
                        completedVideoLoopsRef.current += 1;
                        if (completedVideoLoopsRef.current >= videoLoopLimitRef.current) {
                          loadNextEntry(false);
                          return;
                        }
                        const nextVolume = Math.min(
                          1,
                          INFO_VIDEO_INITIAL_VOLUME + completedVideoLoopsRef.current * INFO_VIDEO_VOLUME_STEP
                        );
                        videoRef.current?.setVolumeAsync(nextVolume).catch(() => {});
                        return;
                      }
                      if (visible && status.isLoaded && !status.isPlaying && isVideoReady) {
                        videoRef.current?.playAsync().catch(() => {});
                      }
                    }}
                  />
                ) : (
                  <Image
                    source={{ uri: mediaUrl }}
                    style={{ width: '105%', aspectRatio: 1, borderRadius: 8, backgroundColor: '#000' }}
                    resizeMode="contain"
                  />
                )}
              </View>
            );
          })()}
          <View style={{ marginTop: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 19.8, fontFamily: 'vrtlfinal', marginBottom: 2 }}>
                  {(() => {
                    const timestamp =
                      currentEntry.createdAt < 10000000000 ? currentEntry.createdAt * 1000 : currentEntry.createdAt;
                    return new Date(timestamp).toLocaleDateString('en-US', { weekday: 'long' });
                  })()}
                </Text>
                <Text style={{ color: '#888', fontSize: 15.4, fontFamily: 'vrtlfinal' }}>
                  {currentEntry.passportName || 'Anonymous'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: '#fff', fontSize: 26.4, fontFamily: 'vrtlfinal', lineHeight: 30 }}>
                  {(() => {
                    const timestamp =
                      currentEntry.createdAt < 10000000000 ? currentEntry.createdAt * 1000 : currentEntry.createdAt;
                    return new Date(timestamp).toLocaleDateString('en-US', { day: '2-digit' });
                  })()}
                </Text>
                <Text style={{ color: '#888', fontSize: 15.4, fontFamily: 'vrtlfinal' }}>
                  {(() => {
                    const timestamp =
                      currentEntry.createdAt < 10000000000 ? currentEntry.createdAt * 1000 : currentEntry.createdAt;
                    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short' });
                  })()}
                </Text>
              </View>
            </View>
            <Text style={{ color: '#666', fontSize: 12, textAlign: 'center', fontFamily: 'vrtlfinal' }}>
              Tap to load another inspiration
            </Text>
          </View>
        </RNAnimated.View>
      </TouchableOpacity>
    </View>
  );
}
