# Framer Workspace Debugging Guide

## Automated Testing

When you open the Framer workspace, automated tests run automatically and log to the console:

```
========================================
🧪 FRAMER WORKSPACE AUTOMATED TESTS
========================================

Test 1: getStamp function exists
✅ PASS: getStamp is a function

Test 2: Creating stamp for 🎨 size 64
✅ PASS: Stamp created successfully

Test 3: Verify stamp properties
✅ PASS: Stamp has dimensions 64x64

Current frame: 0
Stroke length: 3
Active frames: [0, 1, 2]
Expected: [0, 1, 2]
✅ PASS: Frame calculation correct

✅ ALL AUTOMATED TESTS PASSED
Framer workspace is ready for painting!
========================================
```

## Expected Console Logs When Painting

### 1. Opening Framer
```
[RENDER] Frame 0 has 0 stamps
```

### 2. Touching Canvas
```
[TOUCH] onStartShouldSetPanResponder - returning true
[TOUCH] onPanResponderGrant called
[TOUCH] POINTER DOWN at (150, 200)
[PAINT] Stamp at (150,200) → frames [0,1,2]
[PAINT] Added 3 stamps to 3 frames
[RENDER] Frame 0 has 1 stamps
[RENDER] Rendering 1 stamps, first at (150,200)
```

### 3. Drawing Stroke
```
[TOUCH] POINTER MOVE to (155, 205)
[PAINT] Stamp at (151,201) → frames [0,1,2]
[PAINT] Added 3 stamps to 3 frames
[PAINT] Stamp at (152,202) → frames [0,1,2]
[PAINT] Added 3 stamps to 3 frames
...
[RENDER] Frame 0 has 15 stamps
[RENDER] Rendering 15 stamps, first at (150,200)
```

## Troubleshooting

### If NO logs appear when opening framer:
- Component not mounting
- Check if `visible` prop is true
- Reload app completely

### If automated tests FAIL:
- getStamp not exported correctly
- Check `/src/components/EmojiCanvas.tsx:301`
- Should be: `export const getStamp = ...`

### If NO touch logs appear:
- PanResponder not capturing touches
- Check if `isPlaying` is false
- Check if `canvasLayout.current` exists
- Try touching center of canvas

### If paint logs appear but NO render logs:
- State update not triggering re-render
- Check React DevTools
- Verify frames state is updating

### If render logs appear but NO visible strokes:
- Stamp rendering issue
- Check if getStamp returns valid image
- Verify coordinates are within canvas bounds
- Check opacity is not 0

## Performance Optimization

### Current Optimizations:
1. Image stamp caching via getStamp
2. Batched state updates (React 18)
3. Memoized callbacks with useCallback
4. Efficient key generation for React rendering

### Memory Management:
- Stamp cache automatically managed by EmojiCanvas
- Old stamps evicted when cache exceeds limit
- Frame data stored as simple objects
- No memory leaks from event listeners

## Code Flow

### Paint Operation:
1. User touches canvas → `onPanResponderGrant`
2. Get touch coordinates → `locationX, locationY`
3. Call `paintStrokePoint(x, y)`
4. Calculate active frames based on `currentFrame + strokeLength`
5. Create stamp object with emoji, size, opacity, etc.
6. Update frames state with `setFrames`
7. React re-renders → calls render function
8. Map over `currentStamps`
9. Get cached image via `getStamp`
10. Render `SkiaImage` at stamp position

### Frame Calculation:
```typescript
const endFrame = (currentFrame + strokeLength) % frameCount;
const isWrapping = endFrame < currentFrame;

for (let i = 0; i < frameCount; i++) {
  if (isWrapping) {
    // Paint from currentFrame to end AND 0 to endFrame
    if ((i >= currentFrame && i < frameCount) || (i < endFrame)) {
      activeIndices.push(i);
    }
  } else {
    // Paint from currentFrame to endFrame
    if (i >= currentFrame && i < endFrame) {
      activeIndices.push(i);
    }
  }
}
```

## Success Criteria

✅ Automated tests pass on framer open
✅ Touch logs appear when touching canvas
✅ Paint logs show stamps being added to correct frames
✅ Render logs show stamps being drawn
✅ Visual strokes appear on canvas
✅ Strokes persist across frame changes
✅ Multiple strokes can be drawn
✅ No memory leaks or performance issues

If ALL criteria met → **Framer is working correctly!**
