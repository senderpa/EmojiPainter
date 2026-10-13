# Third-party notices

Dependency license metadata snapshot from `package-lock.json`, updated October 13, 2026.
Includes development tools and optional packages for all platforms; these counts are not a list
of binaries shipped in the apps. Local linked modules are excluded from this dependency inventory.
The packages' own license files remain authoritative.

## Lockfile summary

1188 package entries (different installed paths are counted separately).

| Recorded license | Entries |
|---|---:|
| MIT | 938 |
| ISC | 86 |
| Apache-2.0 | 40 |
| BSD-3-Clause | 27 |
| BSD-2-Clause | 23 |
| FSL-1.1-MIT | 18 |
| BlueOak-1.0.0 | 13 |
| MPL-2.0 | 12 |
| LGPL-3.0-or-later | 8 |
| Not recorded | 4 |
| Python-2.0 | 3 |
| (MIT OR CC0-1.0) | 3 |
| Apache-2.0 AND LGPL-3.0-or-later | 2 |
| Unlicense | 2 |
| 0BSD | 2 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| CC-BY-4.0 | 1 |
| Public Domain | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (BSD-3-Clause OR GPL-2.0) | 1 |
| (MIT AND Zlib) | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |

## Dependencies with additional license terms

- Sentry CLI packages record `FSL-1.1-MIT`. These are native build/upload tooling pulled in by
  `@sentry/react-native`, which is an app dependency; they are not all declared as dev dependencies.
- Optional `sharp` / libvips platform packages record LGPL terms. `sharp` is a development
  dependency used by the asset-generation scripts.
- Some packages record MPL-2.0 or alternative license expressions. Preserve the corresponding
  package notices when distributing dependencies; this source repository's Apache-2.0 license
  does not replace their licenses.

Entries without license metadata in the lockfile:

- `node_modules/base-64` (0.1.0)
- `node_modules/exit` (0.1.2)
- `node_modules/qrcode-terminal` (0.11.0)
- `node_modules/requireg` (0.2.2)

## Assets

Small project and community-art previews are included under `.github/images/` for the README. The
community submissions remain the artists' work, are not relicensed by this repository, and link to
their gallery posts; see `docs/OPEN_SOURCE_BOUNDARY.md` for attribution. The full app asset library,
including licensed fonts and in-app media, is not included. See `TRADEMARKS.md` for platform emoji
and trademark notes.

## Refreshing the inventory

Read each non-link `node_modules/` entry in `package-lock.json` and group its `license` field,
using “Not recorded” where absent. Inspect individual package license files for full terms.
This inventory is a metadata summary, not a complete redistribution notice bundle.
