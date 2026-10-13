# Building & Testing Emojipaint on Real iOS Devices

This guide walks you through building the app to a real iPhone/iPad and testing it thoroughly.

---

## 📱 Prerequisites

### Hardware
- [ ] Mac with Xcode installed
- [ ] iPhone or iPad (iOS 15+)
- [ ] USB cable to connect device

### Software
```bash
# Check Node version
node --version                           # Should be 18+

# Check npm version
npm --version                             # Should be 8+

# Check Xcode
xcode-select -p                           # Should show path to Xcode

# Check iOS deployment target
xcrun simctl list runtimes | grep iOS     # See available iOS versions
```

### Apple Developer Setup
- [ ] Apple Developer Account (free or paid)
- [ ] Device added to provisioning profile
- [ ] Certificates generated

---

## 🔧 Step 1: Prepare Your Device

### 1.1 Enable Developer Mode (iOS 16+)
1. Unlock your iPhone/iPad
2. Go to **Settings → Privacy & Security**
3. Scroll to bottom, tap **Developer Mode**
4. Toggle **Developer Mode** ON
5. Restart device when prompted

### 1.2 Trust Developer Certificate
1. Connect device via USB to Mac
2. Unlock device and tap **Trust** when prompted
3. Device should appear in Xcode

### 1.3 Connect to Xcode
```bash
# Check if device is recognized
xcrun xcode-select --install            # Install command line tools if needed

# List connected devices
xcrun xcode-select -p/Platforms/iPhoneOS.platform/Developer/usr/bin/instruments -s devices

# Or in Xcode:
# Window → Devices & Simulators
```

---

## 🏗️ Step 2: Build the App

### 2.1 Install Dependencies
```bash
# From project root
cd /Users/senderp/emojipaint-mobile2030

# Clean install
rm -rf node_modules package-lock.json
npm install

# Verify iOS deployment
npm run typecheck        # Should show 0 errors
```

### 2.2 Build iOS App (Method 1: Expo)
```bash
# Using Expo CLI (recommended for development)
npm start

# Then in Expo prompt:
# Press 'i' to open iOS simulator
# OR scan QR code with Expo Go app on real device
```

### 2.3 Build iOS App (Method 2: Direct Xcode)
```bash
# Generate native iOS project
npx expo prebuild --clean

# This creates /ios directory with native Xcode project

# Then open in Xcode
open ios/EmojiPainter.xcworkspace

# In Xcode:
# 1. Select your device from top bar
# 2. Product → Build (⌘B)
# 3. Product → Run (⌘R)
```

### 2.4 Build iOS App (Method 3: Command Line)
```bash
# Build directly from command line
cd ios

# Build for device
xcodebuild -workspace EmojiPainter.xcworkspace \
  -scheme EmojiPainter \
  -configuration Debug \
  -destination generic/platform=iOS \
  -derivedDataPath build \
  build

# Or release build
xcodebuild -workspace EmojiPainter.xcworkspace \
  -scheme EmojiPainter \
  -configuration Release \
  -destination generic/platform=iOS \
  -derivedDataPath build \
  build-for-testing
```

---

## ✅ Step 3: Test on Real Device

### 3.1 Installation Verification
```
✓ App launches without crashing
✓ Splash screen appears
✓ Main PaintScreen loads
✓ No red error screen
✓ All UI buttons visible
✓ No yellow warnings
```

### 3.2 Basic Functionality Tests

#### Paint Functionality
```
[ ] Can paint strokes
  - Tap emoji picker → Select emoji
  - Tap and drag on canvas → Stroke appears
  - Stroke has correct emoji character
  - Stroke position matches touch point

[ ] Brush Controls Work
  - Size slider: Changes painted stroke size (1-255px)
  - Opacity slider: Changes stroke transparency
  - Preview shows current settings
  - Values persist when painted

[ ] Undo/Redo
  - Tap undo button → Last stroke removed
  - Tap redo button → Stroke reappears
  - Works up to 10 times
  - Undo button disabled when no history
```

#### Trace Overlay
```
[ ] Can load trace image
  - Tap "Trace" button
  - Select image from photos
  - Image appears on canvas
  - Can adjust opacity (0-100%)
  - Can pinch-zoom image
  - Can pan image around canvas
  - Trace doesn't interfere with painting
```

