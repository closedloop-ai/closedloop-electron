/**
 * Parsers for the three signal formats the FEA-1226 tailer recognizes:
 *
 *   1. ClosedLoop loop wrapper:  {"type":"pr-link", "prUrl": ...}
 *   2. Codex CLI:                {"type":"exec_command_end", "aggregated_output": "..."}
 *   3. Claude Code:              {"type":"tool_use",    "name":"Bash", "input":{"command": "..."} }
 *                                {"type":"tool_result", "content": "..."}  (paired by tool_use_id)
 *
 * Each parser takes a single JSONL line (already known to be JSON-shaped) plus
 * the source session id (the JSONL file basename without extension). It returns
 * zero or more event drafts. The tailer is responsible for stitching state
 * (Claude Code tool_use → tool_result pairing) across lines of the same file.
 *
 * Test-fixture URLs are filtered at the URL-extraction step so all three
 * parsers benefit uniformly (AC7 in FEA-1226).
 */

import type {
  GitActivityEventInput,
  GitActivitySourceClient,
} from "../shared/git-activity-types.js";

// Single regex used by every text-content parser. Allows owner/repo with dots,
// hyphens, underscores (matches the slug rules GitHub actually permits).
// `g` flag is intentional — multiple PR URLs in one line should all be picked up.
const GITHUB_PR_URL_RE =
  /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/g;

// Owners that are exclusively used in fixtures / examples / test data.
// `acme` is the canonical placeholder in many docs; `example`/`sample` are the
// IANA / GitHub example owners; `test-org` is widely used in fixture suites.
// Real owners do exist with names like `owner` or `org` so we err narrow.
const FIXTURE_OWNER_RE =
  /^(?:owner|acme|org|example|test-org|sample|fixtures?|placeholder|repo)$/i;

export interface ExtractedPrReference {
  prUrl: string;
  prNumber: number;
  repoFullName: string;
  /** Owner segment (already lowercased for matching only — preserved cased in repoFullName). */
  owner: string;
}

/**
 * Extracts all real-looking GitHub PR URLs from a string. Fixture URLs are
 * filtered out. Duplicates within the same string are deduped.
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
    refs.push({
      prUrl,
      prNumber,
      repoFullName: `${owner}/${repo}`,
      owner,
    });
  }
  return refs;
}

export function isFixtureOwner(owner: string): boolean {
  return FIXTURE_OWNER_RE.test(owner);
}

/**
 * Attempts to parse a single JSONL line as JSON. Returns null on parse errors —
 * malformed lines are skipped silently by design (the tailer must be tolerant
 * of partial writes and schema drift; an exception here would halt the loop).
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

// ─────────────────────────────────────────────────────────────────────────────
// 1. ClosedLoop loop wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a single line for `{"type":"pr-link", "prUrl": ..., "prNumber": ...}`.
 * The loop wrapper emits these directly, so no URL extraction is needed — we
 * trust the structured fields and only do shape validation.
 */
