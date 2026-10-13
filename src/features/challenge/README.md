# Challenge Feature

> Daily topics, sprint timer, challenge confirm and completion overlays

## Status
⚠️ **STUB** — logic is still in `src/screens/PaintScreen.tsx`. This folder defines the target shape.

## Files
| File | Purpose |
|------|---------|
| `useChallenge.ts` | All state + side-effects. Receives inputs, returns typed state+handlers. |
| `ChallengeOverlay.tsx` | Pure presentational JSX. No side-effects. Props = hook result. |
| `index.ts` | Barrel export |

## Inputs
```
deviceId: string, strokes: Stroke[]
```

## Outputs
```
activeTopic, sprintActive, complete(), reset()
```

## Extraction Steps
1. Read ARCHITECTURE.md §"Extraction Protocol"
2. Find all `// CHALLENGE` grep markers in PaintScreen.tsx
3. Move state vars → `useChallenge.ts`
4. Move JSX block → `ChallengeOverlay.tsx`
5. In PaintScreen: `const challenge = useChallenge(inputs); return <ChallengeOverlay {...challenge} />`
6. Run `npx tsc --noEmit` — fix all type errors
7. Test on device
