//
//  EmojiSetManager.swift
//  MultiPainter
//
//  Central registry + resolver for emoji "skins". Lets the user switch the
//  painted/preview emoji art between Apple (system glyph), the bundled Custom
//  WebP set, and downloadable art sets (Android/Noto, OpenMoji, Twemoji), plus
//  user-imported sets. Replaces direct use of `CustomEmojiStore.shared`.
//
//  Design notes:
//  - Built-in "apple"  -> system glyph (image(for:) returns nil; views fall back).
//  - Built-in "custom" -> existing bundled WebP via CustomEmojiStore.
//  - CDN sets          -> lazy per-emoji download from jsDelivr, cached on disk.
//  - Each set has a `sizeScale` so art sets (fill the box) and glyph sets (font
//    padding) can be tuned to the SAME visual size. Applied identically to the
//    live preview (NewCanvasView) and the painted stroke (Tile) so they match.
//

import UIKit
import Combine

// MARK: - Set model

enum EmojiSetKind: String, Codable {
    case system     // Apple system glyph (no images)
    case bundled    // shipped inside the app (CustomEmoji folder)
    case remote     // lazily downloaded from a CDN/base URL
}

/// How an emoji character maps to a file/URL name for a given source.
enum EmojiFilenameScheme: String, Codable {
    case index        // use the bundled emoji-index.json (custom set)
    case twemoji      // lowercase, "-" joined, drops FE0F (except keycaps)
    case openmoji     // UPPERCASE, "-" joined, keeps FE0F
    case noto         // "emoji_u" + lowercase, "_" joined, drops FE0F
    case plainLower   // lowercase, "-" joined, keeps all scalars
    case plainUpper   // UPPERCASE, "-" joined, keeps all scalars
}

struct EmojiSetDescriptor: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var kind: EmojiSetKind
    var scheme: EmojiFilenameScheme
    var baseURL: String?     // for .remote: e.g. ".../color/72x72/"
    var ext: String          // "png", "webp"
    var defaultSizeScale: CGFloat
    var attribution: String? // license/credit shown in settings

    static func == (a: EmojiSetDescriptor, b: EmojiSetDescriptor) -> Bool { a.id == b.id }
}

// MARK: - Manager

final class EmojiSetManager: ObservableObject {

    static let shared = EmojiSetManager()

    /// Bumped whenever new art finishes downloading so SwiftUI views re-render.
    @Published private(set) var revision: Int = 0
    /// The currently active set id (persisted).
    @Published private(set) var activeSetId: String

    /// All sets the user can pick: built-ins + curated remotes + imported.
    @Published private(set) var sets: [EmojiSetDescriptor]

    private let cache = NSCache<NSString, UIImage>()
    private let systemCache = NSCache<NSString, UIImage>()   // rasterized Apple glyphs
    private let defaults = UserDefaults.standard
    private let activeKey = "emoji_set_active_id"
    private let importedKey = "emoji_set_imported_v1"
    private let sizeOverrideKey = "emoji_set_size_overrides_v1"

    private var inFlight = Set<String>()           // emoji|setId currently downloading
    private let ioQueue = DispatchQueue(label: "emoji.set.io", qos: .utility)

    private init() {
        cache.countLimit = 2048
        activeSetId = defaults.string(forKey: activeKey) ?? "custom"
        sets = EmojiSetManager.builtInSets() + EmojiSetManager.loadImported(defaults)
        // Guard against a stale active id (e.g. an imported set was removed).
        if !sets.contains(where: { $0.id == activeSetId }) { activeSetId = "custom" }
    }

    // MARK: Active set

    var activeSet: EmojiSetDescriptor {
        sets.first(where: { $0.id == activeSetId }) ?? EmojiSetManager.builtInSets()[0]
    }

    func setActive(_ id: String) {
        guard sets.contains(where: { $0.id == id }) else { return }
        activeSetId = id
        defaults.set(id, forKey: activeKey)
        revision &+= 1
    }

    /// Effective size multiplier for a set (user override or descriptor default).
    func sizeScale(for set: EmojiSetDescriptor) -> CGFloat {
        if let overrides = sizeOverrides()[set.id] { return CGFloat(overrides) }
        return set.defaultSizeScale
    }

    var activeSizeScale: CGFloat { sizeScale(for: activeSet) }

    func setSizeScale(_ value: CGFloat, for id: String) {
        var o = sizeOverrides()
        o[id] = Double(max(0.4, min(2.5, value)))
        if let data = try? JSONEncoder().encode(o) { defaults.set(data, forKey: sizeOverrideKey) }
        revision &+= 1
    }

