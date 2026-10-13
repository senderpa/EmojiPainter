//
//  OverlayTransitions.swift
//  MultiPainter
//
//  Created by Claude Code - Enhanced Animations
//

import SwiftUI

/// Enhanced overlay transition animations for smooth UI transitions
struct OverlayTransitions {

    // MARK: - Slide Transitions
    static func slideFromRight() -> AnyTransition {
        .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .trailing).combined(with: .opacity)
        )
    }

    static func slideFromLeft() -> AnyTransition {
        .asymmetric(
            insertion: .move(edge: .leading).combined(with: .opacity),
            removal: .move(edge: .leading).combined(with: .opacity)
        )
    }

    static func slideFromTop() -> AnyTransition {
        .asymmetric(
            insertion: .move(edge: .top).combined(with: .opacity),
            removal: .move(edge: .top).combined(with: .opacity)
        )
    }

    static func slideFromBottom() -> AnyTransition {
        .asymmetric(
            insertion: .move(edge: .bottom).combined(with: .opacity),
            removal: .move(edge: .bottom).combined(with: .opacity)
        )
    }

    // MARK: - Scale Transitions
    static func scaleWithFade() -> AnyTransition {
        .asymmetric(
            insertion: .scale(scale: 0.8).combined(with: .opacity),
            removal: .scale(scale: 0.8).combined(with: .opacity)
        )
    }

    static func scaleSpring() -> AnyTransition {
        .asymmetric(
            insertion: .scale(scale: 0.5, anchor: .center).combined(with: .opacity),
            removal: .scale(scale: 1.2, anchor: .center).combined(with: .opacity)
        )
    }

    // MARK: - Custom Transitions
    static func pushFromRight() -> AnyTransition {
        .asymmetric(
            insertion: .move(edge: .trailing),
            removal: .move(edge: .leading)
        )
    }

    static func modalPresentation() -> AnyTransition {
        .asymmetric(
            insertion: .move(edge: .bottom).combined(with: .opacity),
            removal: .move(edge: .bottom).combined(with: .opacity)
        )
    }

    // MARK: - Animation Styles
    static let smoothSpring = Animation.spring(response: 0.4, dampingFraction: 0.8, blendDuration: 0.3)
    static let bouncy = Animation.spring(response: 0.5, dampingFraction: 0.6, blendDuration: 0.3)
    static let quick = Animation.easeOut(duration: 0.25)
    static let smooth = Animation.easeInOut(duration: 0.35)
    static let slow = Animation.easeInOut(duration: 0.5)
}

/// View modifier for animated overlay presentation
struct AnimatedOverlay<OverlayContent: View>: ViewModifier {
    let isPresented: Bool
    let transition: AnyTransition
    let animation: Animation
    let overlayContent: () -> OverlayContent

    func body(content: Content) -> some View {
        ZStack {
            content

            if isPresented {
                overlayContent()
                    .transition(transition)
                    .zIndex(100)
            }
        }
        .animation(animation, value: isPresented)
    }
}

extension View {
    func animatedOverlay<OverlayContent: View>(
        isPresented: Bool,
        transition: AnyTransition = OverlayTransitions.modalPresentation(),
        animation: Animation = OverlayTransitions.smoothSpring,
        @ViewBuilder content: @escaping () -> OverlayContent
    ) -> some View {
        self.modifier(AnimatedOverlay(
            isPresented: isPresented,
            transition: transition,
            animation: animation,
            overlayContent: content
        ))
    }
}
