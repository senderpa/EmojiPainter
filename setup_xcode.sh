#!/bin/bash

# Xcode Project Setup Script for Metal Integration
# This script helps you add Metal modules to the Xcode project

set -e

echo "🔧 Emojipaint Metal Integration - Xcode Setup"
echo "============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -d "ios/EmojiPainter" ]; then
    echo -e "${RED}❌ Error: ios/EmojiPainter directory not found${NC}"
    echo "Please run this script from the project root directory"
    exit 1
fi

# Check if Metal modules exist
if [ ! -d "ios/EmojiPainter/MetalCanvas" ]; then
    echo -e "${RED}❌ Error: Metal modules not found${NC}"
    echo "Expected directory: ios/EmojiPainter/MetalCanvas"
    exit 1
fi

echo "✅ Project structure verified"
echo ""

# Count Metal module files
SWIFT_FILES=$(find ios/EmojiPainter/MetalCanvas -name "*.swift" | wc -l | tr -d ' ')
OBJC_FILES=$(find ios/EmojiPainter/MetalCanvas -name "*.m" | wc -l | tr -d ' ')

echo "📦 Found Metal modules:"
echo "   - $SWIFT_FILES Swift files"
echo "   - $OBJC_FILES Objective-C bridge files"
echo ""

echo "📋 Files to add to Xcode:"
echo "   ios/EmojiPainter/MetalCanvas/EmojiAtlas.swift"
echo "   ios/EmojiPainter/MetalCanvas/MetalCanvasModule.swift"
echo "   ios/EmojiPainter/MetalCanvas/MetalCanvasModule.m"
echo "   ios/EmojiPainter/MetalCanvas/StrokeLogModule.swift"
echo "   ios/EmojiPainter/MetalCanvas/StrokeLogModule.m"
echo "   ios/EmojiPainter/MetalCanvas/MP4ExporterModule.swift"
echo "   ios/EmojiPainter/MetalCanvas/MP4ExporterModule.m"
echo ""

echo -e "${YELLOW}⚠️  MANUAL STEP REQUIRED${NC}"
echo ""
echo "The following steps must be completed manually in Xcode:"
echo ""
echo "1️⃣  Open Xcode workspace:"
echo "   open ios/EmojiPainter.xcworkspace"
echo ""
echo "2️⃣  Add Metal source files:"
echo "   - Right-click 'EmojiPainter' in Project Navigator"
echo "   - Select 'Add Files to EmojiPainter'"
echo "   - Navigate to: ios/EmojiPainter/MetalCanvas/"
echo "   - Select ALL files (.swift and .m)"
echo "   - Check: ☑ Copy items if needed"
echo "   - Check: ☑ Create groups"
echo "   - Check: ☑ Add to target: EmojiPainter"
echo "   - Click 'Add'"
echo ""
echo "3️⃣  Link Metal frameworks:"
echo "   - Select 'EmojiPainter' project"
echo "   - Select 'EmojiPainter' target"
echo "   - Go to 'Build Phases' tab"
echo "   - Expand 'Link Binary With Libraries'"
echo "   - Click '+' button"
echo "   - Add: Metal.framework"
echo "   - Add: MetalKit.framework"
echo ""
echo "4️⃣  Verify bridging header:"
echo "   - Select 'EmojiPainter' target"
echo "   - Go to 'Build Settings' tab"
echo "   - Search for 'bridging'"
echo "   - Verify 'Objective-C Bridging Header' is set to:"
echo "     EmojiPainter/EmojiPainter-Bridging-Header.h"
echo ""
echo "5️⃣  Clean and build:"
echo "   - Product → Clean Build Folder (⇧⌘K)"
echo "   - Product → Build (⌘B)"
echo ""

# Check if workspace exists
if [ ! -f "ios/EmojiPainter.xcworkspace/contents.xcworkspacedata" ]; then
    echo -e "${RED}⚠️  Warning: Xcode workspace not found${NC}"
    echo "Run 'cd ios && pod install' first"
    echo ""
fi

# Offer to open Xcode
echo -e "${GREEN}Ready to open Xcode?${NC}"
read -p "Open Xcode workspace now? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Opening Xcode..."
    open ios/EmojiPainter.xcworkspace
    echo ""
    echo -e "${GREEN}✅ Xcode opened${NC}"
    echo "Please complete the manual steps listed above"
else
    echo "Skipped. You can open it later with:"
    echo "   open ios/EmojiPainter.xcworkspace"
fi

echo ""
echo "============================================="
echo "📚 Next Steps:"
echo ""
echo "After completing the Xcode setup:"
echo ""
echo "1. Build and run on a device:"
echo "   npx react-native run-ios --device"
echo ""
echo "2. Check Metro logs for Metal initialization:"
echo "   Look for: ✅ Metal rendering available"
echo ""
echo "3. Test export performance:"
echo "   Export a timelapse and compare speed"
echo ""
echo "4. See full documentation:"
echo "   cat METAL_INTEGRATION.md"
echo "   cat BUILD_GUIDE.md"
echo ""
echo "============================================="
echo ""
