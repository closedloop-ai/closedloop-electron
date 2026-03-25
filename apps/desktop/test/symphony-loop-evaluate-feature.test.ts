/** Tests for symphony-loop EVALUATE_FEATURE artifact helpers and integration. */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  readEvaluateFeatureOutputs,
  writeFeatureArtifact,
} from "../src/server/operations/symphony-feature-artifacts.js";
import { DesktopGatewayServer } from "../src/server/server.js";
import { EMPTY_CAPABILITIES, PORT_PROBE_ORDER } from "../src/shared/contracts.js";

// ---------------------------------------------------------------------------
// Shared cleanup state
// ---------------------------------------------------------------------------

const tempPathsToClean: string[] = [];
const serversToClose: DesktopGatewayServer[] = [];
const eventServersToClose: http.Server[] = [];
const mockServersToClose: http.Server[] = [];
const originalPath = process.env.PATH;
const originalRawPipeline = process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE;

beforeEach(() => {
  // Avoid grep|tee|python stream_formatter pipeline — stub claude is not a real stream.
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
});

afterEach(async () => {
  if (originalRawPipeline === undefined) {
    delete process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE;
  } else {
    process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = originalRawPipeline;
  }

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

  for (const ms of mockServersToClose.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      ms.close((err) => (err ? reject(err) : resolve()));
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
    `evaluate-feature-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  tempPathsToClean.push(dir);
  return dir;
}

function makeGatewayServer(options?: {
  allowedDirs?: string[];
  tmpDir?: string;
  getApiOrigin?: () => string;
}): DesktopGatewayServer {
  const tmpDir = options?.tmpDir ?? makeTempDir();
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getGatewayAuthToken: () => "test-token",
    // Dummy origin for tests that never POST loop events (Node fetch rejects port 9 as invalid).
    getApiOrigin: options?.getApiOrigin ?? (() => "http://127.0.0.1:49152"),
    getAllowedDirectories: () => options?.allowedDirs ?? [os.tmpdir()],
    machineName: "evaluate-feature-test-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
  });
  serversToClose.push(server);
  return server;
}

/**
 * Start an event-capture HTTP server on a random port (port 0).
 * Pass `getApiOrigin: () => \`http://127.0.0.1:${port}\`` into makeGatewayServer so loop events reach this server.
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

/** Build a valid EVALUATE_FEATURE request body. */
function buildEvaluateFeatureBody(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    loopId: "ffffffff-0000-0000-0000-000000000001",
    command: "EVALUATE_FEATURE",
    closedLoopAuthToken: "cl-token",
    apiBaseUrl: "https://api.example.com",
    artifacts: [],
    prompt: "test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T-F-1 / T-F-2 / T-F-2b / T-F-2c / T-F-2d / T-F-3: writeFeatureArtifact
// ---------------------------------------------------------------------------

describe("writeFeatureArtifact", () => {
  test("T-F-1: prompt string is written to prompt.md", async () => {
    const tmpDir = makeTempDir();
    await writeFeatureArtifact(tmpDir, [], "This is the prompt content");
    const promptPath = path.join(tmpDir, "prompt.md");
    assert.ok(existsSync(promptPath), "prompt.md should exist");
    const content = await fs.readFile(promptPath, "utf-8");
    assert.equal(content, "This is the prompt content");
  });

  test("T-F-2: FEATURE artifact is written to artifacts/feature-<id>.md with artifacts/ dir created", async () => {
    const tmpDir = makeTempDir();
    await writeFeatureArtifact(tmpDir, [
      { type: "FEATURE", content: "# Feature Title\nFeature content here", id: "feat_my_feature" },
    ]);
    const artifactsDir = path.join(tmpDir, "artifacts");
    assert.ok(existsSync(artifactsDir), "artifacts/ directory should be created");
    const artifactPath = path.join(artifactsDir, "feature-feat_my_feature.md");
    assert.ok(existsSync(artifactPath), `artifact file should exist at artifacts/feature-feat_my_feature.md`);
    const content = await fs.readFile(artifactPath, "utf-8");
    assert.ok(content.includes("# Feature Title"), "artifact content should contain title header");
  });

  test("T-F-2b: artifact without id uses 'unknown' as fallback", async () => {
    const tmpDir = makeTempDir();
    await writeFeatureArtifact(tmpDir, [
      { type: "FEATURE", content: "Feature without id" },
    ]);
    const artifactPath = path.join(tmpDir, "artifacts", "feature-unknown.md");
    assert.ok(existsSync(artifactPath), "feature-unknown.md should exist when id is absent");
    const content = await fs.readFile(artifactPath, "utf-8");
    assert.equal(content, "Feature without id");
  });

  test("T-F-2c: mixed artifact array writes only FEATURE type artifacts", async () => {
    const tmpDir = makeTempDir();
    await writeFeatureArtifact(tmpDir, [
      { type: "FEATURE", content: "Feature content", id: "feat_one" },
      { type: "PRD", content: "PRD content", id: "prd_one" },
      { type: "artifact", content: "Generic artifact", id: "gen_one" },
    ]);
    const artifactsDir = path.join(tmpDir, "artifacts");
    assert.ok(existsSync(path.join(artifactsDir, "feature-feat_one.md")), "FEATURE artifact should be written");
    assert.ok(!existsSync(path.join(artifactsDir, "feature-prd_one.md")), "PRD artifact should not be written");
    assert.ok(!existsSync(path.join(artifactsDir, "feature-gen_one.md")), "generic artifact should not be written");
  });

  test("T-F-2d: id with '../escape' stays within artifacts/ dir (non-safe chars replaced with _)", async () => {
    const tmpDir = makeTempDir();
    await writeFeatureArtifact(tmpDir, [
      { type: "FEATURE", content: "Escape test content", id: "../escape" },
    ]);
    // All non-[a-zA-Z0-9_-] chars including . and / are replaced with _, so ../escape -> ___escape
    const safeFileName = "feature-___escape.md";
    const artifactPath = path.join(tmpDir, "artifacts", safeFileName);
    assert.ok(existsSync(artifactPath), `artifact should be at artifacts/${safeFileName}, not escape outside dir`);
    // Verify nothing was written outside the artifacts dir
    const escapedPath = path.join(tmpDir, "escape.md");
    assert.ok(!existsSync(escapedPath), "file should not escape outside artifacts/ dir");
  });

  test("T-F-3: empty artifact array does not throw", async () => {
    const tmpDir = makeTempDir();
    await assert.doesNotReject(() => writeFeatureArtifact(tmpDir, []));
  });
});

// ---------------------------------------------------------------------------
// T-F-4 / T-F-5 / T-F-6: readEvaluateFeatureOutputs
// ---------------------------------------------------------------------------

describe("readEvaluateFeatureOutputs", () => {
  test("T-F-4: valid feature-judges.json returns featureJudges", () => {
    const tmpDir = makeTempDir();
    const featureJudgesData = { scores: [{ judge: "quality", score: 9 }] };
    writeFileSync(
      path.join(tmpDir, "feature-judges.json"),
      JSON.stringify(featureJudgesData)
    );

    const result = readEvaluateFeatureOutputs(tmpDir);
    assert.deepEqual(result.featureJudges, featureJudgesData);
  });

  test("T-F-5: missing file returns { featureJudges: undefined }", () => {
    const tmpDir = makeTempDir();
    const result = readEvaluateFeatureOutputs(tmpDir);
    assert.equal(result.featureJudges, undefined);
  });

  test("T-F-6: malformed JSON returns { featureJudges: undefined } without throwing", () => {
    const tmpDir = makeTempDir();
    writeFileSync(path.join(tmpDir, "feature-judges.json"), "not valid json {{{{");
    let result: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      result = readEvaluateFeatureOutputs(tmpDir);
    });
    assert.equal(result?.featureJudges, undefined);
  });
});

// ---------------------------------------------------------------------------
// T-F-10 / T-F-11 / T-F-12: EVALUATE_FEATURE dispatch integration tests
// ---------------------------------------------------------------------------

describe("T-F-10: EVALUATE_FEATURE dispatch validation", () => {
  test("EVALUATE_FEATURE without repo returns non-400 (202 accepted or 200/500)", async () => {
    // We post a valid EVALUATE_FEATURE without a repo field.
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
        body: JSON.stringify(buildEvaluateFeatureBody()),
      }
    );

    assert.notEqual(response.status, 400, `Expected non-400, got ${response.status}`);
  });
});

