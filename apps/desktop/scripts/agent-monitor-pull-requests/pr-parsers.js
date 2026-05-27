/**
 * @file pr-parsers.js
 * @description Command-gated parsers for the three agent-harness session-log
 * schemas (Claude Code, Codex CLI, ClosedLoop loop). Emit a captured PR record
 * ONLY when a PR URL came out of a `gh pr create` command (or a loop `pr-link`
 * event). A corpus pass over 2,561 real session files found 53% of PR-URL
 * occurrences are false positives — URLs from `gh pr view`, `gh api`,
 * `git diff`, `grep`, human prompts, model prose. Command-gating rejects them.
 *
 * Part of CLOSEDLOOP engineer GitHub activity capture (FEA-1226). Materialized
 * into the generated tree as server/lib/pr-parsers.js by build-agent-monitor.mjs.
 *
 * Pure + dependency-free so the same logic is unit-tested in isolation and
 * reused by pr-extractor.js inside the session importer.
 */
"use strict";

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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFixtureOwner(owner) {
  return FIXTURE_OWNER_RE.test(owner);
}

/**
 * Extract confirmed GitHub PR URLs from a string. Fixture-owner URLs and
 * `pull/new/` hints are filtered out. Duplicates within the string are deduped.
 * @returns {{prUrl:string, prNumber:number, repoFullName:string, owner:string}[]}
 */
function extractPrUrlsFromText(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const seen = new Set();
  const refs = [];
  for (const match of text.matchAll(GITHUB_PR_URL_RE)) {
    const owner = match[1];
    const repo = match[2];
    const prNumberRaw = match[3];
    if (!owner || !repo || !prNumberRaw) continue;
    if (isFixtureOwner(owner)) continue;
    const prNumber = Number.parseInt(prNumberRaw, 10);
    if (!Number.isFinite(prNumber) || prNumber <= 0) continue;
    const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
    if (seen.has(prUrl)) continue;
    seen.add(prUrl);
    refs.push({ prUrl, prNumber, repoFullName: `${owner}/${repo}`, owner });
  }
  return refs;
}

/**
 * True when `cmd` invokes `gh pr create` — the only command whose output is
 * trusted to mean "this engineer just created a PR". Deliberately excludes
 * `gh pr view`/`edit`/`list`/`checks`, `gh api`, etc. `gh` must sit in command
 * position (start, or after a shell separator) so it is not matched as a mere
 * argument to another binary (`echo gh pr create`, `| grep gh pr create`).
 */
function isPrCreateCommand(cmd) {
  if (typeof cmd !== "string") return false;
  // Matches `gh pr create` at command position (or after shell separators),
  // with optional env-var prefixes like `GH_TOKEN=xxx gh pr create`.
  return /(?:^|[;&|(\n\t])\s*(?:\S+=\S+\s+)*gh\s+pr\s+create(?:$|[\s'")])/.test(cmd);
}

/** Parse one JSONL line as JSON. Returns null on any error (lines are skipped). */
function safeParseLine(line) {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Per-file parser state; carries cross-line command/output pairing. */
function createSessionParserState() {
  return {
    claudeBashCommands: new Map(),
    codexCallCommands: new Map(),
    codexSessionId: null,
  };
}

/** Flatten a string | array-of-content-blocks into one searchable string. */
function flattenContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (isRecord(item)) {
        for (const key of ["text", "output", "content", "result"]) {
          if (typeof item[key] === "string") parts.push(item[key]);
        }
      }
    }
    return parts.join("\n");
  }
  return "";
}

/** Insert into a pairing map, evicting the oldest entry past the cap (LRU). */
function rememberCommand(map, key, command) {
  map.delete(key);
  map.set(key, command);
  if (map.size > PENDING_COMMAND_CAP) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/** Codex `function_call.arguments` is a JSON string like `{"cmd":"gh pr …"}`. */
function extractCodexCommand(args) {
  if (typeof args !== "string") return "";
  try {
    const parsed = JSON.parse(args);
    if (isRecord(parsed) && typeof parsed.cmd === "string") return parsed.cmd;
  } catch {
    /* arguments not JSON — fall through */
  }
  return args;
}

/** Codex `exec_command_end.parsed_cmd` is `[{type, cmd}]`. */
function extractParsedCmd(parsedCmd) {
  if (!Array.isArray(parsedCmd)) return "";
  return parsedCmd
    .map((entry) =>
      isRecord(entry) && typeof entry.cmd === "string" ? entry.cmd : "",
    )
    .filter((c) => c.length > 0)
    .join(" && ");
}

/** Best-effort branch from a `gh pr create … --head <branch>` command. */
function extractHeadBranch(command) {
  const match = /--head[=\s]+(\S+)/.exec(command);
  return match ? match[1] : null;
}

function hasSuccessfulCodexExitCode(output) {
  if (typeof output !== "string") return null;
  const match = /^\s*Process exited with code (\d+)\b/m.exec(output);
  if (!match) return null;
  return Number.parseInt(match[1], 10) === 0;
}

function isSuccessfulExecCommandEnd(payload) {
  if (!isRecord(payload)) return false;
  if (typeof payload.exit_code === "number") {
    return payload.exit_code === 0;
  }
  if (typeof payload.status === "string") {
    return payload.status === "completed";
  }
  return false;
}

function loopEvent(parsed, fallbackSessionId) {
  const prUrl = typeof parsed.prUrl === "string" ? parsed.prUrl : null;
  if (!prUrl) return [];
  const refs = extractPrUrlsFromText(prUrl);
  if (refs.length === 0) return [];
  const ref = refs[0];
  const sessionId =
    typeof parsed.sessionId === "string" && parsed.sessionId
      ? parsed.sessionId
      : fallbackSessionId;
  return [
    {
      prUrl: ref.prUrl,
      prNumber: ref.prNumber,
      repoFullName: ref.repoFullName,
      branchName: typeof parsed.branchName === "string" ? parsed.branchName : null,
      headSha: typeof parsed.commitSha === "string" ? parsed.commitSha : null,
      harness: "closedloop-loop",
      externalSessionId: sessionId,
    },
  ];
}

function claudeEvents(parsed, fallbackSessionId, state) {
  const message = isRecord(parsed.message) ? parsed.message : null;
  const content = message && Array.isArray(message.content) ? message.content : [];

  if (parsed.type === "assistant") {
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_use" || block.name !== "Bash") {
        continue;
      }
      const id = typeof block.id === "string" ? block.id : null;
      const input = isRecord(block.input) ? block.input : null;
      const command = input && typeof input.command === "string" ? input.command : "";
      if (id) rememberCommand(state.claudeBashCommands, id, command);
    }
    return [];
  }

  const sessionId =
    typeof parsed.sessionId === "string" && parsed.sessionId
      ? parsed.sessionId
      : fallbackSessionId;
  const branchName =
    typeof parsed.gitBranch === "string" && parsed.gitBranch ? parsed.gitBranch : null;
  const events = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result") continue;
    const toolUseId =
      typeof block.tool_use_id === "string" ? block.tool_use_id : null;
    const command = toolUseId ? state.claudeBashCommands.get(toolUseId) : undefined;
    if (toolUseId) state.claudeBashCommands.delete(toolUseId);
    if (!isPrCreateCommand(command)) continue;
    const body = flattenContent(block.content);
    for (const ref of extractPrUrlsFromText(body)) {
      events.push({
        prUrl: ref.prUrl,
        prNumber: ref.prNumber,
        repoFullName: ref.repoFullName,
        branchName,
        headSha: null,
        harness: "claude-code",
        externalSessionId: sessionId,
      });
    }
  }
  return events;
}

