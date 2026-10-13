//
//  NewGameView.swift
//  MultiPainter
//
//  Created by Claude Code - V2 Architecture
//

import SwiftUI
import UIKit

struct NewGameView: View {
    @EnvironmentObject var gameState: GameState
    @State private var showChat = false
    @State private var showColorPicker = false
    @State private var showMinimap = false
    @State private var showSettings = false
    @State private var selectedColor = Color.red
    @State private var brushSize: Double = 8
    @State private var selectedEmojiBrush: String? = nil
    @State private var pipetteActive = false
    @State private var joystickOnLeft = true
    @State private var chatOffset: CGSize = .zero
    @State private var storedChatOffset: CGSize = .zero
    @State private var didInitializeRandomValues = false
    @State private var showConnectionStatus = true
    @State private var connectionStatusHideWorkItem: DispatchWorkItem?
    @State private var backgroundTime: Date? = nil
    @Environment(\.presentationMode) var presentationMode
    @Environment(\.scenePhase) var scenePhase

    var body: some View {
        return ZStack {
            // Canvas with viewport
            NewCanvasView(
                selectedColor: $selectedColor,
                brushSize: $brushSize,
                pipetteActive: $pipetteActive,
                selectedEmojiBrush: $selectedEmojiBrush
            )

            // Top overlay
            VStack {
                HStack(alignment: .top, spacing: 16) {
                    // Player info with hearts and coins + tile info
                    VStack(alignment: .leading, spacing: 12) {
                        if let player = gameState.myPlayer {
                            VStack(alignment: .leading, spacing: 8) {
                                // Username and emoji
                                HStack(spacing: 4) {
                                    CustomEmojiView(player.emoji, size: 16)
                                    Text(player.username)
                                        .appFont(14, weight: .semibold)
                                        .foregroundColor(.white)
                                }

                                // Hearts (lives)
                                HStack(spacing: 4) {
                                    ForEach(0..<3, id: \.self) { index in
                                        Image(systemName: index < player.lives ? "heart.fill" : "heart")
                                            .appFont(16)
                                            .foregroundColor(index < player.lives ? .red : .white.opacity(0.3))
                                    }
                                }

                                // Coins
                                HStack(spacing: 4) {
                                    Image(systemName: "bitcoinsign.circle.fill")
                                        .appFont(14)
                                        .foregroundColor(.yellow)
                                    Text("\(gameState.currentProfile?.coins ?? 0)")
                                        .appFont(14, weight: .semibold)
                                        .foregroundColor(.white)
                                }
                            }
                            .padding(12)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.black.opacity(0.6))
                            )
                        }
                    }

                    Spacer()

                    VStack(alignment: .trailing, spacing: 12) {
                        if showConnectionStatus {
                            ConnectionDebugView(
                                statusText: gameState.connectionStatusMessage,
                                strokeText: gameState.lastStrokeStatusMessage,
                                isConnected: gameState.isConnected
                            )
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                        }

                        HStack(spacing: 12) {
                            // Chat button (moved to top)
                            Button(action: {
                                showChat.toggle()
                            }) {
                                CustomEmojiView(showChat ? "💬" : "💭", size: 28, revealOnTap: false)
                                    .frame(width: 44, height: 44)
                            }

                            // Settings button
                            Button(action: {
                                showSettings = true
                            }) {
                                CustomEmojiView("⚙️", size: 28, revealOnTap: false)
                                    .frame(width: 44, height: 44)
                            }

                            // Minimap button
                            Button(action: {
                                showMinimap = true
                            }) {
                                CustomEmojiView("🗺️", size: 28, revealOnTap: false)
                                    .frame(width: 44, height: 44)
                            }

                            // Exit button
                            Button(action: {
                                // Disconnect and go back to lobby
                                gameState.leaveGameAndReturnToLobby()
                            }) {
                                CustomEmojiView("❎", size: 28, revealOnTap: false)
                                    .frame(width: 44, height: 44)
                            }
                        }
                    }
                }
                .padding()

                Spacer()
            }

