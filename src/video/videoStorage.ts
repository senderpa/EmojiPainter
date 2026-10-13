/**
 * Video Storage System
 *
 * Manages transparent MOV files (HEVC with alpha channel)
 * Stores metadata in AsyncStorage, actual files in device storage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { probeVideoMetadata, transcodePreviewVideo } from './videoProcessing';

const STORAGE_KEY = '@video_library';
const VIDEO_DIR = `${FileSystem.documentDirectory}videos/`;
const VIDEO_EXPORTS_DIR = `${VIDEO_DIR}exports/`;
const VIDEO_EDITOR_DIR = `${VIDEO_DIR}editor/`;
const VIDEO_PREVIEW_DIR = `${VIDEO_DIR}previews/`;
const IMAGE_STORAGE_DIR = `${VIDEO_DIR}images/`;
const WORDING_DIR = `${FileSystem.cacheDirectory}wording/`;
const PREVIEW_SIZE = 128;

export interface VideoMetadata {
  id: string;
  filename: string;
  uri: string;
  width: number;
  height: number;
  duration: number; // milliseconds
  createdAt: number;
  thumbnail?: string; // base64 thumbnail
  previewUri?: string;
  previewWidth?: number;
  previewHeight?: number;
  isExport?: boolean; // true if exported from editor, false/undefined if imported
  mediaType?: 'video' | 'image'; // defaults to 'video' for backwards compat
  isFolder?: boolean; // true if this is a wording folder
  folderPath?: string; // path to folder if isFolder is true
  folderName?: string; // display name of folder (e.g., "HELLO_1234567890")
  wordTitle?: string; // extracted word from folder name (e.g., "HELLO")
  videoCount?: number; // number of videos in folder
  linkedProjectName?: string; // optional: project this video is linked to as preview
}

export type VideoPreviewBuilder = (destUri: string) => Promise<{ uri: string; width: number; height: number }>;

export type AddVideoOptions = {
  previewBuilder?: VideoPreviewBuilder;
  isExport?: boolean; // true for timelapse/editor exports, false/undefined for imports
  isEditorExport?: boolean; // true for video editor exports specifically
};

const readStoredVideos = async (): Promise<VideoMetadata[]> => {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (!json) return [];

    const videos = JSON.parse(json) as VideoMetadata[];

    // Migrate old format where preview was an object {uri, width, height}
    // to new format with separate previewUri, previewWidth, previewHeight
    let needsMigration = false;
    const migratedVideos = videos.map(video => {
      const anyVideo = video as any;
      if (anyVideo.preview && typeof anyVideo.preview === 'object') {
        console.log('[VideoStorage] Migrating old preview format for:', video.filename);
        needsMigration = true;
        return {
          ...video,
          previewUri: anyVideo.preview.uri,
          previewWidth: anyVideo.preview.width,
          previewHeight: anyVideo.preview.height,
          preview: undefined // Remove old property
        };
      }
      return video;
    });

    // Save migrated data back to storage
    if (needsMigration) {
      console.log('[VideoStorage] Saving migrated metadata');
      await saveVideoMetadata(migratedVideos);
    }

    return migratedVideos;
  } catch (error) {
    console.error('[VideoStorage] Failed to read metadata:', error);
    return [];
  }
};

const getPreviewPath = (videoId: string): string => `${VIDEO_PREVIEW_DIR}${videoId}_preview.mp4`;

const ensurePreviewForVideo = async (video: VideoMetadata): Promise<boolean> => {
  // For exports (4K videos), maintain aspect ratio with max dimension 256
  // For imports, use 128x128 square
  const isExport = video.isExport ?? false;
  const maxDimension = isExport ? 256 : PREVIEW_SIZE;

  // Calculate expected preview dimensions
  let expectedWidth: number;
  let expectedHeight: number;

  if (isExport) {
    // Maintain aspect ratio for exports
    const aspectRatio = video.width / video.height;
    if (video.width > video.height) {
      expectedWidth = maxDimension;
      expectedHeight = Math.round(maxDimension / aspectRatio);
    } else {
      expectedHeight = maxDimension;
      expectedWidth = Math.round(maxDimension * aspectRatio);
    }
  } else {
    // Square for imports
    expectedWidth = PREVIEW_SIZE;
    expectedHeight = PREVIEW_SIZE;
  }

  let needsPreview =
    !video.previewUri ||
    video.previewWidth !== expectedWidth ||
    video.previewHeight !== expectedHeight;

  if (!needsPreview && video.previewUri) {
    try {
      const info = await FileSystem.getInfoAsync(video.previewUri);
      needsPreview = !info.exists;
    } catch (error) {
      console.warn('[VideoStorage] Failed to inspect preview file:', error);
      needsPreview = true;
    }
  }

  if (!needsPreview) {
    return false;
  }

  try {
    await initializeVideoStorage();

    const previewOptions = isExport
      ? {
          // Exports: maintain aspect ratio
          sourceUri: video.uri,
          destUri: getPreviewPath(video.id),
          maxDimension,
          dimensionsHint: { width: video.width, height: video.height }
        }
      : {
          // Imports: force square
          sourceUri: video.uri,
          destUri: getPreviewPath(video.id),
          targetWidth: PREVIEW_SIZE,
          targetHeight: PREVIEW_SIZE,
          dimensionsHint: { width: video.width, height: video.height },
          fillColor: 'black'
        };

    const previewData = await transcodePreviewVideo(previewOptions);
    video.previewUri = previewData.previewUri;
    video.previewWidth = previewData.width;
    video.previewHeight = previewData.height;
    return true;
  } catch (error) {
    console.warn('[VideoStorage] Failed to generate preview for', video.filename, error);
    return false;
  }
};

const hydrateVideosWithPreviews = async (videos: VideoMetadata[]): Promise<VideoMetadata[]> => {
  let updated = false;
  const validVideos: VideoMetadata[] = [];

  for (const video of videos) {
    // Skip folders - they don't need previews
    if (video.isFolder) {
      validVideos.push(video);
      continue;
    }

    // Check if source video file exists
    try {
      const cleanUri = video.uri.replace(/^file:\/\//, '');
      const fileInfo = await FileSystem.getInfoAsync(cleanUri);

      if (!fileInfo.exists) {
        console.log('[VideoStorage] Skipping missing video:', video.filename);
        updated = true; // Mark as updated to save cleaned metadata
        continue; // Skip this video
      }
    } catch (error) {
      console.warn('[VideoStorage] Failed to check video existence:', video.filename, error);
      continue; // Skip on error
    }

    // Video exists, ensure it has a preview
    const changed = await ensurePreviewForVideo(video);
    if (changed) {
      updated = true;
    }
    validVideos.push(video);
  }

  if (updated) {
    await saveVideoMetadata(validVideos.filter(v => !v.isFolder));
  }
  return validVideos;
};

/**
 * Initialize video storage directory
 */
