# Vendored: Claude-Code-Agent-Monitor

This directory is a **vendored copy** of the MIT-licensed open-source project
`hoangsonww/Claude-Code-Agent-Monitor`, bundled into the ClosedLoop desktop app
as a local sidecar (see `apps/desktop/src/main/agent-monitor-sidecar.ts` and the
"Agent Monitor Sidecar" section of `apps/desktop/CLAUDE.md`).

## Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/hoangsonww/Claude-Code-Agent-Monitor |
| Pinned commit | `840c518d7fa69231de049e41b893938228b67e40` |
| Upstream commit date | 2026-05-12 |
| Vendored on | 2026-05-18 |
| License | MIT — see `LICENSE` (© 2026 Son Nguyen) |

Paths copied (at the pinned commit): `server/` (minus `__tests__/`, `README.md`),
`client/` (source; minus `node_modules/`, `dist/`, `README.md`), `scripts/`,
`package.json`, `package-lock.json`, `client/package-lock.json`, `LICENSE`.
Excluded: `mcp/`, `vscode-extension/`, `plugins/`, `deployments/`, `docs/`,
`wiki/`, `images/`, `statusline/`, all top-level marketing/docs files. Build
artifacts (`node_modules/`, `client/dist/`, `dist/.build-stamp`) are git-ignored;
the source tree itself IS committed.

## Patch ledger

Unlike the prior `session-dashboard` vendor, this project **does carry local
patches**. Each must be re-applied and re-verified on every upstream bump.

### Patch #1 — bind loopback only
- **File:** `server/index.js` (in `startServer()`, the `server.listen(...)` call)
- **What:** `server.listen(port, () => {` → `server.listen(port, "127.0.0.1", () => {`
- **Why:** Upstream binds `0.0.0.0` (LAN-exposed). This sidecar is local-only.
  The WebSocket server attaches to the same `http.Server`, so binding the HTTP
  server to loopback also confines `/ws`.

### Patch #2 — gate the silent auto-install of Claude Code hooks
- **File:** `server/index.js` (the `installHooks(true)` block under
  `if (require.main === module)`, just after the SIGINT handler)
- **What:** wrapped the auto-install block in
  `if (process.env.CCAM_AUTO_INSTALL_HOOKS === "1") { ... }`
- **Why:** Upstream writes 8 hook entries into `~/.claude/settings.json` on
  **every** server startup, silently. That is consent-bearing global config
  mutation. The host app only sets `CCAM_AUTO_INSTALL_HOOKS=1` when the user has
  explicitly enabled session tracking. The capability is preserved, just gated.

### Addition #3 — `scripts/uninstall-hooks.js` (new file)
- **What:** a new script symmetric to upstream `scripts/install-hooks.js`. Uses
  the same `getSettingsPath()` and the same `isOurEntry()` predicate (matches any
  hook entry whose command contains `hook-handler.js`), removes those entries,
  prunes empty arrays and an empty `hooks` object, writes settings back.
- **Why:** Upstream has no uninstall. Explicit-consent UX requires a clean,
  complete reversal when the user disables session tracking.

The client UI is embedded into the host app's main window via an **unmodified**
`<iframe>` pointed at the sidecar URL — no client/renderer source is patched.

## Build

Built by `apps/desktop/scripts/build-agent-monitor.mjs` using **npm** (upstream
ships `package-lock.json`; npm ignores the repo's `pnpm-workspace.yaml`, so the
hardened root lockfile is never touched). This is a two-project build (root
server + `client/` Vite app):

```
npm ci                                 # root: server runtime deps
cd client && npm ci && npm run build   # client: tsc -b && vite build -> client/dist
npm ci --omit=dev --omit=optional      # root: reduce to runtime closure
# then: strip node_modules/better-sqlite3 if present (see SQLite note)
```

## SQLite strategy (no native module shipped)

`server/db.js` does `require("better-sqlite3")` (an `optionalDependency`) and
falls back to `require("./compat-sqlite")`, which wraps Node's built-in
`node:sqlite` `DatabaseSync`. We deliberately ship **without** `better-sqlite3`
(`npm ci --omit=optional` + an explicit strip in the build script) so the
fallback engages. No native addon, no `@electron/rebuild`, universal arm64+x64
DMG is trivially safe.

**Verified (Phase 0, 2026-05-18):** under `ELECTRON_RUN_AS_NODE=1` with the
repo's Electron binary — Electron 35.7.5 / Node 22.16.0 / arm64 —
`require("node:sqlite")` loads with **no `--experimental-sqlite` flag** (only a
harmless `ExperimentalWarning` on stderr). WAL mode, prepared statements, and
`BEGIN/COMMIT/ROLLBACK` (the exact API surface `compat-sqlite.js` uses) all work.

Documented fallback (not used today): rebuild `better-sqlite3` for the Electron
ABI via `npm_config_runtime=electron npm_config_target=<electron-version>
npm_config_disturl=https://electronjs.org/headers npm rebuild better-sqlite3`.
Tradeoff: a native `.node` is arch-specific and complicates the universal DMG —
exactly what the `node:sqlite` path avoids.

## Runtime configuration (set by the host sidecar, not patched in)

| Env var | Value set by host | Purpose |
|---|---|---|
| `DASHBOARD_PORT` | `4820` (fixed) | server listen port; also the port the hook handler POSTs to (`CLAUDE_DASHBOARD_PORT` default 4820) so hooks need no per-hook env |
| `DASHBOARD_DB_PATH` | `<userData>/agent-monitor/dashboard.db` | durable DB outside the read-only packaged app dir |
| `NODE_ENV` | `production` | server serves built `client/dist` |
| `ELECTRON_RUN_AS_NODE` | `1` | packaged app ships no standalone `node` |
| `CCAM_AUTO_INSTALL_HOOKS` | unset by default; `1` only on explicit opt-in | gates Patch #2 |

## Update procedure

1. `git clone https://github.com/hoangsonww/Claude-Code-Agent-Monitor` at the
   new commit; re-copy the same path subset over `vendor/agent-monitor/`.
2. **Re-apply Patches #1 and #2 and re-add `scripts/uninstall-hooks.js`** (this
   ledger is the source of truth). The build asserts Patch #1/#2 markers are
   present and fails the build if they are missing.
3. Rebuild via `apps/desktop/scripts/build-agent-monitor.mjs` (runs the Phase-0
   `node:sqlite` probe as a hard gate).
4. Regenerate `THIRD_PARTY_NOTICES.md`; bump `apps/desktop/package.json` version
   (CI-enforced); run the clean-machine packaged-DMG smoke test before release.