            // Brush controls with tile indicators
            VStack {
                Spacer()
                VStack(alignment: .trailing, spacing: 12) {
                    // Simplified tile indicators above brush size
                    SimplifiedTileIndicators(selectedEmojiBrush: $selectedEmojiBrush)

                    HStack {
                        Spacer()
                        BrushControlBar(
                            brushSize: $brushSize,
                            selectedColor: selectedColor,
                            selectedEmoji: selectedEmojiBrush
                        ) {
                            pipetteActive = false
                            showColorPicker = true
                        }
                        .onAppear { gameState.updateBrushSize(brushSize) }
                        .onChange(of: brushSize) { gameState.updateBrushSize($0) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.trailing, 24)
                .padding(.bottom, 24)
            }

            // Joystick overlay docked to screen edge
            VStack {
                Spacer()
                HStack {
                    if joystickOnLeft {
                        JoystickView()
                            .frame(width: 120, height: 120)
                            .simultaneousGesture(
                                TapGesture(count: 2).onEnded {
                                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                        joystickOnLeft.toggle()
                                    }
                                }
                            )
                        Spacer()
                    } else {
                        Spacer()
                        JoystickView()
                            .frame(width: 120, height: 120)
                            .simultaneousGesture(
                                TapGesture(count: 2).onEnded {
                                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                        joystickOnLeft.toggle()
                                    }
                                }
                            )
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 28)
            }

            // Chat overlay
            if showChat {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        ChatOverlay(isPresented: $showChat)
                            .frame(width: 320)
                            .padding(.trailing, 20)
                            .padding(.bottom, 200)
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

            // Settings overlay
            if showSettings {
                SettingsOverlay(isPresented: $showSettings)
            }

            // Minimap overlay
            if showMinimap {
                MinimapOverlay(isPresented: $showMinimap)
            }

            // Inactivity warning overlay
            if gameState.showInactivityWarning {
                InactivityWarningOverlay()
            }

            // "Fight the AI!" challenge overlay — dramatic full-screen effect
            if let msg = gameState.aiChallengeMessage {
                AIFightOverlay(message: msg)
            }

            // Coin reward toast after fighting AI
            if gameState.aiChallengeCoinsEarned > 0 {
                VStack {
                    Spacer()
                    HStack(spacing: 10) {
                        Text("🪙").font(.system(size: 32))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("+\(gameState.aiChallengeCoinsEarned) coin earned!")
                                .font(.system(size: 17, weight: .black, design: .rounded))
                                .foregroundColor(.yellow)
                            Text("You held your tile against the AI")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.white.opacity(0.75))
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.vertical, 14)
                    .background(
                        Capsule()
                            .fill(LinearGradient(colors: [Color(red:0.45,green:0.1,blue:0.85), Color(red:0.2,green:0.05,blue:0.55)],
                                                startPoint: .leading, endPoint: .trailing))
                            .shadow(color: .purple.opacity(0.7), radius: 16)
                    )
                    .transition(.asymmetric(
                        insertion: .move(edge: .bottom).combined(with: .scale(scale: 0.8)).combined(with: .opacity),
                        removal: .move(edge: .bottom).combined(with: .opacity)
                    ))
                    Spacer().frame(height: 100)
                }
                .animation(.spring(response: 0.5, dampingFraction: 0.65), value: gameState.aiChallengeCoinsEarned)
                .allowsHitTesting(false)
            }

            // AI reveal — show the new tile image after AI finishes
            if let revealImg = gameState.aiRevealImage {
                AIRevealOverlay(image: revealImg) {
                    gameState.aiRevealImage = nil
                    gameState.aiChallengeCoinsEarned = 0
                }
            }

            // Game over overlay
            if let player = gameState.myPlayer, player.lives <= 0 {
                GameOverOverlay()
            }

            if showColorPicker {
                Color.black.opacity(0.55)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showColorPicker = false
                    }

                ColorControlPanel(
                    selectedColor: $selectedColor,
                    isPresented: $showColorPicker,
                    pipetteActive: $pipetteActive,
                    selectedEmojiBrush: $selectedEmojiBrush
                )
                .transition(.scale)
            }
        }
        .preferredColorScheme(.dark)
        .onTapGesture {
            // Record any tap as interaction
            gameState.recordInteraction()
        }
        .onAppear {
            // Initialize random emoji as DEFAULT brush on first spawn
            if !didInitializeRandomValues {
                didInitializeRandomValues = true

                // Set random emoji as the DEFAULT paint mode
                selectedEmojiBrush = EmojiData.randomEmoji()
                print("🎨 [GAME START] Random emoji selected: \(selectedEmojiBrush ?? "❓")")

                // Keep a default color for color mode if user switches
                selectedColor = Color(
                    red: Double.random(in: 0...1),
                    green: Double.random(in: 0...1),
                    blue: Double.random(in: 0...1)
                )

                // Generate random brush size from 5 to 30
                brushSize = Double.random(in: 5...30)

                // Load last 30 images for initial lobby animation
                gameState.loadLast30ImagesForLobby()
            }

            // Start loading timelapse frames for animation when entering game
            gameState.startTimelapseUpdates()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                gameState.syncCurrentPlayerPosition()
            }
            updateConnectionVisibility(isConnected: gameState.isConnected)
        }
        .onDisappear {
            // Stop animation and updates when leaving game
            gameState.stopTimelapseAnimation()
            gameState.stopTimelapseUpdates()
            connectionStatusHideWorkItem?.cancel()
            connectionStatusHideWorkItem = nil
        }
        .onChange(of: gameState.isConnected) { isConnected in
            updateConnectionVisibility(isConnected: isConnected)
        }
        .onChange(of: scenePhase) { newPhase in
            switch newPhase {
            case .background:
                // App moved to background - record the time
                backgroundTime = Date()
                print("📱 App moved to background at \(backgroundTime!)")

            case .active:
                // App returned to foreground - check if we should replay
                if let bgTime = backgroundTime {
                    let timeInBackground = Date().timeIntervalSince(bgTime)
                    print("📱 App returned to foreground after \(Int(timeInBackground))s in background")

                    // If away for more than 3 seconds, replay the last 30 images
                    if timeInBackground > 3.0 {
                        print("🔄 Auto-replaying last 30 images (was away for \(Int(timeInBackground))s)")
                        gameState.loadLast30ImagesForLobby()
                    }

                    backgroundTime = nil
                }

            case .inactive:
                // Intermediate state - do nothing
                break

            @unknown default:
                break
            }
        }
    }
    
    private func updateConnectionVisibility(isConnected: Bool) {
        if isConnected {
            connectionStatusHideWorkItem?.cancel()
            showConnectionStatus = true
            let workItem = DispatchWorkItem {
                withAnimation {
                    showConnectionStatus = false
                }
            }
            connectionStatusHideWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: workItem)
        } else {
            connectionStatusHideWorkItem?.cancel()
            withAnimation {
                showConnectionStatus = true
            }
        }
    }
}

// MARK: - Brush Controls
struct BrushControlBar: View {
    @Binding var brushSize: Double
    let selectedColor: Color
    let selectedEmoji: String?
    let onColorTap: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onColorTap) {
                Circle()
                    .fill(selectedEmoji == nil ? selectedColor : Color.white.opacity(0.15))
                    .frame(width: 28, height: 28)
                    .overlay(
                        Circle()
                            .stroke(Color.white, lineWidth: 2)
                    )
                    .overlay(
                        Group {
                            if let emoji = selectedEmoji {
                                CustomEmojiView(emoji, size: 18, revealOnTap: false)
                            }
                        }
                    )
                    .shadow(color: (selectedEmoji == nil ? selectedColor : Color.white).opacity(0.7), radius: 4)
            }
            .buttonStyle(.plain)

            Text(String(format: "%.1f px", brushSize))
                .appFont(13, weight: .semibold)
                .foregroundColor(.white.opacity(0.9))
                .frame(width: 64, alignment: .trailing)

            Slider(value: $brushSize, in: 0.5...60, step: 0.5)
                .accentColor(.white)
                .frame(width: 110)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            Capsule()
                .fill(Color.black.opacity(0.6))
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
        )
    }
}

// MARK: - Color Picker Overlay
struct ColorControlPanel: View {
    @Binding var selectedColor: Color
    @Binding var isPresented: Bool
    @Binding var pipetteActive: Bool
    @Binding var selectedEmojiBrush: String?

    @State private var hue: Double = 0
    @State private var saturation: Double = 1
    @State private var brightness: Double = 1
    @State private var updatingFromWheel = false
    @State private var autoCloseWorkItem: DispatchWorkItem?
    @State private var allowAutoClose = false
    @State private var recentColors: [Color] = []
    @State private var suppressWheelChanges = false
    @State private var pickerMode: PickerMode = .color
    @State private var recentEmojis: [String] = []

    private let maxRecentColors = 8
    private let recentColorsKey = "ColorControlPanel.recentColors"
    private let recentEmojisKey = "ColorControlPanel.recentEmojis"
    private let maxRecentEmojis = 18

    private let quickColors: [Color] = [
        .white, .black, .red, .orange, .yellow,
        .green, .blue, .purple,
        Color(hex: "#FF6B6B"), Color(hex: "#45B7D1"),
        Color(hex: "#5F9DF7"), Color(hex: "#FFC3A0")
    ]

