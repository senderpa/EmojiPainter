/**
 * Progressive Video Loader
 *
 * Implements progressive loading of gallery videos:
 * 1. Show thumbnail immediately
 * 2. Load low-res placeholder in background
 * 3. Replace with full video when ready
 * 4. Cache for future use
 */

import { cacheVideo, getCachedVideoPath, getRecommendedQuality, detectConnectionType } from './galleryVideoCache';

export type LoadingStage = 'thumbnail' | 'loading' | 'placeholder' | 'full' | 'failed';

export interface ProgressiveVideoLoadResult {
  videoId: number;
  currentStage: LoadingStage;
  thumbnailUri?: string;
  placeholderUri?: string; // Low-res video preview
  fullVideoUri?: string; // Full resolution video or cached path
  cached: boolean;
  progress: number; // 0-100
  error?: string;
}

export interface ProgressiveVideoLoaderOptions {
  enableProgressiveLoad?: boolean;
  autoCache?: boolean;
  placeholderQuality?: 'low' | 'preview';
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: ProgressiveVideoLoaderOptions = {
  enableProgressiveLoad: true,
  autoCache: true,
  placeholderQuality: 'preview',
  timeoutMs: 30000 // 30 seconds max
};

interface LoadingSession {
  videoId: number;
  callbacks: Set<(result: ProgressiveVideoLoadResult) => void>;
  currentStage: LoadingStage;
  result: ProgressiveVideoLoadResult;
  abortController: AbortController;
}

const activeSessions = new Map<number, LoadingSession>();

/**
 * Load video progressively
 */
export async function loadVideoProgressively(
  videoId: number,
  fullVideoUrl: string,
  thumbnailUri?: string,
  options?: ProgressiveVideoLoaderOptions
): Promise<ProgressiveVideoLoadResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  console.log(`[ProgressiveVideoLoader] Starting progressive load for video ${videoId}`);

  // Check if cached
  const cachedPath = await getCachedVideoPath(videoId);
  if (cachedPath) {
    console.log(`[ProgressiveVideoLoader] ✅ Using cached video: ${videoId}`);
    return {
      videoId,
      currentStage: 'full',
      fullVideoUri: cachedPath,
      cached: true,
      progress: 100
    };
  }

  // Create or get existing session
  let session = activeSessions.get(videoId);
  if (session) {
    console.log(`[ProgressiveVideoLoader] Reusing existing session for video ${videoId}`);
    return new Promise((resolve) => {
      session!.callbacks.add((result) => {
        activeSessions.delete(videoId);
        resolve(result);
      });
    });
  }

  // Create new session
  const abortController = new AbortController();
  session = {
    videoId,
    callbacks: new Set(),
    currentStage: 'thumbnail',
    result: {
      videoId,
      currentStage: 'thumbnail',
      thumbnailUri,
      cached: false,
      progress: 10
    },
    abortController
  };

  activeSessions.set(videoId, session);

  try {
    // Stage 1: Show thumbnail immediately
    notifySession(session);

    if (!opts.enableProgressiveLoad) {
      // Direct load
      const fullPath = await cacheVideo(videoId, fullVideoUrl, await getRecommendedQuality());
      if (fullPath) {
        session.currentStage = 'full';
        session.result = {
          videoId,
          currentStage: 'full',
          fullVideoUri: fullPath,
          cached: opts.autoCache,
          progress: 100,
          thumbnailUri
        };
        notifySession(session);
      }
    } else {
      // Progressive load
      const connectionType = await detectConnectionType();
      const recommendedQuality = await getRecommendedQuality();

      if (connectionType === 'offline') {
        // Offline - can't load anything beyond thumbnail
        session.currentStage = 'failed';
        session.result = {
          videoId,
          currentStage: 'failed',
          thumbnailUri,
          cached: false,
          progress: 10,
          error: 'No internet connection'
        };
        notifySession(session);
      } else if (connectionType === 'wifi') {
        // WiFi - go straight to high quality
        console.log(`[ProgressiveVideoLoader] WiFi detected, loading high-quality`);
        const fullPath = await cacheVideo(videoId, fullVideoUrl, 'high');
        if (fullPath) {
          session.currentStage = 'full';
          session.result = {
            videoId,
            currentStage: 'full',
            fullVideoUri: fullPath,
            cached: opts.autoCache,
            progress: 100,
            thumbnailUri
          };
          notifySession(session);
        } else {
          throw new Error('Failed to load high-quality video');
        }
      } else {
        // Cellular - load placeholder first, then full video in background
        console.log(`[ProgressiveVideoLoader] Cellular (${connectionType}) detected, loading progressively`);

        // Update to loading state
        session.currentStage = 'loading';
        session.result.currentStage = 'loading';
        session.result.progress = 20;
        notifySession(session);

        try {
          // Start loading full quality in background (don't await)
          const fullPromise = cacheVideo(videoId, fullVideoUrl, recommendedQuality)
            .then((path) => {
              if (path && !abortController.signal.aborted) {
                session.currentStage = 'full';
                session.result = {
                  videoId,
                  currentStage: 'full',
                  fullVideoUri: path,
                  cached: opts.autoCache,
                  progress: 100,
                  thumbnailUri
                };
                notifySession(session);
              }
            })
            .catch((error) => {
              if (!abortController.signal.aborted) {
                console.warn(`[ProgressiveVideoLoader] Failed to load full video:`, error);
                session.currentStage = 'failed';
                session.result = {
                  videoId,
                  currentStage: 'failed',
                  thumbnailUri,
                  cached: false,
                  progress: 30,
                  error: error.message
                };
                notifySession(session);
              }
            });

          // Set timeout
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => {
              if (session.currentStage === 'loading' || session.currentStage === 'placeholder') {
                reject(new Error('Video load timeout'));
              }
            }, opts.timeoutMs);
          });

          await Promise.race([fullPromise, timeoutPromise]);
        } catch (error) {
          if (!abortController.signal.aborted && session.currentStage !== 'full') {
            console.warn(`[ProgressiveVideoLoader] Progressive load failed:`, error);
            session.currentStage = 'failed';
            session.result = {
              videoId,
              currentStage: 'failed',
              thumbnailUri,
              cached: false,
              progress: 30,
              error: error instanceof Error ? error.message : 'Failed to load video'
            };
            notifySession(session);
          }
        }
      }
    }

    return session.result;
  } catch (error) {
    console.error(`[ProgressiveVideoLoader] ❌ Failed to load video ${videoId}:`, error);

    session.currentStage = 'failed';
    session.result = {
      videoId,
      currentStage: 'failed',
      thumbnailUri,
      cached: false,
      progress: 0,
      error: error instanceof Error ? error.message : 'Failed to load video'
    };
    notifySession(session);
    return session.result;
  }
}

