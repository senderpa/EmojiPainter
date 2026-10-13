/** Instant, optimistic follow / unfollow button (MySpace "add"). */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import * as Haptics from 'expo-haptics';
import { follow, getOrCreateDailyDeviceId, unfollow } from '../socialApi';

interface Props {
  targetDeviceId: string;
  following: boolean;
  onChange?: (nowFollowing: boolean) => void;
  size?: 'sm' | 'md';
}

const FollowButton: React.FC<Props> = ({ targetDeviceId, following, onChange, size = 'md' }) => {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(following);

  // Keep in sync if parent updates.
  React.useEffect(() => setState(following), [following]);

  const toggle = async () => {
    if (busy) return;
    const next = !state;
    setBusy(true);
    setState(next);                 // optimistic
    onChange?.(next);
    void Haptics.selectionAsync();
    try {
      const me = await getOrCreateDailyDeviceId();
      if (next) await follow(me, targetDeviceId);
      else await unfollow(me, targetDeviceId);
    } catch {
      setState(!next);              // rollback
      onChange?.(!next);
    } finally {
      setBusy(false);
    }
  };

  const sm = size === 'sm';
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        sm && styles.btnSm,
        state ? styles.following : styles.notFollowing,
      ]}
      onPress={() => void toggle()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={state ? 'Unfollow' : 'Follow'}
    >
      {busy ? (
        <ActivityIndicator size="small" color={state ? '#82ffa1' : '#06210f'} />
      ) : (
        <Text style={[styles.txt, sm && styles.txtSm, state ? styles.txtFollowing : styles.txtNot]}>
          {state ? '✓ Following' : '➕ Follow'}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 116,
  },
  btnSm: { paddingHorizontal: 12, paddingVertical: 6, minWidth: 96 },
  notFollowing: { backgroundColor: '#ff9f6b' },
  following: { backgroundColor: '#1f2a1f', borderWidth: 1, borderColor: '#82ffa1' },
  txt: { fontWeight: '800', fontSize: 14 },
  txtSm: { fontSize: 12 },
  txtNot: { color: '#06210f' },
  txtFollowing: { color: '#82ffa1' },
});

export default FollowButton;
