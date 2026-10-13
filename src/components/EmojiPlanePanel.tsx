import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import BrushEmojiIcon from './BrushEmojiIcon';
import { LATTICE_LEVELS, type LatticeLevel } from '../lib/planeLattice';

/**
 * Floating controls for the currently selected emoji plane (Triangle / Four-Corner
 * placement tool). Rendered only in the main workspace while the plane tool is active.
 *
 * The panel is intentionally "dumb": every action is a callback so the plane state stays
 * in PaintingContext and keeps flowing through the existing UPDATE/DELETE/COMMIT dispatches
 * (which already feed the shared undo stack).
 */

export type EmojiPlanePanelLayout = 'phone' | 'tabletPortrait' | 'tabletLandscape';

interface EmojiPlanePanelProps {
  emoji: string;
  opacity: number;
  rotation: number;
  scale: number;
  visible: boolean;
  layout: EmojiPlanePanelLayout;
  canReset: boolean;
  /** Current handle density. 1 = the classic 4 corners. */
  latticeLevel: LatticeLevel;
  onLatticeLevelChange: (level: LatticeLevel) => void;
  onOpacityChange: (value: number) => void;
  onRotationChange: (value: number) => void;
  onScaleChange: (value: number) => void;
  onToggleVisibility: () => void;
  onReset: () => void;
  onCancel: () => void;
  onCommit: () => void;
}

export const EMOJI_PLANE_PANEL_WIDTH: Record<EmojiPlanePanelLayout, number> = {
  phone: 252,
  tabletPortrait: 300,
  tabletLandscape: 280
};

const EmojiPlanePanel: React.FC<EmojiPlanePanelProps> = ({
  emoji,
  opacity,
  rotation,
  scale,
  visible,
  layout,
  canReset,
  latticeLevel,
  onLatticeLevelChange,
  onOpacityChange,
  onRotationChange,
  onScaleChange,
  onToggleVisibility,
  onReset,
  onCancel,
  onCommit
}) => {
  const compact = layout === 'phone';
  const iconSize = compact ? 22 : 28;

  return (
    <View style={[styles.card, { width: EMOJI_PLANE_PANEL_WIDTH[layout] }]}>
      <View style={styles.header}>
        <BrushEmojiIcon
          emoji={emoji}
          size={iconSize}
          textStyle={{ fontSize: iconSize, lineHeight: iconSize + 6 }}
        />
        <View style={styles.levelRow}>
          {LATTICE_LEVELS.map((option) => {
            const active = option.level === latticeLevel;
            return (
              <TouchableOpacity
                key={option.level}
                style={[styles.levelButton, active && styles.levelButtonActive]}
                onPress={() => onLatticeLevelChange(option.level)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${option.points} distortion points`}
              >
                <Text style={[styles.levelButtonText, active && styles.levelButtonTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.eyeButton, !visible && styles.eyeButtonOff]}
          onPress={onToggleVisibility}
          accessibilityLabel={visible ? 'Hide plane' : 'Show plane'}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.eyeIcon}>{visible ? '👁️' : '🙈'}</Text>
        </TouchableOpacity>
      </View>

      {/* Both geometric transforms share one compact row. */}
      <View style={styles.transformRow}>
        <View style={styles.transformControl}>
          <Text style={styles.compactValue}>↻ {Math.round(rotation)}°</Text>
          <Slider
            style={styles.compactSlider}
            value={rotation}
            minimumValue={0}
            maximumValue={360}
            step={1}
            onValueChange={onRotationChange}
            onSlidingComplete={onRotationChange}
            minimumTrackTintColor="#60a5fa"
            maximumTrackTintColor="rgba(255,255,255,0.22)"
            thumbTintColor="#60a5fa"
          />
        </View>
        <View style={styles.transformControl}>
          <Text style={styles.compactValue}>↕ {Math.round(scale * 100)}%</Text>
          <Slider
            style={styles.compactSlider}
            value={scale}
            minimumValue={0.25}
            maximumValue={2.5}
            step={0.05}
            onValueChange={onScaleChange}
            onSlidingComplete={onScaleChange}
            minimumTrackTintColor="#f59e0b"
            maximumTrackTintColor="rgba(255,255,255,0.22)"
            thumbTintColor="#f59e0b"
          />
        </View>
      </View>

      <View style={styles.opacityRow}>
        <Text style={styles.compactValue}>◐ {Math.round(opacity * 100)}%</Text>
        <Slider
          style={styles.opacitySlider}
          value={opacity}
          minimumValue={0}
          maximumValue={1}
          step={0.05}
          onValueChange={onOpacityChange}
          onSlidingComplete={onOpacityChange}
          minimumTrackTintColor="#4ade80"
          maximumTrackTintColor="rgba(255,255,255,0.25)"
          thumbTintColor="#4ade80"
        />
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.buttonSmall, styles.buttonNeutral, !canReset && styles.buttonDisabled]}
          onPress={onReset}
          disabled={!canReset}
        >
          <Text style={[styles.buttonText, compact && styles.buttonTextCompact]}>↩️ Reset</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonSmall, styles.buttonCancel]} onPress={onCancel}>
          <Text style={[styles.buttonText, compact && styles.buttonTextCompact]}>✖️ Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonCommit]} onPress={onCommit}>
          <Text style={[styles.buttonText, compact && styles.buttonTextCompact]}>✅ Apply</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(20,20,20,0.94)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 4
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5
  },
  eyeButton: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)'
  },
  eyeButtonOff: {
    backgroundColor: 'rgba(255,107,107,0.35)'
  },
  eyeIcon: {
    fontSize: 13
  },
  levelRow: { flex: 1, flexDirection: 'row', gap: 4 },
  levelButton: {
    flex: 1,
    paddingVertical: 5,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)'
  },
  levelButtonActive: { backgroundColor: '#2f9e5e' },
  levelButtonText: {
    color: '#cfcfcf',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal'
  },
  levelButtonTextActive: { color: '#fff' },
  transformRow: {
    flexDirection: 'row',
    gap: 6
  },
  transformControl: {
    flex: 1,
    minWidth: 0
  },
  compactValue: {
    color: '#b8b8b8',
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  compactSlider: {
    width: '100%',
    height: 22
  },
  opacityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5
  },
  opacitySlider: {
    flex: 1,
    height: 22
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 5
  },
  button: {
    flex: 1,
    borderRadius: 8,
    minHeight: 28,
    paddingHorizontal: 6,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonNeutral: {
    backgroundColor: 'rgba(255,255,255,0.14)'
  },
  buttonCancel: {
    backgroundColor: 'rgba(200,50,50,0.55)'
  },
  buttonCommit: {
    flex: 1.35,
    backgroundColor: '#2f9e5e'
  },
  buttonSmall: {
    flex: 0.82
  },
  buttonDisabled: {
    opacity: 0.4
  },
  buttonText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal'
  },
  buttonTextCompact: {
    fontSize: 9
  }
});

export default EmojiPlanePanel;
