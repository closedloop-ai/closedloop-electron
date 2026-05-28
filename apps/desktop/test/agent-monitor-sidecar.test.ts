/**
 * Tests for agent-monitor-sidecar.ts PID persistence, orphan reclamation,
 * foreign process safety, and stale log suppression.
 *
 * AC-011: foreign process holds port 4820 — counter advances 1-5, no PID
 *         killed, no false-positive ready log, terminal "giving up" log fires.
 * AC-012: orphan recovery — spawn, persist PID, force-kill, restart, orphan
 *         SIGKILLed, new spawn binds port 4820 successfully and reaches ready.
 * AC-013: stale log suppression — prev-launch resolves after new-launch race;
 *         misleading "did not become healthy" log does not fire.
 *
 * Because agent-monitor-sidecar.ts imports `app` from "electron" directly,
 * the class cannot be imported under the Node.js test runner (tsx --test).
 * These tests follow the same structural-verification approach used in
 * agent-monitor-wiring-static.test.ts: they read the source as text and assert
 * the implementation invariants that make each AC hold at runtime.
 *
 * Shared helpers exported from this file are designed to be re-used by
 * integration-level tests once a test-harness shim for the sidecar is
 * available.
 */

import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, describe, mock, test } from "node:test";

// ---------------------------------------------------------------------------
// Source text fixture (read once at module evaluation time)
// ---------------------------------------------------------------------------

const sidecarSource = readFileSync(
  new URL("../src/main/agent-monitor-sidecar.ts", import.meta.url),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Pre-computed method body slices (avoids repeating indexOf + slice in each test)
// ---------------------------------------------------------------------------

/**
 * Extract a method body from the sidecar source by its signature prefix.
 * Returns the slice starting at the method signature up to `windowChars` chars.
 * Throws if the signature is not found (fail-fast for stale tests).
 */
function methodBody(signature: string, windowChars: number): string {
  const idx = sidecarSource.indexOf(signature);
  assert.ok(idx >= 0, `${signature} not found in sidecar source`);
  return sidecarSource.slice(idx, idx + windowChars);
}

const reclaimOrphanBody = methodBody("private async reclaimOrphan()", 1600);
const handleExitBody = methodBody("private handleExit(", 1200);
const launchBody = methodBody("private async launch()", 4000);

// ---------------------------------------------------------------------------
// Shared helpers: PID file state
// ---------------------------------------------------------------------------

export interface PidFileRecord {
  pid: number;
  sessionToken: string;
  recordedAt: string;
}

/**
 * Write a sidecar.pid file to the given userData directory, matching the
 * atomic-write pattern used by writePidFile() in the sidecar source:
 * write a .tmp file then rename it into place.
 */
export async function writePidFile(
  userDataDir: string,
  record: PidFileRecord,
): Promise<string> {
  const dir = path.join(userDataDir, "agent-monitor");
  const pidFile = path.join(dir, "sidecar.pid");
  const tmpFile = `${pidFile}.tmp`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpFile, JSON.stringify(record), "utf-8");
  await fs.rename(tmpFile, pidFile);
  return pidFile;
}

/**
 * Read and parse a sidecar.pid file from the given userData directory.
 * Returns null if the file does not exist (ENOENT).
 */
export async function readPidFile(
  userDataDir: string,
): Promise<PidFileRecord | null> {
  const pidFile = path.join(userDataDir, "agent-monitor", "sidecar.pid");
  try {
    const raw = await fs.readFile(pidFile, "utf-8");
    return JSON.parse(raw) as PidFileRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Assert that no sidecar.pid file exists in the given userData directory.
 */
export async function assertNoPidFile(userDataDir: string): Promise<void> {
  const record = await readPidFile(userDataDir);
  assert.equal(
    record,
    null,
    `expected sidecar.pid to be absent in ${userDataDir}/agent-monitor/`,
  );
}

/**
 * Assert that a sidecar.pid file exists and matches the expected fields.
 */
export async function assertPidFile(
  userDataDir: string,
  expected: Partial<PidFileRecord>,
): Promise<PidFileRecord> {
  const record = await readPidFile(userDataDir);
  assert.ok(
    record !== null,
    `expected sidecar.pid to exist in ${userDataDir}/agent-monitor/`,
  );
  if (expected.pid !== undefined) {
    assert.equal(record.pid, expected.pid, "PID mismatch in sidecar.pid");
  }
  if (expected.sessionToken !== undefined) {
    assert.equal(
      record.sessionToken,
      expected.sessionToken,
      "sessionToken mismatch in sidecar.pid",
    );
  }
  return record;
}

// ---------------------------------------------------------------------------
// Shared helpers: mock HTTP health server
// ---------------------------------------------------------------------------

export interface HealthServer {
  /** Port the server is listening on. */
  port: number;
  /** Shut down the server and release the port. */
  close(): Promise<void>;
}

/**
 * Start a minimal HTTP server that responds 200 OK to GET /api/health.
 * Binds to 127.0.0.1 on the given port (or a random port if 0).
 *
 * Used in tests to simulate a healthy sidecar already on port 4820
 * (foreign process scenario) or to act as the real sidecar in integration
 * tests.
 */
export function startHealthServer(
  port: number,
  opts?: { statusCode?: number; body?: string },
): Promise<HealthServer> {
  return new Promise((resolve, reject) => {
    const statusCode = opts?.statusCode ?? 200;
    const body = opts?.body ?? "ok";
    const server = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(statusCode, { "Content-Type": "text/plain" });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
    server.once("error", reject);
  });
}

/**
 * Check whether a TCP port on 127.0.0.1 is currently accepting connections.
 * Returns true if a connection succeeds within 200ms, false otherwise.
 */
export function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onError = () => {
      socket.destroy();
      resolve(false);
    };
    socket.setTimeout(200);
    socket.once("error", onError);
    socket.once("timeout", onError);
    socket.connect(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
  });
}

