# Symphony Desktop POC

This branch is the Electron-side half of the FEA-1469 proof of concept.

It is paired with `closedloop-ai/symphony-alpha` branch
`FEA-1469-symphony-desktop-local-poc`.

This is a proof of concept only. Do not merge it to main as-is.

## Fresh Checkout Setup

Check out and install the Electron branch:

```sh
cd /path/to/closedloop-electron
git checkout FEA-1469-symphony-web-poc
rtk pnpm install
rtk pnpm --dir apps/desktop build
```

Check out and install the Symphony companion branch:

```sh
cd /path/to/symphony-alpha
git checkout FEA-1469-symphony-desktop-local-poc
rtk pnpm install
rtk pnpm --filter @closedloop-ai/loops-api build
rtk pnpm --dir apps/app typecheck
```

## Run The Two-Repo POC

To simulate a true first run, stop ClosedLoop and move the desktop app's local
state out of the live Library locations before launching:

```sh
backup_root="$HOME/Desktop/closedloop-first-run-reset-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_root"
move_state() {
  [ -e "$1" ] || return 0
  rel="${1#$HOME/Library/}"
  mv "$1" "$backup_root/${rel//\//__}"
}
for p in \
  "$HOME/Library/Application Support/ClosedLoop" \
  "$HOME/Library/Application Support/closedloop-electron-1226" \
  "$HOME/Library/Logs/ClosedLoop" \
  "$HOME/Library/Caches/ClosedLoop" \
  "$HOME/Library/Caches/ai.closedloop.desktop" \
  "$HOME/Library/Caches/ai.closedloop.desktop.ShipIt" \
  "$HOME/Library/HTTPStorages/ai.closedloop.desktop" \
  "$HOME/Library/Preferences/ai.closedloop.desktop.plist" \
  "$HOME/Library/Saved Application State/ai.closedloop.desktop.savedState"; do
  move_state "$p"
done
find "$HOME/Library/Preferences/ByHost" -name 'ai.closedloop.desktop*.plist' \
  -type f -exec sh -c 'for p; do mv "$p" "$0/Preferences__ByHost__$(basename "$p")"; done' \
  "$backup_root" {} +
```

Launch the Electron app and point it at the Symphony checkout:

```sh
cd /path/to/closedloop-electron
CL_SYMPHONY_WEB_POC=1 \
CL_SYMPHONY_APP_DIR=/path/to/symphony-alpha/apps/app \
rtk pnpm --dir apps/desktop dev
```

Electron starts the desktop-local SQLite/API runtime, starts the Symphony Next
app from `CL_SYMPHONY_APP_DIR`, appends the local API URL and token to the
initial Symphony URL, and loads that app as the Symphony Desktop POC surface.

## Expected Result

- The app opens to the Symphony Desktop surface by default.
- My Tasks, local document creation, Sessions, and Agents can read from the
  Electron-owned local API.
- Desktop Classic remains available as the fallback/escape valve.

If `CL_SYMPHONY_APP_DIR` is omitted and no sibling `symphony-alpha/apps/app`
checkout is auto-discovered, Electron falls back to the embedded local POC
harness. That fallback proves the local API is alive, but it is not the real
Symphony app UI.
