/**
 * Custom Brush Row Component
 * Displays horizontally scrollable row of saved custom brushes
 * Similar to "Recent Brushes" row but for user-created custom emojis
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, Alert, Animated } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import { CustomBrush, getCustomBrushes, deleteCustomBrush } from '../lib/customBrushes';
import BrushEmojiIcon from '../components/BrushEmojiIcon';
import { CustomOverlayHelper } from '../components/CustomOverlay';

interface CustomBrushRowProps {
  onSelectBrush: (brush: CustomBrush) => void;
  selectedBrushId?: string;
  onRefresh?: () => void;
}

const BRUSH_CELL_SIZE = 56;
const SPACING = 8;

/**
 * Individual custom brush cell
 */
const CustomBrushCell: React.FC<{
  brush: CustomBrush;
  isSelected: boolean;
  onPress: (brush: CustomBrush) => void;
  onLongPress?: (brush: CustomBrush) => void;
}> = ({ brush, isSelected, onPress, onLongPress }) => {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.cellContainer,
        {
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <TouchableOpacity
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => onPress(brush)}
        onLongPress={() => onLongPress?.(brush)}
        delayLongPress={500}
        style={[
          styles.cellContent,
          isSelected && styles.cellSelected,
        ]}
      >
        <BrushEmojiIcon
          emoji={brush.brushPngId || brush.emoji || ''}
          size={BRUSH_CELL_SIZE - 20}
          textStyle={styles.brushEmoji}
          imageStyle={styles.brushImage}
        />
      </TouchableOpacity>

      {/* Optional: Show brush name or settings on long press */}
      {brush.name && (
        <Text style={styles.brushName} numberOfLines={1}>
          {brush.name}
        </Text>
      )}
    </Animated.View>
  );
};

/**
 * Main custom brush row component
 */
const CustomBrushRow: React.FC<CustomBrushRowProps> = ({
  onSelectBrush,
  selectedBrushId,
  onRefresh,
}) => {
  const [brushes, setBrushes] = useState<CustomBrush[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollViewRef = React.useRef<ScrollView>(null);

  // Load custom brushes on mount
  useEffect(() => {
    loadBrushes();
  }, []);

  // Listen for refresh events
  useEffect(() => {
    const loadBrushesAsync = async () => {
      await loadBrushes();
    };
    if (onRefresh) {
      loadBrushesAsync();
    }
  }, [onRefresh]);

  const loadBrushes = useCallback(async () => {
    try {
      setIsLoading(true);
      const savedBrushes = await getCustomBrushes();
      // Sort by most recently saved first
      savedBrushes.sort((a, b) => b.savedAt - a.savedAt);
      setBrushes(savedBrushes);
    } catch (error) {
      console.error('Failed to load custom brushes:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSelectBrush = useCallback((brush: CustomBrush) => {
    onSelectBrush(brush);
  }, [onSelectBrush]);

  const handleDeleteBrush = useCallback((brush: CustomBrush) => {
    CustomOverlayHelper.delete(
      'Delete Custom Brush',
      `Remove "${brush.name || 'Custom brush'}" from your collection?`,
      async () => {
        const success = await deleteCustomBrush(brush.id);
        if (success) await loadBrushes();
      }
    );
  }, [loadBrushes]);

  // Don't render if no custom brushes
  if (brushes.length === 0 || isLoading) {
    return null;
  }

  return (
    <View style={[styles.container, { pointerEvents: 'auto' }]}>
      <View style={[styles.header, { pointerEvents: 'auto' }]}>
        <MaterialIcons name="brush" size={16} color="#666" />
        <Text style={styles.headerText}>Custom Brushes</Text>
      </View>

      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.scrollView, { pointerEvents: 'auto' }]}
        contentContainerStyle={styles.scrollContent}
        pointerEvents="auto"
      >
        {brushes.map((brush) => (
          <CustomBrushCell
            key={brush.id}
            brush={brush}
            isSelected={selectedBrushId === brush.id}
            onPress={handleSelectBrush}
            onLongPress={handleDeleteBrush}
          />
        ))}

        {/* Add button to open custom brush manager */}
        <TouchableOpacity
          style={[styles.cellContainer, styles.addButton]}
          onPress={loadBrushes}
        >
          <View style={styles.addButtonContent}>
            <MaterialIcons name="refresh" size={24} color="#999" />
          </View>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 6,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scrollView: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: SPACING,
    gap: SPACING,
  },
  cellContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellContent: {
    width: BRUSH_CELL_SIZE,
    height: BRUSH_CELL_SIZE,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  cellSelected: {
    borderColor: '#FF6B6B',
    backgroundColor: '#fff0f0',
  },
  brushEmoji: {
    fontSize: 32,
  },
  brushImage: {
    width: BRUSH_CELL_SIZE - 4,
    height: BRUSH_CELL_SIZE - 4,
    borderRadius: 10,
  },
  brushName: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
    maxWidth: BRUSH_CELL_SIZE,
    textAlign: 'center',
  },
  addButton: {
    marginLeft: SPACING,
  },
  addButtonContent: {
    width: BRUSH_CELL_SIZE,
    height: BRUSH_CELL_SIZE,
    borderRadius: 12,
    backgroundColor: '#f9f9f9',
    borderWidth: 2,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default CustomBrushRow;
