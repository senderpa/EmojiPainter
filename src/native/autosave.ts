/**
 * Native Autosave Module
 * Ultra-fast incremental autosave with binary storage
 * Replaces slow JSON + AsyncStorage approach
 */

import { NativeModules, Platform } from 'react-native';

interface NativeAutosaveModuleInterface {
  saveState(
    projectId: string,
    strokes: any[],
    metadata: any,
    incremental: boolean
  ): Promise<{
    success: boolean;
    strokeCount: number;
    savedCount: number;
    durationMs: number;
    incremental: boolean;
  }>;

  loadState(projectId: string): Promise<{
    strokes: any[];
    metadata: any;
    loadTimeMs: number;
  } | null>;

  clearState(projectId: string): Promise<{ cleared: boolean }>;

  getStats(projectId: string): Promise<{
    exists: boolean;
    stateSizeBytes: number;
    metaSizeBytes: number;
    totalSizeBytes: number;
    lastSavedStrokeCount: number;
  }>;
}

const NativeAutosaveModule: NativeAutosaveModuleInterface | null =
  Platform.OS === 'ios' ? NativeModules.NativeAutosaveModule : null;

/**
 * Check if native autosave is available
 */
export const isNativeAutosaveAvailable = (): boolean => {
  return Platform.OS === 'ios' && NativeAutosaveModule !== null;
};

/**
 * Save painting state to native storage
 * @param projectId - Unique project identifier
 * @param strokes - Array of stroke objects
 * @param metadata - Additional metadata (brush settings, etc.)
 * @param incremental - If true, only saves new strokes since last save
 */
export const saveState = async (
  projectId: string,
  strokes: any[],
  metadata: any,
  incremental: boolean = true
): Promise<{
  success: boolean;
  strokeCount: number;
  savedCount: number;
  durationMs: number;
  incremental: boolean;
}> => {
  if (!NativeAutosaveModule) {
    throw new Error('Native autosave not available');
  }

  return NativeAutosaveModule.saveState(projectId, strokes, metadata, incremental);
};

/**
 * Load painting state from native storage
 */
export const loadState = async (
  projectId: string
): Promise<{
  strokes: any[];
  metadata: any;
  loadTimeMs: number;
} | null> => {
  if (!NativeAutosaveModule) {
    throw new Error('Native autosave not available');
  }

  return NativeAutosaveModule.loadState(projectId);
};

/**
 * Clear autosave state
 */
export const clearState = async (projectId: string): Promise<void> => {
  if (!NativeAutosaveModule) {
    throw new Error('Native autosave not available');
  }

  await NativeAutosaveModule.clearState(projectId);
};

/**
 * Get autosave statistics
 */
export const getStats = async (projectId: string): Promise<{
  exists: boolean;
  stateSizeBytes: number;
  metaSizeBytes: number;
  totalSizeBytes: number;
  lastSavedStrokeCount: number;
}> => {
  if (!NativeAutosaveModule) {
    throw new Error('Native autosave not available');
  }

  return NativeAutosaveModule.getStats(projectId);
};

export default {
  isNativeAutosaveAvailable,
  saveState,
  loadState,
  clearState,
  getStats,
};
