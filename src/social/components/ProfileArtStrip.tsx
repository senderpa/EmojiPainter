/**
 * ProfileArtStrip — a horizontal "recent art" rail shown in the profile header so
 * the gallery stays glanceable while the vertical space goes to the timeline.
 */
import React from 'react';
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ResizeMode } from 'expo-av';
import { AppText as Text } from '../../emoji/AppText';
import type { DailyPaintGalleryEntry } from '../../lib/dailyPaintGallery';
import ShortVideoPlayer from '../../video/ShortVideoPlayer';

/** True when a URL points at a video file. */
const isVideo = (e: DailyPaintGalleryEntry): boolean => {
  const url = (e.rawUrl || e.imageUrl || '').toLowerCase();
  return url.endsWith('.mp4') || url.endsWith('.mov');
};

/** Actual video URI — prefers rawUrl over imageUrl. */
const videoUri = (e: DailyPaintGalleryEntry): string =>
  (e.rawUrl && (e.rawUrl.toLowerCase().endsWith('.mp4') || e.rawUrl.toLowerCase().endsWith('.mov')))
    ? e.rawUrl
    : e.imageUrl;

interface Props {
  entries: DailyPaintGalleryEntry[];
  onPressEntry?: (entry: DailyPaintGalleryEntry) => void;
}

const ProfileArtStrip: React.FC<Props> = ({ entries, onPressEntry }) => {
  if (!entries.length) return null;
  // Newest first for the rail.
  const ordered = [...entries].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 24);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>🖼 Recent art</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {ordered.map((e) => (
          <TouchableOpacity
            key={String(e.id)}
            activeOpacity={0.85}
            onPress={onPressEntry ? () => onPressEntry(e) : undefined}
          >
            {isVideo(e) ? (
              <ShortVideoPlayer
                uri={videoUri(e)}
                style={styles.thumb}
                resizeMode={ResizeMode.COVER}
                shouldPlay
                isMuted
              />
            ) : (
              <Image source={{ uri: e.imageUrl }} style={styles.thumb} resizeMode="cover" />
            )}
            {!!e.upvotes && e.upvotes > 0 && (
              <View style={styles.voteBadge}><Text style={styles.voteText}>♥ {e.upvotes}</Text></View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  rail: { gap: 8, paddingRight: 4 },
  thumb: { width: 92, height: 92, borderRadius: 12, backgroundColor: '#161616' },
  voteBadge: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1,
  },
  voteText: { color: '#ff9f6b', fontSize: 10, fontWeight: '700' },
});

export default ProfileArtStrip;
