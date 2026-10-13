import SwiftUI

// MARK: - Waiting List View
struct WaitingListView: View {
    let players: [Player]
    let position: Int
    let timeRemaining: Int
    @EnvironmentObject var gameState: GameState
    @State private var chatInput: String = ""
    @FocusState private var isChatFocused: Bool

    var body: some View {
        VStack(spacing: 16) {
            // Header
            Text("Waiting List")
                .appFont(28, weight: .bold)
                .foregroundColor(.white)

            Text("Your Position: #\(position)")
                .appFont(36, weight: .bold)
                .foregroundColor(.yellow)

            Text("Time Remaining: \(timeRemaining)s")
                .appFont(18, weight: .semibold)
                .foregroundColor(timeRemaining <= 10 ? .red : .white)

            Divider()
                .background(Color.white.opacity(0.3))
                .padding(.vertical, 8)

            // Live Chat
            VStack(alignment: .leading, spacing: 8) {
                EmojiLabel("💬 Live Chat", size: 18, weight: .bold, color: .white)

                ScrollView {
                    VStack(spacing: 8) {
                        if gameState.chatMessages.isEmpty {
                            VStack(spacing: 12) {
                                CustomEmojiView("💭", size: 48, revealOnTap: false)
                                Text("No messages yet")
                                    .appFont(14, weight: .medium)
                                    .foregroundColor(.white.opacity(0.6))
                                Text("Be the first to chat!")
                                    .appFont(12)
                                    .foregroundColor(.white.opacity(0.4))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 30)
                        } else {
                            ForEach(gameState.chatMessages.suffix(20)) { message in
                                HStack(alignment: .top, spacing: 10) {
                                    CustomEmojiView(message.emoji, size: 20)

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(message.username)
                                            .appFont(12, weight: .bold)
                                            .foregroundColor(.yellow)

                                        Text(message.text)
                                            .appFont(14, weight: .medium)
                                            .foregroundColor(.white)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }

                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 12)
                                        .fill(Color.white.opacity(0.12))
                                )
                            }
                        }
                    }
                }
                .frame(maxHeight: 200)
            }

            Divider()
                .background(Color.white.opacity(0.3))

            // Big Chat Input Field
            VStack(spacing: 12) {
                EmojiLabel("💬 Send a message", size: 14, weight: .semibold, color: .white.opacity(0.7))

                HStack(spacing: 12) {
                    TextField("Type your message...", text: $chatInput)
                        .appFont(18, weight: .medium)
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color.white.opacity(0.15))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(isChatFocused ? Color.purple : Color.white.opacity(0.3), lineWidth: 2)
                                )
                        )
                        .focused($isChatFocused)
                        .submitLabel(.send)
                        .onSubmit {
                            sendMessage()
                        }

                    Button(action: sendMessage) {
                        Image(systemName: "paperplane.fill")
                            .appFont(20)
                            .foregroundColor(.white)
                            .frame(width: 50, height: 50)
                            .background(
                                Circle()
                                    .fill(chatInput.isEmpty ? Color.gray : Color.purple)
                            )
                    }
                    .disabled(chatInput.isEmpty)
                }
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.black.opacity(0.7))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.purple.opacity(0.3), lineWidth: 2)
                )
        )
    }

    private func sendMessage() {
        let trimmed = chatInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        gameState.sendChat(trimmed)
        chatInput = ""
        isChatFocused = false
    }
}

// MARK: - Info Bubble
struct InfoBubble: View {
    let text: String

    var body: some View {
        Text(text)
            .appFont(14, weight: .semibold)
            .foregroundColor(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color.orange)
                    .shadow(color: .black.opacity(0.3), radius: 10, x: 0, y: 5)
            )
    }
}

// MARK: - Timelapse Preview
struct TimelapsePreview: View {
    let timelapseImage: UIImage?
    var updateKey: Date? = nil   // kept for call-site compatibility; not used for transitions

