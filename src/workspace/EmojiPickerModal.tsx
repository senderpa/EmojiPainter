import React, { useCallback, useMemo, useRef, useEffect, memo, useState } from 'react';
import { Modal, View, TouchableOpacity, TextInput, ScrollView, FlatList, type Insets, StyleSheet, Dimensions, Platform, Animated, Keyboard } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { PinchGestureHandler, State } from 'react-native-gesture-handler';
import Slider from '@react-native-community/slider';
import type { EmojiEntry } from '../lib/emojiCatalog';
import { useAppSettings } from '../context/AppSettingsContext';
import type { CustomBrush } from '../lib/customBrushes';
import { getCustomBrushes, deleteCustomBrush } from '../lib/customBrushes';
import { getCustomBrushPNGData, isCustomBrushReference } from '../lib/customBrushRegistry';
import BrushEmojiIcon from '../components/BrushEmojiIcon';
import EmojiColorPickerOverlay from './EmojiColorPickerOverlay';

const SCREEN_WIDTH = Dimensions.get('window').width;
const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;
const PICKER_CONTAINER_PADDING = 24; // paddingHorizontal from pickerContainer
const LIST_CONTENT_PADDING = 12; // paddingHorizontal from listContent
const TOTAL_HORIZONTAL_PADDING = PICKER_CONTAINER_PADDING + LIST_CONTENT_PADDING;
const GAP_SIZE = 4;
const AVAILABLE_WIDTH = SCREEN_WIDTH - (TOTAL_HORIZONTAL_PADDING * 2);

// iPad: 5-20 emojis per row (default 12), iPhone: fixed 9
const MIN_EMOJIS_PER_ROW = IS_IPAD ? 5 : 9;
const MAX_EMOJIS_PER_ROW = IS_IPAD ? 20 : 9;
const DEFAULT_EMOJIS_PER_ROW = IS_IPAD ? 12 : 9;

// Helper to calculate sizes based on emojis per row
const calculateSizes = (emojisPerRow: number) => {
  const totalGapWidth = (emojisPerRow - 1) * GAP_SIZE;
  const cellSize = Math.floor((AVAILABLE_WIDTH - totalGapWidth) / emojisPerRow);
  const rowHeight = cellSize + 4; // Reduced from 8 to 4 for more compact layout
  const fontSize = IS_IPAD ? Math.round(cellSize * 0.6) : 20;
  const lineHeight = IS_IPAD ? Math.round(fontSize * 1.05) : 23;
  return { cellSize, rowHeight, fontSize, lineHeight };
};

interface EmojiPickerModalProps {
  visible: boolean;
  styles: any;
  emojiSearch: string;
  onEmojiSearchChange: (value: string) => void;
  recentEmojis?: string[];
  brushEmoji: string;
  emojiResults: EmojiEntry[];
  onSelectEmoji: (emoji: string) => void;
  onLoadCustomBrushToWorkspace?: (emoji: string) => void;
  onClose: () => void;
  hitSlop: Insets | { top: number; bottom: number; left: number; right: number };
  mirrorX: boolean;
  mirrorY: boolean;
  rotation: number;
  onToggleMirrorX: () => void;
  onToggleMirrorY: () => void;
  spacingSlider?: {
    value: number;
    minimum: number;
    maximum: number;
    onChange: (value: number) => void;
    onComplete?: (value: number) => void;
  };
  onTurnLeft: () => void;
  onTurnRight: () => void;
  onTurnRightLongPress?: () => void;
  autoRotateEnabled?: boolean;
}

// Memoized emoji cell for performance
const EmojiCell = memo<{
  emoji: string;
  annotation?: string;
  selected: boolean;
  onPress: () => void;
  cellSize: number;
  fontSize: number;
  lineHeight: number;
}>(({ emoji, annotation, selected, onPress, cellSize, fontSize, lineHeight }) => (
  <TouchableOpacity
    style={[
      {
        width: cellSize,
        height: cellSize,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 4, // Reduced from 8 to 4 for less prominent frame
        backgroundColor: selected ? '#ffdc82' : 'transparent',
      }
    ]}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`Use emoji ${annotation ?? emoji}`}
    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
  >
    <Text style={{ fontSize, lineHeight, includeFontPadding: false }}>{emoji}</Text>
  </TouchableOpacity>
));

