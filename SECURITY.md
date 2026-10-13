# Security Policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, report it privately: TODO_YOUR_SECURITY_CONTACT_EMAIL (or use GitHub's private
[Security Advisory](../../security/advisories/new) feature once enabled on this repo).

Include: what you found, where (file/endpoint), reproduction steps, and impact. We'll acknowledge
within a reasonable timeframe and credit you in the fix (unless you prefer otherwise).

## Scope

This repository's own code — the mobile app, native modules, and the reference backend source in
`backend/`, `.website_work/`, and `multi/`. The live production service at emojipainter.com runs
its own deployment with its own credentials, separate from what's in this repo; if you find an
issue against the *live site* specifically, report it the same way.

## Known non-issues

- The reference backend's example config (`backend/config/db.php.example`) contains placeholder
  values, not real credentials — this is intentional.
- `src/lib/dailyPaintSecrets.ts` reads its secret from an environment variable that's empty by
  default in this public repo — the upload-auth feature simply won't authenticate until you
  configure your own value. This is intentional, not a bug.

See `AUDIT_REPORTS/` (private application package, not part of this repo) for the security audit
performed before this repository was made public.
