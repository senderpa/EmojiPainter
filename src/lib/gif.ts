import { NativeModules, Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { featureFlags } from '../config/features';
import { isMetalExportAvailable, exportGifFromFrames } from '../native/exporter';

type GifGeneratorModule = {
  createGIF: (
    imagePaths: string[],
    delays: number[],
    destination: string,
    options: GifGeneratorOptions
  ) => Promise<string>;
};

export type GifQualityPresetId = 'compact' | 'default' | 'max';

export interface GifGeneratorOptions {
  width?: number;
  loopCount?: number;
}

export const GIF_QUALITY_PRESETS: Record<GifQualityPresetId, { label: string; width: number; description: string }> = {
  compact: { label: 'Compact', width: 256, description: '256 px · fast to share' },
  default: { label: 'Standard', width: 512, description: '512 px · balanced detail' },
  max: { label: 'HD', width: 1024, description: '1024 px · maximum clarity' }
};

let cachedModule: GifGeneratorModule | null = null;

const resolveNativeModule = (): GifGeneratorModule | null => {
  if (cachedModule) {
    return cachedModule;
  }

  const candidate = (NativeModules as Record<string, unknown>).GifGenerator;
  if (candidate && typeof (candidate as GifGeneratorModule).createGIF === 'function') {
    cachedModule = candidate as GifGeneratorModule;
    return cachedModule;
  }

  try {
    const module = requireNativeModule<GifGeneratorModule>('GifGenerator');
    if (module && typeof module.createGIF === 'function') {
      cachedModule = module;
      return cachedModule;
    }
  } catch (error) {
    // Silently fall through so we can surface a consistent error later.
  }

  return null;
};

class GifModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GifModuleError';
  }
}

function ensureModule(): GifGeneratorModule {
  const module = resolveNativeModule();
  if (!module || typeof module.createGIF !== 'function') {
    throw new GifModuleError('GifGenerator native module is unavailable.');
  }
  return module;
}

export async function generateGif(
  imagePaths: string[],
  delays: number[],
  destination: string,
  options: GifGeneratorOptions = {}
): Promise<string> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new GifModuleError('GIF export is only available on iOS and Android.');
  }

  // NOTE: Metal-accelerated GIF export not yet implemented in native modules
  // MP4ExporterModule only has exportMP4 method currently
  // For now, use standard GIF export with GifGenerator module
  //
  // TODO: Add exportGIF method to MP4ExporterModule.swift for Metal acceleration

  const module = resolveNativeModule();

  if (!module || typeof module.createGIF !== 'function') {
    throw new GifModuleError(
      'GIF export module not available. Please rebuild the app.'
    );
  }

  const safeOptions: GifGeneratorOptions = {
    width: options.width ?? 512,
    loopCount: options.loopCount ?? 0,
    ...options
  };

  // Sanitize paths (remove file:// prefix if present)
  const sanitizedPaths = imagePaths.map(path =>
    path.startsWith('file://') ? path.substring(7) : path
  );

  return module.createGIF(sanitizedPaths, delays, destination, safeOptions);
}
