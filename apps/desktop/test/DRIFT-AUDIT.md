# Test Drift Audit — `apps/desktop/test/`

Authoritative drift audit per **PRD-220** (Fix Stale Mocks in closedloop-electron) /
**FEA-688** (Complete Test Drift Audit and Annotation Hygiene) / **PLN-392**.

This file is the in-tree mirror of the audit table that was finalized in PR #134
on `symphony/prd-220`. Downstream features (FEA-618 remediation, FEA-619 CLAUDE.md
convention, FEA-621 drift-check script) read from this file rather than from PR
description archives.

> **Maintenance contract:** when adding a new test file under `apps/desktop/test/`,
> add a row below. When reclassifying a test's drift class, also update the file's
> header `DRIFT ANNOTATION` comment. The eventual FEA-621 drift-check script is the
> long-term automated guarantor for the inline `// drift-check:` annotations; this
> file is the long-term home for the audit-table view.

## Annotation Vocabulary (two-form, adopted in PR #134)

| Annotation verb | Used when | Example |
|---|---|---|
| `matches` | Class (i) — the test anchors a production line number and verifies the anchor is still valid (line-number drift check only); no logic copied | `// drift-check: matches codex.ts:1767` |
| `replicates` | Class (ii) — the test copies logic or a behavioral pattern from production (structural/logic replication) | `// drift-check: replicates symphony-interactive.ts:672-688` |

**Rationale:** Class (i) tests are *observers* — they cite a line so a reviewer can
locate the production anchor; they do not reproduce any logic. The verb "matches"
conveys that the annotation is a line-pointer that should stay in sync. Class (ii)
tests are *replicators* — they contain test-side implementations that shadow
production behavior and will silently diverge if production changes without a
corresponding test update. The verb "replicates" makes the replication relationship
explicit and flags higher maintenance risk. A `grep` for `replicates` immediately
surfaces the high-risk set without scanning all `drift-check` annotations.

`replicates` is applied to every site that copies production logic, regardless of
whether the copy is currently aligned with production — so FEA-621's drift-check
script can monitor the entire pattern-replication surface rather than only the
drifted subset.

## Drift Classes

- **Class (i)** — `buildMockChildProcess()` usages where the SUT's error/exit
  handling has changed versus the mock's assumptions; OR an annotation that
  pin-points a production line number for navigational/anchor purposes.
- **Class (ii)** — pattern-replication tests whose replicated Promise/error
  wrappers (or other production logic) are copied into the test body. May be
  drifted from production or aligned with it; either way, carries a `replicates`
  annotation for ongoing monitoring.
- **Class (iii)** — fake-binary-on-PATH tests whose PATH setup must invoke
  `setShellPathForTest()` after `process.env.PATH` overrides for the child
  process to consistently resolve binaries from the test fixture directory.
- **No drift patterns** — file does not use spawn / mock / error-handler
  patterns (per PLN-353 Q-001 resolution).

## Audit Table (73 files at PR #134 head)

