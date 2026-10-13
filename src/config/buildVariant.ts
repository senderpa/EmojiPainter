// Expo replaces EXPO_PUBLIC_* during bundling. Lite builds also use the resolver
// aliases in metro.config.js to keep full-only modules out of the JS bundle.
// The Xcode Release-Lite bundle phase sets EXPO_PUBLIC_LITE_BUILD=1.
export const IS_LITE_BUILD: boolean = process.env.EXPO_PUBLIC_LITE_BUILD === '1';
export const COIN_PAGE_ENABLED = !IS_LITE_BUILD;
