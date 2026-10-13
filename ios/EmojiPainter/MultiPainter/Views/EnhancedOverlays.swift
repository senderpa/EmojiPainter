//
//  EnhancedOverlays.swift
//  MultiPainter
//
//  Created by Claude Code - Animated Glass Morphism Overlays
//

import SwiftUI

// MARK: - Enhanced Chat Overlay
struct EnhancedChatOverlay: View {
    @Binding var isPresented: Bool
    @EnvironmentObject var gameState: GameState
    @State private var messageText = ""
    @State private var isVisible = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(Color(hex: "#4ECDC4"))

                Text("Chat")
                    .font(.custom("vrtlfinale1", size: 20))
                    .fontWeight(.bold)
                    .foregroundColor(.white)

                Spacer()

                Button(action: { dismiss() }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(.white.opacity(0.8))
                }
            }
            .padding(16)
            .background(Color.white.opacity(0.05))

            // Messages
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(gameState.chatMessages.suffix(50), id: \.timestamp) { message in
                        ChatBubble(message: message)
                    }
                }
                .padding(16)
            }
            .frame(maxHeight: 400)

            // Input
            HStack(spacing: 12) {
                TextField("Type a message...", text: $messageText)
                    .font(.custom("vrtlfinale1", size: 14))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.white.opacity(0.1))
                    )

                Button(action: sendMessage) {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 44, height: 44)
                        .background(
                            Circle()
                                .fill(
                                    LinearGradient(
                                        colors: [Color(hex: "#4ECDC4"), Color(hex: "#44A08D")],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                        )
                }
                .disabled(messageText.isEmpty)
            }
            .padding(16)
            .background(Color.white.opacity(0.05))
        }
        .frame(width: 360)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(hex: "#1A1A2E").opacity(0.95),
                            Color(hex: "#16213E").opacity(0.95)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(
                            LinearGradient(
                                colors: [
                                    Color(hex: "#4ECDC4").opacity(0.4),
                                    Color.clear
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 2
                        )
                )
                .shadow(color: Color.black.opacity(0.4), radius: 20, y: 10)
        )
        .offset(x: isVisible ? 0 : 400)
        .onAppear {
            withAnimation(OverlayTransitions.bouncy) {
                isVisible = true
            }
        }
    }

    private func sendMessage() {
        guard !messageText.isEmpty else { return }
        gameState.sendChatMessage(messageText)
        messageText = ""
    }

    private func dismiss() {
        withAnimation(OverlayTransitions.quick) {
            isVisible = false
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            isPresented = false
        }
    }
}

// MARK: - Chat Bubble
struct ChatBubble: View {
    let message: ChatBroadcast

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            CustomEmojiView(message.senderEmoji, size: 24)

            VStack(alignment: .leading, spacing: 4) {
                Text(message.senderUsername)
                    .font(.custom("vrtlfinale1", size: 12))
                    .fontWeight(.bold)
                    .foregroundColor(Color(hex: "#4ECDC4"))

                Text(message.content)
                    .font(.custom("vrtlfinale1", size: 14))
                    .foregroundColor(.white)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.08))
        )
    }
}

// MARK: - Enhanced Player Info (iPad 30% wider)
struct EnhancedPlayerInfoOverlay: View {
    @EnvironmentObject var gameState: GameState

    var body: some View {
        if let player = gameState.myPlayer {
            VStack(alignment: .leading, spacing: 12) {
                // Player identity
                HStack(spacing: 12) {
                    // Emoji avatar with glow
                    ZStack {
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        Color(hex: "#FF6B6B").opacity(0.4),
                                        Color.clear
                                    ],
                                    center: .center,
                                    startRadius: 0,
                                    endRadius: 30
                                )
                            )
                            .frame(width: 60, height: 60)
                            .blur(radius: 10)

                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [Color(hex: "#FF6B6B"), Color(hex: "#FF8E53")],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 48, height: 48)

                        CustomEmojiView(player.emoji, size: 28)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(player.username)
                            .font(.custom("vrtlfinale1", size: 18))
                            .fontWeight(.bold)
                            .foregroundColor(.white)

                        Text("Level \(player.level ?? 1)")
                            .font(.custom("vrtlfinale1", size: 12))
                            .foregroundColor(.white.opacity(0.7))
                    }
                }

                Divider()
                    .background(Color.white.opacity(0.2))

                // Stats
                VStack(spacing: 10) {
                    // Hearts
                    StatRow(
                        icon: "heart.fill",
                        label: "Lives",
                        value: "\(player.lives)/3",
                        color: Color(hex: "#FF6B6B"),
                        progress: Double(player.lives) / 3.0
                    )

                    // Coins
                    StatRow(
                        icon: "bitcoinsign.circle.fill",
                        label: "Coins",
                        value: "\(gameState.currentProfile?.coins ?? 0)",
                        color: Color(hex: "#F2C94C"),
                        progress: nil
                    )

                    // Shield
                    if player.hasShield {
                        StatRow(
                            icon: "shield.fill",
                            label: "Shield",
                            value: "Active",
                            color: Color(hex: "#4ECDC4"),
                            progress: nil
                        )
                    }
                }
            }
            .padding(20)
            .frame(width: isIPad() ? 325 : 250) // 30% wider on iPad (250 * 1.3 = 325)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.black.opacity(0.7),
                                Color(hex: "#1A1A2E").opacity(0.7)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(
                                LinearGradient(
                                    colors: [
                                        Color(hex: "#4ECDC4").opacity(0.4),
                                        Color.clear
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 2
                            )
                    )
            )
            .shadow(color: Color.black.opacity(0.3), radius: 15, y: 8)
        }
    }

    private func isIPad() -> Bool {
        UIDevice.current.userInterfaceIdiom == .pad
    }
}

// MARK: - Stat Row
struct StatRow: View {
    let icon: String
    let label: String
    let value: String
    let color: Color
    let progress: Double?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(color)
                .frame(width: 24)

            Text(label)
                .font(.custom("vrtlfinale1", size: 14))
                .fontWeight(.semibold)
                .foregroundColor(.white.opacity(0.9))

            Spacer()

            if let progress = progress {
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.white.opacity(0.2))
                            .frame(height: 8)

                        RoundedRectangle(cornerRadius: 4)
                            .fill(color)
                            .frame(width: geometry.size.width * progress, height: 8)
                    }
                }
                .frame(width: 60, height: 8)
            }

            Text(value)
                .font(.custom("vrtlfinale1", size: 14))
                .fontWeight(.bold)
                .foregroundColor(color)
        }
    }
}

// Color(hex:) is defined in Extensions/Color+Hex.swift
