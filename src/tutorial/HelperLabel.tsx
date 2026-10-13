import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, type ViewStyle } from 'react-native';
import { AppText as Text } from '../emoji/AppText';

interface HelperLabelProps {
  text: string;
  visible: boolean;
  position?: 'below' | 'above' | 'right' | 'left';
}

const HelperLabel: React.FC<HelperLabelProps> = ({ text, visible, position = 'below' }) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible && text ? 1 : 0,
      duration: visible ? 200 : 140,
      useNativeDriver: true,
    }).start();
  }, [visible, text]);

  if (!text || !visible) return null;

  const containerStyle = CONTAINER_STYLES[position];

  const lineEl = <View style={styles.connectLine} />;
  const panelEl = (
    <View style={styles.panel}>
      <Text style={styles.text} numberOfLines={2}>{text}</Text>
    </View>
  );

  // For below/above, stack line and panel vertically
  const isVertical = position === 'below' || position === 'above';

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, containerStyle, { opacity }]}
    >
      {isVertical ? (
        position === 'below' ? (
          <>{lineEl}{panelEl}</>
        ) : (
          <>{panelEl}{lineEl}</>
        )
      ) : (
        <View style={styles.rowWrap}>
          {position === 'right' && <View style={styles.connectLineH} />}
          {panelEl}
          {position === 'left' && <View style={styles.connectLineH} />}
        </View>
      )}
    </Animated.View>
  );
};

// Electric glow ring shown around a button when its helper is active
export const HelperRing: React.FC<{ visible: boolean }> = ({ visible }) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 200 : 150,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          opacity,
          borderRadius: 10,
          borderWidth: 1.5,
          borderColor: 'rgba(255, 149, 0, 0.95)',
          shadowColor: '#FF9500',
          shadowOpacity: 0.85,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
        },
      ]}
    />
  );
};

const CONTAINER_STYLES: Record<string, ViewStyle> = {
  below: {
    top: '105%',
    left: '50%',
    transform: [{ translateX: -62 }],
    alignItems: 'center',
  },
  above: {
    bottom: '105%',
    left: '50%',
    transform: [{ translateX: -62 }],
    alignItems: 'center',
  },
  right: {
    left: '108%',
    top: '50%',
    transform: [{ translateY: -16 }],
  },
  left: {
    right: '108%',
    top: '50%',
    transform: [{ translateY: -16 }],
  },
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 9200,
    width: 124,
  },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectLine: {
    width: 1.5,
    height: 6,
    backgroundColor: 'rgba(255, 149, 0, 0.75)',
    alignSelf: 'center',
  },
  connectLineH: {
    height: 1.5,
    width: 6,
    backgroundColor: 'rgba(255, 149, 0, 0.75)',
    alignSelf: 'center',
  },
  panel: {
    backgroundColor: 'rgba(0, 0, 0, 0.90)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.65)',
    shadowColor: '#FF9500',
    shadowOpacity: 0.55,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
    minWidth: 70,
    maxWidth: 124,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'vrtlfinal',
    textAlign: 'center',
    lineHeight: 15,
  },
});

export default HelperLabel;
