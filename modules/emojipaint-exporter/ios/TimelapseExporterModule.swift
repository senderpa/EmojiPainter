import React
import Foundation
import UIKit
import Metal
import MetalKit
import AVFoundation
import MobileCoreServices
import ImageIO

/**
 * Timelapse Exporter Module
 * Exports drawing timelapses by replaying strokes frame-by-frame
 * No intermediate PNGs - direct stroke replay to MP4
 */

@objc(TimelapseExporterModule)
class TimelapseExporterModule: RCTEventEmitter {
    private var device: MTLDevice?
    private var commandQueue: MTLCommandQueue?
    private var exportInProgress: Bool = false
    private var cancelRequested: Bool = false
    private var hasListeners = false

    override init() {
        super.init()
        setupMetal()
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    override func supportedEvents() -> [String]! {
        return ["onExportProgress"]
    }

    private func sendProgress(current: Int, total: Int) {
        if hasListeners {
            sendEvent(withName: "onExportProgress", body: ["current": current, "total": total])
        }
    }

    private func setupMetal() {
        guard let device = MTLCreateSystemDefaultDevice() else {
            NSLog("[TimelapseExporter] Failed to create Metal device")
            return
        }

        self.device = device
        self.commandQueue = device.makeCommandQueue()

        NSLog("[TimelapseExporter] Metal setup complete")
    }

    @objc
    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    /// Generate preview frames from stroke data (low-res, few frames)
    @objc
    func generatePreviewFrames(
        _ strokes: [[String: Any]],
        width: NSNumber,
        height: NSNumber,
        frameCount: NSNumber,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let device = device,
              let commandQueue = commandQueue else {
            reject("METAL_ERROR", "Metal not initialized", nil)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("PREVIEW_ERROR", "Module deallocated", nil)
                return
            }

            do {
                let result = try self.performPreviewGeneration(
                    strokes: strokes,
                    width: width.intValue,
                    height: height.intValue,
                    frameCount: frameCount.intValue,
                    device: device,
                    commandQueue: commandQueue
                )
                resolve(result)
            } catch {
                reject("PREVIEW_ERROR", "Preview generation failed: \(error.localizedDescription)", error)
            }
        }
    }

