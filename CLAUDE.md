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

This rule applies ONLY to contracts consumed by separate repositories or external clients that ship and upgrade independently of the desktop app: HTTP gateway routes (consumed by the web app, CLI, or third-party tools), cloud relay messages (consumed by the cloud control plane), persisted store schemas on disk (read by older app versions during downgrade/rollback). Any breaking change to those contracts requires both of the following before merging:

1. **Legacy migration logic** so existing external consumers are not broken on upgrade. Detect the old shape and translate it to the new shape at the boundary; do not assume external consumers have already migrated.
2. **A ClosedLoop ticket** created via the ClosedLoop MCP (`mcp__closedloop__create-feature`) to track removing the legacy migration code at a later date. Reference the ticket ID in a comment next to the migration logic so it can be found and deleted when the ticket is worked.

This rule does NOT apply to internal contracts that ship as a single unit with the app: IPC bridge messages between main and renderer, internal module interfaces, type definitions consumed only within `apps/desktop/`. Both sides of an IPC channel are bundled into the same Electron build, so a breaking change updates the producer and consumer atomically — no migration is needed.

## Gateway Operations (`apps/desktop/src/server/operations/`)

- **Shared helpers live in dedicated modules.** Before adding a local helper function to an operation file, check if it already exists in a shared module (e.g., `response-utils.ts` for `json()`, `symphony-utils.ts` for `expandHome()`). If a helper is used by more than one operation, extract it into a shared module.
- Route registration pattern: export `registerXxxRoutes(dispatcher, ...deps)`, register in `router.ts`.
- Use `.js` extensions in ESM imports.

## Learned Patterns

### Code Organization
- **[mistake]**: When adding new operation files, do not copy-paste helper functions from existing files. Check for shared modules first. The `json()` response helper was duplicated across 33 files before being extracted into `response-utils.ts`.
- **[mistake]**: For agent-monitor harness, parser, and build code, extract shared helpers into `agent-monitor-shared`, `parser-utils`, or nearby shared modules instead of duplicating per harness. (context: agent-monitor|duplication|helpers)

### Testing
- **[mistake]**: When writing tests, check for existing shared test helpers (conftest, test_helpers, shared fixtures) before defining local helpers. Duplicated test setup functions drift silently when the shared contract changes. (context: tests|duplication|helpers)
- **[mistake]**: Regression tests must assert the exact reviewed invariant, not only comments or a local surrogate path. (context: tests|coverage|regression)

### Code Quality
- **[mistake]**: When adding code comments, verify they describe the current behavior — not a prior design or planned feature. Comments referencing non-existent files, removed fields, or superseded workflows mislead future readers. (context: comments|accuracy|stale)
- **[mistake]**: Never fabricate history in changelogs, commit messages, or comments. Do not claim code "replaces" or "fixes" a prior implementation unless that implementation verifiably exists in the codebase or git history. (context: changelog|hallucination|fabrication)
- **[mistake]**: Before adding a fallback or recovery path, verify the triggering condition can actually occur. Dead fallbacks that read from files never written or variables never set create false confidence in error handling. (context: dead-code|fallback|unreachable)

### Agent Monitor & Sidecar Security
- **[mistake]**: Treat localhost sidecar routes and iframe messages as privileged surfaces. Mutating routes need origin/trusted-action guards, explicit target origins, and regression coverage. (context: agent-monitor|sidecar|security)

### Process Spawning & Secrets
- **[mistake]**: Keep large or sensitive data out of spawned argv/env. Use stdin or files for prompts, quote shell args, set approved cwd, and pass minimal child environments. (context: spawn|argv|env|secrets)

### Boundary Validation
- **[mistake]**: Runtime-validate gateway, IPC, and persisted payloads before path or file use. TypeScript casts and preload promise types do not protect missing or null fields. (context: validation|ipc|gateway)

### Generated Agent Monitor Runtime
- **[pattern]**: When generated sidecar overlays, snippets, or patch inputs change, update stamp/materialization inputs and verify generated output so stale assets or bypassed patches cannot ship. (context: agent-monitor|generated|build)

### State & Lifecycle
- **[mistake]**: Setting toggles must update persisted state and in-memory side effects together. Avoid one-way restart guards, stale tray state, or stale cloud presence. (context: settings|lifecycle|state)

## Commit Messages

Follow the format in `.gitmessage`. The subject line must be `<TICKET>: <description>` where TICKET is extracted from the branch name (e.g. `FEAT-68: add no-auth dev mode`). Include bullet-point body, Testing, and Risks sections.
