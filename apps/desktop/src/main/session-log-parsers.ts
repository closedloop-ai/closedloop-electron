/**
 * Parsers for the FEA-1226 session-log tailer.
 *
 * These read the REAL on-disk JSONL schemas of three harnesses and emit a
 * captured PR event ONLY when a PR URL came out of a `gh pr create` command
 * (or a ClosedLoop loop `pr-link` event). This command-gating is the heart of
 * the design: a corpus pass over 2,561 real session files found that 53% of
 * PR-URL occurrences are false positives — URLs from `gh pr view`, `gh api`,
 * `git diff`, `grep`, human prompts, and model prose. None of those are
 * created PRs, so none are captured.
 *
 * Real schemas (top-level JSONL line shapes):
 *   - ClosedLoop loop : {"type":"pr-link", prUrl, prNumber, prRepository, sessionId}
 *   - Claude Code     : {"type":"assistant"|"user", "sessionId", "gitBranch",
 *                        "message":{"content":[ ...tool_use / tool_result... ]}}
 *   - Codex CLI       : {"type":"event_msg"|"response_item"|"session_meta",
 *                        "payload":{ "type": "...", ... }}
 *
 * `tool_use`/`tool_result` (Claude) and `function_call`/`function_call_output`
 * (Codex) are paired across lines, so the parser carries per-file state.
 */

import type {
  GitActivityEventInput,
  GitActivitySourceClient,
} from "../shared/git-activity-types.js";

// Matches a confirmed PR URL. The `(?!new\b)` lookahead rejects
// `pull/new/<branch>` push hints — those are not created PRs.
const GITHUB_PR_URL_RE =
  /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(?!new\b)(\d+)/g;

// Owners used exclusively in fixtures / examples / test data (FEA-1226 AC7).
const FIXTURE_OWNER_RE =
  /^(?:owner|acme|org|example|test-org|sample|fixtures?|placeholder|repo)$/i;

// Per-file cap so a pathological session can't grow the pairing maps without
// bound. PR-creating commands are rare; 256 pending entries is generous.
const PENDING_COMMAND_CAP = 256;

export interface ExtractedPrReference {
  prUrl: string;
  prNumber: number;
  repoFullName: string;
  owner: string;
}

/**
 * Extracts confirmed GitHub PR URLs from a string. Fixture-owner URLs and
 * `pull/new/` hints are filtered out. Duplicates within the string are deduped.
 */
export function extractPrUrlsFromText(text: string): ExtractedPrReference[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const refs: ExtractedPrReference[] = [];
  for (const match of text.matchAll(GITHUB_PR_URL_RE)) {
    const [, owner, repo, prNumberRaw] = match;
    if (!owner || !repo || !prNumberRaw) {
      continue;
    }
    if (isFixtureOwner(owner)) {
      continue;
    }
    const prNumber = Number.parseInt(prNumberRaw, 10);
    if (!Number.isFinite(prNumber) || prNumber <= 0) {
      continue;
    }
    const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
    if (seen.has(prUrl)) {
      continue;
    }
    seen.add(prUrl);
    refs.push({ prUrl, prNumber, repoFullName: `${owner}/${repo}`, owner });
  }
  return refs;
}

export function isFixtureOwner(owner: string): boolean {
  return FIXTURE_OWNER_RE.test(owner);
}

/**
 * True when `cmd` invokes `gh pr create` — the only command whose output is
 * trusted to mean "this engineer just created a PR". Deliberately excludes
 * `gh pr view`, `gh pr edit`, `gh pr list`, `gh pr checks`, `gh api`, etc.
 *
 * `gh` must sit in command position: at the start of the string, or right
 * after a shell separator (`;`, `&&`, `|`, `(`, newline, tab) — optionally
 * preceded by whitespace. This rejects `gh` appearing merely as an *argument*
 * to another binary, e.g. `echo gh pr create` or `... | grep gh pr create`,
 * which would otherwise sneak past a plain-whitespace boundary.
 */
