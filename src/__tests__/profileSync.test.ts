import AsyncStorage from '@react-native-async-storage/async-storage';
import { GLOBAL_STATS_STORAGE_KEY } from '../lib/paintConstants';
import {
  hasAcceptedProfileTerms,
  acceptProfileTerms,
  readAgbAcceptanceState,
  markServerProfileSynced,
  getServerProfileSyncMarker,
  restoreServerProfileLocally,
  clearSyncedProfileIdentity,
  PROFILE_TERMS_VERSION,
  PROFILE_TERMS_ACCEPTED_KEY,
  PROFILE_TERMS_ACCEPTED_AT_KEY,
  PROFILE_DISPLAY_NAME_STORAGE_KEY,
  PROFILE_SERVER_SYNC_MARKER_KEY,
  type ServerProfileSnapshot,
} from '../lib/profileSync';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiSet: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/dailyDeviceId', () => ({
  getOrCreateDailyDeviceId: jest.fn().mockResolvedValue('device123'),
  regenerateDeviceId: jest.fn().mockResolvedValue('newdeviceid1234567890abcdef123456'),
}));

jest.mock('../lib/profileState', () => ({
  fetchDurableProfileState: jest.fn().mockResolvedValue(null),
  syncDurableProfileState: jest.fn().mockResolvedValue({
    found: true,
    deviceId: 'device123',
    name: 'TestUser',
    elapsedMs: 60000,
    strokeCount: 42,
    coinCount: 10,
    portraitUrl: null,
    updatedAt: null,
  }),
}));

jest.mock('../lib/privateStudio', () => ({
  fetchExistingPassport: jest.fn().mockResolvedValue(null),
  clearPassportSnapshots: jest.fn().mockResolvedValue(undefined),
  replacePassportSnapshots: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/dailyPaintGallery', () => ({
  fetchDailyPaintGallery: jest.fn().mockResolvedValue([]),
}));

const makeSnapshot = (overrides: Partial<ServerProfileSnapshot> = {}): ServerProfileSnapshot => ({
  deviceId: 'device123',
  name: 'TestUser',
  elapsedMs: 60000,
  strokeCount: 42,
  coinCount: 10,
  latestPortrait: 'https://example.com/portrait.png',
  portraitHistory: ['https://example.com/portrait.png'],
  profile: null,
  galleryEntries: [],
  level: null,
  ...overrides,
});

describe('hasAcceptedProfileTerms', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns false when not set', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    expect(await hasAcceptedProfileTerms()).toBe(false);
  });

  test('returns true when set to the current content licence version', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(PROFILE_TERMS_VERSION);
    expect(await hasAcceptedProfileTerms()).toBe(true);
  });

  // Migration (see lib/profileTermsConsent): the accepted key is only ever
  // written by acceptProfileTerms, so ANY stored value means this device really
  // did accept at some point. Those users are carried forward onto the current
  // version rather than being pushed back through the first-launch AGB intro.
  test('migrates a legacy stored value onto the current version', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('true');
    expect(await hasAcceptedProfileTerms()).toBe(true);
    expect(AsyncStorage.multiSet).toHaveBeenCalledWith(
      expect.arrayContaining([[PROFILE_TERMS_ACCEPTED_KEY, PROFILE_TERMS_VERSION]])
    );
  });

  test('preserves the original acceptance timestamp when migrating', async () => {
    const originalAt = '2025-01-02T03:04:05.000Z';
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === PROFILE_TERMS_ACCEPTED_AT_KEY ? originalAt : 'legacy-version'
    );
    expect(await hasAcceptedProfileTerms()).toBe(true);
    expect(AsyncStorage.multiSet).toHaveBeenCalledWith(
      expect.arrayContaining([[PROFILE_TERMS_ACCEPTED_AT_KEY, originalAt]])
    );
  });

  test('returns false on storage error', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Storage error'));
    expect(await hasAcceptedProfileTerms()).toBe(false);
  });
});

// The in-app safety net re-raises the gate only on a definitive 'missing', so a
// storage failure must NOT be reported the same way as "never accepted".
describe('readAgbAcceptanceState', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reports accepted for the current version', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(PROFILE_TERMS_VERSION);
    expect(await readAgbAcceptanceState()).toBe('accepted');
  });

  test('reports missing when nothing is stored', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    expect(await readAgbAcceptanceState()).toBe('missing');
  });

  test('reports unavailable — not missing — when storage throws', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Storage error'));
    expect(await readAgbAcceptanceState()).toBe('unavailable');
  });
});

describe('acceptProfileTerms', () => {
  beforeEach(() => jest.clearAllMocks());

  test('stores accepted flag and timestamp', async () => {
    await acceptProfileTerms();

    expect(AsyncStorage.multiSet).toHaveBeenCalledWith(
      expect.arrayContaining([
        [PROFILE_TERMS_ACCEPTED_KEY, PROFILE_TERMS_VERSION],
        [PROFILE_TERMS_ACCEPTED_AT_KEY, expect.any(String)],
      ])
    );
  });

  test('stored timestamp is a valid ISO date', async () => {
    await acceptProfileTerms();

    const calls = (AsyncStorage.multiSet as jest.Mock).mock.calls[0][0] as [string, string][];
    const atEntry = calls.find(([key]) => key === PROFILE_TERMS_ACCEPTED_AT_KEY);
    expect(atEntry).toBeDefined();
    expect(() => new Date(atEntry![1]).toISOString()).not.toThrow();
  });
});

