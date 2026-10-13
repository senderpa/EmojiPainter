//
//  GameState.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation
import SwiftUI
import Combine
import Network

private struct EntityLerpState {
    var currentX: Double
    var currentY: Double
    var targetX: Double
    var targetY: Double
}

enum PlayerAlertType {
    case hit
    case attack
}

struct PlayerAlert {
    let type: PlayerAlertType
    let timestamp: Date
}

struct FloatingText {
    let text: String
    let timestamp: Date
    let isPositive: Bool  // true for +, false for -
}

class GameState: ObservableObject {
    // MARK: - Embed close callback (nil when running standalone)
    var onClose: (() -> Void)?

    // MARK: - Connection State
    @Published var isConnected = false
    @Published var hasNetworkConnection = true  // Internet connectivity
    @Published var showNetworkError = false  // Show offline error overlay
    @Published var currentProfile: Profile?
    @Published var userId: Int?
    @Published var sessionId: Int?

    // MARK: - Player State
    @Published var myPlayer: Player? {
        didSet {
            if let player = myPlayer {
                print("✅ [PLAYER] myPlayer SET: \(player.username) (\(player.emoji)) at (\(Int(player.x)), \(Int(player.y)))")
            } else {
                print("❌ [PLAYER] myPlayer CLEARED (was: \(oldValue?.username ?? "nil"))")
            }
        }
    }
    @Published var otherPlayers: [Int: Player] = [:]  // userId -> Player
    @Published var hasJoinedGame = false
    @Published var isInGame = false  // Active in-game (not just lobby)
    @Published var readyToShowGame = false  // Delays view switch until player positioned
    @Published var tilesLoaded = false  // Track if all tiles have been loaded
    @Published var waitingForTilesToShowGame = false  // Flag when zoom completes but waiting for tiles
    @Published var hideTransitionOverlay = false  // Signal to hide transition when tiles load
    @Published var connectionStatusMessage = "Initializing..."
    @Published var lastStrokeStatusMessage = "No strokes yet"

    // MARK: - Canvas State
    @Published var tiles: [Int: Tile] = [:]  // tileId -> Tile
    @Published var activeTileId: Int = 0
    @Published var strokes: [Stroke] = []

    // MARK: - Lobby State
    @Published var lobbyPlayers: [Player] = []
    @Published var timelapseImage: UIImage?  // Single latest frame for lobby
    @Published var timelapseFrames: [UIImage] = []  // Multiple frames for in-game animation
    @Published var currentTimelapseIndex: Int = 0  // Current frame index for animation
    @Published var isLoadingTimelapseFrames = false  // Loading state for initial frames (start false, load in background)
    @Published var timelapseLoadProgress: Double = 0.0  // Progress 0.0 to 1.0
    @Published var splashCollectedImages: [UIImage] = []  // Images collected during splash screen
    @Published var splashLoadProgress: Double = 0.0  // Progress 0.0 to 1.0
    @Published var waitingListPosition: Int? = nil  // Position in waiting list (nil if not waiting)
    @Published var waitingListTimeRemaining: Int = 30  // Seconds until kick from waiting list
    @Published var showWaitingListInfo: Bool = false  // Show info bubble

    // MARK: - Continuous Frame Collection for Timelapse
    @Published var collectedTimelapseFrames: [UIImage] = []  // Ring buffer of newest frames (downscaled, bounded)
    private let maxCollectedFrames = 40  // Bounded + downscaled so the lobby runs for days with no memory crash
    @Published var lastTimelapseUpdate: Date? = nil  // When the newest frame last loaded ("newest loaded" info)
    @Published var isLoadingLobbyFrames: Bool = false  // Currently (re)loading the intro frames
    @Published var serverReachable: Bool = true  // Timelapse server reachability (lobby status dot)
    @Published var isPlayingLobbyIntro = false  // While the intro animation plays, don't let the poll clobber it
    @Published var aiChallengeMessage: String? = nil   // "Fight the AI!" overlay text
    @Published var aiChallengeCoinsEarned: Int = 0     // Coins earned for fighting AI this round
    @Published var aiRevealImage: UIImage? = nil        // New tile image to reveal after AI completes
    private var aiChallengeActiveTile: Int? = nil      // Tile the player was on when AI started
    private(set) var sessionStrokeCount: Int = 0       // Strokes painted in current game session
    private static let aiChallengeMessages: [String] = [
        "⚡️ FIGHT THE SLOP!", "🔥 RESIST THE MACHINE!", "🎨 PAINT HARDER!",
        "🤖 AI IS INVADING YOUR TILE!", "💀 THE ALGORITHM STRIKES!", "🦾 DEFEAT THE BOT!",
        "🌋 UNLEASH YOUR CREATIVITY!", "⚔️ ARTIST VS AI — YOU WIN!", "🧠 YOUR BRAIN > THEIR GPU!",
        "🚀 SHOW THE AI WHO'S BOSS!", "🎭 CREATIVITY CANNOT BE COMPUTED!", "🔴 RED ALERT: AI ATTACK!",
        "🛡 DEFEND YOUR TILE!", "💪 HUMAN SUPREMACY ACTIVATED!", "🌟 YOUR STROKES MATTER MORE!",
        "🤯 AI TRYING TO STEAL YOUR VIBE!", "🎯 TARGET ACQUIRED — PAINT IT BACK!", "🏴‍☠️ PIRATE THE PIXEL!",
        "🔮 CHAOS BEATS CALCULUS!", "🌈 EMOTION > OPTIMIZATION!", "✊ RECLAIM THE CANVAS!",
        "🧨 BLOW UP THE ALGORITHM!", "🐉 SLAY THE DATA DRAGON!", "🎪 THE CIRCUS IS YOURS!",
        "📡 SIGNAL OVERWHELMS THE NOISE!", "🌊 FLOOD THE MODEL!", "🦋 ENTROPY IS ART!",
        "🏆 CHAMPIONS DON'T NEED WEIGHTS!", "🎵 YOUR RHYTHM BREAKS THE CODE!", "🌙 DREAM > DATASET!",
        "💥 PAINT LIKE IT'S YOUR LAST STROKE!", "🔑 THE KEY IS YOU, NOT THE AI!", "🌺 BLOOM AGAINST THE BOT!"
    ]
    private var isFetchingTimelapse = false  // Guard so slow/stacked 1s fetches never pile up over hours
    private var timelapseFailureStreak = 0

    private var latestTimelapseFilename: String?
    private var lastTimelapseImageHash: Int = 0  // Track image hash to avoid unnecessary updates
    private var waitingListTimer: Timer?
    private var lastWaitingListChatTime: Date?
    private var splashImageTimer: Timer?
    private var playbackAnimationTimer: Timer?

    // MARK: - Computed Properties
    var activePlayerCount: Int {
        lobbyPlayers.filter { $0.alive }.count
    }

    var activeHumanPlayerCount: Int {
        lobbyPlayers.filter { $0.alive && !$0.isBot }.count
    }

    var maxPlayers: Int { 10 }

    var canJoinGame: Bool {
        // Only count human players for join logic - bots can be replaced
        activeHumanPlayerCount < maxPlayers
    }

    // MARK: - Chat State
    @Published var chatMessages: [ChatBroadcast] = []
    @Published var playerAlerts: [String: PlayerAlert] = [:]
    @Published var floatingTexts: [String: FloatingText] = [:]  // username -> FloatingText

    // MARK: - Inactivity System
    @Published var showInactivityWarning = false
    @Published var inactivityCountdown: Int = 10
    private var inactivityTimer: Timer?
    private var inactivityWarningTimer: Timer?
    private var lastInteractionTime = Date()

    // MARK: - Background Kick System
    private var backgroundKickTimer: DispatchWorkItem?
    private var backgroundTime: Date?
    private var lastLocalKarmaAwardTime: Date?
    private var lastAutoAttackTimes: [Int: Date] = [:]
    private var lastKnownBrushSize: Double = 10
    private var playerLerpStates: [Int: EntityLerpState] = [:]
    private var lerpTimer: Timer?
    private var didBootstrapProfile = false
    private let debugTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
    private var shouldAutoJoinWhenReady = false
    private var pendingJoinSpawnPosition: CGPoint?

    // MARK: - Tracking
    private var playSessionStart: Date?

    // MARK: - Painting Session Tracking (My Moments)
    @Published var currentPaintingSessionId: String?
    @Published var isPaintingSessionActive: Bool = false
    private var paintingSessionStartTime: Date?
    private var paintingSessionTimer: Timer?  // Auto-stop session after inactivity

    // MARK: - Services
    let webSocketService: WebSocketService
    let apiClient = APIClient.shared
    private var cancellables = Set<AnyCancellable>()
    private var timelapseTimer: Timer?
    private var pendingReconnectWorkItem: DispatchWorkItem?

    init() {
        webSocketService = WebSocketService()
        setupTiles()
        setupWebSocketDelegate()
        setupNetworkMonitoring()
        startLerpTimer()
    }

