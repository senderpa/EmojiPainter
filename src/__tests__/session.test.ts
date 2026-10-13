import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSessionId, resetSessionId } from '../lib/session';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const SESSION_KEY = 'emojipaint/currentSessionId';
const SESSION_BOOT_MARK = 'emojipaint/sessionBootMarker';

beforeEach(async () => {
  jest.clearAllMocks();
  // Clear in-memory cache between tests
  await resetSessionId();
  jest.clearAllMocks(); // clear the removeItem calls from resetSessionId
});

describe('getSessionId', () => {
  test('creates new session on first boot (no boot marker)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const id = await getSessionId();

    expect(typeof id).toBe('string');
    expect(id).toMatch(/^session-\d{8}_\d{6}$/);
  });

  test('returns same id on repeated calls (in-memory cache)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const id1 = await getSessionId();
    const id2 = await getSessionId();

    expect(id1).toBe(id2);
  });

  test('restores existing session when boot marker exists', async () => {
    const existingId = 'session-20260529_120000';
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === SESSION_BOOT_MARK) return Promise.resolve(String(Date.now()));
      if (key === SESSION_KEY) return Promise.resolve(existingId);
      return Promise.resolve(null);
    });

    const id = await getSessionId();

    expect(id).toBe(existingId);
  });

  test('creates new session if boot marker exists but session key is missing', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === SESSION_BOOT_MARK) return Promise.resolve(String(Date.now()));
      return Promise.resolve(null);
    });

    const id = await getSessionId();

    expect(id).toMatch(/^session-/);
  });

  test('generates id with correct format session-YYYYMMDD_HHMMSS', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const id = await getSessionId();

    const match = id.match(/^session-(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1])).toBeGreaterThanOrEqual(2024);
    expect(parseInt(match![2])).toBeGreaterThanOrEqual(1);
    expect(parseInt(match![2])).toBeLessThanOrEqual(12);
    expect(parseInt(match![3])).toBeGreaterThanOrEqual(1);
    expect(parseInt(match![3])).toBeLessThanOrEqual(31);
  });

  test('handles storage error gracefully and still returns an id', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Storage fail'));

    const id = await getSessionId();

    expect(id).toMatch(/^session-/);
  });
});

describe('resetSessionId', () => {
  test('removes session key and boot marker', async () => {
    await resetSessionId();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(SESSION_KEY);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(SESSION_BOOT_MARK);
  });

  test('can be called multiple times without error', async () => {
    await expect(resetSessionId()).resolves.not.toThrow();
    await expect(resetSessionId()).resolves.not.toThrow();
  });

  test('after reset, getSessionId produces a valid id again', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    await resetSessionId();
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const id = await getSessionId();
    expect(id).toMatch(/^session-/);
  });
});
