# Private Studio Feature

> Passport painting workspace + upload flow + profile sync

## Status
⚠️ **STUB** — logic is still in `src/screens/PaintScreen.tsx`. This folder defines the target shape.

## Files
| File | Purpose |
|------|---------|
| `usePrivateStudio.ts` | All state + side-effects. Receives inputs, returns typed state+handlers. |
| `PrivateStudioOverlay.tsx` | Pure presentational JSX. No side-effects. Props = hook result. |
| `index.ts` | Barrel export |

## Inputs
```
deviceId: string, canvasRef: RefObject, strokes: Stroke[], restoreStrokes: fn, navigation: Navigation
```

## Outputs
```
visible, uploading, open(), close(), upload()
```

## Extraction Steps
1. Read ARCHITECTURE.md §"Extraction Protocol"
2. Find all `// PRIVATE-STUDIO` grep markers in PaintScreen.tsx
3. Move state vars → `usePrivateStudio.ts`
4. Move JSX block → `PrivateStudioOverlay.tsx`
5. In PaintScreen: `const privatestudio = usePrivateStudio(inputs); return <PrivateStudioOverlay {...privatestudio} />`
6. Run `npx tsc --noEmit` — fix all type errors
7. Test on device
