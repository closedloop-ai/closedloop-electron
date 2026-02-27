# API Server Socket.IO Handoff For Desktop Gateway

## Hard Constraints

- Breaking old Engineer relay transport APIs is allowed.
- Breaking compute target visibility/liveness semantics in hosted Engineer UI is not allowed.
- Existing browser Engineer stream parser must keep receiving newline-delimited NDJSON.

Desktop-side plan reference:

- `docs/artifacts/desktop-websocket-migration-plan.md`

## Transport

- Socket.IO v4.
- Namespace: `/desktop-gateway`.
- Production transport mode: WebSocket only.

## Infra Assumptions

Choose one deployment model explicitly before rollout:

1. Single API instance:
- No adapter required.
- One in-memory socket registry is acceptable.

2. Multi-instance API:
- Require shared Socket.IO adapter/pubsub (Redis or equivalent).
- Require sticky sessions at load balancer for upgrade stability.
- Command queue/source-of-truth must be shared datastore, not process memory.

## Protocol v1 Envelope

Every event payload includes:

- `protocolVersion`: `"1"` (required)
- `messageId`: `string` UUID-like (required)
- `timestamp`: `string` ISO-8601 (required)

## Exact Event Contracts

### Desktop -> API: `desktop.hello`

Required fields:

- `machineName: string`
- `platform: string`
- `pluginVersion: string`
- `supportedOperations: string[]`
- `maxInFlightCommands: number` (integer, >=1)

Optional fields:

- `computeTargetId?: string`
- `allowedDirectoriesHash?: string`
- `capabilities?: Record<string, unknown>`

### API -> Desktop: `desktop.hello.ack`

Required fields:

- `computeTargetId: string`
- `sessionId: string`
- `serverTime: string` (ISO-8601)

Optional fields:

- `resumeFromSequence?: Record<string, number>`

Semantics:

- `resumeFromSequence[commandId] = n` means API has persisted all events through sequence `n` for that command and expects replay from `n + 1`.

### API -> Desktop: `desktop.command`

Required fields:

- `commandId: string`
- `operationId: string`
- `method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"`
- `path: string` (must start with `/api/engineer/`)

Optional fields:

- `headers?: Record<string, string>`
- `query?: Record<string, string | string[]>`
- `body?: unknown`
- `timeoutMs?: number`
- `queuedAt?: string` (ISO-8601)
- `lockKey?: string`
- `requiresApproval?: boolean`
- `approvalReason?: string`

Semantics:

- `requiresApproval=true` means desktop must force manual approval before execution.
- If omitted or false, desktop still applies its local approval policy.

### Desktop -> API: `desktop.command.ack`

Required fields:

- `commandId: string`
- `accepted: boolean`

Optional fields:

- `state?: "accepted" | "failed"`
- `reason?: string`

Semantics:

- `accepted=false` is terminal and must transition command to `failed`.

### Desktop -> API: `desktop.command.event`

Required fields:

- `commandId: string`
- `sequence: number` (integer, starts at `1`, monotonic +1)
- `eventType: "status" | "chunk" | "result" | "error" | "done"`
- `data: unknown`

Terminal semantics:

- `eventType="done"` is terminal and classified as:
  - `cancelled` when `data.cancelled === true`
  - `done` otherwise
- `eventType="error"` is terminal failure only if `data.terminal === true`.
- `eventType="result"` is non-terminal unless `data.terminal === true`.

### API -> Desktop: `desktop.command.event.ack`

Required fields:

- `commandId: string`
- `sequence: number`

Semantics:

- API acknowledges highest contiguous persisted sequence for that command.

### API -> Desktop: `desktop.cancel`

Required fields:

- `commandId: string`

Optional fields:

- `reason?: string`

Semantics:

- Requests cancellation.
- If cancellation is honored, desktop must emit terminal `done` with `data.cancelled === true`.
- Terminal `error` is reserved for failed outcomes and maps to `failed`.

### Desktop -> API: `desktop.presence`

