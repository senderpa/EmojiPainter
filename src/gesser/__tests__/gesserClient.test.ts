import GesserApi from '../api/gesserClient';

global.fetch = jest.fn();

const mockJsonResponse = (body: object, ok = true) => ({
  ok,
  headers: { get: jest.fn().mockReturnValue('application/json') },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('GesserApi - Topic Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('submitTopicSuggestion', () => {
    test('sends correct request to submit topic', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, message: 'Topic submitted', coinsAwarded: 10 })
      );

      const result = await GesserApi.submitTopicSuggestion('device123', 'Space Whale');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/suggest-topic.php'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: 'device123', topic: 'Space Whale' })
        })
      );

      expect(result.ok).toBe(true);
      expect(result.coinsAwarded).toBe(10);
    });

    test('handles API error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: false, error: 'Duplicate topic' }, false)
      );

      await expect(
        GesserApi.submitTopicSuggestion('device123', 'Space Whale')
      ).rejects.toThrow('Duplicate topic');
    });

    test('handles network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(
        GesserApi.submitTopicSuggestion('device123', 'Space Whale')
      ).rejects.toThrow('Network error');
    });
  });

  describe('getPendingTopic', () => {
    test('fetches pending topic successfully', async () => {
      const mockTopic = { id: 1, topic: 'Fire Dragon', submittedAt: '2026-02-07T00:00:00Z' };

      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, hasPending: true, topic: mockTopic })
      );

      const result = await GesserApi.getPendingTopic('device123');

      expect(result.hasPending).toBe(true);
      expect(result.topic).toEqual(mockTopic);
    });

    test('handles no pending topics', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, hasPending: false })
      );

      const result = await GesserApi.getPendingTopic('device123');

      expect(result.hasPending).toBe(false);
      expect(result.topic).toBeUndefined();
    });
  });

  describe('approveTopic', () => {
    test('approves topic successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, message: 'Topic approved', coinsAwarded: 5 })
      );

      const result = await GesserApi.approveTopic('device123', 1, 'approve');

      expect(result.ok).toBe(true);
      expect(result.coinsAwarded).toBe(5);
    });

    test('rejects topic successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, message: 'Topic rejected', coinsAwarded: 5 })
      );

      const result = await GesserApi.approveTopic('device123', 1, 'reject');

      expect(result.ok).toBe(true);
      expect(result.message).toContain('rejected');
    });
  });
});

describe('GesserApi - Mystery Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRandomMysteryTopic', () => {
    test('fetches random mystery topic', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, topicId: 5, topic: 'Space Whale', source: 'user' })
      );

      const result = await GesserApi.getRandomMysteryTopic('device123');

      expect(result.topicId).toBe(5);
      expect(result.topic).toBe('Space Whale');
      expect(result.source).toBe('user');
    });

    test('handles daily limit error', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: false, error: 'Already painted mystery today' }, false)
      );

      await expect(
        GesserApi.getRandomMysteryTopic('device123')
      ).rejects.toThrow('Already painted mystery today');
    });
  });

  describe('listMysteryImages', () => {
    test('fetches mystery images with filter', async () => {
      const mockImages = [
        { id: 1, imageUrl: 'https://example.com/1.png', maskedTopic: '_pace _hale', isSolved: false, totalAttempts: 5 },
        { id: 2, imageUrl: 'https://example.com/2.png', maskedTopic: 'fire _r_gon', isSolved: true, solverName: 'Alice', totalAttempts: 10 }
      ];

      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, items: mockImages, count: 2 })
      );

      const result = await GesserApi.listMysteryImages('device123', 'unsolved', 50);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].maskedTopic).toBeDefined();
      expect(result.items[1].isSolved).toBe(true);
    });
  });

  describe('submitGuess', () => {
    test('submits correct guess', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({
          ok: true,
          correct: true,
          message: 'Correct!',
          actualTopic: 'Space Whale',
          coinsAwarded: 50,
          totalAttempts: 6
        })
      );

      const result = await GesserApi.submitGuess('device123', 1, 'Space Whale');

      expect(result.correct).toBe(true);
      expect(result.coinsAwarded).toBe(50);
      expect(result.actualTopic).toBe('Space Whale');
    });

    test('submits wrong guess', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, correct: false, message: 'Wrong!', totalAttempts: 6 })
      );

      const result = await GesserApi.submitGuess('device123', 1, 'Fire Dragon');

      expect(result.correct).toBe(false);
      expect(result.actualTopic).toBeUndefined();
    });

    test('handles already guessed error', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: false, error: 'You already guessed this image' }, false)
      );

      await expect(
        GesserApi.submitGuess('device123', 1, 'Space Whale')
      ).rejects.toThrow('already guessed');
    });
  });
});

describe('GesserApi - Social Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addFriend', () => {
    test('adds friend successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, message: 'Friend added' })
      );

      const result = await GesserApi.addFriend('device123', 'device456');

      expect(result.ok).toBe(true);
      expect(result.message).toContain('added');
    });

    test('handles already friends error', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: false, error: 'Already friends' }, false)
      );

      await expect(
        GesserApi.addFriend('device123', 'device456')
      ).rejects.toThrow('Already friends');
    });

    test('handles self-friend error', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: false, error: 'Cannot friend yourself' }, false)
      );

      await expect(
        GesserApi.addFriend('device123', 'device123')
      ).rejects.toThrow('Cannot friend yourself');
    });
  });

  describe('removeFriend', () => {
    test('removes friend successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, message: 'Friend removed' })
      );

      const result = await GesserApi.removeFriend('device123', 'device456');

      expect(result.ok).toBe(true);
      expect(result.message).toContain('removed');
    });
  });

  describe('listFriends', () => {
    test('fetches friends list', async () => {
      const mockFriends = [
        { deviceId: 'device456', name: 'Alice', portrait: 'https://example.com/alice.png', isFriend: true },
        { deviceId: 'device789', name: 'Bob', portrait: null, isFriend: true }
      ];

      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, friends: mockFriends, count: 2 })
      );

      const result = await GesserApi.listFriends('device123');

      expect(result.friends).toHaveLength(2);
      expect(result.friends[0].name).toBe('Alice');
      expect(result.count).toBe(2);
    });

    test('handles empty friends list', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, friends: [], count: 0 })
      );

      const result = await GesserApi.listFriends('device123');

      expect(result.friends).toHaveLength(0);
      expect(result.count).toBe(0);
    });
  });

  describe('discoverUsers', () => {
    test('fetches user list with pagination', async () => {
      const mockUsers = [
        { deviceId: 'device456', name: 'Alice', portrait: 'https://example.com/alice.png', isFriend: false },
        { deviceId: 'device789', name: 'Bob', portrait: null, isFriend: true }
      ];

      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({ ok: true, users: mockUsers, hasMore: true, page: 1 })
      );

      const result = await GesserApi.discoverUsers('device123', '', 1);

      expect(result.users).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.page).toBe(1);
    });

    test('searches users by name', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockJsonResponse({
          ok: true,
          users: [{ deviceId: 'device456', name: 'Alice', portrait: null, isFriend: false }],
          hasMore: false,
          page: 1
        })
      );

      const result = await GesserApi.discoverUsers('device123', 'Alice', 1);

      expect(result.users).toHaveLength(1);
      expect(result.users[0].name).toBe('Alice');
    });
  });
});
