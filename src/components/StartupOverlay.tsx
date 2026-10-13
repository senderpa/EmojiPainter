import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';

import appMetadata from '../../package.json';

import { usePainting } from '../state/PaintingContext';
import { emojiCategories } from '../lib/emojiCatalog';
import { filterSingleEmojiGlyphs } from '../lib/emojiUtils';
import { emitAppEvent, addAppEventListener } from '../lib/appEvents';
import { fetchDailyPaintGallery, type DailyPaintGalleryEntry } from '../lib/dailyPaintGallery';
import {
  LANGUAGE_OPTIONS,
  saveLanguagePreference,
  loadLanguagePreference,
  type AppLanguage,
} from '../lib/languageStorage';
import { GallerySlideshow } from './GallerySlideshow';
import LogoAnimationLoop from './LogoAnimationLoop';

interface StartupOverlayProps {
  onFinish: () => void;
}

// ─── Slot machine constants ───────────────────────────────────────────────────
const SLOT_SIZE = 68;
const BASE_CYCLES = [1, 2, 3];
const SLOT_FONT_SIZES = [36, 54, 36];
const SPIN_DURATIONS = [40, 55, 70];
const SPIN_EASING = Easing.linear;
const CHIME_DELAY_MS = 120;
const FINAL_EMOJI_HOLD_MS = 1000;
const DEFAULT_BRUSH_EMOJI = '🎨';

// ─── Language data ────────────────────────────────────────────────────────────
const WELCOME_CYCLE = [
  'Welcome', 'Willkommen', 'Bienvenue', 'Benvenuto',
  'Bienvenido', '欢迎', 'ようこそ', '환영합니다',
  'Добро пожаловать', 'Welkom', 'Välkommen', 'Vitajte',
];

const TRANSLATIONS: Record<AppLanguage, {
  welcome: string;
  startPainting: string;
  gallery: string;
  profile: string;
  info: string;
  skip: string;
  subtitle: string;
}> = {
  en: { welcome: 'Welcome', startPainting: 'Start Painting', gallery: 'Gallery', profile: 'Profile', info: 'Info', skip: 'Skip', subtitle: 'Spinning up a fresh brush…' },
  de: { welcome: 'Willkommen', startPainting: 'Jetzt Malen', gallery: 'Galerie', profile: 'Profil', info: 'Info', skip: 'Überspringen', subtitle: 'Einen neuen Pinsel bereiten…' },
  ru: { welcome: 'Добро пожаловать', startPainting: 'Рисовать', gallery: 'Галерея', profile: 'Профиль', info: 'Справка', skip: 'Пропустить', subtitle: 'Готовим новую кисть…' },
  zh: { welcome: '欢迎', startPainting: '开始画画', gallery: '画廊', profile: '个人资料', info: '信息', skip: '跳过', subtitle: '正在准备新画笔…' },
  ko: { welcome: '환영합니다', startPainting: '그리기 시작', gallery: '갤러리', profile: '프로필', info: '정보', skip: '건너뛰기', subtitle: '새 브러시를 준비 중…' },
  ja: { welcome: 'ようこそ', startPainting: '描き始める', gallery: 'ギャラリー', profile: 'プロフィール', info: '情報', skip: 'スキップ', subtitle: '新しいブラシを用意中…' },
  fr: { welcome: 'Bienvenue', startPainting: 'Commencer', gallery: 'Galerie', profile: 'Profil', info: 'Info', skip: 'Passer', subtitle: 'Préparation du pinceau…' },
  it: { welcome: 'Benvenuto', startPainting: 'Inizia a Dipingere', gallery: 'Galleria', profile: 'Profilo', info: 'Info', skip: 'Salta', subtitle: 'Preparando il pennello…' },
};

// ─── Emoji pool ───────────────────────────────────────────────────────────────
const emojiPool: string[] = filterSingleEmojiGlyphs(
  emojiCategories.flatMap((c) => c.emojis)
);

const getRandomEmoji = (): string =>
  emojiPool.length > 0
    ? emojiPool[Math.floor(Math.random() * emojiPool.length)]
    : DEFAULT_BRUSH_EMOJI;

