import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { ActivityLogStore } from "../src/main/activity-log-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "activity-log-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeStoreFile(dir: string, name: string, events: unknown[]): void {
  fs.writeFileSync(
    path.join(dir, `${name}.json`),
    JSON.stringify({ events })
  );
}

function readStoreFile(dir: string, name: string): { events: unknown[] } {
  return JSON.parse(
    fs.readFileSync(path.join(dir, `${name}.json`), "utf-8")
  );
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    method: "GET",
    path: "/api/test",
    statusCode: 200,
    durationMs: 10,
    ...overrides,
  };
}

function createStore(dir: string, name: string, maxEntries = 200) {
  return new ActivityLogStore({ maxEntries, cwd: dir, name });
}

// --- truncateBody via add() ---

describe("ActivityLogStore body truncation", () => {
  test("preserves short bodies unchanged", () => {
    const dir = makeTempDir();
    const store = createStore(dir, "truncate-short", 10);
    const event = store.add({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/api/test",
      statusCode: 200,
      durationMs: 5,
      requestBody: "short body",
      responseBody: '{"ok": true}',
    });

    assert.equal(event.requestBody, "short body");
    assert.equal(event.responseBody, '{"ok": true}');
  });

  test("truncates bodies exceeding 8192 bytes", () => {
    const dir = makeTempDir();
    const store = createStore(dir, "truncate-large", 10);
    const largeBody = "x".repeat(20_000);
    const event = store.add({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/api/test",
      statusCode: 200,
      durationMs: 5,
      requestBody: largeBody,
      responseBody: largeBody,
    });

    assert.ok(event.requestBody!.length < largeBody.length);
    assert.ok(event.requestBody!.startsWith("x".repeat(100)));
    assert.ok(event.requestBody!.includes("truncated"));
    assert.ok(event.requestBody!.includes("20000 bytes total"));
    assert.ok(event.responseBody!.includes("truncated"));
  });

  test("preserves undefined bodies", () => {
    const dir = makeTempDir();
    const store = createStore(dir, "truncate-undef", 10);
    const event = store.add({
      timestamp: new Date().toISOString(),
      method: "GET",
      path: "/api/test",
      statusCode: 200,
      durationMs: 5,
    });

    assert.equal(event.requestBody, undefined);
    assert.equal(event.responseBody, undefined);
  });
});

// --- Constructor migration ---

describe("ActivityLogStore startup migration", () => {
  test("truncates oversized bodies from persisted events on startup", () => {
    const dir = makeTempDir();
    const name = "migrate-bodies";
    const largeBody = "y".repeat(20_000);
    writeStoreFile(dir, name, [
      makeEvent({ requestBody: largeBody, responseBody: largeBody }),
      makeEvent({ requestBody: "small", responseBody: "small" }),
    ]);

    const store = createStore(dir, name);
    const events = store.list();

    assert.equal(events.length, 2);
    assert.ok(events[0].requestBody!.includes("truncated"));
    assert.equal(events[1].requestBody, "small");
    assert.equal(events[1].responseBody, "small");

    // Verify the truncated data was persisted to disk
    const persisted = readStoreFile(dir, name);
    const persistedEvents = persisted.events as Array<Record<string, unknown>>;
    assert.ok((persistedEvents[0].requestBody as string).includes("truncated"));
    assert.equal(persistedEvents[1].requestBody, "small");
  });

  test("trims event count to maxEntries on startup", () => {
    const dir = makeTempDir();
    const name = "migrate-count";
    const events = Array.from({ length: 50 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, requestBody: "ok" })
    );
    writeStoreFile(dir, name, events);

    const store = createStore(dir, name, 10);
    assert.equal(store.list().length, 10);

    // Verify persisted file was trimmed too
    const persisted = readStoreFile(dir, name);
    assert.equal((persisted.events as unknown[]).length, 10);
  });

  test("does not rewrite file when nothing needs migration", () => {
    const dir = makeTempDir();
    const name = "migrate-noop";
    writeStoreFile(dir, name, [makeEvent({ requestBody: "small" })]);
    const statBefore = fs.statSync(path.join(dir, `${name}.json`));

    createStore(dir, name);

    const statAfter = fs.statSync(path.join(dir, `${name}.json`));
    assert.equal(statAfter.mtimeMs, statBefore.mtimeMs);
  });
});

// --- maxEntries enforcement ---

describe("ActivityLogStore maxEntries", () => {
  test("caps events at maxEntries when adding", () => {
    const dir = makeTempDir();
    const store = createStore(dir, "max-entries", 3);
    for (let i = 0; i < 5; i++) {
      store.add({
        timestamp: new Date().toISOString(),
        method: "GET",
        path: `/api/test/${i}`,
        statusCode: 200,
        durationMs: 1,
      });
    }

    assert.equal(store.list().length, 3);
    assert.equal(store.list()[0].path, "/api/test/4");
  });
});
