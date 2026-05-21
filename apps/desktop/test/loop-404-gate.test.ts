/**
 * Unit tests for apps/desktop/src/main/loop-404-gate.ts
 *
 * Covers:
 *   - marking an endpoint disabled
 *   - checking disabled state (returns false before mark, true after)
 *   - independence between server URLs (different servers do not share state)
 *   - independence between endpoint paths on the same server
 *   - process-memory-only semantics (no disk persistence — verified by
 *     resetting via resetAllGates() and confirming state is gone)
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  isEndpointDisabled,
  markEndpointDisabled,
  resetAllGates,
} from "../src/main/loop-404-gate.js";

afterEach(() => {
  // Restore clean in-memory state between tests so each test is independent.
  resetAllGates();
});

// ---------------------------------------------------------------------------
// Marking and checking disabled state
// ---------------------------------------------------------------------------

test("isEndpointDisabled returns false before any mark", () => {
  assert.equal(
    isEndpointDisabled("https://api.example.com", "/refresh-token"),
    false,
  );
});

test("isEndpointDisabled returns true after markEndpointDisabled for the same arguments", () => {
  markEndpointDisabled("https://api.example.com", "/refresh-token");
  assert.equal(
    isEndpointDisabled("https://api.example.com", "/refresh-token"),
    true,
  );
});

test("markEndpointDisabled is idempotent — marking twice does not throw and state remains true", () => {
  markEndpointDisabled("https://api.example.com", "/heartbeat");
  markEndpointDisabled("https://api.example.com", "/heartbeat");
  assert.equal(
    isEndpointDisabled("https://api.example.com", "/heartbeat"),
    true,
  );
});

// ---------------------------------------------------------------------------
// Independence between server URLs
// ---------------------------------------------------------------------------

test("disabling an endpoint on one server URL does not affect another server URL", () => {
  markEndpointDisabled("https://api.server-a.com", "/refresh-token");

  // Same path on a different server must remain enabled.
  assert.equal(
    isEndpointDisabled("https://api.server-b.com", "/refresh-token"),
    false,
    "server-b should not be affected by a mark on server-a",
  );
});

test("each server URL has independent disabled state", () => {
  markEndpointDisabled("https://api.server-a.com", "/heartbeat");
  markEndpointDisabled("https://api.server-b.com", "/refresh-token");

  assert.equal(
    isEndpointDisabled("https://api.server-a.com", "/heartbeat"),
    true,
  );
  assert.equal(
    isEndpointDisabled("https://api.server-b.com", "/heartbeat"),
    false,
    "/heartbeat was only disabled on server-a",
  );
  assert.equal(
    isEndpointDisabled("https://api.server-a.com", "/refresh-token"),
    false,
    "/refresh-token was only disabled on server-b",
  );
  assert.equal(
    isEndpointDisabled("https://api.server-b.com", "/refresh-token"),
    true,
  );
});

// ---------------------------------------------------------------------------
// Independence between endpoint paths on the same server
// ---------------------------------------------------------------------------

test("disabling one endpoint path on a server does not disable another path on the same server", () => {
  markEndpointDisabled("https://api.example.com", "/refresh-token");

  assert.equal(
    isEndpointDisabled("https://api.example.com", "/heartbeat"),
    false,
    "/heartbeat should remain enabled when only /refresh-token was marked",
  );
});

test("multiple endpoint paths on the same server can be independently disabled", () => {
  markEndpointDisabled("https://api.example.com", "/refresh-token");
  markEndpointDisabled("https://api.example.com", "/heartbeat");

  assert.equal(
    isEndpointDisabled("https://api.example.com", "/refresh-token"),
    true,
  );
  assert.equal(
    isEndpointDisabled("https://api.example.com", "/heartbeat"),
    true,
  );
});

// ---------------------------------------------------------------------------
// Process-memory-only semantics
// ---------------------------------------------------------------------------

test("resetAllGates clears all disabled state — simulating process restart", () => {
  // Populate state across multiple server/path combinations.
  markEndpointDisabled("https://api.server-a.com", "/refresh-token");
  markEndpointDisabled("https://api.server-b.com", "/heartbeat");

  // Confirm state is present before reset.
  assert.equal(
    isEndpointDisabled("https://api.server-a.com", "/refresh-token"),
    true,
  );
  assert.equal(
    isEndpointDisabled("https://api.server-b.com", "/heartbeat"),
    true,
  );

  // Simulate process restart — all in-memory state is gone.
  resetAllGates();

  // After reset, both entries must be gone.
  assert.equal(
    isEndpointDisabled("https://api.server-a.com", "/refresh-token"),
    false,
    "State should be cleared after resetAllGates",
  );
  assert.equal(
    isEndpointDisabled("https://api.server-b.com", "/heartbeat"),
    false,
    "State should be cleared after resetAllGates",
  );
});

test("gate can be re-populated after resetAllGates — confirming in-memory lifetime", () => {
  markEndpointDisabled("https://api.example.com", "/refresh-token");
  resetAllGates();

  // After reset, re-mark and confirm it works again.
  assert.equal(
    isEndpointDisabled("https://api.example.com", "/refresh-token"),
    false,
  );
  markEndpointDisabled("https://api.example.com", "/refresh-token");
  assert.equal(
    isEndpointDisabled("https://api.example.com", "/refresh-token"),
    true,
  );
});
