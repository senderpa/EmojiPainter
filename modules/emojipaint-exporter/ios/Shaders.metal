#include <metal_stdlib>
using namespace metal;

/**
 * Metal Shaders for GPU-Accelerated Emoji Compositing
 * Zero-copy, GPU-only rendering for timelapse export
 */

// Vertex structure for rendering textured quads
struct QuadVertexData {
    float2 position;
    float2 texCoord;
};

struct VertexOut {
    float4 position [[position]];
    float2 texCoord;
};

// Vertex shader for textured quad rendering (using vertex buffer, not attributes)
vertex VertexOut vertex_main(
    constant QuadVertexData* vertices [[buffer(0)]],
    uint vid [[vertex_id]]
) {
    VertexOut out;
    out.position = float4(vertices[vid].position, 0.0, 1.0);
    out.texCoord = vertices[vid].texCoord;
    return out;
}

// Fragment shader for emoji stamp compositing with alpha blending
fragment float4 fragment_emoji_stamp(
    VertexOut in [[stage_in]],
    texture2d<float> emojiTexture [[texture(0)]],
    constant float &opacity [[buffer(0)]]
) {
    constexpr sampler textureSampler(mag_filter::linear, min_filter::linear);
    float4 emojiColor = emojiTexture.sample(textureSampler, in.texCoord);

    // Apply opacity
    emojiColor.a *= opacity;

    return emojiColor;
}

// Fragment shader for simple texture blit
fragment float4 fragment_blit(
    VertexOut in [[stage_in]],
    texture2d<float> sourceTexture [[texture(0)]]
) {
    constexpr sampler textureSampler(mag_filter::linear, min_filter::linear);
    return sourceTexture.sample(textureSampler, in.texCoord);
}

// Kernel for clearing canvas to white
kernel void clear_to_white(
    texture2d<float, access::write> output [[texture(0)]],
    uint2 gid [[thread_position_in_grid]]
) {
    if (gid.x >= output.get_width() || gid.y >= output.get_height()) {
        return;
    }

    output.write(float4(1.0, 1.0, 1.0, 1.0), gid);
}

// Kernel for clearing canvas to transparent
kernel void clear_to_transparent(
    texture2d<float, access::write> output [[texture(0)]],
    uint2 gid [[thread_position_in_grid]]
) {
    if (gid.x >= output.get_width() || gid.y >= output.get_height()) {
        return;
    }

    output.write(float4(0.0, 0.0, 0.0, 0.0), gid);
}
