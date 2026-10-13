/** A labeled stat chip (icon + value + label) for the profile stat grid. */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';

interface Props {
  icon: string;
  value: string;
  label: string;
  accent?: string;
  /** If provided, counts up from 0 → rawValue on mount */
  rawValue?: number;
  /** Larger display variant for featured stats */
  large?: boolean;
  /** Dense one-row profile variant */
  compact?: boolean;
  /** Optional press handler; visual styling stays identical. */
  onPress?: () => void;
}

const StatTile: React.FC<Props> = ({ icon, value, label, accent = '#ffdc82', rawValue, large, compact, onPress }) => {
  const [displayed, setDisplayed] = useState(rawValue != null ? '0' : value);
  const animRef = useRef<Animated.Value | null>(null);

  useEffect(() => {
    if (rawValue == null) { setDisplayed(value); return; }
    if (animRef.current) animRef.current.stopAnimation();
    const anim = new Animated.Value(0);
    animRef.current = anim;
    const id = anim.addListener(({ value: v }) => setDisplayed(Math.round(v).toLocaleString()));
    Animated.timing(anim, {
      toValue: rawValue,
      duration: 1400,
      delay: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      setDisplayed(value);
      anim.removeListener(id);
    });
    return () => { anim.stopAnimation(); anim.removeListener(id); };
  }, [rawValue, value]);

  const content = (
    <>
      <Text style={[styles.icon, large && styles.iconLarge, compact && styles.iconCompact]}>{icon}</Text>
      <Text style={[styles.value, { color: accent }, large && styles.valueLarge, compact && styles.valueCompact]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62}>
        {displayed}
      </Text>
      <Text style={[styles.label, large && styles.labelLarge, compact && styles.labelCompact]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Text>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.tile, large && styles.tileLarge, compact && styles.tileCompact]}
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.tile, large && styles.tileLarge, compact && styles.tileCompact]}>
      {content}
    </View>
  );
};

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 84,
    backgroundColor: '#161616',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a',
  },
  tileLarge: {
    paddingVertical: 18,
    borderRadius: 18,
    borderColor: '#333',
  },
  tileCompact: {
    minWidth: 0,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 3,
    gap: 1,
  },
  icon: { fontSize: 22 },
  iconLarge: { fontSize: 28 },
  iconCompact: { fontSize: 14 },
  value: { fontSize: 18, fontWeight: '800' },
  valueLarge: { fontSize: 26, fontWeight: '900' },
  valueCompact: { fontSize: 12, fontWeight: '900' },
  label: { color: '#8e8e92', fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  labelLarge: { fontSize: 13 },
  labelCompact: { fontSize: 8, letterSpacing: 0 },
});

export default StatTile;
