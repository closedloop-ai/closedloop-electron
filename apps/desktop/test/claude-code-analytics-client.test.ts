import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  ClaudeCodeAnalyticsAuthError,
  ClaudeCodeAnalyticsMalformedResponseError,
  ClaudeCodeAnalyticsNetworkError,
  ClaudeCodeAnalyticsRateLimitedError,
  ClaudeCodeAnalyticsUnsupportedError,
  fetchClaudeCodeAnalytics,
} from "../src/main/claude-code-analytics-client.js";

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

describe("claude-code-analytics-client.fetchClaudeCodeAnalytics", () => {
  test("parses realistic per-user response shape into normalized rows", async () => {
    installFetch(async () =>
      jsonResponse({
        data: [
          {
            date: "2025-09-08T00:00:00Z",
            actor: {
              type: "user_actor",
              email_address: "developer@company.com",
            },
            organization_id: "dc9f6c26-b22c-4831-8d01-0446bada88f1",
            customer_type: "api",
            terminal_type: "vscode",
            core_metrics: {
              num_sessions: 5,
              lines_of_code: { added: 1543, removed: 892 },
              commits_by_claude_code: 12,
              pull_requests_by_claude_code: 2,
            },
            tool_actions: {
              edit_tool: { accepted: 45, rejected: 5 },
            },
            model_breakdown: [
              {
                model: "claude-opus-4-8",
                tokens: {
                  input: 100000,
                  output: 35000,
                  cache_read: 10000,
                  cache_creation: 5000,
                },
                // 1025 cents = $10.25
                estimated_cost: { currency: "USD", amount: 1025 },
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    );

    const result = await fetchClaudeCodeAnalytics("sk-ant-admin-test", {
      startingAt: "2025-09-08T00:00:00Z",
      endingAt: "2025-09-09T00:00:00Z",
    });

    assert.equal(result.totalCount, 1);
    assert.equal(result.users.length, 1);
    const row = result.users[0];
    assert.equal(row.day, "2025-09-08");
    assert.equal(row.userId, "email:developer@company.com");
    assert.equal(row.sessions, 5);
    // 100000 + 35000 + 10000 + 5000 = 150000
    assert.equal(row.tokens, 150000);
    assert.equal(row.estimatedCostUsd, 10.25);
    assert.equal(row.productivity?.linesAdded, 1543);
    assert.equal(row.productivity?.linesRemoved, 892);
    assert.equal(row.productivity?.commits, 12);
    assert.equal(row.productivity?.pullRequests, 2);
  });

  test("synthesizes api_actor user id when actor type is api_actor", async () => {
    installFetch(async () =>
      jsonResponse({
        data: [
          {
            date: "2025-09-08T00:00:00Z",
            actor: { type: "api_actor", api_key_name: "ci-bot-1" },
            customer_type: "api",
            core_metrics: { num_sessions: 1, lines_of_code: {} },
            model_breakdown: [],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    );
    const result = await fetchClaudeCodeAnalytics("sk-ant-admin-test", {
      startingAt: "2025-09-08T00:00:00Z",
      endingAt: "2025-09-09T00:00:00Z",
    });
    assert.equal(result.users[0].userId, "api_key:ci-bot-1");
  });

  test("enforces host allowlist (URL.host check)", async () => {
    installFetch(async () =>
      jsonResponse({ data: [], has_more: false, next_page: null }),
    );
    await fetchClaudeCodeAnalytics("sk-ant-admin-test", {
      startingAt: "2025-09-08T00:00:00Z",
      endingAt: "2025-09-09T00:00:00Z",
    });
    assert.ok(lastRequests.length > 0);
    const url = new URL(lastRequests[0].url);
    assert.equal(url.host, "api.anthropic.com");
    assert.equal(
      url.pathname,
      "/v1/organizations/usage_report/claude_code",
    );
  });

  test("sends x-api-key + anthropic-version headers", async () => {
    installFetch(async () =>
      jsonResponse({ data: [], has_more: false, next_page: null }),
    );
    await fetchClaudeCodeAnalytics("sk-ant-admin-secret", {
      startingAt: "2025-09-08T00:00:00Z",
      endingAt: "2025-09-09T00:00:00Z",
    });
    assert.equal(lastRequests[0].headers["x-api-key"], "sk-ant-admin-secret");
    assert.equal(lastRequests[0].headers["anthropic-version"], "2023-06-01");
  });

  test("throws ClaudeCodeAnalyticsAuthError on 401", async () => {
    installFetch(async () =>
      new Response("nope", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    await assert.rejects(
      () =>
        fetchClaudeCodeAnalytics("bad-key", {
          startingAt: "2025-09-08T00:00:00Z",
          endingAt: "2025-09-09T00:00:00Z",
        }),
      ClaudeCodeAnalyticsAuthError,
    );
  });

  test("throws ClaudeCodeAnalyticsUnsupportedError(403) on 403 plan-tier mismatch", async () => {
    installFetch(async () =>
      new Response("forbidden", { status: 403 }),
    );
    await assert.rejects(
      () =>
        fetchClaudeCodeAnalytics("sk-ant-admin-test", {
          startingAt: "2025-09-08T00:00:00Z",
          endingAt: "2025-09-09T00:00:00Z",
        }),
      (err: unknown) =>
        err instanceof ClaudeCodeAnalyticsUnsupportedError && err.status === 403,
    );
  });

  test("throws ClaudeCodeAnalyticsUnsupportedError(404) on Solo/Pro tier", async () => {
    installFetch(async () =>
      new Response("not found", { status: 404 }),
    );
    await assert.rejects(
      () =>
        fetchClaudeCodeAnalytics("sk-ant-admin-test", {
          startingAt: "2025-09-08T00:00:00Z",
          endingAt: "2025-09-09T00:00:00Z",
        }),
      (err: unknown) =>
        err instanceof ClaudeCodeAnalyticsUnsupportedError && err.status === 404,
    );
  });

  test("throws ClaudeCodeAnalyticsRateLimitedError after retries on 429", async () => {
    let calls = 0;
    installFetch(async () => {
      calls += 1;
      return new Response("rate-limited", {
        status: 429,
        headers: { "retry-after": "0" },
      });
    });
    await assert.rejects(
      () =>
        fetchClaudeCodeAnalytics("sk-ant-admin-test", {
          startingAt: "2025-09-08T00:00:00Z",
          endingAt: "2025-09-09T00:00:00Z",
        }),
      ClaudeCodeAnalyticsRateLimitedError,
    );
    assert.equal(calls, 3, "should retry up to MAX_RETRIES times");
  });

  test("throws ClaudeCodeAnalyticsNetworkError on fetch rejection", async () => {
    installFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      () =>
        fetchClaudeCodeAnalytics("sk-ant-admin-test", {
          startingAt: "2025-09-08T00:00:00Z",
          endingAt: "2025-09-09T00:00:00Z",
        }),
      ClaudeCodeAnalyticsNetworkError,
    );
  });

  test("throws ClaudeCodeAnalyticsMalformedResponseError on bad JSON", async () => {
    installFetch(async () =>
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await assert.rejects(
      () =>
        fetchClaudeCodeAnalytics("sk-ant-admin-test", {
          startingAt: "2025-09-08T00:00:00Z",
          endingAt: "2025-09-09T00:00:00Z",
        }),
      ClaudeCodeAnalyticsMalformedResponseError,
    );
  });

  test("Admin Key NEVER appears in thrown error messages", async () => {
    const adminKey = "sk-ant-admin-very-secret-12345";
    installFetch(async () =>
      new Response("denied", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    let caught: Error | null = null;
    try {
      await fetchClaudeCodeAnalytics(adminKey, {
        startingAt: "2025-09-08T00:00:00Z",
        endingAt: "2025-09-09T00:00:00Z",
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
    // Same check for 403, 404, 429, network, malformed paths.
    for (const initStatus of [403, 404]) {
      installFetch(async () =>
        new Response("nope", {
          status: initStatus,
          headers: { "content-type": "text/plain" },
        }),
      );
      try {
        await fetchClaudeCodeAnalytics(adminKey, {
          startingAt: "2025-09-08T00:00:00Z",
          endingAt: "2025-09-09T00:00:00Z",
        });
      } catch (err) {
        const e = err as Error;
        assert.ok(
          !(e.message || "").includes(adminKey),
          `error message (status=${initStatus}) must not contain the admin key`,
        );
      }
    }
  });

  test("follows next_page pagination within a single day", async () => {
    let call = 0;
    installFetch(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          data: [
            {
              date: "2025-09-08T00:00:00Z",
              actor: { type: "user_actor", email_address: "a@x.com" },
              customer_type: "api",
              core_metrics: { num_sessions: 1, lines_of_code: {} },
              model_breakdown: [],
            },
          ],
          has_more: true,
          next_page: "page-2",
        });
      }
      return jsonResponse({
        data: [
          {
            date: "2025-09-08T00:00:00Z",
            actor: { type: "user_actor", email_address: "b@x.com" },
            customer_type: "api",
            core_metrics: { num_sessions: 2, lines_of_code: {} },
            model_breakdown: [],
          },
        ],
        has_more: false,
        next_page: null,
      });
    });

    const result = await fetchClaudeCodeAnalytics("sk-ant-admin-test", {
      startingAt: "2025-09-08T00:00:00Z",
      endingAt: "2025-09-09T00:00:00Z",
    });
    assert.equal(result.users.length, 2);
    assert.equal(call, 2);
    assert.ok(lastRequests[1].url.includes("page=page-2"));
  });

  test("treats has_more=true without next_page as malformed (no silent truncation)", async () => {
    installFetch(async () =>
      jsonResponse({
        data: [],
        has_more: true,
        next_page: null,
      }),
    );
    await assert.rejects(
      () =>
        fetchClaudeCodeAnalytics("sk-ant-admin-test", {
          startingAt: "2025-09-08T00:00:00Z",
          endingAt: "2025-09-09T00:00:00Z",
        }),
      ClaudeCodeAnalyticsMalformedResponseError,
    );
  });

  test("iterates day-by-day across a multi-day window", async () => {
    const seenStartingAt: string[] = [];
    installFetch(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      seenStartingAt.push(url.searchParams.get("starting_at") ?? "");
      return jsonResponse({ data: [], has_more: false, next_page: null });
    });
    await fetchClaudeCodeAnalytics("sk-ant-admin-test", {
      startingAt: "2025-09-08T00:00:00Z",
      endingAt: "2025-09-11T00:00:00Z",
    });
    assert.deepEqual(seenStartingAt, [
      "2025-09-08",
      "2025-09-09",
      "2025-09-10",
    ]);
  });
});
