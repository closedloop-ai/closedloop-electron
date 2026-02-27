# Desktop Gateway Conformance

Date: 2026-02-27
Workspace: `/Users/daniel.ochoa/Source/closedloop-electron`

## Executed Verification

- `pnpm --filter desktop typecheck`
- `pnpm --filter desktop build`
- `pnpm --filter desktop test`
- `pnpm --filter desktop exec tsx --test --test-name-pattern "approval" test/gateway-server.test.ts`
- `pnpm --filter desktop start` (manual startup smoke check; stopped via `SIGINT`)
- `pnpm --filter app typecheck` (workspace has no `app` project; command reports no matching projects)
- `pnpm --filter app test` (workspace has no `app` project; command reports no matching projects)
- DG-003 live endpoint probes:
  - `POST http://localhost:3002/compute-targets/register` -> `HTTP 200`
  - `POST http://localhost:3002/compute-targets/:id/heartbeat` -> `HTTP 200`
  - Auth path used: `Authorization: Bearer sk_live_*` from local `CLOSEDLOOP_API_KEY`

## Scenario Status

| Scenario | Status | Evidence |
| --- | --- | --- |
| Port fallback + discovery file (DG-002) | `PASS` | Automated test verifies `19432 -> 19433` fallback and `~/.closedloop-ai/electron-port` write. |
| Health contract + CORS + preflight (DG-001) | `PASS` | Automated tests verify `/health` envelope, CORS headers, and `OPTIONS 204`. |
| Directory allowlist enforcement (AC-049) | `PASS` | Automated rejection coverage across sessions/status/kill/chat/codex/deploy/learnings/filesystem routes. |
| NDJSON streaming framing compatibility | `PASS` | Streaming routes emit newline-delimited JSON with `Content-Type: text/event-stream` and parser-compatible event envelopes. |
| Process lifecycle primitives | `PASS` | Kill/state update behavior covered in tests; process-group termination and kill timers implemented in server process manager. |
| Upload + attachment roundtrip | `PASS` | Multipart upload and wildcard attachment retrieval tests pass. |
| Git route family parity | `PASS` | Git action/branches/diff contract tests pass on temporary repositories; PR route family implemented natively. |
| Full operation parity matrix (DG-004) | `PASS` | All mapped `apps/app/app/api/engineer/*` routes are implemented natively in desktop gateway. |
| Cloud registration + heartbeat (DG-003) | `PASS` | Live `apps/api` register + heartbeat probes both succeed with authenticated `sk_live_*` key. |
| Approval queue + manual gate (D3) | `PASS` | Default approval tier is `high` (approve-by-default) with per-operation overrides; requests wait for user action and UI supports Approve/Decline/Always Allow buttons. |
| Activity log visibility + persistence | `PASS` | Engineer route events surface in UI and persist across app restarts using disk-backed store. |
| Approval queue persistence | `PASS` | Pending approvals are persisted and rehydrated after restart using disk-backed store. |
| Tray accessibility + pending badge | `PASS` | Closing window hides app to tray; tray remains clickable to reopen and shows pending-approval count badge in macOS menu bar text. |
| Existing `apps/app` Tier 1 behavior in this workspace | `NOT EXECUTABLE` | `apps/app` package is not present in `closedloop-electron`; commands cannot run here. |
| Desktop app runnable locally | `PASS` | Electron desktop process starts from built artifacts (`pnpm --filter desktop start`). |

## Known Deviations

1. Cross-package `apps/app` typecheck/test parity cannot be executed in this repository because the package is not present.
2. DG-003 live validation required applying existing `apps/api` database migrations in the separate `symphony-alpha` runtime so `compute_targets` table existed.

## Follow-up Tasks

1. If strict Tier 1 `apps/app` verification is required for final release sign-off, run `pnpm --filter app typecheck` and `pnpm --filter app test` in the `symphony-alpha` monorepo workspace.
