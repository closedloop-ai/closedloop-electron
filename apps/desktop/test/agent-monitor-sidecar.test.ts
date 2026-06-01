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
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

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

// Windows are sized to comfortably contain the full method body so a
// boundary-straddling assertion target (e.g. a string near the method's end)
// is never silently truncated out of the slice. Pad generously; the cost is a
// few extra chars of unrelated source, the failure mode of being too small is a
// misleading "not found" that blames production code for a test-window bug.
const reclaimOrphanBody = methodBody("private async reclaimOrphan()", 4000);
const handleExitBody = methodBody("private handleExit(", 2000);
const launchBody = methodBody("private async launch()", 4000);

// ---------------------------------------------------------------------------
// Static verification tests (AC-006 through AC-010 source-level invariants)
// ---------------------------------------------------------------------------

describe("agent-monitor-sidecar.ts source-level invariants", () => {
  // -------------------------------------------------------------------------
  // AC-006: PID file lifecycle — write after spawn, delete on stop()
  // -------------------------------------------------------------------------

  test("AC-006a: writePidFile uses atomic rename (write .tmp then rename)", () => {
    assert.match(
      sidecarSource,
      /await fs\.writeFile\(tmpFile, payload, "utf-8"\);\s*await fs\.rename\(tmpFile, pidFile\)/,
    );
  });

  test("AC-006b: writePidFile persists { pid, sessionToken, startTime, recordedAt } JSON", () => {
    // startTime (OS process start-time captured at spawn) is part of the
    // ownership identity reclaimOrphan re-verifies against the live process.
    assert.match(
      sidecarSource,
      /pid,\s*sessionToken: this\.sessionToken,\s*startTime: await getProcessStartTime\(pid\),\s*recordedAt:/,
    );
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

  test("AC-006f: writePidFile is called after spawn before health waits", () => {
    // The PID file must be written as soon as a child pid exists, before
    // waitForHealth() and the stability window, so a force-quit during startup
    // leaves enough metadata for the next launch to reclaim the orphan.
    const pidGuardPos = launchBody.indexOf("if (!child.pid)");
    const writePidPos = launchBody.indexOf("await this.writePidFile(child.pid)");
    const waitForHealthPos = launchBody.indexOf("const healthy = await this.waitForHealth(child)");
    assert.ok(pidGuardPos >= 0, "child.pid guard not found in launch()");
    assert.ok(writePidPos >= 0, "writePidFile(child.pid) not found in launch()");
    assert.ok(waitForHealthPos >= 0, "waitForHealth(child) not found in launch()");
    assert.ok(
      pidGuardPos < writePidPos && writePidPos < waitForHealthPos,
      "writePidFile(child.pid) must run after the pid guard and before waitForHealth(child)",
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

  test("AC-008d: reclaimOrphan verifies live-process ownership (command + start-time) before SIGKILL", () => {
    // A live pid is only SIGKILLed when BOTH independent, PID-file-independent
    // signals confirm it is still our sidecar: its command line runs our entry
    // file, and its OS start-time matches the value recorded at spawn. This is
    // the guard that prevents killing a recycled/foreign process holding the
    // fixed port — sessionToken presence alone is insufficient (it has no
    // independent witness).
    assert.match(reclaimOrphanBody, /const runsOurEntry =\s*command !== null && command\.includes\(entryFile\)/);
    assert.match(reclaimOrphanBody, /liveStartTime !== null && liveStartTime === recordedStartTime/);

    // The ownership check must precede the SIGKILL — the kill is gated on it.
    const ownershipPos = reclaimOrphanBody.indexOf("runsOurEntry && startTimeMatches");
    const killGroupPos = reclaimOrphanBody.indexOf('killGroup(pid, "SIGKILL")');
    assert.ok(ownershipPos >= 0, "ownership check (runsOurEntry && startTimeMatches) not found in reclaimOrphan");
    assert.ok(killGroupPos >= 0, 'killGroup(pid, "SIGKILL") not found in reclaimOrphan');
    assert.ok(
      ownershipPos < killGroupPos,
      `ownership check (pos ${ownershipPos}) must gate SIGKILL (pos ${killGroupPos})`,
    );
  });

  test("AC-008e: reclaimOrphan logs and skips kill when the live process is not our sidecar", () => {
    // The else-branch of the ownership check must warn and fall through to the
    // unconditional deletePidFile WITHOUT calling killGroup, so a recycled or
    // foreign pid is never signalled.
    assert.match(
      reclaimOrphanBody,
      /recycled or foreign process[\s\S]{0,80}skipping kill/,
    );
  });

  test("AC-008f: reclaimOrphan waits (bounded) for the SIGKILLed orphan to exit before returning", () => {
    // SIGKILL is not synchronous with the orphan releasing the fixed port, so
    // reclaimOrphan must poll isRunning(pid) on a bounded deadline after the kill
    // before launch() respawns — otherwise the first respawn can race a
    // not-yet-released socket and hit EADDRINUSE. Assert the exact bounded-wait
    // invariant: a deadline built from the named timeout constant, gating a
    // delay()-spaced isRunning(pid) poll loop, placed AFTER the SIGKILL.
    assert.match(
      reclaimOrphanBody,
      /killGroup\(pid, "SIGKILL"\);[\s\S]{0,600}const deadline = Date\.now\(\) \+ RECLAIM_WAIT_TIMEOUT_MS;\s*while \(isRunning\(pid\) && Date\.now\(\) < deadline\) \{\s*await delay\(READY_POLL_INTERVAL_MS\);\s*\}/,
    );
    // The timeout constant must be defined so the wait is genuinely bounded.
    assert.match(sidecarSource, /const RECLAIM_WAIT_TIMEOUT_MS = [\d_]+;/);
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
