import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";
import { DesktopGatewayServer } from "../src/server/server.js";
import { EMPTY_CAPABILITIES, PORT_PROBE_ORDER } from "../src/shared/contracts.js";
import { SymphonyDirNotConfiguredError, tryAssertRepoAllowed, tryAssertPathAllowed } from "../src/server/operations/symphony-utils.js";

const execFileAsync = promisify(execFile);

const serversToClose: DesktopGatewayServer[] = [];
const blockersToClose: net.Server[] = [];
const tempPathsToClean: string[] = [];
const originalSymphonyWorktreeParentDir = process.env.SYMPHONY_WORKTREE_PARENT_DIR;

afterEach(async () => {
  if (originalSymphonyWorktreeParentDir === undefined) {
    delete process.env.SYMPHONY_WORKTREE_PARENT_DIR;
  } else {
    process.env.SYMPHONY_WORKTREE_PARENT_DIR = originalSymphonyWorktreeParentDir;
  }

  for (const server of serversToClose.splice(0)) {
    await server.stop();
  }

  for (const blocker of blockersToClose.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      blocker.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  for (const tempPath of tempPathsToClean.splice(0)) {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

test("uses closedloop-ai discovery file path by default", () => {
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [os.homedir()],
    machineName: "discovery-default-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES
  });

  assert.equal(
    server.getAddress().discoveryFilePath,
    path.join(os.homedir(), ".closedloop-ai", "electron-port")
  );
});

test("returns health contract with active port and CORS headers", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-test-"));
  tempPathsToClean.push(tmpDir);
  const discoveryFile = path.join(tmpDir, "electron-port");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "test-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: discoveryFile
  });
  serversToClose.push(server);
  await server.start();

  const healthResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/health`);
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get("access-control-allow-origin"), "https://app.symphony.com");

  const healthBody = (await healthResponse.json()) as { status: string; port: number; machineName: string };
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.machineName, "test-machine");
  assert.equal(healthBody.port, server.getActivePort());

  const discoveryPort = await fs.readFile(discoveryFile, "utf-8");
  assert.equal(Number(discoveryPort), server.getActivePort());
});

test("returns 204 for CORS preflight requests", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-preflight-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://staging.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "preflight-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const preflight = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/launch`, {
    method: "OPTIONS"
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://staging.symphony.com");
  assert.equal(
    preflight.headers.get("access-control-allow-headers"),
    "Content-Type,Authorization,X-Desktop-Gateway-Token,X-Desktop-Source,X-Desktop-Force-Approval,X-Desktop-Approval-Reason"
  );
});

test("returns private-network CORS allow header for terminal-chat preflight", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-pna-preflight-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.closedloop.ai",
    getAllowedDirectories: () => [tmpDir],
    machineName: "pna-preflight-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const preflight = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/terminal-chat`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://app.closedloop.ai",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
      "Access-Control-Request-Private-Network": "true"
    }
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.closedloop.ai");
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
});

test("allows loopback origin variants for CORS preflight", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-loopback-origin-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "http://localhost:3000",
    getAllowedDirectories: () => [tmpDir],
    machineName: "loopback-origin-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const preflight = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/terminal-chat`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:3001",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:3001");
});

test("requires gateway token when configured", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-auth-token-"));
  tempPathsToClean.push(tmpDir);
  const activityEvents: Array<{ type: string; statusCode: number; path: string; detail?: string }> = [];

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getGatewayAuthToken: () => "test-gateway-token",
    getAllowedDirectories: () => [tmpDir],
    machineName: "auth-token-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    onActivityEvent: (event) => {
      activityEvents.push({
        type: event.type,
        statusCode: event.statusCode,
        path: event.path,
        detail: event.detail
      });
    }
  });
  serversToClose.push(server);
  await server.start();

  const unauthorized = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "unauthorized" });

  const authorized = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`, {
    headers: {
      "x-desktop-gateway-token": "test-gateway-token"
    }
  });
  assert.equal(authorized.status, 501);

  assert.deepEqual(activityEvents, [
    {
      type: "security",
      statusCode: 401,
      path: "/api/engineer/unimplemented-route",
      detail: "unauthorized"
    },
    {
      type: "request",
      statusCode: 501,
      path: "/api/engineer/unimplemented-route",
      detail: undefined
    }
  ]);
});

test("accepts trusted browser origin without gateway token on loopback", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-origin-auth-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.closedloop.ai",
    getGatewayAuthToken: () => "test-gateway-token",
    getAllowedDirectories: () => [tmpDir],
    machineName: "origin-auth-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const trusted = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`, {
    headers: {
      Origin: "https://app.closedloop.ai"
    }
  });
  assert.equal(trusted.status, 501);

  const untrusted = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`, {
    headers: {
      Origin: "https://evil.example"
    }
  });
  assert.equal(untrusted.status, 401);
});

test("accepts localhost browser origin without gateway token", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-localhost-origin-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.closedloop.ai",
    getGatewayAuthToken: () => "test-gateway-token",
    getAllowedDirectories: () => [tmpDir],
    machineName: "localhost-origin-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const localhostOrigin = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`,
    {
      headers: {
        Origin: "http://localhost:3000"
      }
    }
  );
  assert.equal(localhostOrigin.status, 501);
});

