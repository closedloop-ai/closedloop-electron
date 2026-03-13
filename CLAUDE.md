# ClosedLoop Electron - Development Notes

## Testing the Local Gateway (HTTP API)

The desktop Electron app runs a localhost HTTP gateway. To test it manually:

### Authentication

Engineer routes (`/api/engineer/*`) require one of:
1. **Internal gateway token** (`X-Desktop-Gateway-Token`) — used by cloud command executor for internal calls.
2. **Browser session token** (`X-Desktop-Session-Token`) — obtained via authenticated challenge-exchange flow. Must be accompanied by an `Origin` header matching the origin bound during exchange.

**Origin-only auth is not supported.** A spoofed `Origin` header alone will not grant access to engineer routes.

### Fail-Closed Behavior (Missing API Key)

The gateway **fails closed** when the desktop API key is not configured:
- **App startup is unaffected** — the server binds, the UI opens, health endpoint works, cloud relay works.
- **Local-electron browser mode becomes unavailable** — the challenge-exchange route returns HTTP 503 `"Local gateway auth unavailable: API key required"`. Without a session token, all engineer routes return 401.
- **No silent fallback** — the browser interceptor surfaces the 503 error to the UI rather than silently degrading or falling back to an insecure auth path.
- **No crashes** — `getApiKey()` returns `null` safely; no uncaught exceptions.

"Fail closed" means the *feature* is unavailable with an explicit, actionable error — not that the app crashes.

The health endpoint remains unauthenticated:
```bash
curl -s http://localhost:<PORT>/health
```

The gateway port is visible in the health response or the Electron UI. Typical dev port: `19432`.

### Debug Auth for Development

For manual `curl` testing during development, use the debug auth workflow:

1. Start Electron with debug auth enabled: `just desktop-debug-auth`
2. In the Electron UI Settings panel, click **Mint Debug Token** to generate a short-lived session token.
3. Use the token in curl:

```bash
curl -s \
  -H "X-Desktop-Session-Token: <token>" \
  -H "Origin: http://localhost" \
  "http://localhost:19432/api/engineer/directories?path=/Users/<you>/Source"
```

Debug tokens are short-lived (10 minutes), memory-only, and only available when `CL_LOCAL_GATEWAY_DEBUG_AUTH=1` in an unpackaged build.

### Sandbox Directory Enforcement

Every API route checks target paths against the sandbox base directory via `isPathAllowed()` in `src/server/security.ts`. Paths outside the sandbox return HTTP 403 `{"error": "directory not allowed"}`.

The `sandboxBaseDirectory` is the single source of truth for path access. It is stored in `electron-store` via `SettingsStore` and used to derive a single-entry allowlist at runtime via `buildAllowedDirectories()` in `src/shared/sandbox-policy.ts`.

Hardcoded sensitive paths (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/Library/Keychains`, `/etc`, `/bin`, `/sbin`) are always denied, even if a parent is allowed.

### Example Test Commands

Obtain a debug token first via `just desktop-debug-auth` + UI "Mint Debug Token" button, then:

```bash
# Should succeed (with valid session token, sandbox directory)
curl -s -H "X-Desktop-Session-Token: <TOKEN>" -H "Origin: http://localhost" \
  "http://localhost:19432/api/engineer/directories?path=/Users/<you>/Source"

# Should fail — no session token (401)
curl -s -H "Origin: http://localhost" "http://localhost:19432/api/engineer/directories?path=/Users/<you>/Source"

# Should fail — outside sandbox (403)
curl -s -H "X-Desktop-Session-Token: <TOKEN>" -H "Origin: http://localhost" \
  "http://localhost:19432/api/engineer/directories?path=/tmp"

# Should fail — sensitive deny list (403)
curl -s -H "X-Desktop-Session-Token: <TOKEN>" -H "Origin: http://localhost" \
  "http://localhost:19432/api/engineer/directories?path=/Users/<you>/.ssh"
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
