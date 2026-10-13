/**
 * InfoPanelOverlay — pure presentational component for the Info Panel feature.
 *
 * Renders two Modals extracted from PaintScreen.tsx:
 *   1. Main info panel (infoVisible)
 *   2. All Over Settings overlay (allOverSettingsVisible)
 *
 * All state arrives via props — no internal side-effects.
 * The hook (useInfoPanel) owns all state; this component only renders.
 */
import React from 'react';
import {
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Switch,
  Alert,
  StyleSheet,
  Animated as RNAnimated,
  Platform,
  Dimensions,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { AppText as AppTextComponent, AppEmoji } from '../../emoji/AppText';
import LogoAnimationLoop from '../../components/LogoAnimationLoop';
import AnimatedRandomEntry from '../../components/AnimatedRandomEntry';
import InfoWelcomerPlayer from '../../components/InfoWelcomerPlayer';
import { isGesserEnabled } from '../../gesser/config';
import { formatPrompt } from '../../types/dailyPrompt';
import { saveLanguagePreference } from '../../lib/languageStorage';
import type { DailyPrompt } from '../../types/dailyPrompt';
import type { DailyPaintGalleryEntry } from '../../lib/dailyPaintGallery';
import type { ParentalControlsSettings } from '../../lib/parentalControls';
import type { UseInfoPanelResult, InfoLanguage } from './useInfoPanel';
import {
  INFO_LANGUAGE_OPTIONS,
  LEADERBOARD_EMOJI_FRAMES,
  ANIMATION_LESSONS_EMOJI_FRAMES,
  INFO_WORKSPACE_COPY,
  ANIMATION_TUTORIAL_COPY,
  RATE_APP_COPY,
  type InfoWorkspaceCardCopy,
} from './useInfoPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const IS_IPAD = Platform.OS === 'ios' && (Platform as any).isPad === true;
const IS_LITE_BUILD = process.env.EXPO_PUBLIC_LITE_BUILD === '1';

const MULTIPAINT_BASE = 'https://some-sender.gotdns.ch:4850';
const RATE_APP_EFFECT_COUNT = 13;
const RATE_EMOJI_GLYPHS = ['📱', '📲', '⭐', '✨', '💫', '🌟'];
const RATE_PARTICLE_GLYPHS = ['✦', '·', '✧', '⋆', '•', '✺', '˙', '✹'];

interface MultiPaintCopy { title: string; description: string; openButton: string; }

// Lazy-loaded: only requests the live preview after `visible` becomes true.
function MultiPaintPreviewSection({ visible, copy, onOpen }: {
  visible: boolean;
  copy: MultiPaintCopy;
  onOpen?: () => void;
}): React.ReactElement {
  const [refreshKey, setRefreshKey] = React.useState(0);
  // Keep this card deliberately compact: one crisp square live preview is
  // easier to scan than the previous repeated 2×2 image and filmstrip.
  const previewSize = IS_IPAD ? 160 : 136;
  const latestUrl = `${MULTIPAINT_BASE}/api/preview.png?_r=${refreshKey}`;

  return (
    <TouchableOpacity
      style={{ marginBottom: 50, marginHorizontal: 18 }}
      onPress={onOpen}
      activeOpacity={0.88}
      accessibilityRole="button"
    >
      <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, borderWidth: 1, borderColor: '#FF6B35', overflow: 'hidden' }}>
        <View style={{ alignItems: 'center', paddingTop: 12, paddingHorizontal: 12 }}>
          {visible ? (
            <Image
              source={{ uri: latestUrl }}
              style={{ width: previewSize, height: previewSize, borderRadius: 10, backgroundColor: '#111' }}
              resizeMode="cover"
              fadeDuration={0}
            />
          ) : (
            <View style={{ width: previewSize, height: previewSize, borderRadius: 10, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
              <AppTextComponent style={{ color: '#555', fontSize: 11, fontFamily: 'vrtlfinal' }}>{'loading…'}</AppTextComponent>
            </View>
          )}
        </View>

        {/* Text block + button */}
        <View style={{ padding: 14, alignItems: 'center' }}>
          <AppTextComponent style={{ color: '#FF6B35', fontSize: 18, fontWeight: '700', fontFamily: 'vrtlfinal', marginBottom: 7, textAlign: 'center' }}>
            {copy.title}
          </AppTextComponent>
          <AppTextComponent style={{ color: '#bbb', fontSize: 12, fontFamily: 'vrtlfinal', textAlign: 'center', lineHeight: 17, marginBottom: 12 }}>
            {copy.description}
          </AppTextComponent>

          <TouchableOpacity
            onPress={(e) => { e.stopPropagation?.(); onOpen?.(); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 24, backgroundColor: '#FF6B35', borderRadius: 28 }}
            activeOpacity={0.8}
          >
            <AppTextComponent style={{ fontSize: 16 }}>{'🎨'}</AppTextComponent>
            <AppTextComponent style={{ color: '#fff', fontSize: 13, fontFamily: 'vrtlfinal', fontWeight: '700' }}>
              {copy.openButton}
            </AppTextComponent>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={(e) => { e.stopPropagation?.(); setRefreshKey(k => k + 1); }}
            style={{ marginTop: 12, padding: 8 }}
            activeOpacity={0.7}
          >
            <AppTextComponent style={{ color: '#555', fontSize: 11, fontFamily: 'vrtlfinal' }}>{'🔄 Reload'}</AppTextComponent>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function InfoWorkspaceCard({ copy, icon, accentColor, onOpen }: {
  copy: InfoWorkspaceCardCopy;
  icon: string;
  accentColor: string;
  onOpen: () => void;
}): React.ReactElement {
  return (
    <TouchableOpacity
      style={{
        marginBottom: 20,
        marginHorizontal: 18,
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        padding: 20,
        borderWidth: 1,
        borderColor: accentColor,
        alignItems: 'center',
      }}
      onPress={onOpen}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={copy.button}
    >
      <AppTextComponent style={{ fontSize: 48, marginBottom: 12 }}>{icon}</AppTextComponent>
      <AppTextComponent style={{ color: accentColor, fontSize: 20, fontWeight: '600', fontFamily: 'vrtlfinal', marginBottom: 6 }}>
        {copy.title}
      </AppTextComponent>
      <AppTextComponent style={{ color: '#888', fontSize: 13, fontFamily: 'vrtlfinal', textAlign: 'center', lineHeight: 19 }}>
        {copy.subtitle}
      </AppTextComponent>
      <View style={{ marginTop: 14, paddingVertical: 9, paddingHorizontal: 18, borderRadius: 18, backgroundColor: `${accentColor}22`, borderWidth: 1, borderColor: `${accentColor}66` }}>
        <AppTextComponent style={{ color: accentColor, fontSize: 12, fontWeight: '700', fontFamily: 'vrtlfinal' }}>
          {copy.button}  ›
        </AppTextComponent>
      </View>
    </TouchableOpacity>
  );
}

type RateGlyphKind = 'letter' | 'emoji' | 'particle';

/** One independently animated glyph with two fading motion-trail copies. */
function RateGlyph({ glyph, index, progress, effect, kind, containerStyle }: {
  glyph: string;
  index: number;
  progress: RNAnimated.Value;
  effect: number;
  kind: RateGlyphKind;
  containerStyle?: any;
}): React.ReactElement {
  const start = 0.035 + (index % 9) * 0.035;
  const active = progress.interpolate({
    inputRange: [0, start, start + 0.16, 0.76, 1],
    outputRange: [0, 0, 1, 1, 0.42],
    extrapolate: 'clamp',
  });
  const trailOpacity = progress.interpolate({
    inputRange: [0, start, start + 0.22, 0.82, 1],
    outputRange: [0, 0.42, 0.18, 0.08, 0],
    extrapolate: 'clamp',
  });

  let transform: any[];
  switch (effect) {
    case 0: // type in, then gently float
      transform = [
        { translateY: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [18, 0, -3] }) },
        { scale: progress.interpolate({ inputRange: [0, 0.3, 0.55, 1], outputRange: [0.7, 1.16, 0.96, 1] }) },
        { rotate: progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: ['12deg', '-3deg', '0deg'] }) },
      ];
      break;
    case 1: // spring physics
      transform = [
        { translateY: progress.interpolate({ inputRange: [0, 0.22, 0.42, 0.62, 1], outputRange: [28, -20, 12, -5, 0] }) },
        { scale: progress.interpolate({ inputRange: [0, 0.25, 0.46, 0.7, 1], outputRange: [0.55, 1.22, 0.88, 1.08, 1] }) },
        { rotate: progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: ['-20deg', '10deg', '0deg'] }) },
      ];
      break;
    case 2: // heartbeat
      transform = [{ scale: progress.interpolate({ inputRange: [0, 0.28, 0.52, 0.74, 1], outputRange: [0.9, 1.28, 0.94, 1.12, 1] }) }];
      break;
    case 3: // wave
      transform = [{ translateY: progress.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -18, 16, -10, 8, 0] }) }, { rotate: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-6deg', '6deg', '0deg'] }) }];
      break;
    case 4: // orbit
      transform = [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['-360deg', '0deg'] }) }, { scale: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.65, 1.14, 1] }) }];
      break;
    case 5: // comet left
      transform = [{ translateX: progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [52, 0, -9] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['14deg', '0deg'] }) }];
      break;
    case 6: // comet right
      transform = [{ translateX: progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [-52, 0, 9] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['-14deg', '0deg'] }) }];
      break;
    case 7: // drop
      transform = [{ translateY: progress.interpolate({ inputRange: [0, 0.58, 0.74, 1], outputRange: [-70, 12, -4, 0] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['-16deg', '0deg'] }) }];
      break;
    case 8: // burst
      transform = [{ scale: progress.interpolate({ inputRange: [0, 0.25, 0.5, 1], outputRange: [0.2, 1.32, 0.92, 1] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '0deg'] }) }];
      break;
    case 9: // 3D flip
      transform = [{ rotateY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-180deg', '20deg', '0deg'] }) }, { scale: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.74, 1.12, 1] }) }];
      break;
    case 10: // elastic wave
      transform = [{ translateY: progress.interpolate({ inputRange: [0, 0.24, 0.48, 0.72, 1], outputRange: [0, -22, 18, -6, 0] }) }, { scaleX: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 1.16, 1] }) }];
      break;
    case 11: // glitch
      transform = [{ translateX: progress.interpolate({ inputRange: [0, 0.2, 0.35, 0.52, 0.7, 1], outputRange: [0, -8, 7, -5, 3, 0] }) }, { translateY: progress.interpolate({ inputRange: [0, 0.35, 0.7, 1], outputRange: [0, 4, -3, 0] }) }, { scale: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.08, 1] }) }];
      break;
    default: // drifting sparkle
      transform = [{ translateY: progress.interpolate({ inputRange: [0, 0.35, 0.7, 1], outputRange: [14, -12, 10, 0] }) }, { translateX: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-10, 10, 0] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '8deg'] }) }];
      break;
  }

  const fontSize = kind === 'letter' ? 22 : kind === 'emoji' ? 25 : 15;
  const width = kind === 'letter' ? (glyph === ' ' ? 8 : 16) : kind === 'emoji' ? 31 : 18;
  const textStyle = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width,
    fontSize,
    lineHeight: kind === 'particle' ? 18 : 31,
    textAlign: 'center' as const,
    fontFamily: kind === 'letter' ? 'vrtlfinal' : undefined,
  };
  const trailOne = [...transform, { translateX: -6 }, { translateY: 4 }, { scale: 0.92 }];
  const trailTwo = [...transform, { translateX: 6 }, { translateY: -3 }, { scale: 0.84 }];

  return (
    <View style={[{ width, height: kind === 'particle' ? 20 : 34, alignItems: 'center', justifyContent: 'center' }, containerStyle]} pointerEvents="none">
      <RNAnimated.Text style={[textStyle, { color: 'rgba(0, 229, 255, 0.22)', opacity: trailOpacity, transform: trailOne }]}>{glyph}</RNAnimated.Text>
      <RNAnimated.Text style={[textStyle, { color: 'rgba(255, 107, 53, 0.2)', opacity: trailOpacity, transform: trailTwo }]}>{glyph}</RNAnimated.Text>
      <RNAnimated.Text style={[textStyle, { color: kind === 'particle' ? '#FFB74D' : '#4a9eff', opacity: active, transform }]}>{glyph}</RNAnimated.Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface InfoPanelOverlayProps extends UseInfoPanelResult {
  // ── Challenge confirm overlay (lives inside info modal) ────────────────────
  challengeCompleteVisible: boolean;
  challengeConfirmPrompt: DailyPrompt | null;
  confirmCopy: {
    title: string;
    subtitle: string;
    warning: string;
    confirmHint: string;
    confirmLabel: string;
    cancelLabel: string;
    galleryHeading: string;
    emptyMessage: string;
    errorMessage: string;
  };
  challengeConfirmEmoji: string | null;
  /** Reanimated animated style for the challenge confirm emoji */
  challengeConfirmEmojiAnimatedStyle: any;
  challengeConfirmLoading: boolean;
  challengeConfirmEntries: DailyPaintGalleryEntry[] | null;
  challengeConfirmAnimValuesRef: React.MutableRefObject<RNAnimated.Value[]>;
  challengeConfirmError: boolean;
  challengeConfirmProcessing: boolean;
  showNotificationPrompt: boolean;
  challengeMinutesForDay: number;

  // ── Challenge confirm handlers ─────────────────────────────────────────────
  handleChallengeSelect: (prompt: DailyPrompt) => void;
  cancelChallengeConfirm: () => void;
  confirmStartChallenge: () => void;
  openChallengeConfirmPreview: (entry: DailyPaintGalleryEntry) => void;
  handleSkipNotifications: () => void;
  handleEnableNotifications: () => void;

  // ── Active challenge / sprint state ───────────────────────────────────────
  activeChallenge: { prompt: DailyPrompt; endsAt: number } | null;
  uploadedPromptTopics: Set<string>;
  dailyPrompts: DailyPrompt[];

  // ── Mystery feature ────────────────────────────────────────────────────────
  mysteryTopicLoading: boolean;
  showMysteryTopicInInfo: boolean;
  mysteryTopic: { topicId: number; topic: string } | null;
  diceButtonCooldown: boolean;
  diceButtonCountdown: number;
  handleMysteryTopicSelect: () => void;
  handleReloadMysteryTopic: () => void;
  handleStartMysteryPainting: () => void;
  getTopicMetadata: (topic: string) => any;

  // ── Navigation / external screens ─────────────────────────────────────────
  openGallery: () => void;
  openLeaderboard: () => void;
  openPrivateStudio: () => void;
  openAR?: () => void;
  openArPainting?: () => void;
  openVector?: () => void;
  openMultiPaint?: () => void;
  openTopicSuggestions?: () => void;
  setFramerWorkspaceVisible: (visible: boolean) => void;
  navigation: any;

  // ── Guess overlay ──────────────────────────────────────────────────────────
  handleOpenGuessOverlay: (entry: DailyPaintGalleryEntry) => void;

  // ── Stats ──────────────────────────────────────────────────────────────────
  totalTimeLabel: string;
  totalStrokeLabel: string;

  // ── Rate app ───────────────────────────────────────────────────────────────
  handleRateApp: () => void;

  // ── Settings gear animation (from PaintScreen) ────────────────────────────
  settingsGearAnimatedStyle: any;

  // ── AllOverSettings dependencies ───────────────────────────────────────────
  insets: { top: number };
  settings: { theme: string; handMode: string; helperModeEnabled: boolean; tutorialModeEnabled: boolean; brushPerformanceMode: string };
  setTheme: (theme: string) => void;
  setHandMode: (mode: string) => void;
  setHelperModeEnabled: (enabled: boolean) => void;
  setTutorialModeEnabled: (enabled: boolean) => void;
  setBrushPerformanceMode: (mode: string) => void;
  parentalControls: ParentalControlsSettings;
  setParentalControls: (controls: ParentalControlsSettings) => void;
  saveParentalControls: (controls: ParentalControlsSettings) => Promise<void>;
  promptForPin: (callback: () => void) => void;
  refreshGallery: (mode: any, options?: any) => void;
  galleryMode: string;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
  notificationService: {
    areEnabled: () => Promise<boolean>;
    requestPermissionsAndEnable: () => Promise<boolean>;
    disable: () => Promise<void>;
  };
  setParentalControlsVisible: (visible: boolean) => void;
  emojiStyleOpen: boolean;
  setEmojiStyleOpen: React.Dispatch<React.SetStateAction<boolean>>;
  emojiSets: Array<{ id: string; name: string; kind: string; preview: string[] }>;
  activeSetId: string;
  setEmojiSet: (id: string) => void;
  deleteEmojiSet: (id: string) => void;
  importEmojiSet: () => Promise<{ ok: boolean; error?: string }>;
  activeEmojiSetName: string;
  emojiImporting: boolean;
  setEmojiImporting: (importing: boolean) => void;

  /** All styles from PaintScreen (passed as the full styles object). */
  styles: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const InfoPanelOverlay: React.FC<InfoPanelOverlayProps> = (props) => {
  const {
    // Hook result
    infoVisible,
    allOverSettingsVisible,
    animationLessonsVisible,
    infoLanguage,
    infoLogoKey,
    setInfoLogoKey,
    infoRandomEntry,
    inspirationEntries,
    hasMovVideos,
    infoLeaderboardFrame,
    infoAnimationLessonsFrame,
    videoInfoBannerVisible,
    setVideoInfoBannerVisible,
    videoInfoBannerTimerRef,
    animationTutorialVideoRef,
    infoLanguageScrollRef,
    infoLanguageLayouts,
    infoLanguageContainerWidth,
    promptBounceRefs,
    getPromptBounce,
    selectInfoLanguage,
    scrollInfoLanguageIntoView,
    openAnimationLessons,
    closeAnimationLessons,
    openAllOverSettings,
    closeAllOverSettings,
    setAllOverSettingsVisible,
    closeInfoPanel,
    infoCopy,
    infoDateLabel,
    setInfoLanguage,

    // Challenge confirm
    challengeCompleteVisible,
    challengeConfirmPrompt,
    confirmCopy,
    challengeConfirmEmoji,
    challengeConfirmEmojiAnimatedStyle,
    challengeConfirmLoading,
    challengeConfirmEntries,
    challengeConfirmAnimValuesRef,
    challengeConfirmError,
    challengeConfirmProcessing,
    showNotificationPrompt,
    challengeMinutesForDay,
    handleChallengeSelect,
    cancelChallengeConfirm,
    confirmStartChallenge,
    openChallengeConfirmPreview,
    handleSkipNotifications,
    handleEnableNotifications,

    // Active challenge / sprint
    activeChallenge,
    uploadedPromptTopics,
    dailyPrompts,

    // Mystery
    mysteryTopicLoading,
    showMysteryTopicInInfo,
    mysteryTopic,
    diceButtonCooldown,
    diceButtonCountdown,
    handleMysteryTopicSelect,
    handleReloadMysteryTopic,
    handleStartMysteryPainting,
    getTopicMetadata,

    // Navigation
    openGallery,
    openLeaderboard,
    openPrivateStudio,
    openTopicSuggestions,
    openAR,
    openArPainting,
    openVector,
    openMultiPaint,
    setFramerWorkspaceVisible,
    navigation,
    setInfoVisible,

    // Guess
    handleOpenGuessOverlay,

    // Stats
    totalTimeLabel,
    totalStrokeLabel,

    // Rate app
    handleRateApp,

    // Settings gear
    settingsGearAnimatedStyle,

    // AllOverSettings
    insets,
    settings,
    setTheme,
    setHandMode,
    setHelperModeEnabled,
    setTutorialModeEnabled,
    setBrushPerformanceMode,
    parentalControls,
    setParentalControls,
    saveParentalControls,
    promptForPin,
    refreshGallery,
    galleryMode,
    notificationsEnabled,
    setNotificationsEnabled,
    notificationService,
    setParentalControlsVisible,
    emojiStyleOpen,
    setEmojiStyleOpen,
    emojiSets,
    activeSetId,
    setEmojiSet,
    deleteEmojiSet,
    importEmojiSet,
    activeEmojiSetName,
    emojiImporting,
    setEmojiImporting,

    styles,
  } = props;

  // ── MultiPaint lazy-load scroll tracking ──────────────────────────────────
  const mpSectionY = React.useRef(0);
  const [mpVisible, setMpVisible] = React.useState(false);
  const rateSectionY = React.useRef(0);
  const rateSectionHeight = React.useRef(0);
  const [rateVisible, setRateVisible] = React.useState(false);
  const welcomerSectionY = React.useRef(0);
  const welcomerSectionHeight = React.useRef(0);
  const [welcomerVisible, setWelcomerVisible] = React.useState(false);
  const handleInfoScroll = React.useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const scrollY = e.nativeEvent.contentOffset.y;
    const screenH = Dimensions.get('window').height;
    if (!mpVisible && mpSectionY.current > 0 && scrollY + screenH > mpSectionY.current - 200) {
      setMpVisible(true);
    }
    if (rateSectionY.current > 0) {
      const rateTop = rateSectionY.current;
      const rateBottom = rateTop + Math.max(rateSectionHeight.current, 1);
      const nextRateVisible = scrollY + screenH > rateTop && scrollY < rateBottom;
      setRateVisible((previous) => previous === nextRateVisible ? previous : nextRateVisible);
    }
    if (welcomerSectionY.current > 0) {
      const sectionTop = welcomerSectionY.current;
      const sectionBottom = sectionTop + Math.max(welcomerSectionHeight.current, 1);
      const nextWelcomerVisible = scrollY + screenH > sectionTop && scrollY < sectionBottom;
      setWelcomerVisible((previous) => previous === nextWelcomerVisible ? previous : nextWelcomerVisible);
    }
  }, [mpVisible]);

  React.useEffect(() => {
    if (!infoVisible) {
      setMpVisible(false);
      setRateVisible(false);
      setWelcomerVisible(false);
    }
  }, [infoVisible]);

  const rateCopy = RATE_APP_COPY[infoLanguage];
  const rateEffectProgress = React.useRef(new RNAnimated.Value(0)).current;
  const rateLaunchProgress = React.useRef(new RNAnimated.Value(0)).current;
  const rateEffectAnimationRef = React.useRef<{ stop: () => void } | null>(null);
  const rateVisibleRef = React.useRef(false);
  const rateLaunchingRef = React.useRef(false);
  const [rateEffectIndex, setRateEffectIndex] = React.useState(0);
  const [rateLaunchMode, setRateLaunchMode] = React.useState(0);
  const [rateLaunching, setRateLaunching] = React.useState(false);

  React.useEffect(() => {
    rateVisibleRef.current = rateVisible;
  }, [rateVisible]);

  React.useEffect(() => {
    rateLaunchingRef.current = rateLaunching;
  }, [rateLaunching]);

  React.useEffect(() => {
    if (!rateVisible || rateLaunching) return;
    let cancelled = false;

    const animateNextRateEffect = () => {
      if (cancelled || !rateVisibleRef.current || rateLaunchingRef.current) return;
      const nextEffect = Math.floor(Math.random() * RATE_APP_EFFECT_COUNT);
      setRateEffectIndex(nextEffect);
      rateEffectProgress.setValue(0);

      const animation = RNAnimated.timing(rateEffectProgress, {
        toValue: 1,
        duration: 2600,
        useNativeDriver: true,
      });
      rateEffectAnimationRef.current = animation;
      animation.start(({ finished }) => {
        if (finished && !cancelled && rateVisibleRef.current && !rateLaunchingRef.current) {
          animateNextRateEffect();
        }
      });
    };

    animateNextRateEffect();
    return () => {
      cancelled = true;
      rateEffectAnimationRef.current?.stop();
      rateEffectAnimationRef.current = null;
      rateEffectProgress.stopAnimation();
      rateEffectProgress.setValue(0);
    };
  }, [rateCopy.title, rateEffectProgress, rateLaunching, rateVisible]);

  React.useEffect(() => {
    if (!rateVisible) {
      setRateEffectIndex(0);
    }
  }, [rateCopy.title, rateVisible]);

  const rateLaunchStyle = React.useMemo(() => {
    const progress = rateLaunchProgress;
    const fade = progress.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, 1, 0] });
    switch (rateLaunchMode) {
      case 0: // explode
        return { opacity: fade, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }] };
      case 1: // fall
        return { opacity: fade, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 420] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '24deg'] }) }] };
      case 2: // rise
        return { opacity: fade, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -260] }) }, { scale: 1.25 }] };
      case 3: // move left
        return { opacity: fade, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -420] }) }] };
      case 4: // move right
        return { opacity: fade, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 420] }) }] };
      case 5: // spin away
        return { opacity: fade, transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.1] }) }] };
      case 6: // flip away
        return { opacity: fade, transform: [{ rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] }) }, { scale: 1.2 }] };
      case 7: // bounce out
        return { opacity: fade, transform: [{ scale: progress.interpolate({ inputRange: [0, 0.28, 0.5, 1], outputRange: [1, 1.35, 0.9, 2] }) }] };
      case 8: // shake out
        return { opacity: fade, transform: [{ translateX: progress.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -18, 18, -12, 12, 0] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }] };
      case 9: // shrink
        return { opacity: fade, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }] };
      case 10: // diagonal drift
        return { opacity: fade, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 260] }) }, { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -260] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] };
      case 11: // squash
        return { opacity: fade, transform: [{ scaleX: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.7, 0.2] }) }, { scaleY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.45, 1.8] }) }] };
      default: // vanish upward
        return { opacity: fade, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -420] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] }) }] };
    }
  }, [rateLaunchMode, rateLaunchProgress]);

  // The launch transition is applied to the whole Info sheet as well as the
  // rate card, so the three-second handoff feels like the page itself is
  // bursting into the App Store.
  const ratePageLaunchStyle = React.useMemo(() => {
    const progress = rateLaunchProgress;
    const direction = rateLaunchMode % 2 === 0 ? 1 : -1;
    return {
      opacity: progress.interpolate({ inputRange: [0, 0.58, 0.84, 1], outputRange: [1, 1, 0.72, 0] }),
      transform: [
        { scale: progress.interpolate({ inputRange: [0, 0.3, 0.62, 1], outputRange: [1, 1.04, 1.45, 2.7] }) },
        { rotate: progress.interpolate({ inputRange: [0, 0.34, 0.72, 1], outputRange: ['0deg', `${direction * 6}deg`, `${direction * 28}deg`, `${direction * 100}deg`] }) },
        { translateX: progress.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0, direction * 28, direction * 520] }) },
        { translateY: progress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, -12, -460] }) },
      ],
    };
  }, [rateLaunchMode, rateLaunchProgress]);

  const rateGlyphProgress = rateLaunching ? rateLaunchProgress : rateEffectProgress;
  const rateGlyphEffect = rateLaunching ? rateLaunchMode : rateEffectIndex;
  const rateDisplayTitle = rateLaunching ? rateCopy.launching : rateCopy.title;

  const handleRatePress = React.useCallback(() => {
    if (rateLaunchingRef.current) return;
    void Haptics.selectionAsync();
    rateLaunchingRef.current = true;
    setRateLaunching(true);
    setRateLaunchMode(Math.floor(Math.random() * RATE_APP_EFFECT_COUNT));
    rateLaunchProgress.setValue(0);
    const launchAnimation = RNAnimated.timing(rateLaunchProgress, {
      toValue: 1,
      duration: 3000,
      useNativeDriver: true,
    });
    launchAnimation.start(({ finished }) => {
      if (!finished) return;
      rateLaunchingRef.current = false;
      setRateLaunching(false);
      rateLaunchProgress.setValue(0);
      void handleRateApp();
    });
  }, [handleRateApp, rateLaunchProgress]);

  const handleRateSectionLayout = React.useCallback((e: { nativeEvent: { layout: { y: number; height: number } } }) => {
    const { y, height } = e.nativeEvent.layout;
    rateSectionY.current = y;
    rateSectionHeight.current = height;
    const screenH = Dimensions.get('window').height;
    const initiallyVisible = infoVisible && y < screenH && y + height > 0;
    setRateVisible(initiallyVisible);
  }, [infoVisible]);

  const handleWelcomerSectionLayout = React.useCallback((e: { nativeEvent: { layout: { y: number; height: number } } }) => {
    const { y, height } = e.nativeEvent.layout;
    welcomerSectionY.current = y;
    welcomerSectionHeight.current = height;
    const screenH = Dimensions.get('window').height;
    setWelcomerVisible(infoVisible && y < screenH && y + height > 0);
  }, [infoVisible]);

  const animationTutorialCopy = ANIMATION_TUTORIAL_COPY[infoLanguage];
  const [animationLessonPositionMs, setAnimationLessonPositionMs] = React.useState(0);
  const [animationLessonDurationMs, setAnimationLessonDurationMs] = React.useState(0);

  React.useEffect(() => {
    setAnimationLessonPositionMs(0);
    setAnimationLessonDurationMs(0);
  }, [animationLessonsVisible]);

  const handleAnimationLessonStatus = React.useCallback((status: any) => {
    if (!status?.isLoaded) return;
    setAnimationLessonPositionMs(status.positionMillis ?? 0);
    setAnimationLessonDurationMs(status.durationMillis ?? 0);
    if (status.didJustFinish) {
      closeAnimationLessons();
    }
  }, [closeAnimationLessons]);

  const activeAnimationCueIndex = React.useMemo(() => {
    const cueWindows = [
      [5000, 8000],
      [11000, 14000],
      [17000, 20000],
      [23000, 26000],
      [29000, 32000],
    ] as const;
    return cueWindows.findIndex(([start, end]) => animationLessonPositionMs >= start && animationLessonPositionMs < end);
  }, [animationLessonPositionMs]);

  const formatLessonTime = React.useCallback((milliseconds: number) => {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  const lessonProgress = animationLessonDurationMs > 0
    ? Math.min(1, Math.max(0, animationLessonPositionMs / animationLessonDurationMs))
    : 0;

  // ── Main Info Modal ────────────────────────────────────────────────────────
  return (
    <>
      <Modal
        visible={infoVisible && !challengeCompleteVisible}
        animationType="slide"
        transparent
        onRequestClose={closeInfoPanel}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={styles.infoOverlay}>
          <RNAnimated.View style={[styles.infoSheet, rateLaunching && ratePageLaunchStyle]}>
            <View style={styles.infoHeaderRow}>
              <View>
                <AppTextComponent style={styles.infoTitle}>{infoCopy.title}</AppTextComponent>
                <AppTextComponent style={styles.infoSubtitle}>{infoCopy.subtitle}</AppTextComponent>
              </View>
              <View style={styles.infoHeaderActions}>
                <TouchableOpacity
                  style={styles.infoHeaderButton}
                  onPress={openPrivateStudio}
                  accessibilityRole="button"
                  accessibilityLabel="Open Profil"
                >
                  <AppTextComponent style={styles.infoHeaderButtonLabel}>👤</AppTextComponent>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.infoHeaderButton}
                  onPress={openGallery}
                  accessibilityRole="button"
                  accessibilityLabel="Open Gallery"
                >
                  <AppTextComponent style={styles.infoHeaderButtonLabel}>🏛️</AppTextComponent>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.infoHeaderButton}
                  onPress={openLeaderboard}
                  accessibilityRole="button"
                  accessibilityLabel="View Leaderboard"
                >
                  <AppTextComponent style={styles.infoHeaderButtonLabel}>
                    {LEADERBOARD_EMOJI_FRAMES[infoLeaderboardFrame]}
                  </AppTextComponent>
                </TouchableOpacity>
                {openAR ? (
                  <TouchableOpacity
                    style={styles.infoHeaderButton}
                    onPress={openAR}
                    accessibilityRole="button"
                    accessibilityLabel="Open AR"
                  >
                    <AppTextComponent style={styles.infoHeaderButtonLabel}>📽️</AppTextComponent>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.infoCloseButton}
                  onPress={closeInfoPanel}
                  accessibilityRole="button"
                  accessibilityLabel="Close guide"
                >
                  <AppTextComponent style={styles.infoCloseLabel}>❎</AppTextComponent>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.infoScrollContent} showsVerticalScrollIndicator={false} onScroll={handleInfoScroll} scrollEventThrottle={200}>
              {/* Random logo media pauses while the lesson overlay is active. */}
              <View style={{ marginTop: 20, marginBottom: 20, alignItems: 'center' }}>
                <LogoAnimationLoop
                  key={infoLogoKey}
                  size={260}
                  frameInterval={100}
                  isMuted={false}
                  visible={infoVisible && !animationLessonsVisible}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setInfoLogoKey((prev) => prev + 1);
                  }}
                />
              </View>
              <View style={styles.challengeSection}>
                <AppTextComponent style={styles.challengeHeading}>Daily Speed Paint Challenge</AppTextComponent>
                <AppTextComponent style={styles.challengeDate}>{infoDateLabel}</AppTextComponent>
                <AppTextComponent style={styles.challengeSubtitle}>Pick a prompt — each has its own timer. Tap to see how long you get.</AppTextComponent>
                <View style={styles.challengePromptList}>
                  {(() => {
                    const challengeActive = activeChallenge !== null;
                    return (
                      <>
                        {dailyPrompts.map((prompt) => {
                          const promptKey = formatPrompt(prompt, infoLanguage);
                          const bounceAnim = getPromptBounce(promptKey);
                          const scale = bounceAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
                          const animatedStyle = { transform: [{ scale }] };
                          const alreadyUploaded = uploadedPromptTopics.has(prompt.topic);
                          const parentalBlock = parentalControls.enabled && !parentalControls.allowDailyChallenges;
                          const isDisabled = alreadyUploaded || challengeActive || parentalBlock;
                          return (
                            <RNAnimated.View key={promptKey} style={[styles.challengePromptAnimated, animatedStyle]}>
                              <TouchableOpacity
                                style={[styles.challengePromptButton, isDisabled && styles.challengePromptButtonDisabled]}
                                onPress={() => { if (!isDisabled) handleChallengeSelect(prompt); }}
                                disabled={isDisabled}
                                accessibilityRole="button"
                                accessibilityLabel={`Start challenge: ${promptKey}`}
                                accessibilityState={isDisabled ? { disabled: true } : undefined}
                              >
                                <AppTextComponent style={[styles.challengePromptText, isDisabled && styles.challengePromptTextDisabled]}>
                                  {promptKey}
                                </AppTextComponent>
                              </TouchableOpacity>
                            </RNAnimated.View>
                          );
                        })}
                        {/* 4th Mystery Topic Option (Gesser Feature) */}
                        {isGesserEnabled() && !(parentalControls.enabled && !parentalControls.allowMysteryChallenge) && (() => {
                          const isDisabled = mysteryTopicLoading || challengeActive || parentalControls.offlineMode;
                          return (
                            <RNAnimated.View style={styles.challengePromptAnimated}>
                              <TouchableOpacity
                                style={[
                                  styles.challengePromptButton,
                                  styles.mysteryPromptButton,
                                  isDisabled && styles.challengePromptButtonDisabled,
                                ]}
                                onPress={handleMysteryTopicSelect}
                                disabled={isDisabled}
                                accessibilityRole="button"
                                accessibilityLabel="Mystery Topic Challenge"
                              >
                                {mysteryTopicLoading ? (
                                  <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                  <>
                                    <AppTextComponent style={[
                                      styles.challengePromptText,
                                      styles.mysteryPromptText,
                                      isDisabled && styles.challengePromptTextDisabled,
                                    ]}>
                                      🎲 Mystery Topic
                                    </AppTextComponent>
                                    <AppTextComponent style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2, fontFamily: 'vrtlfinal' }}>
                                      random · 1–9m
                                    </AppTextComponent>
                                  </>
                                )}
                              </TouchableOpacity>
                            </RNAnimated.View>
                          );
                        })()}
                      </>
                    );
                  })()}
                </View>
              </View>
              <ScrollView
                // A callback ref avoids React Native 0.81 freezing the
                // MutableRefObject when it is passed directly as a native prop.
                ref={(node: any) => { infoLanguageScrollRef.current = node; }}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.infoLanguageRow}
                onLayout={(event) => {
                  infoLanguageContainerWidth.current = event.nativeEvent.layout.width;
                }}
              >
                {INFO_LANGUAGE_OPTIONS.map((option) => {
                  const active = option.id === infoLanguage;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.infoLanguageButton,
                        active && styles.infoLanguageButtonActive,
                      ]}
                      onPress={() => selectInfoLanguage(option.id)}
                      onLayout={(event) => {
                        infoLanguageLayouts.current[option.id] = {
                          x: event.nativeEvent.layout.x,
                          width: event.nativeEvent.layout.width,
                        };
                        if (option.id === infoLanguage) {
                          scrollInfoLanguageIntoView();
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Switch language to ${option.label}`}
                    >
                      <AppTextComponent style={[
                        styles.infoLanguageFlag,
                        active && styles.infoLanguageFlagActive,
                      ]}>
                        {option.flag}
                      </AppTextComponent>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Community Inspiration - Random Gallery Entry */}
              <AnimatedRandomEntry
                galleryEntries={inspirationEntries}
                initialEntry={infoRandomEntry}
                visible={infoVisible && !animationLessonsVisible}
                onGuess={(paintingId, _topic) => {
                  const entry = inspirationEntries.find((e) => e.mysteryPaintingId === paintingId) ?? infoRandomEntry;
                  if (entry) handleOpenGuessOverlay(entry);
                }}
              />

              {/* Mystery Topic Display (after selection) */}
              {showMysteryTopicInInfo && mysteryTopic && (
                <View style={{
                  marginHorizontal: 18,
                  marginTop: 20,
                  marginBottom: 20,
                  padding: 20,
                  backgroundColor: '#0a0a0a',
                  borderRadius: 16,
                  borderWidth: 2,
                  borderColor: '#0ff',
                }}>
                  <AppTextComponent style={{
                    color: '#0ff',
                    fontSize: 18,
                    fontWeight: '700',
                    fontFamily: 'vrtlfinal',
                    textAlign: 'center',
                    marginBottom: 16,
                  }}>
                    🎲 Your Mystery Topic
                  </AppTextComponent>
                  <AppTextComponent style={{
                    color: '#fff',
                    fontSize: 24,
                    fontWeight: '800',
                    fontFamily: 'vrtlfinal',
                    textAlign: 'center',
                    marginBottom: 12,
                    letterSpacing: 1,
                  }}>
                    {(() => { const m = getTopicMetadata(mysteryTopic.topic); return m?.translations?.[infoLanguage] || m?.topic || mysteryTopic.topic; })()}
                  </AppTextComponent>
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                    {/* Reload Dice Button */}
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        backgroundColor: diceButtonCooldown ? '#333' : '#1a1a1a',
                        borderRadius: 12,
                        padding: 14,
                        borderWidth: 1,
                        borderColor: diceButtonCooldown ? '#555' : '#0ff',
                        opacity: diceButtonCooldown ? 0.5 : 1,
                      }}
                      onPress={handleReloadMysteryTopic}
                      disabled={diceButtonCooldown}
                      accessibilityRole="button"
                      accessibilityLabel="Reload mystery topic"
                    >
                      {mysteryTopicLoading ? (
                        <ActivityIndicator size="small" color="#0ff" />
                      ) : (
                        <View>
                          <AppTextComponent style={{ color: '#0ff', fontSize: 24, textAlign: 'center', marginBottom: 4 }}>
                            🎲
                          </AppTextComponent>
                          <AppTextComponent style={{
                            color: diceButtonCooldown ? '#888' : '#0ff',
                            fontSize: 12,
                            fontWeight: '600',
                            fontFamily: 'vrtlfinal',
                            textAlign: 'center',
                          }}>
                            {diceButtonCooldown ? `Wait ${diceButtonCountdown}s` : 'Reload'}
                          </AppTextComponent>
                        </View>
                      )}
                    </TouchableOpacity>
                    {/* Start Painting Button */}
                    <TouchableOpacity
                      style={{
                        flex: 2,
                        backgroundColor: '#0ff',
                        borderRadius: 12,
                        padding: 14,
                        borderWidth: 1,
                        borderColor: '#0ff',
                      }}
                      onPress={handleStartMysteryPainting}
                      accessibilityRole="button"
                      accessibilityLabel="Start mystery topic painting"
                    >
                      <AppTextComponent style={{
                        color: '#000',
                        fontSize: 16,
                        fontWeight: '700',
                        fontFamily: 'vrtlfinal',
                        textAlign: 'center',
                      }}>
                        Start Painting! ▶
                      </AppTextComponent>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* 4 Navigation Buttons */}
              <View style={{ paddingHorizontal: 18, marginTop: 10, marginBottom: 30 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  <TouchableOpacity
                    style={{ flex: 1, minWidth: '45%', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#4CAF50' }}
                    onPress={openGallery}
                    accessibilityRole="button"
                    accessibilityLabel="Open Live Gallery"
                  >
                    <AppTextComponent style={{ fontSize: 32, marginBottom: 8, textAlign: 'center' }}>🏛️</AppTextComponent>
                    <AppTextComponent style={{ color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: 4 }}>
                      {infoCopy.buttons.liveGallery.title}
                    </AppTextComponent>
                    <AppTextComponent style={{ color: '#888', fontSize: 11, fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                      {infoCopy.buttons.liveGallery.subtitle}
                    </AppTextComponent>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, minWidth: '45%', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#4CAF50' }}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      openPrivateStudio();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Open Profile Studio"
                  >
                    <AppTextComponent style={{ fontSize: 32, marginBottom: 8, textAlign: 'center' }}>🪪</AppTextComponent>
                    <AppTextComponent style={{ color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: 4 }}>
                      {infoCopy.buttons.profileStudio.title}
                    </AppTextComponent>
                    <AppTextComponent style={{ color: '#888', fontSize: 11, fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                      {infoCopy.buttons.profileStudio.subtitle}
                    </AppTextComponent>
                  </TouchableOpacity>
                  {hasMovVideos && (
                    <TouchableOpacity
                      style={{ flex: 1, minWidth: '45%', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#4CAF50' }}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setInfoVisible(false);
                        setFramerWorkspaceVisible(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Open Framer Animation Editor"
                    >
                      <AppTextComponent style={{ fontSize: 28, marginBottom: 8, textAlign: 'center', fontWeight: '600' }}>⏱️</AppTextComponent>
                      <AppTextComponent style={{ color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: 4 }}>
                        Framer
                      </AppTextComponent>
                      <AppTextComponent style={{ color: '#888', fontSize: 11, fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                        Timeline Animation
                      </AppTextComponent>
                    </TouchableOpacity>
                  )}
                  {hasMovVideos && (
                    <TouchableOpacity
                      style={{ flex: 1, minWidth: '45%', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#4CAF50' }}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setInfoVisible(false);
                        navigation.navigate('VideoStorage');
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Open Video Storage"
                    >
                      <AppTextComponent style={{ fontSize: 32, marginBottom: 8, textAlign: 'center' }}>📹</AppTextComponent>
                      <AppTextComponent style={{ color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: 4 }}>
                        {infoCopy.buttons.videoStorage.title}
                      </AppTextComponent>
                      <AppTextComponent style={{ color: '#888', fontSize: 11, fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                        {infoCopy.buttons.videoStorage.subtitle}
                      </AppTextComponent>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Keep these two actions as a deliberate, stable row.  The
                    navigation cards above may wrap, but Suggestions and
                    General Settings must never split onto separate lines. */}
                <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 12, width: '100%', marginTop: 12 }}>
                  {isGesserEnabled() && (
                    <TouchableOpacity
                      style={{ flex: 1, minWidth: 0, minHeight: 114, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#0ff' }}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        if (openTopicSuggestions) {
                          openTopicSuggestions();
                        } else {
                          setInfoVisible(false);
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Topic Suggestions"
                    >
                      <AppTextComponent style={{ fontSize: 32, marginBottom: 8, textAlign: 'center' }}>💡</AppTextComponent>
                      <AppTextComponent style={{ color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: 4 }}>
                        Topic Suggestions
                      </AppTextComponent>
                      <AppTextComponent style={{ color: '#888', fontSize: 11, fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                        Submit & vote on topics
                      </AppTextComponent>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={{ flex: 1, minWidth: 0, minHeight: 114, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#FF9500', alignItems: 'center', justifyContent: 'center' }}
                    onPress={openAllOverSettings}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Open All Over Settings"
                  >
                    <RNAnimated.Text style={[{ fontSize: 32, marginBottom: 8, textAlign: 'center' }, settingsGearAnimatedStyle]}>
                      ⚙️
                    </RNAnimated.Text>
                    <AppTextComponent style={{ color: '#FF9500', fontSize: 15, fontWeight: '600', fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                      {infoCopy.allOverSettings.title}
                    </AppTextComponent>
                  </TouchableOpacity>
                </View>
              </View>

              {infoCopy.description.map((paragraph, index) => (
                <AppTextComponent key={`info-paragraph-${index}`} style={styles.infoParagraph}>
                  {paragraph}
                </AppTextComponent>
              ))}
              <View style={styles.infoTips}>
                {infoCopy.tips.map((tip) => (
                  <View key={tip.title} style={styles.infoTip}>
                    <AppTextComponent style={styles.infoTipIcon}>{tip.icon}</AppTextComponent>
                    <View style={styles.infoTipText}>
                      <AppTextComponent style={styles.infoTipTitle}>{tip.title}</AppTextComponent>
                      <AppTextComponent style={styles.infoTipDetail}>{tip.detail}</AppTextComponent>
                    </View>
                  </View>
                ))}
              </View>
              <AppTextComponent style={styles.infoFooter}>{infoCopy.footer}</AppTextComponent>
              <AppTextComponent style={styles.infoStatsLabel}>All time {totalTimeLabel} · {totalStrokeLabel} strokes</AppTextComponent>

              {/* Animated Leaderboard Panel */}
              <TouchableOpacity
                style={{
                  marginTop: 30,
                  marginBottom: 20,
                  marginHorizontal: 18,
                  backgroundColor: '#1a1a1a',
                  borderRadius: 12,
                  padding: 20,
                  borderWidth: 1,
                  borderColor: '#FFD700',
                  alignItems: 'center',
                }}
                onPress={openLeaderboard}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="View Leaderboard"
              >
                <AppTextComponent style={{ fontSize: 48, marginBottom: 12 }}>
                  {LEADERBOARD_EMOJI_FRAMES[infoLeaderboardFrame]}
                </AppTextComponent>
                <AppTextComponent style={{ color: '#FFD700', fontSize: 20, fontWeight: '600', fontFamily: 'vrtlfinal', marginBottom: 6 }}>
                  {infoCopy.leaderboard.title}
                </AppTextComponent>
                <AppTextComponent style={{ color: '#888', fontSize: 13, fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                  {infoCopy.leaderboard.subtitle}
                </AppTextComponent>
              </TouchableOpacity>

              {/* Direct workspace links — kept above Animation Lessons for fast access. */}
              <InfoWorkspaceCard
                copy={INFO_WORKSPACE_COPY[infoLanguage].animator}
                icon="📽️"
                accentColor="#4CAF50"
                onOpen={() => {
                  void Haptics.selectionAsync();
                  setInfoVisible(false);
                  setFramerWorkspaceVisible(true);
                }}
              />
              <InfoWorkspaceCard
                copy={INFO_WORKSPACE_COPY[infoLanguage].arPainting}
                icon="🧱"
                accentColor="#FF6B35"
                onOpen={() => {
                  void Haptics.selectionAsync();
                  if (openArPainting) {
                    openArPainting();
                  } else if (openAR) {
                    openAR();
                  }
                }}
              />
              <InfoWorkspaceCard
                copy={INFO_WORKSPACE_COPY[infoLanguage].vector}
                icon="🔷"
                accentColor="#00B8D4"
                onOpen={() => {
                  void Haptics.selectionAsync();
                  if (openVector) openVector();
                }}
              />

              {/* Animated Animation Lessons Panel */}
              <TouchableOpacity
                style={{
                  marginBottom: 50,
                  marginHorizontal: 18,
                  backgroundColor: '#1a1a1a',
                  borderRadius: 12,
                  padding: 20,
                  borderWidth: 1,
                  borderColor: '#9C27B0',
                  alignItems: 'center',
                }}
                onPress={openAnimationLessons}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Open Animation Lessons"
              >
                <AppTextComponent style={{ fontSize: 48, marginBottom: 12 }}>
                  {ANIMATION_LESSONS_EMOJI_FRAMES[infoAnimationLessonsFrame]}
                </AppTextComponent>
                <AppTextComponent style={{ color: '#9C27B0', fontSize: 20, fontWeight: '600', fontFamily: 'vrtlfinal', marginBottom: 6 }}>
                  {infoCopy.animationLessons.title}
                </AppTextComponent>
                <AppTextComponent style={{ color: '#888', fontSize: 13, fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                  {infoCopy.animationLessons.subtitle}
                </AppTextComponent>
              </TouchableOpacity>

              {!IS_LITE_BUILD && (
                <View onLayout={(e) => { mpSectionY.current = e.nativeEvent.layout.y; }}>
                  <MultiPaintPreviewSection
                    visible={mpVisible}
                    copy={infoCopy.multiPaint}
                    onOpen={() => {
                      void Haptics.selectionAsync();
                      setInfoVisible(false);
                      if (openMultiPaint) {
                        openMultiPaint();
                      } else {
                        navigation.navigate('MultiPaint');
                      }
                    }}
                  />
                </View>
              )}

              {/* Rate App Panel */}
              <RNAnimated.View
                onLayout={handleRateSectionLayout}
                style={rateLaunching ? rateLaunchStyle : undefined}
              >
                <TouchableOpacity
                  style={{
                    marginBottom: 20,
                    marginHorizontal: 18,
                    backgroundColor: '#1a1a1a',
                    borderRadius: 12,
                    padding: 20,
                    borderWidth: 1,
                    borderColor: '#4a9eff',
                    alignItems: 'center',
                  }}
                  onPress={handleRatePress}
                  disabled={rateLaunching}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={rateCopy.title}
                >
                  <View style={{ position: 'relative', width: '100%', minHeight: 128, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', minHeight: 38, zIndex: 2 }}>
                      {RATE_EMOJI_GLYPHS.map((glyph, index) => (
                        <RateGlyph
                          key={`rate-emoji-${glyph}-${index}`}
                          glyph={glyph}
                          index={index}
                          progress={rateGlyphProgress}
                          effect={rateGlyphEffect}
                          kind="emoji"
                        />
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', maxWidth: '100%', minHeight: 38, zIndex: 2 }}>
                      {Array.from(rateDisplayTitle).map((glyph, index) => (
                        <RateGlyph
                          key={`rate-letter-${index}`}
                          glyph={glyph}
                          index={index + RATE_EMOJI_GLYPHS.length}
                          progress={rateGlyphProgress}
                          effect={rateGlyphEffect}
                          kind="letter"
                        />
                      ))}
                    </View>
                    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 4, height: 88, zIndex: 1 }}>
                      {RATE_PARTICLE_GLYPHS.map((glyph, index) => (
                        <RateGlyph
                          key={`rate-particle-${index}`}
                          glyph={glyph}
                          index={index + 20}
                          progress={rateGlyphProgress}
                          effect={(rateGlyphEffect + index + 3) % RATE_APP_EFFECT_COUNT}
                          kind="particle"
                          containerStyle={{ left: `${8 + ((index * 17) % 84)}%`, top: (index % 4) * 18 }}
                        />
                      ))}
                    </View>
                    <RNAnimated.Text style={{ color: '#888', fontSize: 13, fontFamily: 'vrtlfinal', textAlign: 'center', marginTop: 4, opacity: rateGlyphProgress.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0.25, 1, 1, 0.35] }) }}>
                      {rateCopy.subtitle}
                    </RNAnimated.Text>
                  </View>
                </TouchableOpacity>
              </RNAnimated.View>

              <View onLayout={handleWelcomerSectionLayout}>
                <InfoWelcomerPlayer
                  infoVisible={infoVisible && !animationLessonsVisible}
                  inViewport={welcomerVisible}
                />
              </View>
            </ScrollView>
          </RNAnimated.View>

          {/* Challenge Confirm Overlay */}
          {challengeConfirmPrompt ? (
            <View style={styles.challengeConfirmOverlay} pointerEvents="auto">
              <View style={styles.challengeConfirmCard}>
                <View style={styles.challengeConfirmTitleRow}>
                  <AppTextComponent style={styles.challengeConfirmTitle}>{confirmCopy.title}</AppTextComponent>
                  {challengeConfirmEmoji ? (
                    <RNAnimated.Text style={[styles.challengeConfirmEmoji, challengeConfirmEmojiAnimatedStyle]}>
                      {challengeConfirmEmoji}
                    </RNAnimated.Text>
                  ) : null}
                </View>
                <AppTextComponent style={styles.challengeConfirmPromptLabel}>{formatPrompt(challengeConfirmPrompt, infoLanguage)}</AppTextComponent>

                {/* Mini language flags row */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginBottom: 10 }}>
                  {INFO_LANGUAGE_OPTIONS.map((option) => {
                    const active = option.id === infoLanguage;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        onPress={() => {
                          void Haptics.selectionAsync();
                          setInfoLanguage(option.id);
                          void saveLanguagePreference(option.id);
                        }}
                        style={{
                          paddingVertical: 3,
                          paddingHorizontal: 6,
                          borderRadius: 8,
                          backgroundColor: active ? 'rgba(255, 159, 107, 0.4)' : 'rgba(255,255,255,0.1)',
                          borderWidth: 1.5,
                          borderColor: active ? '#ff9f6b' : 'rgba(255,255,255,0.2)',
                        }}
                      >
                        <AppTextComponent style={{ fontSize: 14 }}>{option.flag}</AppTextComponent>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <AppTextComponent style={styles.challengeConfirmSubtitle}>{confirmCopy.subtitle}</AppTextComponent>
                <AppTextComponent style={styles.challengeConfirmWarning}>{confirmCopy.warning}</AppTextComponent>
                <AppTextComponent style={[styles.challengeConfirmHint, { color: '#ff9f6b', fontSize: 16 }]}>
                  ⏱ You have {challengeConfirmPrompt.timeMinutes ?? challengeMinutesForDay} minute{(challengeConfirmPrompt.timeMinutes ?? challengeMinutesForDay) !== 1 ? 's' : ''} to paint
                </AppTextComponent>

                {/* Notification Prompt */}
                {showNotificationPrompt && (
                  <View style={styles.notificationPrompt}>
                    <View style={styles.notificationPromptHeader}>
                      <AppTextComponent style={styles.notificationPromptIcon}>🔔</AppTextComponent>
                      <AppTextComponent style={styles.notificationPromptTitle}>Enable One Daily Topic Reminder?</AppTextComponent>
                    </View>
                    <AppTextComponent style={styles.notificationPromptMessage}>
                      Get at most one reminder per day, showing one of today's three topics. You can change this anytime in Settings.
                    </AppTextComponent>
                    <View style={styles.notificationPromptActions}>
                      <TouchableOpacity
                        style={[styles.notificationPromptButton, styles.notificationPromptSkip]}
                        onPress={handleSkipNotifications}
                      >
                        <AppTextComponent style={styles.notificationPromptSkipText}>Not Now</AppTextComponent>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.notificationPromptButton, styles.notificationPromptEnable]}
                        onPress={handleEnableNotifications}
                      >
                        <AppTextComponent style={styles.notificationPromptEnableText}>Enable</AppTextComponent>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <View style={styles.challengeConfirmActions}>
                  <TouchableOpacity
                    onPress={cancelChallengeConfirm}
                    style={[styles.challengeConfirmButton, styles.challengeConfirmCancel]}
                    accessibilityRole="button"
                    accessibilityLabel={confirmCopy.cancelLabel}
                    disabled={challengeConfirmProcessing}
                  >
                    <AppTextComponent style={styles.challengeConfirmCancelLabel}>{confirmCopy.cancelLabel}</AppTextComponent>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={confirmStartChallenge}
                    style={[styles.challengeConfirmButton, styles.challengeConfirmPrimary]}
                    accessibilityRole="button"
                    accessibilityLabel={confirmCopy.confirmLabel}
                    disabled={challengeConfirmProcessing}
                  >
                    <AppTextComponent style={styles.challengeConfirmPrimaryLabel}>{confirmCopy.confirmLabel}</AppTextComponent>
                  </TouchableOpacity>
                </View>
                <View style={styles.challengeConfirmGallery}>
                  <AppTextComponent style={styles.challengeConfirmGalleryHeading}>{confirmCopy.galleryHeading}</AppTextComponent>
                  {challengeConfirmLoading ? (
                    <ActivityIndicator color="#ff9f6b" style={styles.challengeConfirmSpinner} />
                  ) : (challengeConfirmEntries && challengeConfirmEntries.length > 0) ? (
                    <ScrollView
                      style={styles.challengeConfirmImageScroll}
                      contentContainerStyle={styles.challengeConfirmImageList}
                      showsVerticalScrollIndicator={false}
                    >
                      {challengeConfirmEntries.map((entry, index) => {
                        const animValue = challengeConfirmAnimValuesRef.current[index] ?? new RNAnimated.Value(1);
                        const opacityStyle = {
                          opacity: animValue,
                          transform: [{ scale: animValue.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
                        };
                        return (
                          <TouchableOpacity
                            key={entry.id || `${entry.imageUrl}-${index}`}
                            style={styles.challengeConfirmPreviewWrapper}
                            activeOpacity={0.85}
                            onPress={() => openChallengeConfirmPreview(entry)}
                          >
                            <RNAnimated.View style={[styles.challengeConfirmPreviewAnimated, opacityStyle]}>
                              {(() => {
                                const mediaUrl = entry.rawUrl || entry.imageUrl;
                                const isVideo = mediaUrl && (mediaUrl.toLowerCase().endsWith('.mp4') || mediaUrl.toLowerCase().endsWith('.mov'));
                                if (!mediaUrl) {
                                  return (
                                    <View style={styles.challengeConfirmPreviewPlaceholder}>
                                      <AppTextComponent style={styles.challengeConfirmPreviewPlaceholderLabel}>No media</AppTextComponent>
                                    </View>
                                  );
                                }
                                if (isVideo) {
                                  return (
                                    <Video
                                      source={{ uri: mediaUrl }}
                                      style={styles.challengeConfirmPreviewImage}
                                      resizeMode={ResizeMode.CONTAIN}
                                      shouldPlay={true}
                                      isLooping={true}
                                      isMuted={false}
                                      volume={0.3}
                                      useNativeControls={false}
                                    />
                                  );
                                }
                                return (
                                  <Image
                                    source={{ uri: mediaUrl }}
                                    style={styles.challengeConfirmPreviewImage}
                                    resizeMode="contain"
                                  />
                                );
                              })()}
                            </RNAnimated.View>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  ) : (
                    <AppTextComponent style={styles.challengeConfirmMessage}>
                      {challengeConfirmError ? confirmCopy.errorMessage : confirmCopy.emptyMessage}
                    </AppTextComponent>
                  )}
                </View>
              </View>
            </View>
          ) : null}

          {/* Animation lesson player — audio-free, timed captions, then return to Info. */}
          {animationLessonsVisible && (
            <View style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: '#000',
              zIndex: 9999,
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              <Video
                // Keep the mutable ref out of the native prop object; RN 0.81
                // freezes that object in dev and later ref cleanup can throw.
                ref={(node: any) => { animationTutorialVideoRef.current = node; }}
                source={
                  IS_IPAD
                    ? require('../../../assets/tutorial_ipad.mov')
                    : require('../../../assets/tutorial_iphone.mov')
                }
                style={{ width: '100%', height: '100%' }}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay={true}
                isLooping={false}
                useNativeControls={false}
                isMuted={true}
                volume={0}
                onPlaybackStatusUpdate={handleAnimationLessonStatus}
              />
              <TouchableOpacity
                onPress={closeAnimationLessons}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{
                  position: 'absolute',
                  top: 20,
                  right: 20,
                  zIndex: 10000,
                  width: 44,
                  height: 44,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <AppTextComponent style={{ fontSize: 32 }}>❎</AppTextComponent>
              </TouchableOpacity>
              {videoInfoBannerVisible && (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    if (videoInfoBannerTimerRef.current) clearTimeout(videoInfoBannerTimerRef.current);
                    setVideoInfoBannerVisible(false);
                  }}
                  style={{
                    position: 'absolute',
                    bottom: 112,
                    left: 24,
                    right: 24,
                    zIndex: 10000,
                    backgroundColor: 'rgba(0,0,0,0.72)',
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(255,159,107,0.45)',
                    paddingVertical: 14,
                    paddingHorizontal: 18,
                    alignItems: 'center',
                  }}
                >
                  <AppTextComponent style={{ color: '#ff9f6b', fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
                    {animationTutorialCopy.title}
                  </AppTextComponent>
                  <AppTextComponent style={{ color: '#ccc', fontSize: 13, textAlign: 'center', lineHeight: 18 }}>
                    {animationTutorialCopy.body}{'\n'}{animationTutorialCopy.dismiss}
                  </AppTextComponent>
                  <AppTextComponent style={{ color: '#555', fontSize: 11, marginTop: 8 }}>
                    Tap to dismiss this message
                  </AppTextComponent>
                </TouchableOpacity>
              )}
              {activeAnimationCueIndex >= 0 && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    bottom: 78,
                    left: 20,
                    right: 20,
                    zIndex: 10000,
                    backgroundColor: 'rgba(0,0,0,0.78)',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: 'rgba(255,159,107,0.55)',
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    alignItems: 'center',
                  }}
                >
                  <AppTextComponent style={{ color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center', lineHeight: 19 }}>
                    {animationTutorialCopy.cues[activeAnimationCueIndex]}
                  </AppTextComponent>
                </View>
              )}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  bottom: 20,
                  left: 24,
                  right: 24,
                  zIndex: 10000,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <AppTextComponent style={{ color: '#ff9f6b', fontSize: 11, fontWeight: '700' }}>
                    {animationTutorialCopy.timeline}
                  </AppTextComponent>
                  <AppTextComponent style={{ color: '#ddd', fontSize: 11 }}>
                    {formatLessonTime(animationLessonPositionMs)} / {formatLessonTime(animationLessonDurationMs)}
                  </AppTextComponent>
                </View>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' }}>
                  <View style={{ width: ((lessonProgress * 100) + '%') as `${number}%`, height: '100%', borderRadius: 3, backgroundColor: '#ff9f6b' }} />
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* ── All Over Settings Modal ── */}
      <Modal
        visible={allOverSettingsVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={closeAllOverSettings}
        supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
      >
        <View style={{ flex: 1, backgroundColor: '#111' }}>
          {/* Header bar — 50px below Dynamic Island */}
          <View style={{
            backgroundColor: '#1a1a1a',
            borderBottomWidth: 1,
            borderBottomColor: '#333',
            paddingTop: insets.top + 50,
            paddingBottom: 14,
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <AppTextComponent style={{ color: '#FF9500', fontSize: 20, fontWeight: '700', fontFamily: 'vrtlfinal', flex: 1 }}>
              {infoCopy.allOverSettings.overlayTitle}
            </AppTextComponent>
            <TouchableOpacity onPress={closeAllOverSettings} style={{ padding: 8 }}>
              <AppTextComponent style={{ fontSize: 26 }}>✳️</AppTextComponent>
            </TouchableOpacity>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ width: '100%', maxWidth: 540, alignSelf: 'center' }}>

              {/* Emoji Style — collapsible multi-set picker */}
              <View style={{ marginBottom: 14 }}>
                <TouchableOpacity
                  onPress={() => { void Haptics.selectionAsync(); setEmojiStyleOpen((o) => !o); }}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#2a2a2a', borderRadius: 10, padding: 12, borderWidth: 2, borderColor: '#333' }}
                >
                  <AppTextComponent style={{ color: '#FF9500', fontSize: 12, fontWeight: '600', fontFamily: 'vrtlfinal' }}>😀 Emoji Style</AppTextComponent>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <AppTextComponent style={{ color: '#aaa', fontSize: 11, fontFamily: 'vrtlfinal' }}>{activeEmojiSetName}</AppTextComponent>
                    <AppTextComponent style={{ color: '#888', fontSize: 12 }}>{emojiStyleOpen ? '▲' : '▼'}</AppTextComponent>
                  </View>
                </TouchableOpacity>
                {emojiStyleOpen && (
                  <View style={{ marginTop: 8, gap: 8 }}>
                    {emojiSets.map((s) => {
                      const active = s.id === activeSetId;
                      return (
                        <TouchableOpacity
                          key={s.id}
                          onPress={() => { void Haptics.selectionAsync(); setEmojiSet(s.id); }}
                          onLongPress={s.kind === 'imported' ? () => {
                            Alert.alert('Remove set?', s.name, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Remove', style: 'destructive', onPress: () => { void deleteEmojiSet(s.id); } },
                            ]);
                          } : undefined}
                          style={{ backgroundColor: '#222', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: active ? '#FF9500' : '#333', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <AppTextComponent style={{ color: active ? '#FF9500' : '#ccc', fontSize: 12, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                            {active ? '✓ ' : ''}{s.name}{s.kind === 'imported' ? ' ·imported' : ''}
                          </AppTextComponent>
                          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                            {s.preview.slice(0, 5).map((e: string) => <AppEmoji key={e} char={e} size={22} />)}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                    <TouchableOpacity
                      disabled={emojiImporting}
                      onPress={async () => {
                        void Haptics.selectionAsync();
                        setEmojiImporting(true);
                        const r = await importEmojiSet();
                        setEmojiImporting(false);
                        if (!r.ok && r.error) Alert.alert('Import failed', r.error);
                      }}
                      style={{ backgroundColor: '#222', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: '#444', borderStyle: 'dashed', alignItems: 'center' }}
                    >
                      <AppTextComponent style={{ color: '#FF9500', fontSize: 12, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                        {emojiImporting ? '⏳ Importing…' : '➕ Import emoji set (.zip)'}
                      </AppTextComponent>
                    </TouchableOpacity>
                    <AppTextComponent style={{ color: '#666', fontSize: 9, fontFamily: 'vrtlfinal', textAlign: 'center' }}>
                      Pick an EmojiKit .zip. Long-press an imported set to remove it.
                    </AppTextComponent>
                  </View>
                )}
              </View>

              {/* Connection Mode Toggle */}
              <View style={{ marginBottom: 14 }}>
                <AppTextComponent style={{ color: '#FF9500', fontSize: 12, fontWeight: '600', fontFamily: 'vrtlfinal', marginBottom: 8 }}>
                  {infoCopy.allOverSettings.offlineModeLabel}
                </AppTextComponent>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: !parentalControls.offlineMode ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      const doSwitch = async () => {
                        const next = { ...parentalControls, offlineMode: false };
                        setParentalControls(next);
                        await saveParentalControls(next);
                        void refreshGallery(galleryMode, { force: true });
                      };
                      if (parentalControls.enabled && parentalControls.offlineMode && parentalControls.setupComplete) {
                        promptForPin(doSwitch);
                      } else {
                        void doSwitch();
                      }
                    }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>🌐</AppTextComponent>
                    <AppTextComponent style={{ color: !parentalControls.offlineMode ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.offlineModeOnline}
                    </AppTextComponent>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: parentalControls.offlineMode ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={async () => {
                      void Haptics.selectionAsync();
                      const next = { ...parentalControls, offlineMode: true };
                      setParentalControls(next);
                      await saveParentalControls(next);
                      void refreshGallery(galleryMode, { force: true });
                    }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>📴</AppTextComponent>
                    <AppTextComponent style={{ color: parentalControls.offlineMode ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.offlineModeOffline}
                    </AppTextComponent>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Theme Mode Toggle */}
              <View style={{ marginBottom: 14 }}>
                <AppTextComponent style={{ color: '#FF9500', fontSize: 12, fontWeight: '600', fontFamily: 'vrtlfinal', marginBottom: 8 }}>
                  {infoCopy.allOverSettings.themeLabel}
                </AppTextComponent>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: settings.theme === 'dark' ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setTheme('dark'); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>🌙</AppTextComponent>
                    <AppTextComponent style={{ color: settings.theme === 'dark' ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.themeDark}
                    </AppTextComponent>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: settings.theme === 'light' ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setTheme('light'); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>☀️</AppTextComponent>
                    <AppTextComponent style={{ color: settings.theme === 'light' ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.themeLight}
                    </AppTextComponent>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Hand Mode Toggle */}
              <View style={{ marginBottom: 14 }}>
                <AppTextComponent style={{ color: '#FF9500', fontSize: 12, fontWeight: '600', fontFamily: 'vrtlfinal', marginBottom: 8 }}>
                  {infoCopy.allOverSettings.handModeLabel}
                </AppTextComponent>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: settings.handMode === 'right' ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setHandMode('right'); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>👉</AppTextComponent>
                    <AppTextComponent style={{ color: settings.handMode === 'right' ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.handModeRight}
                    </AppTextComponent>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: settings.handMode === 'left' ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setHandMode('left'); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>👈</AppTextComponent>
                    <AppTextComponent style={{ color: settings.handMode === 'left' ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.handModeLeft}
                    </AppTextComponent>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Brush Performance Toggle */}
              <View style={{ marginBottom: 14 }}>
                <AppTextComponent style={{ color: '#FF9500', fontSize: 12, fontWeight: '600', fontFamily: 'vrtlfinal', marginBottom: 6 }}>
                  ⚡ Brush Performance
                </AppTextComponent>
                <AppTextComponent style={{ color: '#888', fontSize: 11, fontFamily: 'vrtlfinal', marginBottom: 8, lineHeight: 15 }}>
                  Speed is snappier. Quality is smoother.
                </AppTextComponent>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: settings.brushPerformanceMode === 'speed' ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setBrushPerformanceMode('speed'); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>⚡</AppTextComponent>
                    <AppTextComponent style={{ color: settings.brushPerformanceMode === 'speed' ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      Speed
                    </AppTextComponent>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: settings.brushPerformanceMode === 'quality' ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setBrushPerformanceMode('quality'); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>✨</AppTextComponent>
                    <AppTextComponent style={{ color: settings.brushPerformanceMode === 'quality' ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      Quality
                    </AppTextComponent>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Helper Mode Toggle */}
              <View style={{ marginBottom: 14 }}>
                <AppTextComponent style={{ color: '#FF9500', fontSize: 12, fontWeight: '600', fontFamily: 'vrtlfinal', marginBottom: 8 }}>
                  {'🏷️ '}{infoCopy.allOverSettings.helperModeLabel}
                </AppTextComponent>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: settings.helperModeEnabled ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setHelperModeEnabled(true); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>✅</AppTextComponent>
                    <AppTextComponent style={{ color: settings.helperModeEnabled ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.helperModeOn}
                    </AppTextComponent>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: !settings.helperModeEnabled ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setHelperModeEnabled(false); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>🚫</AppTextComponent>
                    <AppTextComponent style={{ color: !settings.helperModeEnabled ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.helperModeOff}
                    </AppTextComponent>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Tutorial Mode Toggle */}
              <View style={{ marginBottom: 14 }}>
                <AppTextComponent style={{ color: '#FF9500', fontSize: 12, fontWeight: '600', fontFamily: 'vrtlfinal', marginBottom: 8 }}>
                  {'💡 '}{infoCopy.allOverSettings.tutorialModeLabel}
                </AppTextComponent>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: settings.tutorialModeEnabled ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setTutorialModeEnabled(true); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>✅</AppTextComponent>
                    <AppTextComponent style={{ color: settings.tutorialModeEnabled ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.tutorialModeOn}
                    </AppTextComponent>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 11, borderWidth: 2, borderColor: !settings.tutorialModeEnabled ? '#FF9500' : '#333', alignItems: 'center' }}
                    onPress={() => { void Haptics.selectionAsync(); setTutorialModeEnabled(false); }}
                  >
                    <AppTextComponent style={{ fontSize: 20, marginBottom: 5 }}>🚫</AppTextComponent>
                    <AppTextComponent style={{ color: !settings.tutorialModeEnabled ? '#FF9500' : '#888', fontSize: 11, fontWeight: '600', fontFamily: 'vrtlfinal' }}>
                      {infoCopy.allOverSettings.tutorialModeOff}
                    </AppTextComponent>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Notifications Section */}
              <View style={{ marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 16 }}>
                <AppTextComponent style={{ color: '#ff9f6b', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                  🔔  Notifications
                </AppTextComponent>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  backgroundColor: notificationsEnabled ? 'rgba(255,159,107,0.08)' : 'rgba(255,255,255,0.05)',
                  borderWidth: 1,
                  borderColor: notificationsEnabled ? 'rgba(255,159,107,0.35)' : 'rgba(255,255,255,0.1)',
                  borderRadius: 12,
                  padding: 13,
                }}>
                  <AppTextComponent style={{ fontSize: 22 }}>🔔</AppTextComponent>
                  <View style={{ flex: 1 }}>
                    <AppTextComponent style={{ color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'vrtlfinal' }}>
                      Daily Challenge Alerts
                    </AppTextComponent>
                    <AppTextComponent style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
                      {notificationsEnabled ? 'At most one topic reminder per day' : 'Tap to enable one daily reminder'}
                    </AppTextComponent>
                  </View>
                  <Switch
                    value={notificationsEnabled}
                    onValueChange={async (val) => {
                      void Haptics.selectionAsync();
                      if (val) {
                        const enabled = await notificationService.requestPermissionsAndEnable();
                        setNotificationsEnabled(enabled);
                      } else {
                        await notificationService.disable();
                        setNotificationsEnabled(false);
                      }
                    }}
                    trackColor={{ false: '#333', true: 'rgba(255,159,107,0.6)' }}
                    thumbColor={notificationsEnabled ? '#ff9f6b' : '#666'}
                  />
                </View>
              </View>

              {/* Parental Controls Section */}
              <View style={{ marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 16 }}>
                <AppTextComponent style={{ color: '#0ff', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                  🛡️  {infoCopy.allOverSettings.parentalControlsLabel}
                </AppTextComponent>
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    backgroundColor: parentalControls.enabled ? 'rgba(0,255,255,0.08)' : 'rgba(255,255,255,0.05)',
                    borderWidth: 1,
                    borderColor: parentalControls.enabled ? 'rgba(0,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                    borderRadius: 12,
                    padding: 13,
                  }}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setAllOverSettingsVisible(false);
                    setTimeout(() => setParentalControlsVisible(true), 350);
                  }}
                  activeOpacity={0.75}
                >
                  <AppTextComponent style={{ fontSize: 22 }}>🛡️</AppTextComponent>
                  <View style={{ flex: 1 }}>
                    <AppTextComponent style={{ color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'vrtlfinal' }}>
                      {parentalControls.enabled ? (parentalControls.offlineMode ? '📴 Offline Mode Active' : '✅ Controls Active') : 'Set Up Controls'}
                    </AppTextComponent>
                    <AppTextComponent style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
                      {parentalControls.enabled
                        ? 'Time limits, offline mode, feature restrictions'
                        : 'PIN-protected settings for kids'}
                    </AppTextComponent>
                  </View>
                  <AppTextComponent style={{ color: '#0ff', fontSize: 16 }}>›</AppTextComponent>
                </TouchableOpacity>
              </View>

            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
};

export default React.memo(InfoPanelOverlay);
