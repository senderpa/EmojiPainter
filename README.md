<h1 align="center">EmojiPainter</h1>
<p align="center"><strong>A creative painting platform, not just an emoji app.</strong></p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://github.com/senderpa/EmojiPainter/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/senderpa/EmojiPainter"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey">
  <img alt="Built with Expo" src="https://img.shields.io/badge/built%20with-Expo%20%2F%20React%20Native-000000">
</p>

<p align="center">
  <a href="https://emojipainter.com/">🌐 Try it online</a> ·
  <a href="https://emojipainter.com/public/gallery.html">🖼️ Community gallery</a> ·
  <a href="https://apps.apple.com/us/app/emoji-painter/id6753342820">📱 iPhone / iPad — Free</a> ·
  <a href="https://apps.apple.com/us/app/emoji-paint/id6753338528">💻 Mac — Free</a>
</p>

---

EmojiPainter is a real-time mobile painting engine, reimagined around emoji as a brush medium
instead of flat color. It's a working reference implementation for several things that don't
usually live in one open-source project: a tile-cached GPU 2D canvas, touch/stylus smudge and
compositing, an infinite vector canvas, frame-based animation, and genuine spatial painting —
painting directly onto real walls and rooms in AR, including a native RoomPlan-driven 3D room
inspector.

It's built and maintained by one person — [see the creator note](#creator-note) — using modern
agentic coding tools to build further than a solo self-taught developer could otherwise reach.

> GitHub doesn't render embedded iframes in README files. Use the links above to open the live
> painter and gallery, or click any artwork below to open its gallery post.

### 2026 community gallery highlights

<table>
  <tr>
    <td align="center" width="50%">
      <a href="https://emojipainter.com/public/gallery.html?post=94"><img src=".github/images/gallery-wasp-nest-city.gif" width="240" alt="Animated community painting: Wasp-Nest City, by Kakaduuu" /></a><br/>
      <sub><a href="https://emojipainter.com/public/gallery.html?post=94">Wasp-Nest City · GIF · by Kakaduuu ↗</a></sub>
    </td>
    <td align="center" width="50%">
      <a href="https://emojipainter.com/public/gallery.html?post=93"><img src=".github/images/community-ice-clown.jpg" width="240" alt="Community gallery artwork: Ice Clown" /></a><br/>
      <sub><a href="https://emojipainter.com/public/gallery.html?post=93">Ice Clown · community gallery ↗</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <a href="https://emojipainter.com/public/gallery.html?post=92"><img src=".github/images/community-whispering-cliffs.jpg" width="240" alt="Community gallery artwork: Whispering Cliffs" /></a><br/>
      <sub><a href="https://emojipainter.com/public/gallery.html?post=92">Whispering Cliffs · community gallery ↗</a></sub>
    </td>
    <td align="center" width="50%">
      <a href="https://emojipainter.com/public/gallery.html?post=89"><img src=".github/images/community-rockpool-snail.jpg" width="240" alt="Community gallery artwork: Rockpool Snail" /></a><br/>
      <sub><a href="https://emojipainter.com/public/gallery.html?post=89">Rockpool Snail · community gallery ↗</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <a href="https://emojipainter.com/public/gallery.html?post=87"><img src=".github/images/gallery-disco-wizard.gif" width="240" alt="Animated community gallery painting: Disco Wizard, by Kakaduuu" /></a><br/>
      <sub><a href="https://emojipainter.com/public/gallery.html?post=87">Disco Wizard · GIF · by Kakaduuu ↗</a></sub>
    </td>
    <td align="center" width="50%">
      <a href="https://emojipainter.com/public/gallery.html?post=79"><img src=".github/images/gallery-adrift.gif" width="240" alt="Animated community gallery painting: Adrift, pleasantly, by Kakaduuu" /></a><br/>
      <sub><a href="https://emojipainter.com/public/gallery.html?post=79">Adrift, pleasantly · GIF · by Kakaduuu ↗</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src=".github/images/example-artwork.jpg" width="240" alt="Example artwork painted in EmojiPainter" />
    </td>
  </tr>
