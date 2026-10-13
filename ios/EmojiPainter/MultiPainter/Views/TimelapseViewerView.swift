//
//  TimelapseViewerView.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI
import AVKit
import AVFoundation

struct TimelapseViewerView: View {
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var gameState: GameState
    @StateObject private var viewModel = TimelapseViewModel()

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

                    EmojiLabel("⏳ Timelapse", size: 24, weight: .bold, color: .white)

                    Spacer()

                    // Refresh button
                    Button(action: {
                        Task {
                            viewModel.load()
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

                // Video Player (single HLS stream)
                if viewModel.isReady {
                    VideoPlayer(player: viewModel.player)
                        .frame(maxWidth: .infinity)
                        .frame(height: 400)
                        .cornerRadius(16)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 16)
                } else {
                    ZStack {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color.white.opacity(0.05))

                        // Prefer the multi-frame ring buffer for a real slideshow;
                        // fall back to the single newest frame.
                        let frames = gameState.collectedTimelapseFrames.count > 1
                            ? gameState.collectedTimelapseFrames
                            : gameState.timelapseFrames
                        if !frames.isEmpty {
                            // Instant: show the recent frames big + same size, slowly,
                            // while the full HLS timelapse loads/recovers in the background.
                            FramesSlideshow(frames: frames)
                                .cornerRadius(16)

                            VStack {
                                Spacer()
                                HStack(spacing: 8) {
                                    if viewModel.isLoading { ProgressView().tint(.white).scaleEffect(0.7) }
                                    Text(viewModel.errorMessage != nil ? "Showing recent frames" : "Loading full timelapse…")
                                        .appFont(12)
                                        .foregroundColor(.white.opacity(0.9))
                                }
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(Capsule().fill(Color.black.opacity(0.55)))
                                .padding(.bottom, 12)
                            }
                        } else if viewModel.isLoading {
                            VStack(spacing: 12) {
                                ProgressView().tint(.white).scaleEffect(1.5)
                                Text("Loading timelapse...")
                                    .appFont(16).foregroundColor(.white.opacity(0.7))
                            }
                        } else {
                            VStack(spacing: 12) {
                                CustomEmojiView("📹", size: 48, revealOnTap: false)
                                Text("No timelapse yet")
                                    .appFont(18, weight: .semibold).foregroundColor(.white.opacity(0.7))
                                Button(action: { viewModel.load() }) {
                                    HStack(spacing: 8) {
                                        Image(systemName: "arrow.clockwise"); Text("Try Again")
                                    }
                                    .appFont(14, weight: .semibold).foregroundColor(.white)
                                    .padding(.horizontal, 16).padding(.vertical, 8)
                                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.purple.opacity(0.6)))
                                }
                                .padding(.top, 8)
                            }
                            .padding(40)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 400)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 16)
                }

                // Scrubber + transport (single seekable HLS timeline)
                if viewModel.isReady {
                    VStack(spacing: 14) {
                        VStack(spacing: 4) {
                            Slider(
                                value: Binding(
                                    get: { viewModel.duration > 0 ? viewModel.currentTime / viewModel.duration : 0 },
                                    set: { viewModel.seek(toFraction: $0) }
                                ),
                                in: 0...1
                            )
                            .tint(.purple)

                            HStack {
                                Text(timeLabel(viewModel.currentTime))
                                Spacer()
                                Text(timeLabel(viewModel.duration))
                            }
                            .appFont(11)
                            .foregroundColor(.white.opacity(0.6))
                        }
                        .padding(.horizontal, 24)

                        HStack(spacing: 24) {
                            Button(action: { viewModel.togglePlayPause() }) {
                                Image(systemName: viewModel.isPlaying ? "pause.fill" : "play.fill")
                                    .appFont(28)
                                    .foregroundColor(.white)
                                    .frame(width: 64, height: 64)
                                    .background(Circle().fill(Color.purple.opacity(0.85)))
                                    .shadow(color: .purple.opacity(0.5), radius: 10)
                            }
                            Button(action: { viewModel.toggleLoop() }) {
                                Image(systemName: viewModel.isLooping ? "repeat.1" : "repeat")
                                    .appFont(20)
                                    .foregroundColor(viewModel.isLooping ? .purple : .white)
                                    .frame(width: 50, height: 50)
                                    .background(Circle().fill(Color.white.opacity(0.2)))
                            }
                        }
                    }
                    .padding(.bottom, 16)
                }

                // History window + playback speed (super-fast overview = Auto)
                VStack(spacing: 10) {
                    chipRow(title: "History", options: viewModel.windows, selected: viewModel.window) { viewModel.setWindow($0) }
                    chipRow(title: "Speed", options: viewModel.speeds, selected: viewModel.speed, label: speedLabel) { viewModel.setSpeed($0) }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 8)

                // Stats footer
                VStack(spacing: 8) {
                    Divider()
                        .background(Color.white.opacity(0.2))
                        .padding(.horizontal, 20)

                    HStack(spacing: 20) {
                        statCell("\(viewModel.segmentCount)", "Segments", .purple)
                        statCell(historyLabel(viewModel.totalRealSeconds), "History", .green)
                        statCell(speedLabel(viewModel.speed), "Speed", .yellow)
                    }
                    .padding(.vertical, 12)
                }
            }

            // Error overlay
            if let error = viewModel.errorMessage {
                VStack {
                    Spacer()
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
                    .padding(.bottom, 40)
                }
                .transition(.move(edge: .bottom))
                .animation(.easeInOut, value: viewModel.errorMessage)
            }

            // DEBUG strip — shows exactly what AVPlayer is doing on-device.
            VStack {
                Spacer()
                VStack(alignment: .leading, spacing: 2) {
                    Text("HLS: \(viewModel.debugStatus)")
                    Text("ready=\(viewModel.isReady ? "Y" : "N")  load=\(viewModel.isLoading ? "Y" : "N")  segs=\(viewModel.segmentCount)  dur=\(String(format: "%.1f", viewModel.duration))s  t=\(String(format: "%.1f", viewModel.currentTime))s  stalls=\(viewModel.stallCount)")
                    Text(viewModel.debugURL).lineLimit(1).foregroundColor(.cyan)
                }
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(.green)
                .padding(6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.black.opacity(0.75))
            }
            .allowsHitTesting(false)
        }
        .onAppear {
            // Pause lobby timelapse updates while viewer is open
            gameState.stopTimelapseUpdates()
            print("⏸️ Paused lobby timelapse updates")

            Task {
                viewModel.load()
            }
        }
        .onDisappear {
            // Resume lobby timelapse updates when viewer closes
            gameState.startTimelapseUpdates()
            print("▶️ Resumed lobby timelapse updates")
        }
    }

    // MARK: - Helpers
    private func timeLabel(_ s: Double) -> String {
        guard s.isFinite, s >= 0 else { return "0:00" }
        let t = Int(s.rounded()); return String(format: "%d:%02d", t / 60, t % 60)
    }
    private func speedLabel(_ s: String) -> String {
        s == "1" ? "Full" : (s == "auto" ? "Auto" : "\(s)×")
    }
    private func historyLabel(_ seconds: Double) -> String {
        if seconds <= 0 { return "—" }
        let h = seconds / 3600
        return h >= 1 ? String(format: "%.1fh", h) : String(format: "%.0fm", seconds / 60)
    }
    @ViewBuilder
    private func statCell(_ value: String, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value).appFont(18, weight: .bold).foregroundColor(color)
            Text(label).appFont(12).foregroundColor(.white.opacity(0.6))
        }
    }
    @ViewBuilder
    private func chipRow(title: String, options: [String], selected: String,
                         label: ((String) -> String)? = nil,
                         action: @escaping (String) -> Void) -> some View {
        HStack(spacing: 8) {
            Text(title).appFont(12, weight: .semibold)
                .foregroundColor(.white.opacity(0.5)).frame(width: 56, alignment: .leading)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(options, id: \.self) { opt in
                        Button(action: { action(opt) }) {
                            Text(label?(opt) ?? opt)
                                .appFont(13, weight: .semibold)
                                .foregroundColor(selected == opt ? .white : .white.opacity(0.7))
                                .padding(.horizontal, 14).padding(.vertical, 7)
                                .background(Capsule().fill(selected == opt ? Color.purple.opacity(0.7) : Color.white.opacity(0.08)))
                        }
                    }
                }
            }
        }
    }
}

