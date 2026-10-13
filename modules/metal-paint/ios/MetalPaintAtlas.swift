import Foundation
import UIKit
import Metal
import MetalKit

/// A cached atlas texture plus where the actual glyph ink sits inside it (normalized 0..1).
/// A plane commit crops to `inkU0...inkV1` instead of the full 0..1 bitmap so the visible pictograph
/// — not the transparent margin most emoji/PNG assets are rendered with — is what fills the quad.
struct MPAtlasEntry {
  let texture: MTLTexture
  let inkU0: Float
  let inkV0: Float
  let inkU1: Float
  let inkV1: Float
}

/// Emoji / custom-PNG → MTLTexture LRU cache. Copied from the export engine's EmojiAtlas (renamed to
/// avoid a duplicate-symbol clash between the two static-framework pods).
final class MetalPaintAtlas {
  private let device: MTLDevice
  private var textureCache: [String: MPAtlasEntry] = [:]
  private var textureLRU: [String] = []
  private let maxTextureCache = 220
  // Smudge tiles are captured canvas pixels, not glyphs — no ink bounds to measure, so they get
  // their own plain MTLTexture cache instead of sharing textureCache's MPAtlasEntry value type.
  private var smudgeTextureCache: [String: MTLTexture] = [:]
  private var smudgeTextureLRU: [String] = []
  private let lock = NSLock()
  private var memoryWarningObserver: NSObjectProtocol?

