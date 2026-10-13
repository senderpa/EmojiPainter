//
//  FullscreenTimelapsePlayer.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI
import AVKit
import AVFoundation

struct FullscreenTimelapsePlayer: View {
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var gameState: GameState
    @StateObject private var viewModel = FullscreenTimelapseViewModel()
    @State private var isPlaying = true
    @State private var playbackRate: Double = 1.0
    @State private var currentPosition: Double = 0
    @State private var totalDuration: Double = 0
    @State private var showTimeline = false
    @State private var selectedTimeOffset: Double = 0

    var body: some View {
        ZStack {
            // Fullscreen Video Player
            if let player = viewModel.player {
                VideoPlayer(player: player) {
                    // Custom overlay with close + playback controls
                    VStack {
                        HStack {
                            Spacer()
                            Button(action: {
                                print("❌ Closing timelapse viewer")
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
                        VStack(spacing: 14) {
                            // Queue status info
                            if let player = viewModel.player {
                                let queueCount = player.items().count
                                EmojiLabel("♾️ Looping • \(queueCount) videos in queue", size: 14, weight: .semibold, color: .white.opacity(0.9))
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 6)
                                    .background(
                                        Capsule()
                                            .fill(Color.black.opacity(0.6))
                                    )
                            }

                            // Play/Pause Toggle + Restart
                            HStack(spacing: 16) {
                                // Combined Play/Pause Toggle
                                Button(action: {
                                    togglePlayback()
                                }) {
                                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                                        .font(.system(size: 22, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 50, height: 50)
                                        .background(
                                            Circle()
                                                .fill(Color.purple.opacity(0.6))
                                        )
                                }

                                // Restart button
                                Button(action: {
                                    Task {
                                        await viewModel.forceRestart()
                                    }
                                }) {
                                    Image(systemName: "arrow.clockwise")
                                        .font(.system(size: 22, weight: .bold))
                                        .foregroundColor(.orange)
                                        .frame(width: 50, height: 50)
                                        .background(
                                            Circle()
                                                .fill(Color.white.opacity(0.15))
                                        )
                                }

                                // Timeline Toggle
                                Button(action: {
                                    withAnimation {
                                        showTimeline.toggle()
                                    }
                                }) {
                                    Image(systemName: "waveform")
                                        .font(.system(size: 22, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 50, height: 50)
                                        .background(
                                            Circle()
                                                .fill(showTimeline ? Color.blue.opacity(0.6) : Color.white.opacity(0.15))
                                        )
                                }
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
                        .padding(.bottom, 35)
                    }
                }
                .ignoresSafeArea()
            }

            // Loading Overlay
            if viewModel.isLoading {
                ZStack {
                    Color.black.ignoresSafeArea()

                    VStack(spacing: 24) {
                        // Show collected frames animation OR animated loader
                        if let currentFrame = viewModel.currentFramePreview {
                            ZStack {
                                Image(uiImage: currentFrame)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(width: 300, height: 300)
                                    .cornerRadius(20)
                                    .clipped()

                                // Cool border animation
                                RoundedRectangle(cornerRadius: 20)
                                    .stroke(
                                        LinearGradient(
                                            gradient: Gradient(colors: [.purple, .blue, .cyan]),
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        ),
                                        lineWidth: 3
                                    )
                                    .frame(width: 300, height: 300)
                            }
                            .shadow(color: Color.purple.opacity(0.5), radius: 20)
                        } else {
                            // Animated loader frames above everything
                            AnimatedLoaderView(width: 300, height: 300)
                                .shadow(color: Color.purple.opacity(0.5), radius: 20)
                        }

                        VStack(spacing: 8) {
                            Text("Loading Timelapse...")
                                .appFont(20, weight: .bold)
                                .foregroundColor(.white)

                            if !viewModel.frameAnimationStatus.isEmpty {
                                Text(viewModel.frameAnimationStatus)
                                    .appFont(14)
                                    .foregroundColor(.cyan)
                            } else {
                                Text("Preparing \(viewModel.loadedVideos)/\(viewModel.totalVideos) videos")
                                    .appFont(16)
                                    .foregroundColor(.white.opacity(0.7))
                            }
                        }

                        // Progress bar
                        GeometryReader { geometry in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.white.opacity(0.2))
                                    .frame(height: 8)

                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.purple)
                                    .frame(
                                        width: geometry.size.width * viewModel.loadProgress,
                                        height: 8
                                    )
                                    .animation(.easeInOut, value: viewModel.loadProgress)
                            }
                        }
                        .frame(height: 8)
                        .padding(.horizontal, 60)
                    }
                }
                .transition(.opacity)
            }

            // Timeline Scrubber - appears from bottom when toggled
            if showTimeline {
                VStack(spacing: 0) {
                    Spacer()

                    VStack(spacing: 14) {
                        HStack(spacing: 12) {
                            Text("Timeline")
                                .appFont(16, weight: .bold)
                                .foregroundColor(.white)

                            Spacer()

                            // Loading indicator
                            if viewModel.isLoadingTimeline {
                                HStack(spacing: 6) {
                                    ProgressView()
                                        .scaleEffect(0.7)
                                        .tint(.white)

                                    Text("Loading available times...")
                                        .appFont(11)
                                        .foregroundColor(.white.opacity(0.7))
                                }
                            } else {
                                Text("\(viewModel.availableTimes.count) videos")
                                    .appFont(11, weight: .semibold)
                                    .foregroundColor(.white.opacity(0.7))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color.white.opacity(0.1))
                                    .cornerRadius(6)
                            }
                        }

                        HStack(spacing: 12) {
                            Text("00:00")
                                .appFont(11)
                                .foregroundColor(.white.opacity(0.6))
                                .frame(width: 35)

                            Slider(value: $selectedTimeOffset, in: 0...1440, step: 1)
                                .tint(.blue.opacity(0.8))
                                .onChange(of: selectedTimeOffset) { _ in
                                    Task {
                                        await viewModel.seekToTime(offsetMinutes: Int(selectedTimeOffset))
                                    }
                                }

                            Text("24:00")
                                .appFont(11)
                                .foregroundColor(.white.opacity(0.6))
                                .frame(width: 35, alignment: .trailing)
                        }

                        // Selected time display
                        HStack(spacing: 8) {
                            Image(systemName: "clock.fill")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.blue.opacity(0.8))

                            Text(formatTime(Int(selectedTimeOffset)))
                                .appFont(13, weight: .semibold)
                                .foregroundColor(.white)

                            Spacer()

                            if !viewModel.availableTimes.isEmpty {
                                let nearestTime = viewModel.findNearestAvailableTime(Int(selectedTimeOffset))
                                let isAvailable = viewModel.availableTimes.contains(nearestTime)

                                HStack(spacing: 4) {
                                    Image(systemName: isAvailable ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundColor(isAvailable ? .green : .orange)

                                    Text(isAvailable ? "Available" : "Loading")
                                        .appFont(11, weight: .semibold)
                                        .foregroundColor(isAvailable ? .green : .orange)
                                }
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(8)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(Color.black.opacity(0.8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(Color.blue.opacity(0.3), lineWidth: 1)
                            )
                    )
                    .padding(16)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            // Error overlay with retry
            if let error = viewModel.errorMessage {
                ZStack {
                    Color.black.opacity(0.9).ignoresSafeArea()

                    VStack(spacing: 20) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.yellow)

                        Text("Error")
                            .appFont(24, weight: .bold)
                            .foregroundColor(.white)

                        Text(error)
                            .appFont(16)
                            .foregroundColor(.white.opacity(0.8))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)

                        HStack(spacing: 16) {
                            Button(action: {
                                Task {
                                    await viewModel.forceRestart()
                                }
                            }) {
                                Text("Retry")
                                    .appFont(18, weight: .semibold)
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 32)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 12)
                                            .fill(Color.orange)
                                    )
                            }

                            Button(action: {
                                dismiss()
                            }) {
                                Text("Close")
                                    .appFont(18, weight: .semibold)
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 32)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 12)
                                            .fill(Color.purple)
                                    )
                            }
                        }
                        .padding(.top, 20)
                    }
                }
            }
        }
        .onAppear {
            gameState.stopTimelapseUpdates()
            print("⏸️ Paused lobby timelapse updates")
            isPlaying = true
            viewModel.updatePlaybackRate(to: Float(playbackRate), isPlaying: isPlaying)

            // Start animation of collected frames while videos load
            if !gameState.collectedTimelapseFrames.isEmpty {
                viewModel.startFrameAnimation(frames: gameState.collectedTimelapseFrames)
                print("🎬 Starting frame animation with \(gameState.collectedTimelapseFrames.count) collected frames")
            }

            Task {
                await viewModel.loadAndPlay()
            }
        }
        .onDisappear {
            viewModel.stop()
            gameState.startTimelapseUpdates()
            print("▶️ Resumed lobby timelapse updates")
        }
        .statusBar(hidden: true)
        .onChange(of: playbackRate) { newRate in
            viewModel.updatePlaybackRate(to: Float(newRate), isPlaying: isPlaying)
        }
    }

    private func togglePlayback() {
        if isPlaying {
            viewModel.pause()
            isPlaying = false
            print("⏸️ Playback paused")
        } else {
            viewModel.play()
            isPlaying = true
            print("▶️ Playback resumed")
        }
    }

    private func formatTime(_ minutes: Int) -> String {
        let hours = minutes / 60
        let mins = minutes % 60
        return String(format: "%02d:%02d", hours, mins)
    }
}

