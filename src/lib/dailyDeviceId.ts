import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const PRIMARY_STORAGE_KEY = 'emojipaint/daily-device-id';
const SECONDARY_STORAGE_KEY = 'daily-device-id';
const LEGACY_STORAGE_KEYS = ['emojipaint-device-id'];
const PROFILE_SERVER_SYNC_MARKER_KEY = 'emojipaint/profile/server-sync-marker';
// Keychain key — survives app deletion/reinstall on iOS
const KEYCHAIN_KEY = 'emojipaint_device_id';
const DEVICE_ID_LENGTH = 16;

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

const sanitizeCandidate = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length >= 8 && trimmed.length <= 96 && /^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
};

const readDeviceId = async (key: string): Promise<string | null> => {
  try {
    const stored = await AsyncStorage.getItem(key);
    return sanitizeCandidate(stored);
  } catch {
    return null;
  }
};

const writeDeviceId = async (key: string, value: string): Promise<void> => {
  const sanitized = sanitizeCandidate(value);
  if (!sanitized) return;
  try {
    await AsyncStorage.setItem(key, sanitized);
  } catch {
    // ignore
  }
};

const readKeychainId = async (): Promise<string | null> => {
  try {
    const stored = await SecureStore.getItemAsync(KEYCHAIN_KEY);
    return sanitizeCandidate(stored);
  } catch {
    return null;
  }
};

const writeKeychainId = async (value: string): Promise<void> => {
  const sanitized = sanitizeCandidate(value);
  if (!sanitized) return;
  try {
    await SecureStore.setItemAsync(KEYCHAIN_KEY, sanitized);
  } catch {
    // ignore on platforms that don't support Keychain
  }
};

const createDeviceId = async (): Promise<string> => {
  const bytes = await Crypto.getRandomBytesAsync(DEVICE_ID_LENGTH);
  return bytesToHex(bytes);
};

export async function getOrCreateDailyDeviceId(): Promise<string> {
  // 1. If the user restored/synced a server profile, that profile id owns
  // gallery uploads. Backfill the regular stores so all upload paths agree.
  const syncedProfileId = await readDeviceId(PROFILE_SERVER_SYNC_MARKER_KEY);
  if (syncedProfileId) {
    await writeDeviceId(PRIMARY_STORAGE_KEY, syncedProfileId);
    await writeDeviceId(SECONDARY_STORAGE_KEY, syncedProfileId);
    await writeKeychainId(syncedProfileId);
    return syncedProfileId;
  }

  // 2. Check Keychain first — survives reinstalls
  const keychainId = await readKeychainId();
  if (keychainId) {
    // Backfill AsyncStorage so reads are fast on subsequent calls
    await writeDeviceId(PRIMARY_STORAGE_KEY, keychainId);
    return keychainId;
  }

  // 3. Fall back to AsyncStorage (existing installs)
  const primary = await readDeviceId(PRIMARY_STORAGE_KEY);
  if (primary) {
    await writeKeychainId(primary);
    return primary;
  }

  const secondary = await readDeviceId(SECONDARY_STORAGE_KEY);
  if (secondary) {
    await writeDeviceId(PRIMARY_STORAGE_KEY, secondary);
    await writeKeychainId(secondary);
    return secondary;
  }

  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    const legacy = await readDeviceId(legacyKey);
    if (legacy) {
      await writeDeviceId(PRIMARY_STORAGE_KEY, legacy);
      await writeDeviceId(SECONDARY_STORAGE_KEY, legacy);
      await writeKeychainId(legacy);
      return legacy;
    }
  }

  // 4. Generate new ID and persist to both Keychain and AsyncStorage
  const generated = await createDeviceId();
  const sanitized = sanitizeCandidate(generated) ?? generated;
  await writeDeviceId(PRIMARY_STORAGE_KEY, sanitized);
  await writeDeviceId(SECONDARY_STORAGE_KEY, sanitized);
  await writeKeychainId(sanitized);
  return sanitized;
}

export async function regenerateDeviceId(): Promise<string> {
  const generated = await createDeviceId();
  const sanitized = sanitizeCandidate(generated) ?? generated;
  await writeDeviceId(PRIMARY_STORAGE_KEY, sanitized);
  await writeDeviceId(SECONDARY_STORAGE_KEY, sanitized);
  await writeKeychainId(sanitized);
  return sanitized;
}

/** Permanently detach this installation from the deleted server profile. */
export async function clearDeviceIdentity(): Promise<void> {
  await AsyncStorage.multiRemove([
    PRIMARY_STORAGE_KEY,
    SECONDARY_STORAGE_KEY,
    ...LEGACY_STORAGE_KEYS,
  ]);
  try {
    await SecureStore.deleteItemAsync(KEYCHAIN_KEY);
  } catch {
    // SecureStore is unavailable in some test/web environments.
  }
}

export const ensureDeviceId = getOrCreateDailyDeviceId;
