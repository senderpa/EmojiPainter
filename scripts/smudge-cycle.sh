#!/bin/bash
# Robust autonomous smudge test cycle. Arg $1 = expected build marker (e.g. v20). Retries relaunch+pull
# until selftest.txt contains that marker (handles flaky launch/self-test triggering).
WANT="${1:-v}"
DEV=4D367AFF-8770-5E97-B966-D3A3481711F4
APP="/Users/senderp/Library/Developer/Xcode/DerivedData/EmojiPainter-ghzutcyyrtpryshhddeizbmhuwcy/Build/Products/Release-iphoneos/EmojiPainter.app"
echo "=== install ==="
timeout 180 xcrun devicectl device install app --device $DEV "$APP" 2>&1 | grep -aE "App installed|error:" | head -1
for attempt in 1 2 3 4 5; do
  echo "=== attempt $attempt: launch ==="
  for i in 1 2 3 4 5 6; do
    out=$(timeout 45 xcrun devicectl device process launch --terminate-existing --device $DEV com.emojipaint.mobile 2>&1)
    echo "$out" | grep -qiE "RequestDenied|failed to launch" && { echo "locked $i"; sleep 12; } || { echo "launched"; break; }
  done
  echo "waiting 12s for self-test..."
  sleep 12
  rm -f /tmp/selftest.txt /tmp/selftest.png
  timeout 60 xcrun devicectl device copy from --device $DEV --domain-type appDataContainer --domain-identifier com.emojipaint.mobile --source Documents/selftest.txt --destination /tmp/selftest.txt 2>/dev/null
  if grep -q "$WANT" /tmp/selftest.txt 2>/dev/null; then
    echo "=== FRESH RESULTS ($WANT) ==="; cat /tmp/selftest.txt
    timeout 60 xcrun devicectl device copy from --device $DEV --domain-type appDataContainer --domain-identifier com.emojipaint.mobile --source Documents/selftest.png --destination /tmp/selftest.png 2>/dev/null
    ls -la /tmp/selftest.png 2>/dev/null && echo "PNG OK" || echo "no png"
    exit 0
  fi
  echo "(not fresh yet: $(head -1 /tmp/selftest.txt 2>/dev/null))"
done
echo "=== GAVE UP after 5 attempts; last file: ==="; cat /tmp/selftest.txt 2>/dev/null
