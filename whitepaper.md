# EmojiPaint — Product and Technical Whitepaper

**Version 8.4.0 (Build 822) — June 2026**
Bundle ID: `com.emojipaint.mobile` · Platform: iOS (iPhone + iPad) · New Architecture + Hermes

---

## 1. Executive Summary

EmojiPaint is a creative iOS application that sits at the intersection of augmented reality, real-time GPU painting, social identity, and the visual language of emoji. Users paint with emoji brushes on a 60-fps hardware-accelerated canvas, carry their artwork into the physical world through ARKit plane detection, and publish to a ranked global gallery — all without a login, email address, or account to manage.

The product occupies a unique position: it is the tactility and depth of a native painting app fused with the accessibility of emoji and the immediacy of social competition. A daily challenge system drives return visits. A social passport gives every device a persistent, painted identity. An AR spray-can scene lets users leave emoji murals on real walls. A face-filter scene composites emoji textures directly onto a tracked 3D face mesh.

EmojiPaint is production-tested on iPad (iOS 26.2.1), built on a React Native / Expo foundation with multiple native Swift modules for platform-specific capabilities, and is actively maintained on the `gpu-paint-engine` branch. This document describes the product, the engineering behind it, and the path to the next major milestones.

---

## 2. Product Vision

### The Future of Digital Self-Expression

Emoji have become the dominant visual communication medium of the last decade. They are universal, culturally legible, and expressive in ways that text alone cannot match. EmojiPaint treats each emoji not as a character but as a paint material: a texture, a stamp, a brushstroke that carries color, weight, and personality.

The result is a creative act that is both immediately familiar (you know what a painting is; you know what emoji are) and genuinely novel. A completed EmojiPaint canvas looks unlike anything produced by any other tool. It is identifiably emoji, identifiably art, and identifiably fast.

### From Canvas to World

Digital art has historically been confined to screens. EmojiPaint breaks that boundary in two directions simultaneously:

- **AR Painting** places a virtual spray can in the physical environment, detected via ARKit plane analysis, and lets users stamp emoji strokes onto vertical and horizontal real-world surfaces. The result is persistent within the session, shadows the environment’s lighting, and can be photographed and shared.
- **Face Filter** composites an emoji-painted texture directly onto the user’s tracked face using ARFaceTracking and a live ARSCNFaceGeometry mesh. The face becomes the canvas.

These features are not gimmicks layered over a simpler app. They share the same emoji vocabulary, the same brush settings, and the same export pipeline as the 2D painting mode.

### Social Passport: Painted Identity

Every user has a passport — a thumbnail of their best recent painting that serves as their avatar across the global gallery and leaderboard. There are no profile photos, no uploaded headshots. Your identity in EmojiPaint is what you painted. The passport is updated automatically on gallery upload. The social profile is a living record of creative output: a bio, a follower graph, a diary, and a timeline of every painting submitted to the community.

Identity is established via device ID. No email, no password, no sign-up friction.

---

## 3. Core Technology

### 3.1 Paint Engine

EmojiPaint’s canvas has evolved through three architectural generations. Each layer is still present in the codebase and selectable via feature flags, providing safe incremental rollout.

#### Tier 1: Skia GPU Layer (Legacy + Tile Engine)

The original and most widely tested rendering layer uses React Native Skia (v2.2.12) with a hardware-accelerated 2D canvas. Strokes are appended incrementally to an offscreen `SkSurface`; the committed painting is composited with the live in-progress stroke at 60fps.

The core challenge discovered during smudge brush implementation was a fundamental thread-context mismatch in React Native Skia: a GPU snapshot created on the JS thread cannot be consumed as a texture on the UI-thread Metal context — it renders black, forcing a full CPU readback via `makeNonTextureImage()`. The solution, now implemented, is `usePictureAsTexture`: committed strokes are recorded into an `SkPicture` and replayed on the UI thread as a `drawAsImageFromPicture` worklet, producing a native GPU texture with zero readback.

The Skia tile engine adds a seamless single-surface approach for undo: each stroke produces a tile revision, enabling O(1) undo without re-rendering all prior strokes. Tile revisions are stored as base64-encoded PNG patches on the stroke object, so the full painting state survives serialisation, AsyncStorage, and remote backup without any re-bake on reload.

