import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hasCompletedMysteryToday,
  markMysteryPaintCompleted,
  hasGuessedMystery,
  markMysteryGuessed,
  loadGesserState,
  saveGesserState
} from '../utils/storage';

const STORAGE_KEY = 'emojipaint/gesser/state';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn(),
  clear: jest.fn()
}));

const DEFAULT_STATE = {
  lastMysteryPaintDate: undefined,
  pendingTopicReviews: [],
  lastTopicSuggestTime: undefined,
  guessedMysteryIds: [],
  cachedMysteryImages: [],
  lastCacheUpdate: undefined
};

describe('Mystery Paint Daily Limit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('hasCompletedMysteryToday returns false when no data', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const result = await hasCompletedMysteryToday();
    expect(result).toBe(false);
  });

  test('hasCompletedMysteryToday returns true when completed today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_STATE, lastMysteryPaintDate: today })
    );

    const result = await hasCompletedMysteryToday();
    expect(result).toBe(true);
  });

  test('hasCompletedMysteryToday returns false when completed yesterday', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_STATE, lastMysteryPaintDate: yesterday })
    );

    const result = await hasCompletedMysteryToday();
    expect(result).toBe(false);
  });

  test('markMysteryPaintCompleted persists todays date via saveGesserState', async () => {
    const today = new Date().toISOString().slice(0, 10);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    await markMysteryPaintCompleted();

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.stringContaining(today)
    );
  });
});

describe('Mystery Guess Tracking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('hasGuessedMystery returns false when no guesses', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const result = await hasGuessedMystery(123);
    expect(result).toBe(false);
  });

  test('hasGuessedMystery returns true when already guessed', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_STATE, guessedMysteryIds: [123, 456] })
    );

    const result = await hasGuessedMystery(123);
    expect(result).toBe(true);
  });

  test('hasGuessedMystery returns false for different mystery', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_STATE, guessedMysteryIds: [123, 456] })
    );

    const result = await hasGuessedMystery(789);
    expect(result).toBe(false);
  });

  test('markMysteryGuessed adds mystery to list', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_STATE, guessedMysteryIds: [123] })
    );

    await markMysteryGuessed(456);

    const savedArg = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const saved = JSON.parse(savedArg);
    expect(saved.guessedMysteryIds).toContain(123);
    expect(saved.guessedMysteryIds).toContain(456);
  });

  test('markMysteryGuessed creates new list if none exists', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    await markMysteryGuessed(123);

    const savedArg = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const saved = JSON.parse(savedArg);
    expect(saved.guessedMysteryIds).toContain(123);
  });

  test('markMysteryGuessed does not add duplicate (no save called)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_STATE, guessedMysteryIds: [123] })
    );

    await markMysteryGuessed(123);

    // 123 is already in the list — saveGesserState should NOT be called
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('Gesser State Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loadGesserState returns default state when no data', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const state = await loadGesserState();

    expect(state).toMatchObject({
      pendingTopicReviews: [],
      guessedMysteryIds: [],
      cachedMysteryImages: [],
    });
  });

  test('loadGesserState returns stored state merged with defaults', async () => {
    const storedState = {
      guessedMysteryIds: [1, 2, 3],
      lastMysteryPaintDate: '2026-05-29',
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(storedState));

    const state = await loadGesserState();

    expect(state.guessedMysteryIds).toEqual([1, 2, 3]);
    expect(state.lastMysteryPaintDate).toBe('2026-05-29');
    expect(state.pendingTopicReviews).toEqual([]);
  });

  test('loadGesserState handles corrupt data gracefully', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('invalid json');

    const state = await loadGesserState();

    expect(state).toMatchObject({
      pendingTopicReviews: [],
      guessedMysteryIds: [],
    });
  });

  test('saveGesserState stores state as JSON at correct key', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    await saveGesserState({ guessedMysteryIds: [5, 6, 7] });

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.any(String)
    );
    const savedArg = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const saved = JSON.parse(savedArg);
    expect(saved.guessedMysteryIds).toEqual([5, 6, 7]);
  });

  test('saveGesserState merges with existing state', async () => {
    const existing = { ...DEFAULT_STATE, guessedMysteryIds: [1] };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(existing));

    await saveGesserState({ lastMysteryPaintDate: '2026-05-29' });

    const savedArg = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const saved = JSON.parse(savedArg);
    expect(saved.guessedMysteryIds).toEqual([1]);
    expect(saved.lastMysteryPaintDate).toBe('2026-05-29');
  });
});
