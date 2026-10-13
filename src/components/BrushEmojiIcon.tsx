import React, { useEffect, useMemo, useState } from 'react';
import { Image, type ImageStyle, type StyleProp, type TextStyle } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import {
  getCachedCustomBrushPNG,
  getCustomBrushPNGData,
  isCustomBrushReference,
} from '../lib/customBrushRegistry';
import { isCustomPng } from '../lib/pngNormalizer';

interface BrushEmojiIconProps {
  emoji: string;
  size: number;
  textStyle?: StyleProp<TextStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  placeholderText?: string;
}

const BrushEmojiIcon: React.FC<BrushEmojiIconProps> = ({
  emoji,
  size,
  textStyle,
  imageStyle,
  placeholderText = '⌛',
}) => {
  const [loadedBase64, setLoadedBase64] = useState<string | null>(null);

  const isCustomId = useMemo(() => isCustomBrushReference(emoji), [emoji]);
  const isDataUri = useMemo(() => isCustomPng(emoji), [emoji]);

  useEffect(() => {
    let cancelled = false;

    if (isCustomId) {
      const cached = getCachedCustomBrushPNG(emoji);
      if (cached) {
        setLoadedBase64(cached);
      } else {
        setLoadedBase64(null);
        getCustomBrushPNGData(emoji)
          .then((data) => {
            if (!cancelled) {
              setLoadedBase64(data);
            }
          })
          .catch(() => {
            if (!cancelled) {
              setLoadedBase64(null);
            }
          });
      }
    } else if (isDataUri) {
      setLoadedBase64(emoji);
    } else {
      setLoadedBase64(null);
    }

    return () => {
      cancelled = true;
    };
  }, [emoji, isCustomId, isDataUri]);

  if (isCustomId) {
    const cached = getCachedCustomBrushPNG(emoji);
    const base64 = cached || loadedBase64;
    if (base64) {
      const uri = base64.startsWith('data:image/png;base64,')
        ? base64
        : `data:image/png;base64,${base64}`;
      return (
        <Image
          source={{ uri }}
          style={[{ width: size, height: size, borderRadius: Math.min(6, size / 5) }, imageStyle]}
          resizeMode="contain"
        />
      );
    }

    return (
      <Text style={[{ fontSize: size * 0.72, lineHeight: size }, textStyle]}>
        {placeholderText}
      </Text>
    );
  }

  if (isDataUri) {
    return (
      <Image
        source={{ uri: emoji }}
        style={[{ width: size, height: size, borderRadius: Math.min(6, size / 5) }, imageStyle]}
        resizeMode="contain"
      />
    );
  }

  // Fallback: show placeholder or text
  // For custom brush IDs that are loading, show hourglass
  // Otherwise show the emoji text as-is
  const displayText = emoji.startsWith('custom_brush_') ? '⌛' : emoji;
  return (
    <Text style={[{ fontSize: size, lineHeight: size }, textStyle]}>
      {displayText}
    </Text>
  );
};

export default BrushEmojiIcon;