export async function initializeVideoStorage(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(VIDEO_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(VIDEO_DIR, { intermediates: true });
      console.log('[VideoStorage] Created video directory:', VIDEO_DIR);
    }

    const exportsInfo = await FileSystem.getInfoAsync(VIDEO_EXPORTS_DIR);
    if (!exportsInfo.exists) {
      await FileSystem.makeDirectoryAsync(VIDEO_EXPORTS_DIR, { intermediates: true });
      console.log('[VideoStorage] Created video exports directory:', VIDEO_EXPORTS_DIR);
    }

    const editorInfo = await FileSystem.getInfoAsync(VIDEO_EDITOR_DIR);
    if (!editorInfo.exists) {
      await FileSystem.makeDirectoryAsync(VIDEO_EDITOR_DIR, { intermediates: true });
      console.log('[VideoStorage] Created video editor directory:', VIDEO_EDITOR_DIR);
    }

    const previewInfo = await FileSystem.getInfoAsync(VIDEO_PREVIEW_DIR);
    if (!previewInfo.exists) {
      await FileSystem.makeDirectoryAsync(VIDEO_PREVIEW_DIR, { intermediates: true });
    }

    const imageInfo = await FileSystem.getInfoAsync(IMAGE_STORAGE_DIR);
    if (!imageInfo.exists) {
      await FileSystem.makeDirectoryAsync(IMAGE_STORAGE_DIR, { intermediates: true });
    }
  } catch (error) {
    console.error('[VideoStorage] Failed to initialize:', error);
  }
}

