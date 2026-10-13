# 🎬 Video Editor - Complete User Guide

## Table of Contents
1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Interface Overview](#interface-overview)
4. [Core Features](#core-features)
5. [Working with Layers](#working-with-layers)
6. [Projects System](#projects-system)
7. [Exporting Videos](#exporting-videos)
8. [Advanced Techniques](#advanced-techniques)
9. [Troubleshooting](#troubleshooting)
10. [Tips & Best Practices](#tips--best-practices)

---

## Introduction

The Video Editor is a professional 4K multi-layer video composition tool built into EmojiPaint. It allows you to:
- **Compose multiple video layers** on a 4K canvas (3840×2160)
- **Position, scale, and arrange** videos with precision
- **Save and load projects** with video preview thumbnails
- **Export in multiple formats** (MP4 and ProRes 4444 MOV with alpha transparency)
- **Create complex compositions** like picture-in-picture, split-screen, collages, and overlays

Whether you're creating social media content, video art, or professional compositions, the Video Editor provides powerful tools in an intuitive interface.

---

## Getting Started

### How to Access the Video Editor

1. **From Paint Screen**: Tap the **Projects button (💾)** at the bottom
2. **Projects Overview**: Tap **🎥 Video Storage**
3. **Video Storage**: Tap **🎬 Video Editor** in the top-right corner

### Before You Begin

Make sure you have videos in **Video Storage**:
- Export timelapse videos from your emoji paintings
- Import videos from your device camera roll
- Use screen recordings or any MP4/MOV videos

💡 **Pro Tip**: The Video Editor works best with 3-5 video layers. Keep compositions simple for optimal performance.

---

## Interface Overview

### Top Toolbar (Always Visible)

Located at the top of the screen:

#### 📁 Projects Button
- **Function**: Opens the Saved Projects modal
- **What it does**: Shows all your saved video editor projects with thumbnails
- **Actions available**: Load, Export, or Delete projects

#### ℹ️ Info Button
- **Function**: Opens this comprehensive guide
- **What it shows**: Complete documentation of all features, buttons, and workflows
- **Includes**: FFmpeg licensing information

#### 💾 Save Button
- **Function**: Saves your current composition as a project
- **Animated emoji**: Cycles through 💿 → 📀 → 💽 when idle
- **Snapshot**: Automatically captures a thumbnail of your canvas
- **Auto-naming**: Creates a name like "Composition 12/8/2025"

#### 📤 Export Button
- **Function**: Exports your composition to a video file
- **Formats**: Choose between MP4 or MOV (ProRes 4444)
- **Output**: Saves to Video Storage for sharing

#### ❌ Close Button
- **Function**: Exits the Video Editor
- **Auto-save**: Your session is automatically saved when you exit

### Canvas Controls

#### 🔓/🔒 Lock Button (Top-Left, Large)
- **Position**: Top-left corner
- **Size**: 3x larger than normal (48px emoji)
- **Style**: No background panel, just the emoji
- **States**:
  - **🔓 Unlocked** (White): You can drag and move video layers on the canvas
  - **🔒 Locked** (Orange): Canvas is locked, prevents accidental layer movements
- **Toggle**: Tap to switch between locked/unlocked
- **Use case**: Lock the canvas when you're adjusting zoom/scale to prevent accidentally moving layers

#### Zoom Slider (Top-Right, Half-Width)
- **Label**: "ZOOM"
- **Position**: Top-right corner
- **Range**: 8% to 50%
  - **8%**: See the entire 4K canvas at once (great for overview)
  - **50%**: Close-up detail view
  - **~25%**: Default balanced view
- **Function**: Controls how zoomed in/out the canvas viewport is
- **Independent**: Does NOT affect layer size, only your view
- **iPad Auto-Zoom**: On iPad, automatically animates from 8% to 30% when you enter the editor (smooth 1-second transition)

#### Scale Slider (Bottom-Right, Half-Width)
- **Label**: "SCALE"
- **Position**: Bottom-right, appears only when a layer is selected
- **Visibility**: Only shows when you have an orange-bordered layer selected
- **Range**: 10% to 500%
  - **10%**: Tiny (1/10th original size)
  - **100%**: Original video size
  - **500%**: Huge (5x original size)
- **Function**: Resizes the selected video layer
- **Center-based scaling**: Scales from the center point, not top-left corner
- **Per-layer**: Each layer remembers its own scale independently

### Bottom Controls

#### 📋 Layers Button (Bottom-Left)
- **Format**: "📋 Layers (N)" where N = number of layers
- **Function**: Opens the Layer Management Panel
- **Panel features**:
  - View all layers in a vertical list
  - Drag to reorder layers (change z-index)
  - See layer thumbnails and video names
  - Delete layers with 🗑️ trash icon
  - Top of list = front of composition
  - Bottom of list = back of composition

#### + Add Video Button (Bottom-Left)
- **Style**: Large blue button with + symbol
- **Function**: Opens the Video Picker
- **Picker shows**: All videos from Video Storage
- **Behavior**:
  - Selected video is added to canvas center
  - New layer is automatically selected (orange border)
  - Scale slider appears immediately
  - Default scale: 100% (original size)

#### Layer Filmstrip (Bottom)
- **Layout**: Horizontal scrollable row of thumbnails
- **Thumbnails**: Small preview images of each video layer
- **Selection**:
  - **Orange border**: Selected layer (active)
  - **White border**: Unselected layers
- **Interaction**: Tap a thumbnail to select that layer
- **Alternative**: You can also tap directly on the video in the canvas to select it

---

## Core Features

### Canvas Specifications

- **Resolution**: 3840 × 2160 pixels (4K UHD)
- **Aspect Ratio**: 16:9 widescreen
- **Color Space**: RGBA (with alpha transparency support)
- **Coordinate System**: Top-left origin (0, 0)
- **Background**: Transparent (checkered pattern shown in editor)
- **Frame indicator**: 4K boundary shown as a border (hidden during export)

### Layer System

#### What are Layers?
Each video you add becomes a **layer** in your composition. Layers are:
- **Independent**: Each has its own position, scale, and z-index
- **Stackable**: Layers overlap based on their order
- **Selectable**: Only one layer can be selected at a time
- **Movable**: Drag layers around when canvas is unlocked
- **Scalable**: Resize each layer individually from 10% to 500%

#### Layer Properties
Each layer stores:
- **Video ID**: Reference to the video file in storage
- **Position (x, y)**: Exact pixel coordinates on 4K canvas
- **Scale**: Size multiplier (0.1 to 5.0)
- **Z-Index**: Stacking order (higher = in front)

#### Layer Rendering
- Layers are rendered from back to front (low z-index to high)
- All videos loop continuously
- Videos maintain aspect ratio when scaled
- Transparency is preserved (especially important for emoji timelapses)

---

## Working with Layers

### Adding a Video Layer

**Step-by-step**:
1. Tap the **+ Add Video** button (bottom-left)
2. Video Picker modal opens
3. Browse and tap a video from your Video Storage
4. Video appears in the **center of the canvas**
5. New layer is automatically **selected** (orange border)
6. **Scale slider** appears at bottom-right

**Limitations**:
- If no videos exist in storage, you'll see an error
- Recommended: Keep compositions to 3-5 layers for best performance

### Selecting a Layer

**Method 1: Tap on Canvas**
- Tap directly on the video you want to select
- Orange border appears around the video
- Scale slider appears at bottom-right

**Method 2: Tap Thumbnail**
- Tap the layer's thumbnail in the bottom filmstrip
- Same result as Method 1

**Visual feedback**:
- **Selected layer**: Orange border, visible in both canvas and filmstrip
- **Unselected layers**: White/gray border

### Moving a Layer

**Requirements**:
- Canvas must be **unlocked** (🔓 showing)
- Layer must be **selected** (orange border)

**Steps**:
1. Make sure canvas shows 🔓 (if not, tap to unlock)
2. Select the layer you want to move
3. **Drag** the video to a new position
4. Position is tracked in exact pixel coordinates
5. Release to place

**Tips**:
- Zoom out (8%) to see the entire canvas while positioning
- Lock canvas (🔒) when done to prevent accidental moves
- Use small adjustments for precision

### Scaling a Layer

**Requirements**:
- Layer must be **selected** (orange border showing)
- Scale slider appears automatically when layer is selected

**Steps**:
1. Select the layer (tap video or thumbnail)
2. Locate the **Scale slider** at bottom-right
3. **Drag left** to shrink (down to 10%)
4. **Drag right** to enlarge (up to 500%)
5. Real-time preview as you adjust

**Scale behavior**:
- **Center-based**: Video scales from its center point, not corner
- **Maintains aspect ratio**: No distortion
- **Independent**: Each layer has its own scale
- **Precise**: Fine control from 10% to 500%

**Use cases**:
- **10-30%**: Small picture-in-picture
- **50-80%**: Medium overlay
- **100%**: Original video size
- **150-300%**: Enlarged detail/crop effect
- **400-500%**: Extreme close-up/abstract effect

### Reordering Layers (Z-Index)

**Why reorder?**
- Control which videos appear in front or behind
- Essential for proper composition layering
- Front layers can overlap and obscure back layers

**Steps**:
1. Tap **📋 Layers (N)** button
2. Layer Management Panel opens
3. See vertical list of all layers with thumbnails
4. **Drag a layer** up or down in the list
5. Release to set new order
6. **Top of list** = **front** of composition
7. **Bottom of list** = **back** of composition

**Example**:
- Background video: Move to bottom
- Main subject: Keep in middle
- Overlays/effects: Move to top

### Deleting a Layer

**Steps**:
1. Tap **📋 Layers (N)** button
2. Find the layer you want to remove
3. Tap the **🗑️ trash icon** next to the layer
4. Confirm deletion in the alert dialog
5. Layer is permanently removed from composition

**Notes**:
- Cannot undo deletion (save project before deleting)
- Video file remains in Video Storage (only removed from composition)

---

## Projects System

### Saving a Project

**When to save**:
- After arranging your layers
- Before making major changes (as a backup)
- When taking a break
- Before exporting (good practice)

**Steps**:
1. Tap **💾 Save** button in top toolbar
2. **Loader appears**: Shows "💾 Saving Project..." with animated emoji
3. **Snapshot captured**: Canvas is captured as a thumbnail (includes all video layers)
4. **Auto-naming**: Project named like "Composition 12/8/2025"
5. **Success alert**: "✅ Saved" confirmation appears
6. Takes ~1-2 seconds total

**What gets saved**:
- All layer video IDs
- Exact positions (x, y) of each layer
- Scale values for each layer
- Z-index (stacking order)
- Timestamp of save
- Thumbnail snapshot (JPEG, 70% quality)

**Storage**:
- Saved to AsyncStorage: `@video_editor_projects`
- Projects are local to your device
- Not synced to cloud

### Loading a Project

**Steps**:
1. Tap **📁 Projects** button in top toolbar
2. **Saved Projects** modal opens
3. Browse list of projects with thumbnails
4. Each project shows:
   - **Thumbnail**: Visual preview of composition
   - **Project name**: "Composition [date]"
   - **Layer count**: "N layers"
   - **Date**: Last saved timestamp
5. Tap **Load** button on the desired project
6. All layers, positions, and scales are restored exactly

**Important**:
- All videos from the project must still exist in Video Storage
- If a video was deleted, the project can't fully load
- Current unsaved work is replaced (save first if needed)

### Project Overview Features

**Each project card displays**:
- **Thumbnail preview**: 100×56px snapshot with border
- **Project name**: Up to 2 lines of text
- **Details**: Layer count and date in smaller text
- **Action buttons** (vertical column on right):
  - **Load**: Opens the project in the editor
  - **Export**: Exports project as JSON file for backup
  - **Delete**: Permanently removes the project (confirmation required)

**Improved layout**:
- Smaller, compact buttons (60px width)
- More space for project name
- Buttons arranged vertically to save horizontal space
- Cleaner, more professional appearance

### Auto-Save Feature

**When you exit the editor**:
- Current session is automatically saved to: `@video_editor_active_session`
- Next time you open the editor, your work is restored
- Acts as a safety net if you forget to manually save

---

## Exporting Videos

### Export Formats

#### MP4 (MPEG-4)
- **Codec**: H.264
- **Color space**: YUV420p
- **Bitrate**: 8 Mbps
- **Pros**:
  - Smaller file size
  - Universal compatibility
  - Great for social media
- **Cons**:
  - No transparency support
  - Slight quality loss (acceptable for most uses)
- **Best for**: Instagram, YouTube, TikTok, general sharing

#### MOV (ProRes 4444)
- **Codec**: Apple ProRes 4444
- **Color space**: YUVA444p10le (10-bit with alpha)
- **Quality**: Visually lossless
- **Pros**:
  - **Preserves transparency** (alpha channel)
  - Highest quality
  - Ideal for further editing
- **Cons**:
  - Very large file size (GBs)
  - Limited compatibility (needs pro software)
- **Best for**: Professional workflows, After Effects, Final Cut Pro, compositing

### How to Export

**Steps**:
1. Arrange all layers as desired
2. Preview the composition (play through)
3. Tap **📤 Export** button in top toolbar
4. **Format selection alert** appears:
   - "Export as MP4" → Standard format
   - "Export as MOV (ProRes 4444)" → Professional format with transparency
5. Choose your format
6. **Export starts**:
   - Progress overlay appears
   - Shows percentage (0% to 100%)
   - Displays status messages
   - Canvas preview visible in background
7. **Wait for completion**:
   - Time varies based on:
     - Video length
     - Number of layers
     - Device performance
   - Typical: 30-60 seconds for 10-second composition with 2 layers
8. **Success**:
   - "✅ Export Complete" alert
   - Video saved to **Video Storage**
   - Ready to share from Video Storage

**⚠️ Important**:
- **DO NOT close the app** during export
- **DO NOT lock your device** during export
- Keep the app in foreground
- Export may fail if interrupted

### Export Progress Indicators

While exporting, you'll see:
- **Progress bar**: Visual indicator of completion
- **Percentage**: Numeric progress (e.g., "45%")
- **Status text**: Current operation (e.g., "Processing layer 2/3", "Rendering composition", "Finalizing video")
- **Canvas preview**: Shows what's being rendered

### Export Quality & Specs

- **Resolution**: Always 3840 × 2160 (4K UHD)
- **Frame rate**: Matches the longest video layer
  - If all videos are 30fps → export is 30fps
  - If one video is 60fps → export is 60fps
- **Duration**: Equals the longest video layer
  - If longest video is 10 seconds → export is 10 seconds
  - Shorter videos loop to fill duration
- **Audio**: Currently not supported (video only)

---

## Advanced Techniques

### Picture-in-Picture (PiP)

**Setup**:
1. Add main video (background)
2. Scale to 100% (or larger if needed)
3. Position in center
4. Add second video (foreground)
5. Scale to 20-30% (small)
6. Position in corner (e.g., bottom-right)
7. Reorder: Background = bottom, PiP = top

**Result**: Small video appears in corner of main video

### Split-Screen (2-up)

**Setup**:
1. Add first video
2. Scale to 50% (half size)
3. Position on left side of canvas (x = 0 or low value)
4. Add second video
5. Scale to 50%
6. Position on right side of canvas (x = ~1920)
7. Ensure both videos are same height

**Result**: Two videos side-by-side, each taking half the screen

### Collage (Grid Layout)

**Setup**:
1. Add 4 videos
2. Scale each to 50%
3. Position in grid:
   - Top-left: x = 0, y = 0
   - Top-right: x = 1920, y = 0
   - Bottom-left: x = 0, y = 1080
   - Bottom-right: x = 1920, y = 1080

**Result**: 4 videos in a 2×2 grid

### Overlay Effects

**Setup**:
1. Add background video (scale 100%, center)
2. Add overlay video with transparency (e.g., emoji timelapse)
3. Scale overlay as desired
4. Position over background
5. Ensure overlay is in front (higher z-index)

**Result**: Transparent video layer composited over background

**Note**: Only works properly with MOV (ProRes 4444) export to preserve transparency

### Ken Burns Effect (Simulated)

**Limitation**: Editor doesn't support animation, but you can create pseudo-motion:
1. Create multiple layers of same video
2. Scale each layer differently (e.g., 100%, 150%, 200%)
3. Position slightly offset
4. Rapidly cycle through layers in external editor

**Better approach**: Use this editor for layout, then animate in After Effects or similar

---

## Troubleshooting

### "No Videos" Error

**Problem**: Can't add videos to canvas

**Causes**:
- Video Storage is empty
- No videos imported or exported yet

**Solutions**:
1. Go back to Video Storage
2. Import videos from camera roll (📥 button)
3. Or export timelapse videos from Paint screen
4. Return to Video Editor and try again

### Layer Won't Move

**Problem**: Can't drag a layer

**Causes**:
- Canvas is locked (🔒 showing)

**Solution**:
- Tap the 🔒 button to unlock (should show 🔓)
- Now you can drag layers

### Can't Find Scale Slider

**Problem**: Scale slider not visible

**Causes**:
- No layer is selected

**Solution**:
- Tap on a video layer (on canvas or in filmstrip)
- Orange border appears
- Scale slider appears at bottom-right

### Export Failed or Crashed

**Problem**: Export stops or app crashes

**Causes**:
- Insufficient memory
- Too many layers
- Very long videos
- App interrupted

**Solutions**:
1. **Close other apps** to free RAM
2. **Reduce layer count** (aim for 3-5 max)
3. **Use shorter videos** (under 30 seconds)
4. **Restart app** and try again
5. Try **MP4 export** instead of MOV (less intensive)
6. Ensure device is **plugged in** or has >50% battery

### Project Won't Load

**Problem**: Tapping "Load" doesn't work

**Causes**:
- One or more videos from the project were deleted from Video Storage
- Project file is corrupted

**Solutions**:
1. Check Video Storage to ensure all videos still exist
2. If videos are missing, restore from backup or re-import
3. If corruption, the project may be unrecoverable

### Layers Disappear or Not Visible

**Problem**: Added layer isn't showing

**Causes**:
- Layer is behind another layer (z-index issue)
- Layer is off-screen (positioned outside canvas)
- Layer is extremely small (scale too low)

**Solutions**:
1. **Check z-index**: Open 📋 Layers panel, reorder if needed
2. **Zoom out** to 8% to see full canvas
3. **Check scale**: Select layer, adjust scale slider up
4. **Reset position**: Delete and re-add layer (starts at center)

### Thumbnail Not Showing Videos

**Problem**: Project thumbnail is blank or doesn't show video layers

**Causes**:
- Snapshot captured before videos finished loading
- React Native video components don't render to canvas snapshot

**Solutions**:
- This is a known limitation with react-native-video and captureRef
- Thumbnails show canvas layout but may not show video frames
- Project still loads correctly (only thumbnail is affected)

---

## Tips & Best Practices

### Composition Tips

1. **Start with Background**: Always add your background layer first, then build on top
2. **Layer Order Matters**: Think in terms of back-to-front (like Photoshop layers)
3. **Use Zoom Wisely**:
   - **8%** for overall layout
   - **25-30%** for general work
   - **50%** for precision adjustments
4. **Lock When Done**: Lock canvas (🔒) after positioning to prevent accidental moves
5. **Save Often**: Save multiple versions (projects don't overwrite each other)
6. **Preview Before Export**: Play through composition to catch issues

### Performance Tips

1. **Limit Layers**: 3-5 layers is optimal, 10+ may cause lag
2. **Shorter Videos**: 10-30 seconds is ideal, 1-2 minutes max
3. **Close Other Apps**: Free up RAM before exporting
4. **Avoid Interruptions**: Don't lock device or switch apps during export
5. **Use MP4 for Preview**: Export quick MP4 tests, save MOV for final

### Workflow Tips

**Recommended workflow**:
1. **Planning**: Sketch out your composition idea
2. **Gather Videos**: Ensure all videos are in Video Storage
3. **Unlock Canvas**: Start with 🔓
4. **Zoom Out**: Set to 8% to see full canvas
5. **Add All Layers**: Add all videos before positioning
6. **Position**: Move layers to rough positions
7. **Scale**: Adjust sizes for each layer
8. **Reorder**: Set z-index in 📋 Layers panel
9. **Fine-tune**: Zoom to 25-30%, make small adjustments
10. **Lock Canvas**: Tap 🔒 to prevent accidents
11. **Save Project**: Tap 💾
12. **Test Export**: Export as MP4 to preview
13. **Final Export**: Export as MOV if you need transparency

### Creative Ideas

- **Music Video Effects**: Layer emoji timelapses over performance footage
- **Social Media Content**: Create Instagram Reels with animated emoji overlays
- **Video Collages**: Combine multiple clips into a grid
- **Reaction Videos**: Small reaction video in corner of main content
- **Titles/Credits**: Use emoji animations as animated text alternatives
- **Backgrounds**: Scale emoji timelapses to 200-300% for abstract backgrounds

### Common Mistakes to Avoid

❌ **Forgetting to unlock canvas** before trying to move layers
✅ Always check for 🔓 first

❌ **Not selecting the right layer** before scaling
✅ Look for orange border to confirm selection

❌ **Exporting before checking layer order**
✅ Preview in editor, check z-index in 📋 Layers

❌ **Closing app during export**
✅ Wait for "✅ Export Complete" alert

❌ **Not saving project before making major changes**
✅ Save multiple versions as you work

❌ **Using too many layers** (15+)
✅ Keep it to 3-5 for best performance

❌ **Ignoring layer order** and wondering why things are hidden
✅ Use 📋 Layers panel to visualize and reorder

---

## Keyboard Shortcuts & Gestures

### Touch Gestures

- **Single Tap (on video)**: Select layer
- **Single Tap (on thumbnail)**: Select layer
- **Drag (unlocked canvas)**: Move selected layer
- **Drag (slider)**: Adjust zoom or scale
- **Tap (outside layer)**: Deselect current layer (optional)

### No Keyboard Shortcuts

- This is a touch-based interface
- All controls are optimized for finger/stylus input
- No keyboard shortcuts currently supported

---

## Specifications Summary

### Canvas
- **Resolution**: 3840 × 2160 pixels (4K UHD)
- **Aspect Ratio**: 16:9
- **Color Space**: RGBA (with alpha channel)
- **Coordinate System**: Top-left origin (0, 0)

### Zoom Range
- **Minimum**: 8% (full canvas overview)
- **Maximum**: 50% (close-up detail)
- **Default**: ~25% (balanced view)

### Scale Range (Per Layer)
- **Minimum**: 10% (very small, 1/10th size)
- **Maximum**: 500% (huge, 5x size)
- **Default**: 100% (original size)

### Export Formats
- **MP4**: H.264/MPEG-4, YUV420p, 8M bitrate, no transparency
- **MOV**: ProRes 4444, YUVA444p10le, 10-bit, alpha channel support

### Supported Video Formats (Import)
- **Containers**: MP4, MOV, M4V
- **Codecs**: H.264, HEVC (H.265), ProRes
- **Resolutions**: Any (will be scaled/positioned on 4K canvas)
- **Aspect Ratios**: Any (maintains aspect when scaled)

### Storage Locations
- **Projects**: AsyncStorage `@video_editor_projects`
- **Active Session**: AsyncStorage `@video_editor_active_session`
- **Video Files**: Expo FileSystem cache directory
- **Exports**: Video Storage directory (accessible from main app)

---

## FAQ

**Q: How many layers can I add?**
A: Technically unlimited, but 3-5 layers is recommended for best performance. 10+ layers may cause lag.

**Q: Can I use my own videos?**
A: Yes! Import them through Video Storage (📥 button in Video Storage screen).

**Q: Does it work offline?**
A: Yes! All editing happens on-device. No internet required.

**Q: Where are my exports saved?**
A: Exported videos go to Video Storage, accessible from the main app. From there you can share to camera roll or other apps.

**Q: Can I edit the videos themselves (trim, cut, effects)?**
A: No, this is a composition tool. You position, scale, and layer videos, but don't trim or edit their content. Use other apps for trimming first.

**Q: Will my phone get hot during export?**
A: Yes, 4K video rendering is intensive. This is normal and expected. Keep device plugged in if possible.

**Q: How long does export take?**
A: Depends on video length, layer count, and device. Typical example: 10-second composition with 2 layers = 30-60 seconds.

**Q: Can I cancel an export?**
A: Currently no. Let it complete. Future update may add this feature.

**Q: What if I run out of storage?**
A: Delete old videos/exports from Video Storage, or old projects from Saved Projects modal.

**Q: Can I share projects with others?**
A: Projects are local only. Use the "Export" button in the project list to export as JSON for backup, but this is advanced. Better to share the exported video file.

**Q: Why doesn't my thumbnail show the video frames?**
A: Technical limitation with react-native-video and snapshot capture. Thumbnails show canvas layout but not always video content. Projects still load correctly.

**Q: Can I add audio or music?**
A: Not currently. Videos export without audio. Add music in a separate video editor after exporting.

**Q: What's the difference between Lock (🔒) and selecting a layer?**
A: Lock prevents ALL layer movements. Selection just highlights one layer for scaling/info. You can have a layer selected while canvas is locked.

**Q: Can I rotate videos?**
A: Not currently. Videos are positioned and scaled only. No rotation support yet.

**Q: Can I add text or drawings?**
A: Not directly. But you can create emoji "text" in the Paint screen, export as timelapse, then layer it over videos.

---

## Credits & Legal

### FFmpeg & FFmpeg Kit

This Video Editor uses **FFmpeg** and **FFmpeg Kit** for video processing:

- **FFmpeg** is licensed under the **LGPL v2.1** license
  - Copyright © 2000-2024 the FFmpeg developers
  - https://ffmpeg.org

- **FFmpeg Kit** is licensed under the **LGPL v3.0** license
  - Copyright © 2018-2024 Taner Sener
  - https://github.com/arthenica/ffmpeg-kit

This software is provided "as is" without warranty of any kind.

---

## Support & Feedback

Need help? The Video Editor is designed to be intuitive, but if you run into issues:

1. Check the [Troubleshooting](#troubleshooting) section above
2. Make sure you have the latest app version
3. Restart the app if something seems stuck
4. Report bugs through the app's feedback system

---

**Happy Creating! 🎬✨**

Made with 💙 by the EmojiPaint team
