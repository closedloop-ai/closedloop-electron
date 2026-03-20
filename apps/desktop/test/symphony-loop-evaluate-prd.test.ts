/** Tests for symphony-loop EVALUATE_PRD command. */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { DesktopGatewayServer } from "../src/server/server.js";
import { _forTesting } from "../src/server/operations/symphony-loop.js";
import { EMPTY_CAPABILITIES, PORT_PROBE_ORDER } from "../src/shared/contracts.js";

const { writePrdArtifact, readEvaluatePrdOutputs } = _forTesting;

// ---------------------------------------------------------------------------
// Shared cleanup state
// ---------------------------------------------------------------------------

const tempPathsToClean: string[] = [];
const serversToClose: DesktopGatewayServer[] = [];
const eventServersToClose: http.Server[] = [];
const originalPath = process.env.PATH;

beforeEach(() => {
  // Allow loopback apiBaseUrl via the _forTesting seam (reset in afterEach).
  _forTesting.overrideValidateApiBaseUrl(() => true);
});

afterEach(async () => {
  // Reset URL validator so the override doesn't leak into other test files
  // that share this Node.js process.
  _forTesting.resetValidateApiBaseUrl();

  // Restore PATH
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  for (const server of serversToClose.splice(0)) {
    await server.stop();
  }

  for (const srv of eventServersToClose.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      srv.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  for (const p of tempPathsToClean.splice(0)) {
    await fs.rm(p, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `evaluate-prd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  tempPathsToClean.push(dir);
  return dir;
}

function makeGatewayServer(options?: { allowedDirs?: string[]; tmpDir?: string }): DesktopGatewayServer {
  const tmpDir = options?.tmpDir ?? makeTempDir();
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getGatewayAuthToken: () => "test-token",
    getAllowedDirectories: () => options?.allowedDirs ?? [os.tmpdir()],
    machineName: "evaluate-prd-test-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
  });
  serversToClose.push(server);
  return server;
}

/**
 * Start an event-capture HTTP server on a random port (port 0).
 * Returns the server port and a function that waits for the next matching event.
 * Loopback URL validation is bypassed via _forTesting.overrideValidateApiBaseUrl (set in beforeEach).
 */
async function startEventServer(): Promise<{
  port: number;
  waitForEvent: (
    predicate: (body: Record<string, unknown>) => boolean,
    timeoutMs?: number
  ) => Promise<Record<string, unknown>>;
}> {
  const collected: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    predicate: (b: Record<string, unknown>) => boolean;
    resolve: (b: Record<string, unknown>) => void;
    reject: (e: Error) => void;
  }> = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      res.statusCode = 200;
      res.end("{}");
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
      collected.push(body);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const waiter = waiters[i];
        if (waiter.predicate(body)) {
          waiters.splice(i, 1);
          waiter.resolve(body);
        }
      }
    });
  });

  // Await the listen to ensure port is assigned before returning
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not get server address"));
        return;
      }
      resolve(addr.port);
    });
    server.once("error", reject);
  });

  eventServersToClose.push(server);

  const waitForEvent = (predicate: (b: Record<string, unknown>) => boolean, timeoutMs = 10_000) => {
    // Check already-collected events first
    const existing = collected.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) {
          waiters.splice(idx, 1);
        }
        reject(new Error(`waitForEvent timed out after ${timeoutMs}ms. Collected so far: ${JSON.stringify(collected)}`));
      }, timeoutMs);

      waiters.push({
        predicate,
        resolve: (b) => {
          clearTimeout(timer);
          resolve(b);
        },
        reject,
      });
    });
  };

  return { port, waitForEvent };
}

/** Build a valid EVALUATE_PRD request body. */
function buildEvaluatePrdBody(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    loopId: "11111111-0000-0000-0000-000000000001",
    command: "EVALUATE_PRD",
    closedLoopAuthToken: "cl-token",
    apiBaseUrl: "https://api.example.com",
    artifacts: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T-5.1: VALID_COMMANDS includes EVALUATE_PRD; dispatch validation
// ---------------------------------------------------------------------------

describe("T-5.1: EVALUATE_PRD dispatch validation", () => {
  test("EVALUATE_PRD without repo returns non-400 (202 accepted or 200/500)", async () => {
    // We post a valid EVALUATE_PRD without a repo field.
    // The handler should not return 400 — it treats repo as optional for this command.
    // It may return 200 (if spawn succeeds) or 500 (if claude not found) but never 400.
    const server = makeGatewayServer();
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-desktop-gateway-token": "test-token",
        },
        body: JSON.stringify(buildEvaluatePrdBody()),
      }
    );

    assert.notEqual(response.status, 400, `Expected non-400, got ${response.status}`);
  });

  test("INVALID_COMMAND returns 400", async () => {
    const server = makeGatewayServer();
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-desktop-gateway-token": "test-token",
        },
        body: JSON.stringify(buildEvaluatePrdBody({ command: "INVALID_COMMAND" })),
      }
    );

    assert.equal(response.status, 400);
    const body = await response.json() as { error: string };
    assert.ok(body.error.includes("Invalid command"));
  });
});

// ---------------------------------------------------------------------------
// T-5.2: writePrdArtifact unit tests + prompt string assertions
// ---------------------------------------------------------------------------

describe("T-5.2: writePrdArtifact", () => {
  test("(a) PRD type artifact writes prd.md", async () => {
    const tmpDir = makeTempDir();
    await writePrdArtifact(tmpDir, [
      { type: "PRD", content: "This is the PRD content" },
    ]);
    const prdPath = path.join(tmpDir, "prd.md");
    assert.ok(existsSync(prdPath), "prd.md should exist");
    const content = await fs.readFile(prdPath, "utf-8");
    assert.equal(content, "This is the PRD content");
  });

  test("(b) empty artifacts does not throw and does not write prd.md", async () => {
    const tmpDir = makeTempDir();
    await assert.doesNotReject(() => writePrdArtifact(tmpDir, []));
    assert.ok(!existsSync(path.join(tmpDir, "prd.md")), "prd.md should not exist");
  });

  test("(c) artifact fallback type ('artifact') writes prd.md", async () => {
    const tmpDir = makeTempDir();
    await writePrdArtifact(tmpDir, [
      { type: "artifact", content: "Fallback PRD content" },
    ]);
    const prdPath = path.join(tmpDir, "prd.md");
    assert.ok(existsSync(prdPath), "prd.md should exist for artifact type");
    const content = await fs.readFile(prdPath, "utf-8");
    assert.equal(content, "Fallback PRD content");
  });

  test("prompt without repo contains skill --workdir runDir but not REPO_PATH=", async () => {
    // Verify evaluate-prd-prompt.txt matches harness-agent EVALUATE_PRD when no target repo.
    const tmpDir = makeTempDir();
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    // stub claude: reads stdin (the prompt), exits 0
    const stubScript = [
      "#!/bin/sh",
      'echo \'[{"type":"result","subtype":"success","result":"","is_error":false}]\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    const server = makeGatewayServer();
    await server.start();

    const loopId = "22222222-0000-0000-0000-000000000002";
    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-desktop-gateway-token": "test-token",
        },
        body: JSON.stringify({
          loopId,
          command: "EVALUATE_PRD",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [{ type: "PRD", content: "PRD content here" }],
          // No repo — prompt should say "No repository is linked"
        }),
      }
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    // Read the prompt file before waiting for the completed event.
    // The file is written before the HTTP 200 response is sent, so it is safe
    // to read here. After the completed event fires, production code calls
    // fs.rm(claudeWorkDir) fire-and-forget, which races with async readFile.
    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-prd-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-prd-prompt.txt");

    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    // Wait for completed or error event
    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    assert.ok(
      promptContent.includes(
        `Activate judges:run-judges skill --artifact-type prd --workdir ${claudeWorkDir}.`
      ),
      `Prompt should contain skill with --workdir runDir, got: ${promptContent}`
    );
    assert.ok(
      !promptContent.includes("REPO_PATH"),
      `Prompt should NOT contain REPO_PATH when no repo, got: ${promptContent}`
    );
  });

  test("prompt with repo contains --workdir runDir and REPO_PATH=", async () => {
    // Use a real local repo directory to test repo-present prompt
    const tmpDir = makeTempDir();
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const stubScript = [
      "#!/bin/sh",
      'echo \'[{"type":"result","subtype":"success","result":"","is_error":false}]\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    // Create a fake repo dir with the expected naming for findLocalRepo
    // findLocalRepo looks for a dir matching the repo's base name inside allowed dirs
    const repoName = "my-test-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const loopId = "66666666-0000-0000-0000-000000000006";
    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-desktop-gateway-token": "test-token",
        },
        body: JSON.stringify({
          loopId,
          command: "EVALUATE_PRD",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [{ type: "PRD", content: "PRD content here" }],
          repo: { fullName: `org/${repoName}`, branch: "main" },
        }),
      }
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    // Read the prompt file before waiting for the completed event.
    // The file is written before the HTTP 200 response is sent, so it is safe
    // to read here. After the completed event fires, production code calls
    // fs.rm(claudeWorkDir) fire-and-forget, which races with async readFile.
    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-prd-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-prd-prompt.txt");

    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    assert.ok(
      promptContent.includes("REPO_PATH="),
      `Prompt should contain REPO_PATH=, got: ${promptContent}`
    );
    assert.ok(
      promptContent.includes(
        `Activate judges:run-judges skill --artifact-type prd --workdir ${claudeWorkDir}.`
      ),
      `Prompt should contain skill with --workdir runDir, got: ${promptContent}`
    );
    assert.ok(
      promptContent.includes(`REPO_PATH=${repoDir}`),
      `Prompt should point REPO_PATH at local repo root, got: ${promptContent}`
    );
  });
});

// ---------------------------------------------------------------------------
// T-5.3: readEvaluatePrdOutputs unit tests
// ---------------------------------------------------------------------------

describe("T-5.3: readEvaluatePrdOutputs", () => {
  test("file exists: returns prdJudges from prd-judges.json", () => {
    const tmpDir = makeTempDir();
    const prdJudgesData = { scores: [{ judge: "quality", score: 8 }] };
    writeFileSync(
      path.join(tmpDir, "prd-judges.json"),
      JSON.stringify(prdJudgesData)
    );

    const result = readEvaluatePrdOutputs(tmpDir);
    assert.deepEqual(result.prdJudges, prdJudgesData);
  });

  test("file absent: returns { prdJudges: undefined }", () => {
    const tmpDir = makeTempDir();
    const result = readEvaluatePrdOutputs(tmpDir);
    assert.equal(result.prdJudges, undefined);
  });

  test("malformed JSON: returns { prdJudges: undefined } without throwing", () => {
    const tmpDir = makeTempDir();
    writeFileSync(path.join(tmpDir, "prd-judges.json"), "not valid json {{{{");
    let result: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      result = readEvaluatePrdOutputs(tmpDir);
    });
    assert.equal(result?.prdJudges, undefined);
  });
});

// ---------------------------------------------------------------------------
// T-5.4: Temp dir cleanup via stub claude
// ---------------------------------------------------------------------------

describe("T-5.4: Temp dir cleanup after EVALUATE_PRD completes", () => {
  test("temp dir is removed after claude exits 0 and completed event is received", async () => {
    const tmpDir = makeTempDir();
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // stub claude: writes {} to $CLOSEDLOOP_WORKDIR/prd-judges.json and exits 0
    const stubScript = [
      "#!/bin/sh",
      'echo "{}" > "$CLOSEDLOOP_WORKDIR/prd-judges.json"',
      'echo \'[{"type":"result","subtype":"success","result":"","is_error":false}]\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer();
    await server.start();

    const loopId = "44444444-0000-0000-0000-000000000004";
    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-desktop-gateway-token": "test-token",
        },
        body: JSON.stringify({
          loopId,
          command: "EVALUATE_PRD",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [],
        }),
      }
    );

    assert.equal(response.status, 200, `Expected 200 on spawn, got ${response.status}`);

    // Wait for completed or error event from the loop
    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-prd-${loopId.slice(0, 8)}`);

    // Poll for fs.rm completion (fire-and-forget in handleProcessCompletion) rather than
    // sleeping a fixed 300ms, which is flaky on loaded CI hosts.
    const deadline = Date.now() + 3_000;
    while (existsSync(claudeWorkDir) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(
      existsSync(claudeWorkDir),
      false,
      `Expected temp dir to be cleaned up: ${claudeWorkDir}`
    );
  });
});

// ---------------------------------------------------------------------------
// T-5.5: BINARY_NOT_FOUND when claude absent from PATH
// ---------------------------------------------------------------------------

describe("T-5.5: BINARY_NOT_FOUND when claude not in PATH", () => {
  test("returns HTTP 500 and posts error event with code BINARY_NOT_FOUND", async () => {
    const tmpDir = makeTempDir();
    const emptyBin = path.join(tmpDir, "empty-bin");
    await fs.mkdir(emptyBin, { recursive: true });
    // No claude binary in emptyBin — PATH points only there
    process.env.PATH = emptyBin;

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer();
    await server.start();

    const loopId = "55555555-0000-0000-0000-000000000005";
    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-desktop-gateway-token": "test-token",
        },
        body: JSON.stringify({
          loopId,
          command: "EVALUATE_PRD",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [],
        }),
      }
    );

    assert.equal(response.status, 500, `Expected 500 when claude not found, got ${response.status}`);

    // Verify the BINARY_NOT_FOUND error event was posted to the event server
    const errorEvent = await eventSrv.waitForEvent(
      (b) => b.type === "error",
      5_000
    );
    assert.equal(errorEvent.type, "error");
    assert.equal(errorEvent.code, "BINARY_NOT_FOUND");
  });
});