    private func setupNetworkMonitoring() {
        // Monitor network connectivity
        NetworkMonitor.shared.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isConnected in
                self?.hasNetworkConnection = isConnected
                if !isConnected {
                    self?.showNetworkError = true
                    print("❌ Network connection lost")
                } else {
                    print("✅ Network connection restored")
                }
            }
            .store(in: &cancellables)
    }

    func retryConnection() {
        showNetworkError = false
        if hasNetworkConnection {
            // Try to reconnect to WebSocket
            if !isConnected {
                connectToGame()
            }
            // Retry timelapse loading
            startTimelapseUpdates()
        } else {
            // Still offline, show error again
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.showNetworkError = true
            }
        }
    }

    // MARK: - Setup
    private func setupTiles() {
        for i in 0..<4 {
            tiles[i] = Tile(id: i)
        }
    }

    private func setupWebSocketDelegate() {
        webSocketService.delegate = self
        webSocketService.$isConnected
            .assign(to: &$isConnected)

        webSocketService.$connectionStatusDescription
            .receive(on: DispatchQueue.main)
            .sink { [weak self] description in
                self?.connectionStatusMessage = description
            }
            .store(in: &cancellables)
    }

    // MARK: - Connection
    func createProfileAndConnect(username: String, emoji: String) async {
        do {
            let profile = try await apiClient.createProfile(username: username, emoji: emoji)

            await MainActor.run {
                UserPreferences.shared.saveUsername(profile.username)
                UserPreferences.shared.saveEmoji(profile.emoji)
                UserPreferences.shared.saveCoins(profile.coins)
                UserPreferences.shared.saveKarma(profile.karma)
                self.currentProfile = profile
                self.didBootstrapProfile = true
                self.connectToGame()
            }
        } catch {
            print("Failed to create profile: \(error)")
        }
    }

    func bootstrapProfileIfNeeded() {
        guard !didBootstrapProfile else { return }
        didBootstrapProfile = true

        let username = UserPreferences.shared.loadUsername() ?? RandomNameGenerator.randomName()
        let emoji = UserPreferences.shared.loadEmoji() ?? EmojiData.randomEmoji()

        Task {
            await createProfileAndConnect(username: username, emoji: emoji)
        }
    }

    func recreateProfile(username: String, emoji: String) async {
        await MainActor.run {
            applyLocalProfileUpdate(username: username, emoji: emoji)
            self.disconnect()
            self.didBootstrapProfile = false
        }

        await createProfileAndConnect(username: username, emoji: emoji)
    }

    private func connectToGame() {
        guard let profile = currentProfile else {
            print("❌ [CONNECT] No profile to connect with!")
            return
        }
        guard !isConnected else {
            return
        }

        startLerpTimer()
        print("🔌 [CONNECT] Starting connection for \(profile.username) \(profile.emoji)")
        webSocketService.connect()

        // Send join message after connection establishes
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.sendJoinMessage(username: profile.username, emoji: profile.emoji)
        }
    }

    private func sendJoinMessage(username: String, emoji: String) {
        print("📤 [CONNECT] Sending viewer_join for \(username) \(emoji)")
        // Send viewer_join to just observe in lobby (not play yet)
        let joinMessage = JoinMessage(payload: .init(username: username, emoji: emoji))
        webSocketService.send(joinMessage)
        print("⏳ [CONNECT] Waiting for session_info from server...")
    }

    private func scheduleReconnect() {
        guard currentProfile != nil else {
            print("⚠️ [CONNECT] Cannot reconnect - missing profile")
            return
        }

        let workItem = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.pendingReconnectWorkItem = nil
            self.connectToGame()
        }
        pendingReconnectWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: workItem)
    }

    private func attemptDeferredJoinIfNeeded() {
        guard shouldAutoJoinWhenReady else { return }
        shouldAutoJoinWhenReady = false
        let deferredSpawn = pendingJoinSpawnPosition
        pendingJoinSpawnPosition = nil
        DispatchQueue.main.async { [weak self] in
            self?.joinGame(spawnPosition: deferredSpawn)
        }
    }

    func disconnect(shouldReconnect: Bool = false) {
        pendingReconnectWorkItem?.cancel()
        webSocketService.disconnect()
        stopTimelapseUpdates()
        stopInactivityMonitoring()
        stopPlaySessionTracking()
        stopLerpTimer()
        resetState()
        shouldAutoJoinWhenReady = false
        pendingJoinSpawnPosition = nil

        if shouldReconnect {
            scheduleReconnect()
        }
    }

    func leaveGameAndReturnToLobby() {
        print("🔄 [LOBBY] Leaving current match and rejoining lobby")
        postMultipaintStrokes()
        disconnect(shouldReconnect: true)
    }

    private func postMultipaintStrokes() {
        guard sessionStrokeCount > 0 else { return }
        let strokes = sessionStrokeCount
        sessionStrokeCount = 0
        let username = currentProfile?.username ?? UserPreferences.shared.loadUsername() ?? ""
        let emoji    = currentProfile?.emoji    ?? UserPreferences.shared.loadEmoji()    ?? "🎨"
        guard !username.isEmpty else { return }

        Task {
            guard let url = URL(string: "https://emojipainter.com/leaderboard/multipaint_update.php") else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body: [String: Any] = ["username": username, "emoji": emoji, "strokes": strokes]
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
            req.timeoutInterval = 10
            do {
                let (_, _) = try await URLSession.shared.data(for: req)
                print("✅ [MULTIPAINT] Posted \(strokes) strokes for \(username)")
            } catch {
                print("⚠️ [MULTIPAINT] Failed to post strokes: \(error.localizedDescription)")
            }
        }
    }

    private func resetState() {
        print("🔄 [STATE] Resetting game state")
        myPlayer = nil
        otherPlayers.removeAll()
        lobbyPlayers.removeAll()
        chatMessages.removeAll()
        strokes.removeAll()
        playerAlerts.removeAll()
        hasJoinedGame = false
        isInGame = false  // Reset in-game flag
        readyToShowGame = false  // Reset ready flag
        tilesLoaded = false  // Reset tiles flag
        waitingForTilesToShowGame = false  // Reset waiting flag
        hideTransitionOverlay = false  // Reset transition flag
        userId = nil
        sessionId = nil
        playerLerpStates.removeAll()

        for tile in tiles.values {
            tile.clearStrokes()
        }
    }

    // MARK: - Lobby Actions
    func joinGame(spawnPosition: CGPoint? = nil) {
        guard let profile = currentProfile else {
            print("❌ [JOIN] Cannot join - no profile!")
            return
        }

        guard isConnected else {
            print("⚠️ [JOIN] Not connected - deferring join until connection is ready")
            pendingJoinSpawnPosition = spawnPosition
            shouldAutoJoinWhenReady = true
            connectToGame()
            return
        }

        guard canJoinGame else {
            // Game is full, join waiting list instead
            print("⚠️ [JOIN] Game is full - joining waiting list")
            shouldAutoJoinWhenReady = false
            pendingJoinSpawnPosition = nil
            joinWaitingList()
            return
        }

        print("🎮 [JOIN] Joining game as player...")
        print("   Profile: \(profile.username) \(profile.emoji)")
        print("   UserID: \(userId ?? -1), SessionID: \(sessionId ?? -1)")

        // Reset tile loading state for new join
        tilesLoaded = false
        waitingForTilesToShowGame = false
        hideTransitionOverlay = false

        // Use provided spawn position or generate random spawn position with distance from other players
        let spawnPosition = spawnPosition ?? pendingJoinSpawnPosition ?? findValidSpawnPosition()

        // Send player_join with full player data
        let playerJoinMessage = RequestGameSlotMessage(
            payload: .init(
                username: profile.username,
                emoji: profile.emoji,
                color: "#3B82F6",  // Blue color
                x: spawnPosition.x,
                y: spawnPosition.y
            )
        )
        webSocketService.send(playerJoinMessage)
        shouldAutoJoinWhenReady = false
        pendingJoinSpawnPosition = nil

        // Explicitly request all tiles to ensure we have the latest AI images
        let getTilesMessage = GetTilesMessage(payload: .init())
        webSocketService.send(getTilesMessage)

        hasJoinedGame = true
        isInGame = true  // Mark as actively in-game
        startInactivityMonitoring()  // Start inactivity detection

        print("✅ [JOIN] Join game request sent - waiting for confirmation")
    }

    /// Calculate and return spawn position for preview (public for transition)
    func calculateSpawnPosition() -> CGPoint {
        return findValidSpawnPosition()
    }

    /// Find a valid spawn position that's far from other players
    private func findValidSpawnPosition() -> CGPoint {
        let minDistance: Double = 200  // Minimum distance from other players
        let maxAttempts = 50

        for _ in 0..<maxAttempts {
            let x = Double.random(in: 100...900)
            let y = Double.random(in: 100...900)
            let candidate = CGPoint(x: x, y: y)

            // Check distance from all other players
            var validSpawn = true
            for player in lobbyPlayers {
                let playerPos = CGPoint(x: player.x, y: player.y)
                let distance = hypot(candidate.x - playerPos.x, candidate.y - playerPos.y)

                if distance < minDistance {
                    validSpawn = false
                    break
                }
            }

            if validSpawn {
                print("[SPAWN] Valid position found: (\(Int(x)), \(Int(y)))")
                return candidate
            }
        }

        // Fallback: if no valid position found after max attempts, use random
        let fallbackX = Double.random(in: 100...900)
        let fallbackY = Double.random(in: 100...900)
        print("[SPAWN] Fallback position: (\(Int(fallbackX)), \(Int(fallbackY)))")
        return CGPoint(x: fallbackX, y: fallbackY)
    }

    func joinWaitingList() {
        // Set waiting list position (only count human players)
        waitingListPosition = max(1, activeHumanPlayerCount - maxPlayers + 1)
        lastWaitingListChatTime = Date()
        waitingListTimeRemaining = 30

        // Show info bubble
        showWaitingListInfo = true

        // Hide info bubble after 5 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            self?.showWaitingListInfo = false
        }

        // Start countdown timer
        startWaitingListMonitoring()

        print("📋 Joined waiting list at position \(waitingListPosition ?? 0)")
    }

    func leaveWaitingList() {
        waitingListPosition = nil
        stopWaitingListMonitoring()
    }

    private func startWaitingListMonitoring() {
        stopWaitingListMonitoring()

        waitingListTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }

            if let lastChat = self.lastWaitingListChatTime {
                let elapsed = Date().timeIntervalSince(lastChat)
                self.waitingListTimeRemaining = max(0, 30 - Int(elapsed))

                if self.waitingListTimeRemaining <= 0 {
                    // Kick from waiting list
                    self.kickFromWaitingList()
                }
            }
        }
    }

    private func stopWaitingListMonitoring() {
        waitingListTimer?.invalidate()
        waitingListTimer = nil
    }

    private func kickFromWaitingList() {
        print("⏱️ Kicked from waiting list - no chat activity")
        waitingListPosition = nil
        stopWaitingListMonitoring()
    }

    /// Record chat activity (resets waiting list timer)
    func recordWaitingListChat() {
        if waitingListPosition != nil {
            lastWaitingListChatTime = Date()
            waitingListTimeRemaining = 30
            print("💬 Waiting list timer reset")
        }
    }

    func startTimelapseUpdates() {
        // IMPORTANT: This runs FOREVER while in lobby/game (never stops, not even after hours)
        // If timer already running, don't restart it
        guard timelapseTimer == nil else {
            print("⏰ Timelapse updates already running, continuing...")
            return
        }

        print("▶️ Starting CONTINUOUS timelapse updates (will run forever, every 1s)")
        fetchTimelapse()

        // Poll every 1 second for FAST, constant updates of newest image
        // More frequent updates ensure smooth visual continuity
        // This runs FOREVER - we NEVER invalidate or stop this timer while player is in game/lobby
        timelapseTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.fetchTimelapse()
        }
    }

    func stopTimelapseUpdates() {
        timelapseTimer?.invalidate()
        timelapseTimer = nil
    }

    func stopTimelapseAnimation() {
        // No-op: Animation removed for performance
    }

    // MARK: - Splash Screen Image Collection

    func startSplashImageCollection() {
        print("🎬 Starting splash image collection (5 images over 10s)")
        splashCollectedImages = []
        splashLoadProgress = 0.0

        // Collect 5 images over 10 seconds (one every 2 seconds)
        var collectionCount = 0
        splashImageTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }

            Task { @MainActor in
                do {
                    let imageData = try await self.apiClient.fetchLatestTimelapse()
                    if let image = UIImage(data: imageData) {
                        self.splashCollectedImages.append(image)
                        collectionCount += 1
                        self.splashLoadProgress = Double(collectionCount) / 5.0
                        print("✅ Collected splash image \(collectionCount)/5")

                        if collectionCount >= 5 {
                            timer.invalidate()
                            print("🎉 All 5 splash images collected!")
                        }
                    }
                } catch {
                    print("⚠️ Failed to collect splash image: \(error)")
                }
            }
        }

        // Also fetch the first one immediately
        Task { @MainActor in
            do {
                let imageData = try await self.apiClient.fetchLatestTimelapse()
                if let image = UIImage(data: imageData) {
                    self.splashCollectedImages.append(image)
                    collectionCount += 1
                    self.splashLoadProgress = Double(collectionCount) / 5.0
                    print("✅ Collected splash image \(collectionCount)/5 (immediate)")
                }
            } catch {
                print("⚠️ Failed to collect first splash image")
            }
        }
    }

    func playSplashCollectedImages(completion: @escaping () -> Void) {
        guard !splashCollectedImages.isEmpty else {
            print("⚠️ No splash images to play")
            completion()
            return
        }

        // REVERSE: Play newest to oldest
        let reversedImages = splashCollectedImages.reversed()
        print("🎬 Playing \(reversedImages.count) splash images NEWEST→OLDEST in 2s")

        currentTimelapseIndex = 0
        timelapseFrames = Array(reversedImages)

        if let firstImage = reversedImages.first {
            timelapseImage = firstImage
        }

        // Play collected images over 2 seconds
        let intervalPerFrame = 2.0 / Double(reversedImages.count)

        playbackAnimationTimer = Timer.scheduledTimer(withTimeInterval: intervalPerFrame, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }

            self.currentTimelapseIndex += 1

            if self.currentTimelapseIndex >= self.timelapseFrames.count {
                timer.invalidate()
                print("✅ Splash playback complete (newest→oldest)")

                // Show newest image (which is first in reversed array)
                if let newest = self.timelapseFrames.first {
                    self.timelapseImage = newest
                }

                completion()
                return
            }

            // Update to current frame
            if self.currentTimelapseIndex < self.timelapseFrames.count {
                self.timelapseImage = self.timelapseFrames[self.currentTimelapseIndex]
            }
        }
    }

    private func fetchTimelapse() {
        // Never let slow / stacked requests pile up over hours of runtime.
        if isFetchingTimelapse { return }
        isFetchingTimelapse = true

        Task {
            defer { Task { @MainActor in self.isFetchingTimelapse = false } }
            do {
                // Fetch with timeout and retry logic for robustness
                let latestImageData = try await fetchTimelapseWithRetry(maxRetries: 2)

                guard let decoded = UIImage(data: latestImageData) else {
                    print("⚠️ [TIMELAPSE] Failed to decode image data")
                    return
                }

                // Downscale OFF the main thread — 2048 for sharp Retina lobby display,
                // 400 for the in-game ring buffer to keep memory low over long sessions.
                let display = Self.downscaled(decoded, maxSide: 2048)
                let thumb = Self.downscaled(decoded, maxSide: 400)

                await MainActor.run { [weak self] in
                    guard let self = self else { return }
                    self.serverReachable = true
                    self.timelapseFailureStreak = 0
                    self.lastTimelapseUpdate = Date()

                    // Always show the newest (no fragile hash dedupe) — but don't
                    // override the frame the intro animation is currently showing.
                    if !self.isPlayingLobbyIntro {
                        self.timelapseImage = display
                        self.timelapseFrames = [display]
                    }

                    // Bounded ring buffer of downscaled frames for the in-game player.
                    self.collectedTimelapseFrames.insert(thumb, at: 0)
                    if self.collectedTimelapseFrames.count > self.maxCollectedFrames {
                        self.collectedTimelapseFrames.removeLast()
                    }
                }

            } catch {
                await MainActor.run { [weak self] in
                    guard let self = self else { return }
                    self.timelapseFailureStreak += 1
                    if self.timelapseFailureStreak >= 3 { self.serverReachable = false }
                }
                print("⚠️ [TIMELAPSE] Failed to fetch: \(error.localizedDescription)")
            }
        }
    }

    /// Downscale an image (safe to call off the main thread) so the lobby only
    /// ever holds small bitmaps in memory.
    static func downscaled(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let w = image.size.width, h = image.size.height
        let longest = Swift.max(w, h)
        guard longest > maxSide, longest > 0 else { return image }
        let s = maxSide / longest
        let newSize = CGSize(width: w * s, height: h * s)
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        fmt.opaque = true
        return UIGraphicsImageRenderer(size: newSize, format: fmt).image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }

    /// Full lobby refresh: reload recent frames, replay the intro animation, and
    /// grab the newest frame immediately. Wired to the lobby 🔄 button.
    func refreshLobbyTimelapse() {
        print("🔄 Refreshing lobby timelapse (reload + replay)")
        loadLast30ImagesForLobby()
        fetchTimelapse()
    }

    private func fetchTimelapseWithRetry(maxRetries: Int) async throws -> Data {
        var lastError: Error? = nil

        for attempt in 1...maxRetries {
            do {
                // Fetch the latest frame path from the frames endpoint, then load the full-res snap.
                // (The /preview endpoint only returns a 128×128 thumbnail, too blurry for lobby.)
                let latestImageData = try await withTimeout(seconds: 8.0) {
                    let response = try await self.apiClient.fetchTimelapseFrames(limit: 1)
                    guard let path = response.frames.first else {
                        throw URLError(.zeroByteResource)
                    }
                    return try await self.apiClient.fetchTileImage(path: path)
                }

                if attempt > 1 {
                    print("✅ [TIMELAPSE] Fetch succeeded on attempt \(attempt)")
                }
                return latestImageData

            } catch {
                lastError = error
                print("⚠️ [TIMELAPSE] Fetch attempt \(attempt) failed: \(error.localizedDescription)")

                if attempt < maxRetries {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                }
            }
        }

        throw lastError ?? URLError(.timedOut)
    }

    private func withTimeout<T>(seconds: TimeInterval, operation: @escaping () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }

            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw URLError(.timedOut)
            }

            let result = try await group.next()!
            group.cancelAll()
            return result
        }
    }

    // MARK: - Initial Lobby Image Loading
    func loadLast30ImagesForLobby() {
        print("🎬 Loading last 30 images for lobby animation...")

        Task {
            await MainActor.run { [weak self] in
                self?.isLoadingLobbyFrames = true
            }

            do {
                // Fetch the last 30 timelapse frames from the server
                let response = try await apiClient.fetchTimelapseFrames(limit: 30)

                var images: [UIImage] = []

                // Load each image from the paths returned
                for path in response.frames.reversed() {  // Reverse to show newest first
                    do {
                        let imageData = try await apiClient.fetchTileImage(path: path)
                        if let image = UIImage(data: imageData) {
                            images.append(Self.downscaled(image, maxSide: 2048))
                        }
                    } catch {
                        print("⚠️ Failed to load image from path \(path): \(error)")
                        continue
                    }
                }

                await MainActor.run { [weak self] in
                    guard let self = self else { return }

                    self.isLoadingLobbyFrames = false

                    if !images.isEmpty {
                        print("✅ Loaded \(images.count) images for initial lobby animation")
                        // Start animation with loaded images
                        self.playInitialLobbyAnimation(with: images)
                    } else {
                        print("⚠️ No images loaded for initial animation")
                    }
                }

            } catch {
                await MainActor.run { [weak self] in
                    self?.isLoadingLobbyFrames = false
                }
                print("⚠️ Failed to load last 30 images: \(error.localizedDescription)")
            }
        }
    }

    private func playInitialLobbyAnimation(with images: [UIImage]) {
        playbackAnimationTimer?.invalidate()
        guard !images.isEmpty else { return }

        print("🎬 Ping-pong lobby animation with \(images.count) frames")

        isPlayingLobbyIntro = true
        // Start at oldest (last index), moving toward newest (index 0)
        var currentIndex = images.count - 1
        var direction = -1  // -1 = toward newest, +1 = toward oldest
        var bounceCount = 0
        let maxBounces = 3  // 1.5 round trips then settle on newest

        timelapseImage = images[currentIndex]
        currentTimelapseIndex = currentIndex
        lastTimelapseUpdate = Date()

        playbackAnimationTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }

            currentIndex += direction

            // Bounce at newest end (index 0)
            if currentIndex <= 0 {
                currentIndex = 0
                direction = 1
                bounceCount += 1
            }
            // Bounce at oldest end
            if currentIndex >= images.count - 1 {
                currentIndex = images.count - 1
                direction = -1
                bounceCount += 1
            }

            self.timelapseImage = images[currentIndex]
            self.currentTimelapseIndex = currentIndex

            // After maxBounces, settle on newest and go live
            if bounceCount >= maxBounces {
                self.timelapseImage = images[0]
                self.currentTimelapseIndex = 0
                self.isPlayingLobbyIntro = false
                timer.invalidate()
                print("✅ Lobby ping-pong complete - showing newest image live")
            }
        }
    }


    // MARK: - Player Actions
    func movePlayer(to position: CGPoint) {
        guard var player = myPlayer else { return }

        // Record interaction
        recordInteraction()

        // Clamp to canvas bounds (0-1024)
        let clampedX = max(0, min(1024, position.x))
        let clampedY = max(0, min(1024, position.y))

        // Check if target tile is frozen
        let targetTileId = Int(clampedY / 512) * 2 + Int(clampedX / 512)
        if tiles[targetTileId]?.isFrozen == true {
            print("Cannot move to frozen tile \(targetTileId)")
            return
        }

        // Update local player position
        player.x = clampedX
        player.y = clampedY
        myPlayer = player

        // Send to server
        let moveMessage = PlayerMoveMessage(payload: .init(x: clampedX, y: clampedY, brushSize: lastKnownBrushSize))
        webSocketService.send(moveMessage)
        detectCollisions()
    }

    func syncCurrentPlayerPosition() {
        guard let player = myPlayer else { return }
        let moveMessage = PlayerMoveMessage(payload: .init(x: player.x, y: player.y, brushSize: lastKnownBrushSize))
        webSocketService.send(moveMessage)
        webSocketService.sendCursorMove(x: player.x, y: player.y)
    }

    func sendStroke(from: CGPoint, to: CGPoint, brushSize: Double, color: String) {
        guard myPlayer != nil else {
            let message = "Stroke blocked – player missing"
            print("❌ [STROKE] \(message)")
            updateLastStrokeStatus(message)
            return
        }

        guard isInGame else {
            let message = "Stroke blocked – not actively in game"
            print("❌ [STROKE] \(message)")
            updateLastStrokeStatus(message)
            return
        }

        // Record interaction and count stroke
        recordInteraction()
        sessionStrokeCount += 1

        // Auto-start painting session if user starts painting
        if !isPaintingSessionActive {
            startPaintingSession()
        } else {
            // Reset inactivity timer (keep session alive)
            resetPaintingSessionTimer()
        }

        let segments = splitStrokeAcrossTiles(from: from, to: to)
        var sentSegments = 0
        var sentTileIds: Set<Int> = []

        for segment in segments {
            if tiles[segment.tileId]?.isFrozen == true {
                let message = "Stroke skipped – tile \(segment.tileId) frozen"
                print("⚠️ [STROKE] \(message)")
                updateLastStrokeStatus(message)
                continue
            }
            sendStrokeSegment(start: segment.start, end: segment.end, tileId: segment.tileId, brushSize: brushSize, color: color)
            sentSegments += 1
            sentTileIds.insert(segment.tileId)
        }

        if sentSegments > 0 {
            let tilesText = sentTileIds.sorted().map { "\($0)" }.joined(separator: ", ")
            updateLastStrokeStatus("Stroke sent (\(sentSegments) segment\(sentSegments == 1 ? "" : "s") • tile\(sentTileIds.count == 1 ? "" : "s") \(tilesText))")
        } else {
            updateLastStrokeStatus("Stroke discarded (no valid tiles)")
        }

        awardPaintingKarmaIfNeeded()
    }

    private func updateLastStrokeStatus(_ message: String) {
        let timestamp = debugTimeFormatter.string(from: Date())
        DispatchQueue.main.async {
            self.lastStrokeStatusMessage = "[\(timestamp)] \(message)"
        }
    }

    func sendChat(_ text: String) {
        print("💬 [CHAT] Sending message: \(text)")

        // Record interaction
        recordInteraction()

        // Record waiting list chat activity
        recordWaitingListChat()

        let message = ChatMessage(payload: .init(text: text))
        webSocketService.send(message)
    }

    // MARK: - Stroke Rendering
    private func renderStrokeSegment(_ segment: StrokeSegment) {
        // Render to all tiles that the segment intersects
        for tileId in 0..<4 {
            if segment.intersects(tileId: tileId) {
                tiles[tileId]?.renderSegment(segment)
            }
        }
    }

    // MARK: - Viewport Helpers
    /// Get viewport rect centered on player (256x256)
    var viewportRect: CGRect {
        guard let player = myPlayer else {
            return CGRect(x: 0, y: 0, width: 256.0, height: 256.0)
        }

        let viewportSize: CGFloat = 256.0
        let halfSize = viewportSize / 2

        let x = player.x - halfSize
        let y = player.y - halfSize

        // Clamp to canvas bounds
        let clampedX = max(0, min(1024 - viewportSize, x))
        let clampedY = max(0, min(1024 - viewportSize, y))

        return CGRect(x: clampedX, y: clampedY, width: viewportSize, height: viewportSize)
    }

    /// Get list of players visible in current viewport
    var visiblePlayers: [Player] {
        let viewport = viewportRect
        let allPlayers = Array(otherPlayers.values) + (myPlayer.map { [$0] } ?? [])

        return allPlayers.filter { player in
            viewport.contains(CGPoint(x: player.x, y: player.y))
        }
    }

    // MARK: - Leaderboard
    func getLeaderboard() async -> LeaderboardResponse? {
        try? await apiClient.getLeaderboard()
    }

    // MARK: - Inactivity Monitoring
    func startInactivityMonitoring() {
        // Only monitor when in-game
        guard isInGame else { return }

        stopInactivityMonitoring()  // Clear any existing timers
        lastInteractionTime = Date()

        // Check for inactivity every second
        inactivityTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.checkInactivity()
        }
    }

    func stopInactivityMonitoring() {
        inactivityTimer?.invalidate()
        inactivityTimer = nil
        inactivityWarningTimer?.invalidate()
        inactivityWarningTimer = nil
        showInactivityWarning = false
        inactivityCountdown = 10
    }

    func recordInteraction() {
        lastInteractionTime = Date()

        // If countdown was showing, reset it
        if showInactivityWarning {
            showInactivityWarning = false
            inactivityCountdown = 10
            inactivityWarningTimer?.invalidate()
            inactivityWarningTimer = nil
        }
    }

    private func checkInactivity() {
        let timeSinceLastInteraction = Date().timeIntervalSince(lastInteractionTime)

        // If 30+ seconds inactive and not showing warning yet, start countdown
        if timeSinceLastInteraction >= 30 && !showInactivityWarning {
            startInactivityCountdown()
        }
    }

    private func startInactivityCountdown() {
        showInactivityWarning = true
        inactivityCountdown = 10

        // Count down every second
        inactivityWarningTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }

            self.inactivityCountdown -= 1

            if self.inactivityCountdown <= 0 {
                // Kick to lobby
                self.kickToLobby()
            }
        }
    }

    private func kickToLobby() {
        print("⚠️ [INACTIVITY] Player inactive - returning to lobby")
        leaveGameAndReturnToLobby()
    }

    // MARK: - Background Kick System
    func appDidEnterBackground() {
        // Only kick if actively in-game
        guard isInGame else { return }

        backgroundTime = Date()
        print("📱 [BACKGROUND] App backgrounded at \(backgroundTime!)")

        // Cancel any existing kick timer
        backgroundKickTimer?.cancel()

        // Schedule kick after 2 seconds
        let workItem = DispatchWorkItem { [weak self] in
            guard let self = self else { return }

            // Double-check we're still in background and in-game
            if self.isInGame {
                print("⚠️ [BACKGROUND] App in background > 2s - kicking to lobby")
                DispatchQueue.main.async {
                    self.leaveGameAndReturnToLobby()
                }
            }
        }

        backgroundKickTimer = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0, execute: workItem)
    }

    func appDidBecomeActive() {
        // Cancel the background kick if app returns before 2s
        backgroundKickTimer?.cancel()
        backgroundKickTimer = nil

        if let bgTime = backgroundTime {
            let duration = Date().timeIntervalSince(bgTime)
            print("📱 [BACKGROUND] App returned after \(String(format: "%.1f", duration))s")
            backgroundTime = nil

            // If we're still in-game, reset interaction time
            if isInGame {
                recordInteraction()
            }
        } else {
            print("📱 [BACKGROUND] App became active")
        }
    }
}

