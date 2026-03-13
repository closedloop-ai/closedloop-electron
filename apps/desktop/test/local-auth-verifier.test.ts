import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { verifyChallenge } from "../src/main/local-auth-verifier.js";

const VERIFY_URL = "https://api.test.com/compute-targets/local-auth/verify";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeFetch(status: number, body: unknown): typeof fetch {
  return async (_url, _init) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  };
}

test("successful verification returns { ok: true, sessionTtlSeconds: 600 }", async () => {
  globalThis.fetch = makeFetch(200, { ok: true, sessionTtlSeconds: 600 });

  const result = await verifyChallenge({
    challengeToken: "tok123",
    requestOrigin: "http://localhost:3000",
    apiOrigin: "https://api.test.com",
    apiKey: "key-abc",
  });

  assert.deepEqual(result, { ok: true, sessionTtlSeconds: 600 });
});

test("successful verification also accepts the legacy ApiResult envelope", async () => {
  globalThis.fetch = makeFetch(200, {
    success: true,
    data: { ok: true, sessionTtlSeconds: 600 }
  });

  const result = await verifyChallenge({
    challengeToken: "tok123",
    requestOrigin: "http://localhost:3000",
    apiOrigin: "https://api.test.com",
    apiKey: "key-abc",
  });

  assert.deepEqual(result, { ok: true, sessionTtlSeconds: 600 });
});

test("401 response returns { ok: false, error: ..., statusCode: 401 }", async () => {
  globalThis.fetch = makeFetch(401, { error: "unauthorized" });

  const result = await verifyChallenge({
    challengeToken: "tok123",
    requestOrigin: "http://localhost:3000",
    apiOrigin: "https://api.test.com",
    apiKey: "key-abc",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 401);
    assert.equal(result.error, "unauthorized");
  }
});

test("403 response returns { ok: false, error: ..., statusCode: 403 }", async () => {
  globalThis.fetch = makeFetch(403, { error: "forbidden" });

  const result = await verifyChallenge({
    challengeToken: "tok123",
    requestOrigin: "http://localhost:3000",
    apiOrigin: "https://api.test.com",
    apiKey: "key-abc",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 403);
    assert.equal(result.error, "forbidden");
  }
});

test("network error returns { ok: false, error: '...' }", async () => {
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };

  const result = await verifyChallenge({
    challengeToken: "tok123",
    requestOrigin: "http://localhost:3000",
    apiOrigin: "https://api.test.com",
    apiKey: "key-abc",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "ECONNREFUSED");
    assert.equal(result.statusCode, 502);
  }
});

test("verify sends correct Authorization and Content-Type headers", async () => {
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true, sessionTtlSeconds: 600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  await verifyChallenge({
    challengeToken: "tok123",
    requestOrigin: "http://localhost:3000",
    apiOrigin: "https://api.test.com",
    apiKey: "my-secret-key",
  });

  assert.ok(capturedInit, "fetch should have been called");
  const headers = new Headers(capturedInit!.headers as HeadersInit);
  assert.equal(headers.get("Authorization"), "Bearer my-secret-key");
  assert.equal(headers.get("Content-Type"), "application/json");
});

test("verify sends correct body with challengeToken, requestOrigin, and userAgent", async () => {
  let capturedBody: string | undefined;

  globalThis.fetch = async (_url, init) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ ok: true, sessionTtlSeconds: 600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  await verifyChallenge({
    challengeToken: "challenge-abc",
    requestOrigin: "http://localhost:4000",
    userAgent: "Mozilla/5.0 Test",
    apiOrigin: "https://api.test.com",
    apiKey: "key-xyz",
  });

  assert.ok(capturedBody, "fetch body should have been captured");
  const parsed = JSON.parse(capturedBody!) as Record<string, string>;
  assert.equal(parsed.challengeToken, "challenge-abc");
  assert.equal(parsed.requestOrigin, "http://localhost:4000");
  assert.equal(parsed.userAgent, "Mozilla/5.0 Test");
});

test("verify omits userAgent from body when not provided", async () => {
  let capturedBody: string | undefined;

  globalThis.fetch = async (_url, init) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ ok: true, sessionTtlSeconds: 600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  await verifyChallenge({
    challengeToken: "challenge-xyz",
    requestOrigin: "http://localhost:3000",
    apiOrigin: "https://api.test.com",
    apiKey: "key-abc",
  });

  assert.ok(capturedBody, "fetch body should have been captured");
  const parsed = JSON.parse(capturedBody!) as Record<string, unknown>;
  assert.equal("userAgent" in parsed, false, "userAgent should not be present when not provided");
});

test("verify sends request to the correct URL", async () => {
  let capturedUrl: string | undefined;

  globalThis.fetch = async (url, _init) => {
    capturedUrl = url as string;
    return new Response(JSON.stringify({ ok: true, sessionTtlSeconds: 600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  await verifyChallenge({
    challengeToken: "tok",
    requestOrigin: "http://localhost:3000",
    apiOrigin: "https://api.test.com",
    apiKey: "key",
  });

  assert.equal(capturedUrl, VERIFY_URL);
});

test("unexpected response format on 200 returns { ok: false, error: 'unexpected response format' }", async () => {
  globalThis.fetch = makeFetch(200, { ok: false });

  const result = await verifyChallenge({
    challengeToken: "tok",
    requestOrigin: "http://localhost:3000",
    apiOrigin: "https://api.test.com",
    apiKey: "key",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "unexpected response format");
  }
});
