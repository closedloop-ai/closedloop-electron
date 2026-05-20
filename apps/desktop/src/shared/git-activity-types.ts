/**
 * Shared types for the engineer GitHub activity capture feature (FEA-1226).
 *
 * Events are produced by the session-log tailer in the main process from three
 * source formats (ClosedLoop loop pr-link events, Codex exec_command_end
 * aggregated_output, Claude Code Bash tool_result content). They are persisted
 * in a local electron-store ("desktop-git-activity") and surfaced in the tray.
 *
 * Phase 1 only writes/reads local state. Phase 2 (symphony-alpha) will consume
 * the same event shape via an ingest endpoint — keep this contract stable.
 */

export type GitActivitySourceClient =
  | "claude-code"
  | "codex"
  | "closedloop-loop";

export interface GitActivityEvent {
  /** Deterministic 16-char hex digest of (sourceClient, sourceSessionId, prUrl). Used for dedup. */
  id: string;
  /** Event kind — reserved for future "push" / "issue" types. */
  type: "pr-link";
  /** Canonicalized https://github.com/<owner>/<repo>/pull/<n> URL. */
  prUrl: string;
  prNumber: number;
  /** "<owner>/<repo>" (lowercase repo names not normalized — match GitHub's API casing). */
  repoFullName: string;
  /** Best-effort, may be null if not inferrable from the source line. */
  branchName: string | null;
  /** Best-effort, may be null if not inferrable from the source line. */
  commitSha: string | null;
  sourceClient: GitActivitySourceClient;
  /** JSONL filename basename (no extension) — used as a stable per-session key. */
  sourceSessionId: string;
  /** ISO-8601 timestamp of when the tailer observed the URL. NOT the PR creation time. */
  observedAt: string;
}

/**
 * Result of attempting to add an event to the store. Distinct from a boolean
 * so the tailer can log/metric the three outcomes (added vs duplicate vs
 * dropped because capture is off).
 */
export type GitActivityAddResult = "added" | "duplicate" | "disabled";

/** Shape parsers produce; the store fills in `id` and `observedAt`. */
export type GitActivityEventInput = Omit<GitActivityEvent, "id" | "observedAt"> & {
  observedAt?: string;
};