// MARK: - Stroke Helpers
extension GameState {
    private func splitStrokeAcrossTiles(from: CGPoint, to: CGPoint) -> [(start: CGPoint, end: CGPoint, tileId: Int)] {
        var segments: [(CGPoint, CGPoint, Int)] = []
        var currentStart = clampPointToCanvas(from)
        let finalTarget = clampPointToCanvas(to)
        var safetyCounter = 0

        while safetyCounter < 4 {
            let startTile = tileId(for: currentStart)
            let endTile = tileId(for: finalTarget)

            if startTile == endTile {
                segments.append((currentStart, finalTarget, startTile))
                break
            }

            if let boundaryHit = boundaryIntersection(from: currentStart, to: finalTarget) {
                segments.append((currentStart, boundaryHit.point, startTile))
                currentStart = boundaryHit.nextStart
            } else {
                segments.append((currentStart, finalTarget, startTile))
                break
            }

            safetyCounter += 1
        }

        if segments.isEmpty {
            let tile = tileId(for: currentStart)
            segments.append((currentStart, finalTarget, tile))
        }

        return segments
    }

    private func boundaryIntersection(from start: CGPoint, to end: CGPoint) -> (point: CGPoint, nextStart: CGPoint)? {
        var candidates: [(t: CGFloat, point: CGPoint, nextStart: CGPoint)] = []
        let startColumn = tileColumn(for: start)
        let startRow = tileRow(for: start)
        let endColumn = tileColumn(for: end)
        let endRow = tileRow(for: end)

        if startColumn != endColumn {
            let boundaryX: CGFloat = end.x > start.x ? CGFloat((startColumn + 1) * 512) : CGFloat(startColumn * 512)
            let deltaX = end.x - start.x
            if deltaX != 0 {
                let t = (boundaryX - start.x) / deltaX
                if t > 0 && t < 1 {
                    let y = start.y + (end.y - start.y) * t
                    let intersectionPoint = clampPointToCanvas(CGPoint(x: boundaryX, y: y))
                    let epsilon: CGFloat = end.x > start.x ? 0.01 : -0.01
                    let nextStart = clampPointToCanvas(CGPoint(x: boundaryX + epsilon, y: y))
                    candidates.append((t, intersectionPoint, nextStart))
                }
            }
        }

        if startRow != endRow {
            let boundaryY: CGFloat = end.y > start.y ? CGFloat((startRow + 1) * 512) : CGFloat(startRow * 512)
            let deltaY = end.y - start.y
            if deltaY != 0 {
                let t = (boundaryY - start.y) / deltaY
                if t > 0 && t < 1 {
                    let x = start.x + (end.x - start.x) * t
                    let intersectionPoint = clampPointToCanvas(CGPoint(x: x, y: boundaryY))
                    let epsilon: CGFloat = end.y > start.y ? 0.01 : -0.01
                    let nextStart = clampPointToCanvas(CGPoint(x: x, y: boundaryY + epsilon))
                    candidates.append((t, intersectionPoint, nextStart))
                }
            }
        }

        guard let best = candidates.sorted(by: { $0.t < $1.t }).first else {
            return nil
        }

        return (best.point, best.nextStart)
    }

