import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface FrameUploadModalProps {
  visible: boolean;
  onPickCamera: () => void;
  onPickLibrary: () => void;
  onCancel: () => void;
}

export default function FrameUploadModal({
  visible,
  onPickCamera,
  onPickLibrary,
  onCancel,
}: FrameUploadModalProps) {
  if (!visible) {
    return null;
  }

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.8)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 99999,
      }}
    >
      <View
        style={{
          backgroundColor: '#1a1a1a',
          borderRadius: 16,
          padding: 30,
          width: '80%',
          maxWidth: 400,
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: 'bold',
            color: '#fff',
            fontFamily: 'vrtlfinal',
            textAlign: 'center',
            marginBottom: 20,
          }}
        >
          Choose Frames to Upload
        </Text>

        <TouchableOpacity
          style={{
            backgroundColor: '#4CAF50',
            borderRadius: 12,
            padding: 16,
            marginBottom: 12,
            alignItems: 'center',
          }}
          onPress={onPickCamera}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: '600',
              color: '#fff',
              fontFamily: 'vrtlfinal',
              textAlign: 'center',
            }}
          >
            {'🖼️ CURRENT FRAME'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: '#2196F3',
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
            alignItems: 'center',
          }}
          onPress={onPickLibrary}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: '600',
              color: '#fff',
              fontFamily: 'vrtlfinal',
              textAlign: 'center',
            }}
          >
            {'🎞️ ALL FRAMES'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 12,
            padding: 12,
            alignItems: 'center',
          }}
          onPress={onCancel}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              color: '#888',
              fontFamily: 'vrtlfinal',
              textAlign: 'center',
              letterSpacing: 1,
            }}
          >
            CANCEL
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
