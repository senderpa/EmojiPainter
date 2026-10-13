/**
 * ProfileBanner — a cropped 16:5 cinematic cover behind the profile portrait. Shows
 * the user's "best" artwork (most-loved, newest tie-break); plays it muted/looping
 * if it has video/frames, else the still image.
 *
 * Animated: driven by the feed's scroll offset (native driver, 60fps, no JS cost).
 * - Pull-down (overscroll): the cover scales up from the top — a satisfying stretch.
 * - Scroll-up: the cover drifts at half speed (parallax) with a subtle zoom (dolly),
 *   so it feels alive instead of flat.
 */
import React from 'react';
import { Animated, Image, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ResizeMode } from 'expo-av';
import type { DailyPaintGalleryEntry } from '../../lib/dailyPaintGallery';
import ShortVideoPlayer from '../../video/ShortVideoPlayer';

interface Props {
  /** The chosen "best" entry, or null when the user has no gallery yet. */
  entry: DailyPaintGalleryEntry | null;
  /** Feed scroll offset (px). When provided, the cover parallax/dollies off it. */
  scrollY?: Animated.Value;
  /** Extra pixels added to the computed height so the banner extends behind action buttons. */
  extraHeight?: number;
  /** When true, stretches to fill its parent container (use inside absoluteFill). */
  stretch?: boolean;
}

/** True if a URL points at a video file (tolerant of query strings / fragments). */
const isVideoUrl = (u?: string | null): boolean => !!u && /\.(mp4|mov|m4v)(\?|#|$)/i.test(u);

/** Real video source for the banner — checks rawUrl AND imageUrl (either may hold the .mp4). */
function videoUri(entry: DailyPaintGalleryEntry): string | null {
  if (isVideoUrl(entry.rawUrl)) return entry.rawUrl;
  if (isVideoUrl(entry.imageUrl)) return entry.imageUrl;
  return null;
}

const ProfileBanner: React.FC<Props> = ({ entry, scrollY, extraHeight = 0, stretch = false }) => {
  const { width, height } = useWindowDimensions();
  const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad;
  const isLandscape = width > height;
  const H = Math.round((width * (!IS_IPAD && isLandscape ? 2.5 : 5)) / 16) + extraHeight; // 5/16 ≈ 16:5 ratio + optional extra
  const video = entry ? videoUri(entry) : null;

  // Parallax drift + stretch-on-pull, all on the native driver.
  const animatedStyle = scrollY
    ? {
        transform: [
          {
            translateY: scrollY.interpolate({
              inputRange: [-H, 0, H],
              outputRange: [-H / 2, 0, H * 0.4], // pull: rise to stay pinned while scaling; scroll: drift slower
              extrapolate: 'clamp' as const,
            }),
          },
          {
            scale: scrollY.interpolate({
              inputRange: [-H, 0, H],
              outputRange: [2, 1, 1.12], // pull-down stretch; gentle zoom (dolly) as it scrolls away
              extrapolateLeft: 'extend' as const,
              extrapolateRight: 'clamp' as const,
            }),
          },
        ],
      }
    : undefined;

  return (
    <View style={[styles.banner, stretch ? { flex: 1 } : { height: H }]}>
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
        {video ? (
          <ShortVideoPlayer
            uri={video}
            style={StyleSheet.absoluteFill}
            shouldPlay
            isMuted
            resizeMode={ResizeMode.COVER}
          />
        ) : entry ? (
          <Image source={{ uri: entry.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.bannerEmpty]} />
        )}
      </Animated.View>
      {/* Dark scrim at the bottom so the overlapping portrait reads cleanly. */}
      <View style={styles.scrim} pointerEvents="none" />
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    backgroundColor: '#241a16',
    overflow: 'hidden', // crop the stretch/parallax to the 16:5 frame
  },
  bannerEmpty: { backgroundColor: '#241a16' },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
    backgroundColor: 'rgba(11,11,11,0.55)',
  },
});

export default React.memo(ProfileBanner);
