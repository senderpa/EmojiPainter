// @ts-nocheck
/**
 * useOnboarding — manages all state and side-effects for the
 * first-time welcome overlay and tutorial sequencing feature.
 *
 * Extracted from PaintScreen.tsx.
 * Contains: TutorialTranslations, TUTORIAL_TRANSLATIONS, WELCOME_UI_TRANSLATIONS,
 * welcome overlay state/handlers/effects, tutorial state/handlers/effects.
 *
 * NOTE ON CIRCULAR DEPENDENCIES
 * openGallery, openPrivateStudio, and refreshGallery are defined later in
 * PaintScreen than this hook's call site. They are passed as stable MutableRefObjects
 * so the hook can reference them without a TDZ error on first render.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Video } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomWelcomerVideo } from '../../utils/welcomerVideos';
import { notificationService } from '../../services/notificationService';
import { getDeviceLanguage, type InfoLanguage, type InfoCopy } from '../info-panel/useInfoPanel';
import { type LogoSet, LOGO_SETS } from '../../lib/logoManifest';
import { FIRST_TIME_USER_KEY } from '../../lib/paintConstants';

// Storage key for first-stroke helper (also exported for test resets in PaintScreen)
export const FIRST_STROKE_HELPER_KEY = 'emojipaint/first-stroke-helper-shown';

// ─────────────────────────────────────────────────────────────────────────────
// Tutorial translations
// ─────────────────────────────────────────────────────────────────────────────

export type TutorialTranslations = {
  title: string;
  lessons: Array<{
    title: string;
    description: string;
  }>;
  success: string;
  done: string;
};

export const TUTORIAL_TRANSLATIONS: Record<InfoLanguage, TutorialTranslations> = {
  en: {
    title: 'TUTORIAL',
    lessons: [
      { title: 'LESSON 1: Make a Stroke', description: 'Draw something on the canvas with your finger to create your first brush stroke!' },
      { title: 'LESSON 2: Pick a Different Emoji', description: 'Tap the emoji icon at the bottom to open the emoji picker and select a new brush!' },
      { title: 'LESSON 3: Make a Straight Line', description: 'Tap the 📏 button to activate line mode and draw a perfect straight line!' },
      { title: 'LESSON 4: Pick Random Emoji', description: 'Tap the 🎲 button to get a random emoji brush instantly!' },
      { title: 'LESSON 5: Watch Timelapse', description: 'Tap the 🎞️ button to see your creation come to life in a timelapse video!' },
      { title: 'LESSON 6: Find the Gallery', description: 'Tap the ℹ️ button, then explore the 🖼️ Gallery to see amazing creations!' }
    ],
    success: '✅ GREAT JOB!',
    done: '🎉 TUTORIAL COMPLETE!\nHave fun creating!'
  },
  de: {
    title: 'TUTORIAL',
    lessons: [
      { title: 'LEKTION 1: Mache einen Strich', description: 'Zeichne etwas auf der Leinwand mit deinem Finger, um deinen ersten Pinselstrich zu erstellen!' },
      { title: 'LEKTION 2: Wähle ein anderes Emoji', description: 'Tippe auf das Emoji-Symbol unten, um den Emoji-Picker zu öffnen und einen neuen Pinsel auszuwählen!' },
      { title: 'LEKTION 3: Mache eine gerade Linie', description: 'Tippe auf die 📏 Taste, um den Linienmodus zu aktivieren und eine perfekte gerade Linie zu zeichnen!' },
      { title: 'LEKTION 4: Zufälliges Emoji wählen', description: 'Tippe auf die 🎲 Taste, um sofort ein zufälliges Emoji als Pinsel zu erhalten!' },
      { title: 'LEKTION 5: Zeitraffer ansehen', description: 'Tippe auf die 🎞️ Taste, um deine Kreation als Zeitraffer-Video zu sehen!' },
      { title: 'LEKTION 6: Finde die Galerie', description: 'Tippe auf die ℹ️ Taste und erkunde dann die 🖼️ Galerie, um tolle Kreationen zu sehen!' }
    ],
    success: '✅ SUPER GEMACHT!',
    done: '🎉 TUTORIAL ABGESCHLOSSEN!\nViel Spaß beim Erstellen!'
  },
  ru: {
    title: 'ОБУЧЕНИЕ',
    lessons: [
      { title: 'УРОК 1: Сделай штрих', description: 'Нарисуй что-нибудь на холсте пальцем, чтобы создать свой первый мазок кисти!' },
      { title: 'УРОК 2: Выбери другое эмодзи', description: 'Нажми на иконку эмодзи внизу, чтобы открыть выбор эмодзи и выбрать новую кисть!' },
      { title: 'УРОК 3: Сделай прямую линию', description: 'Нажми кнопку 📏, чтобы активировать режим линии и нарисовать идеально прямую линию!' },
      { title: 'УРОК 4: Выбери случайное эмодзи', description: 'Нажми кнопку 🎲, чтобы мгновенно получить случайное эмодзи в качестве кисти!' },
      { title: 'УРОК 5: Просмотр таймлапс', description: 'Нажми кнопку 🎞️, чтобы увидеть свое творение в виде таймлапс-видео!' },
      { title: 'УРОК 6: Найди галерею', description: 'Нажми кнопку ℹ️, затем исследуй 🖼️ Галерею, чтобы увидеть потрясающие творения!' }
    ],
    success: '✅ ОТЛИЧНО!',
    done: '🎉 ОБУЧЕНИЕ ЗАВЕРШЕНО!\nПриятного творчества!'
  },
  zh: {
    title: '教程',
    lessons: [
      { title: '第1课：画一笔', description: '用手指在画布上画些东西，创建你的第一笔画！' },
      { title: '第2课：选择不同的表情符号', description: '点击底部的表情符号图标以打开表情符号选择器并选择新画笔！' },
      { title: '第3课：画一条直线', description: '点击 📏 按钮激活直线模式并画出完美的直线！' },
      { title: '第4课：选择随机表情符号', description: '点击 🎲 按钮立即获取随机表情符号画笔！' },
      { title: '第5课：观看延时视频', description: '点击 🎞️ 按钮查看你的创作延时视频！' },
      { title: '第6课：找到画廊', description: '点击 ℹ️ 按钮，然后探索 🖼️ 画廊以查看精彩作品！' }
    ],
    success: '✅ 做得好！',
    done: '🎉 教程完成！\n尽情创作吧！'
  },
  ko: {
    title: '튜토리얼',
    lessons: [
      { title: '레슨 1: 획 만들기', description: '손가락으로 캔버스에 무언가 그려서 첫 번째 브러시 획을 만드세요!' },
      { title: '레슨 2: 다른 이모지 선택', description: '하단의 이모지 아이콘을 탭하여 이모지 선택기를 열고 새 브러시를 선택하세요!' },
      { title: '레슨 3: 직선 그리기', description: '📏 버튼을 탭하여 선 모드를 활성화하고 완벽한 직선을 그으세요!' },
      { title: '레슨 4: 무작위 이모지 선택', description: '🎲 버튼을 탭하여 즉시 무작위 이모지 브러시를 받으세요!' },
      { title: '레슨 5: 타임랩스 보기', description: '🎞️ 버튼을 탭하여 타임랩스 비디오로 창작물을 확인하세요!' },
      { title: '레슨 6: 갤러리 찾기', description: 'ℹ️ 버튼을 탭한 다음 🖼️ 갤러리를 탐색하여 놀라운 작품을 확인하세요!' }
    ],
    success: '✅ 잘했어요!',
    done: '🎉 튜토리얼 완료!\n즐겁게 창작하세요!'
  },
  ja: {
    title: 'チュートリアル',
    lessons: [
      { title: 'レッスン1：ストロークを作る', description: '指でキャンバスに何か描いて最初のブラシストロークを作成してください！' },
      { title: 'レッスン2：別の絵文字を選ぶ', description: '下部の絵文字アイコンをタップして絵文字ピッカーを開き、新しいブラシを選択してください！' },
      { title: 'レッスン3：直線を引く', description: '📏 ボタンをタップしてラインモードを有効にし、完璧な直線を引いてください！' },
      { title: 'レッスン4：ランダム絵文字を選ぶ', description: '🎲 ボタンをタップしてランダムな絵文字ブラシをすぐに取得してください！' },
      { title: 'レッスン5：タイムラプスを見る', description: '🎞️ ボタンをタップして、作品のタイムラプスビデオを見てください！' },
      { title: 'レッスン6：ギャラリーを見つける', description: 'ℹ️ ボタンをタップしてから、🖼️ ギャラリーを探索して素晴らしい作品を見てください！' }
    ],
    success: '✅ よくできました！',
    done: '🎉 チュートリアル完了！\n楽しく創作してください！'
  },
  fr: {
    title: 'TUTORIEL',
    lessons: [
      { title: 'LEÇON 1 : Faire un trait', description: 'Dessinez quelque chose sur le canvas avec votre doigt pour créer votre premier coup de pinceau !' },
      { title: 'LEÇON 2 : Choisir un emoji différent', description: "Appuyez sur l'icône emoji en bas pour ouvrir le sélecteur d'emoji et choisir un nouveau pinceau !" },
      { title: 'LEÇON 3 : Tracer une ligne droite', description: 'Appuyez sur le bouton 📏 pour activer le mode ligne et tracer une ligne parfaitement droite !' },
      { title: 'LEÇON 4 : Choisir un emoji aléatoire', description: 'Appuyez sur le bouton 🎲 pour obtenir instantanément un pinceau emoji aléatoire !' },
      { title: 'LEÇON 5 : Regarder le timelapse', description: 'Appuyez sur le bouton 🎞️ pour voir votre création en vidéo timelapse !' },
      { title: 'LEÇON 6 : Trouver la galerie', description: 'Appuyez sur le bouton ℹ️, puis explorez la 🖼️ Galerie pour voir des créations incroyables !' }
    ],
    success: '✅ EXCELLENT TRAVAIL !',
    done: '🎉 TUTORIEL TERMINÉ !\nAmusez-vous bien !'
  },
  it: {
    title: 'TUTORIAL',
    lessons: [
      { title: 'LEZIONE 1: Fai un tratto', description: 'Disegna qualcosa sulla tela con il dito per creare il tuo primo tratto di pennello!' },
      { title: 'LEZIONE 2: Scegli un emoji diverso', description: "Tocca l'icona emoji in basso per aprire il selettore di emoji e scegliere un nuovo pennello!" },
      { title: 'LEZIONE 3: Disegna una linea retta', description: 'Tocca il pulsante 📏 per attivare la modalità linea e disegnare una linea perfettamente dritta!' },
      { title: 'LEZIONE 4: Scegli emoji casuali', description: 'Tocca il pulsante 🎲 per ottenere istantaneamente un pennello emoji casuale!' },
      { title: 'LEZIONE 5: Guarda il timelapse', description: 'Tocca il pulsante 🎞️ per vedere la tua creazione in un video timelapse!' },
      { title: 'LEZIONE 6: Trova la galleria', description: 'Tocca il pulsante ℹ️, poi esplora la 🖼️ Galleria per vedere creazioni straordinarie!' }
    ],
    success: '✅ OTTIMO LAVORO!',
    done: '🎉 TUTORIAL COMPLETO!\nDivertiti a creare!'
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Welcome UI translations
// ─────────────────────────────────────────────────────────────────────────────

export const WELCOME_UI_TRANSLATIONS: Record<InfoLanguage, {
  greeting: string;
  gallery: string;
  info: string;
  profile: string;
  startPainting: string;
  notifications: string;
  parentalControlsOn: string;
  parentalControlsOff: string;
  notifEnabledTitle: string;
  notifEnabledBody: string;
  notifEnabledBtn: string;
}> = {
  en: {
    greeting: 'Welcome!', gallery: '🖼️ Gallery', info: 'ℹ️ Info', profile: '👤 Profile', startPainting: 'Painting',
    notifications: '🔔 Notifications',
    parentalControlsOn: 'Parental Controls ✓', parentalControlsOff: 'Set Up Parental Controls',
    notifEnabledTitle: '🔔 Notifications Enabled!',
    notifEnabledBody: "You'll receive one random daily reminder to paint a topic challenge. The notification will arrive at a random time between 8 AM - 8 PM with one of today's daily topics.",
    notifEnabledBtn: 'Got it!',
  },
  de: {
    greeting: 'Willkommen!', gallery: '🖼️ Galerie', info: 'ℹ️ Info', profile: '👤 Profil', startPainting: 'Malen',
    notifications: '🔔 Benachrichtigungen',
    parentalControlsOn: 'Kindersicherung ✓', parentalControlsOff: 'Kindersicherung einrichten',
    notifEnabledTitle: '🔔 Benachrichtigungen aktiviert!',
    notifEnabledBody: 'Du erhältst täglich eine zufällige Erinnerung, eine Themen-Challenge zu malen. Die Benachrichtigung kommt zu einer zufälligen Zeit zwischen 8 und 20 Uhr.',
    notifEnabledBtn: 'Alles klar!',
  },
  ru: {
    greeting: 'Добро пожаловать!', gallery: '🖼️ Галерея', info: 'ℹ️ Инфо', profile: '👤 Профиль', startPainting: 'Рисовать',
    notifications: '🔔 Уведомления',
    parentalControlsOn: 'Родительский контроль ✓', parentalControlsOff: 'Настроить родительский контроль',
    notifEnabledTitle: '🔔 Уведомления включены!',
    notifEnabledBody: 'Вы будете получать одно случайное ежедневное напоминание нарисовать тематический челлендж в случайное время с 8:00 до 20:00.',
    notifEnabledBtn: 'Понятно!',
  },
  zh: {
    greeting: '欢迎!', gallery: '🖼️ 藝廊', info: 'ℹ️ 資訊', profile: '👤 個人資料', startPainting: '開始畫',
    notifications: '🔔 通知',
    parentalControlsOn: '家長控制 ✓', parentalControlsOff: '設置家長控制',
    notifEnabledTitle: '🔔 通知已啟用！',
    notifEnabledBody: '您每天將收到一個隨機提醒，提示您完成主題挑戰。通知將在每天 8:00 至 20:00 之間的隨機時間發送。',
    notifEnabledBtn: '知道了！',
  },
  ko: {
    greeting: '환영합니다!', gallery: '🖼️ 갤러리', info: 'ℹ️ 정보', profile: '👤 프로필', startPainting: '그리기',
    notifications: '🔔 알림',
    parentalControlsOn: '자녀 보호 기능 ✓', parentalControlsOff: '자녀 보호 기능 설정',
    notifEnabledTitle: '🔔 알림이 활성화되었습니다!',
    notifEnabledBody: '매일 오전 8시에서 오후 8시 사이 무작위 시간에 오늘의 주제 챌린지를 그리라는 알림 하나를 받게 됩니다.',
    notifEnabledBtn: '알겠어요!',
  },
  ja: {
    greeting: 'ようこそ!', gallery: '🖼️ ギャラリー', info: 'ℹ️ 情報', profile: '👤 プロフィール', startPainting: '描く',
    notifications: '🔔 通知',
    parentalControlsOn: 'ペアレンタルコントロール ✓', parentalControlsOff: 'ペアレンタルコントロールを設定',
    notifEnabledTitle: '🔔 通知が有効になりました！',
    notifEnabledBody: '毎日午前8時から午後8時の間のランダムな時間に、今日のテーマチャレンジを描くリマインダーが1件届きます。',
    notifEnabledBtn: 'わかりました！',
  },
  fr: {
    greeting: 'Bienvenue!', gallery: '🖼️ Galerie', info: 'ℹ️ Info', profile: '👤 Profil', startPainting: 'Peindre',
    notifications: '🔔 Notifications',
    parentalControlsOn: 'Contrôle parental ✓', parentalControlsOff: 'Configurer le contrôle parental',
    notifEnabledTitle: '🔔 Notifications activées !',
    notifEnabledBody: "Vous recevrez un rappel quotidien aléatoire pour peindre un défi thématique, à une heure aléatoire entre 8h et 20h.",
    notifEnabledBtn: 'Compris !',
  },
  it: {
    greeting: 'Benvenuto!', gallery: '🖼️ Galleria', info: 'ℹ️ Info', profile: '👤 Profilo', startPainting: 'Dipingi',
    notifications: '🔔 Notifiche',
    parentalControlsOn: 'Controllo genitori ✓', parentalControlsOff: 'Imposta controllo genitori',
    notifEnabledTitle: '🔔 Notifiche attivate!',
    notifEnabledBody: "Riceverai un promemoria giornaliero casuale per dipingere una sfida tematica, a un'ora casuale tra le 8:00 e le 20:00.",
    notifEnabledBtn: 'Capito!',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Late-defined callbacks that are not available at the hook's call site in PaintScreen.
 * These are passed as stable MutableRefObjects so the hook can call them via .current()
 * without a Temporal Dead Zone error on first render.
 */
