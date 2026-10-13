import React
import Foundation
import AVFoundation
import Metal
import MetalKit
import CoreMedia
import UniformTypeIdentifiers

@objc(MP4ExporterModule)
class MP4ExporterModule: NSObject {
    private var device: MTLDevice?
    private var commandQueue: MTLCommandQueue?
    private let lock = NSLock()

    override init() {
        super.init()
        setupMetal()
    }

    private func setupMetal() {
        guard let device = MTLCreateSystemDefaultDevice() else {
            NSLog("[MP4ExporterModule] Failed to create Metal device")
            return
        }

        self.device = device
        self.commandQueue = device.makeCommandQueue()

        NSLog("[MP4ExporterModule] Metal setup complete")
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    func exportMP4(_ frames: NSArray,
                   outputPath: NSString,
                   width: NSNumber,
                   height: NSNumber,
                   fps: NSNumber,
                   resolve: @escaping RCTPromiseResolveBlock,
                   reject: @escaping RCTPromiseRejectBlock) {
        lock.lock()
        defer { lock.unlock() }

        let path = outputPath as String
        let videoWidth = width.intValue
        let videoHeight = height.intValue
        let framesPerSecond = fps.intValue

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("EXPORT_ERROR", "Module deallocated", nil)
                return
            }

            do {
                try self.createVideo(frames: frames as! [[String: Any]],
                                   outputPath: path,
                                   width: videoWidth,
                                   height: videoHeight,
                                   fps: framesPerSecond)

                NSLog("[MP4ExporterModule] Export complete: \(path)")
                resolve(path)
            } catch {
                NSLog("[MP4ExporterModule] Export failed: \(error)")
                reject("EXPORT_ERROR", "Failed to export MP4: \(error.localizedDescription)", error)
            }
        }
    }

    private func createVideo(frames: [[String: Any]], outputPath: String, width: Int, height: Int, fps: Int) throws {
        let outputURL = URL(fileURLWithPath: outputPath)

        // Remove existing file
        try? FileManager.default.removeItem(at: outputURL)

        // Create asset writer
        let assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: width * height * 8,  // Reduced from 10 to 8 (25.6 Mbps max at 1280px)
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoMaxKeyFrameIntervalKey: fps * 2
            ]
        ]

        var assetWriterInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        assetWriterInput.expectsMediaDataInRealTime = false

        let sourcePixelBufferAttributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferMetalCompatibilityKey as String: true
        ]

        let pixelBufferAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: assetWriterInput,
            sourcePixelBufferAttributes: sourcePixelBufferAttributes
        )

        if !assetWriter.canAdd(assetWriterInput) {
            NSLog("[MP4ExporterModule] H.264 HighAuto failed, trying ultra-conservative fallback")

            // FALLBACK: Try ultra-conservative H.264 settings
            let conservativeBitrate = min(500_000, width * height) // Ultra-low bitrate
            var fallbackSettings = videoSettings
            fallbackSettings[AVVideoCompressionPropertiesKey] = [
                AVVideoAverageBitRateKey: conservativeBitrate,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264Baseline30,
                AVVideoMaxKeyFrameIntervalKey: fps
            ]

            let fallbackInput = AVAssetWriterInput(mediaType: .video, outputSettings: fallbackSettings)
            fallbackInput.expectsMediaDataInRealTime = false

            guard assetWriter.canAdd(fallbackInput) else {
                throw NSError(domain: "MP4ExporterModule", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot add input to asset writer - device may not support this resolution"])
            }

            // Use fallback input instead
            assetWriterInput = fallbackInput
            NSLog("[MP4ExporterModule] ✅ Fallback H.264 accepted")
        }

        assetWriter.add(assetWriterInput)

        // Start writing
        guard assetWriter.startWriting() else {
            throw NSError(domain: "MP4ExporterModule", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to start writing"])
        }

        assetWriter.startSession(atSourceTime: .zero)

        var frameIndex = 0
        let frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))

        let dispatchGroup = DispatchGroup()
        dispatchGroup.enter()

        assetWriterInput.requestMediaDataWhenReady(on: DispatchQueue.global(qos: .userInitiated)) {
            while assetWriterInput.isReadyForMoreMediaData && frameIndex < frames.count {
                let frameTime = CMTimeMultiply(frameDuration, multiplier: Int32(frameIndex))
                let frame = frames[frameIndex]

                if let pixelBuffer = self.createPixelBuffer(from: frame, width: width, height: height) {
                    pixelBufferAdaptor.append(pixelBuffer, withPresentationTime: frameTime)
                } else {
                    NSLog("[MP4ExporterModule] Failed to create pixel buffer for frame \(frameIndex)")
                }

                frameIndex += 1
            }

            if frameIndex >= frames.count {
                assetWriterInput.markAsFinished()
                // Close the final frame's interval explicitly. Without this,
                // short exports can report only the last presentation timestamp
                // (for example 29/30s for 30 frames) instead of their full duration.
                let endTime = CMTimeMultiply(frameDuration, multiplier: Int32(frames.count))
                assetWriter.endSession(atSourceTime: endTime)
                assetWriter.finishWriting {
                    dispatchGroup.leave()
                }
            }
        }

        dispatchGroup.wait()

        if assetWriter.status != .completed {
            throw assetWriter.error ?? NSError(domain: "MP4ExporterModule", code: 3, userInfo: [NSLocalizedDescriptionKey: "Writer failed"])
        }
    }

    private func createPixelBuffer(from frame: [String: Any], width: Int, height: Int) -> CVPixelBuffer? {
        var pixelBuffer: CVPixelBuffer?

        let options: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
            kCVPixelBufferMetalCompatibilityKey: true
        ]

        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            options as CFDictionary,
            &pixelBuffer
        )

        guard status == kCVReturnSuccess, let buffer = pixelBuffer else {
            return nil
        }

        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

        guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else {
            return nil
        }

        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue)
            .union(.byteOrder32Little)

        guard let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: bitmapInfo.rawValue
        ) else {
            return nil
        }

        // Clear to white
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))

        // Render frame content
        renderFrame(frame, to: context, width: width, height: height)

        return buffer
    }

    private func renderFrame(_ frame: [String: Any], to context: CGContext, width: Int, height: Int) {
        // Render strokes
        if let strokes = frame["strokes"] as? [[String: Any]] {
            for stroke in strokes {
                renderStroke(stroke, to: context, width: width, height: height)
            }
        }
    }

    private func renderStroke(_ stroke: [String: Any], to context: CGContext, width: Int, height: Int) {
        let type = stroke["type"] as? String ?? "line"

        if type == "emoji", let emoji = stroke["emoji"] as? String {
            // Render emoji
            guard let points = stroke["points"] as? [[String: Any]],
                  let firstPoint = points.first,
                  let x = firstPoint["x"] as? Double,
                  let y = firstPoint["y"] as? Double else {
                return
            }

            let size = CGFloat(stroke["size"] as? Double ?? 40)
            renderEmoji(emoji, at: CGPoint(x: x, y: y), size: size, to: context)
        } else {
            // Render line
            guard let points = stroke["points"] as? [[String: Any]], points.count > 1 else {
                return
            }

            let color = stroke["color"] as? String ?? "#000000"
            let size = CGFloat(stroke["size"] as? Double ?? 2)

            context.setStrokeColor(hexToColor(color).cgColor)
            context.setLineWidth(size)
            context.setLineCap(.round)
            context.setLineJoin(.round)

            context.beginPath()

            if let firstPoint = points.first,
               let x = firstPoint["x"] as? Double,
               let y = firstPoint["y"] as? Double {
                context.move(to: CGPoint(x: x, y: y))
            }

            for point in points.dropFirst() {
                guard let x = point["x"] as? Double,
                      let y = point["y"] as? Double else {
                    continue
                }
                context.addLine(to: CGPoint(x: x, y: y))
            }

            context.strokePath()
        }
    }

    private func renderEmoji(_ emoji: String, at point: CGPoint, size: CGFloat, to context: CGContext) {
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .center

        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: size * 0.8),
            .paragraphStyle: paragraphStyle
        ]

        let rect = CGRect(x: point.x - size / 2, y: point.y - size / 2, width: size, height: size)

        // Save context state
        context.saveGState()

        // Flip coordinate system for text rendering
        context.translateBy(x: 0, y: rect.origin.y + rect.size.height)
        context.scaleBy(x: 1.0, y: -1.0)

        let textRect = CGRect(x: rect.origin.x, y: 0, width: rect.size.width, height: rect.size.height)
        emoji.draw(in: textRect, withAttributes: attributes)

        context.restoreGState()
    }

    private func hexToColor(_ hex: String) -> UIColor {
        var hexString = hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()

        if hexString.hasPrefix("#") {
            hexString.remove(at: hexString.startIndex)
        }

        var rgba: UInt64 = 0
        Scanner(string: hexString).scanHexInt64(&rgba)

        let r, g, b, a: CGFloat
        if hexString.count == 8 {
            r = CGFloat((rgba & 0xFF000000) >> 24) / 255.0
            g = CGFloat((rgba & 0x00FF0000) >> 16) / 255.0
            b = CGFloat((rgba & 0x0000FF00) >> 8) / 255.0
            a = CGFloat(rgba & 0x000000FF) / 255.0
        } else {
            r = CGFloat((rgba & 0xFF0000) >> 16) / 255.0
            g = CGFloat((rgba & 0x00FF00) >> 8) / 255.0
            b = CGFloat(rgba & 0x0000FF) / 255.0
            a = 1.0
        }

        return UIColor(red: r, green: g, blue: b, alpha: a)
    }

    // MARK: - Frame-based export methods

    @objc
    func exportMp4FromFrames(_ framePaths: NSArray,
                            destinationPath: NSString,
                            width: NSNumber,
                            height: NSNumber,
                            fps: NSNumber,
                            resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) {
        let paths = framePaths as! [String]
        let outputPath = destinationPath as String
        let videoWidth = width.intValue
        let videoHeight = height.intValue
        let framesPerSecond = fps.intValue

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("EXPORT_ERROR", "Module deallocated", nil)
                return
            }

            do {
                try self.createVideoFromImages(framePaths: paths,
                                             outputPath: outputPath,
                                             width: videoWidth,
                                             height: videoHeight,
                                             fps: framesPerSecond)

                NSLog("[MP4ExporterModule] MP4 export complete: \(outputPath)")
                resolve(outputPath)
            } catch {
                NSLog("[MP4ExporterModule] MP4 export failed: \(error)")
                reject("EXPORT_ERROR", "Failed to export MP4: \(error.localizedDescription)", error)
            }
        }
    }

    @objc
    func exportGifFromFrames(_ framePaths: NSArray,
                            delays: NSArray,
                            destinationPath: NSString,
                            width: NSNumber,
                            height: NSNumber,
                            loopCount: NSNumber,
                            resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) {
        let paths = framePaths as! [String]
        let frameDelays = delays as! [Double]
        let outputPath = destinationPath as String
        let gifWidth = width.intValue
        let gifHeight = height.intValue
        let loops = loopCount.intValue

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("EXPORT_ERROR", "Module deallocated", nil)
                return
            }

            do {
                try self.createGifFromImages(framePaths: paths,
                                           delays: frameDelays,
                                           outputPath: outputPath,
                                           width: gifWidth,
                                           height: gifHeight,
                                           loopCount: loops)

                NSLog("[MP4ExporterModule] GIF export complete: \(outputPath)")
                resolve(outputPath)
            } catch {
                NSLog("[MP4ExporterModule] GIF export failed: \(error)")
                reject("EXPORT_ERROR", "Failed to export GIF: \(error.localizedDescription)", error)
            }
        }
    }

    private func createVideoFromImages(framePaths: [String], outputPath: String, width: Int, height: Int, fps: Int) throws {
        let outputURL = URL(fileURLWithPath: outputPath)

        // Parent directory should already exist (created by JS layer)
        // Remove existing file if present
        try? FileManager.default.removeItem(at: outputURL)

        // H.264 encoder requires dimensions to be multiples of 2 (preferably 16)
        let evenWidth = (width % 2 == 0) ? width : width - 1
        let evenHeight = (height % 2 == 0) ? height : height - 1

        NSLog("[MP4ExporterModule] Adjusted dimensions from \(width)x\(height) to \(evenWidth)x\(evenHeight)")

        // Create asset writer
        let assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

        // Try HEVC with alpha first for transparency, fallback to H.264
        NSLog("[MP4ExporterModule] 🎬 Starting video export at \(evenWidth)x\(evenHeight)")
        NSLog("[MP4ExporterModule] 🎨 Attempting HEVC with Alpha for transparency support...")

        var videoCodec: AVVideoCodecType = .hevcWithAlpha
        // Calculate bitrate - use same formula as original but cap at safe maximum
        let calculatedBitrate = evenWidth * evenHeight * 8
        let maxBitrate = min(calculatedBitrate, 15_000_000)  // Cap at 15 Mbps for safety

        var videoSettings: [String: Any] = [
            AVVideoCodecKey: videoCodec,
            AVVideoWidthKey: evenWidth,
            AVVideoHeightKey: evenHeight,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: maxBitrate,
                AVVideoMaxKeyFrameIntervalKey: fps * 2
            ]
        ]

        NSLog("[MP4ExporterModule] 📊 Bitrate: \(maxBitrate) bits/sec (~\(Double(maxBitrate)/1_000_000.0) Mbps), calculated: \(calculatedBitrate)")

        let sourcePixelBufferAttributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: evenWidth,
            kCVPixelBufferHeightKey as String: evenHeight,
            kCVPixelBufferMetalCompatibilityKey as String: true
        ]

        NSLog("[MP4ExporterModule] 📊 Pixel format: kCVPixelFormatType_32BGRA (supports alpha)")

        // Try HEVC with alpha first
        var assetWriterInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        assetWriterInput.expectsMediaDataInRealTime = false

        // If HEVC with alpha is not supported, fallback to H.264
        if !assetWriter.canAdd(assetWriterInput) {
            NSLog("[MP4ExporterModule] ⚠️ HEVC with alpha NOT supported on this device")
            NSLog("[MP4ExporterModule] 🔄 Falling back to H.264 (no transparency)")
            videoCodec = .h264

            // Update H.264 settings with proper profile level for compatibility
            var h264Settings = videoSettings
            h264Settings[AVVideoCodecKey] = videoCodec
            h264Settings[AVVideoCompressionPropertiesKey] = [
                AVVideoAverageBitRateKey: maxBitrate,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264Main31,  // Widely supported on iPhone
                AVVideoMaxKeyFrameIntervalKey: fps * 2
            ]
            NSLog("[MP4ExporterModule] H.264 fallback bitrate: \(maxBitrate) bits/sec (~\(Double(maxBitrate)/1_000_000.0) Mbps)")

            assetWriterInput = AVAssetWriterInput(mediaType: .video, outputSettings: h264Settings)
            assetWriterInput.expectsMediaDataInRealTime = false

            if !assetWriter.canAdd(assetWriterInput) {
                NSLog("[MP4ExporterModule] ❌ Both HEVC and H.264 failed with bitrate=\(maxBitrate)!")
                NSLog("[MP4ExporterModule] Attempting ultra-conservative fallback with reduced bitrate...")

                // FALLBACK: Try H.264 with ULTRA-CONSERVATIVE bitrate
                let conservativeBitrate = min(1_000_000, evenWidth * evenHeight) // Ultra-low for compatibility
                NSLog("[MP4ExporterModule] Ultra-conservative bitrate: \(conservativeBitrate) bits/sec (~\(Double(conservativeBitrate)/1_000_000.0) Mbps)")

                var conservativeSettings = videoSettings
                conservativeSettings[AVVideoCodecKey] = AVVideoCodecType.h264.rawValue
                conservativeSettings[AVVideoCompressionPropertiesKey] = [
                    AVVideoAverageBitRateKey: conservativeBitrate,
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264Baseline30,  // Most compatible
                    AVVideoMaxKeyFrameIntervalKey: fps
                ]

                let conservativeInput = AVAssetWriterInput(mediaType: .video, outputSettings: conservativeSettings)
                conservativeInput.expectsMediaDataInRealTime = false

                guard assetWriter.canAdd(conservativeInput) else {
                    NSLog("[MP4ExporterModule] ❌ All codecs and bitrates failed!")
                    NSLog("[MP4ExporterModule] Settings used: width=\(evenWidth) height=\(evenHeight) bitrate=\(maxBitrate)→\(conservativeBitrate)")
                    throw NSError(domain: "MP4ExporterModule", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot add input with any codec or bitrate - device may not support this resolution or frame rate"])
                }
                assetWriterInput = conservativeInput
                NSLog("[MP4ExporterModule] ✅ Ultra-conservative H.264 settings accepted!")
            }
        } else {
            NSLog("[MP4ExporterModule] ✅ HEVC with Alpha ENABLED - Transparency will be preserved!")
        }

        assetWriter.add(assetWriterInput)

        // Create pixel buffer adaptor AFTER adding input to avoid mismatch
        let pixelBufferAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: assetWriterInput,
            sourcePixelBufferAttributes: sourcePixelBufferAttributes
        )

        guard assetWriter.startWriting() else {
            throw NSError(domain: "MP4ExporterModule", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to start writing"])
        }

        assetWriter.startSession(atSourceTime: .zero)

        var frameIndex = 0
        let frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))

        NSLog("[MP4ExporterModule] Starting to write \(framePaths.count) frames at \(fps) FPS")

        let dispatchGroup = DispatchGroup()
        dispatchGroup.enter()

        assetWriterInput.requestMediaDataWhenReady(on: DispatchQueue.global(qos: .userInitiated)) {
            NSLog("[MP4ExporterModule] Media data is ready, processing frames...")
            while assetWriterInput.isReadyForMoreMediaData && frameIndex < framePaths.count {
                let frameTime = CMTimeMultiply(frameDuration, multiplier: Int32(frameIndex))
                let framePath = framePaths[frameIndex]

                if let pixelBuffer = self.loadImageAsPixelBuffer(path: framePath, width: evenWidth, height: evenHeight) {
                    pixelBufferAdaptor.append(pixelBuffer, withPresentationTime: frameTime)
                } else {
                    NSLog("[MP4ExporterModule] Failed to load frame: \(framePath)")
                }

                frameIndex += 1
            }

            if frameIndex >= framePaths.count {
                assetWriterInput.markAsFinished()
                // Include the complete display interval of the last frame so the
                // container always has a valid, non-zero frameCount/fps duration.
                let endTime = CMTimeMultiply(frameDuration, multiplier: Int32(framePaths.count))
                assetWriter.endSession(atSourceTime: endTime)
                assetWriter.finishWriting {
                    dispatchGroup.leave()
                }
            }
        }

        dispatchGroup.wait()

        if assetWriter.status != .completed {
            throw assetWriter.error ?? NSError(domain: "MP4ExporterModule", code: 3, userInfo: [NSLocalizedDescriptionKey: "Writer failed"])
        }

        NSLog("[MP4ExporterModule] ✅ Export complete with codec: \(videoCodec == .hevcWithAlpha ? "HEVC with Alpha (transparent)" : "H.264 (opaque)")")
    }

    private func createGifFromImages(framePaths: [String], delays: [Double], outputPath: String, width: Int, height: Int, loopCount: Int) throws {
        let outputURL = URL(fileURLWithPath: outputPath)

        // Parent directory should already exist (created by JS layer)
        // Remove existing file if present
        try? FileManager.default.removeItem(at: outputURL)

        let gifType: CFString
        if #available(iOS 14.0, *) {
            gifType = UTType.gif.identifier as CFString
        } else {
            gifType = "com.compuserve.gif" as CFString
        }

        guard let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, gifType, framePaths.count, nil) else {
            throw NSError(domain: "MP4ExporterModule", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to create GIF destination"])
        }

        // Set GIF properties
        let gifProperties: [CFString: Any] = [
            kCGImagePropertyGIFDictionary: [
                kCGImagePropertyGIFLoopCount: loopCount
            ]
        ]
        CGImageDestinationSetProperties(destination, gifProperties as CFDictionary)

        // Add frames
        for (index, framePath) in framePaths.enumerated() {
            guard let image = loadImage(path: framePath, targetWidth: width, targetHeight: height),
                  let cgImage = image.cgImage else {
                NSLog("[MP4ExporterModule] Failed to load frame: \(framePath)")
                continue
            }

            let delay = index < delays.count ? delays[index] / 1000.0 : 0.1
            let frameProperties: [CFString: Any] = [
                kCGImagePropertyGIFDictionary: [
                    kCGImagePropertyGIFDelayTime: delay
                ]
            ]

            CGImageDestinationAddImage(destination, cgImage, frameProperties as CFDictionary)
        }

        guard CGImageDestinationFinalize(destination) else {
            throw NSError(domain: "MP4ExporterModule", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to finalize GIF"])
        }
    }

    private func loadImageAsPixelBuffer(path: String, width: Int, height: Int) -> CVPixelBuffer? {
        NSLog("[MP4ExporterModule] Loading frame from: \(path)")
        guard let uiImage = loadImage(path: path, targetWidth: width, targetHeight: height) else {
            NSLog("[MP4ExporterModule] ❌ Failed to load image from: \(path)")
            return nil
        }
        NSLog("[MP4ExporterModule] ✓ Successfully loaded image, creating pixel buffer...")

        var pixelBuffer: CVPixelBuffer?
        let options: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
            kCVPixelBufferMetalCompatibilityKey: true
        ]

        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            options as CFDictionary,
            &pixelBuffer
        )

        guard status == kCVReturnSuccess, let buffer = pixelBuffer else {
            return nil
        }

        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

        guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else {
            return nil
        }

        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue)
            .union(.byteOrder32Little)

        guard let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: bitmapInfo.rawValue
        ) else {
            return nil
        }

        guard let cgImage = uiImage.cgImage else {
            return nil
        }

        // Check if source image has alpha
        let hasAlpha = cgImage.alphaInfo != .none && cgImage.alphaInfo != .noneSkipFirst && cgImage.alphaInfo != .noneSkipLast
        if hasAlpha {
            NSLog("[MP4ExporterModule] 🎨 Frame has alpha channel - transparency preserved")
        }

        // Fill with white background first (important for opaque video output)
        context.setFillColor(UIColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        NSLog("[MP4ExporterModule] ✓ Filled white background")

        // Draw image on top of white background
        NSLog("[MP4ExporterModule] Drawing image: \(width)x\(height), hasAlpha: \(hasAlpha)")
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        NSLog("[MP4ExporterModule] ✓ Image drawn successfully")

        return buffer
    }

    private func loadImage(path: String, targetWidth: Int, targetHeight: Int) -> UIImage? {
        guard let image = UIImage(contentsOfFile: path) else {
            return nil
        }

        // Resize if needed, preserving alpha channel (opaque: false)
        let size = CGSize(width: targetWidth, height: targetHeight)
        UIGraphicsBeginImageContextWithOptions(size, false, 1.0) // opaque: false preserves transparency
        image.draw(in: CGRect(origin: .zero, size: size))
        let resized = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()

        return resized
    }
}
