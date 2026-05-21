// Direct microbenchmark of the agent-monitor codex catchup tick.
// Calls importAllCodexSessions() in a loop and reports per-tick wall time +
// RSS + heap. This is the most direct measurement of the leak: each tick
// reparses every rollout file from disk, regardless of whether anything
// changed since last tick.

import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const SESSIONS = Number(args.sessions ?? 2000);
const TICKS = Number(args.ticks ?? 30);

// Tmp Codex home.
const root = mkdtempSync(join(tmpdir(), "fea1316-bench-"));
const codexHome = join(root, "codex");
const codexSessions = join(codexHome, "sessions", "2026", "05", "20");
mkdirSync(codexSessions, { recursive: true });
process.env.CODEX_HOME = codexHome;

const TURNS_PER_SESSION = 40;
const ASSIST_BLOAT = "synthetic assistant reply with reasonable length text ".repeat(20);

function makeRolloutLines(uuid) {
  const ts = "2026-05-20T08:00:00.000Z";
  const lines = [
    JSON.stringify({ type: "session_meta", timestamp: ts, payload: { id: uuid, session_id: uuid, cwd: "/tmp/w", instructions: "x", git: { branch: "main" } } }),
    JSON.stringify({ type: "turn_context", timestamp: ts, payload: { model: "gpt-5-codex" } }),
  ];
  for (let t = 0; t < TURNS_PER_SESSION; t++) {
    lines.push(
      JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: "message", role: "user", content: [{ type: "input_text", text: `t${t}` }] } }),
      JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: ASSIST_BLOAT }] } }),
    );
  }
  lines.push(JSON.stringify({ type: "event_msg", timestamp: ts, payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 2000 } } } }));
  return lines.join("\n") + "\n";
}

console.log(`[bench] writing ${SESSIONS} synthetic Codex rollout files...`);
for (let i = 0; i < SESSIONS; i++) {
  const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  writeFileSync(join(codexSessions, `rollout-2026-05-20T08-00-00-${uuid}.jsonl`), makeRolloutLines(uuid));
}

// Use the generated server lib directly — that's what runs in production.
const libDir = join(desktopRoot, ".generated", "agent-monitor", "server", "lib");
const dbModulePath = join(desktopRoot, ".generated", "agent-monitor", "server", "db.js");
process.env.DASHBOARD_DB_PATH = join(root, "dashboard.db");

const { createRequire } = await import("node:module");
const requireServer = createRequire(dbModulePath);
const dbModule = requireServer("./db.js");
const { importAllCodexSessions } = requireServer("./lib/codex-import.js");

console.log(`[bench] running ${TICKS} ticks…`);

function mem() {
  const m = process.memoryUsage();
  // Child process RSS via process.memoryUsage().rss
  return { rss: (m.rss / 1024 / 1024).toFixed(1), heap: (m.heapUsed / 1024 / 1024).toFixed(1) };
}

console.log(`tick,wall_ms,rss_mb,heap_mb,imported,skipped,errors`);
for (let t = 0; t < TICKS; t++) {
  const start = performance.now();
  const result = await importAllCodexSessions(dbModule);
  const wall = (performance.now() - start).toFixed(0);
  if (global.gc) global.gc();
  const m = mem();
  console.log(`${t},${wall},${m.rss},${m.heap},${result.imported},${result.skipped},${result.errors}`);
}

try { rmSync(root, { recursive: true, force: true }); } catch {}