  init(device: MTLDevice) {
    self.device = device
    memoryWarningObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didReceiveMemoryWarningNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.clearCaches()
    }
  }

  deinit {
    if let observer = memoryWarningObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  func getTexture(for emoji: String, size: CGFloat) -> MTLTexture? {
    getEntry(for: emoji, size: size)?.texture
  }

  /// Same cache as getTexture(), but also returns the measured ink bounds — for plane rendering,
  /// which needs to crop out whatever transparent margin the source asset was drawn with.
  func getEntry(for emoji: String, size: CGFloat) -> MPAtlasEntry? {
    lock.lock()
    defer { lock.unlock() }
    let key = "\(emoji)_\(Int(size))"
    if let cached = textureCache[key] {
      updateLRU(key)
      return cached
    }
    guard let image = renderEmoji(emoji: emoji, size: size),
          let cgImage = image.cgImage,
          let texture = createTexture(from: image) else {
      return nil
    }
    let ink = Self.measureInkBounds(cgImage)
    let entry = MPAtlasEntry(texture: texture, inkU0: ink.u0, inkV0: ink.v0, inkU1: ink.u1, inkV1: ink.v1)
    textureCache[key] = entry
    textureLRU.append(key)
    if textureLRU.count > maxTextureCache {
      let oldest = textureLRU.removeFirst()
      textureCache.removeValue(forKey: oldest)
    }
    return entry
  }

  /// Tight alpha bounding box of the drawn glyph/PNG within its own bitmap, as a UV rect (0..1),
  /// expanded by a small margin proportional to the ink box's OWN size.
  ///
  /// This replaces a hand-tuned single crop constant. A flat inset applied to the whole bitmap only
  /// matches Skia's preview for whichever one emoji it was calibrated against — a "family" glyph and
  /// a "building" glyph do not fill their em-box by the same amount, so one constant is wrong for
  /// most emoji. Measuring the actual rendered ink is self-correcting per glyph instead of guessing.
  private static func measureInkBounds(_ image: CGImage) -> (u0: Float, v0: Float, u1: Float, v1: Float) {
    let w = image.width, h = image.height
    guard w > 0, h > 0 else { return (0, 0, 1, 1) }
    var pixels = [UInt8](repeating: 0, count: w * h * 4)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
      data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
      space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return (0, 0, 1, 1) }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))

    var minX = w, maxX = -1, minY = h, maxY = -1
    let alphaThreshold: UInt8 = 8 // ignores faint anti-aliasing fringe, not real ink
    for y in 0..<h {
      let rowBase = y * w * 4
      for x in 0..<w where pixels[rowBase + x * 4 + 3] > alphaThreshold {
        if x < minX { minX = x }
        if x > maxX { maxX = x }
        if y < minY { minY = y }
        if y > maxY { maxY = y }
      }
    }
    guard maxX >= minX, maxY >= minY else { return (0, 0, 1, 1) }

    // Small breathing room around the tight ink box, sized RELATIVE TO THE INK ITSELF — not the full
    // bitmap — so a glyph that already fills most of its bitmap and one that doesn't both end up with
    // a proportionally similar margin, matching how Skia's crop looks across different emoji shapes.
    let marginFrac: Float = 0.09
    let inkW = Float(maxX - minX + 1), inkH = Float(maxY - minY + 1)
    let mx = inkW * marginFrac, my = inkH * marginFrac
    let fw = Float(w), fh = Float(h)
    let u0 = max(0, Float(minX) - mx) / fw
    let u1 = min(fw, Float(maxX + 1) + mx) / fw
    let v0 = max(0, Float(minY) - my) / fh
    let v1 = min(fh, Float(maxY + 1) + my) / fh
    return (u0, v0, u1, v1)
  }

  private func renderEmoji(emoji: String, size: CGFloat) -> UIImage? {
    if emoji.hasPrefix("data:image/png;base64,") {
      return decodeBase64PNG(emoji, size: size)
    }
    let rect = CGRect(x: 0, y: 0, width: size, height: size)
    let renderer = UIGraphicsImageRenderer(size: rect.size)
    return renderer.image { _ in
      let paragraphStyle = NSMutableParagraphStyle()
      paragraphStyle.alignment = .center
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(ofSize: size * 0.8),
        .paragraphStyle: paragraphStyle
      ]
      let textRect = CGRect(x: 0, y: size * 0.1, width: size, height: size)
      emoji.draw(in: textRect, withAttributes: attributes)
    }
  }

  private func decodeBase64PNG(_ base64Data: String, size: CGFloat) -> UIImage? {
    let base64Only = base64Data.replacingOccurrences(of: "data:image/png;base64,", with: "")
    guard let imageData = Data(base64Encoded: base64Only),
          let originalImage = UIImage(data: imageData) else {
      return nil
    }
    let rect = CGRect(x: 0, y: 0, width: size, height: size)
    let renderer = UIGraphicsImageRenderer(size: rect.size)
    return renderer.image { context in
      UIColor.clear.setFill()
      context.fill(rect)
      let imageAspect = originalImage.size.width / max(originalImage.size.height, 0.0001)
      var drawRect = rect
      if imageAspect > 1 {
        drawRect.size.height = size / imageAspect
        drawRect.origin.y = (size - drawRect.size.height) / 2
      } else {
        drawRect.size.width = size * imageAspect
        drawRect.origin.x = (size - drawRect.size.width) / 2
      }
      originalImage.draw(in: drawRect)
    }
  }

  /// Texture for a baked smudge tile, keyed by stroke id. `ref` is EITHER an absolute file path
  /// (Documents/smudge_tiles/<id>.png — the new file-based store) OR a base64 PNG (old saved projects).
  /// Decoded once and cached.
  func getSmudgeTexture(id: String, base64 ref: String) -> MTLTexture? {
    lock.lock()
    defer { lock.unlock() }
    let key = "smudge::\(id)"
    if let cached = smudgeTextureCache[key] {
      if let index = smudgeTextureLRU.firstIndex(of: key) { smudgeTextureLRU.remove(at: index) }
      smudgeTextureLRU.append(key)
      return cached
    }
    // Smudge tiles are canvas pixels round-tripped through a PNG; load WITHOUT sRGB conversion so the
    // re-blitted tile matches the (non-sRGB) committed texture exactly (otherwise it looks darker).
    var image: UIImage? = nil
    if ref.hasPrefix("/"), FileManager.default.fileExists(atPath: ref) {
      image = UIImage(contentsOfFile: ref)                 // file-based tile
    } else if let data = Data(base64Encoded: ref) {
      image = UIImage(data: data)                          // legacy base64 tile
    }
    guard let img = image, let texture = createTexture(from: img, srgb: false) else {
      return nil
    }
    smudgeTextureCache[key] = texture
    smudgeTextureLRU.append(key)
    if smudgeTextureLRU.count > maxTextureCache {
      let oldest = smudgeTextureLRU.removeFirst()
      smudgeTextureCache.removeValue(forKey: oldest)
    }
    return texture
  }

  private func createTexture(from image: UIImage, srgb: Bool = true) -> MTLTexture? {
    guard let cgImage = image.cgImage else { return nil }
    let loader = MTKTextureLoader(device: device)
    return try? loader.newTexture(
      cgImage: cgImage,
      options: [
        .textureUsage: NSNumber(value: MTLTextureUsage.shaderRead.rawValue),
        .textureStorageMode: NSNumber(value: MTLStorageMode.shared.rawValue),
        .SRGB: NSNumber(value: srgb)
      ]
    )
  }

  private func updateLRU(_ key: String) {
    if let index = textureLRU.firstIndex(of: key) {
      textureLRU.remove(at: index)
    }
    textureLRU.append(key)
  }

  func clearCaches() {
    lock.lock()
    defer { lock.unlock() }
    textureCache.removeAll()
    textureLRU.removeAll()
    smudgeTextureCache.removeAll()
    smudgeTextureLRU.removeAll()
  }
}
