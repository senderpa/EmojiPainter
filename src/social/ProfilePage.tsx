/**
 * ProfilePage — a big, scrollable, Facebook/diary-style profile for anyone. The
 * page IS a single virtualized timeline feed: cover + identity header, a recent-
 * art rail, an "Intro" card, an owner composer, then a feed of posts of all kinds
 * (art uploads with image + ♥ votes, diary entries, profile changes), newest
 * first. Owners can edit their profile (logged as a post) and add diary entries.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, FlatList, Image, Linking, Modal, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import * as MailComposer from 'expo-mail-composer';
import Constants from 'expo-constants';
import { StackActions } from '@react-navigation/native';
import { AppText as Text } from '../emoji/AppText';

// Animated FlatList so the banner can parallax/dolly off the native scroll offset (60fps, off the JS thread).
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);
import { formatElapsedTime, PROFILE_LEVEL_XP_WEIGHTS, type ProfileLevelProgress, resolveProfileLevelProgress } from '../lib/profileStats';
import { shortDate } from './timeAgo';
import { useProfileData, patchProfileCache } from './useProfileData';
import { useTimeline } from './useTimeline';
import { saveProfile, getOrCreateDailyDeviceId } from './socialApi';
import { clearDeletedProfileLocally, deleteProfileRemotely } from '../lib/profileDeletion';
import PortraitAvatar from './components/PortraitAvatar';
import StatTile from './components/StatTile';
import FollowButton from './components/FollowButton';
import FollowCountsRow from './components/FollowCountsRow';
import ProfileArtStrip from './components/ProfileArtStrip';
import ProfileIntroCard from './components/ProfileIntroCard';
import ProfileBanner from './components/ProfileBanner';
import ProfileNavBar, { type NavBarAction } from './components/ProfileNavBar';
import DiaryComposer from './components/DiaryComposer';
import PostCard from './components/PostCard';
import ProfileEditPanel from './components/ProfileEditPanel';
import AnimatedLevelEmoji from './components/AnimatedLevelEmoji';
import LevelEmojiGalleryModal from './components/LevelEmojiGalleryModal';
import LevelUpTasksModal from './components/LevelUpTasksModal';
import type { DailyPaintGalleryEntry } from '../lib/dailyPaintGallery';
import type { FollowList, TimelineEvent } from './types';
import { loadPassportSnapshots } from '../lib/privateStudio';
import { buildPortraitTransitionFrames } from '../screens/profileStudioSession';
import {
  getProfileLevelEmojiFallbackSource,
  getProfileLevelEmojiSource,
} from '../lib/profileLevelEmojiAssets';
import { loadProfileLevelAchievementState, type ProfileLevelAchievementState } from '../lib/profileLevelAchievements';
import { markLocalLevelStreakThreeDayNotified, updateLocalLevelStreak, type LocalLevelStreak } from '../lib/localLevelStreak';
import { notificationService } from '../services/notificationService';
import ArModeChooser from '../ar/ArModeChooser';
import { COIN_PAGE_ENABLED } from '../config/buildVariant';

const IS_LITE_BUILD = !COIN_PAGE_ENABLED;
const LEVEL_HINT_ROTATE_MS = 33000;

/** Short, stable handle derived from the device id. */
function handleOf(deviceId: string): string {
  const clean = (deviceId || '').replace(/[^a-zA-Z0-9]/g, '');
  return clean ? `@${clean.slice(0, 10)}` : '@anon';
}

const AVATAR_SIZE = 180;

const plural = (value: number, unit: string): string =>
  `${value.toLocaleString()} ${unit}${value === 1 ? '' : 's'}`;

const levelRequirementOptions = (progress: ProfileLevelProgress) => {
  const remaining = Math.max(0, progress.xpToNext);
  return {
    coins: Math.max(1, Math.ceil(remaining / PROFILE_LEVEL_XP_WEIGHTS.coin)),
    minutes: Math.max(1, Math.ceil(remaining / PROFILE_LEVEL_XP_WEIGHTS.paintingMinute)),
    strokes: Math.max(1, Math.ceil(remaining / PROFILE_LEVEL_XP_WEIGHTS.stroke)),
  };
};

const formatLevelInfoSummary = (progress: ProfileLevelProgress): string => {
  if (!progress.nextLevel) return 'Level 99 reached. Hidden egg hint can unlock Level 100.';
  if (progress.streakDaysToNext > 0 && progress.xpToNext <= 0) {
    return `Next: ${plural(progress.streakDaysToNext, 'daily streak day')} to Level ${progress.nextLevel.id}.`;
  }
  const options = levelRequirementOptions(progress);
  return `Next: ${plural(options.coins, 'coin')} or ${plural(options.minutes, 'painting minute')} or ${plural(options.strokes, 'stroke')} to Level ${progress.nextLevel.id}.`;
};

const buildLevelInfoHints = (
  progress: ProfileLevelProgress,
  pendingTips: string[],
): string[] => {
  if (!progress.nextLevel) {
    return ['Info: Level 99 reached. Find the hidden egg in the app for the final secret.'];
  }
  if (progress.streakDaysToNext > 0 && progress.xpToNext <= 0) {
    return [
      `Info: Keep your daily streak for ${plural(progress.streakDaysToNext, 'more day')} to unlock Level ${progress.nextLevel.id}.`,
      'Info: Open the app and paint each day; streak gates matter at higher levels.',
      'Info: Daily Challenge keeps your streak moving and can also earn coins.',
    ];
  }
  const options = levelRequirementOptions(progress);
  const hints = [
    `Info: ${plural(options.strokes, 'more stroke')} can reach Level ${progress.nextLevel.id}.`,
    `Info: Paint ${plural(options.minutes, 'more minute')} to reach Level ${progress.nextLevel.id}.`,
    `Info: Earn ${plural(options.coins, 'more coin')} to reach Level ${progress.nextLevel.id}.`,
    'Info: Do the Daily Challenge to earn more coins and keep your streak alive.',
    'Info: Try a Mystery Challenge; correct guesses and uploads can push your level faster.',
    ...(process.env.EXPO_PUBLIC_LITE_BUILD === '1'
      ? []
      : ['Info: Play MultiPaint to earn karma and coins while building toward the next level.']),
    'Info: Upload finished paintings to the gallery for coins and one-time bonus tasks.',
    'Info: Paint in AR or Animator when you want bonus tasks beyond coins, time, and strokes.',
    ...pendingTips.map((tip) => `Info: ${tip}`),
    'Info: Open the folder to see bonus tasks that can add one full level.',
  ];
  if (progress.streakDaysToNext > 0) {
    hints.push(`Info: Keep ${plural(progress.streakDaysToNext, 'more streak day')} for the next streak gate.`);
  }
  return hints;
};

// React Navigation 7: `navigate('Paint')` from here PUSHES A SECOND Paint
// instance (it no longer pops back to an existing screen — that behavior moved
// to `popTo`). A duplicate Paint remounts the whole screen, re-runs startup/
// autosave recovery, and strands the user on a fresh main canvas. So EVERY
// ProfilePage → Paint hop MUST use popTo: it returns to the one real, already
// mounted Paint screen and merges the params so its route-param effects fire.
const popToPaint = (navigation: any, params: Record<string, unknown>) => {
  navigation.dispatch(StackActions.popTo('Paint', params, { merge: true }));
};

