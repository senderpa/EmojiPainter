import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Platform, Dimensions } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { CustomOverlayHelper } from '../components/CustomOverlay';
import { ResizeMode } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import ShortVideoPlayer from './ShortVideoPlayer';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type VideoPreviewScreenProps = NativeStackScreenProps<any, 'VideoPreview'>;

export default function VideoPreviewScreen({ route, navigation }: VideoPreviewScreenProps) {
  const { uri, filename } = route.params as { uri: string; filename: string };
  const insets = useSafeAreaInsets();
  const [isSharing, setIsSharing] = useState(false);

  const handleShare = useCallback(async () => {
    if (isSharing) return;

    try {
      setIsSharing(true);
      const shareUri = uri.startsWith('file://') ? uri : `file://${uri}`;

      if (Platform.OS === 'ios') {
        const Sharing = require('expo-sharing');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(shareUri, {
            mimeType: 'video/mp4',
            dialogTitle: filename,
            UTI: 'public.movie'
          });
        } else {
          CustomOverlayHelper.show({ title: 'Error', message: 'Sharing is not available on this device' });
        }
      } else {
        const { Share } = require('react-native');
        await Share.share({
          message: `Share ${filename}`,
          title: filename,
          url: shareUri
        });
      }
    } catch (error) {
      console.error('[VideoPreview] Share failed:', error);
      CustomOverlayHelper.show({ title: 'Share Failed', message: `Could not share video: ${error}` });
    } finally {
      setIsSharing(false);
    }
  }, [uri, filename, isSharing]);

  return (
    <View style={styles.container}>
      {/* Video Player - Full Screen */}
      <ShortVideoPlayer
        uri={uri}
        style={styles.video}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay
        isMuted={false}
        useNativeControls
      />

      {/* Header with close button */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.filename} numberOfLines={1}>
          {filename}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Bottom controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.shareButton, isSharing && styles.shareButtonDisabled]}
          onPress={handleShare}
          disabled={isSharing}
        >
          <Text style={styles.shareButtonText}>
            {isSharing ? 'Sharing...' : '📤 Share'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000'
  },
  video: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.7)'
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold'
  },
  filename: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 12
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center'
  },
  shareButton: {
    backgroundColor: '#ff9f6b',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 25,
    minWidth: 200,
    alignItems: 'center'
  },
  shareButtonDisabled: {
    backgroundColor: '#666'
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  }
});
