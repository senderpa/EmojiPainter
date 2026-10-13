//
//  LobbyView.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI

struct LobbyView: View {
    @EnvironmentObject var gameManager: GameManager
    @Binding var isPresented: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Players & Bots")
                    .appFont(24, weight: .bold)
                    .foregroundColor(.white)

                Spacer()

                Button(action: {
                    isPresented = false
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .appFont(28)
                        .foregroundColor(.white.opacity(0.8))
                }
            }
            .padding()
            .background(Color.black.opacity(0.8))

            ScrollView {
                VStack(spacing: 16) {
                    // Active Players Section
                    if !gameManager.activePlayers.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("PLAYERS")
                                .appFont(14, weight: .bold)
                                .foregroundColor(.white.opacity(0.6))
                                .padding(.horizontal)

                            ForEach(gameManager.activePlayers) { player in
                                PlayerRow(
                                    emoji: player.emoji,
                                    username: player.username,
                                    lives: player.lives,
                                    alive: player.alive,
                                    isBot: false
                                )
                            }
                        }
                    }

                    // Bots Section
                    if !gameManager.bots.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("BOTS")
                                .appFont(14, weight: .bold)
                                .foregroundColor(.white.opacity(0.6))
                                .padding(.horizontal)

                            ForEach(gameManager.bots) { bot in
                                PlayerRow(
                                    emoji: bot.emoji,
                                    username: bot.username,
                                    lives: bot.lives,
                                    alive: bot.alive,
                                    isBot: true,
                                    color: bot.color
                                )
                            }
                        }
                    }

                    if gameManager.activePlayers.isEmpty && gameManager.bots.isEmpty {
                        VStack(spacing: 16) {
                            Image(systemName: "person.3.fill")
                                .appFont(48)
                                .foregroundColor(.white.opacity(0.3))

                            Text("No players yet")
                                .appFont(16)
                                .foregroundColor(.white.opacity(0.6))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 60)
                    }
                }
                .padding(.vertical)
            }
        }
        .frame(width: 320)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.black.opacity(0.9))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white.opacity(0.2), lineWidth: 1)
        )
        .shadow(radius: 20)
    }
}

struct PlayerRow: View {
    let emoji: String
    let username: String
    let lives: Int
    let alive: Bool
    let isBot: Bool
    var color: String = "#FFFFFF"

    var body: some View {
        HStack(spacing: 12) {
            // Avatar
            CustomEmojiView(emoji, size: 32)
                .frame(width: 50, height: 50)
                .background(
                    Circle()
                        .fill(Color(hex: color).opacity(0.2))
                )
                .overlay(
                    Circle()
                        .stroke(alive ? Color.green : Color.red, lineWidth: 2)
                )

            // Info
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(username)
                        .appFont(16, weight: .semibold)
                        .foregroundColor(.white)

                    if isBot {
                        Text("BOT")
                            .appFont(10, weight: .bold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.purple)
                            )
                    }
                }

                HStack(spacing: 4) {
                    ForEach(0..<3) { index in
                        Image(systemName: index < lives ? "heart.fill" : "heart")
                            .appFont(12)
                            .foregroundColor(index < lives ? .red : .white.opacity(0.3))
                    }
                }
            }

            Spacer()

            // Status indicator
            Circle()
                .fill(alive ? Color.green : Color.red)
                .frame(width: 10, height: 10)
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(alive ? 0.1 : 0.05))
        )
        .padding(.horizontal)
    }
}

#Preview {
    LobbyView(isPresented: .constant(true))
        .environmentObject(GameManager())
}