</table>

## What's actually in this repository

Everything below is verified against the source in this repo — nothing here is aspirational.

- **2D painting engine** — tile-cached GPU canvas (`src/engine/`, `src/workspace/`), built for
  real-time high-density stamping without frame drops.
- **AR / spatial painting** (`modules/emoji-ar/`) — paint directly onto real walls and surfaces via
  ARKit + RealityKit; on LiDAR devices, Apple RoomPlan captures the room and a native SceneKit
  "dollhouse" inspector lets you orbit the captured room with your painted strokes rendered on it
  at true scale, with shadow-casting lighting.
- **Vector mode** (`src/vector/`, `VectorDocumentCore/`) — an infinite Skia vector canvas backed by
  a dedicated Swift Package document core.
- **Frame animator** (`src/animation/`, `src/animator/`, `src/framer/`) — timeline-based animation
  over painted strokes.
- **Smudge/compositing brush engine** — CPU pixel smudging that carries real canvas color, not a
  filter.
- **Front-camera face painting** (`modules/emoji-ar/` face module) — on-device ARKit face tracking;
  no camera frames or face geometry ever leave the device.
- **Daily/mystery painting challenges + gallery** (`src/gesser/`, `backend/`, `.website_work/`) —
  a human-authored daily topic system (plus a "mystery" surprise-topic mode) with a public gallery
  and social/profile features, backed by the included PHP reference server.
- **Export** — finished paintings export as images/GIFs/video from the actual stroke data (not a
  fragile screen capture), so exports stay correct even for the native Metal/AR canvases.
- **Collaborative multiplayer canvas** (`src/multiplayer/`, `multi/`) — a standalone Node.js server
  for shared real-time canvases.

Full breakdown of what's included vs. intentionally excluded (and why):
[`docs/OPEN_SOURCE_BOUNDARY.md`](docs/OPEN_SOURCE_BOUNDARY.md).

## Architecture

```mermaid
flowchart TB
  App["React Native / Expo app (src/)"]

  App --> Canvas["2D Painting Engine<br/>Skia + GPU tile cache"]
  App --> AR["AR / Spatial Painting<br/>modules/emoji-ar (ARKit + RealityKit + RoomPlan)"]
  App --> Vector["Vector Mode<br/>VectorDocumentCore (Swift Package)"]
  App --> Animator["Frame Animator"]
  App --> Community["Community client<br/>src/gesser, src/social, src/multiplayer"]

  AR --> RoomInspector["Native SceneKit<br/>3D Room Inspector"]
  Community --> Backend["Reference PHP backend<br/>backend/, .website_work/"]
  Community --> MultiServer["Collaborative canvas server<br/>multi/ (Node.js)"]
```

More detail: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Getting started

```bash
git clone https://github.com/senderpa/EmojiPainter.git
cd EmojiPainter
npm install
npx expo run:ios      # or: npx expo run:android
```

Full setup (Xcode/Android Studio requirements, native module notes, backend setup for the
community features): [`docs/BUILDING.md`](docs/BUILDING.md).

## Status & roadmap

This is a young open-source release of a ~1.5-year-old production app. See
[`ROADMAP.md`](ROADMAP.md) for what's next and [`CHANGELOG.md`](CHANGELOG.md) for release history.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security issues: see [`SECURITY.md`](SECURITY.md)
rather than filing a public issue.

## Creator note

EmojiPainter is built by Pascal Sender, a Swiss visual artist whose practice has long combined
physical painting, augmented reality, and hand-built software — previously hand-coding AR software
connected to his
painting practice, and now building this as a public, open creative tool rather than a closed
production app. Modern agentic coding tools materially expanded what was buildable solo.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Third-party dependency
licenses: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
