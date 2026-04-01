import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DesktopGatewayServer } from "../src/server/server.js";
import { saveCodexChatSession } from "../src/server/operations/codex.js";
import { EMPTY_CAPABILITIES } from "../src/shared/contracts.js";
import { resetShellPathCache, setShellPathForTest } from "../src/server/shell-path.js";
import { SymphonyDirNotConfiguredError, tryAssertRepoAllowed, tryAssertPathAllowed } from "../src/server/operations/symphony-utils.js";
import { JobStore } from "../src/main/job-store.js";
import type { LocalJob, LocalJobStatus } from "../src/main/job-store.js";

const serversToClose: DesktopGatewayServer[] = [];
const blockersToClose: net.Server[] = [];
const tempPathsToClean: string[] = [];
const childPidsToKill: number[] = [];
const originalSymphonyWorktreeParentDir = process.env.SYMPHONY_WORKTREE_PARENT_DIR;
const originalHome = process.env.HOME;
const originalPath = process.env.PATH;

afterEach(async () => {
  if (originalSymphonyWorktreeParentDir === undefined) {
    delete process.env.SYMPHONY_WORKTREE_PARENT_DIR;
  } else {
    process.env.SYMPHONY_WORKTREE_PARENT_DIR = originalSymphonyWorktreeParentDir;
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  resetShellPathCache();

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

  for (const pid of childPidsToKill.splice(0)) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  }

  for (const tempPath of tempPathsToClean.splice(0)) {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

test("uses closedloop-ai discovery file path by default", () => {
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    "Content-Type,Authorization,X-Desktop-Gateway-Token,X-Desktop-Session-Token,X-Desktop-Source,X-Desktop-Force-Approval,X-Desktop-Approval-Reason"
  );
});

test("returns private-network CORS allow header for terminal-chat preflight", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-pna-preflight-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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

test("normal mode: 127.0.0.2 loopback variant echoed back in CORS preflight", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-127-2-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.closedloop.ai",
    getAllowedDirectories: () => [tmpDir],
    machineName: "loopback-127-2-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const preflight = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/terminal-chat`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.2:8080",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.2:8080");
});

test("normal mode: DNS name like 127.evil.com is NOT treated as loopback", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-127-evil-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.closedloop.ai",
    getAllowedDirectories: () => [tmpDir],
    machineName: "loopback-evil-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const preflight = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/terminal-chat`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.evil.com:8080",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });

  assert.equal(preflight.status, 204);
  // Should NOT echo back the spoofed origin -- falls back to configured origin
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.closedloop.ai");
});

test("prodOriginsOnly: preflight from loopback returns configured origin, no PNA header", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-prod-loopback-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.closedloop.ai",
    getAllowedDirectories: () => [tmpDir],
    machineName: "prod-loopback-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    prodOriginsOnly: true
  });
  serversToClose.push(server);
  await server.start();

  const preflight = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/terminal-chat`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
      "Access-Control-Request-Private-Network": "true"
    }
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.closedloop.ai");
  assert.equal(preflight.headers.get("access-control-allow-private-network"), null);
});

test("prodOriginsOnly: preflight from configured origin returns correct CORS + PNA header", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-prod-configured-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.closedloop.ai",
    getAllowedDirectories: () => [tmpDir],
    machineName: "prod-configured-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    prodOriginsOnly: true
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
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
});

test("prodOriginsOnly: preflight from random origin returns configured origin", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-prod-random-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.closedloop.ai",
    getAllowedDirectories: () => [tmpDir],
    machineName: "prod-random-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    prodOriginsOnly: true
  });
  serversToClose.push(server);
  await server.start();

  const preflight = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/terminal-chat`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://random.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.closedloop.ai");
});

test("prodOriginsOnly: loopback webAppOrigin preflight from that origin echoes it back", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-prod-loopback-webapp-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "http://localhost:3000",
    getAllowedDirectories: () => [tmpDir],
    machineName: "prod-loopback-webapp-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    prodOriginsOnly: true
  });
  serversToClose.push(server);
  await server.start();

  const preflight = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/terminal-chat`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:3000");
});

test("requires gateway token when configured", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-auth-token-"));
  tempPathsToClean.push(tmpDir);
  const activityEvents: Array<{ type: string; statusCode: number; path: string; detail?: string }> = [];

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
  const body = await unauthorized.json() as { error: string; reason?: string };
  assert.equal(body.error, "unauthorized");

  const authorized = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`, {
    headers: {
      "x-desktop-gateway-token": "test-gateway-token"
    }
  });
  assert.equal(authorized.status, 501);

  assert.equal(activityEvents.length, 2);
  assert.equal(activityEvents[0].type, "security");
  assert.equal(activityEvents[0].statusCode, 401);
  assert.equal(activityEvents[0].path, "/api/engineer/unimplemented-route");
  assert.equal(activityEvents[1].type, "request");
  assert.equal(activityEvents[1].statusCode, 501);
  assert.equal(activityEvents[1].path, "/api/engineer/unimplemented-route");
});

test("rejects trusted browser origin without session token (origin-only bypass removed)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-origin-auth-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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

  // Trusted origin alone is no longer sufficient — session token required
  const trusted = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`, {
    headers: {
      Origin: "https://app.closedloop.ai"
    }
  });
  assert.equal(trusted.status, 401);

  const untrusted = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/unimplemented-route`, {
    headers: {
      Origin: "https://evil.example"
    }
  });
  assert.equal(untrusted.status, 401);
});

test("rejects localhost browser origin without session token", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-localhost-origin-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
  assert.equal(localhostOrigin.status, 401);
});

test("rejects loopback browser request without origin or session token", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-no-origin-browser-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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

  assert.equal(response.status, 401);
});

