import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Stroke, TraceState, BrushMode, PaintLayer, LayerVisibility } from '../state/PaintingContext';

const AUTOSAVE_KEY = 'emojipaint/autosave';

export interface AutosavePaintingState {
  strokes: Stroke[];
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  brushRotation: number;
  brushMode?: BrushMode;
  recentEmojis: string[];
  trace: TraceState;
  mirrorX: boolean;
  mirrorY: boolean;
  // 3-layer system (optional: autosaves written before layers existed simply omit them and
  // restore as "everything on the default layer, all layers visible").
  activeLayer?: PaintLayer;
  layerVisibility?: LayerVisibility;
}

export interface AutosavePayload {
  projectId: string;
  rasterSize: { w: number; h: number };
  painting: AutosavePaintingState;
  savedAt: string;
}

export async function loadAutosave(): Promise<AutosavePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTOSAVE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as AutosavePayload;
  } catch (error) {
    console.warn('autosave: failed to load', error);
    return null;
  }
}

export async function saveAutosave(payload: AutosavePayload): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('autosave: failed to save', error);
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AUTOSAVE_KEY);
  } catch (error) {
    console.warn('autosave: failed to clear', error);
  }
}
