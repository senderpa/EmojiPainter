/**
 * RevealContext — "tap to reveal the original Apple emoji". When a custom emoji set is active, ANY tap
 * briefly (~0.3s) flips every custom emoji back to the system emoji as playful feedback, then back.
 *
 * Implemented as a root touch OBSERVER (onStartShouldSetResponderCapture returns false → it never
 * captures the touch, so buttons / drawing / gestures keep working). Kept in its own light context so a
 * pulse only re-renders the emoji leaves (AppText/AppEmoji), not heavy screens.
 */
import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { View } from 'react-native';
import { useEmojiSet } from './EmojiSetContext';

const RevealCtx = createContext<{ revealing: boolean }>({ revealing: false });

const REVEAL_MS = 320;

export const RevealProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeSetId } = useEmojiSet();
  const [revealing, setRevealing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(activeSetId);
  activeRef.current = activeSetId;

  const pulse = useCallback(() => {
    if (activeRef.current === 'apple') return; // nothing to reveal with the system set
    setRevealing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevealing(false), REVEAL_MS);
  }, []);

  return (
    <RevealCtx.Provider value={{ revealing }}>
      <View
        style={{ flex: 1 }}
        onStartShouldSetResponderCapture={() => { pulse(); return false; }}
      >
        {children}
      </View>
    </RevealCtx.Provider>
  );
};

export const useReveal = (): boolean => useContext(RevealCtx).revealing;
