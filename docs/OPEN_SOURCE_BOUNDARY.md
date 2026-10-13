# What's Open Source, and What Isn't

EmojiPainter's **source code** is open source. Its full **marketing/media asset library and
production infrastructure** are not included in this repository; a few small previews are included
under `.github/images/` so the README can show the app and gallery. Community gallery submissions in
those previews remain their creators' work and are not relicensed by this repository. This page is
the honest, specific answer to "what did you actually open source."

## Included (Apache-2.0, this repository)

**Core painting engines**
- `src/engine/`, `src/workspace/` — the 2D painting canvas (Skia-based, tile-cached GPU rendering)
- `modules/emoji-ar/` — native ARKit/RealityKit iOS module: wall painting in AR, RoomPlan room
  capture, the native SceneKit 3D room inspector, face-tracked front-camera painting
- `modules/metal-paint/` — experimental native Metal live-canvas engine
- `src/vector/`, `VectorDocumentCore/` — the infinite vector canvas (Swift Package + TS bridge)
- `src/animation/`, `src/animator/`, `src/framer/` — the frame-based paint animator
- `modules/screen-recorder/`, `src/capture/` — in-app guided screen recording

**App shell & platform code**
- `src/screens/`, `src/components/`, `src/state/`, `src/context/`, `src/theme/`, `src/hooks/`,
  `src/tutorial/`, `src/config/`, `src/types/`, `src/utils/`
- `ios/`, `android/` — native project source (no signing material, no Pods/build output)
- `modules/emojispray-bridge/`, `modules/emojipaint-exporter/` — supporting native bridges

**Community/backend features (client + reference server)**
- `src/gesser/`, `src/social/`, `src/multiplayer/` — daily challenges, gallery, social/profile,
  and the collaborative multiplayer canvas client
- `backend/`, `.website_work/`, `server-fix/` — the PHP reference backend these features talk to
- `multi/` — the standalone Node.js collaborative-canvas server

**Docs, tests, scripts, CI** — everything under `docs/`, `scripts/`, `src/__tests__/`,
`VectorDocumentCore/Tests/`, and this repo's `.github/` workflows.

## Not included, and why

| Excluded | Why |
|---|---|
| `assets/` (fonts, in-app art, 100+ marketing/UI videos) | Not source code; some assets have unclear or non-redistributable rights (system emoji artwork, licensed fonts); keeping the repo small and code-focused. Selected project-owned previews for the README live under `.github/images/`. See `THIRD_PARTY_NOTICES.md`. |
| Community gallery preview artwork and animation under `.github/images/` | Community submissions remain owned by their creators and are included only as attributed README previews. Each preview links to its gallery post. The Wasp-Nest City, Disco Wizard, and Adrift, pleasantly animations are credited to Kakaduuu; Molten Umbrella is credited to digitaldoodler39. The Apache-2.0 license does not grant rights to reuse these works elsewhere. |
| Production secrets (`DAILY_PAINT_SECRET`, backend tokens) | Real credentials for the live `emojipainter.com` backend — never belong in a public repo. Placeholders + setup instructions are included instead; see `SECURITY_AUDIT.md`. |
| Apple signing/provisioning material | Never existed in version control to begin with — nothing to strip. |
| `src.backup.*/`, `ios.backup.*/`, `coverage/`, `.xcodebuild-release-lite/`, build outputs | Accidental snapshots and generated artifacts in the working repo, not source. |
| `infos/` (informal private dev notes) | Not written for a public audience. |
| `DevPortal/` | A private, single-owner internal admin tool (its own auth + local secrets) for tracking this project's own tasks/releases — not part of the EmojiPainter app, and explicitly documented as private-only in its own README. |

## What works out of the box vs. what needs your own backend

The **painting engines are fully standalone** — 2D canvas, AR wall/room painting, vector mode, and
the animator all work with zero backend, because painting itself never left the device.

**Daily challenges, the public gallery, social/profile, and multiplayer** talk to a backend
(`backend/`, `.website_work/`, `multi/`) that you'd need to deploy yourself and point the app at —
this repo includes that backend's source, but not a hosted instance or its credentials. Without a
configured backend, those specific screens degrade gracefully (see `SECURITY_AUDIT.md`) rather than
crashing or silently hitting the maintainer's production server.

## License

All code in this repository is original work by the project, licensed under **Apache-2.0** (see
`LICENSE`), except where a file explicitly says otherwise. Third-party dependency licenses are
catalogued in `THIRD_PARTY_NOTICES.md`.
