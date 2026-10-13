//
//  MessageModels.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation

// MARK: - Base Message Structure
struct WebSocketMessage: Codable {
    let type: String
    let payload: AnyCodable
}

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let string as String:
            try container.encode(string)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let bool as Bool:
            try container.encode(bool)
        default:
            try container.encodeNil()
        }
    }
}

// MARK: - Outgoing Messages
struct JoinMessage: Codable {
    var type = "viewer_join"
    let payload: JoinPayload

    struct JoinPayload: Codable {
        let username: String?
        let emoji: String?
    }
}

struct RequestGameSlotMessage: Codable {
    var type = "player_join"
    let payload: PlayerJoinPayload

    struct PlayerJoinPayload: Codable {
        let username: String
        let emoji: String
        let color: String
        let x: Double
        let y: Double
    }
}

struct StrokeSegmentMessage: Codable {
    var type = "player_stroke"
    let payload: StrokePayload

    struct StrokePayload: Codable {
        let tileId: Int
        let segment: SegmentData

        struct SegmentData: Codable {
            let localFromX: Double
            let localFromY: Double
            let localToX: Double
            let localToY: Double
            let brushSize: Double
            let color: String?  // hex color (omitted if emoji is set)
            let emoji: String?  // emoji character (if set, server ignores color)
            let emojiStyle: String?  // "ios" for Apple emojis, "android" for Twemoji (default: ios)

            enum CodingKeys: String, CodingKey {
                case localFromX
                case localFromY
                case localToX
                case localToY
                case brushSize
                case color
                case emoji
                case emojiStyle
            }

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(localFromX, forKey: .localFromX)
                try container.encode(localFromY, forKey: .localFromY)
                try container.encode(localToX, forKey: .localToX)
                try container.encode(localToY, forKey: .localToY)
                try container.encode(brushSize, forKey: .brushSize)
                // Only encode color if emoji is not set
                if emoji == nil {
                    try container.encode(color, forKey: .color)
                }
                // Only encode emoji if it's set
                if let emoji = emoji {
                    try container.encode(emoji, forKey: .emoji)
                    // When emoji is set, send emojiStyle to tell server which emoji style to use
                    try container.encode(emojiStyle ?? "ios", forKey: .emojiStyle)
                }
            }
        }
    }
}

struct ChatMessage: Codable {
    var type = "chat_message"
    let payload: ChatPayload

    struct ChatPayload: Codable {
        let text: String
    }
}

struct CursorMoveMessage: Codable {
    var type = "player_position"
    let payload: CursorPayload

    struct CursorPayload: Codable {
        let x: Double
        let y: Double
    }
}

struct AttackPlayerMessage: Codable {
    var type = "player_attack"
    let payload: AttackPayload

    struct AttackPayload: Codable {
        let targetUsername: String
        let x: Double
        let y: Double
        let brushSize: Double
    }
}

struct GetTilesMessage: Codable {
    var type = "get_tiles"
    let payload: EmptyPayload

    struct EmptyPayload: Codable {}
}

// MARK: - Incoming Messages
struct SessionInfo: Codable {
    let userId: Int
    let sessionId: Int
    let spawnX: Double
    let spawnY: Double
}

struct AllTilesState: Codable {
    let tiles: [TileData]

    struct TileData: Codable {
        let imageData: String
    }
}

struct TileState: Codable {
    let tileId: Int
    let imageData: String
}

struct StrokeBroadcast: Codable {
    let userId: Int
    let tileId: Int
    let segment: StrokeSegmentData

    struct StrokeSegmentData: Codable {
        let localFromX: Double
        let localFromY: Double
        let localToX: Double
        let localToY: Double
        let brushSize: Double
        let color: String?  // hex color (nil if emoji is set)
        let emoji: String?  // emoji character (if set, render emoji instead)
        let emojiStyle: String?  // "ios" for Apple emoji, "android" for Twemoji (optional, defaults to ios)
    }

