# ClosedLoop Electron - Development Notes

## Testing the Local Gateway (HTTP API)

The desktop Electron app runs a localhost HTTP gateway. To test it manually:

### Authentication

Engineer routes (`/api/engineer/*`) require auth. The gateway token is a random 24-byte hex generated in-memory at startup — you cannot extract it externally. However, **loopback requests with a localhost Origin header bypass token auth**:

```bash
curl -s -H "Origin: http://localhost" "http://localhost:<PORT>/api/engineer/..."
```

The health endpoint is unauthenticated:
```bash
curl -s http://localhost:<PORT>/health
```

The gateway port is visible in the health response or the Electron UI. Typical dev port: `19432`.

### Sandbox Directory Enforcement

Every API route checks target paths against the sandbox base directory via `isPathAllowed()` in `src/server/security.ts`. Paths outside the sandbox return HTTP 403 `{"error": "directory not allowed"}`.

The `sandboxBaseDirectory` is the single source of truth for path access. It is stored in `electron-store` via `SettingsStore` and used to derive a single-entry allowlist at runtime via `buildAllowedDirectories()` in `src/shared/sandbox-policy.ts`.

Hardcoded sensitive paths (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/Library/Keychains`, `/etc`, `/bin`, `/sbin`) are always denied, even if a parent is allowed.

### Example Test Commands

```bash
# Should succeed (if /Users/<you>/Source is the sandbox base directory)
curl -s -H "Origin: http://localhost" "http://localhost:19432/api/engineer/directories?path=/Users/<you>/Source"

# Should fail — outside sandbox
curl -s -H "Origin: http://localhost" "http://localhost:19432/api/engineer/directories?path=/tmp"

# Should fail — sensitive deny list
curl -s -H "Origin: http://localhost" "http://localhost:19432/api/engineer/directories?path=/Users/<you>/.ssh"
```

## Updating App Icons

The source of truth for the app icon is `apps/desktop/app-icon.svg`. All other icon assets are derived from it. To regenerate after updating the SVG:

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
- `resources/icon-1024.png` — full-color 1024x1024 app/dock icon
- `resources/icon.icns` — macOS app bundle icon (used by electron-builder)
- `resources/trayIconTemplate.svg` — must be updated manually to match `app-icon.svg` paths with `fill="#000000"`
- `resources/trayIconTemplate.png` (18x18) and `trayIconTemplate@2x.png` (36x36) — macOS tray template images (black silhouettes)
