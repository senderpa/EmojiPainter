export const DEFAULT_FRAME_COUNT = 90;
export const MIN_FRAME_COUNT = 1;
export const MAX_FRAME_COUNT = 5000;

export function parseFrameCount(value: string | number, fallback = DEFAULT_FRAME_COUNT): number {
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return fallback;
  if (numeric < MIN_FRAME_COUNT || numeric > MAX_FRAME_COUNT) return fallback;
  return numeric;
}

export function isValidFrameCount(value: string | number): boolean {
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(numeric) && Number.isInteger(numeric) && numeric >= MIN_FRAME_COUNT && numeric <= MAX_FRAME_COUNT;
}
