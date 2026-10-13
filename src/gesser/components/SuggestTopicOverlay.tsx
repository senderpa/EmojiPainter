/**
 * GESSER FEATURE - Suggest Topic Overlay (Redesigned with Voting List)
 *
 * Combined UI: Submit new suggestions + view/vote on all suggestions
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import GesserApi from '../api/gesserClient';
import { validateTopicFormat } from '../utils/masking';
import { getGesserCopy } from '../gesserTranslations';

interface SuggestTopicOverlayProps {
  visible: boolean;
  onClose: () => void;
  deviceId: string;
  language?: string;
  onSuccess?: (coinsAwarded: number) => void;
}

interface Suggestion {
  id: number;
  topic: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedBy: string;
  submittedByDeviceId: string;
  submittedAt: string;
  passportUrl?: string | null;
  upvotes: number;
  downvotes: number;
  score: number;
  userVote?: 'up' | 'down' | null;
}

const SuggestTopicOverlay: React.FC<SuggestTopicOverlayProps> = ({
  visible,
  onClose,
  deviceId,
  language,
  onSuccess
}) => {
  const insets = useSafeAreaInsets();
  const t = getGesserCopy(language);

  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<'newest' | 'mostLikes'>('newest');
  const [myPassportUrl, setMyPassportUrl] = useState<string | null>(null);

  // Load suggestions when overlay opens
  useEffect(() => {
    if (visible) {
      console.log('[SuggestTopicOverlay] Opening, loading all suggestions...');
      loadSuggestions();
    } else {
      // Reset on close
      setTopic('');
      setSuccessMessage(null);
    }
  }, [visible]);

  // Re-sort when sort mode changes
  useEffect(() => {
    if (suggestions.length > 0) {
      const sorted = [...suggestions].sort((a, b) => {
        if (sortMode === 'mostLikes') {
          return b.score - a.score;
        } else {
          return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
        }
      });
      setSuggestions(sorted);
    }
  }, [sortMode]);

  const loadSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    try {
      console.log('[SuggestTopicOverlay] Fetching pending suggestions...');
      const response = await GesserApi.listAllSuggestions(deviceId, 'pending', 100);
      console.log('[SuggestTopicOverlay] ✅ Loaded', response.count, 'pending suggestions');

      // Store my passport URL for display when I vote
      if (response.myPassportUrl) {
        setMyPassportUrl(response.myPassportUrl);
        console.log('[SuggestTopicOverlay] Got my passport URL:', response.myPassportUrl);
      }

      // Sort based on current sort mode
      const sorted = response.suggestions.sort((a, b) => {
        if (sortMode === 'mostLikes') {
          return b.score - a.score;
        } else {
          // newest first (default)
          return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
        }
      });

      // Patch missing passport URLs from device IDs — server always returns null
      const patched = sorted.map(s => ({
        ...s,
        passportUrl: s.passportUrl
          ?? (s.submittedByDeviceId
            ? `https://emojipainter.com/leaderboard/data/images/passport_${s.submittedByDeviceId}.jpg`
            : null),
        submittedBy: (s.submittedBy === 'Anonymous' && s.submittedByDeviceId)
          ? `Painter …${s.submittedByDeviceId.slice(-5)}`
          : s.submittedBy,
      }));

      setSuggestions(patched);
    } catch (error: any) {
      console.error('[SuggestTopicOverlay] ❌ Failed to load suggestions:', error);

      // Show user-friendly error
      if (error.message?.includes('Backend') || error.message?.includes('not configured')) {
        Alert.alert(t.errorTitle, error.message);
      }
    } finally {
      setLoadingSuggestions(false);
    }
  }, [deviceId, sortMode]);

  const handleVote = async (suggestionId: number, vote: 'up' | 'down') => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Optimistic UI update
    setSuggestions(prev => prev.map(s => {
      if (s.id !== suggestionId) return s;

      const wasUp = s.userVote === 'up';
      const wasDown = s.userVote === 'down';
      const isTogglingOff = s.userVote === vote;

      let newUpvotes = s.upvotes;
      let newDownvotes = s.downvotes;
      let newUserVote: 'up' | 'down' | null = vote;

      if (isTogglingOff) {
        // Toggle off
        if (vote === 'up') newUpvotes--;
        else newDownvotes--;
        newUserVote = null;
      } else {
        // Switching or new vote
        if (wasUp) newUpvotes--;
        if (wasDown) newDownvotes--;
        if (vote === 'up') newUpvotes++;
        else newDownvotes++;
      }

      return {
        ...s,
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        score: newUpvotes - newDownvotes,
        userVote: newUserVote
      };
    }).sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())); // Keep newest first

    try {
      await GesserApi.voteSuggestion(deviceId, suggestionId, vote);
      console.log('[SuggestTopicOverlay] ✅ Vote submitted');
    } catch (error: any) {
      console.error('[SuggestTopicOverlay] ❌ Vote failed:', error);
      // Revert on error
      loadSuggestions();
    }
  };

  const handleSubmit = async () => {
    // Validate
    const validation = validateTopicFormat(topic);
    if (!validation.valid) {
      Alert.alert(t.suggestInvalidTitle, validation.error || t.suggestInvalidDefault);
      return;
    }

    setLoading(true);

    try {
      const response = await GesserApi.submitTopicSuggestion(deviceId, topic);
      console.log('[SuggestTopicOverlay] Topic submitted:', response);

      setSuccessMessage(`✅ ${response.message}\n+${response.coinsAwarded} coins!`);
      setTopic('');

      if (onSuccess) {
        onSuccess(response.coinsAwarded);
      }

      // Reload suggestions to show the new one
      setTimeout(() => {
        setSuccessMessage(null);
        loadSuggestions();
      }, 2000);

    } catch (error: any) {
      console.error('[SuggestTopicOverlay] Submit error:', error);
      Alert.alert(t.errorTitle, error.message || t.suggestErrorSubmit);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return '#0f3';
      case 'rejected': return '#f44';
      case 'pending': return '#fa0';
      default: return '#666';
    }
  };

  const getStatusEmoji = (status: string) => {
    switch (status) {
      case 'approved': return '✅';
      case 'rejected': return '❌';
      case 'pending': return '⏳';
      default: return '❓';
    }
  };

  const [closeButtonEmoji, setCloseButtonEmoji] = useState('❎');

  const handleClose = () => {
    setCloseButtonEmoji('✳️');
    setTimeout(() => {
      setCloseButtonEmoji('❎');
    }, 300);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>{t.suggestTitle}</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>{closeButtonEmoji}</Text>
              </TouchableOpacity>
            </View>

            {/* Success Message */}
            {successMessage && (
              <View style={styles.successBox}>
                <Text style={styles.successText}>{successMessage}</Text>
              </View>
            )}

            {/* Submit Section - Always at top */}
            <View style={styles.submitSection}>
              <Text style={styles.submitTitle}>{t.suggestSubmitTitle}</Text>
              <Text style={styles.submitSubtitle}>{t.suggestSubmitSubtitle}</Text>

              <TextInput
                style={styles.input}
                value={topic}
                onChangeText={setTopic}
                placeholder={t.suggestPlaceholder}
                placeholderTextColor="#666"
                maxLength={50}
                autoCapitalize="words"
                autoCorrect={false}
                editable={!loading}
              />

              <Text style={styles.charCount}>{topic.length}/50</Text>

              <TouchableOpacity
                style={[
                  styles.submitButton,
                  (!topic.trim() || loading) && styles.submitButtonDisabled
                ]}
                onPress={handleSubmit}
                disabled={!topic.trim() || loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.submitButtonText}>{t.suggestButton}</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* All Suggestions List */}
            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>{t.suggestListHeader} ({suggestions.length})</Text>
              <TouchableOpacity onPress={loadSuggestions} disabled={loadingSuggestions}>
                <Text style={styles.refreshButton}>{loadingSuggestions ? '⏳' : '🔄'}</Text>
              </TouchableOpacity>
            </View>

            {/* Sort Selector */}
            <View style={styles.sortContainer}>
              <Text style={styles.sortLabel}>{t.sortLabel}</Text>
              <View style={styles.sortButtons}>
                <TouchableOpacity
                  style={[styles.sortButton, sortMode === 'newest' && styles.sortButtonActive]}
                  onPress={() => setSortMode('newest')}
                >
                  <Text style={[styles.sortButtonText, sortMode === 'newest' && styles.sortButtonTextActive]}>
                    {t.sortNewest}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sortButton, sortMode === 'mostLikes' && styles.sortButtonActive]}
                  onPress={() => setSortMode('mostLikes')}
                >
                  <Text style={[styles.sortButtonText, sortMode === 'mostLikes' && styles.sortButtonTextActive]}>
                    {t.sortMostLikes}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {loadingSuggestions ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0ff" />
                <Text style={styles.loadingText}>{t.suggestLoading}</Text>
              </View>
            ) : suggestions.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>{t.suggestEmptyTitle}</Text>
                <Text style={styles.emptySubtext}>{t.suggestEmptyHint}</Text>
              </View>
            ) : (
              <ScrollView style={styles.suggestionsList} showsVerticalScrollIndicator={true}>
                {suggestions.map((suggestion, index) => (
                  <View key={suggestion.id} style={styles.suggestionCard}>
                    {/* Rank Badge */}
                    <View style={[styles.rankBadge, { backgroundColor: index < 3 ? '#fa0' : '#333' }]}>
                      <Text style={styles.rankText}>#{index + 1}</Text>
                    </View>

                    {/* Topic */}
                    <Text style={styles.suggestionTopic}>{suggestion.topic}</Text>

                    {/* Submitter Info - Leaderboard Style */}
                    <View style={styles.submitterRow}>
                      {suggestion.passportUrl ? (
                        <Image
                          source={{ uri: suggestion.passportUrl }}
                          style={styles.submitterPassport}
                        />
                      ) : (
                        <View style={styles.submitterPassportPlaceholder}>
                          <Text style={styles.submitterPassportPlaceholderText}>👤</Text>
                        </View>
                      )}
                      <View style={styles.submitterInfo}>
                        <Text style={styles.submitterName}>{suggestion.submittedBy}</Text>
                        <Text style={styles.submittedDate}>
                          {new Date(suggestion.submittedAt).toLocaleDateString()}
                        </Text>
                      </View>
                    </View>

                    {/* Voting Row - Left: User passport, Right: Vote buttons */}
                    <View style={styles.votingRow}>
                      {/* LEFT: User passport (always show if available) */}
                      <View style={styles.userSection}>
                        {myPassportUrl ? (
                          <Image
                            source={{ uri: myPassportUrl }}
                            style={[
                              styles.userPassportMini,
                              suggestion.userVote && styles.userPassportVoted
                            ]}
                          />
                        ) : (
                          <View style={styles.userPassportPlaceholder}>
                            <Text style={styles.userPassportPlaceholderText}>👤</Text>
                          </View>
                        )}
                      </View>

                      {/* RIGHT: Vote buttons side by side */}
                      <View style={styles.voteButtonsContainer}>
                        <View style={styles.voteGroup}>
                          <TouchableOpacity
                            style={[
                              styles.voteButton,
                              suggestion.userVote === 'up' && styles.voteButtonActive
                            ]}
                            onPress={() => handleVote(suggestion.id, 'up')}
                          >
                            <Text style={styles.voteButtonText}>👍</Text>
                          </TouchableOpacity>
                          <Text style={styles.voteCount}>{suggestion.upvotes}</Text>
                        </View>

                        <View style={styles.voteGroup}>
                          <TouchableOpacity
                            style={[
                              styles.voteButton,
                              suggestion.userVote === 'down' && styles.voteButtonActive
                            ]}
                            onPress={() => handleVote(suggestion.id, 'down')}
                          >
                            <Text style={styles.voteButtonText}>👎</Text>
                          </TouchableOpacity>
                          <Text style={styles.voteCount}>{suggestion.downvotes}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  overlay: {
    flex: 1,
    backgroundColor: '#0e1116'
  },
  content: {
    flex: 1,
    backgroundColor: '#0e1116'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2f3c'
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff'
  },
  closeButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent'
  },
  closeButtonText: {
    fontSize: 28,
    color: '#fff'
  },
  successBox: {
    backgroundColor: '#0f3',
    margin: 20,
    padding: 16,
    borderRadius: 10
  },
  successText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  submitSection: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#171a24',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2f3c'
  },
  submitTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6
  },
  submitSubtitle: {
    fontSize: 13,
    color: '#a3a7b3',
    marginBottom: 14
  },
  input: {
    backgroundColor: '#0e1116',
    borderWidth: 1,
    borderColor: '#2a2f3c',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    marginBottom: 8
  },
  charCount: {
    fontSize: 11,
    color: '#666',
    textAlign: 'right',
    marginBottom: 10
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  infoText: {
    fontSize: 11,
    color: '#0ff',
    flex: 1,
    textAlign: 'center'
  },
  submitButton: {
    backgroundColor: '#3b82f6',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center'
  },
  submitButtonDisabled: {
    backgroundColor: '#2a2f3c',
    opacity: 0.6
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff'
  },
  divider: {
    height: 1,
    backgroundColor: '#2a2f3c',
    marginHorizontal: 20,
    marginVertical: 20
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  listTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff'
  },
  refreshButton: {
    fontSize: 20
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center'
  },
  loadingText: {
    fontSize: 14,
    color: '#0ff',
    marginTop: 12
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center'
  },
  emptyText: {
    fontSize: 18,
    color: '#666',
    marginBottom: 8
  },
  emptySubtext: {
    fontSize: 14,
    color: '#444'
  },
  suggestionsList: {
    flex: 1,
    paddingHorizontal: 20
  },
  suggestionCard: {
    backgroundColor: '#171a24',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2f3c'
  },
  rankBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12
  },
  rankText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000'
  },
  suggestionTopic: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0ff',
    marginBottom: 8,
    marginRight: 60 // Space for rank badge
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 12
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#000'
  },
  submitterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#0e1116',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2f3c'
  },
  submitterPassport: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#171a24',
    borderWidth: 2,
    borderColor: '#3b82f6'
  },
  submitterPassportPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#171a24',
    borderWidth: 2,
    borderColor: '#2a2f3c',
    justifyContent: 'center',
    alignItems: 'center'
  },
  submitterPassportPlaceholderText: {
    fontSize: 20
  },
  submitterInfo: {
    flex: 1,
    gap: 2
  },
  submitterName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff'
  },
  submittedDate: {
    fontSize: 11,
    color: '#a3a7b3'
  },
  votingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  voteButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  voteGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  voteButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#171a24',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2f3c'
  },
  voteButtonActive: {
    borderColor: '#3b82f6',
    backgroundColor: '#1e2a45'
  },
  voteButtonText: {
    fontSize: 18
  },
  voteCount: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#a3a7b3',
    minWidth: 20
  },
  userPassportMini: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#2a2f3c',
    backgroundColor: '#171a24'
  },
  userPassportVoted: {
    borderColor: '#3b82f6',
    borderWidth: 2
  },
  userPassportPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#171a24',
    borderWidth: 2,
    borderColor: '#2a2f3c',
    alignItems: 'center',
    justifyContent: 'center'
  },
  userPassportPlaceholderText: {
    fontSize: 16
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#171a24',
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2f3c'
  },
  sortLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff'
  },
  sortButtons: {
    flexDirection: 'row',
    gap: 8
  },
  sortButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#0e1116',
    borderWidth: 1,
    borderColor: '#2a2f3c'
  },
  sortButtonActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6'
  },
  sortButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a3a7b3'
  },
  sortButtonTextActive: {
    color: '#fff'
  }
});

export default SuggestTopicOverlay;
