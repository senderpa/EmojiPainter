/**
 * useInfoPanel — manages all state and side-effects for the Info Panel feature.
 *
 * Extracted from PaintScreen.tsx.
 * Contains: InfoLanguage type, InfoCopy interface, INFO_LANGUAGE_OPTIONS, INFO_COPY,
 * INFO_LANGUAGE_LOCALES, LEADERBOARD_EMOJI_FRAMES, ANIMATION_LESSONS_EMOJI_FRAMES,
 * getDeviceLanguage(), and the full hook with all state / handlers / effects.
 */
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, Easing as RNEasing } from 'react-native';
import type { ScrollView } from 'react-native';
import type { Video } from 'expo-av';
import * as Haptics from 'expo-haptics';
import * as Localization from '../../lib/localization';
import { loadLanguagePreference, saveLanguagePreference } from '../../lib/languageStorage';
import { getAllVideos } from '../../video/videoStorage';
import { fetchDailyPaintGallery, type DailyPaintGalleryEntry } from '../../lib/dailyPaintGallery';
import type { DailyPrompt } from '../../types/dailyPrompt';
import { formatPrompt } from '../../types/dailyPrompt';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type InfoLanguage = 'en' | 'de' | 'ru' | 'zh' | 'ko' | 'ja' | 'fr' | 'it';

