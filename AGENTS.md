# Repository Guidelines

## Project Structure & Module Organization
This repository is a pnpm workspace with one primary app at `apps/desktop/`.

- `apps/desktop/src/main/`: Electron lifecycle, tray/window boot, cloud relay wiring.
- `apps/desktop/src/server/`: localhost HTTP gateway routes, auth, and operation handlers.
- `apps/desktop/src/shared/`: shared contracts, types, and cross-layer utilities.
- `apps/desktop/src/renderer/`: renderer/preload bridge code.
- `apps/desktop/test/`: integration and unit tests (`*.test.ts`), plus `fixtures/` and helpers.
- `apps/desktop/resources/` and `apps/desktop/scripts/`: icons and build/support scripts.

Generated outputs (`dist/`, `dist-dmg/`) should not be committed.

## Build, Test, and Development Commands
Use `just` recipes from the repo root:

- `just install`: install workspace dependencies.
- `just desktop-dev`: build and run Electron locally.
- `just desktop-no-auth`: start Electron with gateway auth disabled for local development only.
- `just desktop-debug-auth`: start Electron with debug token minting enabled.
- `just desktop-start`: run Electron from existing build output.
- `just desktop-lint`: run ESLint for desktop sources.
- `just desktop-typecheck`: run TypeScript `--noEmit`.
- `just desktop-test`: run the desktop test suite.
- `just desktop-package`: build and package a macOS DMG.

Workspace-wide commands are also available: `just build`, `just test`, `just typecheck`.

## Coding Style & Naming Conventions
TypeScript is strict-mode (`tsconfig.base.json`) and ESM (`NodeNext`).

- Follow existing style: 2-space indentation, semicolons, double quotes.
- Prefer `kebab-case` file names (for example, `gateway-auth.ts`).
- Keep boundaries clear between `main`, `server`, and `shared` modules.
- Use `.js` extensions in ESM imports.
- In Desktop main/server NodeNext ESM code, dependency subpath imports must either use an exported package subpath or the concrete runtime file extension, and new subpath imports should be validated against built output before shipping.
- Prefix intentionally unused variables/args with `_` to satisfy lint rules.
- Do not edit `apps/desktop/src/shared/build-info.ts` manually (auto-generated in prebuild).
- When changing the desktop Node tooling baseline or Electron runtime assumptions, keep `@types/node` pinned to the lowest supported Node runtime major so TypeScript cannot accept newer Node-only APIs.
- For GitHub Actions jobs that run desktop tests or package/release under Node 24, verify Electron's platform binary with `pnpm -C apps/desktop verify:electron-binary` immediately after `pnpm install --frozen-lockfile`. Do not inline ad hoc Electron download logic in workflows; keep the shared verifier out of static/headless audit jobs that do not launch or import Electron.
- Avoid unnecessary TypeScript casts. Prefer importing concrete shared types, narrowing with type guards, or shaping helper return types so call sites do not need `as` to satisfy the compiler.
- Use shared constants, generated enums, or exported enum-like objects for statuses, reasons, protocol modes, channel names, storage keys, and other contract values. Do not duplicate hardcoded strings when a constant or enum exists.
- Export and reuse shared TypeScript types for cross-module contracts or metadata patches instead of duplicating inline `Pick`/`Partial` shapes in callers.
- When the same helper logic, object shape, or protocol type appears in multiple files, extract it into the nearest shared module owned by that surface instead of committing parallel copies.
- Prefer schema-based object validation and narrowing at JSON, IPC, persisted-store, and HTTP boundaries instead of ad hoc `Record<string, unknown>` casts or manual `typeof value === "object"` checks. Reuse or colocate schemas when the shape is shared.
- For expected service outcomes such as conflicts, invalid state transitions, missing records, validation failures, or unsupported operations, return typed domain results instead of throwing custom Error classes for control flow.
- Avoid `instanceof` and `in` checks for routine error/result handling when a typed result discriminant or shared error code can express the branch more clearly. Reserve thrown errors and exception-style narrowing for unexpected failures or third-party APIs that require it.
- Do not keep private fields, module-level variables, or setter assignments that are never read after a refactor. If identity or context moves to another service or server-side enrichment path, remove the stale client-side state instead of preserving misleading dead writes.

## Gateway Operations
Gateway route handlers live under `apps/desktop/src/server/operations/`.

- Before adding a helper to an operation file, check existing shared modules such as `response-utils.ts` for `json()` and `symphony-utils.ts` for `expandHome()`. If helper logic is used by more than one operation, extract it into a shared module instead of copying it.
- Follow the route registration pattern: export `registerXxxRoutes(dispatcher, ...deps)` from the operation module and register it from `router.ts`.
- Cloud relay commands are parsed before operation handlers run, and the parser accepts only paths that start with `/api/gateway/`. New server-control or internal relay commands must use the `/api/gateway/` namespace, and any intentional legacy namespace support must update and test the parser before relying on the handler.
- Do not duplicate local response helpers across operation files.
- When classifying failed spawned commands or gateway operations, inspect every captured output stream that can feed the user-facing excerpt or diagnostic payload, not only `stderr`. Add focused coverage for stdout-only and stderr-only failure markers when the classification depends on process output.
- When adapting cloud relay command bodies before forwarding them to local gateway routes, preserve each route handler's request contract. Add focused coverage for every route whose body is transformed, especially when one route swaps credentials and another route must keep its original payload fields.
- When a gateway request includes `localRepoPath`, never serialize or forward the raw request path into runtime context, environment, process args, or persisted metadata after sandbox policy rejects it. Only materialize the policy-approved resolved path returned by `tryAssertRepoAllowed`/`assertPathAllowed`, such as `expandedRepoPath`; optional-repo commands that ignore a rejected path must also omit it from `.closedloop-ai/context/*` files.
- When parsing Git CLI path output, account for Git C-quoted paths and format-specific separators instead of using JSON parsing or unqualified string splits. Add focused coverage for non-ASCII filenames, quoted filenames containing separator text, and binary add/delete metadata when the route returns file status or diff shape.
- Git diff and numstat output does not cover every status class, especially untracked files. When a gateway response exposes file stats for mixed tracked and untracked local changes, either supplement the missing untracked metadata or explicitly document zero-value semantics, and add route-level coverage for the chosen behavior.

