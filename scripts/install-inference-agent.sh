#!/bin/bash
# Installs (or with --uninstall removes) the per-user launchd agent that runs
# scripts/inference-supervisor.sh, which starts/stops the native FLUX server
# together with the Docker Compose `api` container.
set -euo pipefail

LABEL="com.imagegen.inference-supervisor"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

chmod +x "$REPO/scripts/inference-supervisor.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/imagegen"
cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/inference-supervisor.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/imagegen/supervisor.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/imagegen/supervisor.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $LABEL. Logs: ~/Library/Logs/imagegen/"
