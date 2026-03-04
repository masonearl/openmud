#!/usr/bin/env bash
# Dev + smoke test in one flow. For OpenClaw or manual use.
#
# Usage:
#   ./scripts/dev-and-test.sh          # Start dev, run smoke when ready
#   ./scripts/dev-and-test.sh --build  # Build .dmg after smoke
#
# Prereq: npm install already run in project root.

set -e
cd "$(dirname "$0")/.."

echo "openmud dev + test"
echo ""

# Kill stale processes
npm run predev 2>/dev/null || true
sleep 2

# Start dev in background (tool server on 3847 serves API + static)
echo "Starting dev (Electron + tool server)..."
npm run dev:app &
DEV_PID=$!

# Wait for tool server (3847) - serves API + static
echo "Waiting for tool server on 3847..."
for i in $(seq 1 45); do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3847/api/config 2>/dev/null | grep -q 200; then
    echo "  Tool server ready."
    break
  fi
  sleep 1
  if [ "$i" -eq 45 ]; then
    echo "FAIL: Tool server did not start"
    kill $DEV_PID 2>/dev/null || true
    exit 1
  fi
done

# Run smoke test
echo ""
echo "Running smoke test..."
npm run test:smoke

# Run E2E tests
echo ""
echo "Running E2E tests..."
npm run test:e2e

echo ""
echo "✓ Dev is running. App should be open."
echo "  Site: http://localhost:3947"
echo "  Try:  http://localhost:3947/try"
echo ""
echo "To stop: kill $DEV_PID or Ctrl+C in the dev terminal"
echo ""

if [[ "$1" == "--build" ]]; then
  echo "Building .dmg..."
  kill $DEV_PID 2>/dev/null || true
  sleep 2
  npm run build:test
fi
