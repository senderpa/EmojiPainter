import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { AppText as Text } from '../emoji/AppText';
import type { InfoLanguage } from '../lib/infoCopy';
import { getProfileTermsCopy, PROFILE_TERMS_WEB_URL } from '../lib/profileTerms';

type Props = {
  visible: boolean;
  language?: InfoLanguage;
  onAccept: () => Promise<void> | void;
  onClose: () => void;
};

/**
 * Shared consent sheet for every entry point that can lead to an online
 * profile/gallery write. Keeping one component prevents Profile Studio,
 * challenges, settings, and onboarding from presenting different consent.
 */
export default function ProfileTermsModal({
  visible,
  language = 'en',
  onAccept,
  onClose,
}: Props) {
  const copy = useMemo(() => getProfileTermsCopy(language), [language]);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await onAccept();
    } catch (acceptError) {
      console.warn('[ProfileTermsModal] Could not save consent:', acceptError);
      setError('Consent could not be saved. Please try again.');
    } finally {
      setAccepting(false);
    }
  };

  const openOnlineTerms = async () => {
    setError(null);
    try {
      await Linking.openURL(PROFILE_TERMS_WEB_URL);
    } catch (linkError) {
      console.warn('[ProfileTermsModal] Could not open online terms:', linkError);
      setError('The online policy could not be opened. Please try again.');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => { if (!accepting) onClose(); }}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>Required before online features</Text>
          <Text style={styles.body}>{copy.consentBody}</Text>
          <ScrollView style={styles.sections} showsVerticalScrollIndicator={false}>
            {copy.sections.map((section, index) => (
              <View key={`${section.heading}-${index}`} style={styles.section}>
                <Text style={styles.sectionHeading}>{section.heading}</Text>
                {section.body.map((paragraph, paragraphIndex) => (
                  <Text key={`${index}-${paragraphIndex}`} style={styles.sectionBody}>
                    {paragraph}
                  </Text>
                ))}
              </View>
            ))}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={styles.readerButton}
            onPress={() => void openOnlineTerms()}
            disabled={accepting}
            accessibilityRole="link"
            accessibilityLabel={`${copy.openReaderLabel} on emojipainter.com`}
          >
            <Text style={styles.readerText}>{copy.openReaderLabel} on emojipainter.com ↗</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.acceptButton, accepting && styles.disabled]}
            onPress={accept}
            disabled={accepting}
            accessibilityRole="button"
            accessibilityLabel={copy.acceptLabel}
          >
            {accepting ? (
              <ActivityIndicator color="#0b0b0b" />
            ) : (
              <Text style={styles.acceptText}>{copy.acceptLabel}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            disabled={accepting}
            accessibilityRole="button"
          >
            <Text style={styles.closeText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.84)',
  },
  sheet: {
    maxHeight: '88%',
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    backgroundColor: '#141414',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#343434',
  },
  title: { color: '#fff', fontSize: 19, fontWeight: '900' },
  subtitle: { color: '#ff9f6b', fontSize: 13, fontWeight: '800', marginTop: 5 },
  body: { color: '#c4c4c4', fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 12 },
  sections: { flexGrow: 0, maxHeight: 330 },
  section: { marginBottom: 14 },
  sectionHeading: { color: '#fff', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  sectionBody: { color: '#9d9d9d', fontSize: 12, lineHeight: 18, marginBottom: 5 },
  error: { color: '#ff9a9a', fontSize: 12, marginTop: 6 },
  readerButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 9,
  },
  readerText: { color: '#8fdcff', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  acceptButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    paddingHorizontal: 16,
    backgroundColor: '#ff9f6b',
    borderRadius: 14,
  },
  acceptText: { color: '#0b0b0b', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  closeButton: { alignItems: 'center', paddingVertical: 12 },
  closeText: { color: '#777', fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
