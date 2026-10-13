import React, { useState, useCallback, useEffect } from 'react';
import { Modal, View, TouchableOpacity, Switch, ScrollView, Alert, Linking, ActivityIndicator, TextInput, StyleSheet, Platform } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import * as Haptics from 'expo-haptics';
import {
  ParentalControlsSettings,
  validatePin,
  createPinSettings,
  saveParentalControls,
  getDailyUsageMs,
  formatUsageTime,
} from '../lib/parentalControls';

// ── Types ─────────────────────────────────────────────────────────────────────

type Panel = 'lock' | 'setup_pin' | 'settings';

interface Props {
  visible: boolean;
  settings: ParentalControlsSettings;
  onClose: () => void;
  onSettingsChange: (next: ParentalControlsSettings) => void;
  offlineEntryCount?: number;
}

// ── PIN Input ─────────────────────────────────────────────────────────────────

function PinInput({
  value,
  onChange,
  label,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  error?: string;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.pinLabel}>{label}</Text>
      <TextInput
        style={[s.pinField, error ? s.pinFieldError : null]}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        placeholder="4–6 digits"
        placeholderTextColor="#555"
      />
      {error ? <Text style={s.pinError}>{error}</Text> : null}
    </View>
  );
}

// ── Row helpers ────────────────────────────────────────────────────────────────

function SettingRow({
  icon,
  label,
  sublabel,
  value,
  onToggle,
  disabled,
}: {
  icon: string;
  label: string;
  sublabel?: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, disabled && { color: '#555' }]}>{label}</Text>
        {sublabel ? <Text style={s.rowSub}>{sublabel}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => { void Haptics.selectionAsync(); onToggle(v); }}
        trackColor={{ false: '#333', true: '#0ff' }}
        thumbColor={value ? '#fff' : '#888'}
        disabled={disabled}
      />
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={s.sectionHeader}>{title}</Text>;
}

// ── Time limit picker ──────────────────────────────────────────────────────────

const TIME_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'No limit', value: null },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '1 hour', value: 60 },
  { label: '1.5 hours', value: 90 },
  { label: '2 hours', value: 120 },
];