#### Tier 2: Native Metal Engine (Current Default)

The current production default on the `gpu-paint-engine` branch routes normal painting strokes through a fully native Metal pipeline implemented in `modules/metal-paint/`. This engine was purpose-built to eliminate the JS/UI thread-crossing cost that made the Skia smudge brush lag perceptibly on iPad.

Key components:

- **MetalPaintAtlas** (`MetalPaintAtlas.swift`): an LRU MTLTexture atlas that rasterizes emoji (Unicode + custom PNG) on demand. Atlas lookup is O(1) for repeat emoji during a session.
- **MetalPaintRenderer** (`MetalPaintView.swift`): manages three persistent MTLTextures — `committed`, `working`, and `scratch`. Committed is the durable painting; working is the live smudge accumulator; scratch is the ping-pong target. All textures are explicitly cleared on creation to avoid the uninitialised-texture pink artifact.
- **Stamp pipeline** (`mp_vertex_main` / `mp_fragment_stamp`): a stamping vertex/fragment shader pair. Each emoji dab is a positioned quad; stamps are interpolated along each stroke segment at a spacing derived from brush size, ensuring gap-free coverage on fast strokes at any speed.
- **Eraser pipeline**: a `oneMinusSrcAlpha` blend mode pipeline variant, toggled per stroke type.
- **Incremental committed rendering**: the renderer diffs incoming stroke IDs against the already-rendered set. New strokes are stamped into the committed texture without re-rendering prior work. Divergence (undo, first build, size change) triggers a full sequential rebuild.
- **MTKView display**: the ExpoView subclass presents the committed texture plus a live-stroke overlay per touch move, on-demand rendered, at device resolution.

The JS layer (`src/engine/MetalPaintCanvas.tsx`) serialises strokes to JSON and sends them to the native view via the `strokesJson` prop. The `snapshot()` AsyncFunction returns a PNG of the current committed state for upload and export.

A known build caveat: Xcode aggressively caches `libmetal-paint.a` between builds. Any native Swift change requires manual deletion of the intermediate build products under `DerivedData/EmojiPainter*/Build/Intermediates.noindex/Pods.build/.../metal-paint.build/` before running `npx expo run:ios`.

#### Tier 3: Smudge Engine

Smudge is a third brush mode (toggled via the opacity button: opaque to transparent to smudge) implemented as a directional color-carry algorithm, not a blur. The core SKSL shader in `gpuSmudge.ts` samples color from behind the cursor along the current stroke direction and pushes it forward, simulating the oil-paint effect of dragging wet pigment across a canvas.

Architecture highlights:

- **Live drag**: processed on a small adaptive-resolution work surface (1.0x for brushes under 130px, 0.5x up to 280px, 0.34x above). This bounds the per-frame GPU cost regardless of brush size.
- **Per-frame dirty rect readback**: `makeImageSnapshot(dirtyRect)` instead of a full-canvas snapshot per frame. This was the fix for dropped frames and cascading touch-sample sparseness.
- **Commit bake**: on finger lift, the smudge region is composited into the committed texture as an incremental blit (not a full surface re-render, which would double-composite via SrcOver and produce perceptible darkening).
- **Tile persistence**: each smudge bake produces a tile (base64 PNG + DIP bounds) stored directly on the stroke. Replay, undo, timelapse, and export all blit the tile rather than re-executing the GPU shader, eliminating the OOM crash that occurred when timelapse mounted and re-baked all smudge strokes.
- **Smoothness slider**: `edgeBlendStrength` (0 = rough smear, 1 = creamy) controls the carry “reach” within the directional shader. This is the single user-facing control for smudge character.

### 3.2 AR Painting (ARKit + SceneKit)

The AR painting scene (`modules/emoji-ar/ios/WallPaintView.swift`, bridged via `modules/emojispray-bridge/`) gives users a virtual spray can they can aim at real-world surfaces.

Technical implementation:

