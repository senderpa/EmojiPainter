import Foundation
import UIKit
import ExpoModulesCore

/**
 * Emojispray Bridge Module
 * Sends exported PNG images to the Emojispray AR app via URL scheme
 * Bundle ID: pascalsender.Emojispray
 */

public class EmojisprayBridgeModule: Module {
    public func definition() -> ModuleDefinition {
        Name("EmojisprayBridge")

        AsyncFunction("sendToEmojispray") { (path: String, promise: Promise) in
            DispatchQueue.main.async {
                self.handleSendToEmojispray(path: path, promise: promise)
            }
        }
    }

    private func handleSendToEmojispray(path: String, promise: Promise) {
        // Create file URL from path string
        let fileURL: URL
        if path.starts(with: "file://"), let url = URL(string: path) {
            fileURL = url
        } else {
            fileURL = URL(fileURLWithPath: path)
        }

        // Check if file exists
        let filePath = fileURL.path
        if !FileManager.default.fileExists(atPath: filePath) {
            NSLog("[EmojisprayBridge] File does not exist: \(filePath)")
            promise.resolve(["status": "failed"])
            return
        }

        // Detect file type (image vs video)
        let fileExtension = fileURL.pathExtension.lowercased()
        let isVideo = ["mov", "mp4", "m4v"].contains(fileExtension)
        let fileType = isVideo ? "video" : "image"

        NSLog("[EmojisprayBridge] Detected file type: \(fileType) (extension: \(fileExtension))")

        // Copy file to shared container location that Emojispray can access
        guard let sharedURL = self.copyToSharedLocation(sourceURL: fileURL) else {
            NSLog("[EmojisprayBridge] Failed to copy file to shared location")
            promise.resolve(["status": "failed"])
            return
        }

        // Create Emojispray URL scheme with file path and type
        // Using x-callback-url standard for inter-app communication
        let encodedPath = sharedURL.path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        guard let emojiSprayURL = URL(string: "emojispray://import?path=\(encodedPath)&type=\(fileType)") else {
            NSLog("[EmojisprayBridge] Failed to create Emojispray URL")
            promise.resolve(["status": "failed"])
            return
        }

        NSLog("[EmojisprayBridge] Opening Emojispray with URL: \(emojiSprayURL)")
        NSLog("[EmojisprayBridge] URL scheme: emojispray://")
        NSLog("[EmojisprayBridge] File type: \(fileType)")
        NSLog("[EmojisprayBridge] Checking canOpenURL...")

        // Check if Emojispray is installed using URL scheme
        let canOpen = UIApplication.shared.canOpenURL(emojiSprayURL)
        NSLog("[EmojisprayBridge] canOpenURL result: \(canOpen)")

        if canOpen {
            NSLog("[EmojisprayBridge] Emojispray IS installed, attempting to open...")
            UIApplication.shared.open(emojiSprayURL, options: [:]) { success in
                if success {
                    NSLog("[EmojisprayBridge] ✓ Successfully opened Emojispray with \(fileType)")
                    promise.resolve(["status": "opened"])
                } else {
                    NSLog("[EmojisprayBridge] ✗ Failed to open Emojispray (open returned false)")
                    promise.resolve(["status": "failed"])
                }
            }
        } else {
            // App not installed
            NSLog("[EmojisprayBridge] ✗ Emojispray NOT installed (canOpenURL returned false)")
            NSLog("[EmojisprayBridge] Make sure 'emojispray' is in LSApplicationQueriesSchemes in Info.plist")

            // Try alternative: pasteboard handoff if URL scheme doesn't work (images only)
            if !isVideo && self.copyToPasteboard(fileURL: fileURL) {
                NSLog("[EmojisprayBridge] Copied image to pasteboard as fallback")
                promise.resolve(["status": "not_installed"])
            } else {
                promise.resolve(["status": "not_installed"])
            }
        }
    }

    private func copyToSharedLocation(sourceURL: URL) -> URL? {
        // Use Documents directory for shared access
        guard let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }

        // Preserve file extension
        let fileExtension = sourceURL.pathExtension
        let filename = "emojispray_handoff_\(Int(Date().timeIntervalSince1970)).\(fileExtension)"
        let destinationURL = documentsURL.appendingPathComponent(filename)

        do {
            // Remove existing file if any
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }

            // Copy file
            try FileManager.default.copyItem(at: sourceURL, to: destinationURL)
            NSLog("[EmojisprayBridge] Copied file to shared location: \(destinationURL.path)")
            return destinationURL
        } catch {
            NSLog("[EmojisprayBridge] Failed to copy file: \(error)")
            return nil
        }
    }

    private func copyToPasteboard(fileURL: URL) -> Bool {
        do {
            let imageData = try Data(contentsOf: fileURL)
            guard let image = UIImage(data: imageData) else {
                return false
            }

            UIPasteboard.general.image = image
            NSLog("[EmojisprayBridge] Copied image to pasteboard")
            return true
        } catch {
            NSLog("[EmojisprayBridge] Failed to copy to pasteboard: \(error)")
            return false
        }
    }
}