export interface InfoCopy {
  title: string;
  subtitle: string;
  description: string[];
  tips: Array<{ icon: string; title: string; detail: string }>;
  buttons: {
    liveGallery: { title: string; subtitle: string };
    profileStudio: { title: string; subtitle: string };
    videoEditor: { title: string; subtitle: string };
    videoStorage: { title: string; subtitle: string };
  };
  challenge: {
    promptSubtitle: string;
  };
  leaderboard: {
    title: string;
    subtitle: string;
  };
  animationLessons: {
    title: string;
    subtitle: string;
    overlayTitle: string;
    wording: { title: string; status: string };
    walking: { title: string; status: string };
    jumping: { title: string; status: string };
  };
  allOverSettings: {
    title: string;
    subtitle: string;
    overlayTitle: string;
    themeLabel: string;
    themeDark: string;
    themeLight: string;
    handModeLabel: string;
    handModeRight: string;
    handModeLeft: string;
    helperModeLabel: string;
    helperModeOn: string;
    helperModeOff: string;
    tutorialModeLabel: string;
    tutorialModeOn: string;
    tutorialModeOff: string;
    offlineModeLabel: string;
    offlineModeOnline: string;
    offlineModeOffline: string;
    parentalControlsLabel: string;
  };
  profileOverlay: {
    tapToSetName: string;
    shownInGalleryAndLeaderboard: string;
  };
  mystery: {
    panel0Title: string;
    panel0Rule1: string;
    panel0Rule2: string;
    panel0Rule3: string;
    panel0PickBtn: string;
    panel0Cancel: string;
    panel1Title: string;
    panel1Subtitle: string;
    panel1TapToPaint: string;
    panel1ShuffleBtn: string;
    panel1Back: string;
    panel1Cancel: string;
    confirmImportant: string;
    confirmBody: string;
    confirmHint: string;
    confirmBtn: string;
  };
  welcome: {
    title: string;
    subtitle: string;
    tutorial: { title: string; subtitle: string };
    profile: { title: string; subtitle: string };
    paint: { title: string; subtitle: string };
  };
  multiPaint: {
    title: string;
    description: string;
    openButton: string;
  };
  footer: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const LEADERBOARD_EMOJI_FRAMES = ['🏆', '🥇', '🥈', '🥉', '📊', '📈', '📣'];
export const ANIMATION_LESSONS_EMOJI_FRAMES = ['🖍️', '🪄', '🪠', '🖌️', '🗡️', '🖋️', '🖊️'];

export const INFO_LANGUAGE_OPTIONS: Array<{ id: InfoLanguage; label: string; flag: string }> = [
  { id: 'en', label: 'English', flag: '🇺🇸' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { id: 'ru', label: 'Русский', flag: '🇷🇺' },
  { id: 'zh', label: '中文', flag: '🇨🇳' },
  { id: 'ko', label: '한국어', flag: '🇰🇷' },
  { id: 'ja', label: '日本語', flag: '🇯🇵' },
  { id: 'fr', label: 'Français', flag: '🇫🇷' },
  { id: 'it', label: 'Italiano', flag: '🇮🇹' },
];

export const INFO_LANGUAGE_LOCALES: Record<InfoLanguage, string> = {
  en: 'en-US',
  de: 'de-DE',
  ru: 'ru-RU',
  zh: 'zh-CN',
  ko: 'ko-KR',
  ja: 'ja-JP',
  fr: 'fr-FR',
  it: 'it-IT',
};

export interface InfoWorkspaceCardCopy {
  title: string;
  subtitle: string;
  button: string;
}

/** Direct workspace links shown immediately above Animation Lessons. */
export const INFO_WORKSPACE_COPY: Record<InfoLanguage, {
  animator: InfoWorkspaceCardCopy;
  arPainting: InfoWorkspaceCardCopy;
  vector: InfoWorkspaceCardCopy;
}> = {
  en: {
    animator: { title: 'Animator', subtitle: 'Create frame-by-frame timing in the Framer workspace.', button: 'Open Animator' },
    arPainting: { title: 'AR Painting', subtitle: 'Paint emoji strokes directly into the real world.', button: 'Open AR Painting' },
    vector: { title: 'Vector Mode', subtitle: 'Use an infinite canvas with strokes that stay crisp at every zoom.', button: 'Open Vector' },
  },
  de: {
    animator: { title: 'Animator', subtitle: 'Erstelle Bild für Bild Timing im Framer-Arbeitsbereich.', button: 'Animator öffnen' },
    arPainting: { title: 'AR-Malen', subtitle: 'Male Emoji-Striche direkt in die echte Welt.', button: 'AR-Malen öffnen' },
    vector: { title: 'Vektor-Modus', subtitle: 'Eine unendliche Leinwand mit gestochen scharfen Strichen bei jedem Zoom.', button: 'Vektor öffnen' },
  },
  ru: {
    animator: { title: 'Аниматор', subtitle: 'Создавайте покадровое тайминг-движение в рабочем пространстве Framer.', button: 'Открыть аниматор' },
    arPainting: { title: 'AR-рисование', subtitle: 'Рисуйте эмодзи прямо в реальном мире.', button: 'Открыть AR-рисование' },
    vector: { title: 'Векторный режим', subtitle: 'Бесконечный холст — штрихи остаются чёткими при любом увеличении.', button: 'Открыть вектор' },
  },
  zh: {
    animator: { title: '动画师', subtitle: '在 Framer 工作区中创建逐帧时间动画。', button: '打开动画师' },
    arPainting: { title: 'AR 绘画', subtitle: '直接在真实世界中绘制表情符号笔画。', button: '打开 AR 绘画' },
    vector: { title: '矢量模式', subtitle: '使用无限画布，任意缩放时笔画都保持清晰。', button: '打开矢量模式' },
  },
  ko: {
    animator: { title: '애니메이터', subtitle: 'Framer 작업 공간에서 프레임별 타이밍을 만들어 보세요.', button: '애니메이터 열기' },
    arPainting: { title: 'AR 페인팅', subtitle: '현실 공간에 이모지 스트로크를 직접 그려 보세요.', button: 'AR 페인팅 열기' },
    vector: { title: '벡터 모드', subtitle: '어떤 확대에서도 선명한 무한 캔버스를 사용하세요.', button: '벡터 열기' },
  },
  ja: {
    animator: { title: 'アニメーター', subtitle: 'Framerワークスペースでコマごとのタイミングを作成します。', button: 'アニメーターを開く' },
    arPainting: { title: 'ARペイント', subtitle: '現実の空間に絵文字のストロークを直接描きます。', button: 'ARペイントを開く' },
    vector: { title: 'ベクターモード', subtitle: 'どこまで拡大しても線が鮮明な無限キャンバスです。', button: 'ベクターを開く' },
  },
  fr: {
    animator: { title: 'Animateur', subtitle: 'Créez le timing image par image dans l’espace Framer.', button: 'Ouvrir l’animateur' },
    arPainting: { title: 'Peinture AR', subtitle: 'Peignez des traits emoji directement dans le monde réel.', button: 'Ouvrir la peinture AR' },
    vector: { title: 'Mode vectoriel', subtitle: 'Une toile infinie, nette à chaque niveau de zoom.', button: 'Ouvrir le vectoriel' },
  },
  it: {
    animator: { title: 'Animatore', subtitle: 'Crea il ritmo fotogramma per fotogramma nello spazio Framer.', button: 'Apri animatore' },
    arPainting: { title: 'Pittura AR', subtitle: 'Dipingi tratti emoji direttamente nel mondo reale.', button: 'Apri pittura AR' },
    vector: { title: 'Modalità vettoriale', subtitle: 'Una tela infinita con tratti nitidi a ogni zoom.', button: 'Apri vettoriale' },
  },
};

export interface AnimationTutorialCopy {
  title: string;
  body: string;
  dismiss: string;
  timeline: string;
  cues: string[];
}

/** Timed lesson captions, kept in the same language set as the Info panel. */
export const ANIMATION_TUTORIAL_COPY: Record<InfoLanguage, AnimationTutorialCopy> = {
  en: {
    title: '🎨 Animation Tutorial',
    body: 'Watch how to use the Framer to create frame-by-frame animations.',
    dismiss: 'Tap ❎ anytime to close.',
    timeline: 'Timeline',
    cues: ['After 5s: tap 📽️ to find the Animator', 'Paint time-based strokes', 'Change a stroke’s timing with the Length slider', 'Or change the whole animation with FPS', 'Tap 💾 to export or save'],
  },
  de: {
    title: '🎨 Animations-Tutorial',
    body: 'Sieh dir an, wie du mit Framer Bild-für-Bild-Animationen erstellst.',
    dismiss: 'Tippe jederzeit auf ❎ zum Schließen.',
    timeline: 'Zeitleiste',
    cues: ['Nach 5 s: Tippe auf 📽️ für den Animator', 'Male zeitgesteuerte Striche', 'Ändere das Timing mit dem Längenregler', 'Oder ändere die gesamte Animation mit FPS', 'Tippe auf 💾 zum Exportieren oder Speichern'],
  },
  ru: {
    title: '🎨 Урок по анимации',
    body: 'Посмотрите, как создавать покадровую анимацию во Framer.',
    dismiss: 'Нажмите ❎ в любой момент, чтобы закрыть.',
    timeline: 'Таймлайн',
    cues: ['После 5 с: нажмите 📽️, чтобы открыть аниматор', 'Рисуйте штрихи с таймингом', 'Меняйте тайминг штриха ползунком длины', 'Или меняйте всю анимацию через FPS', 'Нажмите 💾 для экспорта или сохранения'],
  },
  zh: {
    title: '🎨 动画教程',
    body: '观看如何使用 Framer 创建逐帧动画。',
    dismiss: '随时点击 ❎ 关闭。',
    timeline: '时间线',
    cues: ['5 秒后：点击 📽️ 找到动画师', '绘制有时间变化的笔画', '用长度滑块改变笔画时间', '或用 FPS 改变整个动画', '点击 💾 导出或保存'],
  },
  ko: {
    title: '🎨 애니메이션 튜토리얼',
    body: 'Framer로 프레임별 애니메이션을 만드는 방법을 확인하세요.',
    dismiss: '언제든 ❎를 눌러 닫으세요.',
    timeline: '타임라인',
    cues: ['5초 후: 📽️를 눌러 애니메이터 찾기', '시간이 있는 스트로크 그리기', '길이 슬라이더로 스트로크 타이밍 변경', '또는 FPS로 전체 애니메이션 변경', '💾를 눌러 내보내거나 저장'],
  },
  ja: {
    title: '🎨 アニメーションチュートリアル',
    body: 'Framerでコマごとのアニメーションを作る方法を紹介します。',
    dismiss: 'いつでも ❎ をタップして閉じられます。',
    timeline: 'タイムライン',
    cues: ['5秒後：📽️をタップしてアニメーターを開く', '時間のあるストロークを描く', '長さスライダーでストロークのタイミングを変更', 'またはFPSで全体のアニメーションを変更', '💾をタップして書き出しまたは保存'],
  },
  fr: {
    title: '🎨 Tutoriel d’animation',
    body: 'Découvrez comment utiliser Framer pour créer des animations image par image.',
    dismiss: 'Touchez ❎ à tout moment pour fermer.',
    timeline: 'Timeline',
    cues: ['Après 5 s : touchez 📽️ pour trouver l’animateur', 'Peignez des traits avec un timing', 'Modifiez le timing avec le curseur de longueur', 'Ou modifiez toute l’animation avec les FPS', 'Touchez 💾 pour exporter ou enregistrer'],
  },
  it: {
    title: '🎨 Tutorial di animazione',
    body: 'Scopri come usare Framer per creare animazioni fotogramma per fotogramma.',
    dismiss: 'Tocca ❎ in qualsiasi momento per chiudere.',
    timeline: 'Timeline',
    cues: ['Dopo 5 s: tocca 📽️ per trovare l’animatore', 'Disegna tratti basati sul tempo', 'Cambia il timing del tratto con il cursore lunghezza', 'Oppure cambia tutta l’animazione con gli FPS', 'Tocca 💾 per esportare o salvare'],
  },
};

export interface RateAppCopy {
  title: string;
  subtitle: string;
  launching: string;
}

/** Localized copy for the animated rating invitation. */
export const RATE_APP_COPY: Record<InfoLanguage, RateAppCopy> = {
  en: { title: 'Rate App', subtitle: 'Rate EmojiPainter on the App Store', launching: 'Opening rating…' },
  de: { title: 'App bewerten', subtitle: 'Bewerte EmojiPainter im App Store', launching: 'Bewertung wird geöffnet…' },
  ru: { title: 'Оценить приложение', subtitle: 'Оцените EmojiPainter в App Store', launching: 'Открываем оценку…' },
  zh: { title: '评价应用', subtitle: '在 App Store 为 EmojiPainter 评分', launching: '正在打开评分…' },
  ko: { title: '앱 평가하기', subtitle: 'App Store에서 EmojiPainter 평가하기', launching: '평가 화면을 여는 중…' },
  ja: { title: 'アプリを評価', subtitle: 'App StoreでEmojiPainterを評価', launching: '評価を開いています…' },
  fr: { title: 'Noter l’app', subtitle: 'Notez EmojiPainter sur l’App Store', launching: 'Ouverture de la note…' },
  it: { title: 'Valuta l’app', subtitle: 'Valuta EmojiPainter sull’App Store', launching: 'Apertura della valutazione…' },
};

export const INFO_COPY: Record<InfoLanguage, InfoCopy> = {
  en: {
    title: 'info:',
    subtitle: '',
    description: [
      '\n\nTap 🖌️ for freehand brush strokes or 📏 to lay down perfect lines. The 🎲 button swaps in a fresh emoji instantly.',
      'Pinch, pan, and rotate the trace image to guide your composition. Spacing, size, and opacity sliders respond in real time.',
      'Save quick snapshots, export PNGs, or replay your timelapse to share the full story behind your artwork.',
    ],
    tips: [
      { icon: '🖌️', title: 'Brush', detail: 'Freehand strokes with pressure-aware spacing.' },
      { icon: '📏', title: 'Line', detail: 'Drag to lock a straight stamp line between two points.' },
      { icon: '🎲', title: 'Shuffle', detail: 'Instantly switch to a random emoji brush.' },
      { icon: '💾', title: 'Projects', detail: 'Save progress locally and reload anytime.' },
      { icon: '🎞️', title: 'Timelapse Export', detail: 'Export frames as transparent MOV files, compose animations, or create video layers.' },
      { icon: '📽️', title: 'Frame-by-Frame', detail: 'Create hand-drawn animations frame by frame with onion skinning for smooth motion.' },
      { icon: '🏛️', title: 'Live Gallery', detail: 'Browse community artwork with voting, explore all uploads with cloud storage sync.' },
      { icon: '🗂️', title: 'Project Overview', detail: 'Manage all saved projects, organize artwork, and quick-load any session.' },
      { icon: '🖼️', title: 'Import Trace', detail: 'Load reference images to trace over (not included in final export).' },
      { icon: '🎲', title: 'Mystery Challenge', detail: 'Paint a secret topic from a pool of 999+ — the topic stays hidden in the gallery and others try to guess it from your art. Shuffle never repeats topics you already saw.' },
    ],
    buttons: {
      liveGallery: { title: 'Live Gallery', subtitle: 'Vote & explore community art' },
      profileStudio: { title: 'Profile Studio', subtitle: 'Manage passport & uploads' },
      videoEditor: { title: 'Video Editor', subtitle: 'Layer & compose transparent videos' },
      videoStorage: { title: 'Video Storage', subtitle: 'Manage transparent MOV files' },
    },
    challenge: { promptSubtitle: 'Pick a prompt to start a {X}-minute sprint.' },
    leaderboard: { title: 'Leaderboard', subtitle: 'See top painters & compete globally' },
    animationLessons: {
      title: 'Animation Lessons',
      subtitle: 'Learn animation techniques',
      overlayTitle: 'Animation Lessons',
      wording: { title: 'Wording', status: '' },
      walking: { title: 'Walking', status: 'Coming soon' },
      jumping: { title: 'Jumping', status: 'Coming soon' },
    },
    allOverSettings: {
      title: 'All Over Settings',
      subtitle: 'Configure theme & layout',
      overlayTitle: 'All Over Settings',
      themeLabel: 'Theme Mode',
      themeDark: 'Dark Mode',
      themeLight: 'Light Mode',
      handModeLabel: 'Hand Mode',
      handModeRight: 'Right Hand',
      handModeLeft: 'Left Hand',
      helperModeLabel: 'Helper Labels',
      helperModeOn: 'On',
      helperModeOff: 'Off',
      tutorialModeLabel: 'Tutorial Tips',
      tutorialModeOn: 'On',
      tutorialModeOff: 'Off',
      offlineModeLabel: 'Connection Mode',
      offlineModeOnline: 'Online',
      offlineModeOffline: 'Offline',
      parentalControlsLabel: 'Parental Controls',
    },
    profileOverlay: {
      tapToSetName: '✏️  Tap to set your name',
      shownInGalleryAndLeaderboard: 'Shown in gallery & leaderboard',
    },
    mystery: {
      panel0Title: 'Mystery Challenge',
      panel0Rule1: 'Paint a secret topic so clearly that others can guess it!',
      panel0Rule2: 'Topic stays hidden — only a few letters shown in the gallery.',
      panel0Rule3: 'Others try to guess from your painting. Draw well!',
      panel0PickBtn: 'Pick My Topic →',
      panel0Cancel: 'Cancel',
      panel1Title: 'Pick Your Mystery',
      panel1Subtitle: 'Choose one topic to paint — others will try to guess it!',
      panel1TapToPaint: '· tap to paint',
      panel1ShuffleBtn: '🔄 Shuffle New Topics',
      panel1Back: '← Back',
      panel1Cancel: 'Cancel',
      confirmImportant: 'IMPORTANT!',
      confirmBody: 'Your drawing must help\nother users guess this topic!',
      confirmHint: '🔒 Topic hidden until solved',
      confirmBtn: 'Got It! 🎲',
    },
    welcome: {
      title: 'WELCOME TO\nEMOJIPAINT',
      subtitle: 'Choose your experience',
      tutorial: { title: '📚 TUTORIAL', subtitle: 'Learn the basics' },
      profile: { title: '👤 PROFILE', subtitle: 'Visit your studio' },
      paint: { title: '🎨 START PAINTING', subtitle: 'Jump right in' },
    },
    multiPaint: {
      title: '🎨 Live MultiPaint',
      description: 'Paint together against the AI — never ending! A shared canvas split into 4 tiles. Defend your tile, fight the AI, earn coins!',
      openButton: 'Open MultiPaint',
    },
    footer: 'Keep experimenting and let emoji storytelling flow!',
  },
  de: {
    title: 'info:',
    subtitle: '',
    description: [
      'Tippe auf 🖌️ für Freihand oder 📏 für perfekte Linien. Mit 🎲 wechselst du sofort zu einem zufälligen Emoji.',
      'Zoome, verschiebe und drehe dein Referenzbild. Größe, Abstand und Deckkraft reagieren ohne Verzögerung.',
      'Speichere schnelle Versionen, exportiere PNGs oder spiele deine Zeitrafferaufnahme ab, um den Prozess zu zeigen.',
    ],
    tips: [
      { icon: '🖌️', title: 'Pinsel', detail: 'Freihandstriche mit drucksensitivem Abstand.' },
      { icon: '📏', title: 'Linie', detail: 'Ziehe eine gerade Stempelspur zwischen zwei Punkten.' },
      { icon: '🎲', title: 'Zufall', detail: 'Wechsle sofort zu einer neuen Emoji-Bürste.' },
      { icon: '💾', title: 'Projekte', detail: 'Speichere lokale Stände und lade sie später.' },
      { icon: '🎞️', title: 'Zeitraffer-Export', detail: 'Exportiere Frames als transparente MOV, erstelle Animationen oder Video-Ebenen.' },
      { icon: '📽️', title: 'Frame-für-Frame', detail: 'Erstelle handgezeichnete Animationen Bild für Bild mit Zwiebelhaut für flüssige Bewegung.' },
      { icon: '🏛️', title: 'Live-Galerie', detail: 'Durchsuche Community-Kunst, stimme ab, erkunde alle Uploads mit Cloud-Sync.' },
      { icon: '🗂️', title: 'Projektübersicht', detail: 'Verwalte alle gespeicherten Projekte, organisiere Kunstwerke, schnelles Laden.' },
      { icon: '🖼️', title: 'Vorlage Importieren', detail: 'Lade Referenzbilder zum Nachzeichnen (nicht im Export enthalten).' },
      { icon: '🎲', title: 'Mystery-Challenge', detail: 'Male ein geheimes Thema aus über 999 Themen — das Thema bleibt in der Galerie verborgen und andere versuchen, es an deinem Bild zu erraten. Der Shuffle zeigt nie bereits gesehene Themen.' },
    ],
    buttons: {
      liveGallery: { title: 'Live-Galerie', subtitle: 'Abstimmen & Community-Kunst erkunden' },
      profileStudio: { title: 'Profil-Studio', subtitle: 'Pass & Uploads verwalten' },
      videoEditor: { title: 'Video-Editor', subtitle: 'Transparente Videos überlagern & komponieren' },
      videoStorage: { title: 'Video-Speicher', subtitle: 'Transparente MOV-Dateien verwalten' },
    },
    challenge: { promptSubtitle: 'Wähle eine Aufgabe für einen {X}-Minuten-Sprint.' },
    leaderboard: { title: 'Bestenliste', subtitle: 'Top-Maler ansehen & global konkurrieren' },
    animationLessons: {
      title: 'Animationslektionen',
      subtitle: 'Animationstechniken lernen',
      overlayTitle: 'Animationslektionen',
      wording: { title: 'Wortbildung', status: '' },
      walking: { title: 'Laufen', status: 'Demnächst' },
      jumping: { title: 'Springen', status: 'Demnächst' },
    },
    allOverSettings: {
      title: 'Allgemeine Einstellungen',
      subtitle: 'Thema & Layout konfigurieren',
      overlayTitle: 'Allgemeine Einstellungen',
      themeLabel: 'Thema-Modus',
      themeDark: 'Dunkler Modus',
      themeLight: 'Heller Modus',
      handModeLabel: 'Hand-Modus',
      handModeRight: 'Rechte Hand',
      handModeLeft: 'Linke Hand',
      helperModeLabel: 'Hilfsbeschriftungen',
      helperModeOn: 'An',
      helperModeOff: 'Aus',
      tutorialModeLabel: 'Tutorial-Tipps',
      tutorialModeOn: 'An',
      tutorialModeOff: 'Aus',
      offlineModeLabel: 'Verbindungsmodus',
      offlineModeOnline: 'Online',
      offlineModeOffline: 'Offline',
      parentalControlsLabel: 'Kindersicherung',
    },
    profileOverlay: {
      tapToSetName: '✏️  Namen eingeben',
      shownInGalleryAndLeaderboard: 'In Galerie & Bestenliste sichtbar',
    },
    mystery: {
      panel0Title: 'Mystery-Challenge',
      panel0Rule1: 'Male ein geheimes Thema so klar, dass andere es erraten können!',
      panel0Rule2: 'Das Thema bleibt verborgen — nur wenige Buchstaben werden gezeigt.',
      panel0Rule3: 'Andere versuchen, es an deinem Bild zu erraten. Male gut!',
      panel0PickBtn: 'Thema wählen →',
      panel0Cancel: 'Abbrechen',
      panel1Title: 'Wähle dein Mystery',
      panel1Subtitle: 'Wähle ein Thema zum Malen — andere werden es erraten!',
      panel1TapToPaint: '· tippen zum Malen',
      panel1ShuffleBtn: '🔄 Neue Themen',
      panel1Back: '← Zurück',
      panel1Cancel: 'Abbrechen',
      confirmImportant: 'WICHTIG!',
      confirmBody: 'Dein Bild muss anderen helfen,\ndas Thema zu erraten!',
      confirmHint: '🔒 Thema bis zur Auflösung verborgen',
      confirmBtn: 'Verstanden! 🎲',
    },
    welcome: {
      title: 'WILLKOMMEN BEI\nEMOJIPAINT',
      subtitle: 'Wähle dein Erlebnis',
      tutorial: { title: '📚 ANLEITUNG', subtitle: 'Lerne die Grundlagen' },
      profile: { title: '👤 PROFIL', subtitle: 'Besuche dein Studio' },
      paint: { title: '🎨 MALEN STARTEN', subtitle: 'Direkt loslegen' },
    },
    multiPaint: {
      title: '🎨 Live MultiPaint',
      description: 'Malt zusammen gegen die KI — unendlich! Verteidigt eure Kachel, kämpft gegen die KI, verdient Münzen!',
      openButton: 'MultiPaint öffnen',
    },
    footer: 'Hab Spaß und lass die Emojis Geschichten erzählen!',
  },
  ru: {
    title: 'info:',
    subtitle: '',
    description: [
      'Кнопка 🖌️ включает свободную кисть, 📏 — идеально прямые линии, а 🎲 мгновенно подбирает случайный эмодзи.',
      'Масштабируйте, перемещайте и вращайте кальку. Ползунки размера, интервала и прозрачности обновляются моментально.',
      'Сохраняйте этапы, экспортируйте PNG или делитесь таймлапсом, чтобы показать процесс.',
    ],
    tips: [
      { icon: '🖌️', title: 'Кисть', detail: 'Свободные штрихи с адаптивным интервалом.' },
      { icon: '📏', title: 'Линия', detail: 'Зажмите и проведите прямой ряд отпечатков.' },
      { icon: '🎲', title: 'Случайно', detail: 'Новый эмодзи-кисть одним нажатием.' },
      { icon: '💾', title: 'Проекты', detail: 'Локальные сохранения и быстрые загрузки.' },
      { icon: '🎞️', title: 'Экспорт таймлапса', detail: 'Экспорт кадров как прозрачные MOV, создание анимаций или видео-слоёв.' },
      { icon: '📽️', title: 'Покадровая анимация', detail: 'Создавайте рисованную анимацию кадр за кадром с луковой оболочкой для плавного движения.' },
      { icon: '🏛️', title: 'Живая галерея', detail: 'Просмотр работ сообщества с голосованием, все загрузки с облачной синхронизацией.' },
      { icon: '🗂️', title: 'Обзор проектов', detail: 'Управление всеми сохранёнными проектами, организация работ, быстрая загрузка.' },
      { icon: '🖼️', title: 'Импорт трассировки', detail: 'Загрузка референсов для обводки (не включается в экспорт).' },
      { icon: '🎲', title: 'Тайный вызов', detail: 'Нарисуй секретную тему из более чем 999 — тема скрыта в галерее, а другие пытаются угадать её по твоему рисунку. Перемешивание не повторяет уже показанные темы.' },
    ],
    buttons: {
      liveGallery: { title: 'Живая галерея', subtitle: 'Голосование и исследование работ' },
      profileStudio: { title: 'Студия профиля', subtitle: 'Управление паспортом и загрузками' },
      videoEditor: { title: 'Видеоредактор', subtitle: 'Наложение и компоновка прозрачных видео' },
      videoStorage: { title: 'Хранилище видео', subtitle: 'Управление прозрачными MOV-файлами' },
    },
    challenge: { promptSubtitle: 'Выберите задание для {X}-минутного спринта.' },
    leaderboard: { title: 'Таблица лидеров', subtitle: 'Лучшие художники и глобальное соревнование' },
    animationLessons: {
      title: 'Уроки анимации',
      subtitle: 'Изучите техники анимации',
      overlayTitle: 'Уроки анимации',
      wording: { title: 'Формирование слов', status: '' },
      walking: { title: 'Ходьба', status: 'Скоро' },
      jumping: { title: 'Прыжки', status: 'Скоро' },
    },
    allOverSettings: {
      title: 'Общие настройки',
      subtitle: 'Настройка темы и раскладки',
      overlayTitle: 'Общие настройки',
      themeLabel: 'Режим темы',
      themeDark: 'Тёмный режим',
      themeLight: 'Светлый режим',
      handModeLabel: 'Режим руки',
      handModeRight: 'Правая рука',
      handModeLeft: 'Левая рука',
      helperModeLabel: 'Подсказки кнопок',
      helperModeOn: 'Вкл',
      helperModeOff: 'Выкл',
      tutorialModeLabel: 'Советы обучения',
      tutorialModeOn: 'Вкл',
      tutorialModeOff: 'Выкл',
      offlineModeLabel: 'Режим связи',
      offlineModeOnline: 'Онлайн',
      offlineModeOffline: 'Офлайн',
      parentalControlsLabel: 'Родительский контроль',
    },
    profileOverlay: {
      tapToSetName: '✏️  Нажмите, чтобы задать имя',
      shownInGalleryAndLeaderboard: 'Видно в галерее и рейтинге',
    },
    mystery: {
      panel0Title: 'Тайный вызов',
      panel0Rule1: 'Нарисуй тайную тему так ясно, чтобы другие могли угадать!',
      panel0Rule2: 'Тема скрыта — в галерее видны лишь несколько букв.',
      panel0Rule3: 'Другие пытаются угадать по твоему рисунку. Рисуй хорошо!',
      panel0PickBtn: 'Выбрать тему →',
      panel0Cancel: 'Отмена',
      panel1Title: 'Выбери тему',
      panel1Subtitle: 'Выбери одну тему для рисования — другие попробуют угадать!',
      panel1TapToPaint: '· нажмите для рисования',
      panel1ShuffleBtn: '🔄 Новые темы',
      panel1Back: '← Назад',
      panel1Cancel: 'Отмена',
      confirmImportant: 'ВАЖНО!',
      confirmBody: 'Твой рисунок должен помочь\nдругим угадать тему!',
      confirmHint: '🔒 Тема скрыта до угадывания',
      confirmBtn: 'Понял! 🎲',
    },
    welcome: {
      title: 'ДОБРО ПОЖАЛОВАТЬ В\nEMOJIPAINT',
      subtitle: 'Выберите свой опыт',
      tutorial: { title: '📚 ОБУЧЕНИЕ', subtitle: 'Изучите основы' },
      profile: { title: '👤 ПРОФИЛЬ', subtitle: 'Посетите вашу студию' },
      paint: { title: '🎨 НАЧАТЬ РИСОВАТЬ', subtitle: 'Прямо сейчас' },
    },
    multiPaint: {
      title: '🎨 Live MultiPaint',
      description: 'Рисуйте вместе против ИИ — бесконечно! Защищайте свою плитку, сражайтесь с ИИ, зарабатывайте монеты!',
      openButton: 'Открыть MultiPaint',
    },
    footer: 'Создавайте смело — эмоции в эмодзи бесконечны!',
  },
  zh: {
    title: 'info:',
    subtitle: '',
    description: [
      '點擊 🖌️ 進行手繪，或用 📏 畫出完美直線；🎲 立即換上新的表情筆刷。',
      '縮放、拖曳、旋轉描圖，大小、間距與透明度拉桿即時回應。',
      '隨時儲存進度、匯出 PNG，或播放延時動畫分享創作過程。',
    ],
    tips: [
      { icon: '🖌️', title: '筆刷', detail: '手繪筆畫並自動調整間距。' },
      { icon: '📏', title: '直線', detail: '拖曳即可放下筆直的表情列。' },
      { icon: '🎲', title: '隨機', detail: '即刻抽換一個新表情。' },
      { icon: '💾', title: '專案', detail: '本機儲存、隨時載入。' },
      { icon: '🎞️', title: '延時匯出', detail: '將影格匯出為透明 MOV 檔，組合動畫或建立影片圖層。' },
      { icon: '📽️', title: '逐格動畫', detail: '使用洋蔥皮技術逐格創建手繪動畫，實現流暢運動效果。' },
      { icon: '🏛️', title: '即時藝廊', detail: '瀏覽社群作品並投票，探索所有上傳並雲端同步。' },
      { icon: '🗂️', title: '專案總覽', detail: '管理所有已儲存的專案，整理作品，快速載入任何工作階段。' },
      { icon: '🖼️', title: '匯入描圖', detail: '載入參考圖像以描摹（不包含在最終匯出中）。' },
      { icon: '🎲', title: '神秘挑战', detail: '从999+个主题中画一个秘密主题——主题在画廊中保持隐藏，其他人通过你的画来猜。洗牌不会重复你已见过的主题。' },
    ],
    buttons: {
      liveGallery: { title: '即時藝廊', subtitle: '投票與探索社群藝術' },
      profileStudio: { title: '個人檔案工作室', subtitle: '管理護照與上傳' },
      videoEditor: { title: '影片編輯器', subtitle: '圖層與組合透明影片' },
      videoStorage: { title: '影片儲存', subtitle: '管理透明 MOV 檔案' },
    },
    challenge: { promptSubtitle: '選擇一個提示開始 {X} 分鐘衝刺。' },
    leaderboard: { title: '排行榜', subtitle: '查看頂尖畫家並全球競爭' },
    animationLessons: {
      title: '動畫課程',
      subtitle: '學習動畫技巧',
      overlayTitle: '動畫課程',
      wording: { title: '文字', status: '' },
      walking: { title: '行走', status: '即將推出' },
      jumping: { title: '跳躍', status: '即將推出' },
    },
    allOverSettings: {
      title: '全局設置',
      subtitle: '配置主題與佈局',
      overlayTitle: '全局設置',
      themeLabel: '主題模式',
      themeDark: '深色模式',
      themeLight: '淺色模式',
      handModeLabel: '手部模式',
      handModeRight: '右手',
      handModeLeft: '左手',
      helperModeLabel: '辅助标签',
      helperModeOn: '开',
      helperModeOff: '关',
      tutorialModeLabel: '教程提示',
      tutorialModeOn: '开',
      tutorialModeOff: '关',
      offlineModeLabel: '连接模式',
      offlineModeOnline: '在线',
      offlineModeOffline: '离线',
      parentalControlsLabel: '家长控制',
    },
    profileOverlay: {
      tapToSetName: '✏️  点击设置名称',
      shownInGalleryAndLeaderboard: '显示在画廊和排行榜中',
    },
    mystery: {
      panel0Title: '神秘挑战',
      panel0Rule1: '将秘密主题画得清晰，让其他人猜出来！',
      panel0Rule2: '主题保持隐藏 — 画廊中只显示几个字母。',
      panel0Rule3: '其他人通过你的画来猜测。画好点！',
      panel0PickBtn: '选择主题 →',
      panel0Cancel: '取消',
      panel1Title: '选择你的神秘主题',
      panel1Subtitle: '选一个主题来画 — 其他人将尝试猜测！',
      panel1TapToPaint: '· 点击绘画',
      panel1ShuffleBtn: '🔄 换新主题',
      panel1Back: '← 返回',
      panel1Cancel: '取消',
      confirmImportant: '重要！',
      confirmBody: '你的画必须帮助\n其他用户猜出这个主题！',
      confirmHint: '🔒 主题在解答前保持隐藏',
      confirmBtn: '明白了！ 🎲',
    },
    welcome: {
      title: '欢迎来到\nEMOJIPAINT',
      subtitle: '选择您的体验',
      tutorial: { title: '📚 教程', subtitle: '学习基础知识' },
      profile: { title: '👤 个人资料', subtitle: '访问您的工作室' },
      paint: { title: '🎨 开始绘画', subtitle: '马上开始' },
    },
    multiPaint: {
      title: '🎨 Live MultiPaint',
      description: '与AI一起无限绘画！保卫你的画格，对抗AI，赚取金币！',
      openButton: '打开 MultiPaint',
    },
    footer: '盡情玩樂，讓表情符號說故事！',
  },
  ko: {
    title: 'info:',
    subtitle: '',
    description: [
      '🖌️으로 자유롭게, 📏으로 직선을, 🎲으로는 즉시 새로운 이모지를 선택하세요.',
      '참조 이미지는 손가락으로 확대·이동·회전할 수 있고, 슬라이더는 실시간으로 반응합니다.',
      '빠른 저장, PNG 내보내기, 타임랩스 재생으로 작품 과정을 공유하세요.',
    ],
    tips: [
      { icon: '🖌️', title: '브러시', detail: '압력에 따라 간격이 변하는 자유로운 스트로크.' },
      { icon: '📏', title: '라인', detail: '두 점 사이에 곧은 이모지 줄을 그립니다.' },
      { icon: '🎲', title: '랜덤', detail: '새로운 이모지 브러시를 즉시 선택.' },
      { icon: '💾', title: '프로젝트', detail: '로컬에 저장하고 언제든 불러오기.' },
      { icon: '🎞️', title: '타임랩스 내보내기', detail: '프레임을 투명 MOV 파일로 내보내고, 애니메이션 합성 또는 비디오 레이어 생성.' },
      { icon: '🏛️', title: '라이브 갤러리', detail: '커뮤니티 작품 탐색 및 투표, 클라우드 동기화로 모든 업로드 확인.' },
      { icon: '🗂️', title: '프로젝트 개요', detail: '저장된 모든 프로젝트 관리, 작품 정리, 세션 빠른 로드.' },
      { icon: '🖼️', title: '추적 가져오기', detail: '참조 이미지를 불러와 추적 (최종 내보내기에는 포함되지 않음).' },
      { icon: '🎲', title: '미스터리 챌린지', detail: '999개 이상의 주제 중 비밀 주제를 그려보세요. 갤러리에서는 주제가 숨겨지고 다른 사용자가 그림으로 맞힙니다. 셔플은 본 주제를 반복하지 않습니다.' },
    ],
    buttons: {
      liveGallery: { title: '라이브 갤러리', subtitle: '투표 및 커뮤니티 아트 탐색' },
      profileStudio: { title: '프로필 스튜디오', subtitle: '여권 및 업로드 관리' },
      videoEditor: { title: '비디오 편집기', subtitle: '투명 비디오 레이어 및 합성' },
      videoStorage: { title: '비디오 저장소', subtitle: '투명 MOV 파일 관리' },
    },
    challenge: { promptSubtitle: '{X}분 스프린트를 시작할 프롬프트를 선택하세요.' },
    leaderboard: { title: '리더보드', subtitle: '최고의 화가를 보고 전 세계와 경쟁' },
    animationLessons: {
      title: '애니메이션 레슨',
      subtitle: '애니메이션 기법 배우기',
      overlayTitle: '애니메이션 레슨',
      wording: { title: '문자', status: '' },
      walking: { title: '걷기', status: '곧 출시' },
      jumping: { title: '점프', status: '곧 출시' },
    },
    allOverSettings: {
      title: '전체 설정',
      subtitle: '테마 및 레이아웃 구성',
      overlayTitle: '전체 설정',
      themeLabel: '테마 모드',
      themeDark: '다크 모드',
      themeLight: '라이트 모드',
      handModeLabel: '손 모드',
      handModeRight: '오른손',
      handModeLeft: '왼손',
      helperModeLabel: '도움말 레이블',
      helperModeOn: '켜기',
      helperModeOff: '끄기',
      tutorialModeLabel: '튜토리얼 팁',
      tutorialModeOn: '켜기',
      tutorialModeOff: '끄기',
      offlineModeLabel: '연결 모드',
      offlineModeOnline: '온라인',
      offlineModeOffline: '오프라인',
      parentalControlsLabel: '자녀 보호',
    },
    profileOverlay: {
      tapToSetName: '✏️  이름을 설정하려면 탭하세요',
      shownInGalleryAndLeaderboard: '갤러리 및 리더보드에 표시됨',
    },
    mystery: {
      panel0Title: '미스터리 챌린지',
      panel0Rule1: '다른 사람들이 맞출 수 있도록 비밀 주제를 명확하게 그려주세요!',
      panel0Rule2: '주제는 숨겨집니다 — 갤러리에는 몇 글자만 표시됩니다.',
      panel0Rule3: '다른 사람들이 당신의 그림으로 맞추려 합니다. 잘 그려주세요!',
      panel0PickBtn: '주제 선택 →',
      panel0Cancel: '취소',
      panel1Title: '미스터리 선택',
      panel1Subtitle: '그릴 주제를 하나 고르세요 — 다른 사람들이 맞추려 할 거예요!',
      panel1TapToPaint: '· 탭하여 그리기',
      panel1ShuffleBtn: '🔄 새 주제',
      panel1Back: '← 이전',
      panel1Cancel: '취소',
      confirmImportant: '중요!',
      confirmBody: '당신의 그림이 다른 사용자들이\n이 주제를 맞추는 데 도움이 되어야 합니다!',
      confirmHint: '🔒 주제는 풀릴 때까지 숨겨집니다',
      confirmBtn: '알겠어요! 🎲',
    },
    welcome: {
      title: 'EMOJIPAINT에\n오신 것을 환영합니다',
      subtitle: '경험을 선택하세요',
      tutorial: { title: '📚 튜토리얼', subtitle: '기초 배우기' },
      profile: { title: '👤 프로필', subtitle: '스튜디오 방문' },
      paint: { title: '🎨 그리기 시작', subtitle: '바로 시작하기' },
    },
    multiPaint: {
      title: '🎨 Live MultiPaint',
      description: 'AI와 함께 무한히 그려요! 내 타일을 지키고, AI와 싸우고, 코인을 획득하세요!',
      openButton: 'MultiPaint 열기',
    },
    footer: '상상력을 마음껏 펼치며 이모지로 표현하세요!',
  },
  ja: {
    title: 'Emojipaint スタジオ',
    subtitle: '動く絵文字ストロークで描こう。',
    description: [
      '🖌️でフリーハンド、📏で直線、🎲でランダム絵文字に瞬時に切り替え。',
      'トレース画像はピンチやドラッグで調整。サイズ・間隔・透明度のスライダーは即座に反映されます。',
      'こまめに保存し、PNG を書き出し、タイムラプスで制作過程も共有しましょう。',
    ],
    tips: [
      { icon: '🖌️', title: 'ブラシ', detail: '圧力に合わせて間隔が変化する筆致。' },
      { icon: '📏', title: 'ライン', detail: '2 点を結ぶまっすぐなスタンプ列。' },
      { icon: '🎲', title: 'シャッフル', detail: '新しい絵文字ブラシを即座にセット。' },
      { icon: '💾', title: 'プロジェクト', detail: 'ローカル保存でいつでも再開。' },
      { icon: '🎞️', title: 'タイムラプス書き出し', detail: 'フレームを透明 MOV で書き出し、アニメーション合成やビデオレイヤー作成。' },
      { icon: '🏛️', title: 'ライブギャラリー', detail: 'コミュニティ作品を閲覧・投票し、クラウド同期で全アップロードを探索。' },
      { icon: '🗂️', title: 'プロジェクト概要', detail: '保存済みプロジェクトを管理、作品整理、セッションの素早い読み込み。' },
      { icon: '🖼️', title: 'トレース読み込み', detail: '参照画像を読み込んでトレース（最終書き出しには含まれない）。' },
      { icon: '🎲', title: 'ミステリーチャレンジ', detail: '999以上のお題から秘密のテーマを描こう。ギャラリーではお題が隠され、他のユーザーが絵から当てる。シャッフルは一度見たお題を繰り返さない。' },
    ],
    buttons: {
      liveGallery: { title: 'ライブギャラリー', subtitle: '投票とコミュニティアート探索' },
      profileStudio: { title: 'プロフィールスタジオ', subtitle: 'パスポートとアップロード管理' },
      videoEditor: { title: 'ビデオエディター', subtitle: '透明ビデオのレイヤー合成' },
      videoStorage: { title: 'ビデオストレージ', subtitle: '透明 MOV ファイルの管理' },
    },
    challenge: { promptSubtitle: '{X}分間スプリントのプロンプトを選択してください。' },
    leaderboard: { title: 'リーダーボード', subtitle: 'トップペインターを見て世界中と競争' },
    animationLessons: {
      title: 'アニメーションレッスン',
      subtitle: 'アニメーション技術を学ぶ',
      overlayTitle: 'アニメーションレッスン',
      wording: { title: '言葉', status: '' },
      walking: { title: '歩く', status: '近日公開' },
      jumping: { title: 'ジャンプ', status: '近日公開' },
    },
    allOverSettings: {
      title: '全体設定',
      subtitle: 'テーマとレイアウトの設定',
      overlayTitle: '全体設定',
      themeLabel: 'テーマモード',
      themeDark: 'ダークモード',
      themeLight: 'ライトモード',
      handModeLabel: 'ハンドモード',
      handModeRight: '右手',
      handModeLeft: '左手',
      helperModeLabel: 'ヘルパーラベル',
      helperModeOn: 'オン',
      helperModeOff: 'オフ',
      tutorialModeLabel: 'チュートリアルヒント',
      tutorialModeOn: 'オン',
      tutorialModeOff: 'オフ',
      offlineModeLabel: '接続モード',
      offlineModeOnline: 'オンライン',
      offlineModeOffline: 'オフライン',
      parentalControlsLabel: 'ペアレンタルコントロール',
    },
    profileOverlay: {
      tapToSetName: '✏️  名前を設定するにはタップ',
      shownInGalleryAndLeaderboard: 'ギャラリー＆リーダーボードに表示',
    },
    mystery: {
      panel0Title: 'ミステリーチャレンジ',
      panel0Rule1: '他の人が当てられるように、秘密のお題を明確に描いてください！',
      panel0Rule2: 'お題は隠されています — ギャラリーには数文字のみ表示されます。',
      panel0Rule3: '他の人があなたの絵からお題を当てようとします。うまく描いてください！',
      panel0PickBtn: 'お題を選ぶ →',
      panel0Cancel: 'キャンセル',
      panel1Title: 'ミステリーを選ぶ',
      panel1Subtitle: '描くお題を1つ選んでください — 他の人が当てようとします！',
      panel1TapToPaint: '· タップして描く',
      panel1ShuffleBtn: '🔄 新しいお題',
      panel1Back: '← 戻る',
      panel1Cancel: 'キャンセル',
      confirmImportant: '重要！',
      confirmBody: 'あなたの絵が他のユーザーが\nこのお題を当てる助けになる必要があります！',
      confirmHint: '🔒 お題は解答まで隠されます',
      confirmBtn: 'わかりました！ 🎲',
    },
    welcome: {
      title: 'EMOJIPAINTへ\nようこそ',
      subtitle: '体験を選択してください',
      tutorial: { title: '📚 チュートリアル', subtitle: '基本を学ぶ' },
      profile: { title: '👤 プロフィール', subtitle: 'スタジオを訪問' },
      paint: { title: '🎨 ペイントを開始', subtitle: 'すぐに始める' },
    },
    multiPaint: {
      title: '🎨 Live MultiPaint',
      description: 'AIに対抗して無限に描こう！タイルを守り、AIと戦い、コインを稼ごう！',
      openButton: 'MultiPaintを開く',
    },
    footer: '絵文字でもっと自由にストーリーを描きましょう！',
  },
  fr: {
    title: 'Studio Emojipaint',
    subtitle: "Peignez avec des traits d'emoji vivants.",
    description: [
      "Choisissez 🖌️ pour le tracé libre, 📏 pour les lignes droites, et 🎲 pour une nouvelle brosse emoji.",
      "Redimensionnez et faites pivoter votre image de référence. Les réglages de taille, d'espacement et d'opacité réagissent instantanément.",
      'Sauvegardez vos projets, exportez en PNG ou rejouez votre timelapse pour partager votre processus.',
    ],
    tips: [
      { icon: '🖌️', title: 'Pinceau', detail: 'Trait libre avec espacement sensible à la pression.' },
      { icon: '📏', title: 'Ligne', detail: "Trace une rangée droite d'emojis." },
      { icon: '🎲', title: 'Aléatoire', detail: "Change instantanément d'emoji." },
      { icon: '💾', title: 'Projets', detail: 'Sauvegardez localement et reprenez plus tard.' },
      { icon: '🎞️', title: 'Export Timelapse', detail: 'Exportez des images en MOV transparent, composez des animations ou créez des couches vidéo.' },
      { icon: '🏛️', title: 'Galerie en direct', detail: "Parcourez l'art communautaire avec vote, explorez tous les téléchargements avec sync cloud." },
      { icon: '🗂️', title: "Vue d'ensemble des projets", detail: "Gérez tous les projets sauvegardés, organisez l'art, chargement rapide de session." },
      { icon: '🖼️', title: 'Importer Trace', detail: "Chargez des images de référence pour tracer (non inclus dans l'export final)." },
      { icon: '🎲', title: 'Défi Mystère', detail: "Peins un sujet secret parmi plus de 999 — le sujet reste caché dans la galerie et les autres essaient de le deviner. Le mélange ne répète jamais les sujets déjà vus." },
    ],
    buttons: {
      liveGallery: { title: 'Galerie en direct', subtitle: "Votez et explorez l'art communautaire" },
      profileStudio: { title: 'Studio de profil', subtitle: 'Gérer passeport et téléchargements' },
      videoEditor: { title: 'Éditeur vidéo', subtitle: 'Superposer et composer des vidéos transparentes' },
      videoStorage: { title: 'Stockage vidéo', subtitle: 'Gérer les fichiers MOV transparents' },
    },
    challenge: { promptSubtitle: 'Choisissez un prompt pour commencer un sprint de {X} minutes.' },
    leaderboard: { title: 'Classement', subtitle: 'Voir les meilleurs peintres et rivaliser mondialement' },
    animationLessons: {
      title: "Leçons d'animation",
      subtitle: "Apprendre les techniques d'animation",
      overlayTitle: "Leçons d'animation",
      wording: { title: 'Lettrage', status: '' },
      walking: { title: 'Marche', status: 'Bientôt disponible' },
      jumping: { title: 'Sauter', status: 'Bientôt disponible' },
    },
    allOverSettings: {
      title: 'Paramètres généraux',
      subtitle: 'Configurer le thème et la disposition',
      overlayTitle: 'Paramètres généraux',
      themeLabel: 'Mode de thème',
      themeDark: 'Mode sombre',
      themeLight: 'Mode clair',
      handModeLabel: 'Mode de main',
      handModeRight: 'Main droite',
      handModeLeft: 'Main gauche',
      helperModeLabel: "Étiquettes d'aide",
      helperModeOn: 'Activé',
      helperModeOff: 'Désactivé',
      tutorialModeLabel: 'Conseils tutoriel',
      tutorialModeOn: 'Activé',
      tutorialModeOff: 'Désactivé',
      offlineModeLabel: 'Mode connexion',
      offlineModeOnline: 'En ligne',
      offlineModeOffline: 'Hors ligne',
      parentalControlsLabel: 'Contrôle parental',
    },
    profileOverlay: {
      tapToSetName: '✏️  Appuyez pour définir votre nom',
      shownInGalleryAndLeaderboard: 'Visible dans la galerie & le classement',
    },
    mystery: {
      panel0Title: 'Défi Mystère',
      panel0Rule1: 'Dessine un sujet secret assez clairement pour que les autres devinent !',
      panel0Rule2: 'Le sujet reste caché — seules quelques lettres sont montrées dans la galerie.',
      panel0Rule3: "Les autres essaient de deviner d'après ton dessin. Dessine bien !",
      panel0PickBtn: 'Choisir mon sujet →',
      panel0Cancel: 'Annuler',
      panel1Title: 'Choisir ton mystère',
      panel1Subtitle: 'Choisis un sujet à dessiner — les autres essaieront de deviner !',
      panel1TapToPaint: '· appuyer pour dessiner',
      panel1ShuffleBtn: '🔄 Nouveaux sujets',
      panel1Back: '← Retour',
      panel1Cancel: 'Annuler',
      confirmImportant: 'IMPORTANT !',
      confirmBody: 'Ton dessin doit aider\nles autres utilisateurs à deviner ce sujet !',
      confirmHint: "🔒 Sujet caché jusqu'à la résolution",
      confirmBtn: 'Compris ! 🎲',
    },
    welcome: {
      title: 'BIENVENUE DANS\nEMOJIPAINT',
      subtitle: 'Choisissez votre expérience',
      tutorial: { title: '📚 TUTORIEL', subtitle: 'Apprendre les bases' },
      profile: { title: '👤 PROFIL', subtitle: 'Visitez votre studio' },
      paint: { title: '🎨 COMMENCER À PEINDRE', subtitle: 'Commencez maintenant' },
    },
    multiPaint: {
      title: '🎨 Live MultiPaint',
      description: 'Peignez ensemble contre l\'IA — à l\'infini ! Défendez votre tuile, combattez l\'IA, gagnez des pièces !',
      openButton: 'Ouvrir MultiPaint',
    },
    footer: 'Créez, amusez-vous et laissez les emojis parler !',
  },
  it: {
    title: 'Studio Emojipaint',
    subtitle: 'Dipingi con tratti di emoji dinamici.',
    description: [
      "Usa 🖌️ per il disegno libero, 📏 per linee perfette e 🎲 per cambiare subito emoji.",
      "Ridimensiona e ruota l'immagine guida; i cursori di dimensione, spaziatura e opacità rispondono in tempo reale.",
      'Salva versioni, esporta PNG o riproduci il timelapse per mostrare il tuo processo creativo.',
    ],
    tips: [
      { icon: '🖌️', title: 'Pennello', detail: 'Tratto libero con spaziatura adattiva.' },
      { icon: '📏', title: 'Linea', detail: 'Disegna una fila diritta di emoji.' },
      { icon: '🎲', title: 'Casuale', detail: 'Cambia subito emoji pennello.' },
      { icon: '💾', title: 'Progetti', detail: 'Salvataggi locali sempre a portata di mano.' },
      { icon: '🎞️', title: 'Esportazione Timelapse', detail: 'Esporta fotogrammi come MOV trasparenti, componi animazioni o crea livelli video.' },
      { icon: '🏛️', title: 'Galleria dal vivo', detail: "Sfoglia arte della comunità con voto, esplora tutti i caricamenti con sync cloud." },
      { icon: '🗂️', title: 'Panoramica progetti', detail: "Gestisci tutti i progetti salvati, organizza l'arte, caricamento rapido sessioni." },
      { icon: '🖼️', title: 'Importa Traccia', detail: "Carica immagini di riferimento per tracciare (non incluso nell'esportazione finale)." },
      { icon: '🎲', title: 'Sfida Mistero', detail: 'Dipingi un tema segreto tra oltre 999 — il tema resta nascosto nella galleria e gli altri provano a indovinarlo. Lo shuffle non ripete mai i temi già visti.' },
    ],
    buttons: {
      liveGallery: { title: 'Galleria dal vivo', subtitle: "Vota ed esplora l'arte della comunità" },
      profileStudio: { title: 'Studio profilo', subtitle: 'Gestisci passaporto e caricamenti' },
      videoEditor: { title: 'Editor video', subtitle: 'Sovrapponi e componi video trasparenti' },
      videoStorage: { title: 'Archivio video', subtitle: 'Gestisci file MOV trasparenti' },
    },
    challenge: { promptSubtitle: 'Scegli un prompt per iniziare uno sprint di {X} minuti.' },
    leaderboard: { title: 'Classifica', subtitle: 'Vedi i migliori pittori e competi globalmente' },
    animationLessons: {
      title: 'Lezioni di animazione',
      subtitle: 'Impara tecniche di animazione',
      overlayTitle: 'Lezioni di animazione',
      wording: { title: 'Lettering', status: '' },
      walking: { title: 'Camminare', status: 'Prossimamente' },
      jumping: { title: 'Saltare', status: 'Prossimamente' },
    },
    allOverSettings: {
      title: 'Impostazioni generali',
      subtitle: 'Configura tema e layout',
      overlayTitle: 'Impostazioni generali',
      themeLabel: 'Modalità tema',
      themeDark: 'Modalità scura',
      themeLight: 'Modalità chiara',
      handModeLabel: 'Modalità mano',
      handModeRight: 'Mano destra',
      handModeLeft: 'Mano sinistra',
      helperModeLabel: 'Etichette di aiuto',
      helperModeOn: 'Attivo',
      helperModeOff: 'Disattivo',
      tutorialModeLabel: 'Suggerimenti tutorial',
      tutorialModeOn: 'Attivo',
      tutorialModeOff: 'Disattivo',
      offlineModeLabel: 'Modalità connessione',
      offlineModeOnline: 'Online',
      offlineModeOffline: 'Offline',
      parentalControlsLabel: 'Controllo genitori',
    },
    profileOverlay: {
      tapToSetName: '✏️  Tocca per impostare il nome',
      shownInGalleryAndLeaderboard: 'Visibile in galleria e classifica',
    },
    mystery: {
      panel0Title: 'Sfida Mistero',
      panel0Rule1: 'Dipingi un argomento segreto così chiaramente che gli altri possano indovinarlo!',
      panel0Rule2: "L'argomento rimane nascosto — nella galleria vengono mostrate solo alcune lettere.",
      panel0Rule3: 'Gli altri cercano di indovinare dal tuo dipinto. Disegna bene!',
      panel0PickBtn: 'Scegli il mio argomento →',
      panel0Cancel: 'Annulla',
      panel1Title: 'Scegli il tuo mistero',
      panel1Subtitle: 'Scegli un argomento da dipingere — gli altri cercheranno di indovinarlo!',
      panel1TapToPaint: '· tocca per dipingere',
      panel1ShuffleBtn: '🔄 Nuovi argomenti',
      panel1Back: '← Indietro',
      panel1Cancel: 'Annulla',
      confirmImportant: 'IMPORTANTE!',
      confirmBody: 'Il tuo disegno deve aiutare\ngli altri utenti a indovinare questo argomento!',
      confirmHint: "🔒 Argomento nascosto fino alla soluzione",
      confirmBtn: 'Capito! 🎲',
    },
    welcome: {
      title: 'BENVENUTO IN\nEMOJIPAINT',
      subtitle: 'Scegli la tua esperienza',
      tutorial: { title: '📚 TUTORIAL', subtitle: 'Impara le basi' },
      profile: { title: '👤 PROFILO', subtitle: 'Visita il tuo studio' },
      paint: { title: '🎨 INIZIA A DIPINGERE', subtitle: 'Inizia subito' },
    },
    multiPaint: {
      title: '🎨 Live MultiPaint',
      description: 'Dipingi insieme contro l\'IA — senza fine! Difendi il tuo riquadro, combatti l\'IA, guadagna monete!',
      openButton: 'Apri MultiPaint',
    },
    footer: 'Continua a sperimentare e racconta storie con gli emoji!',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// getDeviceLanguage
// ─────────────────────────────────────────────────────────────────────────────

export const getDeviceLanguage = (): InfoLanguage => {
  try {
    if (!Localization || typeof Localization.getLocales !== 'function') {
      return 'en';
    }
    const locales = Localization.getLocales();
    if (!locales || !Array.isArray(locales) || locales.length === 0) {
      return 'en';
    }
    const primaryLocale = locales[0];
    if (!primaryLocale) {
      return 'en';
    }
    const languageCode = primaryLocale.languageCode?.toLowerCase();
    const supportedLanguages: InfoLanguage[] = ['en', 'de', 'ru', 'zh', 'ko', 'ja', 'fr', 'it'];
    if (languageCode && supportedLanguages.includes(languageCode as InfoLanguage)) {
      return languageCode as InfoLanguage;
    }
    if (languageCode === 'zh' || primaryLocale.languageTag?.startsWith('zh')) {
      return 'zh';
    }
  } catch {
    // ignore
  }
  return 'en';
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook params & result types
// ─────────────────────────────────────────────────────────────────────────────

export interface UseInfoPanelParams {
  /** Current gallery entries (used to seed community inspiration entry). */
  galleryEntries: DailyPaintGalleryEntry[];
  /** Device / user identifier used when fetching gallery for inspiration. */
  deviceId: string | null;
  /** Today's daily prompts (used to drive the prompt-pulse animation). */
  dailyPrompts: DailyPrompt[];
  /** Gallery language string kept in sync with infoLanguage. */
  galleryLanguage: string;
  /** Setter to keep galleryLanguage in sync when the user changes info language. */
  setGalleryLanguage: (lang: string) => void;
  /** Notifications enabled setter — called when AllOverSettings panel opens. */
  setNotificationsEnabled: (enabled: boolean) => void;
  /** Notification service reference — used to read current enabled state. */
  notificationService: { areEnabled: () => Promise<boolean> };
  /**
   * Called inside closeInfoPanel() after infoVisible is set to false.
   * Use to clear challenge-confirm state that lives in PaintScreen.
   */
  onCloseExtras?: () => void;
  /**
   * Animated value for the info-button pulse (lives in PaintScreen because
   * it drives the ℹ️ button visual pulse rendered in PaintScreen's toolbar).
   */
  infoPulseValue: RNAnimated.Value;
  /** Ref for the info-button pulse timeout (lives next to infoPulseValue). */
  infoPulseTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export interface UseInfoPanelResult {
  // ── Core visibility ────────────────────────────────────────────────────────
  infoVisible: boolean;
  setInfoVisible: (visible: boolean) => void;
  allOverSettingsVisible: boolean;
  setAllOverSettingsVisible: (visible: boolean) => void;
  animationLessonsVisible: boolean;
  setAnimationLessonsVisible: (visible: boolean) => void;

  // ── Language ───────────────────────────────────────────────────────────────
  infoLanguage: InfoLanguage;
  setInfoLanguage: (lang: InfoLanguage) => void;
  selectInfoLanguage: (lang: InfoLanguage) => void;

  // ── Logo / gallery ─────────────────────────────────────────────────────────
  infoLogoKey: number;
  setInfoLogoKey: (key: number | ((prev: number) => number)) => void;
  infoRandomEntry: DailyPaintGalleryEntry | null;
  inspirationEntries: DailyPaintGalleryEntry[];
  hasMovVideos: boolean;
  setHasMovVideos: (value: boolean) => void;

  // ── Frame counters ─────────────────────────────────────────────────────────
  infoLeaderboardFrame: number;
  infoAnimationLessonsFrame: number;

  // ── Video / banner ─────────────────────────────────────────────────────────
  videoInfoBannerVisible: boolean;
  setVideoInfoBannerVisible: (visible: boolean) => void;
  videoInfoBannerTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  animationTutorialVideoRef: React.MutableRefObject<Video | null>;

  // ── Scroll / layout refs ───────────────────────────────────────────────────
  infoLanguageScrollRef: React.MutableRefObject<ScrollView | null>;
  infoLanguageLayouts: React.MutableRefObject<Partial<Record<InfoLanguage, { x: number; width: number }>>>;
  infoLanguageContainerWidth: React.MutableRefObject<number>;

  // ── Prompt-bounce animations ───────────────────────────────────────────────
  promptBounceRefs: Map<string, RNAnimated.Value>;
  promptPulseTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  getPromptBounce: (key: string) => RNAnimated.Value;
  triggerPromptBounce: (key: string) => void;

  // ── Handlers ──────────────────────────────────────────────────────────────
  openInfoPanel: () => void;
  closeInfoPanel: () => void;
  openAllOverSettings: () => void;
  closeAllOverSettings: () => void;
  openAnimationLessons: () => void;
  closeAnimationLessons: () => void;
  scrollInfoLanguageIntoView: () => void;
  stopInfoPulse: () => void;
  scheduleInfoPulse: () => void;

  // ── Derived ────────────────────────────────────────────────────────────────
  infoCopy: InfoCopy;
  infoDateLabel: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// useInfoPanel
// ─────────────────────────────────────────────────────────────────────────────

export function useInfoPanel(params: UseInfoPanelParams): UseInfoPanelResult {
  const {
    galleryEntries,
    deviceId,
    dailyPrompts,
    galleryLanguage,
    setGalleryLanguage,
    setNotificationsEnabled,
    notificationService,
    onCloseExtras,
    infoPulseValue,
    infoPulseTimeoutRef,
  } = params;

  // ── State ──────────────────────────────────────────────────────────────────
  const [infoVisible, setInfoVisible] = useState(false);
  const [allOverSettingsVisible, setAllOverSettingsVisible] = useState(false);
  const [animationLessonsVisible, setAnimationLessonsVisible] = useState(false);
  const [infoLanguage, setInfoLanguage] = useState<InfoLanguage>('en');
  const [hasMovVideos, setHasMovVideos] = useState(false);
  const [infoLogoKey, setInfoLogoKey] = useState(0);
  const [infoRandomEntry, setInfoRandomEntry] = useState<DailyPaintGalleryEntry | null>(null);
  const [inspirationEntries, setInspirationEntries] = useState<DailyPaintGalleryEntry[]>([]);
  const [infoLeaderboardFrame, setInfoLeaderboardFrame] = useState(0);
  const [infoAnimationLessonsFrame, setInfoAnimationLessonsFrame] = useState(0);
  const [videoInfoBannerVisible, setVideoInfoBannerVisible] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const videoInfoBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTutorialVideoRef = useRef<Video | null>(null);
  const infoLanguageScrollRef = useRef<ScrollView | null>(null);
  const infoLanguageLayouts = useRef<Partial<Record<InfoLanguage, { x: number; width: number }>>>({});
  const infoLanguageContainerWidth = useRef(0);
  const promptPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const promptBounceRefs = useMemo(() => new Map<string, RNAnimated.Value>(), []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const infoCopy = useMemo(() => INFO_COPY[infoLanguage], [infoLanguage]);

  const infoDateLabel = useMemo(() => {
    const locale = INFO_LANGUAGE_LOCALES[infoLanguage];
    const now = new Date();
    try {
      return now.toLocaleDateString(locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return now.toLocaleDateString();
    }
  }, [infoLanguage]);

  // ── Language detection on mount ────────────────────────────────────────────
  useEffect(() => {
    loadLanguagePreference().then((stored) => {
      if (stored) {
        setInfoLanguage(stored as InfoLanguage);
      } else {
        const deviceLang = getDeviceLanguage();
        if (deviceLang !== 'en') setInfoLanguage(deviceLang);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scroll active language into view ──────────────────────────────────────
  const scrollInfoLanguageIntoView = useCallback(() => {
    if (!infoVisible) return;
    const layout = infoLanguageLayouts.current[infoLanguage];
    if (!layout) return;
    const containerWidth = infoLanguageContainerWidth.current;
    requestAnimationFrame(() => {
      if (!infoLanguageScrollRef.current) return;
      const centerOffset = containerWidth > 0 ? containerWidth / 2 : 0;
      const targetX = Math.max(0, layout.x + layout.width / 2 - centerOffset);
      infoLanguageScrollRef.current.scrollTo({ x: targetX, animated: true });
    });
  }, [infoLanguage, infoVisible]);

  useEffect(() => {
    scrollInfoLanguageIntoView();
  }, [infoLanguage, infoVisible, scrollInfoLanguageIntoView]);

  // ── Pulse animations ───────────────────────────────────────────────────────
  const stopInfoPulse = useCallback(() => {
    if (infoPulseTimeoutRef.current) {
      clearTimeout(infoPulseTimeoutRef.current);
      infoPulseTimeoutRef.current = null;
    }
    infoPulseValue.stopAnimation(() => {
      infoPulseValue.setValue(0);
    });
  }, [infoPulseTimeoutRef, infoPulseValue]);

  const runInfoPulse = useCallback(() => {
    infoPulseValue.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(infoPulseValue, {
        toValue: 1,
        duration: 320,
        easing: RNEasing.out(RNEasing.ease),
        useNativeDriver: true,
      }),
      RNAnimated.timing(infoPulseValue, {
        toValue: 0,
        duration: 420,
        easing: RNEasing.out(RNEasing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        infoPulseTimeoutRef.current = setTimeout(() => {
          infoPulseTimeoutRef.current = null;
          runInfoPulse();
        }, 5200 + Math.random() * 4800);
      }
    });
  }, [infoPulseTimeoutRef, infoPulseValue]);

  const scheduleInfoPulse = useCallback(() => {
    if (infoPulseTimeoutRef.current) return;
    infoPulseTimeoutRef.current = setTimeout(() => {
      infoPulseTimeoutRef.current = null;
      runInfoPulse();
    }, 3600 + Math.random() * 3600);
  }, [infoPulseTimeoutRef, runInfoPulse]);

  // ── Prompt bounce ──────────────────────────────────────────────────────────
  const getPromptBounce = useCallback(
    (key: string) => {
      if (!promptBounceRefs.has(key)) {
        promptBounceRefs.set(key, new RNAnimated.Value(0));
      }
      return promptBounceRefs.get(key)!;
    },
    [promptBounceRefs],
  );

  const triggerPromptBounce = useCallback(
    (key: string) => {
      const anim = getPromptBounce(key);
      anim.stopAnimation(() => {
        anim.setValue(0);
        RNAnimated.sequence([
          RNAnimated.spring(anim, { toValue: 1, friction: 4.5, tension: 180, useNativeDriver: true }),
          RNAnimated.spring(anim, { toValue: 0, friction: 5.5, tension: 140, useNativeDriver: true }),
        ]).start();
      });
    },
    [getPromptBounce],
  );

  const schedulePromptPulse = useCallback(() => {
    if (promptPulseTimeoutRef.current || !infoVisible) return;
    const prompts = dailyPrompts.map((prompt) => formatPrompt(prompt, infoLanguage));
    if (prompts.length === 0) return;
    promptPulseTimeoutRef.current = setTimeout(() => {
      promptPulseTimeoutRef.current = null;
      const randomKey = prompts[Math.floor(Math.random() * prompts.length)];
      triggerPromptBounce(randomKey);
      schedulePromptPulse();
    }, 3600 + Math.random() * 3200);
  }, [dailyPrompts, infoLanguage, infoVisible, triggerPromptBounce]);

  // Pulse / prompt-pulse lifecycle
  useEffect(() => {
    if (infoVisible) {
      stopInfoPulse();
      schedulePromptPulse();
    } else {
      if (promptPulseTimeoutRef.current) {
        clearTimeout(promptPulseTimeoutRef.current);
        promptPulseTimeoutRef.current = null;
      }
      scheduleInfoPulse();
    }
    return () => {
      if (promptPulseTimeoutRef.current) {
        clearTimeout(promptPulseTimeoutRef.current);
        promptPulseTimeoutRef.current = null;
      }
      stopInfoPulse();
    };
  }, [infoVisible, scheduleInfoPulse, schedulePromptPulse, stopInfoPulse]);

  // ── Leaderboard frame cycling ──────────────────────────────────────────────
  useEffect(() => {
    if (!infoVisible) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    setInfoLeaderboardFrame(Math.floor(Math.random() * LEADERBOARD_EMOJI_FRAMES.length));
    const schedule = () => {
      const delay = 120 + Math.random() * 280;
      timeout = setTimeout(() => {
        setInfoLeaderboardFrame((frame) => (frame + 1) % LEADERBOARD_EMOJI_FRAMES.length);
        if (!cancelled) schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [infoVisible]);

  // ── Animation lessons frame cycling ───────────────────────────────────────
  useEffect(() => {
    if (!infoVisible) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    setInfoAnimationLessonsFrame(Math.floor(Math.random() * ANIMATION_LESSONS_EMOJI_FRAMES.length));
    const schedule = () => {
      const delay = 120 + Math.random() * 280;
      timeout = setTimeout(() => {
        setInfoAnimationLessonsFrame((frame) => (frame + 1) % ANIMATION_LESSONS_EMOJI_FRAMES.length);
        if (!cancelled) schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [infoVisible]);

  // ── Check for MOV videos when panel opens ─────────────────────────────────
  useEffect(() => {
    if (!infoVisible) return;
    const checkForVideos = async () => {
      try {
        const videos = await getAllVideos();
        const actualVideos = (videos as any[]).filter((v) => !v.isFolder);
        setHasMovVideos(actualVideos.length > 0);
      } catch {
        setHasMovVideos(false);
      }
    };
    checkForVideos();
  }, [infoVisible]);

  // ── Load random community entry every time panel opens ────────────────────
  useEffect(() => {
    if (!infoVisible) return;
    const loadRandomEntry = async () => {
      try {
        let entries = galleryEntries.length > 0 ? galleryEntries : inspirationEntries;
        if (entries.length === 0) {
          const result = await fetchDailyPaintGallery({
            sort: 'new',
            deviceId: deviceId ?? undefined,
          });
          entries = (result as DailyPaintGalleryEntry[]) || [];
          setInspirationEntries(entries);
        } else if (galleryEntries.length > 0 && inspirationEntries.length === 0) {
          setInspirationEntries(galleryEntries);
        }
        if (entries.length > 0) {
          const randomIndex = Math.floor(Math.random() * entries.length);
          setInfoRandomEntry(entries[randomIndex]);
        } else {
          setInfoRandomEntry(null);
        }
      } catch {
        setInfoRandomEntry(null);
      }
    };
    loadRandomEntry();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoVisible, galleryEntries, deviceId, galleryLanguage]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const selectInfoLanguage = useCallback(
    (language: InfoLanguage) => {
      void Haptics.selectionAsync();
      setInfoLanguage(language);
      void saveLanguagePreference(language);
      setGalleryLanguage(language);
    },
    [setGalleryLanguage],
  );

  const openInfoPanel = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    stopInfoPulse();
    setInfoLogoKey((prev) => prev + 1);
    startTransition(() => {
      setInfoVisible(true);
    });
  }, [stopInfoPulse]);

  const closeInfoPanel = useCallback(() => {
    setInfoVisible(false);
    onCloseExtras?.();
  }, [onCloseExtras]);

  const openAllOverSettings = useCallback(() => {
    void Haptics.selectionAsync();
    void notificationService.areEnabled().then((enabled) => setNotificationsEnabled(enabled));
    setInfoVisible(false);
    setAllOverSettingsVisible(true);
  }, [notificationService, setNotificationsEnabled]);

  const closeAllOverSettings = useCallback(() => {
    void Haptics.selectionAsync();
    setAllOverSettingsVisible(false);
    setInfoVisible(true);
  }, []);

  const openAnimationLessons = useCallback(() => {
    void Haptics.selectionAsync();
    if (!infoVisible) setInfoVisible(true);
    setAnimationLessonsVisible(true);
    setVideoInfoBannerVisible(true);
    if (videoInfoBannerTimerRef.current) clearTimeout(videoInfoBannerTimerRef.current);
    videoInfoBannerTimerRef.current = setTimeout(() => setVideoInfoBannerVisible(false), 4000);
  }, [infoVisible]);

  const closeAnimationLessons = useCallback(() => {
    void Haptics.selectionAsync();
    void animationTutorialVideoRef.current?.pauseAsync().catch(() => {});
    if (videoInfoBannerTimerRef.current) clearTimeout(videoInfoBannerTimerRef.current);
    setVideoInfoBannerVisible(false);
    setAnimationLessonsVisible(false);
    setInfoVisible(true);
  }, []);

  // ── Return ─────────────────────────────────────────────────────────────────
  return {
    infoVisible,
    setInfoVisible,
    allOverSettingsVisible,
    setAllOverSettingsVisible,
    animationLessonsVisible,
    setAnimationLessonsVisible,
    infoLanguage,
    setInfoLanguage,
    selectInfoLanguage,
    infoLogoKey,
    setInfoLogoKey,
    infoRandomEntry,
    inspirationEntries,
    hasMovVideos,
    setHasMovVideos,
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
    promptPulseTimeoutRef,
    getPromptBounce,
    triggerPromptBounce,
    openInfoPanel,
    closeInfoPanel,
    openAllOverSettings,
    closeAllOverSettings,
    openAnimationLessons,
    closeAnimationLessons,
    scrollInfoLanguageIntoView,
    stopInfoPulse,
    scheduleInfoPulse,
    infoCopy,
    infoDateLabel,
  };
}
