import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  AppStateStatus,
  BackHandler,
  Easing,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { AppText as Text } from '../../emoji/AppText';
import { emitAppEvent } from '../../lib/appEvents';
import { usePainting } from '../../state/PaintingContext';
import { acceptAgb } from '../../lib/profileTermsConsent';
import { getProfileTermsCopy, PROFILE_TERMS_WEB_URL } from '../../lib/profileTerms';
import * as Localization from 'expo-localization';
import { getDeviceLanguage } from '../info-panel/useInfoPanel';
import { AGB_INTRO_SECTION, INTRO_MEDIA_SEGMENTS, introStepDurationMs, introText, resolveIntroLanguage, resolveIntroVideoSource, resolveReactionVideo, type ReactionKind } from './introMedia';

/** Typed out on the AGB step, in place of the story text. */
const AGB_CONSENT_LINE =
  'Posting to the Live Gallery needs your OK to the AGB and content rules.';

interface Props {
  /** Called ONLY after the user has actually accepted the AGB. */
  onFinish: () => void;
}

/**
 * First-launch intro + AGB gate.
 *
 * This is the app's single AGB checkpoint. It runs before the normal Welcome
 * page and before anything else is reachable, and it does not resolve until the
 * user presses Accept — killing the app mid-intro brings it straight back here
 * on the next launch, because nothing is persisted until acceptance.
 *
 * Structure: the timed media/typewriter segments from `introMedia.ts` (logo or
 * a registered video), then a blocking accept panel with "Read AGB" + "Accept".
 * "Skip" fast-forwards the story, never the gate.
 */
