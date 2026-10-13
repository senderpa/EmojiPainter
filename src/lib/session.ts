import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = 'emojipaint/currentSessionId';
const SESSION_BOOT_MARK = 'emojipaint/sessionBootMarker';

let inMemorySessionId: string | null = null;

function makeSessionId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const id = `session-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return id;
}

export async function getSessionId(): Promise<string> {
  if (inMemorySessionId) return inMemorySessionId;
  try {
    // If there is a boot marker, we consider this the same app run. Otherwise, new session.
    const boot = await AsyncStorage.getItem(SESSION_BOOT_MARK);
    if (!boot) {
      // mark a fresh boot and intentionally create a new session id
      const fresh = makeSessionId();
      inMemorySessionId = fresh;
      await AsyncStorage.setItem(SESSION_KEY, fresh).catch(() => {});
      await AsyncStorage.setItem(SESSION_BOOT_MARK, String(Date.now())).catch(() => {});
      return fresh;
    }
    const existing = await AsyncStorage.getItem(SESSION_KEY);
    if (existing) {
      inMemorySessionId = existing;
      return existing;
    }
  } catch {}
  const fresh = makeSessionId();
  inMemorySessionId = fresh;
  try { await AsyncStorage.setItem(SESSION_KEY, fresh); } catch {}
  return fresh;
}

export async function resetSessionId(): Promise<void> {
  inMemorySessionId = null;
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
    await AsyncStorage.removeItem(SESSION_BOOT_MARK);
  } catch {}
}
