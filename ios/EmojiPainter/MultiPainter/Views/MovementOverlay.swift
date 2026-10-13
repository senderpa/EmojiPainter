//
//  MovementOverlay.swift
//  MultiPainter
//
//  Movement-only gesture (no drawing) - allows players to move around without painting
//

import SwiftUI

struct MovementOverlay: View {
    @EnvironmentObject var gameState: GameState
    @Binding var isMovementMode: Bool

    var body: some View {
        GeometryReader { geometry in
            let viewport = gameState.viewportRect

            Color.clear
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            if isMovementMode {
                                handleMovement(value, viewSize: geometry.size.width, viewport: viewport)
                            }
                        }
                )
        }
    }

    private func handleMovement(_ value: DragGesture.Value, viewSize: CGFloat, viewport: CGRect) {
        let viewPoint = value.location

        // Convert view coordinates to global canvas coordinates
        let globalX = viewport.minX + (viewPoint.x / viewSize) * 512.0
        let globalY = viewport.minY + (viewPoint.y / viewSize) * 512.0
        let globalPoint = CGPoint(x: globalX, y: globalY)

        // Update player position locally
        gameState.movePlayer(to: globalPoint)

        // Send cursor_move to server (for other players to see position)
        gameState.webSocketService.sendCursorMove(x: globalX, y: globalY)
    }
}
