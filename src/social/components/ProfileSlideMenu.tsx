/**
 * ProfileSlideMenu — an animated slide-in/out navigation drawer for the profile
 * page. A backdrop fades in while a panel slides in from the right edge with ALL
 * the app's main destinations (World, Gallery, Leaderboard, Passport, Edit,
 * Back to painting). Tapping the backdrop or any item slides it back out.
 *
 * Pure react-native `Animated` (no reanimated) to match the rest of the app, and
 * the animation cleans up on unmount. On-brand dark theme with #ff9f6b accent,
 * responsive to phone / iPad and all orientations via useWindowDimensions.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';

export interface SlideMenuItem {
  key: string;
  icon: string;
  label: string;
  /** Optional second line, e.g. a short description. */
  hint?: string;
  /** Accent colour for the icon chip; defaults to the brand accent. */
  accent?: string;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  items: SlideMenuItem[];
  onClose: () => void;
  /** Optional title shown at the top of the panel. */
  title?: string;
}

const ACCENT = '#ff9f6b';
const ANIM_MS = 260;

const ProfileSlideMenu: React.FC<Props> = ({ visible, items, onClose, title = 'Menu' }) => {
  const { width } = useWindowDimensions();
  // Panel takes ~82% of a narrow screen, capped so it looks like a drawer on iPad.
  const panelWidth = Math.min(360, Math.max(260, Math.round(width * 0.82)));

  // 0 = fully closed (off-screen), 1 = fully open. Drives both translate + fade.
  const progress = useRef(new Animated.Value(0)).current;
  // Keep the panel mounted while it animates out, then unmount once closed.
  const [mounted, setMounted] = React.useState(visible);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      progress.stopAnimation();
    };
  }, [progress]);

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: ANIM_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Only unmount once the close animation actually completed, and guard
      // against setState after unmount.
      if (finished && !visible && mountedRef.current) setMounted(false);
    });
  }, [visible, progress]);

  const handleItemPress = useCallback((item: SlideMenuItem) => {
    onClose();
    // Defer the navigation/action a tick so the slide-out can begin smoothly.
    requestAnimationFrame(() => item.onPress());
  }, [onClose]);

  if (!mounted) return null;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [panelWidth + 24, 0],
  });
  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.55],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>

      <Animated.View
        style={[styles.panel, { width: panelWidth, transform: [{ translateX }] }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>{title}</Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Close menu"
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.itemsContent}
          showsVerticalScrollIndicator={false}
        >
          {items.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.item}
              activeOpacity={0.8}
              onPress={() => handleItemPress(item)}
            >
              <View style={[styles.iconChip, { borderColor: item.accent ?? ACCENT }]}>
                <Text style={styles.iconText}>{item.icon}</Text>
              </View>
              <View style={styles.itemLabels}>
                <Text style={styles.itemLabel} numberOfLines={1}>{item.label}</Text>
                {item.hint ? (
                  <Text style={styles.itemHint} numberOfLines={1}>{item.hint}</Text>
                ) : null}
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: '#141414',
    borderTopLeftRadius: 22,
    borderBottomLeftRadius: 22,
    paddingTop: 54,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: -6, height: 0 },
    elevation: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#262626',
  },
  panelTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#1f1f1f', alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#3a3a3a',
  },
  closeBtnText: { color: '#bbb', fontSize: 15, fontWeight: '700' },
  itemsContent: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2c',
  },
  iconChip: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#0f0f0f', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  iconText: { fontSize: 19 },
  itemLabels: { flex: 1 },
  itemLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  itemHint: { color: '#8e8e92', fontSize: 12, marginTop: 2 },
  chevron: { color: '#555', fontSize: 22, fontWeight: '300' },
});

export default React.memo(ProfileSlideMenu);
