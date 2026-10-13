import React from 'react';
import { Image, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';

interface FullscreenImageInfo {
  topic: string;
  author: string;
  date: string;
  time: string;
}

interface FullscreenImageViewerProps {
  imageUri: string | null;
  imageInfo: FullscreenImageInfo | null;
  windowSize: { width: number; height: number };
  isIpad: boolean;
  isIpadLandscape: boolean;
  insets: { top: number; bottom: number; left: number; right: number };
  onClose: () => void;
}

export default function FullscreenImageViewer({
  imageUri,
  imageInfo,
  windowSize,
  isIpad,
  isIpadLandscape,
  onClose,
}: FullscreenImageViewerProps): React.ReactElement | null {
  return (
    <Modal
      visible={imageUri !== null}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      supportedOrientations={isIpad ? ['portrait', 'landscape'] : ['portrait']}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }}>
        <TouchableOpacity
          style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 10 }}
          onPress={onClose}
        >
          <Text style={{ color: '#fff', fontSize: 36, fontWeight: '300', fontFamily: 'vrtlfinal' }}>×</Text>
        </TouchableOpacity>

        {imageInfo && (
          <View style={{ position: 'absolute', top: 50, left: 20, right: 80, zIndex: 10 }}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 4, fontFamily: 'vrtlfinal' }}>
              {imageInfo.topic}
            </Text>
            <Text style={{ color: '#ccc', fontSize: 14, fontFamily: 'vrtlfinal' }}>
              {imageInfo.author} • {imageInfo.date} • {imageInfo.time}
            </Text>
          </View>
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingTop: isIpadLandscape ? 60 : 120, paddingBottom: 40 }}
          minimumZoomScale={1}
          maximumZoomScale={5}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          bounces={true}
          bouncesZoom={true}
          centerContent={true}
        >
          {imageUri && (
            <Image
              source={{ uri: imageUri }}
              style={{ width: Math.min(windowSize.width, windowSize.height - 160), height: Math.min(windowSize.width, windowSize.height - 160) }}
              resizeMode="contain"
            />
          )}
        </ScrollView>

        <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' }}>
          <Text style={{ color: '#888', fontSize: 14, fontFamily: 'vrtlfinal' }}>
            Pinch to zoom • Scroll to pan
          </Text>
        </View>
      </View>
    </Modal>
  );
}
