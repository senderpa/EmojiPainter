import ExpoModulesCore
import MetalKit
import simd

// Native Metal live painting view.
// - Committed strokes render into a persistent committed texture PER LAYER (see the 3-layer note below).
// - Normal live stroke draws on top each frame (cheap).
// - LIVE SMUDGE runs entirely on the GPU: a working texture (= committed + smudge so far) is smudged
//   along the live stroke via MetalPaintRenderer.applySmudgeDabs (no upload, no per-frame readback).
//   On release the smudged region is read back ONCE into a base64 PNG tile and emitted via onSmudgeBaked
//   so JS can persist it (save/export); the working texture keeps displaying until the rebuilt
//   committed texture contains that baked tile (no flicker).
//
// 3-LAYER SYSTEM (foreground / middle / background)
// -------------------------------------------------
// Layers are NOT implemented by sorting one strokes array. Reconciliation decides
// incremental-append vs full-rebuild by COMMON PREFIX of stroke ids, so a stroke inserted anywhere
// but the end forces a FULL CANVAS REBUILD — and the default layer is the MIDDLE one, so sorting
// would rebuild the whole canvas on nearly every stroke.
//
// Instead there is ONE COMMITTED TEXTURE PER LAYER, each with its own processedIds/compositedIds,
// composited bottom → top (background, middle, foreground) into the drawable every frame. Splitting
// the append-only strokes array by layer yields three append-only arrays, so the cheap incremental
// append survives on ALL THREE layers.
//
// Compositing uses the same PREMULTIPLIED source-over convention as the stamp path
// (mp_fragment_stamp returns c * opacity; blend = .one / .oneMinusSourceAlpha):
//     outRGB = srcRGB + dstRGB * (1 - srcA)
//     outA   = srcA   + dstA   * (1 - srcA)
// Layer textures are cleared to (0,0,0,0), so an untouched pixel cannot tint what is below it.
//
// Layer VISIBILITY is applied on the JS side (hidden layers' strokes never reach this view), which
// keeps the native contract to a single strokes payload. Content is only ever hidden, never lost —
// it lives in the JS data model.

/// One layer's committed texture plus the reconcile bookkeeping that belongs to it. Per-layer state
/// (not one global set) is what keeps each layer independently incremental.
private final class MPLayerState {
  var texture: MTLTexture?
  /// This layer's strokes, in creation order (a stable filter of the full array).
  var strokes: [MPStroke] = []
  /// Ids already drawn into `texture`, in order.
  var processedIds: [String] = []
  /// Ids already blitted pixel-exact into `texture` (just-finished normal stroke / smudge).
  var compositedIds = Set<String>()
  /// Smudge ids whose baked tile has been rendered into `texture`.
  var renderedSmudgeTiles = Set<String>()
}

final class MetalPaintView: ExpoView, MTKViewDelegate {
  private let mtkView = MTKView()
  private let device = MTLCreateSystemDefaultDevice()
  private var commandQueue: MTLCommandQueue?
  // Dedicated queue for the persistence-tile readback/encode. Keeping it OFF the render queue means a big
  // smudge's region capture can NEVER queue ahead of draw()/present — that serialization was the post-smudge
  // freeze (canvas stopped presenting, next smudge "lost", zoom showed stale pixels) that scaled with size.
  private var captureQueue: MTLCommandQueue?
  private var renderer: MetalPaintRenderer?
  private var clearColor = MTLClearColor(red: 0.02, green: 0.02, blue: 0.02, alpha: 1)
  private var strokes: [MPStroke] = []
  private var lastStrokesJson = ""   // guard: skip redundant re-parse/rebuild when JS resends identical strokes
  private var liveStrokes: [MPStroke] = []
  private var canvasW: Float = 1
  private var canvasH: Float = 1
  private var didSignalReady = false

  // One committed texture per layer (background / middle / foreground), each with its own
  // processedIds + compositedIds + renderedSmudgeTiles. Textures are allocated LAZILY, so a painting
  // that only ever uses the default layer costs exactly the same GPU memory as before layers existed.
  private var layers: [MPLayerState] = (0..<MPLayerIndex.count).map { _ in MPLayerState() }
  /// Size of the layer/working textures in device px (0 until the drawable size is known).
  private var texWidthPx = 0
  private var texHeightPx = 0
  private var reconcilePending = true
  // Keep showing the working texture (smudge preview) after release until the committed canvas actually
  // contains the smudge (its baked tile has rendered in) — eliminates the disappear-then-reappear gap.
  private var pendingHoldId: String?
  /// Layer the held preview belongs to (survives smudgeActive going false).
  private var holdLayerIndex = MPLayerIndex.middle
  // Baked smudge tiles by stroke id (id → base64 PNG), delivered via the smudgeTilesJson prop and merged
  // onto strokes — keeps the per-stroke strokesJson free of megabyte tile payloads.
  private var smudgeTileMap: [String: String] = [:]
  // Deferred bake: capturing is cheap and happens at endSmudge (the texture is needed for rendering), but
  // the PNG ENCODE + the megabyte onSmudgeBaked event to JS are batched and flushed ~0.5s AFTER the user
  // stops smudging — so rapid smudging has zero encode/bridge cost and stays realtime.
  // Region (in committed-texture px) + dip bounds of each finished smudge, captured LATER from the stable
  // `committed` texture during the idle flush — never on the hot path between strokes.
  private var pendingCaptures: [(id: String, layer: Int, x: Int, y: Int, w: Int, h: Int, bounds: SIMD4<Float>)] = []
  private var encodeFlushItem: DispatchWorkItem?

  // Smudge working/scratch textures + session state.
  private var smudgeWorking: MTLTexture?
  private var smudgeScratch: MTLTexture?
  private var smudgeActive = false
  private var smudgeId = ""
  /// Layer the in-progress smudge belongs to (its working texture is seeded from that layer).
  private var smudgeLayerIndex = MPLayerIndex.middle
  private var smudgeProcessed = 0
  private var smudgeRadiusPx: Float = 1
  private var smudgeStrength: Float = 0.8
  private var smudgeWetMix: Float = 1.0
  private var smudgeSoftness: Float = 0.5
  private var smudgeMaskCurve: Float = 1.5
  private var smudgeMask: MTLTexture?
  private var smudgeMinX: Float = 0, smudgeMinY: Float = 0, smudgeMaxX: Float = 0, smudgeMaxY: Float = 0

