/**
 * Framer Animation Tests
 * Tests for frame management, stroke persistence, keyframe interpolation
 */

describe('Frame Navigation', () => {
  class FrameBuffer {
    private totalFrames: number;
    private currentFrame: number = 0;

    constructor(totalFrames: number = 1) {
      this.totalFrames = Math.max(1, totalFrames);
    }

    goToFrame(index: number): void {
      this.currentFrame = Math.max(0, Math.min(index, this.totalFrames - 1));
    }

    nextFrame(): void {
      this.currentFrame = (this.currentFrame + 1) % this.totalFrames;
    }

    previousFrame(): void {
      this.currentFrame = this.currentFrame === 0 ? this.totalFrames - 1 : this.currentFrame - 1;
    }

    currentFrameNumber(): number {
      return this.currentFrame;
    }

    getTotalFrames(): number {
      return this.totalFrames;
    }

    addFrame(): void {
      this.totalFrames += 1;
    }

    deleteFrame(index: number): void {
      if (this.totalFrames <= 1) return;
      this.totalFrames -= 1;

      if (this.currentFrame >= this.totalFrames) {
        this.currentFrame = this.totalFrames - 1;
      }
    }
  }

  test('should navigate to frame', () => {
    const frames = new FrameBuffer(10);
    frames.goToFrame(5);

    expect(frames.currentFrameNumber()).toBe(5);
  });

  test('should go to next frame', () => {
    const frames = new FrameBuffer(10);
    frames.goToFrame(1);
    frames.nextFrame();

    expect(frames.currentFrameNumber()).toBe(2);
  });

  test('should wrap to first frame on next', () => {
    const frames = new FrameBuffer(5);
    frames.goToFrame(4);
    frames.nextFrame();

    expect(frames.currentFrameNumber()).toBe(0);
  });

  test('should go to previous frame', () => {
    const frames = new FrameBuffer(10);
    frames.goToFrame(5);
    frames.previousFrame();

    expect(frames.currentFrameNumber()).toBe(4);
  });

  test('should wrap to last frame on previous', () => {
    const frames = new FrameBuffer(5);
    frames.goToFrame(0);
    frames.previousFrame();

    expect(frames.currentFrameNumber()).toBe(4);
  });

  test('should clamp frame index', () => {
    const frames = new FrameBuffer(10);

    frames.goToFrame(-1);
    expect(frames.currentFrameNumber()).toBe(0);

    frames.goToFrame(100);
    expect(frames.currentFrameNumber()).toBe(9);
  });

  test('should add frames', () => {
    const frames = new FrameBuffer(5);
    expect(frames.getTotalFrames()).toBe(5);

    frames.addFrame();
    expect(frames.getTotalFrames()).toBe(6);
  });

  test('should delete frames but keep at least one', () => {
    const frames = new FrameBuffer(2);
    frames.deleteFrame(0);

    expect(frames.getTotalFrames()).toBe(1);

    frames.deleteFrame(0);
    expect(frames.getTotalFrames()).toBe(1); // Should not go below 1
  });

  test('should adjust current frame when deleting', () => {
    const frames = new FrameBuffer(5);
    frames.goToFrame(4); // Last frame
    frames.deleteFrame(4);

    expect(frames.getTotalFrames()).toBe(4);
    expect(frames.currentFrameNumber()).toBe(3);
  });
});

describe('Stroke Persistence', () => {
  interface Stroke {
    id: string;
    emoji: string;
    startFrame: number;
    frameDuration: number;
  }

  const isStrokeVisibleAtFrame = (stroke: Stroke, frame: number): boolean => {
    const endFrame = stroke.startFrame + stroke.frameDuration;
    return frame >= stroke.startFrame && frame < endFrame;
  };

  test('should show stroke only on its frame when duration=1', () => {
    const stroke: Stroke = {
      id: '1',
      emoji: '🎨',
      startFrame: 2,
      frameDuration: 1
    };

    expect(isStrokeVisibleAtFrame(stroke, 1)).toBe(false);
    expect(isStrokeVisibleAtFrame(stroke, 2)).toBe(true);
    expect(isStrokeVisibleAtFrame(stroke, 3)).toBe(false);
  });

  test('should show stroke across multiple frames when duration>1', () => {
    const stroke: Stroke = {
      id: '1',
      emoji: '🎨',
      startFrame: 2,
      frameDuration: 5
    };

    expect(isStrokeVisibleAtFrame(stroke, 1)).toBe(false);
    expect(isStrokeVisibleAtFrame(stroke, 2)).toBe(true);
    expect(isStrokeVisibleAtFrame(stroke, 4)).toBe(true);
    expect(isStrokeVisibleAtFrame(stroke, 6)).toBe(true);
    expect(isStrokeVisibleAtFrame(stroke, 7)).toBe(false);
  });

  test('should not show stroke before start frame', () => {
    const stroke: Stroke = {
      id: '1',
      emoji: '🎨',
      startFrame: 5,
      frameDuration: 3
    };

    expect(isStrokeVisibleAtFrame(stroke, 0)).toBe(false);
    expect(isStrokeVisibleAtFrame(stroke, 4)).toBe(false);
  });

  test('should not show stroke after end frame', () => {
    const stroke: Stroke = {
      id: '1',
      emoji: '🎨',
      startFrame: 5,
      frameDuration: 3
    };

    expect(isStrokeVisibleAtFrame(stroke, 8)).toBe(false);
  });
});