- **Plane detection**: ARKit’s horizontal and vertical plane detection runs continuously. When the user taps, a raycast finds the nearest plane intersection and the spray can hovers above that point.
- **Physics hover**: the spray can does not snap rigidly to the detected plane. It settles toward it with a lerp, producing a natural floating feel and reducing jitter from imprecise tracking.
- **Shadow casting**: a directional light source is driven toward the spray can’s world position each frame. As the user moves the can along a wall, the drop shadow tracks realistically beneath it.
- **Stamp-based stroke system**: each emoji stamp is placed as a 3D-positioned billboard quad in SceneKit. Face culling is applied so stamps only render from the side facing the user, avoiding z-fighting and visual artifacts when the user walks around a painted surface.
- **Brush mini-panel**: a contextual panel provides mirror, rotate, and alpha controls alongside a last-5-emoji quick picker, accessible without leaving the AR view.
- **Tracking stability**: velocity damping is applied to ARCamera transform updates to smooth out jitter in the spray-can positioning chain.

### 3.3 AR Face Filter (ARFaceTracking)

The face scene (`src/ar/FaceMeshOverlay.tsx` + `modules/emoji-ar/ios/FaceFilterView.swift`) composites emoji paint onto a live face mesh.

Four mask modes are available as a tile picker:

- **None**: face shown without any overlay; provides a “make new head” entry point for 3D generation.
- **Grey paint**: a 2D emoji paint canvas auto-entered on tap, whose strokes are exported as a PNG baked to the face geometry. Strokes persist to `Documents/facepaint/grey-mask.png` and are resolved via relative path to survive app reinstalls.
- **Camera texture**: the ARKit camera feed is projected onto the face mesh via `ARSCNFaceGeometry(fillMesh:true)`. From this view, the user can trigger a Stable Diffusion restyle: the camera texture is exported and sent to a self-hosted A1111 img2img endpoint, and the result is composited back as a stop-motion animation loop with playback controls.
- **3D model**: a textured 3D head generated from a selfie photo, downloaded from the Gesser API, rendered double-sided on the ARFaceAnchor transform.

The face mesh overlay uses ARKit blend shape tracking. Per-vertex emoji compositing maps the painted texture onto the live mesh geometry. Velocity damping is applied to mesh update deltas to reduce temporal jitter visible on high-frequency expressions.

Pending generation jobs are tracked in `src/ar/pendingJobs.ts`. While the face scene is open, a polling loop re-checks each job every seven seconds. On completion, the model downloads automatically and appears as a new tile without any user action.

### 3.4 Animation and Video Export

EmojiPaint includes a full frame-by-frame animation workspace (`src/framer/`):

- **Framer Workspace**: up to N frames, each a full stroke-list painting. Onion-skin overlay (half-transparent previous and next frame) is shown when playback is paused and hidden during play. Stroke length is clamped to 1 unit when paused or at zero FPS, reverting to the user-set brush length during playback.
- **Timelapse**: every painting session records a stroke-by-stroke replay. `TimelapseScreen.tsx` replays strokes in order, rendering each frame off-screen via the Skia raster engine and presenting them as a scrubable video with frame-step arrows that auto-pause on tap.
- **Native export** (`modules/emojipaint-exporter/`): a Swift module renders strokes to MP4, GIF, or WebM using the same atlas (`EmojiAtlas.swift`) and stamp pipeline (`StrokeReplayEngine.swift`) as the live canvas. Stamp interpolation is applied at the same spacing formula as the live engine to ensure export frames match the on-screen result. Smudge strokes are exported by blitting their baked tile PNG decoded by `EmojiAtlas.getSmudgeTexture`.
- **Showcase Capture** (`src/capture/`): a JS-only in-app screen recording feature available in Settings that captures real app footage per-task for promotional and review purposes.

### 3.5 Social Infrastructure

The backend is a PHP/MySQL application deployed at `emojipainter.com`. Identity is established entirely by device ID — no user registration, no stored credentials, no server-side session tokens.

Core services:

