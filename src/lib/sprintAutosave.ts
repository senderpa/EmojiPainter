import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DailyPrompt } from '../types/dailyPrompt';
import type { StoredPaintingState } from '../types/storedPainting';

const SPRINT_AUTOSAVE_KEY = 'emojipaint/sprint-autosave';
const GENERAL_AUTOSAVE_KEY = 'emojipaint/general-autosave';
const FRAMER_CHALLENGE_AUTOSAVE_KEY = 'emojipaint/framer-challenge-autosave';
const MAX_AUTOSAVE_STROKES = 5000; // Limit strokes in autosave to prevent memory issues

export interface SprintAutosavePayload {
  prompt: DailyPrompt;
  startedAt: number;
  endsAt: number;
  savedAt: string;
  painting: StoredPaintingState;
  elapsedMs: number; // Track elapsed time for timer restoration
  strokeCount: number; // Track stroke count separately
  timeRunout?: boolean; // Flag if time ran out (00:00)
  uploaded?: boolean; // Flag if painting was uploaded to gallery
}

// Framer-specific challenge autosave — persists full frame data + challenge state
export interface FramerChallengeAutosavePayload {
  prompt: DailyPrompt;
  startedAt: number;
  endsAt: number;
  savedAt: string;
  frames: Array<{ stamps: unknown[] }>; // Full frame data
  fps: number;
  loop: boolean;
  cropStart: number;
  cropEnd: number;
  strokeCount: number;
  uploaded?: boolean;
}

export async function loadFramerChallengeAutosave(): Promise<FramerChallengeAutosavePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(FRAMER_CHALLENGE_AUTOSAVE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as FramerChallengeAutosavePayload;

    // Same-day check
    const savedDate = new Date(payload.savedAt);
    const today = new Date();
    const isSameDay =
      savedDate.getDate() === today.getDate() &&
      savedDate.getMonth() === today.getMonth() &&
      savedDate.getFullYear() === today.getFullYear();

    if (!isSameDay) {
      return null;
    }

    // Not expired AND not yet uploaded
    if (Date.now() > payload.endsAt || payload.uploaded) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function saveFramerChallengeAutosave(payload: FramerChallengeAutosavePayload): Promise<void> {
  try {
    await AsyncStorage.setItem(FRAMER_CHALLENGE_AUTOSAVE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('[FramerChallengeAutosave] Failed to save:', error);
  }
}

export async function clearFramerChallengeAutosave(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FRAMER_CHALLENGE_AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}

export async function loadSprintAutosave(): Promise<SprintAutosavePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(SPRINT_AUTOSAVE_KEY);
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as SprintAutosavePayload;
    if (!payload?.painting || !Array.isArray(payload.painting.strokes) || !payload.prompt) {
      console.warn('[SprintAutosave] Malformed payload — ignoring');
      return null;
    }

    // Check if autosave is from same day
    const savedDate = new Date(payload.savedAt);
    const today = new Date();
    const isSameDay = savedDate.getDate() === today.getDate() &&
                      savedDate.getMonth() === today.getMonth() &&
                      savedDate.getFullYear() === today.getFullYear();

    if (!isSameDay) {
      console.log('[SprintAutosave] Autosave is from different day, ignoring');
      return null;
    }

    // Check if topic session hasn't expired OR if time ran out
    if (Date.now() > payload.endsAt || payload.timeRunout) {
      console.log('[SprintAutosave] Topic session has expired or time ran out');
      return null;
    }

    console.log('[SprintAutosave] Loaded valid topic session:', payload.prompt.topic, 'strokes:', payload.painting.strokes.length);
    return payload;
  } catch (error) {
    console.warn('sprint autosave: failed to load', error);
    return null;
  }
}

export async function saveSprintAutosave(payload: SprintAutosavePayload): Promise<void> {
  try {
    // Limit stroke count to prevent memory issues
    let optimizedPainting = payload.painting;
    if (payload.painting.strokes.length > MAX_AUTOSAVE_STROKES) {
      console.warn(`[SprintAutosave] Limiting strokes from ${payload.painting.strokes.length} to ${MAX_AUTOSAVE_STROKES}`);
      optimizedPainting = {
        ...payload.painting,
        strokes: payload.painting.strokes.slice(-MAX_AUTOSAVE_STROKES) // Keep most recent strokes
      };
    }

    const optimizedPayload = {
      ...payload,
      painting: optimizedPainting
    };

    await AsyncStorage.setItem(SPRINT_AUTOSAVE_KEY, JSON.stringify(optimizedPayload));
    console.log('[SprintAutosave] Saved topic session:', payload.prompt.topic, 'strokes:', optimizedPainting.strokes.length);
  } catch (error) {
    console.warn('sprint autosave: failed to save', error);
  }
}

export async function clearSprintAutosave(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SPRINT_AUTOSAVE_KEY);
  } catch (error) {
    console.warn('sprint autosave: failed to clear', error);
  }
}

// General autosave (for non-challenge work, including frame-by-frame)
export interface GeneralAutosavePayload {
  savedAt: string;
  painting: StoredPaintingState;
  strokeCount: number;
  frameMode: boolean; // Was the user in frame-by-frame mode?
  framerFrames?: any; // Framer workspace frames data
}

export async function loadGeneralAutosave(): Promise<GeneralAutosavePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(GENERAL_AUTOSAVE_KEY);
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as GeneralAutosavePayload;
    if (!payload?.painting || !Array.isArray(payload.painting.strokes)) {
      console.warn('[GeneralAutosave] Malformed payload — ignoring');
      return null;
    }

    // Check if autosave is from same day
    const savedDate = new Date(payload.savedAt);
    const today = new Date();
    const isSameDay = savedDate.getDate() === today.getDate() &&
                      savedDate.getMonth() === today.getMonth() &&
                      savedDate.getFullYear() === today.getFullYear();

    if (!isSameDay) {
      console.log('[GeneralAutosave] Autosave is from different day, ignoring');
      return null;
    }

    console.log('[GeneralAutosave] Loaded general autosave, strokes:', payload.painting.strokes.length, 'frames:', payload.painting.frames?.length || 0, 'framer:', payload.framerFrames ? 'yes' : 'no');
    return payload;
  } catch (error) {
    console.warn('general autosave: failed to load', error);
    return null;
  }
}

export async function saveGeneralAutosave(payload: GeneralAutosavePayload): Promise<void> {
  try {
    // Limit stroke count to prevent memory issues
    let optimizedPainting = payload.painting;
    if (payload.painting.strokes.length > MAX_AUTOSAVE_STROKES) {
      console.warn(`[GeneralAutosave] Limiting strokes from ${payload.painting.strokes.length} to ${MAX_AUTOSAVE_STROKES}`);
      optimizedPainting = {
        ...payload.painting,
        strokes: payload.painting.strokes.slice(-MAX_AUTOSAVE_STROKES)
      };
    }

    const optimizedPayload = {
      ...payload,
      painting: optimizedPainting
    };

    await AsyncStorage.setItem(GENERAL_AUTOSAVE_KEY, JSON.stringify(optimizedPayload));
    console.log('[GeneralAutosave] Saved general autosave, strokes:', optimizedPainting.strokes.length, 'frames:', optimizedPainting.frames?.length || 0, 'framer:', optimizedPayload.framerFrames ? 'yes' : 'no');
  } catch (error) {
    console.warn('general autosave: failed to save', error);
  }
}

export async function clearGeneralAutosave(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GENERAL_AUTOSAVE_KEY);
  } catch (error) {
    console.warn('general autosave: failed to clear', error);
  }
}
