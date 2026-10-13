import Foundation
import AVFoundation
import ImageIO
import UniformTypeIdentifiers
import CoreImage
import Metal
import MetalKit
import MobileCoreServices

/// Crash‑safe streaming GIF exporter with alpha support.
final class GifExporter {
    struct Params {
        let width: Int
        let height: Int
        let fps: Int       // 6–12 for GIF
        let frameCount: Int
        let outputURL: URL
        /// 0…max timeline ms; map frameIndex → currentTime externally or pass a closure.
        let timelineMs: Double
        /// Optional: seconds allocated to animation; remaining seconds are held on final frame
        let animationSeconds: Double?
        /// Optional max export size for GIF; defaults to min(input, 512)
        let maxExportSize: Int
    }

    /// Non-retained callbacks to avoid retain cycles
    var onProgress: ((Int, Int) -> Void)?
    var onComplete: ((Result<URL, Error>) -> Void)?

    private let replayEngine: StrokeReplayEngine
    private let ciContext: CIContext
    private let colorSpace = CGColorSpaceCreateDeviceRGB()

    init(replayEngine: StrokeReplayEngine) {
        self.replayEngine = replayEngine
        // Reuse a single CIContext to avoid leaks and perf hits
        self.ciContext = CIContext(options: [CIContextOption.useSoftwareRenderer: false])
    }

    enum ExportError: Error {
        case invalidParameters
        case destinationCreateFailed
        case directoryCreateFailed
        case cancelled
    }

    private var isCancelled = false
    func cancel() { isCancelled = true }

    /// Main entry point. Runs on a background queue.
    func exportGIF(strokes: [ReplayStroke], params: Params) {
        let p = params
        // Basic guards
        guard p.fps > 0, p.frameCount > 0, p.width > 0, p.height > 0 else {
            onComplete?(.failure(ExportError.invalidParameters)); return
        }

        // Refuse frameCount > 10000 on iOS
        guard p.frameCount <= 10000 else {
            onComplete?(.failure(ExportError.invalidParameters)); return
        }

        // Prepare directory
        let dir = p.outputURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            onComplete?(.failure(ExportError.directoryCreateFailed)); return
        }

        // Clamp GIF size to ≤512 px by default
        let maxSide = max(64, p.maxExportSize > 0 ? p.maxExportSize : min(512, max(p.width, p.height)))
        let scale = CGFloat(maxSide) / CGFloat(max(p.width, p.height))
        let outW = max(1, Int((CGFloat(p.width) * scale).rounded()))
        let outH = max(1, Int((CGFloat(p.height) * scale).rounded()))

        let bg = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0) // transparent

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                // Create destination
                let dest: CGImageDestination
                if #available(iOS 14.0, *) {
                    guard let d = CGImageDestinationCreateWithURL(p.outputURL as CFURL, UTType.gif.identifier as CFString, p.frameCount, nil) else {
                        throw ExportError.destinationCreateFailed
                    }
                    dest = d
                } else {
                    guard let d = CGImageDestinationCreateWithURL(p.outputURL as CFURL, kUTTypeGIF, p.frameCount, nil) else {
                        throw ExportError.destinationCreateFailed
                    }
                    dest = d
                }

                // Global GIF properties
                let gifGlobal: [CFString: Any] = [
                    kCGImagePropertyGIFDictionary: [
                        kCGImagePropertyGIFLoopCount: 0
                    ]
                ]
                CGImageDestinationSetProperties(dest, gifGlobal as CFDictionary)

                // Per-frame properties
                let delay = max(0.02, 1.0 / Double(p.fps)) // clamp
                let frameProps: [CFString: Any] = [
                    kCGImagePropertyGIFDictionary: [
                        kCGImagePropertyGIFDelayTime: delay
                    ],
                    kCGImagePropertyColorModel: kCGImagePropertyColorModelRGB,
                    kCGImagePropertyHasAlpha: true
                ]

                // Pre-allocate a PixelBuffer at output size
                var pixelBuffer: CVPixelBuffer? = nil
                let attrs: [CFString: Any] = [
                    kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
                    kCVPixelBufferWidthKey: outW,
                    kCVPixelBufferHeightKey: outH,
                    kCVPixelBufferMetalCompatibilityKey: true
                ]
                CVPixelBufferCreate(kCFAllocatorDefault, outW, outH, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pixelBuffer)
                guard let baseBuffer = pixelBuffer else { throw ExportError.invalidParameters }

                // Render loop
                // Compute animation vs hold frames with guards for stability
                let totalSec = max(0.0, Double(p.frameCount) / Double(max(1, p.fps)))
                let desiredAnimSec = p.animationSeconds ?? totalSec
                let safeAnimSec: Double
                if p.timelineMs <= 0.0 { // no timeline to play, just render final frame
                    safeAnimSec = 0.0
                } else {
                    safeAnimSec = max(0.0, min(totalSec, desiredAnimSec))
                }
                var animationFrames = Int(round(safeAnimSec * Double(max(1, p.fps))))
                if animationFrames < 1 { animationFrames = p.frameCount } // no hold if 0
                if animationFrames > p.frameCount { animationFrames = p.frameCount }

                for frameIndex in 0..<p.frameCount {
                    if self.isCancelled { throw ExportError.cancelled }
                    autoreleasepool {
                        // Map frame → timeline ms with hold
                        let currentTime: Double
                        if p.timelineMs <= 0.0 {
                            currentTime = 0.0
                        } else if p.frameCount <= 1 {
                            currentTime = p.timelineMs
                        } else if frameIndex < animationFrames {
                            let progress = Double(frameIndex) / Double(max(animationFrames - 1, 1))
                            currentTime = progress * p.timelineMs
                        } else {
                            currentTime = p.timelineMs
                        }

                        // Render into the reusable pixel buffer
                        self.replayEngine.renderFrameToPixelBuffer(
                            strokes: strokes,
                            upToTime: currentTime,
                            pixelBuffer: baseBuffer,
                            backgroundColor: bg
                        )

                        // Convert to CGImage without making UIImage
                        let ciImage = CIImage(cvPixelBuffer: baseBuffer)
                        // Downscale to outW/outH if needed
                        let scaled: CIImage
                        if outW != p.width || outH != p.height {
                            let sx = CGFloat(outW) / CGFloat(p.width)
                            let sy = CGFloat(outH) / CGFloat(p.height)
                            scaled = ciImage.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
                        } else {
                            scaled = ciImage
                        }

                        if let cgImage = self.ciContext.createCGImage(scaled, from: CGRect(x: 0, y: 0, width: outW, height: outH), format: .BGRA8, colorSpace: self.colorSpace) {
                            CGImageDestinationAddImage(dest, cgImage, frameProps as CFDictionary)
                        }

                        self.onProgress?(frameIndex + 1, p.frameCount)
                    }
                }

                // Finalize
                let ok = CGImageDestinationFinalize(dest)
                if !ok { throw ExportError.destinationCreateFailed }

                self.onComplete?(.success(p.outputURL))
            } catch {
                self.onComplete?(.failure(error))
            }
        }
    }
}