test("keeps non-browser loopback request unauthorized without token", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-no-origin-non-browser-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
  await fs.mkdir(path.join(worktreeDir, ".closedloop-ai", "work"), { recursive: true });
  await fs.writeFile(
    path.join(worktreeDir, ".closedloop-ai", "work", "state.json"),
    JSON.stringify({
      status: "STOPPED",
      phase: "Process stopped by user",
      timestamp: "2026-02-27T00:00:00.000Z"
    }),
    "utf-8"
  );
  await fs.writeFile(
    path.join(worktreeDir, ".closedloop-ai", "work", "plan.json"),
    JSON.stringify({
      pendingTasks: [{ id: "task-2" }],
      completedTasks: [{ id: "task-1" }]
    }),
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(
    path.join(workDir, "state.json"),
    JSON.stringify({ status: "IN_PROGRESS", phase: "Running" }),
    "utf-8"
  );
  await fs.mkdir(path.join(worktreeDir, ".closedloop-ai"), { recursive: true });
  await fs.writeFile(path.join(worktreeDir, ".closedloop-ai", "symphony-loop.local.md"), "loop-state", "utf-8");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
    fs.readFile(path.join(worktreeDir, ".closedloop-ai", "symphony-loop.local.md"), "utf-8")
  );
});

test("rejects disallowed repo paths for symphony kill (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-kill-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
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
    preferredPort: 0,
    fallbackPorts: [0],
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
  await fs.mkdir(path.join(worktreeDir, ".closedloop-ai", "work"), { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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

test("supports provider-scoped chat history with isolated CRUD", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-chat-provider-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-provider");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-provider-AI-900");
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
  await fs.mkdir(workDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "provider-scope-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const base = `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/chat-history/AI-900`;
  const repo = `repo=${encodeURIComponent(repoPath)}`;

  // POST with provider=claude → writes to chat-history-claude.json
  const postClaude = await fetch(`${base}?${repo}&provider=claude`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: { id: "c1", role: "user", content: "claude msg", timestamp: "2026-03-11T00:00:00.000Z" }
    })
  });
  assert.equal(postClaude.status, 200);

  // POST with provider=codex → writes to chat-history-codex.json
  const postCodex = await fetch(`${base}?${repo}&provider=codex`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: { id: "x1", role: "user", content: "codex msg", timestamp: "2026-03-11T00:00:01.000Z" }
    })
  });
  assert.equal(postCodex.status, 200);

  // GET with provider=claude → reads only Claude's history
  // No codex-chat-review.json yet, so codexSessionExists should be false
  const getClaude = await fetch(`${base}?${repo}&provider=claude`);
  assert.equal(getClaude.status, 200);
  const claudeBody = (await getClaude.json()) as { messages: Array<{ content: string }>; codexSessionExists: boolean };
  assert.equal(claudeBody.messages.length, 1);
  assert.equal(claudeBody.messages[0]?.content, "claude msg");
  assert.equal(claudeBody.codexSessionExists, false);

  // GET with provider=codex → reads only Codex's history + codexSessionExists still false
  const getCodex = await fetch(`${base}?${repo}&provider=codex`);
  assert.equal(getCodex.status, 200);
  const codexBody = (await getCodex.json()) as { messages: Array<{ content: string }>; codexSessionExists: boolean };
  assert.equal(codexBody.messages.length, 1);
  assert.equal(codexBody.messages[0]?.content, "codex msg");
  assert.equal(codexBody.codexSessionExists, false);

  // Seed a codex-chat-review.json to test scoped DELETE cleanup AND codexSessionExists=true
  await fs.writeFile(
    path.join(workDir, "codex-chat-review.json"),
    JSON.stringify({ sessionId: "review-session" }),
    "utf-8"
  );

  // GET after seeding codex-chat-review.json → codexSessionExists should now be true
  const getCodexWithSession = await fetch(`${base}?${repo}&provider=codex`);
  assert.equal(getCodexWithSession.status, 200);
  const codexWithSession = (await getCodexWithSession.json()) as { codexSessionExists: boolean };
  assert.equal(codexWithSession.codexSessionExists, true);

  // DELETE with provider=claude → removes only chat-history-claude.json, leaves codex files
  const deleteClaude = await fetch(`${base}?${repo}&provider=claude`, { method: "DELETE" });
  assert.equal(deleteClaude.status, 200);

  // Verify codex history + review file still exist
  const getCodexAfter = await fetch(`${base}?${repo}&provider=codex`);
  const codexAfter = (await getCodexAfter.json()) as { messages: Array<{ content: string }> };
  assert.equal(codexAfter.messages.length, 1);
  const reviewFileExists = await fs.access(path.join(workDir, "codex-chat-review.json")).then(() => true, () => false);
  assert.equal(reviewFileExists, true);

  // DELETE with provider=codex → removes chat-history-codex.json AND codex-chat-review.json
  const deleteCodex = await fetch(`${base}?${repo}&provider=codex`, { method: "DELETE" });
  assert.equal(deleteCodex.status, 200);
  const reviewFileGone = await fs.access(path.join(workDir, "codex-chat-review.json")).then(() => false, () => true);
  assert.equal(reviewFileGone, true);

  // DELETE without provider → blanket cleanup (backward compat)
  // Re-seed files first
  await fs.writeFile(path.join(workDir, "chat-history.json"), JSON.stringify({ messages: [], ticketId: "AI-900", repoPath }), "utf-8");
  await fs.writeFile(path.join(workDir, "codex-chat.json"), JSON.stringify({ sessionId: "s1" }), "utf-8");
  const deleteBlanket = await fetch(`${base}?${repo}`, { method: "DELETE" });
  assert.equal(deleteBlanket.status, 200);
  const codexChatGone = await fs.access(path.join(workDir, "codex-chat.json")).then(() => false, () => true);
  assert.equal(codexChatGone, true);

  // Invalid provider → 400
  const badProvider = await fetch(`${base}?${repo}&provider=openai`);
  assert.equal(badProvider.status, 400);
});

