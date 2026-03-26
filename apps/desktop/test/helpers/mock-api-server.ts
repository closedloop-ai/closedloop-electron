import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RecordedRequest = { method: string; url: string; body: string };

export async function initGitRepo(repoPath: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main", repoPath]);
  await execFileAsync("git", ["-C", repoPath, "config", "user.email", "test@test.com"]);
  await execFileAsync("git", ["-C", repoPath, "config", "user.name", "Test"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "# initial\n");
  await execFileAsync("git", ["-C", repoPath, "add", "."]);
  await execFileAsync("git", ["-C", repoPath, "commit", "-m", "initial"]);
}

export async function startMockApiServer(defaultTimeoutMs = 20_000): Promise<{
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

  function waitForRequest(urlSubstring: string, timeoutMs = defaultTimeoutMs): Promise<RecordedRequest> {
    const existing = requests.find((r) => r.url.includes(urlSubstring));
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<RecordedRequest>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for request matching "${urlSubstring}" after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
      waiters.push({
        urlSubstring,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
      });
    });
  }

  return { server, port: address.port, requests, waitForRequest };
}
