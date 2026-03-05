#!/bin/bash
# openmud agent installer
# Usage: curl -fsSL https://openmud.ai/install-agent | bash -s -- --token YOUR_TOKEN
#
# What this does:
#   1. Installs Node.js if not present (via Homebrew)
#   2. Downloads openmud-agent.js to ~/openmud-agent/
#   3. Installs the ws npm package
#   4. Creates a macOS LaunchAgent so the agent starts automatically on login
#   5. Starts the agent immediately

set -e

TOKEN=""
RELAY="wss://openmud-production.up.railway.app"
AGENT_DIR="$HOME/openmud-agent"
PLIST="$HOME/Library/LaunchAgents/ai.openmud.agent.plist"
AGENT_URL="https://raw.githubusercontent.com/masonearl/openmud/main/relay/openmud-agent.js"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --relay) RELAY="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -z "$TOKEN" ]; then
  echo ""
  echo "Error: --token is required."
  echo "Get your token from: openmud.ai → Settings → Agent Setup"
  echo ""
  echo "Usage: curl -fsSL https://openmud.ai/install-agent | bash -s -- --token YOUR_TOKEN"
  echo ""
  exit 1
fi

echo ""
echo "Installing openmud agent..."
echo ""

# 1. Check for Node.js
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Installing via Homebrew..."
  if ! command -v brew &>/dev/null; then
    echo "Installing Homebrew first..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  brew install node
fi

NODE=$(command -v node)
echo "Node.js: $($NODE --version)"

# 2. Create agent directory and download agent
mkdir -p "$AGENT_DIR"
curl -fsSL "$AGENT_URL" -o "$AGENT_DIR/openmud-agent.js"
echo "Agent downloaded to $AGENT_DIR"

# 3. Install ws package
cd "$AGENT_DIR"
if [ ! -f package.json ]; then
  echo '{"name":"openmud-agent","version":"1.0.0","private":true}' > package.json
fi
npm install ws --save-quiet 2>/dev/null || npm install ws

# 4. Stop existing LaunchAgent if running
launchctl unload "$PLIST" 2>/dev/null || true

# 5. Create LaunchAgent plist (auto-start on login, auto-restart on crash)
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.openmud.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$AGENT_DIR/openmud-agent.js</string>
    <string>--token</string>
    <string>$TOKEN</string>
    <string>--relay</string>
    <string>$RELAY</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$AGENT_DIR/agent.log</string>
  <key>StandardErrorPath</key>
  <string>$AGENT_DIR/agent.log</string>
  <key>WorkingDirectory</key>
  <string>$AGENT_DIR</string>
</dict>
</plist>
EOF

# 6. Load and start
launchctl load "$PLIST"

echo ""
echo "openmud agent installed and running."
echo ""
echo "  Auto-starts on login: yes"
echo "  Auto-restarts on crash: yes"
echo "  Auto-updates: yes (checks every hour)"
echo "  Logs: $AGENT_DIR/agent.log"
echo ""
echo "To uninstall:"
echo "  launchctl unload $PLIST && rm -rf $AGENT_DIR $PLIST"
echo ""