    private let emojiColumns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 6)

    enum PickerMode: String, CaseIterable, Identifiable {
        case color
        case emoji

        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 18) {
            header
            modePicker
            if pickerMode == .color {
                colorWheel
                quickPalette
                recentPalette
            } else {
                emojiPicker
            }
            brushPreview
        }
        .padding(24)
        .frame(maxWidth: 360)
        .background(
            RoundedRectangle(cornerRadius: 30)
                .fill(Color.black.opacity(0.9))
                .overlay(
                    RoundedRectangle(cornerRadius: 30)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.6), radius: 20, x: 0, y: 10)
        )
        .onAppear {
            allowAutoClose = false
            loadRecentColors()
            loadRecentEmojis()
            updateHSBFromColor(selectedColor)
            pickerMode = selectedEmojiBrush == nil ? .color : .emoji
        }
        .onDisappear {
            autoCloseWorkItem?.cancel()
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Pick a brush")
                    .appFont(18, weight: .bold)
                    .foregroundColor(.white)

                Text("Tap or drag to apply")
                    .appFont(12)
                    .foregroundColor(.white.opacity(0.6))
            }

            Spacer()

            Button(action: activatePipette) {
                Image(systemName: "eyedropper")
                    .appFont(18, weight: .semibold)
                    .foregroundColor(.white)
                    .frame(width: 46, height: 46)
                    .background(pipetteBackground)
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
        }
    }

    private var modePicker: some View {
        Picker("Brush Mode", selection: $pickerMode) {
            Text("Colors").tag(PickerMode.color)
            Text("Emoji").tag(PickerMode.emoji)
        }
        .pickerStyle(.segmented)
    }

    private var colorWheel: some View {
        ColorWheelPicker(hue: $hue, saturation: $saturation, brightness: $brightness)
            .frame(width: 220, height: 220)
            .onChange(of: hue) { _ in handleWheelChange() }
            .onChange(of: saturation) { _ in handleWheelChange() }
            .onChange(of: brightness) { _ in handleWheelChange() }
    }

    private var emojiPicker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !recentEmojis.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Recent Emoji")
                            .appFont(12, weight: .semibold)
                            .foregroundColor(.white.opacity(0.7))
                        LazyVGrid(columns: emojiColumns, spacing: 6) {
                            ForEach(recentEmojis, id: \.self) { emoji in
                                emojiButton(for: emoji)
                            }
                        }
                    }
                }

                ForEach(EmojiData.categoryOrder, id: \.self) { category in
                    if let emojis = EmojiData.allEmojis[category] {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(category)
                                .appFont(12, weight: .semibold)
                                .foregroundColor(.white.opacity(0.7))
                            LazyVGrid(columns: emojiColumns, spacing: 6) {
                                ForEach(emojis, id: \.self) { emoji in
                                    emojiButton(for: emoji)
                                }
                            }
                        }
                    }
                }
            }
        }
        .frame(maxHeight: 320)
    }

    private func handleWheelChange() {
        guard !suppressWheelChanges else { return }
        allowAutoClose = true
        updateColorFromHSB()
    }

    private var quickPalette: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Quick Tips")
                .appFont(12, weight: .semibold)
                .foregroundColor(.white.opacity(0.7))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(quickColors.enumerated()), id: \.offset) { _, color in
                        Button(action: {
                            applyPresetColor(color)
                        }) {
                            quickColorCell(for: color)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var recentPalette: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Last Picks")
                .appFont(12, weight: .semibold)
                .foregroundColor(.white.opacity(0.7))

            if recentColors.isEmpty {
                Text("Pick colors to build your history")
                    .appFont(11, weight: .medium)
                    .foregroundColor(.white.opacity(0.4))
            } else {
                HStack(spacing: 8) {
                    ForEach(Array(recentColors.enumerated()), id: \.offset) { _, color in
                        Button(action: {
                            applyPresetColor(color)
                        }) {
                            quickColorCell(for: color)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var brushPreview: some View {
        HStack(spacing: 12) {
            if let emoji = selectedEmojiBrush {
                CustomEmojiView(emoji, size: 30)
                    .frame(width: 38, height: 38)
                    .background(
                        Circle()
                            .fill(Color.white.opacity(0.15))
                    )
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.4), lineWidth: 1)
                    )
                Text("Emoji Brush")
                    .appFont(13, weight: .semibold)
                    .foregroundColor(.white.opacity(0.9))
            } else {
                Circle()
                    .fill(selectedColor)
                    .frame(width: 34, height: 34)
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.8), lineWidth: 2)
                    )

                Text(selectedColor.toHex())
                    .appFont(13, weight: .semibold)
                    .foregroundColor(.white.opacity(0.9))
            }

            Spacer()
        }
    }

    private func quickColorCell(for color: Color) -> some View {
        let isSelected = colorsAreEqual(selectedColor, color)

        return Circle()
            .fill(color)
            .frame(width: 28, height: 28)
            .overlay(
                Circle()
                    .stroke(isSelected ? Color.white : Color.black.opacity(0.2), lineWidth: isSelected ? 3 : 1)
            )
    }

    private func applyPresetColor(_ color: Color) {
        selectedColor = color
        selectedEmojiBrush = nil
        updateHSBFromColor(color)
        allowAutoClose = true
        registerRecentColor(color)
        scheduleAutoClose()
    }

    private func applyEmojiBrush(_ emoji: String) {
        selectedEmojiBrush = emoji
        allowAutoClose = true
        registerRecentEmoji(emoji)
        scheduleAutoClose()
    }

    private func activatePipette() {
        selectedEmojiBrush = nil
        pipetteActive = true
        dismissPanel()
    }

    private func dismissPanel() {
        autoCloseWorkItem?.cancel()
        isPresented = false
    }

    private func scheduleAutoClose() {
        autoCloseWorkItem?.cancel()
        let workItem = DispatchWorkItem {
            dismissPanel()
        }
        autoCloseWorkItem = workItem
        // Auto-close after 0.5s, resets if another emoji/color picked quickly
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: workItem)
    }

    private func updateColorFromHSB() {
        updatingFromWheel = true
        let color = Color(hue: hue, saturation: saturation, brightness: brightness)
        selectedColor = color
        selectedEmojiBrush = nil
        DispatchQueue.main.async {
            updatingFromWheel = false
            if self.allowAutoClose {
                self.registerRecentColor(color)
                self.scheduleAutoClose()
            } else {
                self.allowAutoClose = true
            }
        }
    }

    private func updateHSBFromColor(_ color: Color) {
        guard !updatingFromWheel else { return }
        suppressWheelChanges = true
        allowAutoClose = false
        let uiColor = UIColor(color)
        var h: CGFloat = 0
        var s: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0

        uiColor.getHue(&h, saturation: &s, brightness: &b, alpha: &a)

        hue = Double(h)
        saturation = Double(s)
        brightness = Double(b)
        DispatchQueue.main.async {
            suppressWheelChanges = false
        }
    }

    private func registerRecentColor(_ color: Color) {
        if let existingIndex = recentColors.firstIndex(where: { colorsAreEqual($0, color) }) {
            recentColors.remove(at: existingIndex)
        }
        recentColors.insert(color, at: 0)
        if recentColors.count > maxRecentColors {
            recentColors = Array(recentColors.prefix(maxRecentColors))
        }
        persistRecentColors()
    }

    private func registerRecentEmoji(_ emoji: String) {
        if let index = recentEmojis.firstIndex(of: emoji) {
            recentEmojis.remove(at: index)
        }
        recentEmojis.insert(emoji, at: 0)
        if recentEmojis.count > maxRecentEmojis {
            recentEmojis = Array(recentEmojis.prefix(maxRecentEmojis))
        }
        persistRecentEmojis()
    }

    private func colorsAreEqual(_ lhs: Color, _ rhs: Color) -> Bool {
        let left = UIColor(lhs)
        let right = UIColor(rhs)

        var lr: CGFloat = 0, lg: CGFloat = 0, lb: CGFloat = 0, la: CGFloat = 0
        var rr: CGFloat = 0, rg: CGFloat = 0, rb: CGFloat = 0, ra: CGFloat = 0

        left.getRed(&lr, green: &lg, blue: &lb, alpha: &la)
        right.getRed(&rr, green: &rg, blue: &rb, alpha: &ra)

        let threshold: CGFloat = 0.01
        return abs(lr - rr) < threshold && abs(lg - rg) < threshold && abs(lb - rb) < threshold && abs(la - ra) < threshold
    }

    @ViewBuilder
    private var pipetteBackground: some View {
        if pipetteActive {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [.blue, .purple],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        } else {
            Circle()
                .fill(Color.white.opacity(0.08))
        }
    }

    private func loadRecentColors() {
        let storedHex = UserDefaults.standard.stringArray(forKey: recentColorsKey) ?? []
        recentColors = storedHex.compactMap { Color(hex: $0) }
    }

    private func persistRecentColors() {
        let hexValues = recentColors.map { $0.toHex() }
        UserDefaults.standard.set(hexValues, forKey: recentColorsKey)
    }

    private func loadRecentEmojis() {
        recentEmojis = UserDefaults.standard.stringArray(forKey: recentEmojisKey) ?? []
    }

    private func persistRecentEmojis() {
        UserDefaults.standard.set(recentEmojis, forKey: recentEmojisKey)
    }

    private func emojiButton(for emoji: String) -> some View {
        Button(action: {
            applyEmojiBrush(emoji)
        }) {
            CustomEmojiView(emoji, size: 26, revealOnTap: false)
                .frame(width: 36, height: 36)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(selectedEmojiBrush == emoji ? Color.white.opacity(0.25) : Color.white.opacity(0.08))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(selectedEmojiBrush == emoji ? Color.white : Color.clear, lineWidth: 1.5)
                )
        }
        .buttonStyle(.plain)
    }
}
// MARK: - Chat Overlay
struct ChatOverlay: View {
    @EnvironmentObject var gameState: GameState
    @Binding var isPresented: Bool
    @State private var messageText = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Chat")
                    .appFont(20, weight: .bold)
                    .foregroundColor(.white)