/**
 * Notify all callbacks in a session
 */
function notifySession(session: LoadingSession): void {
  for (const callback of session.callbacks) {
    try {
      callback(session.result);
    } catch (error) {
      console.warn('[ProgressiveVideoLoader] Callback error:', error);
    }
  }

  // Clear callbacks if final stage
  if (session.currentStage === 'full' || session.currentStage === 'failed') {
    session.callbacks.clear();
  }
}

/**
 * Subscribe to loading progress
 */
export function subscribeToVideoLoad(
  videoId: number,
  callback: (result: ProgressiveVideoLoadResult) => void
): () => void {
  const session = activeSessions.get(videoId);

  if (!session) {
    // Session not found
    console.warn(`[ProgressiveVideoLoader] No active session for video ${videoId}`);
    return () => {};
  }

  session.callbacks.add(callback);

  // Return unsubscribe function
  return () => {
    session.callbacks.delete(callback);
  };
}

/**
 * Cancel loading for a video
 */
export function cancelVideoLoad(videoId: number): void {
  const session = activeSessions.get(videoId);
  if (session) {
    session.abortController.abort();
    activeSessions.delete(videoId);
    console.log(`[ProgressiveVideoLoader] Cancelled load for video ${videoId}`);
  }
}

/**
 * Get current loading state without subscribing
 */
export function getVideoLoadState(videoId: number): ProgressiveVideoLoadResult | null {
  const session = activeSessions.get(videoId);
  return session ? session.result : null;
}

/**
 * Prefetch video (start loading in background)
 */
export async function prefetchVideo(
  videoId: number,
  videoUrl: string,
  thumbnailUri?: string
): Promise<void> {
  console.log(`[ProgressiveVideoLoader] Prefetching video ${videoId}`);

  // Check cache first
  const cached = await getCachedVideoPath(videoId);
  if (cached) {
    console.log(`[ProgressiveVideoLoader] Video already cached: ${videoId}`);
    return;
  }

  // Start loading without awaiting (fire and forget)
  loadVideoProgressively(videoId, videoUrl, thumbnailUri, {
    enableProgressiveLoad: true,
    autoCache: true
  }).catch((error) => {
    console.warn(`[ProgressiveVideoLoader] Prefetch error for video ${videoId}:`, error);
  });
}

/**
 * Batch prefetch multiple videos
 */
export async function prefetchVideos(
  videos: Array<{ videoId: number; videoUrl: string; thumbnailUri?: string }>
): Promise<void> {
  console.log(`[ProgressiveVideoLoader] Batch prefetching ${videos.length} videos`);

  // Prefetch in groups to avoid overwhelming network
  const groupSize = 3;
  for (let i = 0; i < videos.length; i += groupSize) {
    const group = videos.slice(i, i + groupSize);
    await Promise.all(
      group.map((video) =>
        prefetchVideo(video.videoId, video.videoUrl, video.thumbnailUri).catch(
          (error) => {
            console.warn(`[ProgressiveVideoLoader] Failed to prefetch video ${video.videoId}:`, error);
          }
        )
      )
    );

    // Add delay between groups
    if (i + groupSize < videos.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`[ProgressiveVideoLoader] ✅ Batch prefetch complete`);
}

/**
 * Get all active loading sessions
 */
export function getActiveSessions(): ProgressiveVideoLoadResult[] {
  return Array.from(activeSessions.values()).map((session) => session.result);
}

/**
 * Cancel all active loads
 */
export function cancelAllLoads(): void {
  console.log(`[ProgressiveVideoLoader] Cancelling all ${activeSessions.size} active loads`);

  for (const session of activeSessions.values()) {
    session.abortController.abort();
    session.callbacks.clear();
  }

  activeSessions.clear();
}
