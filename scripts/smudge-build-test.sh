#!/bin/bash
# Full autonomous iteration: Release build (ardraw-guarded) → install → launch → capture native logs.
cd /Users/senderp/emojipaint-mobile2030/ios || exit 1
echo "=== Release build ==="
( while true; do pkill -9 -f "ARPainter.xcodeproj" 2>/dev/null; sleep 3; done ) & GUARD=$!
xcodebuild -workspace EmojiPainter.xcworkspace -scheme EmojiPainter -configuration Release \
  -destination "id=00008103-001E05CE0A87001E" -allowProvisioningUpdates build > /tmp/relbuild.log 2>&1
RES=$(grep -aoE 'BUILD SUCCEEDED|BUILD FAILED' /tmp/relbuild.log | tail -1)
echo "BUILD: $RES"
kill $GUARD 2>/dev/null
if [ "$RES" != "BUILD SUCCEEDED" ]; then grep -aE "error:" /tmp/relbuild.log | head -8; exit 1; fi
# Extract the current build marker (e.g. v20) to verify the cycle pulls FRESH results.
MARK=$(grep -oE 'smudge-selftest-v[0-9]+' /Users/senderp/emojipaint-mobile2030/modules/metal-paint/ios/MetalPaintView.swift | head -1 | grep -oE 'v[0-9]+')
echo "expecting marker: $MARK"
bash /Users/senderp/emojipaint-mobile2030/scripts/smudge-cycle.sh "build=$MARK"