test("returns jsonl log format when claude-output.jsonl exists", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-logs-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-logs");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-logs-AI-999");
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(
    path.join(workDir, "claude-output.jsonl"),
    "{\"type\":\"text\",\"text\":\"a\"}\n{\"type\":\"text\",\"text\":\"b\"}\n",
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(
    path.join(workDir, "judges.json"),
    JSON.stringify({ score: 5, summary: "Looks good" }),
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
  const attachmentsDir = path.join(worktreeDir, ".closedloop-ai", "work", "attachments");
  await fs.mkdir(attachmentsDir, { recursive: true });
  const imageFile = path.join(attachmentsDir, "image.png");
  await fs.writeFile(imageFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
  await fs.mkdir(path.join(worktreeDir, ".closedloop-ai", "work"), { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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

  // Fake git binary: handles the subcommands the route exercises without
  // requiring a real git repository.
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  const fakeGitScript = [
    "#!/bin/sh",
    'case "$1" in',
    '  rev-parse) echo "main" ;;',
    '  status) exit 0 ;;',
    '  branch)',
    '    case "$2" in',
    '      --list) exit 0 ;;',
    '      --show-current) echo "main" ;;',
    '      -a) printf "main|\\nfeature/AI-501|\\n" ;;',
    '      *) exit 0 ;;',
    '    esac',
    '    ;;',
    '  checkout) exit 0 ;;',
    '  symbolic-ref) exit 1 ;;',
    '  worktree) exit 0 ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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

  // Write the "current" file on disk (new content read directly by the route handler).
  await fs.writeFile(path.join(repoPath, "app.ts"), "export const value = 2;\n", "utf-8");

  // Fake git binary: status reports the file as modified; show returns the old content.
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  const fakeGitScript = [
    "#!/bin/sh",
    'case "$1" in',
    '  status) printf " M app.ts\\n" ;;',
    '  show) printf "export const value = 1;\\n" ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
  await fs.mkdir(path.join(worktreeParent, "repo-learning-AI-101", ".closedloop-ai", "work"), {
    recursive: true
  });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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

  // Isolate HOME so a developer's real ~/.claude/plugins/cache never spawns a real wrapper.
  const isolatedHome = path.join(tmpDir, "isolated-home");
  await fs.mkdir(isolatedHome, { recursive: true });
  process.env.HOME = isolatedHome;

  const repoPath = path.join(tmpDir, "repo-plugin");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await fs.mkdir(repoPath, { recursive: true });
  const pendingDir = path.join(
    worktreeParent,
    "repo-plugin-PLG-01",
    ".closedloop-ai",
    "work",
    ".learnings",
    "pending"
  );
  await fs.mkdir(pendingDir, { recursive: true });
  await fs.writeFile(path.join(pendingDir, "learning-1.json"), "{}");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
  assert.equal(body.pid, null, "with isolated HOME and no plugin cache, no real script should spawn");

  // Allow the fire-and-forget status write to complete before cleanup
  await new Promise((resolve) => setTimeout(resolve, 400));
});

test("process-learnings launches self-learning wrapper with .closedloop-ai/work as arg 1", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-learnings-wrapper-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-wrapper");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await fs.mkdir(repoPath, { recursive: true });
  const worktreeDir = path.join(worktreeParent, "repo-wrapper-LRN-01");
  const pendingDir = path.join(worktreeDir, ".closedloop-ai", "work", ".learnings", "pending");
  await fs.mkdir(pendingDir, { recursive: true });
  await fs.writeFile(path.join(pendingDir, "learning-1.json"), "{}");

  const fakeHome = path.join(tmpDir, "fakehome");
  const pluginScriptsDir = path.join(
    fakeHome, ".claude", "plugins", "cache", "closedloop-ai", "self-learning", "1.0.0", "scripts"
  );
  await fs.mkdir(pluginScriptsDir, { recursive: true });

  const spyOutputFile = path.join(tmpDir, "learnings-spy.txt");
  const spyScript = [
    "#!/bin/bash",
    `echo "ARG1=$1" > "${spyOutputFile}"`,
    `echo "CLOSEDLOOP_WORKDIR=$CLOSEDLOOP_WORKDIR" >> "${spyOutputFile}"`,
    "exit 0"
  ].join("\n");
  const scriptPath = path.join(pluginScriptsDir, "process-chat-learnings.sh");
  await fs.writeFile(scriptPath, spyScript, { mode: 0o755 });

  process.env.HOME = fakeHome;

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "learnings-wrapper-machine",
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
      body: JSON.stringify({ ticketId: "LRN-01", repoPath })
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.status, "processing");
  assert.equal(typeof body.pid, "number", "pid should be a number when wrapper is found");

  const expectedClaudeWorkDir = path.join(worktreeDir, ".closedloop-ai", "work");
  let spyContent = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      spyContent = await fs.readFile(spyOutputFile, "utf-8");
      if (spyContent.includes("ARG1=")) break;
    } catch {
      // file not yet written
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(spyContent.includes("ARG1="), "spy script should have recorded its arguments");
  assert.ok(
    spyContent.includes(`ARG1=${expectedClaudeWorkDir}`),
    `wrapper should receive .closedloop-ai/work as arg 1, got: ${spyContent}`
  );
  assert.ok(
    spyContent.includes(`CLOSEDLOOP_WORKDIR=${expectedClaudeWorkDir}`),
    `CLOSEDLOOP_WORKDIR env should be .closedloop-ai/work path, got: ${spyContent}`
  );
});

test("rejects disallowed repo path for record-learning-use (AC-049)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-learnings-deny-"));
  tempPathsToClean.push(tmpDir);

  const allowedDir = path.join(tmpDir, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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

test("returns empty description when claude CLI is unavailable", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-commit-claude-unavail-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-commit-noclip");
  await fs.mkdir(repoPath, { recursive: true });

  // Create a worktree directory matching the naming pattern resolveWorktreeDir
  // produces, without using a real git worktree.
  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });
  const ticketId = "CM-001";
  const worktreeDir = path.join(worktreeParent, `repo-commit-noclip-${ticketId}`);
  await fs.mkdir(worktreeDir, { recursive: true });

  // Create a fake bin directory with:
  //   git   -- outputs diff content so getGitDiff returns non-empty (triggering
  //            the claude call path)
  //   claude -- exits non-zero with no output (unavailable)
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  const fakeGitScript = [
    "#!/bin/sh",
    'case "$1" in',
    '  diff) printf "feature.ts | 1 +\\n+ export const x = 1;\\n" ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });

  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "commit-claude-unavail-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/commit-message/${ticketId}?repo=${encodeURIComponent(
      repoPath
    )}`
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    title: `Work on ${ticketId}`,
    description: "",
    source: "default"
  });
  // Key regression guard: description must be "", NOT a file list from git diff --stat
  assert.equal(body.description, "", "description must be empty, not a diff --stat file list");
});

test("uses valid JSON from claude stdout even when exit code is non-zero", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-commit-nonzero-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-commit-nonzero");
  await fs.mkdir(repoPath, { recursive: true });

  // Create a worktree directory so getGitDiff is reached (no real git needed).
  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });
  const ticketId = "CM-003";
  const worktreeDir = path.join(worktreeParent, `repo-commit-nonzero-${ticketId}`);
  await fs.mkdir(worktreeDir, { recursive: true });

  // Create a fake bin with:
  //   git    -- outputs diff content so getGitDiff returns non-empty
  //   claude -- exits non-zero but prints valid commit JSON (spawn-over-execFile
  //             regression guard: spawn preserves stdout on non-zero exit)
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  const fakeGitScript = [
    "#!/bin/sh",
    'case "$1" in',
    '  diff) printf "feature.ts | 1 +\\n+ export const x = 1;\\n" ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });
  const fakeClaudeScript = [
    "#!/bin/sh",
    'echo \'{"title": "CM-003: Add feature module", "description": "- Added feature.ts export"}\'',
    "exit 1",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "claude"), fakeClaudeScript, { mode: 0o755 });

  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "commit-nonzero-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/commit-message/${ticketId}?repo=${encodeURIComponent(
      repoPath
    )}`
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  // Must parse the JSON from stdout despite non-zero exit -- this is the
  // contract that spawn preserves (execFile would discard stdout on non-zero exit).
  assert.equal(body.source, "claude", "source should be claude when valid JSON is parsed from stdout");
  assert.equal(body.title, "CM-003: Add feature module");
  assert.equal(body.description, "- Added feature.ts export");
});

