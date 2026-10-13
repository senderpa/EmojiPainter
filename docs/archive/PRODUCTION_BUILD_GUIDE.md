# Production Build Guide - Emoji Painter v6.0.3
**Date**: January 6, 2026
**Status**: Production Ready

## Overview
This guide covers building Emoji Painter for production/release deployment on iOS and Android.

## Prerequisites

- Node.js ≥ 18.0.0
- Xcode (latest version for iOS)
- Valid Apple Developer account (for device/App Store builds)
- Android Studio (for Android builds)

## Build Scripts

### iOS Production Builds

#### Simulator (Release Configuration)
```bash
npm run ios:release
```
- Builds with Release configuration
- Optimized for performance
- Minified JavaScript bundle
- Production-ready

#### Physical Device
```bash
npm run build:device
```
- Builds for connected iOS device
- Release configuration
- Requires provisioning profile
- Ready for testing on real hardware

#### Quick Build (Simulator)
```bash
npm run build
```
- Same as `ios:release`
- Default production build command

### Android Production Builds

```bash
npm run android:release
```
- Builds release variant
- Generates signed APK/AAB
- Production-ready

### Development Builds

#### Development (Debug Mode)
```bash
npm start
# or
npm run ios
npm run android
```

#### Production Mode Metro (Testing)
```bash
npm run start:prod
```
- Runs Metro bundler in production mode
- Minified bundles
- No dev warnings
- Good for testing production bundle before building

## App Configuration

### Version Numbers (app.json)
Current version: **6.0.3**

```json
{
  "version": "6.0.3",
  "ios": {
    "buildNumber": "6.0.3"
  }
}
```

**To bump version:**
1. Update `version` field
2. Update `ios.buildNumber`
3. Update `package.json` version
4. Commit changes

### Production Settings (app.json)

```json
{
  "jsEngine": "hermes",                    // Use Hermes for better performance
  "ios": {
    "requireFullScreen": false,            // Support multitasking on iPad
    "config": {
      "usesNonExemptEncryption": false    // Required for App Store submission
    }
  }
}
```

## Build Configurations

### iOS Build Schemes

The Xcode project has two configurations:
- **Debug**: Development builds with debugging enabled
- **Release**: Production builds with optimizations

**Release configuration enables:**
- JavaScript minification
- Dead code elimination
- Performance optimizations
- Smaller bundle size
- No React DevTools
- No console warnings in production

### Hermes Engine

Enabled by default (`jsEngine: "hermes"` in app.json)

**Benefits:**
- Faster app startup
- Reduced memory usage
- Better performance
- Smaller bundle size

## Building for App Store

### 1. Prepare Build

```bash
# Ensure dependencies are up to date
npm install

# Run type checks
npm run typecheck

# Generate icons if needed
npm run gen:icons
npm run gen:logos
```

### 2. Build Release Version

```bash
npm run build:device
```

### 3. Archive in Xcode

1. Open project in Xcode:
   ```bash
   open ios/EmojiPainter.xcworkspace
   ```

2. Select "Any iOS Device" as destination

3. Product → Archive

4. Upload to App Store Connect

### 4. App Store Submission

- Version: 6.0.3
- Bundle ID: `com.emojipaint.mobile`
- Export compliance: Not using encryption (already configured)
- Privacy descriptions: Already included in Info.plist

## Performance Optimization

### Production Build Features

✅ **JavaScript Bundle:**
- Minified
- Tree-shaken
- Hermes bytecode

✅ **Native Code:**
- Optimized (-O3)
- Debug symbols stripped
- Smaller binary

✅ **Assets:**
- Compressed images
- Optimized fonts
- Bundled efficiently

✅ **Runtime:**
- No dev warnings
- No debugging overhead
- Production error handling

## Testing Production Builds

### Pre-Release Checklist

- [ ] Version number updated (6.0.3)
- [ ] Type checks pass (`npm run typecheck`)
- [ ] No console errors
- [ ] Frame-by-frame animations smooth
- [ ] Image-based frames working
- [ ] Wording challenge completes
- [ ] Startup overlay shows correct version
- [ ] All export formats work (GIF, MOV, MP4)
- [ ] Play & paint mode stamps correctly
- [ ] No memory leaks during long sessions

### Testing on Device

```bash
# Build and install on connected device
npm run build:device

# Monitor logs
# (In Xcode: Window → Devices and Simulators → Open Console)
```

### Performance Testing

1. **Frame Rate**: Should maintain 60 FPS
2. **Memory**: Monitor in Xcode Instruments
3. **Startup Time**: < 2 seconds on modern devices
4. **Frame Duplication**: Instant even with 500+ strokes
5. **Playback**: Smooth with 100+ frames

## Troubleshooting

### Build Fails

**Clean and rebuild:**
```bash
cd ios
pod deintegrate
pod install
cd ..
npm run build
```

### Metro Bundler Issues

```bash
# Clear cache and rebuild
npx expo start --clear
```

### Provisioning Profile Errors

1. Check Apple Developer account status
2. Verify bundle identifier matches (`com.emojipaint.mobile`)
3. Download latest provisioning profiles in Xcode

### Missing Dependencies

```bash
npm install
cd ios && pod install && cd ..
```

## File Sizes

**Expected Production Bundle Sizes:**
- iOS IPA: ~80-120 MB
- JavaScript Bundle: ~5-8 MB (minified)
- Assets: ~3-5 MB

## Environment Variables

### Production Mode

Metro automatically uses production mode when building with Release configuration.

**What changes in production:**
- `__DEV__` is `false`
- `process.env.NODE_ENV === 'production'`
- PropTypes checks disabled
- DevTools disabled

## Distribution

### TestFlight (Beta Testing)

1. Build and archive in Xcode
2. Upload to App Store Connect
3. Submit for TestFlight review
4. Invite testers

### App Store (Public Release)

1. Complete TestFlight testing
2. Create App Store listing
3. Submit for App Store review
4. Release after approval

## Version History

- **6.0.3** (Current) - Image-based frames, play & paint fixes, production ready
- 6.0.2 - Version updates and icon fixes
- 6.0.1 - Speed slider improvements
- 6.0.0 - Major release

## Support

### Build Issues
Check logs in:
- Metro bundler terminal
- Xcode build log
- `ios/build/` directory

### Runtime Issues
- Use Xcode Console for device logs
- Check `__DEV__` is false in production
- Verify Hermes is enabled

## Quick Reference

```bash
# Production iOS build (simulator)
npm run ios:release

# Production iOS build (device)
npm run build:device

# Production Android build
npm run android:release

# Production metro (testing)
npm run start:prod

# Type checking
npm run typecheck

# Open in Xcode
open ios/EmojiPainter.xcworkspace
```

## Post-Release

After successful release:
1. Tag git commit: `git tag v6.0.3`
2. Create release notes
3. Update changelog
4. Plan next version features

---

**Production Status**: ✅ Ready for Release
**Last Updated**: January 6, 2026