/**
 * Add an image (PNG/JPG) to storage — creates a permanent copy and adds metadata entry.
 * Used for automatic artwork backups when the share panel opens.
 */
export async function addImageToStorage(
  sourceUri: string,
  width: number,
  height: number,
): Promise<VideoMetadata | null> {
  try {
    await initializeVideoStorage();
    const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const ext = sourceUri.toLowerCase().includes('.jpg') ? 'jpg' : 'png';
    const filename = `${id}.${ext}`;
    const destUri = `${IMAGE_STORAGE_DIR}${filename}`;

    const sourceInfo = await FileSystem.getInfoAsync(sourceUri);
    if (!sourceInfo.exists) return null;

    await FileSystem.copyAsync({ from: sourceUri, to: destUri });

    const meta: VideoMetadata = {
      id,
      filename,
      uri: destUri,
      width,
      height,
      duration: 0,
      createdAt: Date.now(),
      isExport: true,
      mediaType: 'image',
      previewUri: destUri,
      previewWidth: width,
      previewHeight: height,
    };

    const existing = await readStoredVideos();
    await saveVideoMetadata([meta, ...existing]);
    return meta;
  } catch (error) {
    console.error('[VideoStorage] Failed to add image:', error);
    return null;
  }
}

/**
 * Scan wording directory for folder sessions
 */
async function getWordingFolders(): Promise<VideoMetadata[]> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(WORDING_DIR);
    if (!dirInfo.exists || !dirInfo.isDirectory) {
      return [];
    }

    const contents = await FileSystem.readDirectoryAsync(WORDING_DIR);
    const folders: VideoMetadata[] = [];

    for (const item of contents) {
      const itemPath = `${WORDING_DIR}${item}`;
      const itemInfo = await FileSystem.getInfoAsync(itemPath);

      if (itemInfo.isDirectory) {
        // Parse folder name format: WORD_timestamp
        const parts = item.split('_');
        if (parts.length >= 2) {
          const wordTitle = parts.slice(0, -1).join('_'); // Everything except last part
          const timestamp = parseInt(parts[parts.length - 1], 10);

          // Count videos in folder
          const folderContents = await FileSystem.readDirectoryAsync(itemPath);
          const videoFiles = folderContents.filter(file => file.endsWith('.mov') || file.endsWith('.MOV'));

          // Use first video for preview
          const firstVideo = videoFiles.find(f => f.includes('final')) || videoFiles[0];
          const firstVideoPath = firstVideo ? `${itemPath}/${firstVideo}` : '';

          // FIXED: Use folder name as consistent ID to prevent duplicates
          // The folder name itself (WORD_timestamp) is already unique
          const folderId = `folder_${item}`;

          folders.push({
            id: folderId,
            filename: item,
            uri: firstVideoPath, // For preview purposes
            width: 0, // Not applicable for folders
            height: 0,
            duration: 0,
            createdAt: timestamp || itemInfo.modificationTime || Date.now(),
            isFolder: true,
            folderPath: itemPath,
            folderName: item,
            wordTitle,
            videoCount: videoFiles.length
          });
        }
      }
    }

    // Deduplicate folders by ID (in case same folder scanned multiple times)
    const uniqueFolders = Array.from(
      new Map(folders.map(folder => [folder.id, folder])).values()
    );

    console.log(`[VideoStorage] Found ${folders.length} folders, ${uniqueFolders.length} unique`);
    return uniqueFolders;
  } catch (error) {
    console.error('[VideoStorage] Failed to scan wording folders:', error);
    return [];
  }
}

