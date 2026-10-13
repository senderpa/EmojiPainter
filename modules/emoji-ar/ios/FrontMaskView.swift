import ARKit
import CoreImage
import ExpoModulesCore
import SceneKit
import UIKit
import simd

/// Scene-switch tracing shared by the AR wall, the front mask and the legacy
/// face scenes. Compiled out of Release builds, so the shipping app is silent
/// while a Debug build on a device still prints the full switch trace.
@inline(__always)
func arSwitchLog(_ message: @autoclosure () -> String) {
  #if DEBUG
  NSLog("[ARSwitch] %@", message())
  #endif
}

/// AR Draw's Front Camera / Mask Mode, isolated from EmojiPainter's existing
/// FaceFilterView. It keeps AR Draw's face-local mask architecture while adding
/// EmojiPainter glyph stamps beside the original Spray, Relief and Texture
/// tools.
final class FrontMaskView: ExpoView, ARSCNViewDelegate, SCNSceneRendererDelegate {
  private let arView = ARSCNView()

  let onSessionReady = EventDispatcher()
  let onFaceChanged = EventDispatcher()
  let onHistoryChanged = EventDispatcher()
  /// A new finger gesture produced committed paint. Loading, undoing and
  /// redoing masks never emits this event.
  let onStrokeCommitted = EventDispatcher()
  let onMasksChanged = EventDispatcher()
  let onMaskLoaded = EventDispatcher()
  let onColorPicked = EventDispatcher()
  let onFreePlaneLocked = EventDispatcher()
  let onArError = EventDispatcher()

  var paused = false { didSet { applyRunState() } }
  var brushSizeMeters: CGFloat = 0.092 { didSet { applySprayScale() } }
  var brushColor = UIColor(red: 1, green: 0.22, blue: 0.48, alpha: 1) {
    didSet { updatePaintAppearance() }
  }
  var brushMode = "spray" { didSet { updatePaintAppearance() } }
  var brushEmoji = "😀"
  var brushMirrorX = false
  var brushMirrorY = false
  var brushRotationDegrees: Double = 0
  var brushSpacing: CGFloat = 0.18
  var eyedropperEnabled = false
  var sprayCanEnabled = true { didSet { updateCanVisibility() } }
  var gridEnabled = false { didSet { faceGridNode?.isHidden = !gridEnabled } }
  var cameraTextureEnabled = false {
    didSet {
      updateFaceMaskVisibility()
      lastCameraTextureTime = 0
    }
  }
  var textureTarget = "auto"
  var textureLineStyle = "clean"
  var textureNormalEnabled = false
  /// Free Mode: marks are released into the space around the tracked head
  /// instead of being welded onto the face mesh or a paint plane.
  var freeModeEnabled = false

  private static let surfaceCategory = 1 << 21
  fileprivate static let paintCategory = 1 << 22
  private static let surfaceLift: Float = 0.0015
  private static let separationStep: Float = 0.0001
  private static let separationCycle = 24
  private static let decalScale: CGFloat = 0.4 * 0.67
  private static let areaToolScale: CGFloat = 0.62 * 0.67
  private static let minDecalSize: CGFloat = 0.006
  private static let maxDecalSize: CGFloat = 0.07
  private static let maxAreaToolSize: CGFloat = 0.26
  private static let faceAtlasSide = 1024
  private static let mergedSurfaceSide = 640
  private static let mergedSurfaceSpan: CGFloat = 0.34
  // Plane targets are painted at arm's length, so one tile covers more metres.
  // The pixels-per-metre stays close to the face tile (1882 vs 1536) which is
  // what keeps Texture/Relief quality identical off the mask.
  private static let mergedPlaneSide = 768
  private static let mergedPlaneSpan: CGFloat = 0.5
  private static let freeDepthSpread: Float = 0.075
  private static let canRenderOrder = 100_000
  private static let ciContext = CIContext(options: nil)
  private static let colorSampleContext = CIContext(options: [.cacheIntermediates: false])

  private weak var faceNode: SCNNode?
  private weak var faceMaskNode: SCNNode?
  private weak var faceGridNode: SCNNode?
  private weak var faceMaskMaterial: SCNMaterial?
  private var lastFaceGeometry: ARFaceGeometry?
  private var trackedFace = false
  private var lastCameraTextureTime: TimeInterval = 0
  private var cachedCameraFrame: (image: CGImage, time: TimeInterval)?

  // AR Draw freezes the live screen projection into the face's stable UV atlas
  // on the first face stroke. This is what makes the webcam skin itself follow
  // expressions instead of swimming across the mesh.
  private var faceCanvasImage: CGImage?
  private var faceCanvasBase: CGImage?
  private var faceCanvasFrozen = false

  private struct FaceMaskBakeMesh {
    let positions: [SIMD3<Float>]
    let uvs: [CGPoint]
    let indices: [Int]
  }

  /// Every decal lives under this node, never directly under the face anchor.
  /// ARKit drops and re-creates the ARFaceAnchor whenever tracking restarts
  /// (which is exactly what a fast AR ⇄ Front switch does). Re-parenting one
  /// root instead of walking the stroke arrays keeps painting, history and the
  /// bound-mark dictionaries intact across that churn.
  private let paintRoot: SCNNode = {
    let node = SCNNode()
    node.name = "frontMaskPaintRoot"
    return node
  }()

  private var strokes: [[SCNNode]] = []
  private var redoStrokes: [[SCNNode]] = []
  private var activeStroke: [SCNNode] = []
  private var bindings: [ObjectIdentifier: FrontMaskFaceBinding] = [:]
  private var surfaces: [ObjectIdentifier: String] = [:]
  private var colors: [ObjectIdentifier: UIColor] = [:]
  private var styles: [ObjectIdentifier: String] = [:]
  private var texturePayloads: [ObjectIdentifier: Data] = [:]
  private var normalPayloads: [ObjectIdentifier: Data] = [:]
  private var lastLocalPoint: SIMD3<Float>?
  private var lastLocalNormal: SIMD3<Float>?
  private var lastScreenPoint: CGPoint?
  private var markCounter = 0
  private var isPainting = false
  private var activeAreaSurface: MergedAreaStrokeSurface?
  /// One frozen camera frame per Texture/Relief drag, shared by every tile of
  /// that drag so a long stroke stays visually continuous.
  private var activeStrokeSource: CGImage?
  private var autosaveWork: DispatchWorkItem?
  private var activeMaskID: UUID?
  /// Set when we resume with no paint in memory but an autosave on disk.
  private var pendingAutosaveRestore = false

  // Single-finger painting, two/three-finger history gestures. The painting
  // touch is tracked by identity so a second finger can never be mistaken for
  // a brush move.
  private weak var paintingTouch: UITouch?
  private var gestureActive = false
  private var gestureMaxTouches = 0
  private var gestureStartTime: TimeInterval = 0
  private var gestureTravel: CGFloat = 0
  private var strokeStartTime: TimeInterval = 0
  private static let gestureTapWindow: TimeInterval = 0.6
  private static let gestureTapSlop: CGFloat = 16
  /// Extra fingers landing later than this into a drag are a resting hand, not
  /// a tap — the stroke keeps going and history is left alone.
  private static let gestureJoinWindow: TimeInterval = 0.3

  // Free Mode locks ONE camera-parallel plane at touch-down and paints the whole
  // stroke on it — a moving depth made the marks wave about in the air.
  private var freePlaneOrigin: SIMD3<Float>?
  private var freePlaneNormal: SIMD3<Float>?
  private var freeAxesNode: SCNNode?

  // AR Draw treats loading a mask as a transformation: the tracked head spins
  // once while the saved paint is progressively revealed. Keeping the timing
  // in a state machine also makes rapid mask switching interruption-safe.
  private let maskTransition = FaceMaskTransitionController()
  private var maskTransitionPieces: [SCNNode] = []
  private var maskTransitionRevealed = 0
  private var maskSpinAngle: Float = 0
  private var maskBackdropRest: simd_float4x4?

  private var textureCache: [String: UIImage] = [:]
  private var materialCache: [String: SCNMaterial] = [:]
  private var geometryCache: [String: SCNPlane] = [:]

  private var sprayCanNode: SCNNode?
  private weak var sprayHeadNode: SCNNode?
  private weak var sprayNozzleNode: SCNNode?
  private weak var labelMaterial: SCNMaterial?
  private var sprayParticles: SCNParticleSystem?
  private var sprayHeadRestY: Float = 0
  private var sprayHeadPressDepth: Float = 0.002
  private var canTopY: Float = 0.07
  private var toolTarget: SIMD3<Float>?
  private var toolNormal = SIMD3<Float>(0, 0, 1)

