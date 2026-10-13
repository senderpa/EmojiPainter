import Foundation

// Double world camera + floating-origin math (IOS_VECTOR_ARCHITECTURE.md §Camera).
// world(s) = w + (s - c)/z ; focal pinch keeps the anchor under the finger across
// many orders of magnitude; zoom interpolates in log space; render origin rebases
// near the camera so Metal only ever sees Float(local) with small magnitude.

public struct CameraState {
  public var centerX: Double
  public var centerY: Double
  public var zoom: Double        // logical: screen px per world unit, positive/finite
  public var rotation: Double    // radians
  public init(centerX: Double = 0, centerY: Double = 0, zoom: Double = 1, rotation: Double = 0) {
    self.centerX = centerX; self.centerY = centerY; self.zoom = zoom; self.rotation = rotation
  }
}

public enum CameraMath {
  public static let minZoom = 1e-9
  public static let maxZoom = 1e9

  public static func clampZoom(_ z: Double) -> Double {
    guard z.isFinite, z > 0 else { return 1 }
    return min(maxZoom, max(minZoom, z))
  }

  public static func screenToWorld(_ cam: CameraState, sx: Double, sy: Double, cx: Double, cy: Double) -> (Double, Double) {
    let dx = (sx - cx) / cam.zoom
    let dy = (sy - cy) / cam.zoom
    if cam.rotation == 0 { return (cam.centerX + dx, cam.centerY + dy) }
    let c = cos(-cam.rotation), s = sin(-cam.rotation)
    return (cam.centerX + dx * c - dy * s, cam.centerY + dx * s + dy * c)
  }

  /// Pinch around screen focal (fx,fy); the world anchor stays under the finger.
  public static func zoomAroundFocal(_ cam: CameraState, pinchScale: Double, fx: Double, fy: Double,
                                     cx: Double, cy: Double) -> CameraState {
    let (ax, ay) = screenToWorld(cam, sx: fx, sy: fy, cx: cx, cy: cy)
    let z1 = clampZoom(cam.zoom * pinchScale)
    var next = cam
    next.zoom = z1
    next.centerX = ax - (fx - cx) / z1
    next.centerY = ay - (fy - cy) / z1
    return next
  }

  public static func interpolateZoomLog(_ z0: Double, _ z1: Double, _ t: Double) -> Double {
    clampZoom(exp(log(clampZoom(z0)) * (1 - t) + log(clampZoom(z1)) * t))
  }

  /// Stable grid snap of the camera center → render origin (rebase only at a frame
  /// boundary; saved geometry stays Double, Metal uses Float(world - origin)).
  public static func renderOrigin(centerX: Double, centerY: Double, cell: Double) -> (Double, Double) {
    ((centerX / cell).rounded() * cell, (centerY / cell).rounded() * cell)
  }
}
