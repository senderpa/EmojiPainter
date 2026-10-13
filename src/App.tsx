import 'react-native-gesture-handler';
import 'react-native-reanimated';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, TextInput, Animated as RNAnimated, AppState, InteractionManager, Platform } from 'react-native';
import { AppText as Text } from './emoji/AppText';
import Reanimated from 'react-native-reanimated';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import './theme/fontConfig';
import { AppSettingsProvider } from './context/AppSettingsContext';
import { BASE_FONT_FAMILY, FONT_ASSETS, normalizeTextStyleProp } from './theme/fontConfig';
import { TutorialProvider } from './tutorial/TutorialContext';
import { EmojiSetProvider } from './emoji/EmojiSetContext';
import { RevealProvider } from './emoji/RevealContext';
import TutorialOverlay from './tutorial/TutorialOverlay';
// [SHOWCASE-CAPTURE] temporary content-capture tool — remove this block + the
// <GuidedCaptureProvider>/<GuidedCaptureOverlay> usages + src/capture/ to delete it.
import { GuidedCaptureProvider } from './capture/GuidedCaptureContext';
import { GuidedCaptureOverlay } from './capture/GuidedCaptureOverlay';
import { isNativeRenderingAvailable } from './native';
import { featureFlags } from './config/features';
import { logNativeHealth } from './dev/healthCheck';
import { checkAndUpdateTopics } from './lib/topicsUpdater';
import { emitAppEvent } from './lib/appEvents';
import { initCrashReporting, setUserContext } from './lib/crashReporting';
import { getOrCreateDailyDeviceId } from './lib/dailyDeviceId';
import { hasAcceptedAgb, readAgbAcceptanceState } from './lib/profileTermsConsent';
import { PROFILE_FIRST_LAUNCH_SETUP_KEY } from './lib/profileSync';
import { validateAndCleanStorage } from './video/videoStorage';
import { cleanStaleStorage } from './lib/storageCleanup';
import { notificationService } from './services/notificationService';
import ErrorBoundary from './components/ErrorBoundary';
import type { NavigationContainerRef } from '@react-navigation/native';

type PaintScreenComponent = typeof import('./screens/PaintScreen').default;
type TimelapseScreenComponent = typeof import('./screens/TimelapseScreen').default;
type ExportScreenComponent = typeof import('./screens/ExportScreen').default;
type MultiPaintScreenComponent = typeof import('./multiplayer/MultiPaintScreen').default;
type VideoStorageScreenComponent = typeof import('./video/VideoStorageScreen').default;
type VideoEditorScreenComponent = typeof import('./video/VideoEditorScreen').default;
type VideoPreviewScreenComponent = typeof import('./video/VideoPreviewScreen').default;
type SettingsScreenComponent = typeof import('./screens/SettingsScreen').default;
// type FrameByFrameScreenComponent = typeof import('./animation/FrameByFrameScreen').default; // Integrated into PaintScreen now
type PaintingProviderComponent = typeof import('./state/PaintingContext').PaintingProvider;
type UsePaintingHook = typeof import('./state/PaintingContext').usePainting;
type WordingProviderComponent = typeof import('./wording/WordingContext').WordingProvider;
type StartupOverlayComponent = typeof import('./features/onboarding/CinematicIntro').default;
type FirstLaunchProfileSetupComponent = typeof import('./features/onboarding/FirstLaunchProfileSetup').default;
type IconBurstOverlayComponent = typeof import('./components/IconBurstOverlay').default;
type ExportCompleteOverlayComponent = typeof import('./components/ExportCompleteOverlay').default;

// Lite build flag controls runtime navigation. metro.config.js additionally
// resolves full-only modules to an inert component so they are absent from the
// Lite bundle.
const IS_LITE_BUILD = process.env.EXPO_PUBLIC_LITE_BUILD === '1';

const PaintScreen = require('./screens/PaintScreen').default as PaintScreenComponent;
const TimelapseScreen = require('./screens/TimelapseScreen').default as TimelapseScreenComponent;
const ExportScreen = require('./screens/ExportScreen').default as ExportScreenComponent;
// MultiPaint is excluded from the lite (App-Store-safe) build: entry buttons
// are already hidden (info panel + AR chooser), and this keeps the code out of
// the bundle entirely.
const MultiPaintScreen = (IS_LITE_BUILD
  ? () => null
  : require('./multiplayer/MultiPaintScreen').default) as MultiPaintScreenComponent;
