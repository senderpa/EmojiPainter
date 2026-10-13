# Emojipaint Mobile 2030 - Complete Architecture & Reference Guide

## 🎨 What This App Does

**Emojipaint Mobile** is a professional React Native iOS painting application that lets users create artistic works using emoji brushes, create frame-by-frame animations, and compose videos. It's designed for both casual creative expression and professional content creation.

### Core Experience
1. **Paint with emoji** - 3,000+ emoji brushes, adjustable size/opacity/spacing
2. **Create animations** - Frame-by-frame editor with timeline
3. **Export videos** - GIF/MP4/WebM with Metal GPU acceleration
4. **Share & collaborate** - Community gallery with voting and daily challenges
5. **Work offline** - No internet required for core features

---

## 📊 Quick Stats

| Metric | Value |
|--------|-------|
| Total TypeScript Files | 107+ |
| React Version | 19.1.0 |
| React Native | 0.81.5 |
| Expo Version | 54.0.31 |
| Main Screens | 8+ |
| Context/State Systems | 3 |
| Native Modules | 5 |
| Supported Formats | GIF, MP4, WebM, MOV |
| Max Undo/Redo | 10,000 strokes |
| Max Emoji | 3,000+ |
| Max Video Resolution | 4K (3840x2160) |
| Animation FPS Support | 12-300 FPS |

---

## 🏗️ App Architecture

### Visual Architecture Map

```
┌──────────────────────────────────────────────────────────────────┐
│                         App Entry Point                          │
│                          App.tsx                                 │
│  - React Navigation Stack Navigator                              │
│  - Auto-orientation (iPad: unlocked, iPhone: portrait)           │
│  - Global error handling & telemetry                             │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
    ┌───────────▼────┐  ┌───▼──────────┐ ┌──────────────────┐
    │  Global State  │  │   Screens    │ │  Native Modules  │
    │  Management    │  │              │ │                  │
    ├────────────────┤  ├──────────────┤ ├──────────────────┤
    │                │  │              │ │ Metal Rendering  │
    │ • Painting     │  │ • Paint      │ │ • GPU acceleration
    │   Context      │  │ • Framer     │ │                  │
    │ • Settings     │  │ • Timeline   │ │ Exporter         │
    │   Context      │  │ • Export     │ │ • Frame rendering
    │ • Wording      │  │ • Gallery    │ │ • Concurrent batch
    │   Context      │  │ • Editor     │ │                  │
    │                │  │ • Settings   │ │ Timelapse        │
    └────────┬───────┘  └──────┬───────┘ │ • Video export   │
             │                 │         │                  │
             └─────────────────┼─────────┤ Screen Recorder  │
                               │         │ • Audio capture  │
                    ┌──────────▼──────┐  │                  │
                    │ Video Systems   │  └──────────────────┘
                    ├─────────────────┤
                    │ • Export engine │
                    │ • Codec support │
                    │ • Frame batching│
                    └─────────────────┘
```

### State Management Flow

```
User Interaction (Touch, Gesture)
    ↓
PaintingContext Reducer
├─ COMMIT_STROKE - Add stroke to canvas
├─ UNDO - Remove last stroke
├─ REDO - Restore undone stroke
├─ SET_BRUSH_SIZE - Update brush size
├─ SET_OPACITY - Update transparency
└─ MANIPULATE_PLANE - Transform emoji planes
    ↓
Autosave Trigger (30-second debounce)
    ↓
AsyncStorage Write
    ↓
EmojiCanvas Render
    ↓
Screen Update (React + Reanimated)
```

---

## 🎯 Core Features Breakdown

### 1. Painting Workspace
**Location:** `src/screens/PaintScreen.tsx` + `src/workspace/`

**Features:**
- Real-time emoji brush painting
- 12 brush size presets (1-255 pixels)
- Opacity control (0-100%)
- Custom spacing between strokes
- 3,000+ emoji support
- Eraser tool
- Undo/redo (up to 10,000)
- Mirror X/Y
- Rotation
- Trace overlay for reference images

**Data Structure:**
```typescript
Stroke {
  id: string              // Unique identifier
  emoji: string           // Unicode emoji
  size: number            // Brush size in pixels
  opacity: number         // 0-100%
  spacing?: number        // Pixels between stamps
  points: StrokePoint[]   // {x, y, t (time), w (width)}
  mirrorX?: boolean       // Horizontal flip
  mirrorY?: boolean       // Vertical flip
  rotation?: number       // Degrees
  isEraser?: boolean      // Eraser mode
  startFrame?: number     // Animation frame metadata
  frameDuration?: number  // Frames to persist
}
```

