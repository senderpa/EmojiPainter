/**
 * Info Copy & Language Support
 *
 * Centralized language type and localizations for the app
 */

export type InfoLanguage = 'en' | 'de' | 'ru' | 'zh' | 'ko' | 'ja' | 'fr' | 'it';

// Language names mapping
export const languageNames: Record<InfoLanguage, string> = {
  en: 'English',
  de: 'Deutsch',
  ru: 'Русский',
  zh: '中文',
  ko: '한국어',
  ja: '日本語',
  fr: 'Français',
  it: 'Italiano'
};

// Info copy for different languages
export const infoCopy: Record<InfoLanguage, Record<string, string>> = {
  en: {
    appTitle: 'Emoji Paint',
    welcome: 'Welcome to Emoji Paint',
    start: 'Start Painting',
    gallery: 'Gallery',
    settings: 'Settings'
  },
  de: {
    appTitle: 'Emoji Malen',
    welcome: 'Willkommen bei Emoji Malen',
    start: 'Beginnen Sie zu malen',
    gallery: 'Galerie',
    settings: 'Einstellungen'
  },
  ru: {
    appTitle: 'Эмодзи Рисование',
    welcome: 'Добро пожаловать в Эмодзи Рисование',
    start: 'Начать рисование',
    gallery: 'Галерея',
    settings: 'Настройки'
  },
  zh: {
    appTitle: '表情符号绘画',
    welcome: '欢迎使用表情符号绘画',
    start: '开始绘画',
    gallery: '画廊',
    settings: '设置'
  },
  ko: {
    appTitle: '이모지 페인트',
    welcome: '이모지 페인트에 오신 것을 환영합니다',
    start: '그리기 시작',
    gallery: '갤러리',
    settings: '설정'
  },
  ja: {
    appTitle: '絵文字ペイント',
    welcome: '絵文字ペイントへようこそ',
    start: '描き始める',
    gallery: 'ギャラリー',
    settings: '設定'
  },
  fr: {
    appTitle: 'Emoji Paint',
    welcome: 'Bienvenue sur Emoji Paint',
    start: 'Commencer à peindre',
    gallery: 'Galerie',
    settings: 'Paramètres'
  },
  it: {
    appTitle: 'Emoji Paint',
    welcome: 'Benvenuto in Emoji Paint',
    start: 'Inizia a dipingere',
    gallery: 'Galleria',
    settings: 'Impostazioni'
  }
};

/**
 * Get info copy for a specific language
 */
export const getInfoCopy = (language: InfoLanguage, key: string): string => {
  return infoCopy[language]?.[key] || infoCopy.en[key] || '';
};
