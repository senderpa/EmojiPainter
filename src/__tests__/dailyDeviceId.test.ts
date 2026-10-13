import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateDailyDeviceId, regenerateDeviceId, ensureDeviceId } from '../lib/dailyDeviceId';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn(),
  multiSet: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(16).fill(0xab)),
}));

const PRIMARY_KEY = 'emojipaint/daily-device-id';
const SECONDARY_KEY = 'daily-device-id';
const PROFILE_SYNC_MARKER_KEY = 'emojipaint/profile/server-sync-marker';
const VALID_ID = 'a'.repeat(32); // 16 bytes = 32 hex chars
const SYNCED_ID = 'b'.repeat(32);

describe('getOrCreateDailyDeviceId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns primary stored id when it exists', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === PROFILE_SYNC_MARKER_KEY) return Promise.resolve(null);
      if (key === PRIMARY_KEY) return Promise.resolve(VALID_ID);
      return Promise.resolve(null);
    });

    const id = await getOrCreateDailyDeviceId();

    expect(id).toBe(VALID_ID);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('uses synced profile id before stored install id', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === PROFILE_SYNC_MARKER_KEY) return Promise.resolve(SYNCED_ID);
      if (key === PRIMARY_KEY) return Promise.resolve(VALID_ID);
      return Promise.resolve(null);
    });

    const id = await getOrCreateDailyDeviceId();

    expect(id).toBe(SYNCED_ID);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRIMARY_KEY, SYNCED_ID);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(SECONDARY_KEY, SYNCED_ID);
  });

  test('falls back to secondary key when primary is missing', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === PRIMARY_KEY) return Promise.resolve(null);
      if (key === SECONDARY_KEY) return Promise.resolve(VALID_ID);
      return Promise.resolve(null);
    });

    const id = await getOrCreateDailyDeviceId();

    expect(id).toBe(VALID_ID);
    // Should promote to primary
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRIMARY_KEY, VALID_ID);
  });

  test('generates new id when no keys exist', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const id = await getOrCreateDailyDeviceId();

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThanOrEqual(32);
    // Should write to both keys
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRIMARY_KEY, expect.any(String));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(SECONDARY_KEY, expect.any(String));
  });

  test('ignores stored values that are too short', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('short');

    const id = await getOrCreateDailyDeviceId();

    // short value is rejected, so a new id is generated
    expect(id.length).toBeGreaterThanOrEqual(32);
  });

  test('trims whitespace from stored ids', async () => {
    const paddedId = `  ${VALID_ID}  `;
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === PRIMARY_KEY) return Promise.resolve(paddedId);
      return Promise.resolve(null);
    });

    const id = await getOrCreateDailyDeviceId();
    expect(id).toBe(VALID_ID);
  });

  test('ensureDeviceId is an alias of getOrCreateDailyDeviceId', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === PRIMARY_KEY) return Promise.resolve(VALID_ID);
      return Promise.resolve(null);
    });

    const id = await ensureDeviceId();
    expect(id).toBe(VALID_ID);
  });
});

describe('regenerateDeviceId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('always creates and stores a new id', async () => {
    const id = await regenerateDeviceId();

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThanOrEqual(32);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRIMARY_KEY, id);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(SECONDARY_KEY, id);
  });

  test('overwrites existing primary id', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(VALID_ID);

    const newId = await regenerateDeviceId();

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRIMARY_KEY, newId);
  });
});

describe('ID format validation', () => {
  test('generated id is valid hex string', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const id = await getOrCreateDailyDeviceId();

    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  test('generated id has minimum length of 32 chars (16 bytes)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const id = await getOrCreateDailyDeviceId();

    expect(id.length).toBeGreaterThanOrEqual(32);
  });
});
