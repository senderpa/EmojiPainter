//
//  AnimatedLoaderView.swift
//  MultiPainter
//
//  Created by Claude Code - Animated Loader
//

import SwiftUI

struct AnimatedLoaderView: View {
    @StateObject private var viewModel = AnimatedLoaderViewModel()
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        Group {
            if let currentFrame = viewModel.currentFrame {
                Image(uiImage: currentFrame)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: width, height: height)
                    .cornerRadius(8)
            } else {
                // Fallback spinner while frames load
                ProgressView()
                    .scaleEffect(1.5)
                    .tint(.white)
                    .frame(width: width, height: height)
            }
        }
        .onAppear {
            viewModel.startAnimation()
        }
        .onDisappear {
            viewModel.stopAnimation()
        }
    }
}

@MainActor
class AnimatedLoaderViewModel: ObservableObject {
    @Published var currentFrame: UIImage?

    private var frames: [UIImage] = []
    private var currentIndex: Int = 0
    private var timer: Timer?
    private var isLoading: Bool = false

    init() {
        // Preload frames immediately
        Task {
            await loadFrames()
        }
    }

    func startAnimation() {
        guard !frames.isEmpty else {
            print("⚠️ No loader frames available")
            return
        }

        currentFrame = frames[0]
        startRandomizedTimer()
        print("▶️ Started animated loader with \(frames.count) frames")
    }

    func stopAnimation() {
        timer?.invalidate()
        timer = nil
        print("⏹️ Stopped animated loader")
    }

    private func startRandomizedTimer() {
        timer?.invalidate()

        // Random FPS between 12 and 60
        let randomFPS = Double.random(in: 12.0...60.0)
        let interval = 1.0 / randomFPS

        print("🎬 Loader playing at \(String(format: "%.1f", randomFPS)) FPS")

        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
            guard let self = self else { return }

            Task { @MainActor in
                self.advanceFrame()

                // After each loop, pick new random speed
                if self.currentIndex == 0 {
                    self.startRandomizedTimer()
                } else {
                    // Continue with same speed until loop completes
                    self.timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
                        Task { @MainActor in
                            self.advanceFrame()

                            // When loop completes, restart with new random speed
                            if self.currentIndex == 0 {
                                self.startRandomizedTimer()
                            }
                        }
                    }
                }
            }
        }
    }

    private func advanceFrame() {
        guard !frames.isEmpty else { return }

        currentIndex = (currentIndex + 1) % frames.count
        currentFrame = frames[currentIndex]
    }

    private func loadFrames() async {
        guard !isLoading else { return }
        isLoading = true

        print("📦 Loading loader frames...")

        let frameCount = 29  // We know there are 29 frames
        var loadedFrames: [UIImage] = []

        for i in 1...frameCount {
            let frameName = String(format: "frame_%02d", i)

            // Try multiple loading methods
            var image: UIImage?

            // Method 1: Try from asset catalog
            if let img = UIImage(named: "LoaderFrames/\(frameName)") {
                image = img
            }
            // Method 2: Try from bundle with directory
            else if let path = Bundle.main.path(forResource: frameName, ofType: "jpg", inDirectory: "Resources/LoaderFrames"),
                    let img = UIImage(contentsOfFile: path) {
                image = img
            }
            // Method 3: Try without Resources prefix
            else if let path = Bundle.main.path(forResource: frameName, ofType: "jpg", inDirectory: "LoaderFrames"),
                    let img = UIImage(contentsOfFile: path) {
                image = img
            }
            // Method 4: Try direct file path
            else {
                let directPath = "/Users/senderp/MultiPainter/MultiPaint/Resources/LoaderFrames/\(frameName).jpg"
                if FileManager.default.fileExists(atPath: directPath),
                   let img = UIImage(contentsOfFile: directPath) {
                    image = img
                }
            }

            if let image = image {
                loadedFrames.append(image)
            } else {
                print("⚠️ Failed to load frame: \(frameName)")
            }
        }

        frames = loadedFrames

        if !frames.isEmpty {
            currentFrame = frames[0]
            print("✅ Loaded \(frames.count) loader frames")
        } else {
            print("❌ No loader frames loaded - check if LoaderFrames are added to Xcode project")
        }

        isLoading = false
    }

    deinit {
        timer?.invalidate()
    }
}
