//
//  ColorPickerView.swift
//  MultiPainter
//
//  Created by Claude Code - Enhanced Color Picker
//

import SwiftUI

struct ColorPickerView: View {
    @EnvironmentObject var gameManager: GameManager
    @EnvironmentObject var gameState: GameState
    @Binding var isPresented: Bool
    @Binding var selectedColor: Color
    @Binding var brushSize: Double
    @State private var pipetteActive = false

    @State private var hue: Double = 0
    @State private var saturation: Double = 1
    @State private var brightness: Double = 1
    @State private var alpha: Double = 1

    let predefinedColors: [Color] = [
        // Basic colors
        .red, .orange, .yellow, .green, .blue, .purple, .pink, .white, .gray, .black,
        // Extended palette
        Color(hex: "#FF6B6B"), Color(hex: "#FF8E53"), Color(hex: "#FFA07A"), Color(hex: "#FFD93D"),
        Color(hex: "#6BCF7F"), Color(hex: "#4ECDC4"), Color(hex: "#45B7D1"), Color(hex: "#5F9DF7"),
        Color(hex: "#845EC2"), Color(hex: "#C34A94"), Color(hex: "#FF69EB"), Color(hex: "#FF9CEE"),
        Color(hex: "#B39CD0"), Color(hex: "#98D8C8"), Color(hex: "#F7DC6F"), Color(hex: "#FFC3A0"),
        Color(hex: "#D4A5A5"), Color(hex: "#9B9B9B"), Color(hex: "#6D6D6D"), Color(hex: "#3D3D3D")
    ]

    let brushSizes: [Double] = [2, 4, 6, 8, 12, 16, 20, 24, 30, 40, 55, 70, 100]

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header with pipette tool
                HStack {
                    EmojiLabel("🎨 Brush Settings", size: 26, weight: .bold, color: .white)

                    Spacer()

                    // Pipette Tool Button
                    Button(action: {
                        pipetteActive.toggle()
                        isPresented = false
                    }) {
                        ZStack {
                            Circle()
                                .fill(pipetteActive ? Color.blue : Color.white.opacity(0.2))
                                .frame(width: 50, height: 50)

                            CustomEmojiView("💧", size: 24, revealOnTap: false)
                        }
                    }

                    Button(action: {
                        isPresented = false
                    }) {
                        Image(systemName: "xmark.circle.fill")
                            .appFont(28)
                            .foregroundColor(.white.opacity(0.8))
                    }
                }

                // Color Wheel
                VStack(alignment: .leading, spacing: 12) {
                    Text("COLOR WHEEL")
                        .appFont(14, weight: .bold)
                        .foregroundColor(.white.opacity(0.6))

                    ColorWheelPicker(hue: $hue, saturation: $saturation, brightness: $brightness)
                        .frame(height: 250)
                        .onChange(of: hue) { _ in updateColorFromHSB() }
                        .onChange(of: saturation) { _ in updateColorFromHSB() }
                        .onChange(of: brightness) { _ in updateColorFromHSB() }
                }

                // HSB Sliders
                VStack(spacing: 16) {
                    // Hue Slider
                    VStack(alignment: .leading, spacing: 8) {
                        Text("HUE")
                            .appFont(12, weight: .bold)
                            .foregroundColor(.white.opacity(0.6))

                        HStack {
                            Slider(value: $hue, in: 0...1)
                                .accentColor(Color(hue: hue, saturation: 1, brightness: 1))
                                .onChange(of: hue) { _ in updateColorFromHSB() }

                            Text("\(Int(hue * 360))°")
                                .appFont(14, weight: .semibold)
                                .foregroundColor(.white)
                                .frame(width: 50)
                        }
                    }

                    // Saturation Slider
                    VStack(alignment: .leading, spacing: 8) {
                        Text("SATURATION")
                            .appFont(12, weight: .bold)
                            .foregroundColor(.white.opacity(0.6))

                        HStack {
                            Slider(value: $saturation, in: 0...1)
                                .accentColor(Color(hue: hue, saturation: saturation, brightness: brightness))
                                .onChange(of: saturation) { _ in updateColorFromHSB() }

                            Text("\(Int(saturation * 100))%")
                                .appFont(14, weight: .semibold)
                                .foregroundColor(.white)
                                .frame(width: 50)
                        }
                    }

                    // Brightness Slider
                    VStack(alignment: .leading, spacing: 8) {
                        Text("BRIGHTNESS")
                            .appFont(12, weight: .bold)
                            .foregroundColor(.white.opacity(0.6))

                        HStack {
                            Slider(value: $brightness, in: 0...1)
                                .accentColor(Color(hue: hue, saturation: saturation, brightness: brightness))
                                .onChange(of: brightness) { _ in updateColorFromHSB() }

                            Text("\(Int(brightness * 100))%")
                                .appFont(14, weight: .semibold)
                                .foregroundColor(.white)
                                .frame(width: 50)
                        }
                    }
                }

