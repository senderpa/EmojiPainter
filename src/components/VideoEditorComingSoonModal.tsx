import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';

interface VideoEditorComingSoonModalProps {
  visible: boolean;
  isIpad: boolean;
  onClose: () => void;
}

export default function VideoEditorComingSoonModal({
  visible,
  isIpad,
  onClose,
}: VideoEditorComingSoonModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      supportedOrientations={isIpad ? ['portrait', 'landscape'] : ['portrait']}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
        }}
      >
        <View
          style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 16,
            padding: 40,
            width: '100%',
            maxWidth: 400,
            borderWidth: 2,
            borderColor: '#4CAF50',
          }}
        >
          <TouchableOpacity
            onPress={onClose}
            style={{ position: 'absolute', top: 16, right: 16, padding: 8, zIndex: 10 }}
          >
            <Text style={{ fontSize: 24 }}>❎</Text>
          </TouchableOpacity>

          <Text style={{ fontSize: 64, textAlign: 'center', marginBottom: 20 }}>🎬</Text>

          <Text
            style={{
              color: '#4CAF50',
              fontSize: 28,
              fontWeight: '700',
              fontFamily: 'vrtlfinal',
              textAlign: 'center',
              marginBottom: 12,
            }}
          >
            Coming Soon
          </Text>

          <Text
            style={{
              color: '#fff',
              fontSize: 16,
              fontFamily: 'vrtlfinal',
              textAlign: 'center',
              marginBottom: 20,
              lineHeight: 24,
            }}
          >
            Video Editor feature will be available in a future update!
          </Text>

          <TouchableOpacity
            style={{
              backgroundColor: '#4CAF50',
              borderRadius: 12,
              padding: 16,
              alignItems: 'center',
            }}
            onPress={onClose}
          >
            <Text
              style={{ color: '#fff', fontSize: 16, fontWeight: '600', fontFamily: 'vrtlfinal' }}
            >
              OK
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
