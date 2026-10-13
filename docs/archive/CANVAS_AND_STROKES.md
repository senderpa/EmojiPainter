# Canvas and Stroke System Documentation

## Overview

EmojiPaint uses a **direct painting system** where users paint emojis onto a canvas. The system is built on React Native with Skia for rendering and supports both software (Skia) and hardware-accelerated (Metal on iOS) rendering.

---

## Core Data Structures

### StrokePoint

A single point in a stroke, representing where the user's finger was at a specific time.

```typescript
interface StrokePoint {
  x: number;        // X coordinate in canvas space (pixels)
  y: number;        // Y coordinate in canvas space (pixels)
  t: number;        // Timestamp (milliseconds since epoch)
}
```

**Key Properties:**
- Coordinates are in **canvas pixel space** (not screen space)
- All coordinates use **direct 1:1 mapping** - NO transformations needed
- Timestamp `t` enables stroke replay and timelapse features

### Stroke

A complete brush stroke made by the user.

```typescript
interface Stroke {
  id: string;                // Unique identifier (UUID)
  emoji: string;             // Emoji character to paint
  size: number;              // Emoji size in pixels
  opacity: number;           // 0.0 to 1.0
  spacing?: number;          // Distance between emojis (0.001 = tight)
  stampSpan?: number;        // Spacing multiplier
  points: StrokePoint[];     // Array of touch points
  emojiSequence?: string[];  // For rainbow/multi-emoji strokes
  mirrorX?: boolean;         // Horizontal mirror
  mirrorY?: boolean;         // Vertical mirror
  rotation?: number;         // Rotation in degrees
}
```

**Important Details:**
- Each stroke is **immutable** once committed
- Strokes are stored in memory up to `MAX_HISTORY` limit (2000 strokes)
- Spacing of `0.001` creates tight, continuous emoji lines
- `emojiSequence` enables rainbow effects (cycles through multiple emojis)

---

## Canvas System Architecture

### Coordinate System

**CRITICAL**: The canvas uses **Procreate-style direct mapping**:

```
Touch Event → Canvas Coordinates (1:1 mapping)
                    ↓
              NO transformation
                    ↓
            Render at exact position
```

**Key Rules:**
1. **NO zoom transformations** - Canvas is fixed size
2. **NO coordinate conversion** - Touch X/Y = Canvas X/Y
3. **Simple and direct** - Matches user's finger exactly

### Canvas Dimensions

```typescript
const CANVAS_WIDTH = 1024;   // pixels
const CANVAS_HEIGHT = 1024;  // pixels
```

Defined in: `src/screens/PaintScreen.tsx`

---

## Rendering System

### Dual Renderer Architecture

The app supports **two rendering backends**:

```
PaintCanvas (Wrapper)
        ├── Skia Renderer (EmojiCanvas) - Default, cross-platform
        └── Metal Renderer (MetalEmojiCanvas) - iOS only, GPU-accelerated
```

**File**: `src/workspace/PaintCanvas.tsx`

#### Renderer Selection Logic

```typescript
const shouldUseMetal =
  Platform.OS === 'ios' &&
  isMetalAvailable() &&
  featureFlags.isEnabled('useMetalCanvas');

const CanvasComponent = shouldUseMetal ? MetalEmojiCanvas : EmojiCanvas;
```

### Skia Renderer (Default)

**File**: `src/components/EmojiCanvas.tsx`

**Features:**
- Uses `@shopify/react-native-skia` for 2D graphics
- Software rendering (CPU-based)
- Cross-platform (iOS + Android)
- Draws emojis as images using Skia's Canvas API

**Performance:**
- Renders up to 2000 strokes efficiently
- Uses stamp caching to avoid re-rendering emojis
- Adaptive point decimation reduces memory usage

### Metal Renderer (Optional)

**File**: `src/components/MetalEmojiCanvas.tsx`

**Features:**
- Native Metal shader-based rendering
- GPU-accelerated
- iOS only
- Uses texture atlases for emoji stamps

**Performance Boost:**
- 3-5x faster than Skia
- Lower memory usage
- Smooth 60fps even with thousands of strokes

---

## Stroke Creation Flow

### 1. User Touch Events

**File**: `src/screens/PaintScreen.tsx` (lines 2700-3000)

```typescript
// Touch starts
onTouchStart(event) →
  Create new stroke with first point
  Lock brush settings (emoji, size, opacity)

// Touch moves
onTouchMove(event) →
  Add points to current stroke
  Apply adaptive spacing
  Render live preview

// Touch ends
onTouchEnd(event) →
  Finalize stroke
  Commit to state
  Clear live preview
}
```

### 2. Point Collection

**Adaptive Spacing:**
- Points are added only if distance from last point > spacing threshold
- Prevents duplicate points when finger moves slowly
- Default spacing: `0.001` (very tight for smooth lines)

```typescript
const dx = newPoint.x - lastPoint.x;
const dy = newPoint.y - lastPoint.y;
const distance = Math.hypot(dx, dy);

if (distance >= brushSpacing) {
  points.push(newPoint);
}
```

