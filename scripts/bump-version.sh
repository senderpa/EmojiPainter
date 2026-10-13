#!/bin/bash
# Usage: ./scripts/bump-version.sh 7.4.0 740
# Updates version in all 6 required places atomically.
set -e

VERSION=$1
BUILD=$2

if [ -z "$VERSION" ] || [ -z "$BUILD" ]; then
  echo "Usage: $0 <version> <build>"
  echo "Example: $0 7.4.0 740"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Bumping to $VERSION ($BUILD)..."

# 1. app.json
node -e "
  const fs = require('fs');
  const p = '$ROOT/app.json';
  const d = JSON.parse(fs.readFileSync(p,'utf8'));
  d.expo.version = '$VERSION';
  d.expo.ios.buildNumber = '$BUILD';
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  console.log('  ✅ app.json');
"

# 2. package.json
node -e "
  const fs = require('fs');
  const p = '$ROOT/package.json';
  const d = JSON.parse(fs.readFileSync(p,'utf8'));
  d.version = '$VERSION';
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  console.log('  ✅ package.json');
"

# 3. Info.plist
PLIST="$ROOT/ios/EmojiPainter/Info.plist"
if [ -f "$PLIST" ]; then
  plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST"
  plutil -replace CFBundleVersion -string "$BUILD" "$PLIST"
  echo "  ✅ Info.plist"
fi

# 4. project.pbxproj
PBXPROJ="$ROOT/ios/EmojiPainter.xcodeproj/project.pbxproj"
if [ -f "$PBXPROJ" ]; then
  sed -i '' "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/g" "$PBXPROJ"
  sed -i '' "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = $BUILD;/g" "$PBXPROJ"
  echo "  ✅ project.pbxproj"
fi

# 5. SettingsScreen.tsx
SETTINGS="$ROOT/src/screens/SettingsScreen.tsx"
if [ -f "$SETTINGS" ]; then
  # Address the line by its "// fallback" marker, then swap the version literal
  # on it. Matching the whole "'x.y.z' // fallback" phrase was brittle: a
  # semicolon between the literal and the comment silently broke it, and this
  # script used to print a tick anyway (the fallback sat stale at 7.3.3 for many
  # releases). Verify below rather than assume.
  sed -i '' "/\/\/ fallback/s/'[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*'/'$VERSION'/" "$SETTINGS"
  if grep -q "'$VERSION'" "$SETTINGS" && grep -q "// fallback" "$SETTINGS"; then
    echo "  ✅ SettingsScreen.tsx"
  else
    echo "  ❌ SettingsScreen.tsx — version marker not found, NOT updated"; exit 1
  fi
fi

# 6. StartupOverlay.tsx
STARTUP="$ROOT/src/components/StartupOverlay.tsx"
if [ -f "$STARTUP" ]; then
  sed -i '' "s/v[0-9]\+\.[0-9]\+\.[0-9]\+/v$VERSION/g" "$STARTUP"
  echo "  ✅ StartupOverlay.tsx"
fi

echo ""
echo "Done — $VERSION ($BUILD) applied to all 6 files."
echo "Next: run 'npx expo prebuild --platform ios' (post-prebuild.js will re-apply pbxproj automatically)"
