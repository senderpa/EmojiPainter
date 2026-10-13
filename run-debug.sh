#!/bin/bash
set -e

echo "🚀 Running EmojiPainter in DEBUG mode..."
echo ""

# Start Metro bundler in background
echo "📦 Starting Metro bundler..."
npx expo start --ios --dev-client &
METRO_PID=$!

# Wait for Metro to start
echo "⏳ Waiting for Metro to start (10 seconds)..."
sleep 10

# Build and run on device
echo "🔨 Building and running on device..."
npx react-native run-ios --device --mode Debug

# Keep Metro running
echo ""
echo "✅ App launched! Metro is running..."
echo "   Press Ctrl+C to stop"
wait $METRO_PID
