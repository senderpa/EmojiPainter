/**
 * LeaderboardOverlay — pure presentational component for all Leaderboard UI.
 *
 * Renders:
 *   1. Main Leaderboard Modal (full-screen slide-in)
 *   2. Leaderboard Preview Modal (passport detail)
 *   3. Leaderboard Loading Overlay (AnimatedLoader)
 *   4. Profile Overview Leaderboard Overlay (inline animated view)
 *   5. Private Studio Leaderboard Overlay (inline animated view inside Private Studio)
 *
 * NO internal state, effects, or API calls — all data arrives via props.
 */
import React from 'react';
import {
  ActivityIndicator,
  Animated as RNAnimated,
  FlatList,
  Image,
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import AnimatedLoader from '../../components/AnimatedLoader';
import { CustomOverlayHelper } from '../../components/CustomOverlay';
import * as Haptics from 'expo-haptics';
import type { UseLeaderboardResult } from './useLeaderboard';
import { LEADERBOARD_PAGE_SIZE, formatElapsedLabel } from './useLeaderboard';
import type { CoinLevel } from '../../lib/profileStats';
import type { PrivateStudioLeaderboardEntry } from '../../lib/privateStudio';

// ---------------------------------------------------------------------------
// Constants (replicated from PaintScreen so the component is self-contained)
// ---------------------------------------------------------------------------
const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;
const LARGE_HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 } as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface LeaderboardOverlayProps extends UseLeaderboardResult {
  /** Whether the "challenge complete" screen is shown (suppresses leaderboard modal). */
  challengeCompleteVisible: boolean;
  /** Upload celebration data (shown at top of leaderboard when a passport was just uploaded). */
  uploadCelebration: { coins: number; level: CoinLevel; previousLevel: CoinLevel; leveledUp: boolean } | null;
  /** Animated style for the coin-burst particle (from PaintScreen's coinScale animated value). */
  coinBurstAnimatedStyle: object;
  /** Next coin level after the current celebration (null if max level). */
  celebrationNextLevel: CoinLevel | null;
  /** How many coins until the next level. */
  celebrationRemainingCoins: number;
  /** Cross-feature: closes leaderboard then opens Private Studio. */
  openPrivateStudioFromLeaderboard: () => void;
  /** Cross-feature: closes leaderboard then opens Gallery. */
  openGalleryFromLeaderboard: () => void;
  /** Cross-feature: closes leaderboard then opens AR. */
  openARFromLeaderboard?: () => void;
  // --- Be Friends (preview modal) ---
  deviceId: string | null;
  friendRequests: { sent: Set<string>; received: Set<string>; friends: Set<string> };
  befriendLoading: Set<string>;
  setBefriendLoading: React.Dispatch<React.SetStateAction<Set<string>>>;
  setFriendRequests: React.Dispatch<React.SetStateAction<{ sent: Set<string>; received: Set<string>; friends: Set<string> }>>;
  setFriendsDeviceIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  // --- For renderLeaderboardItem ---
  coinCount: number;
  currentCoinLevel: CoinLevel;
  /** Safe-area insets for bottom padding inside the preview modal sheet. */
  insets: { top: number; bottom: number };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const LeaderboardOverlay: React.FC<LeaderboardOverlayProps> = (props) => {
  const {
    // Leaderboard hook state
    leaderboardVisible,
    leaderboardClosing,
    leaderboardLoading,
    leaderboardError,
    leaderboardEntries,
    leaderboardPreviewEntry,
    leaderboardPage,
    leaderboardActiveTab,
    currentSeason,
    profileLeaderboardVisible,
    // Animated values
    leaderboardOverlayAnim,
    leaderboardListRef,
    profileLeaderboardOverlayAnim,
    // Derived
    leaderboardOverlayAnimatedStyle,
    leaderboardSheetInsets,
    previewRank,
    previewStrokeLabel,
    previewTimeLabel,
    ownLeaderboardEntryIdSet,
    // Setters
    setLeaderboardPage,
    setLeaderboardActiveTab,
    // Handlers
    refreshLeaderboard,
    closeLeaderboard,
    closeLeaderboardPreview,
    closeProfileLeaderboard,
    handleLeaderboardEntryPress,
    // Extras
    challengeCompleteVisible,
    uploadCelebration,
    coinBurstAnimatedStyle,
    celebrationNextLevel,
    celebrationRemainingCoins,
    openPrivateStudioFromLeaderboard,
    openGalleryFromLeaderboard,
    openARFromLeaderboard,
    deviceId,
    friendRequests,
    befriendLoading,
    setBefriendLoading,
    setFriendRequests,
    setFriendsDeviceIds,
    coinCount,
    currentCoinLevel,
    insets,
  } = props;

  // ---- renderLeaderboardItem (defined here to access local styles) ----
  const renderLeaderboardItem = ({ item, index }: ListRenderItemInfo<PrivateStudioLeaderboardEntry>) => {
    const isOwnEntry = ownLeaderboardEntryIdSet.has(item.id);
    return (
      <TouchableOpacity
        style={s.leaderboardRow}
        onPress={() => handleLeaderboardEntryPress(item)}
        accessibilityRole="button"
        accessibilityLabel={`View ${item.name}'s passport`}
        activeOpacity={0.9}
      >
        <View style={s.leaderboardRankBadge}>
          <Text style={s.leaderboardRankText}>#{item.rank ?? index + 1}</Text>
        </View>
        <View style={s.leaderboardMeta}>
          <View style={s.leaderboardNameRow}>
            <Text style={s.leaderboardName}>{item.name}</Text>
            {isOwnEntry ? <Text style={s.leaderboardOwnTag}>YOU</Text> : null}
          </View>
          <Text style={s.leaderboardStats}>
            {formatElapsedLabel(item.elapsedMs)} · {item.strokeCount} strokes
          </Text>
          {isOwnEntry ? (
            <Text style={s.leaderboardCoins}>
              Coins {coinCount.toLocaleString()} · Level {currentCoinLevel.emoji} {currentCoinLevel.name}
            </Text>
          ) : null}
          {item.uploadedAt ? <Text style={s.leaderboardTime}>{item.uploadedAt}</Text> : null}
        </View>
        <View style={s.leaderboardImageButton}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={s.leaderboardImage} resizeMode="cover" />
          ) : (
            <View style={s.leaderboardImagePlaceholder}>
              <Text style={s.leaderboardImagePlaceholderLabel}>View</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ---- shared leaderboard list (reused in multiple overlay contexts) ----
  const renderLeaderboardList = (withRef: boolean) => (
    leaderboardLoading ? (
      <View style={[s.leaderboardLoading, { flex: 1, justifyContent: 'center' }]}>
        <ActivityIndicator color="#ff9f6b" size="large" />
        <Text style={s.leaderboardLoadingLabel}>Loading leaderboard…</Text>
      </View>
    ) : leaderboardError ? (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={s.leaderboardErrorText}>{leaderboardError}</Text>
        <TouchableOpacity onPress={refreshLeaderboard} style={{ marginTop: 16 }}>
          <Text style={[s.leaderboardRefreshText, { color: '#ff9f6b' }]}>↻ Retry</Text>
        </TouchableOpacity>
      </View>
    ) : (
      <FlatList
        ref={withRef ? leaderboardListRef : undefined}
        data={leaderboardEntries.slice(0, leaderboardPage * LEADERBOARD_PAGE_SIZE)}
        renderItem={renderLeaderboardItem}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        contentContainerStyle={{ paddingBottom: 16 }}
        scrollEnabled
        removeClippedSubviews
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={15}
      />
    )
  );

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* 1. Main Leaderboard Modal                                           */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        visible={(leaderboardVisible || leaderboardClosing) && !challengeCompleteVisible}
        animationType="none"
        transparent
        onRequestClose={closeLeaderboard}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={[s.fullscreenOverlay, s.leaderboardOverlay]}>
          <RNAnimated.View style={[s.leaderboardSheet, leaderboardSheetInsets, leaderboardOverlayAnimatedStyle]}>
            {/* Upload celebration banner */}
            {uploadCelebration ? (
              <View style={s.leaderboardCelebration}>
                <RNAnimated.View style={[s.leaderboardCelebrationBurst, coinBurstAnimatedStyle]} pointerEvents="none">
                  <Text style={s.leaderboardCelebrationBurstLabel}>+1 🪙</Text>
                </RNAnimated.View>
                <Text style={s.leaderboardCelebrationTitle}>Hurra! Passport uploaded</Text>
                <Text style={s.leaderboardCelebrationCoins}>
                  Coins {uploadCelebration.coins.toLocaleString()}
                </Text>
                <View style={s.leaderboardCelebrationLevelRow}>
                  <Text style={s.leaderboardCelebrationLevelEmoji}>{uploadCelebration.level.emoji}</Text>
                  <Text style={s.leaderboardCelebrationLevelLabel}>
                    Level {uploadCelebration.level.id}: {uploadCelebration.level.name}
                  </Text>
                </View>
                {uploadCelebration.leveledUp ? (
                  <Text style={s.leaderboardCelebrationLevelUp}>Level up! Keep shining ✨</Text>
                ) : celebrationNextLevel ? (
                  <Text style={s.leaderboardCelebrationHint}>
                    {celebrationNextLevel.emoji} {celebrationNextLevel.name} in{' '}
                    {celebrationRemainingCoins} more
                    {celebrationRemainingCoins === 1 ? ' coin' : ' coins'}
                  </Text>
                ) : (
                  <Text style={s.leaderboardCelebrationHint}>You reached the top level!</Text>
                )}
              </View>
            ) : null}

            {/* Header */}
            <View style={[s.fullscreenHeader, s.leaderboardHeader]}>
              <Text style={s.fullscreenTitle}>🏆 Leaderboard</Text>
              <View style={s.leaderboardHeaderActions}>
                <TouchableOpacity
                  onPress={openPrivateStudioFromLeaderboard}
                  style={s.leaderboardProfileButton}
                  accessibilityRole="button"
                  accessibilityLabel="Open Profil Studio"
                  hitSlop={LARGE_HIT_SLOP}
                >
                  <Text style={s.leaderboardProfileEmoji}>👤</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={openGalleryFromLeaderboard}
                  style={s.leaderboardGalleryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Open Gallery"
                  hitSlop={LARGE_HIT_SLOP}
                >
                  <Text style={s.leaderboardGalleryEmoji}>🏛️</Text>
                </TouchableOpacity>
                {openARFromLeaderboard ? (
                  <TouchableOpacity
                    onPress={openARFromLeaderboard}
                    accessibilityRole="button"
                    accessibilityLabel="Open AR"
                    style={s.leaderboardGalleryButton}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={s.leaderboardGalleryEmoji}>📽️</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={closeLeaderboard}
                  accessibilityRole="button"
                  accessibilityLabel="Close Leaderboard"
                  hitSlop={LARGE_HIT_SLOP}
                >
                  <Text style={s.fullscreenClose}>❎</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Season / All-time tab row */}
            {currentSeason ? (
              <View style={s.leaderboardTabRow}>
                <TouchableOpacity
                  style={[s.leaderboardTab, leaderboardActiveTab === 'all' && s.leaderboardTabActive]}
                  onPress={() => setLeaderboardActiveTab('all')}
                  accessibilityRole="button"
                  accessibilityLabel="All-time leaderboard"
                >
                  <Text style={[s.leaderboardTabLabel, leaderboardActiveTab === 'all' && s.leaderboardTabLabelActive]}>
                    All-time
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.leaderboardTab, leaderboardActiveTab === 'season' && s.leaderboardTabActive]}
                  onPress={() => setLeaderboardActiveTab('season')}
                  accessibilityRole="button"
                  accessibilityLabel="Season leaderboard"
                >
                  <Text style={[s.leaderboardTabLabel, leaderboardActiveTab === 'season' && s.leaderboardTabLabelActive]}>
                    Season 🏆
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Body */}
            <View style={s.leaderboardBody}>
              {leaderboardActiveTab === 'season' && currentSeason ? (
                <>
                  <View style={s.leaderboardSeasonBanner}>
                    <Text style={s.leaderboardSeasonTheme}>{currentSeason.season.theme}</Text>
                    <Text style={s.leaderboardSeasonMeta}>
                      {currentSeason.season.name} ·{' '}
                      {currentSeason.season.daysLeft === 0
                        ? 'Last day!'
                        : `${currentSeason.season.daysLeft}d left`}
                    </Text>
                  </View>
                  <View style={s.leaderboardListWrapper}>
                    {currentSeason.leaderboard.length === 0 ? (
                      <View style={s.leaderboardMessageBlock}>
                        <Text style={s.leaderboardEmpty}>
                          No uploads this season yet — be the first!
                        </Text>
                      </View>
                    ) : (
                      <FlatList
                        data={currentSeason.leaderboard}
                        keyExtractor={(entry, index) => entry.deviceId || `season-${index}`}
                        renderItem={({ item, index }) => (
                          <View style={s.leaderboardRow}>
                            <View style={s.leaderboardRankBadge}>
                              <Text style={s.leaderboardRankText}>#{index + 1}</Text>
                            </View>
                            <View style={s.leaderboardMeta}>
                              <Text style={s.leaderboardName}>{item.name ?? 'Anonymous'}</Text>
                              <Text style={s.leaderboardStats}>
                                {item.uploadCount} upload{item.uploadCount !== 1 ? 's' : ''} this season
                              </Text>
                            </View>
                            <View style={s.leaderboardImageButton}>
                              {item.portrait ? (
                                <Image
                                  source={{ uri: item.portrait }}
                                  style={s.leaderboardImage}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={s.leaderboardImagePlaceholder}>
                                  <Text style={s.leaderboardImagePlaceholderLabel}>–</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        )}
                        showsVerticalScrollIndicator={false}
                        style={s.leaderboardList}
                        contentContainerStyle={s.leaderboardListContent}
                        initialNumToRender={15}
                        maxToRenderPerBatch={10}
                        windowSize={5}
                        removeClippedSubviews
                        getItemLayout={(_data, index) => ({ length: 80, offset: 80 * index, index })}
                      />
                    )}
                  </View>
                </>
              ) : (
                <>
                  <View style={s.leaderboardListWrapper}>
                    {leaderboardError && !leaderboardLoading ? (
                      <View style={s.leaderboardMessageBlock}>
                        <Text style={s.leaderboardError}>{leaderboardError}</Text>
                        <TouchableOpacity
                          style={s.leaderboardRefresh}
                          onPress={refreshLeaderboard}
                          accessibilityRole="button"
                          accessibilityLabel="Retry leaderboard fetch"
                        >
                          <Text style={s.leaderboardRefreshLabel}>Try again</Text>
                        </TouchableOpacity>
                      </View>
                    ) : leaderboardEntries.length === 0 ? (
                      <View style={s.leaderboardMessageBlock}>
                        <Text style={s.leaderboardEmpty}>
                          No passports yet — share yours to claim the top spot.
                        </Text>
                      </View>
                    ) : (
                      <FlatList
                        ref={leaderboardListRef}
                        data={leaderboardEntries.slice(0, leaderboardPage * LEADERBOARD_PAGE_SIZE)}
                        keyExtractor={(entry, index) => entry.id || `leaderboard-${index}`}
                        renderItem={renderLeaderboardItem}
                        showsVerticalScrollIndicator={false}
                        style={s.leaderboardList}
                        contentContainerStyle={s.leaderboardListContent}
                        initialNumToRender={15}
                        maxToRenderPerBatch={10}
                        windowSize={5}
                        removeClippedSubviews
                        getItemLayout={(_data, index) => ({
                          length: 80,
                          offset: 80 * index,
                          index,
                        })}
                        ListFooterComponent={
                          leaderboardEntries.length > leaderboardPage * LEADERBOARD_PAGE_SIZE ? (
                            <TouchableOpacity
                              onPress={() => setLeaderboardPage((p) => p + 1)}
                              style={{ alignItems: 'center', paddingVertical: 14 }}
                              accessibilityRole="button"
                              accessibilityLabel="Load more leaderboard entries"
                            >
                              <Text style={{ color: '#ff9f6b', fontSize: 15, fontWeight: '600' }}>
                                Load more (
                                {leaderboardEntries.length - leaderboardPage * LEADERBOARD_PAGE_SIZE}{' '}
                                remaining)
                              </Text>
                            </TouchableOpacity>
                          ) : null
                        }
                      />
                    )}
                  </View>
                  <View style={s.leaderboardActions}>
                    <TouchableOpacity
                      style={[s.leaderboardRefresh, leaderboardLoading && s.disabledButton]}
                      onPress={refreshLeaderboard}
                      disabled={leaderboardLoading}
                      accessibilityRole="button"
                      accessibilityLabel="Refresh leaderboard"
                    >
                      <Text style={s.leaderboardRefreshLabel}>
                        {leaderboardLoading ? 'Refreshing…' : 'Refresh'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </RNAnimated.View>
        </View>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Leaderboard Loading Overlay                                      */}
      {/* ------------------------------------------------------------------ */}
      {leaderboardLoading && leaderboardVisible && (
        <AnimatedLoader message="Fetching passports..." showProgressBar={false} />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 3. Leaderboard Preview Modal (passport detail)                      */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        visible={leaderboardPreviewEntry !== null && !challengeCompleteVisible}
        animationType="fade"
        transparent
        onRequestClose={closeLeaderboardPreview}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.65)',
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 20,
          }}
          activeOpacity={1}
          onPress={closeLeaderboardPreview}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={{
              width: '100%',
              maxWidth: IS_IPAD ? 520 : 380,
              backgroundColor: '#141414',
              borderRadius: 22,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.1)',
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: Math.max(insets.bottom + 16, 24),
              shadowColor: '#000',
              shadowOpacity: 0.6,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 8 },
            }}
          >
            {leaderboardPreviewEntry ? (
              <>
                <View style={s.leaderboardPreviewHeader}>
                  <View style={s.leaderboardPreviewTitleBlock}>
                    <Text style={s.leaderboardPreviewName}>{leaderboardPreviewEntry.name}</Text>
                    {previewRank ? (
                      <Text style={s.leaderboardPreviewRank}>#{previewRank}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    onPress={closeLeaderboardPreview}
                    accessibilityRole="button"
                    accessibilityLabel="Close passport preview"
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={s.fullscreenClose}>❎</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.leaderboardPreviewImageWrapper}>
                  {leaderboardPreviewEntry.imageUrl ? (
                    <Image
                      source={{ uri: `${leaderboardPreviewEntry.imageUrl}?t=${Date.now()}` }}
                      style={s.leaderboardPreviewImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={s.leaderboardPreviewPlaceholder}>
                      <Text style={s.leaderboardPreviewPlaceholderLabel}>No passport image yet</Text>
                    </View>
                  )}
                </View>
                <View style={s.leaderboardPreviewStats}>
                  <Text style={s.leaderboardPreviewStat}>
                    Time {previewTimeLabel} · {previewStrokeLabel} strokes
                  </Text>
                  {leaderboardPreviewEntry.uploadedAt ? (
                    <Text style={s.leaderboardPreviewTimestamp}>
                      {leaderboardPreviewEntry.uploadedAt}
                    </Text>
                  ) : null}
                </View>
                {/* Be Friends button */}
                {deviceId
                  ? (() => {
                      const uid = leaderboardPreviewEntry.id;
                      const isFriend = friendRequests.friends.has(uid);
                      const isLoading = befriendLoading.has(uid);
                      const handleBeFriends = async () => {
                        if (isLoading) return;
                        void Haptics.selectionAsync();
                        setBefriendLoading((prev) => new Set([...prev, uid]));
                        try {
                          const GesserApi = (
                            await import('../../gesser/api/gesserClient')
                          ).default;
                          if (isFriend) {
                            await GesserApi.removeFriend(deviceId, uid);
                            setFriendRequests((prev) => ({
                              ...prev,
                              friends: new Set([...prev.friends].filter((id) => id !== uid)),
                            }));
                            setFriendsDeviceIds((prev) => {
                              const s = new Set(prev);
                              s.delete(uid);
                              return s;
                            });
                          } else {
                            await GesserApi.addFriend(deviceId, uid);
                            setFriendRequests((prev) => ({
                              ...prev,
                              friends: new Set([...prev.friends, uid]),
                            }));
                            setFriendsDeviceIds((prev) => new Set([...prev, uid]));
                          }
                        } catch {
                          CustomOverlayHelper.alert('Error', 'Could not update friend. Try again.');
                        } finally {
                          setBefriendLoading((prev) => {
                            const s = new Set(prev);
                            s.delete(uid);
                            return s;
                          });
                        }
                      };
                      return (
                        <TouchableOpacity
                          style={{
                            marginTop: 18,
                            backgroundColor: isFriend
                              ? 'rgba(244,67,54,0.85)'
                              : 'rgba(76,175,80,0.9)',
                            paddingVertical: 12,
                            paddingHorizontal: 32,
                            borderRadius: 14,
                            alignItems: 'center',
                            borderWidth: 2,
                            borderColor: isFriend ? '#f44336' : '#4CAF50',
                            opacity: isLoading ? 0.6 : 1,
                            minWidth: 180,
                          }}
                          onPress={() => void handleBeFriends()}
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                              {isFriend ? '💔 Remove Friend' : '🤝 Be Friends'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })()
                  : null}
              </>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* 4. Profile Overview Leaderboard Overlay                             */}
      {/*    (sits above profile card, outside private studio modal)          */}
      {/* ------------------------------------------------------------------ */}
      {profileLeaderboardVisible && (
        <RNAnimated.View
          style={{
            opacity: profileLeaderboardOverlayAnim,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 15500,
          }}
          pointerEvents={profileLeaderboardVisible ? 'auto' : 'none'}
        >
          <View style={[s.leaderboardSheet, { flex: 1 }]}>
            <View style={[s.fullscreenHeader, { paddingHorizontal: 16, paddingVertical: 12 }]}>
              <Text style={[s.fullscreenTitle, { flex: 1 }]}>Leaderboard</Text>
              <TouchableOpacity
                onPress={closeProfileLeaderboard}
                accessibilityRole="button"
                accessibilityLabel="Close Leaderboard"
                hitSlop={LARGE_HIT_SLOP}
              >
                <Text style={s.fullscreenClose}>❎</Text>
              </TouchableOpacity>
            </View>
            {renderLeaderboardList(true)}
          </View>
        </RNAnimated.View>
      )}
    </>
  );
};

export default React.memo(LeaderboardOverlay);

// ---------------------------------------------------------------------------
// Styles (all leaderboard-specific styles extracted from PaintScreen)
// ---------------------------------------------------------------------------
const s = StyleSheet.create({
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  fullscreenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  fullscreenTitle: {
    color: '#ffdc82',
    fontSize: 22,
    fontWeight: '700',
  },
  fullscreenClose: {
    color: '#fff',
    fontSize: 22,
  },
  leaderboardOverlay: {
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    padding: 0,
  },
  leaderboardSheet: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    backgroundColor: '#101010',
    borderRadius: 0,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 16,
  },
  leaderboardCelebration: {
    backgroundColor: '#181824',
    borderRadius: 22,
    padding: 20,
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
    gap: 6,
  },
  leaderboardCelebrationBurst: {
    position: 'absolute',
    top: -6,
    right: 12,
  },
  leaderboardCelebrationBurstLabel: {
    color: '#ffdc82',
    fontSize: 24,
    fontWeight: '700',
  },
  leaderboardCelebrationTitle: {
    color: '#ffdc82',
    fontSize: 20,
    fontWeight: '700',
  },
  leaderboardCelebrationCoins: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  leaderboardCelebrationLevelRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  leaderboardCelebrationLevelEmoji: {
    fontSize: 34,
  },
  leaderboardCelebrationLevelLabel: {
    color: '#82ffa1',
    fontSize: 16,
    fontWeight: '700',
  },
  leaderboardCelebrationLevelUp: {
    color: '#ff9f6b',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 10,
  },
  leaderboardCelebrationHint: {
    color: '#bbbbbb',
    fontSize: 12,
  },
  leaderboardHeader: {
    marginBottom: 12,
  },
  leaderboardHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  leaderboardProfileButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },
  leaderboardProfileEmoji: {
    fontSize: 24,
    color: '#ffdc82',
  },
  leaderboardGalleryButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },
  leaderboardGalleryEmoji: {
    fontSize: 22,
    color: '#9fd5ff',
  },
  leaderboardTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  leaderboardTab: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },
  leaderboardTabActive: {
    backgroundColor: '#ff6b6b20',
    borderColor: '#ff6b6b70',
  },
  leaderboardTabLabel: {
    color: '#888888',
    fontSize: 14,
    fontWeight: '600',
  },
  leaderboardTabLabelActive: {
    color: '#ff6b6b',
  },
  leaderboardSeasonBanner: {
    backgroundColor: '#181824',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 4,
  },
  leaderboardSeasonTheme: {
    color: '#ffdc82',
    fontSize: 18,
    fontWeight: '700',
  },
  leaderboardSeasonMeta: {
    color: '#9fd5ff',
    fontSize: 13,
    fontWeight: '500',
  },
  leaderboardBody: {
    flex: 1,
    gap: 16,
  },
  leaderboardListWrapper: {
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 24,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#222222',
  },
  leaderboardLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  leaderboardLoadingLabel: {
    color: '#bbbbbb',
    fontSize: 14,
  },
  leaderboardMessageBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  leaderboardError: {
    color: '#ff6b6b',
    fontSize: 15,
    textAlign: 'center',
  },
  leaderboardErrorText: {
    color: '#ff6b6b',
    fontSize: 15,
    textAlign: 'center',
  },
  leaderboardRefreshText: {
    fontSize: 15,
    fontWeight: '600',
  },
  leaderboardEmpty: {
    color: '#bbbbbb',
    fontSize: 15,
    textAlign: 'center',
  },
  leaderboardList: {
    flex: 1,
  },
  leaderboardListContent: {
    gap: 12,
    paddingBottom: 8,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181818',
    borderRadius: 18,
    padding: 12,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#292929',
    position: 'relative',
  },
  leaderboardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  leaderboardOwnTag: {
    backgroundColor: '#ff9f6b',
    color: '#050505',
    fontWeight: '700',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  leaderboardRankBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ff6b6b20',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ff6b6b70',
  },
  leaderboardRankText: {
    color: '#ff6b6b',
    fontWeight: '700',
    fontFamily: 'vrtlfinal',
  },
  leaderboardMeta: {
    flex: 1,
    gap: 4,
  },
  leaderboardName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  leaderboardStats: {
    color: '#ffdc82',
    fontSize: 13,
  },
  leaderboardCoins: {
    color: '#82ffa1',
    fontSize: 13,
    fontWeight: '600',
  },
  leaderboardTime: {
    color: '#8e8e92',
    fontSize: 12,
  },
  leaderboardImageButton: {
    width: 64,
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
    position: 'relative',
  },
  leaderboardImage: {
    width: '100%',
    height: '100%',
  },
  leaderboardImagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardImagePlaceholderLabel: {
    color: '#ffdc82',
    fontSize: 12,
    fontWeight: '600',
  },
  leaderboardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 4,
  },
  leaderboardRefresh: {
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f',
  },
  leaderboardRefreshLabel: {
    color: '#ffdc82',
    fontWeight: '600',
  },
  leaderboardPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leaderboardPreviewTitleBlock: {
    gap: 4,
  },
  leaderboardPreviewName: {
    color: '#ffdc82',
    fontSize: 20,
    fontWeight: '700',
  },
  leaderboardPreviewRank: {
    color: '#bbbbbb',
    fontSize: 14,
    fontWeight: '600',
  },
  leaderboardPreviewImageWrapper: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardPreviewImage: {
    width: '100%',
    height: '100%',
  },
  leaderboardPreviewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  leaderboardPreviewPlaceholderLabel: {
    color: '#bbbbbb',
    fontSize: 15,
    textAlign: 'center',
  },
  leaderboardPreviewStats: {
    gap: 8,
  },
  leaderboardPreviewStat: {
    color: '#ffdc82',
    fontSize: 16,
    fontWeight: '600',
  },
  leaderboardPreviewTimestamp: {
    color: '#8e8e92',
    fontSize: 13,
  },
  disabledButton: {
    opacity: 0.35,
  },
});
