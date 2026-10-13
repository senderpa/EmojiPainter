import React, { useState } from 'react';
import { Image as RNImage, StyleSheet, View } from 'react-native';
import { Canvas, Image as SkiaImage, useAnimatedImageValue } from '@shopify/react-native-skia';
import { AppText as Text } from '../../emoji/AppText';

type Props = {
  source: any;
  fallbackSource?: any;
  fallbackEmoji: string;
  size: number;
  dimmed?: boolean;
  companionSource?: any | null;
  companionFallbackSource?: any | null;
  companionSources?: any[];
  companionFallbackSources?: any[];
  animate?: boolean;
};

const SkiaLoopingImage: React.FC<{
  source: any;
  size: number;
  dimmed?: boolean;
}> = ({ source, size, dimmed }) => {
  const frame = useAnimatedImageValue(source);
  const style = { width: size, height: size, opacity: dimmed ? 0.34 : 1 };

  return (
    <Canvas style={style} pointerEvents="none">
      <SkiaImage image={frame} x={0} y={0} width={size} height={size} fit="contain" />
    </Canvas>
  );
};

const AnimatedEmojiAsset: React.FC<{
  source: any;
  fallbackSource?: any | null;
  fallbackEmoji: string;
  size: number;
  dimmed?: boolean;
  animate?: boolean;
}> = ({ source, fallbackSource, fallbackEmoji, size, dimmed, animate = true }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const style = { width: size, height: size, opacity: dimmed ? 0.34 : 1 };
  const imageSource = fallbackSource ?? source;

  if (animate && imageSource && !imageFailed) {
    return <SkiaLoopingImage source={imageSource} size={size} dimmed={dimmed} />;
  }

  if (imageSource && !imageFailed) {
    return (
      <RNImage
        source={imageSource}
        style={style}
        resizeMode="contain"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <View style={[styles.fallback, style]}>
      <Text style={{ fontSize: size * 0.62 }}>{fallbackEmoji}</Text>
    </View>
  );
};

const AnimatedLevelEmoji: React.FC<Props> = ({
  source,
  fallbackSource,
  fallbackEmoji,
  size,
  dimmed,
  companionSource,
  companionFallbackSource,
  companionSources,
  companionFallbackSources,
  animate = true,
}) => {
  const companionWebmSources = companionSources ?? (companionSource ? [companionSource] : []);
  const companionWebpSources = companionFallbackSources ?? (companionFallbackSource ? [companionFallbackSource] : []);
  const visibleCompanions = companionWebmSources.slice(0, 2);
  const hasCompanion = visibleCompanions.length > 0;
  const primarySize = hasCompanion ? Math.round(size * 0.76) : size;
  const companionSize = Math.round(size * 0.72);

  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.primary, hasCompanion && styles.primaryWithCompanion]}>
        <AnimatedEmojiAsset
          source={source}
          fallbackSource={fallbackSource}
          fallbackEmoji={fallbackEmoji}
          size={primarySize}
          dimmed={dimmed}
          animate={animate}
        />
      </View>
      {visibleCompanions.map((item, index) => (
        <View
          key={`companion-${index}`}
          style={[
            styles.companion,
            index === 0 ? styles.companionOne : styles.companionTwo,
            { width: companionSize, height: companionSize, borderRadius: companionSize / 2 },
          ]}
        >
          <AnimatedEmojiAsset
            source={item}
            fallbackSource={companionWebpSources[index]}
            fallbackEmoji="🧑‍🎨"
            size={companionSize}
            dimmed={dimmed}
            animate={animate}
          />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  primary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryWithCompanion: {
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
  },
  companion: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  companionOne: {
    right: -1,
    top: -1,
  },
  companionTwo: {
    right: 7,
    top: 7,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AnimatedLevelEmoji;