export function parseClosedloopLoopLine(
  parsed: unknown,
  sourceSessionId: string,
): GitActivityEventInput[] {
  if (!isRecord(parsed)) {
    return [];
  }
  if (parsed.type !== "pr-link") {
    return [];
  }
  const prUrl = typeof parsed.prUrl === "string" ? parsed.prUrl : null;
  if (!prUrl) {
    return [];
  }
  const refs = extractPrUrlsFromText(prUrl);
  if (refs.length === 0) {
    return []; // URL didn't pass the fixture/sanity filter
  }
  const ref = refs[0];
  const branchName = typeof parsed.branchName === "string" ? parsed.branchName : null;
  const commitSha = typeof parsed.commitSha === "string" ? parsed.commitSha : null;
  return [
    {
      type: "pr-link",
      prUrl: ref.prUrl,
      prNumber: ref.prNumber,
      repoFullName: ref.repoFullName,
      branchName,
      commitSha,
      sourceClient: "closedloop-loop",
      sourceSessionId,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Codex CLI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Codex's rollout JSONL emits one record per command end. PR URLs from
 * `gh pr create` show up inside `aggregated_output` (the captured stdout).
 * The `command` array can give us a branch name when the shell line was a push.
 */
export function parseCodexLine(
  parsed: unknown,
  sourceSessionId: string,
): GitActivityEventInput[] {
  if (!isRecord(parsed)) {
    return [];
  }
  if (parsed.type !== "exec_command_end") {
    return [];
  }
  const output =
    typeof parsed.aggregated_output === "string" ? parsed.aggregated_output : "";
  const refs = extractPrUrlsFromText(output);
  if (refs.length === 0) {
    return [];
  }
  const command = Array.isArray(parsed.command)
    ? (parsed.command as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const branchName = extractBranchFromCommand(command);
  return refs.map((ref) => ({
    type: "pr-link" as const,
    prUrl: ref.prUrl,
    prNumber: ref.prNumber,
    repoFullName: ref.repoFullName,
    branchName,
    commitSha: null,
    sourceClient: "codex" as GitActivitySourceClient,
    sourceSessionId,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Claude Code (Bash tool_use → tool_result pairing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-file state the tailer carries across lines so a `tool_result` can be
 * matched back to its `tool_use.input.command`. Maps tool_use_id → command
 * string. Bounded to avoid pathological growth on long-lived sessions.
 */
export interface ClaudeCodeParserState {
  pendingToolUses: Map<string, { command: string }>;
}

const CLAUDE_TOOL_USE_CAP = 256;

export function createClaudeCodeParserState(): ClaudeCodeParserState {
  return { pendingToolUses: new Map() };
}

export function parseClaudeCodeLine(
  parsed: unknown,
  sourceSessionId: string,
  state: ClaudeCodeParserState,
): GitActivityEventInput[] {
  if (!isRecord(parsed)) {
    return [];
  }
  if (parsed.type === "tool_use") {
    if (parsed.name !== "Bash") {
      return [];
    }
    const toolUseId = typeof parsed.id === "string" ? parsed.id : null;
    if (!toolUseId) {
      return [];
    }
    const input = isRecord(parsed.input) ? parsed.input : null;
    const command = input && typeof input.command === "string" ? input.command : "";
    state.pendingToolUses.set(toolUseId, { command });
    // Bound the map to prevent unbounded growth in long sessions
    if (state.pendingToolUses.size > CLAUDE_TOOL_USE_CAP) {
      const firstKey = state.pendingToolUses.keys().next().value;
      if (firstKey !== undefined) {
        state.pendingToolUses.delete(firstKey);
      }
    }
    return [];
  }
  if (parsed.type !== "tool_result") {
    return [];
  }
  const content = extractToolResultContent(parsed);
  if (!content) {
    return [];
  }
  const refs = extractPrUrlsFromText(content);
  if (refs.length === 0) {
    return [];
  }
  const toolUseId = typeof parsed.tool_use_id === "string" ? parsed.tool_use_id : null;
  const stash = toolUseId ? state.pendingToolUses.get(toolUseId) : undefined;
  if (stash && toolUseId) {
    state.pendingToolUses.delete(toolUseId);
  }
  const branchName = stash ? extractBranchFromCommandLine(stash.command) : null;
  return refs.map((ref) => ({
    type: "pr-link" as const,
    prUrl: ref.prUrl,
    prNumber: ref.prNumber,
    repoFullName: ref.repoFullName,
    branchName,
    commitSha: null,
    sourceClient: "claude-code" as GitActivitySourceClient,
    sourceSessionId,
  }));
}

/**
 * tool_result.content can be a string (legacy) or an array of content blocks
 * (newer Anthropic API shape: `[{ type: "text", text: "..." }]`). Flatten to a
 * single string so the URL regex can scan it.
 */
function extractToolResultContent(parsed: Record<string, unknown>): string {
  const content = parsed.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (isRecord(item) && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch-name extraction (best-effort)
// ─────────────────────────────────────────────────────────────────────────────

/** From an argv-style array like `["git","push","origin","feature/foo"]`. */
function extractBranchFromCommand(argv: readonly string[]): string | null {
  // Recognize `git push <remote> <branch>` and `git push -u <remote> <branch>`.
  const pushIdx = argv.indexOf("push");
  if (pushIdx >= 0 && argv[pushIdx - 1] === "git") {
    let cursor = pushIdx + 1;
    while (cursor < argv.length && argv[cursor]?.startsWith("-")) {
      // Skip flags like -u, --force, --set-upstream
      if (argv[cursor] === "-u" || argv[cursor] === "--set-upstream") {
        cursor += 1;
      } else if (argv[cursor]?.startsWith("--") && argv[cursor]?.includes("=")) {
        cursor += 1;
      } else {
        cursor += 1;
      }
    }
    // Remote is at cursor, branch at cursor+1
    const candidate = argv[cursor + 1];
    if (candidate && !candidate.startsWith("-")) {
      return candidate;
    }
  }
  return null;
}

/** From a flat command line like `"git push origin feature/foo"`. */
function extractBranchFromCommandLine(commandLine: string): string | null {
  if (!commandLine) {
    return null;
  }
  // Simple whitespace split — sufficient for `git push <remote> <branch>` cases.
  // Quoted args with spaces in branch names are not handled (branch names cannot
  // contain spaces in git anyway).
  const argv = commandLine.trim().split(/\s+/);
  return extractBranchFromCommand(argv);
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
