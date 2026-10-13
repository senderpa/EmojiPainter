/**
 * GESSER FEATURE - Topic Review Card
 *
 * UI card for reviewing a pending topic submission.
 * Shows topic text and approve/reject buttons.
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';

import GesserApi from '../api/gesserClient';
import type { GesserPendingTopic } from '../types';

interface TopicReviewCardProps {
  topic: GesserPendingTopic;
  deviceId: string;
  onReviewComplete: (approved: boolean, coinsAwarded: number) => void;
}

const TopicReviewCard: React.FC<TopicReviewCardProps> = ({
  topic,
  deviceId,
  onReviewComplete
}) => {
  const [loading, setLoading] = useState(false);

  const handleReview = async (action: 'approve' | 'reject') => {
    setLoading(true);

    try {
      const response = await GesserApi.approveTopic(deviceId, topic.id, action);

      // Success!
      onReviewComplete(action === 'approve', response.coinsAwarded);

    } catch (error: any) {
      console.error('[Gesser] Review error:', error);
      Alert.alert('Error', error.message || 'Failed to submit review. Please try again.');
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topicBox}>
        <Text style={styles.topicLabel}>Topic Suggestion:</Text>
        <Text style={styles.topicText}>{topic.topic}</Text>
        <Text style={styles.submittedAt}>
          Submitted: {new Date(topic.submittedAt).toLocaleDateString()}
        </Text>
      </View>

      <Text style={styles.questionText}>
        Should this topic be approved for the mystery paint pool?
      </Text>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.rejectButton]}
          onPress={() => handleReview('reject')}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Text style={styles.buttonIcon}>👎</Text>
              <Text style={styles.buttonText}>Reject</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.approveButton]}
          onPress={() => handleReview('approve')}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <>
              <Text style={styles.buttonIcon}>👍</Text>
              <Text style={[styles.buttonText, styles.approveButtonText]}>
                Approve
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.rewardBox}>
        <Text style={styles.rewardText}>
          +5 coins for reviewing!
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#222',
    borderRadius: 10,
    padding: 20,
    borderWidth: 2,
    borderColor: '#f90'
  },
  topicBox: {
    backgroundColor: '#333',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#f90'
  },
  topicLabel: {
    fontSize: 12,
    color: '#f90',
    fontWeight: 'bold',
    marginBottom: 5,
    textTransform: 'uppercase'
  },
  topicText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold',
    marginBottom: 10
  },
  submittedAt: {
    fontSize: 12,
    color: '#aaa'
  },
  questionText: {
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 20
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 15
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 8,
    gap: 8
  },
  rejectButton: {
    backgroundColor: '#f33',
    borderWidth: 2,
    borderColor: '#f66'
  },
  approveButton: {
    backgroundColor: '#0f3',
    borderWidth: 2,
    borderColor: '#0f6'
  },
  buttonIcon: {
    fontSize: 20
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff'
  },
  approveButtonText: {
    color: '#000'
  },
  rewardBox: {
    backgroundColor: '#333',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center'
  },
  rewardText: {
    fontSize: 14,
    color: '#0ff',
    fontWeight: 'bold'
  }
});

export default TopicReviewCard;
