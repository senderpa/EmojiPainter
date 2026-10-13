import ExpoModulesCore

// M2: registration with stroke + canvas-size + background props. Mirrors the emoji-ar View DSL.
public class MetalPaintModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MetalPaint")

    View(MetalPaintView.self) {
      Events("onReady", "onPaintError", "onSmudgeBaked", "onPerf")

      Prop("backgroundColor") { (view: MetalPaintView, hex: String) in
        view.setBackgroundHex(hex)
      }

      Prop("paused") { (view: MetalPaintView, paused: Bool) in
        view.paused = paused
      }

      // Canvas logical (DIP) size for NDC mapping of stroke coordinates.
      Prop("canvasWidth") { (view: MetalPaintView, width: Double) in
        view.setCanvasWidth(width)
      }
      Prop("canvasHeight") { (view: MetalPaintView, height: Double) in
        view.setCanvasHeight(height)
      }

      // Committed strokes as a JSON array string (non-smudge). Robust across the bridge.
      Prop("strokesJson") { (view: MetalPaintView, json: String) in
        view.setStrokesJson(json)
      }

      // In-progress stroke as a JSON array of 0 or 1 stroke (tiny payload, updates per move).
      Prop("liveStrokeJson") { (view: MetalPaintView, json: String) in
        view.setLiveStrokeJson(json)
      }

      // Baked smudge tiles as a JSON object { "<strokeId>": "<base64 PNG>", ... }. Separate from
      // strokesJson so the per-stroke path stays tiny — this only changes when a smudge bakes.
      Prop("smudgeTilesJson") { (view: MetalPaintView, json: String) in
        view.setSmudgeTilesJson(json)
      }

      // Flatten the committed painting to a PNG tmp file (for export / upload). Returns a file:// URL.
      AsyncFunction("snapshot") { (view: MetalPaintView) -> String in
        try view.snapshotToTmpFile()
      }
    }
  }
}
