/**
 * Custom Brush Storage System
 * Manages persistent storage of custom brush emojis with all their settings
 * Uses ID-based reference system instead of storing huge base64 strings
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { dataUriToBase64, isCustomPng } from './pngNormalizer';

export interface CustomBrush {
  id: string; // Unique identifier (uuid)
  brushPngId?: string; // Reference to PNG stored in custom brush registry (e.g., "custom_brush_1")
  emoji?: string; // Legacy data URI or emoji fallback
  size: number; // Brush size (1-300)
  opacity: number; // Opacity (0-1)
  spacing: number; // Spacing between stamps (0.0001-999)
  rotation: number; // Rotation in degrees (0-360)
  mirrorX: boolean; // Horizontal flip
  mirrorY: boolean; // Vertical flip
  name?: string; // Optional display name
  savedAt: number; // Timestamp when saved
}

const CUSTOM_BRUSHES_KEY = 'emojipaint/custom-brushes';
const CUSTOM_BRUSH_PNGS_KEY = 'emojipaint/custom-brush-pngs';
const MAX_CUSTOM_BRUSHES = 100;

/**
 * Interface for storing PNG data separately
 */
export interface CustomBrushPNG {
  id: string; // Custom brush PNG ID (e.g., "custom_brush_1")
  base64: string; // Base64 PNG data
  createdAt: number; // When it was created
}

/**
 * Get next available custom brush PNG ID
 */
const getNextCustomBrushPngId = async (): Promise<string> => {
  try {
    const data = await AsyncStorage.getItem(CUSTOM_BRUSH_PNGS_KEY);
    const pngs = data ? (JSON.parse(data) as CustomBrushPNG[]) : [];
    const nextNum = pngs.length + 1;
    return `custom_brush_${nextNum}`;
  } catch {
    return `custom_brush_1`;
  }
};

/**
 * Store a custom brush PNG separately
 */
export const saveCustomBrushPNG = async (base64: string): Promise<string | null> => {
  try {
    const pngId = await getNextCustomBrushPngId();
    const data = await AsyncStorage.getItem(CUSTOM_BRUSH_PNGS_KEY);
    const pngs = data ? (JSON.parse(data) as CustomBrushPNG[]) : [];

    pngs.push({
      id: pngId,
      base64,
      createdAt: Date.now(),
    });

    await AsyncStorage.setItem(CUSTOM_BRUSH_PNGS_KEY, JSON.stringify(pngs));
    console.log(`[customBrushes] ✅ Saved custom brush PNG: ${pngId}`);
    return pngId;
  } catch (error) {
    console.error('[customBrushes] Failed to save custom brush PNG:', error);
    return null;
  }
};

/**
 * Get a custom brush PNG by ID
 */
export const getCustomBrushPNG = async (pngId: string): Promise<string | null> => {
  try {
    const data = await AsyncStorage.getItem(CUSTOM_BRUSH_PNGS_KEY);
    if (!data) return null;

    const pngs = JSON.parse(data) as CustomBrushPNG[];
    const png = pngs.find(p => p.id === pngId);
    return png?.base64 || null;
  } catch (error) {
    console.error('[customBrushes] Failed to get custom brush PNG:', error);
    return null;
  }
};

/**
 * Delete a custom brush PNG by ID
 */
