import {
  clampPlaneLifetime,
  isPlaneVisibleAtFrame,
  planeFrameDistance,
  planeLastVisibleFrame,
  planeLifetimeWraps,
} from '../emojiPlaneTimeline';

describe('Framer 📐 cyclic lifetime', () => {
  it('allows the full active range even when the plane is born near its end', () => {
    expect(clampPlaneLifetime(999, 0, 90)).toBe(90);
    for (let frame = 0; frame < 90; frame += 1) {
      expect(isPlaneVisibleAtFrame(78, 90, frame, 0, 90)).toBe(true);
    }
  });

  it('wraps a partial lifetime through the left side of the crop range', () => {
    const visible = Array.from({ length: 12 }, (_, index) => index + 10)
      .filter((frame) => isPlaneVisibleAtFrame(18, 6, frame, 10, 22));
    expect(visible).toEqual([10, 11, 18, 19, 20, 21]);
    expect(planeFrameDistance(18, 10, 10, 22)).toBe(4);
    expect(planeLastVisibleFrame(18, 6, 10, 22)).toBe(11);
    expect(planeLifetimeWraps(18, 6, 10, 22)).toBe(true);
  });

  it('keeps the exact minimum of one frame', () => {
    expect(clampPlaneLifetime(0, 5, 25)).toBe(1);
    expect(isPlaneVisibleAtFrame(12, 1, 12, 5, 25)).toBe(true);
    expect(isPlaneVisibleAtFrame(12, 1, 13, 5, 25)).toBe(false);
  });
});
