import Foundation

// Versioned schema `emoji-painter.vector-document` v1 (DOCUMENT_SCHEMA.md).
// All world coordinates/dimensions/zoom are IEEE-754 Double.

public let vectorSchemaName = "emoji-painter.vector-document"
public let vectorSchemaVersion = 1

public struct VectorDocumentID: Codable, Hashable {
  public let value: String
  public init(_ value: String) { self.value = value }
  public init() { self.value = "vecdoc-\(UUID().uuidString)" }
}

public struct StrokeID: Codable, Hashable {
  public let value: String
  public init(_ value: String) { self.value = value }
}

public struct EmojiAssetID: Codable, Hashable {
  public let value: String
  public init(_ value: String) { self.value = value }
}

public enum WidthMode: String, Codable { case worldConstant, screenConstant }
public enum EasingKind: String, Codable { case linear, easeInOut, easeInOutCubic }
public enum LoopMode: String, Codable { case once, loop, pingPong }

/// Signed power-of-two chunk key (uniform grid; handoff §Chunking).
public struct ChunkKey: Codable, Hashable {
  public let x: Int
  public let y: Int
  public init(x: Int, y: Int) { self.x = x; self.y = y }
  public static func from(worldX: Double, worldY: Double, chunkEdge: Double) -> ChunkKey {
    ChunkKey(x: Int(floor(worldX / chunkEdge)), y: Int(floor(worldY / chunkEdge)))
  }
  /// Deterministic disk-path token, e.g. "-1_0".
  public var pathToken: String { "\(x)_\(y)" }
}

public struct WorldBounds: Codable, Equatable {
  public var minX: Double, minY: Double, maxX: Double, maxY: Double
  public init(minX: Double, minY: Double, maxX: Double, maxY: Double) {
    self.minX = minX; self.minY = minY; self.maxX = maxX; self.maxY = maxY
  }
  public func intersects(_ o: WorldBounds) -> Bool {
    maxX >= o.minX && minX <= o.maxX && maxY >= o.minY && minY <= o.maxY
  }
  public func inflated(by r: Double) -> WorldBounds {
    WorldBounds(minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r)
  }
  /// Every chunk key the bounds touch.
  public func chunkKeys(chunkEdge: Double) -> [ChunkKey] {
    let x0 = Int(floor(minX / chunkEdge)), x1 = Int(floor(maxX / chunkEdge))
    let y0 = Int(floor(minY / chunkEdge)), y1 = Int(floor(maxY / chunkEdge))
    var keys: [ChunkKey] = []
    var cx = x0
    while cx <= x1 { var cy = y0; while cy <= y1 { keys.append(ChunkKey(x: cx, y: cy)); cy += 1 }; cx += 1 }
    return keys
  }
}

public struct StrokeSample: Codable {
  public var x: Double
  public var y: Double
  public var timeMilliseconds: Double
  public var pressure: Double?
  public var altitudeRadians: Double?
  public var azimuthRadians: Double?
  public var rotationDegrees: Double
  public var opacity: Double
  public init(x: Double, y: Double, timeMilliseconds: Double, rotationDegrees: Double = 0, opacity: Double = 1,
              pressure: Double? = nil, altitudeRadians: Double? = nil, azimuthRadians: Double? = nil) {
    self.x = x; self.y = y; self.timeMilliseconds = timeMilliseconds
    self.rotationDegrees = rotationDegrees; self.opacity = opacity
    self.pressure = pressure; self.altitudeRadians = altitudeRadians; self.azimuthRadians = azimuthRadians
  }
}

public struct BrushStyle: Codable {
  public var screenSizeAtCreation: Double
  public var worldSize: Double
  public var widthMode: WidthMode
  public var opacity: Double
  public var spacingRatio: Double
  public var minimumSpacingRatio: Double
  public var rotationDegrees: Double
  public var mirrored: Bool
  public var randomSeed: Int
  public init(screenSizeAtCreation: Double, worldSize: Double, widthMode: WidthMode = .worldConstant,
              opacity: Double = 1, spacingRatio: Double = 0.12, minimumSpacingRatio: Double = 0.00001,
              rotationDegrees: Double = 0, mirrored: Bool = false, randomSeed: Int = 0) {
    self.screenSizeAtCreation = screenSizeAtCreation; self.worldSize = worldSize
    self.widthMode = widthMode; self.opacity = opacity; self.spacingRatio = spacingRatio
    self.minimumSpacingRatio = minimumSpacingRatio; self.rotationDegrees = rotationDegrees
    self.mirrored = mirrored; self.randomSeed = randomSeed
  }
}

public struct StrokeRecord: Codable {
  public var strokeID: StrokeID
  public var emojiAssetID: EmojiAssetID
  public var brush: BrushStyle
  public var startedAtMilliseconds: Double
  public var endedAtMilliseconds: Double
  public var worldBounds: WorldBounds
  public var samples: [StrokeSample]
  public var chunkRefs: [ChunkKey]
  public var revision: Int
}

public struct Viewpoint: Codable {
  public var id: String
  public var label: String
  public var centerX: Double
  public var centerY: Double
  public var zoom: Double
  public var holdMilliseconds: Double
  public var durationToNextMilliseconds: Double
  public var easing: EasingKind
}

public struct DocumentManifest: Codable {
  public var schema: String
  public var schemaVersion: Int
  public var documentID: VectorDocumentID
  public var createdAt: String
  public var updatedAt: String
  public var mode: String
  public var chunkEdge: Double
  public var defaultWidthMode: WidthMode
  public var rootGeneration: Int
  public var strokeOrder: [StrokeID]
  public var viewpoints: [Viewpoint]
  public var loopMode: LoopMode
}
