/** Media registry for the lazy player at the bottom of Info Space. */

export const INFO_WELCOME_LANGUAGES = [
  'en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'ru', 'zh',
] as const;
export type InfoWelcomeLanguage = (typeof INFO_WELCOME_LANGUAGES)[number];

const INFO_WELCOME_VIDEO_SOURCES: Record<InfoWelcomeLanguage, number> = {
  en: require('../../../assets/intro/01-welcome/en.mp4'),
  de: require('../../../assets/intro/01-welcome/de.mp4'),
  es: require('../../../assets/intro/01-welcome/es.mp4'),
  fr: require('../../../assets/intro/01-welcome/fr.mp4'),
  it: require('../../../assets/intro/01-welcome/it.mp4'),
  ja: require('../../../assets/intro/01-welcome/ja.mp4'),
  ko: require('../../../assets/intro/01-welcome/ko.mp4'),
  ru: require('../../../assets/intro/01-welcome/ru.mp4'),
  zh: require('../../../assets/intro/01-welcome/zh.mp4'),
};

const INFO_WELCOME_POSTER_SOURCES: Record<InfoWelcomeLanguage, number> = {
  en: require('../../../assets/intro/info-posters/welcome/en.jpg'),
  de: require('../../../assets/intro/info-posters/welcome/de.jpg'),
  es: require('../../../assets/intro/info-posters/welcome/es.jpg'),
  fr: require('../../../assets/intro/info-posters/welcome/fr.jpg'),
  it: require('../../../assets/intro/info-posters/welcome/it.jpg'),
  ja: require('../../../assets/intro/info-posters/welcome/ja.jpg'),
  ko: require('../../../assets/intro/info-posters/welcome/ko.jpg'),
  ru: require('../../../assets/intro/info-posters/welcome/ru.jpg'),
  zh: require('../../../assets/intro/info-posters/welcome/zh.jpg'),
};

export const infoWelcomeVideoSource = (language: InfoWelcomeLanguage): number =>
  INFO_WELCOME_VIDEO_SOURCES[language];

export const infoWelcomePosterSource = (language: InfoWelcomeLanguage): number =>
  INFO_WELCOME_POSTER_SOURCES[language];

/**
 * Punch clips are still being produced. Each finished stage must contain these
 * eight languages; eight accepted taps therefore play every language once
 * before the next stage begins. Add literal require() entries here as files
 * arrive—Metro cannot bundle asset paths assembled dynamically at runtime.
 */
export const INFO_PUNCH_LANGUAGES = [
  'en', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'zh',
] as const;
export type InfoPunchLanguage = (typeof INFO_PUNCH_LANGUAGES)[number];
export type InfoPunchStage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const INFO_PUNCH_VIDEO_SOURCES: Record<
  InfoPunchStage,
  Partial<Record<InfoPunchLanguage, number>>
> = {
  1: {
    en: require('../../../assets/intro/reactions/click-1/en.mp4'),
    de: require('../../../assets/intro/reactions/click-1/de.mp4'),
    fr: require('../../../assets/intro/reactions/click-1/fr.mp4'),
    it: require('../../../assets/intro/reactions/click-1/it.mp4'),
    ja: require('../../../assets/intro/reactions/click-1/ja.mp4'),
    ko: require('../../../assets/intro/reactions/click-1/ko.mp4'),
    ru: require('../../../assets/intro/reactions/click-1/ru.mp4'),
    zh: require('../../../assets/intro/reactions/click-1/zh.mp4'),
  },
  2: {
    en: require('../../../assets/intro/reactions/click-2/en.mp4'),
    de: require('../../../assets/intro/reactions/click-2/de.mp4'),
    fr: require('../../../assets/intro/reactions/click-2/fr.mp4'),
    it: require('../../../assets/intro/reactions/click-2/it.mp4'),
    ja: require('../../../assets/intro/reactions/click-2/ja.mp4'),
    ko: require('../../../assets/intro/reactions/click-2/ko.mp4'),
    ru: require('../../../assets/intro/reactions/click-2/ru.mp4'),
    zh: require('../../../assets/intro/reactions/click-2/zh.mp4'),
  },
  3: {
    en: require('../../../assets/intro/reactions/click-3/en.mp4'),
    de: require('../../../assets/intro/reactions/click-3/de.mp4'),
    fr: require('../../../assets/intro/reactions/click-3/fr.mp4'),
    it: require('../../../assets/intro/reactions/click-3/it.mp4'),
    ja: require('../../../assets/intro/reactions/click-3/ja.mp4'),
    ko: require('../../../assets/intro/reactions/click-3/ko.mp4'),
    ru: require('../../../assets/intro/reactions/click-3/ru.mp4'),
    zh: require('../../../assets/intro/reactions/click-3/zh.mp4'),
  },
  4: {},
  5: {},
  6: {},
  7: {},
  8: {},
  9: {},
};

