/**
 * AppText — a drop-in replacement for react-native <Text> that renders emoji from the selected custom
 * set (inline images) when the user picks a non-Apple set. With the 'apple' set (default) it is a pure
 * passthrough to RN Text, so behavior is unchanged.
 *
 * SAFETY NET (critical) — the app must NEVER show empty buttons / blank emoji:
 *   • the SYSTEM (Apple) glyph renders INSTANTLY as the base, always,
 *   • the custom image only SWAPS IN once it has actually loaded/decoded (onLoad) — so there is
 *     never a blank "loading" gap, even while a whole custom set is decoding,
 *   • if a custom image fails (onError) we keep the system glyph,
 *   • tap-to-reveal hides the custom layer and shows the normal glyph (little fade).
 *
 * AppEmoji renders a single emoji as standalone art (system glyph base + custom overlay that fades in).
 */
import React, { useState, useEffect } from 'react';
import {
  Text as RNText, Image, View, StyleSheet,
  type TextProps, type StyleProp, type TextStyle
} from 'react-native';
import { useEmojiSet } from './EmojiSetContext';
import { useReveal } from './RevealContext';
import { segmentEmoji, stringHasCustomEmoji, type EmojiSource } from './customEmoji';

function childrenToString(children: React.ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children) && children.every((c) => typeof c === 'string' || typeof c === 'number')) {
    return (children as Array<string | number>).join('');
  }
  return null;
}

function fontSizeOf(style: StyleProp<TextStyle>): number {
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  return typeof flat.fontSize === 'number' ? flat.fontSize : 16;
}

function srcKey(s: EmojiSource): string {
  return typeof s === 'number' ? 'n' + s : s.uri;
}

export const AppText = React.forwardRef<RNText, TextProps & { children?: React.ReactNode }>(
  ({ children, style, ...rest }, ref) => {
    const { resolve, maxKeyLen } = useEmojiSet();
    const revealing = useReveal();
    // per-source-key load state, so the system glyph shows until the custom image is ready.
    const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
    const [failed, setFailed] = useState<Set<string>>(() => new Set());
    const str = childrenToString(children);

    // Passthrough (system glyphs) when revealing, not a plain string, or no custom emoji present.
    if (revealing || str == null || !stringHasCustomEmoji(str, resolve, maxKeyLen)) {
      return <RNText ref={ref} style={style} {...rest}>{children}</RNText>;
    }
    const size = fontSizeOf(style);
    const dim = Math.round(size * 1.15);
    const runs = segmentEmoji(str, resolve, maxKeyLen);
    const mark = (set: typeof setLoaded, k: string) =>
      set((s) => (s.has(k) ? s : new Set(s).add(k)));

    return (
      <RNText ref={ref} style={style} {...rest}>
        {runs.map((r, i) => {
          if (r.source == null) return r.text; // plain text run
          const k = srcKey(r.source);
          if (failed.has(k)) return r.text; // broken custom glyph → system glyph
          if (loaded.has(k)) {
            // custom image is decoded → show it
            return (
              <Image key={i} source={r.source} style={{ width: dim, height: dim }}
                onError={() => mark(setFailed, k)} />
            );
          }
          // NOT yet loaded → show the system glyph NOW + an invisible 0-size loader that
          // flips this glyph to the custom image once it finishes decoding. Never blank.
          return (
            <RNText key={i}>
              {r.text}
              <Image source={r.source} style={{ width: 0, height: 0 }}
                onLoad={() => mark(setLoaded, k)} onError={() => mark(setFailed, k)} />
            </RNText>
          );
        })}
      </RNText>
    );
  }
);
AppText.displayName = 'AppText';

export const AppEmoji: React.FC<{ char: string; size?: number; style?: StyleProp<TextStyle> }> = ({
  char,
  size = 24,
  style
}) => {
  const { resolve } = useEmojiSet();
  const revealing = useReveal();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [char]);

  const src = revealing || failed ? null : resolve(char);
  if (src != null) {
    // System glyph is the always-present base; the custom image fades in on top ONLY once loaded.
    return (
      <View style={{ width: size, height: size }}>
        <RNText style={[styles.glyphBase, { fontSize: size }, style]}>{char}</RNText>
        <Image
          source={src}
          style={[styles.glyphOverlay, !loaded && styles.hidden]}
          fadeDuration={140}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }
  return <RNText style={[{ fontSize: size }, style]}>{char}</RNText>;
};

const styles = StyleSheet.create({
  glyphBase: { position: 'absolute', left: 0, top: 0 },
  glyphOverlay: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  hidden: { opacity: 0 }
});

export default AppText;
