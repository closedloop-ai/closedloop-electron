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

## Agent Monitor (in-process)

> **Status (FEA-1503):** the agent monitor is FULLY FIRST-PARTY and IN-PROCESS.
> The third-party agent-monitor vendor tool is GONE — no sidecar, no generated
> tree, no vendor dependency, no vendor-generated hook handler.
> `src/main/agent-monitor-listener.ts` (`AgentHookListener`) owns
> `127.0.0.1:4820` in the main process and writes through the `node:sqlite`
> repository (`src/main/database/`) via the hook lifecycle state machine
> (`database/lifecycle.ts`). The renderer is a first-party React app
> (`src/renderer/`) — there is NO iframe. The first-party collection layer
> (`src/main/collectors/`) imports historical sessions on boot and watches the
> live transcript files of all five agent CLIs, writing through the same DB. The
> cloud relay and cost-reconciliation worker read that DB through the shared
> connection.

The desktop app provides local Claude Code (and opt-in Codex) session/agent
observability. It powers the **Dashboard** and the agent nav items (Sessions,
Activity, Analytics, Workflows, Kanban) in the desktop left sidebar. The feature
is gated by the persisted `agentMonitorEnabled` desktop setting, which
**defaults ON**; when disabled, the agent nav items are hidden and only the
Gateway section remains.

- **Hook listener:** `src/main/agent-monitor-listener.ts` binds `127.0.0.1:4820`
  in the main process and accepts the hook payload (`POST /api/hooks/event`,
  `GET /api/health`). Each event is gated by the FEA-1407 sandbox check,
  harness-stamped from `__provider`, and applied by the lifecycle state machine
  in one `BEGIN IMMEDIATE` transaction. Started from `startAgentCapture()` (boot
  + the enable path) **only when `agentMonitorEnabled` is true**, before the
  gateway-start try-block; a bind failure (EADDRINUSE) degrades to "no monitor"
  rather than blocking boot.
- **Collection layer (`src/main/collectors/`):** `CollectorManager` runs a
  best-effort boot bulk import and live file watchers for all five agent CLIs,
  writing through the first-party `importSession` into the same in-process DB.
  It is started/stopped alongside the listener (and stopped in `shutdown()`
  BEFORE `agentDatabase.close()` so a late fs-watch import can't hit a closed
  DB). Every parsed session is sandbox-gated (FEA-1407, fail-closed) before any
  write. Import is idempotent via a per-(session, event_type) high-water-mark on
  `created_at`. Watchers self-heal if a data dir doesn't exist at boot.
- **Fixed port (differs from the gateway):** `127.0.0.1:4820`
  (`AGENT_MONITOR_PORT` in `src/shared/contracts.ts`). It MUST be fixed — the
  hook handler POSTs to `127.0.0.1:${CLAUDE_DASHBOARD_PORT||4820}`, baked into
  `~/.claude/settings.json` at install time, so 4820 means hooks need zero
  per-hook env. 4820 is outside `PORT_PROBE_ORDER`, so it never collides with
  the gateway. (FEA-1500 tracks migrating this transport later.)
- **Durable DB:** `app.getPath("userData")/agent-dashboard.sqlite` (schema in
  `src/main/database/schema.ts`), Node's built-in `node:sqlite`. Persisted
  collector caches live under `<userData>/agent-monitor/`.
- **UI:** a first-party React app in the main window (`src/renderer/`) — NO
  iframe. The left sidebar drives the **Dashboard** + agent nav items; live
  updates arrive via the `desktop:db:changed` IPC push after each write.
- **Hooks are explicit opt-in (consent-bearing).** The user enables/disables
  tracking via the toggle → `src/main/agent-monitor-hooks.ts` writes/removes the
  hook entries in `~/.claude/settings.json` (and, opt-in, `~/.codex/hooks.json`).
  The hook command runs the Electron binary as Node against a **userData copy**
  of the first-party `hook-handler.js` (location-independent across app
  moves/updates), at the fixed port 4820. Default is OFF; disabling fully removes
  the entries; re-enabling is idempotent and self-heals a stale path (also
  repaired at boot via `syncAgentMonitorHooksOnBoot()`). When hooks are ON they
  own live Claude capture, so the Claude **file watcher** is gated off (boot
  historical import still runs); the four non-Claude tools always file-watch.
  Disk state: a dedicated electron-store (`agent-monitor-hooks`, key `enabled`).
- **First-party hook handlers:** `resources/hooks/{hook-handler,codex-hook-handler}.js`
  — zero-dependency CommonJS scripts that POST `{ hook_type, data }` to
  `:4820`. Shipped via `electron-builder.yml` `extraResources` (`to: hooks`,
  unpacked) and resolved by `agent-monitor-path.ts`. No build step, no generated
  tree.
- **Security model (by design):** the collectors + listener read the agent-CLI
  home dirs (`~/.claude`, `~/.codex`, …) **directly**, outside the gateway
  `isPathAllowed` sandbox, but every captured session is dropped unless its
  `cwd` is inside the FEA-1407 sandbox base directory (fail-closed). The listener
  is bound to `127.0.0.1` only; no cloud egress from collectors. Hooks only
  mutate global Claude/Codex config on explicit user opt-in and are reversible.
- **Multi-harness support (5 agent tools):** ingests sessions from **Claude
  Code** (hooks live + file historical), **OpenAI Codex** (rollout JSONL under
  `~/.codex/sessions/`), **Cursor** (agent transcripts under `~/.cursor/projects/`),
  **GitHub Copilot** (chat JSON under VS Code `workspaceStorage/` + CLI JSONL
  under `~/.copilot/session-state/`), and **OpenCode** (the `opencode.db` SQLite
  store under `~/.local/share/opencode/`). The four non-Claude tools have **no
  hook system** — file import/watching is the only capture path. Each
  harness's parser (`src/main/collectors/<tool>/`) emits the same normalized
  session shape so `importSession` renders all harnesses through the unchanged
  UI. Environment variable overrides: `$CODEX_HOME`, `$CURSOR_HOME`,
  `$COPILOT_HOME`, `$OPENCODE_DATA_DIR` (Claude uses `$CLAUDE_HOME`).
- **Build/packaging:** the main process is plain `tsc` → `dist/`; there is no
  agent-monitor generative build step. Packaging ships `dist/` (via
  `stage-packaging-app.mjs`) plus the unpacked `resources/hooks` handlers. Any
  change to `apps/desktop/` requires the `package.json` version bump
  (CI-enforced) and a clean-machine packaged-DMG smoke test (the highest-risk
  path: `node:sqlite` from the asar-external, universal-merged binary).