    var body: some View {
        ZStack {
            if let image = timelapseImage {
                // Bind the image DIRECTLY (in-place pixel swap) — no .id/.transition,
                // which previously removed+reinserted the view and flashed black.
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.high)
                    .antialiased(true)
                    .aspectRatio(1, contentMode: .fit)
            } else {
                LinearGradient(
                    colors: [Color.black.opacity(0.5), Color.gray.opacity(0.2)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .overlay(
                    VStack(spacing: 12) {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        Text("Loading preview…")
                            .appFont(14, weight: .medium)
                            .foregroundColor(.white.opacity(0.8))
                    }
                )
            }
        }
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.25), radius: 12, x: 0, y: 6)
    }
}

/// Big 🔄 that idles with a slow continuous spin, bursts faster on tap (with a
/// short cool-off so it can't be spammed), and spins fast while loading.
struct RefreshSpinButton: View {
    var isLoading: Bool
    var action: () -> Void

    @State private var angle: Double = 0
    @State private var fastTicks: Int = 0   // remaining fast-spin frames after a tap
    private let tick = Timer.publish(every: 0.03, on: .main, in: .common).autoconnect()

    var body: some View {
        Button(action: {
            guard fastTicks == 0 else { return }   // cool-off: ignore taps mid-burst
            action()
            fastTicks = 45                          // ~1.35s fast spin burst
        }) {
            Text("🔄")
                .font(.system(size: 34))
                .rotationEffect(.degrees(angle))
                .frame(width: 56, height: 56)
                .shadow(color: .black.opacity(0.55), radius: 4, x: 0, y: 1)  // legible, no panel
                .opacity(fastTicks > 0 ? 0.9 : 1)
        }
        .onReceive(tick) { _ in
            let fast = fastTicks > 0 || isLoading
            angle += fast ? 17 : 2.5            // fast burst / loading vs slow idle spin
            if angle >= 360 { angle -= 360 }
            if fastTicks > 0 { fastTicks -= 1 }
        }
    }
}

struct AnimatedEmojiChatButton: View {
    @State private var currentEmojiIndex = 0
    @State private var timer: Timer?
    @State private var animationTrigger = false
    let emojis = ["💬", "🗯️", "💭"]
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            CustomEmojiView(emojis[currentEmojiIndex], size: 32, revealOnTap: false)
                .frame(width: 48, height: 48)
                .background(
                    Circle()
                        .fill(Color.black.opacity(0.5))
                )
                .overlay(
                    Circle()
                        .stroke(Color.white.opacity(0.3), lineWidth: 1)
                )
                .scaleEffect(animationTrigger ? 1.1 : 1.0)
        }
        .onAppear {
            startTimer()
        }
        .onDisappear {
            timer?.invalidate()
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.6), value: animationTrigger)
    }

    private func startTimer() {
        timer?.invalidate()
        let interval = Double.random(in: 1...3)
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { _ in
            currentEmojiIndex = Int.random(in: 0..<emojis.count)
            animationTrigger.toggle()
            startTimer()
        }
    }
}

// MARK: - Mini Chat Overlay
struct MiniChatOverlay: View {
    @EnvironmentObject var gameState: GameState
    let messages: [ChatBroadcast]
    let onClose: () -> Void

    @State private var chatText = ""
    @FocusState private var isChatFocused: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Lobby Chat")
                    .appFont(12, weight: .semibold)
                    .foregroundColor(.white.opacity(0.8))

                Spacer()

                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill")
                        .appFont(16)
                        .foregroundColor(.white.opacity(0.8))
                }
            }

            Divider()
                .background(Color.white.opacity(0.2))

            ScrollView {
                VStack(spacing: 6) {
                    ForEach(messages.suffix(5)) { message in
                        HStack(spacing: 6) {
                            CustomEmojiView(message.emoji, size: 14)

                            Text(message.text)
                                .appFont(12)
                                .foregroundColor(.white)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)

                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.black.opacity(0.6))
                        )
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
            }
            .frame(maxHeight: 200)

            // Chat Input
            HStack(spacing: 8) {
                TextField("Type message...", text: $chatText)
                    .appFont(14)
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.black.opacity(0.6))
                    )
                    .focused($isChatFocused)
                    .onSubmit {
                        sendChat()
                    }

                Button(action: {
                    sendChat()
                }) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(chatText.isEmpty ? .gray : .blue)
                }
                .disabled(chatText.isEmpty)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: messages.count)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.white.opacity(0.18))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.white.opacity(0.2), lineWidth: 1)
                )
        )
    }

    private func sendChat() {
        let trimmed = chatText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Use gameState's sendChat method like other parts of the app
        gameState.sendChat(trimmed)

        // Clear the text field
        chatText = ""

        // Haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
    }
}