@MainActor
class FullscreenTimelapseViewModel: ObservableObject {
    @Published var isLoading: Bool = true
    @Published var errorMessage: String?
    @Published var loadedVideos: Int = 0
    @Published var totalVideos: Int = 0
    @Published var isLoadingTimeline: Bool = false
    @Published var availableTimes: Set<Int> = []  // Available minute offsets (0-1440)
    @Published var currentFramePreview: UIImage?  // Show collected frames while loading
    @Published var frameAnimationStatus: String = ""  // Show animation status

    var player: AVQueuePlayer?
    private var playerItems: [AVPlayerItem] = []
    private var videoURLs: [URL] = []
    private var allLoadedSegments: [TimelapseVideoSegment] = []  // Track all loaded segments
    private var loadedSegmentFilenames: Set<String> = []  // Quick lookup for duplicates
    private var currentOffset: Int = 0
    private var hasMoreVideos: Bool = true
    private var isLoadingMore: Bool = false
    private var totalAvailableVideos: Int = 0
    private let initialPageSize = 30  // Load 30 minutes worth of videos initially
    private let pageSize = 10  // Load 10 more videos at a time after initial load
    private var playbackObserver: NSObjectProtocol?
    private var playbackRateValue: Float = 1.0
    private var hasReachedEnd: Bool = false  // Track if we've played all available videos
    private var periodicQueueCheckTimer: Timer?  // Periodic check for empty queue
    private var playerStatusObserver: NSKeyValueObservation?  // Monitor player status
    private var lastPlaybackCheck: Date = Date()  // Track when we last verified playback
    private var playbackStallCount: Int = 0  // Count how many times we detected stalled playback

