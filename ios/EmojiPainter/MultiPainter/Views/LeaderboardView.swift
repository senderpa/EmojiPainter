//
//  LeaderboardView.swift
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

struct LeaderboardView: View {
    @EnvironmentObject var gameManager: GameManager
    @Binding var isPresented: Bool
    @State private var leaderboard: LeaderboardResponse?
    @State private var isLoading = true
    @State private var activeTab: Int = 0   // 0 = General, 1 = MultiPaint

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Leaderboard")
                    .appFont(24, weight: .bold)
                    .foregroundColor(.white)
                Spacer()
                AnimatedCloseButton { isPresented = false }
            }
            .padding()
            .background(
                LinearGradient(
                    colors: [Color.yellow.opacity(0.3), Color.orange.opacity(0.3)],
                    startPoint: .leading, endPoint: .trailing
                )
            )

            // Tab switcher
            HStack(spacing: 0) {
                tabButton(label: "🏆 General", tag: 0, accent: .yellow)
                tabButton(label: "🎨 MultiPaint", tag: 1, accent: .orange)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.black.opacity(0.6))

            if activeTab == 0 {
                generalLeaderboardContent
            } else {
                MultiPaintLeaderboardContent()
            }
        }
        .frame(
            width: UIDevice.current.userInterfaceIdiom == .pad ? 720 : 360,
            height: UIDevice.current.userInterfaceIdiom == .pad ? 1000 : 500
        )
        .background(RoundedRectangle(cornerRadius: 20).fill(Color.black.opacity(0.95)))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.yellow.opacity(0.3), lineWidth: 2))
        .shadow(radius: 20)
        .onAppear { loadLeaderboard() }
    }

    @ViewBuilder
    private func tabButton(label: String, tag: Int, accent: Color) -> some View {
        Button(action: { activeTab = tag }) {
            Text(label)
                .appFont(13, weight: activeTab == tag ? .bold : .regular)
                .foregroundColor(activeTab == tag ? accent : .white.opacity(0.5))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(activeTab == tag ? accent.opacity(0.15) : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    @ViewBuilder
    private var generalLeaderboardContent: some View {
        if isLoading {
            VStack(spacing: 20) {
                ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .white)).scaleEffect(1.5)
                Text("Loading rankings...").appFont(16).foregroundColor(.white.opacity(0.7))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(0.8))
        } else if let leaderboard = leaderboard {
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(Array(leaderboard.entries.enumerated()), id: \.element.id) { index, entry in
                        LeaderboardRow(rank: index + 1, emoji: entry.emoji, username: entry.username, coins: entry.coins)
                    }
                }
                .padding()
            }
            .background(Color.black.opacity(0.8))
        } else {
            VStack(spacing: 20) {
                Image(systemName: "exclamationmark.triangle.fill").appFont(48).foregroundColor(.yellow.opacity(0.7))
                Text("Failed to load leaderboard").appFont(16).foregroundColor(.white.opacity(0.7))
                Button(action: { loadLeaderboard() }) {
                    Text("Retry").appFont(16, weight: .semibold).foregroundColor(.white)
                        .padding(.horizontal, 24).padding(.vertical, 12)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.blue))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(0.8))
        }
    }

    private func loadLeaderboard() {
        isLoading = true
        Task {
            let result = await gameManager.getLeaderboard()
            await MainActor.run { self.leaderboard = result; self.isLoading = false }
        }
    }
}

// MARK: - MultiPaint Leaderboard
private struct MultiPaintEntry: Identifiable {
    let id: String
    let rank: Int
    let username: String
    let emoji: String
    let passportUrl: String?
    let multiStrokes: Int
}

private struct MultiPaintLeaderboardContent: View {
    @State private var entries: [MultiPaintEntry] = []
    @State private var isLoading = true
    @State private var failed = false

