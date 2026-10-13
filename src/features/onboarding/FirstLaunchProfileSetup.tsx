import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppText as Text } from '../../emoji/AppText';
import { getOrCreateDailyDeviceId } from '../../lib/dailyDeviceId';
import {
  PASSPORT_PORTRAIT_STORAGE_KEY,
  PRIVATE_STUDIO_NAME_MAX,
} from '../../lib/paintConstants';
import {
  PROFILE_DISPLAY_NAME_STORAGE_KEY,
  PROFILE_FIRST_LAUNCH_SETUP_KEY,
  fetchServerProfileSnapshot,
  flushStoredProfileState,
  persistProfileDisplayNameLocally,
  restoreServerProfileLocally,
  scheduleStoredProfileStateSync,
  type ServerProfileSnapshot,
} from '../../lib/profileSync';
import { formatElapsedTime } from '../../lib/profileStats';

type Props = { onFinish: () => void };

const FirstLaunchProfileSetup: React.FC<Props> = ({ onFinish }) => {
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState<ServerProfileSnapshot | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const deviceId = await getOrCreateDailyDeviceId();
        const found = await fetchServerProfileSnapshot(deviceId);
        if (cancelled) return;
        if (found) {
          await restoreServerProfileLocally(found, {
            passportPortraitStorageKey: PASSPORT_PORTRAIT_STORAGE_KEY,
          });
          if (cancelled) return;
          setSnapshot(found);
          setName(found.name.slice(0, PRIVATE_STUDIO_NAME_MAX));
        } else {
          const localName = await AsyncStorage.getItem(PROFILE_DISPLAY_NAME_STORAGE_KEY);
          if (!cancelled && localName) setName(localName.slice(0, PRIVATE_STUDIO_NAME_MAX));
        }
      } catch (cause) {
        console.warn('[FirstLaunchProfile] Recovery check failed:', cause);
        if (!cancelled) setError('Server recovery is temporarily unavailable. Your name will sync when you are online.');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const continueIntoApp = useCallback(async () => {
    const nextName = name.trim().slice(0, PRIVATE_STUDIO_NAME_MAX);
    if (!nextName) {
      setError('Choose a name first. You can change it later on your Profile page.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await persistProfileDisplayNameLocally(nextName);
      await AsyncStorage.setItem(PROFILE_FIRST_LAUNCH_SETUP_KEY, 'done');
      // Do not trap an offline first launch behind a network request. The
      // durable write starts now and is also retried by PaintScreen whenever
      // local lifetime stats change or the app backgrounds.
      scheduleStoredProfileStateSync(0);
      void flushStoredProfileState();
      onFinish();
    } catch (cause) {
      console.warn('[FirstLaunchProfile] Could not save setup:', cause);
      setError('Your name could not be saved. Please try again.');
      setSaving(false);
    }
  }, [name, onFinish]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.glow} />
      <View style={styles.card}>
        {checking ? (
          <>
            <ActivityIndicator size="large" color="#ff9f6b" />
            <Text style={styles.title}>Looking for your profile…</Text>
            <Text style={styles.body}>Checking the secure identity saved on this device.</Text>
          </>
        ) : (
          <>
            <Text style={styles.eyebrow}>{snapshot ? 'PROFILE FOUND' : 'YOUR PROFILE'}</Text>
            {snapshot?.latestPortrait ? (
              <Image source={{ uri: snapshot.latestPortrait }} style={styles.portrait} />
            ) : (
              <View style={[styles.portrait, styles.placeholder]}>
                <Text style={styles.placeholderEmoji}>🎨</Text>
              </View>
            )}
            <Text style={styles.title}>
              {snapshot ? 'Welcome back!' : 'What should we call you?'}
            </Text>
            {snapshot ? (
              <Text style={styles.body}>
                We restored {formatElapsedTime(snapshot.elapsedMs)} and {snapshot.strokeCount.toLocaleString()} strokes from your server profile.
              </Text>
            ) : (
              <Text style={styles.body}>This name stays with your paintings and can be changed anytime.</Text>
            )}
            <TextInput
              value={name}
              onChangeText={(value) => setName(value.slice(0, PRIVATE_STUDIO_NAME_MAX))}
              placeholder="Your painter name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={PRIVATE_STUDIO_NAME_MAX}
              editable={!saving}
              style={styles.input}
              accessibilityLabel="Profile name"
            />
            <Text style={styles.counter}>{name.trim().length}/{PRIVATE_STUDIO_NAME_MAX}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.continueButton, (!name.trim() || saving) && styles.disabled]}
              disabled={!name.trim() || saving}
              onPress={() => void continueIntoApp()}
              accessibilityRole="button"
            >
              {saving
                ? <ActivityIndicator color="#090a0f" />
                : <Text style={styles.continueText}>{snapshot ? 'Use this profile' : 'Continue'}</Text>}
            </TouchableOpacity>
            <Text style={styles.info}>
              Want to delete this profile later? Open Profile → Account & support at the bottom.
            </Text>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08090f', alignItems: 'center', justifyContent: 'center', padding: 22 },
  glow: { position: 'absolute', width: 430, height: 430, borderRadius: 215, backgroundColor: 'rgba(255,113,78,0.09)' },
  card: { width: '100%', maxWidth: 470, minHeight: 360, borderRadius: 28, padding: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(22,24,34,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  eyebrow: { color: '#ff9f6b', fontSize: 12, fontWeight: '900', letterSpacing: 2, marginBottom: 14 },
  portrait: { width: 116, height: 116, borderRadius: 30, marginBottom: 18, borderWidth: 2, borderColor: 'rgba(255,159,107,0.7)' },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111522' },
  placeholderEmoji: { fontSize: 54 },
  title: { color: '#fff', fontSize: 27, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  body: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, marginBottom: 18 },
  input: { width: '100%', minHeight: 54, borderRadius: 16, paddingHorizontal: 16, color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1.5, borderColor: 'rgba(255,159,107,0.65)', fontSize: 18, fontWeight: '700' },
  counter: { alignSelf: 'flex-end', color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 5 },
  error: { color: '#ff9a9a', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 8 },
  continueButton: { width: '100%', minHeight: 52, borderRadius: 16, marginTop: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff9f6b' },
  continueText: { color: '#090a0f', fontSize: 16, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  info: { color: 'rgba(255,255,255,0.42)', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 16 },
});

export default FirstLaunchProfileSetup;
