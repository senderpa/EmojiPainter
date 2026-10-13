/**
 * GESSER FEATURE - Friends List Screen
 *
 * Mutual friends: two passport portraits with animated dotted line + both names.
 * One-way friends: single portrait + name + Following label.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Alert, FlatList, Image, Animated, Easing } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import GesserApi from '../api/gesserClient';
import type { GesserFriend } from '../types';
import { getGesserCopy } from '../gesserTranslations';

interface FriendsListScreenProps {
  visible: boolean;
  onClose: () => void;
  deviceId: string;
  language?: string;
}

type FriendWithMutual = GesserFriend & { mutual: boolean };

// ── Animated dotted line ──────────────────────────────────────────────────────

const DOT_COUNT = 7;

const AnimatedDottedLine: React.FC = () => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <View style={dotStyles.container}>
      {Array.from({ length: DOT_COUNT }).map((_, i) => {
        const phase = i / DOT_COUNT;
        const opacity = progress.interpolate({
          inputRange: [
            Math.max(0, phase - 0.15),
            phase,
            Math.min(1, phase + 0.15),
          ],
          outputRange: [0.15, 1, 0.15],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View key={i} style={[dotStyles.dot, { opacity }]} />
        );
      })}
    </View>
  );
};

const dotStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ff9f6b',
  },
});

// ── Portrait circle ───────────────────────────────────────────────────────────

const PortraitCircle: React.FC<{
  uri?: string | null;
  size: number;
  borderColor?: string;
}> = ({ uri, size, borderColor = '#ff9f6b' }) => {
  const style: any = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: '#222',
    borderWidth: 2.5,
    borderColor,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (uri) {
    return (
      <View style={style}>
        <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
      </View>
    );
  }

  return (
    <View style={style}>
      <Text style={{ fontSize: size * 0.45 }}>👤</Text>
    </View>
  );
};

// ── Mutual card ───────────────────────────────────────────────────────────────

const MutualCard: React.FC<{
  friend: FriendWithMutual;
  ownPortrait?: string | null;
  ownName: string;
  onRemove: () => void;
}> = ({ friend, ownPortrait, ownName, onRemove }) => (
  <View style={cardStyles.mutualCard}>
    <View style={cardStyles.mutualPortraitRow}>
      <View style={cardStyles.mutualSide}>
        <PortraitCircle uri={ownPortrait} size={56} borderColor="#ff9f6b" />
        <Text style={cardStyles.mutualName} numberOfLines={1}>{ownName || 'You'}</Text>
      </View>

      <AnimatedDottedLine />

      <View style={cardStyles.mutualSide}>
        <PortraitCircle uri={friend.portrait} size={56} borderColor="#ff9f6b" />
        <Text style={cardStyles.mutualName} numberOfLines={1}>{friend.name || '?'}</Text>
      </View>
    </View>

    <View style={cardStyles.mutualFooter}>
      <View style={cardStyles.mutualBadge}>
        <Text style={cardStyles.mutualBadgeText}>🤝 Mutual</Text>
      </View>
      <TouchableOpacity style={cardStyles.removeBtn} onPress={onRemove}>
        <Text style={cardStyles.removeBtnText}>Remove</Text>
      </TouchableOpacity>
    </View>
  </View>
);

// ── One-way card ──────────────────────────────────────────────────────────────

const OneWayCard: React.FC<{
  friend: FriendWithMutual;
  onRemove: () => void;
}> = ({ friend, onRemove }) => (
  <View style={cardStyles.oneWayCard}>
    <PortraitCircle uri={friend.portrait} size={52} borderColor="#555" />
    <View style={cardStyles.oneWayInfo}>
      <Text style={cardStyles.oneWayName} numberOfLines={1}>{friend.name || '?'}</Text>
      <Text style={cardStyles.oneWayFollowing}>Following</Text>
    </View>
    <TouchableOpacity style={cardStyles.removeBtn} onPress={onRemove}>
      <Text style={cardStyles.removeBtnText}>Remove</Text>
    </TouchableOpacity>
  </View>
);

const cardStyles = StyleSheet.create({
  mutualCard: {
    backgroundColor: 'rgba(255,159,107,0.07)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,159,107,0.45)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  mutualPortraitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutualSide: {
    alignItems: 'center',
    width: 72,
  },
  mutualName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
    maxWidth: 72,
  },
  mutualFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  mutualBadge: {
    backgroundColor: 'rgba(255,159,107,0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  mutualBadgeText: {
    color: '#ff9f6b',
    fontSize: 12,
    fontWeight: 'bold',
  },
  oneWayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  oneWayInfo: {
    flex: 1,
  },
  oneWayName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 3,
  },
  oneWayFollowing: {
    color: '#777',
    fontSize: 12,
  },
  removeBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#d44',
  },
  removeBtnText: {
    color: '#d44',
    fontSize: 13,
    fontWeight: '600',
  },
});

// ── Main screen ───────────────────────────────────────────────────────────────

const BATCH = 3;

const FriendsListScreen: React.FC<FriendsListScreenProps> = ({
  visible,
  onClose,
  deviceId,
  language,
}) => {
  const insets = useSafeAreaInsets();
  const t = getGesserCopy(language);

  const [loading, setLoading] = useState(false);
  const [friends, setFriends] = useState<FriendWithMutual[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // own portrait/name from profile — best effort from loaded friends reciprocal data; we rely on displayName below
  const loadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (visible) {
      const controller = new AbortController();
      loadAbortRef.current = controller;
      void loadFriends(controller.signal);
      return () => { controller.abort(); };
    }
  }, [visible]);

  const checkMutual = async (
    myDeviceId: string,
    baseFriends: GesserFriend[],
    signal?: AbortSignal
  ): Promise<FriendWithMutual[]> => {
    const results: FriendWithMutual[] = [];
    for (let i = 0; i < baseFriends.length; i += BATCH) {
      if (signal?.aborted) break;
      const batch = baseFriends.slice(i, i + BATCH);
      const checks = await Promise.allSettled(
        batch.map(f =>
          GesserApi.listFriends(f.deviceId)
            .then(res => res.friends.some(ff => ff.deviceId === myDeviceId))
            .catch(() => false)
        )
      );
      batch.forEach((f, idx) => {
        const mutual = checks[idx].status === 'fulfilled' ? (checks[idx] as PromiseFulfilledResult<boolean>).value : false;
        results.push({ ...f, mutual });
      });
    }
    return results;
  };

  const loadFriends = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await GesserApi.listFriends(deviceId);
      if (signal?.aborted) return;
      const withMutual = await checkMutual(deviceId, res.friends, signal);
      if (signal?.aborted) return;
      // mutual first, then one-way, both alphabetically
      const sorted = [...withMutual].sort((a, b) => {
        if (a.mutual !== b.mutual) return a.mutual ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      setFriends(sorted);
    } catch (error: any) {
      if (error.name === 'AbortError' || signal?.aborted) return;
      Alert.alert(t.errorTitle, error.message || t.removeFriendErrorLoad);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const handleRefresh = useCallback(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setRefreshing(true);
    void loadFriends(controller.signal);
  }, []);

  const handleRemoveFriend = (friend: FriendWithMutual) => {
    Alert.alert(
      t.removeFriendTitle,
      t.removeFriendMsg.replace('{name}', friend.name),
      [
        { text: t.cancelButton, style: 'cancel' },
        {
          text: t.removeButton,
          style: 'destructive',
          onPress: async () => {
            try {
              await GesserApi.removeFriend(deviceId, friend.deviceId);
              setFriends(prev => prev.filter(f => f.deviceId !== friend.deviceId));
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error: any) {
              Alert.alert(t.errorTitle, error.message || t.removeFriendErrorRemove);
            }
          },
        },
      ]
    );
  };

  const mutualCount = friends.filter(f => f.mutual).length;
  const followingCount = friends.filter(f => !f.mutual).length;

  const renderItem = ({ item }: { item: FriendWithMutual }) => {
    if (item.mutual) {
      return (
        <MutualCard
          friend={item}
          ownPortrait={undefined}
          ownName="You"
          onRemove={() => handleRemoveFriend(item)}
        />
      );
    }
    return (
      <OneWayCard
        friend={item}
        onRemove={() => handleRemoveFriend(item)}
      />
    );
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t.friendsTitle}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading && friends.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#ff9f6b" />
            <Text style={styles.loadingText}>Loading friends…</Text>
          </View>
        ) : (
          <FlatList
            data={friends}
            keyExtractor={item => item.deviceId}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            ListHeaderComponent={
              friends.length > 0 ? (
                <View style={styles.summaryRow}>
                  {mutualCount > 0 && (
                    <View style={styles.summaryChip}>
                      <Text style={styles.summaryChipText}>🤝 {mutualCount} Mutual</Text>
                    </View>
                  )}
                  {followingCount > 0 && (
                    <View style={[styles.summaryChip, styles.summaryChipGrey]}>
                      <Text style={[styles.summaryChipText, { color: '#aaa' }]}>➜ {followingCount} Following</Text>
                    </View>
                  )}
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>👥</Text>
                <Text style={styles.emptyText}>{t.noFriendsTitle}</Text>
                <Text style={styles.emptyHint}>{t.noFriendsHint}</Text>
              </View>
            }
          />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,159,107,0.3)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ff9f6b',
  },
  closeButton: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#222',
    borderRadius: 19,
  },
  closeButtonText: {
    fontSize: 18,
    color: '#fff',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  summaryChip: {
    backgroundColor: 'rgba(255,159,107,0.15)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,159,107,0.35)',
  },
  summaryChipGrey: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: '#333',
  },
  summaryChipText: {
    color: '#ff9f6b',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    padding: 20,
    paddingTop: 18,
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#ff9f6b',
    marginTop: 16,
    fontSize: 15,
  },
  emptyContainer: {
    paddingVertical: 70,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: 18,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 8,
  },
  emptyHint: {
    color: '#555',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});

export default FriendsListScreen;
