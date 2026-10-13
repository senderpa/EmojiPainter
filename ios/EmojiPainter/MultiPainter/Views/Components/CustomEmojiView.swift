//
//  CustomEmojiView.swift
//  MultiPainter
//
//  Drop-in replacement for `Text(emoji)`: shows the custom emoji art and, on
//  tap, briefly reveals the ORIGINAL system emoji for 0.3s before flipping back.
//
//  Usage:
//      CustomEmojiView("👍", size: 36)            // tappable reveal (default)
//      CustomEmojiView(player.emoji, size: 28, revealOnTap: false)  // static art
//
//  If no custom art exists for the emoji, it falls back to the system glyph so
//  nothing ever renders blank.
//

import SwiftUI

struct CustomEmojiView: View {
    let emoji: String
    let size: CGFloat
    /// When true, tapping flips to the original system emoji for `revealDuration`.
    var revealOnTap: Bool = true
    /// How long the original system emoji stays visible after a tap.
    var revealDuration: Double = 0.3

    @State private var showingOriginal = false
    /// Re-render when the active set changes or new art finishes downloading.
    @ObservedObject private var emojiSets = EmojiSetManager.shared

    init(_ emoji: String, size: CGFloat, revealOnTap: Bool = true, revealDuration: Double = 0.3) {
        self.emoji = emoji
        self.size = size
        self.revealOnTap = revealOnTap
        self.revealDuration = revealDuration
    }

    var body: some View {
        Group {
            if showingOriginal {
                // Original system emoji.
                Text(emoji)
                    .font(.system(size: size))
                    .frame(width: size, height: size)
                    .transition(.scale.combined(with: .opacity))
            } else if let image = emojiSets.image(for: emoji) {
                // Active set's art (bundled custom, or downloaded Android/OpenMoji/etc).
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: size, height: size)
                    .transition(.scale.combined(with: .opacity))
            } else {
                // No custom art for this emoji -> system glyph.
                Text(emoji)
                    .font(.system(size: size))
                    .frame(width: size, height: size)
            }
        }
        .contentShape(Rectangle())
        .modifier(RevealTapModifier(enabled: revealOnTap && emojiSets.hasImage(for: emoji),
                                    showingOriginal: $showingOriginal,
                                    duration: revealDuration))
    }
}

/// Renders an arbitrary string with every supported emoji swapped for custom
/// art INLINE (e.g. "🎨 MultiPainter", "🏆 Lifetime Stats"), each tappable to
/// reveal the original system emoji for 0.3s. Text runs keep the app font.
///
/// Use this anywhere a label/button currently hardcodes emoji in its text:
///     EmojiLabel("🎨 MultiPainter", size: 28, weight: .bold, color: .white)
///
/// Single-line oriented (titles, buttons, short labels) — for long wrapping
/// body text prefer plain Text.
struct EmojiLabel: View {
    let text: String
    var size: CGFloat = 17
    var weight: Font.Weight = .regular
    /// nil = inherit the surrounding foreground color (don't override).
    var color: Color? = nil
    var revealOnTap: Bool = true
    var spacing: CGFloat = 1

    init(_ text: String, size: CGFloat = 17, weight: Font.Weight = .regular,
         color: Color? = nil, revealOnTap: Bool = true, spacing: CGFloat = 1) {
        self.text = text
        self.size = size
        self.weight = weight
        self.color = color
        self.revealOnTap = revealOnTap
        self.spacing = spacing
    }

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
                if run.isEmoji {
                    CustomEmojiView(run.text, size: size, revealOnTap: revealOnTap)
                } else {
                    styledText(run.text)
                }
            }
        }
    }

    @ViewBuilder
    private func styledText(_ s: String) -> some View {
        if let color {
            Text(s).appFont(size, weight: weight).foregroundColor(color)
        } else {
            Text(s).appFont(size, weight: weight)
        }
    }

    /// Split the string into consecutive runs of emoji-art vs plain text.
    private var runs: [(text: String, isEmoji: Bool)] {
        var result: [(String, Bool)] = []
        for ch in text {
            let isE = EmojiSetManager.shared.hasImage(for: String(ch))
            if let last = result.last, last.1 == isE {
                result[result.count - 1].0 += String(ch)
            } else {
                result.append((String(ch), isE))
            }
        }
        return result.map { (text: $0.0, isEmoji: $0.1) }
    }
}

/// Adds a tap gesture that toggles `showingOriginal` for `duration` seconds.
/// Kept as a modifier so it composes without swallowing parent gestures when
/// the reveal is disabled (e.g. inside a Button cell).
private struct RevealTapModifier: ViewModifier {
    let enabled: Bool
    @Binding var showingOriginal: Bool
    let duration: Double

    func body(content: Content) -> some View {
        if enabled {
            content.onTapGesture {
                withAnimation(.easeInOut(duration: 0.15)) { showingOriginal = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
                    withAnimation(.easeInOut(duration: 0.15)) { showingOriginal = false }
                }
            }
        } else {
            content
        }
    }
}
