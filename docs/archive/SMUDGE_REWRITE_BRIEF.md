# Smudge Brush — Professional Rewrite Brief (for an implementing agent)

## Why this rewrite

The current smudge in `src/lib/smudge/` + `src/components/EmojiCanvas.tsx` uses the WRONG model and a
fragile persistence strategy. Two root flaws, confirmed by research (MyPaint/Krita source, Procreate
docs, react-native-skia maintainer):

1. **It blurs instead of pushing color.** The live GPU shader (`gpuSmudge.ts` SMUDGE_SKSL) does
   *displacement + local average*. A local average is a low-pass filter (blur) — increasing
   "smoothness" just blurs more. Professional smudge uses a **carry buffer** ("color on the finger")
   that picks up canvas color, carries it along the stroke, and deposits it. That TRANSPORTS color
   (creamy, directional, Procreate-like) instead of averaging neighborhoods.

2. **It re-runs the smudge on replay (undo/remount/timelapse/export).** No professional engine does
   this — Krita/Photoshop/Procreate all **bake the destructive result to raster pixels at commit**
   and blit it afterward. Re-running causes: look mismatch (live GPU vs CPU replay), pixelation (CPU
   path downsamples big brushes), and catastrophic timelapse cost (O(strokes × frames)).

## The target architecture (unify everything)

### A) Algorithm: carry-buffer smudge (MyPaint "legacy" / Krita "Dulling")
Per dab, in order along the stroke:
```
update_factor = max(0.01, smudgeLength)            # smudgeLength = the user's smoothness slider
pickup        = areaAverage(canvas, dabCenter, smudgeRadius)   # multi-tap box/disc average
# EMA carry (transport, not blur):
carry.rgb = update_factor*carry.rgb + (1-update_factor)*pickup.a*pickup.rgb
carry.a   = clamp(update_factor*carry.a + (1-update_factor)*pickup.a, 0, 1)
# deposit, gated by the emoji/brush mask alpha m and a deposit rate (smudgeRate, ~opacity):
out = mix(dst, carry, m * smudgeRate)              # for pure smudge brushColor==carry; no FG color
```
- `smudgeLength` high → carries color far; low → local pickup (near-blur). This is the slider.
- Pickup AREA-AVERAGE is used only to refresh the carry, never deposited directly — that's the
  difference between transport and blur.
- Keep canvas + math at FULL resolution (never downsample for big brushes → no pixelation). Scale
  the pickup radius / tap count with brush size instead.
- The emoji alpha is the dab mask `m` (footprint shape). Optional Krita "Smearing" mode later
  (carries a small patch texture, not a single color) for a heavier oil look.

### B) GPU implementation, crash-safe (real-time)
- Persistent, REUSED offscreen surfaces (never per-stroke `MakeOffscreen`): one canvas work surface
  + a tiny carry ping-pong pair (1×1 to 8×8). Test `Surface.Make` vs `Surface.MakeOffscreen` —
  maintainer's working ping-pong example uses `Surface.Make`; `MakeOffscreen` reportedly blanks on
  some setups (verify on device).
- Per FRAME: take ONE `makeImageSnapshot()` of the canvas (NOT per dab — per-dab full-canvas
  snapshots are what cause GPU OOM/crash). Feed it as a child shader (`makeShaderOptions`).
- Per dab in the frame: run an UPDATE pass writing the tiny carry (EMA), then a DEPOSIT pass drawn
  as a SCISSORED quad bounded to the dab's bbox onto the canvas, sampling the frame snapshot + carry.
  If the carry is a single color, thread it as a uniform (no texture ping-pong needed).
- `RuntimeEffect.makeShaderWithChildren(uniforms: number[], children: SkShader[])` — uniforms are a
  FLAT array in SkSL declaration order (pack carefully; #1 bug source). SkSL loops need
  compile-time-constant bounds (fixed tap count).
- Display offscreen result on the on-screen Canvas via `image.makeNonTextureImage()` (raw offscreen
  GPU textures render BLACK on the main canvas — already learned).

### C) Persistence: BAKE-TO-TILE at commit (the key unification)
- Live: run the carry-buffer smudge GPU shader on the working surface (real-time).
- On COMMIT: compute the stroke's dirty rect (bbox of dabs + radius); `makeImageSnapshot(dirtyRect)`
  from the live surface; store on the stroke as `bake: { tileBounds, image }` (full-res). Also store
  the BEFORE-pixels of the dirty rect as the undo patch.
- Everywhere else just blits the baked tile (no re-run, deterministic, identical look):
  - rebuild/remount/undo-redo: `canvas.drawImage(bake.image, tileBounds)`
  - still export + native video exporter: draw the baked PNG (no shader needed in native)
- Data model: `Stroke = {kind:'smudge', size, points, bake:{tileBounds, imageRef}}`. Persist the tile
  in the project file (zip-of-PNG/WebP, like .procreate/.kra). Do NOT re-bake on load.
- Memory: keep baked tiles as compressed CPU bytes; upload to GPU on demand (LRU). Tile granularity
  (e.g. 256×256) so overlapping smudges share tiles.

### D) Timelapse: append-only plate + keyframes (O(strokes), not O(strokes×frames))
- Maintain ONE persistent "plate" surface = all strokes revealed so far. Advancing the timeline past
  stroke N draws ONLY stroke N onto the plate (emoji stamp, or `drawImage` of the smudge's baked
  tile). Never rebuild from 0.
- Per displayed frame: `drawImage(plate)` once. No smudge mixing at playback.
- Optional grow-reveal: clip the baked tile to a growing sub-rect (still no mixing).
- Keyframe snapshot every ~10–25 strokes for fast seek/startup (fixes the "blank 30s then slow").

### E) Robustness
- Reuse a small surface pool; never allocate per stroke.
- Dirty-rect / tile bookkeeping; only touch affected tiles.
- Bound Skia GPU cache: `setResourceCacheLimit`, `purgeUnlockedResources` after baking/closing
  timelapse.

## Constraints (must keep)
- Don't rebuild the app or rename existing systems. Integrate into `src/lib/smudge/`,
  `EmojiCanvas.tsx`, `PaintingContext.tsx`, `TimelapseScreen.tsx`, `skiaOffscreenRender.ts`,
  `timelapse.ts`.
- Keep the 3-mode toggle (opaque/transparent/smudge, 👆) and the vertical smoothness slider
  (`smudgeSmoothness` → maps to `smudgeLength`).
- Save/load and existing emoji/eraser/plane strokes must keep working.
- Real device required for testing (iPhone 12 Pro + iPad Pro; Debug build via Metro on :8081).

## Key sources
- libmypaint smudge: github.com/mypaint/libmypaint/blob/master/mypaint-brush.c
- Krita Color Smudge engine: docs.krita.org/en/reference_manual/brushes/brush_engines/color_smudge_engine.html
- Krita 5 smudge rewrite MR !756: invent.kde.org/graphics/krita/-/merge_requests/756
- RN-Skia ping-pong (maintainer): github.com/Shopify/react-native-skia/discussions/1495
- RN-Skia textures/shaders: shopify.github.io/react-native-skia/docs/animations/textures/
- Krita strokes/undo (bake result, not re-run): docs.krita.org/en/untranslatable_pages/strokes_documentation.html
- Krita Recorder timelapse (snapshot per stroke): docs.krita.org/en/reference_manual/dockers/recorder_docker.html
