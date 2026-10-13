// Minimal Expo config plugin to make native config deterministic.
const { withInfoPlist, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

const withEmojipaintNativeHardening = (config) => {
  // Inject LSApplicationQueriesSchemes and keep existing usage descriptions.
  config = withInfoPlist(config, (config) => {
    const plist = config.modResults;

    const schemes = new Set(ensureArray(plist.LSApplicationQueriesSchemes));
    schemes.add('emojispray');
    plist.LSApplicationQueriesSchemes = Array.from(schemes);

    // Preserve existing values; only set if missing
    plist.NSPhotoLibraryAddUsageDescription =
      plist.NSPhotoLibraryAddUsageDescription ||
      'Allow Emojipaint Mobile to export finished artwork to your library.';
    plist.NSPhotoLibraryUsageDescription =
      plist.NSPhotoLibraryUsageDescription ||
      'Allow Emojipaint Mobile to import a reference image for tracing.';

    return config;
  });

  // Ensure Podfile contains the local emojispray-bridge and exporter pods.
  config = withDangerousMod(config, ["ios", async (config) => {
    const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
    try {
      let text = fs.readFileSync(podfilePath, 'utf8');
      let changed = false;
      if (!text.includes("pod 'emojispray-bridge'")) {
        // Insert after use_expo_modules! if found, else append near top of target block
        const needle = 'use_expo_modules!';
        if (text.includes(needle)) {
          text = text.replace(needle, `${needle}\n\n  # Ensure local bridge pod stays linked deterministically\n  pod 'emojispray-bridge', :path => '../modules/emojispray-bridge'`);
        } else {
          text = text.replace(
            /target\s+['\"]\w+['\"]\s+do/,
            (m) => `${m}\n  pod 'emojispray-bridge', :path => '../modules/emojispray-bridge'`
          );
        }
        changed = true;
      }
      if (!text.includes("pod 'emojipaint-exporter'")) {
        const needle = 'use_expo_modules!';
        if (text.includes(needle)) {
          text = text.replace(needle, `${needle}\n\n  # Ensure local exporter pod stays linked deterministically\n  pod 'emojipaint-exporter', :path => '../modules/emojipaint-exporter'`);
        } else {
          text = text.replace(
            /target\s+['\"]\w+['\"]\s+do/,
            (m) => `${m}\n  pod 'emojipaint-exporter', :path => '../modules/emojipaint-exporter'`
          );
        }
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(podfilePath, text, 'utf8');
        console.log('[config-plugin] Ensured local pods (bridge/exporter) in Podfile.');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[config-plugin] Could not patch Podfile automatically:', e.message);
    }
    return config;
  }]);

  return config;
};

module.exports = withEmojipaintNativeHardening;