test("accepts loopback browser request without origin header", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-no-origin-browser-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "http://localhost:3000",
    getGatewayAuthToken: () => "test-gateway-token",
    getAllowedDirectories: () => [tmpDir],
    machineName: "no-origin-browser-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`, {
    headers: {
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "cross-site",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
    }
  });

  assert.equal(response.status, 501);
});

test("keeps non-browser loopback request unauthorized without token", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-no-origin-non-browser-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "http://localhost:3000",
    getGatewayAuthToken: () => "test-gateway-token",
    getAllowedDirectories: () => [tmpDir],
    machineName: "no-origin-non-browser-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`);
  assert.equal(response.status, 401);
});

test("returns approval-required response when approval evaluator blocks engineer route", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-approval-gate-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "approval-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    evaluateApproval: () => ({
      allow: false,
      statusCode: 202,
      payload: {
        approvalRequired: true,
        approvalId: "approval-1",
        operationId: "health_check",
        message: "Manual approval required for health_check (high)"
      }
    })
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/health-check`);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    approvalRequired: true,
    approvalId: "approval-1",
    operationId: "health_check",
    message: "Manual approval required for health_check (high)"
  });
});

test("supports async approval evaluation before dispatch", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-approval-async-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "approval-async-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => path.join(tmpDir, "symphony-home"),
    evaluateApproval: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { allow: true };
    }
  });
  serversToClose.push(server);
  await server.start();

  const startedAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/sessions`);
  const durationMs = Date.now() - startedAt;
  assert.equal(response.status, 200);
  assert.ok(durationMs >= 25);
});