### 3. Stroke Smoothing

**File**: `src/state/PaintingContext.tsx` (lines 126-160)

**Catmull-Rom Spline Interpolation:**

```typescript
function smoothStrokePoints(points: StrokePoint[]): StrokePoint[] {
  // Uses Catmull-Rom cubic interpolation
  // Adds SMOOTH_SEGMENTS (4) points between each original point
  // Creates smooth curves from straight lines
}
```

**Why Smoothing?**
- Raw touch events are jagged
- Interpolation creates natural, flowing curves
- Preserves original points while adding in-betweens

### 4. Point Decimation

**File**: `src/lib/strokeProcessing.ts`

**Adaptive Decimation:**
- Removes redundant points while preserving shape
- Uses Douglas-Peucker algorithm
- Reduces memory usage by 50-70%

```typescript
function adaptiveDecimatePoints(
  points: StrokePoint[],
  epsilon: number = 0.5
): StrokePoint[]
```

**When Applied:**
- During autosave
- When stroke history reaches MAX_HISTORY limit
- Before exporting/sharing paintings

---

## State Management

### PaintingContext

**File**: `src/state/PaintingContext.tsx`

**Global State Structure:**

```typescript
interface PaintingState {
  strokes: Stroke[];           // All committed strokes
  undoStack: Stroke[];         // Last 5 undone strokes
  brushEmoji: string;          // Currently selected emoji
  brushSize: number;           // Size in pixels
  brushOpacity: number;        // 0.0 to 1.0
  brushSpacing: number;        // Point spacing
  brushRotation: number;       // Rotation in degrees
  recentEmojis: string[];      // Recently used emojis
  trace: TraceState;           // Reference image overlay
  mirrorX: boolean;            // Horizontal flip
  mirrorY: boolean;            // Vertical flip
}
```

### Actions

```typescript
// Brush controls
dispatch({ type: 'SET_BRUSH_EMOJI', emoji: '🎨' });
dispatch({ type: 'SET_BRUSH_SIZE', size: 48 });
dispatch({ type: 'SET_BRUSH_OPACITY', opacity: 0.8 });

// Stroke management
dispatch({ type: 'COMMIT_STROKE', stroke });
dispatch({ type: 'UNDO' });
dispatch({ type: 'REDO' });
dispatch({ type: 'CLEAR_STROKES' });
```

### History Management

**Limits:**
- `MAX_HISTORY = 2000` strokes in memory
- `MAX_UNDO_STACK = 5` undo levels
- Oldest strokes are removed when limit reached

---

## Rendering Process

### Live Stroke Rendering

**During painting:**

```
User touches screen
    ↓
Add point to liveStroke
    ↓
PaintCanvas receives liveStroke prop
    ↓
Renderer draws liveStroke in real-time
    ↓
User releases finger
    ↓
Commit liveStroke to strokes array
    ↓
Clear liveStroke
```

**Performance:**
- Live stroke is **NOT** added to main strokes array
- Rendered separately on top
- No re-render of existing strokes during painting
- Smooth 60fps painting experience

### Stroke Replay Rendering

**File**: `src/components/EmojiCanvas.tsx` (lines 150-300)

```typescript
// For each stroke
for (const stroke of strokes) {
  // For each point in stroke
  for (let i = 0; i < stroke.points.length; i++) {
    const point = stroke.points[i];

    // Calculate spacing
    if (distance_from_last_stamp >= stroke.spacing * stroke.size) {
      // Draw emoji stamp at point.x, point.y
      drawEmojiStamp(point.x, point.y, stroke.emoji, stroke.size, stroke.opacity);
    }
  }
}
```

**Stamp Caching:**
- Each unique emoji+size combination is pre-rendered once
- Cached as texture/image
- Reused for all subsequent stamps
- Massive performance improvement

---

## Canvas Viewport

**File**: `src/workspace/CanvasViewport.tsx`

**Current Implementation** (No Zoom):

```tsx
<View style={{ width, height }}>
  <Animated.View style={[styles.canvasWrapper, { width, height }]}>
    <GestureDetector gesture={canvasGesture}>
      <View style={styles.canvasArea} {...panHandlers}>
        <PaintCanvas
          width={width}
          height={height}
          strokes={strokes}
          liveStroke={liveStroke}
        />
      </View>
    </GestureDetector>
  </Animated.View>
</View>
```

**Features:**
- ✅ Direct painting - no zoom/pan
- ✅ Full canvas always visible
- ✅ Simple, clean architecture
- ✅ No coordinate transformations needed

---

## Trace Image System

### Purpose

Allow users to overlay a reference image to trace.

### TraceState

```typescript
interface TraceState {
  imageUri: string | null;   // Path to reference image
  scale: number;             // Size scaling (0.5 to 2.0)
  offsetX: number;           // Horizontal position
  offsetY: number;           // Vertical position
  opacity: number;           // Visibility (0.0 to 1.0)
  rotation: number;          // Rotation in degrees
}
```

### Usage