test("returns default with empty description when worktree has no diff", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-commit-nodiff-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-commit-nodiff");
  await fs.mkdir(repoPath, { recursive: true });

  // Create a worktree directory with no changes — fake git outputs nothing for
  // "diff", so getGitDiff strips the "---" separator and returns "".
  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });
  const ticketId = "CM-002";
  await fs.mkdir(path.join(worktreeParent, `repo-commit-nodiff-${ticketId}`), { recursive: true });

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  const fakeGitScript = [
    "#!/bin/sh",
    'case "$1" in',
    '  diff) exit 0 ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "commit-nodiff-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/commit-message/${ticketId}?repo=${encodeURIComponent(
      repoPath
    )}`
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    title: `Work on ${ticketId}`,
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
    preferredPort: 0,
    fallbackPorts: [0],
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

  // Isolate HOME so a developer's real ~/.claude/plugins/cache never spawns real run-loop.sh.
  const isolatedHome = path.join(tmpDir, "isolated-home");
  await fs.mkdir(isolatedHome, { recursive: true });
  process.env.HOME = isolatedHome;

  const repoPath = path.join(tmpDir, "repo-launch");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await fs.mkdir(repoPath, { recursive: true });
  // Pre-create worktree dir so the route skips git worktree creation
  await fs.mkdir(path.join(worktreeParent, "repo-launch-LAUNCH-01"), { recursive: true });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
  assert.equal(body.pid, null, "with isolated HOME and no plugin cache, no real run-loop should spawn");
});

test("symphony launch passes .closedloop-ai/work path (not ticket ID) as first arg to run-loop.sh", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-launch-args-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-args");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await fs.mkdir(repoPath, { recursive: true });

  // Pre-create worktree dir so the route skips git worktree creation
  const worktreeDir = path.join(worktreeParent, "repo-args-ARGS-01");
  await fs.mkdir(worktreeDir, { recursive: true });

  // Create a spy script in a fake plugin cache under a temp HOME
  const fakeHome = path.join(tmpDir, "fakehome");
  const pluginScriptsDir = path.join(
    fakeHome, ".claude", "plugins", "cache", "closedloop-ai", "code", "1.0.0", "scripts"
  );
  await fs.mkdir(pluginScriptsDir, { recursive: true });

  const spyOutputFile = path.join(tmpDir, "spawn-spy.txt");
  const spyScript = [
    "#!/bin/bash",
    `echo "ARG1=$1" > "${spyOutputFile}"`,
    `echo "CLOSEDLOOP_WORKDIR=$CLOSEDLOOP_WORKDIR" >> "${spyOutputFile}"`,
    "exit 0"
  ].join("\n");
  const scriptPath = path.join(pluginScriptsDir, "run-loop.sh");
  await fs.writeFile(scriptPath, spyScript, { mode: 0o755 });

  // Override HOME so findPluginScript discovers our spy script
  process.env.HOME = fakeHome;

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "launch-args-machine",
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
        ticketIdentifier: "ARGS-01",
        repoPath
      })
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.success, true);
  assert.equal(typeof body.pid, "number", "pid should be a number when script is found");

  // Wait for the detached spy script to write its output
  const expectedClaudeWorkDir = path.join(worktreeDir, ".closedloop-ai", "work");
  let spyContent = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      spyContent = await fs.readFile(spyOutputFile, "utf-8");
      if (spyContent.includes("ARG1=")) break;
    } catch {
      // file not yet written
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(spyContent.includes("ARG1="), "spy script should have recorded its arguments");
  assert.ok(
    spyContent.includes(`ARG1=${expectedClaudeWorkDir}`),
    `first arg should be .closedloop-ai/work path, got: ${spyContent}`
  );
  assert.ok(
    spyContent.includes(`CLOSEDLOOP_WORKDIR=${expectedClaudeWorkDir}`),
    `CLOSEDLOOP_WORKDIR env should be .closedloop-ai/work path, got: ${spyContent}`
  );
});

test("validates required fields for codex chat route", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-codex-chat-validate-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
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
    preferredPort: 0,
    fallbackPorts: [0],
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

// ---------------------------------------------------------------------------
// T4: Codex review-scoped session — saveCodexChatSession write path
//
// The /codex/chat/:ticketId read path and the review-completion write path
// both depend on spawning a real `codex` binary, which is unavailable in CI
// and unit-test environments. A full integration test would require a running
// Codex process that emits a session ID. Instead we directly test the exported
// saveCodexChatSession helper which contains the file-selection logic shared
// by both the write-on-completion (codex.ts:774) and the onSessionId callback
// (codex.ts:905). This proves chatContextId: "review" writes to
// codex-chat-review.json while the default writes to codex-chat.json.
// ---------------------------------------------------------------------------
test("saveCodexChatSession writes to review-scoped file when chatContextId is 'review'", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-codex-session-"));
  tempPathsToClean.push(tmpDir);

  const workDir = path.join(tmpDir, ".closedloop-ai", "work");
  await fs.mkdir(workDir, { recursive: true });

  // Write with chatContextId: "review" → codex-chat-review.json
  await saveCodexChatSession(tmpDir, "review-sess-1", "codex", "review");
  const reviewFile = JSON.parse(await fs.readFile(path.join(workDir, "codex-chat-review.json"), "utf-8")) as { sessionId: string };
  assert.equal(reviewFile.sessionId, "review-sess-1");

  // Default codex-chat.json should NOT exist
  const defaultExists = await fs.access(path.join(workDir, "codex-chat.json")).then(() => true, () => false);
  assert.equal(defaultExists, false);

  // Write without chatContextId → codex-chat.json
  await saveCodexChatSession(tmpDir, "general-sess-1", "codex");
  const defaultFile = JSON.parse(await fs.readFile(path.join(workDir, "codex-chat.json"), "utf-8")) as { sessionId: string };
  assert.equal(defaultFile.sessionId, "general-sess-1");

  // Review file should still have the original session
  const reviewAfter = JSON.parse(await fs.readFile(path.join(workDir, "codex-chat-review.json"), "utf-8")) as { sessionId: string };
  assert.equal(reviewAfter.sessionId, "review-sess-1");
});

test("saveCodexChatSession is a no-op for non-codex providers", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-codex-session-noop-"));
  tempPathsToClean.push(tmpDir);

  const workDir = path.join(tmpDir, ".closedloop-ai", "work");
  await fs.mkdir(workDir, { recursive: true });

  await saveCodexChatSession(tmpDir, "sess-1", "claude", "review");
  const anyFile = await fs.readdir(workDir);
  assert.equal(anyFile.length, 0);
});

// --- Review status + verdict tests ---

test("GET codex status returns sessionId when state file has one", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-status-sessionid-"));
  tempPathsToClean.push(tmpDir);

  // Set SYMPHONY_WORKTREE_PARENT_DIR so resolveWorktreeDir uses tmpDir as parent
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = tmpDir;

  // Create repo dir inside tmpDir (allowed directory)
  const repoDir = path.join(tmpDir, "my-repo");
  await fs.mkdir(repoDir, { recursive: true });

  // Create worktree structure: <parent>/<repoName>-<ticketId>/.closedloop-ai/work/
  const ticketId = "TEST-123";
  const worktreeDir = path.join(tmpDir, `my-repo-${ticketId}`);
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
  await fs.mkdir(workDir, { recursive: true });

  // Write state file with sessionId
  const stateFile = path.join(workDir, "codex-review-codex.json");
  await fs.writeFile(stateFile, JSON.stringify({
    status: "completed",
    pid: 12345,
    startedAt: "2025-01-01T00:00:00Z",
    completedAt: "2025-01-01T00:01:00Z",
    exitCode: 0,
    provider: "codex",
    sessionId: "abc-session-id-123",
    config: { model: "o3", reasoningEffort: "medium", reviewMode: "base", baseBranch: "main" }
  }));

  // Write empty log
  await fs.writeFile(path.join(workDir, "codex-review-codex.log"), "review output here");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "http://localhost:3000",
    getAllowedDirectories: () => [tmpDir],
    machineName: "status-sessionid-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const res = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/codex/status/${ticketId}?repo=${encodeURIComponent(repoDir)}&provider=codex`
  );
  assert.equal(res.status, 200);
  const data = await res.json() as { hasReview: boolean; sessionId?: string; status: string };
  assert.equal(data.hasReview, true);
  assert.equal(data.status, "completed");
  assert.equal(data.sessionId, "abc-session-id-123");
});

