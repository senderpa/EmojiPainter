import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDailyPrompts } from '../lib/dailyTopics';
import { formatPrompt } from '../types/dailyPrompt';
import { hasAcceptedProfileTerms } from '../lib/profileTermsConsent';
import type { GalleryVoteUpdate } from '../lib/galleryVoteUpdates';
import { formatGalleryVoteUpdate } from '../lib/galleryVoteUpdates';

const NOTIFICATIONS_ENABLED_KEY = '@notifications_enabled';
const NOTIFICATIONS_ASKED_KEY = '@notifications_asked';
const LANGUAGE_PREFERENCE_KEY = '@emojipaint/language_preference';
const DAILY_CHALLENGE_NOTIF_ID = 'daily-challenge-reminder';
const TOPIC_NOTIFICATION_SCHEDULED_DAY_KEY = '@notifications_topic_scheduled_day';

type SupportedLanguage = 'en' | 'de' | 'ru' | 'zh' | 'ko' | 'ja' | 'fr' | 'it';

const NOTIFICATION_TITLES: Record<SupportedLanguage, string> = {
  en: 'Time to paint your daily topic challenge!',
  de: 'Zeit, dein tägliches Thema zu malen!',
  ru: 'Время рисовать дневное задание!',
  zh: '是时候画今天的主题挑战了！',
  ko: '오늘의 주제 챌린지를 그릴 시간입니다!',
  ja: '今日のトピックチャレンジを描く時間です！',
  fr: "C'est l'heure de peindre le défi du jour !",
  it: 'È ora di dipingere la sfida quotidiana!',
};

// One of these windows is selected for the single daily topic reminder.
const DELIVERY_WINDOWS = [
  { start: 8,  end: 10 }, // morning
  { start: 12, end: 14 }, // lunch
  { start: 18, end: 20 }, // evening
] as const;

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const action = notification.request.content.data?.action;
    const isVoteUpdate = action === 'gallery_votes_changed';
    return {
      // Topic reminders stay quiet while the app is already open. A freshly
      // detected vote change is useful in the foreground, so it gets a banner.
      shouldShowAlert: isVoteUpdate,
      shouldPlaySound: isVoteUpdate,
      shouldSetBadge: false,
    };
  },
});

const isTopicNotification = (notification: Notifications.NotificationRequest): boolean =>
  notification.identifier === DAILY_CHALLENGE_NOTIF_ID ||
  notification.content.data?.action === 'open_topic_challenge';

const isCurrentSingleTopicNotification = (notification: Notifications.NotificationRequest): boolean =>
  notification.identifier === DAILY_CHALLENGE_NOTIF_ID &&
  notification.content.data?.action === 'open_topic_challenge' &&
  typeof notification.content.data?.topic === 'string' &&
  notification.content.data.topic.trim().length > 0;

const localDayKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const notificationService = {
  async hasBeenAsked(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(NOTIFICATIONS_ASKED_KEY)) === 'true';
    } catch {
      return false;
    }
  },

  async markAsAsked(): Promise<void> {
    try {
      await AsyncStorage.setItem(NOTIFICATIONS_ASKED_KEY, 'true');
    } catch {
      // ignore
    }
  },

  async areEnabled(): Promise<boolean> {
    try {
      // A stale notification opt-in from an older app version must not remain
      // active after the content terms version changes.
      if (!(await hasAcceptedProfileTerms())) return false;
      return (await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY)) === 'true';
    } catch {
      return false;
    }
  },

  async requestPermissionsAndEnable(): Promise<boolean> {
    try {
      // Never trigger Apple's permission sheet before the user has accepted the
      // terms governing the online Daily Challenge links in these reminders.
      // Callers show our terms sheet first; this is the final safety boundary.
      if (!(await hasAcceptedProfileTerms())) {
        await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
        return false;
      }
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
        return false;
      }

      await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'true');
      await this.markAsAsked();
      await this.scheduleNotifications();
      return true;
    } catch {
      return false;
    }
  },

  async disable(): Promise<void> {
    try {
      await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {
      // ignore
    }
  },

  async cancelTopicNotifications(): Promise<void> {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter(isTopicNotification)
        .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier))
    );
  },

  async getLang(): Promise<SupportedLanguage> {
    try {
      const saved = await AsyncStorage.getItem(LANGUAGE_PREFERENCE_KEY);
      if (saved && ['en', 'de', 'ru', 'zh', 'ko', 'ja', 'fr', 'it'].includes(saved)) {
        return saved as SupportedLanguage;
      }
    } catch {
      // ignore
    }
    return 'en';
  },

  /**
   * Returns the next future Date for a given hour:minute.
   * If that time has already passed today (or is within 5 minutes), uses tomorrow.
   * This guarantees the trigger is always in the future — no immediate fire.
   */
  nextFireDate(hour: number, minute: number): Date {
    const now = new Date();
    const fire = new Date(now);
    fire.setHours(hour, minute, 0, 0);
    // 5-minute buffer so a freshly scheduled notification doesn't fire instantly
    if (fire.getTime() <= now.getTime() + 5 * 60 * 1000) {
      fire.setDate(fire.getDate() + 1);
    }
    return fire;
  },

  /**
   * Schedule exactly one topic notification per day. One of today's three
   * prompts and one delivery window are chosen; the other two prompts do not
   * create notifications. It is a one-shot, so the next online app launch
   * schedules the next future reminder after it has fired.
   */
  async scheduleNotifications(): Promise<void> {
    try {
      await this.cancelTopicNotifications();

      const enabled = await this.areEnabled();
      if (!enabled) return;

      const lang = await this.getLang();
      const title = NOTIFICATION_TITLES[lang];
      const prompts = getDailyPrompts(new Date());
      if (prompts.length === 0) return;

      const promptIndex = Math.floor(Math.random() * Math.min(3, prompts.length));
      const prompt = prompts[promptIndex];
      const win = DELIVERY_WINDOWS[Math.floor(Math.random() * DELIVERY_WINDOWS.length)];
      const topic = formatPrompt(prompt, lang);

      const spanMinutes = (win.end - win.start) * 60;
      const offsetMinutes = Math.floor(Math.random() * spanMinutes);
      const totalMinutes = win.start * 60 + offsetMinutes;
      const hour = Math.floor(totalMinutes / 60);
      const minute = totalMinutes % 60;

      const fireDate = this.nextFireDate(hour, minute);
      const lastScheduledDay = await AsyncStorage.getItem(TOPIC_NOTIFICATION_SCHEDULED_DAY_KEY);
      // If today's one reminder already fired (and therefore disappeared from
      // iOS's pending list), never create a second one later the same day.
      if (lastScheduledDay === localDayKey(fireDate)) {
        fireDate.setDate(fireDate.getDate() + 1);
      }

      await Notifications.scheduleNotificationAsync({
        identifier: DAILY_CHALLENGE_NOTIF_ID,
        content: {
          title,
          body: topic,
          data: { action: 'open_topic_challenge', topic, promptIndex },
          sound: true,
        },
        trigger: { date: fireDate } as any,
      });
      await AsyncStorage.setItem(TOPIC_NOTIFICATION_SCHEDULED_DAY_KEY, localDayKey(fireDate));

      console.log(`[Notifications] Scheduled one daily topic at ${fireDate.toLocaleTimeString()} — ${topic}`);
    } catch (error) {
      console.error('[Notifications] Error scheduling:', error);
    }
  },

  /**
   * Initialize on app start. Only schedules if nothing is pending —
   * prevents any immediate fire from re-scheduling at the current moment.
   */
  async initialize(): Promise<void> {
    try {
      const enabled = await this.areEnabled();
      if (!enabled) return;

      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await this.disable();
        return;
      }

      const pending = await Notifications.getAllScheduledNotificationsAsync();
      const topicNotifications = pending.filter(isTopicNotification);
      if (
        topicNotifications.length !== 1 ||
        !isCurrentSingleTopicNotification(topicNotifications[0])
      ) {
        await this.scheduleNotifications();
      }
    } catch (error) {
      console.error('[Notifications] Error initializing:', error);
    }
  },

  /**
   * Compatibility entry point retained for existing callers. It now only
   * ensures the single one-shot topic reminder exists; it never adds a second
   * repeating 9 AM notification.
   */
  async scheduleDailyChallengeReminder(): Promise<void> {
    try {
      const enabled = await this.areEnabled();
      if (!enabled) return;

      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return;

      const pending = await Notifications.getAllScheduledNotificationsAsync();
      const topicNotifications = pending.filter(isTopicNotification);
      if (topicNotifications.length === 1 && isCurrentSingleTopicNotification(topicNotifications[0])) return;
      await this.scheduleNotifications();
    } catch (error) {
      console.error('[Notifications] Error scheduling daily challenge reminder:', error);
    }
  },

  /**
   * Fire an immediate local notification telling the owner that someone
   * solved their mystery painting.  Safe to call multiple times for the same
   * painting — the caller is responsible for deduplication via the
   * `notifiedSolvedMysteries` ref in PaintScreen.
   */
  async notifyMysterySolved(): Promise<void> {
    try {
      const enabled = await this.areEnabled();
      if (!enabled) return;

      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Mystery solved! 🕵️',
          body: 'Someone guessed your mystery painting!',
          data: { action: 'open_mystery_gallery' },
          sound: true,
        },
        trigger: { seconds: 1 } as any,
      });

      console.log('[Notifications] Mystery-solved notification scheduled');
    } catch (error) {
      console.error('[Notifications] Error scheduling mystery-solved notification:', error);
    }
  },

  async notifyGalleryVoteChange(update: GalleryVoteUpdate): Promise<boolean> {
    try {
      const enabled = await this.areEnabled();
      if (!enabled) return false;

      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return false;

      const summary = formatGalleryVoteUpdate(update);
      const hasNewVotes = update.newUpvotes + update.newDownvotes > 0;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: hasNewVotes ? 'Your artwork received new votes! 🎨' : "Your artwork's votes changed! 🎨",
          body: `${summary.changeText} ${summary.totalText}`,
          data: { action: 'gallery_votes_changed' },
          sound: true,
        },
        trigger: { seconds: 1 } as any,
      });
      return true;
    } catch (error) {
      console.error('[Notifications] Gallery-vote notification failed:', error);
      return false;
    }
  },

  async notifyLevelStreakUnlocked(streakDays: number): Promise<void> {
    try {
      const enabled = await this.areEnabled();
      if (!enabled) return;

      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${streakDays}-day painting streak`,
          body: 'Keep going: higher profile levels now ask for longer daily streaks.',
          data: { action: 'open_profile_level' },
          sound: true,
        },
        trigger: { seconds: 1 } as any,
      });

      console.log('[Notifications] Level-streak notification scheduled');
    } catch (error) {
      console.error('[Notifications] Error scheduling level-streak notification:', error);
    }
  },

  addNotificationResponseListener(
    callback: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(callback);
  },
};
