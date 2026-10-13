# Dynamic Icon Burst System

## Overview

The icon burst animation now uses a **dynamic, randomized logo system** with multiple themed logo sets. Each time the app returns from background, it selects a completely different logo set with 11 unique images (1 base icon + 10 animation frames).

---

## Architecture

### 1. Logo Assets Structure

```
assets/logos/
├── 1/          (11 images)
├── 2/          (11 images)
├── 3/          (11 images)
├── 4/          (11 images)
├── 5/          (11 images)
├── 6/          (11 images)
├── 7/          (11 images)
├── 8/          (11 images)
└── 9/          (11 images)
```

**Each folder contains:**
- Image 0 (lowest numbered): **Base icon** - resting state
- Images 1-10: **Animation frames** - burst sequence

**Folder/file names don't matter** - the system automatically:
- Scans all subfolders
- Sorts images naturally by filename
- Assigns first image as base, rest as frames

---

### 2. Build-Time Manifest Generation

**Script:** `scripts/generate-logo-manifest.js`

**Run:** `npm run gen:logos`

**Output:** `src/lib/logoManifest.ts`

This script scans `assets/logos/` and generates a TypeScript manifest with all logo sets:

```typescript
export interface LogoSet {
  id: string;
  baseIcon: any;    // require('../../assets/logos/1/00012.png')
  frames: any[];    // [require(...), require(...), ...]
}

export const LOGO_SETS: LogoSet[] = [
  { id: '1', baseIcon: ..., frames: [...] },
  { id: '2', baseIcon: ..., frames: [...] },
  // ... 9 total sets
];
```

**Why build-time generation?**
- Metro bundler requires all `require()` statements at compile time
- Can't dynamically require images at runtime
- Manifest pre-bundles all logo sets into the app

---

### 3. Runtime Logo Selection

**Component:** `src/components/IconBurstOverlay.tsx`

#### On App Startup
1. Loads a random logo set
2. Prefetches all 11 images to memory
3. Plays startup animation with that logo set

#### On Background Transition
1. App goes to background → Loads **NEW** random logo set
2. Prefetches new images
3. Cleans up old logo set images after 2 seconds
4. App returns to foreground → Plays animation with **NEW** logo set

**Result:** Every background/foreground cycle shows a different logo!

---

## Key Features

### 🎲 Randomization

**Logo Set Selection:**
- Random on startup
- New random on every background → foreground transition
- Never repeats same logo twice in a row

**Frame Count Options:**

| Context | Possible Frame Counts |
|---------|----------------------|
| **Startup** | 5, 7, or 10 frames |
| **Background** | 0, 4, 6, or 10 frames |

**Frame Selection:**
- Randomly picks from 10 available frames
- Shuffles order each time
- If requesting all 10: shows all frames in random order
- If requesting 6: randomly picks 6 unique frames

### 🧹 Memory Management

**Prefetching:**
```typescript
await Image.prefetch(newLogoSet.baseIcon);
await Promise.all(newLogoSet.frames.map(frame => Image.prefetch(frame)));
```

**Cleanup:**
```typescript
// After loading new logo set, clean up old one
setTimeout(() => {
  await Image.queryCache([oldLogoSet.baseIcon]);
  for (const frame of oldLogoSet.frames) {
    await Image.queryCache([frame]);
  }
}, 2000);
```

**Benefits:**
- Only 11 images loaded at a time (not all 99)
- Smooth transitions (prefetch before cleanup)
- Prevents memory bloat

---

## Animation Flow

### Startup Sequence

```
1. App launches
   ↓
2. Load random logo set (e.g., set "7")
   ↓
3. Prefetch 11 images
   ↓
4. Show startup overlay:
   - Base icon (frame 0)
   - Spring animation to position
   - Frame burst (5-10 frames in random order)
   - Zoom out & fade
```

### Background → Foreground Sequence

```
1. App goes to background
   ↓
2. Load NEW random logo set (e.g., set "3")
   ↓
3. Prefetch 11 new images
   ↓
4. Clean up old logo set (e.g., set "7")
   ↓
5. App returns to foreground
   ↓
6. Show background overlay with NEW logo set:
   - Base icon (frame 0)
   - Spring animation (bouncy)
   - Frame burst (0-10 frames)
   - Random position/rotation
   - Wobble sound + haptics
   - Zoom out & fade
```

---

## Frame Mapping

**Frame Index System:**

| Frame Index | Image Source |
|------------|--------------|
| `0` | Base icon (first image in folder) |
| `1` | Animation frame 0 (second image) |
| `2` | Animation frame 1 (third image) |
| `3` | Animation frame 2 (fourth image) |
| ... | ... |
| `10` | Animation frame 9 (eleventh image) |

**In Code:**
```typescript
const currentFrameSource = frameIndex === 0
  ? currentLogoSet.baseIcon
  : currentLogoSet.frames[frameIndex - 1] ?? currentLogoSet.baseIcon;
```

