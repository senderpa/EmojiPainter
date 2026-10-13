import ARKit
import AVFoundation
import CoreImage
import CoreMotion
import ExpoModulesCore
import SceneKit

/**
 * WallPaintView — back-camera world tracking; the user paints emoji stamps
 * onto real surfaces with the same tools as the 2D workspace.
 *
 * v5 polish:
 * - No more depth-buffer shadow catchers (they z-fought with strokes and hid
 *   them behind walls). Stamps sit 8mm off the surface and each stamp carries
 *   a soft blob shadow sprite at 4mm — clean, subtle, glitch-free.
 * - Two-part spray can (body + press-down spray head animated while drawing)
 *   with an EMOJIPAINTER brand label showing the current brush emoji + app
 *   version, refreshed when the brush changes.
 * - Generated audio: looping spray hiss while drawing; randomized can-rattle
 *   sound when the phone is shaken (accelerometer, no assets needed).
 * - Particles start smaller and grow over their lifetime.
 */
// Smudge Reach ceiling — a HIGH max (not infinite). Keep in sync with
// AR_SMUDGE_MAX_REACH in ArPaintingScreen.tsx and the EmojiArModule clamp.
private let AR_SMUDGE_MAX_REACH: CGFloat = 2.5

class WallPaintView: ExpoView, ARSCNViewDelegate, ARSessionDelegate, SCNPhysicsContactDelegate {
  private let arView = ARSCNView()
  private var sessionRunning = false
  /// A camera interruption (or an ARKit error while the lens was covered) can
  /// leave an ARSCNView rendering a black background even though the view and
  /// controls are still alive.  Keep a small recovery guard so lifting the
  /// device from a table reactivates the same session without touching strokes.
  private var cameraRecoveryScheduled = false
  /// RoomPlan is an optional, invisible observer of the same ARSession.  It
  /// never owns the camera and its preview root stays hidden by default.
  private let roomPreviewRoot = SCNNode()
  private var roomPlanManagerStorage: Any?
  @available(iOS 17.0, *)
  private var roomPlanManager: RoomPlanManager? {
    get { roomPlanManagerStorage as? RoomPlanManager }
    set { roomPlanManagerStorage = newValue }
  }
  private var roomPreviewEnabled = false
  var roomPlanEnabled = true {
    didSet {
      guard oldValue != roomPlanEnabled else { return }
      if roomPlanEnabled { startRoomPlanCollection() } else { stopRoomPlanCollection() }
    }
  }

  // ── Stroke data model ──────────────────────────────────────────────────────
  private struct StampData {
    let position: SCNVector3
    let orientation: simd_quatf
    let emoji: String
    let size: CGFloat
    // 🖌️ mirror/rotate brush options. AR never applied these to the painted glyph itself — `rotation`
    // is already baked into `orientation` by addStamp(); flip is stored separately since mirroring a
    // mesh needs a negative NODE SCALE, which a rotation quaternion cannot express.
    var flipX: Bool = false
    var flipY: Bool = false
  }

  /// One generation of stroke look-up caches.
  ///
  /// Every effect (melt, wash) is driven by uniforms on SHARED per-emoji
  /// materials, so while a layer is live the whole layer melts together. When
  /// an effect finishes, that layer is *retired*: its materials keep whatever
  /// meltT/washT they had reached, nothing updates them again, and painting
  /// continues on a brand-new live layer at zero. A retired layer is therefore
  /// the baked result — it survives rebuilds, erases, undo and redo, because
  /// each stroke renders through the layer it was painted into.
  private final class RenderLayer {
    var materials: [String: SCNMaterial] = [:]
    var geometries: [String: SCNPlane] = [:]
    /// Frozen layers are never advanced by an effect again.
    var frozen = false
  }

  private final class StrokeRecord {
    var stamps: [StampData] = []
    var node: SCNNode
    let opacity: CGFloat
    let renderingOrder: Int
    /// The cache generation this stroke draws through — its baked appearance.
    let layer: RenderLayer
    /// Rigid displacement left behind by Explode. `stamps` always hold the
    /// ORIGINAL painted positions, so without this a rebuild would teleport a
    /// fallen stroke back onto the wall it fell off.
    var bakedTransform: SCNMatrix4?
    // nil means a legacy/permanent background stroke. A timed stroke is
    // visible from animationStartFrame for animationDuration frames and wraps
    // across the end of the timeline, matching the 2D Animator workspace.
    var animationStartFrame: Int?
    var animationDuration: Int?
    var extraContentCount = 0
    init(
      node: SCNNode,
      opacity: CGFloat,
      renderingOrder: Int,
      layer: RenderLayer,
      animationStartFrame: Int? = nil,
      animationDuration: Int? = nil
    ) {
      self.node = node
      self.opacity = opacity
      self.renderingOrder = renderingOrder
      self.layer = layer
      self.animationStartFrame = animationStartFrame
      self.animationDuration = animationDuration
    }

    var hasContent: Bool {
      !stamps.isEmpty || extraContentCount > 0
    }

    var contentCount: Int {
      stamps.count + extraContentCount
    }
  }

  private enum HistoryEntry {
    case paint(StrokeRecord)
    case paintGroup([StrokeRecord])
    case erase([(record: StrokeRecord, removed: [StampData])])
  }

  private var undoHistory: [HistoryEntry] = []
  private var redoHistory: [HistoryEntry] = []
  private var liveStrokeGroup: SCNNode?
  private var liveStrokeRecord: StrokeRecord?
  private var liveMirrorGroup: SCNNode?
  private var liveMirrorRecord: StrokeRecord?
  // Playback can split one finger gesture into several per-frame records. Keep
  // them grouped so Undo/Redo still operates on the gesture as one action.
  private var liveAnimationGestureRecords: [StrokeRecord] = []
  private var currentEraseBatch: [ObjectIdentifier: (record: StrokeRecord, removed: [StampData])] = [:]
  private var lastStampPosition: SCNVector3?
  private var lastScreenPoint: CGPoint?
  // Per-stroke locked plane: first touch defines it, all stamps stay coplanar
  private var strokePlanePoint: simd_float3?
  private var strokePlaneNormal: simd_float3?
  private var strokeOrientation: simd_quatf?
  private var lineStartResult: ARRaycastResult?
  private var lineEndResult: ARRaycastResult?
  private var totalStampCount = 0
  private var detectedPlaneCount = 0
  /// Lightweight fallback geometry for AR planes that RoomPlan does not
  /// represent.  Strokes remain world-space/editable; this is only saved
  /// correspondence metadata, never a replacement for live AR planes.
  private var retainedARPlaneSurfaces: [[String: Any]] = []

  // ── Pooled live previews (line aim + brush-size) ──────────────────────────
  private let previewRoot = SCNNode()
  private var linePreviewPool: [SCNNode] = []
  private let sizePreviewNode = SCNNode()
  private static let previewRenderOrder = 90_000 // above strokes, below the can

  // ── Scene persistence (ARWorldMap + stroke replay) ─────────────────────────
  private var pendingReplayStrokes: [[String: Any]] = []
  private var isRelocalizing = false
  private var replayTimer: Timer?
  // Painter's algorithm: every stroke gets a higher order — newer is on top
  private var strokeOrderCounter = 10

  // ── Frame Animator ────────────────────────────────────────────────────────
  // Existing nodes are reused; advancing the timeline only toggles visibility.
  // This stays cheap at the 90-frame default even for camera-textured smudges.
  var animationEnabled: Bool = false {
    didSet {
      guard oldValue != animationEnabled else { return }
      dripRoot.isHidden = animationEnabled
      applyAnimationVisibility()
    }
  }
  var animationCurrentFrame: Int = 0 {
    didSet {
      animationCurrentFrame = normalizedAnimationFrame(animationCurrentFrame)
      if oldValue != animationCurrentFrame { applyAnimationVisibility() }
    }
  }
  var animationTotalFrames: Int = 90 {
    didSet {
      animationTotalFrames = max(1, min(animationTotalFrames, 900))
      animationCurrentFrame = normalizedAnimationFrame(animationCurrentFrame)
      applyAnimationVisibility()
    }
  }
  var animationStrokeLength: Int = 3
  var animationFps: Int = 12
  var animationLooping: Bool = true

  // The playback clock lives in JS (a plain interval, like the 2D Animator) and
  // drives `animationCurrentFrame` via prop. This flag only tells the stamper
  // whether we are playing (life = strokeLength) or paused (life = 1 frame).
  var animationPlaying: Bool = false

  /// Explicit scrub/step from JS (harmless: just re-applies the frame).
  func seekAnimation(frame: Int) {
    animationCurrentFrame = frame  // didSet normalizes + applies visibility
    ensureLiveAnimationSegment()
  }

  // Stamps sit just off the surface — in front of the wall occluder so the
  // wall they're painted on doesn't occlude them, but a nearer wall does.
  // ~1.4 cm off the wall — closer again (tighter shadow gap) while still clear of
  // the occluder's depth (no coplanar flicker) and enough to cast a small shadow.
  private static let stampSurfaceOffset: Float = 0.014

  // Shared caches
  private static let emojiTextureCache = NSCache<NSString, UIImage>()
  private static let ciContext = CIContext(options: nil)
  /// The generation new strokes paint into. Retired on freeze; see RenderLayer.
  private var liveLayer = RenderLayer()
  /// Baked generations, kept alive so their strokes keep their effect look.
  private var frozenLayers: [RenderLayer] = []
  /// Live + frozen, for settings that must apply to the whole artwork.
  private var allLayers: [RenderLayer] { [liveLayer] + frozenLayers }
  /// Drips/puddles promoted from transient effect overlay to permanent artwork.
  /// Kept so Clear/Clear All and the sponge can still remove them.
  private var frozenResidueNodes: [SCNNode] = []
  private static let maxStampsPerSession = 20000
  private static let denseSpacingFactor: CGFloat = 0.08

  // ── Spray can companion ────────────────────────────────────────────────────
  private var sprayCanNode: SCNNode?
  private var sprayHeadNode: SCNNode?
  private var labelMaterial: SCNMaterial?
  private var capMaterial: SCNMaterial?
  private var sprayParticles: SCNParticleSystem?
  private var wallColliderNodes: [SCNNode] = []
  private var shadowCatcherNodes: [SCNNode] = []   // hidden while person occlusion is on
  private var sprayTargetPoint: simd_float3?
  // Flow-min repeats the first fully-mapped camera decal for the gesture.
  private var smudgeLockedTexture: UIImage?
  /// A single screen-aligned camera frame frozen at the start of the gesture.
  /// This is deliberately separate from `compositedSmudgeSnapshot`: an
  /// ARSCNView snapshot can contain the SceneKit strokes but, on some iOS/ARKit
  /// combinations, omits the camera background.  Smudge must therefore sample
  /// the real ARFrame first and only use the SceneKit render as a fallback.
  private var smudgeFrozenCameraImage: CGImage?
  private var lastSmudgePoint: CGPoint?
  private var smudgeMaskCache: [String: UIImage] = [:]
  // Throttled `arView.snapshot()` cache so smudge dabs can sample the ACTUAL
  // composited render (camera + already-painted strokes) instead of only the
  // raw camera feed, without paying a full snapshot cost on every dab.
  private var compositedSmudgeSnapshot: UIImage?

  private let sunNode = SCNNode()   // directional "sun" — lerps toward the spray can for smooth AR shadows
  private let ambientNode = SCNNode()  // fill light — kept low so real cast shadows stay visible
  private var presetBaseAmbient: CGFloat = 300  // preset ambient, scaled live by ARKit light estimation
  /// Shared shadow-catcher material. A `.surface` shader modifier FORCES its normal
  /// to face the sun (N·L≡1) so the white multiply plane is uniformly invisible on
  /// EVERY plane orientation — no self-shading, so a grazing wall never darkens as
  /// a "full-plane shadow". Only real cast shadows (position-based) still show.
  private lazy var catcherMaterial: SCNMaterial = {
    let m = SCNMaterial()
    m.lightingModel = .lambert
    m.diffuse.contents = UIColor.white
    m.blendMode = .multiply
    m.writesToDepthBuffer = false
    m.readsFromDepthBuffer = false
    m.isDoubleSided = true
    m.shaderModifiers = [
      .surface: "#pragma arguments\nfloat3 viewLightDir;\n#pragma body\n_surface.normal = normalize(viewLightDir);"
    ]
    m.setValue(NSValue(scnVector3: SCNVector3(0, 0, 1)), forKey: "viewLightDir")
    return m
  }()
  /// PERSON-MODE shadow catcher. Identical shadow signal to `catcherMaterial`, but
  /// output as BLACK with alpha = shadow amount (ALPHA blend) instead of a MULTIPLY
  /// plane. A multiply plane needs the camera in the colour buffer to stay
  /// invisible — which ARKit's people-occlusion compositor removes, so it greys
  /// out. An alpha plane is transparent where lit and only darkens in shadow, so
  /// it composites the SAME in both modes. Used ONLY while person occlusion is on;
  /// the normal (person-off) look is left exactly as it was.
  private lazy var catcherMaterialPersonSafe: SCNMaterial = {
    let m = SCNMaterial()
    m.lightingModel = .lambert
    m.diffuse.contents = UIColor.white
    m.blendMode = .alpha
    m.transparencyMode = .aOne
    m.writesToDepthBuffer = false
    m.readsFromDepthBuffer = false
    m.isDoubleSided = true
    m.shaderModifiers = [
      .surface: "#pragma arguments\nfloat3 viewLightDir;\n#pragma body\n_surface.normal = normalize(viewLightDir);",
      // After lighting, the white catcher is bright where lit and dark only where a
      // cast shadow attenuates the sun. Turn that darkness into alpha over black.
      .fragment: "#pragma body\nfloat L = clamp(dot(_output.color.rgb, float3(0.299, 0.587, 0.114)), 0.0, 1.0);\n_output.color = float4(0.0, 0.0, 0.0, (1.0 - L) * 0.6);"
    ]
    m.setValue(NSValue(scnVector3: SCNVector3(0, 0, 1)), forKey: "viewLightDir")
    return m
  }()

  /// Point every shadow catcher at the right material for the current mode and
  /// keep them VISIBLE (person-off = multiply, person-on = alpha). Never hides.
  private func applyCatcherMode() {
    let mat = personOcclusionEnabled ? catcherMaterialPersonSafe : catcherMaterial
    for n in shadowCatcherNodes {
      n.geometry?.firstMaterial = mat
      n.isHidden = false
    }
  }
  private var presetSunTint: UIColor = .white
  private var lastLightEstimateFrame = 0
  private var currentSunPosition: simd_float3 = .zero
  private var sunPositionInitialized: Bool = false

  // ── Sun / shadow presets (user-selectable in AR settings) ─────────────────
  struct SunPreset {
    let euler: SCNVector3       // sun direction (pitch, yaw, roll)
    let intensity: CGFloat      // directional strength (mostly for the emoji-cutout light, catcher stays white via ambient)
    let ambient: CGFloat        // HIGH fill — keeps the lambert catcher uniformly white so tracked planes NEVER grey
    let shadowAlpha: CGFloat    // 0…1 darkness of the cast shadow (overridden live by the shadowStrength slider)
    let shadowRadius: CGFloat   // blur — small = crisp/hard, large = soft
    let sampleCount: Int
    let tint: UIColor           // warm sun colour (sunset = orange), white = neutral
    let castsShadow: Bool
  }
  // Keep planes from greying WITHOUT killing shadows: HIGH directional intensity +
  // LOW ambient. The sun points mostly straight DOWN (see updateSun), so it clamps
  // the lit catcher to white; a shadowed region loses the directional and drops to
  // the low ambient → visibly dark. (High ambient fills the shadow back in → don't.)
  private static let sunPresets: [String: SunPreset] = [
    "noon":     SunPreset(euler: SCNVector3(-Float.pi / 2.2, -Float.pi / 10, 0), intensity: 1600, ambient: 300, shadowAlpha: 0.5,  shadowRadius: 4,  sampleCount: 16, tint: .white, castsShadow: true),
    "studio":   SunPreset(euler: SCNVector3(-Float.pi / 2.6, -Float.pi / 8,  0), intensity: 1500, ambient: 320, shadowAlpha: 0.42, shadowRadius: 7,  sampleCount: 16, tint: UIColor(white: 1.0, alpha: 1), castsShadow: true),
    "morning":  SunPreset(euler: SCNVector3(-Float.pi / 4.5, -Float.pi / 4,  0), intensity: 1500, ambient: 320, shadowAlpha: 0.44, shadowRadius: 8,  sampleCount: 16, tint: UIColor(red: 1.0, green: 0.97, blue: 0.9, alpha: 1), castsShadow: true),
    "sunset":   SunPreset(euler: SCNVector3(-Float.pi / 6.5,  Float.pi / 4,  0), intensity: 1500, ambient: 300, shadowAlpha: 0.5,  shadowRadius: 9,  sampleCount: 16, tint: UIColor(red: 1.0, green: 0.82, blue: 0.62, alpha: 1), castsShadow: true),
    "hard":     SunPreset(euler: SCNVector3(-Float.pi / 2.4, -Float.pi / 12, 0), intensity: 1750, ambient: 240, shadowAlpha: 0.68, shadowRadius: 1,  sampleCount: 8,  tint: .white, castsShadow: true),
    "soft":     SunPreset(euler: SCNVector3(-Float.pi / 2.3, -Float.pi / 9,  0), intensity: 1450, ambient: 400, shadowAlpha: 0.3,  shadowRadius: 14, sampleCount: 24, tint: .white, castsShadow: true),
    "dramatic": SunPreset(euler: SCNVector3(-Float.pi / 7,   -Float.pi / 3.2, 0), intensity: 1750, ambient: 200, shadowAlpha: 0.78, shadowRadius: 5,  sampleCount: 16, tint: UIColor(red: 0.95, green: 0.95, blue: 1.0, alpha: 1), castsShadow: true),
    // No shadows — flat, evenly lit.
    "off":      SunPreset(euler: SCNVector3(-Float.pi / 2.2, 0, 0), intensity: 1000, ambient: 1050, shadowAlpha: 0, shadowRadius: 0, sampleCount: 1, tint: .white, castsShadow: false),
  ]
  var sunPreset: String = "studio" {
    didSet { if oldValue != sunPreset { applySunPreset(sunPreset) } }
  }
  /// User-controlled shadow darkness 0…1 (drives sun.shadowColor alpha). Overrides
  /// the preset's default so the slider is the single source of "how dark".
  var shadowStrength: Double = 1.0 {
    didSet { applyShadowStrength() }
  }
  private func applyShadowStrength() {
    let a = CGFloat(max(0, min(1, shadowStrength)))
    if let sun = sunNode.light, sun.castsShadow {
      sun.shadowColor = UIColor(white: 0, alpha: a)
    }
  }
  /// How much the sun LIGHTS/shades the strokes themselves, 0 (flat, true colours)
  /// … 1 (fully lit + receives shadows). Implemented via emission.intensity =
  /// 1-amount (emission re-adds the raw texture, cancelling the shading).
  var strokeLightAmount: Double = 0.5 {
    didSet { updateStrokeLightAmount() }
  }
  private func updateStrokeLightAmount() {
    let e = CGFloat(max(0, min(1, 1 - strokeLightAmount)))
    // Look settings apply to the whole artwork, baked layers included.
    for layer in allLayers { for mat in layer.materials.values { mat.emission.intensity = e } }
    // Pop 3D faces use their own depth-testing material, so they need the same
    // slider applied or a converted stroke would ignore the lighting setting.
  }

  /// Blend strokes into the real world: SceneKit distance fog (far strokes fade to
  /// the room colour → a smooth colour gradient over distance) + a room-matched
  /// multiply tint on every stroke (dark room → strokes go much darker, warm room →
  /// warmer). Driven live by ARKit light estimation. Off → strokes render pure.
  private func applyBlendFilter() {
    let scene = arView.scene
    guard blendFilterEnabled else {
      scene.fogStartDistance = 0
      scene.fogEndDistance = 0
      for layer in allLayers { for mat in layer.materials.values { mat.multiply.contents = UIColor.white } }
      return
    }
    // WAY subtler than before: the slider (0…1) now maps to a small effective
    // range — a gentle floor min up to a light max — so even 100% is a soft blend.
    let a = CGFloat(0.03 + max(0, min(1, blendAmount)) * 0.30)   // ≈0.03 … 0.33
    // Fog colour tracks DAY/NIGHT: bright room → near WHITE fog, dark room → DARK
    // fog. `day` = room brightness (0 night … 1 day), tinted a touch by room warmth.
    let day = max(0.05, min(1.0, envBrightness))
    let fog = mixColor(UIColor(white: day, alpha: 1), envColor, 0.25, scaleBrightness: 1.0)
    scene.fogColor = fog
    // Fog pushed much FARTHER (weaker) — only the truly distant strokes fade.
    scene.fogStartDistance = CGFloat(1.6)
    scene.fogEndDistance = CGFloat(9.0 - Double(a) * 6.0)   // ≈8.8 … 7.0m
    scene.fogDensityExponent = 2.0
    // Global tint: white (no change) → room colour × room brightness, by amount.
    let tint = strokeBlendTint(amount: a)
    for layer in allLayers { for mat in layer.materials.values { mat.multiply.contents = tint } }
  }

  /// white → (envColor × envBrightness), lerped by `amount`. Dark room → dark tint.
  private func strokeBlendTint(amount: CGFloat) -> UIColor {
    var r: CGFloat = 1, g: CGFloat = 1, b: CGFloat = 1, al: CGFloat = 1
    envColor.getRed(&r, green: &g, blue: &b, alpha: &al)
    let br = max(0.15, min(1.3, envBrightness))
    return UIColor(red: 1 - amount + amount * r * br,
                   green: 1 - amount + amount * g * br,
                   blue: 1 - amount + amount * b * br,
                   alpha: 1)
  }

  private func mixColor(_ x: UIColor, _ y: UIColor, _ t: CGFloat, scaleBrightness: CGFloat) -> UIColor {
    var xr: CGFloat = 0, xg: CGFloat = 0, xb: CGFloat = 0, xa: CGFloat = 0
    var yr: CGFloat = 0, yg: CGFloat = 0, yb: CGFloat = 0, ya: CGFloat = 0
    x.getRed(&xr, green: &xg, blue: &xb, alpha: &xa)
    y.getRed(&yr, green: &yg, blue: &yb, alpha: &ya)
    let s = max(0.15, min(1.3, scaleBrightness))
    return UIColor(red: (xr*(1-t) + yr*t) * s,
                   green: (xg*(1-t) + yg*t) * s,
                   blue: (xb*(1-t) + yb*t) * s, alpha: 1)
  }

