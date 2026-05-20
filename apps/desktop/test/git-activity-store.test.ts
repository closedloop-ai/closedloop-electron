import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  GitActivityStore,
  computeEventId,
  type GitActivityEventInput,
} from "../src/main/git-activity-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-activity-store-test-"));
  tempDirs.push(dir);
  return dir;
}

function createStore(name: string): GitActivityStore {
  return new GitActivityStore({ cwd: makeTempDir(), name });
}

function makeEvent(overrides: Partial<GitActivityEventInput> = {}): GitActivityEventInput {
  return {
    type: "pr-link",
    prUrl: "https://github.com/closedloop-ai/closedloop-electron/pull/42",
    prNumber: 42,
    repoFullName: "closedloop-ai/closedloop-electron",
    branchName: "feature/something",
    commitSha: "abc1234",
    sourceClient: "claude-code",
    sourceSessionId: "session-abc",
    ...overrides,
  };
}

describe("GitActivityStore add()", () => {
  test("returns 'disabled' and writes nothing when capture is off", () => {
    const store = createStore("disabled-noop");
    assert.equal(store.isEnabled(), false);
    const result = store.add(makeEvent());
    assert.equal(result, "disabled");
    assert.equal(store.list().length, 0);
  });

  test("returns 'added' when enabled, persists event, fires onChange", () => {
    const store = createStore("enabled-add");
    store.setEnabled(true);
    let observed = 0;
    store.onChange(() => observed++);
    const result = store.add(makeEvent());
    assert.equal(result, "added");
    assert.equal(store.list().length, 1);
    assert.equal(observed, 1);
  });

  test("returns 'duplicate' on second add with same (sourceClient, sourceSessionId, prUrl)", () => {
    const store = createStore("dedup");
    store.setEnabled(true);
    store.add(makeEvent());
    let extraNotifications = 0;
    store.onChange(() => extraNotifications++);
    const result = store.add(makeEvent());
    assert.equal(result, "duplicate");
    assert.equal(store.list().length, 1);
    assert.equal(extraNotifications, 0, "duplicate must not fire onChange");
  });

  test("treats the same PR in different sessions as distinct events", () => {
    const store = createStore("multi-session");
    store.setEnabled(true);
    store.add(makeEvent({ sourceSessionId: "session-a" }));
    store.add(makeEvent({ sourceSessionId: "session-b" }));
    assert.equal(store.list().length, 2);
  });

  test("derives a stable id matching computeEventId()", () => {
    const store = createStore("id-stable");
    store.setEnabled(true);
    store.add(makeEvent({ sourceSessionId: "sess-fixed" }));
    const event = store.list()[0];
    const expected = computeEventId(
      "claude-code",
      "sess-fixed",
      "https://github.com/closedloop-ai/closedloop-electron/pull/42",
    );
    assert.equal(event.id, expected);
    assert.match(event.id, /^[0-9a-f]{16}$/);
  });

  test("populates observedAt with ISO-8601 timestamp", () => {
    const store = createStore("observed-at");
    store.setEnabled(true);
    const before = new Date().toISOString();
    store.add(makeEvent());
    const after = new Date().toISOString();
    const event = store.list()[0];
    assert.ok(event.observedAt >= before);
    assert.ok(event.observedAt <= after);
  });
});

describe("GitActivityStore list()", () => {
  test("returns events newest-first", () => {
    const store = createStore("ordering");
    store.setEnabled(true);
    store.add(makeEvent({ prNumber: 1, prUrl: "https://github.com/owner-real/repo-real/pull/1" }));
    store.add(makeEvent({ prNumber: 2, prUrl: "https://github.com/owner-real/repo-real/pull/2" }));
    const events = store.list();
    assert.equal(events[0].prNumber, 2);
    assert.equal(events[1].prNumber, 1);
  });

  test("respects limit", () => {
    const store = createStore("limit");
    store.setEnabled(true);
    for (let i = 0; i < 10; i++) {
      store.add(
        makeEvent({
          prNumber: i,
          prUrl: `https://github.com/closedloop-ai/closedloop-electron/pull/${i}`,
        }),
      );
    }
    assert.equal(store.list({ limit: 3 }).length, 3);
  });

  test("respects sinceIso", () => {
    const store = createStore("since");
    store.setEnabled(true);
    store.add(
      makeEvent({
        prUrl: "https://github.com/closedloop-ai/closedloop-electron/pull/1",
        observedAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    store.add(
      makeEvent({
        prUrl: "https://github.com/closedloop-ai/closedloop-electron/pull/2",
        observedAt: "2030-01-01T00:00:00.000Z",
      }),
    );
    const recent = store.list({ sinceIso: "2025-01-01T00:00:00.000Z" });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].prNumber, 42); // makeEvent default prNumber, the second add overrides URL but not prNumber unless set
  });
});

describe("GitActivityStore retention", () => {
  test("caps at MAX_RETAINED (1000), evicting oldest first", () => {
    const store = createStore("retention");
    store.setEnabled(true);
    for (let i = 0; i < 1005; i++) {
      store.add(
        makeEvent({
          prNumber: i,
          prUrl: `https://github.com/owner-real/repo-real/pull/${i}`,
        }),
      );
    }
    const events = store.list();
    assert.equal(events.length, 1000);
    // newest-first: the freshest should be 1004, the oldest retained should be 5
    assert.equal(events[0].prNumber, 1004);
    assert.equal(events[events.length - 1].prNumber, 5);
  });
});

describe("GitActivityStore clear()", () => {
  test("returns count cleared, empties events, fires onChange once", () => {
    const store = createStore("clear");
    store.setEnabled(true);
    for (let i = 0; i < 5; i++) {
      store.add(
        makeEvent({
          prNumber: i,
          prUrl: `https://github.com/owner-real/repo-real/pull/${i}`,
        }),
      );
    }
    let notifications = 0;
    store.onChange(() => notifications++);
    const cleared = store.clear();
    assert.equal(cleared, 5);
    assert.equal(store.list().length, 0);
    assert.equal(notifications, 1);
  });

  test("clear() on empty store returns 0 and does not fire onChange", () => {
    const store = createStore("clear-empty");
    store.setEnabled(true);
    let notifications = 0;
    store.onChange(() => notifications++);
    const cleared = store.clear();
    assert.equal(cleared, 0);
    assert.equal(notifications, 0);
  });
});

describe("GitActivityStore setEnabled()", () => {
  test("persists across instantiations and gates future writes", () => {
    const dir = makeTempDir();
    const a = new GitActivityStore({ cwd: dir, name: "persist" });
    a.setEnabled(true);
    assert.equal(a.isEnabled(), true);

    const b = new GitActivityStore({ cwd: dir, name: "persist" });
    assert.equal(b.isEnabled(), true);

    // disable and re-instantiate; new instance should reflect off
    b.setEnabled(false);
    const c = new GitActivityStore({ cwd: dir, name: "persist" });
    assert.equal(c.isEnabled(), false);
    assert.equal(c.add(makeEvent()), "disabled");
  });
});
