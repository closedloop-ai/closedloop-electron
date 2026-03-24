# Cloud Command Executor Architecture

Not applicable -- this feature does not require changes to the command execution layer.

**Rationale**: The feature adds a file-tailing side channel in `symphony-loop.ts` that reads `claude-output.jsonl` and posts `output` events via the existing `postLoopEvent()` helper; no cloud-dispatched command routing, queue scheduling, lock-key serialization, cancel/timeout handling, replay buffering, or retention pruning is affected.
