import AsyncStorage from '@react-native-async-storage/async-storage';

const LANGUAGE_KEY = '@emojipaint/language_preference';

export type AppLanguage = 'en' | 'de' | 'ru' | 'zh' | 'ko' | 'ja' | 'fr' | 'it';

export const LANGUAGE_OPTIONS: Array<{ id: AppLanguage; label: string; flag: string }> = [
  { id: 'en', label: 'English', flag: '🇺🇸' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { id: 'ru', label: 'Русский', flag: '🇷🇺' },
  { id: 'zh', label: '中文', flag: '🇨🇳' },
  { id: 'ko', label: '한국어', flag: '🇰🇷' },
  { id: 'ja', label: '日本語', flag: '🇯🇵' },
  { id: 'fr', label: 'Français', flag: '🇫🇷' },
  { id: 'it', label: 'Italiano', flag: '🇮🇹' },
];

const VALID: AppLanguage[] = ['en', 'de', 'ru', 'zh', 'ko', 'ja', 'fr', 'it'];

export const saveLanguagePreference = async (lang: AppLanguage): Promise<void> => {
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  } catch {}
};

export const loadLanguagePreference = async (): Promise<AppLanguage | null> => {
  try {
    const val = await AsyncStorage.getItem(LANGUAGE_KEY);
    return VALID.includes(val as AppLanguage) ? (val as AppLanguage) : null;
  } catch {
    return null;
  }
};