- **Gallery**: paintings are uploaded as PNG via multipart POST. Gallery entries are stored in MySQL with device ID, topic, timestamp, and passport metadata. The public gallery page serves as both a leaderboard ranking and a browsable feed.
- **Leaderboard**: ranked by upload count and recency. The leaderboard feed is served as a JSON endpoint consumed by both the app and the public `gallery.html` page.
- **Social graph** (`gesser_friends`): a follow relationship table keyed on `(user_device_id, friend_device_id, created_at)`. The World discovery query uses correlated subqueries rather than INNER JOINs so that users with zero mutual connections are never dropped from discovery results.
- **Profile layer** (`gesser_profiles`): display name, bio, and portrait URL stored as per-user overrides. All discovery and profile queries `COALESCE` these over the baseline `gallery_entries` values, so manual edits persist while the gallery history remains the canonical identity record.
- **Timeline and diary** (`gesser_timeline`): diary entries and profile changes are stored per-device. Timeline privacy is enforced at the query level: a stranger’s request returns an empty events array; private events are only returned when the viewer and the target are the same device.
- **Mystery topics (Gesser)**: a curated pool of 999 topics bundled in the app plus 1,339 server-approved topics in `gesser_topics`. The API picks non-repeated topics per user via AsyncStorage deduplication, with a fallback to the bundled pool if the server is unreachable.

---

## 4. Architecture Highlights

### React Native + Expo Foundation

EmojiPaint is built on React Native with Expo’s managed-to-bare continuum. The New Architecture (JSI, Fabric, TurboModules) is enabled. The JS engine is Hermes. This combination gives:

- **Fast startup**: Hermes pre-compiles the JS bundle to bytecode at build time.
- **JSI native calls**: TurboModules allow synchronous native calls without the asynchronous bridge overhead, critical for the Metal paint engine’s stroke dispatch.
- **Expo autolinking**: native modules in `./modules/` are discovered automatically via `autolinking.searchPaths`, requiring no manual CocoaPods wiring for new modules.
- **Build variants**: `EXPO_PUBLIC_LITE_BUILD=1` at bundle time produces a lite App Store build that excludes the AI Workshop, Coin Shop, and Face scene — providing a clean binary for reviewer evaluation without removing features from full builds.

### Native Modules (Swift)

Five native modules extend the JS layer with platform-critical capabilities:

| Module | Purpose |
|---|---|
| `modules/emoji-ar` | ARKit + SceneKit AR painting and face filter views |
| `modules/emojipaint-exporter` | Native Metal video/GIF export (atlas + stamp replay) |
| `modules/metal-paint` | Native MTKView live canvas (Metal paint engine) |
| `modules/emojispray-bridge` | AR spray can event bridge |
| `modules/screen-recorder` | In-app screen recording for showcase capture |

All modules follow the ExpoModulesCore `View / ExpoView` pattern, ensuring compatibility with Expo’s autolinking and future SDK upgrades.

### Feature Architecture (In Progress)

`src/features/` currently hosts six feature modules: `challenge`, `gallery`, `info-panel`, `leaderboard`, `onboarding`, `private-studio`. Each follows a hook-plus-overlay pattern: a custom hook owns the business logic and state; an overlay component owns the UI. This is the target architecture for the full codebase.

The primary screen, `src/screens/PaintScreen.tsx`, remains intentionally large as the canonical source of state for features that are still deeply intertwined. Feature extraction proceeds incrementally as boundaries stabilise. No feature is removed from PaintScreen until its extracted module is proven equivalent on a real device.

### Offline-First Data Model

All painting data is stored locally first. Strokes are serialised to JSON with stable IDs. Autosave writes to AsyncStorage on a throttled idle timer; explicit save writes to `expo-sqlite`. On upload, the gallery entry is created server-side from the serialised stroke data and the PNG snapshot — the local data is never deleted. Sync is strictly additive. A backup of any named project restores the full local state without touching the server.

Face mask images are stored with relative paths (`relPath`) and re-resolved against the iOS document directory at load time, surviving the UUID rotation that occurs on each app reinstall.

---

## 5. User Journey

**First launch**: a startup overlay presents a randomly selected emoji as the initial brush. One tap begins a fresh canvas.