test("passes cloud approval headers into approval evaluator context", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-approval-headers-"));
  tempPathsToClean.push(tmpDir);
  let capturedRequest:
    | {
        source: string | null;
        forceApproval: boolean;
        approvalReason: string | null;
      }
    | null = null;

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "approval-header-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => path.join(tmpDir, "symphony-home"),
    evaluateApproval: (request) => {
      capturedRequest = {
        source: request.source,
        forceApproval: request.forceApproval,
        approvalReason: request.approvalReason
      };
      return { allow: true };
    }
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/sessions`, {
    headers: {
      "x-desktop-source": "cloud-socket",
      "x-desktop-force-approval": "1",
      "x-desktop-approval-reason": "Manual approval requested by relay policy"
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(capturedRequest, {
    source: "cloud-socket",
    forceApproval: true,
    approvalReason: "Manual approval requested by relay policy"
  });
});

test("falls back to the next configured port when preferred port is in use", async () => {
  const preferredPort = await findAvailablePort();
  const fallbackPort = await findAvailablePort([preferredPort]);

  const blocker = net.createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.listen(preferredPort, "127.0.0.1", () => resolve());
    blocker.once("error", reject);
  });
  blockersToClose.push(blocker);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-fallback-"));
  tempPathsToClean.push(tmpDir);
  const discoveryFile = path.join(tmpDir, "electron-port");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort,
    fallbackPorts: [fallbackPort],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "fallback-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: discoveryFile
  });
  serversToClose.push(server);

  await server.start();

  assert.equal(server.getActivePort(), fallbackPort);
  const discoveryPort = await fs.readFile(discoveryFile, "utf-8");
  assert.equal(Number(discoveryPort), fallbackPort);
});

test("supports symphony sessions CRUD with contract-compatible response envelopes", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-sessions-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-a");
  const worktreePath = path.join(tmpDir, "repo-a-AI-123");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(worktreePath, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "session-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => path.join(tmpDir, "symphony-home")
  });
  serversToClose.push(server);
  await server.start();

  const postResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticketId: "AI-123",
      repoPath,
      worktreePath,
      pid: 12345
    })
  });
  assert.equal(postResponse.status, 200);
  assert.deepEqual(await postResponse.json(), { success: true });

  const getResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/sessions`);
  assert.equal(getResponse.status, 200);
  const getBody = (await getResponse.json()) as { sessions: Array<{ ticketId: string; repoPath: string }> };
  assert.equal(getBody.sessions.length, 1);
  assert.equal(getBody.sessions[0]?.ticketId, "AI-123");
  assert.equal(getBody.sessions[0]?.repoPath, repoPath);

  const deleteResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/sessions?ticketId=AI-123`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });
});

test("rejects disallowed directories for symphony sessions writes (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-sessions-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });
  const disallowedRepoPath = path.join(tmpDir, "other", "repo");
  const disallowedWorktreePath = path.join(tmpDir, "other", "repo-AI-999");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "session-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => path.join(tmpDir, "symphony-home")
  });
  serversToClose.push(server);
  await server.start();

  const postResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticketId: "AI-999",
      repoPath: disallowedRepoPath,
      worktreePath: disallowedWorktreePath
    })
  });

  assert.equal(postResponse.status, 403);
  assert.deepEqual(await postResponse.json(), { error: "directory not allowed" });
});

test("returns symphony status envelope for existing state file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-status-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-status");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-status-AI-321");
  await fs.mkdir(path.join(worktreeDir, ".claude", "work"), { recursive: true });
  await fs.writeFile(
    path.join(worktreeDir, ".claude", "work", "state.json"),
    JSON.stringify({
      status: "STOPPED",
      phase: "Process stopped by user",
      timestamp: "2026-02-27T00:00:00.000Z"
    }),
    "utf-8"
  );
  await fs.writeFile(
    path.join(worktreeDir, ".claude", "work", "plan.json"),
    JSON.stringify({
      pendingTasks: [{ id: "task-2" }],
      completedTasks: [{ id: "task-1" }]
    }),
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "status-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/status/AI-321?repo=${encodeURIComponent(repoPath)}`
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    exists: boolean;
    stateExists: boolean;
    status: string;
    phase: string;
    currentTaskId?: string;
    taskProgress?: { pending: number; completed: number; total: number };
    worktreeDir: string;
  };
  assert.equal(body.exists, true);
  assert.equal(body.stateExists, true);
  assert.equal(body.status, "STOPPED");
  assert.equal(body.phase, "Process stopped by user");
  assert.equal(body.currentTaskId, "task-2");
  assert.deepEqual(body.taskProgress, { pending: 1, completed: 1, total: 2 });
  assert.equal(body.worktreeDir, worktreeDir);
});

test("rejects disallowed repo paths for symphony status (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-status-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  const repoPath = path.join(tmpDir, "disallowed-repo");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "status-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/status/AI-777?repo=${encodeURIComponent(repoPath)}`
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "directory not allowed" });
});

test("marks state as stopped when killing by ticket without PID file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-kill-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-kill");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-kill-AI-444");
  const workDir = path.join(worktreeDir, ".claude", "work");
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(
    path.join(workDir, "state.json"),
    JSON.stringify({ status: "IN_PROGRESS", phase: "Running" }),
    "utf-8"
  );
  await fs.writeFile(path.join(worktreeDir, ".claude", "symphony-loop.local.md"), "loop-state", "utf-8");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "kill-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const killResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/kill`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticketId: "AI-444", repoPath })
  });
  assert.equal(killResponse.status, 200);
  assert.deepEqual(await killResponse.json(), {
    success: true,
    message: "No process to kill (no PID file), state marked as stopped"
  });

  const stateAfterKill = JSON.parse(await fs.readFile(path.join(workDir, "state.json"), "utf-8")) as {
    status: string;
    phase: string;
  };
  assert.equal(stateAfterKill.status, "STOPPED");
  assert.equal(stateAfterKill.phase, "Process stopped by user");
  await assert.rejects(
    fs.readFile(path.join(worktreeDir, ".claude", "symphony-loop.local.md"), "utf-8")
  );
});

test("rejects disallowed repo paths for symphony kill (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-kill-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "kill-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const killResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/kill`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticketId: "AI-555",
      repoPath: path.join(tmpDir, "disallowed", "repo")
    })
  });

  assert.equal(killResponse.status, 403);
  assert.deepEqual(await killResponse.json(), { error: "directory not allowed" });
});

test("returns plan content envelope for symphony plan route", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-plan-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-plan");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-plan-AI-777");
  const workDir = path.join(worktreeDir, ".claude", "work");
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(
    path.join(workDir, "plan.json"),
    JSON.stringify({
      title: "Ticket AI-777",
      description: "Implement feature",
      content: "line1\\nline2"
    }),
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "plan-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/plan/AI-777?repo=${encodeURIComponent(repoPath)}`
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { exists: boolean; planExists: boolean; content: string; worktreeDir: string };
  assert.equal(body.exists, true);
  assert.equal(body.planExists, true);
  assert.equal(body.content, "line1\nline2");
  assert.equal(body.worktreeDir, worktreeDir);
});