    private func sendStrokeSegment(start: CGPoint, end: CGPoint, tileId: Int, brushSize: Double, color: String) {
        let localFromX = localCoordinate(for: start.x, tileId: tileId, isX: true)
        let localFromY = localCoordinate(for: start.y, tileId: tileId, isX: false)
        let localToX = localCoordinate(for: end.x, tileId: tileId, isX: true)
        let localToY = localCoordinate(for: end.y, tileId: tileId, isX: false)

        // Check if this is an emoji stroke
        // Emoji strokes use the RAW emoji string like "🎨" (from currentStrokePayload which uses selectedEmojiBrush directly)
        let isEmojiStroke = isRawEmoji(color)
        var emojiValue: String? = nil
        var colorValue: String? = nil

        if isEmojiStroke {
            // For emoji, send the raw emoji character directly
            emojiValue = color
            let distance = sqrt(pow(localToX - localFromX, 2) + pow(localToY - localFromY, 2))
            print("🎨 [EMOJI STROKE SENT]=====================================")
            print("   Emoji: \(emojiValue ?? "")")
            print("   Tile ID: \(tileId)")
            print("   Brush Size: \(brushSize)")
            print("   Local Coords: (\(Int(localFromX)), \(Int(localFromY))) → (\(Int(localToX)), \(Int(localToY)))")
            print("   Distance: \(Int(distance))px")
            print("   ================================================")
        } else {
            // Regular color stroke
            colorValue = color
            print("🖌️ [COLOR STROKE] - Color: \(color)")
        }

        // Create message with emoji or color (but not both)
        // Server renders strokes ~15% larger, so reduce brushSize by 15% (multiply by 0.85)
        let message = StrokeSegmentMessage(
            payload: .init(
                tileId: tileId,
                segment: .init(
                    localFromX: localFromX,
                    localFromY: localFromY,
                    localToX: localToX,
                    localToY: localToY,
                    brushSize: brushSize * 0.85,
                    color: colorValue,
                    emoji: emojiValue,
                    emojiStyle: emojiValue != nil ? "ios" : nil
                )
            )
        )
        webSocketService.send(message)

        // For local rendering, wrap emoji in the internal format if needed
        let renderColor: String
        if isEmojiStroke {
            renderColor = StrokeSegment.encodedEmojiColor(color)  // "emoji::🎨" for internal use
        } else {
            renderColor = color
        }

        let segment = StrokeSegment(
            fromX: start.x,
            fromY: start.y,
            toX: end.x,
            toY: end.y,
            brushSize: brushSize,
            color: renderColor
        )
        renderStrokeSegment(segment)
    }

