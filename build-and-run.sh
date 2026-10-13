#!/bin/bash
set -e

echo "🧹 Cleaning build folder..."
cd ios
xcodebuild clean -workspace EmojiPainter.xcworkspace -scheme EmojiPainter -configuration Release

echo ""
echo "🔨 Building with Metal modules..."
xcodebuild build -workspace EmojiPainter.xcworkspace -scheme EmojiPainter -configuration Release -destination generic/platform=iOS | grep -E "✓|error|warning|MetalCanvas|NativeAutosave|NativeProject" || true

cd ..

echo ""
echo "📱 Deploying to device..."
npx react-native run-ios --device --mode Release

echo ""
echo "✅ Done! Check console for:"
echo "   ✅ Metal rendering available"
echo "   ✅ [EmojiAtlas] Texture cache initialized"
echo "   ✅ [NativeSnapshot] GPU snapshot storage ready"
echo "   ✅ [NativeAutosave] Background thread ready"
echo "   ✅ [NativeProject] Projects directory ready"
