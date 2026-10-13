import { placePanelAwayFromRect, type Rect } from '../emojiPlanePanelPlacement';

const intersects = (a: Rect, b: Rect) =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
  Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);

describe('emoji plane panel placement', () => {
  const viewport = { x: 0, y: 0, width: 390, height: 844 };
  const panel = { width: 252, height: 174 };

  test.each([
    { x: 135, y: 320, width: 120, height: 120 },
    { x: 5, y: 20, width: 120, height: 120 },
    { x: 265, y: 700, width: 120, height: 120 },
  ])('chooses a visible zero-overlap side for plane %#', (plane) => {
    const position = placePanelAwayFromRect(viewport, plane, panel);
    const placed = { x: position.left, y: position.top, ...panel };
    expect(intersects(placed, plane)).toBe(false);
    expect(placed.x).toBeGreaterThanOrEqual(8);
    expect(placed.y).toBeGreaterThanOrEqual(8);
    expect(placed.x + placed.width).toBeLessThanOrEqual(382);
    expect(placed.y + placed.height).toBeLessThanOrEqual(836);
  });
});
