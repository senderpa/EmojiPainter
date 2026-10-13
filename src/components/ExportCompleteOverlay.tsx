import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Animated as RNAnimated, Easing, TouchableOpacity, Platform, Image } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { ResizeMode } from 'expo-av';
import { addAppEventListener, emitAppEvent } from '../lib/appEvents';
import { triggerRatingCheck } from '../lib/ratingEvents';
import { CustomOverlayHelper } from './CustomOverlay';
import ShortVideoPlayer from '../video/ShortVideoPlayer';

type ExportCompletePayload = {
  uri: string;
  filename: string;
  mediaType?: 'image' | 'video';
};

const ExportCompleteOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [exportData, setExportData] = useState<ExportCompletePayload | null>(null);
  const opacity = React.useRef(new RNAnimated.Value(0)).current;
  const scale = React.useRef(new RNAnimated.Value(0.8)).current;
  const [isSharing, setIsSharing] = useState(false);

  const hideOverlay = useCallback(() => {
    RNAnimated.parallel([
      RNAnimated.timing(opacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true
      }),
      RNAnimated.timing(scale, {
        toValue: 0.8,
        duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true
      })
    ]).start(() => {
      setVisible(false);
      setExportData(null);
      // Wait until the export overlay has fully disappeared before opening a
      // rating prompt, otherwise the prompt can cover the export actions.
      triggerRatingCheck({ delayMs: 500 });
    });
  }, [opacity, scale]);

  const showOverlay = useCallback((payload: ExportCompletePayload) => {
    setExportData(payload);
    setVisible(true);
    opacity.setValue(0);
    scale.setValue(0.8);

    RNAnimated.parallel([
      RNAnimated.timing(opacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      RNAnimated.spring(scale, {
        toValue: 1,
        damping: 12,
        stiffness: 150,
        mass: 0.8,
        useNativeDriver: true
      })
    ]).start();
  }, [opacity, scale]);

  const handleShare = useCallback(async () => {
    if (!exportData || isSharing) return;

    try {
      setIsSharing(true);
      const shareUri = exportData.uri.startsWith('file://') ? exportData.uri : `file://${exportData.uri}`;
      const isImage = exportData.mediaType === 'image' || /\.(png|jpe?g|webp)$/i.test(exportData.uri);
      const mimeType = isImage
        ? (/\.(jpe?g)$/i.test(exportData.uri) ? 'image/jpeg' : /\.(webp)$/i.test(exportData.uri) ? 'image/webp' : 'image/png')
        : 'video/quicktime';
      const uti = isImage ? 'public.image' : 'public.movie';

      if (Platform.OS === 'ios') {
        const Sharing = require('expo-sharing');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(shareUri, {
            mimeType,
            dialogTitle: exportData.filename,
            UTI: uti
          });
          // shareAsync resolves whether user completed or cancelled the share sheet —
          // keep the overlay open so the user can share again or dismiss manually
        } else {
          CustomOverlayHelper.alert('Error', 'Sharing is not available on this device');
        }
      } else {
        const { Share } = require('react-native');
        await Share.share({
          message: `Share ${exportData.filename}`,
          title: exportData.filename,
          url: shareUri
        });
      }
    } catch (error) {
      // Ignore user-cancellation errors (ERR_SHARING_CANCELLED or similar)
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('cancel') && !message.includes('Cancel') && !message.includes('dismiss')) {
        CustomOverlayHelper.alert('Share Failed', `Could not share video: ${message}`);
      }
    } finally {
      setIsSharing(false);
    }
  }, [exportData, isSharing]);

  useEffect(() => {
    const unsubscribe = addAppEventListener('export:complete', showOverlay);
    return unsubscribe;
  }, [showOverlay]);

  if (!visible || !exportData) {
    return null;
  }

  return (
    <RNAnimated.View pointerEvents="box-none" style={[styles.overlay, { opacity }]}>
      <RNAnimated.View pointerEvents="box-none" style={[styles.backdrop, { opacity }]} />
      <RNAnimated.View style={[styles.card, { transform: [{ scale }] }]}>
        <Text style={styles.title}>Export Complete!</Text>

        {/* Preview */}
        <View style={styles.videoContainer}>
          {exportData.mediaType === 'image' || /\.(png|jpe?g|webp)$/i.test(exportData.uri) ? (
            <Image source={{ uri: exportData.uri }} style={styles.video} resizeMode="contain" />
          ) : (
            <ShortVideoPlayer
              uri={exportData.uri}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isMuted={false}
            />
          )}
        </View>

        <Text style={styles.filename}>{exportData.filename}</Text>
        <Text style={styles.subtitle}>Saved to storage — share to Instagram, WhatsApp and more</Text>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.shareButton, isSharing && styles.shareButtonDisabled]}
            onPress={handleShare}
            disabled={isSharing}
          >
            <Text style={styles.shareButtonText}>
              {isSharing ? 'Sharing...' : '📤 Share'}
            </Text>
          </TouchableOpacity>

          {/* Videos can be placed onto a real wall in the AR scene (transparent
              MOV shows see-through). */}
          {exportData.mediaType === 'video' || /\.(mp4|mov)$/i.test(exportData.uri) ? (
            <TouchableOpacity
              style={styles.arButton}
              onPress={() => {
                emitAppEvent('ar:placeVideo', { uri: exportData.uri });
                hideOverlay();
              }}
            >
              <Text style={styles.shareButtonText}>🧱 Open in AR (place on wall)</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.closeButton}
            onPress={hideOverlay}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </RNAnimated.View>
    </RNAnimated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3000,
    elevation: 3000
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)'
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 32,
    marginHorizontal: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333'
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16
  },
  videoContainer: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: 16
  },
  video: {
    width: '100%',
    height: '100%'
  },
  filename: {
    color: '#ff9f6b',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center'
  },
  subtitle: {
    color: '#999',
    fontSize: 14,
    marginBottom: 24
  },
  buttons: {
    width: '100%',
    gap: 12
  },
  shareButton: {
    backgroundColor: '#ff9f6b',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center'
  },
  shareButtonDisabled: {
    backgroundColor: '#666'
  },
  arButton: {
    backgroundColor: '#5a8aca',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center'
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  },
  closeButton: {
    backgroundColor: '#333',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center'
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600'
  }
});

export default ExportCompleteOverlay;