#### Zoom & Pan
```
[ ] Canvas zooming works
  - Pinch-zoom expands/contracts canvas
  - Zoom limited to 0.5x - 4x
  - Zoom center is correct

[ ] Canvas panning works
  - Two-finger drag pans canvas
  - Canvas doesn't scroll off screen
  - Panning speed feels responsive
```

#### Mirror & Rotation
```
[ ] Mirror X works
  - Enable mirror X
  - Paint → Appears mirrored on X axis
  - Disable → Back to normal

[ ] Mirror Y works
  - Same as mirror X but on Y axis

[ ] Rotation works
  - Rotate slider changes canvas rotation
  - Painting angle adjusts correctly
```

---

### 3.3 Performance Tests

#### Responsiveness
```
[ ] Painting feels smooth
  - No lag when painting
  - Frame rate appears 60 FPS
  - No frame drops visible

[ ] Undo/redo instant
  - Undo/redo appears immediately (<100ms)
  - No loading spinner

[ ] Scrolling emoji picker smooth
  - No stutter when scrolling through emojis
  - Scrolling decelerates smoothly

[ ] Brush size changes smooth
  - Size slider drag is smooth
  - No freezing when adjusting
```

#### Memory Usage
```
[ ] Paint many strokes (100+)
  - App doesn't crash
  - Still responsive
  - Undo still works
  - Memory shows in debug (optional)

[ ] Leave app running
  - 5 minutes: No increase in memory
  - 15 minutes: Still responsive
  - No memory leaks visible
```

#### Battery
```
[ ] Normal usage: Battery drains at normal rate
  - ~1 hour per 10% battery drain
  - No excessive heat
```

---

### 3.4 Framer (Animation) Tests

#### Frame Creation
```
[ ] Can enter Framer mode
  - Tap "Framer" toggle → Switches mode
  - Timeline appears at bottom
  - Shows "Frame 1 of 1"

[ ] Can create frames
  - Tap "+" button → Adds new frame
  - Shows "Frame 2 of 2"
  - Paint on new frame → Different content
  - Previous frame unchanged

[ ] Frame navigation works
  - Tap frame in timeline → Jumps to it
  - Timeline shows current position
  - Canvas updates correctly
```

#### Stroke Persistence
```
[ ] Stroke length slider controls persistence
  - Length=1: Stroke only on painted frame
  - Length=5: Stroke appears for 5 consecutive frames
  - Real-time preview shows persistence

[ ] Playback shows correct persistence
  - Play → Animation loops
  - Each frame shows correct strokes
  - Animation timing matches FPS setting
```

#### Animation Playback
```
[ ] Playback animation
  - Press play button → Animation runs
  - Framerate shows (e.g., "30 FPS")
  - Can change FPS (12-300)
  - Pause stops animation
  - Scrubber moves with playback
```

#### Export Animation
```
[ ] Export to GIF
  - Select quality (Low/Medium/High/Ultra)
  - Tap export → Progress bar appears
  - GIF saves to Photos
  - Can share to social media
  - File size reasonable for quality

[ ] Export to MP4
  - Similar to GIF
  - MP4 file created in Photos
  - Can play in Photos app
```

---

### 3.5 Timelapse/Export Tests

#### Timelapse Playback
```
[ ] Timelapse shows painting process
  - Paint 5+ strokes
  - Tap "Export" → TimelapseScreen shows
  - Playback shows painting animation
  - Scrubber works for seeking
  - Speed can be adjusted
```

#### Export Process
```
[ ] Quality selection
  - Can select: Low, Medium, High, Ultra
  - Preview updates based on quality
  - Resolution shows (e.g., "1024x1024")

[ ] Format selection
  - Can select: GIF, MP4, WebM
  - Each shows file size estimate
  - Format appropriate for use case

[ ] Export progress
  - Progress bar shows during export
  - Can see percentage completion
  - Export time < 2 minutes for 1080p

[ ] Post-export
  - Export completes without error
  - File saved to Photos library
  - Can view in Photos app
  - Can share via system sheet
```

---

### 3.6 Gallery Tests (Offline Support)

