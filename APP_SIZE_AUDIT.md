# Emoji Painter iOS App Size Audit

Audit date: 2026-07-30. The measurements below are from actual Release archives and IPA exports on this machine.

## Before and after

| Build | Installed app | Archive IPA export | Notes |
|---|---:|---:|---|
| Baseline `EmojiPainterLite-9.2.1-845.xcarchive` | 713,363,456 bytes (680M) | 484,562,547 bytes (462M) | Existing archive/export |
| Optimized `EmojiPainter-lite-20260730-083100.xcarchive` | 471,429,120 bytes (450M) | 423,490,668 bytes (404M) | Release archive rebuilt after media optimization |
| Reduction | 241,934,336 bytes (32.8%) | 61,071,879 bytes (12.6%) | IPA export is unsigned/debugging-style and is not an App Store download estimate |

App Store Connect download size is not available from a local archive. Store slicing, compression, and device-specific variants must be measured after upload in App Store Connect.

## Largest installed resources

Baseline, descending:

| Resource | Size | Build/source path | Required? | Action |
|---|---:|---|---|---|
| `assets/assets/logos` | 190M | `assets/logos`, generated imports in `src/lib/logoManifest.ts` | Yes, image logo animation | Retained; these are the remaining largest verified visual assets |
| `assets/assets/logosvideo` | 185M | `assets/logosvideo`, `logoManifest.ts` | Yes, logo video rotation | Re-encoded to HEVC |
| `assets/assets/welcomer` | 109M | `assets/welcomer`, `src/utils/welcomerVideos.ts` | Yes, welcome content | Re-encoded to HEVC |
| `level-emojis-mini` | 38M | `assets/level-emojis-mini` | Yes, level UI | Retained |
| `tutorial_ipad.mov` | 36M | `assets/tutorial_ipad.mov`, info panel | Yes, tutorial | Retained; requires separate review |
| `customEmoji/material` | 34M | `assets/customEmoji/material` | Yes, custom emoji set | Retained |
| `level-emojis` | 20M | `assets/level-emojis` | Yes, level UI | Retained |

Optimized archive, descending:

| Resource | Size |
|---|---:|
| `assets/assets/logos` | 190M |
| `assets/assets/logosvideo` | 49M |
| `assets/assets/level-emojis-mini` | 38M |
| `tutorial_ipad.mov` | 36M |
| `assets/assets/customEmoji/material` | 34M |
| `assets/assets/level-emojis` | 20M |
| `assets/assets/welcomer` | 18M |
| app binary | 24M |
| `main.jsbundle` | 8.6M |
| `Assets.car` | 7.6M |

## Findings and decisions

- Metro bundles the static `require()` assets under `EmojiPainter.app/assets/assets`. `assetBundlePatterns: ["**/*"]` also keeps the source asset tree eligible for bundling.
- `src/lib/logoManifest.ts` imports 177 image logo sets and the video logo files. `src/utils/welcomerVideos.ts` imports 25 welcome videos. These references were verified before changing media.
- The video files contained redundant/large encodings. `logosvideo` fell from 185M to 49M and `welcomer` from 109M to 18M. Dimensions and duration were preserved, audio was retained where present, and HEVC uses the `hvc1` tag for iOS playback.
- The release archive contains device code only; simulator architectures and debug symbols were not included in the installed app measurement. Frameworks were inspected and were not the dominant cause.
- No unused local model weights, ZIP/source archives, test recordings, or duplicate asset-catalogue copy was removed without a code/build reference check.
- The remaining 190M `logos` tree is required by the generated image animation manifest. It is the next optimization candidate: lossless WebP conversion or a verified on-demand subset, followed by a clean Release build and runtime frame playback test.

## Repeatable audit and optimization commands

```sh
scripts/optimize-bundled-media.sh
scripts/build-ios.sh lite archive
scripts/audit-ios-size.sh build/EmojiPainter-lite-YYYYMMDD-HHMMSS.xcarchive path/to/exported/EmojiPainter.ipa
```

The optimization script only replaces a source video when the HEVC output is smaller. It preserves the original if encoding fails or produces a larger file.