test("POST review-verdict returns 400 when sessionId is missing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-verdict-400-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "http://localhost:3000",
    getAllowedDirectories: () => [tmpDir],
    machineName: "verdict-400-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const res = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/codex/review-verdict/TICKET-1`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoPath: tmpDir, provider: "codex" })
    }
  );
  assert.equal(res.status, 400);
  const data = await res.json() as { error: string };
  assert.equal(data.error, "repoPath, sessionId, and provider are required");
});

test("POST review-verdict returns 400 for invalid provider", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-verdict-bad-provider-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "http://localhost:3000",
    getAllowedDirectories: () => [tmpDir],
    machineName: "verdict-bad-provider-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const res = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/codex/review-verdict/TICKET-1`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoPath: tmpDir, sessionId: "sess-1", provider: "foo" })
    }
  );
  assert.equal(res.status, 400);
  const data = await res.json() as { error: string };
  assert.equal(data.error, "repoPath, sessionId, and provider are required");
});

test("POST review-verdict returns 403 for disallowed repo", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-verdict-403-"));
  tempPathsToClean.push(tmpDir);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "http://localhost:3000",
    getAllowedDirectories: () => [tmpDir],
    machineName: "verdict-403-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port")
  });
  serversToClose.push(server);
  await server.start();

  const res = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/codex/review-verdict/TICKET-1`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoPath: "/not-allowed/repo", sessionId: "sess-1", provider: "codex" })
    }
  );
  assert.equal(res.status, 403);
});

test("getWebAppOrigin getter takes effect on next CORS response without restart", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-live-origin-"));
  tempPathsToClean.push(tmpDir);

  let currentWebAppOrigin = "https://initial.example.com";

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://initial.example.com",
    getWebAppOrigin: () => currentWebAppOrigin,
    getAllowedDirectories: () => [tmpDir],
    machineName: "live-origin-test",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
  });
  serversToClose.push(server);
  await server.start();

  // First request: should reflect initial origin
  const res1 = await fetch(`http://127.0.0.1:${server.getActivePort()}/health`);
  assert.equal(res1.headers.get("access-control-allow-origin"), "https://initial.example.com");

  // Change origin via getter — no restart
  currentWebAppOrigin = "https://updated.example.com";

  // Second request: should reflect the updated origin immediately
  const res2 = await fetch(`http://127.0.0.1:${server.getActivePort()}/health`);
  assert.equal(res2.headers.get("access-control-allow-origin"), "https://updated.example.com");
});

