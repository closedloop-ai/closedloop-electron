import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { gatewayLog } from "./gateway-logger.js";

const TAG = "symphony-web-poc";
const HOST = "127.0.0.1";
const WEB_HOST = "localhost";
const DEFAULT_WEB_PORT = 3300;
const DEFAULT_API_PORT = 3302;
const WEB_READY_TIMEOUT_MS = 120_000;
const READY_POLL_INTERVAL_MS = 750;
const SPAWNED_WEB_STOP_TIMEOUT_MS = 3_000;
const DEMO_SEED_DOCUMENT_IDS = [
  "PRD-407",
  "PRD-415",
  "PRD-353",
  "PRD-357",
  "PRD-369",
  "PRD-409",
  "PRD-350",
  "PRD-383",
  "PRD-400",
  "PRD-288",
  "PRD-307",
  "PRD-380",
  "PRD-295",
  "PRD-395",
  "PRD-283",
  "PRD-260",
  "PRD-268",
  "PRD-262",
  "PRD-361",
  "PRD-294",
  "FEA-1469",
  "PLN-776",
];
const DEMO_SEED_WORKSTREAM_IDS = ["WRK-symphony-web-poc"];
const DEMO_SEED_PROJECT_IDS = ["PRO-desktop-strategy"];

type RuntimeMode = "local-poc" | "external-url" | "spawned-next";

type RuntimeEnv = Partial<Record<string, string | undefined>>;

export interface SymphonyWebPocStatus {
  enabled: boolean;
  ready: boolean;
  mode: RuntimeMode | null;
  url: string | null;
  apiUrl: string | null;
  apiToken: string | null;
  dbPath: string | null;
  error: string | null;
  source: string | null;
  counts: {
    projects: number;
    workstreams: number;
    documents: number;
  };
}

export interface SymphonyWebPocRuntimeOptions {
  dataDir: string;
  env?: RuntimeEnv;
  appDirCandidates?: string[];
}

type CountRow = { count: number };
type ProjectRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  priority: string;
  status: string;
  slug: string | null;
  created_at: string;
  updated_at: string;
};
type WorkstreamRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  type: string;
  state: string;
  priority: string;
  slug: string | null;
  created_at: string;
  updated_at: string;
};
type DocumentRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  workstream_id: string | null;
  assignee_id: string | null;
  type: string;
  title: string;
  slug: string;
  status: string;
  priority: string;
  content: string;
  created_at: string;
  updated_at: string;
};
type AgentMonitorSessionFilters = {
  startDate?: string;
  endDate?: string;
  harness?: string;
  status?: string;
  userId?: string;
  teamId?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
};
type AgentMonitorSchema = {
  sessions: Set<string>;
  agents: Set<string>;
  events: Set<string>;
  tokenUsage: Set<string>;
  modelPricing: Set<string>;
};
type AgentMonitorSessionRow = {
  id: string;
  name: string | null;
  status: string;
  cwd: string | null;
  model: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  awaiting_input_since: string | null;
  metadata: string | null;
  harness: string | null;
  agent_count: number;
  tool_use_count: number;
  error_count: number;
};
type AgentMonitorSessionCursorRow = {
  id: string;
  harness: string | null;
  updated_at: string;
};
type AgentMonitorAgentRow = {
  id: string;
  session_id: string;
  name: string;
  type: string;
  subagent_type: string | null;
  status: string;
  task: string | null;
  current_tool: string | null;
  started_at: string | null;
  updated_at: string | null;
  ended_at: string | null;
  awaiting_input_since: string | null;
  parent_agent_id: string | null;
  metadata: string | null;
};
type AgentMonitorCatalogRow = {
  id: string;
  name: string;
  slug: string;
  role: string;
  description: string;
  enabled: boolean;
  sourceRepo: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  prompt: string;
  runCount: number;
  sessionCount: number;
};
type AgentMonitorEventRow = {
  id: number;
  session_id: string;
  agent_id: string | null;
  event_type: string;
  tool_name: string | null;
  summary: string | null;
  data: string | null;
  created_at: string;
};
type AgentMonitorTokenRow = {
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};
type AgentMonitorPricingRow = {
  model_pattern: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_per_mtok: number;
};
type AgentSessionTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCost: number;
};

class SymphonyWebPocStore {
  private readonly db: DatabaseSync;
  private computePreferenceMode = "CLOUD";

  constructor(
    readonly dbPath: string,
    private readonly agentMonitorDbPath: string,
  ) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  getCounts(): SymphonyWebPocStatus["counts"] {
    return {
      projects: this.count("projects"),
      workstreams: this.count("workstreams"),
      documents: this.count("documents"),
    };
  }

  getCurrentUser(): Record<string, unknown> {
    return {
      id: "desktop-user",
      clerkId: "desktop-clerk-user",
      organizationId: "desktop-org",
      email: "andrew.eye@closedloop.ai",
      firstName: "Andrew",
      lastName: "Eye",
      avatarUrl: null,
      phoneNumber: null,
      role: "ENGINEER",
      linearId: null,
      slackId: null,
      githubUsername: "aeyeCEO",
      active: true,
      createdAt: this.seedNow(),
      updatedAt: this.seedNow(),
    };
  }

  listUsers(): Array<Record<string, unknown>> {
    return [this.getCurrentUser()];
  }

  getUser(id: string): Record<string, unknown> | null {
    return id === "desktop-user" ? this.getCurrentUser() : null;
  }

  getCurrentOrganization(): Record<string, unknown> {
    return {
      id: "desktop-org",
      name: "ClosedLoop",
      slug: "closedloop-ai",
    };
  }

  listTeams(): Array<Record<string, unknown>> {
    return [];
  }

  getTeam(id: string): Record<string, unknown> | null {
    void id;
    return null;
  }

  listTeamMembers(teamId: string): Array<Record<string, unknown>> {
    void teamId;
    return [];
  }

  listTeamRepositories(teamId: string): Array<Record<string, unknown>> {
    void teamId;
    return [];
  }

  getDashboardStats(): Record<string, unknown> {
    const prds = this.countDocumentsByType("PRD");
    const features = this.countDocumentsByType("FEATURE");
    const plans = this.countDocumentsByType("IMPLEMENTATION_PLAN");
    return {
      prds: this.metric(prds),
      features: this.metric(features),
      plans: this.metric(plans),
      landedCode: this.metric(0),
      agenticWorkflows: this.metric(this.count("workstreams")),
      agentsCount: 0,
      leaderboardsCount: 0,
    };
  }

  listWorkstreams(filters: { projectId?: string } = {}): Array<Record<string, unknown>> {
    const where: string[] = [];
    const args: string[] = [];
    if (filters.projectId) {
      where.push("project_id = ?");
      args.push(filters.projectId);
    }
    const rows = this.db
      .prepare(
        `
          SELECT id, project_id, title, description, type, state, priority, slug, created_at, updated_at
          FROM workstreams
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY created_at DESC
        `,
      )
      .all(...args) as WorkstreamRow[];
    return rows.map((row) => this.toWorkstream(row));
  }

  createWorkstream(input: Record<string, unknown>): Record<string, unknown> | null {
    const projectId = stringValue(input.projectId);
    const title = stringValue(input.title);
    if (!projectId || !title || !this.getProjectRowById(projectId)) {
      return null;
    }
    const now = this.now();
    const id = this.generateId("WRK");
    this.db
      .prepare(
        `
          INSERT INTO workstreams
            (id, project_id, title, description, type, state, priority, slug, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        projectId,
        title,
        stringValue(input.description),
        stringValue(input.type) ?? "FEATURE_DELIVERY",
        "INITIATED",
        normalizePriority(stringValue(input.priority)),
        this.makeUniqueSlug("workstreams", stringValue(input.slug) ?? title),
        now,
        now,
      );
    return this.getWorkstream(id);
  }

  getWorkstream(id: string): Record<string, unknown> | null {
    const row = this.getWorkstreamRowById(id);
    return row ? this.toWorkstream(row) : null;
  }

  updateWorkstream(id: string, input: Record<string, unknown>): Record<string, unknown> | null {
    const existing = this.getWorkstreamRowById(id);
    if (!existing) {
      return null;
    }
    this.db
      .prepare(
        `
          UPDATE workstreams
          SET title = ?, description = ?, type = ?, state = ?, priority = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        stringValue(input.title) ?? existing.title,
        input.description === null ? null : (stringValue(input.description) ?? existing.description),
        stringValue(input.type) ?? existing.type,
        stringValue(input.state) ?? existing.state,
        normalizePriority(stringValue(input.priority) ?? existing.priority),
        this.now(),
        existing.id,
      );
    return this.getWorkstream(existing.id);
  }

  deleteWorkstream(id: string): Record<string, unknown> | null {
    const existing = this.getWorkstreamRowById(id);
    if (!existing) {
      return null;
    }
    this.db.prepare("DELETE FROM documents WHERE workstream_id = ?").run(existing.id);
    this.db.prepare("DELETE FROM workstreams WHERE id = ?").run(existing.id);
    return { deleted: true };
  }

  listProjects(options: { excludeStatus?: string[]; limit?: number; status?: string[]; teamId?: string } = {}): Array<Record<string, unknown>> {
    const where: string[] = [];
    const args: string[] = [];
    void options.teamId;
    if (options.status?.length) {
      where.push(`projects.status IN (${options.status.map(() => "?").join(", ")})`);
      args.push(...options.status);
    }
    if (options.excludeStatus?.length) {
      where.push(`projects.status NOT IN (${options.excludeStatus.map(() => "?").join(", ")})`);
      args.push(...options.excludeStatus);
    }
    const rows = this.db
      .prepare(
        `
          SELECT projects.id, projects.organization_id, projects.name, projects.description, projects.priority, projects.status, projects.slug, projects.created_at, projects.updated_at
          FROM projects
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY projects.created_at DESC
          LIMIT ?
        `,
      )
      .all(...args, options.limit ?? 100) as ProjectRow[];
    return rows.map((row) => this.toProject(row));
  }

