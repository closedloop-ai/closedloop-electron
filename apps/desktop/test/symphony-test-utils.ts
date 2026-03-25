/**
 * Shared test helpers for symphony loop integration tests.
 *
 * Extracted from symphony-loop-execute.test.ts and
 * symphony-loop-cloud-failures.test.ts to eliminate duplication.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordedRequest = { method: string; url: string; body: string };

// ---------------------------------------------------------------------------
// Environment save/restore
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "SYMPHONY_WORKTREE_PARENT_DIR",
  "PATH",
  "HOME",
  "CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE",
] as const;

export function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

export function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export async function initGitRepo(repoPath: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main", repoPath]);
  await execFileAsync("git", ["-C", repoPath, "config", "user.email", "test@test.com"]);
  await execFileAsync("git", ["-C", repoPath, "config", "user.name", "Test"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "# initial\n");
  await execFileAsync("git", ["-C", repoPath, "add", "."]);
  await execFileAsync("git", ["-C", repoPath, "commit", "-m", "initial"]);
}

// ---------------------------------------------------------------------------
// Mock API server
// ---------------------------------------------------------------------------

/**
 * Start a mock API server. When failUrls is provided, any request whose URL
 * contains a key from the map will receive the mapped status code and an error
 * body. All other requests receive HTTP 200.
 */
export async function startMockApiServer(failUrls?: Map<string, number>): Promise<{
  server: http.Server;
  port: number;
  requests: RecordedRequest[];
  waitForRequest: (urlSubstring: string, timeoutMs?: number) => Promise<RecordedRequest>;
}> {
  const requests: RecordedRequest[] = [];
  const waiters: Array<{ urlSubstring: string; resolve: (r: RecordedRequest) => void }> = [];

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
        if (recorded.url.includes(waiters[i].urlSubstring)) {
          waiters[i].resolve(recorded);
          waiters.splice(i, 1);
        }
      }

      // Check if this request should fail
      let failStatus: number | undefined;
      if (failUrls) {
        for (const [urlSubstring, status] of failUrls) {
          if (recorded.url.includes(urlSubstring)) {
            failStatus = status;
            break;
          }
        }
      }

      if (failStatus !== undefined) {
        res.statusCode = failStatus;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "injected failure" }));
      } else {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ success: true }));
      }
    })().catch((err) => {
      console.error("Mock server handler error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock API server");
  }

  function waitForRequest(urlSubstring: string, timeoutMs = 20_000): Promise<RecordedRequest> {
    const existing = requests.find((r) => r.url.includes(urlSubstring));
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<RecordedRequest>((resolve, reject) => {
      const entry = {
        urlSubstring,
        resolve: (r: RecordedRequest) => {
          clearTimeout(timer);
          resolve(r);
        },
      };
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(entry);
        if (idx !== -1) waiters.splice(idx, 1);
        reject(
          new Error(
            `Timed out waiting for request matching "${urlSubstring}" after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
      waiters.push(entry);
    });
  }

  return { server, port: address.port, requests, waitForRequest };
}

// ---------------------------------------------------------------------------
// Fake plugin script
// ---------------------------------------------------------------------------

/**
 * Create the fake plugin cache structure so findPluginScript("code", "run-loop.sh")
 * finds the provided script content.
 */
export async function createFakeRunLoopScript(
  homeDir: string,
  scriptContent: string
): Promise<string> {
  const scriptDir = path.join(
    homeDir,
    ".claude",
    "plugins",
    "cache",
    "closedloop-ai",
    "code",
    "1.0.0",
    "scripts"
  );
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "run-loop.sh");
  await fs.writeFile(scriptPath, scriptContent, { mode: 0o755 });
  return scriptPath;
}

// ---------------------------------------------------------------------------
// Polling helpers
// ---------------------------------------------------------------------------

/**
 * Poll mock.requests until a request to /loops/{loopId}/events with
 * type === "completed" is found, or until the timeout elapses.
 */
export async function waitForCompletedEvent(
  requests: RecordedRequest[],
  loopId: string,
  timeoutMs = 20_000
): Promise<Record<string, unknown>> {
  const eventsUrlSubstring = `/loops/${loopId}/events`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const req of requests) {
      if (!req.url.includes(eventsUrlSubstring)) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.type === "completed") {
        return parsed;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for completed event for loopId=${loopId} after ${timeoutMs}ms`
  );
}
