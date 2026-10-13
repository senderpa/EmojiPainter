import React
import Foundation
import UIKit
import Metal

/// LRU-cached emoji texture manager with 200 texture cache and 100 image cache
class EmojiAtlas {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue

    // LRU cache for textures (200 limit)
    private var textureCache: [String: CacheEntry<MTLTexture>] = [:]
    private var textureLRU: [String] = []
    private let maxTextureCache = 200

    // LRU cache for images (100 limit)
    private var imageCache: [String: CacheEntry<UIImage>] = [:]
    private var imageLRU: [String] = []
    private let maxImageCache = 100

    private let lock = NSLock()

    // CRITICAL FIX: Memory warning observer to prevent 50-100MB cache buildup
    private var memoryWarningObserver: NSObjectProtocol?

    struct CacheEntry<T> {
        let value: T
        var lastAccessed: Date
    }

    init(device: MTLDevice, commandQueue: MTLCommandQueue) {
        self.device = device
        self.commandQueue = commandQueue
        NSLog("[EmojiAtlas] Initialized with device: \(device.name)")

        // CRITICAL FIX: Register for memory warnings to clear caches (50-100MB savings)
        memoryWarningObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            NSLog("[EmojiAtlas] ⚠️ Memory warning received - clearing caches")
            self?.clearCaches()
        }
    }

    deinit {
        // Clean up memory warning observer
        if let observer = memoryWarningObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// Get or create a Metal texture for the given emoji
    func getTexture(for emoji: String, size: CGFloat) -> MTLTexture? {
        lock.lock()
        defer { lock.unlock() }

        let key = "\(emoji)_\(Int(size))"
        let isCustomBrush = emoji.hasPrefix("data:image/png;base64,")

        // Check texture cache
        if var entry = textureCache[key] {
            entry.lastAccessed = Date()
            textureCache[key] = entry
            updateLRU(&textureLRU, key: key)
            let typeLabel = isCustomBrush ? "custom_brush" : "emoji"
            NSLog("[EmojiAtlas] ✅ Texture cache hit for \(typeLabel) at size \(Int(size))")
            return entry.value
        }

        // Get or create image
        guard let image = getOrCreateImage(for: emoji, size: size) else {
            NSLog("[EmojiAtlas] ❌ Failed to create image for emoji: \(emoji)")
            return nil
        }

        // Create texture from image
        guard let texture = createTexture(from: image) else {
            let typeLabel = isCustomBrush ? "custom_brush" : "emoji"
            NSLog("[EmojiAtlas] ❌ Failed to create texture for \(typeLabel): \(emoji)")
            return nil
        }

        // Add to texture cache
        textureCache[key] = CacheEntry(value: texture, lastAccessed: Date())
        textureLRU.append(key)

        // Evict oldest if needed
        if textureLRU.count > maxTextureCache {
            let oldestKey = textureLRU.removeFirst()
            textureCache.removeValue(forKey: oldestKey)
            NSLog("[EmojiAtlas] Evicted texture from cache: \(oldestKey)")
        }

        let typeLabel = isCustomBrush ? "custom_brush" : "emoji"
        NSLog("[EmojiAtlas] ✅ Created texture for \(typeLabel)")
        return texture
    }

    /// Get or create a UIImage for the given emoji
    private func getOrCreateImage(for emoji: String, size: CGFloat) -> UIImage? {
        let key = "\(emoji)_\(Int(size))"
        let isCustomBrush = emoji.hasPrefix("data:image/png;base64,")

        // Check image cache
        if var entry = imageCache[key] {
            entry.lastAccessed = Date()
            imageCache[key] = entry
            updateLRU(&imageLRU, key: key)
            let typeLabel = isCustomBrush ? "custom_brush" : "emoji"
            NSLog("[EmojiAtlas] ✅ Cache hit for \(typeLabel) at size \(Int(size))")
            return entry.value
        }

        // Create new image
        let typeLabel = isCustomBrush ? "custom_brush" : "emoji"
        NSLog("[EmojiAtlas] 🔄 Creating \(typeLabel) image (size: \(Int(size)))")
        guard let image = renderEmoji(emoji: emoji, size: size) else {
            NSLog("[EmojiAtlas] ❌ Failed to render \(typeLabel)")
            return nil
        }

        // Add to image cache
        imageCache[key] = CacheEntry(value: image, lastAccessed: Date())
        imageLRU.append(key)

        // Evict oldest if needed
        if imageLRU.count > maxImageCache {
            let oldestKey = imageLRU.removeFirst()
            imageCache.removeValue(forKey: oldestKey)
            NSLog("[EmojiAtlas] Evicted image from cache: \(oldestKey)")
        }

        NSLog("[EmojiAtlas] ✅ Created and cached \(typeLabel)")
        return image
    }

    /// Render an emoji to a UIImage
    private func renderEmoji(emoji: String, size: CGFloat) -> UIImage? {
        // Check if this is a base64-encoded PNG (custom brush)
        if emoji.hasPrefix("data:image/png;base64,") {
            return decodeBase64PNG(emoji, size: size)
        }

        // Otherwise render as regular emoji text
        let rect = CGRect(x: 0, y: 0, width: size, height: size)
        let renderer = UIGraphicsImageRenderer(size: rect.size)

        let image = renderer.image { context in
            let paragraphStyle = NSMutableParagraphStyle()
            paragraphStyle.alignment = .center

            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: size * 0.8),
                .paragraphStyle: paragraphStyle
            ]

            let textRect = CGRect(x: 0, y: size * 0.1, width: size, height: size)
            emoji.draw(in: textRect, withAttributes: attributes)
        }

        return image
    }

    /// Decode and scale a base64-encoded PNG image
    private func decodeBase64PNG(_ base64Data: String, size: CGFloat) -> UIImage? {
        // Remove the data URI prefix
        let base64Only = base64Data.replacingOccurrences(of: "data:image/png;base64,", with: "")

        guard let imageData = Data(base64Encoded: base64Only) else {
            NSLog("[EmojiAtlas] Failed to decode base64 PNG data")
            return nil
        }

        guard let originalImage = UIImage(data: imageData) else {
            NSLog("[EmojiAtlas] Failed to create UIImage from PNG data")
            return nil
        }

        // Scale image to requested size while maintaining aspect ratio
        let rect = CGRect(x: 0, y: 0, width: size, height: size)
        let renderer = UIGraphicsImageRenderer(size: rect.size)

        let scaledImage = renderer.image { context in
            // Fill with transparent background
            UIColor.clear.setFill()
            context.fill(rect)

            // Calculate scaled size maintaining aspect ratio
            let imageAspect = originalImage.size.width / originalImage.size.height
            var drawRect = rect

            if imageAspect > 1 {
                // Image is wider than tall
                drawRect.size.height = size / imageAspect
                drawRect.origin.y = (size - drawRect.size.height) / 2
            } else {
                // Image is taller than wide (or square)
                drawRect.size.width = size * imageAspect
                drawRect.origin.x = (size - drawRect.size.width) / 2
            }

            originalImage.draw(in: drawRect)
        }

        NSLog("[EmojiAtlas] ✅ Decoded custom brush PNG (size: \(size)x\(size))")
        return scaledImage
    }

    /// Get (or create + cache) a texture for a baked smudge tile (a non-square PNG at native size).
    /// Keyed by stroke id; decoded once. Same loader path as custom brushes so orientation matches.
    func getSmudgeTexture(id: String, base64: String) -> MTLTexture? {
        lock.lock()
        defer { lock.unlock() }

        let key = "smudge::\(id)"
        if var entry = textureCache[key] {
            entry.lastAccessed = Date()
            textureCache[key] = entry
            updateLRU(&textureLRU, key: key)
            return entry.value
        }
        guard let data = Data(base64Encoded: base64), let image = UIImage(data: data) else {
            NSLog("[EmojiAtlas] ❌ Failed to decode smudge tile for \(id)")
            return nil
        }
        guard let texture = createTexture(from: image) else {
            return nil
        }
        textureCache[key] = CacheEntry(value: texture, lastAccessed: Date())
        textureLRU.append(key)
        if textureLRU.count > maxTextureCache {
            let oldestKey = textureLRU.removeFirst()
            textureCache.removeValue(forKey: oldestKey)
        }
        return texture
    }

    /// Create a Metal texture from a UIImage
    private func createTexture(from image: UIImage) -> MTLTexture? {
        guard let cgImage = image.cgImage else {
            return nil
        }

        let textureLoader = MTKTextureLoader(device: device)

        do {
            // Use .shared storage mode so we can read pixel data for Core Graphics rendering
            let texture = try textureLoader.newTexture(
                cgImage: cgImage,
                options: [
                    .textureUsage: NSNumber(value: MTLTextureUsage.shaderRead.rawValue),
                    .textureStorageMode: NSNumber(value: MTLStorageMode.shared.rawValue)
                ]
            )
            return texture
        } catch {
            NSLog("[EmojiAtlas] Failed to create texture: \(error)")
            return nil
        }
    }

    /// Update LRU list by moving key to end
    private func updateLRU(_ lru: inout [String], key: String) {
        if let index = lru.firstIndex(of: key) {
            lru.remove(at: index)
        }
        lru.append(key)
    }

    /// Clear all caches
    func clearCaches() {
        lock.lock()
        defer { lock.unlock() }

        textureCache.removeAll()
        textureLRU.removeAll()
        imageCache.removeAll()
        imageLRU.removeAll()

        NSLog("[EmojiAtlas] Cleared all caches")
    }

    /// Get cache statistics
    func getCacheStats() -> (textures: Int, images: Int) {
        lock.lock()
        defer { lock.unlock() }
        return (textureCache.count, imageCache.count)
    }
}

// Import MTKTextureLoader
import MetalKit
