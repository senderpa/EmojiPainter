import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTutorialState } from './TutorialContext';

interface CaptionBarProps {
  visible: boolean;
}

const CaptionBar: React.FC<CaptionBarProps> = ({ visible }) => {
  const insets = useSafeAreaInsets();
  const { tutorialAction } = useTutorialState();
  const [displayText, setDisplayText] = useState('');
  const barOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const prevAction = useRef('');

  // Show/hide the whole bar
  useEffect(() => {
    Animated.timing(barOpacity, {
      toValue: visible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  // Crossfade in new action text
  useEffect(() => {
    if (!tutorialAction || tutorialAction === prevAction.current) return;
    prevAction.current = tutorialAction;

    Animated.timing(textOpacity, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setDisplayText(tutorialAction);
      Animated.timing(textOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  }, [tutorialAction]);

  // Fade out when action clears
  useEffect(() => {
    if (tutorialAction === '' && displayText !== '') {
      Animated.timing(textOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => {
        setDisplayText('');
      });
    }
  }, [tutorialAction]);

  if (!visible || !displayText) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, { top: insets.top + 100, opacity: barOpacity }]}
    >
      <View style={styles.panel}>
        <Animated.Text style={[styles.text, { opacity: textOpacity }]} numberOfLines={2}>
          {displayText}
        </Animated.Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9500,
    paddingHorizontal: 40,
  },
  panel: {
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.35)',
    minWidth: 180,
    maxWidth: 480,
  },
  text: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'vrtlfinal',
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default CaptionBar;
