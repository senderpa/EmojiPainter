import ARKit
import ExpoModulesCore
import QuickLook
import SceneKit
import UIKit

/**
 * EmojiAr Module — ARKit features for EmojiPaint.
 *
 * Three native views:
 * - FaceFilterView: front-camera face tracking, renders the user's painted
 *   canvas texture on up to 3 tracked face meshes. All face data stays on
 *   device — ARFaceAnchor geometry is never serialized or transmitted.
 * - WallPaintView: back-camera world tracking (+ LiDAR scene reconstruction
 *   when available); paints emoji stamps onto real surfaces via raycasts.
 * - FrontMaskView: AR Draw's independent front-camera Mask Mode with the
 *   original spray-can paint and local saved-mask library.
 */
public class EmojiArModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EmojiAr")

    Constants([
      "isFaceTrackingSupported": ARFaceTrackingConfiguration.isSupported,
      "isWorldTrackingSupported": ARWorldTrackingConfiguration.isSupported,
      "isLiDARAvailable": ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh),
      "maxTrackedFaces": ARFaceTrackingConfiguration.isSupported
        ? ARFaceTrackingConfiguration.supportedNumberOfTrackedFaces
        : 0,
    ])

    // Face puppet: selfie → server-rigged emoji head driven by ARKit blendshapes
    View(FaceFilterView.self) {
      Events("onFacesChanged", "onSessionReady", "onArError", "onModelLoaded")

      Prop("paused") { (view: FaceFilterView, paused: Bool) in
        view.paused = paused
      }

      // Local USDZ/GLB path of the rigged emoji head ("" clears it)
      Prop("modelPath") { (view: FaceFilterView, path: String) in
        view.setModelPath(path)
      }

      // arkit blendShape key → morph-target name (from the server payload)
      Prop("arkitMapping") { (view: FaceFilterView, mapping: [String: String]) in
        view.arkitMapping = mapping
      }

      // Default face-mesh mask: "none" | "grey" | "camera" | "model"
      Prop("maskMode") { (view: FaceFilterView, mode: String) in
        view.maskMode = mode
      }

      // Paint-on-mask (emoji stamps onto the grey face mesh)
      Prop("paintEnabled") { (view: FaceFilterView, enabled: Bool) in
        view.paintEnabled = enabled
      }
      Prop("brushEmoji") { (view: FaceFilterView, emoji: String) in
        view.brushEmoji = emoji
      }
      Prop("paintSizePx") { (view: FaceFilterView, size: Double) in
        view.paintSizePx = CGFloat(max(8, min(size, 400)))
      }
      Prop("paintMode") { (view: FaceFilterView, mode: String) in
        view.paintMode = mode
      }
      Prop("smudgeStrength") { (view: FaceFilterView, v: Double) in
        view.smudgeStrength = CGFloat(max(0, min(v, 1)))
      }
      Prop("paintTexturePath") { (view: FaceFilterView, path: String) in
        view.paintTexturePath = path
      }

      // SD-restyle overlay for the webcam (textured) mask: when set, this image
      // replaces the baked face texture (same projection UVs); "" reverts.
      Prop("cameraOverlayTexturePath") { (view: FaceFilterView, path: String) in
        view.cameraOverlayTexturePath = path
      }

      // Big face-tracked transparent paint plane behind the mask.
      Prop("facePlaneEnabled") { (view: FaceFilterView, enabled: Bool) in
        view.facePlaneEnabled = enabled
      }

      // Reshoot frame-0 in place (no node teardown → no flash).
      AsyncFunction("rebakeCamera") { (view: FaceFilterView) in
        view.rebakeCameraInPlace()
      }

      // Native SD-frame "video" playback: preload → instant flips, never hides.
      AsyncFunction("sdSetFrames") { (view: FaceFilterView, paths: [String]) in
        view.sdSetFrames(paths)
      }
      AsyncFunction("sdPlay") { (view: FaceFilterView, fps: Double) in
        view.sdPlay(fps)
      }
      AsyncFunction("sdStop") { (view: FaceFilterView) in
        view.sdStop()
      }
      AsyncFunction("sdShowFrame") { (view: FaceFilterView, index: Int) in
        view.sdShowFrame(index)
      }
      AsyncFunction("sdSetPlaneFrames") { (view: FaceFilterView, paths: [String]) in
        view.sdSetPlaneFrames(paths)
      }
      AsyncFunction("exportPlaneTexture") { (view: FaceFilterView) -> String in
        try view.exportPlaneTexture()
      }

      AsyncFunction("captureSelfie") { (view: FaceFilterView) -> String in
        try view.captureSelfie()
      }

      AsyncFunction("snapshot") { (view: FaceFilterView) -> String in
        try view.snapshotToTmpFile()
      }

      AsyncFunction("clearFacePaint") { (view: FaceFilterView) in
        view.clearFacePaint()
      }

      AsyncFunction("exportFacePaint") { (view: FaceFilterView) -> String in
        try view.exportFacePaint()
      }

      // Export the current webcam-mask face texture (the baked snapshot) so JS
      // can send it to Stable Diffusion for restyling.
      AsyncFunction("exportCameraTexture") { (view: FaceFilterView) -> String in
        try view.exportCameraTexture()
      }
    }

    View(FrontMaskView.self) {
      Events("onSessionReady", "onFaceChanged", "onHistoryChanged", "onStrokeCommitted",
             "onMasksChanged", "onMaskLoaded", "onColorPicked",
             "onFreePlaneLocked", "onArError")

      Prop("paused") { (view: FrontMaskView, paused: Bool) in
        view.paused = paused
      }
      Prop("brushSizeMeters") { (view: FrontMaskView, size: Double) in
        view.brushSizeMeters = CGFloat(max(0.01, min(size, 0.26)))
      }
      Prop("brushColor") { (view: FrontMaskView, rgba: [Double]) in
        guard rgba.count >= 3 else { return }
        let divisor = rgba[0] > 1 || rgba[1] > 1 || rgba[2] > 1 ? 255.0 : 1.0
        view.brushColor = UIColor(red: CGFloat(rgba[0] / divisor),
                                  green: CGFloat(rgba[1] / divisor),
                                  blue: CGFloat(rgba[2] / divisor),
                                  alpha: CGFloat(rgba.count > 3 ? rgba[3] : 1))
      }
      Prop("brushMode") { (view: FrontMaskView, mode: String) in
        view.brushMode = ["spray", "relief", "texture", "emoji"].contains(mode)
          ? mode : "spray"
      }
      Prop("brushEmoji") { (view: FrontMaskView, emoji: String) in
        view.brushEmoji = emoji.isEmpty ? "😀" : emoji
      }
      Prop("eyedropperEnabled") { (view: FrontMaskView, enabled: Bool) in
        view.eyedropperEnabled = enabled
      }
      Prop("sprayCanEnabled") { (view: FrontMaskView, enabled: Bool) in
        view.sprayCanEnabled = enabled
      }
      Prop("gridEnabled") { (view: FrontMaskView, enabled: Bool) in
        view.gridEnabled = enabled
      }
      Prop("cameraTextureEnabled") { (view: FrontMaskView, enabled: Bool) in
        view.cameraTextureEnabled = enabled
      }
      Prop("textureTarget") { (view: FrontMaskView, target: String) in
        // "auto" (the default) paints the face when the finger is on it and the
        // surrounding plane when it isn't — no toggle needed.
        view.textureTarget = ["face", "plane", "front3D"].contains(target) ? target : "auto"
      }
      Prop("freeModeEnabled") { (view: FrontMaskView, enabled: Bool) in
        view.freeModeEnabled = enabled
      }
      Prop("textureLineStyle") { (view: FrontMaskView, style: String) in
        view.textureLineStyle = style == "spray" ? "spray" : "clean"
      }
      Prop("textureNormalEnabled") { (view: FrontMaskView, enabled: Bool) in
        view.textureNormalEnabled = enabled
      }
      Prop("brushMirrorX") { (view: FrontMaskView, enabled: Bool) in
        view.brushMirrorX = enabled
      }
      Prop("brushMirrorY") { (view: FrontMaskView, enabled: Bool) in
        view.brushMirrorY = enabled
      }
      Prop("brushRotation") { (view: FrontMaskView, degrees: Double) in
        view.brushRotationDegrees = degrees
      }
      Prop("brushSpacing") { (view: FrontMaskView, spacing: Double) in
        view.brushSpacing = CGFloat(max(0.001, min(spacing, 1)))
      }

      AsyncFunction("undo") { (view: FrontMaskView) in view.undoLastStroke() }
      AsyncFunction("redo") { (view: FrontMaskView) in view.redoLastStroke() }
      AsyncFunction("clearMask") { (view: FrontMaskView) in view.clearMask() }
      AsyncFunction("saveMask") { (view: FrontMaskView, name: String) -> [String: Any] in
        try view.saveMask(name: name)
      }
      AsyncFunction("loadMask") { (view: FrontMaskView, id: String) -> Int in
        try view.loadMask(id: id)
      }
      AsyncFunction("resumeAutosave") { (view: FrontMaskView) -> Int in
        try view.resumeAutosave()
      }
      AsyncFunction("deleteMask") { (view: FrontMaskView, id: String) in
        view.deleteMask(id: id)
      }
      AsyncFunction("duplicateMask") { (view: FrontMaskView, id: String) -> [String: Any] in
        try view.duplicateMask(id: id)
      }
      AsyncFunction("listMasks") { (view: FrontMaskView) -> [[String: Any]] in
        view.listMasks()
      }
      AsyncFunction("snapshot") { (view: FrontMaskView) -> String in
        try view.snapshotToTmpFile()
      }
    }

    View(WallPaintView.self) {
      Events("onPlanesChanged", "onSurfaceUnavailable", "onAnimationLoaded", "onHistoryChanged", "onSessionReady", "onArError", "onSceneStatus", "onRoomReadinessChanged", "onBrushSizeChanged", "onAnimationFrameChanged", "onAnimationEnded", "onStrokeStarted", "onStrokeCommitted")

      Prop("brushEmoji") { (view: WallPaintView, emoji: String) in
        view.brushEmoji = emoji
      }

      Prop("brushSizeMeters") { (view: WallPaintView, size: Double) in
        view.brushSizeMeters = CGFloat(max(0.005, min(size, 2.0)))
      }

      Prop("brushSpacing") { (view: WallPaintView, spacing: Double) in
        // Same normalized spacing semantics as the 2D canvas (can be very dense)
        view.brushSpacing = CGFloat(max(0.001, min(spacing, 4.0)))
      }

      Prop("brushOpacity") { (view: WallPaintView, opacity: Double) in
        view.brushOpacity = CGFloat(max(0.05, min(opacity, 1.0)))
      }

      Prop("mirrorX") { (view: WallPaintView, enabled: Bool) in
        view.mirrorX = enabled
      }

      // 🖌️ mirror/rotate brush options — the glyph itself. Distinct from "mirrorX" above (a paint-
      // SYMMETRY brush, unrelated). Matches the same concept the 2D/Metal engines already have.
      Prop("stampMirrorX") { (view: WallPaintView, enabled: Bool) in
        view.stampMirrorX = enabled
      }

      Prop("stampMirrorY") { (view: WallPaintView, enabled: Bool) in
        view.stampMirrorY = enabled
      }

      Prop("stampRotation") { (view: WallPaintView, degrees: Double) in
        view.stampRotation = Float(degrees)
      }

      Prop("toolMode") { (view: WallPaintView, mode: String) in
        view.toolMode = mode
      }
      Prop("smudgeStrength") { (view: WallPaintView, v: Double) in
        view.smudgeStrength = CGFloat(max(0, min(v, 2.5)))
      }
      Prop("smudgeFocus") { (view: WallPaintView, v: Double) in
        view.smudgeFocus = CGFloat(max(0, min(v, 1)))
      }
      Prop("smudgeFlow") { (view: WallPaintView, v: Double) in
        view.smudgeFlow = CGFloat(max(0, min(v, 1)))
      }
      Prop("animationEnabled") { (view: WallPaintView, enabled: Bool) in
        view.animationEnabled = enabled
      }
      Prop("animationCurrentFrame") { (view: WallPaintView, frame: Int) in
        // JS owns the clock and drives every frame through this prop.
        view.animationCurrentFrame = frame
      }
      Prop("animationPlaying") { (view: WallPaintView, playing: Bool) in
        view.animationPlaying = playing
      }
      Prop("animationTotalFrames") { (view: WallPaintView, frames: Int) in
        view.animationTotalFrames = max(1, min(frames, 900))
      }
      Prop("animationStrokeLength") { (view: WallPaintView, frames: Int) in
        view.animationStrokeLength = frames == -1 ? -1 : max(1, min(frames, 900))
      }
      Prop("animationFps") { (view: WallPaintView, fps: Int) in
        view.animationFps = max(1, min(fps, 60))
      }
      Prop("animationLooping") { (view: WallPaintView, looping: Bool) in
        view.animationLooping = looping
      }
      Prop("paused") { (view: WallPaintView, paused: Bool) in
        view.paused = paused
      }

      Prop("roomPlanEnabled") { (view: WallPaintView, enabled: Bool) in
        view.roomPlanEnabled = enabled
      }

      Prop("roomPreviewEnabled") { (view: WallPaintView, enabled: Bool) in
        view.setRoomPreviewEnabled(enabled)
      }

      Prop("sprayCanEnabled") { (view: WallPaintView, enabled: Bool) in
        view.sprayCanEnabled = enabled
      }

      Prop("soundEnabled") { (view: WallPaintView, enabled: Bool) in
        view.soundEnabled = enabled
      }

      Prop("gridEnabled") { (view: WallPaintView, enabled: Bool) in
        view.gridEnabled = enabled
      }

      Prop("sunPreset") { (view: WallPaintView, preset: String) in
        view.sunPreset = preset
      }

      Prop("shadowStrength") { (view: WallPaintView, v: Double) in
        view.shadowStrength = v
      }

      Prop("strokeLightAmount") { (view: WallPaintView, v: Double) in
        view.strokeLightAmount = v
      }

      Prop("sunFollowSpeed") { (view: WallPaintView, v: Double) in
        view.sunFollowSpeed = v
      }

      Prop("blendFilterEnabled") { (view: WallPaintView, enabled: Bool) in
        view.blendFilterEnabled = enabled
      }

      Prop("blendAmount") { (view: WallPaintView, v: Double) in
        view.blendAmount = v
      }

      Prop("occlusionEnabled") { (view: WallPaintView, enabled: Bool) in
        view.occlusionEnabled = enabled
      }

      Prop("personOcclusionEnabled") { (view: WallPaintView, enabled: Bool) in
        view.personOcclusionEnabled = enabled
      }

      Prop("strokeShadowsEnabled") { (view: WallPaintView, enabled: Bool) in
        view.strokeShadowsEnabled = enabled
      }
      Prop("strokeStackingEnabled") { (view: WallPaintView, enabled: Bool) in
        view.strokeStackingEnabled = enabled
      }
      Prop("strokeStackHeight") { (view: WallPaintView, v: Double) in
        view.strokeStackHeight = max(0, min(v, 1))
      }
      Prop("sunFollowEnabled") { (view: WallPaintView, enabled: Bool) in
        view.sunFollowEnabled = enabled
      }

      Prop("dripColor") { (view: WallPaintView, rgb: [Double]) in
        if rgb.count >= 3 {
          view.dripColor = UIColor(
            red: CGFloat(rgb[0] / 255.0),
            green: CGFloat(rgb[1] / 255.0),
            blue: CGFloat(rgb[2] / 255.0),
            alpha: 1
          )
        }
      }

      Prop("dripColors") { (view: WallPaintView, list: [[Double]]) in
        let parsed: [UIColor] = list.compactMap { rgb in
          guard rgb.count >= 3 else { return nil }
          return UIColor(
            red: CGFloat(rgb[0] / 255.0),
            green: CGFloat(rgb[1] / 255.0),
            blue: CGFloat(rgb[2] / 255.0),
            alpha: 1
          )
        }
        view.dripColors = parsed
      }

      AsyncFunction("undo") { (view: WallPaintView) in
        view.undoLastStroke()
      }

      AsyncFunction("seekAnimation") { (view: WallPaintView, frame: Int) in
        view.seekAnimation(frame: frame)
      }

      // ── AR "specials" effects ──
      AsyncFunction("startMeltdown") { (view: WallPaintView) in
        view.startMeltdown()
      }
      AsyncFunction("stopMeltdown") { (view: WallPaintView) in
        view.stopMeltdown()
      }
      AsyncFunction("startDestroy") { (view: WallPaintView) in
        view.startDestroy()
      }
      AsyncFunction("stopDestroy") { (view: WallPaintView) in
        view.stopDestroy()
      }
      AsyncFunction("startWash") { (view: WallPaintView) in
        view.startWash()
      }
      AsyncFunction("stopWash") { (view: WallPaintView) in
        view.stopWash()
      }

      AsyncFunction("redo") { (view: WallPaintView) in
        view.redoLastStroke()
      }

      AsyncFunction("previewBrushSize") { (view: WallPaintView) in
        view.previewBrushSize()
      }

      AsyncFunction("clear") { (view: WallPaintView) in
        view.clearAll()
      }

      AsyncFunction("snapshot") { (view: WallPaintView) -> String in
        try view.snapshotToTmpFile()
      }

      AsyncFunction("startPlacement") { (view: WallPaintView, path: String, isVideo: Bool) in
        view.startPlacement(path: path, isVideo: isVideo)
      }

      AsyncFunction("confirmPlacement") { (view: WallPaintView) in
        view.confirmPlacement()
      }

      AsyncFunction("cancelPlacement") { (view: WallPaintView) in
        view.cancelPlacement()
      }

      AsyncFunction("saveScene") { (view: WallPaintView, promise: Promise) in
        view.saveScene { result, errorMessage in
          if let result = result {
            promise.resolve(result)
          } else {
            promise.reject("ERR_SAVE_SCENE", errorMessage ?? "Save failed")
          }
        }
      }

      // Room packages use the same proven ARWorldMap/stroke persistence path,
      // with optional RoomPlan + hybrid files added by WallPaintView.
      AsyncFunction("saveRoom") { (view: WallPaintView, promise: Promise) in
        view.saveScene { result, errorMessage in
          if let result = result {
            promise.resolve(result)
          } else {
            promise.reject("ERR_SAVE_ROOM", errorMessage ?? "Save failed")
          }
        }
      }

      AsyncFunction("getRoomViewerData") { (view: WallPaintView, promise: Promise) in
        guard let payload = view.roomViewerPayload() else {
          promise.reject("ERR_ROOM_NOT_READY", "RoomPlan has not produced a usable room yet")
          return
        }
        promise.resolve(payload)
      }

      AsyncFunction("loadScene") { (view: WallPaintView, dir: String) in
        try view.loadScene(dir: dir)
      }
    }

    // Native SceneKit "dollhouse" inspector for a saved RoomPlan package —
    // real solid geometry + SceneKit's own orbit camera controller instead
    // of the old hand-rolled 2D-canvas fake-3D WebView.
    View(RoomPreviewView.self) {
      Prop("roomDataJSON") { (view: RoomPreviewView, json: String) in
        view.roomDataJSON = json
      }
    }

    // Interactive 3D / AR preview of a USDZ (or USDC) head via AR Quick Look:
    // pinch-zoom, rotate, and "AR" placement come for free from the system.
    AsyncFunction("openARQuickLook") { (path: String, promise: Promise) in
      DispatchQueue.main.async {
        ARQuickLookPresenter.shared.present(path: path, promise: promise)
      }
    }
  }
}

