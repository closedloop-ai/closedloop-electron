import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  ensureReconciliationSchema,
  joinAnthropic,
  joinOpenAI,
  ReconciliationWorker,
} from "../src/main/reconciliation-worker.js";
import { microCentsFromInt } from "../src/main/cost-math.js";
import type { SafeStorageLike } from "../src/main/electron-safe-storage.js";
import { AnthropicAdminKeyStore } from "../src/main/anthropic-admin-key-store.js";
import { OpenAIAdminKeyStore } from "../src/main/openai-admin-key-store.js";

function stubSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString(plain) {
      return Buffer.from(`stub:${plain}`, "utf-8");
    },
    decryptString(buf) {
      const s = buf.toString("utf-8");
      return s.startsWith("stub:") ? s.slice(5) : s;
    },
  };
}

let tempRoot = "";

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-worker-test-"));
});

afterEach(() => {
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("reconciliation-worker: ensureReconciliationSchema", () => {
  test("creates the reconciliation table with required columns", () => {
    const dbPath = path.join(tempRoot, "test.db");
    const db = new DatabaseSync(dbPath);
    try {
      ensureReconciliationSchema(db);
      const columns = db
        .prepare(`PRAGMA table_info(reconciliation)`)
        .all() as { name: string }[];
      const names = columns.map((c) => c.name).sort();
      assert.deepEqual(names, [
        "cause_hint",
        "computed_at",
        "day",
        "drift_micro_cents",
        "drift_pct",
        "local_estimate_micro_cents",
        "model",
        "vendor",
        "vendor_billed_micro_cents",
      ]);
    } finally {
      db.close();
    }
  });

  test("is idempotent — second call does not error", () => {
    const dbPath = path.join(tempRoot, "idem.db");
    const db = new DatabaseSync(dbPath);
    try {
      ensureReconciliationSchema(db);
      ensureReconciliationSchema(db);
    } finally {
      db.close();
    }
  });

  test("primary key is (day, vendor, model)", () => {
    const dbPath = path.join(tempRoot, "pk.db");
    const db = new DatabaseSync(dbPath);
    try {
      ensureReconciliationSchema(db);
      db.prepare(
        `INSERT INTO reconciliation (day, vendor, model, local_estimate_micro_cents, vendor_billed_micro_cents, drift_micro_cents, computed_at)
         VALUES ('2025-08-01', 'anthropic', 'claude-x', 100, 110, 10, '2025-08-02T00:00:00Z')`,
      ).run();
      // Same key should conflict.
      assert.throws(() =>
        db.prepare(
          `INSERT INTO reconciliation (day, vendor, model, local_estimate_micro_cents, vendor_billed_micro_cents, drift_micro_cents, computed_at)
           VALUES ('2025-08-01', 'anthropic', 'claude-x', 5, 6, 1, '2025-08-02T00:00:00Z')`,
        ).run(),
      );
    } finally {
      db.close();
    }
  });
});

describe("reconciliation-worker: joinAnthropic", () => {
  test("computes drift rows from vendor + local maps", () => {
    const local = new Map<string, ReturnType<typeof microCentsFromInt>>();
    local.set("2025-08-01::claude-x", microCentsFromInt(100));
    const rows = joinAnthropic(
      [
        {
          day: "2025-08-01",
          model: "claude-x",
          costMicroCents: microCentsFromInt(120),
          descriptionGroup: null,
          costType: "tokens",
          serviceTier: "standard",
          tokenType: "uncached_input_tokens",
        },
      ],
      local,
      ["2025-08-01"],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].day, "2025-08-01");
    assert.equal(rows[0].vendor, "anthropic");
    assert.equal(rows[0].model, "claude-x");
    assert.equal(rows[0].localMicroCents, 100);
    assert.equal(rows[0].vendorMicroCents, 120);
    assert.equal(rows[0].driftMicroCents, 20);
    // (120-100)/120 = 16.67%
    assert.ok(Math.abs((rows[0].driftPct ?? 0) - 16.67) < 0.1);
  });

  test("sums vendor breakdowns for same day+model", () => {
    const rows = joinAnthropic(
      [
        {
          day: "2025-08-01",
          model: "claude-x",
          costMicroCents: microCentsFromInt(30),
          descriptionGroup: "input",
          costType: "tokens",
          serviceTier: "standard",
          tokenType: "uncached_input_tokens",
        },
        {
          day: "2025-08-01",
          model: "claude-x",
          costMicroCents: microCentsFromInt(70),
          descriptionGroup: "output",
          costType: "tokens",
          serviceTier: "standard",
          tokenType: "output_tokens",
        },
      ],
      new Map(),
      ["2025-08-01"],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].vendorMicroCents, 100);
    assert.equal(rows[0].localMicroCents, 0);
  });

  test("filters out days outside the allowed window", () => {
    const rows = joinAnthropic(
      [
        {
          day: "2025-09-09",
          model: "claude-x",
          costMicroCents: microCentsFromInt(100),
          descriptionGroup: null,
          costType: null,
          serviceTier: null,
          tokenType: null,
        },
      ],
      new Map(),
      ["2025-08-01"],
    );
    assert.equal(rows.length, 0);
  });
});

