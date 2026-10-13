/**
 * useGallery — manages all gallery state, sorting, pagination, voting, and overlays.
 *
 * Extracted from PaintScreen.tsx.  galleryEntries and galleryLanguage are
 * intentionally kept as thin PaintScreen state (passed in as params) so that
 * useInfoPanel and useLeaderboard can consume them without a circular dep.
 *
 * sortGalleryEntries is exported as a standalone function so useLeaderboard can
 * import it without waiting for the hook to be instantiated first.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Animated as RNAnimated,
  Easing as RNEasing,
  NativeModules,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import {
  fetchDailyPaintGallery,
  mutateCachedGalleryEntry,
  persistSolvedState,
  invalidateGalleryCache,
  resetDailyPaintGalleryCache,
  setStoredGalleryVote,
  submitDailyPaintGalleryVote,
  type DailyPaintGalleryEntry,
  type DailyPaintGallerySort,
  type DailyPaintGalleryVoteDirection,
} from '../../lib/dailyPaintGallery';
import { TOPIC_LANGUAGES } from '../../lib/dailyTopics';
import { fetchPrivateStudioLeaderboard, type PrivateStudioLeaderboardEntry } from '../../lib/privateStudio';
import type { DailyPaintUploadResult } from '../../lib/dailyPaintUpload';
import {
  getOfflineEntries,
  type OfflineGalleryEntry,
} from '../../lib/offlineGalleryDatabase';
import { getCachedGalleryForOffline } from '../../lib/offlineGallerySupport';
import { maskTopic as _maskTopic, topicsMatch as _topicsMatch } from '../../gesser/utils/masking';
import type { ParentalControlsSettings } from '../../lib/parentalControls';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Module-scope constants (re-exported so PaintScreen can remove its copies) ────

export const GALLERY_LANGUAGE_DEFAULT = 'en';
export const GALLERY_STALE_THRESHOLD_MS = 60 * 1_000;
export const GALLERY_PAGE_SIZE = 100;
export const GALLERY_FETCH_LIMIT = 100;

export const LANGUAGE_FLAG_MAP: Record<string, { flag: string; label: string }> = {
  en: { flag: '🇺🇸', label: 'English' },
  de: { flag: '🇩🇪', label: 'Deutsch' },
  fr: { flag: '🇫🇷', label: 'Français' },
  it: { flag: '🇮🇹', label: 'Italiano' },
  ru: { flag: '🇷🇺', label: 'Русский' },
  ja: { flag: '🇯🇵', label: '日本語' },
  ko: { flag: '🇰🇷', label: '한국어' },
  zh: { flag: '🇨🇳', label: '中文' },
};

export const galleryModes = ['new', 'hot', 'personal', 'mystery', 'friends'] as const;
export type GalleryMode = typeof galleryModes[number];

export const galleryLayoutModes = ['default', 'list', 'grid'] as const;
export type GalleryLayoutMode = typeof galleryLayoutModes[number];

export type GalleryLanguageOption = { id: string; flag: string; label: string };

export const galleryModeIcons: Record<GalleryMode, string> = {
  new: '🆕', hot: '🔥', personal: '👤', mystery: '🎲', friends: '👥',
};

export const galleryModeLabels: Record<GalleryMode, string> = {
  new: 'Newest', hot: 'Trending', personal: 'Personal', mystery: 'Mystery', friends: 'Friends',
};

// ─── Standalone helpers ────────────────────────────────────────────────────────

/** Normalise a device-id string to lowercase trimmed, or null if empty. */
function normalizeDeviceId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Convert server timestamps (seconds or ms) to epoch-milliseconds. */
const toEpochMs = (value: number) =>
  value > 1_000_000_000_000 ? value : value * 1_000;

/** Collect device language candidates from OS settings (unchanged from PaintScreen). */
export function collectDeviceLanguageCandidates(): string[] {
  const raw: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim().length > 0) raw.push(v);
  };
  try { push(Intl.DateTimeFormat().resolvedOptions().locale); } catch { /* ignore */ }
  try {
    const sm = (NativeModules as { SettingsManager?: { settings?: Record<string, unknown> } }).SettingsManager;
    const s = sm?.settings ?? {};
    (Array.isArray(s.AppleLanguages) ? s.AppleLanguages : []).forEach(push);
    push(typeof s.AppleLocale === 'string' ? s.AppleLocale : null);
  } catch { /* ignore */ }
  try {
    const i18n = (NativeModules as { I18nManager?: { localeIdentifier?: string; locales?: unknown } }).I18nManager;
    (Array.isArray(i18n?.locales) ? i18n!.locales : []).forEach(push);
    push(i18n?.localeIdentifier);
  } catch { /* ignore */ }
  const out = new Set<string>();
  raw.forEach((v) => {
    const t = v.trim().toLowerCase();
    if (t.length === 0) return;
    out.add(t);
    const base = t.split(/[-_]/)[0];
    if (base) out.add(base);
  });
  return Array.from(out);
}

/**
 * Pure sort function — exported so useLeaderboard can import it before useGallery
 * is instantiated.  When called without a mode it defaults to 'new'.
 */