struct TimelapseVideoCell: View {
    let video: TimelapseVideoSegment
    let index: Int
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Thumbnail placeholder
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(isSelected ? Color.purple.opacity(0.3) : Color.white.opacity(0.1))

                    Image(systemName: isSelected ? "play.circle.fill" : "video.fill")
                        .appFont(24)
                        .foregroundColor(isSelected ? .purple : .white.opacity(0.6))
                }
                .frame(width: 60, height: 60)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Segment #\(index + 1)")
                        .appFont(16, weight: .semibold)
                        .foregroundColor(isSelected ? .purple : .white)

                    Text(formatDate(video.createdAt))
                        .appFont(12)
                        .foregroundColor(.white.opacity(0.6))

                    if let duration = video.duration {
                        Text("\(String(format: "%.1f", duration))s")
                            .appFont(11)
                            .foregroundColor(.white.opacity(0.5))
                    }
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .appFont(20)
                        .foregroundColor(.purple)
                }
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(isSelected ? Color.purple.opacity(0.2) : Color.white.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isSelected ? Color.purple : Color.clear, lineWidth: 2)
                    )
            )
        }
    }

    private func formatDate(_ dateString: String?) -> String {
        guard let dateString = dateString else {
            return "Unknown date"
        }

        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: dateString) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateFormat = "MMM d, h:mm a"
            return displayFormatter.string(from: date)
        }
        return dateString
    }
}

