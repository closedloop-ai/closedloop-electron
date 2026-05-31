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
const DEFAULT_WEB_PORT = 3300;
const DEFAULT_API_PORT = 3302;
const WEB_READY_TIMEOUT_MS = 120_000;
const READY_POLL_INTERVAL_MS = 750;
const SPAWNED_WEB_STOP_TIMEOUT_MS = 3_000;

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
  type: string;
  title: string;
  slug: string;
  status: string;
  priority: string;
  content: string;
  created_at: string;
  updated_at: string;
};

class SymphonyWebPocStore {
  private readonly db: DatabaseSync;

  constructor(readonly dbPath: string) {
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
      name: "Desktop POC User",
      email: "desktop-poc@closedloop.local",
      active: true,
      avatarUrl: null,
      createdAt: this.seedNow(),
      updatedAt: this.seedNow(),
    };
  }

  getCurrentOrganization(): Record<string, unknown> {
    return {
      id: "desktop-org",
      name: "ClosedLoop Desktop",
      slug: "closedloop-ai",
    };
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

  listWorkstreams(): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare(
        `
          SELECT id, project_id, title, description, type, state, priority, slug, created_at, updated_at
          FROM workstreams
          ORDER BY created_at DESC
        `,
      )
      .all() as WorkstreamRow[];
    return rows.map((row) => this.toWorkstream(row));
  }

  listProjects(options: { limit?: number } = {}): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare(
        `
          SELECT id, organization_id, name, description, priority, status, slug, created_at, updated_at
          FROM projects
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(options.limit ?? 100) as ProjectRow[];
    return rows.map((row) => this.toProject(row));
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

  getProjectTree(projectId: string): Record<string, unknown> {
    const project = this.getProject(projectId);
    const workstreams = this.listWorkstreams().filter(
      (workstream) => workstream.projectId === projectId,
    );
    const documents = this.listDocuments({ projectId });
    return {
      project,
      workstreams,
      documents,
      orphanedDocuments: [],
    };
  }

  listDocuments(filters: { projectId?: string; type?: string } = {}): Array<Record<string, unknown>> {
    const where: string[] = [];
    const args: string[] = [];
    if (filters.projectId) {
      where.push("project_id = ?");
      args.push(filters.projectId);
    }
    if (filters.type) {
      where.push("type = ?");
      args.push(filters.type);
    }
    const sql = `
      SELECT id, organization_id, project_id, workstream_id, type, title, slug, status, priority, content, created_at, updated_at
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
          SELECT id, organization_id, project_id, workstream_id, type, title, slug, status, priority, content, created_at, updated_at
          FROM documents
          WHERE id = ? OR slug = ?
          LIMIT 1
        `,
      )
      .get(idOrSlug, idOrSlug) as DocumentRow | undefined;
    return row ? this.toDocumentDetail(row) : null;
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
    this.seed();
  }

  private seed(): void {
    const now = this.seedNow();
    this.db
      .prepare("INSERT OR IGNORE INTO organizations (id, slug, name) VALUES (?, ?, ?)")
      .run("desktop-org", "closedloop-ai", "ClosedLoop Desktop");
    this.db
      .prepare(
        `
          INSERT OR IGNORE INTO projects
            (id, organization_id, name, description, priority, status, slug, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "PRO-desktop-strategy",
        "desktop-org",
        "Unified Desktop Strategy",
        "Desktop-local seed data for proving the Symphony web runtime inside Electron.",
        "HIGH",
        "IN_PROGRESS",
        "unified-desktop-strategy",
        now,
        now,
      );
    this.db
      .prepare(
        `
          INSERT OR IGNORE INTO workstreams
            (id, project_id, title, description, type, state, priority, slug, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "WRK-symphony-web-poc",
        "PRO-desktop-strategy",
        "Symphony Web in Electron",
        "Proof path for running the web app inside the desktop shell while preserving the current dashboard UI as a sibling surface.",
        "SPIKE",
        "IMPLEMENTATION_IN_PROGRESS",
        "HIGH",
        "symphony-web-in-electron",
        now,
        now,
      );

    const docs = [
      {
        id: "PRD-415",
        type: "PRD",
        title: "Unified Product Runtime",
        slug: "PRD-415",
        status: "IN_PROGRESS",
        content:
          "# Unified Product Runtime\n\nThe long-term target is one Symphony web application running in hosted and desktop contexts, with desktop using a local SQLite-backed data source where cloud services are unavailable.",
      },
      {
        id: "PRD-407",
        type: "PRD",
        title: "Move Embedded Web App into Main Electron App",
        slug: "PRD-407",
        status: "IN_REVIEW",
        content:
          "# Move Embedded Web App into Main Electron App\n\nPRD-407 removes the separate sidecar process and makes the dashboard runtime an in-process Electron responsibility.",
      },
      {
        id: "FEA-1469",
        type: "FEATURE",
        title: "POC: Run Symphony Web App Inside Electron Against Local SQLite",
        slug: "FEA-1469",
        status: "IN_PROGRESS",
        content:
          "# POC\n\nStack on the PRD-407 branch. Add an experimental sibling Symphony web surface, wire a desktop-local SQLite/API runtime, and keep the dashboard-focused UI running in parallel.",
      },
      {
        id: "PLN-776",
        type: "IMPLEMENTATION_PLAN",
        title: "Electron-Hosted Symphony Web POC with Local SQLite",
        slug: "PLN-776",
        status: "IN_REVIEW",
        content:
          "# Implementation Plan\n\nStart with runtime supervision, local auth/API seams, and navigation-level IA. Port dashboard screens later into the web-centric shell one screen at a time.",
      },
    ];
    const statement = this.db.prepare(
      `
        INSERT OR IGNORE INTO documents
          (id, organization_id, project_id, workstream_id, type, title, slug, status, priority, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    for (const doc of docs) {
      statement.run(
        doc.id,
        "desktop-org",
        "PRO-desktop-strategy",
        "WRK-symphony-web-poc",
        doc.type,
        doc.title,
        doc.slug,
        doc.status,
        "HIGH",
        doc.content,
        now,
        now,
      );
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
      completionPercentage: 35,
      teams: [{ id: "desktop-team", name: "Desktop POC" }],
    };
  }

  private toWorkstream(row: WorkstreamRow): Record<string, unknown> {
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
      hasUIChanges: true,
      startedAt: row.created_at,
      completedAt: null,
      metrics: {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      project: { name: "Unified Desktop Strategy" },
    };
  }

  private toDocumentWithRelations(row: DocumentRow): Record<string, unknown> {
    return {
      ...this.toDocument(row),
      workstream: row.workstream_id
        ? {
            id: row.workstream_id,
            title: "Symphony Web in Electron",
            state: "IMPLEMENTATION_IN_PROGRESS",
          }
        : null,
      project: row.project_id
        ? {
            id: row.project_id,
            name: "Unified Desktop Strategy",
            teams: [{ id: "desktop-team", name: "Desktop POC" }],
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
      assigneeId: null,
      assignee: null,
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
    this.store = new SymphonyWebPocStore(this.resolveDbPath());
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
    this.url = `http://${HOST}:${webPort}`;
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
      const server = createServer((request, response) => this.handleApiRequest(request, response));
      try {
        const activePort = await listen(server, port);
        this.apiServer = server;
        return activePort;
      } catch (error) {
        lastError = error;
        await closeServer(server);
      }
    }
    throw new Error(`Unable to start Symphony POC API: ${describeError(lastError)}`);
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
    throw new Error(`Unable to start Symphony POC web server: ${describeError(lastError)}`);
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
    const args = ["exec", "next", mode, "-p", String(webPort)];
    const apiUrl = this.apiUrl;
    if (!apiUrl) {
      throw new Error("local API URL was not initialized");
    }
    const child = spawn(command, args, {
      cwd: appDir,
      env: {
        ...process.env,
        ...this.env,
        NEXT_PUBLIC_API_URL: apiUrl,
        NEXT_PUBLIC_APP_URL: `http://${HOST}:${webPort}`,
        NEXT_PUBLIC_WEB_URL: this.env.NEXT_PUBLIC_WEB_URL || "https://closedloop.ai",
        NEXT_PUBLIC_DOCS_URL:
          this.env.NEXT_PUBLIC_DOCS_URL || "https://docs.closedloop.ai",
        CL_DESKTOP_LOCAL: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.spawnedWeb = child;
    this.spawnedWebFailure = null;
    child.stdout?.on("data", (chunk: Buffer) => {
      gatewayLog.debug(TAG, `[web stdout] ${chunk.toString("utf8").trim()}`);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      gatewayLog.debug(TAG, `[web stderr] ${chunk.toString("utf8").trim()}`);
    });
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

    const baseUrl = `http://${HOST}:${webPort}`;
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

  private handleApiRequest(request: IncomingMessage, response: ServerResponse): void {
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
        error: "Origin is not allowed for the Symphony POC API",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!this.isApiRequestAuthorized(request)) {
      sendJson(response, 401, {
        success: false,
        error: "Missing or invalid Symphony POC API token",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!this.store) {
      sendJson(response, 503, {
        success: false,
        error: "Symphony POC store is not ready",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${HOST}`);
    const route = stripApiPrefix(url.pathname);
    try {
      if (request.method !== "GET") {
        sendJson(response, 405, {
          success: false,
          error: "Method not allowed in the POC runtime",
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
      if (route === "/organizations/current") {
        sendResult(response, this.store.getCurrentOrganization());
        return;
      }
      if (route === "/dashboard/stats") {
        sendResult(response, this.store.getDashboardStats());
        return;
      }
      if (route === "/dashboard/workstreams" || route === "/workstreams") {
        sendResult(response, this.store.listWorkstreams());
        return;
      }
      if (route === "/projects") {
        const limit = parsePositiveInt(url.searchParams.get("limit"));
        sendResult(response, this.store.listProjects({ limit }));
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
      if (route.startsWith("/projects/")) {
        const id = decodeURIComponent(route.slice("/projects/".length));
        sendNullableResult(response, this.store.getProject(id));
        return;
      }
      if (route === "/documents") {
        sendResult(response, this.store.listDocuments({
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
      if (route.startsWith("/documents/")) {
        const id = decodeURIComponent(route.slice("/documents/".length).split("/")[0] ?? "");
        sendNullableResult(response, this.store.getDocument(id));
        return;
      }

      sendJson(response, 404, {
        success: false,
        error: `POC API route not implemented: ${route}`,
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
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
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
  const pid = child.pid;
  if (!pid) {
    child.kill(signal);
    return;
  }
  try {
    if (process.platform !== "win32") {
      process.kill(-pid, signal);
    } else {
      child.kill(signal);
    }
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
  <title>Symphony Web POC</title>
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
        <h1>Symphony Web POC Runtime</h1>
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
