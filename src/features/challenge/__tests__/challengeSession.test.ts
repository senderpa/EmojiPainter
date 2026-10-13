import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createChallengeSession,
  loadChallengeSession,
  remainingChallengeMs,
  transitionChallengeSession,
} from '../challengeSession';

describe('authoritative challenge session', () => {
  const prompt = { topic: 'test', timeMinutes: 1 } as any;
  it('uses one persisted deadline', () => {
    const session = createChallengeSession(prompt, 1000);
    expect(session.endsAt).toBe(61000);
    expect(remainingChallengeMs(session, 2000)).toBe(59000);
  });
  it('does not reopen terminal sessions', () => {
    const session = transitionChallengeSession(createChallengeSession(prompt, 1000), 'uploaded', 2000);
    expect(transitionChallengeSession(session, 'active').status).toBe('uploaded');
    expect(remainingChallengeMs(session, 3000)).toBe(0);
  });
  it('expires a stale persisted deadline without restoring it as active', async () => {
    const session = createChallengeSession(prompt, 1000);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(session));

    await expect(loadChallengeSession(62000)).resolves.toBeNull();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"status":"expired"'),
    );
  });
});
