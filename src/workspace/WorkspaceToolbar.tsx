import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, type Insets, StyleSheet } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppSettings } from '../context/AppSettingsContext';
import HelperLabel, { HelperRing } from '../tutorial/HelperLabel';
import ButtonGlow from '../tutorial/ButtonGlow';
import { getElementLabel } from '../tutorial/translations';
import { useHelperMode } from '../tutorial/useHelperMode';

import ToolbarButton from './ToolbarButton';
import BrushEmojiIcon from '../components/BrushEmojiIcon';

interface WorkspaceToolbarProps {
  styles: any;
  hitSlop: Insets | { top: number; bottom: number; left: number; right: number };
  topInset: number;
  isBrushActive: boolean;
  isLineActive: boolean;
  isEraserActive: boolean;
  isEmojiPlaneActive?: boolean;
  onBrush: () => void;
  onLine: () => void;
  /** Main workspace only. Omit and no Layers button renders at all. */
  onLayers?: () => void;
  layersActive?: boolean;
  onEraser: () => void;
  onEmojiPlane?: () => void;
  onRandom: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  /** Face filter mode: shows a 🎭 button next to the trash that opens the live camera */
  onFaceFilter?: () => void;
  undoDisabled: boolean;
  redoDisabled: boolean;
  clearDisabled: boolean;
  randomScale?: SharedValue<number>;
  brushOptionsVisible?: boolean;
  onFlipX?: () => void;
  onFlipY?: () => void;
  onRotateLeft?: () => void;
  onRotateRight?: () => void;
  onRotateLeftLongPress?: () => void;
  onRotateRightLongPress?: () => void;
  onRecentEmojiPress?: (emoji: string) => void;
  recentEmojis?: string[];
  mirrorX?: boolean;
  mirrorY?: boolean;
  autoRotateEnabled?: boolean;
  autoRotateDirection?: 'left' | 'right' | null;
  brushEmoji?: string;
  handMode?: 'left' | 'right';
  isLandscape?: boolean;
  suppressRandomHelper?: boolean;
  tutorialActive?: boolean;
  tutorialCurrentLesson?: number;
  tutorialBlinkScale?: any;
  tutorialBlinkOpacity?: any;
}

