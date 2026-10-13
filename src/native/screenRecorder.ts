import { NativeModules, Platform } from 'react-native';
import { clearIconBurstSuppression, suppressIconBurst } from '../lib/uiSuppression';

type NativeStartStopResult = {
  ok: boolean;
  url?: string | null;
  error?: string | null;
};

type ScreenRecorderNativeModule = {
  isAvailable: () => Promise<boolean>;
  isRecording: () => Promise<boolean>;
  startRecording: (includeMicrophone: boolean) => Promise<NativeStartStopResult>;
  stopRecording: () => Promise<NativeStartStopResult>;
  rotateVideo: (sourceUrl: string, rotation: string) => Promise<NativeStartStopResult>;
};

// Access the native module via NativeModules registry
const nativeModule: ScreenRecorderNativeModule | null =
  Platform.OS === 'ios' ? (NativeModules.ScreenRecorderModule as ScreenRecorderNativeModule) : null;

// Debug: Log available modules at startup
if (Platform.OS === 'ios' && __DEV__) {
  console.log('[ScreenRecorder] Checking for ScreenRecorderModule in NativeModules...');
  console.log('[ScreenRecorder] Available:', nativeModule ? 'YES' : 'NO');
  if (!nativeModule) {
    const moduleNames = Object.keys(NativeModules).filter(name => name.includes('Screen') || name.includes('Recorder'));
    console.log('[ScreenRecorder] Similar module names:', moduleNames);
  }
}

const ensureFileUri = (uri?: string | null): string | null => {
  if (!uri) return null;
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
};

export const isScreenRecorderSupported = async (): Promise<boolean> => {
  if (!nativeModule) return false;
  try {
    return await nativeModule.isAvailable();
  } catch (error) {
    console.warn('[ScreenRecorder] Failed to check availability:', error);
    return false;
  }
};

export const isScreenRecordingActive = async (): Promise<boolean> => {
  if (!nativeModule) return false;
  try {
    return await nativeModule.isRecording();
  } catch {
    return false;
  }
};

// Held for the whole capture window: the ReplayKit permission alert and any
// system warning (battery, memory) that interrupts a recording must not trigger
// the full-screen logo overlay, or it gets baked into the video.
let releaseBurstSuppression: (() => void) | null = null;

const releaseCaptureSuppression = () => {
  releaseBurstSuppression?.();
  releaseBurstSuppression = null;
};

export const startScreenRecording = async (includeMicrophone: boolean = false) => {
  if (!nativeModule) {
    throw new Error('Screen recorder is not available on this platform.');
  }
  // Claimed BEFORE the native call so the permission alert is already covered.
  releaseCaptureSuppression();
  releaseBurstSuppression = suppressIconBurst();
  try {
    const result = await nativeModule.startRecording(includeMicrophone);
    if (!result?.ok) releaseCaptureSuppression();
    return {
      ok: result?.ok ?? false,
      url: ensureFileUri(result?.url),
      error: result?.error ?? null,
    };
  } catch (error) {
    releaseCaptureSuppression();
    throw error;
  }
};

export const stopScreenRecording = async () => {
  if (!nativeModule) {
    throw new Error('Screen recorder is not available on this platform.');
  }
  try {
    const result = await nativeModule.stopRecording();
    return {
      ok: result?.ok ?? false,
      url: ensureFileUri(result?.url),
      error: result?.error ?? null,
    };
  } finally {
    releaseCaptureSuppression();
  }
};

export const ensureScreenRecordingStopped = async (): Promise<void> => {
  if (!nativeModule) {
    return;
  }
  try {
    await nativeModule.stopRecording();
  } catch {
    // Ignore cleanup errors – happens when we call stop without an active session.
  } finally {
    releaseCaptureSuppression();
    clearIconBurstSuppression();
  }
};

/**
 * Rotates a video file by the specified rotation
 * @param sourceUrl - The URL of the video to rotate
 * @param rotation - Either 'counterclockwise'/'-90' or 'clockwise'/'90'
 * @returns The URL of the rotated video file
 */
export const rotateVideoFile = async (
  sourceUrl: string,
  rotation: 'counterclockwise' | 'clockwise' | '-90' | '90'
): Promise<{ ok: boolean; url: string | null }> => {
  if (!nativeModule) {
    throw new Error('Screen recorder is not available on this platform.');
  }
  const result = await nativeModule.rotateVideo(sourceUrl, rotation);
  return {
    ok: result?.ok ?? false,
    url: ensureFileUri(result?.url),
  };
};