## Browser Command Keys
Browser command-key authorization and reconciliation must fail closed for target-scoped org trust. If an active target context exists and remote key classification is skipped, invalid, mismatched, or legacy-only instead of fully scoped, prune or clear org-sourced local key trust rather than leaving approvals from a prior target usable; cover skip paths that keep non-org keys but remove stale org keys.

When browser command-key lifecycle code replaces the active target context, clear target-bound transient approval markers such as remembered legacy contextless fingerprints before later manual approval decisions can observe the new context. Add coverage for target switches carrying stale approval state.

## Testing Guidelines
Tests run with `tsx --test` (Node test runner) via `just desktop-test`.

- Place tests in `apps/desktop/test/` and name files `*.test.ts`.
- Add or update tests with behavior changes, especially gateway auth, process spawning, and telemetry flows.
- Observability and telemetry refactors must preserve direct facade coverage for security-sensitive redaction and resilience invariants, including descriptor-only outbound network telemetry and "telemetry emission never throws" behavior. Do not rely only on lower-level policy tests when the facade serializes the emitted event.
- Keep tests portable in CI: avoid shelling out to optional host tools such as `rg` when Node or TypeScript APIs can prove the invariant. If a test truly requires an external CLI, make the dependency explicit in the workflow before relying on it.
- Renderer tests that cover IPC-backed panels should exercise the initial activation path or make render helpers tolerate absent/empty data, so a tab can open before its first async poll resolves.
- Before opening a PR, run: `just desktop-lint && just desktop-typecheck && just desktop-test`.

## Breaking Changes
Migration requirements apply only to contracts consumed by separate repositories or external clients that ship and upgrade independently of the desktop app:
HTTP gateway routes, cloud relay messages, and persisted store schemas read across downgrade/rollback boundaries.

- Breaking those external contracts requires legacy migration logic at the boundary and a ClosedLoop ticket to track removing the migration path later.
- For optional external payload fields, preserve omission when a value is absent. Do not serialize absent optional fields as `null` unless the receiving contract explicitly declares that field nullable and old clients are known to accept it.
- Internal contracts that ship as one Electron bundle do not need migration logic: main/renderer IPC bridge messages, internal module interfaces, and types consumed only inside `apps/desktop/`.
- When reviewing a compatibility issue, first identify whether the caller is independently shipped. If both producer and consumer update atomically in the same desktop build, treat it as an internal refactor unless persisted data or an external client is involved.

## Cross-Repo Telemetry Contracts

Desktop telemetry categories, diagnostics fields, and relay/API event payload
shapes are producer contracts consumed by `symphony-alpha`. When adding or
changing a Desktop telemetry payload, include the `symphony-alpha` consumer
update in the same PR stack or call out the required companion PR explicitly.

Long-lived telemetry context setters that consume optional or version-skewed
gateway payload fields must clear stale state when the latest payload omits or
blanks that context. Add regression coverage for reconnects, user switches, or
legacy payloads that should fall back instead of preserving a previous identity.

At minimum, verify the companion change covers:

- `packages/observability/telemetry/schema.ts` accepts the new Desktop-origin
  diagnostics shape.
- `apps/api/lib/desktop-telemetry-handler.ts` preserves the fields into
  Datadog-bound metadata.
- Tests prove the new Desktop payload survives schema parsing, diagnostics
  sanitization, and handler logging.
- Docs or runbooks list the Datadog query and expected structured fields.

Do not assume a Desktop-emitted diagnostic is queryable in Datadog until the
`symphony-alpha` consumer schema and handler tests prove it.

## Commit & Pull Request Guidelines
Commit format follows `.gitmessage` and recent history:

- Subject: `<TICKET>: <imperative summary>` (example: `PLN-276: Add binary path overrides`).
- Body: short bullet list of key changes.
- Footer sections: `Testing:` and `Risks:`.
- In the `Testing:` footer, summarize the validation scope instead of listing every command when the command list is repetitive. Prefer phrasing like `Localized desktop tests, typecheck, and lint passed` or `Full desktop test suite, typecheck, and lint passed`. Include specific commands only when a precise command is unusually important to reproduce a failure or narrow validation. Include manual testing only when the user clearly reported doing it during the chat or you personally performed it.

PRs should target `main`, explain what changed and why, link the ticket, and include screenshots/log snippets when UI or gateway behavior changes. Any PR that changes files under `apps/desktop/` must include a version bump in `apps/desktop/package.json`. If the current branch already has a version bump in `apps/desktop/package.json` (committed or uncommitted), do not bump again until you fetch current `origin/main` and verify the branch version still differs from the merge-base/main version. If main has caught up to the same version while the PR is open, bump again before resolving version-bump review threads or calling the PR ready.

## GitHub Review Replies
When replying to existing GitHub PR review comments, use the review-comment REST reply endpoint (`POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies`) with the original review comment database ID. Do not use GraphQL `addPullRequestReviewThreadReply` unless you have verified in the GitHub UI or REST response model that it renders as a normal inline reply. After posting, verify the new comment has `in_reply_to_id` set to the original comment ID.
