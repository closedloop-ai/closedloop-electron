import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { SymphonyWebPocRuntime } from "../src/main/symphony-web-poc-runtime.js";

test("Symphony Web POC runtime serves local SQLite-backed API and harness", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-"));
  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    env: {
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);

  assert.equal(status.ready, true);
  assert.equal(status.mode, "local-poc");
  assert.match(status.url ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(status.apiUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(status.apiToken);
  assert.equal(status.counts.projects, 1);
  assert.equal(status.counts.workstreams, 1);
  assert.equal(status.counts.documents, 4);

  const unauthorized = await fetch(`${status.apiUrl}/health`);
  assert.equal(unauthorized.status, 401);

  const disallowedOrigin = await fetch(`${status.apiUrl}/documents`, {
    headers: {
      Authorization: `Bearer ${status.apiToken}`,
      Origin: "https://example.invalid",
    },
  });
  assert.equal(disallowedOrigin.status, 403);

  const allowedOrigin = new URL(status.url ?? "").origin;
  const healthResponse = await fetch(`${status.apiUrl}/health`, {
    headers: {
      Authorization: `Bearer ${status.apiToken}`,
      Origin: allowedOrigin,
    },
  });
  assert.equal(healthResponse.ok, true);
  assert.equal(healthResponse.headers.get("access-control-allow-origin"), allowedOrigin);
  const health = await healthResponse.json() as {
    status: string;
    counts: { documents: number };
  };
  assert.equal(health.status, "ok");
  assert.equal(health.counts.documents, 4);

  const stats = await fetchJson(`${status.apiUrl}/dashboard/stats`, status.apiToken) as {
    success: boolean;
    data: {
      prds: { count: number };
      features: { count: number };
      plans: { count: number };
    };
  };
  assert.equal(stats.success, true);
  assert.equal(stats.data.prds.count, 2);
  assert.equal(stats.data.features.count, 1);
  assert.equal(stats.data.plans.count, 1);

  const feature = await fetchJson(`${status.apiUrl}/documents/by-slug/FEA-1469`, status.apiToken) as {
    success: boolean;
    data: { slug: string; version: { version: number } };
  };
  assert.equal(feature.success, true);
  assert.equal(feature.data.slug, "FEA-1469");
  assert.equal(feature.data.version.version, 1);

  const page = await fetchText(status.url ?? "");
  assert.match(page, /Symphony Web POC Runtime/);
  assert.match(page, /desktop-local SQLite\/API runtime is online/i);
});

test("Symphony Web POC runtime can point the iframe at an external Symphony URL", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-external-"));
  const external = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
  });
  const externalPort = await listen(external);
  const externalUrl = `http://127.0.0.1:${externalPort}`;
  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    env: {
      CL_SYMPHONY_WEB_URL: externalUrl,
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    await closeServer(external);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);

  assert.equal(status.ready, true);
  assert.equal(status.mode, "external-url");
  assert.equal(status.url, externalUrl);
  assert.equal(status.source, "CL_SYMPHONY_WEB_URL");
  assert.match(status.apiUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(status.apiToken);

  const me = await fetchJson(`${status.apiUrl}/me`, status.apiToken, externalUrl) as {
    success: boolean;
    data: { email: string };
  };
  assert.equal(me.success, true);
  assert.equal(me.data.email, "desktop-poc@closedloop.local");
});

test("Symphony Web POC runtime auto-discovers and spawns a sibling Symphony app", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-autodiscover-"));
  const appDir = path.join(tmpDir, "symphony-alpha", "apps", "app");
  fs.mkdirSync(path.join(appDir, "app"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "app" }));
  fs.writeFileSync(path.join(appDir, "next.config.ts"), "export default {};\n");
  const fakePnpm = path.join(tmpDir, "fake-pnpm.mjs");
  fs.writeFileSync(
    fakePnpm,
    `#!/usr/bin/env node
import { createServer } from "node:http";

const portIndex = process.argv.indexOf("-p");
const port = Number(process.argv[portIndex + 1]);
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("real symphony app " + request.url);
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
  );
  fs.chmodSync(fakePnpm, 0o755);
  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    appDirCandidates: [appDir],
    env: {
      CL_SYMPHONY_WEB_PNPM_BIN: fakePnpm,
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);

  assert.equal(status.ready, true);
  assert.equal(status.mode, "spawned-next");
  assert.equal(status.source, "auto-discovered sibling symphony-alpha/apps/app");
  assert.match(status.url ?? "", /^http:\/\/127\.0\.0\.1:\d+\/closedloop-ai\/my-tasks$/);
  assert.ok(status.apiToken);

  const page = await fetchText(status.url ?? "");
  assert.match(page, /real symphony app \/closedloop-ai\/my-tasks/);
});

test("Symphony Web POC runtime reports spawned app startup failures without crashing", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-web-poc-spawn-fail-"));
  const appDir = path.join(tmpDir, "symphony-alpha");
  fs.mkdirSync(appDir);
  const runtime = new SymphonyWebPocRuntime({
    dataDir: tmpDir,
    env: {
      CL_SYMPHONY_APP_DIR: appDir,
      CL_SYMPHONY_WEB_PNPM_BIN: path.join(tmpDir, "missing-pnpm"),
      CL_SYMPHONY_WEB_POC_API_PORT: "0",
      CL_SYMPHONY_WEB_POC_PORT: "0",
    },
  });
  t.after(async () => {
    await runtime.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await runtime.start();
  const status = runtime.getStatus(true);

  assert.equal(status.ready, false);
  assert.equal(status.mode, null);
  assert.match(status.error ?? "", /failed to spawn|ENOENT|missing-pnpm/);
});

async function fetchJson(
  url: string,
  token: string,
  origin?: string,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(origin ? { Origin: origin } : {}),
    },
  });
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.text();
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      assert.ok(address);
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
