import { NativeModules } from 'react-native';

// Tolerant resolution to avoid crashing when native module is absent
const bridge = (NativeModules as any)?.EmojisprayBridge;

export type EmojisprayBridgeType = {
  sendToEmojispray: (path: string) => Promise<{ status?: string | null }>;
} | undefined;

const EmojisprayBridge: EmojisprayBridgeType =
  bridge && typeof bridge.sendToEmojispray === 'function' ? bridge : undefined;

export default EmojisprayBridge;
