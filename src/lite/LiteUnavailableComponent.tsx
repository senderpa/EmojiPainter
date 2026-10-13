import React from 'react';

/**
 * Build-time replacement for screens and overlays unavailable in Emoji Painter
 * Lite. Runtime guards still hide their entry points and reject navigation.
 */
export default function LiteUnavailableComponent(): React.ReactElement | null {
  return null;
}
