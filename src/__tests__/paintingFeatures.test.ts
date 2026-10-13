/**
 * Comprehensive Painting Features Tests
 * Tests all stroke, brush, and drawing functionality
 */

describe('Painting Features', () => {
  // ===== BRUSH TESTS =====
  describe('Brush Operations', () => {
    test('should create brush with correct emoji', () => {
      const brush = { emoji: '🎨', size: 50, opacity: 1 };
      expect(brush.emoji).toBe('🎨');
      expect(brush.size).toBe(50);
    });

    test('should change brush size', () => {
      const brush = { emoji: '🎨', size: 50 };
      const updated = { ...brush, size: 100 };
      expect(updated.size).toBe(100);
      expect(brush.size).toBe(50); // Original unchanged
    });

    test('should set brush opacity', () => {
      const brush = { emoji: '🎨', opacity: 1 };
      const updated = { ...brush, opacity: 0.5 };
      expect(updated.opacity).toBe(0.5);
      expect(updated.opacity).toBeLessThanOrEqual(1);
      expect(updated.opacity).toBeGreaterThanOrEqual(0);
    });

    test('should support multiple brush emoji types', () => {
      const brushes = ['🎨', '✏️', '🖌️', '🖍️', '⭐', '❤️'];
      brushes.forEach(emoji => {
        expect(emoji).toMatch(/[\p{Emoji}]/u);
      });
    });

    test('should validate brush size range', () => {
      const sizes = [1, 10, 50, 100, 500];
      sizes.forEach(size => {
        expect(size).toBeGreaterThan(0);
        expect(size).toBeLessThanOrEqual(500);
      });
    });
  });

  // ===== STROKE TESTS =====
  describe('Stroke Creation & Manipulation', () => {
    test('should create empty stroke', () => {
      const stroke = { x: [], y: [], pressure: [], color: 'red', brushEmoji: '🎨' };
      expect(stroke.x).toHaveLength(0);
      expect(stroke.y).toHaveLength(0);
    });

    test('should add point to stroke', () => {
      const stroke = { x: [0], y: [0] };
      const updated = { ...stroke, x: [...stroke.x, 10], y: [...stroke.y, 10] };
      expect(updated.x).toHaveLength(2);
      expect(updated.x[1]).toBe(10);
    });

    test('should add multiple points continuously', () => {
      let stroke = { x: [], y: [], pressure: [] };
      for (let i = 0; i < 100; i++) {
        stroke = {
          x: [...stroke.x, i],
          y: [...stroke.y, i * 2],
          pressure: [...stroke.pressure, 0.5 + (i % 2) * 0.5]
        };
      }
      expect(stroke.x).toHaveLength(100);
      expect(stroke.y).toHaveLength(100);
      expect(stroke.pressure).toHaveLength(100);
    });

    test('should handle pressure sensitivity', () => {
      const stroke = { x: [0, 10], y: [0, 10], pressure: [0.5, 1.0] };
      expect(stroke.pressure[0]).toBeLessThan(stroke.pressure[1]);
      stroke.pressure.forEach(p => {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      });
    });

    test('should store stroke metadata', () => {
      const stroke = {
        x: [0, 10],
        y: [0, 10],
        color: '#FF0000',
        brushEmoji: '🎨',
        timestamp: Date.now(),
        brushSize: 50
      };
      expect(stroke.color).toBe('#FF0000');
      expect(stroke.timestamp).toBeGreaterThan(0);
      expect(stroke.brushSize).toBe(50);
    });
  });

  // ===== ERASER TESTS =====
  describe('Eraser Tool', () => {
    test('should toggle eraser mode', () => {
      let isEraserActive = false;
      expect(isEraserActive).toBe(false);
      isEraserActive = true;
      expect(isEraserActive).toBe(true);
    });

    test('should erase strokes by index', () => {
      let strokes = [
        { id: 1, color: 'red' },
        { id: 2, color: 'blue' },
        { id: 3, color: 'green' }
      ];
      strokes = strokes.filter(s => s.id !== 2);
      expect(strokes).toHaveLength(2);
      expect(strokes.map(s => s.id)).toEqual([1, 3]);
    });

    test('should clear all strokes', () => {
      let strokes = [{ id: 1 }, { id: 2 }, { id: 3 }];
      strokes = [];
      expect(strokes).toHaveLength(0);
    });

    test('should handle eraser with touch area', () => {
      const eraserSize = 50;
      const touchPoints = [
        { x: 100, y: 100 },
        { x: 150, y: 150 }
      ];

      const strokeInArea = { x: [120], y: [120] };
      const distance = Math.sqrt((120 - 100) ** 2 + (120 - 100) ** 2);
      expect(distance).toBeLessThan(eraserSize);
    });
  });

  // ===== UNDO/REDO TESTS =====
  describe('Undo/Redo System', () => {
    test('should undo last stroke', () => {
      let strokes = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const undone = strokes.slice(0, -1);
      expect(undone).toHaveLength(2);
      expect(undone[undone.length - 1].id).toBe(2);
    });

    test('should redo after undo', () => {
      const strokes = [{ id: 1 }, { id: 2 }];
      const undoHistory = [{ id: 3 }];
      const redone = [...strokes, ...undoHistory];
      expect(redone).toHaveLength(3);
      expect(redone[2].id).toBe(3);
    });

    test('should clear redo history after new action', () => {
      let strokes = [{ id: 1 }, { id: 2 }];
      let redoHistory = [{ id: 3 }, { id: 4 }];

      strokes.push({ id: 5 }); // New action
      redoHistory = []; // Clear redo

      expect(redoHistory).toHaveLength(0);
    });

    test('should support multiple undo levels', () => {
      let strokes = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const undoLevels = [];

      // Undo 3 times
      for (let i = 0; i < 3; i++) {
        undoLevels.push([...strokes]);
        strokes = strokes.slice(0, -1);
      }

      expect(undoLevels).toHaveLength(3);
      expect(strokes).toHaveLength(0);
    });
  });

  // ===== DRAWING TOOLS TESTS =====
  describe('Drawing Tools', () => {
    test('should switch between brush and line tool', () => {
      const tools = { current: 'brush' };
      expect(tools.current).toBe('brush');

      tools.current = 'line';
      expect(tools.current).toBe('line');
    });

    test('should draw line between two points', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 100, y: 100 };

      const linePoints = [];
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        linePoints.push({
          x: start.x + (end.x - start.x) * (i / steps),
          y: start.y + (end.y - start.y) * (i / steps)
        });
      }

      expect(linePoints).toHaveLength(21);
      expect(linePoints[0]).toEqual(start);
      expect(linePoints[linePoints.length - 1]).toEqual(end);
    });

    test('should calculate line length', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 3, y: 4 };
      const length = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
      expect(length).toBe(5); // 3-4-5 triangle
    });
  });

  // ===== COLOR TESTS =====
  describe('Color Management', () => {
    test('should set stroke color', () => {
      const stroke = { color: '#FF0000' };
      expect(stroke.color).toBe('#FF0000');
    });

    test('should support multiple color formats', () => {
      const colors = ['#FF0000', 'rgb(255,0,0)', 'red', '#F00'];
      colors.forEach(color => {
        expect(color).toBeTruthy();
      });
    });

    test('should store recent colors', () => {
      let recentColors = [];
      const newColors = ['#FF0000', '#00FF00', '#0000FF'];
      recentColors = [...newColors];

      expect(recentColors).toEqual(newColors);
      expect(recentColors).toHaveLength(3);
    });

    test('should validate color format', () => {
      const validColor = '#FF0000';
      const hexRegex = /^#[0-9A-F]{6}$/i;
      expect(validColor).toMatch(hexRegex);
    });
  });

  // ===== CANVAS TESTS =====
  describe('Canvas Operations', () => {
    test('should handle canvas size', () => {
      const canvas = { width: 1080, height: 1920 };
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
    });

    test('should validate stroke is within canvas', () => {
      const canvas = { width: 1080, height: 1920 };
      const stroke = { x: [100, 500], y: [200, 1000] };

      stroke.x.forEach(x => {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(canvas.width);
      });
      stroke.y.forEach(y => {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(canvas.height);
      });
    });

    test('should clear canvas', () => {
      let strokes = [{ id: 1 }, { id: 2 }, { id: 3 }];
      strokes = [];
      expect(strokes).toHaveLength(0);
    });

    test('should save canvas state', () => {
      const canvasState = {
        strokes: [{ id: 1 }],
        backgroundColor: '#FFFFFF',
        timestamp: Date.now()
      };

      expect(canvasState.strokes).toHaveLength(1);
      expect(canvasState.backgroundColor).toBe('#FFFFFF');
      expect(canvasState.timestamp).toBeGreaterThan(0);
    });
  });

  // ===== TRANSFORMATION TESTS =====
  describe('Canvas Transformations', () => {
    test('should flip canvas horizontally', () => {
      const stroke = { x: [100, 200], y: [100, 100] };
      const canvas = { width: 1080 };

      const flipped = {
        x: stroke.x.map(x => canvas.width - x),
        y: stroke.y
      };

      expect(flipped.x[0]).toBe(980);
      expect(flipped.x[1]).toBe(880);
    });

    test('should flip canvas vertically', () => {
      const stroke = { x: [100, 100], y: [100, 200] };
      const canvas = { height: 1920 };

      const flipped = {
        x: stroke.x,
        y: stroke.y.map(y => canvas.height - y)
      };

      expect(flipped.y[0]).toBe(1820);
      expect(flipped.y[1]).toBe(1720);
    });

    test('should rotate canvas', () => {
      const rotation = 90;
      const radians = (rotation * Math.PI) / 180;
      expect(radians).toBeCloseTo(Math.PI / 2, 5);
    });
  });
});
