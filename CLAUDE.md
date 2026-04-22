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

## Commit Messages

Follow the format in `.gitmessage`. The subject line must be `<TICKET>: <description>` where TICKET is extracted from the branch name (e.g. `FEAT-68: add no-auth dev mode`). Include bullet-point body, Testing, and Risks sections.
