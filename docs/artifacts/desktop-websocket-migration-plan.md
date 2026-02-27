# Desktop WebSocket Migration Plan

## Scope

Migrate cloud connectivity between hosted API and local Desktop Gateway from periodic HTTP registration/heartbeat to an outbound persistent Socket.IO connection, while preserving:

- Existing localhost engineer route contracts and NDJSON streaming behavior.
- AC-049 allowed-directory checks before filesystem/process operations.
- Separate API origin and web app origin settings (AC-052).

This plan does not replace local `http://127.0.0.1:<port>/api/engineer/*` usage. It adds a reliable cloud->desktop command channel over the outbound socket.

## Current State

- Cloud liveness is HTTP polling:
  - `POST /compute-targets/register`
  - `POST /compute-targets/:id/heartbeat` every 30s
- Desktop route streaming is newline-delimited JSON over `text/event-stream`.
- No server-initiated command channel exists through NAT/firewall unless desktop initiated the request.

## Target State

- Desktop opens one outbound Socket.IO connection to API origin namespace (for example `/desktop-gateway`).
- API authenticates desktop at connect time and binds socket to `computeTargetId`.
- API can push commands over the socket; desktop executes only allowed operations.
- Desktop streams command progress/results back as ordered events.
- API acks, persists, and can replay unacked commands after reconnect.

## Transport Decision

- Use Socket.IO v4 as the required cloud command transport.
- Configure `transports: ["websocket"]` for production behavior.
- Keep a versioned protocol envelope above Socket.IO (`protocolVersion`).

## Protocol Contract (v1)

All messages include:

- `protocolVersion: "1"`
- `messageId: string` (unique per message)
- `timestamp: string` (ISO-8601)

### 1) Desktop -> API: `desktop.hello`

Payload:

- `computeTargetId?: string` (if known from prior session)
- `machineName: string`
- `platform: string`
- `pluginVersion: string`
- `supportedOperations: string[]`
- `maxInFlightCommands: number`
- `allowedDirectoriesHash: string` (hash only, not raw list unless explicitly needed)

### 2) API -> Desktop: `desktop.hello.ack`

Payload:

- `computeTargetId: string`
- `sessionId: string`
- `serverTime: string`
- `resumeFromSequence?: Record<string, number>`

### 3) API -> Desktop: `desktop.command`

Payload:

- `commandId: string`
- `operationId: string`
- `method: string`
- `path: string`
- `headers?: Record<string, string>`
- `query?: Record<string, string | string[]>`
- `body?: unknown`
- `timeoutMs?: number`
- `queuedAt?: string`
- `lockKey?: string`
- `requiresApproval?: boolean`
- `approvalReason?: string`

### 4) Desktop -> API: `desktop.command.ack`

Payload:

- `commandId: string`
- `accepted: boolean`
- `state?: "accepted" | "failed"`
- `reason?: string`

### 5) Desktop -> API: `desktop.command.event`

Payload:

- `commandId: string`
- `sequence: number` (monotonic per command)
- `eventType: "status" | "chunk" | "result" | "error" | "done"`
- `data: unknown`
- terminal semantics:
  - `done` is terminal (`cancelled` when `data.cancelled === true`, otherwise success)
  - `error` is terminal failure when `data.terminal === true`
  - `result` is non-terminal unless `data.terminal === true`

### 6) API -> Desktop: `desktop.command.event.ack`

Payload:

- `commandId: string`
- `sequence: number`

### 7) API -> Desktop: `desktop.cancel`

Payload:

- `commandId: string`
- `reason?: string`

### 8) Desktop -> API: `desktop.presence`

Payload:

- `state: "online" | "degraded" | "paused"`
- `error?: string`

## Reliability Rules

- Command execution is at-least-once delivery; operations must be idempotent where possible.
- API persists command state and latest acked `sequence`.
- Desktop keeps in-memory recent outbound event buffer per command for replay window.
- On reconnect:
  - Desktop sends last seen `sessionId` and `computeTargetId`.
  - API replays commands that are not in terminal states (`done`, `failed`, `cancelled`, `expired`).

## Browser Stream Compatibility

- Browser-facing relay responses remain newline-delimited NDJSON.
- Mapping from socket command events to browser stream must not add a nested `payload` wrapper.
- Preserve existing top-level event keys (for example `type`, `content`, `error`, `name`, `id`) to avoid parser regressions.

