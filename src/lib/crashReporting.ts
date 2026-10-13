/**
 * Crash reporting module — wraps @sentry/react-native with a graceful fallback.
 *
 * If @sentry/react-native is not yet installed every exported function becomes a
 * safe no-op (console.error in __DEV__ only). Once the DSN is configured and the
 * package is installed, full crash reporting is active automatically in production
 * builds.
 *
 * OPTIONAL SETUP: set EXPO_PUBLIC_SENTRY_DSN to your own Sentry project's client DSN.
 * Public source builds leave diagnostics disabled unless explicitly configured.
 */

import { IS_LITE_BUILD } from '../config/buildVariant';

// ---------------------------------------------------------------------------
// Lazy-load Sentry so a missing package never crashes the app
// ---------------------------------------------------------------------------
type SentryModule = typeof import('@sentry/react-native');

let _sentry: SentryModule | null = null;
if (!IS_LITE_BUILD) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _sentry = require('@sentry/react-native') as SentryModule;
  } catch {
    // @sentry/react-native is not installed — all functions will be safe no-ops
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
const DEV_LOG_PREFIX = '[CrashReporting]';

const devWarn = (msg: string): void => {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`${DEV_LOG_PREFIX} Sentry not installed — ${msg}`);
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise Sentry once at app start (call before any hook or render).
 * In debug / __DEV__ builds Sentry is intentionally disabled to keep the
 * Metro console clean. It is only active in production (Release) builds.
 */
export function initCrashReporting(): void {
  // The App Store/Lite build intentionally transmits no diagnostics. In
  // particular, a camera/AR screen can never become a replay or attachment.
  if (IS_LITE_BUILD) return;
  if (!_sentry) {
    devWarn('initCrashReporting() is a no-op — package not installed.');
    return;
  }

  // Only send events from production builds
  if (__DEV__) {
    return;
  }

  const DSN: string = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() ?? '';
  if (!DSN || DSN.startsWith('YOUR_SENTRY')) {
    return;
  }

  _sentry.init({
    dsn: DSN,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0.2,
    // Do not set either replay sample-rate option. Sentry installs its screen
    // recorder whenever those keys are present, even when their value is 0.
  });
}

/**
 * Report a JavaScript error to Sentry (or console.error in dev when Sentry
 * is unavailable).
 *
 * @param error   - The error object to report
 * @param context - Optional key/value metadata attached to the event
 */
export function logError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  if (IS_LITE_BUILD) return;
  if (!_sentry) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error(`${DEV_LOG_PREFIX} logError (no-op):`, error, context);
    }
    return;
  }

  _sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context as Record<string, unknown>);
    }
    _sentry!.captureException(error);
  });
}

/**
 * Log a plain message to Sentry at the given severity level.
 *
 * @param msg   - Human-readable message
 * @param level - Severity level (defaults to 'info')
 */
export function logMessage(
  msg: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (IS_LITE_BUILD) return;
  if (!_sentry) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error(`${DEV_LOG_PREFIX} logMessage (no-op) [${level}]:`, msg);
    }
    return;
  }

  _sentry.captureMessage(msg, level);
}

/**
 * Associate the Sentry session with this device's stable ID so every crash
 * report can be traced back to a specific device.
 *
 * @param deviceId - The EmojiPaint device ID (from getOrCreateDailyDeviceId)
 */
export function setUserContext(deviceId: string): void {
  if (IS_LITE_BUILD) return;
  if (!_sentry) {
    devWarn(`setUserContext('${deviceId}') is a no-op — package not installed.`);
    return;
  }

  _sentry.setUser({ id: deviceId });
}
