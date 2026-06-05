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
  return requestRaw(
    url,
    method,
    payload === undefined ? undefined : JSON.stringify(payload),
  );
}

function requestRaw(
  url: string,
  method: string,
  data?: string,
): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method,
        headers: data
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(data),
            }
          : {},
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: raw ? JSON.parse(raw) : null,
          });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

interface ListenerDiagnostics {
  emits: string[];
  logs: string[];
}

async function withListener(
  sandboxBaseRef: { value: string },
  run: (
    url: string,
    db: ReturnType<typeof openAgentDatabase>,
    diagnostics: ListenerDiagnostics,
  ) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "cl-listener-"));
  const db = openAgentDatabase(path.join(dir, "agent-dashboard.sqlite"));
  const diagnostics: ListenerDiagnostics = { emits: [], logs: [] };
  const lifecycle = createLifecycle(db.connection, {
    tokenUsage: db.tokenUsage,
    detectBillingMode: () => "api",
    extractTranscript: () => null,
    emit: (sessionId) => diagnostics.emits.push(sessionId),
    log: (message) => diagnostics.logs.push(message),
  });
  const listener = new AgentHookListener({
    lifecycle,
    getSandboxBaseDirectory: () => sandboxBaseRef.value,
    log: (message) => diagnostics.logs.push(message),
    port: 0,
  });
  await listener.start();
  const url = listener.getUrl();
  assert.ok(url, "listener bound to an ephemeral port");
  try {
    await run(url!, db, diagnostics);
  } finally {
    await listener.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertNoWritesOrEmits(
  db: ReturnType<typeof openAgentDatabase>,
  diagnostics: ListenerDiagnostics,
): void {
  assert.equal(db.sessions.getAll().length, 0, "no session rows written");
  assert.deepEqual(diagnostics.emits, [], "no live DB-change emits");
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
  await withListener(sandbox, async (url, db, diagnostics) => {
    const res = await request(`${url}/api/hooks/event`, "POST", {
      hook_type: "SessionStart",
      data: { session_id: "s1", cwd: "/work/project" },
    });
    assert.equal(res.status, 200);
    const session = db.sessions.getById("s1");
    assert.ok(session, "session written");
    assert.equal(session!.harness, "claude");
    assert.deepEqual(diagnostics.emits, ["s1"]);
  });
});

test("listener: Codex route stamps harness=codex without payload provider hint", async () => {
  const sandbox = { value: "/work" };
  await withListener(sandbox, async (url, db, diagnostics) => {
    const res = await request(`${url}/api/hooks/codex/event`, "POST", {
      hook_type: "SessionStart",
      data: { session_id: "cx1", cwd: "/work/project" },
    });
    assert.equal(res.status, 200);
    assert.equal(db.sessions.getById("cx1")!.harness, "codex");
    assert.deepEqual(diagnostics.emits, ["cx1"]);
  });
});

test("listener: payload provider hints are rejected before writes on every hook route", async () => {
  const sandbox = { value: "/work" };
  await withListener(sandbox, async (url, db, diagnostics) => {
    for (const route of ["/api/hooks/event", "/api/hooks/codex/event"]) {
      const res = await request(`${url}${route}`, "POST", {
        hook_type: "SessionStart",
        data: { session_id: route, cwd: "/work/project", __provider: "codex" },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true, skipped: "invalid-provider-hint" });
      assertNoWritesOrEmits(db, diagnostics);
    }
  });
});

test("listener: malformed, invalid, and oversized payloads fail soft without writes", async () => {
  const sandbox = { value: "/work" };
  await withListener(sandbox, async (url, db, diagnostics) => {
    const malformed = await requestRaw(
      `${url}/api/hooks/event`,
      "POST",
      "{not-json-secret:super-secret-value",
    );
    assert.equal(malformed.status, 200);
    assert.deepEqual(malformed.body, { ok: false });
    assertNoWritesOrEmits(db, diagnostics);
    assert.equal(
      diagnostics.logs.some((message) => message.includes("super-secret-value")),
      false,
      "malformed-body diagnostics stay key-free",
    );

    const invalidEnvelope = await request(`${url}/api/hooks/event`, "POST", {
      hook_type: 123,
      data: { session_id: "invalid", cwd: "/work/project" },
    });
    assert.equal(invalidEnvelope.status, 200);
    assert.deepEqual(invalidEnvelope.body, { ok: true, skipped: "invalid" });
    assertNoWritesOrEmits(db, diagnostics);

    const oversized = await requestRaw(
      `${url}/api/hooks/event`,
      "POST",
      JSON.stringify({
        hook_type: "SessionStart",
        data: { session_id: "large", cwd: "/work/project", blob: "x".repeat(8 * 1024 * 1024) },
      }),
    );
    assert.equal(oversized.status, 200);
    assert.deepEqual(oversized.body, { ok: false });
    assertNoWritesOrEmits(db, diagnostics);
  });
});

test("listener: out-of-sandbox event is dropped (no write)", async () => {
  const sandbox = { value: "/work" };
  await withListener(sandbox, async (url, db, diagnostics) => {
    const res = await request(`${url}/api/hooks/event`, "POST", {
      hook_type: "SessionStart",
      data: { session_id: "outside", cwd: "/somewhere/else" },
    });
    assert.equal(res.status, 200, "still acks so the hook never blocks");
    assert.deepEqual(res.body, { ok: true, skipped: "out-of-sandbox" });
    assertNoWritesOrEmits(db, diagnostics);
  });
});

test("listener: empty sandbox captures nothing (fail-closed)", async () => {
  const sandbox = { value: "" };
  await withListener(sandbox, async (url, db, diagnostics) => {
    const res = await request(`${url}/api/hooks/event`, "POST", {
      hook_type: "SessionStart",
      data: { session_id: "s1", cwd: "/work/project" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, skipped: "out-of-sandbox" });
    assertNoWritesOrEmits(db, diagnostics);
  });
});
