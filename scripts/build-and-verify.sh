#!/bin/bash
# Build an unsigned macOS app bundle, zip it, and verify the archive.
# Usage: npm run build:test
set -e
cd "$(dirname "$0")/.."

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -gt 20 ]; then
  echo "FAIL: Desktop packaging currently requires Node 20.x. Current runtime: $(node -v)"
  echo "Use Node 20 locally or run the GitHub desktop release workflow."
  exit 1
fi

echo "Building openmud app bundle..."
cd desktop
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir

APP_DIR=$(ls -td dist/mac* 2>/dev/null | head -1)
if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR/openmud.app" ]; then
  echo "FAIL: No openmud.app found in desktop/dist/"
  exit 1
fi

APP_VERSION=$(node -p "require('./package.json').version")
ZIP_PATH="dist/openmud-${APP_VERSION}-arm64.zip"
rm -f "$ZIP_PATH"
( cd "$APP_DIR" && zip -qry "../openmud-${APP_VERSION}-arm64.zip" "openmud.app" )
unzip -tq "$ZIP_PATH" >/dev/null

echo ""
echo "✓ Build complete: $ZIP_PATH"
echo ""
echo "To test: unzip the archive, move openmud.app to Applications, then run it."
