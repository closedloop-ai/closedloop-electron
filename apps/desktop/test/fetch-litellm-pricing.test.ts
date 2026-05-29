/**
 * Tests for apps/desktop/scripts/fetch-litellm-pricing.mjs.
 *
 * Exercises the pure helpers (deriveDisplayName, transformPricingMap) plus
 * the file-writing pipeline (runFetchAndWrite) by stubbing global.fetch with
 * a small synthetic LiteLLM payload. No network access during the test.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const scriptUrl = new URL(
  "../scripts/fetch-litellm-pricing.mjs",
  import.meta.url,
).href;

type ScriptModule = {
  deriveDisplayName: (key: string) => string;
  transformPricingMap: (
    map: Record<string, unknown>,
  ) => Array<[string, string, number, number, number, number, number]>;
  fetchLiteLLMPricing: (
    url?: string,
  ) => Promise<{ rawText: string; sha: string; parsed: Record<string, unknown> }>;
  runFetchAndWrite: (opts: {
    outDir: string;
    sourceUrl?: string;
  }) => Promise<{ jsonPath: string; metaPath: string; sha: string; rowCount: number }>;
  runVerify: (opts: {
    outDir: string;
    sourceUrl?: string;
  }) => Promise<{ sha: string }>;
};

async function loadScript(): Promise<ScriptModule> {
  return (await import(scriptUrl)) as ScriptModule;
}

/**
 * Build a synthetic LiteLLM payload large enough (≥ 100 entries) to satisfy
 * fetchLiteLLMPricing's sanity check, but with a handful of curated entries
 * we can assert on by name.
 */
function buildSyntheticLiteLLMJson(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sample_spec: { litellm_provider: "openai" }, // must be filtered out
    // Sentinel rows required by the build-time vendoring check.
    "claude-3-opus-20240229": {
      input_cost_per_token: 1.5e-5,
      output_cost_per_token: 7.5e-5,
    },
    "claude-opus-4-1": {
      input_cost_per_token: 1.5e-5,
      output_cost_per_token: 7.5e-5,
    },
    "claude-opus-4-7": {
      input_cost_per_token: 1.5e-5,
      output_cost_per_token: 7.5e-5,
      cache_read_input_token_cost: 1.5e-6,
      cache_creation_input_token_cost: 1.875e-5,
    },
    "gpt-5-codex": {
      input_cost_per_token: 1.25e-6,
      output_cost_per_token: 1e-5,
      cache_read_input_token_cost: 1.25e-7,
      cache_creation_input_token_cost: 1.25e-6,
    },
    "gemini-2.5-pro": {
      input_cost_per_token: 1.25e-6,
      output_cost_per_token: 5e-6,
    },
    "mistral-large": {
      // Filtered out by vendor prefix.
      input_cost_per_token: 8e-6,
      output_cost_per_token: 2.4e-5,
    },
    "anthropic.claude-also-not-in-prefix-list": {
      input_cost_per_token: 1e-6,
      output_cost_per_token: 5e-6,
    },
  };
  // Pad with placeholder Claude rows to clear the 100-entry threshold and the
  // 20-supported-row floor.
  for (let i = 0; i < 100; i++) {
    out[`claude-pad-${i}`] = {
      input_cost_per_token: 1e-6,
      output_cost_per_token: 5e-6,
    };
  }
  return out;
}

test("deriveDisplayName handles the documented cases", async () => {
  const { deriveDisplayName } = await loadScript();
  assert.equal(deriveDisplayName("claude-opus-4-7"), "Claude Opus 4.7");
  assert.equal(deriveDisplayName("gpt-5-codex"), "GPT-5 Codex");
  assert.equal(deriveDisplayName("gpt-5-mini"), "GPT-5 Mini");
  assert.equal(deriveDisplayName("gpt-4o"), "GPT-4o");
  assert.equal(deriveDisplayName("o1-preview"), "o1-preview");
  assert.equal(deriveDisplayName("gemini-2.5-pro"), "Gemini 2.5 Pro");
  assert.equal(
    deriveDisplayName("claude-3-5-sonnet-20240620"),
    "Claude 3.5 Sonnet",
  );
});

test("deriveDisplayName tolerates pathological input", async () => {
  const { deriveDisplayName } = await loadScript();
  assert.equal(deriveDisplayName(""), "");
  // @ts-expect-error - intentional invalid input.
  assert.equal(deriveDisplayName(null), "");
});