Required fields:

- `state: "online" | "degraded" | "paused"`

Optional fields:

- `error?: string`
- `activeCommands?: number`
- `queueDepth?: number`

## CommandId Ownership + Idempotency

- `commandId` is server-generated only.
- Browser/API callers do not set `commandId`; they may provide optional `idempotencyKey` on command-create endpoint.
- Duplicate command-create with same `idempotencyKey` for same target+payload returns existing `commandId`.
- Duplicate command-create with same `idempotencyKey` but different payload must return `409 Conflict`.
- Duplicate delivery of same `commandId` to desktop must not re-execute side effects:
  - If command is non-terminal on desktop, send `desktop.command.ack` with `accepted=true` and continue.
  - If terminal on desktop, replay terminal event sequence from local buffer.

## Replay + Reconnect Rules

Source of truth:

- API datastore (`desktop_commands.last_sequence_acked`) is authoritative.

Rules:

- Desktop sequence per command starts at `1`.
- API accepts only:
  - expected `last_sequence_acked + 1`
  - duplicate `<= last_sequence_acked` (ack again, ignore payload)
- API rejects gaps (`> last_sequence_acked + 1`) and requests replay by re-sending `desktop.hello.ack` with updated `resumeFromSequence`.
- On reconnect API re-dispatches commands in non-terminal states.
- Desktop replays unacked buffered events from `resumeFromSequence + 1`.

## Command Lifecycle State Machine

States:

- `queued -> accepted -> running -> done | failed | cancelled | expired`

Transitions:

- `queued -> accepted`: on `desktop.command.ack accepted=true`
- `queued -> failed`: on `desktop.command.ack accepted=false`
- `queued -> expired`: queued timeout before delivery/accept
- `accepted -> running`: on first `status` event indicating run-start
- `accepted -> cancelled`: on terminal `done` with `cancelled=true`
- `running -> done`: on terminal `done` or terminal `result`
- `running -> failed`: on terminal `error` or command crash/validation fail
- `running -> cancelled`: on terminal `done` with `cancelled=true`
- `running -> expired`: running timeout with no heartbeat/event

Cancel request rule:

- `desktop.cancel` marks command as `cancel_requested` (internal flag only), not terminal state.
- Final state is determined only by terminal command event.

Timers:

- `queuedTimeoutMs` and `runningTimeoutMs` must be configurable per command class.

## Event Mapping To Browser Relay Stream

Deterministic mapping rule:

- For every persisted `desktop.command.event`, emit one newline-delimited JSON object to browser relay response.
- No SSE frame wrappers; raw NDJSON lines only.
- No `payload` wrapper object.

Browser NDJSON mapping:

- Start with `line = data` when `data` is an object; otherwise `line = { value: data }`.
- If `line.type` is absent:
  - set `line.type = "text"` when `eventType === "chunk"` and `line.content` is present.
  - otherwise set `line.type = eventType`.
- Preserve existing top-level keys unchanged (`content`, `error`, `name`, `id`, etc.).
- Include `commandId` only for endpoints that intentionally multiplex multiple commands; do not inject `commandId` into legacy single-command relay streams unless parser compatibility is verified.

Examples:

- `eventType=status, data={"status":"running"}` -> `{"type":"status","status":"running"}`
- `eventType=chunk, data={"content":"hi"}` -> `{"type":"text","content":"hi"}`
- `eventType=error, data={"terminal":true,"error":"boom"}` -> `{"type":"error","terminal":true,"error":"boom"}`
- `eventType=done, data={"cancelled":true}` -> `{"type":"done","cancelled":true}`

Ordering:

- Preserve per-command sequence order.
- Interleaving across commandIds allowed only for multi-command aggregate streams; single-command endpoints must not interleave.

## Scheduling + Concurrency

- Multiple concurrent commands per target are required.
- Respect desktop-advertised `maxInFlightCommands`.
- Enforce lock-key serialization for conflicting scopes:
  - derive lock key from explicit `lockKey` if present, else `operationId + repoPath/worktreePath`.
  - one active command per lock key.
