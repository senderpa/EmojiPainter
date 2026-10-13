import React from 'react';
import { View, TextInput, TouchableOpacity, type Insets, Dimensions, Animated } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Slider from '@react-native-community/slider';
import BrushEmojiIcon from '../components/BrushEmojiIcon';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface BrushControlsProps {
  styles: any;
  hitSlop: Insets | { top: number; bottom: number; left: number; right: number };
  brushSize: number;
  sizeInput: string;
  sizeSliderMaximum?: number;
  onSizeSliderChange: (value: number) => void;
  onSizeSliderComplete?: (value: number) => void;
  onSizeInputChange: (value: string) => void;
  onSizeInputSubmit: () => void;
  onSizeInputFocus: () => void;
  onSizeInputBlur: () => void;
  onToggleOpacity: () => void;
  isOpacityTransparent: boolean;
  opacityToggleEmoji: string;
  smudgeActive?: boolean;
  smudgeSmoothness?: number;
  onSmudgeSmoothnessChange?: (value: number) => void;
  spacingSlider?: {
    value: number;
    onChange: (value: number) => void;
    onComplete?: (value: number) => void;
  };
  handMode?: 'left' | 'right';
  isIpad?: boolean;
  isLandscape?: boolean;
  brushEmoji?: string;
  onEmojiPickerOpen?: () => void;
  tutorialActive?: boolean;
  tutorialCurrentLesson?: number;
  tutorialBlinkScale?: any;
  tutorialBlinkOpacity?: any;
}

