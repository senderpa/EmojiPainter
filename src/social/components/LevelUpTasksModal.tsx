import React from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import type { ProfileLevelAchievementStatus } from '../../lib/profileLevelAchievements';
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
  achievements: ProfileLevelAchievementStatus[];
  onClose: () => void;
};

const LevelUpTasksModal: React.FC<Props> = ({ visible, achievements, onClose }) => (
  <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Level Tasks</Text>
            <Text style={styles.subtitle}>Each completed task adds one bonus level</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <FlatList
          data={achievements}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={[styles.row, item.completed && styles.rowDone]}>
              <View style={styles.iconSlot}>
                <AnimatedLevelEmoji
                  source={getProfileLevelEmojiSource(item.iconLevel)}
                  fallbackSource={getProfileLevelEmojiFallbackSource(item.iconLevel)}
                  companionSource={getProfileLevelCompanionEmojiSource(item.iconLevel)}
                  companionFallbackSource={getProfileLevelCompanionEmojiFallbackSource(item.iconLevel)}
                  companionSources={getProfileLevelCompanionEmojiSources(item.iconLevel)}
                  companionFallbackSources={getProfileLevelCompanionEmojiFallbackSources(item.iconLevel)}
                  fallbackEmoji={item.emoji}
                  size={42}
                  dimmed={!item.completed}
                  animate={item.completed}
                />
              </View>
              <View style={styles.body}>
                <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.requirement}>{item.requirement}</Text>
              </View>
              <View style={[styles.statePill, item.completed && styles.statePillDone]}>
                <Text style={styles.stateText}>{item.completed ? '+1' : 'LOCK'}</Text>
              </View>
            </View>
          )}
        />
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
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
  list: { paddingBottom: 28, gap: 8 },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#171717',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2b2b2b',
  },
  rowDone: {
    backgroundColor: '#131c16',
    borderColor: '#2b6b3d',
  },
  iconSlot: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  itemTitle: { color: '#fff', fontSize: 13, fontWeight: '900' },
  requirement: { color: '#a9a9ad', fontSize: 11, lineHeight: 15, marginTop: 3, fontWeight: '600' },
  statePill: {
    width: 44,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#282828',
  },
  statePillDone: { backgroundColor: '#1f8f45' },
  stateText: { color: '#fff', fontSize: 10, fontWeight: '900' },
});

export default LevelUpTasksModal;
