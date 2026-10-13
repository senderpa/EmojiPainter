import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Modal, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import * as Haptics from 'expo-haptics';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

interface RateAppOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  onRate: () => void;
}

const APP_STORE_URL = 'https://apps.apple.com/de/app/emoji-painter/id6753342820';

const RateAppOverlay: React.FC<RateAppOverlayProps> = ({ visible, onDismiss, onRate }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;
  // isMounted keeps the component tree alive during the exit animation.
  // The Modal's visible prop uses the actual `visible` prop directly so touches
  // are unblocked immediately on dismiss (not delayed by the animation).
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true
        })
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true
        }),
        Animated.timing(scale, {
          toValue: 0.85,
          duration: 200,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true
        })
      ]).start(() => {
        setIsMounted(false);
      });
    }
  }, [visible]);

  const handleRate = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const supported = await Linking.canOpenURL(APP_STORE_URL);
      if (supported) {
        await Linking.openURL(APP_STORE_URL);
      }
    } catch (error) {
      console.error('[RateAppOverlay] Failed to open App Store:', error);
    }
    onRate();
  };

  const handleLater = () => {
    void Haptics.selectionAsync();
    // Unmount immediately so dismissing the prompt cannot leave a transparent
    // native Modal above the gallery while the exit animation finishes.
    setIsMounted(false);
    onDismiss();
  };

  const handleRequestClose = () => {
    setIsMounted(false);
    onDismiss();
  };

  if (!isMounted) {
    return null;
  }

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleRequestClose} supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}>
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Animated.View style={[styles.content, { transform: [{ scale }] }]}>
          <Text style={styles.emoji}>⭐</Text>
          <Text style={styles.title}>Enjoying Emoji Painter?</Text>
          <Text style={styles.message}>
            We need and want feedback! Would you like to rate the app on the App Store?
          </Text>

          <View style={styles.buttonGroup}>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleRate}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>Rate on App Store</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={handleLater}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>Maybe Later</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  content: {
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    maxWidth: 380,
    width: '100%',
    borderWidth: 2,
    borderColor: '#2a2a2a'
  },
  emoji: {
    fontSize: 64,
    marginBottom: 16
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 12,
    textAlign: 'center',
    fontFamily: 'vrtlfinal'
  },
  message: {
    fontSize: 16,
    color: '#b0b0b0',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
    fontFamily: 'vrtlfinal'
  },
  buttonGroup: {
    width: '100%',
    gap: 12
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center'
  },
  primaryButton: {
    backgroundColor: '#5865F2',
    shadowColor: '#5865F2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '600',
    fontFamily: 'vrtlfinal'
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3a3a3a'
  },
  secondaryButtonText: {
    color: '#888888',
    fontSize: 15,
    fontWeight: '500',
    fontFamily: 'vrtlfinal'
  }
});

export default RateAppOverlay;