export interface UseOnboardingLateCallbacks {
  openGallery: () => void;
  openPrivateStudio: () => void;
  refreshGallery: (mode: any, opts?: any) => void;
}

export interface UseOnboardingParams {
  // Info panel integration (available at hook call site)
  infoLanguage: InfoLanguage;
  setInfoLanguage: (lang: InfoLanguage) => void;
  setInfoVisible: (v: boolean) => void;
  // Late-defined navigation callbacks (passed as a stable ref to avoid TDZ errors)
  lateCallbacksRef: React.MutableRefObject<UseOnboardingLateCallbacks>;
  // Settings (available early from useAppSettings)
  settings: { tutorialModeEnabled: boolean; handMode: 'left' | 'right' };
  setHandMode: (mode: 'left' | 'right') => void;
  // Gallery state (available early)
  galleryEntries: any[];
  galleryError: string | null;
  galleryVisible: boolean;
  // Tutorial lesson detection inputs (available early from usePainting / local state)
  strokes: any[];
  liveVersion: number;
  isLineActive: boolean;
  // Notification setter (available before first tutorial-using useCallback)
  setNotificationsEnabled: (v: boolean) => void;
  // Parental controls (available early)
  setParentalControlsVisible: (v: boolean) => void;
}

export interface UseOnboardingResult {
  // ── Welcome state ─────────────────────────────────────────────────────────
  welcomeOverlayVisible: boolean;
  setWelcomeOverlayVisible: (v: boolean) => void;
  welcomerVideoSource: any;
  welcomeVideoRef: React.RefObject<Video | null>;
  welcomeVideoLogo: LogoSet | null;
  welcomeHasInteracted: boolean;
  setWelcomeHasInteracted: (v: boolean) => void;
  /** True while parental-controls opened from welcome; close → re-opens welcome */
  parentalFromWelcomeRef: React.MutableRefObject<boolean>;
  firstStrokeHelperVisible: boolean;
  firstStrokeHelperText: string;
  welcomeTypewriterText: string;
  /** Set true (before startup:hidden) to show welcome once startup splash hides */
  pendingFirstTimeWelcomeRef: React.MutableRefObject<boolean>;
  welcomeAutoOpenTimersRef: React.MutableRefObject<{
    gallery?: NodeJS.Timeout;
    leaderboard?: NodeJS.Timeout;
    workspace?: NodeJS.Timeout;
  }>;
  // ── Tutorial state ────────────────────────────────────────────────────────
  tutorialActive: boolean;
  setTutorialActive: (v: boolean) => void;
  tutorialCurrentLesson: number;
  setTutorialCurrentLesson: (v: number) => void;
  tutorialShowSuccess: boolean;
  tutorialEmojiPickerOpened: boolean;
  setTutorialEmojiPickerOpened: (v: boolean) => void;
  tutorialRandomEmojiPicked: boolean;
  setTutorialRandomEmojiPicked: (v: boolean) => void;
  tutorialTimelapseOpened: boolean;
  setTutorialTimelapseOpened: (v: boolean) => void;
  tutorialVideoLogo: LogoSet | null;
  tutorialVideoRef: React.RefObject<Video>;
  /** Synced ref of tutorialActive — used by canvas touch handler for zero-overhead check */
  tutorialActiveRef: React.MutableRefObject<boolean>;
  /** Ref set true when the gallery is opened during tutorial lesson 5 */
  tutorialGalleryOpenedRef: React.MutableRefObject<boolean>;
  tutorialBlinkScale: RNAnimated.Value;
  tutorialBlinkOpacity: RNAnimated.Value;
  // ── Handlers ──────────────────────────────────────────────────────────────
  loadWelcomeVideoQueue: () => Promise<void>;
  handleWelcomeVideoEnd: () => void;
  handleWelcomeVideoTap: () => void;
  handleWelcomeTutorial: () => void;
  handleWelcomeProfile: () => void;
  handleWelcomePaint: () => void;
  handleWelcomeGallery: () => void;
  /** Closes welcome, sets parentalFromWelcomeRef, opens parental controls modal */
  handleWelcomeParentalControls: () => void;
  /** Persist completion only after the user chooses a welcome action. */
  markOnboardingCompleted: () => void;
  /** Marks current lesson completed (sets tutorialLessonCompletedRef) */
  completeTutorialLesson: () => void;
  /**
   * Triggers a lesson completion by number. Used by PaintScreen's openGallery
   * callback and lesson detection effects that remain in PaintScreen.
   */
  triggerLessonCompletion: (lessonNumber: number) => void;
  // ── Pass-through from params for OnboardingOverlay ────────────────────────
  infoLanguage: InfoLanguage;
  setInfoLanguage: (lang: InfoLanguage) => void;
  settings: { tutorialModeEnabled: boolean; handMode: 'left' | 'right' };
  setHandMode: (mode: 'left' | 'right') => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useOnboarding(params: UseOnboardingParams): UseOnboardingResult {
  const {
    infoLanguage,
    setInfoLanguage,
    setInfoVisible,
    lateCallbacksRef,
    settings,
    setHandMode,
    galleryEntries,
    galleryError,
    galleryVisible,
    strokes,
    liveVersion,
    isLineActive,
    setNotificationsEnabled,
    setParentalControlsVisible,
  } = params;

  // ── Tutorial system state ─────────────────────────────────────────────────

  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialCurrentLesson, setTutorialCurrentLesson] = useState(0);
  const tutorialActiveRef = useRef(false);
  // Keep ref synced to state value every render
  tutorialActiveRef.current = tutorialActive;

