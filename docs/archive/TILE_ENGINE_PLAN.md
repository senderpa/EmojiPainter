# EmojiPaint — Tile-Based GPU Painting Engine: Analysis & Rewrite Plan

Status: living document. Branch `gpu-paint-engine`. Backup: tag `backup-pre-gpu-engine-v8.2.0`
(commit 99e1e2b8) + tarball `~/emojipaint-mobile2030-backup-2026-06-19-pre-gpu-engine.tar.gz`.

---

## PHASE 0 — Current architecture (evidence-based)

### Rendering pipeline (live)
- Boundary: `src/workspace/PaintCanvas.tsx` — props `{width,height,strokes[],liveStroke,liveVersion,
  backgroundColor,previewStroke}`. Routes Skia (`EmojiCanvas`) / Metal (headless, export only) /
  `GpuPaintCanvas` (new, flagged).
- Legacy `src/components/EmojiCanvas.tsx`: committed painting on a **CPU raster** surface
  (`Skia.Surface.Make`, JS thread). `syncSurfaceWithStrokes` does prefix-diff **incremental append**
  for new strokes, but **checkpoints are disabled** (`CHECKPOINT_INTERVAL=999999`) → any undo/edit/
  reorder triggers `rebuildSurface` = **replay ALL strokes from 0**. Stamp cache capped at 20
  (`MAX_STAMP_CACHE_SIZE`) → re-rasterization thrash on varied emoji. Display = `<Image>` of the CPU
  snapshot + live/hover preview as direct Skia nodes.
- Smudge: GPU SkSL carry shader on a pooled adaptive work surface, **seeded from the committed CPU
  snapshot each stroke-begin (full-canvas raster→GPU upload, ~37MB on iPad)** + per-frame dirty-rect
  snapshot. Commit bakes a PNG tile (`bakedTile`+`bakedBounds`), cached + persisted. See
  `src/lib/smudge/*`.
- New `src/engine/GpuPaintCanvas.tsx` (Phase 0/1, flag `useGpuPaintEngine`): records all committed
  strokes into an `SkPicture` and rasterizes to a GPU texture on the **UI thread** via
  `usePictureAsTexture` (zero readback). Correct foundation, but **re-records O(n) every commit**.

### Stroke data model (`src/state/PaintingContext.tsx`)
- `StrokePoint { x, y, t, w? }`. `Stroke { id, emoji, size, opacity, spacing?, stampSpan?, points[],
  emojiSequence?, mirrorX?, mirrorY?, rotation?, isEraser?, isSmudge?, smudgeStrength?,
  edgeBlendStrength?, reloadRate?, dirtyUpdateRate?, bakedTile?, bakedBounds?, startFrame?,
  frameDuration?, isPlane?, planeCorners?, planeCornerHistory?, planeStampSize?, isCustomEmoji? }`.
- Source of truth = `state.strokes[]` for **render + undo + autosave + export**. Reducer: `COMMIT_STROKE`
  appends (cap `MAX_HISTORY=2000`, clears redo); `UNDO`/`REDO` slice between `strokes[]` and
  `undoStack[]` (cap 10); `LOAD_STATE` bulk-restores; planes have a parallel stack.

### Save / recovery (`src/lib/autosave.ts`, `src/lib/storage.ts`)
- AsyncStorage JSON. Autosave key `emojipaint/autosave` (idle 3s, after 60s & ≥5 strokes); also
  `sprint-autosave`, `general-autosave` (daily). Projects `emojipaint/project/{session}/{name}`,
  animation `emojipaint/animation/...`. Payload = full `strokes[]` (smudge `bakedTile` base64 encoded
  at idle via `ensureSmudgeTilesEncoded`). FileSystem only for video/media. No point-in-time crash
  snapshot (recovery = last autosave).

### Frames / overlays / timelapse
- Framer (`src/framer/FramerWorkspace.tsx`): each frame holds its **own** `strokes[]`; switching frames
  dispatches `LOAD_STATE`. `Stroke.startFrame/frameDuration` exist but Framer doesn't use them.
- Onion skin (`src/animation/FrameByFrameScreen.tsx`): **stacked `PaintCanvas`** instances of prev/next
  frames at reduced opacity. Trace (`TraceState`): separate RN `<Image>`, not a stroke.
- Timelapse (`src/lib/timelapse.ts`, `TimelapseScreen`): **stroke-replay** by point-time; preview mounts
  a canvas and rebuilds; smudge shown only if `bakedTile` present.

### Export / pixel consumers (all replay `strokes[]`, independent of live engine)
- Still PNG: `src/lib/smudge/skiaOffscreenRender.ts#renderStrokesToBase64` (Skia raster replay).
- Video/GIF/WebM: `src/native/timelapse.ts` → Swift `TimelapseExporterModule` /
  `StrokeReplayEngine` / `EmojiAtlas` (native Metal replay; blits `bakedTile`).
- Upload/challenge: `react-native-view-shot` `captureRef` of the live canvas (so live render must be
  correct) → `src/lib/dailyPaintUpload.ts`.
- AI (`src/services/aiContentService.ts`): img2img/ControlNet from a snapshot JPEG.
- AR (`modules/emoji-ar`): **independent** of the 2D canvas.

