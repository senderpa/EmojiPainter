import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMysteryTopicPair, loadUsedTopics, markTopicsUsed, resetUsedTopics } from '../mysteryTopicPicker';
import { PREPARED_TOPICS } from '../preparedTopics';
import GesserApi from '../api/gesserClient';

const USED_TOPICS_KEY = '@mystery_used_topics';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn(),
  clear: jest.fn()
}));

jest.mock('../api/gesserClient', () => ({
  __esModule: true,
  default: {
    getRandomMysteryTopic: jest.fn()
  }
}));

const mockGetRandomMysteryTopic = GesserApi.getRandomMysteryTopic as jest.Mock;

describe('getMysteryTopicPair', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  test('returns two distinct topics from the API', async () => {
    mockGetRandomMysteryTopic
      .mockResolvedValueOnce({ ok: true, topicId: 1, topic: 'Pirate Ship' })
      .mockResolvedValueOnce({ ok: true, topicId: 2, topic: 'Moon Base' });

    const pair = await getMysteryTopicPair('device-1');

    expect(pair).toHaveLength(2);
    expect(pair[0].topic).toBe('Pirate Ship');
    expect(pair[1].topic).toBe('Moon Base');
    expect(pair[0].topic).not.toBe(pair[1].topic);
  });

  test('never shows the same topic in both slots even if API repeats itself', async () => {
    mockGetRandomMysteryTopic.mockResolvedValue({ ok: true, topicId: 7, topic: 'Pirate Ship' });

    const pair = await getMysteryTopicPair('device-1');

    expect(pair).toHaveLength(2);
    const keys = pair.map(p => p.topic.trim().toLowerCase());
    expect(new Set(keys).size).toBe(2);
    // Second slot must have been filled from the prepared pool
    expect(pair[1].topicId).toBeLessThan(0);
  });

  test('skips topics already shown before', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(['pirate ship']));
    mockGetRandomMysteryTopic
      .mockResolvedValueOnce({ ok: true, topicId: 1, topic: 'Pirate Ship' })
      .mockResolvedValueOnce({ ok: true, topicId: 2, topic: 'Moon Base' })
      .mockResolvedValueOnce({ ok: true, topicId: 3, topic: 'Lava Lake' });

    const pair = await getMysteryTopicPair('device-1');

    const topics = pair.map(p => p.topic);
    expect(topics).not.toContain('Pirate Ship');
    expect(topics).toContain('Moon Base');
    expect(topics).toContain('Lava Lake');
  });

  test('falls back to prepared topics when the API fails', async () => {
    mockGetRandomMysteryTopic.mockRejectedValue(new Error('network down'));

    const pair = await getMysteryTopicPair('device-1');

    expect(pair).toHaveLength(2);
    expect(pair[0].topicId).toBeLessThan(0);
    expect(pair[1].topicId).toBeLessThan(0);
    expect(pair[0].topic).not.toBe(pair[1].topic);
    expect(PREPARED_TOPICS).toContain(pair[0].topic);
    expect(PREPARED_TOPICS).toContain(pair[1].topic);
  });

  test('fallback topics exclude already-shown topics', async () => {
    mockGetRandomMysteryTopic.mockRejectedValue(new Error('network down'));
    // Mark all prepared topics used except two
    const allButTwo = PREPARED_TOPICS.slice(0, PREPARED_TOPICS.length - 2)
      .map(t => t.trim().toLowerCase());
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(allButTwo));

    const pair = await getMysteryTopicPair('device-1');
    const remaining = PREPARED_TOPICS.slice(-2).map(t => t.trim().toLowerCase());

    expect(pair).toHaveLength(2);
    expect(remaining).toContain(pair[0].topic.trim().toLowerCase());
    expect(remaining).toContain(pair[1].topic.trim().toLowerCase());
  });

  test('records shown topics so they are not repeated', async () => {
    mockGetRandomMysteryTopic
      .mockResolvedValueOnce({ ok: true, topicId: 1, topic: 'Pirate Ship' })
      .mockResolvedValueOnce({ ok: true, topicId: 2, topic: 'Moon Base' });

    await getMysteryTopicPair('device-1');

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      USED_TOPICS_KEY,
      JSON.stringify(['pirate ship', 'moon base'])
    );
  });

  test('assigns timeMinutes between 2 and 9', async () => {
    mockGetRandomMysteryTopic
      .mockResolvedValueOnce({ ok: true, topicId: 1, topic: 'Pirate Ship' })
      .mockResolvedValueOnce({ ok: true, topicId: 2, topic: 'Moon Base' });

    const pair = await getMysteryTopicPair('device-1');

    pair.forEach(p => {
      expect(p.timeMinutes).toBeGreaterThanOrEqual(2);
      expect(p.timeMinutes).toBeLessThanOrEqual(9);
    });
  });
});

describe('used-topic history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loadUsedTopics returns empty list on missing or corrupt data', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
    expect(await loadUsedTopics()).toEqual([]);

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('not-json{');
    expect(await loadUsedTopics()).toEqual([]);
  });

  test('markTopicsUsed merges, dedupes and normalizes', async () => {
    await markTopicsUsed(['pirate ship'], ['  Moon Base ', 'Pirate Ship']);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      USED_TOPICS_KEY,
      JSON.stringify(['pirate ship', 'moon base'])
    );
  });

  test('markTopicsUsed trims oldest entries beyond the history cap', async () => {
    const cap = Math.max(100, PREPARED_TOPICS.length - 100);
    const previous = Array.from({ length: cap }, (_, i) => `topic ${i}`);

    await markTopicsUsed(previous, ['newest topic']);

    const written = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
    expect(written).toHaveLength(cap);
    expect(written[written.length - 1]).toBe('newest topic');
    expect(written).not.toContain('topic 0');
  });

  test('resetUsedTopics removes the storage key', async () => {
    await resetUsedTopics();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(USED_TOPICS_KEY);
  });
});

describe('prepared topic pool', () => {
  test('contains the full curated set with no duplicates', () => {
    expect(PREPARED_TOPICS.length).toBe(999);
    const normalized = PREPARED_TOPICS.map(t => t.trim().toLowerCase());
    expect(new Set(normalized).size).toBe(PREPARED_TOPICS.length);
  });
});
