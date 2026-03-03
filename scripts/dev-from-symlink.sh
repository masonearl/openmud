#!/bin/bash
# Run vercel dev from a path without spaces (fixes "Cannot find module" when project path has spaces)
# NODE_OPTIONS with paths containing spaces breaks child processes; clear it entirely
set -e
export NODE_OPTIONS=""
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
SYMLINK="/tmp/openmud-dev"
ln -sfn "$PROJECT_ROOT" "$SYMLINK" 2>/dev/null || true
cd "$SYMLINK/web" && exec vercel dev --listen 3947
