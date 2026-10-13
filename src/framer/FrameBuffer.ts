/**
 * FrameBuffer: Time-based stroke management for efficient animation
 *
 * Based on emojipaintD animator workspace architecture.
 * Uses delta updates and stroke duration instead of layer-per-frame for better performance.
 */

import type { StrokeData } from '../lib/StrokeTypes';

export type StrokeLayerId = number;

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

export interface BrushSnapshot {
  emoji: string;
  size: number;
  opacity: number;
  spacingPercent: number;
  mirrored: boolean;
  inverted: boolean;
  dynamic: boolean;
  rotation: number;
  isEraser?: boolean;
}

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StrokeBucket {
  id: StrokeLayerId;
  points: StrokePoint[];
  brush: BrushSnapshot;
  startFrame: number; // Frame this stroke starts being visible (inclusive)
  duration: number; // Number of frames this stroke persists
  bbox: BoundingBox; // Bounding box for rasterization
  wrapOverflow: number; // For looping animations
  cachedImageUri?: string; // URI to cached raster image
}

export class FrameBuffer {
  readonly frameCountMax = 20000;
  private frameCountValue: number;
  private readonly startEvents = new Map<number, StrokeLayerId[]>();
  private readonly endEvents = new Map<number, StrokeLayerId[]>();
  private readonly layers = new Map<StrokeLayerId, StrokeBucket>();
  private nextId = 1;
  private readonly hiddenLayers = new Set<StrokeLayerId>();

  constructor(frameCount: number) {
    this.frameCountValue = this.clamp(frameCount, 1, this.frameCountMax);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  get frameCount(): number {
    return this.frameCountValue;
  }

  updateFrameCount(n: number): void {
    this.frameCountValue = this.clamp(n, 1, this.frameCountMax);
  }

  /**
   * Adds a stroke bucket to the frame buffer
   * Returns the assigned layer ID
   */
  addStrokeBucket(bucket: Omit<StrokeBucket, 'id'>): StrokeLayerId {
    const id = this.nextId++;
    const start = this.clamp(bucket.startFrame, 0, this.frameCountValue - 1);
    const duration = Math.max(1, Math.min(bucket.duration, this.frameCountValue));
    const rawEnd = start + duration;
    const overflow = Math.min(Math.max(0, bucket.wrapOverflow ?? 0), this.frameCountValue);
    const endFrame = rawEnd % this.frameCountValue;

    const stored: StrokeBucket = {
      ...bucket,
      id,
      startFrame: start,
      duration,
      wrapOverflow: overflow
    };

    this.layers.set(id, stored);
    this.hiddenLayers.delete(id);

    // Add to start events
    if (!this.startEvents.has(start)) {
      this.startEvents.set(start, []);
    }
    this.startEvents.get(start)!.push(id);

    // Handle wrap overflow
    if (overflow > 0 && start !== 0) {
      if (!this.startEvents.has(0)) {
        this.startEvents.set(0, []);
      }
      this.startEvents.get(0)!.push(id);
    }

    // Add to end events
    if (!this.endEvents.has(endFrame)) {
      this.endEvents.set(endFrame, []);
    }
    this.endEvents.get(endFrame)!.push(id);

    return id;
  }

  getLayer(id: StrokeLayerId): StrokeBucket | undefined {
    return this.layers.get(id);
  }

  /**
   * Apply frame deltas to active set (for sequential playback)
   * Returns true if the active set changed
   */
  applyFrameDeltas(frameIndex: number, active: Set<StrokeLayerId>): boolean {
    let changed = false;

    // Remove layers that end at this frame
    const endIds = this.endEvents.get(frameIndex);
    if (endIds) {
      for (const id of endIds) {
        if (active.delete(id)) {
          changed = true;
        }
      }
    }

    // Add layers that start at this frame
    const startIds = this.startEvents.get(frameIndex);
    if (startIds) {
      for (const id of startIds) {
        if (this.hiddenLayers.has(id)) {
          continue;
        }
        if (!active.has(id)) {
          active.add(id);
          changed = true;
        }
      }
    }

    return changed;
  }

  /**
   * Compute active set from scratch (for random access/scrubbing)
   */
  computeActiveSet(frameIndex: number): Set<StrokeLayerId> {
    const active = new Set<StrokeLayerId>();

    for (const [id, layer] of this.layers) {
      if (this.hiddenLayers.has(id)) {
        continue;
      }

      const endExclusive = layer.startFrame + layer.duration;

      if (layer.wrapOverflow > 0) {
        const overflowEnd = layer.wrapOverflow;
        if (frameIndex >= layer.startFrame || frameIndex < overflowEnd) {
          active.add(id);
        }
      } else {
        if (frameIndex >= layer.startFrame && frameIndex < endExclusive) {
          active.add(id);
        }
      }
    }

    return active;
  }

  *allLayers(): Iterable<StrokeBucket> {
    for (const layer of this.layers.values()) {
      yield layer;
    }
  }

  hideLayer(id: StrokeLayerId): void {
    this.hiddenLayers.add(id);
  }

  showLayer(id: StrokeLayerId): void {
    this.hiddenLayers.delete(id);
  }

  isLayerHidden(id: StrokeLayerId): boolean {
    return this.hiddenLayers.has(id);
  }

  hasLayer(id: StrokeLayerId): boolean {
    return this.layers.has(id);
  }

  /**
   * Clear all layers and events
   */
  clear(): void {
    this.layers.clear();
    this.startEvents.clear();
    this.endEvents.clear();
    this.hiddenLayers.clear();
  }

  /**
   * Get all stroke buckets as array
   */
  getAllBuckets(): StrokeBucket[] {
    return Array.from(this.layers.values());
  }
}
