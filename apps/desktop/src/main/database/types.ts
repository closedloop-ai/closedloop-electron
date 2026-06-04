// Private persistence-row types for the in-process agent database.
//
// Renderer-facing IPC response DTOs (DashboardSummary, AnalyticsData, the
// session/agent/event response shapes, etc.) live in
// `src/shared/agent-db-contract.ts` so the renderer's compile-time contract is
// decoupled from this private persistence layer. Each repository store maps raw
// `node:sqlite` rows into those shared DTOs via its `toRow()` helper. Only row
// types that never cross the IPC boundary belong here.

/** Effective reconciled per-(session, model) token counts. Internal: never crosses IPC. */
export interface TokenUsageRow {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