const BrushControls: React.FC<BrushControlsProps> = ({
  styles,
  hitSlop,
  brushSize,
  sizeInput,
  sizeSliderMaximum = 150,
  onSizeSliderChange,
  onSizeSliderComplete,
  onSizeInputChange,
  onSizeInputSubmit,
  onSizeInputFocus,
  onSizeInputBlur,
  onToggleOpacity,
  isOpacityTransparent,
  opacityToggleEmoji,
  smudgeActive = false,
  smudgeSmoothness = 0.5,
  onSmudgeSmoothnessChange,
  spacingSlider,
  handMode = 'right',
  isIpad = false,
  isLandscape = false,
  brushEmoji = '🖌️',
  onEmojiPickerOpen,
  tutorialActive = false,
  tutorialCurrentLesson = 0,
  tutorialBlinkScale,
  tutorialBlinkOpacity
}) => {
  const spacingLabel = spacingSlider
    ? spacingSlider.value >= 10
      ? spacingSlider.value.toFixed(1)
      : spacingSlider.value >= 1
        ? spacingSlider.value.toFixed(2)
        : spacingSlider.value.toFixed(3)
    : null;

  // On iPad and left hand mode, swap the slider order
  const shouldSwapSliders = isIpad && handMode === 'left' && spacingSlider;

  // Non-linear mapping: slider 0-100 where 0-50 -> size 1-50, 50-100 -> size 50-max.
  const sliderToSize = (pos: number): number => {
    const max = Math.max(1, sizeSliderMaximum);
    if (max <= 50) return Math.round(1 + (pos / 100) * (max - 1));
    if (pos <= 50) return Math.round(1 + (pos / 50) * 49);
    return Math.round(50 + ((pos - 50) / 50) * (max - 50));
  };
  const sizeToSlider = (size: number): number => {
    const max = Math.max(1, sizeSliderMaximum);
    const clamped = Math.max(1, Math.min(max, size));
    if (max <= 50) return ((clamped - 1) / Math.max(1, max - 1)) * 100;
    if (clamped <= 50) return ((clamped - 1) / 49) * 50;
    return 50 + ((clamped - 50) / Math.max(1, max - 50)) * 50;
  };

  const handleSizeSliderChange = (sliderValue: number) => {
    onSizeSliderChange(sliderToSize(sliderValue));
  };

  const handleSizeSliderComplete = (sliderValue: number) => {
    if (onSizeSliderComplete) {
      onSizeSliderComplete(sliderToSize(sliderValue));
    }
  };

  const brushEmojiSize = isIpad && isLandscape
    ? 36
    : (typeof styles?.sliderEmoji?.fontSize === 'number' ? styles.sliderEmoji.fontSize : 28);

  const sizeSliderColumn = (
    <View key="size" style={[
      styles.brushControlColumn,
      isIpad && { flex: 4 },
      isIpad && isLandscape && { marginLeft: -40 } // Move more to the left in landscape
    ]}>
      {isIpad ? (
        <Animated.View style={[
          tutorialActive && tutorialCurrentLesson === 0 && {
            transform: [{ scale: tutorialBlinkScale }],
            opacity: tutorialBlinkOpacity
          }
        ]}>
          <TouchableOpacity
            onPress={onEmojiPickerOpen}
            accessibilityRole="button"
            accessibilityLabel="Select emoji"
            hitSlop={hitSlop}
            disabled={!onEmojiPickerOpen}
            style={[
              tutorialActive && tutorialCurrentLesson === 0 && {
                borderWidth: 2,
                borderColor: '#fff',
                borderRadius: 8,
                padding: 4,
                shadowColor: '#fff',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.8,
                shadowRadius: 8
              }
            ]}
          >
            <BrushEmojiIcon
              emoji={brushEmoji}
              size={brushEmojiSize}
              textStyle={[
                styles.sliderEmoji,
                isIpad && isLandscape && { fontSize: 36, transform: [{ scale: 1.2075 }] } // 30% smaller than 1.725
              ]}
              imageStyle={isIpad && isLandscape ? { transform: [{ scale: 1.2075 }] } : undefined}
            />
          </TouchableOpacity>
        </Animated.View>
      ) : (
        <BrushEmojiIcon
          emoji={brushEmoji}
          size={brushEmojiSize}
          textStyle={styles.sliderEmoji}
        />
      )}
      <Slider
        style={[
          styles.sizeSlider,
          isIpad && { flex: 4, minWidth: 120 },
          isIpad && isLandscape && { flex: 6, minWidth: 200, height: 60 } // Much larger in landscape
        ]}
        minimumValue={0}
        maximumValue={100}
        minimumTrackTintColor="#ff6b6b"
        maximumTrackTintColor="#444"
        thumbTintColor="#ff6b6b"
        value={sizeToSlider(brushSize)}
        onValueChange={handleSizeSliderChange}
        onSlidingComplete={handleSizeSliderComplete}
        accessibilityLabel="Brush size"
        accessibilityHint="Adjust the size of the emoji brush"
      />
      <TextInput
        style={[
          styles.sliderInput,
          isIpad && styles.sliderInputIpad,
          isIpad && isLandscape && { fontSize: 20, minWidth: 60, paddingHorizontal: 12, marginRight: 20 } // Add gap before spacing
        ]}
        value={sizeInput}
        onChangeText={onSizeInputChange}
        onEndEditing={onSizeInputSubmit}
        onFocus={onSizeInputFocus}
        onBlur={onSizeInputBlur}
        keyboardType="number-pad"
        returnKeyType="done"
        maxLength={3}
        selectTextOnFocus
      />
    </View>
  );

  const spacingSliderColumn = spacingSlider ? (
    <View key="spacing" style={[
      styles.spacingControlColumn,
      isIpad && { flex: 2 },
      isIpad && isLandscape && { marginLeft: 30, flexDirection: 'row', alignItems: 'center' } // Row layout in landscape
    ]}>
      <Text style={[
        styles.sliderEmoji,
        isIpad && isLandscape && { fontSize: 36, transform: [{ scale: 1.2075 }] } // 30% smaller than 1.725
      ]} accessibilityLabel="Brush spacing">↔️</Text>
      <Slider
        style={[
          styles.sizeSlider,
          isIpad && { flex: 2, minWidth: 60 },
          isIpad && isLandscape && { flex: 4, minWidth: 150, height: 60 } // Much larger in landscape
        ]}
        minimumValue={0.0001}
        maximumValue={999}
        minimumTrackTintColor="#ff9f6b"
        maximumTrackTintColor="#444"
        thumbTintColor="#ff9f6b"
        value={spacingSlider.value}
        onValueChange={spacingSlider.onChange}
        onSlidingComplete={spacingSlider.onComplete}
        accessibilityLabel="Brush spacing"
        accessibilityHint="Adjust the spacing between emoji stamps"
      />
      {!isIpad && <Text style={styles.spacingValueLabel}>{spacingLabel}</Text>}
    </View>
  ) : null;

  // Vertical "smudge smoothness" slider that floats above the mode button, only in smudge mode.
  // 0 = pure smear (not smooth, like the old behavior), ~0.5 = default, 1 = very creamy.
  const smudgeSliderOverlay = smudgeActive ? (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        alignItems: 'center',
        marginBottom: 6
      }}
    >
      <Text style={{ fontSize: 14 }}>🫧</Text>
      <View style={{ width: 46, height: 140, alignItems: 'center', justifyContent: 'center' }}>
        <Slider
          style={{ width: 140, height: 44, transform: [{ rotate: '-90deg' }] }}
          minimumValue={0}
          maximumValue={1}
          value={smudgeSmoothness}
          onValueChange={onSmudgeSmoothnessChange}
          minimumTrackTintColor="#6bd1ff"
          maximumTrackTintColor="#444"
          thumbTintColor="#6bd1ff"
          accessibilityLabel="Smudge smoothness"
          accessibilityHint="Drag up for a smoother, creamier smudge; down for a rough smear"
        />
      </View>
    </View>
  ) : null;

  // Opacity toggle as separate element in iPad landscape to ensure visibility
  const opacityToggleColumn = isIpad && isLandscape && spacingSlider ? (
    <View key="opacity" style={{
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 20
    }}>
      {smudgeSliderOverlay}
      <TouchableOpacity
        style={{
          width: 60,
          height: 60,
          borderRadius: 12,
          backgroundColor: isOpacityTransparent ? 'rgba(255, 107, 107, 0.2)' : 'rgba(255, 255, 255, 0.1)',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: isOpacityTransparent ? '#ff6b6b' : 'rgba(255, 255, 255, 0.2)'
        }}
        onPress={onToggleOpacity}
        accessibilityRole="button"
        accessibilityLabel={isOpacityTransparent ? 'Restore full opacity' : 'Enable transparent mode'}
        hitSlop={hitSlop}
      >
        <Text style={{
          fontSize: 36,
          lineHeight: 54
        }}>{opacityToggleEmoji}</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  // Determine slider order based on hand mode, and add opacity toggle for iPad landscape
  const sliderColumns = shouldSwapSliders
    ? [spacingSliderColumn, sizeSliderColumn, opacityToggleColumn].filter(Boolean)
    : [sizeSliderColumn, spacingSliderColumn, opacityToggleColumn].filter(Boolean);

  return (
    <View style={[
      styles.sizeControls,
      isIpad && isLandscape && { paddingVertical: 12, marginTop: -(SCREEN_HEIGHT * 0.05) - 120 }
    ]}>
      {sliderColumns}

      {/* Opacity/smudge toggle button - show for non-iPad landscape (iPad landscape has separate column) */}
      {!(isIpad && isLandscape) && (
        <View style={{ position: 'relative' }}>
          {smudgeSliderOverlay}
          <TouchableOpacity
            style={styles.opacityToggle}
            onPress={onToggleOpacity}
            accessibilityRole="button"
            accessibilityLabel={isOpacityTransparent ? 'Restore full opacity' : 'Enable transparent mode'}
            hitSlop={hitSlop}
          >
            <Text style={styles.opacityToggleEmoji}>{opacityToggleEmoji}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default BrushControls;