  // ARSCNView invokes its delegate on a SceneKit render queue while UIKit
  // touch handlers mutate paint state on the main queue. Coalesce the render
  // callbacks and perform every paint/binding mutation on main; this removes
  // the Dictionary data race found in the device crash reports.
  private let rendererCallbackLock = NSLock()
  private var pendingBindingGeometry: ARFaceGeometry?
  private var bindingUpdateQueued = false
  private var rendererTickQueued = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    arView.delegate = self
    arView.scene = SCNScene()
    arView.scene.rootNode.name = "frontMaskScene"
    arView.automaticallyUpdatesLighting = true
    arView.autoenablesDefaultLighting = true
    arView.rendersContinuously = true
    arView.antialiasingMode = .multisampling2X
    arView.isUserInteractionEnabled = false
    arView.scene.rootNode.categoryBitMask = 1
    addSubview(arView)
    // Needed for the two/three-finger history taps; painting still tracks a
    // single touch by identity.
    isMultipleTouchEnabled = true
    setupLighting()
    setupSprayCan()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    arView.frame = bounds
  }

  deinit {
    // Same tell as the AR scene: a deinit during a switch means the view was
    // torn down and the paint went with it.
    arSwitchLog("front view DEINIT — mask scene destroyed")
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    arSwitchLog("front didMoveToWindow window=\(window != nil) paused=\(paused) strokes=\(strokes.count)")
    if window == nil {
      autosave(force: true)
      arView.session.pause()
    } else {
      applyRunState()
    }
  }

  private func setupLighting() {
    let ambient = SCNNode()
    ambient.light = SCNLight()
    ambient.light?.type = .ambient
    ambient.light?.intensity = 650
    arView.scene.rootNode.addChildNode(ambient)
    let key = SCNNode()
    key.light = SCNLight()
    key.light?.type = .directional
    key.light?.intensity = 850
    key.eulerAngles = SCNVector3(-Float.pi / 4, Float.pi / 6, 0)
    arView.scene.rootNode.addChildNode(key)
  }

  private func applyRunState() {
    arSwitchLog("front paused=\(paused) window=\(window != nil) strokes=\(strokes.count) marks=\(strokes.reduce(0) { $0 + $1.count })")
    // Pausing must happen even if the view is off-window: the AR scene's world
    // session needs the camera the moment we switch away from here.
    if paused {
      autosave(force: true)
      arView.session.pause()
      return
    }
    guard window != nil else { return }
    // Nothing in memory but an autosave on disk means this view was rebuilt
    // (or the paint was lost some other way) — bring the mask back rather than
    // showing the user an empty face.
    pendingAutosaveRestore = strokes.isEmpty && FrontMaskPaintStore.shared.autosave != nil
    startSession()
  }

  private func startSession() {
    guard ARFaceTrackingConfiguration.isSupported else {
      onArError(["message": "Front-camera face tracking is not supported on this device."])
      return
    }
    let configuration = ARFaceTrackingConfiguration()
    configuration.isLightEstimationEnabled = true
    configuration.maximumNumberOfTrackedFaces = 1
    // Face anchors mean nothing across a pause, so always start clean (this is
    // what Apple's face-tracking sample does). Safe because the painting lives
    // in `paintRoot`, which is re-attached to whatever anchor shows up next —
    // resuming can no longer cost the user their mask.
    arView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    onSessionReady([:])
  }

  // MARK: Face installation + live projection

  func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
    guard let faceAnchor = anchor as? ARFaceAnchor else { return nil }
    let node = SCNNode()
    installFace(on: node, anchor: faceAnchor)
    DispatchQueue.main.async { [weak self] in
      self?.trackedFace = true
      self?.onFaceChanged(["count": 1])
    }
    return node
  }

  private func installFace(on node: SCNNode, anchor: ARFaceAnchor) {
    guard let device = arView.device,
          let hitGeometry = ARSCNFaceGeometry(device: device, fillMesh: true) else { return }
    let hitMaterial = hitGeometry.firstMaterial!
    hitMaterial.colorBufferWriteMask = []
    hitMaterial.writesToDepthBuffer = true
    hitMaterial.readsFromDepthBuffer = true
    hitMaterial.isDoubleSided = false
    node.geometry = hitGeometry
    node.name = "faceHitMesh"
    node.renderingOrder = -5
    node.categoryBitMask = Self.surfaceCategory
    faceNode = node
    lastFaceGeometry = anchor.geometry

    if let maskGeometry = ARSCNFaceGeometry(device: device, fillMesh: true) {
      maskGeometry.update(from: anchor.geometry)
      let material = maskGeometry.firstMaterial!
      material.lightingModel = .constant
      material.blendMode = .alpha
      material.isDoubleSided = false
      material.writesToDepthBuffer = false
      material.readsFromDepthBuffer = false
      if faceCanvasFrozen, let image = faceCanvasImage {
        material.diffuse.contents = image
        material.shaderModifiers = nil
      } else {
        material.diffuse.contents = UIColor(white: 0.92, alpha: 1)
        applyFaceCameraProjection(to: material)
      }
      material.transparency = cameraTextureEnabled ? 1 : 0
      let mask = SCNNode(geometry: maskGeometry)
      mask.name = "faceMaskVisual"
      mask.renderingOrder = -4
      mask.castsShadow = false
      node.addChildNode(mask)
      faceMaskNode = mask
      faceMaskMaterial = material
    }

    if let gridGeometry = ARSCNFaceGeometry(device: device) {
      gridGeometry.update(from: anchor.geometry)
      let material = SCNMaterial()
      material.lightingModel = .constant
      material.fillMode = .lines
      material.diffuse.contents = UIColor.systemCyan.withAlphaComponent(0.5)
      material.writesToDepthBuffer = false
      material.readsFromDepthBuffer = false
      gridGeometry.firstMaterial = material
      let grid = SCNNode(geometry: gridGeometry)
      grid.name = "faceMaskGrid"
      grid.renderingOrder = -3
      grid.isHidden = !gridEnabled
      node.addChildNode(grid)
      faceGridNode = grid
    }

    let backdropGeometry = SCNPlane(width: 3.2, height: 3.6)
    let backdropMaterial = SCNMaterial()
    backdropMaterial.colorBufferWriteMask = []
    backdropMaterial.writesToDepthBuffer = true
    backdropMaterial.readsFromDepthBuffer = true
    backdropMaterial.isDoubleSided = true
    backdropGeometry.firstMaterial = backdropMaterial
    let backdrop = SCNNode(geometry: backdropGeometry)
    backdrop.name = "faceBackdrop"
    backdrop.simdPosition = SIMD3<Float>(0, 0, -0.12)
    backdrop.renderingOrder = -6
    backdrop.categoryBitMask = Self.surfaceCategory
    node.addChildNode(backdrop)

    sprayParticles?.colliderNodes = [node, backdrop]
    DispatchQueue.main.async { [weak self, weak node] in
      guard let self, let node else { return }
      // The paint root carries the whole painting; re-parenting it restores
      // every committed stroke at once, in face-local space, with no history
      // side effects. The transform is reset because every decal is stored in
      // face-local coordinates (the root parks in world space while untracked).
      self.paintRoot.removeFromParentNode()
      self.paintRoot.simdTransform = matrix_identity_float4x4
      node.addChildNode(self.paintRoot)
      self.reattachOrphanedPaint()
      arSwitchLog("front face anchor installed — strokes=\(self.strokes.count) marks=\(self.strokes.reduce(0) { $0 + $1.count })")
      // A rebuilt view has a face again: put the autosaved mask back on it.
      if self.pendingAutosaveRestore, self.strokes.isEmpty {
        self.pendingAutosaveRestore = false
        let restored = (try? self.resumeAutosave()) ?? 0
        arSwitchLog("front restored autosave marks=\(restored)")
      }
    }
  }

  private func applyFaceCameraProjection(to material: SCNMaterial) {
    material.shaderModifiers = [.geometry: """
      vec4 clipPosition = u_modelViewProjectionTransform * _geometry.position;
      vec2 ndc = clipPosition.xy / max(clipPosition.w, 0.0001);
      _geometry.texcoords[0] = vec2(1.0 - (ndc.x + 1.0) * 0.5,
                                    (1.0 - ndc.y) * 0.5);
      """]
  }

  private func updateFaceMaskVisibility() {
    guard let material = faceMaskMaterial else { return }
    material.transparency = cameraTextureEnabled ? 1 : 0
    if cameraTextureEnabled, faceCanvasFrozen, let image = faceCanvasImage {
      material.shaderModifiers = nil
      material.diffuse.contents = image
    } else if cameraTextureEnabled, !faceCanvasFrozen {
      applyFaceCameraProjection(to: material)
    }
  }

  func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
    guard let faceAnchor = anchor as? ARFaceAnchor else { return }
    (node.geometry as? ARSCNFaceGeometry)?.update(from: faceAnchor.geometry)
    (faceMaskNode?.geometry as? ARSCNFaceGeometry)?.update(from: faceAnchor.geometry)
    (faceGridNode?.geometry as? ARSCNFaceGeometry)?.update(from: faceAnchor.geometry)
    rendererCallbackLock.lock()
    pendingBindingGeometry = faceAnchor.geometry
    let shouldQueue = !bindingUpdateQueued
    bindingUpdateQueued = true
    rendererCallbackLock.unlock()
    guard shouldQueue else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.rendererCallbackLock.lock()
      let geometry = self.pendingBindingGeometry
      self.pendingBindingGeometry = nil
      self.bindingUpdateQueued = false
      self.rendererCallbackLock.unlock()
      guard let geometry else { return }
      self.lastFaceGeometry = geometry
      self.updateBoundMarks(geometry: geometry)
    }
  }

  func renderer(_ renderer: SCNSceneRenderer, didRemove node: SCNNode, for anchor: ARAnchor) {
    guard anchor is ARFaceAnchor else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      // ARKit removes the whole anchor hierarchy. Keep all access to the paint
      // arrays on main so a simultaneous touch cannot corrupt a Dictionary.
      if self.faceNode === node {
        self.endMaskTransition()
        // Park the paint root in world space where the face just was, KEEPING
        // it in the scene. Detaching it entirely is what made a whole mask
        // vanish when ARKit dropped the anchor on a camera switch — if the
        // next anchor never arrived, the painting had nowhere to live.
        let parked = self.paintRoot.simdWorldTransform
        self.paintRoot.removeFromParentNode()
        self.paintRoot.simdTransform = parked
        self.arView.scene.rootNode.addChildNode(self.paintRoot)
        self.faceNode = nil
        self.faceMaskNode = nil
        self.faceGridNode = nil
        self.faceMaskMaterial = nil
        self.trackedFace = false
        self.toolTarget = nil
        self.updateCanVisibility()
        self.onFaceChanged(["count": 0])
      }
    }
  }

  func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
    updateCameraTexture(time: time)
    rendererCallbackLock.lock()
    let shouldQueue = !rendererTickQueued
    rendererTickQueued = true
    rendererCallbackLock.unlock()
    guard shouldQueue else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.rendererCallbackLock.lock()
      self.rendererTickQueued = false
      self.rendererCallbackLock.unlock()
      self.updateSprayFollower()
      self.updateMaskTransition(time: time)
    }
  }

  private func updateCameraTexture(time: TimeInterval) {
    guard cameraTextureEnabled, !faceCanvasFrozen,
          let material = faceMaskMaterial else { return }
    let interval = isPainting ? (1.0 / 12.0) : (1.0 / 30.0)
    guard time - lastCameraTextureTime >= interval else { return }
    lastCameraTextureTime = time
    guard let image = screenAlignedCameraImage() else { return }
    material.diffuse.contents = image
    material.transparency = 1
  }

  private func screenAlignedCameraImage() -> CGImage? {
    guard let frame = arView.session.currentFrame else { return nil }
    let viewport = bounds.size
    guard viewport.width > 0, viewport.height > 0 else { return nil }
    let orientation = window?.windowScene?.interfaceOrientation ?? .portrait
    let image = CIImage(cvPixelBuffer: frame.capturedImage)
    let width = image.extent.width
    let height = image.extent.height
    let normalized = CGAffineTransform(scaleX: 1 / width, y: 1 / height)
    let flip = CGAffineTransform(scaleX: 1, y: -1).translatedBy(x: 0, y: -1)
    let display = frame.displayTransform(for: orientation, viewportSize: viewport)
    let pixels = CGAffineTransform(scaleX: viewport.width, y: viewport.height)
    let transform = normalized.concatenating(flip).concatenating(display)
      .concatenating(flip).concatenating(pixels)
    let mapped = image.transformed(by: transform)
      .cropped(to: CGRect(origin: .zero, size: viewport))
    return Self.ciContext.createCGImage(mapped, from: CGRect(origin: .zero, size: viewport))
  }

  private func currentCameraImage() -> CGImage? {
    let now = CACurrentMediaTime()
    if let cached = cachedCameraFrame, now - cached.time < 0.09 { return cached.image }
    guard let image = screenAlignedCameraImage() else { return nil }
    cachedCameraFrame = (image, now)
    return image
  }

  /// `SCNMaterialProperty.contents` is `Any?`; ask CoreFoundation for the real
  /// type so the frame already visible on the mask is preferred for the bake.
  private static func imageContents(of property: SCNMaterialProperty) -> CGImage? {
    guard let contents = property.contents else { return nil }
    let value = contents as AnyObject
    guard CFGetTypeID(value) == CGImage.typeID else { return nil }
    return (value as! CGImage)
  }

  /// Read the visible fill-mesh first. ARFaceGeometry itself omits the extra
  /// triangles that close the eyes and mouth, which would leave pale holes in
  /// the frozen webcam atlas.
  private func faceMaskBakeMesh() -> FaceMaskBakeMesh? {
    if let geometry = faceMaskNode?.geometry,
       let mesh = Self.bakeMesh(from: geometry) {
      return mesh
    }
    guard let face = lastFaceGeometry else { return nil }
    return FaceMaskBakeMesh(
      positions: face.vertices.map { SIMD3<Float>($0) },
      uvs: face.textureCoordinates.map { CGPoint(x: CGFloat($0.x), y: CGFloat($0.y)) },
      indices: face.triangleIndices.map { Int($0) })
  }

  private static func bakeMesh(from geometry: SCNGeometry) -> FaceMaskBakeMesh? {
    guard let vertexSource = geometry.sources(for: .vertex).first,
          let uvSource = geometry.sources(for: .texcoord).first,
          let element = geometry.elements.first,
          element.primitiveType == .triangles,
          let positions = floatVectors(vertexSource, components: 3),
          let uvs = floatVectors(uvSource, components: 2),
          let indices = triangleIndices(element) else { return nil }
    return FaceMaskBakeMesh(
      positions: positions.map { SIMD3<Float>($0[0], $0[1], $0[2]) },
      uvs: uvs.map { CGPoint(x: CGFloat($0[0]), y: CGFloat($0[1])) },
      indices: indices)
  }

  private static func floatVectors(_ source: SCNGeometrySource,
                                   components: Int) -> [[Float]]? {
    guard source.usesFloatComponents, source.bytesPerComponent == 4,
          source.componentsPerVector >= components,
          source.vectorCount > 0, !source.data.isEmpty else { return nil }
    var output: [[Float]] = []
    output.reserveCapacity(source.vectorCount)
    source.data.withUnsafeBytes { raw in
      for index in 0..<source.vectorCount {
        let offset = source.dataOffset + index * source.dataStride
        guard offset + components * 4 <= raw.count else { return }
        var vector: [Float] = []
        vector.reserveCapacity(components)
        for component in 0..<components {
          vector.append(raw.loadUnaligned(fromByteOffset: offset + component * 4,
                                          as: Float.self))
        }
        output.append(vector)
      }
    }
    return output.count == source.vectorCount ? output : nil
  }

  private static func triangleIndices(_ element: SCNGeometryElement) -> [Int]? {
    let count = element.primitiveCount * 3
    let width = element.bytesPerIndex
    guard count > 0, width == 2 || width == 4,
          element.data.count >= count * width else { return nil }
    var output: [Int] = []
    output.reserveCapacity(count)
    element.data.withUnsafeBytes { raw in
      for index in 0..<count {
        let offset = index * width
        if width == 2 {
          output.append(Int(raw.loadUnaligned(fromByteOffset: offset, as: UInt16.self)))
        } else {
          output.append(Int(raw.loadUnaligned(fromByteOffset: offset, as: UInt32.self)))
        }
      }
    }
    return output.count == count ? output : nil
  }

  /// Port of AR Draw's first-stroke freeze: rasterise the camera projection
  /// triangle-by-triangle into ARFaceGeometry's own stable UV atlas.
  @discardableResult
  private func freezeCameraTextureOntoFace() -> Bool {
    if faceCanvasFrozen { return true }
    guard cameraTextureEnabled, let material = faceMaskMaterial,
          let maskNode = faceMaskNode, let mesh = faceMaskBakeMesh(),
          let frame = Self.imageContents(of: material.diffuse) ?? currentCameraImage(),
          let source = FrontProjectionBakeSource(image: frame) else { return false }
    let side = Self.faceAtlasSide
    guard let context = CGContext(data: nil, width: side, height: side,
                                  bitsPerComponent: 8, bytesPerRow: side * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let target = context.data?.assumingMemoryBound(to: UInt8.self),
          bounds.width > 1, bounds.height > 1 else { return false }
    context.setFillColor(UIColor(white: 0.72, alpha: 1).cgColor)
    context.fill(CGRect(x: 0, y: 0, width: side, height: side))

    let world = maskNode.simdWorldTransform
    let scaleX = CGFloat(source.width) / bounds.width
    let scaleY = CGFloat(source.height) / bounds.height
    let atlas = mesh.uvs.map {
      CGPoint(x: $0.x * CGFloat(side), y: $0.y * CGFloat(side))
    }
    let projected = mesh.positions.map { position -> CGPoint in
      let worldPoint = world * simd_float4(position, 1)
      let screen = arView.projectPoint(SCNVector3(worldPoint.x, worldPoint.y, worldPoint.z))
      return CGPoint(x: (bounds.width - CGFloat(screen.x)) * scaleX,
                     y: CGFloat(screen.y) * scaleY)
    }
    var baked = 0
    var index = 0
    while index + 2 < mesh.indices.count {
      let a = mesh.indices[index], b = mesh.indices[index + 1], c = mesh.indices[index + 2]
      index += 3
      guard a < atlas.count, b < atlas.count, c < atlas.count,
            a < projected.count, b < projected.count, c < projected.count else { continue }
      FrontProjectionBaker.rasterize(
        destination: (atlas[a], atlas[b], atlas[c]),
        source: (projected[a], projected[b], projected[c]),
        into: target, width: side, height: side, bytesPerRow: context.bytesPerRow,
        from: source)
      baked += 1
    }
    guard baked > 0, let image = context.makeImage() else { return false }
    faceCanvasImage = image
    faceCanvasBase = image
    faceCanvasFrozen = true
    material.shaderModifiers = nil
    material.diffuse.contents = image
    material.transparency = cameraTextureEnabled ? 1 : 0
    NSLog("[FrontMask] froze webcam projection into face atlas (triangles=%d)", baked)
    return true
  }

  private func resetFaceCanvas() {
    faceCanvasImage = nil
    faceCanvasBase = nil
    faceCanvasFrozen = false
    guard let material = faceMaskMaterial else { return }
    material.diffuse.contents = UIColor(white: 0.92, alpha: 1)
    applyFaceCameraProjection(to: material)
    material.transparency = cameraTextureEnabled ? 1 : 0
    lastCameraTextureTime = 0
  }

  private func applySavedFaceCanvas(imageData: Data?, baseData: Data?) -> Bool {
    guard let imageData, let image = UIImage(data: imageData)?.cgImage else { return false }
    faceCanvasImage = image
    faceCanvasBase = baseData.flatMap { UIImage(data: $0)?.cgImage } ?? image
    faceCanvasFrozen = true
    guard let material = faceMaskMaterial else { return true }
    material.shaderModifiers = nil
    material.diffuse.contents = image
    material.transparency = cameraTextureEnabled ? 1 : 0
    return true
  }

  private func faceCanvasData() -> (image: Data?, base: Data?) {
    guard faceCanvasFrozen else { return (nil, nil) }
    return (faceCanvasImage.flatMap { UIImage(cgImage: $0).pngData() },
            faceCanvasBase.flatMap { UIImage(cgImage: $0).pngData() })
  }

  // MARK: Painting

  private struct PaintHit {
    let localPosition: SIMD3<Float>
    let localNormal: SIMD3<Float>
    let worldPosition: SIMD3<Float>
    let worldNormal: SIMD3<Float>
    let surface: String
    let uv: CGPoint?
  }

  private func paintHit(at point: CGPoint) -> PaintHit? {
    guard let face = faceNode else { return nil }
    let hits = arView.hitTest(point, options: [
      .rootNode: face,
      .searchMode: SCNHitTestSearchMode.closest.rawValue,
      .categoryBitMask: Self.surfaceCategory,
      .ignoreHiddenNodes: false,
    ])
    if let result = hits.first {
      var worldNormal = simd_float3(result.worldNormal)
      if simd_length_squared(worldNormal) < 1e-8 { worldNormal = SIMD3<Float>(0, 0, 1) }
      worldNormal = simd_normalize(worldNormal)
      let world = simd_float3(result.worldCoordinates)
      let localPoint = face.simdConvertPosition(world, from: nil)
      let localNormal = simd_normalize(face.simdConvertVector(worldNormal, from: nil))
      return PaintHit(localPosition: localPoint, localNormal: localNormal,
                      worldPosition: world, worldNormal: worldNormal,
                      surface: result.node.name == "faceBackdrop" ? "backdrop" : "faceMesh",
                      uv: result.node.name == "faceBackdrop"
                        ? nil : result.textureCoordinates(withMappingChannel: 0))
    }
    return backdropFallback(at: point)
  }

  /// Texture/Relief Face mode must begin on the actual mesh. Falling back to
  /// the large backdrop on touch-down was the source of the diagonal
  /// "top-left into the face" first mark seen on device.
  private func facePaintHit(at point: CGPoint) -> PaintHit? {
    guard let face = faceNode else { return nil }
    let hits = arView.hitTest(point, options: [
      .rootNode: face,
      .searchMode: SCNHitTestSearchMode.all.rawValue,
      .categoryBitMask: Self.surfaceCategory,
      .ignoreHiddenNodes: false,
    ])
    guard let result = hits.first(where: { $0.node.name != "faceBackdrop" }) else { return nil }
    var worldNormal = simd_float3(result.worldNormal)
    if simd_length_squared(worldNormal) < 1e-8 { worldNormal = SIMD3<Float>(0, 0, 1) }
    worldNormal = simd_normalize(worldNormal)
    let world = simd_float3(result.worldCoordinates)
    return PaintHit(localPosition: face.simdConvertPosition(world, from: nil),
                    localNormal: simd_normalize(face.simdConvertVector(worldNormal, from: nil)),
                    worldPosition: world, worldNormal: worldNormal,
                    surface: "faceMesh",
                    uv: result.textureCoordinates(withMappingChannel: 0))
  }

  private func backdropFallback(at point: CGPoint) -> PaintHit? {
    guard let camera = arView.pointOfView, let face = faceNode else { return nil }
    let cameraPosition = camera.simdWorldPosition
    let facePosition = face.presentation.simdWorldPosition
    let forward = simd_normalize(SIMD3<Float>(-camera.simdWorldTransform.columns.2.x,
                                              -camera.simdWorldTransform.columns.2.y,
                                              -camera.simdWorldTransform.columns.2.z))
    let depth = max(0.18, simd_dot(facePosition - cameraPosition, forward) + 0.12)
    let near = arView.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 0))
    let far = arView.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 1))
    let origin = simd_float3(near)
    let direction = simd_normalize(simd_float3(far) - origin)
    let denominator = simd_dot(direction, forward)
    guard abs(denominator) > 1e-5 else { return nil }
    let planePoint = cameraPosition + forward * depth
    let distance = simd_dot(planePoint - origin, forward) / denominator
    guard distance > 0 else { return nil }
    let world = origin + direction * distance
    let worldNormal = -forward
    return PaintHit(localPosition: face.simdConvertPosition(world, from: nil),
                    localNormal: simd_normalize(face.simdConvertVector(worldNormal, from: nil)),
                    worldPosition: world, worldNormal: worldNormal,
                    surface: "backdrop", uv: nil)
  }

  /// Camera-facing drawing plane slightly in front of the tracked face. It is
  /// still parented to the head, but intentionally does not deform with facial
  /// triangles, giving Texture/Relief a real floating 3D mode.
  private func frontPlaneFallback(at point: CGPoint) -> PaintHit? {
    guard let camera = arView.pointOfView, let face = faceNode else { return nil }
    let cameraPosition = camera.simdWorldPosition
    let facePosition = face.presentation.simdWorldPosition
    let forward = simd_normalize(SIMD3<Float>(-camera.simdWorldTransform.columns.2.x,
                                              -camera.simdWorldTransform.columns.2.y,
                                              -camera.simdWorldTransform.columns.2.z))
    let faceDepth = simd_dot(facePosition - cameraPosition, forward)
    let depth = max(0.12, faceDepth - 0.055)
    let near = arView.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 0))
    let far = arView.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 1))
    let origin = simd_float3(near)
    let direction = simd_normalize(simd_float3(far) - origin)
    let denominator = simd_dot(direction, forward)
    guard abs(denominator) > 1e-5 else { return nil }
    let planePoint = cameraPosition + forward * depth
    let distance = simd_dot(planePoint - origin, forward) / denominator
    guard distance > 0 else { return nil }
    let world = origin + direction * distance
    let worldNormal = -forward
    return PaintHit(localPosition: face.simdConvertPosition(world, from: nil),
                    localNormal: simd_normalize(face.simdConvertVector(worldNormal, from: nil)),
                    worldPosition: world, worldNormal: worldNormal,
                    surface: "front3D", uv: nil)
  }

  private static func liveTouchCount(_ event: UIEvent?, fallback: Int) -> Int {
    guard let all = event?.allTouches else { return fallback }
    let live = all.filter { $0.phase != .ended && $0.phase != .cancelled }.count
    return max(live, fallback)
  }

  /// Free Mode releases the mark into the air around the head instead of onto a
  /// surface. ONE plane, parallel to the camera, is locked at touch-down and the
  /// whole stroke is painted on it, so the line stays flat and facing the user
  /// instead of waving through depth. It is still parented to the face (via the
  /// paint root), so the drawing travels with the head.
  private func freeSpaceHit(at point: CGPoint) -> PaintHit? {
    guard let camera = arView.pointOfView, let face = faceNode else { return nil }
    let planeOrigin: SIMD3<Float>
    let planeNormal: SIMD3<Float>
    if let lockedOrigin = freePlaneOrigin, let lockedNormal = freePlaneNormal {
      planeOrigin = lockedOrigin
      planeNormal = lockedNormal
    } else {
      let cameraPosition = camera.simdWorldPosition
      let forward = simd_normalize(SIMD3<Float>(-camera.simdWorldTransform.columns.2.x,
                                                -camera.simdWorldTransform.columns.2.y,
                                                -camera.simdWorldTransform.columns.2.z))
      // Lock at the head's distance so the drawing sits right around the face.
      let depth = max(0.15, simd_dot(face.presentation.simdWorldPosition - cameraPosition,
                                     forward))
      planeOrigin = cameraPosition + forward * depth
      planeNormal = -forward
      freePlaneOrigin = planeOrigin
      freePlaneNormal = planeNormal
      showFreeAxes(at: planeOrigin, normal: planeNormal, up: camera.presentation.simdWorldUp)
      announceFreePlane(depth: depth, normal: planeNormal)
    }
    let near = arView.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 0))
    let far = arView.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 1))
    let rayOrigin = simd_float3(near)
    let direction = simd_normalize(simd_float3(far) - rayOrigin)
    let denominator = simd_dot(direction, planeNormal)
    guard abs(denominator) > 1e-5 else { return nil }
    let distance = simd_dot(planeOrigin - rayOrigin, planeNormal) / denominator
    guard distance > 0 else { return nil }
    let world = rayOrigin + direction * distance
    return PaintHit(localPosition: face.simdConvertPosition(world, from: nil),
                    localNormal: simd_normalize(face.simdConvertVector(planeNormal, from: nil)),
                    worldPosition: world, worldNormal: planeNormal,
                    surface: "free", uv: nil)
  }

  /// The little XYZ marker that shows WHERE the locked drawing plane sits.
  private func showFreeAxes(at position: SIMD3<Float>, normal: SIMD3<Float>,
                            up: SIMD3<Float>) {
    let axes = freeAxesNode ?? makeFreeAxesNode()
    freeAxesNode = axes
    axes.removeAllActions()
    axes.opacity = 1
    axes.isHidden = false
    axes.simdPosition = position
    axes.simdOrientation = maskOrientation(normal: normal, roll: 0)
    _ = up
    if axes.parent == nil { arView.scene.rootNode.addChildNode(axes) }
  }

  private func makeFreeAxesNode() -> SCNNode {
    let root = SCNNode()
    root.name = "freeModeAxes"
    let length: CGFloat = 0.05
    let thickness: CGFloat = 0.0022
    let bars: [(SCNVector3, UIColor, SCNVector3)] = [
      (SCNVector3(Float(length) / 2, 0, 0), .systemRed, SCNVector3(0, 0, Float.pi / 2)),
      (SCNVector3(0, Float(length) / 2, 0), .systemGreen, SCNVector3(0, 0, 0)),
      (SCNVector3(0, 0, Float(length) / 2), .systemBlue, SCNVector3(Float.pi / 2, 0, 0)),
    ]
    for (offset, color, euler) in bars {
      let geometry = SCNCylinder(radius: thickness, height: length)
      let material = SCNMaterial()
      material.lightingModel = .constant
      material.diffuse.contents = color
      material.writesToDepthBuffer = false
      material.readsFromDepthBuffer = false
      geometry.firstMaterial = material
      let bar = SCNNode(geometry: geometry)
      bar.position = offset
      bar.eulerAngles = euler
      bar.renderingOrder = Self.canRenderOrder + 40
      root.addChildNode(bar)
    }
    root.isHidden = true
    return root
  }

  private func fadeFreeAxes() {
    guard let axes = freeAxesNode, !axes.isHidden else { return }
    axes.removeAllActions()
    axes.runAction(.sequence([
      .wait(duration: 0.9),
      .fadeOut(duration: 0.45),
      .run { $0.isHidden = true },
    ]))
  }

  /// Mini info for the JS pill: how far out the plane locked, and which world
  /// axis it is closest to being perpendicular to.
  private func announceFreePlane(depth: Float, normal: SIMD3<Float>) {
    let absolute = SIMD3<Float>(abs(normal.x), abs(normal.y), abs(normal.z))
    let axis: String
    if absolute.x >= absolute.y && absolute.x >= absolute.z {
      axis = normal.x >= 0 ? "+X" : "−X"
    } else if absolute.y >= absolute.z {
      axis = normal.y >= 0 ? "+Y" : "−Y"
    } else {
      axis = normal.z >= 0 ? "+Z" : "−Z"
    }
    let payload: [String: Any] = ["axis": axis, "distanceCm": Int((depth * 100).rounded())]
    DispatchQueue.main.async { [weak self] in self?.onFreePlaneLocked(payload) }
  }

  private func resolvePaintHit(at point: CGPoint, areaTool: Bool) -> PaintHit? {
    // Free Mode owns the stamp tools (emoji + spray). Texture/Relief keep their
    // explicit target so their merged surfaces stay predictable.
    if freeModeEnabled, !areaTool { return freeSpaceHit(at: point) }
    guard areaTool else { return paintHit(at: point) }
    switch textureTarget {
    case "front3D": return frontPlaneFallback(at: point)
    case "plane": return backdropFallback(at: point)
    case "face": return facePaintHit(at: point)
    default:
      // AUTO: on the face when the finger is on the face, on the surrounding
      // paint plane when it isn't. `facePaintHit` only ever returns real
      // face-mesh hits, so the plane can never steal a mark meant for the
      // face — which is what the old touch-down fallback used to do.
      return facePaintHit(at: point) ?? backdropFallback(at: point)
    }
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard !paused, let touch = touches.first else { return }
    let live = Self.liveTouchCount(event, fallback: touches.count)
    if gestureActive || live >= 2 {
      // Mid-drag palm/second finger: ignore it completely, don't lose the stroke.
      if !gestureActive, isPainting,
         CACurrentMediaTime() - strokeStartTime > Self.gestureJoinWindow { return }
      beginOrExtendHistoryGesture(count: live)
      return
    }
    let point = touch.location(in: self)
    if eyedropperEnabled {
      pickColorFromCamera(at: point)
      return
    }
    // A new stroke starts at its first valid hit only. Do not spin/pivot the
    // face here: changing the face transform between touch-down and the first
    // hit created the long bogus lead-in line on an empty mask.
    paintingTouch = touch
    strokeStartTime = CACurrentMediaTime()
    isPainting = true
    activeStroke = []
    activeAreaSurface = nil
    activeStrokeSource = nil
    lastLocalPoint = nil
    lastLocalNormal = nil
    lastScreenPoint = nil
    // Every stroke locks its own fresh plane.
    freePlaneOrigin = nil
    freePlaneNormal = nil
    setSpraying(true)
    paint(at: point, force: true)
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    if gestureActive {
      for touch in touches {
        let now = touch.location(in: self)
        let before = touch.previousLocation(in: self)
        gestureTravel += hypot(now.x - before.x, now.y - before.y)
      }
      return
    }
    guard isPainting else { return }
    // Follow the finger that started the stroke, never a later one.
    guard let touch = touches.first(where: { $0 === paintingTouch }) ?? touches.first else { return }
    let samples = event?.coalescedTouches(for: touch) ?? [touch]
    for sample in samples { paint(at: sample.location(in: self), force: false) }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    endTouches(touches, with: event)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    endTouches(touches, with: event)
  }

  private func endTouches(_ touches: Set<UITouch>, with event: UIEvent?) {
    if gestureActive {
      let remaining = event?.allTouches?.filter {
        !touches.contains($0) && $0.phase != .ended && $0.phase != .cancelled
      }.count ?? 0
      guard remaining == 0 else { return }
      finishHistoryGesture()
      return
    }
    guard touches.contains(where: { $0 === paintingTouch }) || paintingTouch == nil else { return }
    paintingTouch = nil
    finishStroke()
  }

  // MARK: History gestures — two-finger tap undo, three-finger tap redo

  private func beginOrExtendHistoryGesture(count: Int) {
    if !gestureActive {
      gestureActive = true
      gestureStartTime = CACurrentMediaTime()
      gestureTravel = 0
      gestureMaxTouches = 0
      // The extra finger arrived while a stroke was starting: throw that
      // half-mark away instead of committing it to history.
      abortActiveStroke()
    }
    gestureMaxTouches = max(gestureMaxTouches, count)
  }

  private func finishHistoryGesture() {
    let elapsed = CACurrentMediaTime() - gestureStartTime
    let tapped = gestureTravel <= Self.gestureTapSlop && elapsed <= Self.gestureTapWindow
    let fingers = gestureMaxTouches
    gestureActive = false
    gestureMaxTouches = 0
    gestureTravel = 0
    guard tapped else { return }
    if fingers == 2 {
      undoLastStroke()
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
    } else if fingers >= 3 {
      redoLastStroke()
      UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
  }

  /// Drop an in-progress stroke without touching the undo/redo stacks.
  private func abortActiveStroke() {
    paintingTouch = nil
    guard isPainting || !activeStroke.isEmpty else { return }
    isPainting = false
    setSpraying(false)
    activeAreaSurface = nil
    activeStrokeSource = nil
    activeStroke.forEach(removeMark)
    activeStroke = []
    freePlaneOrigin = nil
    freePlaneNormal = nil
    fadeFreeAxes()
    lastLocalPoint = nil
    lastLocalNormal = nil
    lastScreenPoint = nil
  }

  private func paint(at point: CGPoint, force: Bool) {
    let areaTool = brushMode == "texture" || brushMode == "relief"
    let hit = resolvePaintHit(at: point, areaTool: areaTool)
    guard let hit else { return }
    toolTarget = hit.worldPosition
    toolNormal = hit.worldNormal
    updateCanVisibility()
    let size = max(Self.minDecalSize,
                   min(areaTool ? Self.maxAreaToolSize : Self.maxDecalSize,
                       brushSizeMeters * (areaTool ? Self.areaToolScale : Self.decalScale)))
    if !force, let last = lastScreenPoint,
       hypot(point.x - last.x, point.y - last.y) < 2 { return }

    if hit.surface == "faceMesh", cameraTextureEnabled, !faceCanvasFrozen {
      _ = freezeCameraTextureOntoFace()
    }
    if let previous = lastLocalPoint, let previousNormal = lastLocalNormal,
       let previousScreen = lastScreenPoint {
      let delta = hit.localPosition - previous
      let distance = simd_length(delta)
      let spacingFactor = brushMode == "emoji" ? brushSpacing : (areaTool ? 0.12 : 0.18)
      let spacing = Float(max(size * spacingFactor, 0.0008))
      let gapLimit = Float(max(0.05, size * 10))
      if distance < spacing, !force { return }
      if distance <= gapLimit {
        let count = min(48, max(1, Int(floor(distance / spacing))))
        for index in 1...count {
          let t = min(1, Float(index) * spacing / max(distance, 1e-6))
          let position = simd_mix(previous, hit.localPosition, SIMD3<Float>(repeating: t))
          let normal = simd_normalize(simd_mix(previousNormal, hit.localNormal,
                                                SIMD3<Float>(repeating: t)))
          let samplePoint = CGPoint(
            x: previousScreen.x + (point.x - previousScreen.x) * CGFloat(t),
            y: previousScreen.y + (point.y - previousScreen.y) * CGFloat(t))
          attachPaintSample(position: position, normal: normal, size: size,
                            surface: hit.surface, screenPoint: samplePoint)
          lastLocalPoint = position
          lastLocalNormal = normal
        }
        lastScreenPoint = point
        return
      }
    }
    attachPaintSample(position: hit.localPosition, normal: hit.localNormal,
                      size: size, surface: hit.surface, screenPoint: point)
    lastLocalPoint = hit.localPosition
    lastLocalNormal = hit.localNormal
    lastScreenPoint = point
  }

  private struct MarkAppearance {
    let style: String
    let color: UIColor
    let texturePNG: Data?
  }

  private func markAppearance(at screenPoint: CGPoint) -> MarkAppearance {
    switch brushMode {
    case "emoji":
      return MarkAppearance(style: "emoji|\(brushEmoji)", color: .white, texturePNG: nil)
    case "texture":
      let data = cameraDecal(at: screenPoint)?.pngData()
      return MarkAppearance(style: "texture", color: .white, texturePNG: data)
    case "relief":
      let source = cameraDecal(at: screenPoint) ?? sprayTexture(color: .white)
      let data = source.cgImage.flatMap { Self.normalMapImage(from: $0)?.pngData() }
      return MarkAppearance(style: "relief", color: brushColor, texturePNG: data)
    default:
      return MarkAppearance(style: "spray", color: brushColor, texturePNG: nil)
    }
  }

  private func attachPaintSample(position: SIMD3<Float>, normal: SIMD3<Float>,
                                 size: CGFloat, surface: String, screenPoint: CGPoint) {
    if brushMode == "texture" || brushMode == "relief" {
      attachAreaSample(position: position, normal: normal, size: size,
                       surface: surface, screenPoint: screenPoint)
    } else {
      attachMark(position: position, normal: normal, size: size,
                 surface: surface, appearance: markAppearance(at: screenPoint))
    }
  }

  private func attachAreaSample(position: SIMD3<Float>, normal: SIMD3<Float>,
                                size: CGFloat, surface: String, screenPoint: CGPoint) {
    guard faceNode != nil else { return }
    // A drag that leaves the current tile continues on a fresh one instead of
    // being clipped away. This is what lets Texture/Relief cover the big paint
    // plane with exactly the same dab quality it has on the face mask.
    if let current = activeAreaSurface,
       !current.covers(localPosition: position, in: paintRoot, size: size) {
      finalizeAreaSurface(current)
      activeAreaSurface = nil
    }
    if activeAreaSurface == nil {
      let onPlane = surface != "faceMesh"
      guard let made = MergedAreaStrokeSurface(
        side: onPlane ? Self.mergedPlaneSide : Self.mergedSurfaceSide,
        span: onPlane ? Self.mergedPlaneSpan : Self.mergedSurfaceSpan,
        mode: brushMode,
        lineStyle: textureLineStyle,
        color: brushColor,
        normalEnabled: textureNormalEnabled,
        sourceImage: activeStrokeSource ?? currentCameraImage()) else { return }
      activeStrokeSource = made.sourceImage
      let node = made.node
      node.simdPosition = position + normal * (surface == "front3D" ? 0 : Self.surfaceLift)
      node.simdOrientation = maskOrientation(normal: normal, roll: 0)
      node.renderingOrder = 1_000 + markCounter
      paintRoot.addChildNode(node)
      let key = ObjectIdentifier(node)
      surfaces[key] = surface
      colors[key] = brushMode == "texture" ? .white : brushColor
      styles[key] = brushMode == "texture" ? "textureMerged" : "reliefMerged"
      // AR Draw's face-projected cards ignore the hidden hit mesh's depth;
      // otherwise the nose/brow punches holes through the painted card.
      node.geometry?.firstMaterial?.readsFromDepthBuffer = surface != "faceMesh"
      if surface == "faceMesh", let geometry = lastFaceGeometry {
        bindings[key] = FrontMaskFaceBinding.bind(localPosition: node.simdPosition,
                                                   orientation: node.simdOrientation,
                                                   geometry: geometry,
                                                   maxDistance: 0.05)
      }
      activeStroke.append(node)
      activeAreaSurface = made
      markCounter += 1
    }
    guard let activeAreaSurface else { return }
    let crop = cameraDecal(at: screenPoint, source: activeAreaSurface.sourceImage,
                           circular: false)
    activeAreaSurface.stamp(localPosition: position, in: paintRoot, size: size, cameraCrop: crop)
  }

  /// Flatten one finished Texture/Relief tile into the payload maps so it can
  /// be saved and reloaded exactly as drawn.
  private func finalizeAreaSurface(_ surface: MergedAreaStrokeSurface) {
    let payload = surface.finish()
    let key = ObjectIdentifier(surface.node)
    texturePayloads[key] = payload.diffuse
    normalPayloads[key] = payload.normal
  }

  private func attachMark(position: SIMD3<Float>, normal: SIMD3<Float>,
                          size: CGFloat, surface: String, appearance: MarkAppearance) {
    guard faceNode != nil else { return }
    let node = decalNode(size: size, style: appearance.style,
                         color: appearance.color, texturePNG: appearance.texturePNG)
    let separation = Float(markCounter % Self.separationCycle) * Self.separationStep
    node.simdPosition = position + normal * (Self.surfaceLift + separation)
    let roll: Float
    if appearance.style.hasPrefix("emoji|") {
      roll = Float(brushRotationDegrees * .pi / 180)
      node.simdScale = SIMD3<Float>(brushMirrorX ? -1 : 1, brushMirrorY ? -1 : 1, 1)
    } else {
      roll = Float.random(in: -0.035...0.035)
    }
    node.simdOrientation = maskOrientation(normal: normal, roll: roll)
    node.renderingOrder = 1_000 + markCounter
    paintRoot.addChildNode(node)
    let key = ObjectIdentifier(node)
    surfaces[key] = surface
    colors[key] = appearance.color
    styles[key] = appearance.style
    texturePayloads[key] = appearance.texturePNG
    normalPayloads[key] = nil
    if surface == "faceMesh", let geometry = lastFaceGeometry {
      bindings[key] = FrontMaskFaceBinding.bind(localPosition: node.simdPosition,
                                                 orientation: node.simdOrientation,
                                                 geometry: geometry,
                                                 maxDistance: 0.05)
    }
    activeStroke.append(node)
    markCounter += 1
  }

  private func finishStroke() {
    guard isPainting else { return }
    isPainting = false
    setSpraying(false)
    if let area = activeAreaSurface { finalizeAreaSurface(area) }
    activeAreaSurface = nil
    activeStrokeSource = nil
    let committed = !activeStroke.isEmpty
    if committed {
      strokes.append(activeStroke)
      // A new stroke only invalidates the redo branch once it actually put
      // something on the mask. Tapping empty space no longer eats a redo.
      discardRedoStack()
    }
    activeStroke = []
    lastLocalPoint = nil
    lastLocalNormal = nil
    lastScreenPoint = nil
    freePlaneOrigin = nil
    freePlaneNormal = nil
    fadeFreeAxes()
    guard committed else { return }
    emitHistory()
    onStrokeCommitted(["strokeId": UUID().uuidString])
    scheduleAutosave()
  }

  /// Redo entries are dead once a new stroke branches off them: drop the nodes
  /// AND their per-node maps, otherwise bindings/styles grow forever.
  private func discardRedoStack() {
    guard !redoStrokes.isEmpty else { return }
    redoStrokes.flatMap { $0 }.forEach(removeMark)
    redoStrokes.removeAll()
  }

  private func maskOrientation(normal: SIMD3<Float>, roll: Float) -> simd_quatf {
    let z = simd_normalize(normal)
    var reference = SIMD3<Float>(0, 1, 0)
    if abs(simd_dot(reference, z)) > 0.95 { reference = SIMD3<Float>(0, 0, 1) }
    let x = simd_normalize(simd_cross(reference, z))
    let y = simd_cross(z, x)
    return simd_quatf(simd_float3x3(columns: (x, y, z)))
      * simd_quatf(angle: roll, axis: SIMD3<Float>(0, 0, 1))
  }

  private func updateBoundMarks(geometry: ARFaceGeometry) {
    // Undone strokes are off-screen and must not be re-evaluated or re-shown.
    for stroke in strokes + (activeStroke.isEmpty ? [] : [activeStroke]) {
      for node in stroke {
        guard let binding = bindings[ObjectIdentifier(node)],
              let evaluated = binding.evaluate(geometry: geometry) else { continue }
        node.simdPosition = evaluated.position
        node.simdOrientation = evaluated.orientation
      }
    }
  }

  /// Safety net for decals that lost their parent. Undone strokes are skipped
  /// on purpose — re-adding them was making an undo silently come back after
  /// face tracking restarted.
  private func reattachOrphanedPaint() {
    for stroke in strokes + (activeStroke.isEmpty ? [] : [activeStroke]) {
      for node in stroke where node.parent == nil { paintRoot.addChildNode(node) }
    }
  }

  private func removeMark(_ node: SCNNode) {
    let key = ObjectIdentifier(node)
    bindings[key] = nil
    surfaces[key] = nil
    colors[key] = nil
    styles[key] = nil
    texturePayloads[key] = nil
    normalPayloads[key] = nil
    node.removeFromParentNode()
  }

  private func decalNode(size: CGFloat, style: String, color: UIColor,
                         texturePNG: Data? = nil, normalPNG: Data? = nil) -> SCNNode {
    let key = "\(style)|\(colorKey(color))|\(Int(size * 10_000))"
    let cacheable = texturePNG == nil
    let geometry: SCNPlane
    if cacheable, let cached = geometryCache[key] {
      geometry = cached
    } else {
      let made = SCNPlane(width: size, height: size)
      made.firstMaterial = paintMaterial(style: style, color: color,
                                         texturePNG: texturePNG, normalPNG: normalPNG)
      if cacheable { geometryCache[key] = made }
      geometry = made
    }
    let node = SCNNode(geometry: geometry)
    node.name = "maskFacePaint"
    node.categoryBitMask = Self.paintCategory
    node.castsShadow = false
    return node
  }

  private func paintMaterial(style: String, color: UIColor,
                             texturePNG: Data?, normalPNG: Data? = nil) -> SCNMaterial {
    let key = "\(style)|\(colorKey(color))"
    if texturePNG == nil, let cached = materialCache[key] { return cached }
    let material = SCNMaterial()
    material.name = "frontMask|\(key)"
    if style == "textureMerged", let texturePNG, let image = UIImage(data: texturePNG) {
      material.diffuse.contents = image
      if let normalPNG, let normal = UIImage(data: normalPNG) {
        material.lightingModel = .physicallyBased
        material.normal.contents = normal
        material.normal.intensity = 1.85
        material.roughness.contents = NSNumber(value: 0.46)
        material.specular.contents = UIColor.white
      } else {
        material.lightingModel = .constant
      }
    } else if style == "reliefMerged", let texturePNG, let image = UIImage(data: texturePNG) {
      material.lightingModel = .physicallyBased
      material.diffuse.contents = image
      if let normalPNG, let normal = UIImage(data: normalPNG) {
        material.normal.contents = normal
        material.normal.intensity = 2.75
      }
      material.roughness.contents = NSNumber(value: 0.22)
      material.metalness.contents = NSNumber(value: 0.06)
      material.specular.contents = UIColor.white
      material.emission.contents = color.withAlphaComponent(0.04)
    } else if style == "texture", let texturePNG, let image = UIImage(data: texturePNG) {
      material.diffuse.contents = image
      material.lightingModel = .constant
    } else if style == "relief" {
      material.lightingModel = .physicallyBased
      material.diffuse.contents = color
      material.transparent.contents = sprayTexture(color: .white)
      if let texturePNG, let normal = UIImage(data: texturePNG) {
        material.normal.contents = normal
        material.normal.intensity = 2.35
      }
      material.roughness.contents = NSNumber(value: 0.28)
      material.metalness.contents = NSNumber(value: 0.12)
      material.emission.contents = color.withAlphaComponent(0.08)
    } else if style.hasPrefix("emoji|") {
      material.diffuse.contents = emojiTexture(String(style.dropFirst("emoji|".count)))
      material.lightingModel = .constant
    } else {
      material.diffuse.contents = sprayTexture(color: color)
      material.lightingModel = .constant
    }
    material.isDoubleSided = true
    material.blendMode = .alpha
    material.transparencyMode = .aOne
    material.writesToDepthBuffer = false
    material.readsFromDepthBuffer = true
    if texturePNG == nil && normalPNG == nil { materialCache[key] = material }
    return material
  }

  private func sprayTexture(color: UIColor) -> UIImage {
    let key = colorKey(color)
    if let cached = textureCache[key] { return cached }
    let side = 256
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
    var generator = SeededRandom(seed: UInt64(bitPattern: Int64(key.hashValue)))
    let image = renderer.image { context in
      let cg = context.cgContext
      cg.clear(CGRect(x: 0, y: 0, width: side, height: side))
      color.withAlphaComponent(0.96).setFill()
      let path = UIBezierPath()
      path.move(to: CGPoint(x: 35, y: 132))
      path.addCurve(to: CGPoint(x: 222, y: 123),
                    controlPoint1: CGPoint(x: 70, y: 54), controlPoint2: CGPoint(x: 170, y: 80))
      path.addCurve(to: CGPoint(x: 42, y: 157),
                    controlPoint1: CGPoint(x: 188, y: 204), controlPoint2: CGPoint(x: 88, y: 187))
      path.close()
      path.fill()
      for _ in 0..<95 {
        let angle = generator.nextDouble() * Double.pi * 2
        let radius = 78 + generator.nextDouble() * 48
        let x = 128 + cos(angle) * radius
        let y = 128 + sin(angle) * radius * 0.62
        let dot = 1.1 + generator.nextDouble() * 5.2
        color.withAlphaComponent(CGFloat(0.25 + generator.nextDouble() * 0.65)).setFill()
        cg.fillEllipse(in: CGRect(x: x - dot, y: y - dot, width: dot * 2, height: dot * 2))
      }
    }
    textureCache[key] = image
    return image
  }

  private func emojiTexture(_ emoji: String) -> UIImage {
    let customPrefix = "data:image/png;base64,"
    let key: String
    if emoji.hasPrefix(customPrefix) {
      key = "emoji|custom|\(emoji.utf8.count)|\(emoji.prefix(28))|\(emoji.suffix(28))"
    } else {
      key = "emoji|\(emoji)"
    }
    if let cached = textureCache[key] { return cached }
    if emoji.hasPrefix(customPrefix),
       let data = Data(base64Encoded: String(emoji.dropFirst(customPrefix.count))),
       let image = UIImage(data: data) {
      textureCache[key] = image
      return image
    }
    let side: CGFloat = 256
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    format.scale = 1
    let image = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
      .image { _ in
        let value = emoji.isEmpty ? "😀" : emoji
        var fontSize: CGFloat = 196
        var attributes: [NSAttributedString.Key: Any] = [
          .font: UIFont.systemFont(ofSize: fontSize),
        ]
        var measured = (value as NSString).size(withAttributes: attributes)
        let limit = side * 0.9
        if measured.width > limit || measured.height > limit {
          fontSize *= min(limit / max(measured.width, 1), limit / max(measured.height, 1))
          attributes[.font] = UIFont.systemFont(ofSize: fontSize)
          measured = (value as NSString).size(withAttributes: attributes)
        }
        (value as NSString).draw(
          at: CGPoint(x: (side - measured.width) * 0.5,
                      y: (side - measured.height) * 0.5),
          withAttributes: attributes)
      }
    textureCache[key] = image
    return image
  }

  /// AR Draw's Texture brush takes the live camera region under the finger and
  /// clips it to a round dab. Keeping the alpha cut-out here prevents the solid
  /// square failure mode that originally motivated the isolated renderer.
  private func cameraDecal(at point: CGPoint) -> UIImage? {
    cameraDecal(at: point, source: currentCameraImage())
  }

  private func cameraDecal(at point: CGPoint, source: CGImage?,
                           circular: Bool = true) -> UIImage? {
    guard let source, bounds.width > 1, bounds.height > 1 else { return nil }
    let window = max(40, 96 * (brushSizeMeters / 0.092))
    let scaleX = CGFloat(source.width) / bounds.width
    let scaleY = CGFloat(source.height) / bounds.height
    var rect = CGRect(x: (point.x - window / 2) * scaleX,
                      y: (point.y - window / 2) * scaleY,
                      width: window * scaleX, height: window * scaleY).integral
    rect = rect.intersection(CGRect(x: 0, y: 0,
                                    width: CGFloat(source.width), height: CGFloat(source.height)))
    guard rect.width > 4, rect.height > 4, let crop = source.cropping(to: rect) else { return nil }
    let side: CGFloat = 128
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    format.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
      .image { context in
        if circular {
          context.cgContext.addEllipse(in: CGRect(x: 1, y: 1, width: side - 2, height: side - 2))
          context.cgContext.clip()
        }
        UIImage(cgImage: crop).draw(in: CGRect(x: 0, y: 0, width: side, height: side))
      }
  }

  /// Same Sobel luminance-to-normal conversion used by AR Draw's Relief tool.
  fileprivate static func normalMapImage(from image: CGImage,
                                         side requestedSide: Int = 96) -> UIImage? {
    let side = max(32, min(requestedSide, 640))
    guard let context = CGContext(data: nil, width: side, height: side,
                                  bitsPerComponent: 8, bytesPerRow: side,
                                  space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
    context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
    guard let source = context.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
    var rgba = [UInt8](repeating: 0, count: side * side * 4)
    for y in 1..<(side - 1) {
      for x in 1..<(side - 1) {
        let index = y * side + x
        let dx = (Float(source[index + 1]) - Float(source[index - 1])) / 255
        let dy = (Float(source[index + side]) - Float(source[index - side])) / 255
        let normal = simd_normalize(SIMD3<Float>(-dx * 2.2, dy * 2.2, 1))
        let output = index * 4
        rgba[output] = UInt8((normal.x * 0.5 + 0.5) * 255)
        rgba[output + 1] = UInt8((normal.y * 0.5 + 0.5) * 255)
        rgba[output + 2] = UInt8((normal.z * 0.5 + 0.5) * 255)
        rgba[output + 3] = 255
      }
    }
    let cgImage: CGImage? = rgba.withUnsafeMutableBytes { storage in
      guard let base = storage.baseAddress,
            let output = CGContext(data: base, width: side, height: side,
                                   bitsPerComponent: 8, bytesPerRow: side * 4,
                                   space: CGColorSpaceCreateDeviceRGB(),
                                   bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return nil }
      return output.makeImage()
    }
    return cgImage.map { UIImage(cgImage: $0) }
  }

  private func pickColorFromCamera(at point: CGPoint) {
    guard let image = currentCameraImage(), bounds.width > 0, bounds.height > 0 else { return }
    let width = CGFloat(image.width), height = CGFloat(image.height)
    let px = point.x * width / bounds.width
    let py = point.y * height / bounds.height
    let rect = CGRect(x: px - 2, y: (height - py) - 2, width: 5, height: 5)
      .intersection(CGRect(x: 0, y: 0, width: width, height: height))
    guard !rect.isNull, rect.width > 0, rect.height > 0 else { return }
    let average = CIImage(cgImage: image)
      .cropped(to: rect)
      .applyingFilter("CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: rect)])
    var pixel = [UInt8](repeating: 0, count: 4)
    Self.colorSampleContext.render(average, toBitmap: &pixel, rowBytes: 4,
                                   bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
                                   format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
    let picked = UIColor(red: CGFloat(pixel[0]) / 255, green: CGFloat(pixel[1]) / 255,
                         blue: CGFloat(pixel[2]) / 255, alpha: 1)
    brushColor = picked
    let hex = String(format: "#%02X%02X%02X", pixel[0], pixel[1], pixel[2])
    onColorPicked(["rgba": [Int(pixel[0]), Int(pixel[1]), Int(pixel[2]), 255], "hex": hex])
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
  }

  private func colorKey(_ color: UIColor) -> String {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    return "\(Int(r * 255))-\(Int(g * 255))-\(Int(b * 255))-\(Int(a * 255))"
  }

  // MARK: History + mask library

  func undoLastStroke() {
    // A stroke still under the finger is committed first so undo always acts on
    // what the user can see.
    finishStroke()
    endMaskTransition()
    guard let stroke = strokes.popLast() else { return }
    stroke.forEach { $0.removeFromParentNode() }
    redoStrokes.append(stroke)
    emitHistory()
    scheduleAutosave()
  }

  func redoLastStroke() {
    endMaskTransition()
    guard let stroke = redoStrokes.popLast() else { return }
    // Re-parenting to the paint root (not the anchor) means redo works even
    // while the face is momentarily untracked.
    stroke.forEach {
      $0.isHidden = false
      paintRoot.addChildNode($0)
    }
    strokes.append(stroke)
    emitHistory()
    scheduleAutosave()
  }

  func clearMask() {
    resetMask(removeAutosave: true)
  }

  private func resetMask(removeAutosave: Bool) {
    abortActiveStroke()
    endMaskTransition()
    (strokes + redoStrokes).flatMap { $0 }.forEach(removeMark)
    strokes.removeAll()
    redoStrokes.removeAll()
    activeMaskID = nil
    markCounter = 0
    resetFaceCanvas()
    if removeAutosave { FrontMaskPaintStore.shared.clearAutosave() }
    emitHistory()
    emitMasksChanged()
  }

  func saveMask(name: String) throws -> [String: Any] {
    finishStroke()
    let decals = collectDecals()
    let canvas = faceCanvasData()
    guard !decals.isEmpty || canvas.image != nil else { throw FrontMaskError.emptyMask }
    let store = FrontMaskPaintStore.shared
    let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let document = FrontMaskSavedDocument(name: cleanName.isEmpty ? store.suggestedName() : cleanName,
                                          decals: decals, canvasPNG: canvas.image,
                                          canvasBasePNG: canvas.base)
    guard store.save(document, thumbnail: arView.snapshot()) else { throw FrontMaskError.saveFailed }
    activeMaskID = document.id
    emitMasksChanged()
    return store.metadata().first(where: { ($0["id"] as? String) == document.id.uuidString }) ?? [:]
  }

  func loadMask(id: String) throws -> Int {
    guard let uuid = UUID(uuidString: id),
          let document = FrontMaskPaintStore.shared.masks.first(where: { $0.id == uuid })
    else { throw FrontMaskError.maskNotFound }
    guard faceNode != nil else { throw FrontMaskError.noTrackedFace }
    resetMask(removeAutosave: false)
    _ = applySavedFaceCanvas(imageData: document.canvasPNG,
                             baseData: document.canvasBasePNG)
    var loaded: [SCNNode] = []
    var groups: [Int: [SCNNode]] = [:]
    for decal in document.decals {
      guard let matrix = decal.matrix else { continue }
      let node = decalNode(size: CGFloat(max(0.002, decal.width)), style: decal.style,
                           color: decal.color, texturePNG: decal.texturePNG,
                           normalPNG: decal.normalPNG)
      if let plane = node.geometry as? SCNPlane {
        plane.height = CGFloat(max(0.002, decal.height))
      }
      if decal.style == "textureMerged" || decal.style == "reliefMerged" {
        node.geometry?.firstMaterial?.readsFromDepthBuffer = decal.surface != "faceMesh"
      }
      node.simdTransform = matrix
      paintRoot.addChildNode(node)
      let key = ObjectIdentifier(node)
      surfaces[key] = decal.surface
      colors[key] = decal.color
      styles[key] = decal.style
      texturePayloads[key] = decal.texturePNG
      normalPayloads[key] = decal.normalPNG
      if decal.surface == "faceMesh", let geometry = lastFaceGeometry {
        bindings[key] = FrontMaskFaceBinding.bind(localPosition: node.simdPosition,
                                                   orientation: node.simdOrientation,
                                                   geometry: geometry,
                                                   maxDistance: 0.05)
      }
      loaded.append(node)
      groups[decal.strokeIndex ?? 0, default: []].append(node)
    }
    // Rebuild the original stroke grouping so one undo removes one stroke, not
    // the whole loaded mask. Masks saved before grouping existed land in a
    // single group and behave exactly as they used to.
    strokes = groups.keys.sorted().compactMap { groups[$0] }.filter { !$0.isEmpty }
    beginMaskTransition(pieces: loaded)
    activeMaskID = document.id
    markCounter = loaded.count
    emitHistory()
    onMaskLoaded(["id": document.id.uuidString, "name": document.name, "markCount": loaded.count])
    return loaded.count
  }

  func resumeAutosave() throws -> Int {
    guard let id = FrontMaskPaintStore.shared.autosave?.id else { return 0 }
    return try loadMask(id: id.uuidString)
  }

  func deleteMask(id: String) {
    guard let uuid = UUID(uuidString: id) else { return }
    FrontMaskPaintStore.shared.delete(uuid)
    if activeMaskID == uuid { activeMaskID = nil }
    emitMasksChanged()
  }

  func duplicateMask(id: String) throws -> [String: Any] {
    guard let uuid = UUID(uuidString: id),
          let copy = FrontMaskPaintStore.shared.duplicate(uuid) else {
      throw FrontMaskError.maskNotFound
    }
    emitMasksChanged()
    return FrontMaskPaintStore.shared.metadata()
      .first(where: { ($0["id"] as? String) == copy.id.uuidString }) ?? [:]
  }

  func listMasks() -> [[String: Any]] {
    FrontMaskPaintStore.shared.reload()
    return FrontMaskPaintStore.shared.metadata()
  }

  func snapshotToTmpFile() throws -> String { try writeSnapshotToTmp(arView.snapshot()) }

  /// Decals live under the identity-transform paint root, so their own
  /// `simdTransform` already IS the face-local matrix. Saving no longer needs a
  /// tracked face, and the stroke grouping is stored so undo stays per-stroke
  /// after a reload.
  private func collectDecals() -> [FrontMaskSavedDecal] {
    var output: [FrontMaskSavedDecal] = []
    for (index, stroke) in strokes.enumerated() {
      for node in stroke {
        guard let plane = node.geometry as? SCNPlane else { continue }
        let key = ObjectIdentifier(node)
        output.append(FrontMaskSavedDecal(transform: node.simdTransform,
                                          width: Float(plane.width),
                                          height: Float(plane.height),
                                          style: styles[key] ?? "spray",
                                          color: colors[key] ?? brushColor,
                                          surface: surfaces[key] ?? "faceMesh",
                                          texturePNG: texturePayloads[key],
                                          normalPNG: normalPayloads[key],
                                          strokeIndex: index))
      }
    }
    return output
  }

  private func scheduleAutosave() {
    autosaveWork?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.autosave(force: false) }
    autosaveWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: work)
  }

  private func autosave(force: Bool) {
    if !force, isPainting { return }
    let decals = collectDecals()
    let canvas = faceCanvasData()
    guard !decals.isEmpty || canvas.image != nil else { return }
    FrontMaskPaintStore.shared.storeAutosave(decals: decals,
                                             canvasPNG: canvas.image,
                                             canvasBasePNG: canvas.base,
                                             thumbnail: arView.snapshot())
    emitMasksChanged()
  }

  private func emitHistory() {
    onHistoryChanged(["undoCount": strokes.count, "redoCount": redoStrokes.count,
                      "markCount": strokes.reduce(0) { $0 + $1.count }])
  }

  private func emitMasksChanged() {
    onMasksChanged(["masks": FrontMaskPaintStore.shared.metadata()])
  }

  // MARK: AR Draw saved-mask transition

  private func beginMaskTransition(pieces: [SCNNode]) {
    guard faceNode != nil else { return }
    flushMaskReveal()
    pieces.forEach { $0.isHidden = true }
    let plan = maskTransition.begin(pieceCount: pieces.count,
                                    now: CACurrentMediaTime(),
                                    currentAngle: maskSpinAngle)
    maskTransitionPieces = plan.order.compactMap { $0 < pieces.count ? pieces[$0] : nil }
    maskTransitionRevealed = 0
    maskBackdropRest = faceNode?
      .childNode(withName: "faceBackdrop", recursively: false)?.simdTransform
    DispatchQueue.main.async {
      UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 0.7)
    }
  }

  private func flushMaskReveal() {
    for piece in maskTransitionPieces where piece.parent != nil { piece.isHidden = false }
    maskTransitionPieces = []
    maskTransitionRevealed = 0
  }

  private func updateMaskTransition(time: TimeInterval) {
    guard maskTransition.state != .idle else { return }
    guard faceNode != nil, trackedFace else {
      endMaskTransition()
      return
    }
    maskSpinAngle = maskTransition.spinAngle(now: time)
    applyMaskSpin(angle: maskSpinAngle, progress: maskTransition.spinProgress(now: time))
    let target = min(maskTransition.step(now: time), maskTransitionPieces.count)
    if target > maskTransitionRevealed {
      for index in maskTransitionRevealed..<target {
        maskTransitionPieces[index].isHidden = false
      }
      maskTransitionRevealed = target
    }
    if maskTransition.isFinished(now: time) { endMaskTransition() }
  }

  private func endMaskTransition() {
    guard maskTransition.state != .idle else { return }
    flushMaskReveal()
    maskTransition.markCompleted()
    maskSpinAngle = 0
    applyMaskSpin(angle: 0, progress: 1)
    maskBackdropRest = nil
  }

  private func applyMaskSpin(angle: Float, progress: Double) {
    guard let face = faceNode else { return }
    let backdrop = face.childNode(withName: "faceBackdrop", recursively: false)
    guard angle != 0 else {
      face.pivot = SCNMatrix4Identity
      if let backdrop, let rest = maskBackdropRest { backdrop.simdTransform = rest }
      return
    }
    let swell = 1 + Float(sin(min(progress, 1) * .pi))
      * Float(FaceMaskTransitionConfig.spinSwell)
    let wanted = simd_mul(simd_float4x4(SCNMatrix4MakeRotation(angle, 0, 1, 0)),
                          simd_float4x4(SCNMatrix4MakeScale(swell, swell, swell)))
    let pivot = wanted.inverse
    face.simdPivot = pivot
    if let backdrop, let rest = maskBackdropRest {
      backdrop.simdTransform = simd_mul(pivot, rest)
    }
  }

  // MARK: AR Draw spray can

  private func setupSprayCan() {
    let can = SCNNode()
    can.name = "frontMaskSprayCan"
    let targetHeight: Float = 0.14
    var bodyRadius: Float = 0.026
    if let model = loadResourceModel(name: "spraycan", ext: "usdz") {
      let bounds = hierarchyBounds(of: model)
      let height = max(0.0001, bounds.max.y - bounds.min.y)
      let scale = targetHeight / height
      model.scale = SCNVector3(scale, scale, scale)
      let center = SCNVector3((bounds.max.x + bounds.min.x) * 0.5,
                              (bounds.max.y + bounds.min.y) * 0.5,
                              (bounds.max.z + bounds.min.z) * 0.5)
      model.position = SCNVector3(-center.x * scale, -center.y * scale, -center.z * scale)
      bodyRadius = max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 0.5 * scale
      canTopY = (bounds.max.y - center.y) * scale
      model.enumerateHierarchy { node, _ in
        node.geometry?.materials.forEach {
          $0.isDoubleSided = true
          $0.lightingModel = .physicallyBased
          $0.metalness.contents = NSNumber(value: 0.9)
          $0.roughness.contents = NSNumber(value: 0.18)
        }
        if node.geometry != nil { node.renderingOrder = Self.canRenderOrder }
      }
      can.addChildNode(model)
    } else {
      let geometry = SCNCylinder(radius: CGFloat(bodyRadius), height: CGFloat(targetHeight))
      let material = SCNMaterial()
      material.lightingModel = .physicallyBased
      material.diffuse.contents = UIColor(white: 0.86, alpha: 1)
      material.metalness.contents = NSNumber(value: 0.95)
      material.roughness.contents = NSNumber(value: 0.18)
      geometry.firstMaterial = material
      can.addChildNode(SCNNode(geometry: geometry))
    }

    let labelGeometry = SCNCylinder(radius: CGFloat(bodyRadius * 1.01),
                                    height: CGFloat(targetHeight * 0.5))
    let label = SCNMaterial()
    label.lightingModel = .constant
    label.diffuse.contents = canLabelTexture(color: brushColor)
    label.blendMode = .alpha
    labelGeometry.firstMaterial = label
    let labelNode = SCNNode(geometry: labelGeometry)
    labelNode.position.y = -targetHeight * 0.04
    labelNode.renderingOrder = Self.canRenderOrder + 1
    can.addChildNode(labelNode)
    labelMaterial = label

    let capHeight = targetHeight * 0.1456
    let capRadius = bodyRadius * 0.82 / 3
    let capGeometry = SCNCylinder(radius: CGFloat(capRadius), height: CGFloat(capHeight))
    let capMaterial = SCNMaterial()
    capMaterial.lightingModel = .lambert
    capMaterial.diffuse.contents = UIColor.white
    capGeometry.firstMaterial = capMaterial
    let cap = SCNNode(geometry: capGeometry)
    cap.name = "sprayCap"
    sprayHeadRestY = canTopY - capHeight * 0.3
    sprayHeadPressDepth = capHeight * 0.1
    cap.position.y = sprayHeadRestY
    cap.renderingOrder = Self.canRenderOrder + 2
    can.addChildNode(cap)
    sprayHeadNode = cap

    let dotGeometry = SCNSphere(radius: CGFloat(capRadius * 0.55))
    let dotMaterial = SCNMaterial()
    dotMaterial.lightingModel = .lambert
    dotMaterial.diffuse.contents = brushColor
    dotGeometry.firstMaterial = dotMaterial
    let dot = SCNNode(geometry: dotGeometry)
    dot.name = "sprayColorDot"
    dot.position = SCNVector3(0, capHeight * 0.25, -capRadius * 0.85)
    cap.addChildNode(dot)

    let nozzle = SCNNode()
    nozzle.position = SCNVector3(0, canTopY, -bodyRadius * 0.3)
    nozzle.renderingOrder = Self.canRenderOrder + 20
    can.addChildNode(nozzle)
    sprayNozzleNode = nozzle

    let particles = SCNParticleSystem()
    particles.birthRate = 0
    particles.emissionDuration = 1
    particles.particleLifeSpan = 1.45
    particles.particleLifeSpanVariation = 0.5
    particles.emittingDirection = SCNVector3(0, 0, -1)
    particles.spreadingAngle = 11
    particles.particleSize = 0.0026
    particles.particleSizeVariation = 0.0016
    particles.particleAngleVariation = 180
    particles.stretchFactor = 0.3
    particles.birthDirection = .constant
    particles.blendMode = .alpha
    particles.isLightingEnabled = false
    particles.acceleration = SCNVector3(0, -0.08, 0)
    particles.particleVelocity = 0.85
    particles.particleVelocityVariation = 0.4
    particles.particleDiesOnCollision = false
    particles.particleBounce = 0.62
    particles.particleBounceVariation = 0.5
    particles.particleFriction = 0.42
    particles.dampingFactor = 0.22
    let growth = CAKeyframeAnimation()
    growth.values = [0.3, 0.85, 1.5, 1.7]
    growth.keyTimes = [0, 0.45, 0.8, 1]
    let fade = CAKeyframeAnimation()
    fade.values = [0.45, 0.95, 0.9, 0.6, 0]
    fade.keyTimes = [0, 0.25, 0.6, 0.85, 1]
    particles.propertyControllers = [
      .size: SCNParticlePropertyController(animation: growth),
      .opacity: SCNParticlePropertyController(animation: fade),
    ]
    particles.particleImage = sprayTexture(color: brushColor)
    nozzle.addParticleSystem(particles)
    sprayParticles = particles

    can.isHidden = true
    can.simdScale = SIMD3<Float>(repeating: 0.25)
    arView.scene.rootNode.addChildNode(can)
    sprayCanNode = can
  }

  private func setSpraying(_ active: Bool) {
    let mistTool = brushMode == "spray" || brushMode == "relief"
    sprayParticles?.birthRate = active && sprayCanEnabled && mistTool ? 200 : 0
    if let head = sprayHeadNode {
      head.position.y = active ? sprayHeadRestY - sprayHeadPressDepth : sprayHeadRestY
    }
  }

  private func updateSprayFollower() {
    guard sprayCanEnabled, let can = sprayCanNode, let target = toolTarget else {
      sprayCanNode?.isHidden = true
      return
    }
    can.isHidden = false
    let standoff: Float = 0.018
    let desiredPosition = target + toolNormal * standoff
    let follow: Float = isPainting ? 0.85 : 0.45
    can.simdPosition = simd_mix(can.presentation.simdWorldPosition, desiredPosition,
                                SIMD3<Float>(repeating: follow))
    let desired = simd_quatf(from: SIMD3<Float>(0, 0, -1),
                             to: simd_normalize(target - desiredPosition))
    can.simdOrientation = simd_slerp(can.presentation.simdWorldOrientation, desired,
                                     isPainting ? 0.7 : 0.25)
    if let nozzle = sprayNozzleNode {
      let nozzleWorld = nozzle.presentation.simdWorldPosition
      let direction = simd_normalize(target - nozzleWorld)
      let local = can.presentation.simdWorldOrientation.inverse.act(direction)
      nozzle.simdOrientation = simd_quatf(from: SIMD3<Float>(0, 0, -1), to: local)
    }
  }

  private func updateCanVisibility() {
    sprayCanNode?.isHidden = !sprayCanEnabled || !trackedFace || toolTarget == nil
  }

  private func applySprayScale() {
    // AR Draw shrinks wall-authored tools to a quarter in selfie mode.
    sprayCanNode?.simdScale = SIMD3<Float>(repeating: 0.25)
    let scale = min(2.5, max(0.35, Float(brushSizeMeters / 0.092)))
    sprayParticles?.spreadingAngle = CGFloat(min(20, max(4, 11 * scale)))
    sprayParticles?.particleSize = CGFloat(min(0.006, max(0.001, 0.0026 * scale)))
  }

  private func updatePaintAppearance() {
    labelMaterial?.diffuse.contents = canLabelTexture(color: brushColor)
    sprayParticles?.particleImage = sprayTexture(color: brushColor)
    sprayHeadNode?.childNode(withName: "sprayColorDot", recursively: true)?
      .geometry?.firstMaterial?.diffuse.contents = brushColor
  }

  private func loadResourceModel(name: String, ext: String) -> SCNNode? {
    let framework = Bundle(for: FrontMaskView.self)
    guard let bundleURL = framework.url(forResource: "EmojiArAssets", withExtension: "bundle"),
          let bundle = Bundle(url: bundleURL),
          let url = bundle.url(forResource: name, withExtension: ext),
          let scene = try? SCNScene(url: url, options: nil) else { return nil }
    let wrapper = SCNNode()
    scene.rootNode.childNodes.forEach { wrapper.addChildNode($0) }
    return wrapper
  }

  private func hierarchyBounds(of root: SCNNode) -> (min: SCNVector3, max: SCNVector3) {
    var low = SCNVector3(Float.greatestFiniteMagnitude, Float.greatestFiniteMagnitude,
                         Float.greatestFiniteMagnitude)
    var high = SCNVector3(-Float.greatestFiniteMagnitude, -Float.greatestFiniteMagnitude,
                          -Float.greatestFiniteMagnitude)
    var found = false
    root.enumerateHierarchy { node, _ in
      guard node.geometry != nil else { return }
      let bounds = node.boundingBox
      for x in [bounds.min.x, bounds.max.x] {
        for y in [bounds.min.y, bounds.max.y] {
          for z in [bounds.min.z, bounds.max.z] {
            let point = root.convertPosition(SCNVector3(x, y, z), from: node)
            low.x = min(low.x, point.x); low.y = min(low.y, point.y); low.z = min(low.z, point.z)
            high.x = max(high.x, point.x); high.y = max(high.y, point.y); high.z = max(high.z, point.z)
            found = true
          }
        }
      }
    }
    return found ? (low, high) : (SCNVector3(-0.05, -0.07, -0.05), SCNVector3(0.05, 0.07, 0.05))
  }

  private func canLabelTexture(color: UIColor) -> UIImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1024, height: 512))
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    return renderer.image { context in
      for centerX in [CGFloat(256), CGFloat(768)] {
        color.setFill()
        context.cgContext.fillEllipse(in: CGRect(x: centerX - 130, y: 60, width: 260, height: 260))
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        NSAttributedString(string: "ARPAINTER", attributes: [
          .font: UIFont.systemFont(ofSize: 34, weight: .black),
          .foregroundColor: UIColor(white: 0.1, alpha: 0.95),
          .kern: 4.0, .paragraphStyle: paragraph,
        ]).draw(in: CGRect(x: centerX - 220, y: 366, width: 440, height: 44))
        NSAttributedString(string: "SPRAY · v\(version)", attributes: [
          .font: UIFont.systemFont(ofSize: 18, weight: .semibold),
          .foregroundColor: UIColor(white: 0.35, alpha: 0.9),
          .kern: 2.0, .paragraphStyle: paragraph,
        ]).draw(in: CGRect(x: centerX - 160, y: 418, width: 320, height: 28))
      }
    }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    DispatchQueue.main.async { [weak self] in self?.onArError(["message": error.localizedDescription]) }
  }

  func sessionWasInterrupted(_ session: ARSession) {
    DispatchQueue.main.async { [weak self] in self?.onFaceChanged(["count": 0]) }
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    DispatchQueue.main.async { [weak self] in self?.applyRunState() }
  }
}