test("supports chat history CRUD operations", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-chat-history-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-chat");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-chat-AI-888");
  await fs.mkdir(path.join(worktreeDir, ".claude", "work"), { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "chat-history-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const postSessionResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/chat-history/AI-888?repo=${encodeURIComponent(repoPath)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1" })
    }
  );
  assert.equal(postSessionResponse.status, 200);
  assert.deepEqual(await postSessionResponse.json(), { success: true, sessionId: "session-1" });

  const postMessageResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/chat-history/AI-888?repo=${encodeURIComponent(repoPath)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          id: "m1",
          role: "user",
          content: "hello",
          timestamp: "2026-02-27T00:00:00.000Z"
        }
      })
    }
  );
  assert.equal(postMessageResponse.status, 200);

  const getResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/chat-history/AI-888?repo=${encodeURIComponent(repoPath)}`
  );
  assert.equal(getResponse.status, 200);
  const getBody = (await getResponse.json()) as { sessionId?: string; messages: Array<{ content: string }> };
  assert.equal(getBody.sessionId, "session-1");
  assert.equal(getBody.messages.length, 1);
  assert.equal(getBody.messages[0]?.content, "hello");

  const deleteResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/chat-history/AI-888?repo=${encodeURIComponent(repoPath)}`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true, message: "Chat history cleared" });
});

test("returns jsonl log format when claude-output.jsonl exists", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-logs-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-logs");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-logs-AI-999");
  const workDir = path.join(worktreeDir, ".claude", "work");
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(
    path.join(workDir, "claude-output.jsonl"),
    "{\"type\":\"text\",\"text\":\"a\"}\n{\"type\":\"text\",\"text\":\"b\"}\n",
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "logs-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/logs/AI-999?repo=${encodeURIComponent(repoPath)}&lines=1`
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { format: string; lines?: string[]; returnedLines?: number };
  assert.equal(body.format, "jsonl");
  assert.equal(body.returnedLines, 1);
  assert.deepEqual(body.lines, ['{"type":"text","text":"b"}']);
});

test("returns judges payload when judges.json exists", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-judges-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-judges");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-judges-AI-456");
  const workDir = path.join(worktreeDir, ".claude", "work");
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(
    path.join(workDir, "judges.json"),
    JSON.stringify({ score: 5, summary: "Looks good" }),
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "judges-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/judges/AI-456?repo=${encodeURIComponent(repoPath)}`
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { exists: boolean; isMock: boolean; data?: { score: number } };
  assert.equal(body.exists, true);
  assert.equal(body.isMock, false);
  assert.equal(body.data?.score, 5);
});

test("serves attachment binary from wildcard route", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-attachments-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-attachments");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-attachments-AI-111");
  const attachmentsDir = path.join(worktreeDir, ".claude", "work", "attachments");
  await fs.mkdir(attachmentsDir, { recursive: true });
  const imageFile = path.join(attachmentsDir, "image.png");
  await fs.writeFile(imageFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "attachments-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/attachments/AI-111/image.png?repo=${encodeURIComponent(repoPath)}`
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...buffer], [0x89, 0x50, 0x4e, 0x47]);
});

test("uploads image attachments and returns file metadata", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-upload-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-upload");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-upload-AI-222");
  await fs.mkdir(path.join(worktreeDir, ".claude", "work"), { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "upload-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const formData = new FormData();
  formData.append("file", new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }), "test.png");

  const uploadResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/upload/AI-222?repo=${encodeURIComponent(
      repoPath
    )}`,
    {
      method: "POST",
      body: formData
    }
  );
  assert.equal(uploadResponse.status, 200);
  const uploadBody = (await uploadResponse.json()) as {
    files: Array<{ originalName: string; apiUrl: string; savedName: string }>;
  };
  assert.equal(uploadBody.files.length, 1);
  assert.equal(uploadBody.files[0]?.originalName, "test.png");
  assert.equal(uploadBody.files[0]?.savedName.startsWith("chat-img-"), true);

  const attachmentResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}${uploadBody.files[0]?.apiUrl}`
  );
  assert.equal(attachmentResponse.status, 200);
  assert.equal(attachmentResponse.headers.get("content-type"), "image/png");
});

