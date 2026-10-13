# Building EmojiPainter

## Requirements

- Node.js 20.19.4 or newer (required by Expo SDK 54)
- macOS + Xcode 16.1 or newer for iOS — this project targets iOS 15.1+
- CocoaPods (installed automatically via `npx expo run:ios` / `pod install`)
- Android Studio + JDK for Android
- An Apple Developer account (free tier is enough) to run on a physical iOS device — AR/RoomPlan
  features require a real device; the simulator has no camera/LiDAR

## Install

```bash
git clone https://github.com/senderpa/EmojiPainter.git
cd EmojiPainter
npm ci
```

`postinstall` runs `patch-package` automatically (see `patches/`).

## Run — iOS

```bash
npx expo run:ios                        # simulator (AR/RoomPlan features won't work here)
npx expo run:ios --device                # physical device — required for AR/RoomPlan/camera
```

The AR module (`modules/emoji-ar/`) is a local CocoaPods pod (`ios/Podfile` references
`../modules/emoji-ar/ios` by path) picked up automatically by `pod install`/`expo run:ios`. If you
add or rename a native Swift file under `modules/*/ios/`, re-run `pod install` in `ios/` — the
podspec uses a glob (`**/*.swift`) that CocoaPods only re-scans on install.

RoomPlan and full LiDAR wall-mesh painting require a LiDAR-equipped device (iPhone 12 Pro+ or iPad
Pro 2020+); everything else (2D canvas, vector mode, animator, AR plane painting without RoomPlan)
runs on any ARKit-capable device.

## Media assets in the public source export

Some production artwork, fonts, and tutorial media are excluded because their redistribution rights
are unclear. The Metro resolver uses the project-owned icon, a short logo animation, silent audio,
and the system font when those files are absent, so a clean clone can still bundle. If you have the
rights to the original media, place it at its existing path under `assets/`; present files take
precedence over the fallback. These previews keep the source buildable but do not reproduce the
finished apps' full media library.

## Run — Android

```bash
npx expo run:android
```

The AR/RoomPlan module is iOS-only (ARKit + RoomPlan are Apple frameworks); the 2D painting
engine, vector mode, and animator are cross-platform.

## Community features (optional)

Daily challenges, the gallery, and social features use reference PHP code in `backend/`,
`.website_work/`, and `server-fix/`. These folders contain deployment-specific scripts and schema
migrations, not a single automatic installer. Review them against your own PHP/MySQL deployment.

1. Copy `backend/config/db.php.example` to `backend/config/db.php` and provide your own database
   credentials. Never commit the configured file.
2. Review the SQL migrations for the features you intend to host, including `backend/migrations/`,
   `backend/gesser/`, and `.website_work/gesser-schema.sql`.
3. Replace the production URLs before using community features on a fork. Main client entry points
   include `src/lib/dailyPaintGallery.ts`, `src/lib/dailyPaintUpload.ts`,
   `src/lib/profileAuth.ts`, and `src/gesser/api/gesserClient.ts`. Find the remaining references with:
   ```bash
   rg -n 'https://emojipainter\.com' src .website_work backend server-fix
   ```
4. Legacy upload/vote signing reads `EXPO_PUBLIC_DAILY_PAINT_SECRET`. For local integration work,
   use your own value and matching server configuration. **Any `EXPO_PUBLIC_*` value is embedded in
   the client, and a value in `.website_work/gallery.html` is visible to visitors. Neither is a
   private server credential.** A public deployment needs server-side authorization, validation,
   and abuse controls; the shared client value alone cannot establish a trusted caller.

The current source still contains production URLs. An unset upload secret does not disconnect
community screens from the live service. Painting operations themselves need no backend.

## Optional diagnostics

Crash reporting is disabled by default in the public source build. To enable it for your own
release build, set `EXPO_PUBLIC_SENTRY_DSN` to your project's client DSN and review
`src/lib/crashReporting.ts`. Development and Lite builds keep reporting disabled. Never use a
Sentry auth token as the client DSN.

The standalone multiplayer canvas server (`multi/`) is a separate Node.js app; see `multi/README.md`.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint         # eslint
npm test             # jest
```

The GitHub Actions page runs the repository's configured checks for pushes and pull requests. Check
the latest workflow run there for the current result; local build requirements and backend setup are
described above.
