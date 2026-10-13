const mockSentryInit = jest.fn();
jest.mock('@sentry/react-native', () => ({ init: mockSentryInit }));

describe('public-build crash reporting configuration', () => {
  const originalDev = __DEV__;
  const originalDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const originalLite = process.env.EXPO_PUBLIC_LITE_BUILD;

  beforeEach(() => {
    mockSentryInit.mockClear();
    (globalThis as { __DEV__: boolean }).__DEV__ = false;
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.EXPO_PUBLIC_LITE_BUILD;
  });

  afterEach(() => {
    (globalThis as { __DEV__: boolean }).__DEV__ = originalDev;
    if (originalDsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    else process.env.EXPO_PUBLIC_SENTRY_DSN = originalDsn;
    if (originalLite === undefined) delete process.env.EXPO_PUBLIC_LITE_BUILD;
    else process.env.EXPO_PUBLIC_LITE_BUILD = originalLite;
  });

  function initialise(): void {
    jest.isolateModules(() => {
      const { initCrashReporting } = require('../lib/crashReporting');
      initCrashReporting();
    });
  }

  test('does not initialise Sentry in an unconfigured release build', () => {
    initialise();
    expect(mockSentryInit).not.toHaveBeenCalled();
  });

  test('treats a blank DSN as disabled', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = '   ';
    initialise();
    expect(mockSentryInit).not.toHaveBeenCalled();
  });

  test('uses only the configured client DSN with capture protections', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.com/123';
    initialise();
    expect(mockSentryInit).toHaveBeenCalledTimes(1);
    expect(mockSentryInit).toHaveBeenCalledWith({
      dsn: 'https://public@example.com/123',
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      tracesSampleRate: 0.2,
    });
  });

  test('keeps diagnostics disabled in development even with a DSN', () => {
    (globalThis as { __DEV__: boolean }).__DEV__ = true;
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.com/123';
    initialise();
    expect(mockSentryInit).not.toHaveBeenCalled();
  });

  test('keeps diagnostics disabled in Lite even with a DSN', () => {
    process.env.EXPO_PUBLIC_LITE_BUILD = '1';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.com/123';
    initialise();
    expect(mockSentryInit).not.toHaveBeenCalled();
  });
});