// ---------------------------------------------------------------------------
// Shared helpers: process.kill spy
// ---------------------------------------------------------------------------

export interface ProcessKillSpy {
  /** All recorded kill() calls: [pid, signal] tuples. */
  calls: Array<[number, string | number]>;
  /** Restore the original process.kill. */
  restore(): void;
}

/**
 * Replace process.kill with a spy that records calls without forwarding
 * to the OS.  The spy does NOT send signals to real processes; use only
 * in unit tests that need to verify that kill() is (or is not) called with
 * specific arguments.
 *
 * Returns a handle with the recorded calls and a restore() method.
 */
export function spyProcessKill(): ProcessKillSpy {
  const calls: Array<[number, string | number]> = [];
  const originalKill = process.kill.bind(process);

  // process.kill signature: (pid: number, signal?: string | number) => true
  // Cast required because mock.method expects method semantics but process.kill
  // is a standalone function on the process object.
  const spy = mock.method(
    process,
    "kill",
    (pid: number, signal?: string | number) => {
      calls.push([pid, signal ?? 0]);
      // Return true to match the process.kill return type.
      return true;
    },
  );

  return {
    calls,
    restore() {
      spy.mock.restore();
      void originalKill; // reference to avoid unused-variable lint
    },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers: temporary userData directory
// ---------------------------------------------------------------------------

const tempDirsToClean: string[] = [];

afterEach(async () => {
  for (const dir of tempDirsToClean.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/**
 * Create a temporary directory that acts as `app.getPath("userData")` for a
 * test.  The directory is automatically removed in the afterEach hook.
 */
export async function makeTempUserDataDir(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "sidecar-test-userdata-"),
  );
  tempDirsToClean.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Shared helpers: mock gatewayLog
// ---------------------------------------------------------------------------

export interface GatewayLogSpy {
  entries: Array<{ level: string; tag: string; message: string }>;
  reset(): void;
}

/**
 * Create a lightweight spy that captures log calls.  It does NOT mock the
 * actual gatewayLog singleton (which is an ESM live binding and cannot be
 * intercepted via mock.method in Node's test runner without module loader
 * hooks).  Instead, tests that need to verify log output should pass this
 * spy into the helper functions below that accept a log callback, or assert
 * on log-driven side effects.
 */
export function createGatewayLogSpy(): GatewayLogSpy {
  const entries: Array<{ level: string; tag: string; message: string }> = [];
  return {
    entries,
    reset() {
      entries.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers: mock ChildProcess
// ---------------------------------------------------------------------------

/**
 * Minimal mock ChildProcess with typed event emitters for stdout, stderr.
 * Matches the interface consumed by pipeLines() and the exit/error handlers
 * in agent-monitor-sidecar.ts.
 */
export type MockSidecarChild = EventEmitter & {
  pid: number | undefined;
  exitCode: number | null;
  stdout: EventEmitter & { setEncoding(enc: string): void };
  stderr: EventEmitter & { setEncoding(enc: string): void };
};

export function buildMockSidecarChild(pid?: number): MockSidecarChild {
  const child = new EventEmitter() as MockSidecarChild;
  child.pid = pid;
  child.exitCode = null;

  const stdout = new EventEmitter() as MockSidecarChild["stdout"];
  stdout.setEncoding = () => {};
  child.stdout = stdout;

  const stderr = new EventEmitter() as MockSidecarChild["stderr"];
  stderr.setEncoding = () => {};
  child.stderr = stderr;

  return child;
}

/**
 * Simulate the child exiting by setting exitCode and emitting the "exit"
 * event, matching the Node.js ChildProcess contract.
 */
export function simulateChildExit(
  child: MockSidecarChild,
  code: number | null,
  signal: NodeJS.Signals | null = null,
): void {
  child.exitCode = code ?? 1;
  child.emit("exit", code, signal);
}

/**
 * Emit an EADDRINUSE line on the child's stderr stream so the sidecar's
 * stderr handler sets lastExitWasPortConflict = true.
 */
export function emitEaddrinuse(child: MockSidecarChild): void {
  child.stderr.emit(
    "data",
    "Error: listen EADDRINUSE: address already in use :::4820\n",
  );
}

// ---------------------------------------------------------------------------
// Static verification tests (AC-006 through AC-010 source-level invariants)
// ---------------------------------------------------------------------------

describe("agent-monitor-sidecar.ts source-level invariants", () => {
  // -------------------------------------------------------------------------
  // AC-006: PID file lifecycle — write on stability, delete on stop()
  // -------------------------------------------------------------------------

  test("AC-006a: writePidFile uses atomic rename (write .tmp then rename)", () => {
    assert.match(
      sidecarSource,
      /await fs\.writeFile\(tmpFile, payload, "utf-8"\);\s*await fs\.rename\(tmpFile, pidFile\)/,
    );
  });

  test("AC-006b: writePidFile persists { pid, sessionToken, recordedAt } JSON", () => {
    assert.match(sidecarSource, /pid,\s*sessionToken: this\.sessionToken,\s*recordedAt:/);
  });

  test("AC-006c: writePidFile ensures agent-monitor directory exists with mkdir recursive", () => {
    assert.match(
      sidecarSource,
      /await fs\.mkdir\(this\.dataDir, \{ recursive: true \}\);[\s\S]{0,100}await fs\.writeFile\(tmpFile/,
    );
  });

  test("AC-006d: deletePidFile is called in stop() after killing the child", () => {
    // The finally block in stop() must contain deletePidFile()
    assert.match(
      sidecarSource,
      /async stop\(\): Promise<void>[\s\S]{0,600}await this\.deletePidFile\(\)/,
    );
  });

  test("AC-006e: deletePidFile suppresses ENOENT (file absent on first run)", () => {
    // The deletePidFile method body catches errors and only logs when code is
    // NOT ENOENT — meaning ENOENT (file absent on first run) is silently swallowed.
    assert.match(
      sidecarSource,
      /deletePidFile[\s\S]{0,400}code !== "ENOENT"/,
    );
  });

  test("AC-006f: writePidFile is called only after the stability window confirms readiness", () => {
    // writePidFile must be called AFTER delay(READY_STABILITY_WINDOW_MS) and
    // inside the isChildAliveAndCurrent check, not unconditionally after spawn.
    assert.match(
      sidecarSource,
      /await delay\(READY_STABILITY_WINDOW_MS\)[\s\S]{0,400}await this\.writePidFile\(child\.pid!/,
    );
  });

  // -------------------------------------------------------------------------
  // AC-007: Pre-bind orphan reclamation
  // -------------------------------------------------------------------------

  test("AC-007a: reclaimOrphan is called before spawn in launch()", () => {
    const reclaimPos = launchBody.indexOf("await this.reclaimOrphan()");
    const spawnPos = launchBody.indexOf("const child = spawn(");
    assert.ok(reclaimPos >= 0, "reclaimOrphan() call not found in launch()");
    assert.ok(spawnPos >= 0, "spawn() call not found in launch()");
    assert.ok(
      reclaimPos < spawnPos,
      "reclaimOrphan() must be called before spawn()",
    );
  });

  test("AC-007b: reclaimOrphan SIGKILLs a running orphan before the final deletePidFile call", () => {
    assert.match(reclaimOrphanBody, /isRunning\(pid\)/);
    assert.match(reclaimOrphanBody, /killGroup\(pid, "SIGKILL"\)/);
    // Verify the unconditional deletePidFile at the end of reclaimOrphan comes
    // after the SIGKILL inside the isRunning guard.
    const sigkillPos = reclaimOrphanBody.indexOf('killGroup(pid, "SIGKILL")');
    assert.ok(sigkillPos >= 0, 'killGroup(pid, "SIGKILL") not found in reclaimOrphan body');
    // The last deletePidFile() call in the body is the unconditional one that
    // runs after the kill (all other deletePidFile calls are in early-return paths).
    const lastDeletePos = reclaimOrphanBody.lastIndexOf("await this.deletePidFile()");
    assert.ok(lastDeletePos >= 0, "await this.deletePidFile() not found in reclaimOrphan body");
    assert.ok(
      sigkillPos < lastDeletePos,
      `Expected SIGKILL (pos ${sigkillPos}) to precede final deletePidFile (pos ${lastDeletePos})`,
    );
  });

  test("AC-007c: reclaimOrphan reads sidecar.pid from the dataDir directory", () => {
    assert.match(
      reclaimOrphanBody,
      /path\.join\(this\.dataDir, "sidecar\.pid"\)/,
    );
  });

  // -------------------------------------------------------------------------
  // AC-008: Foreign process safety
  // -------------------------------------------------------------------------

  test("AC-008a: reclaimOrphan skips kill when PID file is absent (ENOENT returns early)", () => {
    assert.match(reclaimOrphanBody, /code === "ENOENT"[\s\S]{0,60}return;/);
  });

  test("AC-008b: reclaimOrphan skips kill when sessionToken is missing", () => {
    assert.match(
      sidecarSource,
      /!sessionToken[\s\S]{0,200}skipping kill[\s\S]{0,200}await this\.deletePidFile/,
    );
  });

  test("AC-008c: reclaimOrphan only kills via SIGKILL — no SIGTERM path", () => {
    assert.match(reclaimOrphanBody, /SIGKILL/);
    assert.doesNotMatch(reclaimOrphanBody, /SIGTERM/);
  });

  // -------------------------------------------------------------------------
  // AC-009: Terminal failure callback
  // -------------------------------------------------------------------------

  test("AC-009a: onTerminalFailure callback is accepted in constructor options", () => {
    assert.match(
      sidecarSource,
      /constructor\(options\?: \{ onTerminalFailure\?: \(reason: string\) => void \}\)/,
    );
  });

  test("AC-009b: onTerminalFailure is invoked when restartAttempts >= MAX_RESTART_ATTEMPTS", () => {
    assert.match(
      sidecarSource,
      /this\.restartAttempts >= MAX_RESTART_ATTEMPTS[\s\S]{0,500}this\.onTerminalFailure\?\.\(reason\)/,
    );
  });

  test("AC-009c: EADDRINUSE stderr sets lastExitWasPortConflict flag", () => {
    assert.match(sidecarSource, /EADDRINUSE[\s\S]{0,60}lastExitWasPortConflict = true/);
  });

  test("AC-009d: terminal failure message includes port-in-use detail when lastExitWasPortConflict", () => {
    assert.match(
      sidecarSource,
      /lastExitWasPortConflict[\s\S]{0,300}port.*is in use by another process/,
    );
  });

  // -------------------------------------------------------------------------
  // AC-010: Stale log suppression
  // -------------------------------------------------------------------------

  test("AC-010: stale waitForHealth log is gated by this.child === child check", () => {
    // The warn log must be inside a guard that checks whether the child is
    // still the active one.  The guard must appear BEFORE the warn log.
    assert.match(
      sidecarSource,
      /this\.child !== child[\s\S]{0,200}return;[\s\S]{0,400}agent monitor did not become healthy/,
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers: fs/promises mock support
// ---------------------------------------------------------------------------

/**
 * In-memory filesystem store keyed by absolute path.
 * Used by tests that need to intercept fs.readFile / fs.writeFile / fs.rename
 * / fs.unlink / fs.mkdir without touching real disk.
 *
 * This is a lightweight substitute for a full fs mock; tests that need
 * fine-grained filesystem control can use makeTempUserDataDir() instead.
 */
export class InMemoryFs {
  private readonly files = new Map<string, string>();

  async readFile(filePath: string, _encoding: "utf-8"): Promise<string> {
    const content = this.files.get(filePath);
    if (content === undefined) {
      const err = Object.assign(
        new Error(`ENOENT: no such file or directory, open '${filePath}'`),
        { code: "ENOENT" },
      );
      throw err;
    }
    return content;
  }

  async writeFile(
    filePath: string,
    data: string,
    _encoding: "utf-8",
  ): Promise<void> {
    this.files.set(filePath, data);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content === undefined) {
      const err = Object.assign(
        new Error(`ENOENT: no such file or directory, rename '${oldPath}'`),
        { code: "ENOENT" },
      );
      throw err;
    }
    this.files.delete(oldPath);
    this.files.set(newPath, content);
  }

  async unlink(filePath: string): Promise<void> {
    if (!this.files.has(filePath)) {
      const err = Object.assign(
        new Error(
          `ENOENT: no such file or directory, unlink '${filePath}'`,
        ),
        { code: "ENOENT" },
      );
      throw err;
    }
    this.files.delete(filePath);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async mkdir(_dirPath: string, _opts?: { recursive?: boolean }): Promise<void> {
    // no-op: directories are implicit in this in-memory store
  }

  has(filePath: string): boolean {
    return this.files.has(filePath);
  }

  get(filePath: string): string | undefined {
    return this.files.get(filePath);
  }

  set(filePath: string, content: string): void {
    this.files.set(filePath, content);
  }
}

// ---------------------------------------------------------------------------
// Helpers: integration test setup
// ---------------------------------------------------------------------------

/**
 * Build a PID file record with a known session token and a realistic
 * recordedAt timestamp.  Used by T-3.3 (orphan recovery scenario).
 */
export function makePidRecord(
  pid: number,
  sessionToken = "test-session-token",
): PidFileRecord {
  return {
    pid,
    sessionToken,
    recordedAt: new Date().toISOString(),
  };
}

/**
 * Poll until a predicate returns true, or throw after the given timeout.
 */
export async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
  pollMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error(
        `waitForCondition timed out after ${timeoutMs}ms`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
}

// ---------------------------------------------------------------------------
// Smoke tests for the shared helpers themselves
// ---------------------------------------------------------------------------

describe("shared test-harness helpers", () => {
  test("writePidFile + readPidFile round-trips a record", async () => {
    const dir = await makeTempUserDataDir();
    const record = makePidRecord(12345, "tok-abc");
    await writePidFile(dir, record);
    const got = await readPidFile(dir);
    assert.deepEqual(got, record);
  });

  test("readPidFile returns null when file is absent", async () => {
    const dir = await makeTempUserDataDir();
    assert.equal(await readPidFile(dir), null);
  });

  test("assertNoPidFile does not throw when file is absent", async () => {
    const dir = await makeTempUserDataDir();
    await assert.doesNotReject(assertNoPidFile(dir));
  });

  test("assertNoPidFile throws when file exists", async () => {
    const dir = await makeTempUserDataDir();
    await writePidFile(dir, makePidRecord(1));
    await assert.rejects(assertNoPidFile(dir));
  });

  test("startHealthServer responds 200 to GET /api/health", async () => {
    const srv = await startHealthServer(0);
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/health`);
      assert.equal(res.status, 200);
    } finally {
      await srv.close();
    }
  });

  test("startHealthServer returns the bound port", async () => {
    const srv = await startHealthServer(0);
    try {
      assert.ok(srv.port > 0 && srv.port < 65536);
    } finally {
      await srv.close();
    }
  });

  test("isPortListening returns true for a listening server", async () => {
    const srv = await startHealthServer(0);
    try {
      assert.equal(await isPortListening(srv.port), true);
    } finally {
      await srv.close();
    }
  });

  test("isPortListening returns false for a closed port", async () => {
    // Use a port that is very unlikely to have a listener.
    const unusedPort = 39847;
    assert.equal(await isPortListening(unusedPort), false);
  });

  test("spyProcessKill records kill calls without forwarding to OS", () => {
    const spy = spyProcessKill();
    try {
      // Call with a synthetic PID that could never be a real process.
      process.kill(9_999_998 as number, 0 as number);
      // The spy intercepts the call; the OS never sees it.
      assert.equal(spy.calls.length, 1);
      assert.deepEqual(spy.calls[0], [9_999_998, 0]);
    } finally {
      spy.restore();
    }
  });

  test("InMemoryFs round-trips writeFile + readFile", async () => {
    const vfs = new InMemoryFs();
    await vfs.writeFile("/tmp/test.txt", "hello", "utf-8");
    const content = await vfs.readFile("/tmp/test.txt", "utf-8");
    assert.equal(content, "hello");
  });

  test("InMemoryFs rename moves the file", async () => {
    const vfs = new InMemoryFs();
    await vfs.writeFile("/tmp/a.tmp", "data", "utf-8");
    await vfs.rename("/tmp/a.tmp", "/tmp/a.json");
    assert.equal(vfs.has("/tmp/a.tmp"), false);
    assert.equal(await vfs.readFile("/tmp/a.json", "utf-8"), "data");
  });

  test("InMemoryFs unlink removes the file and throws ENOENT on re-read", async () => {
    const vfs = new InMemoryFs();
    await vfs.writeFile("/tmp/pid", "x", "utf-8");
    await vfs.unlink("/tmp/pid");
    await assert.rejects(
      () => vfs.readFile("/tmp/pid", "utf-8"),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT",
    );
  });

  test("buildMockSidecarChild emits exit event on simulateChildExit", () => {
    const child = buildMockSidecarChild(42);
    let fired = false;
    child.on("exit", (code: number | null) => {
      fired = true;
      assert.equal(code, 1);
    });
    simulateChildExit(child, 1);
    assert.equal(fired, true);
    assert.equal(child.exitCode, 1);
  });

  test("emitEaddrinuse triggers data event on child.stderr with EADDRINUSE text", () => {
    const child = buildMockSidecarChild(99);
    let captured = "";
    child.stderr.on("data", (line: string) => {
      captured = line;
    });
    emitEaddrinuse(child);
    assert.match(captured, /EADDRINUSE/);
  });
});

// ---------------------------------------------------------------------------
// T-3.2: Foreign-process guard scenario (AC-011) — source-level invariants
//
// These tests verify the behavioral invariants that make the foreign-process
// scenario correct at runtime by reading the source as text and asserting
// the presence and ordering of critical logic patterns.
//
// AC-011: foreign process holds port 4820 — counter advances 1-5, no PID
//         killed, no false-positive ready log, terminal "giving up" log fires.
// ---------------------------------------------------------------------------

describe("T-3.2: foreign-process guard scenario source-level invariants (AC-011)", () => {
  // -------------------------------------------------------------------------
  // Invariant 1: restartAttempts increments up to MAX_RESTART_ATTEMPTS
  // -------------------------------------------------------------------------

  test("restart counter increments on each exit before reaching the cap", () => {
    // handleExit() must increment restartAttempts (++this.restartAttempts) when
    // the attempt count is below the cap.
    assert.match(
      sidecarSource,
      /const attempt = \+\+this\.restartAttempts/,
    );
  });

  test("restart counter is bounded by MAX_RESTART_ATTEMPTS check before increment", () => {
    // The guard `this.restartAttempts >= MAX_RESTART_ATTEMPTS` must appear in
    // handleExit() before the increment, so the cap is enforced correctly.
    assert.match(handleExitBody, /this\.restartAttempts >= MAX_RESTART_ATTEMPTS/);
    const capCheckPos = handleExitBody.indexOf("this.restartAttempts >= MAX_RESTART_ATTEMPTS");
    const incrementPos = handleExitBody.indexOf("const attempt = ++this.restartAttempts");
    assert.ok(capCheckPos >= 0, "cap check not found in handleExit");
    assert.ok(incrementPos >= 0, "restart counter increment (const attempt = ++this.restartAttempts) not found in handleExit");
    assert.ok(
      capCheckPos < incrementPos,
      `cap check (pos ${capCheckPos}) must precede increment (pos ${incrementPos})`,
    );
  });

  test("restart attempt number is logged with MAX_RESTART_ATTEMPTS denominator", () => {
    // The log line `attempt N/MAX_RESTART_ATTEMPTS` must appear so the user can
    // see progress toward the cap (attempt 1/5 through 5/5).
    assert.match(
      sidecarSource,
      /attempt \$\{attempt\}\/\$\{MAX_RESTART_ATTEMPTS\}/,
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 2: "giving up" log fires when restartAttempts >= MAX_RESTART_ATTEMPTS
  // -------------------------------------------------------------------------

  test('"giving up" log message fires inside the MAX_RESTART_ATTEMPTS guard', () => {
    // The "giving up" error log must be inside the restartAttempts >= cap guard
    // so it fires exactly when the supervisor exhausts all attempts.
    assert.match(
      sidecarSource,
      /this\.restartAttempts >= MAX_RESTART_ATTEMPTS[\s\S]{0,300}giving up after \$\{this\.restartAttempts\} restart attempts/,
    );
  });

  test('"giving up" log uses gatewayLog.error (not warn or info)', () => {
    // Giving up is a fatal event — it must be logged at error level.
    const giveUpIdx = sidecarSource.indexOf("giving up after");
    assert.ok(giveUpIdx >= 0, '"giving up after" string not found in source');
    // Look back up to 50 chars for the log method name.
    const context = sidecarSource.slice(Math.max(0, giveUpIdx - 50), giveUpIdx);
    assert.match(context, /gatewayLog\.error/);
  });

  // -------------------------------------------------------------------------
  // Invariant 3: No process.kill/killGroup when sessionToken is missing from PID file
  // -------------------------------------------------------------------------

  test("reclaimOrphan returns without calling killGroup when sessionToken is missing", () => {
    // When the PID file exists but has no sessionToken, the code must log a
    // warning and return early (via deletePidFile then return) WITHOUT calling
    // killGroup.  This is the foreign-process safety guard.
    assert.match(reclaimOrphanBody, /!sessionToken/);

    // After the !sessionToken check there must be a return; before any killGroup.
    const noTokenIdx = reclaimOrphanBody.indexOf("!sessionToken");
    const returnAfterNoToken = reclaimOrphanBody.indexOf("return;", noTokenIdx);
    const killGroupIdx = reclaimOrphanBody.indexOf("killGroup(");
    assert.ok(noTokenIdx >= 0, "!sessionToken guard not found");
    assert.ok(returnAfterNoToken >= 0, "return after !sessionToken not found");
    assert.ok(killGroupIdx >= 0, "killGroup call not found in reclaimOrphan");
    assert.ok(
      returnAfterNoToken < killGroupIdx,
      `return; after !sessionToken (pos ${returnAfterNoToken}) must precede killGroup (pos ${killGroupIdx}) so missing sessionToken exits before kill`,
    );
  });

  test("reclaimOrphan logs a warning when sessionToken is missing (not silently skipped)", () => {
    // The foreign-process safety warning must be explicit so operators can
    // diagnose why a port-holding process was not reclaimed.
    assert.match(
      sidecarSource,
      /PID file missing sessionToken[\s\S]{0,100}skipping kill/,
    );
  });

  test("killGroup is only called inside the isRunning(pid) guard in reclaimOrphan", () => {
    // SIGKILL must only be sent if the recorded PID is alive.  This prevents
    // killing a reused PID that belongs to a different process.
    const isRunningPos = reclaimOrphanBody.indexOf("isRunning(pid)");
    const killGroupPos = reclaimOrphanBody.indexOf("killGroup(");
    assert.ok(isRunningPos >= 0, "isRunning(pid) guard not found in reclaimOrphan");
    assert.ok(killGroupPos >= 0, "killGroup call not found in reclaimOrphan");
    assert.ok(
      isRunningPos < killGroupPos,
      `isRunning guard (pos ${isRunningPos}) must precede killGroup call (pos ${killGroupPos})`,
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 4: onTerminalFailure callback is invoked when giving up
  // -------------------------------------------------------------------------

  test("onTerminalFailure callback is invoked inside the giving-up branch", () => {
    // The callback must be called with an actionable reason string when the
    // supervisor exhausts all restart attempts.
    assert.match(
      sidecarSource,
      /this\.restartAttempts >= MAX_RESTART_ATTEMPTS[\s\S]{0,500}this\.onTerminalFailure\?\.\(reason\)/,
    );
  });

  test("onTerminalFailure receives reason string built from lastExitWasPortConflict", () => {
    // The reason passed to the callback must differ based on whether the exit
    // was caused by EADDRINUSE, providing an actionable message in both cases.
    assert.match(
      sidecarSource,
      /lastExitWasPortConflict[\s\S]{0,100}port.*is in use by another process/,
    );
    // Fallback reason for non-port-conflict terminal failures.
    assert.match(
      sidecarSource,
      /Agent monitor failed after \$\{this\.restartAttempts\} restart attempts/,
    );
  });

  test("onTerminalFailure is called with the built reason, not a hardcoded string", () => {
    // The `reason` variable must be constructed and then passed directly to
    // the callback — not an inline string literal.
    assert.match(
      sidecarSource,
      /const reason = [\s\S]{0,300}this\.onTerminalFailure\?\.\(reason\)/,
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 5: "did not become healthy" log is present with the port number
  // -------------------------------------------------------------------------

  test('"did not become healthy" log includes the port number', () => {
    // The warn log must include `this.port` so the operator knows which port
    // failed, especially when running non-default configurations.
    assert.match(
      sidecarSource,
      /agent monitor did not become healthy on port \$\{this\.port\}/,
    );
  });

  test('"did not become healthy" log uses gatewayLog.warn', () => {
    // This is a recoverable failure (supervisor will retry), so warn is correct.
    const didNotIdx = sidecarSource.indexOf("agent monitor did not become healthy on port");
    assert.ok(didNotIdx >= 0, '"did not become healthy" log not found');
    const context = sidecarSource.slice(Math.max(0, didNotIdx - 60), didNotIdx);
    assert.match(context, /gatewayLog\.warn/);
  });

  test('"did not become healthy" log is only reached when this.child === child (stale-guard)', () => {
    // The stale-guard check `this.child !== child` with an early return must
    // precede the warn log so a superseded launch cannot emit this message.
    // (Shared with AC-010 but validated here as part of the foreign-process
    // behavioral invariant set.)
    assert.match(
      sidecarSource,
      /this\.child !== child[\s\S]{0,200}return;[\s\S]{0,400}agent monitor did not become healthy/,
    );
  });
});

// ---------------------------------------------------------------------------
// T-3.3: Orphan recovery scenario (AC-012) — source-level invariants
//
// These tests verify the behavioral invariants that make the orphan recovery
// scenario correct at runtime.  They assert the presence and ordering of
// critical logic patterns in the sidecar source text.
//
// AC-012: orphan recovery — spawn, persist PID, force-kill, restart, orphan
//         SIGKILLed, new spawn binds port 4820 successfully and reaches ready.
// ---------------------------------------------------------------------------

describe("T-3.3: orphan recovery scenario source-level invariants (AC-012)", () => {
  // -------------------------------------------------------------------------
  // Invariant 1: reclaimOrphan reads the PID file with fs.readFile
  // -------------------------------------------------------------------------

  test("reclaimOrphan reads sidecar.pid using fs.readFile", () => {
    // The reclaim path must use fs.readFile to retrieve the persisted PID record
    // so it can detect a running orphan from a prior session.
    assert.match(
      reclaimOrphanBody,
      /await fs\.readFile\(pidFile, "utf-8"\)/,
      "reclaimOrphan must call fs.readFile(pidFile, 'utf-8') to read the PID file",
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 2: reclaimOrphan calls isRunning() with the parsed pid
  // -------------------------------------------------------------------------

  test("reclaimOrphan calls isRunning(pid) with the parsed pid before deciding to kill", () => {
    // isRunning() is the alive-check that gates the SIGKILL.  Without this check
    // the reclaim path could kill a reused PID that belongs to a different process.
    assert.match(
      reclaimOrphanBody,
      /isRunning\(pid\)/,
      "reclaimOrphan must call isRunning(pid) to check whether the orphan is alive",
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 3: reclaimOrphan calls killGroup(pid, "SIGKILL") when isRunning is true
  // -------------------------------------------------------------------------

  test("reclaimOrphan calls killGroup(pid, 'SIGKILL') inside the isRunning guard", () => {
    // SIGKILL must only be sent when the recorded PID is confirmed alive via
    // isRunning(pid).  The kill and the guard must appear in the right order.
    const isRunningPos = reclaimOrphanBody.indexOf("isRunning(pid)");
    const killGroupPos = reclaimOrphanBody.indexOf('killGroup(pid, "SIGKILL")');
    assert.ok(isRunningPos >= 0, "isRunning(pid) not found in reclaimOrphan body");
    assert.ok(killGroupPos >= 0, 'killGroup(pid, "SIGKILL") not found in reclaimOrphan body');

    // The alive check must precede the kill so SIGKILL is conditional on liveness.
    assert.ok(
      isRunningPos < killGroupPos,
      `isRunning(pid) (pos ${isRunningPos}) must precede killGroup SIGKILL (pos ${killGroupPos})`,
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 4: reclaimOrphan calls deletePidFile() to clean up after killing
  // -------------------------------------------------------------------------

  test("reclaimOrphan calls deletePidFile() unconditionally after the kill path", () => {
    // The PID file must always be cleaned up at the end of reclaimOrphan —
    // regardless of whether the orphan was alive — so a stale file cannot
    // trigger a spurious kill on the next launch.
    const killGroupPos = reclaimOrphanBody.indexOf('killGroup(pid, "SIGKILL")');
    const lastDeletePos = reclaimOrphanBody.lastIndexOf("await this.deletePidFile()");
    assert.ok(killGroupPos >= 0, 'killGroup(pid, "SIGKILL") not found in reclaimOrphan body');
    assert.ok(lastDeletePos >= 0, "await this.deletePidFile() not found in reclaimOrphan body");
    assert.ok(
      killGroupPos < lastDeletePos,
      `killGroup SIGKILL (pos ${killGroupPos}) must precede the final deletePidFile (pos ${lastDeletePos})`,
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 5: reclaimOrphan is called in launch() before spawn()
  // -------------------------------------------------------------------------

  test("reclaimOrphan is called in launch() before the spawn() call", () => {
    // Pre-bind orphan reclamation must happen before we attempt to spawn a new
    // child so the port is free when the new process tries to bind.
    const reclaimCallPos = launchBody.indexOf("await this.reclaimOrphan()");
    const spawnCallPos = launchBody.indexOf("const child = spawn(");
    assert.ok(reclaimCallPos >= 0, "await this.reclaimOrphan() call not found in launch()");
    assert.ok(spawnCallPos >= 0, "const child = spawn() call not found in launch()");
    assert.ok(
      reclaimCallPos < spawnCallPos,
      `reclaimOrphan() call (pos ${reclaimCallPos}) must precede spawn() call (pos ${spawnCallPos})`,
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 6: ENOENT errors are handled gracefully (just returns)
  // -------------------------------------------------------------------------

  test("reclaimOrphan handles ENOENT from fs.readFile by returning early without killing", () => {
    // If no sidecar.pid file exists (first run or prior clean shutdown), the
    // reclaim path must silently return without attempting any kill.
    assert.match(
      reclaimOrphanBody,
      /code === "ENOENT"[\s\S]{0,60}return;/,
      'reclaimOrphan must check error.code === "ENOENT" and return early',
    );

    // The ENOENT early return must precede the killGroup call so that a missing
    // PID file never results in a kill.
    const enoentPos = reclaimOrphanBody.indexOf('code === "ENOENT"');
    const killGroupPos = reclaimOrphanBody.indexOf('killGroup(pid, "SIGKILL")');
    assert.ok(enoentPos >= 0, 'ENOENT guard not found in reclaimOrphan body');
    assert.ok(killGroupPos >= 0, 'killGroup call not found in reclaimOrphan body');
    assert.ok(
      enoentPos < killGroupPos,
      `ENOENT guard (pos ${enoentPos}) must precede killGroup (pos ${killGroupPos}) so missing file exits before kill`,
    );
  });
});

// ---------------------------------------------------------------------------
// T-3.4: Stale log suppression scenario (AC-013) — source-level invariants
//
// These tests verify the behavioral invariants that prevent a previous launch's
// stale waitForHealth resolution from emitting misleading "did not become
// healthy" logs after a new launch has already started.
//
// AC-013: stale log suppression — prev-launch resolves after new-launch race;
//         misleading "did not become healthy" log does not fire for the stale
//         context.
//
// The race condition: when launch() is called twice in rapid succession (e.g.
// because handleExit fires a restart while a prior waitForHealth is still
// polling), the first launch's waitForHealth eventually resolves false after
// the new child has already been set on this.child. Without the stale guard,
// the first launch would emit a misleading warn log and call flushReady(false),
// potentially overwriting the second launch's ready state.
// ---------------------------------------------------------------------------

describe("T-3.4: stale log suppression scenario source-level invariants (AC-013)", () => {
  // -------------------------------------------------------------------------
  // Invariant 1: this.child !== child early-return guard is present in launch()
  // -------------------------------------------------------------------------

  test("launch() contains the this.child !== child stale guard before the warn log", () => {
    // The stale guard must be present so that when a second launch() has already
    // replaced this.child, the first launch's continuation returns immediately
    // without logging the misleading "did not become healthy" message.
    assert.match(
      launchBody,
      /this\.child !== child/,
      "launch() must contain the this.child !== child stale guard",
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 2: the stale guard must result in an early return
  // -------------------------------------------------------------------------

  test("the this.child !== child guard has an early return that precedes the warn log", () => {
    // The return statement must immediately follow the stale guard check so
    // the warn log and flushReady(false) are completely skipped for stale launches.
    assert.match(
      sidecarSource,
      /this\.child !== child[\s\S]{0,50}return;/,
      "this.child !== child guard must be followed by a return statement",
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 3: the stale guard early return precedes the warn log in source
  // -------------------------------------------------------------------------

  test("the stale guard early return appears before the warn log in launch() body", () => {
    // Position-based assertion: the early return in the stale guard must come
    // before the warn log so the warn is unreachable for superseded launches.
    const staleGuardPos = launchBody.indexOf("this.child !== child");
    const warnLogPos = launchBody.indexOf(
      "agent monitor did not become healthy on port",
    );
    assert.ok(staleGuardPos >= 0, "this.child !== child not found in launch()");
    assert.ok(
      warnLogPos >= 0,
      "\"agent monitor did not become healthy\" log not found in launch()",
    );
    assert.ok(
      staleGuardPos < warnLogPos,
      `stale guard (pos ${staleGuardPos}) must precede the warn log (pos ${warnLogPos})`,
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 4: flushReady(false) is skipped when the launch is stale
  // -------------------------------------------------------------------------

  test("flushReady(false) is only reachable after the stale guard in launch()", () => {
    // When this.child !== child, the code returns before the flushReady(false)
    // call, ensuring the newer launch's ready state is not overwritten.
    // We verify this by asserting the stale guard return precedes flushReady(false).
    const staleGuardPos = launchBody.indexOf("this.child !== child");
    // Find the flushReady(false) call that follows the warn log (there may be
    // earlier flushReady(false) calls in the early-exit paths at the top of launch()).
    const warnLogPos = launchBody.indexOf("agent monitor did not become healthy");
    const flushReadyAfterWarn = launchBody.indexOf("this.flushReady(false)", warnLogPos);
    assert.ok(staleGuardPos >= 0, "stale guard not found in launch() body");
    assert.ok(warnLogPos >= 0, "warn log not found in launch() body");
    assert.ok(
      flushReadyAfterWarn >= 0,
      "flushReady(false) after warn log not found in launch() body",
    );
    // The stale guard must come before flushReady(false), confirming that when the
    // guard fires and returns early, flushReady(false) is bypassed.
    assert.ok(
      staleGuardPos < flushReadyAfterWarn,
      `stale guard (pos ${staleGuardPos}) must precede flushReady(false) (pos ${flushReadyAfterWarn}) so the call is skipped for stale launches`,
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 5: the guard compares local child against this.child (not this.child against this.child)
  // -------------------------------------------------------------------------

  test("the stale guard compares the local child variable against this.child", () => {
    // The guard must reference the closure-captured local `child` variable from
    // the spawn call — not a stale snapshot of `this.child`. This ensures that
    // the comparison correctly detects when a newer launch has replaced this.child
    // after the current launch captured its local reference.

    // The guard must be expressed as `this.child !== child` (this.child on the
    // left, local child on the right) — not `child !== child` or any other form.
    assert.match(
      launchBody,
      /if \(this\.child !== child\)/,
      "stale guard must use the exact form `if (this.child !== child)`",
    );

    // The local `child` variable must be defined in launch() via the spawn() call.
    assert.match(
      launchBody,
      /const child = spawn\(/,
      "local `child` must be set via spawn() in launch()",
    );
  });

  // -------------------------------------------------------------------------
  // Invariant 6: the stale guard comment explains the race condition
  // -------------------------------------------------------------------------

  test("the stale guard has an explanatory comment about the superseded launch", () => {
    // A comment documenting the race condition makes the invariant auditable
    // and prevents future maintainers from inadvertently removing the guard.
    // The comment must appear near the stale guard.
    assert.match(
      launchBody,
      /superseded[\s\S]{0,200}this\.child !== child/,
      "a comment mentioning \"superseded\" must appear before the stale guard in launch()",
    );
  });
});
