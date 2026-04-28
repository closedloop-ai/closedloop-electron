/**
 * Direct unit tests for credential-scrubbing helpers in symphony-loop.
 *
 * Tests cover redactCredentials (string-level) and scrubObjectCredentials
 * (recursive object traversal), verifying that GitHub-style tokens are
 * redacted and that boundary conditions (35-char vs 36-char suffix) and
 * non-token base64 values are handled correctly.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  redactCredentials,
  scrubObjectCredentials,
} from "../src/server/operations/symphony-loop.js";

// ---------------------------------------------------------------------------
// Helper: generate a string of exactly N alphanumeric characters
// ---------------------------------------------------------------------------

function alphaNum(n: number): string {
  // Use a repeating pattern of safe base64url chars (no +/=) so the string
  // is purely [A-Za-z0-9] and does not accidentally match other patterns.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) {
    s += chars[i % chars.length];
  }
  return s;
}

// ---------------------------------------------------------------------------
// redactCredentials — string-level scrubbing
// ---------------------------------------------------------------------------

describe("redactCredentials", () => {
  it("(a) scrubs ghp_ token in a plain string value", () => {
    const token = `ghp_${alphaNum(36)}`;
    const result = redactCredentials(token);
    assert.equal(result, "[REDACTED_GH_TOKEN]");
    assert.ok(!result.includes("ghp_"), "ghp_ prefix must not survive");
  });

  it("(b) scrubs gho_ token embedded inside a URL string", () => {
    const token = `gho_${alphaNum(36)}`;
    const url = `https://user:${token}@github.com/org/repo.git`;
    const result = redactCredentials(url);
    assert.ok(!result.includes(token), "full gho_ token must not survive in URL");
    assert.ok(result.includes("[REDACTED_GH_TOKEN]"), "should contain redaction marker");
  });

  it("(c) scrubs ghr_ token in an error message string", () => {
    const token = `ghr_${alphaNum(36)}`;
    const errMsg = `Authentication failed with token ${token}`;
    const result = redactCredentials(errMsg);
    assert.ok(!result.includes(token), "ghr_ token must not survive in error string");
    assert.ok(result.includes("[REDACTED_GH_TOKEN]"), "should contain redaction marker");
  });

  it("(f) does NOT scrub a 35-char suffix — below the {36,} minimum", () => {
    // The pattern is (ghp|gho|ghs|ghr)_[A-Za-z0-9]{36,}
    // A 35-char suffix must NOT be redacted.
    const token = `ghp_${alphaNum(35)}`;
    const result = redactCredentials(token);
    assert.equal(result, token, "35-char suffix token must not be redacted");
  });

  it("scrubs a 36-char suffix — exactly at the {36,} boundary", () => {
    const token = `ghp_${alphaNum(36)}`;
    const result = redactCredentials(token);
    assert.equal(result, "[REDACTED_GH_TOKEN]", "36-char suffix token must be redacted");
  });

  it("(g) does not corrupt a non-token base64 value", () => {
    // A typical short base64 value that does not match any credential pattern.
    const b64 = "dGVzdA=="; // base64("test"), 8 chars — far below any pattern minimum
    const result = redactCredentials(b64);
    assert.equal(result, b64, "short base64 value must not be modified");
  });
});

// ---------------------------------------------------------------------------
// scrubObjectCredentials — recursive object traversal
// ---------------------------------------------------------------------------

describe("scrubObjectCredentials", () => {
  it("(a) scrubs a ghp_ token stored in a prUrl field", () => {
    const token = `ghp_${alphaNum(36)}`;
    const obj = { prUrl: `https://github.com/pulls/${token}` };
    const scrubbed = scrubObjectCredentials(obj) as typeof obj;
    assert.ok(
      !scrubbed.prUrl.includes(token),
      "ghp_ token in prUrl must be redacted",
    );
    assert.ok(
      scrubbed.prUrl.includes("[REDACTED_GH_TOKEN]"),
      "prUrl should contain redaction marker",
    );
  });

  it("(b) scrubs a gho_ token embedded in a URL field value", () => {
    const token = `gho_${alphaNum(36)}`;
    const obj = { cloneUrl: `https://x-access-token:${token}@github.com/org/repo` };
    const scrubbed = scrubObjectCredentials(obj) as typeof obj;
    assert.ok(!scrubbed.cloneUrl.includes(token), "gho_ token in URL field must be redacted");
  });

  it("(c) scrubs a ghr_ token stored in an error field", () => {
    const token = `ghr_${alphaNum(36)}`;
    const obj = { error: `push failed: token=${token}` };
    const scrubbed = scrubObjectCredentials(obj) as typeof obj;
    assert.ok(!scrubbed.error.includes(token), "ghr_ token in error field must be redacted");
    assert.ok(scrubbed.error.includes("[REDACTED_GH_TOKEN]"), "error field should contain redaction marker");
  });

  it("(d) scrubs multiple tokens in different top-level fields", () => {
    const ghp = `ghp_${alphaNum(36)}`;
    const gho = `gho_${alphaNum(36)}`;
    const ghr = `ghr_${alphaNum(36)}`;
    const obj = {
      prUrl: `https://github.com/pr/${ghp}`,
      cloneUrl: `https://x-access-token:${gho}@github.com/org/repo`,
      error: `failed with ${ghr}`,
    };
    const scrubbed = scrubObjectCredentials(obj) as Record<string, string>;
    assert.ok(!scrubbed.prUrl.includes(ghp), "ghp_ token in prUrl must be redacted");
    assert.ok(!scrubbed.cloneUrl.includes(gho), "gho_ token in cloneUrl must be redacted");
    assert.ok(!scrubbed.error.includes(ghr), "ghr_ token in error must be redacted");
  });

  it("(e) traverses nested object fields and scrubs all tokens", () => {
    const token = `ghp_${alphaNum(36)}`;
    const obj = {
      metadata: {
        auth: {
          token,
        },
      },
    };
    const scrubbed = scrubObjectCredentials(obj) as {
      metadata: { auth: { token: string } };
    };
    assert.ok(
      !scrubbed.metadata.auth.token.includes("ghp_"),
      "deeply nested token must be redacted",
    );
    assert.equal(
      scrubbed.metadata.auth.token,
      "[REDACTED_GH_TOKEN]",
      "nested token field must be fully redacted",
    );
  });

  it("(f) does NOT scrub a 35-char-suffix token inside an object field", () => {
    const token = `ghp_${alphaNum(35)}`;
    const obj = { prUrl: token };
    const scrubbed = scrubObjectCredentials(obj) as typeof obj;
    assert.equal(scrubbed.prUrl, token, "35-char suffix token in object must not be redacted");
  });

  it("(g) does not corrupt a non-token base64 value stored in an object", () => {
    const b64 = "dGVzdA=="; // base64("test")
    const obj = { checksum: b64 };
    const scrubbed = scrubObjectCredentials(obj) as typeof obj;
    assert.equal(scrubbed.checksum, b64, "non-token base64 in object field must not be modified");
  });

  it("handles arrays by scrubbing each element", () => {
    const token = `gho_${alphaNum(36)}`;
    const arr = [`clean-value`, `bearer: ${token}`];
    const scrubbed = scrubObjectCredentials(arr) as string[];
    assert.equal(scrubbed[0], "clean-value", "clean element must not be modified");
    assert.ok(!scrubbed[1].includes(token), "token in array element must be redacted");
  });

  it("passes through non-string primitive values unchanged", () => {
    const obj = { count: 42, active: true, nothing: null };
    const scrubbed = scrubObjectCredentials(obj) as typeof obj;
    assert.equal(scrubbed.count, 42);
    assert.equal(scrubbed.active, true);
    assert.equal(scrubbed.nothing, null);
  });
});
