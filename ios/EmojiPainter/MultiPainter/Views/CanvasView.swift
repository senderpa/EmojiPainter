//
//  CanvasView.swift
//  MultiPainter
//
//  Created by Claude Code - COMPLETE REWRITE
//

import SwiftUI

struct CanvasView: View {
    @EnvironmentObject var gameManager: GameManager
    @StateObject private var drawingManager = DrawingManager()
    @State private var currentTileId: Int = 0

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Background
                Color.black.edgesIgnoringSafeArea(.all)

                // Single Tile View (Zoomed)
                ZStack {
                    // Tile background image
                    if let image = gameManager.tileImages[currentTileId] {
                        Image(uiImage: image)
                            .resizable()
                            .aspectRatio(1.0, contentMode: .fit)
                    } else {
                        Rectangle()
                            .fill(Color.gray.opacity(0.2))
                            .aspectRatio(1.0, contentMode: .fit)
                    }

                    // PERSISTENT Remote strokes overlay
                    RemoteStrokesOverlay(
                        drawingManager: drawingManager,
                        currentTileId: currentTileId
                    )

                    // Drawing overlay (my strokes)
                    DrawingOverlay(
                        drawingManager: drawingManager,
                        currentTileId: currentTileId,
                        tileSize: geometry.size.width
                    )

                    // MY emoji cursor
                    if let myPosition = gameManager.myPosition,
                       let profile = gameManager.currentProfile {
                        CustomEmojiView(profile.emoji, size: 32, revealOnTap: false)
                            .position(myPosition)
                            .shadow(color: .black.opacity(0.3), radius: 2, x: 0, y: 2)
                    }

                    // OTHER PLAYERS' emoji cursors
                    ForEach(Array(gameManager.playerPositions.keys), id: \.self) { userId in
                        if let playerPos = gameManager.playerPositions[userId],
                           playerPos.tileId == currentTileId,
                           userId != gameManager.userId {
                            PlayerCursor(
                                emoji: playerPos.emoji,
                                x: playerPos.x,
                                y: playerPos.y,
                                tileSize: geometry.size.width
                            )
                        }
                    }
                }
                .aspectRatio(1.0, contentMode: .fit)
                .overlay(
                    // Tile info overlay
                    VStack {
                        HStack {
                            // Tile indicator
                            Text("Tile \(currentTileId)")
                                .appFont(16, weight: .bold)
                                .foregroundColor(.white)
                                .padding(8)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(currentTileId == gameManager.activeTileId ? Color.green.opacity(0.8) : Color.black.opacity(0.6))
                                )

                            Spacer()

                            // Countdown
                            if let countdown = gameManager.tileCountdowns[currentTileId] {
                                Text("\(countdown.countdown)s")
                                    .appFont(16, weight: .bold)
                                    .foregroundColor(.white)
                                    .padding(8)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color.black.opacity(0.6))
                                    )
                            }
                        }
                        .padding()

                        Spacer()
                    }
                )
                .overlay(
                    // AI Processing overlay
                    Group {
                        if gameManager.processingTiles.contains(currentTileId) {
                            VStack(spacing: 8) {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .scaleEffect(1.5)

                                Text("AI Processing...")
                                    .appFont(14, weight: .semibold)
                                    .foregroundColor(.white)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color.black.opacity(0.7))
                        }
                    }
                )

                // Tile navigation overlay
                VStack {
                    Spacer()

                    TileNavigator(currentTileId: $currentTileId, activeTileId: gameManager.activeTileId)
                        .padding(.bottom, 20)
                }
            }
        }
        .onAppear {
            drawingManager.gameManager = gameManager
            // Start on my spawned tile
            currentTileId = gameManager.myCurrentTile
        }
    }
}

// MARK: - Player Cursor
struct PlayerCursor: View {
    let emoji: String
    let x: Double
    let y: Double
    let tileSize: CGFloat

    var body: some View {
        CustomEmojiView(emoji, size: 32, revealOnTap: false)
            .position(x: CGFloat(x) * tileSize / 512.0, y: CGFloat(y) * tileSize / 512.0)
            .shadow(color: .black.opacity(0.3), radius: 2, x: 0, y: 2)
    }
}

