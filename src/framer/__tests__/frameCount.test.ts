import { DEFAULT_FRAME_COUNT, isValidFrameCount, parseFrameCount } from '../frameCount';

describe('frame count input', () => {
  it('keeps the default at 90', () => expect(DEFAULT_FRAME_COUNT).toBe(90));
  it('accepts edited positive integer values', () => expect(parseFrameCount('30')).toBe(30));
  it.each(['', '0', '-1', 'NaN', 'Infinity', '5001'])('rejects %s', (value) => {
    expect(isValidFrameCount(value)).toBe(false);
    expect(parseFrameCount(value)).toBe(DEFAULT_FRAME_COUNT);
  });
});
