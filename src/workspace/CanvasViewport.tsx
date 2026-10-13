import React, { useRef, useMemo } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, Platform, type Insets } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import Slider from '@react-native-community/slider';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { ResumableZoom } from 'react-native-zoom-toolkit';
import { Canvas, Group, Vertices, vec, ImageShader, Line } from '@shopify/react-native-skia';

import PaintCanvas from './PaintCanvas';
import type { LayerVisibility, PaintLayer, Stroke, TraceState } from '../state/PaintingContext';
import {
  DEFAULT_LAYER_VISIBILITY,
  PAINT_LAYER_ORDER,
  orderStrokesByLayer,
  strokeLayer,
  usePaintingOptional
} from '../state/PaintingContext';
import { getStamp } from '../components/EmojiCanvas';
import { sampleLattice, latticeSide, type LatticeLevel } from '../lib/planeLattice';
import { isCustomBrushReference } from '../lib/customBrushRegistry';
import { type InkBounds } from '../lib/stampInkBounds';

// Perspective transform helpers for plane stroke rendering
const gaussianElimination = (A: number[][], b: number[]): number[] => {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }

    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

    for (let k = i + 1; k < n; k++) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j <= n; j++) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }

  const x: number[] = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= augmented[i][j] * x[j];
    }
    x[i] /= augmented[i][i];
  }

  return x;
};

const solveHomography = (corners: any): number[][] => {
  const { topLeft, topRight, bottomRight, bottomLeft } = corners;

  const src = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ];

  const dst = [topLeft, topRight, bottomRight, bottomLeft];
  const A: number[][] = [];

  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
  }

  const b = [
    dst[0].x, dst[0].y,
    dst[1].x, dst[1].y,
    dst[2].x, dst[2].y,
    dst[3].x, dst[3].y
  ];

  const h = gaussianElimination(A, b);

  const H = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1.0]
  ];

  return H;
};

const applyHomography = (H: number[][], u: number, v: number): { x: number; y: number } => {
  const w = H[2][0] * u + H[2][1] * v + H[2][2];
  const x = (H[0][0] * u + H[0][1] * v + H[0][2]) / w;
  const y = (H[1][0] * u + H[1][1] * v + H[1][2]) / w;
  return { x, y };
};

/**
 * Mesh whose positions come from a control LATTICE instead of a 4-corner homography.
 *
 * Texture mapping and padding are identical to generatePerspectiveMesh — only the position of
 * each vertex differs — so a lattice that has not been dragged produces the same picture as the
 * plain quad it was seeded from.
 */
const generateLatticeMesh = (
  lattice: { x: number; y: number }[],
  level: LatticeLevel,
  divisions: number,
  textureSize: { width: number; height: number },
  inkBounds: InkBounds
): { vertices: any[]; textures: any[]; indices: number[] } => {
  const vertices: any[] = [];
  const textures: any[] = [];
  const indices: number[] = [];

  const textureStart = textureSize.width * inkBounds.u0;
  const textureEnd = textureSize.width * inkBounds.u1;
  const textureStartY = textureSize.height * inkBounds.v0;
  const textureEndY = textureSize.height * inkBounds.v1;

  // Subdivide at least as finely as the lattice itself, or a bend between handles would be
  // flattened by too coarse a mesh.
  const steps = Math.max(divisions, latticeSide(level) * 3);

  for (let row = 0; row <= steps; row += 1) {
    const v = row / steps;
    for (let col = 0; col <= steps; col += 1) {
      const u = col / steps;
      const p = sampleLattice(lattice, level, u, v);
      vertices.push(vec(p.x, p.y));
      textures.push(vec(
        textureStart + (textureEnd - textureStart) * u,
        textureStartY + (textureEndY - textureStartY) * v
      ));
    }
  }
  for (let row = 0; row < steps; row += 1) {
    for (let col = 0; col < steps; col += 1) {
      const tl = row * (steps + 1) + col;
      const tr = tl + 1;
      const bl = (row + 1) * (steps + 1) + col;
      const br = bl + 1;
      indices.push(tl, tr, bl, tr, br, bl);
    }
  }
  return { vertices, textures, indices };
};

