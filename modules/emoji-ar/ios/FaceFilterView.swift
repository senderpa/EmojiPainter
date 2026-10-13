import ARKit
import CoreImage
import ExpoModulesCore
import SceneKit

/**
 * FaceFilterView — "become a rigged emoji of yourself".
 *
 * Phase 1 (intro): runs ARFaceTracking and shows the live front camera. The
 * user takes a selfie (`captureSelfie`) which is uploaded to the 3D Factory
 * portrait_emoji_face backend on the JS side.
 *
 * Phase 2 (live puppet): once the server returns a rigged emoji head (USDZ),
 * JS sets `modelPath` + `arkitMapping`. We load the model, attach it to the
 * tracked face anchor, and drive its morph-target (blendshape) weights from
 * ARFaceAnchor every frame — so the emoji head mimics the user's expressions.
 *
 * Privacy: face tracking + the selfie capture run fully on device; only the
 * single still photo the user takes is uploaded (by the JS layer).
 */
class FaceFilterView: ExpoView, ARSCNViewDelegate {
  private let arView = ARSCNView()

  // MARK: Props (set from JS via the module)
  var paused = false { didSet { applyRunState() } }
  /// arkit blendShape key (e.g. "jawOpen") → morph-target name (e.g. "Mouth_Open")
  var arkitMapping: [String: String] = [:]
  /// "none" | "grey" | "camera" | "model"
  var maskMode: String = "none" { didSet { if oldValue != maskMode { applyMask() } } }

  // MARK: Paint-on-mask (emoji stamps on the grey face mesh)
  var paintEnabled = false
  var brushEmoji = "🎨"
  var paintSizePx: CGFloat = 90
  /// "stamp" = paint emoji stamps · "smudge" = drag the existing canvas pixels
  /// (incl. the live-webcam pixels when maskMode == "camera") like a finger.
  var paintMode: String = "stamp"
  var smudgeStrength: CGFloat = 0.8          // 0..1: carry reach + deposit amount
  private var lastSmudgeUV: CGPoint?
  /// Emoji-silhouette footprint for the smudge, cached per (emoji, radius).
  private var smudgeMaskCache: (key: String, rad: Int, mask: [UInt8])?
  /// Reused per-dab source-patch buffer (side² × RGBA) — no per-dab allocs.
  private var smudgeScratch: [UInt8] = []
  var paintTexturePath = "" { didSet { if oldValue != paintTexturePath { loadPaintTexture() } } }
  private var paintCtx: CGContext?
  private weak var paintMaterial: SCNMaterial?
  private static let paintCanvasSize = 1024
  private var emojiImageCache: [String: CGImage] = [:]

  // MARK: Face-mesh mask state (default masks: grey + live camera)
  private var maskNode: SCNNode?
  private var cameraMaskMaterial: SCNMaterial?
  // The webcam (textured) mask is an ARSCNFaceGeometry(fillMesh: true) — exactly
  // like the grey mask (so eyes/mouth are FILLED, no holes, and it auto-deforms
  // via the standard didUpdate path). Its texture is the camera baked into the
  // canonical face UV layout, so re-applying an SD restyle maps 1:1.
  private var bakedMaterial: SCNMaterial?
  private var cameraMaskActive = false
  /// The baked canonical-UV face texture (so the SD overlay can be reverted and
  /// exported for restyling).
  private var bakedSnapshot: UIImage?

  /// SD-restyled overlay texture for the webcam mask. Empty → original snapshot.
  /// An "anim:" prefix asks for a slow crossfade in instead of an instant swap.
  var cameraOverlayTexturePath = "" {
    didSet {
      guard oldValue != cameraOverlayTexturePath else { return }
      applyCameraOverlay()
    }
  }
  private var cameraFadeNode: SCNNode?
  private var cameraFadeGeo: ARSCNFaceGeometry?

  // MARK: Big face-tracked paint plane (sits behind the mask, fills the screen)
  var facePlaneEnabled = false { didSet { if oldValue != facePlaneEnabled { DispatchQueue.main.async { self.applyFacePlane() } } } }
  private var facePlaneNode: SCNNode?
  private var planeCtx: CGContext?
  /// True once the user has painted at least one stroke on the plane —
  /// an unpainted plane is skipped by the SD restyle entirely.
  private var planeHasPaint = false
  private weak var planeMaterial: SCNMaterial?

  // MARK: Native SD-frame "video" playback (preloaded → instant texture flips)
  private var sdFrameImages: [UIImage] = []
  private var planeSdFrameImages: [UIImage] = []   // parallel SD frames for the background plane
  private var sdPlayTimer: Timer?
  private var sdCurrentIndex = 0

  private func currentFaceAnchor() -> ARFaceAnchor? {
    arView.session.currentFrame?.anchors.compactMap { $0 as? ARFaceAnchor }.first
  }

  private func overlayImage() -> UIImage? {
    var raw = cameraOverlayTexturePath
    if raw.hasPrefix("anim:") { raw = String(raw.dropFirst(5)) }
    if raw.isEmpty { return bakedSnapshot }
    let url = raw.hasPrefix("file://") ? URL(string: raw) : URL(fileURLWithPath: raw)
    if let url = url, let img = UIImage(contentsOfFile: url.path) { return img }
    return bakedSnapshot
  }

  private func applyCameraOverlay() {
    guard cameraMaskActive, let mat = bakedMaterial, let contents = overlayImage() else { return }
    let animated = cameraOverlayTexturePath.hasPrefix("anim:")
    // Keep the SAME mesh — ONLY swap the texture. No second geometry, no flicker.
    if animated {
      // Smooth cross-dissolve from the current texture to the new one (texture
      // only, on the stable mask), then seed the paint canvas with the result.
      crossDissolveCameraTexture(to: contents, material: mat)
    } else {
      // Instant, clean swap (initial bake, reset, playback frames).
      seedPaintCanvas(contents)
      mat.diffuse.contents = currentPaintImage()
    }
  }

  private var dissolveTimer: Timer?

