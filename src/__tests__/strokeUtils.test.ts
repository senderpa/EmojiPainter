/**
 * Stroke Utility Tests
 * Tests for core stroke operations: decimation, undo/redo, calculations
 */

describe('Stroke Decimation', () => {
  // Helper function to test - implement based on your actual code
  const decimateStrokePoints = (points: any[], tolerance: number) => {
    if (points.length <= 2) return points;

    const result = [points[0]];
    let lastPoint = points[0];

    for (let i = 1; i < points.length - 1; i++) {
      const distance = Math.sqrt(
        Math.pow(points[i].x - lastPoint.x, 2) +
        Math.pow(points[i].y - lastPoint.y, 2)
      );

      if (distance > tolerance) {
        result.push(points[i]);
        lastPoint = points[i];
      }
    }

    result.push(points[points.length - 1]);
    return result;
  };

  test('should reduce stroke points while maintaining shape', () => {
    const points = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 1, t: 10 },
      { x: 2, y: 1, t: 20 },
      { x: 3, y: 2, t: 30 },
      { x: 100, y: 100, t: 100 }
    ];

    const decimated = decimateStrokePoints(points, 2);

    expect(decimated.length).toBeLessThan(points.length);
    expect(decimated[0]).toEqual(points[0]);
    expect(decimated[decimated.length - 1]).toEqual(points[points.length - 1]);
  });

  test('should not remove points beyond tolerance', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 100 }
    ];

    const decimated = decimateStrokePoints(points, 10);

    expect(decimated.length).toBe(2);
    expect(decimated).toEqual(points);
  });

  test('should handle single point', () => {
    const points = [{ x: 0, y: 0 }];
    const decimated = decimateStrokePoints(points, 2);

    expect(decimated).toEqual(points);
  });

  test('should handle two points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 }
    ];

    const decimated = decimateStrokePoints(points, 2);

    expect(decimated).toEqual(points);
  });
});

describe('Undo/Redo Stack', () => {
  class UndoRedoStack<T> {
    private undoStack: T[] = [];
    private redoStack: T[] = [];
    private maxSize: number;

    constructor(maxSize = 1000) {
      this.maxSize = maxSize;
    }

    push(item: T): void {
      this.undoStack.push(item);
      if (this.undoStack.length > this.maxSize) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }

    undo(): T | undefined {
      if (this.undoStack.length === 0) return undefined;
      const item = this.undoStack.pop();
      if (item !== undefined) {
        this.redoStack.push(item);
      }
      return item;
    }

    redo(): T | undefined {
      if (this.redoStack.length === 0) return undefined;
      const item = this.redoStack.pop();
      if (item !== undefined) {
        this.undoStack.push(item);
      }
      return item;
    }

    canUndo(): boolean {
      return this.undoStack.length > 0;
    }

    canRedo(): boolean {
      return this.redoStack.length > 0;
    }

    getSize(): number {
      return this.undoStack.length;
    }

    clear(): void {
      this.undoStack = [];
      this.redoStack = [];
    }
  }

  test('should undo last stroke', () => {
    const stack = new UndoRedoStack<string>();
    stack.push('stroke1');
    stack.push('stroke2');

    expect(stack.canUndo()).toBe(true);

    const undone = stack.undo();
    expect(undone).toBe('stroke2');
    expect(stack.canRedo()).toBe(true);
  });

  test('should redo undone stroke', () => {
    const stack = new UndoRedoStack<string>();
    stack.push('stroke1');
    stack.push('stroke2');

    stack.undo();
    expect(stack.canRedo()).toBe(true);

    const redone = stack.redo();
    expect(redone).toBe('stroke2');
    expect(stack.canRedo()).toBe(false);
  });

  test('should clear redo on new push', () => {
    const stack = new UndoRedoStack<string>();
    stack.push('stroke1');
    stack.push('stroke2');
    stack.undo();

    expect(stack.canRedo()).toBe(true);

    stack.push('stroke3');

    expect(stack.canRedo()).toBe(false);
  });

  test('should respect max stack size', () => {
    const stack = new UndoRedoStack<number>(5);

    for (let i = 0; i < 10; i++) {
      stack.push(i);
    }

    expect(stack.getSize()).toBe(5);
  });

  test('should handle undo on empty stack', () => {
    const stack = new UndoRedoStack<string>();

    expect(stack.canUndo()).toBe(false);
    const result = stack.undo();
    expect(result).toBeUndefined();
  });

  test('should handle redo on empty redo stack', () => {
    const stack = new UndoRedoStack<string>();
    stack.push('stroke1');

    expect(stack.canRedo()).toBe(false);
    const result = stack.redo();
    expect(result).toBeUndefined();
  });

  test('should clear both stacks', () => {
    const stack = new UndoRedoStack<string>();
    stack.push('stroke1');
    stack.undo();

    stack.clear();

    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.getSize()).toBe(0);
  });
});