**Paint**: the user selects emoji from the full picker (or a quick-access recent row), adjusts brush size and opacity, and draws. Three opacity modes are available: opaque, transparent, and smudge. The canvas is gesture-interactive: pinch to zoom, two-finger drag to pan, with coordinate-system-aware hit-testing at all zoom levels.

**Challenge**: three daily topics are generated deterministically from the current date, each with an emoji, a topic name, and a target time in minutes. The user selects a topic, confirms against a gallery preview, and a countdown timer begins. A fourth mystery topic — drawn from the Gesser server or the bundled 999-topic pool — is available without a daily limit.

**Passport identity**: every upload updates the user’s passport thumbnail. The passport is visible in the gallery grid, on the leaderboard, and on the user’s profile page. It cannot be manually edited — it reflects the most recent creative work.

**Gallery and leaderboard**: completed paintings are uploaded to the global gallery. The leaderboard ranks by upload volume and recency. Tapping any entry navigates to that user’s profile page.

**Social world**: the World view shows all users who have submitted to the gallery. Users can follow each other, view each other’s full painting history, leave diary entries, and read a timeline of creative activity. The follow graph is directional-optional (one-directional follows permitted, no mutual requirement).

**AR modes**: from the main screen, users can launch the AR Painting scene (spray can on physical walls) or the Face Filter scene (emoji-painted face mesh). Both scenes share the main emoji picker and brush settings.

---

## 6. Competitive Positioning

### vs. Procreate

Procreate is the gold standard for iPad painting. EmojiPaint does not compete on brush fidelity or layer management. It competes on accessibility (emoji require no artistic vocabulary), speed (timed challenges make completion the goal, not perfection), social feedback loop (every painting is immediately ranked), and AR output (Procreate canvases are not designed to exist in physical space).

EmojiPaint’s social-first and challenge-first model targets the user who would never open Procreate because it feels too serious, while still satisfying the creative impulse that would motivate that purchase.

### vs. Snapchat Filters

Snapchat’s face filters are ephemeral and passive — you apply them to a photo or video, then they disappear. EmojiPaint’s face filter is painted by the user, producing a unique composition. The result is not a preset but an artwork. Additionally, EmojiPaint’s AR painting mode produces persistent wall-scale murals, not ephemeral story overlays.

### vs. Instagram Stories and Canvas Apps

Instagram’s creative tools are optimised for text overlays and simple stickers on photos. The content lifecycle is short: stories expire and posts are quickly buried in feeds. EmojiPaint offers a permanent gallery, a ranked leaderboard, canvas-quality output, and an identity that grows with each submission. The social graph is built entirely around creative output rather than social network imports.

---

## 7. Roadmap

### In Progress

**GPU / Metal Paint Engine GA** (`gpu-paint-engine` branch): the native Metal engine handles normal strokes and smudge. Outstanding work includes the native Metal smudge shader (so the engine handles smudge entirely without routing to legacy Skia), the `captureRef` to `snapshot()` redirect for challenge upload while Metal is active, and parity testing across all canvas modes (frames, timelapse, AR).

**Feature Modularisation**: six feature modules are actively extracting from PaintScreen into `src/features/`. Target: all bounded features isolated; PaintScreen retains only canvas-core state and orchestration.

### Near-Term

**Multiplayer Canvas Foundation**: `multi/` in the repository contains initial multiplayer scaffolding. The architecture — strokes as serialisable, timestamped, device-attributed commands — is inherently suitable for operational transform or CRDT-based merging. Real-time shared canvases are the next social primitive above the current async gallery.

**Android Port**: the Expo architecture abstracts most iOS-specific code behind feature flags and native module conditionals. The 2D canvas (Skia), the social layer, and the challenge system are fully portable. The AR modules (ARKit, ARFaceTracking) and the Metal engine are iOS-only; an Android port would substitute ARCore for plane detection and Vulkan or OpenGL ES for the GPU paint path.

**Web Gallery**: the public gallery at `emojipainter.com` is already live. Upcoming improvements include full-resolution painting viewer, social graph browsing, and gallery embeds for social sharing without requiring the app.

**Metal Smudge (M4)**: port the directional-carry SKSL shader to a native Metal compute shader operating on the committed MTLTexture, eliminating the remaining JS/Skia dependency in the smudge path.

