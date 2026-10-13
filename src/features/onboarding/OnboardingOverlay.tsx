// @ts-nocheck
/**
 * OnboardingOverlay — pure presentational component for the first-time welcome screen.
 *
 * Receives all state via props from useOnboarding (see UseOnboardingResult) plus a handful
 * of extra props that are available in PaintScreen but not routed through the hook to keep
 * the hook's dependency surface small:
 *   - notificationsEnabled / setNotificationsEnabled (PaintScreen state)
 *   - parentalControls (from useParentalControls)
 *   - setInfoVisible (from useInfoPanel result)
 *   - infoCopy (from useInfoPanel result)
 *   - infoPulseScale / infoPulseOpacity (interpolations from PaintScreen)
 *   - insets (from useSafeAreaInsets)
 *
 * Has ZERO internal side-effects; all logic lives in useOnboarding.
 */
import React from 'react';
import { Alert, Animated as RNAnimated, Platform, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Video, type AVPlaybackStatus } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { notificationService } from '../../services/notificationService';
import { INFO_LANGUAGE_OPTIONS } from '../info-panel/useInfoPanel';
import { saveLanguagePreference } from '../../lib/languageStorage';
import { WELCOME_UI_TRANSLATIONS, type UseOnboardingResult } from './useOnboarding';
import type { InfoCopy } from '../info-panel/useInfoPanel';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

type Props = UseOnboardingResult & {
  /** Whether push notifications are currently enabled — from PaintScreen state */
  notificationsEnabled: boolean;
  /** Setter for notifications enabled state — from PaintScreen state */
  setNotificationsEnabled: (v: boolean) => void;
  /** Shows terms first when needed, then asks iOS for notification permission. */
  requestNotificationPermission: () => Promise<boolean>;
  /** Parental-controls state object — from useParentalControls */
  parentalControls: { enabled: boolean; [key: string]: any };
  /** Open the info panel — from useInfoPanel result */
  setInfoVisible: (v: boolean) => void;
  /** All info-panel copy strings — from useInfoPanel result */
  infoCopy: InfoCopy;
  /** Interpolated scale for the pulsing Paint button — from PaintScreen */
  infoPulseScale: RNAnimated.AnimatedInterpolation<number>;
  /** Interpolated opacity for the pulsing Paint button — from PaintScreen */
  infoPulseOpacity: RNAnimated.AnimatedInterpolation<number>;
  /** Safe area insets — from useSafeAreaInsets */
  insets: { top: number; [key: string]: number };
};

