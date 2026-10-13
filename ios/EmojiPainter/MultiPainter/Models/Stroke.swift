//
//  Stroke.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation
import SwiftUI

/// A complete stroke composed of multiple segments
struct Stroke: Identifiable {
    let id = UUID()
    var segments: [StrokeSegment]
    let userId: Int
    let color: String  // hex or hsl
    let brushSize: Double

    var colorValue: Color {
        if color.hasPrefix(StrokeSegment.emojiPrefix) {
            return .white
        }
        return Color(hex: color)
    }
}

/// A single segment of a stroke (line from point A to B)
struct StrokeSegment: Identifiable {
    static let emojiPrefix = "emoji::"

    let id = UUID()
    let fromX: Double
    let fromY: Double
    let toX: Double
    let toY: Double
    let brushSize: Double
    let color: String

    var emojiBrush: String? {
        guard color.hasPrefix(Self.emojiPrefix) else { return nil }
        return String(color.dropFirst(Self.emojiPrefix.count))
    }

    static func encodedEmojiColor(_ emoji: String) -> String {
        "\(emojiPrefix)\(emoji)"
    }

    /// Convert to tile-local coordinates
    func toTileLocal(tileId: Int) -> (fromX: Double, fromY: Double, toX: Double, toY: Double) {
        let col = tileId % 2
        let row = tileId / 2
        let offsetX = Double(col) * 512.0
        let offsetY = Double(row) * 512.0

        return (
            fromX: fromX - offsetX,
            fromY: fromY - offsetY,
            toX: toX - offsetX,
            toY: toY - offsetY
        )
    }

    /// Check if segment intersects with a tile
    func intersects(tileId: Int) -> Bool {
        let col = tileId % 2
        let row = tileId / 2
        let minX = Double(col) * 512.0
        let maxX = minX + 512.0
        let minY = Double(row) * 512.0
        let maxY = minY + 512.0

        // Check if either endpoint is in tile
        let fromInTile = fromX >= minX && fromX < maxX && fromY >= minY && fromY < maxY
        let toInTile = toX >= minX && toX < maxX && toY >= minY && toY < maxY

        return fromInTile || toInTile
    }
}

// StrokeBroadcast is defined in MessageModels.swift
