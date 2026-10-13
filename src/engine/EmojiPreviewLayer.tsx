/**
 * EmojiPreviewLayer — renders a "prepared preview" (the in-progress live stroke or the hover/brush
 * preview) as direct Skia nodes, identical to EmojiCanvas. Shared by the GPU/tile paint canvases so
 * preview rendering has a single source of truth.
 */
import React from 'react';
import {
  Circle,
  Group,
  Image as SkImageNode,
  type Transforms3d
} from '@shopify/react-native-skia';

import type { PreparedPreview } from '../components/EmojiCanvas';

/** Skia transform list for a stamp command (mirror + rotation about its center). */
export const commandTransforms = (
  centerX: number,
  centerY: number,
  rotationDeg: number,
  flipX: boolean,
  flipY: boolean
): Transforms3d | undefined => {
  const hasFlip = flipX || flipY;
  const hasRotation = Math.abs(rotationDeg) > 0.0001;
  if (!hasFlip && !hasRotation) {
    return undefined;
  }
  const result: Transforms3d = [{ translateX: centerX }, { translateY: centerY }];
  if (hasRotation) {
    result.push({ rotate: (rotationDeg * Math.PI) / 180 });
  }
  if (hasFlip) {
    result.push({ scaleX: flipX ? -1 : 1 });
    result.push({ scaleY: flipY ? -1 : 1 });
  }
  result.push({ translateX: -centerX }, { translateY: -centerY });
  return result;
};

export const EmojiPreviewLayer: React.FC<{ preview: PreparedPreview | null; keyPrefix: string }> = ({
  preview,
  keyPrefix
}) => {
  if (!preview) {
    return null;
  }
  if (preview.isEraser) {
    return (
      <Group>
        {preview.commands.map((command, index) =>
          command.radius !== undefined ? (
            <Circle
              key={`${keyPrefix}-eraser-${index}`}
              cx={command.centerX}
              cy={command.centerY}
              r={command.radius}
              style="stroke"
              strokeWidth={2}
              color="rgba(255,255,255,0.5)"
            />
          ) : null
        )}
      </Group>
    );
  }
  return (
    <Group opacity={preview.opacity}>
      {preview.commands.map((command, index) => {
        if (!command.stamp) {
          return null;
        }
        return (
          <SkImageNode
            key={`${keyPrefix}-${index}`}
            image={command.stamp.image}
            x={command.x}
            y={command.y}
            width={command.width}
            height={command.height}
            fit="fill"
            transform={commandTransforms(
              command.centerX,
              command.centerY,
              command.rotation,
              command.flipX,
              command.flipY
            )}
          />
        );
      })}
    </Group>
  );
};
