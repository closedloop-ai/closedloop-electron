/**
 * FEA-1433: tests for the Settings → Pricing IPC bridge.
 *
 * Covers:
 *   1. Sidecar unreachable ⇒ both handlers degrade gracefully (null /
 *      { ok: false, error }) rather than throwing.
 *   2. listUnpricedModels ⇒ proxies GET /api/pricing/diagnostics/unpriced-models
 *      with the requested limit query param.
 *   3. addPricingRule ⇒ Zod-rejects malformed payloads BEFORE touching the
 *      network, accepts well-formed payloads, surfaces sidecar HTTP errors.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addPricingRule,
  fetchUnpricedModels,
  type AgentMonitorRef,
} from "../src/main/cost-pricing-client.js";

function stubMonitor(url: string | null): AgentMonitorRef {
  return { getUrl: () => url };
}

type FetchCall = {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
};

function recordingFetch(
  response: { ok: boolean; status?: number; bodyJson?: unknown },
): { calls: FetchCall[]; fn: typeof fetch } {
  const calls: FetchCall[] = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({
      url: typeof input === "string" ? input : input.toString(),
      init: init as FetchCall["init"],
    });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.bodyJson,
    } as Response;
  };
  return { calls, fn };
}

test("FEA-1433: fetchUnpricedModels returns null when sidecar URL is missing", async () => {
  const result = await fetchUnpricedModels(stubMonitor(null));
  assert.equal(result, null);
});

test("FEA-1433: fetchUnpricedModels proxies the GET with limit + parses body", async () => {
  const body = {
    unpriced_models: [
      {
        model: "custom-vendor-x",
        input_tokens: 1234,
        output_tokens: 567,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
    ],
  };
  const { calls, fn } = recordingFetch({ ok: true, bodyJson: body });
  const result = await fetchUnpricedModels(
    stubMonitor("http://127.0.0.1:4820"),
    25,
    fn,
  );
  assert.deepEqual(result, body);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0]!.url,
    /\/api\/pricing\/diagnostics\/unpriced-models\?limit=25$/,
  );
});

test("FEA-1433: fetchUnpricedModels returns null on non-2xx", async () => {
  const { fn } = recordingFetch({ ok: false, status: 500 });
  const result = await fetchUnpricedModels(
    stubMonitor("http://127.0.0.1:4820"),
    20,
    fn,
  );
  assert.equal(result, null);
});

test("FEA-1433: addPricingRule rejects malformed payloads before fetch", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    return { ok: true, json: async () => ({}) } as Response;
  };
  const result = await addPricingRule(
    stubMonitor("http://127.0.0.1:4820"),
    { model_pattern: "", display_name: "x" },
    fakeFetch,
  );
  assert.equal(result.ok, false);
  assert.ok(result.error && result.error.includes("model_pattern"));
  assert.equal(called, false, "validation must short-circuit before network IO");
});

test("FEA-1433: addPricingRule reports sidecar unavailability", async () => {
  const result = await addPricingRule(stubMonitor(null), {
    model_pattern: "x%",
    display_name: "X",
    input_per_mtok: 1,
    output_per_mtok: 2,
    cache_read_per_mtok: 0,
    cache_write_per_mtok: 0,
    cache_write_1h_per_mtok: 0,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error && result.error.toLowerCase().includes("sidecar"));
});

test("FEA-1433: addPricingRule round-trips a well-formed payload to PUT /api/pricing", async () => {
  const { calls, fn } = recordingFetch({ ok: true, bodyJson: { pricing: {} } });
  const result = await addPricingRule(
    stubMonitor("http://127.0.0.1:4820"),
    {
      model_pattern: "custom-vendor-x%",
      display_name: "Custom Vendor X",
      input_per_mtok: 3,
      output_per_mtok: 15,
      cache_read_per_mtok: 0.3,
      cache_write_per_mtok: 3.75,
      cache_write_1h_per_mtok: 6,
    },
    fn,
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.match(call.url, /\/api\/pricing$/);
  assert.equal(call.init?.method, "PUT");
  assert.equal(call.init?.headers?.["Content-Type"], "application/json");
  const parsed = JSON.parse(call.init?.body ?? "{}") as Record<string, unknown>;
  // Defaults must be applied for fields the form omits — every numeric rate
  // is required by the sidecar upsert anchor.
  assert.equal(parsed.model_pattern, "custom-vendor-x%");
  assert.equal(parsed.input_per_mtok, 3);
  assert.equal(parsed.cache_write_1h_per_mtok, 6);
});

test("FEA-1433: addPricingRule surfaces sidecar HTTP failures", async () => {
  const { fn } = recordingFetch({
    ok: false,
    status: 400,
    bodyJson: { error: { message: "model_pattern is required" } },
  });
  const result = await addPricingRule(
    stubMonitor("http://127.0.0.1:4820"),
    {
      model_pattern: "y%",
      display_name: "Y",
      input_per_mtok: 0,
      output_per_mtok: 0,
      cache_read_per_mtok: 0,
      cache_write_per_mtok: 0,
      cache_write_1h_per_mtok: 0,
    },
    fn,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "model_pattern is required");
});
