/**
 * MetalEmojiCanvas.tsx
 * React Native wrapper for Metal-based emoji rendering
 * Drop-in replacement for EmojiCanvas with identical API
 */

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import type { Stroke, StrokePoint } from '../state/PaintingContext';
import * as MetalCanvas from '../native/metal';
import { adaptiveDecimatePoints } from '../lib/strokeProcessing';

export interface MetalEmojiCanvasProps {
  width: number;
  height: number;
  strokes: Stroke[];
  liveStroke?: Stroke | null;
  hoverPreview?: { x: number; y: number; emoji: string; size: number } | null;
  backgroundColor?: string;
  onReady?: () => void;
  devicePixelRatio?: number;
}

export interface MetalEmojiCanvasHandle {
  captureImage: (format: 'base64' | 'file', destinationPath?: string) => Promise<string>;
  clearCanvas: () => Promise<void>;
  getMemoryStats: () => Promise<any>;
}

/**
 * Metal-accelerated emoji canvas component
 * Provides the same interface as EmojiCanvas but uses native Metal rendering
 */
const MetalEmojiCanvas = forwardRef<MetalEmojiCanvasHandle, MetalEmojiCanvasProps>(
  (props, ref) => {
    const {
      width,
      height,
      strokes,
      liveStroke,
      hoverPreview,
      backgroundColor = 'transparent',
      onReady,
      devicePixelRatio = 2,
    } = props;

    const isInitialized = useRef(false);
    const renderedStrokeIds = useRef(new Set<string>());
    const lastCheckpointIndex = useRef(-1);
    const checkpointInterval = 12; // Match EmojiCanvas checkpoint frequency
    const maxCheckpoints = 4;

    // Initialize Metal canvas
    useEffect(() => {
      if (Platform.OS !== 'ios' || !MetalCanvas.isMetalAvailable()) {
        console.warn('Metal rendering not available, falling back to Skia');
        return;
      }

      const initCanvas = async () => {
        try {
          await MetalCanvas.initCanvas(width, height, devicePixelRatio);
          await MetalCanvas.clearCanvas();
          isInitialized.current = true;

          console.log('✅ Metal canvas initialized', { width, height, devicePixelRatio });

          if (onReady) {
            onReady();
          }
        } catch (error) {
          console.error('Failed to initialize Metal canvas:', error);
        }
      };

      initCanvas();
    }, [width, height, devicePixelRatio, onReady]);

    // Render strokes incrementally
    useEffect(() => {
      if (!isInitialized.current || strokes.length === 0) {
        return;
      }

      const renderNewStrokes = async () => {
        try {
          // Find strokes that haven't been rendered yet
          const newStrokes = strokes.filter((stroke) => !renderedStrokeIds.current.has(stroke.id));

          if (newStrokes.length === 0) {
            return;
          }

          // Render each new stroke
          for (const stroke of newStrokes) {
            await renderStroke(stroke);
            renderedStrokeIds.current.add(stroke.id);
          }

          // Create checkpoint if needed
          const strokesSinceCheckpoint = strokes.length - lastCheckpointIndex.current;
          if (strokesSinceCheckpoint >= checkpointInterval) {
            const checkpointId = `checkpoint_${strokes.length}`;
            await MetalCanvas.createCheckpoint(checkpointId);
            lastCheckpointIndex.current = strokes.length;

            // Clean up old checkpoints
            const totalCheckpoints = Math.floor(strokes.length / checkpointInterval);
            if (totalCheckpoints > maxCheckpoints) {
              const oldCheckpointId = `checkpoint_${
                (totalCheckpoints - maxCheckpoints) * checkpointInterval
              }`;
              await MetalCanvas.deleteCheckpoint(oldCheckpointId);
            }
          }
        } catch (error) {
          console.error('Failed to render strokes:', error);
        }
      };

      renderNewStrokes();
    }, [strokes]);

    // Render live stroke (drawing in progress)
    useEffect(() => {
      if (!isInitialized.current || !liveStroke) {
        return;
      }

      // TODO: Implement live stroke preview
      // This would require rendering to a separate overlay texture
      // For now, live strokes will only appear when committed
    }, [liveStroke]);

    // Render hover preview
    useEffect(() => {
      if (!isInitialized.current || !hoverPreview) {
        return;
      }

      // TODO: Implement hover preview
      // This would require rendering to a separate overlay texture
    }, [hoverPreview]);

    // Handle undo/redo by restoring from checkpoint
    useEffect(() => {
      if (!isInitialized.current) {
        return;
      }

      const currentStrokeIds = new Set(strokes.map((s) => s.id));
      const removedStrokes = Array.from(renderedStrokeIds.current).filter(
        (id) => !currentStrokeIds.has(id)
      );

      if (removedStrokes.length > 0) {
        // Strokes were removed (undo), need to re-render from scratch or restore checkpoint
        reRenderAllStrokes();
      }
    }, [strokes]);

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      captureImage: async (format: 'base64' | 'file', destinationPath?: string) => {
        if (!isInitialized.current) {
          throw new Error('Canvas not initialized');
        }
        return MetalCanvas.captureImage(format, destinationPath);
      },

      clearCanvas: async () => {
        if (!isInitialized.current) {
          throw new Error('Canvas not initialized');
        }
        await MetalCanvas.clearCanvas();
        renderedStrokeIds.current.clear();
        lastCheckpointIndex.current = -1;
      },

      getMemoryStats: async () => {
        if (!isInitialized.current) {
          throw new Error('Canvas not initialized');
        }
        return MetalCanvas.getMemoryStats();
      },
    }));

    // Helper: Render a single stroke
    const renderStroke = async (stroke: Stroke) => {
      // Validate stroke data
      if (!stroke || !stroke.points || stroke.points.length === 0) {
        console.warn('[MetalCanvas] Skipping invalid stroke:', stroke?.id);
        return;
      }

      // Resample points for optimal stamp density
      const resampledPoints = adaptiveDecimatePoints(stroke.points, stroke.size, stroke.spacing ?? 0.5, stroke.stampSpan);

      // Handle emoji sequences (spray mode)
      const emojis = stroke.emojiSequence && stroke.emojiSequence.length > 0
        ? stroke.emojiSequence
        : [stroke.emoji];

      // Create stamps for all points
      const stamps = resampledPoints.map((point, index) => {
        const emoji = emojis[index % emojis.length];

        return {
          emoji,
          x: point.x * width,
          y: point.y * height,
          size: stroke.size,
          opacity: stroke.opacity,
          mirrorX: stroke.mirrorX ?? false,
          mirrorY: stroke.mirrorY ?? false,
          rotation: stroke.rotation ?? 0,
          isEraser: stroke.isEraser ?? false,
        };
      });

      // Draw all stamps in batch (more efficient than individual draws)
      await MetalCanvas.drawEmojiStamps(stamps);
    };

    // Helper: Re-render all strokes from scratch
    const reRenderAllStrokes = async () => {
      try {
        await MetalCanvas.clearCanvas();
        renderedStrokeIds.current.clear();
        lastCheckpointIndex.current = -1;

        for (const stroke of strokes) {
          await renderStroke(stroke);
          renderedStrokeIds.current.add(stroke.id);
        }
      } catch (error) {
        console.error('Failed to re-render strokes:', error);
      }
    };

    // For now, we use a placeholder View
    // In production, you might want to add a native UIView wrapper
    return (
      <View
        style={[
          styles.container,
          {
            width,
            height,
            backgroundColor: backgroundColor === 'transparent' ? 'transparent' : backgroundColor,
          },
        ]}
      >
        {/* Metal rendering happens off-screen */}
        {/* The actual display would require a native view component */}
        {/* For now, this is a headless renderer used for export */}
      </View>
    );
  }
);

MetalEmojiCanvas.displayName = 'MetalEmojiCanvas';

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});

export default MetalEmojiCanvas;
