import React, { useEffect, useMemo } from 'react';
import { Animated, Dimensions, Modal, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import * as Haptics from 'expo-haptics';

import { BASE_FONT_FAMILY } from '../theme/fontConfig';
import LogoAnimationLoop from './LogoAnimationLoop';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;
const EXPLOSION_EMOJIS = ['✨', '💥', '🌟', '🎆', '🎇', '💫', '🔥', '⭐️', '💎', '🌈', '⚡️', '🧨', '🌠', '🌌', '🎉', '🎊', '🚀', '☄️', '💣', '🪄', '🌋', '🪐'];

type AutosaveOverlayProps = {
  visible: boolean;
  savedAt?: string | null;
  onRestore: () => void;
  onDiscard: () => void;
};

type BurstParticle = {
  id: string;
  emoji: string;
  progress: Animated.Value;
  delay: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startScale: number;
  endScale: number;
  rotateStart: number;
  rotateEnd: number;
  fontSize: number;
  duration: number;
};

const AutosaveOverlay: React.FC<AutosaveOverlayProps> = ({ visible, savedAt, onRestore, onDiscard }) => {
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const burstOnceRef = React.useRef(true);
  const hapticTimeoutsRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const autoResumeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardScale = React.useRef(new Animated.Value(0)).current;
  const particles = useMemo<BurstParticle[]>(() => {
    if (!visible) {
      return [];
    }
    const spreadX = screenWidth * 0.6;
    const spreadY = screenHeight * 0.6;
    const maxDistance = Math.max(screenWidth, screenHeight) * 1.4;
    return Array.from({ length: 22 }).map((_, index) => {
      const angle = Math.random() * Math.PI * 2;
      const baseX = (Math.random() - 0.5) * spreadX;
      const baseY = (Math.random() - 0.5) * spreadY;
      const distance = maxDistance * (0.8 + Math.random() * 0.6);
      const endX = baseX + Math.cos(angle) * distance;
      const endY = baseY + Math.sin(angle) * distance;
      const duration = 600 + Math.random() * 520;
      return {
        id: `${Date.now()}-${index}`,
        emoji: EXPLOSION_EMOJIS[Math.floor(Math.random() * EXPLOSION_EMOJIS.length)],
        progress: new Animated.Value(0),
        delay: Math.random() * 320,
        startX: baseX,
        startY: baseY,
        endX,
        endY,
        startScale: 0.3 + Math.random() * 0.4,
        endScale: 0.9 + Math.random() * 1.4,
        rotateStart: (Math.random() - 0.5) * 30,
        rotateEnd: (Math.random() - 0.5) * 120,
        fontSize: 26 + Math.random() * 52,
        duration
      } satisfies BurstParticle;
    });
  }, [screenHeight, screenWidth, visible]);

  const clearAutoResume = React.useCallback(() => {
    if (autoResumeTimeoutRef.current) {
      clearTimeout(autoResumeTimeoutRef.current);
      autoResumeTimeoutRef.current = null;
    }
  }, []);

  const handleRestore = React.useCallback(() => {
    clearAutoResume();
    onRestore();
  }, [clearAutoResume, onRestore]);

  const handleDiscard = React.useCallback(() => {
    clearAutoResume();
    onDiscard();
  }, [clearAutoResume, onDiscard]);

  useEffect(() => {
    if (!visible) {
      burstOnceRef.current = true;
      hapticTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      hapticTimeoutsRef.current = [];
      cardScale.stopAnimation(() => {
        cardScale.setValue(0);
      });
      clearAutoResume();
      return;
    }
    clearAutoResume();
    autoResumeTimeoutRef.current = setTimeout(() => {
      handleRestore();
    }, 45_000);
    cardScale.setValue(0.01);
    Animated.spring(cardScale, {
      toValue: 1,
      bounciness: 12,
      speed: 12,
      useNativeDriver: true
    }).start();
    const loops = particles.map((particle) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(particle.progress, {
            toValue: 1,
            duration: particle.duration,
            delay: particle.delay,
            useNativeDriver: true
          }),
          Animated.timing(particle.progress, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true
          })
        ])
      )
    );
    loops.forEach((anim) => anim.start());
    return () => {
      loops.forEach((anim) => anim.stop());
    };
  }, [cardScale, clearAutoResume, handleRestore, particles, visible]);

  // Component unmount cleanup
  useEffect(() => {
    return () => {
      // Clear all timeouts
      hapticTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      hapticTimeoutsRef.current = [];

      if (autoResumeTimeoutRef.current) {
        clearTimeout(autoResumeTimeoutRef.current);
        autoResumeTimeoutRef.current = null;
      }

      // Stop all animations
      cardScale.stopAnimation();
      particles.forEach(particle => {
        particle.progress.stopAnimation();
      });
    };
  }, [cardScale, particles]);

  useEffect(() => {
    if (!visible || !burstOnceRef.current) {
      return;
    }
    burstOnceRef.current = false;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    hapticTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    hapticTimeoutsRef.current = [
      setTimeout(() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }, 60 + Math.random() * 80),
      setTimeout(() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }, 160 + Math.random() * 90),
      setTimeout(() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }, 260 + Math.random() * 110)
    ];
  }, [visible]);
  if (!visible) {
    return null;
  }

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}>
      <View style={styles.backdrop}>
        <View style={styles.particleLayer} pointerEvents="none">
          {particles.map((particle) => (
            <Animated.Text
              key={particle.id}
              style={[
                styles.particleEmoji,
                {
                  fontSize: particle.fontSize,
                  transform: [
                    {
                      translateX: particle.progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [particle.startX, particle.endX]
                      })
                    },
                    {
                      translateY: particle.progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [particle.startY, particle.endY]
                      })
                    },
                    {
                      rotate: particle.progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [`${particle.rotateStart}deg`, `${particle.rotateEnd}deg`]
                      })
                    },
                    {
                      scale: particle.progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [particle.startScale, particle.endScale]
                      })
                    }
                  ]
                }
              ]}
            >
              {particle.emoji}
            </Animated.Text>
          ))}
        </View>
        <Animated.View style={[styles.card, { transform: [{ scale: cardScale }] }]}>
          {/* Logo animation with icon fallback - always visible */}
          <View style={styles.logoContainer}>
            <LogoAnimationLoop size={180} frameInterval={100} isMuted={false} />
          </View>

          <Text style={styles.title}>Resume last session?</Text>
          <Text style={styles.body}>
            Looks like Emojipaint recovered an autosave{savedAt ? ` from ${new Date(savedAt).toLocaleString()}` : ''}.
            Continue where you left off or start a fresh canvas?
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.secondary]} onPress={handleDiscard}>
              <Text style={[styles.buttonLabel, styles.secondaryLabel]}>Start Fresh</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.primary]} onPress={handleRestore}>
              <Text style={[styles.buttonLabel, styles.primaryLabel]}>Resume</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5,5,5,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    padding: 24,
    backgroundColor: '#141414',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden'
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 20
  },
  particleLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  particleEmoji: {
    position: 'absolute',
    fontSize: 48,
    fontFamily: BASE_FONT_FAMILY
  },
  title: {
    fontFamily: BASE_FONT_FAMILY,
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12
  },
  body: {
    fontFamily: BASE_FONT_FAMILY,
    color: '#ccc',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14
  },
  primary: {
    backgroundColor: '#ff6b6b'
  },
  primaryLabel: {
    color: '#050505'
  },
  secondary: {
    backgroundColor: '#1f1f1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)'
  },
  secondaryLabel: {
    color: '#fff'
  },
  buttonLabel: {
    fontFamily: BASE_FONT_FAMILY,
    fontWeight: '600',
    fontSize: 15
  }
});

export default AutosaveOverlay;
