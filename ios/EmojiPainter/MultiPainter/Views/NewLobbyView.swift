import SwiftUI
import UIKit

// Safe array subscript
extension Array {
    subscript(safe index: Int) -> Element? {
        return indices.contains(index) ? self[index] : nil
    }
}

private struct PreviewFramePreferenceKey: PreferenceKey {
    static var defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if next != .zero {
            value = next
        }
    }
}

struct NewLobbyView: View {
    @EnvironmentObject var gameState: GameState
    @StateObject private var gameManager = GameManager()
    @State private var showSettings = false
    @State private var showTimelapse = false
    @State private var showLeaderboard = false
    @State private var leaderboardEmojiIndex = 0
    @State private var isMiniChatVisible = false
    @State private var chatOffset: CGSize = .zero
    @State private var storedChatOffset: CGSize = .zero
    @State private var chatAutoOpenWorkItem: DispatchWorkItem?
    @State private var chatAutoCloseWorkItem: DispatchWorkItem?
    @State private var userOverrodeChat = false
    @State private var showProfileEditor = false
    @State private var pendingJoin = false
    @State private var didPromptInitialProfile = false
    @State private var isPaintButtonActive = false
    @State private var previewGlobalFrame: CGRect = .zero
    @State private var rootSize: CGSize = .zero
    @State private var glowAmount: CGFloat = 0.35
    @State private var didStartGlowAnimation = false

    // Track if chat has been auto-opened this session
    private static var hasAutoOpenedChat = false

    // Intro animation flags
    @State private var showPreviewPanel = false
    @State private var showJoinSection = false
    @State private var showFooterRow = false

    // Slide-up entrance animation for join button
    @State private var joinButtonOffset: CGSize = .zero

    // Paint button emoji animation
    @State private var paintEmoji: String = "🖌️"
    @State private var emojiAnimationSpeed: TimeInterval = 0.1
    @State private var emojiTimer: Timer?
    private let paintEmojis = ["🖌️", "🖊️", "🖋️", "🗡️", "🪠", "🖍️", "🪄"]


    // Pinch-to-zoom for the timelapse preview only (rest of the lobby UI stays put)
    @State private var previewZoom: CGFloat = 1
    @State private var previewZoomBase: CGFloat = 1
    @State private var previewPan: CGSize = .zero
    @State private var previewPanBase: CGSize = .zero

    // Transition overlay
    @State private var showJoinTransition = false
    @State private var transitionScale: CGFloat = 1.0
    @State private var transitionAnchor: UnitPoint = .center
    @State private var showTransitionText = false
    @State private var textShootOffset: CGFloat = 0