function codexEventsFor(body, command, sessionId) {
  const branchName = extractHeadBranch(command);
  return extractPrUrlsFromText(body).map((ref) => ({
    prUrl: ref.prUrl,
    prNumber: ref.prNumber,
    repoFullName: ref.repoFullName,
    branchName,
    headSha: null,
    harness: "codex",
    externalSessionId: sessionId,
  }));
}

function codexEvents(parsed, fallbackSessionId, state) {
  const payload = isRecord(parsed.payload) ? parsed.payload : null;
  if (!payload) return [];
  const sessionId = state.codexSessionId || fallbackSessionId;

  switch (payload.type) {
    case "function_call": {
      const callId = typeof payload.call_id === "string" ? payload.call_id : null;
      const command = extractCodexCommand(payload.arguments);
      if (callId) rememberCommand(state.codexCallCommands, callId, command);
      return [];
    }
    case "function_call_output": {
      const callId = typeof payload.call_id === "string" ? payload.call_id : null;
      const command = callId ? state.codexCallCommands.get(callId) : undefined;
      if (callId) state.codexCallCommands.delete(callId);
      if (!isPrCreateCommand(command)) return [];
      if (hasSuccessfulCodexExitCode(flattenContent(payload.output)) === false) {
        return [];
      }
      return codexEventsFor(flattenContent(payload.output), command || "", sessionId);
    }
    case "exec_command_end": {
      const command = extractParsedCmd(payload.parsed_cmd);
      if (!isPrCreateCommand(command)) return [];
      if (!isSuccessfulExecCommandEnd(payload)) return [];
      return codexEventsFor(
        flattenContent(payload.aggregated_output),
        command,
        sessionId,
      );
    }
    default:
      return [];
  }
}

/**
 * Parse one JSONL line. `fallbackSessionId` is used when the line/file carries
 * no embedded session id. Returns zero or more PR-record drafts (without an
 * id / observed_at — the store fills those).
 */
function parseSessionLine(parsed, fallbackSessionId, state) {
  if (!isRecord(parsed)) return [];
  switch (parsed.type) {
    case "pr-link":
      return loopEvent(parsed, fallbackSessionId);
    case "assistant":
    case "user":
      return claudeEvents(parsed, fallbackSessionId, state);
    case "event_msg":
    case "response_item":
      return codexEvents(parsed, fallbackSessionId, state);
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

module.exports = {
  extractPrUrlsFromText,
  isFixtureOwner,
  isPrCreateCommand,
  safeParseLine,
  createSessionParserState,
  parseSessionLine,
};
