//
//  LobbyScreenView.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI

struct LobbyScreenView: View {
    @EnvironmentObject var gameManager: GameManager

    var body: some View {
        ZStack {
            // Gradient background
            LinearGradient(
                colors: [Color.purple.opacity(0.8), Color.blue.opacity(0.8)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 30) {
                // Header
                VStack(spacing: 15) {
                    // Logo
                    Image("Logo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .shadow(color: .black.opacity(0.3), radius: 5, x: 0, y: 3)

                    Text("Game Lobby")
                        .appFont(42, weight: .bold)
                        .foregroundColor(.white)

                    Text("Connected Players")
                        .appFont(18)
                        .foregroundColor(.white.opacity(0.8))
                }
                .padding(.top, 60)

                // Player list
                ScrollView {
                    VStack(spacing: 16) {
                        // Active players
                        ForEach(gameManager.activePlayers) { player in
                            LobbyPlayerCard(
                                emoji: player.emoji,
                                username: player.username,
                                lives: player.lives,
                                isBot: false,
                                color: "#FFFFFF"
                            )
                        }

                        // Bots
                        ForEach(gameManager.bots) { bot in
                            LobbyPlayerCard(
                                emoji: bot.emoji,
                                username: bot.username,
                                lives: bot.lives,
                                isBot: true,
                                color: bot.color
                            )
                        }

                        if gameManager.activePlayers.isEmpty && gameManager.bots.isEmpty {
                            VStack(spacing: 16) {
                                Image(systemName: "person.3.fill")
                                    .appFont(48)
                                    .foregroundColor(.white.opacity(0.3))

                                Text("Waiting for players...")
                                    .appFont(16)
                                    .foregroundColor(.white.opacity(0.6))
                            }
                            .padding(.vertical, 40)
                        }
                    }
                    .padding()
                }

                Spacer()

                // Join Game button
                Button(action: {
                    gameManager.joinGame()
                }) {
                    HStack(spacing: 12) {
                        Image(systemName: "play.circle.fill")
                            .appFont(24)

                        Text("Join Game")
                            .appFont(22, weight: .bold)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 60)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color.green)
                    )
                }
                .padding(.horizontal, 30)
                .padding(.bottom, 40)
            }
        }
    }
}

struct LobbyPlayerCard: View {
    let emoji: String
    let username: String
    let lives: Int
    let isBot: Bool
    let color: String

    var body: some View {
        HStack(spacing: 16) {
            // Emoji avatar
            CustomEmojiView(emoji, size: 40)
                .frame(width: 60, height: 60)
                .background(
                    Circle()
                        .fill(Color(hex: color).opacity(0.3))
                )

            // Player info
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(username)
                        .appFont(18, weight: .semibold)
                        .foregroundColor(.white)

                    if isBot {
                        Text("BOT")
                            .appFont(10, weight: .bold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.purple)
                            )
                    }
                }

                // Hearts
                HStack(spacing: 4) {
                    ForEach(0..<3) { index in
                        Image(systemName: index < lives ? "heart.fill" : "heart")
                            .appFont(14)
                            .foregroundColor(index < lives ? .red : .white.opacity(0.3))
                    }
                }
            }

            Spacer()

            // Status
            Circle()
                .fill(Color.green)
                .frame(width: 12, height: 12)
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.15))
        )
    }
}

#Preview {
    LobbyScreenView()
        .environmentObject(GameManager())
}
