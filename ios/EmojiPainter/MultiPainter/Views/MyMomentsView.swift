//
//  MyMomentsView.swift
//  MultiPainter
//
//  Created by Claude Code - My Moments Feature
//

import SwiftUI
import AVKit

struct MyMomentsView: View {
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var gameState: GameState
    @StateObject private var viewModel = MyMomentsViewModel()
    @State private var selectedMoment: PaintingSession?
    @State private var showingMomentPlayer = false
    @State private var autoJumpCountdown = 3 // Auto-jump after 3 seconds
    @State private var autoJumpTimer: Timer?

    var body: some View {
        ZStack {
            // Background
            LinearGradient(
                colors: [Color.black, Color(white: 0.1)],
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

                    VStack(spacing: 4) {
                        Text("My Moments")
                            .appFont(24, weight: .bold)
                            .foregroundColor(.white)
                        if !viewModel.moments.isEmpty {
                            Text("\(viewModel.moments.count) painting session\(viewModel.moments.count == 1 ? "" : "s")")
                                .appFont(12)
                                .foregroundColor(.white.opacity(0.6))
                        }
                    }

                    Spacer()

                    // Refresh button
                    Button(action: {
                        Task {
                            await viewModel.loadMoments(userId: gameState.userId)
                        }
                    }) {
                        Image(systemName: "arrow.clockwise")
                            .appFont(18, weight: .semibold)
                            .foregroundColor(.white)
                            .padding(12)
                            .background(
                                Circle()
                                    .fill(Color.white.opacity(0.15))
                            )
                            .rotationEffect(.degrees(viewModel.isLoading ? 360 : 0))
                            .animation(viewModel.isLoading ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: viewModel.isLoading)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 16)

                // Content
                if viewModel.isLoading && viewModel.moments.isEmpty {
                    // Loading state
                    Spacer()
                    VStack(spacing: 16) {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(1.5)
                        Text("Loading your painting moments...")
                            .appFont(16)
                            .foregroundColor(.white.opacity(0.7))
                    }
                    Spacer()
                } else if viewModel.moments.isEmpty && !viewModel.isLoading {
                    // Empty state with auto-jump
                    Spacer()
                    VStack(spacing: 20) {
                        Text("🎨")
                            .appFont(60)
                        Text("No painting moments yet")
                            .appFont(20, weight: .semibold)
                            .foregroundColor(.white)
                        Text("Start painting to automatically\ncapture your creative moments!")
                            .appFont(14)
                            .foregroundColor(.white.opacity(0.6))
                            .multilineTextAlignment(.center)
                            .lineSpacing(4)

                        // Auto-jump countdown
                        VStack(spacing: 12) {
                            HStack(spacing: 8) {
                                Image(systemName: "paintbrush.pointed.fill")
                                    .appFont(18)
                                    .foregroundColor(Color(hex: "#4ECDC4"))
                                Text("Jumping to paint mode in \(autoJumpCountdown)...")
                                    .appFont(16, weight: .semibold)
                                    .foregroundColor(.white)
                            }
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(
                                Capsule()
                                    .fill(
                                        LinearGradient(
                                            colors: [
                                                Color(hex: "#4ECDC4").opacity(0.3),
                                                Color(hex: "#44A08D").opacity(0.3)
                                            ],
                                            startPoint: .leading,
                                            endPoint: .trailing
                                        )
                                    )
                                    .overlay(
                                        Capsule()
                                            .strokeBorder(
                                                Color(hex: "#4ECDC4").opacity(0.5),
                                                lineWidth: 2
                                            )
                                    )
                            )

                            Button(action: {
                                autoJumpTimer?.invalidate()
                                jumpToPaintMode()
                            }) {
                                Text("PAINT NOW")
                                    .appFont(16, weight: .bold)
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 32)
                                    .padding(.vertical, 14)
                                    .background(
                                        Capsule()
                                            .fill(
                                                LinearGradient(
                                                    colors: [
                                                        Color(hex: "#FF6B6B"),
                                                        Color(hex: "#FF8E53")
                                                    ],
                                                    startPoint: .leading,
                                                    endPoint: .trailing
                                                )
                                            )
                                    )
                                    .shadow(color: Color(hex: "#FF6B6B").opacity(0.5), radius: 10)
                            }
                        }
                        .padding(.top, 20)
                    }
                    .padding(40)
                    Spacer()
                } else {
                    // Moments grid
                    ScrollView(.vertical, showsIndicators: true) {
                        LazyVGrid(columns: [
                            GridItem(.flexible(), spacing: 16),
                            GridItem(.flexible(), spacing: 16)
                        ], spacing: 16) {
                            ForEach(viewModel.moments) { moment in
                                MomentCard(moment: moment)
                                    .onTapGesture {
                                        selectedMoment = moment
                                        showingMomentPlayer = true
                                    }
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 20)
                    }
                }

                // Error message
                if let error = viewModel.errorMessage {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.yellow)
                        Text(error)
                            .appFont(14)
                            .foregroundColor(.white)
                    }
                    .padding()
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.red.opacity(0.8))
                    )
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                }
            }
        }
        .onAppear {
            gameState.stopTimelapseUpdates()
            Task {
                await viewModel.loadMoments(userId: gameState.userId)

                // Start auto-jump timer if empty
                if viewModel.moments.isEmpty && !viewModel.isLoading {
                    startAutoJumpTimer()
                }
            }
        }
        .onDisappear {
            autoJumpTimer?.invalidate()
            gameState.startTimelapseUpdates()
        }
        .onChange(of: viewModel.moments.isEmpty) { isEmpty in
            if isEmpty && !viewModel.isLoading {
                startAutoJumpTimer()
            } else {
                autoJumpTimer?.invalidate()
                autoJumpCountdown = 3
            }
        }
        .sheet(isPresented: $showingMomentPlayer) {
            if let moment = selectedMoment {
                MomentPlayerView(moment: moment)
                    .environmentObject(gameState)
            }
        }
    }

    // MARK: - Auto-Jump Logic
    private func startAutoJumpTimer() {
        // Cancel any existing timer
        autoJumpTimer?.invalidate()

        // Reset countdown
        autoJumpCountdown = 3

        // Start countdown timer
        autoJumpTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak gameState] timer in
            Task { @MainActor in
                if autoJumpCountdown > 1 {
                    autoJumpCountdown -= 1
                } else {
                    timer.invalidate()
                    jumpToPaintMode()
                }
            }
        }

        print("🎨 Auto-jump timer started - will jump to paint mode in 3 seconds")
    }

    private func jumpToPaintMode() {
        print("🚀 Auto-jumping to paint mode!")

        // Dismiss this view
        dismiss()

        // Small delay to let dismiss animation complete
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            // Join the game
            gameState.joinGame()
        }
    }
}

