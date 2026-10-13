# Third-Party Notices

Dependency license summary, generated with `npx license-checker --summary` against this project's
`package.json` (764 resolved packages across dependencies + devDependencies).

## Summary

| License | Count |
|---|---|
| MIT | 936 |
| ISC | 58 |
| BSD-3-Clause | 28 |
| Apache-2.0 | 25 |
| BSD-2-Clause | 22 |
| BlueOak-1.0.0 | 11 |
| (MIT OR CC0-1.0) | 4 |
| FSL-1.1-MIT | 2 |
| Unlicense | 2 |
| MPL-2.0 | 2 |
| LGPL-3.0-or-later | 1 |
| Python-2.0 | 1 |
| CC-BY-4.0 | 1 |
| 0BSD | 1 |
| Public Domain | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (BSD-3-Clause OR GPL-2.0) | 1 |
| (MIT AND Zlib) | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |

(Counts add up to slightly more than 764 due to license-checker's per-package breakdown; two rows
in the raw output — "UNLICENSED" for `emojipaint-mobile` itself and "UNKNOWN" for the local
`screen-recorder` module — are this project's *own* local packages with no `license` field set
locally, not third-party dependencies. Both are covered by this repo's own Apache-2.0 license.)

## Apache-2.0 compatibility

Everything above is a standard permissive license (MIT/ISC/BSD/Apache/BlueOak/Unlicense/0BSD/
Public Domain/CC0/CC-BY) **except** the four flagged below — none of them block Apache-2.0 use:

- **`@sentry/cli` / `@sentry/cli-darwin`** (FSL-1.1-MIT — Sentry's "Functional Source License,"
  not OSI-approved but source-available) — a **build-time-only** devDependency used to upload
  source maps on release builds (already gated off by `SENTRY_DISABLE_AUTO_UPLOAD=true` in
  `scripts/build-ios.sh`). Not distributed with the app.
- **`@img/sharp-libvips-darwin-arm64`** (LGPL-3.0-or-later) — a native binary for `sharp`, used only
  by the icon/logo-generation build scripts (`npm run gen:icons`). Not distributed with the app.
- **`jszip`** (dual MIT/GPL-3.0) — used under the MIT option.
- **`node-forge`** (dual BSD-3-Clause/GPL-2.0) — used under the BSD-3-Clause option.

No GPL/AGPL code is bundled into the shipped app or the reference backend.

## Assets

Small project and community-art previews are included under `.github/images/` for the README. The
community submissions remain the artists' work, are not relicensed by this repository, and link to
their gallery posts; see `docs/OPEN_SOURCE_BOUNDARY.md` for attribution. The full app asset library,
including licensed fonts and in-app media, is not included. See `TRADEMARKS.md` for platform emoji
and trademark notes.

## Regenerating this report

```bash
npx license-checker --summary   # this table
npx license-checker --json      # full per-package detail
```