### Longer-Term

**3D Head Pipeline GA**: the Emoji Me feature (selfie to rigged 3D head via Tripo API to face-tracked AR rendering) is present in full builds. Pending improvements focus on backend 3D generation reliability and ARKit head-tracking stability across device form factors.

**Creator Monetisation Layer**: the Coin Shop infrastructure is present in full builds. A creator economy layer — where popular painters earn coins for leaderboard rank, redeemable for brushes, custom emoji packs, or highlighted gallery placement — is architecturally ready for activation.

---

## 8. Technical Risks and Mitigations

### ARKit Availability

ARKit requires Apple Silicon devices with LiDAR (for plane detection quality) or at minimum A12 for face tracking. Older hardware lacks the processing headroom for 60-fps face mesh updates.

**Mitigation**: the AR scenes are gated behind an `ArModeChooser` component. The lite build variant marks Face as “Coming soon” rather than attempting to launch it. The 2D canvas mode functions identically on all ARKit-capable devices.

### App Binary Size

ARKit models, emoji atlas data, and embedded Metal shaders add to the binary. A payload too large for cellular download is a conversion barrier in the App Store.

**Mitigation**: the lite build excludes the AI Workshop, Coin Shop, and Face scene. AR assets are loaded lazily on first scene entry. The emoji atlas is generated at runtime from Unicode codepoints, not stored as pre-rendered sprites. Custom PNG brushes are user-uploaded and stored in the document directory, not bundled.

### State Complexity and Monolith Risk

`PaintScreen.tsx` at approximately 24,000 lines represents significant cognitive surface area. A bug introduced in one section can interact unexpectedly with state owned by a distant section.

**Mitigation**: active feature modularisation is reducing coupling incrementally. PaintingContext owns all stroke state, enforcing immutable updates via a Redux-like action pattern. Autosave and the undo stack operate entirely through the context interface, not via direct state mutation. Each new feature is required to land in `src/features/` with its own hook before being integrated into PaintScreen.

### Native Build Cache (Metal Module)

The `libmetal-paint.a` caching behavior in Xcode means that Swift edits to the Metal paint module may silently not reach the device binary, producing confusing debugging loops where code changes appear to have no effect.

**Mitigation**: the build script at `scripts/build-ios.sh` documents the required cache-bust step (DerivedData deletion targeting the metal-paint intermediate build directory). This is a known Xcode behavior specific to static library CocoaPod modules and is not unique to EmojiPaint.

### Backend Availability

The gallery, leaderboard, and social graph depend on the PHP/MySQL backend at `emojipainter.com`. A hosting outage would disrupt uploads and social features.

**Mitigation**: all painting is local-first. Users can paint, save, and view local history without a network connection. Upload attempts queue and retry. The app never deletes local data on upload failure. A backend redeployment would restore all gallery data from the MySQL backup; local paintings on devices re-sync on the next upload attempt.

---

## 9. Team and Stack Summary

| Layer | Technology |
|---|---|
| Application framework | React Native 0.76 + Expo SDK (New Architecture, Hermes) |
| 2D canvas | React Native Skia 2.2.12 |
| GPU paint engine | Native Metal (Swift, MTKView, custom stamp + smudge shaders) |
| AR painting | ARKit + SceneKit (Swift, ExpoModulesCore native view) |
| AR face filter | ARFaceTracking + ARSCNFaceGeometry (Swift) |
| Video export | Native Metal + AVFoundation (Swift, MP4 / GIF / WebM) |
| State management | React Context + useReducer (immutable action pattern) |
| Local storage | AsyncStorage + expo-sqlite |
| Backend | PHP 8 / MySQL |
| CI / Testing | Jest (86 passing unit tests), EAS Build |
| Crash reporting | Sentry |
| Platform | iOS 16+, iPhone + iPad, portrait orientation |

---

*EmojiPaint is a living product. This whitepaper reflects the state of the codebase and roadmap as of version 8.4.0 (build 822), June 2026. Technical claims describe implemented and device-verified behavior unless explicitly marked as in-progress or planned.*
