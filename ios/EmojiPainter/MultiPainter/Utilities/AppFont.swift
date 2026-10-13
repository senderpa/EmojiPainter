import SwiftUI

enum AppFont {
    static let primaryName = "vrtlfinale1"

    static func font(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom(primaryName, size: size).weight(weight)
    }
}

extension View {
    func appFont(_ size: CGFloat, weight: Font.Weight = .regular) -> some View {
        self.font(AppFont.font(size: size, weight: weight))
    }
}
