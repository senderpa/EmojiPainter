export type IntroTransition = 'fade' | 'dissolve' | 'crossfade';

/** The languages the intro ships clips for. Anything else falls back to English. */
export type IntroLanguage = 'en' | 'de' | 'fr' | 'it' | 'ru' | 'zh' | 'ja' | 'ko';

export interface IntroMediaSegment {
  /**
   * Section folder under assets/intro/. Resolved per-language at runtime via
   * resolveIntroVideoSource(). `null` keeps the centered logo.
   */
  mediaAssetName: string | null;
  /** Key into INTRO_TEXT — the localized string actually shown. `text` is the English source. */
  textKey: string;
  text: string;
  durationMs: number;
  transition: IntroTransition;
  voiceAssetName?: string;
  accessibilityDescription: string;
}

/**
 * Every intro clip, keyed '<section>/<lang>'.
 *
 * Metro resolves require() at BUILD time from a literal path, so each variant has to be
 * listed explicitly — a path built at runtime silently yields nothing. Generated from
 * assets/intro/; regenerate this block if clips are added or removed.
 */
const INTRO_VIDEO_SOURCES: Record<string, number> = {
  '01-welcome/en': require('../../../assets/intro/01-welcome/en.mp4'),
  '01-welcome/de': require('../../../assets/intro/01-welcome/de.mp4'),
  '01-welcome/fr': require('../../../assets/intro/01-welcome/fr.mp4'),
  '01-welcome/it': require('../../../assets/intro/01-welcome/it.mp4'),
  '01-welcome/ru': require('../../../assets/intro/01-welcome/ru.mp4'),
  '01-welcome/zh': require('../../../assets/intro/01-welcome/zh.mp4'),
  '01-welcome/ja': require('../../../assets/intro/01-welcome/ja.mp4'),
  '01-welcome/ko': require('../../../assets/intro/01-welcome/ko.mp4'),
  '01-welcome/es': require('../../../assets/intro/01-welcome/es.mp4'),
  '02-version/en': require('../../../assets/intro/02-version/en.mp4'),
  '02-version/de': require('../../../assets/intro/02-version/de.mp4'),
  '02-version/fr': require('../../../assets/intro/02-version/fr.mp4'),
  '02-version/it': require('../../../assets/intro/02-version/it.mp4'),
  '02-version/ru': require('../../../assets/intro/02-version/ru.mp4'),
  '02-version/zh': require('../../../assets/intro/02-version/zh.mp4'),
  '02-version/ja': require('../../../assets/intro/02-version/ja.mp4'),
  '02-version/ko': require('../../../assets/intro/02-version/ko.mp4'),
  '02-version/es': require('../../../assets/intro/02-version/es.mp4'),
  '03-thanks/en': require('../../../assets/intro/03-thanks/en.mp4'),
  '03-thanks/de': require('../../../assets/intro/03-thanks/de.mp4'),
  '03-thanks/fr': require('../../../assets/intro/03-thanks/fr.mp4'),
  '03-thanks/it': require('../../../assets/intro/03-thanks/it.mp4'),
  '03-thanks/ru': require('../../../assets/intro/03-thanks/ru.mp4'),
  '03-thanks/zh': require('../../../assets/intro/03-thanks/zh.mp4'),
  '03-thanks/ja': require('../../../assets/intro/03-thanks/ja.mp4'),
  '03-thanks/ko': require('../../../assets/intro/03-thanks/ko.mp4'),
  '03-thanks/es': require('../../../assets/intro/03-thanks/es.mp4'),
  '04-terms-intro/en': require('../../../assets/intro/04-terms-intro/en.mp4'),
  '04-terms-intro/de': require('../../../assets/intro/04-terms-intro/de.mp4'),
  '04-terms-intro/fr': require('../../../assets/intro/04-terms-intro/fr.mp4'),
  '04-terms-intro/it': require('../../../assets/intro/04-terms-intro/it.mp4'),
  '04-terms-intro/ru': require('../../../assets/intro/04-terms-intro/ru.mp4'),
  '04-terms-intro/zh': require('../../../assets/intro/04-terms-intro/zh.mp4'),
  '04-terms-intro/ja': require('../../../assets/intro/04-terms-intro/ja.mp4'),
  '04-terms-intro/ko': require('../../../assets/intro/04-terms-intro/ko.mp4'),
  '04-terms-intro/es': require('../../../assets/intro/04-terms-intro/es.mp4'),
  '05-local-first/en': require('../../../assets/intro/05-local-first/en.mp4'),
  '05-local-first/de': require('../../../assets/intro/05-local-first/de.mp4'),
  '05-local-first/fr': require('../../../assets/intro/05-local-first/fr.mp4'),
  '05-local-first/it': require('../../../assets/intro/05-local-first/it.mp4'),
  '05-local-first/ru': require('../../../assets/intro/05-local-first/ru.mp4'),
  '05-local-first/zh': require('../../../assets/intro/05-local-first/zh.mp4'),
  '05-local-first/ja': require('../../../assets/intro/05-local-first/ja.mp4'),
  '05-local-first/ko': require('../../../assets/intro/05-local-first/ko.mp4'),
  '05-local-first/es': require('../../../assets/intro/05-local-first/es.mp4'),
  '06-gallery-agb/en': require('../../../assets/intro/06-gallery-agb/en.mp4'),
  '06-gallery-agb/de': require('../../../assets/intro/06-gallery-agb/de.mp4'),
  '06-gallery-agb/fr': require('../../../assets/intro/06-gallery-agb/fr.mp4'),
  '06-gallery-agb/it': require('../../../assets/intro/06-gallery-agb/it.mp4'),
  '06-gallery-agb/ru': require('../../../assets/intro/06-gallery-agb/ru.mp4'),
  '06-gallery-agb/zh': require('../../../assets/intro/06-gallery-agb/zh.mp4'),
  '06-gallery-agb/ja': require('../../../assets/intro/06-gallery-agb/ja.mp4'),
  '06-gallery-agb/ko': require('../../../assets/intro/06-gallery-agb/ko.mp4'),
  '06-gallery-agb/es': require('../../../assets/intro/06-gallery-agb/es.mp4'),
  '07-agb-consent/en': require('../../../assets/intro/07-agb-consent/en.mp4'),
  '07-agb-consent/de': require('../../../assets/intro/07-agb-consent/de.mp4'),
  '07-agb-consent/fr': require('../../../assets/intro/07-agb-consent/fr.mp4'),
  '07-agb-consent/it': require('../../../assets/intro/07-agb-consent/it.mp4'),
  '07-agb-consent/ru': require('../../../assets/intro/07-agb-consent/ru.mp4'),
  '07-agb-consent/zh': require('../../../assets/intro/07-agb-consent/zh.mp4'),
  '07-agb-consent/ja': require('../../../assets/intro/07-agb-consent/ja.mp4'),
  '07-agb-consent/ko': require('../../../assets/intro/07-agb-consent/ko.mp4'),
  '07-agb-consent/es': require('../../../assets/intro/07-agb-consent/es.mp4'),
};

