// @ts-nocheck
/**
 * ChallengeOverlay — pure presentational component for Challenge modals.
 *
 * Renders:
 *   1. Challenge Cancel Confirmation Dialog
 *   2. Challenge Complete modal (sprint summary + upload)
 *   3. Challenge Confirm Preview modal (community inspiration fullscreen)
 *
 * All state arrives via props — no internal side-effects.
 */
import React from 'react';
import {
  ActivityIndicator,
  Animated as RNAnimated,
  Image,
  Modal,
  Platform,
  TouchableOpacity,
  View,
} from 'react-native';
import { Video } from 'expo-av';
import { AppText as Text } from '../../emoji/AppText';
import LogoAnimationLoop from '../../components/LogoAnimationLoop';
import { formatPrompt } from '../../types/dailyPrompt';
import type { UseChallengeResult } from './useChallenge';
import type { EdgeInsets } from 'react-native-safe-area-context';
import type { DailyPrompt } from '../../types/dailyPrompt';
import {
  canUploadChallengeEarly,
  getChallengeStrokesRemaining,
  MIN_CHALLENGE_STROKES,
} from '../../lib/challengeUploadEligibility';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;
const LARGE_HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 } as const;
// ─── Props ───────────────────────────────────────────────────────────────────

export interface ChallengeOverlayProps extends UseChallengeResult {
  insets: EdgeInsets;
  styles: any;
  // Challenge complete extra state (still owned by PaintScreen while
  // finalizeChallenge lives there)
  challengeSnapshotUri: string | null;
  challengeCaptureLoading: boolean;
  challengeUploadLoading: boolean;
  challengeUploadNotice: { variant: 'success' | 'error'; message: string } | null;
  challengeMinimumStrokesMet: boolean;
  coinCount: number;
  coinBurstAnimatedStyle: any;
  coinStarburst: string | null;
  infoLanguage: string;
  // Challenge complete actions
  dismissChallengeComplete: () => void;
  openChallengeUpload: () => void;
  resumePaintingFromComplete: () => void;
  handleRetryChallenge: () => void;
  // Challenge cancel dialog
  showChallengeCancelDialog: boolean;
  handleChallengeCancelStop: () => void;
  handleChallengeEarlyUpload: () => void;
  handleChallengeContinue: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

const ChallengeOverlay: React.FC<ChallengeOverlayProps> = (props) => {
  const {
    insets,
    styles,
    // Core challenge state (from useChallenge)
    activeChallenge,
    challengeCompleteVisible,
    challengeRemainingMs,
    challengeConfirmPreviewEntry,
    closeChallengeConfirmPreview,
    mysteryTopicSelected,
    mysteryTopic,
    challengeStrokeCount,
    // Complete modal state
    challengeSnapshotUri,
    challengeCaptureLoading,
    challengeUploadLoading,
    challengeUploadNotice,
    challengeMinimumStrokesMet,
    coinCount,
    coinBurstAnimatedStyle,
    coinStarburst,
    infoLanguage,
    dismissChallengeComplete,
    openChallengeUpload,
    resumePaintingFromComplete,
    handleRetryChallenge,
    // Cancel dialog
    showChallengeCancelDialog,
    handleChallengeCancelStop,
    handleChallengeEarlyUpload,
    handleChallengeContinue,
  } = props;
  const earlyUploadUnlocked = canUploadChallengeEarly(challengeStrokeCount);
  const earlyUploadStrokesRemaining = getChallengeStrokesRemaining(challengeStrokeCount);

  return (
    <>
      {/* ── Challenge Cancel Confirmation Dialog ─────────────────────────── */}
      <Modal
        visible={showChallengeCancelDialog}
        animationType="fade"
        transparent
        onRequestClose={handleChallengeContinue}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24, width: '85%', maxWidth: 400, borderWidth: 2, borderColor: '#ffa500' }}>
            <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 12, fontFamily: 'vrtlfinal' }}>
              Cancel Challenge?
            </Text>
            <Text style={{ fontSize: 14, color: '#ccc', textAlign: 'center', marginBottom: 24, lineHeight: 20, fontFamily: 'vrtlfinal' }}>
              What would you like to do with your painting?
            </Text>
            <View style={{ gap: 10 }}>
              <TouchableOpacity
                style={{
                  backgroundColor: earlyUploadUnlocked ? '#0ff' : '#3d4545',
                  paddingVertical: 14,
                  borderRadius: 10,
                  justifyContent: 'center',
                  alignItems: 'center',
                  opacity: earlyUploadUnlocked ? 1 : 0.65,
                }}
                onPress={handleChallengeEarlyUpload}
                disabled={!earlyUploadUnlocked}
                accessibilityState={{ disabled: !earlyUploadUnlocked }}
              >
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: earlyUploadUnlocked ? '#000' : '#aaa', fontFamily: 'vrtlfinal' }}>Upload Early</Text>
                <Text style={{ fontSize: 11, color: earlyUploadUnlocked ? '#222' : '#bbb', marginTop: 2, fontFamily: 'vrtlfinal' }}>
                  {earlyUploadUnlocked
                    ? 'Submit what you have so far'
                    : `Paint ${earlyUploadStrokesRemaining} more emoji stroke${earlyUploadStrokesRemaining === 1 ? '' : 's'}`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: 14, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }}
                onPress={handleChallengeContinue}
              >
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#fff', fontFamily: 'vrtlfinal' }}>Keep Painting</Text>
                <Text style={{ fontSize: 11, color: '#aaa', marginTop: 2, fontFamily: 'vrtlfinal' }}>Continue working on this challenge</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: 'rgba(200,50,50,0.6)', paddingVertical: 14, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,100,100,0.5)' }}
                onPress={handleChallengeCancelStop}
              >
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#ff9999', fontFamily: 'vrtlfinal' }}>Cancel Challenge</Text>
                <Text style={{ fontSize: 11, color: '#ffaaaa', marginTop: 2, fontFamily: 'vrtlfinal' }}>Discard and exit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Challenge Complete modal ─────────────────────────────────────── */}
      <Modal
        visible={challengeCompleteVisible}
        animationType="fade"
        transparent
        onRequestClose={dismissChallengeComplete}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={styles.challengeCompleteOverlay}>
          <View style={styles.challengeCompleteCard}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <LogoAnimationLoop size={120} frameInterval={100} isMuted={false} />
            </View>
            <Text style={styles.challengeCompleteTitle}>Sprint complete!</Text>
            {activeChallenge ? (
              <Text style={styles.challengeCompleteSubtitle}>
                {/* Show the PAINTER their own topic in full. It used to be masked
                    here too, but the mask exists to stop VIEWERS guessing — the
                    person on this screen picked it. The 🔒 line below still spells
                    out that others only ever see the masked form. */}
                {mysteryTopicSelected && mysteryTopic !== null
                  ? `🎲 ${mysteryTopic.topic}`
                  : formatPrompt(activeChallenge.prompt, infoLanguage)}
              </Text>
            ) : null}
            {mysteryTopicSelected && mysteryTopic !== null ? (
              <Text style={{ color: 'rgba(0,255,255,0.55)', fontSize: IS_IPAD ? 13 : 11, textAlign: 'center', marginTop: 4, fontFamily: 'vrtlfinal' }}>
                🔒 Only you see this — others will guess it from your art
              </Text>
            ) : null}
            {challengeMinimumStrokesMet ? (
              <RNAnimated.View style={[styles.challengeCoinBurst, coinBurstAnimatedStyle]} pointerEvents="none">
                <Text style={styles.challengeCoinBurstLabel}>+1 🪙</Text>
              </RNAnimated.View>
            ) : null}
            <View style={styles.challengeCompletePreviewWrapper}>
              {challengeCaptureLoading ? (
                <ActivityIndicator color="#ff6b6b" style={styles.challengeCompleteSpinner} />
              ) : challengeSnapshotUri ? (
                <Image source={{ uri: challengeSnapshotUri }} style={styles.challengeCompletePreview} resizeMode="cover" />
              ) : (
                <View style={styles.challengeCompletePlaceholder}>
                  <Text style={styles.challengeCompletePlaceholderText}>Great work!</Text>
                </View>
              )}
            </View>
            <View style={styles.challengeCoinRow}>
              <Text style={styles.challengeCoinTotal}>Coins: {coinCount}</Text>
              {coinStarburst ? <Text style={styles.challengeCoinStars}>{coinStarburst}</Text> : null}
            </View>
            {!challengeMinimumStrokesMet ? (
              <Text style={styles.challengeMinimumNotice}>
                {`Paint at least ${MIN_CHALLENGE_STROKES} strokes to upload your sprint.`}
              </Text>
            ) : null}
            {challengeUploadNotice ? (
              <Text
                style={
                  challengeUploadNotice.variant === 'error'
                    ? styles.challengeUploadError
                    : styles.challengeUploadSuccess
                }
              >
                {challengeUploadNotice.message}
              </Text>
            ) : null}
            <View style={styles.challengeCompleteActions}>
              {challengeMinimumStrokesMet ? (
                <TouchableOpacity
                  style={[styles.challengeCompletePrimary, (challengeCaptureLoading || challengeUploadLoading) && styles.disabledButton]}
                  onPress={openChallengeUpload}
                  disabled={challengeCaptureLoading || challengeUploadLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Upload to public gallery"
                >
                  {challengeUploadLoading ? (
                    <ActivityIndicator color="#1a0e08" style={styles.challengeCompletePrimarySpinner} />
                  ) : (
                    <Text style={styles.challengeCompletePrimaryLabel}>Upload to Gallery</Text>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.challengeCompletePrimary, styles.challengeCompleteCancelButton]}
                  onPress={dismissChallengeComplete}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss sprint summary"
                >
                  <Text style={styles.challengeCompletePrimaryLabel}>Cancel</Text>
                </TouchableOpacity>
              )}
              {challengeRemainingMs > 0 && (
                <TouchableOpacity
                  style={[
                    styles.challengeCompleteSecondary,
                    { backgroundColor: 'rgba(0,255,150,0.15)', borderColor: 'rgba(0,255,150,0.5)', borderWidth: 1 },
                    (challengeCaptureLoading || challengeUploadLoading) && styles.disabledButton,
                  ]}
                  onPress={resumePaintingFromComplete}
                  disabled={challengeCaptureLoading || challengeUploadLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Go back and paint more"
                >
                  <Text style={[styles.challengeCompleteSecondaryLabel, { color: '#00ff96' }]}>🎨 Paint More</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.challengeCompleteSecondary, (challengeCaptureLoading || challengeUploadLoading) && styles.disabledButton]}
                onPress={handleRetryChallenge}
                disabled={challengeCaptureLoading || challengeUploadLoading}
                accessibilityRole="button"
                accessibilityLabel="Retry this sprint"
              >
                <Text style={styles.challengeCompleteSecondaryLabel}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Challenge Confirm Preview (community inspiration fullscreen) ───── */}
      <Modal
        visible={challengeConfirmPreviewEntry !== null && !challengeCompleteVisible}
        animationType="fade"
        transparent
        onRequestClose={closeChallengeConfirmPreview}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={[styles.fullscreenOverlay, styles.challengeConfirmPreviewOverlay]}>
          <View
            style={[
              styles.challengeConfirmPreviewSheet,
              { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom + 16, 24) },
            ]}
          >
            {challengeConfirmPreviewEntry ? (
              <>
                <View style={styles.challengeConfirmPreviewHeader}>
                  <Text style={styles.challengeConfirmPreviewTitle}>Community Inspiration</Text>
                  <TouchableOpacity
                    onPress={closeChallengeConfirmPreview}
                    accessibilityRole="button"
                    accessibilityLabel="Close preview"
                    hitSlop={LARGE_HIT_SLOP}
                  >
                    <Text style={styles.fullscreenClose}>❎</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.challengeConfirmPreviewImageWrapper}>
                  {(() => {
                    const mediaUrl = challengeConfirmPreviewEntry.rawUrl || challengeConfirmPreviewEntry.imageUrl;
                    const isVideo = mediaUrl && (mediaUrl.toLowerCase().endsWith('.mp4') || mediaUrl.toLowerCase().endsWith('.mov'));
                    if (!mediaUrl) {
                      return (
                        <View style={styles.challengeConfirmPreviewFullscreenPlaceholder}>
                          <Text style={styles.challengeConfirmPreviewPlaceholderLabel}>Media unavailable</Text>
                        </View>
                      );
                    }
                    if (isVideo) {
                      return (
                        <Video
                          source={{ uri: mediaUrl }}
                          style={styles.challengeConfirmPreviewFullscreenImage}
                          resizeMode="contain"
                          shouldPlay
                          isLooping
                          isMuted={false}
                          volume={0.5}
                          useNativeControls={false}
                        />
                      );
                    }
                    return (
                      <Image
                        source={{ uri: mediaUrl }}
                        style={styles.challengeConfirmPreviewFullscreenImage}
                        resizeMode="contain"
                      />
                    );
                  })()}
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
};

export default React.memo(ChallengeOverlay);