describe('markServerProfileSynced / getServerProfileSyncMarker', () => {
  beforeEach(() => jest.clearAllMocks());

  test('marks profile synced with deviceId', async () => {
    await markServerProfileSynced('device999');

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PROFILE_SERVER_SYNC_MARKER_KEY,
      'device999'
    );
  });

  test('trims whitespace when marking sync', async () => {
    await markServerProfileSynced('  device999  ');

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PROFILE_SERVER_SYNC_MARKER_KEY,
      'device999'
    );
  });

  test('returns stored marker', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('device999');

    const marker = await getServerProfileSyncMarker();
    expect(marker).toBe('device999');
  });

  test('returns null when no marker stored', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const marker = await getServerProfileSyncMarker();
    expect(marker).toBeNull();
  });

  test('returns null on storage error', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('fail'));

    const marker = await getServerProfileSyncMarker();
    expect(marker).toBeNull();
  });
});

describe('restoreServerProfileLocally', () => {
  const OPTIONS = {
    passportPortraitStorageKey: 'emojipaint/passport-portrait',
  };

  beforeEach(() => jest.clearAllMocks());

  test('writes name and sync marker', async () => {
    const snapshot = makeSnapshot();
    await restoreServerProfileLocally(snapshot, OPTIONS);

    expect(AsyncStorage.multiSet).toHaveBeenCalledWith(
      expect.arrayContaining([
        [PROFILE_DISPLAY_NAME_STORAGE_KEY, 'TestUser'],
        [PROFILE_SERVER_SYNC_MARKER_KEY, 'device123'],
      ])
    );
  });

  test('writes portrait when present', async () => {
    const snapshot = makeSnapshot({ latestPortrait: 'https://example.com/p.png' });
    await restoreServerProfileLocally(snapshot, OPTIONS);

    expect(AsyncStorage.multiSet).toHaveBeenCalledWith(
      expect.arrayContaining([
        [OPTIONS.passportPortraitStorageKey, 'https://example.com/p.png'],
      ])
    );
  });

  test('skips portrait write when null', async () => {
    const snapshot = makeSnapshot({ latestPortrait: null });
    await restoreServerProfileLocally(snapshot, OPTIONS);

    const calls = (AsyncStorage.multiSet as jest.Mock).mock.calls[0][0] as [string, string][];
    const portraitEntry = calls.find(([key]) => key === OPTIONS.passportPortraitStorageKey);
    expect(portraitEntry).toBeUndefined();
  });

  test('writes serialized stats', async () => {
    const snapshot = makeSnapshot({ elapsedMs: 90000, strokeCount: 100, coinCount: 25 });
    await restoreServerProfileLocally(snapshot, OPTIONS);

    const statsEntry = (AsyncStorage.setItem as jest.Mock).mock.calls.find(
      ([key]: [string, string]) => key === GLOBAL_STATS_STORAGE_KEY
    ) as [string, string] | undefined;
    expect(statsEntry).toBeDefined();
    const stats = JSON.parse(statsEntry![1]);
    expect(stats.totalTimeMs).toBe(90000);
    expect(stats.totalStrokes).toBe(100);
    expect(stats.coins).toBe(25);
  });

  test('never regresses newer local lifetime totals during a server restore', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === GLOBAL_STATS_STORAGE_KEY
        ? JSON.stringify({ totalTimeMs: 180000, totalStrokes: 250, coins: 30 })
        : null
    );
    await restoreServerProfileLocally(
      makeSnapshot({ elapsedMs: 90000, strokeCount: 100, coinCount: 25 }),
      OPTIONS
    );

    const statsWrite = (AsyncStorage.setItem as jest.Mock).mock.calls.find(
      ([key]: [string, string]) => key === GLOBAL_STATS_STORAGE_KEY
    ) as [string, string] | undefined;
    expect(statsWrite).toBeDefined();
    const stats = JSON.parse(statsWrite![1]);
    expect(stats).toEqual(expect.objectContaining({
      totalTimeMs: 180000,
      totalStrokes: 250,
      coins: 30,
    }));
  });
});

describe('clearSyncedProfileIdentity', () => {
  beforeEach(() => jest.clearAllMocks());

  test('removes display name and sync marker', async () => {
    const { clearPassportSnapshots } = require('../lib/privateStudio');
    await clearSyncedProfileIdentity();

    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(
      expect.arrayContaining([
        PROFILE_DISPLAY_NAME_STORAGE_KEY,
        PROFILE_SERVER_SYNC_MARKER_KEY,
      ])
    );
    expect(clearPassportSnapshots).toHaveBeenCalled();
  });
});
