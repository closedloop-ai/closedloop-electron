/**
 * Table-driven tests for classifyLoopStatus.
 *
 * Covers all disposition paths:
 *   - terminal: 401 (unauthorized), 404 (not_found), 410 (gone),
 *               null+timed_out (timed_out)
 *   - transient: 503 (server_error), null+null (network_error)
 *   - live: 200+active, null+active
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  classifyLoopStatus,
  type LoopStatusDisposition,
} from "../src/main/loop-status-classifier.js";

interface ClassifyCase {
  label: string;
  httpStatus: number | null;
  cloudKind: string | null;
  expected: LoopStatusDisposition;
}

const cases: ClassifyCase[] = [
  // --- Terminal paths ---
  {
    label: "401 → terminal(unauthorized)",
    httpStatus: 401,
    cloudKind: null,
    expected: { kind: "terminal", reason: "unauthorized" },
  },
  {
    label: "404 → terminal(not_found)",
    httpStatus: 404,
    cloudKind: null,
    expected: { kind: "terminal", reason: "not_found" },
  },
  {
    label: "410 → terminal(gone)",
    httpStatus: 410,
    cloudKind: null,
    expected: { kind: "terminal", reason: "gone" },
  },
  {
    label: "null+timed_out → terminal(timed_out)",
    httpStatus: null,
    cloudKind: "timed_out",
    expected: { kind: "terminal", reason: "timed_out" },
  },
  // Explicit TIMED_OUT kind takes precedence even when an HTTP status is present.
  {
    label: "200+timed_out → terminal(timed_out) (cloudKind wins over httpStatus)",
    httpStatus: 200,
    cloudKind: "timed_out",
    expected: { kind: "terminal", reason: "timed_out" },
  },

  // --- Transient paths ---
  {
    label: "503 → transient(server_error)",
    httpStatus: 503,
    cloudKind: null,
    expected: { kind: "transient", reason: "server_error" },
  },
  {
    label: "null+null → transient(network_error)",
    httpStatus: null,
    cloudKind: null,
    expected: { kind: "transient", reason: "network_error" },
  },

  // --- Live path ---
  {
    label: "200+active → live",
    httpStatus: 200,
    cloudKind: "active",
    expected: { kind: "live" },
  },
  // Boot-recovery reattach threads no HTTP status for healthy loops; an
  // explicit "active" kind must still resolve to live, not network_error.
  {
    label: "null+active → live (boot-recovery healthy reattach)",
    httpStatus: null,
    cloudKind: "active",
    expected: { kind: "live" },
  },
];

describe("classifyLoopStatus", () => {
  for (const { label, httpStatus, cloudKind, expected } of cases) {
    test(label, () => {
      const result = classifyLoopStatus(httpStatus, cloudKind);
      assert.deepEqual(result, expected);
    });
  }
});
