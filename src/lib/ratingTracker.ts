import AsyncStorage from '@react-native-async-storage/async-storage';

const RATING_KEYS = {
  STROKE_COUNT: '@emoji_painter/total_strokes',
  FIRST_UPLOAD: '@emoji_painter/first_upload',
  FIRST_EXPORT: '@emoji_painter/first_export',
  RATING_SHOWN: '@emoji_painter/rating_shown',
  USER_RATED: '@emoji_painter/user_rated',
  LAST_RATING_REQUEST: '@emoji_painter/last_rating_request',
  RATING_REQUEST_HISTORY: '@emoji_painter/rating_request_history'
};

const MIN_DAYS_BETWEEN_REQUESTS = 30; // Don't ask more than once per month
const MAX_REQUESTS_PER_YEAR = 3;
const REQUEST_HISTORY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const STROKE_MILESTONE = 1000;

export interface RatingMilestones {
  totalStrokes: number;
  hasUploadedToGallery: boolean;
  hasExportedFromFramerOrTimelapse: boolean;
  hasShownRating: boolean;
  userHasRated: boolean;
  lastRatingRequestDate: string | null;
  ratingRequestHistory: string[];
}

const parseRatingRequestHistory = (raw: string | null, lastRequest: string | null): string[] => {
  let history: unknown[] = [];
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      history = Array.isArray(parsed) ? parsed : [];
    } catch {
      history = [];
    }
  }

  const validHistory = history.filter((value): value is string =>
    typeof value === 'string' && Number.isFinite(new Date(value).getTime())
  );

  // Older installs only stored the last request. Count it as one request when
  // migrating to the rolling history format.
  if (validHistory.length === 0 && lastRequest && Number.isFinite(new Date(lastRequest).getTime())) {
    return [lastRequest];
  }
  return validHistory;
};

/**
 * Get current rating milestones from storage
 */
export async function getRatingMilestones(): Promise<RatingMilestones> {
  try {
    const [strokes, upload, exported, shown, rated, lastRequest, requestHistory] = await Promise.all([
      AsyncStorage.getItem(RATING_KEYS.STROKE_COUNT),
      AsyncStorage.getItem(RATING_KEYS.FIRST_UPLOAD),
      AsyncStorage.getItem(RATING_KEYS.FIRST_EXPORT),
      AsyncStorage.getItem(RATING_KEYS.RATING_SHOWN),
      AsyncStorage.getItem(RATING_KEYS.USER_RATED),
      AsyncStorage.getItem(RATING_KEYS.LAST_RATING_REQUEST),
      AsyncStorage.getItem(RATING_KEYS.RATING_REQUEST_HISTORY)
    ]);

    return {
      totalStrokes: strokes ? parseInt(strokes, 10) : 0,
      hasUploadedToGallery: upload === 'true',
      hasExportedFromFramerOrTimelapse: exported === 'true',
      hasShownRating: shown === 'true',
      userHasRated: rated === 'true',
      lastRatingRequestDate: lastRequest,
      ratingRequestHistory: parseRatingRequestHistory(requestHistory, lastRequest)
    };
  } catch (error) {
    console.error('[RatingTracker] Failed to get milestones:', error);
    return {
      totalStrokes: 0,
      hasUploadedToGallery: false,
      hasExportedFromFramerOrTimelapse: false,
      hasShownRating: false,
      userHasRated: false,
      lastRatingRequestDate: null,
      ratingRequestHistory: []
    };
  }
}

/**
 * Increment stroke count
 */
export async function incrementStrokeCount(count: number = 1): Promise<number> {
  try {
    const current = await AsyncStorage.getItem(RATING_KEYS.STROKE_COUNT);
    const newCount = (current ? parseInt(current, 10) : 0) + count;
    await AsyncStorage.setItem(RATING_KEYS.STROKE_COUNT, newCount.toString());
    return newCount;
  } catch (error) {
    console.error('[RatingTracker] Failed to increment stroke count:', error);
    return 0;
  }
}

/**
 * Mark that user uploaded to gallery for the first time
 */
export async function markFirstUpload(): Promise<void> {
  try {
    await AsyncStorage.setItem(RATING_KEYS.FIRST_UPLOAD, 'true');
    console.log('[RatingTracker] First gallery upload marked');
  } catch (error) {
    console.error('[RatingTracker] Failed to mark first upload:', error);
  }
}

/**
 * Mark that user exported from Framer or Timelapse for the first time
 */
