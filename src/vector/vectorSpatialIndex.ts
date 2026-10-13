import type { VectorStroke } from './vectorTypes';

export interface SpatialRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Entry {
  stroke: VectorStroke;
  order: number;
  rect: SpatialRect;
  centerX: number;
  centerY: number;
}

interface Node {
  rect: SpatialRect;
  children?: Node[];
  entries?: Entry[];
}

const MAX_LEAF_ENTRIES = 16;

function unionRect(entries: Entry[]): SpatialRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of entries) {
    minX = Math.min(minX, entry.rect.minX);
    minY = Math.min(minY, entry.rect.minY);
    maxX = Math.max(maxX, entry.rect.maxX);
    maxY = Math.max(maxY, entry.rect.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function unionNodeRects(nodes: Node[]): SpatialRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.rect.minX);
    minY = Math.min(minY, node.rect.minY);
    maxX = Math.max(maxX, node.rect.maxX);
    maxY = Math.max(maxY, node.rect.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function intersects(a: SpatialRect, b: SpatialRect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function finiteRect(rect: SpatialRect): boolean {
  return Number.isFinite(rect.minX) && Number.isFinite(rect.minY) &&
    Number.isFinite(rect.maxX) && Number.isFinite(rect.maxY) &&
    rect.maxX >= rect.minX && rect.maxY >= rect.minY;
}

function buildTree(entries: Entry[]): Node | null {
  if (entries.length === 0) return null;
  if (entries.length <= MAX_LEAF_ENTRIES) {
    return { rect: unionRect(entries), entries };
  }

  const bounds = unionRect(entries);
  const splitX = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
  entries.sort((a, b) => splitX ? a.centerX - b.centerX : a.centerY - b.centerY);
  const groupSize = Math.ceil(entries.length / 2);
  const left = buildTree(entries.slice(0, groupSize));
  const right = buildTree(entries.slice(groupSize));
  const children = [left, right].filter((child): child is Node => child !== null);
  return { rect: unionNodeRects(children), children };
}

function queryTree(node: Node | undefined, rect: SpatialRect, found: Map<string, Entry>): void {
  if (!node || !intersects(node.rect, rect)) return;
  if (node.entries) {
    for (const entry of node.entries) {
      if (intersects(entry.rect, rect)) found.set(entry.stroke.strokeID, entry);
    }
    return;
  }
  for (const child of node.children ?? []) queryTree(child, rect, found);
}

/**
 * Immutable packed rectangle tree for Vector Mode.
 *
 * Strokes remain in document order, while this static BVH answers viewport
 * and tile queries without scanning the complete document. Wide/giant strokes
 * are ordinary tree entries, so they cannot force a pathological hash range.
 */
export class VectorSpatialIndex {
  private readonly root: Node | null;
  private readonly entryCount: number;

  constructor(strokes: VectorStroke[]) {
    const entries = strokes.flatMap((stroke, order) => {
      const rect = stroke.worldBounds;
      if (!finiteRect(rect)) return [];
      return [{
        stroke,
        order,
        rect,
        centerX: (rect.minX + rect.maxX) / 2,
        centerY: (rect.minY + rect.maxY) / 2,
      }];
    });
    this.entryCount = entries.length;
    this.root = buildTree(entries);
  }

  query(rect: SpatialRect): VectorStroke[] {
    if (!finiteRect(rect)) return [];
    const found = new Map<string, Entry>();
    queryTree(this.root ?? undefined, rect, found);
    return [...found.values()]
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.stroke);
  }

  get size(): number {
    return this.entryCount;
  }
}

export function spatialRectForCamera(
  camera: { cx: number; cy: number; zoom: number },
  width: number,
  height: number,
  marginWorld = 0,
): SpatialRect {
  const zoom = Math.max(1e-9, Number.isFinite(camera.zoom) ? camera.zoom : 1);
  const halfW = width / 2 / zoom + marginWorld;
  const halfH = height / 2 / zoom + marginWorld;
  return {
    minX: camera.cx - halfW,
    minY: camera.cy - halfH,
    maxX: camera.cx + halfW,
    maxY: camera.cy + halfH,
  };
}

/**
 * Append-friendly wrapper around {@link VectorSpatialIndex}.
 *
 * WHY THIS EXISTS
 * VectorCanvas used `useMemo(() => new VectorSpatialIndex(strokes), [strokes])`, so the entire
 * tree was rebuilt every time a stroke was committed. buildTree sorts and slices at every level
 * of the recursion (O(n log² n) with heavy allocation), so the cost of drawing stroke n was
 * proportional to n — the canvas got measurably slower the longer you worked, which is exactly
 * the "fine at first, unusable after a while" behaviour.
 *
 * HOW IT STAYS FAST FOREVER
 * Painting only ever APPENDS. So the built tree is kept and new strokes accumulate in a small
 * linear buffer that is scanned directly. The tree is rebuilt only once the buffer passes a
 * threshold, which makes the amortised cost per stroke O(log n) instead of O(n log² n) — flat
 * from the user's point of view no matter how large the project grows.
 *
 * Anything that is NOT a pure append (undo, delete, reorder, load) is detected in O(1) and falls
 * back to a full rebuild, so correctness never depends on the fast path being right.
 */
const DELTA_REBUILD_THRESHOLD = 256;

export class IncrementalVectorSpatialIndex {
  private index: VectorSpatialIndex = new VectorSpatialIndex([]);
  private indexedCount = 0;
  private tailId: string | null = null;
  private delta: VectorStroke[] = [];

  /** Cheap O(1) check: did `strokes` grow purely by appending to what we already indexed? */
  private isPureAppend(strokes: VectorStroke[]): boolean {
    if (strokes.length < this.indexedCount) return false;
    if (this.indexedCount === 0) return true;
    const tail = strokes[this.indexedCount - 1];
    return Boolean(tail) && tail.strokeID === this.tailId;
  }

  private rebuild(strokes: VectorStroke[]): void {
    this.index = new VectorSpatialIndex(strokes);
    this.indexedCount = strokes.length;
    this.tailId = strokes.length > 0 ? strokes[strokes.length - 1].strokeID : null;
    this.delta = [];
  }

  /** Call whenever the stroke array changes. Cheap unless a rebuild is genuinely required. */
  sync(strokes: VectorStroke[]): void {
    if (!this.isPureAppend(strokes)) {
      this.rebuild(strokes);
      return;
    }
    const appended = strokes.length - this.indexedCount;
    if (appended === 0) return;
    if (this.delta.length + appended > DELTA_REBUILD_THRESHOLD) {
      this.rebuild(strokes);
      return;
    }
    for (let i = this.indexedCount; i < strokes.length; i += 1) this.delta.push(strokes[i]);
    this.indexedCount = strokes.length;
    this.tailId = strokes[strokes.length - 1].strokeID;
  }

  /**
   * Visible strokes in DRAW ORDER. Delta strokes were appended after everything in the tree, so
   * concatenating them afterwards preserves painting order without another sort.
   */
  query(rect: SpatialRect): VectorStroke[] {
    const base = this.index.query(rect);
    if (this.delta.length === 0) return base;
    const extra: VectorStroke[] = [];
    for (let i = 0; i < this.delta.length; i += 1) {
      const stroke = this.delta[i];
      const bounds = stroke.worldBounds;
      if (!finiteRect(bounds)) continue;
      if (bounds.maxX < rect.minX || bounds.minX > rect.maxX) continue;
      if (bounds.maxY < rect.minY || bounds.minY > rect.maxY) continue;
      extra.push(stroke);
    }
    return extra.length > 0 ? base.concat(extra) : base;
  }

  get size(): number {
    return this.index.size + this.delta.length;
  }
}
