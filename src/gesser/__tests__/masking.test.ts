import {
  maskTopic,
  topicsMatch,
  validateTopicFormat,
  normalizeTopic,
  formatMaskedTopic,
  mysteryRevealCount,
  validateManualMysteryTopic,
  cleanCustomMysteryTopicInput,
  normalizeCustomMysteryTopicInput,
  validateCustomMysteryTopic
} from '../utils/masking';

describe('maskTopic', () => {
  test('reveals the length-based number of letters deterministically', () => {
    const { masked, revealedPositions } = maskTopic('Space Whale', 123);

    expect(revealedPositions.length).toBe(3);
    expect(masked).toContain('_');
    // Single space is preserved between words
    expect(masked).toContain(' ');
  });

  test('same topicId produces same mask', () => {
    const result1 = maskTopic('Space Whale', 123);
    const result2 = maskTopic('Space Whale', 123);

    expect(result1.masked).toBe(result2.masked);
    expect(result1.revealedPositions).toEqual(result2.revealedPositions);
  });

  test('different topicId produces different mask', () => {
    const result1 = maskTopic('Space Whale', 123);
    const result2 = maskTopic('Space Whale', 456);

    expect(result1.masked).not.toBe(result2.masked);
  });

  test('handles single word correctly', () => {
    const { masked, revealedPositions } = maskTopic('Dragon', 1);

    expect(revealedPositions.length).toBe(2);
    expect(masked.length).toBeGreaterThan(0);
  });

  test('handles two words correctly', () => {
    const { masked } = maskTopic('Fire Dragon', 1);

    // Single space is preserved between words
    expect(masked).toContain(' ');
    expect(masked.length).toBe('Fire Dragon'.length);
  });

  test('handles unicode characters', () => {
    const { masked } = maskTopic('Café Élite', 1);

    expect(masked.length).toBeGreaterThan(0);
  });

  test('reveals exactly the chars at revealedPositions', () => {
    const topic = 'Dragon';
    const { masked, revealedPositions } = maskTopic(topic, 7);
    const chars = Array.from(topic);

    revealedPositions.forEach((pos) => {
      expect(masked[pos]).toBe(chars[pos].toLowerCase());
    });
  });

  test('masks non-revealed letters with underscore', () => {
    const { masked, revealedPositions } = maskTopic('Hello', 3);
    const chars = Array.from('Hello');

    chars.forEach((char, idx) => {
      if (!revealedPositions.includes(idx)) {
        expect(masked[idx]).toBe('_');
      }
    });
  });

  test('handles single letter topic', () => {
    const { masked, revealedPositions } = maskTopic('A', 0);

    expect(revealedPositions.length).toBe(1);
    expect(masked).toBe('a');
  });

  test('handles no-letter topic (punctuation only)', () => {
    const { masked, revealedPositions } = maskTopic('!!!', 0);

    expect(revealedPositions.length).toBe(0);
    expect(masked).toBe('!!!');
  });
});

describe('topicsMatch', () => {
  test('matches identical topics', () => {
    expect(topicsMatch('Space Whale', 'Space Whale')).toBe(true);
  });

  test('matches case-insensitive', () => {
    expect(topicsMatch('Space Whale', 'space whale')).toBe(true);
    expect(topicsMatch('SPACE WHALE', 'space whale')).toBe(true);
  });

  test('matches with extra whitespace', () => {
    expect(topicsMatch('Space  Whale', 'Space Whale')).toBe(true);
    expect(topicsMatch('  Space Whale  ', 'Space Whale')).toBe(true);
  });

  test('does not match different topics', () => {
    expect(topicsMatch('Space Whale', 'Fire Dragon')).toBe(false);
  });

  test('handles empty strings', () => {
    expect(topicsMatch('', '')).toBe(true);
    expect(topicsMatch('Space Whale', '')).toBe(false);
  });
});

describe('manual Mystery topics', () => {
  test('trims and collapses spaces without accepting invalid characters', () => {
    expect(normalizeCustomMysteryTopicInput('  Blue   whale  ')).toBe('Blue whale');
    expect(validateManualMysteryTopic('  Blue   whale  ')).toEqual({
      valid: true,
      normalizedTopic: 'Blue whale',
      error: null,
    });
    expect(validateCustomMysteryTopic('Blue whale')).toEqual({
      valid: true,
      normalized: 'Blue whale',
      error: null,
    });
  });

  test('keeps one trailing space while typing and caps input safely', () => {
    expect(cleanCustomMysteryTopicInput('Blue  ')).toBe('Blue ');
    expect(cleanCustomMysteryTopicInput('café!')).toBe('caf');
    expect(cleanCustomMysteryTopicInput('A'.repeat(25))).toBe('A'.repeat(20));
  });

  test('accepts one through twenty ASCII letters/spaces only', () => {
    expect(validateManualMysteryTopic('A').valid).toBe(true);
    expect(validateManualMysteryTopic('A'.repeat(20)).valid).toBe(true);
    expect(validateManualMysteryTopic('A'.repeat(21)).valid).toBe(false);
    expect(validateManualMysteryTopic('blue-whale').valid).toBe(false);
    expect(validateManualMysteryTopic('blue whale!').valid).toBe(false);
    expect(validateManualMysteryTopic('café').valid).toBe(false);
    expect(validateManualMysteryTopic('blue  whale').valid).toBe(true);
  });
});