export function isPrCreateCommand(cmd: unknown): boolean {
  if (typeof cmd !== "string") {
    return false;
  }
  return /(?:^|[;&|(\n\t])\s*gh\s+pr\s+create(?:$|[\s'")])/.test(cmd);
}

/**
 * Parses a single JSONL line as JSON. Returns null on parse errors — malformed
 * lines are skipped silently (the tailer must tolerate partial writes and
 * schema drift; throwing here would halt the scan loop).
 */
export function safeParseLine(line: string): unknown {
  if (typeof line !== "string") {
    return null;
  }
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Per-file parser state. The tailer creates one per session file and feeds
 * lines through `parseSessionLine` in order so command/output pairs resolve.
 */
export interface SessionParserState {
  /** Claude Code: tool_use_id -> the Bash command string. */
  claudeBashCommands: Map<string, string>;
  /** Codex: call_id -> the command string (from function_call arguments). */
  codexCallCommands: Map<string, string>;
  /** Codex: real session id from the `session_meta` line, if seen. */
  codexSessionId: string | null;
}

export function createSessionParserState(): SessionParserState {
  return {
    claudeBashCommands: new Map(),
    codexCallCommands: new Map(),
    codexSessionId: null,
  };
}

/**
 * Parse one JSONL line. `fallbackSessionId` is used when the line/file carries
 * no embedded session id (typically the JSONL filename basename).
 */
export function parseSessionLine(
  parsed: unknown,
  fallbackSessionId: string,
  state: SessionParserState,
): GitActivityEventInput[] {
  if (!isRecord(parsed)) {
    return [];
  }
  switch (parsed.type) {
    case "pr-link":
      return parseLoopPrLink(parsed, fallbackSessionId);
    case "assistant":
    case "user":
      return parseClaudeLine(parsed, fallbackSessionId, state);
    case "event_msg":
    case "response_item":
      return parseCodexLine(parsed, fallbackSessionId, state);
    case "session_meta": {
      const payload = isRecord(parsed.payload) ? parsed.payload : null;
      if (payload && typeof payload.id === "string") {
        state.codexSessionId = payload.id;
      }
      return [];
    }
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ClosedLoop loop wrapper
// ─────────────────────────────────────────────────────────────────────────────

function parseLoopPrLink(
  parsed: Record<string, unknown>,
  fallbackSessionId: string,
): GitActivityEventInput[] {
  const prUrl = typeof parsed.prUrl === "string" ? parsed.prUrl : null;
  if (!prUrl) {
    return [];
  }
  const refs = extractPrUrlsFromText(prUrl);
  if (refs.length === 0) {
    return [];
  }
  const ref = refs[0];
  const sessionId =
    typeof parsed.sessionId === "string" && parsed.sessionId
      ? parsed.sessionId
      : fallbackSessionId;
  return [
    {
      type: "pr-link",
      prUrl: ref.prUrl,
      prNumber: ref.prNumber,
      repoFullName: ref.repoFullName,
      branchName: typeof parsed.branchName === "string" ? parsed.branchName : null,
      commitSha: typeof parsed.commitSha === "string" ? parsed.commitSha : null,
      sourceClient: "closedloop-loop",
      sourceSessionId: sessionId,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Code — tool_use / tool_result nested in message.content[]
// ─────────────────────────────────────────────────────────────────────────────

function parseClaudeLine(
  parsed: Record<string, unknown>,
  fallbackSessionId: string,
  state: SessionParserState,
): GitActivityEventInput[] {
  const message = isRecord(parsed.message) ? parsed.message : null;
  const content = message && Array.isArray(message.content) ? message.content : [];

  if (parsed.type === "assistant") {
    // Record Bash commands so a later tool_result can be matched to them.
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_use" || block.name !== "Bash") {
        continue;
      }
      const id = typeof block.id === "string" ? block.id : null;
      const input = isRecord(block.input) ? block.input : null;
      const command = input && typeof input.command === "string" ? input.command : "";
      if (id) {
        rememberCommand(state.claudeBashCommands, id, command);
      }
    }
    return [];
  }

  // type === "user": tool_result blocks carry command output.
  const sessionId =
    typeof parsed.sessionId === "string" && parsed.sessionId
      ? parsed.sessionId
      : fallbackSessionId;
  const branchName =
    typeof parsed.gitBranch === "string" && parsed.gitBranch ? parsed.gitBranch : null;
  const events: GitActivityEventInput[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result") {
      continue;
    }
    const toolUseId =
      typeof block.tool_use_id === "string" ? block.tool_use_id : null;
    const command = toolUseId ? state.claudeBashCommands.get(toolUseId) : undefined;
    if (toolUseId) {
      state.claudeBashCommands.delete(toolUseId);
    }
    // Command gate: only `gh pr create` output is trusted.
    if (!isPrCreateCommand(command)) {
      continue;
    }
    const body = flattenContent(block.content);
    for (const ref of extractPrUrlsFromText(body)) {
      events.push({
        type: "pr-link",
        prUrl: ref.prUrl,
        prNumber: ref.prNumber,
        repoFullName: ref.repoFullName,
        branchName,
        commitSha: null,
        sourceClient: "claude-code",
        sourceSessionId: sessionId,
      });
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Codex CLI — event nested in payload
// ─────────────────────────────────────────────────────────────────────────────

function parseCodexLine(
  parsed: Record<string, unknown>,
  fallbackSessionId: string,
  state: SessionParserState,
): GitActivityEventInput[] {
  const payload = isRecord(parsed.payload) ? parsed.payload : null;
  if (!payload) {
    return [];
  }
  const sessionId = state.codexSessionId ?? fallbackSessionId;

  switch (payload.type) {
    case "function_call": {
      // Record the command; arguments is a JSON-encoded string.
      const callId = typeof payload.call_id === "string" ? payload.call_id : null;
      const command = extractCodexCommand(payload.arguments);
      if (callId) {
        rememberCommand(state.codexCallCommands, callId, command);
      }
      return [];
    }
    case "function_call_output": {
      const callId = typeof payload.call_id === "string" ? payload.call_id : null;
      const command = callId ? state.codexCallCommands.get(callId) : undefined;
      if (callId) {
        state.codexCallCommands.delete(callId);
      }
      if (!isPrCreateCommand(command)) {
        return [];
      }
      return codexEvents(
        flattenContent(payload.output),
        command ?? "",
        sessionId,
      );
    }
    case "exec_command_end": {
      // Self-contained: the command is in parsed_cmd, the output in
      // aggregated_output.
      const command = extractParsedCmd(payload.parsed_cmd);
      if (!isPrCreateCommand(command)) {
        return [];
      }
      return codexEvents(
        flattenContent(payload.aggregated_output),
        command,
        sessionId,
      );
    }
    default:
      // user_message, agent_message, reasoning, token_count, … — ignored.
      return [];
  }
}

function codexEvents(
  body: string,
  command: string,
  sessionId: string,
): GitActivityEventInput[] {
  const branchName = extractHeadBranch(command);
  return extractPrUrlsFromText(body).map((ref) => ({
    type: "pr-link" as const,
    prUrl: ref.prUrl,
    prNumber: ref.prNumber,
    repoFullName: ref.repoFullName,
    branchName,
    commitSha: null,
    sourceClient: "codex" as GitActivitySourceClient,
    sourceSessionId: sessionId,
  }));
}

/** Codex `function_call.arguments` is a JSON string like `{"cmd":"gh pr …"}`. */
function extractCodexCommand(args: unknown): string {
  if (typeof args !== "string") {
    return "";
  }
  try {
    const parsed = JSON.parse(args);
    if (isRecord(parsed) && typeof parsed.cmd === "string") {
      return parsed.cmd;
    }
  } catch {
    // arguments not JSON — fall through
  }
  return args;
}

/** Codex `exec_command_end.parsed_cmd` is `[{type, cmd}]`. */
function extractParsedCmd(parsedCmd: unknown): string {
  if (!Array.isArray(parsedCmd)) {
    return "";
  }
  return parsedCmd
    .map((entry) =>
      isRecord(entry) && typeof entry.cmd === "string" ? entry.cmd : "",
    )
    .filter((c) => c.length > 0)
    .join(" && ");
}

/** Best-effort branch from a `gh pr create … --head <branch>` command. */
function extractHeadBranch(command: string): string | null {
  const match = /--head[=\s]+(\S+)/.exec(command);
  return match ? match[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flattens a content value into one searchable string. Handles a plain
 * string, or an array of content blocks (`[{type:"text", text}]`) — the newer
 * Anthropic tool_result shape.
 */
function flattenContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (isRecord(item)) {
        for (const key of ["text", "output", "content", "result"]) {
          if (typeof item[key] === "string") {
            parts.push(item[key] as string);
          }
        }
      }
    }
    return parts.join("\n");
  }
  return "";
}

/** Insert into a pairing map, evicting the oldest entry past the cap. */
function rememberCommand(
  map: Map<string, string>,
  key: string,
  command: string,
): void {
  // delete-then-set so a re-used id is refreshed to newest insertion order
  // (LRU); a plain set() would leave a re-used key at its stale position and
  // let it be evicted ahead of genuinely older entries.
  map.delete(key);
  map.set(key, command);
  if (map.size > PENDING_COMMAND_CAP) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
