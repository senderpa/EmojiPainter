import Foundation

// Deterministic exact-time timeline evaluator (handoff §Viewpoints/animation):
// preview and export share it — same timestamp → same camera. Position lerps
// relative to each segment; zoom in log space; ping-pong doesn't dup endpoints.

public struct TimelineCamera { public let centerX: Double; public let centerY: Double; public let zoom: Double }

public enum TimelineEvaluator {
  struct Segment { let start: Double; let end: Double; let from: Viewpoint; let to: Viewpoint; let hold: Bool }

  public static func sequence(_ views: [Viewpoint], loop: LoopMode) -> [Viewpoint] {
    guard views.count > 1 else { return views }
    switch loop {
    case .pingPong: return views + views.dropFirst().dropLast().reversed()
    case .loop: return views + [views[0]]
    case .once: return views
    }
  }

  static func segments(_ views: [Viewpoint], loop: LoopMode) -> [Segment] {
    let seq = sequence(views, loop: loop)
    var segs: [Segment] = []
    var t = 0.0
    for i in seq.indices {
      let v = seq[i]
      if v.holdMilliseconds > 0 {
        segs.append(Segment(start: t, end: t + v.holdMilliseconds, from: v, to: v, hold: true))
        t += v.holdMilliseconds
      }
      if i + 1 < seq.count, v.durationToNextMilliseconds > 0 {
        segs.append(Segment(start: t, end: t + v.durationToNextMilliseconds, from: v, to: seq[i + 1], hold: false))
        t += v.durationToNextMilliseconds
      }
    }
    return segs
  }

  public static func totalDurationMs(_ views: [Viewpoint], loop: LoopMode) -> Double {
    segments(views, loop: loop).last?.end ?? 0
  }

  static func ease(_ t: Double, _ e: EasingKind) -> Double {
    switch e {
    case .linear: return t
    case .easeInOut, .easeInOutCubic:
      return t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
    }
  }

  public static func camera(_ views: [Viewpoint], loop: LoopMode, timeMs: Double) -> TimelineCamera? {
    guard let first = views.first else { return nil }
    if views.count == 1 { return TimelineCamera(centerX: first.centerX, centerY: first.centerY, zoom: first.zoom) }
    let segs = segments(views, loop: loop)
    guard let last = segs.last else { return TimelineCamera(centerX: first.centerX, centerY: first.centerY, zoom: first.zoom) }
    let clamped = max(0, min(timeMs, last.end))
    let seg = segs.first(where: { clamped >= $0.start && clamped <= $0.end }) ?? last
    if seg.hold || seg.end <= seg.start {
      return TimelineCamera(centerX: seg.from.centerX, centerY: seg.from.centerY, zoom: seg.from.zoom)
    }
    let raw = (clamped - seg.start) / (seg.end - seg.start)
    let t = ease(raw, seg.from.easing)
    return TimelineCamera(
      centerX: seg.from.centerX + (seg.to.centerX - seg.from.centerX) * t,
      centerY: seg.from.centerY + (seg.to.centerY - seg.from.centerY) * t,
      zoom: CameraMath.interpolateZoomLog(seg.from.zoom, seg.to.zoom, t)
    )
  }
}