describe('Mystery reveal policy', () => {
  test('reveals two, three, then deterministic three-or-four letters', () => {
    expect(mysteryRevealCount(1)).toBe(1);
    expect(mysteryRevealCount(8)).toBe(2);
    expect(mysteryRevealCount(9)).toBe(3);
    expect(mysteryRevealCount(16)).toBe(3);
    expect([3, 4]).toContain(mysteryRevealCount(17, 1));
    expect(mysteryRevealCount(20, 0)).toBe(mysteryRevealCount(20, 0));
  });

  test('uses topic text when the topic ID is missing or zero', () => {
    const missing = maskTopic('Blue Whale', undefined);
    expect(maskTopic('Blue Whale', 0)).toEqual(missing);
    expect(maskTopic('Blue Whale', undefined)).toEqual(missing);
  });

  test('never repeats revealed positions for long topics', () => {
    const result = maskTopic('A'.repeat(20), 42);
    expect(new Set(result.revealedPositions).size).toBe(result.revealedPositions.length);
    expect([3, 4]).toContain(result.revealedPositions.length);
  });
});

describe('validateTopicFormat', () => {
  test('accepts valid 1-word topic', () => {
    const result = validateTopicFormat('Dragon');
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  test('accepts valid 2-word topic', () => {
    const result = validateTopicFormat('Space Whale');
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  test('accepts valid 3-word topic', () => {
    // implementation allows up to 3 words
    const result = validateTopicFormat('Red Fire Dragon');
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  test('rejects empty topic', () => {
    const result = validateTopicFormat('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('rejects topic with more than 3 words', () => {
    const result = validateTopicFormat('Space Whale Astronaut Explorer');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('rejects topic too short', () => {
    const result = validateTopicFormat('A');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('2');
  });

  test('rejects topic too long', () => {
    const longTopic = 'A'.repeat(51);
    const result = validateTopicFormat(longTopic);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('50');
  });

  test('accepts topic at min length (2 chars)', () => {
    const result = validateTopicFormat('Hi');
    expect(result.valid).toBe(true);
  });

  test('accepts topic at max length (50 chars)', () => {
    const topic = 'A'.repeat(50);
    const result = validateTopicFormat(topic);
    expect(result.valid).toBe(true);
  });
});

describe('normalizeTopic', () => {
  test('converts to lowercase', () => {
    expect(normalizeTopic('Space Whale')).toBe('space whale');
    expect(normalizeTopic('FIRE DRAGON')).toBe('fire dragon');
  });

  test('trims whitespace', () => {
    expect(normalizeTopic('  Space Whale  ')).toBe('space whale');
  });

  test('normalizes multiple spaces', () => {
    expect(normalizeTopic('Space  Whale')).toBe('space whale');
    expect(normalizeTopic('Space   Whale')).toBe('space whale');
  });

  test('handles empty string', () => {
    expect(normalizeTopic('')).toBe('');
    expect(normalizeTopic('   ')).toBe('');
  });
});

describe('formatMaskedTopic', () => {
  test('replaces double underscores with spaced underscores', () => {
    expect(formatMaskedTopic('__')).toBe('_ _');
    expect(formatMaskedTopic('__ __')).toBe('_ _ _ _');
  });

  test('handles empty string', () => {
    expect(formatMaskedTopic('')).toBe('');
  });

  test('handles single character', () => {
    expect(formatMaskedTopic('a')).toBe('a');
  });

  test('leaves single underscores unchanged', () => {
    expect(formatMaskedTopic('_')).toBe('_');
  });

  test('preserves revealed letters', () => {
    expect(formatMaskedTopic('a b c')).toBe('a b c');
  });

  test('formats output of maskTopic without error', () => {
    const { masked } = maskTopic('Dragon', 1);
    const formatted = formatMaskedTopic(masked);
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
    // formatMaskedTopic expands __ pairs — result must be same length or longer
    expect(formatted.length).toBeGreaterThanOrEqual(masked.length);
  });
});
