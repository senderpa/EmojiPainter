import ARKit
import Foundation
import simd

/// Exact triangle/barycentric attachment model used by AR Draw. A mark keeps
/// its location and orientation in the face triangle's tangent frame, so the
/// mark smiles, blinks, and stretches with the live ARFaceGeometry.
struct FrontMaskFaceBinding: Equatable {
  let triangleIndex: Int
  let barycentric: SIMD3<Float>
  let normalOffset: Float
  let localRotation: simd_quatf

  static func == (lhs: FrontMaskFaceBinding, rhs: FrontMaskFaceBinding) -> Bool {
    lhs.triangleIndex == rhs.triangleIndex
      && lhs.barycentric == rhs.barycentric
      && lhs.normalOffset == rhs.normalOffset
  }

  static func bind(localPosition: SIMD3<Float>, orientation: simd_quatf,
                   geometry: ARFaceGeometry,
                   maxDistance: Float? = nil) -> FrontMaskFaceBinding? {
    let vertices = geometry.vertices
    let indices = geometry.triangleIndices
    guard geometry.triangleCount > 0 else { return nil }
    var bestIndex = -1
    var bestDistance = Float.greatestFiniteMagnitude
    var bestBarycentric = SIMD3<Float>(1, 0, 0)

    for triangle in 0..<geometry.triangleCount {
      let base = triangle * 3
      let a = vertices[Int(indices[base])]
      let b = vertices[Int(indices[base + 1])]
      let c = vertices[Int(indices[base + 2])]
      let (point, coords) = closestPoint(to: localPosition, a: a, b: b, c: c)
      let distance = simd_distance_squared(point, localPosition)
      if distance < bestDistance {
        bestDistance = distance
        bestIndex = triangle
        bestBarycentric = coords
      }
    }
    guard bestIndex >= 0 else { return nil }
    if let maxDistance, bestDistance > maxDistance * maxDistance { return nil }

    let base = bestIndex * 3
    let a = vertices[Int(indices[base])]
    let b = vertices[Int(indices[base + 1])]
    let c = vertices[Int(indices[base + 2])]
    guard let frame = tangentFrame(a: a, b: b, c: c) else { return nil }
    let surface = a * bestBarycentric.x + b * bestBarycentric.y + c * bestBarycentric.z
    let offset = simd_dot(localPosition - surface, frame.normal)
    return FrontMaskFaceBinding(triangleIndex: bestIndex,
                                barycentric: bestBarycentric,
                                normalOffset: offset,
                                localRotation: frame.rotation.inverse * orientation)
  }

  func evaluate(geometry: ARFaceGeometry) -> (position: SIMD3<Float>, orientation: simd_quatf)? {
    guard triangleIndex >= 0, triangleIndex < geometry.triangleCount else { return nil }
    let indices = geometry.triangleIndices
    let vertices = geometry.vertices
    let base = triangleIndex * 3
    let a = vertices[Int(indices[base])]
    let b = vertices[Int(indices[base + 1])]
    let c = vertices[Int(indices[base + 2])]
    guard let frame = Self.tangentFrame(a: a, b: b, c: c) else { return nil }
    let surface = a * barycentric.x + b * barycentric.y + c * barycentric.z
    return (surface + frame.normal * normalOffset, frame.rotation * localRotation)
  }

  static func tangentFrame(a: SIMD3<Float>, b: SIMD3<Float>, c: SIMD3<Float>)
    -> (normal: SIMD3<Float>, rotation: simd_quatf)? {
    let edge1 = b - a
    let edge2 = c - a
    let cross = simd_cross(edge1, edge2)
    let area = simd_length(cross)
    guard area > 1e-9, simd_length(edge1) > 1e-7 else { return nil }
    let normal = cross / area
    let tangent = simd_normalize(edge1)
    let bitangent = simd_cross(normal, tangent)
    return (normal, simd_quatf(simd_float3x3(tangent, bitangent, normal)))
  }

  static func closestPoint(to point: SIMD3<Float>, a: SIMD3<Float>,
                           b: SIMD3<Float>, c: SIMD3<Float>)
    -> (SIMD3<Float>, SIMD3<Float>) {
    let ab = b - a, ac = c - a, ap = point - a
    let d1 = simd_dot(ab, ap), d2 = simd_dot(ac, ap)
    if d1 <= 0 && d2 <= 0 { return (a, SIMD3<Float>(1, 0, 0)) }
    let bp = point - b
    let d3 = simd_dot(ab, bp), d4 = simd_dot(ac, bp)
    if d3 >= 0 && d4 <= d3 { return (b, SIMD3<Float>(0, 1, 0)) }
    let vc = d1 * d4 - d3 * d2
    if vc <= 0 && d1 >= 0 && d3 <= 0 {
      let v = d1 / max(d1 - d3, 1e-9)
      return (a + ab * v, SIMD3<Float>(1 - v, v, 0))
    }
    let cp = point - c
    let d5 = simd_dot(ab, cp), d6 = simd_dot(ac, cp)
    if d6 >= 0 && d5 <= d6 { return (c, SIMD3<Float>(0, 0, 1)) }
    let vb = d5 * d2 - d1 * d6
    if vb <= 0 && d2 >= 0 && d6 <= 0 {
      let w = d2 / max(d2 - d6, 1e-9)
      return (a + ac * w, SIMD3<Float>(1 - w, 0, w))
    }
    let va = d3 * d6 - d5 * d4
    if va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0 {
      let w = (d4 - d3) / max((d4 - d3) + (d5 - d6), 1e-9)
      return (b + (c - b) * w, SIMD3<Float>(0, 1 - w, w))
    }
    let denominator = 1 / max(va + vb + vc, 1e-9)
    let v = vb * denominator
    let w = vc * denominator
    return (a + ab * v + ac * w, SIMD3<Float>(1 - v - w, v, w))
  }
}