/**
 * Get all saved videos (including folders)
 */
export async function getAllVideos(): Promise<VideoMetadata[]> {
  try {
    console.log('[VideoStorage] Loading videos from AsyncStorage...');
    const storedVideos = await readStoredVideos();

    console.log('[VideoStorage] Scanning for wording folders...');
    const wordingFolders = await getWordingFolders();

    // Combine arrays
    const allItems = [...storedVideos, ...wordingFolders];

    if (allItems.length === 0) {
      console.log('[VideoStorage] No videos or folders found');
      return [];
    }

    // CRITICAL FIX: Deduplicate by ID to prevent duplicate keys in React
    // This handles cases where folders might have been saved to AsyncStorage
    const deduplicatedItems = Array.from(
      new Map(allItems.map(item => [item.id, item])).values()
    );

    console.log(`[VideoStorage] Combined ${allItems.length} items, deduplicated to ${deduplicatedItems.length}`);

    const hydrated = await hydrateVideosWithPreviews(deduplicatedItems);
    console.log('[VideoStorage] Found', storedVideos.length, 'videos and', wordingFolders.length, 'folders');
    return hydrated.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error('[VideoStorage] Failed to load videos:', error);
    return [];
  }
}

/**
 * Get videos from a specific wording folder
 */
export async function getVideosInFolder(folderPath: string): Promise<VideoMetadata[]> {
  try {
    const folderInfo = await FileSystem.getInfoAsync(folderPath);
    if (!folderInfo.exists || !folderInfo.isDirectory) {
      console.error('[VideoStorage] Folder does not exist:', folderPath);
      return [];
    }

    const contents = await FileSystem.readDirectoryAsync(folderPath);
    const videoFiles = contents.filter(file => file.endsWith('.mov') || file.endsWith('.MOV'));

    const videos: VideoMetadata[] = [];

    for (const file of videoFiles) {
      const filePath = `${folderPath}/${file}`;
      const fileInfo = await FileSystem.getInfoAsync(filePath);

      // Try to get video metadata
      let width = 512;
      let height = 512;
      let duration = 0;

      try {
        const metadata = await probeVideoMetadata(filePath);
        if (metadata) {
          width = metadata.width;
          height = metadata.height;
          duration = metadata.duration;
        }
      } catch (error) {
        console.warn('[VideoStorage] Failed to probe video metadata for', file, error);
      }

      // Check if preview video exists
      let previewUri: string | undefined;
      let previewWidth: number | undefined;
      let previewHeight: number | undefined;

      const baseFilename = file.replace(/\.(mov|MOV)$/, '');
      const previewPath = `${folderPath}/${baseFilename}_preview.mp4`;

      try {
        const previewInfo = await FileSystem.getInfoAsync(previewPath);
        if (previewInfo.exists) {
          previewUri = previewPath;
          previewWidth = 128;
          previewHeight = 128;
          console.log(`[VideoStorage] Found preview for ${file}`);
        }
      } catch (error) {
        // Preview doesn't exist, that's okay
      }

      const modTime = fileInfo.exists ? fileInfo.modificationTime : Date.now();
      videos.push({
        id: `folderitem_${file}_${modTime}`,
        filename: file,
        uri: filePath,
        width,
        height,
        duration,
        createdAt: modTime,
        isExport: false,
        previewUri,
        previewWidth,
        previewHeight
      });
    }

    // Sort by filename to maintain order (letter_0, letter_1, ..., final)
    return videos.sort((a, b) => {
      // Final video should be last
      if (a.filename.includes('final')) return 1;
      if (b.filename.includes('final')) return -1;
      return a.filename.localeCompare(b.filename);
    });
  } catch (error) {
    console.error('[VideoStorage] Failed to get videos in folder:', error);
    return [];
  }
}

