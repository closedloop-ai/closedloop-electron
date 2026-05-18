# Desktop App - Development Notes

## Version Bump Rule

**Any commit that touches files in `apps/desktop/` MUST include a version bump in `apps/desktop/package.json`.** Before committing, check whether `package.json` is already modified in the staged changes. If the version was already bumped (e.g. by a prior edit in the same branch), do not bump again. If it was not bumped, increment the patch version (e.g. `0.4.0` -> `0.4.1`) and stage it alongside the other changes. A CI check will fail the PR if desktop files changed without a version bump.

## Gateway Operations

Binary path discovery is centralized in `src/server/shell-path.ts`. Use
`getShellPath()` / `getShellPathSync()` for login-shell PATH discovery and
`resolveBinaryFromLoginShell()` / `resolveBinaryFromLoginShellSync()` for CLI
binary lookup. Binary overrides must flow through these helpers, and direct
`which` or shell reimplementations are forbidden.

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

## Persistent Desktop Logs

Packaged and dev builds write a durable `main.log` through `electron-log`. The only allowlisted console transport remains `src/main/gateway-logger.ts`; production code in `src/main/**` and `src/server/**` should use `gatewayLog` rather than direct `console.log`, `console.warn`, or `console.error`.

Typical log locations:

- macOS: `~/Library/Logs/ClosedLoop/main.log`
- Windows: `%APPDATA%/ClosedLoop/logs/main.log`
- Linux: `~/.config/ClosedLoop/logs/main.log`

The Diagnostics tab shows the current in-memory gateway log plus a bounded previous-session tail read from `main.log` at startup. First-run or unreadable log files must not block boot; return an empty previous-session tail and continue.

## Agent Monitor Sidecar

The desktop app bundles the MIT-licensed `Claude-Code-Agent-Monitor`
(`agent-dashboard` + `agent-dashboard-client`, pinned in
`apps/desktop/package.json`) and runs a generated runtime tree as a managed
localhost **sidecar** for local Claude Code session/agent observability. It is
the single embedded observability tool (the embedded **"Claude Dashboard"** nav
tab), but the feature is behind the persisted `agentMonitorEnabled` desktop
setting and defaults OFF. When disabled, the whole dashboard tab is hidden.

- **Process model:** `src/main/agent-monitor-sidecar.ts` spawns the generated
  `server/index.js` from `apps/desktop/.generated/agent-monitor/` (packaged:
  unpacked `extraResources/agent-monitor`) using the Electron binary as Node
  (`ELECTRON_RUN_AS_NODE=1`, `process.execPath`) — a packaged app ships no
  standalone `node`. Started fire-and-forget from `boot()` **only when
  `agentMonitorEnabled` is true**, and still before the gateway-start try-block
  so a gateway-start failure never prevents it from running and a sidecar
  failure never blocks or fails app boot.
- **Fixed port (differs from the gateway):** `127.0.0.1:4820`
  (`AGENT_MONITOR_PORT` in `src/shared/contracts.ts`), passed via
  `DASHBOARD_PORT`. It MUST be fixed — Claude Code hooks bake a port at install
  time and the hook handler POSTs to `127.0.0.1:${CLAUDE_DASHBOARD_PORT||4820}`,
  so 4820 (upstream's default) means hooks need zero per-hook env. 4820 is
  outside `PORT_PROBE_ORDER`, so it never collides with the gateway.
- **Durable DB:** `DASHBOARD_DB_PATH` is set to
  `app.getPath("userData")/agent-monitor/dashboard.db` (the packaged app dir is
  read-only). Uses Node's built-in `node:sqlite`; the generated `server/db.js`
  is patched to prefer `./compat-sqlite`, and staged packaging removes the
  hoisted `better-sqlite3` module as a belt-and-suspenders guard.
- **UI:** embedded as the **"Claude Dashboard"** tab in the main window
  (`src/renderer/index.html`) — a plain `<iframe>` pointed at the sidecar URL
  fetched via `desktop:get-agent-monitor-url` (renderer polls until `ready`,
  then sets `src` once). No separate window. The tab is hidden unless the user
  enables Claude Dashboard in Settings → Relay / Gateway; the tray item only
  appears when enabled, and `desktop:open-agent-monitor` redirects to Settings
  when disabled. The embed depends on the renderer having **no CSP** — if a
  CSP is ever added it must include
  `frame-src http://127.0.0.1:*`. Iframes in a `display:none` panel collapse to
  0px, so an explicit px height is set via JS *after* the panel is `.active`,
  re-applied on `resize`.
- **Hooks are explicit opt-in (consent-bearing).** Upstream silently writes 8
  hooks into `~/.claude/settings.json` on every startup — the generated
  `server/index.js` gates that behind `CCAM_AUTO_INSTALL_HOOKS` (which the
  sidecar sets to `"0"`).
  The user enables/disables tracking via the toggle on the Claude Dashboard tab
  → `src/main/agent-monitor-hooks.ts` writes/removes the 8 hook entries. The
  hook command runs the Electron binary as Node against a **userData copy** of
  `hook-handler.js` (location-independent across app moves/updates), at the
  fixed port 4820. Default is OFF; disabling fully removes the entries;
  re-enabling is idempotent and self-heals a stale path (also repaired at boot
  via `syncAgentMonitorHooksOnBoot()`). Disk state: a dedicated electron-store
  (`agent-monitor-hooks`, key `enabled`).
- **Lifecycle:** health-checked readiness on `GET /api/health` (60s ready
  timeout — first run synchronously imports legacy `~/.claude` sessions; ready
  ≠ import-complete, the iframe populates progressively), crash-restart with
  exponential backoff (hard cap; a fixed-port `EADDRINUSE` degrades to "no
  monitor", never blocks boot or Claude Code), process-group SIGTERM→SIGKILL
  stop wired into `runShutdownSequence` (`agentMonitor.stop`, before
  `server.stop`).
- **Security model (by design):** the sidecar reads `~/.claude` **directly**,
  *outside* the gateway `isPathAllowed` sandbox. Acceptable and intentional:
  bound to `127.0.0.1` only (patched at build time; verified the LAN interface
  is refused), the user's own local data, no cloud egress, no auth (consistent
  with the unauthenticated `/health` precedent). Hooks only mutate global
  Claude config on explicit user opt-in and are fully reversible.
- **Build/packaging:** `scripts/build-agent-monitor.mjs` (run via
  `pnpm build:agent-monitor`, chained into `build`) resolves the pnpm-managed
  upstream packages, builds the client with Vite, generates
  `apps/desktop/.generated/agent-monitor/`, applies the ClosedLoop host
  patches (loopback bind, `CCAM_AUTO_INSTALL_HOOKS` gate, uninstall script,
  `compat-sqlite` bootstrap), and hard-gates the build on the generated
  `compat-sqlite.js` working under Electron-as-Node. Shipped via
  `electron-builder.yml` `extraResources` (unpacked, outside the asar)
  preserving the `server/` ↔ `client/dist/` relative layout.
- **Update procedure:** bump the git dependency commit(s) in
  `apps/desktop/package.json`, regenerate the lockfile, and rerun
  `pnpm -C apps/desktop build:agent-monitor`. Any change here requires the
  `apps/desktop/package.json` version bump (CI-enforced) and a clean-machine
  packaged-DMG smoke test (the highest-risk path: `node:sqlite` from the
  asar-external, universal-merged binary).
