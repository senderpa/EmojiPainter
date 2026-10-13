export const MIN_CHALLENGE_STROKES = 3;

export const getChallengeStrokesRemaining = (strokeCount: number): number =>
  Math.max(0, MIN_CHALLENGE_STROKES - Math.max(0, Math.floor(strokeCount || 0)));

export const canUploadChallengeEarly = (strokeCount: number): boolean =>
  getChallengeStrokesRemaining(strokeCount) === 0;
