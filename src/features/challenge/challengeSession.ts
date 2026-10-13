import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DailyPrompt } from '../../types/dailyPrompt';

export type ChallengeSessionStatus = 'inactive' | 'active' | 'completed' | 'uploaded' | 'cancelled' | 'expired';
export interface ChallengeSession {
  id: string;
  prompt: DailyPrompt;
  startedAt: number;
  endsAt: number;
  status: ChallengeSessionStatus;
  updatedAt: number;
}

export const CHALLENGE_SESSION_KEY = 'emojipaint/challenge-session-v1';

export function createChallengeSession(prompt: DailyPrompt, startedAt = Date.now()): ChallengeSession {
  const durationMs = Math.max(1, Number(prompt.timeMinutes) || 30) * 60 * 1000;
  return { id: `${startedAt}-${prompt.topic}`, prompt, startedAt, endsAt: startedAt + durationMs, status: 'active', updatedAt: startedAt };
}

export function transitionChallengeSession(session: ChallengeSession, status: ChallengeSessionStatus, now = Date.now()): ChallengeSession {
  if (session.status !== 'active' || status === 'inactive') return session;
  return { ...session, status, updatedAt: now };
}

export function remainingChallengeMs(session: ChallengeSession, now = Date.now()): number {
  return session.status === 'active' ? Math.max(0, session.endsAt - now) : 0;
}

export async function saveChallengeSession(session: ChallengeSession): Promise<void> {
  await AsyncStorage.setItem(CHALLENGE_SESSION_KEY, JSON.stringify(session));
}

export async function loadChallengeSession(now = Date.now()): Promise<ChallengeSession | null> {
  try {
    const raw = await AsyncStorage.getItem(CHALLENGE_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as ChallengeSession;
    if (!session?.prompt || !Number.isFinite(session.startedAt) || !Number.isFinite(session.endsAt)) return null;
    if (session.status === 'active' && session.endsAt <= now) {
      const expired = transitionChallengeSession(session, 'expired', now);
      await saveChallengeSession(expired);
      return null;
    }
    return session.status === 'active' ? session : null;
  } catch {
    return null;
  }
}

export async function finishChallengeSession(status: 'completed' | 'uploaded' | 'cancelled' | 'expired'): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CHALLENGE_SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw) as ChallengeSession;
    await saveChallengeSession(transitionChallengeSession(session, status));
  } catch { /* storage failure must not block UI cleanup */ }
}
