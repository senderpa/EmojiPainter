import {
  base64ToDataUri,
  dataUriToBase64,
  isCustomPng,
  getBase64Size,
  optimizeEmoji,
} from '../lib/pngNormalizer';

describe('base64ToDataUri', () => {
  test('wraps base64 in data URI', () => {
    const result = base64ToDataUri('abc123==');
    expect(result).toBe('data:image/png;base64,abc123==');
  });

  test('handles empty string', () => {
    expect(base64ToDataUri('')).toBe('data:image/png;base64,');
  });

  test('round-trips with dataUriToBase64', () => {
    const original = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const uri = base64ToDataUri(original);
    expect(dataUriToBase64(uri)).toBe(original);
  });
});

describe('dataUriToBase64', () => {
  test('strips data URI prefix', () => {
    const result = dataUriToBase64('data:image/png;base64,abc123==');
    expect(result).toBe('abc123==');
  });

  test('returns plain base64 unchanged', () => {
    expect(dataUriToBase64('abc123==')).toBe('abc123==');
  });

  test('handles empty base64 after prefix', () => {
    expect(dataUriToBase64('data:image/png;base64,')).toBe('');
  });
});

describe('isCustomPng', () => {
  test('returns true for data URI', () => {
    expect(isCustomPng('data:image/png;base64,abc')).toBe(true);
  });

  test('returns false for regular emoji', () => {
    expect(isCustomPng('😀')).toBe(false);
  });

  test('returns false for url', () => {
    expect(isCustomPng('https://example.com/image.png')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isCustomPng('')).toBe(false);
  });

  test('returns false for partial prefix', () => {
    expect(isCustomPng('data:image/png')).toBe(false);
  });
});

describe('getBase64Size', () => {
  test('estimates byte size from base64 length', () => {
    // 4 base64 chars = 3 bytes
    const base64 = 'AAAA'; // 4 chars → 3 bytes
    expect(getBase64Size(base64)).toBe(3);
  });

  test('returns 0 for empty string', () => {
    expect(getBase64Size('')).toBe(0);
  });

  test('handles 8-char base64', () => {
    expect(getBase64Size('AAAAAAAA')).toBe(6);
  });

  test('rounds up for partial groups', () => {
    // 5 chars → ceil(5*3/4) = ceil(3.75) = 4
    expect(getBase64Size('AAAAA')).toBe(4);
  });
});

describe('optimizeEmoji', () => {
  test('returns custom PNG unchanged', () => {
    const uri = 'data:image/png;base64,abc123';
    expect(optimizeEmoji(uri)).toBe(uri);
  });

  test('returns regular emoji unchanged', () => {
    expect(optimizeEmoji('😀')).toBe('😀');
  });

  test('returns empty string unchanged', () => {
    expect(optimizeEmoji('')).toBe('');
  });
});
