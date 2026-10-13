/**
 * useLeaderboard — manages all state and side-effects for the Leaderboard feature.
 *
 * Extracted from PaintScreen.tsx. Accepts external dependencies via params so
 * PaintScreen can inject gallery/studio callbacks without circular imports.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  type FlatList,
} from 'react-native';
import {
  fetchPrivateStudioLeaderboard,
  type PrivateStudioLeaderboardEntry,
} from '../../lib/privateStudio';
import { fetchCurrentSeason, type SeasonResponse } from '../../lib/seasonsApi';
import type { DailyPaintGalleryEntry } from '../../lib/dailyPaintGallery';
import { type CoinLevel } from '../../lib/profileStats';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
export const LEADERBOARD_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Utility helpers (verbatim from PaintScreen)
// ---------------------------------------------------------------------------
const normalizeDeviceId = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

export const formatElapsedLabel = (elapsedMs: number): string => {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Param + result types
// ---------------------------------------------------------------------------
export interface UseLeaderboardParams {
  deviceId: string | null;
  navigation: any;
  insets: { top: number; bottom: number };
  // External PaintScreen state the hook must read/write
  infoVisible: boolean;
  setInfoVisible: (visible: boolean) => void;
  setGalleryEntries: (
    updater: (prev: DailyPaintGalleryEntry[]) => DailyPaintGalleryEntry[]
  ) => void;
  sortGalleryEntries: (entries: DailyPaintGalleryEntry[]) => DailyPaintGalleryEntry[];
  /** Called from closeLeaderboard to mirror private-studio state. */
  setPrivateStudioLeaderboardVisible: (visible: boolean) => void;
  /** Returns true if it navigated to a profile (consumer should not do extra navigation). */
  consumeReturnToProfile: () => boolean;
}

export interface UseLeaderboardResult {
  // ---- Core state ----
  leaderboardVisible: boolean;
  leaderboardClosing: boolean;
  leaderboardLoading: boolean;
  leaderboardError: string | null;
  leaderboardEntries: PrivateStudioLeaderboardEntry[];
  leaderboardPreviewEntry: PrivateStudioLeaderboardEntry | null;
  leaderboardPage: number;
  leaderboardActiveTab: 'all' | 'season';
  currentSeason: SeasonResponse | null;
  privateStudioLeaderboardOverlayVisible: boolean;
  profileLeaderboardVisible: boolean;
  // ---- Animated values / refs ----
  leaderboardOverlayAnim: RNAnimated.Value;
  leaderboardListRef: React.MutableRefObject<FlatList<PrivateStudioLeaderboardEntry> | null>;
  leaderboardEntriesRef: React.MutableRefObject<PrivateStudioLeaderboardEntry[]>;
  privateStudioLeaderboardOverlayAnim: RNAnimated.Value;
  profileLeaderboardOverlayAnim: RNAnimated.Value;
  // ---- Derived / computed ----
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leaderboardOverlayAnimatedStyle: any;
  leaderboardSheetInsets: { paddingTop: number; paddingBottom: number };
  previewRank: number | null;
  previewStrokeLabel: string;
  previewTimeLabel: string;
  ownLeaderboardEntryIds: string[];
  ownLeaderboardEntryIdSet: Set<string>;
  privateStudioTopEntries: PrivateStudioLeaderboardEntry[];
  // ---- Setters exposed for JSX callbacks ----
  setLeaderboardPage: React.Dispatch<React.SetStateAction<number>>;
  setLeaderboardActiveTab: React.Dispatch<React.SetStateAction<'all' | 'season'>>;
  // ---- Handlers ----
  refreshLeaderboard: () => Promise<PrivateStudioLeaderboardEntry[] | undefined>;
  openLeaderboard: () => void;
  closeLeaderboard: () => void;
  closeLeaderboardPreview: () => void;
  openProfileLeaderboard: () => void;
  closeProfileLeaderboard: () => void;
  closePrivateStudioLeaderboardOverlay: () => void;
  openLeaderboardFromPrivateStudio: () => void;
  handleLeaderboardEntryPress: (entry: PrivateStudioLeaderboardEntry) => void;
  mergeGalleryWithLeaderboard: (
    entries: DailyPaintGalleryEntry[],
    leaderboardSource?: PrivateStudioLeaderboardEntry[]
  ) => DailyPaintGalleryEntry[];
  forceResetLeaderboard: () => void;
  clearLeaderboardCache: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useLeaderboard(params: UseLeaderboardParams): UseLeaderboardResult {
  const {
    deviceId,
    navigation,
    insets,
    infoVisible,
    setInfoVisible,
    setGalleryEntries,
    sortGalleryEntries,
    setPrivateStudioLeaderboardVisible,
    consumeReturnToProfile,
  } = params;

  // ---- Core state ----
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const [leaderboardClosing, setLeaderboardClosing] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboardEntries, setLeaderboardEntries] = useState<PrivateStudioLeaderboardEntry[]>([]);
  const leaderboardEntriesRef = useRef<PrivateStudioLeaderboardEntry[]>([]);
  const [leaderboardPreviewEntry, setLeaderboardPreviewEntry] =
    useState<PrivateStudioLeaderboardEntry | null>(null);
  const [leaderboardPage, setLeaderboardPage] = useState(1);
  const [leaderboardActiveTab, setLeaderboardActiveTab] = useState<'all' | 'season'>('all');
  const [currentSeason, setCurrentSeason] = useState<SeasonResponse | null>(null);
  const seasonFetchedRef = useRef(false);