    // Frame animation for collected timelapse frames
    private var collectedFrames: [UIImage] = []  // Frames from GameState
    private var frameAnimationTimer: Timer?  // Timer for cycling through frames
    private var currentFrameIndex: Int = 0  // Current frame being displayed

    var loadProgress: Double {
        guard totalAvailableVideos > 0 else { return 0 }
        return Double(loadedVideos) / Double(totalAvailableVideos)
    }

    func loadAndPlay(retryCount: Int = 0) async {
        isLoading = true
        isLoadingTimeline = true
        errorMessage = nil
        teardownQueueMonitoring()
        player?.pause()
        player = nil
        playerItems.removeAll()
        videoURLs.removeAll()
        allLoadedSegments.removeAll()
        loadedSegmentFilenames.removeAll()
        availableTimes.removeAll()
        currentOffset = 0
        loadedVideos = 0
        hasReachedEnd = false

        do {
            // Fetch first batch of video segments using paginated API
            // Load 30 videos initially to ensure we have at least 30 minutes of history
            // NOTE: Requesting "newest" to show most recent videos first
            print("📡 Fetching timelapse videos (attempt \(retryCount + 1)/3)...")
            let result = try await APIClient.shared.fetchTimelapseVideosPage(offset: 0, limit: initialPageSize, order: "newest")
            let segments = result.segments
            totalVideos = result.total
            totalAvailableVideos = result.total
            hasMoreVideos = result.hasMore
            currentOffset = segments.count

            // Build available times list (1 minute per video)
            for (index, _) in segments.enumerated() {
                availableTimes.insert(index)
            }

            print("✅ Loaded \(segments.count) video segments (NEWEST FIRST)")
            print("📊 Total available videos: \(totalAvailableVideos), hasMore: \(hasMoreVideos)")
            print("⏱️  Showing last ~\(segments.count) minutes of timelapse history")

            if segments.isEmpty {
                errorMessage = "No timelapse videos available yet. Videos are created every minute from snapshots."
                isLoading = false
                return
            }

            // Warn if we don't have 30 minutes of history yet (but still play what we have)
            if segments.count < initialPageSize {
                print("⚠️ Only \(segments.count) videos available (less than 30 minutes of history)")
            }

            // Use all returned videos (already newest to oldest from paginated API)
            let videosToLoad = segments
            print("📦 Loading initial \(videosToLoad.count) videos...")
            print("🎬 Order: NEWEST first → then older videos")

            // Track all segments we're loading
            allLoadedSegments = videosToLoad
            loadedSegmentFilenames = Set(videosToLoad.map { $0.filename })

            // Log which videos we're loading
            for (index, segment) in videosToLoad.enumerated() {
                print("  \(index + 1). \(segment.filename)")
            }

            // Create URLs and player items
            var items: [AVPlayerItem] = []

            for (index, segment) in videosToLoad.enumerated() {
                let videoURLString = "https://some-sender.gotdns.ch:4850\(segment.url)"

                guard let url = URL(string: videoURLString) else {
                    print("⚠️ Invalid URL for segment: \(segment.filename)")
                    continue
                }

                videoURLs.append(url)

                let asset = AVURLAsset(url: url, options: [
                    AVURLAssetPreferPreciseDurationAndTimingKey: true
                ])

                // Preload the asset
                _ = try? await asset.load(.isPlayable)
                _ = try? await asset.load(.duration)

                let item = AVPlayerItem(asset: asset)

                // Configure for seamless playback
                item.audioTimePitchAlgorithm = .timeDomain

                items.append(item)
                loadedVideos = index + 1

                print("✅ Loaded \(index + 1)/\(videosToLoad.count): \(segment.filename)")
            }

            playerItems = items

            // Create queue player - will play newest first, then next newest, etc.
            player = AVQueuePlayer(items: items)
            player?.actionAtItemEnd = .advance  // Auto-advance to next video

            // Configure for best performance
            if let currentItem = player?.currentItem {
                currentItem.preferredForwardBufferDuration = 0.5
            }

            print("✅ Ready to play \(items.count) videos (newest → oldest)")
            print("▶️ Starting playback...")

            // Hide loading and start playback
            isLoading = false
            isLoadingTimeline = false

            // Start NORMAL playback (newest video first)
            // AVQueuePlayer will automatically advance to next video when each finishes
            player?.play()
            player?.rate = playbackRateValue
            setupQueueMonitoring()
        } catch {
            print("❌ Error loading timelapse (attempt \(retryCount + 1)/3): \(error)")

            // Retry up to 3 times with exponential backoff
            if retryCount < 2 {
                let delay = Double(retryCount + 1) * 1.0  // 1s, 2s delays
                print("🔄 Retrying in \(delay) seconds...")
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                await loadAndPlay(retryCount: retryCount + 1)
            } else {
                errorMessage = "Failed to load timelapse after 3 attempts: \(error.localizedDescription)"
                isLoading = false
                print("❌ All retry attempts failed")
            }
        }
    }

