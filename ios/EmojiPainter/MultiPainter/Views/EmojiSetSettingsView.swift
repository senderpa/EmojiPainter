//
//  EmojiSetSettingsView.swift
//  MultiPainter
//
//  Lets the user switch the emoji art set used for painting (Apple, Custom,
//  Android/Noto, OpenMoji, Twemoji), fine-tune the per-set size, install sets
//  for offline use, and import their own from Files or a manifest URL.
//

import SwiftUI
import UniformTypeIdentifiers

struct EmojiSetSettingsView: View {
    @ObservedObject private var manager = EmojiSetManager.shared
    @Environment(\.dismiss) private var dismiss

    @State private var showFolderImporter = false
    @State private var manifestURL = ""
    @State private var importMessage: String?
    @State private var prefetching: String?            // set id currently prefetching
    @State private var prefetchProgress: Double = 0

    // A few representative emoji to preview each set's look.
    private let sampleEmojis = ["😀", "❤️", "🔥", "🎨", "👍", "🌈"]

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color.black, Color(white: 0.08)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    header

                    Text("Choose how painted emojis look. Each set is sized to match — nudge the slider if one looks off.")
                        .appFont(13)
                        .foregroundColor(.white.opacity(0.6))

                    ForEach(manager.sets) { set in
                        setCard(set)
                    }

                    importSection

                    if let importMessage {
                        Text(importMessage)
                            .appFont(12)
                            .foregroundColor(.white.opacity(0.7))
                    }
                }
                .padding(24)
            }
        }
        .fileImporter(isPresented: $showFolderImporter,
                      allowedContentTypes: [.folder],
                      allowsMultipleSelection: false) { result in
            handleFolderImport(result)
        }
    }

    private var header: some View {
        HStack {
            EmojiLabel("🎭 Emoji Set", size: 22, weight: .bold, color: .white)
            Spacer()
            Button(action: { dismiss() }) {
                Image(systemName: "xmark.circle.fill")
                    .appFont(26)
                    .foregroundColor(.white.opacity(0.7))
            }
        }
    }

    // MARK: - Set card

    @ViewBuilder
    private func setCard(_ set: EmojiSetDescriptor) -> some View {
        let isActive = set.id == manager.activeSetId
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(set.name)
                        .appFont(17, weight: .semibold)
                        .foregroundColor(isActive ? .purple : .white)
                    if let attribution = set.attribution {
                        Text(attribution)
                            .appFont(11)
                            .foregroundColor(.white.opacity(0.45))
                    }
                }
                Spacer()
                if isActive {
                    Image(systemName: "checkmark.circle.fill")
                        .appFont(22).foregroundColor(.purple)
                } else {
                    Button("Use") { manager.setActive(set.id) }
                        .appFont(14, weight: .semibold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(Capsule().fill(Color.purple.opacity(0.5)))
                }
            }

            // Live preview of this set's art.
            HStack(spacing: 10) {
                ForEach(sampleEmojis, id: \.self) { e in
                    SetPreviewEmoji(emoji: e, set: set, size: 34)
                }
            }

            // Per-set size fine-tune (only meaningful for the active set's effect).
            if isActive {
                HStack(spacing: 10) {
                    Image(systemName: "textformat.size.smaller").foregroundColor(.white.opacity(0.5))
                    Slider(value: Binding(
                        get: { Double(manager.sizeScale(for: set)) },
                        set: { manager.setSizeScale(CGFloat($0), for: set.id) }
                    ), in: 0.6...1.8, step: 0.02)
                    .tint(.purple)
                    Image(systemName: "textformat.size.larger").foregroundColor(.white.opacity(0.5))
                    Text(String(format: "%.2f×", manager.sizeScale(for: set)))
                        .appFont(12).foregroundColor(.white.opacity(0.7)).frame(width: 46)
                }
            }

            // Install (offline prefetch) for remote sets + remove for imported.
            HStack(spacing: 12) {
                if set.kind == .remote {
                    if prefetching == set.id {
                        ProgressView(value: prefetchProgress)
                            .tint(.purple)
                        Text("\(Int(prefetchProgress * 100))%")
                            .appFont(11).foregroundColor(.white.opacity(0.6))
                    } else {
                        Button(action: { prefetch(set) }) {
                            Label("Install offline", systemImage: "arrow.down.circle")
                                .appFont(13, weight: .semibold)
                                .foregroundColor(.white.opacity(0.85))
                        }
                    }
                }
                Spacer()
                if isImported(set) {
                    Button(action: { manager.removeSet(set.id) }) {
                        Image(systemName: "trash").foregroundColor(.red.opacity(0.7))
                    }
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(isActive ? 0.10 : 0.05))
                .overlay(RoundedRectangle(cornerRadius: 16)
                    .stroke(isActive ? Color.purple : Color.clear, lineWidth: 2))
        )
    }

    // MARK: - Import

    private var importSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add your own set")
                .appFont(15, weight: .semibold).foregroundColor(.white.opacity(0.8))

            Button(action: { showFolderImporter = true }) {
                Label("Import from Files (folder)", systemImage: "folder")
                    .appFont(14, weight: .semibold).foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.08)))
            }

            HStack(spacing: 8) {
                TextField("Paste set manifest URL…", text: $manifestURL)
                    .appFont(13).foregroundColor(.white)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.08)))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                Button("Add") { importFromURL() }
                    .appFont(14, weight: .semibold).foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Capsule().fill(Color.purple.opacity(0.6)))
            }

            Text("Folder: PNG/WebP files named by code point (e.g. 1F600.png) + optional set.json. URL: a JSON manifest {id,name,scheme,baseURL,ext,defaultSizeScale}.")
                .appFont(11).foregroundColor(.white.opacity(0.4))
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.05)))
    }

    private func isImported(_ set: EmojiSetDescriptor) -> Bool {
        EmojiSetManager.builtInSets().first(where: { $0.id == set.id }) == nil
    }

    private func prefetch(_ set: EmojiSetDescriptor) {
        prefetching = set.id
        prefetchProgress = 0
        manager.prefetchAll(set: set, progress: { p in prefetchProgress = p }, done: {
            prefetching = nil
            importMessage = "\(set.name) installed for offline use."
        })
    }

    private func importFromURL() {
        let url = manifestURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        importMessage = "Importing…"
        manager.importFromManifestURL(url) { result in
            switch result {
            case .success(let desc):
                importMessage = "Added “\(desc.name)”."
                manifestURL = ""
            case .failure(let err):
                importMessage = "Import failed: \(err.localizedDescription)"
            }
        }
    }

    private func handleFolderImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let folder = urls.first else { return }
            manager.importFromFolder(folder) { res in
                switch res {
                case .success(let desc): importMessage = "Imported “\(desc.name)”."
                case .failure(let err): importMessage = "Import failed: \(err.localizedDescription)"
                }
            }
        case .failure(let err):
            importMessage = "Import failed: \(err.localizedDescription)"
        }
    }
}

/// Renders a single emoji using a SPECIFIC set's art (for set previews),
/// re-rendering as remote art finishes downloading.
private struct SetPreviewEmoji: View {
    let emoji: String
    let set: EmojiSetDescriptor
    let size: CGFloat
    @ObservedObject private var manager = EmojiSetManager.shared

    var body: some View {
        Group {
            if let image = manager.image(for: emoji, in: set) {
                Image(uiImage: image).resizable().interpolation(.high).scaledToFit()
            } else {
                Text(emoji).font(.system(size: size))   // system glyph / not-yet-downloaded
            }
        }
        .frame(width: size, height: size)
    }
}