                Spacer()

                Button(action: {
                    isPresented = false
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .appFont(22)
                        .foregroundColor(.white.opacity(0.8))
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)

            Divider()
                .background(Color.white.opacity(0.1))

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(gameState.chatMessages) { message in
                            NewChatMessageRow(message: message)
                                .id(message.id)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 12)
                }
                .onChange(of: gameState.chatMessages.count) { _ in
                    // Auto-scroll to newest message
                    if let lastMessage = gameState.chatMessages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }
            .frame(maxHeight: .infinity)

            Divider()
                .background(Color.white.opacity(0.1))

            HStack(spacing: 12) {
                TextField("Type a message...", text: $messageText)
                    .textFieldStyle(.plain)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.white.opacity(0.15))
                    )
                    .foregroundColor(.white)

                Button(action: {
                    sendMessage()
                }) {
                    Image(systemName: "paperplane.fill")
                        .appFont(20)
                        .foregroundColor(.white)
                        .frame(width: 44, height: 44)
                        .background(
                            Circle()
                                .fill(Color.blue)
                        )
                }
                .disabled(messageText.isEmpty)
            }
            .padding()
        }
        .frame(width: 320, height: 420)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.black.opacity(0.85))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white.opacity(0.15), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.5), radius: 15, x: 0, y: 10)
    }

    private func sendMessage() {
        guard !messageText.isEmpty else { return }
        gameState.sendChat(messageText)
        messageText = ""
    }
}

// MARK: - Chat Message Row (private to this view)
private struct NewChatMessageRow: View {
    let message: ChatBroadcast

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CustomEmojiView(message.emoji, size: 24)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(message.username)
                        .appFont(14, weight: .semibold)
                        .foregroundColor(.white)

                    if message.isBot {
                        Text("BOT")
                            .appFont(8, weight: .bold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .background(
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Color.purple)
                            )
                    }
                }

                Text(message.text)
                    .appFont(14)
                    .foregroundColor(.white.opacity(0.9))
            }

            Spacer()
        }
    }
}

// MARK: - Minimap Overlay
struct MinimapOverlay: View {
    @EnvironmentObject var gameState: GameState
    @Binding var isPresented: Bool
    @State private var pulse = false

