import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import { PROFILE_LEVEL_CATALOG } from '../../lib/profileLevelCatalog';
import { PROFILE_LEVELS, PROFILE_LEVEL_XP_WEIGHTS } from '../../lib/profileStats';
import {
  getProfileLevelCompanionEmojiFallbackSource,
  getProfileLevelCompanionEmojiFallbackSources,
  getProfileLevelCompanionEmojiSource,
  getProfileLevelCompanionEmojiSources,
  getProfileLevelEmojiFallbackSource,
  getProfileLevelEmojiSource,
} from '../../lib/profileLevelEmojiAssets';
import AnimatedLevelEmoji from './AnimatedLevelEmoji';

type Props = {
  visible: boolean;
  currentLevel: number;
  nextLevel: number | null;
  onClose: () => void;
};

const LockedLevelCell: React.FC<{
  level: (typeof PROFILE_LEVEL_CATALOG)[number];
  earned: boolean;
  next: boolean;
  onPress: () => void;
}> = ({ level, earned, next, onPress }) => {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.cell, next && styles.nextCell]}>
      <View style={styles.emojiWrap}>
        <AnimatedLevelEmoji
          source={getProfileLevelEmojiSource(level.id)}
          fallbackSource={getProfileLevelEmojiFallbackSource(level.id)}
          companionSource={getProfileLevelCompanionEmojiSource(level.id)}
          companionFallbackSource={getProfileLevelCompanionEmojiFallbackSource(level.id)}
          companionSources={getProfileLevelCompanionEmojiSources(level.id)}
          companionFallbackSources={getProfileLevelCompanionEmojiFallbackSources(level.id)}
          fallbackEmoji={level.emoji}
          size={46}
          dimmed={!earned}
          animate
        />
        {!earned ? (
          <View style={styles.lockBadge}>
            <Text style={styles.lockText}>🔒</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.cellLevel, earned && styles.cellLevelEarned]}>Level {level.id}</Text>
      <Text style={styles.cellName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {level.name}
      </Text>
    </TouchableOpacity>
  );
};

const formatLevelInfo = (levelId: number): string => {
  const level = PROFILE_LEVELS[levelId - 1];
  if (!level || level.id <= 1) {
    return 'Starting rank. Begin painting to unlock the next badge.';
  }
  const coins = Math.max(1, Math.ceil(level.minXp / PROFILE_LEVEL_XP_WEIGHTS.coin));
  const minutes = Math.max(1, Math.ceil(level.minXp / PROFILE_LEVEL_XP_WEIGHTS.paintingMinute));
  const strokes = Math.max(1, Math.ceil(level.minXp / PROFILE_LEVEL_XP_WEIGHTS.stroke));
  const gate = level.requiredStreakDays
    ? ` Daily streak gate: ${level.requiredStreakDays} days.`
    : '';
  const egg = level.id === 99
    ? ' Level 99 reveals the hidden egg hint for Level 100.'
    : '';
  return `Examples to reach this level: ${coins.toLocaleString()} coins, ${minutes.toLocaleString()} painting minutes, or ${strokes.toLocaleString()} strokes. Mixed progress counts too.${gate}${egg}`;
};