test("returns health-check response envelope with required check structure", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-health-check-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "health-check-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => path.join(tmpDir, "symphony-home")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/health-check`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    checks: Array<{ id: string; label: string; required: boolean; passed: boolean }>;
    allRequiredPassed: boolean;
  };

  assert.equal(Array.isArray(body.checks), true);
  assert.equal(typeof body.allRequiredPassed, "boolean");
  assert.equal(body.checks.some((check) => check.id === "git"), true);
  assert.equal(body.checks.some((check) => check.id === "claude-cli"), true);
  assert.equal(body.checks.every((check) => typeof check.passed === "boolean"), true);
});

test("health-check returns 200 with worktree-dir failed when getSymphonyDir throws", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-health-unconfigured-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "health-unconfigured-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => { throw new SymphonyDirNotConfiguredError(); }
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/health-check`);
  assert.equal(response.status, 200, "health-check should return 200 even when unconfigured");
  const body = (await response.json()) as {
    checks: Array<{ id: string; passed: boolean; error?: string }>;
    allRequiredPassed: boolean;
  };

  const worktreeCheck = body.checks.find((check) => check.id === "worktree-dir");
  assert.ok(worktreeCheck, "worktree-dir check should be present");
  assert.equal(worktreeCheck.passed, false, "worktree-dir should fail when unconfigured");
  assert.equal(worktreeCheck.error, "Not configured");
});

test("repos-config returns 503 when getSymphonyDir throws (not 500)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-repos-unconfigured-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "repos-unconfigured-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => { throw new SymphonyDirNotConfiguredError(); }
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/repos`);
  assert.equal(response.status, 503, "repos should return 503 when symphony dir not configured");
  const body = (await response.json()) as { error: string };
  assert.ok(body.error.includes("not configured"), "error message should mention configuration");
});

test("tryAssertRepoAllowed returns path on success and error on disallowed", () => {
  const allowed = ["/allowed/dir"];

  const success = tryAssertRepoAllowed("/allowed/dir/repo", allowed);
  assert.ok("path" in success, "should return path on allowed directory");
  assert.equal((success as { path: string }).path, "/allowed/dir/repo");

  const failure = tryAssertRepoAllowed("/other/dir/repo", allowed);
  assert.ok("error" in failure, "should return error on disallowed directory");
  assert.equal((failure as { error: string; status: number }).status, 403);
});

test("tryAssertPathAllowed returns true on success and error on disallowed", () => {
  const allowed = ["/allowed/dir"];

  const success = tryAssertPathAllowed("/allowed/dir/sub", allowed);
  assert.equal(success, true, "should return true on allowed path");

  const failure = tryAssertPathAllowed("/other/dir/sub", allowed);
  assert.ok(failure !== true, "should return error on disallowed path");
  assert.equal((failure as { error: string; status: number }).status, 403);
});