  // Private Studio Leaderboard Overlay (overlay inside private studio, not full screen modal)
  const [privateStudioLeaderboardOverlayVisible, setPrivateStudioLeaderboardOverlayVisible] =
    useState(false);
  const privateStudioLeaderboardOverlayAnim = useRef(new RNAnimated.Value(0)).current;

  // Profile Overview Leaderboard Overlay (sits above profile card, outside private studio modal)
  const [profileLeaderboardVisible, setProfileLeaderboardVisible] = useState(false);
  const profileLeaderboardOverlayAnim = useRef(new RNAnimated.Value(0)).current;

  // Animated values
  const leaderboardOverlayAnim = useRef(new RNAnimated.Value(0)).current;
  const leaderboardListRef = useRef<FlatList<PrivateStudioLeaderboardEntry> | null>(null);

  // Keep ref in sync with state (used by mergeGalleryWithLeaderboard to avoid stale closures)
  useEffect(() => {
    leaderboardEntriesRef.current = leaderboardEntries;
  }, [leaderboardEntries]);

  // ---- mergeGalleryWithLeaderboard ----
  const mergeGalleryWithLeaderboard = useCallback(
    (
      entries: DailyPaintGalleryEntry[],
      leaderboardSource?: PrivateStudioLeaderboardEntry[]
    ): DailyPaintGalleryEntry[] => {
      if (entries.length === 0) return entries;
      const source = leaderboardSource ?? leaderboardEntriesRef.current;
      if (!source || source.length === 0) return entries;

      const map = new Map<string, PrivateStudioLeaderboardEntry>();
      source.forEach((entry) => {
        const extras = entry.extra ?? {};
        const candidates: unknown[] = [
          entry.id,
          extras['machineId'],
          extras['machine_id'],
          extras['machine'],
          extras['machineid'],
          extras['deviceId'],
          extras['device_id'],
          extras['deviceid'],
          extras['identifier'],
        ];
        candidates.forEach((candidate) => {
          const normalized = normalizeDeviceId(
            typeof candidate === 'string' ? candidate : undefined
          );
          if (normalized && !map.has(normalized)) {
            map.set(normalized, entry);
          }
        });
      });
      if (map.size === 0) return entries;

      let mutated = false;
      const next = entries.map((entry) => {
        const normalizedDeviceId = normalizeDeviceId(entry.deviceId);
        if (!normalizedDeviceId) return entry;
        const leaderboardEntry = map.get(normalizedDeviceId);
        if (!leaderboardEntry) return entry;

        const leaderboardName =
          typeof leaderboardEntry.name === 'string' && leaderboardEntry.name.trim().length > 0
            ? leaderboardEntry.name.trim()
            : null;
        const leaderboardPortrait =
          typeof leaderboardEntry.imageUrl === 'string' &&
          leaderboardEntry.imageUrl.trim().length > 0
            ? leaderboardEntry.imageUrl.trim()
            : typeof (leaderboardEntry as any).portrait === 'string' &&
              (leaderboardEntry as any).portrait.trim().length > 0
            ? (leaderboardEntry as any).portrait.trim()
            : leaderboardEntry.extra &&
              typeof leaderboardEntry.extra.imageUrl === 'string' &&
              leaderboardEntry.extra.imageUrl.trim().length > 0
            ? leaderboardEntry.extra.imageUrl.trim()
            : leaderboardEntry.extra &&
              typeof leaderboardEntry.extra.portrait === 'string' &&
              leaderboardEntry.extra.portrait.trim().length > 0
            ? leaderboardEntry.extra.portrait.trim()
            : null;
        const leaderboardCoins =
          typeof leaderboardEntry.coinCount === 'number'
            ? leaderboardEntry.coinCount
            : typeof (leaderboardEntry as any).coins === 'number'
            ? (leaderboardEntry as any).coins
            : leaderboardEntry.extra &&
              typeof leaderboardEntry.extra.coinCount === 'number'
            ? leaderboardEntry.extra.coinCount
            : undefined;

        let updated: DailyPaintGalleryEntry | null = null;
        if (leaderboardName && leaderboardName !== entry.passportName) {
          updated = { ...(updated ?? entry), passportName: leaderboardName };
        }
        if (leaderboardPortrait && leaderboardPortrait !== entry.passportPortrait) {
          updated = { ...(updated ?? entry), passportPortrait: leaderboardPortrait };
        }
        if (typeof leaderboardCoins === 'number' && leaderboardCoins >= 0) {
          const currentCoins =
            typeof (updated ?? entry).coinCount === 'number'
              ? (updated ?? entry).coinCount
              : typeof (updated ?? entry).coins === 'number'
              ? (updated ?? entry).coins
              : undefined;
          if (currentCoins == null || currentCoins !== leaderboardCoins) {
            updated = {
              ...(updated ?? entry),
              coinCount: leaderboardCoins,
              coins: leaderboardCoins,
            };
          }
        }
        if (
          typeof leaderboardEntry.rank === 'number' &&
          leaderboardEntry.rank > 0 &&
          leaderboardEntry.rank !== entry.rank
        ) {
          updated = { ...(updated ?? entry), rank: leaderboardEntry.rank };
        }
        if (leaderboardEntry.uploadedAt && leaderboardEntry.uploadedAt !== entry.uploadedAt) {
          updated = {
            ...(updated ?? entry),
            uploadedAt: leaderboardEntry.uploadedAt,
            updatedAt: leaderboardEntry.uploadedAt,
          };
        }
        if (updated) {
          mutated = true;
          return updated;
        }
        return entry;
      });
      return mutated ? next : entries;
    },
    []
  );

