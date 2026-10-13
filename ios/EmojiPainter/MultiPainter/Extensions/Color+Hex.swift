//
//  Color+Hex.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI
import UIKit

extension Color {
    /// Initialize Color from hex string (#FF6B6B) or HSL string (hsl(120, 50%, 50%))
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: .whitespacesAndNewlines)

        if hex.lowercased().hasPrefix("emoji::") {
            self = .white
            return
        }

        // Check if HSL format
        if hex.lowercased().hasPrefix("hsl") {
            self = Color.fromHSL(hex) ?? .white
            return
        }

        // Parse hex format
        let scanner = Scanner(string: hex.replacingOccurrences(of: "#", with: ""))
        var rgbValue: UInt64 = 0
        scanner.scanHexInt64(&rgbValue)

        let r = Double((rgbValue & 0xFF0000) >> 16) / 255.0
        let g = Double((rgbValue & 0x00FF00) >> 8) / 255.0
        let b = Double(rgbValue & 0x0000FF) / 255.0

        self.init(red: r, green: g, blue: b)
    }

    /// Parse HSL color format: hsl(120, 50%, 50%)
    static func fromHSL(_ hslString: String) -> Color? {
        // Extract values from hsl(h, s%, l%)
        let components = hslString
            .replacingOccurrences(of: "hsl(", with: "")
            .replacingOccurrences(of: ")", with: "")
            .replacingOccurrences(of: "%", with: "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }

        guard components.count == 3,
              let h = Double(components[0]),
              let s = Double(components[1]),
              let l = Double(components[2]) else {
            return nil
        }

        // Convert to 0-1 range
        let hue = h / 360.0
        let saturation = s / 100.0
        let lightness = l / 100.0

        // Convert HSL to RGB
        let c = (1 - abs(2 * lightness - 1)) * saturation
        let x = c * (1 - abs((hue * 6).truncatingRemainder(dividingBy: 2) - 1))
        let m = lightness - c / 2

        var r: Double = 0, g: Double = 0, b: Double = 0

        let hueSegment = Int(hue * 6)
        switch hueSegment {
        case 0: (r, g, b) = (c, x, 0)
        case 1: (r, g, b) = (x, c, 0)
        case 2: (r, g, b) = (0, c, x)
        case 3: (r, g, b) = (0, x, c)
        case 4: (r, g, b) = (x, 0, c)
        default: (r, g, b) = (c, 0, x)
        }

        return Color(red: r + m, green: g + m, blue: b + m)
    }

    /// Convert Color to hex string
    func toHex() -> String {
        let components = UIColor(self).cgColor.components ?? [0, 0, 0, 1]
        let r = Int(components[0] * 255.0)
        let g = Int(components[1] * 255.0)
        let b = Int(components[2] * 255.0)
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}

// MARK: - UIImage Sampling Helpers
extension UIImage {
    /// Returns the visible color at the provided point within the image (in points).
    func color(at point: CGPoint) -> Color? {
        guard let cgImage = self.cgImage else { return nil }

        let scale = self.scale
        let pixelX = Int(point.x * scale)
        let pixelY = Int(point.y * scale)

        guard pixelX >= 0, pixelX < cgImage.width,
              pixelY >= 0, pixelY < cgImage.height,
              let dataProvider = cgImage.dataProvider,
              let data = dataProvider.data else {
            return nil
        }

        let bytesPerPixel = cgImage.bitsPerPixel / 8
        let bytesPerRow = cgImage.bytesPerRow
        let offset = pixelY * bytesPerRow + pixelX * bytesPerPixel
        let dataLength = CFDataGetLength(data)
        guard offset + 3 < dataLength else { return nil }

        guard let rawPointer = CFDataGetBytePtr(data) else {
            return nil
        }
        let buffer = UnsafeBufferPointer(start: rawPointer, count: dataLength)
        let isLittleEndian = cgImage.bitmapInfo.contains(.byteOrder32Little)

        let r: CGFloat
        let g: CGFloat
        let b: CGFloat
        let a: CGFloat

        if isLittleEndian {
            // BGRA byte order
            b = CGFloat(buffer[offset]) / 255.0
            g = CGFloat(buffer[offset + 1]) / 255.0
            r = CGFloat(buffer[offset + 2]) / 255.0
            a = CGFloat(buffer[offset + 3]) / 255.0
        } else {
            // RGBA byte order
            r = CGFloat(buffer[offset]) / 255.0
            g = CGFloat(buffer[offset + 1]) / 255.0
            b = CGFloat(buffer[offset + 2]) / 255.0
            a = CGFloat(buffer[offset + 3]) / 255.0
        }

        return Color(red: r, green: g, blue: b, opacity: a)
    }
}
