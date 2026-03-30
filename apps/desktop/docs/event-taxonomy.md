# PostHog Event Taxonomy

Living reference of all PostHog analytics events emitted by the desktop app.

## Naming Convention

- Underscore-separated: `command_initiated`, `approval_resolved`
- New events must follow `<domain>_<action>` pattern
- Do not create events without adding them to this document and to `observability.ts`

## Events

### Command Funnel

| Event | Properties | Funnel Position |
|-------|-----------|-----------------|
| `command_initiated` | `command_id`, `operation_type`, `release_version`, `desktop_id` | 1 |
| `command_started` | `command_id`, `operation_type` | 2 |
| `command_completed` | `command_id`, `operation_type`, `latency_ms` | 3 (success) |
| `command_failed` | `command_id`, `operation_type`, `error_class` (timeout/cancelled/gateway_error) | 3 (failure) |

### Approval Workflow

| Event | Properties |
|-------|-----------|
| `approval_requested` | `operation_type`, `command_id` (optional) |
| `approval_resolved` | `operation_type`, `outcome` (granted/denied/timed_out), `time_to_resolve_ms`, `command_id` (optional) |

### Connection Lifecycle

| Event | Properties |
|-------|-----------|
| `desktop_connection_established` | `desktop_id`, `version`, `environment` |
| `desktop_reconnection_resume` | `reason`, `replay_command_count` |

### Sandbox

| Event | Properties |
|-------|-----------|
| `sandbox_blocked_operation` | `operation_class` |

## Common Properties

All events automatically include:
- `release_version` — app version from package.json
- `distinct_id` — set to `desktop_id` (computeTargetId from relay hello-ack)

## Adding New Events

1. Add a typed method to `Observability` class in `src/main/observability.ts`
2. Add tests in `test/observability.test.ts`
3. Update this document
