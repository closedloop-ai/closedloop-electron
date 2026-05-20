import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);

const {
  RECENT_SESSION_ACTIVITY_THRESHOLD_MS,
  isSessionRecentlyActive,
  reactivateImportedSession,
} = require("../scripts/agent-monitor-shared/import-session-utils.js") as {
  RECENT_SESSION_ACTIVITY_THRESHOLD_MS: number;
  isSessionRecentlyActive: (
    session: { fileModifiedAt?: number | null } | null | undefined,
    now?: number,
  ) => boolean;
  reactivateImportedSession: (
    dbModule: {
      stmts: {
        getSession: { get: (id: string) => Record<string, any> | undefined };
        reactivateSession: { run: (id: string) => void };
        clearSessionAwaitingInput: { run: (id: string) => void };
        getAgent: { get: (id: string) => Record<string, any> | undefined };
      };
      db: { prepare: (_sql: string) => { run: (id: string) => void } };
    },
    session: { sessionId: string; fileModifiedAt?: number | null },
    now?: number,
  ) => boolean;
};

test("isSessionRecentlyActive uses the shared recent-activity threshold", () => {
  const now = 1_000_000;

  assert.equal(
    isSessionRecentlyActive(
      { fileModifiedAt: now - RECENT_SESSION_ACTIVITY_THRESHOLD_MS + 1 },
      now,
    ),
    true,
  );
  assert.equal(
    isSessionRecentlyActive(
      { fileModifiedAt: now - RECENT_SESSION_ACTIVITY_THRESHOLD_MS - 1 },
      now,
    ),
    false,
  );
  assert.equal(isSessionRecentlyActive({ fileModifiedAt: null }, now), false);
});

test("reactivateImportedSession revives recently-active imported sessions", () => {
  const sessionRows = new Map([
    [
      "sess-1",
      {
        id: "sess-1",
        status: "abandoned",
        ended_at: "2026-05-20T15:12:08.860Z",
        awaiting_input_since: "2026-05-20T15:12:08.860Z",
      },
    ],
  ]);
  const agentRows = new Map([
    [
      "sess-1-main",
      {
        id: "sess-1-main",
        status: "completed",
        ended_at: "2026-05-20T15:12:08.860Z",
        current_tool: "exec_command",
        awaiting_input_since: "2026-05-20T15:12:08.860Z",
      },
    ],
  ]);

  const dbModule = {
    stmts: {
      getSession: {
        get: (id: string) => sessionRows.get(id),
      },
      reactivateSession: {
        run: (id: string) => {
          const row = sessionRows.get(id);
          if (!row) return;
          row.status = "active";
          row.ended_at = null;
        },
      },
      clearSessionAwaitingInput: {
        run: (id: string) => {
          const row = sessionRows.get(id);
          if (!row) return;
          row.awaiting_input_since = null;
        },
      },
      getAgent: {
        get: (id: string) => agentRows.get(id),
      },
    },
    db: {
      prepare: (_sql: string) => ({
        run: (id: string) => {
          const row = agentRows.get(id);
          if (!row) return;
          row.status = "waiting";
          row.ended_at = null;
          row.current_tool = null;
          row.awaiting_input_since = null;
        },
      }),
    },
  };

  const now = 2_000_000;
  const reactivated = reactivateImportedSession(
    dbModule,
    {
      sessionId: "sess-1",
      fileModifiedAt: now - 1_000,
    },
    now,
  );

  assert.equal(reactivated, true);
  assert.deepEqual(sessionRows.get("sess-1"), {
    id: "sess-1",
    status: "active",
    ended_at: null,
    awaiting_input_since: null,
  });
  assert.deepEqual(agentRows.get("sess-1-main"), {
    id: "sess-1-main",
    status: "waiting",
    ended_at: null,
    current_tool: null,
    awaiting_input_since: null,
  });
});

test("reactivateImportedSession ignores stale or already-live sessions", () => {
  const dbModule = {
    stmts: {
      getSession: {
        get: (_id: string) => ({ status: "active", ended_at: null }),
      },
      reactivateSession: {
        run: (_id: string) => {
          throw new Error("should not reactivate");
        },
      },
      clearSessionAwaitingInput: {
        run: (_id: string) => {
          throw new Error("should not clear awaiting input");
        },
      },
      getAgent: {
        get: (_id: string) => undefined,
      },
    },
    db: {
      prepare: (_sql: string) => ({
        run: (_id: string) => {
          throw new Error("should not update main agent");
        },
      }),
    },
  };

  const now = 3_000_000;
  assert.equal(
    reactivateImportedSession(
      dbModule,
      {
        sessionId: "sess-2",
        fileModifiedAt: now - RECENT_SESSION_ACTIVITY_THRESHOLD_MS - 1,
      },
      now,
    ),
    false,
  );
  assert.equal(
    reactivateImportedSession(
      dbModule,
      {
        sessionId: "sess-2",
        fileModifiedAt: now - 1_000,
      },
      now,
    ),
    false,
  );
});
