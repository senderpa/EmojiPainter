import ARKit
import Foundation
import RoomPlan

/// Background RoomPlan collector for WallPaintView.
///
/// This deliberately owns no view and never creates an ARSession.  It attaches
/// to WallPaintView's existing session, publishes throttled readiness data, and
/// keeps the latest Codable CapturedRoom available for the room package.
@available(iOS 17.0, *)
final class RoomPlanManager: NSObject, RoomCaptureSessionDelegate {
  struct SurfaceSummary {
    let id: String
    let category: String
    let confidence: String
    let dimensions: simd_float3
    let transform: simd_float4x4
  }

  struct ReadinessUpdate {
    let state: String
    let confidence: Double
    let wallCount: Int
    let floorCount: Int
    let openingCount: Int
    let coverage: Double
    let stability: Double
    let viewpoints: Int
    let worldMappingStatus: String
    let surfaces: [SurfaceSummary]

    func eventPayload() -> [String: Any] {
      [
        "state": state,
        "confidence": confidence,
        "wallCount": wallCount,
        "floorCount": floorCount,
        "openingCount": openingCount,
        "coverage": coverage,
        "stability": stability,
        "viewpoints": viewpoints,
        "worldMappingStatus": worldMappingStatus,
      ]
    }
  }

  static var isSupportedOnDevice: Bool {
    RoomCaptureSession.isSupported
  }

  private(set) var latestRoom: CapturedRoom?
  private(set) var latestRoomData: CapturedRoomData?
  private(set) var latestReadiness: ReadinessUpdate?
  private weak var arSession: ARSession?
  private var captureSession: RoomCaptureSession?
  private var running = false
  private var stableUpdateCount = 0
  private var lastRoomSignature = ""
  private var lastCameraPosition: simd_float3?
  private var viewpointCount = 0
  private var observationCount = 0
  /// The UI percentage is an app-derived estimate, not an Apple RoomPlan
  /// completion value (RoomPlan intentionally has no such flag).  Keep it
  /// monotonic for one scan so temporary surface revisions cannot make the
  /// visible value jump backwards while the user is still moving.
  private var displayedConfidence = 0.0
  private var peakCoverage = 0.0
  private var readyCandidateCount = 0
  private var roomReadyLatched = false
  private var lastEventTime: CFTimeInterval = 0

  var onReadinessChanged: ((ReadinessUpdate) -> Void)?

  func start(arSession: ARSession) {
    guard !running, Self.isSupportedOnDevice else { return }
    self.arSession = arSession
    stableUpdateCount = 0
    lastRoomSignature = ""
    lastCameraPosition = nil
    viewpointCount = 0
    observationCount = 0
    displayedConfidence = 0
    peakCoverage = 0
    readyCandidateCount = 0
    roomReadyLatched = false
    latestRoom = nil
    latestRoomData = nil
    latestReadiness = nil
    lastEventTime = 0

    // iOS 17's shared-session initializer is important: RoomPlan observes the
    // very same world origin/anchors used by the painter instead of competing
    // with it.  Coaching UI is intentionally disabled.
    let session = RoomCaptureSession(arSession: arSession)
    session.delegate = self
    captureSession = session
    running = true
    var configuration = RoomCaptureSession.Configuration()
    configuration.isCoachingEnabled = false
    session.run(configuration: configuration)
    emitInitialStateIfNeeded()
  }

  func stop() {
    guard running else { return }
    // Do not pause or reset WallPaintView's ARSession when RoomPlan stops.
    captureSession?.stop(pauseARSession: false)
    captureSession = nil
    running = false
  }

  func encodedRoomJSON() -> Data? {
    guard let room = latestRoom else { return nil }
    return try? JSONEncoder().encode(room)
  }

  func encodedRoomDataJSON() -> Data? {
    guard let data = latestRoomData else { return nil }
    return try? JSONEncoder().encode(data)
  }

  func previewSurfaces() -> [SurfaceSummary] {
    guard let room = latestRoom else { return [] }
    return surfaces(in: room)
  }

  // MARK: RoomCaptureSessionDelegate

