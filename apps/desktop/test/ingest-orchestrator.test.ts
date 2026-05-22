// Coverage for FEA-1334: the unified cold-start ingest orchestrator, the
// shared ingest-progress singleton, and the persisted-cache extension to the
// FEA-1316 catchup cache.
//
// These modules are pure (no DB, no generated runtime tree) so the suite
// exercises them directly from source with dependency-injected fake harnesses
// — the same injection seam server/index.js uses to pass the real importers.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedDir = join(__dirname, "..", "scripts", "agent-monitor-shared");

const { ingestAllHarnesses } = require_(join(sharedDir, "ingest-orchestrator.js"));
const progress = require_(join(sharedDir, "ingest-progress.js"));
const { createCatchupCache } = require_(join(sharedDir, "catchup-cache.js"));

type ImportOpts = {
  signal?: AbortSignal;
  onBegin?: (total: number) => void;
  onProgress?: () => void;
};
type ImportResult = { imported: number; skipped: number; errors: number };

/** A fake harness importer that "parses" `fileCount` synthetic files. */
function fakeHarness(
  key: string,
  fileCount: number,
  opts: { throws?: boolean } = {},
): { key: string; importAll: (db: unknown, o: ImportOpts) => Promise<ImportResult> } {
  return {
    key,
    importAll: async (_db, o) => {
      if (opts.throws) throw new Error(`${key} boom`);
      o.onBegin?.(fileCount);
      let parsed = 0;
      for (let i = 0; i < fileCount; i++) {
        if (o.signal?.aborted) break;
        parsed++;
        o.onProgress?.();
        await Promise.resolve();
      }
      return { imported: parsed, skipped: 0, errors: 0 };
    },
  };
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

test("FEA-1334: ingest-progress tracks lifecycle and rolls up totals", () => {
  progress.reset();
  let snap = progress.snapshot();
  assert.equal(snap.running, false);
  assert.equal(snap.total, 0);

  progress.beginRun();
  assert.equal(progress.snapshot().running, true);

  progress.beginHarness("codex", 5);
  progress.beginHarness("cursor", 3);
  progress.tick("codex", { parsed: 2 });
  progress.tick("cursor", { parsed: 1 });

  snap = progress.snapshot();
  assert.equal(snap.total, 8, "total is the sum of per-harness totals");
  assert.equal(snap.parsed, 3, "parsed is the sum of per-harness parsed");

  progress.completeHarness("codex");
  snap = progress.snapshot();
  assert.equal(snap.byHarness.codex.complete, true);
  assert.equal(snap.byHarness.codex.parsed, 5, "completeHarness clamps parsed up to total");

  progress.endRun();
  snap = progress.snapshot();
  assert.equal(snap.running, false);
  assert.ok(snap.finishedAt != null, "finishedAt is stamped on endRun");
});

test("FEA-1334: orchestrator runs every injected harness to completion", async () => {
  progress.reset();
  const result = await ingestAllHarnesses({
    dbModule: {},
    harnesses: [fakeHarness("codex", 5), fakeHarness("cursor", 3), fakeHarness("opencode", 1)],
    progress,
  });

  assert.equal(result.ran, true);
  const snap = progress.snapshot();
  assert.equal(snap.running, false, "run is marked finished");
  assert.equal(snap.total, 9, "discovered totals roll up across harnesses");
  assert.equal(snap.parsed, 9, "every discovered file is accounted for");
  assert.equal(snap.imported, 9, "imported counts are rolled in from importAll results");
  for (const key of ["codex", "cursor", "opencode"]) {
    assert.equal(snap.byHarness[key].complete, true, `${key} marked complete`);
  }
});

test("FEA-1334: orchestrator progress is monotonic non-decreasing", async () => {
  progress.reset();
  const seen: number[] = [];
  const recording = {
    key: "codex",
    importAll: async (_db: unknown, o: ImportOpts) => {
      o.onBegin?.(20);
      for (let i = 0; i < 20; i++) {
        o.onProgress?.();
        seen.push(progress.snapshot().parsed);
        await Promise.resolve();
      }
      return { imported: 20, skipped: 0, errors: 0 };
    },
  };
  await ingestAllHarnesses({ dbModule: {}, harnesses: [recording], progress });

  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `parsed must never decrease (index ${i})`);
  }
  assert.equal(seen[seen.length - 1], 20);
});

