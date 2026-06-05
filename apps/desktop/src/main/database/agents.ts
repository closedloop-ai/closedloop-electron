import type { DatabaseSync } from "node:sqlite";
import type { AgentRow, AgentHierarchyNode } from "../../shared/agent-db-contract.js";

// Read-only agent store; writes are owned by `lifecycle.ts`.
export function createAgentStore(db: DatabaseSync) {
  const getBySessionStmt = db.prepare(
    "SELECT * FROM agents WHERE session_id = ? ORDER BY started_at ASC",
  );

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
    getBySession(sessionId: string): AgentRow[] {
      return rowsToList(getBySessionStmt.all(sessionId) as Record<string, unknown>[]);
    },

    getBySessionWithChildren(
      sessionId: string,
      eventStore: {
        getBySession: (sid: string) => {
          agentId: string | null;
          eventType: string;
          toolName: string | null;
          summary: string | null;
          createdAt: string | null;
        }[];
      },
    ): AgentHierarchyNode[] {
      const raws = getBySessionWithChildrenStmt.all(sessionId) as Record<string, unknown>[];
      const allAgents = raws.map((r) => toRow(r)!);

      // Fetch the session's events once, then bucket by agent id (the prior
      // implementation re-queried events per agent).
      const eventsByAgent = new Map<string, AgentHierarchyNode["events"]>();
      for (const e of eventStore.getBySession(sessionId)) {
        if (!e.agentId) continue;
        const list = eventsByAgent.get(e.agentId) ?? [];
        list.push({
          eventType: e.eventType,
          toolName: e.toolName,
          summary: e.summary,
          createdAt: e.createdAt,
        });
        eventsByAgent.set(e.agentId, list);
      }

      const agentMap = new Map<string, AgentHierarchyNode>();
      const roots: AgentHierarchyNode[] = [];

      for (const agent of allAgents) {
        agentMap.set(agent.id, {
          agentId: agent.id,
          name: agent.name,
          type: agent.type,
          subagentType: agent.subagentType,
          status: agent.status,
          task: agent.task,
          currentTool: agent.currentTool,
          children: [],
          events: eventsByAgent.get(agent.id) ?? [],
        });
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