/**
 * Save video metadata
 */
async function saveVideoMetadata(videos: VideoMetadata[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
  } catch (error) {
    console.error('[VideoStorage] Failed to save metadata:', error);
  }
}

/**
 * Generate thumbnail from video
 */
async function generateThumbnail(videoUri: string): Promise<string | undefined> {
  try {
    console.log('[VideoStorage] Generating thumbnail for:', videoUri);
    const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: 0, // Get frame at beginning
      quality: 0.7
    });
    console.log('[VideoStorage] Thumbnail generated:', uri);
    return uri;
  } catch (error) {
    console.warn('[VideoStorage] Failed to generate thumbnail:', error);
    return undefined;
  }
}

/**
 * Add a new video to storage
 */
export async function addVideo(
  sourceUri: string,
  width: number,
  height: number,
  duration: number,
  thumbnail?: string,
  options?: AddVideoOptions
): Promise<VideoMetadata | null> {
  try {
    const isExport = options?.isExport ?? false;
    const isEditorExport = options?.isEditorExport ?? false;
    console.log('[VideoStorage] Adding video from:', sourceUri);
    console.log('[VideoStorage] Type:', isEditorExport ? 'EDITOR_EXPORT' : isExport ? 'TIMELAPSE_EXPORT' : 'IMPORT');
    console.log('[VideoStorage] Dimensions:', width, 'x', height);
    console.log('[VideoStorage] Duration:', duration, 'ms');

    await initializeVideoStorage();

    const id = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filename = `${id}.mov`;
    // Determine target directory based on export type
    const targetDir = isEditorExport ? VIDEO_EDITOR_DIR : isExport ? VIDEO_EXPORTS_DIR : VIDEO_DIR;
    const destUri = `${targetDir}${filename}`;

    console.log('[VideoStorage] Copying to:', destUri);

    // Check if source file exists
    const sourceInfo = await FileSystem.getInfoAsync(sourceUri);
    if (!sourceInfo.exists) {
      console.error('[VideoStorage] Source file does not exist:', sourceUri);
      return null;
    }
    console.log('[VideoStorage] Source file exists, size:', 'size' in sourceInfo ? sourceInfo.size : 'unknown');

    // Copy file to app directory
    await FileSystem.copyAsync({
      from: sourceUri,
      to: destUri
    });

    console.log('[VideoStorage] File copied successfully');

    // Verify copy
    const destInfo = await FileSystem.getInfoAsync(destUri);
    if (!destInfo.exists) {
      console.error('[VideoStorage] Copy failed - destination file does not exist');
      return null;
    }
    console.log('[VideoStorage] Copy verified, size:', 'size' in destInfo ? destInfo.size : 'unknown');

    // Generate thumbnail if not provided
    let thumbnailUri = thumbnail;
    if (!thumbnailUri) {
      thumbnailUri = await generateThumbnail(destUri);
    }

    // Generate preview clip for low-resolution playback
    let previewUri: string | undefined;
    let previewWidth: number | undefined;
    let previewHeight: number | undefined;
    const previewDest = getPreviewPath(id);

    if (options?.previewBuilder) {
      try {
        const preview = await options.previewBuilder(previewDest);
        previewUri = preview.uri;
        previewWidth = preview.width;
        previewHeight = preview.height;
        console.log('[VideoStorage] Using custom preview builder for video:', id);
      } catch (error) {
        console.warn('[VideoStorage] Custom preview builder failed, falling back to FFmpeg preview:', error);
      }
    }

    if (!previewUri) {
      try {
        const maxDimension = isExport ? 256 : PREVIEW_SIZE;
        const previewOptions = isExport
          ? {
              // Exports: maintain aspect ratio
              sourceUri: destUri,
              destUri: previewDest,
              maxDimension,
              dimensionsHint: { width, height }
            }
          : {
              // Imports: force square
              sourceUri: destUri,
              destUri: previewDest,
              targetWidth: PREVIEW_SIZE,
              targetHeight: PREVIEW_SIZE,
              dimensionsHint: { width, height },
              fillColor: 'black'
            };

        const preview = await transcodePreviewVideo(previewOptions);
        previewUri = preview.previewUri;
        previewWidth = preview.width;
        previewHeight = preview.height;
      } catch (error) {
        console.warn('[VideoStorage] Failed to generate preview clip:', error);
      }
    }

    const metadata: VideoMetadata = {
      id,
      filename,
      uri: destUri,
      width,
      height,
      duration,
      createdAt: Date.now(),
      thumbnail: thumbnailUri,
      previewUri,
      previewWidth,
      previewHeight,
      isExport
    };

    // Add to metadata
    const videos = await getAllVideos();
    console.log('[VideoStorage] Current video count:', videos.length);
    videos.unshift(metadata);
    await saveVideoMetadata(videos);

    console.log('[VideoStorage] ✅ Successfully added video:', filename);
    console.log('[VideoStorage] New video count:', videos.length);
    return metadata;
  } catch (error) {
    console.error('[VideoStorage] ❌ Failed to add video:', error);
    if (error instanceof Error) {
      console.error('[VideoStorage] Error message:', error.message);
      console.error('[VideoStorage] Error stack:', error.stack);
    }
    return null;
  }
}

