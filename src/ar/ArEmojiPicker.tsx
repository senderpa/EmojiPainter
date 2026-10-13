/**
 * ArEmojiPicker — instant inline emoji picker for the AR workspace.
 *
 * The main EmojiPickerModal is an RN Modal; presenting a nested modal on top
 * of the AR modal causes the slow "open main → picker → back" transition the
 * user noticed. This clone renders as a plain absolute-fill overlay INSIDE
 * the AR workspace — it appears/disappears instantly and stays mounted, so
 * the emoji grid doesn't re-build on every open.
 *
 * Like the main workspace's Brush Library, this embeds the Color-Engine ring as
 * a 🎨 toggle in the header — tap it to switch between the normal search grid
 * and the colour-wheel picker, all without leaving the AR workspace.
 */
import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Keyboard, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import * as Haptics from 'expo-haptics';

import type { EmojiEntry } from '../lib/emojiCatalog';
import { renderableEmojiEntries, searchRenderableEmojis } from '../lib/emojiCatalog';
import EmojiColorPickerOverlay from '../workspace/EmojiColorPickerOverlay';

interface ArEmojiPickerProps {
  visible: boolean;
  brushEmoji: string;
  recentEmojis: string[];
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
}

const COLUMNS = 8;
const CELL_SIZE = 44;

const EmojiCell = memo<{
  emoji: string;
  selected: boolean;
  onPress: () => void;
}>(({ emoji, selected, onPress }) => (
  <TouchableOpacity
    style={[styles.cell, selected && styles.cellSelected]}
    onPress={onPress}
    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    accessibilityRole="button"
    accessibilityLabel={`Use emoji ${emoji}`}
  >
    <Text style={styles.cellEmoji}>{emoji}</Text>
  </TouchableOpacity>
));

EmojiCell.displayName = 'ArEmojiCell';

const ArEmojiPicker: React.FC<ArEmojiPickerProps> = ({
  visible,
  brushEmoji,
  recentEmojis,
  onSelectEmoji,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const [colorPickerVisible, setColorPickerVisible] = useState(false);

  const entries = useMemo(
    () => (search.trim().length > 0 ? searchRenderableEmojis(search) : renderableEmojiEntries),
    [search]
  );

  // Chunk into rows so FlatList virtualizes row-by-row (same trick as the main picker)
  const rows = useMemo(() => {
    const result: EmojiEntry[][] = [];
    for (let i = 0; i < entries.length; i += COLUMNS) {
      result.push(entries.slice(i, i + COLUMNS));
    }
    return result;
  }, [entries]);

  const handleSelect = useCallback(
    (emoji: string) => {
      void Haptics.selectionAsync();
      Keyboard.dismiss();
      setSearch('');
      onSelectEmoji(emoji);
      onClose();
    },
    [onClose, onSelectEmoji]
  );

  const renderRow = useCallback(
    ({ item: row }: { item: EmojiEntry[] }) => (
      <View style={styles.row}>
        {row.map((entry) => (
          <EmojiCell
            key={entry.emoji}
            emoji={entry.emoji}
            selected={entry.emoji === brushEmoji}
            onPress={() => handleSelect(entry.emoji)}
          />
        ))}
      </View>
    ),
    [brushEmoji, handleSelect]
  );

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Brush Library</Text>
        {/* 🎨 toggle → Color-Engine ring (same as the main workspace) */}
        <TouchableOpacity
          style={styles.colorToggle}
          onPress={() => { void Haptics.selectionAsync(); setColorPickerVisible(true); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Pick emoji by color"
        >
          <Text style={{ fontSize: 22 }}>🎨</Text>
        </TouchableOpacity>
        <View style={styles.selectedBubble}>
          <Text style={{ fontSize: 24 }}>{brushEmoji || '🙂'}</Text>
        </View>
        <TouchableOpacity
          onPress={() => { Keyboard.dismiss(); setSearch(''); onClose(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Close emoji picker"
        >
          <Text style={styles.closeIcon}>❎</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search emojis…"
        placeholderTextColor="#555"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />

      {/* Recent brushes */}
      {recentEmojis.length > 0 && (
        <View style={styles.recentRow}>
          {recentEmojis.slice(0, 8).map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={[styles.recentButton, emoji === brushEmoji && styles.cellSelected]}
              onPress={() => handleSelect(emoji)}
            >
              <Text style={{ fontSize: 20 }}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Emoji grid */}
      <FlatList
        data={rows}
        keyExtractor={(row) => row[0]?.emoji ?? 'row'}
        renderItem={renderRow}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        indicatorStyle="white"
        contentContainerStyle={styles.gridContent}
      />

      {/* Color-Engine ring overlay — same component the main workspace uses.
          Picking here selects the brush and closes the whole picker. */}
      <EmojiColorPickerOverlay
        visible={colorPickerVisible}
        brushEmoji={brushEmoji}
        onSelectEmoji={handleSelect}
        onClose={() => setColorPickerVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#111111',
    zIndex: 500,
    paddingTop: 52,
    paddingHorizontal: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', flex: 1 },
  colorToggle: {
    backgroundColor: '#2d2d2d',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  selectedBubble: {
    backgroundColor: '#2d2d2d',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  closeIcon: { color: '#fff', fontSize: 24, fontWeight: '700' },
  search: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#fff',
    marginBottom: 10,
  },
  recentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  recentButton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  row: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: { backgroundColor: '#ffdc82' },
  cellEmoji: { fontSize: 26 },
  gridContent: { paddingBottom: 30 },
});

export default ArEmojiPicker;