**Key Components:**
- `PaintCanvas` - Skia rendering engine
- `EmojiCanvas` - Emoji stamp rendering
- `CanvasViewport` - Gesture handling (pinch, pan, rotation)
- `BrushControls` - Size, opacity, spacing sliders
- `WorkspaceToolbar` - Tool selection
- `QuickActionsStrip` - Fast access to common actions

---

### 2. Frame-by-Frame Animation (Framer)
**Location:** `src/framer/FramerWorkspace.tsx`

**Architecture:**
```
Each Frame = Independent Stroke Collection
    ↓
Stroke Length Slider
├─ When paused: Strokes appear for 1 frame only
└─ When playing: Strokes appear for N consecutive frames
    ↓
Emoji Planes
├─ Per-frame corner positions (8-point transform)
├─ Smooth interpolation between keyframes
└─ Z-stacking and layering
    ↓
Timeline Scrubber
├─ Jump to any frame
├─ FPS display (12-300 FPS)
└─ Real-time playback preview
```

**Features:**
- Multi-frame editor (unlimited frames)
- Timeline with FPS selector
- Stroke persistence across frames
- Emoji plane distortion/transformation
- Onion skin preview (show previous/next frame semi-transparent)
- Frame duplication
- Frame deletion
- Real-time playback

**Export Options:**
- GIF (animated, looping)
- MOV (ProRes 4444 with alpha channel)
- MP4 (H.264 codec)

---

### 3. Video Export & Timelapse
**Location:** `src/video/videoExport.ts` + `src/screens/TimelapseScreen.tsx`

**Export Pipeline:**
```
Collect All Strokes & Emoji Planes
    ↓
Calculate Target Resolution
├─ Low: 512x512 (GIF preview)
├─ Medium: 1024x1024
├─ High: 2048x2048
└─ Ultra: 4096x4096 (2K/4K)
    ↓
Frame Rendering
├─ Metal GPU (iOS native, ~5x faster)
└─ Skia fallback (if Metal unavailable)
    ↓
Concurrent Batch Processing
├─ iPad: 8 frames per batch
└─ iPhone: 4 frames per batch
    ↓
Encode
├─ GIF: Quantization & compression
├─ MP4: H.264 or VP9 codec
└─ MOV: ProRes with alpha
    ↓
Save to File System or Photos Library
    ↓
Share via System Sheet
```

**Supported Formats:**
| Format | Codec | Resolution | Use Case |
|--------|-------|-----------|----------|
| GIF | - | Up to 4K | Web sharing, instant preview |
| MP4 | H.264 | Up to 4K | Standard video, broad compatibility |
| WebM | VP9 | Up to 4K | Web-first, smaller file size |
| MOV | ProRes | 4K | Professional, alpha channel support |

---

### 4. Daily Word Challenge (Wording Mode)
**Location:** `src/wording/WordingContext.tsx`

**Flow:**
```
User Selects Word
    ↓
Split into individual letters
    ↓
Start Timer (60 seconds per letter)
    ↓
Paint the letter
    ↓
Timer expires
├─ Automatically collect strokes
├─ Export letter as individual video
├─ Clear canvas
└─ Move to next letter
    ↓
After all letters complete
├─ Stitch all letter videos together
├─ Generate final composition
└─ Ready to export/share
```

**Data Flow:**
```typescript
WordingState {
  mode: 'inactive' | 'active' | 'stitching' | 'complete'
  word: string                    // Current word
  letters: string[]              // Split into letters
  currentLetterIndex: number      // Current position
  timeRemaining: number           // Countdown timer
  letterExports: string[]         // Paths to each letter video
  compositionExport?: string      // Final stitched video
}
```

---

### 5. Emoji Plane System (Distortion)
**Integrated into PaintingContext**

**What are Emoji Planes?**
- Special grouped emoji objects that can be distorted/transformed
- 8 corner control points for free-form distortion
- Per-plane z-stacking
- Keyframe support for smooth animation

