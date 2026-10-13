/**
 * ProfileNavBar — a hub row of pill buttons that turns the profile page into a
 * jumping-off point: World, Leaderboard, Gallery, and Back to painting. Pure
 * presentational; the page wires each handler to the app's existing routes.
 */
import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';

export interface NavBarAction {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
}

interface Props {
  actions: NavBarAction[];
}

const ProfileNavBar: React.FC<Props> = ({ actions }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.row}
  >
    {actions.map((a) => (
      <TouchableOpacity
        key={a.key}
        style={[styles.pill, !a.label && styles.iconOnlyPill]}
        onPress={a.onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={a.label || (a.key === 'ar' ? 'AR' : a.key === 'leaderboard' ? 'Leaderboard' : a.icon)}
      >
        <Text style={styles.pillText}>
          {a.icon}{a.label ? `  ${a.label}` : ''}
        </Text>
      </TouchableOpacity>
    ))}
  </ScrollView>
);

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 2, paddingRight: 4 },
  pill: {
    backgroundColor: '#1a1a1a',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#333',
  },
  iconOnlyPill: {
    minWidth: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});

export default React.memo(ProfileNavBar);
