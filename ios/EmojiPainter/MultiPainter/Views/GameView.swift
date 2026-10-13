//
//  GameView.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI

struct GameView: View {
    @EnvironmentObject var gameManager: GameManager
    @State private var showLobby = false
    @State private var showChat = false
    @State private var showColorPicker = false
    @State private var showLeaderboard = false
    @State private var selectedColor: Color = .red
    @State private var brushSize: Double = 8

    var body: some View {
        ZStack {
            // Main canvas
            CanvasView()
                .environmentObject(gameManager)

            // Top bar
            VStack {
                TopBar(
                    showLobby: $showLobby,
                    showLeaderboard: $showLeaderboard,
                    showColorPicker: $showColorPicker
                )
                .environmentObject(gameManager)

                Spacer()

                // Bottom bar with chat toggle
                BottomBar(showChat: $showChat)
                    .environmentObject(gameManager)
            }

            // Overlays
            if showLobby {
                Color.black.opacity(0.5)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showLobby = false
                    }

                LobbyView(isPresented: $showLobby)
                    .environmentObject(gameManager)
                    .transition(.move(edge: .trailing))
            }

            if showChat {
                VStack {
                    Spacer()
                    ChatView(isPresented: $showChat)
                        .environmentObject(gameManager)
                        .frame(height: 300)
                        .transition(.move(edge: .bottom))
                }
            }

            if showColorPicker {
                Color.black.opacity(0.5)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showColorPicker = false
                    }

                ColorPickerView(
                    isPresented: $showColorPicker,
                    selectedColor: $selectedColor,
                    brushSize: $brushSize
                )
                    .environmentObject(gameManager)
                    .transition(.scale)
            }

            if showLeaderboard {
                Color.black.opacity(0.5)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showLeaderboard = false
                    }

                LeaderboardView(isPresented: $showLeaderboard)
                    .environmentObject(gameManager)
                    .transition(.move(edge: .top))
            }
        }
        .animation(.spring(), value: showLobby)
        .animation(.spring(), value: showChat)
        .animation(.spring(), value: showColorPicker)
        .animation(.spring(), value: showLeaderboard)
    }
}

// MARK: - Top Bar
struct TopBar: View {
    @EnvironmentObject var gameManager: GameManager
    @Binding var showLobby: Bool
    @Binding var showLeaderboard: Bool
    @Binding var showColorPicker: Bool

    var body: some View {
        HStack {
            // Profile
            if let profile = gameManager.currentProfile {
                HStack(spacing: 8) {
                    CustomEmojiView(profile.emoji, size: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(profile.username)
                            .appFont(14, weight: .semibold)
                            .foregroundColor(.white)
                        HStack(spacing: 4) {
                            CustomEmojiView("💰", size: 10, revealOnTap: false)
                            Text("\(profile.coins)")
                                .appFont(12, weight: .medium)
                                .foregroundColor(.yellow)
                        }
                    }
                }
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.black.opacity(0.6))
                )
            }

            Spacer()

            // Controls
            HStack(spacing: 12) {
                Button(action: {
                    showColorPicker.toggle()
                }) {
                    Image(systemName: "paintpalette.fill")
                        .appFont(20)
                        .foregroundColor(.white)
                        .frame(width: 44, height: 44)
                        .background(
                            Circle()
                                .fill(Color.black.opacity(0.6))
                        )
                }

                Button(action: {
                    showLeaderboard.toggle()
                }) {
                    Image(systemName: "trophy.fill")
                        .appFont(20)
                        .foregroundColor(.yellow)
                        .frame(width: 44, height: 44)
                        .background(
                            Circle()
                                .fill(Color.black.opacity(0.6))
                        )
                }

                Button(action: {
                    showLobby.toggle()
                }) {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "person.3.fill")
                            .appFont(20)
                            .foregroundColor(.white)
                            .frame(width: 44, height: 44)
                            .background(
                                Circle()
                                    .fill(Color.black.opacity(0.6))
                            )

                        // Player count badge
                        Text("\(gameManager.activePlayers.count + gameManager.bots.count)")
                            .appFont(10, weight: .bold)
                            .foregroundColor(.white)
                            .frame(width: 18, height: 18)
                            .background(Circle().fill(Color.red))
                            .offset(x: 4, y: -4)
                    }
                }
            }
        }
        .padding()
        .background(
            LinearGradient(
                colors: [Color.black.opacity(0.3), Color.clear],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

// MARK: - Bottom Bar
struct BottomBar: View {
    @EnvironmentObject var gameManager: GameManager
    @Binding var showChat: Bool

    var body: some View {
        HStack {
            Button(action: {
                showChat.toggle()
            }) {
                HStack(spacing: 8) {
                    Image(systemName: "message.fill")
                        .appFont(20)
                    Text("Chat")
                        .appFont(16, weight: .semibold)

                    if !gameManager.chatMessages.isEmpty {
                        Text("\(gameManager.chatMessages.count)")
                            .appFont(12, weight: .bold)
                            .foregroundColor(.white)
                            .frame(width: 20, height: 20)
                            .background(Circle().fill(Color.red))
                    }
                }
                .foregroundColor(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 25)
                        .fill(Color.black.opacity(0.6))
                )
            }

            Spacer()
        }
        .padding()
        .background(
            LinearGradient(
                colors: [Color.clear, Color.black.opacity(0.3)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

#Preview {
    GameView()
        .environmentObject(GameManager())
}
