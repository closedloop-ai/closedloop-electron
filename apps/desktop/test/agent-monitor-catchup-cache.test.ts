// Regression coverage for FEA-1316: the agent-monitor 5 s catchup poll must
// stay cheap once steady state is reached. Without the per-file (mtime, size)
// cache in scripts/agent-monitor-shared/catchup-cache.js, each tick reparses
// every rollout file, which on a dev with 1000+ historical sessions pinned
// CPU at ~98 % and grew RSS until the sidecar OOMed.
//
// The test pre-populates a Codex sessions dir, runs `importAllCodexSessions`
// twice, and asserts the second call is dramatically faster than the first
// and reports `imported=0`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const generatedDb = join(desktopRoot, ".generated", "agent-monitor", "server", "db.js");

const skip =
  !existsSync(generatedDb) || !existsSync(join(dirname(generatedDb), "lib", "codex-import.js"));

test(
  "FEA-1316: codex catchup poll skips unchanged rollout files",
  { skip: skip && "generated agent-monitor runtime not built — run pnpm build:agent-monitor" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "fea1316-test-"));
    const codexHome = join(root, "codex");
    const codexSessions = join(codexHome, "sessions", "2026", "05", "20");
    mkdirSync(codexSessions, { recursive: true });
    process.env.CODEX_HOME = codexHome;
    process.env.DASHBOARD_DB_PATH = join(root, "dashboard.db");

    const ts = "2026-05-20T08:00:00.000Z";
    const BODY = "synthetic assistant reply ".repeat(40);
    function rollout(uuid: string): string {
      const lines = [
        JSON.stringify({ type: "session_meta", timestamp: ts, payload: { id: uuid, session_id: uuid, cwd: "/tmp", instructions: "x" } }),
        JSON.stringify({ type: "turn_context", timestamp: ts, payload: { model: "gpt-5-codex" } }),
        JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }),
        JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: BODY }] } }),
      ];
      return lines.join("\n") + "\n";
    }
    const N = 300;
    for (let i = 0; i < N; i++) {
      const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      writeFileSync(join(codexSessions, `rollout-${uuid}.jsonl`), rollout(uuid));
    }

    const requireServer = createRequire(generatedDb);
    const dbModule = requireServer("./db.js") as Record<string, unknown>;
    const { importAllCodexSessions } = requireServer("./lib/codex-import.js") as {
      importAllCodexSessions: (db: unknown) => Promise<{ imported: number; skipped: number; errors: number }>;
    };

    const t0 = performance.now();
    const first = await importAllCodexSessions(dbModule);
    const firstMs = performance.now() - t0;

    const t1 = performance.now();
    const second = await importAllCodexSessions(dbModule);
    const secondMs = performance.now() - t1;

    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    assert.equal(first.imported, N, `first call must import all ${N} sessions, got ${first.imported}`);
    assert.equal(second.imported, 0, `second call must import nothing, got ${second.imported}`);
    assert.equal(second.skipped, N, `second call must skip all ${N}, got ${second.skipped}`);

    // The whole point of FEA-1316: steady-state catchup must be near-free.
    // Conservative bound — locally it's ~7 ms for 2000 files, but CI runners
    // can be slow. 200 ms for 300 files is still ~10× cheaper than pre-fix.
    assert.ok(
      secondMs < 200,
      `steady-state catchup must be <200 ms (was ${secondMs.toFixed(0)} ms vs first ${firstMs.toFixed(0)} ms)`,
    );
  },
);