export const deleteCustomBrushPNG = async (pngId: string): Promise<boolean> => {
  try {
    const data = await AsyncStorage.getItem(CUSTOM_BRUSH_PNGS_KEY);
    if (!data) return false;

    const pngs = JSON.parse(data) as CustomBrushPNG[];
    const filtered = pngs.filter(p => p.id !== pngId);

    await AsyncStorage.setItem(CUSTOM_BRUSH_PNGS_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('[customBrushes] Failed to delete custom brush PNG:', error);
    return false;
  }
};

/**
 * Get all saved custom brushes
 */
export const getCustomBrushes = async (): Promise<CustomBrush[]> => {
  try {
    const data = await AsyncStorage.getItem(CUSTOM_BRUSHES_KEY);
    if (!data) {
      return [];
    }
    const brushes = JSON.parse(data) as CustomBrush[];
    const safeBrushes = Array.isArray(brushes) ? brushes : [];

    // Migrate legacy data-URI brushes to ID-based storage
    let didMigrate = false;
    const migrated: CustomBrush[] = [];

    for (const brush of safeBrushes) {
      const legacyDataUri = typeof brush.emoji === 'string' && isCustomPng(brush.emoji);
      const hasPngId = typeof brush.brushPngId === 'string' && brush.brushPngId.length > 0;

      if (!hasPngId && legacyDataUri) {
        const base64 = dataUriToBase64(brush.emoji!);
        const pngId = await saveCustomBrushPNG(base64);
        if (pngId) {
          migrated.push({
            ...brush,
            brushPngId: pngId,
          });
          didMigrate = true;
          continue;
        }
      }

      migrated.push(brush);
    }

    if (didMigrate) {
      await AsyncStorage.setItem(CUSTOM_BRUSHES_KEY, JSON.stringify(migrated));
    }

    return migrated;
  } catch (error) {
    console.error('Failed to load custom brushes:', error);
    return [];
  }
};

/**
 * Save a new custom brush
 */
export const saveCustomBrush = async (brush: Omit<CustomBrush, 'id' | 'savedAt'>): Promise<CustomBrush | null> => {
  try {
    const brushes = await getCustomBrushes();

    // Check if we're at capacity - remove oldest if needed
    if (brushes.length >= MAX_CUSTOM_BRUSHES) {
      brushes.sort((a, b) => a.savedAt - b.savedAt);
      brushes.shift(); // Remove oldest
    }

    // Create new brush with id and timestamp
    const newBrush: CustomBrush = {
      ...brush,
      id: `brush-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      savedAt: Date.now(),
    };

    brushes.push(newBrush);
    await AsyncStorage.setItem(CUSTOM_BRUSHES_KEY, JSON.stringify(brushes));

    return newBrush;
  } catch (error) {
    console.error('Failed to save custom brush:', error);
    return null;
  }
};

/**
 * Delete a custom brush by id (also deletes associated PNG)
 */
export const deleteCustomBrush = async (brushId: string): Promise<boolean> => {
  try {
    const brushes = await getCustomBrushes();
    const brush = brushes.find((b) => b.id === brushId);

    // Delete associated PNG if it exists
    if (brush && brush.brushPngId) {
      await deleteCustomBrushPNG(brush.brushPngId);
    }

    const filtered = brushes.filter((b) => b.id !== brushId);
    await AsyncStorage.setItem(CUSTOM_BRUSHES_KEY, JSON.stringify(filtered));
    console.log(`[customBrushes] ✅ Deleted custom brush: ${brushId}`);
    return true;
  } catch (error) {
    console.error('Failed to delete custom brush:', error);
    return false;
  }
};

/**
 * Get a specific custom brush by id
 */
export const getCustomBrush = async (brushId: string): Promise<CustomBrush | null> => {
  try {
    const brushes = await getCustomBrushes();
    return brushes.find((b) => b.id === brushId) || null;
  } catch (error) {
    console.error('Failed to get custom brush:', error);
    return null;
  }
};

/**
 * Update a custom brush
 */
export const updateCustomBrush = async (brushId: string, updates: Partial<Omit<CustomBrush, 'id' | 'savedAt'>>): Promise<CustomBrush | null> => {
  try {
    const brushes = await getCustomBrushes();
    const index = brushes.findIndex((b) => b.id === brushId);

    if (index === -1) {
      return null;
    }

    brushes[index] = {
      ...brushes[index],
      ...updates,
    };

    await AsyncStorage.setItem(CUSTOM_BRUSHES_KEY, JSON.stringify(brushes));
    return brushes[index];
  } catch (error) {
    console.error('Failed to update custom brush:', error);
    return null;
  }
};

/**
 * Clear all custom brushes
 */
export const clearCustomBrushes = async (): Promise<boolean> => {
  try {
    await AsyncStorage.removeItem(CUSTOM_BRUSHES_KEY);
    return true;
  } catch (error) {
    console.error('Failed to clear custom brushes:', error);
    return false;
  }
};

export default {
  getCustomBrushes,
  saveCustomBrush,
  deleteCustomBrush,
  getCustomBrush,
  updateCustomBrush,
  clearCustomBrushes,
};
