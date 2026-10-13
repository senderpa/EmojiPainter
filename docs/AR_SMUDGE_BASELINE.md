# AR Wall Smudge Baseline

This document records the working back-camera AR wall smudge before the experimental Focus and Flow controls were added. It covers `ArPaintingScreen` and `WallPaintView`; the 2D/Metal canvas smudge and the face-mask smudge are separate implementations.

## Input and camera source

- Entering the `smudge` tool starts a normal undoable AR stroke group.
- On touch-down, `currentCameraSnapshot()` captures `ARSession.currentFrame.capturedImage`, orients it `.right`, and stores one frozen `UIImage` in `smudgeSnapshot` for the entire gesture.
- The implementation must not fall back to `arView.snapshot()`. That image contains rendered SceneKit planes and previous strokes, which previously appeared as white circles when sampled.
- Coalesced touch points are processed during movement. A dab is skipped when the squared screen-space distance from the last accepted point is below `44 - sN * 20`.

## Sampling and strength mapping

The UI strength slider originally exposed `0.15...1.0` and defaulted to `0.7`. Native code normalized it as:

```text
sN = clamp((smudgeStrength - 0.15) / 0.85, 0, 1)
drag = currentTouch - previousAcceptedTouch
pull = 1 + 2 * sN
samplePoint = currentTouch - drag * pull
```

Consequently, low strength sampled approximately one input step behind the finger and high strength sampled approximately three steps behind it. The camera crop was sampled at `samplePoint` and deposited at the raycast position for `currentTouch`, which created the apparent pixel displacement.

The camera-crop side length was:

```text
sidePx = clamp((brushSizeMeters / 0.092) * 88, 44, 112)
worldPlaneSize = brushSizeMeters * 1.35
```

The crop renderer deliberately used scale `1`, avoiding the roughly 9× cost of rendering a 3× device-scale dab.

## Texture, alpha, and emoji mask

- Per-dab camera opacity was `0.60 - sN * 0.28`.
- The selected emoji was rendered only to construct a white-on-transparent alpha silhouette. Its colors never entered the deposited camera texture.
- The emoji font size was `side * 0.72`.
- Edge feather was `side * (0.20 - clamp(smudgeStrength, 0, 1) * 0.06)`.
- The camera image was vertically flipped around the dab center, then drawn through the silhouette with `.sourceIn`. A former 180-degree rotation also flipped X and caused mirrored camera texture.
- Empty/unrenderable glyphs fell back to a feathered rounded-square mask.
- Masks were cached by emoji, rounded side, and strength quantized to tenths. The cache was cleared and reseeded after it exceeded 24 entries.

## SceneKit placement and history

- Each dab is a constant-lit, double-sided `SCNPlane` with alpha blending, no depth reads/writes, no shadows, and `renderingOrder = 10_000`.
- The plane is oriented to the raycast surface and lifted 4 mm along its normal so the live smudge stays above existing strokes.
- Textured smudge nodes are children of the live stroke group. `extraContentCount` makes the group participate in session undo/redo and clear even though it has no normal `StampData`.
- Smudge state is cleared at the end of the gesture; a cancelled stroke removes its live group.

## Persistence limitation

Saved AR scenes currently serialize only paint records containing normal world-space `StampData`. Smudge groups contain textured SceneKit nodes and an `extraContentCount`, so they work with live-session history but are not written to `strokes.json` or replayed after loading a saved scene. Solving that limitation requires a separate texture-persistence design and is intentionally outside the Focus/Flow experiment.

## Neutral compatibility contract

The experimental implementation preserves this baseline at:

```text
smudgeStrength = 0.7
smudgeFocus = 0.5
smudgeFlow = 0.5
```

At neutral Focus and Flow, sampling, mask construction, opacity, orientation, placement, and history behavior take the legacy path without additional filtering.

## Current four-control experiment

The current implementation adds four vertical controls. Each control has a small
bypass switch; bypass sends that control's neutral value to native code without
discarding the slider position.

```text
Reach: 0...1, neutral/legacy = 0.7
Focus: 0...1, neutral = 0.5
Flow:  0...1, neutral = 0.5
Scale: 0...1, neutral = 0.5 = corrected 1× projection
```

- **Reach** extends the original strength range. The low tail is drier and the
  high tail carries farther than the old public slider range.
- **Focus** moves from a sharp, solid emoji-shaped pickup through the legacy mask
  to a smaller, heavily feathered/blurred core with a deterministic dotted halo.
- **Flow** at minimum freezes the first sampled camera coordinate for the gesture,
  forces sharp focus, and repeats it with stamp-like spacing. Center is the legacy
  moving pickup. Maximum repicks near the finger, forces soft focus, and accepts a
  much denser stream of dabs for a compact local mix.
- **Scale** is exponential: `2 ^ ((value - 0.5) * 2)`, exposing `0.5×...2×`
  while keeping the center exactly `1×`.

## Corrected camera-to-wall mapping

The Scale experiment also fixes a mapping bug that is independent of its slider:

1. The frozen sensor frame is oriented for the current interface orientation.
2. It is aspect-filled into an image exactly the size of the `ARSCNView`, matching
   the camera background instead of stretching a 4:3 frame into the phone view.
3. For every dab, the code projects the final world-space plane's local X and Y
   edges back into screen coordinates.
4. The source crop is scaled independently in X and Y so it covers that measured
   screen footprint. The same wall detail therefore stays aligned across distance,
   surface angle, and brush size.

The old vertical flip is no longer applied: both the corrected snapshot and touch
coordinates use UIKit's top-left view coordinate system. Scale center is the
calibrated mapping; its endpoints deliberately zoom the sampled texture out/in so
the result can be checked on a real device.
