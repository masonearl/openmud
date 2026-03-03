#!/bin/bash
# Run full dev from a path without spaces (fixes 502 when project path has spaces like "1. Projects")
set -e
unset NODE_OPTIONS
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
SYMLINK="/tmp/openmud-dev"
ln -sfn "$PROJECT_ROOT" "$SYMLINK"
cd "$SYMLINK" && npm run predev && sleep 1 && env PORT=3947 npx concurrently -k -n site,app -c blue,green "npm run dev:site" "sleep 3 && npm run dev:app"
