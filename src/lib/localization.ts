/**
 * Safe wrapper for expo-localization
 * Handles cases where the native module might not be available
 */

let Localization: typeof import('expo-localization') | null = null;

try {
  Localization = require('expo-localization');
} catch (error) {
  console.warn('[Localization] Module not available:', error);
  Localization = null;
}

export const getLocales = (): Array<any> => {
  try {
    if (Localization && typeof Localization.getLocales === 'function') {
      return Localization.getLocales();
    }
  } catch (error) {
    console.warn('[Localization] getLocales failed:', error);
  }

  // Return default English locale
  return [{
    languageCode: 'en',
    languageTag: 'en-US',
    regionCode: 'US',
  }];
};

export const getCalendars = (): Array<any> => {
  try {
    if (Localization && typeof Localization.getCalendars === 'function') {
      return Localization.getCalendars();
    }
  } catch (error) {
    console.warn('[Localization] getCalendars failed:', error);
  }

  // Return default calendar settings
  return [{
    calendar: 'gregorian',
    timeZone: 'UTC',
    uses24hourClock: false,
    firstWeekday: 1,
  }];
};

export default {
  getLocales,
  getCalendars,
};