                // Predefined colors palette
                VStack(alignment: .leading, spacing: 12) {
                    Text("QUICK COLORS")
                        .appFont(14, weight: .bold)
                        .foregroundColor(.white.opacity(0.6))

                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 10), spacing: 8) {
                        ForEach(predefinedColors, id: \.self) { color in
                            Button(action: {
                                selectedColor = color
                                updateHSBFromColor(color)
                            }) {
                                Circle()
                                    .fill(color)
                                    .frame(width: 32, height: 32)
                                    .overlay(
                                        Circle()
                                            .stroke(Color.white, lineWidth: colorsAreEqual(selectedColor, color) ? 3 : 0)
                                    )
                                    .overlay(
                                        Circle()
                                            .stroke(Color.black.opacity(0.2), lineWidth: 1)
                                    )
                            }
                        }
                    }
                }

                // Brush size selection
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("BRUSH SIZE")
                            .appFont(14, weight: .bold)
                            .foregroundColor(.white.opacity(0.6))

                        Spacer()

                        Text("\(Int(brushSize))px")
                            .appFont(14, weight: .semibold)
                            .foregroundColor(.white)
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 16) {
                            ForEach(brushSizes, id: \.self) { size in
                                Button(action: {
                                    brushSize = size
                                }) {
                                    ZStack {
                                        Circle()
                                            .fill(Color.white.opacity(0.2))
                                            .frame(width: 50, height: 50)

                                        Circle()
                                            .fill(brushSize == size ? Color.blue : Color.white)
                                            .frame(width: min(size * 1.5, 40), height: min(size * 1.5, 40))
                                            .overlay(
                                                Circle()
                                                    .stroke(Color.blue, lineWidth: brushSize == size ? 3 : 0)
                                            )
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 4)
                    }
                }

                // Preview
                VStack(spacing: 12) {
                    Text("PREVIEW")
                        .appFont(14, weight: .bold)
                        .foregroundColor(.white.opacity(0.6))
                        .frame(maxWidth: .infinity, alignment: .leading)

                    ZStack {
                        // Checkerboard background for transparency
                        CheckerboardView()
                            .cornerRadius(12)
                            .frame(height: 100)

                        Circle()
                            .fill(selectedColor)
                            .frame(width: brushSize * 2 * 0.85, height: brushSize * 2 * 0.85)
                            .shadow(color: .black.opacity(0.3), radius: 4)
                    }
                }

                // Apply button
                Button(action: {
                    applySettings()
                }) {
                    Text("✓ Apply & Close")
                        .appFont(18, weight: .bold)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(
                            LinearGradient(
                                colors: [Color.purple, Color.blue],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .cornerRadius(16)
                }
            }
            .padding(24)
        }
        .frame(width: 420)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(Color.black.opacity(0.95))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24)
                .stroke(
                    LinearGradient(
                        colors: [Color.purple.opacity(0.5), Color.blue.opacity(0.5)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 2
                )
        )
        .shadow(color: .black.opacity(0.5), radius: 30)
        .onAppear {
            updateHSBFromColor(selectedColor)
        }
    }

    private func updateColorFromHSB() {
        selectedColor = Color(hue: hue, saturation: saturation, brightness: brightness, opacity: alpha)
    }

    private func updateHSBFromColor(_ color: Color) {
        let uiColor = UIColor(color)
        var h: CGFloat = 0
        var s: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0

        uiColor.getHue(&h, saturation: &s, brightness: &b, alpha: &a)

        hue = Double(h)
        saturation = Double(s)
        brightness = Double(b)
        alpha = Double(a)
    }

    private func colorsAreEqual(_ color1: Color, _ color2: Color) -> Bool {
        let ui1 = UIColor(color1)
        let ui2 = UIColor(color2)

        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0

        ui1.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        ui2.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)

        return abs(r1 - r2) < 0.01 && abs(g1 - g2) < 0.01 && abs(b1 - b2) < 0.01
    }

    private func applySettings() {
        isPresented = false
    }
}