// MARK: - Tile Navigator
struct TileNavigator: View {
    @Binding var currentTileId: Int
    let activeTileId: Int

    var body: some View {
        HStack(spacing: 12) {
            ForEach(0..<4) { tileId in
                Button(action: {
                    currentTileId = tileId
                }) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(tileId == currentTileId ? Color.blue : Color.white.opacity(0.3))
                            .frame(width: 50, height: 50)

                        if tileId == activeTileId {
                            Circle()
                                .fill(Color.green)
                                .frame(width: 8, height: 8)
                                .offset(x: 18, y: -18)
                        }

                        Text("\(tileId)")
                            .appFont(18, weight: .bold)
                            .foregroundColor(.white)
                    }
                }
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.black.opacity(0.6))
        )
    }
}

// MARK: - Remote Strokes Overlay (PERSISTENT!)
struct RemoteStrokesOverlay: View {
    @ObservedObject var drawingManager: DrawingManager
    let currentTileId: Int

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Render ALL remote strokes for this tile (they persist!)
                ForEach(drawingManager.remoteStrokes.filter { $0.tileId == currentTileId }) { stroke in
                    Path { path in
                        guard !stroke.points.isEmpty else { return }

                        let tileSize = geometry.size.width

                        // Scale from 512 to view size
                        let scaledPoints = stroke.points.map { point in
                            CGPoint(
                                x: point.x * tileSize / 512.0,
                                y: point.y * tileSize / 512.0
                            )
                        }

                        guard !scaledPoints.isEmpty else { return }

                        path.move(to: scaledPoints[0])
                        for point in scaledPoints.dropFirst() {
                            path.addLine(to: point)
                        }
                    }
                    .stroke(stroke.color, style: StrokeStyle(lineWidth: stroke.width, lineCap: .round, lineJoin: .round))
                }
            }
        }
    }
}

// MARK: - Drawing Overlay
struct DrawingOverlay: View {
    @ObservedObject var drawingManager: DrawingManager
    let currentTileId: Int
    let tileSize: CGFloat

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // My current stroke (being drawn)
                if !drawingManager.currentPoints.isEmpty {
                    Path { path in
                        guard !drawingManager.currentPoints.isEmpty else { return }

                        path.move(to: drawingManager.currentPoints[0])
                        for point in drawingManager.currentPoints.dropFirst() {
                            path.addLine(to: point)
                        }
                    }
                    .stroke(drawingManager.currentColor, style: StrokeStyle(lineWidth: drawingManager.brushSize, lineCap: .round, lineJoin: .round))
                }
            }
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        drawingManager.handleDragChanged(value, in: geometry.size, tileId: currentTileId)
                    }
                    .onEnded { value in
                        drawingManager.handleDragEnded(value, in: geometry.size)
                    }
            )
        }
    }
}

// MARK: - Drawing Manager
class DrawingManager: ObservableObject {
    @Published var currentPoints: [CGPoint] = []
    @Published var remoteStrokes: [Stroke] = [] // Now persists!
    @Published var brushSize: CGFloat = 8
    @Published var currentColor: Color = .red

    weak var gameManager: GameManager?
    private var lastPoint: CGPoint?
    private var remoteStrokeBuffers: [Int: [Int: [CGPoint]]] = [:] // [tileId: [userId: points]]

    struct Stroke: Identifiable {
        let id = UUID()
        var points: [CGPoint]
        let color: Color
        let width: CGFloat
        var tileId: Int
    }

    init() {
        setupStrokeBroadcastListener()
        setupBrushSettingsListener()
    }

    private func setupStrokeBroadcastListener() {
        NotificationCenter.default.addObserver(
            forName: .strokeBroadcastReceived,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let data = notification.userInfo?["data"] as? Data else { return }
            self?.handleRemoteStroke(data)
        }
    }