/// Presents a local USDZ/USDC in QLPreviewController (AR Quick Look). Retains
/// itself while on screen so the data source/delegate stay alive.
final class ARQuickLookPresenter: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  static let shared = ARQuickLookPresenter()
  private var previewItemURL: URL?
  private var strongSelf: ARQuickLookPresenter?

  func present(path: String, promise: Promise) {
    let url = path.hasPrefix("file://") ? URL(string: path) : URL(fileURLWithPath: path)
    guard let modelUrl = url, FileManager.default.fileExists(atPath: modelUrl.path) else {
      promise.reject("ERR_AR_QUICKLOOK", "Model file not found")
      return
    }
    guard let top = ARQuickLookPresenter.topViewController() else {
      promise.reject("ERR_AR_QUICKLOOK", "No view controller to present from")
      return
    }
    previewItemURL = modelUrl
    strongSelf = self // keep alive during presentation
    let controller = QLPreviewController()
    controller.dataSource = self
    controller.delegate = self
    top.present(controller, animated: true) {
      promise.resolve(nil)
    }
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    (previewItemURL ?? URL(fileURLWithPath: "")) as QLPreviewItem
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    strongSelf = nil
    previewItemURL = nil
  }

  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes
    let windowScene = scenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
      ?? scenes.first as? UIWindowScene
    var root = windowScene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
      ?? windowScene?.windows.first?.rootViewController
    while let presented = root?.presentedViewController {
      root = presented
    }
    return root
  }
}

enum EmojiArError: Error, CustomStringConvertible {
  case snapshotFailed

  var description: String {
    switch self {
    case .snapshotFailed: return "Could not capture AR snapshot"
    }
  }
}

/// Shared helper: write a UIImage to a tmp PNG and return its file:// path.
func writeSnapshotToTmp(_ image: UIImage) throws -> String {
  guard let data = image.pngData() else {
    throw EmojiArError.snapshotFailed
  }
  let filename = "emojiar-snapshot-\(Int(Date().timeIntervalSince1970 * 1000)).png"
  let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(filename)
  try data.write(to: url)
  return url.absoluteString
}
