import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

interface ButtonGlowProps {
  counter: number;
  enabled: boolean;
}

const ButtonGlow: React.FC<ButtonGlowProps> = ({ counter, enabled }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!enabled || counter === 0) return;

    opacity.setValue(1);
    scale.setValue(1);

    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1.35, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [counter, enabled]);

  if (!enabled) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          opacity,
          transform: [{ scale }],
          borderRadius: 10,
          borderWidth: 2.5,
          borderColor: '#FF9500',
          shadowColor: '#FF9500',
          shadowOpacity: 0.95,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
        },
      ]}
    />
  );
};

export default ButtonGlow;