    private func performPreviewGeneration(
        strokes: [[String: Any]],
        width: Int,
        height: Int,
        frameCount: Int,
        device: MTLDevice,
        commandQueue: MTLCommandQueue
    ) throws -> [[String: Any]] {
        // Parse strokes
        let replayStrokes = try parseStrokes(strokes)
        guard !replayStrokes.isEmpty else {
            return []
        }

        let scaledStrokes = try scaleStrokesToCanvas(
            replayStrokes,
            targetWidth: width,
            targetHeight: height
        )

        // Calculate time range
        let allTimes = scaledStrokes.flatMap { stroke in stroke.points.map { $0.t } }
        guard let minTime = allTimes.min(), let maxTime = allTimes.max() else {
            return []
        }

        let totalDrawingTime = maxTime - minTime

        // Initialize replay engine
        guard let replayEngine = StrokeReplayEngine(
            device: device,
            commandQueue: commandQueue,
            width: width,
            height: height
        ) else {
            throw NSError(domain: "TimelapseExporter", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create replay engine"])
        }

        // Generate preview frames
        var frames: [[String: Any]] = []

        for frameIndex in 0..<frameCount {
            // Check for cancellation
            if cancelRequested {
                cancelRequested = false
                throw NSError(domain: "TimelapseExporter", code: 999, userInfo: [NSLocalizedDescriptionKey: "Export cancelled by user"])
            }

            // For single frame preview (frameCount=1), show ALL strokes by rendering at maxTime
            let currentTime: Double
            if frameCount == 1 {
                currentTime = maxTime
            } else {
                let progress = Double(frameIndex) / Double(max(frameCount - 1, 1))
                currentTime = minTime + progress * totalDrawingTime
            }

            // Render frame
            guard let frameImage = replayEngine.renderFrame(strokes: scaledStrokes, upToTime: currentTime) else {
                continue
            }

            // Convert to base64 for transfer to JavaScript
            guard let imageData = frameImage.pngData() else {
                continue
            }

            frames.append([
                "index": frameIndex,
                "time": currentTime,
                "base64": imageData.base64EncodedString()
            ])
        }

        return frames
    }

    /// Export WebM from stroke data
    @objc
    func exportWebM(
        _ strokes: [[String: Any]],
        width: NSNumber,
        height: NSNumber,
        fps: NSNumber,
        durationSeconds: NSNumber,
        animationSeconds: NSNumber?,
        outputPath: NSString,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        if exportInProgress {
            reject("EXPORT_IN_PROGRESS", "Another export is already in progress", nil)
            return
        }

        guard let device = device,
              let commandQueue = commandQueue else {
            reject("METAL_ERROR", "Metal not initialized", nil)
            return
        }

        exportInProgress = true

        // Run export on background thread
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("EXPORT_ERROR", "Module deallocated", nil)
                return
            }

            do {
                let result = try self.performWebMExport(
                    strokes: strokes,
                    width: width.intValue,
                    height: height.intValue,
                    fps: fps.intValue,
                    durationSeconds: durationSeconds.doubleValue,
                    animationSeconds: animationSeconds?.doubleValue,
                    outputPath: outputPath as String,
                    device: device,
                    commandQueue: commandQueue
                )

                self.exportInProgress = false
                resolve(result)
            } catch {
                self.exportInProgress = false
                reject("EXPORT_ERROR", "WebM export failed: \(error.localizedDescription)", error)
            }
        }
    }

    /// Export GIF from stroke data
    @objc
    func exportGif(
        _ strokes: [[String: Any]],
        width: NSNumber,
        height: NSNumber,
        fps: NSNumber,
        durationSeconds: NSNumber,
        animationSeconds: NSNumber?,
        outputPath: NSString,
        quality: NSNumber,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        if exportInProgress {
            reject("EXPORT_IN_PROGRESS", "Another export is already in progress", nil)
            return
        }

        guard let device = device,
              let commandQueue = commandQueue else {
            reject("METAL_ERROR", "Metal not initialized", nil)
            return
        }

        exportInProgress = true

        // Run export on background thread
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("EXPORT_ERROR", "Module deallocated", nil)
                return
            }

            do {
                let result = try self.performGifExport(
                    strokes: strokes,
                    width: width.intValue,
                    height: height.intValue,
                    fps: fps.intValue,
                    durationSeconds: durationSeconds.doubleValue,
                    animationSeconds: animationSeconds?.doubleValue,
                    outputPath: outputPath as String,
                    quality: quality.doubleValue,
                    device: device,
                    commandQueue: commandQueue
                )

                self.exportInProgress = false
                resolve(result)
            } catch {
                self.exportInProgress = false
                reject("EXPORT_ERROR", "GIF export failed: \(error.localizedDescription)", error)
            }
        }
    }

    /// Export timelapse from stroke data
    @objc
    func exportTimelapse(
        _ strokes: [[String: Any]],
        width: NSNumber,
        height: NSNumber,
        fps: NSNumber,
        durationSeconds: NSNumber,
        animationSeconds: NSNumber?,
        outputPath: NSString,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        if exportInProgress {
            reject("EXPORT_IN_PROGRESS", "Another export is already in progress", nil)
            return
        }

        guard let device = device,
              let commandQueue = commandQueue else {
            reject("METAL_ERROR", "Metal not initialized", nil)
            return
        }

        exportInProgress = true

        // Run export on background thread
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("EXPORT_ERROR", "Module deallocated", nil)
                return
            }

            do {
                let result = try self.performExport(
                    strokes: strokes,
                    width: width.intValue,
                    height: height.intValue,
                    fps: fps.intValue,
                    durationSeconds: durationSeconds.doubleValue,
                    animationSeconds: animationSeconds?.doubleValue,
                    outputPath: outputPath as String,
                    device: device,
                    commandQueue: commandQueue
                )

                self.exportInProgress = false
                resolve(result)
            } catch {
                self.exportInProgress = false
                reject("EXPORT_ERROR", "Export failed: \(error.localizedDescription)", error)
            }
        }
    }

    private func performExport(
        strokes: [[String: Any]],
        width: Int,
        height: Int,
        fps: Int,
        durationSeconds: Double,
        animationSeconds: Double?,
        outputPath: String,
        device: MTLDevice,
        commandQueue: MTLCommandQueue
    ) throws -> [String: Any] {
        NSLog("[TimelapseExporter] Starting GPU-accelerated export: \(width)x\(height) @\(fps)fps for \(durationSeconds)s")
        NSLog("[TimelapseExporter] Output path: \(outputPath)")

        // Begin background task to prevent app suspension during export
        var backgroundTask: UIBackgroundTaskIdentifier = .invalid
        backgroundTask = UIApplication.shared.beginBackgroundTask {
            NSLog("[TimelapseExporter] Background task expiring, cleaning up...")
            if backgroundTask != .invalid {
                UIApplication.shared.endBackgroundTask(backgroundTask)
                backgroundTask = .invalid
            }
        }

        defer {
            if backgroundTask != .invalid {
                UIApplication.shared.endBackgroundTask(backgroundTask)
            }
        }

        // Parse strokes
        let replayStrokes = try parseStrokes(strokes)
        guard !replayStrokes.isEmpty else {
            throw NSError(domain: "TimelapseExporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "No strokes to export"])
        }

        // Scale strokes to fit canvas
        let scaledStrokes = try scaleStrokesToCanvas(
            replayStrokes,
            targetWidth: width,
            targetHeight: height
        )

        // Calculate time range and normalize timestamps to start from 0
        let allTimes = scaledStrokes.flatMap { stroke in
            stroke.points.map { $0.t }
        }
        guard let minTime = allTimes.min(), let maxTime = allTimes.max() else {
            throw NSError(domain: "TimelapseExporter", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not determine time range"])
        }

        // JavaScript already normalizes timestamps to start from 0, so skip redundant normalization
        let normalizedStrokes: [ReplayStroke]
        let totalDrawingTimeMs: Double

        if minTime == 0 {
            // JS already normalized - use timestamps as-is
            normalizedStrokes = scaledStrokes
            totalDrawingTimeMs = maxTime
            NSLog("[TimelapseExporter] ✓ Timestamps already normalized by JS (minTime=0)")
            NSLog("[TimelapseExporter] Timeline: 0 to \(totalDrawingTimeMs)ms (\(totalDrawingTimeMs/1000.0)s)")
        } else {
            // Fallback: normalize if JS didn't (shouldn't happen with new code)
            normalizedStrokes = scaledStrokes.map { stroke in
                ReplayStroke(
                    id: stroke.id,
                    emoji: stroke.emoji,
                    size: stroke.size,
                    opacity: stroke.opacity,
                    spacing: stroke.spacing,
                    stampSpan: stroke.stampSpan,
                    points: stroke.points.map { point in
                        ReplayStrokePoint(x: point.x, y: point.y, t: point.t - minTime, w: point.w)
                    },
                    emojiSequence: stroke.emojiSequence,
                    mirrorX: stroke.mirrorX,
                    mirrorY: stroke.mirrorY,
                    rotation: stroke.rotation,
                    isEraser: stroke.isEraser,
                    isPlane: stroke.isPlane,
                    planeCorners: stroke.planeCorners,
                    planeCornerHistory: stroke.planeCornerHistory,
                    planeTimestamps: stroke.planeTimestamps,
                    isSmudge: stroke.isSmudge,
                    bakedTile: stroke.bakedTile,
                    bakedBounds: stroke.bakedBounds
                )
            }
            totalDrawingTimeMs = maxTime - minTime
            NSLog("[TimelapseExporter] ⚠️ Normalizing timestamps in Swift (minTime=\(minTime))")
            NSLog("[TimelapseExporter] Original range: \(minTime) to \(maxTime)")
            NSLog("[TimelapseExporter] Normalized to: 0 to \(totalDrawingTimeMs)ms")
        }

        let frameCount = Int(durationSeconds * Double(fps))

        // Debug logging
        NSLog("[TimelapseExporter] First stroke first point t: \(normalizedStrokes.first?.points.first?.t ?? -1)ms")
        NSLog("[TimelapseExporter] First stroke last point t: \(normalizedStrokes.first?.points.last?.t ?? -1)ms")
        NSLog("[TimelapseExporter] Last stroke first point t: \(normalizedStrokes.last?.points.first?.t ?? -1)ms")
        NSLog("[TimelapseExporter] Last stroke last point t: \(normalizedStrokes.last?.points.last?.t ?? -1)ms")
        let animSec = max(0.0, min(durationSeconds, animationSeconds ?? durationSeconds))
        let animationFrames = max(1, min(frameCount, Int(round(animSec * Double(fps)))))
        NSLog("[TimelapseExporter] Exporting as: total=\(durationSeconds)s (anim=\(animSec)s hold=\(max(0.0, durationSeconds-animSec))s) at \(fps)fps = \(frameCount) frames (anim=\(animationFrames), hold=\(frameCount-animationFrames))")
        NSLog("[TimelapseExporter] Speed mapping: \(totalDrawingTimeMs/1000.0)s timeline → anim=\(animSec)s (speed=\(totalDrawingTimeMs/1000.0/animSec)x)")

        // Initialize replay engine
        guard let replayEngine = StrokeReplayEngine(
            device: device,
            commandQueue: commandQueue,
            width: width,
            height: height
        ) else {
            throw NSError(domain: "TimelapseExporter", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create replay engine"])
        }

        // Setup video writer
        let videoWriter = try setupVideoWriter(
            outputPath: outputPath,
            width: width,
            height: height,
            fps: fps
        )

        // Generate frames using zero-copy GPU rendering
        let startTime = Date()

        for frameIndex in 0..<frameCount {
            // Check for cancellation
            if cancelRequested {
                cancelRequested = false
                exportInProgress = false
                throw NSError(domain: "TimelapseExporter", code: 999, userInfo: [NSLocalizedDescriptionKey: "Export cancelled by user"])
            }

            let currentTime: Double
            if frameIndex < animationFrames {
                let progress = Double(frameIndex) / Double(max(animationFrames - 1, 1))
                // Map to normalized timeline (0 to totalDrawingTimeMs)
                currentTime = progress * totalDrawingTimeMs
            } else {
                currentTime = totalDrawingTimeMs
            }

            // Debug first 5 and last 5 frames
            if frameIndex < 5 || frameIndex >= frameCount - 5 {
                NSLog("[TimelapseExporter] Frame \(frameIndex)/\(frameCount) currentTime=\(currentTime)ms")
            }

            // Get pixel buffer from pool
            guard let pool = videoWriter.adaptor.pixelBufferPool else {
                throw NSError(domain: "TimelapseExporter", code: 14, userInfo: [NSLocalizedDescriptionKey: "Pixel buffer pool is nil. Writer may not be ready."])
            }

            var pixelBuffer: CVPixelBuffer?
            let result = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer)

            guard result == kCVReturnSuccess, let pixelBuffer = pixelBuffer else {
                NSLog("[TimelapseExporter] Failed to create pixel buffer: \(result)")
                throw NSError(domain: "TimelapseExporter", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to get pixel buffer from pool (CVReturn: \(result))"])
            }

            // Render directly into pixel buffer with black background for MP4 (ZERO-COPY!)
            let blackBg = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
            guard replayEngine.renderFrameToPixelBuffer(
                strokes: normalizedStrokes,
                upToTime: currentTime,
                pixelBuffer: pixelBuffer,
                backgroundColor: blackBg
            ) else {
                throw NSError(domain: "TimelapseExporter", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to render frame \(frameIndex)"])
            }

            // Append pixel buffer directly to video
            let presentationTime = CMTime(value: Int64(frameIndex), timescale: Int32(fps))

            // Wait for input to be ready
            while !videoWriter.input.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.01)
            }

            guard videoWriter.adaptor.append(pixelBuffer, withPresentationTime: presentationTime) else {
                throw NSError(domain: "TimelapseExporter", code: 6, userInfo: [NSLocalizedDescriptionKey: "Failed to append frame \(frameIndex)"])
            }

            // Send progress updates
            if frameIndex % max(frameCount / 20, 1) == 0 || frameIndex == frameCount - 1 {
                sendProgress(current: frameIndex + 1, total: frameCount)
                let pct = Int((Double(frameIndex+1)/Double(max(frameCount,1))) * 100.0)
                NSLog("[TimelapseExporter] Progress: \(frameIndex + 1)/\(frameCount) (\(pct)%)")
            }
        }

        // Final verification
        NSLog("[TimelapseExporter] ✓ Rendered all \(frameCount) frames")
        NSLog("[TimelapseExporter] Last frame upToTime: \(totalDrawingTimeMs)ms (should equal timeline max)")

        // Finalize video
        try finalizeVideo(videoWriter)

        let exportDuration = Date().timeIntervalSince(startTime)
        NSLog("[TimelapseExporter] Export completed in \(exportDuration)s (\(String(format: "%.1f", Double(frameCount)/exportDuration)) fps)")

        return [
            "success": true,
            "outputPath": outputPath,
            "frameCount": frameCount,
            "durationMs": Int(exportDuration * 1000),
            "fps": fps,
            "width": width,
            "height": height
        ]
    }

    private func performWebMExport(
        strokes: [[String: Any]],
        width: Int,
        height: Int,
        fps: Int,
        durationSeconds: Double,
        animationSeconds: Double?,
        outputPath: String,
        device: MTLDevice,
        commandQueue: MTLCommandQueue
    ) throws -> [String: Any] {
        NSLog("[TimelapseExporter] Starting WebM export: \(width)x\(height) @\(fps)fps for \(durationSeconds)s")
        NSLog("[TimelapseExporter] Output path: \(outputPath)")

        // Begin background task
        var backgroundTask: UIBackgroundTaskIdentifier = .invalid
        backgroundTask = UIApplication.shared.beginBackgroundTask {
            NSLog("[TimelapseExporter] Background task expiring, cleaning up...")
            if backgroundTask != .invalid {
                UIApplication.shared.endBackgroundTask(backgroundTask)
                backgroundTask = .invalid
            }
        }

        defer {
            if backgroundTask != .invalid {
                UIApplication.shared.endBackgroundTask(backgroundTask)
            }
        }

        // Parse strokes
        let replayStrokes = try parseStrokes(strokes)
        guard !replayStrokes.isEmpty else {
            throw NSError(domain: "TimelapseExporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "No strokes to export"])
        }

        // Scale strokes to fit canvas
        let scaledStrokes = try scaleStrokesToCanvas(
            replayStrokes,
            targetWidth: width,
            targetHeight: height
        )

        // Calculate time range and normalize
        let allTimes = scaledStrokes.flatMap { stroke in
            stroke.points.map { $0.t }
        }
        guard let minTime = allTimes.min(), let maxTime = allTimes.max() else {
            throw NSError(domain: "TimelapseExporter", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not determine time range"])
        }

        // JavaScript already normalizes timestamps - skip redundant normalization
        let normalizedStrokes: [ReplayStroke]
        let totalDrawingTimeMs: Double

        if minTime == 0 {
            normalizedStrokes = scaledStrokes
            totalDrawingTimeMs = maxTime
            NSLog("[TimelapseExporter] WebM: ✓ Timestamps already normalized (minTime=0)")
        } else {
            normalizedStrokes = scaledStrokes.map { stroke in
                ReplayStroke(
                    id: stroke.id,
                    emoji: stroke.emoji,
                    size: stroke.size,
                    opacity: stroke.opacity,
                    spacing: stroke.spacing,
                    stampSpan: stroke.stampSpan,
                    points: stroke.points.map { point in
                        ReplayStrokePoint(x: point.x, y: point.y, t: point.t - minTime, w: point.w)
                    },
                    emojiSequence: stroke.emojiSequence,
                    mirrorX: stroke.mirrorX,
                    mirrorY: stroke.mirrorY,
                    rotation: stroke.rotation,
                    isEraser: stroke.isEraser,
                    isPlane: stroke.isPlane,
                    planeCorners: stroke.planeCorners,
                    planeCornerHistory: stroke.planeCornerHistory,
                    planeTimestamps: stroke.planeTimestamps,
                    isSmudge: stroke.isSmudge,
                    bakedTile: stroke.bakedTile,
                    bakedBounds: stroke.bakedBounds
                )
            }
            totalDrawingTimeMs = maxTime - minTime
            NSLog("[TimelapseExporter] WebM: ⚠️ Normalizing in Swift (minTime=\(minTime))")
        }

        let frameCount = Int(durationSeconds * Double(fps))
        let animSec = max(0.0, min(durationSeconds, animationSeconds ?? durationSeconds))
        let animationFrames = max(1, min(frameCount, Int(round(animSec * Double(fps)))))
        NSLog("[TimelapseExporter] WebM: Timeline 0-\(totalDrawingTimeMs)ms → anim \(animSec)s + hold \(max(0.0, durationSeconds-animSec))s @ \(fps)fps (frames anim=\(animationFrames), hold=\(frameCount-animationFrames))")

        // Initialize replay engine
        guard let replayEngine = StrokeReplayEngine(
            device: device,
            commandQueue: commandQueue,
            width: width,
            height: height
        ) else {
            throw NSError(domain: "TimelapseExporter", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create replay engine"])
        }

        // Setup video writer for WebM (using HEVC with alpha for transparency)
        let videoWriter = try setupWebMWriter(
            outputPath: outputPath,
            width: width,
            height: height,
            fps: fps
        )

        // Generate frames using zero-copy GPU rendering with transparent background
        let startTime = Date()
        let transparentBg = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)

        for frameIndex in 0..<frameCount {
            // Check for cancellation
            if cancelRequested {
                cancelRequested = false
                exportInProgress = false
                throw NSError(domain: "TimelapseExporter", code: 999, userInfo: [NSLocalizedDescriptionKey: "Export cancelled by user"])
            }
            let currentTime: Double
            if frameIndex < animationFrames {
                let progress = Double(frameIndex) / Double(max(animationFrames - 1, 1))
                currentTime = progress * totalDrawingTimeMs
            } else {
                currentTime = totalDrawingTimeMs
            }

            // Get pixel buffer from pool
            guard let pool = videoWriter.adaptor.pixelBufferPool else {
                throw NSError(domain: "TimelapseExporter", code: 14, userInfo: [NSLocalizedDescriptionKey: "Pixel buffer pool is nil. Writer may not be ready."])
            }

            var pixelBuffer: CVPixelBuffer?
            let result = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer)

            guard result == kCVReturnSuccess, let pixelBuffer = pixelBuffer else {
                NSLog("[TimelapseExporter] Failed to create pixel buffer: \(result)")
                throw NSError(domain: "TimelapseExporter", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to get pixel buffer from pool (CVReturn: \(result))"])
            }

            // Render directly into pixel buffer with transparent background (ZERO-COPY!)
            guard replayEngine.renderFrameToPixelBuffer(
                strokes: normalizedStrokes,
                upToTime: currentTime,
                pixelBuffer: pixelBuffer,
                backgroundColor: transparentBg
            ) else {
                throw NSError(domain: "TimelapseExporter", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to render frame \(frameIndex)"])
            }

            // Append pixel buffer directly to video
            let presentationTime = CMTime(value: Int64(frameIndex), timescale: Int32(fps))

            // Wait for input to be ready
            while !videoWriter.input.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.01)
            }

            guard videoWriter.adaptor.append(pixelBuffer, withPresentationTime: presentationTime) else {
                throw NSError(domain: "TimelapseExporter", code: 6, userInfo: [NSLocalizedDescriptionKey: "Failed to append frame \(frameIndex)"])
            }

            // Send progress updates
            if frameIndex % max(frameCount / 20, 1) == 0 || frameIndex == frameCount - 1 {
                sendProgress(current: frameIndex + 1, total: frameCount)
                let pct = Int((Double(frameIndex+1)/Double(max(frameCount,1))) * 100.0)
                NSLog("[TimelapseExporter] WebM Progress: \(frameIndex + 1)/\(frameCount) (\(pct)%)")
            }
        }

        // Finalize video
        try finalizeVideo(videoWriter)

        let exportDuration = Date().timeIntervalSince(startTime)
        NSLog("[TimelapseExporter] WebM export completed in \(exportDuration)s")

        return [
            "success": true,
            "outputPath": outputPath,
            "frameCount": frameCount,
            "durationMs": Int(exportDuration * 1000),
            "fps": fps,
            "width": width,
            "height": height
        ]
    }

    private func performGifExport(
        strokes: [[String: Any]],
        width: Int,
        height: Int,
        fps: Int,
        durationSeconds: Double,
        animationSeconds: Double?,
        outputPath: String,
        quality: Double,
        device: MTLDevice,
        commandQueue: MTLCommandQueue
    ) throws -> [String: Any] {
        NSLog("[TimelapseExporter] Starting crash-safe GIF export: 512x512 @\(fps)fps for \(durationSeconds)s")
        NSLog("[TimelapseExporter] Output path: \(outputPath)")

        // Parse strokes
        let replayStrokes = try parseStrokes(strokes)
        guard !replayStrokes.isEmpty else {
            throw NSError(domain: "TimelapseExporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "No strokes to export"])
        }

        // Force 512x512 for GIF exports
        let exportSize = 512

        // Scale strokes to fit canvas
        let scaledStrokes = try scaleStrokesToCanvas(
            replayStrokes,
            targetWidth: exportSize,
            targetHeight: exportSize
        )

        // Calculate time range and normalize
        let allTimes = scaledStrokes.flatMap { stroke in
            stroke.points.map { $0.t }
        }
        guard let minTime = allTimes.min(), let maxTime = allTimes.max() else {
            throw NSError(domain: "TimelapseExporter", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not determine time range"])
        }

        // Normalize timestamps
        let normalizedStrokes: [ReplayStroke]
        let totalDrawingTimeMs: Double

        if minTime == 0 {
            normalizedStrokes = scaledStrokes
            totalDrawingTimeMs = maxTime
            NSLog("[TimelapseExporter] GIF: ✓ Timestamps already normalized (minTime=0)")
        } else {
            normalizedStrokes = scaledStrokes.map { stroke in
                ReplayStroke(
                    id: stroke.id,
                    emoji: stroke.emoji,
                    size: stroke.size,
                    opacity: stroke.opacity,
                    spacing: stroke.spacing,
                    stampSpan: stroke.stampSpan,
                    points: stroke.points.map { point in
                        ReplayStrokePoint(x: point.x, y: point.y, t: point.t - minTime, w: point.w)
                    },
                    emojiSequence: stroke.emojiSequence,
                    mirrorX: stroke.mirrorX,
                    mirrorY: stroke.mirrorY,
                    rotation: stroke.rotation,
                    isEraser: stroke.isEraser,
                    isPlane: stroke.isPlane,
                    planeCorners: stroke.planeCorners,
                    planeCornerHistory: stroke.planeCornerHistory,
                    planeTimestamps: stroke.planeTimestamps,
                    isSmudge: stroke.isSmudge,
                    bakedTile: stroke.bakedTile,
                    bakedBounds: stroke.bakedBounds
                )
            }
            totalDrawingTimeMs = maxTime - minTime
            NSLog("[TimelapseExporter] GIF: ⚠️ Normalizing in Swift (minTime=\(minTime))")
        }

        let frameCount = Int(durationSeconds * Double(fps))
        let animSec = max(0.0, min(durationSeconds, animationSeconds ?? durationSeconds))
        let animationFrames = max(1, min(frameCount, Int(round(animSec * Double(fps)))))
        NSLog("[TimelapseExporter] GIF: Timeline 0-\(totalDrawingTimeMs)ms → anim \(animSec)s + hold \(max(0.0, durationSeconds-animSec))s @ \(fps)fps (frames anim=\(animationFrames), hold=\(frameCount-animationFrames))")
        NSLog("[TimelapseExporter] Speed mapping: \(totalDrawingTimeMs/1000.0)s timeline → anim=\(animSec)s (speed=\(totalDrawingTimeMs/1000.0/animSec)x)")

        // Initialize replay engine
        guard let replayEngine = StrokeReplayEngine(
            device: device,
            commandQueue: commandQueue,
            width: exportSize,
            height: exportSize
        ) else {
            throw NSError(domain: "TimelapseExporter", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create replay engine"])
        }

        // Create GIF exporter
        let gifExporter = GifExporter(replayEngine: replayEngine)

        // Setup parameters
        let fileURL = fileURL(from: outputPath)
        let params = GifExporter.Params(
            width: exportSize,
            height: exportSize,
            fps: fps,
            frameCount: frameCount,
            outputURL: fileURL,
            timelineMs: totalDrawingTimeMs,
            animationSeconds: animSec,
            maxExportSize: 512
        )

        // Track completion
        let semaphore = DispatchSemaphore(value: 0)
        var exportResult: Result<URL, Error>?

        // Wire up callbacks
        gifExporter.onProgress = { [weak self] (current: Int, total: Int) -> Void in
            self?.sendProgress(current: current, total: total)

            let percent: Int = Int((Double(current) / Double(total)) * 100.0)
            if percent % 5 == 0 || current == total {
                NSLog("[TimelapseExporter] GIF Progress: \(current)/\(total) (\(percent)%)")
            }
        }

        gifExporter.onComplete = { (result: Result<URL, Error>) in
            exportResult = result
            semaphore.signal()
        }

        // Handle cancellation
        if cancelRequested {
            gifExporter.cancel()
        }

        // Start export (runs on background queue internally)
        let startTime = Date()
        gifExporter.exportGIF(strokes: normalizedStrokes, params: params)

        // Wait for completion
        semaphore.wait()

        // Check result
        guard let result = exportResult else {
            throw NSError(domain: "TimelapseExporter", code: 999, userInfo: [NSLocalizedDescriptionKey: "Export completed without result"])
        }

        switch result {
        case .success(let url):
            let exportDuration = Date().timeIntervalSince(startTime)
            NSLog("[TimelapseExporter] GIF export completed in \(exportDuration)s")
            return [
                "success": true,
                "outputPath": url.path,
                "frameCount": frameCount,
                "durationMs": Int(exportDuration * 1000),
                "fps": fps,
                "width": exportSize,
                "height": exportSize
            ]
        case .failure(let error):
            throw error
        }
    }

    /// Convert path string to URL, handling both file:// URLs and plain paths
    private func fileURL(from pathString: String) -> URL {
        // If it's already a file:// URL, convert it properly
        if pathString.hasPrefix("file://") {
            return URL(string: pathString)!
        }
        // Otherwise treat it as a plain file path
        return URL(fileURLWithPath: pathString)
    }

    /// JavaScript pre-scales strokes into the export coordinate system so we simply use them as-is.
    private func scaleStrokesToCanvas(
        _ strokes: [ReplayStroke],
        targetWidth: Int,
        targetHeight: Int
    ) throws -> [ReplayStroke] {
        NSLog("[TimelapseExporter] Using pre-scaled strokes for \(targetWidth)x\(targetHeight) export")
        return strokes
    }

    /// Parse stroke data from JS
    private func parseStrokes(_ strokesData: [[String: Any]]) throws -> [ReplayStroke] {
        var replayStrokes: [ReplayStroke] = []

        for strokeData in strokesData {
            guard let id = strokeData["id"] as? String,
                  let emoji = strokeData["emoji"] as? String,
                  let size = strokeData["size"] as? Double,
                  let opacity = strokeData["opacity"] as? Double,
                  let pointsData = strokeData["points"] as? [[String: Any]] else {
                continue
            }

            let spacing = (strokeData["spacing"] as? Double) ?? 0.0
            let stampSpan = (strokeData["stampSpan"] as? Double) ?? 0.0
            let mirrorX = (strokeData["mirrorX"] as? Bool) ?? false
            let mirrorY = (strokeData["mirrorY"] as? Bool) ?? false
            let rotation = (strokeData["rotation"] as? Double) ?? 0.0
            let emojiSequence = strokeData["emojiSequence"] as? [String]
            let isEraser = (strokeData["isEraser"] as? Bool) ?? false
            let isPlane = (strokeData["isPlane"] as? Bool) ?? false
            let isSmudge = (strokeData["isSmudge"] as? Bool) ?? false
            let bakedTile = strokeData["bakedTile"] as? String
            var bakedBounds: SIMD4<Float>? = nil
            if let bb = strokeData["bakedBounds"] as? [String: Any],
               let bx = bb["x"] as? Double, let by = bb["y"] as? Double,
               let bw = bb["w"] as? Double, let bh = bb["h"] as? Double {
                bakedBounds = SIMD4<Float>(Float(bx), Float(by), Float(bw), Float(bh))
            }

            // Parse plane corners if present
            var planeCorners: ReplayPlaneCorners? = nil
            if isPlane, let cornersData = strokeData["planeCorners"] as? [String: Any],
               let topLeftData = cornersData["topLeft"] as? [String: Any],
               let topRightData = cornersData["topRight"] as? [String: Any],
               let bottomRightData = cornersData["bottomRight"] as? [String: Any],
               let bottomLeftData = cornersData["bottomLeft"] as? [String: Any],
               let tlX = topLeftData["x"] as? Double, let tlY = topLeftData["y"] as? Double,
               let trX = topRightData["x"] as? Double, let trY = topRightData["y"] as? Double,
               let brX = bottomRightData["x"] as? Double, let brY = bottomRightData["y"] as? Double,
               let blX = bottomLeftData["x"] as? Double, let blY = bottomLeftData["y"] as? Double {
                planeCorners = ReplayPlaneCorners(
                    topLeft: SIMD2<Float>(Float(tlX), Float(tlY)),
                    topRight: SIMD2<Float>(Float(trX), Float(trY)),
                    bottomRight: SIMD2<Float>(Float(brX), Float(brY)),
                    bottomLeft: SIMD2<Float>(Float(blX), Float(blY))
                )
            }

            // Parse plane corner history for animated timelapse
            var planeCornerHistory: [ReplayPlaneCorners]? = nil
            var planeTimestamps: [Double]? = nil
            if isPlane, let historyData = strokeData["planeCornerHistory"] as? [[String: Any]], !historyData.isEmpty {
                var corners: [ReplayPlaneCorners] = []
                var timestamps: [Double] = []

                for snapshot in historyData {
                    guard let tlData = snapshot["topLeft"] as? [String: Any],
                          let trData = snapshot["topRight"] as? [String: Any],
                          let brData = snapshot["bottomRight"] as? [String: Any],
                          let blData = snapshot["bottomLeft"] as? [String: Any],
                          let tlX = tlData["x"] as? Double, let tlY = tlData["y"] as? Double,
                          let trX = trData["x"] as? Double, let trY = trData["y"] as? Double,
                          let brX = brData["x"] as? Double, let brY = brData["y"] as? Double,
                          let blX = blData["x"] as? Double, let blY = blData["y"] as? Double,
                          let timestamp = snapshot["timestamp"] as? Double else {
                        continue
                    }

                    corners.append(ReplayPlaneCorners(
                        topLeft: SIMD2<Float>(Float(tlX), Float(tlY)),
                        topRight: SIMD2<Float>(Float(trX), Float(trY)),
                        bottomRight: SIMD2<Float>(Float(brX), Float(brY)),
                        bottomLeft: SIMD2<Float>(Float(blX), Float(blY))
                    ))
                    timestamps.append(timestamp)
                }

                if !corners.isEmpty {
                    planeCornerHistory = corners
                    planeTimestamps = timestamps
                    NSLog("[TimelapseExporter] Parsed plane corner history: \(corners.count) snapshots")
                }
            }

            // Parse points with optional per-point width
            var points: [ReplayStrokePoint] = []
            for pointData in pointsData {
                guard let x = pointData["x"] as? Double,
                      let y = pointData["y"] as? Double,
                      let t = pointData["t"] as? Double else {
                    continue
                }
                let w = pointData["w"] as? Double
                points.append(ReplayStrokePoint(
                    x: Float(x),
                    y: Float(y),
                    t: t,
                    w: w != nil ? Float(w!) : nil
                ))
            }

            if points.isEmpty {
                continue
            }

            replayStrokes.append(ReplayStroke(
                id: id,
                emoji: emoji,
                size: Float(size),
                opacity: Float(opacity),
                spacing: Float(spacing),
                stampSpan: Float(stampSpan),
                points: points,
                emojiSequence: emojiSequence,
                mirrorX: mirrorX,
                mirrorY: mirrorY,
                rotation: Float(rotation),
                isEraser: isEraser,
                isPlane: isPlane,
                planeCorners: planeCorners,
                planeCornerHistory: planeCornerHistory,
                planeTimestamps: planeTimestamps,
                isSmudge: isSmudge,
                bakedTile: bakedTile,
                bakedBounds: bakedBounds
            ))
        }

        return replayStrokes
    }

    /// Setup AVAssetWriter for WebM export with alpha channel
    private func setupWebMWriter(
        outputPath: String,
        width: Int,
        height: Int,
        fps: Int
    ) throws -> (writer: AVAssetWriter, input: AVAssetWriterInput, adaptor: AVAssetWriterInputPixelBufferAdaptor) {
        // Convert to proper file URL
        let fileURL = fileURL(from: outputPath)
        let parentDirectory = fileURL.deletingLastPathComponent()

        NSLog("[TimelapseExporter] WebM file URL: \(fileURL.path)")
        NSLog("[TimelapseExporter] Parent directory: \(parentDirectory.path)")

        // Ensure parent directory exists
        if !FileManager.default.fileExists(atPath: parentDirectory.path) {
            try FileManager.default.createDirectory(at: parentDirectory, withIntermediateDirectories: true, attributes: nil)
            NSLog("[TimelapseExporter] Created directory: \(parentDirectory.path)")
        }

        // Delete existing file
        try? FileManager.default.removeItem(at: fileURL)

        // Create asset writer - use .mov for HEVC with alpha
        let writer = try AVAssetWriter(url: fileURL, fileType: .mov)

        // HEVC with alpha channel for transparency
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.hevcWithAlpha,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: width * height * 4, // Higher bitrate for alpha
                AVVideoMaxKeyFrameIntervalKey: fps * 2
            ]
        ]

        let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        input.expectsMediaDataInRealTime = false

        // Pixel buffer adaptor with alpha support and Metal compatibility
        let sourcePixelBufferAttributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ]

        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: sourcePixelBufferAttributes
        )

        guard writer.canAdd(input) else {
            throw NSError(domain: "TimelapseExporter", code: 12, userInfo: [NSLocalizedDescriptionKey: "Cannot add input to writer"])
        }

        writer.add(input)

        guard writer.startWriting() else {
            throw NSError(domain: "TimelapseExporter", code: 13, userInfo: [NSLocalizedDescriptionKey: "Failed to start writing: \(writer.error?.localizedDescription ?? "unknown")"])
        }

        writer.startSession(atSourceTime: .zero)

        return (writer, input, adaptor)
    }

    /// Setup AVAssetWriter for MP4 export
    private func setupVideoWriter(
        outputPath: String,
        width: Int,
        height: Int,
        fps: Int
    ) throws -> (writer: AVAssetWriter, input: AVAssetWriterInput, adaptor: AVAssetWriterInputPixelBufferAdaptor) {
        // Convert to proper file URL
        let fileURL = fileURL(from: outputPath)
        let parentDirectory = fileURL.deletingLastPathComponent()

        NSLog("[TimelapseExporter] MP4 file URL: \(fileURL.path)")
        NSLog("[TimelapseExporter] Parent directory: \(parentDirectory.path)")

        // Ensure parent directory exists
        if !FileManager.default.fileExists(atPath: parentDirectory.path) {
            try FileManager.default.createDirectory(at: parentDirectory, withIntermediateDirectories: true, attributes: nil)
            NSLog("[TimelapseExporter] Created directory: \(parentDirectory.path)")
        }

        // Delete existing file
        try? FileManager.default.removeItem(at: fileURL)

        // Create asset writer
        let writer = try AVAssetWriter(url: fileURL, fileType: .mp4)

        // Video settings
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: width * height * 3,
                AVVideoMaxKeyFrameIntervalKey: fps * 2
            ]
        ]

        let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        input.expectsMediaDataInRealTime = false

        // Pixel buffer adaptor with proper attributes for Metal rendering
        let sourcePixelBufferAttributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any]
        ]

        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: sourcePixelBufferAttributes
        )

        guard writer.canAdd(input) else {
            throw NSError(domain: "TimelapseExporter", code: 12, userInfo: [NSLocalizedDescriptionKey: "Cannot add input to writer"])
        }

        writer.add(input)

        guard writer.startWriting() else {
            throw NSError(domain: "TimelapseExporter", code: 13, userInfo: [NSLocalizedDescriptionKey: "Failed to start writing: \(writer.error?.localizedDescription ?? "unknown")"])
        }

        writer.startSession(atSourceTime: .zero)

        return (writer, input, adaptor)
    }

    // MARK: - Deterministic Vector Mode export

    /// Render a Vector document directly on the native Metal path. The camera
    /// samples are deliberately supplied as plain values so the JS timeline
    /// evaluator and the interactive preview share exactly the same easing,
    /// while frame rendering never depends on React or ReplayKit.
    @objc
    func exportVectorFlythrough(
        _ strokes: NSArray,
        cameras: NSArray,
        width: NSNumber,
        height: NSNumber,
        fps: NSNumber,
        outputPath: NSString,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        if exportInProgress {
            reject("EXPORT_IN_PROGRESS", "Another export is already in progress", nil)
            return
        }
        guard let device = device, let commandQueue = commandQueue else {
            reject("METAL_ERROR", "Metal not initialized", nil)
            return
        }
        exportInProgress = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("EXPORT_ERROR", "Module deallocated", nil)
                return
            }
            do {
                let result = try self.performVectorExport(
                    strokes: (strokes as? [[String: Any]]) ?? [],
                    cameras: (cameras as? [[String: Any]]) ?? [],
                    width: width.intValue,
                    height: height.intValue,
                    fps: fps.intValue,
                    outputPath: outputPath as String,
                    device: device,
                    commandQueue: commandQueue
                )
                self.exportInProgress = false
                resolve(result)
            } catch {
                self.exportInProgress = false
                reject("EXPORT_ERROR", "Vector export failed: \(error.localizedDescription)", error)
            }
        }
    }

    private func performVectorExport(
        strokes: [[String: Any]],
        cameras: [[String: Any]],
        width: Int,
        height: Int,
        fps: Int,
        outputPath: String,
        device: MTLDevice,
        commandQueue: MTLCommandQueue
    ) throws -> [String: Any] {
        guard !cameras.isEmpty else {
            throw NSError(domain: "TimelapseExporter", code: 40, userInfo: [NSLocalizedDescriptionKey: "Vector export has no camera frames"])
        }
        let parsedStrokes = try parseStrokes(strokes)
        let outputWidth = max(2, width - (width % 2))
        let outputHeight = max(2, height - (height % 2))
        if parsedStrokes.contains(where: { $0.isSmudge || $0.isPlane }) {
            throw NSError(domain: "TimelapseExporter", code: 41, userInfo: [NSLocalizedDescriptionKey: "Vector export contains an unsupported smudge or plane stroke"])
        }
        let parsedCameras: [VectorCameraFrame] = cameras.compactMap { item in
            guard let cx = item["cx"] as? Double,
                  let cy = item["cy"] as? Double,
                  let zoom = item["zoom"] as? Double,
                  cx.isFinite, cy.isFinite, zoom.isFinite, zoom > 0 else { return nil }
            let floatCX = Float(cx)
            let floatCY = Float(cy)
            let floatZoom = Float(zoom)
            guard floatCX.isFinite, floatCY.isFinite, floatZoom.isFinite, floatZoom > 0 else { return nil }
            return VectorCameraFrame(cx: floatCX, cy: floatCY, zoom: floatZoom)
        }
        guard !parsedCameras.isEmpty else {
            throw NSError(domain: "TimelapseExporter", code: 42, userInfo: [NSLocalizedDescriptionKey: "Vector export camera data is invalid"])
        }
        guard let replayEngine = StrokeReplayEngine(
            device: device,
            commandQueue: commandQueue,
            width: outputWidth,
            height: outputHeight
        ) else {
            throw NSError(domain: "TimelapseExporter", code: 43, userInfo: [NSLocalizedDescriptionKey: "Failed to create Vector replay engine"])
        }

        let writer = try setupVideoWriter(outputPath: outputPath, width: outputWidth, height: outputHeight, fps: max(1, fps))
        let background = MTLClearColor(red: 0.063, green: 0.063, blue: 0.078, alpha: 1)
        let startTime = Date()
        for (index, camera) in parsedCameras.enumerated() {
            if cancelRequested {
                cancelRequested = false
                throw NSError(domain: "TimelapseExporter", code: 999, userInfo: [NSLocalizedDescriptionKey: "Export cancelled by user"])
            }
            guard let pool = writer.adaptor.pixelBufferPool else {
                throw NSError(domain: "TimelapseExporter", code: 44, userInfo: [NSLocalizedDescriptionKey: "Vector pixel buffer pool is nil"])
            }
            var pixelBuffer: CVPixelBuffer?
            let status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer)
            guard status == kCVReturnSuccess, let pixelBuffer else {
                throw NSError(domain: "TimelapseExporter", code: 45, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate Vector video frame"])
            }
            guard replayEngine.renderVectorFrameToPixelBuffer(
                strokes: parsedStrokes,
                camera: camera,
                pixelBuffer: pixelBuffer,
                backgroundColor: background
            ) else {
                throw NSError(domain: "TimelapseExporter", code: 46, userInfo: [NSLocalizedDescriptionKey: "Failed to render Vector frame \(index)"])
            }
            while !writer.input.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.005)
            }
            let presentationTime = CMTime(value: Int64(index), timescale: Int32(max(1, fps)))
            guard writer.adaptor.append(pixelBuffer, withPresentationTime: presentationTime) else {
                throw NSError(domain: "TimelapseExporter", code: 47, userInfo: [NSLocalizedDescriptionKey: "Failed to append Vector frame \(index)"])
            }
            sendProgress(current: index + 1, total: parsedCameras.count)
        }
        try finalizeVideo(writer)
        let durationMs = Int(Date().timeIntervalSince(startTime) * 1000)
        return [
            "success": true,
            "outputPath": outputPath,
            "frameCount": parsedCameras.count,
            "durationMs": durationMs,
            "fps": max(1, fps),
            "width": outputWidth,
            "height": outputHeight,
        ]
    }

    // Old CPU-based methods removed - now using GPU-only zero-copy rendering

    /// Finalize video export
    private func finalizeVideo(_ writer: (writer: AVAssetWriter, input: AVAssetWriterInput, adaptor: AVAssetWriterInputPixelBufferAdaptor)) throws {
        writer.input.markAsFinished()

        let semaphore = DispatchSemaphore(value: 0)
        var finishError: Error?

        writer.writer.finishWriting {
            if writer.writer.status == .failed {
                finishError = writer.writer.error
            }
            semaphore.signal()
        }

        semaphore.wait()

        if let error = finishError {
            throw error
        }

        if writer.writer.status != .completed {
            throw NSError(domain: "TimelapseExporter", code: 7, userInfo: [NSLocalizedDescriptionKey: "Video writing did not complete"])
        }
    }

    // MARK: - Frame-by-frame ANIMATION export (Animator)
    //
    // Unlike timelapse (ONE stroke set replayed over time), the Animator has a
    // DISTINCT stroke set per frame. This renders every frame's FULL stroke set
    // on the GPU via StrokeReplayEngine (same fast path as timelapse; smudge via
    // bakedTile) and encodes to MP4/GIF natively — no per-frame JS round-trips,
    // no PNG base64/disk I/O, no CPU Skia. This is what makes it fast.
    @objc
    func exportAnimationFrames(
        _ frames: NSArray,          // [[[String:Any]]] — ordered frames, each = pre-scaled stroke dicts
        width: NSNumber,
        height: NSNumber,
        fps: NSNumber,
        format: NSString,           // "mov" | "gif"
        outputPath: NSString,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        if exportInProgress {
            reject("EXPORT_IN_PROGRESS", "Another export is already in progress", nil)
            return
        }
        guard let device = device, let commandQueue = commandQueue else {
            reject("METAL_ERROR", "Metal not initialized", nil)
            return
        }
        exportInProgress = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("EXPORT_ERROR", "Module deallocated", nil)
                return
            }
            do {
                let result = try self.performAnimationExport(
                    frames: (frames as? [[[String: Any]]]) ?? [],
                    width: width.intValue,
                    height: height.intValue,
                    fps: fps.intValue,
                    format: (format as String).lowercased(),
                    outputPath: outputPath as String,
                    device: device,
                    commandQueue: commandQueue
                )
                self.exportInProgress = false
                resolve(result)
            } catch {
                self.exportInProgress = false
                reject("EXPORT_ERROR", "Animation export failed: \(error.localizedDescription)", error)
            }
        }
    }

    private func performAnimationExport(
        frames: [[[String: Any]]],
        width: Int,
        height: Int,
        fps: Int,
        format: String,
        outputPath: String,
        device: MTLDevice,
        commandQueue: MTLCommandQueue
    ) throws -> [String: Any] {
        guard !frames.isEmpty else {
            throw NSError(domain: "TimelapseExporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "No frames to export"])
        }
        NSLog("[TimelapseExporter] Animation export: \(frames.count) frames \(width)x\(height) @\(fps)fps → \(format)")

        // Keep the app alive during the export.
        var backgroundTask: UIBackgroundTaskIdentifier = .invalid
        backgroundTask = UIApplication.shared.beginBackgroundTask {
            if backgroundTask != .invalid {
                UIApplication.shared.endBackgroundTask(backgroundTask)
                backgroundTask = .invalid
            }
        }
        defer {
            if backgroundTask != .invalid {
                UIApplication.shared.endBackgroundTask(backgroundTask)
            }
        }

        guard let replayEngine = StrokeReplayEngine(
            device: device,
            commandQueue: commandQueue,
            width: width,
            height: height
        ) else {
            throw NSError(domain: "TimelapseExporter", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create replay engine"])
        }

        // Parse each frame's strokes once. Render ALL strokes of a frame by
        // asking the engine for a very large upToTime (draws every point).
        let parsedFrames: [[ReplayStroke]] = try frames.map { try parseStrokes($0) }
        let frameCount = parsedFrames.count
        let renderAllTime = Double.greatestFiniteMagnitude
        let startTime = Date()

        if format == "gif" {
            let fileURL = fileURL(from: outputPath)
            try? FileManager.default.removeItem(at: fileURL)
            let frameDelay = 1.0 / Double(max(1, fps))
            let gifType = "com.compuserve.gif" as CFString
            guard let dest = CGImageDestinationCreateWithURL(fileURL as CFURL, gifType, frameCount, nil) else {
                throw NSError(domain: "TimelapseExporter", code: 20, userInfo: [NSLocalizedDescriptionKey: "Failed to create GIF destination"])
            }
            let gifProps: [String: Any] = [kCGImagePropertyGIFDictionary as String: [kCGImagePropertyGIFLoopCount as String: 0]]
            CGImageDestinationSetProperties(dest, gifProps as CFDictionary)
            let frameProps: [String: Any] = [kCGImagePropertyGIFDictionary as String: [kCGImagePropertyGIFDelayTime as String: frameDelay]]
            let whiteBg = MTLClearColor(red: 1, green: 1, blue: 1, alpha: 1)
            for (i, strokes) in parsedFrames.enumerated() {
                if cancelRequested {
                    cancelRequested = false
                    throw NSError(domain: "TimelapseExporter", code: 999, userInfo: [NSLocalizedDescriptionKey: "Export cancelled by user"])
                }
                guard let img = replayEngine.renderFrame(strokes: strokes, upToTime: renderAllTime, backgroundColor: whiteBg),
                      let cg = img.cgImage else {
                    throw NSError(domain: "TimelapseExporter", code: 21, userInfo: [NSLocalizedDescriptionKey: "Failed to render GIF frame \(i)"])
                }
                CGImageDestinationAddImage(dest, cg, frameProps as CFDictionary)
                sendProgress(current: i + 1, total: frameCount)
            }
            guard CGImageDestinationFinalize(dest) else {
                throw NSError(domain: "TimelapseExporter", code: 22, userInfo: [NSLocalizedDescriptionKey: "Failed to finalize GIF"])
            }
            let dur = Date().timeIntervalSince(startTime)
            NSLog("[TimelapseExporter] Animation GIF done in \(dur)s (\(String(format: "%.1f", Double(frameCount)/max(dur, 0.001))) fps)")
            return ["success": true, "outputPath": fileURL.path, "frameCount": frameCount, "durationMs": Int(dur * 1000), "fps": fps, "width": width, "height": height]
        }

        // MOV (H.264) — zero-copy GPU render straight into the writer's pixel buffers.
        let videoWriter = try setupVideoWriter(outputPath: outputPath, width: width, height: height, fps: fps)
        let blackBg = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        for (i, strokes) in parsedFrames.enumerated() {
            if cancelRequested {
                cancelRequested = false
                throw NSError(domain: "TimelapseExporter", code: 999, userInfo: [NSLocalizedDescriptionKey: "Export cancelled by user"])
            }
            guard let pool = videoWriter.adaptor.pixelBufferPool else {
                throw NSError(domain: "TimelapseExporter", code: 14, userInfo: [NSLocalizedDescriptionKey: "Pixel buffer pool is nil"])
            }
            var pixelBuffer: CVPixelBuffer?
            let r = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer)
            guard r == kCVReturnSuccess, let pb = pixelBuffer else {
                throw NSError(domain: "TimelapseExporter", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to get pixel buffer (\(r))"])
            }
            guard replayEngine.renderFrameToPixelBuffer(strokes: strokes, upToTime: renderAllTime, pixelBuffer: pb, backgroundColor: blackBg) else {
                throw NSError(domain: "TimelapseExporter", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to render frame \(i)"])
            }
            let pt = CMTime(value: Int64(i), timescale: Int32(max(1, fps)))
            while !videoWriter.input.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.01)
            }
            guard videoWriter.adaptor.append(pb, withPresentationTime: pt) else {
                throw NSError(domain: "TimelapseExporter", code: 6, userInfo: [NSLocalizedDescriptionKey: "Failed to append frame \(i)"])
            }
            sendProgress(current: i + 1, total: frameCount)
        }
        try finalizeVideo(videoWriter)
        let dur = Date().timeIntervalSince(startTime)
        NSLog("[TimelapseExporter] Animation MOV done in \(dur)s (\(String(format: "%.1f", Double(frameCount)/max(dur, 0.001))) fps)")
        return ["success": true, "outputPath": outputPath, "frameCount": frameCount, "durationMs": Int(dur * 1000), "fps": fps, "width": width, "height": height]
    }

    /// Cancel ongoing export
    @objc
    func cancelExport() {
        NSLog("[TimelapseExporter] Cancel requested")
        cancelRequested = true
    }
}