struct MomentCard: View {
    let moment: PaintingSession
    @State private var previewImage: UIImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Preview thumbnail
            ZStack {
                if let image = previewImage {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(height: 150)
                        .clipped()
                } else {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [Color.purple.opacity(0.3), Color.blue.opacity(0.3)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(height: 150)
                        .overlay(
                            VStack(spacing: 8) {
                                ProgressView()
                                    .tint(.white)
                                Text("Loading...")
                                    .appFont(12)
                                    .foregroundColor(.white.opacity(0.7))
                            }
                        )
                }

                // Play button overlay
                Circle()
                    .fill(Color.black.opacity(0.6))
                    .frame(width: 50, height: 50)
                    .overlay(
                        Image(systemName: "play.fill")
                            .appFont(20)
                            .foregroundColor(.white)
                    )
            }
            .frame(height: 150)
            .cornerRadius(12)

            // Info
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    CustomEmojiView(moment.emoji, size: 16)
                    Text(moment.username)
                        .appFont(14, weight: .semibold)
                        .foregroundColor(.white)
                }

                Text(formatDate(moment.startedAt))
                    .appFont(12)
                    .foregroundColor(.white.opacity(0.6))

                if let duration = moment.durationSeconds {
                    HStack(spacing: 4) {
                        Image(systemName: "clock.fill")
                            .appFont(10)
                            .foregroundColor(.purple)
                        Text(formatDuration(duration))
                            .appFont(11, weight: .medium)
                            .foregroundColor(.purple)

                        if let videoCount = moment.videoSegments?.count {
                            Spacer()
                            Image(systemName: "film.fill")
                                .appFont(10)
                                .foregroundColor(.green)
                            Text("\(videoCount) clips")
                                .appFont(11, weight: .medium)
                                .foregroundColor(.green)
                        }
                    }
                }
            }
            .padding(12)
        }
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.15), lineWidth: 1)
        )
        .onAppear {
            loadPreviewImage()
        }
    }

    private func loadPreviewImage() {
        guard let urlString = moment.previewSnapshotUrl else { return }

        Task {
            do {
                let data = try await APIClient.shared.fetchTimelapseImage(url: urlString)
                if let image = UIImage(data: data) {
                    await MainActor.run {
                        previewImage = image
                    }
                }
            } catch {
                print("⚠️ Failed to load preview image: \(error)")
            }
        }
    }

    private func formatDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: dateString) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateFormat = "MMM d, h:mm a"
            return displayFormatter.string(from: date)
        }
        return dateString
    }

    private func formatDuration(_ seconds: Int) -> String {
        let minutes = seconds / 60
        let secs = seconds % 60
        return String(format: "%d:%02d", minutes, secs)
    }
}

struct MomentPlayerView: View {
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var gameState: GameState
    let moment: PaintingSession

    @StateObject private var viewModel = MomentPlayerViewModel()
    @State private var playbackRate: Double = 1.0
    @State private var isPlaying = true

