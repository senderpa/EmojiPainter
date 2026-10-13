/**
 * GESSER FEATURE - Suggestions List Overlay
 *
 * Transparent overlay showing all topic suggestions with voting.
 * Features:
 * - View all suggestions sorted by score
 * - Upvote/downvote each suggestion
 * - See passport images of submitters
 * - Filter by status (all/pending/approved/rejected)
 * - Submit new suggestions with "+" button
 * - Optimistic UI updates for instant feedback
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Image, Modal } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import GesserApi from '../api/gesserClient';

interface SuggestionsListScreenProps {
  visible: boolean;
  onClose: () => void;
  deviceId: string;
  onOpenSubmit?: () => void;
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

const SuggestionsListScreen: React.FC<SuggestionsListScreenProps> = ({
  visible,
  onClose,
  deviceId,
  onOpenSubmit
}) => {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  useEffect(() => {
    if (visible) {
      loadSuggestions();
    } else {
      setErrorMessage(null);
    }
  }, [visible, filter]);

  const loadSuggestions = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      console.log('[SuggestionsListScreen] Loading suggestions with filter:', filter);
      const response = await GesserApi.listAllSuggestions(deviceId, filter, 100);

      const list = Array.isArray(response?.suggestions) ? response.suggestions : [];
      console.log('[SuggestionsListScreen] ✅ Received:', list.length, 'suggestions');

      if (list.length === 0) {
        const message = filter === 'all'
          ? 'No suggestions yet.\nBe the first to submit a topic!'
          : `No ${filter} suggestions yet.`;
        setErrorMessage(message);
        setSuggestions([]);
      } else {
        // Sort by score descending
        const sorted = [...list].sort((a, b) => b.score - a.score);
        setSuggestions(sorted);
      }
    } catch (error: any) {
      console.error('[SuggestionsListScreen] ❌ Error:', error);

      // Provide helpful error message
      let message = error.message || 'Failed to load suggestions';

      // If backend not configured, add instructions
      if (message.includes('Backend API') || message.includes('not configured') || message.includes('not available')) {
        message = '⚠️ Backend Not Set Up\n\nThe suggestions list backend needs to be configured.\n\nPlease upload these files to your server:\n• backend/gesser/list-suggestions.php\n• backend/gesser/vote-suggestion.php\n• Run database-migration.sql\n\nSee backend/gesser/README.md for details.';
      }

      setErrorMessage(message);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

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
    }).sort((a, b) => b.score - a.score)); // Re-sort by score

    try {
      await GesserApi.voteSuggestion(deviceId, suggestionId, vote);
      console.log('[SuggestionsListScreen] ✅ Vote submitted');
    } catch (error: any) {
      console.error('[SuggestionsListScreen] ❌ Vote failed:', error);
      // Revert on error
      loadSuggestions();
    }
  };

  const handleClose = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
  };

  const handleOpenSubmit = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    if (onOpenSubmit) {
      onOpenSubmit();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return '#0f0';
      case 'rejected': return '#f44';
      case 'pending': return '#fa0';
      default: return '#888';
    }
  };

  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Text style={styles.closeButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Topic Suggestions</Text>
          <TouchableOpacity style={styles.addButton} onPress={handleOpenSubmit}>
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterContainer}>
          {(['all', 'pending', 'approved', 'rejected'] as const).map((filterOption) => (
            <TouchableOpacity
              key={filterOption}
              style={[styles.filterTab, filter === filterOption && styles.filterTabActive]}
              onPress={() => {
                void Haptics.selectionAsync();
                setFilter(filterOption);
              }}
            >
              <Text style={[styles.filterTabText, filter === filterOption && styles.filterTabTextActive]}>
                {filterOption.charAt(0).toUpperCase() + filterOption.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content */}
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#0ff" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.centerContainer}>
            <Text style={styles.errorEmoji}>📋</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadSuggestions}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {suggestions.map((s, index) => (
              <View key={s.id} style={styles.suggestionCard}>
                {/* Rank Badge */}
                <View style={styles.rankBadge}>
                  <Text style={styles.rankText}>#{index + 1}</Text>
                </View>

                {/* Topic & Status */}
                <Text style={styles.topicText}>{s.topic}</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(s.status) + '20', borderColor: getStatusColor(s.status) }]}>
                  <Text style={[styles.statusText, { color: getStatusColor(s.status) }]}>
                    {s.status.toUpperCase()}
                  </Text>
                </View>

                {/* Submitter Info */}
                <View style={styles.submitterRow}>
                  {s.passportUrl ? (
                    <Image source={{ uri: s.passportUrl }} style={styles.passportImage} />
                  ) : (
                    <View style={[styles.passportImage, styles.passportPlaceholder]}>
                      <Text style={styles.passportPlaceholderText}>
                        {s.submittedBy.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.submitterInfo}>
                    <Text style={styles.submitterName}>{s.submittedBy}</Text>
                    <Text style={styles.submittedAt}>{formatDate(s.submittedAt)}</Text>
                  </View>
                </View>

                {/* Voting Section */}
                <View style={styles.votingSection}>
                  <TouchableOpacity
                    style={[styles.voteButton, s.userVote === 'up' && styles.voteButtonActive]}
                    onPress={() => handleVote(s.id, 'up')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.voteIcon, s.userVote === 'up' && styles.voteIconActive]}>👍</Text>
                    <Text style={[styles.voteCount, s.userVote === 'up' && styles.voteCountActive]}>
                      {s.upvotes}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.scoreContainer}>
                    <Text style={styles.scoreLabel}>Score</Text>
                    <Text style={[styles.scoreValue, { color: s.score > 0 ? '#0f0' : s.score < 0 ? '#f44' : '#888' }]}>
                      {s.score > 0 ? '+' : ''}{s.score}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.voteButton, s.userVote === 'down' && styles.voteButtonActiveDown]}
                    onPress={() => handleVote(s.id, 'down')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.voteIcon, s.userVote === 'down' && styles.voteIconActive]}>👎</Text>
                    <Text style={[styles.voteCount, s.userVote === 'down' && styles.voteCountActive]}>
                      {s.downvotes}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <View style={{ height: 100 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222'
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700'
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0ff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  addButtonText: {
    color: '#000',
    fontSize: 28,
    fontWeight: '700'
  },
  filterContainer: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222'
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    alignItems: 'center'
  },
  filterTabActive: {
    backgroundColor: '#0ff'
  },
  filterTabText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  filterTabTextActive: {
    color: '#000'
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  loadingText: {
    color: '#888',
    fontSize: 16,
    marginTop: 12,
    fontFamily: 'vrtlfinal'
  },
  errorEmoji: {
    fontSize: 64,
    marginBottom: 16
  },
  errorText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
    fontFamily: 'vrtlfinal'
  },
  retryButton: {
    backgroundColor: '#0ff',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12
  },
  retryButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    padding: 16,
    gap: 12
  },
  suggestionCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#333',
    marginBottom: 12
  },
  rankBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#0ff',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 12
  },
  rankText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  topicText: {
    color: '#0ff',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'vrtlfinal',
    marginBottom: 8,
    paddingRight: 60
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  submitterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16
  },
  passportImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2a2a2a'
  },
  passportPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  passportPlaceholderText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700'
  },
  submitterInfo: {
    flex: 1
  },
  submitterName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  submittedAt: {
    color: '#888',
    fontSize: 11,
    marginTop: 2
  },
  votingSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333'
  },
  voteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#2a2a2a'
  },
  voteButtonActive: {
    backgroundColor: '#0f0',
    borderWidth: 2,
    borderColor: '#0f0'
  },
  voteButtonActiveDown: {
    backgroundColor: '#f44',
    borderWidth: 2,
    borderColor: '#f44'
  },
  voteIcon: {
    fontSize: 20
  },
  voteIconActive: {
    fontSize: 22
  },
  voteCount: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  },
  voteCountActive: {
    color: '#000',
    fontSize: 18
  },
  scoreContainer: {
    alignItems: 'center',
    paddingHorizontal: 16
  },
  scoreLabel: {
    color: '#888',
    fontSize: 11,
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  scoreValue: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'vrtlfinal'
  }
});

export default SuggestionsListScreen;
