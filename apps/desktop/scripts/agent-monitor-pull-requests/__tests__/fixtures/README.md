# FEA-1226 pull-request capture test fixtures

Test data set for the command-gated PR parsers (`pr-parsers.js`). PR capture
runs inside the Agent Dashboard sidecar's session importer and writes to the
shared `dashboard.db` `pull_requests` table — the same database that holds
sessions, plans, and packs.

## Provenance

These fixtures are **synthetic but structurally faithful**. Every line shape was
derived from a real corpus of **2,561 session-log `.jsonl` files (485 MB)**
exported from 6 engineers (Mike Angstadt, Parker, Alex Ponamarev, Kaiti
Carpenter, Thadeus, Kris Wong). A catalog pass over that corpus found **17
distinct on-disk signature types** carrying a PR URL or git-push signal, across
**1,889 real occurrences**.

The corpus itself is **not** committed — it contains real prompts, source
diffs, and local paths. Instead, each signature type is reproduced here with
synthetic content (synthetic repos `loopco/desktop` + `loopco/api`, synthetic
branches, no prompts/diffs/secrets) while keeping the exact JSON structure the
parser keys on. This keeps fixtures tiny, privacy-safe, and deterministic.

## Files

| File | Lines | Purpose |
|---|---|---|
| `claude-code-session.jsonl` | 11 | Claude Code `<uuid>.jsonl` shapes — `assistant`/`user` envelopes with nested `tool_use`/`tool_result` blocks |
| `codex-session.jsonl` | 12 | Codex `rollout-*.jsonl` shapes — `event_msg`/`response_item` envelopes with nested `payload` |
| `loop-pr-link.jsonl` | 4 | ClosedLoop loop wrapper `pr-link` events |
| `negatives.jsonl` | 22 | Must-NOT-capture cases — every corpus-observed false-positive category |
| `expected-events.json` | — | Golden master: the exact events each file must yield |

## The 17 signature types

`✅` = parser must emit a `pr-link` event. `·` = present in the corpus but
deliberately NOT captured in Phase 1.

### ClosedLoop loop (1)
- `✅ loop:pr-link` — top-level `{"type":"pr-link", prUrl, prNumber, prRepository, sessionId}`

### Claude Code (6) — tool blocks nested inside `message.content[]`
- `✅ cc:user>tool_result(pr-url)` — PR URL in a Bash `tool_result` whose paired `tool_use` was `gh pr create`
- `·  cc:user>tool_result(pr-new-hint)` — `pull/new/<branch>` hint (push happened, no PR yet)
- `·  cc:user>tool_result(push-success)` — `To github.com:...` push line, no PR URL
- `·  cc:assistant>tool_use(Bash,gh-pr)` — the `gh pr create` command itself (context: branch via top-level `gitBranch`)
- `·  cc:assistant>tool_use(Bash,git-push)` — the `git push` command itself (context)
- `·  cc:assistant>text(pr-url)` — model prose mentioning a PR URL (ignored per PRD non-goal: never parse model output)

### Codex (10) — event nested inside `payload`
- `✅ codex:event_msg>payload(exec_command_end)(pr-url)` — PR URL in `aggregated_output` of a `gh pr create`
- `✅ codex:response_item>payload(function_call_output)(pr-url)` — PR URL in `output`, paired to a `function_call` by `call_id`
- `·  codex:event_msg>payload(exec_command_end)(pr-new-hint)` — `pull/new` hint
- `·  codex:event_msg>payload(exec_command_end)(push-success)` — push line, no PR URL
- `·  codex:response_item>payload(function_call_output)(pr-new-hint)` — `pull/new` hint
- `·  codex:response_item>payload(function_call_output)(push-success)` — push line, no PR URL
- `·  codex:response_item>function_call(gh-pr)` — the `gh pr create` command (in `payload.arguments`, a JSON string; context)
- `·  codex:response_item>function_call(git-push)` — the `git push` command (context)
- `·  codex:event_msg>payload(user_message)(pr-url)` — the human prompt mentioning a PR URL (ignore)
- `·  codex:event_msg>payload(agent_message)(pr-url)` — model output mentioning a PR URL (ignore)

**11 capture-worthy / 6 ignore-by-design.** A Phase-1 `pr-link` event is only
emitted for a **confirmed** PR (`/pull/<number>`) found in the **output of a
`gh pr create`-class command** (Claude `tool_result`, Codex
`function_call_output` / `exec_command_end`) or in a loop `pr-link` event.
`pull/new/<branch>` hints, bare push lines, and any URL in a human prompt or
model prose are not PRs and must not be captured.

## False-positive traps — from real corpus data

A pass over the corpus traced **every** PR-URL occurrence back to the command
that produced it: **270 of 512 (53%) were false positives.** `negatives.jsonl`
reproduces every observed category. Counts are real corpus occurrences:

| Category | Corpus count | Why it's not a created PR |
|---|---|---|
| `gh api` output | 130 | API responses (e.g. posting a review comment) carry `html_url` with `#discussion_r…` fragments |
| `gh pr view` / `list` / `checks` | 63 | Inspecting a PR — often someone else's, for review |
| human prompt mentions a PR URL | 28 | The user pastes a PR URL to ask for a review |
| model prose (assistant / agent text) | 26 | The model summarizing — "opened PR at …" |
| `grep` / `rg` hit inside a file | 5 | A PR URL hardcoded in a test fixture file |
| `git diff` output | 3 | A PR URL inside changed source |
| `gh pr edit`, `sed` of node_modules | ~7 | Editing a PR; a PR URL in a dependency's code comment |

**The core rule the parser enforces:** a PR URL is captured only when it came
out of a `gh pr create` command (Claude `tool_use`→`tool_result` paired by
`tool_use_id`; Codex `function_call`→`function_call_output` paired by
`call_id`, or a self-contained `exec_command_end`) — or from a loop `pr-link`
event. Output of any other command, and any model/human text, is ignored.

Additional traps:
- `pull/new/<branch>` URLs — the PR-number regex must not extract `new`.
- Fixture owners (`acme`, `owner`, `org`, `example`) — filtered even when the
  producing command *is* `gh pr create`.
- Non-PR GitHub URLs (`/issues/`, `/blob/`) — never matched.
- Malformed JSON / non-JSON lines — parser skips, never throws.

## Session-id sourcing

All three formats carry a session id inside the file (Claude Code: top-level
`sessionId`; Codex: `session_meta.payload.id`; loop: `sessionId` on the
`pr-link` event), and the parser reads it. In the sidecar, however,
`pr-extractor.js` **overrides** it with the importer's canonical session id
(`session.sessionId`, which is `sessions.id`) so every `pull_requests` row
FK-joins to its `sessions` row — even for Codex, where the in-file id differs
from the transcript filename.

## Regenerating

If Claude Code or Codex changes its log schema, re-run the catalog pass over a
fresh corpus to detect new signature types, then update these fixtures + the
golden master. The catalog approach: classify each `.jsonl` line by
`(harness, structural location of the PR signal)` and tally distinct shapes.
