//
//  EnhancedSettingsOverlay.swift
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

struct EnhancedSettingsOverlay: View {
    @EnvironmentObject var gameState: GameState
    @Binding var isPresented: Bool
    @StateObject private var localization = LocalizationManager.shared
    @State private var showProfile = false
    @State private var showEmojiSets = false
    @State private var selectedLanguage: GameLanguage = .english
    @State private var animatedEmojis: [AnimatedEmoji] = []

    var body: some View {
        ZStack {
            // Background
            Color.black.opacity(0.9)
                .ignoresSafeArea()
                .onTapGesture {
                    isPresented = false
                }

            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    // Header
                    header

                    // Language Picker
                    languagePicker

                    // Emoji Set Picker
                    emojiSetSection

                    // Animated Game Rules
                    gameRulesSection

                    // Close Button
                    closeButton
                }
                .padding(30)
            }

            // Animated floating emojis
            ForEach(animatedEmojis) { emoji in
                FloatingEmojiView(emoji: emoji)
            }

            // Profile Overlay
            if showProfile {
                ProfileStatsOverlay(isPresented: $showProfile)
                    .environmentObject(gameState)
                    .transition(.move(edge: .trailing))
            }
        }
        .onAppear {
            selectedLanguage = localization.currentLanguage
            startEmojiAnimation()
        }
        .sheet(isPresented: $showEmojiSets) {
            EmojiSetSettingsView()
        }
    }

    private var emojiSetSection: some View {
        Button(action: {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) { showEmojiSets = true }
        }) {
            HStack(spacing: 12) {
                EmojiLabel("🎭 Emoji Set", size: 14, weight: .semibold, color: .white.opacity(0.85))
                Spacer()
                CustomEmojiView("😀", size: 22, revealOnTap: false)
                Text(EmojiSetManager.shared.activeSet.name)
                    .appFont(13, weight: .semibold)
                    .foregroundColor(.purple.opacity(0.9))
                Image(systemName: "chevron.right")
                    .appFont(12).foregroundColor(.white.opacity(0.5))
            }
            .padding()
            .background(RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.05)))
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                EmojiLabel("🎨 MultiPainter", size: 16, weight: .semibold, color: .purple.opacity(0.8))
            }

            Spacer()

            // Profile Button
            Button(action: {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                    showProfile = true
                }
            }) {
                HStack(spacing: 8) {
                    CustomEmojiView(gameState.currentProfile?.emoji ?? "🎨", size: 24, revealOnTap: false)
                    Text(localization.translate(.profileButton))
                        .appFont(16, weight: .semibold)
                }
                .foregroundColor(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(
                    Capsule()
                        .fill(Color.purple.opacity(0.6))
                        .overlay(
                            Capsule()
                                .stroke(Color.purple, lineWidth: 2)
                        )
                )
            }

            AnimatedCloseButton {
                isPresented = false
            }
        }
    }

    private var languagePicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            EmojiLabel("🌍 Language / Sprache / Langue", size: 14, weight: .semibold, color: .white.opacity(0.7))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(GameLanguage.allCases, id: \.self) { language in
                        LanguageChip(
                            language: language,
                            isSelected: selectedLanguage == language,
                            action: {
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                    selectedLanguage = language
                                    localization.setLanguage(language)
                                }
                            }
                        )
                    }
                }
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.05))
        )
    }

    private var gameRulesSection: some View {
        VStack(spacing: 16) {
            AnimatedRuleCard(
                icon: "🎨",
                title: localization.translate(.rule1Title),
                description: localization.translate(.rule1Description),
                accentColor: .purple,
                delay: 0.1
            )

            AnimatedRuleCard(
                icon: "⏱️",
                title: localization.translate(.rule2Title),
                description: localization.translate(.rule2Description),
                accentColor: .orange,
                delay: 0.2
            )

            AnimatedRuleCard(
                icon: "💰",
                title: localization.translate(.rule3Title),
                description: localization.translate(.rule3Description),
                accentColor: .yellow,
                delay: 0.3
            )

            AnimatedRuleCard(
                icon: "❤️",
                title: localization.translate(.rule4Title),
                description: localization.translate(.rule4Description),
                accentColor: .red,
                delay: 0.4
            )

            AnimatedRuleCard(
                icon: "💬",
                title: localization.translate(.rule5Title),
                description: localization.translate(.rule5Description),
                accentColor: .blue,
                delay: 0.5
            )

            AnimatedRuleCard(
                icon: "🚀",
                title: localization.translate(.rule6Title),
                description: localization.translate(.rule6Description),
                accentColor: .green,
                delay: 0.6
            )
        }
    }

    private var closeButton: some View {
        Button(action: {
            isPresented = false
        }) {
            Text("Close • Schließen • Fermer • Cerrar")
                .appFont(18, weight: .bold)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
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
        .padding(.top, 20)
    }

    private func startEmojiAnimation() {
        // Spawn random floating emojis
        let emojis = ["🎨", "🖌️", "💰", "❤️", "⏱️", "💬", "🚀", "☯️"]

        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            let randomEmoji = emojis.randomElement() ?? "🎨"
            let randomX = CGFloat.random(in: 50...UIScreen.main.bounds.width - 50)
            let newEmoji = AnimatedEmoji(
                id: UUID(),
                emoji: randomEmoji,
                startX: randomX,
                startY: UIScreen.main.bounds.height + 50
            )

            withAnimation {
                animatedEmojis.append(newEmoji)
            }

            // Remove after animation
            DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) {
                withAnimation {
                    animatedEmojis.removeAll(where: { $0.id == newEmoji.id })
                }
            }
        }
    }
}

