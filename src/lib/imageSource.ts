import { Image } from 'react-native';

export const resolvePrefetchableImageUri = (source: number | string | null | undefined): string | null => {
  if (source == null) {
    return null;
  }

  if (typeof source === 'number') {
    // Bundled `require()` assets are already part of the app binary/runtime bundle.
    // Prefetching them through Metro re-hits the asset server and can produce noisy
    // ENOENT lookups for local logo directories, so skip them entirely.
    return null;
  }

  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  return /^(https?:|file:|content:)/i.test(trimmed) ? trimmed : null;
};