  /// Cross-dissolve the mask's texture from its current image to `target` over
  /// ~0.5s WITHOUT touching the geometry, then commit the result to the canvas.
  private func crossDissolveCameraTexture(to target: UIImage, material: SCNMaterial) {
    dissolveTimer?.invalidate()
    // Never blank-flash: if the live paint image isn't ready, dissolve FROM the baked photo (or, failing
    // that, FROM the target itself) so the previous texture is always visible until the new one fades in.
    guard let from = currentPaintImage() ?? bakedSnapshot ?? target as UIImage? else {
      seedPaintCanvas(target); material.diffuse.contents = currentPaintImage(); return
    }
    let n = CGFloat(Self.paintCanvasSize)
    let fmt = UIGraphicsImageRendererFormat(); fmt.opaque = false; fmt.scale = 1
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: n, height: n), format: fmt)
    let steps = 10
    var step = 0
    dissolveTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] timer in
      guard let self = self, self.cameraMaskActive else { timer.invalidate(); return }
      step += 1
      let f = CGFloat(step) / CGFloat(steps)
      if step >= steps {
        timer.invalidate()
        self.dissolveTimer = nil
        self.seedPaintCanvas(target)
        material.diffuse.contents = self.currentPaintImage()
        return
      }
      let blend = renderer.image { _ in
        from.draw(in: CGRect(x: 0, y: 0, width: n, height: n), blendMode: .normal, alpha: 1)
        target.draw(in: CGRect(x: 0, y: 0, width: n, height: n), blendMode: .normal, alpha: f)
      }
      material.diffuse.contents = blend
    }
  }

  /// Seed the paint canvas with an image (the webcam bake or an SD restyle) so
  /// the camera mask is paintable just like the grey mask.
  private func seedPaintCanvas(_ image: UIImage) {
    guard let cg = image.cgImage else { return }
    let n = Self.paintCanvasSize
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8,
                              bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: n, height: n))
    paintCtx = ctx
  }

  func exportCameraTexture() throws -> String {
    // Export the live paint canvas (webcam/SD + any painted strokes) so the
    // strokes ride along to Stable Diffusion.
    guard let img = currentPaintImage() ?? bakedSnapshot, let data = img.pngData() else {
      throw EmojiArError.snapshotFailed
    }
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = docs.appendingPathComponent("facepaint", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("camera-texture.png")
    try data.write(to: url)
    return url.absoluteString
  }

  /// Affine transform mapping source triangle (s0,s1,s2) → dest triangle
  /// (d0,d1,d2). Used to warp each camera-projected face triangle into its
  /// canonical-UV slot when baking the webcam face texture.
  private func affineFrom(_ s0: CGPoint, _ s1: CGPoint, _ s2: CGPoint,
                          _ d0: CGPoint, _ d1: CGPoint, _ d2: CGPoint) -> CGAffineTransform {
    let sx1 = s1.x - s0.x, sy1 = s1.y - s0.y
    let sx2 = s2.x - s0.x, sy2 = s2.y - s0.y
    let det = sx1 * sy2 - sx2 * sy1
    if abs(det) < 1e-9 { return CGAffineTransform(translationX: d0.x - s0.x, y: d0.y - s0.y) }
    let dx1 = d1.x - d0.x, dy1 = d1.y - d0.y
    let dx2 = d2.x - d0.x, dy2 = d2.y - d0.y
    let a = (dx1 * sy2 - dx2 * sy1) / det
    let c = (-dx1 * sx2 + dx2 * sx1) / det
    let b = (dy1 * sy2 - dy2 * sy1) / det
    let d = (-dy1 * sx2 + dy2 * sx1) / det
    let tx = d0.x - (a * s0.x + c * s0.y)
    let ty = d0.y - (b * s0.x + d * s0.y)
    return CGAffineTransform(a: a, b: b, c: c, d: d, tx: tx, ty: ty)
  }

  // ── Geometry-buffer readers (for the FILLED face topology) ─────────────────
  private func readVec3(_ s: SCNGeometrySource) -> [simd_float3] {
    let count = s.vectorCount, stride = s.dataStride, off = s.dataOffset, bpc = s.bytesPerComponent
    guard count > 0, s.componentsPerVector >= 3, s.data.count >= off + (count - 1) * stride + 3 * bpc else { return [] }
    var out = [simd_float3](repeating: .zero, count: count)
    s.data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      guard let base = raw.baseAddress else { return }
      for i in 0..<count {
        let o = off + i * stride
        out[i] = simd_float3(base.load(fromByteOffset: o, as: Float.self),
                             base.load(fromByteOffset: o + bpc, as: Float.self),
                             base.load(fromByteOffset: o + 2 * bpc, as: Float.self))
      }
    }
    return out
  }

  private func readVec2(_ s: SCNGeometrySource) -> [simd_float2] {
    let count = s.vectorCount, stride = s.dataStride, off = s.dataOffset, bpc = s.bytesPerComponent
    guard count > 0, s.componentsPerVector >= 2, s.data.count >= off + (count - 1) * stride + 2 * bpc else { return [] }
    var out = [simd_float2](repeating: .zero, count: count)
    s.data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      guard let base = raw.baseAddress else { return }
      for i in 0..<count {
        let o = off + i * stride
        out[i] = simd_float2(base.load(fromByteOffset: o, as: Float.self),
                             base.load(fromByteOffset: o + bpc, as: Float.self))
      }
    }
    return out
  }

  private func readIndices(_ e: SCNGeometryElement) -> [Int] {
    let n = e.primitiveCount * 3, bpi = e.bytesPerIndex
    guard n > 0, e.data.count >= n * bpi else { return [] }
    var out = [Int](repeating: 0, count: n)
    e.data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      guard let base = raw.baseAddress else { return }
      for i in 0..<n {
        switch bpi {
        case 2: out[i] = Int(base.load(fromByteOffset: i * 2, as: UInt16.self))
        case 4: out[i] = Int(base.load(fromByteOffset: i * 4, as: UInt32.self))
        default: out[i] = 0
        }
      }
    }
    return out
  }

  // MARK: Events
  let onFacesChanged = EventDispatcher()
  let onSessionReady = EventDispatcher()
  let onArError = EventDispatcher()
  let onModelLoaded = EventDispatcher()

  // MARK: Rigged model state
  private var modelNode: SCNNode?          // the loaded emoji head (carries morphers)
  private var morpherNodes: [SCNNode] = [] // nodes within modelNode that have a morpher
  private var faceAnchorNode: SCNNode?     // node tracking the user's face
  private var trackedFaceCount = 0

  // MARK: - Init
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    arView.delegate = self
    arView.automaticallyUpdatesLighting = true
    arView.autoenablesDefaultLighting = true
    arView.rendersContinuously = true
    arView.antialiasingMode = .multisampling2X
    arView.scene = SCNScene()
    // Let THIS view receive touches (for face-mask painting); the AR view
    // doesn't need its own touch handling.
    arView.isUserInteractionEnabled = false
    addSubview(arView)
    isMultipleTouchEnabled = true
    setupEnvironmentLight()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    arView.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { applyRunState() } else { arView.session.pause() }
  }

  // MARK: - Lighting
  private func setupEnvironmentLight() {
    let ambient = SCNNode()
    ambient.light = SCNLight()
    ambient.light?.type = .ambient
    ambient.light?.intensity = 600
    arView.scene.rootNode.addChildNode(ambient)

    let key = SCNNode()
    key.light = SCNLight()
    key.light?.type = .directional
    key.light?.intensity = 900
    key.eulerAngles = SCNVector3(-Float.pi / 4, Float.pi / 6, 0)
    arView.scene.rootNode.addChildNode(key)
  }

  // MARK: - Session lifecycle
  private func applyRunState() {
    guard window != nil else { return }
    if paused {
      arView.session.pause()
      return
    }
    startSession()
  }

  private func startSession() {
    // Marker so a device log makes it obvious WHICH front-camera scene is open:
    // this is the legacy "Emoji Me" puppet, not the Front Camera mask scene.
    arSwitchLog("LEGACY FaceFilterView (Emoji Me) session start")
    guard ARFaceTrackingConfiguration.isSupported else {
      onArError(["message": "Face tracking is not supported on this device."])
      return
    }
    let config = ARFaceTrackingConfiguration()
    config.isLightEstimationEnabled = true
    config.maximumNumberOfTrackedFaces = 1
    arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    onSessionReady([:])
  }

  // MARK: - Model loading (called from JS prop `modelPath`)
  /// Empty path → drop the current head (back to the plain selfie camera).
  func setModelPath(_ path: String) {
    if path.isEmpty {
      removeModel()
      return
    }
    let url = path.hasPrefix("file://") ? URL(string: path) : URL(fileURLWithPath: path)
    guard let modelUrl = url else {
      onArError(["message": "Bad model path."])
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }
      let loaded = try? SCNScene(url: modelUrl, options: [
        .checkConsistency: false,
      ])
      DispatchQueue.main.async {
        guard let scene = loaded else {
          self.onArError(["message": "Could not load the face model."])
          self.onModelLoaded(["ok": false])
          return
        }
        self.installModel(from: scene.rootNode)
      }
    }
  }

  private func removeModel() {
    modelNode?.removeFromParentNode()
    modelNode = nil
    morpherNodes = []
  }

  private func installModel(from root: SCNNode) {
    removeModel()

    // Wrap so we can scale/position the whole rig without disturbing morphers.
    // The Tripo head already imports facing the camera (front +Z, up +Y), so no
    // rotation is needed — double-sided materials (below) stop the see-through.
    let wrapper = SCNNode()
    for child in root.childNodes { wrapper.addChildNode(child) }

    // Collect every node that carries a morpher (the rig's animatable mesh),
    // and force ALL materials double-sided. Tripo heads ship single-sided, so
    // after we turn the face toward the camera you'd otherwise see THROUGH the
    // front faces to the inside/back of the mesh.
    var morphers: [SCNNode] = []
    wrapper.enumerateHierarchy { node, _ in
      if node.morpher != nil {
        node.morpher?.calculationMode = .normalized
        morphers.append(node)
      }
      if let mats = node.geometry?.materials {
        for m in mats { m.isDoubleSided = false; m.cullMode = .back }   // hide backside at side angles
      }
    }
    morpherNodes = morphers

    // Scale the rig so it reads as a real head (~20 cm tall) and centre it on
    // the face anchor (which sits between the brows/nose). front +Z, up +Y in
    // the rig matches the ARFaceAnchor frame, so no rotation is needed.
    let (minB, maxB) = boundingBox(of: wrapper)
    let height = max(0.0001, maxB.y - minB.y)
    let targetHeight: Float = 0.276     // bigger so the head fully covers the face
    let scale = targetHeight / height
    wrapper.scale = SCNVector3(scale, scale, scale)
    let centerX = (maxB.x + minB.x) * 0.5 * scale
    let centerY = (maxB.y + minB.y) * 0.5 * scale
    let centerZ = (maxB.z + minB.z) * 0.5 * scale
    // Centre on the anchor, then nudge slightly back so it hugs the head.
    wrapper.position = SCNVector3(-centerX, -centerY, -centerZ - 0.02)

    modelNode = wrapper
    if let anchorNode = faceAnchorNode {
      anchorNode.addChildNode(wrapper)
    }
    onModelLoaded(["ok": true])
  }

  /// Recursive AABB of a node hierarchy in the node's own space.
  private func boundingBox(of root: SCNNode) -> (SCNVector3, SCNVector3) {
    var minV = SCNVector3(Float.greatestFiniteMagnitude, Float.greatestFiniteMagnitude, Float.greatestFiniteMagnitude)
    var maxV = SCNVector3(-Float.greatestFiniteMagnitude, -Float.greatestFiniteMagnitude, -Float.greatestFiniteMagnitude)
    var found = false
    root.enumerateHierarchy { node, _ in
      guard node.geometry != nil else { return }
      let (lo, hi) = node.boundingBox
      let corners = [
        SCNVector3(lo.x, lo.y, lo.z), SCNVector3(hi.x, lo.y, lo.z),
        SCNVector3(lo.x, hi.y, lo.z), SCNVector3(hi.x, hi.y, lo.z),
        SCNVector3(lo.x, lo.y, hi.z), SCNVector3(hi.x, lo.y, hi.z),
        SCNVector3(lo.x, hi.y, hi.z), SCNVector3(hi.x, hi.y, hi.z),
      ]
      for c in corners {
        let w = root.convertPosition(node.convertPosition(c, to: root), to: root)
        minV.x = min(minV.x, w.x); minV.y = min(minV.y, w.y); minV.z = min(minV.z, w.z)
        maxV.x = max(maxV.x, w.x); maxV.y = max(maxV.y, w.y); maxV.z = max(maxV.z, w.z)
        found = true
      }
    }
    if !found { return (SCNVector3(-0.1, -0.1, -0.1), SCNVector3(0.1, 0.1, 0.1)) }
    return (minV, maxV)
  }

  // MARK: - ARSCNViewDelegate
  func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
    guard anchor is ARFaceAnchor else { return nil }
    let node = SCNNode()
    DispatchQueue.main.async {
      self.faceAnchorNode = node
      if let model = self.modelNode, model.parent == nil {
        node.addChildNode(model)
      }
      self.applyMask()
      self.trackedFaceCount = 1
      self.onFacesChanged(["count": 1])
    }
    return node
  }

  func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
    guard let faceAnchor = anchor as? ARFaceAnchor else { return }
    // Keep the face-mesh mask deformed to the live face. Both grey AND the
    // webcam mask are ARSCNFaceGeometry(fillMesh:true), so this single path
    // auto-deforms them (and fills eyes/mouth — no holes).
    if let faceGeo = maskNode?.geometry as? ARSCNFaceGeometry {
      faceGeo.update(from: faceAnchor.geometry)
    }
    cameraFadeGeo?.update(from: faceAnchor.geometry)   // keep the crossfade layer skinned
    // Drive morph targets on a loaded rigged head.
    guard !morpherNodes.isEmpty else { return }
    let blendShapes = faceAnchor.blendShapes
    for (key, target) in arkitMapping {
      let loc = ARFaceAnchor.BlendShapeLocation(rawValue: key)
      guard let weight = blendShapes[loc]?.floatValue else { continue }
      let w = CGFloat(weight)
      for mn in morpherNodes {
        mn.morpher?.setWeight(w, forTargetNamed: target)
      }
    }
  }

  func renderer(_ renderer: SCNSceneRenderer, didRemove node: SCNNode, for anchor: ARAnchor) {
    guard anchor is ARFaceAnchor else { return }
    DispatchQueue.main.async {
      if self.faceAnchorNode === node {
        self.faceAnchorNode = nil
        self.modelNode?.removeFromParentNode()
        self.maskNode?.removeFromParentNode()
        self.maskNode = nil
        self.facePlaneNode?.removeFromParentNode()
        self.facePlaneNode = nil
      }
      self.trackedFaceCount = 0
      self.onFacesChanged(["count": 0])
    }
  }

  // MARK: - Face-mesh masks (grey + baked webcam)
  func rebakeMask() { DispatchQueue.main.async { self.applyMask() } }

  private func applyMask() {
    maskNode?.removeFromParentNode()
    maskNode = nil
    cameraMaskMaterial = nil
    cameraMaskActive = false
    bakedMaterial = nil
    bakedSnapshot = nil
    cameraFadeNode?.removeFromParentNode()
    cameraFadeNode = nil
    cameraFadeGeo = nil
    facePlaneNode?.removeFromParentNode()
    facePlaneNode = nil
    guard let anchorNode = faceAnchorNode else { return }

    if maskMode == "camera" {
      // Bake the live webcam onto the face mesh: project each vertex to screen
      // and use the displayed camera image as the texture → the real face wraps
      // the mask correctly (eyes + mouth shown, nothing cut out).
      if let node = bakeWebcamFaceMask() {
        node.renderingOrder = -5
        anchorNode.addChildNode(node)
        maskNode = node
      }
      applyFacePlane()   // big paint plane behind the camera mask too
      return
    }

    guard maskMode == "grey",
          let device = arView.device,
          let faceGeo = ARSCNFaceGeometry(device: device, fillMesh: true) else { return } // fillMesh → eyes+mouth filled
    paintCtx = nil          // discard any camera-mask canvas so grey starts clean
    ensurePaintCanvas()     // fresh grey fill
    loadPaintTexture()      // restore saved grey painting if there is one
    let mat = faceGeo.firstMaterial ?? SCNMaterial()
    mat.isDoubleSided = false; mat.cullMode = .back // hide the mesh backside at extreme side angles
    mat.lightingModel = .blinn                    // strokes stay lit/shaded on the face
    mat.diffuse.contents = currentPaintImage()    // TRANSPARENT paintable canvas (real face shows through)
    mat.specular.contents = UIColor.black         // no full-face sheen on the transparent areas
    mat.transparencyMode = .aOne                  // honour the canvas alpha → only strokes show
    mat.blendMode = .alpha
    mat.writesToDepthBuffer = false
    faceGeo.firstMaterial = mat
    paintMaterial = mat
    let node = SCNNode(geometry: faceGeo)
    node.renderingOrder = -5
    anchorNode.addChildNode(node)
    maskNode = node
    applyFacePlane()   // (re)attach the big face-tracked paint plane behind it
  }

  // MARK: - Paint engine (emoji stamps onto the grey mask's UV canvas)
  private func ensurePaintCanvas() {
    if paintCtx != nil { return }
    let n = Self.paintCanvasSize
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8,
                              bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    // TRANSPARENT canvas — the mask shows the real face through it; only painted
    // strokes are opaque (and get lit by the mask's blinn material).
    ctx.clear(CGRect(x: 0, y: 0, width: n, height: n))
    paintCtx = ctx
  }

  private func currentPaintImage() -> UIImage? {
    guard let img = paintCtx?.makeImage() else { return nil }
    return UIImage(cgImage: img)
  }

  private func refreshPaintTexture() {
    paintMaterial?.diffuse.contents = currentPaintImage()
  }

  private func emojiStampImage(_ emoji: String) -> CGImage? {
    if let c = emojiImageCache[emoji] { return c }
    let side = 128
    let size = CGSize(width: side, height: side)
    let fmt = UIGraphicsImageRendererFormat(); fmt.opaque = false; fmt.scale = 1
    let img = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
      let font = UIFont.systemFont(ofSize: 104)
      let s = emoji as NSString
      let ts = s.size(withAttributes: [.font: font])
      s.draw(at: CGPoint(x: (size.width - ts.width) / 2, y: (size.height - ts.height) / 2),
             withAttributes: [.font: font])
    }
    emojiImageCache[emoji] = img.cgImage
    return img.cgImage
  }

  /// The big paint plane (~1.2m) maps the SAME 1024² canvas as the small face
  /// mask (~0.14m), so an equal-UV stamp is ~8× physically bigger on the plane.
  /// Shrink plane stamps by this so a stroke matches the size it has on the mask.
  private static let planeStampScale: CGFloat = 0.13

  private func stampPaint(atUV uv: CGPoint, into ctx: CGContext?, sizeScale: CGFloat = 1.0, refresh: () -> Void) {
    guard let ctx = ctx, let stamp = emojiStampImage(brushEmoji) else { return }
    let n = CGFloat(Self.paintCanvasSize)
    let r = max(8, paintSizePx) * (n / 768) * sizeScale   // brush px → canvas scale
    let x = uv.x * n
    let y = (1 - uv.y) * n                             // flip V so paint isn't upside-down
    ctx.draw(stamp, in: CGRect(x: x - r / 2, y: y - r / 2, width: r, height: r))
    refresh()
  }

  func clearFacePaint() {
    let n = Self.paintCanvasSize
    if let ctx = paintCtx {
      ctx.clear(CGRect(x: 0, y: 0, width: n, height: n))
      refreshPaintTexture()
    }
    if let pctx = planeCtx {
      pctx.clear(CGRect(x: 0, y: 0, width: n, height: n))
      planeHasPaint = false
      planeMaterial?.diffuse.contents = currentPlaneImage()
    }
  }

  // MARK: - Big face-tracked paint plane
  private func ensurePlaneCanvas() {
    if planeCtx != nil { return }
    let n = Self.paintCanvasSize
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8,
                              bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    ctx.clear(CGRect(x: 0, y: 0, width: n, height: n))   // transparent
    planeCtx = ctx
  }

  private func currentPlaneImage() -> UIImage? {
    guard let img = planeCtx?.makeImage() else { return nil }
    return UIImage(cgImage: img)
  }

  /// A large transparent plane parented to the face anchor, a bit BEHIND the mask,
  /// so painting around the face lands here and it moves with the head.
  private func applyFacePlane() {
    facePlaneNode?.removeFromParentNode()
    facePlaneNode = nil
    guard facePlaneEnabled, let anchorNode = faceAnchorNode else { return }
    ensurePlaneCanvas()
    let plane = SCNPlane(width: 1.2, height: 1.7)   // fills the screen at face depth
    let mat = plane.firstMaterial ?? SCNMaterial()
    mat.isDoubleSided = true
    mat.lightingModel = .blinn                        // strokes shaded like the mask
    mat.diffuse.contents = currentPlaneImage()
    mat.specular.contents = UIColor.black
    mat.transparencyMode = .aOne
    mat.blendMode = .alpha
    mat.writesToDepthBuffer = false
    plane.firstMaterial = mat
    planeMaterial = mat
    let node = SCNNode(geometry: plane)
    node.position = SCNVector3(0, 0.02, -0.055)        // just behind the face, in anchor space
    node.renderingOrder = -8                           // draw behind the mask (-5)
    anchorNode.addChildNode(node)
    facePlaneNode = node
  }

  // MARK: - Reshoot frame-0 in place (no node teardown → no flash)
  func rebakeCameraInPlace() {
    DispatchQueue.main.async {
      guard self.cameraMaskActive, let mat = self.bakedMaterial,
            let frame = self.arView.session.currentFrame,
            let faceAnchor = frame.anchors.compactMap({ $0 as? ARFaceAnchor }).first,
            !faceAnchor.geometry.vertices.isEmpty else { return }
      self.sdStop()
      let texture = self.bakeCanonicalFaceTexture(faceAnchor, frame)
      self.seedPaintCanvas(texture)
      self.bakedSnapshot = texture
      self.sdFrameImages = [texture]
      self.sdCurrentIndex = 0
      mat.diffuse.contents = self.currentPaintImage()
    }
  }

  // MARK: - Native SD-frame playback
  private func loadUIImage(_ path: String) -> UIImage? {
    var raw = path
    if raw.hasPrefix("anim:") { raw = String(raw.dropFirst(5)) }
    let clean = raw.hasPrefix("file://") ? (URL(string: raw)?.path ?? raw) : raw
    return UIImage(contentsOfFile: clean)
  }

  private var sdPingDir = 1   // ping-pong direction (+1 forward, -1 back)

  /// Decode every frame once into memory. Index 0 should be the original bake.
  func sdSetFrames(_ paths: [String]) {
    DispatchQueue.main.async {
      var imgs: [UIImage] = []
      for p in paths { if let i = self.loadUIImage(p) { imgs.append(i) } }
      if imgs.isEmpty, let base = self.bakedSnapshot { imgs = [base] }
      self.sdFrameImages = imgs
      if self.sdCurrentIndex >= imgs.count { self.sdCurrentIndex = 0 }
    }
  }

  /// CUTOUT: keep the (opaque) SD result only where the plane was actually
  /// painted — multiply by the plane canvas alpha (destinationIn), so the SD
  /// restyle stays transparent everywhere it was transparent before.
  private func maskWithPlaneAlpha(_ img: UIImage) -> UIImage {
    guard let maskCG = planeCtx?.makeImage(), let srcCG = img.cgImage else { return img }
    let n = Self.paintCanvasSize
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let out = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8,
                              bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return img }
    let rect = CGRect(x: 0, y: 0, width: n, height: n)
    out.draw(srcCG, in: rect)
    out.setBlendMode(.destinationIn)   // result = SD pixels × plane alpha
    out.draw(maskCG, in: rect)
    guard let res = out.makeImage() else { return img }
    return UIImage(cgImage: res)
  }

  /// Parallel SD frames for the BACKGROUND plane (kept in sync with the mask),
  /// each cut out by the plane's painted-alpha silhouette.
  func sdSetPlaneFrames(_ paths: [String]) {
    DispatchQueue.main.async {
      var imgs: [UIImage] = []
      for p in paths { if let i = self.loadUIImage(p) { imgs.append(self.maskWithPlaneAlpha(i)) } }
      self.planeSdFrameImages = imgs
    }
  }

  /// Show frame `i` on the mask AND (if present) the plane — instant, never hides.
  private func applySdFrame(_ i: Int) {
    if cameraMaskActive, let mat = bakedMaterial, i >= 0, i < sdFrameImages.count {
      mat.diffuse.contents = sdFrameImages[i]
    }
    if let pm = planeMaterial, i >= 0, i < planeSdFrameImages.count {
      pm.diffuse.contents = planeSdFrameImages[i]
    }
  }

  func sdShowFrame(_ index: Int) {
    DispatchQueue.main.async {
      guard !self.sdFrameImages.isEmpty else { return }
      let i = max(0, min(index, self.sdFrameImages.count - 1))
      self.sdCurrentIndex = i
      self.applySdFrame(i)
    }
  }

  func sdPlay(_ fps: Double) {
    DispatchQueue.main.async {
      self.sdStop()
      guard self.cameraMaskActive, self.sdFrameImages.count > 1 else { return }
      let interval = 1.0 / max(1.0, min(fps, 30.0))
      self.sdPingDir = 1
      self.sdPlayTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
        guard let self = self, !self.sdFrameImages.isEmpty else { return }
        let count = self.sdFrameImages.count
        // PING-PONG: bounce back and forth instead of a hard wrap.
        var next = self.sdCurrentIndex + self.sdPingDir
        if next >= count { next = max(0, count - 2); self.sdPingDir = -1 }
        else if next < 0 { next = min(count - 1, 1); self.sdPingDir = 1 }
        self.sdCurrentIndex = next
        self.applySdFrame(next)
      }
    }
  }

  func sdStop() {
    sdPlayTimer?.invalidate()
    sdPlayTimer = nil
    // Seed the paint canvas with the frame we stopped on so painting resumes cleanly.
    if cameraMaskActive, sdCurrentIndex < sdFrameImages.count {
      seedPaintCanvas(sdFrameImages[sdCurrentIndex])
      bakedMaterial?.diffuse.contents = currentPaintImage()
    }
    if let pm = planeMaterial, sdCurrentIndex < planeSdFrameImages.count {
      pm.diffuse.contents = planeSdFrameImages[sdCurrentIndex]
    }
  }

  /// Export the background plane's paint canvas to a PNG (for SD). Returns ""
  /// when nothing was painted on the plane — the restyle then skips it.
  func exportPlaneTexture() throws -> String {
    guard planeHasPaint else { return "" }
    guard let img = planeCtx?.makeImage(), let data = UIImage(cgImage: img).pngData() else {
      throw EmojiArError.snapshotFailed
    }
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = docs.appendingPathComponent("facepaint", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("plane-texture.png")
    try data.write(to: url)
    return url.absoluteString
  }

  /// Write the current paint canvas to a PNG and return the path (persistence).
  func exportFacePaint() throws -> String {
    guard let img = paintCtx?.makeImage(),
          let data = UIImage(cgImage: img).pngData() else {
      throw EmojiArError.snapshotFailed
    }
    // Write to Documents (survives app restarts) under a FIXED name so the
    // grey-mask painting persists and doesn't pile up temp files.
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = docs.appendingPathComponent("facepaint", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("grey-mask.png")
    try data.write(to: url)
    return url.absoluteString
  }

  private func loadPaintTexture() {
    guard !paintTexturePath.isEmpty else { return }
    let url = paintTexturePath.hasPrefix("file://") ? URL(string: paintTexturePath)
                                                    : URL(fileURLWithPath: paintTexturePath)
    guard let u = url, let data = try? Data(contentsOf: u), let ui = UIImage(data: data),
          let cg = ui.cgImage else { return }
    let n = Self.paintCanvasSize
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8,
                              bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: n, height: n))
    paintCtx = ctx
    refreshPaintTexture()
  }

  // MARK: - Touch painting
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    lastSmudgeUV = nil                       // start a fresh smudge stroke
    if !handlePaintTouch(touches) { super.touchesBegan(touches, with: event) }
  }
  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    if !handlePaintTouch(touches) { super.touchesMoved(touches, with: event) }
  }

  @discardableResult
  private func handlePaintTouch(_ touches: Set<UITouch>) -> Bool {
    guard paintEnabled, (maskMode == "grey" || maskMode == "camera"),
          let touch = touches.first else { return false }
    let p = touch.location(in: arView)
    // Hit-test all paintable nodes; the CLOSEST one wins → touches on the face
    // hit the mask, touches around it hit the big face-tracked plane behind it.
    let hits = arView.hitTest(p, options: [SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue])
    let maskHit = hits.first(where: { $0.node === maskNode })
    let planeHit = hits.first(where: { $0.node === facePlaneNode })
    // "all" is sorted nearest→farthest, so whichever appears first is closer.
    let hit = [maskHit, planeHit].compactMap { $0 }.min(by: { a, b in
      (hits.firstIndex(where: { $0 === a }) ?? .max) < (hits.firstIndex(where: { $0 === b }) ?? .max)
    })
    guard let hit = hit else { return false }
    let uv = hit.textureCoordinates(withMappingChannel: 0)
    let onPlane = hit.node === facePlaneNode
    if paintMode == "smudge" && !onPlane {
      smudge(from: lastSmudgeUV ?? uv, to: uv)   // smudge is mask-only for now
      lastSmudgeUV = uv
    } else if onPlane {
      planeHasPaint = true
      stampPaint(atUV: uv, into: planeCtx, sizeScale: Self.planeStampScale) { [weak self] in
        self?.planeMaterial?.diffuse.contents = self?.currentPlaneImage()
      }
    } else {
      stampPaint(atUV: uv, into: paintCtx) { [weak self] in self?.refreshPaintTexture() }
    }
    return true
  }

  /// The picked emoji's alpha silhouette rasterized at the brush radius — the
  /// smudge footprint (mirrors the main workspace where the smudge follows the
  /// emoji shape). Falls back to a radial-falloff disc if rendering fails.
  private func smudgeAlphaMask(rad: Int) -> [UInt8] {
    let side = rad * 2 + 1
    if let c = smudgeMaskCache, c.key == brushEmoji, c.rad == rad { return c.mask }
    var mask = [UInt8](repeating: 0, count: side * side)
    var usedEmoji = false
    if let stamp = emojiStampImage(brushEmoji) {
      let cs = CGColorSpaceCreateDeviceRGB()
      if let mctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
                              bytesPerRow: side * 4, space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
        mctx.draw(stamp, in: CGRect(x: 0, y: 0, width: side, height: side))
        if let mdata = mctx.data {
          let src = mdata.bindMemory(to: UInt8.self, capacity: side * side * 4)
          for i in 0..<(side * side) { mask[i] = src[i * 4 + 3] }   // alpha channel
          usedEmoji = true
        }
      }
    }
    if !usedEmoji {
      for dy in 0..<side {
        for dx in 0..<side {
          let ox = dx - rad, oy = dy - rad
          let d = (Double(ox * ox + oy * oy)).squareRoot()
          mask[dy * side + dx] = d >= Double(rad) ? 0 : UInt8(255.0 * (1 - d / Double(rad)))
        }
      }
    }
    smudgeMaskCache = (brushEmoji, rad, mask)
    return mask
  }

  /// Finger-smudge the paint canvas: DIRECTIONAL TEXTURE DRAG — for every dab
  /// along the drag, copy the pixel patch from BEHIND the cursor (offset back
  /// along the motion by the carry reach) and blend it forward through the
  /// emoji-shaped mask. This TRANSPORTS the real texture (webcam/strokes) like
  /// the main workspace's directional-carry smudge — it never averages to a
  /// single colour (the old v1 did, which showed up as a flat white circle on
  /// bright camera-mask pixels). Slider (`smudgeStrength`) = carry reach.
  private func smudge(from a: CGPoint, to b: CGPoint) {
    let t0 = Date()
    guard let ctx = paintCtx, let base = ctx.data else { return }
    let n = Self.paintCanvasSize
    let bpr = ctx.bytesPerRow
    let buf = base.bindMemory(to: UInt8.self, capacity: bpr * n)
    // brush radius in canvas px (capped so the CPU pass stays responsive)
    let r = min(max(8, paintSizePx) * (CGFloat(n) / 768), 150)
    let rad = max(2, Int(r / 2))
    let side = rad * 2 + 1
    let ax = a.x * CGFloat(n), ay = (1 - a.y) * CGFloat(n)
    let bx = b.x * CGFloat(n), by = (1 - b.y) * CGFloat(n)
    var dxn = bx - ax, dyn = by - ay
    let dist = hypot(dxn, dyn)
    if dist < 0.5 { return }               // smudge needs motion — no dab on a still tap
    dxn /= dist; dyn /= dist
    let strength = Double(max(0.05, min(smudgeStrength, 0.98)))
    // Carry reach: how far behind the cursor we pull pixels from (slider-scaled).
    let reach = max(1.0, CGFloat(rad) * CGFloat(0.35 + strength * 0.9))
    // Per-dab deposit amount — higher strength lays the dragged texture down harder.
    let blend = 0.5 + strength * 0.4
    let mask = smudgeAlphaMask(rad: rad)
    let steps = max(1, min(Int(dist / max(1, CGFloat(rad) * 0.35)), 64))
    if smudgeScratch.count < side * side * 4 {
      smudgeScratch = [UInt8](repeating: 0, count: side * side * 4)
    }
    func ci(_ v: Int, _ hi: Int) -> Int { return v < 0 ? 0 : (v > hi ? hi : v) }
    for s in 1...steps {
      let t = CGFloat(s) / CGFloat(steps)
      let cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t
      let sxc = cx - dxn * reach, syc = cy - dyn * reach   // source patch centre (behind)
      let cxi = Int(cx), cyi = Int(cy)
      let sxi = Int(sxc), syi = Int(syc)
      smudgeScratch.withUnsafeMutableBufferPointer { scratch in
        // 1) copy the source patch first — never read pixels this dab just wrote
        for my in 0..<side {
          let sy = ci(syi - rad + my, n - 1)
          let rowBase = sy * bpr
          for mx in 0..<side {
            let sx = ci(sxi - rad + mx, n - 1)
            let so = rowBase + sx * 4
            let mo = (my * side + mx) * 4
            scratch[mo] = buf[so]; scratch[mo + 1] = buf[so + 1]
            scratch[mo + 2] = buf[so + 2]; scratch[mo + 3] = buf[so + 3]
          }
        }
        // 2) lay the dragged patch down through the emoji-shaped footprint
        for my in 0..<side {
          let py = cyi - rad + my
          if py < 0 || py >= n { continue }
          let rowBase = py * bpr
          for mx in 0..<side {
            let px = cxi - rad + mx
            if px < 0 || px >= n { continue }
            let m = Double(mask[my * side + mx]) / 255.0
            if m < 0.02 { continue }
            let f = m * blend
            let g = 1 - f
            let o = rowBase + px * 4
            let mo = (my * side + mx) * 4
            buf[o]     = UInt8(Double(buf[o])     * g + Double(scratch[mo])     * f)
            buf[o + 1] = UInt8(Double(buf[o + 1]) * g + Double(scratch[mo + 1]) * f)
            buf[o + 2] = UInt8(Double(buf[o + 2]) * g + Double(scratch[mo + 2]) * f)
            buf[o + 3] = UInt8(Double(buf[o + 3]) * g + Double(scratch[mo + 3]) * f)
          }
        }
      }
    }
    refreshPaintTexture()
    NSLog("[FaceSmudge] drag dt=%.1fms r=%d steps=%d reach=%.0f mask=%@",
          Date().timeIntervalSince(t0) * 1000, rad, steps, reach, maskMode)
  }

  /// Build the webcam (textured) mask. It is an ARSCNFaceGeometry(fillMesh:true)
  /// — identical mechanism to the grey mask (eyes/mouth FILLED, auto-deforms) —
  /// textured with the live camera BAKED into the canonical face UV layout. That
  /// canonical texture is square + aspect-stable, so an SD restyle of it re-maps
  /// onto the face 1:1.
  private func bakeWebcamFaceMask() -> SCNNode? {
    guard let frame = arView.session.currentFrame,
          let faceAnchor = frame.anchors.compactMap({ $0 as? ARFaceAnchor }).first,
          let device = arView.device,
          let faceGeo = ARSCNFaceGeometry(device: device, fillMesh: true) else { return nil }
    guard !faceAnchor.geometry.vertices.isEmpty else { return nil }
    let texture = bakeCanonicalFaceTexture(faceAnchor, frame)
    // The camera mask is a PAINT CANVAS seeded with the webcam — so you can
    // paint on top of it (and the strokes ride along to SD on restyle).
    seedPaintCanvas(texture)
    let mat = faceGeo.firstMaterial ?? SCNMaterial()
    mat.isDoubleSided = false; mat.cullMode = .back // hide the mesh backside at extreme side angles
    mat.lightingModel = .constant
    mat.diffuse.contents = currentPaintImage()
    mat.diffuse.wrapS = .clamp
    mat.diffuse.wrapT = .clamp
    // Honour the texture's alpha: the backdrop is transparent (no grey) and the
    // edges are feathered, so the mask blends into the real face.
    mat.transparencyMode = .aOne
    mat.blendMode = .alpha
    mat.writesToDepthBuffer = false
    faceGeo.firstMaterial = mat
    faceGeo.update(from: faceAnchor.geometry)   // initial skin
    bakedMaterial = mat
    paintMaterial = mat                         // painting refreshes THIS material
    bakedSnapshot = texture
    cameraMaskActive = true
    applyCameraOverlay()                        // keep an active SD overlay across re-bakes
    return SCNNode(geometry: faceGeo)
  }

  /// Rasterize the live camera image into the canonical face UV layout (1024²):
  /// for each face triangle, warp the camera-projected screen triangle into its
  /// canonical-UV triangle (affine + clip). The backdrop is TRANSPARENT (no grey
  /// fill) so anything outside the face is a hole, and the whole thing gets a
  /// light blur so the mask edges feather into the real face for a softer look.
  private func bakeCanonicalFaceTexture(_ faceAnchor: ARFaceAnchor, _ frame: ARFrame) -> UIImage {
    let geo = faceAnchor.geometry
    let anchorT = faceAnchor.transform
    let orientation = window?.windowScene?.interfaceOrientation ?? .portrait
    let viewSize = bounds.size
    let snapshot = arView.snapshot()

    // Prefer the FILLED face topology (its triangles cover the eyes + mouth) so
    // those regions are TEXTURED with the live camera, not left as holes. Read
    // its own verts/uvs/indices; fall back to the raw (holey) geometry if the
    // filled buffers aren't CPU-readable.
    var verts: [simd_float3] = []
    var uvs: [simd_float2] = []
    var tris: [Int] = []
    if let device = arView.device,
       let fillGeo = ARSCNFaceGeometry(device: device, fillMesh: true) {
      fillGeo.update(from: geo)
      if let vs = fillGeo.sources(for: .vertex).first,
         let ts = fillGeo.sources(for: .texcoord).first,
         let el = fillGeo.elements.first {
        let v = readVec3(vs), u = readVec2(ts), idx = readIndices(el)
        if !v.isEmpty, v.count == u.count, !idx.isEmpty {
          verts = v; uvs = u; tris = idx
        }
      }
    }
    if verts.isEmpty {
      verts = geo.vertices.map { simd_float3($0.x, $0.y, $0.z) }
      uvs = geo.textureCoordinates.map { simd_float2($0.x, $0.y) }
      tris = geo.triangleIndices.map { Int($0) }
    }

    // Project every vertex to screen (points, top-left origin — UIKit space).
    var screen = [CGPoint](repeating: .zero, count: verts.count)
    for i in 0..<verts.count {
      let v = verts[i]
      let world = anchorT * simd_float4(v.x, v.y, v.z, 1)
      let sp = frame.camera.projectPoint(simd_float3(world.x, world.y, world.z),
                                         orientation: orientation, viewportSize: viewSize)
      screen[i] = sp
    }

    let n = CGFloat(Self.paintCanvasSize)
    // Face bounding box in screen + UV space → a COARSE base that stretches the
    // whole webcam over the face region. This guarantees the eyes + mouth (which
    // the precise mesh leaves as holes) are filled with the ACTUAL webcam, never
    // white. The precise triangles draw on top for an accurate face.
    let sxs = screen.map { $0.x }, sys = screen.map { $0.y }
    let uxs = uvs.map { CGFloat($0.x) }, uys = uvs.map { CGFloat($0.y) }
    let coarse: (sMinX: CGFloat, sMinY: CGFloat, scaleX: CGFloat, scaleY: CGFloat, rect: CGRect)? = {
      guard let sMinX = sxs.min(), let sMaxX = sxs.max(), let sMinY = sys.min(), let sMaxY = sys.max(),
            let uMinX = uxs.min(), let uMaxX = uxs.max(), let uMinY = uys.min(), let uMaxY = uys.max(),
            sMaxX - sMinX > 1, sMaxY - sMinY > 1 else { return nil }
      let rect = CGRect(x: uMinX * n, y: uMinY * n, width: (uMaxX - uMinX) * n, height: (uMaxY - uMinY) * n)
      return (sMinX, sMinY, rect.width / (sMaxX - sMinX), rect.height / (sMaxY - sMinY), rect)
    }()

    let fmt = UIGraphicsImageRendererFormat(); fmt.opaque = false; fmt.scale = 1  // transparent
    let baked = UIGraphicsImageRenderer(size: CGSize(width: n, height: n), format: fmt).image { rc in
      let cg = rc.cgContext
      let drawRect = CGRect(origin: .zero, size: viewSize)

      // 1) Coarse base (fills eyes/mouth holes with webcam).
      if let c = coarse {
        cg.saveGState()
        cg.clip(to: c.rect)
        cg.translateBy(x: c.rect.minX, y: c.rect.minY)
        cg.scaleBy(x: c.scaleX, y: c.scaleY)
        cg.translateBy(x: -c.sMinX, y: -c.sMinY)
        snapshot.draw(in: drawRect)
        cg.restoreGState()
      }

      // 2) Precise per-triangle face on top.
      var t = 0
      while t + 2 < tris.count {
        let i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2]; t += 3
        guard i0 < verts.count, i1 < verts.count, i2 < verts.count else { continue }
        let d0 = CGPoint(x: CGFloat(uvs[i0].x) * n, y: CGFloat(uvs[i0].y) * n)
        let d1 = CGPoint(x: CGFloat(uvs[i1].x) * n, y: CGFloat(uvs[i1].y) * n)
        let d2 = CGPoint(x: CGFloat(uvs[i2].x) * n, y: CGFloat(uvs[i2].y) * n)
        let s0 = screen[i0], s1 = screen[i1], s2 = screen[i2]
        cg.saveGState()
        cg.beginPath()
        cg.move(to: d0); cg.addLine(to: d1); cg.addLine(to: d2); cg.closePath()
        cg.clip()
        cg.concatenate(affineFrom(s0, s1, s2, d0, d1, d2))
        snapshot.draw(in: drawRect)
        cg.restoreGState()
      }
    }
    // Feather only the outer border alpha (texture stays sharp).
    return featherEdges(baked, radius: 9) ?? baked
  }

  /// Composite a heavily-blurred copy UNDER the sharp bake so transparent
  /// interior holes (eyes/mouth) are filled by their blurred surroundings.
  private func fillHoles(_ image: UIImage) -> UIImage {
    guard let blurred = heavyBlur(image, radius: 22) else { return image }
    let n = CGFloat(Self.paintCanvasSize)
    let fmt = UIGraphicsImageRendererFormat(); fmt.opaque = false; fmt.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: n, height: n), format: fmt).image { _ in
      blurred.draw(in: CGRect(x: 0, y: 0, width: n, height: n))   // fills the holes
      image.draw(in: CGRect(x: 0, y: 0, width: n, height: n))     // sharp face on top
    }
  }

  private func heavyBlur(_ image: UIImage, radius: CGFloat) -> UIImage? {
    guard let cg = image.cgImage else { return nil }
    let ci = CIImage(cgImage: cg)
    guard let f = CIFilter(name: "CIGaussianBlur") else { return nil }
    f.setValue(ci.clampedToExtent(), forKey: kCIInputImageKey)   // spread neighbours INTO holes
    f.setValue(radius, forKey: kCIInputRadiusKey)
    guard let out = f.outputImage?.cropped(to: ci.extent) else { return nil }
    let ctx = CIContext(options: nil)
    guard let cgOut = ctx.createCGImage(out, from: ci.extent) else { return nil }
    return UIImage(cgImage: cgOut)
  }

  /// Keep the texture SHARP but feather ONLY the alpha at the mask border so the
  /// last bit of the edge fades smoothly into the real face. RGB is untouched
  /// (foreground), the alpha comes from a blurred copy of the coverage.
  private func featherEdges(_ image: UIImage, radius: CGFloat) -> UIImage? {
    guard let cg = image.cgImage else { return nil }
    let sharp = CIImage(cgImage: cg)
    guard let blur = CIFilter(name: "CIGaussianBlur") else { return nil }
    blur.setValue(sharp, forKey: kCIInputImageKey)
    blur.setValue(radius, forKey: kCIInputRadiusKey)
    guard let blurred = blur.outputImage?.cropped(to: sharp.extent) else { return nil }
    // Sharp RGB (foreground) over transparent, masked by the BLURRED alpha →
    // crisp interior, feathered border.
    guard let blend = CIFilter(name: "CIBlendWithAlphaMask") else { return nil }
    blend.setValue(sharp, forKey: kCIInputImageKey)
    blend.setValue(CIImage(color: CIColor.clear).cropped(to: sharp.extent), forKey: kCIInputBackgroundImageKey)
    blend.setValue(blurred, forKey: "inputMaskImage")
    guard let out = blend.outputImage else { return nil }
    let ctx = CIContext(options: nil)
    guard let cgOut = ctx.createCGImage(out, from: sharp.extent) else { return nil }
    return UIImage(cgImage: cgOut)
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    onArError(["message": error.localizedDescription])
  }

  // MARK: - Capture
  /// The plain front-camera selfie (used for upload). When no model is loaded
  /// this is just the camera image as displayed.
  func captureSelfie() throws -> String {
    let image = arView.snapshot()
    guard let data = image.jpegData(compressionQuality: 0.85) else {
      throw EmojiArError.snapshotFailed
    }
    let filename = "face-selfie-\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
    let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(filename)
    try data.write(to: url)
    return url.absoluteString
  }

  /// The composed puppet view (camera + emoji head) as a PNG.
  func snapshotToTmpFile() throws -> String {
    let image = arView.snapshot()
    return try writeSnapshotToTmp(image)
  }
}