  // Incremental live (normal/eraser) stroke: drawn into the working texture, only new points per frame.
  private var liveActive = false
  private var liveId = ""
  /// Layer the in-progress normal/eraser stroke belongs to.
  private var liveLayerIndex = MPLayerIndex.middle
  private var liveProcessed = 0
  /// Last point already drawn into `working`. Re-checked each frame: if it has
  /// moved, the stroke rewrote its points instead of appending (straight-line
  /// tool) and `working` must be rebuilt from `committed`.
  private var liveAnchor: SIMD2<Float>?

  let onReady = EventDispatcher()
  let onPaintError = EventDispatcher()
  let onSmudgeBaked = EventDispatcher()
  // Native-timing channel → JS console → Metro stdout (so timings are READABLE off-device, unlike NSLog).
  let onPerf = EventDispatcher()
  @inline(__always) private func perf(_ msg: String) {
    NSLog("[SMUDGE-PERF/native] %@", msg)
    onPerf(["msg": msg])
  }

  var paused: Bool = false {
    didSet { mtkView.isPaused = paused }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    commandQueue = device?.makeCommandQueue()
    captureQueue = device?.makeCommandQueue()
    if let device = device { renderer = MetalPaintRenderer(device: device) }
    mtkView.device = device
    mtkView.delegate = self
    mtkView.framebufferOnly = true
    mtkView.isOpaque = false
    mtkView.layer.isOpaque = false
    mtkView.colorPixelFormat = .bgra8Unorm
    mtkView.isPaused = true
    mtkView.enableSetNeedsDisplay = true
    mtkView.clearColor = clearColor
    addSubview(mtkView)
    if device == nil {
      onPaintError(["message": "Metal is not available on this device"])
    } else if renderer == nil {
      onPaintError(["message": "MetalPaintRenderer failed to initialize"])
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    mtkView.frame = bounds
    mtkView.setNeedsDisplay()
  }

  private func scalePxPerDip() -> Float {
    guard texWidthPx > 0, canvasW > 0 else { return Float(UIScreen.main.scale) }
    return Float(texWidthPx) / canvasW
  }

  // MARK: - Layers

  /// Split the flat strokes array into the three per-layer buckets. A stable filter of an
  /// append-only array is itself append-only, which is exactly what keeps each layer's reconcile on
  /// the cheap incremental-append path.
  private func rebuildLayerBuckets() {
    for layer in layers { layer.strokes.removeAll(keepingCapacity: true) }
    for stroke in strokes {
      let index = min(max(stroke.layer, 0), MPLayerIndex.count - 1)
      layers[index].strokes.append(stroke)
    }
  }

  /// All strokes in PAINT ORDER (background → middle → foreground) — used for snapshot/export so the
  /// flattened output matches what the composited canvas shows.
  private func orderedStrokes() -> [MPStroke] {
    var out: [MPStroke] = []
    out.reserveCapacity(strokes.count)
    for index in MPLayerIndex.paintOrder { out.append(contentsOf: layers[index].strokes) }
    return out
  }

  /// Layer texture, created (and cleared to fully transparent) on first use.
  @discardableResult
  private func ensureLayerTexture(_ index: Int) -> MTLTexture? {
    guard index >= 0, index < layers.count else { return nil }
    if let existing = layers[index].texture { return existing }
    guard texWidthPx > 0, texHeightPx > 0, let device = device else { return nil }
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: texWidthPx, height: texHeightPx, mipmapped: false)
    desc.usage = [.renderTarget, .shaderRead]
    desc.storageMode = .private
    guard let tex = device.makeTexture(descriptor: desc) else { return nil }
    // CRITICAL: a fresh .private texture is uninitialized GPU memory (reads as pink/magenta). Clear
    // to (0,0,0,0) so untouched pixels are true zero-coverage and cannot tint the layers below.
    if let renderer = renderer, let cq = commandQueue {
      renderer.renderToTexture(strokes: [], canvasW: canvasW, canvasH: canvasH, texture: tex, commandQueue: cq)
    }
    layers[index].texture = tex
    return tex
  }

  // MARK: - Props

  func setBackgroundHex(_ hex: String) {
    if let parsed = MetalPaintView.parseHex(hex) {
      clearColor = parsed
      mtkView.clearColor = clearColor
      mtkView.setNeedsDisplay()
    }
  }

  // Guard: only force a full rebuild when the size ACTUALLY changes. RN re-applies props on every render
  // (every live-smudge move → many times/sec); without this guard each re-apply called forceRebuild(),
  // causing a per-frame structural FULL REBUILD storm that wiped just-made smudges + overheated the device.
  func setCanvasWidth(_ width: Double) {
    let w = Float(max(width, 1)); if w == canvasW { return }
    canvasW = w; forceRebuild(); mtkView.setNeedsDisplay()
    // Guaranteed-called-by-JS trigger. STRONG self + STATIC once-flag: keeps this instance alive for the
    // test even if React detaches a transient view (the [weak self] timers were firing with self==nil).
    if selfTestEnabled, !MetalPaintView.selfTestEverRan {
      MetalPaintView.selfTestEverRan = true
      NSLog("[SMUDGE-PERF/native] selfTest scheduled from setCanvasWidth w=%f", width)
      DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { self.runSmudgeSelfTestIfNeeded() }
    }
  }
  func setCanvasHeight(_ height: Double) {
    let h = Float(max(height, 1)); if h == canvasH { return }
    canvasH = h; forceRebuild(); mtkView.setNeedsDisplay()
  }

  private func forceRebuild() {
    for layer in layers { layer.processedIds = [] }
    reconcilePending = true
  }

  func setStrokesJson(_ json: String) {
    if json == lastStrokesJson { return }   // identical payload → nothing changed, skip the rebuild
    lastStrokesJson = json
    strokes = MetalPaintView.parseStrokes(json)
    applyTilesToStrokes()
    rebuildLayerBuckets()
    reconcilePending = true
    mtkView.setNeedsDisplay()
  }