/** Sections that must all be present for a language to be considered complete. */
const REQUIRED_SECTIONS = [
  '01-welcome', '03-thanks', '04-terms-intro', '05-local-first', '06-gallery-agb', '07-agb-consent'
];

/**
 * Decide ONE language for the WHOLE intro, once.
 *
 * Per-section fallback was wrong: a language missing a single clip would play German, German,
 * English, German — which reads as broken. The intro either runs entirely in the device's
 * language or entirely in English; it never mixes.
 */
/**
 * Nearest shipped intro language for a device locale we do NOT have clips for.
 *
 * Keyed by ISO-639-1. The point is that a Spanish speaker gets Italian rather than English —
 * a related Romance language they can very likely follow — and a Dutch speaker gets German.
 * Anything with no meaningful neighbour among the eight falls through to English.
 */
const NEAREST_INTRO_LANGUAGE: Record<string, string> = {
  // Romance → Italian / French
  pt: 'es', ca: 'es', gl: 'es', an: 'es', eu: 'es', ro: 'it', oc: 'fr', co: 'it', sc: 'it', la: 'it',
  // Germanic → German
  nl: 'de', af: 'de', da: 'de', sv: 'de', nb: 'de', nn: 'de', no: 'de', is: 'de', fo: 'de', lb: 'de', yi: 'de',
  // Slavic + languages widely paired with Russian → Russian
  uk: 'ru', be: 'ru', bg: 'ru', sr: 'ru', hr: 'ru', bs: 'ru', mk: 'ru', sl: 'ru',
  pl: 'ru', cs: 'ru', sk: 'ru', kk: 'ru', ky: 'ru', uz: 'ru', tg: 'ru', mn: 'ru', hy: 'ru', ka: 'ru', az: 'ru',
  // Sinitic → Chinese
  yue: 'zh', wuu: 'zh', nan: 'zh', hak: 'zh', gan: 'zh', zh_hans: 'zh', zh_hant: 'zh'
};