    /// Check if a string is a raw emoji (used by currentStrokePayload when selectedEmojiBrush is set)
    /// Emojis are single Unicode characters (not color hex codes starting with #)
    private func isRawEmoji(_ str: String) -> Bool {
        // Hex colors start with #, emojis don't
        // Emojis are typically 1-2 characters (some are combined with variation selectors or ZWJ)
        return !str.hasPrefix("#") && str.count >= 1 && str.count <= 15 && !CharacterSet.alphanumerics.isSuperset(of: CharacterSet(charactersIn: str))
    }

    private func clampPointToCanvas(_ point: CGPoint) -> CGPoint {
        let clampedX = max(0, min(1023.99, point.x))
        let clampedY = max(0, min(1023.99, point.y))
        return CGPoint(x: clampedX, y: clampedY)
    }

    private func tileId(for point: CGPoint) -> Int {
        let column = tileColumn(for: point)
        let row = tileRow(for: point)
        return row * 2 + column
    }

    private func tileColumn(for point: CGPoint) -> Int {
        return min(max(Int(point.x / 512.0), 0), 1)
    }

    private func tileRow(for point: CGPoint) -> Int {
        return min(max(Int(point.y / 512.0), 0), 1)
    }

    private func localCoordinate(for globalValue: Double, tileId: Int, isX: Bool) -> Double {
        let index = isX ? tileId % 2 : tileId / 2
        let offset = Double(index) * 512.0
        let local = globalValue - offset
        return max(0, min(511.999, local))
    }

    private func awardPaintingKarmaIfNeeded() {
        let now = Date()
        if let last = lastLocalKarmaAwardTime,
           now.timeIntervalSince(last) < 1.0 {
            return
        }

        lastLocalKarmaAwardTime = now
        awardLocalKarma(points: 1)
    }

    private func awardLocalKarma(points: Int) {
        guard points != 0 else { return }
        let existing = currentProfile?.karma ?? UserPreferences.shared.loadKarma()
        let updated = existing + points
        UserPreferences.shared.saveKarma(updated)

        if let profile = currentProfile {
            let updatedProfile = Profile(
                id: profile.id,
                username: profile.username,
                emoji: profile.emoji,
                coins: profile.coins,
                karma: updated
            )
            currentProfile = updatedProfile
        }

        if isInGame {
            syncCurrentPlayerPosition()
        }
    }

