import Foundation
import SceneKit
import UIKit
import simd

/// Persistence contract ported from AR Draw's MaskPaintStore. Paint is stored
/// in face-local space rather than as a flattened screenshot, so loading onto a
/// newly tracked face preserves placement, scale, colour, and surface choice.
struct FrontMaskSavedDecal: Codable, Equatable {
  let transform: [Float]
  let width: Float
  let height: Float
  let style: String
  let colorRGBA: [Float]
  let surface: String
  /// Tool-specific pixels. Merged Texture/Relief strokes store one flattened
  /// diffuse image for the whole drag instead of one PNG per dab.
  let texturePNG: Data?
  /// Optional tangent-space normal map for merged Texture/Relief strokes.
  /// Optional decoding keeps masks saved by older app versions compatible.
  let normalPNG: Data?
  /// Which drag this decal belonged to. Reloading regroups by this index so
  /// undo still steps one stroke at a time. Masks written before this field
  /// existed decode as nil and load as a single stroke.
  let strokeIndex: Int?

  init(transform: simd_float4x4, width: Float, height: Float,
       style: String, color: UIColor, surface: String, texturePNG: Data? = nil,
       normalPNG: Data? = nil, strokeIndex: Int? = nil) {
    self.transform = [
      transform.columns.0.x, transform.columns.0.y, transform.columns.0.z, transform.columns.0.w,
      transform.columns.1.x, transform.columns.1.y, transform.columns.1.z, transform.columns.1.w,
      transform.columns.2.x, transform.columns.2.y, transform.columns.2.z, transform.columns.2.w,
      transform.columns.3.x, transform.columns.3.y, transform.columns.3.z, transform.columns.3.w,
    ]
    self.width = width
    self.height = height
    self.style = style
    self.surface = surface
    self.texturePNG = texturePNG
    self.normalPNG = normalPNG
    self.strokeIndex = strokeIndex
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    colorRGBA = [Float(r), Float(g), Float(b), Float(a)]
  }

  var matrix: simd_float4x4? {
    guard transform.count == 16 else { return nil }
    return simd_float4x4(
      SIMD4<Float>(transform[0], transform[1], transform[2], transform[3]),
      SIMD4<Float>(transform[4], transform[5], transform[6], transform[7]),
      SIMD4<Float>(transform[8], transform[9], transform[10], transform[11]),
      SIMD4<Float>(transform[12], transform[13], transform[14], transform[15])
    )
  }

  var color: UIColor {
    guard colorRGBA.count == 4 else { return .white }
    return UIColor(red: CGFloat(colorRGBA[0]), green: CGFloat(colorRGBA[1]),
                   blue: CGFloat(colorRGBA[2]), alpha: CGFloat(colorRGBA[3]))
  }
}

struct FrontMaskSavedDocument: Codable, Equatable {
  let id: UUID
  var name: String
  var createdAt: Date
  var decals: [FrontMaskSavedDecal]
  /// AR Draw's fixed face-atlas bake. The base is retained so a saved mask has
  /// the exact webcam frame that became attached on its first painted stroke.
  var canvasPNG: Data?
  var canvasBasePNG: Data?

  init(id: UUID = UUID(), name: String, decals: [FrontMaskSavedDecal],
       canvasPNG: Data? = nil, canvasBasePNG: Data? = nil,
       createdAt: Date = Date()) {
    self.id = id
    self.name = name
    self.createdAt = createdAt
    self.decals = decals
    self.canvasPNG = canvasPNG
    self.canvasBasePNG = canvasBasePNG
  }
}

/// Local mask library. Its directory is deliberately separate from normal AR
/// scenes and from EmojiPainter projects, matching AR Draw's library boundary.
final class FrontMaskPaintStore {
  static let shared = FrontMaskPaintStore()
  static let autosaveName = "Autosave"

  private let root: URL
  private(set) var masks: [FrontMaskSavedDocument] = []

