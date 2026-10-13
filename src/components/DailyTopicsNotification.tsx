import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import type { DailyPrompt } from '../types/dailyPrompt';
import type { InfoLanguage } from '../lib/infoCopy';
import { getTopicMetadata } from '../lib/dailyTopics';
import type { GalleryVoteUpdate } from '../lib/galleryVoteUpdates';
import { formatGalleryVoteUpdate } from '../lib/galleryVoteUpdates';

// Localized "Today's topics are:" headline — same languages as the info panel
// (and the topic translations themselves).
const HEADLINE: Record<InfoLanguage, string> = {
  en: "Today's topics are:",
  de: 'Die heutigen Themen sind:',
  ru: 'Темы на сегодня:',
  zh: '今日主题：',
  ko: '오늘의 주제:',
  ja: '今日のお題：',
  fr: 'Les sujets du jour :',
  it: 'I temi di oggi sono:'
};

interface DailyTopicsNotificationProps {
  visible: boolean;
  prompts: DailyPrompt[];
  language: InfoLanguage;
  topInset: number;
  uploadedTopics: Set<string>;
  voteUpdate?: GalleryVoteUpdate | null;
  onTopicPress: (prompt: DailyPrompt) => void;
  onDismiss: () => void;
  /** "Show" button on a vote-update panel — jump to the gallery entry that changed. */
  onShowInGallery?: (entryId: string | undefined) => void;
}

/**
 * iOS-notification-style panel shown at the TOP of the paint screen on cold
 * app open (at most once per 24h — gating lives in PaintScreen): app logo,
 * a localized "Today's topics are:" line, then the 3 daily topics fully
 * written out as tappable pills. Tapping a pill starts that topic challenge;
 * tapping anywhere else (or starting to paint) hides the panel instantly.
 */
const DailyTopicsNotification: React.FC<DailyTopicsNotificationProps> = ({
  visible,
  prompts,
  language,
  topInset,
  uploadedTopics,
  voteUpdate = null,
  onTopicPress,
  onDismiss,
  onShowInGallery
}) => {
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      slideAnim.setValue(0);
      return;
    }
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [slideAnim, visible]);

  if (!visible || (prompts.length === 0 && !voteUpdate)) {
    return null;
  }

  const hasNewVotes = Boolean(voteUpdate && voteUpdate.newUpvotes + voteUpdate.newDownvotes > 0);
  const headline = voteUpdate
    ? (hasNewVotes ? 'Your artwork received new votes!' : "Your artwork's votes changed!")
    : (HEADLINE[language] ?? HEADLINE.en);
  const voteCopy = voteUpdate ? formatGalleryVoteUpdate(voteUpdate) : null;
  const panelStyle = {
    opacity: slideAnim,
    transform: [
      { translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [-160, 0] }) }
    ]
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      {/* Tap anywhere outside the panel → hide immediately */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        accessibilityLabel={voteUpdate ? 'Dismiss gallery vote update' : 'Dismiss daily topics'}
      />
      <Animated.View style={[styles.panel, voteUpdate && styles.votePanel, { top: topInset + 58 }, panelStyle]} pointerEvents="box-none">
        {/* Tapping the panel itself (anywhere that isn't a button below) dismisses
            immediately too — this used to rely on the touch falling through to the
            full-screen Pressable behind the panel, which it did not reliably do, so
            the panel only ever went away when a stroke started (dismissPromptsForInteraction). */}
        <Pressable onPress={onDismiss} accessibilityLabel="Dismiss">
          <View style={styles.headerRow}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.headline}>{headline}</Text>
          </View>
          {voteUpdate && voteCopy ? (
            <View style={styles.voteSummary}>
              <View style={styles.voteCountRow}>
                {voteUpdate.newUpvotes > 0 ? (
                  <View style={[styles.voteCountPill, styles.upvotePill]}>
                    <Text style={styles.upvoteText}>{`▲ +${voteUpdate.newUpvotes}`}</Text>
                  </View>
                ) : null}
                {voteUpdate.newDownvotes > 0 ? (
                  <View style={[styles.voteCountPill, styles.downvotePill]}>
                    <Text style={styles.downvoteText}>{`▼ +${voteUpdate.newDownvotes}`}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.voteChangeText}>{voteCopy.changeText}</Text>
              <Text style={styles.voteTotalText}>{voteCopy.totalText}</Text>
              {onShowInGallery ? (
                <TouchableOpacity
                  style={styles.showButton}
                  onPress={() => onShowInGallery(voteUpdate.topEntryId)}
                  accessibilityRole="button"
                  accessibilityLabel="Show in gallery"
                >
                  <Text style={styles.showButtonText}>👁️ Show in Gallery</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.dismissHint}>Tap anywhere else to close</Text>
            </View>
          ) : null}
        </Pressable>
        {!voteUpdate && prompts.map((prompt) => {
          const metadata = getTopicMetadata(prompt.topic ?? '');
          const translatedTopic = metadata?.translations?.[language] || metadata?.topic || prompt.topic;
          const alreadyUploaded = uploadedTopics.has(prompt.topic);
          return (
            <TouchableOpacity
              key={`${prompt.emoji}-${prompt.topic}`}
              style={styles.topicPill}
              onPress={() => onTopicPress(prompt)}
              disabled={alreadyUploaded}
              accessibilityRole="button"
              accessibilityLabel={`Start topic ${translatedTopic}`}
            >
              <Text style={styles.topicEmoji}>{prompt.emoji}</Text>
              <Text style={[styles.topicText, alreadyUploaded && styles.topicTextDisabled]}>
                {translatedTopic}
              </Text>
              <Text style={styles.topicHint}>{`${prompt.timeMinutes ?? 30}m`}</Text>
            </TouchableOpacity>
          );
        })}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    alignSelf: 'center',
    width: '92%',
    maxWidth: 420,
    borderRadius: 22,
    backgroundColor: 'rgba(8, 8, 8, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
    zIndex: 1000
  },
  votePanel: {
    minHeight: 196
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 2
  },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 7
  },
  headline: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    flex: 1
  },
  topicPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(28, 28, 28, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f',
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 8
  },
  topicEmoji: {
    fontSize: 14
  },
  topicText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
    flex: 1
  },
  topicTextDisabled: {
    color: '#777'
  },
  topicHint: {
    color: '#ff9f6b',
    fontWeight: '700',
    fontSize: 11,
    marginLeft: 4
  },
  voteSummary: {
    flex: 1,
    minHeight: 134,
    borderRadius: 16,
    backgroundColor: 'rgba(28, 28, 28, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f',
    paddingHorizontal: 14,
    paddingVertical: 13,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7
  },
  voteCountRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 9
  },
  voteCountPill: {
    minWidth: 70,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    alignItems: 'center'
  },
  upvotePill: { backgroundColor: 'rgba(80, 220, 135, 0.14)' },
  downvotePill: { backgroundColor: 'rgba(255, 100, 100, 0.13)' },
  upvoteText: { color: '#69e69b', fontSize: 15, fontWeight: '900' },
  downvoteText: { color: '#ff9999', fontSize: 15, fontWeight: '900' },
  voteChangeText: { color: '#fff', fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  voteTotalText: { color: '#ffbd8d', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  dismissHint: { color: '#6f6f6f', fontSize: 9, fontWeight: '600', marginTop: 1 },
  showButton: {
    marginTop: 2,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(105, 230, 155, 0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(105, 230, 155, 0.4)'
  },
  showButtonText: { color: '#69e69b', fontSize: 13, fontWeight: '800' }
});

export default DailyTopicsNotification;
