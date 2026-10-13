# Roadmap

This reflects what's actually in progress or planned in the source, not a wishlist.

## In progress

- **Native Metal live-canvas engine** (`modules/metal-paint/`) — an all-native (no Skia bridge)
  rendering path for the 2D canvas, aimed at reducing smudge/paint latency further. Currently
  scaffolded, not yet the default engine.
- **Vector Mode V3** (`VectorDocumentCore/`) — core document-model work is landing; the RN/Skia
  canvas UI (`src/vector/`) currently targets the V2 feature set.
- **Multi-room AR stitching** — RoomPlan capture currently handles a single room per session.
  Detecting when a user has walked into a *different* room and stitching multiple RoomPlan
  captures into one connected floor plan (door-to-door alignment) is designed but not implemented.

## Planned

- Android parity for AR/spatial painting (currently iOS-only — ARKit + RoomPlan are Apple
  frameworks; an Android path would need ARCore + a different room-scanning approach).
- Expanding automated test coverage in `src/__tests__/` and `VectorDocumentCore/Tests/` —
  see `testplan/` for the existing test strategy notes.
- CI-based build verification beyond lint/typecheck/unit tests (a full signed iOS build isn't
  realistically automatable without publishing signing secrets — see `docs/BUILDING.md`).

## Not planned

- Third-party asset redistribution (system emoji artwork, licensed fonts) — see
  `docs/OPEN_SOURCE_BOUNDARY.md` for why, and how the app sources those assets from the platform
  instead.

Have an idea? Open an issue — see `CONTRIBUTING.md`.
