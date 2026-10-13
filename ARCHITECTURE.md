# Architecture

## App shell

EmojiPainter is a React Native / Expo app (`src/`). Screens and workspace UI live in
`src/screens/` and `src/workspace/`; shared app state in `src/state/` and `src/context/`.

## Painting engines

- **2D canvas** (`src/engine/`) — a Skia-backed canvas with tile-based GPU caching so dense
  emoji-stamp strokes stay real-time instead of re-rasterizing the whole canvas per frame.
- **AR / spatial painting** (`modules/emoji-ar/`, native Swift) — an Expo native module wrapping
  ARKit `ARView`/`ARSCNView` sessions:
  - `WallPaintView.swift` — world-tracking AR session; raycasts touches onto detected planes/mesh
    and stamps emoji decals in world space.
  - `RoomPlanManager.swift` — an optional background `RoomCaptureSession` attached to the *same*
    ARSession (never competes for the camera), publishing throttled room-readiness data.
  - `RoomPreviewView.swift` — a plain (non-AR) SceneKit view: walls render as single-sided white
    planes oriented to face the room's interior (so orbiting from outside shows straight through
    into a lit interior — a "dollhouse" view), with a shadow-casting light so painted strokes
    throw real shadows. The same scene-construction code renders headless for the saved-room
    snapshot thumbnail, so the thumbnail and the live inspector never drift apart.
  - `FaceFilterView.swift` — ARKit face tracking; blendshapes drive a rigged head / face-mesh
    paint canvas, entirely on-device.
- **Vector mode** (`src/vector/` + `VectorDocumentCore/`) — the document model (`Schema.swift`,
  `TimelineEvaluator.swift`, `CameraMath.swift`) is a standalone Swift Package so it's testable in
  isolation from the app; `src/vector/` is the RN/Skia canvas + UI on top of it.
- **Animator** (`src/animation/`, `src/animator/`, `src/framer/`) — frame timing sits alongside
  strokes; native AR playback uses a `CADisplayLink`-driven clock (not a JS timer) so animation
  timing doesn't stall when JS is busy.

## Native module pattern

Every native capability is an Expo Module (`ExpoModulesCore`): a Swift `View` subclass exposing
`Prop`/`AsyncFunction`/`Events` in an `EmojiArModule.swift`-style definition file, with a matching
TypeScript surface in `modules/<name>/index.ts` that degrades gracefully (returns `null`/no-ops)
when the native module isn't present — e.g. on a simulator without ARKit, or on Android.

## Community / backend

`src/gesser/` (daily challenges, gallery) and `src/social/` (profile, followers, timeline) are RN
clients for the reference PHP backend in `backend/` and `.website_work/`. `src/multiplayer/` is the
client for the standalone Node.js collaborative-canvas server in `multi/`. None of these are
required for the painting engines to work — see `docs/OPEN_SOURCE_BOUNDARY.md`.

## Testing

- `src/__tests__/` — Jest unit tests for JS/TS logic
- `VectorDocumentCore/Tests/` — Swift Testing/XCTest for the vector document core
