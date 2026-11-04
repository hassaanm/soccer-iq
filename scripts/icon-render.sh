#!/bin/sh
# Renders icon.svg to icon.png (512) and apple-touch-icon.png (180) with headless Chrome and sips.
set -e
node scripts/icon-build.js
tmp=$(mktemp -d)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1024,1024 --screenshot="$tmp/icon.png" "file://$PWD/icon.svg" 2>/dev/null
sips -z 512 512 "$tmp/icon.png" --out icon.png >/dev/null
sips -z 180 180 "$tmp/icon.png" --out apple-touch-icon.png >/dev/null
rm -rf "$tmp"
