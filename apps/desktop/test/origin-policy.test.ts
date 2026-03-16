import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAndValidateOrigin, normalizeWebAppOrigin } from "../src/main/origin-policy.js";

test("accepts https api origin", () => {
  assert.equal(normalizeAndValidateOrigin("https://api.example.com"), "https://api.example.com");
});

test("accepts localhost http api origin for local development", () => {
  assert.equal(normalizeAndValidateOrigin("http://localhost:3002"), "http://localhost:3002");
  assert.equal(normalizeAndValidateOrigin("http://127.0.0.1:3002"), "http://127.0.0.1:3002");
});

test("rejects insecure non-loopback api origin", () => {
  assert.throws(() => normalizeAndValidateOrigin("http://example.com"), /must use https/i);
});

test("normalizes web app origin", () => {
  assert.equal(normalizeWebAppOrigin("https://app.example.com/path"), "https://app.example.com");
});