/// Slow cross-fading slideshow of the recent lobby frames, shown big + same size
/// while the full HLS timelapse loads in the background.
private struct FramesSlideshow: View {
    let frames: [UIImage]
    @State private var index = 0
    @State private var prevIndex = 0
    @State private var topOpacity: Double = 1
    // Slower + smoother: the bottom layer always shows a full frame, the top
    // frame fades in over it — so it NEVER dips to black between frames.
    private let timer = Timer.publish(every: 2.6, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            if frames.indices.contains(prevIndex) {
                Image(uiImage: frames[prevIndex]).resizable().scaledToFit()
            }
            if frames.indices.contains(index) {
                Image(uiImage: frames[index]).resizable().scaledToFit()
                    .opacity(topOpacity)
            }
        }
        .onReceive(timer) { _ in
            guard frames.count > 1 else { return }
            prevIndex = index
            index = (index + 1) % frames.count
            topOpacity = 0
            withAnimation(.easeInOut(duration: 1.1)) { topOpacity = 1 }
        }
    }
}

@MainActor
class TimelapseViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var isReady = false
    @Published var errorMessage: String?
    @Published var isPlaying = false
    @Published var isLooping = true
    @Published var currentTime: Double = 0
    @Published var duration: Double = 0
    @Published var window: String = "5h"
    @Published var speed: String = "auto"      // overview by default
    @Published var totalRealSeconds: Double = 0
    @Published var segmentCount: Int = 0
    @Published var debugStatus: String = "idle"
    @Published var debugURL: String = ""
    @Published var stallCount: Int = 0

    // One AVPlayer on the server's single CONTINUOUS mp4 (re-encoded, no
    // discontinuities) → renders perfectly, real seekable timeline, fast via `speed`.
    let player = AVPlayer()
    let windows = ["1h", "5h", "1d", "7d"]
    let speeds  = ["8", "4", "2", "auto", "1"]  // "8" = super fast, "1" = full detail

    private let host = "https://some-sender.gotdns.ch:4850"
    private var apiBase: String { "\(host)/api/timelapse" }
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObserver: NSKeyValueObservation?
    private var rateObserver: NSKeyValueObservation?

    init() {
        let interval = CMTime(seconds: 0.1, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] t in
            guard let self else { return }
            if t.seconds.isFinite { self.currentTime = t.seconds }
            if let d = self.player.currentItem?.duration.seconds, d.isFinite, d > 0 { self.duration = d }
        }
        rateObserver = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            DispatchQueue.main.async { self?.isPlaying = p.timeControlStatus == .playing }
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.didFinish() }
        }
    }

    deinit {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        statusObserver?.invalidate()
        rateObserver?.invalidate()
    }

    private func videoURL() -> URL? {
        URL(string: "\(apiBase)/video.mp4?window=\(window)&speed=\(speed)")
    }

    /// Play the single continuous mp4 for the chosen window/speed.
    func load() {
        isLoading = true
        isReady = false
        errorMessage = nil
        currentTime = 0
        duration = 0
        stallCount = 0

        guard let url = videoURL() else {
            errorMessage = "Bad video URL"; isLoading = false; return
        }
        debugURL = url.absoluteString
        debugStatus = "loading mp4…"

        let item = AVPlayerItem(url: url)
        statusObserver?.invalidate()
        statusObserver = item.observe(\.status, options: [.new]) { [weak self] it, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                switch it.status {
                case .readyToPlay:
                    self.isLoading = false
                    self.isReady = true
                    let d = it.duration.seconds
                    if d.isFinite, d > 0 { self.duration = d }
                    self.debugStatus = "playing • \(String(format: "%.0f", self.duration))s @\(self.speed)"
                    self.player.play()
                case .failed:
                    self.isLoading = false
                    let e = it.error?.localizedDescription ?? "unknown"
                    self.errorMessage = e
                    self.debugStatus = "FAILED: \(e)"
                    if let log = it.errorLog()?.events.last {
                        self.debugStatus += " | \(log.errorComment ?? "") [\(log.errorStatusCode)]"
                    }
                default:
                    self.debugStatus = "status: unknown"
                }
            }
        }
        NotificationCenter.default.addObserver(forName: .AVPlayerItemPlaybackStalled, object: item, queue: .main) { [weak self] _ in
            DispatchQueue.main.async { self?.stallCount += 1 }
        }
        player.replaceCurrentItem(with: item)
        fetchManifestStats()
    }

    /// Pull the manifest just for the stats line (segment count + real history span).
    private func fetchManifestStats() {
        guard let url = URL(string: "\(apiBase)/manifest?window=\(window)") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            let segs = (obj["segments"] as? [[String: Any]])?.count ?? 0
            let real = (obj["totalRealSeconds"] as? Double) ?? 0
            DispatchQueue.main.async { self.segmentCount = segs; self.totalRealSeconds = real }
        }.resume()
    }

    func setWindow(_ w: String) { guard w != window else { return }; window = w; load() }
    func setSpeed(_ s: String)  { guard s != speed else { return }; speed = s; load() }

    func seek(toFraction f: Double) {
        guard duration > 0 else { return }
        let target = CMTime(seconds: max(0, min(1, f)) * duration, preferredTimescale: 600)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            guard let self, self.isPlaying else { return }
            self.player.play()
        }
    }

    func togglePlayPause() {
        if isPlaying { player.pause() } else { player.play() }
    }

    func toggleLoop() { isLooping.toggle() }

    private func didFinish() {
        guard isLooping else { return }
        player.seek(to: .zero) { [weak self] _ in
            guard let self else { return }
            self.player.play()
        }
    }
}