  // Baked smudge tiles arrive on their own channel (id → base64 PNG), NOT inside strokesJson, so the
  // per-stroke payload stays tiny. We merge them onto the matching strokes by id.
  func setSmudgeTilesJson(_ json: String) {
    // MERGE (never replace): the view stores its OWN captured tiles in smudgeTileMap (see endSmudge), and
    // during a live session JS sends "{}" — a replace would wipe those. JS only ever ADDS tiles here
    // (loaded-from-disk smudges the view didn't capture). Stale entries from undo are harmless.
    if let data = json.data(using: .utf8),
       let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: String] {
      for (k, v) in obj { smudgeTileMap[k] = v }
    }
    applyTilesToStrokes()
    // MPStroke is a value type, so the buckets hold copies — rebuild them after merging tiles in.
    rebuildLayerBuckets()
    reconcilePending = true
    mtkView.setNeedsDisplay()
  }

  private func applyTilesToStrokes() {
    guard !smudgeTileMap.isEmpty else { return }
    for i in strokes.indices where strokes[i].isSmudge && strokes[i].bakedTile == nil {
      if let tile = smudgeTileMap[strokes[i].strokeId] { strokes[i].bakedTile = tile }
    }
  }

  func setLiveStrokeJson(_ json: String) {
    let parsed = MetalPaintView.parseStrokes(json)
    liveStrokes = []
    // Any live drawing activity defers tile persistence so disk I/O never competes with the interaction.
    if !parsed.isEmpty { encodeFlushItem?.cancel() }
    if let s = parsed.first {
      if s.isSmudge {
        if liveActive { endLiveNormal() }
        handleLiveSmudge(s)
      } else {
        if smudgeActive { endSmudge() }
        handleLiveNormal(s)
      }
      mtkView.setNeedsDisplay()
      return
    }
    // Stroke released → finalize whichever was active (composite into committed).
    if smudgeActive { endSmudge() }
    if liveActive { endLiveNormal() }
    mtkView.setNeedsDisplay()
  }

  // MARK: - Live normal/eraser stroke (incremental)

  private func handleLiveNormal(_ stroke: MPStroke) {
    guard let renderer = renderer, let commandQueue = commandQueue else { return }

    // Incremental drawing is only valid for strokes that GROW — a freehand brush
    // appends points and never moves the ones already drawn.
    //
    // The straight-line tool does not grow: it REBUILDS its entire point array
    // from (start → current endpoint) on every move event. Appending only the
    // tail left every angle the user swept through baked into `working`, so a
    // finished line was a fan of overlapping segments — while the stroke DATA
    // stayed clean, which is why closing and reopening the app replayed the very
    // same line perfectly straight.
    //
    // Detect a rewrite in O(1) by re-checking the last point we already drew: if
    // it moved, the array was rebuilt and `working` is stale, so restart from
    // `committed` and redraw the whole stroke. Extending a line straight outward
    // leaves earlier points untouched and still takes the cheap append path.
    let strokeLayerIndex = min(max(stroke.layer, 0), MPLayerIndex.count - 1)
    // A layer switch mid-id is impossible, but a restart on layer change keeps `working` honest.
    var mustRestart = !liveActive || liveId != stroke.strokeId || liveLayerIndex != strokeLayerIndex
    if !mustRestart, liveProcessed > 0 {
      if stroke.points.count < liveProcessed {
        mustRestart = true                      // array shrank → definitely rewritten
      } else if let anchor = liveAnchor {
        let p = stroke.points[liveProcessed - 1]
        if abs(p.x - anchor.x) > 0.01 || abs(p.y - anchor.y) > 0.01 {
          mustRestart = true                    // a previously-drawn point moved
        }
      }
    }

    if mustRestart {
      reconcileCommittedIfNeeded()
      // The working texture is seeded from the ACTIVE LAYER only, so the live stroke is drawn (and
      // later composited) into that layer alone — the other two are untouched.
      liveLayerIndex = strokeLayerIndex
      guard let committed = ensureLayerTexture(liveLayerIndex), let working = smudgeWorking else { return }
      renderer.blitCopy(from: committed, to: working, commandQueue: commandQueue)
      liveActive = true
      liveId = stroke.strokeId
      liveProcessed = 0
    }
    guard let working = smudgeWorking else { return }
    // Draw only the new points since last frame (constant cost regardless of stroke length).
    renderer.appendStrokeStamps(texture: working, stroke: stroke, fromSegment: liveProcessed,
                                canvasW: canvasW, canvasH: canvasH, commandQueue: commandQueue)
    liveProcessed = stroke.points.count
    if let last = stroke.points.last {
      liveAnchor = SIMD2<Float>(last.x, last.y)
    } else {
      liveAnchor = nil
    }
  }

  private func endLiveNormal() {
    defer { liveActive = false }
    guard let renderer = renderer, let commandQueue = commandQueue,
          let working = smudgeWorking,
          let committed = ensureLayerTexture(liveLayerIndex) else { liveActive = false; return }
    // Composite the live stroke into ITS layer; that layer's reconcile will skip re-drawing this id.
    renderer.blitCopy(from: working, to: committed, commandQueue: commandQueue)
    layers[liveLayerIndex].compositedIds.insert(liveId)
  }

  // MARK: - Committed texture

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
    ensureCommittedTexture(width: Int(size.width), height: Int(size.height))
    forceRebuild()
    view.setNeedsDisplay()
  }

  private func ensureCommittedTexture(width: Int, height: Int) {
    guard width > 0, height > 0, let device = device else { return }
    if texWidthPx == width, texHeightPx == height, smudgeWorking != nil { return }
    func make() -> MTLTexture? {
      let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
      desc.usage = [.renderTarget, .shaderRead]
      desc.storageMode = .private
      return device.makeTexture(descriptor: desc)
    }
    texWidthPx = width
    texHeightPx = height
    // Size changed → every layer texture is stale. Drop them; each is recreated (and cleared) lazily
    // by ensureLayerTexture on the next reconcile, so unused layers cost nothing.
    for layer in layers { layer.texture = nil }
    smudgeWorking = make()
    smudgeScratch = make()
    // CRITICAL: new .private textures are uninitialized GPU memory (shows as pink/magenta). Clear them
    // to transparent before any .load (append/blit) reads them.
    if let renderer = renderer, let cq = commandQueue {
      if let t = smudgeWorking { renderer.renderToTexture(strokes: [], canvasW: canvasW, canvasH: canvasH, texture: t, commandQueue: cq) }
      if let t = smudgeScratch { renderer.renderToTexture(strokes: [], canvasW: canvasW, canvasH: canvasH, texture: t, commandQueue: cq) }
    }
    ensureLayerTexture(MPLayerIndex.middle)
  }

  /// Bring every layer's committed texture up to date. Each layer reconciles INDEPENDENTLY against
  /// its own processedIds, so appending to one layer never invalidates the others.
  private func reconcileCommittedIfNeeded() {
    guard reconcilePending, let renderer = renderer, let commandQueue = commandQueue else { return }
    if texWidthPx == 0 {
      let size = mtkView.drawableSize
      ensureCommittedTexture(width: Int(size.width), height: Int(size.height))
    }
    guard texWidthPx > 0 else { return }

    for index in MPLayerIndex.paintOrder {
      reconcileLayer(index, renderer: renderer, commandQueue: commandQueue)
    }

    // Release the preview hold as soon as the smudge is in its layer's committed texture — that's true
    // right after endSmudge (composite + native captured texture), so no waiting on the JS tile
    // round-trip. Committed is then pixel-identical to the preview, so the flip is seamless.
    if let pid = pendingHoldId {
      let held = layers[holdLayerIndex]
      if held.compositedIds.contains(pid) || held.renderedSmudgeTiles.contains(pid) {
        pendingHoldId = nil
      }
    }
    reconcilePending = false
  }

  /// The original single-canvas reconcile, now scoped to ONE layer. Unchanged in spirit: common-prefix
  /// match → cheap append; anything else → full rebuild of that layer only.
  private func reconcileLayer(_ index: Int, renderer: MetalPaintRenderer, commandQueue: MTLCommandQueue) {
    let layer = layers[index]
    // Nothing to draw AND nothing stale to clear → do no GPU work at all. This is the normal state of
    // the two unused layers in a single-layer painting: no texture is ever allocated for them, so
    // memory and per-commit cost stay exactly what they were before layers existed.
    if layer.strokes.isEmpty,
       layer.texture == nil || (layer.processedIds.isEmpty && layer.compositedIds.isEmpty) {
      layer.processedIds.removeAll()
      layer.compositedIds.removeAll()
      layer.renderedSmudgeTiles.removeAll()
      return
    }
    guard let texture = ensureLayerTexture(index) else { return }
    let layerStrokes = layer.strokes

    // Common prefix by id between what's drawn (processedIds) and this layer's target strokes.
    var prefix = 0
    let limit = min(layer.processedIds.count, layerStrokes.count)
    while prefix < limit && layer.processedIds[prefix] == layerStrokes[prefix].strokeId { prefix += 1 }

    // Structural change → this layer must be rebuilt from scratch (first draw, undo/removal, reorder).
    let structuralChange = layer.processedIds.isEmpty || prefix < layer.processedIds.count || layerStrokes.count < layer.processedIds.count

    // Smudges whose baked PNG tile just arrived and that this layer doesn't already hold.
    let arrivedTileIds = layerStrokes
      .filter { $0.isSmudge && $0.bakedTile != nil && !layer.renderedSmudgeTiles.contains($0.strokeId) }
      .map { $0.strokeId }
    // A just-composited smudge is already pixel-exact in committed (endSmudge blitted working→layer).
    // If EVERY arrived tile is one of those, skip the rebuild — re-blitting the round-tripped tile would
    // only swap in the slightly-different version (the preview→render jump, worst at low strength). Tiles
    // are still needed for COLD rebuilds (undo/reload), which take the structural path below.
    let arrivedAllComposited = !arrivedTileIds.isEmpty && arrivedTileIds.allSatisfy { layer.compositedIds.contains($0) }
    let needTileRebuild = !arrivedTileIds.isEmpty && !arrivedAllComposited

    if structuralChange || needTileRebuild {
      // An emptied layer still needs one clearing pass so its stale pixels stop compositing.
      let _tr = CFAbsoluteTimeGetCurrent()
      renderer.renderToTexture(strokes: layerStrokes, canvasW: canvasW, canvasH: canvasH, texture: texture, commandQueue: commandQueue)
      perf(String(format: "FULL REBUILD layer=%@ strokes=%d structural=%@ tileRebuild=%@ took=%.1fms",
                  MPLayerIndex.name(index), layerStrokes.count, structuralChange ? "Y" : "N",
                  needTileRebuild ? "Y" : "N", (CFAbsoluteTimeGetCurrent() - _tr) * 1000))
      layer.processedIds = layerStrokes.map { $0.strokeId }
      for s in layerStrokes where s.isSmudge && s.bakedTile != nil { layer.renderedSmudgeTiles.insert(s.strokeId) }
      layer.compositedIds.removeAll()
    } else if layerStrokes.count > layer.processedIds.count || arrivedAllComposited {
      // Incremental: append only genuinely-new strokes; anything already composited into this layer
      // (just-finished normal stroke or smudge) is skipped so it isn't drawn twice.
      let startIdx = min(layer.processedIds.count, layerStrokes.count)
      let newOnes = startIdx < layerStrokes.count ? Array(layerStrokes[startIdx..<layerStrokes.count]) : []
      let toDraw = newOnes.filter { !layer.compositedIds.contains($0.strokeId) }
      if !toDraw.isEmpty {
        renderer.appendToTexture(strokes: toDraw, canvasW: canvasW, canvasH: canvasH, texture: texture, commandQueue: commandQueue)
      }
      layer.processedIds = layerStrokes.map { $0.strokeId }
      // Arrived tiles' pixels are already in committed → mark rendered (so the hold releases) without re-blit.
      for id in arrivedTileIds { layer.renderedSmudgeTiles.insert(id) }
    }

    // Drop composited ids whose baked tile has rendered (no longer needed). Keep the rest — a just-ended
    // smudge must stay here from endSmudge until its tile arrives, INCLUDING the brief window before JS
    // commits the stroke, so the hold releases immediately and committed is trusted.
    if !layer.compositedIds.isEmpty {
      layer.compositedIds = layer.compositedIds.filter { !layer.renderedSmudgeTiles.contains($0) }
    }
  }

  // MARK: - Live smudge

  private func handleLiveSmudge(_ stroke: MPStroke) {
    guard let renderer = renderer, let commandQueue = commandQueue else { return }
    if !smudgeActive || smudgeId != stroke.strokeId {
      beginSmudge(stroke)
    }
    guard smudgeActive, let working = smudgeWorking, let scratch = smudgeScratch, let mask = smudgeMask else { return }
    let scale = scalePxPerDip()
    let pts = stroke.points
    if pts.count < 2 { smudgeProcessed = pts.count; return }
    // Build dabs for the new segment(s) since last processed point.
    let startIdx = max(1, smudgeProcessed)
    if startIdx >= pts.count { return }
    let sizePx = stroke.size * scale
    let spacing = max(1.0, sizePx * 0.09)
    var dabs: [MetalPaintRenderer.MPSmudgeDab] = []
    var prev = pts[startIdx - 1]
    for i in startIdx..<pts.count {
      let cur = pts[i]
      let ax = prev.x * scale, ay = prev.y * scale
      let bx = cur.x * scale, by = cur.y * scale
      let dx = bx - ax, dy = by - ay
      let dist = max(0.0001, (dx * dx + dy * dy).squareRoot())
      let dirx = dx / dist, diry = dy / dist
      let steps = max(1, Int((dist / spacing).rounded()))
      for s in 1...steps {
        let t = Float(s) / Float(steps)
        let cx = ax + dx * t, cy = ay + dy * t
        // distance = segment length (px) → drives the shader's speed-based smear/wetness.
        dabs.append(MetalPaintRenderer.MPSmudgeDab(center: SIMD2<Float>(cx, cy), dir: SIMD2<Float>(dirx, diry), distance: dist))
        accumulateDirty(cx: cx, cy: cy, mask: mask)
      }
      prev = cur
    }
    let _td = CFAbsoluteTimeGetCurrent()
    renderer.applySmudgeDabs(working: working, scratch: scratch, mask: mask, dabs: dabs,
                            radiusPx: smudgeRadiusPx, strength: smudgeStrength, wetMix: smudgeWetMix,
                            softness: smudgeSoftness, maskCurve: smudgeMaskCurve, commandQueue: commandQueue)
    let _dabMs = (CFAbsoluteTimeGetCurrent() - _td) * 1000
    if _dabMs > 16 { perf(String(format: "liveDabs=%.1fms (dabs=%d size=%.0f)", _dabMs, dabs.count, stroke.size)) }
    smudgeProcessed = pts.count
  }

  private func beginSmudge(_ stroke: MPStroke) {
    let _t0 = CFAbsoluteTimeGetCurrent()
    var _reconcileMs = 0.0, _blitMs = 0.0
    defer { perf(String(format: "beginSmudge=%.1fms (reconcile=%.1f blit=%.1f size=%.0f)",
                        (CFAbsoluteTimeGetCurrent() - _t0) * 1000, _reconcileMs, _blitMs, stroke.size)) }
    guard let renderer = renderer, let commandQueue = commandQueue else { return }
    let _tr = CFAbsoluteTimeGetCurrent()
    reconcileCommittedIfNeeded()
    _reconcileMs = (CFAbsoluteTimeGetCurrent() - _tr) * 1000
    // Smudge drags pixels of the LAYER IT IS ON: the working texture is seeded from that layer's
    // committed texture only, so smearing on the foreground never smears middle/background content.
    smudgeLayerIndex = min(max(stroke.layer, 0), MPLayerIndex.count - 1)
    guard let committed = ensureLayerTexture(smudgeLayerIndex), let working = smudgeWorking else { return }
    let _tb = CFAbsoluteTimeGetCurrent()
    renderer.blitCopy(from: committed, to: working, commandQueue: commandQueue)
    _blitMs = (CFAbsoluteTimeGetCurrent() - _tb) * 1000
    smudgeActive = true
    smudgeId = stroke.strokeId
    smudgeProcessed = 0
    let scale = scalePxPerDip()
    let sizePx = stroke.size * scale
    smudgeMask = renderer.maskTexture(emoji: stroke.emoji, size: stroke.size)
    smudgeRadiusPx = max(1, sizePx * 0.5) // mask spans the full brush → radius = half
    // Smoothness slider (edgeBlend 0..1) drives the smudge character: low = short/dry/subtle,
    // high = long/wet/creamy. It scales smear length+push (strength) and the carry amount (wetMix).
    let blend = stroke.edgeBlend
    smudgeStrength = 0.4 + blend * 1.2   // 0.4 .. 1.6  → smear length + push
    smudgeWetMix = 0.5 + blend * 1.0     // 0.5 .. 1.5  → color carry/creaminess
    smudgeSoftness = max(0.1, blend)     // 0.1 .. 1.0  → local mixing softness
    smudgeMaskCurve = 1.5
    smudgeMinX = Float(working.width); smudgeMinY = Float(working.height); smudgeMaxX = 0; smudgeMaxY = 0
  }

  private func accumulateDirty(cx: Float, cy: Float, mask: MTLTexture) {
    let hx = Float(mask.width) / 2.0, hy = Float(mask.height) / 2.0
    smudgeMinX = min(smudgeMinX, cx - hx); smudgeMinY = min(smudgeMinY, cy - hy)
    smudgeMaxX = max(smudgeMaxX, cx + hx); smudgeMaxY = max(smudgeMaxY, cy + hy)
  }

  private func endSmudge() {
    let _t0 = CFAbsoluteTimeGetCurrent()
    var _compMs = 0.0, _capMs = 0.0
    defer {
      smudgeActive = false
      perf(String(format: "endSmudge=%.1fms (composite=%.1f captureSetup=%.1f)",
                  (CFAbsoluteTimeGetCurrent() - _t0) * 1000, _compMs, _capMs))
    }
    guard let renderer = renderer, let commandQueue = commandQueue, let working = smudgeWorking,
          let committed = ensureLayerTexture(smudgeLayerIndex) else { return }
    let _tc = CFAbsoluteTimeGetCurrent()
    // Composite the smudged result straight into committed (working = committed + smudge). Same command
    // queue as draw(), so the blit is ordered before the next frame reads committed — no wait/main-thread
    // stall needed (was blocking rapid smudging). Display then reads committed = identical to the preview.
    renderer.blitCopy(from: working, to: committed, commandQueue: commandQueue)
    _compMs = (CFAbsoluteTimeGetCurrent() - _tc) * 1000
    layers[smudgeLayerIndex].compositedIds.insert(smudgeId)
    // Briefly keep showing working until reconcile confirms committed holds the smudge (it does — via the
    // composite above + the native captured texture cached below), then draw() flips to committed.
    pendingHoldId = smudgeId
    holdLayerIndex = smudgeLayerIndex
    reconcilePending = true
    // The on-screen result is already done (composite). Bake the export tile WITHOUT blocking the next
    // stroke: capture the region now (fast GPU blit), then PNG-encode + base64 + emit off the main thread.
    guard smudgeMaxX > smudgeMinX, smudgeMaxY > smudgeMinY else { return }
    let _tcap = CFAbsoluteTimeGetCurrent()
    defer { _capMs = (CFAbsoluteTimeGetCurrent() - _tcap) * 1000 }
    let x = max(0, Int(smudgeMinX.rounded(.down)))
    let y = max(0, Int(smudgeMinY.rounded(.down)))
    let w = min(working.width - x, Int((smudgeMaxX - smudgeMinX).rounded(.up)) + 1)
    let h = min(working.height - y, Int((smudgeMaxY - smudgeMinY).rounded(.up)) + 1)
    guard w > 0, h > 0 else { return }
    let scale = scalePxPerDip()
    let id = smudgeId
    let dipX = Double(Float(x) / scale), dipY = Double(Float(y) / scale)
    let dipW = Double(Float(w) / scale), dipH = Double(Float(h) / scale)
    let bounds = SIMD4<Float>(Float(dipX), Float(dipY), Float(dipW), Float(dipH))
    // REALTIME FIX: do NO GPU readback here. The on-screen result is already in `committed` (the composite
    // above), so the canvas is correct immediately. The persistence-tile capture + encode is deferred to the
    // idle flush and reads the stable `committed` on a dedicated queue — so nothing ever queues ahead of the
    // next draw()/present. Just record the region (cheap).
    pendingCaptures.append((id: id, layer: smudgeLayerIndex, x: x, y: y, w: w, h: h, bounds: bounds))
    scheduleEncodeFlush()
  }

  /// (Re)arm the deferred encode flush — fires ~0.5s after the LAST smudge ends, so a burst of smudges
  /// produces no encode/bridge work until the user actually stops.
  private func scheduleEncodeFlush() {
    encodeFlushItem?.cancel()
    let item = DispatchWorkItem { [weak self] in self?.flushEncodes() }
    encodeFlushItem = item
    // Wait for genuine idle (1.5s) before touching disk; any new live stroke cancels + reschedules
    // (see setLiveStrokeJson) so persistence never competes with active drawing.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: item)
  }

  /// Encode all captured-but-not-yet-encoded smudge tiles (low priority, capped size) and emit each to JS
  /// for save/persistence. Runs only when idle.
  private func flushEncodes() {
    let batch = pendingCaptures
    pendingCaptures.removeAll()
    guard !batch.isEmpty, let renderer = renderer, let captureQueue = captureQueue else { return }
    // Snapshot each capture's SOURCE LAYER texture up front (main thread) — the tile must come from
    // the layer the smudge actually lives on, not from a single global canvas.
    let sources: [MTLTexture?] = batch.map { layers[min(max($0.layer, 0), MPLayerIndex.count - 1)].texture }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      guard let self = self else { return }
      let dir = MetalPaintView.smudgeTilesDir()
      for (i, item) in batch.enumerated() {
        // Capture the region from the now-stable layer texture on the dedicated queue (idle → no render
        // contention, no readback racing the next stroke). This replaced the hot-path readback.
        guard let committed = sources[i],
              let captured = renderer.captureRegion(committed, x: item.x, y: item.y, w: item.w, h: item.h, commandQueue: captureQueue) else { continue }
        let capId = item.id, capBounds = item.bounds
        DispatchQueue.main.async { self.renderer?.cacheSmudgeTile(id: capId, texture: captured, bounds: capBounds) }
        guard let data = renderer.encodedTilePNG(from: captured, maxDim: 1024) else { continue }
        let id = item.id
        let safeId = id.replacingOccurrences(of: "/", with: "_")
        let relPath = "smudge_tiles/\(safeId).png"
        let absURL = dir.appendingPathComponent("\(safeId).png")
        // Write the tile to a FILE (Documents/smudge_tiles/<id>.png) instead of shipping ~MB of base64
        // through the bridge into React state — that base64-in-state was the size-scaled post-smudge gap.
        do { try data.write(to: absURL, options: .atomic) } catch {
          NSLog("[metal-paint] tile write failed: \(error.localizedDescription)"); continue
        }
        let bx = Double(item.bounds.x), by = Double(item.bounds.y)
        let bw = Double(item.bounds.z), bh = Double(item.bounds.w)
        DispatchQueue.main.async {
          self.smudgeTileMap[id] = absURL.path   // native keeps the absolute path for cold-rebuild file loads
          // Emit only the tiny relative PATH (+ bounds) to JS — no base64.
          self.onSmudgeBaked(["id": id, "path": relPath, "x": bx, "y": by, "w": bw, "h": bh])
        }
      }
    }
  }

  /// Documents/smudge_tiles (created on first use). Relative paths survive app reinstall (the Documents
  /// UUID changes, but JS/native both re-resolve against the current Documents dir).
  static func smudgeTilesDir() -> URL {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = docs.appendingPathComponent("smudge_tiles", isDirectory: true)
    if !FileManager.default.fileExists(atPath: dir.path) {
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    return dir
  }

  // MARK: - Self-test (autonomous lag measurement; gated, removed before ship)
  // Drives synthetic smudge strokes through the REAL native pipeline and reports timing via onPerf, so
  // smudge lag can be measured with no human touching the device. Runs ONCE on launch when enabled.
  private let selfTestEnabled = false  // DISABLED for ship — flip to true only for autonomous lag testing
  private var selfTestDone = false
  static var selfTestEverRan = false  // process-wide once-guard (survives transient view instances)
  private var selfTestLines: [String] = []
  // Log to BOTH the perf channel (if Metro is attached) AND an in-memory buffer that gets written to
  // Documents/selftest.txt — so results are readable by pulling the file with devicectl (no Metro needed,
  // works in a standalone Release build).
  private func stLog(_ msg: String) {
    selfTestLines.append(msg); perf(msg)
    // Flush to file on EVERY line so even a crash/hang leaves a trail of how far it got.
    let txt = selfTestLines.joined(separator: "\n") + "\n"
    let url = MetalPaintView.smudgeTilesDir().deletingLastPathComponent().appendingPathComponent("selftest.txt")
    try? txt.write(to: url, atomically: true, encoding: .utf8)
  }

  private func makeSmudgeStroke(id: String, size: Float, points: [MPStrokePoint]) -> MPStroke {
    MPStroke(emoji: "🔵", size: size, opacity: 1, spacing: 0, stampSpan: 0, points: points,
             emojiSequence: nil, isEraser: false, isPlane: false, planeCorners: nil,
             rotation: 0, mirrorX: false, mirrorY: false,
             isSmudge: true, strokeId: id, bakedTile: nil, bakedBounds: nil,
             edgeBlend: 0.7, smudgeStrength: 0.85)
  }

  private func selfTestContentStrokes() -> [MPStroke] {
    let emojis = ["🌈", "🔥", "🌊", "⭐️", "🍀"]
    var out: [MPStroke] = []
    for (j, e) in emojis.enumerated() {
      var pts: [MPStrokePoint] = []
      let y = canvasH * (0.15 + 0.17 * Float(j))
      for i in 0...24 { let t = Float(i) / 24.0; pts.append(MPStrokePoint(x: 20 + t * (canvasW - 40), y: y, w: nil)) }
      out.append(MPStroke(emoji: e, size: 70, opacity: 1, spacing: 0, stampSpan: 0, points: pts,
                          emojiSequence: nil, isEraser: false, isPlane: false, planeCorners: nil,
                          rotation: 0, mirrorX: false, mirrorY: false,
                          isSmudge: false, strokeId: "content-\(j)", bakedTile: nil, bakedBounds: nil,
                          edgeBlend: 0, smudgeStrength: 0))
    }
    return out
  }

  private func selfTestRunOneSmudge(size: Float, id: String) {
    let n = 50
    var allPts: [MPStrokePoint] = []
    for i in 0...n {
      let t = Float(i) / Float(n)
      allPts.append(MPStrokePoint(x: 40 + t * (canvasW - 80), y: canvasH * 0.5 + sinf(t * 6.28) * canvasH * 0.25, w: nil))
    }
    let t0 = CFAbsoluteTimeGetCurrent()
    var maxMove = 0.0
    for i in 1...n {
      let s = makeSmudgeStroke(id: id, size: size, points: Array(allPts[0...i]))
      let tm = CFAbsoluteTimeGetCurrent()
      handleLiveSmudge(s)
      maxMove = max(maxMove, (CFAbsoluteTimeGetCurrent() - tm) * 1000)
    }
    let tEnd = CFAbsoluteTimeGetCurrent()
    endSmudge()
    let endMs = (CFAbsoluteTimeGetCurrent() - tEnd) * 1000
    // Force GPU completion to capture the TRUE cost (applySmudgeDabs/composite are async on the queue).
    if let cb = commandQueue?.makeCommandBuffer() { cb.commit(); cb.waitUntilCompleted() }
    let totalMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
    stLog(String(format: "SELFTEST size=%.0f maxMoveMs=%.1f endMs=%.1f totalGpuMs=%.1f pts=%d", size, maxMove, endMs, totalMs, n))
  }

  private func runSmudgeSelfTestIfNeeded() {
    NSLog("[SMUDGE-PERF/native] selfTest entry done=%@ renderer=%@ cq=%@",
          selfTestDone ? "Y" : "N", renderer == nil ? "NIL" : "ok", commandQueue == nil ? "NIL" : "ok")
    guard selfTestEnabled, !selfTestDone, let renderer = renderer, let cq = commandQueue else { return }
    selfTestDone = true
    stLog("SELFTEST ENTRY build=v21")
    // Self-contained: set a fixed test canvas + create textures, so the test never depends on JS props or
    // the canvas being visible/drawn.
    canvasW = 1366; canvasH = 1366   // ~iPad Pro 12.9 points
    ensureCommittedTexture(width: 2732, height: 2732)   // retina px — real-world texture size
    guard let committed = ensureLayerTexture(MPLayerIndex.middle) else { stLog("SELFTEST FAIL: no committed texture"); writeSelfTestResults(); return }
    stLog("SELFTEST begin canvas=\(Int(canvasW))x\(Int(canvasH)) tex=\(committed.width)x\(committed.height) build=smudge-840-realtime")
    // Paint content so the smear is visible in the snapshot.
    let content = selfTestContentStrokes()
    renderer.renderToTexture(strokes: content, canvasW: canvasW, canvasH: canvasH, texture: committed, commandQueue: cq)
    layers[MPLayerIndex.middle].strokes = content
    layers[MPLayerIndex.middle].processedIds = content.map { $0.strokeId }; reconcilePending = false
    // 1) Lag across brush sizes (single long stroke each).
    for size in [Float(60), 150, 300] { selfTestRunOneSmudge(size: size, id: "st-\(Int(size))") }
    // 2) Rapid back-to-back sequence (freeze / drawable-starvation check).
    let tR = CFAbsoluteTimeGetCurrent()
    for i in 0..<3 { selfTestRunOneSmudge(size: 120, id: "st-rapid-\(i)") }
    stLog(String(format: "SELFTEST rapid3 totalMs=%.1f drawSkips=%d", (CFAbsoluteTimeGetCurrent() - tR) * 1000, drawNilDrawableCount))
    stLog("SELFTEST done")
    writeSelfTestResults()
  }

  // Snapshot the COMMITTED texture + write all timing lines to Documents, so I can pull both with devicectl
  // (no Metro/log dependency).
  private func writeSelfTestResults() {
    let docs = MetalPaintView.smudgeTilesDir().deletingLastPathComponent()
    // committed is .private (CPU can't read it) → blit to a .shared copy via captureRegion first, then encode.
    if let renderer = renderer, let committed = layers[MPLayerIndex.middle].texture, let cq = captureQueue,
       let shared = renderer.captureRegion(committed, x: 0, y: 0, w: committed.width, h: committed.height, commandQueue: cq),
       let data = renderer.encodedTilePNG(from: shared, maxDim: 512) {
      do { try data.write(to: docs.appendingPathComponent("selftest.png"), options: .atomic); stLog("SELFTEST snapshot bytes=\(data.count)") }
      catch { stLog("SELFTEST snapshot write FAILED \(error.localizedDescription)") }
    } else { stLog("SELFTEST snapshot encode FAILED") }
    let txt = selfTestLines.joined(separator: "\n") + "\n"
    try? txt.write(to: docs.appendingPathComponent("selftest.txt"), atomically: true, encoding: .utf8)
  }

  // MARK: - Draw

  private var drawNilDrawableCount = 0
  func draw(in view: MTKView) {
    guard let commandQueue = commandQueue, let renderer = renderer,
          let descriptor = view.currentRenderPassDescriptor, let drawable = view.currentDrawable else {
      // A nil drawable means the present buffers are stuck (e.g. behind a big readback) — the canvas can't
      // present → the visible "frozen / lost smudge" freeze. Surface how often this happens (throttled).
      drawNilDrawableCount += 1
      if drawNilDrawableCount % 5 == 1 { perf("draw() SKIPPED — no drawable (count=\(drawNilDrawableCount))") }
      return
    }
    reconcileCommittedIfNeeded()
    guard let commandBuffer = commandQueue.makeCommandBuffer() else { return }
    descriptor.colorAttachments[0].clearColor = clearColor
    descriptor.colorAttachments[0].loadAction = .clear
    descriptor.colorAttachments[0].storeAction = .store
    // Which layer (if any) is currently showing its live working texture instead of its committed one.
    var workingLayer: Int? = nil
    if smudgeActive { workingLayer = smudgeLayerIndex }
    else if liveActive { workingLayer = liveLayerIndex }
    else if pendingHoldId != nil { workingLayer = holdLayerIndex }
    if let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) {
      // Composite bottom → top with PREMULTIPLIED source-over (encodeBlit uses the same stamp
      // pipeline: srcRGB * 1 + dstRGB * (1 - srcA)). Layer textures are cleared to (0,0,0,0), so
      // untouched pixels contribute nothing and cannot tint the layers underneath.
      for index in MPLayerIndex.paintOrder {
        if index == workingLayer, let working = smudgeWorking {
          renderer.encodeBlit(texture: working, encoder: encoder)
        } else if let texture = layers[index].texture {
          renderer.encodeBlit(texture: texture, encoder: encoder)
        }
      }
      encoder.endEncoding()
    }
    commandBuffer.present(drawable)
    commandBuffer.commit()
    if !didSignalReady { didSignalReady = true; onReady(["buildTag": "layers-3x-textures"]) }
  }

  // MARK: - Snapshot (export / upload parity)

  func snapshotToTmpFile() throws -> String {
    guard let renderer = renderer, let commandQueue = commandQueue else {
      throw NSError(domain: "MetalPaint", code: 1, userInfo: [NSLocalizedDescriptionKey: "renderer unavailable"])
    }
    let scale = Float(UIScreen.main.scale)
    let wPx = Int(canvasW * scale)
    let hPx = Int(canvasH * scale)
    // Flatten in PAINT ORDER (background → middle → foreground) so the exported PNG matches the
    // composited canvas rather than raw creation order.
    guard let image = renderer.makeSnapshotImage(strokes: orderedStrokes(), canvasW: canvasW, canvasH: canvasH, widthPx: wPx, heightPx: hPx, background: clearColor, commandQueue: commandQueue),
          let data = image.pngData() else {
      throw NSError(domain: "MetalPaint", code: 2, userInfo: [NSLocalizedDescriptionKey: "snapshot failed"])
    }
    let filename = "metalpaint-\(Int(Date().timeIntervalSince1970 * 1000)).png"
    let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(filename)
    try data.write(to: url)
    return url.absoluteString
  }

  // MARK: - Parsing

  private static func floatOf(_ value: Any?) -> Float? {
    if let n = value as? NSNumber { return n.floatValue }
    if let d = value as? Double { return Float(d) }
    if let i = value as? Int { return Float(i) }
    return nil
  }

  private static func parseStrokes(_ json: String) -> [MPStroke] {
    guard let data = json.data(using: .utf8),
          let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
    var out: [MPStroke] = []
    out.reserveCapacity(arr.count)
    for d in arr {
      let emoji = d["emoji"] as? String ?? ""
      let size = floatOf(d["size"]) ?? 30
      let opacity = floatOf(d["opacity"]) ?? 1
      let spacing = floatOf(d["spacing"]) ?? 0
      let stampSpan = floatOf(d["stampSpan"]) ?? 0
      let isEraser = d["isEraser"] as? Bool ?? false
      let isPlane = d["isPlane"] as? Bool ?? false
      let isSmudge = d["isSmudge"] as? Bool ?? false
      let strokeId = d["id"] as? String ?? ""
      // 3-layer system: absent key → middle, so every stroke saved before layers existed keeps
      // rendering exactly where it always did.
      let layerIndex = MPLayerIndex.from(d["layer"] as? String)
      // Prefer the file path (resolve relative → absolute against current Documents); fall back to
      // base64 `bakedTile` for old saved projects. `bakedTile` carries whichever — encode() handles both.
      var bakedTile = d["bakedTile"] as? String
      if let rel = d["bakedTilePath"] as? String, !rel.isEmpty {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        bakedTile = docs.appendingPathComponent(rel).path
      }
      let edgeBlend = floatOf(d["edgeBlendStrength"]) ?? 0.5
      let smudgeStrength = floatOf(d["smudgeStrength"]) ?? 0.85
      let rotation = floatOf(d["rotation"]) ?? 0
      let mirrorX = d["mirrorX"] as? Bool ?? false
      let mirrorY = d["mirrorY"] as? Bool ?? false
      var bakedBounds: SIMD4<Float>? = nil
      if let bb = d["bakedBounds"] as? [String: Any],
         let bx = floatOf(bb["x"]), let by = floatOf(bb["y"]),
         let bw = floatOf(bb["w"]), let bh = floatOf(bb["h"]) {
        bakedBounds = SIMD4<Float>(bx, by, bw, bh)
      }
      var pts: [MPStrokePoint] = []
      if let rawPts = d["points"] as? [[String: Any]] {
        pts.reserveCapacity(rawPts.count)
        for pp in rawPts {
          guard let x = floatOf(pp["x"]), let y = floatOf(pp["y"]) else { continue }
          pts.append(MPStrokePoint(x: x, y: y, w: floatOf(pp["w"])))
        }
      }
      let seq = d["emojiSequence"] as? [String]
      var corners: [SIMD2<Float>]? = nil
      if isPlane, let pc = d["planeCorners"] as? [String: Any] {
        func corner(_ k: String) -> SIMD2<Float>? {
          guard let c = pc[k] as? [String: Any], let x = floatOf(c["x"]), let y = floatOf(c["y"]) else { return nil }
          return SIMD2<Float>(x, y)
        }
        if let tl = corner("topLeft"), let tr = corner("topRight"),
           let br = corner("bottomRight"), let bl = corner("bottomLeft") {
          corners = [tl, tr, br, bl]
        }
      }
      // Distortion lattice, when the plane was applied with more than four handles.
      var lattice: [SIMD2<Float>] = []
      var latticeLevel = 1
      if isPlane, let raw = d["planeLattice"] as? [[String: Any]] {
        latticeLevel = Int(floatOf(d["planeLatticeLevel"]) ?? 1)
        lattice = raw.compactMap { entry in
          guard let x = floatOf(entry["x"]), let y = floatOf(entry["y"]) else { return nil }
          return SIMD2<Float>(x, y)
        }
        // Only trust a complete grid; a partial one would index out of bounds while sampling.
        let expected = (latticeLevel + 1) * (latticeLevel + 1)
        if lattice.count != expected { lattice = []; latticeLevel = 1 }
      }
      out.append(MPStroke(
        emoji: emoji, size: size, opacity: opacity, spacing: spacing, stampSpan: stampSpan,
        points: pts, emojiSequence: seq, isEraser: isEraser, isPlane: isPlane, planeCorners: corners,
        rotation: rotation, mirrorX: mirrorX, mirrorY: mirrorY,
        isSmudge: isSmudge, strokeId: strokeId, bakedTile: bakedTile, bakedBounds: bakedBounds,
        edgeBlend: edgeBlend, smudgeStrength: smudgeStrength, layer: layerIndex,
        planeLattice: lattice, planeLatticeLevel: latticeLevel
      ))
    }
    return out
  }

  private static func parseHex(_ hex: String) -> MTLClearColor? {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6 || s.count == 8, let value = UInt64(s, radix: 16) else { return nil }
    let r: Double, g: Double, b: Double, a: Double
    if s.count == 8 {
      r = Double((value >> 24) & 0xff) / 255.0; g = Double((value >> 16) & 0xff) / 255.0
      b = Double((value >> 8) & 0xff) / 255.0; a = Double(value & 0xff) / 255.0
    } else {
      r = Double((value >> 16) & 0xff) / 255.0; g = Double((value >> 8) & 0xff) / 255.0
      b = Double(value & 0xff) / 255.0; a = 1.0
    }
    return MTLClearColor(red: r, green: g, blue: b, alpha: a)
  }
}
