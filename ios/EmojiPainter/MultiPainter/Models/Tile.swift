//
//  Tile.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation
import SwiftUI
import UIKit

class Tile: ObservableObject {
    let id: Int
    @Published var baseImage: UIImage?  // AI-generated base
    @Published var drawingImage: UIImage?  // User strokes overlay
    @Published var isFrozen: Bool = false
    @Published var countdown: Int = 0

    private var offscreenContext: CGContext?
    private let size: CGFloat = 512.0

    init(id: Int) {
        self.id = id
        setupOffscreenCanvas()
    }

    /// Set up offscreen canvas for stroke rendering
    private func setupOffscreenCanvas() {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bytesPerPixel = 4
        let bytesPerRow = bytesPerPixel * Int(size)
        let bitsPerComponent = 8

        offscreenContext = CGContext(
            data: nil,
            width: Int(size),
            height: Int(size),
            bitsPerComponent: bitsPerComponent,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )

        // FIX: Flip coordinate system to match UIKit/SwiftUI (top-left origin)
        // Core Graphics uses bottom-left origin by default
        offscreenContext?.translateBy(x: 0, y: size)
        offscreenContext?.scaleBy(x: 1.0, y: -1.0)

        // Set transparent background
        offscreenContext?.clear(CGRect(x: 0, y: 0, width: size, height: size))
    }

    /// Render a stroke segment to the offscreen canvas
    func renderSegment(_ segment: StrokeSegment) {
        guard let context = offscreenContext else {
            print("[TILE \(id)] ERROR: No offscreen context!")
            return
        }

        let localCoords = segment.toTileLocal(tileId: id)

        // Only render if segment intersects this tile
        guard segment.intersects(tileId: id) else { return }

        print("[TILE \(id)] Rendering stroke: (\(Int(localCoords.fromX)), \(Int(localCoords.fromY))) → (\(Int(localCoords.toX)), \(Int(localCoords.toY)))")

        if let emoji = segment.emojiBrush {
            renderEmojiSegment(
                emoji: emoji,
                from: CGPoint(x: localCoords.fromX, y: localCoords.fromY),
                to: CGPoint(x: localCoords.toX, y: localCoords.toY),
                brushSize: segment.brushSize,
                context: context
            )
        } else {
            context.setLineWidth(segment.brushSize)
            context.setLineCap(.round)
            context.setLineJoin(.round)

            // Parse color
            let color = Color(hex: segment.color)
            let uiColor = UIColor(color)
            context.setStrokeColor(uiColor.cgColor)

            // Draw line
            context.move(to: CGPoint(x: localCoords.fromX, y: localCoords.fromY))
            context.addLine(to: CGPoint(x: localCoords.toX, y: localCoords.toY))
            context.strokePath()
        }

        // Update published image
        updateDrawingImage()
    }

    private func renderEmojiSegment(emoji: String, from: CGPoint, to: CGPoint, brushSize: Double, context: CGContext) {
        let start = from
        let end = to
        let dx = end.x - start.x
        let dy = end.y - start.y
        let length = sqrt(dx * dx + dy * dy)
        // MUCH CLOSER spacing: 0.3x brushSize, minimum 3 pixels
        let step = max(CGFloat(brushSize) * 0.3, 3)
        let steps = max(Int(length / step), 1)
        // Per-set size scaling keeps art sets (fill the box) and glyph sets
        // (font padding) at the same visual size — applied identically to the
        // live preview in NewCanvasView so preview and painted stroke match.
        let sizeScale = EmojiSetManager.shared.activeSizeScale
        let fontSize = max(CGFloat(brushSize) * 1.8 * sizeScale, 18)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: fontSize)
        ]
        // Use the active emoji set's art when available; fall back to the system
        // glyph so unsupported emoji (and the Apple set) still paint.
        let customImage = EmojiSetManager.shared.image(for: emoji)

        UIGraphicsPushContext(context)
        // Draw emojis VERY close together for dense coverage
        for i in 0...steps {
            let progress = CGFloat(i) / CGFloat(max(steps, 1))
            let x = start.x + dx * progress
            let y = start.y + dy * progress
            let rect = CGRect(
                x: x - fontSize / 2,
                y: y - fontSize / 2,
                width: fontSize,
                height: fontSize
            )
            if let customImage = customImage {
                customImage.draw(in: rect)
            } else {
                (emoji as NSString).draw(in: rect, withAttributes: attributes)
            }
        }
        UIGraphicsPopContext()
    }

    /// Convert offscreen canvas to UIImage
    private func updateDrawingImage() {
        guard let context = offscreenContext,
              let cgImage = context.makeImage() else { return }

        DispatchQueue.main.async {
            self.drawingImage = UIImage(cgImage: cgImage)
        }
    }

    /// Clear all strokes (keep base image)
    func clearStrokes() {
        offscreenContext?.clear(CGRect(x: 0, y: 0, width: size, height: size))
        updateDrawingImage()
    }

    /// Update base AI-generated image
    func updateBaseImage(_ image: UIImage) {
        DispatchQueue.main.async {
            self.baseImage = image
        }
    }

    /// Composite view combining base + strokes
    func compositeImage() -> UIImage? {
        guard let base = baseImage else { return drawingImage }
        guard let drawing = drawingImage else { return base }

        UIGraphicsBeginImageContextWithOptions(CGSize(width: size, height: size), false, 1.0)
        defer { UIGraphicsEndImageContext() }

        base.draw(in: CGRect(x: 0, y: 0, width: size, height: size))
        drawing.draw(in: CGRect(x: 0, y: 0, width: size, height: size))

        return UIGraphicsGetImageFromCurrentImageContext()
    }
}

// TileFrozenError is now in MessageModels.swift