describe("T-F-11: unknown command returns 400", () => {
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
        body: JSON.stringify(buildEvaluateFeatureBody({ command: "INVALID_COMMAND" })),
      }
    );

    assert.equal(response.status, 400);
    const body = await response.json() as { error: string };
    assert.ok(body.error.includes("Invalid command"));
  });
});

describe("T-F-12: EVALUATE_FEATURE ignores disallowed localRepoPath", () => {
  test("disallowed localRepoPath ignored and command proceeds", async () => {
    const tmpDir = makeTempDir();
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });
    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const stubScript = [
      "#!/bin/sh",
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    const disallowedRepoPath = path.join(tmpDir, "..", "outside-allowed-dir");
    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "ffffaaaa-0000-0000-0000-000000000012";
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
          command: "EVALUATE_FEATURE",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [{ type: "FEATURE", content: "Feature content here", id: "feat_test" }],
          prompt: "Evaluate this feature",
          localRepoPath: disallowedRepoPath,
        }),
      }
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );
  });
});

// ---------------------------------------------------------------------------
// T-F-20 / T-F-21a / T-F-21b: prompt spawn integration tests
// ---------------------------------------------------------------------------

describe("T-F-20 / T-F-21a / T-F-21b: prompt and spawn integration", () => {
  test("T-F-20: prompt without repo contains skill --workdir path but not REPO_PATH", async () => {
    const tmpDir = makeTempDir();
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    // Stub claude: emits one stream-json line and exits 0
    const stubScript = [
      "#!/bin/sh",
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "22222222-0000-0000-0000-000000000022";
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
          command: "EVALUATE_FEATURE",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [{ type: "FEATURE", content: "Feature content here", id: "feat_test" }],
          prompt: "Evaluate this feature",
          // No repo — prompt should NOT contain REPO_PATH
        }),
      }
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    // Read the prompt file before waiting for the completed event.
    // The file is written before the HTTP 200 response is sent, so it is safe
    // to read here. After the completed event fires, production code calls
    // fs.rm(claudeWorkDir) fire-and-forget, which races with async readFile.
    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");

    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    // Wait for completed or error event
    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    assert.ok(
      promptContent.includes(
        `Activate judges:run-judges skill --artifact-type feature --workdir ${claudeWorkDir}.`
      ),
      `Prompt should contain skill with --workdir runDir, got: ${promptContent}`
    );
    assert.ok(
      !promptContent.includes("REPO_PATH"),
      `Prompt should NOT contain REPO_PATH when no repo, got: ${promptContent}`
    );
  });

  test("T-F-21a: prompt with localRepoPath contains --workdir and REPO_PATH=", async () => {
    const tmpDir = makeTempDir();
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const stubScript = [
      "#!/bin/sh",
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    // Create a local repo dir inside tmpDir (it is in allowedDirs)
    const repoDir = path.join(tmpDir, "my-local-repo");
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "33333333-0000-0000-0000-000000000021";
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
          command: "EVALUATE_FEATURE",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [{ type: "FEATURE", content: "Feature content here", id: "feat_test" }],
          prompt: "Evaluate this feature",
          localRepoPath: repoDir,
        }),
      }
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");

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
      promptContent.includes(repoDir),
      `Prompt should contain repoDir path, got: ${promptContent}`
    );
  });

  test("T-F-21b: prompt with repo.fullName finds matching local dir and includes REPO_PATH=", async () => {
    const tmpDir = makeTempDir();
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const stubScript = [
      "#!/bin/sh",
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    // Create a local dir matching the repo base name (findLocalRepo looks for this)
    const repoName = "my-test-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "44444444-0000-0000-0000-00000000021b";
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
          command: "EVALUATE_FEATURE",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [{ type: "FEATURE", content: "Feature content here", id: "feat_test" }],
          prompt: "Evaluate this feature",
          repo: { fullName: `org/${repoName}`, branch: "main" },
        }),
      }
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");

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
  });
});

