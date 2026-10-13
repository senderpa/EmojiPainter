import { NativeModules, Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type EmojisprayBridgeNativeModule = {
  sendToEmojispray: (path: string) => Promise<{ status?: string | null }>;
};

export type EmojisprayHandoffStatus = 'opened' | 'not_installed' | 'failed' | 'cancelled';

class EmojisprayBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmojisprayBridgeError';
  }
}

let cachedModule: EmojisprayBridgeNativeModule | null = null;

const resolveNativeModule = (): EmojisprayBridgeNativeModule | null => {
  if (cachedModule) {
    return cachedModule;
  }

  const candidate = (NativeModules as Record<string, unknown>).EmojisprayBridge as EmojisprayBridgeNativeModule | undefined;
  if (candidate && typeof candidate.sendToEmojispray === 'function') {
    cachedModule = candidate;
    return cachedModule;
  }

  try {
    const module = requireNativeModule<EmojisprayBridgeNativeModule>('EmojisprayBridge');
    if (module && typeof module.sendToEmojispray === 'function') {
      cachedModule = module;
      return cachedModule;
    }
  } catch (error) {
    // Ignore so we can surface a consistent error later.
  }

  return null;
};

const ensureModule = (): EmojisprayBridgeNativeModule => {
  const module = resolveNativeModule();
  if (!module) {
    throw new EmojisprayBridgeError('Emojispray bridge is unavailable.');
  }
  return module;
};

export async function sendImageToEmojispray(path: string): Promise<EmojisprayHandoffStatus> {
  if (Platform.OS !== 'ios') {
    throw new EmojisprayBridgeError('Emojispray handoff is only available on iOS.');
  }

  if (!path || typeof path !== 'string') {
    throw new EmojisprayBridgeError('A valid file path is required.');
  }

  const module = resolveNativeModule();
  if (!module) {
    // Gracefully degrade so UI can show a friendly message
    return 'failed';
  }
  const response = await module.sendToEmojispray(path);
  const status = response?.status;

  if (status === 'opened' || status === 'not_installed' || status === 'failed' || status === 'cancelled') {
    return status;
  }

  return 'failed';
}
