/**
 * @file collectors-hook-handler.test.ts
 * @description Validates the first-party hook handlers (FEA-1503): they POST the
 * `{ hook_type, data }` envelope to the in-process listener on the configured
 * port. The Claude handler forwards data unchanged; the Codex handler injects
 * `__provider: "codex"`.
 *
 * In production the handler runs from a userData COPY (outside the desktop's
 * `type:module` package, so its `require()` resolves as CommonJS). The test
 * mirrors that by copying the shipped script into a package.json-free temp dir
 * before spawning it via the Node binary.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = path.join(__dirname, "..", "resources", "hooks");

interface HookEnvelope {
  hook_type: string;
  data: Record<string, unknown>;
}

/** Copy the shipped handler to a CJS-safe temp dir, run it, capture the POST. */
function runHandler(
  script: string,
  hookType: string,
  stdinPayload: string,
): Promise<HookEnvelope> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(path.join(tmpdir(), "hook-handler-"));
    const handlerCopy = path.join(dir, script);
    copyFileSync(path.join(HOOKS_DIR, script), handlerCopy);

    let received: HookEnvelope | null = null;
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/hooks/event") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            received = JSON.parse(body) as HookEnvelope;
          } catch {
            received = null;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const child = spawn(process.execPath, [handlerCopy, hookType], {
        env: { ...process.env, CLAUDE_DASHBOARD_PORT: String(port) },
      });
      child.stdin.write(stdinPayload);
      child.stdin.end();
      child.on("error", (err) => {
        server.close();
        reject(err);
      });
      child.on("exit", () => {
        setTimeout(() => {
          server.close(() => {
            if (received) resolve(received);
            else reject(new Error("handler did not POST a hook event"));
          });
        }, 100);
      });
    });
  });
}

test("Claude hook-handler.js forwards { hook_type, data } unchanged (no __provider)", async () => {
  const envelope = await runHandler(
    "hook-handler.js",
    "SessionStart",
    JSON.stringify({ session_id: "abc-123", cwd: "/Users/dev/proj" }),
  );
  assert.equal(envelope.hook_type, "SessionStart");
  assert.equal(envelope.data.session_id, "abc-123");
  assert.equal(envelope.data.cwd, "/Users/dev/proj");
  assert.equal(envelope.data.__provider, undefined);
});

test("Codex codex-hook-handler.js injects __provider: codex", async () => {
  const envelope = await runHandler(
    "codex-hook-handler.js",
    "PreToolUse",
    JSON.stringify({ session_id: "codex-1", tool_name: "shell" }),
  );
  assert.equal(envelope.hook_type, "PreToolUse");
  assert.equal(envelope.data.session_id, "codex-1");
  assert.equal(envelope.data.__provider, "codex");
});

test("hook handler tolerates non-JSON stdin without crashing", async () => {
  const envelope = await runHandler("hook-handler.js", "Stop", "not json at all");
  assert.equal(envelope.hook_type, "Stop");
  assert.equal(envelope.data.raw, "not json at all");
});