const VideoStorageScreen = require('./video/VideoStorageScreen').default as VideoStorageScreenComponent;
const VideoEditorScreen = require('./video/VideoEditorScreen').default as VideoEditorScreenComponent;
const VideoPreviewScreen = require('./video/VideoPreviewScreen').default as VideoPreviewScreenComponent;
const SettingsScreen = require('./screens/SettingsScreen').default as SettingsScreenComponent;
const ProfilePage = require('./social/ProfilePage').default as React.ComponentType<any>;
const ProfileStudioScreen = require('./screens/ProfileStudioScreen').default as React.ComponentType<any>;
const WorldPage = require('./social/WorldPage').default as React.ComponentType<any>;
const FollowListPage = require('./social/FollowListPage').default as React.ComponentType<any>;
// const FrameByFrameScreen = require('./animation/FrameByFrameScreen').default as FrameByFrameScreenComponent; // Integrated into PaintScreen now
const { PaintingProvider, usePainting } = require('./state/PaintingContext') as {
  PaintingProvider: PaintingProviderComponent;
  usePainting: UsePaintingHook;
};
const { WordingProvider } = require('./wording/WordingContext') as {
  WordingProvider: WordingProviderComponent;
};
const StartupOverlay = require('./features/onboarding/CinematicIntro').default as StartupOverlayComponent;
const FirstLaunchProfileSetup = require('./features/onboarding/FirstLaunchProfileSetup').default as FirstLaunchProfileSetupComponent;
const IconBurstOverlay = require('./components/IconBurstOverlay').default as IconBurstOverlayComponent;
const ExportCompleteOverlay = require('./components/ExportCompleteOverlay').default as ExportCompleteOverlayComponent;
const RateAppOverlay = require('./components/RateAppOverlay').default;
const CustomOverlay = require('./components/CustomOverlay').default;
const { CustomOverlayHelper } = require('./components/CustomOverlay');

export type RootStackParamList = {
  Paint: {
    startWording?: boolean;
    wordingVideoPath?: string;
    wordingLetterIndex?: number;
    openFramer?: boolean; // Open Framer workspace on load
    framerAutoImportVideoUri?: string; // Auto-import video in Framer
    framerAutoImportVideoDuration?: number; // Video duration in ms
    openGallery?: boolean; // Auto-open gallery (e.g., after Framer upload)
    openInfoOverlay?: boolean; // Auto-open info overlay (e.g., from notification)
    openPassport?: boolean; // Legacy auto-open passport / Private Studio editor
    openProfileStudio?: boolean; // Auto-open the private Profil Studio workspace from ProfilePage
    openLeaderboard?: boolean; // Auto-open the in-screen profile leaderboard overlay (e.g., from ProfilePage menu)
    openCoinShop?: boolean; // Auto-open coin workshop overlay (e.g., from ProfilePage coin tile)
    openAR?: boolean; // Auto-open AR chooser (e.g., from ProfilePage or overlay nav buttons)
    openFaceFilter?: boolean; // Jump straight to Face Filter AR mode
    openArPainting?: boolean; // Jump straight to AR Painting mode
    openAnimator?: boolean; // Jump straight to Animator / Framer workspace
    openVector?: boolean; // Jump straight to the Vector workspace
    returnToProfile?: string; // deviceId — after closing the opened overlay, return to that ProfilePage
    profileStudioReturnTo?: string; // deviceId — return target for the private Profil Studio workspace
    profileStudioNonce?: number; // Force Private Studio open when navigating to an existing Paint route
  }; // Can start in wording mode, receive exported video, or open Framer with video
  Timelapse: {
    autoExport?: boolean; // Auto-trigger export
    wordingMode?: boolean; // Return to wording after export
    wordingLetterIndex?: number; // Which letter is being exported
    wordingStrokes?: any[]; // Strokes to load for wording mode (passed directly to avoid context race conditions)
    autoImportVideoUri?: string; // Auto-import video from URI
    autoImportVideoDuration?: number; // Duration in milliseconds
  };
  Export: undefined;
  MultiPaint: undefined;
  VideoStorage: undefined;
  VideoEditor: { initialVideoId?: string; initialVideoIds?: string[] };
  VideoPreview: { uri: string; filename: string };
  Settings: undefined;
  // Social rework (MySpace-style profile + world)
  ProfilePage: { deviceId: string; name?: string; portrait?: string | null; rank?: number; fromZoom?: boolean; playPortraitAnim?: boolean; profileUploadToken?: string };
  // Standalone Profil Studio (paint the passport) — pushed from ProfilePage,
  // fully independent from the Paint screen.
  ProfileStudio: { deviceId: string; seedPortrait?: string | null; seedName?: string | null };
  WorldPage: undefined;
  FollowListPage: { deviceId: string; which: 'followers' | 'following'; name?: string };
  // FrameByFrame: undefined; // Frame-by-frame animation now integrated directly into PaintScreen
};

