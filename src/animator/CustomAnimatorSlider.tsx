/**
 * Pure-JS custom slider — no native UISlider, so it cannot fire iOS-level
 * touchesCancelled events that would kill a concurrent canvas PanResponder.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';

const THUMB_R = 10; // thumb radius in pts

interface Props {
  value: number;
  minimumValue: number;
  maximumValue: number;
  step?: number;
  onValueChange?: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
  minimumTrackTintColor?: string;
  thumbTintColor?: string;
  label?: string;
  valueFormatter?: (v: number) => string;
  style?: object;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

const CustomAnimatorSlider: React.FC<Props> = ({
  value,
  minimumValue,
  maximumValue,
  step = 1,
  onValueChange,
  onSlidingComplete,
  minimumTrackTintColor = '#ff9f6b',
  thumbTintColor = '#ff9f6b',
  label,
  valueFormatter,
  style,
}) => {
  const trackWidthRef = useRef(0);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartValueRef = useRef(value);
  const currentValueRef = useRef(value);
  const [displayValue, setDisplayValue] = useState(value);

  // Sync display when prop changes externally (e.g. after onSlidingComplete parent update)
  useEffect(() => {
    if (!isDraggingRef.current) {
      currentValueRef.current = value;
      setDisplayValue(value);
    }
  }, [value]);

  const valueToX = useCallback(
    (v: number) => {
      const range = maximumValue - minimumValue;
      if (range === 0) return 0;
      return ((v - minimumValue) / range) * trackWidthRef.current;
    },
    [minimumValue, maximumValue]
  );

  const xToValue = useCallback(
    (x: number) => {
      const range = maximumValue - minimumValue;
      const raw = minimumValue + (x / Math.max(1, trackWidthRef.current)) * range;
      const clamped = clamp(raw, minimumValue, maximumValue);
      if (step > 0) {
        return Math.round(clamped / step) * step;
      }
      return clamped;
    },
    [minimumValue, maximumValue, step]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onShouldBlockNativeResponder: () => true,
        // Yield to canvas if canvas refuses to terminate (canvas sets this to false while drawing)
        onPanResponderTerminationRequest: () => true,

        onPanResponderGrant: (evt) => {
          isDraggingRef.current = true;
          const tapX = clamp(evt.nativeEvent.locationX, 0, trackWidthRef.current);
          dragStartXRef.current = tapX;
          dragStartValueRef.current = xToValue(tapX);
          const v = dragStartValueRef.current;
          currentValueRef.current = v;
          setDisplayValue(v);
          onValueChange?.(v);
        },

        onPanResponderMove: (_, gestureState) => {
          const newX = clamp(
            dragStartXRef.current + gestureState.dx,
            0,
            trackWidthRef.current
          );
          const v = xToValue(newX);
          if (v !== currentValueRef.current) {
            currentValueRef.current = v;
            setDisplayValue(v);
            onValueChange?.(v);
          }
        },

        onPanResponderRelease: () => {
          isDraggingRef.current = false;
          onSlidingComplete?.(currentValueRef.current);
        },

        onPanResponderTerminate: () => {
          isDraggingRef.current = false;
          onSlidingComplete?.(currentValueRef.current);
        },
      }),
    [xToValue, onValueChange, onSlidingComplete]
  );

  const thumbX = trackWidthRef.current > 0 ? valueToX(displayValue) : 0;
  const fillWidth = clamp(thumbX, 0, trackWidthRef.current);
  const formattedValue = valueFormatter ? valueFormatter(displayValue) : String(displayValue);

  return (
    <View style={[styles.wrapper, style]}>
      {label != null ? (
        <Text style={styles.label}>
          {label} {formattedValue}
        </Text>
      ) : null}
      <View
        style={styles.trackContainer}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w !== trackWidthRef.current) {
            trackWidthRef.current = w;
            // re-render once to place thumb correctly after layout
            setDisplayValue((prev) => prev);
          }
        }}
        {...panResponder.panHandlers}
      >
        {/* Background track */}
        <View style={[styles.track, { backgroundColor: '#333' }]} />
        {/* Fill track */}
        <View
          style={[
            styles.fill,
            { width: fillWidth, backgroundColor: minimumTrackTintColor },
          ]}
        />
        {/* Thumb */}
        <View
          style={[
            styles.thumb,
            {
              left: fillWidth - THUMB_R,
              backgroundColor: thumbTintColor,
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    gap: 4,
  },
  label: {
    color: '#fff',
    fontSize: 12,
    marginBottom: 2,
    fontFamily: 'vrtlfinal',
  },
  trackContainer: {
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: THUMB_R,
  },
  track: {
    position: 'absolute',
    left: THUMB_R,
    right: THUMB_R,
    height: 4,
    borderRadius: 2,
  },
  fill: {
    position: 'absolute',
    left: THUMB_R,
    height: 4,
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_R * 2,
    height: THUMB_R * 2,
    borderRadius: THUMB_R,
    top: 16 - THUMB_R, // center vertically in the 32pt container
  },
});

export default CustomAnimatorSlider;
