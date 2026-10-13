/**
 * Multiplayer Paint Screen
 *
 * Collaborative infinite canvas with tile-based navigation
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Dimensions, Platform, ScrollView, Modal, PanResponder } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { CustomOverlayHelper } from '../components/CustomOverlay';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Slider from '@react-native-community/slider';

import { usePainting } from '../state/PaintingContext';
import type { Stroke } from '../state/PaintingContext';
import PaintCanvas from '../workspace/PaintCanvas';
import { MultiplayerClient, checkServerHealth, type TileStrokes, type MultiplayerStats } from './multiplayerClient';
import type { RootStackParamList } from '../App';
import { markProfileLevelAchievement } from '../lib/profileLevelAchievements';
import { recordLifetimeStrokeCommit } from '../lib/lifetimeStats';
import { useLifetimeActivity } from '../lib/useLifetimeActivity';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const CANVAS_SIZE = 512;
const STORAGE_KEY = '@multiplayer_strokes';

// Save strokes to AsyncStorage
async function saveStrokes(strokesMap: Map<string, Stroke[]>): Promise<void> {
  try {
    const data: Record<string, Stroke[]> = {};
    strokesMap.forEach((strokes, key) => {
      data[key] = strokes;
    });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    console.log('[MultiPaint] Saved', strokesMap.size, 'tiles to storage');
  } catch (error) {
    console.error('[MultiPaint] Failed to save strokes:', error);
  }
}

// Load strokes from AsyncStorage
async function loadStrokes(): Promise<Map<string, Stroke[]>> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (json) {
      const data: Record<string, Stroke[]> = JSON.parse(json);
      const map = new Map<string, Stroke[]>();
      Object.entries(data).forEach(([key, strokes]) => {
        map.set(key, strokes);
      });
      console.log('[MultiPaint] Loaded', map.size, 'tiles from storage');
      return map;
    }
  } catch (error) {
    console.error('[MultiPaint] Failed to load strokes:', error);
  }
  return new Map();
}

// Common emojis for picker
const EMOJI_CATEGORIES = [
  ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃'],
  ['😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙'],
  ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖'],
  ['⭐', '🌟', '✨', '💫', '🔥', '💥', '💢', '💦', '💨', '🌈'],
  ['🌸', '🌺', '🌻', '🌷', '🌹', '🏵️', '🌼', '🥀', '🌾', '🍀'],
  ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯'],
  ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍈', '🍒', '🍑'],
  ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸']
];

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'MultiPaint'>;

export default function MultiPaintScreen() {
  useLifetimeActivity('multipaint');
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();

  const {
    strokes,
    commitStroke,
    brushSize,
    brushEmoji,
    brushSpacing,
    brushRotation,
    brushOpacity,
    mirrorX,
    mirrorY,
    dispatch
  } = usePainting();

  // Multiplayer state
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [stats, setStats] = useState<MultiplayerStats>({ activeUsers: 1, totalStrokes: 0 });
  const [viewportStrokes, setViewportStrokes] = useState<Stroke[]>([]);
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null);
  const [currentTile, setCurrentTile] = useState({ x: 0, y: 0 });

  // Track all strokes from all visited tiles (persistent)
  const [allLoadedStrokes, setAllLoadedStrokes] = useState<Map<string, Stroke[]>>(new Map());

  // UI state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const [localBrushSize, setLocalBrushSize] = useState(brushSize);
  const [localBrushOpacity] = useState(1.0); // Always 100% opacity
  const [localBrushEmoji, setLocalBrushEmoji] = useState(brushEmoji);

  // Camera position for smooth movement (in pixels within current tile)
  const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });

  // Activity tracking state
  const [inactivityCountdown, setInactivityCountdown] = useState<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const inactivityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs
  const clientRef = useRef<MultiplayerClient | null>(null);
  const profileLevelStrokeMarkedRef = useRef(false);
  const liveStrokeRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const moveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load strokes from storage on mount
  useEffect(() => {
    loadStrokes().then(loadedStrokes => {
      if (loadedStrokes.size > 0) {
        setAllLoadedStrokes(loadedStrokes);
      }
    });
  }, []);

  // Save strokes whenever they change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (allLoadedStrokes.size > 0) {
        saveStrokes(allLoadedStrokes);
      }
    }, 1000); // Debounce saves by 1 second

    return () => clearTimeout(timer);
  }, [allLoadedStrokes]);

  // Activity tracking - update last activity time
  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setInactivityCountdown(null); // Hide countdown

    // Send activity heartbeat to server
    if (clientRef.current?.isConnected()) {
      clientRef.current.sendActivity();
    }
  }, []);

  // Inactivity timer - check every 500ms
  useEffect(() => {
    if (!connected && !offlineMode) {
      return; // Don't run timer if not in multiplayer
    }

    inactivityTimerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastActivityRef.current) / 1000; // seconds

      if (elapsed >= 15) {
        // 15 seconds of inactivity - disconnect silently and go back to Paint
        console.log('[MultiPaint] User inactive for 15s, disconnecting...');
        setInactivityCountdown(null);

        // Disconnect and go back to Paint screen
        if (clientRef.current) {
          clientRef.current.disconnect();
          clientRef.current = null;
        }

        // Go back to Paint screen WITHOUT showing alert
        navigation.goBack();
      } else if (elapsed >= 10) {
        // Show countdown for last 5 seconds
        const countdown = Math.ceil(15 - elapsed);
        setInactivityCountdown(countdown);
      } else {
        // Silent period (first 10 seconds)
        setInactivityCountdown(null);
      }
    }, 500);

    return () => {
      if (inactivityTimerRef.current) {
        clearInterval(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [connected, offlineMode, navigation]);

  // Initialize multiplayer client
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const initializeConnection = async () => {
      // First, check if server is available
      console.log('[MultiPaint] Checking server availability...');
      const isServerOnline = await checkServerHealth();

      if (!isServerOnline) {
        // Server is offline
        console.log('[MultiPaint] Server is OFFLINE');
        setConnecting(false);
        setConnectionError('Server is offline');

        CustomOverlayHelper.show({
          title: 'Server Offline',
          message: 'Multiplayer server is currently offline. Would you like to use offline mode for local testing?',
          buttons: [
            { text: 'Go Back', style: 'cancel', onPress: () => navigation.goBack() },
            {
              text: 'Offline Mode',
              onPress: () => {
                setOfflineMode(true);
                setConnected(false);
                console.log('[MultiPaint] Entering offline mode');
              }
            }
          ]
        });
        return;
      }

      // Server is online, try to connect
      console.log('[MultiPaint] Server is ONLINE, connecting...');
      const client = new MultiplayerClient();
      clientRef.current = client;

      // Subscribe to messages
      unsubscribe = client.onMessage((message) => {
        switch (message.type) {
          case 'viewport':
            // Load viewport strokes and merge with existing local strokes
            setAllLoadedStrokes(prev => {
              const merged = new Map(prev);

              message.strokes.forEach((tileData: TileStrokes) => {
                const tileKey = `${tileData.tileX},${tileData.tileY}`;
                const existingStrokes = merged.get(tileKey) || [];

                // Merge server strokes with local strokes (deduplicate by stroke ID)
                const existingIds = new Set(existingStrokes.map(s => s.id));
                const newStrokes = tileData.strokes.filter(s => !existingIds.has(s.id));

                merged.set(tileKey, [...existingStrokes, ...newStrokes]);
              });

              return merged;
            });

            console.log('[MultiPaint] Loaded viewport:', message.strokes.length, 'tiles');
            break;

          case 'stroke':
            // New stroke from another user - add to appropriate tile
            if (message.userId !== client.clientId) {
              const tileKey = `${message.tileX},${message.tileY}`;
              setAllLoadedStrokes(prev => {
                const merged = new Map(prev);
                const existingStrokes = merged.get(tileKey) || [];
                merged.set(tileKey, [...existingStrokes, message.stroke]);
                return merged;
              });
              console.log('[MultiPaint] Received stroke from', message.userId);
            }
            break;

          case 'stats':
            // Update stats
            setStats({
              activeUsers: message.activeUsers,
              totalStrokes: message.totalStrokes
            });
            break;
        }
      });

      client.connect()
        .then(() => {
          setConnected(true);
          setConnecting(false);
          setOfflineMode(false);
          setConnectionError(null);
          setCurrentTile({ x: client.currentTile.x, y: client.currentTile.y });
          console.log('[MultiPaint] ✅ Connected to server');
          console.log('[MultiPaint] 🎨 Loaded tiles around spawn point');

          // Reset activity timer on successful connection
          lastActivityRef.current = Date.now();
        })
        .catch((error) => {
          console.error('[MultiPaint] Connection failed despite server being online:', error);
          setConnecting(false);
          setConnectionError('Connection failed');

          CustomOverlayHelper.show({
            title: 'Connection Failed',
            message: 'Server is online but connection failed. Try offline mode?',
            buttons: [
              { text: 'Go Back', style: 'cancel', onPress: () => navigation.goBack() },
              {
                text: 'Offline Mode',
                onPress: () => {
                  setOfflineMode(true);
                  setConnected(false);
                }
              }
            ]
          });
        });
    };

    initializeConnection();

    // Cleanup
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, [navigation]);

  // Helper to stop ongoing movement
  const stopMovement = useCallback(() => {
    if (moveIntervalRef.current) {
      clearInterval(moveIntervalRef.current);
      moveIntervalRef.current = null;
    }
  }, []);

  // Helper to start continuous movement
  const startMovement = useCallback((moveFunction: () => void) => {
    stopMovement();
    moveFunction(); // Execute immediately
    moveIntervalRef.current = setInterval(moveFunction, 100); // Then repeat every 100ms
  }, [stopMovement]);

  // Navigation handlers - smooth 20px movement
  const moveUp = useCallback(() => {
    updateActivity(); // Reset inactivity timer

    const newY = cameraOffset.y - 20;
    // Check if we need to change tiles
    if (newY < -CANVAS_SIZE / 2 && currentTile.y > -16) {
      // Move to previous tile
      const newTileY = currentTile.y - 1;
      setCurrentTile({ x: currentTile.x, y: newTileY });
      setCameraOffset({ x: cameraOffset.x, y: CANVAS_SIZE / 2 - 20 });
      console.log(`[MultiPaint] 📍 New tile loaded (${currentTile.x}, ${newTileY})`);
      if (clientRef.current?.isConnected()) {
        clientRef.current.moveTo(currentTile.x, newTileY);
      } else if (offlineMode) {
        setViewportStrokes([]);
      }
    } else {
      // Stay in bounds
      setCameraOffset({ x: cameraOffset.x, y: Math.max(newY, -CANVAS_SIZE / 2) });
    }
  }, [currentTile, cameraOffset, offlineMode, updateActivity]);

  const moveDown = useCallback(() => {
    updateActivity(); // Reset inactivity timer

    const newY = cameraOffset.y + 20;
    // Check if we need to change tiles
    if (newY > CANVAS_SIZE / 2 && currentTile.y < 15) {
      // Move to next tile
      const newTileY = currentTile.y + 1;
      setCurrentTile({ x: currentTile.x, y: newTileY });
      setCameraOffset({ x: cameraOffset.x, y: -CANVAS_SIZE / 2 + 20 });
      console.log(`[MultiPaint] 📍 New tile loaded (${currentTile.x}, ${newTileY})`);
      if (clientRef.current?.isConnected()) {
        clientRef.current.moveTo(currentTile.x, newTileY);
      } else if (offlineMode) {
        setViewportStrokes([]);
      }
    } else {
      // Stay in bounds
      setCameraOffset({ x: cameraOffset.x, y: Math.min(newY, CANVAS_SIZE / 2) });
    }
  }, [currentTile, cameraOffset, offlineMode, updateActivity]);

  const moveLeft = useCallback(() => {
    updateActivity(); // Reset inactivity timer

    const newX = cameraOffset.x - 20;
    // Check if we need to change tiles
    if (newX < -CANVAS_SIZE / 2 && currentTile.x > -16) {
      // Move to previous tile
      const newTileX = currentTile.x - 1;
      setCurrentTile({ x: newTileX, y: currentTile.y });
      setCameraOffset({ x: CANVAS_SIZE / 2 - 20, y: cameraOffset.y });
      console.log(`[MultiPaint] 📍 New tile loaded (${newTileX}, ${currentTile.y})`);
      if (clientRef.current?.isConnected()) {
        clientRef.current.moveTo(newTileX, currentTile.y);
      } else if (offlineMode) {
        setViewportStrokes([]);
      }
    } else {
      // Stay in bounds
      setCameraOffset({ x: Math.max(newX, -CANVAS_SIZE / 2), y: cameraOffset.y });
    }
  }, [currentTile, cameraOffset, offlineMode, updateActivity]);

  const moveRight = useCallback(() => {
    updateActivity(); // Reset inactivity timer

    const newX = cameraOffset.x + 20;
    // Check if we need to change tiles
    if (newX > CANVAS_SIZE / 2 && currentTile.x < 15) {
      // Move to next tile
      const newTileX = currentTile.x + 1;
      setCurrentTile({ x: newTileX, y: currentTile.y });
      setCameraOffset({ x: -CANVAS_SIZE / 2 + 20, y: cameraOffset.y });
      console.log(`[MultiPaint] 📍 New tile loaded (${newTileX}, ${currentTile.y})`);
      if (clientRef.current?.isConnected()) {
        clientRef.current.moveTo(newTileX, currentTile.y);
      } else if (offlineMode) {
        setViewportStrokes([]);
      }
    } else {
      // Stay in bounds
      setCameraOffset({ x: Math.min(newX, CANVAS_SIZE / 2), y: cameraOffset.y });
    }
  }, [currentTile, cameraOffset, offlineMode, updateActivity]);

  // Update viewportStrokes whenever allLoadedStrokes or currentTile changes
  useEffect(() => {
    const allStrokes: Stroke[] = [];
    let totalStrokesProcessed = 0;

    allLoadedStrokes.forEach((strokes, tileKey) => {
      // Parse tile coordinates from key "x,y"
      const [tileX, tileY] = tileKey.split(',').map(Number);

      // Calculate offset from current tile to world grid position in 3x3 viewport
      // The 3x3 grid: tiles are arranged as [-1,-1] to [+1,+1] relative to current tile
      // Each tile is CANVAS_SIZE (512px)
      // Current tile (0,0) is at position (1*512, 1*512) = (512, 512) in the 3x3 grid
      const offsetX = (tileX - currentTile.x + 1) * CANVAS_SIZE;
      const offsetY = (tileY - currentTile.y + 1) * CANVAS_SIZE;

      // Transform strokes to 3x3 viewport coordinates
      const transformedStrokes = strokes.map(stroke => ({
        ...stroke,
        points: stroke.points.map(point => ({
          ...point,
          x: point.x + offsetX,
          y: point.y + offsetY
        }))
      }));

      allStrokes.push(...transformedStrokes);
      totalStrokesProcessed += strokes.length;

      console.log(`[MultiPaint] Tile (${tileX},${tileY}): ${strokes.length} strokes, offset (${offsetX}, ${offsetY})`);
    });

    console.log(`[MultiPaint] 🎨 Rendering ${totalStrokesProcessed} strokes across ${allLoadedStrokes.size} tiles`);
    setViewportStrokes(allStrokes);
  }, [allLoadedStrokes, currentTile]);

  // Sync local brush settings with global context
  useEffect(() => {
    dispatch({ type: 'SET_BRUSH_SIZE', size: localBrushSize });
  }, [localBrushSize, dispatch]);

  useEffect(() => {
    dispatch({ type: 'SET_BRUSH_OPACITY', opacity: 1.0 }); // Always 100%
  }, [dispatch]);

  useEffect(() => {
    dispatch({ type: 'SET_BRUSH_EMOJI', emoji: localBrushEmoji });
  }, [localBrushEmoji, dispatch]);

  // Handle stroke commit
  const handleStrokeCommit = useCallback((stroke: Stroke) => {
    updateActivity(); // Reset inactivity timer
    void recordLifetimeStrokeCommit({
      eventId: `multipaint:${stroke.id}`,
      workspace: 'multipaint',
    });
    if (!profileLevelStrokeMarkedRef.current) {
      profileLevelStrokeMarkedRef.current = true;
      markProfileLevelAchievement('first_multipaint_stroke').catch(() => undefined);
    }

    // Add to allLoadedStrokes for current tile
    const tileKey = `${currentTile.x},${currentTile.y}`;
    console.log(`[MultiPaint] 🖌️ Committing stroke ${stroke.id} to tile (${currentTile.x},${currentTile.y}), ${stroke.points.length} points`);

    setAllLoadedStrokes(prev => {
      const merged = new Map(prev);
      const existingStrokes = merged.get(tileKey) || [];
      const newStrokes = [...existingStrokes, stroke];
      merged.set(tileKey, newStrokes);
      console.log(`[MultiPaint] Tile (${currentTile.x},${currentTile.y}) now has ${newStrokes.length} strokes`);
      return merged;
    });

    setStats(prev => ({ ...prev, totalStrokes: prev.totalStrokes + 1 }));
    setLiveStroke(null);

    // Send to server if connected
    if (clientRef.current?.isConnected()) {
      console.log(`[MultiPaint] 📤 Sending stroke to server`);
      clientRef.current.sendStroke(stroke);
    }
  }, [currentTile, updateActivity]);

  // Handle emoji selection
  const handleEmojiSelect = useCallback((emoji: string) => {
    setLocalBrushEmoji(emoji);
    setShowEmojiPicker(false);
  }, []);

  // Drawing PanResponder
  const canvasPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const { locationX, locationY } = event.nativeEvent;

        // Normalize coordinates to current tile (subtract offset for middle tile in 3x3 grid)
        const normalizedX = locationX - CANVAS_SIZE;
        const normalizedY = locationY - CANVAS_SIZE;

        // Start new stroke
        const newStroke: Stroke = {
          id: `${Date.now()}_${Math.random()}`,
          emoji: localBrushEmoji,
          size: localBrushSize,
          opacity: localBrushOpacity,
          points: [{ x: normalizedX, y: normalizedY, t: Date.now() }],
          rotation: brushRotation,
          mirrorX: mirrorX,
          mirrorY: mirrorY
        };

        liveStrokeRef.current = newStroke;
        setLiveStroke(newStroke);
        drawingRef.current = true;
        lastPointRef.current = { x: normalizedX, y: normalizedY, t: Date.now() };
      },
      onPanResponderMove: (event) => {
        if (!drawingRef.current || !liveStrokeRef.current) return;

        const { locationX, locationY } = event.nativeEvent;
        const now = Date.now();

        // Normalize coordinates to current tile
        const normalizedX = locationX - CANVAS_SIZE;
        const normalizedY = locationY - CANVAS_SIZE;

        // Apply same spacing as normal painter
        if (lastPointRef.current) {
          const dx = normalizedX - lastPointRef.current.x;
          const dy = normalizedY - lastPointRef.current.y;
          const distance = Math.hypot(dx, dy);

          // Use exact same spacing as normal painter
          if (distance < localBrushSize * 0.3) {
            return; // Too close, skip this point
          }
        }

        // Add point to live stroke
        liveStrokeRef.current.points.push({ x: normalizedX, y: normalizedY, t: now });
        setLiveStroke({ ...liveStrokeRef.current });
        lastPointRef.current = { x: normalizedX, y: normalizedY, t: now };
      },
      onPanResponderRelease: () => {
        if (drawingRef.current && liveStrokeRef.current) {
          // Commit the stroke
          const completedStroke = liveStrokeRef.current;
          if (completedStroke.points.length > 0) {
            handleStrokeCommit(completedStroke);
          }
        }

        drawingRef.current = false;
        liveStrokeRef.current = null;
        setLiveStroke(null);
        lastPointRef.current = null;
      },
      onPanResponderTerminate: () => {
        drawingRef.current = false;
        liveStrokeRef.current = null;
        setLiveStroke(null);
        lastPointRef.current = null;
      }
    })
  ).current;

  // Close handler
  const handleClose = useCallback(() => {
    // Disconnect from multiplayer server
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    // Stop any ongoing movement
    stopMovement();
    // Navigate back
    navigation.goBack();
  }, [navigation, stopMovement]);

  // Loading state
  if (connecting) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#ff9f6b" />
        <Text style={styles.loadingText}>Connecting to multiplayer...</Text>
      </View>
    );
  }

  // Not connected but not in offline mode
  if (!connected && !offlineMode) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.errorText}>Connection Failed</Text>
        <Text style={styles.errorSubtext}>{connectionError || 'Could not connect to server'}</Text>
        <TouchableOpacity style={styles.button} onPress={handleClose}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
          <Text style={styles.closeButtonText}>×</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {offlineMode ? 'Offline Mode' : 'Multiplayer Canvas'}
          </Text>
          <Text style={styles.headerSubtitle}>
            Tile ({currentTile.x}, {currentTile.y}) {offlineMode ? '(Local)' : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.infoButton} onPress={() => setShowInfo(true)}>
          <Text style={styles.infoButtonText}>ℹ️</Text>
        </TouchableOpacity>
      </View>

      {/* Canvas with Grid Overlay */}
      <View style={styles.canvasContainer}>
        <View
          style={{
            width: CANVAS_SIZE * 3, // 3x3 tiles viewport
            height: CANVAS_SIZE * 3,
            transform: [
              { translateX: -cameraOffset.x - CANVAS_SIZE }, // Center current tile
              { translateY: -cameraOffset.y - CANVAS_SIZE }
            ]
          }}
          {...canvasPanResponder.panHandlers}
        >
          <PaintCanvas
            width={CANVAS_SIZE * 3}
            height={CANVAS_SIZE * 3}
            strokes={viewportStrokes}
            liveStroke={liveStroke ? {
              ...liveStroke,
              points: liveStroke.points.map(point => ({
                ...point,
                x: point.x + CANVAS_SIZE, // Transform to center tile position
                y: point.y + CANVAS_SIZE
              }))
            } : null}
            key={`canvas-${viewportStrokes.length}`}
          />
          {/* Grid Overlay - 8x8 grid repeated for each tile */}
          <View style={styles.gridOverlay} pointerEvents="none">
            {/* Draw grid for 3x3 tiles */}
            {[-1, 0, 1].map(tileOffsetY => (
              [-1, 0, 1].map(tileOffsetX => (
                <React.Fragment key={`tile-${tileOffsetX}-${tileOffsetY}`}>
                  {/* Vertical lines - 8 columns per tile */}
                  {[...Array(9)].map((_, i) => (
                    <View
                      key={`v-${tileOffsetX}-${tileOffsetY}-${i}`}
                      style={[
                        styles.gridLine,
                        {
                          left: (tileOffsetX + 1) * CANVAS_SIZE + (CANVAS_SIZE / 8) * i - 0.5,
                          width: i === 0 || i === 8 || i === 4 ? 1.5 : 0.5,
                          height: CANVAS_SIZE,
                          top: (tileOffsetY + 1) * CANVAS_SIZE,
                          opacity: i === 0 || i === 8 || i === 4 ? 0.5 : 0.3
                        }
                      ]}
                    />
                  ))}
                  {/* Horizontal lines - 8 rows per tile */}
                  {[...Array(9)].map((_, i) => (
                    <View
                      key={`h-${tileOffsetX}-${tileOffsetY}-${i}`}
                      style={[
                        styles.gridLine,
                        {
                          top: (tileOffsetY + 1) * CANVAS_SIZE + (CANVAS_SIZE / 8) * i - 0.5,
                          height: i === 0 || i === 8 || i === 4 ? 1.5 : 0.5,
                          width: CANVAS_SIZE,
                          left: (tileOffsetX + 1) * CANVAS_SIZE,
                          opacity: i === 0 || i === 8 || i === 4 ? 0.5 : 0.3
                        }
                      ]}
                    />
                  ))}
                </React.Fragment>
              ))
            ))}
          </View>
        </View>
      </View>

      {/* Stats Overlay */}
      <View style={[styles.statsOverlay, { top: insets.top + 80 }]}>
        <View style={styles.statItem}>
          <Text style={styles.statIcon}>👥</Text>
          <Text style={styles.statValue}>{stats.activeUsers}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statIcon}>🎨</Text>
          <Text style={styles.statValue}>{stats.totalStrokes.toLocaleString()}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statIcon}>📍</Text>
          <Text style={styles.statValue}>{viewportStrokes.length}</Text>
        </View>
      </View>

      {/* Navigation Arrows */}
      <View style={styles.navigationContainer}>
        <TouchableOpacity
          style={[styles.navButton, styles.navButtonUp]}
          onPressIn={() => startMovement(moveUp)}
          onPressOut={stopMovement}
        >
          <Text style={styles.navArrow}>⬆️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navButton, styles.navButtonDown]}
          onPressIn={() => startMovement(moveDown)}
          onPressOut={stopMovement}
        >
          <Text style={styles.navArrow}>⬇️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navButton, styles.navButtonLeft]}
          onPressIn={() => startMovement(moveLeft)}
          onPressOut={stopMovement}
        >
          <Text style={styles.navArrow}>⬅️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navButton, styles.navButtonRight]}
          onPressIn={() => startMovement(moveRight)}
          onPressOut={stopMovement}
        >
          <Text style={styles.navArrow}>➡️</Text>
        </TouchableOpacity>
      </View>

      {/* Paint Controls - Bottom - Single Row */}
      <View style={[styles.controlsContainer, { paddingBottom: insets.bottom + 12 }]}>
        {/* Emoji Picker Button */}
        <TouchableOpacity
          style={styles.emojiPickerButton}
          onPress={() => setShowEmojiPicker(true)}
        >
          <Text style={styles.emojiPickerEmoji}>{localBrushEmoji}</Text>
        </TouchableOpacity>

        {/* Brush Size Slider */}
        <View style={styles.sliderContainer}>
          <Slider
            style={styles.slider}
            minimumValue={10}
            maximumValue={120}
            step={1}
            value={localBrushSize}
            onValueChange={(value) => {
              setLocalBrushSize(value);
              updateActivity(); // Reset inactivity timer
            }}
            minimumTrackTintColor="#ff9f6b"
            maximumTrackTintColor="#333"
            thumbTintColor="#ff9f6b"
          />
          <Text style={styles.sliderValue}>{Math.round(localBrushSize)}</Text>
        </View>
      </View>

      {/* Emoji Picker Modal */}
      <Modal
        visible={showEmojiPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowEmojiPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.emojiPickerModal}>
            <View style={styles.emojiPickerHeader}>
              <Text style={styles.emojiPickerTitle}>Select Emoji</Text>
              <TouchableOpacity onPress={() => setShowEmojiPicker(false)}>
                <Text style={styles.emojiPickerClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.emojiGrid}>
              {EMOJI_CATEGORIES.flat().map((emoji, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.emojiButton}
                  onPress={() => handleEmojiSelect(emoji)}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Info Modal */}
      <Modal
        visible={showInfo}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowInfo(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.infoModal}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>Multiplayer Info</Text>
              <TouchableOpacity onPress={() => setShowInfo(false)}>
                <Text style={styles.infoClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.infoContent}>
              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>Connection</Text>
                <Text style={styles.infoText}>
                  Status: {offlineMode ? '🔴 Offline' : connected ? '🟢 Online' : '🟡 Connecting'}
                </Text>
                {clientRef.current?.clientId && (
                  <Text style={styles.infoText}>ID: {clientRef.current.clientId.substring(0, 20)}...</Text>
                )}
              </View>

              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>Statistics</Text>
                <Text style={styles.infoText}>Active Users: {stats.activeUsers}</Text>
                <Text style={styles.infoText}>Total Strokes: {stats.totalStrokes.toLocaleString()}</Text>
                <Text style={styles.infoText}>Current Tile: ({currentTile.x}, {currentTile.y})</Text>
                <Text style={styles.infoText}>Viewport Strokes: {viewportStrokes.length}</Text>
              </View>

              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>Canvas Info</Text>
                <Text style={styles.infoText}>Total Tiles: 1,024 (32×32 grid)</Text>
                <Text style={styles.infoText}>Tile Range: -16 to +15 on each axis</Text>
                <Text style={styles.infoText}>Tile Size: 512×512 pixels</Text>
              </View>

              {/* Mini Map */}
              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>Mini Map</Text>
                <TouchableOpacity onPress={() => setShowFullscreenMap(true)} activeOpacity={0.8}>
                  <View style={styles.miniMap}>
                  {/* Render 32x32 grid */}
                  {[...Array(32)].map((_, row) => (
                    <View key={row} style={styles.miniMapRow}>
                      {[...Array(32)].map((_, col) => {
                        // Convert grid position to tile coordinates (-16 to +15)
                        const tileX = col - 16;
                        const tileY = row - 16;
                        const tileKey = `${tileX},${tileY}`;
                        const isVisited = allLoadedStrokes.has(tileKey);
                        const isCurrent = tileX === currentTile.x && tileY === currentTile.y;
                        const hasStrokes = isVisited && (allLoadedStrokes.get(tileKey)?.length || 0) > 0;

                        return (
                          <View
                            key={col}
                            style={[
                              styles.miniMapTile,
                              isCurrent && styles.miniMapTileCurrent,
                              hasStrokes && !isCurrent && styles.miniMapTileVisited
                            ]}
                          />
                        );
                      })}
                    </View>
                  ))}
                  </View>
                  <Text style={{ color: '#666', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
                    Tap to view fullscreen
                  </Text>
                </TouchableOpacity>
                <View style={styles.miniMapLegend}>
                  <View style={styles.miniMapLegendItem}>
                    <View style={[styles.miniMapTile, styles.miniMapTileCurrent]} />
                    <Text style={styles.miniMapLegendText}>Current Position</Text>
                  </View>
                  <View style={styles.miniMapLegendItem}>
                    <View style={[styles.miniMapTile, styles.miniMapTileVisited]} />
                    <Text style={styles.miniMapLegendText}>Visited Tiles</Text>
                  </View>
                  <View style={styles.miniMapLegendItem}>
                    <View style={styles.miniMapTile} />
                    <Text style={styles.miniMapLegendText}>Unexplored</Text>
                  </View>
                </View>
              </View>

              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>Controls</Text>
                <Text style={styles.infoText}>• Use arrows to navigate tiles</Text>
                <Text style={styles.infoText}>• Draw with your finger on canvas</Text>
                <Text style={styles.infoText}>• Adjust size & opacity sliders</Text>
                <Text style={styles.infoText}>• Tap emoji to change brush</Text>
                <Text style={styles.infoText}>• Grid lines show tile boundaries</Text>
              </View>

              <TouchableOpacity
                style={styles.leaveButton}
                onPress={() => {
                  setShowInfo(false);
                  handleClose();
                }}
              >
                <Text style={styles.leaveButtonText}>Leave Multiplayer</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Fullscreen Mini Map Modal */}
      <Modal
        visible={showFullscreenMap}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFullscreenMap(false)}
      >
        <View style={styles.fullscreenMapOverlay}>
          <View style={styles.fullscreenMapContainer}>
            <View style={styles.fullscreenMapHeader}>
              <Text style={styles.fullscreenMapTitle}>World Map</Text>
              <TouchableOpacity onPress={() => setShowFullscreenMap(false)}>
                <Text style={styles.fullscreenMapClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              minimumZoomScale={1}
              maximumZoomScale={3}
              bounces={true}
              bouncesZoom={true}
              style={styles.fullscreenMapScroll}
            >
              <View style={styles.fullscreenMapGrid}>
                {[...Array(32)].map((_, row) => (
                  <View key={row} style={styles.fullscreenMapRow}>
                    {[...Array(32)].map((_, col) => {
                      const tileX = col - 16;
                      const tileY = row - 16;
                      const tileKey = `${tileX},${tileY}`;
                      const isVisited = allLoadedStrokes.has(tileKey);
                      const isCurrent = tileX === currentTile.x && tileY === currentTile.y;
                      const hasStrokes = isVisited && (allLoadedStrokes.get(tileKey)?.length || 0) > 0;

                      return (
                        <TouchableOpacity
                          key={col}
                          style={[
                            styles.fullscreenMapTile,
                            isCurrent && styles.fullscreenMapTileCurrent,
                            hasStrokes && !isCurrent && styles.fullscreenMapTileVisited
                          ]}
                          onPress={() => {
                            // Navigate to this tile
                            setCurrentTile({ x: tileX, y: tileY });
                            if (clientRef.current?.isConnected()) {
                              clientRef.current.moveTo(tileX, tileY);
                            }
                            setShowFullscreenMap(false);
                            setShowInfo(false);
                          }}
                        >
                          {hasStrokes && (
                            <Text style={styles.fullscreenMapTileStrokeCount}>
                              {allLoadedStrokes.get(tileKey)?.length}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
            <View style={styles.fullscreenMapLegend}>
              <View style={styles.miniMapLegendItem}>
                <View style={[styles.fullscreenMapTile, styles.fullscreenMapTileCurrent, { width: 16, height: 16 }]} />
                <Text style={styles.miniMapLegendText}>Current</Text>
              </View>
              <View style={styles.miniMapLegendItem}>
                <View style={[styles.fullscreenMapTile, styles.fullscreenMapTileVisited, { width: 16, height: 16 }]} />
                <Text style={styles.miniMapLegendText}>Has Strokes</Text>
              </View>
              <View style={styles.miniMapLegendItem}>
                <View style={[styles.fullscreenMapTile, { width: 16, height: 16 }]} />
                <Text style={styles.miniMapLegendText}>Empty</Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Inactivity Countdown Overlay */}
      {inactivityCountdown !== null && (
        <TouchableOpacity
          style={styles.countdownOverlay}
          activeOpacity={0.9}
          onPress={() => {
            // Reset activity timer and hide countdown
            updateActivity();
            setInactivityCountdown(null);
          }}
        >
          <Text style={styles.countdownNumber}>{inactivityCountdown}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000'
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    zIndex: 1000,
    elevation: 1000
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '300'
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center'
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600'
  },
  headerSubtitle: {
    color: '#888',
    fontSize: 12,
    marginTop: 2
  },
  headerRight: {
    width: 40
  },
  infoButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center'
  },
  infoButtonText: {
    fontSize: 24
  },
  statsOverlay: {
    position: 'absolute',
    left: 16,
    flexDirection: 'row',
    gap: 12,
    zIndex: 10
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333'
  },
  statIcon: {
    fontSize: 16,
    marginRight: 6
  },
  statValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600'
  },
  canvasContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  navigationContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'box-none'
  },
  navButton: {
    position: 'absolute',
    width: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center'
  },
  navButtonUp: {
    top: '20%',
    left: '50%',
    marginLeft: -11
  },
  navButtonDown: {
    bottom: '20%',
    left: '50%',
    marginLeft: -11
  },
  navButtonLeft: {
    top: '50%',
    left: 8,
    marginTop: -11
  },
  navButtonRight: {
    top: '50%',
    right: 8,
    marginTop: -11
  },
  navArrow: {
    fontSize: 20
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 18,
    marginBottom: 8
  },
  errorSubtext: {
    color: '#888',
    fontSize: 14,
    marginBottom: 24
  },
  button: {
    backgroundColor: '#ff9f6b',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  gridOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: CANVAS_SIZE,
    height: CANVAS_SIZE
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 159, 107, 0.3)'
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  sliderContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  slider: {
    flex: 1,
    height: 40
  },
  sliderValue: {
    color: '#fff',
    fontSize: 14,
    width: 40,
    textAlign: 'right',
    fontWeight: '600'
  },
  emojiPickerButton: {
    width: 60,
    height: 60,
    backgroundColor: 'rgba(255,159,107,0.2)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff9f6b',
    alignItems: 'center',
    justifyContent: 'center'
  },
  emojiPickerEmoji: {
    fontSize: 36
  },
  opacityButton: {
    width: 60,
    height: 60,
    backgroundColor: 'rgba(255,159,107,0.2)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff9f6b',
    alignItems: 'center',
    justifyContent: 'center'
  },
  opacityButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  emojiPickerModal: {
    width: '90%',
    maxHeight: '70%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden'
  },
  emojiPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333'
  },
  emojiPickerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600'
  },
  emojiPickerClose: {
    color: '#fff',
    fontSize: 24,
    padding: 4
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8
  },
  emojiButton: {
    width: '12.5%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4
  },
  emojiText: {
    fontSize: 32
  },
  infoModal: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden'
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333'
  },
  infoTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600'
  },
  infoClose: {
    color: '#fff',
    fontSize: 28,
    padding: 4
  },
  infoContent: {
    padding: 16
  },
  infoSection: {
    marginBottom: 24
  },
  infoSectionTitle: {
    color: '#ff9f6b',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8
  },
  infoText: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4
  },
  leaveButton: {
    backgroundColor: '#ff6b6b',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8
  },
  leaveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  miniMap: {
    width: 256,
    height: 256,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8
  },
  miniMapRow: {
    flexDirection: 'row',
    height: 8
  },
  miniMapTile: {
    width: 8,
    height: 8,
    backgroundColor: '#1a1a1a',
    borderWidth: 0.5,
    borderColor: '#222'
  },
  miniMapTileCurrent: {
    backgroundColor: '#ff9f6b',
    borderColor: '#ffa500'
  },
  miniMapTileVisited: {
    backgroundColor: '#2a4a2a',
    borderColor: '#3a5a3a'
  },
  miniMapLegend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
    paddingHorizontal: 8
  },
  miniMapLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  miniMapLegendText: {
    color: '#999',
    fontSize: 10
  },
  fullscreenMapOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  fullscreenMapContainer: {
    width: '95%',
    height: '90%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden'
  },
  fullscreenMapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#222',
    borderBottomWidth: 1,
    borderBottomColor: '#333'
  },
  fullscreenMapTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600'
  },
  fullscreenMapClose: {
    color: '#fff',
    fontSize: 28,
    padding: 4
  },
  fullscreenMapScroll: {
    flex: 1
  },
  fullscreenMapGrid: {
    padding: 20,
    alignSelf: 'center'
  },
  fullscreenMapRow: {
    flexDirection: 'row',
    height: 20
  },
  fullscreenMapTile: {
    width: 20,
    height: 20,
    backgroundColor: '#1a1a1a',
    borderWidth: 0.5,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center'
  },
  fullscreenMapTileCurrent: {
    backgroundColor: '#ff9f6b',
    borderColor: '#ffa500',
    borderWidth: 2
  },
  fullscreenMapTileVisited: {
    backgroundColor: '#2a4a2a',
    borderColor: '#3a5a3a'
  },
  fullscreenMapTileStrokeCount: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '600'
  },
  fullscreenMapLegend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    backgroundColor: '#222',
    borderTopWidth: 1,
    borderTopColor: '#333'
  },
  countdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999
  },
  countdownNumber: {
    color: '#ff9f6b',
    fontSize: 120,
    fontWeight: 'bold',
    marginBottom: 20
  },
  countdownText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'center'
  }
});