test("supports repos config CRUD and settings patch", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-repos-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-configured");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({ name: "repo-configured", dependencies: { next: "15.0.0" } }),
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "repos-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => path.join(tmpDir, "symphony-home")
  });
  serversToClose.push(server);
  await server.start();

  const postResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/repos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: repoPath, description: "test repo" })
  });
  assert.equal(postResponse.status, 200);
  const postBody = (await postResponse.json()) as { success: boolean; repo?: { path: string } };
  assert.equal(postBody.success, true);
  assert.equal(postBody.repo?.path.endsWith("repo-configured"), true);

  const patchResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/repos`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ worktreeParentDir: "~/tmp", worktreeParentDirConfirmed: true })
  });
  assert.equal(patchResponse.status, 200);
  assert.deepEqual(await patchResponse.json(), { success: true });

  const getResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/repos`);
  assert.equal(getResponse.status, 200);
  const getBody = (await getResponse.json()) as { repos: Array<{ path: string }>; settings: { worktreeParentDir?: string } };
  assert.equal(getBody.repos.length, 1);
  assert.equal(getBody.settings.worktreeParentDir, "~/tmp");

  const deleteResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/repos?path=${encodeURIComponent(repoPath)}`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });
});

test("lists directories and supports file search endpoint", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-filesystem-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-search");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "src", "Widget.tsx"), "export const Widget = () => null;", "utf-8");

  const worktreeDir = path.join(worktreeParent, "repo-search-AI-121");
  await fs.mkdir(path.join(worktreeDir, "src"), { recursive: true });
  await fs.writeFile(path.join(worktreeDir, "src", "WidgetPanel.tsx"), "export const WidgetPanel = () => null;", "utf-8");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "filesystem-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const directoriesResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${encodeURIComponent(tmpDir)}`
  );
  assert.equal(directoriesResponse.status, 200);
  const directoriesBody = (await directoriesResponse.json()) as {
    directories: Array<{ name: string; isDirectory: boolean }>;
  };
  assert.equal(directoriesBody.directories.some((entry) => entry.name === "repo-search"), true);

  const searchResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/files/search?repo=${encodeURIComponent(
      repoPath
    )}&ticket=AI-121&query=Widget`
  );
  assert.equal(searchResponse.status, 200);
  const searchBody = (await searchResponse.json()) as { files: string[]; truncated: boolean };
  assert.equal(searchBody.files.some((file) => file.includes("WidgetPanel.tsx")), true);
  assert.equal(typeof searchBody.truncated, "boolean");
});

test("supports terminal chat history GET and DELETE", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-terminal-chat-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "terminal-chat-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => tmpDir
  });
  serversToClose.push(server);
  await server.start();

  const getResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/terminal-chat`);
  assert.equal(getResponse.status, 200);
  const getBody = (await getResponse.json()) as { messages: unknown[] };
  assert.equal(Array.isArray(getBody.messages), true);

  const deleteResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/terminal-chat`, {
    method: "DELETE"
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });
});

test("supports ticket chat GET and DELETE with ticketId", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-ticket-chat-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "ticket-chat-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => tmpDir
  });
  serversToClose.push(server);
  await server.start();

  const getResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/ticket-chat?ticketId=AI-200`
  );
  assert.equal(getResponse.status, 200);
  const getBody = (await getResponse.json()) as { ticketId?: string; messages: unknown[] };
  assert.equal(getBody.ticketId, "AI-200");
  assert.equal(Array.isArray(getBody.messages), true);

  const deleteResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/ticket-chat?ticketId=AI-200`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });
});

test("rejects disallowed repo path for ticket chat POST before spawn (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-ticket-chat-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "ticket-chat-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => tmpDir
  });
  serversToClose.push(server);
  await server.start();

  const postResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/ticket-chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticketId: "AI-333",
      message: "analyze",
      ticketContext: {
        identifier: "AI-333",
        title: "Title",
        url: "https://linear.app/ai-333"
      },
      repoPath: path.join(tmpDir, "not-allowed", "repo")
    })
  });
  assert.equal(postResponse.status, 403);
  assert.deepEqual(await postResponse.json(), { error: "directory not allowed" });
});

test("supports run viewer chat history GET and DELETE", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-run-viewer-chat-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "run-viewer-chat-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => tmpDir
  });
  serversToClose.push(server);
  await server.start();

  const getResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/run-viewer-chat`);
  assert.equal(getResponse.status, 200);
  const getBody = (await getResponse.json()) as { messages: unknown[] };
  assert.equal(Array.isArray(getBody.messages), true);

  const deleteResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/run-viewer-chat`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });
});

test("rejects disallowed run directory for run viewer chat POST (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-run-viewer-chat-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "run-viewer-chat-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => tmpDir
  });
  serversToClose.push(server);
  await server.start();

  const postResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/run-viewer-chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "analyze",
      runDir: path.join(tmpDir, "not-allowed")
    })
  });

  assert.equal(postResponse.status, 403);
  assert.deepEqual(await postResponse.json(), { error: "directory not allowed" });
});

test("lists and cleans up extracted run-viewer directories", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-run-viewer-extract-"));
  tempPathsToClean.push(tmpDir);

  const runDir = path.join(os.tmpdir(), `run-viewer-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
  tempPathsToClean.push(runDir);
  await fs.mkdir(path.join(runDir, "nested"), { recursive: true });
  await fs.writeFile(path.join(runDir, "nested", "trace.log"), "hello", "utf-8");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "run-viewer-extract-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const getResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/run-viewer-extract?runDir=${encodeURIComponent(
      runDir
    )}`
  );
  assert.equal(getResponse.status, 200);
  assert.deepEqual(await getResponse.json(), { files: ["nested/trace.log"] });

  const deleteResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/run-viewer-extract`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runDir })
    }
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });
  await assert.rejects(fs.stat(runDir));
});

test("validates run-viewer-extract POST multipart payload", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-run-viewer-extract-post-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "run-viewer-extract-post-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/run-viewer-extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "bad" })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid form data" });
});