```typescript
// Load trace image
dispatch({
  type: 'SET_TRACE',
  trace: {
    imageUri: '/path/to/image.jpg',
    opacity: 0.5,
    scale: 1.0
  }
});

// Adjust opacity for easier tracing
dispatch({ type: 'SET_TRACE', trace: { opacity: 0.3 } });

// Remove trace
dispatch({ type: 'SET_TRACE', trace: { imageUri: null } });
```

---

## Performance Optimizations

### Memory Management

1. **Stroke Limit**: Maximum 2000 strokes in memory
2. **Point Decimation**: Reduces points by 50-70% without visible quality loss
3. **Stamp Caching**: Pre-render emoji stamps once, reuse forever
4. **Lazy Rendering**: Only re-render changed strokes

### Rendering Optimizations

1. **Checkpointing**: Render to texture every 12 strokes, avoid full replay
2. **Adaptive Quality**: Lower quality during live painting, full quality on release
3. **Frame Skipping**: Skip intermediate live stroke updates if frame rate drops
4. **GPU Acceleration**: Metal renderer offloads work to GPU

### Touch Input Optimization

1. **Throttling**: Process touch events max 60fps
2. **Coalesced Events**: Batch multiple touch events into one update
3. **Predicted Points**: Use iOS touch prediction for smoother lines

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/state/PaintingContext.tsx` | Global state, stroke management, smoothing |
| `src/screens/PaintScreen.tsx` | Main painting UI, touch handling |
| `src/workspace/PaintCanvas.tsx` | Renderer selector (Skia vs Metal) |
| `src/workspace/CanvasViewport.tsx` | Canvas container, NO zoom |
| `src/components/EmojiCanvas.tsx` | Skia-based renderer |
| `src/components/MetalEmojiCanvas.tsx` | Metal-based renderer (iOS) |
| `src/lib/strokeProcessing.ts` | Point decimation, optimization |
| `src/lib/autosave.ts` | Auto-save stroke data |

---

## Autosave System

**File**: `src/lib/autosave.ts`

**Features:**
- Saves painting state every 3 seconds after last stroke
- Activates after 60 seconds OR 5+ strokes
- Stores compressed stroke data in AsyncStorage
- Automatic recovery on app restart

**Autosave Payload:**

```typescript
interface AutosavePayload {
  version: number;
  timestamp: string;
  strokes: Stroke[];        // All strokes
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  brushRotation?: number;
  trace: TraceState;
  canvasWidth: number;
  canvasHeight: number;
}
```

---

## Export System

### Export Methods

1. **PNG Export** - Full resolution raster image
2. **MP4 Export** - Timelapse video of painting process
3. **ZIP Export** - Frame-by-frame PNG sequence

**File**: `src/screens/PaintScreen.tsx` (export functions)

### Export Flow

```
User requests export
    ↓
Replay all strokes to offscreen canvas
    ↓
Capture final image OR
Generate timelapse frames
    ↓
Save to Photos library
```

---

## Common Patterns

### Adding a New Brush Property

1. Add to `Stroke` interface
2. Add to `PaintingState` interface
3. Create action type in `PaintingAction`
4. Handle in reducer
5. Add UI control in `PaintScreen.tsx`
6. Apply during stroke creation

### Custom Emoji Effects

**Rainbow Emoji:**
```typescript
const stroke: Stroke = {
  ...baseStroke,
  emojiSequence: ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'],
  // Cycles through colors as user paints
};
```

**Mirrored Painting:**
```typescript
const stroke: Stroke = {
  ...baseStroke,
  mirrorX: true,  // Horizontally flipped
  mirrorY: false
};
```

---

## Best Practices

### DO:
- ✅ Keep strokes immutable
- ✅ Use adaptive spacing for smooth lines
- ✅ Cache emoji stamps
- ✅ Decimate points before saving
- ✅ Use direct coordinate mapping

### DON'T:
- ❌ Modify strokes after commit
- ❌ Store raw touch events
- ❌ Apply zoom transformations to coordinates
- ❌ Re-render entire canvas on every touch
- ❌ Skip point smoothing

---

## Troubleshooting

### Jagged Lines
- **Cause**: Smoothing disabled or insufficient interpolation
- **Fix**: Ensure `SMOOTH_SEGMENTS = 4` in `PaintingContext.tsx`

### Memory Issues
- **Cause**: Too many strokes or points
- **Fix**: Reduce `MAX_HISTORY` or enable point decimation

### Slow Rendering
- **Cause**: No stamp caching or too many strokes
- **Fix**: Enable Metal renderer or implement checkpointing

### Offset Strokes
- **Cause**: Incorrect coordinate transformation
- **Fix**: Remove ALL zoom/pan transformations, use direct 1:1 mapping

---

## Future Enhancements

### Potential Features:
- Pressure sensitivity (Apple Pencil support)
- Brush presets (save emoji + size + spacing combos)
- Layer system (multiple canvas layers)
- Blend modes (multiply, screen, overlay)
- Shape tools (line, circle, rectangle with emoji fill)
- Text tool (type text rendered as emojis)

---

*Last Updated: 2025-11-21*
*Version: 1.0*
