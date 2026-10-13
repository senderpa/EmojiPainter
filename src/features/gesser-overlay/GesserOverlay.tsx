/**
 * GesserOverlay — Mystery Topic / Gesser flow overlays.
 *
 * Renders two modals:
 *  1. Mystery Topic Warning Modal  (2-panel: intro → picker)
 *  2. Mystery Topic Confirmation Overlay (bouncing animation)
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated as RNAnimated,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  cleanCustomMysteryTopicInput,
  validateCustomMysteryTopic,
} from '../../gesser/utils/masking';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface MysteryTopicChoice {
  topicId: number;
  topic: string;
  timeMinutes: number;
}

interface MysteryCopy {
  panel0Title: string;
  panel0Rule1: string;
  panel0Rule2: string;
  panel0Rule3: string;
  panel0PickBtn: string;
  panel0Cancel: string;
  panel1Title: string;
  panel1Subtitle: string;
  panel1TapToPaint: string;
  panel1ShuffleBtn: string;
  panel1Back: string;
  panel1Cancel: string;
  confirmImportant: string;
  confirmBody: string;
  confirmHint: string;
  confirmBtn: string;
}

interface InfoCopy {
  mystery: MysteryCopy;
}

interface TopicMetadata {
  topic: string;
  translations?: Record<string, string>;
}

export interface GesserOverlayProps {
  // ── Mystery Topic Warning Modal ──────────────────────────────────────────
  mysteryTopicWarningVisible: boolean;
  mysteryModalPanel: 0 | 1;
  mysteryTotalTopicCount: number;
  mysteryTopicChoices: MysteryTopicChoice[];
  mysteryTopicLoading: boolean;
  mysteryTopicHistory: MysteryTopicChoice[][];
  pendingMysteryTopicChoices: MysteryTopicChoice[];
  infoCopy: InfoCopy;

  // ── Mystery Topic Warning Modal handlers ─────────────────────────────────
  confirmMysteryTopicWarning: () => Promise<void> | void;
  cancelMysteryTopicWarning: () => void;
  handleMysteryTopicPicked: (topic: MysteryTopicChoice) => void;
  handleShuffleMysteryTopics: () => Promise<void> | void;
  cancelMysteryPicker: () => void;

  // ── Setters forwarded from useChallenge ──────────────────────────────────
  setMysteryTopicChoices: React.Dispatch<React.SetStateAction<MysteryTopicChoice[]>>;
  setPendingMysteryTopicChoices: React.Dispatch<React.SetStateAction<MysteryTopicChoice[]>>;
  setMysteryTopicHistory: React.Dispatch<React.SetStateAction<MysteryTopicChoice[][]>>;

  // ── Mystery Confirm Overlay ───────────────────────────────────────────────
  mysteryConfirmVisible: boolean;
  setMysteryConfirmVisible: (v: boolean) => void;
  mysteryBounceAnim: RNAnimated.Value;
  mysteryTopic: { topicId: number; topic: string } | null;

  // ── Localisation ─────────────────────────────────────────────────────────
  infoLanguage: string;
  getTopicMetadata: (topic: string) => TopicMetadata | null | undefined;
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export default function GesserOverlay({
  mysteryTopicWarningVisible,
  mysteryModalPanel,
  mysteryTotalTopicCount,
  mysteryTopicChoices,
  mysteryTopicLoading,
  mysteryTopicHistory,
  pendingMysteryTopicChoices,
  infoCopy,
  confirmMysteryTopicWarning,
  cancelMysteryTopicWarning,
  handleMysteryTopicPicked,
  handleShuffleMysteryTopics,
  cancelMysteryPicker,
  setMysteryTopicChoices,
  setPendingMysteryTopicChoices,
  setMysteryTopicHistory,
  mysteryConfirmVisible,
  setMysteryConfirmVisible,
  mysteryBounceAnim,
  mysteryTopic,
  infoLanguage,
  getTopicMetadata,
}: GesserOverlayProps): React.ReactElement {
  const [customTopicEditorVisible, setCustomTopicEditorVisible] = useState(false);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [customTopicError, setCustomTopicError] = useState<string | null>(null);
  const [customTopicThanksVisible, setCustomTopicThanksVisible] = useState(false);
  const customTopicStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mysteryTopicWarningVisible && mysteryModalPanel === 1) return;
    if (customTopicStartTimerRef.current) {
      clearTimeout(customTopicStartTimerRef.current);
      customTopicStartTimerRef.current = null;
    }
    setCustomTopicEditorVisible(false);
    setCustomTopicInput('');
    setCustomTopicError(null);
    setCustomTopicThanksVisible(false);
  }, [mysteryModalPanel, mysteryTopicWarningVisible]);

  useEffect(() => () => {
    if (customTopicStartTimerRef.current) clearTimeout(customTopicStartTimerRef.current);
  }, []);

  const handleAddCustomTopic = () => {
    const result = validateCustomMysteryTopic(customTopicInput);
    if (!result.valid || !result.normalized) {
      setCustomTopicError(result.error ?? 'Enter an English topic.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setCustomTopicInput(result.normalized);
    setCustomTopicError(null);
    setCustomTopicThanksVisible(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    customTopicStartTimerRef.current = setTimeout(() => {
      customTopicStartTimerRef.current = null;
      handleMysteryTopicPicked({
        topicId: 0,
        topic: result.normalized,
        timeMinutes: mysteryTopicChoices[0]?.timeMinutes ?? 5,
      });
    }, 900);
  };

  return (
    <>
      {/* Mystery Topic Penalty Warning Modal */}
      {/* Mystery Topic Modal — 2-panel flow: intro → picker */}
      <Modal
        visible={mysteryTopicWarningVisible}
        animationType="fade"
        transparent
        onRequestClose={cancelMysteryTopicWarning}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'center', alignItems: 'center', padding: 20 }}
          activeOpacity={1}
          onPress={mysteryModalPanel === 0 ? cancelMysteryTopicWarning : undefined}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: '100%', maxWidth: 420 }}>
            <View style={{ backgroundColor: '#0f0f0f', borderRadius: 28, padding: 28, borderWidth: 3, borderColor: '#0ff' }}>

              {mysteryModalPanel === 0 ? (
                /* ── PANEL 0: How it works ── */
                <>
                  <View style={{ alignItems: 'center', marginBottom: 20 }}>
                    <Text style={{ fontSize: 56, marginBottom: 10 }}>🎲</Text>
                    <Text style={{ color: '#0ff', fontSize: 26, fontWeight: '800', fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                      {infoCopy.mystery.panel0Title}
                    </Text>
                  </View>

                  <View style={{ gap: 12, marginBottom: 24 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                      <Text style={{ fontSize: 22 }}>🎨</Text>
                      <Text style={{ color: '#fff', fontSize: 15, lineHeight: 22, flex: 1 }}>
                        {infoCopy.mystery.panel0Rule1}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                      <Text style={{ fontSize: 22 }}>🔒</Text>
                      <Text style={{ color: '#fff', fontSize: 15, lineHeight: 22, flex: 1 }}>
                        {infoCopy.mystery.panel0Rule2}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                      <Text style={{ fontSize: 22 }}>👀</Text>
                      <Text style={{ color: '#fff', fontSize: 15, lineHeight: 22, flex: 1 }}>
                        {infoCopy.mystery.panel0Rule3}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={{ backgroundColor: '#0ff', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginBottom: 12 }}
                    onPress={() => void confirmMysteryTopicWarning()}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: '#000', fontSize: 20, fontWeight: '800', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.mystery.panel0PickBtn}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 10 }} onPress={cancelMysteryTopicWarning} activeOpacity={0.7}>
                    <Text style={{ color: '#666', fontSize: 15, fontFamily: 'vrtlfinal' }}>{infoCopy.mystery.panel0Cancel}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                /* ── PANEL 1: Topic Picker ── */
                <>
                  <View style={{ alignItems: 'center', marginBottom: 20 }}>
                    <Text style={{ fontSize: 42, marginBottom: 8 }}>🎲✨</Text>
                    <Text style={{ color: '#0ff', fontSize: 24, fontWeight: '800', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: 4 }}>
                      {infoCopy.mystery.panel1Title}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' }}>
                      {infoCopy.mystery.panel1Subtitle}
                    </Text>
                    {mysteryTotalTopicCount > 0 && (
                      <Text style={{ color: 'rgba(0,255,255,0.5)', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
                        {`Pick from ${mysteryTotalTopicCount} topics`}
                      </Text>
                    )}
                  </View>

                  <View style={{ gap: 14, marginBottom: 20 }}>
                    {!customTopicEditorVisible && mysteryTopicChoices.map((topic) => (
                      <TouchableOpacity
                        key={topic.topicId}
                        style={{ backgroundColor: '#1a1a1a', borderRadius: 18, padding: 22, borderWidth: 2, borderColor: '#0ff', alignItems: 'center' }}
                        onPress={() => handleMysteryTopicPicked(topic)}
                        activeOpacity={0.75}
                      >
                        <Text style={{ color: '#0ff', fontSize: 26, fontWeight: '800', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: 6 }}>
                          {topic.topic}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>⏱</Text>
                          <Text style={{ color: 'rgba(0,255,255,0.75)', fontSize: 13, fontWeight: '700' }}>
                            {topic.timeMinutes} min
                          </Text>
                          <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>{infoCopy.mystery.panel1TapToPaint}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}

                    <TouchableOpacity
                      style={{
                        alignSelf: 'center',
                        backgroundColor: customTopicEditorVisible ? 'rgba(255,255,255,0.12)' : 'rgba(0,255,255,0.08)',
                        borderRadius: 999,
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderWidth: 1,
                        borderColor: 'rgba(0,255,255,0.45)',
                      }}
                      onPress={() => {
                        setCustomTopicEditorVisible(visible => !visible);
                        setCustomTopicError(null);
                        setCustomTopicThanksVisible(false);
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      disabled={customTopicThanksVisible}
                      accessibilityRole="button"
                      accessibilityLabel="Choose your own mystery topic"
                      activeOpacity={0.75}
                    >
                      <Text style={{ color: '#0ff', fontSize: 13, fontWeight: '800', fontFamily: 'vrtlfinal' }}>
                        {customTopicEditorVisible ? '← Random topics' : '✏️ Choose your own'}
                      </Text>
                    </TouchableOpacity>

                    {customTopicEditorVisible && (
                      <View style={{ backgroundColor: '#161616', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,255,255,0.35)', padding: 16 }}>
                        {customTopicThanksVisible ? (
                          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                            <Text style={{ fontSize: 30, marginBottom: 6 }}>💙</Text>
                            <Text style={{ color: '#0ff', fontSize: 20, fontWeight: '800', fontFamily: 'vrtlfinal' }}>Thanks!</Text>
                            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 5, textAlign: 'center' }}>
                              Your Mystery Challenge is starting…
                            </Text>
                          </View>
                        ) : (
                          <>
                            <Text style={{ color: '#fff', fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 12 }}>
                              Pick a topic in English and paint so others can guess.
                            </Text>
                            <TextInput
                              value={customTopicInput}
                              onChangeText={(value) => {
                                setCustomTopicInput(cleanCustomMysteryTopicInput(value));
                                setCustomTopicError(null);
                              }}
                              style={{
                                color: '#fff',
                                backgroundColor: '#090909',
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: customTopicError ? '#ff5c5c' : 'rgba(255,255,255,0.25)',
                                paddingHorizontal: 14,
                                paddingVertical: Platform.OS === 'ios' ? 12 : 10,
                                fontSize: 18,
                                textAlign: 'center',
                              }}
                              placeholder="Your topic"
                              placeholderTextColor="#666"
                              maxLength={20}
                              autoCapitalize="words"
                              autoCorrect={false}
                              spellCheck={false}
                              returnKeyType="done"
                              onSubmitEditing={handleAddCustomTopic}
                              accessibilityLabel="Custom mystery topic"
                            />
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7, paddingHorizontal: 2 }}>
                              <Text style={{ color: customTopicError ? '#ff7777' : 'rgba(255,255,255,0.45)', fontSize: 11, flex: 1 }}>
                                {customTopicError ?? 'English letters and spaces only'}
                              </Text>
                              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
                                {customTopicInput.length}/20
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={{ backgroundColor: customTopicInput.trim() ? '#0ff' : '#344', borderRadius: 12, alignItems: 'center', paddingVertical: 12, marginTop: 12 }}
                              onPress={handleAddCustomTopic}
                              disabled={!customTopicInput.trim()}
                              accessibilityRole="button"
                              accessibilityLabel="Add custom mystery topic"
                              activeOpacity={0.78}
                            >
                              <Text style={{ color: customTopicInput.trim() ? '#000' : '#899', fontSize: 16, fontWeight: '800', fontFamily: 'vrtlfinal' }}>
                                Add Topic
                              </Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    )}
                  </View>

                  {!customTopicEditorVisible && (
                    <TouchableOpacity
                      style={{ backgroundColor: 'rgba(0,255,255,0.12)', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: 'rgba(0,255,255,0.3)' }}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        void handleShuffleMysteryTopics();
                      }}
                      disabled={mysteryTopicLoading}
                      activeOpacity={0.7}
                    >
                      {mysteryTopicLoading ? (
                        <ActivityIndicator size="small" color="#0ff" />
                      ) : (
                        <Text style={{ color: '#0ff', fontSize: 15, fontWeight: '700', fontFamily: 'vrtlfinal' }}>
                          {infoCopy.mystery.panel1ShuffleBtn}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 4 }}>
                    {!customTopicEditorVisible && mysteryTopicHistory.length > 0 && (
                      <TouchableOpacity
                        style={{ alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16 }}
                        onPress={() => {
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          const prev = mysteryTopicHistory[mysteryTopicHistory.length - 1];
                          setMysteryTopicChoices(prev);
                          setPendingMysteryTopicChoices(prev);
                          setMysteryTopicHistory(h => h.slice(0, -1));
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: 'rgba(0,255,255,0.6)', fontSize: 15, fontFamily: 'vrtlfinal' }}>{infoCopy.mystery.panel1Back}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16 }} onPress={cancelMysteryPicker} activeOpacity={0.7}>
                      <Text style={{ color: '#666', fontSize: 15, fontFamily: 'vrtlfinal' }}>{infoCopy.mystery.panel1Cancel}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Mystery Topic Confirmation Overlay - Bouncing animation */}
      <Modal
        visible={mysteryConfirmVisible}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setMysteryConfirmVisible(false);
          mysteryBounceAnim.stopAnimation();
          mysteryBounceAnim.setValue(0);
        }}
      >
        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
          }}
          activeOpacity={1}
          onPress={() => {
            setMysteryConfirmVisible(false);
            mysteryBounceAnim.stopAnimation();
            mysteryBounceAnim.setValue(0);
          }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <RNAnimated.View style={{
              transform: [{ translateY: mysteryBounceAnim }],
              backgroundColor: '#0a0a0a',
              borderRadius: 24,
              padding: 32,
              borderWidth: 3,
              borderColor: '#0ff',
              alignItems: 'center',
              maxWidth: 400,
            }}>
              <Text style={{
                fontSize: 48,
                marginBottom: 20,
                textAlign: 'center',
              }}>
                🎲✨
              </Text>

              <Text style={{
                color: '#0ff',
                fontSize: 28,
                fontWeight: '800',
                fontFamily: 'vrtlfinal',
                textAlign: 'center',
                marginBottom: 12,
              }}>
                {(() => { const m = getTopicMetadata(mysteryTopic?.topic ?? ''); return m?.translations?.[infoLanguage] || m?.topic || mysteryTopic?.topic; })()}
              </Text>

              <Text style={{
                color: '#f00',
                fontSize: 22,
                fontWeight: '700',
                fontFamily: 'vrtlfinal',
                textAlign: 'center',
                marginTop: 20,
                marginBottom: 8,
                letterSpacing: 0.5,
              }}>
                {infoCopy.mystery.confirmImportant}
              </Text>

              <Text style={{
                color: '#fff',
                fontSize: 18,
                fontWeight: '600',
                fontFamily: 'vrtlfinal',
                textAlign: 'center',
                marginBottom: 20,
                lineHeight: 26,
              }}>
                {infoCopy.mystery.confirmBody}
              </Text>

              <View style={{
                marginTop: 10,
                padding: 16,
                backgroundColor: 'rgba(0, 255, 255, 0.1)',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: 'rgba(0, 255, 255, 0.3)',
                marginBottom: 20,
              }}>
                <Text style={{
                  color: '#0ff',
                  fontSize: 14,
                  fontFamily: 'vrtlfinal',
                  textAlign: 'center',
                }}>
                  {infoCopy.mystery.confirmHint}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => {
                  setMysteryConfirmVisible(false);
                  mysteryBounceAnim.stopAnimation();
                  mysteryBounceAnim.setValue(0);
                }}
                style={{
                  backgroundColor: '#0ff',
                  paddingHorizontal: 32,
                  paddingVertical: 14,
                  borderRadius: 14,
                  alignItems: 'center',
                }}
              >
                <Text style={{
                  color: '#000',
                  fontSize: 18,
                  fontWeight: '800',
                  fontFamily: 'vrtlfinal',
                }}>
                  {infoCopy.mystery.confirmBtn}
                </Text>
              </TouchableOpacity>
            </RNAnimated.View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles (intentionally empty — all styles are inline per project convention)
// ──────────────────────────────────────────────────────────────────────────────
const _styles = StyleSheet.create({});