test("FEA-1334: one harness throwing does not abort the others", async () => {
  progress.reset();
  const result = await ingestAllHarnesses({
    dbModule: {},
    harnesses: [fakeHarness("codex", 4, { throws: true }), fakeHarness("cursor", 6)],
    progress,
  });

  assert.equal(result.ran, true, "orchestrator still resolves cleanly");
  const snap = progress.snapshot();
  assert.equal(snap.running, false);
  assert.equal(snap.byHarness.codex.complete, true, "the failing harness is still completed");
  assert.equal(snap.byHarness.cursor.complete, true);
  assert.equal(snap.byHarness.cursor.parsed, 6, "the healthy harness still finished its work");
});

test("FEA-1334: orchestrator threads an AbortSignal into harness importers", async () => {
  progress.reset();
  const controller = new AbortController();
  let iterations = 0;
  const harness = {
    key: "codex",
    importAll: async (_db: unknown, o: ImportOpts) => {
      o.onBegin?.(100);
      for (let i = 0; i < 100; i++) {
        if (o.signal?.aborted) break;
        iterations++;
        o.onProgress?.();
        if (iterations === 10) controller.abort();
        await Promise.resolve();
      }
      return { imported: iterations, skipped: 0, errors: 0 };
    },
  };

  await ingestAllHarnesses({
    dbModule: {},
    harnesses: [harness],
    signal: controller.signal,
    progress,
  });

  assert.ok(iterations >= 10 && iterations < 100, `loop stopped early, ran ${iterations}`);
});

test("FEA-1334: orchestrator is a no-op without harnesses", async () => {
  progress.reset();
  const result = await ingestAllHarnesses({ dbModule: {}, harnesses: [], progress });
  assert.equal(result.ran, false);
});

test("FEA-1334: catchup cache persists across a simulated process restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "fea1334-cache-"));
  try {
    const cachePath = join(dir, "ingest-cache-codex.json");
    const fileA = join(dir, "a.jsonl");
    writeFileSync(fileA, "session one\n");

    // First process: see the file, record it, persist.
    const c1 = createCatchupCache({ persistPath: cachePath });
    assert.equal(c1.persisted, true);
    const first = c1.isUnchanged(fileA);
    assert.equal(first.unchanged, false, "a never-seen file is changed");
    c1.markSeenWith(fileA, first.stat);
    c1.flush();
    assert.ok(existsSync(cachePath), "flush writes the cache file");

    // Second process: a fresh cache instance loads the persisted entries.
    const c2 = createCatchupCache({ persistPath: cachePath });
    assert.equal(
      c2.isUnchanged(fileA).unchanged,
      true,
      "an unchanged file is skipped on the next cold start",
    );

    // Mutating the file invalidates the persisted entry.
    appendFileSync(fileA, "session one, extended\n");
    assert.equal(
      c2.isUnchanged(fileA).unchanged,
      false,
      "a mutated file is re-parsed even though it was cached",
    );
  } finally {
    cleanup(dir);
  }
});

test("FEA-1334: in-memory catchup cache writes nothing to disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "fea1334-mem-"));
  try {
    const cache = createCatchupCache();
    assert.equal(cache.persisted, false);
    const phantom = join(dir, "phantom.jsonl");
    writeFileSync(phantom, "x\n");
    const res = cache.isUnchanged(phantom);
    cache.markSeenWith(phantom, res.stat);
    cache.flush();
    // No persistPath → flush is a no-op, nothing new on disk besides the file.
    assert.equal(existsSync(join(dir, "ingest-cache-codex.json")), false);
  } finally {
    cleanup(dir);
  }
});
