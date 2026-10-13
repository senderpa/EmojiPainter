import { emojiToUnicodeKey, normalizeEmoji3dUnicodeKey } from '../emoji3dClient';

describe('emoji3dClient', () => {
  it('matches server unicode keys returned with underscores', () => {
    expect(emojiToUnicodeKey('🖌️')).toBe('1F58C-FE0F');
    expect(normalizeEmoji3dUnicodeKey('1F58C_FE0F')).toBe('1F58C-FE0F');
    expect(normalizeEmoji3dUnicodeKey(' 1f58c_fe0f ')).toBe('1F58C-FE0F');
  });
});
