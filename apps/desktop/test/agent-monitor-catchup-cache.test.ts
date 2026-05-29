// Regression coverage for FEA-1316: the agent-monitor 5 s catchup poll must
// stay cheap once steady state is reached. Without the per-file (mtime, size)
// cache in scripts/agent-monitor-shared/catchup-cache.js, each tick reparses
// every rollout file, which on a dev with 1000+ historical sessions pinned
// CPU at ~98 % and grew RSS until the sidecar OOMed.
//
// Tunable soak (kept small by default so CI stays fast):
//
//   CLOSEDLOOP_AGENT_MONITOR_SOAK_SESSIONS  Synthetic sessions to populate.
//                                           Default: 300.
//   CLOSEDLOOP_AGENT_MONITOR_SOAK_TICKS     `importAllCodexSessions()` calls
//                                           the "steady-state" assertion is
//                                           averaged over. Default: 2.
//
// To run a longer soak locally (e.g. when investigating a suspected
// regression):
//
//   CLOSEDLOOP_AGENT_MONITOR_SOAK_SESSIONS=5000 \
//   CLOSEDLOOP_AGENT_MONITOR_SOAK_TICKS=60 \
//     pnpm -C apps/desktop test -- --test-name-pattern=FEA-1316
//
// Env-var-tunable test parameters follow the same convention as
// `CLOSEDLOOP_TAILER_POLL_MS` / `CLOSEDLOOP_WATCHER_POLL_MS` used by
// test/boot-recovery.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const generatedDb = join(desktopRoot, ".generated", "agent-monitor", "server", "db.js");

const skipReason =
  !existsSync(generatedDb) || !existsSync(join(dirname(generatedDb), "lib", "codex-import.js"))
    ? "generated agent-monitor runtime not built — run pnpm build:agent-monitor"
    : null;

const N_SESSIONS = Number(
  process.env.CLOSEDLOOP_AGENT_MONITOR_SOAK_SESSIONS ?? "300",
);
const N_TICKS = Math.max(
  2,
  Number(process.env.CLOSEDLOOP_AGENT_MONITOR_SOAK_TICKS ?? "2"),
);

type ImportResult = { imported: number; skipped: number; errors: number };
type CodexImport = {
  importAllCodexSessions: (db: unknown) => Promise<ImportResult>;
};

