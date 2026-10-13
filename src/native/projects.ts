/**
 * Native Project Module
 * Ultra-fast, robust project save/load with binary format
 * Replaces slow JSON + AsyncStorage approach
 */

import { NativeModules, Platform } from 'react-native';

interface NativeProjectModuleInterface {
  saveProject(
    projectId: string,
    name: string,
    strokes: any[],
    metadata: any
  ): Promise<{
    success: boolean;
    projectId: string;
    strokeCount: number;
    sizeBytes: number;
    durationMs: number;
  }>;

  loadProject(projectId: string): Promise<{
    projectId: string;
    name: string;
    strokes: any[];
    metadata: any;
    loadTimeMs: number;
  } | null>;

  deleteProject(projectId: string): Promise<{ deleted: boolean }>;

  listProjects(): Promise<{
    projects: Array<{
      projectId: string;
      name: string;
      sizeBytes: number;
      modifiedTimestamp: number;
    }>;
  }>;

  getProjectInfo(projectId: string): Promise<{
    exists: boolean;
    projectId: string;
    name: string;
    strokeCount: number;
    sizeBytes: number;
    modifiedTimestamp: number;
  } | null>;
}

const NativeProjectModule: NativeProjectModuleInterface | null =
  Platform.OS === 'ios' ? NativeModules.NativeProjectModule : null;

/**
 * Check if native project save/load is available
 */
export const isNativeProjectsAvailable = (): boolean => {
  return Platform.OS === 'ios' && NativeProjectModule !== null;
};

/**
 * Save project to native storage
 * @param projectId - Unique project identifier
 * @param name - Project display name
 * @param strokes - Array of stroke objects
 * @param metadata - Additional metadata (canvas size, settings, etc.)
 */
export const saveProject = async (
  projectId: string,
  name: string,
  strokes: any[],
  metadata: any = {}
): Promise<{
  success: boolean;
  projectId: string;
  strokeCount: number;
  sizeBytes: number;
  durationMs: number;
}> => {
  if (!NativeProjectModule) {
    throw new Error('Native projects not available');
  }

  return NativeProjectModule.saveProject(projectId, name, strokes, metadata);
};

/**
 * Load project from native storage
 */
export const loadProject = async (
  projectId: string
): Promise<{
  projectId: string;
  name: string;
  strokes: any[];
  metadata: any;
  loadTimeMs: number;
} | null> => {
  if (!NativeProjectModule) {
    throw new Error('Native projects not available');
  }

  return NativeProjectModule.loadProject(projectId);
};

/**
 * Delete project from native storage
 */
export const deleteProject = async (projectId: string): Promise<void> => {
  if (!NativeProjectModule) {
    throw new Error('Native projects not available');
  }

  await NativeProjectModule.deleteProject(projectId);
};

/**
 * List all saved projects
 */
export const listProjects = async (): Promise<
  Array<{
    projectId: string;
    name: string;
    sizeBytes: number;
    modifiedTimestamp: number;
  }>
> => {
  if (!NativeProjectModule) {
    throw new Error('Native projects not available');
  }

  const result = await NativeProjectModule.listProjects();
  return result.projects;
};

/**
 * Get project info without loading full data
 */
export const getProjectInfo = async (
  projectId: string
): Promise<{
  exists: boolean;
  projectId: string;
  name: string;
  strokeCount: number;
  sizeBytes: number;
  modifiedTimestamp: number;
} | null> => {
  if (!NativeProjectModule) {
    throw new Error('Native projects not available');
  }

  return NativeProjectModule.getProjectInfo(projectId);
};

export default {
  isNativeProjectsAvailable,
  saveProject,
  loadProject,
  deleteProject,
  listProjects,
  getProjectInfo,
};