    private func triggerAlert(for username: String, type: PlayerAlertType) {
        guard !username.isEmpty else { return }
        let alert = PlayerAlert(type: type, timestamp: Date())
        playerAlerts[username] = alert

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let current = self?.playerAlerts[username] else { return }
            if current.timestamp == alert.timestamp {
                self?.playerAlerts.removeValue(forKey: username)
            }
        }
    }

    func showFloatingText(for username: String, text: String, isPositive: Bool) {
        floatingTexts[username] = FloatingText(text: text, timestamp: Date(), isPositive: isPositive)

        // Auto-remove after 2 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            if let current = self?.floatingTexts[username], current.timestamp == current.timestamp {
                self?.floatingTexts.removeValue(forKey: username)
            }
        }
    }

    private func updateOtherPlayer(username: String, updateBlock: (inout Player) -> Void) {
        if let entry = otherPlayers.first(where: { $0.value.username == username }) {
            var player = entry.value
            updateBlock(&player)
            otherPlayers[entry.key] = player
        }
    }

    private func updateLobbyPlayer(username: String, updateBlock: (inout Player) -> Void) {
        if let index = lobbyPlayers.firstIndex(where: { $0.username == username }) {
            var player = lobbyPlayers[index]
            updateBlock(&player)
            lobbyPlayers[index] = player
        }
    }

    private func applyLocalProfileUpdate(username: String, emoji: String) {
        let previousUsername = currentProfile?.username

        if var profile = currentProfile {
            let updated = Profile(
                id: profile.id,
                username: username,
                emoji: emoji,
                coins: profile.coins,
                karma: profile.karma
            )
            profile = updated
            currentProfile = profile
        } else {
            let storedCoins = UserPreferences.shared.loadCoins()
            let storedKarma = UserPreferences.shared.loadKarma()
            currentProfile = Profile(
                id: userId ?? -1,
                username: username,
                emoji: emoji,
                coins: storedCoins,
                karma: storedKarma
            )
        }

        if var me = myPlayer {
            me.username = username
            me.emoji = emoji
            myPlayer = me
        }

        lobbyPlayers = lobbyPlayers.map { player in
            var updatedPlayer = player
            if player.id == userId || player.username == previousUsername {
                updatedPlayer.username = username
                updatedPlayer.emoji = emoji
            }
            return updatedPlayer
        }
    }

    func updateBrushSize(_ size: Double) {
        lastKnownBrushSize = size
    }

    private func ensureLerpState(for id: Int, x: Double, y: Double) {
        if playerLerpStates[id] == nil {
            playerLerpStates[id] = EntityLerpState(currentX: x, currentY: y, targetX: x, targetY: y)
        }
    }

    private func updateLerpTarget(for id: Int, x: Double, y: Double) {
        if var state = playerLerpStates[id] {
            state.targetX = x
            state.targetY = y
            playerLerpStates[id] = state
        } else {
            playerLerpStates[id] = EntityLerpState(currentX: x, currentY: y, targetX: x, targetY: y)
        }
    }

    func displayPosition(for player: Player) -> CGPoint {
        if let state = playerLerpStates[player.id] {
            return CGPoint(x: state.currentX, y: state.currentY)
        } else {
            // No lerp state yet - use direct position
            return CGPoint(x: player.x, y: player.y)
        }
    }

    private func startLerpTimer() {
        lerpTimer?.invalidate()
        lerpTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            self?.updateLerpPositions()
        }
    }

    private func stopLerpTimer() {
        lerpTimer?.invalidate()
        lerpTimer = nil
    }

    private func updateLerpPositions() {
        DispatchQueue.main.async {
            for (id, var state) in self.playerLerpStates {
                state.currentX = self.lerpPosition(current: state.currentX, target: state.targetX)
                state.currentY = self.lerpPosition(current: state.currentY, target: state.targetY)
                self.playerLerpStates[id] = state
            }
            self.detectCollisions()
        }
    }

    private func lerpPosition(current: Double, target: Double, maxMove: Double = 8.0, lerpSpeed: Double = 0.25) -> Double {
        let diff = target - current
        if abs(diff) <= 0.5 {
            return target
        }
        let direction = diff >= 0 ? 1.0 : -1.0
        let delta = direction * min(abs(diff) * lerpSpeed, maxMove)
        return current + delta
    }

    private func detectCollisions() {
        guard let me = myPlayer else { return }

        // Don't attack if I'm not alive, dead, or shielded
        guard me.alive && me.lives > 0 && !me.isShielded else { return }

        // Base icon size matches rendering (32px base * iconScale)
        let MY_BASE_SIZE: Double = 32.0
        let myIconRadius = (MY_BASE_SIZE * me.iconScale) / 2.0

        for (id, state) in playerLerpStates {
            if id == me.id { continue }
            guard let player = otherPlayers[id] else { continue }

            // Skip if target is dead, not alive, spawning, or shielded
            guard player.alive && player.lives > 0 else { continue }
            if player.isSpawning || player.isShielded { continue }

            // Calculate target radius based on their iconScale
            let TARGET_BASE_SIZE: Double = 32.0
            let targetIconRadius = (TARGET_BASE_SIZE * player.iconScale) / 2.0

            // Hit distance is sum of both radii (collision when circles overlap)
            let hitDistance = myIconRadius + targetIconRadius

            // Use lerped position for smooth collision detection
            let dx = state.currentX - me.x
            let dy = state.currentY - me.y
            let distance = hypot(dx, dy)

            // Collision detected - icons are overlapping
            if distance < hitDistance {
                attemptAutoAttack(on: player)
            }
        }
    }

    private func attemptAutoAttack(on player: Player) {
        // Double-check target is still valid before attacking
        guard player.alive && player.lives > 0 && !player.isSpawning && !player.isShielded else {
            return
        }

        let cooldown: TimeInterval = 1.5
        if let last = lastAutoAttackTimes[player.id], Date().timeIntervalSince(last) < cooldown {
            return
        }

        guard let me = myPlayer, me.alive && me.lives > 0 else {
            return
        }

        lastAutoAttackTimes[player.id] = Date()

        let attackMessage = AttackPlayerMessage(payload: .init(
            targetUsername: player.username,
            x: me.x,
            y: me.y,
            brushSize: lastKnownBrushSize
        ))
        webSocketService.send(attackMessage)

        print("⚔️ [ATTACK] Auto-attacking \(player.emoji) \(player.username) at distance")
    }
}

// MARK: - WebSocketServiceDelegate
extension GameState: WebSocketServiceDelegate {
    func webSocketDidReceiveMessage(_ message: String) {
        guard let data = message.data(using: .utf8),
              let json = try? JSONDecoder().decode([String: AnyCodable].self, from: data),
              let typeValue = json["type"]?.value as? String else {
            print("❌ [WS] Failed to parse message")
            return
        }

        // Log message type (but not full content to avoid spam)
        if typeValue != "lobby_state" && typeValue != "stroke_broadcast" {
            print("📨 [WS] Received: \(typeValue)")
        }

        guard let payloadDict = json["payload"]?.value as? [String: Any],
              let payloadData = try? JSONSerialization.data(withJSONObject: payloadDict) else {
            print("❌ [WS] Failed to parse payload for: \(typeValue)")
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
        case "tile_frozen_error":
            handleTileFrozenError(payloadData)
        case "player_position":
            handlePlayerPosition(payloadData)
        case "tile_unfrozen":
            handleTileUnfrozen(payloadData)
        case "player_joined":
            handlePlayerJoined(payloadData)
        case "stroke_history":
            // Server sends this on join - contains recent strokes
            // We can ignore since we get full tile state
            break
        default:
            print("Unknown message type: \(typeValue)")
        }
    }

    // MARK: - Message Handlers
    private func handleSessionInfo(_ data: Data) {
        guard let info = try? JSONDecoder().decode(SessionInfo.self, from: data) else { return }

        userId = info.userId
        sessionId = info.sessionId

        print("✅ [SESSION] Received session info:")
        print("   UserID: \(info.userId)")
        print("   SessionID: \(info.sessionId)")
        print("   Spawn: (\(Int(info.spawnX)), \(Int(info.spawnY)))")

        // Create my player with spawn position
        myPlayer = Player(
            id: info.userId,
            username: currentProfile?.username ?? "",
            emoji: currentProfile?.emoji ?? "😀",
            x: info.spawnX,
            y: info.spawnY,
            color: "#FFFFFF",
            lives: 3,
            isBot: false
        )

        print("✅ [SESSION] myPlayer created: \(myPlayer?.username ?? "nil") at (\(Int(myPlayer?.x ?? 0)), \(Int(myPlayer?.y ?? 0)))")

        // Request all tiles immediately after connecting
        let getTilesMessage = GetTilesMessage(payload: .init())
        webSocketService.send(getTilesMessage)
        syncCurrentPlayerPosition()
        attemptDeferredJoinIfNeeded()
    }

