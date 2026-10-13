/**
 * usePrivateStudio — owns all private-studio state.
 *
 * EXTRACTION STATUS: REAL STATE HOOK — all useState/useRef for private studio
 * state live here. Complex handlers remain in PaintScreen.tsx and are wired via
 * the returned setters/refs. A follow-up task will migrate the handlers too.
 *
 * @see ARCHITECTURE.md for the extraction guide
 */
import React, { useRef, useState } from 'react';
import { Animated as RNAnimated } from 'react-native';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------
const PRIVATE_STUDIO_DEFAULT_NAME_SHORT = '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrivateStudioFlightVector {
  midX: number;
  midY: number;
  endX: number;
  endY: number;
  midScale: number;
  endScale: number;
  endRotate: number;
}

export interface UsePrivateStudioResult {
  // ── Visibility / loading ─────────────────────────────────────────────────
  privateStudioVisible: boolean;
  setPrivateStudioVisible: React.Dispatch<React.SetStateAction<boolean>>;
  privateStudioLoading: boolean;
  setPrivateStudioLoading: React.Dispatch<React.SetStateAction<boolean>>;

  // ── Error / status ───────────────────────────────────────────────────────
  privateStudioError: string | null;
  setPrivateStudioError: React.Dispatch<React.SetStateAction<string | null>>;
  privateStudioStatusMessage: string | null;
  setPrivateStudioStatusMessage: React.Dispatch<React.SetStateAction<string | null>>;

  // ── Passport name ────────────────────────────────────────────────────────
  privateStudioName: string;
  setPrivateStudioName: React.Dispatch<React.SetStateAction<string>>;
  privateStudioRandomLocked: boolean;
  setPrivateStudioRandomLocked: React.Dispatch<React.SetStateAction<boolean>>;

  // ── Canvas-flight animation vector ───────────────────────────────────────
  privateStudioFlightVector: PrivateStudioFlightVector;
  setPrivateStudioFlightVector: React.Dispatch<React.SetStateAction<PrivateStudioFlightVector>>;

  // ── Session stats ────────────────────────────────────────────────────────
  privateStudioElapsedMs: number;
  setPrivateStudioElapsedMs: React.Dispatch<React.SetStateAction<number>>;
  privateStudioStrokeCount: number;
  setPrivateStudioStrokeCount: React.Dispatch<React.SetStateAction<number>>;

  // ── Upload / save ────────────────────────────────────────────────────────
  privateStudioSaving: boolean;
  setPrivateStudioSaving: React.Dispatch<React.SetStateAction<boolean>>;
  privateStudioUploadInFlight: boolean;
  setPrivateStudioUploadInFlight: React.Dispatch<React.SetStateAction<boolean>>;

  // ── Tip overlay ──────────────────────────────────────────────────────────
  privateStudioTipVisible: boolean;
  setPrivateStudioTipVisible: React.Dispatch<React.SetStateAction<boolean>>;
  privateStudioTipText: string;
  setPrivateStudioTipText: React.Dispatch<React.SetStateAction<string>>;
  /** Spring-in/out animated scale for the tip bubble. */
  privateStudioTipScale: RNAnimated.Value;
  /** Fade animated opacity for the tip bubble. */
  privateStudioTipOpacity: RNAnimated.Value;
  /** Radial burst progress (0→1) used for confetti/burst animation. */
  privateStudioTipBurstProgress: RNAnimated.Value;

  // ── Leaderboard visibility (consumed by useLeaderboard param) ────────────
  privateStudioLeaderboardVisible: boolean;
  setPrivateStudioLeaderboardVisible: React.Dispatch<React.SetStateAction<boolean>>;

  // ── Persistent animated values (created once via useRef().current) ────────
  /** Scale animation for the dice/random-name button. */
  privateStudioDiceScale: RNAnimated.Value;
  /** 0→1 progress of the "canvas flies to passport" entry animation. */
  privateStudioCanvasFlight: RNAnimated.Value;

