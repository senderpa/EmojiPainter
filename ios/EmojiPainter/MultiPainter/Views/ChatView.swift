//
//  ChatView.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI

struct ChatView: View {
    @EnvironmentObject var gameManager: GameManager
    @Binding var isPresented: Bool
    @State private var messageText = ""
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Chat")
                    .appFont(20, weight: .bold)
                    .foregroundColor(.white)

                Spacer()

                Button(action: {
                    isPresented = false
                }) {
                    Image(systemName: "chevron.down.circle.fill")
                        .appFont(24)
                        .foregroundColor(.white.opacity(0.8))
                }
            }
            .padding()
            .background(Color.black.opacity(0.9))

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(gameManager.chatMessages) { message in
                            ChatMessageRow(message: message)
                                .id(message.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: gameManager.chatMessages.count) { _ in
                    if let lastMessage = gameManager.chatMessages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }
            .background(Color.black.opacity(0.7))

            // Input
            HStack(spacing: 12) {
                TextField("Type a message...", text: $messageText)
                    .textFieldStyle(ChatTextFieldStyle())
                    .focused($isInputFocused)
                    .onSubmit {
                        sendMessage()
                    }

                Button(action: {
                    sendMessage()
                }) {
                    Image(systemName: "paperplane.fill")
                        .appFont(20)
                        .foregroundColor(messageText.isEmpty ? .white.opacity(0.3) : .blue)
                        .frame(width: 44, height: 44)
                        .background(
                            Circle()
                                .fill(Color.white.opacity(0.1))
                        )
                }
                .disabled(messageText.isEmpty)
            }
            .padding()
            .background(Color.black.opacity(0.9))
        }
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.black.opacity(0.95))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.white.opacity(0.2), lineWidth: 1)
        )
        .shadow(radius: 20)
        .padding()
    }

    private func sendMessage() {
        guard !messageText.isEmpty else { return }

        gameManager.sendChat(messageText)
        messageText = ""
    }
}

struct ChatMessageRow: View {
    let message: ChatBroadcast

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Avatar
            CustomEmojiView(message.emoji, size: 24)
                .frame(width: 36, height: 36)
                .background(
                    Circle()
                        .fill(Color.white.opacity(0.1))
                )

            // Message content
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(message.username)
                        .appFont(14, weight: .semibold)
                        .foregroundColor(.white)

                    if message.isBot {
                        Text("BOT")
                            .appFont(9, weight: .bold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .background(
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Color.purple)
                            )
                    }

                    Spacer()

                    Text(timeString(from: message.timestamp))
                        .appFont(11)
                        .foregroundColor(.white.opacity(0.5))
                }

                Text(message.text)
                    .appFont(15)
                    .foregroundColor(.white.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(message.userId == -1 ? 0.05 : 0.08))
        )
    }

    private func timeString(from timestamp: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(timestamp) / 1000)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}

struct ChatTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 22)
                    .fill(Color.white.opacity(0.1))
            )
            .foregroundColor(.white)
            .appFont(16)
    }
}

#Preview {
    ChatView(isPresented: .constant(true))
        .environmentObject(GameManager())
}
