/**
 * GuidedCaptureContext — stub placeholder.
 * [SHOWCASE-CAPTURE] temporary content-capture tool — remove when feature is removed.
 */
import React, { createContext, useContext } from 'react';

interface GuidedCaptureContextValue {
  startSession: () => void;
  startFreeDraw: () => void;
  openClips: () => void;
}

const GuidedCaptureContext = createContext<GuidedCaptureContextValue>({
  startSession: () => undefined,
  startFreeDraw: () => undefined,
  openClips: () => undefined,
});

export function GuidedCaptureProvider({ children }: { children: React.ReactNode }) {
  const value: GuidedCaptureContextValue = {
    startSession: () => undefined,
    startFreeDraw: () => undefined,
    openClips: () => undefined,
  };
  return (
    <GuidedCaptureContext.Provider value={value}>
      {children}
    </GuidedCaptureContext.Provider>
  );
}

export function useGuidedCapture(): GuidedCaptureContextValue {
  return useContext(GuidedCaptureContext);
}