const Stack = createNativeStackNavigator<RootStackParamList>();

type AppShellProps = {
  showIntro: boolean;
  onIntroFinish: () => void;
  showProfileSetup: boolean;
  onProfileSetupFinish: () => void;
  /** Re-raise the AGB gate (last-resort workspace guard — see below). */
  onAgbMissing: () => void;
};

const AppShell: React.FC<AppShellProps> = ({ showIntro, onIntroFinish, showProfileSetup, onProfileSetupFinish, onAgbMissing }) => {
  const { autosaveOverlayPending, showAutosaveOverlay } = usePainting();
  const { colors, settings } = require('./context/AppSettingsContext').useAppSettings();
  const [showRatingOverlay, setShowRatingOverlay] = useState(false);
  const { markUserRated, markRatingShown, shouldShowRatingOverlay } = require('./lib/ratingTracker');
  const { addRatingCheckListener } = require('./lib/ratingEvents');
  const ratingCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customOverlayRef = React.useRef(null);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  // Initialize CustomOverlay helper with ref
  useEffect(() => {
    if (customOverlayRef.current) {
      CustomOverlayHelper.setInstance(customOverlayRef.current);
      console.log('[App] CustomOverlay initialized');
    }
  }, []);


  // Handle notification taps
  useEffect(() => {
    const subscription = notificationService.addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data;
      console.log('[App] Notification tapped:', data);

      if (data.action === 'open_topic_challenge') {
        // Navigate to Paint screen and open info overlay
        if (navigationRef.current?.isReady()) {
          navigationRef.current.navigate('Paint', { openInfoOverlay: true });
          console.log('[App] Navigated to Paint with info overlay');
        }
      } else if (data.action === 'gallery_votes_changed') {
        if (navigationRef.current?.isReady()) {
          navigationRef.current.navigate('Paint', { openGallery: true });
          console.log('[App] Navigated to the gallery for a vote update');
        }
      } else if (data.action === 'open_profile_level') {
        void (async () => {
          const deviceId = await getOrCreateDailyDeviceId();
          if (navigationRef.current?.isReady()) {
            navigationRef.current.navigate('ProfilePage', { deviceId });
          }
        })();
      }
    });

    return () => subscription.remove();
  }, []);

  // Listen for rating check triggers
  useEffect(() => {
    const unsubscribe = addRatingCheckListener(async (options?: { delayMs?: number }) => {
      if (showIntro || showProfileSetup || showRatingOverlay) {
        return; // Don't show during intro or if already showing
      }

      if (ratingCheckTimeoutRef.current) {
        clearTimeout(ratingCheckTimeoutRef.current);
      }

      // Keep the delay cancellable so repeated milestones or navigation do not
      // leave a stale prompt scheduled over a later screen.
      const delayMs = Math.max(0, options?.delayMs ?? 1500);
      ratingCheckTimeoutRef.current = setTimeout(async () => {
        ratingCheckTimeoutRef.current = null;
        if (showIntro || showProfileSetup || showRatingOverlay) return;

        const { show, reason } = await shouldShowRatingOverlay();
        console.log('[App] Rating check:', show ? `Show - ${reason}` : `Hide - ${reason}`);
        if (show) setShowRatingOverlay(true);
      }, delayMs);
    });

    return () => {
      unsubscribe();
      if (ratingCheckTimeoutRef.current) {
        clearTimeout(ratingCheckTimeoutRef.current);
        ratingCheckTimeoutRef.current = null;
      }
    };
  }, [showIntro, showProfileSetup, showRatingOverlay, shouldShowRatingOverlay]);

  useEffect(() => {
    if (showIntro || showProfileSetup || !autosaveOverlayPending) {
      return;
    }
    const timeout = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        showAutosaveOverlay();
      });
    }, 320);
    return () => clearTimeout(timeout);
  }, [autosaveOverlayPending, showAutosaveOverlay, showIntro, showProfileSetup]);

  // LAST-RESORT AGB GUARD.
  //
  // The front-door check in App() is the primary gate, but it reads storage once
  // at cold start and can be wrong: the 3s safety valve below can resolve before
  // storage answers, storage can be cleared while the app is running, and any
  // future entry point could in principle skip the check. This effect runs when
  // the workspace is actually on screen — AppShell only renders past the gate —
  // and again every time the app returns to the foreground, so a user who
  // reached the main workspace without a valid acceptance is sent straight back.
  //
  // It re-gates ONLY on a definitive 'missing'. A storage error reports
  // 'unavailable' and is ignored here on purpose: someone who already got
  // through the front door must not be yanked out mid-session by a transient
  // read failure.
  useEffect(() => {
    if (showIntro || showProfileSetup) return undefined;
    let cancelled = false;

    const verify = () => {
      void readAgbAcceptanceState().then((state) => {
        if (cancelled || state !== 'missing') return;
        console.warn('[AGB] Workspace reached without acceptance — re-raising the gate');
        onAgbMissing();
      });
    };

    verify();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') verify();
    });
    return () => { cancelled = true; sub.remove(); };
  }, [onAgbMissing, showIntro, showProfileSetup]);

  // AGB GATE — hard stop before the rest of the app exists.
  //
  // The intro used to render as an overlay ON TOP of a live NavigationContainer,
  // which meant PaintScreen (and its Welcome overlay, gallery, topics, AR…) was
  // already mounted and running behind it. The single AGB checkpoint has to be
  // the only thing on screen, so the navigator is not mounted at all until the
  // user accepts — there is nothing to navigate around, and nothing to race.
  // `showIntro` is false only when a valid acceptance exists on disk, so killing
  // the app here brings the user straight back to this screen.
  if (showIntro) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <StatusBar hidden />
            <StartupOverlay onFinish={onIntroFinish} />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // FIRST-LAUNCH PROFILE GATE — runs after AGB acceptance but before the main
  // navigator mounts. This ordering prevents PaintScreen's independent stats
  // loader from racing a recovered server profile back to zero.
  if (showProfileSetup) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <StatusBar hidden />
            <FirstLaunchProfileSetup onFinish={onProfileSetupFinish} />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <TutorialProvider>
    <EmojiSetProvider>
    <RevealProvider>
    <GuidedCaptureProvider>{/* [SHOWCASE-CAPTURE] remove later */}
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <WordingProvider>
          <View style={{ flex: 1 }}>
            <NavigationContainer ref={navigationRef}>
              <StatusBar hidden />
              <Stack.Navigator
                initialRouteName="Paint"
                screenOptions={{
                  headerStyle: { backgroundColor: colors.surfaceAlt },
                  headerTintColor: colors.text,
                  contentStyle: { backgroundColor: colors.background }
                }}
              >
              <Stack.Screen name="Paint" component={PaintScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Timelapse" component={TimelapseScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Export" component={ExportScreen} options={{ headerShown: false }} />
              {!IS_LITE_BUILD && (
                <Stack.Screen name="MultiPaint" component={MultiPaintScreen} options={{ headerShown: false }} />
              )}
              <Stack.Screen name="VideoStorage" component={VideoStorageScreen} options={{ headerShown: false }} />
              <Stack.Screen name="VideoEditor" component={VideoEditorScreen} options={{ headerShown: false }} />
              <Stack.Screen name="VideoPreview" component={VideoPreviewScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
              <Stack.Screen name="ProfilePage" component={ProfilePage} options={({ route }) => ({ headerShown: false, animation: (route.params as any)?.fromZoom ? 'none' : 'default' })} />
              <Stack.Screen name="ProfileStudio" component={ProfileStudioScreen} options={{ headerShown: false }} />
              <Stack.Screen name="WorldPage" component={WorldPage} options={{ headerShown: false }} />
              <Stack.Screen name="FollowListPage" component={FollowListPage} options={{ headerShown: false }} />
              {/* <Stack.Screen name="FrameByFrame" component={FrameByFrameScreen} options={{ headerShown: false }} /> */}
            </Stack.Navigator>
          </NavigationContainer>
          <ExportCompleteOverlay />
          <RateAppOverlay
            visible={showRatingOverlay}
            onDismiss={() => {
              setShowRatingOverlay(false);
              markRatingShown();
            }}
            onRate={() => {
              setShowRatingOverlay(false);
              markUserRated();
            }}
          />
          <IconBurstOverlay />
          <CustomOverlay ref={customOverlayRef} />
          <TutorialOverlay tutorialModeEnabled={settings.tutorialModeEnabled} />
          <GuidedCaptureOverlay />{/* [SHOWCASE-CAPTURE] remove later */}
          </View>
        </WordingProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </GuidedCaptureProvider>
    </RevealProvider>
    </EmojiSetProvider>
    </TutorialProvider>
  );
};

