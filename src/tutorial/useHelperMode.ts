import { useCallback, useEffect, useRef, useState } from 'react';

import { useTutorialActions } from './TutorialContext';
import { getActionNarration } from './translations';
import type { TutorialLanguage } from './types';
import { useAppSettings } from '../context/AppSettingsContext';
import { loadLanguagePreference } from '../lib/languageStorage';

interface UseHelperModeOptions {
  keys: string[];
  actionKeyMap?: Record<string, string>;
}

export interface UseHelperModeResult {
  activeHelperKey: string | null;
  glowCounters: Record<string, number>;
  triggerHelper: (key: string) => void;
  tutorialModeEnabled: boolean;
  helperModeEnabled: boolean;
  lang: TutorialLanguage;
}

let cachedHelperLanguage: TutorialLanguage | null = null;
let helperLanguagePromise: Promise<TutorialLanguage | null> | null = null;

export const useHelperMode = ({ keys, actionKeyMap }: UseHelperModeOptions): UseHelperModeResult => {
  const { settings } = useAppSettings();
  const { setTutorialAction } = useTutorialActions();

  const [lang, setLang] = useState<TutorialLanguage>('en');
  const [activeHelperKey, setActiveHelperKey] = useState<string | null>(null);
  const [glowCounters, setGlowCounters] = useState<Record<string, number>>({});

  const helperTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const helperEnabledRef = useRef(settings.helperModeEnabled);
  const tutorialEnabledRef = useRef(settings.tutorialModeEnabled);
  const langRef = useRef(lang);
  helperEnabledRef.current = settings.helperModeEnabled;
  tutorialEnabledRef.current = settings.tutorialModeEnabled;
  langRef.current = lang;

  useEffect(() => {
    if (cachedHelperLanguage) {
      setLang(cachedHelperLanguage);
      return;
    }
    if (!helperLanguagePromise) {
      helperLanguagePromise = loadLanguagePreference()
        .then((value) => {
          cachedHelperLanguage = (value as TutorialLanguage | null) ?? null;
          return cachedHelperLanguage;
        })
        .catch(() => null);
    }
    helperLanguagePromise.then((value) => {
      if (value) {
        setLang(value);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!settings.helperModeEnabled) {
      setActiveHelperKey(null);
      if (helperTimerRef.current) clearTimeout(helperTimerRef.current);
    }
  }, [settings.helperModeEnabled]);

  // Show helper label on every tap, auto-hides after 2s
  const triggerHelper = useCallback((key: string) => {
    if (!helperEnabledRef.current && !tutorialEnabledRef.current) {
      return;
    }
    if (helperEnabledRef.current) {
      if (helperTimerRef.current) clearTimeout(helperTimerRef.current);
      setActiveHelperKey(key);
      helperTimerRef.current = setTimeout(() => setActiveHelperKey(null), 2000);
    }
    if (tutorialEnabledRef.current) {
      setGlowCounters(prev => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
      const narrationKey = actionKeyMap?.[key] ?? key;
      const text = getActionNarration(langRef.current, narrationKey);
      if (text) setTutorialAction(text);
    }
  }, [actionKeyMap, setTutorialAction]);

  return {
    activeHelperKey,
    glowCounters,
    triggerHelper,
    tutorialModeEnabled: settings.tutorialModeEnabled,
    helperModeEnabled: settings.helperModeEnabled,
    lang,
  };
};
