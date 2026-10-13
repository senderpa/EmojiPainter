/**
 * UNIFIED SAVE/LOAD SERVICE
 *
 * This service provides a unified interface for saving and loading projects
 * that seamlessly coordinates between:
 * - Workspace strokes (painting canvas)
 * - Framer animation frames
 * - Mini preview videos (from animation save)
 *
 * Workflow:
 * 1. Save Project → saves workspace + opens Framer → auto-triggers save animation → returns with video URI
 * 2. Load Project → loads workspace → opens Framer → loads frames → returns with everything restored
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createProjectPayload, saveProject, loadProject, type ProjectPayload } from './storage';

export interface UnifiedProjectData {
  name: string;
  workspacePayload: {
    strokes: any[];
    trace: any;
    brushEmoji: string;
    brushSize: number;
    brushOpacity: number;
    brushSpacing: number;
    brushRotation: number;
    mirrorX: boolean;
    mirrorY: boolean;
    recentEmojis?: string[];
    preview?: string | null;
  };
  framerState?: {
    frames: any[];
    fps: number;
    miniPreviewVideoUri?: string;
    // ... other framer data
  };
}

/**
 * Save a project with both workspace strokes and animation frames
 * This is the single unified save point for the entire application
 */
export async function unifiedSaveProject(
  projectName: string,
  workspaceData: {
    strokes: any[];
    trace: any;
    brushEmoji: string;
    brushSize: number;
    brushOpacity: number;
    brushSpacing: number;
    brushRotation: number;
    mirrorX: boolean;
    mirrorY: boolean;
    recentEmojis?: string[];
    preview?: string | null;
  },
  framerState?: any
): Promise<{ success: boolean; projectName: string; error?: string }> {
  try {
    console.log('[UnifiedSave] Starting unified project save:', projectName);

    // Create the full payload combining workspace and framer data
    const payload = createProjectPayload({
      strokes: workspaceData.strokes,
      trace: workspaceData.trace,
      brushEmoji: workspaceData.brushEmoji,
      brushSize: workspaceData.brushSize,
      brushOpacity: workspaceData.brushOpacity,
      brushSpacing: workspaceData.brushSpacing,
      brushRotation: workspaceData.brushRotation,
      mirrorX: workspaceData.mirrorX,
      mirrorY: workspaceData.mirrorY,
      recentEmojis: workspaceData.recentEmojis,
      preview: workspaceData.preview,
      framerFrames: framerState || undefined
    });

    // Save to storage
    await saveProject(projectName, payload);

    console.log('[UnifiedSave] ✅ Project saved successfully:', {
      projectName,
      strokeCount: workspaceData.strokes.length,
      hasFrames: !!framerState?.frames?.length,
      frameCount: framerState?.frames?.length ?? 0,
      hasVideo: !!framerState?.miniPreviewVideoUri
    });

    return {
      success: true,
      projectName
    };
  } catch (error) {
    console.error('[UnifiedSave] ❌ Failed to save project:', error);
    return {
      success: false,
      projectName,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Load a project with both workspace strokes and animation frames
 * Returns everything needed to restore the full state
 */
export async function unifiedLoadProject(
  projectName: string
): Promise<{
  success: boolean;
  workspace?: any;
  framer?: any;
  error?: string;
}> {
  try {
    console.log('[UnifiedLoad] Starting unified project load:', projectName);

    const payload = await loadProject(projectName);

    if (!payload) {
      return {
        success: false,
        error: 'Project not found'
      };
    }

    console.log('[UnifiedLoad] ✅ Project loaded successfully:', {
      projectName,
      strokeCount: payload.strokes?.length ?? 0,
      hasFrames: !!payload.framerFrames?.frames?.length,
      frameCount: payload.framerFrames?.frames?.length ?? 0,
      hasVideo: !!payload.framerFrames?.miniPreviewVideoUri
    });

    return {
      success: true,
      workspace: {
        strokes: payload.strokes,
        trace: payload.trace,
        brushEmoji: payload.brushEmoji,
        brushSize: payload.brushSize,
        brushOpacity: payload.brushOpacity,
        brushSpacing: payload.brushSpacing,
        brushRotation: payload.brushRotation,
        mirrorX: payload.mirrorX,
        mirrorY: payload.mirrorY,
        recentEmojis: payload.recentEmojis,
        preview: payload.preview
      },
      framer: payload.framerFrames || undefined
    };
  } catch (error) {
    console.error('[UnifiedLoad] ❌ Failed to load project:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Signal to Framer that it should auto-save animation after opening
 */
export async function setFramerAutoSaveFlag(shouldAutoSave: boolean): Promise<void> {
  try {
    if (shouldAutoSave) {
      await AsyncStorage.setItem('@framer_auto_save_animation', 'true');
      console.log('[UnifiedSave] Set Framer auto-save flag: true');
    } else {
      await AsyncStorage.removeItem('@framer_auto_save_animation');
      console.log('[UnifiedSave] Cleared Framer auto-save flag');
    }
  } catch (error) {
    console.warn('[UnifiedSave] Failed to set Framer auto-save flag:', error);
  }
}

/**
 * Check if Framer should auto-save
 */
export async function shouldFramerAutoSave(): Promise<boolean> {
  try {
    const flag = await AsyncStorage.getItem('@framer_auto_save_animation');
    return flag === 'true';
  } catch (error) {
    console.warn('[UnifiedLoad] Failed to check Framer auto-save flag:', error);
    return false;
  }
}
