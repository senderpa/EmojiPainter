/** Circular portrait with accent border + 👤 fallback. */
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../emoji/AppText';

interface Props {
  uri: string | null | undefined;
  size?: number;
  accent?: string;
  /** Cache-bust the portrait (NOT gallery images) so a fresh upload shows. */
  bust?: boolean;
}

/**
 * Cache-busting is only meaningful — and only SAFE — for remote URLs.
 * A freshly uploaded portrait is handed over as a `data:image/png;base64,…`
 * URI, and appending `?t=…` to that makes it malformed: the image fails to
 * decode, onError fires, and the avatar silently falls back to 👤. Local
 * `file://` paths have the same problem and need no busting either.
 */
export const bustPortraitUri = (uri: string, bust: boolean): string => {
  if (!bust || !/^https?:\/\//i.test(uri)) return uri;
  return `${uri}${uri.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 60000)}`;
};

const PortraitAvatar: React.FC<Props> = ({ uri, size = 96, accent = '#ff9f6b', bust = false }) => {
  const src = uri ? bustPortraitUri(uri, bust) : null;
  // Track load failures so a broken/404 portrait falls back to 👤 instead of a blank circle.
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);
  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2, borderColor: accent },
      ]}
    >
      {src && !failed ? (
        <Image
          source={{ uri: src }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={{ fontSize: size * 0.5 }}>👤</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderWidth: 3,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PortraitAvatar;