// ---------------------------------------------------------------------------
// Helper: build a minimal LocalJob for seeding JobStore
// ---------------------------------------------------------------------------

function makeTestJob(overrides: Partial<LocalJob> = {}): LocalJob {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? "test-job-1",
    kind: "SYMPHONY_LOOP",
    loopId: overrides.loopId ?? "test-loop-1",
    command: "EXECUTE",
    status: "RUNNING" as LocalJobStatus,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bug 3: /api/engineer/symphony/kill updates JobStore immediately
// ---------------------------------------------------------------------------

test("symphony/kill updates JobStore to STOPPED when killing by ticket", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-kill-jobstore-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-kill-js");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-kill-js-AI-900");
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(
    path.join(workDir, "state.json"),
    JSON.stringify({ status: "IN_PROGRESS", phase: "Running" }),
    "utf-8"
  );

  // Seed JobStore with a RUNNING job whose worktreeDir matches the kill target
  const jobStore = new JobStore({ cwd: tmpDir, name: "test-kill-jobstore" });
  const seededJob = makeTestJob({
    id: "kill-js-job-1",
    worktreeDir,
    status: "RUNNING",
  });
  jobStore.upsert(seededJob);
  assert.equal(jobStore.listRunning().length, 1, "precondition: job is active");

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "kill-jobstore-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    jobStore,
  });
  serversToClose.push(server);
  await server.start();

  // Kill via ticketId + repoPath (no PID file -> noPidFile branch)
  const killResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/kill`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: "AI-900", repoPath }),
    }
  );
  assert.equal(killResponse.status, 200);

  // JobStore should now have the job as STOPPED (not stale RUNNING)
  const updatedJob = jobStore.getById("kill-js-job-1");
  assert.ok(updatedJob, "job should still exist in store");
  assert.equal(updatedJob!.status, "STOPPED", "job status should be STOPPED after kill");
  assert.ok(updatedJob!.completedAt, "completedAt should be set");
  assert.equal(jobStore.listRunning().length, 0, "no active jobs should remain");
});

// ---------------------------------------------------------------------------
// Bug 4e: Restart-fallback cancel via loop/kill
// ---------------------------------------------------------------------------

test("loop/kill uses JobStore fallback when runningLoops is empty (post-restart)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-loopkill-fallback-"));
  tempPathsToClean.push(tmpDir);

  // Spawn a real process so the kill handler can find it alive
  const sleeper = spawn("sleep", ["120"], { detached: true, stdio: "ignore" });
  const sleeperPid = sleeper.pid!;
  childPidsToKill.push(sleeperPid);

  // Seed JobStore with a RUNNING job that has a loopId and the sleeper PID
  const jobStore = new JobStore({ cwd: tmpDir, name: "test-loopkill-fallback" });
  const loopId = "restart-fallback-loop-1";
  const seededJob = makeTestJob({
    id: "loopkill-fb-job-1",
    loopId,
    pid: sleeperPid,
    status: "RUNNING",
  });
  jobStore.upsert(seededJob);

  // Fresh server (runningLoops map is empty since this is a new server instance)
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "loopkill-fallback-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    jobStore,
  });
  serversToClose.push(server);
  await server.start();

  const killResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop/kill`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loopId }),
    }
  );
  assert.equal(killResponse.status, 200);
  const killBody = (await killResponse.json()) as { success: boolean; message: string };
  assert.equal(killBody.success, true);
  assert.ok(killBody.message.includes("restart fallback"), "message should mention restart fallback");

  // JobStore should now have the job as CANCEL_PENDING
  const updatedJob = jobStore.getById("loopkill-fb-job-1");
  assert.ok(updatedJob, "job should still exist in store");
  assert.equal(updatedJob!.status, "CANCEL_PENDING", "job status should be CANCEL_PENDING");

  // Process should be dead (the handler sends SIGTERM + waits + SIGKILL)
  await new Promise((resolve) => setTimeout(resolve, 500));
  let processAlive = false;
  try { process.kill(sleeperPid, 0); processAlive = true; } catch { /* dead */ }
  assert.equal(processAlive, false, "sleeper process should be killed");
});

// ---------------------------------------------------------------------------
// Bug 5: status endpoint suppresses terminal status while process is alive
// ---------------------------------------------------------------------------

test("symphony/status returns IN_PROGRESS when state.json says COMPLETED but process is alive", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-status-alive-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-status-alive");
  const worktreeParent = path.join(tmpDir, "worktrees");
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeDir = path.join(worktreeParent, "repo-status-alive-AI-555");
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
  await fs.mkdir(workDir, { recursive: true });

  // Spawn a real process so isProcessRunning returns true
  const sleeper = spawn("sleep", ["120"], { detached: true, stdio: "ignore" });
  const sleeperPid = sleeper.pid!;
  childPidsToKill.push(sleeperPid);

  // Write PID file so the status handler finds the alive process
  await fs.writeFile(path.join(workDir, "process.pid"), String(sleeperPid), "utf-8");

  // Write state.json with terminal status COMPLETED
  await fs.writeFile(
    path.join(workDir, "state.json"),
    JSON.stringify({
      status: "COMPLETED",
      phase: "Completed",
      timestamp: new Date().toISOString(),
    }),
    "utf-8"
  );

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "status-alive-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/status/AI-555?repo=${encodeURIComponent(repoPath)}`
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    exists: boolean;
    stateExists: boolean;
    status: string;
    phase: string;
    processRunning: boolean;
    pid: number;
  };
  assert.equal(body.exists, true);
  assert.equal(body.stateExists, true);
  assert.equal(body.processRunning, true, "process should be detected as alive");
  assert.equal(body.pid, sleeperPid);
  // Key assertion: terminal status is suppressed while process is alive
  assert.equal(body.status, "IN_PROGRESS", "should show IN_PROGRESS, not COMPLETED, while process alive");
  assert.equal(body.phase, "Running", "phase should be normalized to Running");
});

// ---------------------------------------------------------------------------
// Bug 4f: Restart-fallback cancel via plan-loop/:ticketId/cancel
// ---------------------------------------------------------------------------

