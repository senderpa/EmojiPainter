import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { uploadDailyPaintSprint } from '../lib/dailyPaintUpload';
import { uploadPrivateStudioPassport } from '../lib/privateStudio';
import { hasAcceptedProfileTerms } from '../lib/profileTermsConsent';
import { notificationService } from '../services/notificationService';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
}));

jest.mock('../lib/profileTermsConsent', () => ({
  PROFILE_TERMS_VERSION: 'test-terms-version',
  hasAcceptedProfileTerms: jest.fn(),
}));

jest.mock('../lib/dailyDeviceId', () => ({
  getOrCreateDailyDeviceId: jest.fn().mockResolvedValue('device-test'),
  ensureDeviceId: jest.fn().mockResolvedValue('device-test'),
}));

describe('online consent safety boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (hasAcceptedProfileTerms as jest.Mock).mockResolvedValue(false);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    global.fetch = jest.fn();
  });

  test('blocks Daily and Mystery uploads before any request', async () => {
    await expect(uploadDailyPaintSprint({
      imageUri: 'file:///painting.png',
      topic: 'Test topic',
      startedAtMs: 1_000,
      endedAtMs: 31_000,
      isMysteryPaint: true,
    })).rejects.toThrow(/accept/i);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('blocks profile/passport uploads before any request', async () => {
    await expect(uploadPrivateStudioPassport({
      name: 'Painter',
      totalSeconds: 10,
      totalStrokes: 20,
      portraitDataUrl: 'data:image/png;base64,abc',
    })).rejects.toThrow(/accept/i);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('does not show the native notification prompt before consent', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('true');

    await expect(notificationService.areEnabled()).resolves.toBe(false);
    await expect(notificationService.requestPermissionsAndEnable()).resolves.toBe(false);

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@notifications_enabled', 'false');
  });
});