#Preview {
    NewLobbyView()
        .environmentObject(GameState())
}

// MARK: - Interactive Lobby Title
struct InteractiveLobbyTitle: View {
    let previewFrame: CGRect
    let containerSize: CGSize

    private struct LetterState: Identifiable {
        let id: Int
        let char: String
        var origin: CGPoint
        var position: CGPoint
        var velocity: CGSize
    }

    @State private var letters: [LetterState] = []
    @State private var physicsActive = false
    @State private var lastInteractionTime = Date()
    @State private var entranceComplete = false
    private let timer = Timer.publish(every: 1.0 / 60.0, on: .main, in: .common).autoconnect()
    private let idleTimeout: TimeInterval = 60

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(letters) { letter in
                    ZStack {
                        Text(letter.char)
                            .appFont(36, weight: .heavy)
                            .foregroundColor(.black.opacity(0.7))
                            .offset(x: 2, y: 2)
                        Text(letter.char)
                            .appFont(36, weight: .heavy)
                            .foregroundColor(.white)
                    }
                    .shadow(color: Color.black.opacity(0.45), radius: 14, x: 0, y: 8)
                    .scaleEffect(1.0 + min(0.25, letter.velocity.magnitude / 90))
                    .rotationEffect(.degrees(Double(letter.velocity.width * 0.4)))
                    .position(letter.position)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        // Only allow user interaction after entrance is complete
                        if entranceComplete {
                            physicsActive = true
                            lastInteractionTime = Date()
                            applyImpulse(at: value.location)
                        }
                    }
                    .onEnded { _ in
                        if entranceComplete {
                            lastInteractionTime = Date()
                        }
                    }
            )
            .onAppear {
                setupLetters(width: geo.size.width, height: geo.size.height)
            }
            .onChange(of: geo.size) { newSize in
                resetOrigins(width: newSize.width, height: newSize.height)
            }
            .onReceive(timer) { _ in
                let localPreview = convertPreviewToLocal(geo: geo)
                updatePhysics(in: geo.size, previewRect: localPreview)

                // After entrance animation, deactivate physics to settle
                if entranceComplete && physicsActive {
                    physicsActive = false
                }

                // User interaction timeout (only after entrance is complete)
                if physicsActive && entranceComplete && Date().timeIntervalSince(lastInteractionTime) > idleTimeout {
                    physicsActive = false
                }
            }
        }
        .frame(height: 120)
    }

    private func setupLetters(width: CGFloat, height: CGFloat) {
        guard letters.isEmpty, width > 0 else { return }
        let chars = Array("LOBBY")
        let spacing = width / CGFloat(chars.count + 1)
        letters = chars.enumerated().map { index, char in
            let origin = CGPoint(x: spacing * CGFloat(index + 1), y: height / 2)
            // Start at final position with no velocity
            return LetterState(id: index, char: String(char), origin: origin, position: origin, velocity: .zero)
        }
        entranceComplete = true // Mark as complete immediately
    }

    private func resetOrigins(width: CGFloat, height: CGFloat) {
        guard !letters.isEmpty, width > 0 else { return }
        let spacing = width / CGFloat(letters.count + 1)
        letters = letters.enumerated().map { index, letter in
            var updated = letter
            let newOrigin = CGPoint(x: spacing * CGFloat(index + 1), y: height / 2)
            updated.origin = newOrigin
            updated.position = newOrigin
            updated.velocity = .zero
            return updated
        }
    }

    private func applyImpulse(at location: CGPoint) {
        let radius: CGFloat = 170
        letters = letters.map { letter in
            var updated = letter
            let dx = letter.position.x - location.x
            let dy = letter.position.y - location.y
            let distance = max(8, sqrt(dx * dx + dy * dy))
            if distance < radius {
                let force = (radius - distance) / radius * 34
                updated.velocity.width += (dx / distance) * force
                updated.velocity.height += (dy / distance) * force
            }
            return updated
        }
    }

    private func updatePhysics(in size: CGSize, previewRect: CGRect?) {
        guard size.width > 0 else { return }
        var states = letters
        let gravity: CGFloat = 1.2
        let padding: CGFloat = 48
        let minX = padding
        let maxX = size.width - padding
        let minY = padding
        let maxY = size.height - padding

        for index in states.indices {
            var updated = states[index]

            if physicsActive {
                updated.velocity.height += gravity
            } else {
                let spring: CGFloat = 0.04
                updated.velocity.width += (updated.origin.x - updated.position.x) * spring
                updated.velocity.height += (updated.origin.y - updated.position.y) * spring
            }

            let damping: CGFloat = physicsActive ? 0.99 : 0.85
            updated.velocity.width *= damping
            updated.velocity.height *= damping

            let maxSpeed: CGFloat = physicsActive ? 90 : 48
            let speed = updated.velocity.magnitude
            if speed > maxSpeed {
                let scale = maxSpeed / speed
                updated.velocity.width *= scale
                updated.velocity.height *= scale
            }

            updated.position.x += updated.velocity.width
            updated.position.y += updated.velocity.height

            if updated.position.x < minX {
                updated.position.x = minX
                updated.velocity.width *= -0.75
            } else if updated.position.x > maxX {
                updated.position.x = maxX
                updated.velocity.width *= -0.75
            }

            if updated.position.y < minY {
                updated.position.y = minY
                updated.velocity.height *= -0.75
            } else if updated.position.y > maxY {
                updated.position.y = maxY
                updated.velocity.height *= -0.75
            }

            if let preview = previewRect {
                resolvePreviewCollision(for: &updated, preview: preview)
            }

            states[index] = updated
        }

        let separation: CGFloat = 60
        for i in 0..<states.count {
            for j in (i + 1)..<states.count {
                var first = states[i]
                var second = states[j]
                let dx = first.position.x - second.position.x
                let dy = first.position.y - second.position.y
                let distance = max(8, sqrt(dx * dx + dy * dy))

                if distance < separation {
                    let overlap = separation - distance
                    let push = overlap / separation * 0.5
                    let normX = dx / distance
                    let normY = dy / distance

                    first.velocity.width += normX * push
                    first.velocity.height += normY * push
                    second.velocity.width -= normX * push
                    second.velocity.height -= normY * push
                }

                states[i] = first
                states[j] = second
            }
        }

        letters = states
    }

    private func convertPreviewToLocal(geo: GeometryProxy) -> CGRect? {
        guard previewFrame != .zero else { return nil }
        let globalFrame = geo.frame(in: .global)
        let intersection = previewFrame.intersection(CGRect(origin: .zero, size: containerSize))
        guard !intersection.isNull else { return nil }
        return CGRect(
            x: intersection.origin.x - globalFrame.origin.x,
            y: intersection.origin.y - globalFrame.origin.y,
            width: intersection.width,
            height: intersection.height
        )
    }

    private func resolvePreviewCollision(for letter: inout LetterState, preview: CGRect) {
        let radius: CGFloat = 32
        let collider = preview.insetBy(dx: -radius, dy: -radius)
        guard collider.contains(letter.position) else { return }

        let left = abs(letter.position.x - collider.minX)
        let right = abs(collider.maxX - letter.position.x)
        let top = abs(letter.position.y - collider.minY)
        let bottom = abs(collider.maxY - letter.position.y)
        let minValue = min(left, right, top, bottom)

        switch minValue {
        case left:
            letter.position.x = collider.minX
            letter.velocity.width = -abs(letter.velocity.width) * 0.6
        case right:
            letter.position.x = collider.maxX
            letter.velocity.width = abs(letter.velocity.width) * 0.6
        case top:
            letter.position.y = collider.minY
            letter.velocity.height = -abs(letter.velocity.height) * 0.6
        default:
            letter.position.y = collider.maxY
            letter.velocity.height = abs(letter.velocity.height) * 0.6
        }
    }
}

private extension CGSize {
    var magnitude: CGFloat {
        sqrt(width * width + height * height)
    }
}
