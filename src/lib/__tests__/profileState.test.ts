import { ensureProfileAuth, profileApiRequest } from '../profileAuth';
import { fetchDurableProfileState, syncDurableProfileState } from '../profileState';

jest.mock('../profileAuth', () => ({
  ensureProfileAuth: jest.fn().mockResolvedValue('secure-profile-token'),
  profileApiRequest: jest.fn(),
}));

describe('profileState', () => {
  beforeEach(() => jest.clearAllMocks());

  test('normalizes a durable profile read', async () => {
    (profileApiRequest as jest.Mock).mockResolvedValue({
      ok: true,
      profile: {
        found: true,
        device_id: 'device-123456789',
        name: ' Painter ',
        total_time_ms: '120000',
        total_strokes: '44',
        coin_count: '7',
        portrait_url: 'https://example.com/me.png',
        updated_at: '2026-08-20 12:00:00',
      },
    });

    await expect(fetchDurableProfileState(' device-123456789 ')).resolves.toEqual({
      found: true,
      deviceId: 'device-123456789',
      name: 'Painter',
      elapsedMs: 120000,
      strokeCount: 44,
      coinCount: 7,
      portraitUrl: 'https://example.com/me.png',
      updatedAt: '2026-08-20 12:00:00',
      // Level inputs default to empty when an older server omits them, so a profile
      // recovered from a pre-level deployment still restores rather than throwing.
      streakDays: 0,
      streakLastDate: null,
      correctGuesses: 0,
      multipaintStrokes: 0,
      arScenes: 0,
      achievements: [],
    });
    expect(ensureProfileAuth).toHaveBeenCalledWith('device-123456789');
  });

  test('sends monotonic lifetime values and only TLS portrait URLs', async () => {
    (profileApiRequest as jest.Mock).mockResolvedValue({
      ok: true,
      profile: { found: true, device_id: 'device-123456789', name: 'Painter' },
    });
    await syncDurableProfileState({
      deviceId: 'device-123456789',
      name: 'Painter',
      elapsedMs: 12.9,
      strokeCount: 4.8,
      portraitUrl: 'data:image/png;base64,abc',
    });

    expect(profileApiRequest).toHaveBeenCalledWith('profile-state.php', {
      action: 'sync',
      device_id: 'device-123456789',
      name: 'Painter',
      total_time_ms: 12,
      total_strokes: 4,
    }, 'secure-profile-token');
  });

  test('falls back cleanly while the endpoint is not deployed', async () => {
    (profileApiRequest as jest.Mock).mockRejectedValue(new Error('404'));
    await expect(fetchDurableProfileState('device-123456789')).resolves.toBeNull();
  });

  test('parses level inputs, tolerating achievements as a JSON string', async () => {
    (profileApiRequest as jest.Mock).mockResolvedValue({
      ok: true,
      profile: {
        found: true,
        device_id: 'device-123456789',
        name: 'Painter',
        streak_days: '5',
        streak_last_date: '2026-08-23',
        correct_guesses: '12',
        multipaint_strokes: '3',
        ar_scenes: '2',
        achievements: '["first_stroke","gallery_upload"]',
      },
    });
    const state = await fetchDurableProfileState('device-123456789');
    expect(state).toMatchObject({
      streakDays: 5,
      streakLastDate: '2026-08-23',
      correctGuesses: 12,
      multipaintStrokes: 3,
      arScenes: 2,
      achievements: ['first_stroke', 'gallery_upload'],
    });
  });

  test('malformed achievements payload degrades to an empty list', async () => {
    (profileApiRequest as jest.Mock).mockResolvedValue({
      ok: true,
      profile: { found: true, device_id: 'device-123456789', name: 'P', achievements: 'not json' },
    });
    await expect(fetchDurableProfileState('device-123456789')).resolves.toMatchObject({ achievements: [] });
  });
});