    private var isPad: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
    }

    private var minimapSize: CGFloat {
        isPad ? 600 : 300  // Double size on iPad
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.7)
                .ignoresSafeArea()
                .onTapGesture {
                    isPresented = false
                }

            VStack(spacing: isPad ? 30 : 20) {
                // Header
                HStack {
                    Text("Canvas Overview")
                        .appFont(isPad ? 32 : 24, weight: .bold)
                        .foregroundColor(.white)

                    Spacer()

                    // Inactivity Warning Badge
                    if gameState.showInactivityWarning {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .appFont(isPad ? 24 : 18)
                                .foregroundColor(.red)

                            Text("Kick in \(gameState.inactivityCountdown)s")
                                .appFont(isPad ? 22 : 16, weight: .bold)
                                .foregroundColor(.red)
                        }
                        .padding(.horizontal, isPad ? 20 : 12)
                        .padding(.vertical, isPad ? 12 : 8)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color.red.opacity(0.2))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.red, lineWidth: 2)
                                )
                        )
                        .scaleEffect(pulse ? 1.05 : 0.95)
                        .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: pulse)
                    }

                    // Refresh button to reload last 30 frames
                    Button(action: {
                        print("🔄 Lobby refresh triggered")
                        gameState.loadLast30ImagesForLobby()
                    }) {
                        ZStack {
                            Circle()
                                .fill(Color.white.opacity(0.15))
                                .frame(width: isPad ? 50 : 44, height: isPad ? 50 : 44)

                            if gameState.isLoadingLobbyFrames {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .scaleEffect(isPad ? 1.2 : 1.0)
                            } else {
                                CustomEmojiView("🔄", size: isPad ? 32 : 28, revealOnTap: false)
                            }
                        }
                    }
                    .disabled(gameState.isLoadingLobbyFrames)

                    Button(action: {
                        isPresented = false
                    }) {
                        Image(systemName: "xmark.circle.fill")
                            .appFont(isPad ? 36 : 28)
                            .foregroundColor(.white.opacity(0.7))
                    }
                }
                .padding(isPad ? 24 : 16)

                minimapView
                    .frame(width: minimapSize, height: minimapSize)
                    .clipShape(RoundedRectangle(cornerRadius: isPad ? 20 : 12))
                    .overlay(playerMarkerOverlay)
                    .shadow(color: .black.opacity(0.5), radius: 20)
                    .onAppear {
                        withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                            pulse = true
                        }
                        // Trigger fresh timelapse fetch on every open
                        gameState.loadLast30ImagesForLobby()
                    }

                VStack(spacing: isPad ? 12 : 8) {
                    Text("Latest Canvas State")
                        .appFont(isPad ? 18 : 12)
                        .foregroundColor(.white.opacity(0.6))

                    if gameState.showInactivityWarning {
                        EmojiLabel("⚠️ TAP SCREEN TO STAY ACTIVE", size: isPad ? 20 : 14, weight: .bold, color: .yellow)
                            .padding(.vertical, isPad ? 8 : 4)
                            .scaleEffect(pulse ? 1.1 : 0.9)
                    } else {
                        Text("Tap anywhere to close")
                            .appFont(isPad ? 18 : 14)
                            .foregroundColor(.white.opacity(0.6))
                    }

                    // Debug: Last Updated timestamp
                    if let lastUpdate = gameState.lastTimelapseUpdate {
                        let timeAgo = abs(lastUpdate.timeIntervalSinceNow)
                        let timeAgoStr = timeAgo < 60 ? "now" : "\(Int(timeAgo / 60))m ago"
                        Text("updated \(timeAgoStr)")
                            .appFont(isPad ? 11 : 9)
                            .foregroundColor(.white.opacity(0.4))
                    }
                }
            }
            .padding(isPad ? 40 : 30)
        }
    }

    @ViewBuilder
    private var minimapView: some View {
        // Always prefer the live-updating timelapseImage (refreshed every 1s)
        if let staticImage = gameState.timelapseImage {
            Image(uiImage: staticImage)
                .resizable()
                .aspectRatio(1.0, contentMode: .fit)
        } else {
            Rectangle()
                .fill(Color.black.opacity(0.3))
                .overlay(
                    VStack {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        Text("Loading...")
                            .foregroundColor(.white.opacity(0.7))
                    }
                )
        }
    }

    private var playerMarkerOverlay: some View {
        GeometryReader { proxy in
            if let point = markerPoint(in: proxy.size),
               let emoji = gameState.myPlayer?.emoji {
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.8), lineWidth: isPad ? 4 : 2)
                        .frame(width: isPad ? 44 : 22, height: isPad ? 44 : 22)
                        .scaleEffect(pulse ? 1.2 : 0.7)
                        .opacity(pulse ? 1.0 : 0.3)

                    CustomEmojiView(emoji, size: isPad ? 24 : 12, revealOnTap: false)
                }
                .position(point)
            }
        }
    }

    private func markerPoint(in size: CGSize) -> CGPoint? {
        guard let player = gameState.myPlayer else { return nil }
        let scaleX = size.width / 1024.0
        let scaleY = size.height / 1024.0
        let x = CGFloat(player.x) * scaleX
        let y = CGFloat(player.y) * scaleY
        return CGPoint(x: x, y: y)
    }
}

// MARK: - Tile Mini View
struct TileMiniView: View {
    @EnvironmentObject var gameState: GameState
    let tileId: Int

    var body: some View {
        ZStack {
            // Tile image
            if let tile = gameState.tiles[tileId],
               let image = tile.compositeImage() {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(1.0, contentMode: .fit)
            } else {
                Rectangle()
                    .fill(Color.gray.opacity(0.3))
                    .aspectRatio(1.0, contentMode: .fit)
            }

            // Active indicator
            if gameState.activeTileId == tileId {
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color.green, lineWidth: 4)
            }

            // Frozen overlay
            if let tile = gameState.tiles[tileId], tile.isFrozen {
                Color.yellow.opacity(0.3)
                VStack {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    Text("AI")
                        .appFont(10)
                        .foregroundColor(.white)
                }
            }

            // Tile number
            VStack {
                HStack {
                    Text("\(tileId)")
                        .appFont(12, weight: .bold)
                        .foregroundColor(.white)
                        .padding(4)
                        .background(Circle().fill(Color.black.opacity(0.6)))
                    Spacer()
                }
                Spacer()
            }
            .padding(4)
        }
    }
}

// MARK: - Game Over Overlay
struct GameOverOverlay: View {
    @EnvironmentObject var gameState: GameState
    @State private var showStats = false

    var body: some View {
        ZStack {
            // Dark background
            Color.black.opacity(0.9)
                .ignoresSafeArea()

            VStack(spacing: 30) {
                // Skull icon
                CustomEmojiView("💀", size: 80, revealOnTap: false)

                // Game Over text
                Text("GAME OVER")
                    .appFont(48, weight: .bold)
                    .foregroundColor(.red)

                // You Died text
                Text("You ran out of lives!")
                    .appFont(20)
                    .foregroundColor(.white.opacity(0.8))

                // Stats
                VStack(spacing: 16) {
                    if let profile = gameState.currentProfile {
                        HStack(spacing: 12) {
                            Image(systemName: "bitcoinsign.circle.fill")
                                .appFont(24)
                                .foregroundColor(.yellow)
                            Text("\(profile.coins) Coins")
                                .appFont(20, weight: .semibold)
                                .foregroundColor(.white)
                        }
                        .padding()
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color.white.opacity(0.1))
                        )
                    }

                    // Player info
                    if let player = gameState.myPlayer {
                        VStack(spacing: 8) {
                            HStack(spacing: 6) {
                                CustomEmojiView(player.emoji, size: 20)
                                Text(player.username)
                                    .appFont(18, weight: .semibold)
                                    .foregroundColor(.white)
                            }

                            Text("Final Position: (\(Int(player.x)), \(Int(player.y)))")
                                .appFont(14)
                                .foregroundColor(.white.opacity(0.6))
                        }
                    }
                }

                // Back to Lobby button
                Button(action: {
                    gameState.leaveGameAndReturnToLobby()
                }) {
                    HStack(spacing: 12) {
                        Image(systemName: "arrow.left.circle.fill")
                            .appFont(24)

                        Text("Back to Lobby")
                            .appFont(20, weight: .bold)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 60)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color.blue)
                    )
                }
                .padding(.horizontal, 40)
            }
            .padding(40)
        }
    }
}

// MARK: - Inactivity Warning Overlay
struct InactivityWarningOverlay: View {
    @EnvironmentObject var gameState: GameState

    private var countdown: Int {
        max(gameState.inactivityCountdown, 0)
    }

    private var blurProgress: Double {
        let clamped = min(max(countdown, 1), 10)
        return Double(10 - clamped) / 9.0
    }

