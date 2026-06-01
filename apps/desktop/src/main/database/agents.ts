import type { DatabaseSync } from "node:sqlite";
import type { AgentRow, AgentHierarchyNode, HookEventPayload } from "./types.js";

export function createAgentStore(db: DatabaseSync) {
  const insertStmt = db.prepare(`
    INSERT INTO agents (id, session_id, name, type, subagent_type, status, task, current_tool, started_at, updated_at, parent_agent_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE agents SET status = ?, updated_at = ?, ended_at = ? WHERE id = ?
  `);

  const updateStmt = db.prepare(`
    UPDATE agents SET name = ?, task = ?, current_tool = ?, metadata = ?, updated_at = ? WHERE id = ?
  `);

  const getBySessionStmt = db.prepare(
    "SELECT * FROM agents WHERE session_id = ? ORDER BY started_at ASC",
  );
  const getByIdStmt = db.prepare("SELECT * FROM agents WHERE id = ?");

  const getBySessionWithChildrenStmt = db.prepare(`
    SELECT a.*, 
      (SELECT COUNT(*) FROM agents child WHERE child.parent_agent_id = a.id) as children_count
    FROM agents a WHERE a.session_id = ? ORDER BY a.started_at ASC
  `);

  function toRow(raw: Record<string, unknown> | undefined): AgentRow | undefined {
    if (!raw) return undefined;
    return {
      id: raw.id as string,
      sessionId: raw.session_id as string,
      name: (raw.name as string) ?? null,
      type: (raw.type as string) ?? null,
      subagentType: (raw.subagent_type as string) ?? null,
      status: raw.status as string,
      task: (raw.task as string) ?? null,
      currentTool: (raw.current_tool as string) ?? null,
      startedAt: (raw.started_at as string) ?? null,
      updatedAt: (raw.updated_at as string) ?? null,
      endedAt: (raw.ended_at as string) ?? null,
      awaitingInputSince: (raw.awaiting_input_since as string) ?? null,
      parentAgentId: (raw.parent_agent_id as string) ?? null,
      metadata: (raw.metadata as string) ?? null,
    };
  }

  function rowsToList(raws: Record<string, unknown>[]): AgentRow[] {
    return raws.map(toRow).filter(Boolean) as AgentRow[];
  }

  return {
    upsert(payload: HookEventPayload): AgentRow {
      if (!payload.agentId || !payload.sessionId) {
        throw new Error("agentId and sessionId are required");
      }

      const existing = toRow(getByIdStmt.get(payload.agentId) as Record<string, unknown> | undefined);
      const now = new Date().toISOString();

      if (existing) {
        if (payload.status) {
          const endedAt = ["completed", "failed", "stopped"].includes(payload.status) ? now : null;
          updateStatusStmt.run(payload.status, now, endedAt, payload.agentId);
        }
        if (payload.name || payload.task || payload.toolName || payload.metadata) {
          updateStmt.run(
            payload.name ?? existing.name,
            payload.task ?? existing.task,
            payload.toolName ?? existing.currentTool,
            payload.metadata ? JSON.stringify(payload.metadata) : existing.metadata,
            now,
            payload.agentId,
          );
        }
        return toRow(getByIdStmt.get(payload.agentId) as Record<string, unknown>)!;
      }

      insertStmt.run(
        payload.agentId,
        payload.sessionId,
        payload.name ?? null,
        payload.type ?? null,
        payload.subagentType ?? null,
        payload.status ?? "running",
        payload.task ?? null,
        payload.toolName ?? null,
        now,
        now,
        payload.parentAgentId ?? null,
        payload.metadata ? JSON.stringify(payload.metadata) : null,
      );

      return toRow(getByIdStmt.get(payload.agentId) as Record<string, unknown>)!;
    },

    getBySession(sessionId: string): AgentRow[] {
      return rowsToList(getBySessionStmt.all(sessionId) as Record<string, unknown>[]);
    },

    getBySessionWithChildren(sessionId: string, eventStore: { getBySession: (sid: string) => { agentId: string | null; eventType: string; toolName: string | null; summary: string | null; createdAt: string | null }[] }): AgentHierarchyNode[] {
      const raws = getBySessionWithChildrenStmt.all(sessionId) as Record<string, unknown>[];
      const allAgents = raws.map((r) => ({
        ...toRow(r)!,
        childrenCount: r.children_count as number,
      }));

      const agentMap = new Map<string, AgentHierarchyNode>();
      const roots: AgentHierarchyNode[] = [];

      for (const agent of allAgents) {
        const events = eventStore.getBySession(sessionId)
          .filter((e) => e.agentId === agent.id)
          .map((e) => ({
            eventType: e.eventType,
            toolName: e.toolName,
            summary: e.summary,
            createdAt: e.createdAt,
          }));

        const node: AgentHierarchyNode = {
          agentId: agent.id,
          name: agent.name,
          type: agent.type,
          subagentType: agent.subagentType,
          status: agent.status,
          task: agent.task,
          currentTool: agent.currentTool,
          children: [],
          events,
        };
        agentMap.set(agent.id, node);
      }

      for (const agent of allAgents) {
        const node = agentMap.get(agent.id)!;
        if (agent.parentAgentId && agentMap.has(agent.parentAgentId)) {
          agentMap.get(agent.parentAgentId)!.children.push(node);
        } else {
          roots.push(node);
        }
      }

      return roots;
    },
  };
}
