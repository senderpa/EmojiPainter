//
//  GameManager.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation
import SwiftUI
import Combine

class GameManager: ObservableObject {
    // Connection state
    @Published var isConnected = false
    @Published var currentProfile: Profile?
    @Published var userId: Int?
    @Published var sessionId: Int?

    // Game state
    @Published var tileImages: [Int: UIImage] = [:]
    @Published var activePlayers: [LobbyState.Player] = []
    @Published var bots: [LobbyState.Bot] = []
    @Published var chatMessages: [ChatBroadcast] = []
    @Published var tileCountdowns: [Int: CountdownUpdate.TileCountdown] = [:]
    @Published var activeTileId: Int = 0
    @Published var processingTiles: Set<Int> = []
    @Published var hasJoinedGame: Bool = false
    @Published var playerPositions: [Int: PlayerPosition] = [:] // userId -> position
    @Published var myCurrentTile: Int = 0
    @Published var myPosition: CGPoint? = nil

    struct PlayerPosition {
        let tileId: Int
        let x: Double  // 0-512 tile-local
        let y: Double  // 0-512 tile-local
        let emoji: String
        let color: String
    }

    // Services
    let webSocketClient = WebSocketClient()
    private let apiClient = APIClient.shared
    private var cancellables = Set<AnyCancellable>()

    init() {
        setupWebSocketHandler()
        setupConnectionObserver()
    }

    // MARK: - Setup
    private func setupWebSocketHandler() {
        webSocketClient.onMessage = { [weak self] message in
            self?.handleWebSocketMessage(message)
        }
    }

    private func setupConnectionObserver() {
        webSocketClient.$isConnected
            .assign(to: &$isConnected)
    }

    // MARK: - Connection
    func createProfileAndConnect(username: String, emoji: String) async {
        do {
            let profile = try await apiClient.createProfile(username: username, emoji: emoji)

            await MainActor.run {
                self.currentProfile = profile
                self.connectToGame()
            }
        } catch {
            print("Failed to create profile: \(error)")
        }
    }

