# ClosedLoop Electron Monorepo

## Structure

- `apps/desktop/` -- Electron desktop app (localhost HTTP gateway, cloud relay, tray UI)

## Useful Commands

Run `just` to see all available recipes. Key ones:

- `just desktop-dev` -- build and start Electron
- `just desktop-no-auth` -- start with gateway auth disabled (dev only)
- `just desktop-debug-auth` -- start with debug token minting enabled
- `just desktop-lint` -- run ESLint
- `just desktop-typecheck` -- run TypeScript type checking
- `just desktop-test` -- run tests

## Breaking Changes

Any breaking change to APIs, contracts, or interfaces (HTTP gateway routes, cloud relay messages, IPC bridge, persisted store schemas, etc.) requires both of the following before merging:

1. **Legacy migration logic** so existing users are not broken on upgrade. Detect the old shape and translate it to the new shape at the boundary; do not assume users have already migrated.
2. **A ClosedLoop ticket** created via the ClosedLoop MCP (`mcp__closedloop__create-feature`) to track removing the legacy migration code at a later date. Reference the ticket ID in a comment next to the migration logic so it can be found and deleted when the ticket is worked.

## Gateway Operations (`apps/desktop/src/server/operations/`)

- **Shared helpers live in dedicated modules.** Before adding a local helper function to an operation file, check if it already exists in a shared module (e.g., `response-utils.ts` for `json()`, `symphony-utils.ts` for `expandHome()`). If a helper is used by more than one operation, extract it into a shared module.
- Route registration pattern: export `registerXxxRoutes(dispatcher, ...deps)`, register in `router.ts`.
- Use `.js` extensions in ESM imports.

## Learned Patterns

- **[mistake]**: When adding new operation files, do not copy-paste helper functions from existing files. Check for shared modules first. The `json()` response helper was duplicated across 33 files before being extracted into `response-utils.ts`.

## Mock-Hygiene Convention

All hand-written mocks must stay in sync with the real modules they stand in for. Stale mocks are a frequent source of silent test failures that pass locally but break against the real implementation.

**Drift-check comment format.** Every mock file must carry a drift-check header comment immediately after its imports. Use the following format exactly so the CI drift-check script can locate and validate it:

```ts
// MOCK-DRIFT-CHECK: source=<relative-path-to-real-module> hash=<sha256-of-public-surface>
// Re-run `just mock-drift-check` after changing the real module to update this hash.
```

- `source` is the path to the real module relative to the repo root (e.g. `apps/desktop/src/server/operations/foo.ts`).
- `hash` is a SHA-256 digest of the exported public surface (type signatures + exported symbol names). Regenerated automatically by `just mock-drift-check`.

**ESM-only rationale.** Mocks in this repo are plain `.ts` / `.js` ESM modules — never CommonJS `require`-style stubs. The desktop app's build pipeline (esbuild + native ESM) does not support mixed-module graphs; CJS stubs cause silent no-ops at runtime. Always use named `export` / `export default` in mock files.

**Drift-check CI script.** The script `scripts/mock-drift-check.ts` (run via `just mock-drift-check`) scans all files matching `**/__mocks__/**/*.ts` and `**/*.mock.ts`, reads their `MOCK-DRIFT-CHECK` header, recomputes the hash of the referenced source module, and exits non-zero if any hash is stale. This check runs in CI on every PR. If you add or modify a real module that has a mock, update the mock and regenerate the hash before pushing.

## Commit Messages

Follow the format in `.gitmessage`. The subject line must be `<TICKET>: <description>` where TICKET is extracted from the branch name (e.g. `FEAT-68: add no-auth dev mode`). Include bullet-point body, Testing, and Risks sections.