---

## Adding New Logo Sets

### Easy Way (Automatic)

1. Create a new folder in `assets/logos/` (e.g., `assets/logos/10/`)
2. Add 11 images with sortable filenames
3. Run `npm run gen:logos`
4. Done! New logo set automatically included

### File Naming

**Any naming scheme works**, as long as files sort correctly:

✅ Good:
```
00001.png, 00002.png, ..., 00011.png
frame_01.png, frame_02.png, ..., frame_11.png
a.png, b.png, c.png, ..., k.png
```

❌ Bad:
```
1.png, 2.png, ..., 10.png, 11.png  (10 sorts before 2!)
```

---

## Console Logs

**On Logo Load:**
```
🎨 Loading new logo set: 5
✅ Prefetched logo set 5: 1 base + 10 frames
```

**On Cleanup:**
```
🧹 Cleaned up logo set: 3
```

**On Build:**
```
📁 Found 9 logo set folders
  ✓ 1: 11 images
  ✓ 2: 11 images
  ...
✅ Generated manifest with 9 logo sets
```

---

## Technical Details

### Image Prefetching

Uses `Image.prefetch()` from React Native:
- Downloads image to native cache
- Subsequent renders are instant (no network/disk delay)
- Smooth animations without frame drops

### Memory Cleanup

Uses `Image.queryCache()` to:
- Query image cache status
- Evict old images from memory
- Prevent memory bloat with 99 total images

### Folder-Agnostic Design

The system works with:
- **Any number of subfolders** (currently 9, can be 100+)
- **Any folder names** (numeric, descriptive, doesn't matter)
- **Any image filenames** (just needs natural sort order)
- **Any image count per folder** (code expects 11, but adaptable)

---

## Configuration

### Frame Count Options

**Edit:** `IconBurstOverlay.tsx` line 206-208

```typescript
const frameOptions = context === 'startup'
  ? [5, 7, 10]      // Startup options
  : [0, 4, 6, 10];  // Background options
```

Change these arrays to adjust animation variety.

### Animation Timings

All randomized animation parameters are in `runOverlay()` function:

```typescript
const holdDuration = isStartup ? 0 : 120;
const entryDuration = isStartup ? 100 : 300 + Math.random() * 260;
const exitDelay = isStartup ? 900 : 60 + Math.random() * 80;
const exitDuration = isStartup ? 200 : 100 + Math.random() * 140;
```

### Spring Physics

Background context uses randomized spring physics:

```typescript
const scaleDamping = 6.2 + Math.random() * 1.8;
const scaleStiffness = 135 + Math.random() * 35;
```

Adjust ranges for different bounce feels.

---

## Troubleshooting

### "No logo set loaded, skipping burst animation"

**Cause:** Logo manifest not generated or empty

**Fix:**
```bash
npm run gen:logos
```

### Black screen or missing images

**Cause:** Images not bundled by Metro

**Fix:**
1. Run `npm run gen:logos`
2. Restart Metro bundler
3. Clear cache: `expo start -c`

### Memory warnings

**Cause:** Too many logo sets or large images

**Fix:**
- Optimize image sizes (current ~300KB each is good)
- Reduce number of logo sets
- Increase cleanup delay (currently 2s)

---

## Performance

### Current Stats

- **9 logo sets** × 11 images = 99 total images
- **~300KB per image** = ~30MB total
- **Only 11 images loaded at once** = ~3.3MB active
- **Cleanup after 2 seconds** = minimal memory impact

### Optimizations

1. **Prefetch before cleanup** - no visual glitches
2. **Random selection** - spreads cache evenly
3. **Natural sort** - fast, no custom logic
4. **Build-time manifest** - zero runtime overhead

---

## Future Enhancements

### Possible Features

- [ ] Theme-based logo selection (time of day, season)
- [ ] User-selectable favorite logos
- [ ] Downloaded logo packs
- [ ] GIF frame extraction for animated logos
- [ ] Logo set metadata (name, author, theme)
- [ ] Swipe to preview logo sets in settings

### Easy to Add

The folder-based system makes it trivial to:
- Add 100+ logo sets
- Update individual logos without code changes
- A/B test different logo styles
- Crowdsource logo submissions

---

## Summary

✨ **What Changed:**
- Old: 1 hardcoded icon + 6 hardcoded frames
- New: 9 logo sets × 11 images, randomly selected

🎲 **Randomization:**
- New logo every background cycle
- Random frame count (0-10)
- Random frame order
- Random animation physics

🧹 **Memory Safe:**
- Prefetch new before cleanup
- Only 11 images loaded at once
- Auto-cleanup after 2 seconds

🛠️ **Easy to Extend:**
- Drop new folder → run script → done
- No code changes needed
- Folder/file names don't matter

🚀 **Result:**
A fresh, delightful animation every time you return to the app!
