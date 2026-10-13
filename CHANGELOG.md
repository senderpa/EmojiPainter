# Changelog

All notable changes to the **public** EmojiPainter repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This public changelog starts fresh at the open-source release — it does not carry over the
~1.5 years of internal build-by-build history from the closed-source development process (that
history isn't meaningful to public users and included things like internal diagnostics and
work-in-progress fixes not relevant outside the original team).

## Unreleased

### Fixed
- Public-source TypeScript and media bundling; excluded production media uses documented fallbacks.
- Build/reuse instructions and diagrams now describe the raster, Metal, and standalone Swift paths.
- Public release builds require an explicit Sentry DSN before enabling crash diagnostics.

### Maintenance
- Removed unused test dependencies and added regression checks for diagnostics configuration.
- Included the renderer example in TypeScript checks and refreshed dependency license metadata.
- Clarified production URL defaults and the limitations of client-side shared signing values.
- CI reports coverage without an unreachable global threshold; overall coverage remains low.

## [1.0.0] — 2026-10-13

### Added
- First public open-source release of EmojiPainter's source code.
- 2D painting engine, AR/spatial painting (including native RoomPlan 3D room inspector), vector
  mode, frame animator, and the reference community backend — see `docs/OPEN_SOURCE_BOUNDARY.md`
  for the full breakdown.
- README previews for the animated brand and community gallery, with direct web and App Store links.
- Public build and release instructions for contributors.
