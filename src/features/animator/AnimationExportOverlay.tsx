/**
 * AnimationExportOverlay — a fresh, minimal progress overlay for the Animator
 * MP4/GIF/PNG export.
 *
 * Purpose-built to replace AnimatedLoader for exports: the bar width is set
 * DIRECTLY from the frame count (plain View, no Animated.timing), so it can't
 * lag behind the fast native encoder or stutter from the shared loader's 300ms
 * animation + logo playback. Driven by `current`/`total` which are flushed to
 * state by the 50ms progress sampler in PaintScreen.
 */
import React from 'react';
import { View, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

type Props = {
  format: 'mov' | 'gif' | 'png' | string;
  current: number;
  total: number;
};

const labelFor = (format: string): string => {
  if (format === 'mov') return 'MP4 video';
  if (format === 'gif') return 'GIF';
  if (format === 'png') return 'PNG frames';
  return format.toUpperCase();
};

const AnimationExportOverlay: React.FC<Props> = ({ format, current, total }) => {
  const safeTotal = total > 0 ? total : 0;
  const safeCurrent = Math.max(0, Math.min(current, safeTotal));
  const pct = safeTotal > 0 ? Math.min(100, Math.round((safeCurrent / safeTotal) * 100)) : 0;
  const started = safeTotal > 0 && safeCurrent > 0;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <View style={styles.card}>
        <ActivityIndicator size="large" color="#ff9f6b" style={{ marginBottom: 18 }} />

        <Text style={styles.title}>Exporting {labelFor(format)}</Text>

        <Text style={styles.frames}>
          {started ? `Frame ${safeCurrent} / ${safeTotal}` : 'Preparing frames…'}
        </Text>

        {/* Direct-width bar — updates instantly with each frame (no animation lag). */}
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct}%` }]} />
        </View>

        <Text style={styles.pct}>{pct}%</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  card: {
    width: IS_IPAD ? 420 : '82%',
    maxWidth: 460,
    backgroundColor: '#161616',
    borderRadius: 22,
    paddingVertical: 30,
    paddingHorizontal: 26,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2c2c2c',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  frames: {
    color: '#ff9f6b',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 18,
    textAlign: 'center',
  },
  barTrack: {
    width: '100%',
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#ff9f6b',
  },
  pct: {
    color: '#cfcfcf',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
  },
});

export default AnimationExportOverlay;