// Open the Profil Studio: its OWN screen pushed directly on top of this
// profile page (src/screens/ProfileStudioScreen.tsx). Zero PaintScreen
// involvement — the studio loads the last portrait from local storage, and
// upload/close pop straight back here.
// The studio keeps its own local state, but a device that never painted this
// profile (a second device — the profile came down from the server) has none of
// those local keys and would open a blank "new" profile. Hand it what this page
// already fetched so it can seed itself.
const openPaintWithProfileStudio = (
  navigation: any,
  deviceId: string,
  seed?: { portrait?: string | null; name?: string | null }
) => {
  navigation.push('ProfileStudio', {
    deviceId,
    seedPortrait: seed?.portrait ?? null,
    seedName: seed?.name ?? null,
  });
};

const ProfilePage: React.FC<any> = ({ route, navigation }) => {
  const {
    deviceId,
    name: seedName,
    portrait: seedPortrait,
    rank: seedRank,
    fromZoom,
    profileUploadToken,
  } = route.params ?? {};
  const { profile, loading, error, refresh, setProfile } = useProfileData(deviceId, {
    name: seedName, portrait: seedPortrait, rank: seedRank,
  });
  const timeline = useTimeline(deviceId);
  const [followerDelta, setFollowerDelta] = useState(0);
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const [animFrames, setAnimFrames] = useState<string[]>([]);
  const [animIndex, setAnimIndex] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [portraitTransitionLoading, setPortraitTransitionLoading] = useState(false);
  const handledPortraitReturnRef = useRef<string | null>(null);
  const [arChooserVisible, setArChooserVisible] = useState(false);
  const [levelGalleryVisible, setLevelGalleryVisible] = useState(false);
  const [levelTasksVisible, setLevelTasksVisible] = useState(false);
  const [profileLevelAchievements, setProfileLevelAchievements] = useState<ProfileLevelAchievementState>({
    completed: [],
    pending: [],
    all: [],
    bonusLevels: 0,
  });
  const [localLevelStreak, setLocalLevelStreak] = useState<LocalLevelStreak>({ days: 0, lastDate: null, notifiedThreeDay: false });
  const [typedLevelInfo, setTypedLevelInfo] = useState('');
  const [levelTypingCycle, setLevelTypingCycle] = useState(0);
  const [deletionStep, setDeletionStep] = useState<0 | 1 | 2 | 3>(0);
  /** Explicit opt-in on the final step — the "Delete Forever" button stays disabled until ticked. */
  const [deletionAgreed, setDeletionAgreed] = useState(false);
  /** Set after a successful delete so the now-empty profile is shown back to the user as proof. */
  const [deletionDone, setDeletionDone] = useState(false);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [supportFallbackVisible, setSupportFallbackVisible] = useState(false);
  const [accountActionsExpanded, setAccountActionsExpanded] = useState(false);

  // ── Entry animation (fromZoom) ─────────────────────────────────────────────
  // pageScale/pageOpacity: the actual page content zooms OUT (1.18→1, 0→1)
  // overlayAnim: passport image bridges the 80ms WorldPage modal-dismiss gap, fades fast
  const pageScale   = useRef(new Animated.Value(fromZoom ? 1.18 : 1)).current;
  const pageOpacity = useRef(new Animated.Value(fromZoom ? 0   : 1)).current;
  const overlayAnim = useRef(new Animated.Value(fromZoom ? 1   : 0)).current;
  // imageReady: don't start fade until portrait image actually loaded (or 2s cap)
  const [imageReady, setImageReady] = useState(!fromZoom || !seedPortrait);

  // Avatar entrance: instant when fromZoom (overlay covers it), spring otherwise
  const mountAnim = useRef(new Animated.Value(fromZoom ? 1 : 0)).current;

  // Ownership gates the "Account & support" footer (Contact Support + Request Profile Deletion).
  // Both existing signals come from the SERVER (`profile.isSelf` is computed against the id the
  // caller navigated with; `timeline.isOwner` comes off the timeline response), so a caller passing
  // a differently-cased/sourced device id — or an unreachable server — hides the account controls
  // from the owner entirely. Deletion must never be unreachable, so also decide it LOCALLY.
  const [localIsOwner, setLocalIsOwner] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mine = await getOrCreateDailyDeviceId();
        const norm = (value?: string | null) => (value ?? '').trim().toLowerCase();
        const me = norm(mine);
        if (!cancelled) {
          setLocalIsOwner(me.length > 0 && (me === norm(deviceId) || me === norm(profile?.deviceId)));
        }
      } catch (error) {
        console.warn('[ProfilePage] could not resolve local device id:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, profile?.deviceId]);

  const isOwner = (profile?.isSelf ?? false) || timeline.isOwner || localIsOwner;
  const profileLevel = useMemo(() => resolveProfileLevelProgress({
    coins: profile?.coinCount ?? 0,
    strokeCount: profile?.strokeCount ?? 0,
    elapsedMs: profile?.elapsedMs ?? 0,
    streakDays: localLevelStreak.days,
    achievementBonusLevels: profileLevelAchievements.bonusLevels,
  }), [localLevelStreak.days, profile?.coinCount, profile?.elapsedMs, profile?.strokeCount, profileLevelAchievements.bonusLevels]);
  const levelHintPool = useMemo(() => {
    const achievementHints = profileLevelAchievements.pending.map((achievement) => achievement.tip);
    const hints = buildLevelInfoHints(profileLevel, achievementHints);
    if (profileLevel.level.id >= 99) {
      hints.push('Info: Level 100 is hidden. Only one egg hint appears here: find the egg inside the app.');
    }
    return hints;
  }, [profileLevel, profileLevelAchievements.pending]);
  const levelInfoText = levelHintPool[levelTypingCycle % Math.max(1, levelHintPool.length)] ?? formatLevelInfoSummary(profileLevel);
  const levelProgressLabel = useMemo(() => formatLevelInfoSummary(profileLevel), [profileLevel]);
  const levelProgressAnim = useRef(new Animated.Value(profileLevel.progress)).current;
  const levelProgressWidth = levelProgressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // No terms check on mount and no auto-raised sheet on first visit: AGB is
  // accepted once at first launch, before this page can be reached at all.

  useEffect(() => {
    if (!deviceId || !seedPortrait) return;
    patchProfileCache(deviceId, { portrait: seedPortrait });
    setProfile((current) => (current ? { ...current, portrait: seedPortrait } : current));
  }, [deviceId, seedPortrait, setProfile]);

  // Non-zoom: spring avatar in
  useEffect(() => {
    if (fromZoom) return;
    Animated.spring(mountAnim, { toValue: 1, useNativeDriver: true, tension: 90, friction: 8 }).start();
  }, [mountAnim, fromZoom]);

  // fromZoom: page zooms out immediately (native driver → 60fps on UI thread)
  useEffect(() => {
    if (!fromZoom) return;
    Animated.parallel([
      Animated.timing(pageScale, {
        toValue: 1, duration: 750,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pageOpacity, {
        toValue: 1, duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fromZoom]);

  // Overlay fade: wait for image onLoad, then fade; hard cap at 2s so we never stick
  const fadeOverlay = useCallback(() => {
    Animated.timing(overlayAnim, {
      toValue: 0, duration: 1100,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [overlayAnim]);

  useEffect(() => {
    if (!fromZoom || !imageReady) return;
    const t = setTimeout(fadeOverlay, 150);
    return () => clearTimeout(t);
  }, [fromZoom, imageReady, fadeOverlay]);

  // 2s hard cap — force-fade if image never fires onLoad
  useEffect(() => {
    if (!fromZoom) return;
    const t = setTimeout(fadeOverlay, 2000);
    return () => clearTimeout(t);
  }, [fromZoom, fadeOverlay]);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    void (async () => {
      const streak = await updateLocalLevelStreak();
      if (cancelled) return;
      setLocalLevelStreak(streak);
      if (streak.days >= 3 && !streak.notifiedThreeDay) {
        await notificationService.notifyLevelStreakUnlocked(streak.days);
        await markLocalLevelStreakThreeDayNotified();
        if (!cancelled) {
          setLocalLevelStreak({ ...streak, notifiedThreeDay: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isOwner]);

  useEffect(() => {
    if (!profile || !isOwner) return;
    let cancelled = false;
    void (async () => {
      const state = await loadProfileLevelAchievementState({
        coins: profile.coinCount,
        strokeCount: profile.strokeCount,
        elapsedMs: profile.elapsedMs,
        streakDays: localLevelStreak.days,
        galleryCount: profile.galleryCount,
        correctGuesses: profile.correctGuesses,
        karma: profile.karma,
        hasPortrait: !!profile.portrait,
        portraitCount: profile.portraitHistory.length,
      });
      if (!cancelled) {
        setProfileLevelAchievements(state);
      }
    })();
    return () => { cancelled = true; };
  }, [
    isOwner,
    localLevelStreak.days,
    profile?.coinCount,
    profile?.correctGuesses,
    profile?.elapsedMs,
    profile?.galleryCount,
    profile?.karma,
    profile?.portrait,
    profile?.portraitHistory.length,
    profile?.strokeCount,
  ]);

  useEffect(() => {
    setTypedLevelInfo('');
    let length = 0;
    const typeTimer = setInterval(() => {
      length += 1;
      setTypedLevelInfo(levelInfoText.slice(0, length));
      if (length >= levelInfoText.length) {
        clearInterval(typeTimer);
      }
    }, 34);
    return () => clearInterval(typeTimer);
  }, [levelInfoText]);

  useEffect(() => {
    Animated.timing(levelProgressAnim, {
      toValue: profileLevel.progress,
      duration: 650,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [levelProgressAnim, profileLevel.progress]);

  useEffect(() => {
    const timer = setInterval(() => {
      setLevelTypingCycle((cycle) => cycle + 1);
    }, LEVEL_HINT_ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  // Treat every studio upload as a distinct return event. A boolean stayed
  // `true` forever, so the second repaint never reloaded its frames and the
  // old frame list kept winning over the newly patched profile portrait.
  useEffect(() => {
    const play = route.params?.playPortraitAnim;
    if (!play && !profileUploadToken) return;
    const legacyKey = seedPortrait
      ? `legacy:${seedPortrait.length}:${seedPortrait.slice(-32)}`
      : null;
    const returnKey = typeof profileUploadToken === 'string' && profileUploadToken.length > 0
      ? profileUploadToken
      : legacyKey;
    if (!returnKey || handledPortraitReturnRef.current === returnKey) return;
    handledPortraitReturnRef.current = returnKey;

    let cancelled = false;
    setAnimating(false);
    setAnimFrames([]);
    setAnimIndex(0);
    setPortraitTransitionLoading(true);

    // The local data URL is authoritative for this return. It updates the
    // avatar immediately and is re-applied after refresh in case the server's
    // image URL/CDN has not caught up yet.
    if (deviceId && seedPortrait) {
      patchProfileCache(deviceId, { portrait: seedPortrait });
      setProfile((current) => (current ? { ...current, portrait: seedPortrait } : current));
    }

    void (async () => {
      try {
        const snaps = await loadPassportSnapshots();
        const frames = buildPortraitTransitionFrames(
          (snaps as { imageDataUrl?: string }[]).map((snapshot) => snapshot.imageDataUrl),
          seedPortrait,
        );
        if (!cancelled && frames.length > 1) {
          setAnimFrames(frames);
          setAnimIndex(0);
        }
      } catch { /* ignore */ }
      try {
        await refresh();
      } finally {
        if (!cancelled && deviceId && seedPortrait) {
          patchProfileCache(deviceId, { portrait: seedPortrait });
          setProfile((current) => (current ? { ...current, portrait: seedPortrait } : current));
        }
        if (!cancelled) setPortraitTransitionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deviceId, profileUploadToken, refresh, route.params?.playPortraitAnim, seedPortrait, setProfile]);

  // Drive the stop-motion frame counter
  useEffect(() => {
    if (animFrames.length === 0) return;
    const count = animFrames.length;
    // A short, visible old → new transition; never replay the entire 100-frame
    // archive for several seconds after each edit.
    const intervalMs = Math.max(90, Math.min(260, Math.round(1600 / count)));
    setAnimating(true);
    setAnimIndex(0);
    const id = setInterval(() => {
      setAnimIndex(i => {
        const next = i + 1;
        if (next >= count) {
          clearInterval(id);
          setAnimating(false);
          return count - 1;
        }
        return next;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [animFrames]);

  const openFollowList = useCallback((which: FollowList) => {
    navigation.push('FollowListPage', { deviceId, which, name: profile?.name });
  }, [navigation, deviceId, profile?.name]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), timeline.refresh()]);
      setFollowerDelta(0);
    } finally { setRefreshing(false); }
  }, [refresh, timeline]);

  const handleSave = useCallback(async (patch: { name?: string; bio?: string; portraitUrl?: string }) => {
    try {
      await saveProfile(patch);
      patchProfileCache(deviceId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
        ...(patch.portraitUrl !== undefined ? { portrait: patch.portraitUrl } : {}),
      });
      setEditing(false);
      await Promise.all([refresh(), timeline.refresh()]);
      return true;
    } catch {
      return false;
    }
  }, [deviceId, refresh, timeline]);

  // ♥ votes per art post
  const votesByEventId = useMemo(() => {
    const map = new Map<string, number>();
    (profile?.galleryEntries ?? []).forEach((e) => {
      if (typeof e.upvotes === 'number') map.set(`g${e.id}`, e.upvotes);
    });
    return map;
  }, [profile?.galleryEntries]);

  const aspectByEventId = useMemo(() => {
    const map = new Map<string, number>();
    (profile?.galleryEntries ?? []).forEach((e) => {
      if (e.width && e.height && e.width > 0 && e.height > 0) {
        map.set(`g${e.id}`, e.width / e.height);
      }
    });
    return map;
  }, [profile?.galleryEntries]);

  const videoByEventId = useMemo(() => {
    const map = new Map<string, string>();
    (profile?.galleryEntries ?? []).forEach((e) => {
      const u = e.rawUrl || e.imageUrl || '';
      const l = u.toLowerCase();
      if (l.endsWith('.mp4') || l.endsWith('.mov')) map.set(`g${e.id}`, u);
    });
    return map;
  }, [profile?.galleryEntries]);

  const bannerEntry = useMemo<DailyPaintGalleryEntry | null>(() => {
    const entries = profile?.galleryEntries ?? [];
    if (entries.length === 0) return null;
    const isVid = (e: DailyPaintGalleryEntry) => {
      const u = (e.rawUrl || e.imageUrl || '').toLowerCase();
      return u.endsWith('.mp4') || u.endsWith('.mov');
    };
    const videos = entries.filter(isVid);
    const pool = videos.length > 0 ? videos : entries;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }, [profile?.galleryEntries]);

  const firstActivityAt = useMemo(() => {
    const times = (profile?.galleryEntries ?? [])
      .map((e) => e.createdAt ?? 0)
      .filter((t) => t > 0);
    return times.length ? Math.min(...times) : null;
  }, [profile?.galleryEntries]);

  const renderItem = useCallback(({ item }: { item: TimelineEvent }) => (
    <PostCard
      event={item}
      authorName={profile?.name ?? ''}
      authorPortrait={profile?.portrait ?? null}
      votes={votesByEventId.get(item.id)}
      aspectRatio={aspectByEventId.get(item.id)}
      videoUrl={videoByEventId.get(item.id)}
    />
  ), [profile?.name, profile?.portrait, votesByEventId, aspectByEventId, videoByEventId]);

  // --- Owner: jump to Private Studio / paint the profile image.
  const openPaintProfile = useCallback(async () => {
    openPaintWithProfileStudio(navigation, deviceId, { portrait: profile?.portrait, name: profile?.name });
  }, [navigation, deviceId, profile?.portrait, profile?.name]);

  const openStudioFromEditPanel = useCallback(() => {
    setEditing(false);
    void openPaintProfile();
  }, [openPaintProfile]);

  const handleContactSupport = useCallback(async () => {
    const reference = `EP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const subject = 'Emoji Painter Support Request';
    const body = [
      'Hello Emoji Painter Support,',
      '',
      'Please describe the issue here.',
      '',
      `App version: ${String(Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? 'unknown')}`,
      `Build number: ${String(require('../../app.json').expo?.ios?.buildNumber ?? 'unknown')}`,
      `iOS: ${String(require('expo-constants').default.platform?.ios?.version ?? 'unknown')}`,
      `Support reference: ${reference}`,
    ].join('\n');
    try {
      if (await MailComposer.isAvailableAsync()) {
        await MailComposer.composeAsync({ recipients: ['support@emojipainter.com'], subject, body });
        return;
      }
      const mailto = `mailto:support@emojipainter.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      const opened = await Linking.canOpenURL(mailto);
      if (opened) await Linking.openURL(mailto);
      else setSupportFallbackVisible(true);
    } catch {
      setSupportFallbackVisible(true);
    }
  }, []);

  const requestDeletion = useCallback(() => {
    setDeletionError(null);
    setDeletionAgreed(false);
    setDeletionStep(1);
  }, []);

  const completeDeletion = useCallback(async () => {
    if (deletionBusy) return;
    setDeletionBusy(true);
    setDeletionError(null);
    try {
      await deleteProfileRemotely(deviceId);
      await clearDeletedProfileLocally();
      setDeletionStep(0);
      setDeletionAgreed(false);
      // PROOF, instead of bouncing the user away: re-read THIS profile straight from the server.
      // The identity is gone, so it comes back empty — the user sees the actual result of what
      // they just did rather than having to take our word for it.
      setDeletionDone(true);
      await refresh();
    } catch (error) {
      setDeletionError(error instanceof Error ? error.message : 'Deletion failed. Nothing was committed locally.');
    } finally {
      setDeletionBusy(false);
    }
  }, [deletionBusy, deviceId, refresh]);

  // --- Hub navigation
  const goWorld = useCallback(() => navigation.push('WorldPage'), [navigation]);
  const goPainting = useCallback(() => navigation.goBack(), [navigation]);
  const goLeaderboard = useCallback(() => {
    popToPaint(navigation, { openLeaderboard: true, returnToProfile: deviceId });
  }, [navigation, deviceId]);
  const goGallery = useCallback(() => {
    popToPaint(navigation, { openGallery: true, returnToProfile: deviceId });
  }, [navigation, deviceId]);
  const openCoinShop = useCallback(() => {
    popToPaint(navigation, { openCoinShop: true, returnToProfile: deviceId });
  }, [navigation, deviceId]);
  const goAR = useCallback(() => {
    setArChooserVisible(true);
  }, []);

  const pickFaceFilter = useCallback(() => {
    setArChooserVisible(false);
    popToPaint(navigation, { openFaceFilter: true });
  }, [navigation]);

  const pickArPainting = useCallback(() => {
    setArChooserVisible(false);
    popToPaint(navigation, { openArPainting: true });
  }, [navigation]);

  const pickAnimator = useCallback(() => {
    setArChooserVisible(false);
    popToPaint(navigation, { openAnimator: true });
  }, [navigation]);

  const pickVector = useCallback(() => {
    setArChooserVisible(false);
    popToPaint(navigation, { openVector: true });
  }, [navigation]);

  // 4-button nav bar: World · AR · Leaderboard · Gallery
  const navActions = useMemo<NavBarAction[]>(() => [
    { key: 'world', icon: '🌍', label: 'World', onPress: goWorld },
    { key: 'ar', icon: '📽️', label: '', onPress: goAR },
    { key: 'leaderboard', icon: '🏆', label: '', onPress: goLeaderboard },
    { key: 'gallery', icon: '🖼️', label: 'Gallery', onPress: goGallery },
  ], [goWorld, goLeaderboard, goGallery, goAR]);

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.root}>
        {fromZoom ? (
          // fromZoom while loading: show passport overlay that fades out as page animates in
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { zIndex: 9000, opacity: overlayAnim }]}
          >
            {seedPortrait ? (
              <Image source={{ uri: seedPortrait }} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={() => setImageReady(true)} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1a1a3a', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: '#aaaadd', fontSize: 96, fontWeight: '700' }}>
                  {(seedName || '?')[0].toUpperCase()}
                </Text>
              </View>
            )}
          </Animated.View>
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color="#ff9f6b" size="large" />
          </View>
        )}
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyEmoji}>🫥</Text>
        <Text style={styles.emptyTitle}>{error ? "Couldn't load profile" : 'Nothing here yet'}</Text>
        <Text style={styles.emptySub}>{error ?? "This player hasn't set up a profile."}</Text>
        <TouchableOpacity style={styles.backPill} onPress={() => navigation.goBack()}>
          <Text style={styles.backPillText}>‹ Back</Text>
        </TouchableOpacity>
        {error && (
          <TouchableOpacity style={styles.backPill} onPress={() => void refresh()}>
            <Text style={styles.backPillText}>↻ Retry</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    );
  }

  // Frames only own the avatar while they are actively playing. Keeping a
  // finished/stale frame array authoritative is what forced users to close and
  // reopen Profile before seeing the latest upload.
  // While the post-upload refresh is in flight the server can still answer with
  // the PREVIOUS portrait URL (its copy of the new one may not be live yet), and
  // that answer would land on `profile.portrait` for a frame or two. The local
  // data URL handed over by the studio is authoritative for that window, so the
  // avatar can never flash the image the user just painted over.
  const returnedPortrait = typeof seedPortrait === 'string' && seedPortrait.trim().length > 0
    ? seedPortrait
    : null;
  const portraitUri = animating && animFrames[animIndex]
    ? animFrames[animIndex]
    : (portraitTransitionLoading && returnedPortrait) || (profile?.portrait ?? null);

  const { level } = profileLevel;
  const followerDisplay = profile.followerCount == null ? null : profile.followerCount + followerDelta;

  const header = (
    <View>
      {/* ── Cover zone: banner extends 200px behind buttons ── */}
      <View style={styles.coverZone}>
        {/* Banner fills entire cover zone as background */}
        <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
          <ProfileBanner entry={bannerEntry} scrollY={scrollY} stretch />
        </View>

        {firstActivityAt ? (
          <Text style={styles.memberSince}>📅 {shortDate(firstActivityAt)}</Text>
        ) : null}

        {/* ── Profile identity row: info LEFT + avatar RIGHT ── */}
        <View style={styles.identityRow}>
          {/* Left: name, handle, bio */}
          <View style={styles.identityInfo}>
            <Text style={styles.name} numberOfLines={2}>{profile.name}</Text>
            <Text style={styles.handle} numberOfLines={1}>{handleOf(profile.deviceId)}</Text>
            {profile.bio ? (
              <Text style={styles.bio} numberOfLines={4}>{profile.bio}</Text>
            ) : isOwner ? (
              <Text style={styles.bioEmpty}>Tap Edit Profile to add a bio.</Text>
            ) : null}
          </View>

          {/* Right: avatar circle (bigger, right-aligned) */}
          <Animated.View style={[styles.avatarWrap, fromZoom ? undefined : { transform: [{ scale: mountAnim }], opacity: mountAnim }]}>
            <PortraitAvatar uri={portraitUri} size={AVATAR_SIZE} bust />
            {portraitTransitionLoading && (
              <View style={styles.portraitRefreshBadge}>
                <ActivityIndicator color="#dff8e5" size="small" />
              </View>
            )}
            {animating && (
              <View style={styles.animBadge}>
                <Text style={styles.animBadgeText}>▶ {animIndex + 1}/{animFrames.length}</Text>
              </View>
            )}
          </Animated.View>
        </View>

        {/* ── Action buttons (inside cover zone, appear over banner) ── */}
        <View style={styles.actionRow}>
          {isOwner ? (
            <View style={styles.ownerActionRow}>
              <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)} activeOpacity={0.85}>
                <Text style={styles.editBtnText}>✏️  Edit Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.paintBtn} onPress={() => void openPaintProfile()} activeOpacity={0.85}>
                <Text style={styles.paintBtnText}>🎨  Paint Profile</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FollowButton
              targetDeviceId={profile.deviceId}
              following={profile.isFollowing}
              onChange={(now) => {
                setFollowerDelta((d) => d + (now ? 1 : -1));
                patchProfileCache(profile.deviceId, { isFollowing: now });
              }}
            />
          )}
        </View>

        {/* Server sync status */}
        {loading ? (
          <View style={styles.syncRow}>
            <Text style={styles.syncText}>⏳ Syncing…</Text>
          </View>
        ) : !profile.serverAvailable ? (
          <View style={[styles.syncRow, styles.syncUnavailableRow]}>
            <Text style={[styles.syncText, styles.syncError]}>🔴 Server unavailable</Text>
            <TouchableOpacity onPress={() => void refresh()} accessibilityRole="button">
              <Text style={[styles.syncText, { color: '#ff9f6b', fontWeight: '700', marginLeft: 8 }]}>Retry ↩</Text>
            </TouchableOpacity>
          </View>
        ) : isOwner ? (
          <View style={styles.syncRow}>
            <Text style={styles.syncText}>
              🟢 {profile.galleryCount} artwork{profile.galleryCount !== 1 ? 's' : ''}{profile.rank != null ? ` · #${profile.rank}` : ''}{followerDisplay != null ? ` · ${followerDisplay} follower${followerDisplay !== 1 ? 's' : ''}` : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.syncRow}>
            <Text style={styles.syncText}>🟢 Profile loaded</Text>
          </View>
        )}
      </View>

      {/* ── Content below banner ── */}
      <View style={styles.belowCover}>
        {/* 4-button hub nav bar */}
        <View style={styles.section}>
          <ProfileNavBar actions={navActions} />
        </View>

        <View style={styles.section}>
          <FollowCountsRow
            followers={followerDisplay}
            following={profile.followingCount}
            onPress={openFollowList}
          />
        </View>

        <View style={[styles.section, styles.statRowCompact]}>
          <StatTile icon="⭐️" value={profile.rank != null ? `#${profile.rank}` : '—'} label="Rank" accent="#ffdc82" compact />
          <StatTile icon="✨" value={String(profile.karma)} label="Karma" accent="#82ffa1" rawValue={profile.karma} compact />
          {COIN_PAGE_ENABLED && <StatTile icon="🪙" value={profile.coinCount.toLocaleString()} label="Coins" accent="#ffdc82" rawValue={profile.coinCount} onPress={openCoinShop} compact />}
          <StatTile icon="⏱️" value={formatElapsedTime(profile.elapsedMs)} label="Time" accent="#c084fc" compact />
          <StatTile icon="🖌️" value={profile.strokeCount.toLocaleString()} label="Strokes" accent="#67e8f9" rawValue={profile.strokeCount} compact />
        </View>

        <Pressable
          style={[styles.section, styles.levelPanel]}
          onHoverIn={() => setLevelTypingCycle((cycle) => cycle + 1)}
          onPress={() => setLevelTypingCycle((cycle) => cycle + 1)}
        >
          <View style={styles.levelHeaderRow}>
            <View style={styles.levelBadgeButton}>
              <AnimatedLevelEmoji
                source={getProfileLevelEmojiSource(level.id)}
                fallbackSource={getProfileLevelEmojiFallbackSource(level.id)}
                fallbackEmoji={level.emoji}
                size={58}
              />
            </View>
            <View style={styles.levelTextBlock}>
              <Text style={styles.levelEyebrow}>Level {level.id}</Text>
              <Text style={styles.levelName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>{level.name}</Text>
              {profileLevel.achievementBonusLevels > 0 ? (
                <Text style={styles.levelBonusText}>+{profileLevel.achievementBonusLevels} bonus level{profileLevel.achievementBonusLevels === 1 ? '' : 's'} from tasks</Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={styles.levelInfoButton}
              onPress={() => setLevelGalleryVisible(true)}
              activeOpacity={0.86}
              accessibilityRole="button"
              accessibilityLabel="Show all levels"
            >
              <Text style={styles.levelInfoIcon}>i</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.levelTasksButton}
              onPress={() => setLevelTasksVisible(true)}
              activeOpacity={0.86}
              accessibilityRole="button"
            >
              <Text style={styles.levelTasksIcon}>📁</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.levelProgressTrack}>
            <Animated.View style={[styles.levelProgressFill, { width: levelProgressWidth }]} />
          </View>
          <Text style={styles.levelProgressText}>
            {levelProgressLabel}
          </Text>
          <Text style={styles.levelPrompt}>
            Daily streak {profileLevel.streakDays}/99
            {profileLevel.streakDaysToNext > 0 ? ` · ${profileLevel.streakDaysToNext} to next streak gate` : ''}
          </Text>
          <View style={styles.levelTipRow}>
            <Text style={styles.levelTipLabel}>Next:</Text>
            <Text style={styles.levelTipText} numberOfLines={3}>{typedLevelInfo || ' '}</Text>
          </View>
        </Pressable>

        <ProfileArtStrip entries={profile.galleryEntries} />

        <Text style={styles.feedTitle}>{isOwner ? '📓 Your timeline' : '🕓 Timeline'}</Text>
        {isOwner && <DiaryComposer onAddDiary={timeline.postDiary} />}
        <ProfileIntroCard profile={profile} firstActivityAt={firstActivityAt} levelName={level.name} levelIcon={level.emoji} />
      </View>
    </View>
  );

  const footer = (
    <View>
      {timeline.loading && timeline.events.length === 0 ? (
        <ActivityIndicator color="#ff9f6b" style={{ marginVertical: 20 }} />
      ) : timeline.events.length === 0 ? (
        <Text style={styles.feedEmpty}>
          {isOwner ? 'Your timeline is empty — hand in art or write a diary entry above.' : 'No posts yet.'}
        </Text>
      ) : <View style={{ height: 24 }} />}
      {isOwner ? (
        <View style={styles.accountActions}>
          <TouchableOpacity
            style={styles.accountActionsHeader}
            onPress={() => setAccountActionsExpanded((expanded) => !expanded)}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel="Account and support options"
            accessibilityState={{ expanded: accountActionsExpanded }}
          >
            <Text style={styles.accountActionsTitle}>Account & support</Text>
            <Text style={styles.accountActionsArrow}>{accountActionsExpanded ? '⌃' : '⌄'}</Text>
          </TouchableOpacity>
          {accountActionsExpanded ? (
            <View style={styles.accountActionsBody}>
              <TouchableOpacity style={styles.supportButton} onPress={() => void handleContactSupport()} accessibilityRole="button" accessibilityLabel="Contact Support">
                <Text style={styles.supportButtonText}>Contact Support</Text>
              </TouchableOpacity>
              {/* Label says what it does: the server deletes immediately, this is not a request queue. */}
              <TouchableOpacity style={styles.deleteProfileButton} onPress={requestDeletion} accessibilityRole="button" accessibilityLabel="Delete my profile forever">
                <Text style={styles.deleteProfileButtonText}>Delete Profile Forever</Text>
              </TouchableOpacity>
              <Text style={styles.deleteProfileHint}>Name and profile are deleted; uploads stay as “Anonymous Painter”.</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.root}>
      {/* PROOF banner: shown over the reloaded — now empty — profile right after deletion, so the
          user can see for themselves that the name and profile are actually gone from the server. */}
      {deletionDone ? (
        <View style={styles.deletedBanner}>
          <Text style={styles.deletedBannerTitle}>✅ Your profile was deleted</Text>
          <Text style={styles.deletedBannerBody}>
            This is your profile reloaded from the server — empty. Your name and profile picture are gone
            for good. Artwork you uploaded before stays in the gallery as “Anonymous Painter”.
          </Text>
          <TouchableOpacity style={styles.deletedBannerBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.deletedBannerBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Sticky close button — floats top-right, always visible while scrolling */}
      <TouchableOpacity
        style={styles.stickyClose}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.stickyCloseText}>❎</Text>
      </TouchableOpacity>

      {/* Page content: zooms out from 1.18x on fromZoom entry (native driver) */}
      <Animated.View style={[
        StyleSheet.absoluteFill,
        fromZoom ? { opacity: pageOpacity, transform: [{ scale: pageScale }] } : undefined,
      ]}>
        <AnimatedFlatList
          data={timeline.events}
          keyExtractor={((e: TimelineEvent) => `${e.type}-${e.id}`) as any}
          renderItem={renderItem as any}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff9f6b" />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator
          indicatorStyle="white"
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={9}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
        />
        <ProfileEditPanel
          visible={editing}
          initial={{ name: profile.name === 'Anonymous' ? '' : profile.name, bio: profile.bio ?? '', portrait: profile.portrait }}
          portraitHistory={profile.portraitHistory}
          onCancel={() => setEditing(false)}
          onSave={handleSave}
          onOpenStudio={openStudioFromEditPanel}
        />
      </Animated.View>

      {/* fromZoom: passport image bridges the WorldPage modal-dismiss gap, fades in ~120ms */}
      {fromZoom ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { zIndex: 9000, opacity: overlayAnim }]}
        >
          {seedPortrait ? (
            <Image
              source={{ uri: seedPortrait }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onLoad={() => setImageReady(true)}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1a1a3a', alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: '#aaaadd', fontSize: 72, fontWeight: '700' }}>
                {(profile.name || '?')[0].toUpperCase()}
              </Text>
            </View>
          )}
        </Animated.View>
      ) : null}

      <Modal
        visible={deletionStep > 0}
        animationType="slide"
        transparent
        onRequestClose={() => { if (!deletionBusy) setDeletionStep(0); }}
      >
        <View style={styles.deletionOverlay}>
          <View style={styles.deletionSheet}>
            <Text style={styles.deletionTitle}>
              {deletionStep === 1 ? 'Delete Profile' : deletionStep === 2 ? 'Confirm Deletion' : 'Delete Permanently'}
            </Text>
            {deletionStep === 1 ? (
              <>
                <Text style={styles.deletionLead}>This deletes WHO YOU ARE — not what you painted.</Text>
                <View style={styles.deletionSplitRow}>
                  <Text style={styles.deletionGoneTitle}>❌  Deleted forever</Text>
                  <Text style={styles.deletionGoneItem}>• Your profile name</Text>
                  <Text style={styles.deletionGoneItem}>• Your profile / passport picture</Text>
                  <Text style={styles.deletionGoneItem}>• Your profile, followers and diary</Text>
                  <Text style={styles.deletionGoneItem}>• Your leaderboard place</Text>
                </View>
                <View style={styles.deletionSplitRow}>
                  <Text style={styles.deletionKeptTitle}>✅  Kept</Text>
                  <Text style={styles.deletionKeptItem}>• Artwork you already uploaded stays in the public gallery — but as “Anonymous Painter”, with your name removed and no link back to you.</Text>
                </View>
                <Text style={styles.deletionStepHint}>Step 1 of 3</Text>
                <TouchableOpacity style={styles.deletionPrimary} onPress={() => setDeletionStep(2)}><Text style={styles.deletionPrimaryText}>Continue</Text></TouchableOpacity>
              </>
            ) : deletionStep === 2 ? (
              <>
                <Text style={styles.deletionLead}>There is no undo. There is no restore.</Text>
                <Text style={styles.deletionBody}>Your name “{profile?.name || 'your profile'}” and your profile picture will be gone from the server permanently. Reinstalling the app will NOT bring them back — you would start again as a brand new painter.</Text>
                <Text style={styles.deletionStepHint}>Step 2 of 3</Text>
                <TouchableOpacity style={styles.deletionPrimary} onPress={() => setDeletionStep(3)}><Text style={styles.deletionPrimaryText}>I understand — continue</Text></TouchableOpacity>
              </>
            ) : (
              <>
                <ScrollView style={styles.deletionScroll} showsVerticalScrollIndicator={false}>
                  <Text style={styles.deletionBody}>
                    Your profile name and profile/passport image will be deleted from storage. The stored device identifier and authentication association will be deleted or permanently invalidated, together with sessions, push tokens, profile metadata, private preferences, and leaderboard links. The deleted profile cannot be restored; reinstalling the app will not restore it. Existing public gallery submissions may remain publicly available as “Anonymous Painter”, without profile navigation or identity references. They will not generate new profile-based leaderboard ranking.
                  </Text>
                </ScrollView>
                {deletionError ? <Text style={styles.deletionError}>{deletionError}</Text> : null}
                <TouchableOpacity
                  style={styles.deletionAgreeRow}
                  onPress={() => setDeletionAgreed((prev) => !prev)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: deletionAgreed }}
                  accessibilityLabel="I agree to permanently delete my profile"
                  disabled={deletionBusy}
                >
                  <Text style={[styles.deletionAgreeBox, deletionAgreed && styles.deletionAgreeBoxOn]}>
                    {deletionAgreed ? '☑' : '☐'}
                  </Text>
                  <Text style={styles.deletionAgreeText}>
                    I agree: delete my name and my profile forever. My uploaded artwork stays, anonymously.
                  </Text>
                </TouchableOpacity>
                <Text style={styles.deletionStepHint}>Step 3 of 3</Text>
                <TouchableOpacity
                  style={[styles.deletionPrimary, (deletionBusy || !deletionAgreed) && styles.deletionDisabled]}
                  onPress={() => void completeDeletion()}
                  disabled={deletionBusy || !deletionAgreed}
                >
                  <Text style={styles.deletionPrimaryText}>{deletionBusy ? 'Deleting…' : 'Delete My Profile Forever'}</Text>
                </TouchableOpacity>
              </>
            )}
            {!deletionBusy ? <TouchableOpacity style={styles.deletionCancel} onPress={() => setDeletionStep(0)}><Text style={styles.deletionCancelText}>Cancel</Text></TouchableOpacity> : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={supportFallbackVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSupportFallbackVisible(false)}
      >
        <View style={styles.termsOverlay}>
          <View style={styles.termsSheet}>
            <Text style={styles.termsTitle}>Contact Support</Text>
            <Text style={styles.termsBody}>No mail app is available. Please configure an email app and try again.</Text>
            <TouchableOpacity style={styles.termsAcceptBtn} onPress={() => setSupportFallbackVisible(false)}>
              <Text style={styles.termsAcceptText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ArModeChooser
        visible={arChooserVisible}
        faceComingSoon={IS_LITE_BUILD}
        onPickFaceFilter={pickFaceFilter}
        onPickArPainting={pickArPainting}
        onPickAnimator={pickAnimator}
        onPickVector={pickVector}
        onClose={() => setArChooserVisible(false)}
      />

      <LevelEmojiGalleryModal
        visible={levelGalleryVisible}
        currentLevel={profileLevel.level.id}
        nextLevel={profileLevel.nextLevel?.id ?? null}
        onClose={() => setLevelGalleryVisible(false)}
      />

      <LevelUpTasksModal
        visible={levelTasksVisible}
        achievements={profileLevelAchievements.all}
        onClose={() => setLevelTasksVisible(false)}
      />

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0b' },
  center: { flex: 1, backgroundColor: '#0b0b0b', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  listContent: { paddingBottom: 30 },

  // ── Cover zone: banner behind avatar + buttons ─────────────────────────
  coverZone: {
    width: '100%',
    backgroundColor: '#241a16',
    paddingHorizontal: 16,
    paddingBottom: 14,
    overflow: 'hidden',
  },
  memberSince: {
    position: 'absolute', top: 10, right: 58,
    color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, overflow: 'hidden',
  },
  backFab: {
    position: 'absolute', top: 10, left: 12,
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  backFabText: { color: '#fff', fontSize: 26, fontWeight: '300', marginTop: -2 },
  stickyClose: {
    position: 'absolute', top: 12, right: 16,
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 500,
  },
  stickyCloseText: { fontSize: 26 },

  // Identity row: info (left, flex:1) + avatar (right, fixed width)
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 32,
    gap: 14,
  },
  identityInfo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  avatarWrap: {
    // right-aligned avatar, no self-centering
  },

  name: { color: '#fff', fontSize: 22, fontWeight: '800', lineHeight: 26 },
  handle: { color: '#8e8e92', fontSize: 12, fontWeight: '600', marginTop: 2 },
  bio: { color: '#dcdcdc', fontSize: 13, lineHeight: 18, marginTop: 8 },
  bioEmpty: { color: '#555', fontSize: 12, fontStyle: 'italic', marginTop: 8 },

  actionRow: { marginTop: 14 },
  ownerActionRow: { flexDirection: 'row', gap: 10 },
  editBtn: {
    flex: 1, backgroundColor: 'rgba(31,31,31,0.88)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
  },
  editBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  paintBtn: {
    flex: 1, backgroundColor: 'rgba(26,26,26,0.88)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#ff9f6b',
    alignItems: 'center',
  },
  paintBtnText: { color: '#ff9f6b', fontWeight: '700', fontSize: 13 },
  syncRow: { marginTop: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-start' },
  syncUnavailableRow: { backgroundColor: 'rgba(255,60,60,0.12)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  syncText: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: '600' },
  syncError: { color: '#ff8080' },

  // ── Content below cover zone ────────────────────────────────────────────
  belowCover: { paddingHorizontal: 16 },
  section: { marginTop: 16 },
  statRow: { flexDirection: 'row', gap: 8 },
  statRowCompact: { flexDirection: 'row', gap: 5 },
  levelPanel: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f2f2f',
  },
  levelHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelBadgeButton: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d0d0d',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#303030',
  },
  levelTextBlock: { flex: 1, minWidth: 0 },
  levelEyebrow: { color: '#82ffa1', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0 },
  levelName: { color: '#fff', fontSize: 17, lineHeight: 20, fontWeight: '900', marginTop: 2 },
  levelBonusText: { color: '#ffdc82', fontSize: 11, fontWeight: '800', marginTop: 3 },
  levelTasksButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#202020',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a3a3a',
  },
  levelInfoButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#202020',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#4a4a4a',
  },
  levelInfoIcon: { color: '#82ffa1', fontSize: 16, fontWeight: '900', lineHeight: 18 },
  levelTasksIcon: { fontSize: 22 },
  levelProgressTrack: {
    height: 9,
    borderRadius: 5,
    backgroundColor: '#242424',
    overflow: 'hidden',
    marginTop: 12,
  },
  levelProgressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#82ffa1',
  },
  levelProgressText: { color: '#dcdcdc', fontSize: 11, lineHeight: 15, fontWeight: '800', marginTop: 8 },
  levelPrompt: { color: '#8e8e92', fontSize: 11, lineHeight: 16, marginTop: 4 },
  levelTipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
    minHeight: 34,
  },
  levelTipLabel: { color: '#ffdc82', fontSize: 12, fontWeight: '900' },
  levelTipText: { flex: 1, color: '#cfcfcf', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  feedTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 12 },
  feedEmpty: { color: '#666', fontSize: 13, textAlign: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  accountActions: { marginTop: 18, marginBottom: 28, borderRadius: 12, backgroundColor: '#101010', borderWidth: StyleSheet.hairlineWidth, borderColor: '#262626', overflow: 'hidden' },
  accountActionsHeader: { minHeight: 42, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  accountActionsTitle: { color: '#aaa', fontSize: 12, fontWeight: '800' },
  accountActionsArrow: { color: '#777', fontSize: 16, fontWeight: '800' },
  accountActionsBody: { paddingHorizontal: 11, paddingBottom: 11, gap: 7 },
  supportButton: { alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, backgroundColor: '#202020', alignItems: 'center' },
  supportButtonText: { color: '#ddd', fontSize: 11.5, fontWeight: '700' },
  deleteProfileButton: { alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, backgroundColor: 'rgba(255,70,70,0.09)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,100,100,0.4)', alignItems: 'center' },
  deleteProfileButtonText: { color: '#e98f8f', fontSize: 11.5, fontWeight: '800' },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  emptySub: { color: '#8e8e92', fontSize: 13, textAlign: 'center' },
  backPill: { backgroundColor: '#1f1f1f', borderRadius: 18, paddingHorizontal: 20, paddingVertical: 10, marginTop: 6 },
  backPillText: { color: '#fff', fontWeight: '700' },
  // T&C modal
  termsOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'flex-end',
  },
  termsSheet: {
    backgroundColor: '#141414', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, maxHeight: '85%',
  },
  termsTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 4 },
  termsSubtitle: { color: '#ff9f6b', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  termsBody: { color: '#bbb', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  termsSections: { flex: 1, maxHeight: 300 },
  termsSection: { marginBottom: 14 },
  termsSectionHeading: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  termsSectionBody: { color: '#999', fontSize: 12, lineHeight: 18, marginBottom: 4 },
  termsReaderBtn: { paddingVertical: 9, alignItems: 'center', marginTop: 7 },
  termsReaderText: { color: '#8fdcff', fontWeight: '800', fontSize: 12 },
  termsAcceptBtn: {
    backgroundColor: '#ff9f6b', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginTop: 2,
  },
  termsAcceptText: { color: '#0b0b0b', fontWeight: '800', fontSize: 15 },
  termsCancelBtn: {
    paddingVertical: 12, alignItems: 'center', marginTop: 6,
  },
  termsCancelText: { color: '#666', fontWeight: '600', fontSize: 14 },
  deletionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.86)', justifyContent: 'flex-end' },
  deletionSheet: { backgroundColor: '#171313', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 24, maxHeight: '82%' },
  deletionTitle: { color: '#fff', fontSize: 21, fontWeight: '900', marginBottom: 12 },
  deletionBody: { color: '#d4caca', fontSize: 14, lineHeight: 21, marginBottom: 18 },
  // --- Deletion clarity: what goes vs what stays, step counter, explicit agreement
  deletionLead: { color: '#fff', fontSize: 16, fontWeight: '900', lineHeight: 23, marginBottom: 14 },
  deletionSplitRow: { marginBottom: 14 },
  deletionGoneTitle: { color: '#ff8a8a', fontSize: 14, fontWeight: '900', marginBottom: 6 },
  deletionGoneItem: { color: '#e7d2d2', fontSize: 13.5, lineHeight: 20 },
  deletionKeptTitle: { color: '#7fd69a', fontSize: 14, fontWeight: '900', marginBottom: 6 },
  deletionKeptItem: { color: '#cfe3d4', fontSize: 13.5, lineHeight: 20 },
  deletionStepHint: { color: '#8d8383', fontSize: 12, fontWeight: '700', marginTop: 4, marginBottom: 2, textAlign: 'right' },
  deletionAgreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
  deletionAgreeBox: { color: '#8d8383', fontSize: 20, lineHeight: 22 },
  deletionAgreeBoxOn: { color: '#ff8a8a' },
  deletionAgreeText: { flex: 1, color: '#e7d2d2', fontSize: 13.5, lineHeight: 19 },
  deleteProfileHint: { color: '#756d6d', fontSize: 10.5, lineHeight: 14, marginTop: 1 },
  // --- Post-deletion proof banner
  deletedBanner: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, backgroundColor: 'rgba(18,26,20,0.97)', borderBottomWidth: 1, borderBottomColor: 'rgba(127,214,154,0.45)', paddingHorizontal: 18, paddingTop: 52, paddingBottom: 16 },
  deletedBannerTitle: { color: '#7fd69a', fontSize: 16, fontWeight: '900', marginBottom: 6 },
  deletedBannerBody: { color: '#cfe3d4', fontSize: 13, lineHeight: 19 },
  deletedBannerBtn: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: 'rgba(127,214,154,0.16)', borderWidth: 1, borderColor: 'rgba(127,214,154,0.5)', borderRadius: 11, paddingVertical: 9, paddingHorizontal: 22 },
  deletedBannerBtnText: { color: '#9fe6b6', fontSize: 14, fontWeight: '800' },
  deletionScroll: { maxHeight: 260 },
  deletionPrimary: { backgroundColor: '#d74b4b', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  deletionPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  deletionDisabled: { opacity: 0.55 },
  deletionCancel: { alignItems: 'center', paddingVertical: 13 },
  deletionCancelText: { color: '#999', fontWeight: '700' },
  deletionError: { color: '#ff9a9a', fontSize: 12, lineHeight: 17, marginBottom: 4 },
  portraitRefreshBadge: {
    position: 'absolute', top: 8, right: 8,
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(18,35,23,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(159,230,182,0.65)',
  },
  animBadge: {
    position: 'absolute', bottom: -4, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  animBadgeText: { color: '#ff9f6b', fontSize: 10, fontWeight: '700' },
});

export default ProfilePage;
