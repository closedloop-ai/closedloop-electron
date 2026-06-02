import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openAgentDatabase } from "../src/main/database/index.js";
import { createLifecycle } from "../src/main/database/lifecycle.js";
import { AgentHookListener } from "../src/main/agent-monitor-listener.js";

interface PostResult {
  status: number;
  body: unknown;
}

function request(url: string, method: string, payload?: unknown): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const data = payload === undefined ? undefined : JSON.stringify(payload);
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function withListener(
  sandboxBaseRef: { value: string },
  run: (url: string, db: ReturnType<typeof openAgentDatabase>) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "cl-listener-"));
  const db = openAgentDatabase(path.join(dir, "agent-dashboard.sqlite"));
  const lifecycle = createLifecycle(db.connection, {
    tokenUsage: db.tokenUsage,
    detectBillingMode: () => "api",
    extractTranscript: () => null,
  });
  const listener = new AgentHookListener({
    lifecycle,
    getSandboxBaseDirectory: () => sandboxBaseRef.value,
    port: 0,
  });
  await listener.start();
  const url = listener.getUrl();
  assert.ok(url, "listener bound to an ephemeral port");
  try {
    await run(url!, db);
  } finally {
    await listener.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("listener: GET /api/health returns 200 ok", async () => {
  const sandbox = { value: "/work" };
  await withListener(sandbox, async (url) => {
    const res = await request(`${url}/api/health`, "GET");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });
});

test("listener: in-sandbox SessionStart writes a session with harness=claude", async () => {
  const sandbox = { value: "/work" };
  await withListener(sandbox, async (url, db) => {
    const res = await request(`${url}/api/hooks/event`, "POST", {
      hook_type: "SessionStart",
      data: { session_id: "s1", cwd: "/work/project" },
    });
    assert.equal(res.status, 200);
    const session = db.sessions.getById("s1");
    assert.ok(session, "session written");
    assert.equal(session!.harness, "claude");
  });
});

test("listener: __provider=codex stamps harness=codex", async () => {
  const sandbox = { value: "/work" };
  await withListener(sandbox, async (url, db) => {
    await request(`${url}/api/hooks/event`, "POST", {
      hook_type: "SessionStart",
      data: { session_id: "cx1", cwd: "/work/project", __provider: "codex" },
    });
    assert.equal(db.sessions.getById("cx1")!.harness, "codex");
  });
});

test("listener: out-of-sandbox event is dropped (no write)", async () => {
  const sandbox = { value: "/work" };
  await withListener(sandbox, async (url, db) => {
    const res = await request(`${url}/api/hooks/event`, "POST", {
      hook_type: "SessionStart",
      data: { session_id: "outside", cwd: "/somewhere/else" },
    });
    assert.equal(res.status, 200, "still acks so the hook never blocks");
    assert.equal(db.sessions.getById("outside"), undefined, "no row for out-of-sandbox session");
  });
});

test("listener: empty sandbox captures nothing (fail-closed)", async () => {
  const sandbox = { value: "" };
  await withListener(sandbox, async (url, db) => {
    await request(`${url}/api/hooks/event`, "POST", {
      hook_type: "SessionStart",
      data: { session_id: "s1", cwd: "/work/project" },
    });
    assert.equal(db.sessions.getById("s1"), undefined, "empty sandbox => fail-closed, no capture");
  });
});
