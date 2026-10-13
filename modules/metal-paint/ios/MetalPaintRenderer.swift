import Foundation
import Metal
import MetalKit
import UIKit
import simd

/// A committed stroke to replay (non-smudge). Mirrors the relevant fields of the JS Stroke.
struct MPStrokePoint {
  let x: Float
  let y: Float
  let w: Float?
}

struct MPStroke {
  let emoji: String
  let size: Float
  let opacity: Float
  let spacing: Float
  let stampSpan: Float
  let points: [MPStrokePoint]
  let emojiSequence: [String]?
  let isEraser: Bool
  let isPlane: Bool
  let planeCorners: [SIMD2<Float>]? // [TL, TR, BR, BL] in canvas DIP
  // Brush transform (🖌️ mirror/rotate options). Was never decoded here, so every stamp painted
  // through the Metal engine (the DEFAULT engine — see useMetalPaintEngine) silently ignored them.
  let rotation: Float // degrees, same convention as the Skia engine (Group transform rotate)
  let mirrorX: Bool
  let mirrorY: Bool
  // Smudge: baked result tile (base64 PNG) + bounds (x, y, w, h) in canvas DIP.
  let isSmudge: Bool
  let strokeId: String
  // Baked tile (base64 PNG) is delivered on a SEPARATE channel (smudgeTilesJson), NOT in the per-stroke
  // strokesJson, then merged in by id — so the hot per-stroke path carries no megabyte payloads.
  var bakedTile: String?
  let bakedBounds: SIMD4<Float>?
  // Live smudge params (0..1): edgeBlend → carry reach, smudgeStrength → deposit.
  let edgeBlend: Float
  let smudgeStrength: Float
  // 3-layer system: 0 = background, 1 = middle (DEFAULT), 2 = foreground. Declared last with a
  // default so the memberwise initializer stays source-compatible with every existing call site,
  // and so a stroke whose JSON carries no "layer" key lands on the middle layer — exactly how every
  // painting made before layers existed must behave.
  var layer: Int = MPLayerIndex.middle
  /// Baked distortion lattice, row-major over a (level+1)^2 grid. Empty = plain 4-corner
  /// homography. Declared last with defaults so every existing initializer call still compiles.
  var planeLattice: [SIMD2<Float>] = []
  var planeLatticeLevel: Int = 1
}

/// Layer indices + paint order for the 3-layer system. Rendering is ALWAYS
/// background → middle → foreground, whatever order the strokes were created in.
enum MPLayerIndex {
  static let background = 0
  static let middle = 1
  static let foreground = 2
  static let count = 3
  /// Bottom → top. Iterate this (never the raw strokes) when compositing.
  static let paintOrder = [background, middle, foreground]

  static func from(_ name: String?) -> Int {
    switch name {
    case "background": return background
    case "foreground": return foreground
    default: return middle
    }
  }

  static func name(_ index: Int) -> String {
    switch index {
    case background: return "background"
    case foreground: return "foreground"
    default: return "middle"
    }
  }
}

/// Quad vertex matching the embedded shader struct.
private struct MPQuadVertex {
  var position: SIMD2<Float>
  var texCoord: SIMD2<Float>
}

// Embedded shader source (unique function names → no clash with the exporter's default library).
private let MP_SHADER_SRC = """
#include <metal_stdlib>
using namespace metal;
struct MPQuadVertex { float2 position; float2 texCoord; };
struct MPVertexOut { float4 position [[position]]; float2 texCoord; };
vertex MPVertexOut mp_vertex_main(constant MPQuadVertex* verts [[buffer(0)]], uint vid [[vertex_id]]) {
  MPVertexOut out;
  out.position = float4(verts[vid].position, 0.0, 1.0);
  out.texCoord = verts[vid].texCoord;
  return out;
}
// The emoji atlas is built with UIGraphicsImageRenderer → its RGB is ALREADY
// PREMULTIPLIED by the texture's own alpha. Stay premultiplied all the way to
// the blend unit.
//
// This used to do `c.a *= opacity` alone, which left rgb weighted by the
// PRE-opacity alpha while alpha carried the post-opacity value. The `normal`
// pipeline then blended rgb with sourceRGB = .sourceAlpha, multiplying by alpha
// a SECOND time — so a stamp landed as C·ta²·o instead of C·ta·o. Alpha was
// right, colour was under-weighted. Invisible in a fully opaque interior
// (ta = 1) but wrong on every antialiased edge and across every low-alpha
// stroke, which is why soft strokes never matched the exported result.
//
// Scaling the whole float4 keeps the premultiplied invariant (rgb = C·a), and
// zero-coverage texels stay exactly (0,0,0,0) so they cannot tint what is below.
fragment float4 mp_fragment_stamp(MPVertexOut in [[stage_in]],
                                  texture2d<float> tex [[texture(0)]],
                                  constant float &opacity [[buffer(0)]]) {
  constexpr sampler s(mag_filter::linear, min_filter::linear);
  float4 c = tex.sample(s, in.texCoord);
  return c * opacity;
}
// Blit a baked tile (loaded straight-alpha PNG) into the PREMULTIPLIED committed texture: premultiply
// rgb by a so it matches the surrounding pixels (REPLACE blit). Fixes the per-rect color shift.
fragment float4 mp_fragment_tile(MPVertexOut in [[stage_in]],
                                 texture2d<float> tex [[texture(0)]]) {
  constexpr sampler s(mag_filter::linear, min_filter::linear);
  float4 c = tex.sample(s, in.texCoord);
  c.rgb *= c.a;
  return c;
}
struct MPSmudgeU {
  float2 dir;        // normalized stroke direction
  float2 dabUVMin;   // working-UV of the dab's top-left
  float2 dabUVSize;  // working-UV size of the dab
  float distance;    // finger movement this dab (px) → speed
  float radiusPx;    // brush radius in px
  float strength;
  float wetMix;
  float softness;
  float maskCurve;
};
// Procreate-style smudge: speed-based smear + wet carry + push displacement, masked by emoji alpha ×
// radial falloff. Reads `src` (a snapshot of the working texture), writes the working render target.
fragment float4 mp_fragment_smudge(MPVertexOut in [[stage_in]],
                                   texture2d<float> src [[texture(0)]],
                                   texture2d<float> brushMask [[texture(1)]],
                                   constant MPSmudgeU &u [[buffer(0)]]) {
  constexpr sampler s(mag_filter::linear, min_filter::linear, address::clamp_to_edge);
  constexpr sampler ms(mag_filter::linear, min_filter::linear, address::clamp_to_zero);
  float2 texSize = float2(src.get_width(), src.get_height());
  float2 px = in.texCoord * texSize;
  float2 brushUV = (in.texCoord - u.dabUVMin) / max(u.dabUVSize, float2(1e-6));

  float2 dir = u.dir;
  float2 perp = float2(-dir.y, dir.x);
  float speed01 = clamp(u.distance / max(u.radiusPx, 1.0), 0.0, 1.0);

  float smear = u.radiusPx * mix(0.20, 0.85, speed01) * u.strength;
  float wet = mix(0.70, 0.35, speed01) * u.wetMix;
  float push = mix(0.35, 0.75, speed01) * u.strength;
  float soft = mix(0.65, 0.25, speed01) * u.softness;

  // Follow the PICKED EMOJI's silhouette (not a circle). A tiny radial only softens the very edge.
  float emojiMask = brushMask.sample(ms, brushUV).a;
  float edge = smoothstep(1.02, 0.85, distance(brushUV, float2(0.5)) * 2.0); // ~1 except near the rim
  float m = pow(saturate(emojiMask) * edge, u.maskCurve);

  float4 dst = src.sample(s, in.texCoord);
  if (m <= 0.001) { return dst; }

  float4 behind1 = src.sample(s, (px - dir * smear) / texSize);
  float4 behind2 = src.sample(s, (px - dir * smear * 0.66) / texSize);
  float4 behind3 = src.sample(s, (px - dir * smear * 0.33) / texSize);
  float4 sideA = src.sample(s, (px + perp * u.radiusPx * 0.10) / texSize);
  float4 sideB = src.sample(s, (px - perp * u.radiusPx * 0.10) / texSize);

  float4 trail = behind1 * 0.50 + behind2 * 0.30 + behind3 * 0.20;
  float4 local = dst * 0.60 + sideA * 0.20 + sideB * 0.20;
  float4 carried = mix(trail, local, soft);
  float4 displaced = src.sample(s, (px - dir * smear * m) / texSize);

  float4 result = dst;
  result = mix(result, carried, m * wet);
  result = mix(result, displaced, m * push * 0.50);
  return result;
}
"""