test("transformPricingMap filters by vendor prefix and rounds to 6 decimals", async () => {
  const { transformPricingMap } = await loadScript();
  const rows = transformPricingMap(buildSyntheticLiteLLMJson());

  const patterns = rows.map((r) => r[0]);
  // Should contain our curated, supported keys
  assert.ok(patterns.includes("claude-opus-4-7%"));
  assert.ok(patterns.includes("gpt-5-codex%"));
  assert.ok(patterns.includes("gemini-2.5-pro%"));
  // Should NOT contain mistral / anthropic-prefixed / sample_spec rows
  assert.ok(!patterns.includes("mistral-large%"));
  assert.ok(!patterns.includes("anthropic.claude-also-not-in-prefix-list%"));
  assert.ok(!patterns.includes("sample_spec%"));

  // Sorted ascending by pattern
  const sorted = [...patterns].sort();
  assert.deepEqual(patterns, sorted);

  // Opus 4.7 input was 1.5e-5 $/tok → $15/Mtok
  const opus = rows.find((r) => r[0] === "claude-opus-4-7%");
  assert.ok(opus);
  assert.equal(opus!.length, 7, "FEA-1432: rows are now 7-tuples");
  assert.equal(opus![2], 15);
  assert.equal(opus![3], 75);
  assert.equal(opus![4], 1.5);
  assert.equal(opus![5], 18.75);
  // FEA-1432: cache_write_1h is derived as input × 2.0 for Anthropic rows.
  assert.equal(opus![6], 30);

  // Gemini row with no cache fields should default to 0.
  const gemini = rows.find((r) => r[0] === "gemini-2.5-pro%");
  assert.ok(gemini);
  assert.equal(gemini!.length, 7);
  assert.equal(gemini![4], 0);
  assert.equal(gemini![5], 0);
  // FEA-1432: Gemini has no Anthropic-style 1h cache tier.
  assert.equal(gemini![6], 0);
});

test("FEA-1432: Anthropic 1h cache writes are derived as input × 2.0", async () => {
  const { transformPricingMap } = await loadScript();
  const rows = transformPricingMap({
    "claude-opus-derive-test": {
      input_cost_per_token: 1.5e-5, // $15/Mtok
      output_cost_per_token: 7.5e-5,
      cache_read_input_token_cost: 1.5e-6,
      cache_creation_input_token_cost: 1.875e-5,
    },
    "claude-sonnet-derive-test": {
      input_cost_per_token: 3e-6, // $3/Mtok
      output_cost_per_token: 1.5e-5,
    },
    // Sentinel input=0 — derivation must NOT synthesize a phantom rate
    // (we'd be inventing pricing for a free model).
    "claude-free-test": {
      input_cost_per_token: 0,
      output_cost_per_token: 0,
    },
  });
  const opus = rows.find((r) => r[0] === "claude-opus-derive-test%");
  assert.ok(opus);
  // input × 2.0 = 30
  assert.equal(opus![6], 30);

  const sonnet = rows.find((r) => r[0] === "claude-sonnet-derive-test%");
  assert.ok(sonnet);
  assert.equal(sonnet![6], 6);

  const free = rows.find((r) => r[0] === "claude-free-test%");
  // input=0 rows are included (matches LiteLLM's record of a free model) but
  // derivation must NOT invent a cache_write_1h rate from a zero input.
  assert.ok(free, "free row should be present in transformed output");
  assert.equal(free![6], 0, "free row must have cache_write_1h = 0");
});

test("FEA-1432: OpenAI rows always carry cache_write = 0 and cache_write_1h = 0", async () => {
  const { transformPricingMap } = await loadScript();
  const rows = transformPricingMap({
    "gpt-canonical": {
      input_cost_per_token: 2.5e-6, // $2.5/Mtok
      output_cost_per_token: 1e-5,
      cache_read_input_token_cost: 1.25e-6, // 50% — canonical
      cache_creation_input_token_cost: 9.99e-6, // should be zeroed out
    },
    "gpt-bad-ratio": {
      input_cost_per_token: 1.25e-6, // $1.25/Mtok
      output_cost_per_token: 1e-5,
      cache_read_input_token_cost: 1.25e-7, // 10% — should clamp to 50%
      cache_creation_input_token_cost: 0,
    },
    "gpt-no-cache": {
      input_cost_per_token: 1.5e-4, // $150/Mtok (e.g. o1-pro)
      output_cost_per_token: 6e-4,
      cache_read_input_token_cost: 0, // signals "no caching available"
      cache_creation_input_token_cost: 0,
    },
    "o3-bad-ratio": {
      input_cost_per_token: 2e-6,
      output_cost_per_token: 8e-6,
      cache_read_input_token_cost: 5e-7, // 25% — clamp
      cache_creation_input_token_cost: 1.5e-6, // surcharge → must zero out
    },
  });

  const canonical = rows.find((r) => r[0] === "gpt-canonical%");
  assert.ok(canonical);
  assert.equal(canonical![4], 1.25, "canonical 50% cache_read preserved");
  assert.equal(canonical![5], 0, "OpenAI cache_write surcharge zeroed out");
  assert.equal(canonical![6], 0, "OpenAI cache_write_1h is 0");

  const badRatio = rows.find((r) => r[0] === "gpt-bad-ratio%");
  assert.ok(badRatio);
  // Clamped to input × 0.5 = 0.625
  assert.equal(badRatio![4], 0.625);
  assert.equal(badRatio![5], 0);
  assert.equal(badRatio![6], 0);

  const noCache = rows.find((r) => r[0] === "gpt-no-cache%");
  assert.ok(noCache);
  // Preserve 0 — vendor signals no caching, do not invent a rate.
  assert.equal(noCache![4], 0);
  assert.equal(noCache![5], 0);
  assert.equal(noCache![6], 0);

  const o3BadRatio = rows.find((r) => r[0] === "o3-bad-ratio%");
  assert.ok(o3BadRatio);
  assert.equal(o3BadRatio![4], 1); // input × 0.5
  assert.equal(o3BadRatio![5], 0);
  assert.equal(o3BadRatio![6], 0);
});

