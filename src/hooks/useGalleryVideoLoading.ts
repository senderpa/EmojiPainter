/**
 * useGalleryVideoLoading Hook
 *
 * React hook for progressive video loading with connection-aware quality
 * Usage:
 *   const { videoUri, isLoading, quality, error } = useGalleryVideoLoading(videoId, videoUrl);
 */

import { useEffect, useState, useCallback } from 'react';
import {
  loadVideoProgressively,
  subscribeToVideoLoad,
  ProgressiveVideoLoadResult,
  LoadingStage,
  cancelVideoLoad
} from '../video/progressiveVideoLoader';
import { getRecommendedQuality, detectConnectionType, VideoQuality, ConnectionType } from '../video/galleryVideoCache';

export interface UseGalleryVideoLoadingResult {
  // Current video URI (cached path or remote URL)
  videoUri: string | null;
  // Loading stage
  stage: LoadingStage;
  // Whether actively loading
  isLoading: boolean;
  // Current quality being loaded
  quality: VideoQuality;
  // Connection type detected
  connection: ConnectionType;
  // Error message if any
  error: string | null;
  // Loading progress 0-100
  progress: number;
  // Whether using cached version
  isCached: boolean;
  // Retry loading
  retry: () => void;
}

export function useGalleryVideoLoading(
  videoId: number,
  videoUrl: string,
  thumbnailUri?: string
): UseGalleryVideoLoadingResult {
  const [result, setResult] = useState<ProgressiveVideoLoadResult | null>(null);
  const [quality, setQuality] = useState<VideoQuality>('medium');
  const [connection, setConnection] = useState<ConnectionType>('unknown');
  const [retryCount, setRetryCount] = useState(0);

  // Initialize loading
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const initializeLoad = async () => {
      try {
        // Detect connection and quality
        const conn = await detectConnectionType();
        setConnection(conn);

        const qual = await getRecommendedQuality();
        setQuality(qual);

        // Start progressive loading
        const loadResult = await loadVideoProgressively(videoId, videoUrl, thumbnailUri, {
          enableProgressiveLoad: true,
          autoCache: true,
          placeholderQuality: 'preview',
          timeoutMs: 30000
        });

        setResult(loadResult);

        // Subscribe to updates
        unsubscribe = subscribeToVideoLoad(videoId, (updatedResult) => {
          setResult(updatedResult);
        });
      } catch (error) {
        console.warn('[useGalleryVideoLoading] Error:', error);
      }
    };

    initializeLoad();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [videoId, videoUrl, thumbnailUri, retryCount]);

  const retry = useCallback(() => {
    cancelVideoLoad(videoId);
    setResult(null);
    setRetryCount((prev) => prev + 1);
  }, [videoId]);

  return {
    videoUri: result?.fullVideoUri || result?.placeholderUri || result?.thumbnailUri || null,
    stage: result?.currentStage || 'thumbnail',
    isLoading: result?.currentStage === 'loading' || result?.currentStage === 'placeholder',
    quality,
    connection,
    error: result?.error || null,
    progress: result?.progress || 0,
    isCached: result?.cached || false,
    retry
  };
}

/**
 * Batch hook for loading multiple videos
 */
export interface UseGalleryVideosBatchResult {
  videos: Record<
    number,
    {
      videoUri: string | null;
      stage: LoadingStage;
      isLoading: boolean;
      error: string | null;
      progress: number;
    }
  >;
  isLoadingAny: boolean;
  totalProgress: number;
  retry: (videoId: number) => void;
}

export function useGalleryVideosBatch(
  videos: Array<{ videoId: number; videoUrl: string; thumbnailUri?: string }>
): UseGalleryVideosBatchResult {
  const [results, setResults] = useState<Record<number, ProgressiveVideoLoadResult>>({});
  const [retryIds, setRetryIds] = useState<Set<number>>(new Set());

  // Load all videos
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    const loadAll = async () => {
      for (const video of videos) {
        try {
          // Load progressively
          const result = await loadVideoProgressively(video.videoId, video.videoUrl, video.thumbnailUri, {
            enableProgressiveLoad: true,
            autoCache: true
          });

          setResults((prev) => ({ ...prev, [video.videoId]: result }));

          // Subscribe to updates
          const unsubscribe = subscribeToVideoLoad(video.videoId, (updatedResult) => {
            setResults((prev) => ({ ...prev, [video.videoId]: updatedResult }));
          });

          unsubscribers.push(unsubscribe);
        } catch (error) {
          console.warn(`[useGalleryVideosBatch] Error loading video ${video.videoId}:`, error);
        }
      }
    };

    loadAll();

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [videos]);

  const retry = useCallback((videoId: number) => {
    cancelVideoLoad(videoId);
    setResults((prev) => {
      const newResults = { ...prev };
      delete newResults[videoId];
      return newResults;
    });
    setRetryIds((prev) => new Set(prev).add(videoId));
  }, []);

  // Convert results to simplified format
  const videoMap: UseGalleryVideosBatchResult['videos'] = {};
  for (const video of videos) {
    const result = results[video.videoId];
    videoMap[video.videoId] = {
      videoUri: result?.fullVideoUri || result?.placeholderUri || result?.thumbnailUri || null,
      stage: result?.currentStage || 'thumbnail',
      isLoading: result?.currentStage === 'loading' || result?.currentStage === 'placeholder',
      error: result?.error || null,
      progress: result?.progress || 0
    };
  }

  const isLoadingAny = Object.values(videoMap).some((v) => v.isLoading);
  const avgProgress = Object.values(videoMap).reduce((sum, v) => sum + v.progress, 0) / videos.length;

  return {
    videos: videoMap,
    isLoadingAny,
    totalProgress: Math.round(avgProgress),
    retry
  };
}
