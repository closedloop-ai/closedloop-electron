import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const buildScriptSource = read("../scripts/build-agent-monitor.mjs");
const syncServiceSource = read("../src/main/agent-session-sync-service.ts");

const generatedCompatSqliteUrl = new URL(
  "../.generated/agent-monitor/server/compat-sqlite.js",
  import.meta.url,
);
const generatedCompatSqliteSource = existsSync(generatedCompatSqliteUrl)
  ? readFileSync(generatedCompatSqliteUrl, "utf8")
  : null;

const generatedHooksUrl = new URL(
  "../.generated/agent-monitor/server/routes/hooks.js",
  import.meta.url,
);
const generatedHooksSource = existsSync(generatedHooksUrl)
  ? readFileSync(generatedHooksUrl, "utf8")
  : null;

const skipGenerated = generatedCompatSqliteSource === null
  ? "Generated agent-monitor tree not built — run `pnpm -C apps/desktop build:agent-monitor` first"
  : false;

// ── Build script: patch functions exist ──────────────────────────────────────

test("FEA-1363: build script contains patchCompatSqliteBeginImmediate", () => {
  assert.match(
    buildScriptSource,
    /function patchCompatSqliteBeginImmediate\(/,
  );
});

test("FEA-1363: build script contains patchHooksTranscriptOutsideTx", () => {
  assert.match(
    buildScriptSource,
    /function patchHooksTranscriptOutsideTx\(/,
  );
});

test("FEA-1363: build script contains patchHooksWriteQueueAndWatchdog", () => {
  assert.match(
    buildScriptSource,
    /function patchHooksWriteQueueAndWatchdog\(/,
  );
});

test("FEA-1363: build script wires FEA-1363 patches in materializeRuntimeTree", () => {
  assert.match(buildScriptSource, /patchCompatSqliteBeginImmediate\(generatedCompatSqlite\)/);
  assert.match(buildScriptSource, /patchHooksTranscriptOutsideTx\(generatedHooksRoute\)/);
  assert.match(buildScriptSource, /patchHooksWriteQueueAndWatchdog\(generatedHooksRoute\)/);
});

test("FEA-1363: build script asserts BEGIN IMMEDIATE in assertGeneratedTree", () => {
  assert.match(buildScriptSource, /BEGIN IMMEDIATE.*FEA-1363/);
});

test("FEA-1363: build script includes sourceCompatSqlite in stamp hash", () => {
  const stampStart = buildScriptSource.indexOf("function currentStamp()");
  const stampEnd = buildScriptSource.indexOf("function materializeRuntimeTree()");
  assert.ok(stampStart > 0, "currentStamp function found");
  assert.ok(stampEnd > stampStart, "materializeRuntimeTree found after currentStamp");
  const stampSection = buildScriptSource.slice(stampStart, stampEnd);
  assert.ok(
    stampSection.includes("sourceCompatSqlite"),
    "sourceCompatSqlite must be in currentStamp() hash inputs",
  );
});

// ── Generated compat-sqlite.js ───────────────────────────────────────────────

test("FEA-1363: compat-sqlite uses BEGIN IMMEDIATE", { skip: skipGenerated }, () => {
  assert.ok(generatedCompatSqliteSource);
  assert.match(generatedCompatSqliteSource!, /"BEGIN IMMEDIATE"/);
  assert.doesNotMatch(
    generatedCompatSqliteSource!,
    /db\.exec\("BEGIN"\)/,
    "bare BEGIN (deferred) must not remain",
  );
});

// ── Generated hooks.js ───────────────────────────────────────────────────────

test("FEA-1363: hooks.js extracts processEventCore outside transaction wrapper", { skip: skipGenerated }, () => {
  assert.ok(generatedHooksSource);
  assert.match(generatedHooksSource!, /function processEventCore\(hookType, data, transcriptData\)/);
  assert.match(generatedHooksSource!, /const processEvent = db\.transaction\(processEventCore\)/);
});

test("FEA-1363: hooks.js processEvent does not call transcriptCache.extract inside tx", { skip: skipGenerated }, () => {
  assert.ok(generatedHooksSource);
  const coreStart = generatedHooksSource!.indexOf("function processEventCore(");
  const coreEnd = generatedHooksSource!.indexOf("const processEvent = db.transaction(processEventCore)");
  assert.ok(coreStart > 0 && coreEnd > coreStart, "processEventCore bounds found");
  const coreBody = generatedHooksSource!.slice(coreStart, coreEnd);
  assert.doesNotMatch(
    coreBody,
    /transcriptCache\.extract\(/,
    "transcriptCache.extract must not appear inside processEventCore",
  );
});

test("FEA-1363: hooks.js has write queue with setImmediate batching", { skip: skipGenerated }, () => {
  assert.ok(generatedHooksSource);
  assert.match(generatedHooksSource!, /hookWriteQueue/);
  assert.match(generatedHooksSource!, /drainHookQueue/);
  assert.match(generatedHooksSource!, /setImmediate\(drainHookQueue\)/);
  assert.match(generatedHooksSource!, /enqueueHookEvent/);
});

test("FEA-1363: hooks.js write queue has per-event error isolation via savepoints", { skip: skipGenerated }, () => {
  assert.ok(generatedHooksSource);
  const drainStart = generatedHooksSource!.indexOf("function drainHookQueue()");
  const drainEnd = generatedHooksSource!.indexOf("router.post(");
  assert.ok(drainStart > 0 && drainEnd > drainStart, "drainHookQueue bounds found");
  const drainBody = generatedHooksSource!.slice(drainStart, drainEnd);
  assert.match(drainBody, /try\s*\{[\s\S]*?processEventCore/, "per-event try/catch wraps processEventCore");
  assert.match(drainBody, /catch\s*\(err\)/, "catch block exists for per-event isolation");
  assert.match(drainBody, /SAVEPOINT hook_event/, "savepoint created before each event");
  assert.match(drainBody, /RELEASE hook_event/, "savepoint released on success");
  assert.match(drainBody, /ROLLBACK TO hook_event/, "savepoint rolled back on failure");
});

test("FEA-1363: hooks.js write queue has retry backoff with limit", { skip: skipGenerated }, () => {
  assert.ok(generatedHooksSource);
  const drainStart = generatedHooksSource!.indexOf("function drainHookQueue()");
  const drainEnd = generatedHooksSource!.indexOf("router.post(");
  assert.ok(drainStart > 0 && drainEnd > drainStart, "drainHookQueue bounds found");
  const drainBody = generatedHooksSource!.slice(drainStart, drainEnd);
  assert.match(drainBody, /MAX_HOOK_DRAIN_RETRIES/, "retry limit constant referenced");
  assert.match(drainBody, /hookDrainRetries/, "retry counter tracked");
  assert.match(drainBody, /setTimeout\(drainHookQueue/, "uses setTimeout for backoff instead of setImmediate");
});

test("FEA-1363: hooks.js POST handler validates session_id before enqueue", { skip: skipGenerated }, () => {
  assert.ok(generatedHooksSource);
  const postStart = generatedHooksSource!.indexOf('router.post("/event"');
  assert.ok(postStart > 0, "POST handler found");
  const postBody = generatedHooksSource!.slice(postStart, postStart + 800);
  const sessionCheck = postBody.indexOf("data.session_id");
  const enqueue = postBody.indexOf("enqueueHookEvent");
  assert.ok(sessionCheck > 0 && enqueue > sessionCheck, "session_id check before enqueue");
});

test("FEA-1363: hooks.js POST handler responds with { ok: true } without event", { skip: skipGenerated }, () => {
  assert.ok(generatedHooksSource);
  const postStart = generatedHooksSource!.indexOf('router.post("/event"');
  const postBody = generatedHooksSource!.slice(postStart, postStart + 1200);
  assert.match(postBody, /res\.json\(\{ ok: true \}\)/);
  assert.doesNotMatch(postBody, /res\.json\(\{ ok: true, event:/);
});

test("FEA-1363: hooks.js watchdog wraps reads+writes in a transaction", { skip: skipGenerated }, () => {
  assert.ok(generatedHooksSource);
  const watchdogStart = generatedHooksSource!.indexOf("function watchdogCheck()");
  assert.ok(watchdogStart > 0, "watchdogCheck found");
  const watchdogBody = generatedHooksSource!.slice(watchdogStart, watchdogStart + 5000);
  assert.match(watchdogBody, /pendingBroadcasts/, "uses pendingBroadcasts for deferred broadcasts");
  assert.match(watchdogBody, /db\.transaction\(\(\) =>/, "wraps work in db.transaction");
  assert.match(watchdogBody, /for \(const \[event, data\] of pendingBroadcasts\)/, "broadcasts after commit");
});

// ── agent-session-sync-service.ts ────────────────────────────────────────────

test("FEA-1363: agent-session-sync-service uses busy_timeout = 5000", () => {
  assert.match(syncServiceSource, /busy_timeout = 5000/);
  assert.doesNotMatch(
    syncServiceSource,
    /busy_timeout = 1000/,
    "old 1000ms timeout must not remain",
  );
});