// MARK: - Language Chip
struct LanguageChip: View {
    let language: GameLanguage
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            EmojiLabel(language.rawValue, size: 14, weight: isSelected ? .bold : .medium, color: isSelected ? .white : .white.opacity(0.7))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(
                    Capsule()
                        .fill(isSelected ? Color.purple : Color.white.opacity(0.1))
                        .overlay(
                            Capsule()
                                .stroke(isSelected ? Color.purple : Color.clear, lineWidth: 2)
                        )
                )
        }
        .scaleEffect(isSelected ? 1.05 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.6), value: isSelected)
    }
}

// MARK: - Animated Rule Card
struct AnimatedRuleCard: View {
    let icon: String
    let title: String
    let description: String
    let accentColor: Color
    let delay: Double

    @State private var isVisible = false
    @State private var iconScale: CGFloat = 0.5
    @State private var iconRotation: Double = -180

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            // Animated Icon
            CustomEmojiView(icon, size: 42, revealOnTap: false)
                .scaleEffect(iconScale)
                .rotationEffect(.degrees(iconRotation))
                .animation(.spring(response: 0.6, dampingFraction: 0.6).delay(delay), value: iconScale)
                .animation(.spring(response: 0.8, dampingFraction: 0.5).delay(delay), value: iconRotation)

            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .appFont(18, weight: .bold)
                    .foregroundColor(accentColor)

                Text(description)
                    .appFont(14, weight: .medium)
                    .foregroundColor(.white.opacity(0.85))
                    .lineSpacing(4)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(
                    LinearGradient(
                        colors: [
                            accentColor.opacity(0.15),
                            accentColor.opacity(0.05)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(accentColor.opacity(0.3), lineWidth: 2)
                )
        )
        .opacity(isVisible ? 1 : 0)
        .offset(y: isVisible ? 0 : 20)
        .onAppear {
            withAnimation(.easeOut(duration: 0.5).delay(delay)) {
                isVisible = true
                iconScale = 1.0
                iconRotation = 0
            }
        }
    }
}

// MARK: - Animated Emoji
struct AnimatedEmoji: Identifiable {
    let id: UUID
    let emoji: String
    let startX: CGFloat
    let startY: CGFloat
}

struct FloatingEmojiView: View {
    let emoji: AnimatedEmoji
    @State private var offsetY: CGFloat = 0
    @State private var offsetX: CGFloat = 0
    @State private var rotation: Double = 0
    @State private var opacity: Double = 1

    var body: some View {
        CustomEmojiView(emoji.emoji, size: 30, revealOnTap: false)
            .opacity(opacity)
            .rotationEffect(.degrees(rotation))
            .position(x: emoji.startX + offsetX, y: emoji.startY + offsetY)
            .onAppear {
                // Float upward animation
                withAnimation(.easeOut(duration: 8.0)) {
                    offsetY = -UIScreen.main.bounds.height - 100
                }

                // Sideways drift
                withAnimation(.easeInOut(duration: 4.0).repeatForever(autoreverses: true)) {
                    offsetX = CGFloat.random(in: -40...40)
                }

                // Rotation
                withAnimation(.linear(duration: 6.0).repeatForever(autoreverses: false)) {
                    rotation = 360
                }

                // Fade out
                withAnimation(.easeIn(duration: 2.0).delay(6.0)) {
                    opacity = 0
                }
            }
    }
}
