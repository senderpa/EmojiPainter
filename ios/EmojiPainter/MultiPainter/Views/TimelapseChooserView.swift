//
//  TimelapseChooserView.swift
//  MultiPainter
//
//  Created by Claude Code - Timelapse Menu
//

import SwiftUI

struct TimelapseChooserView: View {
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var gameState: GameState
    @State private var showingFullTimelapse = false
    @State private var showingMyMoments = false

    var body: some View {
        ZStack {
            // Background
            LinearGradient(
                colors: [Color.black, Color(white: 0.15)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    Button(action: { dismiss() }) {
                        HStack(spacing: 8) {
                            Image(systemName: "chevron.left")
                                .appFont(18, weight: .semibold)
                            Text("Back")
                                .appFont(16, weight: .semibold)
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color.white.opacity(0.15))
                        )
                    }

                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 16)

                Spacer()

                // Title
                VStack(spacing: 12) {
                    Text("⏳")
                        .appFont(60)

                    Text("Timelapse")
                        .appFont(32, weight: .bold)
                        .foregroundColor(.white)

                    Text("Choose how you want to view")
                        .appFont(16)
                        .foregroundColor(.white.opacity(0.7))
                }
                .padding(.bottom, 40)

                // Options
                VStack(spacing: 20) {
                    // All Timelapse
                    TimelapseOptionCard(
                        icon: "film.fill",
                        iconColor: .purple,
                        title: "All Timelapse",
                        description: "Watch the entire canvas history from newest to oldest. See what everyone has painted!",
                        badge: "30+ Minutes"
                    )
                    .onTapGesture {
                        showingFullTimelapse = true
                    }

                    // My Moments
                    TimelapseOptionCard(
                        icon: "sparkles",
                        iconColor: .pink,
                        title: "My Moments",
                        description: "View your personal painting sessions with 10-minute captures of your creative moments.",
                        badge: gameState.isPaintingSessionActive ? "Recording..." : nil
                    )
                    .onTapGesture {
                        showingMyMoments = true
                    }
                }
                .padding(.horizontal, 20)

                Spacer()

                // Info about painting sessions
                if gameState.isPaintingSessionActive {
                    HStack(spacing: 8) {
                        Image(systemName: "record.circle.fill")
                            .appFont(16)
                            .foregroundColor(.red)
                        Text("Your painting moment is being captured")
                            .appFont(14, weight: .medium)
                            .foregroundColor(.white)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.red.opacity(0.2))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.red.opacity(0.5), lineWidth: 1)
                            )
                    )
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                }
            }
        }
        .fullScreenCover(isPresented: $showingFullTimelapse) {
            FullscreenTimelapsePlayer()
                .environmentObject(gameState)
        }
        .fullScreenCover(isPresented: $showingMyMoments) {
            MyMomentsView()
                .environmentObject(gameState)
        }
    }
}

struct TimelapseOptionCard: View {
    let icon: String
    let iconColor: Color
    let title: String
    let description: String
    let badge: String?

    var body: some View {
        HStack(spacing: 20) {
            // Icon
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [iconColor.opacity(0.3), iconColor.opacity(0.1)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 70, height: 70)

                Image(systemName: icon)
                    .appFont(28)
                    .foregroundColor(iconColor)
            }

            // Content
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(title)
                        .appFont(20, weight: .bold)
                        .foregroundColor(.white)

                    if let badge = badge {
                        Text(badge)
                            .appFont(10, weight: .semibold)
                            .foregroundColor(badge.contains("Recording") ? .red : .purple)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(
                                Capsule()
                                    .fill(badge.contains("Recording") ? Color.red.opacity(0.2) : Color.purple.opacity(0.2))
                            )
                    }
                }

                Text(description)
                    .appFont(13)
                    .foregroundColor(.white.opacity(0.7))
                    .lineSpacing(3)
            }

            Spacer()

            // Arrow
            Image(systemName: "chevron.right")
                .appFont(18, weight: .semibold)
                .foregroundColor(.white.opacity(0.4))
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(
                            LinearGradient(
                                colors: [iconColor.opacity(0.3), iconColor.opacity(0.1)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 2
                        )
                )
        )
        .shadow(color: iconColor.opacity(0.2), radius: 10)
    }
}