    private func setupQueueMonitoring() {
        teardownQueueMonitoring()

        // Observe when videos end
        playbackObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.checkAndLoadMoreIfNeeded()
            }
        }

        // Add periodic check every 2 seconds to catch empty queue AND stalled playback
        periodicQueueCheckTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.checkAndLoadMoreIfNeeded()
                await self?.checkForStalledPlayback()
            }
        }

        // Monitor player item status for errors
        if let currentItem = player?.currentItem {
            playerStatusObserver = currentItem.observe(\.status, options: [.new]) { [weak self] item, _ in
                Task { @MainActor [weak self] in
                    if item.status == .failed {
                        print("❌ Player item failed: \(item.error?.localizedDescription ?? "Unknown error")")
                        await self?.handlePlaybackError()
                    }
                }
            }
        }

        print("✅ Queue monitoring started (notifications + 2s periodic check + status observer)")
    }

    private func teardownQueueMonitoring() {
        if let observer = playbackObserver {
            NotificationCenter.default.removeObserver(observer)
            playbackObserver = nil
        }

        periodicQueueCheckTimer?.invalidate()
        periodicQueueCheckTimer = nil

        playerStatusObserver?.invalidate()
        playerStatusObserver = nil
    }

    private func checkAndLoadMoreIfNeeded() async {
        guard let player = player else {
            print("⚠️ No player in checkAndLoadMoreIfNeeded")
            return
        }

        let remainingItems = player.items().count
        let playerRate = player.rate
        let currentTime = player.currentTime()

        // If queue is empty, immediately restart
        if remainingItems == 0 {
            print("🔄 🔄 🔄 Queue empty! Restarting timelapse loop...")
            print("   Player rate: \(playerRate), time: \(currentTime.seconds)")
            await restartWithNewVideos()
            return
        }

        // Only log occasionally to avoid spam
        if remainingItems <= 10 || remainingItems % 10 == 0 {
            print("📊 Queue: \(remainingItems) videos, playing: \(playerRate > 0 ? "YES" : "NO"), rate: \(playerRate)")
        }

        // When we have 5 or fewer videos left, load more (increased threshold for smoother experience)
        if remainingItems <= 5 {
            if hasMoreVideos {
                print("🔄 Queue low (\(remainingItems) remaining), loading more segments (offset: \(currentOffset))")
                await loadMoreVideos()
            } else if !hasReachedEnd {
                // We've reached the end of all available videos
                print("🔚 Reached end of all available videos - will restart when queue empties")
                hasReachedEnd = true
            }
        }
    }

    private func loadMoreVideos() async {
        guard !isLoadingMore && hasMoreVideos else { return }

        isLoadingMore = true

        do {
            let result = try await APIClient.shared.fetchTimelapseVideosPage(offset: currentOffset, limit: pageSize, order: "newest")
            let segments = result.segments
            hasMoreVideos = result.hasMore

            print("✅ Loaded \(segments.count) more videos (offset: \(currentOffset), hasMore: \(hasMoreVideos))")

            // Track new segments
            for (index, segment) in segments.enumerated() {
                if !loadedSegmentFilenames.contains(segment.filename) {
                    allLoadedSegments.append(segment)
                    loadedSegmentFilenames.insert(segment.filename)
                    // Add to available times (offset + index)
                    availableTimes.insert(currentOffset + index)
                }
            }

            // Create and append new items to queue
            for (index, segment) in segments.enumerated() {
                let videoURLString = "https://some-sender.gotdns.ch:4850\(segment.url)"

                guard let url = URL(string: videoURLString) else {
                    print("⚠️ Invalid URL for segment: \(segment.filename)")
                    continue
                }

                videoURLs.append(url)

                let asset = AVURLAsset(url: url, options: [
                    AVURLAssetPreferPreciseDurationAndTimingKey: true
                ])

                // Preload the asset
                _ = try? await asset.load(.isPlayable)
                _ = try? await asset.load(.duration)

                let item = AVPlayerItem(asset: asset)
                item.audioTimePitchAlgorithm = .timeDomain

                playerItems.append(item)

                // Insert into player queue
                player?.insert(item, after: nil)

                loadedVideos += 1
                print("✅ Added video \(currentOffset + index + 1): \(segment.filename)")
            }

            currentOffset += segments.count
            print("📊 Total loaded: \(loadedVideos)/\(totalAvailableVideos)")

        } catch {
            print("❌ Error loading more videos: \(error)")
        }

        isLoadingMore = false
    }

    private func restartWithNewVideos() async {
        print("🔄 Checking server for new videos...")

        do {
            // Query server for latest videos (offset=0, get newest)
            let result = try await APIClient.shared.fetchTimelapseVideosPage(offset: 0, limit: initialPageSize, order: "newest")
            let latestSegments = result.segments

            if latestSegments.isEmpty {
                print("⚠️ No videos available from server, cannot restart")
                return
            }

            // Find new videos we haven't loaded yet
            var newSegments: [TimelapseVideoSegment] = []
            for segment in latestSegments {
                if !loadedSegmentFilenames.contains(segment.filename) {
                    newSegments.append(segment)
                }
            }

            if !newSegments.isEmpty {
                print("🆕 Found \(newSegments.count) new video(s) since last loop!")
                for (index, segment) in newSegments.enumerated() {
                    print("  NEW \(index + 1). \(segment.filename)")
                }

                // Add new segments to the front of our list (they're newest)
                allLoadedSegments.insert(contentsOf: newSegments, at: 0)
                for segment in newSegments {
                    loadedSegmentFilenames.insert(segment.filename)
                }
            } else {
                print("ℹ️ No new videos found, restarting with existing \(allLoadedSegments.count) videos")
            }

            // Rebuild queue with all segments (newest first)
            print("🔄 Rebuilding queue with \(allLoadedSegments.count) total videos...")
            player?.pause()
            player?.removeAllItems()
            playerItems.removeAll()
            videoURLs.removeAll()

            var items: [AVPlayerItem] = []

            for (index, segment) in allLoadedSegments.enumerated() {
                let videoURLString = "https://some-sender.gotdns.ch:4850\(segment.url)"

                guard let url = URL(string: videoURLString) else {
                    print("⚠️ Invalid URL for segment: \(segment.filename)")
                    continue
                }

                videoURLs.append(url)

                let asset = AVURLAsset(url: url, options: [
                    AVURLAssetPreferPreciseDurationAndTimingKey: true
                ])

                // Preload the asset
                _ = try? await asset.load(.isPlayable)

                let item = AVPlayerItem(asset: asset)
                item.audioTimePitchAlgorithm = .timeDomain
                items.append(item)

                if (index + 1) % 10 == 0 {
                    print("📦 Loaded \(index + 1)/\(allLoadedSegments.count) videos...")
                }
            }

            playerItems = items

            // Recreate queue player with all videos
            player = AVQueuePlayer(items: items)
            player?.actionAtItemEnd = .advance

            // Reset state
            hasReachedEnd = false
            currentOffset = allLoadedSegments.count
            hasMoreVideos = result.hasMore
            totalAvailableVideos = result.total

            print("✅ Queue rebuilt with \(items.count) videos (newest → oldest)")
            print("🔁 LOOPING - Restarting playback from newest video...")
            print("♾️  Timelapse will loop infinitely")

            // Start playback
            player?.play()
            player?.rate = playbackRateValue
            setupQueueMonitoring()

        } catch {
            print("❌ Error checking for new videos: \(error)")
            // If error, just restart with existing videos
            print("🔄 Restarting with existing videos due to error")
            await restartWithExistingVideos()
        }
    }

    private func restartWithExistingVideos() async {
        print("🔄 Restarting queue with existing \(allLoadedSegments.count) videos...")

        player?.pause()
        player?.removeAllItems()

        // Recreate player items from existing segments
        var items: [AVPlayerItem] = []

        for segment in allLoadedSegments {
            let videoURLString = "https://some-sender.gotdns.ch:4850\(segment.url)"
            guard let url = URL(string: videoURLString) else { continue }

            let asset = AVURLAsset(url: url)
            let item = AVPlayerItem(asset: asset)
            item.audioTimePitchAlgorithm = .timeDomain
            items.append(item)
        }

        player = AVQueuePlayer(items: items)
        player?.actionAtItemEnd = .advance

        hasReachedEnd = false

        print("✅ Queue restarted with \(items.count) videos")
        print("🔁 LOOPING - Playing from beginning...")
        print("♾️  Timelapse will loop infinitely")

        player?.play()
        player?.rate = playbackRateValue
        setupQueueMonitoring()
    }

    // MARK: - Error Handling & Monitoring

    func forceRestart() async {
        print("🔄 🔄 🔄 MANUAL RESTART triggered by user")
        playbackStallCount = 0
        await restartWithNewVideos()
    }

    private func checkForStalledPlayback() async {
        guard let player = player else { return }

        // Check if player is supposed to be playing but isn't
        let isPlayingNow = player.rate > 0
        let hasItems = player.items().count > 0

        if hasItems && !isPlayingNow {
            playbackStallCount += 1
            print("⚠️ Playback stalled detected (count: \(playbackStallCount))")

            if playbackStallCount >= 3 {
                print("❌ Playback stalled for 6+ seconds - forcing restart!")
                await handlePlaybackError()
            }
        } else if isPlayingNow {
            // Reset stall counter if playing
            if playbackStallCount > 0 {
                playbackStallCount = 0
            }
        }

        // Check if current item has errors
        if let currentItem = player.currentItem {
            if currentItem.status == .failed {
                print("❌ Current item status: FAILED")
                await handlePlaybackError()
            } else if !currentItem.isPlaybackLikelyToKeepUp && currentItem.status == .readyToPlay {
                print("⚠️ Current item not keeping up (buffering issues)")
            }
        }

        // If we have no items and haven't restarted, force restart
        if !hasItems {
            print("❌ No items in queue - forcing restart")
            await restartWithNewVideos()
        }
    }

    private func handlePlaybackError() async {
        print("🔄 Handling playback error - attempting restart...")
        playbackStallCount = 0

        // Try to restart
        await restartWithNewVideos()
    }

    // No longer needed - AVQueuePlayer handles advancement automatically
    private func oldReversePlaybackCode() async {
        guard let player = player else { return }

        let currentItems = player.items()
        guard let currentItem = player.currentItem,
              let currentIndex = currentItems.firstIndex(of: currentItem) else { return }

        print("📍 Current video index: \(currentIndex) of \(currentItems.count - 1)")

        // Check if we're at the last video
        if currentIndex == currentItems.count - 1 {
            print("🔄 Reached end of queue, restarting from beginning...")
            await restartQueueReverse()
        } else {
            // Advance to next item
            player.advanceToNextItem()

            // Seek new item to end and start reverse playback
            if let newItem = player.currentItem,
               let duration = try? await newItem.asset.load(.duration) {
                await newItem.seek(to: duration, toleranceBefore: .zero, toleranceAfter: .zero)
                player.rate = -1.0
                print("⏮️ Started reverse playback of next video")
            }
        }
    }

    private func restartQueueReverse() async {
        guard let player = player else { return }

        // Remove all items and re-add them
        player.removeAllItems()
        for item in playerItems {
            player.insert(item, after: nil)
        }

        // Seek first item to end
        if let firstItem = playerItems.first,
           let duration = try? await firstItem.asset.load(.duration) {
            await firstItem.seek(to: duration, toleranceBefore: .zero, toleranceAfter: .zero)
        }

        // Start reverse playback
        player.rate = -1.0
        print("🔄 Queue restarted in reverse mode")
    }

    func updatePlaybackRate(to rate: Float, isPlaying: Bool) {
        let clamped = min(max(rate, 1.0), 10.0)
        playbackRateValue = clamped
        guard let player = player else { return }
        if isPlaying {
            player.rate = clamped
        } else {
            player.rate = 0
        }
    }

    func play() {
        player?.play()
        player?.rate = playbackRateValue
        print("▶️ Timelapse playback resumed")
    }

    func pause() {
        player?.pause()
        print("⏸️ Timelapse playback paused")
    }

    func stop() {
        player?.pause()
        teardownQueueMonitoring()
        player = nil
        playerItems.removeAll()
        videoURLs.removeAll()
        stopFrameAnimation()  // Stop any frame animation
        print("⏹️ Timelapse player stopped")
    }

    func startFrameAnimation(frames: [UIImage]) {
        // Stop any existing animation
        frameAnimationTimer?.invalidate()
        frameAnimationTimer = nil

        guard !frames.isEmpty else {
            print("⚠️ No frames to animate")
            return
        }

        collectedFrames = frames
        currentFrameIndex = 0

        // Animate at 10 FPS (100ms per frame)
        frameAnimationStatus = "Looping \(frames.count) frames"
        print("🎬 Starting frame animation with \(frames.count) frames")

        // Update preview immediately
        currentFramePreview = frames[0]

        // Cycle through frames smoothly
        frameAnimationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self else { return }

            Task { @MainActor in
                self.currentFrameIndex = (self.currentFrameIndex + 1) % self.collectedFrames.count
                self.currentFramePreview = self.collectedFrames[self.currentFrameIndex]
                self.frameAnimationStatus = "Looping \(self.collectedFrames.count) frames (frame \(self.currentFrameIndex + 1))"
            }
        }
    }

    func stopFrameAnimation() {
        frameAnimationTimer?.invalidate()
        frameAnimationTimer = nil
        currentFramePreview = nil
        frameAnimationStatus = ""
        print("⏹️ Frame animation stopped")
    }

    func seekToTime(offsetMinutes: Int) async {
        print("⏱️ Seeking to \(offsetMinutes) minutes into 24-hour timeline...")

        guard let player = player else {
            print("❌ Cannot seek - no player")
            return
        }

        // Calculate which video we need to jump to
        // Each video is ~1 minute, so offsetMinutes ≈ video index
        let targetVideoIndex = min(offsetMinutes, allLoadedSegments.count - 1)

        guard targetVideoIndex >= 0 && targetVideoIndex < playerItems.count else {
            print("❌ Target video index out of range: \(targetVideoIndex)")
            return
        }

        // Remove all items except the target one
        player.removeAllItems()

        // Re-add all items starting from target
        for (index, item) in playerItems.enumerated() {
            if index >= targetVideoIndex {
                player.insert(item, after: nil)
            }
        }

        print("✅ Jumped to \(targetVideoIndex): \(allLoadedSegments[targetVideoIndex].filename)")
        print("▶️ Resuming playback from selected time...")

        player.play()
        player.rate = playbackRateValue
    }

    func findNearestAvailableTime(_ targetMinutes: Int) -> Int {
        guard !availableTimes.isEmpty else { return targetMinutes }

        // Find the closest available time to the target
        var nearest = availableTimes.first ?? 0
        var minDistance = abs(targetMinutes - nearest)

        for time in availableTimes {
            let distance = abs(targetMinutes - time)
            if distance < minDistance {
                minDistance = distance
                nearest = time
            }
        }

        return nearest
    }
}