#### Online Gallery
```
[ ] Can open gallery
  - From ExportScreen → Gallery appears
  - Shows loading spinner if fetching
  - Gallery entries appear (if connected)

[ ] Can filter by sort
  - Newest: Shows latest first
  - Hottest: Shows trending first
  - Top: Shows highest rated first

[ ] Can vote
  - Tap upvote → Changes to filled
  - Tap downvote → Changes to filled
  - Vote count increases
  - Vote history saved
```

#### Offline Mode (NEW - Cache System)
```
[ ] Cache galleries while online
  - Paint and export paintings
  - Open gallery → Videos cached
  - Entries saved for offline

[ ] Browse offline with airplane mode
  - Toggle airplane mode ON
  - Open gallery → Shows cached entries
  - Entries marked "Cached 2h ago"
  - Can view thumbnails

[ ] Play cached videos
  - Tap cached entry
  - Video plays from cache
  - No network request
  - Instant playback (0.1s)

[ ] Offline indicators
  - Offline entries show badge
  - No error trying to load
  - Shows "Cached X time ago"
```

---

### 3.7 Daily Wording Challenge Tests

```
[ ] Can start word challenge
  - Tap "Wording" → Selection overlay
  - Can see daily word suggestions
  - Can enter custom word

[ ] Letter painting works
  - Select word (e.g., "HELLO")
  - Timer starts: 60 seconds for 'H'
  - Can paint letter
  - Undo/redo works

[ ] Timer behavior
  - Countdown visible and accurate
  - Timer expiration: Auto-export
  - Canvas clears for next letter
  - Moves to 'E' automatically

[ ] Completion
  - All letters painted
  - Composition stitching starts
  - Final video generated
  - Can export composition

[ ] Export final
  - Final composition playable
  - Shows all letters in sequence
  - Can save to Photos
  - Can share
```

---

### 3.8 Settings & Persistence Tests

```
[ ] Theme changing
  - Dark theme works
  - Light theme works
  - Theme persists after restart

[ ] Sound toggle
  - Can toggle on/off
  - Setting persists
  - Brush sounds play/muted appropriately

[ ] Handedness setting
  - Can toggle right/left handed
  - UI flips appropriately
  - Setting persists

[ ] Project auto-saving
  - Paint strokes
  - Wait 30 seconds
  - Close app → Reopen
  - Strokes still there
  - Undo history preserved

[ ] Autosave recovery
  - Force close app (kill process)
  - Reopen app
  - Previous work restored
  - No data loss
```

---

### 3.9 Video Cache System Tests (NEW)

```
[ ] Video caching on WiFi
  - Open gallery on WiFi
  - First video loads (2-3 seconds)
  - Scroll back to same video
  - Loads instantly (<0.1s)
  - Check console: [GalleryVideoCache] Using cached

[ ] Connection-aware quality
  - Check connection type
  - On WiFi: Videos load high quality
  - On 4G: Videos load medium quality
  - See console: [ProgressiveVideoLoader] WiFi detected

[ ] Offline video access
  - Cache videos while online
  - Toggle airplane mode
  - Gallery still shows videos
  - Videos play from cache
  - No network errors

[ ] Progressive loading
  - Gallery loads slowly
  - Thumbnail shows first
  - Low-res preview loads in background
  - Full video appears when ready
  - User never sees loading screen

[ ] Cache stats
  - Check cache size (Settings)
  - Should show: Videos: X, Size: YMB
  - Should update after loading
  - Manual cleanup reduces size
```

---

### 3.10 UI/UX Polish Tests

```
[ ] Orientation handling
  - iPhone: Portrait lock (only portrait)
  - iPad: Landscape + portrait auto-rotate
  - Buttons reposition on rotation
  - Canvas resizes appropriately

[ ] Safe area handling
  - No UI hidden by notch/dynamic island
  - Buttons accessible on edges
  - Text readable everywhere

[ ] Keyboard behavior
  - Keyboard doesn't cover input fields
  - Keyboard dismisses on done
  - No overlap issues

[ ] Haptic feedback
  - Brush stroke → Haptic pulse
  - Button press → Haptic feedback
  - Toggle settings → Haptic on/off

[ ] Loading states
  - Loading spinners appear during long operations
  - Loading states are cancellable
  - Error states show helpful messages
```