describe("reconciliation-worker: joinOpenAI", () => {
  test("emits rows for vendor-only days", () => {
    const rows = joinOpenAI(
      [
        {
          day: "2025-08-01",
          model: "gpt-4.1",
          costMicroCents: microCentsFromInt(50),
          lineItem: "gpt-4.1",
          projectId: null,
        },
      ],
      new Map(),
      ["2025-08-01"],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].vendor, "openai");
    assert.equal(rows[0].localMicroCents, 0);
    assert.equal(rows[0].vendorMicroCents, 50);
    // local 0 / vendor 50 = +100% drift, classified as trial_credit_applied
    // (vendor < local would be needed for trial credit, but here local==0 so
    // null branch doesn't trigger). Check classification.
    assert.ok(rows[0].causeHint !== null);
  });
});

describe("reconciliation-worker: ReconciliationWorker integration", () => {
  test("does not start when no admin key is set", () => {
    const dbPath = path.join(tempRoot, "no-key.db");
    let scheduledMs: number | null = null;
    const worker = new ReconciliationWorker({
      dbPath,
      anthropicKeyStore: new AnthropicAdminKeyStore({
        cwd: tempRoot,
        name: "an1",
        safeStorage: stubSafeStorage(),
      }),
      openaiKeyStore: new OpenAIAdminKeyStore({
        cwd: tempRoot,
        name: "oa1",
        safeStorage: stubSafeStorage(),
      }),
      getIntervalHours: () => 24,
      isEnabled: () => true,
      scheduleTimer: (_cb, ms) => {
        scheduledMs = ms;
        return setTimeout(() => {}, 0) as NodeJS.Timeout;
      },
    });
    worker.init();
    assert.equal(scheduledMs, null, "should not schedule when no key is set");
    worker.stop();
  });

  test("does not start when feature is disabled", () => {
    const dbPath = path.join(tempRoot, "disabled.db");
    let scheduled = false;
    const anthropicStore = new AnthropicAdminKeyStore({
      cwd: tempRoot,
      name: "an2",
      safeStorage: stubSafeStorage(),
    });
    anthropicStore.set("sk-ant-admin-test");
    const worker = new ReconciliationWorker({
      dbPath,
      anthropicKeyStore: anthropicStore,
      openaiKeyStore: new OpenAIAdminKeyStore({
        cwd: tempRoot,
        name: "oa2",
        safeStorage: stubSafeStorage(),
      }),
      getIntervalHours: () => 24,
      isEnabled: () => false,
      scheduleTimer: (_cb, _ms) => {
        scheduled = true;
        return setTimeout(() => {}, 0) as NodeJS.Timeout;
      },
    });
    worker.init();
    assert.equal(scheduled, false, "should not schedule when disabled");
    worker.stop();
  });

  test("runNow returns queued=true when no run is in flight", async () => {
    const dbPath = path.join(tempRoot, "run-now.db");
    const anthropicStore = new AnthropicAdminKeyStore({
      cwd: tempRoot,
      name: "an3",
      safeStorage: stubSafeStorage(),
    });
    anthropicStore.set("sk-ant-admin-test");
    // Seed the reconciliation table with a recent computed_at so init() does
    // NOT auto-fire a boot-due run (which would race the runNow() call).
    const seed = new DatabaseSync(dbPath);
    try {
      ensureReconciliationSchema(seed);
      seed.prepare(
        `INSERT INTO reconciliation
         (day, vendor, model, local_estimate_micro_cents, vendor_billed_micro_cents, drift_micro_cents, computed_at)
         VALUES ('2025-08-01', 'anthropic', 'claude-x', 100, 110, 10, ?)`,
      ).run(new Date().toISOString());
    } finally {
      seed.close();
    }
    const worker = new ReconciliationWorker({
      dbPath,
      anthropicKeyStore: anthropicStore,
      openaiKeyStore: new OpenAIAdminKeyStore({
        cwd: tempRoot,
        name: "oa3",
        safeStorage: stubSafeStorage(),
      }),
      getIntervalHours: () => 24,
      isEnabled: () => true,
      // Stub both fetchers so any run doesn't hit the network.
      fetchAnthropic: async () => [],
      fetchOpenAI: async () => [],
      scheduleTimer: () => setTimeout(() => {}, 0) as NodeJS.Timeout,
    });
    worker.init();
    const result = await worker.runNow();
    assert.equal(result.queued, true);
    worker.stop();
  });
});