test("proxies unimplemented engineer routes to fallback origin when configured", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-fallback-proxy-"));
  tempPathsToClean.push(tmpDir);

  const upstream = http.createServer((_req, res) => {
    const payload = JSON.stringify({ proxied: true, source: "upstream" });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(payload);
  });
  await new Promise<void>((resolve, reject) => {
    upstream.listen(0, "127.0.0.1", () => resolve());
    upstream.once("error", reject);
  });
  blockersToClose.push(upstream);

  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string") {
    throw new Error("failed to resolve upstream address");
  }

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    fallbackEngineerOrigin: `http://127.0.0.1:${upstreamAddress.port}`,
    machineName: "fallback-proxy-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { proxied: true, source: "upstream" });
});

test("supports core git action routes", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-git-action-"));
  tempPathsToClean.push(tmpDir);
  const repoPath = path.join(tmpDir, "repo-git");
  await fs.mkdir(repoPath, { recursive: true });

  await execFileAsync("git", ["init"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "# Hello\n", "utf-8");
  await execFileAsync("git", ["add", "."], { cwd: repoPath });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repoPath });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "git-action-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const statusResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/git`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "status", repoPath })
  });
  assert.equal(statusResponse.status, 200);
  const statusBody = (await statusResponse.json()) as { hasChanges: boolean; currentBranch: string };
  assert.equal(statusBody.hasChanges, false);
  assert.equal(typeof statusBody.currentBranch, "string");

  const branchResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/git`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "branch", branchName: "feature/AI-501", repoPath })
  });
  assert.equal(branchResponse.status, 200);
  const branchBody = (await branchResponse.json()) as { success: boolean; branchName: string };
  assert.equal(branchBody.success, true);
  assert.equal(branchBody.branchName, "feature/AI-501");

  const branchesResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/git/branches?repo=${encodeURIComponent(repoPath)}`
  );
  assert.equal(branchesResponse.status, 200);
  const branchesBody = (await branchesResponse.json()) as { branches: Array<{ name: string }> };
  assert.equal(branchesBody.branches.some((branch) => branch.name === "feature/AI-501"), true);
});

test("supports git diff route for working tree changes", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-git-diff-"));
  tempPathsToClean.push(tmpDir);
  const repoPath = path.join(tmpDir, "repo-git-diff");
  await fs.mkdir(repoPath, { recursive: true });

  await execFileAsync("git", ["init"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "app.ts"), "export const value = 1;\n", "utf-8");
  await execFileAsync("git", ["add", "."], { cwd: repoPath });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "app.ts"), "export const value = 2;\n", "utf-8");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "git-diff-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const diffResponse = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/git/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repoPath,
      filePath: "app.ts"
    })
  });
  assert.equal(diffResponse.status, 200);
  const diffBody = (await diffResponse.json()) as { oldContent: string; newContent: string; isDeleted: boolean };
  assert.equal(diffBody.oldContent.includes("value = 1"), true);
  assert.equal(diffBody.newContent.includes("value = 2"), true);
  assert.equal(diffBody.isDeleted, false);
});

test("validates git PR create request payload", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-git-pr-validate-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "git-pr-validate-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/git/pr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Missing repo" })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "repoPath is required" });
});

test("rejects disallowed repo for git PR list endpoint (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-git-pr-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "git-pr-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/git/pr/list?repo=${encodeURIComponent(
      path.join(tmpDir, "not-allowed", "repo")
    )}`
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "directory not allowed" });
});

test("returns empty work-directory result when no session or worktree exists", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-work-dir-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "work-dir-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => path.join(tmpDir, "symphony-home")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/work-directory/AI-999`
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    exists: false,
    path: null,
    pendingClaudeMd: null,
    branchStatus: null
  });
});

test("rejects disallowed workDir on aggregate symphony status route (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-status-all-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "status-all-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/status?workDir=${encodeURIComponent(
      path.join(tmpDir, "not-allowed")
    )}`
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "directory not allowed" });
});

test("detects deploy config from repo scripts", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-deploy-detect-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-deploy");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({ scripts: { dev: "next dev -p 3100" }, dependencies: { next: "15.0.0" } }),
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "deploy-detect-machine",
    version: "0.1.0-test",
    getSymphonyDir: () => path.join(tmpDir, "symphony-home"),
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/deploy/detect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repoPath })
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    detected: boolean;
    config?: { command?: string; port?: number; framework?: string };
  };
  assert.equal(body.detected, true);
  assert.equal(body.config?.framework, "next");
  assert.equal(body.config?.port, 3100);
  assert.equal(typeof body.config?.command, "string");
});

test("rejects disallowed repo/worktree for deploy check-existing (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-deploy-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "deploy-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/deploy/check-existing`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repoPath: path.join(tmpDir, "not-allowed", "repo"),
        worktreePath: path.join(tmpDir, "not-allowed", "repo-AI-1")
      })
    }
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "directory not allowed" });
});

