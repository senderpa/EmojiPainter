// Legacy shared value for HMAC-SHA256 upload/vote signatures. EXPO_PUBLIC_* values
// are bundled into the app and can be extracted; this is not a confidential
// server credential and cannot establish a trusted caller on its own.
// Use your own value only with your own backend, never a production server secret.
// Public deployments need server-side authorization, validation, and abuse controls.
// TODO: Replace shared client signing with server-issued, scoped authorization.
export const DAILY_PAINT_SECRET: string = process.env.EXPO_PUBLIC_DAILY_PAINT_SECRET ?? '';
