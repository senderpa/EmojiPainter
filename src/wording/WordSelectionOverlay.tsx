/**
 * Word Selection Overlay
 *
 * Simple overlay for entering custom words with optional random word suggestion
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Modal, KeyboardAvoidingView, Platform, Animated } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import type { InfoLanguage } from '../lib/infoCopy';
import { getInfoCopy } from '../lib/infoCopy';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;
const dailyTopics = require('../../assets/daily_paint_topics_2025time.json');

type WordSelectionOverlayProps = {
  visible: boolean;
  language?: InfoLanguage;
  onSelectCustom: (word: string) => void;
  onCancel: () => void;
};

const WordSelectionOverlay: React.FC<WordSelectionOverlayProps> = ({
  visible,
  language = 'en',
  onSelectCustom,
  onCancel
}) => {
  const [customWord, setCustomWord] = useState('');
  const [loaderVideoUri, setLoaderVideoUri] = useState<string | null>(null);

  // Glitch animation state for time display
  const glitchOpacity = useRef(new Animated.Value(1)).current;
  const [glitchNumber, setGlitchNumber] = useState(8);
  const glitchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Calculate estimated time based on word length (1 minute per character)
  const estimatedMinutes = Math.max(1, customWord.trim().length || 8);

  // Reset input when overlay opens
  useEffect(() => {
    if (visible) {
      setCustomWord('');
      setGlitchNumber(8); // Reset to default
    }
  }, [visible]);

  // Glitch animation effect - runs for 1 second on open
  useEffect(() => {
    if (!visible) {
      // Clear any running animation
      if (glitchIntervalRef.current) {
        clearInterval(glitchIntervalRef.current);
        glitchIntervalRef.current = null;
      }
      return;
    }

    // Start glitch animation
    const glitchDuration = 1000; // 1 second total
    const glitchInterval = 50; // Change number every 50ms
    const startTime = Date.now();
    const targetNumber = estimatedMinutes;

    glitchIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;

      if (elapsed >= glitchDuration) {
        // Stop glitching, show final number
        setGlitchNumber(targetNumber);
        if (glitchIntervalRef.current) {
          clearInterval(glitchIntervalRef.current);
          glitchIntervalRef.current = null;
        }
        // Final opacity animation
        Animated.timing(glitchOpacity, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true
        }).start();
      } else {
        // Random glitch number close to target
        const randomOffset = Math.floor(Math.random() * 4) - 2; // -2 to +2
        const glitchedValue = Math.max(1, targetNumber + randomOffset);
        setGlitchNumber(glitchedValue);

        // Random opacity flicker
        const randomOpacity = 0.3 + Math.random() * 0.7;
        Animated.timing(glitchOpacity, {
          toValue: randomOpacity,
          duration: 30,
          useNativeDriver: true
        }).start();
      }
    }, glitchInterval);

    return () => {
      if (glitchIntervalRef.current) {
        clearInterval(glitchIntervalRef.current);
        glitchIntervalRef.current = null;
      }
    };
  }, [visible, estimatedMinutes, glitchOpacity]);

  // Load loader video
  useEffect(() => {
    const loadLoaderVideo = async () => {
      try {
        // Get logo set 13 from cache
        const logoSet = 13;
        const cacheDir = `${FileSystem.cacheDirectory}logos/${logoSet}/`;
        const cacheInfo = await FileSystem.getInfoAsync(cacheDir);

        if (cacheInfo.exists) {
          const files = await FileSystem.readDirectoryAsync(cacheDir);
          const videoFile = files.find(f => f.endsWith('.mp4') || f.endsWith('.mov'));
          if (videoFile) {
            setLoaderVideoUri(`${cacheDir}${videoFile}`);
          }
        }
      } catch (error) {
        console.error('[WordSelection] Failed to load loader video:', error);
      }
    };

    if (visible) {
      loadLoaderVideo();
    }
  }, [visible]);

  // Get random word from today's topics
  const getRandomWord = () => {
    try {
      const today = new Date();
      const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const todayEntry = dailyTopics.find((entry: any) => entry.date === dateKey);

      if (todayEntry && todayEntry.topics && todayEntry.topics.length >= 3) {
        // Get first word from each of the first 3 topics
        const words = todayEntry.topics.slice(0, 3).map((topic: any) => {
          const translatedTopic = topic.translations?.[language] || topic.topic;
          return translatedTopic.split(' ')[0].toUpperCase();
        });

        // Pick random word from the 3
        const randomWord = words[Math.floor(Math.random() * words.length)];
        setCustomWord(randomWord);
      } else {
        // Fallback to some fun words
        const fallbackWords = ['CREATIVE', 'ARTISTIC', 'COLORFUL'];
        setCustomWord(fallbackWords[Math.floor(Math.random() * fallbackWords.length)]);
      }
    } catch (error) {
      console.error('[WordSelection] Failed to get random word:', error);
      setCustomWord('CREATIVE');
    }
  };

  const handleSubmit = () => {
    const trimmed = customWord.trim(); // Keep user's exact input, no uppercase conversion
    if (trimmed.length > 0 && trimmed.length <= 12) {
      onSelectCustom(trimmed);
      setCustomWord('');
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Loader Animation */}
        {loaderVideoUri && (
          <View style={styles.loaderContainer}>
            <Video
              source={{ uri: loaderVideoUri }}
              style={styles.loaderVideo}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isLooping
              isMuted
              useNativeControls={false}
            />
          </View>
        )}

        <View style={styles.container}>
          <Text style={styles.title}>Choose Your Word</Text>

          {/* Time Display with Glitch Effect */}
          <View style={styles.timeDisplay}>
            <Animated.Text style={[styles.timeNumber, { opacity: glitchOpacity }]}>
              {glitchNumber}
            </Animated.Text>
            <Text style={styles.timeUnit}>min</Text>
          </View>

          <Text style={styles.infoText}>
            Paint each letter of the word, one at a time. Each letter gets timed, and you'll create a video timelapse of your artwork!
          </Text>

          {/* Custom Word Input */}
          <View style={styles.customWordSection}>
            <Text style={styles.sectionLabel}>Enter Your Word (Letters, Numbers, Symbols)</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                value={customWord}
                onChangeText={(text) => setCustomWord(text.slice(0, 12))}
                placeholder="YourWord"
                placeholderTextColor="#ff9f6b"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                keyboardType="default"
                returnKeyType="done"
                autoFocus
                maxLength={12}
              />
              <TouchableOpacity
                style={styles.diceButton}
                onPress={getRandomWord}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.diceIcon}>🎲</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.charCount}>{customWord.length}/12 characters</Text>
            <Text style={styles.hintText}>
              💡 Use UPPERCASE, lowercase, numbers, or symbols like !@#$%
            </Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={onCancel}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  customWord.trim().length === 0 && styles.disabledButton
                ]}
                onPress={handleSubmit}
                disabled={customWord.trim().length === 0}
              >
                <Text style={styles.primaryButtonText}>Let's Go</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  loaderContainer: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    width: 256,
    height: 256,
    zIndex: 10
  },
  loaderVideo: {
    width: '100%',
    height: '100%'
  },
  container: {
    width: '90%',
    maxWidth: 500,
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 32,
    gap: 20
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8
  },
  timeDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginVertical: 12
  },
  timeNumber: {
    fontSize: 64,
    fontWeight: '900',
    color: '#ff6b6b',
    letterSpacing: -2
  },
  timeUnit: {
    fontSize: 32,
    fontWeight: '600',
    color: '#ff9f6b',
    marginLeft: 8
  },
  infoText: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12
  },
  customWordSection: {
    gap: 16
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  inputContainer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center'
  },
  input: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    borderWidth: 2,
    borderColor: '#ff9f6b'
  },
  diceButton: {
    position: 'absolute',
    right: 12,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#333',
    borderRadius: 8
  },
  diceIcon: {
    fontSize: 24
  },
  charCount: {
    fontSize: 12,
    color: '#666',
    textAlign: 'right'
  },
  hintText: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    lineHeight: 18,
    fontStyle: 'italic'
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444'
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff'
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#ff9f6b',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center'
  },
  primaryButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000'
  },
  disabledButton: {
    opacity: 0.5
  }
});

export default WordSelectionOverlay;
