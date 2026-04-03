# Process Management Architecture

## Impact Summary

This feature does not spawn new child processes, introduce new PID files, or change kill behavior. The fix is confined to post-exit status resolution inside `finalizeLoopFromRuntime` in `apps/desktop/src/main/loop-finalizer.ts`. The only process-management-adjacent concern is that the plan adds a `statePath` inference step in the finalizer; a nearly identical inference pattern already exists in `apps/desktop/src/main/app.ts` (lines 909-967) and must be kept in sync.

## Files to Modify

- `apps/desktop/src/main/loop-finalizer.ts` — add boot-recovery RUNNING status resolution step in `finalizeLoopFromRuntime`; no spawn, no kill, no PID file changes

## New Process Family

Not applicable — no new process family is introduced.

## Implementation Notes

**The `persistFinalJobStatus` gap (blocking):** When `isSuccessStatus` is false and `job.status` is `"RUNNING"`, `persistFinalJobStatus` (line 305-306) resolves to `job.status`, persisting `"RUNNING"` as the terminal status rather than `"FAILED"`. T-1.1 must either: (a) derive a `"FAILED"` replacement for `effectiveJob.status` before calling `persistFinalJobStatus`, or (b) add an explicit `"RUNNING" => "FAILED"` mapping inside `persistFinalJobStatus`'s `resolvedStatus` expression. Option (a) is preferable because it keeps the derived job consistent across all downstream calls.

**Consistency with `app.ts` reconciliation pattern:** `apps/desktop/src/main/app.ts` lines 909-967 already implement the same statePath terminal-status inference during startup reconciliation. The terminal statuses it maps are `COMPLETED`, `FAILED`, `CANCELLED`, `AWAITING_USER`, `STOPPED`; processes dead with no terminal snapshot are mapped to `UNKNOWN` (not `FAILED`). The finalizer's new inference step must map the same set and apply the same `UNKNOWN` fallback only where appropriate — or justify divergence. The plan currently specifies `FAILED` as the fallback for unresolved boot-recovery RUNNING; this diverges from `app.ts`'s `UNKNOWN` fallback and needs either alignment or an explicit architectural decision recorded in the plan.

**`STOPPED` handling in `shouldPostErrorEvent`:** The existing `shouldPostErrorEvent` check (line 542-545) already includes `"STOPPED"`, so if `statePath` returns `STOPPED`, `tryPostErrorEvent` will be called and will emit `PROCESS_STOPPED` — correct behavior. No changes needed for that path.

**`CANCELLED` terminal snapshot:** If `statePath` returns `CANCELLED`, the `app.ts` pattern returns that status. The finalizer's `effectiveJob` already handles `CANCEL_PENDING -> CANCELLED` earlier (line 533), but a `statePath`-inferred `CANCELLED` on a RUNNING job needs to be routed to the existing `CANCELLED` leg (neither success nor error event). Verify that the derived `effectiveJob` with `status: "CANCELLED"` falls through to the `else { cloudFinalized = true }` branch as intended.

## AC-049 Checklist

- [x] No new `cwd`, `logFile`, or filesystem paths are passed to `ProcessManager` methods — the feature reads `statePath` via `readFileSync`, not via ProcessManager
- [x] `statePath` is read with `existsSync`/`readFileSync` directly (same pattern as `app.ts`); this is not a spawn/exec call and is not subject to sandbox allowlist enforcement
- [x] No new spawn, exec, or detached process calls are introduced
- [x] No `DirectoryNotAllowedError` surface is added

## Integration Points

- `BootRecoveryService.finalizeRecoveredJob` (in `boot-recovery.ts`) calls `finalizeLoopFromRuntime` with `reason="boot-recovery"` — this is the entry point that triggers the new resolution step; no changes to `boot-recovery.ts` are needed per the plan
- `app.ts` startup reconciliation performs a parallel statePath inference on its own; changes to terminal-status mapping in the finalizer should be cross-checked against `app.ts` lines 909-967 to avoid divergence

## Risks

- **`RUNNING` persisted as terminal status if derivation is not applied before `persistFinalJobStatus`**: If `effectiveJob.status` is still `"RUNNING"` when `persistFinalJobStatus` is called with `isSuccessStatus=false`, the stored terminal status will be `"RUNNING"`. The plan must ensure the derived job (with `status: "FAILED"`) replaces `effectiveJob` before any persistence or event call. Mitigation: use a single derived job variable for all downstream calls in T-1.1.
- **Divergence between finalizer and `app.ts` on UNKNOWN fallback**: `app.ts` maps dead-RUNNING-no-snapshot to `UNKNOWN`; the plan maps the same case to `FAILED`. If both paths run on the same job (e.g., Electron restarts again during recovery), the statuses may conflict. Mitigation: align both paths on the same fallback, or document the intentional divergence as an architecture decision.