const generatePerspectiveMesh = (
  corners: any,
  divisions: number,
  textureSize: { width: number; height: number },
  inkBounds: InkBounds
): {
  vertices: any[];
  textures: any[];
  indices: number[];
} => {
  const vertices: any[] = [];
  const textures: any[] = [];
  const indices: number[] = [];

  const H = solveHomography(corners);

  // Crop to the glyph's MEASURED ink bounds (measureStampInkBounds), not a hand-tuned flat
  // constant — see src/lib/stampInkBounds.ts for why a flat guess never matches the native Metal
  // renderer's own per-glyph measurement.
  const textureStart = textureSize.width * inkBounds.u0;
  const textureEnd = textureSize.width * inkBounds.u1;
  const textureStartY = textureSize.height * inkBounds.v0;
  const textureEndY = textureSize.height * inkBounds.v1;

  for (let row = 0; row <= divisions; row++) {
    const v = row / divisions;
    for (let col = 0; col <= divisions; col++) {
      const u = col / divisions;

      const position = applyHomography(H, u, v);
      vertices.push(vec(position.x, position.y));

      const texU = textureStart + (textureEnd - textureStart) * u;
      const texV = textureStartY + (textureEndY - textureStartY) * v;
      textures.push(vec(texU, texV));
    }
  }

  for (let row = 0; row < divisions; row++) {
    for (let col = 0; col < divisions; col++) {
      const topLeftIdx = row * (divisions + 1) + col;
      const topRightIdx = topLeftIdx + 1;
      const bottomLeftIdx = (row + 1) * (divisions + 1) + col;
      const bottomRightIdx = bottomLeftIdx + 1;

      indices.push(topLeftIdx, topRightIdx, bottomLeftIdx);
      indices.push(topRightIdx, bottomRightIdx, bottomLeftIdx);
    }
  }

  return { vertices, textures, indices };
};

// PlacerTouchLayer Component - Handles corner and whole plane touch interactions with proper pan gestures
interface PlacerTouchLayerProps {
  emojiPlanes: any[];
  selectedPlaneId: string | null;
  isEmojiPlaneActive: boolean;
  draggingCorner: { planeId: string; corner: string } | null;
  onPlaneCornerDragStart?: (planeId: string, corner: string) => void;
  onPlaneCornerDrag?: (planeId: string, corner: string, x: number, y: number) => void;
  onPlaneCornerDragEnd?: (planeId: string) => void;
}