**Capabilities:**
```
Emoji Plane {
  id: string
  emoji: string
  corners: {
    topLeft, topRight, bottomRight, bottomLeft,  // Corners
    topMid, rightMid, bottomMid, leftMid         // Edge midpoints
  }
  cornerHistory: PlaneCornerSnapshot[]  // Timeline of transforms
  opacity: number
  zIndex: number
}
```

---

### 6. 4K Video Composition Editor
**Location:** `src/video/VideoEditorScreen.tsx`

**Features:**
- 4K (3840x2160) canvas
- Unlimited video layers
- Per-layer positioning and scaling
- Drag-to-reorder layers
- Keyframe animation support
- Real-time preview
- Export to MOV

**Workflow:**
1. Load multiple video files
2. Position on canvas with position keyframes
3. Scale and arrange layers
4. Add optional animations
5. Preview composition
6. Export as MOV

---

### 7. Community Gallery
**Location:** `src/lib/dailyPaintGallery.ts`

**Features:**
- Browse community paintings by topic
- Sort: Newest, Hottest, Top-rated
- Voting system (upvote/downvote)
- Offline caching (SQLite)
- Device-specific filtering
- User profile viewing
- Remix existing works

**Backend:**
- `https://emojipainter.com/api/list.php` - Fetch gallery
- `https://emojipainter.com/api/vote.php` - Submit votes
- SHA256-HMAC authentication

---

## 💾 Storage & Persistence

### Data Storage Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                    AsyncStorage                         │
│  Fast, in-memory with persistent writes                 │
├─────────────────────────────────────────────────────────┤
│ • Project saves (@emojipaint/project/{id})              │
│ • Gallery vote history                                  │
│ • App settings (theme, audio, handedness)               │
│ • Feature flags cache                                   │
│ • Autosave checkpoints                                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│               File System (expo-file-system)            │
│  Persistent file storage, slower but unlimited size     │
├─────────────────────────────────────────────────────────┤
│ • Video exports (.mov, .gif, .mp4, .webm)              │
│ • Temporary frames during export                        │
│ • Custom brush PNG storage                              │
│ • Trace overlay images                                  │
│ • Gallery cache files                                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│            SQLite Database (expo-sqlite)                │
│  Structured data storage for complex queries            │
├─────────────────────────────────────────────────────────┤
│ • Gallery image cache                                   │
│ • Offline gallery metadata                              │
│ • Vote history with timestamps                          │
│ • User profiles (local copy)                            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Native Autosave Bridge                     │
│  iOS native module for crash recovery                   │
├─────────────────────────────────────────────────────────┤
│ • Periodic checkpoint saves (every 12 strokes)         │
│ • Max 4 checkpoints stored                              │
│ • Automatic recovery on app restart                     │
└─────────────────────────────────────────────────────────┘
```

---

## 🎬 Critical User Flows

### Flow 1: Create & Export Painting

```
1. Launch App
   └─ PaintScreen loads with blank canvas

2. Paint
   ├─ Select emoji from picker
   ├─ Adjust brush size (drag slider)
   ├─ Adjust opacity (drag slider)
   └─ Draw on canvas

3. Undo/Redo
   ├─ Tap undo button → removes last stroke
   ├─ Tap redo button → restores removed stroke
   └─ Supports up to 10,000 operations

4. Export
   ├─ Tap "Export" button
   ├─ TimelapseScreen shows preview
   ├─ Select format (GIF/MP4/WebM)
   ├─ Select quality (Low/Medium/High/Ultra)
   └─ Export completes

5. Share
   ├─ Save to Photos library
   ├─ Share via system sheet (Messages, Mail, etc.)
   └─ Copy to clipboard
```

### Flow 2: Create Animated Frames

```
1. Start from Paint Screen
   └─ Toggle "Framer" mode

2. Paint First Frame
   ├─ Canvas shows frame 1 of 1
   └─ Paint emoji strokes

3. Add Frames
   ├─ Tap "+" button to add frame
   ├─ Canvas shows frame 2 of N
   └─ Paint second frame

4. Adjust Stroke Persistence
   ├─ Use "Stroke Length" slider
   ├─ Set how many frames strokes appear
   ├─ See real-time preview
   └─ Pause = 1 frame, Play = configurable

5. Add Distortions
   ├─ Select emoji plane tool
   ├─ Drag corner points to distort
   ├─ Add keyframes at specific frames
   └─ Smooth interpolation between keyframes

