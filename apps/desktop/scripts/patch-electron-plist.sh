#!/usr/bin/env bash
# Patches the local Electron.app so the dock shows "ClosedLoop" in dev mode.
# - Renames Electron.app to ClosedLoop.app (dock tooltip uses folder name)
# - Patches Info.plist CFBundleDisplayName/CFBundleName (menu bar uses these)
set -euo pipefail

DIST_DIR=$(find "$(dirname "$0")/../node_modules" -path "*/electron/dist" -type d 2>/dev/null | head -1)
if [ -z "$DIST_DIR" ]; then
  DIST_DIR=$(find "$(dirname "$0")/../../.." -path "*/electron/dist" -type d -not -path "*/app.asar/*" 2>/dev/null | head -1)
fi

if [ -z "$DIST_DIR" ]; then
  echo "patch-electron-plist: electron/dist not found, skipping"
  exit 0
fi

APP_DIR="$DIST_DIR/ClosedLoop.app"

# Rename Electron.app -> ClosedLoop.app if not already done
if [ -d "$DIST_DIR/Electron.app" ] && [ ! -d "$APP_DIR" ]; then
  mv "$DIST_DIR/Electron.app" "$APP_DIR"
fi

PLIST="$APP_DIR/Contents/Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "patch-electron-plist: Info.plist not found at $PLIST, skipping"
  exit 0
fi

/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ClosedLoop" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleName ClosedLoop" "$PLIST" 2>/dev/null || true

# Print the path to the binary so callers can use it
echo "$APP_DIR/Contents/MacOS/Electron"
