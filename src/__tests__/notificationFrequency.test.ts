import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { hasAcceptedProfileTerms } from '../lib/profileTermsConsent';
import { notificationService } from '../services/notificationService';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
}));

jest.mock('../lib/profileTermsConsent', () => ({
  hasAcceptedProfileTerms: jest.fn(),
}));

jest.mock('../lib/dailyTopics', () => ({
  getDailyPrompts: jest.fn(() => [
    { emoji: '🌊', topic: 'Ocean', timeMinutes: 30 },
    { emoji: '🌙', topic: 'Moon', timeMinutes: 30 },
    { emoji: '🌳', topic: 'Forest', timeMinutes: 30 },
  ]),
}));

jest.mock('../types/dailyPrompt', () => ({
  formatPrompt: (prompt: { emoji: string; topic: string }) => `${prompt.emoji} ${prompt.topic}`,
}));

describe('notification frequency', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
    (hasAcceptedProfileTerms as jest.Mock).mockResolvedValue(true);
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([]);
    (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('daily-challenge-reminder');
    storage.set('@notifications_enabled', 'true');
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => storage.get(key) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('schedules only one of the three daily topics', async () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);

    await notificationService.scheduleNotifications();

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      identifier: 'daily-challenge-reminder',
      content: expect.objectContaining({
        body: '🌊 Ocean',
        data: expect.objectContaining({ action: 'open_topic_challenge', promptIndex: 0 }),
      }),
    }));
  });

  test('never schedules a second topic reminder on a day that already had one', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 13, 10, 0, 0));
    storage.set('@notifications_topic_scheduled_day', '2026-08-13');
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // lunch window, still today

    await notificationService.scheduleNotifications();

    const request = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(request.trigger.date).toBeInstanceOf(Date);
    expect(request.trigger.date.getDate()).toBe(14);
    expect(storage.get('@notifications_topic_scheduled_day')).toBe('2026-08-14');
  });

  test('keeps an existing single current-format topic reminder without adding another', async () => {
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([{
      identifier: 'daily-challenge-reminder',
      content: { data: { action: 'open_topic_challenge', topic: '🌙 Moon' } },
    }]);

    await notificationService.initialize();

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});
