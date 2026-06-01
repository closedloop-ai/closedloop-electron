import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { SymphonyWebPocRuntime } from "../src/main/symphony-web-poc-runtime.js";

test("Symphony Web POC runtime serves local SQLite-backed API and harness", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-"));
  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    env: {
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);

  assert.equal(status.ready, true);
  assert.equal(status.mode, "local-poc");
  assert.match(status.url ?? "", /^http:\/\/localhost:\d+$/);
  assert.match(status.apiUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(status.apiToken);
  assert.equal(status.counts.projects, 0);
  assert.equal(status.counts.workstreams, 0);
  assert.equal(status.counts.documents, 0);

  const unauthorized = await fetch(`${status.apiUrl}/health`);
  assert.equal(unauthorized.status, 401);

  const disallowedOrigin = await fetch(`${status.apiUrl}/documents`, {
    headers: {
      Authorization: `Bearer ${status.apiToken}`,
      Origin: "https://example.invalid",
    },
  });
  assert.equal(disallowedOrigin.status, 403);

  const allowedOrigin = new URL(status.url ?? "").origin;
  const healthResponse = await fetch(`${status.apiUrl}/health`, {
    headers: {
      Authorization: `Bearer ${status.apiToken}`,
      Origin: allowedOrigin,
    },
  });
  assert.equal(healthResponse.ok, true);
  assert.equal(healthResponse.headers.get("access-control-allow-origin"), allowedOrigin);
  const health = await healthResponse.json() as {
    status: string;
    counts: { documents: number };
  };
  assert.equal(health.status, "ok");
  assert.equal(health.counts.documents, 0);

  const me = await fetchJson(`${status.apiUrl}/me`, status.apiToken) as {
    success: boolean;
    data: { email: string; firstName: string };
  };
  assert.equal(me.success, true);
  assert.equal(me.data.email, "andrew.eye@closedloop.ai");
  assert.equal(me.data.firstName, "Andrew");

  const stats = await fetchJson(`${status.apiUrl}/dashboard/stats`, status.apiToken) as {
    success: boolean;
    data: {
      prds: { count: number };
      features: { count: number };
      plans: { count: number };
    };
  };
  assert.equal(stats.success, true);
  assert.equal(stats.data.prds.count, 0);
  assert.equal(stats.data.features.count, 0);
  assert.equal(stats.data.plans.count, 0);

  const teams = await fetchJson(`${status.apiUrl}/teams`, status.apiToken) as {
    success: boolean;
    data: unknown[];
  };
  assert.equal(teams.success, true);
  assert.equal(teams.data.length, 0);

  const emptySessions = await fetchJson(
    `${status.apiUrl}/agent-sessions`,
    status.apiToken,
  ) as {
    success: boolean;
    data: { items: unknown[]; total: number; viewerScope: string };
  };
  assert.equal(emptySessions.success, true);
  assert.deepEqual(emptySessions.data, {
    items: [],
    total: 0,
    viewerScope: "self",
  });

  const emptySessionUsage = await fetchJson(
    `${status.apiUrl}/agent-sessions/usage`,
    status.apiToken,
  ) as {
    success: boolean;
    data: { totalSessions: number; lastSyncTargets: unknown[] };
  };
  assert.equal(emptySessionUsage.success, true);
  assert.equal(emptySessionUsage.data.totalSessions, 0);
  assert.deepEqual(emptySessionUsage.data.lastSyncTargets, []);

  const assignedDocs = await fetchJson(
    `${status.apiUrl}/documents?assigneeId=desktop-user`,
    status.apiToken,
  ) as {
    success: boolean;
    data: Array<{ assigneeId: string; project: { name: string } | null }>;
  };
  assert.equal(assignedDocs.success, true);
  assert.equal(assignedDocs.data.length, 0);

  const loopSummaries = await fetchJson(
    `${status.apiUrl}/loops/summaries`,
    status.apiToken,
    undefined,
    {
      method: "POST",
      body: JSON.stringify({ documentIds: ["PRD-353", "FEA-1469"] }),
    },
  ) as {
    success: boolean;
    data: Record<string, { activeLoop: null }>;
  };
  assert.equal(loopSummaries.success, true);
  assert.deepEqual(loopSummaries.data["PRD-353"], {
    activeLoop: null,
    latestCompleted: null,
    latestFailed: null,
  });

  const seededFeatureResponse = await fetch(`${status.apiUrl}/documents/by-slug/FEA-1469`, {
    headers: {
      Authorization: `Bearer ${status.apiToken}`,
    },
  });
  assert.equal(seededFeatureResponse.status, 404);

  const page = await fetchText(status.url ?? "");
  assert.match(page, /Symphony Desktop Runtime/);
  assert.match(page, /desktop-local SQLite\/API runtime is online/i);
});

