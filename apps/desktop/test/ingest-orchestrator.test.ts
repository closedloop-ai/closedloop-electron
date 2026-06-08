import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CollectorManager } from "../src/main/collectors/collector-manager.js";
import { createCatchupCache } from "../src/main/collectors/catchup-cache.js";
import type { HarnessCollector, NormalizedSession } from "../src/main/collectors/types.js";

test("first-party CollectorManager imports every injected harness, including OpenCode batch ingestion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collector-manager-ingest-"));
  const imported: Array<{ sessionId: string; harness: string }> = [];
  try {
    const codexSource = join(dir, "codex.jsonl");
    const opencodeSentinel = join(dir, "opencode");
    writeFileSync(codexSource, "{}\n");

    const manager = new CollectorManager({
      importer: {
        importSession: async (session, harness) => {
          imported.push({ sessionId: session.sessionId, harness });
          return { skipped: false, reactivated: false };
        },
      },
      detectBillingMode: () => "metered_api",
      stateDir: dir,
      emit: () => {},
      shouldWatchClaude: () => true,
      collectors: [
        fakeCollector("codex", [codexSource], [makeSession("codex-session")]),
        fakeCollector("opencode", [opencodeSentinel], [makeSession("opencode-session")], true),
      ],
    });

    manager.start();
    await waitUntil(() => imported.length === 2);
    manager.stop();

    assert.deepEqual(
      imported.sort((a, b) => a.harness.localeCompare(b.harness)),
      [
        { sessionId: "codex-session", harness: "codex" },
        { sessionId: "opencode-session", harness: "opencode" },
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("first-party CollectorManager imports parsed sessions from any working directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collector-manager-ungated-"));
  const imported: string[] = [];
  try {
    const source = join(dir, "codex.jsonl");
    writeFileSync(source, "{}\n");

    const manager = new CollectorManager({
      importer: {
        importSession: async (session) => {
          imported.push(session.sessionId);
          return { skipped: false, reactivated: false };
        },
      },
      detectBillingMode: () => "metered_api",
      stateDir: dir,
      emit: () => {},
      shouldWatchClaude: () => true,
      collectors: [
        fakeCollector("codex", [source], [
          makeSession("inside-session", "/sandbox/project"),
          makeSession("outside-session", "/other/project"),
        ]),
      ],
    });

    manager.start();
    await waitUntil(() => imported.length === 2);
    manager.stop();

    assert.deepEqual(imported, ["inside-session", "outside-session"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("first-party catchup cache persists unchanged source fingerprints", () => {
  const dir = mkdtempSync(join(tmpdir(), "collector-manager-cache-"));
  try {
    const cachePath = join(dir, "ingest-cache-codex.json");
    const source = join(dir, "codex.jsonl");
    const removedSource = join(dir, "removed.jsonl");
    writeFileSync(source, "session one\n");
    writeFileSync(removedSource, "remove me\n");

    const first = createCatchupCache({ persistPath: cachePath });
    const firstStatus = first.isUnchanged(source);
    assert.equal(firstStatus.unchanged, false);
    first.markSeenWith(source, firstStatus.stat);
    first.markSeen(removedSource);
    assert.equal(first.size(), 2);
    first.pruneTo([source]);
    assert.equal(first.size(), 1);
    first.flush();
    assert.equal(existsSync(cachePath), true);

    const second = createCatchupCache({ persistPath: cachePath });
    assert.equal(second.isUnchanged(source).unchanged, true);

    appendFileSync(source, "session one changed\n");
    assert.equal(second.isUnchanged(source).unchanged, false);
    assert.equal(second.isUnchanged(removedSource).unchanged, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeCollector(
  key: HarnessCollector["key"],
  sources: string[],
  sessions: NormalizedSession[],
  batch = false,
): HarnessCollector {
  return {
    key,
    cacheName: key,
    batch,
    watchRoots: () => [],
    watchMatch: () => true,
    listSources: () => sources,
    parse: async () => sessions,
  };
}

function makeSession(
  sessionId: string,
  cwd = "/sandbox/project",
): NormalizedSession {
  return {
    sessionId,
    name: sessionId,
    cwd,
    model: "gpt-5",
    version: null,
    slug: null,
    gitBranch: null,
    startedAt: "2026-06-07T12:00:00.000Z",
    endedAt: "2026-06-07T12:05:00.000Z",
    teams: [],
    userMessages: 1,
    assistantMessages: 1,
    tokensByModel: {},
    messageTimestamps: [],
    toolUses: [],
    plans: [],
    compactions: [],
    apiErrors: [],
    fileModifiedAt: null,
    turnDurations: [],
    entrypoint: "codex",
    permissionMode: null,
    thinkingBlockCount: 0,
    toolResultErrors: [],
    usageExtras: {
      service_tiers: [],
      speeds: [],
      inference_geos: [],
    },
    messages: [],
    tokenSeries: [],
    diffStats: null,
    slashCommands: [],
    artifacts: {
      prs: [],
      issues: [],
      repo: null,
    },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error("timed out waiting for collector import");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
