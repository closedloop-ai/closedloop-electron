import type { Harness, NormalizedSession } from "./collectors/types.js";

/** Snake_case hook payload `data` block as delivered by the hook handlers. */
export interface HookData {
  session_id?: string;
  cwd?: string;
  model?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown> | null;
  source?: string;
  stop_reason?: string;
  message?: string;
  agent_type?: string;
  subagent_type?: string;
  prompt?: string;
  description?: string;
  session_name?: string;
  [key: string]: unknown;
}

/** Cumulative per-model token counts from the current transcript segment. */
export interface TokenUsageCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Effective reconciled per-(session, model) token counts. Internal: never crosses IPC. */
export interface TokenUsageRow {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ImportResult {
  /** True when the session already existed and nothing new was written. */
  skipped: boolean;
  /** True when a terminal session was revived because its file is recently active. */
  reactivated: boolean;
}

export interface Importer {
  importSession(
    session: NormalizedSession,
    harness: Harness,
  ): ImportResult | Promise<ImportResult>;
}