  const [tutorialShowSuccess, setTutorialShowSuccess] = useState(false);
  const [tutorialEmojiPickerOpened, setTutorialEmojiPickerOpened] = useState(false);
  const [tutorialRandomEmojiPicked, setTutorialRandomEmojiPicked] = useState(false);
  const [tutorialTimelapseOpened, setTutorialTimelapseOpened] = useState(false);
  const tutorialInitialStrokeCountRef = useRef(0);
  const [tutorialVideoLogo, setTutorialVideoLogo] = useState<LogoSet | null>(null);
  const tutorialVideoRef = useRef<Video>(null);
  const tutorialGalleryOpenedRef = useRef(false);
  const tutorialLessonCompletedRef = useRef(false);

  // Animated values for blinking tutorial UI elements
  const tutorialBlinkScale = useRef(new RNAnimated.Value(1)).current;
  const tutorialBlinkOpacity = useRef(new RNAnimated.Value(1)).current;

  // ── First-time welcome overlay state ─────────────────────────────────────

  const [welcomeOverlayVisible, setWelcomeOverlayVisible] = useState(false);
  const [welcomeVideoLogo, setWelcomeVideoLogo] = useState<LogoSet | null>(null);
  const [welcomerVideoSource, setWelcomerVideoSource] = useState<any>(null);
  const welcomeVideoRef = useRef<Video | null>(null);
  // Queue refs (reserved for future video prefetch logic)
  const welcomeVideoQueueRef = useRef<LogoSet[]>([]);
  const welcomeVideoCurrentIndexRef = useRef(0);
  const welcomeVideoPreloadedIndexRef = useRef<number | null>(null);
  const welcomeVideoLoopCountRef = useRef(0);

