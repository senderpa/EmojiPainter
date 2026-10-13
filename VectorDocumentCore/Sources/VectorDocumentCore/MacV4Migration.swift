import Foundation

// Mac `emoji-painter.v4` → vector-document v1 migration (DOCUMENT_SCHEMA.md
// §Migration rules). Reads Mac Stroke records, maps points to Double, maps
// worldSize → .worldConstant, derives bounds + chunk refs, assigns stable IDs.
// Raster projects are NEVER reinterpreted as vector.

public struct MigrationWarning { public let strokeIndex: Int; public let message: String }

public struct MigrationResult {
  public let manifest: DocumentManifest
  public let strokes: [StrokeRecord]
  public let warnings: [MigrationWarning]
}

public enum MacV4MigrationError: Error { case notVector, malformed(String) }

public enum MacV4Migration {
  /// `json` is the parsed Mac v4 project dictionary.
  public static func migrate(_ json: [String: Any], chunkEdge: Double = 4096, now: String) throws -> MigrationResult {
    let mode = (json["mode"] as? String) ?? (json["renderMode"] as? String) ?? "vector"
    if mode == "raster" { throw MacV4MigrationError.notVector }
    guard let macStrokes = json["strokes"] as? [[String: Any]] else {
      throw MacV4MigrationError.malformed("missing strokes array")
    }

    var warnings: [MigrationWarning] = []
    var records: [StrokeRecord] = []
    var order: [StrokeID] = []

    for (i, ms) in macStrokes.enumerated() {
      let emoji = (ms["emoji"] as? String) ?? (ms["emojiAssetID"] as? String) ?? "🙂"
      let rawPoints = (ms["points"] as? [[String: Any]]) ?? []
      var samples: [StrokeSample] = []
      for p in rawPoints {
        guard let x = doubleOf(p["x"]), let y = doubleOf(p["y"]), x.isFinite, y.isFinite else { continue }
        samples.append(StrokeSample(x: x, y: y, timeMilliseconds: doubleOf(p["t"]) ?? 0))
      }
      if samples.isEmpty { warnings.append(.init(strokeIndex: i, message: "no valid points; skipped")); continue }

      // Mac width: completed strokes are world-constant. Derive when missing.
      var worldSize = doubleOf(ms["worldSize"])
      let screenSize = doubleOf(ms["size"]) ?? 42
      if worldSize == nil || !(worldSize!.isFinite) || worldSize! <= 0 {
        worldSize = screenSize   // legacy: no camera context → size as world units
        warnings.append(.init(strokeIndex: i, message: "missing worldSize; derived from size"))
      }
      let ws = worldSize!
      let bounds = deriveBounds(samples, worldSize: ws)
      let strokeID = StrokeID((ms["id"] as? String) ?? "stroke-mig-\(i)")
      let brush = BrushStyle(
        screenSizeAtCreation: screenSize, worldSize: ws, widthMode: .worldConstant,
        opacity: doubleOf(ms["opacity"]) ?? 1,
        spacingRatio: doubleOf(ms["spacing"]) ?? 0.12,
        rotationDegrees: doubleOf(ms["rotation"]) ?? 0,
        mirrored: (ms["mirrorX"] as? Bool) ?? false,
        randomSeed: (ms["randomSeed"] as? Int) ?? 0
      )
      records.append(StrokeRecord(
        strokeID: strokeID, emojiAssetID: EmojiAssetID("mac:\(emoji)"), brush: brush,
        startedAtMilliseconds: samples.first?.timeMilliseconds ?? 0,
        endedAtMilliseconds: samples.last?.timeMilliseconds ?? 0,
        worldBounds: bounds, samples: samples,
        chunkRefs: bounds.chunkKeys(chunkEdge: chunkEdge), revision: 1
      ))
      order.append(strokeID)
    }

    let manifest = DocumentManifest(
      schema: vectorSchemaName, schemaVersion: vectorSchemaVersion, documentID: VectorDocumentID(),
      createdAt: now, updatedAt: now, mode: "vector", chunkEdge: chunkEdge,
      defaultWidthMode: .worldConstant, rootGeneration: 1, strokeOrder: order,
      viewpoints: migrateViewpoints(json), loopMode: .pingPong
    )
    return MigrationResult(manifest: manifest, strokes: records, warnings: warnings)
  }

  static func migrateViewpoints(_ json: [String: Any]) -> [Viewpoint] {
    guard let vps = (json["viewpoints"] as? [String: Any])?["items"] as? [[String: Any]]
      ?? json["keyframes"] as? [[String: Any]] else { return [] }
    return vps.enumerated().compactMap { (i, v) in
      let center = v["center"] as? [String: Any]
      guard let z = doubleOf(v["zoom"]) else { return nil }
      return Viewpoint(
        id: (v["id"] as? String) ?? "view-\(i)", label: (v["label"] as? String) ?? "View \(i + 1)",
        centerX: doubleOf(center?["x"]) ?? doubleOf(v["x"]) ?? 0,
        centerY: doubleOf(center?["y"]) ?? doubleOf(v["y"]) ?? 0,
        zoom: z, holdMilliseconds: doubleOf(v["holdMilliseconds"]) ?? 800,
        durationToNextMilliseconds: doubleOf(v["durationToNextMilliseconds"]) ?? 1800,
        easing: .easeInOut
      )
    }
  }

  static func deriveBounds(_ samples: [StrokeSample], worldSize: Double) -> WorldBounds {
    var minX = Double.infinity, minY = Double.infinity, maxX = -Double.infinity, maxY = -Double.infinity
    for s in samples {
      minX = min(minX, s.x); minY = min(minY, s.y); maxX = max(maxX, s.x); maxY = max(maxY, s.y)
    }
    return WorldBounds(minX: minX, minY: minY, maxX: maxX, maxY: maxY).inflated(by: worldSize / 2)
  }

  static func doubleOf(_ any: Any?) -> Double? {
    if let d = any as? Double { return d }
    if let i = any as? Int { return Double(i) }
    if let n = any as? NSNumber { return n.doubleValue }
    return nil
  }
}
