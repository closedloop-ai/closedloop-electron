/**
 * @file Tests for install-orchestrator (FEA-1314 / PLN-657).
 * Uses a stub Express-like `res` object that captures SSE writes; the
 * actual subprocess is `sh -c 'echo / exit'` so each test runs in
 * milliseconds without touching the filesystem.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const {
  ensureCatalogSchema,
  upsertCatalogSeed,
  listInstallRuns,
} = require("../catalog-store");
const { ensurePackSchema } = require("../pack-store");
const { streamRun, _internals } = require("../install-orchestrator");

function makeDb() {
  const db = new DatabaseSync(":memory:");
  ensurePackSchema(db); // streamRun -> getCatalog joins agent_packs/skills
  ensureCatalogSchema(db);
  return db;
}

function seedCatalog(db, packId, installCmd, uninstallCmd = null, options = {}) {
  const installCommands =
    options.installCommands || { claude: installCmd };
  const harnesses = options.harnesses || Object.keys(installCommands);
  const uninstallCommands =
    options.uninstallCommands || (uninstallCmd ? { claude: uninstallCmd } : null);
  upsertCatalogSeed(db, {
    seed_version: 1,
    packs: [
      {
        pack_id: packId,
        display_name: packId,
        github_url: `https://github.com/test/${packId}`,
        harnesses,
        install_commands: installCommands,
        ...(uninstallCommands ? { uninstall_commands: uninstallCommands } : {}),
        ...(options.singleInstall ? { single_install: true } : {}),
        ...(options.projectScoped ? { project_scoped: true } : {}),
      },
    ],
  });
}

function makeRes() {
  const events = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) {
      this.headersSent = true;
      this.status = status;
      this.headers = headers;
    },
    write(chunk) {
      events.push(String(chunk));
    },
    end() {
      this.writableEnded = true;
    },
    on() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      events.push(`JSON ${JSON.stringify(body)}`);
      this.writableEnded = true;
    },
  };
  res.events = events;
  return res;
}

function awaitComplete(res) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (res.writableEnded) return resolve();
      if (Date.now() - start > 5000) return resolve();
      setTimeout(check, 10);
    };
    check();
  });
}

test("stripAnsi removes ANSI escape sequences", () => {
  const out = _internals.stripAnsi("hello\x1b[31mRED\x1b[0mworld");
  assert.equal(out, "helloREDworld");
});

test("tailBytes truncates to ~4KB tail", () => {
  const big = "x".repeat(10000);
  const tail = _internals.tailBytes(big);
  assert.ok(tail.length <= 4100, `got ${tail.length}`);
  assert.ok(tail.startsWith("…"));
});

test("streamRun records exit_code=0 for a successful command", async () => {
  const db = makeDb();
  seedCatalog(db, "ok-pack", "echo hello");
  const res = makeRes();
  streamRun(db, {
    pack_id: "ok-pack",
    harness: "claude",
    action: "install",
    res,
  });
  await awaitComplete(res);
  const runs = listInstallRuns(db, { pack_id: "ok-pack" });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].exit_code, 0);
  // SSE should include a `complete` event
  assert.ok(res.events.some((e) => e.includes("event: complete")));
  assert.ok(res.events.some((e) => e.includes("hello")));
});

test("streamRun records non-zero exit_code for a failing command", async () => {
  const db = makeDb();
  seedCatalog(db, "fail-pack", "exit 7");
  const res = makeRes();
  streamRun(db, {
    pack_id: "fail-pack",
    harness: "claude",
    action: "install",
    res,
  });
  await awaitComplete(res);
  const runs = listInstallRuns(db, { pack_id: "fail-pack" });
  assert.equal(runs[0].exit_code, 7);
});

// sse() makes two res.write() calls per event (one for `event:` line, one for
// `data:` line + frame terminator). Join the events buffer back into a single
// string before asserting on contents.
function joined(res) {
  return res.events.join("");
}

test("streamRun refuses concurrent runs for the same pack", async () => {
  const db = makeDb();
  seedCatalog(db, "concur-pack", "sleep 1");
  const res1 = makeRes();
  streamRun(db, {
    pack_id: "concur-pack",
    harness: "claude",
    action: "install",
    res: res1,
  });
  // Immediately attempt a second run while the first is in-flight
  const res2 = makeRes();
  streamRun(db, {
    pack_id: "concur-pack",
    harness: "claude",
    action: "install",
    res: res2,
  });
  await awaitComplete(res2);
  const stream = joined(res2);
  assert.ok(
    stream.includes("event: error") && stream.includes("in-flight"),
    `expected in-flight error; got stream: ${stream.slice(0, 400)}`,
  );
  await awaitComplete(res1);
});

test("streamRun errors when no install_command exists for the harness", async () => {
  const db = makeDb();
  seedCatalog(db, "nohost-pack", "echo ok");
  const res = makeRes();
  streamRun(db, {
    pack_id: "nohost-pack",
    harness: "codex",
    action: "install",
    res,
  });
  await awaitComplete(res);
  const stream = joined(res);
  assert.ok(
    stream.includes("event: error") && stream.includes("no install command"),
    `expected no-install-command error; got stream: ${stream.slice(0, 400)}`,
  );
});

test("streamRun single_install uninstall runs every cleanup but fails overall when one step fails", async () => {
  const db = makeDb();
  seedCatalog(db, "single-uninstall-fail-pack", "echo install", null, {
    singleInstall: true,
    harnesses: ["claude", "codex"],
    installCommands: {
      claude: "echo install-claude",
      codex: "echo install-codex",
    },
    uninstallCommands: {
      claude: "echo claude-cleanup && exit 7",
      codex: "echo codex-cleanup",
    },
  });
  const res = makeRes();
  streamRun(db, {
    pack_id: "single-uninstall-fail-pack",
    harness: "auto",
    action: "uninstall",
    res,
  });
  await awaitComplete(res);
  const stream = joined(res);
  assert.ok(stream.includes("claude-cleanup"), "first cleanup should still run");
  assert.ok(stream.includes("codex-cleanup"), "later cleanup should still run");
  const runs = listInstallRuns(db, { pack_id: "single-uninstall-fail-pack" });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].exit_code, 1);
});

test("streamRun single_install uninstall reports missing uninstall commands clearly", async () => {
  const db = makeDb();
  seedCatalog(db, "single-uninstall-missing-pack", "echo install", null, {
    singleInstall: true,
    harnesses: ["claude", "codex"],
    installCommands: {
      claude: "echo install-claude",
      codex: "echo install-codex",
    },
  });
  const res = makeRes();
  streamRun(db, {
    pack_id: "single-uninstall-missing-pack",
    harness: "auto",
    action: "uninstall",
    res,
  });
  await awaitComplete(res);
  const stream = joined(res);
  assert.ok(stream.includes("no uninstall commands are configured"));
  assert.ok(!stream.includes("Install Claude Code or Codex first"));
});

test("streamRun requires an explicit cwd for project-scoped commands", async () => {
  const db = makeDb();
  seedCatalog(db, "project-pack", "pwd", null, {
    projectScoped: true,
  });
  const res = makeRes();
  streamRun(db, {
    pack_id: "project-pack",
    harness: "claude",
    action: "install",
    res,
  });
  await awaitComplete(res);
  const stream = joined(res);
  assert.ok(
    stream.includes("event: copy_command") && stream.includes("cwd_required"),
    `expected cwd-required error; got stream: ${stream.slice(0, 400)}`,
  );
  assert.equal(listInstallRuns(db, { pack_id: "project-pack" }).length, 0);
});

test("streamRun runs project-scoped commands in the provided cwd", async () => {
  const db = makeDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-cwd-"));
  try {
    seedCatalog(db, "cwd-pack", "pwd", null, {
      projectScoped: true,
    });
    const res = makeRes();
    streamRun(db, {
      pack_id: "cwd-pack",
      harness: "claude",
      action: "install",
      cwd: tmpDir,
      res,
    });
    await awaitComplete(res);
    const stream = joined(res);
    assert.ok(
      stream.includes(tmpDir),
      `expected command to run in ${tmpDir}; got stream: ${stream.slice(0, 400)}`,
    );
    const runs = listInstallRuns(db, { pack_id: "cwd-pack" });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].exit_code, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("streamRun uses an allowlisted child env and does not leak arbitrary secrets", async () => {
  const db = makeDb();
  const secretKey = "CLOSEDLOOP_SECRET_SENTINEL";
  const previous = process.env[secretKey];
  process.env[secretKey] = "super-secret-value";
  try {
    seedCatalog(
      db,
      "env-pack",
      `printf '%s' "$${secretKey}"`,
    );
    const res = makeRes();
    streamRun(db, {
      pack_id: "env-pack",
      harness: "claude",
      action: "install",
      res,
    });
    await awaitComplete(res);
    const stream = joined(res);
    assert.ok(!stream.includes("super-secret-value"));
    const runs = listInstallRuns(db, { pack_id: "env-pack" });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].exit_code, 0);
    assert.equal(runs[0].stdout_tail, null);
  } finally {
    if (previous === undefined) delete process.env[secretKey];
    else process.env[secretKey] = previous;
  }
});