    /// Convert to global coordinates StrokeSegment
    func toGlobalSegment() -> StrokeSegment {
        let col = tileId % 2
        let row = tileId / 2
        let offsetX = Double(col) * 512.0
        let offsetY = Double(row) * 512.0

        // Determine the color to use: emoji format if emoji is set, otherwise color
        let colorForSegment: String
        if let emoji = segment.emoji {
            colorForSegment = "emoji::\(emoji)"
        } else {
            colorForSegment = segment.color ?? "#000000"  // Default to black if no color
        }

        return StrokeSegment(
            fromX: segment.localFromX + offsetX,
            fromY: segment.localFromY + offsetY,
            toX: segment.localToX + offsetX,
            toY: segment.localToY + offsetY,
            brushSize: segment.brushSize,
            color: colorForSegment
        )
    }
}

struct LobbyState: Codable {
    let activePlayers: [Player]
    let bots: [Bot]

    struct Player: Codable, Identifiable {
        var id: Int { userId }
        let userId: Int
        let username: String
        let emoji: String
        let lives: Int
        let alive: Bool
        let isBot: Bool
        let x: Double?  // Position on canvas (if in-game)
        let y: Double?
        let color: String?  // Player color (hex or hsl)
        let iconScale: Double?  // NEW: Icon size multiplier (grows over time)
        let isSpawning: Bool?  // NEW: Spawn animation flag
        let isShielded: Bool?  // NEW: Shield status after being hit
    }

    struct Bot: Codable, Identifiable {
        var id: Int { userId }
        let userId: Int
        let username: String
        let emoji: String
        let lives: Int
        let alive: Bool
        let color: String
        let isBot: Bool
        let x: Double?  // Position on canvas (if in-game)
        let y: Double?
        let iconScale: Double?  // NEW: Icon size multiplier (grows over time)
        let isSpawning: Bool?  // NEW: Spawn animation flag
        let isShielded: Bool?  // NEW: Shield status after being hit
    }
}

struct CountdownUpdate: Codable {
    let activeTile: Int
    let tiles: [TileCountdown]

    struct TileCountdown: Codable, Identifiable {
        let id: Int
        let countdown: Int
        let isProcessing: Bool
    }
}

struct AIProcessingStart: Codable {
    let tileId: Int
}

struct AIComplete: Codable {
    let tileId: Int
    let path: String
    let cfgScale: Double
}

struct ChatBroadcast: Codable, Identifiable {
    var id: String { "\(userId)-\(timestamp)" }
    let userId: Int
    let username: String
    let emoji: String
    let text: String
    let timestamp: Int64
    let isBot: Bool
}

struct PlayerHit: Codable {
    let victim: String
    let killer: String
    let lives: Int
    let shieldDuration: Int?  // Shield duration in milliseconds
}

struct PlayerRespawn: Codable {
    let username: String
    let color: String
}

struct TileFrozenError: Codable {
    let tileId: Int
    let message: String
}

// MARK: - REST API Models
struct Profile: Codable, Identifiable {
    let id: Int
    let username: String
    let emoji: String
    let coins: Int
    let karma: Int
    let killCount: Int  // NEW: Track number of kills

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case emoji
        case coins
        case karma
        case killCount = "kill_count"
    }

    init(id: Int, username: String, emoji: String, coins: Int, karma: Int, killCount: Int = 0) {
        self.id = id
        self.username = username
        self.emoji = emoji
        self.coins = coins
        self.karma = karma
        self.killCount = killCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        username = try container.decode(String.self, forKey: .username)
        emoji = try container.decode(String.self, forKey: .emoji)
        coins = try container.decode(Int.self, forKey: .coins)
        karma = try container.decodeIfPresent(Int.self, forKey: .karma) ?? 0
        killCount = try container.decodeIfPresent(Int.self, forKey: .killCount) ?? 0
    }
}

struct LeaderboardResponse: Codable {
    let entries: [LeaderboardEntry]

    struct LeaderboardEntry: Codable, Identifiable {
        var id: String { username }
        let username: String
        let emoji: String
        let coins: Int
    }
}

struct TimelapseIOSResponse: Codable {
    let frames: [String]  // Array of paths like "/storage/timelapse_ios/snap_xxxxxxxx.jpg"
    let count: Int?
    let total: Int
    let latest: String?
    let hasMore: Bool
}