    private func sizeOverrides() -> [String: Double] {
        guard let data = defaults.data(forKey: sizeOverrideKey),
              let o = try? JSONDecoder().decode([String: Double].self, from: data) else { return [:] }
        return o
    }

    // MARK: Image resolution (used by CustomEmojiView + Tile)

    /// True when this set is expected to provide art for the emoji.
    func hasImage(for emoji: String, in set: EmojiSetDescriptor? = nil) -> Bool {
        let s = set ?? activeSet
        switch s.kind {
        case .system:  return false
        case .bundled: return CustomEmojiStore.shared.hasImage(for: emoji)
        case .remote:  return true   // assume the CDN has it; falls back if 404
        }
    }

    /// Synchronous art lookup for the active set. Returns nil for system glyph or
    /// when a remote image isn't downloaded yet (and kicks off a background fetch).
    func image(for emoji: String) -> UIImage? { image(for: emoji, in: activeSet) }

    /// Preview-only fine trim (per set) so the live preview matches the painted
    /// stamp exactly. `sizeScale` affects BOTH preview + paint; this affects only
    /// the live preview to absorb the scaledToFit vs draw(in:) difference.
    func previewScale(for set: EmojiSetDescriptor) -> CGFloat {
        switch set.id {
        case "custom": return 0.93   // bundled WebP preview reads ~7% large
        default:       return 1.0
        }
    }
    var activePreviewScale: CGFloat { previewScale(for: activeSet) }

    /// Rasterize the Apple system emoji into a CENTERED square that fills the box
    /// like the art sets — removes the glyph line-padding that made Apple look
    /// off-cursor and non-linearly sized.
    func systemImage(for emoji: String, px: CGFloat) -> UIImage? {
        let side = max(8, px.rounded())
        let key = "sys|\(emoji)|\(Int(side))" as NSString
        if let cached = systemCache.object(forKey: key) { return cached }

        // Fit the glyph to the square, then center by its measured size.
        let ns = emoji as NSString
        let probeSize = ns.size(withAttributes: [.font: UIFont.systemFont(ofSize: side)])
        let glyphMax = max(probeSize.width, probeSize.height)
        guard glyphMax > 0 else { return nil }

        let fitFont = UIFont.systemFont(ofSize: side * (side / glyphMax))
        let attrs: [NSAttributedString.Key: Any] = [.font: fitFont]
        let textSize = ns.size(withAttributes: attrs)

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        let img = renderer.image { _ in
            let origin = CGPoint(x: (side - textSize.width) / 2,
                                 y: (side - textSize.height) / 2)
            ns.draw(at: origin, withAttributes: attrs)
        }
        systemCache.setObject(img, forKey: key)
        return img
    }

    /// Same as `image(for:)` but for an explicit set (used for set previews).
    func image(for emoji: String, in set: EmojiSetDescriptor) -> UIImage? {
        switch set.kind {
        case .system:
            return systemImage(for: emoji, px: 180)   // centered, fills the box
        case .bundled:
            return CustomEmojiStore.shared.image(for: emoji)
        case .remote:
            let key = cacheKey(emoji, set.id) as NSString
            if let cached = cache.object(forKey: key) { return cached }
            if let img = loadFromDisk(emoji: emoji, set: set) {
                cache.setObject(img, forKey: key)
                return img
            }
            downloadIfNeeded(emoji: emoji, set: set)
            return nil
        }
    }

    // MARK: Remote download / cache

    private func cacheKey(_ emoji: String, _ setId: String) -> String { "\(setId)|\(emoji)" }

