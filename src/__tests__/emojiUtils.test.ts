import { isSingleEmojiGlyph, filterSingleEmojiGlyphs } from '../lib/emojiUtils';

describe('isSingleEmojiGlyph', () => {
  describe('returns true for single emoji', () => {
    test('simple emoji', () => {
      expect(isSingleEmojiGlyph('😀')).toBe(true);
    });

    test('single letter', () => {
      expect(isSingleEmojiGlyph('A')).toBe(true);
    });

    test('flag emoji (regional indicator pair)', () => {
      expect(isSingleEmojiGlyph('🇺🇸')).toBe(true);
    });

    test('ZWJ sequence (family emoji)', () => {
      expect(isSingleEmojiGlyph('👨‍👩‍👧')).toBe(true);
    });

    test('emoji with variation selector', () => {
      // ☀️ = ☀ + variation selector
      expect(isSingleEmojiGlyph('☀️')).toBe(true);
    });

    test('skin tone modifier', () => {
      expect(isSingleEmojiGlyph('👍🏾')).toBe(true);
    });

    test('digit', () => {
      expect(isSingleEmojiGlyph('5')).toBe(true);
    });
  });

  describe('returns false for multiple glyphs', () => {
    test('two emojis', () => {
      expect(isSingleEmojiGlyph('😀😀')).toBe(false);
    });

    test('emoji followed by letter', () => {
      expect(isSingleEmojiGlyph('😀A')).toBe(false);
    });

    test('two letters', () => {
      expect(isSingleEmojiGlyph('AB')).toBe(false);
    });

    test('string with space', () => {
      expect(isSingleEmojiGlyph('😀 😀')).toBe(false);
    });
  });

  describe('returns false for empty/invalid input', () => {
    test('empty string', () => {
      expect(isSingleEmojiGlyph('')).toBe(false);
    });

    test('multi-char string with no emoji', () => {
      // Two separate ASCII letters — definitely not a single glyph
      expect(isSingleEmojiGlyph('AB')).toBe(false);
    });
  });
});

describe('filterSingleEmojiGlyphs', () => {
  test('returns only single-glyph entries from list', () => {
    const input = ['😀', 'AB', '🇺🇸', '', '🔥', 'hello'];
    const result = filterSingleEmojiGlyphs(input);

    expect(result).toContain('😀');
    expect(result).toContain('🇺🇸');
    expect(result).toContain('🔥');
    expect(result).not.toContain('AB');
    expect(result).not.toContain('');
    expect(result).not.toContain('hello');
  });

  test('returns empty array for empty input', () => {
    expect(filterSingleEmojiGlyphs([])).toEqual([]);
  });

  test('returns empty array when all fail', () => {
    expect(filterSingleEmojiGlyphs(['', 'abc', 'hello world'])).toEqual([]);
  });

  test('returns all entries when all are single glyphs', () => {
    const input = ['😀', '😂', '🔥'];
    expect(filterSingleEmojiGlyphs(input)).toEqual(input);
  });

  test('preserves order', () => {
    const input = ['🅰️', '😀', '🔥'];
    const result = filterSingleEmojiGlyphs(input);
    expect(result.indexOf('😀')).toBeLessThan(result.indexOf('🔥'));
  });
});
