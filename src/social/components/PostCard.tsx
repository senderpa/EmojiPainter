/**
 * PostCard — a single Facebook/diary-style post in the profile timeline. Renders
 * a distinct, polished card per event type: art uploads (image + ♥ votes),
 * diary text entries, and profile-change system notes.
 *
 * Art images are shown in FULL — never cropped. The whole artwork sits on a
 * letterboxed dark background at its true aspect ratio (from the gallery entry's
 * width/height, defaulting to 1:1) using resizeMode="contain". The card width is
 * capped on wide screens (iPad / landscape) so images stay readable, not huge.
 */
import React, { useMemo } from 'react';
import { Image, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import { ResizeMode } from 'expo-av';
import PortraitAvatar from './PortraitAvatar';
import ShortVideoPlayer from '../../video/ShortVideoPlayer';
import { timeAgo } from '../timeAgo';
import type { TimelineEvent } from '../types';

/** A media URL is a video when it's an mp4/mov/m4v (tolerant of query strings / fragments). */
const isVideoUrl = (u?: string | null): boolean => !!u && /\.(mp4|mov|m4v)(\?|#|$)/i.test(u);

interface Props {
  event: TimelineEvent;
  authorName: string;
  authorPortrait: string | null;
  /** ♥ upvotes for an art post, when known. */
  votes?: number;
  /** True artwork aspect ratio (width / height), when known. */
  aspectRatio?: number;
  /** Playable video source for this post (e.g. the gallery entry's rawUrl), when it's a video. */
  videoUrl?: string | null;
  onPressImage?: (url: string) => void;
}

const TYPE_LABEL: Record<TimelineEvent['type'], string> = {
  gallery_upload: '🖼 Art',
  diary: '📓 Diary',
  profile_change: '✏️ Update',
};

/** On wide screens cap the post so images stay full but not enormous. */
const MAX_CARD_WIDTH = 680;

const PostCard: React.FC<Props> = ({
  event,
  authorName,
  authorPortrait,
  votes,
  aspectRatio,
  videoUrl,
  onPressImage,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const isArt = event.type === 'gallery_upload';
  const isChange = event.type === 'profile_change';

  // Card width: full width on phones (minus 16px page padding each side), capped
  // on iPad/landscape and centered. Memoised so it only recomputes on resize.
  const cardWidth = useMemo(
    () => Math.min(screenWidth - 32, MAX_CARD_WIDTH),
    [screenWidth]
  );

  // Inner image width = card width minus the card's 12px horizontal padding.
  const imageWidth = cardWidth - 24;
  const ratio = aspectRatio && aspectRatio > 0 ? aspectRatio : 1;

  return (
    <View style={styles.center}>
      <View style={[styles.card, { width: cardWidth }, isChange && styles.cardMuted]}>
        <View style={styles.head}>
          <PortraitAvatar uri={authorPortrait} size={36} />
          <View style={styles.headMid}>
            <Text style={styles.author} numberOfLines={1}>{authorName || 'Anonymous'}</Text>
            <Text style={styles.meta}>{TYPE_LABEL[event.type]} · {timeAgo(event.createdAt)}</Text>
          </View>
        </View>

        {isArt ? (
          <>
            {!!event.text && <Text style={styles.artTitle}>Handed in “{event.text}”</Text>}
            {(() => {
              // Prefer an explicit video source; else play the imageUrl itself if it's a video file
              // (a video URL in <Image> just renders black — that was the bug).
              const vid = videoUrl && isVideoUrl(videoUrl)
                ? videoUrl
                : (isVideoUrl(event.imageUrl) ? event.imageUrl : null);
              if (vid) {
                return (
                  <ShortVideoPlayer
                    uri={vid}
                    style={[styles.image, { width: imageWidth, aspectRatio: ratio }]}
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay
                    isMuted
                  />
                );
              }
              return event.imageUrl ? (
                <TouchableOpacity
                  activeOpacity={onPressImage ? 0.9 : 1}
                  onPress={onPressImage ? () => onPressImage(event.imageUrl as string) : undefined}
                >
                  <Image
                    source={{ uri: event.imageUrl }}
                    style={[styles.image, { width: imageWidth, aspectRatio: ratio }]}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
              ) : null;
            })()}
            {typeof votes === 'number' && votes > 0 && (
              <Text style={styles.votes}>♥ {votes}</Text>
            )}
          </>
        ) : isChange ? (
          <Text style={styles.changeText}>{event.text}</Text>
        ) : (
          <Text style={styles.diaryText}>{event.text}</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  card: {
    backgroundColor: '#141414', borderRadius: 16, padding: 12, marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#262626',
  },
  cardMuted: { backgroundColor: '#101010', paddingVertical: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  headMid: { flex: 1 },
  author: { color: '#fff', fontSize: 14, fontWeight: '700' },
  meta: { color: '#7d7d82', fontSize: 11, fontWeight: '600', marginTop: 1 },
  artTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  // Letterboxed dark background — image is "contain", so it is never cropped.
  image: { borderRadius: 12, backgroundColor: '#0a0a0a' },
  votes: { color: '#ff9f6b', fontSize: 12, fontWeight: '800', marginTop: 8 },
  diaryText: { color: '#eaeaea', fontSize: 15, lineHeight: 21 },
  changeText: { color: '#9a9a9e', fontSize: 13, fontStyle: 'italic' },
});

export default React.memo(PostCard);