    var body: some View {
        ZStack {
            if let player = viewModel.player {
                VideoPlayer(player: player) {
                    VStack {
                        HStack {
                            Spacer()
                            Button(action: {
                                viewModel.stop()
                                dismiss()
                            }) {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 36))
                                    .foregroundColor(.white.opacity(0.8))
                                    .shadow(color: .black.opacity(0.5), radius: 4)
                                    .padding(20)
                            }
                        }

                        Spacer()

                        // Moment info overlay
                        VStack(spacing: 8) {
                            HStack(spacing: 8) {
                                CustomEmojiView(moment.emoji, size: 20)
                                Text(moment.username)
                                    .appFont(16, weight: .semibold)
                                    .foregroundColor(.white)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .fill(Color.black.opacity(0.6))
                            )

                            // Playback controls
                            VStack(spacing: 14) {
                                HStack(spacing: 16) {
                                    Button(action: {
                                        viewModel.pause()
                                        isPlaying = false
                                    }) {
                                        Image(systemName: "pause.fill")
                                            .font(.system(size: 22, weight: .bold))
                                            .foregroundColor(.white)
                                            .frame(width: 50, height: 50)
                                            .background(
                                                Circle()
                                                    .fill(isPlaying ? Color.white.opacity(0.15) : Color.white.opacity(0.35))
                                            )
                                    }
                                    .disabled(!isPlaying)

                                    Button(action: {
                                        viewModel.play()
                                        isPlaying = true
                                    }) {
                                        Image(systemName: "play.fill")
                                            .font(.system(size: 22, weight: .bold))
                                            .foregroundColor(.white)
                                            .frame(width: 50, height: 50)
                                            .background(
                                                Circle()
                                                    .fill(isPlaying ? Color.white.opacity(0.35) : Color.white.opacity(0.15))
                                            )
                                    }
                                    .disabled(isPlaying)
                                }

                                VStack(spacing: 6) {
                                    Text(String(format: "Speed %.1fx", playbackRate))
                                        .appFont(13, weight: .semibold)
                                        .foregroundColor(.white.opacity(0.85))

                                    Slider(value: $playbackRate, in: 1.0...10.0, step: 0.25)
                                        .tint(.white)
                                        .frame(width: 200)
                                }
                            }
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(
                                Capsule()
                                    .fill(Color.black.opacity(0.4))
                                    .overlay(
                                        Capsule()
                                            .stroke(Color.white.opacity(0.25), lineWidth: 1)
                                    )
                            )
                        }
                        .padding(.bottom, 35)
                    }
                }
                .ignoresSafeArea()
            }

            if viewModel.isLoading {
                ZStack {
                    Color.black.ignoresSafeArea()

                    VStack(spacing: 24) {
                        ProgressView()
                            .scaleEffect(2.0)
                            .tint(.white)

                        Text("Loading your moment...")
                            .appFont(20, weight: .bold)
                            .foregroundColor(.white)
                    }
                }
            }
        }
        .onAppear {
            Task {
                await viewModel.loadMoment(moment)
            }
        }
        .onDisappear {
            viewModel.stop()
        }
        .statusBar(hidden: true)
        .onChange(of: playbackRate) { newRate in
            viewModel.setPlaybackRate(Float(newRate))
        }
    }
}

@MainActor
class MyMomentsViewModel: ObservableObject {
    @Published var moments: [PaintingSession] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func loadMoments(userId: Int?) async {
        guard let userId = userId else {
            errorMessage = "User ID not available"
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let response = try await APIClient.shared.fetchMyMoments(userId: String(userId))
            moments = response.moments
            print("✅ Loaded \(moments.count) painting moments")
        } catch {
            errorMessage = "Failed to load moments: \(error.localizedDescription)"
            print("❌ Error loading moments: \(error)")
        }

        isLoading = false
    }
}

@MainActor
class MomentPlayerViewModel: ObservableObject {
    @Published var isLoading = false
    var player: AVQueuePlayer?

    func loadMoment(_ moment: PaintingSession) async {
        isLoading = true

        guard let videoSegments = moment.videoSegments, !videoSegments.isEmpty else {
            print("⚠️ No video segments in moment")
            isLoading = false
            return
        }

        print("📹 Loading \(videoSegments.count) video segments for moment")

        var items: [AVPlayerItem] = []

        for segment in videoSegments {
            let videoURLString = "https://some-sender.gotdns.ch:4850\(segment.url)"
            guard let url = URL(string: videoURLString) else { continue }

            let asset = AVURLAsset(url: url, options: [
                AVURLAssetPreferPreciseDurationAndTimingKey: true
            ])

            _ = try? await asset.load(.isPlayable)
            let item = AVPlayerItem(asset: asset)
            item.audioTimePitchAlgorithm = .timeDomain
            items.append(item)
        }

        player = AVQueuePlayer(items: items)
        player?.actionAtItemEnd = .advance

        isLoading = false
        player?.play()
        print("▶️ Playing moment with \(items.count) videos")
    }

    func play() {
        player?.play()
    }

    func pause() {
        player?.pause()
    }

    func setPlaybackRate(_ rate: Float) {
        player?.rate = rate
    }

    func stop() {
        player?.pause()
        player = nil
    }
}
