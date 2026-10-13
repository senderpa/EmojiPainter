/**
 * GalleryPassportViewer — animated profile card overlay shown when tapping a
 * user's passport avatar inside the gallery.
 *
 * Extracted from PaintScreen.tsx (lines ~18352-18527).
 * Pure presentational component — all state and handlers arrive via props.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Platform,
  StyleSheet,
  Animated as RNAnimated,
} from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { AppText } from '../../emoji/AppText';
import { CustomOverlayHelper } from '../../components/CustomOverlay';
import { resolveCoinLevel, formatElapsedTime } from '../../lib/profileStats';

// ─── Local constants ──────────────────────────────────────────────────────────

const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of user data displayed in the passport card. */
export interface GalleryPassportUser {
  imageUrl?: string | null;
  name: string;
  coinCount?: number | null;
  strokeCount?: number | null;
  elapsedMs?: number | null;
}

export interface GalleryPassportViewerProps {
  /** Whether the overlay is currently visible. */
  galleryPassportViewerVisible: boolean;
  /** User data to display; null hides the card. */
  galleryPassportEntry: GalleryPassportUser | null;
  /** Called when the user dismisses the overlay. */
  onClose: () => void;
  /** Called when the user taps "Be Friends". */
  onAddFriend: (user: GalleryPassportUser) => void;
  /** Current device ID (reserved for future friend-request payloads). */
  deviceId: string;
  /** Safe-area insets from the parent screen. */
  insets: EdgeInsets;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GalleryPassportViewer(props: GalleryPassportViewerProps): React.ReactElement | null {
  const {
    galleryPassportViewerVisible,
    galleryPassportEntry,
    onClose,
    onAddFriend,
  } = props;

  // Alias to match the original PaintScreen variable names used in JSX below.
  const galleryPassportViewerUser = galleryPassportEntry;

  // Cache-bust timestamp for profile images — refreshed each time the overlay opens.
  const worldBrowserImageTimestampRef = useRef(Date.now());

  // Scale + opacity animation value (0 = hidden, 1 = fully open).
  const galleryPassportViewerScale = useRef(new RNAnimated.Value(0)).current;

  // ── Open / close animations ─────────────────────────────────────────────────
  useEffect(() => {
    if (galleryPassportViewerVisible) {
      worldBrowserImageTimestampRef.current = Date.now();
      galleryPassportViewerScale.setValue(0);
      RNAnimated.spring(galleryPassportViewerScale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    }
  }, [galleryPassportViewerVisible, galleryPassportViewerScale]);

  const closeGalleryPassportViewer = (): void => {
    RNAnimated.timing(galleryPassportViewerScale, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const worldBrowserImageTimestamp = worldBrowserImageTimestampRef.current;

  // ── Guard — nothing to show ──────────────────────────────────────────────────
  if (!galleryPassportViewerVisible || !galleryPassportViewerUser) {
    return null;
  }

  // ── JSX (kept exactly as-is from PaintScreen) ────────────────────────────────
  return (
    <View style={styles.backdrop}>
      <RNAnimated.View style={[
        styles.card,
        {
          transform: [{ scale: galleryPassportViewerScale }],
          opacity: galleryPassportViewerScale,
        }
      ]}>
        {/* Close Button */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={closeGalleryPassportViewer}
        >
          <Text style={{ fontSize: 24 }}>❎</Text>
        </TouchableOpacity>

        {/* Profile Image */}
        <View style={[
          styles.avatarRing,
          {
            width: IS_IPAD ? 200 : 150,
            height: IS_IPAD ? 200 : 150,
            borderRadius: IS_IPAD ? 100 : 75,
          }
        ]}>
          {galleryPassportViewerUser.imageUrl ? (
            <Image
              source={{ uri: `${galleryPassportViewerUser.imageUrl}?t=${worldBrowserImageTimestamp}` }}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={{ fontSize: 50 }}>👤</Text>
            </View>
          )}
        </View>

        {/* Name */}
        <Text style={[
          styles.nameText,
          { fontSize: IS_IPAD ? 28 : 22 }
        ]}>
          {galleryPassportViewerUser.name}
        </Text>

        {/* Level Badge */}
        <Text style={[
          styles.levelText,
          { fontSize: IS_IPAD ? 16 : 14 }
        ]}>
          {resolveCoinLevel(galleryPassportViewerUser.coinCount ?? 0).emoji}{' '}
          {resolveCoinLevel(galleryPassportViewerUser.coinCount ?? 0).name}
        </Text>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          {/* Coins */}
          <View style={styles.statCell}>
            <Text style={{ fontSize: 24, marginBottom: 4 }}>🪙</Text>
            <Text style={styles.statLabel}>Coins</Text>
            <Text style={styles.statValue}>
              {(galleryPassportViewerUser.coinCount ?? 0).toLocaleString()}
            </Text>
          </View>

          {/* Strokes */}
          <View style={styles.statCell}>
            <Text style={{ fontSize: 24, marginBottom: 4 }}>🖌️</Text>
            <Text style={styles.statLabel}>Strokes</Text>
            <Text style={styles.statValue}>
              {(galleryPassportViewerUser.strokeCount ?? 0).toLocaleString()}
            </Text>
          </View>

          {/* Time */}
          <View style={styles.statCell}>
            <Text style={{ fontSize: 24, marginBottom: 4 }}>⏱️</Text>
            <Text style={styles.statLabel}>Time</Text>
            <Text style={[styles.statValue, { fontSize: 12 }]}>
              {formatElapsedTime(galleryPassportViewerUser.elapsedMs ?? 0)}
            </Text>
          </View>
        </View>

        {/* Be Friends Button */}
        <TouchableOpacity
          style={styles.friendButton}
          onPress={() => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            CustomOverlayHelper.alert('Coming Soon!', 'Friend system is coming soon! Stay tuned for updates.');
          }}
        >
          <Text style={{ fontSize: IS_IPAD ? 22 : 18, marginBottom: 4 }}>🤝</Text>
          <Text style={[styles.friendButtonText, { fontSize: IS_IPAD ? 14 : 12 }]}>Be Friends</Text>
        </TouchableOpacity>
      </RNAnimated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    zIndex: 20000,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '90%',
    maxWidth: IS_IPAD ? 600 : 400,
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: IS_IPAD ? 40 : 30,
    alignItems: 'center',
    shadowColor: '#ff9f6b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 15,
    right: 15,
    zIndex: 100,
    backgroundColor: 'rgba(60, 60, 60, 0.9)',
    borderRadius: 12,
    padding: 12,
  },
  avatarRing: {
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#ff9f6b',
    marginBottom: 20,
    backgroundColor: 'rgba(30, 30, 30, 0.9)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameText: {
    color: '#fff',
    fontWeight: 'bold',
    fontFamily: 'vrtlfinal',
    marginBottom: 8,
    textAlign: 'center',
  },
  levelText: {
    color: '#b0b0b0',
    marginBottom: 25,
    textAlign: 'center',
  },
  statsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 25,
  },
  statCell: {
    flex: 1,
    minWidth: 100,
    backgroundColor: 'rgba(30, 30, 30, 0.9)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 12,
    alignItems: 'center',
  },
  statLabel: {
    color: '#b0b0b0',
    fontSize: 10,
    marginBottom: 4,
  },
  statValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  friendButton: {
    width: '100%',
    backgroundColor: 'rgba(76, 175, 80, 0.9)',
    paddingVertical: IS_IPAD ? 14 : 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  friendButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default GalleryPassportViewer;
