/**
 * StrokeLogModule Bridge
 * Native binary stroke persistence for improved performance
 */

import { NativeModules, Platform } from 'react-native';

interface StrokeLogModuleInterface {
  /**
   * Initialize a new stroke log file
   */
  initLog(projectId: string, logPath: string): Promise<void>;

  /**
   * Append a stroke to the log (binary format)
   */
  appendStroke(
    projectId: string,
    stroke: {
      id: string;
      emoji: string;
      size: number;
      opacity: number;
      spacing: number;
      mirrorX: boolean;
      mirrorY: boolean;
      rotation: number;
      points: Array<{ x: number; y: number; t: number }>;
      emojiSequence?: string[];
    }
  ): Promise<void>;

  /**
   * Append multiple strokes in a batch
   */
  appendStrokesBatch(projectId: string, strokes: any[]): Promise<void>;

  /**
   * Read all strokes from the log
   */
  readStrokes(projectId: string, logPath: string): Promise<any[]>;

  /**
   * Read strokes in a time range
   */
  readStrokesInRange(
    projectId: string,
    logPath: string,
    startTime: number,
    endTime: number
  ): Promise<any[]>;

  /**
   * Get stroke count without reading all data
   */
  getStrokeCount(projectId: string, logPath: string): Promise<number>;

  /**
   * Compact the log (remove deleted strokes, optimize size)
   */
  compactLog(projectId: string, logPath: string): Promise<void>;

  /**
   * Export log to JSON format (for backup/compatibility)
   */
  exportToJson(projectId: string, logPath: string, jsonPath: string): Promise<void>;

  /**
   * Import log from JSON format
   */
  importFromJson(projectId: string, jsonPath: string, logPath: string): Promise<void>;

  /**
   * Close and flush the log
   */
  closeLog(projectId: string): Promise<void>;

  /**
   * Get log file statistics
   */
  getLogStats(projectId: string, logPath: string): Promise<{
    fileSizeBytes: number;
    strokeCount: number;
    pointCount: number;
    earliestTimestamp: number;
    latestTimestamp: number;
  }>;
}

const StrokeLogModule: StrokeLogModuleInterface | null =
  Platform.OS === 'ios' ? NativeModules.StrokeLogModule : null;

/**
 * Check if native stroke logging is available
 */
export const isStrokeLogAvailable = (): boolean => {
  return Platform.OS === 'ios' && StrokeLogModule !== null;
};

/**
 * Initialize a new stroke log for a project
 */
export const initLog = async (projectId: string, logPath: string): Promise<void> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.initLog(projectId, logPath);
};

/**
 * Append a single stroke to the log
 */
export const appendStroke = async (projectId: string, stroke: any): Promise<void> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.appendStroke(projectId, stroke);
};

/**
 * Append multiple strokes in a batch (more efficient)
 */
export const appendStrokesBatch = async (projectId: string, strokes: any[]): Promise<void> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.appendStrokesBatch(projectId, strokes);
};

/**
 * Read all strokes from the log
 */
export const readStrokes = async (projectId: string, logPath: string): Promise<any[]> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.readStrokes(projectId, logPath);
};

/**
 * Read strokes within a specific time range
 */
export const readStrokesInRange = async (
  projectId: string,
  logPath: string,
  startTime: number,
  endTime: number
): Promise<any[]> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.readStrokesInRange(projectId, logPath, startTime, endTime);
};

/**
 * Get the number of strokes without reading all data
 */
export const getStrokeCount = async (projectId: string, logPath: string): Promise<number> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.getStrokeCount(projectId, logPath);
};

/**
 * Compact the log file to optimize storage
 */
export const compactLog = async (projectId: string, logPath: string): Promise<void> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.compactLog(projectId, logPath);
};

/**
 * Export log to JSON format (for backup/migration)
 */
export const exportToJson = async (
  projectId: string,
  logPath: string,
  jsonPath: string
): Promise<void> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.exportToJson(projectId, logPath, jsonPath);
};

/**
 * Import log from JSON format
 */
export const importFromJson = async (
  projectId: string,
  jsonPath: string,
  logPath: string
): Promise<void> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.importFromJson(projectId, jsonPath, logPath);
};

/**
 * Close and flush the log file
 */
export const closeLog = async (projectId: string): Promise<void> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.closeLog(projectId);
};

/**
 * Get statistics about the log file
 */
export const getLogStats = async (
  projectId: string,
  logPath: string
): Promise<{
  fileSizeBytes: number;
  strokeCount: number;
  pointCount: number;
  earliestTimestamp: number;
  latestTimestamp: number;
}> => {
  if (!StrokeLogModule) {
    throw new Error('StrokeLogModule not available on this platform');
  }
  return StrokeLogModule.getLogStats(projectId, logPath);
};

export default {
  isStrokeLogAvailable,
  initLog,
  appendStroke,
  appendStrokesBatch,
  readStrokes,
  readStrokesInRange,
  getStrokeCount,
  compactLog,
  exportToJson,
  importFromJson,
  closeLog,
  getLogStats,
};
