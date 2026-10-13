import React
import Foundation
import UIKit
import Metal
import MetalKit
import CoreVideo

/**
 * GPU-Accelerated Stroke Replay Engine
 * Renders strokes deterministically frame-by-frame using Metal
 * Zero-copy rendering directly into CVPixelBuffers for video export
 */

struct ReplayStrokePoint {
    let x: Float
    let y: Float
    let t: Double
    let w: Float? // Width at this point (optional for backward compatibility)
}

struct ReplayPlaneCorners {
    let topLeft: SIMD2<Float>
    let topRight: SIMD2<Float>
    let bottomRight: SIMD2<Float>
    let bottomLeft: SIMD2<Float>
}

struct ReplayStroke {
    let id: String
    let emoji: String
    let size: Float
    let opacity: Float
    let spacing: Float
    let stampSpan: Float
    let points: [ReplayStrokePoint]
    let emojiSequence: [String]?
    let mirrorX: Bool
    let mirrorY: Bool
    let rotation: Float
    let isEraser: Bool
    let isPlane: Bool
    let planeCorners: ReplayPlaneCorners?
    let planeCornerHistory: [ReplayPlaneCorners]? // Timeline of corner positions with timestamps
    let planeTimestamps: [Double]? // Corresponding timestamps for each corner snapshot
    // Smudge: baked result tile (base64 PNG) + its bounds in export px (x, y, w, h).
    var isSmudge: Bool = false
    var bakedTile: String? = nil
    var bakedBounds: SIMD4<Float>? = nil
}

/// Camera supplied by Vector Mode's deterministic fly-through exporter.
/// Coordinates remain in the document's world space until the native renderer
/// projects them into the output pixel buffer.
struct VectorCameraFrame {
    let cx: Float
    let cy: Float
    let zoom: Float
}

// Vertex structure for quad rendering (matches Metal shader struct)
struct QuadVertexData {
    var position: SIMD2<Float>
    var texCoord: SIMD2<Float>
}

class StrokeReplayEngine {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let emojiAtlas: EmojiAtlas
    private var renderPipelineState: MTLRenderPipelineState?
    private var eraserPipelineState: MTLRenderPipelineState?
    private var vertexBuffer: MTLBuffer?
    private var textureCache: CVMetalTextureCache?

    private let canvasWidth: Int
    private let canvasHeight: Int

    // Reusable render texture for non-video rendering
    private var canvasTexture: MTLTexture?

    // Debug logging counter
    private var renderStrokeCallCount = 0

    init?(device: MTLDevice, commandQueue: MTLCommandQueue, width: Int, height: Int) {
        self.device = device
        self.commandQueue = commandQueue
        self.canvasWidth = width
        self.canvasHeight = height

        // Initialize emoji atlas
        self.emojiAtlas = EmojiAtlas(device: device, commandQueue: commandQueue)

        // Setup Metal pipeline
        guard setupMetalPipeline() else {
            NSLog("[StrokeReplayEngine] Failed to setup Metal pipeline")
            return nil
        }

        // Create CVMetalTextureCache for zero-copy rendering
        var cache: CVMetalTextureCache?
        let result = CVMetalTextureCacheCreate(
            kCFAllocatorDefault,
            nil,
            device,
            nil,
            &cache
        )

        guard result == kCVReturnSuccess, let textureCache = cache else {
            NSLog("[StrokeReplayEngine] Failed to create CVMetalTextureCache")
            return nil
        }

        self.textureCache = textureCache

        // Create reusable canvas texture for preview rendering
        let textureDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm,
            width: width,
            height: height,
            mipmapped: false
        )
        textureDescriptor.usage = [.renderTarget, .shaderRead]
        textureDescriptor.storageMode = .private

        self.canvasTexture = device.makeTexture(descriptor: textureDescriptor)