/// Renders committed strokes (stamps / eraser / static plane) into a Metal render encoder, reusing the
/// export engine's exact NDC stamp math. Self-contained so the live Metal view is independent of the
/// exporter pod.
final class MetalPaintRenderer {
  private let device: MTLDevice
  private let atlas: MetalPaintAtlas
  private var stampPipeline: MTLRenderPipelineState?
  private var eraserPipeline: MTLRenderPipelineState?
  private var smudgePipeline: MTLRenderPipelineState?
  private var replacePipeline: MTLRenderPipelineState? // texture blit with NO blending (Src/replace)
  private var tilePipeline: MTLRenderPipelineState?    // premultiplying tile blit (REPLACE) for smudge tiles

  // Native captured smudge tiles (id → GPU texture + DIP bounds), kept the instant a smudge ends. A
  // rebuild blits these directly, so committed NEVER momentarily loses a smudge while the JS base64 tile
  // round-trips (the "preview → blank → rendered" gap). Bounded LRU; older smudges fall back to the
  // base64 tile (which has long since arrived). These are already premultiplied (captured from the
  // working texture) → blit with the plain REPLACE pipeline, not the premultiplying tile pipeline.
  private var liveSmudgeTextures: [String: (tex: MTLTexture, bounds: SIMD4<Float>)] = [:]
  private var liveSmudgeOrder: [String] = []
  private let liveSmudgeCap = 16

  func cacheSmudgeTile(id: String, texture: MTLTexture, bounds: SIMD4<Float>) {
    if liveSmudgeTextures[id] == nil { liveSmudgeOrder.append(id) }
    liveSmudgeTextures[id] = (texture, bounds)
    while liveSmudgeOrder.count > liveSmudgeCap {
      let old = liveSmudgeOrder.removeFirst()
      liveSmudgeTextures.removeValue(forKey: old)
    }
  }

  init?(device: MTLDevice) {
    self.device = device
    self.atlas = MetalPaintAtlas(device: device)
    guard setupPipelines() else { return nil }
  }

  /// Brush mask texture (emoji silhouette) for smudge, same atlas as stamps.
  func maskTexture(emoji: String, size: Float) -> MTLTexture? {
    atlas.getTexture(for: emoji, size: CGFloat(size))
  }