const sampleSequence = (count: number): string[] => {
  const pool = emojiPool.length > 0 ? [...emojiPool] : [DEFAULT_BRUSH_EMOJI];
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  while (shuffled.length < count) shuffled.push(getRandomEmoji());
  return shuffled.slice(0, count);
};

// ─── Component ────────────────────────────────────────────────────────────────
const StartupOverlay: React.FC<StartupOverlayProps> = ({ onFinish }) => {
  const { rememberStartupBrush } = usePainting();

  // ── Version ──
  const appVersion = useMemo(() => {
    const expoVersion = Constants.expoConfig?.version ?? Constants.manifest?.version;
    const nativeVersion = Constants.nativeAppVersion ?? Constants.nativeBuildVersion;
    const packageVersion =
      typeof (appMetadata as any)?.version === 'string' ? (appMetadata as any).version : null;
    return expoVersion ?? nativeVersion ?? packageVersion ?? 'dev';
  }, []);

  // ── Language ──
  const [language, setLanguage] = useState<AppLanguage>('en');
  // Ref keeps the latest language value accessible inside stale animation closures
  const languageRef = useRef<AppLanguage>('en');
  const t = TRANSLATIONS[language];

  // Show language picker only on first launch ever
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);

  useEffect(() => {
    loadLanguagePreference().then((stored) => {
      if (stored) {
        setLanguage(stored);
        languageRef.current = stored;
      }
    });
    AsyncStorage.getItem('@emojipaint_first_time_done').then((val) => {
      setIsFirstLaunch(val === null);
    });
  }, []);

  const handleSelectLanguage = useCallback((lang: AppLanguage) => {
    void Haptics.selectionAsync();
    setLanguage(lang);
    languageRef.current = lang;
    void saveLanguagePreference(lang);
  }, []);

  // ── Cycling welcome text ──
  const [welcomeWord, setWelcomeWord] = useState(WELCOME_CYCLE[0]);
  const welcomeOpacity = useRef(new Animated.Value(1)).current;
  const welcomeIndexRef = useRef(0);

  useEffect(() => {
    const shuffled = [...WELCOME_CYCLE].sort(() => Math.random() - 0.5);
    let idx = 0;

    const cycle = () => {
      Animated.sequence([
        Animated.timing(welcomeOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.delay(80),
      ]).start(() => {
        idx = (idx + 1) % shuffled.length;
        setWelcomeWord(shuffled[idx]);
        Animated.timing(welcomeOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
      });
    };

    const interval = setInterval(cycle, 2000);
    return () => clearInterval(interval);
  }, [welcomeOpacity]);

  // ── Slot machine ──
  const finalEmojiRef = useRef<string>(getRandomEmoji());
  const sequencesRef = useRef<string[][]>([]);
  const indicesRef = useRef<number[]>([]);
  const targetsRef = useRef<number[]>([]);
  const offsetsRef = useRef<Animated.Value[]>([]);
  const completedRef = useRef(0);
  const spinningRef = useRef(true);
  const [indices, setIndices] = useState<number[]>([]);

  const sequences = useMemo(() => Array.from({ length: 3 }, () => sampleSequence(9)), []);

  useEffect(() => {
    const cloned = sequences.map((s) => [...s]);
    sequencesRef.current = cloned;
    indicesRef.current = cloned.map((s) => Math.floor(Math.random() * s.length));
    targetsRef.current = cloned.map((s) => {
      const finalEmoji = finalEmojiRef.current;
      let index = s.indexOf(finalEmoji);
      if (index === -1) {
        index = Math.floor(Math.random() * s.length);
        s[index] = finalEmoji;
      }
      return index;
    });
    offsetsRef.current = cloned.map(() => new Animated.Value(0));
    setIndices(indicesRef.current);
  }, [sequences]);

  // ── Visibility / fade ──
  const [visible, setVisible] = useState(true);
  const opacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  // ── Idle gallery slideshow (3 min) ──
  const [slideshowEntries, setSlideshowEntries] = useState<DailyPaintGalleryEntry[]>([]);
  const [showSlideshow, setShowSlideshow] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(async () => {
      try {
        const entries = await fetchDailyPaintGallery({ limit: 40, sort: 'hot' });
        if (entries.length > 0) {
          setSlideshowEntries(entries);
          setShowSlideshow(true);
        }
      } catch {}
    }, 3 * 60 * 1000); // 3 minutes
  }, []);

  // ── Startup animations + spin ──
  useEffect(() => {
    emitAppEvent('startup:shown');

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: 1, duration: 540, delay: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();

    const startSpins = () => {
      const seqs = sequencesRef.current;
      const initial = indicesRef.current;
      const targets = targetsRef.current;
      seqs.forEach((sequence, reelIndex) => {
        const len = sequence.length;
        const baseCycles = BASE_CYCLES[reelIndex] ?? BASE_CYCLES[BASE_CYCLES.length - 1];
        const offset = (targets[reelIndex] - initial[reelIndex] + len) % len;
        const totalSteps = baseCycles * len + offset;
        spinReel(reelIndex, totalSteps);
      });
    };

    startSpins();
    startIdleTimer();

    return () => {
      spinningRef.current = false;
      offsetsRef.current.forEach((o) => o.stopAnimation());
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  const playClick = () => void Haptics.selectionAsync();
  const playChime = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

  const spinReel = (reelIndex: number, stepsRemaining: number) => {
    if (!spinningRef.current || stepsRemaining <= 0) {
      finalizeReel(reelIndex);
      return;
    }
    Animated.timing(offsetsRef.current[reelIndex], {
      toValue: 1,
      duration: SPIN_DURATIONS[reelIndex] ?? SPIN_DURATIONS[0],
      easing: SPIN_EASING,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      playClick();
      setIndices((prev) => {
        const next = [...prev];
        const sequence = sequencesRef.current[reelIndex];
        next[reelIndex] = (next[reelIndex] + 1) % sequence.length;
        return next;
      });
      offsetsRef.current[reelIndex].setValue(0);
      spinReel(reelIndex, stepsRemaining - 1);
    });
  };

  const finalizeReel = (reelIndex: number) => {
    completedRef.current += 1;
    if (completedRef.current >= sequencesRef.current.length) {
      rememberStartupBrush(finalEmojiRef.current);
      playChime();
      setTimeout(() => triggerDismiss(), CHIME_DELAY_MS + FINAL_EMOJI_HOLD_MS);
    }
  };

  const triggerDismiss = useCallback(
    (lang?: AppLanguage) => {
      if (!visible) return;
      setVisible(false);
      // Always read from the ref so stale animation-closure calls get the current language
      const finalLang = lang ?? languageRef.current;
      void saveLanguagePreference(finalLang);
      emitAppEvent('startup:language_selected', finalLang);
      emitAppEvent('startup:closing');

      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 0, duration: 240, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 320, delay: 120, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]).start(() => {
        emitAppEvent('startup:hidden');
        onFinish();
      });
    },
    [visible, contentOpacity, opacity, onFinish]
  );

  const handleStart = useCallback(() => {
    spinningRef.current = false;
    offsetsRef.current.forEach((o) => o.stopAnimation());
    rememberStartupBrush(finalEmojiRef.current);
    void Haptics.selectionAsync();
    triggerDismiss();
  }, [triggerDismiss, rememberStartupBrush]);


  // ── Slot reel renderer ──
  const renderReel = (reelIndex: number) => {
    const sequence = sequencesRef.current[reelIndex];
    if (!sequence) return null;
    const len = sequence.length;
    const index = indices[reelIndex] ?? 0;
    const values = [
      sequence[(index - 1 + len) % len],
      sequence[index % len],
      sequence[(index + 1) % len],
    ];
    const translateY = offsetsRef.current[reelIndex]?.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -SLOT_SIZE],
    }) ?? 0;

    return (
      <View key={`reel-${reelIndex}`} style={styles.slotWindow}>
        <Animated.View style={[styles.slotColumn, { transform: [{ translateY }] }]}>
          {values.map((emoji, position) => (
            <Text
              key={`${emoji}-${position}`}
              style={[styles.slotEmoji, { fontSize: SLOT_FONT_SIZES[position] ?? SLOT_FONT_SIZES[1] }]}
            >
              {emoji}
            </Text>
          ))}
        </Animated.View>
      </View>
    );
  };

  return (
    <Animated.View style={[styles.overlay, { opacity }]}>
      <Animated.View style={[styles.content, { opacity: contentOpacity }]}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <LogoAnimationLoop size={200} frameInterval={100} isMuted={false} />
        </View>

        {/* Cycling welcome word */}
        <Animated.Text style={[styles.welcomeWord, { opacity: welcomeOpacity }]}>
          {welcomeWord}
        </Animated.Text>

        {/* App title */}
        <View style={styles.titleGroup}>
          <Text style={styles.title}>EmojiPainter</Text>
        </View>

        {/* Language picker — only on first launch */}
        {isFirstLaunch && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.langRow}
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={[styles.langBtn, language === opt.id && styles.langBtnActive]}
                onPress={() => handleSelectLanguage(opt.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.langFlag}>{opt.flag}</Text>
                {language === opt.id ? (
                  <Text style={styles.langLabel}>{opt.label}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Subtitle */}
        <Text style={styles.subtitle}>{t.subtitle}</Text>

        {/* Slot machine */}
        <View style={styles.reelsRow}>{[0, 1, 2].map(renderReel)}</View>

        {/* Skip */}
        <TouchableOpacity style={styles.skipButton} onPress={handleStart} activeOpacity={0.7}>
          <Text style={styles.skipLabel}>{t.skip}</Text>
        </TouchableOpacity>

        {/* Copyright footer */}
        <Text style={styles.copyright}>
          {'© Pascal Sender 2026  ·  v'}
          {appVersion}
        </Text>
      </Animated.View>

      {/* Idle gallery slideshow (after 3 min) */}
      {showSlideshow && slideshowEntries.length > 0 ? (
        <GallerySlideshow
          entries={slideshowEntries}
          skipOptions
          initialDurationMs={6000}
          onClose={() => setShowSlideshow(false)}
        />
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#040404',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  content: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
    width: '100%',
  },
  logoContainer: {
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Cycling welcome word
  welcomeWord: {
    fontSize: 22,
    color: '#9fa6ff',
    fontFamily: 'vrtlfinal',
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  // Title
  titleGroup: {
    alignItems: 'center',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#fff',
    textTransform: 'uppercase',
    fontFamily: 'vrtlfinal',
  },

  // Language picker
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#222',
    backgroundColor: '#111',
    gap: 5,
  },
  langBtnActive: {
    borderColor: '#9fa6ff',
    backgroundColor: 'rgba(159,166,255,0.12)',
  },
  langFlag: {
    fontSize: 20,
  },
  langLabel: {
    color: '#9fa6ff',
    fontSize: 11,
    fontFamily: 'vrtlfinal',
  },

  // Subtitle
  subtitle: {
    color: '#666',
    fontSize: 13,
    fontFamily: 'vrtlfinal',
  },

  // Slot machine
  reelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  slotWindow: {
    height: SLOT_SIZE,
    width: SLOT_SIZE * 0.9,
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#1f1f1f',
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slotColumn: {
    alignItems: 'center',
  },
  slotEmoji: {
    height: SLOT_SIZE,
    textAlign: 'center',
    color: '#ffffff',
  },

  // Skip
  skipButton: {
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  skipLabel: {
    color: '#444',
    fontSize: 12,
    letterSpacing: 0.4,
    fontFamily: 'vrtlfinal',
  },

  // Copyright
  copyright: {
    color: '#333',
    fontSize: 10,
    fontFamily: 'vrtlfinal',
    letterSpacing: 0.3,
    textAlign: 'center',
    marginTop: 2,
  },
});

export default StartupOverlay;
