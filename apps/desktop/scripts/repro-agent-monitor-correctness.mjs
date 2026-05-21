// Correctness test for the FEA-1316 catchup cache. Verifies:
//   1. First tick imports everything.
//   2. Subsequent ticks with no file changes are fast (~ms).
//   3. Mutating a file flips it back into the parsed batch on the next tick.
//   4. Adding a new file is picked up.
//   5. Deleting a file does not break the cache (and the cache prunes it).
//
// Run: node apps/desktop/scripts/repro-agent-monitor-correctness.mjs

import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const dbModulePath = join(desktopRoot, ".generated", "agent-monitor", "server", "db.js");

const root = mkdtempSync(join(tmpdir(), "fea1316-correct-"));
const codexHome = join(root, "codex");
const codexSessions = join(codexHome, "sessions", "2026", "05", "20");
mkdirSync(codexSessions, { recursive: true });
process.env.CODEX_HOME = codexHome;
process.env.DASHBOARD_DB_PATH = join(root, "dashboard.db");

const ts = "2026-05-20T08:00:00.000Z";
function rolloutFor(uuid, suffix = "") {
  const lines = [
    JSON.stringify({ type: "session_meta", timestamp: ts, payload: { id: uuid, session_id: uuid, cwd: "/tmp/w", instructions: "x", git: { branch: "main" } } }),
    JSON.stringify({ type: "turn_context", timestamp: ts, payload: { model: "gpt-5-codex" } }),
    JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: "message", role: "user", content: [{ type: "input_text", text: `hi ${suffix}` }] } }),
    JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `reply ${suffix}` }] } }),
  ];
  return lines.join("\n") + "\n";
}
function pathFor(i) {
  const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  return join(codexSessions, `rollout-${uuid}.jsonl`);
}

// Initial: 10 files.
for (let i = 0; i < 10; i++) writeFileSync(pathFor(i), rolloutFor(`uuid-${i}`));

const { createRequire } = await import("node:module");
const requireServer = createRequire(dbModulePath);
const dbModule = requireServer("./db.js");
const { importAllCodexSessions } = requireServer("./lib/codex-import.js");

let pass = true;
function check(label, cond, extra = "") {
  const ok = !!cond;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) pass = false;
}

async function tick() {
  const t0 = performance.now();
  const r = await importAllCodexSessions(dbModule);
  return { ...r, ms: performance.now() - t0 };
}

// 1. First tick imports 10.
const a = await tick();
check("first tick imports 10", a.imported === 10, `imported=${a.imported} skipped=${a.skipped} ms=${a.ms.toFixed(0)}`);

// 2. Second tick is cheap and imports 0.
const b = await tick();
check("steady-state tick skips all", b.imported === 0 && b.skipped === 10, `imported=${b.imported} skipped=${b.skipped} ms=${b.ms.toFixed(0)}`);
check("steady-state tick is fast", b.ms < 50, `ms=${b.ms.toFixed(0)}`);

// 3. Mutate one file → must be re-parsed.
// On some filesystems mtime resolution is coarse; sleep then append so mtime
// definitely advances.
await new Promise((res) => setTimeout(res, 10));
appendFileSync(pathFor(3), rolloutFor("uuid-3", "EXTRA") + "");
const c = await tick();
check("mutating one file re-imports just that one", c.imported === 1 && c.skipped === 9, `imported=${c.imported} skipped=${c.skipped}`);

// 4. Add a new file.
writeFileSync(pathFor(100), rolloutFor("uuid-100"));
const d = await tick();
check("new file imported", d.imported === 1 && d.skipped === 10, `imported=${d.imported} skipped=${d.skipped}`);

// 5. Delete a file — must not break cache.
unlinkSync(pathFor(0));
const e = await tick();
check("deleted file does not error", e.errors === 0, `errors=${e.errors}`);
check("deleted file is no longer in skipped count", e.skipped === 10, `skipped=${e.skipped}`);

try { rmSync(root, { recursive: true, force: true }); } catch {}
process.exit(pass ? 0 : 1);