  /// Approx colour of a black-body at `kelvin` (Tanner Helland fit) → the room's warmth.
  private func kelvinColor(_ kelvin: CGFloat) -> UIColor {
    let t = max(1500, min(9000, kelvin)) / 100
    let r: CGFloat = t <= 66 ? 255 : 329.7 * pow(t - 60, -0.1332)
    let g: CGFloat = t <= 66 ? (99.47 * log(t) - 161.1) : 288.1 * pow(t - 60, -0.0755)
    let b: CGFloat = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5 * log(t - 10) - 305.0)
    func c(_ v: CGFloat) -> CGFloat { max(0, min(255, v)) / 255 }
    return UIColor(red: c(r), green: c(g), blue: c(b), alpha: 1)
  }
  /// How fast the sun drifts toward the spray-can/paint point, 0 (glacial) … 1 (snappy).
  var sunFollowSpeed: Double = 0.08
  /// Master toggle: when ON, the sun strongly follows where you aim/paint so the
  /// shadow visibly swings. When OFF, the sun stays fixed overhead (stable shadows).
  var sunFollowEnabled: Bool = false

  // ── Stroke shadows + stacking ─────────────────────────────────────────────
  /// Extra lift (m) added to every stamp while shadows are on, so the cast shadow
  /// has a visible gap from the wall.
  private static let shadowLiftBonus: Float = 0.012
  /// Toggle: strokes cast a real shadow onto AR planes. OFF (default) = clean flat
  /// decals (no shadow, no z-fight). ON = strokes write depth + cast + sit further off.
  var strokeShadowsEnabled: Bool = false {
    didSet { guard oldValue != strokeShadowsEnabled else { return }; applyStrokeShadowSetting() }
  }
  /// Toggle: painting OVER an already-painted spot lifts the new stroke a hair more
  /// each time, so layers stack without z-fighting. Default off.
  var strokeStackingEnabled: Bool = false
  /// 0…1 → per-layer lift 0.4mm … 3.0mm (kept intentionally minimal).
  var strokeStackHeight: Double = 0.5
  private var stampStackGrid: [Int64: Int] = [:]   // 2cm cell → layers already there
  private var liveStrokeCells: Set<Int64> = []       // cells touched by the current stroke
  /// Stamps placed so far in the CURRENT stroke — drives a sub-millimetre rising lift for custom
  /// brushes so consecutive stamps never share a depth plane (see surfaceLift).
  private var liveStampIndex: Int = 0

  private func stackLayerLift() -> Float {
    // 0.5 mm … 9 mm per layer (raised max so tall stacks clear z-fighting).
    return Float(0.0005 + max(0, min(1, strokeStackHeight)) * 0.0085)
  }
  private func stackCellKey(_ p: simd_float3) -> Int64 {
    let q: (Float) -> Int64 = { Int64(($0 / 0.02).rounded()) }
    return (q(p.x) & 0x1FFFFF) | ((q(p.y) & 0x1FFFFF) << 21) | ((q(p.z) & 0x1FFFFF) << 42)
  }
  /// Total surface lift for a stamp at `projected` (base + shadow bonus + stacking).
  private func surfaceLift(at projected: simd_float3) -> Float {
    var offset = Self.stampSurfaceOffset
    if strokeShadowsEnabled { offset += Self.shadowLiftBonus }
    if strokeStackingEnabled {
      let cell = stackCellKey(projected)
      liveStrokeCells.insert(cell)
      offset += Float(stampStackGrid[cell] ?? 0) * stackLayerLift()
    }
    // A cell only stacks AFTER the stroke commits, so every stamp of one stroke inside the same 2cm
    // cell is otherwise EXACTLY coplanar. An emoji glyph is mostly transparent (alpha-discarded), so
    // the overlap is invisible — but a custom brush fills its whole quad, and coplanar filled quads
    // shimmer. Nudge each stamp of the stroke out by 0.02mm; capped so a long stroke still hugs the
    // wall (400 stamps = 8mm) and normal emoji are left exactly as they were.
    if Self.isCustomBrush(brushEmoji) {
      liveStampIndex += 1
      offset += Float(min(liveStampIndex, 400)) * 0.00002
    }
    return offset
  }
  /// After a stroke commits, bump each touched cell so the NEXT overlap stacks higher.
  private func commitStackCells() {
    guard strokeStackingEnabled, !liveStrokeCells.isEmpty else { liveStrokeCells.removeAll(); return }
    for cell in liveStrokeCells { stampStackGrid[cell] = (stampStackGrid[cell] ?? 0) + 1 }
    liveStrokeCells.removeAll()
  }
  private func applyStrokeShadowSetting() {
    for layer in allLayers { for mat in layer.materials.values { mat.writesToDepthBuffer = strokeShadowsEnabled } }
    let apply: (StrokeRecord) -> Void = { record in
      record.node.enumerateHierarchy { n, _ in n.castsShadow = self.strokeShadowsEnabled }
    }
    for entry in undoHistory { paintRecords(in: entry).forEach(apply) }
    for entry in redoHistory { paintRecords(in: entry).forEach(apply) }
    liveAnimationGestureRecords.forEach(apply)
    if let r = liveStrokeRecord { apply(r) }
    if let r = liveMirrorRecord { apply(r) }
  }

  // ── "Blend into the world" filter (fog + scene-matched stroke colour) ──────
  /// Master toggle: blend strokes into the real scene (distance fog + room-matched
  /// brightness/colour so far strokes fade & tint, dark rooms darken strokes).
  var blendFilterEnabled: Bool = false { didSet { applyBlendFilter() } }
  /// 0 (subtle) … 1 (strong) — how hard strokes are pulled toward the scene.
  var blendAmount: Double = 0.5 { didSet { applyBlendFilter() } }
  private var envColor: UIColor = .white   // room colour from ARKit light estimation
  private var envBrightness: CGFloat = 1.0 // room brightness (ambientIntensity/1000)

  /// AR plane occlusion — when ON (default) the detected walls WRITE depth so real
  /// surfaces hide virtual content behind them; OFF keeps them as pure colliders.
  var occlusionEnabled: Bool = true { didSet { applyOcclusion() } }
  private func applyOcclusion() {
    // Walls become a depth MASK (write depth, still invisible so the real wall shows)
    // → they hide the can / particles / placed media behind them. Strokes are left
    // always-on-top (they never read depth) so they don't z-fight each other.
    for node in wallColliderNodes {
      node.geometry?.firstMaterial?.writesToDepthBuffer = occlusionEnabled
    }
  }
  /// Person segmentation — a human in view renders ON TOP of the strokes. Default
  /// off (RN sets it on for iPads, off for iPhones). Re-runs the session on change.
  var personOcclusionEnabled: Bool = false {
    didSet {
      guard oldValue != personOcclusionEnabled else { return }
      // Swap the shadow catchers to the person-safe (alpha) material instead of
      // hiding them — shadows now survive people-occlusion. Nothing else about
      // the planes/light/camera changes; person-off keeps the exact multiply look.
      applyCatcherMode()
      reconfigureSession()
    }
  }

  // ── Paint-drip simulation (thin-film lubrication, exact spec) ─────────────
  private let dripRoot = SCNNode()
  private struct DripCell {
    var thickness: Float
    var position: simd_float3
    var normal: simd_float3
    var emoji: String
    var lastTouch: TimeInterval
    var cooldownUntil: TimeInterval
  }
  private var dripCells: [SIMD3<Int>: DripCell] = [:]
  private final class DripRun {
    let node: SCNNode
    var position: simd_float3 = .zero
    var planePoint: simd_float3 = .zero
    var normal = simd_float3(0, 0, 1)
    var volume: Float = 1
    var initialVolume: Float = 1
    var age: TimeInterval = 0
    var distanceSinceEmit: Float = 0
    var width: Float = 0.004
    var meanderPhase: Float = 0
    var meanderAmp: Float = 0.13    // per-run wiggle amplitude (some straight, some curvy)
    var meanderFreq: Float = 2.3    // per-run wiggle frequency
    var curveBias: Float = 0        // constant lateral drift → drip curves to one side
    var maxTrail: Int = 40          // per-run length cap (some barely run, some go far)
    var v0: Float = 0.062     // per-run head speed (scaled by brush size)
    var emoji = "🙂"
    var colors: [UIColor] = [.red]   // emoji palette → gradient down the run
    var gradient: UIImage?           // smooth vertical blend of the palette
    var headGradient: UIImage?       // rounded fluid tip, generated with the same colours
    var trail: [(pos: simd_float3, scale: Float)] = []
    /// Persistent shove from the human stencil — decays over ~1.6s so pushed
    /// colour keeps drifting for a beat after your hand leaves it.
    var pushVel: simd_float3 = .zero
    var pushSinceEmit: Float = 0
    init(node: SCNNode) { self.node = node }
  }
  private var activeRuns: [DripRun] = []
  private var dripNodePool: [SCNNode] = []
  private var dripPoolCursor = 0
  private var dripClock: TimeInterval = 0
  private var dripLastSweep: TimeInterval = 0
  private final class DripPuddle {
    let node: SCNNode
    var vol: Float
    var colors: [UIColor]
    init(node: SCNNode, vol: Float, colors: [UIColor]) {
      self.node = node
      self.vol = vol
      self.colors = colors
    }
  }
  private var puddles: [SIMD3<Int>: DripPuddle] = [:]
  // Constants — exactly as specified
  private static let dripCellSize: Float = 0.02
  private static let dripCriticalThickness: Float = 1.0
  private static let dripMinSteepness: Float = 0.45
  private static let dripInitialSpeed: Float = 0.062   // base creep (slower, "super slow")
  private static let dripDryingTau: Float = 6.5         // longer cool-off → drips a bit more down
  private static let dripCellDryingTau: Float = 8.0
  private static let dripEmitSpacing: Float = 0.005
  private static let dripMinSpawnSpacing: Float = 0.026
  private static let dripMaxActive = 8
  private static let dripRetained: Float = 0.55
  private static let dripCellCooldown: TimeInterval = 2.0
  private static let dripMaxTrail = 40
  private var lastFrameTime: CFTimeInterval = 0
  private var emojiDominantColors: [String: UIColor] = [:]
  /// Dominant emoji color supplied from JS (the Color-Engine catalog).
  var dripColor: UIColor?
  /// The emoji's top colours (from the JS catalog) for multi-colour drip gradients.
  var dripColors: [UIColor] = []
  private var spraySurfaceNormal = simd_float3(0, 0, 1)
  private var isPaintingNow = false
  /// Render-loop timestamp of the last frame the user was painting — drives the spray can's
  /// show/hide so it never hangs in front of the camera while idle.
  private var lastPaintingTime: TimeInterval = -1000

  // ── Meltdown effect ────────────────────────────────────────────────────────
  // Reuses the drip fluid sim: seed EVERY painted stamp into the film so colour
  // runs down walls / spreads slowly on floors+ceilings. Perf-safe: seeds are
  // downsampled and the number of live runs is capped.
  var meltdownActive = false {
    didSet {
      guard oldValue != meltdownActive else { return }
      if meltdownActive {
        startMeltdownInternal()
      } else if !freezingEffects {
        dripActiveCap = Self.dripMaxActive
        meltProgress = 0
        applyMeltUniforms()   // un-melt: strokes restore to their painted look
      }
    }
  }
  /// Set while an effect is being baked. Switching an effect off normally
  /// rewinds its shader to zero, which is exactly what must NOT happen when the
  /// result is being frozen into the artwork.
  private var freezingEffects = false

  // ── Wash effect ────────────────────────────────────────────────────────────
  /// Wash reuses the melt material uniforms and the whole drip/run/puddle
  /// simulation rather than introducing a second fluid pipeline: the runs
  /// already follow real-world gravity across detected walls and floors and
  /// already pool where they land.
  var washActive = false {
    didSet {
      guard oldValue != washActive else { return }
      if washActive {
        startWashInternal()
      } else if !freezingEffects {
        dripActiveCap = Self.dripMaxActive
        washProgress = 0
        applyWashUniforms()
      }
    }
  }
  private var washClock: TimeInterval = 0
  private var washLastReseed: TimeInterval = 0
  /// 0 → 3.0: how far the wash has run (drives `washT`).
  private var washProgress: Float = 0
  private var lastPushedWashT: Float = -1
  /// Persistent vivid pigments gathered from every emoji in the washed layer.
  /// Runs exchange these colours when they touch instead of averaging to white.
  private var washScenePalette: [UIColor] = []
  /// Camera samples are normal transparent SceneKit planes. Keeping them out of
  /// the shader avoids custom texture uniforms (which SceneKit rendered pink).
  private var washCameraNodes: [SCNNode] = []
  private var washLastCameraDab: TimeInterval = -100
  private var washLastHandSmudge: TimeInterval = -100
  private var washCameraSeedCursor = 0
  /// Live-run cap — raised during meltdown for a richer flow, still bounded.
  private var dripActiveCap = WallPaintView.dripMaxActive
  private static let meltActiveCap = 56
  private var meltClock: TimeInterval = 0
  private var meltLastReseed: TimeInterval = 0
  /// 0 → 1.35: how far the shader melt has progressed (drives `meltT`).
  private var meltProgress: Float = 0
  private var lastPushedMeltT: Float = -1
  private var lastPushedMeltEmis: CGFloat = -1
  /// Downsampled (pos, normal, emoji, stamp-size) seeds computed ONCE at melt start —
  /// committed stamps are immutable, so reseeds replay this list instead of
  /// re-walking the whole undo history every 2.5s.
  private var meltSeeds: [(simd_float3, simd_float3, String, CGFloat)] = []

  /// WetPaint-style melt, fully on GPU. Every fragment below the melt head
  /// resamples the emoji from above (per-column drip lengths + slow time wobble)
  /// so the artwork visibly stretches, sags and runs; the trailing edge drains
  /// (alpha thins → discard erodes it). Phase is hashed from WORLD position so
  /// each spot melts differently but stays stable as the camera moves.
  private static let meltSurfaceModifier = """
  #pragma transparent
  #pragma arguments
  float meltT;
  float meltDirV;
  float meltEmis;
  float washT;
  #pragma body
  // WASH — the paint goes wet and runs off under gravity.
  //
  // Shares this material with melt on purpose: one pipeline, one draw. The
  // difference is behavioural. Melt drains the glyph away; wash keeps sampling
  // it from further up so the artwork STRETCHES downhill, per-column "lanes"
  // give neighbouring parts different viscosities so it breaks into streams
  // rather than sliding as a sheet. Residual streaks are deliberately left
  // behind on the wall; their original emoji pigments stay saturated while
  // the CPU fluid layer below performs the cross-emoji colour mixing.
  if (washT > 0.001) {
    float2 uv = _surface.diffuseTexcoord;
    float4 wwp4 = scn_frame.inverseViewTransform * float4(_surface.position, 1.0);
    float3 wwp = wwp4.xyz;
    float4 wn4 = scn_frame.inverseViewTransform * float4(_surface.normal, 0.0);
    float upness = abs(normalize(wn4.xyz).y);          // 1 = floor or ceiling
    float wph = fract(sin(dot(floor(wwp.xz * 9.0), float2(19.19, 71.77)) + floor(wwp.y * 9.0) * 2.13) * 39187.13);
    float t = clamp(washT, 0.0, 3.0);

    // 1. BLEED — the paint swells and blurs outward from where it was painted,
    //    long before any of it travels. Sampling inward magnifies the artwork,
    //    and the per-spot random means some stamps bloat far more than others.
    float2 c = uv - 0.5;
    float bleed = (0.10 + 0.60 * wph) * t;
    float2 uvB = uv - c * clamp(bleed * 0.5, 0.0, 0.42);

    // 2. FLOW — deliberately late and slow. Nothing runs until it is properly
    //    wet, then each column creeps at its own viscosity. Walls only.
    float lane = fract(sin(floor(uv.x * 26.0) * 91.7 + wph * 13.0) * 4137.17);
    float visc = 0.25 + 0.75 * lane;
    float flow = max(0.0, t - 0.55) * 0.42 * visc * (1.0 - upness);
    float wob = 0.05 * sin(scn_frame.time * 0.5 + wph * 6.2831 + uv.x * 12.0);
    float2 uvF = float2(uvB.x + wob * 0.2 * flow,
                        clamp(uvB.y + meltDirV * (flow + wob * flow), 0.0, 1.0));

    // 3. FLOOR POOLS — where it has landed it is very wet: the sample is swirled
    //    around itself over time and churned, so pooled paint keeps turning and
    //    mixing instead of sitting still.
    float sw = upness * clamp(t * 0.85, 0.0, 1.7);
    float ang = (sin(scn_frame.time * 0.45 + wph * 6.2831) * 0.95 + (wph - 0.5) * 2.2) * sw;
    float ca = cos(ang), sa = sin(ang);
    float2 cc = uvF - 0.5;
    float2 uvS = float2(cc.x * ca - cc.y * sa, cc.x * sa + cc.y * ca) + 0.5;
    uvS += float2(sin(uvS.y * 18.0 + scn_frame.time * 0.8 + wph * 6.0),
                  cos(uvS.x * 16.0 + scn_frame.time * 0.7 + wph * 4.0)) * 0.025 * sw;
    float4 wtex = u_diffuseTexture.sample(u_diffuseTextureSampler, clamp(uvS, 0.0, 1.0));

    float streak = step(0.30, fract(wph * 5.11 + uv.x * 9.37));
    float wet = clamp(max(0.0, t - 0.6) * 0.38, 0.0, 1.0);
    wtex.a *= max(streak * (1.0 - wet * 0.45), 1.0 - wet);
    _surface.diffuse = wtex;
    _surface.emission = float4(wtex.rgb * meltEmis, 0.0);
  }
  if (meltT > 0.001) {
    float2 uv = _surface.diffuseTexcoord;
    float4 wp4 = scn_frame.inverseViewTransform * float4(_surface.position, 1.0);
    float3 wp = wp4.xyz;
    float ph = fract(sin(dot(floor(wp.xz * 11.0), float2(12.9898, 78.233)) + floor(wp.y * 11.0) * 3.7) * 43758.5453);
    float col = 0.55 + 0.45 * sin(uv.x * 34.0 + ph * 6.2831 + sin(uv.x * 87.0 + ph * 12.0));
    float wobble = 0.06 * sin(scn_frame.time * 0.35 + ph * 6.2831 + uv.x * 8.0);
    float amt = clamp(meltT, 0.0, 2.4) * (0.25 + 0.75 * col) + wobble * clamp(meltT, 0.0, 1.0);
    float head = clamp(0.5 + meltDirV * (uv.y - 0.5), 0.0, 1.0);
    float shift = amt * 1.4 * (1.0 - head);
    float vSrc = clamp(uv.y + meltDirV * shift, 0.0, 1.0);
    float4 tex = u_diffuseTexture.sample(u_diffuseTextureSampler, float2(uv.x, vSrc));
    // EXTREME drain: nearly everything runs off the wall — except random
    // leftover bits/specks that survive as marks (per-spot noise keep).
    float keep = step(0.82, fract(ph * 7.31 + uv.x * 3.7 + uv.y * 5.1));
    float drain = clamp(meltT * 0.85, 0.0, 1.0) * (0.35 + 0.65 * head);
    tex.a *= max(keep * 0.9, 1.0 - drain);
    _surface.diffuse = tex;
    _surface.emission = float4(tex.rgb * meltEmis, 0.0);
  }
  if (_surface.diffuse.a < 0.4) { discard_fragment(); }
  """

  /// Quads sag/ooze while melting. Direction is derived per-fragment from the
  /// real surface normal (committed strokes live in world-aligned space):
  ///  • WALL  → gravity downhill along the surface + a slight random sideways lean
  ///  • FLOOR/ceiling → a fully RANDOM in-plane direction per spot, so the actual
  ///    strokes ooze OUTWARD across the top surface (never sink through the floor).
  private static let meltGeometryModifier = """
  #pragma arguments
  float meltT;
  float washT;
  #pragma body
  if (meltT > 0.001 || washT > 0.001) {
    float3 p = _geometry.position.xyz;
    float3 nrm = normalize(_geometry.normal);
    float h  = fract(sin(dot(floor(p.xz * 6.0), float2(12.9898, 78.233)) + floor(p.y * 6.0)) * 43758.5453);
    float h2 = fract(sin(dot(floor(p.zx * 6.0), float2(63.7264, 10.873)) + floor(p.y * 6.0) * 2.3) * 24634.6345);
    float3 side = cross(nrm, float3(0.0, 1.0, 0.0));
    if (length(side) < 1e-3) { side = cross(nrm, float3(1.0, 0.0, 0.0)); }
    side = normalize(side);
    float3 gTan = float3(0.0, -1.0, 0.0) - nrm * dot(float3(0.0, -1.0, 0.0), nrm);
    float gLen = length(gTan);
    float3 dir;
    if (gLen > 0.15) {
      // Wall/slope: mostly downhill, with a bit of random sideways lean.
      dir = normalize(gTan / gLen + side * (h2 - 0.5) * 0.7);
    } else {
      // Floor/ceiling: random in-plane direction → strokes spread on top.
      float ang = h * 6.2831 + h2 * 3.14159;
      dir = normalize(side * cos(ang) + cross(nrm, side) * sin(ang));
    }
    // Melt oozes straight off. Wash holds its ground much longer and then only
    // creeps — the drama comes from swelling, not from travelling.
    float wt = clamp(washT, 0.0, 3.0);
    float travel = clamp(meltT, 0.0, 2.4) * (0.05 + 0.40 * h)
                 + max(0.0, wt - 0.55) * (0.02 + 0.30 * h);
    _geometry.position.xyz += dir * travel;
  }
  """

  /// Push melt progress into the LIVE stroke materials — only when a value
  /// actually changed (meltT saturates at 1.35, so per-frame pushes stop then).
  ///
  /// Frozen layers are deliberately excluded: their materials still hold the
  /// meltT they had when the effect was frozen, and that is precisely what
  /// makes an already-melted stroke stay melted while new paint stays clean.
  private func applyMeltUniforms() {
    let emis = CGFloat(max(0, min(1, 1 - strokeLightAmount)))
    guard abs(meltProgress - lastPushedMeltT) > 0.0005 || abs(emis - lastPushedMeltEmis) > 0.005 else { return }
    lastPushedMeltT = meltProgress
    lastPushedMeltEmis = emis
    for (_, m) in liveLayer.materials {
      m.setValue(CGFloat(meltProgress), forKey: "meltT")
      m.setValue(emis, forKey: "meltEmis")
    }
  }

  // ── Destroy effect (bounded rigid-body physics) ────────────────────────────
  private var destroyActive = false
  private var destroyBodies: [SCNNode] = []
  private var destroyGround: SCNNode?
  private static let destroyMaxBodies = 300
  private var lastHitClickTime: CFTimeInterval = 0
  /// Per-body expiry (random 6–16s life after the drop) + squash throttling.
  private var destroyDeadlines: [ObjectIdentifier: CFTimeInterval] = [:]
  private var lastSquashAt: [ObjectIdentifier: CFTimeInterval] = [:]
  private var personPushFrameCounter = 0
  private var frameCounter = 0
  private static let canHoverDistance: Float = 0.18   // even closer to the paint point
  private static let canMinWallDistance: Float = 0.09
  /// How long the can lingers after the last paint before hiding again.
  private static let canIdleHideDelay: TimeInterval = 0.6

  // ── Media placement (image/video onto walls) ──────────────────────────────
  private var placementNode: SCNNode?
  private var placementPlayer: AVQueuePlayer?
  private var placementLooper: AVPlayerLooper?
  private var pinchRecognizer: UIPinchGestureRecognizer?
  private var brushPinchRecognizer: UIPinchGestureRecognizer?
  private var brushPinchBaseSize: CGFloat = 0.092
  private var isBrushPinching = false
  private static let minBrushMeters: CGFloat = 0.02
  private static let maxBrushMeters: CGFloat = 0.6
  private var placementBaseScale: Float = 1

  // Haptics + audio + shake
  private let sprayHaptics = UIImpactFeedbackGenerator(style: .soft)
  private var lastHapticTime: CFTimeInterval = 0
  private let audioEngine = AVAudioEngine()
  private let sprayPlayer = AVAudioPlayerNode()
  private let fxPlayer = AVAudioPlayerNode()
  private var sprayBuffer: AVAudioPCMBuffer?
  private var audioReady = false
  private let motionManager = CMMotionManager()
  private var lastShakeTime: CFTimeInterval = 0
  // Spray can stays hidden until the user's first paint on an AR plane.
  private var hasTappedPlaneOnce = false
  // Throttle for the funny smudge/alpha blip so a drag doesn't machine-gun it.
  private var lastSmudgeSoundTime: CFTimeInterval = 0
  // SceneKit positional (3D) spray sound emitted from the can node
  private var spraySCNSource: SCNAudioSource?
  private var sprayAudioPlayer: SCNAudioPlayer?
  private var sprayAudioActive = false

  var brushEmoji: String = "🙂" {
    didSet {
      updateSprayParticleImage()
      updateCanLabel()
    }
  }
  var brushSizeMeters: CGFloat = 0.092 {
    didSet { applySprayCanScale(); applySprayParticleDynamics() }
  }
  var brushSpacing: CGFloat = 0
  var brushOpacity: CGFloat = 1.0
  // True once ARKit world tracking is stable enough to place strokes (set from cameraDidChangeTrackingState).
  // Gates painting during the initializing/relocalizing window that caused the start-up "walls jump" drift.
  private var paintingReady = false
  var mirrorX: Bool = false
  // 🖌️ mirror/rotate brush options — the glyph itself, distinct from `mirrorX` above (that one is a
  // paint-SYMMETRY brush: it stamps a second mirrored copy across the screen). Never existed for AR
  // before; wired from the same 2D-engine mirrorX/mirrorY/rotation state as the other two engines.
  var stampMirrorX: Bool = false
  var stampMirrorY: Bool = false
  var stampRotation: Float = 0
  var toolMode: String = "brush" {
    didSet {
      if oldValue != toolMode {
        resetSmudgeGestureState()
        NSLog("[ARSmudge] toolMode → \(toolMode)")
      }
    }
  }
  private var smudgeNodes: [SCNNode] = []
  private var smudgeStampCount = 0
  var smudgeStrength: CGFloat = 0.7   // 0–6 (∞ ceiling), from the extended Reach slider
  var smudgeFocus: CGFloat = 0        // default is a sharp, undiffused lift
  var smudgeFlow: CGFloat = 0.5       // 0 locked first pickup · 0.5 legacy · 1 dense local cloud

  // ── AR-specific settings (driven from the AR settings panel) ──────────────
  var sprayCanEnabled: Bool = true {
    didSet { sprayCanNode?.isHidden = !sprayCanEnabled }
  }
  var soundEnabled: Bool = true {
    didSet { if !soundEnabled { stopSprayHiss() } }
  }
  var gridEnabled: Bool = true

  /// Pause the AR session while keeping all stroke nodes in the scene —
  /// used for fast switching to the face filter and back.
  var paused: Bool = false {
    didSet {
      guard oldValue != paused, window != nil else { return }
      arSwitchLog("wall paused=\(paused) strokes=\(undoHistory.count) hasMap=\(pausedWorldMap != nil)")
      if paused {
        // Ask for the room map first — the request needs a live session. The
        // pause below still happens immediately; whichever map has landed by
        // the time we come back is the one we relocalize against.
        captureWorldMap(force: true)
        saveSwitchState()
        arView.session.pause()
        stopSprayHiss()
      } else if !restoreSwitchStateIfEmpty() {
        resumeSession()
      }
    }
  }
  /// Room map kept across a switch to the front-camera scene, so returning puts
  /// the strokes back exactly where they were painted.
  private var pausedWorldMap: ARWorldMap?
  private var lastWorldMapCapture: CFTimeInterval = 0
  /// Type-level so it survives this view being rebuilt, but not an app restart.
  private static var switchStateArmed = false

  let onBrushSizeChanged = EventDispatcher()
  let onAnimationFrameChanged = EventDispatcher()
  let onAnimationEnded = EventDispatcher()
  // (Specials menu is opened from JS via a double-tap on the 🗑️ button.)
  let onPlanesChanged = EventDispatcher()
  let onSurfaceUnavailable = EventDispatcher()
  let onAnimationLoaded = EventDispatcher()
  let onSceneStatus = EventDispatcher()
  let onHistoryChanged = EventDispatcher()
  let onSessionReady = EventDispatcher()
  let onRoomReadinessChanged = EventDispatcher()
  let onArError = EventDispatcher()
  /// A real paint touch interrupted a running special effect. JS uses this to
  /// keep the specials buttons in sync with the native scene immediately.
  let onStrokeStarted = EventDispatcher()
  /// Emitted only after a new user paint gesture produced committed content.
  /// Scene replay, load, undo, and redo deliberately do not emit this event.
  let onStrokeCommitted = EventDispatcher()
  private var lastSurfaceUnavailableTime: CFTimeInterval = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    arView.delegate = self
    arView.session.delegate = self
    arView.automaticallyUpdatesLighting = false
    arView.isUserInteractionEnabled = false
    arView.antialiasingMode = .none
    arView.preferredFramesPerSecond = 60
    addSubview(arView)
    isMultipleTouchEnabled = true
    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
    pinch.isEnabled = false
    addGestureRecognizer(pinch)
    pinchRecognizer = pinch
    // Always-on pinch to scale the brush (two fingers = resize stroke)
    let brushPinch = UIPinchGestureRecognizer(target: self, action: #selector(handleBrushPinch(_:)))
    addGestureRecognizer(brushPinch)
    brushPinchRecognizer = brushPinch
    setupLights()
    setupSprayCan()
    setupAudio()
    setupShakeDetection()
    arView.scene.rootNode.addChildNode(previewRoot)
    sizePreviewNode.isHidden = true
    sizePreviewNode.renderingOrder = Self.previewRenderOrder
    arView.scene.rootNode.addChildNode(sizePreviewNode)
    arView.scene.rootNode.addChildNode(dripRoot)
    roomPreviewRoot.name = "roomPlanPreview"
    roomPreviewRoot.isHidden = true
    roomPreviewRoot.renderingOrder = -2
    arView.scene.rootNode.addChildNode(roomPreviewRoot)
  }

  deinit {
    // If this ever fires during an AR ⇄ Front switch, the native view is being
    // destroyed and every stroke goes with it — that is a JS remount, not an
    // ARKit problem.
    arSwitchLog("wall view DEINIT — scene destroyed")
    motionManager.stopAccelerometerUpdates()
    audioEngine.stop()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    arView.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    arSwitchLog("wall didMoveToWindow window=\(window != nil) paused=\(paused) running=\(sessionRunning) strokes=\(undoHistory.count)")
    if window != nil {
      if !paused, !restoreSwitchStateIfEmpty() {
        if sessionRunning {
          resumeSession()
        } else {
          startSession()
        }
      }
    } else {
      saveSwitchState()
      arView.session.pause()
      stopRoomPlanCollection()
      stopSprayHiss()
    }
  }

  // MARK: - Lighting (soft shading only; shadows are per-stamp sprites)

  private func setupLights() {
    let sun = SCNLight()
    sun.type = .directional
    // Realtime AR shadows (GPU shadow maps). FORWARD mode (not deferred) so the
    // shadow darkens the white "shadow-catcher" planes that sit on the detected
    // AR planes — deferred only darkens rendered geometry, never the camera feed.
    sun.shadowMode = .forward
    sun.shadowMapSize = CGSize(width: 2048, height: 2048)
    sunNode.light = sun
    arView.scene.rootNode.addChildNode(sunNode)

    let ambient = SCNLight()
    ambient.type = .ambient
    ambientNode.light = ambient
    arView.scene.rootNode.addChildNode(ambientNode)

    applySunPreset(sunPreset)
  }

  /// Reconfigure the sun + ambient from a named preset. Safe to call any time.
  private func applySunPreset(_ name: String) {
    let p = Self.sunPresets[name] ?? Self.sunPresets["studio"]!
    guard let sun = sunNode.light, let ambient = ambientNode.light else { return }
    sun.intensity = p.intensity
    sun.color = p.tint
    sun.castsShadow = p.castsShadow
    // Darkness comes from the user's shadow-strength slider (not the preset), so
    // the slider always wins; presets differ by angle / softness / warmth.
    sun.shadowColor = UIColor(white: 0, alpha: CGFloat(max(0, min(1, shadowStrength))))
    sun.shadowRadius = p.shadowRadius
    sun.shadowSampleCount = p.sampleCount
    ambient.intensity = p.ambient
    // The sun no longer follows the tool — it holds the preset's FIXED angle (stable
    // shadows that don't swing/grey as you move). ARKit light estimation modulates
    // brightness/warmth instead. The spot light (canLight) is what follows the can.
    presetBaseAmbient = p.ambient
    presetSunTint = p.tint
    applyShadowStrength()
  }

  // MARK: - Spray can companion (USDZ model + emoji label + jet particles)

  private var sprayHeadRestY: Float = 0
  private var sprayHeadPressDepth: Float = 0.012
  private var canTopY: Float = 0.07
  /// Position of the particle emitter INSIDE the can node (can-local, unscaled).
  /// The can's own origin sits at its centre, so the nozzle is ~`canTopY` above it.
  /// Placing the can origin on the raycast point therefore drew the jet a whole
  /// half-can-height above where the emoji actually lands (~50 px at arm's
  /// length). The render loop anchors THIS point on the paint target instead,
  /// which stays correct at any screen size, orientation, FOV, distance or wall
  /// angle because it is pure world-space geometry, not a pixel offset.
  private var nozzleLocalOffset = simd_float3(0, 0.07, -0.008)
  // The whole spray can renders on top of strokes (which start at order 10)
  private static let canRenderOrder = 100_000

  private func setupSprayCan() {
    let can = SCNNode()
    can.name = "sprayCan"

    // Target can height (~14cm), matching the previous procedural can
    let targetHeight: Float = 0.14
    var bodyRadius: Float = 0.026

    if let model = loadSprayCanModel() {
      // Scale the model uniformly so its height matches our world size, and
      // recenter it so the can stands at the origin (like the old one).
      let (minB, maxB) = hierarchyBounds(of: model)
      let modelHeight = max(0.0001, maxB.y - minB.y)
      let scale = targetHeight / modelHeight
      model.scale = SCNVector3(scale, scale, scale)
      let centerY = (maxB.y + minB.y) * 0.5
      let centerX = (maxB.x + minB.x) * 0.5
      let centerZ = (maxB.z + minB.z) * 0.5
      model.position = SCNVector3(-centerX * scale, -centerY * scale, -centerZ * scale)
      can.addChildNode(model)

      bodyRadius = max(maxB.x - minB.x, maxB.z - minB.z) * 0.5 * scale
      canTopY = (maxB.y - centerY) * scale

      // Make every part double-sided (fixes cap/back faces that were culled),
      // render the can ON TOP of the strokes, and give the bare metal body a
      // glossy reflective finish (the emoji label is a separate node on top, so
      // it keeps its matte print). environmentTexturing (set on the session)
      // feeds the real surroundings into these reflections.
      model.enumerateHierarchy { child, _ in
        child.geometry?.materials.forEach { mat in
          mat.isDoubleSided = true
          mat.lightingModel = .physicallyBased
          mat.metalness.contents = NSNumber(value: 0.9)   // metallic
          mat.roughness.contents = NSNumber(value: 0.18)  // glossy / reflective
        }
        if child.geometry != nil { child.renderingOrder = Self.canRenderOrder }
      }

    } else {
      // Fallback: simple metallic cylinder
      let bodyGeometry = SCNCylinder(radius: 0.026, height: CGFloat(targetHeight))
      let bodyMaterial = SCNMaterial()
      bodyMaterial.lightingModel = .physicallyBased
      bodyMaterial.diffuse.contents = UIColor(white: 0.86, alpha: 1)
      bodyMaterial.metalness.contents = NSNumber(value: 0.95)
      bodyMaterial.roughness.contents = NSNumber(value: 0.18)
      bodyGeometry.firstMaterial = bodyMaterial
      can.addChildNode(SCNNode(geometry: bodyGeometry))
      canTopY = targetHeight * 0.5
    }

    // Brand label wrap — emoji logo + EMOJIPAINTER + version printed TWICE
    // around the can body, sized to the loaded model's radius.
    let labelGeometry = SCNCylinder(radius: CGFloat(bodyRadius * 1.01), height: CGFloat(targetHeight * 0.5))
    let label = SCNMaterial()
    label.lightingModel = .constant
    label.diffuse.contents = canLabelTexture(emoji: brushEmoji)
    label.transparencyMode = .aOne
    label.blendMode = .alpha
    labelGeometry.firstMaterial = label
    let labelNode = SCNNode(geometry: labelGeometry)
    labelNode.position.y = -targetHeight * 0.04
    labelNode.renderingOrder = Self.canRenderOrder + 1 // over the body
    can.addChildNode(labelNode)
    labelMaterial = label

    // ── Spray CAP — plain white nozzle cylinder on TOP of the can. ──
    let capHeight: Float = targetHeight * 0.1456        // 30% shorter again
    let capRadius: Float = bodyRadius * 0.82 / 3.0      // three times smaller radius
    let capGeo = SCNCylinder(radius: CGFloat(capRadius), height: CGFloat(capHeight))
    let capMat = SCNMaterial()
    capMat.lightingModel = .lambert          // shaded, NOT reflective
    capMat.diffuse.contents = UIColor.white  // plain white cap — no emoji
    capMat.specular.contents = UIColor.black // no glossy highlight
    capMat.isDoubleSided = true
    capGeo.firstMaterial = capMat
    capMaterial = capMat
    let capNode = SCNNode(geometry: capGeo)
    capNode.name = "sprayCap"
    // Sunk 30% deeper than centre → ~80% of the cap buried in the can at rest.
    let capRestY = canTopY - capHeight * 0.3
    capNode.position = SCNVector3(0, capRestY, 0)
    capNode.renderingOrder = Self.canRenderOrder + 2
    can.addChildNode(capNode)
    sprayHeadNode = capNode
    sprayHeadRestY = capRestY
    sprayHeadPressDepth = capHeight * 0.1   // presses a touch deeper while spraying

    // ── Pink nozzle dot on the front of the cap (where particles exit). ──
    let dotRadius: Float = capRadius * 0.55
    let dotGeo = SCNSphere(radius: CGFloat(dotRadius))
    let dotMat = SCNMaterial()
    dotMat.lightingModel = .lambert
    dotMat.diffuse.contents = UIColor(red: 1.0, green: 0.38, blue: 0.55, alpha: 1)  // hot pink
    dotMat.specular.contents = UIColor.black
    dotGeo.firstMaterial = dotMat
    let dotNode = SCNNode(geometry: dotGeo)
    // Front-face of the cap cylinder: -Z direction at the nozzle exit height
    dotNode.position = SCNVector3(0, capHeight * 0.25, -capRadius * 0.85)
    dotNode.renderingOrder = Self.canRenderOrder + 3
    capNode.addChildNode(dotNode)

    // Collider
    let colliderShape = SCNPhysicsShape(
      geometry: SCNCylinder(radius: CGFloat(bodyRadius + 0.004), height: CGFloat(targetHeight)),
      options: nil
    )
    let canBody = SCNPhysicsBody(type: .kinematic, shape: colliderShape)
    // Category 4 = the handheld tool. It shoves fallen Pop 3D strokes (category
    // 1) around as the user sweeps the can past them.
    canBody.categoryBitMask = 4
    canBody.collisionBitMask = 1
    canBody.contactTestBitMask = 1
    canBody.friction = 0.7
    canBody.restitution = 0.05
    can.physicsBody = canBody

    // Nozzle emitter at the top, pointing toward the wall (can's -Z).
    // High renderingOrder so the spray particles draw OVER the strokes (which
    // use lower, incrementing orders) instead of behind them.
    let nozzleNode = SCNNode()
    nozzleNode.position = SCNVector3(0, canTopY, -bodyRadius * 0.3)
    nozzleNode.renderingOrder = Self.canRenderOrder + 20
    can.addChildNode(nozzleNode)
    // Remember where the jet actually leaves the can so the render loop can put
    // THAT point (not the can's centre) on the paint target.
    nozzleLocalOffset = simd_float3(0, canTopY, -bodyRadius * 0.3)

    // ── Jet particles: focused spray that collides + splats on the wall,
    //    lingers a bit, then dissolves its alpha (not an instant cut). ──
    let particles = SCNParticleSystem()
    particles.birthRate = 0
    particles.emissionDuration = 1
    particles.particleLifeSpan = 0.55          // linger after reaching the wall
    particles.particleLifeSpanVariation = 0.22 // more random
    particles.particleVelocity = 1.2
    particles.particleVelocityVariation = 0.45 // more random spread of speed
    particles.emittingDirection = SCNVector3(0, 0, -1)
    particles.spreadingAngle = 6.5             // tighter cone → more concentrated on the paint point
    particles.particleSize = 0.0034            // smaller spray droplets
    particles.particleSizeVariation = 0.002
    particles.particleAngleVariation = 180     // random spin
    particles.stretchFactor = 0.3
    particles.birthDirection = .constant
    // Grow on the way out, then SHRINK over the back half — the droplet hits the
    // wall (bounce) around mid-life, so post-bounce particles read as smaller.
    let growth = CAKeyframeAnimation()
    growth.values = [0.35, 1.0, 1.4, 0.55, 0.3]
    growth.keyTimes = [0, 0.35, 0.55, 0.8, 1]
    let fade = CAKeyframeAnimation()
    fade.values = [0.95, 1.0, 0.85, 0.45, 0.0] // gradual dissolve
    fade.keyTimes = [0, 0.35, 0.6, 0.82, 1]
    particles.propertyControllers = [
      .size: SCNParticlePropertyController(animation: growth),
      .opacity: SCNParticlePropertyController(animation: fade),
    ]
    particles.blendMode = .alpha
    particles.isLightingEnabled = false
    particles.acceleration = SCNVector3(0, -0.08, 0)
    particles.particleVelocity = 0.85          // slower → less tunneling through the thin wall collider
    particles.particleVelocityVariation = 0.4
    // Collide with real surfaces: settle, scatter, slight bounce + redirect
    particles.particleDiesOnCollision = false
    particles.particleBounce = 0.5           // bouncier off the wall
    particles.particleBounceVariation = 0.5
    particles.particleFriction = 0.55
    particles.dampingFactor = 0.4
    particles.colliderNodes = wallColliderNodes
    nozzleNode.addParticleSystem(particles)
    sprayParticles = particles
    updateSprayParticleImage()

    can.isHidden = true
    can.castsShadow = true   // the spray can casts a realtime shadow onto AR planes
    arView.scene.rootNode.addChildNode(can)
    sprayCanNode = can
    applySprayCanScale()
  }

  /// Combined axis-aligned bounds of a node hierarchy, in the node's space.
  private func hierarchyBounds(of root: SCNNode) -> (SCNVector3, SCNVector3) {
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
        let p = root.convertPosition(c, from: node)
        minV.x = min(minV.x, p.x); minV.y = min(minV.y, p.y); minV.z = min(minV.z, p.z)
        maxV.x = max(maxV.x, p.x); maxV.y = max(maxV.y, p.y); maxV.z = max(maxV.z, p.z)
        found = true
      }
    }
    if !found { return (SCNVector3(-0.05, -0.07, -0.05), SCNVector3(0.05, 0.07, 0.05)) }
    return (minV, maxV)
  }

  /// Loads the bundled spray-can USDZ model.
  private func loadSprayCanModel() -> SCNNode? {
    return loadResourceModel(name: "spraycan", ext: "usdz")
  }

  /// Loads the bundled spray-cap model (converted from FBX → USDZ).
  private func loadSprayCapModel() -> SCNNode? {
    return loadResourceModel(name: "spraycap", ext: "usdz")
  }

  private func loadResourceModel(name: String, ext: String) -> SCNNode? {
    let frameworkBundle = Bundle(for: WallPaintView.self)
    guard let bundleUrl = frameworkBundle.url(forResource: "EmojiArAssets", withExtension: "bundle"),
          let resourceBundle = Bundle(url: bundleUrl),
          let url = resourceBundle.url(forResource: name, withExtension: ext),
          let scene = try? SCNScene(url: url, options: nil) else {
      return nil
    }
    let wrapper = SCNNode()
    for child in scene.rootNode.childNodes {
      wrapper.addChildNode(child)
    }
    return wrapper
  }

  /// Sticker texture wrapped around the can: the artwork (emoji logo +
  /// EMOJIPAINTER + version) printed TWICE so it shows on both sides.
  private func canLabelTexture(emoji: String) -> UIImage {
    let size = CGSize(width: 1024, height: 512)
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? ""
    return renderer.image { _ in
      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .center

      // Two artwork blocks → front and back of the cylinder wrap. Real-can look:
      // BIG hero emoji, small letter-spaced brand + tiny version underneath.
      for centerX in [CGFloat(256), CGFloat(768)] {
        // HERO emoji — big and centred.
        let heroRect = CGRect(x: centerX - 180, y: 20, width: 360, height: 360)
        if !drawCustomBrush(emoji, in: heroRect) {
          let emojiAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 300),
            .paragraphStyle: paragraph,
          ]
          (emoji as NSString).draw(in: heroRect, withAttributes: emojiAttributes)
        }

        // Small cool brand, letter-spaced, under the emoji.
        let brandPara = NSMutableParagraphStyle(); brandPara.alignment = .center
        let brand = NSAttributedString(string: "EMOJIPAINTER", attributes: [
          .font: UIFont.systemFont(ofSize: 30, weight: .black),
          .foregroundColor: UIColor(white: 0.1, alpha: 0.95),
          .kern: 4.0,
          .paragraphStyle: brandPara,
        ])
        brand.draw(in: CGRect(x: centerX - 220, y: 372, width: 440, height: 40))

        let versionText = NSAttributedString(string: "SPRAY · v\(version)", attributes: [
          .font: UIFont.systemFont(ofSize: 18, weight: .semibold),
          .foregroundColor: UIColor(white: 0.35, alpha: 0.9),
          .kern: 2.0,
          .paragraphStyle: brandPara,
        ])
        versionText.draw(in: CGRect(x: centerX - 160, y: 418, width: 320, height: 28))
      }
    }
  }

  private func updateCanLabel() {
    let texture = canLabelTexture(emoji: brushEmoji)
    DispatchQueue.main.async { [weak self] in
      self?.labelMaterial?.diffuse.contents = texture
      // capMaterial stays plain white — no emoji on the cap
    }
  }

  private func updateSprayParticleImage() {
    sprayParticles?.particleImage = emojiTexture(for: brushEmoji)
  }

  private var sprayingActive = false

  /// Spray cone, particle size and count all scale with the brush size: a tiny
  /// brush sprays few, small particles in a tight cone; a big brush sprays many,
  /// larger particles in a wider cone.
  private func applySprayParticleDynamics() {
    guard let p = sprayParticles else { return }
    let s = min(2.5, max(0.35, Float(brushSizeMeters / 0.092)))   // 1.0 at default
    p.spreadingAngle = CGFloat(min(13, max(3, 6.5 * s)))          // tighter, more concentrated cone
    p.particleSize = CGFloat(min(0.0085, max(0.0014, 0.0034 * s)))
    let rateScale = CGFloat(min(2.2, max(0.3, s)))                // fewer when small
    p.birthRate = sprayingActive ? 440 * rateScale : 0
  }

  private func setSpraying(_ active: Bool) {
    let painting = active && toolMode != "eraser" && sprayCanEnabled
    sprayingActive = painting
    applySprayParticleDynamics()

    // Interactive cap press: ~50% buried at rest → ~60% while spraying.
    if let head = sprayHeadNode {
      let targetY = painting ? (sprayHeadRestY - sprayHeadPressDepth) : sprayHeadRestY
      head.removeAllActions()
      head.runAction(SCNAction.move(to: SCNVector3(0, targetY, 0), duration: 0.12))
    }

    // Spray hiss (3D from the can)
    if painting && soundEnabled {
      startSprayHiss()
    } else {
      stopSprayHiss()
    }
  }

  // MARK: - Generated audio (no assets)

  private func setupAudio() {
    do {
      try AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
      try AVAudioSession.sharedInstance().setActive(true)
    } catch {
      return
    }
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1) else { return }
    audioEngine.attach(sprayPlayer)
    audioEngine.attach(fxPlayer)
    audioEngine.connect(sprayPlayer, to: audioEngine.mainMixerNode, format: format)
    audioEngine.connect(fxPlayer, to: audioEngine.mainMixerNode, format: format)
    sprayBuffer = Self.makeSprayHissBuffer(format: format)
    do {
      try audioEngine.start()
      audioReady = true
    } catch {
      audioReady = false
    }
    setupSpraySpatialAudio()
  }

  /// Generate a richer hiss, write it to a temp file, and load it as a
  /// POSITIONAL SceneKit audio source so the spray sound comes from the can in
  /// 3D space (panned/attenuated by the camera-listener automatically).
  private func setupSpraySpatialAudio() {
    guard let url = Self.writeSprayHissFile() else { return }
    let source = SCNAudioSource(url: url)
    source?.loops = true
    source?.isPositional = true
    source?.shouldStream = false
    source?.volume = 1.4
    source?.load()
    spraySCNSource = source
  }

  /// 1.2s seamless "pressurised air" hiss (soft lowpass noise + a little
  /// high-frequency sparkle), written to a temp .caf for SceneKit to spatialize.
  private static func writeSprayHissFile() -> URL? {
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1) else { return nil }
    let frames = AVAudioFrameCount(format.sampleRate * 1.2)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
    buffer.frameLength = frames
    guard let data = buffer.floatChannelData?[0] else { return nil }
    var lp: Float = 0
    var prevIn: Float = 0
    for i in 0..<Int(frames) {
      let white = Float.random(in: -1...1)
      lp = lp * 0.86 + white * 0.14          // soft body air
      let sparkle = white - prevIn; prevIn = white   // crude highpass → fizz
      data[i] = (lp * 0.82 + sparkle * 0.07) * 0.6
    }
    let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("emojiar-sprayhiss.caf")
    do {
      let file = try AVAudioFile(forWriting: url, settings: format.settings)
      try file.write(from: buffer)
      return url
    } catch {
      return nil
    }
  }

  /// 0.6s of soft filtered noise — fallback flat hiss (kept for compatibility).
  private static func makeSprayHissBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
    let frames = AVAudioFrameCount(format.sampleRate * 0.6)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
    buffer.frameLength = frames
    guard let data = buffer.floatChannelData?[0] else { return nil }
    var previous: Float = 0
    for i in 0..<Int(frames) {
      let white = Float.random(in: -1...1)
      previous = previous * 0.82 + white * 0.18
      data[i] = previous * 0.16
    }
    return buffer
  }

  /// Start the 3D spray hiss from the can node; fall back to the flat engine
  /// hiss if the positional source isn't ready.
  private func startSprayHiss() {
    if let source = spraySCNSource, let can = sprayCanNode {
      if !sprayAudioActive {
        can.removeAllAudioPlayers()
        let player = SCNAudioPlayer(source: source)
        can.addAudioPlayer(player)
        sprayAudioPlayer = player
        sprayAudioActive = true
      }
      return
    }
    guard audioReady, let buffer = sprayBuffer else { return }
    sprayPlayer.stop()
    sprayPlayer.scheduleBuffer(buffer, at: nil, options: [.loops])
    sprayPlayer.volume = 0.55
    sprayPlayer.play()
  }

  private func stopSprayHiss() {
    if sprayAudioActive, let can = sprayCanNode {
      can.removeAllAudioPlayers()
      sprayAudioPlayer = nil
      sprayAudioActive = false
    }
    sprayPlayer.stop()
  }

  /// Loud metallic can-rattle: the mixing ball clacking inside a steel can —
  /// each hit is a noise click PLUS a damped metallic ring (sine ping).
  private func playShakeRattle() {
    guard audioReady, soundEnabled else { return }
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1) else { return }
    let sr = Float(format.sampleRate)
    let totalSeconds = Double.random(in: 0.5...0.85)
    let frames = AVAudioFrameCount(format.sampleRate * totalSeconds)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
    buffer.frameLength = frames
    guard let data = buffer.floatChannelData?[0] else { return }
    for i in 0..<Int(frames) { data[i] = 0 }

    let clickCount = Int.random(in: 7...12)            // more, busier clacks
    for _ in 0..<clickCount {
      let start = Int(Double.random(in: 0...(totalSeconds - 0.06)) * format.sampleRate)
      // transient noise click
      let clickLen = Int(Double.random(in: 0.006...0.016) * format.sampleRate)
      let amp = Float.random(in: 0.45...0.95)
      for j in 0..<clickLen where start + j < Int(frames) {
        let decay = 1 - Float(j) / Float(clickLen)
        data[start + j] += Float.random(in: -1...1) * amp * decay
      }
      // metallic ring: a fast-decaying sine at a steel-can frequency
      let freq = Float.random(in: 1700...3200)
      let ringLen = Int(Double.random(in: 0.05...0.12) * format.sampleRate)
      let ringAmp = amp * 0.5
      for j in 0..<ringLen where start + j < Int(frames) {
        let t = Float(j) / sr
        let env = expf(-Float(j) / Float(ringLen) * 5.0)   // quick metallic decay
        data[start + j] += sinf(2 * .pi * freq * t) * ringAmp * env
      }
    }
    // normalize a touch to avoid clipping then play LOUD
    fxPlayer.stop()
    fxPlayer.scheduleBuffer(buffer, at: nil)
    fxPlayer.volume = 1.0
    fxPlayer.play()
  }

  /// A short, silly randomly-pitched "boop" for smudge / alpha painting — a
  /// warbling sine with vibrato + a pitch glide + a little square-ish edge, so
  /// it's cartoony and different every time. `alpha` = brighter & squeakier.
  private func playSmudgeBlip(alpha: Bool) {
    guard audioReady, soundEnabled else { return }
    let now = CACurrentMediaTime()
    if now - lastSmudgeSoundTime < 0.11 { return }   // throttle during a drag
    lastSmudgeSoundTime = now
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1) else { return }
    let sr = Float(format.sampleRate)
    let dur = Double.random(in: 0.09...0.19)
    let frames = AVAudioFrameCount(format.sampleRate * dur)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
    buffer.frameLength = frames
    guard let data = buffer.floatChannelData?[0] else { return }
    let base = alpha ? Float.random(in: 520...940) : Float.random(in: 210...470)
    let glide = Float.random(in: -140...260)         // pitch slides across the blip
    let vibRate = Float.random(in: 7...22)
    let vibDepth = Float.random(in: 6...34)
    let n = Int(frames)
    for i in 0..<n {
      let t = Float(i) / sr
      let prog = Float(i) / Float(max(1, n))
      let env = sinf(.pi * prog)                     // smooth fade in/out
      let f = base + glide * prog + sinf(2 * .pi * vibRate * t) * vibDepth
      var s = sinf(2 * .pi * f * t)
      s += 0.22 * (s > 0 ? 1 : -1)                   // cartoony edge
      data[i] = s * env * 0.32
    }
    fxPlayer.stop()
    fxPlayer.scheduleBuffer(buffer, at: nil)
    fxPlayer.volume = 0.9
    fxPlayer.play()
  }

  // MARK: - Shake detection (accelerometer)

  private func setupShakeDetection() {
    guard motionManager.isAccelerometerAvailable else { return }
    motionManager.accelerometerUpdateInterval = 1.0 / 30.0
    motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
      guard let self = self, let accel = data?.acceleration else { return }
      let magnitude = sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z)
      let now = CACurrentMediaTime()
      if magnitude > 2.6, now - self.lastShakeTime > 0.7 {
        self.lastShakeTime = now
        self.playShakeRattle()
        self.sprayHaptics.impactOccurred(intensity: 0.8)
      }
    }
  }

  /// Per-frame spray can follow + aim
  func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
    frameCounter += 1
    let dt = lastFrameTime > 0 ? min(time - lastFrameTime, 0.1) : 0
    lastFrameTime = time
    updateDrips(dt: dt)

    if !isPaintingNow, frameCounter % 6 == 0 {
      let center = CGPoint(x: bounds.midX, y: bounds.midY)
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        if let result = self.raycast(at: center) {
          self.sprayTargetPoint = simd_float3(
            result.worldTransform.columns.3.x,
            result.worldTransform.columns.3.y,
            result.worldTransform.columns.3.z
          )
          self.spraySurfaceNormal = self.surfaceNormal(of: result)
        }
      }
    }

    updateSun()

    guard let can = sprayCanNode else { return }

    // The can follows the CENTRE raycast, so between strokes it parks itself in the middle of the
    // view — right in front of the camera. Show it only while actually painting, plus a short
    // linger so quick repeated strokes don't strobe it in and out.
    if isPaintingNow { lastPaintingTime = time }
    let idleFor = time - lastPaintingTime

    // Keep the spray can hidden until the user's FIRST paint on a plane, whenever the JS toggle
    // disables it, and whenever the user isn't painting.
    if !sprayCanEnabled || !hasTappedPlaneOnce || idleFor > Self.canIdleHideDelay {
      can.isHidden = true
      return
    }
    let justRevealed = can.isHidden      // first time we show it (after first paint)
    can.isHidden = false

    guard let target = sprayTargetPoint else { return }

    // ── Nozzle-anchored placement ────────────────────────────────────────────
    // The can aims straight down the surface normal, so the emitter's world
    // position must sit on that normal, `canHoverDistance` off the paint point.
    // Solve for the can ORIGIN by subtracting the (rotated + scaled) nozzle
    // offset — that way the particle jet and the emoji stamp share one and the
    // same world point at any distance, wall angle, screen size or orientation.
    let hoverDistance = max(Self.canMinWallDistance, Self.canHoverDistance)
    let aimAxis = simd_length(spraySurfaceNormal) > 1e-5
      ? simd_normalize(spraySurfaceNormal)
      : simd_float3(0, 0, 1)
    let desiredOrientation = simd_quatf(from: simd_float3(0, 0, -1), to: -aimAxis)
    let canScale = can.simdScale.x
    let nozzleWorldOffset = desiredOrientation.act(nozzleLocalOffset * canScale)

    var aimPoint = target + aimAxis * hoverDistance
    if !isPaintingNow {
      aimPoint.y += sinf(Float(time) * 2.2) * 0.008
    }
    let desired = aimPoint - nozzleWorldOffset

    // SNAP to the paint point on first reveal so the can never flies in from the
    // camera / origin; smoothly follow thereafter.
    let current = can.simdPosition
    can.simdPosition = justRevealed ? desired : current + (desired - current) * 0.12
    can.simdOrientation = justRevealed
      ? desiredOrientation
      : simd_slerp(can.simdOrientation, desiredOrientation, 0.15)
  }

  /// The sun does NOT chase the paint point. It hangs above a STABLE reference —
  /// the point you're looking at (camera forward) — and points mostly straight down,
  /// only ROTATING a little toward the spray can (as seen from the camera). Small,
  /// slow and smooth, so shadows barely drift.
  private func updateSun() {
    let camPos = arView.pointOfView?.simdWorldPosition ?? .zero
    let camFwd = arView.pointOfView?.simdWorldFront ?? simd_float3(0, 0, -1)
    // Stable look-at ~1.3 m ahead of the camera (moves smoothly with your view,
    // not jumpy per stroke). Directional light → this only sets the shadow ANGLE.
    let anchor = camPos + camFwd * 1.3
    // FOLLOW MODE (toggle): the sun leans hard toward the point you're aiming at
    // (sprayTargetPoint — always live via the centre raycast, even before the can
    // appears), so shadows swing dramatically and move as you paint elsewhere. The
    // speed slider scales how FAR it leans (up to ~4 m) and how FAST. OFF → fixed
    // overhead, stable shadows (unchanged look).
    let followAmt = Float(max(0, min(1, sunFollowSpeed)))
    var lean = simd_float3(0, 0, 0)
    if sunFollowEnabled, let target = sprayTargetPoint {
      let h = simd_float3(target.x - camPos.x, 0, target.z - camPos.z)
      let len = simd_length(h)
      if len > 1e-3 { lean = (h / len) * (0.4 + followAmt * 3.6) }
    }
    let desiredPos = anchor + simd_float3(0, 2.0, 0) + lean
    if !sunPositionInitialized {
      currentSunPosition = desiredPos
      sunPositionInitialized = true
    } else {
      // OFF → gentle drift; ON → speed slider maps 0…1 → lerp 0.03 … 0.25 (snappy).
      let lerp = sunFollowEnabled ? Float(0.03 + followAmt * 0.22) : 0.02
      currentSunPosition = currentSunPosition + (desiredPos - currentSunPosition) * lerp
    }
    sunNode.simdPosition = currentSunPosition
    sunNode.look(at: SCNVector3(anchor.x, anchor.y, anchor.z),
                 up: SCNVector3(0, 0, -1),   // world-up is ambiguous looking straight down; use -Z
                 localFront: SCNVector3(0, 0, -1))

    // Feed the catcher shader the VIEW-SPACE direction toward the sun, so it can
    // force N·L≡1 → the catcher is uniformly white on every plane (no self-shade).
    if let cam = arView.pointOfView {
      let worldToLight = simd_normalize(currentSunPosition - anchor)
      let view = simd_inverse(cam.simdWorldTransform)
      let v = view * simd_float4(worldToLight.x, worldToLight.y, worldToLight.z, 0)
      let vl = simd_normalize(simd_float3(v.x, v.y, v.z))
      let vlValue = NSValue(scnVector3: SCNVector3(vl.x, vl.y, vl.z))
      catcherMaterial.setValue(vlValue, forKey: "viewLightDir")
      catcherMaterialPersonSafe.setValue(vlValue, forKey: "viewLightDir")
    }
  }

  // MARK: - ARKit light estimation → match the real room's brightness + warmth

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    // Receiving frames means the camera pipeline is alive again.  Clear the
    // recovery guard before doing the inexpensive lighting work below.
    cameraRecoveryScheduled = false
    lastLightEstimateFrame &+= 1                                 // own counter (this is a bg queue)
    guard lastLightEstimateFrame % 8 == 0,                       // ~7fps is plenty
          let est = frame.lightEstimate else { return }
    // ARKit world tracking gives ambient INTENSITY (lumens, 1000≈neutral) + colour
    // temperature (K), not a direction. Use them to match the room: scale the
    // ambient fill and warm/cool the sun + spot so virtual shadows sit in lighting
    // that matches what the camera sees.
    let scale = CGFloat(max(0.35, min(1.8, est.ambientIntensity / 1000.0)))
    let temp = est.ambientColorTemperature
    let roomColor = kelvinColor(temp)
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.ambientNode.light?.intensity = self.presetBaseAmbient * scale
      self.sunNode.light?.temperature = temp
      // Feed the "blend into world" filter with the live room colour + brightness.
      self.envColor = roomColor
      self.envBrightness = CGFloat(max(0.15, min(1.4, est.ambientIntensity / 1000.0)))
      if self.blendFilterEnabled { self.applyBlendFilter() }
    }
  }

  // MARK: - Session

  /// Shared config builder — adds person segmentation (people render OVER strokes)
  /// when enabled and supported by the device.
  private func makeARConfig() -> ARWorldTrackingConfiguration {
    let config = ARWorldTrackingConfiguration()
    config.planeDetection = [.horizontal, .vertical]
    if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      config.sceneReconstruction = .mesh
    }
    config.isLightEstimationEnabled = true
    config.environmentTexturing = .automatic  // real reflections for the metallic can
    if personOcclusionEnabled,
       ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentation) {
      config.frameSemantics.insert(.personSegmentation)  // a human in view draws on top
    }
    return config
  }

  private func startSession() {
    guard ARWorldTrackingConfiguration.isSupported else {
      onArError(["message": "AR world tracking is not supported on this device"])
      return
    }
    arView.session.run(makeARConfig(), options: [.resetTracking, .removeExistingAnchors])
    sessionRunning = true
    onSessionReady(["lidar": ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)])
    startRoomPlanCollection()
  }

  private func pauseSession() {
    arView.session.pause()
    sessionRunning = false
  }

  /// Live-reconfigure the running session (keeps anchors/strokes) — used when the
  /// person-occlusion toggle changes.
  private func reconfigureSession() {
    guard sessionRunning, ARWorldTrackingConfiguration.isSupported else { return }
    arView.session.run(makeARConfig())
  }

  /// Re-run the session without reset flags: anchors and painted strokes stay.
  ///
  /// Strokes are plain scene nodes, so a pause can never delete them — but the
  /// front-camera scene takes the camera away, and on the way back ARKit has to
  /// find the room again. Without the map it re-origins and every stroke ends
  /// up somewhere behind you, which reads as "my painting is gone". Handing it
  /// the map captured before the switch pins the origin back to where it was.
  private func resumeSession() {
    guard ARWorldTrackingConfiguration.isSupported else { return }
    let config = makeARConfig()
    if let map = pausedWorldMap {
      config.initialWorldMap = map
      isRelocalizing = true
      arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
      onSceneStatus(["status": "relocalizing"])
      arSwitchLog("wall resume WITH world map — relocalizing, strokes=\(undoHistory.count)")
    } else {
      arView.session.run(config)
      arSwitchLog("wall resume WITHOUT world map (strokes may land off-origin), strokes=\(undoHistory.count)")
    }
    sessionRunning = true
    startRoomPlanCollection()
  }

  // MARK: - Background RoomPlan (shared ARSession, no UI)

  private func startRoomPlanCollection() {
    guard roomPlanEnabled, sessionRunning else { return }
    guard ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) else {
      onRoomReadinessChanged(["state": "unsupported", "confidence": 0.0])
      return
    }
    if #available(iOS 17.0, *) {
      if roomPlanManager == nil {
        let manager = RoomPlanManager()
        manager.onReadinessChanged = { [weak self] update in
          // RoomCaptureSession callbacks can arrive off-main.  EventDispatcher
          // and SceneKit preview mutations are kept on the view's main queue.
          DispatchQueue.main.async {
            guard let self else { return }
            self.onRoomReadinessChanged(update.eventPayload())
            if self.roomPreviewEnabled { self.rebuildRoomPlanPreview() }
          }
        }
        roomPlanManager = manager
      }
      roomPlanManager?.start(arSession: arView.session)
    } else {
      onRoomReadinessChanged(["state": "unsupported", "confidence": 0.0])
    }
  }

  private func stopRoomPlanCollection() {
    if #available(iOS 17.0, *) {
      roomPlanManager?.stop()
    }
  }

  func setRoomPreviewEnabled(_ enabled: Bool) {
    roomPreviewEnabled = enabled
    roomPreviewRoot.isHidden = !enabled
    if enabled, #available(iOS 17.0, *) { rebuildRoomPlanPreview() }
  }

  @available(iOS 17.0, *)
  private func rebuildRoomPlanPreview() {
    roomPreviewRoot.childNodes.forEach { $0.removeFromParentNode() }
    guard roomPreviewEnabled, let manager = roomPlanManager else { return }
    for surface in manager.previewSurfaces() {
      let width = CGFloat(max(0.03, surface.dimensions.x))
      let height = CGFloat(max(0.03, surface.category == "floor" ? surface.dimensions.z : surface.dimensions.y))
      let plane = SCNPlane(width: width, height: height)
      let material = SCNMaterial()
      material.lightingModel = .constant
      material.diffuse.contents = surface.category == "floor"
        ? UIColor.systemGreen.withAlphaComponent(0.12)
        : UIColor.systemBlue.withAlphaComponent(0.10)
      material.isDoubleSided = true
      material.writesToDepthBuffer = false
      material.readsFromDepthBuffer = false
      plane.firstMaterial = material
      let node = SCNNode(geometry: plane)
      node.name = "roomPlanSurface_\(surface.id)"
      node.simdTransform = surface.transform
      if surface.category == "floor" { node.eulerAngles.x = -.pi / 2 }
      node.castsShadow = false
      node.renderingOrder = -1
      roomPreviewRoot.addChildNode(node)
    }
  }

  /// Snapshot the room map so `resumeSession()` can pin the origin back.
  /// Throttled: the map is only needed when the user leaves the scene, and
  /// asking ARKit for it costs real work.
  private func captureWorldMap(force: Bool) {
    let now = CACurrentMediaTime()
    guard force || now - lastWorldMapCapture > 8 else { return }
    lastWorldMapCapture = now
    arView.session.getCurrentWorldMap { [weak self] map, error in
      guard let self else { return }
      guard let map else {
        arSwitchLog("world map capture FAILED: \(error?.localizedDescription ?? "no map yet (move the phone around)")")
        return
      }
      DispatchQueue.main.async {
        self.pausedWorldMap = map
        arSwitchLog("world map captured (anchors=\(map.anchors.count))")
      }
    }
  }

  // MARK: - Plane detection: grid flash only (no depth-writing catchers)

  func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
    guard let planeAnchor = anchor as? ARPlaneAnchor else { return }
    detectedPlaneCount += 1
    recordRetainedPlane(planeAnchor)
    let count = detectedPlaneCount
    DispatchQueue.main.async { [weak self] in
      self?.onPlanesChanged(["count": count])
    }

    // Invisible depth-only occluder so spray particles can't pass THROUGH the
    // wall — it writes depth (no color) and renders first (renderingOrder -10).
    // Strokes ignore the depth buffer, so they stay on top, unaffected.
    let occluderPlane = SCNPlane(
      width: CGFloat(planeAnchor.extent.x),
      height: CGFloat(planeAnchor.extent.z)
    )
    // Pure INVISIBLE particle collider — writes neither color NOR depth, so it
    // never occludes the strokes, the spray can or the particles (everything
    // stays in front of the AR planes). Spray particles still bounce off it via
    // colliderNodes (physics, independent of the depth buffer).
    let occluderMaterial = SCNMaterial()
    occluderMaterial.colorBufferWriteMask = []   // invisible (writes no colour)
    // When occlusion is ON it WRITES depth → the real wall hides virtual content
    // behind it (spray can, particles, placed media). OFF → pure particle collider.
    occluderMaterial.writesToDepthBuffer = occlusionEnabled
    occluderMaterial.readsFromDepthBuffer = false
    occluderMaterial.isDoubleSided = true
    occluderPlane.firstMaterial = occluderMaterial
    let occluderNode = SCNNode(geometry: occluderPlane)
    occluderNode.name = "wallOccluder"
    occluderNode.renderingOrder = -10
    occluderNode.eulerAngles.x = -.pi / 2
    occluderNode.position = SCNVector3(planeAnchor.center.x, 0, planeAnchor.center.z)
    occluderNode.castsShadow = false
    node.addChildNode(occluderNode)

    // Let spray particles physically collide with this surface
    wallColliderNodes.append(occluderNode)
    sprayParticles?.colliderNodes = wallColliderNodes

    // Realtime shadow CATCHER on the AR plane — the SHARED `catcherMaterial` whose
    // normal is forced toward the sun, so the whole plane stays uniformly invisible
    // (never self-shades into a full-plane grey) and only real cast shadows darken it.
    let shadowPlane = SCNPlane(
      width: CGFloat(planeAnchor.extent.x),
      height: CGFloat(planeAnchor.extent.z)
    )
    // Person-off = multiply catcher (unchanged look); person-on = alpha catcher
    // so shadows survive people-occlusion compositing.
    shadowPlane.firstMaterial = personOcclusionEnabled ? catcherMaterialPersonSafe : catcherMaterial
    let shadowNode = SCNNode(geometry: shadowPlane)
    shadowNode.name = "shadowCatcher"
    shadowNode.eulerAngles.x = -.pi / 2
    shadowNode.position = SCNVector3(planeAnchor.center.x, 0, planeAnchor.center.z)
    shadowNode.castsShadow = false              // receives shadow only
    shadowNode.renderingOrder = -8              // after the camera bg, before strokes
    shadowCatcherNodes.append(shadowNode)
    node.addChildNode(shadowNode)

    guard gridEnabled else { return }

    let gridPlane = SCNPlane(
      width: CGFloat(planeAnchor.extent.x),
      height: CGFloat(planeAnchor.extent.z)
    )
    let gridMaterial = SCNMaterial()
    gridMaterial.diffuse.contents = Self.gridTexture()
    gridMaterial.diffuse.wrapS = .repeat
    gridMaterial.diffuse.wrapT = .repeat
    gridMaterial.diffuse.contentsTransform = SCNMatrix4MakeScale(
      max(1, Float(planeAnchor.extent.x) * 4),
      max(1, Float(planeAnchor.extent.z) * 4),
      1
    )
    gridMaterial.lightingModel = .constant
    gridMaterial.isDoubleSided = true
    gridMaterial.writesToDepthBuffer = false
    gridPlane.firstMaterial = gridMaterial
    let gridNode = SCNNode(geometry: gridPlane)
    gridNode.eulerAngles.x = -.pi / 2
    gridNode.position = SCNVector3(planeAnchor.center.x, 0.002, planeAnchor.center.z)
    gridNode.opacity = 0
    gridNode.castsShadow = false
    node.addChildNode(gridNode)

    let appear = SCNAction.fadeOpacity(to: 0.55, duration: 0.25)
    let hold = SCNAction.wait(duration: 1.6)
    let fade = SCNAction.fadeOut(duration: 0.6)
    gridNode.runAction(SCNAction.sequence([appear, hold, fade, SCNAction.removeFromParentNode()]))
  }

  func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
    guard let planeAnchor = anchor as? ARPlaneAnchor,
          let occluder = node.childNode(withName: "wallOccluder", recursively: false),
          let plane = occluder.geometry as? SCNPlane else { return }
    plane.width = CGFloat(planeAnchor.extent.x)
    plane.height = CGFloat(planeAnchor.extent.z)
    occluder.position = SCNVector3(planeAnchor.center.x, 0, planeAnchor.center.z)
    recordRetainedPlane(planeAnchor)
    // keep the shadow-catcher matched to the (growing) plane
    if let sc = node.childNode(withName: "shadowCatcher", recursively: false),
       let scPlane = sc.geometry as? SCNPlane {
      scPlane.width = CGFloat(planeAnchor.extent.x)
      scPlane.height = CGFloat(planeAnchor.extent.z)
      sc.position = SCNVector3(planeAnchor.center.x, 0, planeAnchor.center.z)
    }
  }

  private func recordRetainedPlane(_ plane: ARPlaneAnchor) {
    let id = plane.identifier.uuidString
    let transform = plane.transform
    let transformValues: [Float] = [
      transform.columns.0.x, transform.columns.0.y, transform.columns.0.z, transform.columns.0.w,
      transform.columns.1.x, transform.columns.1.y, transform.columns.1.z, transform.columns.1.w,
      transform.columns.2.x, transform.columns.2.y, transform.columns.2.z, transform.columns.2.w,
      transform.columns.3.x, transform.columns.3.y, transform.columns.3.z, transform.columns.3.w,
    ]
    let payload: [String: Any] = [
      "id": id,
      "alignment": plane.alignment == .horizontal ? "horizontal" : "vertical",
      "center": [plane.center.x, plane.center.y, plane.center.z],
      "extent": [plane.extent.x, plane.extent.y, plane.extent.z],
      "transform": transformValues,
    ]
    if let index = retainedARPlaneSurfaces.firstIndex(where: { $0["id"] as? String == id }) {
      retainedARPlaneSurfaces[index] = payload
    } else {
      retainedARPlaneSurfaces.append(payload)
    }
  }

  /// 256² translucent grid tile (white lines on clear)
  private static func gridTexture() -> UIImage {
    let size = CGSize(width: 256, height: 256)
    let renderer = UIGraphicsImageRenderer(size: size)
    return renderer.image { ctx in
      let line = UIColor(white: 1, alpha: 0.85)
      line.setStroke()
      let path = UIBezierPath()
      path.lineWidth = 4
      for i in 0...4 {
        let offset = CGFloat(i) * 64
        path.move(to: CGPoint(x: offset, y: 0))
        path.addLine(to: CGPoint(x: offset, y: 256))
        path.move(to: CGPoint(x: 0, y: offset))
        path.addLine(to: CGPoint(x: 256, y: offset))
      }
      path.stroke()
      _ = ctx
    }
  }

  // MARK: - Touch → tool dispatch

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let point = touches.first?.location(in: self) else { return }
    if let node = placementNode {
      if touches.count == 1, let result = raycast(at: point) {
        positionPlacement(node: node, with: result)
      }
      return
    }
    // Two fingers down → brush-resize pinch, not painting
    if (event?.allTouches?.count ?? touches.count) > 1 || isBrushPinching {
      cancelActiveStroke()
      return
    }
    // STABILITY: don't paint while ARKit is still initializing/relocalizing — strokes placed then drift
    // and snap when tracking stabilizes (the "walls jump at start" effect). Wait for normal tracking.
    if !paintingReady {
      onSceneStatus(["status": "hold-steady"])
      return
    }
    // Never invent an estimated/infinite paint surface. A stroke can begin only
    // on the bounded geometry of an ARPlaneAnchor that ARKit has really found.
    if toolMode != "eraser", raycast(at: point) == nil {
      notifySurfaceUnavailable()
      return
    }
    pauseSpecialEffectsForNewStroke()
    lastScreenPoint = nil
    isPaintingNow = true
    liveStampIndex = 0          // restart the custom-brush anti-coplanar ramp
    hasTappedPlaneOnce = true   // reveal the spray can from now on
    setSpraying(true)
    sprayHaptics.prepare()
    switch toolMode {
    case "eraser":
      currentEraseBatch = [:]
      eraseAt(point: point)
    case "line":
      beginStroke()
      lineStartResult = raycast(at: point)
      lineEndResult = lineStartResult
      updateSprayTarget(from: lineStartResult)
      updateLinePreview()
    case "smudge":
      beginStroke()
      resetSmudgeGestureState()
      smudgeStamp(at: point)
    default:
      beginStroke()
      stampIfNeeded(at: point, force: true)
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let touch = touches.first else { return }
    if let node = placementNode {
      if touches.count == 1, let result = raycast(at: touch.location(in: self)) {
        positionPlacement(node: node, with: result)
      }
      return
    }
    // Ignore paint movement while pinching to resize the brush
    if (event?.allTouches?.count ?? touches.count) > 1 || isBrushPinching { return }
    let touchPoints: [CGPoint]
    if let coalesced = event?.coalescedTouches(for: touch), !coalesced.isEmpty {
      touchPoints = coalesced.map { $0.location(in: self) }
    } else {
      touchPoints = [touch.location(in: self)]
    }
    switch toolMode {
    case "eraser":
      for point in touchPoints { eraseAt(point: point) }
    case "line":
      lineEndResult = raycast(at: touchPoints.last ?? touch.location(in: self))
      updateSprayTarget(from: lineEndResult)
      updateLinePreview()
    case "smudge":
      for point in touchPoints { smudgeStamp(at: point) }
    default:
      for point in touchPoints { stampIfNeeded(at: point, force: false) }
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    if placementNode != nil { return }
    isPaintingNow = false
    setSpraying(false)
    if toolMode == "eraser" {
      endEraseGesture()
    } else {
      if toolMode == "line" {
        clearLinePreview()
        stampLine()
      }
      endStroke()
      resetSmudgeGestureState()
    }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    if placementNode != nil { return }
    isPaintingNow = false
    setSpraying(false)
    if toolMode == "eraser" {
      endEraseGesture()
    } else {
      clearLinePreview()
      endStroke()
      resetSmudgeGestureState()
    }
  }

  private func updateSprayTarget(from result: ARRaycastResult?) {
    guard let result = result else { return }
    sprayTargetPoint = simd_float3(
      result.worldTransform.columns.3.x,
      result.worldTransform.columns.3.y,
      result.worldTransform.columns.3.z
    )
    spraySurfaceNormal = surfaceNormal(of: result)
  }

  // MARK: - Paint strokes

  private func normalizedAnimationFrame(_ frame: Int) -> Int {
    let total = max(1, animationTotalFrames)
    let value = frame % total
    return value < 0 ? value + total : value
  }

  private func animationTimingForNewStroke() -> (start: Int?, duration: Int?) {
    guard animationEnabled else { return (nil, nil) }
    // 2D-Animator semantics: PAUSED → the stroke lands on exactly this frame
    // (life 1) so you build frames one-by-one; PLAYING → it lives
    // `animationStrokeLength` frames from where it was drawn (draw-through-time).
    let duration: Int
    if animationStrokeLength == -1 {
      duration = -1
    } else if animationPlaying {
      duration = max(1, min(animationStrokeLength, animationTotalFrames))
    } else {
      duration = 1
    }
    return (normalizedAnimationFrame(animationCurrentFrame), duration)
  }

  private func animationRecordIsVisible(_ record: StrokeRecord) -> Bool {
    guard animationEnabled,
          let rawStart = record.animationStartFrame,
          let rawDuration = record.animationDuration else { return true }
    if rawDuration == -1 { return true }
    let total = max(1, animationTotalFrames)
    let start = ((rawStart % total) + total) % total
    let duration = max(1, min(rawDuration, total))
    if duration >= total { return true }
    let frame = normalizedAnimationFrame(animationCurrentFrame)
    let end = start + duration
    if end <= total { return frame >= start && frame < end }
    return frame >= start || frame < end % total
  }

  private func paintRecords(in entry: HistoryEntry) -> [StrokeRecord] {
    switch entry {
    case .paint(let record): return [record]
    case .paintGroup(let records): return records
    case .erase: return []
    }
  }

  private func applyAnimationVisibility(to record: StrokeRecord) {
    let hidden = !animationRecordIsVisible(record)
    if record.node.isHidden != hidden { record.node.isHidden = hidden }
  }

  private func applyAnimationVisibility() {
    var visited = Set<ObjectIdentifier>()
    func update(_ record: StrokeRecord) {
      let key = ObjectIdentifier(record)
      guard !visited.contains(key) else { return }
      visited.insert(key)
      applyAnimationVisibility(to: record)
    }
    for entry in undoHistory {
      switch entry {
      case .paint(let record): update(record)
      case .paintGroup(let records): records.forEach(update)
      case .erase(let affected): affected.forEach { update($0.record) }
      }
    }
    for entry in redoHistory {
      switch entry {
      case .paint(let record): update(record)
      case .paintGroup(let records): records.forEach(update)
      case .erase(let affected): affected.forEach { update($0.record) }
      }
    }
    liveAnimationGestureRecords.forEach(update)
    if let record = liveStrokeRecord { update(record) }
    if let record = liveMirrorRecord { update(record) }
  }

  private func startStrokeSegment(resetSurface: Bool) {
    strokeOrderCounter += 2
    let timing = animationTimingForNewStroke()
    let group = SCNNode()
    group.renderingOrder = strokeOrderCounter
    arView.scene.rootNode.addChildNode(group)
    group.opacity = brushOpacity
    liveStrokeGroup = group
    liveStrokeRecord = StrokeRecord(
      node: group,
      opacity: brushOpacity,
      renderingOrder: strokeOrderCounter,
      layer: liveLayer,
      animationStartFrame: timing.start,
      animationDuration: timing.duration
    )
    if mirrorX {
      let mirror = SCNNode()
      mirror.renderingOrder = strokeOrderCounter + 1
      mirror.opacity = brushOpacity
      arView.scene.rootNode.addChildNode(mirror)
      liveMirrorGroup = mirror
      liveMirrorRecord = StrokeRecord(
        node: mirror,
        opacity: brushOpacity,
        renderingOrder: strokeOrderCounter + 1,
        layer: liveLayer,
        animationStartFrame: timing.start,
        animationDuration: timing.duration
      )
    } else {
      liveMirrorGroup = nil
      liveMirrorRecord = nil
    }
    lastStampPosition = nil
    if resetSurface {
      strokePlanePoint = nil
      strokePlaneNormal = nil
      strokeOrientation = nil
    }
    if let record = liveStrokeRecord { applyAnimationVisibility(to: record) }
    if let record = liveMirrorRecord { applyAnimationVisibility(to: record) }
  }

  private func beginStroke() {
    liveAnimationGestureRecords = []
    startStrokeSegment(resetSurface: true)
  }

  @discardableResult
  private func commitLiveStrokeSegment(appendToHistory: Bool = true) -> [StrokeRecord] {
    var committed: [StrokeRecord] = []
    if let group = liveStrokeGroup, let record = liveStrokeRecord {
      if !record.hasContent {
        group.removeFromParentNode()
      } else {
        if !record.stamps.isEmpty {
          flatten(record: record)
        }
        applyAnimationVisibility(to: record)
        committed.append(record)
      }
    }
    if let mirror = liveMirrorGroup, let record = liveMirrorRecord {
      if !record.hasContent {
        mirror.removeFromParentNode()
      } else {
        if !record.stamps.isEmpty { flatten(record: record) }
        applyAnimationVisibility(to: record)
        committed.append(record)
      }
    }
    if appendToHistory {
      committed.forEach { undoHistory.append(.paint($0)) }
    }
    return committed
  }

  /// The 2D Animator starts a fresh timed bucket whenever playback advances
  /// under an active pointer. Do the same here while preserving the locked AR
  /// plane, so users can genuinely draw through time without geometry jumps.
  private func ensureLiveAnimationSegment() {
    guard animationEnabled, let record = liveStrokeRecord else { return }
    let frame = normalizedAnimationFrame(animationCurrentFrame)
    if record.animationStartFrame == frame { return }
    if !record.hasContent {
      let timing = animationTimingForNewStroke()
      record.animationStartFrame = timing.start
      record.animationDuration = timing.duration
      liveMirrorRecord?.animationStartFrame = timing.start
      liveMirrorRecord?.animationDuration = timing.duration
      applyAnimationVisibility()
      return
    }
    let committed = commitLiveStrokeSegment(appendToHistory: false)
    liveAnimationGestureRecords.append(contentsOf: committed)
    if !committed.isEmpty { redoHistory.removeAll() }
    startStrokeSegment(resetSurface: false)
  }

  private func endStroke() {
    let groupedGesture = animationEnabled || !liveAnimationGestureRecords.isEmpty
    let committed = commitLiveStrokeSegment(appendToHistory: !groupedGesture)
    if groupedGesture {
      liveAnimationGestureRecords.append(contentsOf: committed)
      if !liveAnimationGestureRecords.isEmpty {
        undoHistory.append(.paintGroup(liveAnimationGestureRecords))
      }
    }
    let didCommit = !committed.isEmpty || !liveAnimationGestureRecords.isEmpty
    if didCommit {
      redoHistory.removeAll()
    }
    commitStackCells()   // this stroke's cells now count as one layer for the next
    liveStrokeGroup = nil
    liveStrokeRecord = nil
    liveMirrorGroup = nil
    liveMirrorRecord = nil
    liveAnimationGestureRecords = []
    lastStampPosition = nil
    lineStartResult = nil
    lineEndResult = nil
    emitHistory()
    if didCommit {
      onStrokeCommitted(["strokeId": UUID().uuidString])
    }
    // Keep a recent room map warm so switching to the front camera and back
    // restores the painting in place even if the map request at pause time
    // doesn't land before the session stops.
    captureWorldMap(force: false)
  }

  private func flatten(record: StrokeRecord) {
    let group = record.node
    let flat = group.flattenedClone()
    flat.opacity = record.opacity
    flat.renderingOrder = record.renderingOrder
    flat.castsShadow = strokeShadowsEnabled   // flattenedClone defaults to casting
    arView.scene.rootNode.addChildNode(flat)
    group.removeFromParentNode()
    record.node = flat
  }

  private func rebuild(record: StrokeRecord) {
    let parentExists = record.node.parent != nil
    record.node.removeFromParentNode()
    let group = SCNNode()
    for stamp in record.stamps {
      appendStampNodes(stamp: stamp, to: group, in: record.layer)
    }
    let flat = group.flattenedClone()
    flat.opacity = record.opacity
    flat.renderingOrder = record.renderingOrder
    // A stroke that already fell must come back where it LANDED. `stamps` still
    // describe the wall it was painted on, so without this an erase or an undo
    // would fling an exploded stroke back up onto that wall.
    if let baked = record.bakedTransform { flat.transform = baked }
    record.node = flat
    if parentExists {
      arView.scene.rootNode.addChildNode(flat)
    }
    applyAnimationVisibility(to: record)
  }

  private func raycast(at point: CGPoint) -> ARRaycastResult? {
    // 1) Tight meshed polygon — best when ARKit has fully meshed the surface.
    if let q = arView.raycastQuery(from: point, allowing: .existingPlaneGeometry, alignment: .any),
       let hit = arView.session.raycast(q).first {
      return hit
    }
    // 2) Corners/edges ARKit hasn't meshed yet fall through the polygon and become
    //    unpaintable "dead spots". Hit the anchor's plane but ACCEPT the result only
    //    when it lies within the measured extent rectangle (+6cm) — this fills the
    //    corners up to the real boundary WITHOUT the far-away phantom surfaces that
    //    `.existingPlaneInfinite` alone would allow.
    guard let q2 = arView.raycastQuery(from: point, allowing: .existingPlaneInfinite, alignment: .any) else { return nil }
    for r in arView.session.raycast(q2) {
      guard let pa = r.anchor as? ARPlaneAnchor else { continue }
      let localHit = simd_inverse(pa.transform) * r.worldTransform.columns.3
      let margin: Float = 0.06
      if abs(localHit.x - pa.center.x) <= pa.extent.x / 2 + margin,
         abs(localHit.z - pa.center.z) <= pa.extent.z / 2 + margin {
        return r
      }
    }
    return nil
  }

  private func notifySurfaceUnavailable() {
    let now = CACurrentMediaTime()
    guard now - lastSurfaceUnavailableTime > 1.2 else { return }
    lastSurfaceUnavailableTime = now
    onSurfaceUnavailable([:])
  }

  private var minStampDistance: Float {
    max(Float(brushSizeMeters * Self.denseSpacingFactor), 0.003)
  }

  /// For planar raycast results the surface normal is the transform's Y axis
  private func surfaceNormal(of result: ARRaycastResult) -> simd_float3 {
    let t = result.worldTransform
    return simd_normalize(simd_float3(t.columns.1.x, t.columns.1.y, t.columns.1.z))
  }

  /// Orient an SCNPlane stamp flat on the surface: +Z along the normal,
  /// keep the emoji upright (world-up aligned) on walls.
  private func stampOrientation(normal: simd_float3) -> simd_quatf {
    let z = normal
    let reference: simd_float3 = abs(normal.y) > 0.9 ? simd_float3(0, 0, -1) : simd_float3(0, 1, 0)
    let x = simd_normalize(simd_cross(reference, z))
    let y = simd_cross(z, x)
    let surface = simd_quatf(simd_float3x3(columns: (x, y, z)))
    guard stampRotation != 0 else { return surface }
    // In-plane brush rotation (🖌️ rotate option), applied in the stamp's OWN local frame before the
    // surface alignment above — composing this way rotates the glyph flat against the wall instead
    // of tumbling it out of the plane. Negated for the same reason as the Metal engine: this angle
    // convention is defined in the 2D engines' Y-down space, so the sign flips once mapped into 3D.
    let local = simd_quatf(angle: -stampRotation * Float.pi / 180, axis: simd_float3(0, 0, 1))
    return surface * local
  }

  private func stampPosition(from result: ARRaycastResult) -> SCNVector3 {
    let transform = result.worldTransform
    let normal = surfaceNormal(of: result)
    let lift = Self.stampSurfaceOffset + (strokeShadowsEnabled ? Self.shadowLiftBonus : 0)
    return SCNVector3(
      transform.columns.3.x + normal.x * lift,
      transform.columns.3.y + normal.y * lift,
      transform.columns.3.z + normal.z * lift
    )
  }

  private func stampIfNeeded(at point: CGPoint, force: Bool) {
    ensureLiveAnimationSegment()
    if !force, let last = lastScreenPoint {
      let dx = point.x - last.x
      let dy = point.y - last.y
      if (dx * dx + dy * dy) < 4 { return }
    }
    guard let result = raycast(at: point) else {
      notifySurfaceUnavailable()
      return
    }
    lastScreenPoint = point
    updateSprayTarget(from: result)

    // Plane-locked segments: stamps align perfectly to the locked surface.
    // When the finger crosses an edge (wall → floor), the hit's normal or
    // distance diverges from the locked plane — re-lock to the new surface
    // and continue the stroke seamlessly on it.
    let rawNormal = surfaceNormal(of: result)
    let raw = simd_float3(
      result.worldTransform.columns.3.x,
      result.worldTransform.columns.3.y,
      result.worldTransform.columns.3.z
    )
    if let lockedNormal = strokePlaneNormal, let lockedPoint = strokePlanePoint {
      let sameDirection = simd_dot(rawNormal, lockedNormal) > 0.85 // within ~30°
      let planeDistance = abs(simd_dot(raw - lockedPoint, lockedNormal))
      if !sameDirection || planeDistance > 0.04 {
        // Surface changed → start a new segment on the new plane
        strokePlaneNormal = rawNormal
        strokePlanePoint = raw
        strokeOrientation = stampOrientation(normal: rawNormal)
        lastStampPosition = nil // don't gap-fill across the corner
      }
    } else {
      strokePlaneNormal = rawNormal
      strokePlanePoint = raw
      strokeOrientation = stampOrientation(normal: rawNormal)
    }
    guard let planeNormal = strokePlaneNormal,
          let planePoint = strokePlanePoint,
          let orientation = strokeOrientation else { return }
    // Project the hit onto the stroke plane, then lift by the surface offset
    // (base + shadow bonus + per-layer stacking).
    let projected = raw - planeNormal * simd_dot(raw - planePoint, planeNormal)
    let lifted = projected + planeNormal * surfaceLift(at: projected)
    let position = SCNVector3(lifted.x, lifted.y, lifted.z)

    if !force, let last = lastStampPosition {
      let gap = distance(position, last)
      if gap < minStampDistance { return }
      if gap > minStampDistance * 1.5 {
        let fillSteps = min(Int(gap / minStampDistance), 24)
        for index in 1..<fillSteps {
          let t = Float(index) / Float(fillSteps)
          let mid = SCNVector3(
            last.x + (position.x - last.x) * t,
            last.y + (position.y - last.y) * t,
            last.z + (position.z - last.z) * t
          )
          addStamp(at: mid, orientation: orientation, to: liveStrokeGroup, record: liveStrokeRecord)
        }
      }
    }
    lastStampPosition = position
    addStamp(at: position, orientation: orientation, to: liveStrokeGroup, record: liveStrokeRecord)

    if mirrorX {
      let mirroredPoint = CGPoint(x: bounds.width - point.x, y: point.y)
      if let mirrorResult = raycast(at: mirroredPoint) {
        let mirrorRaw = simd_float3(
          mirrorResult.worldTransform.columns.3.x,
          mirrorResult.worldTransform.columns.3.y,
          mirrorResult.worldTransform.columns.3.z
        )
        let mirrorProjected = mirrorRaw - planeNormal * simd_dot(mirrorRaw - planePoint, planeNormal)
        let mirrorLifted = mirrorProjected + planeNormal * surfaceLift(at: mirrorProjected)
        addStamp(
          at: SCNVector3(mirrorLifted.x, mirrorLifted.y, mirrorLifted.z),
          orientation: orientation,
          to: liveMirrorGroup,
          record: liveMirrorRecord
        )
      }
    }
  }

  /// Stamp positions for a straight line, at a FIXED interval anchored at `from`.
  ///
  /// Both the preview and the committed stroke go through here so they cannot
  /// disagree. The old code divided the line into `Int(totalDistance / step)`
  /// EQUAL parts and walked `t = index / steps`: the real gap was
  /// `totalDistance / steps`, which shrinks continuously while you drag and then
  /// snaps back each time the integer step count ticks over — so every stamp in
  /// the preview crawled around instead of staying put. With a fixed interval,
  /// stamp k is always exactly `k * step` from the anchor, so dragging only adds
  /// or removes stamps at the moving end.
  private func linePositions(from: SCNVector3, to: SCNVector3) -> [SCNVector3] {
    let totalDistance = distance(from, to)
    guard totalDistance > 1e-5 else { return [from] }

    var step = max(minStampDistance, 1e-4)
    // Cap the stamp budget; only then does spacing stretch to cover the line.
    let maxStamps = Self.maxStampsPerSession
    if Int(totalDistance / step) > maxStamps - 1 {
      step = totalDistance / Float(maxStamps - 1)
    }

    let ux = (to.x - from.x) / totalDistance
    let uy = (to.y - from.y) / totalDistance
    let uz = (to.z - from.z) / totalDistance
    let at: (Float) -> SCNVector3 = { travelled in
      SCNVector3(from.x + ux * travelled, from.y + uy * travelled, from.z + uz * travelled)
    }

    let wholeSteps = Int(totalDistance / step)
    var positions: [SCNVector3] = []
    positions.reserveCapacity(wholeSteps + 2)
    for index in 0...wholeSteps { positions.append(at(Float(index) * step)) }

    // Land a stamp on the aim point so the line reaches where you are pointing,
    // but only past half a step, otherwise it overlaps the last fixed stamp and
    // pops in and out while dragging.
    let remainder = totalDistance - Float(wholeSteps) * step
    if remainder > step * 0.5 { positions.append(at(totalDistance)) }
    return positions
  }

  private func stampLine() {
    ensureLiveAnimationSegment()
    guard let start = lineStartResult, let end = lineEndResult else { return }
    let orientation = stampOrientation(normal: surfaceNormal(of: start))
    for position in linePositions(from: stampPosition(from: start), to: stampPosition(from: end)) {
      addStamp(at: position, orientation: orientation, to: liveStrokeGroup, record: liveStrokeRecord)
    }
  }

  /// Live, pooled preview of the straight line / spray distribution while
  /// aiming — uses the exact emoji, size, spacing, orientation and projection
  /// the final stroke will use, so what you see is what you commit.
  private func updateLinePreview() {
    guard let start = lineStartResult, let end = lineEndResult else { return }
    // Same positions the commit will use — preview and stroke can never diverge.
    let positions = linePositions(from: stampPosition(from: start), to: stampPosition(from: end))
    let orientation = stampOrientation(normal: surfaceNormal(of: start))
    let geometry = sharedGeometry(for: brushEmoji, size: brushSizeMeters)

    for (index, position) in positions.enumerated() {
      let node: SCNNode
      if index < linePreviewPool.count {
        node = linePreviewPool[index]
        node.isHidden = false
      } else {
        node = SCNNode()
        node.renderingOrder = Self.previewRenderOrder
        node.castsShadow = false
        previewRoot.addChildNode(node)
        linePreviewPool.append(node)
      }
      node.geometry = geometry
      node.simdOrientation = orientation
      node.position = position
      node.opacity = 0.8
    }
    // Hide any pooled nodes beyond what this line needs
    if positions.count < linePreviewPool.count {
      for i in positions.count..<linePreviewPool.count { linePreviewPool[i].isHidden = true }
    }
  }

  private func clearLinePreview() {
    for node in linePreviewPool { node.isHidden = true }
  }

  // MARK: - Dynamic paint drips

  /// Called every frame. When the user keeps painting in roughly the same spot
  /// (nearly stationary), paint starts to "run": after ~3s the first drip
  /// appears, then more accumulate the longer they stay. Drips follow gravity
  /// projected onto the painted surface (vertical walls run straight down).
  /// Per-frame drip simulation: accumulate film, yield into runs, advance runs.
  /// Per-frame tick — exact order: clock, spawn, advance, sweep.
  // MARK: - Meltdown
  func startMeltdown() {
    DispatchQueue.main.async {
      // Specials are mutually exclusive. Freezing first means whatever the
      // previous effect produced becomes permanent instead of snapping back.
      if self.destroyActive || self.washActive { self.freezeActiveEffects() }
      self.meltdownActive = true
    }
  }

  func stopMeltdown() {
    DispatchQueue.main.async { self.stopMeltSimulation() }
  }

  /// Stop the melt shader and remove its transient drip/puddle state. Without
  /// this cleanup the old runs continued to advance after the button/touch
  /// appeared to stop, which made the next stroke look blocked by melting.
  private func stopMeltSimulation() {
    stopMeltSimulationState(resetShader: true)
  }

  /// Tear down the melt simulation.
  ///
  /// `resetShader: false` is the freeze path — it keeps meltT where it is (the
  /// strokes stay melted) and leaves the on-screen drips alone, because
  /// `bakeMeltResidue()` has already claimed them as permanent artwork.
  private func stopMeltSimulationState(resetShader: Bool) {
    meltdownActive = false
    dripActiveCap = Self.dripMaxActive
    meltClock = 0
    meltLastReseed = 0
    meltSeeds.removeAll(keepingCapacity: true)
    activeRuns.removeAll()
    dripCells.removeAll()
    if resetShader {
      meltProgress = 0
      for node in dripNodePool {
        node.isHidden = true
        for child in node.childNodes { child.isHidden = true }
      }
      for (_, puddle) in puddles { puddle.node.removeFromParentNode() }
      puddles.removeAll()
      for node in washCameraNodes { node.removeFromParentNode() }
      washCameraNodes.removeAll(keepingCapacity: true)
      applyMeltUniforms()
    }
  }

  /// Called before every valid paint/erase touch.
  ///
  /// This used to CANCEL the running effect, which is what made the original
  /// artwork spring back the moment you started painting again: melt reset its
  /// shader uniform to zero and destroy dropped its bodies without recording
  /// where they had fallen. It now FREEZES instead — whatever is on screen
  /// becomes permanent — and the new stroke starts a fresh live layer on top.
  private func pauseSpecialEffectsForNewStroke() {
    let stoppedMeltdown = meltdownActive
    let stoppedDestroy = destroyActive
    let stoppedWash = washActive
    guard stoppedMeltdown || stoppedDestroy || stoppedWash else { return }

    freezeActiveEffects()
    onStrokeStarted([
      "meltdownStopped": stoppedMeltdown,
      "destroyStopped": stoppedDestroy,
      "threeDStopped": stoppedWash,
    ])
  }

  /// Bake the current effect result into the permanent artwork.
  ///
  /// Three things have to be preserved, because each has its own way of
  /// springing back:
  ///  1. Melt lives in shader uniforms on shared materials → retire the whole
  ///     layer so those uniforms are never written again.
  ///  2. Explode lives in physics transforms SceneKit owns → copy the simulated
  ///     transform onto the node and remember it on the record, since `stamps`
  ///     still describe the original spot on the wall.
  ///  3. Drips and puddles are transient overlay nodes → hand them to the
  ///     frozen artwork instead of deleting them.
  private func freezeActiveEffects() {
    guard meltdownActive || destroyActive || washActive else { return }
    freezingEffects = true
    defer { freezingEffects = false }

    if destroyActive { bakeDestroyTransforms() }
    if meltdownActive || washActive { bakeMeltResidue() }

    // Retire the generation these strokes render through, then start a clean
    // one. Existing nodes keep referencing the retired materials, so they hold
    // their melted look forever while the next stroke paints unmelted.
    liveLayer.frozen = true
    frozenLayers.append(liveLayer)
    liveLayer = RenderLayer()

    meltdownActive = false
    washActive = false
    destroyActive = false
    stopMeltSimulationState(resetShader: false)
    teardownDestroy()
    // The next effect must start from zero on the NEW layer. The frozen layer
    // keeps the values it was baked with.
    meltProgress = 0
    lastPushedMeltT = -1
    washProgress = 0
    lastPushedWashT = -1
    washScenePalette.removeAll(keepingCapacity: true)
  }

  /// Copy each fallen stroke's simulated transform onto the node itself and
  /// record it, so a later rebuild re-applies the fall instead of snapping the
  /// stroke back onto the wall.
  private func bakeDestroyTransforms() {
    for record in allStrokeRecordsForMelt() {
      let node = record.node
      guard node.physicsBody != nil else { continue }
      node.transform = node.presentation.transform
      record.bakedTransform = node.transform
      node.physicsBody = nil
    }
    for node in destroyBodies where node.physicsBody != nil {
      node.transform = node.presentation.transform
      node.physicsBody = nil
    }
  }

  /// Keep the drips and puddles that are currently on screen as permanent
  /// residue instead of clearing them, and stop them being recycled.
  private func bakeMeltResidue() {
    for run in activeRuns { run.node.name = "frozenDripResidue" }
    for (_, puddle) in puddles { puddle.node.name = "frozenDripResidue" }
    // Detach from the pools so the next melt allocates fresh nodes and never
    // recycles (and therefore never erases) this frozen residue.
    frozenResidueNodes.append(contentsOf: dripNodePool.filter { !$0.isHidden })
    dripNodePool.removeAll { !$0.isHidden }
    dripPoolCursor = 0
    for (_, puddle) in puddles { frozenResidueNodes.append(puddle.node) }
    puddles.removeAll()
    for node in washCameraNodes {
      node.name = "frozenWashCameraSmudge"
      frozenResidueNodes.append(node)
    }
    washCameraNodes.removeAll(keepingCapacity: true)
  }

  private func allStrokeRecordsForMelt() -> [StrokeRecord] {
    var out: [StrokeRecord] = []
    for e in undoHistory { out.append(contentsOf: paintRecords(in: e)) }
    liveAnimationGestureRecords.forEach { out.append($0) }
    if let r = liveStrokeRecord { out.append(r) }
    if let r = liveMirrorRecord { out.append(r) }   // mirrored half melts/falls too
    return out
  }

  private func startMeltdownInternal() {
    meltClock = 0
    meltLastReseed = 0
    meltProgress = 0
    lastPushedMeltT = -1
    dripActiveCap = Self.meltActiveCap
    dripRoot.isHidden = false
    buildMeltSeeds()
    seedMeltDrips(fresh: true)
  }

  // MARK: - Wash

  func startWash() {
    DispatchQueue.main.async {
      // Specials are mutually exclusive. Freezing first means the previous
      // effect's result is kept rather than snapping back to pristine paint.
      if self.meltdownActive || self.destroyActive { self.freezeActiveEffects() }
      self.washActive = true
    }
  }

  func stopWash() {
    DispatchQueue.main.async {
      guard self.washActive else { return }
      // Stopping a wash BAKES it: the washed, pooled result is the artwork now.
      self.freezeActiveEffects()
    }
  }

  private func startWashInternal() {
    washClock = 0
    washLastReseed = 0
    washProgress = 0
    lastPushedWashT = -1
    washLastCameraDab = -100
    washLastHandSmudge = -100
    washCameraSeedCursor = 0
    dripActiveCap = Self.meltActiveCap
    dripRoot.isHidden = false
    buildMeltSeeds()
    buildWashScenePalette()
    seedMeltDrips(fresh: true)
  }

  /// Push wash progress into the LIVE materials only — frozen layers keep the
  /// washT they were baked at, exactly as with melt.
  private func applyWashUniforms() {
    guard abs(washProgress - lastPushedWashT) > 0.0005 else { return }
    lastPushedWashT = washProgress
    for (_, m) in liveLayer.materials {
      m.setValue(CGFloat(washProgress), forKey: "washT")
    }
  }

  /// Per-frame wash advance. Deliberately slower than melt at the start (the
  /// strokes have to stay recognisable while they get wet) and then keeps
  /// running so the material carries on spreading and mixing after it lands.
  private func advanceWash(dt: TimeInterval) {
    washClock += dt
    washProgress = min(3.0, washProgress + Float(dt) * 0.16)
    applyWashUniforms()
    // Sample only paint that is currently inside the camera view. The camera
    // pixels are rectified onto the stroke's real plane and clipped by a soft,
    // irregular pigment mask, so Wash feels like reality soaking into paint.
    if washClock - washLastCameraDab > 0.32 {
      washLastCameraDab = washClock
      addVisibleWashCameraDab()
    }
    // Keep feeding new runs so the wall carries on shedding material instead of
    // going static after the first wave.
    if washClock - washLastReseed > 1.0 {
      washLastReseed = washClock
      seedMeltDrips(fresh: false)
    }
  }



  /// Compute the downsampled seed list ONCE (committed stamps never move);
  /// reseeds replay it instead of re-walking the whole history every 2.5s.
  private func buildMeltSeeds() {
    meltSeeds.removeAll(keepingCapacity: true)
    let records = allStrokeRecordsForMelt()
    let total = max(1, records.reduce(0) { $0 + $1.stamps.count })
    let stride = max(1, total / 1000)    // denser seeding → all strokes dissolve
    var idx = 0
    for r in records {
      for s in r.stamps {
        idx += 1
        if idx % stride != 0 { continue }
        let n = simd_normalize(s.orientation.act(simd_float3(0, 0, 1)))
        meltSeeds.append((simd_float3(s.position.x, s.position.y, s.position.z), n, s.emoji, s.size))
      }
    }
  }

  /// Gather vivid pigments from every emoji in the layer. We preserve separate
  /// colours (rather than averaging RGB, which quickly makes grey/white mud),
  /// then draw them as moving gradients in runs, pools and camera smudges.
  private func buildWashScenePalette() {
    var palette: [UIColor] = []
    var seen = Set<String>()
    for (_, _, emoji, _) in meltSeeds where seen.insert(Self.brushCacheKey(emoji)).inserted {
      palette = mergedFluidPalette(palette, emojiPalette(for: emoji), limit: 14)
    }
    washScenePalette = palette.isEmpty ? [UIColor.systemPink] : palette
  }

  /// Seed the drip film from the cached stamp seeds. High thickness → it yields
  /// immediately and starts running down WALLS. Floor/ceiling seeds are skipped:
  /// there the melt is the actual stroke shader (geometry ooze + surface drain),
  /// NOT spawned drip-run geometry — that's what looked strange on the floor.
  private func seedMeltDrips(fresh: Bool) {
    let thick = Self.dripCriticalThickness * (fresh ? 2.5 : 1.4)   // heavy fluid → runs down walls
    for (pos, n, emoji, _) in meltSeeds {
      if abs(n.y) > 0.75 { continue }   // flat surface → shader-only melt, no drip runs
      let key = cellKey(pos)
      if var cell = dripCells[key] {
        cell.thickness = max(cell.thickness, thick); cell.emoji = emoji; cell.normal = n
        cell.lastTouch = dripClock; dripCells[key] = cell
      } else {
        dripCells[key] = DripCell(thickness: thick, position: pos, normal: n,
                                  emoji: emoji, lastTouch: dripClock, cooldownUntil: 0)
      }
    }
  }

  // ── 3D strokes: re-stamp every stroke with downloaded 3D emoji meshes ──────
  // Pop 3D is entirely local. A generated USDZ is the wrong dependency for a
  // quick AR effect: it fails offline and imported UV conventions can flip the
  // artwork. We build a rounded PBR shell in SceneKit and place the SAME plane
  // material already used by flat painting on its front, so emoji/custom-PNG
  // orientation exactly matches the original stroke.




















  // Legacy downloaded 3D models are kept for saved/API compatibility, but the
  // user-facing Pop 3D special never calls them or the Linux service.







  // MARK: - Destroy (physics)
  func startDestroy() {
    DispatchQueue.main.async {
      if self.meltdownActive || self.washActive { self.freezeActiveEffects() }
      self.startDestroyInternal()
    }
  }

  func stopDestroy() { DispatchQueue.main.async { self.teardownDestroy() } }

  private func startDestroyInternal() {
    guard !destroyActive else { return }
    destroyActive = true
    let world = arView.scene.physicsWorld
    world.gravity = SCNVector3(0, -7.5, 0)
    world.contactDelegate = self

    // Real walls become static colliders → strokes bounce off them.
    for n in wallColliderNodes where n.physicsBody == nil {
      let b = SCNPhysicsBody(type: .static,
                             shape: SCNPhysicsShape(node: n, options: [.type: SCNPhysicsShape.ShapeType.boundingBox]))
      b.categoryBitMask = 2; b.collisionBitMask = 1; b.restitution = 0.5; b.friction = 0.7
      n.physicsBody = b
    }

    // A big invisible ground just below the camera so falling strokes land + pile.
    let cam = arView.pointOfView?.simdWorldPosition ?? .zero
    let groundGeo = SCNPlane(width: 10, height: 10)
    groundGeo.firstMaterial?.colorBufferWriteMask = []      // invisible
    let ground = SCNNode(geometry: groundGeo)
    ground.eulerAngles.x = -.pi / 2
    ground.simdPosition = simd_float3(cam.x, cam.y - 1.45, cam.z)
    let gb = SCNPhysicsBody(type: .static, shape: SCNPhysicsShape(geometry: groundGeo, options: nil))
    gb.categoryBitMask = 2; gb.collisionBitMask = 1; gb.restitution = 0.42; gb.friction = 0.85
    ground.physicsBody = gb
    arView.scene.rootNode.addChildNode(ground)
    destroyGround = ground

    // The biggest ~150 strokes get dynamic bodies (heavier the longer the stroke);
    // the rest simply stay put (bounded so thousands of strokes stay phone-safe).
    let records = allStrokeRecordsForMelt().sorted { $0.stamps.count > $1.stamps.count }
    for r in records.prefix(Self.destroyMaxBodies) {
      let node = r.node
      guard node.parent != nil, node.physicsBody == nil else { continue }
      let shape = SCNPhysicsShape(node: node, options: [.type: SCNPhysicsShape.ShapeType.boundingBox])
      let body = SCNPhysicsBody(type: .dynamic, shape: shape)
      body.mass = CGFloat(max(0.2, Float(r.stamps.count) * 0.02))   // longer stroke → more weight
      body.restitution = 0.55; body.friction = 0.55; body.damping = 0.2
      // Contact-test stroke↔stroke too → clicks + squash on EVERY collision.
      body.categoryBitMask = 1; body.collisionBitMask = 1 | 2; body.contactTestBitMask = 1 | 2
      node.physicsBody = body
      node.castsShadow = strokeShadowsEnabled
      // Small random kick so they scatter/tumble instead of dropping in a sheet.
      body.applyForce(SCNVector3(Float.random(in: -0.4...0.4), Float.random(in: 0...0.2), Float.random(in: -0.4...0.4)), asImpulse: true)
      body.applyTorque(SCNVector4(Float.random(in: -1...1), Float.random(in: -1...1), Float.random(in: -1...1), Float.random(in: 0.1...0.5)), asImpulse: true)
      // Every falling line lives a different random time on the floor.
      destroyDeadlines[ObjectIdentifier(node)] = CACurrentMediaTime() + Double.random(in: 6...16)
      destroyBodies.append(node)
    }
  }

  private func teardownDestroy() {
    for n in destroyBodies { n.physicsBody = nil }
    destroyBodies.removeAll()
    destroyDeadlines.removeAll()
    lastSquashAt.removeAll()
    for n in wallColliderNodes { n.physicsBody = nil }
    destroyGround?.removeFromParentNode(); destroyGround = nil
    arView.scene.physicsWorld.contactDelegate = nil
    destroyActive = false
  }

  // Pre-baked collision clicks at 4 pitches — no per-hit buffer synthesis on the
  // main thread while 150 bodies are colliding (the busiest moment).
  private var hitClickBuffers: [AVAudioPCMBuffer] = []
  private func ensureHitClickBuffers() {
    guard hitClickBuffers.isEmpty,
          let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1) else { return }
    let sr = Float(format.sampleRate)
    for base in [Float(950), 1150, 1350, 1550] {
      let frames = AVAudioFrameCount(format.sampleRate * 0.05)
      guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { continue }
      buffer.frameLength = frames
      guard let data = buffer.floatChannelData?[0] else { continue }
      let n = Int(frames)
      for i in 0..<n {
        let t = Float(i) / sr
        let prog = Float(i) / Float(max(1, n))
        let env = expf(-prog * 22)                  // sharp percussive decay = "click"
        data[i] = sinf(2 * .pi * base * t) * env * 0.5
      }
      hitClickBuffers.append(buffer)
    }
  }

  // Throttled collision click — volume scales with impact, buffer pre-baked.
  private func playHitClick(_ intensity: Float) {
    guard audioReady, soundEnabled else { return }
    let now = CACurrentMediaTime()
    if now - lastHitClickTime < 0.05 { return }   // ≤ ~20 clicks/sec no matter how many hits
    lastHitClickTime = now
    ensureHitClickBuffers()
    guard let buffer = hitClickBuffers.randomElement() else { return }
    fxPlayer.scheduleBuffer(buffer, at: nil)
    fxPlayer.volume = 0.35 + 0.6 * min(1, intensity)
    if !fxPlayer.isPlaying { fxPlayer.play() }
  }

  // SCNPhysicsContactDelegate — clicks + bend/stretch squash on impact.
  func physicsWorld(_ world: SCNPhysicsWorld, didBegin contact: SCNPhysicsContact) {
    let impulse = Float(contact.collisionImpulse)
    guard impulse > 0.02 else { return }
    let strokeNode = contact.nodeA.physicsBody?.type == .dynamic
      ? contact.nodeA
      : (contact.nodeB.physicsBody?.type == .dynamic ? contact.nodeB : nil)
    DispatchQueue.main.async { [weak self] in
      self?.playHitClick(min(1.0, impulse / 1.5))
      if let node = strokeNode { self?.squashStroke(node, intensity: min(1.0, impulse / 1.2)) }
    }
  }

  /// "Bend & stretch": a quick cartoon squash on impact — wider + flatter for a
  /// beat, then spring back. Visual only (physics shape untouched), throttled.
  private func squashStroke(_ node: SCNNode, intensity: Float) {
    let key = ObjectIdentifier(node)
    let now = CACurrentMediaTime()
    if let t = lastSquashAt[key], now - t < 0.25 { return }
    lastSquashAt[key] = now
    let s = CGFloat(1.0 + min(0.4, 0.12 + intensity * 0.28))
    // Each emoji's own node also carries its mirror flip as a negative x/y
    // scale (Pop 3D is now one physics body per emoji, not per stroke) — keep
    // that sign so a squash never un-mirrors a flipped stamp.
    let restScale = node.scale
    let signX: CGFloat = restScale.x < 0 ? -1 : 1
    let signY: CGFloat = restScale.y < 0 ? -1 : 1
    SCNTransaction.begin()
    SCNTransaction.animationDuration = 0.09
    node.scale = SCNVector3(s * signX, (2.0 - s) * signY, s)  // stretch wide, squash flat
    SCNTransaction.completionBlock = {
      SCNTransaction.begin()
      SCNTransaction.animationDuration = 0.18
      node.scale = SCNVector3(signX, signY, 1)
      SCNTransaction.commit()
    }
    SCNTransaction.commit()
  }

  /// Expire fallen strokes on their own random clock (they stay pushable on the
  /// floor for 6–16s, then fade out); when the last one goes, physics tears down.
  private func sweepDestroyBodies() {
    guard destroyActive else { return }
    guard !destroyBodies.isEmpty else { teardownDestroy(); return }
    let now = CACurrentMediaTime()
    var kept: [SCNNode] = []
    for node in destroyBodies {
      let key = ObjectIdentifier(node)
      if let deadline = destroyDeadlines[key], now > deadline {
        destroyDeadlines.removeValue(forKey: key)
        node.physicsBody = nil
        node.runAction(.sequence([.fadeOut(duration: 0.6), .removeFromParentNode()]))
      } else {
        kept.append(node)
      }
    }
    destroyBodies = kept
  }

  /// The human stencil SHOVES the effects: in melt mode it pushes the fluid runs
  /// out of the body silhouette (hard edge, like squeegeeing paint); in destroy
  /// mode it knocks the fallen strokes around. Samples ARKit's person
  /// segmentation mask every 3rd frame — cheap (≤48 runs + ≤300 bodies).
  private func applyPersonPush() {
    guard meltdownActive || destroyActive || washActive, personOcclusionEnabled else { return }
    personPushFrameCounter &+= 1
    guard personPushFrameCounter % 3 == 0 else { return }
    guard let frame = arView.session.currentFrame,
          let seg = frame.segmentationBuffer else { return }
    CVPixelBufferLockBaseAddress(seg, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(seg, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(seg) else { return }
    let w = CVPixelBufferGetWidth(seg)
    let h = CVPixelBufferGetHeight(seg)
    let rowStride = CVPixelBufferGetBytesPerRow(seg)
    let px = base.bindMemory(to: UInt8.self, capacity: rowStride * h)
    let cam = frame.camera
    let viewport = bounds.size
    guard viewport.width > 1, viewport.height > 1 else { return }
    let viewToImage = frame.displayTransform(
      for: currentInterfaceOrientation,
      viewportSize: viewport
    ).inverted()
    func maskAt(_ x: Int, _ y: Int) -> Float {
      guard x >= 0, x < w, y >= 0, y < h else { return 0 }
      return px[y * rowStride + x] > 0 ? 1 : 0
    }
    // (inside?, screen-space outward gradient) for a world position
    func sample(_ world: simd_float3) -> (Bool, simd_float2) {
      let p = cam.projectPoint(world, orientation: currentInterfaceOrientation, viewportSize: viewport)
      guard p.x.isFinite, p.y.isFinite else { return (false, .zero) }
      let viewNormalized = CGPoint(x: p.x / viewport.width, y: p.y / viewport.height)
      let imageNormalized = viewNormalized.applying(viewToImage)
      let x = Int(imageNormalized.x * CGFloat(w))
      let y = Int(imageNormalized.y * CGFloat(h))
      guard x >= 2, x < w - 2, y >= 2, y < h - 2, maskAt(x, y) > 0.5 else { return (false, .zero) }
      let gx = maskAt(x + 2, y) - maskAt(x - 2, y)
      let gy = maskAt(x, y + 2) - maskAt(x, y - 2)
      return (true, simd_float2(gx, gy))
    }
    let camT = cam.transform
    let right = simd_float3(camT.columns.0.x, camT.columns.0.y, camT.columns.0.z)
    let up = simd_float3(camT.columns.1.x, camT.columns.1.y, camT.columns.1.z)
    func outwardDir(_ g: simd_float2) -> simd_float3 {
      // Gradient points INTO the mask; push out = opposite. Screen y is down.
      var dir = -(right * g.x) + up * g.y
      if simd_length(dir) < 1e-4 { dir = right }
      return simd_normalize(dir)
    }
    // Melt and wash both flow as runs, so the stencil disturbs both. Wash is
    // wetter: the shove is stronger and it drives extra mixing where the person
    // cuts through the liquid.
    if meltdownActive || washActive {
      for run in activeRuns {
        let (inside, g) = sample(run.position)
        guard inside else { continue }
        // HEAVY shove: add a big velocity impulse (persists + decays over ~1.6s)
        // AND nudge the head immediately so the colour visibly leaps out.
        let out = outwardDir(g)
        // Wash is liquid, so the person shoves it noticeably harder than melt.
        // Colour exchange and a camera-texture smudge are applied below; there
        // is deliberately no white/grey convergence.
        let shove: Float = washActive ? 1.5 : 0.9
        run.pushVel += out * shove
        run.position += out * (washActive ? 0.09 : 0.06)
        if washActive {
          let mixed = mergedFluidPalette(run.colors, washScenePalette, limit: 8)
          if !sameFluidPalette(run.colors, mixed) {
            run.colors = mixed
            refreshFluidTextures(for: run)
          }
          let now = CACurrentMediaTime()
          if now - washLastHandSmudge > 0.17 {
            washLastHandSmudge = now
            addWashCameraSmudge(
              from: frame,
              at: run.position,
              normal: run.normal,
              size: max(0.055, brushSizeMeters * 1.15),
              colors: run.colors,
              push: out,
              handDriven: true
            )
          }
        }
        run.pushSinceEmit = max(0, run.pushSinceEmit)  // un-park pushed pools
        run.v0 = min(0.3, run.v0 * 1.4)
      }
    }
    if destroyActive {
      for node in destroyBodies {
        guard let body = node.physicsBody else { continue }
        let (inside, g) = sample(node.presentation.simdWorldPosition)
        guard inside else { continue }
        let dir = outwardDir(g) * 0.6
        body.applyForce(SCNVector3(dir.x, 0.15, dir.z), asImpulse: true)
      }
    }
  }

  private func updateDrips(dt: TimeInterval) {
    // Person stencil pushes fluid runs (melt) and fallen strokes (destroy).
    applyPersonPush()
    sweepDestroyBodies()
    // Meltdown: advance the GPU shader melt (strokes sag/stretch/drain) and
    // re-seed streak runs so paint keeps oozing.
    if meltdownActive {
      meltClock += dt
      // EXTREME: full melt in ~18s, then keeps stretching up to 2.2.
      meltProgress = min(2.2, meltProgress + Float(dt) * 0.12)
      applyMeltUniforms()
      if meltClock - meltLastReseed > 1.2 { meltLastReseed = meltClock; seedMeltDrips(fresh: false) }
    }
    // Wash: same per-frame slot, its own pacing and mixing curve.
    if washActive { advanceWash(dt: dt) }
    // Drips are a continuous physical simulation rather than frame-owned
    // geometry. Hide/pause them in Animator mode so they cannot leak between
    // frames; ordinary AR painting keeps the exact existing behaviour.
    guard dt > 0, !animationEnabled else { return }
    dripClock += dt
    let dtf = Float(dt)

    // DEPOSITION while spraying. Offset only slightly DOWN from the stamp centre
    // (scaled by brush size) so runs start INSIDE the lower part of the emoji,
    // not below it.
    if isPaintingNow, toolMode != "eraser", let cur = lastStampPosition {
      let n = strokePlaneNormal ?? spraySurfaceNormal
      let g = simd_float3(0, -1, 0)
      var down = g - simd_dot(g, n) * n
      let dl = simd_length(down)
      let bottom = dl > 0.01 ? (down / dl) * (Float(brushSizeMeters) * 0.06) : simd_float3(0, 0, 0)
      let pos = simd_float3(cur.x, cur.y, cur.z) + bottom
      let brushW = max(0.005, Float(brushSizeMeters))
      let flux = 1.0 * min(3.0, max(0.5, 0.06 / brushW))  // higher base → starts running sooner
      depositPaint(pos, n, flux * dtf)
    }

    spawnReadyRuns()
    advanceRuns(dtf)
    if dripClock - dripLastSweep > 2.0 { dripLastSweep = dripClock; sweepDryCells() }
  }

  private func cellKey(_ p: simd_float3) -> SIMD3<Int> {
    SIMD3<Int>(Int(floor(p.x / Self.dripCellSize)),
               Int(floor(p.y / Self.dripCellSize)),
               Int(floor(p.z / Self.dripCellSize)))
  }

  /// Bleed 28% of deposited paint into a random neighbour cell so a long hover
  /// saturates a ragged patch → multiple uneven runs, not one tidy line.
  private func depositPaint(_ position: simd_float3, _ n: simd_float3, _ amount: Float) {
    guard amount > 0 else { return }
    var side = simd_cross(n, simd_float3(0, 1, 0))
    if simd_length(side) < 1e-4 { side = simd_float3(1, 0, 0) }
    side = simd_normalize(side)
    let cs = Self.dripCellSize
    // Scale the sideways bleed by brush size: a SMALL stroke must drip almost
    // exactly under itself (tiny bleed); a big stroke can spread to a ragged
    // patch. This stops small-brush drips appearing next to the stroke.
    let bleedScale = min(1.0, max(0.15, Float(brushSizeMeters) / 0.06))
    let bleed = (side * Float.random(in: -cs...cs) + simd_float3(0, Float.random(in: -cs...cs) * 0.6, 0)) * bleedScale
    depositToCell(position, n, amount * 0.72)
    depositToCell(position + bleed, n, amount * 0.28)
  }

  private func depositToCell(_ position: simd_float3, _ n: simd_float3, _ amt: Float) {
    let key = cellKey(position)
    if var cell = dripCells[key] {
      let dt2 = Float(dripClock - cell.lastTouch)
      cell.thickness = cell.thickness * expf(-dt2 / Self.dripCellDryingTau) + amt  // evaporate THEN add
      cell.position = position; cell.normal = n; cell.emoji = brushEmoji
      cell.lastTouch = dripClock
      dripCells[key] = cell
    } else {
      dripCells[key] = DripCell(thickness: amt, position: position, normal: n,
                                emoji: brushEmoji, lastTouch: dripClock, cooldownUntil: 0)
    }
  }

  /// Start new runs where the film has yielded; grow puddles on flat surfaces.
  private func spawnReadyRuns() {
    // Parked pools (pushSinceEmit == -1) are static — don't count them against the
    // spawn cap, so fresh melt keeps flowing even over lots of pooled water.
    func activeFlowing() -> Int { activeRuns.reduce(0) { $0 + ($1.pushSinceEmit < -0.5 ? 0 : 1) } }
    if activeFlowing() >= dripActiveCap { return }
    let g = simd_float3(0, -1, 0)
    for key in Array(dripCells.keys) {
      if activeFlowing() >= dripActiveCap { break }
      guard var cell = dripCells[key] else { continue }
      if dripClock < cell.cooldownUntil { continue }
      let n = cell.normal
      let gTan = g - n * simd_dot(g, n)
      let steep = simd_length(gTan)                       // 1=vertical wall, 0=flat
      let dt2 = Float(dripClock - cell.lastTouch)
      let thickness = cell.thickness * expf(-dt2 / Self.dripCellDryingTau)

      // FLOOR / shallow surface → pools instead of running.
      if steep <= Self.dripMinSteepness {
        if n.y > 0.7 && thickness > Self.dripCriticalThickness * 1.1 {
          let excess = thickness - Self.dripCriticalThickness * Self.dripRetained
          cell.thickness = Self.dripCriticalThickness * Self.dripRetained
          cell.cooldownUntil = dripClock + 0.35           // refills fast, puddle keeps growing
          cell.lastTouch = dripClock
          dripCells[key] = cell
          growPuddle(at: cell.position, normal: n, excess: excess, emoji: cell.emoji)
        }
        continue
      }

      // YIELD: a vertical film holds until h > h_c / steepness (±15% jitter).
      let threshold = (Self.dripCriticalThickness / steep) * Float.random(in: 0.85...1.15)
      if thickness <= threshold { continue }
      // Bigger brushes → tighter spacing → MORE simultaneous mini-runs.
      let bf = Float(brushSizeMeters)
      let spacing = max(0.012, Self.dripMinSpawnSpacing * (0.05 / max(0.02, bf)))
      if runNearby(cell.position, spacing) { continue }   // fingering spacing

      let excess = thickness - threshold * Self.dripRetained
      cell.thickness = threshold * Self.dripRetained
      cell.cooldownUntil = dripClock + Self.dripCellCooldown
      cell.lastTouch = dripClock
      dripCells[key] = cell
      startRun(cell: cell, volume: excess)
    }
  }

  private func runNearby(_ p: simd_float3, _ spacing: Float) -> Bool {
    for r in activeRuns where simd_distance(r.position, p) < spacing { return true }
    return false
  }

  private func startRun(cell: DripCell, volume: Float) {
    let run = DripRun(node: nextRunNode())
    run.position = cell.position
    run.planePoint = cell.position
    run.normal = cell.normal
    // Brush-size scaling: bigger brush → faster runs that go LESS far (capped
    // volume) → reads as several quick mini-drips instead of one long one.
    let bf = Float(brushSizeMeters)
    let sizeFactor = min(2.5, max(0.6, bf / 0.05))        // 1.0 at a 5 cm brush
    // Per-run speed jitter so identical conditions still look different.
    run.v0 = Self.dripInitialSpeed * (1 + 0.55 * (sizeFactor - 1)) * Float.random(in: 0.7...1.45)
    let maxVol: Float = sizeFactor > 1.3 ? 0.85 : 2.2     // big → shorter runs
    // Random volume multiplier → some barely creep, others run far.
    run.volume = min(volume, maxVol) * Float.random(in: 0.45...1.6)
    run.initialVolume = max(run.volume, 0.05)
    run.age = 0
    run.distanceSinceEmit = 0
    // HALF the previous width, and all drips nearly the SAME width (just ±12%
    // jitter) with only a mild brush-size influence — so they read as a tidy set
    // of consistent runs, not wildly different blobs.
    let widthSize = min(1.25, max(0.78, 0.85 + 0.3 * (sizeFactor - 1)))
    run.width = 0.0040 * Float.random(in: 0.88...1.12) * Float(widthSize)
    run.meanderPhase = Float.random(in: 0...(2 * .pi))
    // Mostly STRAIGHT down with gentle, varied wiggle (still keeps some curve).
    run.meanderAmp = Float.random(in: 0.015...0.13)
    run.meanderFreq = Float.random(in: 1.3...3.8)
    run.curveBias = Float.random(in: -0.06...0.06)
    run.maxTrail = Int.random(in: 6...(Self.dripMaxTrail - 1))
    run.emoji = cell.emoji
    run.trail = [(cell.position, 1.0)]
    configureRunNode(run)
    activeRuns.append(run)
  }

  /// Falling-film dynamics: v = v0·s·(V/V0)^(2/3)·exp(-age/τ).
  private func advanceRuns(_ dt: Float) {
    let g = simd_float3(0, -1, 0)
    mergeNearbyRuns()
    var keep: [DripRun] = []
    for run in activeRuns {
      run.age += TimeInterval(dt)
      let ageF = Float(run.age)
      let volumeFactor = powf(max(run.volume / run.initialVolume, 0), 0.66)
      let n = run.normal
      let gTan = g - n * simd_dot(g, n)
      let steep = simd_length(gTan)
      let speed = run.v0 * steep * volumeFactor * expf(-ageF / Self.dripDryingTau)

      // In-plane sideways axis (for meander).
      var side0 = simd_cross(n, simd_float3(0, 1, 0))
      if simd_length(side0) < 1e-4 { side0 = simd_cross(n, simd_float3(1, 0, 0)) }
      side0 = simd_normalize(side0)

      // Persistent stencil push (works on ANY surface incl. flat floors). Project
      // onto the surface plane so pushed colour slides along it like water.
      var pushStep = run.pushVel * dt
      pushStep -= n * simd_dot(pushStep, n)
      let pushMag = simd_length(run.pushVel)
      run.pushVel *= expf(-dt / 1.6)                       // the movement lasts a bit

      let flowing = speed >= 0.0025 && run.volume >= 0.04 && steep >= 0.1
      let pushing = pushMag >= 0.012
      if !flowing && !pushing {
        if run.pushSinceEmit < -0.5 {                     // marker: already parked
        } else {
          run.trail.append((run.position, 1.5))           // one final teardrop blob
          run.pushSinceEmit = -1                          // parked marker (don't re-append)
          // Ordinary (non-melt) flat drips still pool as a small disc. During
          // meltdown NO drip runs are seeded on flat surfaces, so the floor melt
          // is purely the stroke shader — never a stamped puddle.
          if steep < 0.12 && !meltdownActive && run.volume > 0.02 {
            growPuddle(at: run.position, normal: n, excess: run.volume * 0.6, emoji: run.emoji)
            run.volume *= 0.45
          }
          updateRunNode(run)
        }
        keep.append(run)                                  // kept: a stencil can still shove it later
        continue
      }
      run.pushSinceEmit = max(0, run.pushSinceEmit)       // un-park once moving again

      // Combined motion = gravity flow down the wall + stencil push.
      var move = pushStep
      if flowing {
        let meander = sinf(ageF * run.meanderFreq + run.meanderPhase) * run.meanderAmp + run.curveBias
        let dir = simd_normalize(gTan / steep + side0 * meander)
        move += dir * (speed * dt)
      }
      let stepLen = simd_length(move)
      var newPos = run.position + move
      run.distanceSinceEmit += stepLen
      run.volume -= stepLen * 1.4                          // deposition drains the head

      if run.distanceSinceEmit >= Self.dripEmitSpacing {
        newPos -= n * simd_dot(newPos - run.planePoint, n) // re-project onto the plane
        run.position = newPos
        run.distanceSinceEmit = 0
        run.trail.append((newPos, 0.92))
        if run.trail.count >= min(run.maxTrail, Self.dripMaxTrail - 1) {
          run.trail.append((run.position, 1.5))
          updateRunNode(run)
          keep.append(run)                                // stay for stencil pushes; parks by volume next frames
          continue
        }
      } else {
        run.position = newPos
      }
      updateRunNode(run)
      keep.append(run)
    }
    // Bound the parked-run population so pooled water can't grow without limit.
    if keep.count > Self.meltActiveCap * 2 {
      keep.sort { simd_length($0.pushVel) > simd_length($1.pushVel) }
      for extra in keep[(Self.meltActiveCap * 2)...] { extra.node.removeFromParentNode() }
      keep = Array(keep[0..<(Self.meltActiveCap * 2)])
    }
    activeRuns = keep
  }

  /// When two running heads drift within ~1.3 cm they coalesce: the larger run
  /// absorbs the smaller's volume, fattens, gains fresh momentum and a longer
  /// length cap, then keeps running down. The absorbed run ends in a teardrop
  /// where it joined.
  private func mergeNearbyRuns() {
    guard activeRuns.count > 1 else { return }
    let mergeDist: Float = 0.013
    var mergedAway = Set<ObjectIdentifier>()
    for i in 0..<activeRuns.count {
      let a = activeRuns[i]
      if mergedAway.contains(ObjectIdentifier(a)) { continue }
      for j in (i + 1)..<activeRuns.count {
        let b = activeRuns[j]
        if mergedAway.contains(ObjectIdentifier(b)) { continue }
        if simd_distance(a.position, b.position) > mergeDist { continue }
        let keepRun = a.volume >= b.volume ? a : b
        let gone = keepRun === a ? b : a
        keepRun.volume += gone.volume * 0.85
        keepRun.initialVolume = max(keepRun.initialVolume, keepRun.volume)   // fresh momentum
        keepRun.width = min(0.02, keepRun.width * 1.14)
        keepRun.maxTrail = min(Self.dripMaxTrail - 1, max(keepRun.maxTrail, keepRun.trail.count + 10))
        keepRun.v0 = max(keepRun.v0, gone.v0)
        if washActive || keepRun.gradient != nil {
          // Coalescing is real pigment exchange: keep distinct bands from both
          // emojis so the result stays colourful instead of averaging to mud.
          let mixed = mergedFluidPalette(keepRun.colors, gone.colors, limit: 8)
          if !sameFluidPalette(keepRun.colors, mixed) {
            keepRun.colors = mixed
            refreshFluidTextures(for: keepRun)
          }
        }
        mergedAway.insert(ObjectIdentifier(gone))
        gone.trail.append((gone.position, 1.4))     // teardrop at the join
        updateRunNode(gone)
        if gone === a { break }                     // a was absorbed; stop pairing it
      }
    }
    if !mergedAway.isEmpty {
      activeRuns = activeRuns.filter { !mergedAway.contains(ObjectIdentifier($0)) }
    }
  }

  private func sweepDryCells() {
    for key in Array(dripCells.keys) {
      guard let cell = dripCells[key] else { continue }
      let dt2 = Float(dripClock - cell.lastTouch)
      if cell.thickness * expf(-dt2 / Self.dripCellDryingTau) <= 0.05 {
        dripCells.removeValue(forKey: key)
      }
    }
  }

  // MARK: Drip rendering

  private func configureRunNode(_ run: DripRun) {
    // Resolve the drip's palette from the TRUSTED JS colour catalog (the emoji's
    // actual top colours); fall back to the single catalog colour, then native
    // pixel sampling. Each segment is then painted a SOLID colour interpolated
    // across this palette (top→bottom) in updateRunNode — a clean, correct blend
    // of exactly the colours the emoji has.
    var palette: [UIColor]
    if washActive {
      let local = emojiPalette(for: run.emoji)
      // Rotate the scene palette per emoji/run so adjacent streams begin with
      // different pigments, then exchange more colours when their heads touch.
      let scalarSeed = run.emoji.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
      let offset = washScenePalette.isEmpty ? 0 : scalarSeed % washScenePalette.count
      let rotated = washScenePalette.isEmpty
        ? []
        : Array(washScenePalette[offset...]) + Array(washScenePalette[..<offset])
      palette = mergedFluidPalette(local, Array(rotated.prefix(5)), limit: 8)
    } else if !dripColors.isEmpty {
      palette = dripColors
    } else if let c = dripColor {
      palette = [c]
    } else {
      palette = emojiPalette(for: run.emoji)
    }
    // Gentle wet-paint vividness: a touch more saturation, keep the brightness.
    palette = palette.map { c in
      var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
      return c.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
        ? UIColor(hue: h, saturation: min(1, s * 1.1 + 0.03), brightness: min(1, b * 0.97 + 0.02), alpha: 1)
        : c
    }
    if palette.isEmpty { palette = [UIColor.red] }
    run.colors = palette
    if washActive { refreshFluidTextures(for: run) }
  }

  /// Colour at position t∈[0,1] along the palette (smoothly interpolated).
  private static func paletteColor(_ palette: [UIColor], _ t: Float) -> UIColor {
    guard palette.count > 1 else { return palette.first ?? .red }
    let clamped = min(1, max(0, t))
    let scaled = clamped * Float(palette.count - 1)
    let i = Int(scaled)
    let j = min(i + 1, palette.count - 1)
    let f = CGFloat(scaled - Float(i))
    var r0: CGFloat = 0, g0: CGFloat = 0, b0: CGFloat = 0, a0: CGFloat = 0
    var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
    palette[i].getRed(&r0, green: &g0, blue: &b0, alpha: &a0)
    palette[j].getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
    return UIColor(red: r0 + (r1 - r0) * f, green: g0 + (g1 - g0) * f, blue: b0 + (b1 - b0) * f, alpha: 1)
  }

  /// Interleave two palettes and discard only near-duplicates. Keeping pigment
  /// stops rather than averaging them is what preserves saturated emoji colour.
  private func mergedFluidPalette(_ first: [UIColor], _ second: [UIColor], limit: Int) -> [UIColor] {
    var candidates: [UIColor] = []
    for i in 0..<max(first.count, second.count) {
      if i < first.count { candidates.append(first[i]) }
      if i < second.count { candidates.append(second[i]) }
    }
    var out: [UIColor] = []
    for raw in candidates {
      var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
      let color = raw.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
        ? UIColor(hue: h, saturation: min(1, s * 1.10 + 0.025), brightness: min(1, b * 0.98 + 0.015), alpha: 1)
        : raw
      var cr: CGFloat = 0, cg: CGFloat = 0, cb: CGFloat = 0, ca: CGFloat = 0
      guard color.getRed(&cr, green: &cg, blue: &cb, alpha: &ca) else { continue }
      let duplicate = out.contains { existing in
        var er: CGFloat = 0, eg: CGFloat = 0, eb: CGFloat = 0, ea: CGFloat = 0
        guard existing.getRed(&er, green: &eg, blue: &eb, alpha: &ea) else { return false }
        let dr = cr - er, dg = cg - eg, db = cb - eb
        return dr * dr + dg * dg + db * db < 0.018
      }
      if !duplicate { out.append(color) }
      if out.count >= limit { break }
    }
    return out.isEmpty ? [UIColor.systemPink] : out
  }

  private func sameFluidPalette(_ first: [UIColor], _ second: [UIColor]) -> Bool {
    first.count == second.count && zip(first, second).allSatisfy { pair in
      pair.0.isEqual(pair.1)
    }
  }

  private func refreshFluidTextures(for run: DripRun) {
    run.gradient = fluidPigmentTexture(colors: run.colors, head: false)
    run.headGradient = fluidPigmentTexture(colors: run.colors.reversed(), head: true)
  }

  /// A soft transparent ribbon/disc made from discrete emoji pigments. This is
  /// an ordinary UIKit texture, not a shader argument, so alpha cutout remains
  /// reliable on every SceneKit/Metal device combination.
  private func fluidPigmentTexture<C: Collection>(colors source: C, head: Bool) -> UIImage where C.Element == UIColor {
    let colors = Array(source)
    let size = head ? CGSize(width: 72, height: 72) : CGSize(width: 56, height: 112)
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    format.scale = 1
    return UIGraphicsImageRenderer(size: size, format: format).image { renderer in
      let bounds = CGRect(origin: .zero, size: size)
      let inset: CGFloat = head ? 5 : 7
      let shape = UIBezierPath(roundedRect: bounds.insetBy(dx: inset, dy: head ? inset : 1.5),
                               cornerRadius: head ? size.width * 0.46 : size.width * 0.38)
      shape.addClip()
      let cgColors = (colors.isEmpty ? [UIColor.systemPink] : colors).map(\.cgColor) as CFArray
      guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                      colors: cgColors, locations: nil) else { return }
      let c = renderer.cgContext
      c.drawLinearGradient(
        gradient,
        start: CGPoint(x: size.width * 0.18, y: 0),
        end: CGPoint(x: size.width * 0.82, y: size.height),
        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
      )
      // A translucent cross-current makes neighbouring pigment bands curl into
      // one another without adding white or reducing saturation.
      c.setAlpha(0.24)
      c.drawLinearGradient(
        gradient,
        start: CGPoint(x: size.width, y: size.height * 0.25),
        end: CGPoint(x: 0, y: size.height * 0.72),
        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
      )
    }
  }

  /// Render the run as a thin emoji-textured ribbon along its trail. The emoji
  /// is stretched over the whole run via per-segment vertical UV slices; the
  /// per-point widthScale tapers the body (0.92) and bulges the teardrop (1.5).
  private func updateRunNode(_ run: DripRun) {
    let node = run.node
    node.isHidden = false
    let pts = run.trail
    let nseg = max(0, pts.count - 1)
    let off = run.normal * (Self.stampSurfaceOffset + 0.0015)
    let segCount = Self.dripMaxTrail - 1
    for i in 0..<segCount {
      guard let seg = node.childNode(withName: "seg\(i)", recursively: false),
            let plane = seg.geometry as? SCNPlane else { continue }
      if i < nseg {
        let a = pts[i].pos + off
        let b = pts[i + 1].pos + off
        let d = b - a
        let len = simd_length(d)
        let dir = len > 1e-5 ? d / len : simd_float3(0, -1, 0)
        let yAxis = -dir                 // +Y = up-run so the emoji isn't upside down
        let zAxis = run.normal
        var xAxis = simd_cross(yAxis, zAxis)
        if simd_length(xAxis) < 1e-4 { xAxis = simd_float3(1, 0, 0) }
        xAxis = simd_normalize(xAxis)
        // Fatter ribbon (≈ the picked emoji's width) so the tiled emojis read.
        let w = max(0.0012, run.width * Self.dripEmojiWidthScale * pts[i + 1].scale)
        plane.width = CGFloat(w)
        plane.height = CGFloat(max(0.0006, len))
        seg.simdPosition = a + dir * (len * 0.5)
        seg.simdOrientation = simd_quatf(simd_float3x3(columns: (xAxis, yAxis, zAxis)))
        if let mat = seg.geometry?.firstMaterial {
          if let fluid = run.gradient {
            mat.diffuse.contents = fluid
            mat.diffuse.wrapS = .clamp
            mat.diffuse.wrapT = .clamp
            mat.diffuse.contentsTransform = SCNMatrix4Identity
          } else {
            // Ordinary drip mode keeps the picked emoji tiled down the run.
            mat.diffuse.contents = emojiTexture(for: run.emoji)
            mat.diffuse.wrapS = .repeat
            mat.diffuse.wrapT = .repeat
            let tileY = max(1, (len / Float(w)).rounded())
            mat.diffuse.contentsTransform = SCNMatrix4MakeScale(1, tileY, 1)
          }
        }
        seg.isHidden = false
      } else {
        seg.isHidden = true
      }
    }

    // Head of the drip = a single crisp emoji (the "blob" at the tip), slightly
    // bigger than the ribbon so the teardrop reads as the picked emoji.
    if let head = node.childNode(withName: "head", recursively: false),
       let plane = head.geometry as? SCNPlane, let last = pts.last {
      let hs = CGFloat(max(0.0016, run.width * Self.dripEmojiWidthScale * 1.25))
      plane.width = hs
      plane.height = hs
      head.geometry?.firstMaterial?.diffuse.contents = run.headGradient ?? emojiTexture(for: run.emoji)
      head.simdPosition = last.pos + off
      let zAxis = run.normal
      var xAxis = simd_cross(simd_float3(0, 1, 0), zAxis)
      if simd_length(xAxis) < 1e-4 { xAxis = simd_float3(1, 0, 0) }
      xAxis = simd_normalize(xAxis)
      let yAxis = simd_normalize(simd_cross(zAxis, xAxis))
      head.simdOrientation = simd_quatf(simd_float3x3(columns: (xAxis, yAxis, zAxis)))
      head.isHidden = false
    }
  }

  private func nextRunNode() -> SCNNode {
    let maxNodes = Self.dripMaxActive * 3
    if dripNodePool.count < maxNodes {
      let node = makeRunNode()
      dripRoot.addChildNode(node)
      dripNodePool.append(node)
      return node
    }
    let node = dripNodePool[dripPoolCursor]
    dripPoolCursor = (dripPoolCursor + 1) % maxNodes
    return node
  }

  private func makeRunNode() -> SCNNode {
    let node = SCNNode()
    node.castsShadow = false
    let order = Self.canRenderOrder - 1000
    for i in 0..<(Self.dripMaxTrail - 1) {
      let plane = SCNPlane(width: 0.004, height: 0.004)
      plane.firstMaterial = makeDripEmojiMaterial()
      let seg = SCNNode(geometry: plane)
      seg.name = "seg\(i)"
      seg.renderingOrder = order
      seg.isHidden = true
      node.addChildNode(seg)
    }
    // Head of the drip = one emoji blob (a plane, textured with the picked emoji).
    let headPlane = SCNPlane(width: 0.005, height: 0.005)
    let hmat = makeDripEmojiMaterial()
    hmat.diffuse.wrapS = .clamp                  // head shows ONE emoji, no tiling
    hmat.diffuse.wrapT = .clamp
    headPlane.firstMaterial = hmat
    let head = SCNNode(geometry: headPlane)
    head.name = "head"
    head.renderingOrder = order + 1
    head.isHidden = true
    node.addChildNode(head)
    return node
  }

  private static let dripEmojiWidthScale: Float = 2.1   // fatten the drip so tiled emojis read

  /// Material for an emoji-textured drip segment: unlit (colour-accurate), the
  /// emoji tiled down the run via a per-segment vertical contentsTransform.
  private func makeDripEmojiMaterial() -> SCNMaterial {
    let mat = SCNMaterial()
    mat.lightingModel = .constant
    mat.isDoubleSided = true
    mat.transparencyMode = .aOne
    mat.diffuse.wrapS = .repeat
    mat.diffuse.wrapT = .repeat
    mat.readsFromDepthBuffer = false
    mat.writesToDepthBuffer = false
    return mat
  }

  /// Floor pooling — grow an emoji-textured disc whose radius comes from the
  /// conserved volume: r = sqrt(V·k / (π·h)).
  private func growPuddle(at position: simd_float3, normal: simd_float3, excess: Float, emoji: String) {
    let key = cellKey(position)
    let localColors = washActive
      ? mergedFluidPalette(emojiPalette(for: emoji), washScenePalette, limit: 8)
      : emojiPalette(for: emoji)
    let puddle: DripPuddle
    if let existing = puddles[key] {
      puddle = existing
      puddle.vol += excess
      if washActive {
        puddle.colors = mergedFluidPalette(puddle.colors, localColors, limit: 10)
        puddle.node.geometry?.firstMaterial?.diffuse.contents = fluidPigmentTexture(colors: puddle.colors, head: true)
      }
    } else {
      let plane = SCNPlane(width: 0.01, height: 0.01)
      let mat = SCNMaterial()
      mat.lightingModel = washActive ? .constant : .lambert
      mat.diffuse.contents = washActive
        ? fluidPigmentTexture(colors: localColors, head: true)
        : emojiTexture(for: emoji)
      if !washActive { mat.multiply.contents = UIColor(white: 0.86, alpha: 1) }
      mat.isDoubleSided = true
      mat.transparencyMode = .aOne
      mat.readsFromDepthBuffer = false
      mat.writesToDepthBuffer = false
      plane.firstMaterial = mat
      let node = SCNNode(geometry: plane)
      node.name = "puddle"
      node.renderingOrder = Self.canRenderOrder - 1001
      node.simdOrientation = simd_quatf(from: simd_float3(0, 0, 1), to: normal) // plane faces up
      node.simdPosition = position + normal * (Self.stampSurfaceOffset + 0.001)
      dripRoot.addChildNode(node)
      puddle = DripPuddle(node: node, vol: excess, colors: localColors)
      puddles[key] = puddle
    }
    let h: Float = 0.001
    let r = max(0.012, sqrtf(puddle.vol * 0.0004 / (.pi * h)))
    if let plane = puddle.node.geometry as? SCNPlane {
      plane.width = CGFloat(2 * r)
      plane.height = CGFloat(2 * r)
    }
    puddle.node.isHidden = false
  }

  /// Dominant *filled* color of an emoji glyph. Averaging multi-color emojis
  /// gives mud, so we bucket opaque pixels by hue and pick the most prominent
  /// saturated bucket — the actual paint color a viewer reads (red ❤️, etc.).
  private func dominantColor(for emoji: String) -> UIColor {
    let colorKey = Self.brushCacheKey(emoji)
    if let cached = emojiDominantColors[colorKey] { return cached }
    let side = 40
    let size = CGSize(width: side, height: side)
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    format.scale = 1
    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      if drawCustomBrush(emoji, in: CGRect(origin: .zero, size: size)) { return }
      let font = UIFont.systemFont(ofSize: 32)
      let s = (emoji as NSString)
      let ts = s.size(withAttributes: [.font: font])
      s.draw(at: CGPoint(x: (size.width - ts.width) / 2, y: (size.height - ts.height) / 2),
             withAttributes: [.font: font])
    }
    var color = UIColor(red: 0.9, green: 0.2, blue: 0.2, alpha: 1)
    if let cg = image.cgImage,
       let data = cg.dataProvider?.data,
       let ptr = CFDataGetBytePtr(data) {
      let bpp = cg.bitsPerPixel / 8
      let rowBytes = cg.bytesPerRow
      let bins = 12
      var weight = [Double](repeating: 0, count: bins)
      var rSum = [Double](repeating: 0, count: bins)
      var gSum = [Double](repeating: 0, count: bins)
      var bSum = [Double](repeating: 0, count: bins)
      // Fallback accumulator over ALL opaque colored pixels (if nothing vivid)
      var rAll = 0.0, gAll = 0.0, bAll = 0.0, allCount = 0.0
      for y in 0..<cg.height {
        for x in 0..<cg.width {
          let i = y * rowBytes + x * bpp
          let a = Double(ptr[i + 3]) / 255.0
          guard a > 0.6 else { continue }
          let r = Double(ptr[i]) / 255, g = Double(ptr[i + 1]) / 255, b = Double(ptr[i + 2]) / 255
          let mx = max(r, g, b), mn = min(r, g, b)
          let delta = mx - mn
          let sat = mx <= 0 ? 0 : delta / mx
          // ignore near-white & near-black structural pixels for the fallback too
          if delta > 0.06 || (mx > 0.18 && mx < 0.92) {
            rAll += r; gAll += g; bAll += b; allCount += 1
          }
          guard sat > 0.18, delta > 0.04 else { continue } // only vivid pixels vote
          var hue = 0.0
          if mx == r { hue = (g - b) / delta }
          else if mx == g { hue = 2 + (b - r) / delta }
          else { hue = 4 + (r - g) / delta }
          hue = (hue / 6).truncatingRemainder(dividingBy: 1)
          if hue < 0 { hue += 1 }
          let bin = min(bins - 1, Int(hue * Double(bins)))
          let w = sat * mx // prefer saturated AND bright
          weight[bin] += w
          rSum[bin] += r * w; gSum[bin] += g * w; bSum[bin] += b * w
        }
      }
      if let best = weight.indices.max(by: { weight[$0] < weight[$1] }), weight[best] > 0 {
        let w = weight[best]
        color = UIColor(red: CGFloat(rSum[best] / w), green: CGFloat(gSum[best] / w),
                        blue: CGFloat(bSum[best] / w), alpha: 1)
      } else if allCount > 0 {
        color = UIColor(red: CGFloat(rAll / allCount), green: CGFloat(gAll / allCount),
                        blue: CGFloat(bAll / allCount), alpha: 1)
      }
    }
    emojiDominantColors[colorKey] = color
    return color
  }

  private var emojiPalettes: [String: [UIColor]] = [:]
  /// Up to 4 distinct, prominent colours of an emoji (by saturated-hue weight) —
  /// used to paint a gradient down a drip with all the emoji's colours.
  private func emojiPalette(for emoji: String) -> [UIColor] {
    let paletteKey = Self.brushCacheKey(emoji)
    if let cached = emojiPalettes[paletteKey] { return cached }
    var result: [UIColor] = []
    let side = 40
    let size = CGSize(width: side, height: side)
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false; format.scale = 1
    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      if drawCustomBrush(emoji, in: CGRect(origin: .zero, size: size)) { return }
      let font = UIFont.systemFont(ofSize: 32)
      let s = emoji as NSString
      let ts = s.size(withAttributes: [.font: font])
      s.draw(at: CGPoint(x: (size.width - ts.width) / 2, y: (size.height - ts.height) / 2),
             withAttributes: [.font: font])
    }
    if let cg = image.cgImage, let data = cg.dataProvider?.data, let ptr = CFDataGetBytePtr(data) {
      let bpp = cg.bitsPerPixel / 8, rowBytes = cg.bytesPerRow, bins = 18
      var w = [Double](repeating: 0, count: bins)
      var rS = [Double](repeating: 0, count: bins), gS = [Double](repeating: 0, count: bins), bS = [Double](repeating: 0, count: bins)
      for y in 0..<cg.height { for x in 0..<cg.width {
        let i = y * rowBytes + x * bpp
        if Double(ptr[i + 3]) / 255 <= 0.6 { continue }
        let r = Double(ptr[i]) / 255, g = Double(ptr[i + 1]) / 255, b = Double(ptr[i + 2]) / 255
        let mx = max(r, g, b), mn = min(r, g, b), delta = mx - mn
        let sat = mx <= 0 ? 0 : delta / mx
        guard sat > 0.15, delta > 0.03 else { continue }
        var hue = 0.0
        if mx == r { hue = (g - b) / delta } else if mx == g { hue = 2 + (b - r) / delta } else { hue = 4 + (r - g) / delta }
        hue = (hue / 6).truncatingRemainder(dividingBy: 1); if hue < 0 { hue += 1 }
        let bin = min(bins - 1, Int(hue * Double(bins))), weight = sat * mx
        w[bin] += weight; rS[bin] += r * weight; gS[bin] += g * weight; bS[bin] += b * weight
      }}
      let order = w.indices.sorted { w[$0] > w[$1] }
      for bin in order where w[bin] > 0.5 {
        result.append(UIColor(red: CGFloat(rS[bin] / w[bin]), green: CGFloat(gS[bin] / w[bin]), blue: CGFloat(bS[bin] / w[bin]), alpha: 1))
        if result.count >= 4 { break }
      }
    }
    if result.isEmpty { result = [dominantColor(for: emoji)] }
    emojiPalettes[paletteKey] = result
    return result
  }

  /// Brief 3D preview of the current brush size at the last paint point (or the
  /// surface under screen-center), fading out after a moment.
  func previewBrushSize() {
    let target: SCNVector3
    if let last = lastStampPosition {
      target = last
    } else if let pt = sprayTargetPoint {
      target = SCNVector3(pt.x, pt.y, pt.z)
    } else {
      return
    }
    let orientation = strokeOrientation ?? stampOrientation(normal: spraySurfaceNormal)
    sizePreviewNode.geometry = sharedGeometry(for: brushEmoji, size: brushSizeMeters)
    sizePreviewNode.simdOrientation = orientation
    sizePreviewNode.position = target
    sizePreviewNode.isHidden = false
    sizePreviewNode.opacity = 0.9
    sizePreviewNode.removeAllActions()
    sizePreviewNode.runAction(SCNAction.sequence([
      SCNAction.wait(duration: 0.7),
      SCNAction.fadeOut(duration: 0.4),
      SCNAction.run { node in node.isHidden = true },
    ]))
  }

  private func addStamp(
    at position: SCNVector3,
    orientation: simd_quatf,
    to group: SCNNode?,
    record: StrokeRecord?
  ) {
    guard let group = group, let record = record else { return }
    guard totalStampCount < Self.maxStampsPerSession else { return }
    totalStampCount += 1

    let stamp = StampData(
      position: position,
      orientation: orientation,
      emoji: brushEmoji,
      size: brushSizeMeters,
      flipX: stampMirrorX,
      flipY: stampMirrorY
    )
    appendStampNodes(stamp: stamp, to: group)
    record.stamps.append(stamp)

    let now = CACurrentMediaTime()
    if now - lastHapticTime > 0.07 {
      lastHapticTime = now
      sprayHaptics.impactOccurred(intensity: 0.5)
    }
  }

  // MARK: - Wash camera mixing

  /// Choose the next painted stamp that is actually in the current camera view.
  /// Off-screen strokes never receive camera pixels, so moving/looking around
  /// changes where the real room is allowed to soak into the artwork.
  private func addVisibleWashCameraDab() {
    guard washActive, !meltSeeds.isEmpty,
          let frame = arView.session.currentFrame else { return }
    let viewport = bounds.size
    guard viewport.width > 1, viewport.height > 1 else { return }
    let cameraPosition = simd_float3(
      frame.camera.transform.columns.3.x,
      frame.camera.transform.columns.3.y,
      frame.camera.transform.columns.3.z
    )
    let cameraForward = -simd_float3(
      frame.camera.transform.columns.2.x,
      frame.camera.transform.columns.2.y,
      frame.camera.transform.columns.2.z
    )
    for step in 0..<meltSeeds.count {
      let index = (washCameraSeedCursor + step) % meltSeeds.count
      let (position, normal, emoji, stampSize) = meltSeeds[index]
      guard simd_dot(position - cameraPosition, cameraForward) > 0.04 else { continue }
      let screen = frame.camera.projectPoint(
        position,
        orientation: currentInterfaceOrientation,
        viewportSize: viewport
      )
      let margin: CGFloat = 18
      guard screen.x.isFinite, screen.y.isFinite,
            screen.x >= margin, screen.x <= viewport.width - margin,
            screen.y >= margin, screen.y <= viewport.height - margin else { continue }
      washCameraSeedCursor = (index + 1) % meltSeeds.count
      let colors = mergedFluidPalette(emojiPalette(for: emoji), washScenePalette, limit: 8)
      addWashCameraSmudge(
        from: frame,
        at: position,
        normal: normal,
        size: max(0.045, min(0.22, stampSize * 1.18)),
        colors: colors,
        push: .zero,
        handDriven: false
      )
      return
    }
  }

  /// Perspective-correct one live camera patch onto the real painted surface,
  /// then tint it with (not replace it by) the pigments of nearby emojis.
  private func addWashCameraSmudge(
    from frame: ARFrame,
    at position: simd_float3,
    normal rawNormal: simd_float3,
    size rawSize: CGFloat,
    colors: [UIColor],
    push: simd_float3,
    handDriven: Bool
  ) {
    let viewport = bounds.size
    guard viewport.width > 1, viewport.height > 1 else { return }
    let normal = simd_length(rawNormal) > 0.001
      ? simd_normalize(rawNormal)
      : simd_float3(0, 0, 1)
    let size = max(0.04, min(0.24, rawSize * (handDriven ? 1.20 : 1.0)))
    let screen = frame.camera.projectPoint(
      position,
      orientation: currentInterfaceOrientation,
      viewportSize: viewport
    )
    let margin: CGFloat = 12
    guard screen.x.isFinite, screen.y.isFinite,
          screen.x >= margin, screen.x <= viewport.width - margin,
          screen.y >= margin, screen.y <= viewport.height - margin else { return }
    let orientation = stampOrientation(normal: normal)
    let lifted = position + normal * (Self.stampSurfaceOffset + 0.0012)
    let center = SCNVector3(lifted.x, lifted.y, lifted.z)
    guard let cameraPatch = perspectiveCameraPatch(
      from: frame,
      at: screen,
      planeCenter: center,
      planeOrientation: orientation,
      worldSize: size,
      outputSide: handDriven ? 104 : 82
    ) else { return }
    let palette = mergedFluidPalette(colors, washScenePalette, limit: 9)
    let texture = washCameraPigmentTexture(
      cameraPatch,
      colors: palette,
      cameraAmount: handDriven ? 0.62 : 0.48
    )
    let plane = SCNPlane(width: size * (handDriven ? 1.38 : 1.12),
                         height: size * (handDriven ? 0.82 : 1.02))
    let material = SCNMaterial()
    material.diffuse.contents = texture
    material.isDoubleSided = true
    material.lightingModel = .constant
    material.writesToDepthBuffer = false
    material.readsFromDepthBuffer = false
    material.blendMode = .alpha
    material.transparencyMode = .aOne
    plane.firstMaterial = material
    let node = SCNNode(geometry: plane)
    node.name = handDriven ? "washHandCameraSmudge" : "washCameraSmudge"
    node.simdOrientation = orientation
    node.simdPosition = lifted
    node.renderingOrder = Self.canRenderOrder - 1002
    node.castsShadow = false
    node.opacity = 0
    node.simdScale = simd_float3(repeating: handDriven ? 0.58 : 0.76)
    dripRoot.addChildNode(node)
    washCameraNodes.append(node)

    let reveal = SCNAction.group([
      .fadeOpacity(to: handDriven ? 0.94 : 0.78, duration: handDriven ? 0.08 : 0.16),
      .scale(to: 1, duration: handDriven ? 0.34 : 0.46),
    ])
    if handDriven, simd_length(push) > 0.001 {
      // A hand carries the sampled room pixels along the surface, making the
      // interaction read as a smear rather than a static camera sticker.
      let dir = simd_normalize(push)
      let travel = dir * Float(min(0.055, size * 0.42))
      node.runAction(.group([
        reveal,
        .move(by: SCNVector3(travel.x, travel.y, travel.z), duration: 0.52),
      ]))
    } else {
      node.runAction(reveal)
    }

    // Bound camera textures independently of the run/puddle pool. The newest
    // visible samples matter most while Wash is live; stopping Wash bakes them.
    let limit = 72
    if washCameraNodes.count > limit {
      let overflow = washCameraNodes.count - limit
      let old = washCameraNodes.prefix(overflow)
      old.forEach { $0.removeFromParentNode() }
      washCameraNodes.removeFirst(overflow)
    }
  }

  /// Clip the camera to an irregular liquid footprint, retain recognizable room
  /// detail, then colourise it with saturated pigments from all washed emojis.
  private func washCameraPigmentTexture(
    _ cameraPatch: UIImage,
    colors: [UIColor],
    cameraAmount: CGFloat
  ) -> UIImage {
    let side: CGFloat = 104
    let size = CGSize(width: side, height: side)
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    format.scale = 1
    return UIGraphicsImageRenderer(size: size, format: format).image { renderer in
      let c = renderer.cgContext
      let path = UIBezierPath()
      path.move(to: CGPoint(x: side * 0.06, y: side * 0.47))
      path.addCurve(to: CGPoint(x: side * 0.25, y: side * 0.08),
                    controlPoint1: CGPoint(x: side * 0.08, y: side * 0.24),
                    controlPoint2: CGPoint(x: side * 0.13, y: side * 0.07))
      path.addCurve(to: CGPoint(x: side * 0.72, y: side * 0.10),
                    controlPoint1: CGPoint(x: side * 0.41, y: side * 0.01),
                    controlPoint2: CGPoint(x: side * 0.60, y: side * 0.16))
      path.addCurve(to: CGPoint(x: side * 0.96, y: side * 0.50),
                    controlPoint1: CGPoint(x: side * 0.91, y: side * 0.04),
                    controlPoint2: CGPoint(x: side * 0.98, y: side * 0.27))
      path.addCurve(to: CGPoint(x: side * 0.73, y: side * 0.91),
                    controlPoint1: CGPoint(x: side * 0.95, y: side * 0.74),
                    controlPoint2: CGPoint(x: side * 0.87, y: side * 0.96))
      path.addCurve(to: CGPoint(x: side * 0.23, y: side * 0.88),
                    controlPoint1: CGPoint(x: side * 0.57, y: side * 0.99),
                    controlPoint2: CGPoint(x: side * 0.39, y: side * 0.82))
      path.addCurve(to: CGPoint(x: side * 0.06, y: side * 0.47),
                    controlPoint1: CGPoint(x: side * 0.10, y: side * 0.94),
                    controlPoint2: CGPoint(x: side * 0.01, y: side * 0.70))
      path.close()
      c.saveGState()
      path.addClip()
      let bounds = CGRect(origin: .zero, size: size)
      cameraPatch.draw(in: bounds, blendMode: .normal, alpha: max(0.35, min(0.72, cameraAmount)))
      let pigment = colors.isEmpty ? [UIColor.systemPink] : colors
      if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                   colors: pigment.map(\.cgColor) as CFArray,
                                   locations: nil) {
        c.setBlendMode(.color)
        c.setAlpha(0.92)
        c.drawLinearGradient(
          gradient,
          start: CGPoint(x: side * 0.06, y: side * 0.15),
          end: CGPoint(x: side * 0.94, y: side * 0.86),
          options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
        )
        c.setBlendMode(.normal)
        c.setAlpha(0.22)
        c.drawLinearGradient(
          gradient,
          start: CGPoint(x: side, y: side * 0.28),
          end: CGPoint(x: 0, y: side * 0.72),
          options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
        )
      }
      c.restoreGState()
    }
  }

  // MARK: - Smudge tool (smear the real world / camera onto the wall)

  private func resetSmudgeGestureState() {
    smudgeLockedTexture = nil
    lastSmudgePoint = nil
    smudgeFrozenCameraImage = nil
    // Capture one stable camera+strokes composite per gesture. Repeated full
    // ARSCNView snapshots during a drag can exhaust memory on iPad.
    compositedSmudgeSnapshot = nil
  }

  /// Perspective-map the current camera frame onto the detected plane at
  /// `point`. Camera pixels and world projection always come from the SAME
  /// ARFrame, so turning the device cannot make later dabs rotate or scale away.
  private func smudgeStamp(at point: CGPoint) {
    ensureLiveAnimationSegment()
    // Where the pixels WERE (previous touch). Sampling there and drawing here is
    // what makes reality look pushed/dragged — a real smudge "moves the pixels".
    let previousPoint = lastSmudgePoint ?? point
    // Reach keeps the original 0.15…1 profile, while the newly exposed 0…0.15
    // tail makes MIN deliberately drier and the 0.85…1 tail exaggerates MAX.
    // At the established 0.7 default every term below is exactly the legacy one.
    let clampedStrength = max(0, min(smudgeStrength, AR_SMUDGE_MAX_REACH))
    let legacyStrength = min(clampedStrength, 1)
    let sN = CGFloat(max(0, min(1, (legacyStrength - 0.15) / 0.85)))
    let lowReachExtra = max(0, min(1, (0.15 - legacyStrength) / 0.15))
    let highReachExtra = max(0, min(1, (legacyStrength - 0.85) / 0.15))
    // The original 1.0…1.35 band is unchanged (saturates at 1). Above 1.35 a
    // modest "far reach" term extends the pull up to the high (not infinite) cap.
    let extendedReach = max(0, min(1, (min(clampedStrength, 1.35) - 1) / 0.35))
    let farReach = max(0, min(1, (clampedStrength - 1.35) / (AR_SMUDGE_MAX_REACH - 1.35)))
    let clampedFlow = max(0, min(smudgeFlow, 1))
    let stampAmount = max(0, (0.5 - clampedFlow) / 0.5)
    let cloudAmount = max(0, (clampedFlow - 0.5) / 0.5)
    if let last = lastSmudgePoint {
      let dx = point.x - last.x, dy = point.y - last.y
      // Flow MIN separates the repeated decals enough to read as stamps. Flow
      // MAX accepts nearly every coalesced point for a compact, creamy trail.
      let reachDistance = 44 - sN * 20 + lowReachExtra * 20 - highReachExtra * 8 - extendedReach * 10 - farReach * 6
      let minDistSq = (reachDistance + stampAmount * 100) * (1 - cloudAmount * 0.86)
      if dx * dx + dy * dy < minDistSq { return }
    }
    let drag = CGPoint(x: point.x - previousPoint.x, y: point.y - previousPoint.y)
    // MIN → pull≈1.0: a clean 1:1 carry (texture stays clear under the finger).
    // MAX → pull≈3.0: pixels get dragged/pushed far → a fluid, slow-mixing smear.
    let pull = 1.0 + sN * 2.0 - lowReachExtra * 0.65 + highReachExtra * 1.5 + extendedReach * 2.5 + farReach * 2.0
    let legacySamplePoint = CGPoint(
      x: point.x - drag.x * pull,
      y: point.y - drag.y * pull
    )
    let samplePoint: CGPoint
    if clampedFlow > 0.5 {
      // Cloud endpoint: rapidly repick very near the finger. Combined with the
      // dense dab gate and soft compact mask below, this mixes locally instead
      // of dragging a recognizable decal for a long distance.
      let localPull = pull * (1 - cloudAmount * 0.85)
      samplePoint = CGPoint(x: point.x - drag.x * localPull, y: point.y - drag.y * localPull)
    } else {
      samplePoint = legacySamplePoint
    }
    guard let result = raycast(at: point) else {
      lastSmudgePoint = point
      notifySurfaceUnavailable()
      NSLog("[ARSmudge] no detected plane under \(point)")
      return
    }
    guard let frame = arView.session.currentFrame else {
      lastSmudgePoint = point
      NSLog("[ARSmudge] no camera frame — dab skipped")
      return
    }
    updateSprayTarget(from: result)
    let side = max(44, min(112, CGFloat(brushSizeMeters / 0.092) * 88))
    let sz = brushSizeMeters * 1.35
    let n = surfaceNormal(of: result)
    let orientation = stampOrientation(normal: n)
    let hitTransform = result.worldTransform
    let base = SCNVector3(
      hitTransform.columns.3.x,
      hitTransform.columns.3.y,
      hitTransform.columns.3.z
    )
    // Smudge materials ignore scene depth, so they need only a hairline lift.
    // Keeping the decal on the measured surface avoids a distance-dependent
    // scale error between the real camera detail and the rendered texture.
    let lift: Float = 0.002
    let finalPosition = SCNVector3(base.x + n.x * lift, base.y + n.y * lift, base.z + n.z * lift)
    var effectiveFocus = max(0, min(smudgeFocus, 1))
    effectiveFocus *= 1 - stampAmount
    effectiveFocus += (1 - effectiveFocus) * cloudAmount
    // ARDraw's proven ordering is important here: freeze the screen-aligned
    // camera frame once, then crop it in view coordinates.  The old code asked
    // for a SceneKit snapshot first; on devices where ARSCNView did not include
    // its camera background that produced a strokes-only/black smudge.  Camera
    // pixels are now the authoritative source, while the composited render and
    // perspective path remain safe fallbacks for older/unsupported frames.
    if smudgeFrozenCameraImage == nil {
      smudgeFrozenCameraImage = screenAlignedCameraImage(from: frame)
    }
    let screenCameraPatch = smudgeFrozenCameraImage.flatMap {
      screenAlignedCameraPatch(from: $0, at: samplePoint, outputSide: side)
    }
    let compositePatch: UIImage? = screenCameraPatch == nil
      ? currentCompositedSmudgeSnapshot().flatMap {
          perspectiveCompositePatch(
            from: $0,
            frame: frame,
            at: samplePoint,
            planeCenter: finalPosition,
            planeOrientation: orientation,
            worldSize: sz,
            outputSide: side
          )
        }
      : nil
    guard let cameraPatch = screenCameraPatch ?? compositePatch ?? perspectiveCameraPatch(
      from: frame,
      at: samplePoint,
      planeCenter: finalPosition,
      planeOrientation: orientation,
      worldSize: sz,
      outputSide: side
    ), let movingTexture = softSmudgeCameraCrop(
      cameraPatch,
      side: side,
      strength: clampedStrength,
      focus: effectiveFocus
    ) else {
      lastSmudgePoint = point
      return
    }
    // Flow MIN is a true clone-stamp: cache the first corrected decal and repeat
    // it unchanged. Between MIN and neutral, crossfade toward the live mapped dab.
    if smudgeLockedTexture == nil { smudgeLockedTexture = movingTexture }
    let tex: UIImage
    if clampedFlow < 0.5, let locked = smudgeLockedTexture {
      tex = blendSmudgeTextures(locked: locked, moving: movingTexture, movingAmount: clampedFlow / 0.5)
    } else {
      tex = movingTexture
    }
    let plane = SCNPlane(width: sz, height: sz)
    let mat = SCNMaterial()
    mat.diffuse.contents = tex
    mat.isDoubleSided = true
    mat.lightingModel = .constant
    mat.writesToDepthBuffer = false
    mat.readsFromDepthBuffer = false
    mat.blendMode = .alpha
    mat.transparencyMode = .aOne
    plane.firstMaterial = mat
    let node = SCNNode(geometry: plane)
    node.simdOrientation = orientation
    // … and LAY it where the finger is now → pixels move. Keep the smudge just
    // above the content that this gesture is acting on, but leave the next
    // stroke a free rendering-order slot above it. A fixed, huge order made
    // every later normal stroke render underneath all smudges forever.
    node.position = finalPosition
    node.castsShadow = false
    let currentStrokeOrder = liveStrokeRecord?.renderingOrder ?? strokeOrderCounter
    node.renderingOrder = currentStrokeOrder + 1
    (liveStrokeGroup ?? arView.scene.rootNode).addChildNode(node)
    liveStrokeRecord?.extraContentCount += 1
    totalStampCount += 1
    smudgeNodes.append(node)
    lastSmudgePoint = point
    smudgeStampCount += 1
    // Funny random blip while smudging (alpha=true when the brush is transparent).
    playSmudgeBlip(alpha: brushOpacity < 0.5)
    if smudgeStampCount % 8 == 1 { NSLog("[ARSmudge] dab #\(smudgeStampCount) strength=\(smudgeStrength) from \(samplePoint) to \(point)") }
  }

  /// Crop a screen-aligned camera image in the same coordinate system as the
  /// user's finger.  ARDraw uses this 1:1 screen mapping instead of asking
  /// Core Image to infer a second perspective warp for every dab.  Clamping the
  /// source rect keeps edge dabs valid without changing the texture's aspect.
  private func screenAlignedCameraPatch(from image: CGImage,
                                        at point: CGPoint,
                                        outputSide: CGFloat) -> UIImage? {
    let viewport = bounds.size
    guard viewport.width > 1, viewport.height > 1,
          image.width > 1, image.height > 1, outputSide > 1 else { return nil }
    let sx = CGFloat(image.width) / viewport.width
    let sy = CGFloat(image.height) / viewport.height
    let requested = CGRect(
      x: (point.x - outputSide * 0.5) * sx,
      y: (point.y - outputSide * 0.5) * sy,
      width: outputSide * sx,
      height: outputSide * sy
    )
    let imageBounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    let cropRect = requested.intersection(imageBounds)
    guard cropRect.width > 1, cropRect.height > 1,
          let cropped = image.cropping(to: cropRect.integral) else { return nil }
    if cropped.width == Int(round(outputSide)) && cropped.height == Int(round(outputSide)) {
      return UIImage(cgImage: cropped, scale: 1, orientation: .up)
    }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: CGSize(width: outputSide, height: outputSide),
                                    format: format).image { _ in
      UIImage(cgImage: cropped, scale: 1, orientation: .up)
        .draw(in: CGRect(x: 0, y: 0, width: outputSide, height: outputSide))
    }
  }

  /// Same screen registration as ARDraw: CI's camera image is transformed into
  /// the current UIKit viewport, with both required Y flips and the current
  /// interface orientation.  The returned image is in view-point coordinates.
  private func screenAlignedCameraImage(from frame: ARFrame?,
                                        pixelScale: CGFloat = 1) -> CGImage? {
    guard let frame else { return nil }
    let viewport = bounds.size
    guard viewport.width > 1, viewport.height > 1 else { return nil }
    let orientation = currentInterfaceOrientation
    let ci = CIImage(cvPixelBuffer: frame.capturedImage)
    let width = ci.extent.width
    let height = ci.extent.height
    guard width > 1, height > 1 else { return nil }
    let toNorm = CGAffineTransform(scaleX: 1 / width, y: 1 / height)
    let flip = CGAffineTransform(scaleX: 1, y: -1).translatedBy(x: 0, y: -1)
    let display = frame.displayTransform(for: orientation, viewportSize: viewport)
    let toViewport = CGAffineTransform(scaleX: viewport.width, y: viewport.height)
    let full = toNorm
      .concatenating(flip)
      .concatenating(display)
      .concatenating(flip)
      .concatenating(toViewport)
    var mapped = ci.transformed(by: full)
      .cropped(to: CGRect(origin: .zero, size: viewport))
    if pixelScale > 1.01 {
      mapped = mapped.transformed(by: CGAffineTransform(scaleX: pixelScale, y: pixelScale))
    }
    let output = CGRect(origin: .zero,
                        size: CGSize(width: viewport.width * pixelScale,
                                     height: viewport.height * pixelScale))
    return Self.ciContext.createCGImage(mapped, from: output)
  }

  private var currentInterfaceOrientation: UIInterfaceOrientation {
    window?.windowScene?.interfaceOrientation ?? .portrait
  }

  /// Rectify the camera pixels covered by this exact world-space plane quad.
  /// ARCamera projection supplies rotation/perspective; ARFrame displayTransform
  /// supplies the sensor's orientation and aspect-fill crop. Both belong to
  /// `frame`, eliminating the old frozen-frame/current-camera mismatch.
  private func perspectiveCameraPatch(
    from frame: ARFrame,
    at samplePoint: CGPoint,
    planeCenter: SCNVector3,
    planeOrientation: simd_quatf,
    worldSize: CGFloat,
    outputSide: CGFloat
  ) -> UIImage? {
    let viewport = bounds.size
    guard viewport.width > 1, viewport.height > 1, outputSide > 1 else { return nil }
    let interfaceOrientation = currentInterfaceOrientation
    let center = SIMD3<Float>(planeCenter.x, planeCenter.y, planeCenter.z)
    let half = Float(worldSize) * 0.5
    let xAxis = simd_act(planeOrientation, SIMD3<Float>(half, 0, 0))
    let yAxis = simd_act(planeOrientation, SIMD3<Float>(0, half, 0))

    func project(_ world: SIMD3<Float>) -> CGPoint {
      frame.camera.projectPoint(
        world,
        orientation: interfaceOrientation,
        viewportSize: viewport
      )
    }

    let projectedCenter = project(center)
    guard projectedCenter.x.isFinite, projectedCenter.y.isFinite else { return nil }
    let shift = CGPoint(x: samplePoint.x - projectedCenter.x, y: samplePoint.y - projectedCenter.y)
    func shifted(_ world: SIMD3<Float>) -> CGPoint {
      let p = project(world)
      return CGPoint(x: p.x + shift.x, y: p.y + shift.y)
    }

    let viewTopLeft = shifted(center - xAxis + yAxis)
    let viewTopRight = shifted(center + xAxis + yAxis)
    let viewBottomRight = shifted(center + xAxis - yAxis)
    let viewBottomLeft = shifted(center - xAxis - yAxis)
    let viewPoints = [viewTopLeft, viewTopRight, viewBottomRight, viewBottomLeft]
    guard viewPoints.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return nil }

    let rawCameraImage = CIImage(cvPixelBuffer: frame.capturedImage)
    let extent = rawCameraImage.extent
    // JITTER FIX: the sensor-space quad corners used to be clamped independently
    // to [0,1] of the extent. Any time even ONE corner of the plane's projected
    // quad drifted a fraction of a percent past the sensor image edge (extremely
    // common — a wall patch that fills much of the screen, or a normal grazing
    // viewing angle), that corner got yanked back onto the boundary while the
    // other three did not. That turns a true perspective trapezoid into a
    // DIFFERENT, non-similar quad every time a corner crosses the [0,1] line —
    // which happens continuously from ordinary handheld micro-motion — so
    // CIPerspectiveCorrection was recomputing a visibly different warp from one
    // sample to the next. That is the reported "used to be stable, now jitters"
    // regression in look, even though the projection math itself is unchanged.
    // Fix: extend the camera image with clamped (edge-replicated) pixels so a
    // corner slightly past the sensor edge still samples valid data, and widen
    // the allowed range generously instead of hard-clamping at the true edge —
    // this keeps the quad's real proportions (no snapping) for all but the most
    // extreme grazing angles, which are still bounded so a corner can never
    // demand an absurd, wildly-extrapolated sample.
    let cameraImage = rawCameraImage.clampedToExtent()
    let viewToImage = frame.displayTransform(
      for: interfaceOrientation,
      viewportSize: viewport
    ).inverted()

    func sensorPoint(_ viewPoint: CGPoint) -> CGPoint {
      let viewNormalized = CGPoint(
        x: viewPoint.x / viewport.width,
        y: viewPoint.y / viewport.height
      )
      let imageNormalized = viewNormalized.applying(viewToImage)
      // displayTransform uses UIKit's top-left convention; Core Image uses a
      // bottom-left origin, hence the Y flip here.
      let x = max(-0.5, min(1.5, imageNormalized.x))
      let y = max(-0.5, min(1.5, imageNormalized.y))
      return CGPoint(
        x: extent.minX + x * extent.width,
        y: extent.minY + (1 - y) * extent.height
      )
    }

    let topLeft = sensorPoint(viewTopLeft)
    let topRight = sensorPoint(viewTopRight)
    let bottomRight = sensorPoint(viewBottomRight)
    let bottomLeft = sensorPoint(viewBottomLeft)
    guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
    filter.setValue(cameraImage, forKey: kCIInputImageKey)
    filter.setValue(CIVector(x: topLeft.x, y: topLeft.y), forKey: "inputTopLeft")
    filter.setValue(CIVector(x: topRight.x, y: topRight.y), forKey: "inputTopRight")
    filter.setValue(CIVector(x: bottomRight.x, y: bottomRight.y), forKey: "inputBottomRight")
    filter.setValue(CIVector(x: bottomLeft.x, y: bottomLeft.y), forKey: "inputBottomLeft")
    guard let corrected = filter.outputImage else { return nil }
    let correctedExtent = corrected.extent.integral
    guard correctedExtent.width > 1, correctedExtent.height > 1,
          correctedExtent.width.isFinite, correctedExtent.height.isFinite else { return nil }

    let translated = corrected.transformed(by: CGAffineTransform(
      translationX: -correctedExtent.minX,
      y: -correctedExtent.minY
    ))
    let scaled = translated.transformed(by: CGAffineTransform(
      scaleX: outputSide / correctedExtent.width,
      y: outputSide / correctedExtent.height
    ))
    let outputRect = CGRect(x: 0, y: 0, width: outputSide, height: outputSide)
    guard let cg = Self.ciContext.createCGImage(scaled, from: outputRect) else { return nil }
    return UIImage(cgImage: cg, scale: 1, orientation: .up)
  }

  /// Throttled `arView.snapshot()` — a real synchronous render of the ARSCNView's
  /// ACTUAL composited output (live camera background + every rendered SceneKit
  /// stroke on top of it). Smudge dabs can fire much faster than a snapshot can be
  /// taken during a fast drag, so the capture is reused for the gesture. This
  /// correctly reflects everything painted before the current gesture, which is
  /// the case the product actually cares about (smudging over existing art).
  private func currentCompositedSmudgeSnapshot() -> UIImage? {
    // The composite contains the live camera plus all strokes already rendered
    // beneath this gesture. Reuse it for the entire drag instead of rendering
    // the full ARSCNView every 150 ms.
    if let cached = compositedSmudgeSnapshot { return cached }
    guard window != nil, bounds.width > 1, bounds.height > 1 else { return nil }
    let shot = arView.snapshot()
    guard let cg = shot.cgImage, cg.width > 1, cg.height > 1,
          cg.width <= 8192, cg.height <= 8192 else { return nil }
    compositedSmudgeSnapshot = shot
    return shot
  }

  /// Same perspective-correct quad math as `perspectiveCameraPatch`, but samples
  /// an already-composited ARSCNView snapshot (camera + painted strokes) instead
  /// of the raw sensor image. A snapshot is already rendered in VIEW pixels, so
  /// no sensor/display-transform step is needed — the projected view-space
  /// corners map directly onto the snapshot's pixel bounds (scaled by the
  /// snapshot's own pixel scale, which can differ from the view's point size).
  private func perspectiveCompositePatch(
    from snapshot: UIImage,
    frame: ARFrame,
    at samplePoint: CGPoint,
    planeCenter: SCNVector3,
    planeOrientation: simd_quatf,
    worldSize: CGFloat,
    outputSide: CGFloat
  ) -> UIImage? {
    guard let cgSnapshot = snapshot.cgImage else { return nil }
    let viewport = bounds.size
    guard viewport.width > 1, viewport.height > 1, outputSide > 1 else { return nil }
    let interfaceOrientation = currentInterfaceOrientation
    let center = SIMD3<Float>(planeCenter.x, planeCenter.y, planeCenter.z)
    let half = Float(worldSize) * 0.5
    let xAxis = simd_act(planeOrientation, SIMD3<Float>(half, 0, 0))
    let yAxis = simd_act(planeOrientation, SIMD3<Float>(0, half, 0))

    func project(_ world: SIMD3<Float>) -> CGPoint {
      frame.camera.projectPoint(
        world,
        orientation: interfaceOrientation,
        viewportSize: viewport
      )
    }

    let projectedCenter = project(center)
    guard projectedCenter.x.isFinite, projectedCenter.y.isFinite else { return nil }
    let shift = CGPoint(x: samplePoint.x - projectedCenter.x, y: samplePoint.y - projectedCenter.y)
    func shifted(_ world: SIMD3<Float>) -> CGPoint {
      let p = project(world)
      return CGPoint(x: p.x + shift.x, y: p.y + shift.y)
    }

    let viewTopLeft = shifted(center - xAxis + yAxis)
    let viewTopRight = shifted(center + xAxis + yAxis)
    let viewBottomRight = shifted(center + xAxis - yAxis)
    let viewBottomLeft = shifted(center - xAxis - yAxis)
    let viewPoints = [viewTopLeft, viewTopRight, viewBottomRight, viewBottomLeft]
    guard viewPoints.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return nil }

    // clampedToExtent(): a corner landing a hair outside the snapshot's pixel
    // bounds (rounding, or the plane peeking past the screen edge) should sample
    // the nearest edge pixel, not distort the quad or fail outright — the same
    // reasoning as the sensor-image path below.
    guard cgSnapshot.width > 1, cgSnapshot.height > 1 else { return nil }
    let snapshotImage = CIImage(cgImage: cgSnapshot).clampedToExtent()
    let pixelScale = CGFloat(cgSnapshot.width) / viewport.width
    guard pixelScale.isFinite, pixelScale > 0, pixelScale < 32 else { return nil }
    let snapshotExtent = CGRect(
      x: 0,
      y: 0,
      width: CGFloat(max(1, cgSnapshot.width - 1)),
      height: CGFloat(max(1, cgSnapshot.height - 1))
    )
    // Snapshot pixels are top-left origin like the view; Core Image is
    // bottom-left, hence the Y flip.
    func snapshotPoint(_ viewPoint: CGPoint) -> CGPoint {
      let x = viewPoint.x * pixelScale
      let y = CGFloat(cgSnapshot.height) - viewPoint.y * pixelScale
      // Keep Core Image inside the replicated edge pixels. A grazing plane can
      // project corners far outside the viewport; passing those values through
      // makes CIPerspectiveCorrection allocate an unbounded intermediate image.
      return CGPoint(
        x: min(max(x, snapshotExtent.minX), snapshotExtent.maxX),
        y: min(max(y, snapshotExtent.minY), snapshotExtent.maxY)
      )
    }

    let topLeft = snapshotPoint(viewTopLeft)
    let topRight = snapshotPoint(viewTopRight)
    let bottomRight = snapshotPoint(viewBottomRight)
    let bottomLeft = snapshotPoint(viewBottomLeft)
    guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
    filter.setValue(snapshotImage, forKey: kCIInputImageKey)
    filter.setValue(CIVector(x: topLeft.x, y: topLeft.y), forKey: "inputTopLeft")
    filter.setValue(CIVector(x: topRight.x, y: topRight.y), forKey: "inputTopRight")
    filter.setValue(CIVector(x: bottomRight.x, y: bottomRight.y), forKey: "inputBottomRight")
    filter.setValue(CIVector(x: bottomLeft.x, y: bottomLeft.y), forKey: "inputBottomLeft")
    guard let corrected = filter.outputImage else { return nil }
    let correctedExtent = corrected.extent.integral
    guard correctedExtent.width > 1, correctedExtent.height > 1,
          correctedExtent.width.isFinite, correctedExtent.height.isFinite else { return nil }

    let translated = corrected.transformed(by: CGAffineTransform(
      translationX: -correctedExtent.minX,
      y: -correctedExtent.minY
    ))
    let scaled = translated.transformed(by: CGAffineTransform(
      scaleX: outputSide / correctedExtent.width,
      y: outputSide / correctedExtent.height
    ))
    let outputRect = CGRect(x: 0, y: 0, width: outputSide, height: outputSide)
    guard let cg = Self.ciContext.createCGImage(scaled, from: outputRect) else { return nil }
    return UIImage(cgImage: cg, scale: 1, orientation: .up)
  }

  /// Camera pixels clipped through the PICKED EMOJI's silhouette (like the main
  /// 2D workspace, where the smudge footprint follows the emoji shape). Smudge
  /// mode must never reveal the emoji's own colors; only its ALPHA shapes the
  /// pulled camera pixels.
  private func softSmudgeCameraCrop(
    _ cameraPatch: UIImage,
    side: CGFloat,
    strength: CGFloat,
    focus: CGFloat
  ) -> UIImage? {
    let fmt = UIGraphicsImageRendererFormat.default()
    fmt.opaque = false
    // SPEED: render the dab at 1× (not device 3×) — a ~112pt crop is a 112px
    // buffer instead of 336px = ~9× less work per dab, invisible on a small wall
    // stamp. This is the main cost of a live smudge drag.
    fmt.scale = 1
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt)
    // Per-dab opacity is INVERTED across the slider (mode, not intensity):
    // MIN → ~0.60 = a CLEAN, defined texture under the finger; MAX → ~0.32 = each
    // dab blends only a little so pushed pixels MIX slowly into a fluid smear.
    let sN = max(0, min(1, (strength - 0.15) / 0.85))
    let lowReachExtra = max(0, min(1, (0.15 - strength) / 0.15))
    let highReachExtra = max(0, min(1, (strength - 0.85) / 0.15))
    let clampedFocus = max(0, min(focus, 1))
    let sharpAmount = max(0, (0.5 - clampedFocus) / 0.5)
    let softAmount = max(0, (clampedFocus - 0.5) / 0.5)
    var centerAlpha = (0.60 - sN * 0.28) * (1 - lowReachExtra * 0.42) * (1 - highReachExtra * 0.25)
    centerAlpha = min(0.92, centerAlpha + sharpAmount * (0.22 + sN * 0.08))
    centerAlpha *= 1 - softAmount * 0.55
    let sideKey = Int(side.rounded())
    let strengthKey = Int((max(0, min(strength, 1)) * 10).rounded())
    let focusKey = Int((clampedFocus * 20).rounded())
    let maskKey = "emoji|\(Self.brushCacheKey(brushEmoji))|\(sideKey)|\(strengthKey)|f\(focusKey)"
    let mask: UIImage
    if let cached = smudgeMaskCache[maskKey] {
      mask = cached
    } else {
      mask = emojiSilhouetteAlphaMask(side: side, strength: strength, focus: clampedFocus)
      smudgeMaskCache[maskKey] = mask
      if smudgeMaskCache.count > 24 {
        smudgeMaskCache.removeAll(keepingCapacity: true)
        smudgeMaskCache[maskKey] = mask
      }
    }
    let dab = renderer.image { _ in
      let full = CGRect(x: 0, y: 0, width: side, height: side)
      // 1) Lay down the emoji ALPHA shape (white-on-clear, feathered) — this is
      //    the destination alpha we clip the camera to.
      mask.draw(in: full)
      // 2) Fill that shape with the live camera texture using .sourceIn, so ONLY
      //    the emoji cutout is painted (no full square) and it shows the real
      //    pixels (not white). .sourceIn = camera × emojiAlpha.
      cameraPatch.draw(in: full, blendMode: .sourceIn, alpha: centerAlpha)
    }
    // Neutral focus returns the renderer output directly, keeping the original
    // pixels and avoiding any additional filter work. Soft focus diffuses both
    // camera detail and alpha; the plane footprint itself remains unchanged.
    guard softAmount > 0.0001 else { return dab }
    let blurRadius = side * 0.09 * softAmount
    return blurredAlphaImage(dab, radius: blurRadius) ?? dab
  }

  private func blendSmudgeTextures(
    locked: UIImage,
    moving: UIImage,
    movingAmount: CGFloat
  ) -> UIImage {
    let amount = max(0, min(1, movingAmount))
    let size = moving.size
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    format.scale = 1
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      let rect = CGRect(origin: .zero, size: size)
      locked.draw(in: rect, blendMode: .normal, alpha: 1 - amount)
      moving.draw(in: rect, blendMode: .normal, alpha: amount)
    }
  }

  /// The picked emoji rendered WHITE-ON-CLEAR with a feathered edge — used as a
  /// destinationIn alpha mask so the smudge dab is emoji-shaped. Only the glyph's
  /// alpha is used (colors are flattened to white), so no emoji tint leaks into
  /// the smeared camera pixels. Falls back to the soft rounded square if the
  /// glyph renders empty.
  private func emojiSilhouetteAlphaMask(side: CGFloat, strength: CGFloat, focus: CGFloat) -> UIImage {
    let fmt = UIGraphicsImageRendererFormat()
    fmt.opaque = false
    fmt.scale = 1
    let normalizedStrength = max(0, min(strength, 1))
    let clampedFocus = max(0, min(focus, 1))
    let sharpAmount = max(0, (0.5 - clampedFocus) / 0.5)
    let softAmount = max(0, (clampedFocus - 0.5) / 0.5)
    // At neutral these are exactly the legacy feather and font size. Sharp focus
    // keeps a strong core; soft focus contracts it and gives the cloud room.
    let legacyFeather = side * (0.20 - normalizedStrength * 0.06)
    let feather = legacyFeather * (1 - sharpAmount * 0.75) * (1 + softAmount * 1.10)
    let fontSize = side * (0.72 + sharpAmount * 0.06 - softAmount * 0.14)
    let font = UIFont.systemFont(ofSize: fontSize)
    let s = brushEmoji as NSString
    let isCustom = Self.isCustomBrush(brushEmoji)
    let ts = isCustom
      ? CGSize(width: fontSize, height: fontSize)
      : s.size(withAttributes: [.font: font])
    guard ts.width > 1, ts.height > 1 else {
      return softRoundedSquareAlphaMask(side: side, strength: strength, focus: clampedFocus)
    }
    // 1) render the glyph (or the custom brush PNG, scaled to the same footprint)…
    let glyph = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { _ in
      if isCustom {
        drawCustomBrush(
          brushEmoji,
          in: CGRect(x: (side - ts.width) / 2, y: (side - ts.height) / 2, width: ts.width, height: ts.height)
        )
        return
      }
      s.draw(at: CGPoint(x: (side - ts.width) / 2, y: (side - ts.height) / 2),
             withAttributes: [.font: font])
    }
    // 2) …flatten to a white silhouette (keep alpha, drop color) + soft feathered edge
    return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { ctx in
      let c = ctx.cgContext
      c.clear(CGRect(x: 0, y: 0, width: side, height: side))
      if feather > 0.5 {
        c.setShadow(offset: .zero, blur: feather, color: UIColor(white: 1, alpha: 0.85).cgColor)
      }
      glyph.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
      c.setShadow(offset: .zero, blur: 0, color: nil)
      c.setBlendMode(.sourceIn)          // paint white through the glyph's alpha
      UIColor(white: 1, alpha: 1).setFill()
      c.fill(CGRect(x: 0, y: 0, width: side, height: side))
      // Near Soft Cloud MAX, add a deterministic low-alpha spray around the
      // contracted core. It is generated in the cached alpha mask, so it does
      // not flicker between dabs and never introduces emoji color.
      if softAmount > 0.35 {
        c.setBlendMode(.normal)
        var seed = brushEmoji.unicodeScalars.reduce(UInt32(2_166_136_261)) {
          ($0 ^ $1.value) &* 16_777_619
        } ^ UInt32(max(0, Int(side.rounded())))
        func nextUnit() -> CGFloat {
          seed = seed &* 1_664_525 &+ 1_013_904_223
          return CGFloat(seed & 0xffff) / 65_535
        }
        let dotCount = Int(6 + softAmount * 16)
        UIColor(white: 1, alpha: 0.05 + softAmount * 0.11).setFill()
        for _ in 0..<dotCount {
          let x = side * (0.10 + nextUnit() * 0.80)
          let y = side * (0.10 + nextUnit() * 0.80)
          let radius = side * (0.006 + nextUnit() * 0.014)
          c.fillEllipse(in: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
        }
      }
    }
  }

  private func softRoundedSquareAlphaMask(side: CGFloat, strength: CGFloat, focus: CGFloat) -> UIImage {
    let fmt = UIGraphicsImageRendererFormat()
    fmt.opaque = false
    fmt.scale = 1
    let normalizedStrength = max(0, min(strength, 1))
    let clampedFocus = max(0, min(focus, 1))
    let sharpAmount = max(0, (0.5 - clampedFocus) / 0.5)
    let softAmount = max(0, (clampedFocus - 0.5) / 0.5)
    let feather = side * (0.18 - normalizedStrength * 0.05) * (1 - sharpAmount * 0.75) * (1 + softAmount * 1.10)
    let corner = side * (0.22 + normalizedStrength * 0.08)
    let outerRect = CGRect(x: feather * 0.55, y: feather * 0.55, width: side - feather * 1.1, height: side - feather * 1.1)
    let innerRect = outerRect.insetBy(dx: feather * 0.58, dy: feather * 0.58)
    return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { ctx in
      let c = ctx.cgContext
      c.clear(CGRect(x: 0, y: 0, width: side, height: side))
      c.setShadow(offset: .zero, blur: feather, color: UIColor(white: 1, alpha: 0.72).cgColor)
      UIColor(white: 1, alpha: 0.55).setFill()
      UIBezierPath(roundedRect: outerRect, cornerRadius: corner).fill()
      c.setShadow(offset: .zero, blur: 0, color: nil)
      UIColor(white: 1, alpha: 1).setFill()
      UIBezierPath(roundedRect: innerRect, cornerRadius: max(2, corner - feather * 0.35)).fill()
    }
  }

  private func softCircleAlphaMask(side: CGFloat, strength: CGFloat) -> UIImage {
    let fmt = UIGraphicsImageRendererFormat()
    fmt.opaque = false
    fmt.scale = 1
    let normalizedStrength = max(0, min(strength, 1))
    let solidRadius = side * (0.20 + normalizedStrength * 0.12)
    let featherStart = side * (0.34 + normalizedStrength * 0.05)
    let outerRadius = side * 0.50
    return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { ctx in
      let c = ctx.cgContext
      let center = CGPoint(x: side / 2, y: side / 2)
      c.clear(CGRect(x: 0, y: 0, width: side, height: side))
      guard let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
          UIColor(white: 1, alpha: 1).cgColor,
          UIColor(white: 1, alpha: 0.86).cgColor,
          UIColor(white: 1, alpha: 0).cgColor
        ] as CFArray,
        locations: [0, min(0.96, featherStart / outerRadius), 1]
      ) else { return }
      c.drawRadialGradient(
        gradient,
        startCenter: center,
        startRadius: solidRadius,
        endCenter: center,
        endRadius: outerRadius,
        options: []
      )
    }
  }

  private func emojiAlphaMask(for emoji: String, side: CGFloat, blurRadius: CGFloat) -> UIImage {
    let fmt = UIGraphicsImageRendererFormat()
    fmt.opaque = false
    fmt.scale = 1
    let base = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { _ in
      let inset = side * 0.06
      emojiTexture(for: emoji).draw(in: CGRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2))
    }
    guard blurRadius > 0.25, let blurred = blurredAlphaImage(base, radius: blurRadius) else {
      return base
    }
    return blurred
  }

  /// GREY-HALO FIX: every other dab image in this file (`dab` in
  /// `softSmudgeCameraCrop`, the emoji glyph render, etc.) is produced by
  /// `UIGraphicsImageRenderer`, which always writes premultiplied-alpha RGBA
  /// (`kCGImageAlphaPremultipliedLast`). `CIContext.createCGImage(_:from:)` does
  /// NOT make that same guarantee — its output CGImage's `CGImageAlphaInfo` can
  /// differ, and SceneKit's texture loader (feeding `mat.diffuse.contents` with
  /// `blendMode = .alpha`) picks ONE premultiplication convention and applies it
  /// to whatever bytes it's handed. If the blurred CGImage's actual byte layout
  /// doesn't match what the loader assumes, alpha effectively gets applied twice
  /// (or not at all) exactly where alpha is fading out at the dab's soft edge —
  /// which reads precisely as the reported grey/dark halo. Routing the blurred
  /// result back through the SAME `UIGraphicsImageRenderer` path used everywhere
  /// else in this file guarantees byte-identical, consistent premultiplication
  /// regardless of what `CIContext.createCGImage`'s own default happens to be.
  private func blurredAlphaImage(_ image: UIImage, radius: CGFloat) -> UIImage? {
    guard let cg = image.cgImage else { return nil }
    let ci = CIImage(cgImage: cg)
    guard let filter = CIFilter(name: "CIGaussianBlur") else { return nil }
    filter.setValue(ci, forKey: kCIInputImageKey)
    filter.setValue(radius, forKey: kCIInputRadiusKey)
    guard let output = filter.outputImage?.cropped(to: ci.extent) else { return nil }
    let ciBackedImage = UIImage(ciImage: output, scale: image.scale, orientation: .up)
    let fmt = UIGraphicsImageRendererFormat()
    fmt.opaque = false
    fmt.scale = image.scale
    return UIGraphicsImageRenderer(size: image.size, format: fmt).image { _ in
      ciBackedImage.draw(in: CGRect(origin: .zero, size: image.size))
    }
  }

  private func runSmudgePushAnimation(on node: SCNNode, finalPosition: SCNVector3, result: ARRaycastResult, from: CGPoint, to: CGPoint) {
    guard let fromResult = raycast(at: from) else {
      node.runAction(SCNAction.sequence([
        SCNAction.scale(to: 1.08, duration: 0.12),
        SCNAction.scale(to: 1.0, duration: 0.88),
      ]))
      return
    }
    let n = surfaceNormal(of: result)
    let fromBase = stampPosition(from: fromResult)
    var delta = simd_float3(finalPosition.x - fromBase.x, finalPosition.y - fromBase.y, finalPosition.z - fromBase.z)
    delta = delta - n * simd_dot(delta, n)
    let length = simd_length(delta)
    guard length > 0.0001 else { return }
    let dir = delta / length
    let amount = min(Float(brushSizeMeters) * 0.12, max(0.002, length * 0.18))
    let overshoot = SCNVector3(
      finalPosition.x + dir.x * amount,
      finalPosition.y + dir.y * amount,
      finalPosition.z + dir.z * amount
    )
    node.runAction(SCNAction.group([
      SCNAction.sequence([
        SCNAction.move(to: overshoot, duration: 0.12),
        SCNAction.move(to: finalPosition, duration: 0.88),
      ]),
      SCNAction.sequence([
        SCNAction.scale(to: 1.08, duration: 0.12),
        SCNAction.scale(to: 1.0, duration: 0.88),
      ]),
    ]))
  }

  /// Adds the emoji quad for a stamp
  /// `layer` decides which generation's material this stamp draws through, so
  /// rebuilding a frozen stroke reproduces its baked effect look.
  private func appendStampNodes(stamp: StampData, to group: SCNNode, in layer: RenderLayer? = nil) {
    let node = SCNNode(geometry: sharedGeometry(for: stamp.emoji, size: stamp.size, in: layer))
    node.simdOrientation = stamp.orientation
    node.position = stamp.position
    node.castsShadow = strokeShadowsEnabled   // off by default (clean decals)
    node.renderingOrder = group.renderingOrder
    // Mirroring a texture-mapped plane is a reflection, not a rotation — a quaternion can't express
    // it, so it goes on the NODE's own scale (safe: geometry/material stay SHARED across stamps,
    // only this per-node transform differs).
    if stamp.flipX || stamp.flipY {
      node.scale = SCNVector3(stamp.flipX ? -1 : 1, stamp.flipY ? -1 : 1, 1)
    }
    group.addChildNode(node)
  }

  // MARK: - Shared geometry/material caches

  /// Geometry/material for a stroke in a specific generation. Defaults to the
  /// live layer; a rebuild of an already-frozen stroke passes ITS layer, so the
  /// stroke comes back with its baked effect look rather than pristine.
  private func sharedGeometry(
    for emoji: String,
    size: CGFloat,
    in layer: RenderLayer? = nil
  ) -> SCNPlane {
    let layer = layer ?? liveLayer
    let sizeKey = Int(size * 1000)
    let key = "\(Self.brushCacheKey(emoji))|\(sizeKey)"
    if let cached = layer.geometries[key] {
      return cached
    }
    let plane = SCNPlane(width: size, height: size)
    plane.firstMaterial = sharedMaterial(for: emoji, in: layer)
    layer.geometries[key] = plane
    return plane
  }

  private func sharedMaterial(for emoji: String, in layer: RenderLayer? = nil) -> SCNMaterial {
    let layer = layer ?? liveLayer
    let cacheKey = Self.brushCacheKey(emoji)
    if let cached = layer.materials[cacheKey] {
      return cached
    }
    let material = SCNMaterial()
    let tex = emojiTexture(for: emoji)
    material.diffuse.contents = tex
    // LAMBERT so strokes RECEIVE light + shadow. The "stroke light amount" slider
    // blends via emission: emission re-adds the raw texture, so at amount=0
    // (emission.intensity=1) the shading is fully cancelled → flat true colours;
    // at amount=1 (emission.intensity=0) → fully lit + shaded like before.
    material.lightingModel = .lambert
    material.emission.contents = tex
    material.emission.intensity = CGFloat(max(0, min(1, 1 - strokeLightAmount)))
    material.isDoubleSided = true
    material.transparencyMode = .aOne
    // Surface shader: (a) MELT — when meltT > 0 every fragment resamples the
    // emoji from higher up, in wobbling per-column drips seeded by a stable
    // world-position hash, and the trailing edge slowly drains away. Runs fully
    // on GPU for thousands of stamps. (b) alpha-discard silhouette (always).
    // Geometry shader: the quads themselves sag/stretch downward while melting.
    material.shaderModifiers = [
      .surface: Self.meltSurfaceModifier,
      .geometry: Self.meltGeometryModifier,
    ]
    material.setValue(0.0, forKey: "meltT")
    material.setValue(0.0, forKey: "washT")
    material.setValue(1.0, forKey: "meltDirV")
    material.setValue(CGFloat(max(0, min(1, 1 - strokeLightAmount))), forKey: "meltEmis")
    // Default: PURE painter's-order decals — neither write nor read the main depth
    // buffer, so coplanar stamps can never z-fight (no shimmer while moving). When
    // the Stroke-shadows toggle is ON, they write depth so they land in the sun's
    // shadow map and cast a real shadow (stacking keeps overlaps apart to limit
    // shadow-map shimmer). readsFromDepthBuffer stays tied to wall occlusion.
    material.writesToDepthBuffer = strokeShadowsEnabled
    material.readsFromDepthBuffer = false
    // Match the blend-into-world tint if that filter is already on (same subtle range).
    if blendFilterEnabled {
      material.multiply.contents = strokeBlendTint(amount: CGFloat(0.03 + max(0, min(1, blendAmount)) * 0.30))
    }
    layer.materials[cacheKey] = material
    return material
  }

  // MARK: - Eraser

  private func eraseAt(point: CGPoint) {
    guard let result = raycast(at: point) else { return }
    updateSprayTarget(from: result)
    let center = stampPosition(from: result)
    let radius = Float(brushSizeMeters)

    for entry in undoHistory {
      for record in paintRecords(in: entry) {
        guard record.node.parent != nil, !record.node.isHidden else { continue }
        let hit = record.stamps.filter { distance($0.position, center) <= radius }
        guard !hit.isEmpty else { continue }
        record.stamps.removeAll { stamp in
          hit.contains { distance($0.position, stamp.position) < 0.0001 }
        }
        rebuild(record: record)
        totalStampCount = max(0, totalStampCount - hit.count)

        let key = ObjectIdentifier(record)
        if var existing = currentEraseBatch[key] {
          existing.removed.append(contentsOf: hit)
          currentEraseBatch[key] = existing
        } else {
          currentEraseBatch[key] = (record: record, removed: hit)
        }
      }
    }
  }

  private func endEraseGesture() {
    if !currentEraseBatch.isEmpty {
      undoHistory.append(.erase(Array(currentEraseBatch.values)))
      redoHistory.removeAll()
      emitHistory()
    }
    currentEraseBatch = [:]
  }

  // MARK: - Texture cache

  /// A custom brush ("Save as Stroke") arrives as a `data:image/png;base64,…` string rather than an
  /// emoji glyph. Drawing that string as text renders literal characters ("cu…"), so every site that
  /// paints the brush must go through here first.
  static let customBrushPrefix = "data:image/png;base64,"

  static func isCustomBrush(_ value: String) -> Bool {
    return value.hasPrefix(customBrushPrefix)
  }

  /// Cache key for a brush. An emoji is 1-8 bytes and makes a fine key, but a custom brush is a
  /// ~300 KB data URI — using THAT as a Dictionary/NSCache key means allocating, copying and hashing
  /// 300 KB on every stamp (sharedGeometry runs per drag update, ~60x/s), which stutters the stroke.
  /// Fingerprint it in O(1) instead: byte count + head + tail is unique enough for a session cache.
  static func brushCacheKey(_ value: String) -> String {
    guard isCustomBrush(value) else { return value }
    return "cb:\(value.utf8.count):\(value.prefix(28))\(value.suffix(28))"
  }

  private static func decodeCustomBrush(_ value: String) -> UIImage? {
    guard isCustomBrush(value) else { return nil }
    let base64 = String(value.dropFirst(customBrushPrefix.count))
    guard let data = Data(base64Encoded: base64) else { return nil }
    return UIImage(data: data)
  }

  /// Draw the brush artwork — glyph OR custom PNG — aspect-fit and centred inside `rect`.
  /// Returns false when `value` is not a custom brush, so callers keep their existing glyph path.
  @discardableResult
  private func drawCustomBrush(_ value: String, in rect: CGRect) -> Bool {
    guard let image = Self.decodeCustomBrush(value) else { return false }
    let aspect = image.size.width / max(image.size.height, 0.0001)
    var target = rect
    if aspect > 1 {
      target.size.height = rect.width / aspect
      target.origin.y = rect.origin.y + (rect.height - target.size.height) / 2
    } else {
      target.size.width = rect.height * aspect
      target.origin.x = rect.origin.x + (rect.width - target.size.width) / 2
    }
    image.draw(in: target)
    return true
  }

  private func emojiTexture(for emoji: String) -> UIImage {
    let key = Self.brushCacheKey(emoji) as NSString
    if let cached = Self.emojiTextureCache.object(forKey: key) {
      return cached
    }
    let size = CGSize(width: 256, height: 256)
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    let full = CGRect(origin: .zero, size: size)
    let image = renderer.image { _ in
      if drawCustomBrush(emoji, in: full) { return }
      let font = UIFont.systemFont(ofSize: 200)
      let attributes: [NSAttributedString.Key: Any] = [.font: font]
      let textSize = (emoji as NSString).size(withAttributes: attributes)
      let origin = CGPoint(
        x: (size.width - textSize.width) / 2,
        y: (size.height - textSize.height) / 2
      )
      (emoji as NSString).draw(at: origin, withAttributes: attributes)
    }
    Self.emojiTextureCache.setObject(image, forKey: key)
    return image
  }

  private func distance(_ a: SCNVector3, _ b: SCNVector3) -> Float {
    let dx = a.x - b.x
    let dy = a.y - b.y
    let dz = a.z - b.z
    return sqrtf(dx * dx + dy * dy + dz * dz)
  }

  // MARK: - Media placement (image/video → wall, drag + pinch + place)

  func startPlacement(path: String, isVideo: Bool) {
    cancelPlacement()
    let cleanPath = path.replacingOccurrences(of: "file://", with: "")

    var planeWidth: CGFloat = 0.5
    var planeHeight: CGFloat = 0.5
    let material = SCNMaterial()
    material.lightingModel = .constant
    material.isDoubleSided = true

    if isVideo {
      let url = URL(fileURLWithPath: cleanPath)
      guard FileManager.default.fileExists(atPath: cleanPath) else {
        onArError(["message": "Video file not found"])
        return
      }
      let item = AVPlayerItem(url: url)
      let player = AVQueuePlayer()
      player.isMuted = true
      placementLooper = AVPlayerLooper(player: player, templateItem: item)
      placementPlayer = player
      material.diffuse.contents = player
      // Respect the video's alpha channel (transparent HEVC MOV → see-through on
      // the wall). No-op for opaque H.264 (it just stays opaque).
      material.transparencyMode = .aOne
      material.blendMode = .alpha
      material.writesToDepthBuffer = false
      material.readsFromDepthBuffer = false
      if let track = AVAsset(url: url).tracks(withMediaType: .video).first {
        let size = track.naturalSize.applying(track.preferredTransform)
        let w = abs(size.width)
        let h = abs(size.height)
        if w > 0 && h > 0 {
          if w >= h { planeHeight = planeWidth * h / w } else { planeWidth = planeHeight * w / h }
        }
      }
      player.play()
    } else {
      guard let image = UIImage(contentsOfFile: cleanPath) else {
        onArError(["message": "Could not load image"])
        return
      }
      material.diffuse.contents = image
      let w = image.size.width
      let h = image.size.height
      if w > 0 && h > 0 {
        if w >= h { planeHeight = planeWidth * h / w } else { planeWidth = planeHeight * w / h }
      }
    }

    let plane = SCNPlane(width: planeWidth, height: planeHeight)
    plane.firstMaterial = material
    let node = SCNNode(geometry: plane)
    node.castsShadow = false
    strokeOrderCounter += 2
    node.renderingOrder = strokeOrderCounter
    node.opacity = 0.85 // slightly transparent while placing

    // Start at screen center (or 0.5m in front of camera if no surface yet)
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    if let result = raycast(at: center) {
      positionPlacement(node: node, with: result)
    } else if let cameraTransform = arView.session.currentFrame?.camera.transform {
      let forward = -simd_float3(cameraTransform.columns.2.x, cameraTransform.columns.2.y, cameraTransform.columns.2.z)
      let cameraPos = simd_float3(cameraTransform.columns.3.x, cameraTransform.columns.3.y, cameraTransform.columns.3.z)
      let pos = cameraPos + forward * 0.5
      node.position = SCNVector3(pos.x, pos.y, pos.z)
    }

    arView.scene.rootNode.addChildNode(node)
    placementNode = node
    placementBaseScale = 1
    pinchRecognizer?.isEnabled = true
  }

  private func positionPlacement(node: SCNNode, with result: ARRaycastResult) {
    let normal = surfaceNormal(of: result)
    let t = result.worldTransform
    node.position = SCNVector3(
      t.columns.3.x + normal.x * Self.stampSurfaceOffset,
      t.columns.3.y + normal.y * Self.stampSurfaceOffset,
      t.columns.3.z + normal.z * Self.stampSurfaceOffset
    )
    node.simdOrientation = stampOrientation(normal: normal)
  }

  @objc private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
    guard let node = placementNode else { return }
    switch gesture.state {
    case .changed:
      let scale = max(0.1, min(placementBaseScale * Float(gesture.scale), 8))
      node.scale = SCNVector3(scale, scale, scale)
    case .ended, .cancelled:
      placementBaseScale = node.scale.x
    default:
      break
    }
  }

  /// Two-finger pinch resizes the brush (and the spray can follows). Disabled
  /// while placing media (that has its own pinch).
  @objc private func handleBrushPinch(_ gesture: UIPinchGestureRecognizer) {
    if placementNode != nil { return }
    switch gesture.state {
    case .began:
      isBrushPinching = true
      brushPinchBaseSize = brushSizeMeters
      // Abandon any in-progress stroke so the pinch doesn't leave a stray dab
      cancelActiveStroke()
    case .changed:
      let next = max(Self.minBrushMeters, min(brushPinchBaseSize * gesture.scale, Self.maxBrushMeters))
      brushSizeMeters = next // didSet scales the spray can
      DispatchQueue.main.async { [weak self] in
        self?.onBrushSizeChanged(["size": Double(next)])
      }
    case .ended, .cancelled, .failed:
      isBrushPinching = false
    default:
      break
    }
  }

  /// Scale the spray can proportionally to the brush size (default 0.092 → 1.0)
  private func applySprayCanScale() {
    let ratio = Float(brushSizeMeters / 0.092)
    let s = max(0.55, min(ratio, 2.4))
    sprayCanNode?.scale = SCNVector3(s, s, s)
  }

  /// Drop the current live stroke (used when a pinch interrupts painting)
  private func cancelActiveStroke() {
    if let record = liveStrokeRecord {
      totalStampCount = max(0, totalStampCount - record.contentCount)
    }
    if let record = liveMirrorRecord {
      totalStampCount = max(0, totalStampCount - record.contentCount)
    }
    liveStrokeGroup?.removeFromParentNode()
    liveMirrorGroup?.removeFromParentNode()
    for record in liveAnimationGestureRecords {
      record.node.removeFromParentNode()
      totalStampCount = max(0, totalStampCount - record.contentCount)
    }
    liveAnimationGestureRecords = []
    liveStrokeGroup = nil
    liveStrokeRecord = nil
    liveMirrorGroup = nil
    liveMirrorRecord = nil
    lastStampPosition = nil
    lastScreenPoint = nil
    isPaintingNow = false
    setSpraying(false)
    resetSmudgeGestureState()
  }

  func confirmPlacement() {
    guard let node = placementNode else { return }
    node.opacity = 1.0
    // Placed media joins history as its own undoable entry
    let timing = animationTimingForNewStroke()
    let record = StrokeRecord(
      node: node,
      opacity: 1.0,
      renderingOrder: node.renderingOrder,
      layer: liveLayer,
      animationStartFrame: timing.start,
      animationDuration: timing.duration
    )
    applyAnimationVisibility(to: record)
    undoHistory.append(.paint(record))
    redoHistory.removeAll()
    emitHistory()
    placementNode = nil
    pinchRecognizer?.isEnabled = false
    // Video keeps looping after placement; players stay owned by the view
  }

  func cancelPlacement() {
    placementNode?.removeFromParentNode()
    placementNode = nil
    placementPlayer?.pause()
    placementPlayer = nil
    placementLooper = nil
    pinchRecognizer?.isEnabled = false
  }

  // MARK: - Scene persistence: save room map + strokes, relocalize + replay

  /// The full painting as plain JSON — shared by "Save scene" and by the
  /// automatic snapshot taken when the user switches to the front camera.
  private func scenePayload() -> [String: Any] {
    var strokesJson: [[String: Any]] = []
    for entry in undoHistory {
      for record in paintRecords(in: entry) {
        guard record.node.parent != nil, !record.stamps.isEmpty else { continue }
        let stamps: [[String: Any]] = record.stamps.map { stamp in
          [
            "p": [stamp.position.x, stamp.position.y, stamp.position.z],
            "q": [stamp.orientation.imag.x, stamp.orientation.imag.y,
                  stamp.orientation.imag.z, stamp.orientation.real],
            "e": stamp.emoji,
            "s": Double(stamp.size),
          ]
        }
        var strokeJson: [String: Any] = [
          "opacity": Double(record.opacity),
          "order": record.renderingOrder,
          "stamps": stamps,
        ]
        if let start = record.animationStartFrame,
           let duration = record.animationDuration {
          strokeJson["animationStartFrame"] = start
          strokeJson["animationDuration"] = duration
        }
        strokesJson.append(strokeJson)
      }
    }
    return [
      "strokes": strokesJson,
      "animation": [
        "enabled": animationEnabled,
        "currentFrame": animationCurrentFrame,
        "totalFrames": animationTotalFrames,
        "strokeLength": animationStrokeLength,
        "fps": animationFps,
        "looping": animationLooping,
      ],
    ]
  }

  /// JSON-safe RoomPlan/hybrid metadata.  Strokes intentionally stay in the
  /// existing world-space format above, so enabling or disabling ROOM cannot
  /// visibly move or rebake a single stamp.
  private func roomPackagePayload() -> [String: Any]? {
    guard #available(iOS 17.0, *), let manager = roomPlanManager else { return nil }
    let surfaces = manager.previewSurfaces().map { surface -> [String: Any] in
      let t = surface.transform
      return [
        "id": surface.id,
        "category": surface.category,
        "confidence": surface.confidence,
        "dimensions": [surface.dimensions.x, surface.dimensions.y, surface.dimensions.z],
        "transform": [
          t.columns.0.x, t.columns.0.y, t.columns.0.z, t.columns.0.w,
          t.columns.1.x, t.columns.1.y, t.columns.1.z, t.columns.1.w,
          t.columns.2.x, t.columns.2.y, t.columns.2.z, t.columns.2.w,
          t.columns.3.x, t.columns.3.y, t.columns.3.z, t.columns.3.w,
        ],
      ]
    }
    return [
      "version": 1,
      "sourceOfTruth": "world-space-strokes",
      "roomPlanSurfaces": surfaces,
      "retainedARPlaneSurfaces": retainedARPlaneSurfaces,
      "readiness": manager.latestReadiness?.eventPayload() ?? [:],
    ]
  }

  /// Snapshot of the editable room model for the in-app orbit viewer. The
  /// world-space stroke records are deliberately reused unchanged.
  func roomViewerPayload() -> [String: Any]? {
    guard var payload = roomPackagePayload() else { return nil }
    payload["strokes"] = scenePayload()["strokes"] ?? []
    return payload
  }

  /// Where the automatic "I switched to the front camera" snapshot lives.
  private var switchStateDir: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("ar_scenes/_switch_autosave", isDirectory: true)
  }

  /// Write the painting + the room map to disk when leaving for the front
  /// camera, so even a full teardown of this view can be recovered from.
  /// Uses the map already captured in memory — no live session needed.
  private func saveSwitchState() {
    let payload = scenePayload()
    guard let strokes = payload["strokes"] as? [[String: Any]], !strokes.isEmpty else { return }
    // Armed only for the rest of THIS app run: a fresh launch must never
    // surprise the user by replaying an old room they are no longer standing in.
    Self.switchStateArmed = true
    let map = pausedWorldMap
    let dir = switchStateDir
    DispatchQueue.global(qos: .utility).async {
      do {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: payload)
          .write(to: dir.appendingPathComponent("strokes.json"))
        if let map {
          try NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true)
            .write(to: dir.appendingPathComponent("worldmap.bin"))
        }
        arSwitchLog("wall switch-state saved (strokes=\(strokes.count) map=\(map != nil))")
      } catch {
        arSwitchLog("wall switch-state save failed: \(error.localizedDescription)")
      }
    }
  }

  /// Recover the painting if this view came back empty (it was rebuilt).
  /// Returns true when a restore was started.
  private func restoreSwitchStateIfEmpty() -> Bool {
    guard Self.switchStateArmed, undoHistory.isEmpty else { return false }
    Self.switchStateArmed = false
    let dir = switchStateDir
    guard FileManager.default.fileExists(atPath: dir.appendingPathComponent("worldmap.bin").path)
    else { return false }
    do {
      try loadScene(dir: dir.path)
      arSwitchLog("wall restoring switch-state from disk")
      return true
    } catch {
      arSwitchLog("wall switch-state restore failed: \(error.localizedDescription)")
      return false
    }
  }

  /// Saves ARWorldMap + all strokes + a snapshot into Documents/ar_scenes/<id>/
  func saveScene(completion: @escaping ([String: Any]?, String?) -> Void) {
    arView.session.getCurrentWorldMap { [weak self] worldMap, error in
      guard let self = self else { return }
      guard let worldMap = worldMap else {
        completion(nil, "Room not mapped enough yet — move your phone around the room, then save again. (\(error?.localizedDescription ?? ""))")
        return
      }
      do {
        let sceneId = "scene_\(Int(Date().timeIntervalSince1970))"
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = documents.appendingPathComponent("ar_scenes/\(sceneId)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        // World map
        let mapData = try NSKeyedArchiver.archivedData(withRootObject: worldMap, requiringSecureCoding: true)
        try mapData.write(to: dir.appendingPathComponent("worldmap.bin"))

        // Strokes (paint records only; world-space stamps)
        let payload = self.scenePayload()
        let strokeCount = (payload["strokes"] as? [[String: Any]])?.count ?? 0
        let strokesData = try JSONSerialization.data(withJSONObject: payload)
        try strokesData.write(to: dir.appendingPathComponent("strokes.json"))

        // RoomPlan is an optional second layer.  Keep its native Codable
        // result and our hybrid correspondence side-by-side with the legacy
        // scene files so older scenes remain loadable.
        var roomReady = false
        var roomSurfaceCount = 0
        if #available(iOS 17.0, *), let manager = self.roomPlanManager {
          roomReady = manager.latestReadiness?.state == "roomReady"
          roomSurfaceCount = manager.previewSurfaces().count
          if let roomJSON = manager.encodedRoomJSON() {
            try roomJSON.write(to: dir.appendingPathComponent("roomplan.json"))
          }
          if let captureJSON = manager.encodedRoomDataJSON() {
            try captureJSON.write(to: dir.appendingPathComponent("roomplan-capture.json"))
          }
          if let hybrid = self.roomPackagePayload() {
            let hybridData = try JSONSerialization.data(withJSONObject: hybrid)
            try hybridData.write(to: dir.appendingPathComponent("hybrid-room.json"))
          }
        }

        // Snapshot: for a ROOM, prefer a dollhouse-style render of the room +
        // strokes (matches the in-app 3D Inspector) over the live camera
        // frame — a ROOM's camera frame at save time is usually a
        // strokes-filled wall closeup with little spatial context. Falls
        // back to the plain camera snapshot for non-room scenes or if the
        // room geometry isn't renderable yet.
        var snapshot: UIImage?
        if #available(iOS 17.0, *), roomReady,
           let payload = self.roomViewerPayload(),
           let payloadData = try? JSONSerialization.data(withJSONObject: payload),
           let payloadJSON = String(data: payloadData, encoding: .utf8) {
          snapshot = RoomPreviewView.renderThumbnail(fromJSON: payloadJSON, size: CGSize(width: 640, height: 640))
        }
        let finalSnapshot = snapshot ?? self.arView.snapshot()
        if let png = finalSnapshot.pngData() {
          try png.write(to: dir.appendingPathComponent("snapshot.png"))
        }

        completion([
          "dir": dir.path,
          "snapshotPath": dir.appendingPathComponent("snapshot.png").path,
          "strokeCount": strokeCount,
          "roomReady": roomReady,
          "roomSurfaceCount": roomSurfaceCount,
        ], nil)
      } catch {
        completion(nil, "Save failed: \(error.localizedDescription)")
      }
    }
  }

  /// Loads a saved scene: relocalizes against the saved room, then replays
  /// the strokes one by one once the room is found.
  func loadScene(dir: String) throws {
    let dirUrl = URL(fileURLWithPath: dir.replacingOccurrences(of: "file://", with: ""))
    let mapData = try Data(contentsOf: dirUrl.appendingPathComponent("worldmap.bin"))
    guard let worldMap = try NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: mapData) else {
      throw EmojiArError.snapshotFailed
    }
    let strokesData = try Data(contentsOf: dirUrl.appendingPathComponent("strokes.json"))
    let parsed = try JSONSerialization.jsonObject(with: strokesData) as? [String: Any]
    pendingReplayStrokes = (parsed?["strokes"] as? [[String: Any]]) ?? []
    if let animation = parsed?["animation"] as? [String: Any] {
      animationTotalFrames = max(1, min((animation["totalFrames"] as? Int) ?? 90, 300))
      animationCurrentFrame = normalizedAnimationFrame((animation["currentFrame"] as? Int) ?? 0)
      animationStrokeLength = (animation["strokeLength"] as? Int) ?? 3
      animationFps = max(1, min((animation["fps"] as? Int) ?? 12, 60))
      animationLooping = (animation["looping"] as? Bool) ?? true
      animationEnabled = (animation["enabled"] as? Bool) ?? false
      emitAnimationLoaded()
    } else {
      // Scenes saved before AR Animator existed contain permanent strokes.
      animationEnabled = false
      animationCurrentFrame = 0
      emitAnimationLoaded()
    }

    // Clear current scene content
    clearAll()
    replayTimer?.invalidate()

    let config = ARWorldTrackingConfiguration()
    config.planeDetection = [.horizontal, .vertical]
    if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      config.sceneReconstruction = .mesh
    }
    config.isLightEstimationEnabled = true
    config.initialWorldMap = worldMap
    isRelocalizing = true
    arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    onSceneStatus(["status": "relocalizing"])
  }

  /// ARSessionDelegate: gate painting on stable tracking + detect when relocalization completes.
  func sessionWasInterrupted(_ session: ARSession) {
    paintingReady = false
    onSceneStatus(["status": "interrupted"])
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    recoverCameraAfterInterruption(reason: "interruption-ended")
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    onArError(["message": "AR camera paused — recovering", "detail": error.localizedDescription])
    recoverCameraAfterInterruption(reason: "session-failed")
  }

  /// Re-run the existing configuration without reset/remove flags.  SceneKit
  /// stroke nodes and AR anchors therefore remain intact; this only asks ARKit
  /// to reopen the camera stream after it was occluded/interrupted.
  private func recoverCameraAfterInterruption(reason: String) {
    guard sessionRunning, !paused, !cameraRecoveryScheduled,
          ARWorldTrackingConfiguration.isSupported else { return }
    cameraRecoveryScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self] in
      guard let self, self.sessionRunning, !self.paused else { return }
      self.arView.session.run(self.makeARConfig())
      self.arView.isPlaying = true
      self.startRoomPlanCollection()
      self.onSceneStatus(["status": "recovering", "reason": reason])
    }
    // Safety net: the soft retry above only reconfigures the same session, and
    // `cameraRecoveryScheduled` only clears once a frame actually arrives (see
    // `session(_:didUpdate:)`). If the camera pipeline is genuinely wedged
    // (not just briefly interrupted) no frame ever comes — the guard above
    // then silently drops every future interruption forever: AR view frozen,
    // RN buttons still work fine since they're a separate UIKit layer. If
    // nothing has cleared the flag by now, escalate to a full session resume.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
      guard let self, self.cameraRecoveryScheduled, self.sessionRunning, !self.paused else { return }
      arSwitchLog("wall camera recovery stalled — escalating to full resume (\(reason))")
      self.cameraRecoveryScheduled = false
      self.resumeSession()
    }
  }

  func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    // Painting gate: block only during the drift-prone initializing/relocalizing window; allow otherwise.
    switch camera.trackingState {
    case .limited(.initializing), .limited(.relocalizing):
      paintingReady = false
    default:
      paintingReady = true
    }
    guard isRelocalizing else { return }
    if case .normal = camera.trackingState {
      isRelocalizing = false
      DispatchQueue.main.async { [weak self] in
        self?.onSceneStatus(["status": "found"])
        self?.startStrokeReplay()
      }
    }
  }

  /// Replays saved strokes one at a time (every 0.3s) — the painting redraws
  /// itself into the room exactly where it was.
  private func startStrokeReplay() {
    guard !pendingReplayStrokes.isEmpty else {
      onSceneStatus(["status": "done"])
      return
    }
    onSceneStatus(["status": "replaying", "total": pendingReplayStrokes.count])
    var index = 0
    let strokes = pendingReplayStrokes
    pendingReplayStrokes = []
    replayTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] timer in
      guard let self = self else { timer.invalidate(); return }
      if index >= strokes.count {
        timer.invalidate()
        self.replayTimer = nil
        self.emitHistory()
        self.onSceneStatus(["status": "done"])
        return
      }
      self.replayStroke(strokes[index])
      index += 1
    }
  }

  private func replayStroke(_ json: [String: Any]) {
    let opacity = CGFloat((json["opacity"] as? Double) ?? 1)
    let order = (json["order"] as? Int) ?? (strokeOrderCounter + 2)
    strokeOrderCounter = max(strokeOrderCounter, order)
    let group = SCNNode()
    group.renderingOrder = order
    group.opacity = opacity
    let record = StrokeRecord(node: group, opacity: opacity, renderingOrder: order, layer: liveLayer)
    record.animationStartFrame = json["animationStartFrame"] as? Int
    record.animationDuration = json["animationDuration"] as? Int

    for stampJson in (json["stamps"] as? [[String: Any]]) ?? [] {
      guard let p = stampJson["p"] as? [Double], p.count == 3,
            let q = stampJson["q"] as? [Double], q.count == 4,
            let emoji = stampJson["e"] as? String,
            let sizeValue = stampJson["s"] as? Double else { continue }
      let stamp = StampData(
        position: SCNVector3(Float(p[0]), Float(p[1]), Float(p[2])),
        orientation: simd_quatf(ix: Float(q[0]), iy: Float(q[1]), iz: Float(q[2]), r: Float(q[3])),
        emoji: emoji,
        size: CGFloat(sizeValue)
      )
      record.stamps.append(stamp)
      totalStampCount += 1
    }
    arView.scene.rootNode.addChildNode(group)
    for stamp in record.stamps {
      appendStampNodes(stamp: stamp, to: group)
    }
    flatten(record: record)
    applyAnimationVisibility(to: record)
    undoHistory.append(.paint(record))
    // soft tick per replayed stroke
    sprayHaptics.impactOccurred(intensity: 0.4)
  }

  // MARK: - History commands

  func undoLastStroke() {
    guard let entry = undoHistory.popLast() else { return }
    switch entry {
    case .paint(let record):
      record.node.removeFromParentNode()
      totalStampCount = max(0, totalStampCount - record.contentCount)
    case .paintGroup(let records):
      for record in records {
        record.node.removeFromParentNode()
        totalStampCount = max(0, totalStampCount - record.contentCount)
      }
    case .erase(let affected):
      for item in affected {
        item.record.stamps.append(contentsOf: item.removed)
        rebuild(record: item.record)
        totalStampCount += item.removed.count
      }
    }
    redoHistory.append(entry)
    emitHistory()
  }

  func redoLastStroke() {
    guard let entry = redoHistory.popLast() else { return }
    switch entry {
    case .paint(let record):
      arView.scene.rootNode.addChildNode(record.node)
      applyAnimationVisibility(to: record)
      totalStampCount += record.contentCount
    case .paintGroup(let records):
      for record in records {
        arView.scene.rootNode.addChildNode(record.node)
        applyAnimationVisibility(to: record)
        totalStampCount += record.contentCount
      }
    case .erase(let affected):
      for item in affected {
        item.record.stamps.removeAll { stamp in
          item.removed.contains { distance($0.position, stamp.position) < 0.0001 }
        }
        rebuild(record: item.record)
        totalStampCount = max(0, totalStampCount - item.removed.count)
      }
    }
    undoHistory.append(entry)
    emitHistory()
  }

  func clearAll() {
    resetSmudgeGestureState()
    for entry in undoHistory {
      for record in paintRecords(in: entry) {
        record.node.removeFromParentNode()
      }
    }
    for record in liveAnimationGestureRecords { record.node.removeFromParentNode() }
    liveAnimationGestureRecords = []
    undoHistory.removeAll()
    redoHistory.removeAll()
    totalStampCount = 0
    smudgeNodes.removeAll()
    stampStackGrid.removeAll()   // reset stacking layers with the canvas
    liveStrokeCells.removeAll()
    freezingEffects = true       // clearing is not freezing: no bake, no rewind
    meltdownActive = false       // end any melt effect with the canvas
    washActive = false
    freezingEffects = false
    washProgress = 0
    lastPushedWashT = -1
    washScenePalette.removeAll(keepingCapacity: true)
    if destroyActive { teardownDestroy() }
    // Clear accumulated paint drips + the film/run/puddle simulation state too
    for node in dripNodePool { node.removeFromParentNode() }
    dripNodePool.removeAll()
    dripPoolCursor = 0
    activeRuns.removeAll()
    dripCells.removeAll()
    for (_, p) in puddles { p.node.removeFromParentNode() }
    puddles.removeAll()
    for node in washCameraNodes { node.removeFromParentNode() }
    washCameraNodes.removeAll()
    // Baked effect results are part of the artwork, so Clear All must take them
    // too — both the frozen drip/puddle residue and the retired look caches.
    for node in frozenResidueNodes { node.removeFromParentNode() }
    frozenResidueNodes.removeAll()
    frozenLayers.removeAll()
    liveLayer = RenderLayer()
    meltProgress = 0
    lastPushedMeltT = -1
    emitHistory()
  }

  private func emitHistory() {
    let undoCount = undoHistory.count
    let redoCount = redoHistory.count
    DispatchQueue.main.async { [weak self] in
      self?.onHistoryChanged(["undoCount": undoCount, "redoCount": redoCount])
    }
  }

  private func emitAnimationLoaded() {
    let payload: [String: Any] = [
      "enabled": animationEnabled,
      "currentFrame": animationCurrentFrame,
      "totalFrames": animationTotalFrames,
      "strokeLength": animationStrokeLength,
      "fps": animationFps,
      "looping": animationLooping,
    ]
    DispatchQueue.main.async { [weak self] in
      self?.onAnimationLoaded(payload)
    }
  }

  func snapshotToTmpFile() throws -> String {
    let image = arView.snapshot()
    return try writeSnapshotToTmp(image)
  }
}
