import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  AnthropicAuthError,
  AnthropicMalformedResponseError,
  AnthropicNetworkError,
  AnthropicRateLimitedError,
  fetchAnthropicCostReport,
} from "../src/main/anthropic-admin-client.js";

type FetchStub = (input: URL | string, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;
let lastRequests: { url: string; headers: Record<string, string> }[] = [];

function installFetch(stub: FetchStub): void {
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

describe("anthropic-admin-client.fetchAnthropicCostReport", () => {
  test("parses realistic cost-report response into MicroCents rows", async () => {
    installFetch(async () =>
      jsonResponse({
        data: [
          {
            starting_at: "2025-08-01T00:00:00Z",
            ending_at: "2025-08-02T00:00:00Z",
            results: [
              {
                amount: "123.45",
                context_window: "0-200k",
                cost_type: "tokens",
                currency: "USD",
                description: "Claude Sonnet 4 Usage - Input Tokens",
                inference_geo: "global",
                model: "claude-sonnet-4-5",
                service_tier: "standard",
                token_type: "uncached_input_tokens",
                workspace_id: null,
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    );

    const rows = await fetchAnthropicCostReport("sk-ant-admin-test", {
      startingAt: "2025-08-01T00:00:00Z",
      endingAt: "2025-08-02T00:00:00Z",
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].day, "2025-08-01");
    assert.equal(rows[0].model, "claude-sonnet-4-5");
    // "123.45" cents → 1_234_500 microcents
    assert.equal(rows[0].costMicroCents, 1_234_500);
    assert.equal(rows[0].descriptionGroup, "Claude Sonnet 4 Usage - Input Tokens");
    assert.equal(rows[0].costType, "tokens");
    assert.equal(rows[0].serviceTier, "standard");
    assert.equal(rows[0].tokenType, "uncached_input_tokens");
  });

  test("enforces host allowlist (URL.host check)", async () => {
    // The buildCostReportUrl runs assert at URL construction time. We don't
    // mutate the constant, but we can prove the URL we hit is api.anthropic.com.
    installFetch(async () => jsonResponse({ data: [], has_more: false, next_page: null }));
    await fetchAnthropicCostReport("sk-ant-admin-test", {
      startingAt: "2025-08-01T00:00:00Z",
      endingAt: "2025-08-02T00:00:00Z",
    });
    assert.ok(lastRequests.length > 0);
    const url = new URL(lastRequests[0].url);
    assert.equal(url.host, "api.anthropic.com");
    assert.equal(url.pathname, "/v1/organizations/cost_report");
  });

  test("sends x-api-key + anthropic-version headers", async () => {
    installFetch(async () => jsonResponse({ data: [], has_more: false, next_page: null }));
    await fetchAnthropicCostReport("sk-ant-admin-secret", {
      startingAt: "2025-08-01T00:00:00Z",
      endingAt: "2025-08-02T00:00:00Z",
    });
    assert.equal(lastRequests[0].headers["x-api-key"], "sk-ant-admin-secret");
    assert.equal(lastRequests[0].headers["anthropic-version"], "2023-06-01");
  });

  test("throws AnthropicAuthError on 401", async () => {
    installFetch(async () =>
      new Response("nope", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    await assert.rejects(
      () =>
        fetchAnthropicCostReport("bad-key", {
          startingAt: "2025-08-01T00:00:00Z",
          endingAt: "2025-08-02T00:00:00Z",
        }),
      AnthropicAuthError,
    );
  });

  test("throws AnthropicAuthError on 403", async () => {
    installFetch(async () =>
      new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } }),
    );
    await assert.rejects(
      () =>
        fetchAnthropicCostReport("bad-key", {
          startingAt: "2025-08-01T00:00:00Z",
          endingAt: "2025-08-02T00:00:00Z",
        }),
      AnthropicAuthError,
    );
  });

  test("throws AnthropicRateLimitedError after retries on 429", async () => {
    let calls = 0;
    installFetch(async () => {
      calls += 1;
      return new Response("rate-limited", {
        status: 429,
        headers: { "retry-after": "0", "content-type": "text/plain" },
      });
    });
    await assert.rejects(
      () =>
        fetchAnthropicCostReport("sk-ant-admin-test", {
          startingAt: "2025-08-01T00:00:00Z",
          endingAt: "2025-08-02T00:00:00Z",
        }),
      AnthropicRateLimitedError,
    );
    assert.equal(calls, 3, "should retry up to MAX_RETRIES times");
  });

  test("throws AnthropicNetworkError on fetch rejection", async () => {
    installFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      () =>
        fetchAnthropicCostReport("sk-ant-admin-test", {
          startingAt: "2025-08-01T00:00:00Z",
          endingAt: "2025-08-02T00:00:00Z",
        }),
      AnthropicNetworkError,
    );
  });

  test("throws AnthropicMalformedResponseError on bad JSON", async () => {
    installFetch(async () =>
      new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await assert.rejects(
      () =>
        fetchAnthropicCostReport("sk-ant-admin-test", {
          startingAt: "2025-08-01T00:00:00Z",
          endingAt: "2025-08-02T00:00:00Z",
        }),
      AnthropicMalformedResponseError,
    );
  });

  test("Admin Key never appears in thrown error messages", async () => {
    const adminKey = "sk-ant-admin-secret-12345";
    installFetch(async () =>
      new Response("denied", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    let caught: Error | null = null;
    try {
      await fetchAnthropicCostReport(adminKey, {
        startingAt: "2025-08-01T00:00:00Z",
        endingAt: "2025-08-02T00:00:00Z",
      });
    } catch (err) {
      caught = err as Error;
    }
    assert.ok(caught, "expected an error");
    assert.ok(
      !(caught.message || "").includes(adminKey),
      `error message must not contain the admin key (got: ${caught.message})`,
    );
    assert.ok(
      !(caught.stack || "").includes(adminKey),
      "error stack must not contain the admin key",
    );
  });

  test("follows next_page pagination", async () => {
    let call = 0;
    installFetch(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          data: [
            {
              starting_at: "2025-08-01T00:00:00Z",
              ending_at: "2025-08-02T00:00:00Z",
              results: [
                {
                  amount: "10",
                  currency: "USD",
                  description: "A",
                  model: "claude-x",
                  cost_type: "tokens",
                  service_tier: "standard",
                  token_type: "uncached_input_tokens",
                },
              ],
            },
          ],
          has_more: true,
          next_page: "page-2",
        });
      }
      return jsonResponse({
        data: [
          {
            starting_at: "2025-08-02T00:00:00Z",
            ending_at: "2025-08-03T00:00:00Z",
            results: [
              {
                amount: "20",
                currency: "USD",
                description: "B",
                model: "claude-x",
                cost_type: "tokens",
                service_tier: "standard",
                token_type: "uncached_input_tokens",
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      });
    });

    const rows = await fetchAnthropicCostReport("sk-ant-admin-test", {
      startingAt: "2025-08-01T00:00:00Z",
      endingAt: "2025-08-03T00:00:00Z",
    });
    assert.equal(rows.length, 2);
    assert.equal(call, 2);
    // Second call should include `page=page-2`
    assert.ok(lastRequests[1].url.includes("page=page-2"));
  });
});
