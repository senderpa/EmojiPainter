// @ts-nocheck - `cache` prop on Image is intentional for HTTP cache invalidation via timestamp
/**
 * WorldBrowserOverlay — full-screen player list.
 *
 * Pure presentational component: no internal state, effects, or API calls.
 * All data and callbacks arrive via props.
 */
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { AppText as Text } from '../../emoji/AppText';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a single world user entry coming from the leaderboard feed. */
export interface WorldUser {
  id: string;
  name: string;
  imageUrl?: string | null;
  rank?: number;
}

export interface WorldBrowserOverlayProps {
  /** Whether this overlay is currently shown. */
  worldBrowserVisible: boolean;
  /** Full list of players to render in the FlatList. */
  worldUsers: WorldUser[];
  /** Called when the user taps the close button. */
  onClose: () => void;
  /** Called when the user taps a player row — parent should open the profile overlay. */
  onSelectUser: (user: WorldUser) => void;
  /** Current device ID (may be used by parent for self-highlighting etc.). */
  deviceId: string | null;
  /** Safe-area insets from the parent (passed through for layout awareness). */
  insets: EdgeInsets;
  /** True while the user list is being fetched. */
  worldBrowserLoading?: boolean;
  /** Unix timestamp (ms) appended to image URIs to bust HTTP cache on refresh. */
  worldBrowserImageTimestamp?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WorldBrowserOverlay: React.FC<WorldBrowserOverlayProps> = ({
  worldBrowserVisible,
  worldUsers,
  onClose,
  onSelectUser,
  deviceId,
  insets,
  worldBrowserLoading = false,
  worldBrowserImageTimestamp = 0,
}) => {
  // Alias prop names to the internal variable names used verbatim in the JSX below.
  const closeWorldBrowser = onClose;
  const allUsersLeaderboard = worldUsers;
  const openProfileOverlayForUser = onSelectUser;

  return (
    <>
      {/* World Browser - User List */}
      {worldBrowserVisible && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#0a0a0a',
          zIndex: 16000
        }}>
          <SafeAreaView style={{ flex: 1 }}>
            {/* Header */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: 'rgba(255, 255, 255, 0.1)'
            }}>
              <Text style={{
                color: '#fff',
                fontSize: IS_IPAD ? 28 : 22,
                fontWeight: 'bold',
                fontFamily: 'vrtlfinal'
              }}>🌍 All Players</Text>
              <TouchableOpacity
                style={{
                  backgroundColor: 'rgba(60, 60, 60, 0.9)',
                  borderRadius: 12,
                  padding: 10
                }}
                onPress={closeWorldBrowser}
              >
                <Text style={{ fontSize: 20 }}>❎</Text>
              </TouchableOpacity>
            </View>

            {/* User List */}
            {worldBrowserLoading ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator color="#ff9f6b" size="large" />
                <Text style={{ color: '#b0b0b0', marginTop: 12, fontSize: 14 }}>Loading players...</Text>
              </View>
            ) : (
              <FlatList
                data={allUsersLeaderboard}
                keyExtractor={(item) => item.id}
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 20 }}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    style={{
                      backgroundColor: 'rgba(30, 30, 30, 0.8)',
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.1)',
                      marginBottom: 12,
                      padding: 16,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 16
                    }}
                    onPress={() => {
                      closeWorldBrowser();
                      openProfileOverlayForUser(item);
                    }}
                  >
                    {/* Profile Thumbnail */}
                    <View style={{
                      width: 80,
                      height: 80,
                      borderRadius: 40,
                      backgroundColor: 'rgba(60, 60, 60, 0.8)',
                      borderWidth: 2,
                      borderColor: '#ff9f6b',
                      justifyContent: 'center',
                      alignItems: 'center',
                      overflow: 'hidden'
                    }}>
                      {item.imageUrl ? (
                        <Image
                          source={{ uri: `${item.imageUrl}?t=${worldBrowserImageTimestamp}` }}
                          style={{ width: 80, height: 80 }}
                          resizeMode="cover"
                          cache="reload"
                        />
                      ) : (
                        <Text style={{ fontSize: 36 }}>👤</Text>
                      )}
                    </View>

                    {/* Info */}
                    <View style={{ flex: 1 }}>
                      <Text style={{
                        color: '#fff',
                        fontSize: IS_IPAD ? 20 : 18,
                        fontWeight: 'bold',
                        fontFamily: 'vrtlfinal',
                        marginBottom: 4
                      }}>
                        {item.name}
                      </Text>
                      <Text style={{
                        color: '#b0b0b0',
                        fontSize: IS_IPAD ? 16 : 14
                      }}>
                        Rank #{item.rank ?? index + 1}
                      </Text>
                    </View>

                    {/* Arrow */}
                    <Text style={{ color: '#b0b0b0', fontSize: 24 }}>›</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
                    <Text style={{ color: '#b0b0b0', fontSize: 16, textAlign: 'center' }}>
                      No players found
                    </Text>
                  </View>
                }
              />
            )}
          </SafeAreaView>
        </View>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
// All layout is expressed with inline style objects in the JSX above to
// keep full visual parity with PaintScreen's inline patterns. This
// StyleSheet is retained as the canonical extension point.
const styles = StyleSheet.create({
  // container styles are inline above; extend here as the component grows
  root: {},
});

export default WorldBrowserOverlay;