  // ---- refreshLeaderboard ----
  const refreshLeaderboard = useCallback(async (): Promise<
    PrivateStudioLeaderboardEntry[] | undefined
  > => {
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    setLeaderboardPage(1);
    try {
      const entries = await fetchPrivateStudioLeaderboard();
      const sortedEntries = [...entries].sort((a, b) => {
        if (b.strokeCount !== a.strokeCount) return b.strokeCount - a.strokeCount;
        if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
        return a.name.localeCompare(b.name);
      });
      const rankedEntries = sortedEntries.map((entry, index) =>
        typeof entry.rank === 'number' && Number.isFinite(entry.rank)
          ? entry
          : { ...entry, rank: index + 1 }
      );
      setLeaderboardEntries(rankedEntries);
      setGalleryEntries((prev) =>
        sortGalleryEntries(mergeGalleryWithLeaderboard(prev, rankedEntries))
      );
      return rankedEntries;
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Leaderboard unavailable.';
      if (typeof message === 'string') {
        if (/network request failed/i.test(message)) {
          message =
            'Unable to reach the leaderboard. Please check your connection and try again.';
        } else if (/timed out/i.test(message)) {
          message = 'Leaderboard request timed out. Try again in a moment.';
        }
      }
      setLeaderboardError(message);
      return undefined;
    } finally {
      setLeaderboardLoading(false);
    }
  }, [mergeGalleryWithLeaderboard, sortGalleryEntries, setGalleryEntries]);

