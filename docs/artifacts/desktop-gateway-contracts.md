# Desktop Gateway Contracts

This artifact tracks the Desktop -> Relay contract checkpoints from the desktop runbook.

## DG-001: Health Probe Contract

- Status: `finalized in D1`
- Endpoint: `GET /health`
- Response: HTTP `200` JSON with shape:
  - `{ status: "ok", machineName: string, capabilities: { tools, versions }, version: string, port: number }`
- CORS: response includes:
  - `Access-Control-Allow-Origin: <webAppOrigin>`
  - `Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type,Authorization`
- Notes:
  - Active port is the bound server port after fallback selection.
  - Contract implementation source: `apps/desktop/src/server/router.ts`.

## DG-002: Port Selection + Discovery

- Status: `finalized in D1`
- Probe order: `19432 -> 19433 -> 19434 -> 19435`
- Selection behavior:
  - On `EADDRINUSE`, server retries the next candidate port.
  - First successful bind becomes the active port.
  - If all ports fail, startup throws a bind failure error.
- Discovery file: `~/.closedloop-ai/electron-port` containing the active port as plain text.
- Notes:
  - Contract implementation source: `apps/desktop/src/server/server.ts`.
  - Coverage test: `apps/desktop/test/gateway-server.test.ts` (`falls back to the next configured port...`).

## DG-003: Registration + Heartbeat

- Status: `finalized in D4 (live-validated 2026-02-27)`
- Register target: `POST {API origin}/compute-targets/register`
- Heartbeat target: `POST {API origin}/compute-targets/:id/heartbeat` every 30s
- Behavior implemented:
  - Uses `Authorization: Bearer <apiKey>` from `ApiKeyStore` (`safeStorage` encrypted value, `CLOSEDLOOP_API_KEY`, or `SYMPHONY_API_KEY` env fallback).
  - Registration payload includes `{ machineName, platform, capabilities, pluginVersion, supportedOperations }`.
  - Heartbeat retry backoff: `1s, 2s, 4s, 8s, 16s, 30s cap` with jitter.
  - After two consecutive heartbeat failures, tray transitions to degraded state while localhost serving continues.
- Live validation evidence:
  - API origin exercised: `http://localhost:3002` (`apps/api` runtime).
  - Auth source exercised: `CLOSEDLOOP_API_KEY` (`sk_live_*` key from local env).
  - Registration probe returned `HTTP 200` with success envelope and target id:
    - `{ success: true, data: { id, machineName: "ClosedLoop Desktop Validation", isOnline: true } }`
  - Heartbeat probe returned `HTTP 200` against the registered target id:
    - `{ success: true, data: { ok: true } }`
- Notes:
  - Validation was performed after applying the existing `compute_targets` migration in the local `apps/api` database.
  - Localhost serving remains non-blocking when registration fails, per AC-010.
  - Settings UI supports manual API key entry/clear and secure persistence via Electron `safeStorage`.

## DG-004: Operation Parity Matrix

- Status: `finalized in D2 (revalidated in D5)`
- Target: one row per operation route with method/request/response parity
- Final matrix snapshot:

| Operation | Route | Methods | Status | Notes |
| --- | --- | --- | --- | --- |
| `symphony_launch` | `/api/engineer/symphony/launch` | `POST` | `implemented` | Creates/uses ticket worktree, writes PRD context, and starts loop process when script is available; AC-049 on repo/context paths before worktree/process operations. |
| `symphony_status` | `/api/engineer/symphony/status/:ticketId` | `GET` | `implemented` | Ticket status envelope with state/process/plan/task metadata and liveness handling. |
| `symphony_kill` | `/api/engineer/symphony/kill` | `POST` | `implemented` | PID/group stop semantics with state update + loop marker cleanup; AC-049 on repo path input. |
| `symphony_chat` | `/api/engineer/symphony/chat/:ticketId` | `POST` | `implemented` | Claude NDJSON stream (`text/event-stream` + newline-delimited JSON) with persisted session/history. |
| `symphony_comment_chat` | `/api/engineer/symphony/comment-chat/:commentId` | `GET, POST, PATCH, DELETE` | `implemented` | Comment-thread scoped history + Claude streaming + responded-flag update + delete. |
| `symphony_commit_message` | `/api/engineer/symphony/commit-message/:ticketId` | `GET` | `implemented` | Diff-based commit message generation with Claude fallback/default envelope parity. |
| `symphony_sessions` | `/api/engineer/symphony/sessions` | `GET, POST, DELETE` | `implemented` | Session CRUD persisted under `~/.symphony/sessions.json`; AC-049 on repo/worktree/context paths. |
| `terminal_chat` | `/api/engineer/terminal-chat` | `GET, POST, DELETE` | `implemented` | Claude/Codex NDJSON terminal chat stream + durable history/session handling. |
| `ticket_chat` | `/api/engineer/ticket-chat` | `GET, POST, DELETE` | `implemented` | Ticket-scoped chat history + NDJSON stream with repo allowlist enforcement before spawn. |
| `run_viewer_chat` | `/api/engineer/run-viewer-chat` | `GET, POST, DELETE` | `implemented` | Run artifact chat history + NDJSON stream; AC-049 on `runDir` prior to command execution. |
| `codex_review` | `/api/engineer/codex/review/:ticketId` | `POST` | `implemented` | Claude/Codex review process streaming with persisted state/log/pid/session artifacts. |
| `codex_review_status` | `/api/engineer/codex/status/:ticketId` | `GET, DELETE` | `implemented` | Review status/log read + cleanup contract (provider-aware). |
| `codex_review_stop` | `/api/engineer/codex/stop/:ticketId` | `POST, DELETE` | `implemented` | Explicit stop + delete semantics for active/inactive reviews. |
| `codex_review_findings` | `/api/engineer/codex/review-findings/:ticketId` | `GET, POST` | `implemented` | Persist/load findings + mark-commented mutation envelope. |
| `codex_review_extract` | `/api/engineer/codex/review-extract/:ticketId` | `POST` | `implemented` | Structured findings extraction envelope from review output. |
| `codex_review_dedup` | `/api/engineer/codex/review-dedup/:ticketId` | `POST` | `implemented` | Duplicate pairing contract (`duplicates: [indexA,indexB][]`). |
| `codex_argue` | `/api/engineer/codex/argue/:ticketId` | `POST` | `implemented` | Codex debate NDJSON streaming with persisted debate session state. |
| `codex_chat` | `/api/engineer/codex/chat/:ticketId` | `POST` | `implemented` | Ticket-scoped Codex chat stream with session resume support. |
| `codex_finding_chat` | `/api/engineer/codex/finding-chat/:findingId` | `GET, POST, PATCH, DELETE` | `implemented` | Finding-scoped history + Claude stream + responded-flag mutation + delete. |
| `git_action` | `/api/engineer/git` | `POST` | `implemented` | Multi-action git envelope (`status/branch/commit/push/pull/branch-diff/sync-status`). |
| `git_pr` | `/api/engineer/git/pr*`, `/api/engineer/git/user` | `GET, POST` | `implemented` | PR create/list/comments/reviews/reply/files/head-sha/inline-comment/user parity routes. |
| `health_check` | `/api/engineer/health-check` | `GET` | `implemented` | Tool/auth/script readiness check bundle with remediation metadata. |
| `repos_config` | `/api/engineer/repos` | `GET, POST, DELETE, PATCH` | `implemented` | Repo config CRUD/settings persistence in `~/.claude/closedloop/repos.json`. |
| `deploy` | `/api/engineer/deploy*` | `GET, POST` | `implemented` | Deploy detect/start/status/health/kill/teardown/check-existing/extract-info route family. |
| `learnings` | `/api/engineer/learnings`, `/api/engineer/symphony/*learnings*` | `GET, POST` | `implemented` | Learnings read/extract/process/status/usage-record endpoints with filesystem contracts. |
| `filesystem` | `/api/engineer/directories`, `/api/engineer/files/search`, `/api/engineer/run-viewer-extract` | `GET, POST, DELETE` | `implemented` | Directory/search + run-viewer zip extract/list/cleanup contracts. |
| `supporting parity routes` | `/api/engineer/version`, `/api/engineer/work-directory/:ticketId`, `/api/engineer/mcp-auth`, `/api/engineer/symphony/status` | `GET` | `implemented` | Auxiliary engineer endpoints implemented natively for desktop route parity completeness. |

- Notes:
  - All mapped `apps/app/app/api/engineer/*` routes are implemented natively in desktop.
  - Fallback proxy remains optional but is no longer required for parity coverage.
  - Wildcard attachment route parity is maintained with equivalent semantics (`*attachmentPath` vs `*path` naming only).
  - Approval workflow is integrated in desktop UI with approve-by-default tiering (`defaultApprovalTier=high`) and per-operation `Always Allow` overrides.