  const [welcomeHasInteracted, setWelcomeHasInteracted] = useState(false);
  const parentalFromWelcomeRef = useRef(false);

  const [firstStrokeHelperVisible, setFirstStrokeHelperVisible] = useState(false);
  const [firstStrokeHelperText, setFirstStrokeHelperText] = useState('');
  const firstStrokeHelperTimerRef = useRef<NodeJS.Timeout | null>(null);
  const firstStrokeHelperBaselineRef = useRef({ live: 0, count: 0 });

  const welcomeAutoOpenTimersRef = useRef<{
    gallery?: NodeJS.Timeout;
    leaderboard?: NodeJS.Timeout;
    workspace?: NodeJS.Timeout;
  }>({});
  const [welcomeTypewriterText, setWelcomeTypewriterText] = useState('');
  const pendingFirstTimeWelcomeRef = useRef(false);

  // Welcome fly-in animation values (reserved for future staggered panel entrance)
  const welcomeTitleTranslateY = useRef(new RNAnimated.Value(-100)).current;
  const welcomeTitleOpacity = useRef(new RNAnimated.Value(0)).current;
  const welcomeLanguageTranslateX = useRef(new RNAnimated.Value(-200)).current;
  const welcomeLanguageOpacity = useRef(new RNAnimated.Value(0)).current;
  const welcomeTutorialTranslateX = useRef(new RNAnimated.Value(-200)).current;
  const welcomeTutorialOpacity = useRef(new RNAnimated.Value(0)).current;
  const welcomeProfileTranslateX = useRef(new RNAnimated.Value(200)).current;
  const welcomeProfileOpacity = useRef(new RNAnimated.Value(0)).current;
  const welcomePaintTranslateY = useRef(new RNAnimated.Value(200)).current;
  const welcomePaintOpacity = useRef(new RNAnimated.Value(0)).current;
  const penScaleAnim = useRef(new RNAnimated.Value(1)).current;