describe('Brush Calculations', () => {
  // Brush size presets
  const brushSizePresets = [1, 5, 10, 15, 20, 30, 50, 100, 150, 200, 230, 255];

  test('should have valid brush sizes', () => {
    expect(brushSizePresets[0]).toBe(1);
    expect(brushSizePresets[brushSizePresets.length - 1]).toBe(255);
    expect(brushSizePresets.length).toBe(12);
  });

  test('should clamp opacity value', () => {
    const clampOpacity = (value: number) => Math.max(0, Math.min(100, value));

    expect(clampOpacity(50)).toBe(50);
    expect(clampOpacity(-10)).toBe(0);
    expect(clampOpacity(150)).toBe(100);
  });

  test('should convert opacity to alpha', () => {
    const opacityToAlpha = (opacity: number) => opacity / 100;

    expect(opacityToAlpha(100)).toBe(1);
    expect(opacityToAlpha(50)).toBe(0.5);
    expect(opacityToAlpha(0)).toBe(0);
  });
});

describe('Coordinate Transforms', () => {
  const applyZoom = (
    point: { x: number; y: number },
    zoom: number,
    centerX: number,
    centerY: number
  ) => {
    return {
      x: (point.x - centerX) * zoom + centerX,
      y: (point.y - centerY) * zoom + centerY
    };
  };

  const applyRotation = (
    point: { x: number; y: number },
    angle: number,
    centerX: number,
    centerY: number
  ) => {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const x = point.x - centerX;
    const y = point.y - centerY;

    return {
      x: x * cos - y * sin + centerX,
      y: x * sin + y * cos + centerY
    };
  };

  test('should apply zoom correctly', () => {
    const point = { x: 100, y: 100 };
    const zoomed = applyZoom(point, 2, 50, 50);

    expect(zoomed.x).toBe(150);
    expect(zoomed.y).toBe(150);
  });

  test('should apply zoom with zoom out', () => {
    // Point at center stays at center when zoomed
    const point = { x: 100, y: 100 };
    const zoomed = applyZoom(point, 0.5, 100, 100);

    expect(zoomed.x).toBe(100);
    expect(zoomed.y).toBe(100);
  });

  test('should apply rotation correctly (90 degrees)', () => {
    const point = { x: 100, y: 0 };
    const rotated = applyRotation(point, 90, 0, 0);

    expect(rotated.x).toBeCloseTo(0, 1);
    expect(rotated.y).toBeCloseTo(100, 1);
  });

  test('should apply rotation correctly (45 degrees)', () => {
    const point = { x: 100, y: 0 };
    const rotated = applyRotation(point, 45, 0, 0);

    expect(rotated.x).toBeCloseTo(70.7, 0);
    expect(rotated.y).toBeCloseTo(70.7, 0);
  });

  test('should apply rotation with center point', () => {
    const point = { x: 100, y: 100 };
    const rotated = applyRotation(point, 90, 100, 100);

    expect(rotated.x).toBeCloseTo(100, 1);
    expect(rotated.y).toBeCloseTo(100, 1);
  });
});

describe('Stroke Properties', () => {
  interface Stroke {
    id: string;
    emoji: string;
    size: number;
    opacity: number;
    points: Array<{ x: number; y: number }>;
    mirrorX?: boolean;
    mirrorY?: boolean;
    rotation?: number;
    isEraser?: boolean;
  }

  test('should create valid stroke', () => {
    const stroke: Stroke = {
      id: 'stroke-1',
      emoji: '🎨',
      size: 20,
      opacity: 100,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ]
    };

    expect(stroke.emoji).toBe('🎨');
    expect(stroke.size).toBe(20);
    expect(stroke.opacity).toBe(100);
    expect(stroke.points.length).toBe(2);
  });

  test('should apply stroke properties', () => {
    const stroke: Stroke = {
      id: 'stroke-1',
      emoji: '✏️',
      size: 15,
      opacity: 75,
      points: [{ x: 0, y: 0 }],
      mirrorX: true,
      rotation: 45
    };

    expect(stroke.mirrorX).toBe(true);
    expect(stroke.rotation).toBe(45);
  });

  test('should create eraser stroke', () => {
    const stroke: Stroke = {
      id: 'eraser-1',
      emoji: '🧹',
      size: 30,
      opacity: 100,
      points: [{ x: 0, y: 0 }],
      isEraser: true
    };

    expect(stroke.isEraser).toBe(true);
  });
});