test("validates required fields for symphony extract-learnings route", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-learnings-validate-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "learnings-validate-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/extract-learnings`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoPath: "/tmp/repo" })
    }
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "ticketId and repoPath are required" });
});

test("returns skipped status when no learnings are pending", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-learnings-process-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-learning");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(path.join(worktreeParent, "repo-learning-AI-101", ".claude", "work"), {
    recursive: true
  });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "learnings-process-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/process-learnings`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: "AI-101", repoPath })
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "skipped",
    reason: "No pending learnings directory"
  });
});

test("invokes plugin cache discovery when pending learnings exist", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-learnings-plugin-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-plugin");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await fs.mkdir(repoPath, { recursive: true });
  const pendingDir = path.join(
    worktreeParent,
    "repo-plugin-PLG-01",
    ".claude",
    "work",
    ".learnings",
    "pending"
  );
  await fs.mkdir(pendingDir, { recursive: true });
  await fs.writeFile(path.join(pendingDir, "learning-1.json"), "{}");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "learnings-plugin-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/process-learnings`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: "PLG-01", repoPath })
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.status, "processing");
  // pid is null (no plugin cache) or a number (plugin found and script spawned)
  assert.ok(body.pid === null || typeof body.pid === "number", "pid should be null or a number");

  // Allow the fire-and-forget status write to complete before cleanup
  await new Promise((resolve) => setTimeout(resolve, 400));
});

test("rejects disallowed repo path for record-learning-use (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-learnings-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "learnings-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/record-learning-use`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticketId: "AI-202",
        repoPath: path.join(tmpDir, "not-allowed", "repo"),
        learnings: [{ summary: "Use memoization for large lists" }]
      })
    }
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "directory not allowed" });
});

test("validates required fields for symphony chat route", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-symphony-chat-validate-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "symphony-chat-validate-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/chat/AI-909`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoPath: "/tmp/repo" })
    }
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "message and repoPath are required" });
});

test("validates required query params for symphony comment-chat GET", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-comment-chat-validate-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "comment-chat-validate-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/comment-chat/c-1`
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "ticketId and repo parameters are required" });
});

test("returns default commit message when worktree does not exist", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-commit-message-default-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-commit");
  await fs.mkdir(repoPath, { recursive: true });
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = path.join(tmpDir, "worktrees");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "commit-message-default-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/commit-message/AI-123?repo=${encodeURIComponent(
      repoPath
    )}`
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    title: "Work on AI-123",
    description: "",
    source: "default"
  });
});

test("rejects disallowed repo for symphony launch (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-launch-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "launch-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticketIdentifier: "AI-123",
      repoPath: path.join(tmpDir, "not-allowed", "repo")
    })
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "directory not allowed" });
});

test("symphony launch invokes plugin cache discovery for run-loop script", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-launch-plugin-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-launch");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await fs.mkdir(repoPath, { recursive: true });
  // Pre-create worktree dir so the route skips git worktree creation
  await fs.mkdir(path.join(worktreeParent, "repo-launch-LAUNCH-01"), { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "launch-plugin-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/launch`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticketIdentifier: "LAUNCH-01",
        repoPath
      })
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.success, true);
  assert.equal(body.ticketId, "LAUNCH-01");
  // pid is null (no plugin cache) or a number (plugin found and script spawned)
  assert.ok(body.pid === null || typeof body.pid === "number", "pid should be null or a number");
});

test("validates required fields for codex chat route", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-codex-chat-validate-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "codex-chat-validate-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/codex/chat/AI-111`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" })
    }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "prompt and repoPath are required" });
});

test("rejects disallowed repo for codex status route (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-codex-status-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [allowedDir],
    machineName: "codex-status-deny-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/codex/status/AI-333?repo=${encodeURIComponent(
      path.join(tmpDir, "not-allowed", "repo")
    )}`
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "directory not allowed" });
});

async function findAvailablePort(excluded: number[] = []): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("failed to resolve an available port")));
        return;
      }
      const port = address.port;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (excluded.includes(port)) {
          resolve(findAvailablePort(excluded));
          return;
        }
        resolve(port);
      });
    });
  });
}
