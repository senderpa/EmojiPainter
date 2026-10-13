#!/usr/bin/env bash
#
# build-ios.sh — build EmojiPainter for the connected device in FULL or LITE mode.
#
#   ./scripts/build-ios.sh full     # all features; first connected iOS device
#   ./scripts/build-ios.sh lite     # App-Store build; first connected iOS device
#   ./scripts/build-ios.sh lite device DEVICE_UDID
#   ./scripts/build-ios.sh lite archive   # produce an .xcarchive for App Store upload
#
# LITE works by setting EXPO_PUBLIC_LITE_BUILD=1, which Expo inlines into the JS
# bundle at build time. Legacy Emoji Me stays excluded; the local-only Front
# Camera Mask Mode is included.
# Release builds always regenerate the JS bundle, so the flag takes effect every run.
set -euo pipefail

MODE="${1:-full}"
ACTION="${2:-device}"
DEVICE_UDID="${3:-${IOS_DEVICE_UDID:-}}"
TEAM="GQR55UUY8N"
WORKSPACE="ios/EmojiPainter.xcworkspace"
PRODUCT_BUNDLE_IDENTIFIER="com.emojipaint.mobile"

cd "$(dirname "$0")/.."

case "$MODE" in
  lite)
    export EXPO_PUBLIC_LITE_BUILD=1
    SCHEME="EmojiPainterLite"
    CONFIGURATION="Release-Lite"
    echo "▶ LITE build — Front Camera + AR Painting + Animator included"
    ;;
  full)
    unset EXPO_PUBLIC_LITE_BUILD || true
    SCHEME="EmojiPainter"
    CONFIGURATION="Release"
    echo "▶ FULL build — all features"
    ;;
  *)
    echo "Usage: $0 {full|lite} [device|archive] [device-udid]" >&2
    exit 2
    ;;
esac

if [ "$ACTION" != "device" ] && [ "$ACTION" != "archive" ]; then
  echo "Usage: $0 {full|lite} [device|archive] [device-udid]" >&2
  exit 2
fi

if [ "$ACTION" = "archive" ]; then
  ARCHIVE_PATH="build/EmojiPainter-${MODE}-$(date +%Y%m%d-%H%M%S).xcarchive"
  echo "▶ Archiving → $ARCHIVE_PATH"
  xcodebuild \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -archivePath "$ARCHIVE_PATH" \
    -allowProvisioningUpdates \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$TEAM" \
    archive
  echo "✅ Archive ready: $ARCHIVE_PATH  (open in Xcode Organizer to upload)"
else
  if [ -z "$DEVICE_UDID" ]; then
    DEVICE_UDID="$(
      xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -showdestinations 2>/dev/null |
        awk '
          /platform:iOS, arch:/ && !/Simulator/ {
            value = $0
            sub(/^.*id:/, "", value)
            sub(/[,}].*$/, "", value)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            print value
            exit
          }
        '
    )"
  fi

  if [ -z "$DEVICE_UDID" ]; then
    echo "No connected physical iOS device found. Connect one or pass its UDID as argument 3." >&2
    exit 1
  fi

  DERIVED_DATA_PATH="build/DerivedData-${MODE}"
  APP_PATH="$DERIVED_DATA_PATH/Build/Products/${CONFIGURATION}-iphoneos/EmojiPainter.app"
  echo "▶ Building $SCHEME ($CONFIGURATION) for device $DEVICE_UDID"
  xcodebuild \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "id=$DEVICE_UDID" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    -allowProvisioningUpdates \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$TEAM"

  if [ ! -d "$APP_PATH" ]; then
    echo "Build succeeded but the app was not found at $APP_PATH" >&2
    exit 1
  fi

  echo "▶ Installing $APP_PATH"
  xcrun devicectl device install app --device "$DEVICE_UDID" "$APP_PATH"
  echo "▶ Launching $PRODUCT_BUNDLE_IDENTIFIER"
  xcrun devicectl device process launch \
    --device "$DEVICE_UDID" \
    --terminate-existing \
    "$PRODUCT_BUNDLE_IDENTIFIER"
  echo "✅ $MODE build installed and launched from $APP_PATH"
fi