/**
 * Decide ONE language for the WHOLE intro, once, from the raw device locale.
 *
 * Order: exact match if we ship complete clips for it → nearest related language → English.
 * Per-section fallback is deliberately NOT used: a language missing a single clip would play
 * de, de, en, de, which reads as broken rather than localised.
 *
 * Accepts a full locale tag ('pt-BR', 'zh-Hans-CN', 'de_AT'); only the base subtag matters,
 * except for the Chinese script tags which are mapped explicitly.
 */
export const resolveIntroLanguage = (deviceLanguage: string | null | undefined): string => {
  const raw = (deviceLanguage ?? 'en').toLowerCase().replace(/_/g, '-');
  const base = raw.split('-')[0];

  const isComplete = (candidate: string): boolean =>
    REQUIRED_SECTIONS.every((section) => INTRO_VIDEO_SOURCES[`${section}/${candidate}`] !== undefined);

  // 1. we ship this language outright
  if (isComplete(base)) {
    return base;
  }
  // 2. script-qualified Chinese ('zh-hans' / 'zh-hant') before the generic neighbour lookup
  const scriptKey = raw.replace(/-/g, '_');
  const viaScript = NEAREST_INTRO_LANGUAGE[scriptKey];
  if (viaScript && isComplete(viaScript)) {
    return viaScript;
  }
  // 3. nearest related language
  const neighbour = NEAREST_INTRO_LANGUAGE[base];
  if (neighbour && isComplete(neighbour)) {
    return neighbour;
  }
  // 4. English
  return 'en';
};

/**
 * Clip for a section in an ALREADY-RESOLVED language (see resolveIntroLanguage). Returns null
 * only if the section genuinely has no clip, in which case the caller shows the logo — first
 * launch must never render a blank frame.
 */
export const resolveIntroVideoSource = (
  section: string | null | undefined,
  language: string
): number | null => {
  if (!section) {
    return null;
  }
  return INTRO_VIDEO_SOURCES[`${section}/${language}`] ?? null;
};

/**
 * REACTION CLIPS — the character answering back when the user skips or pokes the video.
 *
 * Two independent 3-stage ladders:
 *   skip-1/2/3   played when Skip is tapped (1st, 2nd, 3rd time)
 *   click-1/2/3  played when the VIDEO itself is tapped
 * The third click ends with "enough is enough" and drops straight to the AGB accept step.
 *
 * These clips DO NOT EXIST YET. Every entry is intentionally absent from the registry below, so
 * resolveReactionVideo() returns null and the whole feature no-ops: Skip behaves exactly as it
 * always did and tapping the video does nothing. Drop files into assets/intro/reactions/ and add
 * their require() lines here — no other code changes needed.
 *
 * Naming, matching the section/language scheme already used above:
 *   assets/intro/reactions/skip-1/<lang>.mp4   … skip-3
 *   assets/intro/reactions/click-1/<lang>.mp4  … click-3
 */
export type ReactionKind = 'skip' | 'click';