    private var accentColors: [Color] {
        countdown <= 3 ? [Color.red, Color.orange] : [Color.purple, Color.blue]
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black.opacity(0.9), Color.black.opacity(0.6)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            .overlay(
                VisualEffectBlur(style: .systemUltraThinMaterialDark)
                    .opacity(blurProgress)
                    .blur(radius: blurProgress * 30)
                    .ignoresSafeArea()
            )

            VStack(spacing: 24) {
                VStack(spacing: 6) {
                    Text("Still painting?")
                        .appFont(28, weight: .bold)
                        .foregroundColor(.white)

                    Text("Interact to stay in the arena")
                        .appFont(16, weight: .medium)
                        .foregroundColor(.white.opacity(0.7))
                }

                ZStack {
                    Circle()
                        .stroke(style: StrokeStyle(lineWidth: 14, lineCap: .round))
                        .foregroundStyle(
                            AngularGradient(
                                gradient: Gradient(colors: accentColors),
                                center: .center
                            )
                        )
                        .frame(width: 180, height: 180)
                        .shadow(color: accentColors.last?.opacity(0.4) ?? .clear, radius: 12)

                    Circle()
                        .fill(Color.black.opacity(0.45))
                        .frame(width: 140, height: 140)
                        .blur(radius: 6)

                    Text("\(countdown)")
                        .appFont(70, weight: .bold)
                        .foregroundColor(.white)
                        .shadow(color: .black.opacity(0.6), radius: 6, x: 0, y: 4)
                }
                .padding(.vertical, 10)

                Text(countdown <= 3 ? "Almost back to lobby!" : "We'll send you out in \(countdown)s")
                    .appFont(18, weight: .semibold)
                    .foregroundColor(.white.opacity(0.85))

                Text("Tap anywhere to stay")
                    .appFont(15, weight: .medium)
                    .foregroundColor(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
                    .background(
                        Capsule()
                            .fill(Color.white.opacity(0.15))
                    )
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .stroke(Color.white.opacity(0.15), lineWidth: 1)
                    )
                    .shadow(color: Color.black.opacity(0.35), radius: 30, x: 0, y: 20)
            )
            .padding(.horizontal, 30)
        }
        .onTapGesture {
            gameState.recordInteraction()
        }
        .animation(.easeInOut(duration: 0.25), value: countdown)
    }
}

// MARK: - Animated Timelapse View
struct AnimatedTimelapseView: View {
    @EnvironmentObject var gameState: GameState

    var body: some View {
        ZStack {
            if !gameState.timelapseFrames.isEmpty {
                // Show current frame from animation
                let currentFrame = gameState.timelapseFrames[gameState.currentTimelapseIndex]
                Image(uiImage: currentFrame)
                    .resizable()
                    .aspectRatio(1.0, contentMode: .fit)
                    .id(gameState.currentTimelapseIndex)  // Force refresh on index change

                // Frame counter overlay
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Text("\(gameState.currentTimelapseIndex + 1)/\(gameState.timelapseFrames.count)")
                            .appFont(12, weight: .semibold)
                            .foregroundColor(.white)
                            .padding(6)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(Color.black.opacity(0.7))
                            )
                            .padding(8)
                    }
                }
            } else {
                // Loading state
                Rectangle()
                    .fill(Color.black.opacity(0.3))
                    .overlay(
                        VStack(spacing: 12) {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(1.5)

                            Text("Loading timelapse...")
                                .appFont(14)
                                .foregroundColor(.white.opacity(0.7))
                        }
                    )
            }
        }
    }
}

// MARK: - Settings Overlay
struct SettingsOverlay: View {
    @EnvironmentObject var gameState: GameState
    @Binding var isPresented: Bool
    @State private var killCount: Int = UserPreferences.shared.loadKillCount()
    @State private var deathCount: Int = UserPreferences.shared.loadDeathCount()
    @State private var playtime: TimeInterval = UserPreferences.shared.loadPlaytime()
    @State private var displayedCoins: Int = UserPreferences.shared.loadCoins()
    @State private var displayedKarma: Int = UserPreferences.shared.loadKarma()
    @State private var showProfileEditor = false
    @State private var isSavingProfile = false
    @State private var updateTimer: Timer?
    @State private var activePlayers: [Player] = []

    var body: some View {
        ZStack {
            Color.black.opacity(0.85)
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    HStack {
                        Text("Settings")
                            .appFont(34, weight: .bold)
                            .foregroundColor(.white)

                        Spacer()

                        Button(action: {
                            isPresented = false
                        }) {
                            Image(systemName: "xmark.circle.fill")
                                .appFont(30)
                                .foregroundColor(.white.opacity(0.7))
                        }
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        HStack {
                            CustomEmojiView(profileEmoji, size: 58)

                            VStack(alignment: .leading, spacing: 6) {
                                Text(profileName)
                                    .appFont(22, weight: .bold)
                                    .foregroundColor(.white)

                                Text(profileRank)
                                    .appFont(15, weight: .semibold)
                                    .foregroundColor(.white.opacity(0.8))
                            }

                            Spacer()

                            Button(action: {
                                showProfileEditor = true
                            }) {
                                Text("Edit Profile")
                                    .appFont(14, weight: .bold)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(
                                        Capsule()
                                            .fill(Color.white.opacity(0.2))
                                    )
                            }
                        }

                        HStack(spacing: 12) {
                            VStack(spacing: 8) {
                                ProfileStatChip(
                                    icon: "bitcoinsign.circle.fill",
                                    label: "Coins",
                                    value: "\(displayedCoins)",
                                    tint: .yellow
                                )

                                ProfileStatChip(
                                    icon: "target",
                                    label: "Kills",
                                    value: "\(killCount)",
                                    tint: .red
                                )
                            }

                            ProfileStatChip(
                                icon: "yin.yang",
                                label: "Karma",
                                value: "\(displayedKarma)",
                                tint: karmaColor
                            )
                        }
                    }
                    .padding()
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.white.opacity(0.08))
                    )

