# PHASE3-SIDECAR-REUSE

> FEA-1437 pre-explorer pass (PLN-760). Question: can the existing `helpers/launch-sidecar.mjs` (used by the node:test API audits) also serve the Phase-3 Playwright UI tests, or does Playwright need its own boot path?

**Parent:** FEA-1437 / PLN-760 · **Substrate:** FEA-1415 / PLN-738 (PR #246, `2a3a371`)

## Answer: YES — reuse, and it's already wired. No second boot path.

Pre-FEA-1407 the expected answer was "probably yes." Post-FEA-1407 it is **confirmed yes**, and PR #246 already ships the wiring. The boot *path* (`launchSidecar`) is shared between both test families today; only the *lifecycle wrapper* differs, for a structural reason (Playwright forks workers).

### Evidence in the merged tree

| consumer | how it boots | file |
|---|---|---|
| node:test API audits | call `launchSidecar({ dbPath })` directly in each file's `before()` | `specs/audit/all-screens.api-audit.test.mjs:35`, `pack-detail.audit.test.mjs:27`, `claude-hooks.contract.test.mjs:48` |
| Playwright UI specs | one shared sidecar booted in `globalSetup` → `baseUrl` handed to specs via a state file + `E2E_BASE_URL`; specs `page.goto("/")` | `helpers/playwright-global-setup.ts:20`, `playwright.config.ts:43` |

Both call the **same** `launchSidecar`. It boots the same `.generated/agent-monitor/server/index.js` that the Electron host runs in production — which serves both the JSON API **and** the client bundle, so the `baseUrl` is directly navigable by Playwright (`page.goto(baseUrl + route)`), exactly as the four existing `specs/ui/*.spec.ts` already do.

### Why there are two *wrappers* but one *boot path*

- **node:test** boots a sidecar per test file (per-`before()`), because node:test runs in one process and each file owns its lifecycle.
- **Playwright** forks workers, so process-level globals don't survive. `globalSetup` boots **one** fixture-loaded sidecar, writes `{ baseUrl, pid, dbPath }` to a state file (`closedloop-e2e-sidecar-state.json`), and `playwright.config.ts` reads `baseURL` back from that file (it can't trust `process.env` because the config is evaluated before `globalSetup` runs — see the comment at `playwright.config.ts:5-10`). `globalTeardown` kills the pid and removes the temp DB dir.

This is a lifecycle difference, not a boot difference. Phase 3 does **not** need a new boot path — it extends the existing `globalSetup`/`globalTeardown` pair already in the repo.

## The two FEA-1407 concerns, re-confirmed

### 1. Sandbox scoping (`SANDBOX_BASE_DIRECTORY`) — handled, automatically inherited ✅

FEA-1407 makes the hook handler silently drop events whose `data.cwd` falls outside `SANDBOX_BASE_DIRECTORY`. PR #246's merge resolution sets **`SANDBOX_BASE_DIRECTORY=/`** — and critically, it sets it **inside `launch-sidecar.mjs` itself** (`launch-sidecar.mjs:96-101`), not per-test. So every consumer of the helper inherits it for free. The PLN-760 risk row ("Phase 3 specs must inherit `SANDBOX_BASE_DIRECTORY=/` or hook fixtures silently no-op") is **already satisfied by construction** — there is nothing for Phase 3 to remember to set. The "one-line check in the helper" the feature doc asked for already exists.

> Guard to keep: a Phase-3 reviewer should ensure no spec passes its own `env` to `launchSidecar` that *overrides* `SANDBOX_BASE_DIRECTORY` to something narrower. The helper spreads caller `env` last (`launch-sidecar.mjs:116`), so a careless override would win. Worth a lint/assert.

### 2. Enqueue/drain hook handler — orthogonal to Playwright UI tests ✅

This is the key clarification. **Phase-3 Playwright UI tests never traverse the hook enqueue/drain path.** They read **pre-seeded** fixture data: `globalSetup` calls `seedFixtureDb(dbPath)` + `reseedPacksAndSkills(dbPath)` (`playwright-global-setup.ts:18-21`) to write rows directly into the temp SQLite, then the sidecar serves them through the unchanged API → UI. The hook handler (`POST /api/hooks/event`) is not in that loop.

The hook handler — including the FEA-1407 cwd-sandbox-drop behavior and the enqueue/drain semantics — is exercised separately by `specs/audit/claude-hooks.contract.test.mjs`, which POSTs synthetic events to `/api/hooks/event` (`claude-hooks.contract.test.mjs:59`) with a fixture `cwd` that the widened sandbox (`/`) lets through. That coverage lives in the node:test family and stays there.

**Implication for Phase 3:** the hook-handler re-confirmation FEA-1437 worried about is real, but it does **not** gate Playwright reuse — it's already covered by the contract test on the node:test side. Phase-3 UI specs depend only on (a) the shared boot path and (b) direct DB seeding, both of which are stable.

## Recommendation for Phase 3 kickoff

1. **Reuse `launchSidecar` + the existing `globalSetup`/`globalTeardown` as-is.** Do not write a second boot path.
2. New P0 specs go in **`specs/audit/`** (run via `playwright.audit.config.ts` / `test:audit:ui`), not `specs/ui/` — because audit specs intentionally assert current-buggy values (e.g. the FEA-1418 cost bug) and must not block the default `test:e2e` gate. The config split for this already exists (`playwright.config.ts:28-34`, `playwright.audit.config.ts:13-16`).
3. Build the Phase-3 helpers (`helpers/playwright-region.ts`, `helpers/playwright-oracle.ts`) on top of the shared `baseUrl` — no sidecar concerns leak into them.
4. Add a one-line assertion (or a comment) guarding against a spec overriding `SANDBOX_BASE_DIRECTORY` to a narrower path via the `env` arg.

**Net:** sidecar reuse is a solved problem. Phase 3 starts from "boot is done" and spends its budget on DOM-slicing + oracle bridging, exactly as PLN-760's Phase-3 task list assumes.
