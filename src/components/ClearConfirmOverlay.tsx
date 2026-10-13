/**
 * Clear Confirm Overlay
 *
 * Custom confirmation overlay with physics-based falling animation
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Modal, Animated, Dimensions, Platform } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

type ClearConfirmOverlayProps = {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onAnimatedClear?: (progress: number) => void; // Callback for animated clearing
};

interface PhysicsBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  rotation: number;
  rotationVelocity: number;
  bounced: boolean;
}

const ClearConfirmOverlay: React.FC<ClearConfirmOverlayProps> = ({
  visible,
  onConfirm,
  onCancel,
  onAnimatedClear
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const [isAnimating, setIsAnimating] = useState(false);

  // Animation values for falling background elements
  const fallingAnims = useRef(
    Array.from({ length: 20 }, () => ({
      translateY: new Animated.Value(0),
      translateX: new Animated.Value(0),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(1)
    }))
  ).current;

  // Animation values for UI elements with physics
  const titleText = "Clear Canvas?";
  const messageText = "This will remove every stroke from the painting.";

  // Create animated values for each letter in title
  const titleLetters = useRef(
    titleText.split('').map(() => ({
      translateX: new Animated.Value(0),
      translateY: new Animated.Value(0),
      rotate: new Animated.Value(0)
    }))
  ).current;

  // Create animated values for each letter in message
  const messageLetters = useRef(
    messageText.split('').map(() => ({
      translateX: new Animated.Value(0),
      translateY: new Animated.Value(0),
      rotate: new Animated.Value(0)
    }))
  ).current;

  const uiElements = useRef([
    { translateX: new Animated.Value(0), translateY: new Animated.Value(0), rotate: new Animated.Value(0) }, // Cancel button
    { translateX: new Animated.Value(0), translateY: new Animated.Value(0), rotate: new Animated.Value(0) }  // Clear button
  ]).current;

  useEffect(() => {
    if (visible) {
      // Reset isAnimating to false when dialog opens
      setIsAnimating(false);

      fadeAnim.setValue(0);
      scaleAnim.setValue(0.8);

      // Stop any ongoing animations and reset all values
      fallingAnims.forEach(anim => {
        anim.translateY.stopAnimation(() => anim.translateY.setValue(0));
        anim.translateX.stopAnimation(() => anim.translateX.setValue(0));
        anim.rotate.stopAnimation(() => anim.rotate.setValue(0));
        anim.opacity.stopAnimation(() => anim.opacity.setValue(1));
      });

      titleLetters.forEach(letter => {
        letter.translateX.stopAnimation(() => letter.translateX.setValue(0));
        letter.translateY.stopAnimation(() => letter.translateY.setValue(0));
        letter.rotate.stopAnimation(() => letter.rotate.setValue(0));
      });

      messageLetters.forEach(letter => {
        letter.translateX.stopAnimation(() => letter.translateX.setValue(0));
        letter.translateY.stopAnimation(() => letter.translateY.setValue(0));
        letter.rotate.stopAnimation(() => letter.rotate.setValue(0));
      });

      uiElements.forEach(elem => {
        elem.translateX.stopAnimation(() => elem.translateX.setValue(0));
        elem.translateY.stopAnimation(() => elem.translateY.setValue(0));
        elem.rotate.stopAnimation(() => elem.rotate.setValue(0));
      });

      // Entrance animation
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true
        })
      ]).start();
    } else {
      // When dialog closes, make sure to reset isAnimating
      setIsAnimating(false);
    }
  }, [visible]);

  const triggerPhysicsAnimation = () => {
    setIsAnimating(true);

    // Initial haptic feedback when clear is triggered
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // 1 in 10 chance for extended animation (up to 3 seconds)
    const isExtendedAnimation = Math.random() < 0.1;
    const baseDuration = isExtendedAnimation ? 3000 : 1200;

    console.log(isExtendedAnimation ? '🎉 Extended 3-second animation!' : '⚡ Normal 1.2-second animation');

    // Animate background elements with bouncing
    const bgAnimations = fallingAnims.map((anim, index) => {
      const randomDelay = Math.random() * 100;
      const shouldBounce = Math.random() < 0.3; // 30% chance to bounce
      const bounceCount = isExtendedAnimation && shouldBounce ? Math.floor(1 + Math.random() * 3) : (shouldBounce ? 1 : 0);

      if (bounceCount > 0) {
        // Bouncing animation
        const bounces = [];
        let currentY = 0;
        const totalFallDistance = SCREEN_HEIGHT + 200;
        const bounceHeight = 150 + Math.random() * 200;
        const randomX = (Math.random() - 0.5) * (isExtendedAnimation ? 400 : 200);
        const randomRotation = (Math.random() - 0.5) * (isExtendedAnimation ? 1440 : 720);

        for (let b = 0; b < bounceCount; b++) {
          const dropDistance = (totalFallDistance / bounceCount) * (b + 1) - currentY;
          const bounceTiming = (baseDuration / bounceCount) * 0.6;

          // Drop down
          bounces.push(
            Animated.timing(anim.translateY, {
              toValue: currentY + dropDistance,
              duration: bounceTiming,
              useNativeDriver: true
            })
          );
          currentY += dropDistance;

          // Tiny haptic feedback on bounce (very light)
          setTimeout(() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }, randomDelay + (baseDuration / bounceCount) * (b + 1) * 0.6);

          // Bounce up
          const thisBounceHeight = bounceHeight / (b + 1); // Each bounce is smaller
          bounces.push(
            Animated.timing(anim.translateY, {
              toValue: currentY - thisBounceHeight,
              duration: (baseDuration / bounceCount) * 0.2,
              useNativeDriver: true
            })
          );
          currentY -= thisBounceHeight;
        }

        // Final fall
        bounces.push(
          Animated.timing(anim.translateY, {
            toValue: totalFallDistance,
            duration: (baseDuration / bounceCount) * 0.2,
            useNativeDriver: true
          })
        );

        return Animated.sequence([
          Animated.delay(randomDelay),
          Animated.parallel([
            Animated.sequence(bounces),
            Animated.timing(anim.translateX, {
              toValue: randomX,
              duration: baseDuration,
              useNativeDriver: true
            }),
            Animated.timing(anim.rotate, {
              toValue: randomRotation,
              duration: baseDuration,
              useNativeDriver: true
            }),
            Animated.timing(anim.opacity, {
              toValue: 0,
              duration: baseDuration - 200,
              delay: 200,
              useNativeDriver: true
            })
          ])
        ]);
      } else {
        // Simple falling (no bounce)
        const randomX = (Math.random() - 0.5) * (isExtendedAnimation ? 400 : 200);
        const randomRotation = (Math.random() - 0.5) * (isExtendedAnimation ? 1440 : 720);
        const fallDistance = SCREEN_HEIGHT + 200;

        return Animated.sequence([
          Animated.delay(randomDelay),
          Animated.parallel([
            Animated.timing(anim.translateY, {
              toValue: fallDistance,
              duration: baseDuration,
              useNativeDriver: true
            }),
            Animated.timing(anim.translateX, {
              toValue: randomX,
              duration: baseDuration,
              useNativeDriver: true
            }),
            Animated.timing(anim.rotate, {
              toValue: randomRotation,
              duration: baseDuration,
              useNativeDriver: true
            }),
            Animated.timing(anim.opacity, {
              toValue: 0,
              duration: baseDuration - 200,
              delay: 200,
              useNativeDriver: true
            })
          ])
        ]);
      }
    });

    Animated.parallel(bgAnimations).start();

    // Simple random falling animation for title letters
    const titleAnimations = titleLetters.map((letter, i) => {
      const randomDelay = Math.random() * 150;
      const randomX = (Math.random() - 0.5) * (isExtendedAnimation ? 500 : 300);
      const randomRotation = (Math.random() - 0.5) * (isExtendedAnimation ? 2160 : 1080);
      const fallDistance = SCREEN_HEIGHT + 100;
      const duration = isExtendedAnimation ? 2000 + Math.random() * 1000 : 800 + Math.random() * 400;

      return Animated.sequence([
        Animated.delay(randomDelay),
        Animated.parallel([
          Animated.timing(letter.translateY, {
            toValue: fallDistance,
            duration: duration,
            useNativeDriver: true
          }),
          Animated.timing(letter.translateX, {
            toValue: randomX,
            duration: duration,
            useNativeDriver: true
          }),
          Animated.timing(letter.rotate, {
            toValue: randomRotation,
            duration: duration,
            useNativeDriver: true
          })
        ])
      ]);
    });

    // Simple random falling animation for message letters
    const messageAnimations = messageLetters.map((letter, i) => {
      const randomDelay = Math.random() * 200;
      const randomX = (Math.random() - 0.5) * (isExtendedAnimation ? 450 : 250);
      const randomRotation = (Math.random() - 0.5) * (isExtendedAnimation ? 1800 : 900);
      const fallDistance = SCREEN_HEIGHT + 100;
      const duration = isExtendedAnimation ? 1800 + Math.random() * 1200 : 700 + Math.random() * 400;

      return Animated.sequence([
        Animated.delay(randomDelay),
        Animated.parallel([
          Animated.timing(letter.translateY, {
            toValue: fallDistance,
            duration: duration,
            useNativeDriver: true
          }),
          Animated.timing(letter.translateX, {
            toValue: randomX,
            duration: duration,
            useNativeDriver: true
          }),
          Animated.timing(letter.rotate, {
            toValue: randomRotation,
            duration: duration,
            useNativeDriver: true
          })
        ])
      ]);
    });

    // Falling animation for buttons with bouncing
    const buttonAnimations = uiElements.map((button, i) => {
      const randomDelay = Math.random() * 100;
      const shouldBounce = Math.random() < 0.5; // 50% chance for buttons to bounce

      if (shouldBounce && isExtendedAnimation) {
        // Bouncing button animation
        const bounceHeight = 200 + Math.random() * 150;
        const randomX = (Math.random() - 0.5) * 400;
        const randomRotation = (Math.random() - 0.5) * 1440;
        const fallDistance = SCREEN_HEIGHT + 150;

        // Haptic feedback for first bounce
        setTimeout(() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }, randomDelay + baseDuration * 0.4);

        // Haptic feedback for second bounce
        setTimeout(() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }, randomDelay + baseDuration * 0.7);

        return Animated.sequence([
          Animated.delay(randomDelay),
          Animated.parallel([
            Animated.sequence([
              // Drop
              Animated.timing(button.translateY, {
                toValue: fallDistance * 0.6,
                duration: baseDuration * 0.4,
                useNativeDriver: true
              }),
              // Bounce up
              Animated.timing(button.translateY, {
                toValue: fallDistance * 0.6 - bounceHeight,
                duration: baseDuration * 0.15,
                useNativeDriver: true
              }),
              // Drop again
              Animated.timing(button.translateY, {
                toValue: fallDistance * 0.85,
                duration: baseDuration * 0.15,
                useNativeDriver: true
              }),
              // Small bounce
              Animated.timing(button.translateY, {
                toValue: fallDistance * 0.85 - bounceHeight * 0.3,
                duration: baseDuration * 0.1,
                useNativeDriver: true
              }),
              // Final fall
              Animated.timing(button.translateY, {
                toValue: fallDistance,
                duration: baseDuration * 0.2,
                useNativeDriver: true
              })
            ]),
            Animated.timing(button.translateX, {
              toValue: randomX,
              duration: baseDuration,
              useNativeDriver: true
            }),
            Animated.timing(button.rotate, {
              toValue: randomRotation,
              duration: baseDuration,
              useNativeDriver: true
            })
          ])
        ]);
      } else {
        // Simple falling for buttons
        const randomX = (Math.random() - 0.5) * (isExtendedAnimation ? 400 : 200);
        const randomRotation = (Math.random() - 0.5) * (isExtendedAnimation ? 1440 : 720);
        const fallDistance = SCREEN_HEIGHT + 150;
        const duration = isExtendedAnimation ? baseDuration : 1000;

        return Animated.sequence([
          Animated.delay(randomDelay),
          Animated.parallel([
            Animated.timing(button.translateY, {
              toValue: fallDistance,
              duration: duration,
              useNativeDriver: true
            }),
            Animated.timing(button.translateX, {
              toValue: randomX,
              duration: duration,
              useNativeDriver: true
            }),
            Animated.timing(button.rotate, {
              toValue: randomRotation,
              duration: duration,
              useNativeDriver: true
            })
          ])
        ]);
      }
    });

    // Start all animations in parallel
    Animated.parallel([
      ...titleAnimations,
      ...messageAnimations,
      ...buttonAnimations
    ]).start();

    return { isExtended: isExtendedAnimation };
  };

  const handleConfirm = () => {
    const animationResult = triggerPhysicsAnimation();

    // Animate clearing strokes from newest to oldest - SUPER FAST
    if (onAnimatedClear) {
      const clearDuration = 80; // 0.08 seconds to clear all strokes - SUPER FAST (5x faster)
      const frameRate = 60;
      const totalFrames = (clearDuration / 1000) * frameRate;
      let currentFrame = 0;

      const animateClear = () => {
        currentFrame++;
        const progress = currentFrame / totalFrames; // 0 to 1

        onAnimatedClear(progress);

        if (currentFrame < totalFrames) {
          requestAnimationFrame(animateClear);
        } else {
          // Strokes cleared, immediately allow user to paint again
          // Don't wait for falling animation - it looks great but user doesn't need to wait
          // Just let the animation play in background while modal closes
          requestAnimationFrame(() => {
            onConfirm(); // This closes the modal and actually clears
          });
        }
      };

      requestAnimationFrame(animateClear);
    } else {
      // Fallback if no animated clear callback - still fast
      requestAnimationFrame(() => {
        onConfirm();
      });
    }
  };

  if (!visible) return null;

  // Generate random positioned elements for falling animation
  const fallingElements = fallingAnims.map((anim, index) => {
    const isLetter = index < 12;
    const letter = String.fromCharCode(65 + (index % 26));
    const size = 40 + Math.random() * 40;
    const left = Math.random() * 100;
    const top = 20 + Math.random() * 60;

    const rotation = anim.rotate.interpolate({
      inputRange: [0, 360],
      outputRange: ['0deg', '360deg']
    });

    return (
      <Animated.View
        key={index}
        style={[
          styles.fallingElement,
          {
            left: `${left}%`,
            top: `${top}%`,
            transform: [
              { translateY: anim.translateY },
              { translateX: anim.translateX },
              { rotate: rotation }
            ],
            opacity: anim.opacity
          }
        ]}
      >
        {isLetter ? (
          <Text style={[styles.fallingLetter, { fontSize: size }]}>
            {letter}
          </Text>
        ) : (
          <View style={[styles.fallingShape, { width: size, height: size }]} />
        )}
      </Animated.View>
    );
  });

  const rotationInterpolate = (rotValue: Animated.Value) => rotValue.interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg']
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onCancel}
      supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
    >
      <View style={{ flex: 1 }}>
        {/* Background overlay - becomes transparent when animating */}
        <Animated.View style={[styles.overlay, { backgroundColor: isAnimating ? 'transparent' : 'rgba(0, 0, 0, 0.85)' }]}>
          {/* Falling background elements */}
          {fallingElements}

          {/* Confirmation dialog background (fades when animating) */}
          <Animated.View
            style={[
              styles.dialog,
              {
                transform: [{ scale: isAnimating ? 1 : scaleAnim }],
                opacity: isAnimating ? 0 : 1 // Hide dialog container when animating
              }
            ]}
          >
            {/* Static placeholder content - will be replaced by animated versions */}
            {!isAnimating && (
              <>
                <Text style={styles.title}>{titleText}</Text>
                <Text style={styles.message}>{messageText}</Text>
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={onCancel}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.confirmButton}
                    onPress={handleConfirm}
                  >
                    <Text style={styles.confirmButtonText}>Clear</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Animated.View>
        </Animated.View>

        {/* Animated UI elements - OUTSIDE the transparent overlay so they stay visible */}
        {isAnimating && (
          <>
            {/* Animated Title Letters */}
            {titleText.split('').map((char, i) => {
              const letterStartX = SCREEN_WIDTH * 0.075 + SCREEN_WIDTH * 0.85 / 2 - (titleText.length * 10) + (i * 20);
              return (
                <Animated.View
                  key={`title-${i}`}
                  style={[
                    styles.floatingLetter,
                    {
                      left: letterStartX,
                      top: (SCREEN_HEIGHT - 240) / 2 + 40,
                      transform: [
                        { translateX: titleLetters[i].translateX },
                        { translateY: titleLetters[i].translateY },
                        { rotate: rotationInterpolate(titleLetters[i].rotate) }
                      ]
                    }
                  ]}
                >
                  <Text style={styles.titleLetter}>{char}</Text>
                </Animated.View>
              );
            })}

            {/* Animated Message Letters */}
            {messageText.split('').map((char, i) => {
              const charsPerLine = 30;
              const lineIndex = Math.floor(i / charsPerLine);
              const charInLine = i % charsPerLine;
              const letterStartX = SCREEN_WIDTH * 0.075 + SCREEN_WIDTH * 0.85 / 2 - (charsPerLine * 5) + (charInLine * 10);
              const letterStartY = (SCREEN_HEIGHT - 240) / 2 + 90 + (lineIndex * 20);
              return (
                <Animated.View
                  key={`msg-${i}`}
                  style={[
                    styles.floatingLetter,
                    {
                      left: letterStartX,
                      top: letterStartY,
                      transform: [
                        { translateX: messageLetters[i].translateX },
                        { translateY: messageLetters[i].translateY },
                        { rotate: rotationInterpolate(messageLetters[i].rotate) }
                      ]
                    }
                  ]}
                >
                  <Text style={styles.messageLetter}>{char}</Text>
                </Animated.View>
              );
            })}

            {/* Animated Cancel Button */}
            <Animated.View
              style={[
                styles.floatingElement,
                {
                  left: SCREEN_WIDTH * 0.075 + SCREEN_WIDTH * 0.85 * 0.3 - 70,
                  top: (SCREEN_HEIGHT - 240) / 2 + 180 - 26,
                  width: 140,
                  transform: [
                    { translateX: uiElements[0].translateX },
                    { translateY: uiElements[0].translateY },
                    { rotate: rotationInterpolate(uiElements[0].rotate) }
                  ]
                }
              ]}
            >
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onCancel}
                disabled={true}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Animated Clear Button */}
            <Animated.View
              style={[
                styles.floatingElement,
                {
                  left: SCREEN_WIDTH * 0.075 + SCREEN_WIDTH * 0.85 * 0.75 - 70,
                  top: (SCREEN_HEIGHT - 240) / 2 + 180 - 26,
                  width: 140,
                  transform: [
                    { translateX: uiElements[1].translateX },
                    { translateY: uiElements[1].translateY },
                    { rotate: rotationInterpolate(uiElements[1].rotate) }
                  ]
                }
              ]}
            >
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={handleConfirm}
                disabled={true}
              >
                <Text style={styles.confirmButtonText}>Clear</Text>
              </TouchableOpacity>
            </Animated.View>
          </>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  dialog: {
    width: '85%',
    maxWidth: 400,
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 32,
    borderWidth: 2,
    borderColor: '#ff6b6b',
    zIndex: 1000 // Above background shapes (zIndex: 100)
  },
  floatingElement: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999
  },
  floatingLetter: {
    position: 'absolute',
    zIndex: 9999
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ff6b6b',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'vrtlfinal'
  },
  titleLetter: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ff6b6b',
    fontFamily: 'vrtlfinal',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4
  },
  message: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    fontFamily: 'vrtlfinal'
  },
  messageLetter: {
    fontSize: 16,
    color: '#aaa',
    fontFamily: 'vrtlfinal',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12
  },
  cancelButton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
    zIndex: 1001 // Ensure buttons are clickable above everything
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff'
  },
  confirmButton: {
    backgroundColor: '#ff6b6b',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    zIndex: 1001 // Ensure buttons are clickable above everything
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000'
  },
  fallingElement: {
    position: 'absolute',
    zIndex: 100 // Above dialog but below animated letters
  },
  fallingLetter: {
    fontWeight: '900',
    color: 'rgba(255, 107, 107, 0.6)',
    textShadowColor: 'rgba(255, 107, 107, 0.3)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10
  },
  fallingShape: {
    backgroundColor: 'rgba(255, 159, 107, 0.5)',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 107, 107, 0.3)'
  }
});

export default ClearConfirmOverlay;