  init(root: URL? = nil) {
    let documents = FileManager.default.urls(for: .documentDirectory,
                                             in: .userDomainMask)[0]
    self.root = root ?? documents.appendingPathComponent("FrontCameraMasks", isDirectory: true)
    try? FileManager.default.createDirectory(at: self.root,
                                             withIntermediateDirectories: true)
    // Saved masks can contain a user-selected frozen front-camera texture.
    // Keep that library device-local: no iCloud backup, and protect it with
    // iOS data protection while the device is locked.
    try? (self.root as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
    try? FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: self.root.path)
    reload()
  }

  func thumbnailURL(for id: UUID) -> URL {
    root.appendingPathComponent("\(id.uuidString).jpg")
  }

  private func documentURL(for id: UUID) -> URL {
    root.appendingPathComponent("\(id.uuidString).json")
  }

  func reload() {
    guard let entries = try? FileManager.default.contentsOfDirectory(
      at: root, includingPropertiesForKeys: nil
    ) else {
      masks = []
      return
    }
    masks = entries
      .filter { $0.pathExtension == "json" }
      .compactMap { url in
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(FrontMaskSavedDocument.self, from: data)
      }
      .sorted { $0.createdAt > $1.createdAt }
  }

  @discardableResult
  func save(_ mask: FrontMaskSavedDocument, thumbnail: UIImage?) -> Bool {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(mask) else { return false }
    do {
      try data.write(to: documentURL(for: mask.id),
                     options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      if let jpeg = thumbnail?.jpegData(compressionQuality: 0.8) {
        try jpeg.write(to: thumbnailURL(for: mask.id),
                       options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      }
      reload()
      return true
    } catch {
      NSLog("[FrontMask] save failed: %@", error.localizedDescription)
      return false
    }
  }

  func delete(_ id: UUID) {
    try? FileManager.default.removeItem(at: documentURL(for: id))
    try? FileManager.default.removeItem(at: thumbnailURL(for: id))
    reload()
  }

  @discardableResult
  func duplicate(_ id: UUID) -> FrontMaskSavedDocument? {
    guard let source = masks.first(where: { $0.id == id }) else { return nil }
    let copy = FrontMaskSavedDocument(name: uniqueName(for: "\(source.name) Copy"),
                                      decals: source.decals,
                                      canvasPNG: source.canvasPNG,
                                      canvasBasePNG: source.canvasBasePNG)
    return save(copy, thumbnail: UIImage(contentsOfFile: thumbnailURL(for: id).path))
      ? copy : nil
  }

  var autosave: FrontMaskSavedDocument? {
    masks.first { $0.name == Self.autosaveName }
  }

  func storeAutosave(decals: [FrontMaskSavedDecal], canvasPNG: Data?,
                     canvasBasePNG: Data?, thumbnail: UIImage?) {
    guard !decals.isEmpty || canvasPNG != nil else { return }
    let mask = autosave.map {
      FrontMaskSavedDocument(id: $0.id, name: Self.autosaveName,
                             decals: decals, canvasPNG: canvasPNG,
                             canvasBasePNG: canvasBasePNG, createdAt: $0.createdAt)
    } ?? FrontMaskSavedDocument(name: Self.autosaveName, decals: decals,
                                canvasPNG: canvasPNG, canvasBasePNG: canvasBasePNG)
    _ = save(mask, thumbnail: thumbnail)
  }

  func clearAutosave() {
    guard let id = autosave?.id else { return }
    delete(id)
  }

  func suggestedName() -> String {
    let explicit = masks.filter { $0.name != Self.autosaveName }
    return "Mask \(explicit.count + 1)"
  }

  func metadata() -> [[String: Any]] {
    masks.map { mask in
      [
        "id": mask.id.uuidString,
        "name": mask.name,
        "createdAt": mask.createdAt.timeIntervalSince1970 * 1000,
        "markCount": mask.decals.count,
        "thumbnailPath": thumbnailURL(for: mask.id).absoluteString,
        "isAutosave": mask.name == Self.autosaveName,
      ]
    }
  }

  private func uniqueName(for proposed: String) -> String {
    let existing = Set(masks.map { $0.name.lowercased() })
    guard existing.contains(proposed.lowercased()) else { return proposed }
    var number = 2
    while existing.contains("\(proposed) \(number)".lowercased()) { number += 1 }
    return "\(proposed) \(number)"
  }
}