// MARK: - Color Wheel Picker

struct ColorWheelPicker: View {
    @Binding var hue: Double
    @Binding var saturation: Double
    @Binding var brightness: Double

    var body: some View {
        GeometryReader { geometry in
            let size = min(geometry.size.width, geometry.size.height)
            let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)

            ZStack {
                // Color wheel ring
                ColorWheelRing()
                    .frame(width: size, height: size)

                // Brightness/Saturation square
                ZStack {
                    // Brightness gradient (white to black)
                    LinearGradient(
                        colors: [.white, Color(hue: hue, saturation: 1, brightness: 1), .black],
                        startPoint: .top,
                        endPoint: .bottom
                    )

                    // Saturation gradient (transparent to opaque)
                    LinearGradient(
                        colors: [.white.opacity(0), Color(hue: hue, saturation: 1, brightness: 1)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
                .frame(width: size * 0.5, height: size * 0.5)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.5), lineWidth: 2)
                )
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            let localX = value.location.x
                            let localY = value.location.y
                            let squareSize = size * 0.5

                            saturation = max(0.0, min(1.0, Double(localX / squareSize)))
                            brightness = max(0.0, min(1.0, 1.0 - Double(localY / squareSize)))
                        }
                )

                // Selection indicator
                Circle()
                    .fill(Color(hue: hue, saturation: saturation, brightness: brightness))
                    .frame(width: 24, height: 24)
                    .overlay(
                        Circle()
                            .stroke(Color.white, lineWidth: 3)
                    )
                    .overlay(
                        Circle()
                            .stroke(Color.black, lineWidth: 1)
                    )
                    .position(
                        x: center.x + (saturation - 0.5) * size * 0.5,
                        y: center.y + (0.5 - brightness) * size * 0.5
                    )
            }
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let dx = value.location.x - center.x
                        let dy = value.location.y - center.y
                        let distance = sqrt(dx * dx + dy * dy)
                        let radius = size / 2

                        // Check if touch is on the outer ring
                        if distance > radius * 0.6 && distance < radius {
                            let angle = atan2(dy, dx)
                            hue = (angle + .pi) / (2 * .pi)
                        }
                    }
            )
        }
    }
}

struct ColorWheelRing: View {
    var body: some View {
        GeometryReader { geometry in
            let size = min(geometry.size.width, geometry.size.height)

            Canvas { context, canvasSize in
                let center = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
                let outerRadius = size / 2
                let innerRadius = outerRadius * 0.6

                for angle in stride(from: 0.0, to: 360.0, by: 1.0) {
                    let radians = angle * .pi / 180
                    let hue = angle / 360.0
                    let color = Color(hue: hue, saturation: 1, brightness: 1)

                    let innerX = center.x + cos(radians) * innerRadius
                    let innerY = center.y + sin(radians) * innerRadius
                    let outerX = center.x + cos(radians) * outerRadius
                    let outerY = center.y + sin(radians) * outerRadius

                    var path = Path()
                    path.move(to: CGPoint(x: innerX, y: innerY))
                    path.addLine(to: CGPoint(x: outerX, y: outerY))

                    context.stroke(path, with: .color(color), lineWidth: 2)
                }
            }
        }
    }
}

struct CheckerboardView: View {
    var body: some View {
        GeometryReader { geometry in
            let size: CGFloat = 20
            let rows = Int(geometry.size.height / size) + 1
            let cols = Int(geometry.size.width / size) + 1

            Canvas { context, canvasSize in
                for row in 0..<rows {
                    for col in 0..<cols {
                        let isWhite = (row + col) % 2 == 0
                        let rect = CGRect(
                            x: CGFloat(col) * size,
                            y: CGFloat(row) * size,
                            width: size,
                            height: size
                        )
                        context.fill(
                            Path(rect),
                            with: .color(isWhite ? Color.white.opacity(0.3) : Color.white.opacity(0.1))
                        )
                    }
                }
            }
        }
    }
}

// Notification name moved to CanvasView.swift to avoid duplication

#Preview {
    ColorPickerView(
        isPresented: .constant(true),
        selectedColor: .constant(.red),
        brushSize: .constant(8)
    )
    .environmentObject(GameManager())
    .environmentObject(GameState())
}
