import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openAgentDatabase } from "../src/main/database/index.js";

function makeDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "cl-tokens-"));
  const db = openAgentDatabase(path.join(dir, "agent-dashboard.sqlite"));
  return {
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const NOW = "2026-06-02T00:00:00.000Z";

test("token reconciliation: cumulative growth adds the delta", () => {
  const { db, cleanup } = makeDb();
  try {
    db.tokenUsage.replace("s1", "m1", { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 }, NOW);
    db.tokenUsage.replace("s1", "m1", { input: 150, output: 70, cacheRead: 20, cacheWrite: 5 }, NOW);
    const [row] = db.tokenUsage.getBySession("s1");
    assert.equal(row.inputTokens, 150, "effective input follows the cumulative");
    assert.equal(row.outputTokens, 70);
    assert.equal(row.cacheReadTokens, 20);
    assert.equal(row.cacheWriteTokens, 5);
  } finally {
    cleanup();
  }
});

test("token reconciliation: compaction drop adds the new segment on top of prior effective", () => {
  const { db, cleanup } = makeDb();
  try {
    // First segment reaches 150 input.
    db.tokenUsage.replace("s1", "m1", { input: 150, output: 80, cacheRead: 0, cacheWrite: 0 }, NOW);
    // Transcript compacted: cumulative drops to 30 — the prior 150 is already
    // counted, so effective becomes 150 + 30 = 180.
    db.tokenUsage.replace("s1", "m1", { input: 30, output: 10, cacheRead: 0, cacheWrite: 0 }, NOW);
    const [row] = db.tokenUsage.getBySession("s1");
    assert.equal(row.inputTokens, 180, "compaction drop accumulates the new segment");
    assert.equal(row.outputTokens, 90);
  } finally {
    cleanup();
  }
});

test("token reconciliation: tracks each model independently and the read carries no baseline columns", () => {
  const { db, cleanup } = makeDb();
  try {
    db.tokenUsage.replace("s1", "m1", { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 }, NOW);
    db.tokenUsage.replace("s1", "m2", { input: 200, output: 0, cacheRead: 0, cacheWrite: 0 }, NOW);
    const rows = db.tokenUsage.getBySession("s1");
    assert.equal(rows.length, 2);
    const byModel = Object.fromEntries(rows.map((r) => [r.model, r.inputTokens]));
    assert.deepEqual(byModel, { m1: 100, m2: 200 });

    // The relay/cost-reconciliation read plain columns — assert they are the
    // effective totals (no `+ baseline_*` needed at read time).
    const raw = db.connection
      .prepare("SELECT input_tokens, raw_input FROM token_usage WHERE session_id = ? AND model = ?")
      .get("s1", "m1") as { input_tokens: number; raw_input: number };
    assert.equal(raw.input_tokens, 100);
    assert.equal(raw.raw_input, 100, "raw_* is the last segment cumulative");
  } finally {
    cleanup();
  }
});

test("token reconciliation: all-zero counts are a no-op", () => {
  const { db, cleanup } = makeDb();
  try {
    db.tokenUsage.replace("s1", "m1", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, NOW);
    assert.equal(db.tokenUsage.getBySession("s1").length, 0);
  } finally {
    cleanup();
  }
});