| file | drift class | production source cited | proposed fix | status |
| --- | --- | --- | --- | --- |
| activity-log-store.test.ts | No drift patterns | apps/desktop/src/main/activity-log-store.ts | none | no drift patterns |
| app.test.ts | No drift patterns | apps/desktop/src/main/observability.ts | none | no drift patterns |
| approval-policy.test.ts | No drift patterns | apps/desktop/src/main/approval-policy.ts | none | no drift patterns |
| binary-paths.test.ts | No drift patterns | apps/desktop/src/server/server.ts | none | no drift patterns |
| boot-recovery.test.ts | Class (i) | apps/desktop/src/main/boot-recovery.ts:308 | none — drift-check anchor corrected from :303 to :308 in PR #134 | header annotated in this PR (#134) |
| bootstrap-claim.test.ts | No drift patterns | apps/desktop/src/main/gateway-signing-key-store.ts | none | no drift patterns |
| build-allowed-directories.test.ts | No drift patterns | apps/desktop/src/shared/sandbox-policy.ts | none | no drift patterns |
| chat-backend-client.test.ts | No drift patterns | apps/desktop/src/server/operations/chat-providers.ts | none | no drift patterns |
| chat-session.test.ts | No drift patterns | apps/desktop/src/server/operations/chat-session.ts | none | no drift patterns |
| cloud-command-executor.test.ts | No drift patterns | apps/desktop/src/main/cloud-command-executor.ts | none | no drift patterns |
| cloud-socket-presence.test.ts | No drift patterns | apps/desktop/src/main/cloud-socket.ts | none | no drift patterns |
| codex-log-parsing.test.ts | Class (i) | apps/desktop/src/server/operations/codex.ts:1767 | none — drift-check annotation matches current production line | header annotated in PR #134 |
| codex-spawn-enoent.test.ts | Class (i) | apps/desktop/src/server/operations/codex.ts:1985,1992,2030 | Stale prose in header block at lines 17-23 swept in PR #134 to remove contradictory line citations | header annotated in PR #134 |
| desktop-pop.test.ts | No drift patterns | apps/desktop/src/main/desktop-pop.ts | none | no drift patterns |
| error-handlers.test.ts | Class (i) | apps/desktop/src/main/error-handlers.ts:29,54 | none — drift-check annotations match current production lines | header annotated in PR #134 |
| gateway-auth.test.ts | No drift patterns | apps/desktop/src/server/server.ts | none | no drift patterns |
| gateway-identity.test.ts | No drift patterns | apps/desktop/src/main/gateway-identity.ts | none | no drift patterns |
| gateway-liveness.test.ts | No drift patterns | apps/desktop/src/server/server.ts | none | no drift patterns |
| gateway-recovery.test.ts | No drift patterns | apps/desktop/src/main/gateway-recovery.ts | none | no drift patterns |
| gateway-server.test.ts | No drift patterns | apps/desktop/src/server/server.ts | none | no drift patterns |
| gateway-signing-key-store.test.ts | No drift patterns | apps/desktop/src/main/gateway-signing-key-store.ts | none | no drift patterns |
| git-branch-worktree.test.ts | No drift patterns | apps/desktop/src/server/operations/git-branch-worktree.ts | none | no drift patterns |
| git-helpers-shell-safety.test.ts | Class (i) | apps/desktop/src/server/operations/git-helpers.ts:10 | none — drift-check annotation matches current production line | header annotated in PR #134 |
| health-check-mcp.test.ts | No drift patterns | apps/desktop/src/server/operations/health-check.ts | none | no drift patterns |
| ipc-job-reconciliation-race.test.ts | No drift patterns | apps/desktop/src/main/job-store.ts | none | no drift patterns |
| job-store.test.ts | No drift patterns | apps/desktop/src/main/job-store.ts | none | no drift patterns |
| learnings-routes.test.ts | No drift patterns | apps/desktop/src/server/operations/learnings.ts | none | no drift patterns |
| local-auth-verifier.test.ts | No drift patterns | apps/desktop/src/main/local-auth-verifier.ts | none | no drift patterns |
| local-session-store.test.ts | No drift patterns | apps/desktop/src/main/local-session-store.ts | none | no drift patterns |
| loop-finalizer.test.ts | No drift patterns | apps/desktop/src/main/loop-finalizer.ts | none — `setShellPathForTest()` restoration applied in PR #132 | no drift patterns |
| loop-token-store.test.ts | No drift patterns | apps/desktop/src/main/loop-token-store.ts | none | no drift patterns |
| mcp-detection.test.ts | No drift patterns | apps/desktop/src/server/operations/mcp-detection.ts | none | no drift patterns |
| observability.test.ts | No drift patterns | apps/desktop/src/main/observability.ts | none | no drift patterns |
| onboarding-binary-paths.test.ts | No drift patterns | apps/desktop/src/main/settings-store.ts | none | no drift patterns |
| origin-policy.test.ts | No drift patterns | apps/desktop/src/main/origin-policy.ts | none | no drift patterns |
| output-tailer-tokens.test.ts | No drift patterns | apps/desktop/src/server/operations/output-tailer.ts | none | no drift patterns |
| plan-artifact-utils.test.ts | No drift patterns | apps/desktop/src/shared/plan-artifact-utils.ts | none | no drift patterns |
| plugin-cache.test.ts | No drift patterns | apps/desktop/src/server/operations/plugin-cache.ts | none | no drift patterns |
| queue-stats-debounce.test.ts | No drift patterns | apps/desktop/src/main/queue-stats-debounce.ts | none | no drift patterns |
| resolve-binary.test.ts | No drift patterns | apps/desktop/src/server/shell-path.ts | none | no drift patterns |
| saved-configs.test.ts | No drift patterns | apps/desktop/src/main/api-key-store.ts | none | no drift patterns |
| security-paths.test.ts | No drift patterns | apps/desktop/src/server/security.ts | none | no drift patterns |
| security-sandbox.test.ts | No drift patterns | apps/desktop/src/server/security.ts | none | no drift patterns |
| seed-repos-config.test.ts | No drift patterns | apps/desktop/src/main/seed-repos-config.ts | none | no drift patterns |
| session-limit-detection.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-loop.ts | none | no drift patterns |
| settings-migration.test.ts | No drift patterns | apps/desktop/src/main/settings-store.ts | none | no drift patterns |
| shell-path.test.ts | No drift patterns | apps/desktop/src/server/shell-path.ts | none | no drift patterns |
| shutdown.test.ts | No drift patterns | apps/desktop/src/main/shutdown.ts | none | no drift patterns |
| single-root-contract.test.ts | No drift patterns | apps/desktop/src/server/server.ts | none | no drift patterns |
| spawn-enoent-characterization.test.ts | Class (ii) | apps/desktop/src/server/operations/symphony-interactive.ts:489,1047 | Stale prose at lines 8-10 swept in PR #134; `// drift-check:` annotations converted from `matches` to `replicates` to reflect Class (ii) pattern replication. Remediation deferred to FEA-618. | header annotated in PR #134 |
| spawn-hardening.test.ts | Class (i) and Class (ii) | apps/desktop/src/server/operations/symphony-interactive.ts:489,672-688,1047; codex.ts:1985; learnings.ts:264 | Tests (a) and (a-unref) replicate detached-spawn error handler missing fdClosed guard, try/catch around closeSync, secondary gatewayLog.warn, and fdClosed=true assignment — Class (ii) drift, remediation deferred to FEA-618. Tests (b), (c), (d) are intentional-and-current pattern-replication (no drift); their `// drift-check:` annotations were converted from `matches` to `replicates` in PR #134 for vocabulary consistency. | header annotated in PR #132; updated in PR #134 |
| spawn-retry.test.ts | Class (i) | apps/desktop/src/main/spawn-retry.ts:26 | none — drift-check annotation matches current production line | header annotated in PR #134 |
| symphony-bootstrap.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-utils.ts | none | no drift patterns |
| symphony-job-snapshot.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-job-snapshot.ts | none | no drift patterns |
| symphony-loop-auto-clone.test.ts | No drift patterns | apps/desktop/src/server/server.ts | none — `setShellPathForTest()` restoration applied in PR #132 | no drift patterns |
| symphony-loop-cloud-failures.test.ts | No drift patterns | apps/desktop/src/main/job-store.ts | none | no drift patterns |
| symphony-loop-decompose.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-loop.ts | none | no drift patterns |
| symphony-loop-evaluate-code.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-loop.ts | none | no drift patterns |
| symphony-loop-evaluate-plan.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-loop.ts | none | no drift patterns |
| symphony-loop-evaluate-prd.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-loop.ts | none | no drift patterns |
| symphony-loop-execute.test.ts | No drift patterns | apps/desktop/src/main/job-store.ts | none | no drift patterns |
| symphony-loop-generate-prd.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-loop.ts | none | no drift patterns |
| symphony-loop-handle-process-completion.test.ts | No drift patterns | apps/desktop/src/main/job-store.ts | none | no drift patterns |
| symphony-loop-multi-repo-contract.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-loop.ts | none | no drift patterns |
| symphony-loop-multi-repo-spawn.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-loop.ts | none | no drift patterns |
| symphony-loop-multi-repo-worktree.test.ts | No drift patterns | apps/desktop/src/main/job-store.ts | none | no drift patterns |
| symphony-loop-output-events.test.ts | No drift patterns | apps/desktop/src/server/operations/output-tailer.ts | none | no drift patterns |
| symphony-loop-shared-contract.test.ts | No drift patterns | apps/desktop/src/server/server.ts | none | no drift patterns |
| symphony-loop-ssrf.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-loop.ts | none | no drift patterns |
| symphony-utils.test.ts | No drift patterns | apps/desktop/src/server/operations/symphony-utils.ts | none | no drift patterns |
| telemetry-loop-integration.test.ts | No drift patterns | apps/desktop/src/server/server.ts | none — integration test exercising telemetry emission via full gateway stack; no production pattern replication or spawn/EventEmitter construction detected. FEA-616 (PLN-352) classified this file as Class C (not stale) on `symphony/prd-220` independently. | no drift patterns |
| telemetry-service.test.ts | No drift patterns | apps/desktop/src/main/telemetry-service.ts | none | no drift patterns |
| token-usage.test.ts | No drift patterns | apps/desktop/src/main/token-usage.ts | none | no drift patterns |

## Cross-references

- **PRD-220** — parent product requirements doc.
- **PR #132** — original FEA-617 / PLN-353 implementation; introduced inline
  `// drift-check:` annotations on 8 files and deduplicated `buildMockChildProcess`
  + `makeEnoentError` helpers + restored `setShellPathForTest()` calls in
  `loop-finalizer.test.ts` and `symphony-loop-auto-clone.test.ts`.
- **PR #134** — FEA-688 / PLN-392; closed audit gaps left by PR #132 (this file,
  vocabulary decision, prose sweep, `boot-recovery` anchor fix, `makeEnoentError`
  JSDoc).
- **FEA-618** — drift remediation; uses this file to scope remediation work.
- **FEA-619** — `CLAUDE.md` mock-hygiene convention; cites this file as the
  authoritative source for the two-form vocabulary.
- **FEA-621** — CI mock drift-check script; walks the tree validating inline
  `// drift-check:` annotations against production source line numbers.