    private func handleAllTilesState(_ data: Data) {
        guard let state = try? JSONDecoder().decode(AllTilesState.self, from: data) else {
            print("❌ Failed to decode all_tiles_state")
            return
        }

        print("[TILES] Received all_tiles_state with \(state.tiles.count) tiles")

        // CRITICAL: Decode images on BACKGROUND thread to prevent UI freeze
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var loadedImages: [Int: UIImage] = [:]

            for (index, tileData) in state.tiles.enumerated() {
                print("[TILE] Loading tile \(index), data size: \(tileData.imageData.count) chars")

                guard let imageData = Data(base64Encoded: tileData.imageData),
                      let image = UIImage(data: imageData) else {
                    print("❌ Failed to decode tile \(index) base64 image")
                    continue
                }

                print("[TILE] Decoded tile \(index): \(image.size)")
                loadedImages[index] = image
            }

            // Update UI on main thread (fast - just pointer assignment)
            DispatchQueue.main.async {
                guard let self = self else { return }
                for (index, image) in loadedImages {
                    self.tiles[index]?.updateBaseImage(image)
                }
                print("✅ [TILES] All \(loadedImages.count) tiles loaded - game ready!")

                // Mark tiles as loaded
                self.tilesLoaded = true

                // If we were waiting for tiles to show game, show it now
                if self.waitingForTilesToShowGame {
                    print("✅ [TILES] Tiles loaded during zoom - transitioning to game")
                    self.hideTransitionOverlay = true
                    self.readyToShowGame = true
                    self.waitingForTilesToShowGame = false
                }
            }
        }
    }

    private func handleTileState(_ data: Data) {
        guard let state = try? JSONDecoder().decode(TileState.self, from: data) else { return }

        print("[TILE] Received tile_state for tile \(state.tileId), data size: \(state.imageData.count) chars")

        // CRITICAL: Decode on BACKGROUND thread to prevent UI freeze
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let imageData = Data(base64Encoded: state.imageData),
                  let image = UIImage(data: imageData) else {
                print("❌ Failed to decode tile \(state.tileId) image")
                return
            }

            print("[TILE] Decoded tile \(state.tileId): \(image.size)")

            // Update UI on main thread (fast)
            DispatchQueue.main.async {
                guard let self = self else { return }
                // CRITICAL FIX: Clear strokes FIRST (they're now baked into AI image)
                self.tiles[state.tileId]?.clearStrokes()
                // THEN update base image with new AI result
                self.tiles[state.tileId]?.updateBaseImage(image)
                print("[TILE] Tile \(state.tileId) updated with AI image, strokes cleared")

                // If the player was fighting AI on this tile, trigger reveal
                if self.aiChallengeActiveTile == state.tileId {
                    self.aiChallengeActiveTile = nil
                    self.aiRevealImage = image
                    // Auto-dismiss reveal after 6s
                    DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
                        self?.aiRevealImage = nil
                    }
                }

                // Check if all tiles are now loaded
                self.checkIfAllTilesLoaded()
            }
        }
    }

    private func checkIfAllTilesLoaded() {
        var loadedCount = 0
        for i in 0..<4 {
            if tiles[i]?.baseImage != nil {
                loadedCount += 1
            }
        }

        if loadedCount == 4 && !tilesLoaded {
            print("✅ [TILES] All 4 tiles now loaded (\(loadedCount)/4)")
            tilesLoaded = true

            // If we were waiting for tiles to show game, show it now
            if waitingForTilesToShowGame {
                print("✅ [TILES] All tiles loaded during zoom - transitioning to game")
                hideTransitionOverlay = true
                readyToShowGame = true
                waitingForTilesToShowGame = false
            }
        }
    }

    private func handleStrokeBroadcast(_ data: Data) {
        guard let broadcast = try? JSONDecoder().decode(StrokeBroadcast.self, from: data) else { return }

        // Render strokes from other players
        if broadcast.userId == userId {
            print("[STROKE] Received own stroke broadcast - already rendered locally")
            return
        }

        let segment = broadcast.toGlobalSegment()
        renderStrokeSegment(segment)
        print("[STROKE] Rendered broadcast from user \(broadcast.userId) on tile \(broadcast.tileId)")
    }

    private func handleLobbyState(_ data: Data) {
        guard let state = try? JSONDecoder().decode(LobbyState.self, from: data) else { return }

        // Update lobby players list
        var allPlayers: [Player] = []

        // Active players
        for playerData in state.activePlayers {
            // Convert isShielded boolean to shieldUntil Date
            let shieldUntil: Date? = (playerData.isShielded == true) ? Date().addingTimeInterval(2.0) : nil

            let player = Player(
                id: playerData.userId,
                username: playerData.username,
                emoji: playerData.emoji,
                x: playerData.x ?? 256,
                y: playerData.y ?? 256,
                color: playerData.color ?? "#FFFFFF",
                lives: playerData.lives,
                isBot: false,
                iconScale: playerData.iconScale ?? 1.0,
                isSpawning: playerData.isSpawning ?? false,
                alive: playerData.alive,
                shieldUntil: shieldUntil
            )
            allPlayers.append(player)

            // Update in-game players ONLY when actively in game
            if isInGame {
                if player.id == userId {
                    // Update myPlayer with server data (lives, shield, etc.) but keep local position for smooth movement
                    if var myPlayerCopy = myPlayer {
                        myPlayerCopy.lives = player.lives
                        myPlayerCopy.alive = player.alive
                        myPlayerCopy.shieldUntil = shieldUntil  // Update shield from server
                        myPlayerCopy.isSpawning = player.isSpawning
                        myPlayerCopy.iconScale = player.iconScale
                        myPlayerCopy.color = player.color
                        let serverPoint = CGPoint(x: player.x, y: player.y)
                        let localPoint = CGPoint(x: myPlayerCopy.x, y: myPlayerCopy.y)
                        let distance = hypot(serverPoint.x - localPoint.x, serverPoint.y - localPoint.y)

                        if !myPlayerCopy.alive || player.isSpawning || distance > 40 {
                            myPlayerCopy.x = player.x
                            myPlayerCopy.y = player.y
                        }
                        myPlayer = myPlayerCopy
                    } else {
                        myPlayer = player
                    }
                } else {
                    // Update other players with positions
                    otherPlayers[player.id] = player
                    updateLerpTarget(for: player.id, x: player.x, y: player.y)
                }
            }
        }

        // Bots
        for botData in state.bots {
            // Convert isShielded boolean to shieldUntil Date
            let shieldUntil: Date? = (botData.isShielded == true) ? Date().addingTimeInterval(2.0) : nil

            let bot = Player(
                id: botData.userId,
                username: botData.username,
                emoji: botData.emoji,
                x: botData.x ?? 256,
                y: botData.y ?? 256,
                color: botData.color,
                lives: botData.lives,
                isBot: true,
                iconScale: botData.iconScale ?? 1.0,
                isSpawning: botData.isSpawning ?? false,
                alive: botData.alive,
                shieldUntil: shieldUntil
            )
            allPlayers.append(bot)

            // Update in-game bots ONLY when actively in game
            if isInGame {
                otherPlayers[bot.id] = bot
                updateLerpTarget(for: bot.id, x: bot.x, y: bot.y)
            }
        }

        lobbyPlayers = allPlayers
        if isInGame {
            let ids = Set(allPlayers.map { $0.id })
            playerLerpStates = playerLerpStates.filter { ids.contains($0.key) }
        }
    }

    private func handleCountdownUpdate(_ data: Data) {
        guard let update = try? JSONDecoder().decode(CountdownUpdate.self, from: data) else { return }

        activeTileId = update.activeTile

        for tileCountdown in update.tiles {
            tiles[tileCountdown.id]?.countdown = tileCountdown.countdown
        }
    }

    private func handleAIProcessingStart(_ data: Data) {
        guard let start = try? JSONDecoder().decode(AIProcessingStart.self, from: data) else { return }
        print("[AI] Processing started on tile \(start.tileId)")
        tiles[start.tileId]?.isFrozen = true

        // If the current player is on the AI's tile, trigger the "Fight the AI!" challenge
        if let myTile = myPlayer?.currentTileId, myTile == start.tileId {
            aiChallengeActiveTile = start.tileId
            let msg = Self.aiChallengeMessages.randomElement() ?? "⚡️ FIGHT THE SLOP!"
            aiChallengeMessage = msg
            // Auto-dismiss after 4 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                if self?.aiChallengeActiveTile == start.tileId {
                    self?.aiChallengeMessage = nil
                }
            }
        }
    }

    private func handleAIComplete(_ data: Data) {
        guard let complete = try? JSONDecoder().decode(AIComplete.self, from: data) else { return }

        print("[AI] Complete on tile \(complete.tileId)")
        tiles[complete.tileId]?.isFrozen = false
        if isInGame {
            syncCurrentPlayerPosition()
        }

        // If the player was fighting the AI on this tile, award 1 coin and queue reveal
        if aiChallengeActiveTile == complete.tileId {
            aiChallengeMessage = nil
            aiChallengeCoinsEarned = 1
            // Don't clear aiChallengeActiveTile yet — tile_state will show the reveal
        }

        // DON'T clear strokes here! The new AI image will come in tile_state
        // and includes the strokes baked in. We clear strokes when we receive tile_state.
    }

    private func handleChatBroadcast(_ data: Data) {
        guard let chat = try? JSONDecoder().decode(ChatBroadcast.self, from: data) else { return }
        chatMessages.append(chat)

        if chatMessages.count > 100 {
            chatMessages.removeFirst(chatMessages.count - 100)
        }
    }

    private func handlePlayerHit(_ data: Data) {
        guard let hit = try? JSONDecoder().decode(PlayerHit.self, from: data) else { return }
        let shieldUntilDate = hit.shieldDuration.map { Date().addingTimeInterval(Double($0) / 1000.0) }
        let victimIsMe = hit.victim == currentProfile?.username

        if victimIsMe {
            if var me = myPlayer {
                me.lives = hit.lives
                me.alive = hit.lives > 0
                if hit.lives <= 0 {
                    me.isSpawning = false
                }
                if let shieldUntilDate {
                    me.shieldUntil = shieldUntilDate
                    print("🛡️ Shield active for \(hit.shieldDuration ?? 0)ms")
                }
                myPlayer = me
            }

            if hit.lives <= 0 {
                UserPreferences.shared.incrementDeathCount()
            }

            DispatchQueue.main.async {
                let impact = UIImpactFeedbackGenerator(style: .heavy)
                impact.prepare()
                impact.impactOccurred()
            }
        } else {
            updateOtherPlayer(username: hit.victim) { player in
                player.lives = hit.lives
                player.alive = hit.lives > 0
                if hit.lives <= 0 {
                    player.isSpawning = false
                }
                if let shieldUntilDate {
                    player.shieldUntil = shieldUntilDate
                }
            }
        }

        updateLobbyPlayer(username: hit.victim) { player in
            player.lives = hit.lives
            player.alive = hit.lives > 0
            if let shieldUntilDate {
                player.shieldUntil = shieldUntilDate
            }
        }

        if hit.killer == currentProfile?.username {
            if hit.lives <= 0 {
                UserPreferences.shared.incrementKillCount()
                syncCurrentPlayerPosition()
            }

            // Haptic feedback when successfully hitting someone (error/notification style)
            DispatchQueue.main.async {
                let impact = UINotificationFeedbackGenerator()
                impact.prepare()
                impact.notificationOccurred(.success)
            }
        }

        triggerAlert(for: hit.victim, type: .hit)
        triggerAlert(for: hit.killer, type: .attack)

        // Show floating text for hit (negative karma)
        showFloatingText(for: hit.victim, text: "-10", isPositive: false)

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
        let shieldDuration: TimeInterval = 2.0

        let applyRespawn: (inout Player) -> Void = { player in
            player.lives = 3
            player.alive = true
            player.isSpawning = true
            player.color = respawn.color
            player.shieldUntil = Date().addingTimeInterval(shieldDuration)
        }

        if respawn.username == currentProfile?.username {
            if var me = myPlayer {
                applyRespawn(&me)
                myPlayer = me
            }
        } else {
            updateOtherPlayer(username: respawn.username, updateBlock: applyRespawn)
        }

        updateLobbyPlayer(username: respawn.username, updateBlock: applyRespawn)

        DispatchQueue.main.asyncAfter(deadline: .now() + shieldDuration) { [weak self] in
            guard let self = self else { return }
            if respawn.username == self.currentProfile?.username {
                self.myPlayer?.isSpawning = false
            } else {
                self.updateOtherPlayer(username: respawn.username) { player in
                    player.isSpawning = false
                }
            }
            self.updateLobbyPlayer(username: respawn.username) { player in
                player.isSpawning = false
            }
        }

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

    private func handlePlayerPosition(_ data: Data) {
        guard let update = try? JSONDecoder().decode(PlayerPositionUpdate.self, from: data) else { return }

        // Ignore my own updates
        if update.userId == userId {
            return
        }

        DispatchQueue.main.async {
            var player = self.otherPlayers[update.userId]

            if player == nil {
                if let lobbyPlayer = self.lobbyPlayers.first(where: { $0.id == update.userId }) {
                    player = lobbyPlayer
                } else {
                    player = Player(
                        id: update.userId,
                        username: "Player \(update.userId)",
                        emoji: update.emoji,
                        x: update.x,
                        y: update.y,
                        color: update.color,
                        lives: 3,
                        isBot: false
                    )
                }
            }

            player?.x = update.x
            player?.y = update.y

            player?.emoji = update.emoji
            player?.color = update.color

            if let updatedPlayer = player {
                self.otherPlayers[update.userId] = updatedPlayer
            }

            self.updateLerpTarget(for: update.userId, x: update.x, y: update.y)
            self.ensureLerpState(for: update.userId, x: update.x, y: update.y)
        }
    }

    private func handleTileFrozenError(_ data: Data) {
        guard let error = try? JSONDecoder().decode(TileFrozenError.self, from: data) else { return }
        print("Tile \(error.tileId) is frozen: \(error.message)")
    }

    private func handleTileUnfrozen(_ data: Data) {
        // Decode tileId from payload
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let tileId = json["tileId"] as? Int {
            tiles[tileId]?.isFrozen = false
            print("[AI] Tile \(tileId) unfrozen - can paint again")
        }
    }

    private func handlePlayerJoined(_ data: Data) {
        // Player successfully joined the game
        print("✅ [PLAYER] Successfully joined game - now active player")
        print("   hasJoinedGame: \(hasJoinedGame) → true")
        print("   isInGame: \(isInGame) → true")
        print("   myPlayer: \(myPlayer != nil ? "exists" : "nil")")
        print("   userId: \(userId ?? -1)")
        print("   currentProfile: \(currentProfile?.username ?? "nil")")

        // CRITICAL: If myPlayer is nil, we need to create it NOW
        if myPlayer == nil {
            print("⚠️ [PLAYER] myPlayer is nil after player_joined - creating emergency player")

            // Try to get position from lobby state or use default
            let defaultX = Double.random(in: 100...900)
            let defaultY = Double.random(in: 100...900)

            myPlayer = Player(
                id: userId ?? -1,
                username: currentProfile?.username ?? "Unknown",
                emoji: currentProfile?.emoji ?? "😀",
                x: defaultX,
                y: defaultY,
                color: "#3B82F6",
                lives: 3,
                isBot: false
            )
            print("✅ [PLAYER] Emergency player created at (\(Int(defaultX)), \(Int(defaultY)))")
        }

        // Confirm we're in game
        if !hasJoinedGame {
            hasJoinedGame = true
            isInGame = true
        }

        startPlaySessionTracking()
        syncCurrentPlayerPosition()

        // Verify player can now paint
        print("🎨 [PLAYER] Player should now be able to paint and chat!")
    }

    private func startPlaySessionTracking() {
        guard playSessionStart == nil else { return }
        playSessionStart = Date()
    }

    private func stopPlaySessionTracking() {
        guard let start = playSessionStart else { return }
        let duration = Date().timeIntervalSince(start)
        UserPreferences.shared.addPlaytime(seconds: duration)
        playSessionStart = nil
    }

    // MARK: - Painting Session Methods (My Moments)

    func startPaintingSession() {
        guard !isPaintingSessionActive else {
            print("⚠️ Painting session already active")
            return
        }

        guard let player = myPlayer,
              let profile = currentProfile,
              let userId = userId else {
            print("❌ Cannot start painting session: missing player/profile/userId")
            return
        }

        // Get current tile player is on
        let tileX = Int(player.x / 512.0)
        let tileY = Int(player.y / 512.0)

        Task { @MainActor in
            do {
                let response = try await apiClient.startPaintingSession(
                    userId: String(userId),
                    profileId: String(profile.id),
                    username: profile.username,
                    emoji: profile.emoji,
                    tileX: tileX,
                    tileY: tileY
                )

                currentPaintingSessionId = response.sessionId
                isPaintingSessionActive = true
                paintingSessionStartTime = Date()

                print("🎨 Started painting session: \(response.sessionId)")
                print("⏱️  Will capture 10 minutes of timelapse (5 min before + 5 min after)")

                // Start auto-stop timer (stop after 60 seconds of inactivity)
                resetPaintingSessionTimer()

            } catch {
                print("❌ Failed to start painting session: \(error)")
            }
        }
    }

    func stopPaintingSession(snapshotData: String? = nil) {
        guard isPaintingSessionActive, let sessionId = currentPaintingSessionId else {
            print("⚠️ No active painting session to stop")
            return
        }

        // Cancel auto-stop timer
        paintingSessionTimer?.invalidate()
        paintingSessionTimer = nil

        Task { @MainActor in
            do {
                let response = try await apiClient.stopPaintingSession(
                    sessionId: sessionId,
                    snapshotData: snapshotData
                )

                print("🎨 Stopped painting session: \(sessionId)")
                print("⏱️  Duration: \(response.durationSeconds)s")
                print("📹 Captured \(response.videoSegments) video segments")

                currentPaintingSessionId = nil
                isPaintingSessionActive = false
                paintingSessionStartTime = nil

                // TODO: Show user notification that their moment is ready

            } catch {
                print("❌ Failed to stop painting session: \(error)")
                // Still clear local state even if API call failed
                currentPaintingSessionId = nil
                isPaintingSessionActive = false
                paintingSessionStartTime = nil
            }
        }
    }

    private func resetPaintingSessionTimer() {
        paintingSessionTimer?.invalidate()

        // Auto-stop session after 60 seconds of no painting
        paintingSessionTimer = Timer.scheduledTimer(withTimeInterval: 60.0, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            print("⏱️  Auto-stopping painting session due to inactivity")
            self.stopPaintingSession()
        }
    }

    // Method to capture canvas as snapshot (to be implemented)
    func captureCanvasSnapshot() -> String? {
        // TODO: Implement canvas snapshot capture
        // This would render the current viewport to a UIImage and convert to base64
        // For now, return nil (backend can still capture server-side timelapse frame)
        return nil
    }
}

// SessionInfo is now in MessageModels.swift with spawn position
