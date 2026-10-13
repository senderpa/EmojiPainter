import ExpoModulesCore
import SceneKit
import UIKit

/// Native SceneKit "dollhouse" inspector for a saved RoomPlan package.
///
/// Replaces the old hand-rolled 2D-canvas fake-3D WebView: real solid
/// geometry, real perspective, and SceneKit's own battle-tested orbit
/// camera controller (smooth inertial drag/pinch, no 45°-snap glitches).
///
/// Walls render as single-sided white planes whose visible face is
/// whichever side points INTO the room (determined per-wall against the
/// room centroid), so orbiting from outside the shell you see straight
/// through into a clean lit-white interior — the "dollhouse" look. Emoji
/// strokes are billboarded at their true captured world position, size and
/// orientation, exactly like the live AR wall so scale reads correctly, and
/// cast a soft shadow onto the walls/floor behind them.
///
/// The room/stroke construction (`populate`) and lighting rig (`addLighting`)
/// are also used headless by `renderThumbnail` — the same dollhouse look
/// used as the saved-room's snapshot thumbnail.
final class RoomPreviewView: ExpoView {
  private let scnView = SCNView()
  private let roomNode = SCNNode()
  private static var emojiTextureCache: [String: UIImage] = [:]

  private static let doorColor = UIColor(red: 0.95, green: 0.72, blue: 0.35, alpha: 0.45)
  private static let windowColor = UIColor(red: 0.45, green: 0.82, blue: 0.98, alpha: 0.4)
  private static let openingColor = UIColor(white: 0.85, alpha: 0.3)
  private static let backgroundColor = UIColor(red: 0.035, green: 0.05, blue: 0.075, alpha: 1)