const OnboardingOverlay: React.FC<Props> = (props) => {
  const {
    welcomeOverlayVisible,
    setWelcomeOverlayVisible,
    welcomerVideoSource,
    welcomeVideoRef,
    welcomeTypewriterText,
    handleWelcomeVideoTap,
    handleWelcomeVideoEnd,
    handleWelcomeProfile,
    handleWelcomePaint,
    handleWelcomeGallery,
    handleWelcomeParentalControls,
    markOnboardingCompleted,
    infoLanguage,
    setInfoLanguage,
    settings,
    setHandMode,
    // Extra direct props
    notificationsEnabled,
    setNotificationsEnabled,
    requestNotificationPermission,
    parentalControls,
    setInfoVisible,
    infoCopy,
    infoPulseScale,
    infoPulseOpacity,
    insets,
  } = props;

  if (!welcomeOverlayVisible || !welcomerVideoSource) {
    return null;
  }

  return (
    <View style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: '#000',
      zIndex: 10000
    }}>
      {/* Background Video - Full screen, touchable to change */}
      <TouchableOpacity
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={handleWelcomeVideoTap}
        activeOpacity={0.95}
      >
        <Video
          ref={welcomeVideoRef}
          source={welcomerVideoSource}
          style={{ width: '100%', height: '100%' }}
          resizeMode={IS_IPAD ? 'contain' : 'cover'}
          shouldPlay
          // Not looped: when a clip ends the handler swaps in a DIFFERENT random welcomer,
          // so the background keeps changing instead of repeating one clip forever.
          isLooping={false}
          volume={1.0}
          onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
            if (status.isLoaded && status.didJustFinish) {
              handleWelcomeVideoEnd();
            }
          }}
        />
      </TouchableOpacity>

      {/* Content Container */}
      <View
        pointerEvents="box-none"
        style={{
          flex: 1,
          paddingTop: insets.top + 40,
          paddingBottom: 60,
          paddingHorizontal: 20
        }}
      >
        {/* ── Welcome panel — all content in one frosted card ── */}
        <View
          pointerEvents="box-none"
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          {/* Typewriter welcome text — above the panel */}
          <View style={{ alignItems: 'center', marginBottom: IS_IPAD ? 18 : 12 }}>
            <Text style={{
              color: '#fff',
              fontSize: IS_IPAD ? 52 : 38,
              fontWeight: 'bold',
              fontFamily: 'vrtlfinal',
              textAlign: 'center',
              textShadowColor: 'rgba(0,0,0,0.85)',
              textShadowOffset: { width: 2, height: 2 },
              textShadowRadius: 6,
            }}>
              {welcomeTypewriterText}
            </Text>
          </View>

          {/* Frosted panel */}
          <View pointerEvents="auto" style={{
            backgroundColor: 'rgba(0,0,0,0.58)',
            borderRadius: 24,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            paddingVertical: IS_IPAD ? 22 : 16,
            paddingHorizontal: IS_IPAD ? 28 : 18,
            gap: IS_IPAD ? 16 : 12,
          }}>

            {/* Language flags */}
            <View style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: IS_IPAD ? 6 : 4,
            }}>
              {INFO_LANGUAGE_OPTIONS.map((option) => {
                const active = option.id === infoLanguage;
                return (
                  <TouchableOpacity
                    key={option.id}
                    style={{
                      paddingVertical: IS_IPAD ? 4 : 3,
                      paddingHorizontal: IS_IPAD ? 8 : 6,
                      borderRadius: 10,
                      backgroundColor: active ? 'rgba(255,159,107,0.5)' : 'rgba(255,255,255,0.15)',
                      borderWidth: 1.5,
                      borderColor: active ? '#ff9f6b' : 'rgba(255,255,255,0.3)',
                    }}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setInfoLanguage(option.id);
                      void saveLanguagePreference(option.id);
                    }}
                  >
                    <Text style={{ fontSize: IS_IPAD ? 15 : 13 }}>{option.flag}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Row 1: Hand toggle · Profile · Info */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {/* Hand mode toggle */}
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: IS_IPAD ? 11 : 9,
                  paddingHorizontal: 4,
                  borderRadius: 13,
                  backgroundColor: 'rgba(255,159,107,0.4)',
                  borderWidth: 1.5,
                  borderColor: '#ff9f6b',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setHandMode(settings.handMode === 'right' ? 'left' : 'right');
                }}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#fff', fontSize: IS_IPAD ? 15 : 12, fontWeight: 'bold', fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                  {settings.handMode === 'right'
                    ? `👉 ${infoCopy?.allOverSettings?.handModeRight ?? 'Right Hand'}`
                    : `👈 ${infoCopy?.allOverSettings?.handModeLeft ?? 'Left Hand'}`}
                </Text>
              </TouchableOpacity>
              {/* Profile */}
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'rgba(255,193,7,0.9)', paddingVertical: IS_IPAD ? 11 : 9, paddingHorizontal: 4, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}
                onPress={handleWelcomeProfile}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#fff', fontSize: IS_IPAD ? 15 : 12, fontWeight: 'bold', fontFamily: 'vrtlfinal', textAlign: 'center' }}>{WELCOME_UI_TRANSLATIONS[infoLanguage].profile}</Text>
              </TouchableOpacity>
              {/* Info */}
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'rgba(33,150,243,0.9)', paddingVertical: IS_IPAD ? 11 : 9, paddingHorizontal: 4, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}
                onPress={() => {
                  markOnboardingCompleted();
                  setWelcomeOverlayVisible(false);
                  setInfoVisible(true);
                }}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#fff', fontSize: IS_IPAD ? 15 : 12, fontWeight: 'bold', fontFamily: 'vrtlfinal', textAlign: 'center' }}>{WELCOME_UI_TRANSLATIONS[infoLanguage].info}</Text>
              </TouchableOpacity>
            </View>

            {/* Row 2: Gallery · Painting — big buttons */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {/* Gallery */}
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'rgba(156,39,176,0.9)', paddingVertical: IS_IPAD ? 22 : 18, paddingHorizontal: 4, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}
                onPress={handleWelcomeGallery}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#fff', fontSize: IS_IPAD ? 20 : 16, fontWeight: 'bold', fontFamily: 'vrtlfinal', textAlign: 'center' }}>{WELCOME_UI_TRANSLATIONS[infoLanguage].gallery}</Text>
              </TouchableOpacity>
              {/* Painting — pulsing orange, big */}
              <RNAnimated.View style={{ flex: 1, transform: [{ scale: infoPulseScale }], opacity: infoPulseOpacity }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: 'rgba(255,87,34,0.95)', paddingVertical: IS_IPAD ? 22 : 18, paddingHorizontal: 4, borderRadius: 16, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}
                  onPress={handleWelcomePaint}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: '#fff', fontSize: IS_IPAD ? 20 : 16, fontWeight: 'bold', fontFamily: 'vrtlfinal', textAlign: 'center' }}>🎨 {WELCOME_UI_TRANSLATIONS[infoLanguage].startPainting}</Text>
                </TouchableOpacity>
              </RNAnimated.View>
            </View>

            {/* Notifications + Parental — same row on iPad, stacked on iPhone */}
            <View style={{
              flexDirection: IS_IPAD ? 'row' : 'column',
              gap: IS_IPAD ? 10 : 8,
              alignItems: IS_IPAD ? 'center' : 'stretch',
            }}>
              {/* Notification toggle */}
              <View style={{
                flex: IS_IPAD ? 1 : undefined,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: 'rgba(255,255,255,0.08)',
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.15)',
              }}>
                <Text style={{ color: '#fff', fontSize: IS_IPAD ? 14 : 13, fontFamily: 'vrtlfinal', flex: 1 }}>
                  {WELCOME_UI_TRANSLATIONS[infoLanguage].notifications}
                </Text>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={async (enabled) => {
                    if (enabled) {
                      const success = await requestNotificationPermission();
                      setNotificationsEnabled(success);
                      if (success) {
                        Alert.alert(
                          WELCOME_UI_TRANSLATIONS[infoLanguage].notifEnabledTitle,
                          WELCOME_UI_TRANSLATIONS[infoLanguage].notifEnabledBody,
                          [{ text: WELCOME_UI_TRANSLATIONS[infoLanguage].notifEnabledBtn }]
                        );
                      }
                    } else {
                      await notificationService.disable();
                      setNotificationsEnabled(false);
                    }
                  }}
                  trackColor={{ false: '#444', true: '#4a9eff' }}
                  thumbColor={notificationsEnabled ? '#fff' : '#ccc'}
                  style={{ transform: [{ scale: 0.85 }] }}
                />
              </View>

              {/* Parental controls */}
              <TouchableOpacity
                style={{
                  flex: IS_IPAD ? 1 : undefined,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: 'rgba(0,255,255,0.25)',
                }}
                onPress={handleWelcomeParentalControls}
                activeOpacity={0.75}
              >
                <Text style={{ fontSize: 15 }}>🛡️</Text>
                <Text style={{ color: 'rgba(0,255,255,0.9)', fontSize: IS_IPAD ? 14 : 13, fontFamily: 'vrtlfinal', fontWeight: '600', flex: 1 }}>
                  {parentalControls?.enabled
                    ? WELCOME_UI_TRANSLATIONS[infoLanguage].parentalControlsOn
                    : WELCOME_UI_TRANSLATIONS[infoLanguage].parentalControlsOff}
                </Text>
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </View>
    </View>
  );
};

export default React.memo(OnboardingOverlay);
