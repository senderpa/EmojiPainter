// @ts-nocheck
/**
 * useChallenge — owns all Challenge feature state and handlers.
 *
 * Extracted from PaintScreen.tsx.  PaintScreen still owns the heavy
 * operations that need canvas refs / dispatch (startChallenge,
 * finalizeChallenge, openChallengeUpload) — those are passed in via params.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated, AppState, Easing as RNEasing } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import type { InfoLanguage } from '../info-panel/useInfoPanel';
import { FALLBACK_PROMPTS, getTopicMetadata } from '../../lib/dailyTopics';
import { fetchDailyPaintGallery, type DailyPaintGalleryEntry } from '../../lib/dailyPaintGallery';
import type { DailyPrompt } from '../../types/dailyPrompt';
import { finishChallengeSession } from './challengeSession';

// ─── Re-export getTopicMetadata so callers can import it from this module ─────
export { getTopicMetadata };

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChallengeUploadNotice = {
  variant: 'success' | 'error';
  message: string;
};

type ChallengeConfirmCopy = {
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

// ─── Constants ───────────────────────────────────────────────────────────────

export const SPRINT_EMOJI_POOL = [
  '🏃‍♀️', '🏃‍♂️', '🚀', '💨', '🔥', '🥇', '🏃', '🎽', '⏱️', '🏅', '🏆', '⚡️', '🎯', '🧢',
];

export const CHALLENGE_CONFIRM_COPY: Record<InfoLanguage, ChallengeConfirmCopy> = {
  en: {
    title: 'Start sprint?',
    subtitle: 'Let’s take on this topic together.',
    warning: 'Starting will clear the current canvas and begin the timer.',
    confirmHint: 'Ready to start the sprint?',
    confirmLabel: 'Let’s go',
    cancelLabel: 'Cancel',
    galleryHeading: 'Recent community sprints',
    emptyMessage: 'Nobody has shared a sprint for this topic yet — be the first!',
    errorMessage: 'Gallery currently unavailable.',
  },
  de: {
    title: 'Sprint starten?',
    subtitle: 'Lass uns dieses Thema gemeinsam angehen.',
    warning: 'Wenn du beginnst, wird die aktuelle Leinwand geleert und der Timer gestartet.',
    confirmHint: 'Bereit für den Sprint?',
    confirmLabel: 'Los geht’s',
    cancelLabel: 'Abbrechen',
    galleryHeading: 'Aktuelle Community-Sprints',
    emptyMessage: 'Noch niemand hat zu diesem Thema gesprintet – sei der Erste!',
    errorMessage: 'Galerie momentan nicht verfügbar.',
  },
  ru: {
    title: 'Начать спринт?',
    subtitle: 'Давайте вместё возьмёмся за эту тему.',
    warning: 'Запуск очистит холст и запустит таймер.',
    confirmHint: 'Готовы к спринту?',
    confirmLabel: 'Поехали',
    cancelLabel: 'Отмена',
    galleryHeading: 'Недавние работы сообщества',
    emptyMessage: 'Никто ещё не поделился спринтом на эту тему — можете быть первым!',
    errorMessage: 'Галерея временно недоступна.',
  },
  zh: {
    title: '开始速涂？',
    subtitle: '一起挑战这个主题吧。',
    warning: '开始后将清空当前画布并启动计时器。',
    confirmHint: '准备好开始了吗？',
    confirmLabel: '开始',
    cancelLabel: '取消',
    galleryHeading: '社区最新作品',
    emptyMessage: '还没有人分享这个主题的速涂——快来当第一个！',
    errorMessage: '暂时无法加载画廈。',
  },
  ko: {
    title: '스프린트를 시작할까요?',
    subtitle: '이 주제를 함께 도전해 봐요.',
    warning: '시작하면 현재 캔버스가 지워지고 타이머가 시작됩니다.',
    confirmHint: '스프린트를 시작할 준비가 되었나요?',
    confirmLabel: '시작하기',
    cancelLabel: '취소',
    galleryHeading: '최근 커뮤니티 스프린트',
    emptyMessage: '아직 이 주제로 공유된 스프린트가 없어요. 첫 주자가 되어보세요!',
    errorMessage: '갤러리를 불러올 수 없습니다.',
  },
  ja: {
    title: 'スプリントを開始しますか？',
    subtitle: 'このテーマに一緒に挑戦しましょう。',
    warning: '開始するとキャンバスがリセットされ、タイマーが始まります。',
    confirmHint: 'スプリントを始めますか？',
    confirmLabel: 'スタート',
    cancelLabel: 'キャンセル',
    galleryHeading: 'コミュニティの最新スプリント',
    emptyMessage: 'このテーマのスプリントはまだありません。最初の挑戦者になろう！',
    errorMessage: 'ギャラリーを読み込めません。',
  },
  fr: {
    title: 'Commencer le sprint ?',
    subtitle: 'Relevons ce sujet ensemble.',
    warning: 'Le démarrage efface la toile actuelle et lance le minuteur.',
    confirmHint: 'Prêt à sprinter ?',
    confirmLabel: 'C’est parti',
    cancelLabel: 'Annuler',
    galleryHeading: 'Derniers sprints de la communauté',
    emptyMessage: 'Personne n’a encore partagé de sprint sur ce sujet — soyez le premier !',
    errorMessage: 'Galerie momentanément indisponible.',
  },
  it: {
    title: 'Avviare lo sprint?',
    subtitle: 'Affrontiamo insieme questo tema.',
    warning: 'L’avvio cancellerà la tela attuale e farà partire il timer.',
    confirmHint: 'Pronto per lo sprint?',
    confirmLabel: 'Si parte',
    cancelLabel: 'Annulla',
    galleryHeading: 'Sprint recenti della community',
    emptyMessage: 'Nessuno ha ancora condiviso uno sprint su questo argomento: potresti essere il primo!',
    errorMessage: 'Galleria temporaneamente non disponibile.',
  },
};

// ─── Params ──────────────────────────────────────────────────────────────────

export interface UseChallengeParams {
  // ── From task spec ──────────────────────────────────────────────────────────
  deviceId: string | null;
  strokes: any[];
  infoLanguage: InfoLanguage;
  awardCoins: (reason: string) => void;
  openLeaderboard: () => void;
  setInfoVisible: (v: boolean) => void;
  navigation: any;
  notificationService: {
    requestPermissionsAndEnable: () => Promise<boolean>;
    markAsAsked?: () => Promise<void>;
    hasBeenAsked?: () => Promise<boolean>;
    areEnabled?: () => Promise<boolean>;
  };
  // ── Additional (beyond task spec) ──────────────────────────────────────────
  /** For challengeMinutesForDay + prompt time hints */
  dailyPrompts: DailyPrompt[];
  /** PaintScreen's startChallenge (needs dispatch/canvas); hook calls it via confirmStartChallenge/handleMysteryTopicPicked */
  startChallenge: (prompt: DailyPrompt) => void;
  /** PaintScreen's finalizeChallenge; called when sprint timer hits 0 */
  finalizeChallenge: () => Promise<void>;
  /** Prevents auto-finalize when Framer workspace is open */
  framerWorkspaceVisible: boolean;
}

