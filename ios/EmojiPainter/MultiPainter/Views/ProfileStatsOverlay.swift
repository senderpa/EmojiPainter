//
//  ProfileStatsOverlay.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI

// MARK: - Reusable Close Button
fileprivate struct AnimatedCloseButton: View {
    let action: () -> Void
    @State private var isPressed = false

    var body: some View {
        Button(action: {
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()

            withAnimation(.easeInOut(duration: 0.15)) {
                isPressed = true
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                action()
            }
        }) {
            CustomEmojiView(isPressed ? "✳️" : "❎", size: 28, revealOnTap: false)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color.black.opacity(0.3)))
        }
        .scaleEffect(isPressed ? 1.2 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.5), value: isPressed)
    }
}

struct ProfileStatsOverlay: View {
    @EnvironmentObject var gameState: GameState
    @Binding var isPresented: Bool
    @State private var showProfileEditor = false
    @State private var killCount: Int = UserPreferences.shared.loadKillCount()
    @State private var deathCount: Int = UserPreferences.shared.loadDeathCount()
    @State private var playtime: TimeInterval = UserPreferences.shared.loadPlaytime()
    @State private var displayedCoins: Int = UserPreferences.shared.loadCoins()
    @State private var displayedKarma: Int = UserPreferences.shared.loadKarma()
    @State private var pulse = false

    var body: some View {
        ZStack {
            // Background overlay
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                        isPresented = false
                    }
                }

