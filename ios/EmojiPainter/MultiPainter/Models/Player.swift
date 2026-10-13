//
//  Player.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation
import SwiftUI

struct Player: Identifiable, Codable {
    let id: Int  // userId
    var username: String
    var emoji: String
    var x: Double  // Global position 0-1024
    var y: Double  // Global position 0-1024
    var color: String  // hex or hsl format
    var lives: Int
    var isBot: Bool
    var iconScale: Double  // NEW: Icon size multiplier (1.0 = normal, grows over time)
    var isSpawning: Bool  // NEW: True during spawn animation (first 2 seconds)
    var alive: Bool  // NEW: Is entity alive
    var shieldUntil: Date?  // Shield end time (after being hit)

    enum CodingKeys: String, CodingKey {
        case id = "userId"
        case username
        case emoji
        case x
        case y
        case color
        case lives
        case isBot
        case iconScale
        case isSpawning
        case alive
    }

    // Default values for new fields
    init(id: Int, username: String, emoji: String, x: Double, y: Double, color: String, lives: Int, isBot: Bool, iconScale: Double = 1.0, isSpawning: Bool = false, alive: Bool = true, shieldUntil: Date? = nil) {
        self.id = id
        self.username = username
        self.emoji = emoji
        self.x = x
        self.y = y
        self.color = color
        self.lives = lives
        self.isBot = isBot
        self.iconScale = iconScale
        self.isSpawning = isSpawning
        self.alive = alive
        self.shieldUntil = shieldUntil
    }

    /// Check if player has active shield
    var isShielded: Bool {
        guard let until = shieldUntil else { return false }
        return Date() < until
    }

    /// Get SwiftUI Color from hex/hsl string
    var colorValue: Color {
        Color(hex: color)
    }

    /// Get current tile ID (0-3) based on position
    var currentTileId: Int {
        let col = Int(x / 512.0)
        let row = Int(y / 512.0)
        return row * 2 + col
    }

    /// Get tile-local coordinates (0-512)
    var tileLocalPosition: (x: Double, y: Double) {
        let tileX = x.truncatingRemainder(dividingBy: 512.0)
        let tileY = y.truncatingRemainder(dividingBy: 512.0)
        return (tileX, tileY)
    }
}

/// Player position update from server
struct PlayerPositionUpdate: Codable {
    let userId: Int
    let x: Double
    let y: Double
    let emoji: String
    let color: String
}

/// Player movement message to server
struct PlayerMoveMessage: Codable {
    var type = "player_move"
    let payload: PlayerMovePayload

    struct PlayerMovePayload: Codable {
        let x: Double
        let y: Double
        let brushSize: Double
    }
}
