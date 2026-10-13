/**
 * CustomOverlay: App-native Alert replacement using custom styled modals
 * Replaces all Alert.alert calls with in-app UI using vrtlfinal font
 * Supports title, message, and customizable buttons with haptic feedback
 */

import React, { useState, useCallback } from 'react';
import { View, Modal, TouchableOpacity, StyleSheet, Dimensions, Animated as RNAnimated, GestureResponderEvent } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

export interface OverlayButton {
  text: string;
  onPress?: () => void | Promise<void>;
  style?: 'default' | 'destructive' | 'cancel';
}

interface CustomOverlayState {
  visible: boolean;
  title?: string;
  message?: string;
  buttons: OverlayButton[];
  onDismiss?: () => void;
}

// Singleton instance for managing overlay state
let overlayInstance: CustomOverlayHandle | null = null;

export interface CustomOverlayHandle {
  show: (config: {
    title?: string;
    message?: string;
    buttons?: OverlayButton[];
    onDismiss?: () => void;
  }) => void;
  hide: () => void;
}

export const CustomOverlay = React.forwardRef<CustomOverlayHandle>((_, ref) => {
  const [state, setState] = useState<CustomOverlayState>({
    visible: false,
    title: '',
    message: '',
    buttons: [],
  });

  const fadeAnim = React.useRef(new RNAnimated.Value(0)).current;

  const show = useCallback(
    (config: {
      title?: string;
      message?: string;
      buttons?: OverlayButton[];
      onDismiss?: () => void;
    }) => {
      setState({
        visible: true,
        title: config.title,
        message: config.message,
        buttons: config.buttons || [{ text: 'OK', style: 'default' }],
        onDismiss: config.onDismiss,
      });

      // Animate in
      RNAnimated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [fadeAnim]
  );

  const hide = useCallback(() => {
    // Animate out
    RNAnimated.timing(fadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setState(prev => ({ ...prev, visible: false }));
      state.onDismiss?.();
    });
  }, [fadeAnim, state]);

  const handleButtonPress = useCallback(
    async (button: OverlayButton) => {
      void Haptics.selectionAsync();
      hide();
      if (button.onPress) {
        try {
          await button.onPress();
        } catch (error) {
          console.error('[CustomOverlay] Button action error:', error);
        }
      }
    },
    [hide]
  );

  React.useImperativeHandle(ref, () => ({
    show,
    hide,
  }));

  if (!state.visible) return null;

  const backdropOpacity = fadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.5],
  });

  const modalScale = fadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1],
  });

  return (
    <Modal
      transparent
      visible={state.visible}
      animationType="none"
      onRequestClose={hide}
      statusBarTranslucent
    >
      <RNAnimated.View
        style={[
          styles.backdrop,
          {
            opacity: backdropOpacity,
          },
        ]}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={hide}
          activeOpacity={1}
        />
      </RNAnimated.View>

      <View style={styles.container}>
        <RNAnimated.View
          style={[
            styles.alertBox,
            {
              transform: [{ scale: modalScale }],
              opacity: fadeAnim,
            },
          ]}
        >
          {state.title && <Text style={styles.title}>{state.title}</Text>}

          {state.message && <Text style={styles.message}>{state.message}</Text>}

          <View style={styles.buttonContainer}>
            {state.buttons.map((button, index) => (
              <TouchableOpacity
                key={`${button.text}-${index}`}
                style={[
                  styles.button,
                  index < state.buttons.length - 1 && styles.buttonBorder,
                  button.style === 'destructive' && styles.buttonDestructive,
                  button.style === 'cancel' && styles.buttonCancel,
                ]}
                onPress={() => handleButtonPress(button)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.buttonText,
                    button.style === 'destructive' && styles.buttonTextDestructive,
                    button.style === 'cancel' && styles.buttonTextCancel,
                  ]}
                >
                  {button.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </RNAnimated.View>
      </View>
    </Modal>
  );
});

CustomOverlay.displayName = 'CustomOverlay';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  alertBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    overflow: 'hidden',
    minWidth: Math.min(width - 40, 320),
    maxWidth: width - 40,
    borderColor: '#333',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    textAlign: 'center',
    fontFamily: 'vrtlfinal',
  },
  message: {
    fontSize: 14,
    color: '#999',
    paddingHorizontal: 20,
    paddingBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: 'vrtlfinal',
  },
  buttonContainer: {
    borderTopColor: '#333',
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  buttonBorder: {
    borderRightColor: '#333',
    borderRightWidth: 1,
  },
  buttonDestructive: {
    backgroundColor: '#3c2d2d',
  },
  buttonCancel: {
    backgroundColor: '#2d3a3c',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    textAlign: 'center',
    fontFamily: 'vrtlfinal',
  },
  buttonTextDestructive: {
    color: '#ff3b30',
  },
  buttonTextCancel: {
    color: '#999',
  },
});

/**
 * Static helper function to show overlays
 * Usage: CustomOverlayHelper.show({ title: 'Confirm', message: 'Delete?', buttons: [...] })
 */
export const CustomOverlayHelper = {
  setInstance: (instance: CustomOverlayHandle) => {
    overlayInstance = instance;
  },

  show: (config: {
    title?: string;
    message?: string;
    buttons?: OverlayButton[];
    onDismiss?: () => void;
  }) => {
    if (overlayInstance) {
      overlayInstance.show(config);
    } else {
      console.warn('[CustomOverlay] No overlay instance found. Make sure <CustomOverlay /> is mounted.');
    }
  },

  hide: () => {
    if (overlayInstance) {
      overlayInstance.hide();
    }
  },

  /**
   * Show a confirmation dialog (OK/Cancel)
   */
  confirm: (
    title: string,
    message: string,
    onConfirm?: () => void | Promise<void>,
    onCancel?: () => void
  ) => {
    CustomOverlayHelper.show({
      title,
      message,
      buttons: [
        { text: 'Cancel', onPress: onCancel, style: 'cancel' },
        { text: 'OK', onPress: onConfirm, style: 'default' },
      ],
    });
  },

  /**
   * Show a destructive confirmation (Cancel/Delete)
   */
  delete: (
    title: string,
    message: string,
    onDelete?: () => void | Promise<void>,
    onCancel?: () => void
  ) => {
    CustomOverlayHelper.show({
      title,
      message,
      buttons: [
        { text: 'Cancel', onPress: onCancel, style: 'cancel' },
        { text: 'Delete', onPress: onDelete, style: 'destructive' },
      ],
    });
  },

  /**
   * Show an alert message (just OK button)
   */
  alert: (title: string, message: string, onDismiss?: () => void) => {
    CustomOverlayHelper.show({
      title,
      message,
      buttons: [{ text: 'OK', onPress: onDismiss, style: 'default' }],
    });
  },
};

export default CustomOverlay;