### Bottlenecks (confirmed)
1. Undo/edit = full stroke replay (checkpoints disabled).
2. Smudge = full-canvas upload per stroke-begin + per-frame readback (thread-context bound).
3. Stamp cache thrash (size 20).
4. New `GpuPaintCanvas` re-records O(n) per commit.

---

## PHASE 1 — New architecture (right-sized, GPU-first, command-log preserved)

Principle (per brief): **`strokes[]` stays as the append-only command log** (history, timelapse,
export, save, rebuild). The **visible painting is baked tiles**; live painting and undo touch **only
dirty tiles**. Exports are untouched (they already replay `strokes[]`).

### Modules (new, under `src/engine/tiles/`)
- `tileMath.ts` (PURE, unit-tested): tile grid, `rectToTiles(rect)`, stroke→dirty-rect, key helpers.
- `TileGrid` / `TileBackingStore`: the canvas as a grid of fixed tiles (512px device default → 36 tiles
  on a 3× 1024² canvas). Backed initially by **one Skia surface + per-tile dirty tracking** (simple,
  testable), upgradeable to per-tile GPU surfaces on the UI thread.
- `TileRevisionUndo` (PURE-ish, unit-tested): before a stroke draws, snapshot the affected tiles'
  prior images; `undo` blits them back (O(affected tiles), **no replay**); `redo` re-applies. Bounded
  ring (matches current `MAX_UNDO_STACK`).
- `TileEngine`: receives committed strokes incrementally → computes dirty rect → renders only affected
  tiles via the existing `appendStrokeToSurface` ops + `BrushStampCache`. Composites visible tiles to a
  display image. Drives smudge tile-locally.
- `BrushStampCache`: keep current `getStamp` LRU but **raise the budget** and key by
  emoji+sizeBucket(+tint) so emoji aren't re-rasterized per point.
- `SmudgeTileSession` (Phase 5): smudge seeded from **affected tiles only** (not full canvas) → tiny
  upload; tile-local ping-pong; writes back affected tiles; reuses `gpuSmudge.ts` SkSL + bake-to-tile.

### Display strategy
- v1 (testable now): tiled CPU-raster compositing + `<Image>` of composite (same display contract as
  today; fixes incremental + undo cost). 
- v2 (GPU-first): tiles as UI-thread GPU surfaces composited via the proven `usePictureAsTexture` /
  worklet path → zero readback; smudge with no full-canvas upload/readback.

### Stable boundaries (do NOT change)
`PaintCanvas` props; `PaintingContext` stroke model + reducer; `autosave`/`storage` formats; all export
paths (`renderStrokesToBase64`, `native/timelapse.ts`, Swift exporter); `emoji-ar`. Engine lives
**behind** `PaintCanvas` only.

---

## Phased implementation
- **P3 (now): tile substrate** — `tileMath` + `TileRevisionUndo` + `TileEngine` core with incremental
  dirty-tile render + tile-revision undo; behind `PaintCanvas` flag; **strokes[] preserved**; smudge →
  legacy fallback. Unit tests. Fix `GpuPaintCanvas` O(n) regression (default legacy until tiles ready).
- **P4: normal-paint parity** — stamps, sequences, spacing/resample, per-point width, rotation, mirror,
  eraser (Clear), opacity, custom PNG, background, live/hover preview. A/B still-PNG vs legacy.
- **P5: smudge** — tile-local GPU smudge (no full-canvas upload/readback), bake-to-tile retained.
- **P6: frames/onion/trace** — verify frame switch = tile rebuild; onion = lightweight tile composite.
- **P7–8: timelapse/export** — verify unchanged (replay strokes[]); add nothing unless a gap appears.
- **P9–10: save/recovery/back-comat** — keep current format; optional dirty-tile cache for fast resume;
  never overwrite old projects until new save verified.
- **P11–12: perf + parity gate** — targets below; full checklist before flipping default.
- **P13: fallback** — keep `EmojiCanvas` + flag until the gate passes.

## Performance targets
- New stroke cost independent of total stroke count (only dirty tiles).
- Undo = O(affected tiles), never full replay.
- Smudge size 5–300 interactive on iPhone 12 Pro + iPad Pro; no full-canvas upload/readback; no
  slower-per-stroke.
- GPU/CPU tile budgets; export via strip/tile for any large target (current sizes are safe).

## Risks
- UI-thread worklet GPU tiles are the hard part → land CPU-raster tiles first (testable), then GPU.
- Visual parity (stamp transforms/eraser/planes) → A/B still-PNG gate.
- Frame/onion stacking cost → lightweight per-frame tile composite.
- Can't self-test on device → small phases, jest where pure, explicit on-device checks each phase.

## Parity checklist (gate before default flip)
emoji stamps · sequences/spray · spacing/resample · per-point width · rotation · mirror X/Y · eraser ·
opacity · custom PNG · background · live/hover preview · smudge (all sizes) · planes · undo/redo · frames ·
onion · trace · timelapse preview+export · still PNG · video/GIF/WebM · upload · AI snapshot · AR (unaffected).
