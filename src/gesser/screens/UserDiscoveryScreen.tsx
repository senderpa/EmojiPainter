/**
 * GESSER FEATURE - User Discovery Screen
 *
 * World user list with search and friend management.
 * Features:
 * - Search users by name
 * - Add/remove friends
 * - Pagination support
 * - Prominent user profiles (name + portrait)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, TextInput, ActivityIndicator, Alert, FlatList, Image } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import GesserApi from '../api/gesserClient';
import type { GesserUser } from '../types';
import { getGesserCopy } from '../gesserTranslations';

interface UserDiscoveryScreenProps {
  visible: boolean;
  onClose: () => void;
  deviceId: string;
  language?: string;
}

const UserDiscoveryScreen: React.FC<UserDiscoveryScreenProps> = ({
  visible,
  onClose,
  deviceId,
  language
}) => {
  const insets = useSafeAreaInsets();
  const t = getGesserCopy(language);

  // State
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<GesserUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Abort controller ref so manual calls (search, refresh, load-more) can be cancelled
  const loadAbortRef = React.useRef<AbortController | null>(null);

  // Load users when screen opens
  useEffect(() => {
    if (visible) {
      const controller = new AbortController();
      loadAbortRef.current = controller;
      loadUsers(1, '', controller.signal);
      return () => { controller.abort(); };
    } else {
      // Reset on close
      setUsers([]);
      setSearchQuery('');
      setCurrentPage(1);
      setHasMore(true);
    }
  }, [visible]);

  const loadUsers = async (page: number, search: string, signal?: AbortSignal) => {
    if (page === 1) {
      setLoading(true);
    }

    try {
      const response = await GesserApi.discoverUsers(deviceId, search, page);
      if (signal?.aborted) return;

      const incoming = Array.isArray(response?.users) ? response.users : [];
      if (page === 1) {
        setUsers(incoming);
      } else {
        setUsers(prev => [...prev, ...incoming]);
      }

      setHasMore(!!response?.hasMore);
      setCurrentPage(page);
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      console.error('[Gesser] Failed to load users:', error);
      Alert.alert(t.errorTitle, error.message || t.discoverErrorLoad);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const handleSearch = useCallback(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    loadUsers(1, searchQuery, controller.signal);
  }, [searchQuery]);

  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) {
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      loadUsers(currentPage + 1, searchQuery, controller.signal);
    }
  }, [loading, hasMore, currentPage, searchQuery]);

  const handleRefresh = useCallback(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setRefreshing(true);
    loadUsers(1, searchQuery, controller.signal);
  }, [searchQuery]);

  const handleAddFriend = async (user: GesserUser) => {
    try {
      await GesserApi.addFriend(deviceId, user.deviceId);

      // Update local state
      setUsers(prev =>
        prev.map(u =>
          u.deviceId === user.deviceId ? { ...u, isFriend: true } : u
        )
      );

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t.successTitle, t.addedFriendMsg.replace('{name}', user.name));
    } catch (error: any) {
      console.error('[Gesser] Add friend error:', error);
      Alert.alert(t.errorTitle, error.message || t.discoverErrorAdd);
    }
  };

  const handleRemoveFriend = async (user: GesserUser) => {
    try {
      await GesserApi.removeFriend(deviceId, user.deviceId);

      // Update local state
      setUsers(prev =>
        prev.map(u =>
          u.deviceId === user.deviceId ? { ...u, isFriend: false } : u
        )
      );

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t.successTitle, t.removedFriendMsg.replace('{name}', user.name));
    } catch (error: any) {
      console.error('[Gesser] Remove friend error:', error);
      Alert.alert(t.errorTitle, error.message || t.discoverErrorRemove);
    }
  };

  const renderUser = ({ item }: { item: GesserUser }) => {
    const isCurrentUser = item.deviceId === deviceId;

    return (
      <View style={styles.userCard}>
        <View style={styles.userInfo}>
          {item.portrait ? (
            <Image
              source={{ uri: item.portrait }}
              style={styles.userPortrait}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.userPortraitPlaceholder}>
              <Text style={styles.userPortraitPlaceholderIcon}>👤</Text>
            </View>
          )}

          <View style={styles.userTextContainer}>
            <Text style={styles.userName}>{item.name}</Text>
            {item.isFriend && (
              <Text style={styles.friendBadge}>{t.friendBadge}</Text>
            )}
          </View>
        </View>

        {!isCurrentUser && (
          <TouchableOpacity
            style={[
              styles.friendButton,
              item.isFriend ? styles.friendButtonRemove : styles.friendButtonAdd
            ]}
            onPress={() => {
              if (item.isFriend) {
                handleRemoveFriend(item);
              } else {
                handleAddFriend(item);
              }
            }}
          >
            <Text
              style={[
                styles.friendButtonText,
                item.isFriend && styles.friendButtonTextRemove
              ]}
            >
              {item.isFriend ? t.removeButton : t.addButton}
            </Text>
          </TouchableOpacity>
        )}
      </View>
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
          <Text style={styles.headerTitle}>{t.discoverTitle}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t.searchPlaceholder}
            placeholderTextColor="#666"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
          />
          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleSearch}
          >
            <Text style={styles.searchButtonText}>🔍</Text>
          </TouchableOpacity>
        </View>

        {/* User List */}
        {loading && users.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0ff" />
            <Text style={styles.loadingText}>{t.usersLoading}</Text>
          </View>
        ) : (
          <FlatList
            data={users}
            keyExtractor={item => item.deviceId}
            renderItem={renderUser}
            contentContainerStyle={styles.listContent}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>{t.noUsersTitle}</Text>
                <Text style={styles.emptyHint}>{t.noUsersHint}</Text>
              </View>
            }
            ListFooterComponent={
              loading && users.length > 0 ? (
                <ActivityIndicator
                  size="small"
                  color="#0ff"
                  style={styles.footerLoader}
                />
              ) : null
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
    backgroundColor: '#0a0a0a'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#0ff'
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0ff'
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#333',
    borderRadius: 20
  },
  closeButtonText: {
    fontSize: 24,
    color: '#fff'
  },
  searchContainer: {
    flexDirection: 'row',
    padding: 20,
    gap: 10
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#222',
    borderWidth: 2,
    borderColor: '#0ff',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#fff'
  },
  searchButton: {
    backgroundColor: '#0ff',
    width: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10
  },
  searchButtonText: {
    fontSize: 24
  },
  listContent: {
    padding: 20,
    paddingTop: 0
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingText: {
    color: '#0ff',
    marginTop: 20,
    fontSize: 16
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center'
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 10
  },
  emptyHint: {
    color: '#666',
    fontSize: 14
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#222',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#333'
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  userPortrait: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#111'
  },
  userPortraitPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center'
  },
  userPortraitPlaceholderIcon: {
    fontSize: 30,
    color: '#666'
  },
  userTextContainer: {
    marginLeft: 16,
    flex: 1
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4
  },
  friendBadge: {
    fontSize: 12,
    color: '#0f3',
    fontWeight: 'bold'
  },
  friendButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 2
  },
  friendButtonAdd: {
    backgroundColor: '#0ff',
    borderColor: '#0ff'
  },
  friendButtonRemove: {
    backgroundColor: 'transparent',
    borderColor: '#f33'
  },
  friendButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000'
  },
  friendButtonTextRemove: {
    color: '#f33'
  },
  footerLoader: {
    marginVertical: 20
  }
});

export default UserDiscoveryScreen;