  // ── Refs ─────────────────────────────────────────────────────────────────
  /** True once an auto-generated name has been applied to prevent overwrite. */
  privateStudioAutoNameAssignedRef: React.MutableRefObject<boolean>;
  /** True once the random name feature has been used this session. */
  privateStudioRandomUsedRef: React.MutableRefObject<boolean>;
  /** Set of pending typewriter animation timeout handles (cleared on dismiss). */
  privateStudioTypewriterTimeoutsRef: React.MutableRefObject<Set<NodeJS.Timeout>>;
  /** True while a typewriter name animation is in progress. */
  privateStudioTypewriterActiveRef: React.MutableRefObject<boolean>;
  /** Handle for the canvas-flight animation reset timeout. */
  privateStudioCanvasFlightTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  /** Interval handle used to cycle tip text content. */
  privateStudioTipIntervalRef: React.MutableRefObject<NodeJS.Timeout | null>;
  /** Timeout handle for auto-dismissing the tip bubble. */
  privateStudioTipTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePrivateStudio(): UsePrivateStudioResult {
  // ── Visibility / loading ─────────────────────────────────────────────────
  const [privateStudioVisible, setPrivateStudioVisible] = useState(false);
  const [privateStudioLoading, setPrivateStudioLoading] = useState(false);

  // ── Error / status ───────────────────────────────────────────────────────
  const [privateStudioError, setPrivateStudioError] = useState<string | null>(null);
  const [privateStudioStatusMessage, setPrivateStudioStatusMessage] = useState<string | null>(null);

  // ── Passport name ────────────────────────────────────────────────────────
  const [privateStudioName, setPrivateStudioName] = useState(PRIVATE_STUDIO_DEFAULT_NAME_SHORT);
  const [privateStudioRandomLocked, setPrivateStudioRandomLocked] = useState(false);

  // ── Canvas-flight animation vector ───────────────────────────────────────
  const [privateStudioFlightVector, setPrivateStudioFlightVector] =
    useState<PrivateStudioFlightVector>({
      midX: 0,
      midY: 0,
      endX: 0,
      endY: 0,
      midScale: 1,
      endScale: 1,
      endRotate: 0,
    });

  // ── Session stats ────────────────────────────────────────────────────────
  const [privateStudioElapsedMs, setPrivateStudioElapsedMs] = useState(0);
  const [privateStudioStrokeCount, setPrivateStudioStrokeCount] = useState(0);

  // ── Upload / save ────────────────────────────────────────────────────────
  const [privateStudioSaving, setPrivateStudioSaving] = useState(false);
  const [privateStudioUploadInFlight, setPrivateStudioUploadInFlight] = useState(false);

  // ── Tip overlay ──────────────────────────────────────────────────────────
  const [privateStudioTipVisible, setPrivateStudioTipVisible] = useState(false);
  const [privateStudioTipText, setPrivateStudioTipText] = useState('');
  const privateStudioTipScale = useRef(new RNAnimated.Value(0.8)).current;
  const privateStudioTipOpacity = useRef(new RNAnimated.Value(0)).current;
  const privateStudioTipBurstProgress = useRef(new RNAnimated.Value(0)).current;

  // ── Leaderboard visibility ───────────────────────────────────────────────
  const [privateStudioLeaderboardVisible, setPrivateStudioLeaderboardVisible] = useState(false);

  // ── Persistent animated values ───────────────────────────────────────────
  const privateStudioDiceScale = useRef(new RNAnimated.Value(1)).current;
  const privateStudioCanvasFlight = useRef(new RNAnimated.Value(0)).current;

  // ── Refs ─────────────────────────────────────────────────────────────────
  const privateStudioAutoNameAssignedRef = useRef(false);
  const privateStudioRandomUsedRef = useRef(false);
  const privateStudioTypewriterTimeoutsRef = useRef<Set<NodeJS.Timeout>>(new Set());
  const privateStudioTypewriterActiveRef = useRef(false);
  const privateStudioCanvasFlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const privateStudioTipIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const privateStudioTipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  return {
    // Visibility / loading
    privateStudioVisible,
    setPrivateStudioVisible,
    privateStudioLoading,
    setPrivateStudioLoading,
    // Error / status
    privateStudioError,
    setPrivateStudioError,
    privateStudioStatusMessage,
    setPrivateStudioStatusMessage,
    // Passport name
    privateStudioName,
    setPrivateStudioName,
    privateStudioRandomLocked,
    setPrivateStudioRandomLocked,
    // Canvas-flight vector
    privateStudioFlightVector,
    setPrivateStudioFlightVector,
    // Session stats
    privateStudioElapsedMs,
    setPrivateStudioElapsedMs,
    privateStudioStrokeCount,
    setPrivateStudioStrokeCount,
    // Upload / save
    privateStudioSaving,
    setPrivateStudioSaving,
    privateStudioUploadInFlight,
    setPrivateStudioUploadInFlight,
    // Tip overlay
    privateStudioTipVisible,
    setPrivateStudioTipVisible,
    privateStudioTipText,
    setPrivateStudioTipText,
    privateStudioTipScale,
    privateStudioTipOpacity,
    privateStudioTipBurstProgress,
    // Leaderboard
    privateStudioLeaderboardVisible,
    setPrivateStudioLeaderboardVisible,
    // Animated values
    privateStudioDiceScale,
    privateStudioCanvasFlight,
    // Refs
    privateStudioAutoNameAssignedRef,
    privateStudioRandomUsedRef,
    privateStudioTypewriterTimeoutsRef,
    privateStudioTypewriterActiveRef,
    privateStudioCanvasFlightTimeoutRef,
    privateStudioTipIntervalRef,
    privateStudioTipTimeoutRef,
  };
}
