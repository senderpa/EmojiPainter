import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView, Image, Dimensions, Modal, Animated } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import GesserApi from '../api/gesserClient';
import { markMysteryGuessed, hasGuessedMystery } from '../utils/storage';
import type { GesserMysteryPainting } from '../types';

interface GuessCopy {
  title: string;
  loadingText: string;
  noMysteryImagesTitle: string;
  noMysteryImagesAll: string;
  noMysteryImagesUnsolved: string;
  networkError: string;
  retryButton: string;
  closeButton: string;
  emptyGuessTitle: string;
  emptyGuessMsg: string;
  alreadyGuessedTitle: string;
  alreadyGuessedMsg: string;
  errorTitle: string;
  errorSubmit: string;
  mysteryTopicLabel: string;
  topicHint: string;
  solvedBy: string;
  topicReveal: string;
  totalAttempts: string;
  alreadyGuessedText: string;
  alreadyGuessedHint: string;
  coinsEarned: string;
  guessPlaceholder: string;
  submitButton: string;
  oneGuessWarning: string;
  paintedLabel: string;
  attemptsLabel: string;
  prevButton: string;
  nextButton: string;
}

const GUESS_COPY: Record<string, GuessCopy> = {
  en: {
    title: 'Guess the Topic',
    loadingText: 'Loading mystery images...',
    noMysteryImagesTitle: 'No Mystery Images',
    noMysteryImagesAll: 'No mystery images available right now.\nCheck back later or paint your own!',
    noMysteryImagesUnsolved: 'No unsolved mystery images.\nCheck back later or paint your own!',
    networkError: 'Failed to load mystery images.\nPlease check your internet connection.',
    retryButton: '🔄 Retry',
    closeButton: 'Close',
    emptyGuessTitle: 'Empty Guess',
    emptyGuessMsg: 'Please enter a guess!',
    alreadyGuessedTitle: 'Already Guessed',
    alreadyGuessedMsg: 'You already guessed this image!',
    errorTitle: 'Error',
    errorSubmit: 'Failed to submit guess',
    mysteryTopicLabel: 'Mystery Topic:',
    topicHint: '(2 letters revealed for everyone)',
    solvedBy: 'Solved by',
    topicReveal: 'Topic:',
    totalAttempts: 'Total attempts:',
    alreadyGuessedText: 'You already guessed this one!',
    alreadyGuessedHint: 'One guess per user per image',
    coinsEarned: '+50 coins! 🪙',
    guessPlaceholder: 'Enter your guess...',
    submitButton: 'Submit Guess',
    oneGuessWarning: '⚠️ You get ONE guess only!',
    paintedLabel: '🎨 Painted:',
    attemptsLabel: '🎯 Attempts:',
    prevButton: '← Prev',
    nextButton: 'Next →',
  },
  de: {
    title: 'Thema erraten',
    loadingText: 'Bilder laden...',
    noMysteryImagesTitle: 'Keine Rätselbilder',
    noMysteryImagesAll: 'Derzeit keine Rätselbilder verfügbar.\nSchau später wieder vorbei oder male selbst!',
    noMysteryImagesUnsolved: 'Keine ungelösten Rätselbilder.\nSchau später wieder oder male selbst!',
    networkError: 'Bilder konnten nicht geladen werden.\nBitte Internetverbindung prüfen.',
    retryButton: '🔄 Nochmal',
    closeButton: 'Schließen',
    emptyGuessTitle: 'Leere Antwort',
    emptyGuessMsg: 'Bitte gib eine Antwort ein!',
    alreadyGuessedTitle: 'Bereits geraten',
    alreadyGuessedMsg: 'Du hast dieses Bild bereits geraten!',
    errorTitle: 'Fehler',
    errorSubmit: 'Antwort konnte nicht gesendet werden',
    mysteryTopicLabel: 'Geheimes Thema:',
    topicHint: '(2 Buchstaben für alle sichtbar)',
    solvedBy: 'Gelöst von',
    topicReveal: 'Thema:',
    totalAttempts: 'Versuche gesamt:',
    alreadyGuessedText: 'Du hast das schon geraten!',
    alreadyGuessedHint: 'Ein Versuch pro Nutzer pro Bild',
    coinsEarned: '+50 Münzen! 🪙',
    guessPlaceholder: 'Deine Antwort eingeben...',
    submitButton: 'Abschicken',
    oneGuessWarning: '⚠️ Nur EIN Versuch!',
    paintedLabel: '🎨 Gemalt:',
    attemptsLabel: '🎯 Versuche:',
    prevButton: '← Zurück',
    nextButton: 'Weiter →',
  },
  ru: {
    title: 'Угадай тему',
    loadingText: 'Загрузка изображений...',
    noMysteryImagesTitle: 'Нет загадочных картин',
    noMysteryImagesAll: 'Сейчас нет загадочных картин.\nЗайдите позже или нарисуйте сами!',
    noMysteryImagesUnsolved: 'Нет неразгаданных картин.\nЗайдите позже или нарисуйте сами!',
    networkError: 'Не удалось загрузить картины.\nПроверьте подключение к интернету.',
    retryButton: '🔄 Повтор',
    closeButton: 'Закрыть',
    emptyGuessTitle: 'Пустой ответ',
    emptyGuessMsg: 'Пожалуйста, введите ответ!',
    alreadyGuessedTitle: 'Уже угадывали',
    alreadyGuessedMsg: 'Вы уже угадывали это изображение!',
    errorTitle: 'Ошибка',
    errorSubmit: 'Не удалось отправить ответ',
    mysteryTopicLabel: 'Загадочная тема:',
    topicHint: '(2 буквы открыты для всех)',
    solvedBy: 'Разгадал(а)',
    topicReveal: 'Тема:',
    totalAttempts: 'Всего попыток:',
    alreadyGuessedText: 'Вы уже угадывали это!',
    alreadyGuessedHint: 'Одна попытка на пользователя',
    coinsEarned: '+50 монет! 🪙',
    guessPlaceholder: 'Введите ответ...',
    submitButton: 'Отправить',
    oneGuessWarning: '⚠️ Только ОДНА попытка!',
    paintedLabel: '🎨 Нарисовано:',
    attemptsLabel: '🎯 Попыток:',
    prevButton: '← Назад',
    nextButton: 'Вперёд →',
  },
  zh: {
    title: '猜猜主题',
    loadingText: '正在加载神秘图片...',
    noMysteryImagesTitle: '没有神秘图片',
    noMysteryImagesAll: '目前没有神秘图片。\n稍后再来或自己来画！',
    noMysteryImagesUnsolved: '没有未解决的神秘图片。\n稍后再来或自己来画！',
    networkError: '无法加载图片。\n请检查网络连接。',
    retryButton: '🔄 重试',
    closeButton: '关闭',
    emptyGuessTitle: '空答案',
    emptyGuessMsg: '请输入您的猜测！',
    alreadyGuessedTitle: '已猜过',
    alreadyGuessedMsg: '您已经猜过这张图片了！',
    errorTitle: '错误',
    errorSubmit: '提交猜测失败',
    mysteryTopicLabel: '神秘主题：',
    topicHint: '（所有人可见2个字母）',
    solvedBy: '解答者：',
    topicReveal: '主题：',
    totalAttempts: '总尝试次数：',
    alreadyGuessedText: '您已经猜过这张图！',
    alreadyGuessedHint: '每人每图只有一次机会',
    coinsEarned: '+50枚硬币！🪙',
    guessPlaceholder: '输入您的答案...',
    submitButton: '提交猜测',
    oneGuessWarning: '⚠️ 只有一次机会！',
    paintedLabel: '🎨 绘制时间：',
    attemptsLabel: '🎯 尝试次数：',
    prevButton: '← 上一张',
    nextButton: '下一张 →',
  },
  ko: {
    title: '주제를 맞춰봐요',
    loadingText: '신비한 그림 로딩 중...',
    noMysteryImagesTitle: '신비한 그림 없음',
    noMysteryImagesAll: '현재 신비한 그림이 없습니다.\n나중에 다시 오거나 직접 그려보세요!',
    noMysteryImagesUnsolved: '풀리지 않은 그림이 없습니다.\n나중에 다시 오거나 직접 그려보세요!',
    networkError: '그림을 불러올 수 없습니다.\n인터넷 연결을 확인해주세요.',
    retryButton: '🔄 재시도',
    closeButton: '닫기',
    emptyGuessTitle: '빈 추측',
    emptyGuessMsg: '추측을 입력하세요!',
    alreadyGuessedTitle: '이미 추측함',
    alreadyGuessedMsg: '이미 이 이미지를 추측하셨습니다!',
    errorTitle: '오류',
    errorSubmit: '추측 제출에 실패했습니다',
    mysteryTopicLabel: '신비한 주제:',
    topicHint: '(2글자가 모두에게 공개됨)',
    solvedBy: '해결자:',
    topicReveal: '주제:',
    totalAttempts: '총 시도 횟수:',
    alreadyGuessedText: '이미 추측하셨습니다!',
    alreadyGuessedHint: '이미지당 한 번만 추측 가능',
    coinsEarned: '+50 코인! 🪙',
    guessPlaceholder: '추측을 입력하세요...',
    submitButton: '추측 제출',
    oneGuessWarning: '⚠️ 한 번만 추측 가능!',
    paintedLabel: '🎨 그린 날:',
    attemptsLabel: '🎯 시도 횟수:',
    prevButton: '← 이전',
    nextButton: '다음 →',
  },
  ja: {
    title: 'テーマを当てよう',
    loadingText: 'ミステリー画像を読み込み中...',
    noMysteryImagesTitle: 'ミステリー画像なし',
    noMysteryImagesAll: 'ミステリー画像は現在ありません。\nあとで確認するか、自分で描いてみよう！',
    noMysteryImagesUnsolved: '未解決の画像はありません。\nあとで確認するか自分で描こう！',
    networkError: '画像を読み込めませんでした。\nネット接続を確認してください。',
    retryButton: '🔄 再試行',
    closeButton: '閉じる',
    emptyGuessTitle: '空の回答',
    emptyGuessMsg: '回答を入力してください！',
    alreadyGuessedTitle: '回答済み',
    alreadyGuessedMsg: 'この画像はすでに回答しています！',
    errorTitle: 'エラー',
    errorSubmit: '回答の送信に失敗しました',
    mysteryTopicLabel: 'ミステリーテーマ:',
    topicHint: '(2文字が全員に公開済み)',
    solvedBy: '解答者:',
    topicReveal: 'テーマ:',
    totalAttempts: '合計試行回数:',
    alreadyGuessedText: 'すでに回答済みです！',
    alreadyGuessedHint: '1枚につき1回のみ回答可',
    coinsEarned: '+50コイン！🪙',
    guessPlaceholder: '答えを入力...',
    submitButton: '回答を送信',
    oneGuessWarning: '⚠️ チャンスは1回のみ！',
    paintedLabel: '🎨 描いた日:',
    attemptsLabel: '🎯 試行回数:',
    prevButton: '← 前へ',
    nextButton: '次へ →',
  },
  fr: {
    title: 'Devinez le thème',
    loadingText: 'Chargement des images...',
    noMysteryImagesTitle: 'Aucune image mystère',
    noMysteryImagesAll: 'Aucune image mystère disponible.\nRevenez plus tard ou peignez la vôtre !',
    noMysteryImagesUnsolved: 'Aucune image non résolue.\nRevenez plus tard ou peignez la vôtre !',
    networkError: 'Impossible de charger les images.\nVérifiez votre connexion internet.',
    retryButton: '🔄 Réessayer',
    closeButton: 'Fermer',
    emptyGuessTitle: 'Réponse vide',
    emptyGuessMsg: 'Veuillez entrer une réponse !',
    alreadyGuessedTitle: 'Déjà deviné',
    alreadyGuessedMsg: 'Vous avez déjà deviné cette image !',
    errorTitle: 'Erreur',
    errorSubmit: 'Impossible d\'envoyer la réponse',
    mysteryTopicLabel: 'Thème mystère :',
    topicHint: '(2 lettres révélées pour tous)',
    solvedBy: 'Résolu par',
    topicReveal: 'Thème :',
    totalAttempts: 'Tentatives totales :',
    alreadyGuessedText: 'Vous avez déjà deviné !',
    alreadyGuessedHint: 'Une seule tentative par image',
    coinsEarned: '+50 pièces ! 🪙',
    guessPlaceholder: 'Entrez votre réponse...',
    submitButton: 'Soumettre',
    oneGuessWarning: '⚠️ Une seule chance !',
    paintedLabel: '🎨 Peint le :',
    attemptsLabel: '🎯 Tentatives :',
    prevButton: '← Préc.',
    nextButton: 'Suiv. →',
  },
  it: {
    title: 'Indovina il tema',
    loadingText: 'Caricamento immagini misteriose...',
    noMysteryImagesTitle: 'Nessuna immagine misteriosa',
    noMysteryImagesAll: 'Nessuna immagine misteriosa disponibile.\nRitorna più tardi o dipingi la tua!',
    noMysteryImagesUnsolved: 'Nessuna immagine irrisolta.\nRitorna più tardi o dipingi la tua!',
    networkError: 'Impossibile caricare le immagini.\nControlla la connessione internet.',
    retryButton: '🔄 Riprova',
    closeButton: 'Chiudi',
    emptyGuessTitle: 'Risposta vuota',
    emptyGuessMsg: 'Inserisci una risposta!',
    alreadyGuessedTitle: 'Già indovinato',
    alreadyGuessedMsg: 'Hai già indovinato questa immagine!',
    errorTitle: 'Errore',
    errorSubmit: 'Impossibile inviare la risposta',
    mysteryTopicLabel: 'Tema misterioso:',
    topicHint: '(2 lettere rivelate per tutti)',
    solvedBy: 'Risolto da',
    topicReveal: 'Tema:',
    totalAttempts: 'Tentativi totali:',
    alreadyGuessedText: 'Hai già indovinato!',
    alreadyGuessedHint: 'Un solo tentativo per immagine',
    coinsEarned: '+50 monete! 🪙',
    guessPlaceholder: 'Inserisci la tua risposta...',
    submitButton: 'Invia risposta',
    oneGuessWarning: '⚠️ Una sola possibilità!',
    paintedLabel: '🎨 Dipinto il:',
    attemptsLabel: '🎯 Tentativi:',
    prevButton: '← Prec.',
    nextButton: 'Succ. →',
  },
};

