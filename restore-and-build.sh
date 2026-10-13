#!/bin/bash

# Restore and build script for EmojiPaint with screen-recorder

set -e

cd /Users/senderp/emojipaint-mobile2030

echo "Restoring iOS directory from backup..."
cp -R ios.backup.20251030_163252 ios

echo "Running post-prebuild script to add screen-recorder..."
node scripts/post-prebuild.js

echo "Installing CocoaPods..."
cd ios
pod install

echo "✅ Ready to build in Xcode!"
echo ""
echo "Next steps:"
echo "1. Open /Users/senderp/emojipaint-mobile2030/ios/EmojiPainter.xcworkspace in Xcode"
echo "2. Select your device"
echo "3. Click Build (⌘B) and Run (⌘R)"
echo ""
echo "The native screen recorder is ready to use!"
