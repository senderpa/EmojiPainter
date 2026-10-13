# Native Metal Live Painting Engine — Plan (Procreate-tier)

Goal: a real GPU live painting canvas (native Metal `MTKView`) for the main workspace, reusing the
app's existing, battle-tested Metal export code. Staged because native changes need a device rebuild
each time (slow; watch for the Hermes `PhaseScriptExecution` issue) and cannot be unit-tested.

## What already exists (reuse)
- `modules/emojipaint-exporter/ios/EmojiAtlas.swift` — emoji + custom-PNG → `MTLTexture` LRU cache
  (`getTexture(for:size:)`, `getSmudgeTexture`, base64 PNG decode). **Reuse for stamps.**
- `modules/emojipaint-exporter/ios/StrokeReplayEngine.swift` — stamp quad pipeline, SrcOver + eraser
  (zero/oneMinusSrcAlpha) pipelines, per-point width, spacing cull, `renderToTexture(...)`.
  **Reuse the pipeline + renderStamps; retarget from CVPixelBuffer to the MTKView drawable.**
- `modules/emojipaint-exporter/ios/Shaders.metal` — `vertex_main` + `fragment_emoji_stamp(opacity)`.
  **Reuse verbatim.**
- `modules/emoji-ar/*` — the template for a live native view: ExpoModulesCore `View(...) { Prop/
  AsyncFunction/Events }`, `ExpoView` subclass, `*.podspec`, `expo-module.config.json`, autolink via
  `app.json` `expo.autolinking.searchPaths: ["./modules"]`, JS via `requireNativeViewManager`.

## What's missing (build)
A live Metal view: `MTKView`-backed `ExpoView`, present loop, GPU canvas texture(s), stroke/command
bridge from JS, eraser, smudge shader, undo, PNG snapshot. No live Metal view exists today
(`MetalEmojiCanvas` is headless; `MetalCanvasModule` native side is absent — only a JS stub in
`src/native/metal.ts`).

## Architecture
- New Expo module `modules/metal-paint/` (mirrors `emoji-ar`): `MetalPaintModule` (registration) +
  `MetalPaintView` (`ExpoView` + `MTKView`) + `MetalPaintShaders.metal` + copied/adapted `EmojiAtlas`
  + stamp renderer. JS: `modules/metal-paint/index.ts` (tolerant `requireNativeViewManager`).
- `MetalPaintCanvas.tsx` (RN wrapper, PaintCanvas-compatible props) renders the native view and passes
  `strokes` / `liveStroke` / `width` / `height` / `backgroundColor`. Routed from `PaintCanvas` behind
  `useMetalPaintEngine` (default OFF) — legacy/tile engine stay the fallback.
- Canvas held as GPU texture(s): one canvas `MTLTexture` (later tiled). Committed strokes render into
  it incrementally; the present pass blits canvas texture → drawable + live preview on top.
- `strokes[]` stays the JS command log (exports/timelapse/save/AR unchanged).

## STATUS (2026-06-19)
- **M1 ✅** built & linked on device (metal-paint module compiles).
- **M2/M3/M5 ✅ in code** (commit 9fb5e865): native renderer (atlas + stamp/eraser pipelines), persistent
  committed MTLTexture + live-stroke overlay, PNG snapshot, wired behind `useMetalPaintEngine` (ON,
  Metal-first routing). Non-smudge only. Awaiting device test after rebuild.
- **M4 ⬜ pending** (task #5): (a) Metal smudge shader (smudge currently → legacy fallback, which works);
  (b) **UPLOAD CAVEAT** — challenge upload / AI use `captureRef` of the canvas ViewShot; capturing an
  MTKView can yield a BLACK image. Fix = route those to the renderer-independent strokes-replay
  (`generateProjectPreview`) or the MetalPaintView `snapshot()`. VERIFY before relying on upload.

## Milestones (each = one device rebuild + on-device check)
- **M1 (this commit): scaffold + clean build.** New module with a minimal compiling `MTKView` view
  (clears to background). NOT wired into the UI yet. Gate: **app rebuilds & links with the new Metal
  module present** (de-risks the build before any UI change).
- **M2: display the painting.** Copy `EmojiAtlas` + stamp pipeline + shaders into the module; render
  committed normal/eraser stamps into the canvas texture; present via `MTKView`. Wire `MetalPaintCanvas`
  behind `useMetalPaintEngine`. Gate: painting shows in the native Metal view, matches legacy.
- **M3: live stroke + low latency.** Render the in-progress stroke incrementally (native), optionally
  native touch for minimal latency. Gate: smooth long strokes.
- **M4: smudge (Metal shader).** Tile-local smudge fragment shader reading the canvas texture — no
  readback/upload. Gate: smudge size 5–300 interactive.
- **M5: undo (tile revisions) + snapshot/export hooks + parity.** Then flip default after parity gate.

## Risks
- Native build fragility (Hermes `PhaseScriptExecution`) — M1 isolates the build risk first.
- Slow blind iteration — small milestones, explicit on-device gates.
- New-arch/Fabric view registration — mirror `emoji-ar` exactly (it works in this app).
- Reuse vs duplication — copy the 3 export Swift files into the module to keep it self-contained
  (avoids cross-pod linkage); accept duplication.

## Fallback
Legacy `EmojiCanvas` + the Skia tile engine remain. If native iteration stalls, the biggest concrete
win (smudge) is still achievable in Skia (tile-local seed) without native work.