test("plan-loop cancel uses JobStore PID fallback when pid file is stale (post-restart)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-planloop-cancel-"));
  tempPathsToClean.push(tmpDir);

  // Spawn a real process so the cancel handler can find it alive
  const sleeper = spawn("sleep", ["120"], { detached: true, stdio: "ignore" });
  const sleeperPid = sleeper.pid!;
  childPidsToKill.push(sleeperPid);

  const ticketId = "TEST-PLC-1";
  const loopId = "planloop-cancel-fallback-loop-1";

  // Set up worktree directory WITHOUT a pid file -- simulates post-restart where
  // the pid file was never written or was cleaned up. This forces the fallback
  // chain: readProcessPidSync -> null -> getActiveLoopPid -> null -> JobStore PID.
  const worktreeDir = path.join(tmpDir, "repo", ".worktrees", ticketId);
  await fs.mkdir(path.join(worktreeDir, ".closedloop-ai"), { recursive: true });

  // Seed JobStore with a RUNNING job whose PID is the real sleeper
  const jobStore = new JobStore({ cwd: tmpDir, name: "test-planloop-cancel-fallback" });
  const seededJob = makeTestJob({
    id: "planloop-fb-job-1",
    loopId,
    pid: sleeperPid,
    status: "RUNNING",
    worktreeDir,
  });
  jobStore.upsert(seededJob);

  // Mock API server that accepts DELETE /loops/:id
  const mockApi = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve, reject) => {
    mockApi.listen(0, "127.0.0.1", () => resolve());
    mockApi.once("error", reject);
  });
  blockersToClose.push(mockApi);
  const mockApiAddr = mockApi.address();
  if (!mockApiAddr || typeof mockApiAddr === "string") throw new Error("mock API address failed");
  const mockApiOrigin = `http://127.0.0.1:${mockApiAddr.port}`;

  // Fresh server with getApiKey/getApiOrigin
  const repoPath = path.join(tmpDir, "repo");
  await fs.mkdir(repoPath, { recursive: true });
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [repoPath],
    machineName: "planloop-cancel-fallback-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    jobStore,
    getApiKey: () => "test-api-key",
    getApiOrigin: () => mockApiOrigin,
  });
  serversToClose.push(server);
  await server.start();

  const cancelResponse = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/plan-loop/${ticketId}/cancel`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoPath, loopId }),
    }
  );
  assert.equal(cancelResponse.status, 200);
  const cancelBody = (await cancelResponse.json()) as { cancelled: boolean };
  assert.equal(cancelBody.cancelled, true);

  // readProcessPidSync returns null (no pid file), getActiveLoopPid returns null
  // (fresh server, empty runningLoops), so the JobStore fallback finds sleeperPid.
  // Wait for the handler's kill timeout
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // The sleeper should be killed via the JobStore PID fallback
  let processAlive = false;
  try { process.kill(sleeperPid, 0); processAlive = true; } catch { /* dead */ }
  assert.equal(processAlive, false, "sleeper process should be killed via JobStore PID fallback");
});

// Helper: create a minimal passing environment for health-check tests
// (fake binaries, plugin registry, repos config) and return the tmpDir.
async function createHealthCheckFixture(
  pythonBinaryContent: string | null
): Promise<{ tmpDir: string; binDir: string; symphonyDir: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-gateway-python-hc-"));
  tempPathsToClean.push(tmpDir);

  // Create fake home dir structure
  const homeDir = path.join(tmpDir, "home");
  const binDir = path.join(tmpDir, "bin");
  const symphonyDir = path.join(tmpDir, "symphony-home");
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(symphonyDir, { recursive: true });

  // Write fake binaries for git, claude, gh
  const fakeBinaries: Array<[string, string]> = [
    ["git", '#!/bin/sh\necho "git version 2.40.0"'],
    ["claude", '#!/bin/sh\necho "1.5.0"'],
    [
      "gh",
      '#!/bin/sh\nif [ "$1" = "auth" ]; then\n  exit 0\nfi\necho "gh version 2.40.0 (2024-01-01)"\n',
    ],
    ["codex", '#!/bin/sh\necho "0.1.0"'],
  ];
  for (const [name, content] of fakeBinaries) {
    const binPath = path.join(binDir, name);
    await fs.writeFile(binPath, content, { mode: 0o755 });
  }

  // Optionally write the python3 binary
  if (pythonBinaryContent !== null) {
    const pythonPath = path.join(binDir, "python3");
    await fs.writeFile(pythonPath, pythonBinaryContent, { mode: 0o755 });
  }

  // Write installed_plugins.json so all plugin checks pass
  const pluginsDir = path.join(homeDir, ".claude", "plugins");
  await fs.mkdir(pluginsDir, { recursive: true });

  const pluginNames = ["code", "platform", "judges", "code-review", "self-learning"];
  const pluginsRecord: Record<string, Array<{ installPath: string; version: string }>> = {};
  for (const name of pluginNames) {
    const installPath = path.join(tmpDir, `plugin-${name}`);
    await fs.mkdir(installPath, { recursive: true });
    pluginsRecord[`${name}@closedloop-ai`] = [{ installPath, version: "1.0.0" }];
  }
  await fs.writeFile(
    path.join(pluginsDir, "installed_plugins.json"),
    JSON.stringify({ version: 1, plugins: pluginsRecord }),
    "utf-8"
  );

  // Write repos.json so worktree-dir check passes
  const configDir = path.join(symphonyDir, "config");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, "repos.json"),
    JSON.stringify({
      settings: { worktreeParentDir: "/tmp/worktrees", worktreeParentDirConfirmed: true },
    }),
    "utf-8"
  );

  return { tmpDir, binDir, symphonyDir };
}

test("python3 health check: passes for version 3.11.0 (control)", async () => {
  const { tmpDir, binDir, symphonyDir } = await createHealthCheckFixture(
    '#!/bin/sh\necho "Python 3.11.0"\n'
  );

  process.env.HOME = path.join(tmpDir, "home");
  process.env.PATH = binDir;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "python-hc-control-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => symphonyDir,
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/health-check`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    checks: Array<{ id: string; required: boolean; passed: boolean; remediation?: string }>;
    allRequiredPassed: boolean;
  };

  const pythonCheck = body.checks.find((c) => c.id === "python3");
  assert.ok(pythonCheck, "python3 check should be present");
  assert.equal(pythonCheck.passed, true, "python3 3.11.0 should pass");
  assert.equal(pythonCheck.required, true, "python3 check should be required");
  assert.equal(pythonCheck.remediation, undefined, "no remediation on passing check");
  assert.equal(body.allRequiredPassed, true, "all required checks should pass");
});