---

## 🐛 Debugging on Real Device

### Enable Debug Logs
```bash
# Open console in Xcode
# Xcode → Window → Devices & Simulators
# Select device → Open console

# Or use Expo CLI debug
npm start
# Then press 'd' for DevTools menu
```

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| App won't install | Provisioning profile | Check Xcode: Account & Preferences |
| Crashes on startup | Missing native module | Run `npx expo prebuild --clean` |
| Slow performance | Memory leak | Check Xcode Instruments for leaks |
| Video export fails | Codec unavailable | Use H.264 instead of ProRes |
| Gallery blank | API unreachable | Check network, verify API endpoint |
| Cache not working | File permissions | Check Documents directory access |

---

## 📊 Test Report Template

Create a test report for each build:

```
═══════════════════════════════════════════════════════════════════
Build Date: ___________
Device: ___________  (iPhone/iPad, Model, iOS Version)
Build Version: ___________
Tester: ___________

PAINTING FUNCTIONALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Paint strokes with emoji
✓ Brush size control (1-255px)
✓ Opacity control (0-100%)
✓ Undo/redo (up to 10 actions)
✓ Mirror X/Y
✓ Rotation
✓ Trace overlay with adjustments
Performance: ___/10  (Smoothness 1-10)
Notes: _________________________________

FRAMER (ANIMATION)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Create multiple frames
✓ Stroke persistence per frame
✓ Timeline navigation
✓ Animation playback
✓ Frame export (GIF/MP4)
Performance: ___/10
Issues: _________________________________

EXPORT & SHARING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Export formats (GIF/MP4/WebM)
✓ Quality presets
✓ Save to Photos library
✓ Share via social media
Export time (1080p): _____ seconds
File size (typical): _____ MB

GALLERY & CACHING (NEW)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Offline video caching
✓ Video instant playback (cached)
✓ Connection-aware quality
✓ Progressive loading
✓ Works offline
Cache size: _____ MB
Videos cached: _____

SETTINGS & PERSISTENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Auto-save (30s debounce)
✓ Undo history persists
✓ Settings persist across restarts
✓ Crash recovery works

PERFORMANCE METRICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
App startup: _____ seconds
Memory usage: _____ MB
CPU during painting: _____ %
Memory growth (5 min usage): _____ MB

DEVICE-SPECIFIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Device: iPhone 14 / iPhone 15 / iPad Pro 12.9
iOS Version: _____
Portrait mode: ✓/✗
Landscape mode (iPad): ✓/✗
Notch/Dynamic Island: No issues / Issues: ______

CRITICAL ISSUES FOUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ ] App crashes
[ ] UI not visible
[ ] Functions broken
[ ] Performance unacceptable
[ ] Other: ________________

MINOR ISSUES FOUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ ] UI layout issues
[ ] Text overlaps
[ ] Colors off
[ ] Performance could improve
[ ] Other: ________________

OVERALL ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: ✓ PASS / ⚠️ NEEDS WORK / ✗ FAIL

Build Quality: ___/10
Ready for Beta: YES / NO
Ready for Production: YES / NO

Recommendations: _______________________________
═══════════════════════════════════════════════════════════════════
```

---

## 🎯 Sign-Off Checklist

Before considering the app ready:

- [ ] All core features work on iPhone
- [ ] All core features work on iPad
- [ ] No crashes detected
- [ ] Performance acceptable (60 FPS painting)
- [ ] Export completes within 2 minutes
- [ ] Gallery caching works
- [ ] Offline mode works
- [ ] Settings persist
- [ ] Autosave works
- [ ] Undo/redo works reliably
- [ ] No red errors in console
- [ ] Memory usage stable
- [ ] Battery drain acceptable

---

## 🚀 Ready for TestFlight?

Once all tests pass:

```bash
# Create release build
npm run build

# Archive for distribution
xcodebuild -workspace ios/EmojiPainter.xcworkspace \
  -scheme EmojiPainter \
  -configuration Release \
  -archivePath build/EmojiPainter.xcarchive \
  archive

# Upload to TestFlight via App Store Connect
# (Requires Apple Developer account)
```

---

**Happy testing! 🎨**
