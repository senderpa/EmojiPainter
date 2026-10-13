const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.transformer = config.transformer || {};
config.transformer.unstable_allowRequireContext = true;

// Metro includes statically discoverable require() calls even when a build-time
// condition makes them unreachable. Resolve full-build-only screens to a tiny
// inert component in Lite so Coin/AI/face/multiplayer code cannot enter that
// bundle or initialize through an unexpected navigation path.
if (process.env.EXPO_PUBLIC_LITE_BUILD === '1') {
  const liteUnavailableComponent = path.resolve(__dirname, 'src/lite/LiteUnavailableComponent.tsx');
  const fullBuildOnlyModules = new Set([
    './CoinShopOverlay',
    './screens/CoinShopOverlay',
    '../ar/FaceMeshOverlay',
    './multiplayer/MultiPaintScreen',
  ]);

  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (fullBuildOnlyModules.has(moduleName)) {
      return {
        type: 'sourceFile',
        filePath: liteUnavailableComponent,
      };
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

// Ensure .mov files are treated as assets (for tutorial videos)
if (!config.resolver.assetExts.includes('mov')) {
  config.resolver.assetExts.push('mov');
}

if (!config.resolver.assetExts.includes('webm')) {
  config.resolver.assetExts.push('webm');
}

module.exports = config;