/**
 * Add video to storage and automatically link it to a project
 * Convenience function that combines addVideo + linkVideoToProject
 * Used by Framer and Timelapse exports to save videos with project association
 */
export async function addVideoToStorage(
  sourceUri: string,
  width: number,
  height: number,
  duration: number,
  projectName: string,
  options?: AddVideoOptions
): Promise<VideoMetadata | null> {
  try {
    console.log('[VideoStorage] Adding video to storage with project link:', projectName);

    // Add the video
    const metadata = await addVideo(sourceUri, width, height, duration, undefined, {
      ...options,
      isExport: true // Always mark as export
    });

    if (!metadata) {
      console.error('[VideoStorage] Failed to add video');
      return null;
    }

    // Link it to the project
    await linkVideoToProject(projectName, metadata.id);

    console.log('[VideoStorage] ✅ Video added and linked to project:', projectName);
    return metadata;
  } catch (error) {
    console.error('[VideoStorage] Failed to add video to storage:', error);
    return null;
  }
}

/**
 * Import video from device (with validation)
 */
export async function importVideo(uri: string): Promise<VideoMetadata | null> {
  try {
    // Check file info
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists) {
      throw new Error('File does not exist');
    }

    // Check file extension
    if (!uri.toLowerCase().endsWith('.mov')) {
      throw new Error('Only MOV files are supported');
    }

    // Extract actual video metadata for accurate placement/export
    const { width, height, durationMs } = await probeVideoMetadata(uri);

    return await addVideo(uri, width, height, durationMs);
  } catch (error) {
    console.error('[VideoStorage] Failed to import video:', error);
    throw error;
  }
}

/**
 * Delete a video or folder
 */