  createProject(input: Record<string, unknown>): Record<string, unknown> | null {
    const name = stringValue(input.name);
    if (!name) {
      return null;
    }
    const now = this.now();
    const id = this.generateId("PRO");
    this.db
      .prepare(
        `
          INSERT INTO projects
            (id, organization_id, name, description, priority, status, slug, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        "desktop-org",
        name,
        stringValue(input.description),
        normalizePriority(stringValue(input.priority)),
        stringValue(input.status) ?? "NOT_STARTED",
        this.makeUniqueSlug("projects", stringValue(input.slug) ?? name),
        now,
        now,
      );
    return this.getProject(id);
  }

  getProject(idOrSlug: string): Record<string, unknown> | null {
    const row = this.db
      .prepare(
        `
          SELECT id, organization_id, name, description, priority, status, slug, created_at, updated_at
          FROM projects
          WHERE id = ? OR slug = ?
          LIMIT 1
        `,
      )
      .get(idOrSlug, idOrSlug) as ProjectRow | undefined;
    return row ? this.toProject(row) : null;
  }

  updateProject(idOrSlug: string, input: Record<string, unknown>): Record<string, unknown> | null {
    const existing = this.getProjectRowByIdOrSlug(idOrSlug);
    if (!existing) {
      return null;
    }
    this.db
      .prepare(
        `
          UPDATE projects
          SET name = ?, description = ?, priority = ?, status = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        stringValue(input.name) ?? existing.name,
        input.description === null ? null : (stringValue(input.description) ?? existing.description),
        normalizePriority(stringValue(input.priority) ?? existing.priority),
        stringValue(input.status) ?? existing.status,
        this.now(),
        existing.id,
      );
    return this.getProject(existing.id);
  }

  deleteProject(idOrSlug: string): Record<string, unknown> | null {
    const existing = this.getProjectRowByIdOrSlug(idOrSlug);
    if (!existing) {
      return null;
    }
    this.db.prepare("DELETE FROM documents WHERE project_id = ?").run(existing.id);
    this.db.prepare("DELETE FROM workstreams WHERE project_id = ?").run(existing.id);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(existing.id);
    return { deleted: true };
  }

  getProjectTree(projectId: string): Record<string, unknown> {
    const documents = this.listDocuments({ projectId });
    return {
      nodes: documents.map((document) => ({
        root: this.toArtifact(document),
        children: [],
      })),
      externalParents: [],
    };
  }

  listDocuments(filters: { assigneeId?: string; projectId?: string; type?: string } = {}): Array<Record<string, unknown>> {
    const where: string[] = [];
    const args: string[] = [];
    if (filters.assigneeId) {
      where.push("assignee_id = ?");
      args.push(filters.assigneeId);
    }
    if (filters.projectId) {
      where.push("project_id = ?");
      args.push(filters.projectId);
    }
    if (filters.type) {
      where.push("type = ?");
      args.push(filters.type);
    }
    const sql = `
      SELECT id, organization_id, project_id, workstream_id, assignee_id, type, title, slug, status, priority, content, created_at, updated_at
      FROM documents
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC
    `;
    const rows = this.db.prepare(sql).all(...args) as DocumentRow[];
    return rows.map((row) => this.toDocumentWithRelations(row));
  }

  getDocument(idOrSlug: string): Record<string, unknown> | null {
    const row = this.db
      .prepare(
        `
          SELECT id, organization_id, project_id, workstream_id, assignee_id, type, title, slug, status, priority, content, created_at, updated_at
          FROM documents
          WHERE id = ? OR slug = ?
          LIMIT 1
        `,
      )
      .get(idOrSlug, idOrSlug) as DocumentRow | undefined;
    return row ? this.toDocumentDetail(row) : null;
  }

  createDocument(input: Record<string, unknown>): Record<string, unknown> | null {
    const projectId = stringValue(input.projectId);
    const title = stringValue(input.title);
    const type = stringValue(input.type);
    const content = stringValue(input.content);
    if (!projectId || !title || !type || content === null || !this.getProjectRowById(projectId)) {
      return null;
    }
    const workstreamId = stringValue(input.workstreamId);
    if (workstreamId && !this.getWorkstreamRowById(workstreamId)) {
      return null;
    }
    const now = this.now();
    const prefix = documentPrefix(type);
    const id = this.generateId(prefix);
    this.db
      .prepare(
        `
          INSERT INTO documents
            (id, organization_id, project_id, workstream_id, assignee_id, type, title, slug, status, priority, content, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        "desktop-org",
        projectId,
        workstreamId,
        stringValue(input.assigneeId),
        type,
        title,
        this.makeUniqueSlug("documents", `${prefix}-${slugify(title) || id}`),
        stringValue(input.status) ?? "DRAFT",
        normalizePriority(stringValue(input.priority)),
        content,
        now,
        now,
      );
    return this.getDocument(id);
  }

  updateDocument(idOrSlug: string, input: Record<string, unknown>): Record<string, unknown> | null {
    const existing = this.getDocumentRowByIdOrSlug(idOrSlug);
    if (!existing) {
      return null;
    }
    const projectId = stringValue(input.projectId) ?? existing.project_id;
    if (projectId && !this.getProjectRowById(projectId)) {
      return null;
    }
    const workstreamId = input.workstreamId === null
      ? null
      : (stringValue(input.workstreamId) ?? existing.workstream_id);
    if (workstreamId && !this.getWorkstreamRowById(workstreamId)) {
      return null;
    }
    this.db
      .prepare(
        `
          UPDATE documents
          SET project_id = ?, workstream_id = ?, assignee_id = ?, type = ?, title = ?, status = ?, priority = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        projectId,
        workstreamId,
        input.assigneeId === null ? null : (stringValue(input.assigneeId) ?? existing.assignee_id),
        stringValue(input.type) ?? existing.type,
        stringValue(input.title) ?? existing.title,
        stringValue(input.status) ?? existing.status,
        normalizePriority(stringValue(input.priority) ?? existing.priority),
        this.now(),
        existing.id,
      );
    return this.getDocument(existing.id);
  }

  deleteDocument(idOrSlug: string): Record<string, unknown> | null {
    const existing = this.getDocumentRowByIdOrSlug(idOrSlug);
    if (!existing) {
      return null;
    }
    this.db.prepare("DELETE FROM documents WHERE id = ?").run(existing.id);
    return { deleted: true };
  }

  listDocumentVersions(idOrSlug: string): Array<Record<string, unknown>> | null {
    const row = this.getDocumentRowByIdOrSlug(idOrSlug);
    if (!row) {
      return null;
    }
    return [
      {
        id: `${row.id}:v1`,
        documentId: row.id,
        version: 1,
        content: row.content,
        createdById: "desktop-user",
        createdAt: row.created_at,
      },
    ];
  }

  createDocumentVersion(idOrSlug: string, input: Record<string, unknown>): Record<string, unknown> | null {
    const row = this.getDocumentRowByIdOrSlug(idOrSlug);
    const content = stringValue(input.content);
    if (!row || content === null) {
      return null;
    }
    this.db
      .prepare("UPDATE documents SET content = ?, updated_at = ? WHERE id = ?")
      .run(content, this.now(), row.id);
    return this.getDocument(row.id);
  }

  getFavoriteProjects(): Array<Record<string, unknown>> {
    return this.listProjects({ limit: 4 });
  }

  getOnboardingStatus(): Record<string, unknown> {
    const checklist = [
      "CREATE_PROJECT",
      "CREATE_DOCUMENT",
      "EDIT_MARKDOWN",
      "CONFIGURE_LOCAL_FILES",
    ].map((id) => ({
      id,
      label: id
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      description: "Already satisfied in the desktop-local runtime.",
      completed: true,
    }));
    return {
      wizardCompleted: true,
      checklistDismissed: true,
      checklist,
    };
  }

  listAgents(filters: { enabled?: string; search?: string } = {}): Record<string, unknown> {
    const agents = this.listLocalAgentCatalog(filters).map((agent) => this.toAgentSummary(agent));
    return {
      agents,
      total: agents.length,
    };
  }

  getAgent(idOrSlug: string): Record<string, unknown> | null {
    const agent = this.findLocalAgentCatalogEntry(idOrSlug);
    if (!agent) {
      return null;
    }
    return this.toAgentDetail(agent);
  }

  listAgentVersions(idOrSlug: string): Record<string, unknown> | null {
    const agent = this.findLocalAgentCatalogEntry(idOrSlug);
    if (!agent) {
      return null;
    }
    return {
      versions: [this.toAgentVersionSummary(agent)],
    };
  }

  getAgentVersion(idOrSlug: string, version: number): Record<string, unknown> | null {
    const agent = this.findLocalAgentCatalogEntry(idOrSlug);
    if (!agent || version !== 1) {
      return null;
    }
    return {
      ...this.toAgentVersionSummary(agent),
      prompt: agent.prompt,
    };
  }

  getGitHubIntegrationStatus(): Record<string, unknown> {
    return { connected: false };
  }

