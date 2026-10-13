import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Dimensions, Modal, Platform } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { CustomOverlayHelper } from '../components/CustomOverlay';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { usePainting } from '../state/PaintingContext';
import type { Stroke } from '../state/PaintingContext';
import PaintCanvas from '../workspace/PaintCanvas';
import Slider from '@react-native-community/slider';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const TIMELINE_HEIGHT = 100;
const CANVAS_SIZE = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.95;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface Frame {
  id: string;
  strokes: Stroke[];
}

const FrameByFrameScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { dispatch, strokes, brushEmoji, brushSize, brushOpacity, brushSpacing, brushRotation, mirrorX, mirrorY, trace } = usePainting();

  // Frame management
  const [frames, setFrames] = useState<Frame[]>([
    { id: '1', strokes: [] }
  ]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(12);

  // Onion skinning
  const [onionEnabled, setOnionEnabled] = useState(false);
  const [onionFramesBefore, setOnionFramesBefore] = useState(1);
  const [onionFramesAfter, setOnionFramesAfter] = useState(1);
  const [onionOpacity, setOnionOpacity] = useState(0.3);

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [timelineVisible, setTimelineVisible] = useState(true);

  // Refs
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentFrame = frames[currentFrameIndex];

  // Save current strokes to current frame whenever they change
  useEffect(() => {
    if (strokes.length > 0) {
      setFrames(prev => {
        const newFrames = [...prev];
        newFrames[currentFrameIndex] = {
          ...newFrames[currentFrameIndex],
          strokes: [...strokes]
        };
        return newFrames;
      });
    }
  }, [strokes, currentFrameIndex]);

  // Load frame strokes into canvas when switching frames
  const switchToFrame = useCallback((index: number) => {
    // Save current frame first
    setFrames(prev => {
      const newFrames = [...prev];
      newFrames[currentFrameIndex] = {
        ...newFrames[currentFrameIndex],
        strokes: [...strokes]
      };
      return newFrames;
    });

    // Switch to new frame
    setCurrentFrameIndex(index);
    const newFrame = frames[index];

    // Load new frame's strokes
    dispatch({
      type: 'LOAD_STATE',
      payload: {
        strokes: newFrame.strokes,
        brushEmoji,
        brushSize,
        brushOpacity,
        brushSpacing,
        brushRotation,
        mirrorX,
        mirrorY,
        recentEmojis: [],
        trace
      }
    });
  }, [currentFrameIndex, strokes, frames, dispatch, brushEmoji, brushSize, brushOpacity, brushSpacing, brushRotation, mirrorX, mirrorY, trace]);

  // Add new empty frame
  const addEmptyFrame = useCallback(() => {
    const newFrame: Frame = {
      id: Date.now().toString(),
      strokes: []
    };
    setFrames(prev => {
      const newFrames = [...prev];
      newFrames.splice(currentFrameIndex + 1, 0, newFrame);
      return newFrames;
    });
    switchToFrame(currentFrameIndex + 1);
    setShowAddMenu(false);
  }, [currentFrameIndex, switchToFrame]);

  // Duplicate current frame
  const duplicateFrame = useCallback(() => {
    const newFrame: Frame = {
      id: Date.now().toString(),
      strokes: [...strokes]
    };
    setFrames(prev => {
      const newFrames = [...prev];
      newFrames.splice(currentFrameIndex + 1, 0, newFrame);
      return newFrames;
    });
    switchToFrame(currentFrameIndex + 1);
    setShowAddMenu(false);
  }, [strokes, currentFrameIndex, switchToFrame]);

  // Delete current frame
  const deleteFrame = useCallback(() => {
    if (frames.length === 1) {
      CustomOverlayHelper.show({ title: 'Cannot Delete', message: 'You need at least one frame!' });
      return;
    }

    CustomOverlayHelper.delete('Delete Frame', 'Are you sure you want to delete this frame?', () => {
      setFrames(prev => prev.filter((_, idx) => idx !== currentFrameIndex));
      const newIndex = Math.max(0, currentFrameIndex - 1);
      if (currentFrameIndex >= frames.length - 1) {
        switchToFrame(newIndex);
      }
    });
  }, [frames.length, currentFrameIndex, switchToFrame]);

  // Play animation
  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      let frameIdx = currentFrameIndex;

      playIntervalRef.current = setInterval(() => {
        frameIdx = (frameIdx + 1) % frames.length;
        switchToFrame(frameIdx);
      }, 1000 / fps);
    }
  }, [isPlaying, fps, frames.length, currentFrameIndex, switchToFrame]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  // Calculate onion skin frames to display
  const onionFrames = useMemo(() => {
    if (!onionEnabled) return [];

    const result: Array<{ frameIndex: number; strokes: Stroke[]; opacity: number }> = [];

    // Add previous frames
    for (let i = 1; i <= onionFramesBefore; i++) {
      const frameIndex = currentFrameIndex - i;
      if (frameIndex >= 0) {
        const opacityFactor = 1 - (i / (onionFramesBefore + 1));
        result.push({
          frameIndex,
          strokes: frames[frameIndex].strokes,
          opacity: onionOpacity * opacityFactor * 0.7 // Previous frames in red tint
        });
      }
    }

    // Add next frames
    for (let i = 1; i <= onionFramesAfter; i++) {
      const frameIndex = currentFrameIndex + i;
      if (frameIndex < frames.length) {
        const opacityFactor = 1 - (i / (onionFramesAfter + 1));
        result.push({
          frameIndex,
          strokes: frames[frameIndex].strokes,
          opacity: onionOpacity * opacityFactor * 0.5 // Next frames more subtle
        });
      }
    }

    return result;
  }, [onionEnabled, onionFramesBefore, onionFramesAfter, onionOpacity, currentFrameIndex, frames]);

  return (
    <View style={styles.container}>
      {/* Onion skin layers - rendered behind the main workspace */}
      {onionFrames.map((onionFrame) => (
        <View
          key={`onion-${onionFrame.frameIndex}`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 1
          }}
        >
          <View style={{ opacity: onionFrame.opacity }}>
            <PaintCanvas
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              strokes={onionFrame.strokes}
              liveStroke={null}
              backgroundColor="transparent"
            />
          </View>
        </View>
      ))}

      {/* Main canvas for current frame */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2
        }}
        pointerEvents="box-none"
      >
        <PaintCanvas
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          strokes={currentFrame?.strokes || []}
          liveStroke={null}
          liveVersion={0}
        />
      </View>

      {/* Floating control buttons row */}
      <View style={styles.controlsRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.controlBtn}>
          <Text style={styles.controlBtnText}>←</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={togglePlayback} style={[styles.controlBtn, styles.playBtn]}>
          <Text style={styles.controlBtnText}>{isPlaying ? '⏸️' : '▶️'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowAddMenu(true)} style={styles.controlBtn}>
          <Text style={styles.controlBtnText}>➕</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setOnionEnabled(!onionEnabled)}
          style={[styles.controlBtn, onionEnabled && styles.controlBtnActive]}
        >
          <Text style={styles.controlBtnText}>🧅</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.controlBtn}>
          <Text style={styles.controlBtnText}>⚙️</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={deleteFrame} style={styles.controlBtn}>
          <Text style={styles.controlBtnText}>🗑️</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setTimelineVisible(!timelineVisible)}
          style={styles.controlBtn}
        >
          <Text style={styles.controlBtnText}>{timelineVisible ? '👁️' : '👁️‍🗨️'}</Text>
        </TouchableOpacity>
      </View>

      {/* Frame indicator */}
      <View style={styles.frameIndicator}>
        <Text style={styles.frameNumber}>
          {currentFrameIndex + 1}/{frames.length}
        </Text>
      </View>

      {/* Timeline strip at bottom */}
      {timelineVisible && (
        <View style={styles.timeline}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.timelineContent}
          >
            {frames.map((frame, index) => (
              <TouchableOpacity
                key={frame.id}
                onPress={() => switchToFrame(index)}
                style={[
                  styles.frameThumb,
                  index === currentFrameIndex && styles.frameThumbActive
                ]}
              >
                <View style={styles.frameThumbInner}>
                  <Text style={styles.frameThumbNumber}>{index + 1}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Add Frame Menu */}
      <Modal
        visible={showAddMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAddMenu(false)}
        >
          <View style={styles.menuModal}>
            <TouchableOpacity style={styles.menuOption} onPress={addEmptyFrame}>
              <Text style={styles.menuOptionText}>📄 New Empty Frame</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={duplicateFrame}>
              <Text style={styles.menuOptionText}>📋 Duplicate Frame</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuOption, styles.menuOptionCancel]}
              onPress={() => setShowAddMenu(false)}
            >
              <Text style={styles.menuOptionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Settings Modal */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.settingsModal}>
            <Text style={styles.settingsTitle}>Animation Settings</Text>

            {/* FPS Setting */}
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>FPS: {fps}</Text>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={60}
                step={1}
                value={fps}
                onValueChange={setFps}
                minimumTrackTintColor="#4CAF50"
                maximumTrackTintColor="#666"
              />
            </View>

            {/* Onion Skin Settings */}
            <Text style={styles.settingsSectionTitle}>Onion Skin</Text>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Frames Before: {onionFramesBefore}</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={5}
                step={1}
                value={onionFramesBefore}
                onValueChange={setOnionFramesBefore}
                minimumTrackTintColor="#4CAF50"
                maximumTrackTintColor="#666"
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Frames After: {onionFramesAfter}</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={5}
                step={1}
                value={onionFramesAfter}
                onValueChange={setOnionFramesAfter}
                minimumTrackTintColor="#4CAF50"
                maximumTrackTintColor="#666"
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Opacity: {Math.round(onionOpacity * 100)}%</Text>
              <Slider
                style={styles.slider}
                minimumValue={0.1}
                maximumValue={1}
                step={0.1}
                value={onionOpacity}
                onValueChange={setOnionOpacity}
                minimumTrackTintColor="#4CAF50"
                maximumTrackTintColor="#666"
              />
            </View>

            <TouchableOpacity
              style={styles.settingsCloseButton}
              onPress={() => setShowSettings(false)}
            >
              <Text style={styles.settingsCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c'
  },
  controlsRow: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    zIndex: 100
  },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#666'
  },
  playBtn: {
    backgroundColor: 'rgba(76,175,80,0.9)',
    borderColor: '#4CAF50'
  },
  controlBtnActive: {
    backgroundColor: 'rgba(76,175,80,0.9)',
    borderColor: '#4CAF50'
  },
  controlBtnText: {
    fontSize: 24
  },
  frameIndicator: {
    position: 'absolute',
    top: 110,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 100
  },
  frameNumber: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold'
  },
  timeline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: TIMELINE_HEIGHT,
    backgroundColor: 'rgba(0,0,0,0.9)',
    borderTopWidth: 1,
    borderTopColor: '#333',
    zIndex: 99
  },
  timelineContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center'
  },
  frameThumb: {
    marginRight: 12,
    alignItems: 'center'
  },
  frameThumbActive: {
    transform: [{ scale: 1.1 }]
  },
  frameThumbInner: {
    width: 60,
    height: 60,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#666',
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center'
  },
  frameThumbNumber: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  menuModal: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 8,
    minWidth: 250
  },
  menuOption: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginVertical: 4
  },
  menuOptionCancel: {
    backgroundColor: '#444',
    marginTop: 8
  },
  menuOptionText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    fontWeight: '600'
  },
  settingsModal: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    maxWidth: 400
  },
  settingsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
    textAlign: 'center'
  },
  settingsSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginTop: 20,
    marginBottom: 12
  },
  settingRow: {
    marginBottom: 20
  },
  settingLabel: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 8,
    fontWeight: '600'
  },
  slider: {
    width: '100%',
    height: 40
  },
  settingsCloseButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 20
  },
  settingsCloseText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center'
  }
});

export default FrameByFrameScreen;
