# ClosedLoop Desktop

Electron desktop app providing a localhost HTTP gateway for the ClosedLoop platform.

## Updating App Icons

The source of truth for the app icon is `app-icon.svg`. All other icon assets are derived from it. To regenerate after updating the SVG:

1. **Install sharp** in a temp directory (not in the project):
   ```bash
   cd /tmp && mkdir -p icon-gen && cd icon-gen && npm init -y && npm install sharp
   ```

2. **Run the generation script** from the repo root:
   ```bash
   node apps/desktop/scripts/generate-icons.cjs
   ```

3. **Convert iconset to icns** (macOS only):
   ```bash
   iconutil -c icns apps/desktop/resources/icon.iconset -o apps/desktop/resources/icon.icns
   rm -rf apps/desktop/resources/icon.iconset
   ```

This produces:
- `resources/icon-1024.png` -- full-color 1024x1024 app/dock icon
- `resources/icon.icns` -- macOS app bundle icon (used by electron-builder)
- `resources/trayIconTemplate.svg` -- must be updated manually to match `app-icon.svg` paths with `fill="#000000"`
- `resources/trayIconTemplate.png` (18x18) and `trayIconTemplate@2x.png` (36x36) -- macOS tray template images (black silhouettes)

## Required GitHub Secrets

- `SLACK_GITHUB_REPO_WEBHOOK_URL` -- Slack incoming webhook for release notifications

The `GITHUB_TOKEN` (automatic in Actions) handles GitHub Releases publishing. If the repo has restricted default token permissions, ensure `contents: write` is allowed (Settings > Actions > General).
