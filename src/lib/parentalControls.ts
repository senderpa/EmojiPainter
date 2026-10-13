import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

export interface ParentalControlsSettings {
  enabled: boolean;
  pinHash: string;
  pinSalt: string;
  offlineMode: boolean;
  dailyTimeLimitMinutes: number | null; // null = no limit
  allowDailyChallenges: boolean;
  allowMysteryChallenge: boolean;
  allowGalleryView: boolean;
  allowUploads: boolean;
  setupComplete: boolean;
}

const STORAGE_KEY = '@parental_controls_v1';
const USAGE_KEY = '@parental_usage_v1';

export const DEFAULT_PARENTAL_SETTINGS: ParentalControlsSettings = {
  enabled: false,
  pinHash: '',
  pinSalt: '',
  offlineMode: false,
  dailyTimeLimitMinutes: null,
  allowDailyChallenges: true,
  allowMysteryChallenge: true,
  allowGalleryView: true,
  allowUploads: true,
  setupComplete: false,
};

export async function loadParentalControls(): Promise<ParentalControlsSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PARENTAL_SETTINGS };
    return { ...DEFAULT_PARENTAL_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PARENTAL_SETTINGS };
  }
}

export async function saveParentalControls(settings: ParentalControlsSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${pin}:${salt}:emojipaint`
  );
}

export async function createPinSettings(
  settings: ParentalControlsSettings,
  pin: string
): Promise<ParentalControlsSettings> {
  const saltBytes = await Crypto.getRandomBytesAsync(16);
  const salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const pinHash = await hashPin(pin, salt);
  return { ...settings, pinHash, pinSalt: salt };
}

export async function validatePin(
  settings: ParentalControlsSettings,
  inputPin: string
): Promise<boolean> {
  if (!settings.pinHash || !settings.pinSalt) return false;
  const hash = await hashPin(inputPin, settings.pinSalt);
  return hash === settings.pinHash;
}

// ── Daily usage tracking ──────────────────────────────────────────────────────

interface UsageRecord {
  date: string; // YYYY-MM-DD
  totalMs: number;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export async function getDailyUsageMs(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    if (!raw) return 0;
    const record: UsageRecord = JSON.parse(raw);
    return record.date === todayStr() ? record.totalMs : 0;
  } catch {
    return 0;
  }
}

export async function addDailyUsageMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  try {
    const today = todayStr();
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    const prev: UsageRecord = raw ? JSON.parse(raw) : { date: today, totalMs: 0 };
    const totalMs = prev.date === today ? prev.totalMs + ms : ms;
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify({ date: today, totalMs }));
  } catch {
    // ignore
  }
}

export function isTimeLimitExceeded(
  settings: ParentalControlsSettings,
  usageMs: number
): boolean {
  if (!settings.enabled || settings.dailyTimeLimitMinutes === null) return false;
  return usageMs >= settings.dailyTimeLimitMinutes * 60 * 1000;
}

export function formatUsageTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