6. Preview Animation
   ├─ Press play button
   ├─ Animation loops on canvas
   ├─ Adjust FPS if needed
   └─ Watch timeline scrub

7. Export
   ├─ Select GIF or MOV
   ├─ Choose quality
   ├─ Render concurrent frames
   └─ Save to Photos library
```

### Flow 3: Daily Word Challenge

```
1. Access Wording Mode
   ├─ From Paint Screen
   ├─ Tap "Wording" button
   └─ WordSelectionOverlay appears

2. Select Word
   ├─ Pick from daily suggestions
   ├─ Or enter custom word
   └─ Confirm selection

3. Paint Each Letter
   ├─ Letter 1 timer starts (60s)
   ├─ Paint letter strokes
   ├─ Timer counts down visually
   ├─ Timer expires automatically
   ├─ Letter video exported
   ├─ Canvas clears
   └─ Move to next letter (repeat)

4. Composition Complete
   ├─ All letters painted
   ├─ Final stitching in progress
   ├─ Composition video ready
   └─ Preview final result

5. Export Composition
   ├─ Tap "Export"
   ├─ Choose format
   ├─ Save or share
   └─ Complete
```

### Flow 4: Browse Gallery

```
1. Open Gallery
   ├─ From Export screen
   └─ Gallery browser appears

2. Browse by Topic
   ├─ See daily challenges
   ├─ Tap to filter by topic
   └─ See related paintings

3. Sort Results
   ├─ Newest (default)
   ├─ Hottest (trending)
   └─ Top (all-time best)

4. View Painting
   ├─ Tap gallery entry
   ├─ Full-screen preview
   └─ Shows artist info

5. Vote
   ├─ Tap upvote/downvote button
   ├─ Vote counted locally
   ├─ Synced to server on next refresh
   └─ Vote history saved

6. Download & Remix
   ├─ Tap "Download"
   ├─ Video saved to library
   ├─ Can reimport as trace or layer
   └─ Remix into your work
