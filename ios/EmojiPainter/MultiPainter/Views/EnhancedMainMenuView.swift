//
//  EnhancedMainMenuView.swift
//  MultiPainter
//
//  Created by Claude Code - Cyber-Graffiti Aesthetic
//

import SwiftUI

struct EnhancedMainMenuView: View {
    @State private var selectedFeature: MainFeature? = nil
    @State private var showFeatureMenu = false
    @State private var glowIntensity: Double = 0.0

    enum MainFeature: String, CaseIterable, Identifiable {
        case paint = "Paint"
        case videoEditor = "Video Editor"
        case camera = "Dual Camera"
        case timelapse = "Timelapse"
        case moments = "My Moments"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .paint: return "paintbrush.pointed.fill"
            case .videoEditor: return "film.fill"
            case .camera: return "camera.fill"
            case .timelapse: return "play.rectangle.fill"
            case .moments: return "star.fill"
            }
        }

        var gradient: [Color] {
            switch self {
            case .paint: return [Color(hex: "#FF6B6B"), Color(hex: "#FF8E53")]
            case .videoEditor: return [Color(hex: "#4ECDC4"), Color(hex: "#44A08D")]
            case .camera: return [Color(hex: "#F2994A"), Color(hex: "#F2C94C")]
            case .timelapse: return [Color(hex: "#A8E6CF"), Color(hex: "#56CCF2")]
            case .moments: return [Color(hex: "#BB6BD9"), Color(hex: "#F093FB")]
            }
        }
    }

    var body: some View {
        ZStack {
            // Animated background
            animatedBackground

            // Main content
            VStack(spacing: 0) {
                // Logo header
                logoHeader
                    .padding(.top, 60)

                Spacer()

                // Feature grid
                featureGrid
                    .padding(.horizontal, 24)

                Spacer()

                // Footer
                footerSection
                    .padding(.bottom, 40)
            }
        }
        .onAppear {
            startGlowAnimation()
        }
    }

    // MARK: - Animated Background
    private var animatedBackground: some View {
        ZStack {
            // Base dark gradient
            LinearGradient(
                colors: [
                    Color(hex: "#0A0A0F"),
                    Color(hex: "#1A1A2E"),
                    Color(hex: "#16213E")
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            // Glowing orbs
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(hex: "#FF6B6B").opacity(0.3),
                            Color.clear
                        ],
                        center: .topLeading,
                        startRadius: 0,
                        endRadius: 300
                    )
                )
                .frame(width: 400, height: 400)
                .offset(x: -100, y: -150)
                .blur(radius: 60)
                .opacity(glowIntensity)

            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(hex: "#4ECDC4").opacity(0.3),
                            Color.clear
                        ],
                        center: .bottomTrailing,
                        startRadius: 0,
                        endRadius: 300
                    )
                )
                .frame(width: 400, height: 400)
                .offset(x: 100, y: 150)
                .blur(radius: 60)
                .opacity(1.0 - glowIntensity)

            // Noise texture overlay
            Rectangle()
                .fill(Color.white.opacity(0.02))
                .ignoresSafeArea()
                .blendMode(.overlay)
        }
    }

    // MARK: - Logo Header
    private var logoHeader: some View {
        VStack(spacing: 12) {
            // App icon/logo
            ZStack {
                // Glow effect
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(hex: "#FF6B6B").opacity(0.4),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: 60
                        )
                    )
                    .frame(width: 120, height: 120)
                    .blur(radius: 20)

                // Icon background
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(hex: "#FF6B6B"),
                                Color(hex: "#4ECDC4")
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 90, height: 90)

                // Icon symbol
                Image(systemName: "paintbrush.pointed.fill")
                    .appFont(42)
                    .foregroundColor(.white)
            }

            // App title
            Text("MultiPainter")
                .font(.custom("vrtlfinale1", size: 48))
                .fontWeight(.black)
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            Color(hex: "#FFFFFF"),
                            Color(hex: "#4ECDC4")
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .shadow(color: Color(hex: "#4ECDC4").opacity(0.5), radius: 20, y: 5)

            // Tagline
            Text("Paint Together • Create Forever")
                .font(.custom("vrtlfinale1", size: 16))
                .fontWeight(.medium)
                .foregroundColor(.white.opacity(0.7))
                .tracking(2)
        }
    }

    // MARK: - Feature Grid
    private var featureGrid: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: 16),
                GridItem(.flexible(), spacing: 16)
            ],
            spacing: 16
        ) {
            ForEach(Array(MainFeature.allCases.enumerated()), id: \.element) { index, feature in
                FeatureCard(
                    feature: feature,
                    delay: Double(index) * 0.1
                )
            }
        }
    }

    // MARK: - Footer
    private var footerSection: some View {
        VStack(spacing: 16) {
            // Status indicator
            HStack(spacing: 8) {
                Circle()
                    .fill(Color(hex: "#4ECDC4"))
                    .frame(width: 8, height: 8)
                    .shadow(color: Color(hex: "#4ECDC4"), radius: 8)

                Text("All Systems Online")
                    .font(.custom("vrtlfinale1", size: 14))
                    .fontWeight(.semibold)
                    .foregroundColor(.white.opacity(0.8))
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(
                Capsule()
                    .fill(Color.white.opacity(0.05))
                    .overlay(
                        Capsule()
                            .strokeBorder(
                                LinearGradient(
                                    colors: [
                                        Color(hex: "#4ECDC4").opacity(0.3),
                                        Color.clear
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                ),
                                lineWidth: 1
                            )
                    )
            )
        }
    }

    // MARK: - Animation
    private func startGlowAnimation() {
        withAnimation(
            Animation.easeInOut(duration: 3.0)
                .repeatForever(autoreverses: true)
        ) {
            glowIntensity = 1.0
        }
    }
}

// MARK: - Feature Card
struct FeatureCard: View {
    let feature: EnhancedMainMenuView.MainFeature
    let delay: Double
    @State private var isVisible = false
    @State private var isPressed = false

    var body: some View {
        Button(action: {
            // Navigate to feature
            print("🎨 Opening: \(feature.rawValue)")
        }) {
            VStack(spacing: 16) {
                // Icon
                ZStack {
                    // Glow
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    feature.gradient[0].opacity(0.4),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 0,
                                endRadius: 40
                            )
                        )
                        .frame(width: 80, height: 80)
                        .blur(radius: 15)

                    // Icon background
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: feature.gradient,
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 64, height: 64)

                    // Icon
                    Image(systemName: feature.icon)
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(.white)
                }

                // Title
                Text(feature.rawValue)
                    .font(.custom("vrtlfinale1", size: 18))
                    .fontWeight(.bold)
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 180)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.08),
                                Color.white.opacity(0.03)
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
                                        feature.gradient[0].opacity(0.4),
                                        Color.clear
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 2
                            )
                    )
            )
            .shadow(
                color: feature.gradient[0].opacity(0.3),
                radius: isPressed ? 5 : 15,
                y: isPressed ? 2 : 8
            )
            .scaleEffect(isPressed ? 0.95 : 1.0)
            .scaleEffect(isVisible ? 1.0 : 0.8)
            .opacity(isVisible ? 1.0 : 0.0)
        }
        .buttonStyle(PlainButtonStyle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    withAnimation(OverlayTransitions.quick) {
                        isPressed = true
                    }
                }
                .onEnded { _ in
                    withAnimation(OverlayTransitions.quick) {
                        isPressed = false
                    }
                }
        )
        .onAppear {
            withAnimation(
                OverlayTransitions.bouncy
                    .delay(delay)
            ) {
                isVisible = true
            }
        }
    }
}

// MARK: - Preview
struct EnhancedMainMenuView_Previews: PreviewProvider {
    static var previews: some View {
        EnhancedMainMenuView()
    }
}
