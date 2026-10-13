// @ts-nocheck
/**
 * WorldPage — interactive 3D moon globe.
 * Full bidirectional orbit (X+Y axes). Momentum. Portrait flags with names.
 * Tap flag → 1.5s zoom → seamless ProfilePage entry.
 *
 * Performance: Skia moon canvas is STATIC (only redraws on resize).
 * Only the JS flag-projection layer updates at 60fps.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Canvas, Circle, Path, RadialGradient, Skia, vec } from '@shopify/react-native-skia';
import { useFocusEffect } from '@react-navigation/native';
import { useWorldUsers } from './useWorldUsers';
import { loadProfile } from './socialApi';
import type { WorldUser } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const FLAG_W_MIN    = 60;
const FLAG_W_MAX    = 112;
const FLAG_ASPECT   = 1.28;
const POLE_H_MIN    = 14;
const POLE_H_MAX    = 28;
const PIN_R         = 4.5;
const AUTO_ROT_RAD  = 0.002;
const DRAG_DIV      = 1.4;
const DECAY_DECEL   = 0.994;
const ZOOM_MS       = 1500;
const TOP_PAD_IOS   = 52;
const BG_COLOR      = '#06060c';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fibonacciSphere(n: number): Array<{ lat: number; lon: number }> {
  if (n <= 0) return [];
  if (n === 1) return [{ lat: 0, lon: 0 }];
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (i / (n - 1)) * 2;
    return { lat: Math.asin(Math.max(-1, Math.min(1, y))), lon: golden * i };
  });
}

function project(
  lat: number, lon: number,
  cosY: number, sinY: number,
  cosX: number, sinX: number,
  cx: number, cy: number, R: number,
) {
  const cosLat = Math.cos(lat);
  const x3 = cosLat * Math.cos(lon);
  const y3 = Math.sin(lat);
  const z3 = cosLat * Math.sin(lon);
  const xr  = x3 * cosY + z3 * sinY;
  const zr0 = -x3 * sinY + z3 * cosY;
  const yr2 = y3 * cosX - zr0 * sinX;
  const zr  = y3 * sinX + zr0 * cosX;
  return { sx: cx + R * xr, sy: cy - R * yr2, z: zr };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlagPoint {
  user: WorldUser;
  sx: number; sy: number;
  flagW: number; flagH: number; poleH: number;
  depth: number; visible: boolean;
  tiltY: number; tiltX: number;
}

// ─── Wire Globe Canvas ────────────────────────────────────────────────────────
// Re-renders every frame with globe rotation.
// High-density lat/lon wireframe; front half bright, back half dim → clear 3-D.

const LAT_STEP = 15;  // latitude line every N degrees
const LON_STEP = 10;  // longitude line every N degrees
const SEG      = 6;   // arc resolution in degrees (lower = smoother curves)

interface WireGlobeProps {
  cx: number; cy: number; R: number;
  width: number; height: number;
  rotY: number; rotX: number;
}

const WireGlobe: React.FC<WireGlobeProps> = ({ cx, cy, R, width, height, rotY, rotX }) => {
  const cosY = Math.cos(rotY); const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX); const sinX = Math.sin(rotX);

  const front = Skia.Path.Make();
  const back  = Skia.Path.Make();

  // Latitude circles
  for (let ld = -90 + LAT_STEP; ld < 90; ld += LAT_STEP) {
    const lat = (ld * Math.PI) / 180;
    for (let lo = 0; lo < 360; lo += SEG) {
      const p0 = project(lat, (lo * Math.PI) / 180,           cosY, sinY, cosX, sinX, cx, cy, R);
      const p1 = project(lat, ((lo + SEG) * Math.PI) / 180,   cosY, sinY, cosX, sinX, cx, cy, R);
      const tgt = (p0.z + p1.z) > 0 ? front : back;
      tgt.moveTo(p0.sx, p0.sy);
      tgt.lineTo(p1.sx, p1.sy);
    }
  }

  // Longitude great-circles
  for (let lo = 0; lo < 360; lo += LON_STEP) {
    const lon = (lo * Math.PI) / 180;
    for (let ld = -90; ld < 90; ld += SEG) {
      const p0 = project((ld * Math.PI) / 180,         lon, cosY, sinY, cosX, sinX, cx, cy, R);
      const p1 = project(((ld + SEG) * Math.PI) / 180, lon, cosY, sinY, cosX, sinX, cx, cy, R);
      const tgt = (p0.z + p1.z) > 0 ? front : back;
      tgt.moveTo(p0.sx, p0.sy);
      tgt.lineTo(p1.sx, p1.sy);
    }
  }

  return (
    <Canvas style={{ position: 'absolute', width, height }} pointerEvents="none">
      {/* Dark sphere fill */}
      <Circle cx={cx} cy={cy} r={R} color="#020810" />
      {/* Back-half grid — dim */}
      <Path path={back}  color="rgba(40,110,210,0.18)" style="stroke" strokeWidth={0.75} />
      {/* Front-half grid — bright */}
      <Path path={front} color="rgba(90,185,255,0.80)" style="stroke" strokeWidth={1.1} />
      {/* Edge glow ring */}
      <Circle cx={cx} cy={cy} r={R}>
        <RadialGradient
          c={vec(cx, cy)} r={R}
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(30,90,200,0.55)', 'rgba(10,40,120,0.80)']}
          positions={[0, 0.70, 0.90, 1.0]}
        />
      </Circle>
    </Canvas>
  );
};

