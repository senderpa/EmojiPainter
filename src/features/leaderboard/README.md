# Leaderboard Feature

> Leaderboard overlay — scores, rankings, seasonal data, preview cards

## Status
⚠️ **STUB** — logic is still in `src/screens/PaintScreen.tsx`. This folder defines the target shape.

## Files
| File | Purpose |
|------|---------|
| `useLeaderboard.ts` | All state + side-effects. Receives inputs, returns typed state+handlers. |
| `LeaderboardOverlay.tsx` | Pure presentational JSX. No side-effects. Props = hook result. |
| `index.ts` | Barrel export |

## Inputs
```
deviceId: string, coinCount: number
```

## Outputs
```
visible, entries, open(), close(), refresh()
```

## Extraction Steps
1. Read ARCHITECTURE.md §"Extraction Protocol"
2. Find all `// LEADERBOARD` grep markers in PaintScreen.tsx
3. Move state vars → `useLeaderboard.ts`
4. Move JSX block → `LeaderboardOverlay.tsx`
5. In PaintScreen: `const leaderboard = useLeaderboard(inputs); return <LeaderboardOverlay {...leaderboard} />`
6. Run `npx tsc --noEmit` — fix all type errors
7. Test on device