export default function App(): React.JSX.Element | null {
  // Initialise crash reporting before any hooks so it captures the earliest errors
  initCrashReporting();

  // Attach device ID to every Sentry event as soon as it is available
  useEffect(() => {
    const attachDeviceId = async () => {
      try {
        const deviceId = await getOrCreateDailyDeviceId();
        setUserContext(deviceId);
      } catch (err) {
        console.error('[App] Failed to attach device ID to crash reporter:', err);
      }
    };
    attachDeviceId();
  }, []);

  // Dev-only native health check
  useEffect(() => { logNativeHealth(); }, []);

  // Mirror the live gallery into Documents/LiveGallery on launch (throttled to
  // ~30 min inside; fire-and-forget so it never blocks or crashes startup).
  useEffect(() => {
    const t = setTimeout(() => {
      import('./lib/liveGallery/liveGalleryMirror')
        .then(({ syncLiveGalleryFromServer }) =>
          syncLiveGalleryFromServer({ nowMs: Date.now() })
        )
        .catch((e) => console.warn('[LiveGallery] startup sync skipped:', e));
    }, 4000); // let the app settle first
    return () => clearTimeout(t);
  }, []);

  // Cleanup stale video storage data on app start
  useEffect(() => {
    // CRITICAL: Clear bad video editor session that's causing crashes
    const cleanupSession = async () => {
      try {
        const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
        await AsyncStorage.removeItem('@video_editor_active_session');
        console.log('[App] ✅ Cleared stale video editor session');
      } catch (err) {
        console.error('[App] ❌ Failed to clear session:', err);
        // Don't crash - this is non-critical cleanup
      }
    };

    const cleanupStorage = async () => {
      try {
        await validateAndCleanStorage();
      } catch (error) {
        console.error('[App] Storage cleanup failed:', error);
        // Don't crash - app can continue without cleanup
      }
    };

    cleanupSession();
    cleanupStorage();
    void cleanStaleStorage();
  }, []);

  // Check for topics updates on app start — emit topics:ready when done so PaintScreen
  // can refresh immediately regardless of whether startup animation has finished yet
  useEffect(() => {
    const updateTopics = async () => {
      try {
        await checkAndUpdateTopics();
      } catch (error) {
        console.log('[App] Topics update check failed:', error);
      }
      // Always emit — even "no change" means stored topics are confirmed fresh
      emitAppEvent('topics:ready');
    };
    updateTopics();
  }, []);

  // Initialize notifications on app start
  useEffect(() => {
    const initNotifications = async () => {
      try {
        await notificationService.initialize();
      } catch (error) {
        console.log('[App] Notifications initialization failed:', error);
        // Don't crash - app can continue without notifications
      }
    };
    initNotifications();
  }, []);

  // Set orientation based on device type
  useEffect(() => {
    const setOrientation = async () => {
      try {
        const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

        if (IS_IPAD) {
          // iPad: Allow all orientations
          await ScreenOrientation.unlockAsync();
          console.log('[App] Orientation: iPad detected - all orientations allowed');
        } else {
          // Mobile: Lock to portrait only
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
          console.log('[App] Orientation: Mobile detected - locked to portrait');
        }
      } catch (error) {
        console.error('[App] Failed to set orientation:', error);
        // Don't crash - app can continue with default orientation
      }
    };

    setOrientation();
  }, []);

  const [showIntro, setShowIntro] = useState(false);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [introReady, setIntroReady] = useState(false);
  const profileSetupAfterIntroRef = useRef(false);
  // Stable identities: the workspace AGB guard keys an effect off onAgbMissing,
  // so an inline arrow would re-run the check and re-subscribe on every render.
  const handleIntroFinish = useCallback(() => {
    setShowIntro(false);
    if (profileSetupAfterIntroRef.current) {
      profileSetupAfterIntroRef.current = false;
      setShowProfileSetup(true);
    }
  }, []);
  const handleProfileSetupFinish = useCallback(() => setShowProfileSetup(false), []);
  const handleAgbMissing = useCallback(() => {
    profileSetupAfterIntroRef.current = false;
    setShowIntro(true);
  }, []);
  useEffect(() => {
    // The intro is now the AGB gate, so it is driven by acceptance — NOT by
    // FIRST_TIME_USER_KEY, which only tracks whether the Welcome page has been
    // seen. hasAcceptedAgb() also migrates any older recorded acceptance, so
    // existing users who already agreed are not sent through it again.
    Promise.all([
      hasAcceptedAgb(),
      AsyncStorage.getItem(PROFILE_FIRST_LAUNCH_SETUP_KEY),
    ])
      .then(([accepted, profileSetup]) => {
        const needsProfileSetup = profileSetup !== 'done';
        profileSetupAfterIntroRef.current = needsProfileSetup;
        setShowIntro(!accepted);
        setShowProfileSetup(accepted && needsProfileSetup);
      })
      .catch(() => {
        profileSetupAfterIntroRef.current = true;
        setShowProfileSetup(false);
        setShowIntro(true);
      })
      .finally(() => setIntroReady(true));
  }, []);

  // Safety valve, same reason as the font timeout below: `introReady` gates the WHOLE app, and it is
  // only ever set from an AsyncStorage promise. If that promise never settles (native module not
  // ready in a Release/Hermes build) the app stays permanently black. Never block longer than 3s.
  //
  // It resolves FAIL-CLOSED (show the AGB gate) rather than fail-open, because a slow storage module
  // must never wave an un-consented user into the app. This is self-correcting: if the read settles
  // later, the .then above flips `showIntro` back off for anyone who had already accepted.
  useEffect(() => {
    if (introReady) return;
    const t = setTimeout(() => { setShowIntro(true); setIntroReady(true); }, 3000);
    return () => clearTimeout(t);
  }, [introReady]);
  const FONT_FAMILY = BASE_FONT_FAMILY;
  const [fontsLoaded] = useFonts(FONT_ASSETS);
  const [fontTimeout, setFontTimeout] = useState(false);

  // Safety valve: if fonts haven't loaded after 3s (Release build silent failure),
  // proceed anyway so the app doesn't stay permanently black
  useEffect(() => {
    if (fontsLoaded) return;
    const t = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(t);
  }, [fontsLoaded]);

  useEffect(() => {
    if (!fontsLoaded) {
      return;
    }

    const applyDefaultFont = (component: any) => {
      const defaults = component?.defaultProps ?? {};
      const style = defaults.style;
      const existingStyles = Array.isArray(style)
        ? style
        : style
          ? [style]
          : [];
      const normalizedStyles = existingStyles.map((entry) => normalizeTextStyleProp(entry));
      const alreadySet = normalizedStyles.some(
        (entry: any) => entry && entry.fontFamily === FONT_FAMILY
      );
      if (!alreadySet) {
        component.defaultProps = {
          ...defaults,
          style: [...normalizedStyles, normalizeTextStyleProp({ fontFamily: FONT_FAMILY })]
        };
      }
    };

    applyDefaultFont(Text);
    applyDefaultFont(TextInput);
    if (RNAnimated?.Text) {
      applyDefaultFont(RNAnimated.Text);
    }
    if (Reanimated?.Text) {
      applyDefaultFont(Reanimated.Text);
    }
  }, [fontsLoaded]);

  // Initialize Metal rendering detection
  useEffect(() => {
    if (Platform.OS === 'ios') {
      const checkMetal = async () => {
        const metalAvailable = isNativeRenderingAvailable();
        if (metalAvailable) {
          console.log('✅ Metal rendering available');
          // Enable Metal export by default (canvas rendering remains Skia by default)
          featureFlags.setFlag('useMetalExport', true);
          console.log('🚀 Metal-accelerated export enabled');
        } else {
          console.log('⚠️ Metal rendering not available');
        }
      };

      checkMetal();
    }
  }, []);

  if ((!fontsLoaded && !fontTimeout) || !introReady) {
    return null;
  }

  return (
    <ErrorBoundary>
      <AppSettingsProvider>
        <PaintingProvider>
          <AppShell
            showIntro={showIntro}
            onIntroFinish={handleIntroFinish}
            showProfileSetup={showProfileSetup}
            onProfileSetupFinish={handleProfileSetupFinish}
            onAgbMissing={handleAgbMissing}
          />
        </PaintingProvider>
      </AppSettingsProvider>
    </ErrorBoundary>
  );
}
