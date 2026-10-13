export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const overlapArea = (a: Rect, b: Rect): number => {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
};

/**
 * Place a floating control next to an obstacle, preferring a fully non-overlapping side.
 * Candidates are clamped into the safe viewport before scoring, so edge/corner planes still get
 * the best actually-visible position rather than an off-screen theoretical one.
 */
export const placePanelAwayFromRect = (
  viewport: Rect,
  obstacle: Rect,
  panel: Size,
  gap = 12,
  margin = 8,
): { left: number; top: number } => {
  const minLeft = viewport.x + margin;
  const minTop = viewport.y + margin;
  const maxLeft = Math.max(minLeft, viewport.x + viewport.width - panel.width - margin);
  const maxTop = Math.max(minTop, viewport.y + viewport.height - panel.height - margin);
  const centreX = obstacle.x + obstacle.width / 2;
  const centreY = obstacle.y + obstacle.height / 2;
  const raw = [
    { left: obstacle.x + obstacle.width + gap, top: centreY - panel.height / 2 },
    { left: obstacle.x - gap - panel.width, top: centreY - panel.height / 2 },
    { left: centreX - panel.width / 2, top: obstacle.y + obstacle.height + gap },
    { left: centreX - panel.width / 2, top: obstacle.y - gap - panel.height },
  ];

  return raw
    .map((candidate, order) => {
      const left = clamp(candidate.left, minLeft, maxLeft);
      const top = clamp(candidate.top, minTop, maxTop);
      const rect = { x: left, y: top, width: panel.width, height: panel.height };
      const dx = left + panel.width / 2 - centreX;
      const dy = top + panel.height / 2 - centreY;
      return {
        left,
        top,
        // Any overlap dominates distance. Order only makes exact ties deterministic.
        score: overlapArea(rect, obstacle) * 1_000_000 + Math.hypot(dx, dy) + order * 0.001,
      };
    })
    .sort((a, b) => a.score - b.score)[0];
};
