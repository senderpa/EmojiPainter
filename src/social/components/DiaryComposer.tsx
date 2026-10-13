/**
 * DiaryComposer — owner-only inline composer to post a new diary entry to the
 * profile timeline.
 */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import type { TimelineEvent } from '../types';

const DIARY_MAX = 2000;

interface Props {
  onAddDiary: (text: string) => Promise<TimelineEvent | null>;
}

const DiaryComposer: React.FC<Props> = ({ onAddDiary }) => {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (posting) return;
    const text = draft.trim();
    if (!text) { setError('Write something first.'); return; }
    setError(null);
    setPosting(true);
    try {
      await onAddDiary(text);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <View style={styles.composer}>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={(t) => setDraft(t.slice(0, DIARY_MAX))}
        placeholder="What's on your mind? Write a diary entry…"
        placeholderTextColor="#555"
        multiline
        maxLength={DIARY_MAX}
        textAlignVertical="top"
      />
      <View style={styles.foot}>
        <Text style={styles.counter}>{draft.length}/{DIARY_MAX}</Text>
        <TouchableOpacity
          style={[styles.btn, (!draft.trim() || posting) && styles.btnDisabled]}
          onPress={submit}
          disabled={!draft.trim() || posting}
        >
          {posting ? <ActivityIndicator color="#0b0b0b" size="small" /> : <Text style={styles.btnText}>Post</Text>}
        </TouchableOpacity>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  composer: {
    backgroundColor: '#141414', borderRadius: 16, padding: 12, marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#262626',
  },
  input: { color: '#fff', fontSize: 15, minHeight: 60 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  counter: { color: '#666', fontSize: 11 },
  btn: { backgroundColor: '#ff9f6b', borderRadius: 16, paddingHorizontal: 22, paddingVertical: 8, minWidth: 64, alignItems: 'center' },
  btnDisabled: { backgroundColor: '#5a4034' },
  btnText: { color: '#0b0b0b', fontWeight: '800', fontSize: 14 },
  error: { color: '#ff8a8a', fontSize: 12, marginTop: 8 },
});

export default DiaryComposer;
