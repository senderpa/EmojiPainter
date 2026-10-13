import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { clearGalleryCache } from './galleryDatabase';
import { clearAllGalleryCache } from './galleryCacheManager';
import { clearPassportSnapshots } from './privateStudio';
import { clearDeviceIdentity } from './dailyDeviceId';
import {
  PROFILE_DISPLAY_NAME_STORAGE_KEY,
  PROFILE_SERVER_SYNC_MARKER_KEY,
  PROFILE_TERMS_ACCEPTED_KEY,
  PROFILE_TERMS_ACCEPTED_AT_KEY,
} from './profileSync';
import {
  clearProfileAuth,
  ensureProfileAuth,
  profileApiRequest,
  randomProfileHex,
} from './profileAuth';

const DELETE_REQUEST_KEY = 'emojipaint/profile/deletion-request:v1';

const appVersion = (): string =>
  String(Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? 'unknown').slice(0, 32);

export interface ProfileDeletionResult {
  ok: boolean;
  request_id: string;
  idempotent?: boolean;
  anonymized_posts?: number;
  storage_objects?: number;
  jobs?: { completed: number; failed: number };
}

export async function deleteProfileRemotely(deviceId: string): Promise<ProfileDeletionResult> {
  const token = await ensureProfileAuth(deviceId);
  let requestId = await AsyncStorage.getItem(DELETE_REQUEST_KEY);
  if (!requestId) {
    requestId = await randomProfileHex(16);
    await AsyncStorage.setItem(DELETE_REQUEST_KEY, requestId);
  }
  const result = await profileApiRequest<ProfileDeletionResult>('delete-profile.php', {
    device_id: deviceId,
    request_id: requestId,
    app_version: appVersion(),
  }, token);
  await AsyncStorage.removeItem(DELETE_REQUEST_KEY);
  return result;
}

/** Clear identity-bearing local state only; paintings and user-created projects remain. */
export async function clearDeletedProfileLocally(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const identityKeys = keys.filter((key) =>
    key === PROFILE_DISPLAY_NAME_STORAGE_KEY ||
    key === PROFILE_SERVER_SYNC_MARKER_KEY ||
    key === PROFILE_TERMS_ACCEPTED_KEY ||
    key === PROFILE_TERMS_ACCEPTED_AT_KEY ||
    key.startsWith('emojipaint/profile/') ||
    key.startsWith('emojipaint:passport') ||
    key.startsWith('@passport') ||
    key.startsWith('gesser/')
  );
  await AsyncStorage.multiRemove([...new Set(identityKeys), DELETE_REQUEST_KEY]);
  await Promise.allSettled([
    clearPassportSnapshots(),
    clearGalleryCache(),
    clearAllGalleryCache(),
    Notifications.cancelAllScheduledNotificationsAsync(),
    clearProfileAuth(),
    clearDeviceIdentity(),
  ]);
}
