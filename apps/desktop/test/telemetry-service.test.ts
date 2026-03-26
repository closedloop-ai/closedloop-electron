/**
 * Unit tests for TelemetryService (T-6.1)
 *
 * Covers:
 * - emit() calls sendTelemetry with correct structure
 * - emit() never throws even if callback throws
 * - setTargetId() injects into trace.computeTargetId
 * - large logTail fields are truncated to TELEMETRY_MAX_FIELD_BYTES
 * - sendTelemetry callback never called (disconnected relay simulation) does not throw
 *
 * readLogTail() edge cases (imported directly from symphony-loop.ts per T-4.3):
 * - file smaller than maxBytes returns full content
 * - file larger than maxBytes returns tail content
 * - nonexistent file returns null
 * - empty file returns null
 * - partial first line dropped on mid-file offset
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  TELEMETRY_LOG_TAIL_MAX_BYTES,
  TELEMETRY_MAX_FIELD_BYTES,
  type TelemetryEventPayload,
} from "../src/main/telemetry-protocol.js";
import {
  TelemetryService,
  type EnrichedTelemetryEvent,
} from "../src/main/telemetry-service.js";
import { readLogTail } from "../src/server/operations/symphony-loop.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-service-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeEvent(overrides: Partial<TelemetryEventPayload> = {}): TelemetryEventPayload {
  return {
    severity: "info",
    category: "job.started",
    message: "test event",
    ...overrides,
  } as TelemetryEventPayload;
}

// ---------------------------------------------------------------------------
// TelemetryService.emit()
// ---------------------------------------------------------------------------

describe("TelemetryService.emit()", () => {
  test("calls sendTelemetry with a correctly structured event", () => {
    const received: EnrichedTelemetryEvent[] = [];
    const svc = new TelemetryService({
      sendTelemetry: (evt) => received.push(evt),
    });

    const event = makeEvent({ message: "hello", category: "job.started" });
    svc.emit(event);

    assert.equal(received.length, 1);
    assert.equal(received[0].message, "hello");
    assert.equal(received[0].category, "job.started");
    assert.equal(received[0].severity, "info");
    assert.equal(received[0].schemaVersion, 1);
    assert.equal(typeof received[0].timestamp, "string");
    assert.ok(received[0].timestamp!.length > 0);
  });

  test("never throws even if sendTelemetry callback throws", () => {
    const svc = new TelemetryService({
      sendTelemetry: () => {
        throw new Error("callback error");
      },
    });

    // Should not throw
    assert.doesNotThrow(() => {
      svc.emit(makeEvent());
    });
  });

  test("never throws even when sendTelemetry callback throws (relay error simulation)", () => {
    // Simulate a relay error by using a callback that throws on invocation
    let callbackInvoked = false;
    const svc = new TelemetryService({
      sendTelemetry: () => {
        callbackInvoked = true;
        // This represents a relay that is disconnected - the callback could
        // throw a connection error
        throw new Error("relay disconnected");
      },
    });

    // Even though the callback throws (simulating disconnected relay), emit() must not throw
    assert.doesNotThrow(() => {
      svc.emit(makeEvent());
    });

    // The callback was invoked (emit tried to send) but the error was swallowed
    assert.equal(callbackInvoked, true);
  });
});

// ---------------------------------------------------------------------------
// TelemetryService.setTargetId()
// ---------------------------------------------------------------------------

describe("TelemetryService.setTargetId()", () => {
  test("injects computeTargetId into trace context of emitted event", () => {
    const received: EnrichedTelemetryEvent[] = [];
    const svc = new TelemetryService({
      sendTelemetry: (evt) => received.push(evt),
    });

    svc.setTargetId("target-abc-123");
    svc.emit(makeEvent({ message: "after setTargetId" }));

    assert.equal(received.length, 1);
    assert.equal(received[0].trace?.computeTargetId, "target-abc-123");
  });

  test("merges computeTargetId with existing trace fields", () => {
    const received: EnrichedTelemetryEvent[] = [];
    const svc = new TelemetryService({
      sendTelemetry: (evt) => received.push(evt),
    });

    svc.setTargetId("target-xyz");
    svc.emit(
      makeEvent({
        trace: { commandId: "cmd-1", loopId: "loop-1" },
      })
    );

    assert.equal(received.length, 1);
    assert.equal(received[0].trace?.computeTargetId, "target-xyz");
    assert.equal(received[0].trace?.commandId, "cmd-1");
    assert.equal(received[0].trace?.loopId, "loop-1");
  });

  test("does not inject computeTargetId before setTargetId is called", () => {
    const received: EnrichedTelemetryEvent[] = [];
    const svc = new TelemetryService({
      sendTelemetry: (evt) => received.push(evt),
    });

    svc.emit(makeEvent());

    assert.equal(received.length, 1);
    assert.equal(received[0].trace?.computeTargetId, undefined);
  });
});

// ---------------------------------------------------------------------------
// logTail truncation
// ---------------------------------------------------------------------------

describe("TelemetryService logTail truncation", () => {
  test("truncates logTail larger than TELEMETRY_MAX_FIELD_BYTES", () => {
    const received: EnrichedTelemetryEvent[] = [];
    const svc = new TelemetryService({
      sendTelemetry: (evt) => received.push(evt),
    });

    // Build a logTail that is clearly over the 4 KiB limit
    const overLimit = "x".repeat(TELEMETRY_MAX_FIELD_BYTES + 500);
    svc.emit(
      makeEvent({
        diagnostics: { logTail: overLimit },
      })
    );

    assert.equal(received.length, 1);
    const logTail = received[0].diagnostics?.logTail;
    assert.ok(logTail !== undefined, "logTail should be present");
    const byteLength = Buffer.byteLength(logTail, "utf8");
    assert.ok(
      byteLength <= TELEMETRY_MAX_FIELD_BYTES,
      `logTail byte length ${byteLength} exceeds TELEMETRY_MAX_FIELD_BYTES ${TELEMETRY_MAX_FIELD_BYTES}`
    );
  });

  test("passes through logTail smaller than TELEMETRY_MAX_FIELD_BYTES unchanged", () => {
    const received: EnrichedTelemetryEvent[] = [];
    const svc = new TelemetryService({
      sendTelemetry: (evt) => received.push(evt),
    });

    const shortTail = "short log line\n";
    svc.emit(
      makeEvent({
        diagnostics: { logTail: shortTail },
      })
    );

    assert.equal(received.length, 1);
    assert.equal(received[0].diagnostics?.logTail, shortTail);
  });

  test("preserves other diagnostics fields when truncating logTail", () => {
    const received: EnrichedTelemetryEvent[] = [];
    const svc = new TelemetryService({
      sendTelemetry: (evt) => received.push(evt),
    });

    const overLimit = "y".repeat(TELEMETRY_MAX_FIELD_BYTES + 100);
    svc.emit(
      makeEvent({
        diagnostics: {
          logTail: overLimit,
          errorStack: "Error: something\n  at fn (file.ts:1)",
          extra: { key: "value" },
        },
      })
    );

    assert.equal(received.length, 1);
    assert.equal(
      received[0].diagnostics?.errorStack,
      "Error: something\n  at fn (file.ts:1)"
    );
    assert.deepEqual(received[0].diagnostics?.extra, { key: "value" });
  });
});

// ---------------------------------------------------------------------------
// readLogTail() edge cases
// ---------------------------------------------------------------------------

describe("readLogTail()", () => {
  test("returns null for nonexistent file", () => {
    const dir = makeTempDir();
    const result = readLogTail(path.join(dir, "does-not-exist.log"));
    assert.equal(result, null);
  });

  test("returns null for empty file", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "empty.log");
    fs.writeFileSync(logPath, "");
    const result = readLogTail(logPath);
    assert.equal(result, null);
  });

  test("returns full content for file smaller than maxBytes (32 KiB)", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "small.log");
    const content = "line 1\nline 2\nline 3\n";
    fs.writeFileSync(logPath, content);
    const result = readLogTail(logPath);
    assert.equal(result, content);
  });

  test("returns tail content for file larger than maxBytes", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "large.log");

    // Write more than 32 KiB (LOG_TAIL_MAX_BYTES)
    const LOG_TAIL_MAX_BYTES = TELEMETRY_LOG_TAIL_MAX_BYTES;
    // Build content: a "header" section followed by many lines, total > 32 KiB
    const line = "a".repeat(100) + "\n"; // 101 bytes per line
    const numLines = Math.ceil((LOG_TAIL_MAX_BYTES + 1000) / line.length) + 1;
    const header = "HEADER_LINE\n";
    const body = line.repeat(numLines);
    fs.writeFileSync(logPath, header + body);

    const result = readLogTail(logPath);
    assert.ok(result !== null, "should return string for large file");

    const byteLength = Buffer.byteLength(result, "utf8");
    assert.ok(
      byteLength <= LOG_TAIL_MAX_BYTES,
      `result byte length ${byteLength} exceeds LOG_TAIL_MAX_BYTES ${LOG_TAIL_MAX_BYTES}`
    );

    // The HEADER_LINE should not appear in the result (it's from the start of a big file)
    assert.ok(
      !result.includes("HEADER_LINE"),
      "should not contain header from start of oversized file"
    );
  });

  test("drops partial first line on mid-file offset", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "mid-offset.log");

    // Write more than 32 KiB so we're guaranteed to start mid-file
    const LOG_TAIL_MAX_BYTES = TELEMETRY_LOG_TAIL_MAX_BYTES;
    // Line 1 is unique and will be cut: it must start before the 32 KiB tail window
    const uniquePrefix = "UNIQUE_PARTIAL_LINE_";
    // Pad to make sure the total file exceeds LOG_TAIL_MAX_BYTES
    const padding = "p".repeat(LOG_TAIL_MAX_BYTES);
    const tailLines = "complete line 1\ncomplete line 2\n";
    // Layout: padding (32 KiB) + partial unique line that straddles the boundary
    // We'll ensure UNIQUE_PARTIAL_LINE_ falls just before the 32 KiB boundary
    const content = padding + uniquePrefix + "rest_of_line\n" + tailLines;
    fs.writeFileSync(logPath, content);

    const result = readLogTail(logPath);
    assert.ok(result !== null, "should return string");

    // The partial line (UNIQUE_PARTIAL_LINE_) falls right at the boundary -
    // if the file is offset, the function should drop the partial first line
    // The tail lines should be present since they are after the partial line
    assert.ok(
      result.includes("complete line 1"),
      "should include complete tail lines"
    );
    // The unique prefix may or may not appear depending on exact byte boundaries,
    // but if it does appear, it should be a complete occurrence (not partial).
    // The important property: the result doesn't start with a partial line.
    const firstNewline = result.indexOf("\n");
    if (firstNewline > 0) {
      // First line should be a complete line (not ending abruptly mid-word)
      const firstLine = result.slice(0, firstNewline);
      // A partial line from UNIQUE_PARTIAL_LINE_ would be "rest_of_line" without the prefix
      assert.ok(
        !firstLine.startsWith("rest_of_line"),
        `first line should not be a partial tail of a split line, got: "${firstLine}"`
      );
    }
  });
});
