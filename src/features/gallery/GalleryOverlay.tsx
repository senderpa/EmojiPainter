/**
 * GalleryOverlay — real implementation of the gallery modal and its nested overlays.
 *
 * Extracted from PaintScreen.tsx (~lines 17435-18118).
 * Pure presentational component — all state and handlers arrive via props.
 *
 * @see useGallery.ts for the full state/handler contract.
 */

import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  StyleSheet,
  Image,
  Animated as RNAnimated,
  Dimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';

import { maskTopic as _maskTopic } from '../../gesser/utils/masking';
import type { DailyPaintGalleryEntry } from '../../lib/dailyPaintGallery';
import type { PrivateStudioLeaderboardEntry } from '../../lib/privateStudio';
import type { UseGalleryResult } from './useGallery';
import {
  galleryModes,
  galleryModeIcons,
  galleryModeLabels,
  galleryLayoutModes,
} from './useGallery';

// ─── Local constants ──────────────────────────────────────────────────────────

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;
const LARGE_HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 };

// ─── GallerySkeleton ──────────────────────────────────────────────────────────

const GallerySkeleton: React.FC = () => {
  const pulse = useRef(new RNAnimated.Value(0.3)).current;
  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <RNAnimated.View
          key={i}
          style={{ width: 100, height: 100, borderRadius: 8, backgroundColor: '#333', opacity: pulse }}
        />
      ))}
    </View>
  );
};

// ─── Props ────────────────────────────────────────────────────────────────────

/** Extra props from PaintScreen that the gallery JSX needs but useGallery does not own. */
export interface GalleryOverlayExtraProps {
  /** Whether a challenge-complete overlay is visible (gates gallery modal). */
  challengeCompleteVisible: boolean;
  /** Locale for date formatting. */
  infoLanguage: string;
  /** Topic metadata keyed by topic string (used for translated topic labels). */
  getTopicMeta?: (topic: string) => any;

  // Navigation / screen callbacks
  openPrivateStudioFromGallery: () => void;
  openLeaderboardFromGallery: () => void;
  openARFromGallery?: () => void;
  setParentalControlsVisible: (visible: boolean) => void;

  // Leaderboard ref — used in profile mini overlay to look up rank/coins
  leaderboardEntriesRef: React.MutableRefObject<PrivateStudioLeaderboardEntry[]>;

  // Offline mystery cache loader (defined inside useGallery but not exported via UseGalleryResult)
  loadOfflineMysteryCache: () => Promise<number>;

  // Pagination ReactNode (a useMemo value in PaintScreen)
  galleryPagination: React.ReactNode;

  // Gallery card renderer (complex useCallback in PaintScreen that uses many PaintScreen-local values)
  renderGalleryEntry: (item: DailyPaintGalleryEntry, onReveal?: () => void) => React.ReactElement | null;

  // Viewer gesture (ComposedGesture from react-native-gesture-handler, built in PaintScreen)
  galleryViewerGesture: any;
  // Viewer animated style (from useAnimatedStyle in PaintScreen, derived from galleryViewerScale)
  galleryViewerAnimatedStyle: any;

  // Viewer derived values — computed in PaintScreen from gallerySelectedEntry / gallerySelectedPassport
  viewerEntry: DailyPaintGalleryEntry | null;
  viewerMode: 'entry' | 'passport' | null;
  viewerImageUri: string | null;
  viewerTitle: string;
  viewerSubtitleLine: string | null;
  viewerSupplementLine: string | null;
  viewerTravelerLabel: string | null;
  viewerRunDate: string | null;
  viewerUsedTime: string | null;

  // Guess state setters not included in UseGalleryResult
  setGuessFeedback: (value: { type: 'success' | 'error'; message: string } | null) => void;
  setGuessAllDone: (value: boolean) => void;

  // Server sync status — ISO string from last successful fetch, null when never synced or error
  galleryUpdatedAt: string | null;
}

export type GalleryOverlayProps = UseGalleryResult & GalleryOverlayExtraProps;

// ─── Component ────────────────────────────────────────────────────────────────

