/**
 * Emoji Color Picker Overlay — "Color Engine"
 *
 * Alternative way to pick a brush emoji: choose a color on an HSV wheel and
 * see emojis ranked by how well their dominant color matches. Opens as an
 * overlay panel on top of the Brush Library; selecting an emoji routes
 * through the same handler as the normal picker, so both stay in sync.
 *
 * Responsive: measures its own bounds (onLayout) and switches between
 * - stacked layout (phone portrait): wheel + controls row on top, grid below
 * - side-by-side layout (iPad portrait & landscape): controls left, grid right
 * Grid column count and wheel size adapt to the measured space, so iPad
 * rotation re-flows live.
 *
 * Matching logic ported from the local "Emoji Color Engine" web demo
 * (hue-distance gate + weighted hue/lightness/tone/saturation score).
 * Color data: src/data/emojiColorIndex.json (slimmed master DB, 1385 emojis).
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, FlatList, type LayoutChangeEvent, PanResponder, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Slider from '@react-native-community/slider';
import { Canvas, Circle, RadialGradient, SweepGradient, vec } from '@shopify/react-native-skia';

import emojiColorIndex from '../data/emojiColorIndex.json';

interface EmojiColorEntry {
  e: string; // emoji
  h: number; // dominant hue 0-360
  s: number; // saturation 0-100
  v: number; // brightness 0-100
  g: number; // gray value 0-255
  c: [number, number, number, number][]; // clusters [h, s, v, weight]
}

interface EmojiColorPickerOverlayProps {
  visible: boolean;
  brushEmoji: string;
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
}

const ENTRIES = emojiColorIndex as EmojiColorEntry[];

const MAX_RESULTS = 120;
const GRID_GAP = 6;
const STACKED_BREAKPOINT = 560; // narrower than this → stacked phone layout

// Mirror the Brush Library's default iPad cell size (12 emojis per row over
// the full screen width with 72pt padding + 4pt gaps) so emojis look the
// same size in both pickers.
const SCREEN_WIDTH = Dimensions.get('window').width;
const IPAD_DEFAULT_CELL = Math.floor((SCREEN_WIDTH - 72 - 11 * 4) / 12);

// ── Color math (ported from web demo) ────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const sf = s / 100;
  const vf = v / 100;
  const c = vf * sf;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vf - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// Greens get a wider tolerance band, exactly like the web demo
function colorMatchTolerance(h: number): number {
  return h >= 85 && h <= 160 ? 46 : 22;
}

type ToneKind = 'white' | 'dark' | 'mid';

function weightFromClusters(clusters: EmojiColorEntry['c'], kind: ToneKind): number {
  if (!clusters || clusters.length === 0) return 0;
  let total = 0;
  for (const [, s, v, weight] of clusters) {
    if (kind === 'white' && s < 18 && v > 78) total += weight;
    else if (kind === 'dark' && v < 28) total += weight;
    else if (kind === 'mid' && s >= 25 && v >= 28 && v <= 88) total += weight;
  }
  return total;
}

function matchesColorSelection(d: EmojiColorEntry, hue: number, sat: number, val: number): boolean {
  if (sat < 12 && val < 18) {
    // Near-black selection: dark emojis whose dark weight beats white weight
    return d.v < 42 && weightFromClusters(d.c, 'dark') > weightFromClusters(d.c, 'white');
  }
  if (sat < 12 && val > 92) {
    // Near-white selection
    return d.v > 72 && d.s < 28;
  }
  if (hueDistance(d.h, hue) > colorMatchTolerance(hue)) return false;
  if (d.s < 10 && !(d.v >= 16 && d.v <= 92)) return false;
  return true;
}

function scoreEmoji(d: EmojiColorEntry, hue: number, val: number): number {
  const hueDiff = hueDistance(d.h, hue);
  const hueScore = 1 - hueDiff / 180;

  const targetGray = (val / 100) * 255;
  const grayDiff = Math.abs(d.g - targetGray);
  const lightScore = 1 - Math.min(grayDiff / 255, 1);

  const lightness = val / 100;
  const darkWeight = weightFromClusters(d.c, 'dark');
  const whiteWeight = weightFromClusters(d.c, 'white');
  const midWeight = weightFromClusters(d.c, 'mid');

  let toneScore: number;
  if (lightness < 0.22) toneScore = darkWeight * 1.6 - whiteWeight * 0.8;
  else if (lightness > 0.78) toneScore = whiteWeight * 1.6 - darkWeight * 0.6;
  else toneScore = midWeight;

  const satTarget = lightness > 0.66 ? 28 : lightness < 0.34 ? 42 : 64;
  const satScore = 1 - Math.min(Math.abs(d.s - satTarget) / 100, 1);

  return hueScore * 0.4 + lightScore * 0.25 + toneScore * 0.2 + satScore * 0.15;
}

function findMatches(hue: number, sat: number, val: number): { entry: EmojiColorEntry; swatch: string }[] {
  const neutralLight = sat < 12 && val > 92;
  const results: { entry: EmojiColorEntry; score: number }[] = [];
  for (const d of ENTRIES) {
    if (!d?.e || !matchesColorSelection(d, hue, sat, val)) continue;
    if (neutralLight && (d.v < 72 || d.s > 30)) continue;
    results.push({ entry: d, score: scoreEmoji(d, hue, val) });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS).map(({ entry }) => {
    const [r, g, b] = hsvToRgb(entry.h, entry.s, entry.v);
    return { entry, swatch: `rgb(${r},${g},${b})` };
  });
}

// ── Result cell ──────────────────────────────────────────────────────────────

const ColorEmojiCell = memo<{
  emoji: string;
  swatch: string;
  selected: boolean;
  cellSize: number;
  onPress: () => void;
}>(({ emoji, swatch, selected, cellSize, onPress }) => (
  <TouchableOpacity
    style={[
      styles.emojiCell,
      { width: cellSize, height: cellSize },
      selected && styles.emojiCellSelected,
    ]}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`Use emoji ${emoji}`}
    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
  >
    <View style={[styles.swatchDot, { backgroundColor: swatch }]} />
    <Text style={{ fontSize: Math.floor(cellSize * 0.6), includeFontPadding: false }}>{emoji}</Text>
  </TouchableOpacity>
));

ColorEmojiCell.displayName = 'ColorEmojiCell';

// ── Overlay ──────────────────────────────────────────────────────────────────

const EmojiColorPickerOverlay: React.FC<EmojiColorPickerOverlayProps> = ({
  visible,
  brushEmoji,
  onSelectEmoji,
  onClose,
}) => {
  const [hue, setHue] = useState(28);
  const [sat, setSat] = useState(85);
  const [val, setVal] = useState(90);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  // Pulsing highlight on the 🎨 mode-toggle so users notice it's tappable
  const palettePulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(palettePulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(palettePulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, palettePulse]);
  const palettePulseScale = palettePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const palettePulseOpacity = palettePulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.65] });

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBounds((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height }
    );
  }, []);

  // ── Responsive layout values (re-derived on rotation / resize) ────────────
  const layout = useMemo(() => {
    const { width, height } = bounds;
    const stacked = width > 0 && width < STACKED_BREAKPOINT;
    let wheelSize: number;
    if (stacked) {
      // Phone portrait: wheel shares a top row with the controls column
      wheelSize = Math.max(120, Math.min(160, width * 0.42, height * 0.3));
    } else {
      // iPad (portrait or landscape): controls column on the left
      wheelSize = Math.max(150, Math.min(210, width * 0.24, height * 0.45));
    }
    const controlsWidth = stacked ? width : wheelSize + 32;
    const gridPadding = 10;
    const gridWidth = Math.max(0, (stacked ? width : width - controlsWidth) - gridPadding * 2);
    const targetCell = stacked ? 46 : IPAD_DEFAULT_CELL;
    const columns = Math.max(3, Math.floor((gridWidth + GRID_GAP) / (targetCell + GRID_GAP)));
    const cellSize = Math.max(
      38,
      Math.floor((gridWidth - (columns - 1) * GRID_GAP) / columns)
    );
    return { stacked, wheelSize, controlsWidth, columns, cellSize };
  }, [bounds]);

  const { stacked, wheelSize, columns, cellSize } = layout;
  const wheelRadius = wheelSize / 2;

  // Keep latest radius available to the PanResponder without re-creating it
  const wheelRadiusRef = useRef(wheelRadius);
  wheelRadiusRef.current = wheelRadius;

  const cursorPos = useMemo(() => {
    const angle = (hue * Math.PI) / 180;
    const radius = (sat / 100) * wheelRadius;
    return {
      x: wheelRadius + Math.cos(angle) * radius,
      y: wheelRadius + Math.sin(angle) * radius,
    };
  }, [hue, sat, wheelRadius]);

  const pickFromWheel = useCallback((x: number, y: number) => {
    const r = wheelRadiusRef.current;
    const dx = x - r;
    const dy = y - r;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    setHue(angle);
    setSat(Math.min(100, (dist / r) * 100));
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => pickFromWheel(evt.nativeEvent.locationX, evt.nativeEvent.locationY),
      onPanResponderMove: (evt) => pickFromWheel(evt.nativeEvent.locationX, evt.nativeEvent.locationY),
    })
  ).current;

  const matches = useMemo(() => (visible ? findMatches(hue, sat, val) : []), [visible, hue, sat, val]);

  const previewRgb = useMemo(() => {
    const [r, g, b] = hsvToRgb(hue, sat, val);
    return `rgb(${r},${g},${b})`;
  }, [hue, sat, val]);

  const renderItem = useCallback(
    ({ item }: { item: { entry: EmojiColorEntry; swatch: string } }) => (
      <ColorEmojiCell
        emoji={item.entry.e}
        swatch={item.swatch}
        selected={item.entry.e === brushEmoji}
        cellSize={cellSize}
        onPress={() => onSelectEmoji(item.entry.e)}
      />
    ),
    [brushEmoji, cellSize, onSelectEmoji]
  );

  if (!visible) return null;

  const wheel = (
    <View style={{ width: wheelSize, height: wheelSize }} {...panResponder.panHandlers}>
      <Canvas style={{ width: wheelSize, height: wheelSize }} pointerEvents="none">
        <Circle cx={wheelRadius} cy={wheelRadius} r={wheelRadius}>
          <SweepGradient
            c={vec(wheelRadius, wheelRadius)}
            colors={['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00']}
          />
        </Circle>
        <Circle cx={wheelRadius} cy={wheelRadius} r={wheelRadius}>
          <RadialGradient
            c={vec(wheelRadius, wheelRadius)}
            r={wheelRadius}
            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0)']}
          />
        </Circle>
        {/* Brightness slider tints the wheel itself: darker ↓ / whiter ↑ */}
        <Circle
          cx={wheelRadius}
          cy={wheelRadius}
          r={wheelRadius}
          color="black"
          opacity={Math.max(0, (1 - val / 100) * 0.92)}
        />
        <Circle
          cx={wheelRadius}
          cy={wheelRadius}
          r={wheelRadius}
          color="white"
          opacity={Math.max(0, ((val - 70) / 30) * 0.35)}
        />
      </Canvas>
      <View
        pointerEvents="none"
        style={[styles.wheelCursor, { left: cursorPos.x - 8, top: cursorPos.y - 8 }]}
      />
    </View>
  );

  const brightnessAndPreview = (
    <>
      <View style={styles.brightnessRow}>
        <Text style={styles.brightnessLabel}>🌗</Text>
        <Slider
          style={styles.brightnessSlider}
          minimumValue={0}
          maximumValue={100}
          value={val}
          onValueChange={setVal}
          minimumTrackTintColor="#7c6cf8"
          maximumTrackTintColor="#2a2a38"
          thumbTintColor="#7c6cf8"
          accessibilityLabel="Brightness"
        />
      </View>
      <View style={[styles.colorPreview, { backgroundColor: previewRgb }]} />
    </>
  );

  const grid = (
    <View style={styles.results}>
      <Text style={styles.resultsLabel}>{matches.length} matching emojis</Text>
      <FlatList
        key={`cols-${columns}`}
        data={matches}
        keyExtractor={(item) => item.entry.e}
        renderItem={renderItem}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.gridRow : undefined}
        contentContainerStyle={styles.gridContent}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={36}
        showsVerticalScrollIndicator
        indicatorStyle="white"
        ListEmptyComponent={
          <Text style={styles.emptyText}>No emojis match this color — try another spot 🎯</Text>
        }
      />
    </View>
  );

  return (
    <View style={styles.overlay} pointerEvents="auto" onLayout={handleLayout}>
      {/* Header */}
      <View style={[styles.header, stacked && styles.headerStacked]}>
        <Text style={styles.title}>Color Engine</Text>
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Back to Brush Library"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ marginLeft: 10 }}
        >
          <Animated.View
            style={{
              transform: [{ scale: palettePulseScale }],
              borderRadius: 18,
              padding: 3,
            }}
          >
            <Animated.View
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                borderRadius: 18,
                backgroundColor: '#7c6cf8',
                opacity: palettePulseOpacity,
              }}
            />
            <Text style={styles.toggleIcon}>🎨</Text>
          </Animated.View>
        </TouchableOpacity>
        <Text style={styles.hsvReadout}>
          H:{Math.round(hue)}° S:{Math.round(sat)}% V:{Math.round(val)}%
        </Text>
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close color picker"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.closeIcon}>❎</Text>
        </TouchableOpacity>
      </View>

      {bounds.width === 0 ? null : stacked ? (
        /* Phone portrait: wheel + controls in one top row, grid fills the rest */
        <View style={styles.contentStacked}>
          <View style={styles.stackedTopRow}>
            {wheel}
            <View style={styles.stackedControlsColumn}>
              {brightnessAndPreview}
              <Text style={styles.helperText}>Drag the wheel — emojis match live</Text>
            </View>
          </View>
          {grid}
        </View>
      ) : (
        /* iPad portrait & landscape: controls column left, grid right */
        <View style={styles.contentRow}>
          <View style={[styles.controls, { width: layout.controlsWidth }]}>
            {wheel}
            {brightnessAndPreview}
            <Text style={styles.helperText}>Drag the wheel — emojis match live</Text>
          </View>
          {grid}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#111111',
    borderRadius: 16,
    zIndex: 50,
    elevation: 12,
    borderWidth: 1,
    borderColor: '#2a2a38',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a38',
    gap: 10,
  },
  title: { color: '#7c6cf8', fontSize: 20, fontWeight: '800' },
  toggleIcon: { fontSize: 26 },
  hsvReadout: { color: '#888', fontSize: 11, flex: 1, textAlign: 'right', marginRight: 8 },
  closeIcon: { fontSize: 22 },
  headerStacked: { paddingTop: 46 },

  // Side-by-side (iPad)
  contentRow: { flex: 1, flexDirection: 'row' },
  controls: {
    padding: 14,
    borderRightWidth: 1,
    borderRightColor: '#2a2a38',
    alignItems: 'center',
  },

  // Stacked (phone portrait)
  contentStacked: { flex: 1 },
  stackedTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a38',
  },
  stackedControlsColumn: { flex: 1, justifyContent: 'center' },

  wheelCursor: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.8,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 0 },
  },
  brightnessRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, width: '100%' },
  brightnessLabel: { fontSize: 14, marginRight: 6 },
  brightnessSlider: { flex: 1, height: 30 },
  colorPreview: {
    width: '100%',
    height: 28,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2a2a38',
  },
  helperText: { color: '#888', fontSize: 11, marginTop: 8, textAlign: 'center' },

  results: { flex: 1, padding: 10 },
  resultsLabel: { color: '#888', fontSize: 11, marginBottom: 8, paddingHorizontal: 4 },
  gridRow: { gap: GRID_GAP, marginBottom: GRID_GAP },
  gridContent: { paddingBottom: 16 },
  emojiCell: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a38',
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  emojiCellSelected: { borderColor: '#7c6cf8', backgroundColor: '#1d1a30' },
  swatchDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  emptyText: { color: '#666', fontSize: 12, textAlign: 'center', marginTop: 30 },
});

export default EmojiColorPickerOverlay;
