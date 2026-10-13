const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.transformer = config.transformer || {};
config.transformer.unstable_allowRequireContext = true;

// Metro includes statically discoverable require() calls even when a build-time
// condition makes them unreachable. Resolve full-build-only screens to a tiny
// inert component in Lite so Coin/AI/face/multiplayer code cannot enter that
// bundle or initialize through an unexpected navigation path.
const isLiteBuild = process.env.EXPO_PUBLIC_LITE_BUILD === '1';
const liteUnavailableComponent = path.resolve(__dirname, 'src/lite/LiteUnavailableComponent.tsx');
const fullBuildOnlyModules = new Set([
    './CoinShopOverlay',
    './screens/CoinShopOverlay',
    '../ar/FaceMeshOverlay',
    './multiplayer/MultiPaintScreen',
]);

const sourceOnlyAssetRoot = path.resolve(__dirname, 'assets');
const missingAssetFallbacks = {
  '.png': path.resolve(__dirname, '.github/images/icon.png'),
  '.jpg': path.resolve(__dirname, '.github/images/icon.png'),
  '.jpeg': path.resolve(__dirname, '.github/images/icon.png'),
  '.webp': path.resolve(__dirname, '.github/images/icon.png'),
  '.gif': path.resolve(__dirname, '.github/images/brand-animation.gif'),
  '.mp4': path.resolve(__dirname, '.github/media-fallback/placeholder.mp4'),
  '.mov': path.resolve(__dirname, '.github/media-fallback/placeholder.mp4'),
  '.webm': path.resolve(__dirname, '.github/media-fallback/placeholder.mp4'),
  '.wav': path.resolve(__dirname, '.github/media-fallback/silence.wav'),
  '.mp3': path.resolve(__dirname, '.github/media-fallback/silence.wav'),
  '.m4a': path.resolve(__dirname, '.github/media-fallback/silence.wav'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (isLiteBuild && fullBuildOnlyModules.has(moduleName)) {
    return {
      type: 'sourceFile',
      filePath: liteUnavailableComponent,
    };
  }

  const requestedPath = path.isAbsolute(moduleName)
    ? moduleName
    : path.resolve(path.dirname(context.originModulePath), moduleName);
  const extension = path.extname(requestedPath).toLowerCase();
  const fallbackPath = missingAssetFallbacks[extension];
  const isExcludedAsset = requestedPath.startsWith(`${sourceOnlyAssetRoot}${path.sep}`);

  // The full production art/media library is excluded from this source export because some
  // artwork and fonts have separate rights. Use project-owned previews and silent audio only for
  // absent files; a locally supplied asset with the original path always takes precedence.
  if (isExcludedAsset && !fs.existsSync(requestedPath) && fallbackPath) {
    return context.resolveRequest(context, fallbackPath, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

// Ensure .mov files are treated as assets (for tutorial videos)
if (!config.resolver.assetExts.includes('mov')) {
  config.resolver.assetExts.push('mov');
}

if (!config.resolver.assetExts.includes('webm')) {
  config.resolver.assetExts.push('webm');
}

module.exports = config;