test("runFetchAndWrite writes pricing + meta with SHA-pinned bytes", async () => {
  const script = await loadScript();
  const payload = buildSyntheticLiteLLMJson();
  const rawBody = JSON.stringify(payload);
  const expectedSha = createHash("sha256").update(rawBody).digest("hex");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(rawBody, {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const tmp = mkdtempSync(path.join(tmpdir(), "litellm-pricing-test-"));
    const { jsonPath, metaPath, sha, rowCount } = await script.runFetchAndWrite({
      outDir: tmp,
      sourceUrl: "https://example.invalid/model_prices.json",
    });
    assert.equal(sha, expectedSha);
    assert.ok(rowCount >= 3);

    const writtenRows = JSON.parse(readFileSync(jsonPath, "utf8")) as Array<
      [string, string, number, number, number, number]
    >;
    assert.equal(writtenRows.length, rowCount);
    assert.ok(writtenRows.find((r) => r[0] === "claude-opus-4-7%"));

    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      source_url: string;
      source_sha: string;
      fetched_at: string;
      row_count: number;
    };
    assert.equal(meta.source_sha, expectedSha);
    assert.equal(meta.row_count, rowCount);
    assert.equal(
      meta.source_url,
      "https://example.invalid/model_prices.json",
    );
    // ISO-8601 timestamp must round-trip through Date.
    assert.ok(!Number.isNaN(Date.parse(meta.fetched_at)));
    assert.equal(
      new Date(meta.fetched_at).toISOString(),
      meta.fetched_at,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchLiteLLMPricing rejects tiny payloads", async () => {
  const script = await loadScript();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ "claude-foo": {} }), {
      status: 200,
    })) as typeof fetch;
  try {
    await assert.rejects(
      () => script.fetchLiteLLMPricing("https://example.invalid/tiny.json"),
      /only 1 entries/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchLiteLLMPricing rejects non-200 responses", async () => {
  const script = await loadScript();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("not found", { status: 404 })) as typeof fetch;
  try {
    await assert.rejects(
      () => script.fetchLiteLLMPricing("https://example.invalid/404.json"),
      /HTTP 404/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchLiteLLMPricing rejects unparseable JSON", async () => {
  const script = await loadScript();
  const originalFetch = globalThis.fetch;
  // The fetch validation calls JSON.parse which throws on truncated input.
  // Pad past the 100-entry threshold so the entry-count guard isn't the one
  // that fires.
  globalThis.fetch = (async () =>
    new Response("{not valid json", { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      () => script.fetchLiteLLMPricing("https://example.invalid/broken.json"),
      /unparseable JSON/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchLiteLLMPricing rejects non-object payloads", async () => {
  const script = await loadScript();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([1, 2, 3]), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      () => script.fetchLiteLLMPricing("https://example.invalid/array.json"),
      /non-object JSON/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runFetchAndWrite refuses to vendor when sentinel models are missing", async () => {
  const script = await loadScript();
  // Build a synthetic payload that passes the entry-count check but doesn't
  // include either sentinel.
  const payload: Record<string, unknown> = {};
  for (let i = 0; i < 120; i++) {
    payload[`claude-junk-${i}`] = {
      input_cost_per_token: 1e-6,
      output_cost_per_token: 5e-6,
    };
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
  try {
    const tmp = mkdtempSync(path.join(tmpdir(), "litellm-no-sentinel-"));
    await assert.rejects(
      () =>
        script.runFetchAndWrite({
          outDir: tmp,
          sourceUrl: "https://example.invalid/no-sentinel.json",
        }),
      /missing sentinel/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runVerify reports an SHA mismatch", async () => {
  const script = await loadScript();
  const payload = buildSyntheticLiteLLMJson();
  const rawBody = JSON.stringify(payload);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(rawBody, { status: 200 })) as typeof fetch;
  try {
    const tmp = mkdtempSync(path.join(tmpdir(), "litellm-verify-"));
    // First write to seed the meta file.
    await script.runFetchAndWrite({
      outDir: tmp,
      sourceUrl: "https://example.invalid/v1.json",
    });
    // Now flip the body so SHA differs.
    globalThis.fetch = (async () =>
      new Response(`${rawBody} `, { status: 200 })) as typeof fetch;
    await assert.rejects(
      () =>
        script.runVerify({
          outDir: tmp,
          sourceUrl: "https://example.invalid/v2.json",
        }),
      /upstream SHA changed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runVerify fails cleanly when the meta file is missing", async () => {
  const script = await loadScript();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("{}", { status: 200 })) as typeof fetch;
  try {
    const tmp = mkdtempSync(path.join(tmpdir(), "litellm-no-meta-"));
    await assert.rejects(
      () => script.runVerify({ outDir: tmp }),
      /could not read/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