test("python3 health check: fails when python3 not found", async () => {
  // Pass null to skip writing the python3 binary
  const { tmpDir, binDir, symphonyDir } = await createHealthCheckFixture(null);

  process.env.HOME = path.join(tmpDir, "home");
  process.env.PATH = binDir;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "python-hc-notfound-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => symphonyDir,
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/health-check`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    checks: Array<{ id: string; required: boolean; passed: boolean; remediation?: string }>;
    allRequiredPassed: boolean;
  };

  const pythonCheck = body.checks.find((c) => c.id === "python3");
  assert.ok(pythonCheck, "python3 check should be present");
  assert.equal(pythonCheck.passed, false, "python3 not found should fail");
  assert.equal(pythonCheck.required, true, "python3 check should be required");
  assert.ok(
    pythonCheck.remediation?.includes("Install Python 3.10 or later"),
    "remediation should mention Install Python 3.10 or later"
  );
  assert.equal(body.allRequiredPassed, false, "allRequiredPassed should be false when python3 missing");
});

test("python3 health check: fails for version below floor (3.9.7)", async () => {
  const { tmpDir, binDir, symphonyDir } = await createHealthCheckFixture(
    '#!/bin/sh\necho "Python 3.9.7"\n'
  );

  process.env.HOME = path.join(tmpDir, "home");
  process.env.PATH = binDir;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "python-hc-belowfloor-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => symphonyDir,
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/health-check`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    checks: Array<{ id: string; required: boolean; passed: boolean; remediation?: string }>;
    allRequiredPassed: boolean;
  };

  const pythonCheck = body.checks.find((c) => c.id === "python3");
  assert.ok(pythonCheck, "python3 check should be present");
  assert.equal(pythonCheck.passed, false, "python3 3.9.7 should fail");
  assert.equal(pythonCheck.required, true, "python3 check should be required");
  assert.ok(
    (pythonCheck as { error?: string }).error?.includes("below the required minimum"),
    "error should indicate version is below minimum"
  );
  assert.ok(
    pythonCheck.remediation?.includes("Install Python 3.10 or later"),
    "remediation should mention Install Python 3.10 or later"
  );
  assert.equal(body.allRequiredPassed, false, "allRequiredPassed should be false for below-floor python");
});

test("python3 health check: fails for suffixed below-floor version (3.9rc1)", async () => {
  // This exercises the NaN-via-split path that the regex fix closes:
  // VERSION_REGEX captures "3.9rc1" as a valid version, but Number("9rc1") === NaN
  // and NaN < 10 is false, so the old split(".").map(Number) code would have passed this.
  const { tmpDir, binDir, symphonyDir } = await createHealthCheckFixture(
    '#!/bin/sh\necho "Python 3.9rc1"\n'
  );

  process.env.HOME = path.join(tmpDir, "home");
  process.env.PATH = binDir;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "python-hc-suffixed-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => symphonyDir,
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/health-check`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    checks: Array<{ id: string; required: boolean; passed: boolean; remediation?: string }>;
    allRequiredPassed: boolean;
  };

  const pythonCheck = body.checks.find((c) => c.id === "python3");
  assert.ok(pythonCheck, "python3 check should be present");
  assert.equal(pythonCheck.passed, false, "python3 3.9rc1 should fail");
  assert.equal(pythonCheck.required, true, "python3 check should be required");
  assert.ok(
    (pythonCheck as { error?: string }).error?.includes("below the required minimum"),
    "error should indicate version is below minimum, not 'Unable to determine'"
  );
  assert.ok(
    pythonCheck.remediation?.includes("Install Python 3.10 or later"),
    "remediation should mention Install Python 3.10 or later"
  );
  assert.equal(body.allRequiredPassed, false, "allRequiredPassed should be false for suffixed below-floor version");
});

test("python3 health check: passes for version with extra suffix (3.10.1.post1)", async () => {
  const { tmpDir, binDir, symphonyDir } = await createHealthCheckFixture(
    '#!/bin/sh\necho "Python 3.10.1.post1"\n'
  );

  process.env.HOME = path.join(tmpDir, "home");
  process.env.PATH = binDir;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "python-hc-extrasuffix-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => symphonyDir,
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/health-check`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    checks: Array<{ id: string; required: boolean; passed: boolean; error?: string; remediation?: string }>;
    allRequiredPassed: boolean;
  };

  const pythonCheck = body.checks.find((c) => c.id === "python3");
  assert.ok(pythonCheck, "python3 check should be present");
  assert.equal(pythonCheck.passed, true, "python3 3.10.1.post1 should pass");
  assert.equal(pythonCheck.required, true, "python3 check should be required");
  assert.equal(pythonCheck.error, undefined, "no error on passing check");
  assert.equal(body.allRequiredPassed, true, "all required checks should pass");
});

test("python3 health check: fails for unparseable version string", async () => {
  const { tmpDir, binDir, symphonyDir } = await createHealthCheckFixture(
    '#!/bin/sh\necho "custom-build"\n'
  );

  process.env.HOME = path.join(tmpDir, "home");
  process.env.PATH = binDir;
  setShellPathForTest();

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "python-hc-unparseable-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => symphonyDir,
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.getActivePort()}/api/engineer/health-check`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    checks: Array<{ id: string; required: boolean; passed: boolean; error?: string; remediation?: string }>;
    allRequiredPassed: boolean;
  };

  const pythonCheck = body.checks.find((c) => c.id === "python3");
  assert.ok(pythonCheck, "python3 check should be present");
  assert.equal(pythonCheck.passed, false, "unparseable python version should fail");
  assert.equal(pythonCheck.required, true, "python3 check should be required");
  assert.ok(
    (pythonCheck as { error?: string }).error?.includes("Unable to determine Python version"),
    "error should indicate unable to determine version"
  );
  assert.equal(body.allRequiredPassed, false, "allRequiredPassed should be false for unparseable version");
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
