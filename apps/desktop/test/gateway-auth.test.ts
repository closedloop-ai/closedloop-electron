import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DesktopGatewayServer } from "../src/server/server.js";
import { LocalSessionStore } from "../src/main/local-session-store.js";
import { EMPTY_CAPABILITIES } from "../src/shared/contracts.js";

const serversToClose: DesktopGatewayServer[] = [];
const fakeApiServersToClose: http.Server[] = [];
const tempPathsToClean: string[] = [];

afterEach(async () => {
  for (const server of serversToClose.splice(0)) {
    await server.stop();
  }

  for (const fakeServer of fakeApiServersToClose.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      fakeServer.close((err) => (err ? reject(err) : resolve()));
    });
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
    preferredPort: 0,
    fallbackPorts: [0],
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

test("exchange handler passes REST API origin (getApiOrigin) to verifyChallenge, not relay origin", async () => {
  const tmpDir = await makeTempDir("exchange-uses-api-origin");
  const store = new LocalSessionStore();

  // Start a fake API server that records verify requests and returns a 401
  // so we can assert it was called at the correct origin.
  const verifyRequests: string[] = [];
  const fakeApiServer = http.createServer((req, res) => {
    verifyRequests.push(req.url ?? "");
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "test-rejected" }));
  });
  fakeApiServersToClose.push(fakeApiServer);

  await new Promise<void>((resolve) => {
    fakeApiServer.listen(0, "127.0.0.1", resolve);
  });

  const fakeApiAddress = fakeApiServer.address() as net.AddressInfo;
  const fakeApiOrigin = `http://127.0.0.1:${fakeApiAddress.port}`;
  // Use a clearly different relay origin to prove the exchange uses getApiOrigin, not relayOrigin
  const relayOrigin = "http://127.0.0.1:19999";

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.test.com",
    getAllowedDirectories: () => [tmpDir],
    getGatewayAuthToken: () => "test-gateway-token-hex",
    machineName: "test-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    sessionStore: store,
    getApiKey: () => "sk_live_testkey",
    getApiOrigin: () => fakeApiOrigin,
  });
  serversToClose.push(server);
  await server.start();

  // Call the exchange endpoint — it will fail (401 from fake server),
  // but the important thing is the fake API server received the verify call.
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/gateway-auth/exchange`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ challengeToken: "some-challenge-jwt" }),
    }
  );

  // The fake server rejected it, so the exchange should return 401
  assert.equal(response.status, 401);

  // The fake API server must have received a verify request on its /compute-targets/local-auth/verify path
  assert.ok(
    verifyRequests.some((url) => url === "/compute-targets/local-auth/verify"),
    `Expected fake API server (${fakeApiOrigin}) to receive /compute-targets/local-auth/verify but got: ${JSON.stringify(verifyRequests)}. ` +
      `This proves getApiOrigin() (REST API) is used for auth, not the relay origin (${relayOrigin}).`
  );
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

// --- Production Origins Only Mode ---

test("prodOriginsOnly: exchange from loopback origin returns 403", async () => {
  const tmpDir = await makeTempDir("prod-exchange-loopback");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store, { prodOriginsOnly: true });
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/gateway-auth/exchange`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ challengeToken: "some-token" }),
    }
  );

  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /production-origins-only/);
});

test("prodOriginsOnly: no-auth mode + loopback origin engineer request returns 401", async () => {
  const tmpDir = await makeTempDir("prod-noauth-loopback");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store, {
    prodOriginsOnly: true,
    getGatewayAuthToken: () => undefined,
  });
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    {
      headers: { Origin: "http://localhost:3000" },
    }
  );

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string; reason?: string };
  assert.equal(body.error, "unauthorized");
  assert.match(body.reason ?? "", /prod-origins-only/);
});

test("prodOriginsOnly: exchange from configured origin succeeds (no-auth shortcut)", async () => {
  const tmpDir = await makeTempDir("prod-exchange-configured");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store, {
    prodOriginsOnly: true,
    getGatewayAuthToken: () => undefined,
  });
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/gateway-auth/exchange`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://app.test.com",
      },
      body: JSON.stringify({}),
    }
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { sessionToken: string; expiresAt: string };
  assert.ok(typeof body.sessionToken === "string" && body.sessionToken.length > 0);
});

test("prodOriginsOnly: gateway token request (no Origin) succeeds", async () => {
  const tmpDir = await makeTempDir("prod-gateway-token");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store, { prodOriginsOnly: true });
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

test("prodOriginsOnly: gateway token + blocked Origin header still succeeds", async () => {
  const tmpDir = await makeTempDir("prod-gateway-token-with-origin");
  const store = new LocalSessionStore();
  const server = makeServer(tmpDir, store, { prodOriginsOnly: true });
  await server.start();

  // Relayed cloud commands may carry an Origin header forwarded from the browser.
  // The gateway token must take precedence over the origin gate.
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/directories?path=${tmpDir}`,
    {
      headers: {
        "X-Desktop-Gateway-Token": "test-gateway-token-hex",
        Origin: "http://localhost:3000",
      },
    }
  );

  assert.equal(response.status, 200);
});

test("normal mode: exchange from random origin does NOT return 403 (reaches normal flow)", async () => {
  const tmpDir = await makeTempDir("normal-random-origin");
  const store = new LocalSessionStore();
  // No prodOriginsOnly flag
  const server = makeServer(tmpDir, store);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/gateway-auth/exchange`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://random.example",
      },
      body: JSON.stringify({ challengeToken: "some-token" }),
    }
  );

  // Should return 503 (no API key configured), NOT 403
  assert.equal(response.status, 503);
});
