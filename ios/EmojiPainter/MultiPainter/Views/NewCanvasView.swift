//
//  NewCanvasView.swift
//  MultiPainter
//
//  Created by Claude Code - V2 Architecture with Viewport System
//

import SwiftUI
import UIKit

struct NewCanvasView: View {
    @EnvironmentObject var gameState: GameState
    @Binding var selectedColor: Color
    @Binding var brushSize: Double
    @Binding var pipetteActive: Bool
    @Binding var selectedEmojiBrush: String?

    @State private var currentStrokePoints: [CGPoint] = []  // In global coordinates (0-1024)
    @State private var lastGlobalPosition: CGPoint?
    @State private var strokeStartPoint: CGPoint?
    @State private var hasMovedDuringStroke = false
    @State private var pendingDotBrushSize: Double = 0
    // Live preview stroke gracefully alpha-fades out after each stroke (random
    // 0.3–1.3s) so it hands off smoothly to the server-rendered result beneath.
    @State private var previewOpacity: Double = 1.0
    @State private var fadeWorkItem: DispatchWorkItem?

    var body: some View {
        GeometryReader { geometry in
            let viewSize = geometry.size
            let isPad = UIDevice.current.userInterfaceIdiom == .pad
            // Calculate canvas size - normal full screen rendering
            let maxSize: CGFloat = isPad ? .infinity : 512
            let canvasSize = min(viewSize.width, viewSize.height, maxSize)
            let viewport = gameState.viewportRect

            ZStack {
                // Background
                Color.black.edgesIgnoringSafeArea(.all)

                // Render the 512x512 viewport (1:1 aspect ratio)
                ZStack {
                    // Render portions of all 4 tiles visible in viewport
                    ForEach(0..<4) { tileId in
                        renderTile(tileId: tileId, viewport: viewport, canvasSize: canvasSize)
                    }
                    .zIndex(0)

                    // Frozen tile overlays
                    ForEach(0..<4) { tileId in
                        if let tile = gameState.tiles[tileId], tile.isFrozen {
                            renderFrozenOverlay(tileId: tileId, viewport: viewport, canvasSize: canvasSize)
                        }
                    }
                    .zIndex(1)

                    // Other players' emoji cursors (tappable to attack)
                    ForEach(Array(gameState.otherPlayers.values), id: \.id) { player in
                        let displayPoint = gameState.displayPosition(for: player)
                        ZStack {
                            renderPlayerCursor(player: player, displayPoint: displayPoint, isCurrentUser: false, viewport: viewport, canvasSize: canvasSize)
                                .onTapGesture {
                                    attackPlayer(player)
                                }

                            // Floating karma/coin text
                            if let floatingText = gameState.floatingTexts[player.username] {
                                renderFloatingText(floatingText, at: displayPoint, viewport: viewport, canvasSize: canvasSize)
                            }
                        }
                    }
                    .zIndex(2)

                    // My emoji cursor
                    if let myPlayer = gameState.myPlayer {
                        renderPlayerCursor(player: myPlayer, displayPoint: nil, isCurrentUser: true, viewport: viewport, canvasSize: canvasSize)
                            .zIndex(3)
                    }

                    // Current stroke being drawn (convert from global to view coords)
                    if !currentStrokePoints.isEmpty {
                        Group {
                        if let emoji = selectedEmojiBrush {
                            ForEach(Array(currentStrokePoints.enumerated()), id: \.offset) { _, point in
                                let viewPoint = globalToViewPoint(point, viewport: viewport, canvasSize: canvasSize)
                                // Match the committed/server stroke size EXACTLY so the live
                                // preview never looks smaller than the painted result.
                                // Server (Tile.renderEmojiSegment): fontSize = max(scaledBrushSize * 1.8, 18)
                                // in 512-canvas space, then the tile is displayed scaled by
                                // (canvasSize / viewport.width). scaledBrushSize mirrors handleDragChanged.
                                let viewportWidth = max(viewport.width, 1)
                                let scaledBrushSize = brushSize * (viewportWidth / 512.0)
                                // Same per-set size scale the painted stroke (Tile) uses, so the
                                // preview matches whichever emoji set is active. activePreviewScale
                                // is a preview-only trim that absorbs the scaledToFit vs draw(in:)
                                // difference so preview lines up 1:1 with the painted stamp.
                                let setScale = EmojiSetManager.shared.activeSizeScale
                                let previewScale = EmojiSetManager.shared.activePreviewScale
                                let fontSize = max(scaledBrushSize * 1.8 * setScale, 18.0) * (canvasSize / viewportWidth) * previewScale
                                CustomEmojiView(emoji, size: CGFloat(fontSize), revealOnTap: false)
                                    .position(viewPoint)
                            }
                        } else {
                            Path { path in
                                guard !currentStrokePoints.isEmpty else { return }

                                let firstViewPoint = globalToViewPoint(currentStrokePoints[0], viewport: viewport, canvasSize: canvasSize)
                                path.move(to: firstViewPoint)

                                for globalPoint in currentStrokePoints.dropFirst() {
                                    let viewPoint = globalToViewPoint(globalPoint, viewport: viewport, canvasSize: canvasSize)
                                    path.addLine(to: viewPoint)
                                }
                            }
                            .stroke(selectedColor, style: StrokeStyle(lineWidth: brushSize, lineCap: .round, lineJoin: .round))
                        }
                        }
                        .opacity(previewOpacity)
                    }
                }
                .frame(width: canvasSize, height: canvasSize)
                .clipped()
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            handleDragChanged(value, canvasSize: canvasSize, viewport: viewport, geometry: geometry)
                        }
                        .onEnded { value in
                            handleDragEnded(value, canvasSize: canvasSize, viewport: viewport)
                        }
                )
            }
        }
    }


    // MARK: - Tile Rendering
    @ViewBuilder
    private func renderTile(tileId: Int, viewport: CGRect, canvasSize: CGFloat) -> some View {
        let tileRect = getTileRect(tileId: tileId)
        let intersection = viewport.intersection(tileRect)

        if !intersection.isNull {
            let tile = gameState.tiles[tileId]

            // Calculate which portion of the tile is visible
            let cropRect = CGRect(
                x: intersection.minX - tileRect.minX,
                y: intersection.minY - tileRect.minY,
                width: intersection.width,
                height: intersection.height
            )

            // Calculate where to position this cropped portion on screen
            let screenOffset = CGPoint(
                x: convertToViewX(globalX: intersection.minX - viewport.minX, canvasSize: canvasSize),
                y: convertToViewY(globalY: intersection.minY - viewport.minY, canvasSize: canvasSize)
            )

            let screenSize = CGSize(
                width: convertToViewWidth(globalWidth: intersection.width, canvasSize: canvasSize),
                height: convertToViewHeight(globalHeight: intersection.height, canvasSize: canvasSize)
            )

            ZStack {
                // CRITICAL RENDERING ORDER:
                // 1. FIRST: Base AI image (background layer)
                if let baseImage = tile?.baseImage,
                   let croppedBase = cropImage(baseImage, to: cropRect) {
                    Image(uiImage: croppedBase)
                        .resizable()
                        .frame(width: screenSize.width, height: screenSize.height)
                        .position(x: screenOffset.x + screenSize.width / 2, y: screenOffset.y + screenSize.height / 2)
                }

                // 2. SECOND: User strokes (drawn ON TOP of AI image)
                if let drawingImage = tile?.drawingImage,
                   let croppedDrawing = cropImage(drawingImage, to: cropRect) {
                    Image(uiImage: croppedDrawing)
                        .resizable()
                        .frame(width: screenSize.width, height: screenSize.height)
                        .position(x: screenOffset.x + screenSize.width / 2, y: screenOffset.y + screenSize.height / 2)
                }

                // 3. THIRD: Players/entities (rendered after tiles loop - see lines 45-55)
                // 4. FOURTH: UI overlays (frozen tiles, countdowns - rendered last)
            }
        }
    }

    // Helper to crop UIImage
    private func cropImage(_ image: UIImage, to rect: CGRect) -> UIImage? {
        guard let cgImage = image.cgImage else { return nil }

        // Scale rect to match image scale
        let scale = image.scale
        let scaledRect = CGRect(
            x: rect.origin.x * scale,
            y: rect.origin.y * scale,
            width: rect.size.width * scale,
            height: rect.size.height * scale
        )

        guard let croppedCGImage = cgImage.cropping(to: scaledRect) else { return nil }
        return UIImage(cgImage: croppedCGImage, scale: scale, orientation: image.imageOrientation)
    }

    @ViewBuilder
    private func renderFrozenOverlay(tileId: Int, viewport: CGRect, canvasSize: CGFloat) -> some View {
        let tileRect = getTileRect(tileId: tileId)
        let intersection = viewport.intersection(tileRect)

        if !intersection.isNull {
            let width = convertToViewWidth(globalWidth: intersection.width, canvasSize: canvasSize)
            let height = convertToViewHeight(globalHeight: intersection.height, canvasSize: canvasSize)
            let offsetX = convertToViewX(globalX: intersection.minX - viewport.minX, canvasSize: canvasSize)
            let offsetY = convertToViewY(globalY: intersection.minY - viewport.minY, canvasSize: canvasSize)

            ZStack {
                // Animated gradient background
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [Color.yellow.opacity(0.4), Color.orange.opacity(0.3)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: width, height: height)
                    .offset(x: offsetX, y: offsetY)

                // Processing indicator
                VStack(spacing: 12) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .scaleEffect(1.5)

                    EmojiLabel("🎨 AI Processing...", size: 14, weight: .bold, color: .white)
                        .shadow(color: .black.opacity(0.5), radius: 2)

                    VStack(spacing: 6) {
                        EmojiLabel("💎 +100 Karma", size: 12, weight: .semibold, color: .green)
                            .shadow(color: .black.opacity(0.5), radius: 2)

                        EmojiLabel("🪙 Earned 1 Coin", size: 12, weight: .semibold, color: .yellow)
                            .shadow(color: .black.opacity(0.5), radius: 2)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.black.opacity(0.7))
                    )
                }
                .frame(width: width, height: height)
                .offset(x: offsetX, y: offsetY)
            }
        }
    }

    @ViewBuilder
    private func renderPlayerCursor(player: Player, displayPoint: CGPoint?, isCurrentUser: Bool, viewport: CGRect, canvasSize: CGFloat) -> some View {
        let point = displayPoint ?? CGPoint(x: player.x, y: player.y)
        let inViewport = viewport.contains(point)

        if inViewport {
            let localX = point.x - viewport.minX
            let localY = point.y - viewport.minY

            let viewX = convertToViewX(globalX: localX, canvasSize: canvasSize)
            let viewY = convertToViewY(globalY: localY, canvasSize: canvasSize)

            // Apply iconScale to size
            let baseSize: CGFloat = 32
            let scaledSize = baseSize * player.iconScale
            let glowSize = scaledSize + 8

            // Death animation: dramatic fade out with rotation and scale
            let deathScale: CGFloat = player.alive ? 1.0 : 0.1
            let deathOpacity: Double = player.alive ? 1.0 : 0.0
            let deathRotation: Double = player.alive ? 0 : 360

            // Spawn animation: blink effect
            let isBlinking = player.isSpawning && Int(Date().timeIntervalSince1970 * 10) % 2 == 0
            let spawnAlpha = isBlinking ? 0.3 : 1.0

            // Combine spawn and death animations
            let alpha = player.alive ? spawnAlpha : deathOpacity

            let alert = gameState.playerAlerts[player.username]
            let alertColor: Color = {
                switch alert?.type {
                case .hit:
                    return .red
                case .attack:
                    return .green
                default:
                    return .clear
                }
            }()

            ZStack {
                // Death flash effect (red explosion)
                if !player.alive {
                    Circle()
                        .fill(Color.red.opacity(0.6))
                        .frame(width: scaledSize * 3, height: scaledSize * 3)
                        .blur(radius: 10)
                }

                if let alert = alert {
                    HitFlashView(
                        color: alertColor,
                        timestamp: alert.timestamp,
                        diameter: glowSize + 24
                    )
                }

                // Shield effect (pulsing circle)
                if player.isShielded {
                    let shieldAlpha = 0.3 + sin(Date().timeIntervalSince1970 * 15) * 0.3
                    let shieldSize = (scaledSize + 10) + sin(Date().timeIntervalSince1970 * 10) * 5

                    Circle()
                        .stroke(Color.blue, lineWidth: 4)
                        .frame(width: shieldSize, height: shieldSize)
                        .opacity(shieldAlpha)
                }

                // Color glow (scaled)
                Circle()
                    .fill(player.colorValue.opacity(0.3))
                    .frame(width: glowSize, height: glowSize)

                // Emoji (scaled)
                CustomEmojiView(player.emoji, size: scaledSize, revealOnTap: false)

                // Spawn indicator text
                if player.isSpawning {
                    Text("SPAWNING")
                        .appFont(8, weight: .bold)
                        .foregroundColor(.white)
                        .offset(y: scaledSize / 2 + 8)
                }

                if !isCurrentUser {
                    HStack(spacing: 2) {
                        ForEach(0..<3, id: \.self) { index in
                            Image(systemName: index < player.lives ? "heart.fill" : "heart")
                                .appFont(8, weight: .bold)
                                .foregroundColor(index < player.lives ? .red : .white.opacity(0.4))
                                .scaleEffect(index < player.lives ? 1.0 : 0.5)
                                .opacity(index < player.lives ? 1.0 : 0.3)
                                .animation(.spring(response: 0.3, dampingFraction: 0.6), value: player.lives)
                        }
                    }
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(Color.black.opacity(0.6))
                    )
                    .offset(y: scaledSize / 2 + 16)
                }
            }
            .scaleEffect(deathScale)
            .rotationEffect(.degrees(deathRotation))
            .opacity(alpha)
            .position(x: viewX, y: viewY)
            .shadow(color: player.colorValue.opacity(0.5), radius: 10)
            .animation(.easeOut(duration: 0.1), value: player.x)
            .animation(.easeOut(duration: 0.1), value: player.y)
            .animation(.spring(response: 0.5, dampingFraction: 0.5), value: player.alive)
        } else {
            Color.clear.onAppear {
                print("⚠️ Player \(player.emoji) at (\(Int(player.x)), \(Int(player.y))) is outside viewport")
            }
        }
    }

    // MARK: - Gesture Handling

    private func handleDragChanged(_ value: DragGesture.Value, canvasSize: CGFloat, viewport: CGRect, geometry: GeometryProxy) {
        let viewPoint = value.location

        // Convert view coordinates (0-canvasSize) to global canvas coordinates (0-1024)
        // viewport.width is the actual viewport size (256)
        let globalX = viewport.minX + (viewPoint.x / canvasSize) * viewport.width
        let globalY = viewport.minY + (viewPoint.y / canvasSize) * viewport.height
        var globalPoint = CGPoint(x: globalX, y: globalY)

        // Clamp to canvas bounds
        globalPoint.x = max(0, min(1024, globalPoint.x))
        globalPoint.y = max(0, min(1024, globalPoint.y))

        if pipetteActive {
            if let sampled = sampleColor(at: globalPoint) {
                selectedColor = sampled
                selectedEmojiBrush = nil
                pipetteActive = false
            }
            return
        }

        // PAINTING: Draw strokes at touch location (fast/instant)
        let scaledBrushSize = brushSize * (viewport.width / 512.0)

        if strokeStartPoint == nil {
            // New stroke begins — cancel any pending fade-out of the previous
            // preview and start fresh at full opacity.
            fadeWorkItem?.cancel()
            fadeWorkItem = nil
            currentStrokePoints.removeAll()
            previewOpacity = 1.0
            strokeStartPoint = globalPoint
            pendingDotBrushSize = scaledBrushSize
            hasMovedDuringStroke = false
        }

        currentStrokePoints.append(globalPoint)

        // Send stroke to server (in global coordinates)
        if let lastPoint = lastGlobalPosition {
            print("🎨 Stroke: (\(Int(lastPoint.x)), \(Int(lastPoint.y))) → (\(Int(globalPoint.x)), \(Int(globalPoint.y))), brush: \(Int(scaledBrushSize))px")
            gameState.sendStroke(
                from: lastPoint,
                to: globalPoint,
                brushSize: scaledBrushSize,
                color: currentStrokePayload()
            )
            hasMovedDuringStroke = true
        }

        lastGlobalPosition = globalPoint

        // NO MOVEMENT - Use joystick for movement instead
    }

    private func handleDragEnded(_ value: DragGesture.Value, canvasSize: CGFloat, viewport: CGRect) {
        let globalPoint = globalPoint(fromViewPoint: value.location, canvasSize: canvasSize, viewport: viewport)

        if pipetteActive {
            if let sampled = sampleColor(at: globalPoint) {
                selectedColor = sampled
                selectedEmojiBrush = nil
            }
            pipetteActive = false
            return
        }

        if !hasMovedDuringStroke, let start = strokeStartPoint {
            let epsilon: CGFloat = 0.1
            let endPoint = CGPoint(x: start.x + epsilon, y: start.y + epsilon)
            gameState.sendStroke(
                from: start,
                to: endPoint,
                brushSize: pendingDotBrushSize,
                color: currentStrokePayload()
            )
        }

        lastGlobalPosition = nil
        strokeStartPoint = nil
        hasMovedDuringStroke = false

        // Smoothly alpha-out the just-drawn preview over a random 0.3–1.3s so it
        // gracefully dissolves into the server-rendered stroke beneath it.
        guard !currentStrokePoints.isEmpty else { return }

        let fadeDuration = Double.random(in: 0.3...1.3)
        fadeWorkItem?.cancel()
        withAnimation(.easeOut(duration: fadeDuration)) {
            previewOpacity = 0.0
        }
        let work = DispatchWorkItem {
            currentStrokePoints.removeAll()
            previewOpacity = 1.0
        }
        fadeWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + fadeDuration, execute: work)
    }

    private func attackPlayer(_ player: Player) {
        guard let myPlayer = gameState.myPlayer else { return }
        guard myPlayer.alive && !player.isSpawning else { return }

        print("⚔️ Attacking player: \(player.username) (\(player.emoji))")

        // Send attack message to server with position and brush size
        let attackMessage = AttackPlayerMessage(payload: .init(
            targetUsername: player.username,
            x: myPlayer.x,
            y: myPlayer.y,
            brushSize: brushSize
        ))
        gameState.webSocketService.send(attackMessage)
    }

    // MARK: - Helper Functions
    private func sampleColor(at globalPoint: CGPoint) -> Color? {
        guard let tileId = tileId(for: globalPoint),
              let tile = gameState.tiles[tileId] else {
            return nil
        }

        let localPoint = convertToTileLocal(globalPoint, tileId: tileId)
        let clamped = CGPoint(
            x: max(0, min(511, localPoint.x)),
            y: max(0, min(511, localPoint.y))
        )

        if let strokeColor = tile.drawingImage?.color(at: clamped),
           colorIsVisible(strokeColor) {
            return strokeColor
        }

        if let baseColor = tile.baseImage?.color(at: clamped) {
            return baseColor
        }

        return nil
    }

    private func tileId(for point: CGPoint) -> Int? {
        let clampedX = max(0, min(1023.999, point.x))
        let clampedY = max(0, min(1023.999, point.y))
        let col = min(1, max(0, Int(clampedX / 512.0)))
        let row = min(1, max(0, Int(clampedY / 512.0)))
        let tileId = row * 2 + col
        return (0...3).contains(tileId) ? tileId : nil
    }

    private func convertToTileLocal(_ globalPoint: CGPoint, tileId: Int) -> CGPoint {
        let col = tileId % 2
        let row = tileId / 2
        return CGPoint(
            x: globalPoint.x - CGFloat(col) * 512.0,
            y: globalPoint.y - CGFloat(row) * 512.0
        )
    }

    private func colorIsVisible(_ color: Color) -> Bool {
        let alpha = UIColor(color).cgColor.alpha
        return alpha > 0.05
    }

    private func globalPoint(fromViewPoint viewPoint: CGPoint, canvasSize: CGFloat, viewport: CGRect) -> CGPoint {
        let globalX = viewport.minX + (viewPoint.x / canvasSize) * viewport.width
        let globalY = viewport.minY + (viewPoint.y / canvasSize) * viewport.height
        return CGPoint(
            x: max(0, min(1024, globalX)),
            y: max(0, min(1024, globalY))
        )
    }

    private func currentStrokePayload() -> String {
        if let emoji = selectedEmojiBrush {
            // IMPORTANT: Send the RAW emoji string directly to server
            // The emoji detection in GameState's sendStrokeSegment will identify it as an emoji
            print("🎨 [PAYLOAD] Emoji selected: '\(emoji)' - sending RAW emoji")
            return emoji  // Send raw emoji, not "emoji::🎨"
        }
        let colorPayload = selectedColor.toHex()
        print("🖌️ [PAYLOAD] Color selected: '\(colorPayload)'")
        return colorPayload
    }

    private func globalToViewPoint(_ globalPoint: CGPoint, viewport: CGRect, canvasSize: CGFloat) -> CGPoint {
        // Convert global canvas coords (0-1024) to view coords (0-canvasSize)
        let localX = globalPoint.x - viewport.minX  // Relative to viewport
        let localY = globalPoint.y - viewport.minY

        let viewX = (localX / viewport.width) * canvasSize
        let viewY = (localY / viewport.height) * canvasSize

        return CGPoint(x: viewX, y: viewY)
    }

    private func getTileRect(tileId: Int) -> CGRect {
        let col = tileId % 2
        let row = tileId / 2
        return CGRect(
            x: CGFloat(col) * 512.0,
            y: CGFloat(row) * 512.0,
            width: 512.0,
            height: 512.0
        )
    }

    private func isTileVisible(tileId: Int, viewport: CGRect) -> Bool {
        let tileRect = getTileRect(tileId: tileId)
        return !viewport.intersection(tileRect).isNull
    }

    // Convert global canvas coordinates to view coordinates (viewport-aware)
    private func convertToViewX(globalX: CGFloat, canvasSize: CGFloat) -> CGFloat {
        // Use 256 viewport width
        (globalX / 256.0) * canvasSize
    }

    private func convertToViewY(globalY: CGFloat, canvasSize: CGFloat) -> CGFloat {
        (globalY / 256.0) * canvasSize
    }

    private func convertToViewWidth(globalWidth: CGFloat, canvasSize: CGFloat) -> CGFloat {
        (globalWidth / 256.0) * canvasSize
    }

    private func convertToViewHeight(globalHeight: CGFloat, canvasSize: CGFloat) -> CGFloat {
        (globalHeight / 256.0) * canvasSize
    }

    @ViewBuilder
    private func renderFloatingText(_ floatingText: FloatingText, at globalPoint: CGPoint, viewport: CGRect, canvasSize: CGFloat) -> some View {
        if viewport.contains(globalPoint) {
            let localX = globalPoint.x - viewport.minX
            let localY = globalPoint.y - viewport.minY
            let viewX = convertToViewX(globalX: localX, canvasSize: canvasSize)
            let viewY = convertToViewY(globalY: localY, canvasSize: canvasSize)

            let elapsed = Date().timeIntervalSince(floatingText.timestamp)
            let progress = min(1.0, elapsed / 2.0)
            let offsetY = -30.0 * progress  // Float upward
            let opacity = 1.0 - progress

            Text(floatingText.text)
                .appFont(14, weight: .bold)
                .foregroundColor(floatingText.isPositive ? .green : .red)
                .shadow(color: .black.opacity(0.8), radius: 2, x: 0, y: 0)
                .offset(y: offsetY)
                .opacity(opacity)
                .position(x: viewX, y: viewY - 40)
        }
    }
}

struct HitFlashView: View {
    let color: Color
    let timestamp: Date
    let diameter: CGFloat

    var body: some View {
        TimelineView(.animation) { context in
            let progress = min(max(context.date.timeIntervalSince(timestamp) / 0.4, 0), 1)
            Circle()
                .stroke(color.opacity(1 - progress), lineWidth: 4)
                .frame(width: diameter * (0.7 + 0.5 * progress), height: diameter * (0.7 + 0.5 * progress))
        }
    }
}

#Preview {
    NewCanvasView(
        selectedColor: .constant(.red),
        brushSize: .constant(8),
        pipetteActive: .constant(false),
        selectedEmojiBrush: .constant(nil)
    )
    .environmentObject(GameState())
}