  // Initial load on mount — empty deps intentional: only run once.
  // refreshLeaderboard must NOT be in deps; it changes identity whenever
  // mergeGalleryWithLeaderboard/setGalleryEntries change, which would
  // cause an infinite fetch→setGalleryEntries→recreate→fetch loop.
  const refreshLeaderboardRef = useRef(refreshLeaderboard);
  useEffect(() => { refreshLeaderboardRef.current = refreshLeaderboard; }, [refreshLeaderboard]);
  useEffect(() => {
    void refreshLeaderboardRef.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- openLeaderboard ----
  const openLeaderboard = useCallback(() => {
    if (leaderboardVisible) return;
    if (infoVisible) setInfoVisible(false);
    setLeaderboardClosing(false);
    setLeaderboardVisible(true);
    leaderboardOverlayAnim.stopAnimation(() => {
      leaderboardOverlayAnim.setValue(0);
      RNAnimated.timing(leaderboardOverlayAnim, {
        toValue: 1,
        duration: 360,
        easing: RNEasing.out(RNEasing.cubic),
        useNativeDriver: true,
      }).start();
    });
    void refreshLeaderboard();
    // Lazy fetch season data once per session
    if (!seasonFetchedRef.current) {
      seasonFetchedRef.current = true;
      fetchCurrentSeason()
        .then((data) => {
          if (data) setCurrentSeason(data);
        })
        .catch(() => undefined);
    }
  }, [infoVisible, leaderboardOverlayAnim, leaderboardVisible, refreshLeaderboard, setInfoVisible]);

  // ---- closeLeaderboard ----
  const closeLeaderboard = useCallback(() => {
    if (leaderboardClosing) return;
    setLeaderboardPreviewEntry(null);
    setPrivateStudioLeaderboardVisible(false);
    if (!leaderboardVisible) return;
    setLeaderboardClosing(true);
    RNAnimated.timing(leaderboardOverlayAnim, {
      toValue: 2,
      duration: 340,
      easing: RNEasing.in(RNEasing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setLeaderboardClosing(false);
      setLeaderboardVisible(false);
      leaderboardOverlayAnim.setValue(0);
      consumeReturnToProfile();
    });
  }, [
    leaderboardClosing,
    leaderboardOverlayAnim,
    leaderboardVisible,
    consumeReturnToProfile,
    setPrivateStudioLeaderboardVisible,
  ]);

  // Safety: force-clear if close animation callback never fires
  useEffect(() => {
    if (!leaderboardClosing) return;
    const timeout = setTimeout(() => {
      setLeaderboardClosing(false);
      setLeaderboardVisible(false);
      leaderboardOverlayAnim.setValue(0);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [leaderboardClosing, leaderboardOverlayAnim]);

  // ---- closeLeaderboardPreview ----
  const closeLeaderboardPreview = useCallback(() => {
    setLeaderboardPreviewEntry(null);
  }, []);

  // ---- Private Studio Leaderboard Overlay ----
  const closePrivateStudioLeaderboardOverlay = useCallback(() => {
    privateStudioLeaderboardOverlayAnim.setValue(1);
    RNAnimated.timing(privateStudioLeaderboardOverlayAnim, {
      toValue: 0,
      duration: 300,
      easing: RNEasing.in(RNEasing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setPrivateStudioLeaderboardOverlayVisible(false);
    });
  }, [privateStudioLeaderboardOverlayAnim]);

  const openLeaderboardFromPrivateStudio = useCallback(() => {
    setPrivateStudioLeaderboardOverlayVisible(true);
    privateStudioLeaderboardOverlayAnim.setValue(0);
    RNAnimated.timing(privateStudioLeaderboardOverlayAnim, {
      toValue: 1,
      duration: 300,
      easing: RNEasing.out(RNEasing.cubic),
      useNativeDriver: true,
    }).start();
    void refreshLeaderboard();
  }, [privateStudioLeaderboardOverlayAnim, refreshLeaderboard]);

  // ---- Profile Overview Leaderboard Overlay ----
  const openProfileLeaderboard = useCallback(() => {
    setProfileLeaderboardVisible(true);
    profileLeaderboardOverlayAnim.setValue(0);
    RNAnimated.timing(profileLeaderboardOverlayAnim, {
      toValue: 1,
      duration: 300,
      easing: RNEasing.out(RNEasing.cubic),
      useNativeDriver: true,
    }).start();
    void refreshLeaderboard();
  }, [profileLeaderboardOverlayAnim, refreshLeaderboard]);

  const closeProfileLeaderboard = useCallback(() => {
    profileLeaderboardOverlayAnim.setValue(1);
    RNAnimated.timing(profileLeaderboardOverlayAnim, {
      toValue: 0,
      duration: 300,
      easing: RNEasing.in(RNEasing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setProfileLeaderboardVisible(false);
    });
  }, [profileLeaderboardOverlayAnim]);

  // ---- Derived: own entry IDs ----
  const ownLeaderboardEntryIds = useMemo(() => {
    if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      return [] as string[];
    }
    const normalizedDeviceId = deviceId.trim().toLowerCase();
    const matches: string[] = [];
    leaderboardEntries.forEach((entry) => {
      const extra = entry.extra ?? {};
      const rawCandidates: unknown[] = [
        entry.id,
        extra['id'],
        extra['entry_id'],
        extra['entryId'],
        extra['machineId'],
        extra['machine_id'],
        extra['machine'],
        extra['machineid'],
        extra['deviceId'],
        extra['device_id'],
        extra['deviceid'],
        extra['identifier'],
      ];
      const hasMatch = rawCandidates.some((candidate) => {
        if (typeof candidate === 'string') {
          return candidate.trim().toLowerCase() === normalizedDeviceId;
        }
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          return String(candidate) === normalizedDeviceId;
        }
        return false;
      });
      if (hasMatch) matches.push(entry.id);
    });
    return matches;
  }, [deviceId, leaderboardEntries]);

  const ownLeaderboardEntryIdSet = useMemo(
    () => new Set(ownLeaderboardEntryIds),
    [ownLeaderboardEntryIds]
  );

  const privateStudioTopEntries = useMemo(
    () => leaderboardEntries.slice(0, 5),
    [leaderboardEntries]
  );

  // ---- handleLeaderboardEntryPress ----
  const handleLeaderboardEntryPress = useCallback(
    (entry: PrivateStudioLeaderboardEntry) => {
      const isOwn = ownLeaderboardEntryIdSet.has(entry.id);
      if (isOwn) return;
      setLeaderboardPreviewEntry(entry);
    },
    [ownLeaderboardEntryIdSet]
  );

  // ---- Derived animation styles ----
  const leaderboardOverlayAnimatedStyle = useMemo(
    () => ({
      transform: [
        {
          translateY: leaderboardOverlayAnim.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [-140, 0, 180],
          }),
        },
        {
          scale: leaderboardOverlayAnim.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [0.94, 1, 0.96],
          }),
        },
      ],
      opacity: leaderboardOverlayAnim.interpolate({
        inputRange: [0, 1, 2],
        outputRange: [0, 1, 0],
      }),
    }),
    [leaderboardOverlayAnim]
  );

  const leaderboardSheetInsets = useMemo(
    () => ({
      paddingTop: insets.top + 16,
      paddingBottom: Math.max(insets.bottom + 16, 24),
    }),
    [insets.bottom, insets.top]
  );

  const previewRank = useMemo(() => {
    if (!leaderboardPreviewEntry) return null;
    if (
      typeof leaderboardPreviewEntry.rank === 'number' &&
      Number.isFinite(leaderboardPreviewEntry.rank)
    ) {
      return leaderboardPreviewEntry.rank;
    }
    const index = leaderboardEntries.findIndex((e) => e.id === leaderboardPreviewEntry.id);
    return index >= 0 ? index + 1 : null;
  }, [leaderboardEntries, leaderboardPreviewEntry]);

  /** Safety reset called from AppState 'active' self-heal — stops stuck closing animation */
  const forceResetLeaderboard = useCallback(() => {
    setLeaderboardClosing(false);
  }, []);

  /** Memory cleanup called when Private Studio closes — frees ~1GB of cached entries */
  const clearLeaderboardCache = useCallback(() => {
    setLeaderboardEntries([]);
    setLeaderboardPreviewEntry(null);
    setLeaderboardError(null);
    leaderboardEntriesRef.current = [];
  }, []);

  const previewStrokeLabel = useMemo(
    () => (leaderboardPreviewEntry ? leaderboardPreviewEntry.strokeCount.toLocaleString() : ''),
    [leaderboardPreviewEntry]
  );

  const previewTimeLabel = useMemo(
    () =>
      leaderboardPreviewEntry ? formatElapsedLabel(leaderboardPreviewEntry.elapsedMs) : '',
    [leaderboardPreviewEntry]
  );

  return {
    // State
    leaderboardVisible,
    leaderboardClosing,
    leaderboardLoading,
    leaderboardError,
    leaderboardEntries,
    leaderboardPreviewEntry,
    leaderboardPage,
    leaderboardActiveTab,
    currentSeason,
    privateStudioLeaderboardOverlayVisible,
    profileLeaderboardVisible,
    // Animated values / refs
    leaderboardOverlayAnim,
    leaderboardListRef,
    leaderboardEntriesRef,
    privateStudioLeaderboardOverlayAnim,
    profileLeaderboardOverlayAnim,
    // Derived
    leaderboardOverlayAnimatedStyle,
    leaderboardSheetInsets,
    previewRank,
    previewStrokeLabel,
    previewTimeLabel,
    ownLeaderboardEntryIds,
    ownLeaderboardEntryIdSet,
    privateStudioTopEntries,
    // Setters for JSX
    setLeaderboardPage,
    setLeaderboardActiveTab,
    // Handlers
    refreshLeaderboard,
    openLeaderboard,
    closeLeaderboard,
    closeLeaderboardPreview,
    openProfileLeaderboard,
    closeProfileLeaderboard,
    closePrivateStudioLeaderboardOverlay,
    openLeaderboardFromPrivateStudio,
    handleLeaderboardEntryPress,
    mergeGalleryWithLeaderboard,
    forceResetLeaderboard,
    clearLeaderboardCache,
  };
}
