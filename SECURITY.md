# Security Policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](https://github.com/senderpa/EmojiPainter/security/advisories/new).

Include: what you found, where (file/endpoint), reproduction steps, and impact. We'll acknowledge
within a reasonable timeframe and credit you in the fix (unless you prefer otherwise).

## Scope

This repository's own code — the mobile app, native modules, and the reference backend source in
`backend/`, `.website_work/`, and `multi/`. The live production service at emojipainter.com runs
its own deployment with its own credentials, separate from what's in this repo; if you find an
issue against the *live site* specifically, report it the same way.

## Public build and reference backend

- `backend/config/db.php.example` contains placeholders. Keep your configured database credentials
  out of version control.
- `EXPO_PUBLIC_DAILY_PAINT_SECRET` is embedded in the app bundle; the gallery's equivalent is
  visible in browser source. This legacy shared value is **not a confidential credential** and
  cannot authenticate a trusted client by itself. Server-issued authorization and abuse controls
  are needed before operating your own public backend.
- The upload secret defaults to empty, but several client URLs still point at the production
  service. Review and replace them before testing a fork's community features. See
  [`docs/BUILDING.md`](docs/BUILDING.md).
- Diagnostics require an explicitly configured `EXPO_PUBLIC_SENTRY_DSN` in release builds.

## Dependency maintenance

Run `npm audit` for the current dependency report. Outstanding advisories remain in the Expo /
React Native toolchain and related packages. Passing CI does not mean the dependency tree has no
advisories. Framework upgrades need compatibility checks; avoid applying `npm audit fix --force`
without reviewing the resulting version changes.