  func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
    ingest(room)
  }

  func captureSession(_ session: RoomCaptureSession, didAdd room: CapturedRoom) {
    ingest(room)
  }

  func captureSession(_ session: RoomCaptureSession, didChange room: CapturedRoom) {
    ingest(room)
  }

  func captureSession(_ session: RoomCaptureSession, didRemove room: CapturedRoom) {
    ingest(room)
  }

  func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
    // No scanning prompts are forwarded to JS; RoomPlan is intentionally quiet.
  }

  func captureSession(_ session: RoomCaptureSession, didStartWith configuration: RoomCaptureSession.Configuration) {
    // Readiness is based on observed geometry, never on this lifecycle callback.
  }

  func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
    latestRoomData = data
  }

  // MARK: Readiness

  private func emitInitialStateIfNeeded() {
    guard latestReadiness == nil else { return }
    let update = ReadinessUpdate(
      state: "scanning", confidence: 0, wallCount: 0, floorCount: 0,
      openingCount: 0, coverage: 0, stability: 0, viewpoints: 0,
      worldMappingStatus: mappingStatus(), surfaces: []
    )
    latestReadiness = update
    onReadinessChanged?(update)
  }

  private func ingest(_ room: CapturedRoom) {
    let previousState = latestReadiness?.state
    latestRoom = room
    observationCount = min(observationCount + 1, 120)
    updateViewpointCount()

    let currentSignature = signature(for: room)
    let signatureUnchanged = !lastRoomSignature.isEmpty && currentSignature == lastRoomSignature
    if signatureUnchanged {
      stableUpdateCount = min(stableUpdateCount + 1, 12)
    } else {
      lastRoomSignature = currentSignature
      stableUpdateCount = max(1, stableUpdateCount / 2)
    }

    let all = surfaces(in: room)
    let walls = room.walls.count
    let floors = room.floors.count
    let openings = room.doors.count + room.windows.count + room.openings.count
    let rawCoverage = min(1.0, all.reduce(0.0) { partial, surface in
      let d = surface.dimensions
      let area: Float = surface.category == "floor" ? abs(d.x * d.z) : abs(d.x * d.y)
      return partial + Double(area)
    } / 18.0)
    // RoomPlan may temporarily remove/reclassify a surface while the camera is
    // occluded.  Preserve the best observed coverage for the progress display,
    // while retaining raw geometry in the saved CapturedRoom.
    peakCoverage = max(peakCoverage, rawCoverage)
    let coverage = max(rawCoverage, peakCoverage * 0.985)
    let stability = min(1.0, Double(stableUpdateCount) / 5.0)
    let mapping = mappingStatus()
    let mapReady = mapping == "mapped" || mapping == "extending"
    // "limited" still represents useful, anchored RoomPlan geometry.  Waiting
    // for .mapped made Save Room unreachable on real devices where the user
    // had already scanned a valid wall/floor but world mapping kept extending.
    let hasMapEvidence = mapReady || mapping == "limited"
    let hasUsefulArchitecture = walls > 0 && (floors > 0 || rawCoverage >= 0.12)
    let readyCandidate = hasUsefulArchitecture
      && rawCoverage >= 0.12
      && viewpointCount >= 2
      && observationCount >= 2
      && hasMapEvidence
    if readyCandidate {
      readyCandidateCount = min(readyCandidateCount + 1, 6)
    } else {
      readyCandidateCount = max(0, readyCandidateCount - 1)
    }
    if !roomReadyLatched && readyCandidateCount >= 2 {
      roomReadyLatched = true
    }

    let rawConfidence = min(1.0,
      coverage * 0.55
      + stability * 0.20
      + (mapReady ? 0.15 : (hasMapEvidence ? 0.08 : 0))
      + min(0.10, Double(viewpointCount) * 0.05)
    )
    displayedConfidence = max(displayedConfidence, rawConfidence)
    let state = roomReadyLatched ? "roomReady" : (all.isEmpty ? "scanning" : "partial")

    let update = ReadinessUpdate(
      state: state,
      confidence: displayedConfidence,
      wallCount: walls,
      floorCount: floors,
      openingCount: openings,
      coverage: coverage,
      stability: stability,
      viewpoints: viewpointCount,
      worldMappingStatus: mapping,
      surfaces: all
    )
    latestReadiness = update

    // RoomPlan can deliver updates at camera rate.  Keep the manager cheap and
    // only notify the view when a meaningful state/geometry update is due.
    let now = CACurrentMediaTime()
    let stateChanged = previousState != state
    guard stateChanged || now - lastEventTime >= 0.75 else { return }
    lastEventTime = now
    onReadinessChanged?(update)
  }

  private func updateViewpointCount() {
    guard let transform = arSession?.currentFrame?.camera.transform else { return }
    let position = simd_float3(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
    if let previous = lastCameraPosition, simd_distance(previous, position) >= 0.14 {
      viewpointCount = min(viewpointCount + 1, 30)
    } else if lastCameraPosition == nil {
      viewpointCount = 1
    }
    lastCameraPosition = position
  }

  private func mappingStatus() -> String {
    guard let status = arSession?.currentFrame?.worldMappingStatus else { return "notAvailable" }
    switch status {
    case .notAvailable: return "notAvailable"
    case .limited: return "limited"
    case .extending: return "extending"
    case .mapped: return "mapped"
    @unknown default: return "unknown"
    }
  }

  private func signature(for room: CapturedRoom) -> String {
    surfaces(in: room).map { surface in
      let d = surface.dimensions
      return "\(surface.id):\(surface.category):\(String(format: "%.2f,%.2f,%.2f", d.x, d.y, d.z))"
    }.sorted().joined(separator: "|")
  }

  private func surfaces(in room: CapturedRoom) -> [SurfaceSummary] {
    let candidates: [(CapturedRoom.Surface, String)] =
      room.walls.map { ($0, "wall") }
      + room.floors.map { ($0, "floor") }
      + room.doors.map { ($0, "door") }
      + room.windows.map { ($0, "window") }
      + room.openings.map { ($0, "opening") }
    return candidates.map { surface, fallbackCategory in
      SurfaceSummary(
        id: surface.identifier.uuidString,
        category: categoryName(surface.category, fallback: fallbackCategory),
        confidence: confidenceName(surface.confidence),
        dimensions: surface.dimensions,
        transform: surface.transform
      )
    }
  }

  private func categoryName(_ category: CapturedRoom.Surface.Category, fallback: String) -> String {
    switch category {
    case .wall: return "wall"
    case .opening: return "opening"
    case .window: return "window"
    case .door: return "door"
    case .floor: return "floor"
    @unknown default: return fallback
    }
  }

  private func confidenceName(_ confidence: CapturedRoom.Confidence) -> String {
    switch confidence {
    case .high: return "high"
    case .medium: return "medium"
    case .low: return "low"
    @unknown default: return "low"
    }
  }
}
