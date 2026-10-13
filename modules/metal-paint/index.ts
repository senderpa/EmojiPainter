/**
 * MetalPaint — JS bindings for the native Metal live painting view.
 *
 * Tolerant resolution like emoji-ar: if the native module is absent (Android, Expo Go, a build
 * without the module), exports degrade gracefully so importing never crashes. Callers must null-check
 * `MetalPaintNativeView` before use.
 */
import * as React from 'react';
import type { ViewProps } from 'react-native';

export interface MetalPaintViewProps extends ViewProps {
  /** Canvas background color (hex, e.g. "#050505"). */
  backgroundColor?: string;
  /** Canvas logical (DIP) width — for NDC mapping of stroke coords. */
  canvasWidth?: number;
  /** Canvas logical (DIP) height. */
  canvasHeight?: number;
  /** Committed strokes as a JSON array string (non-smudge). */
  strokesJson?: string;
  /** In-progress stroke as a JSON array of 0 or 1 stroke. */
  liveStrokeJson?: string;
  /** Baked smudge tiles as a JSON object { "<strokeId>": "<base64 PNG>" } — separate from strokesJson. */
  smudgeTilesJson?: string;
  /** Pause the render loop. */
  paused?: boolean;
  onReady?: (event: { nativeEvent: { buildTag?: string } }) => void;
  onPaintError?: (event: { nativeEvent: { message: string } }) => void;
  /** Fired (deferred, when idle) after a smudge: the baked tile's relative FILE path + bounds (DIP). */
  onSmudgeBaked?: (event: {
    nativeEvent: { id: string; path: string; x: number; y: number; w: number; h: number };
  }) => void;
  /** Native smudge timings → JS console (readable off-device, unlike NSLog). */
  onPerf?: (event: { nativeEvent: { msg: string } }) => void;
}

let MetalPaintNativeView: React.ComponentType<MetalPaintViewProps> | null = null;
let resolved = false;

// Resolve LAZILY and RETRY until success: evaluating once at import can run before the native runtime
// is ready (→ permanently stuck off). requireNativeModule throws if the module isn't registered;
// requireNativeViewManager alone returns a placeholder even when absent (the "Unimplemented component"
// red screen), so gate on the module being truly present first.
const ensureResolved = (): void => {
  if (resolved) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule, requireNativeViewManager } = require('expo-modules-core');
    requireNativeModule('MetalPaint');
    MetalPaintNativeView = requireNativeViewManager('MetalPaint', 'MetalPaintView');
    resolved = MetalPaintNativeView !== null;
    if (resolved) {
      console.log('[metal-paint] native Metal view AVAILABLE');
    }
  } catch (e) {
    MetalPaintNativeView = null;
    console.log('[metal-paint] native view NOT available (will retry):', (e as Error)?.message);
  }
};

/** True when the native Metal paint module is registered in this binary (retries until it resolves). */
export const isMetalPaintViewAvailable = (): boolean => {
  ensureResolved();
  return MetalPaintNativeView !== null;
};

/** The native view component (or null if unavailable). Use this instead of importing the binding directly. */
export const getMetalPaintNativeView = (): React.ComponentType<MetalPaintViewProps> | null => {
  ensureResolved();
  return MetalPaintNativeView;
};

export { MetalPaintNativeView };
