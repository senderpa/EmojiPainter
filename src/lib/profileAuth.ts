import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const API_BASE = 'https://emojipainter.com/api/gesser';
export const PROFILE_TOKEN_KEY = 'emojipaint/profile/auth-token:v1';

export const randomProfileHex = async (bytes = 32): Promise<string> =>
  Array.from(await Crypto.getRandomBytesAsync(bytes))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

async function profileToken(): Promise<string> {
  const stored = await SecureStore.getItemAsync(PROFILE_TOKEN_KEY);
  if (stored && stored.length >= 32) return stored;
  const created = await randomProfileHex();
  await SecureStore.setItemAsync(PROFILE_TOKEN_KEY, created, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return created;
}

export async function profileApiRequest<T>(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureProfileAuth(deviceId: string): Promise<string> {
  const token = await profileToken();
  await profileApiRequest('profile-auth.php', {
    device_id: deviceId,
    profile_token: token,
  });
  return token;
}

export async function clearProfileAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(PROFILE_TOKEN_KEY);
}