describe("reconciliation-worker: persistence end-to-end", () => {
  test("known usage fixture + mocked vendor responses lands rows with correct drift", async () => {
    const dbPath = path.join(tempRoot, "e2e.db");
    // Seed the dashboard schema needed by the aggregator. Just create the
    // minimum tables — token_usage, sessions, model_pricing.
    const seed = new DatabaseSync(dbPath);
    try {
      seed.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          model TEXT
        );
        CREATE TABLE token_usage (
          session_id TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          cache_write_tokens INTEGER NOT NULL DEFAULT 0,
          baseline_input INTEGER NOT NULL DEFAULT 0,
          baseline_output INTEGER NOT NULL DEFAULT 0,
          baseline_cache_read INTEGER NOT NULL DEFAULT 0,
          baseline_cache_write INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (session_id, model)
        );
        CREATE TABLE model_pricing (
          model_pattern TEXT PRIMARY KEY,
          input_per_mtok REAL,
          output_per_mtok REAL,
          cache_read_per_mtok REAL,
          cache_write_per_mtok REAL
        );
      `);
      // One day ago in UTC
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      seed.prepare(
        `INSERT INTO sessions (id, started_at, model) VALUES (?, ?, ?)`,
      ).run("session-1", `${oneDayAgo}T12:00:00Z`, "claude-sonnet-4-5");
      seed.prepare(
        `INSERT INTO token_usage (session_id, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?)`,
      ).run("session-1", "claude-sonnet-4-5", 1_000_000, 0);
      // Local pricing: $3.00 / M input tokens → $3.00 estimated for 1M tokens.
      seed.prepare(
        `INSERT INTO model_pricing (model_pattern, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok)
         VALUES (?, ?, ?, ?, ?)`,
      ).run("claude-sonnet-4-5", 3, 15, 0.3, 3.75);
    } finally {
      seed.close();
    }

    const anthropicStore = new AnthropicAdminKeyStore({
      cwd: tempRoot,
      name: "an4",
      safeStorage: stubSafeStorage(),
    });
    anthropicStore.set("sk-ant-admin-test");

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    // Vendor reports $3.30 for the same day → 10% drift vs local $3.00.
    const worker = new ReconciliationWorker({
      dbPath,
      anthropicKeyStore: anthropicStore,
      openaiKeyStore: new OpenAIAdminKeyStore({
        cwd: tempRoot,
        name: "oa4",
        safeStorage: stubSafeStorage(),
      }),
      getIntervalHours: () => 24,
      isEnabled: () => true,
      fetchAnthropic: async () => [
        {
          day: oneDayAgo,
          model: "claude-sonnet-4-5",
          // $3.30 = 33_000_000 microcents-of-a-dollar = 330 cents = 3_300_000 microcents
          costMicroCents: microCentsFromInt(3_300_000),
          descriptionGroup: "Claude Sonnet 4 Usage - Input Tokens",
          costType: "tokens",
          serviceTier: "standard",
          tokenType: "uncached_input_tokens",
        },
      ],
      fetchOpenAI: async () => [],
      scheduleTimer: () => setTimeout(() => {}, 0) as NodeJS.Timeout,
    });

    worker.init();
    await worker.runNow();
    // Wait for the queued run to finish — it's fire-and-forget. Poll status
    // until row appears or timeout.
    const deadline = Date.now() + 5_000;
    let rowCount = 0;
    while (Date.now() < deadline) {
      const status = worker.getStatus();
      if (status.rowCount > 0) {
        rowCount = status.rowCount;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    worker.stop();

    assert.ok(rowCount > 0, "expected at least one reconciliation row");
    const verify = new DatabaseSync(dbPath);
    try {
      const row = verify
        .prepare(
          `SELECT day, vendor, model, local_estimate_micro_cents, vendor_billed_micro_cents, drift_micro_cents, drift_pct, cause_hint
           FROM reconciliation
           WHERE day = ?`,
        )
        .get(oneDayAgo) as
        | {
            day: string;
            vendor: string;
            model: string;
            local_estimate_micro_cents: number;
            vendor_billed_micro_cents: number;
            drift_micro_cents: number;
            drift_pct: number | null;
            cause_hint: string | null;
          }
        | undefined;
      assert.ok(row, "expected row in reconciliation table");
      assert.equal(row.vendor, "anthropic");
      assert.equal(row.model, "claude-sonnet-4-5");
      // local should be $3.00 = 3_000_000 microcents
      assert.equal(row.local_estimate_micro_cents, 3_000_000);
      assert.equal(row.vendor_billed_micro_cents, 3_300_000);
      assert.equal(row.drift_micro_cents, 300_000);
      // drift_pct = (vendor - local) / vendor = 300_000 / 3_300_000 ≈ 9.09%
      assert.ok(Math.abs((row.drift_pct ?? 0) - 9.0909) < 0.1);
    } finally {
      verify.close();
    }
  });
});