EmojiCell.displayName = 'EmojiCell';

const EmojiPickerModal: React.FC<EmojiPickerModalProps> = ({
  visible,
  styles,
  emojiSearch,
  onEmojiSearchChange,
  recentEmojis,
  brushEmoji,
  emojiResults,
  onSelectEmoji,
  onLoadCustomBrushToWorkspace,
  onClose,
  hitSlop,
  mirrorX,
  mirrorY,
  rotation,
  onToggleMirrorX,
  onToggleMirrorY,
  spacingSlider,
  onTurnLeft,
  onTurnRight,
  onTurnRightLongPress,
  autoRotateEnabled = false
}) => {
  const { colors } = useAppSettings();
  const flatListRef = useRef<FlatList>(null);
  const searchInputRef = useRef<TextInput>(null);
  const hasScrolled = useRef(false);

  // State for dynamic emoji grid size (iPad only)
  const [emojisPerRow, setEmojisPerRow] = useState(DEFAULT_EMOJIS_PER_ROW);
  const baseScale = useRef(DEFAULT_EMOJIS_PER_ROW);

  // Keyboard animation for moving picker up
  const pickerOffset = useRef(new Animated.Value(0)).current;
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  // Typewriter effect for placeholder
  const [placeholderText, setPlaceholderText] = useState('');
  const fullPlaceholder = 'Search emoji';

  // State for custom brushes
  const [customBrushes, setCustomBrushes] = useState<CustomBrush[]>([]);
  const [longPressedBrushId, setLongPressedBrushId] = useState<string | null>(null);
  const [customListVisible, setCustomListVisible] = useState(false);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);

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

  // Load custom brushes on mount and when picker opens
  useEffect(() => {
    if (visible) {
      getCustomBrushes().then(brushes => {
        // Sort by most recently saved first
        brushes.sort((a, b) => b.savedAt - a.savedAt);
        setCustomBrushes(brushes);
      }).catch(error => console.error('[EmojiPicker] Failed to load custom brushes:', error));
    }
    // NOTE: colorPickerVisible is intentionally NOT reset on close — the picker
    // remembers its mode (normal vs Color Engine) for the whole app session.
    // Default on app start is the normal picker (useState(false)).
  }, [visible]);

  const visibleCustomBrushes = useMemo(
    () => customBrushes.filter((brush) => Boolean(brush.brushPngId || brush.emoji)),
    [customBrushes]
  );

  // Preload custom brush PNGs when the picker is open
  useEffect(() => {
    if (!visible || visibleCustomBrushes.length === 0) {
      return;
    }

    visibleCustomBrushes.forEach((brush) => {
      if (brush.brushPngId && isCustomBrushReference(brush.brushPngId)) {
        void getCustomBrushPNGData(brush.brushPngId);
      }
    });
  }, [visible, visibleCustomBrushes]);

  // Handle custom brush deletion
  const handleDeleteCustomBrush = useCallback(async (brushId: string) => {
    const success = await deleteCustomBrush(brushId);
    if (success) {
      setCustomBrushes(prev => prev.filter(b => b.id !== brushId));
      setLongPressedBrushId(null);
    }
  }, []);

  // Handle long press on custom brush - show delete button for 3 seconds
  const handleCustomBrushLongPress = useCallback((brushId: string) => {
    setLongPressedBrushId(brushId);
    // Auto-hide delete button after 3 seconds
    const timer = setTimeout(() => {
      setLongPressedBrushId(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Calculate dynamic sizes based on current emojisPerRow
  const sizes = useMemo(() => calculateSizes(emojisPerRow), [emojisPerRow]);

  // Reset picker position when picker opens
  useEffect(() => {
    if (visible) {
      // When picker opens, animate panel to default position if it's not already there
      // This handles the case where user selected emoji while keyboard was open
      if (!isKeyboardVisible) {
        Animated.spring(pickerOffset, {
          toValue: 0,
          useNativeDriver: true,
          friction: 6,
          tension: 180,
        }).start();
      }
    }
  }, [visible, isKeyboardVisible, pickerOffset]);

  // Keyboard listeners to move picker up when keyboard opens
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setIsKeyboardVisible(true);
        // Only move picker up if it's currently visible
        if (visible) {
          // Move picker up so search input is visible
          const keyboardHeight = e.endCoordinates.height;
          // iPad needs less aggressive offset since screen is larger
          // iPhone: move up more to see search input clearly
          // iPad: move up less to keep header visible
          const offset = IS_IPAD
            ? -keyboardHeight + 250  // iPad: keep more of the header visible (250px from keyboard top)
            : -keyboardHeight + 100; // iPhone: move closer to top (100px from keyboard top)
          Animated.spring(pickerOffset, {
            toValue: offset,
            useNativeDriver: true,
            friction: 6,
            tension: 180,
          }).start();
        }
      }
    );

    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setIsKeyboardVisible(false);
        // Only animate back if picker is still visible
        if (visible) {
          // Return to default position
          Animated.spring(pickerOffset, {
            toValue: 0,
            useNativeDriver: true,
            friction: 6,
            tension: 180,
          }).start();
        }
      }
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, [pickerOffset, visible]);

  // Pinch gesture handler for iPad
  const onPinchGestureEvent = useCallback((event: any) => {
    if (!IS_IPAD) return;

    if (event.nativeEvent.state === State.ACTIVE) {
      const scale = event.nativeEvent.scale;
      // Invert scale: pinch in = zoom out (more emojis), pinch out = zoom in (fewer emojis)
      const newEmojisPerRow = Math.round(baseScale.current / scale);
      const clamped = Math.max(MIN_EMOJIS_PER_ROW, Math.min(MAX_EMOJIS_PER_ROW, newEmojisPerRow));
      setEmojisPerRow(clamped);
    } else if (event.nativeEvent.state === State.END) {
      // Update base scale for next pinch
      baseScale.current = emojisPerRow;
    }
  }, [emojisPerRow]);

  // Calculate preview emoji transform
  const previewTransform = useMemo(() => {
    const transforms: any[] = [];
    if (rotation !== 0) {
      transforms.push({ rotate: `${rotation}deg` });
    }
    if (mirrorX) {
      transforms.push({ scaleX: -1 });
    }
    if (mirrorY) {
      transforms.push({ scaleY: -1 });
    }
    return transforms;
  }, [mirrorX, mirrorY, rotation]);

  // Group emojis into rows dynamically based on emojisPerRow
  const emojiRows = useMemo(() => {
    const rows: EmojiEntry[][] = [];
    for (let i = 0; i < emojiResults.length; i += emojisPerRow) {
      rows.push(emojiResults.slice(i, i + emojisPerRow));
    }
    return rows;
  }, [emojiResults, emojisPerRow]);

  // Reset scroll flag when search is cleared
  useEffect(() => {
    if (emojiSearch === '') {
      hasScrolled.current = false;
    }
  }, [emojiSearch]);

  // Scroll to selected emoji when picker opens or when search is cleared
  useEffect(() => {
    if (visible && flatListRef.current && !hasScrolled.current) {
      const index = emojiResults.findIndex((entry) => entry.emoji === brushEmoji);
      if (index !== -1) {
        const rowIndex = Math.floor(index / emojisPerRow);

        // Scroll immediately after modal renders
        setTimeout(() => {
          try {
            flatListRef.current?.scrollToIndex({
              index: rowIndex,
              animated: emojiSearch === '', // Animate when search is cleared
              viewPosition: 0.3,
            });
            hasScrolled.current = true;
          } catch (error) {
            // Fallback if scrollToIndex fails
            console.log('[EmojiPicker] Auto-scroll failed, using offset fallback');
          }
        }, 100);
      }
    } else if (!visible) {
      hasScrolled.current = false;
    }
  }, [visible, brushEmoji, emojiResults, emojisPerRow, emojiSearch]);

  // Handle scroll to selected
  const handleScrollToSelected = useCallback(() => {
    onEmojiSearchChange('');
    setTimeout(() => {
      const index = emojiResults.findIndex((entry) => entry.emoji === brushEmoji);
      if (index !== -1) {
        const rowIndex = Math.floor(index / emojisPerRow);
        flatListRef.current?.scrollToIndex({
          index: rowIndex,
          animated: true,
          viewPosition: 0.3,
        });
      }
    }, 100);
  }, [brushEmoji, emojiResults, onEmojiSearchChange, emojisPerRow]);

  // Typewriter effect for placeholder when picker opens
  useEffect(() => {
    if (visible) {
      let currentIndex = 0;
      setPlaceholderText('');

      const typewriterInterval = setInterval(() => {
        if (currentIndex < fullPlaceholder.length) {
          setPlaceholderText(fullPlaceholder.substring(0, currentIndex + 1));
          currentIndex++;
        } else {
          clearInterval(typewriterInterval);
        }
      }, 80); // Type one character every 80ms

      return () => clearInterval(typewriterInterval);
    } else {
      setPlaceholderText('');
    }
  }, [visible, fullPlaceholder]);

  // Clear search when picker opens
  useEffect(() => {
    if (visible) {
      onEmojiSearchChange('');
    }
  }, [visible, onEmojiSearchChange]);

  // Handle emoji selection with keyboard dismissal and search clear
  const handleEmojiSelect = useCallback(async (emoji: string) => {
    console.log('[EmojiPicker] handleEmojiSelect called with:', emoji.substring(0, 50) + (emoji.length > 50 ? '...' : ''));
    Keyboard.dismiss();
    onEmojiSearchChange(''); // Clear search after selecting emoji

    if (isCustomBrushReference(emoji)) {
      try {
        await getCustomBrushPNGData(emoji);
      } catch (error) {
        console.warn('[EmojiPicker] Failed to preload custom brush PNG:', error);
      }
    }

    onSelectEmoji(emoji);
    console.log('[EmojiPicker] onSelectEmoji called');
  }, [onSelectEmoji, onEmojiSearchChange]);

  // Render emoji row
  const renderRow = useCallback(({ item: row }: { item: EmojiEntry[] }) => (
    <View style={{ flexDirection: 'row', gap: GAP_SIZE, marginBottom: 4 }}>
      {row.map((entry) => {
        const selected = entry.emoji === brushEmoji;
        return (
          <EmojiCell
            key={entry.emoji}
            emoji={entry.emoji}
            annotation={entry.annotation}
            selected={selected}
            onPress={() => void handleEmojiSelect(entry.emoji)}
            cellSize={sizes.cellSize}
            fontSize={sizes.fontSize}
            lineHeight={sizes.lineHeight}
          />
        );
      })}
      {/* Fill empty cells in last row */}
      {row.length < emojisPerRow &&
        Array.from({ length: emojisPerRow - row.length }).map((_, i) => (
          <View key={`empty-${i}`} style={{ width: sizes.cellSize, height: sizes.cellSize }} />
        ))}
    </View>
  ), [brushEmoji, handleEmojiSelect, emojisPerRow, sizes]);

  // Row key extractor
  const keyExtractor = useCallback((item: EmojiEntry[], index: number) =>
    `row-${index}`, []
  );

  // Get item layout for optimization
  const getItemLayout = useCallback((data: any, index: number) => ({
    length: sizes.rowHeight,
    offset: sizes.rowHeight * index,
    index,
  }), [sizes.rowHeight]);

  // Handle scroll to index failure
  const handleScrollToIndexFailed = useCallback((info: any) => {
    console.log('[EmojiPicker] Scroll to index failed:', info);
    // Retry after a short delay
    setTimeout(() => {
      try {
        flatListRef.current?.scrollToIndex({
          index: info.index,
          animated: false,
          viewPosition: 0.3,
        });
      } catch (e) {
        // Ignore retry failures
      }
    }, 100);
  }, []);

  // Format spacing value for display
  const spacingDisplay = spacingSlider ? spacingSlider.value.toFixed(3) : '0.120';

  // Dynamic styles based on theme
  const dynamicStyles = useMemo(() => StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: `${colors.background}EB`,
      justifyContent: 'center',
      alignItems: 'center',
    },
    listContent: {
      paddingHorizontal: LIST_CONTENT_PADDING,
      paddingTop: 12,
      paddingBottom: 80,
    },
    selectedInfoRow: {
      flexDirection: 'column',
      alignItems: 'flex-start',
    },
    spacingText: {
      fontSize: 9,
      color: colors.textSecondary,
      marginTop: 2,
      fontWeight: '500',
      letterSpacing: 0.3,
      fontFamily: 'vrtlfinal',
    },
  }), [colors]);

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onClose}
      supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
    >
      <View style={dynamicStyles.backdrop}>
        <Animated.View
          style={[
            styles.pickerContainer,
            { transform: [{ translateY: pickerOffset }] }
          ]}
        >
          {/* Header */}
          <View style={styles.pickerHeader}>
            <View style={styles.pickerHeaderLeft}>
              <Text style={styles.pickerTitle}>Brush Library</Text>
              <TouchableOpacity
                onPress={() => setColorPickerVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Pick emoji by color"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ marginLeft: 8 }}
              >
                <Animated.View
                  style={{
                    transform: [{ scale: palettePulseScale }],
                    backgroundColor: 'rgba(124,108,248,0.001)',
                    borderRadius: 16,
                    padding: 3,
                  }}
                >
                  <Animated.View
                    style={{
                      position: 'absolute',
                      top: 0, left: 0, right: 0, bottom: 0,
                      borderRadius: 16,
                      backgroundColor: '#7c6cf8',
                      opacity: palettePulseOpacity,
                    }}
                  />
                  <Text style={{ fontSize: 20 }}>🎨</Text>
                </Animated.View>
              </TouchableOpacity>
              {spacingSlider ? (
                <Slider
                  style={styles.pickerSpacingSlider}
                  minimumValue={spacingSlider.minimum}
                  maximumValue={spacingSlider.maximum}
                  value={spacingSlider.value}
                  onValueChange={spacingSlider.onChange}
                  onSlidingComplete={spacingSlider.onComplete}
                  minimumTrackTintColor="#ffdc82"
                  maximumTrackTintColor="#2a2a2a"
                  thumbTintColor="#ffdc82"
                  step={0.001}
                  accessibilityLabel="Brush spacing"
                />
              ) : null}
            </View>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close emoji picker"
              hitSlop={hitSlop}
            >
              <Text style={styles.pickerCloseIcon}>❎</Text>
            </TouchableOpacity>
          </View>

          {/* Selected emoji preview with spacing display */}
          <TouchableOpacity
            style={styles.pickerSelectedRow}
            onPress={handleScrollToSelected}
            accessibilityRole="button"
            accessibilityLabel="Scroll to selected emoji"
            hitSlop={hitSlop}
          >
            <View style={dynamicStyles.selectedInfoRow}>
              <Text style={styles.pickerSelectedLabel}>Selected</Text>
              <Text style={dynamicStyles.spacingText}>spacing: {spacingDisplay}</Text>
            </View>
            <View style={styles.pickerSelectedEmojiBubble}>
              <View style={previewTransform.length > 0 ? { transform: previewTransform } : null}>
                <BrushEmojiIcon
                  emoji={brushEmoji}
                  size={30}
                  textStyle={styles.pickerSelectedEmoji}
                  imageStyle={{ backgroundColor: 'rgba(0,0,0,0.08)' }}
                />
              </View>
            </View>
          </TouchableOpacity>

          {/* Recent emojis */}
          {Array.isArray(recentEmojis) && recentEmojis.length > 0 && (
            <View style={styles.recentSection}>
              <Text style={styles.recentLabel}>Recent brushes</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentRow}
              >
                {recentEmojis.map((emoji) => {
                  const selected = emoji === brushEmoji;
                  return (
                    <TouchableOpacity
                      key={`recent-${emoji}`}
                      style={[styles.recentEmojiButton, selected && styles.recentEmojiButtonActive]}
                      onPress={() => void handleEmojiSelect(emoji)}
                      accessibilityRole="button"
                      accessibilityLabel={`Use recent emoji ${emoji}`}
                      hitSlop={hitSlop}
                    >
                      <BrushEmojiIcon
                        emoji={emoji}
                        size={24}
                        textStyle={styles.recentEmoji}
                        imageStyle={{ backgroundColor: 'rgba(0,0,0,0.08)' }}
                      />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Custom Brushes Row */}
          {visibleCustomBrushes.length > 0 && (
            <View style={styles.recentSection}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.recentLabel}>Custom brushes</Text>
                <TouchableOpacity
                  onPress={() => setCustomListVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Open custom brush list"
                  hitSlop={hitSlop}
                  style={{ paddingHorizontal: 6, paddingVertical: 2 }}
                >
                  <Text style={{ fontSize: 16 }}>📋</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentRow}
              >
                {visibleCustomBrushes.map((brush) => {
                  // Backward compatibility: handle both old emoji format and new brushPngId format
                  const brushIdentifier = brush.brushPngId || brush.emoji || '';
                  const selected = brushIdentifier === brushEmoji;
                  const isLongPressed = longPressedBrushId === brush.id;

                  return (
                    <View
                      key={`custom-${brush.id}`}
                      style={{ position: 'relative' }}
                    >
                      <TouchableOpacity
                        style={[styles.recentEmojiButton, selected && styles.recentEmojiButtonActive]}
                        onPress={() => {
                          console.log('[EmojiPicker] Selected custom brush:', brush.name, 'identifier:', brushIdentifier);
                          // Pass the identifier (brushPngId or emoji) to handleEmojiSelect
                          void handleEmojiSelect(brushIdentifier);
                        }}
                        onLongPress={() => handleCustomBrushLongPress(brush.id)}
                        delayLongPress={500}
                        accessibilityRole="button"
                        accessibilityLabel={`Use custom brush ${brush.name}`}
                        hitSlop={hitSlop}
                      >
                        <BrushEmojiIcon
                          emoji={brushIdentifier}
                          size={28}
                          textStyle={styles.recentEmoji}
                          imageStyle={{
                            borderRadius: 4,
                            backgroundColor: 'rgba(0,0,0,0.1)',
                          }}
                        />
                      </TouchableOpacity>
                      {/* Delete button appears on right side when long-pressed */}
                      {isLongPressed && (
                        <TouchableOpacity
                          style={{
                            position: 'absolute',
                            right: -32,
                            top: 0,
                            width: 30,
                            height: 30,
                            borderRadius: 15,
                            backgroundColor: '#ff4444',
                            justifyContent: 'center',
                            alignItems: 'center',
                            zIndex: 100
                          }}
                          onPress={() => handleDeleteCustomBrush(brush.id)}
                        >
                          <Text style={{ fontSize: 16, color: '#fff' }}>🗑️</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Search input */}
          <TextInput
            ref={searchInputRef}
            value={emojiSearch}
            onChangeText={onEmojiSearchChange}
            onFocus={() => {
              // Auto-select all text when focusing
              searchInputRef.current?.setNativeProps({
                selection: { start: 0, end: emojiSearch.length }
              });
            }}
            placeholder={placeholderText}
            placeholderTextColor={colors.textSecondary}
            style={[styles.pickerSearch, { fontFamily: 'vrtlfinal' }]}
            accessibilityLabel="Search emoji"
            selectTextOnFocus={true}
          />

          {/* Transform controls */}
          <View style={styles.pickerFlipRow}>
            <TouchableOpacity
              style={[styles.pickerFlipButton, brushEmoji === '' && styles.pickerFlipButtonActive]}
              onPress={() => void handleEmojiSelect('')}
              accessibilityRole="button"
              accessibilityLabel="Set transparent brush"
              hitSlop={hitSlop}
            >
              <Text style={[styles.pickerFlipEmoji, brushEmoji === '' && styles.pickerFlipEmojiActive]}>
                {brushEmoji === '' ? '1️⃣' : '💯'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pickerFlipButton, mirrorX && styles.pickerFlipButtonActive]}
              onPress={onToggleMirrorX}
              accessibilityRole="button"
              accessibilityLabel={mirrorX ? 'Disable horizontal flip' : 'Enable horizontal flip'}
              hitSlop={hitSlop}
            >
              <Text style={[styles.pickerFlipEmoji, mirrorX && styles.pickerFlipEmojiActive]}>↔️</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pickerFlipButton, mirrorY && styles.pickerFlipButtonActive]}
              onPress={onToggleMirrorY}
              accessibilityRole="button"
              accessibilityLabel={mirrorY ? 'Disable vertical flip' : 'Enable vertical flip'}
              hitSlop={hitSlop}
            >
              <Text style={[styles.pickerFlipEmoji, mirrorY && styles.pickerFlipEmojiActive]}>↕️</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickerFlipButton}
              onPress={onTurnLeft}
              accessibilityRole="button"
              accessibilityLabel="Rotate brush left"
              hitSlop={hitSlop}
            >
              <Text style={styles.pickerFlipEmoji}>⟲</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.pickerFlipButton,
                autoRotateEnabled && { backgroundColor: '#4ade80' }
              ]}
              onPress={onTurnRight}
              onLongPress={onTurnRightLongPress}
              delayLongPress={600}
              accessibilityRole="button"
              accessibilityLabel="Rotate brush right"
              hitSlop={hitSlop}
            >
              <Text style={[styles.pickerFlipEmoji, autoRotateEnabled && styles.pickerFlipEmojiActive]}>⟳</Text>
            </TouchableOpacity>
          </View>

          {/* Optimized FlatList - dynamic zoom on iPad, fixed on iPhone */}
          {IS_IPAD ? (
            <PinchGestureHandler
              onGestureEvent={onPinchGestureEvent}
              onHandlerStateChange={onPinchGestureEvent}
            >
              <View style={{ flex: 1 }}>
                <FlatList
                  ref={flatListRef}
                  data={emojiRows}
                  keyExtractor={keyExtractor}
                  renderItem={renderRow}
                  initialNumToRender={15}
                  maxToRenderPerBatch={20}
                  updateCellsBatchingPeriod={50}
                  removeClippedSubviews={true}
                  windowSize={11}
                  getItemLayout={getItemLayout}
                  onScrollToIndexFailed={handleScrollToIndexFailed}
                  showsVerticalScrollIndicator={true}
                  indicatorStyle="white"
                  contentContainerStyle={dynamicStyles.listContent}
                  keyboardShouldPersistTaps="handled"
                />
              </View>
            </PinchGestureHandler>
          ) : (
            <FlatList
              ref={flatListRef}
              data={emojiRows}
              keyExtractor={keyExtractor}
              renderItem={renderRow}
              initialNumToRender={15}
              maxToRenderPerBatch={20}
              updateCellsBatchingPeriod={50}
              removeClippedSubviews={true}
              windowSize={11}
              getItemLayout={getItemLayout}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              showsVerticalScrollIndicator={true}
              indicatorStyle="white"
              contentContainerStyle={dynamicStyles.listContent}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {/* Color Engine overlay — alternative pick-by-color mode */}
          <EmojiColorPickerOverlay
            visible={colorPickerVisible}
            brushEmoji={brushEmoji}
            onSelectEmoji={(emoji) => void handleEmojiSelect(emoji)}
            onClose={() => setColorPickerVisible(false)}
          />
        </Animated.View>

        {customListVisible && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 16
            }}
          >
            <View
              style={{
                width: IS_IPAD ? 520 : '92%',
                maxHeight: '80%',
                backgroundColor: '#121212',
                borderRadius: 12,
                padding: 16,
                borderWidth: 1,
                borderColor: '#2a2a2a'
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Custom Brushes</Text>
                <TouchableOpacity
                  onPress={() => setCustomListVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close custom brush list"
                >
                  <Text style={{ fontSize: 20 }}>❎</Text>
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator>
                {visibleCustomBrushes.map((brush) => {
                  const brushIdentifier = brush.brushPngId || brush.emoji || '';
                  return (
                    <View
                      key={`custom-list-${brush.id}`}
                      style={{
                        marginBottom: 16,
                        paddingBottom: 16,
                        borderBottomWidth: 1,
                        borderBottomColor: '#222'
                      }}
                    >
                      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                        <BrushEmojiIcon
                          emoji={brushIdentifier}
                          size={96}
                          textStyle={{ fontSize: 96 }}
                          imageStyle={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
                            {brush.name || 'Custom brush'}
                          </Text>
                          <Text style={{ color: '#aaa', fontSize: 12, marginTop: 4 }}>
                            Size {Math.round(brush.size)} · Opacity {Math.round(brush.opacity * 100)}% · Spacing {brush.spacing?.toFixed(3)}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                        <TouchableOpacity
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 8,
                            backgroundColor: '#2f7fff',
                            alignItems: 'center'
                          }}
                          onPress={() => void handleEmojiSelect(brushIdentifier)}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700' }}>Use Brush</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 8,
                            backgroundColor: '#4ade80',
                            alignItems: 'center'
                          }}
                          onPress={() => {
                            if (onLoadCustomBrushToWorkspace) {
                              onLoadCustomBrushToWorkspace(brushIdentifier);
                            } else {
                              void handleEmojiSelect(brushIdentifier);
                            }
                          }}
                        >
                          <Text style={{ color: '#0b1b10', fontWeight: '700' }}>Load to Workspace</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                            backgroundColor: '#ef4444',
                            alignItems: 'center'
                          }}
                          onPress={() => handleDeleteCustomBrush(brush.id)}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700' }}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};

export default EmojiPickerModal;
