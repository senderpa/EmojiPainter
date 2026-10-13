/**
 * Settings Screen
 *
 * Features:
 * - Quality settings (canvas size, PNG export quality)
 * - Autosave toggle (persisted)
 * - Passport info (photo, name, coins, leaderboard)
 * - Dark/Light mode toggle (with bounce-off animation)
 * - About section (video, contact info)
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Switch, Image, Animated, Dimensions, Linking } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { CustomOverlayHelper } from '../components/CustomOverlay';
import { Video, ResizeMode } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import * as StoreReview from 'expo-store-review';
import Constants from 'expo-constants';
import { markUserRated } from '../lib/ratingTracker';
import { useAppSettings } from '../context/AppSettingsContext';
import { useEmojiSet, type EmojiSetId } from '../emoji/EmojiSetContext';
import { AppEmoji } from '../emoji/AppText';
import { notificationService } from '../services/notificationService';
import { useGuidedCapture } from '../capture/GuidedCaptureContext'; // [SHOWCASE-CAPTURE] remove later
import { PROFILE_TERMS_WEB_URL } from '../lib/profileTerms';
import { listProjects, loadProject } from '../lib/storage';
import RoomViewerModal from '../ar/RoomViewerModal';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Settings keys for AsyncStorage
const SETTINGS_KEYS = {
  CANVAS_SIZE: '@settings_canvas_size',
  PNG_QUALITY: '@settings_png_quality',
  AUTOSAVE_ENABLED: '@settings_autosave_enabled',
  PASSPORT_NAME: '@settings_passport_name',
  PASSPORT_PHOTO: '@settings_passport_photo',
  COINS: '@settings_coins',
  LEADERBOARD_PLACE: '@settings_leaderboard_place'
};

type CanvasSize = 512 | 1024 | 2048 | 4096;
type PngQuality = 4096 | 8192 | 16384;

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { settings, setSoundEnabled } = useAppSettings();
  const { emojiSet, setEmojiSet } = useEmojiSet();
  // [SHOWCASE-CAPTURE] temporary — remove this + the "🎬 Showcase Capture" section below
  const capture = useGuidedCapture();
  const startShowcaseCapture = () => { capture.startSession(); navigation.navigate('Paint' as never); };
  const startJustDraw = () => { capture.startFreeDraw(); navigation.navigate('Paint' as never); };

  const appVersion = Constants.expoConfig?.version ?? Constants.manifest?.version ?? Constants.nativeAppVersion ?? '9.7.5'; // fallback

  // Settings state
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(2048);
  const [pngQuality, setPngQuality] = useState<PngQuality>(4096); // Default to 4K
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [passportName, setPassportName] = useState('Artist');
  const [coins, setCoins] = useState(0);
  const [leaderboardPlace, setLeaderboardPlace] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [savedRooms, setSavedRooms] = useState<Array<{ name: string; dir: string; preview?: string | null; strokeCount?: number }>>([]);
  const [roomViewerDir, setRoomViewerDir] = useState<string | null>(null);

  // Dark mode button animation
  const darkModeButtonY = useRef(new Animated.Value(0)).current;
  const darkModeButtonRotation = useRef(new Animated.Value(0)).current;

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    void loadSavedRooms();
  }, []);

  const loadSavedRooms = async () => {
    try {
      const names = await listProjects();
      const rooms: Array<{ name: string; dir: string; preview?: string | null; strokeCount?: number }> = [];
      for (const name of names) {
        const payload = await loadProject(name);
        const metadata = (payload as any)?.metadata;
        if (metadata?.kind === 'ar_scene' && metadata.arSceneDir) {
          rooms.push({ name, dir: metadata.arSceneDir, preview: payload?.preview, strokeCount: metadata.strokeCount });
        }
      }
      setSavedRooms(rooms);
    } catch (error) {
      console.warn('[Settings] Failed to load saved rooms', error);
    }
  };

  const openSavedRoomInAR = async (dir: string) => {
    await AsyncStorage.setItem('@load_ar_scene', JSON.stringify({ dir }));
    navigation.navigate('Paint' as never);
  };

  const loadSettings = async () => {
    try {
      const [
        savedCanvasSize,
        savedPngQuality,
        savedAutosave,
        savedName,
        savedCoins,
        savedPlace
      ] = await Promise.all([
        AsyncStorage.getItem(SETTINGS_KEYS.CANVAS_SIZE),
        AsyncStorage.getItem(SETTINGS_KEYS.PNG_QUALITY),
        AsyncStorage.getItem(SETTINGS_KEYS.AUTOSAVE_ENABLED),
        AsyncStorage.getItem(SETTINGS_KEYS.PASSPORT_NAME),
        AsyncStorage.getItem(SETTINGS_KEYS.COINS),
        AsyncStorage.getItem(SETTINGS_KEYS.LEADERBOARD_PLACE)
      ]);

      if (savedCanvasSize) setCanvasSize(parseInt(savedCanvasSize) as CanvasSize);
      if (savedPngQuality) setPngQuality(parseInt(savedPngQuality) as PngQuality);
      if (savedAutosave !== null) setAutosaveEnabled(savedAutosave === 'true');
      if (savedName) setPassportName(savedName);
      if (savedCoins) setCoins(parseInt(savedCoins));
      if (savedPlace) setLeaderboardPlace(parseInt(savedPlace));

      // Load notification status
      const notifEnabled = await notificationService.areEnabled();
      setNotificationsEnabled(notifEnabled);

      console.log('[Settings] Loaded settings');
    } catch (error) {
      console.error('[Settings] Failed to load settings:', error);
    }
  };

  const saveCanvasSize = async (size: CanvasSize) => {
    setCanvasSize(size);
    await AsyncStorage.setItem(SETTINGS_KEYS.CANVAS_SIZE, size.toString());
    console.log('[Settings] Canvas size saved:', size);
  };

  const savePngQuality = async (quality: PngQuality) => {
    setPngQuality(quality);
    await AsyncStorage.setItem(SETTINGS_KEYS.PNG_QUALITY, quality.toString());
    console.log('[Settings] PNG quality saved:', quality);
  };

  const toggleAutosave = async (enabled: boolean) => {
    setAutosaveEnabled(enabled);
    await AsyncStorage.setItem(SETTINGS_KEYS.AUTOSAVE_ENABLED, enabled.toString());
    console.log('[Settings] Autosave toggled:', enabled);
  };

  const enableNotifications = async () => {
    const success = await notificationService.requestPermissionsAndEnable();
    setNotificationsEnabled(success);
    console.log('[Settings] Notifications toggled:', success);
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (!enabled) {
      await notificationService.disable();
      setNotificationsEnabled(false);
      console.log('[Settings] Notifications disabled');
      return;
    }
    // No AGB check here: acceptance is collected once at first launch.
    // iOS's own notification permission prompt still runs inside enableNotifications().
    await enableNotifications();
  };

  // Dark mode button with bounce-off animation
  const handleDarkModePress = () => {
    console.log('[Settings] Dark mode pressed - animating bounce-off');

    // Animate button falling and bouncing off screen
    Animated.sequence([
      // Rotate while falling
      Animated.parallel([
        Animated.timing(darkModeButtonY, {
          toValue: SCREEN_HEIGHT,
          duration: 1000,
          useNativeDriver: true
        }),
        Animated.timing(darkModeButtonRotation, {
          toValue: 720, // 2 full rotations
          duration: 1000,
          useNativeDriver: true
        })
      ]),
      // Reset after animation
      Animated.timing(darkModeButtonY, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true
      })
    ]).start(() => {
      darkModeButtonRotation.setValue(0);
    });
  };

  const handleContactEmail = () => {
    Linking.openURL('mailto:support@emojipainter.com');
  };

  const handleWebsite = () => {
    Linking.openURL('https://emojipainter.com');
  };

  const handlePrivacyPolicy = () => {
    void Linking.openURL(PROFILE_TERMS_WEB_URL).catch(() => {
      CustomOverlayHelper.show({ title: 'Could not open policy', message: PROFILE_TERMS_WEB_URL });
    });
  };

  const handleRateApp = async () => {
    try {
      const available = await StoreReview.isAvailableAsync();
      if (available) {
        await StoreReview.requestReview();
        await markUserRated();
        console.log('[Settings] User rated app via settings');
      } else {
        CustomOverlayHelper.show({ title: 'Rating', message: 'In-app rating is not available on this device' });
      }
    } catch (error) {
      console.error('[Settings] Error requesting review:', error);
      CustomOverlayHelper.show({ title: 'Error', message: 'Could not open rating dialog' });
    }
  };

  const handleBuyMeCoffee = () => {
    Linking.openURL('https://buymeacoffee.com/emojipaint');
  };

  const handleRateAppStore = () => {
    Linking.openURL('itms-apps://itunes.apple.com/app/id6753342820?action=write-review');
  };

  const handleVideoEditor = () => {
    console.log('[Settings] Opening Video Editor');
    // Navigate to VideoEditor screen
    // The VideoEditor screen will show the video picker modal on mount
    navigation.navigate('VideoEditor' as any);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {/* Passport Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎨 Passport</Text>
          <View style={styles.passportCard}>
            <View style={styles.passportPhotoContainer}>
              <Text style={styles.passportPhotoPlaceholder}>👤</Text>
            </View>
            <View style={styles.passportInfo}>
              <Text style={styles.passportName}>{passportName}</Text>
              <View style={styles.passportStats}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Coins</Text>
                  <Text style={styles.statValue}>🪙 {coins}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Rank</Text>
                  <Text style={styles.statValue}>#{leaderboardPlace || '—'}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Emoji Style */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>😀 Emoji Style</Text>
          <View style={styles.settingGroup}>
            <Text style={styles.settingLabel}>Emoji Set</Text>
            <Text style={styles.settingDescription}>Use Apple emoji or a custom set across the whole app</Text>
            <View style={styles.optionsRow}>
              {([['apple', 'Apple'], ['material', 'Material']] as [EmojiSetId, string][]).map(([id, label]) => (
                <TouchableOpacity
                  key={id}
                  style={[styles.optionButton, emojiSet === id && styles.optionButtonActive]}
                  onPress={() => setEmojiSet(id)}
                >
                  <Text style={[styles.optionButtonText, emojiSet === id && styles.optionButtonTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 14, alignItems: 'center' }}>
              {['🎨', '👍', '🔥', '⭐️', '🌈', '😀', '🚀'].map((e) => (
                <AppEmoji key={e} char={e} size={30} />
              ))}
            </View>
          </View>
        </View>

        {/* Quality Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚙️ Quality Settings</Text>

          {/* Canvas Size */}
          <View style={styles.settingGroup}>
            <Text style={styles.settingLabel}>Canvas Size</Text>
            <Text style={styles.settingDescription}>Higher = better quality but slower</Text>
            <View style={styles.optionsRow}>
              {([512, 1024, 2048, 4096] as CanvasSize[]).map(size => (
                <TouchableOpacity
                  key={size}
                  style={[
                    styles.optionButton,
                    canvasSize === size && styles.optionButtonActive
                  ]}
                  onPress={() => saveCanvasSize(size)}
                >
                  <Text style={[
                    styles.optionButtonText,
                    canvasSize === size && styles.optionButtonTextActive
                  ]}>
                    {size}px
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* PNG Export Quality */}
          <View style={styles.settingGroup}>
            <Text style={styles.settingLabel}>PNG Export Quality</Text>
            <Text style={styles.settingDescription}>Default quality for PNG exports</Text>
            <View style={styles.optionsRow}>
              {([4096, 8192, 16384] as PngQuality[]).map(quality => (
                <TouchableOpacity
                  key={quality}
                  style={[
                    styles.optionButton,
                    pngQuality === quality && styles.optionButtonActive
                  ]}
                  onPress={() => savePngQuality(quality)}
                >
                  <Text style={[
                    styles.optionButtonText,
                    pngQuality === quality && styles.optionButtonTextActive
                  ]}>
                    {quality === 4096 ? '4K' : quality === 8192 ? '8K' : '16K'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Autosave Toggle */}
          <View style={styles.settingGroup}>
            <View style={styles.settingRow}>
              <View style={styles.settingLabelContainer}>
                <Text style={styles.settingLabel}>Autosave</Text>
                <Text style={styles.settingDescription}>Automatically save progress</Text>
              </View>
              <Switch
                value={autosaveEnabled}
                onValueChange={toggleAutosave}
                trackColor={{ false: '#444', true: '#4a9eff' }}
                thumbColor={autosaveEnabled ? '#fff' : '#ccc'}
              />
            </View>
          </View>

          {/* Sound Toggle */}
          <View style={styles.settingGroup}>
            <View style={styles.settingRow}>
              <View style={styles.settingLabelContainer}>
                <Text style={styles.settingLabel}>🔊 Sound</Text>
                <Text style={styles.settingDescription}>Enable app sounds and videos audio</Text>
              </View>
              <Switch
                value={settings.soundEnabled}
                onValueChange={setSoundEnabled}
                trackColor={{ false: '#444', true: '#4a9eff' }}
                thumbColor={settings.soundEnabled ? '#fff' : '#ccc'}
              />
            </View>
          </View>

          {/* Notifications Toggle */}
          <View style={styles.settingGroup}>
            <View style={styles.settingRow}>
              <View style={styles.settingLabelContainer}>
                <Text style={styles.settingLabel}>🔔 Notifications</Text>
                <Text style={styles.settingDescription}>Random daily reminders to paint topics</Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={toggleNotifications}
                trackColor={{ false: '#444', true: '#4a9eff' }}
                thumbColor={notificationsEnabled ? '#fff' : '#ccc'}
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🏠 Saved Rooms</Text>
          {savedRooms.length === 0 ? (
            <Text style={styles.description}>Rooms saved from AR will appear here with a 3D viewer and AR reopen action.</Text>
          ) : savedRooms.map((room) => (
            <View key={room.dir} style={styles.roomRow}>
              {room.preview ? <Image source={{ uri: room.preview }} style={styles.roomThumb} /> : <View style={styles.roomThumbPlaceholder}><Text>🏠</Text></View>}
              <View style={{ flex: 1 }}><Text style={styles.settingLabel}>{room.name}</Text><Text style={styles.description}>{room.strokeCount ?? 0} strokes</Text></View>
              <TouchableOpacity style={styles.roomAction} onPress={() => setRoomViewerDir(room.dir)}><Text style={styles.roomActionText}>3D</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.roomAction, styles.roomActionGreen]} onPress={() => void openSavedRoomInAR(room.dir)}><Text style={styles.roomActionText}>AR</Text></TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Theme Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎨 Theme</Text>
          <View style={styles.settingGroup}>
            <Text style={styles.settingDescription}>Choose your preferred theme</Text>
            <Animated.View
              style={{
                transform: [
                  { translateY: darkModeButtonY },
                  {
                    rotate: darkModeButtonRotation.interpolate({
                      inputRange: [0, 720],
                      outputRange: ['0deg', '720deg']
                    })
                  }
                ]
              }}
            >
              <TouchableOpacity
                style={styles.themeButton}
                onPress={handleDarkModePress}
              >
                <Text style={styles.themeButtonText}>🌙 Dark Mode</Text>
              </TouchableOpacity>
            </Animated.View>
            <TouchableOpacity
              style={[styles.themeButton, styles.themeButtonDisabled]}
            >
              <Text style={styles.themeButtonTextDisabled}>☀️ Light Mode (Coming Soon)</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* [SHOWCASE-CAPTURE] Showcase Capture Section — temporary, remove later */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎬 Showcase Capture</Text>
          <Text style={styles.aboutDescription}>
            Hands-off screen recording — you just draw. Each task auto-records and auto-advances; or pick “Just draw” to record freely. Run it as often as you like, then share the clips.
          </Text>
          <View style={styles.aboutLinks}>
            <TouchableOpacity style={styles.linkButton} onPress={startJustDraw}>
              <Text style={styles.linkButtonText}>✏️ Just draw — auto record</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkButton} onPress={startShowcaseCapture}>
              <Text style={styles.linkButtonText}>🎥 Guided session (auto)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkButton} onPress={capture.openClips}>
              <Text style={styles.linkButtonText}>🎞️ Captured clips</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ℹ️ About</Text>

          {/* Video */}
          <View style={styles.aboutVideoContainer}>
            <Video
              source={require('../../assets/loader-animation.mp4')}
              style={styles.aboutVideo}
              resizeMode={ResizeMode.CONTAIN}
              isLooping
              shouldPlay
              isMuted
            />
          </View>

          <Text style={styles.aboutTitle}>EmojiPainter</Text>
          <Text style={styles.aboutDescription}>
            Express yourself with emojis! Paint, create, and share your emoji masterpieces.
          </Text>

          <View style={styles.aboutLinks}>
            <TouchableOpacity style={styles.linkButton} onPress={handleWebsite}>
              <Text style={styles.linkButtonText}>🌐 emojipainter.com</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkButton} onPress={handleContactEmail}>
              <Text style={styles.linkButtonText}>✉️ Contact Support</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkButton} onPress={handlePrivacyPolicy}>
              <Text style={styles.linkButtonText}>🔒 Privacy Policy</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.version}>Version {appVersion}</Text>
        </View>

        {/* Support Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💛 Support the Developer</Text>
          <Text style={styles.supportSubtitle}>Made with ❤️ by one developer</Text>
          <TouchableOpacity style={styles.supportButton} onPress={handleBuyMeCoffee}>
            <Text style={styles.supportButtonText}>Buy me a coffee ☕</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.supportButton, styles.rateButton]} onPress={handleRateAppStore}>
            <Text style={[styles.supportButtonText, styles.rateButtonText]}>Rate the App ⭐</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
      <RoomViewerModal
        visible={roomViewerDir != null}
        roomDir={roomViewerDir}
        title="Saved Room"
        onClose={() => setRoomViewerDir(null)}
        onOpenAR={() => { const dir = roomViewerDir; setRoomViewerDir(null); if (dir) void openSavedRoomInAR(dir); }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333'
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4a9eff'
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff'
  },
  headerSpacer: {
    width: 80
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    padding: 16,
    gap: 24
  },
  section: {
    gap: 16
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#324657',
  },
  roomThumb: { width: 58, height: 44, borderRadius: 8, backgroundColor: '#222' },
  roomThumbPlaceholder: { width: 58, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#243746' },
  roomAction: { minWidth: 38, height: 34, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#176a79' },
  roomActionGreen: { backgroundColor: '#168b6c' },
  roomActionText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  description: { color: '#8f9ba7', fontSize: 12, lineHeight: 17 },
  passportCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    gap: 16,
    borderWidth: 2,
    borderColor: '#333'
  },
  passportPhotoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#4a9eff'
  },
  passportPhotoPlaceholder: {
    fontSize: 40
  },
  passportInfo: {
    flex: 1,
    gap: 12
  },
  passportName: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff'
  },
  passportStats: {
    flexDirection: 'row',
    gap: 16
  },
  statItem: {
    flex: 1,
    gap: 4
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase'
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff'
  },
  statDivider: {
    width: 1,
    backgroundColor: '#333'
  },
  settingGroup: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#333'
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff'
  },
  settingDescription: {
    fontSize: 14,
    color: '#888',
    lineHeight: 20
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  settingLabelContainer: {
    flex: 1,
    gap: 4
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 8
  },
  optionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#444',
    alignItems: 'center'
  },
  optionButtonActive: {
    backgroundColor: '#4a9eff',
    borderColor: '#4a9eff'
  },
  optionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888'
  },
  optionButtonTextActive: {
    color: '#fff'
  },
  themeButton: {
    backgroundColor: '#2a2a2a',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#444',
    alignItems: 'center',
    marginBottom: 12
  },
  themeButtonDisabled: {
    opacity: 0.5
  },
  themeButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff'
  },
  themeButtonTextDisabled: {
    fontSize: 16,
    fontWeight: '700',
    color: '#666'
  },
  aboutVideoContainer: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#333'
  },
  aboutVideo: {
    width: '100%',
    height: '100%'
  },
  aboutTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center'
  },
  aboutDescription: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    lineHeight: 24
  },
  aboutLinks: {
    gap: 12
  },
  linkButton: {
    backgroundColor: '#1a1a1a',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center'
  },
  linkButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4a9eff'
  },
  version: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8
  },
  supportSubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 4
  },
  supportButton: {
    backgroundColor: '#f7c948',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e6b800'
  },
  rateButton: {
    backgroundColor: '#2a2a2a',
    borderColor: '#4a9eff'
  },
  supportButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a'
  },
  rateButtonText: {
    color: '#4a9eff'
  }
});

export default SettingsScreen;