    var body: some View {
        Group {
            if isLoading {
                VStack(spacing: 20) {
                    ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .orange)).scaleEffect(1.5)
                    Text("Loading MultiPaint ranks...").appFont(16).foregroundColor(.white.opacity(0.7))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if failed {
                VStack(spacing: 20) {
                    Text("⚠️").font(.system(size: 40))
                    Text("Could not load MultiPaint leaderboard").appFont(14).foregroundColor(.white.opacity(0.6))
                    Button("Retry") { load() }
                        .appFont(14, weight: .semibold).foregroundColor(.orange)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if entries.isEmpty {
                VStack(spacing: 12) {
                    Text("🎨").font(.system(size: 50))
                    Text("No strokes yet — be the first!").appFont(16).foregroundColor(.white.opacity(0.7))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(entries) { e in
                            MultiPaintRow(entry: e)
                        }
                    }
                    .padding()
                }
            }
        }
        .background(Color.black.opacity(0.8))
        .onAppear { load() }
    }

    private func load() {
        isLoading = true; failed = false
        Task {
            guard let url = URL(string: "https://emojipainter.com/leaderboard/multipaint_feed.php") else { return }
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                let items = json?["items"] as? [[String: Any]] ?? []
                let parsed: [MultiPaintEntry] = items.compactMap { item in
                    guard let username = item["username"] as? String else { return nil }
                    return MultiPaintEntry(
                        id: username,
                        rank: item["rank"] as? Int ?? 0,
                        username: username,
                        emoji: item["emoji"] as? String ?? "🎨",
                        passportUrl: item["passportUrl"] as? String,
                        multiStrokes: item["multiStrokes"] as? Int ?? 0
                    )
                }
                await MainActor.run { entries = parsed; isLoading = false }
            } catch {
                await MainActor.run { failed = true; isLoading = false }
            }
        }
    }
}

private struct MultiPaintRow: View {
    let entry: MultiPaintEntry

    var body: some View {
        HStack(spacing: 14) {
            // Rank badge
            ZStack {
                Circle().fill(rankColor.opacity(0.2)).frame(width: 36, height: 36)
                if entry.rank <= 3 {
                    Text(rankEmoji).font(.system(size: 18))
                } else {
                    Text("\(entry.rank)").appFont(15, weight: .bold).foregroundColor(.white.opacity(0.7))
                }
            }

            // Passport or emoji avatar
            if let urlStr = entry.passportUrl, let url = URL(string: urlStr) {
                AsyncImage(url: url) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Text(entry.emoji).font(.system(size: 26))
                }
                .frame(width: 44, height: 44)
                .clipShape(Circle())
                .overlay(Circle().stroke(rankColor.opacity(0.5), lineWidth: 1.5))
            } else {
                Text(entry.emoji).font(.system(size: 30))
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.white.opacity(0.08)))
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.username).appFont(15, weight: .semibold).foregroundColor(.white)
                Text("🖌 \(entry.multiStrokes.formatted()) strokes").appFont(12).foregroundColor(.orange.opacity(0.8))
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12).fill(entry.rank <= 3 ? rankColor.opacity(0.12) : Color.white.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(entry.rank <= 3 ? rankColor.opacity(0.4) : Color.clear, lineWidth: 1))
    }

    private var rankColor: Color {
        switch entry.rank { case 1: return .yellow; case 2: return .gray; case 3: return Color(red:0.8,green:0.5,blue:0.2); default: return .white }
    }
    private var rankEmoji: String {
        switch entry.rank { case 1: return "🥇"; case 2: return "🥈"; case 3: return "🥉"; default: return "" }
    }
}

struct LeaderboardRow: View {
    let rank: Int
    let emoji: String
    let username: String
    let coins: Int

    var body: some View {
        HStack(spacing: 16) {
            // Rank
            ZStack {
                if rank <= 3 {
                    Image(systemName: rankIcon)
                        .appFont(28)
                        .foregroundColor(rankColor)
                } else {
                    Text("\(rank)")
                        .appFont(18, weight: .bold)
                        .foregroundColor(.white.opacity(0.6))
                }
            }
            .frame(width: 40)

            // Avatar
            CustomEmojiView(emoji, size: 32)
                .frame(width: 50, height: 50)
                .background(
                    Circle()
                        .fill(rankColor.opacity(rank <= 3 ? 0.2 : 0.1))
                )

            // Username
            Text(username)
                .appFont(16, weight: rank <= 3 ? .bold : .semibold)
                .foregroundColor(.white)

            Spacer()

            // Coins
            HStack(spacing: 6) {
                CustomEmojiView("💰", size: 18, revealOnTap: false)
                Text("\(coins)")
                    .appFont(16, weight: .bold)
                    .foregroundColor(.yellow)
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(rank <= 3 ? rankColor.opacity(0.15) : Color.white.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(rank <= 3 ? rankColor.opacity(0.5) : Color.clear, lineWidth: 1)
        )
    }

    private var rankIcon: String {
        switch rank {
        case 1: return "crown.fill"
        case 2: return "medal.fill"
        case 3: return "star.fill"
        default: return ""
        }
    }

    private var rankColor: Color {
        switch rank {
        case 1: return .yellow
        case 2: return .gray
        case 3: return Color(red: 0.8, green: 0.5, blue: 0.2)
        default: return .white
        }
    }
}

#Preview {
    LeaderboardView(isPresented: .constant(true))
        .environmentObject(GameManager())
}
