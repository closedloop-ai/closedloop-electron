# `execution-result.json` Format Unification

## Why unify

Today the desktop harness writes two different shapes to `execution-result.json`:

- **V1** (single-repo): flat snake_case fields (`has_changes`, `pr_url`, `pr_number`, `branch_name`, `base_ref`, `base_branch`, `commit_sha`). No `schemaVersion`.
- **V2** (multi-repo): `{ schemaVersion: 2, results: RepoExecutionResult[] }`.

V2 is a strict superset semantically — single-repo is just `results.length === 1`. The split exists because PLN-378 minimized blast radius rather than as a deliberate design. It now costs us:

1. **Two writers** for one artifact: `buildPersistedExecutionResultArtifact()` (V1) plus the inline V2 envelope assembly in `runLoop`.
2. **Two readers** in the desktop app: the V1/V2 dispatch in `buildCompletedEventResult()` at [loop-finalizer.ts:248](../apps/desktop/src/main/loop-finalizer.ts#L248), and the symmetric V1 normalization path inside `parseExecutionResultFile` (loops-api).
3. **A standing `TODO(FEA-683)`** that has to be worked eventually anyway.
4. **Test surface duplication**: every consumer needs V1-shaped fixtures and V2-shaped fixtures.
5. **Cognitive load**: future readers must learn that "single-repo gets snake_case, multi-repo gets camelCase + envelope" — a rule with no semantic justification.

The fix is to make V2 the only on-disk write format. V1 *reading* must remain for one release window (in-flight jobs and older desktop builds wrote V1), then gets removed under FEA-683.

## Goals

- Single writer, single shape on disk.
- Delete V1-specific writer code and V1-specific dispatch in the finalizer.
- Net code reduction in `symphony-loop.ts` and `loop-finalizer.ts`.
- No new abstraction layers; no compatibility shims beyond what already exists in `parseExecutionResultFile`.
- No change to the cloud `completed` event wire shape (cloud consumers stay untouched).

## Non-goals

- Removing V1 *reader* support — that is FEA-683 and happens later.
- Changing `RepoExecutionResult` schema or cloud event payloads.
- Touching the LLM-commit prompt format (the LLM still writes V1 to its own scratch file; the harness re-emits as V2).

## Pre-flight checks (do before starting)

- [ ] `grep` the cloud repo (`symphony-alpha`) for direct reads of `execution-result.json` that bypass `parseExecutionResultFile`. If any exist, migrate them to the parser first or scope this work behind their fix.
- [ ] Confirm `parseExecutionResultFile` already emits a unified `RepoExecutionResult[]` for both V1 and V2 inputs (it does — [execution-result.ts:128](../../symphony-alpha/packages/loops-api/src/execution-result.ts)).
- [ ] Open ClosedLoop ticket per `CLAUDE.md` breaking-change rule, scoped to "stop writing V1" + "remove V1 reader" (or extend FEA-683 with the writer-removal sub-task).

---

## Tasks

### Task 1 — Centralize V2 envelope construction

Create a single helper that takes per-repo inputs and returns the V2 envelope. Replace the three V1 callsites in `runExecuteFinalization` (success / git-fallback success / no-changes) and the inline multi-repo block with calls to this helper.

**Files**
- `apps/desktop/src/server/operations/symphony-loop.ts` — add `buildExecutionResultV2(results: RepoExecutionResult[]): ExecutionResultV2`.
- Replace the three `buildPersistedExecutionResultArtifact(...)` callsites at [:2580](../apps/desktop/src/server/operations/symphony-loop.ts#L2580), [:2665](../apps/desktop/src/server/operations/symphony-loop.ts#L2665), [:2723](../apps/desktop/src/server/operations/symphony-loop.ts#L2723) with single-element V2 envelopes.

**Code reduction**
- Delete `buildPersistedExecutionResultArtifact` (~18 lines).
- The multi-repo inline V2 assembly at [:3519-3523](../apps/desktop/src/server/operations/symphony-loop.ts#L3519-L3523) collapses into the same helper call.

**Unit tests** — `apps/desktop/test/symphony-loop-execute.test.ts`
- `buildExecutionResultV2` returns `{ schemaVersion: 2, results: [...] }` for a single-repo `success` input with `prUrl`/`prNumber`/`branchName`/`commitSha` populated.
- Returns a `skipped` entry with `reason: "no_changes"` for a `hasChanges: false` single-repo input.
- Returns a `failed` entry preserving `error` for a single-repo failure input.
- Multi-repo input preserves order and `fullName` per entry.
- Round-trip: output validates against `ExecutionResultV2Schema` (zod) without modification.

### Task 2 — Always emit V2 from `runExecuteFinalization`

Single-repo finalization (LLM-commit success, git-fallback success, no-changes) writes a length-1 V2 envelope to `claudeWorkDir/execution-result.json` via `persistExecutionResultArtifact`.

**Files**
- `apps/desktop/src/server/operations/symphony-loop.ts` — the three success/no-changes paths in `runExecuteFinalization` build a `RepoExecutionResult` for the primary repo and call `buildExecutionResultV2([primary])` before persisting.
- The multi-repo path at [:3497-3524](../apps/desktop/src/server/operations/symphony-loop.ts#L3497-L3524) keeps its current shape (already V2) but routes through the same helper.

**Code reduction**
- The snake_case-shaping logic disappears.
- The multi-repo block stops being a special "rewrite the file" step — it's just one of two callers of the same writer.

**Unit tests** — `apps/desktop/test/symphony-loop-execute.test.ts`
- Single-repo LLM-commit success writes a file with `schemaVersion === 2` and `results[0].status === "success"`, `results[0].fullName` matching `body.repo.fullName`.
- Single-repo git-fallback success writes `schemaVersion === 2` with `commitSha` from `git rev-parse HEAD`.
- Single-repo no-changes writes `schemaVersion === 2` with `results[0].status === "skipped"` and `reason === "no_changes"`.
- Sandbox-block / persistence-failure paths still return `executionResultPersisted: false` and do **not** create a file.
- The persisted file passes `parseExecutionResultFile(content)` round-trip with `parsed.ok === true` and `parsed.schemaVersion === 2`.
- Multi-repo path produces a single file written exactly once (no double-write — V1 then V2 — like today).

### Task 3 — Collapse the V1/V2 dispatch in `buildCompletedEventResult`

`loop-finalizer.ts` currently branches on `execResult.schemaVersion === 2` and reads snake_case fields in the `else` branch. Replace with a single path that calls `parseExecutionResultFile(artifacts.executionResult, primaryFullName)` and reads camelCase fields off the normalized `RepoExecutionResult[]`.

**Files**
- `apps/desktop/src/main/loop-finalizer.ts` — replace [:246-276](../apps/desktop/src/main/loop-finalizer.ts#L246-L276) with a single block:
  - Parse via `parseExecutionResultFile`.
  - On parse failure: `has_changes = false`, log warn, return.
  - On parse success: set `repoResults = parsed.results`, look up primary via `getPrimaryRepoResult`, populate `prUrl` / `prNumber` / `branchName` / `has_changes` from the primary entry's `status`.
- `primaryFullName` source: prefer `job.primaryRepoFullName` (or equivalent on `LocalJob`); fall back to `parsed.results[0]?.fullName` when absent (recovery path for jobs persisted before the field existed).

**Code reduction**
- Drop the entire `else` branch reading `execResult.pr_url` / `pr_number` / `branch_name` / `has_changes`.
- Drop the `execResult as Record<string, unknown>` cast and the `execResult as unknown as ExecutionResultV2` cast — `parseExecutionResultFile` returns a typed result.
- Net: ~25 lines removed; one branch becomes one straight-line block.

**Why this still handles V1 on disk**: `parseExecutionResultFile` already handles both formats. A boot-recovery job whose worktree contains a V1 file written by an older desktop build parses cleanly to a length-1 `RepoExecutionResult[]`, and the finalizer code never sees the difference.

**Unit tests** — `apps/desktop/test/loop-finalizer.test.ts`
- V2 success input: `result.prUrl`, `prNumber`, `branchName`, `has_changes: true` populated from primary; `repoResults` equals the parsed array.
- V2 with primary missing: warn logged; `has_changes: false`; `prUrl`/`prNumber`/`branchName` absent from `result`.
- V2 with primary `status: "skipped"`: `has_changes: false`.
- V2 with primary `status: "failed"`: `has_changes: false`.
- **Legacy V1-on-disk** (recovery scenario): file is V1 snake_case shape; `parseExecutionResultFile` normalizes it; result populates camelCase fields correctly. This proves the V1 reader still works end-to-end via the unified path.
- Malformed JSON / parse failure: `has_changes: false`, warn logged, no throw.
- `branchName` fallback: when primary entry lacks `branchName`, `getCompletionCorrelationFields` worktree fallback fills it (existing behavior preserved).

### Task 4 — Remove now-dead exports and simplify imports

After Tasks 1–3, audit:

- `buildPersistedExecutionResultArtifact` — delete (no callers).
- `ExecutionResultV2` import in `loop-finalizer.ts` — likely no longer needed once the dispatch is gone (the type comes through `parsed.results`).
- `getPrimaryRepoResult` import path in `loop-finalizer.ts` — keep but verify single import source (currently from `../shared/contracts.js`; loops-api also exports one — pick one).
- `apps/desktop/src/shared/contracts.ts` — the local `RepoExecutionResult` / `ExecutionResultV2` / `getPrimaryRepoResult` shim has a `TODO: remove shim and import from @closedloop-ai/loops-api`. If the loops-api package now exports them, delete the shim.

**Code reduction** — anywhere from ~20 to ~50 lines depending on whether the contracts.ts shim is removable in the same PR.

**Unit tests** — none new. Existing tests + `tsc --noEmit` (`just desktop-typecheck`) prove no broken imports.

### Task 5 — Test fixture cleanup

Audit test fixtures across the desktop test suite for V1-shape `execution-result.json` content and consolidate.

**Files**
- `apps/desktop/test/loop-finalizer.test.ts`
- `apps/desktop/test/symphony-loop-execute.test.ts`
- `apps/desktop/test/symphony-loop-shared-contract.test.ts`
- `apps/desktop/test/boot-recovery.test.ts`
- `apps/desktop/test/symphony-loop-cloud-failures.test.ts`
- `apps/desktop/test/symphony-job-snapshot.test.ts`
- `apps/desktop/test/job-store.test.ts`

**Approach**
- Add one shared helper, e.g. `makeV2ExecutionResult(overrides)`, in a single test-utility file. Use it everywhere a fixture writes `execution-result.json`.
- Keep **exactly one** V1 fixture, gated to the "legacy V1-on-disk recovery" test in Task 3. Comment it explicitly with the FEA-683 reference so it gets deleted with the V1 reader.
- Delete all other V1-shaped fixtures.

**Code reduction** — every test that previously hand-rolled `{ has_changes, pr_url, pr_number, ... }` becomes a one-line factory call. Estimated 50–100 lines removed across the suite.

**Unit tests** — the migration is itself a test refactor. CI passes = success. No new tests added beyond the legacy V1 case in Task 3.

---

## Verification

After all tasks land:

- `just desktop-typecheck` — clean.
- `just desktop-lint` — clean.
- `just desktop-test` — all existing tests pass against V2-only writes; the one legacy V1 test still passes via the parser.
- Manual: spin up Electron, run an EXECUTE single-repo loop, inspect `execution-result.json` in the workdir — confirm `schemaVersion: 2` shape.
- Manual: run an EXECUTE multi-repo loop — confirm same shape, `results.length > 1`.
- Cloud `completed` event diff: capture before/after payloads for one single-repo run; confirm `result.prUrl`, `result.prNumber`, `result.branchName`, `result.has_changes` are bit-identical to today.

## Out of scope / follow-ups

- **FEA-683 reader removal**: once the in-flight job retention window passes and old desktop builds have rolled over, delete the V1 normalization branch from `parseExecutionResultFile` (`loops-api` package) and drop the legacy V1 fixture from Task 5.
- **Cloud-side audit**: if Pre-flight check #1 surfaced direct V1 readers, that's a separate ticket.
- **`buildPrimaryRepoResult` → `buildExecutionResultV2` interaction**: if both end up shaping the same data, consider folding `buildPrimaryRepoResult` into the new helper. Defer until Task 1 is in code review.
