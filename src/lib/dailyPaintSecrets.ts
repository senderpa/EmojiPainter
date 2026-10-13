// SECURITY NOTE: This secret is used for HMAC-SHA256 token generation on uploads.
// The production value is intentionally NOT included in the public repository —
// it is a real upload-authorization credential for the live backend.
//
// To run your own instance: generate a fresh random value (e.g.
// `openssl rand -hex 32`), set it here (or better, load it from an env var
// at build time), and configure the matching value in your own backend
// (see server-fix/storage.php's DAILY_PAINT_SECRET check).
//
// TODO: Replace with server-issued short-lived tokens fetched at session start
// so no long-lived secret ships in the client bundle at all.
export const DAILY_PAINT_SECRET: string = process.env.EXPO_PUBLIC_DAILY_PAINT_SECRET ?? '';