const REACTION_VIDEO_SOURCES: Record<string, number> = {
  'click-1/en': require('../../../assets/intro/reactions/click-1/en.mp4'),
  'click-1/de': require('../../../assets/intro/reactions/click-1/de.mp4'),
  'click-1/fr': require('../../../assets/intro/reactions/click-1/fr.mp4'),
  'click-1/it': require('../../../assets/intro/reactions/click-1/it.mp4'),
  'click-1/ru': require('../../../assets/intro/reactions/click-1/ru.mp4'),
  'click-1/zh': require('../../../assets/intro/reactions/click-1/zh.mp4'),
  'click-1/ja': require('../../../assets/intro/reactions/click-1/ja.mp4'),
  'click-1/ko': require('../../../assets/intro/reactions/click-1/ko.mp4'),
  'click-2/en': require('../../../assets/intro/reactions/click-2/en.mp4'),
  'click-2/de': require('../../../assets/intro/reactions/click-2/de.mp4'),
  'click-2/fr': require('../../../assets/intro/reactions/click-2/fr.mp4'),
  'click-2/it': require('../../../assets/intro/reactions/click-2/it.mp4'),
  'click-2/ru': require('../../../assets/intro/reactions/click-2/ru.mp4'),
  'click-2/zh': require('../../../assets/intro/reactions/click-2/zh.mp4'),
  'click-2/ja': require('../../../assets/intro/reactions/click-2/ja.mp4'),
  'click-2/ko': require('../../../assets/intro/reactions/click-2/ko.mp4'),
  'click-3/en': require('../../../assets/intro/reactions/click-3/en.mp4'),
  'click-3/de': require('../../../assets/intro/reactions/click-3/de.mp4'),
  'click-3/fr': require('../../../assets/intro/reactions/click-3/fr.mp4'),
  'click-3/it': require('../../../assets/intro/reactions/click-3/it.mp4'),
  'click-3/ru': require('../../../assets/intro/reactions/click-3/ru.mp4'),
  'click-3/zh': require('../../../assets/intro/reactions/click-3/zh.mp4'),
  'click-3/ja': require('../../../assets/intro/reactions/click-3/ja.mp4'),
  'click-3/ko': require('../../../assets/intro/reactions/click-3/ko.mp4'),
  'skip-1/en': require('../../../assets/intro/reactions/skip-1/en.mp4'),
  'skip-1/de': require('../../../assets/intro/reactions/skip-1/de.mp4'),
  'skip-1/fr': require('../../../assets/intro/reactions/skip-1/fr.mp4'),
  'skip-1/it': require('../../../assets/intro/reactions/skip-1/it.mp4'),
  'skip-1/ru': require('../../../assets/intro/reactions/skip-1/ru.mp4'),
  'skip-1/zh': require('../../../assets/intro/reactions/skip-1/zh.mp4'),
  'skip-1/ja': require('../../../assets/intro/reactions/skip-1/ja.mp4'),
  'skip-1/ko': require('../../../assets/intro/reactions/skip-1/ko.mp4'),
  'skip-2/en': require('../../../assets/intro/reactions/skip-2/en.mp4'),
  'skip-2/de': require('../../../assets/intro/reactions/skip-2/de.mp4'),
  'skip-2/fr': require('../../../assets/intro/reactions/skip-2/fr.mp4'),
  'skip-2/it': require('../../../assets/intro/reactions/skip-2/it.mp4'),
  'skip-2/ru': require('../../../assets/intro/reactions/skip-2/ru.mp4'),
  'skip-2/zh': require('../../../assets/intro/reactions/skip-2/zh.mp4'),
  'skip-2/ja': require('../../../assets/intro/reactions/skip-2/ja.mp4'),
  'skip-2/ko': require('../../../assets/intro/reactions/skip-2/ko.mp4'),
  'skip-3/en': require('../../../assets/intro/reactions/skip-3/en.mp4'),
  'skip-3/de': require('../../../assets/intro/reactions/skip-3/de.mp4'),
  'skip-3/fr': require('../../../assets/intro/reactions/skip-3/fr.mp4'),
  'skip-3/it': require('../../../assets/intro/reactions/skip-3/it.mp4'),
  'skip-3/ru': require('../../../assets/intro/reactions/skip-3/ru.mp4'),
  'skip-3/zh': require('../../../assets/intro/reactions/skip-3/zh.mp4'),
  'skip-3/ja': require('../../../assets/intro/reactions/skip-3/ja.mp4'),
  'skip-3/ko': require('../../../assets/intro/reactions/skip-3/ko.mp4'),
};

/** Reaction clip for a stage (1-3) in the resolved intro language, or null if not shipped. */
export const resolveReactionVideo = (
  kind: ReactionKind,
  stage: number,
  language: string
): number | null => {
  const key = `${kind}-${Math.min(3, Math.max(1, stage))}`;
  return REACTION_VIDEO_SOURCES[`${key}/${language}`] ?? REACTION_VIDEO_SOURCES[`${key}/en`] ?? null;
};

/** True when at least one reaction clip of this kind is shipped for the language. */
export const hasReactionVideos = (kind: ReactionKind, language: string): boolean =>
  [1, 2, 3].some((stage) => resolveReactionVideo(kind, stage, language) !== null);

/**
 * REAL clip lengths in ms, measured from the encoded files (ffprobe), per section+language.
 *
 * The segments used to advance on hand-written timings invented before the clips existed. Those
 * were wrong almost everywhere — German 05-local-first is 8.5s but was cut at 4.6s, mid-sentence,
 * while Japanese 01-welcome is 2.0s and sat silent for nearly two extra seconds. A step now runs
 * for exactly as long as its clip.
 */
