//
//  CloseButton.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI

struct CloseButton: View {
    let action: () -> Void
    @State private var isPressed = false

    var body: some View {
        Button(action: {
            // Haptic feedback
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()

            // Animate to ✳️ then close
            withAnimation(.easeInOut(duration: 0.15)) {
                isPressed = true
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                action()
            }
        }) {
            Text(isPressed ? "✳️" : "❎")
                .font(.system(size: 28))
                .frame(width: 44, height: 44)
                .background(
                    Circle()
                        .fill(Color.black.opacity(0.3))
                )
        }
        .scaleEffect(isPressed ? 1.2 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.5), value: isPressed)
    }
}

#Preview {
    ZStack {
        Color.gray
        CloseButton {
            print("Closed")
        }
    }
}
