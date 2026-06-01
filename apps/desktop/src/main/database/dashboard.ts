import type { DatabaseSync } from "node:sqlite";
import type { DashboardSummary, TokenAnalytics } from "./types.js";

export function createDashboardQueries(db: DatabaseSync) {
  const totalSessionsStmt = db.prepare("SELECT COUNT(*) as count FROM sessions");
  const activeSessionsStmt = db.prepare(
    "SELECT COUNT(*) as count FROM sessions WHERE status NOT IN ('completed', 'failed', 'stopped')",
  );
  const totalAgentsStmt = db.prepare("SELECT COUNT(*) as count FROM agents");
  const totalEventsStmt = db.prepare("SELECT COUNT(*) as count FROM events");
  const totalTokensStmt = db.prepare(`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total
    FROM token_usage
  `);
  const recentSessionsStmt = db.prepare(
    "SELECT id, name, status, model, cwd, started_at FROM sessions ORDER BY started_at DESC LIMIT 10",
  );

  const tokenAnalyticsStmt = db.prepare(`
    SELECT COALESCE(SUM(input_tokens), 0) as totalInput,
      COALESCE(SUM(output_tokens), 0) as totalOutput,
      COALESCE(SUM(cache_read_tokens), 0) as totalCacheRead,
      COALESCE(SUM(cache_write_tokens), 0) as totalCacheWrite
    FROM token_usage
  `);

  const tokenByModelStmt = db.prepare(`
    SELECT model,
      SUM(input_tokens) as inputTokens,
      SUM(output_tokens) as outputTokens,
      COUNT(DISTINCT session_id) as sessions
    FROM token_usage
    WHERE model IS NOT NULL
    GROUP BY model
    ORDER BY SUM(input_tokens + output_tokens) DESC
  `);

  const tokenByDayStmt = db.prepare(`
    SELECT DATE(t.created_at) as day,
      SUM(t.input_tokens) as inputTokens,
      SUM(t.output_tokens) as outputTokens
    FROM token_usage t
    WHERE t.created_at IS NOT NULL
    GROUP BY DATE(t.created_at)
    ORDER BY day DESC
    LIMIT 30
  `);

  return {
    getSummary(): DashboardSummary {
      const totalSessions = (totalSessionsStmt.get() as { count: number }).count;
      const activeSessions = (activeSessionsStmt.get() as { count: number }).count;
      const totalAgents = (totalAgentsStmt.get() as { count: number }).count;
      const totalEvents = (totalEventsStmt.get() as { count: number }).count;
      const totalTokens = (totalTokensStmt.get() as { total: number }).total;
      const recentSessions = recentSessionsStmt.all() as Array<{
        id: string;
        name: string | null;
        status: string;
        model: string | null;
        cwd: string | null;
        started_at: string | null;
      }>;

      return {
        totalSessions,
        activeSessions,
        totalAgents,
        totalEvents,
        totalTokens,
        recentSessions: recentSessions.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          model: s.model,
          cwd: s.cwd,
          startedAt: s.started_at,
        })),
      };
    },

    getTokenAnalytics(): TokenAnalytics {
      const totals = tokenAnalyticsStmt.get() as { totalInput: number; totalOutput: number; totalCacheRead: number; totalCacheWrite: number };
      const byModel = tokenByModelStmt.all() as Array<{ model: string; inputTokens: number; outputTokens: number; sessions: number }>;
      const byDay = tokenByDayStmt.all() as Array<{ day: string; inputTokens: number; outputTokens: number }>;

      return {
        totalInputTokens: totals.totalInput,
        totalOutputTokens: totals.totalOutput,
        totalCacheReadTokens: totals.totalCacheRead,
        totalCacheWriteTokens: totals.totalCacheWrite,
        byModel,
        byDay,
      };
    },
  };
}
