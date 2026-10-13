/**
 * Letter Complete Overlay
 *
 * Shows when a letter is finished exporting during wording mode.
 * Displays the exported video and allows user to proceed to next letter.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Dimensions, ActivityIndicator, Platform } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { Video, ResizeMode } from 'expo-av';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

type LetterCompleteOverlayProps = {
  visible: boolean;
  letter: string;
  videoUri: string; // The .mov file IS the preview - play it directly!
  letterIndex: number;
  totalLetters: number;
  onNext: () => void;
};

export const LetterCompleteOverlay: React.FC<LetterCompleteOverlayProps> = ({
  visible,
  letter,
  videoUri,
  letterIndex,
  totalLetters,
  onNext
}) => {
  const videoRef = useRef<Video>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Use the .mov video file directly as preview
  useEffect(() => {
    if (videoUri) {
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
  }, [videoUri]);

  // Auto-play video when ready
  useEffect(() => {
    if (visible && videoUri && videoRef.current) {
      videoRef.current.playAsync();
    }
  }, [visible, videoUri]);

  if (!visible) return null;

  const isLastLetter = letterIndex === totalLetters - 1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={isLoading ? undefined : onNext}
      supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {isLoading ? (
            /* Loading State - Export in Progress */
            <>
              <Text style={styles.title}>Exporting Letter...</Text>
              <Text style={styles.letter}>{letter}</Text>
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#4a9eff" />
                <Text style={styles.loadingText}>Exporting letter...</Text>
              </View>
            </>
          ) : (
            /* Preview State - Export Complete */
            <>
              <Text style={styles.title}>
                Letter {letterIndex + 1}/{totalLetters} Complete!
              </Text>
              <Text style={styles.letter}>{letter}</Text>

              {/* 128x128 Video Preview - playing the actual .mov timelapse */}
              <View style={styles.videoContainer}>
                {videoUri ? (
                  <Video
                    ref={videoRef}
                    source={{ uri: videoUri }}
                    style={styles.video}
                    resizeMode={ResizeMode.CONTAIN}
                    isLooping
                    shouldPlay
                    useNativeControls={false}
                  />
                ) : (
                  <View style={styles.videoPlaceholder}>
                    <Text style={styles.placeholderText}>No preview available</Text>
                  </View>
                )}
              </View>

              {/* Next Letter Button */}
              <TouchableOpacity style={styles.button} onPress={onNext}>
                <Text style={styles.buttonText}>
                  {isLastLetter ? 'Finish' : 'Next Letter →'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: SCREEN_WIDTH * 0.85,
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#333',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  letter: {
    fontSize: 48,
    fontWeight: '900',
    color: '#4a9eff',
    marginBottom: 24,
  },
  videoContainer: {
    width: 128,
    height: 128,
    backgroundColor: '#000',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
    alignSelf: 'center',
  },
  video: {
    width: 128,
    height: 128,
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#666',
    fontSize: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#4a9eff',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  loadingContainer: {
    width: '100%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: 16,
    marginBottom: 24,
  },
  loadingText: {
    color: '#999',
    fontSize: 16,
    marginTop: 16,
  },
});