// ─── Result type (all state + setters + handlers) ────────────────────────────

export interface UseChallengeResult {
  // Core challenge
  activeChallenge: { prompt: DailyPrompt; endsAt: number } | null;
  setActiveChallenge: (v: { prompt: DailyPrompt; endsAt: number } | null) => void;
  activeChallengeRef: React.MutableRefObject<{ prompt: DailyPrompt; endsAt: number } | null>;
  challengeRemainingMs: number;
  setChallengeRemainingMs: (v: number) => void;
  challengeCompleteVisible: boolean;
  setChallengeCompleteVisible: (v: boolean) => void;
  uploadedPromptTopics: Set<string>;
  setUploadedPromptTopics: React.Dispatch<React.SetStateAction<Set<string>>>;
  // Internal refs exposed for PaintScreen's startChallenge / finalizeChallenge
  challengeStartedAtRef: React.MutableRefObject<number | null>;
  challengeEndedAtRef: React.MutableRefObject<number | null>;
  challengeLastPromptRef: React.MutableRefObject<DailyPrompt | null>;
  challengeStrokeCountRef: React.MutableRefObject<number>;
  prevChallengeStrokeCountRef: React.MutableRefObject<number>;
  challengeCompletionHandledRef: React.MutableRefObject<boolean>;
  challengeUploadedRef: React.MutableRefObject<boolean>;
  finalizeChallengeRef: React.MutableRefObject<(() => Promise<void>) | null>;
  // Challenge complete modal state
  challengeSnapshotUri: string | null;
  setChallengeSnapshotUri: (v: string | null) => void;
  challengeCaptureLoading: boolean;
  setChallengeCaptureLoading: (v: boolean) => void;
  challengeUploadLoading: boolean;
  setChallengeUploadLoading: (v: boolean) => void;
  challengeUploadNotice: ChallengeUploadNotice | null;
  setChallengeUploadNotice: (v: ChallengeUploadNotice | null | string) => void;
  showFrameUploadModal: boolean;
  setShowFrameUploadModal: (v: boolean) => void;
  challengeStrokeCount: number;
  setChallengeStrokeCount: (v: number) => void;
  // Confirm dialog state
  challengeConfirmPrompt: DailyPrompt | null;
  setChallengeConfirmPrompt: (v: DailyPrompt | null) => void;
  challengeConfirmEntries: DailyPaintGalleryEntry[] | null;
  setChallengeConfirmEntries: (v: DailyPaintGalleryEntry[] | null) => void;
  challengeConfirmLoading: boolean;
  setChallengeConfirmLoading: (v: boolean) => void;
  challengeConfirmProcessing: boolean;
  setChallengeConfirmProcessing: (v: boolean) => void;
  challengeConfirmError: string | null;
  setChallengeConfirmError: (v: string | null) => void;
  challengeConfirmPreviewEntry: DailyPaintGalleryEntry | null;
  setChallengeConfirmPreviewEntry: (v: DailyPaintGalleryEntry | null) => void;
  challengeConfirmAnimValuesRef: React.MutableRefObject<RNAnimated.Value[]>;
  // Computed from confirm
  challengeConfirmEmoji: string | null;
  challengeConfirmEmojiAnimatedStyle: any;
  confirmCopy: ChallengeConfirmCopy;
  // Notifications
  showNotificationPrompt: boolean;
  setShowNotificationPrompt: (v: boolean) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  // Mystery topic
  mysteryTopic: { topicId: number; topic: string } | null;
  setMysteryTopic: (v: { topicId: number; topic: string } | null) => void;
  mysteryTopicLoading: boolean;
  setMysteryTopicLoading: (v: boolean) => void;
  mysteryTopicSelected: boolean;
  setMysteryTopicSelected: (v: boolean) => void;
  showMysteryTopicInInfo: boolean;
  setShowMysteryTopicInInfo: (v: boolean) => void;
  diceButtonCooldown: boolean;
  setDiceButtonCooldown: (v: boolean) => void;
  diceButtonCountdown: number;
  setDiceButtonCountdown: React.Dispatch<React.SetStateAction<number>>;
  mysteryTopicChoices: Array<{ topicId: number; topic: string; timeMinutes: number }>;
  setMysteryTopicChoices: React.Dispatch<React.SetStateAction<Array<{ topicId: number; topic: string; timeMinutes: number }>>>;
  mysteryTopicHistory: Array<Array<{ topicId: number; topic: string; timeMinutes: number }>>;
  setMysteryTopicHistory: React.Dispatch<React.SetStateAction<Array<Array<{ topicId: number; topic: string; timeMinutes: number }>>>>;
  mysteryConfirmVisible: boolean;
  setMysteryConfirmVisible: (v: boolean) => void;
  mysteryBounceAnim: RNAnimated.Value;
  mysteryConfirmCancelledRef: React.MutableRefObject<boolean>;
  mysteryTopicWarningVisible: boolean;
  setMysteryTopicWarningVisible: (v: boolean) => void;
  mysteryModalPanel: 0 | 1;
  setMysteryModalPanel: (v: 0 | 1) => void;
  mysteryTotalTopicCount: number;
  setMysteryTotalTopicCount: (v: number) => void;
  pendingMysteryTopicChoices: Array<{ topicId: number; topic: string; timeMinutes: number }>;
  setPendingMysteryTopicChoices: React.Dispatch<React.SetStateAction<Array<{ topicId: number; topic: string; timeMinutes: number }>>>;
  mysteryPickerVisible: boolean;
  setMysteryPickerVisible: (v: boolean) => void;
  // Derived values
  challengeMinutesForDay: number;
  // Handlers
  handleChallengeSelect: (prompt: DailyPrompt) => Promise<void>;
  cancelChallengeConfirm: () => void;
  confirmStartChallenge: () => void;
  openChallengeConfirmPreview: (entry: DailyPaintGalleryEntry) => void;
  closeChallengeConfirmPreview: () => void;
  handleSkipNotifications: () => Promise<void>;
  handleEnableNotifications: () => Promise<void>;
  handleMysteryTopicSelect: () => Promise<void>;
  handleMysteryTopicPicked: (topic: { topicId: number; topic: string; timeMinutes?: number }) => void;
  handleReloadMysteryTopic: () => Promise<void>;
  handleStartMysteryPainting: () => void;
  handleCancelMysteryConfirm: () => void;
  confirmMysteryTopicWarning: () => void;
  cancelMysteryTopicWarning: () => void;
  handleShuffleMysteryTopics: () => Promise<void>;
  cancelMysteryPicker: () => Promise<void>;
  markPromptUploaded: (prompt: DailyPrompt | null) => void;
  getTopicMetadata: typeof getTopicMetadata;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChallenge(params: UseChallengeParams): UseChallengeResult {
  const {
    deviceId,
    strokes,
    infoLanguage,
    setInfoVisible,
    notificationService,
    dailyPrompts,
    startChallenge,
    finalizeChallenge,
    framerWorkspaceVisible,
  } = params;

  // ── Core challenge state ──────────────────────────────────────────────────
  const [activeChallenge, setActiveChallenge] = useState<{ prompt: DailyPrompt; endsAt: number } | null>(null);
  const activeChallengeRef = useRef<{ prompt: DailyPrompt; endsAt: number } | null>(null);
  const [challengeRemainingMs, setChallengeRemainingMs] = useState(0);
  const [challengeCompleteVisible, setChallengeCompleteVisible] = useState(false);
  const [uploadedPromptTopics, setUploadedPromptTopics] = useState<Set<string>>(() => new Set());

  // ── Internal refs (used by PaintScreen's startChallenge / finalizeChallenge) ──
  const challengeStartedAtRef = useRef<number | null>(null);
  const challengeEndedAtRef = useRef<number | null>(null);
  const challengeLastPromptRef = useRef<DailyPrompt | null>(null);
  const challengeStrokeCountRef = useRef(0);
  const prevChallengeStrokeCountRef = useRef(strokes.length);
  const challengeCompletionHandledRef = useRef(false);
  const challengeUploadedRef = useRef(false);
  const finalizeChallengeRef = useRef<(() => Promise<void>) | null>(null);

  // Keep finalizeChallengeRef up to date
  useEffect(() => {
    finalizeChallengeRef.current = finalizeChallenge;
  }, [finalizeChallenge]);

  // ── Challenge complete modal state ────────────────────────────────────────
  const [challengeSnapshotUri, setChallengeSnapshotUri] = useState<string | null>(null);
  const [challengeCaptureLoading, setChallengeCaptureLoading] = useState(false);
  const [challengeUploadLoading, setChallengeUploadLoading] = useState(false);
  const [challengeUploadNotice, setChallengeUploadNotice] = useState<ChallengeUploadNotice | null>(null);
  const [showFrameUploadModal, setShowFrameUploadModal] = useState(false);
  const [challengeStrokeCount, setChallengeStrokeCount] = useState(0);

  // ── Confirm dialog state ──────────────────────────────────────────────────
  const [challengeConfirmPrompt, setChallengeConfirmPrompt] = useState<DailyPrompt | null>(null);
  const [challengeConfirmEntries, setChallengeConfirmEntries] = useState<DailyPaintGalleryEntry[] | null>(null);
  const [challengeConfirmLoading, setChallengeConfirmLoading] = useState(false);
  const [challengeConfirmProcessing, setChallengeConfirmProcessing] = useState(false);
  const [challengeConfirmError, setChallengeConfirmError] = useState<string | null>(null);
  const [challengeConfirmPreviewEntry, setChallengeConfirmPreviewEntry] = useState<DailyPaintGalleryEntry | null>(null);
  const [challengeConfirmEmojis, setChallengeConfirmEmojis] = useState<string[]>([]);
  const [challengeConfirmEmojiIndex, setChallengeConfirmEmojiIndex] = useState(0);
  const challengeConfirmEmojiAnim = useRef(new RNAnimated.Value(0)).current;
  const challengeConfirmEmojiIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const challengeConfirmAnimValuesRef = useRef<RNAnimated.Value[]>([]);

  // ── Notifications ─────────────────────────────────────────────────────────
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const hasCheckedNotificationPrompt = useRef(false);

  // ── Mystery topic state ───────────────────────────────────────────────────
  const [mysteryTopicSelected, setMysteryTopicSelected] = useState(false);
  const [mysteryTopicLoading, setMysteryTopicLoading] = useState(false);
  const [mysteryTopic, setMysteryTopic] = useState<{ topicId: number; topic: string } | null>(null);
  const [mysteryTopicWarningVisible, setMysteryTopicWarningVisible] = useState(false);
  const [mysteryModalPanel, setMysteryModalPanel] = useState<0 | 1>(0);
  const [mysteryTotalTopicCount, setMysteryTotalTopicCount] = useState(0);
  const [pendingMysteryTopicChoices, setPendingMysteryTopicChoices] = useState<Array<{ topicId: number; topic: string; timeMinutes: number }>>([]);
  const [showMysteryTopicInInfo, setShowMysteryTopicInInfo] = useState(false);
  const [diceButtonCooldown, setDiceButtonCooldown] = useState(false);
  const [diceButtonCountdown, setDiceButtonCountdown] = useState(0);
  const [mysteryPickerVisible, setMysteryPickerVisible] = useState(false);
  const [mysteryTopicChoices, setMysteryTopicChoices] = useState<Array<{ topicId: number; topic: string; timeMinutes: number }>>([]);
  const [mysteryTopicHistory, setMysteryTopicHistory] = useState<Array<Array<{ topicId: number; topic: string; timeMinutes: number }>>>([]);
  const [mysteryConfirmVisible, setMysteryConfirmVisible] = useState(false);
  const mysteryBounceAnim = useRef(new RNAnimated.Value(0)).current;
  const mysteryConfirmCancelledRef = useRef(false);

  // ── Derived values ────────────────────────────────────────────────────────
  const challengeMinutesForDay = useMemo(
    () => dailyPrompts[0]?.timeMinutes ?? FALLBACK_PROMPTS[0].timeMinutes,
    [dailyPrompts],
  );

  const confirmCopy = useMemo(
    () => CHALLENGE_CONFIRM_COPY[infoLanguage] ?? CHALLENGE_CONFIRM_COPY.en,
    [infoLanguage],
  );

  const challengeConfirmEmoji = useMemo(() => {
    if (challengeConfirmEmojis.length === 0) return null;
    return challengeConfirmEmojis[challengeConfirmEmojiIndex % challengeConfirmEmojis.length];
  }, [challengeConfirmEmojiIndex, challengeConfirmEmojis]);

  const challengeConfirmEmojiAnimatedStyle = useMemo(() => ({
    transform: [
      { scale: challengeConfirmEmojiAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.18] }) },
      { rotate: challengeConfirmEmojiAnim.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '6deg'] }) },
    ],
  }), [challengeConfirmEmojiAnim]);

  // ── Keep activeChallengeRef in sync ───────────────────────────────────────
  useEffect(() => {
    activeChallengeRef.current = activeChallenge;
  }, [activeChallenge]);

  // ── Sprint countdown interval ─────────────────────────────────────────────
  useEffect(() => {
    if (!activeChallenge) {
      setChallengeRemainingMs(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, activeChallenge.endsAt - Date.now());
      setChallengeRemainingMs(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeChallenge]);

  // Reset completion guard when challenge is cleared
  useEffect(() => {
    if (!activeChallenge) {
      challengeCompletionHandledRef.current = false;
    }
  }, [activeChallenge]);

  // ── Challenge completion detection ────────────────────────────────────────
  useEffect(() => {
    if (!activeChallenge) return;
    if (challengeRemainingMs > 0) return;
    // Let Framer handle its own upload flow
    if (framerWorkspaceVisible) return;
    const remaining = activeChallenge.endsAt - Date.now();
    if (remaining > 0) {
      setChallengeRemainingMs(Math.max(0, remaining));
      return;
    }
    if (!challengeCompletionHandledRef.current) {
      challengeCompletionHandledRef.current = true;
      void finishChallengeSession('expired');
      void finalizeChallenge();
    }
  }, [activeChallenge, challengeRemainingMs, finalizeChallenge, framerWorkspaceVisible]);

  // ── Foreground recovery ───────────────────────────────────────────────────
  // The countdown is a 1s interval, which iOS suspends while backgrounded, and
  // a finalization interrupted by backgrounding can latch
  // challengeCompletionHandledRef without ever showing the overlay — which also
  // dead-ends ✕ / upload-early, since both are gated on that same ref. On
  // resume: resync the clock, and if the sprint is over with no overlay on
  // screen, clear the latch and finalize again.
  const challengeCompleteVisibleRef = useRef(challengeCompleteVisible);
  challengeCompleteVisibleRef.current = challengeCompleteVisible;
  const framerWorkspaceVisibleRef = useRef(framerWorkspaceVisible);
  framerWorkspaceVisibleRef.current = framerWorkspaceVisible;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const challenge = activeChallengeRef.current;
      if (!challenge) return;
      const remaining = Math.max(0, challenge.endsAt - Date.now());
      setChallengeRemainingMs(remaining);
      if (remaining > 0) return;
      if (framerWorkspaceVisibleRef.current) return;
      if (challengeCompleteVisibleRef.current) return;
      console.log('[Challenge] Resumed with an expired sprint and no upload overlay — re-finalizing');
      challengeCompletionHandledRef.current = false;
      void finishChallengeSession('expired');
      void finalizeChallenge();
    });
    return () => subscription.remove();
  }, [finalizeChallenge]);

  // ── Confirm dialog: fetch gallery + emoji animation ───────────────────────
  useEffect(() => {
    if (!challengeConfirmPrompt) {
      setChallengeConfirmLoading(false);
      if (challengeConfirmEmojiIntervalRef.current) {
        clearInterval(challengeConfirmEmojiIntervalRef.current);
        challengeConfirmEmojiIntervalRef.current = null;
      }
      challengeConfirmEmojiAnim.stopAnimation(() => challengeConfirmEmojiAnim.setValue(0));
      setChallengeConfirmEmojis([]);
      setChallengeConfirmEmojiIndex(0);
      return;
    }
    let cancelled = false;
    setChallengeConfirmLoading(true);
    setChallengeConfirmError(null);

    // Pick 3 random sprint emojis
    const pool = [...SPRINT_EMOJI_POOL];
    const selection: string[] = [];
    while (selection.length < 3 && pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      selection.push(pool.splice(idx, 1)[0]);
    }
    setChallengeConfirmEmojis(selection);
    setChallengeConfirmEmojiIndex(0);

    if (challengeConfirmEmojiIntervalRef.current) {
      clearInterval(challengeConfirmEmojiIntervalRef.current);
      challengeConfirmEmojiIntervalRef.current = null;
    }
    const animateEmoji = () => {
      challengeConfirmEmojiAnim.setValue(0);
      RNAnimated.sequence([
        RNAnimated.timing(challengeConfirmEmojiAnim, { toValue: 1, duration: 220, easing: RNEasing.out(RNEasing.ease), useNativeDriver: true }),
        RNAnimated.timing(challengeConfirmEmojiAnim, { toValue: 0, duration: 200, easing: RNEasing.in(RNEasing.ease), useNativeDriver: true }),
      ]).start();
    };
    animateEmoji();
    if (selection.length > 0) {
      challengeConfirmEmojiIntervalRef.current = setInterval(() => {
        setChallengeConfirmEmojiIndex(prev => (selection.length === 0 ? 0 : (prev + 1) % selection.length));
        animateEmoji();
      }, 540);
    }

    const topicLabel = challengeConfirmPrompt.translations?.[infoLanguage] ?? challengeConfirmPrompt.topic;
    fetchDailyPaintGallery({ topic: challengeConfirmPrompt.topic, topicLabel, limit: 5 })
      .then(userResults => {
        if (!cancelled) setChallengeConfirmEntries(userResults);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setChallengeConfirmError(error instanceof Error ? error.message : 'error');
          setChallengeConfirmEntries([]);
        }
      })
      .finally(() => {
        if (!cancelled) setChallengeConfirmLoading(false);
      });

    return () => {
      cancelled = true;
      if (challengeConfirmEmojiIntervalRef.current) {
        clearInterval(challengeConfirmEmojiIntervalRef.current);
        challengeConfirmEmojiIntervalRef.current = null;
      }
      challengeConfirmEmojiAnim.stopAnimation(() => challengeConfirmEmojiAnim.setValue(0));
    };
  }, [challengeConfirmPrompt, challengeConfirmEmojiAnim, infoLanguage]);

  // ── Animate confirm gallery entries ───────────────────────────────────────
  useEffect(() => {
    const current = challengeConfirmEntries ?? [];
    challengeConfirmAnimValuesRef.current = current.map(() => new RNAnimated.Value(0));
    current.forEach((_, index) => {
      const value = challengeConfirmAnimValuesRef.current[index];
      RNAnimated.timing(value, {
        toValue: 1,
        duration: 360,
        delay: index * 200,
        easing: RNEasing.out(RNEasing.ease),
        useNativeDriver: true,
      }).start();
    });
  }, [challengeConfirmEntries]);

  // ── Cleanup emoji interval on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (challengeConfirmEmojiIntervalRef.current) {
        clearInterval(challengeConfirmEmojiIntervalRef.current);
        challengeConfirmEmojiIntervalRef.current = null;
      }
      challengeConfirmEmojiAnim.stopAnimation(() => challengeConfirmEmojiAnim.setValue(0));
    };
  }, [challengeConfirmEmojiAnim]);

  // ── Notification check when confirm overlay opens ─────────────────────────
  useEffect(() => {
    async function checkNotificationPrompt() {
      if (challengeConfirmPrompt && !hasCheckedNotificationPrompt.current) {
        hasCheckedNotificationPrompt.current = true;
        const hasBeenAsked = await notificationService.hasBeenAsked?.() ?? false;
        const areEnabled = await notificationService.areEnabled?.() ?? false;
        setNotificationsEnabled(areEnabled);
        if (!hasBeenAsked && !areEnabled) {
          setShowNotificationPrompt(true);
        }
      }
      if (!challengeConfirmPrompt) {
        hasCheckedNotificationPrompt.current = false;
        setShowNotificationPrompt(false);
      }
    }
    void checkNotificationPrompt();
  }, [challengeConfirmPrompt, notificationService]);

  // ── Dice button cooldown timer ────────────────────────────────────────────
  useEffect(() => {
    if (!diceButtonCooldown || diceButtonCountdown <= 0) {
      if (diceButtonCooldown && diceButtonCountdown <= 0) setDiceButtonCooldown(false);
      return;
    }
    const timer = setTimeout(() => {
      setDiceButtonCountdown(prev => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [diceButtonCooldown, diceButtonCountdown]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const markPromptUploaded = useCallback((prompt: DailyPrompt | null) => {
    if (!prompt) return;
    setUploadedPromptTopics(prev => {
      const next = new Set(prev);
      next.add(prompt.topic);
      return next;
    });
    const today = new Date().toISOString().slice(0, 10);
    AsyncStorage.getItem('@emojipaint/completed_topics').then(raw => {
      try {
        const existing = raw ? (JSON.parse(raw) as { date: string; topics: string[] }) : null;
        const topics = existing?.date === today
          ? [...(existing.topics ?? []), prompt.topic]
          : [prompt.topic];
        return AsyncStorage.setItem('@emojipaint/completed_topics', JSON.stringify({ date: today, topics }));
      } catch {
        return AsyncStorage.setItem('@emojipaint/completed_topics', JSON.stringify({ date: today, topics: [prompt.topic] }));
      }
    }).catch(() => undefined);
  }, []);

  // AGB is accepted once at first launch (see features/onboarding/CinematicIntro),
  // so selecting a topic opens the confirm sheet straight away. It used to be
  // wrapped in requireProfileTerms, which silently did nothing for a fresh user
  // who had never opened Profile.
  const handleChallengeSelect = useCallback(async (prompt: DailyPrompt) => {
    if (uploadedPromptTopics.has(prompt.topic)) return;
    setChallengeConfirmEntries(null);
    setChallengeConfirmError(null);
    setChallengeConfirmPrompt(prompt);
    setChallengeConfirmLoading(true);
    setChallengeConfirmProcessing(false);
  }, [uploadedPromptTopics]);

  const confirmStartChallenge = useCallback(() => {
    if (!challengeConfirmPrompt || challengeConfirmProcessing) return;
    setChallengeConfirmProcessing(true);
    const promptToStart = challengeConfirmPrompt;
    setChallengeConfirmPrompt(null);
    setChallengeConfirmEntries(null);
    setChallengeConfirmError(null);
    setChallengeConfirmPreviewEntry(null);
    setChallengeConfirmLoading(false);
    startChallenge(promptToStart);
    setTimeout(() => setChallengeConfirmProcessing(false), 500);
  }, [challengeConfirmPrompt, challengeConfirmProcessing, startChallenge]);

  const cancelChallengeConfirm = useCallback(() => {
    setChallengeConfirmPrompt(null);
    setChallengeConfirmEntries(null);
    setChallengeConfirmError(null);
    setChallengeConfirmLoading(false);
    setChallengeConfirmPreviewEntry(null);
    setChallengeConfirmEmojis([]);
    setChallengeConfirmEmojiIndex(0);
    setChallengeConfirmProcessing(false);
  }, []);

  const openChallengeConfirmPreview = useCallback((entry: DailyPaintGalleryEntry) => {
    setChallengeConfirmPreviewEntry(entry);
  }, []);

  const closeChallengeConfirmPreview = useCallback(() => {
    setChallengeConfirmPreviewEntry(null);
  }, []);

  const handleEnableNotifications = useCallback(async () => {
    // iOS's own notification permission prompt still runs inside
    // requestPermissionsAndEnable — only the AGB wrapper is gone.
    const success = await notificationService.requestPermissionsAndEnable();
    setNotificationsEnabled(success);
    if (success) setShowNotificationPrompt(false);
  }, [notificationService]);

  const handleSkipNotifications = useCallback(async () => {
    await notificationService.markAsAsked?.();
    setShowNotificationPrompt(false);
  }, [notificationService]);

  const openMysteryTopicPicker = useCallback(async () => {
    setMysteryTopicLoading(true);
    try {
      const { getMysteryTopicPair } = await import('../../gesser/mysteryTopicPicker');
      const finalTopics = await getMysteryTopicPair(deviceId);
      setMysteryTopicChoices(finalTopics);
      setMysteryTopicLoading(false);
      fetch('https://emojipainter.com/api/mystery-topics.php?count=1')
        .then(r => r.json())
        .then((d: any) => { if (d?.ok && d?.count > 0) setMysteryTotalTopicCount(d.count); })
        .catch(() => {});
      setPendingMysteryTopicChoices(finalTopics);
      setMysteryModalPanel(0);
      setInfoVisible(false);
      setMysteryTopicWarningVisible(true);
    } catch (error: any) {
      Alert.alert('Mystery Topic Error', 'Something went wrong. Please try again.');
      setMysteryTopicLoading(false);
    }
  }, [deviceId, setInfoVisible]);

  const handleMysteryTopicSelect = useCallback(async () => {
    await openMysteryTopicPicker();
  }, [openMysteryTopicPicker]);

  const handleMysteryTopicPicked = useCallback((selectedTopic: { topicId: number; topic: string; timeMinutes?: number }) => {
    setMysteryTopic(selectedTopic);
    setMysteryTopicSelected(true);
    setMysteryTopicWarningVisible(false);
    setMysteryModalPanel(0);
    setMysteryPickerVisible(false);
    const mysteryPrompt: DailyPrompt = {
      emoji: '🎲',
      topic: selectedTopic.topic,
      timeMinutes: selectedTopic.timeMinutes ?? challengeMinutesForDay,
    };
    startChallenge(mysteryPrompt);
    setMysteryConfirmVisible(true);
    RNAnimated.sequence([
      RNAnimated.timing(mysteryBounceAnim, { toValue: -20, duration: 400, easing: RNEasing.out(RNEasing.ease), useNativeDriver: true }),
      RNAnimated.spring(mysteryBounceAnim, { toValue: 0, friction: 4, tension: 40, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setMysteryConfirmVisible(false), 3000);
  }, [challengeMinutesForDay, startChallenge, mysteryBounceAnim]);

  const confirmMysteryTopicWarning = useCallback(() => {
    setMysteryTopicChoices(pendingMysteryTopicChoices);
    setMysteryModalPanel(1);
  }, [pendingMysteryTopicChoices]);

  const cancelMysteryTopicWarning = useCallback(() => {
    setMysteryTopicWarningVisible(false);
    setMysteryModalPanel(0);
    setPendingMysteryTopicChoices([]);
  }, []);

  const handleShuffleMysteryTopics = useCallback(async () => {
    setMysteryTopicLoading(true);
    try {
      const { getMysteryTopicPair } = await import('../../gesser/mysteryTopicPicker');
      const newTopics = await getMysteryTopicPair(deviceId);
      setMysteryTopicHistory(prev => [...prev.slice(-9), mysteryTopicChoices].filter(s => s.length > 0));
      setMysteryTopicChoices(newTopics);
      setPendingMysteryTopicChoices(newTopics);
    } catch {
      Alert.alert('Error', 'Could not shuffle topics. Please try again.');
    } finally {
      setMysteryTopicLoading(false);
    }
  }, [deviceId, mysteryTopicChoices]);

  const cancelMysteryPicker = useCallback(async () => {
    setMysteryPickerVisible(false);
    setMysteryTopicWarningVisible(false);
    setMysteryModalPanel(0);
    setPendingMysteryTopicChoices([]);
    setMysteryTopicHistory([]);
    try {
      await AsyncStorage.removeItem('PENDING_MYSTERY_TOPIC');
    } catch {
      // ignore
    }
  }, []);

  const handleReloadMysteryTopic = useCallback(async () => {
    if (diceButtonCooldown) return;
    setMysteryTopicLoading(true);
    try {
      const GesserApi = await import('../../gesser/api/gesserClient');
      const result = await GesserApi.default.getRandomMysteryTopic(deviceId);
      setMysteryTopic({ topicId: result.topicId, topic: result.topic });
      setMysteryTopicLoading(false);
      setDiceButtonCooldown(true);
      setDiceButtonCountdown(5);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to reload topic. Please try again.');
      setMysteryTopicLoading(false);
    }
  }, [deviceId, diceButtonCooldown]);

  const handleCancelMysteryConfirm = useCallback(() => {
    mysteryConfirmCancelledRef.current = true;
    mysteryBounceAnim.stopAnimation();
    mysteryBounceAnim.setValue(0);
    setMysteryConfirmVisible(false);
  }, [mysteryBounceAnim]);

  const handleStartMysteryPainting = useCallback(() => {
    if (!mysteryTopic) return;
    mysteryConfirmCancelledRef.current = false;
    setInfoVisible(false);
    setShowMysteryTopicInInfo(false);
    const mysteryPrompt: DailyPrompt = {
      emoji: '🎲',
      topic: mysteryTopic.topic,
      timeMinutes: Math.floor(Math.random() * 8) + 2,
    };
    setMysteryTopicSelected(true);
    startChallenge(mysteryPrompt);
    setMysteryConfirmVisible(true);
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(mysteryBounceAnim, { toValue: -10, duration: 400, easing: RNEasing.out(RNEasing.quad), useNativeDriver: true }),
        RNAnimated.timing(mysteryBounceAnim, { toValue: 0, duration: 400, easing: RNEasing.in(RNEasing.quad), useNativeDriver: true }),
      ]),
      { iterations: 3 },
    ).start(() => {
      if (mysteryConfirmCancelledRef.current) return;
      setTimeout(() => {
        if (mysteryConfirmCancelledRef.current) return;
        setMysteryConfirmVisible(false);
        mysteryBounceAnim.setValue(0);
      }, 500);
    });
    setTimeout(() => {
      setMysteryConfirmVisible(false);
      mysteryBounceAnim.setValue(0);
    }, 5000);
  }, [mysteryTopic, mysteryBounceAnim, startChallenge, setInfoVisible]);

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    // Core
    activeChallenge,
    setActiveChallenge,
    activeChallengeRef,
    challengeRemainingMs,
    setChallengeRemainingMs,
    challengeCompleteVisible,
    setChallengeCompleteVisible,
    uploadedPromptTopics,
    setUploadedPromptTopics,
    // Refs
    challengeStartedAtRef,
    challengeEndedAtRef,
    challengeLastPromptRef,
    challengeStrokeCountRef,
    prevChallengeStrokeCountRef,
    challengeCompletionHandledRef,
    challengeUploadedRef,
    finalizeChallengeRef,
    // Complete modal
    challengeSnapshotUri,
    setChallengeSnapshotUri,
    challengeCaptureLoading,
    setChallengeCaptureLoading,
    challengeUploadLoading,
    setChallengeUploadLoading,
    challengeUploadNotice,
    setChallengeUploadNotice,
    showFrameUploadModal,
    setShowFrameUploadModal,
    challengeStrokeCount,
    setChallengeStrokeCount,
    // Confirm dialog
    challengeConfirmPrompt,
    setChallengeConfirmPrompt,
    challengeConfirmEntries,
    setChallengeConfirmEntries,
    challengeConfirmLoading,
    setChallengeConfirmLoading,
    challengeConfirmProcessing,
    setChallengeConfirmProcessing,
    challengeConfirmError,
    setChallengeConfirmError,
    challengeConfirmPreviewEntry,
    setChallengeConfirmPreviewEntry,
    challengeConfirmAnimValuesRef,
    challengeConfirmEmoji,
    challengeConfirmEmojiAnimatedStyle,
    confirmCopy,
    // Notifications
    showNotificationPrompt,
    setShowNotificationPrompt,
    notificationsEnabled,
    setNotificationsEnabled,
    // Mystery topic
    mysteryTopic,
    setMysteryTopic,
    mysteryTopicLoading,
    setMysteryTopicLoading,
    mysteryTopicSelected,
    setMysteryTopicSelected,
    showMysteryTopicInInfo,
    setShowMysteryTopicInInfo,
    diceButtonCooldown,
    setDiceButtonCooldown,
    diceButtonCountdown,
    setDiceButtonCountdown,
    mysteryTopicChoices,
    setMysteryTopicChoices,
    mysteryTopicHistory,
    setMysteryTopicHistory,
    mysteryConfirmVisible,
    setMysteryConfirmVisible,
    mysteryBounceAnim,
    mysteryConfirmCancelledRef,
    mysteryTopicWarningVisible,
    setMysteryTopicWarningVisible,
    mysteryModalPanel,
    setMysteryModalPanel,
    mysteryTotalTopicCount,
    setMysteryTotalTopicCount,
    pendingMysteryTopicChoices,
    setPendingMysteryTopicChoices,
    mysteryPickerVisible,
    setMysteryPickerVisible,
    // Derived
    challengeMinutesForDay,
    // Handlers
    handleChallengeSelect,
    cancelChallengeConfirm,
    confirmStartChallenge,
    openChallengeConfirmPreview,
    closeChallengeConfirmPreview,
    handleSkipNotifications,
    handleEnableNotifications,
    handleMysteryTopicSelect,
    handleMysteryTopicPicked,
    handleReloadMysteryTopic,
    handleStartMysteryPainting,
    handleCancelMysteryConfirm,
    confirmMysteryTopicWarning,
    cancelMysteryTopicWarning,
    handleShuffleMysteryTopics,
    cancelMysteryPicker,
    markPromptUploaded,
    getTopicMetadata,
  };
}

export type { UseChallengeResult };
