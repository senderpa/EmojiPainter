//
//  ConnectionView.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI

struct ConnectionView: View {
    @EnvironmentObject var gameState: GameState
    @State private var progress: Double = 0
    @State private var timer: Timer?

    private var logoSize: CGFloat {
        // Fullscreen size matching lobby preview (350px)
        UIDevice.current.userInterfaceIdiom == .pad ? 450 : 350
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black, Color(white: 0.1)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 30) {
                Spacer()
                // Logo
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: logoSize, height: logoSize)
                    .clipShape(RoundedRectangle(cornerRadius: 30))
                    .shadow(color: .black.opacity(0.3), radius: 10, x: 0, y: 5)

                VStack(spacing: 12) {
                    ProgressView(value: progress)
                        .progressViewStyle(LinearProgressViewStyle(tint: .white))
                        .frame(width: min(logoSize, 320))
                        .shadow(color: .black.opacity(0.2), radius: 6, x: 0, y: 3)

                    Text("Loading lobby preview…")
                        .appFont(18, weight: .semibold)
                        .foregroundColor(.white)
                }

                Spacer()
            }
        }
        .onAppear(perform: startProgressLoop)
        .onDisappear(perform: stopProgressLoop)
    }

    private func startProgressLoop() {
        stopProgressLoop()
        progress = 0
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [self] timer in
            let next = progress + Double.random(in: 0.01...0.04)
            if next >= 1.0 {
                progress = 1.0
                timer.invalidate()
            } else {
                progress = next
            }
        }
    }

    private func stopProgressLoop() {
        timer?.invalidate()
        timer = nil
    }
}

#Preview {
    ConnectionView()
        .environmentObject(GameState())
}
