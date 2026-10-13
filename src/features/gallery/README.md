# Gallery Feature

> Gallery overlay — uploaded artworks, mystery guess, passport cards

## Status
⚠️ **STUB** — logic is still in `src/screens/PaintScreen.tsx`. This folder defines the target shape.

## Files
| File | Purpose |
|------|---------|
| `useGallery.ts` | All state + side-effects. Receives inputs, returns typed state+handlers. |
| `GalleryOverlay.tsx` | Pure presentational JSX. No side-effects. Props = hook result. |
| `index.ts` | Barrel export |

## Inputs
```
deviceId: string, coinCount: number, onLeaderboardRefresh: () => void
```

## Outputs
```
visible, entries, open(), close(), refresh()
```

## Extraction Steps
1. Read ARCHITECTURE.md §"Extraction Protocol"
2. Find all `// GALLERY` grep markers in PaintScreen.tsx
3. Move state vars → `useGallery.ts`
4. Move JSX block → `GalleryOverlay.tsx`
5. In PaintScreen: `const gallery = useGallery(inputs); return <GalleryOverlay {...gallery} />`
6. Run `npx tsc --noEmit` — fix all type errors
7. Test on device