describe('Keyframe Interpolation', () => {
  interface Keyframe {
    frame: number;
    corners: {
      topLeft: { x: number; y: number };
      topRight: { x: number; y: number };
      bottomRight: { x: number; y: number };
      bottomLeft: { x: number; y: number };
    };
  }

  const interpolateKeyframe = (kf1: Keyframe, kf2: Keyframe, frame: number): Keyframe => {
    const progress = (frame - kf1.frame) / (kf2.frame - kf1.frame);

    const interpolate = (v1: number, v2: number) => v1 + (v2 - v1) * progress;

    return {
      frame,
      corners: {
        topLeft: {
          x: interpolate(kf1.corners.topLeft.x, kf2.corners.topLeft.x),
          y: interpolate(kf1.corners.topLeft.y, kf2.corners.topLeft.y)
        },
        topRight: {
          x: interpolate(kf1.corners.topRight.x, kf2.corners.topRight.x),
          y: interpolate(kf1.corners.topRight.y, kf2.corners.topRight.y)
        },
        bottomRight: {
          x: interpolate(kf1.corners.bottomRight.x, kf2.corners.bottomRight.x),
          y: interpolate(kf1.corners.bottomRight.y, kf2.corners.bottomRight.y)
        },
        bottomLeft: {
          x: interpolate(kf1.corners.bottomLeft.x, kf2.corners.bottomLeft.x),
          y: interpolate(kf1.corners.bottomLeft.y, kf2.corners.bottomLeft.y)
        }
      }
    };
  };

  test('should interpolate plane corners between keyframes', () => {
    const kf1: Keyframe = {
      frame: 0,
      corners: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 100, y: 0 },
        bottomRight: { x: 100, y: 100 },
        bottomLeft: { x: 0, y: 100 }
      }
    };

    const kf2: Keyframe = {
      frame: 10,
      corners: {
        topLeft: { x: 100, y: 100 },
        topRight: { x: 200, y: 100 },
        bottomRight: { x: 200, y: 200 },
        bottomLeft: { x: 100, y: 200 }
      }
    };

    const interpolated = interpolateKeyframe(kf1, kf2, 5);

    expect(interpolated.corners.topLeft.x).toBeCloseTo(50, 0);
    expect(interpolated.corners.topLeft.y).toBeCloseTo(50, 0);
  });

  test('should return start keyframe at frame 0', () => {
    const kf1: Keyframe = {
      frame: 0,
      corners: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 100, y: 0 },
        bottomRight: { x: 100, y: 100 },
        bottomLeft: { x: 0, y: 100 }
      }
    };

    const kf2: Keyframe = {
      frame: 10,
      corners: {
        topLeft: { x: 100, y: 100 },
        topRight: { x: 200, y: 100 },
        bottomRight: { x: 200, y: 200 },
        bottomLeft: { x: 100, y: 200 }
      }
    };

    const interpolated = interpolateKeyframe(kf1, kf2, 0);

    expect(interpolated.corners.topLeft.x).toBe(0);
    expect(interpolated.corners.topLeft.y).toBe(0);
  });

  test('should return end keyframe at frame 10', () => {
    const kf1: Keyframe = {
      frame: 0,
      corners: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 100, y: 0 },
        bottomRight: { x: 100, y: 100 },
        bottomLeft: { x: 0, y: 100 }
      }
    };

    const kf2: Keyframe = {
      frame: 10,
      corners: {
        topLeft: { x: 100, y: 100 },
        topRight: { x: 200, y: 100 },
        bottomRight: { x: 200, y: 200 },
        bottomLeft: { x: 100, y: 200 }
      }
    };

    const interpolated = interpolateKeyframe(kf1, kf2, 10);

    expect(interpolated.corners.topLeft.x).toBe(100);
    expect(interpolated.corners.topLeft.y).toBe(100);
  });
});

describe('FPS Calculations', () => {
  const calculateFrameDuration = (totalDuration: number, fps: number): number => {
    return totalDuration / fps;
  };

  const calculateTotalDuration = (frameCount: number, fps: number): number => {
    return frameCount / fps;
  };

  test('should calculate frame duration', () => {
    expect(calculateFrameDuration(2, 30)).toBeCloseTo(0.0667, 3);
    expect(calculateFrameDuration(1, 60)).toBeCloseTo(0.0167, 3);
  });

  test('should calculate total duration', () => {
    expect(calculateTotalDuration(30, 30)).toBe(1);
    expect(calculateTotalDuration(60, 60)).toBe(1);
    expect(calculateTotalDuration(100, 25)).toBe(4);
  });

  test('should handle various FPS values', () => {
    expect(calculateTotalDuration(12, 12)).toBe(1);
    expect(calculateTotalDuration(300, 300)).toBe(1);
  });
});
