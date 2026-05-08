# Desktop App - Development Notes

## Version Bump Rule

**Any commit that touches files in `apps/desktop/` MUST include a version bump in `apps/desktop/package.json`.** Before committing, check whether `package.json` is already modified in the staged changes. If the version was already bumped (e.g. by a prior edit in the same branch), do not bump again. If it was not bumped, increment the patch version (e.g. `0.4.0` -> `0.4.1`) and stage it alongside the other changes. A CI check will fail the PR if desktop files changed without a version bump.

## Testing the Local Gateway (HTTP API)

The desktop Electron app runs a localhost HTTP gateway. To test it manually:

### Authentication

Gateway routes (`/api/gateway/*`) require one of:
1. **Internal gateway token** (`X-Desktop-Gateway-Token`) -- used by cloud command executor for internal calls.
2. **Browser session token** (`X-Desktop-Session-Token`) -- obtained via authenticated challenge-exchange flow. Must be accompanied by an `Origin` header matching the origin bound during exchange.

**Origin-only auth is not supported.** A spoofed `Origin` header alone will not grant access to gateway routes.

### Fail-Closed Behavior (Missing API Key)

The gateway **fails closed** when the desktop API key is not configured:
- **App startup is unaffected** -- the server binds, the UI opens, health endpoint works, cloud relay works.
- **Local-electron browser mode becomes unavailable** -- the challenge-exchange route returns HTTP 503 `"Local gateway auth unavailable: API key required"`. Without a session token, all gateway routes return 401.
- **No silent fallback** -- the browser interceptor surfaces the 503 error to the UI rather than silently degrading or falling back to an insecure auth path.
- **No crashes** -- `getApiKey()` returns `null` safely; no uncaught exceptions.

"Fail closed" means the *feature* is unavailable with an explicit, actionable error -- not that the app crashes.

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
  "http://localhost:19432/api/gateway/directories?path=/Users/<you>/Source"
```

Debug tokens are short-lived (10 minutes), memory-only, and only available when `CL_LOCAL_GATEWAY_DEBUG_AUTH=1` in an unpackaged build.

### No-Auth Mode for Development

Start with `just desktop-no-auth` to bypass all gateway auth. All gateway routes are open, and the exchange endpoint issues session tokens without challenge verification. Guarded by `!app.isPackaged` -- cannot be enabled in production builds.

### Production Origins Only Mode

Start with `just desktop-prod-origins` when the gateway is connected to a production relay
and you have a localhost dev instance open. This blocks requests from all origins except
the configured webAppOrigin, so dev traffic doesn't leak into the production relay.
Cross-origin browser reads of /health will also fail for blocked origins.

### Sandbox Directory Enforcement

Every API route checks target paths against the sandbox base directory via `isPathAllowed()` in `src/server/security.ts`. Paths outside the sandbox return HTTP 403 `{"error": "directory not allowed"}`.

The `sandboxBaseDirectory` is the single source of truth for path access. It is stored in `electron-store` via `SettingsStore` and used to derive a single-entry allowlist at runtime via `buildAllowedDirectories()` in `src/shared/sandbox-policy.ts`.

Hardcoded sensitive paths (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/Library/Keychains`, `/etc`, `/bin`, `/sbin`) are always denied, even if a parent is allowed.

### Example Test Commands

Obtain a debug token first via `just desktop-debug-auth` + UI "Mint Debug Token" button, then:

```bash
# Should succeed (with valid session token, sandbox directory)
curl -s -H "X-Desktop-Session-Token: <TOKEN>" -H "Origin: http://localhost" \
  "http://localhost:19432/api/gateway/directories?path=/Users/<you>/Source"

# Should fail -- no session token (401)
curl -s -H "Origin: http://localhost" "http://localhost:19432/api/gateway/directories?path=/Users/<you>/Source"

# Should fail -- outside sandbox (403)
curl -s -H "X-Desktop-Session-Token: <TOKEN>" -H "Origin: http://localhost" \
  "http://localhost:19432/api/gateway/directories?path=/tmp"

# Should fail -- sensitive deny list (403)
curl -s -H "X-Desktop-Session-Token: <TOKEN>" -H "Origin: http://localhost" \
  "http://localhost:19432/api/gateway/directories?path=/Users/<you>/.ssh"
```

## Releasing Desktop Builds

Releases are automated via CI. When a PR that touches `apps/desktop/**` is merged to main, the release workflow runs:

1. Reads the `version` from `apps/desktop/package.json`
2. Checks if that version already has a GitHub Release -- if so, skips with a warning
3. Builds a universal macOS DMG via `electron-builder`
4. Publishes the DMG to GitHub Releases and uploads it as a workflow artifact
5. Sends a Slack notification to the team

### Triggering a new release

Bump the `version` field in `apps/desktop/package.json` as part of your PR. When it merges, CI will build and publish automatically.

```jsonc
// apps/desktop/package.json
{ "version": "0.2.0" }  // <- bump this
```

If you merge desktop changes **without** bumping the version, the workflow will skip the build and log a warning -- no harm done, no duplicate releases.

### Auto-update for users

- **Packaged builds** (DMG installs) use `electron-updater` to check GitHub Releases every 5 minutes. Users are notified in-app when a new version is available, and it auto-installs on quit.
- **Dev builds** (running from source) compare `origin/main` commit hashes via `git fetch` and offer to pull + rebuild.