- Use fair queueing across lock keys.

## Security Requirements

- Handshake auth via API key family (`sk_live_*`) with strict validation.
- Never log raw API keys/tokens.
- Allowlist validation for operation/method/path before queueing command.
- Persisted event payloads/logs must redact secrets (`authorization`, API keys, bearer tokens, cookies, ssh keys).
- Apply per-user and per-target rate limits for command creation.

## Compute Target Visibility/Liveness Requirements

- `GET /compute-targets` must keep current hosted UI behavior intact.
- `isOnline` and guard behavior must be driven by socket presence if registration/heartbeat is removed.
- No rollout step may leave all targets permanently offline/missing.
- If removing HTTP register/heartbeat, cutover liveness updates atomically in same release.

Dependent hosted UI/guard paths that must stay aligned:

- `apps/app/app/(authenticated)/settings/components/compute-targets-card.tsx`
- `apps/app/app/(authenticated)/engineer/engineer-guard.tsx`
- `apps/app/proxy.ts`
- `apps/app/hooks/queries/use-compute-targets.ts`
- `apps/app/lib/engineer/relay-client.ts`
- `apps/app/app/api/engineer-relay/[...path]/route.ts`
- `apps/api/app/compute-targets/...`

## API Data Model

Add or extend persistent tables:

- `compute_targets`:
  - `last_socket_connected_at`
  - `last_socket_disconnected_at`
  - `last_socket_session_id`
  - `socket_state` (`online|degraded|paused|offline`)
- `desktop_commands`:
  - `id` (`commandId`, unique)
  - `compute_target_id`
  - `idempotency_key` (nullable text)
  - `request_fingerprint` (hash of canonical command payload)
  - `operation_id`
  - `request_payload` (`jsonb`)
  - `status` (`queued|accepted|running|done|failed|cancelled|expired`)
  - `error`
  - `last_sequence_acked` (`int`, default `0`)
  - `queued_timeout_ms`
  - `running_timeout_ms`
  - `created_at`, `started_at`, `finished_at`
  - unique partial index `(compute_target_id, idempotency_key)` where `idempotency_key is not null`
- `desktop_command_events`:
  - `command_id`
  - `sequence`
  - `event_type`
  - `event_payload`
  - `created_at`
  - unique `(command_id, sequence)`

## Server Endpoints

1. `POST /compute-targets/:id/commands`
- Queue command.
- Request supports `idempotencyKey` optional.
- Response includes `{ commandId, status }`.
- If `idempotencyKey` collides with different payload, return `409`.

2. `GET /compute-targets/:id/commands/:commandId`
- Return lifecycle state + timing/error summary.

3. `GET /compute-targets/:id/commands/:commandId/events`
- Return ordered event log.

4. Engineer relay stream endpoint(s)
- Must output newline NDJSON compatible with existing parser.

## Rollout

- Ship socket command and socket-driven liveness in the same rollout unit.
- Dual-run is optional, not required.
- If dual-run is used, socket presence remains source of truth for UI online/offline state.
- Remove register/heartbeat endpoints only after socket liveness parity is verified.

## Required Test Matrix

1. Handshake success with valid key.
2. Handshake rejection with invalid key.
3. Command dispatch, accept, run, done.
4. Ack reject transitions command to failed.
5. Cancel transitions running command to cancelled.
6. Queued timeout transitions to expired.
7. Running timeout transitions to expired.
8. Sequence duplicate/gap/out-of-order handling.
9. Reconnect and replay from `resumeFromSequence`.
10. Duplicate command submit with same idempotency key.
11. Multiple concurrent commands with lock-key serialization.
12. Browser relay NDJSON parser compatibility regression test.

## Done Criteria

- End-to-end socket execution works with real desktop app.
- Replay/reconnect behavior validated under forced disconnect.
- Hosted compute-target UI and guard behavior remain correct.
- Browser relay NDJSON compatibility confirmed.