export async function markFirstExport(): Promise<void> {
  try {
    await AsyncStorage.setItem(RATING_KEYS.FIRST_EXPORT, 'true');
    console.log('[RatingTracker] First export marked');
  } catch (error) {
    console.error('[RatingTracker] Failed to mark first export:', error);
  }
}

/**
 * Mark that rating overlay was shown
 */
export async function markRatingShown(): Promise<void> {
  try {
    const now = new Date().toISOString();
    const lastRequest = await AsyncStorage.getItem(RATING_KEYS.LAST_RATING_REQUEST);
    const storedHistory = await AsyncStorage.getItem(RATING_KEYS.RATING_REQUEST_HISTORY);
    const recentHistory = parseRatingRequestHistory(storedHistory, lastRequest)
      .filter((value) => Date.now() - new Date(value).getTime() < REQUEST_HISTORY_WINDOW_MS);
    recentHistory.push(now);

    await Promise.all([
      AsyncStorage.setItem(RATING_KEYS.RATING_SHOWN, 'true'),
      AsyncStorage.setItem(RATING_KEYS.LAST_RATING_REQUEST, now),
      AsyncStorage.setItem(RATING_KEYS.RATING_REQUEST_HISTORY, JSON.stringify(recentHistory))
    ]);
    console.log('[RatingTracker] Rating shown marked');
  } catch (error) {
    console.error('[RatingTracker] Failed to mark rating shown:', error);
  }
}

/**
 * Mark that user has rated the app
 */
export async function markUserRated(): Promise<void> {
  try {
    await AsyncStorage.setItem(RATING_KEYS.USER_RATED, 'true');
    console.log('[RatingTracker] User rated marked - will not show again');
  } catch (error) {
    console.error('[RatingTracker] Failed to mark user rated:', error);
  }
}

/**
 * Check if rating overlay should be shown
 */
export async function shouldShowRatingOverlay(): Promise<{ show: boolean; reason?: string }> {
  try {
    const milestones = await getRatingMilestones();

    // Never show if user already rated
    if (milestones.userHasRated) {
      return { show: false, reason: 'User already rated' };
    }

    const recentRequestCount = milestones.ratingRequestHistory.filter((value) =>
      Date.now() - new Date(value).getTime() < REQUEST_HISTORY_WINDOW_MS
    ).length;
    if (recentRequestCount >= MAX_REQUESTS_PER_YEAR) {
      return { show: false, reason: `Already requested ${MAX_REQUESTS_PER_YEAR} times in the last year` };
    }

    // Check if enough time has passed since last request
    if (milestones.lastRatingRequestDate) {
      const lastRequest = new Date(milestones.lastRatingRequestDate);
      const daysSinceLastRequest = (Date.now() - lastRequest.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastRequest < MIN_DAYS_BETWEEN_REQUESTS) {
        return { show: false, reason: `Only ${Math.floor(daysSinceLastRequest)} days since last request` };
      }
    }

    // Check milestones
    const reachedStrokeMilestone = milestones.totalStrokes >= STROKE_MILESTONE;
    const hasUploadedToGallery = milestones.hasUploadedToGallery;
    const hasExported = milestones.hasExportedFromFramerOrTimelapse;

    // Show if any milestone reached
    if (reachedStrokeMilestone) {
      return { show: true, reason: `Reached ${STROKE_MILESTONE} strokes` };
    }

    if (hasUploadedToGallery) {
      return { show: true, reason: 'First gallery upload' };
    }

    if (hasExported) {
      return { show: true, reason: 'First export' };
    }

    return { show: false, reason: 'No milestones reached yet' };
  } catch (error) {
    console.error('[RatingTracker] Failed to check if should show rating:', error);
    return { show: false, reason: 'Error checking milestones' };
  }
}

/**
 * Reset all rating tracking (for testing)
 */
export async function resetRatingTracking(): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.removeItem(RATING_KEYS.STROKE_COUNT),
      AsyncStorage.removeItem(RATING_KEYS.FIRST_UPLOAD),
      AsyncStorage.removeItem(RATING_KEYS.FIRST_EXPORT),
      AsyncStorage.removeItem(RATING_KEYS.RATING_SHOWN),
      AsyncStorage.removeItem(RATING_KEYS.USER_RATED),
      AsyncStorage.removeItem(RATING_KEYS.LAST_RATING_REQUEST),
      AsyncStorage.removeItem(RATING_KEYS.RATING_REQUEST_HISTORY)
    ]);
    console.log('[RatingTracker] All tracking data reset');
  } catch (error) {
    console.error('[RatingTracker] Failed to reset tracking:', error);
  }
}
