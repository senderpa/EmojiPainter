/**
 * ProxyManager
 *
 * Manages optional low-resolution proxy files for heavy clips.
 * The public build returns the master clip directly because it does not bundle FFmpeg transcoding.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const PROXY_STORAGE_KEY = '@video_editor_proxies';
const PROXY_DIR = `${FileSystem.documentDirectory}video_proxies/`;

export interface ProxyMetadata {
  masterUri: string;
  masterHash: string; // Hash of master file path + size + mtime to detect changes
  proxyUri: string;
  proxySize: number;
  createdAt: number;
  resolution: string; // e.g., "720x720"
}

interface ProxyMap {
  [masterUri: string]: ProxyMetadata;
}

/**
 * Load proxy metadata from storage
 */
async function loadProxyMap(): Promise<ProxyMap> {
  try {
    const data = await AsyncStorage.getItem(PROXY_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('[ProxyManager] Failed to load proxy map:', error);
    return {};
  }
}

/**
 * Save proxy metadata to storage
 */
async function saveProxyMap(map: ProxyMap): Promise<void> {
  try {
    await AsyncStorage.setItem(PROXY_STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    console.error('[ProxyManager] Failed to save proxy map:', error);
  }
}

/**
 * Get proxy URI for a master clip, generating if needed
 */
export async function getProxyUri(
  masterUri: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  // Proxy transcoding is optional in the public build. Return the original clip
  // so video editing remains usable without an extra FFmpeg native package.
  const path = masterUri.startsWith('file://') ? masterUri.slice(7) : masterUri;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) throw new Error(`Master file does not exist: ${masterUri}`);
  onProgress?.(100);
  return masterUri;
}

/**
 * Clear all proxy files and metadata
 */
export async function clearAllProxies(): Promise<void> {
  try {
    // Delete all proxy files
    const dirInfo = await FileSystem.getInfoAsync(PROXY_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(PROXY_DIR, { idempotent: true });
      console.log('[ProxyManager] Deleted proxy directory');
    }

    // Clear metadata
    await AsyncStorage.removeItem(PROXY_STORAGE_KEY);
    console.log('[ProxyManager] Cleared proxy metadata');
  } catch (error) {
    console.error('[ProxyManager] Failed to clear proxies:', error);
  }
}

/**
 * Get total size of all proxy files
 */
export async function getProxyStorageSize(): Promise<number> {
  try {
    const proxyMap = await loadProxyMap();
    return Object.values(proxyMap).reduce((sum, proxy) => sum + proxy.proxySize, 0);
  } catch (error) {
    console.error('[ProxyManager] Failed to get storage size:', error);
    return 0;
  }
}

/**
 * Remove unused proxies (masters that no longer exist)
 */
export async function cleanupUnusedProxies(): Promise<number> {
  try {
    const proxyMap = await loadProxyMap();
    let removedCount = 0;

    for (const [masterUri, metadata] of Object.entries(proxyMap)) {
      const masterPath = masterUri.startsWith('file://') ? masterUri.substring(7) : masterUri;
      const masterInfo = await FileSystem.getInfoAsync(masterPath);

      if (!masterInfo.exists) {
        // Master deleted, remove proxy
        const proxyPath = metadata.proxyUri.startsWith('file://')
          ? metadata.proxyUri.substring(7)
          : metadata.proxyUri;

        await FileSystem.deleteAsync(proxyPath, { idempotent: true });
        delete proxyMap[masterUri];
        removedCount++;
        console.log('[ProxyManager] Removed unused proxy for:', masterUri);
      }
    }

    if (removedCount > 0) {
      await saveProxyMap(proxyMap);
      console.log('[ProxyManager] Cleanup complete, removed', removedCount, 'proxies');
    }

    return removedCount;
  } catch (error) {
    console.error('[ProxyManager] Cleanup failed:', error);
    return 0;
  }
}
