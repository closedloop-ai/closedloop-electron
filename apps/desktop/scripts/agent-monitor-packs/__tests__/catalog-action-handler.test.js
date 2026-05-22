"use strict";

const { after, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  TRUSTED_ACTION_HEADER,
  TRUSTED_ACTION_VALUE,
  createCatalogActionHandler,
  validateTrustedCatalogAction,
} = require("../catalog-action-handler");

const previousDashboardPort = process.env.DASHBOARD_PORT;
process.env.DASHBOARD_PORT = "4820";

after(() => {
  if (previousDashboardPort === undefined) delete process.env.DASHBOARD_PORT;
  else process.env.DASHBOARD_PORT = previousDashboardPort;
});

function makeRes() {
  return {
    body: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("validateTrustedCatalogAction rejects requests without an Origin header", () => {
  const result = validateTrustedCatalogAction({
    headers: {
      [TRUSTED_ACTION_HEADER]: TRUSTED_ACTION_VALUE,
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.error.code, "EORIGINREQUIRED");
});

test("catalog action handler rejects cross-origin requests before spawning", () => {
  let streamRunCalled = false;
  const handler = createCatalogActionHandler({
    db: {},
    installOrchestrator: {
      streamRun() {
        streamRunCalled = true;
      },
    },
    packScanner: {
      runPackScanner() {},
    },
  })("install");

  const res = makeRes();
  handler(
    {
      headers: {
        origin: "http://evil.example.com:4820",
        [TRUSTED_ACTION_HEADER]: TRUSTED_ACTION_VALUE,
      },
      query: { harness: "claude" },
      params: { pack_id: "gstack" },
      body: {},
    },
    res,
  );

  assert.equal(streamRunCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, "EBADORIGIN");
});

test("catalog action handler rejects no-origin requests before spawning", () => {
  let streamRunCalled = false;
  const handler = createCatalogActionHandler({
    db: {},
    installOrchestrator: {
      streamRun() {
        streamRunCalled = true;
      },
    },
    packScanner: {
      runPackScanner() {},
    },
  })("install");

  const res = makeRes();
  handler(
    {
      headers: {
        [TRUSTED_ACTION_HEADER]: TRUSTED_ACTION_VALUE,
      },
      query: { harness: "claude" },
      params: { pack_id: "gstack" },
      body: {},
    },
    res,
  );

  assert.equal(streamRunCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, "EORIGINREQUIRED");
});

test("catalog action handler requires the explicit trusted-action header", () => {
  let streamRunCalled = false;
  const handler = createCatalogActionHandler({
    db: {},
    installOrchestrator: {
      streamRun() {
        streamRunCalled = true;
      },
    },
    packScanner: {
      runPackScanner() {},
    },
  })("install");

  const res = makeRes();
  handler(
    {
      headers: {
        origin: "http://localhost:4820",
      },
      query: { harness: "claude" },
      params: { pack_id: "gstack" },
      body: {},
    },
    res,
  );

  assert.equal(streamRunCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, "EUNTRUSTEDACTION");
});

test("catalog action handler forwards trusted same-origin requests and rescans on success", () => {
  let captured = null;
  let rescanCount = 0;
  const handler = createCatalogActionHandler({
    db: { id: "db" },
    installOrchestrator: {
      streamRun(_db, opts) {
        captured = opts;
        opts.onComplete({ exit_code: 0, killed: false });
      },
    },
    packScanner: {
      runPackScanner() {
        rescanCount += 1;
      },
    },
  })("uninstall");

  handler(
    {
      headers: {
        origin: "http://127.0.0.1:4820",
        [TRUSTED_ACTION_HEADER]: TRUSTED_ACTION_VALUE,
      },
      query: { harness: "claude" },
      params: { pack_id: "bmad-method" },
      body: { cwd: "/tmp/project" },
    },
    makeRes(),
  );

  assert.ok(captured, "streamRun should be called");
  assert.equal(captured.action, "uninstall");
  assert.equal(captured.pack_id, "bmad-method");
  assert.equal(captured.harness, "claude");
  assert.equal(captured.cwd, "/tmp/project");
  assert.equal(rescanCount, 1);
});
