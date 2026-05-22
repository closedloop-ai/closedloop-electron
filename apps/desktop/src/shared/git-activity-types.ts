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

/**
 * Which agent harness produced the activity. Field name (`harness`) and values
 * align with symphony-alpha's `AgentSession.harness` so a captured record maps
 * cleanly onto the cloud session model when Phase 2 sync lands.
 */
export type GitActivityHarness =
  | "claude-code"
  | "codex"
  | "closedloop-loop";

/**
 * A captured "this session produced this PR" record.
 *
 * Field names mirror symphony-alpha so a record is a clean projection of the
 * cloud's `AgentSession` ⋈ `PullRequestDetail` join — the join the cloud
 * cannot currently make on its own (it has no stored session→PR edge):
 *   - `externalSessionId` → `AgentSession.externalSessionId`
 *   - `harness`           → `AgentSession.harness`
 *   - `repoFullName` + `prNumber` → `PullRequestDetail` identity `(repository, number)`
 *   - `headSha`           → `BranchDetail.headSha`
 */
export interface GitActivityEvent {
  /** Deterministic 16-char hex digest of (harness, externalSessionId, prUrl). Used for dedup. */
  id: string;
  /** Event kind — reserved for future "push" / "issue" types. */
  type: "pr-link";
  /** Canonicalized https://github.com/<owner>/<repo>/pull/<n> URL. */
  prUrl: string;
  prNumber: number;
  /** "<owner>/<repo>" — together with prNumber, the PR's identity. */
  repoFullName: string;
  /** Best-effort, may be null if not inferrable from the source line. */
  branchName: string | null;
  /** Branch head commit SHA at capture time. Best-effort, may be null. */
  headSha: string | null;
  /** The agent harness that produced the PR. */
  harness: GitActivityHarness;
  /** Harness session id (Claude `sessionId` / Codex `session_meta.id` / loop `sessionId`). */
  externalSessionId: string;
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
