import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';

interface TimeLimitWarningModalProps {
  visible: boolean;
  onOpenParentalControls: () => void;
}

export default function TimeLimitWarningModal({
  visible,
  onOpenParentalControls,
}: TimeLimitWarningModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={() => {}}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.92)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 30,
        }}
      >
        <Text style={{ fontSize: 64, marginBottom: 16 }}>⏰</Text>
        <Text
          style={{
            color: '#fff',
            fontSize: 26,
            fontWeight: '800',
            fontFamily: 'vrtlfinal',
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          Time's Up!
        </Text>
        <Text
          style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: 16,
            textAlign: 'center',
            lineHeight: 24,
            marginBottom: 32,
          }}
        >
          Daily painting time limit reached.{'\n'}Ask a parent to unlock more time.
        </Text>
        <TouchableOpacity
          style={{
            backgroundColor: '#0ff',
            borderRadius: 16,
            paddingVertical: 16,
            paddingHorizontal: 32,
          }}
          onPress={onOpenParentalControls}
        >
          <Text
            style={{
              color: '#000',
              fontSize: 16,
              fontWeight: '800',
              fontFamily: 'vrtlfinal',
            }}
          >
            Shield Parent Unlock
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