const PlacerTouchLayer: React.FC<PlacerTouchLayerProps> = ({
  emojiPlanes,
  selectedPlaneId,
  isEmojiPlaneActive,
  draggingCorner,
  onPlaneCornerDragStart,
  onPlaneCornerDrag,
  onPlaneCornerDragEnd,
}) => {
  // Use simple Pan gesture handlers without nesting - just render the touch areas
  // The actual drag tracking is handled by onPressIn + native touch tracking

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'visible' }}>
      {/* Corner handlers - 4 corners per plane */}
      {emojiPlanes
        .filter(p => p.id === selectedPlaneId && isEmojiPlaneActive)
        .map(plane => {
          const isDragging = draggingCorner?.planeId === plane.id;
          const cornerEmoji = isDragging ? '✊' : '🫵';
          const corners = [
            { pos: plane.corners.topLeft, name: 'topLeft' },
            { pos: plane.corners.topRight, name: 'topRight' },
            { pos: plane.corners.bottomRight, name: 'bottomRight' },
            { pos: plane.corners.bottomLeft, name: 'bottomLeft' }
          ];

          return corners.map(corner => (
            <TouchableOpacity
              key={`emoji-corner-${plane.id}-${corner.name}`}
              onPressIn={() => {
                onPlaneCornerDragStart?.(plane.id, corner.name);
              }}
              activeOpacity={0.8}
              style={{
                position: 'absolute',
                left: corner.pos.x - 30,  // 60px total touch area (invisible)
                top: corner.pos.y - 30,
                width: 60,
                height: 60,
                justifyContent: 'center',
                alignItems: 'center'
              }}
            >
              {/* Visible emoji in center of 60x60 touch area */}
              <View
                style={{
                  width: 24,
                  height: 24,
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                <Text style={{ fontSize: 20, lineHeight: 20 }}>{cornerEmoji}</Text>
              </View>
            </TouchableOpacity>
          ));
        })}

      {/* Whole plane grab layer - for moving entire emoji plane */}
      {emojiPlanes
        .filter(p => p.id === selectedPlaneId && isEmojiPlaneActive)
        .map(plane => {
          const centerX = (plane.corners.topLeft.x + plane.corners.topRight.x) / 2;
          const centerY = (plane.corners.topLeft.y + plane.corners.bottomLeft.y) / 2;
          const width = Math.sqrt(
            (plane.corners.topRight.x - plane.corners.topLeft.x) ** 2 +
            (plane.corners.topRight.y - plane.corners.topLeft.y) ** 2
          );
          const height = Math.sqrt(
            (plane.corners.bottomLeft.x - plane.corners.topLeft.x) ** 2 +
            (plane.corners.bottomLeft.y - plane.corners.topLeft.y) ** 2
          );

          return (
            <TouchableOpacity
              key={`emoji-plane-grab-${plane.id}`}
              onPressIn={() => {
                onPlaneCornerDragStart?.(plane.id, 'center');
              }}
              activeOpacity={0.7}
              style={{
                position: 'absolute',
                left: centerX - width / 2,
                top: centerY - height / 2,
                width: Math.max(width, 40),  // Minimum 40px for touchability
                height: Math.max(height, 40),
                backgroundColor: 'transparent'
              }}
            />
          );
        })}
    </View>
  );
};

interface CanvasViewportProps {
  /** Override the canvas backdrop (e.g. light grey in face-filter mode,
      'transparent' during mask capture so only strokes are exported) */
  canvasBackgroundColor?: string;
  width: number;
  height: number;
  strokes: Stroke[];
  liveStroke: Stroke | null;
  liveVersion: number;
  previewStroke?: Stroke | null;
  canvasGesture: any;
  canvasAnimatedStyle: any;
  panHandlers: any;
  trace: TraceState;
  traceGesture: any;
  traceAnimatedStyle: any;
  traceLoading: boolean;
  traceLoadingMessage: string;
  showTraceControls: boolean;
  isTraceAdjusting: boolean;
  onZoomUpdate?: (state: { scale: number; translateX: number; translateY: number }) => void;
  styles: any;
  watermarkLetter?: string | null; // Wording mode watermark letter
  forceSkia?: boolean; // Force Skia rendering
  emojiPlanes?: Array<{
    id: string;
    emoji: string;
    corners: {
      topLeft: { x: number; y: number };
      topMid: { x: number; y: number };
      topRight: { x: number; y: number };
      rightMid: { x: number; y: number };
      bottomRight: { x: number; y: number };
      bottomMid: { x: number; y: number };
      bottomLeft: { x: number; y: number };
      leftMid: { x: number; y: number };
    };
    /** Optional distortion lattice — see EmojiPlane.lattice in PaintingContext. */
    lattice?: { x: number; y: number }[];
    latticeLevel?: 1 | 2 | 3 | 5;
    lifetime: number;
    zIndex: number;
    opacity: number;
    visible?: boolean;
    /** 3-layer system — omitted means the default ('middle') layer. */
    layer?: PaintLayer;
  }>;
  selectedPlaneId?: string | null;
  /**
   * Per-layer visibility override. Normally omitted — the painting context is the source of truth.
   * A hidden layer renders nothing here; its strokes/planes are NEVER removed from the data model.
   */
  layerVisibility?: LayerVisibility;
  isEmojiPlaneActive?: boolean;
  draggingCorner?: { planeId: string; corner: string } | null;
  onPlaneCornerDragStart?: (planeId: string, corner: string) => void;
  onPlaneCornerDrag?: (planeId: string, corner: string, x: number, y: number) => void;
  onPlaneCornerDragEnd?: (planeId: string) => void;
}