const WorkspaceToolbar: React.FC<WorkspaceToolbarProps> = ({
  styles,
  hitSlop,
  topInset,
  isBrushActive,
  isLineActive,
  isEraserActive,
  isEmojiPlaneActive = false,
  onBrush,
  onLine,
  onLayers,
  layersActive,
  onEraser,
  onEmojiPlane,
  onRandom,
  onUndo,
  onRedo,
  onClear,
  onFaceFilter,
  undoDisabled,
  redoDisabled,
  clearDisabled,
  randomScale,
  brushOptionsVisible,
  onFlipX,
  onFlipY,
  onRotateLeft,
  onRotateRight,
  onRotateLeftLongPress,
  onRotateRightLongPress,
  onRecentEmojiPress,
  recentEmojis,
  mirrorX,
  mirrorY,
  autoRotateEnabled = false,
  autoRotateDirection = null,
  brushEmoji,
  handMode = 'right',
  isLandscape = false,
  suppressRandomHelper = false,
  tutorialActive = false,
  tutorialCurrentLesson = 0,
  tutorialBlinkScale,
  tutorialBlinkOpacity
}) => {
  // Pulse for the 🎭 face-filter button (only animates when present)
  const faceFilterScale = useSharedValue(1);
  useEffect(() => {
    if (!onFaceFilter) return;
    faceFilterScale.value = withRepeat(withTiming(1.18, { duration: 650 }), -1, true);
    return () => {
      faceFilterScale.value = 1;
    };
  }, [onFaceFilter, faceFilterScale]);
  const faceFilterAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: faceFilterScale.value }],
  }));

  const { colors } = useAppSettings();

  const TOOLBAR_KEYS = ['random', 'brush', 'emojiplane', 'line', 'layers', 'eraser', 'undo', 'redo', 'clear'];
  const { activeHelperKey, glowCounters, triggerHelper, tutorialModeEnabled, helperModeEnabled, lang: helperLang } = useHelperMode({
    keys: TOOLBAR_KEYS,
  });

  // Once user presses random emoji, permanently disable the idle helper
  const [randomEmojiEverPressed, setRandomEmojiEverPressed] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('@random_emoji_ever_pressed').then(val => {
      if (val === '1') setRandomEmojiEverPressed(true);
    }).catch(() => {});
  }, []);

  // Dice button: show helper after 10s of no action, keep until any action
  const [diceIdleActive, setDiceIdleActive] = useState(false);
  const diceIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const helperModeRef = useRef(helperModeEnabled);
  helperModeRef.current = helperModeEnabled;

  const resetDiceIdle = useCallback(() => {
    setDiceIdleActive(false);
    if (diceIdleTimerRef.current) clearTimeout(diceIdleTimerRef.current);
    if (helperModeRef.current) {
      diceIdleTimerRef.current = setTimeout(() => setDiceIdleActive(true), 10000);
    }
  }, []);

  const handleTrigger = useCallback((key: string) => {
    triggerHelper(key);
    resetDiceIdle(); // any action hides dice idle and resets 10s timer
  }, [triggerHelper, resetDiceIdle]);

  useEffect(() => {
    if (!helperModeEnabled) {
      setDiceIdleActive(false);
      if (diceIdleTimerRef.current) clearTimeout(diceIdleTimerRef.current);
      return;
    }
    resetDiceIdle();
    return () => { if (diceIdleTimerRef.current) clearTimeout(diceIdleTimerRef.current); };
  }, [helperModeEnabled, resetDiceIdle]);

  const randomAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: randomScale?.value ?? 1 }]
  }), [randomScale]);

  // Tutorial button highlighting logic
  const shouldHighlightButton = (buttonKey: string): boolean => {
    if (!tutorialActive) return false;

    // Lesson 1: Draw something - highlight random, line, or undo
    if (tutorialCurrentLesson === 1) {
      return buttonKey === 'random' || buttonKey === 'line' || buttonKey === 'undo';
    }

    return false;
  };

  const shouldGreyOutButton = (buttonKey: string): boolean => {
    if (!tutorialActive) return false;

    // Lesson 1: Grey out buttons that aren't highlighted
    if (tutorialCurrentLesson === 1) {
      return !shouldHighlightButton(buttonKey);
    }

    return false;
  };

  // Brush options animation
  const overlayTranslateY = useSharedValue(-100);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    if (brushOptionsVisible) {
      overlayTranslateY.value = withSpring(0, {
        damping: 12,
        stiffness: 200,
        mass: 0.8
      });
      overlayOpacity.value = withSpring(1, {
        damping: 12,
        stiffness: 200
      });
    } else {
      overlayTranslateY.value = withSpring(-100, {
        damping: 15,
        stiffness: 250
      });
      overlayOpacity.value = withSpring(0, {
        damping: 15,
        stiffness: 250
      });
    }
  }, [brushOptionsVisible, overlayTranslateY, overlayOpacity]);

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: overlayTranslateY.value }],
    opacity: overlayOpacity.value
  }));
  const randomHelperVisible = !suppressRandomHelper && !randomEmojiEverPressed && (diceIdleActive || activeHelperKey === 'random');

  // Get last 4 recent emojis (excluding current brush emoji)
  const lastFourEmojis = (Array.isArray(recentEmojis) && recentEmojis.length > 0)
    ? recentEmojis.filter((emoji) => emoji !== brushEmoji).slice(0, 4)
    : [];

  // Dynamic styles based on theme
  const localStyles = StyleSheet.create({
    optionsOverlay: {
      position: 'absolute',
      top: '100%',
      left: 0,
      marginTop: 8,
      zIndex: 1000
    },
    optionsContainer: {
      backgroundColor: `${colors.surface}F2`,
      borderRadius: 12,
      padding: 6,
      shadowColor: colors.background,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8
    },
    optionsRow: {
      flexDirection: 'row',
      gap: 6,
      marginVertical: 3
    },
    optionButton: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: `${colors.text}19`,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: `${colors.text}26`
    },
    optionButtonActive: {
      backgroundColor: '#ff6b6b',
      borderColor: '#ff6b6b'
    },
    optionButtonAutoRotate: {
      backgroundColor: '#4ade80',
      borderColor: '#22c55e'
    },
    optionEmoji: {
      fontSize: 20,
      lineHeight: 24
    }
  });

  // Define toolbar buttons in order: dice, brush, placer, line, eraser, undo, redo, clear
  const toolbarButtons = [
    // Random (Dice)
    <View key="random" style={{ position: 'relative' }}>
    <Animated.View style={[
      randomAnimatedStyle,
      shouldHighlightButton('random') && {
        transform: [{ scale: tutorialBlinkScale }],
        opacity: tutorialBlinkOpacity,
        borderWidth: 2,
        borderColor: '#fff',
        borderRadius: 8,
        shadowColor: '#fff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 8
      },
      shouldGreyOutButton('random') && { opacity: 0.3 }
    ]}>
      <ToolbarButton
        onPress={() => {
          try { require('expo-haptics').default; } catch {}
          try {
            // Random haptic feedback patterns
            const Haptics = require('expo-haptics');
            const patterns = [
              // Pattern 1: Quick triple tap
              () => {
                [0, 80, 160].forEach(delay => {
                  setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }, delay);
                });
              },
              // Pattern 2: Ramp up
              () => {
                const styles = [
                  Haptics.ImpactFeedbackStyle.Light,
                  Haptics.ImpactFeedbackStyle.Medium,
                  Haptics.ImpactFeedbackStyle.Heavy,
                ];
                styles.forEach((style, i) => {
                  setTimeout(() => { void Haptics.impactAsync(style).catch(() => {}); }, i * 100);
                });
              },
              // Pattern 3: Heavy pulse
              () => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
                setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); }, 150);
              },
              // Pattern 4: Soft rolls
              () => {
                [0, 60, 120, 180, 240].forEach(delay => {
                  setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {}); }, delay);
                });
              },
              // Pattern 5: Double heavy
              () => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
                setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }, 100);
              },
              // Pattern 6: Light cascade
              () => {
                [0, 50, 100, 150].forEach(delay => {
                  setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }, delay);
                });
              },
            ];
            // Pick random pattern
            const randomPattern = patterns[Math.floor(Math.random() * patterns.length)];
            randomPattern();
          } catch {}
          handleTrigger('random');
          if (!randomEmojiEverPressed) {
            setRandomEmojiEverPressed(true);
            AsyncStorage.setItem('@random_emoji_ever_pressed', '1').catch(() => {});
          }
          if (typeof onRandom === 'function') {
            onRandom();
          }
        }}
        accessibilityLabel="Random emoji"
        style={styles.toolButton}
        activeStyle={styles.toolButtonActive}
        disabledStyle={styles.disabledButton}
        hitSlop={hitSlop}
      >
        <Text style={[styles.toolEmoji, { fontSize: (styles.toolEmoji?.fontSize ?? 22) * 1.56 }]}>🎲</Text>
      </ToolbarButton>
      <ButtonGlow counter={glowCounters.random ?? 0} enabled={tutorialModeEnabled} />
    </Animated.View>
    <HelperRing visible={randomHelperVisible && helperModeEnabled} />
    <HelperLabel text={getElementLabel(helperLang, 'random_emoji')} visible={randomHelperVisible} position="below" />
    </View>,
    // Brush
    <View key="brush" style={{ position: 'relative' }}>
      <Animated.View style={[
        shouldGreyOutButton('brush') && { opacity: 0.3 }
      ]}>
        <ToolbarButton
          active={isBrushActive}
          onPress={() => { handleTrigger('brush'); onBrush(); }}
          accessibilityLabel="Brush tool"
          style={styles.toolButton}
          activeStyle={styles.toolButtonActive}
          disabledStyle={styles.disabledButton}
          hitSlop={hitSlop}
        >
          <Text style={styles.toolEmoji}>🖌️</Text>
        </ToolbarButton>
      </Animated.View>
      <ButtonGlow counter={glowCounters.brush ?? 0} enabled={tutorialModeEnabled} />
      <HelperRing visible={activeHelperKey === 'brush' && helperModeEnabled} />
      <HelperLabel text={getElementLabel(helperLang, 'brush_tool')} visible={activeHelperKey === 'brush'} position="below" />
      {brushOptionsVisible && (
        <Animated.View style={[localStyles.optionsOverlay, overlayAnimatedStyle]} pointerEvents="box-none">
          <View style={localStyles.optionsContainer}>
            {/* Transform buttons */}
            <View style={localStyles.optionsRow}>
              <TouchableOpacity
                style={[localStyles.optionButton, mirrorX && localStyles.optionButtonActive]}
                onPress={onFlipX}
                accessibilityLabel="Flip horizontal"
              >
                <Text style={localStyles.optionEmoji}>↔️</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[localStyles.optionButton, mirrorY && localStyles.optionButtonActive]}
                onPress={onFlipY}
                accessibilityLabel="Flip vertical"
              >
                <Text style={localStyles.optionEmoji}>↕️</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  localStyles.optionButton,
                  autoRotateEnabled && autoRotateDirection === 'left' && localStyles.optionButtonAutoRotate
                ]}
                onPress={onRotateLeft}
                onLongPress={onRotateLeftLongPress}
                delayLongPress={600}
                accessibilityLabel={autoRotateEnabled && autoRotateDirection === 'left' ? "Auto-rotate left active (tap to stop)" : "Rotate left (long press for auto-rotate)"}
              >
                <Text style={localStyles.optionEmoji}>↩️</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  localStyles.optionButton,
                  autoRotateEnabled && autoRotateDirection === 'right' && localStyles.optionButtonAutoRotate
                ]}
                onPress={onRotateRight}
                onLongPress={onRotateRightLongPress}
                delayLongPress={600}
                accessibilityLabel={autoRotateEnabled && autoRotateDirection === 'right' ? "Auto-rotate right active (tap to stop)" : "Rotate right (long press for auto-rotate)"}
              >
                <Text style={localStyles.optionEmoji}>↪️</Text>
              </TouchableOpacity>
            </View>
            {/* Recent emojis */}
            {lastFourEmojis.length > 0 && (
              <View style={localStyles.optionsRow}>
                {lastFourEmojis.map((emoji, index) => {
                  const size = typeof localStyles.optionEmoji?.fontSize === 'number'
                    ? localStyles.optionEmoji.fontSize
                    : 18;
                  return (
                    <TouchableOpacity
                      key={`${emoji}-${index}`}
                      style={localStyles.optionButton}
                      onPress={() => onRecentEmojiPress?.(emoji)}
                      accessibilityLabel={`Recent emoji: ${emoji}`}
                    >
                      <BrushEmojiIcon
                        emoji={emoji}
                        size={size}
                        textStyle={localStyles.optionEmoji}
                        imageStyle={{ backgroundColor: 'rgba(0,0,0,0.08)' }}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </Animated.View>
      )}
    </View>,
    // Emoji Plane Tool (Placer)
    <View key="emojiplane" style={{ position: 'relative' }}>
      <Animated.View style={[
        shouldGreyOutButton('emojiplane') && { opacity: 0.3 }
      ]}>
        <ToolbarButton
          active={isEmojiPlaneActive}
          onPress={() => { handleTrigger('emojiplane'); (onEmojiPlane || (() => {}))(); }}
          accessibilityLabel="Emoji plane tool"
          style={styles.toolButton}
          activeStyle={styles.toolButtonActive}
          disabledStyle={styles.disabledButton}
          hitSlop={hitSlop}
        >
          <Text style={styles.toolEmoji}>📐</Text>
        </ToolbarButton>
      </Animated.View>
      <ButtonGlow counter={glowCounters.emojiplane ?? 0} enabled={tutorialModeEnabled} />
      <HelperRing visible={activeHelperKey === 'emojiplane' && helperModeEnabled} />
      <HelperLabel text={getElementLabel(helperLang, 'emoji_plane_tool')} visible={activeHelperKey === 'emojiplane'} position="below" />
    </View>,
    // Line
    <View key="line" style={{ position: 'relative' }}>
      <Animated.View style={[
        shouldHighlightButton('line') && {
          transform: [{ scale: tutorialBlinkScale }],
          opacity: tutorialBlinkOpacity,
          borderWidth: 2,
          borderColor: '#fff',
          borderRadius: 8,
          shadowColor: '#fff',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 8
        },
        shouldGreyOutButton('line') && { opacity: 0.3 }
      ]}>
        <ToolbarButton
          active={isLineActive}
          onPress={() => { handleTrigger('line'); onLine(); }}
          accessibilityLabel="Line tool"
          style={styles.toolButton}
          activeStyle={styles.toolButtonActive}
          disabledStyle={styles.disabledButton}
          hitSlop={hitSlop}
        >
          <Text style={styles.toolEmoji}>📏</Text>
        </ToolbarButton>
      </Animated.View>
      <ButtonGlow counter={glowCounters.line ?? 0} enabled={tutorialModeEnabled} />
      <HelperRing visible={activeHelperKey === 'line' && helperModeEnabled} />
      <HelperLabel text={getElementLabel(helperLang, 'line_tool')} visible={activeHelperKey === 'line'} position="below" />
    </View>,
    // Layers — sits next to the line tool, main workspace only. `onLayers` is optional so
    // every other consumer of this toolbar (profile studio etc.) simply renders no button.
    ...(onLayers ? [
    <View key="layers" style={{ position: 'relative' }}>
      <Animated.View style={[
        shouldGreyOutButton('layers') && { opacity: 0.3 }
      ]}>
        <ToolbarButton
          active={Boolean(layersActive)}
          onPress={() => { handleTrigger('layers'); onLayers(); }}
          accessibilityLabel="Layers"
          style={styles.toolButton}
          activeStyle={styles.toolButtonActive}
          disabledStyle={styles.disabledButton}
          hitSlop={hitSlop}
        >
          <Text style={styles.toolEmoji}>🗄️</Text>
        </ToolbarButton>
      </Animated.View>
      <ButtonGlow counter={glowCounters.layers ?? 0} enabled={tutorialModeEnabled} />
      <HelperRing visible={activeHelperKey === 'layers' && helperModeEnabled} />
    </View>] : []),
    // Eraser
    <View key="eraser" style={{ position: 'relative' }}>
      <Animated.View style={[
        shouldGreyOutButton('eraser') && { opacity: 0.3 }
      ]}>
        <ToolbarButton
          active={isEraserActive}
          onPress={() => { handleTrigger('eraser'); onEraser(); }}
          accessibilityLabel="Eraser tool"
          style={styles.toolButton}
          activeStyle={styles.toolButtonActive}
          disabledStyle={styles.disabledButton}
          hitSlop={hitSlop}
        >
          <Text style={styles.toolEmoji}>🧹</Text>
        </ToolbarButton>
      </Animated.View>
      <ButtonGlow counter={glowCounters.eraser ?? 0} enabled={tutorialModeEnabled} />
      <HelperRing visible={activeHelperKey === 'eraser' && helperModeEnabled} />
      <HelperLabel text={getElementLabel(helperLang, 'eraser_tool')} visible={activeHelperKey === 'eraser'} position="below" />
    </View>,
    // Undo
    <View key="undo" style={{ position: 'relative' }}>
      <Animated.View style={[
        shouldHighlightButton('undo') && {
          transform: [{ scale: tutorialBlinkScale }],
          opacity: tutorialBlinkOpacity,
          borderWidth: 2,
          borderColor: '#fff',
          borderRadius: 8,
          shadowColor: '#fff',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 8
        },
        shouldGreyOutButton('undo') && { opacity: 0.3 }
      ]}>
        <ToolbarButton
          onPress={() => { handleTrigger('undo'); onUndo(); }}
          disabled={undoDisabled}
          accessibilityLabel="Undo stroke"
          style={styles.toolButton}
          activeStyle={styles.toolButtonActive}
          disabledStyle={styles.disabledButton}
          hitSlop={hitSlop}
        >
          <Text style={styles.toolEmoji}>↩️</Text>
        </ToolbarButton>
      </Animated.View>
      <ButtonGlow counter={glowCounters.undo ?? 0} enabled={tutorialModeEnabled} />
      <HelperRing visible={activeHelperKey === 'undo' && helperModeEnabled} />
      <HelperLabel text={getElementLabel(helperLang, 'undo_button')} visible={activeHelperKey === 'undo'} position="below" />
    </View>,
    // Redo
    <View key="redo" style={{ position: 'relative' }}>
      <Animated.View style={[
        shouldGreyOutButton('redo') && { opacity: 0.3 }
      ]}>
        <ToolbarButton
          onPress={() => { handleTrigger('redo'); onRedo(); }}
          disabled={redoDisabled}
          accessibilityLabel="Redo stroke"
          style={styles.toolButton}
          activeStyle={styles.toolButtonActive}
          disabledStyle={styles.disabledButton}
          hitSlop={hitSlop}
        >
          <Text style={styles.toolEmoji}>↪️</Text>
        </ToolbarButton>
      </Animated.View>
      <ButtonGlow counter={glowCounters.redo ?? 0} enabled={tutorialModeEnabled} />
      <HelperRing visible={activeHelperKey === 'redo' && helperModeEnabled} />
      <HelperLabel text={getElementLabel(helperLang, 'redo_button')} visible={activeHelperKey === 'redo'} position="below" />
    </View>,
    // Clear
    <View key="clear" style={{ position: 'relative' }}>
      <Animated.View style={[
        shouldGreyOutButton('clear') && { opacity: 0.3 }
      ]}>
        <ToolbarButton
          onPress={() => { handleTrigger('clear'); onClear(); }}
          disabled={clearDisabled}
          accessibilityLabel="Clear canvas"
          style={styles.toolButton}
          activeStyle={styles.toolButtonActive}
          disabledStyle={styles.disabledButton}
          hitSlop={hitSlop}
        >
          <Text style={styles.toolEmoji}>🗑️</Text>
        </ToolbarButton>
      </Animated.View>
      <ButtonGlow counter={glowCounters.clear ?? 0} enabled={tutorialModeEnabled} />
      <HelperRing visible={activeHelperKey === 'clear' && helperModeEnabled} />
      <HelperLabel text={getElementLabel(helperLang, 'clear_button')} visible={activeHelperKey === 'clear'} position="below" />
    </View>,
    // Face filter live camera (only in 🎭 mode) — bigger + pulsing so it pops
    ...(onFaceFilter ? [
      <View key="faceFilter" style={{ position: 'relative' }}>
        <ToolbarButton
          onPress={onFaceFilter}
          accessibilityLabel="Open live face filter camera"
          style={styles.toolButton}
          activeStyle={styles.toolButtonActive}
          disabledStyle={styles.disabledButton}
          hitSlop={hitSlop}
        >
          <Animated.Text
            style={[
              styles.toolEmoji,
              { fontSize: Math.round((StyleSheet.flatten(styles.toolEmoji)?.fontSize ?? 22) * 1.4) },
              faceFilterAnimatedStyle,
            ]}
          >
            🎭
          </Animated.Text>
        </ToolbarButton>
      </View>,
    ] : []),
  ];

  // Reverse button order for left hand mode
  const orderedButtons = handMode === 'left' ? [...toolbarButtons].reverse() : toolbarButtons;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.toolbarOverlay,
        isLandscape ? { paddingTop: 0 } : { paddingTop: Math.max(topInset - 18, 0) }
      ]}
    >
      <View
        style={[
          styles.toolbar,
          isLandscape && {
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12
          }
        ]}
      >
        {orderedButtons}
      </View>
    </View>
  );
};

export default WorkspaceToolbar;