const ts = "2026-05-20T08:00:00.000Z";
const BODY = "synthetic assistant reply ".repeat(40);
function rollout(uuid: string, extraTurn = ""): string {
  const lines = [
    JSON.stringify({ type: "session_meta", timestamp: ts, payload: { id: uuid, session_id: uuid, cwd: "/tmp", instructions: "x" } }),
    JSON.stringify({ type: "turn_context", timestamp: ts, payload: { model: "gpt-5-codex" } }),
    JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }),
    JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: BODY }] } }),
  ];
  if (extraTurn) {
    lines.push(
      JSON.stringify({ type: "response_item", timestamp: ts, payload: { type: "message", role: "user", content: [{ type: "input_text", text: extraTurn }] } }),
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Per-test sandbox: a fresh tmp CODEX_HOME, a fresh dashboard.db, and a
 * fresh require of the importer module so its in-memory `catchupCache` is
 * empty. Returns the importer + the live tmp paths so each test can mutate
 * its sandbox.
 */
function makeSandbox(): {
  importAll: CodexImport["importAllCodexSessions"];
  root: string;
  codexSessions: string;
  pathFor: (i: number) => string;
} {
  const root = mkdtempSync(join(tmpdir(), "fea1316-test-"));
  const codexHome = join(root, "codex");
  const codexSessions = join(codexHome, "sessions", "2026", "05", "20");
  mkdirSync(codexSessions, { recursive: true });
  process.env.CODEX_HOME = codexHome;
  process.env.DASHBOARD_DB_PATH = join(root, "dashboard.db");
  // FEA-1407 sandbox scoping: importSession skips any session whose cwd falls
  // outside SANDBOX_BASE_DIRECTORY (fail-closed — when unset it skips
  // everything). The synthetic rollouts declare cwd "/tmp", so scope the
  // sandbox there; otherwise every import returns 0 and the catchup-cache
  // assertions below never observe a session.
  process.env.SANDBOX_BASE_DIRECTORY = "/tmp";

  // Fresh require each call so the importer's module-level catchupCache is
  // empty for the new sandbox.
  const requireServer = createRequire(generatedDb);
  delete requireServer.cache[requireServer.resolve("./lib/codex-import.js")];
  delete requireServer.cache[requireServer.resolve("./db.js")];
  const dbModule = requireServer("./db.js") as Record<string, unknown>;
  const { importAllCodexSessions } = requireServer("./lib/codex-import.js") as CodexImport;
  const importAll = (): Promise<ImportResult> => importAllCodexSessions(dbModule);

  return {
    importAll,
    root,
    codexSessions,
    pathFor: (i: number) => {
      const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      return join(codexSessions, `rollout-${uuid}.jsonl`);
    },
  };
}

function cleanup(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

test(
  "FEA-1316: codex catchup poll skips unchanged rollout files",
  { skip: skipReason ?? false },
  async () => {
    const { importAll, root, pathFor } = makeSandbox();
    for (let i = 0; i < N_SESSIONS; i++) writeFileSync(pathFor(i), rollout(`uuid-${i}`));

    const t0 = performance.now();
    const first = await importAll();
    const firstMs = performance.now() - t0;

    // Average over N_TICKS calls so a longer soak (env-tuned) actually
    // exercises more of the catchup loop. With the cache in place each call
    // is near-instant; without it, each call costs ~270 µs per file.
    let steadyTotalMs = 0;
    let last: ImportResult = first;
    for (let i = 0; i < N_TICKS; i++) {
      const tStart = performance.now();
      last = await importAll();
      steadyTotalMs += performance.now() - tStart;
    }
    const steadyAvgMs = steadyTotalMs / N_TICKS;

    cleanup(root);

    assert.equal(
      first.imported,
      N_SESSIONS,
      `first call must import all ${N_SESSIONS} sessions, got ${first.imported}`,
    );
    assert.equal(last.imported, 0, `steady-state call must import nothing, got ${last.imported}`);
    assert.equal(
      last.skipped,
      N_SESSIONS,
      `steady-state call must skip all ${N_SESSIONS}, got ${last.skipped}`,
    );

    // The whole point of FEA-1316: steady-state catchup must be near-free.
    // Locally a 300-file run averages <2 ms; CI runners can be slow, so the
    // bound scales with N. Pre-fix this would be ~80 ms even at N=300.
    const bound = Math.max(50, N_SESSIONS * 0.1);
    assert.ok(
      steadyAvgMs < bound,
      `steady-state catchup must be <${bound.toFixed(0)} ms (was ${steadyAvgMs.toFixed(1)} ms over ${N_TICKS} tick(s); first call ${firstMs.toFixed(0)} ms)`,
    );
  },
);

test(
  "FEA-1316: mutating a rollout file re-imports just that one on the next tick",
  { skip: skipReason ?? false },
  async () => {
    const { importAll, root, pathFor } = makeSandbox();
    const N = 10;
    for (let i = 0; i < N; i++) writeFileSync(pathFor(i), rollout(`uuid-${i}`));

    const first = await importAll();
    assert.equal(first.imported, N);

    // Some filesystems have coarse mtime resolution; sleep then append so
    // the (mtime, size) signature definitely changes.
    await new Promise((r) => setTimeout(r, 10));
    appendFileSync(pathFor(3), rollout(`uuid-3`, "EXTRA TURN"));

    const after = await importAll();
    cleanup(root);

    assert.equal(after.imported, 1, `only the mutated file should re-import, got ${after.imported}`);
    assert.equal(after.skipped, N - 1, `the other ${N - 1} files should still be skipped`);
  },
);

test(
  "FEA-1316: a newly-added rollout file is picked up on the next tick",
  { skip: skipReason ?? false },
  async () => {
    const { importAll, root, pathFor } = makeSandbox();
    const N = 10;
    for (let i = 0; i < N; i++) writeFileSync(pathFor(i), rollout(`uuid-${i}`));

    await importAll();
    writeFileSync(pathFor(100), rollout("uuid-100"));

    const after = await importAll();
    cleanup(root);

    assert.equal(after.imported, 1, `the new file should import, got ${after.imported}`);
    assert.equal(after.skipped, N, `the original ${N} files should still be skipped`);
  },
);

test(
  "FEA-1316: deleting a rollout file does not error and is pruned from the cache",
  { skip: skipReason ?? false },
  async () => {
    const { importAll, root, pathFor } = makeSandbox();
    const N = 10;
    for (let i = 0; i < N; i++) writeFileSync(pathFor(i), rollout(`uuid-${i}`));

    await importAll();
    unlinkSync(pathFor(0));

    const after = await importAll();
    cleanup(root);

    assert.equal(after.errors, 0, `deleted file must not error, got errors=${after.errors}`);
    assert.equal(after.skipped, N - 1, `skipped should equal remaining files, got ${after.skipped}`);
  },
);
