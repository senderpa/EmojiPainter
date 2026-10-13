# 🚀 Production Build Checklist - Emoji Painter v6.1.1

## ✅ PRE-BUILD VERIFICATION (COMPLETED)

### Version Numbers
- [x] **package.json**: `6.1.1` ✅
- [x] **app.json**: `6.1.1` ✅
- [x] **iOS Info.plist**: `6.1.1` ✅
- [x] **iOS Build Number**: `6.1.1` ✅

### Code Cleanup
- [x] Debug button (📌) removed from Framer workspace ✅
- [x] All debugging features disabled ✅

### Features Ready
- [x] MOV/MP4 video export in Framer ✅
- [x] Topic challenges with timer ✅
- [x] Video & image logo animations (59 total) ✅
- [x] Gallery with video support ✅
- [x] Backend API with MOV upload support ✅

---

## 📋 BUILD STEPS FOR APP STORE

### 1. Clean Build Environment
```bash
cd /Users/senderp/emojipaint-mobile2030

# Clean Xcode build cache
rm -rf ios/build
rm -rf ~/Library/Developer/Xcode/DerivedData/*EmojiPainter*

# Clean node modules (optional, only if needed)
# rm -rf node_modules
# npm install
```

### 2. Open Xcode and Configure
```bash
open ios/EmojiPainter.xcworkspace
```

**In Xcode:**
1. Select **EmojiPainter** project in left sidebar
2. Select **EmojiPainter** target
3. Go to **Signing & Capabilities** tab
4. Verify:
   - ✅ Team is selected
   - ✅ Bundle Identifier: `com.emojipaint.mobile`
   - ✅ Signing Certificate is valid
   - ✅ Provisioning Profile is "Automatic"

### 3. Set Build Configuration
1. In Xcode top toolbar, select:
   - Scheme: **EmojiPainter**
   - Device: **Any iOS Device (arm64)**
2. Go to: **Product** → **Scheme** → **Edit Scheme**
3. Select **Archive** in left sidebar
4. Verify **Build Configuration** is set to: **Release** ✅

### 4. Archive the Build
1. **Product** → **Archive**
2. Wait for build to complete (5-10 minutes)
3. Xcode Organizer will open automatically

### 5. Upload to App Store Connect
**In Xcode Organizer:**
1. Select the archive (should show version 6.1.1)
2. Click **Distribute App**
3. Select **App Store Connect**
4. Click **Upload**
5. Select distribution options:
   - ✅ Upload your app's symbols (for crash reports)
   - ✅ Manage Version and Build Number (Xcode will handle)
6. Click **Upload**
7. Wait for upload to complete

### 6. Submit for Review (App Store Connect)
1. Go to: https://appstoreconnect.apple.com
2. Select **Emoji Painter**
3. Click **+ Version or Platform** → **iOS**
4. Enter version: **6.1.1**
5. Fill out **What's New in This Version**:
   ```
   🎬 Video Export Support
   • Export your emoji paintings as high-quality MOV videos
   • Perfect for sharing on social media

   ⏱️ Topic Challenge Improvements
   • Enhanced sprint timer display
   • Smoother video export process

   🎨 Animation Enhancements
   • Added video-based logo animations
   • Improved loading screens

   🐛 Bug Fixes & Performance
   • Fixed iPad drawing touch detection
   • Improved export reliability
   • General stability improvements
   ```
6. Select the build (6.1.1)
7. Complete all required metadata
8. Click **Submit for Review**

---

## ⚠️ IMPORTANT NOTES

### App Store Review Checklist
- [ ] Test account credentials provided (if needed)
- [ ] Privacy Policy URL is valid
- [ ] Support URL is working
- [ ] Screenshots are up-to-date
- [ ] App preview video (optional but recommended)

### Export Compliance
- [x] **usesNonExemptEncryption**: `false` (set in app.json) ✅
- No need for export compliance documentation

### Device Requirements
- Minimum iOS: 13.4
- Supports: iPhone, iPad
- Orientations: Portrait, Landscape

### Backend Status
⚠️ **Action Required**: Upload fallback API files to enable MOV uploads
- `list-sql-fallback.php` → rename to `list-sql.php`
- `storage-sql-fallback.php` → rename to `storage-sql.php`
- Files location: `/Users/senderp/Downloads/api/`

---

## 🧪 TESTING BEFORE SUBMISSION

### Critical Paths to Test:
1. **Daily Paint Challenge**
   - [x] Start a new painting
   - [x] Complete within time limit
   - [x] Upload to gallery

2. **Topic Challenge**
   - [x] Start sprint challenge
   - [x] Timer countdown works
   - [x] Hoorah overlay appears
   - [x] MOV export completes
   - [x] Upload to gallery

3. **Framer Workspace**
   - [x] Drawing with emoji strokes
   - [x] Frame animation playback
   - [x] Export as MOV
   - [x] Export as GIF
   - [x] Save/Load workspace

4. **Gallery**
   - [x] View uploaded paintings
   - [x] Video entries play correctly
   - [x] Voting works
   - [x] Sorting works

---

## 📱 BUILD COMMANDS (Alternative Methods)

### Build with Xcode (Recommended)
```bash
# Archive for distribution
xcodebuild -workspace ios/EmojiPainter.xcworkspace \
  -scheme EmojiPainter \
  -configuration Release \
  -archivePath ~/Desktop/EmojiPainter.xcarchive \
  archive
```

### Build with Expo/EAS (If Using EAS Build)
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure build
eas build:configure

# Submit build to App Store
eas build --platform ios --profile production
eas submit --platform ios
```

---

## 📊 POST-RELEASE CHECKLIST

After app is approved and live:
- [ ] Monitor crash reports in Xcode Organizer
- [ ] Check App Store reviews
- [ ] Test MOV uploads on production server
- [ ] Monitor backend API for errors
- [ ] Update marketing materials with new version

---

## 🆘 TROUBLESHOOTING

### Build Fails in Xcode
1. Clean build folder: **Product** → **Clean Build Folder** (Cmd+Shift+K)
2. Delete DerivedData: `rm -rf ~/Library/Developer/Xcode/DerivedData`
3. Re-run archive

### Signing Issues
1. Go to **Signing & Capabilities**
2. Uncheck "Automatically manage signing"
3. Re-check "Automatically manage signing"
4. Select your team again

### Archive Not Appearing
1. Verify scheme is set to **Release** configuration
2. Verify device is set to **Any iOS Device**
3. Clean and rebuild

### Upload Fails
1. Check Apple ID has required permissions
2. Verify app exists in App Store Connect
3. Check bundle identifier matches exactly

---

## 📞 SUPPORT

If you encounter issues:
1. Check Xcode console for error messages
2. Review build logs: **Report Navigator** (Cmd+9)
3. Check App Store Connect for rejection reasons
4. Review Apple's App Store Review Guidelines

---

## ✨ VERSION HISTORY

### v6.1.1 (Current)
- MOV video export support
- Topic challenge improvements
- Video logo animations
- iPad drawing fixes
- Production-ready release

---

**Ready to archive and submit! 🚀**

Last updated: January 13, 2026
