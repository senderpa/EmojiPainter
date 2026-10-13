#!/bin/bash
set -e

echo "🔧 Fixing damaged Xcode project..."

# Navigate to iOS directory
cd ios

# Remove damaged project
echo "📦 Removing damaged project file..."
rm -rf EmojiPainter.xcodeproj/project.pbxproj

# Recreate from CocoaPods
echo "🔄 Regenerating project from Podfile..."
cd ..
rm -rf ios/Pods
rm -rf ios/Podfile.lock
cd ios
pod install

echo "✅ Project regenerated!"
echo ""
echo "📝 Now add Metal files manually in Xcode:"
echo "   1. Open: open ios/EmojiPainter.xcworkspace"
echo "   2. Right-click 'EmojiPainter' folder → Add Files to 'EmojiPainter'..."
echo "   3. Navigate to: EmojiPainter/MetalCanvas/"
echo "   4. Select ALL files (⌘A)"
echo "   5. Check: ☑ Copy items if needed, ☑ Create groups, ☑ Add to targets: EmojiPainter"
echo "   6. Click 'Add'"
echo ""
echo "Then build: Product → Build (⌘B)"