```

---

## 🚀 Performance Optimization Strategy

### 1. Stroke Rendering
**Problem:** 10,000 strokes would freeze UI if rendered every frame

**Solution: Stroke Replay System**
```
• No bitmap snapshots (saves memory)
• Pure stroke persistence (store only data)
• Replay strokes in sequence to rebuild canvas
• Memoization of frequently-used emoji sizes
• GPU caching of stamp patterns
```

### 2. Frame-by-Frame Performance
**Problem:** 300 FPS with full re-renders would be slow

**Solution: Smart Frame Caching**
```
• Only store frame metadata
• Replay strokes on demand
• Cache last N rendered frames
• Lazy load future frames
• Use Reanimated for smooth playback
```

### 3. Export Optimization
**Problem:** Exporting 4K video at 60 FPS = huge CPU load

**Solution: Metal GPU Acceleration + Batching**
```
• Metal-accelerated rendering (iOS native)
• Concurrent frame processing (iPad: 8 frames, iPhone: 4)
• Memory pooling for frame buffers
• Progressive export UI (show progress)
• Fallback to Skia if Metal unavailable
• iPad batch size = 8 (CRITICAL OPTIMIZATION for GIF export)
```

### 4. Memory Management
**Problem:** Mobile devices have limited RAM

**Solution: Streaming & Resource Pooling**
```
• Frame buffer recycling
• Stroke data compression
• Lazy load emojis on demand
• Clear unused emoji caches
• Monitor memory usage
• Warn user if approaching limits
```

---

## 🔌 Native Module Integration

### Five Native Modules

#### 1. Metal Rendering (`src/native/metal.ts`)
- GPU-accelerated emoji rendering
- Frame rendering optimization
- Feature flag: `useMetalExport`
- Fallback to Skia on older iOS versions

#### 2. Exporter (`src/native/exporter.ts`)
- Metal-accelerated GIF export
- MP4 encoding
- Concurrent frame batching
- Progress reporting

#### 3. Timelapse (`src/native/timelapse.ts`)
- Native video export pipeline
- Frame assembly
- Quality preset application
- Audio mixing (if supported)

#### 4. Screen Recorder (`src/native/screenRecorder.ts`)
- AVScreenRecorder integration
- Microphone audio capture
- Screen recording with watermark

#### 5. Stroke Log (`src/native/strokelog.ts`)
- Native stroke recording (telemetry)
- Performance profiling
- Optional telemetry collection

---

## 📁 Directory Structure Reference

```
/src
├── App.tsx                              # Entry point
├── screens/                             # Main app screens
│   ├── PaintScreen.tsx                  # Primary painting
│   ├── TimelapseScreen.tsx              # Timelapse player
│   ├── ExportScreen.tsx                 # Export & gallery
│   ├── SettingsScreen.tsx               # Preferences
│   ├── VideoEditorScreen.tsx            # 4K composition
│   └── ...
├── workspace/                           # Paint workspace
│   ├── PaintingWorkspace.tsx            # Main workspace
│   ├── PaintCanvas.tsx                  # Skia canvas
│   ├── EmojiCanvas.tsx                  # Emoji rendering
│   ├── CanvasViewport.tsx               # Gesture handling
│   ├── BrushControls.tsx                # Size/opacity
│   └── QuickActionsStrip.tsx            # Quick access
├── framer/                              # Animation editor
│   ├── FramerWorkspace.tsx              # Frame editor
│   ├── Timeline.tsx                     # Timeline UI
│   ├── FramerExporter.ts                # Export logic
│   └── FrameBuffer.ts                   # Frame storage
├── video/                               # Video systems
│   ├── VideoEditorScreen.tsx            # Composition editor
│   ├── VideoStorageScreen.tsx           # Gallery browser
│   ├── videoExport.ts                   # Export engine
│   ├── videoProcessing.ts               # Frame processing
│   ├── galleryVideoCache.ts             # Cache system (NEW)
│   ├── progressiveVideoLoader.ts        # Progressive loading (NEW)
│   └── videoStorage.ts                  # Storage management
├── animator/                            # Alternative animator
│   ├── AnimatorWorkspace.tsx
│   └── AnimatorRenderer.ts
├── components/                          # Shared UI
│   ├── EmojiPickerModal.tsx
│   ├── TimelapsePlayer.tsx
│   ├── Overlays/                        # 20+ modal overlays
│   └── ...
├── state/                               # Global state
│   └── PaintingContext.tsx              # Painting state + actions
├── context/                             # More contexts
│   └── AppSettingsContext.tsx           # Settings persistence
├── wording/                             # Word mode
│   ├── WordingContext.tsx
│   └── WordSelectionOverlay.tsx
├── lib/                                 # Business logic
│   ├── storage.ts                       # Project save/load
│   ├── timelapse.ts                     # Timelapse logic
│   ├── emojiCatalog.ts                  # Emoji database
│   ├── dailyPaintGallery.ts             # Gallery API
│   ├── galleryCacheManager.ts           # Cache management (NEW)
│   ├── offlineGallerySupport.ts         # Offline mode (NEW)
│   ├── customBrushes.ts                 # PNG brushes
│   ├── autosave.ts                      # Autosave logic
│   ├── gif.ts                           # GIF export
│   └── ... (30+ utilities)
├── native/                              # Native bridges
│   ├── metal.ts                         # Metal GPU
│   ├── exporter.ts                      # Exporter
│   ├── timelapse.ts                     # Timelapse
│   ├── screenRecorder.ts                # Screen recording
│   └── strokelog.ts                     # Telemetry
├── hooks/                               # React hooks
│   ├── useGalleryVideoLoading.ts        # Video loading (NEW)
│   └── ... (other hooks)
├── config/
│   └── features.ts                      # Feature flags
├── theme/                               # Styling
├── types/                               # TypeScript types
└── dev/                                 # Dev utilities

