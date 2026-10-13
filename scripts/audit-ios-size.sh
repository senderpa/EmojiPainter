#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/audit-ios-size.sh [path/to/App.app|path/to/App.xcarchive] [optional.ipa]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INPUT="${1:-$ROOT/build/EmojiPainterLite-9.2.1-845.xcarchive}"
IPA="${2:-}"
if [[ "$INPUT" == *.xcarchive ]]; then APP="$INPUT/Products/Applications/EmojiPainter.app"; else APP="$INPUT"; fi
[ -d "$APP" ] || { echo "App not found: $APP" >&2; exit 1; }

echo "# iOS size audit"
echo "archive_or_app=$INPUT"
echo "installed_app_bytes=$(du -sk "$APP" | awk '{print $1 * 1024}')"
echo "installed_app_human=$(du -sh "$APP" | awk '{print $1}')"
if [ -n "$IPA" ] && [ -f "$IPA" ]; then
  echo "ipa_path=$IPA"
  echo "ipa_bytes=$(stat -f %z "$IPA")"
  echo "ipa_human=$(du -sh "$IPA" | awk '{print $1}')"
else
  echo "ipa_bytes=unavailable"
  echo "ipa_human=unavailable (pass an exported IPA as the second argument)"
fi
echo
echo "## largest bundled folders/files"
du -ah "$APP" | sort -hr | sed -n '1,80p'
echo
echo "## largest file types"
find "$APP" -type f | awk -F. 'NF > 1 {print tolower($NF)}' | sort | uniq -c | sort -nr | sed -n '1,40p'
