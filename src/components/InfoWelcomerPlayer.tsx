import AsyncStorage from '@react-native-async-storage/async-storage';
import { ResizeMode, Video } from 'expo-av';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Image, TouchableOpacity, View } from 'react-native';

import { AppText as Text } from '../emoji/AppText';
import {
  INFO_PUNCH_LANGUAGES,
  INFO_WELCOME_LANGUAGES,
  type InfoPunchLanguage,
  type InfoPunchStage,
  type InfoWelcomeLanguage,
  infoPunchPosterSource,
  infoPunchStageIsReady,
  infoPunchVideoSource,
  infoWelcomePosterSource,
  infoWelcomeVideoSource,
} from '../features/info-panel/infoWelcomerMedia';
import {
  INFO_WELCOMER_COOLDOWN_MS,
  acceptInfoWelcomerHit,
  shuffledInfoWelcomerDeck,
} from '../features/info-panel/infoWelcomerPolicy';

const INFO_WELCOMER_KILLED_KEY = '@emojipaint/info-welcomer-killed-v1';

type PlayerMode = 'welcome' | 'punch' | 'dead';

interface MediaSelection {
  key: string;
  source: number;
  poster: number;
}

interface InfoWelcomerPlayerProps {
  infoVisible: boolean;
  inViewport: boolean;
}