                    VStack(alignment: .leading, spacing: 16) {
                        Text("Lifetime Stats")
                            .appFont(20, weight: .semibold)
                            .foregroundColor(.white)

                        HStack(spacing: 12) {
                            StatPill(title: "Kills", value: "\(killCount)", color: .green)
                            StatPill(title: "Deaths", value: "\(deathCount)", color: .red)
                            StatPill(title: "Play Time", value: formattedPlaytime, color: .blue)
                        }
                    }
                    .padding()
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.white.opacity(0.08))
                    )

                    // Active Players List
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Active Players (\(activePlayers.count))")
                            .appFont(20, weight: .semibold)
                            .foregroundColor(.white)

                        ForEach(activePlayers) { player in
                            HStack(spacing: 12) {
                                CustomEmojiView(player.emoji, size: 20)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(player.username)
                                        .appFont(14, weight: .semibold)
                                        .foregroundColor(.white)

                                    EmojiLabel(player.isBot ? "🤖 Bot" : "👤 Player", size: 11, weight: .medium, color: .white.opacity(0.6))
                                }

                                Spacer()

                                HStack(spacing: 4) {
                                    ForEach(0..<3, id: \.self) { index in
                                        Image(systemName: index < player.lives ? "heart.fill" : "heart")
                                            .appFont(10)
                                            .foregroundColor(index < player.lives ? .red : .white.opacity(0.3))
                                    }
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.white.opacity(0.05))
                            )
                        }
                    }
                    .padding()
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.white.opacity(0.08))
                    )

                    Button(action: {
                        isPresented = false
                    }) {
                        Text("Close")
                            .appFont(18, weight: .bold)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(Color.blue)
                            )
                    }
                    .padding(.top, 20)
                }
                .padding(30)
            }
        }
        .onAppear {
            refreshStats()
            startPlayerListUpdates()
        }
        .onDisappear {
            stopPlayerListUpdates()
        }
        .onReceive(gameState.$currentProfile) { _ in
            refreshStats()
        }
        .fullScreenCover(isPresented: $showProfileEditor) {
            ProfileEditorSheet(
                isPresented: $showProfileEditor,
                initialUsername: profileName,
                initialEmoji: profileEmoji,
                title: "Edit Profile"
            ) { name, emoji in
                Task {
                    await gameState.recreateProfile(username: name, emoji: emoji)
                }
            }
            .environmentObject(gameState)
        }
    }

    private var profileName: String {
        gameState.currentProfile?.username ?? UserPreferences.shared.loadUsername() ?? "Unknown"
    }

    private var profileEmoji: String {
        gameState.currentProfile?.emoji ?? UserPreferences.shared.loadEmoji() ?? "🎨"
    }

    private var profileRank: String {
        UserPreferences.shared.loadRank()
    }

    private var karmaColor: Color {
        let karma = displayedKarma
        if karma >= 100 { return .green }
        if karma >= 0 { return .yellow }
        return .red
    }

    private var formattedPlaytime: String {
        let totalSeconds = Int(playtime)
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60

        if hours > 0 {
            return "\(hours)h \(minutes)m"
        } else if minutes > 0 {
            return "\(minutes)m \(seconds)s"
        } else {
            return "\(seconds)s"
        }
    }

    private func refreshStats() {
        killCount = UserPreferences.shared.loadKillCount()
        deathCount = UserPreferences.shared.loadDeathCount()
        playtime = UserPreferences.shared.loadPlaytime()
        displayedCoins = gameState.currentProfile?.coins ?? UserPreferences.shared.loadCoins()
        displayedKarma = gameState.currentProfile?.karma ?? UserPreferences.shared.loadKarma()
    }

    private func startPlayerListUpdates() {
        // Load initial player list
        updatePlayerList()

        // Start timer to update every 1 second
        updateTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            updatePlayerList()
        }
    }

    private func stopPlayerListUpdates() {
        updateTimer?.invalidate()
        updateTimer = nil
    }

    private func updatePlayerList() {
        // Get all active players from lobby (includes both players and bots)
        activePlayers = gameState.lobbyPlayers.filter { $0.alive }
    }
}

private struct StatPill: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .appFont(10, weight: .bold)
                .foregroundColor(.white.opacity(0.7))
            Text(value)
                .appFont(18, weight: .bold)
                .foregroundColor(.white)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(color.opacity(0.25))
        )
    }
}

private struct ProfileStatChip: View {
    let icon: String
    let label: String
    let value: String
    let tint: Color

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .foregroundColor(tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(label.uppercased())
                    .appFont(9, weight: .bold)
                    .foregroundColor(.white.opacity(0.6))
                Text(value)
                    .appFont(16, weight: .bold)
                    .foregroundColor(.white)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.white.opacity(0.08))
        )
    }
}

// MARK: - Simplified Tile Indicators
struct SimplifiedTileIndicators: View {
    @EnvironmentObject var gameState: GameState
    @Binding var selectedEmojiBrush: String?

    var body: some View {
        let myTile = currentTileId()

        return HStack(spacing: 6) {
            ForEach(0..<4) { tileId in
                if let tile = gameState.tiles[tileId] {
                    let isMine = tileId == myTile
                    let hasCountdown = tile.countdown > 0

                    ZStack {
                        // Square background
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.black.opacity(0.7))
                            .frame(width: 32, height: 32)

                        // Show countdown if active, otherwise show tiny tile number
                        if hasCountdown {
                            Text("\(tile.countdown)")
                                .appFont(14, weight: .bold)
                                .foregroundColor(tile.countdown <= 5 ? .red : .white)
                        } else {
                            Text("\(tileId)")
                                .appFont(9, weight: .semibold)
                                .foregroundColor(.white.opacity(0.5))
                        }
                    }
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(isMine ? Color.white : Color.white.opacity(0.2), lineWidth: isMine ? 2 : 1)
                    )
                }
            }

            // Dice emoji button to pick random emoji
            Button(action: {
                selectedEmojiBrush = EmojiData.randomEmoji()
            }) {
                ZStack {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.black.opacity(0.7))
                        .frame(width: 32, height: 32)

                    CustomEmojiView("🎲", size: 18, revealOnTap: false)
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(Color.white.opacity(0.2), lineWidth: 1)
                )
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill(Color.black.opacity(0.4))
        )
    }

    private func currentTileId() -> Int? {
        guard let myPlayer = gameState.myPlayer else { return nil }
        let column = min(max(Int(myPlayer.x / 512), 0), 1)
        let row = min(max(Int(myPlayer.y / 512), 0), 1)
        return row * 2 + column
    }
}

// MARK: - Old Compact Countdown Overlay (Deprecated)
struct CompactCountdownOverlay: View {
    @EnvironmentObject var gameState: GameState

    var body: some View {
        let myTile = currentTileId()

        return HStack(spacing: 8) {
            ForEach(0..<4) { tileId in
                if let tile = gameState.tiles[tileId] {
                    let isActive = tileId == gameState.activeTileId
                    let isMine = tileId == myTile
                    let countdownText = tile.countdown > 0 ? "\(tile.countdown)s" : "Ready"

                    VStack(spacing: 4) {
                        Text("Tile \(tileId)")
                            .appFont(11, weight: .bold)
                            .foregroundColor(.white.opacity(0.8))

                        Text(countdownText)
                            .appFont(16, weight: .bold)
                            .foregroundColor(tile.countdown <= 5 && tile.countdown > 0 ? .red : .white)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(isActive ? Color.green.opacity(0.7) : Color.black.opacity(0.65))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(isMine ? Color.white.opacity(0.9) : Color.clear, lineWidth: 2)
                            .shadow(color: isMine ? Color.white.opacity(0.4) : .clear, radius: 4)
                    )
                }
            }
        }
    }

    private func currentTileId() -> Int? {
        guard let myPlayer = gameState.myPlayer else { return nil }
        let column = min(max(Int(myPlayer.x / 512), 0), 1)
        let row = min(max(Int(myPlayer.y / 512), 0), 1)
        return row * 2 + column
    }
}