  private func setupPipelines() -> Bool {
    let library: MTLLibrary
    do {
      library = try device.makeLibrary(source: MP_SHADER_SRC, options: MTLCompileOptions())
    } catch {
      NSLog("[MetalPaintRenderer] shader compile failed: \(error)")
      return false
    }
    guard let vfn = library.makeFunction(name: "mp_vertex_main"),
          let ffn = library.makeFunction(name: "mp_fragment_stamp") else {
      return false
    }

    let normal = MTLRenderPipelineDescriptor()
    normal.vertexFunction = vfn
    normal.fragmentFunction = ffn
    normal.colorAttachments[0].pixelFormat = .bgra8Unorm
    normal.colorAttachments[0].isBlendingEnabled = true
    // Textbook PREMULTIPLIED source-over, matching mp_fragment_stamp's output:
    //   outRGB = srcRGB + dstRGB * (1 - srcA)
    //   outA   = srcA   + dstA   * (1 - srcA)
    // sourceRGB was .sourceAlpha (the STRAIGHT-alpha convention) while the
    // shader emitted premultiplied rgb — that mismatch applied alpha twice to
    // colour. Do not change one of these without the other; the shader and this
    // pipeline are a matched pair.
    normal.colorAttachments[0].sourceRGBBlendFactor = .one
    normal.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
    normal.colorAttachments[0].rgbBlendOperation = .add
    normal.colorAttachments[0].sourceAlphaBlendFactor = .one
    normal.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
    normal.colorAttachments[0].alphaBlendOperation = .add

    let eraser = MTLRenderPipelineDescriptor()
    eraser.vertexFunction = vfn
    eraser.fragmentFunction = ffn
    eraser.colorAttachments[0].pixelFormat = .bgra8Unorm
    eraser.colorAttachments[0].isBlendingEnabled = true
    eraser.colorAttachments[0].sourceRGBBlendFactor = .zero
    eraser.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
    eraser.colorAttachments[0].rgbBlendOperation = .add
    eraser.colorAttachments[0].sourceAlphaBlendFactor = .zero
    eraser.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
    eraser.colorAttachments[0].alphaBlendOperation = .add

    // Smudge: shader returns the final composited color → no blending (Src/replace).
    let smudge = MTLRenderPipelineDescriptor()
    smudge.vertexFunction = vfn
    smudge.fragmentFunction = library.makeFunction(name: "mp_fragment_smudge")
    smudge.colorAttachments[0].pixelFormat = .bgra8Unorm
    smudge.colorAttachments[0].isBlendingEnabled = false

    // Replace: plain textured quad, blending disabled — used to blit a baked smudge tile so it REPLACES
    // the rect's pixels (the tile already contains canvas+smudge); SrcOver would double-composite.
    let replace = MTLRenderPipelineDescriptor()
    replace.vertexFunction = vfn
    replace.fragmentFunction = ffn
    replace.colorAttachments[0].pixelFormat = .bgra8Unorm
    replace.colorAttachments[0].isBlendingEnabled = false

    // Premultiplying tile blit (REPLACE) for baked smudge tiles.
    let tile = MTLRenderPipelineDescriptor()
    tile.vertexFunction = vfn
    tile.fragmentFunction = library.makeFunction(name: "mp_fragment_tile")
    tile.colorAttachments[0].pixelFormat = .bgra8Unorm
    tile.colorAttachments[0].isBlendingEnabled = false

    do {
      stampPipeline = try device.makeRenderPipelineState(descriptor: normal)
      eraserPipeline = try device.makeRenderPipelineState(descriptor: eraser)
      smudgePipeline = try device.makeRenderPipelineState(descriptor: smudge)
      replacePipeline = try device.makeRenderPipelineState(descriptor: replace)
      tilePipeline = try device.makeRenderPipelineState(descriptor: tile)
    } catch {
      NSLog("[MetalPaintRenderer] pipeline creation failed: \(error)")
      return false
    }
    return true
  }

  // MARK: - Live smudge

  struct MPSmudgeUniforms {
    var dir: SIMD2<Float>
    var dabUVMin: SIMD2<Float>
    var dabUVSize: SIMD2<Float>
    var distance: Float
    var radiusPx: Float
    var strength: Float
    var wetMix: Float
    var softness: Float
    var maskCurve: Float
  }

  struct MPSmudgeDab {
    var center: SIMD2<Float> // device px in the working texture
    var dir: SIMD2<Float>    // normalized stroke direction
    var distance: Float      // finger movement for this dab (px) → speed
  }

