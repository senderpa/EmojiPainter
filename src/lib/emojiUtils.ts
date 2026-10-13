const SEGMENTER_FACTORY = (typeof Intl !== 'undefined'
  ? (Intl as unknown as { Segmenter?: new (locales?: string | string[], options?: Intl.SegmenterOptions) => Intl.Segmenter }).Segmenter
  : undefined) ?? null;

const graphemeSegmenter = SEGMENTER_FACTORY ? new SEGMENTER_FACTORY('en', { granularity: 'grapheme' }) : null;
const VARIATION_SELECTOR_REGEX = /[\uFE0E\uFE0F]/g;
const REGIONAL_INDICATOR_START = 0x1f1e6;
const REGIONAL_INDICATOR_END = 0x1f1ff;
const ZWJ = '\u200d';

const isRegionalIndicator = (codePoint: number): boolean =>
  codePoint >= REGIONAL_INDICATOR_START && codePoint <= REGIONAL_INDICATOR_END;

export function isSingleEmojiGlyph(value: string): boolean {
  if (!value) {
    return false;
  }

  if (graphemeSegmenter) {
    let count = 0;
    for (const _ of graphemeSegmenter.segment(value)) {
      count += 1;
      if (count > 1) {
        return false;
      }
    }
    return count === 1;
  }

  const sanitized = value.replace(VARIATION_SELECTOR_REGEX, '');
  if (!sanitized) {
    return false;
  }
  if (sanitized.includes(ZWJ)) {
    const parts = sanitized.split(ZWJ).filter(Boolean);
    return parts.length > 0;
  }
  const codePoints = Array.from(sanitized);
  if (codePoints.length === 2) {
    const [a, b] = codePoints.map((entry) => entry.codePointAt(0) ?? 0);
    if (isRegionalIndicator(a) && isRegionalIndicator(b)) {
      return true;
    }
  }
  return codePoints.length === 1;
}

export function filterSingleEmojiGlyphs(list: string[]): string[] {
  return list.filter(isSingleEmojiGlyph);
}