const INFO_PUNCH_POSTER_SOURCES: Record<
  InfoPunchStage,
  Partial<Record<InfoPunchLanguage, number>>
> = {
  1: {
    en: require('../../../assets/intro/info-posters/punch/stage-1/en.jpg'),
    de: require('../../../assets/intro/info-posters/punch/stage-1/de.jpg'),
    fr: require('../../../assets/intro/info-posters/punch/stage-1/fr.jpg'),
    it: require('../../../assets/intro/info-posters/punch/stage-1/it.jpg'),
    ja: require('../../../assets/intro/info-posters/punch/stage-1/ja.jpg'),
    ko: require('../../../assets/intro/info-posters/punch/stage-1/ko.jpg'),
    ru: require('../../../assets/intro/info-posters/punch/stage-1/ru.jpg'),
    zh: require('../../../assets/intro/info-posters/punch/stage-1/zh.jpg'),
  },
  2: {
    en: require('../../../assets/intro/info-posters/punch/stage-2/en.jpg'),
    de: require('../../../assets/intro/info-posters/punch/stage-2/de.jpg'),
    fr: require('../../../assets/intro/info-posters/punch/stage-2/fr.jpg'),
    it: require('../../../assets/intro/info-posters/punch/stage-2/it.jpg'),
    ja: require('../../../assets/intro/info-posters/punch/stage-2/ja.jpg'),
    ko: require('../../../assets/intro/info-posters/punch/stage-2/ko.jpg'),
    ru: require('../../../assets/intro/info-posters/punch/stage-2/ru.jpg'),
    zh: require('../../../assets/intro/info-posters/punch/stage-2/zh.jpg'),
  },
  3: {
    en: require('../../../assets/intro/info-posters/punch/stage-3/en.jpg'),
    de: require('../../../assets/intro/info-posters/punch/stage-3/de.jpg'),
    fr: require('../../../assets/intro/info-posters/punch/stage-3/fr.jpg'),
    it: require('../../../assets/intro/info-posters/punch/stage-3/it.jpg'),
    ja: require('../../../assets/intro/info-posters/punch/stage-3/ja.jpg'),
    ko: require('../../../assets/intro/info-posters/punch/stage-3/ko.jpg'),
    ru: require('../../../assets/intro/info-posters/punch/stage-3/ru.jpg'),
    zh: require('../../../assets/intro/info-posters/punch/stage-3/zh.jpg'),
  },
  4: {},
  5: {},
  6: {},
  7: {},
  8: {},
  9: {},
};

export const infoPunchStageIsReady = (stage: InfoPunchStage): boolean =>
  INFO_PUNCH_LANGUAGES.every((language) =>
    INFO_PUNCH_VIDEO_SOURCES[stage][language] != null &&
    INFO_PUNCH_POSTER_SOURCES[stage][language] != null
  );

export const infoPunchVideoSource = (
  stage: InfoPunchStage,
  language: InfoPunchLanguage,
): number | null => INFO_PUNCH_VIDEO_SOURCES[stage][language] ?? null;

export const infoPunchPosterSource = (
  stage: InfoPunchStage,
  language: InfoPunchLanguage,
): number | null => INFO_PUNCH_POSTER_SOURCES[stage][language] ?? null;
