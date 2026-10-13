# Onboarding Feature

> Welcome overlay and first-time experience flow

## Status
⚠️ **STUB** — logic is still in `src/screens/PaintScreen.tsx`. This folder defines the target shape.

## Files
| File | Purpose |
|------|---------|
| `useOnboarding.ts` | All state + side-effects. Receives inputs, returns typed state+handlers. |
| `OnboardingOverlay.tsx` | Pure presentational JSX. No side-effects. Props = hook result. |
| `index.ts` | Barrel export |

## Inputs
```
deviceId: string
```

## Outputs
```
visible, hasInteracted, dismiss()
```

## Extraction Steps
1. Read ARCHITECTURE.md §"Extraction Protocol"
2. Find all `// ONBOARDING` grep markers in PaintScreen.tsx
3. Move state vars → `useOnboarding.ts`
4. Move JSX block → `OnboardingOverlay.tsx`
5. In PaintScreen: `const onboarding = useOnboarding(inputs); return <OnboardingOverlay {...onboarding} />`
6. Run `npx tsc --noEmit` — fix all type errors
7. Test on device