  var roomDataJSON: String = "" {
    didSet {
      guard oldValue != roomDataJSON else { return }
      rebuild()
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    scnView.scene = SCNScene()
    scnView.scene?.rootNode.addChildNode(roomNode)
    scnView.backgroundColor = Self.backgroundColor
    scnView.allowsCameraControl = true
    scnView.defaultCameraController.interactionMode = .orbitTurntable
    scnView.defaultCameraController.inertiaEnabled = true
    scnView.defaultCameraController.inertiaFriction = 0.12
    scnView.antialiasingMode = .multisampling4X
    scnView.autoenablesDefaultLighting = false
    scnView.rendersContinuously = false
    scnView.isJitteringEnabled = true
    addSubview(scnView)
    if let scene = scnView.scene { Self.addLighting(to: scene) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    scnView.frame = bounds
  }

  private func rebuild() {
    guard Self.populate(roomNode, fromJSON: roomDataJSON) else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.scnView.defaultCameraController.frameNodes([self.roomNode])
    }
  }

  // MARK: - Headless thumbnail render (used for the saved-room snapshot)

  /// Renders the same dollhouse room + strokes as a single flat image, from a
  /// fixed isometric-ish angle framing the whole room. Returns nil when the
  /// payload has no usable wall/floor geometry.
  static func renderThumbnail(fromJSON json: String, size: CGSize) -> UIImage? {
    let root = SCNNode()
    guard populate(root, fromJSON: json) else { return nil }
    let scene = SCNScene()
    scene.rootNode.addChildNode(root)
    scene.background.contents = backgroundColor
    addLighting(to: scene)

    let (minV, maxV) = root.boundingBox
    let center = SCNVector3((minV.x + maxV.x) * 0.5, (minV.y + maxV.y) * 0.5, (minV.z + maxV.z) * 0.5)
    let extent = SCNVector3(maxV.x - minV.x, maxV.y - minV.y, maxV.z - minV.z)
    let radius = max(0.6, max(extent.x, max(extent.y, extent.z)) * 0.5)

    let cameraNode = SCNNode()
    let camera = SCNCamera()
    camera.fieldOfView = 50
    cameraNode.camera = camera
    let distance = radius / tan(25 * Float.pi / 180) * 1.4
    let azimuth: Float = .pi * 0.22
    let elevation: Float = .pi * 0.30
    cameraNode.position = SCNVector3(
      center.x + distance * cos(elevation) * sin(azimuth),
      center.y + distance * sin(elevation),
      center.z + distance * cos(elevation) * cos(azimuth)
    )
    scene.rootNode.addChildNode(cameraNode)
    cameraNode.look(at: center)

    guard let device = MTLCreateSystemDefaultDevice() else { return nil }
    let renderer = SCNRenderer(device: device, options: nil)
    renderer.scene = scene
    renderer.pointOfView = cameraNode
    return renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
  }

  // MARK: - Shared scene construction

  private static func addLighting(to scene: SCNScene) {
    // Soft ambient fill so shadowed areas never go pure black...
    let ambient = SCNNode()
    ambient.light = SCNLight()
    ambient.light?.type = .ambient
    ambient.light?.intensity = 320
    ambient.light?.color = UIColor(white: 0.8, alpha: 1)
    scene.rootNode.addChildNode(ambient)

    // ...plus one shadow-casting "sun" so painted strokes throw a soft shadow
    // across the wall/floor behind them — the only shadow caster is strokes
    // themselves (walls/floor/markers opt out), so the room reads as a lit
    // dollhouse instead of a flat unshaded wireframe.
    let sun = SCNNode()
    sun.light = SCNLight()
    sun.light?.type = .directional
    sun.light?.intensity = 900
    sun.light?.color = UIColor(white: 1, alpha: 1)
    sun.light?.castsShadow = true
    sun.light?.shadowRadius = 6
    sun.light?.shadowSampleCount = 16
    sun.light?.shadowColor = UIColor(white: 0, alpha: 0.55)
    sun.light?.automaticallyAdjustsShadowProjection = true
    sun.light?.shadowMode = .deferred
    sun.eulerAngles = SCNVector3(-Float.pi / 3, Float.pi / 4, 0)
    scene.rootNode.addChildNode(sun)
  }

  /// Clears `root` and rebuilds walls/floor/markers/strokes from a
  /// RoomViewerData-shaped JSON payload. Returns false (root left empty) when
  /// there's no usable wall/floor geometry yet.
  @discardableResult
  private static func populate(_ root: SCNNode, fromJSON json: String) -> Bool {
    root.childNodes.forEach { $0.removeFromParentNode() }

    guard let jsonData = json.data(using: .utf8),
          let payload = (try? JSONSerialization.jsonObject(with: jsonData)) as? [String: Any] else { return false }

    let rawSurfaces = (payload["roomPlanSurfaces"] as? [[String: Any]]) ?? []
    let surfaces: [(category: String, dims: SIMD3<Float>, transform: simd_float4x4)] = rawSurfaces.compactMap { s in
      guard let category = s["category"] as? String,
            let dimsArr = s["dimensions"] as? [Any], dimsArr.count == 3,
            let tArr = s["transform"] as? [Any], tArr.count == 16 else { return nil }
      let dims = SIMD3<Float>(numArr(dimsArr, 0), numArr(dimsArr, 1), numArr(dimsArr, 2))
      let t = simd_float4x4(columns: (
        SIMD4(numArr(tArr, 0), numArr(tArr, 1), numArr(tArr, 2), numArr(tArr, 3)),
        SIMD4(numArr(tArr, 4), numArr(tArr, 5), numArr(tArr, 6), numArr(tArr, 7)),
        SIMD4(numArr(tArr, 8), numArr(tArr, 9), numArr(tArr, 10), numArr(tArr, 11)),
        SIMD4(numArr(tArr, 12), numArr(tArr, 13), numArr(tArr, 14), numArr(tArr, 15))
      ))
      return (category, dims, t)
    }

    let shell = surfaces.filter { $0.category == "wall" || $0.category == "floor" }
    guard !shell.isEmpty else { return false }
    var centroid = SIMD3<Float>(repeating: 0)
    for s in shell { centroid += SIMD3(s.transform.columns.3.x, s.transform.columns.3.y, s.transform.columns.3.z) }
    centroid /= Float(shell.count)

    for surface in surfaces {
      let node: SCNNode
      switch surface.category {
      case "wall":
        node = makeWallNode(dims: surface.dims, transform: surface.transform, centroid: centroid)
      case "floor":
        node = makeFloorNode(dims: surface.dims, transform: surface.transform)
      case "door":
        node = makeMarkerNode(dims: surface.dims, transform: surface.transform, color: doorColor)
      case "window":
        node = makeMarkerNode(dims: surface.dims, transform: surface.transform, color: windowColor)
      default:
        node = makeMarkerNode(dims: surface.dims, transform: surface.transform, color: openingColor)
      }
      root.addChildNode(node)
    }

    var stampCache: [String: SCNPlane] = [:]
    let strokes = (payload["strokes"] as? [[String: Any]]) ?? []
    for stroke in strokes {
      let opacity = (stroke["opacity"] as? Double) ?? 1
      let stamps = (stroke["stamps"] as? [[String: Any]]) ?? []
      for stamp in stamps {
        if let node = makeStampNode(stamp, opacity: CGFloat(opacity), cache: &stampCache) {
          root.addChildNode(node)
        }
      }
    }
    return true
  }

  private static func makeWallNode(dims: SIMD3<Float>, transform: simd_float4x4, centroid: SIMD3<Float>) -> SCNNode {
    let plane = SCNPlane(width: CGFloat(max(0.05, dims.x)), height: CGFloat(max(0.05, dims.y)))
    let material = SCNMaterial()
    material.diffuse.contents = UIColor(white: 0.96, alpha: 1)
    material.lightingModel = .lambert
    material.isDoubleSided = false
    plane.firstMaterial = material
    let node = SCNNode(geometry: plane)
    node.castsShadow = false

    // Visible face is whichever side of the wall points toward the room's
    // center — orbiting from outside the shell then looks straight through
    // into a lit interior instead of a blank exterior face.
    let pos = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
    let worldNormal = simd_normalize(SIMD3<Float>(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z))
    let towardInterior = centroid - pos
    let facesInterior = simd_dot(worldNormal, towardInterior) > 0
    if facesInterior {
      node.simdTransform = transform
    } else {
      let flip = simd_float4x4(simd_quatf(angle: .pi, axis: SIMD3<Float>(0, 1, 0)))
      node.simdTransform = simd_mul(transform, flip)
    }
    return node
  }

  private static func makeFloorNode(dims: SIMD3<Float>, transform: simd_float4x4) -> SCNNode {
    let plane = SCNPlane(width: CGFloat(max(0.05, dims.x)), height: CGFloat(max(0.05, dims.y)))
    let material = SCNMaterial()
    material.diffuse.contents = UIColor(white: 0.8, alpha: 1)
    material.lightingModel = .lambert
    material.isDoubleSided = true
    plane.firstMaterial = material
    let node = SCNNode(geometry: plane)
    node.castsShadow = false
    node.simdTransform = transform
    return node
  }

  private static func makeMarkerNode(dims: SIMD3<Float>, transform: simd_float4x4, color: UIColor) -> SCNNode {
    let plane = SCNPlane(width: CGFloat(max(0.05, dims.x)), height: CGFloat(max(0.05, dims.y)))
    let material = SCNMaterial()
    material.diffuse.contents = color
    material.lightingModel = .constant
    material.isDoubleSided = true
    material.transparencyMode = .default
    material.blendMode = .alpha
    material.writesToDepthBuffer = false
    plane.firstMaterial = material
    let node = SCNNode(geometry: plane)
    node.castsShadow = false
    node.simdTransform = transform
    node.renderingOrder = 5
    return node
  }

  private static func makeStampNode(_ stamp: [String: Any], opacity: CGFloat, cache: inout [String: SCNPlane]) -> SCNNode? {
    guard let p = stamp["p"] as? [Any], p.count == 3,
          let q = stamp["q"] as? [Any], q.count == 4,
          let emoji = stamp["e"] as? String,
          let sizeValue = (stamp["s"] as? Double) ?? (stamp["s"] as? Int).map(Double.init),
          sizeValue > 0 else { return nil }
    let node = SCNNode(geometry: stampGeometry(for: emoji, size: CGFloat(sizeValue), cache: &cache))
    node.simdPosition = SIMD3<Float>(numArr(p, 0), numArr(p, 1), numArr(p, 2))
    node.simdOrientation = simd_quatf(ix: numArr(q, 0), iy: numArr(q, 1), iz: numArr(q, 2), r: numArr(q, 3))
    node.opacity = opacity
    node.renderingOrder = 10
    node.castsShadow = true
    return node
  }

  private static func stampGeometry(for emoji: String, size: CGFloat, cache: inout [String: SCNPlane]) -> SCNPlane {
    let key = "\(emoji)|\(Int(size * 1000))"
    if let cached = cache[key] { return cached }
    let plane = SCNPlane(width: size, height: size)
    let material = SCNMaterial()
    material.diffuse.contents = emojiTexture(for: emoji)
    material.lightingModel = .constant
    material.isDoubleSided = true
    material.transparencyMode = .aOne
    plane.firstMaterial = material
    cache[key] = plane
    return plane
  }

  private static func emojiTexture(for emoji: String) -> UIImage {
    if let cached = emojiTextureCache[emoji] { return cached }
    let side: CGFloat = 128
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
    let image = renderer.image { _ in
      let font = UIFont.systemFont(ofSize: side * 0.82)
      let str = emoji as NSString
      let attrs: [NSAttributedString.Key: Any] = [.font: font]
      let strSize = str.size(withAttributes: attrs)
      let rect = CGRect(x: (side - strSize.width) / 2, y: (side - strSize.height) / 2,
                         width: strSize.width, height: strSize.height)
      str.draw(in: rect, withAttributes: attrs)
    }
    emojiTextureCache[emoji] = image
    return image
  }
}

/// Tolerant Double/Int/NSNumber element read (JSONSerialization can hand back either).
private func numArr(_ arr: [Any], _ index: Int) -> Float {
  guard index < arr.count else { return 0 }
  if let d = arr[index] as? Double { return Float(d) }
  if let i = arr[index] as? Int { return Float(i) }
  if let n = arr[index] as? NSNumber { return n.floatValue }
  return 0
}
