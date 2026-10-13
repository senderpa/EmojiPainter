//
//  ContentView.swift
//  MultiPainter
//
//  Created by Claude Code - V2 Architecture
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var gameState: GameState
    @State private var showSplash = true
    @State private var showSplashBackground = true
    @State private var showSplashLogo = true
    @State private var didStartBootstrap = false
    @State private var didShowSplash = false

    var body: some View {
        ZStack {
            if gameState.hasJoinedGame && gameState.readyToShowGame {
                NewGameView()
            } else {
                NewLobbyView()
            }

            // Only show splash once on initial app launch
            if showSplash && !didShowSplash {
                SplashView(showBackground: $showSplashBackground, showLogo: $showSplashLogo)
                    .environmentObject(gameState)
            }

            // Network error overlay
            if gameState.showNetworkError {
                OfflineErrorOverlay()
                    .environmentObject(gameState)
                    .transition(.opacity)
                    .zIndex(100)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            startBootstrapIfNeeded()

            // Only run splash animation once
            if !didShowSplash {
                didShowSplash = true

                // Start collecting images immediately
                gameState.startSplashImageCollection()

                // 10-second splash screen sequence
                // Fade background first (after 8s)
                DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) {
                    withAnimation(.easeOut(duration: 0.5)) {
                        showSplashBackground = false
                    }
                }
                // Then blur and fade logo (after 9s)
                DispatchQueue.main.asyncAfter(deadline: .now() + 9.0) {
                    withAnimation(.easeOut(duration: 0.5)) {
                        showSplashLogo = false
                    }
                }
                // Finally hide splash completely (after 10s)
                DispatchQueue.main.asyncAfter(deadline: .now() + 10.0) {
                    showSplash = false
                }
            }
        }
    }

    private func startBootstrapIfNeeded() {
        guard !didStartBootstrap else { return }
        didStartBootstrap = true
        gameState.bootstrapProfileIfNeeded()
    }
}

struct SplashView: View {
    @Binding var showBackground: Bool
    @Binding var showLogo: Bool
    @EnvironmentObject var gameState: GameState
    @State private var gradientOffset: CGFloat = 0
    @State private var typewriterText = ""
    @State private var loaderRotation: Double = 0

    private var logoSize: CGFloat {
        // Fullscreen size matching lobby preview (350px)
        UIDevice.current.userInterfaceIdiom == .pad ? 450 : 350
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.4"
        return "v\(version)"
    }

    private var currentYear: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy"
        return formatter.string(from: Date())
    }

    var body: some View {
        ZStack {
            // Vertical gradient moving downward - starting light, getting darker
            LinearGradient(
                gradient: Gradient(stops: [
                    .init(color: Color(white: 0.8), location: -0.5 + gradientOffset),
                    .init(color: Color(white: 0.7), location: -0.3 + gradientOffset),
                    .init(color: Color(white: 0.6), location: -0.1 + gradientOffset),
                    .init(color: Color(white: 0.4), location: 0.1 + gradientOffset),
                    .init(color: Color(white: 0.25), location: 0.3 + gradientOffset),
                    .init(color: Color(white: 0.15), location: 0.5 + gradientOffset),
                    .init(color: Color(white: 0.1), location: 0.7 + gradientOffset),
                    .init(color: Color.black, location: 0.9 + gradientOffset)
                ]),
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .opacity(showBackground ? 1 : 0)
            .animation(.linear(duration: 3.0).repeatForever(autoreverses: false), value: gradientOffset)

            VStack(spacing: 20) {
                Spacer()

                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: logoSize, height: logoSize)
                    .clipShape(RoundedRectangle(cornerRadius: 30))
                    .shadow(color: .black.opacity(0.3), radius: 12, x: 0, y: 8)
                    .blur(radius: showLogo ? 0 : 20)
                    .opacity(showLogo ? 1 : 0)

                Text("MultiPainter")
                    .appFont(48, weight: .bold)
                    .foregroundColor(.white)
                    .blur(radius: showLogo ? 0 : 10)
                    .opacity(showLogo ? 1 : 0)

                Text(typewriterText)
                    .appFont(12, weight: .medium)
                    .foregroundColor(.white.opacity(0.8))
                    .blur(radius: showLogo ? 0 : 10)
                    .opacity(showLogo ? 1 : 0)
                    .frame(maxWidth: 350)

                // Animated Loader
                VStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .stroke(Color.white.opacity(0.2), lineWidth: 4)
                            .frame(width: 50, height: 50)

                        Circle()
                            .trim(from: 0, to: gameState.splashLoadProgress)
                            .stroke(
                                LinearGradient(
                                    colors: [Color.purple, Color.blue],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                style: StrokeStyle(lineWidth: 4, lineCap: .round)
                            )
                            .frame(width: 50, height: 50)
                            .rotationEffect(.degrees(-90))
                            .animation(.easeInOut(duration: 0.3), value: gameState.splashLoadProgress)

                        Text("\(Int(gameState.splashLoadProgress * 100))%")
                            .appFont(12, weight: .bold)
                            .foregroundColor(.white)
                    }

                    Text("Loading preview...")
                        .appFont(14, weight: .medium)
                        .foregroundColor(.white.opacity(0.7))
                }
                .blur(radius: showLogo ? 0 : 10)
                .opacity(showLogo ? 1 : 0)
                .padding(.top, 20)

                Spacer()
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 3.0).repeatForever(autoreverses: false)) {
                gradientOffset = 1.5
            }
            startTypewriter()
        }
    }

    private func startTypewriter() {
        let fullText = "by Pascal Sender • \(currentYear) • \(appVersion)"
        typewriterText = ""

        for (index, character) in fullText.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * 0.05) {
                typewriterText.append(character)
            }
        }
    }
}

// MARK: - Offline Error Overlay
struct OfflineErrorOverlay: View {
    @EnvironmentObject var gameState: GameState

    var body: some View {
        ZStack {
            // Blurred background
            Color.black.opacity(0.85)
                .ignoresSafeArea()

            VStack(spacing: 30) {
                // Icon
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [Color.red.opacity(0.3), Color.orange.opacity(0.3)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 120, height: 120)

                    CustomEmojiView("📡", size: 60, revealOnTap: false)
                }

                VStack(spacing: 12) {
                    Text("No Internet Connection")
                        .appFont(28, weight: .bold)
                        .foregroundColor(.white)

                    Text(gameState.hasNetworkConnection ? "Reconnecting to server..." : "Please check your WiFi or mobile data")
                        .appFont(16, weight: .medium)
                        .foregroundColor(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }

                // Connection status info
                HStack(spacing: 8) {
                    Circle()
                        .fill(gameState.hasNetworkConnection ? Color.green : Color.red)
                        .frame(width: 12, height: 12)

                    Text(gameState.hasNetworkConnection ? "Network: Connected" : "Network: Offline")
                        .appFont(14, weight: .semibold)
                        .foregroundColor(.white.opacity(0.8))
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 20)
                        .fill(Color.white.opacity(0.1))
                )

                // Retry button
                Button(action: {
                    let generator = UIImpactFeedbackGenerator(style: .medium)
                    generator.impactOccurred()
                    gameState.retryConnection()
                }) {
                    HStack(spacing: 12) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 18, weight: .semibold))

                        Text("Retry Connection")
                            .appFont(18, weight: .bold)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 40)
                    .padding(.vertical, 16)
                    .background(
                        LinearGradient(
                            colors: [Color.purple, Color.blue],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 30))
                    .shadow(color: .purple.opacity(0.5), radius: 15, x: 0, y: 5)
                }
            }
            .padding(40)
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(GameState())
}