  func blitCopy(from src: MTLTexture, to dst: MTLTexture, commandQueue: MTLCommandQueue, wait: Bool = false) {
    guard let cb = commandQueue.makeCommandBuffer(), let blit = cb.makeBlitCommandEncoder() else { return }
    let w = min(src.width, dst.width)
    let h = min(src.height, dst.height)
    blit.copy(from: src, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
              sourceSize: MTLSize(width: w, height: h, depth: 1),
              to: dst, destinationSlice: 0, destinationLevel: 0, destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
    blit.endEncoding()
    cb.commit()
    if wait { cb.waitUntilCompleted() }
  }

  /// Apply a batch of smudge dabs to `working`, ping-ponging through `scratch` so each dab reads the
  /// progressively-smudged result. `mask` = brush silhouette. center/reach are in working-texture px.
  func applySmudgeDabs(working: MTLTexture, scratch: MTLTexture, mask: MTLTexture,
                       dabs: [MPSmudgeDab], radiusPx: Float, strength: Float, wetMix: Float,
                       softness: Float, maskCurve: Float, commandQueue: MTLCommandQueue) {
    guard let smudgePipeline = smudgePipeline, !dabs.isEmpty else { return }
    let texW = Float(working.width)
    let texH = Float(working.height)
    let texWi = working.width
    let texHi = working.height
    let maskHalf = SIMD2<Float>(Float(mask.width) / 2.0, Float(mask.height) / 2.0)
    // PERF (the real fix): snapshot ONCE per call (union of this move's dabs) and draw all dabs in ONE
    // render pass. The old per-2-dabs ping-pong re-copied heavily-overlapping regions ~N× per move
    // (consecutive dabs overlap ~90%), so a long/big stroke copied GIGABYTES → the 1–5s post-stroke
    // freeze. One snapshot copies each pixel once. Within a single move the dabs read the same pre-move
    // pixels (carry still propagates move-to-move via `working`), which is visually identical in practice.
    // Margin = 1.4·radius: the shader samples behind by ≤ ~1.36·radius beyond the dab quad edge.
    let margin = Int((radiusPx * 1.4).rounded(.up)) + 4
    var minX = Float.greatestFiniteMagnitude, minY = Float.greatestFiniteMagnitude
    var maxX = -Float.greatestFiniteMagnitude, maxY = -Float.greatestFiniteMagnitude
    for d in dabs {
      minX = min(minX, d.center.x - maskHalf.x); minY = min(minY, d.center.y - maskHalf.y)
      maxX = max(maxX, d.center.x + maskHalf.x); maxY = max(maxY, d.center.y + maskHalf.y)
    }
    let rx = max(0, Int(minX.rounded(.down)) - margin)
    let ry = max(0, Int(minY.rounded(.down)) - margin)
    let rw = min(texWi - rx, Int((maxX - minX).rounded(.up)) + 2 * margin + 1)
    let rh = min(texHi - ry, Int((maxY - minY).rounded(.up)) + 2 * margin + 1)
    guard rw > 0, rh > 0, let cb = commandQueue.makeCommandBuffer() else { return }
    if let blit = cb.makeBlitCommandEncoder() {
      blit.copy(from: working, sourceSlice: 0, sourceLevel: 0,
                sourceOrigin: MTLOrigin(x: rx, y: ry, z: 0),
                sourceSize: MTLSize(width: rw, height: rh, depth: 1),
                to: scratch, destinationSlice: 0, destinationLevel: 0,
                destinationOrigin: MTLOrigin(x: rx, y: ry, z: 0))
      blit.endEncoding()
    }
    let rpd = MTLRenderPassDescriptor()
    rpd.colorAttachments[0].texture = working
    rpd.colorAttachments[0].loadAction = .load
    rpd.colorAttachments[0].storeAction = .store
    guard let enc = cb.makeRenderCommandEncoder(descriptor: rpd) else { cb.commit(); return }
    enc.setRenderPipelineState(smudgePipeline)
    enc.setFragmentTexture(scratch, index: 0)
    enc.setFragmentTexture(mask, index: 1)
    func ndc(_ x: Float, _ y: Float) -> SIMD2<Float> { SIMD2<Float>(x / texW * 2 - 1, 1 - y / texH * 2) }
    func uv(_ x: Float, _ y: Float) -> SIMD2<Float> { SIMD2<Float>(x / texW, y / texH) }
    for dab in dabs {
      let x0 = dab.center.x - maskHalf.x, y0 = dab.center.y - maskHalf.y
      let x1 = dab.center.x + maskHalf.x, y1 = dab.center.y + maskHalf.y
      var u = MPSmudgeUniforms(
        dir: dab.dir,
        dabUVMin: SIMD2<Float>(x0 / texW, y0 / texH),
        dabUVSize: SIMD2<Float>((x1 - x0) / texW, (y1 - y0) / texH),
        distance: dab.distance,
        radiusPx: radiusPx,
        strength: strength,
        wetMix: wetMix,
        softness: softness,
        maskCurve: maskCurve
      )
      enc.setFragmentBytes(&u, length: MemoryLayout<MPSmudgeUniforms>.stride, index: 0)
      var verts: [MPQuadVertex] = [
        MPQuadVertex(position: ndc(x0, y0), texCoord: uv(x0, y0)),
        MPQuadVertex(position: ndc(x1, y0), texCoord: uv(x1, y0)),
        MPQuadVertex(position: ndc(x0, y1), texCoord: uv(x0, y1)),
        MPQuadVertex(position: ndc(x1, y1), texCoord: uv(x1, y1))
      ]
      enc.setVertexBytes(&verts, length: MemoryLayout<MPQuadVertex>.stride * verts.count, index: 0)
      enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
    }
    enc.endEncoding()
    cb.commit()
  }

  /// Encode all strokes into the given render encoder. Coordinates are in canvas DIP space
  /// [0, canvasW] x [0, canvasH]; NDC mapping is resolution-independent (fills the drawable).
  func encode(strokes: [MPStroke], canvasW: Float, canvasH: Float, encoder: MTLRenderCommandEncoder) {
    guard let stampPipeline = stampPipeline, let eraserPipeline = eraserPipeline else { return }
    let w = max(canvasW, 1)
    let h = max(canvasH, 1)
    for stroke in strokes {
      // Smudge: blit the baked tile so smudge survives committed rebuilds. Use the PREMULTIPLY REPLACE
      // pipeline (tilePipeline): the tile PNG is straight-alpha, committed is premultiplied — premultiply
      // on blit so the restored pixels exactly match the composite (no darkening), REPLACE (no
      // accumulation). NOTE: tilePipeline must be non-nil (it is, or renderer init would have failed) —
      // do NOT fall back to stampPipeline (SrcOver) which double-composites and darkens.
      if stroke.isSmudge {
        // Prefer the native captured texture (kept this session) — present the instant the stroke ends,
        // so a rebuild never drops the smudge while the JS base64 tile round-trips. It's already
        // premultiplied (captured from `working`), so use the plain REPLACE pipeline.
        if let cached = liveSmudgeTextures[stroke.strokeId], let rp = replacePipeline {
          let b = cached.bounds
          let corners = [
            SIMD2<Float>(b.x, b.y),
            SIMD2<Float>(b.x + b.z, b.y),
            SIMD2<Float>(b.x + b.z, b.y + b.w),
            SIMD2<Float>(b.x, b.y + b.w)
          ]
          encoder.setRenderPipelineState(rp)
          encodePlane(texture: cached.tex, corners: corners, opacity: 1.0, w: w, h: h, lattice: stroke.planeLattice, latticeLevel: stroke.planeLatticeLevel, encoder: encoder)
          continue
        }
        // Fallback: the base64 tile (reload of a saved project, or evicted from the LRU above).
        guard let b64 = stroke.bakedTile, let b = stroke.bakedBounds, let tp = tilePipeline,
              let tex = atlas.getSmudgeTexture(id: stroke.strokeId, base64: b64) else { continue }
        let corners = [
          SIMD2<Float>(b.x, b.y),
          SIMD2<Float>(b.x + b.z, b.y),
          SIMD2<Float>(b.x + b.z, b.y + b.w),
          SIMD2<Float>(b.x, b.y + b.w)
        ]
        encoder.setRenderPipelineState(tp)
        encodePlane(texture: tex, corners: corners, opacity: 1.0, w: w, h: h, lattice: stroke.planeLattice, latticeLevel: stroke.planeLatticeLevel, encoder: encoder)
        continue
      }
      encoder.setRenderPipelineState(stroke.isEraser ? eraserPipeline : stampPipeline)
      if stroke.isPlane, let corners = stroke.planeCorners, corners.count == 4 {
        if let entry = atlas.getEntry(for: stroke.emoji, size: CGFloat(stroke.size)) {
          encodePlane(
            texture: entry.texture, corners: corners, opacity: stroke.opacity, w: w, h: h,
            lattice: stroke.planeLattice, latticeLevel: stroke.planeLatticeLevel,
            inkUV: (entry.inkU0, entry.inkV0, entry.inkU1, entry.inkV1),
            encoder: encoder
          )
        }
        continue
      }
      encodeStamps(stroke: stroke, w: w, h: h, encoder: encoder)
    }
  }

  private func drawStampQuad(
    x: Float, y: Float, size: Float, w: Float, h: Float,
    rotationDeg: Float = 0, flipX: Bool = false, flipY: Bool = false,
    encoder: MTLRenderCommandEncoder
  ) {
    let scaleX = size / w
    let scaleY = size / h
    let ndcX = (x / w) * 2.0 - 1.0
    let ndcY = 1.0 - (y / h) * 2.0

    // Mirroring flips the LOCAL offset (not the texCoords): for a symmetric quad this puts each
    // corner's sampled texel at its mirrored position without touching the UV assignment below.
    let sx: Float = flipX ? -1 : 1
    let sy: Float = flipY ? -1 : 1
    var local: [SIMD2<Float>] = [
      SIMD2<Float>(-scaleX * sx, -scaleY * sy),
      SIMD2<Float>(scaleX * sx, -scaleY * sy),
      SIMD2<Float>(-scaleX * sx, scaleY * sy),
      SIMD2<Float>(scaleX * sx, scaleY * sy)
    ]

    if rotationDeg != 0 {
      // NDC is Y-up; the brush-rotation convention (matching the Skia engine's `rotate` transform)
      // is defined in Y-down DIP space, so negate the angle to keep the visual direction consistent
      // between engines — same brush rotation should look the same whichever one is active.
      let rad = -rotationDeg * Float.pi / 180
      let c = cosf(rad), s = sinf(rad)
      local = local.map { p in SIMD2<Float>(p.x * c - p.y * s, p.x * s + p.y * c) }
    }

    var verts: [MPQuadVertex] = [
      MPQuadVertex(position: SIMD2<Float>(ndcX + local[0].x, ndcY + local[0].y), texCoord: SIMD2<Float>(0, 1)),
      MPQuadVertex(position: SIMD2<Float>(ndcX + local[1].x, ndcY + local[1].y), texCoord: SIMD2<Float>(1, 1)),
      MPQuadVertex(position: SIMD2<Float>(ndcX + local[2].x, ndcY + local[2].y), texCoord: SIMD2<Float>(0, 0)),
      MPQuadVertex(position: SIMD2<Float>(ndcX + local[3].x, ndcY + local[3].y), texCoord: SIMD2<Float>(1, 0))
    ]
    encoder.setVertexBytes(&verts, length: MemoryLayout<MPQuadVertex>.stride * verts.count, index: 0)
    encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
  }

  // startSegment = number of points already drawn (for incremental live rendering): when > 0 we only
  // draw the new segments since then; when 0 we draw the whole stroke.
  private func encodeStamps(stroke: MPStroke, w: Float, h: Float, encoder: MTLRenderCommandEncoder, startSegment: Int = 0) {
    let points = stroke.points
    guard !points.isEmpty else { return }
    var opacityValue = stroke.opacity
    encoder.setFragmentBytes(&opacityValue, length: MemoryLayout<Float>.size, index: 0)

    let seq = stroke.emojiSequence
    let seqLen = seq?.count ?? 0
    var singleTexture: MTLTexture? = nil
    if seqLen == 0 {
      singleTexture = atlas.getTexture(for: stroke.emoji, size: CGFloat(stroke.size))
      guard singleTexture != nil else { return }
      encoder.setFragmentTexture(singleTexture, index: 0)
    }

    // Stamp spacing (DIP). This USED to mirror the Skia engine's resolveResampleSpacing — a
    // "keep a fast stroke continuous" formula that clamps its input to 0...1 and only ever outputs
    // 0.08x-0.26x the stamp span. That formula is for filling gaps in a sparsely-sampled fast
    // stroke, not for the user's spacing SLIDER, which JS drives through computeStampSpacing()
    // (PaintScreen.tsx) across a much wider 0.16x-20x range. Reusing the narrow formula here made
    // every stroke look the same regardless of the slider, since the widest setting (20x span) was
    // both clamped away (min(stroke.spacing, 1.0)) and barely moved the narrow formula's output
    // even before that clamp. This mirrors computeStampSpacing() instead, so the slider's full
    // range actually reaches the native renderer — the DEFAULT engine for every emoji stroke.
    let spanDip = stroke.stampSpan > 0 ? stroke.stampSpan : stroke.size * 1.1
    let normalizedSpacing = stroke.spacing > 0 ? stroke.spacing : 0.001
    let spacingDip = max(0.5, Self.computeStampSpacing(spanDip: spanDip, normalizedSpacing: normalizedSpacing))

    func emit(_ x: Float, _ y: Float, _ size: Float, _ idx: Int) {
      if seqLen > 0, let seq = seq {
        guard let tex = atlas.getTexture(for: seq[idx % seqLen], size: CGFloat(stroke.size)) else { return }
        encoder.setFragmentTexture(tex, index: 0)
      }
      drawStampQuad(
        x: x, y: y, size: size, w: w, h: h,
        rotationDeg: stroke.rotation, flipX: stroke.mirrorX, flipY: stroke.mirrorY,
        encoder: encoder
      )
    }

    // INTERPOLATE stamps along each segment so a fast stroke (sparse input points) stays continuous.
    var idx = max(0, startSegment)
    if startSegment <= 0 {
      let first = points[0]
      emit(first.x, first.y, first.w ?? stroke.size, idx); idx += 1
    }
    let begin = max(1, startSegment)
    if begin >= points.count { return }
    for i in begin..<points.count {
      let a = points[i - 1], b = points[i]
      let dx = b.x - a.x, dy = b.y - a.y
      let dist = (dx * dx + dy * dy).squareRoot()
      let aSize = a.w ?? stroke.size, bSize = b.w ?? stroke.size
      let steps = max(1, min(2048, Int((dist / spacingDip).rounded(.up))))
      for s in 1...steps {
        let t = Float(s) / Float(steps)
        emit(a.x + dx * t, a.y + dy * t, aSize + (bSize - aSize) * t, idx); idx += 1
      }
    }
  }

  /// Draw a stroke's stamps onto an existing texture, only from `fromSegment` onward (incremental live).
  func appendStrokeStamps(texture: MTLTexture, stroke: MPStroke, fromSegment: Int, canvasW: Float, canvasH: Float, commandQueue: MTLCommandQueue) {
    guard let stampPipeline = stampPipeline, let eraserPipeline = eraserPipeline else { return }
    let rpd = MTLRenderPassDescriptor()
    rpd.colorAttachments[0].texture = texture
    rpd.colorAttachments[0].loadAction = .load
    rpd.colorAttachments[0].storeAction = .store
    guard let cb = commandQueue.makeCommandBuffer(),
          let enc = cb.makeRenderCommandEncoder(descriptor: rpd) else { return }
    enc.setRenderPipelineState(stroke.isEraser ? eraserPipeline : stampPipeline)
    encodeStamps(stroke: stroke, w: max(canvasW, 1), h: max(canvasH, 1), encoder: enc, startSegment: fromSegment)
    enc.endEncoding()
    cb.commit()
  }

  /// Render committed strokes into an offscreen texture (transparent background). Own command buffer.
  func renderToTexture(strokes: [MPStroke], canvasW: Float, canvasH: Float, texture: MTLTexture, commandQueue: MTLCommandQueue) {
    let rpd = MTLRenderPassDescriptor()
    rpd.colorAttachments[0].texture = texture
    rpd.colorAttachments[0].loadAction = .clear
    rpd.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    rpd.colorAttachments[0].storeAction = .store
    guard let cb = commandQueue.makeCommandBuffer(),
          let enc = cb.makeRenderCommandEncoder(descriptor: rpd) else { return }
    encode(strokes: strokes, canvasW: canvasW, canvasH: canvasH, encoder: enc)
    enc.endEncoding()
    cb.commit()
  }

  /// Append strokes onto an existing texture (no clear) — incremental committed rendering.
  func appendToTexture(strokes: [MPStroke], canvasW: Float, canvasH: Float, texture: MTLTexture, commandQueue: MTLCommandQueue) {
    guard !strokes.isEmpty else { return }
    let rpd = MTLRenderPassDescriptor()
    rpd.colorAttachments[0].texture = texture
    rpd.colorAttachments[0].loadAction = .load
    rpd.colorAttachments[0].storeAction = .store
    guard let cb = commandQueue.makeCommandBuffer(),
          let enc = cb.makeRenderCommandEncoder(descriptor: rpd) else { return }
    encode(strokes: strokes, canvasW: canvasW, canvasH: canvasH, encoder: enc)
    enc.endEncoding()
    cb.commit()
  }

  /// Draw a full-screen quad sampling `texture` (used to blit the committed texture onto the drawable).
  func encodeBlit(texture: MTLTexture, encoder: MTLRenderCommandEncoder) {
    guard let stampPipeline = stampPipeline else { return }
    encoder.setRenderPipelineState(stampPipeline)
    encoder.setFragmentTexture(texture, index: 0)
    var op: Float = 1
    encoder.setFragmentBytes(&op, length: MemoryLayout<Float>.size, index: 0)
    var verts: [MPQuadVertex] = [
      MPQuadVertex(position: SIMD2<Float>(-1, -1), texCoord: SIMD2<Float>(0, 1)),
      MPQuadVertex(position: SIMD2<Float>( 1, -1), texCoord: SIMD2<Float>(1, 1)),
      MPQuadVertex(position: SIMD2<Float>(-1,  1), texCoord: SIMD2<Float>(0, 0)),
      MPQuadVertex(position: SIMD2<Float>( 1,  1), texCoord: SIMD2<Float>(1, 0))
    ]
    encoder.setVertexBytes(&verts, length: MemoryLayout<MPQuadVertex>.stride * verts.count, index: 0)
    encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
  }

  /// Flatten committed strokes (over a background) to a UIImage for snapshot/export.
  func makeSnapshotImage(strokes: [MPStroke], canvasW: Float, canvasH: Float, widthPx: Int, heightPx: Int, background: MTLClearColor, commandQueue: MTLCommandQueue) -> UIImage? {
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: max(1, widthPx), height: max(1, heightPx), mipmapped: false)
    desc.usage = [.renderTarget, .shaderRead]
    desc.storageMode = .shared
    guard let tex = device.makeTexture(descriptor: desc) else { return nil }
    let rpd = MTLRenderPassDescriptor()
    rpd.colorAttachments[0].texture = tex
    rpd.colorAttachments[0].loadAction = .clear
    rpd.colorAttachments[0].clearColor = background
    rpd.colorAttachments[0].storeAction = .store
    guard let cb = commandQueue.makeCommandBuffer(),
          let enc = cb.makeRenderCommandEncoder(descriptor: rpd) else { return nil }
    encode(strokes: strokes, canvasW: canvasW, canvasH: canvasH, encoder: enc)
    enc.endEncoding()
    cb.commit()
    cb.waitUntilCompleted()
    return MetalPaintRenderer.textureToImage(tex)
  }