export async function deleteVideo(id: string): Promise<void> {
  try {
    const videos = await getAllVideos();
    const item = videos.find(v => v.id === id);

    if (item) {
      if (item.isFolder && item.folderPath) {
        // Delete entire folder
        console.log('[VideoStorage] Deleting folder:', item.folderPath);
        const cleanPath = item.folderPath.replace(/^file:\/\//, '');

        // Verify folder exists before attempting deletion
        const folderInfo = await FileSystem.getInfoAsync(cleanPath);
        if (folderInfo.exists) {
          await FileSystem.deleteAsync(cleanPath, { idempotent: true });
          console.log('[VideoStorage] ✅ Deleted folder:', item.folderName);

          // Verify deletion was successful
          const verifyInfo = await FileSystem.getInfoAsync(cleanPath);
          if (verifyInfo.exists) {
            console.error('[VideoStorage] ⚠️ Folder still exists after deletion!');
          } else {
            console.log('[VideoStorage] ✅ Verified folder deletion successful');
          }
        } else {
          console.log('[VideoStorage] Folder already deleted:', item.folderName);
        }
        // Folders are not stored in metadata, so no need to update
      } else {
        // Delete single video file
        const cleanUri = item.uri.replace(/^file:\/\//, '');
        console.log('[VideoStorage] Deleting video file:', cleanUri);

        // Check if file exists first
        const fileInfo = await FileSystem.getInfoAsync(cleanUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(cleanUri, { idempotent: true });
          console.log('[VideoStorage] Deleted video:', item.filename);
        } else {
          console.log('[VideoStorage] Video file does not exist, skipping:', item.filename);
        }

        // Remove from metadata regardless
        const updated = videos.filter(v => v.id !== id && !v.isFolder);
        await saveVideoMetadata(updated);
      }
    } else {
      console.log('[VideoStorage] Video not found with id:', id);
    }
  } catch (error) {
    console.error('[VideoStorage] Failed to delete:', error);
  }
}

/**
 * Request media library permissions
 */
export async function requestMediaPermissions(): Promise<boolean> {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('[VideoStorage] Failed to request permissions:', error);
    return false;
  }
}

/**
 * Validate and cleanup stale AsyncStorage data
 * Removes videos that no longer exist on disk
 */
export async function validateAndCleanStorage(): Promise<{
  cleaned: boolean;
  removedCount: number;
}> {
  try {
    console.log('[VideoStorage] Starting storage validation and cleanup...');
    const storedVideos = await readStoredVideos();

    if (storedVideos.length === 0) {
      console.log('[VideoStorage] No videos in storage, nothing to clean');
      return { cleaned: false, removedCount: 0 };
    }

    const validVideos: VideoMetadata[] = [];
    let removedCount = 0;

    for (const video of storedVideos) {
      // Skip folders - they don't need file validation
      if (video.isFolder) {
        validVideos.push(video);
        continue;
      }

      // Check if video file exists
      try {
        const cleanUri = video.uri.replace(/^file:\/\//, '');
        const fileInfo = await FileSystem.getInfoAsync(cleanUri);

        if (fileInfo.exists) {
          validVideos.push(video);
        } else {
          console.log('[VideoStorage] ❌ Removing stale video entry:', video.filename, 'URI:', video.uri);
          removedCount++;
        }
      } catch (error) {
        console.warn('[VideoStorage] ❌ Error checking video:', video.filename, error);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      await saveVideoMetadata(validVideos);
      console.log(`[VideoStorage] ✅ Cleaned ${removedCount} stale video entries`);
      return { cleaned: true, removedCount };
    }

    console.log('[VideoStorage] ✅ No stale entries found');
    return { cleaned: false, removedCount: 0 };
  } catch (error) {
    console.error('[VideoStorage] ❌ Failed to validate and clean storage:', error);
    return { cleaned: false, removedCount: 0 };
  }
}

/**
 * Validate MOV file format (checks if it's HEVC with alpha)
 */
export async function validateMOVFormat(uri: string): Promise<{
  valid: boolean;
  error?: string;
}> {
  try {
    // Check extension - must be .mov or .MOV
    const lowerUri = uri.toLowerCase();
    if (!lowerUri.endsWith('.mov')) {
      return { valid: false, error: 'File must be .mov format (HEVC with alpha channel)' };
    }

    // Check file exists
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return { valid: false, error: 'File does not exist' };
    }

    // Check file size (must be > 0 and reasonable)
    if ('size' in info) {
      if (info.size === 0) {
        return { valid: false, error: 'File is empty' };
      }
      // Check minimum size (MOV header is ~1KB)
      if (info.size < 1000) {
        return { valid: false, error: 'File is too small to be a valid MOV' };
      }
      // Warn if file is very large (>500MB)
      if (info.size > 500 * 1024 * 1024) {
        console.warn('[VideoStorage] Large file detected:', (info.size / (1024 * 1024)).toFixed(1), 'MB');
      }
    }

    // Read first bytes to check MOV signature
    try {
      const base64Header = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        length: 12 // Read first 12 bytes
      });

      // Decode base64 to check signature
      const headerBytes = atob(base64Header);

      // MOV files start with ftyp box
      // Bytes 4-7 should be 'ftyp'
      const signature = headerBytes.substring(4, 8);

      if (signature !== 'ftyp') {
        return {
          valid: false,
          error: 'Not a valid MOV file (missing ftyp signature). Only transparent MOV files with HEVC codec are supported.'
        };
      }

      console.log('[VideoStorage] ✅ Valid MOV signature detected');

      // Note: We cannot easily check for HEVC codec or alpha channel
      // without a native video processing library or FFmpeg
      // The user must ensure they're importing HEVC+alpha MOVs

    } catch (headerError) {
      console.warn('[VideoStorage] Could not read file header:', headerError);
      // Continue anyway - some file systems may not support partial reads
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Validation error: ${error}` };
  }
}

/**
 * Link a video to a project as its preview
 * Automatically unlinks any other videos from this project
 */
export async function linkVideoToProject(projectName: string, videoId: string): Promise<void> {
  try {
    const videos = await readStoredVideos();

    // Find the video to link
    const videoToLink = videos.find(v => v.id === videoId);
    if (!videoToLink) {
      console.warn('[VideoStorage] Video not found:', videoId);
      return;
    }

    // Unlink any existing videos from this project
    const updated = videos.map(v => ({
      ...v,
      linkedProjectName: v.id === videoId ? projectName : (v.linkedProjectName === projectName ? undefined : v.linkedProjectName)
    }));

    await saveVideoMetadata(updated);
    console.log('[VideoStorage] ✅ Linked video', videoId, 'to project', projectName);
  } catch (error) {
    console.error('[VideoStorage] Failed to link video to project:', error);
  }
}

/**
 * Get the latest video linked to a project
 * Returns the video with the most recent createdAt timestamp
 */
export async function getProjectLatestVideo(projectName: string): Promise<VideoMetadata | null> {
  try {
    const videos = await readStoredVideos();
    const projectVideos = videos.filter(v => v.linkedProjectName === projectName && v.isExport);

    if (projectVideos.length === 0) {
      return null;
    }

    // Return the most recently created video
    return projectVideos.reduce((latest, current) =>
      current.createdAt > latest.createdAt ? current : latest
    );
  } catch (error) {
    console.error('[VideoStorage] Failed to get project latest video:', error);
    return null;
  }
}

/**
 * Get all videos linked to a project, ordered by date (newest first)
 */
export async function getProjectVideosByDate(projectName: string): Promise<VideoMetadata[]> {
  try {
    const videos = await readStoredVideos();
    const projectVideos = videos.filter(v => v.linkedProjectName === projectName && v.isExport);

    // Sort by createdAt descending (newest first)
    return projectVideos.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error('[VideoStorage] Failed to get project videos:', error);
    return [];
  }
}

/**
 * Unlink all videos from a project
 * Useful when deleting a project
 */
export async function unlinkProjectVideos(projectName: string): Promise<void> {
  try {
    const videos = await readStoredVideos();
    const updated = videos.map(v => ({
      ...v,
      linkedProjectName: v.linkedProjectName === projectName ? undefined : v.linkedProjectName
    }));

    await saveVideoMetadata(updated);
    console.log('[VideoStorage] ✅ Unlinked all videos from project', projectName);
  } catch (error) {
    console.error('[VideoStorage] Failed to unlink project videos:', error);
  }
}
