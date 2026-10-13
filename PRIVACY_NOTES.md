# Privacy notes for this source tree

These notes describe implementation boundaries, not the privacy policy for the released apps or
live service. A fork needs a privacy policy appropriate to its own configuration and deployment.

## Local processing

ARKit face tracking and RoomPlan capture are processed by the native iOS modules. Painting,
vector-document persistence, and animation rendering operate locally. This does not make the
whole app offline: community screens and background refreshes can make network requests.

## Networked features

- Gallery and challenge clients load posts, topics, and media. Some requests can happen while a
  screen loads or its cache refreshes, without a separate upload action.
- Gallery uploads and profile/social actions send their relevant content and identity data.
  Exporting or sharing can pass selected content to another app or destination.
- Several URLs are hardcoded to `emojipainter.com`. A fork must review and replace them; see
  [`docs/BUILDING.md`](docs/BUILDING.md). An empty upload secret does not disable network access.
- Crash reporting is disabled unless `EXPO_PUBLIC_SENTRY_DSN` is configured for a release build.
  The reporting wrapper disables screenshots, view hierarchies, and default PII collection, but
  custom error context and device identity can still be included when reporting is enabled.
  Development and Lite builds disable this reporting path.

## Identity

Community features use a locally persisted device identifier and profile information. A device
identifier is not proof of authorization. Operators are responsible for server-side access
controls, retention, deletion handling, and the disclosures required by their deployment.

This document is not a complete privacy or security audit.
