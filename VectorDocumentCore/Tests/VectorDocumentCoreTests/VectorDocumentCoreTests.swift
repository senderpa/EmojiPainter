import XCTest
@testable import VectorDocumentCore

final class VectorDocumentCoreTests: XCTestCase {

  // ── Chunk keys (negative floor + membership) ──
  func testChunkKeyNegativeFloor() {
    XCTAssertEqual(ChunkKey.from(worldX: -1, worldY: 0, chunkEdge: 4096), ChunkKey(x: -1, y: 0))
    XCTAssertEqual(ChunkKey.from(worldX: 0, worldY: 0, chunkEdge: 4096), ChunkKey(x: 0, y: 0))
    XCTAssertEqual(ChunkKey.from(worldX: 4096, worldY: 0, chunkEdge: 4096), ChunkKey(x: 1, y: 0))
  }

  func testLongStrokeCrossesChunks() {
    let b = WorldBounds(minX: -100, minY: 0, maxX: 9000, maxY: 10)
    let keys = b.chunkKeys(chunkEdge: 4096)
    XCTAssertEqual(Set(keys), Set([ChunkKey(x: -1, y: 0), ChunkKey(x: 0, y: 0), ChunkKey(x: 1, y: 0), ChunkKey(x: 2, y: 0)]))
  }

  // ── Camera: focal pinch keeps the anchor under the finger across huge zoom ──
  func testFocalPinchKeepsAnchor() {
    var cam = CameraState(centerX: 1_000_000_000_000, centerY: -2_000_000_000_000, zoom: 0.125)
    let fx = 300.0, fy = 200.0, cx = 512.0, cy = 384.0
    let (ax0, ay0) = CameraMath.screenToWorld(cam, sx: fx, sy: fy, cx: cx, cy: cy)
    cam = CameraMath.zoomAroundFocal(cam, pinchScale: 1000, fx: fx, fy: fy, cx: cx, cy: cy)
    let (ax1, ay1) = CameraMath.screenToWorld(cam, sx: fx, sy: fy, cx: cx, cy: cy)
    XCTAssertEqual(ax0, ax1, accuracy: abs(ax0) * 1e-9 + 1e-3)
    XCTAssertEqual(ay0, ay1, accuracy: abs(ay0) * 1e-9 + 1e-3)
  }

  func testLogZoomInterpolationMidpoint() {
    XCTAssertEqual(CameraMath.interpolateZoomLog(1, 100, 0.5), 10, accuracy: 1e-9)
  }

  // ── Timeline determinism + ping-pong ──
  func testPingPongSequenceNoDuplicateEndpoints() {
    let vs = (0..<3).map { Viewpoint(id: "v\($0)", label: "", centerX: Double($0), centerY: 0, zoom: 1,
                                     holdMilliseconds: 0, durationToNextMilliseconds: 1000, easing: .linear) }
    let seq = TimelineEvaluator.sequence(vs, loop: .pingPong).map { $0.id }
    XCTAssertEqual(seq, ["v0", "v1", "v2", "v1"])
  }

  func testTimelineDeterministic() {
    let vs = [
      Viewpoint(id: "a", label: "", centerX: 0, centerY: 0, zoom: 1, holdMilliseconds: 0, durationToNextMilliseconds: 1000, easing: .linear),
      Viewpoint(id: "b", label: "", centerX: 100, centerY: 0, zoom: 4, holdMilliseconds: 0, durationToNextMilliseconds: 0, easing: .linear),
    ]
    let c1 = TimelineEvaluator.camera(vs, loop: .once, timeMs: 500)!
    let c2 = TimelineEvaluator.camera(vs, loop: .once, timeMs: 500)!
    XCTAssertEqual(c1.centerX, c2.centerX)
    XCTAssertEqual(c1.centerX, 50, accuracy: 1e-9)          // linear midpoint
    XCTAssertEqual(c1.zoom, 2, accuracy: 1e-9)              // log midpoint of 1..4
  }

  // ── Mac v4 migration ──
  func testMigrateVectorProject() throws {
    let json: [String: Any] = [
      "mode": "vector",
      "strokes": [
        ["id": "s1", "emoji": "😀", "worldSize": 21.0, "size": 42.0,
         "points": [["x": 0.0, "y": 0.0, "t": 0.0], ["x": 5000.0, "y": 10.0, "t": 5.0]]],
      ],
    ]
    let result = try MacV4Migration.migrate(json, now: "2026-07-20T00:00:00Z")
    XCTAssertEqual(result.strokes.count, 1)
    let s = result.strokes[0]
    XCTAssertEqual(s.brush.widthMode, .worldConstant)
    XCTAssertEqual(s.brush.worldSize, 21.0, accuracy: 1e-9)
    XCTAssertTrue(s.chunkRefs.contains(ChunkKey(x: 0, y: 0)))
    XCTAssertTrue(s.chunkRefs.contains(ChunkKey(x: 1, y: 0)))   // crosses into chunk 1
  }

  func testRasterProjectRejected() {
    XCTAssertThrowsError(try MacV4Migration.migrate(["mode": "raster"], now: "x"))
  }

  func testMissingWorldSizeDerivesAndWarns() throws {
    let json: [String: Any] = [
      "mode": "vector",
      "strokes": [["id": "s", "emoji": "x", "size": 30.0, "points": [["x": 0.0, "y": 0.0, "t": 0.0]]]],
    ]
    let r = try MacV4Migration.migrate(json, now: "x")
    XCTAssertEqual(r.strokes[0].brush.worldSize, 30.0, accuracy: 1e-9)
    XCTAssertFalse(r.warnings.isEmpty)
  }

  func testNonFiniteSamplesRejected() throws {
    let json: [String: Any] = [
      "mode": "vector",
      "strokes": [["id": "s", "emoji": "x", "size": 10.0,
                   "points": [["x": Double.nan, "y": 0.0, "t": 0.0], ["x": 1.0, "y": 1.0, "t": 1.0]]]],
    ]
    let r = try MacV4Migration.migrate(json, now: "x")
    XCTAssertEqual(r.strokes[0].samples.count, 1)   // NaN sample dropped
  }
}
