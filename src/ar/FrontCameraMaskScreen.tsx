/**
 * Front Camera — AR Draw's Mask Mode, kept separate from Emoji Front Camera.
 * Native owns face tracking, deformation, painting and JSON persistence; this
 * screen mirrors AR Draw's small mask toolbar and mask-library workflow.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Canvas, Circle, RadialGradient, SweepGradient, vec } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText as Text } from '../emoji/AppText';
import { usePainting } from '../state/PaintingContext';
import { renderableEmojiEntries, searchRenderableEmojis } from '../lib/emojiCatalog';
import { getCustomBrushPNGData, isCustomBrushReference } from '../lib/customBrushRegistry';
import EmojiPickerModal from '../workspace/EmojiPickerModal';
import emojiPickerStyles from '../workspace/emojiPickerStyles';
import BrushEmojiIcon from '../components/BrushEmojiIcon';
import {
  EmojiArConstantsValue,
  FrontMaskNativeView,
  type FrontMaskViewRef,
  type SavedFrontMask,
} from '../../modules/emoji-ar';
import { recordLifetimeStrokeCommit } from '../lib/lifetimeStats';
import { useLifetimeActivity } from '../lib/useLifetimeActivity';

interface FrontCameraMaskScreenProps {
  visible: boolean;
  onClose: () => void;
  onSwitchToAr?: () => void;
  /** Changes only when entering from the scene chooser, not during AR ↔ Front jumps. */
  newSessionToken?: number;
}

type FrontBrushMode = 'spray' | 'relief' | 'texture' | 'emoji';

