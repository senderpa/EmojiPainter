# Info Panel Feature

> Info sheet — language, settings, challenge info, profile/gallery shortcuts

## Status
⚠️ **STUB** — logic is still in `src/screens/PaintScreen.tsx`. This folder defines the target shape.

## Files
| File | Purpose |
|------|---------|
| `useInfoPanel.ts` | All state + side-effects. Receives inputs, returns typed state+handlers. |
| `InfoPanelOverlay.tsx` | Pure presentational JSX. No side-effects. Props = hook result. |
| `index.ts` | Barrel export |

## Inputs
```
deviceId: string, language: string
```

## Outputs
```
visible, copy, open(), close()
```

## Extraction Steps
1. Read ARCHITECTURE.md §"Extraction Protocol"
2. Find all `// INFO-PANEL` grep markers in PaintScreen.tsx
3. Move state vars → `useInfoPanel.ts`
4. Move JSX block → `InfoPanelOverlay.tsx`
5. In PaintScreen: `const infopanel = useInfoPanel(inputs); return <InfoPanelOverlay {...infopanel} />`
6. Run `npx tsc --noEmit` — fix all type errors
7. Test on device