    var body: some View {
        GeometryReader { rootGeo in
            ZStack {
                LinearGradient(
                    colors: [Color.black, Color(white: 0.1)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                VStack(spacing: 24) {
                    HStack {
                        // ❎ Close — only shown when embedded inside EmojiPaint
                        if gameState.onClose != nil {
                            Button(action: { gameState.onClose?() }) {
                                Text("❎")
                                    .font(.system(size: 22))
                                    .frame(width: 44, height: 44)
                                    .background(Circle().fill(Color.white.opacity(0.15)))
                            }
                        }

                        InteractiveLobbyTitle(
                            previewFrame: previewGlobalFrame,
                            containerSize: rootSize
                        )

                        Spacer()

                        // Settings button (both iPad and iPhone)
                        Button(action: { showSettings = true }) {
                            CustomEmojiView("⚙️", size: 26, revealOnTap: false)
                                .frame(width: 48, height: 48)
                                .background(
                                    Circle().fill(Color.white.opacity(0.15))
                                )
                        }
                    }
                    .padding(.top, -20)

                    let isPad = UIDevice.current.userInterfaceIdiom == .pad
                    let isLandscape = rootGeo.size.width > rootGeo.size.height
                    let previewBaseSize: CGFloat = isPad ? 780 : 350
                    let previewSize = previewBaseSize * 0.8
                    let previewYOffset: CGFloat = isPad ? (isLandscape ? 20 : 0) : 0

                    if gameState.waitingListPosition != nil {
                        WaitingListView(
                            players: gameState.lobbyPlayers,
                            position: gameState.waitingListPosition ?? 1,
                            timeRemaining: gameState.waitingListTimeRemaining
                        )
                        .environmentObject(gameState)
                        .frame(width: isPad ? 700 : 380, height: isPad ? 800 : 550)
                        .scaleEffect(showPreviewPanel ? 1 : 0.65)
                        .opacity(showPreviewPanel ? 1 : 0)
                        .animation(.spring(response: 0.9, dampingFraction: 0.7).delay(0.1), value: showPreviewPanel)
                    } else {
                        TimelapsePreview(
                            timelapseImage: gameState.timelapseImage,
                            updateKey: gameState.lastTimelapseUpdate
                        )
                            .frame(width: previewSize, height: previewSize)
                            .offset(y: previewYOffset)
                            .background(
                                GeometryReader { proxy in
                                    Color.clear
                                        .preference(
                                            key: PreviewFramePreferenceKey.self,
                                            value: proxy.frame(in: .global)
                                        )
                                }
                            )
                            .cornerRadius(16)
                            .shadow(color: .black.opacity(0.3), radius: 10, x: 0, y: 5)
                            // Pinch zooms ONLY the preview; drag pans while zoomed;
                            // double-tap resets. The rest of the lobby UI is untouched.
                            .scaleEffect((showPreviewPanel ? 1 : 0.65) * previewZoom)
                            .offset(previewPan)
                            .opacity(showPreviewPanel ? 1 : 0)
                            .animation(.spring(response: 0.9, dampingFraction: 0.7).delay(0.1), value: showPreviewPanel)
                            .gesture(
                                SimultaneousGesture(
                                    MagnificationGesture()
                                        .onChanged { v in
                                            previewZoom = min(max(previewZoomBase * v, 1), 6)
                                        }
                                        .onEnded { _ in
                                            previewZoomBase = previewZoom
                                            if previewZoom <= 1.01 {
                                                previewZoom = 1; previewZoomBase = 1
                                                previewPan = .zero; previewPanBase = .zero
                                            }
                                        },
                                    DragGesture()
                                        .onChanged { v in
                                            guard previewZoom > 1 else { return }
                                            previewPan = CGSize(width: previewPanBase.width + v.translation.width,
                                                                height: previewPanBase.height + v.translation.height)
                                        }
                                        .onEnded { _ in previewPanBase = previewPan }
                                )
                            )
                            .onTapGesture(count: 2) {
                                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                    previewZoom = 1; previewZoomBase = 1
                                    previewPan = .zero; previewPanBase = .zero
                                }
                            }
                    }

                    Spacer()

                    if gameState.canJoinGame {
                        Button(action: {
                            triggerRollingHaptics()
                            triggerPaintButtonAnimation()
                            handleJoinTapped()
                        }) {
                            HStack(spacing: 12) {
                                CustomEmojiView(paintEmoji, size: 28, revealOnTap: false)
                                Text("PAINT NOW")
                                    .appFont(22, weight: .bold)
                            }
                            .frame(maxWidth: isPad ? 460 : .infinity)
                            .frame(height: 62)
                            .foregroundColor(isPaintButtonActive ? Color.purple : .white)
                            .background(
                                RoundedRectangle(cornerRadius: 20)
                                    .fill(isPaintButtonActive ? Color.white : Color.clear)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 20)
                                    .stroke(Color.white.opacity(0.85), lineWidth: 2)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 24)
                                    .stroke(Color.white.opacity(0.4), lineWidth: 1)
                                    .padding(4)
                            )
                            .shadow(
                                color: Color.purple.opacity(Double(isPaintButtonActive ? 0.7 : glowAmount)),
                                radius: (isPaintButtonActive ? 48 : 28) + Double(glowAmount * 10),
                                x: 0,
                                y: 0
                            )
                            .animation(.easeInOut(duration: 0.6), value: isPaintButtonActive)
                            .animation(.easeInOut(duration: 1.8), value: glowAmount)
                        }
                        .offset(joinButtonOffset)
                        .scaleEffect(showJoinSection ? 1 : 0.7)
                        .opacity(showJoinSection ? 1 : 0)
                        .animation(.spring(response: 0.9, dampingFraction: 0.7).delay(0.35), value: showJoinSection)
                    } else {
                        VStack(spacing: 16) {
                            if let position = gameState.waitingListPosition {
                                VStack(spacing: 8) {
                                    Text("Waiting List")
                                        .appFont(18, weight: .semibold)
                                        .foregroundColor(.white.opacity(0.8))

                                    HStack(spacing: 12) {
                                        Text("Position: #\(position)")
                                            .appFont(24, weight: .bold)
                                            .foregroundColor(.yellow)

                                        EmojiLabel("⏱️ \(gameState.waitingListTimeRemaining)s", size: 16, weight: .semibold, color: gameState.waitingListTimeRemaining <= 10 ? .red : .white)
                                    }

                                    Button(action: { gameState.leaveWaitingList() }) {
                                        Text("Leave Queue")
                                            .appFont(14, weight: .semibold)
                                            .foregroundColor(.white.opacity(0.7))
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(
                                    RoundedRectangle(cornerRadius: 16)
                                        .fill(Color.orange.opacity(0.3))
                                )
                            } else {
                                Button(action: { gameState.joinWaitingList() }) {
                                    HStack(spacing: 12) {
                                        Image(systemName: "clock.fill")
                                            .appFont(24)

                                        Text("Join Waiting List")
                                            .appFont(22, weight: .bold)
                                    }
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 60)
                                    .background(
                                        RoundedRectangle(cornerRadius: 16)
                                            .fill(Color.orange)
                                    )
                                }
                            }
                        }
                        .scaleEffect(showJoinSection ? 1 : 0.7)
                        .opacity(showJoinSection ? 1 : 0)
                        .animation(.spring(response: 0.9, dampingFraction: 0.7).delay(0.35), value: showJoinSection)
                    }
                }
                .padding(.horizontal, 30)
                .padding(.bottom, 30)

                VStack {
                    Spacer()
                    let isPadFooter = UIDevice.current.userInterfaceIdiom == .pad

                    // Mini live info strip — floats 150 pts above the active-players row
                    VStack(spacing: 6) {
                        if !gameState.serverReachable {
                            HStack(spacing: 6) {
                                Image(systemName: "wifi.slash")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundColor(.orange)
                                Text("Canvas server offline — preview unavailable")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundColor(.orange.opacity(0.9))
                                Button(action: { gameState.refreshLobbyTimelapse() }) {
                                    Text("Retry")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(Capsule().fill(Color.orange.opacity(0.6)))
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.black.opacity(0.55)))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.orange.opacity(0.4), lineWidth: 1))
                            .padding(.leading, 18)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        }

                        HStack {
                            HStack(spacing: 6) {
                                // Spinning refresh button
                                RefreshSpinButton(isLoading: gameState.isLoadingLobbyFrames) {
                                    gameState.refreshLobbyTimelapse()
                                }
                                .scaleEffect(0.7)
                                .frame(width: 22, height: 22)

                                Circle()
                                    .fill(gameState.serverReachable ? Color.green : Color.red)
                                    .frame(width: 5, height: 5)
                                Text(gameState.serverReachable ? "Live" : "Offline")
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundColor(gameState.serverReachable ? .green : .red)
                                Text("· \(newestLoadedText)")
                                    .font(.system(size: 9))
                                    .foregroundColor(.white.opacity(0.5))
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(Color.black.opacity(0.35)))
                            .padding(.leading, 18)
                            Spacer()
                        }
                    }
                    .animation(.easeInOut(duration: 0.3), value: gameState.serverReachable)
                    .offset(y: -150)

                    HStack(spacing: 12) {
                        Spacer()
                        Text("Active Painters: \(gameState.activePlayerCount)")
                            .appFont(14, weight: .medium)
                            .foregroundColor(.white.opacity(0.7))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.white.opacity(0.1))
                            )

                        // iPad: Show all buttons in a row
                        if isPadFooter {
                            Button(action: {
                                userChoseChat()
                                isMiniChatVisible.toggle()
                            }) {
                                CustomEmojiView("💬", size: 32, revealOnTap: false)
                                    .frame(width: 56, height: 56)
                                    .background(
                                        Circle()
                                            .fill(isMiniChatVisible ? Color.blue.opacity(0.5) : Color.black.opacity(0.5))
                                    )
                                    .overlay(
                                        Circle()
                                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                    )
                            }

                            Button(action: {
                                showLeaderboard = true
                            }) {
                                CustomEmojiView(["🏆", "🏅", "🥇", "🥈", "🥉"][leaderboardEmojiIndex], size: 32, revealOnTap: false)
                                    .frame(width: 56, height: 56)
                                    .background(
                                        Circle()
                                            .fill(Color.black.opacity(0.5))
                                    )
                                    .overlay(
                                        Circle()
                                            .stroke(Color.yellow.opacity(0.3), lineWidth: 1)
                                    )
                            }

                            Button(action: {
                                print("🎬 Opening timelapse viewer")
                                showTimelapse = true
                            }) {
                                CustomEmojiView("⏳", size: 32, revealOnTap: false)
                                    .frame(width: 56, height: 56)
                                    .background(
                                        Circle()
                                            .fill(Color.black.opacity(0.5))
                                    )
                                    .overlay(
                                        Circle()
                                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                    )
                            }
                        } else {
                            // iPhone: Show all buttons (same as iPad but different styling)
                            Button(action: {
                                userChoseChat()
                                isMiniChatVisible.toggle()
                            }) {
                                CustomEmojiView("💬", size: 32, revealOnTap: false)
                                    .frame(width: 56, height: 56)
                                    .background(
                                        Circle()
                                            .fill(isMiniChatVisible ? Color.blue.opacity(0.5) : Color.black.opacity(0.5))
                                    )
                                    .overlay(
                                        Circle()
                                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                    )
                            }

                            Button(action: {
                                showLeaderboard = true
                            }) {
                                CustomEmojiView(["🏆", "🏅", "🥇", "🥈", "🥉"][leaderboardEmojiIndex], size: 32, revealOnTap: false)
                                    .frame(width: 56, height: 56)
                                    .background(
                                        Circle()
                                            .fill(Color.black.opacity(0.5))
                                    )
                                    .overlay(
                                        Circle()
                                            .stroke(Color.yellow.opacity(0.3), lineWidth: 1)
                                    )
                            }

                            Button(action: {
                                print("🎬 Opening timelapse viewer")
                                showTimelapse = true
                            }) {
                                CustomEmojiView("⏳", size: 32, revealOnTap: false)
                                    .frame(width: 56, height: 56)
                                    .background(
                                        Circle()
                                            .fill(Color.black.opacity(0.5))
                                    )
                                    .overlay(
                                        Circle()
                                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                    )
                            }
                        }
                    }
                    .padding(.trailing, 30)
                    .padding(.bottom, 100)
                    .scaleEffect(showFooterRow ? 1 : 0.7)
                    .opacity(showFooterRow ? 1 : 0)
                    .animation(.spring(response: 0.9, dampingFraction: 0.7).delay(0.5), value: showFooterRow)
                }

                if isMiniChatVisible {
                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            MiniChatOverlay(messages: gameState.chatMessages) {
                                userChoseChat()
                                isMiniChatVisible = false
                            }
                            .environmentObject(gameState)
                            .frame(width: 260)
                            .padding(.trailing, 24)
                            .padding(.bottom, 160)
                            .offset(chatOffset)
                            .gesture(
                                DragGesture()
                                    .onChanged { value in
                                        chatOffset = CGSize(
                                            width: storedChatOffset.width + value.translation.width,
                                            height: storedChatOffset.height + value.translation.height
                                        )
                                    }
                                    .onEnded { _ in
                                        storedChatOffset = chatOffset
                                    }
                            )
                        }
                    }
                }

                if gameState.showWaitingListInfo {
                    VStack {
                        InfoBubble(text: "💬 Send a chat message every 30 seconds to stay in queue!")
                            .padding(.top, 100)
                        Spacer()
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .animation(.easeInOut(duration: 0.3), value: gameState.showWaitingListInfo)
                }

                if showSettings {
                    EnhancedSettingsOverlay(isPresented: $showSettings)
                        .environmentObject(gameState)
                }

                if showLeaderboard {
                    ZStack {
                        Color.black.opacity(0.5)
                            .ignoresSafeArea()
                            .onTapGesture {
                                showLeaderboard = false
                            }

                        LeaderboardView(isPresented: $showLeaderboard)
                            .environmentObject(gameManager)
                    }
                    .transition(.opacity)
                }

                if showJoinTransition {
                    ZStack {
                        // Show actual game underneath (blurred during transition)
                        if gameState.hasJoinedGame {
                            NewGameView()
                                .blur(radius: 20)
                                .opacity(0.5)
                        }

                        Color.black.opacity(0.7)
                            .ignoresSafeArea()

                        if showTransitionText {
                            Text("PAINT NOW")
                                .appFont(22, weight: .bold)
                                .foregroundColor(.white)
                                .offset(x: textShootOffset)
                                .opacity(textShootOffset < 200 ? 1 : 0)
                        }

                        if let timelapseImage = gameState.timelapseImage {
                            GeometryReader { geo in
                                let isPad = UIDevice.current.userInterfaceIdiom == .pad
                                let imageSize: CGFloat = isPad ? 780 : 350

                                // Convert global preview position to local coordinates
                                let geoGlobalFrame = geo.frame(in: .global)
                                let centerX = previewGlobalFrame != .zero ? (previewGlobalFrame.midX - geoGlobalFrame.origin.x) : geo.size.width / 2
                                let centerY = previewGlobalFrame != .zero ? (previewGlobalFrame.midY - geoGlobalFrame.origin.y) : geo.size.height / 2

                                Image(uiImage: timelapseImage)
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .frame(width: imageSize, height: imageSize)
                                    .clipShape(RoundedRectangle(cornerRadius: 16))
                                    .scaleEffect(transitionScale, anchor: transitionAnchor)
                                    .position(x: centerX, y: centerY)
                            }
                        }
                    }
                }

                // No loading indicator - zoom continues in background while tiles load
            }
            .onAppear {
                rootSize = rootGeo.size
                startIntroSequence()
            }
            .onChange(of: gameState.hideTransitionOverlay) { shouldHide in
                if shouldHide {
                    showJoinTransition = false
                    gameState.hideTransitionOverlay = false  // Reset flag
                }
            }
            .onChange(of: rootGeo.size) { newSize in
                rootSize = newSize
            }
            .onPreferenceChange(PreviewFramePreferenceKey.self) { newValue in
                if newValue != .zero {
                    previewGlobalFrame = newValue
                }
            }
        }
        .onAppear {
            // Reset transition state so buttons are never permanently greyed out
            isPerformingJoinTransition = false
            isPaintButtonActive = false
            showJoinTransition = false
            showTransitionText = false

            // Start fetching + showing the newest timelapse image continuously,
            // and play the smooth intro animation of the recent frames once.
            gameState.startTimelapseUpdates()
            gameState.loadLast30ImagesForLobby()

            userOverrodeChat = false
            scheduleChatAutoClose()
            scheduleChatAutoOpen()
            startGlowAnimationIfNeeded()
            startEmojiAnimation()

            // Start leaderboard emoji animation
            Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { _ in
                withAnimation(.easeInOut(duration: 0.3)) {
                    leaderboardEmojiIndex = (leaderboardEmojiIndex + 1) % 5
                }
            }

            if !didPromptInitialProfile && !UserPreferences.shared.hasSavedProfile {
                didPromptInitialProfile = true
                pendingJoin = false
                showProfileEditor = true
            }
        }
        .onDisappear {
            gameState.stopTimelapseUpdates()
            chatAutoOpenWorkItem?.cancel()
            chatAutoCloseWorkItem?.cancel()
            stopEmojiAnimation()
        }
        .fullScreenCover(isPresented: $showProfileEditor) {
            ProfileEditorSheet(
                isPresented: $showProfileEditor,
                initialUsername: currentProfileUsername,
                initialEmoji: currentProfileEmoji,
                title: pendingJoin ? "Create Your Profile" : "Edit Profile"
            ) { name, emoji in
                handleProfileSaved(username: name, emoji: emoji)
            }
            .environmentObject(gameState)
        }
        .fullScreenCover(isPresented: $showTimelapse) {
            FullscreenTimelapsePlayer()
                .environmentObject(gameState)
        }
    }

    private func scheduleChatAutoClose() {
        chatAutoCloseWorkItem?.cancel()
        guard !userOverrodeChat else { return }
        let workItem = DispatchWorkItem { [self] in
            if !self.userOverrodeChat && self.isMiniChatVisible {
                withAnimation {
                    self.isMiniChatVisible = false
                }
            }
        }
        chatAutoCloseWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 7, execute: workItem)
    }

    private func scheduleChatAutoOpen() {
        chatAutoOpenWorkItem?.cancel()

        // Only auto-open once per app session
        guard !Self.hasAutoOpenedChat && !userOverrodeChat else { return }

        let workItem = DispatchWorkItem { [self] in
            if !self.userOverrodeChat && !Self.hasAutoOpenedChat {
                withAnimation {
                    self.isMiniChatVisible = true
                }
                // Mark that we've auto-opened the chat
                Self.hasAutoOpenedChat = true
                self.scheduleChatAutoClose()
                // Don't schedule another auto-open after the first one
            }
        }
        chatAutoOpenWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: workItem)
    }

    private func userChoseChat() {
        userOverrodeChat = true
        chatAutoOpenWorkItem?.cancel()
        chatAutoCloseWorkItem?.cancel()
    }

    // Bottom-left lobby controls: animated refresh + live status + "newest loaded".
    private var refreshControls: some View {
        HStack(spacing: 10) {
            RefreshSpinButton(isLoading: gameState.isLoadingLobbyFrames) {
                gameState.refreshLobbyTimelapse()
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Circle()
                        .fill(gameState.serverReachable ? Color.green : Color.red)
                        .frame(width: 7, height: 7)
                    Text(gameState.serverReachable ? "Live" : "Offline")
                        .appFont(11, weight: .semibold)
                        .foregroundColor(gameState.serverReachable ? .green : .red)
                }
                Text(newestLoadedText)
                    .appFont(10)
                    .foregroundColor(.white.opacity(0.6))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Capsule().fill(Color.black.opacity(0.45)))
        .padding(.leading, 18)
        .padding(.bottom, 28)
    }

    private var newestLoadedText: String {
        guard let d = gameState.lastTimelapseUpdate else {
            return gameState.serverReachable ? "Loading…" : "No connection"
        }
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return "Newest " + f.string(from: d)
    }

    private func handleJoinTapped() {
        if UserPreferences.shared.hasSavedProfile {
            performJoinTransition()
        } else {
            pendingJoin = true
            showProfileEditor = true
        }
    }

    private func handleProfileSaved(username: String, emoji: String) {
        Task {
            if username != currentProfileUsername || emoji != currentProfileEmoji {
                await gameState.recreateProfile(username: username, emoji: emoji)
            }
            if pendingJoin {
                pendingJoin = false
                await waitForConnection()
                await MainActor.run {
                    gameState.joinGame()
                }
            }
        }
    }

    private var currentProfileUsername: String {
        if let profile = gameState.currentProfile {
            return profile.username
        }
        return UserPreferences.shared.loadUsername() ?? RandomNameGenerator.randomName()
    }

    private var currentProfileEmoji: String {
        if let profile = gameState.currentProfile {
            return profile.emoji
        }
        return UserPreferences.shared.loadEmoji() ?? EmojiData.randomEmoji()
    }

    private func waitForConnection() async {
        var attempts = 0
        while !gameState.isConnected && attempts < 60 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            attempts += 1
        }
    }

    private func triggerRollingHaptics() {
        let impact = UIImpactFeedbackGenerator(style: .medium)
        impact.prepare()
        impact.impactOccurred()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            let impact2 = UIImpactFeedbackGenerator(style: .light)
            impact2.prepare()
            impact2.impactOccurred()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
            let impact3 = UIImpactFeedbackGenerator(style: .heavy)
            impact3.prepare()
            impact3.impactOccurred()
        }
    }

    private func triggerPaintButtonAnimation() {
        withAnimation(.easeInOut(duration: 0.6)) {
            isPaintButtonActive = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
            withAnimation(.easeInOut(duration: 0.6)) {
                isPaintButtonActive = false
            }
        }
    }

    private func startGlowAnimationIfNeeded() {
        guard !didStartGlowAnimation else { return }
        didStartGlowAnimation = true
        glowAmount = 0.35
        withAnimation(Animation.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) {
            glowAmount = 0.7
        }
    }

    // Entrance animation only plays once per app session; returning from game skips it
    private static var hasEverShownLobby = false

    private func startIntroSequence() {
        startPhysicsEntrance()

        if !Self.hasEverShownLobby {
            Self.hasEverShownLobby = true
            // First show: animate panels in
            showPreviewPanel = false
            showJoinSection = false
            showFooterRow = false
            DispatchQueue.main.asyncAfter(deadline: .now() + Double.random(in: 0.05...0.15)) {
                withAnimation { showPreviewPanel = true }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + Double.random(in: 0.25...0.4)) {
                withAnimation { showJoinSection = true }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + Double.random(in: 0.45...0.6)) {
                withAnimation { showFooterRow = true }
            }
        } else {
            // Returning from game: show immediately, no entrance animation
            showPreviewPanel = true
            showJoinSection = true
            showFooterRow = true
        }
    }

    private func startPhysicsEntrance() {
        // Initialize join button from the bottom
        joinButtonOffset = CGSize(width: 0, height: 600)

        // Simple slide-up animation
        withAnimation(.spring(response: 0.8, dampingFraction: 0.7).delay(0.3)) {
            joinButtonOffset = .zero
        }
    }

    private func startEmojiAnimation() {
        // Pick random starting emoji
        paintEmoji = paintEmojis.randomElement() ?? "🖌️"
        emojiAnimationSpeed = 0.1
        scheduleNextEmojiChange()
    }

    private func stopEmojiAnimation() {
        emojiTimer?.invalidate()
        emojiTimer = nil
    }

    private func scheduleNextEmojiChange() {
        emojiTimer?.invalidate()

        emojiTimer = Timer.scheduledTimer(withTimeInterval: emojiAnimationSpeed, repeats: false) { _ in
            // Change to random emoji
            paintEmoji = paintEmojis.randomElement() ?? "🖌️"

            // Gradually slow down from 0.1s to 1.0s
            if emojiAnimationSpeed < 1.0 {
                emojiAnimationSpeed = min(1.0, emojiAnimationSpeed + 0.1)
            }

            // Continue animation
            scheduleNextEmojiChange()
        }
    }

    @State private var isPerformingJoinTransition = false

    private func performJoinTransition() {
        guard !isPerformingJoinTransition else { return }
        isPerformingJoinTransition = true

        // Stop emoji animation during transition
        stopEmojiAnimation()

        // Step 1: Show transition overlay with text
        showJoinTransition = true
        showTransitionText = true
        textShootOffset = 0

        // Step 2: Start joining game in background - server will set actual spawn position
        gameState.joinGame()

        print("🎯 [TRANSITION] Joining game - waiting for server to set player position...")

        // Step 3: Shoot text to the right (0.5s)
        withAnimation(.easeIn(duration: 0.5)) {
            textShootOffset = 500
        }

        // Step 4: Wait for player to be positioned by server, then zoom to ACTUAL position
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            showTransitionText = false

            // Wait for myPlayer to be set with actual position from server
            waitForActualPlayerPosition()
        }
    }

    private func waitForActualPlayerPosition() {
        // Check if player is set with actual position
        if let player = gameState.myPlayer {
            print("🎯 [TRANSITION] Player positioned at: (\(Int(player.x)), \(Int(player.y)))")
            startZoomToActualPosition(x: player.x, y: player.y)
        } else {
            // Player not ready yet, check again in 100ms
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                waitForActualPlayerPosition()
            }
        }
    }

    private func startZoomToActualPosition(x: Double, y: Double) {
        // Convert ACTUAL player position (0-1024) to normalized coordinates (0-1)
        let normalizedX = x / 1024.0
        let normalizedY = y / 1024.0

        print("🎯 [ZOOM] Zooming to ACTUAL position: (\(Int(x)), \(Int(y))) → Anchor: (\(String(format: "%.2f", normalizedX)), \(String(format: "%.2f", normalizedY)))")

        // Set anchor point to actual player position
        transitionAnchor = UnitPoint(x: normalizedX, y: normalizedY)
        transitionScale = 2.0

        // Start zoom animation to actual spawn position (2.5 seconds)
        withAnimation(.easeInOut(duration: 2.5)) {
            transitionScale = 10.0
        }

        // Set up tile loading check
        gameState.waitingForTilesToShowGame = true

        // Check after zoom animation completes
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            if gameState.tilesLoaded {
                // Tiles already loaded - show game immediately
                showJoinTransition = false
                isPerformingJoinTransition = false
                gameState.readyToShowGame = true
                gameState.waitingForTilesToShowGame = false
                print("✅ [TRANSITION] Zoom complete + tiles loaded - showing game")
            } else {
                // Keep zooming/transition showing until tiles load
                print("⏳ [TRANSITION] Zoom complete, waiting for tiles...")

                // Safety timeout: if tiles still don't load in 3 more seconds, show game anyway
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                    if gameState.waitingForTilesToShowGame {
                        print("⚠️ [TRANSITION] Timeout - showing game anyway")
                        showJoinTransition = false
                        isPerformingJoinTransition = false
                        gameState.readyToShowGame = true
                        gameState.waitingForTilesToShowGame = false
                    }
                }
            }
        }
    }
}