test("Symphony Web POC runtime removes old demo seed rows without deleting local rows", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-cleanup-"));
  const bootstrap = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    env: {
      CL_SYMPHONY_APP_AUTO_DISCOVER: "0",
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
    },
  });
  await bootstrap.start();
  await bootstrap.stop();

  const db = new DatabaseSync(path.join(tmpDir, "symphony-web-poc.db"));
  const now = "2026-05-31T12:00:00.000Z";
  const insertProject = db.prepare(`
    INSERT OR REPLACE INTO projects
      (id, organization_id, name, description, priority, status, slug, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertProject.run(
    "PRO-desktop-strategy",
    "desktop-org",
    "Ideas Triage",
    "Old screenshot-shaped demo project",
    "MEDIUM",
    "IN_PROGRESS",
    "ideas-triage",
    now,
    now,
  );
  insertProject.run(
    "PRO-local",
    "desktop-org",
    "Local Project",
    "User-created local project",
    "MEDIUM",
    "IN_PROGRESS",
    "local-project",
    now,
    now,
  );

  const insertWorkstream = db.prepare(`
    INSERT OR REPLACE INTO workstreams
      (id, project_id, title, description, type, state, priority, slug, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertWorkstream.run(
    "WRK-symphony-web-poc",
    "PRO-desktop-strategy",
    "Symphony Web in Electron",
    "Old screenshot-shaped demo workstream",
    "SPIKE",
    "IMPLEMENTATION_IN_PROGRESS",
    "HIGH",
    "symphony-web-in-electron",
    now,
    now,
  );
  insertWorkstream.run(
    "WRK-local",
    "PRO-local",
    "Local Workstream",
    "User-created local workstream",
    "FEATURE",
    "IMPLEMENTATION_IN_PROGRESS",
    "MEDIUM",
    "local-workstream",
    now,
    now,
  );

  const insertDocument = db.prepare(`
    INSERT OR REPLACE INTO documents
      (id, organization_id, project_id, workstream_id, assignee_id, type, title, slug, status, priority, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertDocument.run(
    "FEA-1469",
    "desktop-org",
    "PRO-desktop-strategy",
    "WRK-symphony-web-poc",
    "desktop-user",
    "FEATURE",
    "POC: Run Symphony Web App Inside Electron Against Local SQLite",
    "FEA-1469",
    "IN_PROGRESS",
    "MEDIUM",
    "# Demo artifact",
    now,
    now,
  );
  insertDocument.run(
    "DOC-local",
    "desktop-org",
    "PRO-local",
    "WRK-local",
    "desktop-user",
    "PRD",
    "Local Only PRD",
    "DOC-local",
    "DRAFT",
    "MEDIUM",
    "# Local Only PRD",
    now,
    now,
  );
  db.close();

  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    env: {
      CL_SYMPHONY_APP_AUTO_DISCOVER: "0",
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);
  assert.equal(status.counts.projects, 1);
  assert.equal(status.counts.workstreams, 1);
  assert.equal(status.counts.documents, 1);

  const removedFeatureResponse = await fetch(`${status.apiUrl}/documents/by-slug/FEA-1469`, {
    headers: {
      Authorization: `Bearer ${status.apiToken}`,
    },
  });
  assert.equal(removedFeatureResponse.status, 404);

  const localDocument = await fetchJson(
    `${status.apiUrl}/documents/by-slug/DOC-local`,
    status.apiToken ?? "",
  ) as {
    success: boolean;
    data: { slug: string; project: { name: string }; workstream: { title: string } };
  };
  assert.equal(localDocument.success, true);
  assert.equal(localDocument.data.slug, "DOC-local");
  assert.equal(localDocument.data.project.name, "Local Project");
  assert.equal(localDocument.data.workstream.title, "Local Workstream");
});

test("Symphony Web POC runtime supports teamless single-player CRUD against local SQLite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-crud-"));
  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    env: {
      CL_SYMPHONY_APP_AUTO_DISCOVER: "0",
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);
  assert.ok(status.apiUrl);
  assert.ok(status.apiToken);

  const teams = await fetchJson(`${status.apiUrl}/teams`, status.apiToken) as {
    success: boolean;
    data: unknown[];
  };
  assert.equal(teams.success, true);
  assert.deepEqual(teams.data, []);

  const createTeamResponse = await fetch(`${status.apiUrl}/teams`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${status.apiToken}`,
    },
    body: JSON.stringify({ name: "Local Product Team" }),
  });
  assert.equal(createTeamResponse.status, 405);

  const createdProject = await fetchJson(`${status.apiUrl}/projects`, status.apiToken, undefined, {
    method: "POST",
    body: JSON.stringify({
      name: "Local SQLite Project",
      description: "Created through the desktop-local Symphony API",
      priority: "HIGH",
      teamIds: ["ignored-team-id"],
    }),
  }) as {
    success: boolean;
    data: { id: string; name: string; priority: string; teams: Array<{ id: string }> };
  };
  assert.equal(createdProject.success, true);
  assert.equal(createdProject.data.name, "Local SQLite Project");
  assert.equal(createdProject.data.priority, "HIGH");
  assert.deepEqual(createdProject.data.teams, []);

  const updatedProject = await fetchJson(
    `${status.apiUrl}/projects/${createdProject.data.id}`,
    status.apiToken,
    undefined,
    {
      method: "PUT",
      body: JSON.stringify({ status: "IN_PROGRESS", priority: "URGENT" }),
    },
  ) as {
    success: boolean;
    data: { status: string; priority: string };
  };
  assert.equal(updatedProject.success, true);
  assert.equal(updatedProject.data.status, "IN_PROGRESS");
  assert.equal(updatedProject.data.priority, "URGENT");

  const projectsWithStaleTeamFilter = await fetchJson(
    `${status.apiUrl}/projects?teamId=ignored-team-id`,
    status.apiToken,
  ) as {
    success: boolean;
    data: Array<{ id: string; teams: unknown[] }>;
  };
  assert.equal(projectsWithStaleTeamFilter.success, true);
  assert.deepEqual(projectsWithStaleTeamFilter.data.map((project) => project.id), [
    createdProject.data.id,
  ]);
  assert.deepEqual(projectsWithStaleTeamFilter.data[0]?.teams, []);

  const createdWorkstream = await fetchJson(
    `${status.apiUrl}/workstreams`,
    status.apiToken,
    undefined,
    {
      method: "POST",
      body: JSON.stringify({
        projectId: createdProject.data.id,
        title: "Local CRUD Workstream",
        type: "SPIKE",
        priority: "HIGH",
      }),
    },
  ) as {
    success: boolean;
    data: { id: string; title: string; state: string };
  };
  assert.equal(createdWorkstream.success, true);
  assert.equal(createdWorkstream.data.title, "Local CRUD Workstream");
  assert.equal(createdWorkstream.data.state, "INITIATED");

  const updatedWorkstream = await fetchJson(
    `${status.apiUrl}/workstreams/${createdWorkstream.data.id}`,
    status.apiToken,
    undefined,
    {
      method: "PUT",
      body: JSON.stringify({ state: "IMPLEMENTATION_IN_PROGRESS" }),
    },
  ) as {
    success: boolean;
    data: { state: string };
  };
  assert.equal(updatedWorkstream.success, true);
  assert.equal(updatedWorkstream.data.state, "IMPLEMENTATION_IN_PROGRESS");
  const fetchedWorkstream = await fetchJson(
    `${status.apiUrl}/workstreams/${createdWorkstream.data.id}`,
    status.apiToken,
  ) as {
    success: boolean;
    data: { id: string; state: string };
  };
  assert.equal(fetchedWorkstream.success, true);
  assert.equal(fetchedWorkstream.data.id, createdWorkstream.data.id);
  assert.equal(fetchedWorkstream.data.state, "IMPLEMENTATION_IN_PROGRESS");

  const createdDocument = await fetchJson(`${status.apiUrl}/documents`, status.apiToken, undefined, {
    method: "POST",
    body: JSON.stringify({
      projectId: createdProject.data.id,
      workstreamId: createdWorkstream.data.id,
      assigneeId: "desktop-user",
      type: "PRD",
      title: "Local CRUD PRD",
      priority: "MEDIUM",
      content: "# Local CRUD PRD",
    }),
  }) as {
    success: boolean;
    data: {
      id: string;
      slug: string;
      title: string;
      version: { content: string };
      project: { teams: Array<{ id: string }> };
    };
  };
  assert.equal(createdDocument.success, true);
  assert.equal(createdDocument.data.title, "Local CRUD PRD");
  assert.equal(createdDocument.data.version.content, "# Local CRUD PRD");
  assert.deepEqual(createdDocument.data.project.teams, []);

  const assignedDocuments = await fetchJson(
    `${status.apiUrl}/documents?assigneeId=desktop-user`,
    status.apiToken,
  ) as {
    success: boolean;
    data: Array<{ id: string; assigneeId: string }>;
  };
  assert.equal(assignedDocuments.success, true);
  assert.deepEqual(assignedDocuments.data.map((document) => document.id), [
    createdDocument.data.id,
  ]);

  const updatedVersion = await fetchJson(
    `${status.apiUrl}/documents/${createdDocument.data.id}/versions`,
    status.apiToken,
    undefined,
    {
      method: "POST",
      body: JSON.stringify({ content: "# Updated Local CRUD PRD" }),
    },
  ) as {
    success: boolean;
    data: { version: { content: string } };
  };
  assert.equal(updatedVersion.success, true);
  assert.equal(updatedVersion.data.version.content, "# Updated Local CRUD PRD");

  const updatedDocument = await fetchJson(
    `${status.apiUrl}/documents/${createdDocument.data.id}`,
    status.apiToken,
    undefined,
    {
      method: "PUT",
      body: JSON.stringify({ title: "Local CRUD PRD Updated", status: "IN_PROGRESS", priority: "HIGH" }),
    },
  ) as {
    success: boolean;
    data: { title: string; status: string; priority: string };
  };
  assert.equal(updatedDocument.success, true);
  assert.equal(updatedDocument.data.title, "Local CRUD PRD Updated");
  assert.equal(updatedDocument.data.status, "IN_PROGRESS");
  assert.equal(updatedDocument.data.priority, "HIGH");

  const bySlug = await fetchJson(
    `${status.apiUrl}/documents/by-slug/${createdDocument.data.slug}`,
    status.apiToken,
  ) as {
    success: boolean;
    data: { id: string; version: { content: string } };
  };
  assert.equal(bySlug.success, true);
  assert.equal(bySlug.data.id, createdDocument.data.id);
  assert.equal(bySlug.data.version.content, "# Updated Local CRUD PRD");

  for (const [url, label] of [
    [`${status.apiUrl}/documents/${createdDocument.data.id}`, "document"],
    [`${status.apiUrl}/workstreams/${createdWorkstream.data.id}`, "workstream"],
    [`${status.apiUrl}/projects/${createdProject.data.id}`, "project"],
  ] as const) {
    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${status.apiToken}` },
    });
    assert.equal(response.ok, true, `delete ${label} returned ${response.status}`);
  }

  const finalHealth = await fetchJson(`${status.apiUrl}/health`, status.apiToken) as {
    counts: { projects: number; workstreams: number; documents: number };
  };
  assert.equal(finalHealth.counts.projects, 0);
  assert.equal(finalHealth.counts.workstreams, 0);
  assert.equal(finalHealth.counts.documents, 0);
  const finalTeams = await fetchJson(`${status.apiUrl}/teams`, status.apiToken) as {
    success: boolean;
    data: unknown[];
  };
  assert.equal(finalTeams.success, true);
  assert.equal(finalTeams.data.length, 0);

  assert.ok(status.dbPath);
  const db = new DatabaseSync(status.dbPath);
  t.after(() => db.close());
  const multiplayerTables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('teams', 'team_members', 'project_teams')
    ORDER BY name ASC
  `).all() as Array<{ name: string }>;
  assert.deepEqual(multiplayerTables, []);
});

