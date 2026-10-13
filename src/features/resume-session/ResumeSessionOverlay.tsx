// @ts-nocheck
/**
 * ResumeSessionOverlay — animated in-game modal for resuming or discarding a saved session.
 *
 * Renders three distinct UI layers:
 *  1. The resume-session modal (panel + two buttons flying in from random directions)
 *  2. The first-stroke helper bubble (non-interactive hint on very first launch)
 *  3. The onboarding overlay (first-time welcome screen)
 *
 * All state is provided via props — this component has ZERO internal side-effects.
 */

import React from 'react';
import {
  Animated as RNAnimated,
  Dimensions,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppText } from '../../emoji/AppText';
import LogoAnimationLoop from '../../components/LogoAnimationLoop';
import OnboardingOverlay from '../onboarding/OnboardingOverlay';
import type { UseOnboardingResult } from '../onboarding/useOnboarding';
import type { InfoCopy } from '../info-panel/useInfoPanel';
import type { LogoSet } from '../../lib/logoManifest';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  // ── Resume session modal ────────────────────────────────────────────────
  /** Whether the resume-session modal is visible */
  showResumeModal: boolean;
  /** The autosave data that was found; modal only renders when this is truthy */
  resumeAutosaveData: any;
  /** Background opacity animation value */
  resumeModalBgAnim: RNAnimated.Value;
  /** Panel slide-in animation value (must have a `.direction` property: 0=top,1=right,2=bottom,3=left) */
  resumeModalPanelAnim: RNAnimated.Value;
  /** Button-1 (Start Fresh) slide-in animation value */
  resumeModalButton1Anim: RNAnimated.Value;
  /** Button-2 (Resume) slide-in animation value */
  resumeModalButton2Anim: RNAnimated.Value;
  /** Current logo set to display (image type only rendered here) */
  resumeLogoSet: LogoSet | null;
  /** Current frame index into resumeLogoSet.frames for the animated logo */
  resumeLogoFrameIndex: number;
  /** Called when user taps "START NEW" */
  handleStartFresh: () => void;
  /** Called when user taps "RESUME" */
  handleResumeSession: () => void;

  // ── First-stroke helper bubble ──────────────────────────────────────────
  firstStrokeHelperVisible: boolean;
  firstStrokeHelperText: string;

  // ── Onboarding overlay ──────────────────────────────────────────────────
  /** Spread-able result from useOnboarding() */
  onboarding: UseOnboardingResult;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  requestNotificationPermission: () => Promise<boolean>;
  parentalControls: { enabled: boolean; [key: string]: any };
  setInfoVisible: (v: boolean) => void;
  infoCopy: InfoCopy;
  infoPulseScale: RNAnimated.AnimatedInterpolation<number>;
  infoPulseOpacity: RNAnimated.AnimatedInterpolation<number>;
  insets: { top: number; [key: string]: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a transform array that slides `anim` in from the given direction.
 * Direction codes: 0=top, 1=right, 2=bottom, 3=left
 */
function getTransform(
  anim: RNAnimated.Value,
  dir: number,
): RNAnimated.AnimatedTransform {
  const distance = 1000;
  switch (dir) {
    case 0: // top
      return [
        {
          translateY: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [-distance, 0],
          }),
        },
      ];
    case 1: // right
      return [
        {
          translateX: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [distance, 0],
          }),
        },
      ];
    case 2: // bottom
      return [
        {
          translateY: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [distance, 0],
          }),
        },
      ];
    case 3: // left
      return [
        {
          translateX: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [-distance, 0],
          }),
        },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ResumeSessionOverlay: React.FC<Props> = ({
  showResumeModal,
  resumeAutosaveData,
  resumeModalBgAnim,
  resumeModalPanelAnim,
  resumeModalButton1Anim,
  resumeModalButton2Anim,
  resumeLogoSet,
  resumeLogoFrameIndex,
  handleStartFresh,
  handleResumeSession,
  firstStrokeHelperVisible,
  firstStrokeHelperText,
  onboarding,
  notificationsEnabled,
  setNotificationsEnabled,
  requestNotificationPermission,
  parentalControls,
  setInfoVisible,
  infoCopy,
  infoPulseScale,
  infoPulseOpacity,
  insets,
}) => {
  // Read directional hints attached to each anim value by the parent
  const panelDir = (resumeModalPanelAnim as any).direction || 0;
  const button1Dir = (resumeModalButton1Anim as any).direction || 0;
  const button2Dir = (resumeModalButton2Anim as any).direction || 0;

  return (
    <>
      {/* ─── Resume Session Modal - Animated In-Game Overlay ─────────────── */}
      {showResumeModal && resumeAutosaveData && (() => {
        const screenWidth = Dimensions.get('window').width;
        const screenHeight = Dimensions.get('window').height;

        return (
          <RNAnimated.View
            style={[
              styles.resumeModalOverlay,
              {
                opacity: resumeModalBgAnim,
              },
            ]}
            pointerEvents="box-none"
          >
            {/* Animated Panel */}
            <RNAnimated.View
              style={[
                styles.resumeModalContainer,
                {
                  transform: getTransform(resumeModalPanelAnim, panelDir),
                },
              ]}
            >
              {/* Animated Logo - only show if image type */}
              {resumeLogoSet && resumeLogoSet.type === 'image' && (
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <Image
                    source={
                      resumeLogoFrameIndex === 0
                        ? resumeLogoSet.baseIcon
                        : resumeLogoSet.frames[resumeLogoFrameIndex - 1] ??
                          resumeLogoSet.baseIcon
                    }
                    style={{ width: 240, height: 240, resizeMode: 'contain' }}
                  />
                </View>
              )}

              {/* Animated Button 1 - Start Fresh */}
              <RNAnimated.View
                style={{
                  width: '100%',
                  transform: getTransform(resumeModalButton1Anim, button1Dir),
                }}
              >
                <TouchableOpacity
                  style={[
                    styles.resumeModalButton,
                    styles.resumeModalButtonDestruct,
                  ]}
                  onPress={handleStartFresh}
                >
                  <Text style={styles.resumeModalButtonText}>START NEW</Text>
                </TouchableOpacity>
              </RNAnimated.View>

              {/* Animated Button 2 - Resume */}
              <RNAnimated.View
                style={{
                  width: '100%',
                  transform: getTransform(resumeModalButton2Anim, button2Dir),
                }}
              >
                <TouchableOpacity
                  style={[
                    styles.resumeModalButton,
                    styles.resumeModalButtonPrimary,
                  ]}
                  onPress={handleResumeSession}
                >
                  <Text style={styles.resumeModalButtonText}>RESUME</Text>
                </TouchableOpacity>
              </RNAnimated.View>
            </RNAnimated.View>
          </RNAnimated.View>
        );
      })()}

      {/* ─── First-Time Welcome Overlay ──────────────────────────────────── */}
      {/* One-time first-stroke helper bubble (very first launch only) */}
      {firstStrokeHelperVisible && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
        >
          <View
            style={{
              backgroundColor: 'rgba(0,0,0,0.78)',
              borderRadius: 22,
              borderWidth: 2,
              borderColor: '#ff9f6b',
              paddingVertical: IS_IPAD ? 18 : 14,
              paddingHorizontal: IS_IPAD ? 28 : 20,
              maxWidth: '80%',
              shadowColor: '#000',
              shadowOpacity: 0.5,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <Text
              style={{
                color: '#fff',
                fontSize: IS_IPAD ? 24 : 18,
                fontWeight: 'bold',
                fontFamily: 'vrtlfinal',
                textAlign: 'center',
              }}
            >
              {firstStrokeHelperText}
            </Text>
          </View>
        </View>
      )}

      <OnboardingOverlay
        {...onboarding}
        notificationsEnabled={notificationsEnabled}
        setNotificationsEnabled={setNotificationsEnabled}
        requestNotificationPermission={requestNotificationPermission}
        parentalControls={parentalControls}
        setInfoVisible={setInfoVisible}
        infoCopy={infoCopy}
        infoPulseScale={infoPulseScale}
        infoPulseOpacity={infoPulseOpacity}
        insets={insets}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // ── Resume modal overlay (full-screen dim) ────────────────────────────
  resumeModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },

  // ── Panel card ────────────────────────────────────────────────────────
  resumeModalContainer: {
    width: IS_IPAD ? 480 : 320,
    backgroundColor: '#1a1a2e',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#ff9f6b',
    paddingVertical: IS_IPAD ? 40 : 32,
    paddingHorizontal: IS_IPAD ? 40 : 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },

  // ── Shared button base ────────────────────────────────────────────────
  resumeModalButton: {
    width: '100%',
    paddingVertical: IS_IPAD ? 18 : 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },

  // ── Destructive variant (Start Fresh) ────────────────────────────────
  resumeModalButtonDestruct: {
    backgroundColor: 'rgba(255,80,80,0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,80,80,0.55)',
  },

  // ── Primary variant (Resume) ──────────────────────────────────────────
  resumeModalButtonPrimary: {
    backgroundColor: 'rgba(255,159,107,0.22)',
    borderWidth: 1.5,
    borderColor: '#ff9f6b',
  },

  // ── Button label ──────────────────────────────────────────────────────
  resumeModalButtonText: {
    color: '#fff',
    fontSize: IS_IPAD ? 20 : 16,
    fontWeight: '800',
    fontFamily: 'vrtlfinal',
    letterSpacing: 1.5,
  },
});

export default ResumeSessionOverlay;