        NSLog("[StrokeReplayEngine] Initialized (GPU-accelerated): \(width)x\(height)")
    }

    deinit {
        // CRITICAL FIX: Explicit cleanup of Metal resources to prevent memory leaks
        canvasTexture = nil
        textureCache = nil
        emojiAtlas.clearCaches()
        NSLog("[StrokeReplayEngine] Cleaned up Metal resources")
    }

    private func setupMetalPipeline() -> Bool {
        // Load shader library
        var library: MTLLibrary?
        // 1) Try default library (works when shaders are compiled into main bundle)
        library = device.makeDefaultLibrary()

        // 2) Try loading metallib from this module's (pod) bundle
        if library == nil {
            let bundle = Bundle(for: StrokeReplayEngine.self)
            if let url = bundle.url(forResource: "default", withExtension: "metallib") {
                do {
                    library = try device.makeLibrary(URL: url)
                } catch {
                    NSLog("[StrokeReplayEngine] Failed to load metallib from pod bundle: \(error)")
                }
            }
        }

        // 3) Try compile Shaders.metal from pod bundle at runtime
        if library == nil {
            let bundle = Bundle(for: StrokeReplayEngine.self)
            if let shaderURL = bundle.url(forResource: "Shaders", withExtension: "metal"),
               let source = try? String(contentsOf: shaderURL) {
                do {
                    // Let Metal pick the best languageVersion for the current toolchain
                    let options = MTLCompileOptions()
                    library = try device.makeLibrary(source: source, options: options)
                } catch {
                    NSLog("[StrokeReplayEngine] Runtime compile failed for Shaders.metal: \(error)")
                }
            } else {
                NSLog("[StrokeReplayEngine] Could not locate Shaders.metal in pod bundle")
            }
        }

        // 4) Final fallback: minimal inline shader to guarantee pipeline creation
        if library == nil {
            let inlineSource = """
            #include <metal_stdlib>
            using namespace metal;
            struct VSIn { float2 position [[attribute(0)]]; float2 uv [[attribute(1)]]; };
            struct VSOut { float4 position [[position]]; float2 uv; };
            vertex VSOut vertex_main(VSIn in [[stage_in]]) {
              VSOut out; out.position = float4(in.position, 0.0, 1.0); out.uv = in.uv; return out;
            }
            fragment float4 fragment_emoji_stamp(VSOut in [[stage_in]]) {
              // solid white for fallback
              return float4(1.0, 1.0, 1.0, 1.0);
            }
            """
            do {
                let options = MTLCompileOptions()
                library = try device.makeLibrary(source: inlineSource, options: options)
                NSLog("[StrokeReplayEngine] Using inline fallback shader library")
            } catch {
                NSLog("[StrokeReplayEngine] Failed to compile inline fallback shaders: \(error)")
            }
        }

        guard let library = library else {
            NSLog("[StrokeReplayEngine] Failed to create shader library")
            return false
        }

        guard let vertexFunction = library.makeFunction(name: "vertex_main"),
              let fragmentFunction = library.makeFunction(name: "fragment_emoji_stamp") else {
            NSLog("[StrokeReplayEngine] Failed to create shader functions")
            return false
        }

        // Create render pipeline
        let pipelineDescriptor = MTLRenderPipelineDescriptor()
        pipelineDescriptor.vertexFunction = vertexFunction
        pipelineDescriptor.fragmentFunction = fragmentFunction
        pipelineDescriptor.colorAttachments[0].pixelFormat = .bgra8Unorm

        // Enable alpha blending for proper compositing
        pipelineDescriptor.colorAttachments[0].isBlendingEnabled = true
        pipelineDescriptor.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        pipelineDescriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        pipelineDescriptor.colorAttachments[0].rgbBlendOperation = .add
        pipelineDescriptor.colorAttachments[0].sourceAlphaBlendFactor = .one
        pipelineDescriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        pipelineDescriptor.colorAttachments[0].alphaBlendOperation = .add

        do {
            renderPipelineState = try device.makeRenderPipelineState(descriptor: pipelineDescriptor)
        } catch {
            NSLog("[StrokeReplayEngine] Failed to create pipeline state: \(error)")
            return false
        }
        // Create eraser pipeline with zero destination blend mode for clearing/erasing
        let eraserPipelineDescriptor = MTLRenderPipelineDescriptor()
        eraserPipelineDescriptor.vertexFunction = vertexFunction
        eraserPipelineDescriptor.fragmentFunction = fragmentFunction
        eraserPipelineDescriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
        eraserPipelineDescriptor.colorAttachments[0].isBlendingEnabled = true
        // For eraser: zero out destination where source alpha is present
        eraserPipelineDescriptor.colorAttachments[0].sourceRGBBlendFactor = .zero
        eraserPipelineDescriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        eraserPipelineDescriptor.colorAttachments[0].rgbBlendOperation = .add
        eraserPipelineDescriptor.colorAttachments[0].sourceAlphaBlendFactor = .zero
        eraserPipelineDescriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        eraserPipelineDescriptor.colorAttachments[0].alphaBlendOperation = .add
        
        do {
            eraserPipelineState = try device.makeRenderPipelineState(descriptor: eraserPipelineDescriptor)
            NSLog("[StrokeReplayEngine] Created eraser pipeline state")
        } catch {
            NSLog("[StrokeReplayEngine] Failed to create eraser pipeline state: \(error)")
            return false
        }

        // Create vertex buffer for full-screen quad
        let vertices: [QuadVertexData] = [
            QuadVertexData(position: SIMD2<Float>(-1, -1), texCoord: SIMD2<Float>(0, 1)),
            QuadVertexData(position: SIMD2<Float>( 1, -1), texCoord: SIMD2<Float>(1, 1)),
            QuadVertexData(position: SIMD2<Float>(-1,  1), texCoord: SIMD2<Float>(0, 0)),
            QuadVertexData(position: SIMD2<Float>( 1,  1), texCoord: SIMD2<Float>(1, 0))
        ]

        vertexBuffer = device.makeBuffer(bytes: vertices, length: MemoryLayout<QuadVertexData>.stride * vertices.count, options: [])

        return true
    }

    /// Render frame directly into CVPixelBuffer (zero-copy for video export)
    func renderFrameToPixelBuffer(
        strokes: [ReplayStroke],
        upToTime: Double,
        pixelBuffer: CVPixelBuffer,
        backgroundColor: MTLClearColor = MTLClearColor(red: 1, green: 1, blue: 1, alpha: 1)
    ) -> Bool {
        guard let textureCache = textureCache else {
            return false
        }

        // Create Metal texture from pixel buffer (zero-copy)
        var cvTextureOut: CVMetalTexture?
        let result = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault,
            textureCache,
            pixelBuffer,
            nil,
            .bgra8Unorm,
            CVPixelBufferGetWidth(pixelBuffer),
            CVPixelBufferGetHeight(pixelBuffer),
            0,
            &cvTextureOut
        )

        guard result == kCVReturnSuccess,
              let cvTexture = cvTextureOut,
              let texture = CVMetalTextureGetTexture(cvTexture) else {
            NSLog("[StrokeReplayEngine] Failed to create texture from pixel buffer")
            return false
        }

        // Render to this texture
        return renderToTexture(strokes: strokes, upToTime: upToTime, texture: texture, backgroundColor: backgroundColor)
    }

    /// Render a Vector Mode frame directly into the encoder's pixel buffer.
    /// This deliberately bypasses UIKit, React, Skia, and ReplayKit: the
    /// exporter owns camera evaluation and frame pacing, so a slow interactive
    /// frame can never become a dropped video frame.
    func renderVectorFrameToPixelBuffer(
        strokes: [ReplayStroke],
        camera: VectorCameraFrame,
        pixelBuffer: CVPixelBuffer,
        backgroundColor: MTLClearColor = MTLClearColor(red: 0.063, green: 0.063, blue: 0.078, alpha: 1)
    ) -> Bool {
        guard let textureCache = textureCache else { return false }
        var cvTextureOut: CVMetalTexture?
        let result = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault,
            textureCache,
            pixelBuffer,
            nil,
            .bgra8Unorm,
            CVPixelBufferGetWidth(pixelBuffer),
            CVPixelBufferGetHeight(pixelBuffer),
            0,
            &cvTextureOut
        )
        guard result == kCVReturnSuccess,
              let cvTexture = cvTextureOut,
              let texture = CVMetalTextureGetTexture(cvTexture) else {
            return false
        }
        return renderToTexture(
            strokes: strokes,
            upToTime: Double.greatestFiniteMagnitude,
            texture: texture,
            backgroundColor: backgroundColor,
            vectorCamera: camera
        )
    }

    /// Render frame to reusable canvas texture (for preview)
    func renderFrame(strokes: [ReplayStroke], upToTime: Double, backgroundColor: MTLClearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)) -> UIImage? {
        guard let canvasTexture = canvasTexture else {
            return nil
        }

        // Render to canvas texture
        guard renderToTexture(strokes: strokes, upToTime: upToTime, texture: canvasTexture, backgroundColor: backgroundColor) else {
            return nil
        }

        // Convert to UIImage for preview
        return textureToImage(texture: canvasTexture)
    }

    /// Core GPU rendering function
    private func renderToTexture(
        strokes: [ReplayStroke],
        upToTime: Double,
        texture: MTLTexture,
        backgroundColor: MTLClearColor = MTLClearColor(red: 1, green: 1, blue: 1, alpha: 1),
        vectorCamera: VectorCameraFrame? = nil
    ) -> Bool {
        guard let commandBuffer = commandQueue.makeCommandBuffer(),
              let renderPipelineState = renderPipelineState,
              let _ = vertexBuffer else {
            return false
        }

        // Clear to specified background color
        let renderPassDescriptor = MTLRenderPassDescriptor()
        renderPassDescriptor.colorAttachments[0].texture = texture
        renderPassDescriptor.colorAttachments[0].loadAction = .clear
        renderPassDescriptor.colorAttachments[0].clearColor = backgroundColor
        renderPassDescriptor.colorAttachments[0].storeAction = .store

        guard let renderEncoder = commandBuffer.makeRenderCommandEncoder(descriptor: renderPassDescriptor) else {
            return false
        }

        // Render each stroke with appropriate pipeline (normal or eraser)
        for stroke in strokes {
            // Select pipeline based on eraser flag
            let pipelineToUse = stroke.isEraser ? eraserPipelineState : renderPipelineState
            guard let pipeline = pipelineToUse else { continue }
            renderEncoder.setRenderPipelineState(pipeline)
            if let vectorCamera {
                renderVectorStroke(stroke: stroke, camera: vectorCamera, encoder: renderEncoder)
            } else {
                renderStroke(stroke: stroke, upToTime: upToTime, encoder: renderEncoder)
            }
        }

        renderEncoder.endEncoding()
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()

        return true
    }

    private func renderVectorStroke(
        stroke: ReplayStroke,
        camera: VectorCameraFrame,
        encoder: MTLRenderCommandEncoder
    ) {
        // Vector export currently uses the canonical opaque/transparent stamp
        // model. Smudge and plane strokes are not silently approximated: the JS
        // layer selects the interactive ReplayKit fallback for those documents.
        guard !stroke.isSmudge, !stroke.isPlane else { return }
        let projectedSize = stroke.size * camera.zoom
        guard projectedSize.isFinite, projectedSize > 0 else { return }
        let textureSize = min(max(projectedSize, 1), 2048)
        guard let texture = emojiAtlas.getTexture(for: stroke.emoji, size: CGFloat(textureSize)) else { return }
        let halfW = Float(canvasWidth) / 2
        let halfH = Float(canvasHeight) / 2
        // The document can intentionally zoom far beyond physical display
        // limits. Once a stamp is larger than the output, a larger quad cannot
        // add visible pixels, but it can produce enormous Metal vertex values
        // when its centre is far outside the viewport. Keep the native export
        // equivalent of the interactive viewport rebasing bounded.
        let safeProjectedSize = min(
            projectedSize,
            max(Float(canvasWidth), Float(canvasHeight)) * 8
        )
        guard safeProjectedSize.isFinite, safeProjectedSize > 0 else { return }
        let projected = stroke.points.compactMap { point -> ReplayStrokePoint? in
            let rawX = (point.x - camera.cx) * camera.zoom + halfW
            let rawY = (point.y - camera.cy) * camera.zoom + halfH
            guard rawX.isFinite, rawY.isFinite else { return nil }
            // Keep a generous bleed for a stamp that is currently only partly
            // visible. This is the native equivalent of viewport intersection.
            guard rawX >= -safeProjectedSize * 2 && rawX <= Float(canvasWidth) + safeProjectedSize * 2 &&
              rawY >= -safeProjectedSize * 2 && rawY <= Float(canvasHeight) + safeProjectedSize * 2 else { return nil }
            let x = min(Float(canvasWidth) + safeProjectedSize, max(-safeProjectedSize, rawX))
            let y = min(Float(canvasHeight) + safeProjectedSize, max(-safeProjectedSize, rawY))
            guard x.isFinite, y.isFinite else { return nil }
            return ReplayStrokePoint(x: x, y: y, t: point.t, w: safeProjectedSize)
        }
        guard !projected.isEmpty else { return }
        renderDiscreteStamps(
            texture: texture,
            points: projected,
            fallbackSize: projectedSize,
            opacity: stroke.opacity,
            rotation: stroke.rotation,
            mirrorX: stroke.mirrorX,
            mirrorY: stroke.mirrorY,
            encoder: encoder
        )
    }

    /// Render a single stroke using GPU
    private func renderStroke(
        stroke: ReplayStroke,
        upToTime: Double,
        encoder: MTLRenderCommandEncoder
    ) {
        // SMUDGE: draw the baked result tile (pops in once the stroke's start time arrives).
        if stroke.isSmudge {
            guard let b64 = stroke.bakedTile, let b = stroke.bakedBounds else { return }
            let firstT = stroke.points.first?.t ?? 0
            if upToTime < firstT { return }
            guard let texture = emojiAtlas.getSmudgeTexture(id: stroke.id, base64: b64) else { return }
            let corners = ReplayPlaneCorners(
                topLeft: SIMD2<Float>(b.x, b.y),
                topRight: SIMD2<Float>(b.x + b.z, b.y),
                bottomRight: SIMD2<Float>(b.x + b.z, b.y + b.w),
                bottomLeft: SIMD2<Float>(b.x, b.y + b.w)
            )
            renderDistortedQuad(texture: texture, corners: corners, opacity: 1.0, encoder: encoder)
            return
        }

        // PLANE RENDERING: Check if this is a plane stroke with animated corner history
        if stroke.isPlane {
            if let history = stroke.planeCornerHistory, let timestamps = stroke.planeTimestamps, !history.isEmpty {
                // Animated plane: interpolate corners based on time
                renderAnimatedPlane(
                    stroke: stroke,
                    history: history,
                    timestamps: timestamps,
                    upToTime: upToTime,
                    encoder: encoder
                )
                return
            } else if let corners = stroke.planeCorners {
                // Static plane: render at final position
                renderStaticPlane(
                    stroke: stroke,
                    corners: corners,
                    encoder: encoder
                )
                return
            }
        }

        // Regular stroke rendering
        let visiblePoints = stroke.points.filter { $0.t <= upToTime }
        guard !visiblePoints.isEmpty else { return }

        // Debug logging for first few calls
        renderStrokeCallCount += 1
        if renderStrokeCallCount <= 20 {
            let isCustomBrush = stroke.emoji.hasPrefix("data:image/png;base64,")
            let typeLabel = isCustomBrush ? "CUSTOM_BRUSH" : "emoji"
            NSLog("[StrokeReplay] \(typeLabel) '\(String(stroke.emoji.prefix(20)))...': \(visiblePoints.count)/\(stroke.points.count) points visible at time \(upToTime)ms (first point t=\(stroke.points.first?.t ?? -1), last=\(stroke.points.last?.t ?? -1))")
        }

        // Get emoji texture
        let emojiSize = CGFloat(stroke.size)
        guard let emojiTexture = emojiAtlas.getTexture(for: stroke.emoji, size: emojiSize) else {
            let isCustomBrush = stroke.emoji.hasPrefix("data:image/png;base64,")
            let typeLabel = isCustomBrush ? "CUSTOM_BRUSH" : "emoji"
            NSLog("[StrokeReplay] ❌ Failed to get texture for \(typeLabel)")
            return
        }

        // Render stamps along path with per-point width support
        renderStamps(
            texture: emojiTexture,
            points: visiblePoints,
            fallbackSize: stroke.size,
            opacity: stroke.opacity,
            spacing: stroke.spacing,
            encoder: encoder
        )
    }

    /// Render animated plane with corner history interpolation
    private func renderAnimatedPlane(
        stroke: ReplayStroke,
        history: [ReplayPlaneCorners],
        timestamps: [Double],
        upToTime: Double,
        encoder: MTLRenderCommandEncoder
    ) {
        // Don't render if time is before first snapshot
        guard upToTime >= timestamps[0] else { return }

        // Find the correct corners for current time (interpolate between snapshots)
        var currentCorners = history[0]

        for i in 0..<timestamps.count {
            if upToTime >= timestamps[i] {
                currentCorners = history[i]
            } else {
                break
            }
        }

        // Get emoji texture
        let emojiSize = CGFloat(stroke.size)
        guard let emojiTexture = emojiAtlas.getTexture(for: stroke.emoji, size: emojiSize) else {
            return
        }

        // Render distorted quad at interpolated corners
        renderDistortedQuad(
            texture: emojiTexture,
            corners: currentCorners,
            opacity: stroke.opacity,
            encoder: encoder
        )
    }

    /// Draw already-spaced Vector stamp centers without re-interpolating the
    /// path. The JS Vector document owns spacing, so export density stays
    /// identical to the interactive renderer.
    private func renderDiscreteStamps(
        texture: MTLTexture,
        points: [ReplayStrokePoint],
        fallbackSize: Float,
        opacity: Float,
        rotation: Float,
        mirrorX: Bool,
        mirrorY: Bool,
        encoder: MTLRenderCommandEncoder
    ) {
        encoder.setFragmentTexture(texture, index: 0)
        var opacityValue = opacity
        encoder.setFragmentBytes(&opacityValue, length: MemoryLayout<Float>.size, index: 0)
        let radians = rotation * Float.pi / 180
        let cosAngle = cos(radians)
        let sinAngle = sin(radians)

        func ndc(_ x: Float, _ y: Float) -> SIMD2<Float> {
            SIMD2<Float>(
                (x / Float(canvasWidth)) * 2 - 1,
                1 - (y / Float(canvasHeight)) * 2
            )
        }

        for point in points {
            let half = (point.w ?? fallbackSize) / 2
            let offsets: [(SIMD2<Float>, SIMD2<Float>)] = [
                (SIMD2<Float>(-half, -half), SIMD2<Float>(0, 1)),
                (SIMD2<Float>( half, -half), SIMD2<Float>(1, 1)),
                (SIMD2<Float>(-half,  half), SIMD2<Float>(0, 0)),
                (SIMD2<Float>( half,  half), SIMD2<Float>(1, 0)),
            ]
            var vertices = offsets.map { item -> QuadVertexData in
                var dx = item.0.x
                var dy = item.0.y
                if mirrorX { dx = -dx }
                if mirrorY { dy = -dy }
                let rotatedX = cosAngle * dx - sinAngle * dy
                let rotatedY = sinAngle * dx + cosAngle * dy
                var uv = item.1
                if mirrorX { uv.x = 1 - uv.x }
                if mirrorY { uv.y = 1 - uv.y }
                return QuadVertexData(
                    position: ndc(point.x + rotatedX, point.y + rotatedY),
                    texCoord: uv
                )
            }
            encoder.setVertexBytes(
                &vertices,
                length: MemoryLayout<QuadVertexData>.stride * vertices.count,
                index: 0
            )
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }
    }

    /// Render static plane (no animation)
    private func renderStaticPlane(
        stroke: ReplayStroke,
        corners: ReplayPlaneCorners,
        encoder: MTLRenderCommandEncoder
    ) {
        // Get emoji texture
        let emojiSize = CGFloat(stroke.size)
        guard let emojiTexture = emojiAtlas.getTexture(for: stroke.emoji, size: emojiSize) else {
            return
        }

        // Render distorted quad
        renderDistortedQuad(
            texture: emojiTexture,
            corners: corners,
            opacity: stroke.opacity,
            encoder: encoder
        )
    }

    /// Render a distorted quad (emoji mapped to 4 corners)
    private func renderDistortedQuad(
        texture: MTLTexture,
        corners: ReplayPlaneCorners,
        opacity: Float,
        encoder: MTLRenderCommandEncoder
    ) {
        // Convert corner positions to NDC coordinates
        let tlNDC = SIMD2<Float>(
            (corners.topLeft.x / Float(canvasWidth)) * 2.0 - 1.0,
            1.0 - (corners.topLeft.y / Float(canvasHeight)) * 2.0
        )
        let trNDC = SIMD2<Float>(
            (corners.topRight.x / Float(canvasWidth)) * 2.0 - 1.0,
            1.0 - (corners.topRight.y / Float(canvasHeight)) * 2.0
        )
        let brNDC = SIMD2<Float>(
            (corners.bottomRight.x / Float(canvasWidth)) * 2.0 - 1.0,
            1.0 - (corners.bottomRight.y / Float(canvasHeight)) * 2.0
        )
        let blNDC = SIMD2<Float>(
            (corners.bottomLeft.x / Float(canvasWidth)) * 2.0 - 1.0,
            1.0 - (corners.bottomLeft.y / Float(canvasHeight)) * 2.0
        )

        // Create distorted quad vertices (2 triangles: TL-TR-BL, TR-BR-BL)
        var vertices: [QuadVertexData] = [
            QuadVertexData(position: tlNDC, texCoord: SIMD2<Float>(0, 0)),
            QuadVertexData(position: trNDC, texCoord: SIMD2<Float>(1, 0)),
            QuadVertexData(position: blNDC, texCoord: SIMD2<Float>(0, 1)),
            QuadVertexData(position: trNDC, texCoord: SIMD2<Float>(1, 0)),
            QuadVertexData(position: brNDC, texCoord: SIMD2<Float>(1, 1)),
            QuadVertexData(position: blNDC, texCoord: SIMD2<Float>(0, 1))
        ]

        encoder.setFragmentTexture(texture, index: 0)
        var opacityValue = opacity
        encoder.setFragmentBytes(&opacityValue, length: MemoryLayout<Float>.size, index: 0)
        encoder.setVertexBytes(&vertices, length: MemoryLayout<QuadVertexData>.stride * vertices.count, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6)
    }

    /// Render emoji stamps using GPU quad rendering with per-point width support
    private func renderStamps(
        texture: MTLTexture,
        points: [ReplayStrokePoint],
        fallbackSize: Float,
        opacity: Float,
        spacing: Float,
        encoder: MTLRenderCommandEncoder
    ) {
        guard !points.isEmpty else { return }

        encoder.setFragmentTexture(texture, index: 0)
        var opacityValue = opacity
        encoder.setFragmentBytes(&opacityValue, length: MemoryLayout<Float>.size, index: 0)

        // Stamp spacing in px; interpolate ALONG segments so fast strokes don't gap (matches the live
        // Metal/Skia engines). `spacing` is the normalized brush multiplier.
        let normSpacing = spacing > 0 ? min(spacing, 1.0) : 0.12
        let spacingPx = max(1.0, fallbackSize * (0.10 + 0.18 * normSpacing))

        func stamp(_ x: Float, _ y: Float, _ size: Float) {
            let scaleX = size / Float(canvasWidth)
            let scaleY = size / Float(canvasHeight)
            let ndcX = (x / Float(canvasWidth)) * 2.0 - 1.0
            let ndcY = 1.0 - (y / Float(canvasHeight)) * 2.0
            var vertices: [QuadVertexData] = [
                QuadVertexData(position: SIMD2<Float>(ndcX - scaleX, ndcY - scaleY), texCoord: SIMD2<Float>(0, 1)),
                QuadVertexData(position: SIMD2<Float>(ndcX + scaleX, ndcY - scaleY), texCoord: SIMD2<Float>(1, 1)),
                QuadVertexData(position: SIMD2<Float>(ndcX - scaleX, ndcY + scaleY), texCoord: SIMD2<Float>(0, 0)),
                QuadVertexData(position: SIMD2<Float>(ndcX + scaleX, ndcY + scaleY), texCoord: SIMD2<Float>(1, 0))
            ]
            encoder.setVertexBytes(&vertices, length: MemoryLayout<QuadVertexData>.stride * vertices.count, index: 0)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }

        let first = points[0]
        stamp(first.x, first.y, first.w ?? fallbackSize)
        for i in 1..<points.count {
            let a = points[i - 1]
            let b = points[i]
            let dx = b.x - a.x
            let dy = b.y - a.y
            let dist = sqrt(dx * dx + dy * dy)
            let aSize = a.w ?? fallbackSize
            let bSize = b.w ?? fallbackSize
            let steps = max(1, min(2048, Int((dist / spacingPx).rounded(.up))))
            for s in 1...steps {
                let t = Float(s) / Float(steps)
                stamp(a.x + dx * t, a.y + dy * t, aSize + (bSize - aSize) * t)
            }
        }
    }

    /// Convert texture to UIImage (for preview only)
    private func textureToImage(texture: MTLTexture) -> UIImage? {
        let width = texture.width
        let height = texture.height
        let bytesPerPixel = 4
        let bytesPerRow = bytesPerPixel * width
        let region = MTLRegionMake2D(0, 0, width, height)

        // Create readable texture
        let textureDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: texture.pixelFormat,
            width: width,
            height: height,
            mipmapped: false
        )
        textureDescriptor.storageMode = .shared
        textureDescriptor.usage = [.shaderRead]

        guard let readableTexture = device.makeTexture(descriptor: textureDescriptor),
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let blitEncoder = commandBuffer.makeBlitCommandEncoder() else {
            return nil
        }

        blitEncoder.copy(from: texture, to: readableTexture)
        blitEncoder.endEncoding()
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()

        // Read pixels
        var pixelData = [UInt8](repeating: 0, count: width * height * bytesPerPixel)
        readableTexture.getBytes(&pixelData, bytesPerRow: bytesPerRow, from: region, mipmapLevel: 0)

        // Create CGImage
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue)
            .union(.byteOrder32Little)

        guard let dataProvider = CGDataProvider(data: Data(pixelData) as CFData),
              let cgImage = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: bytesPerRow,
                space: colorSpace,
                bitmapInfo: bitmapInfo,
                provider: dataProvider,
                decode: nil,
                shouldInterpolate: false,
                intent: .defaultIntent
              ) else {
            return nil
        }

        return UIImage(cgImage: cgImage)
    }
}
