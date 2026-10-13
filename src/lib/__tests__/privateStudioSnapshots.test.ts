import { appendPassportSnapshot, type PassportSnapshot } from '../privateStudioSnapshots';

const snapshot = (imageDataUrl: string, timestamp: number): PassportSnapshot => ({
  imageDataUrl,
  timestamp,
  uploadDate: '2026-08-20',
});

describe('passport snapshot history', () => {
  it('does not append the same confirmed upload twice', () => {
    const existing = [snapshot('portrait-a', 1)];
    expect(appendPassportSnapshot(existing, 'portrait-a', 2, '2026-08-20')).toEqual(existing);
  });

  it('appends a new confirmed upload and limits history to 100 frames', () => {
    const existing = Array.from({ length: 100 }, (_, index) => snapshot(`portrait-${index}`, index));
    const next = appendPassportSnapshot(existing, 'portrait-new', 101, '2026-08-20');
    expect(next).toHaveLength(100);
    expect(next[0].imageDataUrl).toBe('portrait-1');
    expect(next[99]).toEqual(snapshot('portrait-new', 101));
  });
});
