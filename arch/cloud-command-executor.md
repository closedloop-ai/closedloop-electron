# Cloud Command Executor Architecture

Not applicable — this feature does not require changes to the command execution layer.

**Rationale**: The fix adds `postLoopEvent()` calls inside `handleLoopRequest()` in `symphony-loop.ts` before repo-validation early returns; the executor's role is unchanged — it dispatches the HTTP request to the gateway, receives the 403/404 response, and emits it as a terminal error event exactly as it does today.
