//
//  WebSocketClient.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation
import Combine

class WebSocketClient: NSObject, ObservableObject {
    @Published var isConnected = false
    @Published var connectionError: String?

    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession!
    private var reconnectTimer: Timer?
    private var shouldReconnect = true

    var onMessage: ((String) -> Void)?

    override init() {
        super.init()
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    func connect(to urlString: String = "wss://some-sender.gotdns.ch:4850/ws") {
        guard let url = URL(string: urlString) else {
            connectionError = "Invalid URL"
            return
        }

        shouldReconnect = true
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()

        DispatchQueue.main.async {
            self.isConnected = true
            self.connectionError = nil
        }

        receiveMessage()
    }

    func disconnect() {
        shouldReconnect = false
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil

        DispatchQueue.main.async {
            self.isConnected = false
        }
    }

    func send<T: Encodable>(_ message: T) {
        guard let data = try? JSONEncoder().encode(message),
              let string = String(data: data, encoding: .utf8) else {
            print("Failed to encode message")
            return
        }

        webSocketTask?.send(.string(string)) { error in
            if let error = error {
                print("WebSocket send error: \(error)")
            }
        }
    }

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

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    DispatchQueue.main.async {
                        self?.onMessage?(text)
                    }
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async {
                            self?.onMessage?(text)
                        }
                    }
                @unknown default:
                    break
                }
                self?.receiveMessage()

            case .failure(let error):
                print("WebSocket receive error: \(error)")
                self?.handleDisconnection()
            }
        }
    }

    private func handleDisconnection() {
        DispatchQueue.main.async {
            self.isConnected = false
        }

        guard shouldReconnect else { return }

        // Attempt reconnection after 3 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            guard let self = self, self.shouldReconnect else { return }
            print("Attempting to reconnect...")
            self.connect()
        }
    }

    deinit {
        disconnect()
    }
}

extension WebSocketClient: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        DispatchQueue.main.async {
            self.isConnected = true
            self.connectionError = nil
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        DispatchQueue.main.async {
            self.isConnected = false
        }
        handleDisconnection()
    }
}
