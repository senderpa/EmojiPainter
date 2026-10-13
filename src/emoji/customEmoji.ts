/**
 * customEmoji — resolves an emoji grapheme to a bundled custom-emoji image (Material set),
 * and segments a string into text / custom-emoji runs (longest-match against the index).
 *
 * The set + index come from the EmojiKit pack (MultiPaint's CustomEmoji): emoji-index.json maps
 * an emoji string -> "<stem>.webp", and materialAssets.ts maps "<stem>" -> a Metro asset module.
 */
import rawIndex from '../../assets/customEmoji/material/emoji-index.json';
import { MATERIAL_ASSETS } from './generated/materialAssets';

const VS16 = '️'; // emoji variation selector

// char -> stem (strip the .webp the index stores)
const INDEX: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [ch, file] of Object.entries(rawIndex as Record<string, string>)) {
    out[ch] = file.replace(/\.webp$/i, '');
  }
  return out;
})();

/** Longest custom-emoji key length (in JS chars) — bounds the greedy matcher. */
export const MAX_KEY_LEN = Object.keys(INDEX).reduce((m, k) => Math.max(m, k.length), 1);

/** Build a resolver from an arbitrary index (char -> filename) + a base directory of image files.
 *  Used for IMPORTED sets that live as files in Documents (rendered via file:// URIs). */
export function makeFileResolver(index: Record<string, string>, baseDir: string): { resolve: EmojiResolver; maxKeyLen: number } {
  const dir = baseDir.endsWith('/') ? baseDir : baseDir + '/';
  const lookup = (ch: string): string | undefined => {
    if (index[ch]) return index[ch];
    if (ch.endsWith(VS16)) return index[ch.slice(0, -1)];
    return index[ch + VS16];
  };
  const maxKeyLen = Object.keys(index).reduce((m, k) => Math.max(m, k.length), 1);
  const resolve: EmojiResolver = (ch) => {
    const file = lookup(ch);
    return file ? { uri: 'file://' + dir + file } : null;
  };
  return { resolve, maxKeyLen };
}

/** Resolve an emoji grapheme to its stem, trying FE0F-with/without as a fallback. */
function stemFor(ch: string): string | undefined {
  if (INDEX[ch]) return INDEX[ch];
  if (ch.endsWith(VS16)) return INDEX[ch.slice(0, -1)];
  return INDEX[ch + VS16];
}

/** The require()'d asset module for an emoji, or null if this set doesn't have it. */
export function customEmojiSource(ch: string): number | null {
  const stem = stemFor(ch);
  if (!stem) return null;
  return MATERIAL_ASSETS[stem] ?? null;
}

export function hasCustomEmoji(ch: string): boolean {
  return stemFor(ch) != null;
}

/** An image source usable by <Image>: a bundled require() number, or an imported {uri} file. */
export type EmojiSource = number | { uri: string };
/** A resolver maps an emoji grapheme -> its image source (or null if the set lacks it). */
export type EmojiResolver = (ch: string) => EmojiSource | null;

export type EmojiRun = { text: string; source: EmojiSource | null };

/**
 * Split a string into runs. An emoji run carries the resolved image source; text runs carry source=null.
 * Greedy longest-match against the index so multi-codepoint emoji (ZWJ, skin tone, flags, keycaps) match
 * as one unit. Anything not in the set stays in text runs (rendered by the system font as usual).
 */
export function segmentEmoji(str: string, resolve: EmojiResolver = customEmojiSource, maxKeyLen: number = MAX_KEY_LEN): EmojiRun[] {
  const runs: EmojiRun[] = [];
  let textBuf = '';
  let i = 0;
  const n = str.length;
  while (i < n) {
    let matched: { len: number; source: EmojiSource } | null = null;
    // try the longest substring first (down to 1), but only a handful of lengths matter
    const maxLen = Math.min(maxKeyLen, n - i);
    for (let len = maxLen; len >= 1; len -= 1) {
      const sub = str.substr(i, len);
      const src = resolve(sub);
      if (src != null) { matched = { len, source: src }; break; }
    }
    if (matched) {
      if (textBuf) { runs.push({ text: textBuf, source: null }); textBuf = ''; }
      runs.push({ text: str.substr(i, matched.len), source: matched.source });
      i += matched.len;
    } else {
      textBuf += str[i];
      i += 1;
    }
  }
  if (textBuf) runs.push({ text: textBuf, source: null });
  return runs;
}

/** Fast check: does the string contain ANY emoji this set can render? (avoids work for plain text) */
export function stringHasCustomEmoji(str: string, resolve: EmojiResolver = customEmojiSource, maxKeyLen: number = MAX_KEY_LEN): boolean {
  // emoji are non-ASCII; quick reject for pure-ASCII strings
  if (!/[^\x00-\x7f]/.test(str)) return false;
  const n = str.length;
  for (let i = 0; i < n; i += 1) {
    const maxLen = Math.min(maxKeyLen, n - i);
    for (let len = maxLen; len >= 1; len -= 1) {
      if (resolve(str.substr(i, len)) != null) return true;
    }
  }
  return false;
}

export const CUSTOM_EMOJI_COUNT = Object.keys(INDEX).length;