const COLOR_WHEEL_SIZE = 156;
const hsvToRgb = (hue: number, saturation: number, brightness: number): [number, number, number] => {
  const s = saturation / 100;
  const v = brightness / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let r = 0; let g = 0; let b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

const rgbToHsv = (red: number, green: number, blue: number) => {
  const r = red / 255; const g = green / 255; const b = blue / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * (((b - r) / delta) + 2);
    else hue = 60 * (((r - g) / delta) + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max === 0 ? 0 : (delta / max) * 100, brightness: max * 100 };
};

const rgbHex = ([r, g, b]: number[]) =>
  `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const byNewest = (masks: SavedFrontMask[]) =>
  [...masks].sort((a, b) => b.createdAt - a.createdAt);

const FrontCameraMaskScreen: React.FC<FrontCameraMaskScreenProps> = ({
  visible,
  onClose,
  onSwitchToAr,
  newSessionToken = 0,
}) => {
  useLifetimeActivity('front-camera', visible);
  const insets = useSafeAreaInsets();
  const {
    brushEmoji,
    recentEmojis,
    mirrorX,
    mirrorY,
    brushRotation,
    brushSpacing,
    dispatch,
  } = usePainting();
  const nativeRef = useRef<FrontMaskViewRef | null>(null);
  const appliedNewSessionTokenRef = useRef<number | null>(null);
  const [everOpened, setEverOpened] = useState(false);
  const [faceCount, setFaceCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState({ undoCount: 0, redoCount: 0, markCount: 0 });
  const [masks, setMasks] = useState<SavedFrontMask[]>([]);
  const [activeMaskID, setActiveMaskID] = useState<string | null>(null);
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [busyMaskID, setBusyMaskID] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(0.092);
  const [brushMode, setBrushMode] = useState<FrontBrushMode>('emoji');
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [customBrushDataUri, setCustomBrushDataUri] = useState<string | null>(null);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [hue, setHue] = useState(342);
  const [saturation, setSaturation] = useState(82);
  const [brightness, setBrightness] = useState(100);
  const [gridEnabled, setGridEnabled] = useState(false);
  const [cameraTextureEnabled, setCameraTextureEnabled] = useState(false);
  const [sprayCanEnabled, setSprayCanEnabled] = useState(true);
  const [textureLineStyle, setTextureLineStyle] = useState<'clean' | 'spray'>('clean');
  const [textureNormalEnabled, setTextureNormalEnabled] = useState(false);
  // Experimental: marks float in the space around the head instead of sticking
  // to the mask or a plane. Off unless the user asks for it.
  const [freeMode, setFreeMode] = useState(false);
  const [freePlaneInfo, setFreePlaneInfo] = useState<string | null>(null);
  const freePlaneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const color = useMemo(
    () => hsvToRgb(hue, saturation, brightness),
    [brightness, hue, saturation],
  );

  // Only Spray and Relief paint with the chosen colour. Both are hidden from
  // the mode picker for now (kept alive natively, not deleted), so this is
  // unreachable via UI today — left intact so re-adding either button needs
  // no logic changes here.
  const colorToolActive = brushMode === 'spray' || brushMode === 'relief';

  const wheelCursor = useMemo(() => {
    const radius = COLOR_WHEEL_SIZE / 2;
    const angle = (hue * Math.PI) / 180;
    const distance = (saturation / 100) * radius;
    return { x: radius + Math.cos(angle) * distance, y: radius + Math.sin(angle) * distance };
  }, [hue, saturation]);

  const updateWheel = useCallback((x: number, y: number) => {
    const radius = COLOR_WHEEL_SIZE / 2;
    const dx = x - radius; const dy = y - radius;
    let nextHue = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (nextHue < 0) nextHue += 360;
    setHue(nextHue);
    setSaturation(Math.min(100, (Math.hypot(dx, dy) / radius) * 100));
  }, []);

  const wheelResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => updateWheel(
      event.nativeEvent.locationX,
      event.nativeEvent.locationY,
    ),
    onPanResponderMove: (event) => updateWheel(
      event.nativeEvent.locationX,
      event.nativeEvent.locationY,
    ),
  }), [updateWheel]);

  if (visible && !everOpened) setEverOpened(true);

  const refreshMasks = useCallback(async () => {
    try {
      const next = await nativeRef.current?.listMasks();
      if (next) setMasks(byNewest(next));
    } catch (error) {
      console.warn('[FrontCamera] Could not list masks:', error);
    }
  }, []);

  useEffect(() => {
    if (!visible || !ready) return;
    const timer = setTimeout(() => { void refreshMasks(); }, 80);
    return () => clearTimeout(timer);
  }, [ready, refreshMasks, visible]);

  useEffect(() => {
    if (!visible) {
      setLibraryVisible(false);
      setEmojiPickerVisible(false);
      setColorPickerVisible(false);
      setEyedropperActive(false);
      setSettingsVisible(false);
      setStatus(null);
    }
  }, [visible]);

  // Leaving a colour tool takes the picker with it — it cannot linger over a
  // tool that ignores the colour.
  useEffect(() => {
    if (colorToolActive) return;
    setColorPickerVisible(false);
    setEyedropperActive(false);
  }, [colorToolActive]);

  // Same entry point for the buttons and the native multi-finger taps, so the
  // history state can never diverge between them.
  const undo = useCallback(() => {
    const view = nativeRef.current;
    if (!view) return;
    void Haptics.selectionAsync();
    void view.undo().catch(() => undefined);
  }, []);

  const redo = useCallback(() => {
    const view = nativeRef.current;
    if (!view) return;
    void Haptics.selectionAsync();
    void view.redo().catch(() => undefined);
  }, []);

  const toggleFreeMode = useCallback(() => {
    void Haptics.selectionAsync();
    const next = !freeMode;
    setFreeMode(next);
    setStatus(next ? '🌌 Free Mode — marks float around your head' : 'Free Mode off');
    setTimeout(() => setStatus(null), 1400);
  }, [freeMode]);

  const selectEmoji = useCallback((emoji: string) => {
    if (!emoji) return;
    dispatch({ type: 'SET_BRUSH_EMOJI', emoji });
    setBrushMode('emoji');
    setEmojiPickerVisible(false);
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;
    if (!isCustomBrushReference(brushEmoji)) {
      setCustomBrushDataUri(null);
      return;
    }
    void getCustomBrushPNGData(brushEmoji)
      .then((base64) => {
        if (!cancelled) setCustomBrushDataUri(base64 ? `data:image/png;base64,${base64}` : null);
      })
      .catch((error) => {
        console.warn('[FrontCamera] Could not resolve custom brush:', error);
        if (!cancelled) setCustomBrushDataUri(null);
      });
    return () => { cancelled = true; };
  }, [brushEmoji]);

  const nativeBrushEmoji = useMemo(() => {
    if (isCustomBrushReference(brushEmoji)) return customBrushDataUri ?? '🙂';
    return brushEmoji || '🙂';
  }, [brushEmoji, customBrushDataUri]);

  const emojiResults = useMemo(
    () => (emojiSearch.trim() ? searchRenderableEmojis(emojiSearch) : renderableEmojiEntries),
    [emojiSearch],
  );

  const spacingSlider = useMemo(() => ({
    value: brushSpacing,
    minimum: 0.001,
    maximum: 1,
    onChange: (value: number) => dispatch({ type: 'SET_BRUSH_SPACING', spacing: value }),
  }), [brushSpacing, dispatch]);

  const savedMasks = useMemo(() => masks.filter((mask) => !mask.isAutosave), [masks]);

  const reportError = useCallback((title: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    Alert.alert(title, message.replace(/^Error:\s*/i, ''));
  }, []);

  const loadMask = useCallback(async (mask: SavedFrontMask) => {
    if (faceCount === 0) {
      Alert.alert('Look at the camera', 'Keep your face in view until tracking is ready, then load the mask.');
      return;
    }
    setBusyMaskID(mask.id);
    setStatus(`Loading ${mask.name}…`);
    try {
      const count = await nativeRef.current?.loadMask(mask.id);
      setActiveMaskID(mask.id);
      setLibraryVisible(false);
      setHistory((current) => ({ ...current, markCount: count ?? mask.markCount }));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      reportError('Could not load mask', error);
    } finally {
      setBusyMaskID(null);
      setStatus(null);
    }
  }, [faceCount, reportError]);

  const beginEmptyMask = useCallback(() => {
    nativeRef.current?.clearMask().catch(() => undefined);
    const random = renderableEmojiEntries[
      Math.floor(Math.random() * renderableEmojiEntries.length)
    ]?.emoji ?? '😀';
    dispatch({ type: 'SET_BRUSH_EMOJI', emoji: random });
    setBrushMode('emoji');
    setActiveMaskID(null);
    setHistory({ undoCount: 0, redoCount: 0, markCount: 0 });
    setLibraryVisible(false);
    void Haptics.selectionAsync();
  }, [dispatch]);

  // Entering Front Camera from the chooser always creates a blank mask with a
  // fresh random emoji. Fast AR ↔ Front jumps keep the token unchanged and
  // therefore keep both scenes exactly as they were.
  useEffect(() => {
    if (!visible || !ready || appliedNewSessionTokenRef.current === newSessionToken) return;
    appliedNewSessionTokenRef.current = newSessionToken;
    beginEmptyMask();
  }, [beginEmptyMask, newSessionToken, ready, visible]);

  const saveWithName = useCallback((defaultName?: string, onSaved?: () => void) => {
    if (history.markCount === 0) {
      Alert.alert('Empty mask', 'Paint a few marks onto your face before saving.');
      return;
    }
    const suggested = defaultName ?? `Mask ${savedMasks.length + 1}`;
    Alert.prompt(
      'Save mask',
      'Give this face mask a name.',
      async (entered) => {
        const name = entered?.trim() || suggested;
        setStatus('Saving mask…');
        try {
          const saved = await nativeRef.current?.saveMask(name);
          if (saved) setActiveMaskID(saved.id);
          await refreshMasks();
          onSaved?.();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
          reportError('Could not save mask', error);
        } finally {
          setStatus(null);
        }
      },
      'plain-text',
      suggested,
    );
  }, [history.markCount, refreshMasks, reportError, savedMasks.length]);

  const newMask = useCallback(() => {
    if (history.markCount === 0) {
      beginEmptyMask();
      return;
    }
    Alert.alert('New mask', 'Save the current mask before starting a clean one?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: beginEmptyMask },
      {
        text: 'Save first',
        onPress: () => saveWithName(undefined, beginEmptyMask),
      },
    ]);
  }, [beginEmptyMask, history.markCount, saveWithName]);

  const deleteMask = useCallback((mask: SavedFrontMask) => {
    Alert.alert('Delete mask?', `“${mask.name}” will be removed from this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await nativeRef.current?.deleteMask(mask.id);
            if (activeMaskID === mask.id) setActiveMaskID(null);
            await refreshMasks();
          } catch (error) {
            reportError('Could not delete mask', error);
          }
        },
      },
    ]);
  }, [activeMaskID, refreshMasks, reportError]);

  const duplicateMask = useCallback(async (mask: SavedFrontMask) => {
    setBusyMaskID(mask.id);
    try {
      await nativeRef.current?.duplicateMask(mask.id);
      await refreshMasks();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      reportError('Could not copy mask', error);
    } finally {
      setBusyMaskID(null);
    }
  }, [refreshMasks, reportError]);

  if (!everOpened) return null;

  if (!FrontMaskNativeView || !EmojiArConstantsValue.isFaceTrackingSupported) {
    if (!visible) return null;
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.unsupportedWrap}>
          <View style={styles.unsupportedCard}>
            <Text style={styles.unsupportedTitle}>Front Camera unavailable</Text>
            <Text style={styles.unsupportedText}>This scene needs an iPhone or iPad with ARKit face tracking.</Text>
            <TouchableOpacity style={styles.mainButton} onPress={onClose}>
              <Text style={styles.mainButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <View
      style={[styles.fullscreen, !visible && styles.hidden]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <FrontMaskNativeView
        // @ts-expect-error Expo Modules exposes view AsyncFunctions on this ref.
        ref={nativeRef}
        style={StyleSheet.absoluteFill}
        paused={!visible}
        brushSizeMeters={brushSize}
        brushColor={color}
        brushMode={brushMode}
        brushEmoji={nativeBrushEmoji}
        brushMirrorX={mirrorX}
        brushMirrorY={mirrorY}
        brushRotation={brushRotation}
        brushSpacing={brushSpacing}
        // Free Mode floats every mark around the head instead of sticking to
        // the tracked mesh (see freeSpaceHit for emoji/spray). "auto" would
        // still fall back area-tool hits missing the face onto the fixed
        // backdrop plane behind the head — wrong depth once Free Mode is on.
        // "front3D" reuses the same floating, camera-facing plane Free Mode
        // already locks emoji/spray onto, at face depth instead of behind it.
        textureTarget={freeMode ? 'front3D' : 'auto'}
        textureLineStyle={textureLineStyle}
        textureNormalEnabled={textureNormalEnabled}
        freeModeEnabled={freeMode}
        eyedropperEnabled={eyedropperActive}
        sprayCanEnabled={sprayCanEnabled}
        gridEnabled={gridEnabled}
        cameraTextureEnabled={cameraTextureEnabled}
        onSessionReady={() => setReady(true)}
        onFaceChanged={(event) => setFaceCount(event.nativeEvent.count)}
        onHistoryChanged={(event) => setHistory(event.nativeEvent)}
        onStrokeCommitted={(event) => {
          void recordLifetimeStrokeCommit({
            eventId: `front-camera:${event.nativeEvent.strokeId}`,
            workspace: 'front-camera',
          });
        }}
        onMasksChanged={(event) => setMasks(byNewest(event.nativeEvent.masks))}
        onMaskLoaded={(event) => setActiveMaskID(event.nativeEvent.id)}
        onColorPicked={(event) => {
          const [red, green, blue] = event.nativeEvent.rgba;
          const picked = rgbToHsv(red, green, blue);
          setHue(picked.hue);
          setSaturation(picked.saturation);
          setBrightness(picked.brightness);
          setEyedropperActive(false);
          setColorPickerVisible(true);
          setStatus(`Picked ${event.nativeEvent.hex}`);
          setTimeout(() => setStatus(null), 900);
          void Haptics.selectionAsync();
        }}
        onFreePlaneLocked={(event) => {
          // Mini info: which plane this stroke got locked onto, and how far out.
          const { axis, distanceCm } = event.nativeEvent;
          setFreePlaneInfo(`🧭 Plane locked ${axis} · ${distanceCm} cm · ∥ camera`);
          if (freePlaneTimer.current) clearTimeout(freePlaneTimer.current);
          freePlaneTimer.current = setTimeout(() => setFreePlaneInfo(null), 1800);
        }}
        onArError={(event) => {
          setStatus(event.nativeEvent.message);
          Alert.alert('Front Camera error', event.nativeEvent.message);
        }}
      />

      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity style={styles.glassButton} onPress={onClose} accessibilityLabel="Close Front Camera">
          <Text style={styles.glassButtonText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.topActions}>
          {onSwitchToAr && (
            <TouchableOpacity style={styles.glassButtonWide} onPress={onSwitchToAr}>
              <Text style={styles.glassButtonText}>🧱 AR</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.glassButton, settingsVisible && styles.glassButtonSelected]}
            onPress={() => {
              setColorPickerVisible(false);
              setLibraryVisible(false);
              setSettingsVisible((value) => !value);
            }}
            accessibilityLabel="Front Camera settings"
          >
            <Text style={styles.glassButtonText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {settingsVisible && (
        <View style={[styles.settingsPanel, { top: insets.top + 61 }]}>
          <View style={styles.settingsHeader}>
            <View>
              <Text style={styles.settingsTitle}>Front settings</Text>
              <Text style={[styles.settingsTracking, faceCount > 0 && styles.trackingReady]}>
                {faceCount > 0 ? '● Face tracked' : '○ Finding face'}
              </Text>
            </View>
            <TouchableOpacity style={styles.settingsClose} onPress={() => setSettingsVisible(false)}>
              <Text style={styles.settingsCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.settingsStats}>
            <View style={styles.settingsStat}><Text style={styles.settingsStatValue}>{history.markCount}</Text><Text style={styles.settingsStatLabel}>marks</Text></View>
            <View style={styles.settingsStat}><Text style={styles.settingsStatValue}>{savedMasks.length}</Text><Text style={styles.settingsStatLabel}>saved</Text></View>
            <View style={styles.settingsStat}><Text style={styles.settingsStatValue}>{brushMode}</Text><Text style={styles.settingsStatLabel}>brush</Text></View>
          </View>
          <TouchableOpacity style={styles.settingsRow} onPress={() => setCameraTextureEnabled((value) => !value)}>
            <Text style={styles.settingsRowText}>Live face texture</Text>
            <Text style={[styles.settingsValue, cameraTextureEnabled && styles.settingsValueOn]}>{cameraTextureEnabled ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsRow} onPress={() => setGridEnabled((value) => !value)}>
            <Text style={styles.settingsRowText}>Face grid</Text>
            <Text style={[styles.settingsValue, gridEnabled && styles.settingsValueOn]}>{gridEnabled ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsRow} onPress={() => setSprayCanEnabled((value) => !value)}>
            <Text style={styles.settingsRowText}>3D spray can</Text>
            <Text style={[styles.settingsValue, sprayCanEnabled && styles.settingsValueOn]}>{sprayCanEnabled ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsRow} onPress={() => setTextureNormalEnabled((value) => !value)}>
            <Text style={styles.settingsRowText}>Texture normals</Text>
            <Text style={[styles.settingsValue, textureNormalEnabled && styles.settingsValueOn]}>{textureNormalEnabled ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsRow} onPress={toggleFreeMode}>
            <Text style={styles.settingsRowText}>🌌 Free Mode (3D)</Text>
            <Text style={[styles.settingsValue, freeMode && styles.settingsValueOn]}>{freeMode ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
          <View style={styles.settingsInfoRow}>
            <Text style={styles.settingsInfo}>
              Texture target: {freeMode ? 'Floating (Free Mode)' : 'Auto (face + plane)'} · Line: {textureLineStyle === 'clean' ? 'Clean' : 'Spray'}
            </Text>
            <Text style={styles.settingsInfo}>Two-finger tap = undo · three-finger tap = redo</Text>
            <Text style={styles.settingsPrivacy}>Face tracking and masks stay on this device. Nothing is uploaded.</Text>
          </View>
        </View>
      )}

      {colorPickerVisible && (
        <View style={[
          styles.colorPanel,
          {
            bottom: Math.max(12, insets.bottom + 6)
              + (brushMode === 'texture' || brushMode === 'relief' ? 150 : 112),
          },
        ]}>
          <View style={styles.colorPanelHeader}>
            <View>
              <Text style={styles.colorPanelTitle}>Paint color</Text>
              <Text style={styles.colorHex}>{rgbHex(color)}</Text>
            </View>
            <TouchableOpacity onPress={() => setColorPickerVisible(false)} style={styles.colorPanelClose}>
              <Text style={styles.colorPanelCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View
            style={styles.colorWheel}
            {...wheelResponder.panHandlers}
          >
            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              <Circle cx={COLOR_WHEEL_SIZE / 2} cy={COLOR_WHEEL_SIZE / 2} r={COLOR_WHEEL_SIZE / 2}>
                <SweepGradient
                  c={vec(COLOR_WHEEL_SIZE / 2, COLOR_WHEEL_SIZE / 2)}
                  colors={['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00']}
                />
              </Circle>
              <Circle cx={COLOR_WHEEL_SIZE / 2} cy={COLOR_WHEEL_SIZE / 2} r={COLOR_WHEEL_SIZE / 2}>
                <RadialGradient
                  c={vec(COLOR_WHEEL_SIZE / 2, COLOR_WHEEL_SIZE / 2)}
                  r={COLOR_WHEEL_SIZE / 2}
                  colors={['white', 'rgba(255,255,255,0)']}
                />
              </Circle>
              <Circle
                cx={COLOR_WHEEL_SIZE / 2}
                cy={COLOR_WHEEL_SIZE / 2}
                r={COLOR_WHEEL_SIZE / 2}
                color="black"
                opacity={(1 - brightness / 100) * 0.94}
              />
            </Canvas>
            <View
              pointerEvents="none"
              style={[styles.colorCursor, { left: wheelCursor.x - 8, top: wheelCursor.y - 8 }]}
            />
          </View>
          <View style={styles.brightnessRow}>
            <Text style={styles.brightnessIcon}>☀︎</Text>
            <Slider
              style={styles.brightnessSlider}
              minimumValue={4}
              maximumValue={100}
              value={brightness}
              onValueChange={setBrightness}
              minimumTrackTintColor={`rgb(${color.join(',')})`}
              maximumTrackTintColor="rgba(255,255,255,0.2)"
              thumbTintColor="#fff"
            />
          </View>
          <TouchableOpacity
            style={styles.eyedropperButton}
            onPress={() => {
              setColorPickerVisible(false);
              setEyedropperActive(true);
              void Haptics.selectionAsync();
            }}
          >
            <Text style={styles.eyedropperIcon}>⌾</Text>
            <Text style={styles.eyedropperText}>Pick from camera</Text>
          </TouchableOpacity>
        </View>
      )}

      {eyedropperActive && (
        <View style={[styles.eyedropperHint, { top: insets.top + 88 }]} pointerEvents="none">
          <Text style={styles.eyedropperHintText}>⌾ Tap any camera pixel</Text>
        </View>
      )}

      {!settingsVisible && (
        <View style={[styles.brushDock, { top: insets.top + 68 }]}>
          {/* Colour ring — above the emoji brush and the size slider. Only the
              colour-driven tools need it, so it stays out of the way until
              Spray or Relief is picked (Texture paints camera pixels, Emoji
              paints the glyph — neither uses the paint colour). */}
          {colorToolActive && (
          <TouchableOpacity
            style={[styles.colorDockButton, colorPickerVisible && styles.emojiDockButtonOn]}
            onPress={() => {
              setEmojiPickerVisible(false);
              setEyedropperActive(false);
              setColorPickerVisible((value) => !value);
              void Haptics.selectionAsync();
            }}
            accessibilityLabel="Open paint color picker"
          >
            <View style={styles.miniColorRing}>
              <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
                <Circle cx={14} cy={14} r={13}>
                  <SweepGradient c={vec(14, 14)} colors={['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00']} />
                </Circle>
                <Circle cx={14} cy={14} r={7.5} color={`rgb(${color.join(',')})`} />
              </Canvas>
            </View>
          </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.emojiDockButton, brushMode === 'emoji' && styles.emojiDockButtonOn]}
            onPress={() => {
              setBrushMode('emoji');
              setColorPickerVisible(false);
              setEmojiPickerVisible(true);
              void Haptics.selectionAsync();
            }}
            accessibilityLabel="Choose emoji brush"
          >
            <BrushEmojiIcon emoji={brushEmoji} size={30} textStyle={styles.emojiDockIcon} />
          </TouchableOpacity>
          <View style={styles.verticalSizeWrap}>
            <Text style={styles.verticalSizeBig}>●</Text>
            <Slider
              style={styles.verticalSizeSlider}
              minimumValue={0.02}
              maximumValue={0.26}
              value={brushSize}
              minimumTrackTintColor={`rgb(${color.join(',')})`}
              maximumTrackTintColor="rgba(255,255,255,0.3)"
              thumbTintColor="#fff"
              onValueChange={setBrushSize}
              accessibilityLabel="Brush size"
            />
            <Text style={styles.verticalSizeSmall}>•</Text>
          </View>
        </View>
      )}

      <View style={[styles.bottomPanel, { bottom: Math.max(12, insets.bottom + 6) }]}>
        <View style={styles.toolRow}>
          {/* Explicit Emoji button, matching Texture/Free — the floating dock's
              emoji glyph alone read as "pick an emoji", not "tap to switch
              back to painting emoji", so this makes returning to Emoji mode
              from Texture obvious at a glance instead of only living in the
              side dock. */}
          <TouchableOpacity
            style={[styles.toolButton, brushMode === 'emoji' && styles.toolButtonSelected]}
            onPress={() => {
              setBrushMode('emoji');
              setColorPickerVisible(false);
              setEyedropperActive(false);
              void Haptics.selectionAsync();
            }}
            accessibilityLabel="Switch to Emoji brush"
          >
            <BrushEmojiIcon emoji={brushEmoji} size={17} textStyle={styles.toolIcon} />
            <Text style={styles.toolLabel}>Emoji</Text>
          </TouchableOpacity>
          {/* Spray and Relief are hidden from the picker for now (product
              request) — 'spray'/'relief' stay in FrontBrushMode and native
              keeps handling them fully, so nothing here needs deleting to
              bring a button back. */}
          {([
            ['texture', '🖼️', 'Texture'],
          ] as const).map(([mode, icon, label]) => (
            <TouchableOpacity
              key={mode}
              style={[styles.toolButton, brushMode === mode && styles.toolButtonSelected]}
              onPress={() => {
                setBrushMode(mode);
                setColorPickerVisible(false);
                setEyedropperActive(false);
                void Haptics.selectionAsync();
              }}
            >
              <Text style={styles.toolIcon}>{icon}</Text>
              <Text style={styles.toolLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
          {/* Free Mode sits with the other tools now (the colour ring moved up
              into the right-hand brush dock). */}
          <TouchableOpacity
            style={[styles.toolButton, freeMode && styles.toolButtonSelected]}
            onPress={toggleFreeMode}
            accessibilityLabel="Toggle Free Mode 3D painting"
          >
            <Text style={styles.toolIcon}>🌌</Text>
            <Text style={styles.toolLabel}>Free</Text>
          </TouchableOpacity>
        </View>
        {(brushMode === 'texture' || brushMode === 'relief') && (
          // Surface is automatic now (face under the finger, plane around it),
          // so only the line options are left to choose.
          <View style={styles.areaOptionsRow}>
            <TouchableOpacity
              style={[styles.areaOption, textureLineStyle === 'clean' && styles.areaOptionOn]}
              onPress={() => setTextureLineStyle('clean')}
            ><Text style={styles.areaOptionText} numberOfLines={1}>➖ Clean</Text></TouchableOpacity>
            <TouchableOpacity
              style={[styles.areaOption, textureLineStyle === 'spray' && styles.areaOptionOn]}
              onPress={() => setTextureLineStyle('spray')}
            ><Text style={styles.areaOptionText} numberOfLines={1}>💨 Spray</Text></TouchableOpacity>
            {brushMode === 'texture' && (
              <TouchableOpacity
                style={[styles.areaOption, textureNormalEnabled && styles.areaOptionOn]}
                onPress={() => setTextureNormalEnabled((value) => !value)}
              ><Text style={styles.areaOptionText} numberOfLines={1}>🏔️ Normal</Text></TouchableOpacity>
            )}
          </View>
        )}
        <View style={styles.actionRow}>
          {/* Two-finger tap on the camera does the same as ↩️, three fingers ↪️. */}
          <TouchableOpacity
            style={[styles.actionButton, history.undoCount === 0 && styles.disabled]}
            disabled={history.undoCount === 0}
            onPress={undo}
          ><Text style={styles.actionIcon}>↩️</Text><Text style={styles.actionLabel}>Undo</Text></TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, history.redoCount === 0 && styles.disabled]}
            disabled={history.redoCount === 0}
            onPress={redo}
          ><Text style={styles.actionIcon}>↪️</Text><Text style={styles.actionLabel}>Redo</Text></TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => saveWithName()}>
            <Text style={styles.actionIcon}>💾</Text><Text style={styles.actionLabel}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={newMask}>
            <Text style={styles.actionIcon}>🆕</Text><Text style={styles.actionLabel}>New</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, libraryVisible && styles.actionSelected]}
            onPress={() => { setLibraryVisible((value) => !value); void refreshMasks(); }}
          ><Text style={styles.actionIcon}>🎭</Text><Text style={styles.actionLabel}>Masks</Text></TouchableOpacity>
        </View>
      </View>

      {libraryVisible && (
        <View style={[
          styles.libraryPanel,
          { top: insets.top + 62, bottom: insets.bottom + (brushMode === 'texture' || brushMode === 'relief' ? 150 : 116) },
        ]}>
          <View style={styles.libraryHeader}>
            <View>
              <Text style={styles.libraryTitle}>Saved Masks</Text>
              <Text style={styles.librarySubtitle}>Tap a mask to wear it</Text>
            </View>
            <TouchableOpacity style={styles.libraryClose} onPress={() => setLibraryVisible(false)}>
              <Text style={styles.libraryCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.libraryList} showsVerticalScrollIndicator={false}>
            {savedMasks.length === 0 && (
              <View style={styles.emptyLibrary}>
                <Text style={styles.emptyEmoji}>🎭</Text>
                <Text style={styles.emptyTitle}>No masks saved yet</Text>
                <Text style={styles.emptyText}>Paint on your face, then tap Save.</Text>
              </View>
            )}
            {savedMasks.map((mask) => (
              <View key={mask.id} style={[styles.maskCard, activeMaskID === mask.id && styles.maskCardActive]}>
                <TouchableOpacity style={styles.maskLoadArea} onPress={() => void loadMask(mask)}>
                  {mask.thumbnailPath ? (
                    <Image
                      source={{ uri: mask.thumbnailPath }}
                      style={{ width: 72, height: 88, borderRadius: 12, backgroundColor: '#08090b' }}
                    />
                  ) : <View style={[styles.maskThumbnail, styles.thumbnailFallback]}><Text>🎭</Text></View>}
                  <View style={styles.maskInfo}>
                    <Text style={styles.maskName} numberOfLines={1}>{mask.name}</Text>
                    <Text style={styles.maskMeta}>
                      {mask.markCount} marks · {new Date(mask.createdAt).toLocaleDateString()}
                    </Text>
                    <Text style={styles.loadText}>
                      {busyMaskID === mask.id ? 'Loading…' : activeMaskID === mask.id ? 'Wearing now' : 'Load mask'}
                    </Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.cardActions}>
                  <TouchableOpacity style={styles.cardAction} onPress={() => void duplicateMask(mask)}>
                    <Text style={styles.cardActionText}>Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cardAction} onPress={() => deleteMask(mask)}>
                    <Text style={[styles.cardActionText, styles.deleteText]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <EmojiPickerModal
        visible={emojiPickerVisible}
        styles={emojiPickerStyles}
        emojiSearch={emojiSearch}
        onEmojiSearchChange={setEmojiSearch}
        brushEmoji={brushEmoji}
        recentEmojis={recentEmojis}
        emojiResults={emojiResults}
        onSelectEmoji={selectEmoji}
        onClose={() => setEmojiPickerVisible(false)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        mirrorX={mirrorX}
        mirrorY={mirrorY}
        rotation={brushRotation}
        onToggleMirrorX={() => dispatch({ type: 'SET_MIRROR_X', value: !mirrorX })}
        onToggleMirrorY={() => dispatch({ type: 'SET_MIRROR_Y', value: !mirrorY })}
        spacingSlider={spacingSlider}
        onTurnLeft={() => dispatch({
          type: 'SET_BRUSH_ROTATION',
          rotation: (((brushRotation - 15) % 360) + 360) % 360,
        })}
        onTurnRight={() => dispatch({
          type: 'SET_BRUSH_ROTATION',
          rotation: (brushRotation + 15) % 360,
        })}
      />

      {status && (
        <View style={[styles.statusPill, { top: insets.top + 130 }]}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      )}

      {/* Free Mode mini info — which plane the current stroke locked onto. */}
      {freePlaneInfo && (
        <View style={[styles.freePlanePill, { top: insets.top + (status ? 172 : 130) }]} pointerEvents="none">
          <Text style={styles.freePlaneText}>{freePlaneInfo}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  fullscreen: { ...StyleSheet.absoluteFillObject, zIndex: 12000, backgroundColor: '#000' },
  hidden: { display: 'none' },
  unsupportedWrap: { flex: 1, backgroundColor: '#08090b', alignItems: 'center', justifyContent: 'center', padding: 24 },
  unsupportedCard: { width: '100%', maxWidth: 380, borderRadius: 24, backgroundColor: '#17191e', padding: 24, alignItems: 'center', gap: 14 },
  unsupportedTitle: { color: '#fff', fontSize: 21, fontWeight: '800' },
  unsupportedText: { color: 'rgba(255,255,255,0.65)', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  topBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 60 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  glassButton: { width: 45, height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,12,16,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  glassButtonWide: { minWidth: 60, height: 45, paddingHorizontal: 11, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,12,16,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  glassButtonSelected: { backgroundColor: 'rgba(255,55,119,0.32)', borderColor: 'rgba(255,125,169,0.75)' },
  glassButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  trackingReady: { color: '#66f29a' },
  settingsPanel: { position: 'absolute', right: 12, width: 274, padding: 12, borderRadius: 20, backgroundColor: 'rgba(13,15,19,0.97)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.19)', zIndex: 55 },
  settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  settingsTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  settingsTracking: { color: 'rgba(255,255,255,0.48)', fontSize: 10, fontWeight: '800', marginTop: 2 },
  settingsClose: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.09)' },
  settingsCloseText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  settingsStats: { flexDirection: 'row', gap: 6, marginBottom: 9 },
  settingsStat: { flex: 1, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 3 },
  settingsStatValue: { color: '#fff', fontSize: 12, fontWeight: '900', textTransform: 'capitalize' },
  settingsStatLabel: { color: 'rgba(255,255,255,0.43)', fontSize: 8.5, fontWeight: '700', marginTop: 1 },
  settingsRow: { minHeight: 38, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingsRowText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  settingsValue: { color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: '900' },
  settingsValueOn: { color: '#66f29a' },
  settingsInfoRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)', paddingTop: 9 },
  settingsInfo: { color: 'rgba(255,255,255,0.5)', fontSize: 9.5, fontWeight: '700' },
  settingsPrivacy: { color: 'rgba(102,242,154,0.82)', fontSize: 9, fontWeight: '800', lineHeight: 13, marginTop: 7 },
  colorPanel: { position: 'absolute', right: 57, width: 190, padding: 12, borderRadius: 22, backgroundColor: 'rgba(13,15,19,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.19)', alignItems: 'center', zIndex: 45 },
  colorPanelHeader: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  colorPanelTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  colorHex: { color: 'rgba(255,255,255,0.48)', fontSize: 10, fontWeight: '700', marginTop: 1 },
  colorPanelClose: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center' },
  colorPanelCloseText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  colorWheel: { width: COLOR_WHEEL_SIZE, height: COLOR_WHEEL_SIZE },
  colorCursor: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.12)' },
  brightnessRow: { width: '100%', flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  brightnessIcon: { color: '#fff', fontSize: 14, width: 18 },
  brightnessSlider: { flex: 1, height: 32 },
  eyedropperButton: { width: '100%', height: 39, borderRadius: 13, marginTop: 4, backgroundColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  eyedropperIcon: { color: '#fff', fontSize: 18, fontWeight: '900' },
  eyedropperText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  eyedropperHint: { position: 'absolute', alignSelf: 'center', borderRadius: 17, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: 'rgba(10,12,16,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  eyedropperHintText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  brushDock: { position: 'absolute', right: 10, width: 50, alignItems: 'center', borderRadius: 23, paddingVertical: 7, backgroundColor: 'rgba(10,12,16,0.76)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', zIndex: 35 },
  emojiDockButton: { width: 40, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  colorDockButton: { width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 5 },
  emojiDockButtonOn: { backgroundColor: 'rgba(255,55,119,0.3)', borderWidth: 1, borderColor: 'rgba(255,115,165,0.72)' },
  emojiDockIcon: { fontSize: 29, lineHeight: 34 },
  verticalSizeWrap: { width: 46, height: 180, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, overflow: 'hidden' },
  verticalSizeSlider: { position: 'absolute', width: 142, height: 40, top: 70, transform: [{ rotate: '-90deg' }] },
  verticalSizeBig: { color: '#fff', fontSize: 18, lineHeight: 20 },
  verticalSizeSmall: { color: '#fff', fontSize: 15, lineHeight: 17 },
  bottomPanel: { position: 'absolute', left: 10, right: 10, borderRadius: 22, padding: 10, backgroundColor: 'rgba(10,12,16,0.79)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)', zIndex: 30 },
  toolRow: { flexDirection: 'row', gap: 6, marginBottom: 5 },
  toolButton: { flex: 1, height: 43, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.075)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  toolButtonSelected: { backgroundColor: 'rgba(255,55,119,0.3)', borderWidth: 1, borderColor: 'rgba(255,115,165,0.72)' },
  toolIcon: { color: '#fff', fontSize: 17, fontWeight: '900' },
  miniColorRing: { width: 28, height: 28 },
  toolLabel: { color: '#fff', fontSize: 9.5, fontWeight: '800' },
  areaOptionsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  areaOption: { flex: 1, minHeight: 29, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.075)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  areaOptionOn: { backgroundColor: 'rgba(62,205,151,0.28)', borderWidth: 1, borderColor: 'rgba(106,241,185,0.55)' },
  areaOptionText: { color: '#fff', fontSize: 8.5, fontWeight: '800' },
  areaDivider: { width: StyleSheet.hairlineWidth, height: 19, backgroundColor: 'rgba(255,255,255,0.22)', marginHorizontal: 1 },
  actionRow: { flexDirection: 'row', gap: 6 },
  actionButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.09)' },
  actionSelected: { backgroundColor: 'rgba(255,47,113,0.32)', borderWidth: 1, borderColor: 'rgba(255,111,151,0.65)' },
  disabled: { opacity: 0.3 },
  actionIcon: { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 21 },
  actionLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 9.5, fontWeight: '700' },
  libraryPanel: { position: 'absolute', left: 12, width: 294, borderRadius: 24, backgroundColor: 'rgba(15,17,21,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)', overflow: 'hidden' },
  libraryHeader: { padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.18)' },
  libraryTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  librarySubtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 },
  libraryClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  libraryCloseText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  libraryList: { padding: 11, gap: 10 },
  emptyLibrary: { alignItems: 'center', paddingVertical: 38, paddingHorizontal: 16 },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { color: '#fff', fontWeight: '800', fontSize: 15, marginTop: 8 },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4, textAlign: 'center' },
  maskCard: { borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  maskCardActive: { borderColor: '#ff4f88', backgroundColor: 'rgba(255,47,113,0.12)' },
  maskLoadArea: { flexDirection: 'row', padding: 9, gap: 10 },
  maskThumbnail: { width: 72, height: 88, borderRadius: 12, backgroundColor: '#08090b' },
  thumbnailFallback: { alignItems: 'center', justifyContent: 'center' },
  maskInfo: { flex: 1, justifyContent: 'center' },
  maskName: { color: '#fff', fontSize: 15, fontWeight: '800' },
  maskMeta: { color: 'rgba(255,255,255,0.48)', fontSize: 10.5, marginTop: 4 },
  loadText: { color: '#ff78a6', fontSize: 11, fontWeight: '800', marginTop: 9 },
  cardActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  cardAction: { flex: 1, alignItems: 'center', paddingVertical: 9 },
  cardActionText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  deleteText: { color: '#ff7184' },
  mainButton: { width: '100%', borderRadius: 16, paddingVertical: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)' },
  mainButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  statusPill: { position: 'absolute', alignSelf: 'center', borderRadius: 16, backgroundColor: 'rgba(10,12,16,0.86)', paddingHorizontal: 15, paddingVertical: 9 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  freePlanePill: { position: 'absolute', alignSelf: 'center', borderRadius: 16, backgroundColor: 'rgba(90,60,180,0.9)', paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(190,160,255,0.6)' },
  freePlaneText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
});

export default FrontCameraMaskScreen;
