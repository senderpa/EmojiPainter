/**
 * FollowListPage — list of who a user follows (and, once the backend ships the
 * reverse query, their followers). Rows open the visited user's ProfilePage.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, SafeAreaView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { loadFollowers, loadFollowing } from './socialApi';
import PortraitAvatar from './components/PortraitAvatar';
import type { WorldUser } from './types';

const FollowListPage: React.FC<any> = ({ route, navigation }) => {
  const { deviceId, which, name } = route.params ?? {};
  const [users, setUsers] = useState<WorldUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNote(null);
      try {
        // followers = reverse follow graph (followers-list.php); following = the
        // user's own friend edges (friends-list.php). Both shaped as WorldUser.
        const rows = which === 'followers'
          ? await loadFollowers(deviceId)
          : await loadFollowing(deviceId);
        if (!alive) return;
        setUsers(rows);
        if (rows.length === 0) {
          setNote(which === 'followers' ? 'No followers yet.' : 'Not following anyone yet.');
        }
      } catch {
        if (alive) setNote('Couldn’t load the list.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [deviceId, which]);

  const renderItem = useCallback(({ item }: { item: WorldUser }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.85}
      onPress={() => navigation.push('ProfilePage', { deviceId: item.deviceId, name: item.name, portrait: item.portrait, rank: item.rank })}
    >
      <PortraitAvatar uri={item.portrait} size={52} />
      <Text style={styles.name} numberOfLines={1}>{item.name || 'Anonymous'}</Text>
    </TouchableOpacity>
  ), [navigation]);

  const title = which === 'followers' ? 'Followers' : 'Following';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{name ? `${name} · ${title}` : title}</Text>
        <View style={{ width: 24 }} />
      </View>
      {loading ? (
        <ActivityIndicator color="#ff9f6b" style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.deviceId}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.empty}>{note ?? 'No one here yet'}</Text>}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator
          indicatorStyle="white"
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0b' },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  back: { color: '#fff', fontSize: 34, fontWeight: '300', width: 24 },
  title: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  list: { paddingHorizontal: 14, paddingBottom: 30 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#141414', borderRadius: 16, padding: 10, marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#262626',
  },
  name: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700' },
  empty: { color: '#666', textAlign: 'center', marginTop: 40, fontSize: 13, paddingHorizontal: 24 },
});

export default FollowListPage;
