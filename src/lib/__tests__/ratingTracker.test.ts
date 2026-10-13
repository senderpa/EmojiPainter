import AsyncStorage from '@react-native-async-storage/async-storage';
import { markFirstUpload, shouldShowRatingOverlay } from '../ratingTracker';

const storage = new Map<string, string>();

describe('rating frequency guard', () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => storage.get(key) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
      storage.delete(key);
    });
  });

  it('does not show more than three automatic requests in one year', async () => {
    const now = Date.now();
    const requests = [40, 80, 120].map((daysAgo) => new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString());
    storage.set('@emoji_painter/first_upload', 'true');
    storage.set('@emoji_painter/last_rating_request', requests[0]);
    storage.set('@emoji_painter/rating_request_history', JSON.stringify(requests));

    const result = await shouldShowRatingOverlay();

    expect(result).toEqual({
      show: false,
      reason: 'Already requested 3 times in the last year'
    });
  });

  it('still recognizes the upload milestone for an eligible request', async () => {
    await markFirstUpload();

    await expect(shouldShowRatingOverlay()).resolves.toEqual({
      show: true,
      reason: 'First gallery upload'
    });
  });
});
