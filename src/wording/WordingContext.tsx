/**
 * Wording Context - Word of the Day State Management
 *
 * Integrates with PaintScreen to enable letter-by-letter painting mode
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { exportTimelapse } from '../native/timelapse';
import type { Stroke } from '../state/PaintingContext';
import { cloneStrokes } from '../types/storedPainting';

const dailyTopics = require('../../assets/daily_paint_topics_2025time.json');

// FFmpegKit stub - disabled in favor of native screen recording
const FFmpegKit = {
  execute: async (command: string) => {
    console.warn('[FFmpeg] Disabled - command ignored:', command);
    return {
      getReturnCode: async () => ({ isSuccess: () => false }),
      getAllLogsAsString: async () => 'FFmpeg is disabled'
    };
  }
};

const ReturnCode = {
  isSuccess: (code: any) => false
};

type LetterState = {
  letter: string;
  index: number;
  status: 'pending' | 'painting' | 'exporting' | 'complete' | 'reviewing';
  exportPath?: string;
};

type WordingMode =
  | 'inactive'     // Not in wording mode
  | 'active'       // Painting letters
  | 'stitching'    // Composing final video
  | 'complete';    // Done

type InfoLanguage = 'en' | 'de' | 'ru' | 'zh' | 'ko' | 'ja' | 'fr' | 'it';

type WordingContextType = {
  // State
  mode: WordingMode;
  word: string;
  letters: LetterState[];
  currentLetterIndex: number;
  timeRemaining: number; // seconds for current letter
  totalTimePerLetter: number; // seconds allocated per letter
  showTransition: boolean; // Show transition message between letters
  transitionMessage: string; // Message to display during transition
  exportProgress: number; // 0-100 for final export progress
  finalVideoPath: string; // Path to the stitched final video
  showLetterComplete: boolean; // Show letter completion overlay
  completedLetterPath: string; // Path to the just-completed letter video

  // Actions
  startWording: (customWord: string, language?: InfoLanguage) => Promise<void>;
  stopWording: () => void;
  getCurrentLetter: () => string | null;
  isWordingActive: () => boolean;
  proceedToNextLetter: () => void; // Called when user clicks "Next" on letter completion overlay
  finishLetterEarly: () => void; // Called when user clicks "Done" button above timer
  exportComposition: () => Promise<void>; // Called when user clicks "Export All" on completion overlay
  onLetterExportComplete: (letterIndex: number, videoPath: string) => void; // Called by PaintScreen when export completes

  // Callbacks (set by PaintScreen)
  onLetterComplete?: () => Promise<void>; // Called when timer expires (to clear canvas)
  onGetCurrentStrokes?: () => Stroke[]; // Called to get current strokes for export
  onAllComplete?: (videoPath: string) => void; // Called when final video ready
  onGetCanvasSize?: () => number; // Called to get current canvas size for export scaling
  onScaleStrokes?: (strokes: Stroke[], targetSize: number, sourceSize: number) => Stroke[]; // Called to scale strokes for export
  onNavigateToTimelapse?: (letterIndex: number, strokes: Stroke[]) => void; // Called to navigate to Timelapse screen for auto-export with captured strokes
};

const WordingContext = createContext<WordingContextType | undefined>(undefined);

export const WordingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<WordingMode>('inactive');
  const [word, setWord] = useState('');
  const [letters, setLetters] = useState<LetterState[]>([]);
  const [currentLetterIndex, setCurrentLetterIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [totalTimePerLetter, setTotalTimePerLetter] = useState(60);
  const [showTransition, setShowTransition] = useState(false);
  const [transitionMessage, setTransitionMessage] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const [folderName, setFolderName] = useState(''); // Folder for this wording session
  const [finalVideoPath, setFinalVideoPath] = useState(''); // Path to stitched final video
  const [showLetterComplete, setShowLetterComplete] = useState(false);
  const [completedLetterPath, setCompletedLetterPath] = useState('');
  const [doneButtonClicked, setDoneButtonClicked] = useState(false); // Hide Done button after click

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentLetterIndexRef = useRef(currentLetterIndex);
  const lettersRef = useRef(letters);
  const totalTimePerLetterRef = useRef(totalTimePerLetter);
  const folderNameRef = useRef(folderName);
  const wordRef = useRef(word);
  const onLetterCompleteRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const onGetCurrentStrokesRef = useRef<(() => Stroke[]) | undefined>(undefined);
  const onAllCompleteRef = useRef<((videoPath: string) => void) | undefined>(undefined);
  const onGetCanvasSizeRef = useRef<(() => number) | undefined>(undefined);
  const onScaleStrokesRef = useRef<((strokes: Stroke[], targetSize: number, sourceSize: number) => Stroke[]) | undefined>(undefined);
  const onNavigateToTimelapseRef = useRef<((letterIndex: number, strokes: Stroke[]) => void) | undefined>(undefined);
  const isExportingRef = useRef(false); // Prevent double exports

  // Keep refs in sync
  useEffect(() => {
    currentLetterIndexRef.current = currentLetterIndex;
  }, [currentLetterIndex]);

  useEffect(() => {
    lettersRef.current = letters;
  }, [letters]);

  useEffect(() => {
    totalTimePerLetterRef.current = totalTimePerLetter;
  }, [totalTimePerLetter]);

  useEffect(() => {
    folderNameRef.current = folderName;
  }, [folderName]);

  useEffect(() => {
    wordRef.current = word;
  }, [word]);

  // Start wording mode with custom word
  const startWording = useCallback(async (customWord: string, language: InfoLanguage = 'en') => {
    try {
      console.log('[Wording] Starting wording mode...');

      // If there's an existing active session, stop it first
      if (mode === 'active' || mode === 'complete') {
        console.log('[Wording] Stopping existing session before starting new one');
        stopWording();
      }

      // Create folder name with timestamp
      const timestamp = Date.now();

      // Use custom word
      const wordToUse = customWord.toUpperCase().trim();
      const totalMinutes = 15; // Default time allocation

      console.log(`[Wording] Using word: ${wordToUse}`);

      if (!wordToUse || wordToUse.length === 0) {
        throw new Error('Word cannot be empty');
      }

      // Calculate time per letter (max 60 seconds per letter)
      const calculatedTime = Math.floor((totalMinutes * 60) / wordToUse.length);
      const timePerLetterSeconds = Math.min(calculatedTime, 60); // Cap at 1 minute

      console.log(`[Wording] Word: ${wordToUse}, Time per letter: ${timePerLetterSeconds}s (max 60s)`);

      // Set folder name for this session: WORD_timestamp
      const sessionFolderName = `${wordToUse}_${timestamp}`;
      console.log(`[Wording] Session folder: ${sessionFolderName}`);

      setWord(wordToUse);
      setFolderName(sessionFolderName);
      setTotalTimePerLetter(timePerLetterSeconds);
      setTimeRemaining(timePerLetterSeconds);

      // Initialize letters
      const letterStates: LetterState[] = wordToUse.split('').map((letter, index) => ({
        letter,
        index,
        status: index === 0 ? 'painting' : 'pending'
      }));

      setLetters(letterStates);
      setCurrentLetterIndex(0);
      setMode('active');

      // Start countdown
      startCountdown(timePerLetterSeconds);

    } catch (error) {
      console.error('[Wording] Failed to start:', error);
      throw error;
    }
  }, []);

  const handleLetterExport = useCallback(async () => {
    // CRITICAL: Prevent double exports
    if (isExportingRef.current) {
      console.log('[Wording] ⚠️ Export already in progress, skipping duplicate call');
      return;
    }

    const currentIdx = currentLetterIndexRef.current;
    console.log(`[Wording] Letter ${currentIdx} complete, navigating to Timelapse for export...`);

    // CRITICAL: Capture strokes NOW to pass directly to Timelapse
    // This avoids race conditions with PaintingContext
    const strokes = onGetCurrentStrokesRef.current?.() || [];
    const strokeSnapshot = cloneStrokes(strokes);
    if (strokeSnapshot.length === 0) {
      console.log(`[Wording] ⚠️ No strokes for letter ${currentIdx}, skipping export`);
      return;
    }

    console.log(`[Wording] ✅ Letter ${currentIdx} has ${strokeSnapshot.length} strokes, ready to export`);

    // Mark export as in progress
    isExportingRef.current = true;

    // Update letter status to exporting
    setLetters(prev => {
      const updated = [...prev];
      if (currentIdx >= 0 && currentIdx < updated.length) {
        updated[currentIdx].status = 'exporting';
      }
      return updated;
    });

    // Navigate to Timelapse screen for auto-export with captured strokes
    if (onNavigateToTimelapseRef.current) {
      console.log(`[Wording] 🚀 Navigating to Timelapse for letter ${currentIdx} export with ${strokeSnapshot.length} strokes`);
      onNavigateToTimelapseRef.current(currentIdx, strokeSnapshot);
    } else {
      console.error('[Wording] ❌ onNavigateToTimelapse callback not set!');
      // Reset export flag if navigation fails
      isExportingRef.current = false;
      setLetters(prev => {
        const updated = [...prev];
        if (currentIdx >= 0 && currentIdx < updated.length) {
          updated[currentIdx].status = 'painting';
        }
        return updated;
      });
    }
  }, []);

  const startCountdown = useCallback((initialTime: number) => {
    if (timerRef.current) clearInterval(timerRef.current);

    let remaining = initialTime;
    setTimeRemaining(remaining);

    timerRef.current = setInterval(() => {
      remaining -= 1;
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        void handleLetterExport();
      }
    }, 1000);
  }, [handleLetterExport]);

  /**
   * Calculate optimal export duration from allowed values: 1s, 2s, 4s, 8s, 16s
   * Picks the closest duration that fits the actual painting time
   */
  const calculateExportDuration = (actualPaintingTimeSeconds: number): number => {
    const allowedDurations = [1, 2, 4, 8, 16];

    // Find the closest allowed duration that's >= actual time, or use max if too long
    for (const duration of allowedDurations) {
      if (actualPaintingTimeSeconds <= duration) {
        return duration;
      }
    }

    return 16; // Max duration
  };

  const exportCurrentLetterWithStrokes = async (strokes: Stroke[]): Promise<string> => {
    const currentIdx = currentLetterIndexRef.current;
    const timePerLetter = totalTimePerLetterRef.current;
    const currentFolderName = folderNameRef.current;

    try {
      console.log(`[Wording] Exporting ${strokes.length} strokes for letter ${currentIdx}...`);

      // Create export directory with folder structure: wording/WORD_timestamp/
      const exportDir = `${FileSystem.cacheDirectory}wording/${currentFolderName}/`;
      await FileSystem.makeDirectoryAsync(exportDir, { intermediates: true });

      const exportPath = `${exportDir}letter_${currentIdx}.mov`;

      // Calculate actual painting time (how long user had this letter active)
      const actualPaintingTime = timePerLetter - timeRemaining;

      // FIXED SETTINGS: 5x speed, minimum 1s duration
      const SPEED_MULTIPLIER = 5; // Always use 5x speed
      const MIN_DURATION = 1.0; // Minimum 1 second

      // Calculate base duration at 5x speed
      const baseDuration = actualPaintingTime / SPEED_MULTIPLIER;

      // Ensure minimum 1s duration (if painting was very fast)
      const exportDuration = Math.max(MIN_DURATION, baseDuration);

      // NATIVE TIMELAPSE SETTINGS (like manual export)
      const exportSize = 4096; // 4K quality
      const fps = 30; // 30fps (standard for native timelapse)

      // Get canvas size from PaintScreen
      const canvasSize = onGetCanvasSizeRef.current?.() || exportSize;
      console.log(`[Wording] Canvas size: ${canvasSize}, Export size: ${exportSize}`);

      // Scale strokes from canvas coordinates to export coordinates
      const scaledStrokes = onScaleStrokesRef.current
        ? onScaleStrokesRef.current(strokes, exportSize, canvasSize)
        : strokes;

      console.log(`[Wording] Exporting ${scaledStrokes.length} strokes with NATIVE METAL renderer:`);
      console.log(`  - Actual painting time: ${actualPaintingTime.toFixed(1)}s`);
      console.log(`  - Speed: ${SPEED_MULTIPLIER}x (fixed)`);
      console.log(`  - Export duration: ${exportDuration.toFixed(2)}s`);
      console.log(`  - Canvas size: ${canvasSize}x${canvasSize}`);
      console.log(`  - Export resolution: ${exportSize}x${exportSize}, ${fps}fps`);
      console.log(`  - Total frames: ${Math.round(exportDuration * fps)}`);

      // Export with NATIVE METAL TIMELAPSE (same as manual timelapse export)
      const exportResult = await exportTimelapse(
        scaledStrokes,
        exportSize,
        exportSize,
        fps,
        exportDuration,
        exportDuration, // animationSeconds = actual painting duration for replay
        exportPath
      );

      if (!exportResult.success) {
        throw new Error('Native timelapse export failed');
      }

      console.log(`[Wording] ✅ Letter ${currentIdx} exported to ${exportPath} (${exportDuration.toFixed(2)}s, ${exportResult.frameCount} frames)`);

      // The .mov file IS the preview - it's a video that can be played directly!
      // No need for separate preview generation

      return exportPath;
    } catch (error) {
      console.error(`[Wording] Export failed for letter ${currentIdx}:`, error);
      return '';
    }
  };

  const stitchAllLetters = async (): Promise<void> => {
    try {
      setMode('stitching');
      setExportProgress(0);
      console.log('[Wording] Stitching all letters together...');

      // Collect all export paths (use ref to get latest state)
      const exportPaths = lettersRef.current
        .filter(l => l.exportPath)
        .map(l => l.exportPath!);

      console.log(`[Wording] Found ${exportPaths.length} letter videos to stitch`);

      if (exportPaths.length === 0) {
        console.log('[Wording] No videos to stitch');
        setMode('complete');
        return;
      }

      setExportProgress(20);

      const finalPath = `${FileSystem.cacheDirectory}wording/${folderNameRef.current}/${wordRef.current}_final.mov`;

      // Create concat list file for FFmpeg
      const concatListPath = `${FileSystem.cacheDirectory}wording/concat_list.txt`;
      const concatContent = exportPaths.map(path => `file '${path.replace(/^file:\/\//, '')}'`).join('\n');
      await FileSystem.writeAsStringAsync(concatListPath, concatContent);

      console.log('[Wording] Concat list created, running FFmpeg...');

      setExportProgress(40);

      // Use FFmpeg to concatenate videos
      if (!FFmpegKit) {
        console.warn('[Wording] FFmpeg disabled - stitching not available');
        // Just use the last video as the final output
        const lastPath = exportPaths[exportPaths.length - 1];
        await FileSystem.copyAsync({ from: lastPath, to: finalPath });
        setExportProgress(100);
      } else {
        const command = `-f concat -safe 0 -i ${concatListPath.replace(/^file:\/\//, '')} -c copy ${finalPath.replace(/^file:\/\//, '')}`;
        const session = await FFmpegKit.execute(command);

        setExportProgress(80);

        const returnCode = await session.getReturnCode();

        if (!ReturnCode.isSuccess(returnCode)) {
          const logs = await session.getAllLogsAsString();
          throw new Error(logs || 'FFmpeg concat failed');
        }
        setExportProgress(100);
      }

      console.log(`[Wording] Stitching complete! Final video: ${finalPath}`);

      setExportProgress(100);
      setFinalVideoPath(finalPath);

      // Small delay to show 100% before showing completion overlay
      await new Promise(resolve => setTimeout(resolve, 500));

      setMode('complete');

      // Notify completion
      if (onAllCompleteRef.current) {
        onAllCompleteRef.current(finalPath);
      }
    } catch (error) {
      console.error('[Wording] Stitching failed:', error);
      setMode('complete'); // Still mark complete even if stitching fails
    }
  };

  const proceedToNextLetter = useCallback(() => {
    const currentIdx = currentLetterIndexRef.current;
    const currentLetters = lettersRef.current;
    const timePerLetter = totalTimePerLetterRef.current;

    console.log(`[Wording] Proceeding to next letter after ${currentIdx}`);

    // Hide overlay
    setShowLetterComplete(false);
    setCompletedLetterPath('');

    // Reset Done button for next letter
    setDoneButtonClicked(false);

    // Mark current letter as complete
    setLetters(prev => {
      const updated = [...prev];
      updated[currentIdx].status = 'complete';
      return updated;
    });

    // Move to next letter
    const nextIndex = currentIdx + 1;
    if (nextIndex < currentLetters.length) {
      console.log(`[Wording] Starting letter ${nextIndex}...`);

      setCurrentLetterIndex(nextIndex);
      setLetters(prev => {
        const updated = [...prev];
        updated[nextIndex].status = 'painting';
        return updated;
      });
      // Start countdown for next letter
      startCountdown(timePerLetter);
    } else {
      // All letters done - show completion overlay
      console.log('[Wording] All letters complete, showing completion overlay');

      // Switch to complete mode to show grid overlay
      setMode('complete');
    }
  }, [startCountdown]);

  const finishLetterEarly = useCallback(() => {
    console.log('[Wording] User finished letter early, triggering export');

    // Hide Done button immediately
    setDoneButtonClicked(true);

    // Stop the timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Trigger the same export flow as timeout
    void handleLetterExport();
  }, [handleLetterExport]);

  const onLetterExportComplete = useCallback((letterIndex: number, videoPath: string) => {
    console.log(`[Wording] Letter ${letterIndex} export complete, video at ${videoPath}`);

    // Reset export flag
    isExportingRef.current = false;

    // Clear canvas for next letter
    if (onLetterCompleteRef.current) {
      console.log('[Wording] Clearing canvas for next letter');
      void onLetterCompleteRef.current();
    }

    // Mark as reviewing and show preview
    setLetters(prev => {
      const updated = [...prev];
      if (letterIndex >= 0 && letterIndex < updated.length) {
        updated[letterIndex].status = 'reviewing';
        updated[letterIndex].exportPath = videoPath;
      }
      return updated;
    });

    // Show the letter complete overlay with video preview
    setShowLetterComplete(true);
    setCompletedLetterPath(videoPath);

    console.log(`[Wording] Letter ${letterIndex} ready for review`);
  }, []);

  const exportComposition = useCallback(async () => {
    console.log('[Wording] User requested composition export, stitching...');

    // Switch to stitching mode
    setMode('stitching');
    setShowTransition(true);
    setTransitionMessage('Creating final video...');

    // Start stitching process
    await stitchAllLetters();
  }, []);

  const stopWording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setMode('inactive');
    setWord('');
    setLetters([]);
    setCurrentLetterIndex(0);
    setTimeRemaining(0);
    setShowLetterComplete(false);
    setCompletedLetterPath('');
    console.log('[Wording] Stopped');
  }, []);

  const getCurrentLetter = useCallback(() => {
    if (mode !== 'active' || currentLetterIndex >= letters.length) {
      return null;
    }
    return letters[currentLetterIndex].letter;
  }, [mode, currentLetterIndex, letters]);

  const isWordingActive = useCallback(() => {
    return mode === 'active';
  }, [mode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const value: WordingContextType = {
    mode,
    word,
    letters,
    currentLetterIndex,
    timeRemaining,
    totalTimePerLetter,
    showTransition,
    transitionMessage,
    exportProgress,
    finalVideoPath,
    showLetterComplete,
    completedLetterPath,
    startWording,
    stopWording,
    getCurrentLetter,
    isWordingActive,
    proceedToNextLetter,
    finishLetterEarly,
    exportComposition,
    onLetterExportComplete,
    onLetterComplete: onLetterCompleteRef.current,
    onGetCurrentStrokes: onGetCurrentStrokesRef.current,
    onAllComplete: onAllCompleteRef.current,
    onGetCanvasSize: onGetCanvasSizeRef.current,
    onScaleStrokes: onScaleStrokesRef.current,
    onNavigateToTimelapse: onNavigateToTimelapseRef.current
  };

  // Update refs when callbacks change
  useEffect(() => {
    if (value.onLetterComplete) {
      onLetterCompleteRef.current = value.onLetterComplete;
    }
  }, [value.onLetterComplete]);

  useEffect(() => {
    if (value.onGetCurrentStrokes) {
      onGetCurrentStrokesRef.current = value.onGetCurrentStrokes;
    }
  }, [value.onGetCurrentStrokes]);

  useEffect(() => {
    if (value.onAllComplete) {
      onAllCompleteRef.current = value.onAllComplete;
    }
  }, [value.onAllComplete]);

  useEffect(() => {
    if (value.onGetCanvasSize) {
      onGetCanvasSizeRef.current = value.onGetCanvasSize;
    }
  }, [value.onGetCanvasSize]);

  useEffect(() => {
    if (value.onScaleStrokes) {
      onScaleStrokesRef.current = value.onScaleStrokes;
    }
  }, [value.onScaleStrokes]);

  useEffect(() => {
    if (value.onNavigateToTimelapse) {
      onNavigateToTimelapseRef.current = value.onNavigateToTimelapse;
    }
  }, [value.onNavigateToTimelapse]);

  return <WordingContext.Provider value={value}>{children}</WordingContext.Provider>;
};

export const useWording = () => {
  const context = useContext(WordingContext);
  if (!context) {
    throw new Error('useWording must be used within WordingProvider');
  }
  return context;
};
