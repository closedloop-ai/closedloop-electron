// Timezone-bucketing probe. The default fixture has no events dated "today"
// (all are May 15-21; today is May 27+). That makes the events_today=0 audit
// trivially correct. This test SHOULD reveal bugs in the bucketing logic by
// injecting events with controlled timestamps and verifying counts under
// different tz_offsets.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";

let sidecar;
let cleanupDb;
let baseUrl;
let dbPath;

before(async () => {
  const tmp = makeTempDbPath();
  cleanupDb = tmp.cleanup;
  dbPath = tmp.dbPath;
  seedFixtureDb(dbPath);
  sidecar = await launchSidecar({ dbPath });
  reseedPacksAndSkills(dbPath);
  baseUrl = sidecar.baseUrl;
});

after(async () => {
  await sidecar.stop();
  cleanupDb();
});

function insertEvent(dbPath, createdAtIso) {
  const db = new DatabaseSync(dbPath);
  try {
    // Need a session_id — pick one from the fixture.
    const session = db
      .prepare(`SELECT id FROM sessions WHERE id LIKE 'fixture-%' LIMIT 1`)
      .get();
    if (!session) throw new Error("no fixture session to attach the event to");
    db.prepare(
      `INSERT INTO events (session_id, event_type, tool_name, created_at)
       VALUES (?, 'PreToolUse', 'TzProbe', ?)`,
    ).run(session.id, createdAtIso);
  } finally {
    db.close();
  }
}

function deleteEvent(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(`DELETE FROM events WHERE tool_name = 'TzProbe'`).run();
  } finally {
    db.close();
  }
}

async function statsEventsToday(tzOffset) {
  const res = await fetch(`${baseUrl}/api/stats?tz_offset=${tzOffset}`);
  const body = await res.json();
  return Number(body.events_today ?? 0);
}

test("events_today bucketing — event at UTC noon counts as today when tz_offset=0", async () => {
  const baseline = await statsEventsToday(0);
  // Use today at UTC noon — definitely within "today" in any tz that's
  // within ±12h of UTC.
  const today = new Date();
  const todayNoonUtc = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
      12,
      0,
      0,
    ),
  );
  insertEvent(dbPath, todayNoonUtc.toISOString());

  try {
    const after = await statsEventsToday(0);
    assert.equal(
      after,
      baseline + 1,
      `Inserting an event at UTC noon today should bump events_today by 1 ` +
        `when querying with tz_offset=0. Got baseline=${baseline}, after=${after}.`,
    );
  } finally {
    deleteEvent(dbPath);
  }
});

test("events_today bucketing — event 1 minute before UTC midnight does NOT count as today when tz_offset=0", async () => {
  // Edge case: an event at 23:59 UTC "yesterday" should NOT count as today.
  const baseline = await statsEventsToday(0);
  const today = new Date();
  const justBeforeMidnight = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
      0,
      -1,
      0,
    ),
  );
  insertEvent(dbPath, justBeforeMidnight.toISOString());

  try {
    const after = await statsEventsToday(0);
    assert.equal(
      after,
      baseline,
      `Inserting an event 1 minute BEFORE UTC midnight (i.e. yesterday in UTC) ` +
        `should NOT bump events_today when tz_offset=0. Got baseline=${baseline}, after=${after}.`,
    );
  } finally {
    deleteEvent(dbPath);
  }
});

test("events_today bucketing — same event counts differently under different tz_offset", { todo: "expected failure — FEA-1422 (datetime() string-comparison short-circuit)" }, async () => {
  // Insert an event at UTC 06:00 today. In UTC, this is "today". In PDT
  // (tz_offset=420, UTC-7), this is 23:00 of YESTERDAY's local date. So:
  //   tz_offset=0   → counts as today
  //   tz_offset=420 → does NOT count as today (it's yesterday in PDT)
  const today = new Date();
  const at0600Utc = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
      6,
      0,
      0,
    ),
  );
  insertEvent(dbPath, at0600Utc.toISOString());

  try {
    const utcCount = await statsEventsToday(0);
    const pdtCount = await statsEventsToday(420);
    // We can't assert exact deltas without a baseline pair, but we can assert
    // utcCount > pdtCount: the same event is in today's UTC bucket but in
    // yesterday's PDT bucket.
    assert.ok(
      utcCount > pdtCount,
      `Event at UTC 06:00 should be in today's UTC bucket but yesterday's PDT bucket. ` +
        `Got utc=${utcCount}, pdt=${pdtCount}. If equal, the bucketing logic isn't honoring tz_offset.`,
    );
  } finally {
    deleteEvent(dbPath);
  }
});
