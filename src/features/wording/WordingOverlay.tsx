/**
 * WordingOverlay
 *
 * Renders all wording-mode overlays:
 *   - Countdown timer (with close and Done buttons)
 *   - Progress bubbles showing letter statuses
 *   - Transition message between letters
 *   - LetterCompleteOverlay (after each letter export)
 *   - AnimatedLoader during final stitching
 *   - WordSelectionOverlay to pick the word
 *
 * The heavy-modal components (ArModeChooser, ArPaintingScreen, FaceMeshOverlay,
 * FramerWorkspace) are NOT part of this file — they remain in PaintScreen.
 * This file owns only the wording-specific overlays listed above.
 */

import React, { useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import * as Haptics from 'expo-haptics';
import type { InfoLanguage } from '../../lib/infoCopy';
import { LetterCompleteOverlay } from '../../components/LetterCompleteOverlay';
import AnimatedLoader from '../../components/AnimatedLoader';
import WordSelectionOverlay from '../../wording/WordSelectionOverlay';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Mirrors the LetterState defined in WordingContext */
type LetterState = {
  letter: string;
  index: number;
  status: 'pending' | 'painting' | 'exporting' | 'complete' | 'reviewing';
  exportPath?: string;
};

type WordingMode = 'inactive' | 'active' | 'stitching' | 'complete';

/** The slice of WordingContext that WordingOverlay needs */
export interface WordingState {
  mode: WordingMode;
  word: string;
  letters: LetterState[];
  currentLetterIndex: number;
  timeRemaining: number;
  showTransition: boolean;
  transitionMessage: string;
  exportProgress: number;
  showLetterComplete: boolean;
  completedLetterPath: string;
  isWordingActive: () => boolean;
  stopWording: () => void;
  finishLetterEarly: () => void;
  proceedToNextLetter: () => void;
  startWording: (customWord: string, language?: InfoLanguage) => Promise<void>;
}

export interface WordingOverlayProps {
  /** Full wording context object (from useWording()) */
  wording: WordingState;
  /** Controls the WordSelectionOverlay */
  showWordSelection: boolean;
  setShowWordSelection: (value: boolean) => void;
  /** Language for localization passed to WordSelectionOverlay */
  infoLanguage: InfoLanguage;
  /** Ref used to track programmatic cancellation across renders */
  wordingCancelledRef: React.MutableRefObject<boolean>;
  /** Called when an alert/error needs to surface to the user */
  onAlert: (title: string, message: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;

const WordingOverlay: React.FC<WordingOverlayProps> = ({
  wording,
  showWordSelection,
  setShowWordSelection,
  infoLanguage,
  wordingCancelledRef,
  onAlert,
}) => {
  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Active wording overlays (timer + progress + transition)             */}
      {/* ------------------------------------------------------------------ */}
      {wording.isWordingActive() && (
        <>
          {/* Countdown Timer - Small overlay showing time remaining */}
          <View style={styles.wordingTimerOverlay} pointerEvents="auto">
            <TouchableOpacity
              style={styles.wordingTimerCloseButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                wordingCancelledRef.current = true; // Mark as cancelled
                wording.stopWording();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.wordingTimerCloseIcon}>✕</Text>
            </TouchableOpacity>
            {/* Done button for early finish */}
            <TouchableOpacity
              style={styles.wordingDoneButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                wording.finishLetterEarly();
              }}
            >
              <Text style={styles.wordingDoneButtonText}>Done</Text>
            </TouchableOpacity>
            <View style={styles.wordingTimerBox}>
              <Text style={styles.wordingTimerLabel}>Time Left</Text>
              <Text style={styles.wordingTimerValue}>
                {Math.floor(wording.timeRemaining / 60)}:{String(wording.timeRemaining % 60).padStart(2, '0')}
              </Text>
            </View>
          </View>

          {/* Progress Bubbles - Show all letters with their status */}
          <View style={styles.wordingProgressOverlay} pointerEvents="none">
            <View style={styles.wordingProgressContainer}>
              <Text style={styles.wordingProgressTitle}>{wording.word}</Text>
              <View style={styles.wordingProgressBubbles}>
                {wording.letters.map((letter, index) => (
                  <View
                    key={index}
                    style={[
                      styles.wordingProgressBubble,
                      letter.status === 'complete' && styles.wordingProgressBubbleComplete,
                      letter.status === 'painting' && styles.wordingProgressBubblePainting,
                      letter.status === 'exporting' && styles.wordingProgressBubbleExporting,
                      letter.status === 'reviewing' && styles.wordingProgressBubbleExporting
                    ]}
                  >
                    <Text style={[
                      styles.wordingProgressBubbleText,
                      letter.status === 'complete' && styles.wordingProgressBubbleTextComplete
                    ]}>
                      {letter.letter}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Transition Message - Shows between letters */}
          {wording.showTransition && (
            <View style={styles.wordingTransitionOverlay} pointerEvents="none">
              <View style={styles.wordingTransitionBox}>
                <Text style={styles.wordingTransitionText}>{wording.transitionMessage}</Text>
              </View>
            </View>
          )}
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Letter Complete Overlay - Shows when letter is exported             */}
      {/* ------------------------------------------------------------------ */}
      <LetterCompleteOverlay
        visible={wording.showLetterComplete}
        letter={wording.letters[wording.currentLetterIndex]?.letter || ''}
        videoUri={wording.completedLetterPath}
        letterIndex={wording.currentLetterIndex}
        totalLetters={wording.letters.length}
        onNext={wording.proceedToNextLetter}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Animated Loader - Shows during final export stitching               */}
      {/* ------------------------------------------------------------------ */}
      {wording.mode === 'stitching' && (
        <AnimatedLoader
          progress={wording.exportProgress}
          message={`Creating "${wording.word}" video...`}
          showProgressBar={true}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Word Selection Overlay                                              */}
      {/* ------------------------------------------------------------------ */}
      <WordSelectionOverlay
        key={`word-selection-${infoLanguage}`}
        visible={showWordSelection}
        language={infoLanguage}
        onSelectCustom={(customWord) => {
          wordingCancelledRef.current = false; // Reset flag when starting
          setShowWordSelection(false);
          wording.startWording(customWord, infoLanguage).catch((error) => {
            console.error('[WordingOverlay] Failed to start wording:', error);
            onAlert('Error', 'Failed to start wording mode');
          });
        }}
        onCancel={() => {
          wordingCancelledRef.current = true; // Mark as cancelled
          setShowWordSelection(false);
        }}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// Styles (copied verbatim from PaintScreen wording style block)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  wordingTimerOverlay: {
    position: 'absolute',
    bottom: 150,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 10,
    padding: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  wordingTimerBox: {
    alignItems: 'center',
    gap: 2,
  },
  wordingTimerLabel: {
    fontSize: 9,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  wordingTimerValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  wordingDoneButton: {
    position: 'absolute',
    top: -32,
    right: 0,
    backgroundColor: '#4a9eff',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  wordingDoneButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  wordingTimerCloseButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 10,
  },
  wordingTimerCloseIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 14,
  },
  wordingProgressOverlay: {
    position: 'absolute',
    bottom: 150,
    left: 20,
    right: 120,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  wordingProgressContainer: {
    gap: 8,
  },
  wordingProgressTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 2,
  },
  wordingProgressBubbles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  wordingProgressBubble: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wordingProgressBubblePainting: {
    backgroundColor: '#3a5a8a',
    borderColor: '#5a8aca',
  },
  wordingProgressBubbleExporting: {
    backgroundColor: '#8a6a3a',
    borderColor: '#ca9a5a',
  },
  wordingProgressBubbleComplete: {
    backgroundColor: '#3a8a5a',
    borderColor: '#5aca8a',
  },
  wordingProgressBubbleText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#888',
  },
  wordingProgressBubbleTextComplete: {
    color: '#fff',
  },
  wordingTransitionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  wordingTransitionBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 32,
    paddingHorizontal: 48,
    borderWidth: 2,
    borderColor: '#5a8aca',
    shadowColor: '#5a8aca',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  wordingTransitionText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 1,
  },
});

export default WordingOverlay;