    private func connectToGame() {
        guard let profile = currentProfile else { return }

        webSocketClient.connect()

        // Wait a bit for connection to establish
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.sendJoinMessage(username: profile.username, emoji: profile.emoji)
        }
    }

    private func sendJoinMessage(username: String, emoji: String) {
        let joinMessage = JoinMessage(
            payload: .init(username: username, emoji: emoji)
        )
        webSocketClient.send(joinMessage)

        // DON'T auto-request game slot - wait for user to join from lobby
    }

    func disconnect() {
        webSocketClient.disconnect()
        resetState()
    }

    private func resetState() {
        tileImages.removeAll()
        activePlayers.removeAll()
        bots.removeAll()
        chatMessages.removeAll()
        tileCountdowns.removeAll()
        processingTiles.removeAll()
        userId = nil
        sessionId = nil
    }

    // MARK: - Message Handling
    private func handleWebSocketMessage(_ messageString: String) {
        guard let data = messageString.data(using: .utf8),
              let json = try? JSONDecoder().decode([String: AnyCodable].self, from: data),
              let typeValue = json["type"]?.value as? String else {
            return
        }

        // Re-encode payload for proper decoding
        guard let payloadDict = json["payload"]?.value as? [String: Any],
              let payloadData = try? JSONSerialization.data(withJSONObject: payloadDict) else {
            return
        }

        switch typeValue {
        case "session_info":
            handleSessionInfo(payloadData)
        case "all_tiles_state":
            handleAllTilesState(payloadData)
        case "tile_state":
            handleTileState(payloadData)
        case "stroke_broadcast":
            handleStrokeBroadcast(payloadData)
        case "lobby_state":
            handleLobbyState(payloadData)
        case "countdown_update":
            handleCountdownUpdate(payloadData)
        case "ai_processing_start":
            handleAIProcessingStart(payloadData)
        case "ai_complete":
            handleAIComplete(payloadData)
        case "chat_broadcast":
            handleChatBroadcast(payloadData)
        case "player_hit":
            handlePlayerHit(payloadData)
        case "player_respawn":
            handlePlayerRespawn(payloadData)
        default:
            print("Unknown message type: \(typeValue)")
        }
    }

    private func handleSessionInfo(_ data: Data) {
        guard let info = try? JSONDecoder().decode(SessionInfo.self, from: data) else { return }
        userId = info.userId
        sessionId = info.sessionId
        print("Connected with userId: \(info.userId), sessionId: \(info.sessionId)")
    }

    private func handleAllTilesState(_ data: Data) {
        guard let state = try? JSONDecoder().decode(AllTilesState.self, from: data) else {
            print("❌ Failed to decode all_tiles_state")
            return
        }

        print("✅ Received all_tiles_state with \(state.tiles.count) tiles")

        for (index, tile) in state.tiles.enumerated() {
            if let imageData = Data(base64Encoded: tile.imageData),
               let image = UIImage(data: imageData) {
                tileImages[index] = image
                print("✅ Loaded tile \(index) image: \(image.size)")
            } else {
                print("❌ Failed to decode tile \(index) image")
            }
        }
    }

    private func handleTileState(_ data: Data) {
        guard let state = try? JSONDecoder().decode(TileState.self, from: data) else { return }

        if let imageData = Data(base64Encoded: state.imageData),
           let image = UIImage(data: imageData) {
            tileImages[state.tileId] = image
        }
    }

    private func handleStrokeBroadcast(_ data: Data) {
        // This will be handled by the canvas view for real-time drawing
        // We can post a notification or use a delegate pattern
        NotificationCenter.default.post(
            name: .strokeBroadcastReceived,
            object: nil,
            userInfo: ["data": data]
        )
    }

    private func handleLobbyState(_ data: Data) {
        guard let state = try? JSONDecoder().decode(LobbyState.self, from: data) else { return }
        activePlayers = state.activePlayers
        bots = state.bots
    }

    private func handleCountdownUpdate(_ data: Data) {
        guard let update = try? JSONDecoder().decode(CountdownUpdate.self, from: data) else { return }
        activeTileId = update.activeTile

        for tile in update.tiles {
            tileCountdowns[tile.id] = tile
        }
    }

    private func handleAIProcessingStart(_ data: Data) {
        guard let start = try? JSONDecoder().decode(AIProcessingStart.self, from: data) else { return }
        processingTiles.insert(start.tileId)
    }

    private func handleAIComplete(_ data: Data) {
        guard let complete = try? JSONDecoder().decode(AIComplete.self, from: data) else { return }
        processingTiles.remove(complete.tileId)

        // Optionally fetch the new AI image
        Task {
            if let imageData = try? await apiClient.fetchTileImage(path: complete.path),
               let image = UIImage(data: imageData) {
                await MainActor.run {
                    self.tileImages[complete.tileId] = image
                }
            }
        }
    }

    private func handleChatBroadcast(_ data: Data) {
        guard let chat = try? JSONDecoder().decode(ChatBroadcast.self, from: data) else { return }
        chatMessages.append(chat)

        // Keep only last 100 messages
        if chatMessages.count > 100 {
            chatMessages.removeFirst(chatMessages.count - 100)
        }
    }

    private func handlePlayerHit(_ data: Data) {
        guard let hit = try? JSONDecoder().decode(PlayerHit.self, from: data) else { return }
        print("\(hit.victim) was hit by \(hit.killer)! Lives remaining: \(hit.lives)")

        // Add system message to chat
        let systemMessage = ChatBroadcast(
            userId: -1,
            username: "System",
            emoji: "⚔️",
            text: "\(hit.victim) was hit by \(hit.killer)! Lives: \(hit.lives)",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            isBot: false
        )
        chatMessages.append(systemMessage)
    }

    private func handlePlayerRespawn(_ data: Data) {
        guard let respawn = try? JSONDecoder().decode(PlayerRespawn.self, from: data) else { return }
        print("\(respawn.username) respawned with color \(respawn.color)")

        let systemMessage = ChatBroadcast(
            userId: -1,
            username: "System",
            emoji: "✨",
            text: "\(respawn.username) respawned!",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            isBot: false
        )
        chatMessages.append(systemMessage)
    }

    // MARK: - Actions
    func joinGame() {
        // Generate random spawn position
        let spawnX = Double.random(in: 100...900)
        let spawnY = Double.random(in: 100...900)

        // Request game slot to actually join
        let slotMessage = RequestGameSlotMessage(
            payload: .init(
                username: "Player",
                emoji: "🎨",
                color: "#3B82F6",
                x: spawnX,
                y: spawnY
            )
        )
        webSocketClient.send(slotMessage)

        // Spawn on active tile
        myCurrentTile = activeTileId
        hasJoinedGame = true
    }

    func sendStroke(fromX: Double, fromY: Double, toX: Double, toY: Double, brushSize: Double, color: String) {
        // Determine tile and convert to local coordinates
        let tileId = Int(fromY / 512) * 2 + Int(fromX / 512)
        let localFromX = fromX.truncatingRemainder(dividingBy: 512.0)
        let localFromY = fromY.truncatingRemainder(dividingBy: 512.0)
        let localToX = toX.truncatingRemainder(dividingBy: 512.0)
        let localToY = toY.truncatingRemainder(dividingBy: 512.0)

        webSocketClient.sendStroke(
            tileId: tileId,
            localFromX: localFromX,
            localFromY: localFromY,
            localToX: localToX,
            localToY: localToY,
            brushSize: brushSize,
            color: color
        )
    }

    func sendChat(_ text: String) {
        webSocketClient.sendChat(text)
    }

    func sendCursorMove(x: Double, y: Double) {
        webSocketClient.sendCursorMove(x: x, y: y)

        // Update my position
        myPosition = CGPoint(x: x, y: y)
    }

    func updateMyPosition(_ position: CGPoint) {
        myPosition = position
    }

    func getLeaderboard() async -> LeaderboardResponse? {
        try? await apiClient.getLeaderboard()
    }
}

// MARK: - Notification Names
extension Notification.Name {
    static let strokeBroadcastReceived = Notification.Name("strokeBroadcastReceived")
}