function TimeLimitPicker({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {TIME_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={String(opt.value)}
            style={[s.timeChip, active && s.timeChipActive, disabled && { opacity: 0.4 }]}
            onPress={() => { if (!disabled) { void Haptics.selectionAsync(); onChange(opt.value); } }}
            activeOpacity={0.7}
          >
            <Text style={[s.timeChipLabel, active && s.timeChipLabelActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function ParentalControlsModal({
  visible,
  settings,
  onClose,
  onSettingsChange,
  offlineEntryCount = 0,
}: Props) {
  const [panel, setPanel] = useState<Panel>(
    settings.setupComplete ? 'lock' : 'setup_pin'
  );
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [usageMs, setUsageMs] = useState(0);

  useEffect(() => {
    if (visible) {
      setPanel(settings.setupComplete ? 'lock' : 'setup_pin');
      setPinInput('');
      setPinConfirm('');
      setPinError('');
      getDailyUsageMs().then(setUsageMs).catch(() => {});
    }
  }, [visible, settings.setupComplete]);

  const persist = useCallback(
    async (next: ParentalControlsSettings) => {
      setSaving(true);
      try {
        await saveParentalControls(next);
        onSettingsChange(next);
      } finally {
        setSaving(false);
      }
    },
    [onSettingsChange]
  );

  // ── Lock panel ──────────────────────────────────────────────────────────────

  const handleUnlock = useCallback(async () => {
    if (pinInput.length < 4) { setPinError('Enter 4–6 digit PIN'); return; }
    setUnlocking(true);
    setPinError('');
    try {
      const ok = await validatePin(settings, pinInput);
      if (ok) {
        setPinInput('');
        setPanel('settings');
      } else {
        setPinError('Wrong PIN. Try again.');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setUnlocking(false);
    }
  }, [pinInput, settings]);

  // ── Setup PIN panel ─────────────────────────────────────────────────────────

  const handleSetupPin = useCallback(async () => {
    if (pinInput.length < 4) { setPinError('PIN must be 4–6 digits'); return; }
    if (pinInput !== pinConfirm) { setPinError('PINs do not match'); return; }
    setSaving(true);
    try {
      const next = await createPinSettings(
        { ...settings, enabled: true, setupComplete: true },
        pinInput
      );
      await saveParentalControls(next);
      onSettingsChange(next);
      setPinInput('');
      setPinConfirm('');
      setPanel('settings');
    } finally {
      setSaving(false);
    }
  }, [pinInput, pinConfirm, settings, onSettingsChange]);

  // ── Toggle helpers ──────────────────────────────────────────────────────────

  const toggle = useCallback(
    (key: keyof ParentalControlsSettings, val: boolean) => {
      const next = { ...settings, [key]: val };
      void persist(next);
    },
    [settings, persist]
  );

  const handleResetPin = useCallback(() => {
    Alert.alert(
      'Reset PIN',
      'This will remove all parental controls. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            const next = {
              ...settings,
              enabled: false,
              setupComplete: false,
              pinHash: '',
              pinSalt: '',
            };
            await saveParentalControls(next);
            onSettingsChange(next);
            onClose();
          },
        },
      ]
    );
  }, [settings, onSettingsChange, onClose]);

  const handleOpenScreenTime = useCallback(async () => {
    try {
      const opened = await Linking.openURL('App-prefs:root=SCREENTIME');
      if (!opened) throw new Error();
    } catch {
      await Linking.openSettings();
    }
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={s.backdrop}>
        <View style={s.sheet}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerIcon}>🛡️</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>Parental Controls</Text>
              <Text style={s.headerSub}>
                {panel === 'lock'
                  ? 'Enter PIN to manage settings'
                  : panel === 'setup_pin'
                  ? 'Set up a parent PIN'
                  : settings.enabled
                  ? '✅ Active'
                  : 'Disabled'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Text style={s.closeBtnLabel}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* ── SETUP PIN ── */}
          {panel === 'setup_pin' && (
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              <Text style={s.intro}>
                Set a 4–6 digit PIN that only the parent knows. This PIN is required to change any settings.
              </Text>
              <PinInput label="Create PIN" value={pinInput} onChange={setPinInput} error={pinError} />
              <PinInput label="Confirm PIN" value={pinConfirm} onChange={setPinConfirm} />
              <TouchableOpacity
                style={[s.primaryBtn, (saving || pinInput.length < 4) && { opacity: 0.5 }]}
                onPress={() => void handleSetupPin()}
                disabled={saving || pinInput.length < 4}
              >
                {saving ? <ActivityIndicator color="#000" /> : (
                  <Text style={s.primaryBtnLabel}>Set PIN & Enable Controls</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
                <Text style={s.ghostBtnLabel}>Skip for now</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* ── LOCK ── */}
          {panel === 'lock' && (
            <View style={s.body}>
              <Text style={s.intro}>Enter parent PIN to manage settings.</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                <View style={{ flex: 1 }}>
                  <PinInput label="PIN" value={pinInput} onChange={setPinInput} error={pinError} />
                </View>
              </View>
              <TouchableOpacity
                style={[s.primaryBtn, (unlocking || pinInput.length < 4) && { opacity: 0.5 }]}
                onPress={() => void handleUnlock()}
                disabled={unlocking || pinInput.length < 4}
              >
                {unlocking ? <ActivityIndicator color="#000" /> : (
                  <Text style={s.primaryBtnLabel}>Unlock Settings</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={[s.ghostBtn, { marginTop: 8 }]} onPress={handleResetPin}>
                <Text style={[s.ghostBtnLabel, { color: '#ff6b6b' }]}>Forgot PIN? Reset controls</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── SETTINGS ── */}
          {panel === 'settings' && (
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              {saving && (
                <View style={{ alignItems: 'center', marginBottom: 8 }}>
                  <ActivityIndicator color="#0ff" size="small" />
                </View>
              )}

              {/* Master toggle */}
              <SettingRow
                icon={settings.enabled ? '🛡️' : '🔓'}
                label="Parental Controls"
                sublabel={settings.enabled ? 'Active — restrictions apply' : 'Disabled — no restrictions'}
                value={settings.enabled}
                onToggle={(v) => toggle('enabled', v)}
              />

              {/* ── Network / Offline ── */}
              <SectionHeader title="🌐  Network" />
              <SettingRow
                icon="📴"
                label="Full Offline Mode"
                sublabel={
                  offlineEntryCount > 0
                    ? `App works without internet · ${offlineEntryCount} painting${offlineEntryCount !== 1 ? 's' : ''} saved locally`
                    : 'App works without internet · paintings saved on device'
                }
                value={settings.offlineMode}
                onToggle={(v) => toggle('offlineMode', v)}
                disabled={!settings.enabled}
              />
              <Text style={s.hint}>
                In offline mode all network calls are blocked. Daily challenges use cached topics.
                Completed paintings save to a private local gallery visible only in offline mode.
              </Text>

              {/* iOS Screen Time */}
              <TouchableOpacity
                style={s.screenTimeBtn}
                onPress={() => void handleOpenScreenTime()}
                activeOpacity={0.75}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.screenTimeBtnLabel}>📱  iOS Screen Time</Text>
                  <Text style={s.screenTimeBtnSub}>
                    Set app time limits, block apps, manage content restrictions via iOS
                  </Text>
                </View>
                <Text style={{ color: '#0ff', fontSize: 18 }}>›</Text>
              </TouchableOpacity>
              <Text style={s.hint}>
                Use iOS Screen Time (Settings → Screen Time → App Limits) to set daily time limits,
                block the app entirely, or restrict internet access at OS level.
              </Text>

              {/* ── Time limit ── */}
              <SectionHeader title="⏱  Daily Time Limit (in-app)" />
              <Text style={s.hint}>
                After this time EmojiPaint shows a reminder. Enter the PIN to continue.
              </Text>
              <TimeLimitPicker
                value={settings.dailyTimeLimitMinutes}
                onChange={(v) => void persist({ ...settings, dailyTimeLimitMinutes: v })}
                disabled={!settings.enabled}
              />
              {usageMs > 0 && (
                <Text style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
                  Today's usage: {formatUsageTime(usageMs)}
                  {settings.dailyTimeLimitMinutes
                    ? ` / ${settings.dailyTimeLimitMinutes} min`
                    : ''}
                </Text>
              )}

              {/* ── Features ── */}
              <SectionHeader title="🎨  Allowed Features" />
              <SettingRow
                icon="🌅"
                label="Daily Challenges"
                sublabel="Paint the 3 daily topics"
                value={settings.allowDailyChallenges}
                onToggle={(v) => toggle('allowDailyChallenges', v)}
                disabled={!settings.enabled}
              />
              <SettingRow
                icon="🎲"
                label="Mystery Challenge"
                sublabel="Random secret topic painting"
                value={settings.allowMysteryChallenge}
                onToggle={(v) => toggle('allowMysteryChallenge', v)}
                disabled={!settings.enabled}
              />
              <SettingRow
                icon="🖼️"
                label="View Gallery"
                sublabel="Browse community paintings"
                value={settings.allowGalleryView}
                onToggle={(v) => toggle('allowGalleryView', v)}
                disabled={!settings.enabled}
              />
              <SettingRow
                icon="☁️"
                label="Upload Paintings"
                sublabel="Share paintings to the live gallery"
                value={settings.allowUploads}
                onToggle={(v) => toggle('allowUploads', v)}
                disabled={!settings.enabled || settings.offlineMode}
              />

              {/* ── Apple Family Controls info ── */}
              <SectionHeader title="ℹ️  About iOS Parental Controls" />
              <View style={s.infoBox}>
                <Text style={s.infoText}>
                  <Text style={{ fontWeight: '700', color: '#0ff' }}>iOS Screen Time</Text>
                  {' '}can restrict EmojiPaint at the OS level — even independently of the in-app PIN.{'\n\n'}
                  <Text style={{ fontWeight: '700', color: '#fff' }}>What Screen Time can do:{'\n'}</Text>
                  {'• Set daily time limits per app\n'}
                  {'• Require a passcode to extend time\n'}
                  {'• Block the app entirely\n'}
                  {'• Restrict web content & network\n'}
                  {'• Schedule Downtime (e.g. bedtime)\n\n'}
                  Go to{' '}
                  <Text style={{ color: '#0ff' }}>Settings › Screen Time › App Limits</Text>
                  {' '}to set limits, or{' '}
                  <Text style={{ color: '#0ff' }}>Always Allowed</Text>
                  {' '}to whitelist EmojiPaint.
                </Text>
              </View>

              {/* Offline gallery info */}
              {offlineEntryCount > 0 && (
                <View style={[s.infoBox, { borderColor: 'rgba(0,255,255,0.3)', marginTop: 8 }]}>
                  <Text style={s.infoText}>
                    <Text style={{ fontWeight: '700', color: '#0ff' }}>
                      📴 Local Gallery:{' '}
                    </Text>
                    {offlineEntryCount} painting{offlineEntryCount !== 1 ? 's' : ''} saved on this device.
                    Visible only when Offline Mode is active. Paintings are stored permanently.
                  </Text>
                </View>
              )}

              {/* Change PIN */}
              <TouchableOpacity
                style={[s.ghostBtn, { marginTop: 24 }]}
                onPress={() => { setPinInput(''); setPinConfirm(''); setPinError(''); setPanel('setup_pin'); }}
              >
                <Text style={s.ghostBtnLabel}>🔑  Change PIN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ghostBtn, { marginTop: 8 }]} onPress={handleResetPin}>
                <Text style={[s.ghostBtnLabel, { color: '#ff6b6b' }]}>Remove all parental controls</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0f0f0f',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,255,255,0.2)',
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  headerIcon: { fontSize: 30 },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'vrtlfinal',
  },
  headerSub: { color: '#888', fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnLabel: { color: '#888', fontWeight: '700', fontSize: 14 },
  body: { padding: 20, paddingBottom: 40 },
  intro: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  sectionHeader: {
    color: 'rgba(0,255,255,0.8)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  rowLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowSub: { color: '#666', fontSize: 12, marginTop: 2 },
  hint: {
    color: '#555',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
    marginBottom: 4,
  },
  pinLabel: { color: '#aaa', fontSize: 13, marginBottom: 6, fontWeight: '600' },
  pinField: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: 'rgba(0,255,255,0.3)',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
  },
  pinFieldError: { borderColor: '#ff6b6b' },
  pinError: { color: '#ff6b6b', fontSize: 12, marginTop: 4 },
  primaryBtn: {
    backgroundColor: '#0ff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryBtnLabel: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'vrtlfinal',
  },
  ghostBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  ghostBtnLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 14, fontFamily: 'vrtlfinal' },
  timeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: '#1a1a1a',
  },
  timeChipActive: { borderColor: '#0ff', backgroundColor: 'rgba(0,255,255,0.12)' },
  timeChipLabel: { color: '#666', fontSize: 13, fontWeight: '600' },
  timeChipLabelActive: { color: '#0ff' },
  screenTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(0,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,255,0.2)',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  screenTimeBtnLabel: { color: '#0ff', fontSize: 14, fontWeight: '700' },
  screenTimeBtnSub: { color: '#555', fontSize: 12, marginTop: 2 },
  infoBox: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  infoText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    lineHeight: 20,
  },
});
