import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Image, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';

import type { DailyPaintGalleryEntry } from '../lib/dailyPaintGallery';

const { width: W, height: H } = Dimensions.get('window');

const FONT = 'vrtlfinal';

const DURATION_OPTIONS = [
  { label: '3s', ms: 3000 },
  { label: '5s', ms: 5000 },
  { label: '8s', ms: 8000 },
  { label: '15s', ms: 15000 },
];

interface Props {
  entries: DailyPaintGalleryEntry[];
  initialIndex?: number;
  skipOptions?: boolean;
  initialDurationMs?: number;
  onClose: () => void;
}

export const GallerySlideshow: React.FC<Props> = ({
  entries,
  initialIndex = 0,
  skipOptions = false,
  initialDurationMs = 5000,
  onClose,
}) => {
  const [showOptions, setShowOptions] = useState(!skipOptions);
  const [slideDuration, setSlideDuration] = useState(initialDurationMs);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isPlaying, setIsPlaying] = useState(skipOptions);

  const fadeAnim = useRef(new Animated.Value(skipOptions ? 0 : 1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitioningRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const transitionTo = useCallback(
    (nextIndex: number) => {
      if (transitioningRef.current || entries.length === 0) return;
      transitioningRef.current = true;
      clearTimer();
      Animated.timing(fadeAnim, { toValue: 0, duration: 500, useNativeDriver: true }).start(() => {
        setCurrentIndex(nextIndex % entries.length);
        scaleAnim.setValue(1);
        transitioningRef.current = false;
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(scaleAnim, {
            toValue: 1.06,
            duration: slideDuration + 800,
            useNativeDriver: true,
          }),
        ]).start();
      });
    },
    [entries.length, fadeAnim, scaleAnim, slideDuration]
  );

  const goNext = useCallback(() => {
    transitionTo((currentIndex + 1) % entries.length);
  }, [currentIndex, entries.length, transitionTo]);

  const goPrev = useCallback(() => {
    transitionTo((currentIndex - 1 + entries.length) % entries.length);
  }, [currentIndex, entries.length, transitionTo]);

  // Auto-advance + Ken Burns effect
  useEffect(() => {
    if (showOptions || !isPlaying || entries.length === 0) return;

    scaleAnim.setValue(1);
    Animated.timing(scaleAnim, {
      toValue: 1.06,
      duration: slideDuration + 800,
      useNativeDriver: true,
    }).start();

    fadeAnim.setValue(1);

    timerRef.current = setTimeout(() => {
      if (!transitioningRef.current) {
        setCurrentIndex((i) => {
          const next = (i + 1) % entries.length;
          transitionTo(next);
          return i;
        });
      }
    }, slideDuration);

    return () => {
      clearTimer();
      scaleAnim.stopAnimation();
    };
  }, [currentIndex, isPlaying, showOptions, slideDuration, entries.length, scaleAnim, fadeAnim, transitionTo]);

  // Initial fade-in for autoplay mode
  useEffect(() => {
    if (skipOptions) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
    }
  }, []);

  const entry = entries[currentIndex];
  if (!entry && !showOptions) return null;

  return (
    <Modal visible animationType="fade" statusBarTranslucent transparent={false}>
      {showOptions ? (
        <View style={styles.optionsContainer}>
          <Text style={styles.optionsEmoji}>▶️</Text>
          <Text style={styles.optionsTitle}>Gallery Slideshow</Text>
          <Text style={styles.optionsSubtitle}>{entries.length} artworks</Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Time per slide</Text>
            <View style={styles.durationRow}>
              {DURATION_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.ms}
                  style={[styles.durationBtn, slideDuration === opt.ms && styles.durationBtnActive]}
                  onPress={() => setSlideDuration(opt.ms)}
                >
                  <Text
                    style={[styles.durationBtnText, slideDuration === opt.ms && styles.durationBtnTextActive]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => {
              setShowOptions(false);
              setIsPlaying(true);
            }}
          >
            <Text style={styles.startBtnText}>▶  Start Slideshow</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.slideshowContainer}>
          {entry ? (
            <Animated.Image
              source={{ uri: entry.imageUrl }}
              style={[styles.slideImage, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}
              resizeMode="cover"
            />
          ) : null}

          {/* Bottom gradient */}
          <View style={styles.bottomGradient} pointerEvents="none" />

          {/* Caption */}
          {entry ? (
            <Animated.View style={[styles.captionBlock, { opacity: fadeAnim }]} pointerEvents="none">
              {entry.topic ? <Text style={styles.captionTopic}>{entry.topic}</Text> : null}
              <Text style={styles.captionArtist}>by {entry.passportName || 'Anonymous Painter'}</Text>
            </Animated.View>
          ) : null}

          {/* Progress dots */}
          <View style={styles.dotsRow} pointerEvents="none">
            {entries.slice(0, Math.min(entries.length, 25)).map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === currentIndex % 25 && styles.dotActive]}
              />
            ))}
          </View>

          {/* Counter */}
          <Text style={styles.counter} pointerEvents="none">
            {currentIndex + 1} / {entries.length}
          </Text>

          {/* Navigation controls */}
          <View style={styles.navRow} pointerEvents="box-none">
            <TouchableOpacity style={styles.navBtn} onPress={goPrev}>
              <Text style={styles.navBtnText}>‹</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pauseBtn} onPress={() => setIsPlaying((p) => !p)}>
              <Text style={styles.pauseBtnText}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.navBtn} onPress={goNext}>
              <Text style={styles.navBtnText}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Close */}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  // Options screen
  optionsContainer: {
    flex: 1,
    backgroundColor: '#080808',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    gap: 16,
  },
  optionsEmoji: {
    fontSize: 48,
    marginBottom: 4,
  },
  optionsTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    fontFamily: FONT,
    letterSpacing: 0.5,
  },
  optionsSubtitle: {
    color: '#888',
    fontSize: 14,
    fontFamily: FONT,
    marginBottom: 12,
  },
  section: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  sectionLabel: {
    color: '#aaa',
    fontSize: 12,
    fontFamily: FONT,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  durationRow: {
    flexDirection: 'row',
    gap: 10,
  },
  durationBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#111',
  },
  durationBtnActive: {
    borderColor: '#ff9f6b',
    backgroundColor: 'rgba(255,159,107,0.15)',
  },
  durationBtnText: {
    color: '#888',
    fontFamily: FONT,
    fontSize: 14,
  },
  durationBtnTextActive: {
    color: '#ff9f6b',
    fontWeight: '700',
  },
  startBtn: {
    marginTop: 16,
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: '#ff9f6b',
  },
  startBtnText: {
    color: '#000',
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  cancelBtnText: {
    color: '#555',
    fontFamily: FONT,
    fontSize: 13,
  },

  // Slideshow screen
  slideshowContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideImage: {
    ...StyleSheet.absoluteFillObject,
    width: W,
    height: H,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: H * 0.45,
    backgroundColor: 'transparent',
    // simulated gradient using opacity layers
  },
  captionBlock: {
    position: 'absolute',
    bottom: 110,
    left: 24,
    right: 80,
    gap: 6,
  },
  captionTopic: {
    color: '#fff',
    fontSize: 22,
    fontFamily: FONT,
    fontWeight: '800',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  captionArtist: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: FONT,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  dotsRow: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 14,
  },
  counter: {
    position: 'absolute',
    top: 60,
    right: 24,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontFamily: FONT,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  navRow: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  navBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBtnText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 32,
  },
  pauseBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseBtnText: {
    fontSize: 22,
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
