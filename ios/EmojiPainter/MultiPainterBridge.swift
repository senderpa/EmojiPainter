import Foundation
import SwiftUI
import UIKit

/// React Native bridge — call NativeModules.MultiPainterBridge.openMultiPainter() from JS.
@objc(MultiPainterBridge)
class MultiPainterBridge: NSObject {

  @objc func openMultiPainter(_ username: String, emoji: String) {
    DispatchQueue.main.async {
      // Pre-seed the MultiPainter UserPreferences with EmojiPainter's profile
      if !username.isEmpty {
        UserPreferences.shared.saveUsername(username)
        UserPreferences.shared.saveEmoji(emoji.isEmpty ? "🎨" : emoji)
      }
      let state = GameState()
      let rootView = ContentView().environmentObject(state)
      let vc = UIHostingController(rootView: rootView)
      vc.modalPresentationStyle = .fullScreen
      state.onClose = { [weak vc] in
        vc?.dismiss(animated: true)
      }
      UIApplication.shared.topMostViewController()?.present(vc, animated: true)
    }
  }

  @objc static func requiresMainQueueSetup() -> Bool { return true }
}

private extension UIApplication {
  func topMostViewController(_ base: UIViewController? = nil) -> UIViewController? {
    let root = base ?? connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first(where: { $0.isKeyWindow })?.rootViewController
    if let nav = root as? UINavigationController {
      return topMostViewController(nav.visibleViewController)
    }
    if let tab = root as? UITabBarController, let selected = tab.selectedViewController {
      return topMostViewController(selected)
    }
    if let presented = root?.presentedViewController {
      return topMostViewController(presented)
    }
    return root
  }
}
