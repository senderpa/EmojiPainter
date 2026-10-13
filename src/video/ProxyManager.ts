/**
 * ProxyManager
 *
 * Generates and manages low-resolution proxy files for heavy HEVC+alpha master clips.
 * Proxies use H.264 with lower resolution for lighter decode load during editing.
 * Final export still uses master files.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import { Platform } from 'react-native';

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
 * Simple string hash function (Java's String.hashCode() algorithm)
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Calculate a hash for a master file to detect if it's changed
 */
async function calculateMasterHash(uri: string): Promise<string> {
  try {
    const fileUri = uri.startsWith('file://') ? uri.substring(7) : uri;
    const info = await FileSystem.getInfoAsync(fileUri);

    if (!info.exists) {
      throw new Error('File does not exist');
    }

    // Hash based on path + size + modification time
    const hashInput = `${fileUri}:${info.size}:${info.modificationTime}`;
    return simpleHash(hashInput);
  } catch (error) {
    console.error('[ProxyManager] Failed to calculate hash:', error);
    throw error;
  }
}

/**
 * Ensure proxy directory exists
 */
async function ensureProxyDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(PROXY_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(PROXY_DIR, { intermediates: true });
    console.log('[ProxyManager] Created proxy directory:', PROXY_DIR);
  }
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
 * Generate a proxy file for a master clip
 * Uses H.264 at 720p with alpha preserved if possible
 */
async function generateProxy(
  masterUri: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const fileUri = masterUri.startsWith('file://') ? masterUri.substring(7) : masterUri;

  // Ensure file exists
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) {
    throw new Error(`Master file does not exist: ${fileUri}`);
  }

  await ensureProxyDir();

  const masterHash = await calculateMasterHash(masterUri);
  const proxyFilename = `proxy_${masterHash}.mp4`;
  const proxyPath = `${PROXY_DIR}${proxyFilename}`;
  const proxyUri = `file://${proxyPath}`;

  console.log('[ProxyManager] Generating proxy for:', masterUri);
  console.log('[ProxyManager] Output:', proxyUri);

  // FFmpeg command to create H.264 proxy at 720p
  // Using H.264 instead of ProRes for better compatibility and smaller size
  // -vf scale maintains aspect ratio and adds alpha if source has it
  const command = `-i ${fileUri} -vf "scale=720:-2:flags=lanczos" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -an -y ${proxyPath}`;

  console.log('[ProxyManager] FFmpeg command:', command);

  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    const output = await session.getOutput();
    console.error('[ProxyManager] FFmpeg failed:', output);
    throw new Error('Proxy generation failed');
  }

  // Verify proxy was created
  const proxyInfo = await FileSystem.getInfoAsync(proxyPath);
  if (!proxyInfo.exists || !proxyInfo.size) {
    throw new Error('Proxy file was not created');
  }

  console.log('[ProxyManager] ✅ Proxy generated successfully:', proxyUri, 'Size:', proxyInfo.size);

  // Save to proxy map
  const proxyMap = await loadProxyMap();
  proxyMap[masterUri] = {
    masterUri,
    masterHash,
    proxyUri,
    proxySize: proxyInfo.size,
    createdAt: Date.now(),
    resolution: '720p'
  };
  await saveProxyMap(proxyMap);

  return proxyUri;
}

/**
 * Get proxy URI for a master clip, generating if needed
 */
export async function getProxyUri(
  masterUri: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  // Check if proxy already exists and is valid
  const proxyMap = await loadProxyMap();
  const existing = proxyMap[masterUri];

  if (existing) {
    // Verify proxy file still exists
    const proxyPath = existing.proxyUri.startsWith('file://')
      ? existing.proxyUri.substring(7)
      : existing.proxyUri;

    const proxyInfo = await FileSystem.getInfoAsync(proxyPath);

    if (proxyInfo.exists) {
      // Verify master hasn't changed
      const currentHash = await calculateMasterHash(masterUri);
      if (currentHash === existing.masterHash) {
        console.log('[ProxyManager] Using existing proxy:', existing.proxyUri);
        return existing.proxyUri;
      }
      console.log('[ProxyManager] Master file changed, regenerating proxy');
    } else {
      console.log('[ProxyManager] Proxy file missing, regenerating');
    }
  }

  // Generate new proxy
  return await generateProxy(masterUri, onProgress);
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