test("Symphony Web POC runtime populates Symphony session history from Classic agent-monitor SQLite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-sessions-"));
  const agentMonitorDbPath = path.join(tmpDir, "agent-monitor", "dashboard.db");
  fs.mkdirSync(path.dirname(agentMonitorDbPath), { recursive: true });

  const db = new DatabaseSync(agentMonitorDbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT NOT NULL,
      cwd TEXT,
      model TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      metadata TEXT,
      updated_at TEXT NOT NULL,
      awaiting_input_since TEXT,
      harness TEXT NOT NULL DEFAULT 'claude'
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subagent_type TEXT,
      status TEXT NOT NULL,
      task TEXT,
      current_tool TEXT,
      started_at TEXT,
      updated_at TEXT,
      ended_at TEXT,
      awaiting_input_since TEXT,
      parent_agent_id TEXT,
      metadata TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      agent_id TEXT,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      summary TEXT,
      data TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE token_usage (
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      baseline_input INTEGER NOT NULL DEFAULT 0,
      baseline_output INTEGER NOT NULL DEFAULT 0,
      baseline_cache_read INTEGER NOT NULL DEFAULT 0,
      baseline_cache_write INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE model_pricing (
      model_pattern TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      input_per_mtok REAL NOT NULL DEFAULT 0,
      output_per_mtok REAL NOT NULL DEFAULT 0,
      cache_read_per_mtok REAL NOT NULL DEFAULT 0,
      cache_write_per_mtok REAL NOT NULL DEFAULT 0
    );
  `);
  db.prepare(`
    INSERT INTO model_pricing
      (model_pattern, display_name, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("claude-sonnet-4-5%", "Claude Sonnet 4.5", 3, 15, 0.3, 3.75);
  db.prepare(`
    INSERT INTO sessions
      (id, name, status, cwd, model, started_at, ended_at, metadata, updated_at, awaiting_input_since, harness)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sess-new",
    "Investigate POC spinner",
    "error",
    "/Users/andreweye/ClaudeCode/closedloop-electron-fea-1469",
    "claude-sonnet-4-5-20260501",
    "2026-05-31T18:30:00.000Z",
    "2026-05-31T18:34:00.000Z",
    JSON.stringify({
      local: true,
      repositoryFullName: "closedloop/closedloop-electron",
      sourceArtifactId: "FEA-1469",
      issueId: "407",
      baseBranch: "PRD-407-no-sidecar",
    }),
    "2026-05-31T18:35:00.000Z",
    null,
    "claude",
  );
  db.prepare(`
    INSERT INTO sessions
      (id, name, status, cwd, model, started_at, ended_at, metadata, updated_at, awaiting_input_since, harness)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sess-old",
    "Earlier desktop run",
    "completed",
    "/Users/andreweye/ClaudeCode/symphony-alpha",
    "claude-sonnet-4-5-20260501",
    "2026-05-30T16:00:00.000Z",
    "2026-05-30T16:02:00.000Z",
    null,
    "2026-05-30T16:02:00.000Z",
    null,
    "claude",
  );
  const insertAgent = db.prepare(`
    INSERT INTO agents
      (id, session_id, name, type, subagent_type, status, task, current_tool, started_at, updated_at, ended_at, awaiting_input_since, parent_agent_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAgent.run(
    "agent-main",
    "sess-new",
    "Main Agent",
    "main",
    null,
    "error",
    "Inspect desktop POC",
    null,
    "2026-05-31T18:30:00.000Z",
    "2026-05-31T18:34:00.000Z",
    "2026-05-31T18:34:00.000Z",
    null,
    null,
    JSON.stringify({ role: "main" }),
  );
  insertAgent.run(
    "agent-review",
    "sess-new",
    "Review Agent",
    "subagent",
    "reviewer",
    "completed",
    "Review the POC",
    null,
    "2026-05-31T18:31:00.000Z",
    "2026-05-31T18:33:00.000Z",
    "2026-05-31T18:33:00.000Z",
    null,
    "agent-main",
    null,
  );
  const insertEvent = db.prepare(`
    INSERT INTO events
      (session_id, agent_id, event_type, tool_name, summary, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertEvent.run(
    "sess-new",
    "agent-main",
    "tool_use",
    "Read",
    "Read the POC runtime",
    JSON.stringify({ path: "apps/desktop/src/main/symphony-web-poc-runtime.ts" }),
    "2026-05-31T18:31:00.000Z",
  );
  insertEvent.run(
    "sess-new",
    "agent-main",
    "hook_error",
    null,
    "Error: dashboard spinner never resolved",
    JSON.stringify({ code: "SPINNER_STUCK" }),
    "2026-05-31T18:34:00.000Z",
  );
  db.prepare(`
    INSERT INTO token_usage
      (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, baseline_input, baseline_output, baseline_cache_read, baseline_cache_write)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sess-new",
    "claude-sonnet-4-5-20260501",
    1_000_000,
    500_000,
    100_000,
    20_000,
    100_000,
    0,
    0,
    0,
  );
  db.close();

  const runtime = new SymphonyWebPocRuntime({
    dataDir: path.join(tmpDir, "symphony-web-poc"),
    env: {
      CL_SYMPHONY_APP_AUTO_DISCOVER: "0",
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
      DASHBOARD_DB_PATH: agentMonitorDbPath,
    },
  });
  t.after(async () => {
    await runtime.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);
  assert.ok(status.apiUrl);
  assert.ok(status.apiToken);

  const sessions = await fetchJson(
    `${status.apiUrl}/agent-sessions?limit=10&offset=0`,
    status.apiToken,
  ) as {
    success: boolean;
    data: {
      total: number;
      viewerScope: string;
      items: Array<{
        id: string;
        status: string;
        harness: string;
        cwd: string;
        repositoryFullName: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        estimatedCost: number;
        agentCount: number;
        toolUseCount: number;
        errorCount: number;
      }>;
    };
  };
  assert.equal(sessions.success, true);
  assert.equal(sessions.data.total, 2);
  assert.equal(sessions.data.viewerScope, "self");
  assert.equal(sessions.data.items[0]?.id, "sess-new");
  assert.equal(sessions.data.items[0]?.status, "error");
  assert.equal(sessions.data.items[0]?.harness, "claude");
  assert.equal(
    sessions.data.items[0]?.cwd,
    "/Users/andreweye/ClaudeCode/closedloop-electron-fea-1469",
  );
  assert.equal(sessions.data.items[0]?.repositoryFullName, "closedloop/closedloop-electron");
  assert.equal(sessions.data.items[0]?.inputTokens, 1_100_000);
  assert.equal(sessions.data.items[0]?.outputTokens, 500_000);
  assert.equal(sessions.data.items[0]?.cacheReadTokens, 100_000);
  assert.equal(sessions.data.items[0]?.cacheWriteTokens, 20_000);
  assert.equal(sessions.data.items[0]?.estimatedCost, 10.905);
  assert.equal(sessions.data.items[0]?.agentCount, 2);
  assert.equal(sessions.data.items[0]?.toolUseCount, 1);
  assert.equal(sessions.data.items[0]?.errorCount, 1);

  const failedSessions = await fetchJson(
    `${status.apiUrl}/agent-sessions?status=failed`,
    status.apiToken,
  ) as {
    success: boolean;
    data: { total: number; items: Array<{ id: string }> };
  };
  assert.equal(failedSessions.success, true);
  assert.equal(failedSessions.data.total, 1);
  assert.equal(failedSessions.data.items[0]?.id, "sess-new");

  const detail = await fetchJson(
    `${status.apiUrl}/agent-sessions/sess-new`,
    status.apiToken,
  ) as {
    success: boolean;
    data: {
      id: string;
      metadata: { local: boolean };
      sourceArtifactId: string;
      sourceLoopId: string | null;
      issueId: string;
      baseBranch: string;
      attribution: { repositoryFullName: string; worktreePath: string };
      agents: Array<{ externalAgentId: string; parentExternalAgentId: string | null }>;
      events: Array<{ externalEventId: string; toolName: string | null; data: { code?: string; path?: string } }>;
      tokenUsageByModel: Array<{ model: string; estimatedCostUsd: number }>;
    };
  };
  assert.equal(detail.success, true);
  assert.equal(detail.data.id, "sess-new");
  assert.equal(detail.data.metadata.local, true);
  assert.equal(detail.data.sourceArtifactId, "FEA-1469");
  assert.equal(detail.data.sourceLoopId, null);
  assert.equal(detail.data.issueId, "407");
  assert.equal(detail.data.baseBranch, "PRD-407-no-sidecar");
  assert.equal(detail.data.attribution.repositoryFullName, "closedloop/closedloop-electron");
  assert.equal(
    detail.data.attribution.worktreePath,
    "/Users/andreweye/ClaudeCode/closedloop-electron-fea-1469",
  );
  assert.deepEqual(
    detail.data.agents.map((agent) => agent.externalAgentId),
    ["agent-main", "agent-review"],
  );
  assert.equal(detail.data.agents[1]?.parentExternalAgentId, "agent-main");
  assert.equal(detail.data.events[0]?.toolName, "Read");
  assert.equal(detail.data.events[1]?.data.code, "SPINNER_STUCK");
  assert.equal(detail.data.tokenUsageByModel[0]?.model, "claude-sonnet-4-5-20260501");
  assert.equal(detail.data.tokenUsageByModel[0]?.estimatedCostUsd, 10.905);

  const agents = await fetchJson(`${status.apiUrl}/agents`, status.apiToken) as {
    success: boolean;
    data: {
      total: number;
      agents: Array<{
        id: string;
        name: string;
        slug: string;
        role: string;
        description: string;
        enabled: boolean;
        sourceRepo: string;
        currentVersion: number;
      }>;
    };
  };
  assert.equal(agents.success, true);
  assert.equal(agents.data.total, 2);
  assert.deepEqual(
    agents.data.agents.map((agent) => agent.slug),
    ["local-main", "local-reviewer"],
  );
  assert.equal(agents.data.agents[0]?.name, "Main Agent");
  assert.equal(agents.data.agents[0]?.role, "main");
  assert.equal(agents.data.agents[0]?.enabled, true);
  assert.equal(agents.data.agents[0]?.sourceRepo, "Local sessions");
  assert.equal(agents.data.agents[0]?.currentVersion, 1);
  assert.match(agents.data.agents[0]?.description ?? "", /Observed 1 run/);

  const searchedAgents = await fetchJson(
    `${status.apiUrl}/agents?search=reviewer`,
    status.apiToken,
  ) as {
    success: boolean;
    data: { total: number; agents: Array<{ slug: string; role: string }> };
  };
  assert.equal(searchedAgents.success, true);
  assert.equal(searchedAgents.data.total, 1);
  assert.equal(searchedAgents.data.agents[0]?.slug, "local-reviewer");
  assert.equal(searchedAgents.data.agents[0]?.role, "reviewer");

  const disabledAgents = await fetchJson(
    `${status.apiUrl}/agents?enabled=false`,
    status.apiToken,
  ) as {
    success: boolean;
    data: { total: number; agents: unknown[] };
  };
  assert.equal(disabledAgents.success, true);
  assert.equal(disabledAgents.data.total, 0);
  assert.deepEqual(disabledAgents.data.agents, []);

  const agentDetail = await fetchJson(
    `${status.apiUrl}/agents/local-reviewer`,
    status.apiToken,
  ) as {
    success: boolean;
    data: {
      slug: string;
      prompt: string;
      bootstrapRunId: string | null;
      createdBy: { id: string; firstName: string };
    };
  };
  assert.equal(agentDetail.success, true);
  assert.equal(agentDetail.data.slug, "local-reviewer");
  assert.equal(agentDetail.data.bootstrapRunId, null);
  assert.equal(agentDetail.data.createdBy.id, "desktop-user");
  assert.match(agentDetail.data.prompt, /Observed runs: 1/);

  const agentVersions = await fetchJson(
    `${status.apiUrl}/agents/local-reviewer/versions`,
    status.apiToken,
  ) as {
    success: boolean;
    data: { versions: Array<{ version: number; changeNote: string }> };
  };
  assert.equal(agentVersions.success, true);
  assert.equal(agentVersions.data.versions[0]?.version, 1);
  assert.equal(
    agentVersions.data.versions[0]?.changeNote,
    "Derived from local desktop monitor history",
  );

  const agentVersion = await fetchJson(
    `${status.apiUrl}/agents/local-reviewer/versions/1`,
    status.apiToken,
  ) as {
    success: boolean;
    data: { version: number; prompt: string };
  };
  assert.equal(agentVersion.success, true);
  assert.equal(agentVersion.data.version, 1);
  assert.match(agentVersion.data.prompt, /desktop-local agent entry/);

  const usage = await fetchJson(
    `${status.apiUrl}/agent-sessions/usage`,
    status.apiToken,
  ) as {
    success: boolean;
    data: {
      viewerScope: string;
      totalSessions: number;
      totalInputTokens: number;
      totalEstimatedCost: number;
      byUser: Array<{ userId: string; sessionCount: number }>;
      byModel: Array<{ model: string; sessionCount: number; estimatedCost: number }>;
      byHarness: Array<{ harness: string; sessionCount: number; estimatedCost: number }>;
      lastSyncTargets: Array<{ computeTargetId: string; lastAgentSessionSyncAt: string }>;
    };
  };
  assert.equal(usage.success, true);
  assert.equal(usage.data.viewerScope, "self");
  assert.equal(usage.data.totalSessions, 2);
  assert.equal(usage.data.totalInputTokens, 1_100_000);
  assert.equal(usage.data.totalEstimatedCost, 10.905);
  assert.equal(usage.data.byUser[0]?.userId, "desktop-user");
  assert.equal(usage.data.byUser[0]?.sessionCount, 2);
  assert.equal(usage.data.byModel[0]?.model, "claude-sonnet-4-5-20260501");
  assert.equal(usage.data.byModel[0]?.sessionCount, 1);
  assert.equal(usage.data.byModel[0]?.estimatedCost, 10.905);
  assert.equal(usage.data.byHarness[0]?.harness, "claude");
  assert.equal(usage.data.byHarness[0]?.sessionCount, 2);
  assert.equal(usage.data.byHarness[0]?.estimatedCost, 10.905);
  assert.equal(usage.data.lastSyncTargets[0]?.computeTargetId, "desktop-local-target");
  assert.equal(usage.data.lastSyncTargets[0]?.lastAgentSessionSyncAt, "2026-05-31T18:35:00.000Z");
});

test("Symphony Web POC runtime can point the iframe at an external Symphony URL", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-external-"));
  const external = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
  });
  const externalPort = await listen(external);
  const externalUrl = `http://127.0.0.1:${externalPort}`;
  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    env: {
      CL_SYMPHONY_WEB_URL: externalUrl,
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    await closeServer(external);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);

  assert.equal(status.ready, true);
  assert.equal(status.mode, "external-url");
  assert.equal(status.url, externalUrl);
  assert.equal(status.source, "CL_SYMPHONY_WEB_URL");
  assert.match(status.apiUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(status.apiToken);

  const me = await fetchJson(`${status.apiUrl}/me`, status.apiToken, externalUrl) as {
    success: boolean;
    data: { email: string };
  };
  assert.equal(me.success, true);
  assert.equal(me.data.email, "andrew.eye@closedloop.ai");
});

test("Symphony Web POC runtime auto-discovers and spawns a sibling Symphony app", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-autodiscover-"));
  const appDir = path.join(tmpDir, "symphony-alpha", "apps", "app");
  fs.mkdirSync(path.join(appDir, "app"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "app" }));
  fs.writeFileSync(path.join(appDir, "next.config.ts"), "export default {};\n");
  const fakePnpm = path.join(tmpDir, "fake-pnpm.mjs");
  fs.writeFileSync(
    fakePnpm,
    `#!/usr/bin/env node
import { createServer } from "node:http";

const portIndex = process.argv.indexOf("-p");
const port = Number(process.argv[portIndex + 1]);
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("real symphony app " + request.url + " " + process.env.AUTH_MODE);
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
  );
  fs.chmodSync(fakePnpm, 0o755);
  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    appDirCandidates: [appDir],
    env: {
      CL_SYMPHONY_WEB_PNPM_BIN: fakePnpm,
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);

  assert.equal(status.ready, true);
  assert.equal(status.mode, "spawned-next");
  assert.equal(status.source, "auto-discovered sibling symphony-alpha/apps/app");
  assert.match(status.url ?? "", /^http:\/\/localhost:\d+\/closedloop-ai\/my-tasks$/);
  assert.ok(status.apiToken);

  const page = await fetchText(status.url ?? "");
  assert.match(page, /real symphony app \/closedloop-ai\/my-tasks local_trusted/);
});

test("Symphony Web POC runtime reports spawned app startup failures without crashing", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-spawn-fail-"));
  const appDir = path.join(tmpDir, "symphony-alpha");
  fs.mkdirSync(appDir);
  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    env: {
      CL_SYMPHONY_APP_DIR: appDir,
      CL_SYMPHONY_WEB_PNPM_BIN: path.join(tmpDir, "missing-pnpm"),
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);

  assert.equal(status.ready, false);
  assert.equal(status.mode, null);
  assert.match(status.error ?? "", /failed to spawn|ENOENT|missing-pnpm/);
});

async function fetchJson(
  url: string,
  token: string,
  origin?: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(origin ? { Origin: origin } : {}),
    },
  });
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.text();
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      assert.ok(address);
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