const LevelEmojiGalleryModal: React.FC<Props> = ({ visible, currentLevel, nextLevel, onClose }) => {
  const [selectedLevelId, setSelectedLevelId] = useState<number | null>(null);
  const selectedLevel = useMemo(
    () => PROFILE_LEVEL_CATALOG.find(level => level.id === selectedLevelId) ?? null,
    [selectedLevelId]
  );
  const selectedEarned = selectedLevel ? selectedLevel.id <= currentLevel : false;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>All 99 Levels</Text>
              <Text style={styles.subtitle}>Tap any badge for animation and details</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <FlatList
            data={PROFILE_LEVEL_CATALOG}
            keyExtractor={(item) => String(item.id)}
            numColumns={3}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.row}
            showsVerticalScrollIndicator={false}
            initialNumToRender={18}
            windowSize={7}
            renderItem={({ item }) => (
              <LockedLevelCell
                level={item}
                earned={item.id <= currentLevel}
                next={nextLevel === item.id}
                onPress={() => setSelectedLevelId(item.id)}
              />
            )}
          />
        </View>

        {selectedLevel ? (
          <Pressable style={styles.detailOverlay} onPress={() => setSelectedLevelId(null)}>
            <Pressable style={styles.detailCard}>
              <View style={styles.detailEmojiWrap}>
                <AnimatedLevelEmoji
                  source={getProfileLevelEmojiSource(selectedLevel.id)}
                  fallbackSource={getProfileLevelEmojiFallbackSource(selectedLevel.id)}
                  companionSource={getProfileLevelCompanionEmojiSource(selectedLevel.id)}
                  companionFallbackSource={getProfileLevelCompanionEmojiFallbackSource(selectedLevel.id)}
                  companionSources={getProfileLevelCompanionEmojiSources(selectedLevel.id)}
                  companionFallbackSources={getProfileLevelCompanionEmojiFallbackSources(selectedLevel.id)}
                  fallbackEmoji={selectedLevel.emoji}
                  size={150}
                  dimmed={!selectedEarned}
                  animate
                />
              </View>
              <Text style={[styles.detailStatus, selectedEarned && styles.detailStatusEarned]}>
                {selectedEarned ? 'Unlocked' : 'Locked'}
              </Text>
              <Text style={styles.detailLevel}>Level {selectedLevel.id}</Text>
              <Text style={styles.detailName}>{selectedLevel.name}</Text>
              <Text style={styles.detailInfo}>{formatLevelInfo(selectedLevel.id)}</Text>
              {nextLevel === selectedLevel.id ? (
                <Text style={styles.detailNext}>This is your next badge.</Text>
              ) : null}
              <TouchableOpacity style={styles.detailCloseButton} onPress={() => setSelectedLevelId(null)} activeOpacity={0.85}>
                <Text style={styles.detailCloseText}>Close</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '86%',
    backgroundColor: '#101010',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 18,
    paddingHorizontal: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#8e8e92', fontSize: 12, marginTop: 2 },
  close: { color: '#fff', fontSize: 24, fontWeight: '800', paddingHorizontal: 6 },
  grid: { paddingBottom: 28 },
  row: { gap: 8 },
  cell: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#171717',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginBottom: 8,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2b2b2b',
  },
  nextCell: {
    borderColor: '#ffdc82',
    backgroundColor: '#1d1a12',
  },
  emojiWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    position: 'absolute',
    right: -3,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockText: { fontSize: 12 },
  cellLevel: { color: '#666', fontSize: 11, fontWeight: '900', marginTop: 4 },
  cellLevelEarned: { color: '#82ffa1' },
  cellName: { color: '#d8d8d8', fontSize: 10, fontWeight: '700', marginTop: 2 },
  detailOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  detailCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    backgroundColor: '#171717',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a3a3a',
    padding: 20,
    alignItems: 'center',
  },
  detailEmojiWrap: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  detailStatus: { color: '#ffdc82', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  detailStatusEarned: { color: '#82ffa1' },
  detailLevel: { color: '#fff', fontSize: 15, fontWeight: '900', marginTop: 6 },
  detailName: { color: '#fff', fontSize: 22, lineHeight: 27, fontWeight: '900', marginTop: 4, textAlign: 'center' },
  detailInfo: { color: '#c8c8c8', fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: 'center' },
  detailNext: { color: '#ffdc82', fontSize: 12, fontWeight: '800', marginTop: 10 },
  detailCloseButton: {
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: '#252525',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#4a4a4a',
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  detailCloseText: { color: '#fff', fontSize: 13, fontWeight: '900' },
});

export default LevelEmojiGalleryModal;