  // ── Tutorial helpers ──────────────────────────────────────────────────────

  const loadTutorialVideo = useCallback(() => {
    const videoLogos = LOGO_SETS.filter(set => set.type === 'video');
    if (videoLogos.length > 0) {
      const randomVideo = videoLogos[Math.floor(Math.random() * videoLogos.length)];
      setTutorialVideoLogo(randomVideo);
      console.log('[Tutorial] Loaded random video for tutorial bubble');
    }
  }, []);

  const completeTutorialLesson = useCallback(() => {
    console.log(`[Tutorial] Marking lesson ${tutorialCurrentLesson} as completed`);
    tutorialLessonCompletedRef.current = true;
  }, [tutorialCurrentLesson]);

  // Single in-progress guard prevents double-triggering on rapid state changes
  const tutorialCompletionInProgressRef = useRef(false);

  // Stable callback ref — updated every render, always closes over latest state
  const triggerLessonCompletionRef = useRef<(lessonNumber: number) => void>();
  triggerLessonCompletionRef.current = (lessonNumber: number) => {
    if (tutorialCompletionInProgressRef.current) {
      console.log('[Tutorial] Completion already in progress, ignoring');
      return;
    }
    console.log(`[Tutorial] Lesson ${lessonNumber} completed!`);
    tutorialCompletionInProgressRef.current = true;

    setTutorialShowSuccess(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setTimeout(() => {
      console.log(`[Tutorial] Success message shown, transitioning from lesson ${lessonNumber}...`);
      setTutorialShowSuccess(false);
      if (lessonNumber < 5) {
        const nextLesson = lessonNumber + 1;
        console.log(`[Tutorial] Moving to lesson ${nextLesson}`);
        setTutorialCurrentLesson(nextLesson);
        setTutorialEmojiPickerOpened(false);
        setTutorialRandomEmojiPicked(false);
        setTutorialTimelapseOpened(false);
        tutorialLessonCompletedRef.current = false;
        tutorialInitialStrokeCountRef.current = strokes.length;
        tutorialGalleryOpenedRef.current = false;
        loadTutorialVideo();
        console.log(`[Tutorial] Now on lesson ${nextLesson}, video loaded`);
        tutorialCompletionInProgressRef.current = false;
      } else {
        console.log('[Tutorial] Final lesson complete, showing completion message...');
        setTimeout(() => {
          console.log('[Tutorial] All lessons completed! Ending tutorial.');
          setTutorialActive(false);
          setTutorialCurrentLesson(0);
          tutorialCompletionInProgressRef.current = false;
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }, 2000);
      }
    }, 1500);
  };

  // Stable wrapper so PaintScreen can call trigger by number without importing the ref
  const triggerLessonCompletion = useCallback((lessonNumber: number) => {
    triggerLessonCompletionRef.current?.(lessonNumber);
  }, []);

  // ── Tutorial lesson detection effects ─────────────────────────────────────

  // Lesson 0: Make a stroke
  useEffect(() => {
    if (tutorialActive && tutorialCurrentLesson === 0 && !tutorialCompletionInProgressRef.current) {
      if (strokes.length > tutorialInitialStrokeCountRef.current) {
        console.log('[Tutorial] Lesson 0: Stroke made!');
        triggerLessonCompletionRef.current?.(0);
      }
    }
  }, [strokes.length, tutorialActive, tutorialCurrentLesson]);

  // Lesson 1: Pick a different emoji (picker opened)
  useEffect(() => {
    if (tutorialActive && tutorialCurrentLesson === 1 && tutorialEmojiPickerOpened && !tutorialCompletionInProgressRef.current) {
      console.log('[Tutorial] Lesson 1: Different emoji picked!');
      triggerLessonCompletionRef.current?.(1);
    }
  }, [tutorialActive, tutorialCurrentLesson, tutorialEmojiPickerOpened]);

  // Lesson 2: Make a straight line (line tool activated)
  useEffect(() => {
    if (tutorialActive && tutorialCurrentLesson === 2 && isLineActive && !tutorialCompletionInProgressRef.current) {
      console.log('[Tutorial] Lesson 2: Line tool activated!');
      triggerLessonCompletionRef.current?.(2);
    }
  }, [tutorialActive, tutorialCurrentLesson, isLineActive]);

  // Lesson 3: Pick random emoji
  useEffect(() => {
    if (tutorialActive && tutorialCurrentLesson === 3 && tutorialRandomEmojiPicked && !tutorialCompletionInProgressRef.current) {
      console.log('[Tutorial] Lesson 3: Random emoji picked!');
      triggerLessonCompletionRef.current?.(3);
    }
  }, [tutorialActive, tutorialCurrentLesson, tutorialRandomEmojiPicked]);

  // Lesson 4: Watch timelapse
  useEffect(() => {
    if (tutorialActive && tutorialCurrentLesson === 4 && tutorialTimelapseOpened && !tutorialCompletionInProgressRef.current) {
      console.log('[Tutorial] Lesson 4: Timelapse opened!');
      triggerLessonCompletionRef.current?.(4);
    }
  }, [tutorialActive, tutorialCurrentLesson, tutorialTimelapseOpened]);

  // Lesson 5: Find the gallery (detected via tutorialGalleryOpenedRef, called from openGallery)
  useEffect(() => {
    if (tutorialActive && tutorialCurrentLesson === 5 && tutorialGalleryOpenedRef.current && !tutorialCompletionInProgressRef.current) {
      console.log('[Tutorial] Lesson 5: Gallery found!');
      triggerLessonCompletionRef.current?.(5);
    }
  }, [tutorialActive, tutorialCurrentLesson]);

  // Tutorial blinking animation for highlighted UI elements
  useEffect(() => {
    if (!tutorialActive) return;
    const scaleAnim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(tutorialBlinkScale, { toValue: 1.2, duration: 600, useNativeDriver: true }),
        RNAnimated.timing(tutorialBlinkScale, { toValue: 1, duration: 600, useNativeDriver: true })
      ])
    );
    const opacityAnim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(tutorialBlinkOpacity, { toValue: 0.5, duration: 600, useNativeDriver: true }),
        RNAnimated.timing(tutorialBlinkOpacity, { toValue: 1, duration: 600, useNativeDriver: true })
      ])
    );
    scaleAnim.start();
    opacityAnim.start();
    return () => {
      scaleAnim.stop();
      opacityAnim.stop();
      tutorialBlinkScale.setValue(1);
      tutorialBlinkOpacity.setValue(1);
    };
  }, [tutorialActive, tutorialBlinkOpacity, tutorialBlinkScale]);

  // ── Welcome overlay handlers ──────────────────────────────────────────────

  const loadWelcomeVideoQueue = useCallback(async () => {
    const randomVideo = getRandomWelcomerVideo();
    setWelcomerVideoSource(randomVideo);
    console.log('[Welcome] Loaded random welcomer video');
    const notifEnabled = await notificationService.areEnabled();
    setNotificationsEnabled(notifEnabled);
  }, [setNotificationsEnabled]);

  /**
   * Play a DIFFERENT welcomer clip when one ends, instead of looping the same one.
   *
   * getRandomWelcomerVideo() can hand back the clip already on screen; re-setting the same
   * source would not restart it and the background would freeze on the last frame. So retry a
   * few times for a different one, and only fall back to replaying the current clip if the
   * pool is genuinely tiny.
   */
  const handleWelcomeVideoEnd = useCallback(() => {
    setWelcomerVideoSource((current) => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const candidate = getRandomWelcomerVideo();
        if (candidate !== current) {
          return candidate;
        }
      }
      return getRandomWelcomerVideo();
    });
  }, []);

  const handleWelcomeVideoTap = useCallback(() => {
    console.log('[Welcome] Video tapped, loading new random video');
    setWelcomerVideoSource(getRandomWelcomerVideo());
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleWelcomeTutorial = useCallback(() => {
    console.log('[Welcome] User selected Tutorial');
    void AsyncStorage.setItem(FIRST_TIME_USER_KEY, 'done');
    setWelcomeOverlayVisible(false);
    setTutorialActive(true);
    setTutorialCurrentLesson(0);
    setTutorialShowSuccess(false);
    setTutorialEmojiPickerOpened(false);
    setTutorialRandomEmojiPicked(false);
    setTutorialTimelapseOpened(false);
    tutorialInitialStrokeCountRef.current = strokes.length;
    tutorialGalleryOpenedRef.current = false;
    loadTutorialVideo();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [strokes.length, loadTutorialVideo]);

  const handleWelcomeProfile = useCallback(() => {
    console.log('[Welcome] User selected Profile');
    void AsyncStorage.setItem(FIRST_TIME_USER_KEY, 'done');
    setWelcomeHasInteracted(true);
    setWelcomeOverlayVisible(false);
    lateCallbacksRef.current.openPrivateStudio();
  }, [lateCallbacksRef]);

  const handleWelcomePaint = useCallback(() => {
    console.log('[Welcome] User selected Paint');
    void AsyncStorage.setItem(FIRST_TIME_USER_KEY, 'done');
    setWelcomeHasInteracted(true);
    setWelcomeOverlayVisible(false);
    void (async () => {
      try {
        const shown = await AsyncStorage.getItem(FIRST_STROKE_HELPER_KEY);
        if (shown || strokes.length > 0) return;
        await AsyncStorage.setItem(FIRST_STROKE_HELPER_KEY, '1');
        firstStrokeHelperBaselineRef.current = { live: liveVersion, count: strokes.length };
        setFirstStrokeHelperVisible(true);
      } catch {
        // Storage failure: skip helper silently
      }
    })();
  }, [strokes.length, liveVersion]);

  const handleWelcomeGallery = useCallback(() => {
    console.log('[Welcome] User selected Gallery');
    void AsyncStorage.setItem(FIRST_TIME_USER_KEY, 'done');
    setWelcomeHasInteracted(true);
    setWelcomeOverlayVisible(false);
    setTimeout(() => { lateCallbacksRef.current.openGallery(); }, 100);
  }, [lateCallbacksRef]);

  const handleWelcomeParentalControls = useCallback(() => {
    void Haptics.selectionAsync();
    parentalFromWelcomeRef.current = true;
    setWelcomeOverlayVisible(false);
    setParentalControlsVisible(true);
  }, [setParentalControlsVisible]);

  const markOnboardingCompleted = useCallback(() => {
    void AsyncStorage.setItem(FIRST_TIME_USER_KEY, 'done');
  }, []);

  // ── First-stroke helper effects ───────────────────────────────────────────

  useEffect(() => {
    if (!firstStrokeHelperVisible) {
      setFirstStrokeHelperText('');
      return;
    }
    const fullText = 'Tap here to make an emoji stroke! 🖌️';
    let index = 0;
    const typeInterval = setInterval(() => {
      index++;
      setFirstStrokeHelperText(fullText.slice(0, index));
      if (index >= fullText.length) clearInterval(typeInterval);
    }, 55);
    firstStrokeHelperTimerRef.current = setTimeout(() => {
      setFirstStrokeHelperVisible(false);
    }, 7000);
    return () => {
      clearInterval(typeInterval);
      if (firstStrokeHelperTimerRef.current) {
        clearTimeout(firstStrokeHelperTimerRef.current);
        firstStrokeHelperTimerRef.current = null;
      }
    };
  }, [firstStrokeHelperVisible]);

  useEffect(() => {
    const baseline = firstStrokeHelperBaselineRef.current;
    if (
      firstStrokeHelperVisible &&
      (liveVersion !== baseline.live || strokes.length !== baseline.count)
    ) {
      setFirstStrokeHelperVisible(false);
    }
  }, [firstStrokeHelperVisible, liveVersion, strokes.length]);

  // ── Welcome overlay effects ───────────────────────────────────────────────

  // Auto-detect device language when welcome opens for the first time
  useEffect(() => {
    if (welcomeOverlayVisible && !welcomeHasInteracted) {
      const detectedLanguage = getDeviceLanguage();
      console.log('[Welcome] Detected device language:', detectedLanguage);
      setInfoLanguage(detectedLanguage);
    }
  }, [welcomeOverlayVisible, welcomeHasInteracted, setInfoLanguage]);

  // Fly-in animations for welcome panel (staggered entry)
  useEffect(() => {
    if (!welcomeOverlayVisible) return;
    welcomeTitleTranslateY.setValue(-100);
    welcomeTitleOpacity.setValue(0);
    welcomeLanguageTranslateX.setValue(-200);
    welcomeLanguageOpacity.setValue(0);
    welcomeTutorialTranslateX.setValue(-200);
    welcomeTutorialOpacity.setValue(0);
    welcomeProfileTranslateX.setValue(200);
    welcomeProfileOpacity.setValue(0);
    welcomePaintTranslateY.setValue(200);
    welcomePaintOpacity.setValue(0);

    RNAnimated.parallel([
      RNAnimated.spring(welcomeTitleTranslateY, { toValue: 0, useNativeDriver: true, damping: 15, stiffness: 150 }),
      RNAnimated.spring(welcomeTitleOpacity, { toValue: 1, useNativeDriver: true })
    ]).start();
    setTimeout(() => {
      RNAnimated.parallel([
        RNAnimated.spring(welcomeLanguageTranslateX, { toValue: 0, useNativeDriver: true, damping: 15, stiffness: 150 }),
        RNAnimated.spring(welcomeLanguageOpacity, { toValue: 1, useNativeDriver: true })
      ]).start();
    }, 150);
    setTimeout(() => {
      RNAnimated.parallel([
        RNAnimated.spring(welcomeTutorialTranslateX, { toValue: 0, useNativeDriver: true, damping: 15, stiffness: 150 }),
        RNAnimated.spring(welcomeTutorialOpacity, { toValue: 1, useNativeDriver: true })
      ]).start();
    }, 300);
    setTimeout(() => {
      RNAnimated.parallel([
        RNAnimated.spring(welcomeProfileTranslateX, { toValue: 0, useNativeDriver: true, damping: 15, stiffness: 150 }),
        RNAnimated.spring(welcomeProfileOpacity, { toValue: 1, useNativeDriver: true })
      ]).start();
    }, 450);
    setTimeout(() => {
      RNAnimated.parallel([
        RNAnimated.spring(welcomePaintTranslateY, { toValue: 0, useNativeDriver: true, damping: 15, stiffness: 150 }),
        RNAnimated.spring(welcomePaintOpacity, { toValue: 1, useNativeDriver: true })
      ]).start();
    }, 600);
  }, [
    welcomeOverlayVisible,
    welcomeTitleTranslateY, welcomeTitleOpacity,
    welcomeLanguageTranslateX, welcomeLanguageOpacity,
    welcomeTutorialTranslateX, welcomeTutorialOpacity,
    welcomeProfileTranslateX, welcomeProfileOpacity,
    welcomePaintTranslateY, welcomePaintOpacity,
  ]);

  // Auto-repick welcomer video every 30s
  useEffect(() => {
    if (!welcomeOverlayVisible) return;
    console.log('[Welcome] Starting 30s video rotation');
    const interval = setInterval(() => {
      console.log('[Welcome] Auto-repicking welcomer video (30s elapsed)');
      setWelcomerVideoSource(getRandomWelcomerVideo());
    }, 30000);
    return () => { clearInterval(interval); };
  }, [welcomeOverlayVisible]);

  // Typewriter effect for greeting — reruns on language change
  useEffect(() => {
    if (!welcomeOverlayVisible) return;
    const fullText = WELCOME_UI_TRANSLATIONS[infoLanguage].greeting;
    let currentIndex = 0;
    setWelcomeTypewriterText('');
    const interval = setInterval(() => {
      if (currentIndex <= fullText.length) {
        setWelcomeTypewriterText(fullText.slice(0, currentIndex));
        currentIndex++;
      } else {
        currentIndex = 0;
        setWelcomeTypewriterText('');
      }
    }, 200);
    return () => { clearInterval(interval); };
  }, [welcomeOverlayVisible, infoLanguage]);

  // ── Return result ─────────────────────────────────────────────────────────

  return {
    // Welcome state
    welcomeOverlayVisible,
    setWelcomeOverlayVisible,
    welcomerVideoSource,
    welcomeVideoRef,
    welcomeVideoLogo,
    welcomeHasInteracted,
    setWelcomeHasInteracted,
    parentalFromWelcomeRef,
    firstStrokeHelperVisible,
    firstStrokeHelperText,
    welcomeTypewriterText,
    pendingFirstTimeWelcomeRef,
    welcomeAutoOpenTimersRef,
    // Tutorial state
    tutorialActive,
    setTutorialActive,
    tutorialCurrentLesson,
    setTutorialCurrentLesson,
    tutorialShowSuccess,
    tutorialEmojiPickerOpened,
    setTutorialEmojiPickerOpened,
    tutorialRandomEmojiPicked,
    setTutorialRandomEmojiPicked,
    tutorialTimelapseOpened,
    setTutorialTimelapseOpened,
    tutorialVideoLogo,
    tutorialVideoRef,
    tutorialActiveRef,
    tutorialGalleryOpenedRef,
    tutorialBlinkScale,
    tutorialBlinkOpacity,
    // Handlers
    loadWelcomeVideoQueue,
    handleWelcomeVideoEnd,
    handleWelcomeVideoTap,
    handleWelcomeTutorial,
    handleWelcomeProfile,
    handleWelcomePaint,
    handleWelcomeGallery,
    handleWelcomeParentalControls,
    markOnboardingCompleted,
    completeTutorialLesson,
    triggerLessonCompletion,
    // Pass-through params for OnboardingOverlay rendering
    infoLanguage,
    setInfoLanguage,
    settings,
    setHandMode,
  };
}