  /// Copy a pixel region of a texture into a fresh .shared texture (fast GPU blit). The heavy
  /// PNG/base64 encode is then done off the main thread via `image(from:)`.
  func captureRegion(_ texture: MTLTexture, x: Int, y: Int, w: Int, h: Int, commandQueue: MTLCommandQueue) -> MTLTexture? {
    let cw = max(1, min(w, texture.width - x))
    let ch = max(1, min(h, texture.height - y))
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: cw, height: ch, mipmapped: false)
    desc.usage = [.shaderRead]
    desc.storageMode = .shared
    guard x >= 0, y >= 0, cw > 0, ch > 0, let dst = device.makeTexture(descriptor: desc),
          let cb = commandQueue.makeCommandBuffer(), let blit = cb.makeBlitCommandEncoder() else { return nil }
    blit.copy(from: texture, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: x, y: y, z: 0),
              sourceSize: MTLSize(width: cw, height: ch, depth: 1),
              to: dst, destinationSlice: 0, destinationLevel: 0, destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
    blit.endEncoding()
    cb.commit()
    cb.waitUntilCompleted()
    return dst
  }

  /// Convert a .shared texture to a UIImage (CPU; call off the main thread for big tiles).
  func image(from texture: MTLTexture) -> UIImage? {
    return MetalPaintRenderer.textureToImage(texture)
  }

  /// Capture a region WITHOUT blocking the calling thread. The completion fires on a Metal-internal
  /// thread once the GPU blit is done (no waitUntilCompleted on the main thread → no stall that grows
  /// with brush size). The captured texture is .shared, safe to read off-thread afterwards.
  func captureRegionAsync(_ texture: MTLTexture, x: Int, y: Int, w: Int, h: Int,
                          commandQueue: MTLCommandQueue, completion: @escaping (MTLTexture?) -> Void) {
    let cw = max(1, min(w, texture.width - x))
    let ch = max(1, min(h, texture.height - y))
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: cw, height: ch, mipmapped: false)
    desc.usage = [.shaderRead]
    desc.storageMode = .shared
    guard x >= 0, y >= 0, cw > 0, ch > 0, let dst = device.makeTexture(descriptor: desc),
          let cb = commandQueue.makeCommandBuffer(), let blit = cb.makeBlitCommandEncoder() else {
      completion(nil); return
    }
    blit.copy(from: texture, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: x, y: y, z: 0),
              sourceSize: MTLSize(width: cw, height: ch, depth: 1),
              to: dst, destinationSlice: 0, destinationLevel: 0, destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
    blit.endEncoding()
    cb.addCompletedHandler { _ in completion(dst) }
    cb.commit()
  }

  /// PNG data for a captured texture, downscaled so the encode cost is bounded regardless of brush size.
  /// The tile is only a fallback (cold rebuild) / persistence copy — live rendering uses the full-res
  /// GPU texture and still-image export re-renders from strokes — so a capped tile is fine.
  func encodedTilePNG(from texture: MTLTexture, maxDim: Int) -> Data? {
    guard let full = MetalPaintRenderer.textureToImage(texture) else { return nil }
    let longSide = max(full.size.width, full.size.height)
    let img: UIImage
    if longSide > CGFloat(maxDim) {
      let scale = CGFloat(maxDim) / longSide
      let newSize = CGSize(width: floor(full.size.width * scale), height: floor(full.size.height * scale))
      let fmt = UIGraphicsImageRendererFormat()
      fmt.scale = 1
      img = UIGraphicsImageRenderer(size: newSize, format: fmt).image { _ in
        full.draw(in: CGRect(origin: .zero, size: newSize))
      }
    } else {
      img = full
    }
    return img.pngData()
  }

  private static func textureToImage(_ texture: MTLTexture) -> UIImage? {
    let width = texture.width
    let height = texture.height
    let bytesPerRow = 4 * width
    var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
    texture.getBytes(&pixels, bytesPerRow: bytesPerRow, from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue).union(.byteOrder32Little)
    guard let provider = CGDataProvider(data: Data(pixels) as CFData),
          let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                           bytesPerRow: bytesPerRow, space: colorSpace, bitmapInfo: bitmapInfo,
                           provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else {
      return nil
    }
    return UIImage(cgImage: cg)
  }

  /// 8-unknown homography mapping unit square -> the four given corners.
  /// Mirror of solveHomography()/gaussianElimination() in src/workspace/CanvasViewport.tsx;
  /// if one changes the other must too or a committed plane stops matching its preview.
  private static func solveHomography(tl: SIMD2<Float>, tr: SIMD2<Float>, br: SIMD2<Float>, bl: SIMD2<Float>) -> [Float] {
    let src: [(Float, Float)] = [(0, 0), (1, 0), (1, 1), (0, 1)]
    let dst = [tl, tr, br, bl]
    var a = [[Float]](repeating: [Float](repeating: 0, count: 9), count: 8)
    for i in 0..<4 {
      let (sx, sy) = src[i]
      let d = dst[i]
      a[i * 2]     = [sx, sy, 1, 0, 0, 0, -d.x * sx, -d.x * sy, d.x]
      a[i * 2 + 1] = [0, 0, 0, sx, sy, 1, -d.y * sx, -d.y * sy, d.y]
    }
    // Gaussian elimination with partial pivoting.
    for col in 0..<8 {
      var pivot = col
      for row in (col + 1)..<8 where abs(a[row][col]) > abs(a[pivot][col]) { pivot = row }
      if abs(a[pivot][col]) < 1e-12 { continue }
      if pivot != col { a.swapAt(pivot, col) }
      let inv = 1.0 / a[col][col]
      for k in col...8 { a[col][k] *= inv }
      for row in 0..<8 where row != col {
        let factor = a[row][col]
        if factor == 0 { continue }
        for k in col...8 { a[row][k] -= factor * a[col][k] }
      }
    }
    return (0..<8).map { a[$0][8] }
  }

  /// Mesh density for a distorted plane. MUST match PLANE_MESH_DIVISIONS in
  /// src/components/EmojiCanvas.tsx — the Skia preview tessellates at 9, and if the two disagree
  /// the artwork visibly changes the moment it is committed.
  private static let planeMeshDivisions = 9

  /// Mirror of computeStampSpacing() in PaintScreen.tsx — turns the spacing slider's normalized
  /// value (0...MAX_NORMALIZED_SPACING) into an actual gap between stamps, in DIP. Constants must
  /// match the JS side exactly or the slider will feel different (or do nothing) once a stroke
  /// reaches the native renderer.
  private static let maxNormalizedSpacing: Float = pow(2, 1 / 1.6) // ≈ 1.4422
  private static let lineSpacingThreshold: Float = 0.02
  private static let lineSpacingMultiplier: Float = 0.16
  private static let minimumPointSpacing: Float = 0.0001

  private static func computeStampSpacing(spanDip: Float, normalizedSpacing: Float) -> Float {
    let span = max(1, spanDip)
    let normalized = max(0, min(normalizedSpacing, maxNormalizedSpacing))
    if normalized <= lineSpacingThreshold {
      return max(minimumPointSpacing, span * lineSpacingMultiplier)
    }
    let eased = normalized == 0 ? 0 : pow(normalized, 1.6)
    return max(minimumPointSpacing, span * eased * 10)
  }

  private func encodePlane(
    texture: MTLTexture, corners: [SIMD2<Float>], opacity: Float, w: Float, h: Float,
    lattice: [SIMD2<Float>] = [], latticeLevel: Int = 1,
    inkUV: (u0: Float, v0: Float, u1: Float, v1: Float) = (0, 0, 1, 1),
    encoder: MTLRenderCommandEncoder
  ) {
    func ndc(_ p: SIMD2<Float>) -> SIMD2<Float> {
      SIMD2<Float>((p.x / w) * 2.0 - 1.0, 1.0 - (p.y / h) * 2.0)
    }
    let tl = ndc(corners[0]), tr = ndc(corners[1]), br = ndc(corners[2]), bl = ndc(corners[3])

    // TESSELLATED, not a single quad.
    //
    // This drew exactly 2 triangles with corner UVs. Two triangles map the texture AFFINELY, one
    // per half, so any quad that is not a parallelogram folds visibly along the shared diagonal —
    // the committed emoji looked warped differently from the plane the user actually placed. The
    // Skia preview has always tessellated (generatePerspectiveMesh, 9 divisions); matching that
    // subdivision here is what makes "Apply" preserve exactly what was on screen.
    // PERSPECTIVE (homography), not bilinear.
    //
    // The Skia path solves a homography from the four corners (solveHomography in
    // CanvasViewport.tsx) and evaluates it per mesh vertex. Bilinear interpolation gives a
    // visibly DIFFERENT surface for the same four corners — straight lines through the interior
    // bow — so the two renderers have to agree on the projection, not just the subdivision.
    // Solved in unit space (0,0)-(1,1) -> the four corners, exactly like the JS version.
    let H = Self.solveHomography(tl: tl, tr: tr, br: br, bl: bl)

    // A plane applied with extra handles replays its LATTICE; four corners alone cannot describe
    // an interior bend, so without this an applied plane snapped back to a plain quad.
    let useLattice = latticeLevel > 1 && lattice.count == (latticeLevel + 1) * (latticeLevel + 1)
    let ndcLattice: [SIMD2<Float>] = useLattice ? lattice.map(ndc) : []

    // At least 3 cells per lattice span, or a bend between handles gets flattened.
    // Declared here because it depends on useLattice above.
    let n: Int = useLattice ? max(Self.planeMeshDivisions, (latticeLevel + 1) * 3) : Self.planeMeshDivisions
    let step: Float = 1.0 / Float(n)

    func at(_ u: Float, _ v: Float) -> SIMD2<Float> {
      if useLattice {
        // Per-cell bilinear — identical to sampleLattice() in src/lib/planeLattice.ts, so the
        // committed surface is the one the preview showed.
        let side = latticeLevel + 1
        let fx = min(Float(latticeLevel), max(0, u * Float(latticeLevel)))
        let fy = min(Float(latticeLevel), max(0, v * Float(latticeLevel)))
        let c0 = min(side - 1, Int(fx)), r0 = min(side - 1, Int(fy))
        let c1 = min(side - 1, c0 + 1), r1 = min(side - 1, r0 + 1)
        let tx = fx - Float(c0), ty = fy - Float(r0)
        let p00 = ndcLattice[r0 * side + c0], p10 = ndcLattice[r0 * side + c1]
        let p01 = ndcLattice[r1 * side + c0], p11 = ndcLattice[r1 * side + c1]
        let top = p00 + (p10 - p00) * tx
        let bot = p01 + (p11 - p01) * tx
        return top + (bot - top) * ty
      }
      let denom = H[6] * u + H[7] * v + 1.0
      let w = abs(denom) < 1e-9 ? 1e-9 : denom
      return SIMD2<Float>(
        (H[0] * u + H[1] * v + H[2]) / w,
        (H[3] * u + H[4] * v + H[5]) / w
      )
    }

    // Crop to the glyph's MEASURED ink bounds (MetalPaintAtlas.measureInkBounds), not a hand-tuned
    // flat constant.
    //
    // A single flat inset only matches Skia's preview for whichever one emoji it happened to be
    // calibrated against — different pictographs fill their em-box by different amounts (a "family"
    // icon vs. a "building" vs. a stack of "books" all measured differently on-device), so one
    // constant was always going to be wrong for most emoji. Measuring the actual rendered alpha per
    // glyph and cropping to that (see MPAtlasEntry) is self-correcting instead of guessed — it is 0
    // margin from the caller's default (0,0,1,1) only for non-emoji textures (smudge tile blits),
    // which must never be cropped at all.
    let uSpan = inkUV.u1 - inkUV.u0
    let vSpan = inkUV.v1 - inkUV.v0
    func tex(_ u: Float, _ v: Float) -> SIMD2<Float> {
      SIMD2<Float>(inkUV.u0 + uSpan * u, inkUV.v0 + vSpan * v)
    }

    var verts: [MPQuadVertex] = []
    verts.reserveCapacity(n * n * 6)
    for row in 0..<n {
      for col in 0..<n {
        let u0 = Float(col) * step, u1 = Float(col + 1) * step
        let v0 = Float(row) * step, v1 = Float(row + 1) * step
        let p00 = at(u0, v0), p10 = at(u1, v0), p01 = at(u0, v1), p11 = at(u1, v1)
        // Crop the stamp's transparent padding, matching generatePerspectiveMesh exactly.
        // Without this the committed plane sampled the FULL padded texture while the preview
        // sampled the cropped one, so the emoji shrank the moment it was applied.
        let t00 = tex(u0, v0), t10 = tex(u1, v0), t01 = tex(u0, v1), t11 = tex(u1, v1)
        verts.append(MPQuadVertex(position: p00, texCoord: t00))
        verts.append(MPQuadVertex(position: p10, texCoord: t10))
        verts.append(MPQuadVertex(position: p01, texCoord: t01))
        verts.append(MPQuadVertex(position: p10, texCoord: t10))
        verts.append(MPQuadVertex(position: p11, texCoord: t11))
        verts.append(MPQuadVertex(position: p01, texCoord: t01))
      }
    }

    encoder.setFragmentTexture(texture, index: 0)
    var opacityValue = opacity
    encoder.setFragmentBytes(&opacityValue, length: MemoryLayout<Float>.size, index: 0)
    // setVertexBytes has a 4KB limit; a 9x9 mesh is 486 verts * 16B ~= 7.8KB, so use a buffer.
    let byteCount = MemoryLayout<MPQuadVertex>.stride * verts.count
    if byteCount <= 4096 {
      encoder.setVertexBytes(&verts, length: byteCount, index: 0)
    } else {
      guard let buffer = device.makeBuffer(bytes: verts, length: byteCount, options: .storageModeShared) else { return }
      encoder.setVertexBuffer(buffer, offset: 0, index: 0)
    }
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: verts.count)
  }
}
