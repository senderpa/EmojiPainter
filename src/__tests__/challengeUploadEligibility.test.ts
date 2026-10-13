import {
  canUploadChallengeEarly,
  getChallengeStrokesRemaining,
  MIN_CHALLENGE_STROKES,
} from '../lib/challengeUploadEligibility';
import { PROFILE_TERMS_WEB_URL } from '../lib/profileTerms';

describe('challenge upload eligibility', () => {
  test('requires exactly three completed emoji strokes for early upload', () => {
    expect(MIN_CHALLENGE_STROKES).toBe(3);
    expect(canUploadChallengeEarly(0)).toBe(false);
    expect(canUploadChallengeEarly(2)).toBe(false);
    expect(canUploadChallengeEarly(3)).toBe(true);
    expect(canUploadChallengeEarly(4)).toBe(true);
  });

  test('reports how many more strokes the painter needs', () => {
    expect(getChallengeStrokesRemaining(0)).toBe(3);
    expect(getChallengeStrokesRemaining(1)).toBe(2);
    expect(getChallengeStrokesRemaining(2)).toBe(1);
    expect(getChallengeStrokesRemaining(3)).toBe(0);
  });
});

describe('terms reader URL', () => {
  test('uses the live EmojiPainter policy page', () => {
    expect(PROFILE_TERMS_WEB_URL).toBe('https://emojipainter.com/privacy_policy.html');
  });
});
