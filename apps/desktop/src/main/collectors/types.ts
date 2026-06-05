/**
 * @file types.ts
 * @description The collection-layer contract (FEA-1503). Every harness parser
 * (Claude, Codex, Cursor, Copilot, OpenCode) emits this single `NormalizedSession`
 * shape, and the first-party `importSession` write-sink consumes it. Ported from
 * the vendor agent-monitor's normalized session shape so the unchanged dashboard
 * renders all harnesses identically.
 */

/** The five agent CLIs we collect from. */
export type Harness = "claude" | "codex" | "cursor" | "copilot" | "opencode";

/** Cumulative per-model token counts (output already folds in reasoning tokens). */
export interface NormalizedTokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** A tool invocation parsed from a transcript → becomes a PostToolUse event. */
export interface NormalizedToolUse {
  name: string;
  timestamp: string | null;
  input?: unknown;
  /** CR-3: Tool result content (size-capped). */
  output?: unknown;
  /** CR-3: Whether the tool result was an error. */
  isError?: boolean;
  /** CR-6: MCP server name (Codex preserves from mcp_tool_call_begin). */
  mcpServer?: string;
  /** CR-6: MCP method name. */
  mcpMethod?: string;
  /** CR-8: Skill name extracted from Skill tool input.skill (Claude). */
  skillName?: string;
  /** CR-4: Per-edit line delta. */
  diffDelta?: { add: number; del: number };
}

/** An API-level error parsed from a transcript → becomes an APIError event. */
export interface NormalizedApiError {
  type?: string | null;
  message?: string | null;
  timestamp: string | null;
}

/** A tool-result error parsed from a transcript → becomes a ToolError event. */
export interface NormalizedToolResultError {
  content?: string | null;
  timestamp: string | null;
}

/** A measured turn duration → becomes a TurnDuration event. */
export interface NormalizedTurnDuration {
  durationMs: number;
  timestamp: string | null;
}

/** CR-1: An ordered message from a session transcript. */
export interface NormalizedMessage {
  role: "human" | "assistant" | "system";
  timestamp: string | null;
  text: string | null;
  model?: string | null;
  tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  isThinking?: boolean;
}

/** CR-2: A per-turn token record for time-series reconstruction. */
export interface NormalizedTokenRecord {
  timestamp: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** CR-4: Aggregate diff stats for the session. */
export interface NormalizedDiffStats {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

/** CR-13: Structured artifact references extracted from tool calls. */
export interface NormalizedArtifacts {
  prs: Array<{ number: string; repo?: string }>;
  issues: Array<{ key: string }>;
  repo: string | null;
}

/** A plan block (Codex only today). Stored on the session metadata. */
export interface NormalizedPlan {
  source?: string | null;
  content?: string | null;
  timestamp: string | null;
}

/**
 * The normalized session every parser produces. `startedAt` falsy ⇒ the parser
 * returns null (caller skips). All array fields default to `[]`, all token maps
 * to `{}`.
 */
export interface NormalizedSession {
  sessionId: string;
  name: string;
  cwd: string | null;
  model: string | null;
  version: string | null;
  slug: string | null;
  gitBranch: string | null;
  startedAt: string | null;
  endedAt: string | null;
  teams: unknown[];
  userMessages: number;
  assistantMessages: number;
  tokensByModel: Record<string, NormalizedTokenCounts>;
  messageTimestamps: string[];
  toolUses: NormalizedToolUse[];
  plans?: NormalizedPlan[];
  compactions: unknown[];
  apiErrors: NormalizedApiError[];
  /** mtimeMs of the source file; drives the "recently active (<10min)" decision. */
  fileModifiedAt: number | null;
  turnDurations: NormalizedTurnDuration[];
  entrypoint: string;
  permissionMode: string | null;
  thinkingBlockCount: number;
  toolResultErrors: NormalizedToolResultError[];
  usageExtras: {
    service_tiers: unknown[];
    speeds: unknown[];
    inference_geos: unknown[];
  };
  /** CR-1: Ordered per-message list with text content. */
  messages: NormalizedMessage[];
  /** CR-2: Per-turn token records for time-series reconstruction. */
  tokenSeries: NormalizedTokenRecord[];
  /** CR-4: Aggregate diff stats (files changed, lines +/-). Null when absent. */
  diffStats: NormalizedDiffStats | null;
  /** CR-7: Claude slash commands extracted from transcripts. */
  slashCommands: Array<{ name: string; timestamp: string }>;
  /** CR-13: Structured artifact references (PRs, issues, repo). */
  artifacts: NormalizedArtifacts;
}

/** Empty `usageExtras` literal — parsers spread/override as needed. */
export function emptyUsageExtras(): NormalizedSession["usageExtras"] {
  return { service_tiers: [], speeds: [], inference_geos: [] };
}

/** Empty `artifacts` literal — parsers fill as they extract references. */
export function emptyArtifacts(): NormalizedArtifacts {
  return { prs: [], issues: [], repo: null };
}

/**
 * A per-harness collector descriptor (FEA-1503). The generic boot importer and
 * the generic watcher (`watcher.ts`, `collector-manager.ts`) drive every harness
 * through this uniform shape, so the only per-harness code is `home` (path/env
 * resolution) + `parser` (format → NormalizedSession) + a small descriptor.
 *
 *  - File harnesses (Claude/Codex/Cursor/Copilot): `listSources()` returns the
 *    current source file paths; `parse(file)` returns `[session]` (or `[]`). The
 *    per-file catchup cache skips unchanged files.
 *  - Batch harnesses (OpenCode): set `batch: true`, self-fingerprint inside
 *    `listSources()` (return `[]` when the store is unchanged, else a single
 *    sentinel), and `parse(sentinel)` loads every session from the store.
 */
export interface HarnessCollector {
  key: Harness;
  /** Stable name for this collector's persisted catchup cache (file harnesses). */
  cacheName: string;
  /** When true the per-file catchup cache is bypassed (the harness self-fingerprints). */
  batch?: boolean;
  /** Directories to recursively fs.watch. Missing dirs self-heal when they appear. */
  watchRoots(): string[];
  /** Which changed filenames (basename or relative path) trigger a re-import. */
  watchMatch(filename: string): boolean;
  /** Enumerate the current source paths to import. */
  listSources(): string[];
  /** Parse one source into zero or more normalized sessions. */
  parse(source: string): Promise<NormalizedSession[]>;
}