const CinematicIntro: React.FC<Props> = ({ onFinish }) => {
  const { rememberStartupBrush } = usePainting();
  const { width, height } = useWindowDimensions();
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const [readerOpen, setReaderOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const elapsedRef = useRef(0);
  const startedAtRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.88)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const gateOpacity = useRef(new Animated.Value(0)).current;

  /** Narrowed to the 8 UI languages — used for the AGB copy, which only exists in those. */
  const language = useMemo(() => getDeviceLanguage(), []);

  /**
   * ONE language for the entire intro, decided once, from the RAW device locale.
   *
   * Deliberately NOT getDeviceLanguage(): that collapses anything outside the 8 UI languages to
   * English before a nearest-match could be considered, so a Spanish device would never have had
   * the chance to get Italian. resolveIntroLanguage does exact → nearest-related → English.
   */
  const introLanguage = useMemo(() => {
    let rawLocale: string | null = null;
    try {
      const locales = Localization.getLocales?.();
      const primary = locales && locales.length > 0 ? locales[0] : null;
      rawLocale = primary?.languageTag ?? primary?.languageCode ?? null;
    } catch {
      rawLocale = null;
    }
    return resolveIntroLanguage(rawLocale ?? language);
  }, [language]);
  const terms = useMemo(() => getProfileTermsCopy(language), [language]);

  /** True once the timed segments are done and only the AGB panel remains. */
  const gateVisible = phase >= INTRO_MEDIA_SEGMENTS.length;
  const gateVisibleRef = useRef(gateVisible);
  gateVisibleRef.current = gateVisible;

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    rememberStartupBrush('🎨');
    emitAppEvent('startup:closing');
    Animated.parallel([
      Animated.timing(textOpacity, { toValue: 0, duration: reducedMotion ? 0 : 350, useNativeDriver: true }),
      Animated.timing(gateOpacity, { toValue: 0, duration: reducedMotion ? 0 : 350, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 0, duration: reducedMotion ? 0 : 550, useNativeDriver: true }),
    ]).start(() => { emitAppEvent('startup:hidden'); onFinish(); });
  }, [gateOpacity, logoOpacity, onFinish, reducedMotion, rememberStartupBrush, textOpacity]);

  const handleAccept = useCallback(async () => {
    if (accepting || finishedRef.current) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      // Persist FIRST. The intro only counts as completed once the flag is
      // durably written — a failed write must leave the gate up.
      await acceptAgb();
      finish();
    } catch (error) {
      console.warn('[AGB] Could not save acceptance:', error);
      setAcceptError('Your acceptance could not be saved. Please try again.');
      setAccepting(false);
    }
  }, [accepting, finish]);

  const openTermsOnline = useCallback(async () => {
    try {
      await Linking.openURL(PROFILE_TERMS_WEB_URL);
    } catch (error) {
      console.warn('[AGB] Could not open online terms:', error);
      setAcceptError('The online policy could not be opened.');
    }
  }, []);

  /**
   * REACTION PLAYBACK — the character answering a skip or a poke.
   *
   * While a reaction plays: the story clip is paused, the typewriter is cleared, and the step
   * timer is cancelled, so the interruption is total rather than two voices overlapping. When it
   * finishes we resume the same step (stages 1-2) or drop straight to the AGB gate (stage 3).
   *
   * Counters live in refs, not state: they must survive the re-render the reaction itself causes,
   * and nothing renders from them directly.
   */
  const [reaction, setReaction] = useState<{ kind: ReactionKind; stage: number } | null>(null);
  const skipCountRef = useRef(0);
  const clickCountRef = useRef(0);

  const endReaction = useCallback((kind: ReactionKind, stage: number) => {
    setReaction(null);
    if (stage >= 3) {
      // "Enough is enough" — go straight to the accept step for either ladder.
      if (timerRef.current) clearTimeout(timerRef.current);
      setPhase(INTRO_MEDIA_SEGMENTS.length);
      return;
    }
    // Re-enter the current step so its timer, typing and clip all restart cleanly.
    setPhase((value) => value);
    setReplayToken((value) => value + 1);
  }, []);

  /** Bumped to force the step effect to re-run after a reaction without changing `phase`. */
  const [replayToken, setReplayToken] = useState(0);

  /**
   * Returns true if a reaction was started. Callers fall back to their normal behaviour when
   * false, which is what makes the whole feature inert until clips are actually shipped.
   */
  const tryPlayReaction = useCallback((kind: ReactionKind): boolean => {
    if (reaction || finishedRef.current || gateVisibleRef.current) {
      return false;
    }
    const counter = kind === 'skip' ? skipCountRef : clickCountRef;
    const stage = Math.min(3, counter.current + 1);
    if (!resolveReactionVideo(kind, stage, introLanguage)) {
      return false;
    }
    counter.current = stage;
    if (timerRef.current) clearTimeout(timerRef.current);
    setTyped('');
    setReaction({ kind, stage });
    return true;
  }, [introLanguage, reaction]);

  /** Skip the story, never the gate — always lands on the AGB step. */
  const skipToGate = useCallback(() => {
    // 1st/2nd skip get a reaction clip instead of skipping; the 3rd (or any skip once the clips
    // are exhausted / not shipped) behaves exactly as it always did.
    if (tryPlayReaction('skip')) {
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase(INTRO_MEDIA_SEGMENTS.length);
  }, [tryPlayReaction]);

  /**
   * Advance ONE segment. Cancels the running auto-advance timer first, otherwise
   * that timer would fire on top of the manual step and skip two at once. The
   * phase effect re-arms a fresh timer for whichever segment we land on, and
   * stepping past the last one lands on the AGB step exactly like Skip does.
   */
  const nextSegment = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase((value) => Math.min(value + 1, INTRO_MEDIA_SEGMENTS.length));
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    emitAppEvent('startup:shown');
    return () => sub.remove();
  }, []);

  // Android back must not dismiss the gate.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (readerOpen) { setReaderOpen(false); return true; }
      return true; // swallow — the intro is not dismissible
    });
    return () => sub.remove();
  }, [readerOpen]);

  useEffect(() => {
    if (finishedRef.current) return undefined;
    // A reaction owns the screen while it plays — no step timer, no typing underneath it.
    if (reaction) return undefined;
    const segment = INTRO_MEDIA_SEGMENTS[phase];
    if (!appActive) return undefined;
    setTyped('');

    // Out of segments → the AGB step. It is the SAME screen (logo + typewriter),
    // not a separate overlay: the consent line simply types itself out where the
    // story text was, and two small buttons fade in under it. This does NOT
    // finish the intro — that only happens once the user accepts.
    if (!segment) {
      const message = introText('agbConsent', introLanguage) || AGB_CONSENT_LINE;
      const typeMs = reducedMotion ? 0 : 28;
      let gateIndex = 0;
      const gateTimer = setInterval(() => {
        gateIndex += 1;
        setTyped(message.slice(0, gateIndex));
        if (gateIndex >= message.length) clearInterval(gateTimer);
      }, typeMs || 1);
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1, duration: reducedMotion ? 0 : 500, useNativeDriver: true }),
        Animated.timing(textOpacity, { toValue: 1, duration: reducedMotion ? 0 : 400, useNativeDriver: true }),
        Animated.timing(gateOpacity, {
          toValue: 1,
          duration: reducedMotion ? 0 : 420,
          delay: reducedMotion ? 0 : 500,
          useNativeDriver: true,
        }),
      ]).start();
      return () => clearInterval(gateTimer);
    }

    // Localized to the SAME language the clip speaks — see resolveIntroLanguage.
    const message = introText(segment.textKey, introLanguage);
    const paceMs = introStepDurationMs(segment.mediaAssetName, introLanguage, segment.durationMs);
    // Type across ~55% of the clip so the line is complete well before the voice finishes.
    const typeMs = reducedMotion ? 0 : Math.max(18, Math.floor(paceMs * 0.55 / Math.max(1, message.length)));
    let index = 0;
    const typeTimer = setInterval(() => {
      index += 1;
      setTyped(message.slice(0, index));
      if (index >= message.length) clearInterval(typeTimer);
    }, typeMs || 1);
    Animated.parallel([
      Animated.timing(logoOpacity, { toValue: 1, duration: reducedMotion ? 0 : 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(logoScale, { toValue: 1, duration: reducedMotion ? 0 : 1600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(textOpacity, { toValue: 1, duration: reducedMotion ? 0 : 700, delay: reducedMotion ? 0 : 350, useNativeDriver: true }),
    ]).start();
    // Real clip length, not the authored guess — see introStepDurationMs.
    const stepMs = introStepDurationMs(segment.mediaAssetName, introLanguage, segment.durationMs);
    timerRef.current = setTimeout(() => setPhase((value) => value + 1), stepMs);
    return () => { clearInterval(typeTimer); if (timerRef.current) clearTimeout(timerRef.current); };
  }, [appActive, gateOpacity, introLanguage, logoOpacity, logoScale, phase, reaction, reducedMotion, replayToken, textOpacity]);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        setAppActive(false);
        elapsedRef.current += Date.now() - startedAtRef.current;
        if (timerRef.current) clearTimeout(timerRef.current);
      } else if (next === 'active' && !finishedRef.current) {
        setAppActive(true);
        startedAtRef.current = Date.now();
        // Re-rendering the same phase restarts its remaining timer and avoids a
        // duplicated welcome overlay after an interruption.
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, []);

  const mediaSize = Math.min(width * 0.48, height * 0.32);
  /**
   * Clip for the current step in the DEVICE's language (falls back to English, then to the logo).
   * The AGB step is not one of the timed segments, so it names its own section explicitly —
   * otherwise the accept panel would sit on a blank frame.
   */
  const videoSection = gateVisible ? AGB_INTRO_SECTION : INTRO_MEDIA_SEGMENTS[phase]?.mediaAssetName;
  const videoSource = resolveIntroVideoSource(videoSection, introLanguage);
  /** While a reaction plays it takes over the frame entirely. */
  const reactionSource = reaction ? resolveReactionVideo(reaction.kind, reaction.stage, introLanguage) : null;
  /** Identity of the clip on screen — drives the <Video> remount so each step really plays. */
  const videoKey = `${videoSection ?? 'logo'}-${introLanguage}`;

  /**
   * SEAMLESS HANDOVER. Remounting a player leaves a black frame while the next file opens, which
   * is the flash between steps. So the NEXT clip is mounted invisibly one step ahead: by the time
   * it becomes the visible one it is already decoded and its first frame is ready.
   *
   * The still logo underneath means even a slow decode reveals artwork rather than black.
   */
  const nextSection = gateVisible
    ? null
    : (INTRO_MEDIA_SEGMENTS[phase + 1]?.mediaAssetName ?? AGB_INTRO_SECTION);
  const nextSource = resolveIntroVideoSource(nextSection, introLanguage);
  const nextKey = `${nextSection ?? 'none'}-${introLanguage}`;

  return (
    <View style={styles.overlay} accessible accessibilityLabel="Emoji Painter introduction">
      <View style={[styles.glow, { width: width * 0.9, height: width * 0.9, borderRadius: width * 0.45 }]} />

      {!readerOpen && (
        <>
          <Animated.View
            style={[styles.logoWrap, { transform: [{ scale: logoScale }], opacity: logoOpacity }]}
            accessible
            accessibilityLabel={INTRO_MEDIA_SEGMENTS[phase]?.accessibilityDescription ?? 'Emoji Painter logo'}
          >
            {/* GAP FILLER = the NEXT clip's first frame, not the app icon.
                Rendered full-size underneath and paused at frame 0, so whatever moment the
                current player is swapped out, what shows through is the opening frame of the
                clip that is about to play — a continuation rather than a logo flash. Falls back
                to the icon only when there is no next clip (the final step). */}
            {videoSource && nextSource ? (
              <Video
                key={`preload-${nextKey}`}
                source={nextSource}
                style={{ position: 'absolute', width: mediaSize, height: mediaSize }}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay={false}
                isMuted
              />
            ) : videoSource ? (
              <Image
                source={require('../../../assets/icon.png')}
                style={{ position: 'absolute', width: mediaSize, height: mediaSize }}
                resizeMode="contain"
              />
            ) : null}
            {reactionSource ? (
              <Video
                key={`reaction-${reaction?.kind}-${reaction?.stage}-${introLanguage}`}
                source={reactionSource}
                // Absolutely positioned over the SAME box as the story clip. As a normal sibling
                // it added its own height and the character visibly jumped position whenever a
                // skip/click reaction played.
                style={{ position: 'absolute', width: mediaSize, height: mediaSize, zIndex: 2 }}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping={false}
                isMuted={false}
                onPlaybackStatusUpdate={(status) => {
                  if (status.isLoaded && status.didJustFinish && reaction) {
                    endReaction(reaction.kind, reaction.stage);
                  }
                }}
                onError={() => { if (reaction) endReaction(reaction.kind, reaction.stage); }}
              />
            ) : null}
            {videoSource ? (
              <Video
                // REMOUNT PER STEP. Handing a mounted expo-av <Video> a new `source` does not
                // reliably reload it — the first clip played and every later one stayed on the
                // finished first frame. A key tied to the step forces a fresh player each time,
                // which is the only thing that makes step 2..n actually play.
                key={`intro-${videoKey}`}
                source={videoSource}
                style={{ width: mediaSize, height: mediaSize }}
                resizeMode={ResizeMode.CONTAIN}
                // Paused (not unmounted) under a reaction so returning to the step is instant.
                shouldPlay={!reaction}
                // Narrated per-language clips: the spoken track IS the localisation, so never
                // muted. Not looped — each step auto-advances on its own timer and a restart
                // mid-sentence reads as a glitch.
                isLooping={false}
                isMuted={Boolean(reaction)}
                onError={(e) => console.warn('[Intro] video failed', videoKey, e)}
              />
            ) : (
              <Image
                source={require('../../../assets/icon.png')}
                style={{ width: mediaSize, height: mediaSize }}
                resizeMode="contain"
              />
            )}
            {/* LAST child = on top of the video, so the tap actually reaches it. Poking the
                character runs the click ladder; with no reaction clips shipped tryPlayReaction
                returns false and this is inert. */}
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => { void tryPlayReaction('click'); }}
              accessibilityRole="button"
              accessibilityLabel="Emoji Painter character"
            />
          </Animated.View>
          <Animated.View style={[styles.textFrame, { opacity: textOpacity }]}>
            {/* GHOST LINE. During a reaction the typed text is cleared, but the frame must keep
                the exact height it had — otherwise the character above visibly shifts up and
                back down around every skip/click. Two lines of nbsp reserve that space so the
                layout is identical whether text is showing or not. */}
            <Text style={styles.introText}>{typed || '\u00A0\n\u00A0'}</Text>
          </Animated.View>
          {!gateVisible && (
            <>
              <TouchableOpacity
                style={styles.next}
                onPress={nextSegment}
                accessibilityRole="button"
                accessibilityLabel="Next step"
              >
                <Text style={styles.skipText}>Next ›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.skip} onPress={skipToGate} accessibilityRole="button" accessibilityLabel="Skip introduction">
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {gateVisible && !readerOpen && (
        <Animated.View style={[styles.gateActions, { opacity: gateOpacity }]}>
          {acceptError ? <Text style={styles.gateError}>{acceptError}</Text> : null}
          <View style={styles.gateButtonRow}>
            <TouchableOpacity
              style={styles.readButton}
              onPress={() => setReaderOpen(true)}
              disabled={accepting}
              accessibilityRole="button"
              accessibilityLabel={terms.openReaderLabel}
            >
              <Text style={styles.readButtonText}>Read AGB</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.acceptButton, accepting && styles.disabled]}
              onPress={() => void handleAccept()}
              disabled={accepting}
              accessibilityRole="button"
              accessibilityLabel={terms.acceptLabel}
            >
              {accepting
                ? <ActivityIndicator color="#0b0b0b" />
                : <Text style={styles.acceptButtonText}>Accept</Text>}
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {readerOpen && (
        <View style={styles.reader}>
          <Text style={styles.gateTitle}>{terms.title}</Text>
          <ScrollView style={styles.readerScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.gateBody}>{terms.intro}</Text>
            {terms.sections.map((section, index) => (
              <View key={`${section.heading}-${index}`} style={styles.readerSection}>
                <Text style={styles.readerHeading}>{section.heading}</Text>
                {section.body.map((paragraph, paragraphIndex) => (
                  <Text key={`${index}-${paragraphIndex}`} style={styles.readerBody}>{paragraph}</Text>
                ))}
              </View>
            ))}
            <TouchableOpacity onPress={() => void openTermsOnline()} accessibilityRole="link">
              <Text style={styles.readerLink}>{terms.openReaderLabel} on emojipainter.com ↗</Text>
            </TouchableOpacity>
          </ScrollView>
          <TouchableOpacity
            style={styles.readButton}
            onPress={() => setReaderOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Back to the introduction"
          >
            <Text style={styles.readButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, backgroundColor: '#08090f', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  glow: { position: 'absolute', backgroundColor: 'rgba(116,106,255,0.08)', shadowColor: '#9fa6ff', shadowOpacity: 0.42, shadowRadius: 90 },
  logoWrap: { alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  textFrame: { width: '88%', minHeight: 68, maxHeight: 68, alignItems: 'center', justifyContent: 'center', marginTop: 22, overflow: 'hidden' },
  introText: { color: '#fff', fontSize: 20, lineHeight: 30, textAlign: 'center', letterSpacing: 0.3 },
  skip: { position: 'absolute', right: 22, bottom: 28, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  // Next sits opposite Skip so a step can be advanced without ending the story.
  next: { position: 'absolute', left: 22, bottom: 28, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  skipText: { color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '700' },

  // Inline action row: sits under the typewriter line on the SAME intro screen.
  gateActions: { marginTop: 18, alignItems: 'center', zIndex: 2 },
  gateButtonRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  gateTitle: { color: '#fff', fontSize: 19, fontWeight: '900', textAlign: 'center', marginBottom: 10 },
  gateBody: { color: '#c4c4c4', fontSize: 13, lineHeight: 20 },
  gateError: { color: '#ff9a9a', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  // Full reader sheet — only for actually reading the document.
  reader: { width: '90%', maxWidth: 560, maxHeight: '86%', zIndex: 3 },
  readerScroll: { flexGrow: 0 },
  readerSection: { marginTop: 14 },
  readerHeading: { color: '#fff', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  readerBody: { color: '#9d9d9d', fontSize: 12, lineHeight: 18, marginBottom: 5 },
  readerLink: { color: '#8fdcff', fontSize: 12, fontWeight: '800', marginTop: 14, marginBottom: 6 },
  readButton: { minHeight: 44, minWidth: 110, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(143,220,255,0.45)' },
  readButtonText: { color: '#8fdcff', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  acceptButton: { minHeight: 44, minWidth: 130, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, backgroundColor: '#ff9f6b', borderRadius: 12 },
  acceptButtonText: { color: '#0b0b0b', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.6 },
});

export default CinematicIntro;