    private func setupBrushSettingsListener() {
        NotificationCenter.default.addObserver(
            forName: .brushSettingsChanged,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let userInfo = notification.userInfo else { return }
            if let color = userInfo["color"] as? Color {
                self?.currentColor = color
            }
            if let size = userInfo["size"] as? Double {
                self?.brushSize = CGFloat(size)
            }
        }
    }

    func handleDragChanged(_ value: DragGesture.Value, in size: CGSize, tileId: Int) {
        let point = value.location

        // Add point to current stroke
        currentPoints.append(point)

        // Convert to 512x512 tile-local coordinates
        let localPoint = CGPoint(
            x: point.x * 512.0 / size.width,
            y: point.y * 512.0 / size.height
        )

        // Send to server
        if let lastPoint = lastPoint {
            let lastLocal = CGPoint(
                x: lastPoint.x * 512.0 / size.width,
                y: lastPoint.y * 512.0 / size.height
            )

            // Convert to global coordinates for server
            let globalFrom = tileLocalToGlobal(lastLocal, tileId: tileId)
            let globalTo = tileLocalToGlobal(localPoint, tileId: tileId)

            gameManager?.sendStroke(
                fromX: globalFrom.x,
                fromY: globalFrom.y,
                toX: globalTo.x,
                toY: globalTo.y,
                brushSize: Double(brushSize),
                color: currentColor.toHex()
            )
        }

        // Update my cursor position
        gameManager?.updateMyPosition(point)
        gameManager?.sendCursorMove(x: localPoint.x, y: localPoint.y)

        lastPoint = point
    }

    func handleDragEnded(_ value: DragGesture.Value, in size: CGSize) {
        currentPoints.removeAll()
        lastPoint = nil
    }

    private func handleRemoteStroke(_ data: Data) {
        guard let broadcast = try? JSONDecoder().decode(StrokeBroadcast.self, from: data) else {
            return
        }

        // Don't render my own strokes from server
        if broadcast.userId == gameManager?.userId {
            return
        }

        let tileId = broadcast.tileId
        let userId = broadcast.userId

        // Initialize buffer for this tile/user if needed
        if remoteStrokeBuffers[tileId] == nil {
            remoteStrokeBuffers[tileId] = [:]
        }
        if remoteStrokeBuffers[tileId]?[userId] == nil {
            remoteStrokeBuffers[tileId]?[userId] = []
        }

        // Add points to buffer
        let fromPoint = CGPoint(x: broadcast.segment.localFromX, y: broadcast.segment.localFromY)
        let toPoint = CGPoint(x: broadcast.segment.localToX, y: broadcast.segment.localToY)

        if remoteStrokeBuffers[tileId]?[userId]?.isEmpty ?? true {
            remoteStrokeBuffers[tileId]?[userId]?.append(fromPoint)
        }
        remoteStrokeBuffers[tileId]?[userId]?.append(toPoint)

        // Get color (FIX: Actually use the color!)
        let colorString = broadcast.segment.color ?? "#000000"
        // Check if this is an emoji stroke (encoded as "emoji::🎨" in color field)
        let isEmojiBrush = colorString.hasPrefix("emoji::")
        let color = isEmojiBrush ? Color.white : Color(hex: colorString)

        // Create/update persistent stroke
        let stroke = Stroke(
            points: remoteStrokeBuffers[tileId]?[userId] ?? [],
            color: color,
            width: CGFloat(broadcast.segment.brushSize),
            tileId: tileId
        )

        // Update or add stroke
        if let existingIndex = remoteStrokes.firstIndex(where: { $0.tileId == tileId && $0.points.count > 0 && $0.color == color }) {
            remoteStrokes[existingIndex] = stroke
        } else {
            remoteStrokes.append(stroke)
        }
    }

    private func tileLocalToGlobal(_ point: CGPoint, tileId: Int) -> CGPoint {
        let col = tileId % 2
        let row = tileId / 2

        let globalX = Double(col) * 512.0 + point.x
        let globalY = Double(row) * 512.0 + point.y

        return CGPoint(x: globalX, y: globalY)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

extension Notification.Name {
    static let brushSettingsChanged = Notification.Name("brushSettingsChanged")
}
