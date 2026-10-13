//
//  WebSocketService.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation
import Combine

protocol WebSocketServiceDelegate: AnyObject {
    func webSocketDidReceiveMessage(_ message: String)
}

class WebSocketService: NSObject, ObservableObject {
    @Published var isConnected = false
    @Published var connectionStatusDescription = "Not connected"

    weak var delegate: WebSocketServiceDelegate?
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5
    private let reconnectDelay: TimeInterval = 3.0
    private var userInitiatedDisconnect = false

    private let serverURL = URL(string: "wss://some-sender.gotdns.ch:4850/ws")!

    func connect() {
        guard webSocketTask == nil else {
            print("🔁 [WS] Already connecting/connected")
            return
        }

        userInitiatedDisconnect = false
        connectionStatusDescription = "Connecting to server..."
        print("🔌 [WS] Connecting to \(serverURL)...")
        let config = URLSessionConfiguration.default
        config.urlCache = nil

        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        self.session = session
        webSocketTask = session.webSocketTask(with: serverURL)
        webSocketTask?.maximumMessageSize = 10 * 1024 * 1024  // 10MB
        webSocketTask?.resume()
        reconnectAttempts = 0
        receiveMessage()
    }

    func disconnect() {
        userInitiatedDisconnect = true
        connectionStatusDescription = "Disconnected"
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        session = nil
        isConnected = false
        print("WebSocket disconnected")
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }

            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    DispatchQueue.main.async {
                        self.delegate?.webSocketDidReceiveMessage(text)
                    }
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async {
                            self.delegate?.webSocketDidReceiveMessage(text)
                        }
                    }
                @unknown default:
                    break
                }

                // Continue receiving
                self.receiveMessage()

            case .failure(let error):
                print("WebSocket receive error: \(error)")
                self.connectionStatusDescription = "Receive error: \(error.localizedDescription)"
                self.handleConnectionFailure()
            }
        }
    }

    private func handleConnectionFailure() {
        DispatchQueue.main.async {
            self.isConnected = false
        }

        guard !userInitiatedDisconnect else {
            connectionStatusDescription = "Disconnected"
            return
        }

        guard reconnectAttempts < maxReconnectAttempts else {
            print("Max reconnect attempts reached")
            connectionStatusDescription = "Failed to reconnect (\(reconnectAttempts) attempts)"
            return
        }

        reconnectAttempts += 1
        let attemptText = "Reconnecting in \(Int(reconnectDelay))s… (attempt \(reconnectAttempts)/\(maxReconnectAttempts))"
        connectionStatusDescription = attemptText
        print(attemptText)

        DispatchQueue.main.asyncAfter(deadline: .now() + reconnectDelay) { [weak self] in
            guard let self = self else { return }
            self.webSocketTask = nil
            self.connect()
        }
    }

    func send<T: Encodable>(_ message: T) {
        guard let data = try? JSONEncoder().encode(message),
              let string = String(data: data, encoding: .utf8) else {
            print("❌ Failed to encode message")
            return
        }

        // EXTRA EMOJI DEBUGGING - Check if this is an emoji stroke
        if string.contains("\"color\"") && string.contains("emoji::") {
            print("🎨🎨🎨 [EMOJI DETECTED IN MESSAGE] 🎨🎨🎨")
            print("📤 [WS] EMOJI STROKE BEING SENT:")
            print(string)

            // Extract and highlight the color field
            if let colorRange = string.range(of: #""color":"[^"]*""#, options: .regularExpression) {
                let colorField = String(string[colorRange])
                print("🔍 COLOR FIELD: \(colorField)")
            }
        } else if string.contains("player_stroke") {
            print("📤 [WS] Regular color stroke:")
            print(string)
        }

        webSocketTask?.send(.string(string)) { error in
            if let error = error {
                print("❌ WebSocket send error: \(error)")
            } else {
                print("✅ [WS] Message sent successfully")
            }
        }
    }

    // MARK: - Convenience Methods
    func sendStroke(tileId: Int, localFromX: Double, localFromY: Double, localToX: Double, localToY: Double, brushSize: Double, color: String) {
        let message = StrokeSegmentMessage(
            payload: .init(
                tileId: tileId,
                segment: .init(
                    localFromX: localFromX,
                    localFromY: localFromY,
                    localToX: localToX,
                    localToY: localToY,
                    brushSize: brushSize,
                    color: color,
                    emoji: nil,
                    emojiStyle: nil
                )
            )
        )
        send(message)
    }

    func sendChat(_ text: String) {
        let message = ChatMessage(payload: .init(text: text))
        send(message)
    }

    func sendCursorMove(x: Double, y: Double) {
        let message = CursorMoveMessage(payload: .init(x: x, y: y))
        send(message)
    }
}

extension WebSocketService: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        DispatchQueue.main.async {
            self.isConnected = true
            self.connectionStatusDescription = "Connected to server"
            print("✅ [WS] Connected to \(self.serverURL)")
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let reasonText: String
        if let reason = reason, let text = String(data: reason, encoding: .utf8), !text.isEmpty {
            reasonText = text
        } else {
            reasonText = "code \(closeCode.rawValue)"
        }

        DispatchQueue.main.async {
            self.isConnected = false
            self.connectionStatusDescription = "Disconnected (\(reasonText))"
            print("⚠️ [WS] Closed: \(reasonText)")
        }

        handleConnectionFailure()
    }
}
