//
//  EnhancedModelsExtensions.swift
//  MultiPainter
//
//  Extensions and helpers for enhanced UI components
//

import Foundation
import SwiftUI

// MARK: - ChatBroadcast Display Helper
extension ChatBroadcast {
    /// Convenience properties for chat display
    var senderUsername: String { username }
    var senderEmoji: String { emoji }
    var content: String { text }

    /// Convert timestamp to Date
    var date: Date {
        Date(timeIntervalSince1970: TimeInterval(timestamp) / 1000.0)
    }
}

// MARK: - Player Display Extensions
extension Player {
    /// Shield status (using existing isShielded computed property)
    var hasShield: Bool { isShielded }

    /// Player level (derived from coins or default to 1)
    var level: Int {
        // If you track level elsewhere, use that
        // Otherwise derive from experience/coins
        return 1 // Default level
    }
}

// MARK: - GameState Extensions for Enhanced UI
extension GameState {
    /// Send chat message helper (uses existing sendChat method)
    func sendChatMessage(_ text: String) {
        // GameState already has sendChat(_ text: String) method
        // This is just a convenience wrapper
        self.sendChat(text)
    }
}

// MARK: - Missing Properties Fallback
/*
 If chatHistory doesn't exist in GameState, add it:

 In GameState.swift, add:

 @Published var chatHistory: [ChatBroadcast] = []

 And in your WebSocket message handler, when you receive "chat_broadcast":

 case "chat_broadcast":
     if let chatData = try? JSONDecoder().decode(ChatBroadcast.self, from: jsonData) {
         chatHistory.append(chatData)
         // Keep only last 100 messages
         if chatHistory.count > 100 {
             chatHistory.removeFirst(chatHistory.count - 100)
         }
     }
*/
