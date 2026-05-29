import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  fetchOpenAICosts,
  OpenAIAuthError,
  OpenAIMalformedResponseError,
  OpenAINetworkError,
  OpenAIRateLimitedError,
  OpenAIRedirectError,
} from "../src/main/openai-admin-client.js";

const originalFetch = globalThis.fetch;
let lastRequests: { url: string; headers: Record<string, string> }[] = [];

function installFetch(stub: (input: URL | string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = ((input, init) => {
    const urlStr = typeof input === "string" ? input : input.toString();
    const headerRecord: Record<string, string> = {};
    if (init?.headers) {
      const headers = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(headers)) {
        headerRecord[k.toLowerCase()] = String(v);
      }
    }
    lastRequests.push({ url: urlStr, headers: headerRecord });
    return stub(input, init);
  }) as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  lastRequests = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("openai-admin-client.fetchOpenAICosts", () => {
  test("parses realistic costs response with amount.value dollars", async () => {
    installFetch(async () =>
      jsonResponse({
        object: "page",
        data: [
          {
            object: "bucket",
            start_time: 1_756_080_000, // 2025-08-25T00:00:00Z
            end_time: 1_756_166_400,
            results: [
              {
                object: "organization.costs.result",
                amount: { value: 1.2345, currency: "usd" },
                line_item: "gpt-4.1-2025-04-14",
                project_id: null,
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    );
    const rows = await fetchOpenAICosts("sk-admin-test", {
      startTime: 1_756_080_000,
      endTime: 1_756_166_400,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].day, "2025-08-25");
    assert.equal(rows[0].model, "gpt-4.1-2025-04-14");
    // 1.2345 dollars → 1_234_500 microcents
    assert.equal(rows[0].costMicroCents, 1_234_500);
    assert.equal(rows[0].lineItem, "gpt-4.1-2025-04-14");
  });

  test("enforces host allowlist (URL.host check)", async () => {
    installFetch(async () =>
      jsonResponse({ data: [], has_more: false, next_page: null }),
    );
    await fetchOpenAICosts("sk-admin-test", { startTime: 0, endTime: 86_400 });
    assert.ok(lastRequests.length > 0);
    const url = new URL(lastRequests[0].url);
    assert.equal(url.host, "api.openai.com");
    assert.equal(url.pathname, "/v1/organization/costs");
  });

  test("sends Authorization: Bearer header", async () => {
    installFetch(async () =>
      jsonResponse({ data: [], has_more: false, next_page: null }),
    );
    await fetchOpenAICosts("sk-admin-secret", { startTime: 0, endTime: 86_400 });
    assert.equal(lastRequests[0].headers["authorization"], "Bearer sk-admin-secret");
  });

  test("throws OpenAIAuthError on 401", async () => {
    installFetch(async () =>
      new Response("nope", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    await assert.rejects(
      () => fetchOpenAICosts("bad", { startTime: 0, endTime: 86_400 }),
      OpenAIAuthError,
    );
  });

  test("throws OpenAIRateLimitedError after retries on 429", async () => {
    let calls = 0;
    installFetch(async () => {
      calls += 1;
      return new Response("rate-limited", {
        status: 429,
        headers: { "retry-after": "0" },
      });
    });
    await assert.rejects(
      () => fetchOpenAICosts("sk-admin-test", { startTime: 0, endTime: 86_400 }),
      OpenAIRateLimitedError,
    );
    assert.equal(calls, 3);
  });

  test("throws OpenAINetworkError on fetch rejection", async () => {
    installFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      () => fetchOpenAICosts("sk-admin-test", { startTime: 0, endTime: 86_400 }),
      OpenAINetworkError,
    );
  });

  test("throws OpenAIMalformedResponseError on bad JSON", async () => {
    installFetch(async () =>
      new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await assert.rejects(
      () => fetchOpenAICosts("sk-admin-test", { startTime: 0, endTime: 86_400 }),
      OpenAIMalformedResponseError,
    );
  });

  test("Admin Key never appears in thrown error messages", async () => {
    const adminKey = "sk-admin-secret-xyz";
    installFetch(async () =>
      new Response("denied", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    let caught: Error | null = null;
    try {
      await fetchOpenAICosts(adminKey, { startTime: 0, endTime: 86_400 });
    } catch (err) {
      caught = err as Error;
    }
    assert.ok(caught, "expected an error");
    assert.ok(!(caught.message || "").includes(adminKey));
    assert.ok(!(caught.stack || "").includes(adminKey));
  });

  test("H1: passes redirect:'error' so 3xx never forwards Admin Key to a redirect target", async () => {
    const adminKey = "sk-admin-redirect-test";
    let redirectInit: RequestInit | undefined;
    installFetch(async (_input, init) => {
      redirectInit = init;
      throw new TypeError("fetch failed: unexpected redirect");
    });
    let caught: Error | null = null;
    try {
      await fetchOpenAICosts(adminKey, { startTime: 0, endTime: 86_400 });
    } catch (err) {
      caught = err as Error;
    }
    assert.ok(caught instanceof OpenAIRedirectError, "expected OpenAIRedirectError");
    assert.ok(!(caught!.message || "").includes(adminKey), "redirect error must not leak Admin Key in message");
    assert.ok(!(caught!.stack || "").includes(adminKey), "redirect error must not leak Admin Key in stack");
    assert.equal(
      (redirectInit as RequestInit & { redirect?: string })?.redirect,
      "error",
      "fetch must be called with redirect:'error'",
    );
  });

  test("M5: throws on missing currency field", async () => {
    installFetch(async () =>
      jsonResponse({
        object: "page",
        data: [
          {
            object: "bucket",
            start_time: 1_756_080_000,
            end_time: 1_756_166_400,
            results: [
              {
                object: "organization.costs.result",
                // currency missing entirely
                amount: { value: 1.0 },
                line_item: "gpt-4.1",
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    );
    await assert.rejects(
      () => fetchOpenAICosts("sk-admin-test", { startTime: 0, endTime: 86_400 }),
      OpenAIMalformedResponseError,
    );
  });

  test("M5: throws on non-USD currency to prevent silent 1:1 GBP/EUR treatment", async () => {
    installFetch(async () =>
      jsonResponse({
        object: "page",
        data: [
          {
            object: "bucket",
            start_time: 1_756_080_000,
            end_time: 1_756_166_400,
            results: [
              {
                object: "organization.costs.result",
                amount: { value: 1.0, currency: "gbp" },
                line_item: "gpt-4.1",
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    );
    await assert.rejects(
      () => fetchOpenAICosts("sk-admin-test", { startTime: 0, endTime: 86_400 }),
      OpenAIMalformedResponseError,
    );
  });

  test("M5: accepts currency='usd' (lowercase) as the documented contract", async () => {
    installFetch(async () =>
      jsonResponse({
        object: "page",
        data: [
          {
            object: "bucket",
            start_time: 1_756_080_000,
            end_time: 1_756_166_400,
            results: [
              {
                object: "organization.costs.result",
                amount: { value: 1.0, currency: "usd" },
                line_item: "gpt-4.1",
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    );
    const rows = await fetchOpenAICosts("sk-admin-test", { startTime: 0, endTime: 86_400 });
    assert.equal(rows.length, 1);
  });
});
