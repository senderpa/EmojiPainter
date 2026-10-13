import { shouldUseNativeMetalPaint } from '../paintCanvasEngine';

const eligible = {
  shouldUseMetalCanvas: false,
  forceMetal: false,
  forceSkia: false,
  hasPlaneStrokes: false,
  hasCustomEmoji: false,
  nativeViewAvailable: true,
  featureEnabled: true,
};

describe('paint canvas engine selection', () => {
  test('never hands a committed emoji plane from Skia preview to native Metal', () => {
    expect(shouldUseNativeMetalPaint({ ...eligible, hasPlaneStrokes: true })).toBe(false);
  });

  test('keeps native Metal available for an ordinary compatible painting', () => {
    expect(shouldUseNativeMetalPaint(eligible)).toBe(true);
  });

  test('honours an explicit Skia request while a plane is still being edited', () => {
    expect(shouldUseNativeMetalPaint({ ...eligible, forceSkia: true })).toBe(false);
  });
});