export const INTRO_CLIP_MS: Record<string, Record<string, number>> = {
  "01-welcome": {
    "en": 2229,
    "de": 3797,
    "fr": 6485,
    "it": 3541,
    "ru": 4522,
    "zh": 3328,
    "ja": 2005,
    "ko": 6058,
    "es": 3498
  },
  "02-version": {
    "en": 418,
    "de": 2346,
    "fr": 1706,
    "it": 3754,
    "ru": 2389,
    "zh": 2474,
    "ja": 2304,
    "ko": 4266,
    "es": 2858
  },
  "03-thanks": {
    "en": 2925,
    "de": 3754,
    "fr": 4181,
    "it": 3370,
    "ru": 4053,
    "zh": 4352,
    "ja": 4864,
    "ko": 6058,
    "es": 6570
  },
  "04-terms-intro": {
    "en": 3065,
    "de": 4693,
    "fr": 3968,
    "it": 5504,
    "ru": 5077,
    "zh": 4650,
    "ja": 3669,
    "ko": 1066,
    "es": 8661
  },
  "05-local-first": {
    "en": 4783,
    "de": 8490,
    "fr": 6997,
    "it": 5930,
    "ru": 7338,
    "zh": 4650,
    "ja": 3285,
    "ko": 5418,
    "es": 7040
  },
  "06-gallery-agb": {
    "en": 7198,
    "de": 6954,
    "fr": 7978,
    "it": 6272,
    "ru": 7125,
    "zh": 7296,
    "ja": 8106,
    "ko": 7680,
    "es": 6997
  },
  "07-agb-consent": {
    "en": 5665,
    "de": 7168,
    "fr": 6997,
    "it": 6570,
    "ru": 7808,
    "zh": 5674,
    "ja": 5845,
    "ko": 7082,
    "es": 11434
  }
};

/** How long a step should stay on screen: the clip's real length, else the authored fallback. */
export const introStepDurationMs = (
  section: string | null | undefined,
  language: string,
  fallbackMs: number
): number => (section ? INTRO_CLIP_MS[section]?.[language] ?? fallbackMs : fallbackMs);

/**
 * On-screen typewriter text, per language.
 *
 * These are the SAME strings the narrated clips speak, so the text a user reads always matches
 * the voice they hear. This was English-only: a German device played German video under English
 * text, which reads as a bug rather than a localisation.
 */
