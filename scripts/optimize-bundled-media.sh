#!/usr/bin/env bash
set -euo pipefail

# Re-encodes optional bundled animation media for iOS. It preserves the first
# video stream, one audio stream, duration, and dimensions while removing the
# redundant MJPEG cover stream found in older exports. Originals are replaced
# only when the HEVC result is smaller; failed encodes leave the source intact.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=("$ROOT/assets/logosvideo" "$ROOT/assets/welcomer" "$ROOT/assets/loader-animation.mp4")
CRF="${HEVC_CRF:-28}"
PRESET="${HEVC_PRESET:-medium}"

for target in "${TARGETS[@]}"; do
  if [ -f "$target" ]; then files=("$target"); else files=("$target"/*.mp4); fi
  for source in "${files[@]}"; do
    [ -f "$source" ] || continue
    temp="${source}.hevc.tmp.mp4"
    rm -f "$temp"
    ffmpeg -hide_banner -loglevel error -y -i "$source" \
      -map 0:v:0 -map 0:a:0? -c:v libx265 -tag:v hvc1 -crf "$CRF" -preset "$PRESET" \
      -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart "$temp"
    old_bytes="$(stat -f %z "$source")"
    new_bytes="$(stat -f %z "$temp")"
    if [ "$new_bytes" -lt "$old_bytes" ]; then
      mv "$temp" "$source"
      echo "optimized $source: $old_bytes -> $new_bytes bytes"
    else
      rm -f "$temp"
      echo "kept $source: HEVC result was not smaller"
    fi
  done
done