// ---------------------------------------------------------------------------
// startMockApiServer: captures requests by URL substring (for upload-artifacts)
// ---------------------------------------------------------------------------

type RecordedRequest = { method: string; url: string; body: string };

async function startMockApiServer(): Promise<{
  server: http.Server;
  port: number;
  requests: RecordedRequest[];
  waitForRequest: (urlSubstring: string, timeoutMs?: number, bodyPredicate?: (body: Record<string, unknown>) => boolean) => Promise<RecordedRequest>;
}> {
  const requests: RecordedRequest[] = [];
  const waiters: Array<{ urlSubstring: string; bodyPredicate?: (body: Record<string, unknown>) => boolean; resolve: (r: RecordedRequest) => void; reject: (e: Error) => void }> = [];

  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const recorded: RecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf-8"),
      };
      requests.push(recorded);

      for (let i = waiters.length - 1; i >= 0; i--) {
        const waiter = waiters[i];
        if (!recorded.url.includes(waiter.urlSubstring)) {
          continue;
        }
        if (waiter.bodyPredicate) {
          let parsedBody: Record<string, unknown>;
          try {
            parsedBody = JSON.parse(recorded.body) as Record<string, unknown>;
          } catch {
            parsedBody = {};
          }
          if (!waiter.bodyPredicate(parsedBody)) {
            continue;
          }
        }
        waiter.resolve(recorded);
        waiters.splice(i, 1);
      }

      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ success: true }));
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock API server");
  }

  function waitForRequest(urlSubstring: string, timeoutMs = 15_000, bodyPredicate?: (body: Record<string, unknown>) => boolean): Promise<RecordedRequest> {
    const existing = requests.find((r) => {
      if (!r.url.includes(urlSubstring)) return false;
      if (bodyPredicate) {
        let parsedBody: Record<string, unknown>;
        try {
          parsedBody = JSON.parse(r.body) as Record<string, unknown>;
        } catch {
          parsedBody = {};
        }
        return bodyPredicate(parsedBody);
      }
      return true;
    });
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<RecordedRequest>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for request matching "${urlSubstring}" after ${timeoutMs}ms`));
      }, timeoutMs);
      waiters.push({
        urlSubstring,
        bodyPredicate,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject,
      });
    });
  }

  return { server, port: address.port, requests, waitForRequest };
}

// ---------------------------------------------------------------------------
// T-F-30 / T-F-31 / T-F-32: E2E stub Claude integration
// ---------------------------------------------------------------------------

describe("T-F-30 / T-F-31 / T-F-32: E2E stub Claude integration for EVALUATE_FEATURE", () => {
  test("stub writes feature-judges.json; upload-artifacts body contains featureJudges; temp dir deleted; subtype is evaluate_feature", async () => {
    const tmpDir = makeTempDir();
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // Stub claude: writes {} to $CLOSEDLOOP_WORKDIR/feature-judges.json and exits 0.
    // One stream-json line starting with { so the raw pipeline receives valid JSON.
    const stubScript = [
      "#!/bin/sh",
      'echo "{}" > "$CLOSEDLOOP_WORKDIR/feature-judges.json"',
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);
    const apiBaseUrl = `http://127.0.0.1:${mock.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "eeeeeeee-0000-0000-0000-000000000030";
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
          command: "EVALUATE_FEATURE",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [],
          prompt: "test",
        }),
      }
    );

    assert.equal(response.status, 200, `Expected 200 on spawn, got ${response.status}`);

    // T-F-30: Wait for upload-artifacts and assert featureJudges is in the body.
    const uploadReq = await mock.waitForRequest("upload-artifacts", 15_000);
    const uploadBody = JSON.parse(uploadReq.body) as {
      artifacts: Record<string, unknown>;
      metadata: Record<string, unknown>;
    };
    assert.ok(
      "featureJudges" in uploadBody.artifacts,
      `Expected 'featureJudges' in upload-artifacts body, got: ${JSON.stringify(uploadBody.artifacts)}`
    );

    // T-F-32: Wait for completed event and assert subtype is 'evaluate_feature'.
    const completedReq = await mock.waitForRequest("/events", 15_000, (b) => b.type === "completed");
    const completedBody = JSON.parse(completedReq.body) as {
      type: string;
      result?: { subtype?: string };
    };
    assert.equal(
      completedBody.type,
      "completed",
      `Expected type 'completed', got: ${completedBody.type}`
    );
    assert.equal(
      completedBody.result?.subtype,
      "evaluate_feature",
      `Expected subtype 'evaluate_feature', got: ${completedBody.result?.subtype}`
    );

    // T-F-31: Poll for temp dir deletion using deadline pattern.
    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const deadline = Date.now() + 3000;
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
// T-F-40: Contract test — upload-artifacts body shape matches golden fixture
// ---------------------------------------------------------------------------