/// One GPU/SceneKit surface for an entire Texture or Relief drag. The previous
/// implementation allocated a plane, material and PNG for every interpolated
/// dab; a quick stroke could therefore create hundreds of images and exhaust
/// the phone. This canvas is updated in-place and persisted as one diffuse map
/// plus (optionally) one normal map.
private final class MergedAreaStrokeSurface {
  let node: SCNNode
  let sourceImage: CGImage?

  private let side: Int
  private let span: CGFloat
  private let mode: String
  private let lineStyle: String
  private let color: UIColor
  private let normalEnabled: Bool
  private let diffuseContext: CGContext
  private let heightContext: CGContext?
  private var stampCount = 0
  private var random = SeededRandom(seed: UInt64(CACurrentMediaTime() * 1_000_000))

  init?(side: Int, span: CGFloat, mode: String, lineStyle: String,
        color: UIColor, normalEnabled: Bool, sourceImage: CGImage?) {
    guard side >= 64, span > 0,
          let diffuse = CGContext(data: nil, width: side, height: side,
                                  bitsPerComponent: 8, bytesPerRow: side * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let height = mode == "relief"
      ? CGContext(data: nil, width: side, height: side,
                  bitsPerComponent: 8, bytesPerRow: side * 4,
                  space: CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      : nil
    self.side = side
    self.span = span
    self.mode = mode
    self.lineStyle = lineStyle
    self.color = color
    self.normalEnabled = normalEnabled
    self.sourceImage = sourceImage
    diffuseContext = diffuse
    heightContext = height
    diffuse.clear(CGRect(x: 0, y: 0, width: side, height: side))
    height?.clear(CGRect(x: 0, y: 0, width: side, height: side))

    let plane = SCNPlane(width: span, height: span)
    let material = SCNMaterial()
    material.name = "frontMask|\(mode)Merged|live"
    material.lightingModel = mode == "relief" ? .physicallyBased : .constant
    material.diffuse.contents = UIColor.clear
    material.isDoubleSided = true
    material.blendMode = .alpha
    material.transparencyMode = .aOne
    material.writesToDepthBuffer = false
    material.readsFromDepthBuffer = true
    if mode == "relief" {
      material.roughness.contents = NSNumber(value: 0.22)
      material.specular.contents = UIColor.white
    }
    plane.firstMaterial = material
    node = SCNNode(geometry: plane)
    node.name = "maskFacePaintMerged"
    node.categoryBitMask = FrontMaskView.paintCategory
    node.castsShadow = false
  }

  /// True while a dab of `size` still fits inside this tile. When it stops
  /// being true the caller finishes the tile and opens a fresh one, which is
  /// how a long drag keeps full resolution instead of being clipped.
  func covers(localPosition: SIMD3<Float>, in space: SCNNode, size: CGFloat) -> Bool {
    let local = node.simdConvertPosition(localPosition, from: space)
    let half = Float(span * 0.5) - Float(size * 0.6)
    guard half > 0 else { return true }
    return abs(local.x) <= half && abs(local.y) <= half
      && abs(local.z) <= Float(span * 0.5)
  }

  func stamp(localPosition: SIMD3<Float>, in face: SCNNode,
             size: CGFloat, cameraCrop: UIImage?) {
    let local = node.simdConvertPosition(localPosition, from: face)
    let scale = CGFloat(side) / span
    let center = CGPoint(x: CGFloat(side) * 0.5 + CGFloat(local.x) * scale,
                         y: CGFloat(side) * 0.5 + CGFloat(local.y) * scale)
    let radius = max(2, size * scale * 0.5)
    guard center.x > -radius * 2, center.x < CGFloat(side) + radius * 2,
          center.y > -radius * 2, center.y < CGFloat(side) + radius * 2 else { return }

    if lineStyle == "spray" {
      for _ in 0..<8 {
        let angle = random.nextDouble() * .pi * 2
        let spread = CGFloat(0.15 + random.nextDouble() * 0.72) * radius
        let dabRadius = radius * CGFloat(0.16 + random.nextDouble() * 0.34)
        let point = CGPoint(x: center.x + CGFloat(cos(angle)) * spread,
                            y: center.y + CGFloat(sin(angle)) * spread)
        drawDab(at: point, radius: dabRadius, alpha: CGFloat(0.34 + random.nextDouble() * 0.62),
                cameraCrop: cameraCrop)
      }
    } else {
      drawDab(at: center, radius: radius, alpha: 1, cameraCrop: cameraCrop)
    }
    stampCount += 1
    if stampCount == 1 || stampCount % 3 == 0 { refreshDiffuse() }
  }

  private func drawDab(at center: CGPoint, radius: CGFloat,
                       alpha: CGFloat, cameraCrop: UIImage?) {
    let rect = CGRect(x: center.x - radius, y: center.y - radius,
                      width: radius * 2, height: radius * 2)
    diffuseContext.saveGState()
    diffuseContext.setAlpha(alpha)
    diffuseContext.addEllipse(in: rect)
    diffuseContext.clip()
    if mode == "texture", let image = cameraCrop?.cgImage {
      diffuseContext.draw(image, in: rect)
    } else {
      diffuseContext.setFillColor(color.cgColor)
      diffuseContext.fill(rect)
    }
    diffuseContext.restoreGState()

    guard let heightContext else { return }
    heightContext.saveGState()
    heightContext.setAlpha(alpha)
    // Keep the captured height uncut, like AR Draw's Relief builder. The
    // diffuse alpha already clips visibility; clipping the Sobel source too
    // creates a false raised ridge around every dab.
    if let image = cameraCrop?.cgImage {
      heightContext.draw(image, in: rect)
    } else {
      heightContext.setFillColor(UIColor.white.cgColor)
      heightContext.fill(rect)
    }
    heightContext.restoreGState()
  }

  private func refreshDiffuse() {
    guard let image = diffuseContext.makeImage() else { return }
    node.geometry?.firstMaterial?.diffuse.contents = image
  }

  func finish() -> (diffuse: Data?, normal: Data?) {
    refreshDiffuse()
    guard let diffuse = diffuseContext.makeImage() else { return (nil, nil) }
    let diffuseData = UIImage(cgImage: diffuse).pngData()
    let needsNormal = mode == "relief" || normalEnabled
    let height = heightContext?.makeImage() ?? diffuse
    let normalImage = needsNormal
      ? FrontMaskView.normalMapImage(from: height, side: side)
      : nil
    let material = node.geometry?.firstMaterial
    if let normalImage {
      material?.lightingModel = .physicallyBased
      material?.normal.contents = normalImage
      material?.normal.intensity = mode == "relief" ? 2.75 : 1.85
      material?.roughness.contents = NSNumber(value: mode == "relief" ? 0.22 : 0.46)
      material?.specular.contents = UIColor.white
      if mode == "relief" {
        material?.emission.contents = color.withAlphaComponent(0.04)
      }
    } else {
      material?.lightingModel = .constant
    }
    return (diffuseData, normalImage?.pngData())
  }
}

/// CPU-readable source and triangle rasteriser ported from AR Draw's
/// ProjectionBaker. They turn a screen projection into a real face-owned atlas.
private final class FrontProjectionBakeSource {
  let width: Int
  let height: Int
  let bytesPerRow: Int
  let pixels: UnsafeMutablePointer<UInt8>
  private let context: CGContext

  init?(image: CGImage) {
    let width = image.width, height = image.height
    guard width > 1, height > 1,
          let context = CGContext(data: nil, width: width, height: height,
                                  bitsPerComponent: 8, bytesPerRow: width * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let data = context.data else { return nil }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    self.context = context
    self.width = width
    self.height = height
    self.bytesPerRow = context.bytesPerRow
    self.pixels = data.assumingMemoryBound(to: UInt8.self)
  }
}

private enum FrontProjectionBaker {
  static func rasterize(destination d: (CGPoint, CGPoint, CGPoint),
                        source s: (CGPoint, CGPoint, CGPoint),
                        into target: UnsafeMutablePointer<UInt8>,
                        width: Int, height: Int, bytesPerRow: Int,
                        from image: FrontProjectionBakeSource) {
    let area = (d.1.x - d.0.x) * (d.2.y - d.0.y)
      - (d.2.x - d.0.x) * (d.1.y - d.0.y)
    guard abs(area) > 1e-7, area.isFinite else { return }
    let minX = max(0, Int((min(d.0.x, d.1.x, d.2.x) - 1).rounded(.down)))
    let maxX = min(width - 1, Int((max(d.0.x, d.1.x, d.2.x) + 1).rounded(.up)))
    let minY = max(0, Int((min(d.0.y, d.1.y, d.2.y) - 1).rounded(.down)))
    let maxY = min(height - 1, Int((max(d.0.y, d.1.y, d.2.y) + 1).rounded(.up)))
    guard minX <= maxX, minY <= maxY else { return }
    let inverseArea = 1 / area
    let bleed: CGFloat = 0.7
    func tolerance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
      bleed * hypot(b.x - a.x, b.y - a.y) / abs(area)
    }
    let t0 = tolerance(d.1, d.2), t1 = tolerance(d.2, d.0), t2 = tolerance(d.0, d.1)
    let sourceMaxX = CGFloat(image.width - 1), sourceMaxY = CGFloat(image.height - 1)
    for y in minY...maxY {
      let py = CGFloat(y) + 0.5
      let row = target + y * bytesPerRow
      for x in minX...maxX {
        let px = CGFloat(x) + 0.5
        let w0 = ((d.1.x - px) * (d.2.y - py)
          - (d.2.x - px) * (d.1.y - py)) * inverseArea
        guard w0 >= -t0 else { continue }
        let w1 = ((d.2.x - px) * (d.0.y - py)
          - (d.0.x - px) * (d.2.y - py)) * inverseArea
        guard w1 >= -t1 else { continue }
        let w2 = 1 - w0 - w1
        guard w2 >= -t2 else { continue }
        let sx = min(sourceMaxX, max(0, w0 * s.0.x + w1 * s.1.x + w2 * s.2.x))
        let sy = min(sourceMaxY, max(0, w0 * s.0.y + w1 * s.1.y + w2 * s.2.y))
        let sourcePixel = image.pixels + Int(sy) * image.bytesPerRow + Int(sx) * 4
        let destinationPixel = row + x * 4
        destinationPixel[0] = sourcePixel[0]
        destinationPixel[1] = sourcePixel[1]
        destinationPixel[2] = sourcePixel[2]
        destinationPixel[3] = 255
      }
    }
  }
}

private struct SeededRandom {
  private var state: UInt64
  init(seed: UInt64) { state = seed == 0 ? 0x9E3779B97F4A7C15 : seed }
  mutating func nextDouble() -> Double {
    state ^= state << 13
    state ^= state >> 7
    state ^= state << 17
    return Double(state & 0x00FF_FFFF) / Double(0x0100_0000)
  }
}

enum FrontMaskError: Error, CustomStringConvertible {
  case emptyMask
  case saveFailed
  case maskNotFound
  case noTrackedFace

  var description: String {
    switch self {
    case .emptyMask: return "Paint something before saving this mask."
    case .saveFailed: return "The mask could not be saved."
    case .maskNotFound: return "That saved mask no longer exists."
    case .noTrackedFace: return "Look at the camera until your face is tracked, then try again."
    }
  }
}

// Kept byte-for-byte in behavior with AR Draw's FaceMaskTransition controller:
// logarithmic reveal duration, shuffled/jittered arrival, continuous spins when
// a second mask interrupts the first, and an ease-out-back landing.
private enum FaceMaskTransitionConfig {
  static let spinDuration: TimeInterval = 0.95
  static let revealStartDelay: TimeInterval = 0.04
  static let minRevealDuration: TimeInterval = 0.9
  static let maxRevealDuration: TimeInterval = 3.0
  static let revealJitter = 0.10
  static let spinSwell = 0.055

  static func revealDuration(pieceCount: Int) -> TimeInterval {
    guard pieceCount > 0 else { return minRevealDuration }
    let scaled = 0.8 + log2(Double(pieceCount + 1)) * 0.22
    return min(max(scaled, minRevealDuration), maxRevealDuration)
  }
}

private enum FaceMaskTransitionState { case idle, preparing, running, completing }

private struct FaceMaskRevealPlan {
  let order: [Int]
  let times: [TimeInterval]
  let duration: TimeInterval

  init(pieceCount: Int, duration: TimeInterval) {
    self.duration = duration
    guard pieceCount > 0 else { order = []; times = []; return }
    order = Array(0..<pieceCount).shuffled()
    let jitterSpan = duration * FaceMaskTransitionConfig.revealJitter
    times = (0..<pieceCount).map { index in
      let progress = Double(index) / Double(max(1, pieceCount - 1))
      let jitter = pieceCount > 1 ? Double.random(in: -jitterSpan...jitterSpan) : 0
      return min(max(progress * duration + jitter, 0), duration)
    }.sorted()
  }

  func revealedCount(at elapsed: TimeInterval) -> Int {
    guard !times.isEmpty else { return 0 }
    if elapsed >= duration { return times.count }
    if elapsed <= 0 { return 0 }
    var low = 0, high = times.count
    while low < high {
      let middle = (low + high) / 2
      if times[middle] <= elapsed { low = middle + 1 } else { high = middle }
    }
    return low
  }
}

private final class FaceMaskTransitionController {
  private(set) var state: FaceMaskTransitionState = .idle
  private(set) var plan: FaceMaskRevealPlan?
  private(set) var spinStartAngle: Float = 0
  private(set) var spinTargetAngle: Float = 0
  private var startTime: TimeInterval = 0

  func begin(pieceCount: Int, now: TimeInterval, currentAngle: Float) -> FaceMaskRevealPlan {
    state = pieceCount > 0 ? .preparing : .completing
    startTime = now
    spinStartAngle = currentAngle
    spinTargetAngle = currentAngle + 2 * .pi
    let made = FaceMaskRevealPlan(
      pieceCount: pieceCount,
      duration: FaceMaskTransitionConfig.revealDuration(pieceCount: pieceCount)
    )
    plan = made
    return made
  }

  func spinProgress(now: TimeInterval) -> Double {
    min(max((now - startTime) / FaceMaskTransitionConfig.spinDuration, 0), 1)
  }

  func spinAngle(now: TimeInterval) -> Float {
    let eased = Self.easeOutBack(spinProgress(now: now))
    return spinStartAngle + (spinTargetAngle - spinStartAngle) * Float(eased)
  }

  func step(now: TimeInterval) -> Int {
    guard let plan else { return 0 }
    if state == .preparing { state = .running }
    return plan.revealedCount(at: now - startTime - FaceMaskTransitionConfig.revealStartDelay)
  }

  func isFinished(now: TimeInterval) -> Bool {
    guard let plan else { return true }
    let elapsed = now - startTime - FaceMaskTransitionConfig.revealStartDelay
    return spinProgress(now: now) >= 1 && elapsed >= plan.duration
  }

  func markCompleted() { state = .idle; plan = nil }

  private static func easeOutBack(_ value: Double) -> Double {
    guard value < 1 else { return 1 }
    let c1 = 0.9, c3 = c1 + 1, shifted = value - 1
    return 1 + c3 * shifted * shifted * shifted + c1 * shifted * shifted
  }
}