    private func setDir(_ set: EmojiSetDescriptor) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EmojiSets", isDirectory: true)
            .appendingPathComponent(set.id, isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func fileName(for emoji: String, set: EmojiSetDescriptor) -> String {
        Self.fileStem(for: emoji, scheme: set.scheme) + "." + set.ext
    }

    private func loadFromDisk(emoji: String, set: EmojiSetDescriptor) -> UIImage? {
        let url = setDir(set).appendingPathComponent(fileName(for: emoji, set: set))
        guard let data = try? Data(contentsOf: url), let img = UIImage(data: data) else { return nil }
        return img
    }

    private func downloadIfNeeded(emoji: String, set: EmojiSetDescriptor) {
        guard let base = set.baseURL, let remote = URL(string: base + fileName(for: emoji, set: set)) else { return }
        let key = cacheKey(emoji, set.id)
        ioQueue.async { [weak self] in
            guard let self else { return }
            if self.inFlight.contains(key) { return }
            self.inFlight.insert(key)
            URLSession.shared.dataTask(with: remote) { [weak self] data, resp, _ in
                guard let self else { return }
                self.ioQueue.async { self.inFlight.remove(key) }
                guard let data, let img = UIImage(data: data),
                      (resp as? HTTPURLResponse)?.statusCode ?? 200 < 400 else { return }
                // Persist + cache, then nudge the UI.
                let dest = self.setDir(set).appendingPathComponent(self.fileName(for: emoji, set: set))
                try? data.write(to: dest, options: .atomic)
                self.cache.setObject(img, forKey: key as NSString)
                DispatchQueue.main.async { self.revision &+= 1 }
            }.resume()
        }
    }

    /// Best-effort offline prefetch of an entire set, using the bundled emoji
    /// list as the canonical character set. Reports 0...1 progress on main.
    func prefetchAll(set: EmojiSetDescriptor, progress: @escaping (Double) -> Void, done: @escaping () -> Void) {
        guard set.kind == .remote else { progress(1); done(); return }
        let emojis = CustomEmojiStore.shared.allEmojis()
        guard !emojis.isEmpty else { progress(1); done(); return }
        ioQueue.async { [weak self] in
            guard let self else { return }
            let total = emojis.count
            var completed = 0
            let group = DispatchGroup()
            let sem = DispatchSemaphore(value: 8) // cap concurrency
            for emoji in emojis {
                if self.loadFromDisk(emoji: emoji, set: set) != nil {
                    completed += 1
                    DispatchQueue.main.async { progress(Double(completed) / Double(total)) }
                    continue
                }
                guard let base = set.baseURL,
                      let url = URL(string: base + self.fileName(for: emoji, set: set)) else {
                    completed += 1; continue
                }
                sem.wait(); group.enter()
                URLSession.shared.dataTask(with: url) { data, resp, _ in
                    if let data, UIImage(data: data) != nil,
                       (resp as? HTTPURLResponse)?.statusCode ?? 200 < 400 {
                        let dest = self.setDir(set).appendingPathComponent(self.fileName(for: emoji, set: set))
                        try? data.write(to: dest, options: .atomic)
                    }
                    completed += 1
                    DispatchQueue.main.async { progress(Double(completed) / Double(total)) }
                    sem.signal(); group.leave()
                }.resume()
            }
            group.wait()
            DispatchQueue.main.async { self.revision &+= 1; done() }
        }
    }

    // MARK: Import

    /// Import a set described by a small JSON manifest hosted at a URL.
    /// Manifest: {id,name,scheme,baseURL,ext,defaultSizeScale,attribution}
    func importFromManifestURL(_ urlString: String, completion: @escaping (Result<EmojiSetDescriptor, Error>) -> Void) {
        guard let url = URL(string: urlString) else {
            completion(.failure(NSError(domain: "emoji", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bad URL"]))); return
        }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, err in
            guard let self else { return }
            if let err { DispatchQueue.main.async { completion(.failure(err)) }; return }
            guard let data, var desc = try? JSONDecoder().decode(EmojiSetDescriptor.self, from: data) else {
                DispatchQueue.main.async {
                    completion(.failure(NSError(domain: "emoji", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid manifest"]))) }
                return
            }
            desc.kind = .remote
            DispatchQueue.main.async { self.addImported(desc); completion(.success(desc)) }
        }.resume()
    }

    /// Import a local folder (picked via Files) of images named by code points,
    /// with an optional `set.json` manifest inside for name/scheme/sizeScale.
    func importFromFolder(_ folder: URL, completion: (Result<EmojiSetDescriptor, Error>) -> Void) {
        let access = folder.startAccessingSecurityScopedResource()
        defer { if access { folder.stopAccessingSecurityScopedResource() } }
        let fm = FileManager.default
        let id = "import_" + folder.lastPathComponent.lowercased().replacingOccurrences(of: " ", with: "_")
        var desc = EmojiSetDescriptor(id: id, name: folder.lastPathComponent, kind: .remote,
                                      scheme: .plainUpper, baseURL: nil, ext: "png",
                                      defaultSizeScale: 1.0, attribution: "Imported")
        if let manifest = try? Data(contentsOf: folder.appendingPathComponent("set.json")),
           let m = try? JSONDecoder().decode(EmojiSetDescriptor.self, from: manifest) {
            desc.name = m.name; desc.scheme = m.scheme; desc.ext = m.ext
            desc.defaultSizeScale = m.defaultSizeScale
        }
        // Copy images into our Application Support dir so we own them permanently.
        let dest = setDir(desc)
        if let items = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
            for item in items where ["png", "webp"].contains(item.pathExtension.lowercased()) {
                let to = dest.appendingPathComponent(item.lastPathComponent)
                try? fm.removeItem(at: to)
                try? fm.copyItem(at: item, to: to)
            }
        }
        addImported(desc)
        completion(.success(desc))
    }

    private func addImported(_ desc: EmojiSetDescriptor) {
        var imported = EmojiSetManager.loadImported(defaults).filter { $0.id != desc.id }
        imported.append(desc)
        if let data = try? JSONEncoder().encode(imported) { defaults.set(data, forKey: importedKey) }
        sets = EmojiSetManager.builtInSets() + imported
        revision &+= 1
    }

    func removeSet(_ id: String) {
        guard EmojiSetManager.builtInSets().first(where: { $0.id == id }) == nil else { return } // can't remove built-ins
        let imported = EmojiSetManager.loadImported(defaults).filter { $0.id != id }
        if let data = try? JSONEncoder().encode(imported) { defaults.set(data, forKey: importedKey) }
        let dir = setDir(EmojiSetDescriptor(id: id, name: "", kind: .remote, scheme: .plainUpper,
                                            baseURL: nil, ext: "png", defaultSizeScale: 1, attribution: nil))
        try? FileManager.default.removeItem(at: dir)
        sets = EmojiSetManager.builtInSets() + imported
        if activeSetId == id { setActive("custom") }
        revision &+= 1
    }

    // MARK: Built-in catalog

    static func builtInSets() -> [EmojiSetDescriptor] {
        [
            EmojiSetDescriptor(id: "apple", name: "Apple", kind: .system, scheme: .plainLower,
                               baseURL: nil, ext: "png", defaultSizeScale: 0.92,
                               attribution: "Apple system emoji"),
            EmojiSetDescriptor(id: "custom", name: "Custom", kind: .bundled, scheme: .index,
                               baseURL: nil, ext: "webp", defaultSizeScale: 1.0,
                               attribution: "Bundled custom set"),
            EmojiSetDescriptor(id: "android", name: "Android (Noto)", kind: .remote, scheme: .noto,
                               baseURL: "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/png/72/",
                               ext: "png", defaultSizeScale: 1.0,
                               attribution: "Google Noto Emoji — Apache 2.0"),
            EmojiSetDescriptor(id: "openmoji", name: "OpenMoji", kind: .remote, scheme: .openmoji,
                               baseURL: "https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@latest/color/72x72/",
                               ext: "png", defaultSizeScale: 1.0,
                               attribution: "OpenMoji — CC BY-SA 4.0"),
            EmojiSetDescriptor(id: "twemoji", name: "Twemoji", kind: .remote, scheme: .twemoji,
                               baseURL: "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/",
                               ext: "png", defaultSizeScale: 1.0,
                               attribution: "Twemoji — CC-BY 4.0"),
        ]
    }

    private static func loadImported(_ defaults: UserDefaults) -> [EmojiSetDescriptor] {
        guard let data = defaults.data(forKey: "emoji_set_imported_v1"),
              let arr = try? JSONDecoder().decode([EmojiSetDescriptor].self, from: data) else { return [] }
        return arr
    }

    // MARK: Filename schemes

    /// Compute the file stem (no extension) for an emoji under a source scheme.
    static func fileStem(for emoji: String, scheme: EmojiFilenameScheme) -> String {
        let scalars = emoji.unicodeScalars
        let isKeycap = scalars.contains { $0.value == 0x20E3 }
        func hex(_ s: Unicode.Scalar, upper: Bool) -> String {
            String(format: upper ? "%04X" : "%04x", s.value)
        }
        switch scheme {
        case .twemoji:
            let parts = scalars.filter { isKeycap || $0.value != 0xFE0F }.map { hex($0, upper: false) }
            return parts.joined(separator: "-")
        case .openmoji:
            return scalars.map { hex($0, upper: true) }.joined(separator: "-")
        case .noto:
            let parts = scalars.filter { $0.value != 0xFE0F }.map { hex($0, upper: false) }
            return "emoji_u" + parts.joined(separator: "_")
        case .plainLower:
            return scalars.map { hex($0, upper: false) }.joined(separator: "-")
        case .plainUpper, .index:
            return scalars.map { hex($0, upper: true) }.joined(separator: "-")
        }
    }
}
