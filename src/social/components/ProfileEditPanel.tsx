/**
 * ProfileEditPanel — owner-only modal to edit display name, bio, and portrait.
 * Portraits are chosen from the user's existing passport history (no uploader
 * here — new portraits come from the passport flow). Saving calls back with the
 * trimmed/validated patch; the parent persists it via socialApi.saveProfile,
 * which logs a profile_change timeline event server-side.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import PortraitAvatar from './PortraitAvatar';

const NAME_MAX = 40;
const BIO_MAX = 500;

export interface ProfileEditValues {
  name: string;
  bio: string;
  portrait: string | null;
}

interface Props {
  visible: boolean;
  initial: ProfileEditValues;
  portraitHistory: string[];
  onCancel: () => void;
  /** Resolve true on success so the panel can close; throw/return false to keep it open. */
  onSave: (patch: { name?: string; bio?: string; portraitUrl?: string }) => Promise<boolean>;
  onOpenStudio?: () => void;
}

const ProfileEditPanel: React.FC<Props> = ({ visible, initial, portraitHistory, onCancel, onSave, onOpenStudio }) => {
  const [name, setName] = useState(initial.name);
  const [bio, setBio] = useState(initial.bio);
  const [portrait, setPortrait] = useState<string | null>(initial.portrait);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed fields whenever the panel (re)opens with fresh values.
  const seedKey = `${initial.name}|${initial.bio}|${initial.portrait ?? ''}`;
  const [lastSeed, setLastSeed] = useState(seedKey);
  if (visible && seedKey !== lastSeed) {
    setLastSeed(seedKey);
    setName(initial.name);
    setBio(initial.bio);
    setPortrait(initial.portrait);
    setError(null);
  }

  const portraits = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    [portrait, ...portraitHistory].forEach((p) => {
      if (p && !seen.has(p)) { seen.add(p); out.push(p); }
    });
    return out;
  }, [portrait, portraitHistory]);

  const dirty =
    name.trim() !== initial.name.trim() ||
    bio.trim() !== initial.bio.trim() ||
    (portrait ?? '') !== (initial.portrait ?? '');

  const handleSave = async () => {
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Name cannot be empty.'); return; }
    setError(null);
    setSaving(true);
    try {
      const patch: { name?: string; bio?: string; portraitUrl?: string } = {};
      if (trimmedName !== initial.name.trim()) patch.name = trimmedName.slice(0, NAME_MAX);
      if (bio.trim() !== initial.bio.trim()) patch.bio = bio.trim().slice(0, BIO_MAX);
      if ((portrait ?? '') !== (initial.portrait ?? '') && portrait) patch.portraitUrl = portrait;
      if (Object.keys(patch).length === 0) { onCancel(); return; }
      const ok = await onSave(patch);
      if (!ok) setError('Could not save. Please try again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>Edit profile</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving || !dirty} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              {saving ? <ActivityIndicator color="#ff9f6b" /> : (
                <Text style={[styles.save, (!dirty) && styles.saveDisabled]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Portrait</Text>
            {portraits.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.portraitRow}>
                {portraits.map((p) => (
                  <TouchableOpacity key={p} onPress={() => setPortrait(p)} activeOpacity={0.8}>
                    <View style={[styles.portraitPick, portrait === p && styles.portraitPickActive]}>
                      <PortraitAvatar uri={p} size={64} accent={portrait === p ? '#ff9f6b' : '#333'} />
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.hint}>Make a passport in the studio to set a portrait.</Text>
            )}
            {onOpenStudio ? (
              <TouchableOpacity style={styles.studioButton} onPress={onOpenStudio} activeOpacity={0.86}>
                <Text style={styles.studioButtonText}>🎨 Paint passport image</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(t) => setName(t.slice(0, NAME_MAX))}
              placeholder="Your display name"
              placeholderTextColor="#555"
              maxLength={NAME_MAX}
              autoCorrect={false}
            />
            <Text style={styles.counter}>{name.length}/{NAME_MAX}</Text>

            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.bioInput]}
              value={bio}
              onChangeText={(t) => setBio(t.slice(0, BIO_MAX))}
              placeholder="Say something about yourself…"
              placeholderTextColor="#555"
              maxLength={BIO_MAX}
              multiline
              textAlignVertical="top"
            />
            <Text style={styles.counter}>{bio.length}/{BIO_MAX}</Text>

            {error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#141414', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '88%' },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#262626',
  },
  sheetTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cancel: { color: '#8e8e92', fontSize: 15, fontWeight: '600' },
  save: { color: '#ff9f6b', fontSize: 15, fontWeight: '800' },
  saveDisabled: { color: '#5a4034' },
  body: { padding: 16, paddingBottom: 40, gap: 6 },
  label: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 14 },
  hint: { color: '#777', fontSize: 12, marginTop: 4 },
  portraitRow: { gap: 10, paddingVertical: 6 },
  portraitPick: { padding: 3, borderRadius: 40 },
  portraitPickActive: {},
  studioButton: {
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: '#221713',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ff9f6b',
    paddingVertical: 12,
    alignItems: 'center',
  },
  studioButtonText: { color: '#ffb38a', fontSize: 14, fontWeight: '900' },
  input: {
    backgroundColor: '#0e0e0e', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontSize: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: '#2a2a2a', marginTop: 4,
  },
  bioInput: { minHeight: 110 },
  counter: { color: '#666', fontSize: 11, textAlign: 'right', marginTop: 3 },
  error: { color: '#ff8a8a', fontSize: 13, marginTop: 12, textAlign: 'center' },
});

export default ProfileEditPanel;