describe("T-F-40: upload-artifacts body contract matches golden fixture", () => {
  test("upload-artifacts body has exactly { artifacts: { featureJudges: ... } } matching golden fixture", async () => {
    const tmpDir = makeTempDir();
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // Stub claude: writes {} to $CLOSEDLOOP_WORKDIR/feature-judges.json and exits 0.
    const stubScript = [
      "#!/bin/sh",
      'echo "{}" > "$CLOSEDLOOP_WORKDIR/feature-judges.json"',
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);
    const apiBaseUrl = `http://127.0.0.1:${mock.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "cccccccc-0000-0000-0000-000000000040";
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
          command: "EVALUATE_FEATURE",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [],
          prompt: "test",
        }),
      }
    );

    assert.equal(response.status, 200, `Expected 200 on spawn, got ${response.status}`);

    // T-F-40: Wait for upload-artifacts request and capture the body.
    const uploadReq = await mock.waitForRequest("upload-artifacts", 15_000);
    const capturedBody = JSON.parse(uploadReq.body) as {
      artifacts: Record<string, unknown>;
    };

    // Assert artifacts keys match expected shape
    assert.deepEqual(
      Object.keys(capturedBody.artifacts).sort(),
      ["featureJudges"],
      `Expected artifacts keys to be ['featureJudges'], got: ${JSON.stringify(Object.keys(capturedBody.artifacts).sort())}`
    );

    // Read golden fixture and compare structure
    const fixturePath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "fixtures",
      "evaluate-feature-upload-body.fixture.json"
    );
    const goldenFixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
      artifacts: Record<string, unknown>;
    };

    assert.deepEqual(
      Object.keys(capturedBody.artifacts).sort(),
      Object.keys(goldenFixture.artifacts).sort(),
      `Captured body artifact keys do not match golden fixture. Got: ${JSON.stringify(Object.keys(capturedBody.artifacts).sort())}, expected: ${JSON.stringify(Object.keys(goldenFixture.artifacts).sort())}`
    );
  });
});

// ---------------------------------------------------------------------------
// T-F-50: BINARY_NOT_FOUND when claude absent from PATH
// ---------------------------------------------------------------------------

describe("T-F-50: BINARY_NOT_FOUND when claude not in PATH", () => {
  test("returns HTTP 500 and posts error event with code BINARY_NOT_FOUND", async () => {
    const tmpDir = makeTempDir();
    const emptyBin = path.join(tmpDir, "empty-bin");
    await fs.mkdir(emptyBin, { recursive: true });
    // No claude binary in emptyBin — PATH points only there
    process.env.PATH = emptyBin;

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "ffffbbbb-0000-0000-0000-000000000050";
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
          command: "EVALUATE_FEATURE",
          closedLoopAuthToken: "cl-token",
          apiBaseUrl,
          artifacts: [],
          prompt: "test",
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
