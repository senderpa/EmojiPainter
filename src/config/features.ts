/**
 * Feature Flags Configuration
 * Controls experimental and platform-specific features
 */

import { Platform } from 'react-native';
import { isMetalAvailable } from '../native';

export interface FeatureFlags {
  // Metal rendering
  useMetalCanvas: boolean;
  useMetalExport: boolean;

  // Experimental UI-thread picture→texture engine (Phase 0/1, GpuPaintCanvas). Superseded by the tile
  // engine for normal painting; kept off by default.
  useGpuPaintEngine: boolean;

  // Tile-based paint engine (TilePaintCanvas): incremental dirty-tile rendering + tile-revision undo.
  // When on, non-smudge paintings render via the tile engine; smudge paintings fall back to EmojiCanvas
  // (legacy) until tile-local smudge lands (Phase 5). See TILE_ENGINE_PLAN.md.
  useTilePaintEngine: boolean;

  // Native Metal live paint engine (modules/metal-paint). Highest priority Skia-path renderer when the
  // native view is built into the binary. Non-smudge only; smudge → legacy until M4. See
  // NATIVE_METAL_ENGINE_PLAN.md.
  useMetalPaintEngine: boolean;

  // Native persistence
  useNativePersistence: boolean;

  // Performance optimizations
  enableCheckpoints: boolean;
  checkpointInterval: number;
  maxCheckpoints: number;

  // Debug options
  debugMetalStats: boolean;
  logRenderTimes: boolean;
}

/**
 * Default feature flags
 * 🚀 ALL METAL FEATURES ENABLED FOR MAXIMUM PERFORMANCE!
 */
const DEFAULT_FLAGS: FeatureFlags = {
  // 🎨 Metal canvas DISABLED for painting (no visual display component)
  // MetalEmojiCanvas is headless - only for export, not for interactive drawing!
  useMetalCanvas: false, // Keep Skia for painting; exporter uses native Metal
  useMetalExport: Platform.OS === 'ios' && isMetalAvailable(), // ENABLED for export!

  // 🧪 Picture→texture engine — superseded by the tile engine; OFF.
  useGpuPaintEngine: false,

  // 🧪 Tile paint engine — OFF (superseded by the native Metal engine which now also handles smudge).
  useTilePaintEngine: false,

  // 🚀 Native Metal paint engine — ON. Handles normal painting AND live smudge on the GPU (no engine
  // switch). Falls back to legacy EmojiCanvas only if the native view isn't built into the binary.
  useMetalPaintEngine: true,

  // 💾 Native persistence ENABLED
  useNativePersistence: Platform.OS === 'ios' && isMetalAvailable(),

  // ⚡ Performance optimizations
  enableCheckpoints: true,
  checkpointInterval: 12, // strokes
  maxCheckpoints: 4,

  // 🐛 Debug (only in dev mode)
  debugMetalStats: __DEV__,
  logRenderTimes: __DEV__,
};

/**
 * Runtime feature flags
 * Can be overridden via remote config or local storage
 */
class FeatureFlagManager {
  private flags: FeatureFlags = { ...DEFAULT_FLAGS };

  /**
   * Get current feature flags
   */
  getFlags(): FeatureFlags {
    return { ...this.flags };
  }

  /**
   * Update a specific feature flag
   */
  setFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
    this.flags[key] = value;
    console.log(`[FeatureFlags] ${key} = ${value}`);
  }

  /**
   * Check if a feature is enabled
   */
  isEnabled(feature: keyof FeatureFlags): boolean {
    return Boolean(this.flags[feature]);
  }

  /**
   * Reset to default flags
   */
  reset(): void {
    this.flags = { ...DEFAULT_FLAGS };
  }

  /**
   * Enable Metal rendering (if available)
   */
  enableMetal(): boolean {
    if (Platform.OS !== 'ios' || !isMetalAvailable()) {
      console.warn('[FeatureFlags] Metal not available on this platform');
      return false;
    }

    this.flags.useMetalCanvas = true;
    this.flags.useMetalExport = true;
    console.log('[FeatureFlags] Metal rendering enabled');
    return true;
  }

  /**
   * Disable Metal rendering
   */
  disableMetal(): void {
    this.flags.useMetalCanvas = false;
    this.flags.useMetalExport = false;
    console.log('[FeatureFlags] Metal rendering disabled');
  }

  /**
   * Load flags from storage (for persistence)
   */
  async loadFromStorage(): Promise<void> {
    // TODO: Implement AsyncStorage integration
    // const stored = await AsyncStorage.getItem('feature_flags');
    // if (stored) {
    //   this.flags = { ...this.flags, ...JSON.parse(stored) };
    // }
  }

  /**
   * Save flags to storage
   */
  async saveToStorage(): Promise<void> {
    // TODO: Implement AsyncStorage integration
    // await AsyncStorage.setItem('feature_flags', JSON.stringify(this.flags));
  }
}

// Singleton instance
export const featureFlags = new FeatureFlagManager();

// Convenience exports
export const isMetalEnabled = () => featureFlags.isEnabled('useMetalCanvas');
export const isMetalExportEnabled = () => featureFlags.isEnabled('useMetalExport');
export const isNativePersistenceEnabled = () => featureFlags.isEnabled('useNativePersistence');
export const isGpuPaintEngineEnabled = () => featureFlags.isEnabled('useGpuPaintEngine');
export const isMetalPaintEngineEnabled = () => featureFlags.isEnabled('useMetalPaintEngine');

export default featureFlags;