const CanvasViewport: React.FC<CanvasViewportProps> = ({
  canvasBackgroundColor,
  width,
  height,
  strokes,
  liveStroke,
  liveVersion,
  previewStroke,
  canvasGesture,
  canvasAnimatedStyle,
  panHandlers,
  trace,
  traceGesture,
  traceAnimatedStyle,
  traceLoading,
  traceLoadingMessage,
  showTraceControls,
  isTraceAdjusting,
  onZoomUpdate,
  watermarkLetter,
  forceSkia = false,
  emojiPlanes = [],
  selectedPlaneId = null,
  layerVisibility,
  isEmojiPlaneActive = false,
  draggingCorner = null,
  onPlaneCornerDragStart,
  onPlaneCornerDrag,
  onPlaneCornerDragEnd,
  styles
}) => {
  // 3-LAYER SYSTEM — single point of truth for what the canvas actually shows.
  // Read from the painting context (optional: this component is also mounted in trees without a
  // provider) unless the caller passed an explicit override.
  const painting = usePaintingOptional();
  const resolvedLayerVisibility: LayerVisibility =
    layerVisibility ?? painting?.layerVisibility ?? DEFAULT_LAYER_VISIBILITY;

  // Order background → middle → foreground and drop hidden layers ONCE here, so every renderer
  // behind PaintCanvas (native Metal, tile, Skia) receives the same, already-correct list. The
  // native Metal engine re-splits this by layer into its three committed textures; because a stable
  // filter of an append-only array is still append-only, its incremental append path is preserved.
  // When no layers are in use this returns the very same array reference (zero cost, zero change).
  const visibleStrokes = React.useMemo(
    () => orderStrokesByLayer(strokes, resolvedLayerVisibility),
    [strokes, resolvedLayerVisibility]
  );

  // Uncommitted emoji planes follow the same rule: hidden layers render nothing, and planes paint in
  // layer order (their own zIndex still orders them within a layer).
  const visiblePlanes = React.useMemo(
    () =>
      emojiPlanes.filter(
        (plane) =>
          plane.visible !== false &&
          resolvedLayerVisibility[strokeLayer(plane)]
      ),
    [emojiPlanes, resolvedLayerVisibility]
  );

  // A hidden layer renders NOTHING — including the stroke currently under the finger. Without this
  // the live preview would draw and then vanish the moment it committed into the hidden layer.
  const visibleLiveStroke =
    liveStroke && !resolvedLayerVisibility[strokeLayer(liveStroke)] ? null : liveStroke;

  const isIpad = Platform.OS === 'ios' && (Platform as any)?.isPad === true;
  const minScale = 1; // ResumableZoom requires minScale >= 1, keep 1 even on iPad to avoid crashes
  const maxScale = isIpad ? 6.25 : 5;

  /**
   * Plane preview pass.
   *
   * Called TWICE: once beneath PaintCanvas for planes on the background layer, once above it for
   * everything else. A single overlay on top meant a plane destined for the background previewed
   * in front of the artwork and only dropped behind it on Apply — the placement you were judging
   * was not the placement you got.
   */
  const renderPlanePass = (planesToDraw: typeof visiblePlanes) => (
    planesToDraw.length > 0 ? (
                <Canvas style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: width,
                  height: height,
                  pointerEvents: 'none'
                }}>
                  {/* Uncommitted planes - render with transparency for editing */}
                  {planesToDraw
                    .slice()
                    .sort((a, b) => {
                      // Selected plane always renders last (on top)
                      if (a.id === selectedPlaneId) return 1;
                      if (b.id === selectedPlaneId) return -1;
                      // Layer wins over zIndex: background planes always paint under middle, and
                      // middle under foreground. zIndex only orders planes WITHIN one layer.
                      const layerDelta =
                        PAINT_LAYER_ORDER.indexOf(strokeLayer(a)) -
                        PAINT_LAYER_ORDER.indexOf(strokeLayer(b));
                      if (layerDelta !== 0) return layerDelta;
                      return a.zIndex - b.zIndex;
                    })
                    .map((plane) => {
                      // Custom emojis (PNG) need smaller size to avoid cropping; normal emoji stays at 128px
                      const stampSize = (isCustomBrushReference(plane.emoji) || plane.emoji.startsWith('data:image/png;base64,')) ? 90 : 128;
                      const stampEntry = getStamp(plane.emoji, stampSize);
                      if (!stampEntry?.image) return null;

                      const imageWidth = stampEntry.image.width();
                      const imageHeight = stampEntry.image.height();

                      console.log(`[CANVAS VIEWPORT] Rendering uncommitted plane ${plane.id}:`, {
                        topLeft: plane.corners.topLeft,
                        topRight: plane.corners.topRight,
                        bottomRight: plane.corners.bottomRight,
                        bottomLeft: plane.corners.bottomLeft
                      });

                      // A plane with a lattice bends through EVERY handle, not just its corners:
                      // the homography is defined by 4 points and physically cannot represent an
                      // interior bend, so extra handles would otherwise move nothing on screen.
                      const planeLattice = plane.lattice;
                      const planeLevel = (plane.latticeLevel ?? 1) as LatticeLevel;
                      const mesh = planeLattice && planeLevel > 1
                        ? generateLatticeMesh(
                            planeLattice,
                            planeLevel,
                            9,
                            { width: imageWidth, height: imageHeight },
                            stampEntry.inkBounds
                          )
                        : generatePerspectiveMesh(
                            plane.corners,
                            9,
                            { width: imageWidth, height: imageHeight },
                            stampEntry.inkBounds
                          );

                      const isSelected = plane.id === selectedPlaneId && isEmojiPlaneActive;
                      const isDragging = draggingCorner?.planeId === plane.id;
                      const frameColor = isDragging ? '#ff8c00' : '#ffd700'; // Orange when dragging, yellow otherwise

                      // The selection frame lives OUTSIDE the opacity group: at opacity 0 the plane
                      // must vanish completely while still being visibly selectable/editable.
                      return (
                        <React.Fragment key={plane.id}>
                        <Group opacity={plane.opacity}>
                          <Vertices
                            vertices={mesh.vertices}
                            textures={mesh.textures}
                            indices={mesh.indices}
                          >
                            <ImageShader
                              image={stampEntry.image}
                              fit="cover"
                              rect={{ x: 0, y: 0, width: imageWidth, height: imageHeight }}
                            />
                          </Vertices>
                        </Group>

                          {/* Frame highlight for selected plane */}
                          {/* Lattice handles + grid. Drawn INSTEAD of the 4 corner markers when a
                              lattice is active, so the dots you see are exactly the points you can
                              grab. Outside the opacity group so they stay visible at alpha 0. */}
                          {isSelected && planeLattice && planeLevel > 1 && (() => {
                            const side = latticeSide(planeLevel);
                            const at = (r: number, c: number) => planeLattice[r * side + c];
                            const gridLines: React.ReactNode[] = [];
                            for (let r = 0; r < side; r += 1) {
                              for (let c = 0; c < side; c += 1) {
                                if (c + 1 < side) {
                                  gridLines.push(
                                    <Line key={`h-${r}-${c}`} p1={vec(at(r, c).x, at(r, c).y)}
                                      p2={vec(at(r, c + 1).x, at(r, c + 1).y)}
                                      color="rgba(255,215,0,0.55)" strokeWidth={2} />
                                  );
                                }
                                if (r + 1 < side) {
                                  gridLines.push(
                                    <Line key={`v-${r}-${c}`} p1={vec(at(r, c).x, at(r, c).y)}
                                      p2={vec(at(r + 1, c).x, at(r + 1, c).y)}
                                      color="rgba(255,215,0,0.55)" strokeWidth={2} />
                                  );
                                }
                              }
                            }
                            const dots = planeLattice.map((pt, i) => (
                              <Line key={`d-${i}`} p1={vec(pt.x, pt.y)} p2={vec(pt.x + 0.01, pt.y)}
                                color="#ff6b6b" strokeWidth={16} strokeCap="round" />
                            ));
                            return <>{gridLines}{dots}</>;
                          })()}
                          {isSelected && !(planeLattice && planeLevel > 1) && (
                            <>
                              <Line
                                p1={vec(plane.corners.topLeft.x, plane.corners.topLeft.y)}
                                p2={vec(plane.corners.topRight.x, plane.corners.topRight.y)}
                                color={frameColor}
                                strokeWidth={5}
                              />
                              <Line
                                p1={vec(plane.corners.topRight.x, plane.corners.topRight.y)}
                                p2={vec(plane.corners.bottomRight.x, plane.corners.bottomRight.y)}
                                color={frameColor}
                                strokeWidth={5}
                              />
                              <Line
                                p1={vec(plane.corners.bottomRight.x, plane.corners.bottomRight.y)}
                                p2={vec(plane.corners.bottomLeft.x, plane.corners.bottomLeft.y)}
                                color={frameColor}
                                strokeWidth={5}
                              />
                              <Line
                                p1={vec(plane.corners.bottomLeft.x, plane.corners.bottomLeft.y)}
                                p2={vec(plane.corners.topLeft.x, plane.corners.topLeft.y)}
                                color={frameColor}
                                strokeWidth={5}
                              />

                              {/* Corner dots - simple circles */}
                              <Line
                                p1={vec(plane.corners.topLeft.x - 8, plane.corners.topLeft.y)}
                                p2={vec(plane.corners.topLeft.x + 8, plane.corners.topLeft.y)}
                                color="#ff6b6b"
                                strokeWidth={16}
                                strokeCap="round"
                              />
                              <Line
                                p1={vec(plane.corners.topRight.x - 8, plane.corners.topRight.y)}
                                p2={vec(plane.corners.topRight.x + 8, plane.corners.topRight.y)}
                                color="#ff6b6b"
                                strokeWidth={16}
                                strokeCap="round"
                              />
                              <Line
                                p1={vec(plane.corners.bottomRight.x - 8, plane.corners.bottomRight.y)}
                                p2={vec(plane.corners.bottomRight.x + 8, plane.corners.bottomRight.y)}
                                color="#ff6b6b"
                                strokeWidth={16}
                                strokeCap="round"
                              />
                              <Line
                                p1={vec(plane.corners.bottomLeft.x - 8, plane.corners.bottomLeft.y)}
                                p2={vec(plane.corners.bottomLeft.x + 8, plane.corners.bottomLeft.y)}
                                color="#ff6b6b"
                                strokeWidth={16}
                                strokeCap="round"
                              />
                            </>
                          )}
                        </React.Fragment>
                      );
                    })}
                </Canvas>
    ) : null
  );

  return (
    <ResumableZoom
      minScale={minScale}
      maxScale={maxScale}
      panMode="clamp"
      scaleMode="clamp"
      pinchMode="clamp"
      panEnabled
      pinchEnabled
      allowPinchPanning
      extendGestures
      decay={false}
      tapsEnabled={false}
      onUpdate={onZoomUpdate}
    >
      <Animated.View style={[styles.canvasWrapper, { width, height }, canvasAnimatedStyle]}>
        <GestureDetector gesture={canvasGesture}>
          <View style={[styles.canvasArea, { overflow: 'visible' }]} {...panHandlers}>
            {/* Canvas with content - restricted bounds */}
            <View style={{
              width,
              height,
              borderRadius: 18,
              overflow: 'hidden',
              backgroundColor: canvasBackgroundColor ?? '#030303',
              position: 'relative'
            }}>
              {/* Background image layer - renders BEHIND strokes when isBackground=true */}
              {trace.imageUri && trace.isBackground ? (
                <Animated.View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFillObject, { zIndex: 0 }]}
                >
                  <Animated.View style={[styles.traceOverlay, traceAnimatedStyle]}>
                    <Image source={{ uri: trace.imageUri }} style={styles.traceImage} resizeMode="contain" />
                  </Animated.View>
                </Animated.View>
              ) : null}
              {/* Background-layer planes preview BENEATH the artwork, matching where they land. */}
              {renderPlanePass(visiblePlanes.filter((pl) => strokeLayer(pl) === 'background'))}
              <PaintCanvas
                width={width}
                height={height}
                strokes={visibleStrokes}
                liveStroke={visibleLiveStroke}
                liveVersion={liveVersion}
                previewStroke={previewStroke}
                // Enter the same Skia path that committed planes use BEFORE Apply. Otherwise the
                // surrounding canvas changes renderer at the exact moment the editable plane is
                // replaced by its stroke. Keeping the renderer stable makes Apply state-only: the
                // plane's Skia stamp, ink bounds, DPR and mesh remain unchanged on every device.
                forceSkia={forceSkia || visiblePlanes.length > 0}
                backgroundColor={
                  canvasBackgroundColor === 'transparent'
                    ? 'transparent'
                    : (trace.imageUri && trace.isBackground ? 'transparent' : undefined)
                }
              />

              {/* PaintCanvas renders regular strokes and committed planes */}
              {renderPlanePass(visiblePlanes.filter((pl) => strokeLayer(pl) !== 'background'))}
            </View>

            {/* Emoji corner handles layer - DISABLED: PanResponder in PaintScreen handles all placer interactions directly */}
            {/* The PlacerTouchLayer was causing conflicts by capturing touches before PanResponder could calculate offsets */}
            {/* All corner/plane dragging is now handled cleanly in PaintScreen's onPanResponderGrant/Move/Release */}
          </View>
        </GestureDetector>
        {watermarkLetter ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: height * 0.25, // Positioned at 25% from top for better centering
              left: 0,
              width: width,
              height: height * 0.75,
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent'
            }}
          >
            <Text
              style={{
                fontSize: width * 0.78, // 20% bigger (was 0.65, now 0.78)
                fontWeight: '900',
                fontFamily: 'vrtlfinal', // Use app's custom font
                color: 'rgba(255, 255, 255, 0.12)',
                textAlign: 'center',
                textTransform: 'none', // Preserve case - uppercase, lowercase, symbols
                lineHeight: width * 0.78,
                includeFontPadding: false,
                textShadowColor: 'rgba(255, 255, 255, 0.3)',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 2
              }}
            >
              {watermarkLetter}
            </Text>
          </View>
        ) : null}
        {trace.imageUri && !trace.isBackground ? (
          <Animated.View
            pointerEvents={showTraceControls ? 'auto' : 'none'}
            style={StyleSheet.absoluteFillObject}
          >
            <GestureDetector gesture={traceGesture}>
              <Animated.View style={[styles.traceOverlay, traceAnimatedStyle]}>
                <Image source={{ uri: trace.imageUri }} style={styles.traceImage} resizeMode="contain" />
                {(traceLoading || isTraceAdjusting) && (
                  <View style={styles.traceLoadingChip}>
                    <Text style={styles.traceLoadingText}>
                      {traceLoading ? traceLoadingMessage : 'Adjusting trace…'}
                    </Text>
                  </View>
                )}
              </Animated.View>
            </GestureDetector>
          </Animated.View>
        ) : null}
      </Animated.View>
    </ResumableZoom>
  );
};

export default CanvasViewport;