export default function GalleryOverlay(props: GalleryOverlayProps) {
  const {
    // ── UseGalleryResult ──────────────────────────────────────────────────────
    galleryVisible,
    closeGallery,
    galleryRefreshing,
    galleryLoading,
    galleryLoadingMore,
    setGalleryLoadingMore,
    galleryError,
    galleryLanguage,
    setGalleryLanguage,
    galleryLanguageOptions,
    galleryLanguagePickerVisible,
    setGalleryLanguagePickerVisible,
    activeLanguageOption,
    galleryModePickerVisible,
    setGalleryModePickerVisible,
    galleryMode,
    galleryLayout,
    setGalleryLayout,
    handleGalleryModeChange,
    galleryEntries,
    revealedGalleryEntries,
    galleryExtraData,
    refreshGallery,
    galleryModeRef,
    visibleGalleryEntries,
    currentGalleryPage,
    galleryPageCount,
    setGalleryPage,
    galleryStatsText,
    isOfflineGalleryMode,
    offlineEntryCount,
    offlineMysteryEntries,
    showOfflineMysteryGallery,
    setShowOfflineMysteryGallery,
    mysteryButtonBlinkOpacity,
    mysteryButtonBlinkScale,
    gallerySelectedEntry,
    gallerySelectedPassport,
    galleryViewerModalOpacity,
    galleryViewerModalScale,
    resetGalleryViewer,
    closeGalleryViewer,
    profileOverlayEntry,
    setProfileOverlayEntry,
    guessOverlayVisible,
    setGuessOverlayVisible,
    guessInput,
    setGuessInput,
    selectedMysteryPainting,
    setSelectedMysteryPainting,
    guessFeedback,
    guessInputRef,
    guessLoading,
    handleSubmitGuess,
    guessWinVisible,
    guessWinParticles,
    guessWinStyleIdx,
    guessAllDone,
    guessedPaintings,
    friendsDeviceIds,

    // ── GalleryOverlayExtraProps ──────────────────────────────────────────────
    challengeCompleteVisible,
    openPrivateStudioFromGallery,
    openLeaderboardFromGallery,
    openARFromGallery,
    setParentalControlsVisible,
    leaderboardEntriesRef,
    loadOfflineMysteryCache,
    galleryPagination,
    renderGalleryEntry,
    galleryViewerGesture,
    galleryViewerAnimatedStyle,
    viewerEntry,
    viewerMode,
    viewerImageUri,
    viewerTitle,
    viewerSubtitleLine,
    viewerSupplementLine,
    viewerTravelerLabel,
    viewerRunDate,
    viewerUsedTime,
    setGuessFeedback,
    setGuessAllDone,
    galleryUpdatedAt,
  } = props;

  const insets = useSafeAreaInsets();

  return (
      <Modal visible={galleryVisible && !challengeCompleteVisible} animationType="slide" transparent onRequestClose={closeGallery} supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}>
        <View style={[styles.fullscreenOverlay, styles.galleryOverlay]}>
          <View
            style={[
              styles.fullscreenSheet,
              styles.gallerySheet,
              {
                paddingTop: insets.top + 24,
                paddingBottom: Math.max(insets.bottom + 24, 36),
                paddingHorizontal: IS_IPAD ? 120 : 0
              }
            ]}
          >
            <View style={[styles.fullscreenHeader, styles.galleryHeaderTop]}>
              <View style={styles.galleryHeaderTitleBlock}>
                <Text style={styles.fullscreenTitle}>Gallery</Text>
                {galleryRefreshing && !galleryLoading ? (
                  <ActivityIndicator color="#ff9f6b" style={styles.galleryHeaderSpinner} />
                ) : null}
                {galleryLanguageOptions.length > 0 ? (
                  <TouchableOpacity
                    style={styles.galleryLanguageToggle}
                    onPress={() => setGalleryLanguagePickerVisible((prev) => !prev)}
                    accessibilityRole="button"
                    accessibilityLabel="Change topic language"
                  >
                    <Text style={styles.galleryLanguageToggleFlag}>{activeLanguageOption.flag}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={styles.galleryHeaderActions}>
                <TouchableOpacity
                  onPress={openPrivateStudioFromGallery}
                  accessibilityRole="button"
                  accessibilityLabel="Open Profil Studio"
                  style={styles.galleryActionButton}
                  hitSlop={LARGE_HIT_SLOP}
                >
                  <Text style={[styles.galleryActionEmoji, styles.galleryActionEmojiProfile]}>👤</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={openLeaderboardFromGallery}
                  accessibilityRole="button"
                  accessibilityLabel="Open Leaderboard"
                  style={styles.galleryActionButton}
                  hitSlop={LARGE_HIT_SLOP}
                >
                  <Text style={[styles.galleryActionEmoji, styles.galleryActionEmojiLeaderboard]}>🏆</Text>
                </TouchableOpacity>
                {openARFromGallery ? (
                  <TouchableOpacity
                    onPress={openARFromGallery}
                    accessibilityRole="button"
                    accessibilityLabel="Open AR"
                    style={styles.galleryActionButton}
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={styles.galleryActionEmoji}>📽️</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={closeGallery}
                  accessibilityRole="button"
                  accessibilityLabel="Close gallery"
                  style={styles.galleryCloseButton}
                  hitSlop={LARGE_HIT_SLOP}
                >
                  <Text style={styles.fullscreenClose}>❎</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Offline mode banner */}
            {isOfflineGalleryMode && (
              <View>
                <View style={{ backgroundColor: 'rgba(0,255,255,0.1)', borderBottomWidth: 1, borderBottomColor: 'rgba(0,255,255,0.2)', paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>📴</Text>
                  <Text style={{ color: '#0ff', fontSize: 12, fontWeight: '700', flex: 1 }}>
                    Offline Gallery — {offlineEntryCount} local painting{offlineEntryCount !== 1 ? 's' : ''}
                  </Text>
                  <TouchableOpacity onPress={() => setParentalControlsVisible(true)}>
                    <Text style={{ color: 'rgba(0,255,255,0.6)', fontSize: 11 }}>Settings ›</Text>
                  </TouchableOpacity>
                </View>
                {/* Offline mystery cache button */}
                <RNAnimated.View style={{ opacity: mysteryButtonBlinkOpacity, transform: [{ scale: mysteryButtonBlinkScale }] }}>
                  <TouchableOpacity
                    onPress={async () => {
                      if (showOfflineMysteryGallery) {
                        setShowOfflineMysteryGallery(false);
                        return;
                      }
                      mysteryButtonBlinkOpacity.setValue(1);
                      mysteryButtonBlinkScale.setValue(1);
                      await loadOfflineMysteryCache();
                    }}
                    style={{ backgroundColor: showOfflineMysteryGallery ? 'rgba(128,0,255,0.25)' : 'rgba(128,0,255,0.15)', borderBottomWidth: 1, borderBottomColor: 'rgba(128,0,255,0.3)', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="View cached mystery posts"
                  >
                    <Text style={{ fontSize: 18 }}>🎲</Text>
                    <Text style={{ color: '#a78bfa', fontSize: 12, fontWeight: '700', flex: 1 }}>
                      {showOfflineMysteryGallery
                        ? `✅ ${offlineMysteryEntries.length} cached mystery post${offlineMysteryEntries.length !== 1 ? 's' : ''} — tap to hide`
                        : `📦 View cached mystery posts`}
                    </Text>
                    {offlineEntryCount === 0 && !showOfflineMysteryGallery && (
                      <Text style={{ color: 'rgba(167,139,250,0.5)', fontSize: 10 }}>auto-loading…</Text>
                    )}
                  </TouchableOpacity>
                </RNAnimated.View>
              </View>
            )}
            <View style={styles.galleryHeaderBottom}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }}>
                {/* Mode Picker Toggle Button */}
                <TouchableOpacity
                  onPress={() => setGalleryModePickerVisible(!galleryModePickerVisible)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    borderRadius: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    flex: 1,
                    marginRight: 8
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Mode: ${galleryModeLabels[galleryMode]}`}
                >
                  <Text style={{
                    color: '#fff',
                    fontSize: 14,
                    fontFamily: 'vrtlfinal',
                    fontWeight: 'bold'
                  }}>
                    {galleryModeIcons[galleryMode]} {galleryModeLabels[galleryMode]}
                  </Text>
                  <Text style={{ color: '#888', fontSize: 12 }}>{galleryModePickerVisible ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {/* Layout Toggle Button */}
                <TouchableOpacity
                  onPress={() => {
                    const currentIndex = galleryLayoutModes.indexOf(galleryLayout);
                    const nextIndex = (currentIndex + 1) % galleryLayoutModes.length;
                    setGalleryLayout(galleryLayoutModes[nextIndex]);
                  }}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    borderRadius: 8
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Layout: ${galleryLayout}`}
                >
                  <Text style={{
                    color: '#fff',
                    fontSize: 12,
                    fontFamily: 'vrtlfinal',
                    fontWeight: 'bold'
                  }}>
                    {galleryLayout === 'default' ? '📱' : galleryLayout === 'list' ? '📋' : '🔲'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Mode Picker Dropdown */}
            {galleryModePickerVisible && (
              <View style={{
                backgroundColor: 'rgba(20, 20, 20, 0.98)',
                marginHorizontal: 16,
                marginTop: 8,
                borderRadius: 12,
                padding: 8,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)'
              }}>
                {galleryModes.map((mode) => {
                  const isActive = galleryMode === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        backgroundColor: isActive ? 'rgba(76, 175, 80, 0.2)' : 'transparent',
                        borderRadius: 8,
                        marginBottom: 4
                      }}
                      onPress={() => {
                        if (galleryMode !== mode) {
                          handleGalleryModeChange(mode);
                        }
                        setGalleryModePickerVisible(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${galleryModeLabels[mode]}${isActive ? ' (active)' : ''}`}
                    >
                      <Text style={{
                        color: isActive ? '#4CAF50' : '#fff',
                        fontSize: 14,
                        fontFamily: 'vrtlfinal',
                        fontWeight: isActive ? 'bold' : 'normal'
                      }}>
                        {galleryModeIcons[mode]} {galleryModeLabels[mode]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {galleryLanguagePickerVisible && galleryLanguageOptions.length > 1 ? (
              <View style={styles.galleryLanguageDropdown}>
                {galleryLanguageOptions.map((option) => {
                  const active = option.id === galleryLanguage;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[styles.galleryLanguageOption, active && styles.galleryLanguageOptionActive]}
                      onPress={() => {
                        setGalleryLanguage(option.id);
                        setGalleryLanguagePickerVisible(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Switch topic language to ${option.label}`}
                    >
                      <Text style={[styles.galleryLanguageOptionFlag, active && styles.galleryLanguageOptionFlagActive]}>{option.flag}</Text>
                      <Text style={[styles.galleryLanguageOptionLabel, active && styles.galleryLanguageOptionLabelActive]}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
            {/* Server sync status banner */}
            {galleryError ? (
              <View style={{ backgroundColor: 'rgba(255,60,60,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,60,60,0.25)', paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 14 }}>🔴</Text>
                <Text style={{ color: '#ff8080', fontSize: 11, flex: 1 }}>
                  Server unavailable — {galleryEntries.length > 0 ? 'showing cached data' : 'no cached data'}
                </Text>
                <TouchableOpacity
                  onPress={() => refreshGallery(galleryModeRef.current, { force: true })}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading gallery"
                >
                  <Text style={{ color: '#ff9f6b', fontSize: 11, fontWeight: '700' }}>Retry ↩</Text>
                </TouchableOpacity>
              </View>
            ) : galleryUpdatedAt && !galleryLoading ? (
              <View style={{ paddingHorizontal: 16, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 10 }}>🟢</Text>
                <Text style={{ color: '#4ade80', fontSize: 10 }}>
                  Synced {new Date(galleryUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            ) : null}
            {galleryLoading && galleryEntries.length === 0 ? (
              <GallerySkeleton />
            ) : visibleGalleryEntries.length === 0 && !galleryLoading ? (
              <View style={styles.galleryEmpty}>
                <Text style={styles.galleryEmptyLabel}>
                  {galleryMode === 'friends'
                    ? (friendsDeviceIds.size === 0
                        ? 'No friends yet — add some in the Gesser section! 👥'
                        : 'None of your friends have posted yet — check back soon!')
                    : 'No submissions yet — check back soon.'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={revealedGalleryEntries}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => renderGalleryEntry(item)}
                extraData={galleryExtraData}
                style={styles.galleryList}
                contentContainerStyle={[
                  styles.galleryListContent,
                  galleryLayout === 'grid' && { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }
                ]}
                showsVerticalScrollIndicator
                ListHeaderComponent={
                  <View>
                    <Text style={styles.galleryDescription}>
                      Emoji Painter Daily Sprint Gallery — every day you get 3 topics to paint and a different timer to sprint! All artworks are created entirely with emojis using our unique painting app. Vote up your favorites or vote down to help the community discover the best emoji art!
                    </Text>
                    {galleryEntries.length > 0 ? (
                      <View style={styles.galleryStatsRow}>
                        <Text style={styles.galleryStatsLabel}>{galleryStatsText}</Text>
                      </View>
                    ) : null}
                  </View>
                }
                removeClippedSubviews={false}
                maxToRenderPerBatch={3}
                updateCellsBatchingPeriod={150}
                windowSize={21}
                initialNumToRender={3}
                onEndReached={() => {
                  if (!galleryLoading && !galleryLoadingMore && currentGalleryPage < galleryPageCount) {
                    setGalleryLoadingMore(true);
                    setGalleryPage(prev => Math.min(prev + 1, galleryPageCount));
                    setTimeout(() => setGalleryLoadingMore(false), 300);
                  }
                }}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                  <>
                    {galleryLoadingMore ? (
                      <ActivityIndicator color="#ff9f6b" style={{ marginVertical: 16 }} />
                    ) : null}
                    {galleryPagination}
                  </>
                }
              />
            )}
          </View>

          {/* Guess Overlay — fullscreen fill-in-the-blank */}
          {guessOverlayVisible && selectedMysteryPainting && (() => {
            const _seed = selectedMysteryPainting.mysteryTopicId ?? 0;
            const _actualTopic = selectedMysteryPainting.mysteryTopicText || selectedMysteryPainting.topic || '';
            const { masked: _masked } = _maskTopic(_actualTopic, _seed);
            const _maskedChars = Array.from(_masked) as string[];

            type GCharItem = { type: 'blank'; blankIndex: number } | { type: 'revealed'; char: string };
            const _words: GCharItem[][] = [];
            let _curWord: GCharItem[] = [];
            let _bi = 0;
            _maskedChars.forEach(c => {
              if (c === ' ') { if (_curWord.length) { _words.push(_curWord); _curWord = []; } }
              else if (c === '_') { _curWord.push({ type: 'blank', blankIndex: _bi++ }); }
              else { _curWord.push({ type: 'revealed', char: c }); }
            });
            if (_curWord.length) _words.push(_curWord);
            const _totalBlanks = _bi;
            const _canSubmit = guessInput.length === _totalBlanks && _totalBlanks > 0;

            const _mysteryList = galleryEntries.filter(e => e.isMysteryPaint && !guessedPaintings.has(e.id));
            const _curIdx = _mysteryList.findIndex(e => e.id === selectedMysteryPainting.id);
            const _prevEntry = _curIdx > 0 ? _mysteryList[_curIdx - 1] : null;
            const _nextEntry = _curIdx < _mysteryList.length - 1 ? _mysteryList[_curIdx + 1] : null;
            const _navigateTo = (entry: DailyPaintGalleryEntry) => {
              setSelectedMysteryPainting(entry);
              setGuessInput('');
              setGuessFeedback(null);
              setTimeout(() => guessInputRef.current?.focus(), 80);
            };

            const _isVideo = Boolean(selectedMysteryPainting.imageUrl?.toLowerCase().match(/\.(mov|mp4|webm)(\?|$)/));
            const _boxSize = IS_IPAD ? 46 : 36;
            const _boxFont = IS_IPAD ? 22 : 17;

            // Win particle emojis per style
            const _particleEmojis = [
              ['🪙', '💰', '✨', '⭐'],
              ['⭐', '🌟', '💫', '✨'],
              ['🟦', '🟨', '🟩', '🟥', '🟪'],
              ['🎉', '🎊', '🥳', '🎈', '🎆'],
              ['✨', '💫', '🌟', '⚡'],
              ['❤️', '🧡', '💛', '💚', '💙', '💜'],
              ['⚡', '🔥', '💥', '✨', '🌪️'],
            ];
            const _pEmojis = _particleEmojis[guessWinStyleIdx] || _particleEmojis[0];

            const _isLandscape = false; // Always portrait: image top, controls bottom

            // Character box row renderer (shared for both layouts)
            const _renderBoxes = () => (
              <TouchableOpacity activeOpacity={1} onPress={() => guessInputRef.current?.focus()} style={{ alignItems: 'center', marginBottom: IS_IPAD ? 20 : 14 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: IS_IPAD ? 10 : 7 }}>
                  {_words.map((word, wi) => (
                    <View key={wi} style={{ flexDirection: 'row', gap: 4 }}>
                      {word.map((ch, ci) => {
                        if (ch.type === 'revealed') {
                          return (
                            <View key={ci} style={{ width: _boxSize, height: _boxSize, borderRadius: 9, backgroundColor: 'rgba(0,255,255,0.14)', borderWidth: 2, borderColor: 'rgba(0,255,255,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: '#0ff', fontSize: _boxFont, fontWeight: '800', fontFamily: 'vrtlfinal' }}>{ch.char.toUpperCase()}</Text>
                            </View>
                          );
                        }
                        const filled = guessInput[ch.blankIndex];
                        const isActive = !guessFeedback && ch.blankIndex === guessInput.length;
                        return (
                          <View key={ci} style={{ width: _boxSize, height: _boxSize, borderRadius: 9, backgroundColor: filled ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)', borderWidth: isActive ? 2.5 : 2, borderColor: isActive ? '#fff' : filled ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: '#fff', fontSize: _boxFont, fontWeight: '800', fontFamily: 'vrtlfinal' }}>{filled ? filled.toUpperCase() : ''}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            );

            // Bottom controls (submit / feedback / hint)
            const _renderControls = () => (
              <View>
                {/* Invisible input captures keystrokes for blank-fill boxes */}
                <TextInput
                  ref={guessInputRef}
                  style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
                  value={guessInput}
                  onChangeText={text => setGuessInput(text.replace(/\s/g, '').slice(0, _totalBlanks))}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!guessLoading && !guessFeedback}
                  maxLength={_totalBlanks}
                />
                {guessFeedback ? (
                  <View style={{ backgroundColor: guessFeedback.type === 'success' ? 'rgba(29,185,84,0.18)' : 'rgba(255,50,50,0.14)', borderWidth: 2, borderColor: guessFeedback.type === 'success' ? '#1db954' : '#f33', borderRadius: 16, padding: IS_IPAD ? 22 : 18, alignItems: 'center' }}>
                    <Text style={{ color: guessFeedback.type === 'success' ? '#1db954' : '#f55', fontSize: IS_IPAD ? 22 : 17, fontWeight: '800', fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                      {guessFeedback.message}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: IS_IPAD ? 14 : 12, marginTop: 6 }}>
                      {guessFeedback.type === 'success' ? 'Loading next mystery…' : 'Try again in a moment…'}
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={{ backgroundColor: _canSubmit && !guessLoading ? '#0ff' : '#1a1a1a', borderRadius: 16, padding: IS_IPAD ? 22 : 18, alignItems: 'center', borderWidth: 2, borderColor: _canSubmit ? '#0ff' : 'rgba(255,255,255,0.08)' }}
                    onPress={handleSubmitGuess}
                    disabled={!_canSubmit || guessLoading}
                    activeOpacity={0.8}
                  >
                    {guessLoading ? (
                      <ActivityIndicator size="small" color={_canSubmit ? '#000' : '#444'} />
                    ) : (
                      <Text style={{ color: _canSubmit ? '#000' : '#333', fontSize: IS_IPAD ? 21 : 17, fontWeight: '900', fontFamily: 'vrtlfinal' }}>
                        {_canSubmit ? 'Submit Guess ✓' : `Fill ${_totalBlanks - guessInput.length} blank${_totalBlanks - guessInput.length === 1 ? '' : 's'}`}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
                <Text style={{ color: '#2a2a2a', fontSize: 10, marginTop: 10, textAlign: 'center' }}>
                  Guess as many times as you like  •  Correct = +1 coin 🪙
                </Text>
              </View>
            );

            return (
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, backgroundColor: '#050505' }}
                pointerEvents="box-none"
              >
                {/* "All Done" full-screen message */}
                {guessAllDone && (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050505', zIndex: 200 }}>
                    <Text style={{ fontSize: IS_IPAD ? 64 : 52 }}>🎉</Text>
                    <Text style={{ color: '#0ff', fontSize: IS_IPAD ? 28 : 22, fontWeight: '900', fontFamily: 'vrtlfinal', textAlign: 'center', marginTop: 16 }}>All mysteries guessed!</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: IS_IPAD ? 16 : 13, marginTop: 10, textAlign: 'center' }}>Come back later for new posts 🌟</Text>
                  </View>
                )}

                {/* Win particle animation layer */}
                {guessWinVisible && (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }} pointerEvents="none">
                    {guessWinParticles.map((p, i) => {
                      const emoji = _pEmojis[i % _pEmojis.length];
                      const startX = screenWidth / 2 - 16;
                      const startY = screenHeight / 2 - 16;
                      const rotStr = p.rot.interpolate({ inputRange: [-12, 0, 12], outputRange: ['-720deg', '0deg', '720deg'] });
                      return (
                        <RNAnimated.Text
                          key={i}
                          style={{
                            position: 'absolute',
                            left: startX,
                            top: startY,
                            fontSize: IS_IPAD ? 28 : 22,
                            opacity: p.op,
                            transform: [
                              { translateX: p.tx },
                              { translateY: p.ty },
                              { scale: p.sc },
                              { rotate: rotStr },
                            ],
                          }}
                        >
                          {emoji}
                        </RNAnimated.Text>
                      );
                    })}
                  </View>
                )}

                {/* Main content — landscape vs portrait */}
                {_isLandscape ? (
                  // iPad landscape: image left, controls right
                  <View style={{ flex: 1, flexDirection: 'row' }}>
                    <View style={{ flex: 1.3, backgroundColor: '#000' }}>
                      {_isVideo ? (
                        <Video source={{ uri: selectedMysteryPainting.imageUrl }} style={{ flex: 1 }} resizeMode={ResizeMode.CONTAIN} shouldPlay isLooping isMuted useNativeControls={false} />
                      ) : (
                        <Image source={{ uri: selectedMysteryPainting.imageUrl }} style={{ flex: 1 }} resizeMode="contain" />
                      )}
                    </View>
                    <View style={{ flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 28, paddingTop: insets.top + 60, paddingBottom: insets.bottom + 20, justifyContent: 'center' }}>
                      <Text style={{ color: '#0ff', fontSize: 22, fontWeight: '900', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: 6 }}>🎲 Guess the Topic</Text>
                      {_mysteryList.length > 1 && (
                        <Text style={{ color: 'rgba(0,255,255,0.4)', fontSize: 12, textAlign: 'center', marginBottom: 20 }}>{_curIdx + 1} / {_mysteryList.length}</Text>
                      )}
                      {_renderBoxes()}
                      {_renderControls()}
                    </View>
                  </View>
                ) : (
                  // Portrait (iPhone + iPad portrait): image top, controls bottom
                  <View style={{ flex: 1 }}>
                    <View style={{ flex: 1, backgroundColor: '#000' }}>
                      {_isVideo ? (
                        <Video source={{ uri: selectedMysteryPainting.imageUrl }} style={{ flex: 1 }} resizeMode={ResizeMode.CONTAIN} shouldPlay isLooping isMuted useNativeControls={false} />
                      ) : (
                        <Image source={{ uri: selectedMysteryPainting.imageUrl }} style={{ flex: 1 }} resizeMode="contain" />
                      )}
                    </View>
                    <View style={{ backgroundColor: '#0a0a0a', borderTopWidth: 2, borderColor: '#0ff', paddingHorizontal: IS_IPAD ? 32 : 20, paddingTop: IS_IPAD ? 22 : 16, paddingBottom: insets.bottom + 20 }}>
                      <Text style={{ color: '#0ff', fontSize: IS_IPAD ? 22 : 18, fontWeight: '900', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: IS_IPAD ? 6 : 4 }}>🎲 Guess the Topic</Text>
                      {_mysteryList.length > 1 && (
                        <Text style={{ color: 'rgba(0,255,255,0.4)', fontSize: 11, textAlign: 'center', marginBottom: IS_IPAD ? 16 : 12 }}>{_curIdx + 1} / {_mysteryList.length}</Text>
                      )}
                      {_renderBoxes()}
                      {_renderControls()}
                    </View>
                  </View>
                )}

                {/* ❎ Close button — top right */}
                <TouchableOpacity
                  onPress={() => { Keyboard.dismiss(); setGuessOverlayVisible(false); setGuessFeedback(null); setGuessAllDone(false); }}
                  style={{ position: 'absolute', top: insets.top + 8, right: 14, padding: 10, zIndex: 150 }}
                >
                  <Text style={{ fontSize: IS_IPAD ? 32 : 26 }}>❎</Text>
                </TouchableOpacity>

                {/* ‹ Prev arrow — left edge, vertically centered */}
                <TouchableOpacity
                  onPress={() => _prevEntry && _navigateTo(_prevEntry)}
                  disabled={!_prevEntry}
                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 56, alignItems: 'center', justifyContent: 'center', zIndex: 50, opacity: _prevEntry ? 1 : 0 }}
                >
                  <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 28, width: 46, height: 56, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(0,255,255,0.3)' }}>
                    <Text style={{ color: '#0ff', fontSize: 30, fontWeight: '700', marginLeft: -3 }}>‹</Text>
                  </View>
                </TouchableOpacity>

                {/* › Next arrow — right edge, vertically centered */}
                <TouchableOpacity
                  onPress={() => _nextEntry && _navigateTo(_nextEntry)}
                  disabled={!_nextEntry}
                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 56, alignItems: 'center', justifyContent: 'center', zIndex: 50, opacity: _nextEntry ? 1 : 0 }}
                >
                  <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 28, width: 46, height: 56, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(0,255,255,0.3)' }}>
                    <Text style={{ color: '#0ff', fontSize: 30, fontWeight: '700', marginLeft: 3 }}>›</Text>
                  </View>
                </TouchableOpacity>
              </KeyboardAvoidingView>
            );
          })()}
          {/* Gallery Fullscreen Viewer — absolute overlay inside this Modal so iOS stacking works */}
          {(gallerySelectedEntry || gallerySelectedPassport) ? (
            <RNAnimated.View
              style={[
                styles.galleryViewerOverlay,
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  paddingTop: insets.top + 24,
                  paddingBottom: insets.bottom + 24,
                  opacity: galleryViewerModalOpacity,
                  transform: [{ scale: galleryViewerModalScale }]
                }
              ]}
            >
              <View style={styles.galleryViewerHeader}>
                <TouchableOpacity
                  style={styles.galleryViewerResetButton}
                  onPress={resetGalleryViewer}
                  accessibilityRole="button"
                  accessibilityLabel="Reset zoom"
                >
                  <Text style={styles.galleryViewerResetLabel}>⟳ Reset</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.galleryViewerCloseButton}
                  onPress={closeGalleryViewer}
                  accessibilityRole="button"
                  accessibilityLabel="Close viewer"
                >
                  <Text style={styles.galleryViewerCloseLabel}>❎</Text>
                </TouchableOpacity>
              </View>
              <GestureDetector gesture={galleryViewerGesture}>
                <View style={styles.galleryViewerBody}>
                  <Animated.View style={[styles.galleryViewerImageWrapper, galleryViewerAnimatedStyle]}>
                    {viewerImageUri ? (
                      viewerImageUri.toLowerCase().match(/\.(mov|mp4|webm)(\?|$)/) ? (
                        <Video
                          source={{ uri: viewerImageUri }}
                          style={styles.galleryViewerImage}
                          resizeMode={ResizeMode.CONTAIN}
                          shouldPlay
                          isLooping
                          isMuted={false}
                          useNativeControls={true}
                        />
                      ) : (
                        <Image source={{ uri: viewerImageUri }} style={styles.galleryViewerImage} resizeMode="contain" />
                      )
                    ) : null}
                  </Animated.View>
                </View>
              </GestureDetector>
              {viewerMode ? (
                <View style={styles.galleryViewerCaption}>
                  <Text style={styles.galleryViewerTopic}>{viewerTitle}</Text>
                  {viewerSubtitleLine ? (
                    <Text style={styles.galleryViewerTopicOriginal}>{viewerSubtitleLine}</Text>
                  ) : null}
                  {viewerSupplementLine ? (
                    <Text style={styles.galleryViewerTopicOriginal}>{viewerSupplementLine}</Text>
                  ) : null}
                  {/* Author row — passport portrait + name — tap opens profile overlay */}
                  {(viewerTravelerLabel || viewerEntry?.passportPortrait) ? (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}
                      activeOpacity={0.75}
                      onPress={() => viewerEntry?.deviceId ? setProfileOverlayEntry(viewerEntry) : undefined}
                    >
                      {viewerEntry?.passportPortrait ? (
                        <Image
                          source={{ uri: viewerEntry.passportPortrait }}
                          style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }}
                        />
                      ) : (
                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 14 }}>👤</Text>
                        </View>
                      )}
                      {viewerTravelerLabel ? <Text style={[styles.galleryViewerMeta, { flex: 1 }]}>{viewerTravelerLabel}{viewerEntry?.deviceId ? ' ›' : ''}</Text> : null}
                    </TouchableOpacity>
                  ) : null}
                  {viewerRunDate || viewerUsedTime ? (
                    <Text style={styles.galleryViewerMetaSecondary}>
                      {viewerRunDate ?? ''}
                      {viewerUsedTime ? `${viewerRunDate ? ' · ' : ''}⏱ ${viewerUsedTime}` : ''}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </RNAnimated.View>
          ) : null}

          {/* Profile Mini Overlay — shown when user taps passport portrait in fullscreen viewer */}
          {profileOverlayEntry ? (() => {
            const pEntry = profileOverlayEntry;
            const pName = pEntry.passportName?.trim() || 'Anonymous Painter';
            const pLbEntry = leaderboardEntriesRef.current.find(u => {
              const extras = u.extra ?? {};
              const candidates = [u.id, extras['machineId'], extras['machine_id'], extras['deviceId'], extras['device_id']];
              return candidates.some(c => typeof c === 'string' && c.toLowerCase() === (pEntry.deviceId ?? '').toLowerCase());
            });
            const pRank = pLbEntry?.rank ?? null;
            const pCoins = pLbEntry?.coinCount ?? null;
            const pUploads = typeof (pLbEntry?.extra as any)?.['upload_count'] === 'number' ? (pLbEntry?.extra as any)['upload_count'] : null;
            const pPortrait = pEntry.passportPortrait || pLbEntry?.imageUrl || null;
            return (
              <TouchableOpacity
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)', zIndex: 1200, alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={1}
                onPress={() => setProfileOverlayEntry(null)}
              >
                <TouchableOpacity
                  activeOpacity={1}
                  onPress={() => {}}
                  style={{ backgroundColor: '#0d0d0d', borderRadius: 20, padding: 24, alignItems: 'center', gap: 12, minWidth: 260, maxWidth: '85%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}
                >
                  {pPortrait ? (
                    <Image source={{ uri: pPortrait }} style={{ width: 90, height: 90, borderRadius: 45, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' }} />
                  ) : (
                    <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 40 }}>👤</Text>
                    </View>
                  )}
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{pName}</Text>
                  {pRank ? <Text style={{ color: '#FFD700', fontSize: 14 }}>🏆 Rank #{pRank}</Text> : null}
                  {pCoins != null ? <Text style={{ color: '#ff9f6b', fontSize: 13 }}>🪙 {pCoins} coins</Text> : null}
                  {pUploads != null ? <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>🖼 {pUploads} paintings</Text> : null}
                  <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 4 }}>Tap outside to close</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })() : null}
        </View>
      </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── fullscreen base (shared with other overlays) ──────────────────────────
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  fullscreenSheet: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '90%',
    backgroundColor: '#101010',
    borderRadius: 28,
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

  // ── gallery overlay / sheet ───────────────────────────────────────────────
  galleryOverlay: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    padding: 0,
    flex: 1,
  },
  gallerySheet: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    backgroundColor: '#111111',
    borderRadius: 0,
    paddingHorizontal: 24,
    gap: 16,
  },

  // ── gallery header ────────────────────────────────────────────────────────
  galleryHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: IS_IPAD ? 0 : 24,
  },
  galleryHeaderBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 12,
    flexWrap: 'wrap',
    paddingHorizontal: IS_IPAD ? 0 : 24,
  },
  galleryHeaderTitleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  galleryHeaderSpinner: {
    marginLeft: 6,
  },
  galleryHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  // ── gallery language ──────────────────────────────────────────────────────
  galleryLanguageToggle: {
    marginLeft: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#1f1f1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },
  galleryLanguageToggleFlag: {
    fontSize: 20,
  },
  galleryLanguageDropdown: {
    marginTop: -6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#181818',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a',
    gap: 4,
  },
  galleryLanguageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  galleryLanguageOptionActive: {
    backgroundColor: '#2b2b2b',
  },
  galleryLanguageOptionFlag: {
    fontSize: 18,
  },
  galleryLanguageOptionFlagActive: {
    transform: [{ scale: 1.05 }],
  },
  galleryLanguageOptionLabel: {
    color: '#f5f5f5',
    fontSize: 14,
    fontWeight: '500',
  },
  galleryLanguageOptionLabelActive: {
    color: '#ffdc82',
  },

  // ── gallery action buttons ────────────────────────────────────────────────
  galleryActionButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },
  galleryActionEmoji: {
    fontSize: 22,
    color: '#9fd5ff',
  },
  galleryActionEmojiProfile: {
    color: '#ffdc82',
  },
  galleryActionEmojiLeaderboard: {
    color: '#ffdc82',
  },
  galleryCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },

  // ── gallery error / empty ─────────────────────────────────────────────────
  galleryError: {
    backgroundColor: '#1c0f0f',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a1a1a',
  },
  galleryErrorLabel: {
    color: '#ff9f9f',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  galleryRetryButton: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#ff6b6b',
  },
  galleryRetryLabel: {
    color: '#111111',
    fontWeight: '700',
  },
  galleryEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  galleryEmptyLabel: {
    color: '#8e8e92',
    fontSize: 14,
    textAlign: 'center',
  },

  // ── gallery list ──────────────────────────────────────────────────────────
  galleryList: {
    flex: 1,
  },
  galleryListContent: {
    paddingVertical: 24,
    paddingBottom: 32,
    alignItems: 'center',
  },
  galleryDescription: {
    color: '#9ea0a4',
    fontSize: 13,
    marginBottom: 16,
    paddingHorizontal: 16,
    lineHeight: 19,
  },
  galleryStatsRow: {
    width: '100%',
    paddingHorizontal: 18,
    paddingBottom: 8,
    alignItems: 'center',
  },
  galleryStatsLabel: {
    color: '#9ca3af',
    fontSize: 13,
  },

  // ── gallery viewer overlay ────────────────────────────────────────────────
  galleryViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.97)',
    zIndex: 999,
    elevation: 999,
  },
  galleryViewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  galleryViewerResetButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#1f1f1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2d2d2d',
  },
  galleryViewerResetLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  galleryViewerCloseButton: {
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#1f1f1f',
  },
  galleryViewerCloseLabel: {
    color: '#ffffff',
    fontSize: 18,
  },
  galleryViewerBody: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  galleryViewerImageWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  galleryViewerImage: {
    width: '100%',
    aspectRatio: 1,
  },
  galleryViewerCaption: {
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
    gap: 6,
  },
  galleryViewerTopic: {
    color: '#ffdc82',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  galleryViewerTopicOriginal: {
    color: '#bbbbbb',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  galleryViewerMeta: {
    color: '#bdbdbd',
    fontSize: 13,
    textAlign: 'center',
  },
  galleryViewerMetaSecondary: {
    color: '#9ea0a4',
    fontSize: 12,
    textAlign: 'center',
  },
});
