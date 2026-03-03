#!/bin/bash
# Build unsigned .dmg and verify it was created.
# Usage: npm run build:test
set -e
cd "$(dirname "$0")/.."
echo "Building openmud .dmg (unsigned)..."
cd desktop
npm run build:dmg:unsigned
DMG=$(ls -t dist/*.dmg 2>/dev/null | head -1)
if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
  echo "FAIL: No .dmg found in desktop/dist/"
  exit 1
fi
echo ""
echo "✓ Build complete: $DMG"
echo ""
echo "To test: open the .dmg, drag openmud to Applications, then run it."
echo "If macOS says 'damaged': xattr -cr /Applications/openmud.app"
