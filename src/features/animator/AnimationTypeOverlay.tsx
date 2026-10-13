/**
 * AnimationTypeOverlay
 *
 * Renders the animation type selection modal, wording completion overlay,
 * clear confirmation overlay, frame picker popup, and animation saved overlay.
 *
 * Pure presentational component — all state and handlers arrive via props.
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import { AppText } from '../../emoji/AppText';
import ClearConfirmOverlay from '../../components/ClearConfirmOverlay';
import CompletionOverlay from '../../wording/CompletionOverlay';
import AnimationSavedOverlay from '../../components/AnimationSavedOverlay';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;

// ---------------------------------------------------------------------------
// Local type definitions
// ---------------------------------------------------------------------------

interface AnimationFrame {
  id: string;
  strokes: any[];
  timestamp: number;
  thumbnail?: string;
  renderedImageUri?: string;
}

interface WordingLetter {
  letter: string;
  exportPath?: string;
}

interface NavigationLike {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  setParams: (params: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AnimationTypeOverlayProps {
  /** Controls the "Choose Animation Type" modal */
  animationTypeVisible: boolean;
  /** Controls the wording completion overlay (true when mode is 'complete' or 'stitching') */
  completionVisible: boolean;
  /** Controls the clear-canvas confirmation overlay */
  clearConfirmVisible: boolean;
  /** Unused directly — AnimationSavedOverlay is self-contained via app events */
  animationSavedVisible?: boolean;
  /** Controls the frame picker popup */
  framePickerVisible: boolean;

  // ---- frame picker data ----
  frameButtonPosition: { x: number; y: number; width: number; height: number } | null;
  frames: AnimationFrame[];
  currentFrameIndex: number;

  // ---- wording data (for CompletionOverlay) ----
  wordingMode: 'inactive' | 'active' | 'complete' | 'stitching';
  wordingWord: string;
  wordingFinalVideoPath: string;
  wordingLetters: WordingLetter[];
  wordingExportProgress: number;

  // ---- all handlers and refs ----
  handlers: {
    setShowAnimationModal: (visible: boolean) => void;
    setInfoVisible: (visible: boolean) => void;
    wordingCancelledRef: React.MutableRefObject<boolean>;
    toggleFrameMode: (enable: boolean) => void | Promise<void>;
    stopWording: () => void;
    exportComposition: () => void | Promise<void>;
    handleClearConfirmed: () => void;
    setShowClearConfirm: (visible: boolean) => void;
    setStrokesClearProgress: (progress: number) => void;
    handleFramePickerSelect: (index: number) => void | Promise<void>;
    setFramePickerVisible: (visible: boolean) => void;
    navigation: NavigationLike;
  };

  insets?: { top: number; bottom: number; left: number; right: number };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AnimationTypeOverlay: React.FC<AnimationTypeOverlayProps> = (props) => {
  const {
    animationTypeVisible: showAnimationModal,
    clearConfirmVisible: showClearConfirm,
    framePickerVisible,
    frameButtonPosition,
    frames,
    currentFrameIndex,
    wordingMode,
    wordingWord,
    wordingFinalVideoPath,
    wordingLetters,
    wordingExportProgress,
    handlers,
  } = props;

  const {
    setShowAnimationModal,
    setInfoVisible,
    wordingCancelledRef,
    toggleFrameMode,
    stopWording,
    exportComposition,
    handleClearConfirmed,
    setShowClearConfirm,
    setStrokesClearProgress,
    handleFramePickerSelect,
    setFramePickerVisible,
    navigation,
  } = handlers;

  // Reconstruct the wording object shape the JSX expects
  const wording = {
    mode: wordingMode,
    word: wordingWord,
    finalVideoPath: wordingFinalVideoPath,
    letters: wordingLetters,
    exportProgress: wordingExportProgress,
    stopWording,
    exportComposition,
  };

  return (
    <>
      {/* Animation Type Selection Modal */}
      <Modal
        visible={showAnimationModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowAnimationModal(false)}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={styles.animationModalOverlay}>
          <View style={styles.animationModalCard}>
            <Text style={styles.animationModalTitle}>Choose Animation Type</Text>

            {/* Wording Button */}
            <TouchableOpacity
              style={[styles.animationTypeButton, { backgroundColor: '#ffb84d' }]}
              onPress={() => {
                setShowAnimationModal(false);
                setInfoVisible(false);
                wordingCancelledRef.current = false;
                navigation.navigate('Paint', { startWording: true });
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.animationTypeButtonIcon}>✏️</Text>
              <View style={styles.animationTypeButtonTextContainer}>
                <Text style={styles.animationTypeButtonTitle}>Wording</Text>
                <Text style={styles.animationTypeButtonSubtitle}>Paint letters with countdown challenge</Text>
              </View>
            </TouchableOpacity>

            {/* Walking Button */}
            <TouchableOpacity
              style={[styles.animationTypeButton, { backgroundColor: '#6bff9f' }]}
              onPress={() => {
                setShowAnimationModal(false);
                setInfoVisible(false);
                toggleFrameMode(true);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.animationTypeButtonIcon}>🚶</Text>
              <View style={styles.animationTypeButtonTextContainer}>
                <Text style={styles.animationTypeButtonTitle}>Frame-by-Frame</Text>
                <Text style={styles.animationTypeButtonSubtitle}>Create frame-by-frame animations</Text>
              </View>
            </TouchableOpacity>

            {/* About Section */}
            <View style={styles.animationAboutSection}>
              <Text style={styles.animationAboutTitle}>About Animations</Text>
              <Text style={styles.animationAboutText}>
                Create frame-by-frame animations with countdown timers. Wording mode helps you paint letters,
                while Walking mode (coming soon) creates movement sequences.
              </Text>
              <Text style={styles.animationAboutText}>
                Each frame is exported as a transparent MOV file that can be composed in the Video Editor.
              </Text>
            </View>

            {/* Close Button */}
            <TouchableOpacity
              style={styles.animationModalCloseButton}
              onPress={() => setShowAnimationModal(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.animationModalCloseButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Completion Overlay - Shows when wording is complete */}
      <CompletionOverlay
        visible={wording.mode === 'complete' || wording.mode === 'stitching'}
        word={wording.word}
        videoPath={wording.finalVideoPath}
        letterVideos={wording.letters.map((l, index) => ({
          letter: l.letter,
          videoPath: l.exportPath ? l.exportPath.replace(/letter_(\d+)\.mov$/, 'letter_$1_preview.mp4') : ''
        }))}
        exportProgress={wording.exportProgress}
        isExporting={wording.mode === 'stitching'}
        onClose={() => {
          console.log('[PaintScreen] Closing wording completion overlay');
          wording.stopWording();
          // Clear the startWording param to prevent word selection overlay from showing again
          navigation.setParams({ startWording: undefined });
        }}
        onViewFolder={() => {
          console.log('[PaintScreen] Navigating to VideoStorage from wording completion');
          wording.stopWording();
          // Clear the startWording param to prevent word selection overlay from showing again
          navigation.setParams({ startWording: undefined });
          navigation.navigate('VideoStorage');
        }}
        onExportComposition={() => {
          void wording.exportComposition();
        }}
      />

      {/* Clear Confirmation Overlay */}
      <ClearConfirmOverlay
        visible={showClearConfirm}
        onConfirm={handleClearConfirmed}
        onCancel={() => {
          setShowClearConfirm(false);
          setStrokesClearProgress(0);
        }}
        onAnimatedClear={(progress) => {
          setStrokesClearProgress(progress);
        }}
      />

      {/* Frame Picker Popup - appears above 📽️ button on long-press */}
      {framePickerVisible && frameButtonPosition && frames.length > 0 && (
        <TouchableOpacity
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10003
          }}
          onPress={() => setFramePickerVisible(false)}
          activeOpacity={1}
        >
          <View
            style={{
              position: 'absolute',
              left: Math.max(20, frameButtonPosition.x - 40),
              bottom: Dimensions.get('window').height - frameButtonPosition.y + 10,
              backgroundColor: 'rgba(5,5,5,0.95)',
              borderRadius: 10,
              padding: 8,
              borderWidth: 1,
              borderColor: '#222',
              width: 90,
              maxHeight: 260,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.4,
              shadowRadius: 8
            }}
            onStartShouldSetResponder={() => true}
          >
            <ScrollView
              style={{ maxHeight: 240 }}
              showsVerticalScrollIndicator
            >
              <View style={{ gap: 8 }}>
                {frames.map((frame, index) => (
                  <TouchableOpacity
                    key={frame.id}
                    onPress={() => {
                      void handleFramePickerSelect(index);
                    }}
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 10,
                      borderWidth: index === currentFrameIndex ? 3 : 1,
                      borderColor: index === currentFrameIndex ? '#ff6b6b' : '#444',
                      backgroundColor: '#050505',
                      overflow: 'hidden',
                      alignSelf: 'center'
                    }}
                  >
                    {frame.thumbnail ? (
                      <Image
                        source={{ uri: frame.thumbnail }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={{ flex: 1, backgroundColor: '#111' }} />
                    )}
                    <View style={{
                      position: 'absolute',
                      bottom: 4,
                      right: 4,
                      backgroundColor: 'rgba(0,0,0,0.65)',
                      borderRadius: 6,
                      paddingHorizontal: 5,
                      paddingVertical: 2
                    }}>
                      <Text style={{
                        color: '#fff',
                        fontSize: 11,
                        fontFamily: 'vrtlfinal'
                      }}>{index + 1}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </TouchableOpacity>
      )}

      {/* Animation Saved Overlay - Shows when animation is saved */}
      <AnimationSavedOverlay />


    </>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  animationModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  animationModalCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 500,
    borderWidth: 1,
    borderColor: '#333'
  },
  animationModalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: 'vrtlfinal'
  },
  animationTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  animationTypeButtonIcon: {
    fontSize: 32,
    marginRight: 16
  },
  animationTypeButtonTextContainer: {
    flex: 1
  },
  animationTypeButtonTitle: {
    color: '#000',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
    fontFamily: 'vrtlfinal'
  },
  animationTypeButtonSubtitle: {
    color: '#000',
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.7
  },
  animationAboutSection: {
    marginTop: 8,
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222'
  },
  animationAboutTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    fontFamily: 'vrtlfinal'
  },
  animationAboutText: {
    fontSize: 13,
    color: '#aaa',
    lineHeight: 20,
    marginBottom: 8
  },
  animationModalCloseButton: {
    backgroundColor: '#333',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444'
  },
  animationModalCloseButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  }
});

export default AnimationTypeOverlay;