// ─── WorldPage ────────────────────────────────────────────────────────────────

const WorldPage: React.FC<any> = ({ navigation }) => {
  const { width, height } = useWindowDimensions();
  const { users, loading, hasMore, total, error, loadMore, refresh } = useWorldUsers();

  const R  = Math.min(width, height) * 0.39;
  const cx = width  / 2;
  const cy = height * 0.47;

  const RRef  = useRef(R);
  const cxRef = useRef(cx);
  const cyRef = useRef(cy);
  useEffect(() => { RRef.current = R; cxRef.current = cx; cyRef.current = cy; }, [R, cx, cy]);

  // ── 2-axis rotation ───────────────────────────────────────────────────────
  const rotYRef = useRef(0.5);
  const rotXRef = useRef(0.0);
  const [rotY, setRotY] = useState(0.5);
  const [rotX, setRotX] = useState(0.0);

  const isDraggingRef     = useRef(false);
  const momentumActiveRef = useRef(false);
  const prevDxRef         = useRef(0);
  const prevDyRef         = useRef(0);

  const momY = useRef(new Animated.Value(0.5)).current;
  const momX = useRef(new Animated.Value(0.0)).current;
  const momYIdRef = useRef<string | null>(null);
  const momXIdRef = useRef<string | null>(null);

  const stopMomentum = useCallback(() => {
    momY.stopAnimation();
    momX.stopAnimation();
    if (momYIdRef.current) { momY.removeListener(momYIdRef.current); momYIdRef.current = null; }
    if (momXIdRef.current) { momX.removeListener(momXIdRef.current); momXIdRef.current = null; }
    momentumActiveRef.current = false;
  }, [momY, momX]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!isDraggingRef.current && !momentumActiveRef.current) {
        rotYRef.current += AUTO_ROT_RAD;
        setRotY(rotYRef.current);
      }
    }, 16);
    return () => clearInterval(id);
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  // ── PanResponder — capture from flag children when dragging ───────────────
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder:        () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder:         (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
    onMoveShouldSetPanResponderCapture:  (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,

    onPanResponderGrant: () => {
      isDraggingRef.current = true;
      prevDxRef.current = 0;
      prevDyRef.current = 0;
      stopMomentum();
    },
    onPanResponderMove: (_, g) => {
      const ddx = g.dx - prevDxRef.current;
      const ddy = g.dy - prevDyRef.current;
      prevDxRef.current = g.dx;
      prevDyRef.current = g.dy;
      rotYRef.current += ddx / (RRef.current * DRAG_DIV);
      rotXRef.current = Math.max(-Math.PI * 0.42,
        Math.min(Math.PI * 0.42, rotXRef.current + ddy / (RRef.current * DRAG_DIV)));
      setRotY(rotYRef.current);
      setRotX(rotXRef.current);
    },
    onPanResponderRelease: (_, g) => {
      isDraggingRef.current = false;
      prevDxRef.current = 0;
      prevDyRef.current = 0;
      const velY = g.vx / (RRef.current * DRAG_DIV);
      const velX = g.vy / (RRef.current * DRAG_DIV);
      if (Math.abs(velY) < 0.004 && Math.abs(velX) < 0.004) return;
      momentumActiveRef.current = true;
      momY.setValue(rotYRef.current);
      momX.setValue(rotXRef.current);
      momYIdRef.current = momY.addListener(({ value }) => { rotYRef.current = value; setRotY(value); });
      momXIdRef.current = momX.addListener(({ value }) => {
        const c = Math.max(-Math.PI * 0.42, Math.min(Math.PI * 0.42, value));
        rotXRef.current = c; setRotX(c);
      });
      let done = 0;
      const onDone = () => { done++; if (done >= 2) stopMomentum(); };
      Animated.decay(momY, { velocity: velY, deceleration: DECAY_DECEL, useNativeDriver: false }).start(onDone);
      Animated.decay(momX, { velocity: velX, deceleration: DECAY_DECEL, useNativeDriver: false }).start(onDone);
    },
    onPanResponderTerminate: () => { isDraggingRef.current = false; stopMomentum(); },
  }), [stopMomentum]);

  // ── Flag 3-D positions ────────────────────────────────────────────────────
  const flags = useMemo<FlagPoint[]>(() => {
    if (!users.length) return [];
    const pts  = fibonacciSphere(users.length);
    const cosY = Math.cos(rotY); const sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX); const sinX = Math.sin(rotX);
    return users.map((user, i) => {
      const { lat, lon } = pts[i];
      const { sx, sy, z } = project(lat, lon, cosY, sinY, cosX, sinX, cx, cy, R);
      const depth = (z + 1) / 2;
      const flagW = FLAG_W_MIN + depth * (FLAG_W_MAX - FLAG_W_MIN);
      const flagH = flagW * FLAG_ASPECT;
      const poleH = POLE_H_MIN + depth * (POLE_H_MAX - POLE_H_MIN);
      return {
        user, sx, sy,
        flagW: Math.round(flagW), flagH: Math.round(flagH), poleH: Math.round(poleH),
        depth, visible: z > -0.08,
        tiltY: (sx - cx) / R * 22,
        tiltX: -(sy - cy) / R * 14,
      };
    });
  }, [users, rotY, rotX, R, cx, cy]);

  const sortedFlags = useMemo(
    () => flags.filter(p => p.visible).sort((a, b) => a.depth - b.depth),
    [flags],
  );

  // ── Zoom transition ───────────────────────────────────────────────────────
  const [zoomState, setZoomState] = useState<{ user: WorldUser } | null>(null);
  const zLeft   = useRef(new Animated.Value(0)).current;
  const zTop    = useRef(new Animated.Value(0)).current;
  const zW      = useRef(new Animated.Value(FLAG_W_MIN)).current;
  const zH      = useRef(new Animated.Value(FLAG_W_MIN * FLAG_ASPECT)).current;
  const zRadius = useRef(new Animated.Value(8)).current;
  const navigatedRef = useRef(false);

  const handleFlagTap = useCallback((p: FlagPoint) => {
    const { user, sx, sy, flagW, flagH, poleH } = p;
    zLeft.setValue(sx - flagW / 2); zTop.setValue(sy - flagH - poleH);
    zW.setValue(flagW); zH.setValue(flagH); zRadius.setValue(8);
    navigatedRef.current = false;
    setZoomState({ user });

    // Pre-warm the profile cache so ProfilePage mounts with data (no spinner).
    void loadProfile(user.deviceId, { name: user.name, portrait: user.portrait, rank: user.rank })
      .catch(() => {/* ignore — ProfilePage will retry */});

    Animated.parallel([
      Animated.timing(zLeft,   { toValue: 0,      duration: ZOOM_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.timing(zTop,    { toValue: 0,      duration: ZOOM_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.timing(zW,      { toValue: width,  duration: ZOOM_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.timing(zH,      { toValue: height, duration: ZOOM_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.timing(zRadius, { toValue: 0,      duration: ZOOM_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
    ]).start(() => {
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        navigation.push('ProfilePage', {
          deviceId: user.deviceId, name: user.name,
          portrait: user.portrait, rank: user.rank,
          fromZoom: true,
        });
        setTimeout(() => setZoomState(null), 80);
      }
    });
  }, [width, height, navigation, zLeft, zTop, zW, zH, zRadius]);

  // ── Layout switcher ───────────────────────────────────────────────────────
  const [layout, setLayout] = useState<'globe' | 'list' | 'icons'>('globe');

  // Direct-navigate from list/icon view (no zoom portal needed)
  const goToProfile = useCallback((user: WorldUser) => {
    void loadProfile(user.deviceId, { name: user.name, portrait: user.portrait, rank: user.rank })
      .catch(() => {});
    navigation.push('ProfilePage', {
      deviceId: user.deviceId, name: user.name,
      portrait: user.portrait, rank: user.rank,
    });
  }, [navigation]);

  // Sorted users for list/icon views (by rank if available, else by name)
  const usersSorted = useMemo(
    () => [...users].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999)),
    [users],
  );

  // ── Helpers ───────────────────────────────────────────────────────────────
  const topPad = Platform.OS === 'ios' ? TOP_PAD_IOS : (StatusBar.currentHeight ?? 24) + 10;
  const ini = (n: string) => (n || '?')[0].toUpperCase();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={BG_COLOR} />

      {/* Rotating wireframe globe — re-renders every frame with rotY/rotX */}
      {layout === 'globe' && (
        <WireGlobe cx={cx} cy={cy} R={R} width={width} height={height} rotY={rotY} rotX={rotX} />
      )}

      {/* Full-screen orbit layer — flags rotate here (globe mode only) */}
      <View style={StyleSheet.absoluteFill} {...(layout === 'globe' ? panResponder.panHandlers : {})}>

        {/* ── Flags: back-to-front so front flags render on top (globe only) ── */}
        {layout === 'globe' && sortedFlags.map((p) => {
          const { user, sx, sy, flagW, flagH, poleH, depth, tiltY, tiltX } = p;
          return (
            <TouchableOpacity
              key={user.deviceId}
              onPress={() => handleFlagTap(p)}
              activeOpacity={0.80}
              delayPressIn={55}
              hitSlop={{ top: 8, bottom: poleH + 12, left: 8, right: 8 }}
              style={[styles.flagWrap, {
                left: sx - flagW / 2,
                top: sy - flagH - poleH - PIN_R * 2,
                width: flagW,
                opacity: 0.35 + depth * 0.65,
              }]}
            >
              {/* Photo card */}
              <View style={[styles.flagCard, {
                width: flagW, height: flagH,
                shadowOpacity: 0.15 + depth * 0.48,
                shadowRadius: 2 + depth * 9,
                shadowOffset: { width: depth * 2, height: depth * 3 },
                elevation: Math.round(2 + depth * 14),
                transform: [
                  { perspective: 700 },
                  { rotateY: `${tiltY}deg` },
                  { rotateX: `${tiltX}deg` },
                ],
              }]}>
                {user.portrait ? (
                  <Image source={{ uri: user.portrait }} style={[StyleSheet.absoluteFill, styles.flagImg]} resizeMode="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.flagPlaceholder]}>
                    <Text style={[styles.flagInitial, { fontSize: flagW * 0.38 }]}>{ini(user.name)}</Text>
                  </View>
                )}
                {/* Depth darkness overlay (back items darker) */}
                {depth < 0.88 && (
                  <View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, { borderRadius: 6, backgroundColor: `rgba(0,0,0,${(1 - depth) * 0.52})` }]}
                  />
                )}
                {/* Front highlight sheen */}
                {depth > 0.58 && (
                  <View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, { borderRadius: 6, backgroundColor: `rgba(255,255,255,${(depth - 0.58) * 0.20})` }]}
                  />
                )}
              </View>

              {/* Pole */}
              <View style={[styles.pole, { height: poleH }]} />
              {/* Pin */}
              <View style={styles.pin} />

              {/* Name label */}
              <Text
                numberOfLines={1}
                style={[styles.flagName, { fontSize: Math.round(flagW * 0.16 + 5), maxWidth: flagW + 24 }]}
              >
                {user.name || '—'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Top/bottom fade vignettes */}
      <View pointerEvents="none" style={styles.gradTop} />
      <View pointerEvents="none" style={styles.gradBottom} />

      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: topPad }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
          style={styles.closeBtn}
        >
          <Text style={styles.closeBtnText}>❎</Text>
        </TouchableOpacity>

        <Text style={styles.titleText}>🌑 World{total > 0 ? ` · ${total}` : users.length > 0 ? ` · ${users.length}` : ''}</Text>

        {/* Layout switcher */}
        <View style={styles.layoutRow}>
          <TouchableOpacity
            style={[styles.layoutBtn, layout === 'globe' && styles.layoutBtnOn]}
            onPress={() => setLayout('globe')}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={styles.layoutBtnText}>🌐</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.layoutBtn, layout === 'list' && styles.layoutBtnOn]}
            onPress={() => setLayout('list')}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={styles.layoutBtnText}>☰</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.layoutBtn, layout === 'icons' && styles.layoutBtnOn]}
            onPress={() => setLayout('icons')}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={styles.layoutBtnText}>⊞</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── List layout ── */}
      {layout === 'list' && (
        <FlatList
          data={usersSorted}
          keyExtractor={(u) => u.deviceId}
          style={styles.listView}
          contentContainerStyle={{ paddingTop: topPad + 52, paddingBottom: 40, paddingHorizontal: 14 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.listRow} onPress={() => goToProfile(item)} activeOpacity={0.8}>
              {item.portrait ? (
                <Image source={{ uri: item.portrait }} style={styles.listAvatar} resizeMode="cover" />
              ) : (
                <View style={[styles.listAvatar, styles.listAvatarPlaceholder]}>
                  <Text style={styles.listAvatarInitial}>{ini(item.name)}</Text>
                </View>
              )}
              <View style={styles.listMeta}>
                <Text style={styles.listName} numberOfLines={1}>{item.name || '—'}</Text>
                {item.rank != null && <Text style={styles.listRank}>#{item.rank}</Text>}
              </View>
              <Text style={styles.listChevron}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* ── Icons layout ── */}
      {layout === 'icons' && (
        <FlatList
          data={usersSorted}
          keyExtractor={(u) => u.deviceId}
          numColumns={4}
          style={styles.iconsView}
          contentContainerStyle={{ paddingTop: topPad + 52, paddingBottom: 40, paddingHorizontal: 10 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.iconCell} onPress={() => goToProfile(item)} activeOpacity={0.8}>
              {item.portrait ? (
                <Image source={{ uri: item.portrait }} style={styles.iconImg} resizeMode="cover" />
              ) : (
                <View style={[styles.iconImg, styles.iconImgPlaceholder]}>
                  <Text style={styles.iconInitial}>{ini(item.name)}</Text>
                </View>
              )}
              <Text style={styles.iconName} numberOfLines={1}>{item.name || '—'}</Text>
              {item.rank != null && <Text style={styles.iconRank}>#{item.rank}</Text>}
            </TouchableOpacity>
          )}
        />
      )}

      {loading && !users.length && (
        <View pointerEvents="none" style={styles.loadingWrap}>
          <Text style={styles.loadingText}>🌑</Text>
        </View>
      )}
      {layout === 'globe' && hasMore && !loading && (
        <TouchableOpacity
          style={styles.loadMoreButton}
          onPress={loadMore}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Load more world users"
        >
          <Text style={styles.loadMoreText}>Load more</Text>
        </TouchableOpacity>
      )}
      {!!error && (
        <View pointerEvents="none" style={[styles.errorWrap, { top: topPad + 52 }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Zoom portal — portrait image only */}
      {!!zoomState && (
        <Modal transparent animationType="none" visible statusBarTranslucent>
          <Animated.View style={[styles.zoomFrame, {
            left: zLeft, top: zTop, width: zW, height: zH, borderRadius: zRadius,
          }]}>
            {zoomState.user.portrait ? (
              <Image source={{ uri: zoomState.user.portrait }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.zoomPlaceholder]}>
                <Text style={styles.zoomInitial}>{ini(zoomState.user.name)}</Text>
              </View>
            )}
          </Animated.View>
        </Modal>
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG_COLOR },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 8, zIndex: 300,
  },
  closeBtn: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: 26 },
  titleText: {
    flex: 1, color: '#d0d0ff', fontSize: 18, fontWeight: '800',
    textAlign: 'center', letterSpacing: 0.4,
  },
  gradTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 120,
    zIndex: 200, pointerEvents: 'none',
  },
  gradBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 90,
    zIndex: 200, pointerEvents: 'none',
  },

  // ── Flag elements ─────────────────────────────────────────────────────────
  flagWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  flagCard: {
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.88)',
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
    shadowColor: '#000',
  },
  flagImg:         { borderRadius: 6 },
  flagPlaceholder: { backgroundColor: '#1a1a3a', alignItems: 'center', justifyContent: 'center' },
  flagInitial:     { color: '#9090cc', fontWeight: '700' },

  pole: {
    width: 2.5,
    backgroundColor: 'rgba(255,255,255,0.72)',
    marginTop: 0,
  },
  pin: {
    width: PIN_R * 2,
    height: PIN_R * 2,
    borderRadius: PIN_R,
    backgroundColor: '#fff',
    marginTop: -0.5,
  },
  flagName: {
    color: 'rgba(255,255,255,0.90)',
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // ── Overlays ──────────────────────────────────────────────────────────────
  loadingWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  loadingText: { fontSize: 52, opacity: 0.28 },
  errorWrap: {
    position: 'absolute', left: 20, right: 20, zIndex: 400, alignItems: 'center',
  },
  errorText: {
    color: '#ff8a8a', fontSize: 12, textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 10, overflow: 'hidden',
  },
  loadMoreButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 28,
    zIndex: 320,
    backgroundColor: 'rgba(90,185,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(90,185,255,0.55)',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  loadMoreText: {
    color: '#d0f0ff',
    fontSize: 13,
    fontWeight: '800',
  },

  // ── Zoom portal ───────────────────────────────────────────────────────────
  zoomFrame: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: '#0d0d22',
  },
  zoomPlaceholder: {
    backgroundColor: '#1a1a3a', alignItems: 'center', justifyContent: 'center',
  },
  zoomInitial: { color: '#aaaadd', fontSize: 72, fontWeight: '700' },

  // ── Layout switcher (top-right of top bar) ───────────────────────────────
  layoutRow: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
  },
  layoutBtn: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  layoutBtnOn: {
    backgroundColor: 'rgba(90,185,255,0.28)',
    borderWidth: 1, borderColor: 'rgba(90,185,255,0.55)',
  },
  layoutBtnText: { fontSize: 16 },

  // ── List view ─────────────────────────────────────────────────────────────
  listView: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  listRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14, marginBottom: 8,
    paddingVertical: 10, paddingHorizontal: 12, gap: 12,
  },
  listAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#1a1a3a' },
  listAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  listAvatarInitial: { color: '#9090cc', fontSize: 20, fontWeight: '700' },
  listMeta: { flex: 1 },
  listName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  listRank: { color: 'rgba(90,185,255,0.80)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  listChevron: { color: 'rgba(255,255,255,0.30)', fontSize: 22, fontWeight: '300' },

  // ── Icons view ────────────────────────────────────────────────────────────
  iconsView: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  iconCell: {
    flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4,
  },
  iconImg: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#1a1a3a' },
  iconImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  iconInitial: { color: '#9090cc', fontSize: 26, fontWeight: '700' },
  iconName: { color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 5, textAlign: 'center', maxWidth: 76 },
  iconRank: { color: 'rgba(90,185,255,0.75)', fontSize: 10, fontWeight: '600', marginTop: 1 },
});

export default WorldPage;
