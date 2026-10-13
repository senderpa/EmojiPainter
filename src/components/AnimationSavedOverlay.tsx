import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Animated as RNAnimated, Easing, TouchableOpacity } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { addAppEventListener } from '../lib/appEvents';

interface AnimationSavedData {
  projectId: string;
  frameCount: number;
  isNewProject: boolean;
}

const AnimationSavedOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<AnimationSavedData | null>(null);
  const opacity = React.useRef(new RNAnimated.Value(0)).current;
  const translateY = React.useRef(new RNAnimated.Value(100)).current;

  const hideOverlay = useCallback(() => {
    RNAnimated.parallel([
      RNAnimated.timing(opacity, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true
      }),
      RNAnimated.timing(translateY, {
        toValue: 100,
        duration: 300,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true
      })
    ]).start(() => {
      setVisible(false);
      setData(null);
    });
  }, [opacity, translateY]);

  const showOverlay = useCallback((payload: AnimationSavedData) => {
    setData(payload);
    setVisible(true);
    opacity.setValue(0);
    translateY.setValue(100);

    RNAnimated.parallel([
      RNAnimated.timing(opacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      RNAnimated.timing(translateY, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      })
    ]).start();

    // Auto-hide after 3 seconds
    const timer = setTimeout(() => {
      hideOverlay();
    }, 3000);

    return () => clearTimeout(timer);
  }, [opacity, translateY, hideOverlay]);

  useEffect(() => {
    const unsubscribe = addAppEventListener('animation:saved', showOverlay);
    return unsubscribe;
  }, [showOverlay]);

  if (!visible || !data) {
    return null;
  }

  return (
    <RNAnimated.View pointerEvents="box-none" style={[styles.container, { opacity }]}>
      <RNAnimated.View
        style={[
          styles.overlay,
          {
            transform: [{ translateY }]
          }
        ]}
      >
        <View style={styles.content}>
          <Text style={styles.title}>✅ Animation Saved!</Text>
          <Text style={styles.subtitle}>
            {data.isNewProject ? '🆕 New project' : '♻️ Project updated'} • {data.frameCount} frames
          </Text>
          <Text style={styles.projectId}>ID: {data.projectId.substring(0, 30)}...</Text>
        </View>

        <TouchableOpacity
          style={styles.closeButton}
          onPress={hideOverlay}
        >
          <Text style={styles.closeButtonText}>×</Text>
        </TouchableOpacity>
      </RNAnimated.View>
    </RNAnimated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 4000,
    elevation: 4000,
    pointerEvents: 'box-none'
  },
  overlay: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8
  },
  content: {
    flex: 1,
    marginRight: 12
  },
  title: {
    color: '#4ade80',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4
  },
  subtitle: {
    color: '#999',
    fontSize: 13,
    marginBottom: 2
  },
  projectId: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'Courier New'
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    lineHeight: 24
  }
});

export default AnimationSavedOverlay;