export const INTRO_TEXT: Record<string, Record<string, string>> = {
  "welcome": {
    "en": "Welcome to Emoji Painter",
    "de": "Willkommen bei Emoji Painter",
    "fr": "Bienvenue dans Emoji Painter",
    "it": "Benvenuto in Emoji Painter",
    "ru": "Добро пожаловать в Emoji Painter",
    "zh": "欢迎使用 Emoji Painter",
    "ja": "Emoji Painter へようこそ",
    "ko": "Emoji Painter에 오신 것을 환영합니다",
    "es": "Bienvenido a Emoji Painter"
  },
  "thanks": {
    "en": "So nice that you downloaded the app.",
    "de": "Schön, dass du die App geladen hast.",
    "fr": "Merci d'avoir téléchargé l'application.",
    "it": "Che bello che tu abbia scaricato l'app.",
    "ru": "Спасибо, что скачали приложение.",
    "zh": "很高兴你下载了这个应用。",
    "ja": "アプリをダウンロードしてくれてありがとう。",
    "ko": "앱을 다운로드해 주셔서 감사합니다.",
    "es": "Qué bien que hayas descargado la aplicación."
  },
  "termsIntro": {
    "en": "Before you start, a few important terms.",
    "de": "Bevor du startest: ein paar wichtige Punkte.",
    "fr": "Avant de commencer, quelques points importants.",
    "it": "Prima di iniziare, alcuni punti importanti.",
    "ru": "Прежде чем начать — несколько важных моментов.",
    "zh": "开始之前，有几点重要说明。",
    "ja": "はじめる前に、大切な点をいくつか。",
    "ko": "시작하기 전에 몇 가지 중요한 안내가 있습니다.",
    "es": "Antes de empezar, algunos términos importantes."
  },
  "localFirst": {
    "en": "Everything you paint stays on your device — until you choose to post it.",
    "de": "Alles, was du malst, bleibt auf deinem Gerät — bis du es selbst veröffentlichst.",
    "fr": "Tout ce que tu peins reste sur ton appareil — jusqu'à ce que tu choisisses de le publier.",
    "it": "Tutto ciò che dipingi resta sul tuo dispositivo — finché non decidi di pubblicarlo.",
    "ru": "Всё, что вы рисуете, остаётся на вашем устройстве — пока вы сами не опубликуете это.",
    "zh": "你画的一切都保存在你的设备上——直到你选择发布它。",
    "ja": "描いたものはすべて端末内に保存されます — あなたが公開を選ぶまでは。",
    "ko": "당신이 그린 모든 것은 기기에 저장됩니다 — 직접 게시하기 전까지는.",
    "es": "Todo lo que pintas permanece en tu dispositivo — hasta que decidas publicarlo."
  },
  "galleryAgb": {
    "en": "Uploading or posting to the Live Gallery requires your agreement to the AGB and the content rules.",
    "de": "Für das Hochladen in die Live-Galerie brauchst du dein Einverständnis zu den AGB und den Inhaltsregeln.",
    "fr": "Publier dans la Galerie Live nécessite ton accord aux CGU et aux règles de contenu.",
    "it": "Per pubblicare nella Live Gallery serve il tuo consenso ai Termini e alle regole sui contenuti.",
    "ru": "Для публикации в Live Gallery нужно ваше согласие с условиями и правилами контента.",
    "zh": "上传或发布到实时画廊需要你同意条款和内容规则。",
    "ja": "ライブギャラリーへの投稿には、利用規約とコンテンツルールへの同意が必要です。",
    "ko": "라이브 갤러리에 업로드하거나 게시하려면 약관과 콘텐츠 규칙에 동의해야 합니다.",
    "es": "Subir o publicar en la Galería en Vivo requiere tu aceptación de los términos y las reglas de contenido."
  },
  "agbConsent": {
    "en": "Posting to the Live Gallery needs your OK to the AGB and content rules.",
    "de": "Posten in die Live-Galerie braucht dein OK zu den AGB und Inhaltsregeln.",
    "fr": "Publier dans la Galerie Live nécessite ton accord aux CGU et aux règles de contenu.",
    "it": "Pubblicare nella Live Gallery richiede il tuo OK ai Termini e alle regole sui contenuti.",
    "ru": "Публикация в Live Gallery требует согласия с условиями и правилами контента.",
    "zh": "发布到实时画廊需要你同意条款和内容规则。",
    "ja": "ライブギャラリーへの投稿には、利用規約とコンテンツルールへの同意が必要です。",
    "ko": "라이브 갤러리에 게시하려면 약관과 콘텐츠 규칙에 대한 동의가 필요합니다.",
    "es": "Publicar en la Galería en Vivo requiere tu aceptación de los términos y las reglas de contenido."
  }
};

/** Text for a key in the resolved intro language, falling back to English. */
export const introText = (key: string, language: string): string =>
  INTRO_TEXT[key]?.[language] ?? INTRO_TEXT[key]?.en ?? '';

/**
 * Content/timing. `mediaAssetName` names the SECTION FOLDER; the language is chosen at runtime
 * from the device locale.
 *
 * FOUR stages total: three timed segments plus the AGB accept step. `04-terms-intro` was cut as
 * filler, and `06-gallery-agb` because it said the same thing the accept step itself says — the
 * consent message appeared twice in a row. Their clips stay in assets/intro/ and in the registry,
 * so re-adding a segment here is enough to bring one back.
 */
export const INTRO_MEDIA_SEGMENTS: IntroMediaSegment[] = [
  { mediaAssetName: '01-welcome', textKey: 'welcome', text: 'Welcome to Emoji Painter', durationMs: 3800, transition: 'fade', accessibilityDescription: 'Emoji Painter logo' },
  { mediaAssetName: '03-thanks', textKey: 'thanks', text: 'So nice that you downloaded the app.', durationMs: 3900, transition: 'crossfade', accessibilityDescription: 'A warm welcome message' },
  {
    mediaAssetName: '05-local-first',
    textKey: 'localFirst',
    text: 'Everything you paint stays on your device — until you choose to post it.',
    durationMs: 4600,
    transition: 'crossfade',
    accessibilityDescription: 'Paintings stay local until you upload them',
  },
];

/** Section shown behind the AGB accept panel (no auto-advance). */
export const AGB_INTRO_SECTION = '07-agb-consent';