/modules                                 # Native iOS modules
├── emojipaint-exporter/                 # Export native module
│   ├── ios/                             # iOS source
│   ├── emojipaint-exporter.podspec
│   └── ...
├── metal-renderer/                      # Metal rendering module
└── ...
```

---

## 🧪 Testing Landscape

### Current State
- **Manual Testing:** FramerTest.tsx harness
- **Type Checking:** `npm run typecheck` (TypeScript strict mode)
- **Linting:** ESLint universe config
- **No Jest Suite:** Tests not integrated yet

### Test Files
- `/src/framer/__tests__/FramerTest.tsx` - Framer painting tests

---

## 🔄 Key Workflows at a Glance

| Workflow | Entry | Duration | Key Files |
|----------|-------|----------|-----------|
| Paint & Export | PaintScreen | 5-30 min | workspace/, videoExport.ts |
| Create Animation | PaintScreen → Framer | 10-60 min | framer/, FramerExporter.ts |
| Daily Challenge | Wording mode | 5-10 min | wording/, WordingContext.tsx |
| Compose Video | VideoEditor | 5-20 min | VideoEditorScreen.tsx |
| Browse Gallery | ExportScreen | 5-15 min | dailyPaintGallery.ts |
| Edit Settings | SettingsScreen | 1-5 min | AppSettingsContext.tsx |

---

## 📱 Device Optimization

### iPhone (iPhone 14/15)
- **Portrait only** (locked orientation)
- **Batch export:** 4 frames per batch
- **Max canvas:** 2048x2048
- **Memory limit:** ~500MB

### iPad (iPad Pro)
- **Landscape + Portrait** (auto-orientation)
- **Batch export:** 8 frames per batch (CRITICAL)
- **Max canvas:** 4096x4096
- **Memory limit:** ~2GB

### Orientation Handling
```
iPhone: Portrait locked
├─ Larger UI elements
├─ Vertical toolbar
└─ Single-column layout

iPad: Auto-landscape
├─ Compact UI when landscape
├─ Adaptive sidebars
├─ Two-column layout when space available
└─ Full-screen canvas
```

---

## 🎯 Success Metrics

### Performance Targets
- Painting framerate: 60 FPS (smooth interaction)
- Export time: <1 minute for 1080p, 30s preview
- App startup: <3 seconds
- Memory usage: <500MB (iPhone), <1.5GB (iPad)
- Undo/redo responsiveness: <50ms

### Feature Completeness
- ✅ Core painting (100%)
- ✅ Undo/redo (100%)
- ✅ Timelapse (100%)
- ✅ Export (100%)
- ✅ Frame-by-frame (95%)
- ✅ Emoji planes (90%)
- ✅ Gallery (100%)
- ✅ Wording mode (100%)
- ⚠️ Multiplayer (placeholder)
- ⚠️ MLkit integration (partial)

---

## 📋 Feature Flag System

**Location:** `src/config/features.ts`

```typescript
// Enable/disable features at runtime
FeatureFlags {
  useMetalExport: boolean           // GPU acceleration
  enableFramer: boolean             // Animation editor
  enableWordingMode: boolean        // Daily challenges
  enableGallery: boolean            // Community gallery
  enableOfflineCache: boolean       // Offline support
  enableCustomBrushes: boolean      // PNG brushes
  enableEmojiPlanes: boolean        // Distortion tools
  enableVideoEditor: boolean        // 4K composition
  enableMultiplayer: boolean        // Social features
  maxConcurrentFrames: number       // Batch size
}
```

---

## 🚀 Production Readiness

### Deployed & Working
- ✅ Core painting with emoji
- ✅ Full undo/redo system
- ✅ Timelapse + export (GIF/MP4/WebM)
- ✅ Frame-by-frame animation
- ✅ Community gallery
- ✅ Daily challenges
- ✅ Autosave + recovery
- ✅ iPad optimization
- ✅ Metal GPU acceleration
- ✅ Haptic feedback

### Known Issues
- ⚠️ Jest test suite not integrated (manual tests only)
- ⚠️ Some video codec edge cases on older iOS
- ⚠️ Multiplayer not fully implemented
- ⚠️ MLkit integration incomplete

---

## 📚 Useful Commands

```bash
# Development
npm start                   # Expo dev server
npm run ios                 # Build & run iOS simulator
npm run ios:release         # Release build

# Code Quality
npm run typecheck          # TypeScript validation
npm run lint               # ESLint validation
npm run test               # Run tests (when setup)

# Build
npm run build              # Full production build
npm run gen:icons          # Generate app icons
npm run gen:logos          # Generate logos
```

---

## 🔍 Key Learnings

### What Works Well
1. **Stroke replay system** - Efficient, memory-light
2. **Metal GPU acceleration** - 5x faster exports
3. **AsyncStorage for autosave** - Reliable recovery
4. **Gesture-first UI** - Intuitive for touch
5. **Feature flags** - Easy to toggle features

### Potential Improvements
1. **Jest test suite** - Currently manual only
2. **E2E testing framework** - For critical flows
3. **Performance monitoring** - Telemetry dashboard
4. **Accessibility** - VoiceOver support
5. **Localization** - i18n support beyond English

---

This document should serve as your reference guide for understanding the entire Emojipaint ecosystem. Bookmark it!
