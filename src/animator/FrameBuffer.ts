import { nanoid } from 'nanoid/non-secure';

export type GlyphAnchor = {
  x: number;
  y: number;
};

export type GlyphSample = {
  x: number;
  y: number;
  t: number;
  emoji: string;
  size: number;
  opacity: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  dynamicEmoji?: boolean;
  anchor: GlyphAnchor;
};

export type BrushSnapshot = {
  emoji: string;
  size: number;
  opacity: number;
  spacing: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  dynamicEmoji: boolean;
};

export type AnimatorStroke = {
  id: string;
  brush: BrushSnapshot;
  startFrame: number;
  duration: number;
  wrapOverflow?: number;
  samples: GlyphSample[];
  cachedBounds?: { x: number; y: number; width: number; height: number };
  cachedTextureUri?: string;
  isBackground?: boolean;
};

type EventMap = Map<number, Set<string>>;

export interface FrameBufferSnapshot {
  totalFrames: number;
  strokes: AnimatorStroke[];
  backgroundStrokeIds: string[];
}

export class FrameBuffer {
  totalFrames: number;
  startEvents: EventMap;
  endEvents: EventMap;
  strokeBuckets: Map<string, AnimatorStroke>;
  backgroundStrokeIds: Set<string>;

  constructor(totalFrames = 300) {
    this.totalFrames = totalFrames;
    this.startEvents = new Map();
    this.endEvents = new Map();
    this.strokeBuckets = new Map();
    this.backgroundStrokeIds = new Set();
  }

  private registerEvent(map: EventMap, frame: number, strokeId: string) {
    const normalized = ((frame % this.totalFrames) + this.totalFrames) % this.totalFrames;
    if (!map.has(normalized)) {
      map.set(normalized, new Set());
    }
    map.get(normalized)?.add(strokeId);
  }

  private unregisterEvent(map: EventMap, frame: number, strokeId: string) {
    const normalized = ((frame % this.totalFrames) + this.totalFrames) % this.totalFrames;
    const bucket = map.get(normalized);
    if (!bucket) return;
    bucket.delete(strokeId);
    if (bucket.size === 0) {
      map.delete(normalized);
    }
  }

  setFrameCount(frames: number) {
    const normalized = Math.max(1, Math.min(20000, Math.floor(frames)));
    if (normalized === this.totalFrames) {
      return;
    }
    this.totalFrames = normalized;
    // Rebuild event maps to ensure start/end indices remain consistent
    const strokes = Array.from(this.strokeBuckets.values());
    this.startEvents.clear();
    this.endEvents.clear();
    this.backgroundStrokeIds.clear();
    strokes.forEach((stroke) => {
      const normalizedStart = ((stroke.startFrame % this.totalFrames) + this.totalFrames) % this.totalFrames;
      stroke.startFrame = normalizedStart;
      if (stroke.duration === -1 || stroke.isBackground) {
        stroke.isBackground = true;
        stroke.duration = -1;
        stroke.wrapOverflow = undefined;
        this.backgroundStrokeIds.add(stroke.id);
        return;
      }
      const duration = Math.max(1, stroke.duration);
      stroke.duration = duration;
      stroke.isBackground = false;
      stroke.wrapOverflow = Math.max(0, normalizedStart + duration - this.totalFrames);
      this.registerEvent(this.startEvents, normalizedStart, stroke.id);
      this.registerEvent(this.endEvents, normalizedStart + duration, stroke.id);
    });
  }

  addStroke(stroke: Omit<AnimatorStroke, 'id'> & { id?: string }) {
    const id = stroke.id ?? nanoid();
    const normalizedStart = ((stroke.startFrame % this.totalFrames) + this.totalFrames) % this.totalFrames;
    const duration = stroke.duration === -1 ? -1 : Math.max(1, stroke.duration);
    const record: AnimatorStroke = {
      ...stroke,
      id,
      startFrame: normalizedStart,
      duration,
      wrapOverflow: duration === -1 ? undefined : Math.max(0, normalizedStart + duration - this.totalFrames)
    };
    this.strokeBuckets.set(id, record);
    if (record.isBackground || record.duration === -1) {
      this.backgroundStrokeIds.add(id);
      return id;
    }
    this.backgroundStrokeIds.delete(id);
    this.registerEvent(this.startEvents, normalizedStart, id);
    const endFrame = normalizedStart + duration;
    this.registerEvent(this.endEvents, endFrame, id);
    return id;
  }

  removeStroke(strokeId: string) {
    const stroke = this.strokeBuckets.get(strokeId);
    if (!stroke) return;
    this.strokeBuckets.delete(strokeId);
    this.backgroundStrokeIds.delete(strokeId);
    if (stroke.duration === -1 || stroke.isBackground) {
      return;
    }
    this.unregisterEvent(this.startEvents, stroke.startFrame, strokeId);
    this.unregisterEvent(this.endEvents, stroke.startFrame + stroke.duration, strokeId);
  }

  clear() {
    this.startEvents.clear();
    this.endEvents.clear();
    this.strokeBuckets.clear();
    this.backgroundStrokeIds.clear();
  }

  getActiveStrokeIds(frameIndex: number) {
    const normalized = ((frameIndex % this.totalFrames) + this.totalFrames) % this.totalFrames;
    const spawned: string[] = [];
    const retired: string[] = [];
    const start = this.startEvents.get(normalized);
    if (start) {
      spawned.push(...start);
    }
    const end = this.endEvents.get(normalized);
    if (end) {
      retired.push(...end);
    }
    return { spawned, retired };
  }

  snapshot(): FrameBufferSnapshot {
    return {
      totalFrames: this.totalFrames,
      strokes: Array.from(this.strokeBuckets.values()),
      backgroundStrokeIds: Array.from(this.backgroundStrokeIds)
    };
  }

  restore(snapshot: FrameBufferSnapshot) {
    this.clear();
    this.totalFrames = snapshot.totalFrames;
    snapshot.strokes.forEach(stroke => {
      this.addStroke(stroke);
    });
    snapshot.backgroundStrokeIds.forEach(id => {
      const stroke = this.strokeBuckets.get(id);
      if (stroke) {
        stroke.isBackground = true;
        stroke.duration = -1;
        this.backgroundStrokeIds.add(id);
      }
    });
  }

  getStroke(strokeId: string) {
    return this.strokeBuckets.get(strokeId);
  }

  getStrokes() {
    return Array.from(this.strokeBuckets.values());
  }
}