export function sortGalleryEntries(
  entries: DailyPaintGalleryEntry[],
  mode: GalleryMode = 'new',
): DailyPaintGalleryEntry[] {
  if (entries.length <= 1) return entries.slice();

  const resolveTimestamp = (e: DailyPaintGalleryEntry): number => {
    const src = e.updatedAt ?? e.uploadedAt ?? null;
    if (src) { const p = Date.parse(src); if (!Number.isNaN(p)) return p; }
    if (typeof e.createdAt === 'number' && Number.isFinite(e.createdAt)) return e.createdAt;
    return 0;
  };
  const resolveScore = (e: DailyPaintGalleryEntry) =>
    (typeof e.upvotes === 'number' ? e.upvotes : 0) -
    (typeof e.downvotes === 'number' ? e.downvotes : 0);
  const resolveUpvotes = (e: DailyPaintGalleryEntry) =>
    typeof e.upvotes === 'number' ? e.upvotes : 0;

  const sorted = [...entries];
  if (mode === 'mystery' || mode === 'friends') {
    sorted.sort((a, b) => {
      const d = resolveTimestamp(b) - resolveTimestamp(a);
      return d !== 0 ? d : b.id - a.id;
    });
    return sorted;
  }
  if (mode === 'hot') {
    sorted.sort((a, b) => {
      const sd = resolveScore(b) - resolveScore(a);
      if (sd !== 0) return sd;
      const ud = resolveUpvotes(b) - resolveUpvotes(a);
      if (ud !== 0) return ud;
      const td = resolveTimestamp(b) - resolveTimestamp(a);
      return td !== 0 ? td : b.id - a.id;
    });
    return sorted;
  }
  sorted.sort((a, b) => {
    const td = resolveTimestamp(b) - resolveTimestamp(a);
    if (td !== 0) return td;
    const ud = resolveUpvotes(b) - resolveUpvotes(a);
    return ud !== 0 ? ud : b.id - a.id;
  });
  return sorted;
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface UseGalleryParams {
  // Thin shared state (owned by PaintScreen, passed here to avoid circular deps)
  galleryEntries: DailyPaintGalleryEntry[];
  setGalleryEntries: React.Dispatch<React.SetStateAction<DailyPaintGalleryEntry[]>>;
  galleryLanguage: string;
  setGalleryLanguage: React.Dispatch<React.SetStateAction<string>>;

  // Device
  deviceId: string | null;
  resolveDeviceId: () => Promise<string>;

  // Settings
  parentalControls: ParentalControlsSettings;

  // Leaderboard integration
  mergeGalleryWithLeaderboard: (
    entries: DailyPaintGalleryEntry[],
    leaderboardSource?: PrivateStudioLeaderboardEntry[]
  ) => DailyPaintGalleryEntry[];
  leaderboardEntriesRef: React.MutableRefObject<PrivateStudioLeaderboardEntry[]>;
  fetchPrivateStudioLeaderboardFn?: () => Promise<PrivateStudioLeaderboardEntry[]>;

  // Friends
  friendsDeviceIds: Set<string>;
  setFriendsDeviceIds: (ids: Set<string>) => void;

  // Notifications
  notificationService: { notifyMysterySolved: () => Promise<void> };

  // Coins
  awardCoins: (amount: number) => void;

  // Info panel
  infoVisible: boolean;
  setInfoVisible: (v: boolean) => void;

  // Gallery visit tracking (easter egg)
  galleryVisitedThisSession: boolean;
  setGalleryVisitedThisSession: (v: boolean) => void;

  // Tutorial
  tutorialActive: boolean;
  tutorialCurrentLesson: number;
  completeTutorialLesson: () => void;
  tutorialGalleryOpenedRef: React.MutableRefObject<boolean>;

  // Challenge overlay (affects gallery modal visibility check in JSX)
  challengeCompleteVisible: boolean;

  // Late-callback registration for onboarding
  onboardingLateCallbacksRef: React.MutableRefObject<{
    openGallery: () => void;
    refreshGallery: (mode: GalleryMode, opts?: { force?: boolean }) => void;
    [key: string]: unknown;
  }>;

  // For closeGallery: dismiss the external passport overlay and return to profile
  consumeReturnToProfile: () => void;
}

export interface UseGalleryResult {
  // Pass-through thin state
  galleryEntries: DailyPaintGalleryEntry[];
  setGalleryEntries: React.Dispatch<React.SetStateAction<DailyPaintGalleryEntry[]>>;
  galleryLanguage: string;
  setGalleryLanguage: React.Dispatch<React.SetStateAction<string>>;

  // Core visibility
  galleryVisible: boolean;
  setGalleryVisible: React.Dispatch<React.SetStateAction<boolean>>;
  openGallery: () => void;
  closeGallery: () => void;

  // Loading / error
  galleryLoading: boolean;
  setGalleryLoading: React.Dispatch<React.SetStateAction<boolean>>;
  galleryRefreshing: boolean;
  galleryLoadingMore: boolean;
  setGalleryLoadingMore: React.Dispatch<React.SetStateAction<boolean>>;
  galleryError: string | null;
  setGalleryError: React.Dispatch<React.SetStateAction<string | null>>;

  // Pagination
  galleryPage: number;
  setGalleryPage: React.Dispatch<React.SetStateAction<number>>;
  galleryPageCount: number;
  currentGalleryPage: number;
  visibleGalleryEntries: DailyPaintGalleryEntry[];
  activeGalleryEntries: DailyPaintGalleryEntry[];
  gallerySections: any[];
  galleryExtraData: object;
  galleryStatsText: string;

  // Voting
  galleryVotePending: Record<number, boolean>;
  setGalleryVotePending: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  handleGalleryVote: (entry: DailyPaintGalleryEntry, direction: DailyPaintGalleryVoteDirection) => Promise<void>;

  // Selected entries (viewer)
  gallerySelectedEntry: DailyPaintGalleryEntry | null;
  setGallerySelectedEntry: React.Dispatch<React.SetStateAction<DailyPaintGalleryEntry | null>>;
  gallerySelectedPassport: DailyPaintGalleryEntry | null;
  setGallerySelectedPassport: React.Dispatch<React.SetStateAction<DailyPaintGalleryEntry | null>>;
  profileOverlayEntry: DailyPaintGalleryEntry | null;
  setProfileOverlayEntry: React.Dispatch<React.SetStateAction<DailyPaintGalleryEntry | null>>;
  galleryPassportEntry: DailyPaintGalleryEntry | null;
  setGalleryPassportEntry: React.Dispatch<React.SetStateAction<DailyPaintGalleryEntry | null>>;

  // Mode / layout
  galleryMode: GalleryMode;
  setGalleryMode: React.Dispatch<React.SetStateAction<GalleryMode>>;
  galleryModeRef: React.MutableRefObject<GalleryMode>;
  galleryLayout: GalleryLayoutMode;
  setGalleryLayout: React.Dispatch<React.SetStateAction<GalleryLayoutMode>>;
  galleryUpdatedAt: string | null;
  galleryModePickerVisible: boolean;
  setGalleryModePickerVisible: React.Dispatch<React.SetStateAction<boolean>>;
  handleGalleryModeChange: (nextMode: GalleryMode) => void;

  // Language
  galleryLanguageOptions: GalleryLanguageOption[];
  galleryDefaultLanguage: string;
  activeLanguageOption: GalleryLanguageOption;
  galleryLanguagePickerVisible: boolean;
  setGalleryLanguagePickerVisible: React.Dispatch<React.SetStateAction<boolean>>;

  // All entries for the current page — no gating. Kept as a distinct name from
  // visibleGalleryEntries for prop-shape compatibility with existing callers.
  revealedGalleryEntries: DailyPaintGalleryEntry[];

  // Animated frames
  galleryAnimatedFrames: Record<number, number>;
  setGalleryAnimatedFrames: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  galleryImageLastTapRef: React.MutableRefObject<{ id: number | null; timestamp: number }>;

  // Offline gallery
  offlineGalleryEntries: DailyPaintGalleryEntry[];
  offlineEntryCount: number;
  offlineMysteryEntries: DailyPaintGalleryEntry[];
  showOfflineMysteryGallery: boolean;
  setShowOfflineMysteryGallery: React.Dispatch<React.SetStateAction<boolean>>;
  mysteryButtonBlinkOpacity: RNAnimated.Value;
  mysteryButtonBlinkScale: RNAnimated.Value;
  isOfflineGalleryMode: boolean;
  loadOfflineGallery: () => Promise<void>;

  // Passport viewer (rendered outside gallery Modal at zIndex 20000)
  galleryPassportViewerVisible: boolean;
  setGalleryPassportViewerVisible: React.Dispatch<React.SetStateAction<boolean>>;
  galleryPassportViewerUser: any | null;
  setGalleryPassportViewerUser: React.Dispatch<React.SetStateAction<any | null>>;
  galleryPassportViewerScale: RNAnimated.Value;
  openGalleryPassportViewer: (userData: any) => void;
  closeGalleryPassportViewer: () => void;

  // Gallery visit
  galleryVisitedThisSession: boolean;
  setGalleryVisitedThisSession: (v: boolean) => void;
  shouldAutoOpenGallery: boolean;
  setShouldAutoOpenGallery: React.Dispatch<React.SetStateAction<boolean>>;

  // Friends
  friendsDeviceIds: Set<string>;
  setFriendsDeviceIds: (ids: Set<string>) => void;

  // Gallery viewer animations (Reanimated shared values + RN Animated)
  galleryViewerScale: ReturnType<typeof useSharedValue<number>>;
  galleryViewerBaseScale: ReturnType<typeof useSharedValue<number>>;
  galleryViewerModalScale: RNAnimated.Value;
  galleryViewerModalOpacity: RNAnimated.Value;
  openGalleryViewer: (entry: DailyPaintGalleryEntry) => void;
  closeGalleryViewer: () => void;
  resetGalleryViewer: () => void;

  // Refs
  galleryLastFetchedRef: React.MutableRefObject<number>;
  galleryNeedsRefreshRef: React.MutableRefObject<boolean>;
  notifiedSolvedMysteriesRef: React.MutableRefObject<Set<string | number>>;

  // Core actions
  refreshGallery: (mode: GalleryMode, opts?: { force?: boolean }) => Promise<void>;
  sortGalleryEntriesCallback: (entries: DailyPaintGalleryEntry[], modeOverride?: GalleryMode) => DailyPaintGalleryEntry[];

  // Format helpers
  formatGalleryRunDate: (timestamp?: number | null) => string | null;
  formatGalleryDuration: (durationSec?: number | null, topic?: string) => string | null;
  getGalleryTravelerName: (entry: DailyPaintGalleryEntry) => string;
  createGalleryEntryFromUpload: (result: DailyPaintUploadResult, fallbackTopic: string) => DailyPaintGalleryEntry | null;

  // Guess / mystery state
  guessedPaintings: Set<number>;
  setGuessedPaintings: React.Dispatch<React.SetStateAction<Set<number>>>;
  guessAttempts: Record<number, number>;
  setGuessAttempts: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  guessOverlayVisible: boolean;
  setGuessOverlayVisible: React.Dispatch<React.SetStateAction<boolean>>;
  guessInput: string;
  setGuessInput: React.Dispatch<React.SetStateAction<string>>;
  selectedMysteryPainting: DailyPaintGalleryEntry | null;
  setSelectedMysteryPainting: React.Dispatch<React.SetStateAction<DailyPaintGalleryEntry | null>>;
  guessLoading: boolean;
  guessFeedback: { type: 'success' | 'error'; message: string } | null;
  guessInputRef: React.RefObject<any>;
  guessWinVisible: boolean;
  guessWinStyleIdx: number;
  guessAllDone: boolean;
  guessWinParticles: Array<{
    tx: RNAnimated.Value; ty: RNAnimated.Value; op: RNAnimated.Value;
    sc: RNAnimated.Value; rot: RNAnimated.Value;
  }>;
  handleOpenGuessOverlay: (painting: DailyPaintGalleryEntry) => void;
  handleSubmitGuess: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGallery(params: UseGalleryParams): UseGalleryResult {
  const {
    galleryEntries, setGalleryEntries,
    galleryLanguage, setGalleryLanguage,
    deviceId, resolveDeviceId,
    parentalControls,
    mergeGalleryWithLeaderboard, leaderboardEntriesRef,
    fetchPrivateStudioLeaderboardFn,
    friendsDeviceIds, setFriendsDeviceIds,
    notificationService,
    awardCoins,
    infoVisible, setInfoVisible,
    galleryVisitedThisSession, setGalleryVisitedThisSession,
    tutorialActive, tutorialCurrentLesson, completeTutorialLesson, tutorialGalleryOpenedRef,
    challengeCompleteVisible,
    onboardingLateCallbacksRef,
    consumeReturnToProfile,
  } = params;

  const fetchLeaderboard = fetchPrivateStudioLeaderboardFn ?? fetchPrivateStudioLeaderboard;

  // ── Core visibility ───────────────────────────────────────────────────────
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryRefreshing, setGalleryRefreshing] = useState(false);
  const [galleryLoadingMore, setGalleryLoadingMore] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);

  // ── Pagination ────────────────────────────────────────────────────────────
  const [galleryPage, setGalleryPage] = useState(1);

  // ── Voting ────────────────────────────────────────────────────────────────
  const [galleryVotePending, setGalleryVotePending] = useState<Record<number, boolean>>({});

  // ── Selected entries ──────────────────────────────────────────────────────
  const [gallerySelectedEntry, setGallerySelectedEntry] = useState<DailyPaintGalleryEntry | null>(null);
  const [gallerySelectedPassport, setGallerySelectedPassport] = useState<DailyPaintGalleryEntry | null>(null);
  const [profileOverlayEntry, setProfileOverlayEntry] = useState<DailyPaintGalleryEntry | null>(null);
  const [galleryPassportEntry, setGalleryPassportEntry] = useState<DailyPaintGalleryEntry | null>(null);

  // ── Mode / layout ─────────────────────────────────────────────────────────
  const [galleryMode, setGalleryMode] = useState<GalleryMode>('new');
  const galleryModeRef = useRef<GalleryMode>('new');
  const [galleryLayout, setGalleryLayout] = useState<GalleryLayoutMode>('default');
  const [galleryUpdatedAt, setGalleryUpdatedAt] = useState<string | null>(null);
  const [galleryLanguagePickerVisible, setGalleryLanguagePickerVisible] = useState(false);
  const [galleryModePickerVisible, setGalleryModePickerVisible] = useState(false);

  const [galleryAnimatedFrames, setGalleryAnimatedFrames] = useState<Record<number, number>>({});
  const galleryImageLastTapRef = useRef<{ id: number | null; timestamp: number }>({ id: null, timestamp: 0 });

  // ── Offline gallery ───────────────────────────────────────────────────────
  const [offlineGalleryEntries, setOfflineGalleryEntries] = useState<DailyPaintGalleryEntry[]>([]);
  const [offlineEntryCount, setOfflineEntryCount] = useState(0);
  const [offlineMysteryEntries, setOfflineMysteryEntries] = useState<DailyPaintGalleryEntry[]>([]);
  const [showOfflineMysteryGallery, setShowOfflineMysteryGallery] = useState(false);
  const mysteryButtonBlinkOpacity = useRef(new RNAnimated.Value(1)).current;
  const mysteryButtonBlinkScale = useRef(new RNAnimated.Value(1)).current;
  const offlineMysteryAutoLoadRef = useRef(false);

  // ── Passport viewer ───────────────────────────────────────────────────────
  const [galleryPassportViewerVisible, setGalleryPassportViewerVisible] = useState(false);
  const [galleryPassportViewerUser, setGalleryPassportViewerUser] = useState<any | null>(null);
  const galleryPassportViewerScale = useRef(new RNAnimated.Value(0)).current;

  // ── Auto-open flag ────────────────────────────────────────────────────────
  const [shouldAutoOpenGallery, setShouldAutoOpenGallery] = useState(false);

  // ── Viewer animations (Reanimated) ────────────────────────────────────────
  const galleryViewerScale = useSharedValue(1);
  const galleryViewerBaseScale = useSharedValue(1);
  const galleryViewerModalScale = useRef(new RNAnimated.Value(0.3)).current;
  const galleryViewerModalOpacity = useRef(new RNAnimated.Value(0)).current;

  // ── Refs ──────────────────────────────────────────────────────────────────
  const galleryLastFetchedRef = useRef(0);
  const galleryNeedsRefreshRef = useRef(false);
  const notifiedSolvedMysteriesRef = useRef<Set<string | number>>(new Set());

  // ── Guess / mystery state ─────────────────────────────────────────────────
  const [guessedPaintings, setGuessedPaintings] = useState<Set<number>>(new Set());
  const [guessAttempts, setGuessAttempts] = useState<Record<number, number>>({});
  const [guessOverlayVisible, setGuessOverlayVisible] = useState(false);
  const [guessInput, setGuessInput] = useState('');
  const [selectedMysteryPainting, setSelectedMysteryPainting] = useState<DailyPaintGalleryEntry | null>(null);
  const [guessLoading, setGuessLoading] = useState(false);
  const [guessFeedback, setGuessFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const guessInputRef = useRef<any>(null);
  const [guessWinVisible, setGuessWinVisible] = useState(false);
  const [guessWinStyleIdx, setGuessWinStyleIdx] = useState(0);
  const [guessAllDone, setGuessAllDone] = useState(false);
  const guessWinParticles = useRef(
    Array.from({ length: 24 }, () => ({
      tx: new RNAnimated.Value(0),
      ty: new RNAnimated.Value(0),
      op: new RNAnimated.Value(0),
      sc: new RNAnimated.Value(1),
      rot: new RNAnimated.Value(0),
    }))
  ).current;

  // ── Language options ──────────────────────────────────────────────────────
  const galleryLanguageOptions = useMemo<GalleryLanguageOption[]>(() => {
    return TOPIC_LANGUAGES.map((code) => {
      const base = LANGUAGE_FLAG_MAP[code] ?? { flag: '🏳️', label: code.toUpperCase() };
      return { id: code, flag: base.flag, label: base.label };
    });
  }, []);

  const preferredGalleryLanguage = useMemo(() => {
    if (galleryLanguageOptions.length === 0) return null;
    const idx = new Map<string, string>();
    galleryLanguageOptions.forEach((o) => idx.set(o.id.toLowerCase(), o.id));
    const consider = (code?: string | null): string | null => {
      if (!code) return null;
      const n = code.toLowerCase();
      const d = idx.get(n);
      if (d) return d;
      const base = n.split(/[-_]/)[0];
      return base ? (idx.get(base) ?? null) : null;
    };
    for (const c of collectDeviceLanguageCandidates()) {
      const m = consider(c);
      if (m) return m;
    }
    return null;
  }, [galleryLanguageOptions]);

  const galleryDefaultLanguage = useMemo(
    () =>
      preferredGalleryLanguage ??
      galleryLanguageOptions.find((o) => o.id === GALLERY_LANGUAGE_DEFAULT)?.id ??
      galleryLanguageOptions[0]?.id ??
      GALLERY_LANGUAGE_DEFAULT,
    [galleryLanguageOptions, preferredGalleryLanguage]
  );

  const activeLanguageOption = useMemo<GalleryLanguageOption>(() => {
    const fallback = galleryLanguageOptions[0];
    return (
      galleryLanguageOptions.find((o) => o.id === galleryLanguage) ??
      fallback ?? { id: galleryLanguage, flag: '🏳️', label: galleryLanguage.toUpperCase() }
    );
  }, [galleryLanguage, galleryLanguageOptions]);

  // Sync language if options change and current value is no longer valid
  useEffect(() => {
    if (!galleryLanguageOptions.some((o) => o.id === galleryLanguage)) {
      setGalleryLanguage(galleryDefaultLanguage);
    }
  }, [galleryDefaultLanguage, galleryLanguage, galleryLanguageOptions, setGalleryLanguage]);

  // ── Offline mode ──────────────────────────────────────────────────────────
  const isOfflineGalleryMode = parentalControls.offlineMode;

  const adaptOfflineEntries = useCallback(
    (entries: OfflineGalleryEntry[]): DailyPaintGalleryEntry[] =>
      entries.map((e) => ({
        id: -(e.id + 100_000),
        imageUrl: e.imageUri,
        rawUrl: e.imageUri,
        topic: e.topic,
        createdAt: e.createdAt,
        durationSec: e.durationSec ?? undefined,
        isMysteryPaint: e.isMysteryPaint === 1,
        mysteryTopicText: e.mysteryTopicText ?? undefined,
        mysteryTopicId: 0,
        passportName: null,
        passportPortrait: null,
        deviceId: null,
        rank: undefined,
        coins: undefined,
        upvotes: 0,
        downvotes: 0,
        userVote: null,
      })),
    []
  );

  const loadOfflineGallery = useCallback(async () => {
    const raw = await getOfflineEntries();
    setOfflineEntryCount(raw.length);
    setOfflineGalleryEntries(adaptOfflineEntries(raw));
  }, [adaptOfflineEntries]);

  const loadOfflineMysteryCache = useCallback(async () => {
    const [newCached, mysteryCached] = await Promise.all([
      getCachedGalleryForOffline('new'),
      getCachedGalleryForOffline('mystery'),
    ]);
    const allCached = [...newCached, ...mysteryCached];
    const seen = new Set<number>();
    const mysteryOnly = allCached.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return e.isMysteryPaint === true;
    });
    const adapted = mysteryOnly.map((e) => ({
      id: e.id, imageUrl: e.imageUrl, rawUrl: e.rawUrl, topic: e.topic,
      createdAt: e.createdAt, challengeAt: e.challengeAt, durationSec: e.durationSec,
      width: e.width, height: e.height, deviceId: e.deviceId,
      passportName: e.passportName, passportPortrait: e.passportPortrait,
      frameUrls: e.frameUrls, frameCount: e.frameCount, coinCount: e.coinCount,
      coins: e.coins, rank: e.rank, uploadedAt: e.uploadedAt, updatedAt: e.updatedAt,
      upvotes: e.upvotes, downvotes: e.downvotes, isMysteryPaint: true as const,
      mysteryPaintingId: e.mysteryPaintingId, mysteryTopicText: e.mysteryTopicText,
      isSolved: e.isSolved === true, solverName: e.solverName,
      solveCount: e.solveCount, totalAttempts: e.totalAttempts,
    } as DailyPaintGalleryEntry));
    setOfflineMysteryEntries(adapted);
    setShowOfflineMysteryGallery(true);
    if (galleryModeRef.current !== 'mystery') {
      setGalleryMode('mystery');
      galleryModeRef.current = 'mystery';
    }
    return adapted.length;
  }, []);

  // Auto-load mystery cache when offline + gallery opens with 0 local paintings
  useEffect(() => {
    if (!isOfflineGalleryMode || !galleryVisible) return;
    if (offlineEntryCount !== 0) return;
    if (offlineMysteryAutoLoadRef.current) return;
    offlineMysteryAutoLoadRef.current = true;

    let cancelled = false;
    const blink = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(mysteryButtonBlinkOpacity, { toValue: 0.2, duration: 300, useNativeDriver: true }),
        RNAnimated.timing(mysteryButtonBlinkOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]), { iterations: 4 }
    );
    const pulse = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(mysteryButtonBlinkScale, { toValue: 1.07, duration: 300, useNativeDriver: true }),
        RNAnimated.timing(mysteryButtonBlinkScale, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]), { iterations: 4 }
    );
    blink.start();
    pulse.start();
    const timer = setTimeout(() => {
      if (!cancelled) {
        blink.stop(); pulse.stop();
        mysteryButtonBlinkOpacity.setValue(1);
        mysteryButtonBlinkScale.setValue(1);
        void loadOfflineMysteryCache();
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      blink.stop(); pulse.stop();
      mysteryButtonBlinkOpacity.setValue(1);
      mysteryButtonBlinkScale.setValue(1);
    };
  }, [isOfflineGalleryMode, galleryVisible, offlineEntryCount, loadOfflineMysteryCache, mysteryButtonBlinkOpacity, mysteryButtonBlinkScale]);

  useEffect(() => {
    if (!galleryVisible) offlineMysteryAutoLoadRef.current = false;
  }, [galleryVisible]);

  // ── Derived gallery entries / page count ──────────────────────────────────
  const activeGalleryEntries = isOfflineGalleryMode
    ? (showOfflineMysteryGallery && galleryMode === 'mystery' ? offlineMysteryEntries : offlineGalleryEntries)
    : galleryEntries;

  const galleryPageCount = useMemo(
    () => Math.max(1, Math.ceil(Math.max(activeGalleryEntries.length, 0) / GALLERY_PAGE_SIZE)),
    [activeGalleryEntries.length]
  );

  useEffect(() => {
    setGalleryPage((prev) => {
      const clamped = Math.min(Math.max(1, prev), galleryPageCount);
      return clamped === prev ? prev : clamped;
    });
  }, [galleryPageCount]);

  useEffect(() => { setGalleryPage(1); }, [galleryMode]);

  useEffect(() => {
    galleryModeRef.current = galleryMode;
  }, [galleryMode]);

  const currentGalleryPage = useMemo(
    () => Math.min(Math.max(1, galleryPage), galleryPageCount),
    [galleryPage, galleryPageCount]
  );

  const visibleGalleryEntries = useMemo(() => {
    if (activeGalleryEntries.length === 0) return [];
    const start = (currentGalleryPage - 1) * GALLERY_PAGE_SIZE;
    return activeGalleryEntries.slice(start, start + GALLERY_PAGE_SIZE);
  }, [currentGalleryPage, activeGalleryEntries]);

  const galleryStatsText = useMemo(() => {
    const count = `${galleryEntries.length.toLocaleString()} ${galleryEntries.length === 1 ? 'upload' : 'uploads'}`;
    const modeLabel =
      galleryMode === 'hot' ? 'Trending uploads' :
      galleryMode === 'mystery' ? 'Mystery posts' :
      galleryMode === 'friends' ? 'Friends uploads' : 'Newest uploads';
    return `${modeLabel} • Page ${currentGalleryPage}/${galleryPageCount} • ${count}`;
  }, [currentGalleryPage, galleryEntries.length, galleryMode, galleryPageCount]);

  const gallerySections = useMemo(() => {
    if (visibleGalleryEntries.length === 0) return [];
    const map = new Map<string, DailyPaintGalleryEntry[]>();
    visibleGalleryEntries.forEach((entry) => {
      const timestamp = entry.challengeAt ?? entry.createdAt ?? null;
      const date =
        timestamp != null && Number.isFinite(timestamp)
          ? new Date(toEpochMs(timestamp)).toISOString().slice(0, 10)
          : 'unknown';
      const bucket = map.get(date);
      if (bucket) bucket.push(entry);
      else map.set(date, [entry]);
    });
    return Array.from(map.entries())
      .map(([date, data]) => {
        const parsed = date !== 'unknown' ? new Date(date) : null;
        if (parsed) {
          return {
            key: date,
            title: parsed.toLocaleDateString(undefined, { weekday: 'long' }),
            subtitle: parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
            data,
          };
        }
        return { key: date, title: 'Unknown date', subtitle: 'Entries without a timestamp', data };
      })
      .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  }, [visibleGalleryEntries]);

  const galleryExtraData = useMemo(() => ({
    galleryVotePending,
    galleryLanguage,
    galleryPage,
    galleryMode,
    galleryLayout,
    guessedPaintings,
    guessAttempts,
  }), [galleryVotePending, galleryLanguage, galleryPage, galleryMode, galleryLayout, guessedPaintings, guessAttempts]);

  // Used to gate the list to a staggered "reveal next card only once the previous card's image
  // finished loading" chain, reset to a bare 3 items on every layout switch and any transient
  // empty state. That chain depended on EVERY card's image/video succeeding (or erroring) to
  // advance — a video card in particular shares a global 3-concurrent load queue (see
  // GalleryThumb/SmartVideoCard), so a slow network or a queued video could stall the whole list
  // indefinitely at ~4 items, and switching layout replayed the same fragile climb from scratch.
  // The page's entries are already loaded in memory — just show all of them.
  const revealedGalleryEntries = visibleGalleryEntries;

  // ── sortGalleryEntries callback (wraps standalone, uses galleryModeRef) ────
  const sortGalleryEntriesCallback = useCallback(
    (entries: DailyPaintGalleryEntry[], modeOverride?: GalleryMode) =>
      sortGalleryEntries(entries, modeOverride ?? galleryModeRef.current),
    []
  );

  // ── refreshGallery ────────────────────────────────────────────────────────
  const refreshGallery = useCallback(
    async (mode: GalleryMode, { force = false }: { force?: boolean } = {}) => {
      setGalleryError(null);

      if (parentalControls.offlineMode) {
        setGalleryLoading(true);
        try { await loadOfflineGallery(); }
        finally { setGalleryLoading(false); setGalleryRefreshing(false); }
        return;
      }

      if (galleryEntries.length === 0) setGalleryLoading(true);
      else setGalleryRefreshing(true);

      try {
        const sanitizedId =
          typeof deviceId === 'string' && deviceId.trim().length > 0
            ? deviceId.trim()
            : undefined;
        const fetchSort: DailyPaintGallerySort = mode === 'hot' ? 'hot' : 'new';

        const [leaderboardResult, entries] = await Promise.all([
          fetchLeaderboard().catch((err: unknown) => {
            console.warn('[Gallery] Leaderboard fetch failed:', err instanceof Error ? err.message : err);
            return leaderboardEntriesRef.current;
          }),
          fetchDailyPaintGallery({ sort: fetchSort, limit: GALLERY_FETCH_LIMIT, deviceId: sanitizedId, force }),
        ]);

        let freshLeaderboard: PrivateStudioLeaderboardEntry[] =
          leaderboardResult ?? leaderboardEntriesRef.current;
        if (freshLeaderboard && freshLeaderboard.length > 0) {
          leaderboardEntriesRef.current = freshLeaderboard;
        } else {
          freshLeaderboard = leaderboardEntriesRef.current;
        }

        const trimmed = entries.map((e) => ({
          ...e,
          deviceId: typeof e.deviceId === 'string' && e.deviceId.trim().length > 0
            ? e.deviceId.trim()
            : e.deviceId ?? null,
        }));
        let enriched = mergeGalleryWithLeaderboard(trimmed, freshLeaderboard);

        if (mode === 'personal' && sanitizedId) {
          enriched = enriched.filter((e) => e.deviceId === sanitizedId);
        }
        if (mode === 'mystery') {
          enriched = enriched.filter((e) => e.isMysteryPaint === true);
        }
        if (mode === 'friends' && sanitizedId) {
          let currentFriendIds = friendsDeviceIds;
          try {
            const { GesserApi } = await import('../../gesser/api/gesserClient');
            const fr = await GesserApi.listFriends(sanitizedId);
            const freshIds = new Set<string>(
              fr.friends.map((f) => f.deviceId.trim().toLowerCase()).filter((id) => id.length > 0)
            );
            setFriendsDeviceIds(freshIds);
            currentFriendIds = freshIds;
          } catch (err) {
            console.warn('[Gallery] Friends list fetch failed:', err);
          }
          enriched = currentFriendIds.size === 0
            ? []
            : enriched.filter((e) => {
                const id = typeof e.deviceId === 'string' ? e.deviceId.trim().toLowerCase() : '';
                return id.length > 0 && currentFriendIds.has(id);
              });
        }

        const sorted = sortGalleryEntries(enriched, mode);
        setGalleryEntries(sorted);

        if (sanitizedId) {
          for (const entry of sorted) {
            if (
              entry.isMysteryPaint &&
              entry.deviceId &&
              entry.deviceId.trim().toLowerCase() === sanitizedId.toLowerCase() &&
              (entry.isSolved === true || (entry.solveCount ?? 0) > 0)
            ) {
              const key = entry.mysteryPaintingId ?? entry.id;
              if (key != null && !notifiedSolvedMysteriesRef.current.has(key)) {
                notifiedSolvedMysteriesRef.current.add(key);
                notificationService.notifyMysterySolved().catch(() => {});
              }
            }
          }
        }

        if (enriched.length > 0) {
          const latest = enriched.reduce<number | null>((acc, e) => {
            const src = e.updatedAt ?? e.uploadedAt ?? null;
            if (!src) return acc;
            const p = Date.parse(src);
            if (Number.isNaN(p)) return acc;
            return acc === null || p > acc ? p : acc;
          }, null);
          setGalleryUpdatedAt(latest != null ? new Date(latest).toISOString() : new Date().toISOString());
        } else {
          setGalleryUpdatedAt(null);
        }
        galleryLastFetchedRef.current = Date.now();
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : 'Gallery currently unavailable.';
        setGalleryError(message);
        setGalleryUpdatedAt(null);
      } finally {
        setGalleryLoading(false);
        setGalleryRefreshing(false);
      }
    },
    [deviceId, galleryEntries.length, mergeGalleryWithLeaderboard, fetchLeaderboard, leaderboardEntriesRef, parentalControls, loadOfflineGallery, friendsDeviceIds, notificationService, setGalleryEntries, setFriendsDeviceIds]
  );

  // ── openGallery / closeGallery ────────────────────────────────────────────
  const openGallery = useCallback(() => {
    if (galleryVisible) return;
    if (parentalControls.enabled && !parentalControls.allowGalleryView) {
      Alert.alert('Gallery Restricted', 'A parent has disabled gallery access.\nOpen Parental Controls to change this.');
      return;
    }
    if (infoVisible) setInfoVisible(false);
    setGalleryVisible(true);
    setGalleryLanguagePickerVisible(false);
    setGalleryModePickerVisible(false);

    if (!galleryVisitedThisSession) {
      setGalleryVisitedThisSession(true);
    }

    if (tutorialActive && tutorialCurrentLesson === 3 && !tutorialGalleryOpenedRef.current) {
      tutorialGalleryOpenedRef.current = true;
      completeTutorialLesson();
    }

    const randomLayout = galleryLayoutModes[Math.floor(Math.random() * galleryLayoutModes.length)];
    setGalleryLayout(randomLayout);

    const now = Date.now();
    const stale = now - galleryLastFetchedRef.current > GALLERY_STALE_THRESHOLD_MS;
    const shouldForce = galleryNeedsRefreshRef.current || stale || !!galleryError;
    galleryNeedsRefreshRef.current = false;

    if (galleryEntries.length === 0) {
      setGalleryLoading(true);
      void resetDailyPaintGalleryCache();
      void refreshGallery(galleryModeRef.current, { force: true });
    } else if (shouldForce) {
      void resetDailyPaintGalleryCache();
      void refreshGallery(galleryModeRef.current, { force: shouldForce });
    }
  }, [galleryEntries.length, galleryError, galleryVisible, infoVisible, refreshGallery, setInfoVisible, tutorialActive, tutorialCurrentLesson, completeTutorialLesson, tutorialGalleryOpenedRef, galleryVisitedThisSession, setGalleryVisitedThisSession, parentalControls]);

  const closeGallery = useCallback(() => {
    if (!galleryVisible) return;
    setGalleryVisible(false);
    setGallerySelectedEntry(null);
    setGalleryPassportEntry(null);
    setGalleryLanguagePickerVisible(false);
    setGalleryModePickerVisible(false);
    setGalleryPassportViewerVisible(false);
    setGalleryPassportViewerUser(null);
    galleryPassportViewerScale.setValue(0);
    consumeReturnToProfile();
  }, [galleryVisible, galleryPassportViewerScale, consumeReturnToProfile]);

  // Bind late callbacks for onboarding hook
  onboardingLateCallbacksRef.current.openGallery = openGallery;
  onboardingLateCallbacksRef.current.refreshGallery = refreshGallery;

  // ── Mode change ───────────────────────────────────────────────────────────
  const handleGalleryModeChange = useCallback(
    (nextMode: GalleryMode) => {
      if (galleryModeRef.current === nextMode) return;
      setGalleryMode(nextMode);
      galleryModeRef.current = nextMode;
      galleryLastFetchedRef.current = 0;
      galleryNeedsRefreshRef.current = false;
      if (nextMode === 'mystery') {
        invalidateGalleryCache();
      } else {
        setShowOfflineMysteryGallery(false);
      }
      setGalleryEntries([]);
      setGalleryPage(1);
      void refreshGallery(nextMode, { force: true });
    },
    [refreshGallery, setGalleryEntries]
  );

  // Re-fetch when mode changes while gallery is open
  useEffect(() => {
    if (!galleryVisible) return;
    galleryModeRef.current = galleryMode;
    void refreshGallery(galleryMode, { force: true });
  }, [galleryMode, galleryVisible, refreshGallery]);

  // ── Gallery viewer ────────────────────────────────────────────────────────
  const resetGalleryViewer = useCallback(() => {
    galleryViewerScale.value = withTiming(1, { duration: 160 });
    galleryViewerBaseScale.value = 1;
  }, [galleryViewerBaseScale, galleryViewerScale]);

  const openGalleryViewer = useCallback(
    (entry: DailyPaintGalleryEntry) => {
      console.log('[Gallery] Opening viewer for entry:', entry.id, 'challengeCompleteVisible:', challengeCompleteVisible);
      setGallerySelectedPassport(null);
      setGallerySelectedEntry(entry);
      galleryViewerScale.value = 1;
      galleryViewerBaseScale.value = 1;
      galleryViewerModalScale.setValue(0.3);
      galleryViewerModalOpacity.setValue(0);
      setTimeout(() => {
        RNAnimated.parallel([
          RNAnimated.spring(galleryViewerModalScale, { toValue: 1, tension: 65, friction: 9, useNativeDriver: true }),
          RNAnimated.timing(galleryViewerModalOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]).start();
      }, 50);
    },
    [galleryViewerBaseScale, galleryViewerScale, galleryViewerModalScale, galleryViewerModalOpacity, challengeCompleteVisible]
  );

  const closeGalleryViewer = useCallback(() => {
    RNAnimated.parallel([
      RNAnimated.timing(galleryViewerModalScale, { toValue: 0.8, duration: 150, useNativeDriver: true }),
      RNAnimated.timing(galleryViewerModalOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setGallerySelectedEntry(null);
      setGallerySelectedPassport(null);
      galleryViewerScale.value = 1;
      galleryViewerBaseScale.value = 1;
    });
  }, [galleryViewerBaseScale, galleryViewerScale, galleryViewerModalScale, galleryViewerModalOpacity]);

  // Reset viewer zoom when selected entry changes
  useEffect(() => {
    if (!gallerySelectedEntry && !gallerySelectedPassport) return;
    galleryViewerScale.value = 1;
    galleryViewerBaseScale.value = 1;
  }, [gallerySelectedEntry, gallerySelectedPassport, galleryViewerBaseScale, galleryViewerScale]);

  // ── Passport viewer ───────────────────────────────────────────────────────
  const openGalleryPassportViewer = useCallback((userData: any) => {
    setGalleryPassportViewerUser(userData);
    setGalleryPassportViewerVisible(true);
    galleryPassportViewerScale.setValue(0);
    RNAnimated.spring(galleryPassportViewerScale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }).start();
  }, [galleryPassportViewerScale]);

  const closeGalleryPassportViewer = useCallback(() => {
    RNAnimated.timing(galleryPassportViewerScale, {
      toValue: 0, duration: 200,
      easing: RNEasing.in(RNEasing.ease),
      useNativeDriver: true,
    }).start(() => {
      setGalleryPassportViewerVisible(false);
      setGalleryPassportViewerUser(null);
    });
  }, [galleryPassportViewerScale]);

  // ── Voting ────────────────────────────────────────────────────────────────
  const handleGalleryVote = useCallback(
    async (entry: DailyPaintGalleryEntry, direction: DailyPaintGalleryVoteDirection) => {
      if (entry.userVote || galleryVotePending[entry.id]) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      setGalleryEntries((prev) =>
        prev.map((item) =>
          item.id !== entry.id ? item : {
            ...item,
            upvotes: direction === 'up' ? (item.upvotes ?? 0) + 1 : item.upvotes,
            downvotes: direction === 'down' ? (item.downvotes ?? 0) + 1 : item.downvotes,
            userVote: direction,
          }
        )
      );
      setGalleryVotePending((prev) => ({ ...prev, [entry.id]: true }));

      try {
        const activeId = await resolveDeviceId();
        const result = await submitDailyPaintGalleryVote({ imageId: entry.id, direction, deviceId: activeId });
        const applied = result.direction ?? direction;
        await setStoredGalleryVote(entry.id, activeId, applied);
        mutateCachedGalleryEntry(entry.id, (cached) => {
          if (result.upvotes != null) cached.upvotes = result.upvotes;
          else if (applied === 'up') cached.upvotes = (cached.upvotes ?? 0) + 1;
          if (result.downvotes != null) cached.downvotes = result.downvotes;
          else if (applied === 'down') cached.downvotes = (cached.downvotes ?? 0) + 1;
        });
        setGalleryEntries((prev) =>
          sortGalleryEntries(
            prev.map((item) => {
              if (item.id !== entry.id) return item;
              return {
                ...item,
                userVote: applied,
                upvotes: result.upvotes != null ? result.upvotes : applied === 'up' ? (item.upvotes ?? 0) + 1 : item.upvotes ?? 0,
                downvotes: result.downvotes != null ? result.downvotes : applied === 'down' ? (item.downvotes ?? 0) + 1 : item.downvotes ?? 0,
              };
            }),
            galleryModeRef.current
          )
        );
        galleryNeedsRefreshRef.current = true;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        setGalleryEntries((prev) =>
          prev.map((item) =>
            item.id !== entry.id ? item : {
              ...item,
              upvotes: direction === 'up' ? Math.max(0, (item.upvotes ?? 0) - 1) : item.upvotes,
              downvotes: direction === 'down' ? Math.max(0, (item.downvotes ?? 0) - 1) : item.downvotes,
              userVote: null,
            }
          )
        );
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        console.error('[Gallery] Vote failed:', error instanceof Error ? error.message : error);
      } finally {
        setGalleryVotePending((prev) => { const next = { ...prev }; delete next[entry.id]; return next; });
      }
    },
    [galleryVotePending, resolveDeviceId, setGalleryEntries]
  );

  // ── Format helpers ────────────────────────────────────────────────────────
  const formatGalleryRunDate = useCallback((timestamp?: number | null) => {
    if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
    const date = new Date(toEpochMs(timestamp));
    try {
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
    } catch { return date.toLocaleDateString(); }
  }, []);

  const formatGalleryDuration = useCallback((durationSec?: number | null) => {
    if (durationSec != null && Number.isFinite(durationSec) && durationSec > 0) {
      const total = Math.floor(durationSec);
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      if (mins === 0) return `${secs}s`;
      return secs > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${mins} min`;
    }
    return null;
  }, []);

  const getGalleryTravelerName = useCallback((entry: DailyPaintGalleryEntry) => {
    if (typeof entry.passportName === 'string' && entry.passportName.trim().length > 0) return entry.passportName.trim();
    if (typeof entry.deviceId === 'string' && entry.deviceId.trim().length > 0) {
      return `Traveler ${entry.deviceId.trim().toUpperCase().slice(0, 6)}`;
    }
    // A null device id is the server's permanent anonymous-gallery state.
    if (typeof entry.passportPortrait === 'string' && entry.passportPortrait.trim().length > 0) return 'Passport traveler';
    return 'Anonymous Painter';
  }, []);

  const createGalleryEntryFromUpload = useCallback(
    (result: DailyPaintUploadResult, fallbackTopic: string): DailyPaintGalleryEntry | null => {
      if (typeof result.imageId !== 'number' || !result.imageUrl) return null;
      const entryPassportName =
        typeof result.passportName === 'string' && result.passportName.trim().length > 0
          ? result.passportName.trim() : undefined;
      const entryPassportPortrait =
        typeof result.passportPortrait === 'string' && result.passportPortrait.trim().length > 0
          ? result.passportPortrait.trim() : undefined;
      const topic = typeof result.topic === 'string' && result.topic.trim().length > 0
        ? result.topic.trim() : fallbackTopic;
      const createdAt = typeof result.createdAt === 'number' ? result.createdAt : Math.floor(Date.now() / 1_000);
      const rawDeviceId =
        typeof result.deviceId === 'string' && result.deviceId.trim().length > 0
          ? result.deviceId.trim()
          : typeof deviceId === 'string' && deviceId.trim().length > 0
            ? deviceId.trim() : null;
      const ownEntry = rawDeviceId
        ? leaderboardEntriesRef.current.find((u) => {
            const extras = u.extra ?? {};
            const candidates = [u.id, extras['machineId'], extras['machine_id'], extras['deviceId'], extras['device_id']];
            return candidates.some((c) => normalizeDeviceId(typeof c === 'string' ? c : undefined) === normalizeDeviceId(rawDeviceId));
          })
        : null;
      const resolvedName = entryPassportName ?? (ownEntry?.name && ownEntry.name !== 'Unnamed Passport' ? ownEntry.name : null) ?? null;
      const resolvedPortrait = entryPassportPortrait ?? (typeof ownEntry?.imageUrl === 'string' && ownEntry.imageUrl.length > 0 ? ownEntry.imageUrl : null) ?? null;

      return {
        id: result.imageId,
        imageUrl: result.imageUrl,
        rawUrl: typeof result.rawUrl === 'string' && result.rawUrl.length > 0 ? result.rawUrl : result.imageUrl,
        topic,
        createdAt,
        challengeAt: result.createdAt,
        durationSec: result.dailyTime,
        width: undefined,
        height: undefined,
        upvotes: 0,
        downvotes: 0,
        deviceId: rawDeviceId,
        passportName: resolvedName ?? undefined,
        passportPortrait: resolvedPortrait,
        rank: undefined,
        uploadedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userVote: null,
        isMysteryPaint: result.isMysteryPaint,
        mysteryPaintingId: result.mysteryPaintingId ?? null,
        mysteryTopicText: null,
        isSolved: result.isSolved,
      } as DailyPaintGalleryEntry;
    },
    [deviceId, leaderboardEntriesRef]
  );

  // ── Guess / mystery ───────────────────────────────────────────────────────
  const handleOpenGuessOverlay = useCallback((painting: DailyPaintGalleryEntry) => {
    if (guessedPaintings.has(painting.id)) {
      Alert.alert('Already Solved', 'You already got this one right! 🎉');
      return;
    }
    setSelectedMysteryPainting(painting);
    setGuessInput('');
    setGuessFeedback(null);
    setGuessOverlayVisible(true);
  }, [guessedPaintings]);

  const triggerWinHaptics = useCallback((durationMs: number) => {
    const styles = [
      Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Medium,
      Haptics.ImpactFeedbackStyle.Heavy, Haptics.ImpactFeedbackStyle.Rigid, Haptics.ImpactFeedbackStyle.Soft,
    ];
    let t = 0;
    while (t < durationMs) {
      const delay = t;
      setTimeout(() => void Haptics.impactAsync(styles[Math.floor(Math.random() * styles.length)]), delay);
      t += 60 + Math.floor(Math.random() * 180);
    }
    setTimeout(() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), durationMs);
  }, []);

  const triggerWinAnimation = useCallback((styleIdx: number) => {
    guessWinParticles.forEach((p) => {
      p.tx.setValue(0); p.ty.setValue(0); p.op.setValue(0); p.sc.setValue(0); p.rot.setValue(0);
    });
    setGuessWinStyleIdx(styleIdx);
    setGuessWinVisible(true);

    const anims = guessWinParticles.map((p, i) => {
      const n = guessWinParticles.length;
      const frac = i / n;
      const rand = () => Math.random();
      let toX = 0, toY = 0, toScale = 1.6, toRot = 0, dur = 1200, delay = 0;
      switch (styleIdx) {
        case 0: { const angle = (-Math.PI * 0.85) + frac * Math.PI * 0.7; const dist = 120 + rand() * 200; toX = Math.cos(angle) * dist; toY = Math.sin(angle) * dist - 60; toScale = 0.9 + rand() * 0.8; toRot = (rand() - 0.5) * 4; dur = 1000 + rand() * 600; delay = i * 40; break; }
        case 1: { const angle = frac * Math.PI * 2; const dist = 150 + rand() * 180; toX = Math.cos(angle) * dist; toY = Math.sin(angle) * dist; toScale = 1.2 + rand() * 1.0; toRot = rand() * 6; dur = 900 + rand() * 500; delay = i * 30; break; }
        case 2: { toX = (rand() - 0.5) * 800 * 0.9; toY = 400 + rand() * 400; toScale = 0.8 + rand() * 0.6; toRot = rand() * 8; dur = 1000 + rand() * 800; delay = rand() * 300; break; }
        case 3: { const angle = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 0.8; const dist = 80 + rand() * 280; toX = Math.cos(angle) * dist; toY = Math.sin(angle) * dist; toScale = 1.0 + rand() * 1.2; toRot = (rand() - 0.5) * 6; dur = 1100 + rand() * 600; delay = i * 35; break; }
        case 4: { const angle = frac * Math.PI * 4; const dist = 60 + i * 14; toX = Math.cos(angle) * dist; toY = Math.sin(angle) * dist; toScale = 1.4 + rand() * 0.8; toRot = rand() * 10; dur = 1200 + rand() * 400; delay = i * 25; break; }
        case 5: { toX = (rand() - 0.5) * 800 * 0.8; toY = 200 + rand() * 400; toScale = 1.0 + rand() * 0.8; toRot = (rand() - 0.5) * 3; dur = 1200 + rand() * 600; delay = rand() * 400; break; }
        case 6: { const angle = frac * Math.PI * 2; const dist = 100 + rand() * 250; toX = Math.cos(angle) * dist; toY = Math.sin(angle) * dist; toScale = 1.8 + rand() * 1.2; toRot = rand() * 12; dur = 700 + rand() * 400; delay = i * 20; break; }
      }
      return RNAnimated.sequence([
        RNAnimated.delay(delay),
        RNAnimated.parallel([
          RNAnimated.timing(p.op, { toValue: 1, duration: 120, useNativeDriver: true }),
          RNAnimated.timing(p.sc, { toValue: toScale, duration: dur * 0.4, useNativeDriver: true }),
          RNAnimated.timing(p.tx, { toValue: toX, duration: dur, useNativeDriver: true }),
          RNAnimated.timing(p.ty, { toValue: toY, duration: dur, useNativeDriver: true }),
          RNAnimated.timing(p.rot, { toValue: toRot, duration: dur, useNativeDriver: true }),
          RNAnimated.sequence([RNAnimated.delay(dur * 0.5), RNAnimated.timing(p.op, { toValue: 0, duration: dur * 0.5, useNativeDriver: true })]),
        ]),
      ]);
    });
    RNAnimated.parallel(anims).start(() => setGuessWinVisible(false));
    triggerWinHaptics(1000 + Math.floor(Math.random() * 2000));
  }, [guessWinParticles, triggerWinHaptics]);

  const handleSubmitGuess = useCallback(() => {
    if (!selectedMysteryPainting) return;
    const seed = selectedMysteryPainting.mysteryTopicId ?? 0;
    const actualTopic = selectedMysteryPainting.mysteryTopicText || selectedMysteryPainting.topic || '';
    const { masked } = _maskTopic(actualTopic, seed);
    const maskedChars = Array.from(masked) as string[];
    let bIdx = 0;
    const fullGuess = maskedChars.map((c) => (c === '_' ? (guessInput[bIdx++] ?? '') : c)).join('');
    if (bIdx > guessInput.length) return;

    setGuessAttempts((prev) => ({ ...prev, [selectedMysteryPainting.id]: (prev[selectedMysteryPainting.id] ?? 0) + 1 }));
    const newAttemptCount = (guessAttempts[selectedMysteryPainting.id] ?? 0) + 1;

    const advanceAfterCorrect = (delay: number) => {
      setTimeout(() => {
        setGuessFeedback(null);
        setGuessInput('');
        const allMystery = galleryEntries.filter((e) => e.isMysteryPaint);
        const currentId = selectedMysteryPainting.id;
        const available = allMystery.filter((e) => e.id !== currentId && !guessedPaintings.has(e.id));
        const next = available[0] ?? null;
        if (next) {
          setSelectedMysteryPainting(next);
          setTimeout(() => guessInputRef.current?.focus(), 80);
        } else {
          setGuessAllDone(true);
          setTimeout(() => { setGuessAllDone(false); setGuessOverlayVisible(false); }, 2400);
        }
      }, delay);
    };

    setGuessLoading(true);
    setGuessFeedback(null);
    const isCorrect = _topicsMatch(fullGuess, actualTopic);

    if (isCorrect) {
      triggerWinAnimation(Math.floor(Math.random() * 7));
      awardCoins(1);
      setGuessedPaintings((prev) => new Set([...prev, selectedMysteryPainting.id]));
      setGuessFeedback({ type: 'success', message: '🎉 Correct! +1 coin!' });
      const newSolveCount = (selectedMysteryPainting.solveCount ?? 0) + 1;
      setGalleryEntries((prev) =>
        prev.map((item) =>
          item.id === selectedMysteryPainting.id
            ? { ...item, isSolved: true, solverName: 'You', totalAttempts: newAttemptCount, solveCount: newSolveCount }
            : item
        )
      );
      void persistSolvedState(selectedMysteryPainting.id, newSolveCount, newAttemptCount);
      advanceAfterCorrect(1900);
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setGuessFeedback({ type: 'error', message: '❌ Not quite! Try again…' });
      setGuessInput('');
      setGalleryEntries((prev) =>
        prev.map((item) =>
          item.id === selectedMysteryPainting.id ? { ...item, totalAttempts: newAttemptCount } : item
        )
      );
      setTimeout(() => {
        setGuessFeedback(null);
        setTimeout(() => guessInputRef.current?.focus(), 80);
      }, 1400);
    }
    setGuessLoading(false);
  }, [selectedMysteryPainting, guessInput, awardCoins, galleryEntries, guessedPaintings, guessAttempts, triggerWinAnimation, setGalleryEntries]);

  // Persist guessed paintings and guess attempts
  useEffect(() => {
    if (guessedPaintings.size > 0) {
      AsyncStorage.setItem('@guessed_mystery_paintings', JSON.stringify([...guessedPaintings])).catch(() => {});
    }
  }, [guessedPaintings]);

  useEffect(() => {
    if (Object.keys(guessAttempts).length === 0) return;
    AsyncStorage.setItem('@guess_attempts', JSON.stringify(guessAttempts)).catch(() => {});
  }, [guessAttempts]);

  // ── Result ────────────────────────────────────────────────────────────────
  return {
    // Pass-through
    galleryEntries, setGalleryEntries,
    galleryLanguage, setGalleryLanguage,
    // Visibility
    galleryVisible, setGalleryVisible, openGallery, closeGallery,
    // Loading
    galleryLoading, setGalleryLoading, galleryRefreshing, galleryLoadingMore, setGalleryLoadingMore,
    galleryError, setGalleryError,
    // Pagination
    galleryPage, setGalleryPage, galleryPageCount, currentGalleryPage,
    visibleGalleryEntries, activeGalleryEntries, gallerySections, galleryExtraData, galleryStatsText,
    // Voting
    galleryVotePending, setGalleryVotePending, handleGalleryVote,
    // Selected entries
    gallerySelectedEntry, setGallerySelectedEntry,
    gallerySelectedPassport, setGallerySelectedPassport,
    profileOverlayEntry, setProfileOverlayEntry,
    galleryPassportEntry, setGalleryPassportEntry,
    // Mode / layout
    galleryMode, setGalleryMode, galleryModeRef, galleryLayout, setGalleryLayout,
    galleryUpdatedAt, galleryModePickerVisible, setGalleryModePickerVisible,
    handleGalleryModeChange,
    // Language
    galleryLanguageOptions, galleryDefaultLanguage, activeLanguageOption,
    galleryLanguagePickerVisible, setGalleryLanguagePickerVisible,
    revealedGalleryEntries,
    galleryAnimatedFrames, setGalleryAnimatedFrames, galleryImageLastTapRef,
    // Offline
    offlineGalleryEntries, offlineEntryCount, offlineMysteryEntries, showOfflineMysteryGallery,
    setShowOfflineMysteryGallery, mysteryButtonBlinkOpacity, mysteryButtonBlinkScale,
    isOfflineGalleryMode, loadOfflineGallery,
    // Passport viewer
    galleryPassportViewerVisible, setGalleryPassportViewerVisible,
    galleryPassportViewerUser, setGalleryPassportViewerUser,
    galleryPassportViewerScale, openGalleryPassportViewer, closeGalleryPassportViewer,
    // Gallery visit / friends
    galleryVisitedThisSession, setGalleryVisitedThisSession,
    shouldAutoOpenGallery, setShouldAutoOpenGallery,
    friendsDeviceIds, setFriendsDeviceIds,
    // Viewer animations
    galleryViewerScale, galleryViewerBaseScale, galleryViewerModalScale, galleryViewerModalOpacity,
    openGalleryViewer, closeGalleryViewer, resetGalleryViewer,
    // Refs
    galleryLastFetchedRef, galleryNeedsRefreshRef, notifiedSolvedMysteriesRef,
    // Core actions
    refreshGallery, sortGalleryEntriesCallback,
    // Format helpers
    formatGalleryRunDate, formatGalleryDuration, getGalleryTravelerName, createGalleryEntryFromUpload,
    // Guess
    guessedPaintings, setGuessedPaintings, guessAttempts, setGuessAttempts,
    guessOverlayVisible, setGuessOverlayVisible, guessInput, setGuessInput,
    selectedMysteryPainting, setSelectedMysteryPainting,
    guessLoading, guessFeedback, guessInputRef,
    guessWinVisible, guessWinStyleIdx, guessAllDone, guessWinParticles,
    handleOpenGuessOverlay, handleSubmitGuess,
  };
}
