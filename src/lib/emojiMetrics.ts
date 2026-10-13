import { listFontFamilies, matchFont, Skia } from '@shopify/react-native-skia';

const PREFERRED_FONT_FAMILIES = [
  'Apple Color Emoji',
  'AppleColorEmoji',
  'Noto Color Emoji',
  'NotoColorEmoji',
  'Segoe UI Emoji',
  'SegoeUIEmoji',
  'SamsungColorEmoji',
  'TwemojiMozilla',
  'EmojiOne Color',
  'EmojiOneColor',
  'System Emoji',
  'SystemEmoji',
  'System',
  'sans-serif'
] as const;

const fontManager = Skia.FontMgr.System();
const availableFamilies = new Set(listFontFamilies(fontManager));

type FontInfo = {
  font: ReturnType<typeof matchFont>;
  metricsHeight: number;
  widthCache: Map<string, number>;
};

const fontCache = new Map<number, FontInfo>();

const resolveFontInfo = (size: number): FontInfo => {
  const normalizedSize = Math.max(1, Math.round(size));
  const cached = fontCache.get(normalizedSize);
  if (cached) {
    return cached;
  }

  let resolved: ReturnType<typeof matchFont> | null = null;
  for (const family of PREFERRED_FONT_FAMILIES) {
    if (!availableFamilies.has(family)) {
      continue;
    }
    try {
      const candidate = matchFont({ fontFamily: family, fontSize: normalizedSize }, fontManager);
      resolved = candidate ?? resolved;
      if (resolved) {
        break;
      }
    } catch {
      // ignore and try next
    }
  }

  if (!resolved) {
    resolved = matchFont({ fontSize: normalizedSize }, fontManager) ?? null;
  }

  if (!resolved) {
    throw new Error('Unable to resolve emoji font.');
  }

  const font = resolved;
  const metrics = font.getMetrics();
  const metricsHeight = Math.abs(metrics.ascent) + Math.abs(metrics.descent);
  const info: FontInfo = {
    font,
    metricsHeight: metricsHeight > 0 ? metricsHeight : font.getSize(),
    widthCache: new Map()
  };
  fontCache.set(normalizedSize, info);
  return info;
};

const computeGlyphWidth = (info: FontInfo, value: string): number => {
  const cached = info.widthCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const glyphIds = info.font.getGlyphIDs(value);
  const glyphWidths = info.font.getGlyphWidths(glyphIds);
  let total = 0;
  for (let i = 0; i < glyphWidths.length; i += 1) {
    const width = glyphWidths[i];
    if (typeof width === 'number' && Number.isFinite(width)) {
      total += width;
    }
  }
  if (!Number.isFinite(total) || total <= 0) {
    total = info.font.getSize();
  }
  info.widthCache.set(value, total);
  return total;
};

export const measureEmojiSpan = (emoji: string, size: number): number => {
  if (!emoji || size <= 0) {
    return Math.max(1, size);
  }
  // Custom brushes use PNGs; treat them as square stamps instead of text glyphs.
  if (emoji.startsWith('custom_brush_') || emoji.startsWith('data:image/png;base64,')) {
    return Math.max(1, size);
  }
  try {
    const fontInfo = resolveFontInfo(size);
    const width = computeGlyphWidth(fontInfo, emoji);
    const span = Math.max(width, fontInfo.metricsHeight, fontInfo.font.getSize());
    return span;
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    console.warn('measureEmojiSpan failed', reason);
    return Math.max(1, size);
  }
};

export const measureSequenceSpan = (sequence: string[], size: number): number => {
  if (!sequence.length) {
    return measureEmojiSpan('', size);
  }
  let maxSpan = 0;
  sequence.forEach((emoji) => {
    const span = measureEmojiSpan(emoji, size);
    if (span > maxSpan) {
      maxSpan = span;
    }
  });
  return maxSpan;
};
