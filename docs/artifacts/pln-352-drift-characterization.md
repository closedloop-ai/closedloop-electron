# Drift Characterization: telemetry-loop-integration.test.ts (PLN-352)

Commit SHA at time of analysis: `6c8ac24`

## Classification: Class C — Not Stale

`apps/desktop/test/telemetry-loop-integration.test.ts` is **not stale**. All 6 tests
pass against current production code without modification. The test correctly exercises
the current production spawn and telemetry emission paths.

## Correction of PRD Line Number Citations

The PRD cited `symphony-loop.ts` lines 1733 and 3697–3830 as "production spawn sites."
These citations are inaccurate:

- **Line 1733**: Prompt construction for the claude CLI — not a spawn site.
- **Lines 3697–3830**: `cloneRepoViaGh()` / repo resolution logic — not spawn sites.

The actual spawn sites are documented below.

## Actual Production Spawn Sites (symphony-loop.ts)

All spawn calls use Node.js native `child_process.spawn()` with `stdio` arrays.
No PTY API is involved anywhere in the codebase.

| Line | Command | stdio |
|------|---------|-------|
| 1836 | LLM commit assistant (`claudeBinary`) | `"pipe"` (stdout/stderr streamed) |
| 4349 | DECOMPOSE pipeline (`buildClaudePipeline`) | `["ignore", logFd, logFd]` |
| 4374 | EVALUATE_PRD pipeline (`buildClaudePipeline`) | `["ignore", logFd, logFd]` |
| 4407 | EVALUATE_PLAN / EVALUATE_CODE pipeline (`buildClaudePipeline`) | `["ignore", logFd, logFd]` |
| 4446 | REQUEST_CHANGES pipeline (`buildClaudePipeline`) | `["ignore", logFd, logFd]` |
| 4467 | GENERATE_PRD pipeline (`buildClaudePipeline`) | `["ignore", logFd, logFd]` |
| 4500 | PLAN / EXECUTE — `run-loop.sh` script | `["ignore", logFd, logFd]` |

All pipeline spawn calls are preceded by `getResolvedClaudePath()` (from
`apps/desktop/src/server/shell-path.ts`) which the test exercises via
`setShellPathForTest()` + `process.env.PATH` manipulation.

## Actual Telemetry Emission Sites (symphony-loop.ts)

| Line | Category | Trigger |
|------|----------|---------|
| 2923 | `job.failed` | Child process exits with non-zero code |
| 3339 | `job.completed` | Child process exits 0 (JobStore path) |
| 3409 | `job.completed` | Child process exits 0 (legacy path) |
| 4162 | `preflight.binary_not_found` | `getResolvedClaudePath()` returns a path that does not exist |
| 4253 | `preflight.spawn_failed` | `openSync(logFile, "a")` throws (e.g. EISDIR) |
| 4517 | `preflight.spawn_failed` | `child.on("error")` fires after spawn (e.g. ENOENT) |

## Why the Test Is Not Stale (Class C Rationale)

1. **Binary resolution path**: Tests 1–5 place a fake `claude` binary on `PATH` and call
   `setShellPathForTest()`. This correctly exercises `getResolvedClaudePath()` (the
   `"path"` resolution strategy), which is the same path production uses when no
   override is configured.

2. **Spawn path coverage**: Tests 1, 2, and 5 use the `DECOMPOSE` command which hits the
   spawn at line 4349. Test 4 (`preflight.spawn_failed`) uses the `PLAN` command which
   reaches the log-file open at line 4253 before spawning. Both paths remain in
   production.

3. **Telemetry category alignment**: The test targets all four current telemetry categories
   (`job.failed`, `job.completed`, `preflight.binary_not_found`, `preflight.spawn_failed`)
   which are the exact categories emitted by the current production code. No deprecated
   or renamed categories are asserted.

4. **No PTY references**: Zero matches for `spawnPtySession`, `spawnPty`, `pty.spawn`,
   or `node-pty` in `apps/desktop/src/` or `apps/desktop/test/`. The original framing
   of a "PTY migration" does not correspond to anything in the current codebase. All
   spawn calls use native `child_process.spawn()` with `stdio` arrays.

5. **Test pass evidence** (2026-04-23, commit `6c8ac24`):
   - `job.failed emitted with correct category/trace/diagnostics on process exit non-zero` — PASS (212ms)
   - `job.completed emitted with correct category/trace on process exit 0` — PASS (158ms)
   - `preflight.binary_not_found emitted when claude is absent from PATH` — PASS (12ms)
   - `preflight.spawn_failed emitted when log file open fails (EISDIR)` — PASS (15ms)
   - `commandId and operationId from request headers appear in trace context` — PASS (138ms)
   - `Observability truncates logTail to TELEMETRY_MAX_FIELD_BYTES via TelemetryService` — PASS (<1ms)
   - **Total: 6/6 pass, 0 fail, 1622ms**

## Remediation Approach

Per PRD behavioral details for Class C: "drop the 'stale' label, record the rationale
in the PR description, and redirect effort to Feature 2."

No code changes are required. The 'stale' designation is dropped. Effort is redirected
to Feature 2 (broader test audit) which can now be correctly scoped given that
`telemetry-loop-integration.test.ts` is confirmed current.
