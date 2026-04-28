/**
 * Direct unit tests for scrubObjectCredentials — recursive object traversal
 * over the underlying redactCredentials regex set.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrubObjectCredentials } from "../src/server/operations/symphony-loop.js";

function alphaNum(n: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[i % chars.length];
  return s;
}

describe("scrubObjectCredentials", () => {
  it("recurses into nested object fields and redacts tokens", () => {
    const token = `ghp_${alphaNum(36)}`;
    const obj = { metadata: { auth: { token } } };
    const scrubbed = scrubObjectCredentials(obj) as {
      metadata: { auth: { token: string } };
    };
    assert.equal(scrubbed.metadata.auth.token, "[REDACTED_GH_TOKEN]");
  });

  it("recurses into arrays and redacts tokens per element", () => {
    const token = `gho_${alphaNum(36)}`;
    const arr = ["clean-value", `bearer: ${token}`];
    const scrubbed = scrubObjectCredentials(arr) as string[];
    assert.equal(scrubbed[0], "clean-value");
    assert.ok(!scrubbed[1].includes(token));
    assert.ok(scrubbed[1].includes("[REDACTED_GH_TOKEN]"));
  });

  it("passes through non-string primitive values unchanged", () => {
    const obj = { count: 42, active: true, nothing: null };
    const scrubbed = scrubObjectCredentials(obj) as typeof obj;
    assert.equal(scrubbed.count, 42);
    assert.equal(scrubbed.active, true);
    assert.equal(scrubbed.nothing, null);
  });

  it("redacts a token in a deeply nested field end-to-end", () => {
    const token = `ghr_${alphaNum(36)}`;
    const obj = {
      results: [
        { repo: "a", error: `push failed: ${token}` },
      ],
    };
    const scrubbed = scrubObjectCredentials(obj) as {
      results: Array<{ repo: string; error: string }>;
    };
    assert.ok(!scrubbed.results[0].error.includes(token));
    assert.ok(scrubbed.results[0].error.includes("[REDACTED_GH_TOKEN]"));
  });
});