interface GuessGameScreenProps {
  visible: boolean;
  onClose: () => void;
  deviceId: string;
  language?: string;
  onCoinsEarned?: (coins: number) => void;
}

const { width: screenWidth } = Dimensions.get('window');

const MAX_ANIM_CHARS = 25;

const GuessGameScreen: React.FC<GuessGameScreenProps> = ({
  visible,
  onClose,
  deviceId,
  language,
  onCoinsEarned
}) => {
  const insets = useSafeAreaInsets();
  const t = GUESS_COPY[language ?? 'en'] ?? GUESS_COPY.en;
  const titleText = t.title;
  const titleTextRef = useRef(titleText);
  titleTextRef.current = titleText;

  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState<GesserMysteryPainting[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guess, setGuess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; actualTopic?: string; message: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<'unsolved' | 'all'>('all');
  const [navCount, setNavCount] = useState(0);

  const currentImage = images[currentIndex] || null;

  // Per-letter animation values — sized to MAX_ANIM_CHARS to support any language title
  const letterAnims = useRef(
    Array.from({ length: MAX_ANIM_CHARS }, () => new Animated.Value(0))
  ).current;
  const letterScaleAnims = useRef(
    Array.from({ length: MAX_ANIM_CHARS }, () => new Animated.Value(1))
  ).current;
  const animLoopsRef = useRef<Animated.CompositeAnimation[]>([]);

  // Restart letter animations when navCount changes
  useEffect(() => {
    animLoopsRef.current.forEach(a => a.stop());
    animLoopsRef.current = [];

    const magnitude = Math.min(1.5 + navCount * 1.2, 14);
    const dur = Math.max(400 - navCount * 18, 150);

    const titleLen = titleTextRef.current.length;

    letterAnims.slice(0, titleLen).forEach((anim, i) => {
      const delay = ((i * 70) + Math.floor(Math.random() * 80)) % 800;
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: -magnitude, duration: dur, useNativeDriver: true }),
          Animated.timing(anim, { toValue: magnitude * 0.6, duration: dur * 0.8, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: dur * 0.5, useNativeDriver: true }),
          Animated.delay(Math.max(600 - navCount * 20, 200)),
        ])
      );
      loop.start();
      animLoopsRef.current.push(loop);
    });

    letterScaleAnims.slice(0, titleLen).forEach((anim, i) => {
      const delay = ((i * 55) + Math.floor(Math.random() * 60)) % 700;
      const scaleAmp = Math.min(0.03 + navCount * 0.025, 0.18);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1 + scaleAmp, duration: dur * 0.7, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1 - scaleAmp * 0.5, duration: dur * 0.7, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1, duration: dur * 0.4, useNativeDriver: true }),
          Animated.delay(Math.max(700 - navCount * 15, 200)),
        ])
      );
      loop.start();
      animLoopsRef.current.push(loop);
    });

    return () => {
      animLoopsRef.current.forEach(a => a.stop());
    };
  }, [navCount, letterAnims, letterScaleAnims]);

  // Reset when closed
  useEffect(() => {
    if (visible) {
      const controller = new AbortController();
      loadMysteryImages(controller.signal);
      return () => { controller.abort(); };
    } else {
      setCurrentIndex(0);
      setGuess('');
      setResult(null);
      setErrorMessage(null);
      setNavCount(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, filter]);

  const loadMysteryImages = async (signal?: AbortSignal) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await GesserApi.listMysteryImages(deviceId, filter, 50);
      if (signal?.aborted) return;
      const items = Array.isArray(response?.items) ? response.items : [];
      if (items.length === 0) {
        setErrorMessage(filter === 'all' ? t.noMysteryImagesAll : t.noMysteryImagesUnsolved);
        setImages([]);
      } else {
        setImages(items);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      setErrorMessage(error.message || t.networkError);
      setImages([]);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  const handleSubmitGuess = async () => {
    if (!currentImage) return;
    const trimmedGuess = guess.trim();
    if (!trimmedGuess) {
      Alert.alert(t.emptyGuessTitle, t.emptyGuessMsg);
      return;
    }
    const alreadyGuessed = await hasGuessedMystery(currentImage.id);
    if (alreadyGuessed || currentImage.userGuessed) {
      Alert.alert(t.alreadyGuessedTitle, t.alreadyGuessedMsg);
      return;
    }
    setSubmitting(true);
    try {
      const response = await GesserApi.submitGuess(deviceId, currentImage.id, trimmedGuess);
      await markMysteryGuessed(currentImage.id);
      const updatedImages = [...images];
      updatedImages[currentIndex] = {
        ...currentImage,
        userGuessed: true,
        isSolved: response.correct,
        totalAttempts: response.totalAttempts
      };
      setImages(updatedImages);
      setResult({ correct: response.correct, actualTopic: response.actualTopic, message: response.message });
      if (response.correct) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (onCoinsEarned && response.coinsAwarded) {
          onCoinsEarned(response.coinsAwarded);
        }
        setTimeout(() => { goToNext(); }, 2000);
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (error: any) {
      Alert.alert(t.errorTitle, error.message || t.errorSubmit);
    } finally {
      setSubmitting(false);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setNavCount(c => c + 1);
      setGuess('');
      setResult(null);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setNavCount(c => c + 1);
      setGuess('');
      setResult(null);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  // Render masked topic as individual char blocks
  const renderMaskedTopic = (maskedTopic: string) => {
    const chars = Array.from(maskedTopic);
    // Available width minus horizontal padding
    const contentWidth = screenWidth - 40;
    // Target: ~10 chars per row — each box ~(contentWidth/10) wide
    const boxSize = Math.floor(contentWidth / 10) - 2;

    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: '100%', gap: 3 }}>
        {chars.map((char, i) => {
          if (char === ' ') {
            return <View key={i} style={{ width: boxSize * 0.4, height: boxSize }} />;
          }
          const isBlank = char === '_';
          return (
            <View
              key={i}
              style={{
                width: boxSize,
                height: boxSize + 4,
                backgroundColor: isBlank ? '#1e1e2e' : '#0a2a1a',
                borderRadius: 5,
                justifyContent: 'center',
                alignItems: 'center',
                borderBottomWidth: 2,
                borderBottomColor: isBlank ? '#444' : '#0ff',
                borderWidth: 1,
                borderColor: isBlank ? '#333' : '#0a5',
              }}
            >
              <Text style={{
                fontSize: Math.min(boxSize * 0.55, 18),
                fontWeight: '700',
                color: isBlank ? '#444' : '#0ff',
                fontFamily: 'Courier',
              }}>
                {isBlank ? '' : char.toUpperCase()}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✳️</Text>
          </TouchableOpacity>

          {/* Animated title — each letter independent */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'center' }}>
            <Text style={styles.headerEmoji}>🔍 </Text>
            {Array.from(titleText).map((char, i) => (
              <Animated.Text
                key={i}
                style={[
                  styles.headerTitleChar,
                  {
                    transform: [
                      { translateY: letterAnims[i] ?? new Animated.Value(0) },
                      { scale: letterScaleAnims[i] ?? new Animated.Value(1) },
                    ],
                  },
                ]}
              >
                {char}
              </Animated.Text>
            ))}
          </View>

          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setFilter(filter === 'all' ? 'unsolved' : 'all')}
          >
            <Text style={styles.filterButtonText}>
              {filter === 'all' ? '👁️' : '❓'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Counter Badge */}
        {images.length > 0 && (
          <View style={styles.counterBadge}>
            <Text style={styles.counterText}>{currentIndex + 1} / {images.length}</Text>
          </View>
        )}

        {/* Loading */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0ff" />
            <Text style={styles.loadingText}>{t.loadingText}</Text>
          </View>
        )}

        {/* Error */}
        {!loading && errorMessage && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorIcon}>😔</Text>
            <Text style={styles.errorTitle}>{t.noMysteryImagesTitle}</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => loadMysteryImages()}>
              <Text style={styles.retryButtonText}>{t.retryButton}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeErrorButton} onPress={onClose}>
              <Text style={styles.closeErrorButtonText}>{t.closeButton}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Main Content */}
        {!loading && !errorMessage && currentImage && (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Mystery Image — 50px gap from top */}
            <View style={styles.imageContainer}>
              <Image
                source={{ uri: currentImage.imageUrl }}
                style={styles.image}
                resizeMode="contain"
              />
            </View>

            {/* Masked Topic — no border, clean layout */}
            <View style={styles.topicContainer}>
              <Text style={styles.topicLabel}>{t.mysteryTopicLabel}</Text>
              {renderMaskedTopic(currentImage.maskedTopic)}
              <Text style={styles.topicHint}>{t.topicHint}</Text>
            </View>

            {/* Already Solved */}
            {currentImage.isSolved && (
              <View style={styles.solvedContainer}>
                <Text style={styles.solvedIcon}>✅</Text>
                <Text style={styles.solvedText}>{t.solvedBy} {currentImage.solverName || '?'}!</Text>
                <Text style={styles.solvedTopic}>{t.topicReveal} {result?.actualTopic || '?'}</Text>
                <Text style={styles.solvedAttempts}>{t.totalAttempts} {currentImage.totalAttempts}</Text>
              </View>
            )}

            {/* Already Guessed */}
            {!currentImage.isSolved && currentImage.userGuessed && (
              <View style={styles.alreadyGuessedContainer}>
                <Text style={styles.alreadyGuessedIcon}>🔒</Text>
                <Text style={styles.alreadyGuessedText}>{t.alreadyGuessedText}</Text>
                <Text style={styles.alreadyGuessedHint}>{t.alreadyGuessedHint}</Text>
              </View>
            )}

            {/* Guess Result */}
            {result && (
              <View style={[styles.resultContainer, result.correct ? styles.resultCorrect : styles.resultWrong]}>
                <Text style={styles.resultIcon}>{result.correct ? '🎉' : '❌'}</Text>
                <Text style={styles.resultMessage}>{result.message}</Text>
                {result.correct && result.actualTopic && (
                  <Text style={styles.resultTopic}>{t.topicReveal} {result.actualTopic}</Text>
                )}
                {result.correct && <Text style={styles.resultCoins}>{t.coinsEarned}</Text>}
              </View>
            )}

            {/* Guess Input */}
            {!currentImage.isSolved && !currentImage.userGuessed && !result && (
              <View style={styles.guessContainer}>
                <TextInput
                  style={styles.guessInput}
                  value={guess}
                  onChangeText={setGuess}
                  placeholder={t.guessPlaceholder}
                  placeholderTextColor="#666"
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!submitting}
                  maxLength={50}
                />
                <TouchableOpacity
                  style={[styles.submitButton, (!guess.trim() || submitting) && styles.submitButtonDisabled]}
                  onPress={handleSubmitGuess}
                  disabled={!guess.trim() || submitting}
                >
                  {submitting
                    ? <ActivityIndicator size="small" color="#000" />
                    : <Text style={styles.submitButtonText}>{t.submitButton}</Text>}
                </TouchableOpacity>
                <Text style={styles.guessWarning}>{t.oneGuessWarning}</Text>
              </View>
            )}

            {/* Image Info */}
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                {t.paintedLabel} {new Date(currentImage.paintedAt).toLocaleDateString()}
              </Text>
              <Text style={styles.infoText}>{t.attemptsLabel} {currentImage.totalAttempts}</Text>
            </View>
          </ScrollView>
        )}

        {/* Navigation */}
        {!loading && images.length > 1 && (
          <View style={[styles.navContainer, { paddingBottom: insets.bottom + 8 }]}>
            <TouchableOpacity
              style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
              onPress={goToPrevious}
              disabled={currentIndex === 0}
            >
              <Text style={styles.navButtonText}>{t.prevButton}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navButton, currentIndex === images.length - 1 && styles.navButtonDisabled]}
              onPress={goToNext}
              disabled={currentIndex === images.length - 1}
            >
              <Text style={styles.navButtonText}>{t.nextButton}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#f90'
  },
  headerEmoji: {
    fontSize: 16,
    color: '#f90'
  },
  headerTitleChar: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f90',
  },
  closeButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeButtonText: {
    fontSize: 24
  },
  filterButton: {
    backgroundColor: '#0ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    width: 36,
    alignItems: 'center'
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000'
  },
  counterBadge: {
    alignSelf: 'center',
    backgroundColor: '#f90',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 6,
    marginBottom: 2
  },
  counterText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000'
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingText: {
    color: '#0ff',
    marginTop: 20,
    fontSize: 16
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20
  },
  imageContainer: {
    backgroundColor: '#111',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#f90'
  },
  image: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000'
  },
  topicContainer: {
    backgroundColor: '#161622',
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'center'
  },
  topicLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  topicHint: {
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
    marginTop: 10
  },
  solvedContainer: {
    backgroundColor: '#0f3',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20
  },
  solvedIcon: { fontSize: 48, marginBottom: 10 },
  solvedText: { fontSize: 18, fontWeight: 'bold', color: '#000', marginBottom: 10 },
  solvedTopic: { fontSize: 20, fontWeight: 'bold', color: '#000', marginBottom: 5 },
  solvedAttempts: { fontSize: 14, color: '#333' },
  alreadyGuessedContainer: {
    backgroundColor: '#333',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#666'
  },
  alreadyGuessedIcon: { fontSize: 48, marginBottom: 10 },
  alreadyGuessedText: { fontSize: 16, color: '#fff', fontWeight: 'bold', marginBottom: 5 },
  alreadyGuessedHint: { fontSize: 12, color: '#aaa' },
  resultContainer: {
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 3
  },
  resultCorrect: { backgroundColor: '#0f3', borderColor: '#0f6' },
  resultWrong: { backgroundColor: '#f33', borderColor: '#f66' },
  resultIcon: { fontSize: 48, marginBottom: 10 },
  resultMessage: { fontSize: 18, fontWeight: 'bold', color: '#000', textAlign: 'center', marginBottom: 10 },
  resultTopic: { fontSize: 20, fontWeight: 'bold', color: '#000', marginBottom: 10 },
  resultCoins: { fontSize: 24, fontWeight: 'bold', color: '#000' },
  guessContainer: { marginBottom: 20 },
  guessInput: {
    backgroundColor: '#222',
    borderWidth: 2,
    borderColor: '#0ff',
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: '#fff',
    marginBottom: 12
  },
  submitButton: {
    backgroundColor: '#0ff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10
  },
  submitButtonDisabled: { backgroundColor: '#333', opacity: 0.5 },
  submitButtonText: { fontSize: 18, fontWeight: 'bold', color: '#000' },
  guessWarning: { fontSize: 13, color: '#f90', textAlign: 'center', fontWeight: 'bold' },
  infoBox: {
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20
  },
  infoText: { fontSize: 13, color: '#aaa', marginBottom: 4 },
  navContainer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333'
  },
  navButton: {
    flex: 1,
    backgroundColor: '#f90',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center'
  },
  navButtonDisabled: { backgroundColor: '#333', opacity: 0.3 },
  navButtonText: { fontSize: 15, fontWeight: 'bold', color: '#000' },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40
  },
  errorIcon: { fontSize: 80, marginBottom: 20 },
  errorTitle: { fontSize: 22, fontWeight: 'bold', color: '#f90', marginBottom: 15, textAlign: 'center' },
  errorMessage: { fontSize: 15, color: '#aaa', textAlign: 'center', marginBottom: 30, lineHeight: 22 },
  retryButton: {
    backgroundColor: '#0ff',
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12
  },
  retryButtonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  closeErrorButton: {
    backgroundColor: '#333',
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 12
  },
  closeErrorButtonText: { fontSize: 15, color: '#fff' }
});

export default GuessGameScreen;
