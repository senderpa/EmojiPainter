# Contributing to EmojiPainter

Thanks for considering it — this project has been built solo for ~1.5 years and genuinely
benefits from outside eyes.

## Before you start

- For anything non-trivial, open an issue first to discuss the approach — saves you rework.
- Check `ROADMAP.md` and open issues so you're not duplicating in-progress work.
- Security issues: see `SECURITY.md` instead of a public issue.

## Development setup

See `docs/BUILDING.md`.

## Releases

Source release tags use semantic versioning. See [`docs/RELEASING.md`](docs/RELEASING.md) for the
release checklist and how source releases relate to the separately distributed App Store apps.

## Making a change

1. Fork + branch from `main`.
2. Keep changes focused — one logical change per PR.
3. Match the existing code style in the file/module you're touching (this codebase intentionally
   keeps some large, monolithic files — see `ARCHITECTURE.md` — don't split them apart in an
   unrelated PR).
4. Run before opening a PR:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   ```
5. For iOS native changes, actually build and run on a device where practical (simulator can't
   test AR/RoomPlan/camera features) and describe what you tested in the PR.

## Pull requests

- Describe *why*, not just *what* — the reasoning matters more than the diff for review.
- Small, reviewable PRs get merged faster than large ones.
- Native (Swift/Kotlin) changes affecting AR, RoomPlan, or the painting engines get extra scrutiny
  since they're hard to unit-test — screenshots/screen recordings help a lot.

## Code of Conduct

This project follows `CODE_OF_CONDUCT.md`.
