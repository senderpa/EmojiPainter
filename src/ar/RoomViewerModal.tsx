import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AppText as Text } from '../emoji/AppText';
import { RoomPreviewNativeView } from '../../modules/emoji-ar';

export type RoomViewerData = {
  roomPlanSurfaces?: Array<{
    id?: string;
    category?: string;
    dimensions?: number[];
    transform?: number[];
  }>;
  retainedARPlaneSurfaces?: unknown[];
  strokes?: Array<{
    opacity?: number;
    stamps?: Array<{ p?: number[]; q?: number[]; e?: string; s?: number }>;
  }>;
  readiness?: Record<string, unknown>;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  roomDir?: string | null;
  data?: RoomViewerData | null;
  title?: string;
  onOpenAR?: () => void;
};

export default function RoomViewerModal({ visible, onClose, roomDir, data, title = 'Saved Room', onOpenAR }: Props) {
  const [loaded, setLoaded] = useState<RoomViewerData | null>(data ?? null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!visible) return;
    if (data) { setLoaded(data); return; }
    if (!roomDir) { setLoaded(null); return; }
    let cancelled = false;
    setLoading(true);
    const base = roomDir.endsWith('/') ? roomDir : `${roomDir}/`;
    Promise.all([
      FileSystem.readAsStringAsync(`${base}hybrid-room.json`),
      FileSystem.readAsStringAsync(`${base}strokes.json`),
    ]).then(([hybridRaw, strokesRaw]) => {
      if (cancelled) return;
      const hybrid = JSON.parse(hybridRaw) as RoomViewerData;
      const strokes = JSON.parse(strokesRaw) as { strokes?: RoomViewerData['strokes'] };
      setLoaded({ ...hybrid, strokes: strokes.strokes ?? [] });
    }).catch((error) => {
      if (!cancelled) { setLoaded(null); Alert.alert('Room viewer', 'This saved room has no readable 3D package yet.'); }
      console.warn('[RoomViewer] load failed', error);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [data, roomDir, visible]);

  const roomDataJSON = useMemo(() => loaded ? JSON.stringify(loaded) : null, [loaded]);
  const surfaceCount = loaded?.roomPlanSurfaces?.length ?? 0;
  const strokeCount = useMemo(
    () => (loaded?.strokes ?? []).reduce((sum, s) => sum + (s.stamps?.length ?? 0), 0),
    [loaded]
  );
  const exportRoom = async () => {
    if (!loaded) return;
    try {
      const path = `${FileSystem.cacheDirectory ?? ''}emojipainter-room-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(loaded, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'application/json' });
    } catch (error) { Alert.alert('Export failed', 'Could not export this room package.'); }
  };
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={styles.root}>
      <View style={styles.header}><Text style={[styles.title, styles.headerTitle]}>{title}</Text><TouchableOpacity onPress={onClose} style={styles.headerButton} accessibilityLabel="Close room viewer"><Text style={styles.headerText}>✕</Text></TouchableOpacity></View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#63d9ff"/><Text style={styles.status}>Loading room…</Text></View>
      ) : roomDataJSON && RoomPreviewNativeView ? (
        <View style={styles.web}>
          <RoomPreviewNativeView roomDataJSON={roomDataJSON} style={StyleSheet.absoluteFill} />
          <View style={styles.badge} pointerEvents="none"><Text style={styles.badgeText}>ROOM · 3D INSPECTOR</Text></View>
          <View style={styles.hint} pointerEvents="none"><Text style={styles.hintText}>Drag to orbit · pinch to zoom</Text></View>
          <View style={styles.stats} pointerEvents="none"><Text style={styles.statsText}>{surfaceCount} surfaces · {strokeCount} strokes</Text></View>
        </View>
      ) : roomDataJSON ? (
        <View style={styles.center}><Text style={styles.status}>3D preview isn't available on this device.</Text></View>
      ) : (
        <View style={styles.center}><Text style={styles.status}>No room package available yet.</Text></View>
      )}
      <View style={styles.footer}><TouchableOpacity style={[styles.footerButton, styles.shareButton]} onPress={exportRoom}><Text style={styles.footerText}>↗ Share</Text></TouchableOpacity>{onOpenAR && <TouchableOpacity style={[styles.footerButton, styles.arButton]} onPress={onOpenAR}><Text style={styles.footerText}>↗ Open in AR</Text></TouchableOpacity>}</View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#090d13' },
  header: { height: 58, paddingHorizontal: 14, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111b27', borderBottomWidth: 1, borderBottomColor: '#294257' },
  title: { color: '#dff7ff', fontSize: 17, fontWeight: '700' },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerButton: { width: 42, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1d3142' },
  headerText: { color: '#b9efff', fontSize: 21, fontWeight: '700' },
  web: { flex: 1, backgroundColor: '#090d13' },
  badge: { position: 'absolute', top: 14, left: 14, backgroundColor: '#16283a', borderWidth: 1, borderColor: '#397e9b', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 },
  badgeText: { color: '#b9f1ff', fontSize: 11, fontWeight: '700' },
  hint: { position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' },
  hintText: { color: '#aab8c9', fontSize: 12 },
  stats: { position: 'absolute', left: 14, bottom: 38 },
  statsText: { color: '#8fa1b5', fontSize: 11 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  status: { color: '#b9c7d6', fontSize: 15 },
  footer: { padding: 12, paddingBottom: 24, flexDirection: 'row', gap: 10, backgroundColor: '#111b27' },
  footerButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#26384a' },
  shareButton: { backgroundColor: '#2b5872' },
  arButton: { backgroundColor: '#168b6c' },
  footerText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
