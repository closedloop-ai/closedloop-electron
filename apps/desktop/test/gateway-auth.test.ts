import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DesktopGatewayServer } from "../src/server/server.js";
import { LocalSessionStore } from "../src/main/local-session-store.js";
import { EMPTY_CAPABILITIES, PORT_PROBE_ORDER } from "../src/shared/contracts.js";

const serversToClose: DesktopGatewayServer[] = [];
const tempPathsToClean: string[] = [];

afterEach(async () => {
  for (const server of serversToClose.splice(0)) {
    await server.stop();
  }

  for (const tmpPath of tempPathsToClean.splice(0)) {
    await fs.rm(tmpPath, { recursive: true, force: true });
  }
});

async function makeTempDir(suffix: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `gateway-auth-test-${suffix}-`));
  tempPathsToClean.push(tmpDir);
  return tmpDir;
}

function makeServer(
  tmpDir: string,
  store: LocalSessionStore,
  overrides: Partial<ConstructorParameters<typeof DesktopGatewayServer>[0]> = {}
): DesktopGatewayServer {
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.test.com",
    getAllowedDirectories: () => [tmpDir],
    getGatewayAuthToken: () => "test-gateway-token-hex",
    machineName: "test-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    sessionStore: store,
    getApiKey: () => null,
    getApiOrigin: () => "https://api.test.com",
    ...overrides,
  });
  serversToClose.push(server);
  return server;
}

test("engineer route rejects spoofed origin without session token (401)", async () => {
  const tmpDir = await makeTempDir("no-session");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store);
  await server.start();

  // No session token was created for this origin — browser-style request with Origin only
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    { headers: { Origin: "http://localhost" } }
  );

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string; reason?: string };
  assert.equal(body.error, "unauthorized");
});

test("engineer route rejects missing origin even with browser-like headers (401)", async () => {
  const tmpDir = await makeTempDir("no-origin");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store);
  await server.start();

  // Browser-like headers but no Origin and no session token
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        "Sec-Fetch-Mode": "cors",
      },
    }
  );

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "unauthorized");
});

test("engineer route accepts valid session token with matching origin (200)", async () => {
  const tmpDir = await makeTempDir("valid-session");
  const store = new LocalSessionStore();
  const { sessionToken } = store.create("http://localhost:3000");
  const server = makeServer(tmpDir, store);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    {
      headers: {
        Origin: "http://localhost:3000",
        "X-Desktop-Session-Token": sessionToken,
      },
    }
  );

  assert.equal(response.status, 200);
});

test("engineer route rejects expired session token (401)", async () => {
  const tmpDir = await makeTempDir("expired-session");
  const store = new LocalSessionStore(0.05); // 50 ms TTL
  const { sessionToken } = store.create("http://localhost:3000");
  const server = makeServer(tmpDir, store);
  await server.start();

  await new Promise((resolve) => setTimeout(resolve, 100));

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    {
      headers: {
        Origin: "http://localhost:3000",
        "X-Desktop-Session-Token": sessionToken,
      },
    }
  );

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "unauthorized");
});

test("engineer route rejects session token with mismatched origin (401)", async () => {
  const tmpDir = await makeTempDir("origin-mismatch");
  const store = new LocalSessionStore();
  const { sessionToken } = store.create("http://localhost:3000");
  const server = makeServer(tmpDir, store);
  await server.start();

  // Send the valid token but with a different origin
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    {
      headers: {
        Origin: "http://localhost:4000",
        "X-Desktop-Session-Token": sessionToken,
      },
    }
  );

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "unauthorized");
});

test("exchange route rejects request with missing Origin header (400)", async () => {
  const tmpDir = await makeTempDir("exchange-no-origin");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/gateway-auth/exchange`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeToken: "some-token" }),
    }
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "Origin header required");
});

test("internal cloud token path still works (200)", async () => {
  const tmpDir = await makeTempDir("cloud-token");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store);
  await server.start();

  // Cloud executor uses the internal gateway token directly — no session needed
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    {
      headers: {
        "X-Desktop-Gateway-Token": "test-gateway-token-hex",
      },
    }
  );

  // 200 because the directories route returns the listing
  assert.equal(response.status, 200);
});

// --- Fail-closed: missing API key ---

test("exchange route returns 503 with actionable error when API key is missing", async () => {
  const tmpDir = await makeTempDir("exchange-no-apikey");
  const store = new LocalSessionStore();
  // Default makeServer has getApiKey: () => null
  const server = makeServer(tmpDir, store);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/gateway-auth/exchange`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ challengeToken: "some-jwt" }),
    }
  );

  assert.equal(response.status, 503);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "Local gateway auth unavailable: API key required");
});

test("app boots and serves health endpoint without API key", async () => {
  const tmpDir = await makeTempDir("boot-no-apikey");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/health`
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { status: string };
  assert.equal(body.status, "ok");
});

test("local-electron mode fails closed: no session token obtainable without API key", async () => {
  const tmpDir = await makeTempDir("fail-closed-no-apikey");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store);
  await server.start();

  // Without an API key, a browser cannot obtain a session token via exchange.
  // Direct request to an engineer route with only an Origin header is rejected.
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    {
      headers: {
        Origin: "http://localhost:3000",
      },
    }
  );

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string; reason?: string };
  assert.equal(body.error, "unauthorized");
  assert.equal(body.reason, "session token required for browser requests");
});

test("hosted relay path (cloud gateway token) unaffected by missing API key", async () => {
  const tmpDir = await makeTempDir("relay-unaffected");
  const store = new LocalSessionStore();
  // No API key, but the cloud executor uses the internal gateway token
  const server = makeServer(tmpDir, store);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    {
      headers: {
        "X-Desktop-Gateway-Token": "test-gateway-token-hex",
      },
    }
  );

  assert.equal(response.status, 200);
});

test("CORS preflight includes X-Desktop-Session-Token in Access-Control-Allow-Headers", async () => {
  const tmpDir = await makeTempDir("cors-preflight");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories`,
    {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Desktop-Session-Token",
      },
    }
  );

  assert.equal(response.status, 204);

  const allowedHeaders = response.headers.get("access-control-allow-headers");
  assert.ok(
    allowedHeaders !== null && allowedHeaders.includes("X-Desktop-Session-Token"),
    `Expected Access-Control-Allow-Headers to include X-Desktop-Session-Token, got: ${allowedHeaders}`
  );
});
