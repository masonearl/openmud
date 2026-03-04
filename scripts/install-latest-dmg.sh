#!/usr/bin/env bash
# Download the latest openmud DMG and replace the app in Applications.
# Usage: ./scripts/install-latest-dmg.sh

set -e
DMG_URL="https://openmud.ai/api/download-dmg"
TMP_DIR=$(mktemp -d)
DMG_PATH="$TMP_DIR/openmud.dmg"

echo "Downloading latest openmud..."
curl -sL -o "$DMG_PATH" "$DMG_URL"

if [[ ! -f "$DMG_PATH" ]] || [[ ! -s "$DMG_PATH" ]]; then
  echo "Download failed or empty."
  rm -rf "$TMP_DIR"
  exit 1
fi

echo "Mounting DMG..."
MOUNT=$(hdiutil attach "$DMG_PATH" -nobrowse 2>/dev/null | awk -F'\t' '$3 ~ /^\/Volumes\// {print $3; exit}')

if [[ -z "$MOUNT" ]]; then
  echo "Failed to mount DMG."
  rm -rf "$TMP_DIR"
  exit 1
fi

APP_SRC=$(find "$MOUNT" -maxdepth 2 -name "openmud.app" -type d | head -1)
if [[ -z "$APP_SRC" ]]; then
  echo "openmud.app not found in DMG."
  hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$TMP_DIR"
  exit 1
fi

echo "Replacing app in /Applications..."
rm -rf /Applications/openmud.app
cp -R "$APP_SRC" /Applications/

echo "Unmounting..."
hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
rm -rf "$TMP_DIR"

echo "Done. openmud is updated in /Applications."
