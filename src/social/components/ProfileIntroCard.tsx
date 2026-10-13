/**
 * ProfileIntroCard — an "About" card pinned at the top of the timeline. Gives the
 * page more substance: bio, when they started, level, and a highlights row.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import { formatElapsedTime, resolveProfileLevelProgress } from '../../lib/profileStats';
import { shortDate } from '../timeAgo';
import type { ProfileViewModel } from '../types';

interface Props {
  profile: ProfileViewModel;
  /** Earliest known activity (first handed-in artwork), unix seconds. */
  firstActivityAt?: number | null;
  levelName?: string;
  levelIcon?: string;
}

const Row: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <View style={styles.row}>
    <Text style={styles.rowIcon}>{icon}</Text>
    <Text style={styles.rowLabel}>{label}</Text>
  </View>
);

const ProfileIntroCard: React.FC<Props> = ({ profile, firstActivityAt, levelName, levelIcon }) => {
  const fallbackLevel = resolveProfileLevelProgress({
    coins: profile.coinCount,
    strokeCount: profile.strokeCount,
    elapsedMs: profile.elapsedMs,
  }).level;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Intro</Text>
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      <View style={styles.rows}>
        {firstActivityAt ? <Row icon="🗓" label={`Started painting ${shortDate(firstActivityAt)}`} /> : null}
        <Row icon={levelIcon ?? fallbackLevel.emoji} label={`${levelName ?? fallbackLevel.name} · ${profile.coinCount.toLocaleString()} coins`} />
        <Row icon="🖼" label={`${profile.galleryCount} artwork${profile.galleryCount === 1 ? '' : 's'} handed in`} />
        <Row icon="⏱" label={`${formatElapsedTime(profile.elapsedMs)} painting · ${profile.strokeCount.toLocaleString()} strokes`} />
        {profile.correctGuesses != null && profile.correctGuesses > 0 ? (
          <Row icon="🎯" label={`${profile.correctGuesses} mystery guess${profile.correctGuesses === 1 ? '' : 'es'} solved`} />
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#141414', borderRadius: 16, padding: 14, marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#262626',
  },
  title: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 8 },
  bio: { color: '#dcdcdc', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  rows: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  rowLabel: { color: '#cfcfcf', fontSize: 13, fontWeight: '600', flexShrink: 1 },
});

export default ProfileIntroCard;
