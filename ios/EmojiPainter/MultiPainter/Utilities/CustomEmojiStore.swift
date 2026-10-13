//
//  CustomEmojiStore.swift
//  MultiPainter
//
//  Loads the bundled custom emoji art (WebP, 160px) and resolves an emoji
//  character to a UIImage. Used by CustomEmojiView (UI) and Tile (canvas).
//
//  Assets live in the `CustomEmoji` folder reference (blue folder) added to the
//  app target, alongside `emoji-index.json` mapping emoji -> file name.
//

import UIKit

final class CustomEmojiStore {

    static let shared = CustomEmojiStore()

    /// emoji character -> webp file name (e.g. "👍" -> "1F44D.webp")
    private let index: [String: String]
    private let cache = NSCache<NSString, UIImage>()
    private let folderName = "CustomEmoji"

    /// True when the bundled art loaded successfully.
    let isAvailable: Bool

    private init() {
        cache.countLimit = 1024
        guard
            let url = Bundle.main.url(forResource: "emoji-index",
                                      withExtension: "json",
                                      subdirectory: folderName)
                ?? Bundle.main.url(forResource: "emoji-index", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode([String: String].self, from: data)
        else {
            index = [:]
            isAvailable = false
            return
        }
        index = decoded
        isAvailable = !decoded.isEmpty
    }

    /// Whether a custom image exists for this emoji.
    func hasImage(for emoji: String) -> Bool {
        index[emoji] != nil || normalizedFile(for: emoji) != nil
    }

    /// The canonical list of supported emoji characters (used by other sets as
    /// the master character list for offline prefetching).
    func allEmojis() -> [String] {
        Array(index.keys)
    }

    /// Custom art for an emoji, lazily decoded + cached. nil if unsupported.
    func image(for emoji: String) -> UIImage? {
        if let cached = cache.object(forKey: emoji as NSString) { return cached }
        guard let file = index[emoji] ?? normalizedFile(for: emoji) else { return nil }
        let stem = (file as NSString).deletingPathExtension
        guard
            let url = Bundle.main.url(forResource: stem, withExtension: "webp",
                                      subdirectory: folderName)
                ?? Bundle.main.url(forResource: stem, withExtension: "webp"),
            let data = try? Data(contentsOf: url),
            let img = UIImage(data: data)
        else { return nil }
        cache.setObject(img, forKey: emoji as NSString)
        return img
    }

    /// Fallback match that tolerates a missing/extra FE0F variation selector.
    private func normalizedFile(for emoji: String) -> String? {
        if emoji.hasSuffix("\u{FE0F}") {
            return index[String(emoji.dropLast())]
        }
        return index[emoji + "\u{FE0F}"]
    }
}