  listComputeTargets(): Array<Record<string, unknown>> {
    const now = this.seedNow();
    return [
      {
        id: "desktop-local-target",
        organizationId: "desktop-org",
        userId: "desktop-user",
        name: "Desktop Local",
        machineName: "Desktop Local",
        platform: process.platform,
        gatewayId: "desktop-poc-gateway",
        capabilities: {},
        supportedOperations: [],
        isOnline: true,
        isSharedWithOrg: false,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  getComputePreference(): Record<string, unknown> {
    return {
      preferredComputeMode: this.computePreferenceMode,
      computeTargetId:
        this.computePreferenceMode === "LOCAL" ? "desktop-local-target" : undefined,
      isExplicit: true,
    };
  }

  setComputePreference(mode: unknown): Record<string, unknown> {
    if (mode === "LOCAL" || mode === "CLOUD") {
      this.computePreferenceMode = mode;
    }
    return this.getComputePreference();
  }

  getLoopSummaries(documentIds: string[]): Record<string, unknown> {
    return Object.fromEntries(
      documentIds.map((documentId) => [
        documentId,
        {
          activeLoop: null,
          latestCompleted: null,
          latestFailed: null,
        },
      ]),
    );
  }

  listAgentSessions(filters: AgentMonitorSessionFilters): Record<string, unknown> {
    return this.withAgentMonitorDb<Record<string, unknown>>(
      { items: [], total: 0, viewerScope: "self" },
      (db, schema) => {
        const limit = Math.min(filters.limit ?? 25, 100);
        const offset = Math.max(filters.offset ?? 0, 0);
        const { whereSql, args } = this.buildAgentMonitorSessionWhere(filters);
        const totalRow = db
          .prepare(`SELECT COUNT(*) AS count FROM sessions s ${whereSql}`)
          .get(...args) as CountRow;
        const rows = db
          .prepare(
            `
              ${this.agentMonitorSessionSelectSql(schema)}
              ${whereSql}
              ORDER BY updated_at DESC, started_at DESC, id DESC
              LIMIT ? OFFSET ?
            `,
          )
          .all(...args, limit, offset) as AgentMonitorSessionRow[];
        const tokenRows = this.listAgentMonitorTokenRows(
          db,
          schema,
          rows.map((row) => row.id),
        );
        const tokenRowsBySessionId = groupRowsBySessionId(tokenRows);
        const pricingRows = this.listAgentMonitorPricingRows(db, schema);

        return {
          items: rows.map((row) =>
            this.toAgentSessionListItem(
              row,
              this.toAgentSessionTokenUsage(
                tokenRowsBySessionId.get(row.id) ?? [],
                pricingRows,
              ),
            ),
          ),
          total: Number(totalRow.count) || 0,
          viewerScope: "self",
        };
      },
    );
  }

  getAgentSessionDetail(id: string): Record<string, unknown> | null {
    return this.withAgentMonitorDb<Record<string, unknown> | null>(null, (db, schema) => {
      const row = db
        .prepare(
          `
            ${this.agentMonitorSessionSelectSql(schema)}
            WHERE s.id = ?
            LIMIT 1
          `,
        )
        .get(id) as AgentMonitorSessionRow | undefined;
      if (!row) {
        return null;
      }

      const tokenUsageByModel = this.toAgentSessionTokenUsage(
        this.listAgentMonitorTokenRows(db, schema, [row.id]),
        this.listAgentMonitorPricingRows(db, schema),
      );
      return {
        ...this.toAgentSessionListItem(row, tokenUsageByModel),
        metadata: parseJsonObjectText(row.metadata),
        sourceArtifactId: this.resolveAgentSessionAttribution(row).sourceArtifactId,
        sourceLoopId: this.resolveAgentSessionAttribution(row).sourceLoopId,
        tokenUsageByModel,
        attribution: this.resolveAgentSessionAttribution(row),
        agents: this.listAgentMonitorAgents(db, schema, row.id),
        events: this.listAgentMonitorEvents(db, schema, row.id),
      };
    });
  }

  getAgentSessionUsage(filters: AgentMonitorSessionFilters): Record<string, unknown> {
    return this.withAgentMonitorDb<Record<string, unknown>>(this.emptyAgentSessionUsage(), (db, schema) => {
      const { whereSql, args } = this.buildAgentMonitorSessionWhere(filters);
      const rows = db
        .prepare(
          `
            SELECT
              s.id AS id,
              ${this.agentMonitorHarnessExpr(schema)} AS harness,
              ${this.agentMonitorUpdatedAtExpr(schema)} AS updated_at
            FROM sessions s
            ${whereSql}
            ORDER BY updated_at DESC, id DESC
          `,
        )
        .all(...args) as AgentMonitorSessionCursorRow[];
      const tokenRows = this.listAgentMonitorTokenRows(
        db,
        schema,
        rows.map((row) => row.id),
      );
      const pricingRows = this.listAgentMonitorPricingRows(db, schema);
      const tokenRowsBySessionId = groupRowsBySessionId(tokenRows);
      const total: AgentSessionTotals = emptyAgentSessionTotals();
      const harnessGroups = new Map<string, AgentSessionTotals & { sessionCount: number }>();
      const modelGroups = new Map<string, AgentSessionTotals & { sessionIds: Set<string> }>();

      for (const row of rows) {
        const harness = normalizeAgentSessionHarness(row.harness);
        const tokenUsage = this.toAgentSessionTokenUsage(
          tokenRowsBySessionId.get(row.id) ?? [],
          pricingRows,
        );
        const sessionTotals = sumAgentSessionTokenUsage(tokenUsage);
        addAgentSessionTotals(total, sessionTotals);

        const harnessGroup = harnessGroups.get(harness) ?? {
          ...emptyAgentSessionTotals(),
          sessionCount: 0,
        };
        harnessGroup.sessionCount += 1;
        addAgentSessionTotals(harnessGroup, sessionTotals);
        harnessGroups.set(harness, harnessGroup);
      }

      for (const tokenRow of tokenRows) {
        const usage = this.toAgentSessionTokenUsage([tokenRow], pricingRows)[0];
        if (!usage) {
          continue;
        }
        const model = typeof usage.model === "string" && usage.model.trim()
          ? usage.model
          : "unknown";
        const modelGroup = modelGroups.get(model) ?? {
          ...emptyAgentSessionTotals(),
          sessionIds: new Set<string>(),
        };
        modelGroup.sessionIds.add(tokenRow.session_id);
        addAgentSessionTotals(modelGroup, sumAgentSessionTokenUsage([usage]));
        modelGroups.set(model, modelGroup);
      }

      const latestUpdatedAt = rows.reduce<string | null>(
        (latest, row) => (latest && latest > row.updated_at ? latest : row.updated_at),
        null,
      );
      const user = this.toBasicUser();

      return {
        viewerScope: "self",
        totalSessions: rows.length,
        totalInputTokens: total.inputTokens,
        totalOutputTokens: total.outputTokens,
        totalCacheReadTokens: total.cacheReadTokens,
        totalCacheWriteTokens: total.cacheWriteTokens,
        totalEstimatedCost: total.estimatedCost,
        byUser: rows.length
          ? [
              {
                userId: user.id,
                userName: "Andrew Eye",
                userEmail: user.email,
                userAvatarUrl: user.avatarUrl,
                sessionCount: rows.length,
                inputTokens: total.inputTokens,
                outputTokens: total.outputTokens,
                cacheReadTokens: total.cacheReadTokens,
                cacheWriteTokens: total.cacheWriteTokens,
                estimatedCost: total.estimatedCost,
              },
            ]
          : [],
        byModel: [...modelGroups.entries()]
          .map(([model, group]) => ({
            model,
            sessionCount: group.sessionIds.size,
            inputTokens: group.inputTokens,
            outputTokens: group.outputTokens,
            cacheReadTokens: group.cacheReadTokens,
            cacheWriteTokens: group.cacheWriteTokens,
            estimatedCost: group.estimatedCost,
          }))
          .sort((left, right) => right.estimatedCost - left.estimatedCost),
        byHarness: [...harnessGroups.entries()]
          .map(([harness, group]) => ({
            harness,
            sessionCount: group.sessionCount,
            inputTokens: group.inputTokens,
            outputTokens: group.outputTokens,
            cacheReadTokens: group.cacheReadTokens,
            cacheWriteTokens: group.cacheWriteTokens,
            estimatedCost: group.estimatedCost,
          }))
          .sort((left, right) => right.sessionCount - left.sessionCount),
        lastSyncTargets: [
          {
            computeTargetId: "desktop-local-target",
            machineName: "Desktop Local",
            isOnline: true,
            lastSeenAt: new Date().toISOString(),
            lastAgentSessionSyncAt: latestUpdatedAt,
            owner: user,
          },
        ],
      };
    });
  }

  private listLocalAgentCatalog(
    filters: { enabled?: string; search?: string } = {},
  ): AgentMonitorCatalogRow[] {
    if (filters.enabled === "false") {
      return [];
    }
    const search = filters.search?.trim().toLowerCase();
    const agents = this.withAgentMonitorDb<AgentMonitorCatalogRow[]>(
      [],
      (db, schema) => {
        if (!schema.agents.has("session_id")) {
          return [];
        }
        const updatedAtExpr = schema.agents.has("updated_at")
          ? "a.updated_at"
          : "COALESCE(a.ended_at, a.started_at)";
        const roleExpr = "COALESCE(NULLIF(a.subagent_type, ''), NULLIF(a.type, ''), 'agent')";
        const rows = db
          .prepare(
            `
              SELECT
                LOWER(${roleExpr}) AS role_key,
                CASE
                  WHEN LOWER(COALESCE(a.type, '')) = 'main' THEN 'Main Agent'
                  ELSE COALESCE(NULLIF(a.name, ''), NULLIF(a.subagent_type, ''), 'Subagent')
                END AS name,
                ${roleExpr} AS role,
                COUNT(*) AS run_count,
                COUNT(DISTINCT a.session_id) AS session_count,
                MIN(a.started_at) AS created_at,
                MAX(${updatedAtExpr}) AS updated_at
              FROM agents a
              GROUP BY LOWER(${roleExpr})
              ORDER BY updated_at DESC, name ASC
            `,
          )
          .all() as Array<{
            role_key: string | null;
            name: string | null;
            role: string | null;
            run_count: number;
            session_count: number;
            created_at: string | null;
            updated_at: string | null;
          }>;

        return rows.map((row) => this.toLocalAgentCatalogRow(row));
      },
    );
    if (!search) {
      return agents;
    }
    return agents.filter((agent) =>
      [agent.name, agent.role, agent.description, agent.sourceRepo]
        .some((value) => value.toLowerCase().includes(search)),
    );
  }

  private findLocalAgentCatalogEntry(idOrSlug: string): AgentMonitorCatalogRow | null {
    return this.listLocalAgentCatalog().find(
      (agent) => agent.id === idOrSlug || agent.slug === idOrSlug,
    ) ?? null;
  }

  private toLocalAgentCatalogRow(row: {
    role_key: string | null;
    name: string | null;
    role: string | null;
    run_count: number;
    session_count: number;
    created_at: string | null;
    updated_at: string | null;
  }): AgentMonitorCatalogRow {
    const role = normalizeLocalAgentRole(row.role);
    const name = row.name?.trim() || titleCase(role);
    const slug = `local-${slugify(role) || "agent"}`;
    const runCount = Number(row.run_count) || 0;
    const sessionCount = Number(row.session_count) || 0;
    const updatedAt = row.updated_at || this.seedNow();
    const createdAt = row.created_at || updatedAt;
    const description = `Observed ${runCount.toLocaleString()} run${runCount === 1 ? "" : "s"} across ${sessionCount.toLocaleString()} local session${sessionCount === 1 ? "" : "s"} in the Classic desktop monitor.`;
    const prompt = [
      `${name} is a desktop-local agent entry derived from Classic agent-monitor session history.`,
      "",
      `Role: ${role}`,
      `Observed runs: ${runCount.toLocaleString()}`,
      `Observed sessions: ${sessionCount.toLocaleString()}`,
      `Last seen: ${updatedAt}`,
      "",
      "This read-only entry is generated from the local SQLite monitor database so Symphony Desktop can use the standard Agents surface without requiring a team account.",
    ].join("\n");
    return {
      id: `local-agent:${slug}`,
      name,
      slug,
      role,
      description,
      enabled: true,
      sourceRepo: "Local sessions",
      currentVersion: 1,
      createdAt,
      updatedAt,
      prompt,
      runCount,
      sessionCount,
    };
  }

  private toAgentSummary(agent: AgentMonitorCatalogRow): Record<string, unknown> {
    return {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      role: agent.role,
      description: agent.description,
      enabled: agent.enabled,
      sourceRepo: agent.sourceRepo,
      currentVersion: agent.currentVersion,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }

  private toAgentDetail(agent: AgentMonitorCatalogRow): Record<string, unknown> {
    return {
      ...this.toAgentSummary(agent),
      prompt: agent.prompt,
      bootstrapRunId: null,
      createdBy: {
        id: "desktop-user",
        firstName: "Andrew",
        lastName: "Eye",
      },
    };
  }

  private toAgentVersionSummary(agent: AgentMonitorCatalogRow): Record<string, unknown> {
    return {
      id: `${agent.id}:v1`,
      version: 1,
      name: agent.name,
      changeNote: "Derived from local desktop monitor history",
      changedBy: {
        id: "desktop-user",
        firstName: "Andrew",
        lastName: "Eye",
      },
      createdAt: agent.updatedAt,
    };
  }

  private withAgentMonitorDb<T>(
    fallback: T,
    callback: (db: DatabaseSync, schema: AgentMonitorSchema) => T,
  ): T {
    if (!existsSync(this.agentMonitorDbPath)) {
      return fallback;
    }
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(this.agentMonitorDbPath);
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec("PRAGMA query_only = ON");
      const schema = this.readAgentMonitorSchema(db);
      if (!schema.sessions.has("id") || !schema.sessions.has("started_at")) {
        return fallback;
      }
      return callback(db, schema);
    } catch (error) {
      gatewayLog.warn(
        TAG,
        `agent session adapter skipped ${this.agentMonitorDbPath}: ${describeError(error)}`,
      );
      return fallback;
    } finally {
      db?.close();
    }
  }

  private readAgentMonitorSchema(db: DatabaseSync): AgentMonitorSchema {
    return {
      sessions: readTableColumns(db, "sessions"),
      agents: readTableColumns(db, "agents"),
      events: readTableColumns(db, "events"),
      tokenUsage: readTableColumns(db, "token_usage"),
      modelPricing: readTableColumns(db, "model_pricing"),
    };
  }

  private buildAgentMonitorSessionWhere(
    filters: AgentMonitorSessionFilters,
  ): { whereSql: string; args: string[] } {
    const where: string[] = [];
    const args: string[] = [];

    if (filters.startDate && Number.isFinite(Date.parse(filters.startDate))) {
      where.push("s.started_at >= ?");
      args.push(filters.startDate);
    }
    if (filters.endDate && Number.isFinite(Date.parse(filters.endDate))) {
      where.push("s.started_at <= ?");
      args.push(filters.endDate);
    }
    if (filters.harness) {
      where.push("COALESCE(NULLIF(LOWER(s.harness), ''), 'claude') = ?");
      args.push(filters.harness.toLowerCase());
    }
    if (filters.status) {
      where.push("s.status = ?");
      args.push(normalizeAgentSessionStatusFilter(filters.status));
    }
    if (filters.userId && filters.userId !== "desktop-user") {
      where.push("1 = 0");
    }
    if (filters.teamId || filters.projectId) {
      where.push("1 = 0");
    }

    return {
      whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
      args,
    };
  }

  private agentMonitorSessionSelectSql(schema: AgentMonitorSchema): string {
    const agentCountExpr = schema.agents.has("session_id")
      ? "(SELECT COUNT(*) FROM agents a WHERE a.session_id = s.id)"
      : "0";
    const toolUseCountExpr = schema.events.has("session_id")
      ? `
          (SELECT COUNT(*)
           FROM events e
           WHERE e.session_id = s.id
             AND (
               LOWER(e.event_type) = 'tool_use'
               OR COALESCE(NULLIF(e.tool_name, ''), '') != ''
             ))
        `
      : "0";
    const errorCountExpr = schema.events.has("session_id")
      ? `
          (SELECT COUNT(*)
           FROM events e
           WHERE e.session_id = s.id
             AND (
               LOWER(e.event_type) LIKE '%error%'
               OR LOWER(e.event_type) LIKE '%failed%'
               OR LOWER(COALESCE(e.summary, '')) LIKE 'error%'
               OR LOWER(COALESCE(e.summary, '')) LIKE 'failed%'
             ))
        `
      : "0";

    return `
      SELECT
        s.id AS id,
        s.name AS name,
        s.status AS status,
        s.cwd AS cwd,
        s.model AS model,
        s.started_at AS started_at,
        ${this.agentMonitorUpdatedAtExpr(schema)} AS updated_at,
        s.ended_at AS ended_at,
        ${schema.sessions.has("awaiting_input_since") ? "s.awaiting_input_since" : "NULL"} AS awaiting_input_since,
        s.metadata AS metadata,
        ${this.agentMonitorHarnessExpr(schema)} AS harness,
        ${agentCountExpr} AS agent_count,
        ${toolUseCountExpr} AS tool_use_count,
        ${errorCountExpr} AS error_count
      FROM sessions s
    `;
  }

  private agentMonitorUpdatedAtExpr(schema: AgentMonitorSchema): string {
    return schema.sessions.has("updated_at")
      ? "s.updated_at"
      : "COALESCE(s.ended_at, s.started_at)";
  }

  private agentMonitorHarnessExpr(schema: AgentMonitorSchema): string {
    return schema.sessions.has("harness")
      ? "COALESCE(NULLIF(s.harness, ''), 'claude')"
      : "'claude'";
  }

  private listAgentMonitorAgents(
    db: DatabaseSync,
    schema: AgentMonitorSchema,
    sessionId: string,
  ): Array<Record<string, unknown>> {
    if (!schema.agents.has("session_id")) {
      return [];
    }
    const updatedAtExpr = schema.agents.has("updated_at")
      ? "updated_at"
      : "COALESCE(ended_at, started_at)";
    const awaitingInputExpr = schema.agents.has("awaiting_input_since")
      ? "awaiting_input_since"
      : "NULL";
    const rows = db
      .prepare(
        `
          SELECT
            id,
            session_id,
            name,
            type,
            subagent_type,
            status,
            task,
            current_tool,
            started_at,
            ${updatedAtExpr} AS updated_at,
            ended_at,
            ${awaitingInputExpr} AS awaiting_input_since,
            parent_agent_id,
            metadata
          FROM agents
          WHERE session_id = ?
          ORDER BY started_at ASC, id ASC
        `,
      )
      .all(sessionId) as AgentMonitorAgentRow[];
    return rows.map((row) => ({
      externalAgentId: row.id,
      name: row.name,
      type: row.type,
      subagentType: row.subagent_type,
      status: row.status,
      task: row.task,
      currentTool: row.current_tool,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      endedAt: row.ended_at,
      awaitingInputSince: row.awaiting_input_since,
      parentExternalAgentId: row.parent_agent_id,
      metadata: parseJsonObjectText(row.metadata),
    }));
  }

  private listAgentMonitorEvents(
    db: DatabaseSync,
    schema: AgentMonitorSchema,
    sessionId: string,
  ): Array<Record<string, unknown>> {
    if (!schema.events.has("session_id")) {
      return [];
    }
    const rows = db
      .prepare(
        `
          SELECT
            id,
            session_id,
            agent_id,
            event_type,
            tool_name,
            summary,
            data,
            created_at
          FROM events
          WHERE session_id = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(sessionId) as AgentMonitorEventRow[];
    return rows.map((row) => ({
      externalEventId: String(row.id),
      agentExternalId: row.agent_id,
      eventType: row.event_type,
      toolName: row.tool_name,
      summary: row.summary,
      data: parseJsonValueText(row.data),
      createdAt: row.created_at,
    }));
  }

  private listAgentMonitorTokenRows(
    db: DatabaseSync,
    schema: AgentMonitorSchema,
    sessionIds: string[],
  ): AgentMonitorTokenRow[] {
    if (
      sessionIds.length === 0 ||
      !schema.tokenUsage.has("session_id") ||
      !schema.tokenUsage.has("model")
    ) {
      return [];
    }
    const inputExpr = schema.tokenUsage.has("baseline_input")
      ? "input_tokens + baseline_input"
      : "input_tokens";
    const outputExpr = schema.tokenUsage.has("baseline_output")
      ? "output_tokens + baseline_output"
      : "output_tokens";
    const cacheReadExpr = schema.tokenUsage.has("baseline_cache_read")
      ? "cache_read_tokens + baseline_cache_read"
      : "cache_read_tokens";
    const cacheWriteExpr = schema.tokenUsage.has("baseline_cache_write")
      ? "cache_write_tokens + baseline_cache_write"
      : "cache_write_tokens";

    return selectRowsByIds<AgentMonitorTokenRow>(
      db,
      `
        SELECT
          session_id,
          model,
          ${inputExpr} AS input_tokens,
          ${outputExpr} AS output_tokens,
          ${cacheReadExpr} AS cache_read_tokens,
          ${cacheWriteExpr} AS cache_write_tokens
        FROM token_usage
        WHERE session_id IN (__IDS__)
        ORDER BY session_id ASC, model ASC
      `,
      sessionIds,
    );
  }

  private listAgentMonitorPricingRows(
    db: DatabaseSync,
    schema: AgentMonitorSchema,
  ): AgentMonitorPricingRow[] {
    if (!schema.modelPricing.has("model_pattern")) {
      return [];
    }
    return db
      .prepare(
        `
          SELECT
            model_pattern,
            input_per_mtok,
            output_per_mtok,
            cache_read_per_mtok,
            cache_write_per_mtok
          FROM model_pricing
          ORDER BY LENGTH(model_pattern) DESC, model_pattern ASC
        `,
      )
      .all() as AgentMonitorPricingRow[];
  }

  private toAgentSessionTokenUsage(
    rows: AgentMonitorTokenRow[],
    pricingRows: AgentMonitorPricingRow[],
  ): Array<Record<string, unknown>> {
    return rows.map((row) => ({
      model: row.model,
      inputTokens: Number(row.input_tokens) || 0,
      outputTokens: Number(row.output_tokens) || 0,
      cacheReadTokens: Number(row.cache_read_tokens) || 0,
      cacheWriteTokens: Number(row.cache_write_tokens) || 0,
      estimatedCostUsd: estimateAgentSessionTokenCost(row, pricingRows),
    }));
  }

  private toAgentSessionListItem(
    row: AgentMonitorSessionRow,
    tokenUsageByModel: Array<Record<string, unknown>>,
  ): Record<string, unknown> {
    const totals = sumAgentSessionTokenUsage(tokenUsageByModel);
    const attribution = this.resolveAgentSessionAttribution(row);
    return {
      id: row.id,
      externalSessionId: row.id,
      name: row.name,
      status: row.status,
      harness: normalizeAgentSessionHarness(row.harness),
      cwd: row.cwd,
      repositoryFullName: attribution.repositoryFullName,
      worktreePath: attribution.worktreePath,
      model: row.model,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      endedAt: row.ended_at,
      awaitingInputSince: row.awaiting_input_since,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      estimatedCost: totals.estimatedCost,
      agentCount: Number(row.agent_count) || 0,
      toolUseCount: Number(row.tool_use_count) || 0,
      errorCount: Number(row.error_count) || 0,
      issueId: attribution.issueId,
      baseBranch: attribution.baseBranch,
      user: this.toBasicUser(),
      computeTarget: {
        id: "desktop-local-target",
        machineName: "Desktop Local",
        isOnline: true,
        lastSeenAt: new Date().toISOString(),
      },
      project: null,
    };
  }

  private resolveAgentSessionAttribution(row: AgentMonitorSessionRow): {
    repositoryFullName: string | null;
    worktreePath: string | null;
    sourceArtifactId: string | null;
    sourceLoopId: string | null;
    issueId: string | null;
    baseBranch: string | null;
  } {
    const metadata = parseJsonObjectText(row.metadata);
    return {
      repositoryFullName:
        jsonStringValue(metadata, "repositoryFullName") ??
        jsonStringValue(metadata, "repository") ??
        jsonStringValue(metadata, "repoFullName"),
      worktreePath:
        jsonStringValue(metadata, "worktreePath") ??
        jsonStringValue(metadata, "workspacePath") ??
        row.cwd,
      sourceArtifactId:
        jsonStringValue(metadata, "sourceArtifactId") ??
        jsonStringValue(metadata, "artifactId"),
      sourceLoopId:
        jsonStringValue(metadata, "sourceLoopId") ??
        jsonStringValue(metadata, "loopId"),
      issueId:
        jsonStringValue(metadata, "issueId") ??
        jsonStringValue(metadata, "linearIssueId") ??
        jsonStringValue(metadata, "githubIssueId"),
      baseBranch: jsonStringValue(metadata, "baseBranch"),
    };
  }

  private toBasicUser(): Record<string, unknown> {
    const user = this.getCurrentUser();
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
    };
  }

  private emptyAgentSessionUsage(): Record<string, unknown> {
    return {
      viewerScope: "self",
      totalSessions: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalEstimatedCost: 0,
      byUser: [],
      byModel: [],
      byHarness: [],
      lastSyncTargets: [],
    };
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        slug TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workstreams (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        state TEXT NOT NULL,
        priority TEXT NOT NULL,
        slug TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        project_id TEXT,
        workstream_id TEXT,
        assignee_id TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("documents", "assignee_id", "TEXT");
    this.initializeLocalWorkspace();
  }

  private initializeLocalWorkspace(): void {
    this.db
      .prepare("INSERT OR IGNORE INTO organizations (id, slug, name) VALUES (?, ?, ?)")
      .run("desktop-org", "closedloop-ai", "ClosedLoop");
    this.dropMultiplayerTables();
    this.removeDemoSeedData();
  }

  private dropMultiplayerTables(): void {
    this.db.exec(`
      DROP TABLE IF EXISTS project_teams;
      DROP TABLE IF EXISTS team_members;
      DROP TABLE IF EXISTS teams;
    `);
  }

  private removeDemoSeedData(): void {
    this.deleteKnownRows("documents", DEMO_SEED_DOCUMENT_IDS);
    this.deleteKnownRows("workstreams", DEMO_SEED_WORKSTREAM_IDS);
    this.deleteKnownRows("projects", DEMO_SEED_PROJECT_IDS);
  }

  private deleteKnownRows(table: "documents" | "workstreams" | "projects", ids: string[]): void {
    if (ids.length === 0) {
      return;
    }
    const placeholders = ids.map(() => "?").join(", ");
    this.db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).run(...ids);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private count(table: "projects" | "workstreams" | "documents"): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow;
    return Number(row.count) || 0;
  }

  private countDocumentsByType(type: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM documents WHERE type = ?")
      .get(type) as CountRow;
    return Number(row.count) || 0;
  }

  private getProjectRowById(id: string | null): ProjectRow | null {
    if (!id) {
      return null;
    }
    return (this.db
      .prepare(
        `
          SELECT id, organization_id, name, description, priority, status, slug, created_at, updated_at
          FROM projects
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(id) as ProjectRow | undefined) ?? null;
  }

  private getProjectRowByIdOrSlug(idOrSlug: string | null): ProjectRow | null {
    if (!idOrSlug) {
      return null;
    }
    return (this.db
      .prepare(
        `
          SELECT id, organization_id, name, description, priority, status, slug, created_at, updated_at
          FROM projects
          WHERE id = ? OR slug = ?
          LIMIT 1
        `,
      )
      .get(idOrSlug, idOrSlug) as ProjectRow | undefined) ?? null;
  }

  private getWorkstreamRowById(id: string | null): WorkstreamRow | null {
    if (!id) {
      return null;
    }
    return (this.db
      .prepare(
        `
          SELECT id, project_id, title, description, type, state, priority, slug, created_at, updated_at
          FROM workstreams
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(id) as WorkstreamRow | undefined) ?? null;
  }

  private getDocumentRowByIdOrSlug(idOrSlug: string | null): DocumentRow | null {
    if (!idOrSlug) {
      return null;
    }
    return (this.db
      .prepare(
        `
          SELECT id, organization_id, project_id, workstream_id, assignee_id, type, title, slug, status, priority, content, created_at, updated_at
          FROM documents
          WHERE id = ? OR slug = ?
          LIMIT 1
        `,
      )
      .get(idOrSlug, idOrSlug) as DocumentRow | undefined) ?? null;
  }

  private generateId(prefix: string): string {
    return `${prefix}-local-${randomBytes(4).toString("hex")}`;
  }

  private makeUniqueSlug(
    table: "documents" | "projects" | "workstreams",
    rawBase: string,
    currentId?: string,
  ): string {
    const base = slugify(rawBase) || "local";
    let candidate = base;
    let suffix = 2;
    while (this.slugExists(table, candidate, currentId)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private slugExists(
    table: "documents" | "projects" | "workstreams",
    slug: string,
    currentId?: string,
  ): boolean {
    const row = this.db
      .prepare(`SELECT id FROM ${table} WHERE slug = ? LIMIT 1`)
      .get(slug) as { id: string } | undefined;
    return Boolean(row && row.id !== currentId);
  }

  private now(): string {
    return new Date().toISOString();
  }

  private metric(count: number): Record<string, unknown> {
    return {
      count,
      trend: Array.from({ length: 7 }, (_, index) => {
        const date = new Date(Date.now() - (6 - index) * 24 * 60 * 60 * 1000);
        return {
          date: date.toISOString().slice(0, 10),
          count: index === 6 ? count : 0,
        };
      }),
    };
  }

  private toProject(row: ProjectRow): Record<string, unknown> {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      priority: row.priority,
      status: row.status,
      assigneeId: null,
      createdById: "desktop-user",
      slug: row.slug,
      targetDate: null,
      codebaseSummary: null,
      lastIndexedAt: null,
      settings: {},
      sortOrder: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completionPercentage: 0,
      teams: [],
    };
  }

  private toWorkstream(row: WorkstreamRow): Record<string, unknown> {
    const project = this.getProjectRowById(row.project_id);
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      type: row.type,
      state: row.state,
      stateChangedAt: row.updated_at,
      createdById: "desktop-user",
      createdBy: this.getCurrentUser(),
      assigneeId: null,
      priority: row.priority,
      slug: row.slug,
      hasUIChanges: false,
      startedAt: row.created_at,
      completedAt: null,
      metrics: {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      project: project
        ? {
            id: project.id,
            name: project.name,
            slug: project.slug,
          }
        : null,
    };
  }

  private toDocumentWithRelations(row: DocumentRow): Record<string, unknown> {
    const workstream = this.getWorkstreamRowById(row.workstream_id);
    const project = this.getProjectRowById(row.project_id);
    return {
      ...this.toDocument(row),
      workstream: workstream
        ? {
            id: workstream.id,
            title: workstream.title,
            state: workstream.state,
          }
        : null,
      project: project
        ? {
            id: project.id,
            name: project.name,
            teams: [],
          }
        : null,
    };
  }

  private toDocumentDetail(row: DocumentRow): Record<string, unknown> {
    return {
      ...this.toDocumentWithRelations(row),
      version: {
        id: `${row.id}:v1`,
        documentId: row.id,
        version: 1,
        content: row.content,
        createdById: "desktop-user",
        createdAt: row.created_at,
      },
    };
  }

  private toDocument(row: DocumentRow): Record<string, unknown> {
    const user = this.getCurrentUser();
    const assignee = row.assignee_id ? user : null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      workstreamId: row.workstream_id,
      projectId: row.project_id,
      type: row.type,
      title: row.title,
      slug: row.slug,
      fileName: null,
      status: row.status,
      priority: row.priority,
      latestVersion: 1,
      createdById: "desktop-user",
      createdBy: user,
      assigneeId: row.assignee_id,
      assignee,
      approverId: null,
      approver: null,
      tokenUsage: null,
      repositorySnapshot: { repositories: [], source: "none", createdAt: row.created_at },
      templateForType: null,
      sortOrder: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toArtifact(document: Record<string, unknown>): Record<string, unknown> {
    return {
      id: document.id,
      organizationId: document.organizationId,
      projectId: document.projectId,
      workstreamId: document.workstreamId,
      type: "DOCUMENT",
      subtype: document.type,
      name: document.title,
      slug: document.slug,
      status: document.status,
      priority: document.priority,
      assigneeId: document.assigneeId,
      assignee: document.assignee,
      dueDate: null,
      externalUrl: null,
      sortOrder: document.sortOrder,
      createdAt: document.createdAt,
      createdById: document.createdById,
      updatedAt: document.updatedAt,
    };
  }

  private seedNow(): string {
    return "2026-05-31T00:00:00.000Z";
  }
}

export class SymphonyWebPocRuntime {
  private apiServer: Server | null = null;
  private webServer: Server | null = null;
  private spawnedWeb: ChildProcess | null = null;
  private store: SymphonyWebPocStore | null = null;
  private started = false;
  private stopping = false;
  private ready = false;
  private starting: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private startAbort: AbortController | null = null;
  private mode: RuntimeMode | null = null;
  private url: string | null = null;
  private apiUrl: string | null = null;
  private error: string | null = null;
  private source: string | null = null;
  private spawnedWebFailure: Error | null = null;

  private readonly dataDir: string;
  private readonly env: RuntimeEnv;
  private readonly appDirCandidates: string[];
  private readonly apiToken = randomBytes(32).toString("base64url");

  constructor(options: SymphonyWebPocRuntimeOptions) {
    this.dataDir = options.dataDir;
    this.env = options.env ?? process.env;
    this.appDirCandidates = options.appDirCandidates ?? [];
  }

  getStatus(enabled = true): SymphonyWebPocStatus {
    return {
      enabled,
      ready: this.ready,
      mode: this.mode,
      url: this.ready ? this.url : null,
      apiUrl: this.apiUrl,
      apiToken: this.apiUrl ? this.apiToken : null,
      dbPath: this.store?.dbPath ?? this.resolveDbPath(),
      error: this.error,
      source: this.source,
      counts: this.store?.getCounts() ?? {
        projects: 0,
        workstreams: 0,
        documents: 0,
      },
    };
  }

  async start(): Promise<void> {
    if (this.stopping && this.stopPromise) {
      await this.stopPromise.catch(() => {});
    }
    if (this.started) {
      return this.starting ?? undefined;
    }
    this.started = true;
    this.error = null;
    const controller = new AbortController();
    this.startAbort = controller;
    this.starting = this.launch(controller.signal)
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || this.stopping || !this.started) {
          return;
        }
        this.error = error instanceof Error ? error.message : String(error);
        gatewayLog.error(TAG, this.error);
        this.started = false;
        this.ready = false;
        await this.stopSpawnedWeb();
        await closeServer(this.webServer);
        await closeServer(this.apiServer);
        this.webServer = null;
        this.apiServer = null;
        this.url = null;
        this.apiUrl = null;
        this.mode = null;
        this.source = null;
        this.store?.close();
        this.store = null;
      })
      .finally(() => {
        if (this.startAbort === controller) {
          this.startAbort = null;
          this.starting = null;
        }
      });
    return this.starting;
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopPromise = this.stopInternal().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async stopInternal(): Promise<void> {
    this.started = false;
    this.stopping = true;
    this.startAbort?.abort();
    const starting = this.starting;
    try {
      this.ready = false;
      if (starting) {
        await starting.catch(() => {});
      }
      await this.stopSpawnedWeb();
      await closeServer(this.webServer);
      await closeServer(this.apiServer);
      this.webServer = null;
      this.apiServer = null;
      this.url = null;
      this.apiUrl = null;
      this.mode = null;
      this.source = null;
      this.spawnedWebFailure = null;
      this.store?.close();
      this.store = null;
    } finally {
      this.stopping = false;
    }
  }

  private async launch(signal: AbortSignal): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.store = new SymphonyWebPocStore(
      this.resolveDbPath(),
      this.resolveAgentMonitorDbPath(),
    );
    const apiPort = await this.startApiServer(signal);
    this.apiUrl = `http://${HOST}:${apiPort}`;

    const externalUrl = normalizeOriginUrl(this.env.CL_SYMPHONY_WEB_URL);
    if (externalUrl) {
      this.mode = "external-url";
      this.url = externalUrl;
      this.source = "CL_SYMPHONY_WEB_URL";
      await this.waitForReachableUrl(externalUrl, signal);
      this.ready = true;
      gatewayLog.info(TAG, `ready using external Symphony URL ${externalUrl}`);
      return;
    }

    const appDir = this.resolveSymphonyAppDir();
    if (appDir) {
      this.mode = "spawned-next";
      this.source = appDir.source;
      this.url = await this.startSpawnedNext(appDir.dir, signal);
      this.ready = true;
      gatewayLog.info(TAG, `ready using spawned Symphony app ${this.url}`);
      return;
    }

    this.mode = "local-poc";
    this.source = "embedded desktop-local harness";
    const webPort = await this.startLocalWebServer(signal);
    this.url = `http://${WEB_HOST}:${webPort}`;
    this.ready = true;
    gatewayLog.info(TAG, `ready using local harness ${this.url}`);
  }

  private async startApiServer(signal: AbortSignal): Promise<number> {
    const ports = resolvePorts(
      this.env.CL_SYMPHONY_WEB_POC_API_PORT,
      DEFAULT_API_PORT,
      [3303, 3304, 3305],
    );
    let lastError: unknown = null;
    for (const port of ports) {
      if (signal.aborted) {
        throw new Error("start aborted");
      }
      const server = createServer((request, response) => {
        void this.handleApiRequest(request, response);
      });
      try {
        const activePort = await listen(server, port);
        this.apiServer = server;
        return activePort;
      } catch (error) {
        lastError = error;
        await closeServer(server);
      }
    }
    throw new Error(`Unable to start Symphony Desktop API: ${describeError(lastError)}`);
  }

  private async startLocalWebServer(signal: AbortSignal): Promise<number> {
    const ports = resolvePorts(
      this.env.CL_SYMPHONY_WEB_POC_PORT,
      DEFAULT_WEB_PORT,
      [3301, 3306, 3307],
    );
    let lastError: unknown = null;
    for (const port of ports) {
      if (signal.aborted) {
        throw new Error("start aborted");
      }
      const server = createServer((request, response) => this.handleWebRequest(request, response));
      try {
        const activePort = await listen(server, port);
        this.webServer = server;
        return activePort;
      } catch (error) {
        lastError = error;
        await closeServer(server);
      }
    }
    throw new Error(`Unable to start Symphony Desktop web server: ${describeError(lastError)}`);
  }

  private async startSpawnedNext(appDir: string, signal: AbortSignal): Promise<string> {
    if (!existsSync(appDir)) {
      throw new Error(`CL_SYMPHONY_APP_DIR does not exist: ${appDir}`);
    }
    const ports = resolvePorts(
      this.env.CL_SYMPHONY_WEB_POC_PORT,
      DEFAULT_WEB_PORT,
      [3301, 3306, 3307],
    );
    const webPort = await reserveAvailablePort(ports, signal);
    const command = this.env.CL_SYMPHONY_WEB_PNPM_BIN?.trim() || "pnpm";
    const mode = this.env.CL_SYMPHONY_WEB_NEXT_MODE === "start" ? "start" : "dev";
    const args = ["exec", "next", mode];
    if (mode === "dev") {
      args.push(this.env.CL_SYMPHONY_WEB_NEXT_BUNDLER === "webpack" ? "--webpack" : "--turbo");
    }
    args.push("-p", String(webPort));
    const apiUrl = this.apiUrl;
    if (!apiUrl) {
      throw new Error("local API URL was not initialized");
    }
    const child = spawn(command, args, {
      cwd: appDir,
      env: {
        ...process.env,
        ...this.env,
        AUTH_MODE: "local_trusted",
        NEXT_PUBLIC_AUTH_MODE: "local_trusted",
        NEXT_PUBLIC_API_URL: apiUrl,
        NEXT_PUBLIC_APP_URL: `http://${WEB_HOST}:${webPort}`,
        NEXT_PUBLIC_WEB_URL: this.env.NEXT_PUBLIC_WEB_URL || "https://closedloop.ai",
        NEXT_PUBLIC_DOCS_URL:
          this.env.NEXT_PUBLIC_DOCS_URL || "https://docs.closedloop.ai",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
          this.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "pk_test_desktop_local_trusted",
        NEXT_PUBLIC_POSTHOG_KEY: "",
        DESKTOP_API_TOKEN: this.apiToken,
        NEXT_PUBLIC_DESKTOP_API_TOKEN: this.apiToken,
        CL_DESKTOP_LOCAL: "1",
      },
      stdio: ["ignore", "inherit", "inherit"],
      detached: false,
    });
    this.spawnedWeb = child;
    this.spawnedWebFailure = null;
    child.on("error", (error) => {
      if (this.spawnedWeb !== child) {
        return;
      }
      const message = `Symphony web process failed to spawn: ${describeError(error)}`;
      this.spawnedWebFailure = new Error(message);
      if (this.stopping || !this.started) {
        return;
      }
      this.ready = false;
      this.error = message;
      gatewayLog.error(TAG, message);
    });
    child.on("exit", (code, signalName) => {
      if (this.spawnedWeb !== child) {
        return;
      }
      const message = `Symphony web process exited code=${code ?? "null"} signal=${signalName ?? "null"}`;
      this.spawnedWebFailure = new Error(message);
      if (this.stopping || !this.started) {
        return;
      }
      this.ready = false;
      this.error = message;
      gatewayLog.error(TAG, this.error);
    });

    const baseUrl = `http://${WEB_HOST}:${webPort}`;
    await this.waitForSpawnedWebUrl(baseUrl, signal);
    return `${baseUrl}${this.getInitialPath()}`;
  }

  private async stopSpawnedWeb(): Promise<void> {
    const child = this.spawnedWeb;
    this.spawnedWeb = null;
    this.spawnedWebFailure = null;
    if (!child || child.killed) {
      return;
    }
    signalChildProcess(child, "SIGTERM");
    const exited = await waitForChildExit(child, SPAWNED_WEB_STOP_TIMEOUT_MS);
    if (!exited) {
      signalChildProcess(child, "SIGKILL");
      await waitForChildExit(child, 1_000);
    }
  }

  private async waitForReachableUrl(url: string, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    let lastError = "";
    while (Date.now() - startedAt < WEB_READY_TIMEOUT_MS) {
      if (signal.aborted) {
        throw new Error("start aborted");
      }
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2_000),
        });
        if (response.ok || response.status < 500) {
          return;
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = describeError(error);
      }
      await sleep(READY_POLL_INTERVAL_MS, signal);
    }
    throw new Error(`Symphony web URL did not become reachable: ${lastError || url}`);
  }

  private async waitForSpawnedWebUrl(url: string, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    let lastError = "";
    while (Date.now() - startedAt < WEB_READY_TIMEOUT_MS) {
      if (signal.aborted) {
        throw new Error("start aborted");
      }
      if (this.spawnedWebFailure) {
        throw this.spawnedWebFailure;
      }
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2_000),
        });
        if (response.ok || response.status < 500) {
          return;
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = describeError(error);
      }
      await sleep(READY_POLL_INTERVAL_MS, signal);
    }
    throw new Error(`Symphony web URL did not become reachable: ${lastError || url}`);
  }

  private async handleApiRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const corsAllowed = this.setCorsHeaders(request, response);
    if (request.method === "OPTIONS") {
      if (!corsAllowed) {
        response.writeHead(403);
        response.end();
        return;
      }
      response.writeHead(204);
      response.end();
      return;
    }
    if (!corsAllowed) {
      sendJson(response, 403, {
        success: false,
        error: "Origin is not allowed for the Symphony Desktop API",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!this.isApiRequestAuthorized(request)) {
      sendJson(response, 401, {
        success: false,
        error: "Missing or invalid Symphony Desktop API token",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!this.store) {
      sendJson(response, 503, {
        success: false,
        error: "Symphony Desktop store is not ready",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${HOST}`);
    const route = stripApiPrefix(url.pathname);
    gatewayLog.debug(TAG, `api ${request.method ?? "UNKNOWN"} ${route}`);
    try {
      if (request.method === "GET" && route === "/compute-targets/status-stream") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "close",
        });
        response.end("event: ready\ndata: {}\n\n");
        return;
      }

      if (request.method === "POST" && route === "/loops/summaries") {
        const body = await readJsonBody(request);
        const documentIds = Array.isArray(body?.documentIds)
          ? body.documentIds.filter((id): id is string => typeof id === "string")
          : [];
        sendResult(response, this.store.getLoopSummaries(documentIds));
        return;
      }

      if (request.method === "PUT" && route === "/settings/compute-preference") {
        const body = await readJsonBody(request);
        sendResult(response, this.store.setComputePreference(body?.mode));
        return;
      }

      if (
        request.method === "PUT" &&
        (route === "/onboarding/dismiss-checklist" || route === "/onboarding/complete-wizard")
      ) {
        await readJsonBody(request).catch(() => null);
        sendResult(response, this.store.getOnboardingStatus());
        return;
      }

      if (request.method === "POST" && route === "/projects") {
        sendMaybeCreated(response, this.store.createProject(await readJsonBody(request)));
        return;
      }
      if (request.method === "PUT" && route.startsWith("/projects/")) {
        const id = decodeURIComponent(route.slice("/projects/".length).split("/")[0] ?? "");
        sendNullableResult(response, this.store.updateProject(id, await readJsonBody(request)));
        return;
      }
      if (request.method === "DELETE" && route.startsWith("/projects/")) {
        const id = decodeURIComponent(route.slice("/projects/".length).split("/")[0] ?? "");
        sendNullableResult(response, this.store.deleteProject(id));
        return;
      }

      if (request.method === "POST" && route === "/workstreams") {
        sendMaybeCreated(response, this.store.createWorkstream(await readJsonBody(request)));
        return;
      }
      if (request.method === "PUT" && route.startsWith("/workstreams/")) {
        const id = decodeURIComponent(route.slice("/workstreams/".length).split("/")[0] ?? "");
        sendNullableResult(response, this.store.updateWorkstream(id, await readJsonBody(request)));
        return;
      }
      if (request.method === "DELETE" && route.startsWith("/workstreams/")) {
        const id = decodeURIComponent(route.slice("/workstreams/".length).split("/")[0] ?? "");
        sendNullableResult(response, this.store.deleteWorkstream(id));
        return;
      }

      if (request.method === "POST" && route === "/documents") {
        sendMaybeCreated(response, this.store.createDocument(await readJsonBody(request)));
        return;
      }
      if (request.method === "POST" && route.startsWith("/documents/") && route.endsWith("/versions")) {
        const id = decodeURIComponent(route.slice("/documents/".length, -"/versions".length));
        sendNullableResult(response, this.store.createDocumentVersion(id, await readJsonBody(request)));
        return;
      }
      if (request.method === "PUT" && route.startsWith("/documents/")) {
        const id = decodeURIComponent(route.slice("/documents/".length).split("/")[0] ?? "");
        sendNullableResult(response, this.store.updateDocument(id, await readJsonBody(request)));
        return;
      }
      if (request.method === "DELETE" && route.startsWith("/documents/")) {
        const id = decodeURIComponent(route.slice("/documents/".length).split("/")[0] ?? "");
        sendNullableResult(response, this.store.deleteDocument(id));
        return;
      }

      if (request.method !== "GET") {
        sendJson(response, 405, {
          success: false,
          error: "Method not allowed in the Symphony Desktop runtime",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (route === "/health") {
        sendJson(response, 200, {
          status: "ok",
          mode: this.mode,
          dbPath: this.store.dbPath,
          counts: this.store.getCounts(),
        });
        return;
      }
      if (route === "/me") {
        sendResult(response, this.store.getCurrentUser());
        return;
      }
      if (route === "/users") {
        sendResult(response, this.store.listUsers());
        return;
      }
      if (route.startsWith("/users/")) {
        const id = decodeURIComponent(route.slice("/users/".length));
        sendNullableResult(response, this.store.getUser(id));
        return;
      }
      if (route === "/organizations/current") {
        sendResult(response, this.store.getCurrentOrganization());
        return;
      }
      if (route === "/teams") {
        sendResult(response, this.store.listTeams());
        return;
      }
      if (route.startsWith("/teams/") && route.endsWith("/repositories")) {
        const teamId = decodeURIComponent(route.slice("/teams/".length, -"/repositories".length));
        sendResult(response, this.store.listTeamRepositories(teamId));
        return;
      }
      if (route.startsWith("/teams/") && route.endsWith("/members")) {
        const teamId = decodeURIComponent(route.slice("/teams/".length, -"/members".length));
        sendResult(response, this.store.listTeamMembers(teamId));
        return;
      }
      if (route.startsWith("/teams/")) {
        const id = decodeURIComponent(route.slice("/teams/".length));
        sendNullableResult(response, this.store.getTeam(id));
        return;
      }
      if (route === "/dashboard/stats") {
        sendResult(response, this.store.getDashboardStats());
        return;
      }
      if (route === "/dashboard/workstreams" || route === "/workstreams") {
        sendResult(response, this.store.listWorkstreams({
          projectId: url.searchParams.get("projectId") ?? undefined,
        }));
        return;
      }
      if (route.startsWith("/workstreams/")) {
        const id = decodeURIComponent(route.slice("/workstreams/".length).split("/")[0] ?? "");
        sendNullableResult(response, this.store.getWorkstream(id));
        return;
      }
      if (route === "/projects") {
        const limit = parsePositiveInt(url.searchParams.get("limit"));
        sendResult(response, this.store.listProjects({
          excludeStatus: parseCsv(url.searchParams.get("excludeStatus")),
          limit,
          status: parseCsv(url.searchParams.get("status")),
          teamId: url.searchParams.get("teamId") ?? undefined,
        }));
        return;
      }
      if (route === "/projects/favorites") {
        sendResult(response, this.store.getFavoriteProjects());
        return;
      }
      if (route.startsWith("/projects/by-slug/")) {
        const slug = decodeURIComponent(route.slice("/projects/by-slug/".length));
        sendNullableResult(response, this.store.getProject(slug));
        return;
      }
      if (route.startsWith("/projects/") && route.endsWith("/tree")) {
        const projectId = decodeURIComponent(route.slice("/projects/".length, -"/tree".length));
        sendResult(response, this.store.getProjectTree(projectId));
        return;
      }
      if (route.startsWith("/projects/") && route.endsWith("/activity")) {
        sendResult(response, {
          activities: [],
          pagination: {
            page: parsePositiveInt(url.searchParams.get("page")) ?? 1,
            pageSize: parsePositiveInt(url.searchParams.get("pageSize")) ?? 20,
            total: 0,
          },
        });
        return;
      }
      if (route.startsWith("/projects/")) {
        const id = decodeURIComponent(route.slice("/projects/".length));
        sendNullableResult(response, this.store.getProject(id));
        return;
      }
      if (route === "/documents") {
        sendResult(response, this.store.listDocuments({
          assigneeId: url.searchParams.get("assigneeId") ?? undefined,
          projectId: url.searchParams.get("projectId") ?? undefined,
          type: url.searchParams.get("type") ?? undefined,
        }));
        return;
      }
      if (route.startsWith("/documents/by-slug/")) {
        const slug = decodeURIComponent(route.slice("/documents/by-slug/".length));
        sendNullableResult(response, this.store.getDocument(slug));
        return;
      }
      if (route.startsWith("/documents/") && route.endsWith("/versions")) {
        const id = decodeURIComponent(route.slice("/documents/".length, -"/versions".length));
        sendNullableResult(response, this.store.listDocumentVersions(id));
        return;
      }
      if (route.startsWith("/documents/") && route.endsWith("/attachments")) {
        sendResult(response, []);
        return;
      }
      if (route.startsWith("/documents/") && route.endsWith("/generation-status")) {
        sendResult(response, {
          status: "NONE",
          command: null,
          htmlUrl: null,
          startedAt: null,
          completedAt: null,
          correlationId: null,
          runKey: null,
        });
        return;
      }
      if (route.startsWith("/documents/")) {
        const id = decodeURIComponent(route.slice("/documents/".length).split("/")[0] ?? "");
        sendNullableResult(response, this.store.getDocument(id));
        return;
      }
      if (route === "/onboarding") {
        sendResult(response, this.store.getOnboardingStatus());
        return;
      }
      if (route === "/agent-sessions/usage") {
        sendResult(response, this.store.getAgentSessionUsage(parseAgentSessionFilters(url)));
        return;
      }
      if (route === "/agent-sessions") {
        sendResult(response, this.store.listAgentSessions(parseAgentSessionFilters(url)));
        return;
      }
      if (route.startsWith("/agent-sessions/")) {
        const id = decodeURIComponent(route.slice("/agent-sessions/".length));
        sendNullableResult(response, this.store.getAgentSessionDetail(id));
        return;
      }
      if (route === "/agents") {
        sendResult(response, this.store.listAgents({
          enabled: url.searchParams.get("enabled") ?? undefined,
          search: url.searchParams.get("search") ?? undefined,
        }));
        return;
      }
      if (route.startsWith("/agents/") && route.endsWith("/versions")) {
        const id = decodeURIComponent(route.slice("/agents/".length, -"/versions".length));
        sendNullableResult(response, this.store.listAgentVersions(id));
        return;
      }
      if (route.startsWith("/agents/") && route.includes("/versions/")) {
        const [rawId, rawVersion] = route.slice("/agents/".length).split("/versions/", 2);
        const version = Number.parseInt(rawVersion ?? "", 10);
        sendNullableResult(
          response,
          this.store.getAgentVersion(decodeURIComponent(rawId ?? ""), version),
        );
        return;
      }
      if (route.startsWith("/agents/")) {
        const id = decodeURIComponent(route.slice("/agents/".length));
        sendNullableResult(response, this.store.getAgent(id));
        return;
      }
      if (route === "/integrations/github") {
        sendResult(response, this.store.getGitHubIntegrationStatus());
        return;
      }
      if (route === "/compute-targets") {
        sendResult(response, this.store.listComputeTargets());
        return;
      }
      if (route === "/settings/compute-preference") {
        sendResult(response, this.store.getComputePreference());
        return;
      }

      sendJson(response, 404, {
        success: false,
        error: `Symphony Desktop API route not implemented: ${route}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendJson(response, 500, {
        success: false,
        error: describeError(error),
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handleWebRequest(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", `http://${HOST}`);
    if (url.pathname !== "/") {
      response.writeHead(302, { Location: "/" });
      response.end();
      return;
    }
    const status = this.getStatus(true);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(renderLocalHarness(status));
  }

  private resolveDbPath(): string {
    return path.join(this.dataDir, "symphony-web-poc.db");
  }

  private resolveAgentMonitorDbPath(): string {
    const explicit = this.env.DASHBOARD_DB_PATH?.trim();
    if (explicit) {
      return explicit;
    }
    return path.join(path.dirname(this.dataDir), "agent-monitor", "dashboard.db");
  }

  private resolveSymphonyAppDir(): { dir: string; source: string } | null {
    const explicit = this.env.CL_SYMPHONY_APP_DIR?.trim();
    if (explicit) {
      return { dir: explicit, source: "CL_SYMPHONY_APP_DIR" };
    }
    const autoDiscover = this.env.CL_SYMPHONY_APP_AUTO_DISCOVER;
    if (autoDiscover === "0" || autoDiscover === "false") {
      return null;
    }
    for (const candidate of this.appDirCandidates) {
      if (isSymphonyAppDir(candidate)) {
        return {
          dir: candidate,
          source: "auto-discovered sibling symphony-alpha/apps/app",
        };
      }
    }
    return null;
  }

  private getInitialPath(): string {
    const raw = this.env.CL_SYMPHONY_WEB_INITIAL_PATH?.trim();
    if (!raw) {
      return "/closedloop-ai/my-tasks";
    }
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  private setCorsHeaders(request: IncomingMessage, response: ServerResponse): boolean {
    const origin = request.headers.origin;
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Vary", "Origin");
    if (typeof origin !== "string" || origin.length === 0) {
      return true;
    }
    const allowedOrigin = this.getAllowedWebOrigin();
    if (allowedOrigin && origin === allowedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      return true;
    }
    return false;
  }

  private getAllowedWebOrigin(): string | null {
    if (!this.url) {
      return null;
    }
    try {
      return new URL(this.url).origin;
    } catch {
      return null;
    }
  }

  private isApiRequestAuthorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string") {
      return false;
    }
    const [scheme, token] = authorization.split(/\s+/, 2);
    return scheme?.toLowerCase() === "bearer" && tokenMatches(token, this.apiToken);
  }
}

function sendResult(response: ServerResponse, data: unknown): void {
  sendJson(response, 200, {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}

function sendMaybeCreated(response: ServerResponse, data: unknown | null): void {
  if (data === null) {
    sendJson(response, 400, {
      success: false,
      error: "Invalid request for the desktop-local Symphony API",
      timestamp: new Date().toISOString(),
    });
    return;
  }
  sendJson(response, 201, {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}

function sendNullableResult(response: ServerResponse, data: unknown | null): void {
  if (data === null) {
    sendJson(response, 404, {
      success: false,
      error: "Not found",
      timestamp: new Date().toISOString(),
    });
    return;
  }
  sendResult(response, data);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function stripApiPrefix(pathname: string): string {
  if (pathname === "/api") {
    return "/";
  }
  return pathname.startsWith("/api/") ? pathname.slice(4) : pathname;
}

function parseAgentSessionFilters(url: URL): AgentMonitorSessionFilters {
  return {
    startDate: stringValue(url.searchParams.get("startDate")) ?? undefined,
    endDate: stringValue(url.searchParams.get("endDate")) ?? undefined,
    harness: stringValue(url.searchParams.get("harness")) ?? undefined,
    status: stringValue(url.searchParams.get("status")) ?? undefined,
    userId: stringValue(url.searchParams.get("userId")) ?? undefined,
    teamId: stringValue(url.searchParams.get("teamId")) ?? undefined,
    projectId: stringValue(url.searchParams.get("projectId")) ?? undefined,
    limit: parsePositiveInt(url.searchParams.get("limit")),
    offset: parseNonNegativeInt(url.searchParams.get("offset")),
  };
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseNonNegativeInt(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseCsv(raw: string | null): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePriority(value: string | null): string {
  return value && ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(value) ? value : "MEDIUM";
}

function normalizeAgentSessionStatusFilter(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized === "failed" ? "error" : normalized;
}

function normalizeAgentSessionHarness(value: string | null): string {
  return value && value.trim() ? value.trim().toLowerCase() : "claude";
}

function normalizeLocalAgentRole(value: string | null): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || "agent";
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Agent";
}

function readTableColumns(db: DatabaseSync, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

function selectRowsByIds<T>(db: DatabaseSync, sql: string, ids: string[]): T[] {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 900) {
    const chunk = ids.slice(index, index + 900);
    if (chunk.length === 0) {
      continue;
    }
    const placeholders = chunk.map(() => "?").join(", ");
    rows.push(...(db.prepare(sql.replace("__IDS__", placeholders)).all(...chunk) as T[]));
  }
  return rows;
}

function groupRowsBySessionId<T extends { session_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.session_id);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.session_id, [row]);
    }
  }
  return grouped;
}

function emptyAgentSessionTotals(): AgentSessionTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCost: 0,
  };
}

function addAgentSessionTotals(target: AgentSessionTotals, source: AgentSessionTotals): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.estimatedCost = roundUsd(target.estimatedCost + source.estimatedCost);
}

function sumAgentSessionTokenUsage(rows: Array<Record<string, unknown>>): AgentSessionTotals {
  return rows.reduce<AgentSessionTotals>((totals, row) => ({
    inputTokens: totals.inputTokens + numberRecordValue(row, "inputTokens"),
    outputTokens: totals.outputTokens + numberRecordValue(row, "outputTokens"),
    cacheReadTokens: totals.cacheReadTokens + numberRecordValue(row, "cacheReadTokens"),
    cacheWriteTokens: totals.cacheWriteTokens + numberRecordValue(row, "cacheWriteTokens"),
    estimatedCost: roundUsd(totals.estimatedCost + numberRecordValue(row, "estimatedCostUsd")),
  }), emptyAgentSessionTotals());
}

function estimateAgentSessionTokenCost(
  tokenUsage: AgentMonitorTokenRow,
  pricingRows: AgentMonitorPricingRow[],
): number {
  const pricing = pricingRows.find((row) =>
    sqliteLikeMatch(tokenUsage.model, row.model_pattern),
  );
  if (!pricing) {
    return 0;
  }
  return roundUsd(
    ((Number(tokenUsage.input_tokens) || 0) * Number(pricing.input_per_mtok) +
      (Number(tokenUsage.output_tokens) || 0) * Number(pricing.output_per_mtok) +
      (Number(tokenUsage.cache_read_tokens) || 0) * Number(pricing.cache_read_per_mtok) +
      (Number(tokenUsage.cache_write_tokens) || 0) * Number(pricing.cache_write_per_mtok)) /
      1_000_000,
  );
}

function sqliteLikeMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replaceAll(/([.+^${}()|[\]\\])/g, "\\$1");
  const regex = new RegExp(
    `^${escaped.replaceAll("%", ".*").replaceAll("_", ".")}$`,
    "i",
  );
  return regex.test(value);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function parseJsonValueText(value: string | null): unknown {
  if (!value || value.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function parseJsonObjectText(value: string | null): Record<string, unknown> | null {
  const parsed = parseJsonValueText(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function jsonStringValue(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberRecordValue(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function documentPrefix(type: string): string {
  if (type === "PRD") {
    return "PRD";
  }
  if (type === "FEATURE") {
    return "FEA";
  }
  if (type === "IMPLEMENTATION_PLAN") {
    return "PLN";
  }
  return "DOC";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function resolvePorts(raw: string | undefined, defaultPort: number, fallbacks: number[]): number[] {
  const parsed = raw ? Number.parseInt(raw, 10) : defaultPort;
  const preferred =
    Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : defaultPort;
  return [preferred, ...fallbacks.filter((port) => port !== preferred)];
}

function isSymphonyAppDir(candidate: string): boolean {
  return existsSync(path.join(candidate, "package.json")) &&
    existsSync(path.join(candidate, "app")) &&
    existsSync(path.join(candidate, "next.config.ts"));
}

function normalizeOriginUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported Symphony web URL protocol: ${url.protocol}`);
  }
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

async function reserveAvailablePort(ports: number[], signal: AbortSignal): Promise<number> {
  let lastError: unknown = null;
  for (const port of ports) {
    if (signal.aborted) {
      throw new Error("start aborted");
    }
    const server = createServer();
    try {
      const activePort = await listen(server, port);
      await closeServer(server);
      return activePort;
    } catch (error) {
      lastError = error;
      await closeServer(server);
    }
  }
  throw new Error(`Unable to reserve a Symphony web port: ${describeError(lastError)}`);
}

function closeServer(server: Server | null): Promise<void> {
  if (!server || !server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ESRCH") {
      gatewayLog.warn(TAG, `kill ${signal} failed: ${describeError(error)}`);
    }
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("start aborted"));
      },
      { once: true },
    );
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) {
    return false;
  }
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function renderLocalHarness(status: SymphonyWebPocStatus): string {
  const counts = status.counts;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Symphony Desktop Runtime</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f7f4;
      color: #1d1f24;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f7f7f4;
    }
    main {
      display: grid;
      gap: 24px;
      max-width: 1120px;
      margin: 0 auto;
      padding: 36px;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 1px solid #d9d6ce;
      padding-bottom: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #5c626b;
      line-height: 1.5;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      border: 1px solid #b8d6c8;
      background: #e8f4ee;
      color: #20513e;
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .tile {
      border: 1px solid #d9d6ce;
      border-radius: 8px;
      background: #ffffff;
      padding: 18px;
    }
    .label {
      color: #707680;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .value {
      margin-top: 8px;
      font-size: 30px;
      font-weight: 700;
    }
    .panel {
      border: 1px solid #d9d6ce;
      border-radius: 8px;
      background: #ffffff;
      padding: 18px;
    }
    code {
      overflow-wrap: anywhere;
      color: #24364f;
    }
    @media (max-width: 720px) {
      main { padding: 20px; }
      header { display: grid; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Symphony Desktop Runtime</h1>
        <p>Desktop-local SQLite/API runtime is online. Set <code>CL_SYMPHONY_APP_DIR</code> or <code>CL_SYMPHONY_WEB_URL</code> to point this surface at the real Symphony Next app.</p>
      </div>
      <span class="badge">${escapeHtml(status.mode ?? "starting")}</span>
    </header>
    <section class="grid">
      <div class="tile"><div class="label">Projects</div><div class="value">${counts.projects}</div></div>
      <div class="tile"><div class="label">Workstreams</div><div class="value">${counts.workstreams}</div></div>
      <div class="tile"><div class="label">Documents</div><div class="value">${counts.documents}</div></div>
    </section>
    <section class="panel">
      <div class="label">Local API</div>
      <p><code>${escapeHtml(status.apiUrl ?? "starting")}</code></p>
    </section>
    <section class="panel">
      <div class="label">SQLite DB</div>
      <p><code>${escapeHtml(status.dbPath ?? "starting")}</code></p>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