// MARK: - Joystick View
struct JoystickView: View {
    @EnvironmentObject var gameState: GameState
    @State private var joystickOffset: CGSize = .zero
    @State private var isDragging = false

    var body: some View {
        ZStack {
            // Outer circle (base)
            Circle()
                .fill(Color.black.opacity(0.3))
                .frame(width: 120, height: 120)

            Circle()
                .stroke(Color.white.opacity(0.5), lineWidth: 2)
                .frame(width: 120, height: 120)

            // Inner circle (stick)
            Circle()
                .fill(Color.white.opacity(0.8))
                .frame(width: 50, height: 50)
                .offset(joystickOffset)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            isDragging = true
                            let radius: CGFloat = 35 // Max distance from center

                            var newOffset = CGSize(
                                width: value.translation.width,
                                height: value.translation.height
                            )

                            // Clamp to circle
                            let distance = sqrt(newOffset.width * newOffset.width + newOffset.height * newOffset.height)
                            if distance > radius {
                                newOffset.width = (newOffset.width / distance) * radius
                                newOffset.height = (newOffset.height / distance) * radius
                            }

                            joystickOffset = newOffset

                            // Move player based on joystick
                            movePlayer(offset: newOffset)
                        }
                        .onEnded { _ in
                            isDragging = false
                            withAnimation(.spring(response: 0.3)) {
                                joystickOffset = .zero
                            }
                        }
                )

            // Direction indicator
            if isDragging {
                CustomEmojiView("🎯", size: 20, revealOnTap: false)
                    .offset(x: joystickOffset.width * 1.5, y: joystickOffset.height * 1.5)
            }
        }
    }

    private func movePlayer(offset: CGSize) {
        guard let myPlayer = gameState.myPlayer else { return }

        // Convert joystick offset to movement (scale by speed multiplier)
        // Joystick is called continuously, so we use lower speed per frame
        // Backend UNIVERSAL_MOVE_SPEED is 6.0 pixels per tick at 30 FPS
        // For smooth continuous joystick input, we use 2.5 pixels per drag event
        let moveSpeed: CGFloat = 2.5

        // Calculate direction
        let normalizedX = offset.width / 35.0 // Normalized -1 to 1
        let normalizedY = offset.height / 35.0

        let newX = myPlayer.x + (normalizedX * moveSpeed)
        let newY = myPlayer.y + (normalizedY * moveSpeed)

        let clampedX = max(0, min(1024, newX))
        let clampedY = max(0, min(1024, newY))

        let newPos = CGPoint(x: clampedX, y: clampedY)
        gameState.movePlayer(to: newPos)
        gameState.webSocketService.sendCursorMove(x: newPos.x, y: newPos.y)
    }
}

#Preview {
    NewGameView()
        .environmentObject(GameState())
}

// MARK: - UIKit Helpers
struct VisualEffectBlur: UIViewRepresentable {
    let style: UIBlurEffect.Style

    func makeUIView(context: Context) -> UIVisualEffectView {
        UIVisualEffectView(effect: UIBlurEffect(style: style))
    }

    func updateUIView(_ uiView: UIVisualEffectView, context: Context) {
        uiView.effect = UIBlurEffect(style: style)
    }
}

struct ConnectionDebugView: View {
    let statusText: String
    let strokeText: String
    let isConnected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Circle()
                    .fill(isConnected ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                Text(statusText)
                    .appFont(11, weight: .semibold)
                    .foregroundColor(.white)
                    .lineLimit(2)
            }

            Text(strokeText)
                .appFont(10, weight: .medium)
                .foregroundColor(.white.opacity(0.75))
                .lineLimit(2)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: 220, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.08))
        )
    }
}

// MARK: - Fight the AI overlay
private struct AIFightOverlay: View {
    let message: String
    @State private var pulse = false
    @State private var shake = false

    var body: some View {
        ZStack {
            // Full-screen pulsing red flash
            Color.red.opacity(pulse ? 0.25 : 0.05)
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 0.4).repeatForever(autoreverses: true), value: pulse)

            VStack(spacing: 0) {
                Spacer()

                VStack(spacing: 14) {
                    Text("🤖⚔️🎨")
                        .font(.system(size: 52))
                        .scaleEffect(pulse ? 1.12 : 0.95)
                        .animation(.easeInOut(duration: 0.35).repeatForever(autoreverses: true), value: pulse)

                    Text(message)
                        .font(.system(size: 26, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                        .shadow(color: .red.opacity(0.9), radius: 12, x: 0, y: 0)
                        .offset(x: shake ? -8 : 8)
                        .animation(.easeInOut(duration: 0.08).repeatForever(autoreverses: true), value: shake)
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 28)
                .background(
                    RoundedRectangle(cornerRadius: 24)
                        .fill(LinearGradient(
                            colors: [Color(red:0.7,green:0,blue:0).opacity(0.95), Color(red:0.9,green:0.3,blue:0).opacity(0.92)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ))
                        .shadow(color: .red.opacity(0.8), radius: 30, x: 0, y: 10)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(Color.red.opacity(pulse ? 1.0 : 0.4), lineWidth: 2)
                        .animation(.easeInOut(duration: 0.4).repeatForever(autoreverses: true), value: pulse)
                )
                .padding(.horizontal, 24)
                .transition(.asymmetric(
                    insertion: .scale(scale: 1.4).combined(with: .opacity),
                    removal: .scale(scale: 0.8).combined(with: .opacity)
                ))

                Spacer().frame(height: 180)
            }
        }
        .allowsHitTesting(false)
        .onAppear { pulse = true; shake = true }
    }
}

// MARK: - AI result reveal overlay
private struct AIRevealOverlay: View {
    let image: UIImage
    let onDismiss: () -> Void
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.88).ignoresSafeArea()
                .onTapGesture { onDismiss() }

            VStack(spacing: 20) {
                Text("🤖 AI transformed your tile!")
                    .font(.system(size: 22, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .shadow(color: .purple.opacity(0.9), radius: 10)
                    .scaleEffect(appeared ? 1.0 : 0.6)
                    .opacity(appeared ? 1.0 : 0)

                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(1, contentMode: .fit)
                    .frame(maxWidth: 340, maxHeight: 340)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(
                                LinearGradient(colors: [.purple, .pink, .orange],
                                               startPoint: .topLeading, endPoint: .bottomTrailing),
                                lineWidth: 3
                            )
                    )
                    .shadow(color: .purple.opacity(0.7), radius: 30)
                    .scaleEffect(appeared ? 1.0 : 0.3)
                    .rotation3DEffect(.degrees(appeared ? 0 : -45), axis: (x: 0, y: 1, z: 0))
                    .opacity(appeared ? 1.0 : 0)

                Text("Tap anywhere to continue painting")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white.opacity(0.5))
                    .opacity(appeared ? 1 : 0)
            }
            .padding()
        }
        .animation(.spring(response: 0.55, dampingFraction: 0.7), value: appeared)
        .onAppear { appeared = true }
    }
}
