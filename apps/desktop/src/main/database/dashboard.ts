import type { DatabaseSync } from "node:sqlite";
import type { DashboardSummary, TokenAnalytics, AnalyticsData, WorkflowQueryData } from "./types.js";

export function createDashboardQueries(db: DatabaseSync) {
  const totalSessionsStmt = db.prepare("SELECT COUNT(*) as count FROM sessions");
  const activeSessionsStmt = db.prepare(
    "SELECT COUNT(*) as count FROM sessions WHERE status NOT IN ('completed', 'abandoned', 'error')",
  );
  const totalAgentsStmt = db.prepare("SELECT COUNT(*) as count FROM agents");
  const totalEventsStmt = db.prepare("SELECT COUNT(*) as count FROM events");
  const eventTypeCountStmt = db.prepare(
    "SELECT COUNT(DISTINCT event_type) as count FROM events",
  );
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

  // Analytics prepared statements
  const analyticsEventsByTypeStmt = db.prepare(
    "SELECT event_type as eventType, COUNT(*) as count FROM events GROUP BY event_type ORDER BY count DESC",
  );
  const analyticsToolUsageStmt = db.prepare(
    "SELECT tool_name as toolName, COUNT(*) as count FROM events WHERE created_at > datetime('now', '-30 days') AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY count DESC LIMIT 20",
  );
  const analyticsDailyEventsStmt = db.prepare(
    "SELECT DATE(created_at) as date, COUNT(*) as count FROM events WHERE created_at > datetime('now', '-365 days') GROUP BY DATE(created_at) ORDER BY date ASC",
  );
  const analyticsSessionsByStatusStmt = db.prepare(
    "SELECT status, COUNT(*) as count FROM sessions GROUP BY status",
  );
  const analyticsAgentsByStatusStmt = db.prepare(
    "SELECT status, COUNT(*) as count FROM agents GROUP BY status",
  );
  const analyticsAgentsByTypeStmt = db.prepare(
    "SELECT COALESCE(type, 'unknown') as type, COUNT(*) as count FROM agents GROUP BY type ORDER BY count DESC",
  );

  // Workflow prepared statements
  const wfTotalSubagentsStmt = db.prepare(
    "SELECT COUNT(*) as count FROM agents WHERE type = 'subagent' OR parent_agent_id IS NOT NULL",
  );
  const wfCompletedAgentsStmt = db.prepare(
    "SELECT COUNT(*) as count FROM agents WHERE status = 'completed'",
  );
  const wfErrorAgentsStmt = db.prepare(
    "SELECT COUNT(*) as count FROM agents WHERE status = 'failed' OR status = 'error'",
  );
  const wfDepthStmt = db.prepare(`
    WITH RECURSIVE agent_depth(id, session_id, depth) AS (
      SELECT id, session_id, 0 FROM agents WHERE parent_agent_id IS NULL
      UNION ALL
      SELECT a.id, a.session_id, ad.depth + 1
      FROM agents a JOIN agent_depth ad ON a.parent_agent_id = ad.id
    )
    SELECT session_id, MAX(depth) as maxDepth FROM agent_depth GROUP BY session_id
  `);
  const wfDurationStmt = db.prepare(`
    SELECT AVG(CAST((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400 AS REAL)) as avg
    FROM sessions WHERE started_at IS NOT NULL
  `);
  const wfSubagentTypesStmt = db.prepare(`
    SELECT COALESCE(subagent_type, COALESCE(name, 'unknown')) as subagentType,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END) as errors
    FROM agents WHERE parent_agent_id IS NOT NULL OR type = 'subagent'
    GROUP BY subagentType ORDER BY count DESC
  `);
  const wfMainCountStmt = db.prepare(
    "SELECT COUNT(*) as count FROM agents WHERE parent_agent_id IS NULL AND (type IS NULL OR type != 'subagent')",
  );
  const wfEdgesStmt = db.prepare(`
    SELECT COALESCE(p.subagent_type, COALESCE(p.name, 'main')) as source,
      COALESCE(c.subagent_type, COALESCE(c.name, 'unknown')) as target,
      COUNT(*) as weight
    FROM agents c JOIN agents p ON c.parent_agent_id = p.id
    GROUP BY source, target ORDER BY weight DESC LIMIT 50
  `);
  const wfToolTransitionsStmt = db.prepare(`
    WITH recent_tools AS (
      SELECT tool_name, session_id, rowid
      FROM events
      WHERE tool_name IS NOT NULL
        AND created_at > datetime('now', '-7 days')
    ),
    tool_seq AS (
      SELECT tool_name,
        LEAD(tool_name) OVER (PARTITION BY session_id ORDER BY rowid) as next_tool
      FROM recent_tools
    )
    SELECT tool_name as source, next_tool as target, COUNT(*) as value
    FROM tool_seq
    WHERE next_tool IS NOT NULL
    GROUP BY source, target ORDER BY value DESC LIMIT 30
  `);
  const wfCooccurrenceStmt = db.prepare(`
    SELECT COALESCE(a1.subagent_type, COALESCE(a1.name, 'unknown')) as source,
      COALESCE(a2.subagent_type, COALESCE(a2.name, 'unknown')) as target,
      COUNT(DISTINCT a1.session_id) as weight
    FROM agents a1 JOIN agents a2 ON a1.session_id = a2.session_id AND a1.id < a2.id
    GROUP BY source, target ORDER BY weight DESC LIMIT 30
  `);

  return {
    getSummary(): DashboardSummary {
      const totalSessions = (totalSessionsStmt.get() as { count: number }).count;
      const activeSessions = (activeSessionsStmt.get() as { count: number }).count;
      const totalAgents = (totalAgentsStmt.get() as { count: number }).count;
      const totalEvents = (totalEventsStmt.get() as { count: number }).count;
      const eventTypeCount = (eventTypeCountStmt.get() as { count: number }).count;
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
        eventTypeCount,
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

    getAnalytics(): AnalyticsData {
      const tokens = this.getTokenAnalytics();
      const eventsByType = analyticsEventsByTypeStmt.all() as Array<{ eventType: string; count: number }>;
      const toolUsage = analyticsToolUsageStmt.all() as Array<{ toolName: string; count: number }>;
      const dailyEvents = analyticsDailyEventsStmt.all() as Array<{ date: string; count: number }>;
      const sessionsByStatus = analyticsSessionsByStatusStmt.all() as Array<{ status: string; count: number }>;
      const agentsByStatus = analyticsAgentsByStatusStmt.all() as Array<{ status: string; count: number }>;
      const agentsByType = analyticsAgentsByTypeStmt.all() as Array<{ type: string; count: number }>;
      const totalSessions = (totalSessionsStmt.get() as { count: number }).count;
      const totalAgents = (totalAgentsStmt.get() as { count: number }).count;
      const totalEvents = (totalEventsStmt.get() as { count: number }).count;

      return { tokens, eventsByType, toolUsage, dailyEvents, sessionsByStatus, agentsByStatus, agentsByType, totalSessions, totalAgents, totalEvents };
    },

    getWorkflowData(): WorkflowQueryData {
      const totalSessions = (totalSessionsStmt.get() as { count: number }).count;
      const totalAgents = (totalAgentsStmt.get() as { count: number }).count;
      const totalSubagents = (wfTotalSubagentsStmt.get() as { count: number }).count;
      const avgSubagents = totalSessions > 0 ? totalSubagents / totalSessions : 0;

      const completedAgents = (wfCompletedAgentsStmt.get() as { count: number }).count;
      const errorAgents = (wfErrorAgentsStmt.get() as { count: number }).count;
      const successRate = (completedAgents + errorAgents) > 0 ? (completedAgents / (completedAgents + errorAgents)) * 100 : 100;

      const depthRows = wfDepthStmt.all() as Array<{ session_id: string; maxDepth: number }>;
      const avgDepth = depthRows.length > 0 ? depthRows.reduce((s, r) => s + r.maxDepth, 0) / depthRows.length : 0;

      const durationRow = wfDurationStmt.get() as { avg: number | null };
      const avgDurationSec = durationRow.avg ?? 0;

      const subagentTypes = wfSubagentTypesStmt.all() as Array<{ subagentType: string; count: number; completed: number; errors: number }>;
      const mainCount = (wfMainCountStmt.get() as { count: number }).count;
      const edges = wfEdgesStmt.all() as Array<{ source: string; target: string; weight: number }>;
      const outcomes = analyticsSessionsByStatusStmt.all() as Array<{ status: string; count: number }>;
      const toolTransitions = wfToolTransitionsStmt.all() as Array<{ source: string; target: string; value: number }>;
      const toolCounts = analyticsToolUsageStmt.all() as Array<{ toolName: string; count: number }>;
      const cooccurrence = wfCooccurrenceStmt.all() as Array<{ source: string; target: string; weight: number }>;

      const effectiveness = subagentTypes.map((st) => ({
        subagentType: st.subagentType,
        total: st.count,
        completed: st.completed,
        errors: st.errors,
        sessions: 0,
        successRate: st.count > 0 ? (st.completed / st.count) * 100 : 0,
        avgDuration: null as number | null,
        trend: [] as number[],
      }));

      return {
        stats: {
          totalSessions, totalAgents, totalSubagents, avgSubagents,
          successRate, avgDepth, avgDurationSec,
          totalCompactions: 0, avgCompactions: 0,
          topFlow: toolTransitions.length > 0 ? { source: toolTransitions[0].source, target: toolTransitions[0].target, count: toolTransitions[0].value } : null,
        },
        orchestration: {
          sessionCount: totalSessions, mainCount, subagentTypes, edges, outcomes,
          compactions: { total: 0, sessions: 0 },
        },
        toolFlow: { transitions: toolTransitions, toolCounts },
        effectiveness,
        cooccurrence,
      };
    },
  };
}
