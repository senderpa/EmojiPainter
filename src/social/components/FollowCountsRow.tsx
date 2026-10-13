/** Tappable follower / following count pills. */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import type { FollowList } from '../types';

interface Props {
  followers: number | null;
  following: number | null;
  onPress?: (which: FollowList) => void;
}

const fmt = (n: number | null) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const FollowCountsRow: React.FC<Props> = ({ followers, following, onPress }) => (
  <View style={styles.row}>
    <TouchableOpacity style={styles.pill} onPress={() => onPress?.('followers')} disabled={!onPress}>
      <Text style={styles.num}>{fmt(followers)}</Text>
      <Text style={styles.label}>Followers</Text>
    </TouchableOpacity>
    <View style={styles.divider} />
    <TouchableOpacity style={styles.pill} onPress={() => onPress?.('following')} disabled={!onPress}>
      <Text style={styles.num}>{fmt(following)}</Text>
      <Text style={styles.label}>Following</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a',
    paddingVertical: 10,
  },
  pill: { flex: 1, alignItems: 'center', gap: 2 },
  num: { color: '#fff', fontSize: 18, fontWeight: '800' },
  label: { color: '#8e8e92', fontSize: 11, fontWeight: '600' },
  divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: '#2a2a2a' },
});

export default FollowCountsRow;