## Concurrency Model

- One Socket.IO connection supports multiple commands (multiplexed by `commandId`).
- Event ordering guarantee is per command, not global across commands.
- Desktop execution is bounded:
  - `maxInFlightCommands` default `2`.
  - Additional commands remain queued server-side until desktop has capacity.
- Apply operation lock keys to prevent conflicting concurrent work:
  - lock key: `${operationId}:${repoPath}` when repo path is present.
  - commands sharing a lock key execute serially.
- Cancellation and timeout are per command and do not block unrelated commands.

## Security Rules

- Authenticate socket with the same API key source chain used today.
- Bind authenticated identity to one compute target.
- Reject commands whose route/path is not in the allowlisted operation matrix.
- Re-run AC-049 path checks in operation handlers before any filesystem/process side effect.
- Never trust client-provided `allowedDirectories`; only use desktop local settings for enforcement.

## Desktop Implementation Plan

### Phase WS-D1: Introduce Cloud Socket Service

- Add `apps/desktop/src/main/cloud-socket.ts`:
  - Manages Socket.IO lifecycle, reconnect, and status callbacks.
  - Emits `desktop.hello` on connect.
  - Receives `desktop.command` and dispatches to executor.
- Replace `cloud-registration.ts` as primary cloud transport in the same change.

### Phase WS-D2: Command Executor Bridge

- Add `apps/desktop/src/main/cloud-command-executor.ts`:
  - Converts `desktop.command` envelope to internal gateway dispatch call.
  - Uses existing router/operation stack so all existing validation and AC-049 remain in effect.
  - Converts stream and JSON responses into `desktop.command.event` sequence.

### Phase WS-D3: Approval Integration

- For commands requiring approval tier:
  - Gate via existing `ApprovalStore` flow.
  - Emit status event while pending approval.
  - Support `desktop.cancel` while waiting.

### Phase WS-D4: Durable Replay + Metrics

- Track per-command:
  - state (`accepted`, `running`, `done`, `failed`, `cancelled`)
  - last acked sequence
  - timestamps and error metadata
- Persist lightweight replay cursor/state in `electron-store`.
- Add counters in activity log for:
  - reconnect attempts
  - dropped/replayed events
  - command latency
  - queue wait time due to in-flight limits/lock contention

### Phase WS-D5: Cutover

- Remove HTTP register/heartbeat code paths once socket-driven liveness is wired end-to-end.

## API Compatibility and Local Route Guarantees

- Local desktop HTTP API remains unchanged for web UI and local tools.
- NDJSON stream framing from local `/api/engineer/*` stays unchanged.
- WebSocket channel is additive for hosted command dispatch only.

## Rollout Strategy

- Stage 1: Implement socket command + liveness path end-to-end.
- Stage 2: Validate parity in local and hosted integration.
- Stage 3: Remove legacy register/heartbeat logic after liveness parity confirmation.

## Test Plan

### Unit

- Socket connect/auth/reconnect behavior.
- Command ack/sequence ordering.
- Replay after forced disconnect.
- Cancel handling during long-running command.

### Integration

- Hosted API in docker + desktop app local:
  - Command dispatch over socket triggers local operation execution.
  - Streamed events arrive in order and terminate with `done`.
  - Approval-required command blocks until user action.

### Failure Injection

- Kill API server mid-command and verify resume/replay.
- Rotate API key and verify reconnect with new credentials.
- Induce proxy idle timeout and verify automatic reconnect.

## Completion Gates

- `WS-G1`: desktop socket connects and authenticates to API.
- `WS-G2`: command dispatch/ack/stream/done flow works end-to-end.
- `WS-G3`: replay after disconnect validated.
- `WS-G4`: approvals and AC-049 checks confirmed on socket-originated commands.
- `WS-G5`: dual-run burn-in with acceptable failure rate and latency.
- `WS-G6`: stable reconnect/replay and command latency within target SLO.

## Risks

- Duplicate execution on reconnect if idempotency is incomplete.
- Proxy/load-balancer idle timeout defaults causing churn.
- Event backlog growth for very long commands.

## Mitigations

- Enforce command idempotency key by `commandId`.
- Use ping interval/timeout aligned with infrastructure.
- Apply bounded replay buffers and terminal compaction.
