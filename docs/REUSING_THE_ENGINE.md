# Reusing the painting renderer

The renderer is currently an internal part of the EmojiPainter Expo app, not a separately published
library. This example shows its existing integration surface so another React Native developer can
evaluate and adapt it. It renders normal emoji strokes; smudge rendering is handled elsewhere in
the application.

## Requirements

- Node.js 20.19.4 or newer
- React Native / Expo with the versions in this repository
- `@shopify/react-native-skia` and the EmojiPainter source tree

The source imports preview rendering and stroke types from the app, so copying only
`TilePaintCanvas.tsx` is not a supported standalone install. Clone the repository and install its
dependencies as described in [`BUILDING.md`](BUILDING.md). CI checks TypeScript, lint, Jest, and an
unsigned iOS simulator build. Check the latest Actions result for the current branch. Production
media is partly replaced by fallback assets in this public export; see the build guide.

## Minimal screen

`examples/TileCanvasPreview.tsx` is a compact screen example. In an app screen, import it and render
`<TileCanvasPreview />`. It uses the existing renderer directly and a few ordinary emoji strokes.
`width` and `height` are logical React Native points; stroke point `t` is elapsed time in
milliseconds. The example is included in `npm run typecheck`. It displays sample strokes;
it does not install gesture handlers or provide an editable painting screen.

For a standalone Swift component, `VectorDocumentCore/` has no Expo dependency:

```bash
cd VectorDocumentCore
swift test
```

Its schema, camera math, and timeline evaluation are reusable separately from the renderer.

For an end-user experience with controls, replay, and export, use the existing app or the
[browser pilot](https://emojipainter.com/emoji_paint/index.html). The tile renderer itself does not
provide those application-level controls.