            // Slide-in panel from right
            VStack(spacing: 0) {
                Spacer()

                VStack(spacing: 0) {
                    // Close button at top right
                    HStack {
                        Spacer()
                        AnimatedCloseButton {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                                isPresented = false
                            }
                        }
                        .padding(.top, 16)
                        .padding(.trailing, 16)
                    }
                    .zIndex(10)

                    // Scrollable content
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 24) {
                            // Header with drag indicator
                            dragIndicator

                            // Profile Header
                            profileHeader

                            // Stats Grid
                            statsGrid

                            // Lifetime Stats
                            lifetimeStats

                            // Edit Profile Button
                            editProfileButton
                        }
                        .padding(.horizontal, 24)
                        .padding(.bottom, 24)
                    }
                }
                .frame(maxWidth: .infinity)
                .background(
                    LinearGradient(
                        colors: [
                            Color(white: 0.12),
                            Color(white: 0.08)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .cornerRadius(30, corners: [.topLeft, .topRight])
                .shadow(color: .black.opacity(0.5), radius: 20)
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .onAppear {
            refreshStats()
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                pulse = true
            }
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

    private var dragIndicator: some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(Color.white.opacity(0.3))
            .frame(width: 40, height: 6)
    }

    private var profileHeader: some View {
        VStack(spacing: 16) {
            // Large Emoji Avatar
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [.purple.opacity(0.3), .blue.opacity(0.2)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 120, height: 120)
                    .scaleEffect(pulse ? 1.05 : 0.95)
                    .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: pulse)

                CustomEmojiView(profileEmoji, size: 64)
            }

            VStack(spacing: 6) {
                Text(profileName)
                    .appFont(28, weight: .bold)
                    .foregroundColor(.white)

                Text(profileRank)
                    .appFont(16, weight: .semibold)
                    .foregroundColor(rankColor)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                    .background(
                        Capsule()
                            .fill(rankColor.opacity(0.2))
                            .overlay(
                                Capsule()
                                    .stroke(rankColor, lineWidth: 1.5)
                            )
                    )
            }
        }
    }

    private var statsGrid: some View {
        HStack(spacing: 12) {
            StatCard(
                icon: "bitcoinsign.circle.fill",
                label: "Coins",
                value: "\(displayedCoins)",
                color: .yellow
            )

            StatCard(
                icon: "yin.yang",
                label: "Karma",
                value: karmaDisplay,
                color: karmaColor
            )
        }
    }

    private var lifetimeStats: some View {
        VStack(alignment: .leading, spacing: 16) {
            EmojiLabel("🏆 Lifetime Stats", size: 20, weight: .bold, color: .white)

            HStack(spacing: 12) {
                MiniStatPill(icon: "⚔️", value: "\(killCount)", label: "Kills", color: .green)
                MiniStatPill(icon: "💀", value: "\(deathCount)", label: "Deaths", color: .red)
            }

            MiniStatPill(icon: "⏱️", value: formattedPlaytime, label: "Play Time", color: .blue)

            // K/D Ratio
            if deathCount > 0 {
                MiniStatPill(
                    icon: "📊",
                    value: String(format: "%.2f", Double(killCount) / Double(deathCount)),
                    label: "K/D Ratio",
                    color: .purple
                )
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.white.opacity(0.05))
        )
    }

    private var editProfileButton: some View {
        Button(action: {
            showProfileEditor = true
        }) {
            HStack(spacing: 12) {
                Image(systemName: "person.crop.circle.fill.badge.pencil")
                    .appFont(20)
                Text("Edit Profile")
                    .appFont(18, weight: .semibold)
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(
                        LinearGradient(
                            colors: [.purple, .blue],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
            )
        }
    }

    // MARK: - Computed Properties
    private var profileName: String {
        gameState.currentProfile?.username ?? UserPreferences.shared.loadUsername() ?? "Unknown"
    }

    private var profileEmoji: String {
        gameState.currentProfile?.emoji ?? UserPreferences.shared.loadEmoji() ?? "🎨"
    }

    private var profileRank: String {
        let karma = displayedKarma
        if karma >= 1000 {
            return "🌟 Master Painter"
        } else if karma >= 500 {
            return "🎨 Expert Artist"
        } else if karma >= 200 {
            return "🖌️ Skilled Painter"
        } else if karma >= 50 {
            return "✏️ Apprentice"
        } else if karma >= 0 {
            return "🌱 Beginner"
        } else if karma >= -100 {
            return "⚠️ Troublemaker"
        } else {
            return "💀 Chaos Agent"
        }
    }

    private var rankColor: Color {
        let karma = displayedKarma
        if karma >= 500 {
            return .yellow
        } else if karma >= 200 {
            return .purple
        } else if karma >= 50 {
            return .blue
        } else if karma >= 0 {
            return .green
        } else {
            return .red
        }
    }

    private var karmaColor: Color {
        displayedKarma >= 0 ? .green : .red
    }

    private var karmaDisplay: String {
        displayedKarma >= 0 ? "+\(displayedKarma)" : "\(displayedKarma)"
    }

    private var formattedPlaytime: String {
        let hours = Int(playtime) / 3600
        let minutes = (Int(playtime) % 3600) / 60
        return "\(hours)h \(minutes)m"
    }

    private func refreshStats() {
        killCount = UserPreferences.shared.loadKillCount()
        deathCount = UserPreferences.shared.loadDeathCount()
        playtime = UserPreferences.shared.loadPlaytime()
        displayedCoins = UserPreferences.shared.loadCoins()
        displayedKarma = UserPreferences.shared.loadKarma()
    }
}

// MARK: - Stat Card
struct StatCard: View {
    let icon: String
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .appFont(32)
                .foregroundColor(color)

            VStack(spacing: 4) {
                Text(value)
                    .appFont(24, weight: .bold)
                    .foregroundColor(.white)

                Text(label)
                    .appFont(12, weight: .medium)
                    .foregroundColor(.white.opacity(0.7))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(color.opacity(0.15))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(color.opacity(0.3), lineWidth: 2)
                )
        )
    }
}

// MARK: - Mini Stat Pill
struct MiniStatPill: View {
    let icon: String
    let value: String
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 12) {
            CustomEmojiView(icon, size: 24, revealOnTap: false)

            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .appFont(18, weight: .bold)
                    .foregroundColor(.white)

                Text(label)
                    .appFont(12, weight: .medium)
                    .foregroundColor(.white.opacity(0.6))
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(color.opacity(0.15))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(color.opacity(0.3), lineWidth: 1.5)
                )
        )
    }
}

// MARK: - Corner Radius Extension
extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}