export default function InfoWelcomerPlayer({
  infoVisible,
  inViewport,
}: InfoWelcomerPlayerProps): React.ReactElement {
  const videoRef = React.useRef<Video | null>(null);
  const welcomeDeckRef = React.useRef<InfoWelcomeLanguage[]>([]);
  const lastWelcomeLanguageRef = React.useRef<InfoWelcomeLanguage | null>(null);
  const punchDecksRef = React.useRef<Partial<Record<InfoPunchStage, InfoPunchLanguage[]>>>({});
  const totalHitsRef = React.useRef(0);
  const cooldownTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeathRef = React.useRef(false);
  const clipFinishedRef = React.useRef(false);
  const mediaSequenceRef = React.useRef(0);
  const modeRef = React.useRef<PlayerMode>('welcome');

  const [hydrated, setHydrated] = React.useState(false);
  const [killed, setKilled] = React.useState(false);
  const [selection, setSelection] = React.useState<MediaSelection | null>(null);
  const [readyMediaKey, setReadyMediaKey] = React.useState<string | null>(null);
  const [totalHits, setTotalHits] = React.useState(0);

  const active = infoVisible && inViewport;

  const clearCooldown = React.useCallback(() => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  }, []);

  const nextWelcomeSelection = React.useCallback((): MediaSelection => {
    if (welcomeDeckRef.current.length === 0) {
      welcomeDeckRef.current = shuffledInfoWelcomerDeck(INFO_WELCOME_LANGUAGES);
    }

    let language = welcomeDeckRef.current.pop() ?? 'en';
    if (language === lastWelcomeLanguageRef.current && welcomeDeckRef.current.length > 0) {
      const replacement = welcomeDeckRef.current.pop()!;
      welcomeDeckRef.current.unshift(language);
      language = replacement;
    }
    lastWelcomeLanguageRef.current = language;
    mediaSequenceRef.current += 1;
    return {
      key: `welcome-${language}-${mediaSequenceRef.current}`,
      source: infoWelcomeVideoSource(language),
      poster: infoWelcomePosterSource(language),
    };
  }, []);

  const resetSession = React.useCallback((loadWelcome: boolean) => {
    clearCooldown();
    pendingDeathRef.current = false;
    clipFinishedRef.current = false;
    totalHitsRef.current = 0;
    punchDecksRef.current = {};
    setTotalHits(0);
    setReadyMediaKey(null);
    if (killed) {
      modeRef.current = 'dead';
      setSelection(loadWelcome ? {
        key: `dead-${mediaSequenceRef.current += 1}`,
        source: infoWelcomeVideoSource('en'),
        poster: infoWelcomePosterSource('en'),
      } : null);
      return;
    }
    modeRef.current = 'welcome';
    setSelection(loadWelcome ? nextWelcomeSelection() : null);
  }, [clearCooldown, killed, nextWelcomeSelection]);

  const markPermanentlyKilled = React.useCallback(() => {
    clearCooldown();
    pendingDeathRef.current = false;
    clipFinishedRef.current = true;
    setKilled(true);
    modeRef.current = 'dead';
    setTotalHits(0);
    totalHitsRef.current = 0;
    setReadyMediaKey(null);
    mediaSequenceRef.current += 1;
    setSelection({
      key: `dead-${mediaSequenceRef.current}`,
      source: infoWelcomeVideoSource('en'),
      poster: infoWelcomePosterSource('en'),
    });
    AsyncStorage.setItem(INFO_WELCOMER_KILLED_KEY, '1').catch(() => undefined);
  }, [clearCooldown]);

  React.useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(INFO_WELCOMER_KILLED_KEY)
      .then((stored) => {
        if (cancelled) return;
        const wasKilled = stored === '1';
        setKilled(wasKilled);
        modeRef.current = wasKilled ? 'dead' : 'welcome';
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
      clearCooldown();
    };
  }, [clearCooldown]);

  React.useEffect(() => {
    if (!hydrated) return;
    if (!infoVisible) {
      videoRef.current?.pauseAsync().catch(() => undefined);
      videoRef.current?.setPositionAsync(0).catch(() => undefined);
      resetSession(false);
      return;
    }
    if (inViewport && !selection) {
      resetSession(true);
    }
  }, [hydrated, infoVisible, inViewport, resetSession, selection]);

  React.useEffect(() => {
    if (!selection) return;
    if (!active || killed || clipFinishedRef.current) {
      videoRef.current?.pauseAsync().catch(() => undefined);
      return;
    }
    videoRef.current?.playAsync().catch(() => undefined);
  }, [active, killed, selection]);

  const scheduleCooldown = React.useCallback(() => {
    clearCooldown();
    cooldownTimerRef.current = setTimeout(() => {
      cooldownTimerRef.current = null;
      // Clear the loaded escalation source first. If the card is still visible,
      // the viewport effect immediately starts a fresh welcome-language deck;
      // if it is off-screen, no replacement video is loaded yet.
      resetSession(false);
    }, INFO_WELCOMER_COOLDOWN_MS);
  }, [clearCooldown, resetSession]);

  const nextPunchSelection = React.useCallback((stage: InfoPunchStage): MediaSelection | null => {
    if (!infoPunchStageIsReady(stage)) return null;
    let deck = punchDecksRef.current[stage];
    if (!deck || deck.length === 0) {
      deck = shuffledInfoWelcomerDeck(INFO_PUNCH_LANGUAGES);
      punchDecksRef.current[stage] = deck;
    }
    const language = deck.pop();
    if (!language) return null;
    const source = infoPunchVideoSource(stage, language);
    const poster = infoPunchPosterSource(stage, language);
    if (!source || !poster) return null;
    mediaSequenceRef.current += 1;
    return { key: `punch-${stage}-${language}-${mediaSequenceRef.current}`, source, poster };
  }, []);

  const handlePress = React.useCallback(() => {
    if (!active || killed || !hydrated || pendingDeathRef.current) return;

    const progress = acceptInfoWelcomerHit(totalHitsRef.current);
    const stage = progress.stage as InfoPunchStage;
    const nextSelection = nextPunchSelection(stage);
    // Unfinished or partially delivered stages never consume hits and can
    // therefore never trigger the permanent completion flag by accident.
    if (!nextSelection) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
    totalHitsRef.current = progress.totalHits;
    setTotalHits(progress.totalHits);
    modeRef.current = 'punch';
    setReadyMediaKey(null);
    clipFinishedRef.current = false;
    pendingDeathRef.current = progress.completed;
    setSelection(nextSelection);
    if (progress.completed) {
      clearCooldown();
    } else {
      scheduleCooldown();
    }
  }, [active, clearCooldown, hydrated, killed, nextPunchSelection, scheduleCooldown]);

  const handlePlaybackStatus = React.useCallback((status: any) => {
    if (!status?.isLoaded || !status.didJustFinish) return;
    if (pendingDeathRef.current) {
      markPermanentlyKilled();
      return;
    }
    if (modeRef.current === 'welcome') {
      clipFinishedRef.current = false;
      setReadyMediaKey(null);
      setSelection(nextWelcomeSelection());
      return;
    }
    clipFinishedRef.current = true;
    videoRef.current?.setPositionAsync(0).catch(() => undefined);
    videoRef.current?.pauseAsync().catch(() => undefined);
  }, [markPermanentlyKilled, nextWelcomeSelection]);

  return (
    <View style={{ marginHorizontal: 18, marginBottom: 50 }}>
      <View style={{ backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: killed ? '#ff3b30' : '#ff9f0a', padding: 12 }}>
        <View style={{ height: 28, justifyContent: 'center', marginBottom: 6 }}>
          {killed ? (
            <Text style={{ color: '#ff3b30', fontSize: 22, fontWeight: '800', fontFamily: 'vrtlfinal', textAlign: 'center' }}>
              KILLED
            </Text>
          ) : null}
          <Text style={{ position: 'absolute', right: 2, color: totalHits > 0 ? '#ff9f0a' : '#777', fontSize: 13, fontWeight: '800', fontFamily: 'vrtlfinal' }}>
            {totalHits}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handlePress}
          disabled={!active || killed}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel={killed ? 'Welcomer killed' : 'Play next welcomer reaction'}
        >
          <View style={{ width: '100%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' }}>
            {selection ? (
              <>
                <Image
                  source={selection.poster}
                  style={{ position: 'absolute', width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
                <Video
                  key={selection.key}
                  ref={(node) => { videoRef.current = node; }}
                  source={selection.source}
                  style={{ position: 'absolute', width: '100%', height: '100%', opacity: readyMediaKey === selection.key ? 1 : 0 }}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  isLooping={false}
                  useNativeControls={false}
                  onLoad={() => {
                    clipFinishedRef.current = false;
                    videoRef.current?.setPositionAsync(0).catch(() => undefined);
                  }}
                  onReadyForDisplay={() => {
                    setReadyMediaKey(selection.key);
                    if (killed) {
                      videoRef.current?.pauseAsync().catch(() => undefined);
                    } else if (active) {
                      videoRef.current?.playAsync().catch(() => undefined);
                    }
                  }}
                  onPlaybackStatusUpdate={handlePlaybackStatus}
                  onError={() => {
                    // A missing/corrupt final clip must never create the durable
                    // dead state: completion means every last clip really played.
                    pendingDeathRef.current = false;
                    resetSession(active);
                  }}
                />
              </>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Image source={require('../../assets/icon.png')} style={{ width: '72%', height: '72%', opacity: 0.34 }} resizeMode="contain" />
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}
